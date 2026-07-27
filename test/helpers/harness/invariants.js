const assert = require("node:assert/strict");

// The single user-visible harm this suite exists to catch: a sync pass replacing
// text the user actually has with nothing.
const CONTENT_FIELDS = ["content", "transcript", "enhanced_content"];

function normalizeTimestamp(value) {
  if (!value) return "";
  const iso = String(value).replace(" ", "T").replace(/Z$/, "");
  return (/\.\d+$/.test(iso) ? iso : `${iso}.000`) + "Z";
}

function isEmpty(value) {
  return value === null || value === undefined || value === "";
}

// Every note row, soft-deleted ones included: a delete that empties the row is
// still a regression.
function snapshotNotes(db) {
  if (!db?.db) throw new TypeError("snapshotNotes requires a DatabaseManager");
  return db.db.prepare("SELECT * FROM notes").all();
}

function indexByClientId(rows) {
  const map = new Map();
  for (const row of rows ?? []) {
    if (row?.client_note_id) map.set(row.client_note_id, row);
  }
  return map;
}

// An erasure is excused only when the cloud legitimately won: its copy is
// strictly newer than the local row we started from, it is not an empty shell,
// and the value we ended up with is exactly what the cloud holds.
function erasureExcused(cloudRow, before, after, field) {
  if (!cloudRow) return false;
  if (normalizeTimestamp(cloudRow.updated_at) <= normalizeTimestamp(before.updated_at))
    return false;
  if (!CONTENT_FIELDS.some((f) => !isEmpty(cloudRow[f]))) return false;
  return (cloudRow[field] ?? null) === (after[field] ?? null);
}

function assertNoContentRegression(dbBefore, dbAfter, cloudTruth) {
  const before = indexByClientId(dbBefore);
  const cloud = indexByClientId(
    cloudTruth instanceof Map ? [...cloudTruth.values()] : (cloudTruth ?? [])
  );

  for (const after of dbAfter ?? []) {
    const prior = before.get(after.client_note_id);
    if (!prior) continue;
    for (const field of CONTENT_FIELDS) {
      if (isEmpty(prior[field]) || !isEmpty(after[field])) continue;
      if (erasureExcused(cloud.get(after.client_note_id), prior, after, field)) continue;
      assert.fail(
        `sync erased ${field} on note ${after.id} (client_note_id ${after.client_note_id}): ` +
          `had ${JSON.stringify(String(prior[field]).slice(0, 60))}, now ${JSON.stringify(after[field])}` +
          " — and no strictly-newer non-empty cloud copy explains it"
      );
    }
  }
}

module.exports = { assertNoContentRegression, snapshotNotes, CONTENT_FIELDS };
