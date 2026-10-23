const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("./debugLogger");
const { parseDbTimestamp } = require("./dbTimestamp");
const { isStoredAudioFile, identityDigest } = require("./storageOps");

class AudioStorageManager {
  constructor() {
    this.audioDir = path.join(app.getPath("userData"), "audio");
    this.ensureAudioDir();
  }

  ensureAudioDir() {
    try {
      fs.mkdirSync(this.audioDir, { recursive: true });
    } catch (error) {
      debugLogger.error(
        "Failed to create audio directory",
        { error: error.message },
        "audio-storage"
      );
    }
  }

  // Transcription ids are SQLite rowids. They arrive over IPC and are spliced
  // into a file name, so anything but plain digits (path separators, "..") must
  // never reach path.join, which would resolve it outside the audio directory.
  _normalizeId(transcriptionId) {
    const id = String(transcriptionId);
    return /^\d{1,15}$/.test(id) ? id : null;
  }

  _buildFilename(transcriptionId, timestamp) {
    if (timestamp) {
      // Named in the user's own wall clock, so the stored instant has to be
      // resolved before it is read -- a bare SQLite timestamp is UTC, not local.
      const d = parseDbTimestamp(timestamp);
      if (d) {
        const pad = (n) => String(n).padStart(2, "0");
        const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
        return `OpenWhispr-${date}-${time}-${transcriptionId}.webm`;
      }
    }
    return `OpenWhispr-${transcriptionId}.webm`;
  }

  saveAudio(transcriptionId, audioBuffer, timestamp) {
    try {
      const id = this._normalizeId(transcriptionId);
      if (id === null) {
        debugLogger.warn("Rejected audio save for invalid id", {}, "audio-storage");
        return { success: false };
      }
      transcriptionId = id;
      const filename = this._buildFilename(transcriptionId, timestamp);
      const filePath = path.join(this.audioDir, filename);
      fs.writeFileSync(filePath, audioBuffer);
      debugLogger.debug(
        "Audio saved",
        { transcriptionId, filename, size: audioBuffer.length },
        "audio-storage"
      );
      return { success: true, path: filePath };
    } catch (error) {
      debugLogger.error(
        "Failed to save audio",
        { transcriptionId, error: error.message },
        "audio-storage"
      );
      return { success: false };
    }
  }

  getAudioPath(transcriptionId) {
    try {
      transcriptionId = this._normalizeId(transcriptionId);
      if (transcriptionId === null) return null;
      const files = fs.readdirSync(this.audioDir);
      const match = files.find(
        (f) => f.endsWith(`-${transcriptionId}.webm`) || f === `${transcriptionId}.webm`
      );
      if (match) return path.join(this.audioDir, match);
    } catch {}
    return null;
  }

  getAudioBuffer(transcriptionId) {
    const filePath = this.getAudioPath(transcriptionId);
    if (!filePath) return null;
    try {
      return fs.readFileSync(filePath);
    } catch (error) {
      debugLogger.error(
        "Failed to read audio",
        { transcriptionId, error: error.message },
        "audio-storage"
      );
      return null;
    }
  }

  deleteAudio(transcriptionId) {
    try {
      const filePath = this.getAudioPath(transcriptionId);
      if (filePath) {
        fs.unlinkSync(filePath);
        debugLogger.debug("Audio deleted", { transcriptionId }, "audio-storage");
      }
      return { success: true };
    } catch (error) {
      debugLogger.error(
        "Failed to delete audio",
        { transcriptionId, error: error.message },
        "audio-storage"
      );
      return { success: false };
    }
  }

  cleanupExpiredAudio(retentionDays, databaseManager) {
    try {
      const cutoffMs = Date.now() - retentionDays * 86400000;
      const files = fs.readdirSync(this.audioDir).filter((f) => f.endsWith(".webm"));
      const expiredIds = [];
      let kept = 0;

      for (const file of files) {
        const filePath = path.join(this.audioDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.mtimeMs < cutoffMs) {
            fs.unlinkSync(filePath);
            // Extract ID from "OpenWhispr-...-{id}.webm" or legacy "{id}.webm"
            const basename = path.basename(file, ".webm");
            const lastDash = basename.lastIndexOf("-");
            const id = lastDash !== -1 ? basename.slice(lastDash + 1) : basename;
            expiredIds.push(id);
          } else {
            kept++;
          }
        } catch (error) {
          debugLogger.error(
            "Failed to process audio file during cleanup",
            { file, error: error.message },
            "audio-storage"
          );
        }
      }

      if (expiredIds.length > 0 && databaseManager) {
        databaseManager.clearAudioFlags(expiredIds);
      }

      debugLogger.info(
        "Audio cleanup complete",
        { deleted: expiredIds.length, kept, retentionDays },
        "audio-storage"
      );
      return { deleted: expiredIds.length, kept };
    } catch (error) {
      debugLogger.error("Audio cleanup failed", { error: error.message }, "audio-storage");
      return { deleted: 0, kept: 0 };
    }
  }

  // Reports what actually happened: an unlink failure is counted, and an
  // unreadable folder is never reported as an empty store.
  deleteAllAudio() {
    let files;
    try {
      files = fs.readdirSync(this.audioDir).filter(isStoredAudioFile);
    } catch (error) {
      debugLogger.error("Failed to delete all audio", { error: error.message }, "audio-storage");
      return { deleted: 0, failed: 0, readable: false };
    }
    let deleted = 0;
    let failed = 0;
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(this.audioDir, file));
        deleted++;
      } catch (error) {
        failed++;
        debugLogger.error(
          "Failed to delete audio file",
          { file, error: error.message },
          "audio-storage"
        );
      }
    }
    debugLogger.info("All audio deleted", { deleted, failed }, "audio-storage");
    return { deleted, failed, readable: true };
  }

  // The stored recordings behind getStorageUsage(), by name, so Settings >
  // Storage deletes exactly the set it counted. Never throws: like Plan 02's
  // getStorageUsage (spec §5.6), any folder read error is `readable: false`,
  // never an empty store. A stat failure still counts (Plan 02), but leaves
  // identity unknown and blocks Storage preview/deletion.
  listStoredAudio() {
    let files;
    try {
      files = fs.readdirSync(this.audioDir).filter(isStoredAudioFile).sort();
    } catch (error) {
      debugLogger.error(
        "Failed to read the audio folder",
        { error: error.message },
        "audio-storage"
      );
      return {
        files: [],
        totalBytes: 0,
        readable: false,
        directory: this.audioDir,
        identity: null,
        error: error.message,
      };
    }
    let totalBytes = 0;
    const identities = [];
    let identityError;
    for (const file of files) {
      try {
        const stat = fs.statSync(path.join(this.audioDir, file), { bigint: true });
        totalBytes += Number(stat.size);
        identities.push([
          file,
          ...[
            stat.dev,
            stat.ino,
            stat.mode,
            stat.size,
            stat.mtimeNs,
            stat.ctimeNs,
            stat.birthtimeNs,
          ].map(String),
        ]);
      } catch (error) {
        // Count remains readable for Plan 02; identity cannot be approved.
        identityError = `stat-failed: ${file}: ${error.message}`;
      }
    }
    return {
      files,
      totalBytes,
      readable: true,
      directory: this.audioDir,
      identity: identityError ? null : identityDigest(identities),
      ...(identityError ? { identityError } : {}),
    };
  }

  // Plan 02's shape, derived from the same listing: one predicate for the
  // row, the count and the delete.
  getStorageUsage() {
    const { files, totalBytes, readable } = this.listStoredAudio();
    return { fileCount: files.length, totalBytes, readable };
  }

  // Unlinks exactly these recordings and reports each failure; never throws.
  // A name that is not a plain recording in this folder is refused.
  removeFiles(names) {
    let deleted = 0;
    const failed = [];
    for (const file of names) {
      if (!isStoredAudioFile(file) || path.basename(file) !== file) {
        failed.push({ file, error: "not a stored recording" });
        continue;
      }
      try {
        fs.unlinkSync(path.join(this.audioDir, file));
        deleted++;
      } catch (error) {
        if (error.code === "ENOENT") continue; // already gone, e.g. the retention sweep
        failed.push({ file, error: error.message });
      }
    }
    if (failed.length > 0) {
      debugLogger.error("Failed to delete audio files", { failed: failed.length }, "audio-storage");
    }
    return { deleted, failed };
  }

  // Transcription ids that still have an audio file, or null when the folder
  // cannot be read. Filenames end in "-<id>.webm" or are "<id>.webm"
  // (_buildFilename).
  remainingAudioIds() {
    try {
      const ids = new Set();
      for (const file of fs.readdirSync(this.audioDir)) {
        const match = /(?:^|-)(\d+)\.webm$/.exec(file);
        if (match) ids.add(match[1]);
      }
      return ids;
    } catch {
      return null;
    }
  }
}

module.exports = AudioStorageManager;
