const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

class SealedState extends EventEmitter {
  constructor({ profile, now = Date.now }) {
    super();
    this.file = path.join(profile, "privacy.json");
    this.now = now;
    this.sealed = false;
    this.sealedSince = null;
    this.loadError = null;
    this.saveError = null;

    let text;
    try {
      text = fs.readFileSync(this.file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") this._failClosed("unreadable");
      return;
    }

    try {
      const saved = JSON.parse(text);
      if (typeof saved?.sealed !== "boolean") throw new TypeError("sealed is not a boolean");
      this.sealed = saved.sealed;
      this.sealedSince = saved.sealed
        ? Number.isFinite(saved.sealedSince)
          ? saved.sealedSince
          : this.now()
        : null;
    } catch {
      this._failClosed("corrupt");
    }
  }

  _failClosed(reason) {
    this.sealed = true;
    this.sealedSince = this.now();
    this.loadError = reason;
  }

  isSealed() {
    return this.sealed;
  }

  snapshot() {
    return {
      sealed: this.sealed,
      sealedSince: this.sealedSince,
      loadError: this.loadError,
      saveError: this.saveError,
    };
  }

  set(sealed) {
    if (typeof sealed !== "boolean") throw new TypeError("sealed must be a boolean");
    if (sealed === this.sealed && !this.loadError) return this.snapshot();

    const changed = sealed !== this.sealed;
    if (sealed) {
      if (!this.sealed) this.sealedSince = this.now();
    } else {
      this.sealedSince = null;
    }
    this.sealed = sealed;

    this._save();
    // The user's explicit choice supersedes what was (not) read at startup,
    // even when it could not be saved; saveError still names that (T14-M5).
    this.loadError = null;
    if (changed) this.emit("change", this.snapshot());
    return this.snapshot();
  }

  _save() {
    let fd;
    const tmp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      try {
        fs.unlinkSync(tmp);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const noFollow = fs.constants.O_NOFOLLOW || 0;
      fd = fs.openSync(
        tmp,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
        0o600
      );
      fs.fchmodSync(fd, 0o600);
      fs.writeFileSync(fd, JSON.stringify({ sealed: this.sealed, sealedSince: this.sealedSince }));
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(tmp, this.file);
      this.saveError = null;
    } catch (error) {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          // Keep the original persistence failure as the reported error.
        }
      }
      this.saveError = error.code || error.message;
    }
  }
}

// Electron keeps a session's spellchecker setting in the profile's persistent
// preferences, so a quit or crash while sealed would leave it off for good
// (re-review m1). Before Sealed mode turns spellcheck off, Loqui writes this
// marker beside privacy.json; the restore on unseal, or the first unsealed
// start, turns spellcheck back on and removes it. Any marker file that exists
// counts as set. Writes are 0600 and never follow a symlink.
function createSpellcheckMarker(profile) {
  const file = path.join(profile, "privacy-spellcheck.json");
  return {
    file,
    isSet() {
      try {
        fs.lstatSync(file);
        return true;
      } catch {
        return false;
      }
    },
    set() {
      const tmp = `${file}.tmp`;
      let fd;
      try {
        fs.mkdirSync(profile, { recursive: true });
        try {
          fs.unlinkSync(tmp);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        fd = fs.openSync(
          tmp,
          fs.constants.O_WRONLY |
            fs.constants.O_CREAT |
            fs.constants.O_EXCL |
            (fs.constants.O_NOFOLLOW || 0),
          0o600
        );
        fs.fchmodSync(fd, 0o600);
        fs.writeFileSync(fd, JSON.stringify({ restoreSpellcheck: true }));
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(tmp, file);
        return true;
      } catch {
        if (fd !== undefined) {
          try {
            fs.closeSync(fd);
          } catch {}
        }
        return false;
      }
    },
    clear() {
      try {
        fs.unlinkSync(file);
        return true;
      } catch (error) {
        return error.code === "ENOENT";
      }
    },
  };
}

module.exports = { SealedState, createSpellcheckMarker };
