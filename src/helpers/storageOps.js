// Main-owned storage counts and deletions for Settings > Privacy & Data.
// Each preview counts with the predicate its deletion uses, and each
// deletion refuses to run when the set changed after the user reviewed it,
// so a confirmation never promises less than the delete removes.
// Built on Plan 02's stored-audio contract (spec §5.6): the folder listing
// carries `readable`, which this module maps to a typed error (an unreadable
// folder is never zero), every audio result keeps `failed` and `readable`,
// and has_audio flags go through Plan 02's clearFlagsForDeletedAudio.
const { createHash } = require("node:crypto");
const { clearFlagsForDeletedAudio } = require("./audioFlagReconcile");

// Callers supply deterministically ordered arrays/rows. Only digests leave main.
const identityDigest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Audio predicate: every recording in the audio folder, linked to a transcript or not. */
function isStoredAudioFile(name) {
  return typeof name === "string" && name.endsWith(".webm");
}

/**
 * History predicate: every row of `transcriptions` -- completed, discarded
 * and soft-deleted alike. DatabaseManager.clearTranscriptions deletes the
 * same set (`DELETE FROM transcriptions`, database.js:553); deleteHistory
 * compares the two inside one transaction and rolls back on any mismatch.
 */
const HISTORY_COUNT_SQL = `SELECT
  COUNT(*) AS total,
  COALESCE(SUM(CASE WHEN deleted_at IS NULL AND status = 'discarded' THEN 1 ELSE 0 END), 0) AS discarded,
  COALESCE(SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS softDeleted,
  COALESCE(SUM(CASE WHEN has_audio = 1 THEN 1 ELSE 0 END), 0) AS withAudio
FROM transcriptions`;

const describe = (error) => String(error?.message || error);
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isIdentity = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const validExpected = (expected, counts, identities) =>
  !!expected &&
  typeof expected === "object" &&
  counts.every((key) => isCount(expected[key])) &&
  identities.every((key) => isIdentity(expected[key]));

class AudioCountError extends Error {}

class StaleHistoryError extends Error {
  constructor(total) {
    super("stale");
    this.total = total;
  }
}

function createStorageOps({ audio, database, broadcast = () => {} }) {
  const countHistory = () => {
    const row = database.db.prepare(HISTORY_COUNT_SQL).get();
    return {
      total: row.total,
      discarded: row.discarded,
      softDeleted: row.softDeleted,
      withAudio: row.withAudio,
      // SELECT * binds all persisted identity/state, including same-id edits.
      // Raw rows remain in main; ORDER BY id makes the digest deterministic.
      historyIdentity: identityDigest(
        database.db.prepare("SELECT * FROM transcriptions ORDER BY id").all()
      ),
    };
  };

  const unreadable = (listed) => listed.error || `unreadable: ${listed.directory}`;
  const audioCountError = (listed) =>
    !listed.readable
      ? unreadable(listed)
      : !isIdentity(listed.identity)
        ? listed.identityError || "unknown audio identity"
        : null;

  function preview() {
    const listed = audio.listStoredAudio();
    const audioError = audioCountError(listed);
    const audioPreview =
      audioError === null
        ? {
            files: listed.files.length,
            bytes: listed.totalBytes,
            directory: listed.directory,
            audioIdentity: listed.identity,
          }
        : { error: audioError };
    let history;
    try {
      history = countHistory();
    } catch (error) {
      history = { error: describe(error) };
    }
    return { audio: audioPreview, history };
  }

  // Unlinks exactly the counted names, then re-reads the folder to learn how
  // many recordings remain, including any new unreviewed arrivals (which are
  // never unlinked here). An unreadable or stat-unknown re-read leaves `remaining`
  // unknown (null), which is never success.
  function removeCounted(names) {
    const errors = [];
    const { deleted, failed } = audio.removeFiles(names);
    for (const failure of failed) errors.push(`delete-failed: ${failure.file}: ${failure.error}`);
    const after = audio.listStoredAudio();
    const recountError = audioCountError(after);
    if (recountError !== null) {
      errors.push(`recount-failed: ${recountError}`);
      return { deleted, failed: failed.length, remaining: null, errors };
    }
    return { deleted, failed: failed.length, remaining: after.files.length, errors };
  }

  // Plan 02's reconciler: clears has_audio only for rows whose recording is
  // provably gone, and nothing when the folder is unreadable.
  function reconcileAudioFlags(errors) {
    try {
      clearFlagsForDeletedAudio({ audioStorage: audio, database });
    } catch (error) {
      errors.push(`flags-failed: ${describe(error)}`);
    }
  }

  // `readable: false` with no read at all ("invalid-request") is still never success.
  const notRead = (error) => ({
    ok: false,
    deleted: 0,
    failed: 0,
    readable: false,
    remaining: null,
    errors: [error],
  });

  function deleteAudio({ expected } = {}) {
    if (!validExpected(expected, ["files"], ["audioIdentity"])) return notRead("invalid-request");
    const counted = audio.listStoredAudio();
    const countError = audioCountError(counted);
    if (countError !== null) return notRead(`count-failed: ${countError}`);
    if (counted.files.length !== expected.files || counted.identity !== expected.audioIdentity) {
      return {
        ok: false,
        deleted: 0,
        failed: 0,
        readable: true,
        remaining: counted.files.length,
        errors: ["stale"],
      };
    }
    const result = removeCounted(counted.files);
    // Unknown disk state never clears flags.
    if (result.remaining !== null) reconcileAudioFlags(result.errors);
    return {
      ok: result.errors.length === 0 && result.failed === 0 && result.remaining === 0,
      deleted: result.deleted,
      failed: result.failed,
      readable: true,
      remaining: result.remaining,
      errors: result.errors,
    };
  }

  function deleteHistory({ expected } = {}) {
    const untouched = (files) => ({
      deleted: 0,
      failed: 0,
      readable: files !== null,
      remaining: files,
    });
    if (!validExpected(expected, ["total", "files"], ["audioIdentity", "historyIdentity"])) {
      return {
        ok: false,
        deleted: 0,
        remaining: null,
        errors: ["invalid-request"],
        audio: untouched(null),
      };
    }
    // No await or callback turn between identity recheck and deletion. Read
    // both sets inside the transaction, before any row or recording is touched.
    let counted;
    let cleared;
    try {
      cleared = database.db.transaction(() => {
        counted = audio.listStoredAudio();
        const countError = audioCountError(counted);
        if (countError !== null) throw new AudioCountError(countError);
        const rows = countHistory();
        if (
          rows.total !== expected.total ||
          counted.files.length !== expected.files ||
          rows.historyIdentity !== expected.historyIdentity ||
          counted.identity !== expected.audioIdentity
        ) {
          throw new StaleHistoryError(rows.total);
        }
        const result = database.clearTranscriptions();
        if (result?.cleared !== rows.total) {
          throw new Error(
            `predicate mismatch: counted ${rows.total} rows, delete removed ${result?.cleared}`
          );
        }
        return result.cleared;
      })();
    } catch (error) {
      if (error instanceof AudioCountError) {
        return {
          ok: false,
          deleted: 0,
          remaining: null,
          errors: [`count-failed: ${describe(error)}`],
          audio: untouched(null),
        };
      }
      if (error instanceof StaleHistoryError) {
        return {
          ok: false,
          deleted: 0,
          remaining: error.total,
          errors: ["stale"],
          audio: untouched(counted.files.length),
        };
      }
      let remaining = null;
      try {
        remaining = countHistory().total;
      } catch {
        // the database itself is unreadable; remaining stays unknown
      }
      return {
        ok: false,
        deleted: 0,
        remaining,
        errors: [`history-failed: ${describe(error)}`],
        audio: untouched(counted?.readable ? counted.files.length : null),
      };
    }
    broadcast("transcriptions-cleared", { cleared });
    broadcast("analytics-changed");
    // Every row is gone, so no has_audio flag is left to reconcile.
    const files = removeCounted(counted.files);
    return {
      ok: files.errors.length === 0 && files.failed === 0 && files.remaining === 0,
      deleted: cleared,
      remaining: 0,
      errors: files.errors,
      audio: {
        deleted: files.deleted,
        failed: files.failed,
        readable: true,
        remaining: files.remaining,
      },
    };
  }

  return { preview, deleteAudio, deleteHistory };
}

module.exports = { createStorageOps, isStoredAudioFile, HISTORY_COUNT_SQL, identityDigest };
