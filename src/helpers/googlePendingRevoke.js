const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const debugLogger = require("./debugLogger");

// Owner decision D-1 (2026-10-23): a Google calendar disconnect while Sealed
// mode is on cannot ask Google to revoke Loqui's grant. Main records a pending
// revoke instead. It keeps only what the revoke needs (one token per grant,
// the refresh token when there is one) in the secure credential storage
// (secure-keys/, encrypted with secretCrypto like every stored key), marked
// pending-revoke and used for nothing else: no sync, no refresh, no request
// other than the revoke itself. The record survives a restart.
//
// After Sealed mode turns off (and at an unsealed start), main runs the
// revoke automatically: a ticketed calendar request through the egress gate,
// so the flight recorder lists it. A token is deleted only once Google
// accepted the revoke (or said the token is no longer valid). A failure keeps
// it, and the renderer is told so it can offer Retry and say plainly that the
// grant may still be active at Google. An automatic run never starts while
// sealed; a Retry while sealed is refused by the gate before any socket.
//
// Reset everything erases this record with every other credential. It must
// not do that silently: cleanup-app first tries the revoke when unsealed and
// reports when a grant may remain (see ipcHandlers cleanup-app).

const FILE = "google-pending-revoke.enc";

function createGooglePendingRevoke({
  dir,
  crypto: secret,
  revoke,
  isSealed,
  broadcast = () => {},
  now = () => Date.now(),
}) {
  const file = path.join(dir, FILE);
  let entries = null; // [{ id, token, queuedAt, attempts, lastFailure }]
  let running = null;

  function load() {
    if (entries) return entries;
    let buffer;
    try {
      buffer = fs.readFileSync(file);
    } catch (error) {
      if (error.code === "ENOENT") return (entries = []);
      throw error;
    }
    const parsed = JSON.parse(secret.decrypt(buffer).value);
    if (!Array.isArray(parsed)) throw new Error("PENDING_REVOKE_UNREADABLE");
    entries = parsed.filter((e) => e && typeof e.token === "string" && e.token);
    return entries;
  }
  function save(next) {
    if (next.length === 0) {
      fs.rmSync(file, { force: true });
    } else {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, secret.encrypt(JSON.stringify(next)), { mode: 0o600 });
      fs.renameSync(tmp, file);
    }
    entries = next;
  }
  // What the renderer may know: counts and states, never a token.
  function status() {
    let list;
    try {
      list = load();
    } catch {
      return { pending: 0, failed: 0, unreadable: true, running: !!running };
    }
    return {
      pending: list.length,
      failed: list.filter((e) => e.lastFailure).length,
      unreadable: false,
      running: !!running,
    };
  }
  const publish = (event) => {
    try {
      broadcast({ ...event, status: status() });
    } catch {}
  };

  // Persists one record per token before the caller deletes its own copy.
  // { queued } on success; { queued: 0, unavailable: true } when the token
  // cannot be kept securely (nothing is written in plain text).
  function add(tokens) {
    const fresh = tokens.filter((t) => typeof t === "string" && t);
    if (fresh.length === 0) return { queued: 0 };
    try {
      if (!secret.isAvailable()) return { queued: 0, unavailable: true };
      const current = load();
      const known = new Set(current.map((e) => e.token));
      const added = fresh
        .filter((token) => !known.has(token))
        .map((token) => ({
          id: crypto.randomUUID(),
          token,
          queuedAt: now(),
          attempts: 0,
          lastFailure: null,
        }));
      save([...current, ...added]);
      publish({ kind: "queued" });
      return { queued: fresh.length };
    } catch (error) {
      debugLogger.error("Pending Google revoke not saved", { error: error.message }, "gcal");
      return { queued: 0, unavailable: true };
    }
  }

  // One pass over the pending tokens. `automatic` runs never start while
  // sealed. Returns { revoked, failed, sealed?, skipped? }.
  function run({ automatic = false } = {}) {
    if (running) return running;
    if (automatic && isSealed())
      return Promise.resolve({ skipped: "sealed", revoked: 0, failed: 0 });
    let list;
    try {
      list = load();
    } catch (error) {
      debugLogger.error("Pending Google revoke unreadable", { error: error.message }, "gcal");
      return Promise.resolve({ skipped: "unreadable", revoked: 0, failed: 0 });
    }
    if (list.length === 0) return Promise.resolve({ skipped: "none", revoked: 0, failed: 0 });
    running = (async () => {
      let revoked = 0;
      let failed = 0;
      let sealed = false;
      for (const entry of [...list]) {
        if (automatic && isSealed()) break; // sealed mid-run: leave the rest pending
        let outcome;
        try {
          outcome = await revoke(entry.token);
        } catch {
          outcome = { ok: false, failure: "error" };
        }
        const current = load();
        if (outcome?.ok) {
          save(current.filter((e) => e.id !== entry.id));
          revoked++;
        } else {
          sealed ||= outcome?.sealed === true;
          save(
            current.map((e) =>
              e.id === entry.id
                ? {
                    ...e,
                    attempts: e.attempts + 1,
                    lastFailure: outcome?.sealed ? "sealed" : (outcome?.failure ?? "error"),
                  }
                : e
            )
          );
          failed++;
        }
      }
      const result = { revoked, failed, ...(sealed ? { sealed: true } : {}) };
      publish({ kind: failed > 0 ? "failed" : "revoked", revoked, failed, sealed });
      return result;
    })().finally(() => {
      running = null;
    });
    return running;
  }

  // Reset everything: drop the record (the caller reports what may remain).
  function erase() {
    const had = status().pending;
    try {
      save([]);
    } catch {}
    entries = null;
    return { erased: had };
  }

  return {
    add,
    status,
    runAutomatic: () => run({ automatic: true }),
    retry: () => run({ automatic: false }),
    erase,
    file,
  };
}

module.exports = { createGooglePendingRevoke, PENDING_REVOKE_FILE: FILE };
