const test = require("node:test");
const assert = require("node:assert/strict");

const { createDb } = require("./harness/db.js");
const DatabaseManager = require("../../src/helpers/database.js");
const { ANALYTICS_HISTORY_BACKFILL_VERSION } = require("../../src/helpers/analytics.js");

function reconcileThroughCheckpoint(db, limit = 250) {
  const state = db.getAnalyticsHistoryBackfillState(ANALYTICS_HISTORY_BACKFILL_VERSION);
  const batches = [];
  do {
    batches.push(
      db.backfillAnalyticsHistoryBatch({
        throughId: state.targetId,
        checkpointVersion: ANALYTICS_HISTORY_BACKFILL_VERSION,
        limit,
      })
    );
  } while (!batches[batches.length - 1].complete);
  return batches;
}

test("analytics reconciliation picks up later eligibility and usable processed text", (t) => {
  const db = createDb(t);
  if (!db) return;

  const insert = db.db.prepare(
    `INSERT INTO transcriptions (
       text, raw_text, status, client_transcription_id, timestamp, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`
  );
  insert.run(
    "processed text wins",
    "   ",
    "completed",
    "empty-raw",
    "2026-09-01 10:00:00",
    "2026-09-01 10:00:00"
  );
  insert.run(
    "retry succeeds later",
    null,
    "failed",
    "retried-later",
    "2026-09-02 10:00:00",
    "2026-09-02 10:00:00"
  );

  assert.equal(db.backfillAnalyticsHistoryBatch().inserted, 1);
  assert.equal(db.getAnalyticsSummary().totalWords, 3);

  db.db
    .prepare("UPDATE transcriptions SET status = 'completed' WHERE client_transcription_id = ?")
    .run("retried-later");
  assert.equal(db.backfillAnalyticsHistoryBatch().inserted, 1);
  assert.equal(db.getAnalyticsSummary().totalWords, 6);

  insert.run(
    "pulled after startup",
    null,
    "completed",
    "pulled-later",
    "2025-01-01 10:00:00",
    "2025-01-01 10:00:00"
  );
  assert.equal(db.backfillAnalyticsHistoryBatch().inserted, 1);
  assert.equal(db.backfillAnalyticsHistoryBatch().scanned, 0);
});

test("analytics history checkpoint persists progress and scans only the new tail", (t) => {
  const db = createDb(t);
  if (!db) return;

  const insert = db.db.prepare(
    `INSERT INTO transcriptions (
       text, status, client_transcription_id, timestamp, created_at
     ) VALUES (?, 'completed', ?, ?, ?)`
  );
  insert.run("one two", "checkpoint-1", "2026-09-01T10:00:00.000Z", "2026-09-01 10:00:00");
  insert.run("three four", "checkpoint-2", "2026-09-02T10:00:00.000Z", "2026-09-02 10:00:00");

  assert.deepEqual(db.getAnalyticsHistoryBackfillState(), {
    version: ANALYTICS_HISTORY_BACKFILL_VERSION,
    scannedThroughId: 0,
    targetId: 2,
  });
  assert.equal(
    reconcileThroughCheckpoint(db, 1).reduce((total, batch) => total + batch.inserted, 0),
    2
  );
  assert.deepEqual(db.getAnalyticsHistoryBackfillState(), {
    version: ANALYTICS_HISTORY_BACKFILL_VERSION,
    scannedThroughId: 2,
    targetId: 2,
  });
  assert.deepEqual(reconcileThroughCheckpoint(db), [
    {
      complete: true,
      nextCursor: 2,
      scanned: 0,
      inserted: 0,
      skipped: 0,
    },
  ]);

  insert.run("five six", "checkpoint-3", "2026-09-03T10:00:00.000Z", "2026-09-03 10:00:00");
  assert.deepEqual(db.getAnalyticsHistoryBackfillState(), {
    version: ANALYTICS_HISTORY_BACKFILL_VERSION,
    scannedThroughId: 2,
    targetId: 3,
  });
  assert.equal(reconcileThroughCheckpoint(db)[0].inserted, 1);
  assert.equal(db.getAnalyticsSummary().totalDictations, 3);

  assert.deepEqual(db.getAnalyticsHistoryBackfillState(ANALYTICS_HISTORY_BACKFILL_VERSION + 1), {
    version: ANALYTICS_HISTORY_BACKFILL_VERSION + 1,
    scannedThroughId: 0,
    targetId: 3,
  });
});

test("a reopened database reuses its completed analytics history checkpoint", (t) => {
  const db = createDb(t);
  if (!db) return;

  db.saveTranscription("persist this checkpoint", null, {
    clientTranscriptionId: "checkpoint-reopen",
    analyticsOccurredAt: "2026-09-01T10:00:00.000Z",
  });
  reconcileThroughCheckpoint(db);
  db.db.close();

  const reopened = new DatabaseManager();
  try {
    assert.deepEqual(reopened.getAnalyticsHistoryBackfillState(), {
      version: ANALYTICS_HISTORY_BACKFILL_VERSION,
      scannedThroughId: 1,
      targetId: 1,
    });
    assert.equal(reconcileThroughCheckpoint(reopened)[0].scanned, 0);
  } finally {
    reopened.db.close();
  }
});

test("schema setup adds the checkpoint table to an existing database without a migration", (t) => {
  const db = createDb(t);
  if (!db) return;

  db.db.exec("DROP TABLE analytics_history_backfill_state");
  db.db.close();

  const reopened = new DatabaseManager();
  try {
    assert.deepEqual(reopened.getAnalyticsHistoryBackfillState(), {
      version: ANALYTICS_HISTORY_BACKFILL_VERSION,
      scannedThroughId: 0,
      targetId: 0,
    });
  } finally {
    reopened.db.close();
  }
});

test("analytics history checkpoint advances atomically with each batch", (t) => {
  const db = createDb(t);
  if (!db) return;

  db.db
    .prepare(
      `INSERT INTO transcriptions (
         text, status, client_transcription_id, timestamp, created_at
       ) VALUES
         ('first row', 'completed', 'atomic-1',
          '2026-09-01T10:00:00.000Z', '2026-09-01 10:00:00'),
         ('second row', 'completed', 'atomic-2',
          '2026-09-02T10:00:00.000Z', '2026-09-02 10:00:00')`
    )
    .run();
  const state = db.getAnalyticsHistoryBackfillState();
  const first = db.backfillAnalyticsHistoryBatch({
    throughId: state.targetId,
    checkpointVersion: ANALYTICS_HISTORY_BACKFILL_VERSION,
    limit: 1,
  });
  assert.equal(first.nextCursor, 1);
  db.db.exec("DROP TABLE analytics_events");

  assert.throws(
    () =>
      db.backfillAnalyticsHistoryBatch({
        throughId: state.targetId,
        checkpointVersion: ANALYTICS_HISTORY_BACKFILL_VERSION,
        limit: 1,
      }),
    /analytics_events/
  );
  assert.equal(db.getAnalyticsHistoryBackfillState().scannedThroughId, 1);
});

test("clearing history keeps old counters gone and admits later transcription IDs", (t) => {
  const db = createDb(t);
  if (!db) return;

  db.saveTranscription("old checkpoint words", null, {
    clientTranscriptionId: "checkpoint-before-clear",
    analyticsOccurredAt: "2026-09-01T10:00:00.000Z",
  });
  reconcileThroughCheckpoint(db);
  assert.equal(db.getAnalyticsSummary().totalDictations, 1);

  db.clearTranscriptions();
  assert.equal(db.getAnalyticsSummary().totalDictations, 0);
  const afterClear = new Date(Date.now() + 60_000).toISOString();
  db.saveTranscription("new checkpoint words", null, {
    clientTranscriptionId: "checkpoint-after-clear",
    analyticsOccurredAt: afterClear,
  });
  assert.equal(reconcileThroughCheckpoint(db)[0].inserted, 1);
  assert.equal(db.getAnalyticsSummary().totalDictations, 1);
  assert.equal(
    db.db
      .prepare("SELECT COUNT(*) AS count FROM analytics_events WHERE event_id = ?")
      .get("checkpoint-before-clear").count,
    0
  );
});

test("a dictation whose time cannot be read stays out instead of landing on today", (t) => {
  const db = createDb(t);
  if (!db) return;

  db.db
    .prepare(
      `INSERT INTO transcriptions (
         text, status, client_transcription_id, timestamp, created_at
       ) VALUES ('undateable words', 'completed', 'no-usable-time', 'not-a-time', 'not-a-time')`
    )
    .run();

  assert.deepEqual(db.backfillAnalyticsHistoryBatch(), {
    complete: true,
    nextCursor: 1,
    scanned: 1,
    inserted: 0,
    skipped: 1,
  });
  const summary = db.getAnalyticsSummary();
  assert.equal(summary.totalDictations, 0, "an undateable row must not become today's dictation");
  assert.equal(summary.currentStreakDays, 0, "and must not manufacture a streak");
});

// SQLite reads a bare YYYY-MM-DD as carrying a zone, because the day hyphen
// sits six characters from the end, so the query's shape test admits a row the
// JS side then dates from created_at instead. Nothing writes that shape today,
// but the boundary has to hold on the instant actually written, not on the
// column the query happened to filter.
test("history the user cleared cannot come back through a mis-shaped timestamp", (t) => {
  const db = createDb(t);
  if (!db) return;

  db.db
    .prepare(
      `INSERT INTO transcriptions (
         text, status, client_transcription_id, timestamp, created_at
       ) VALUES ('cleared words', 'completed', 'shape-bypass', '2027-01-01',
                 '2026-01-02 03:04:05')`
    )
    .run();
  db.db
    .prepare(
      "INSERT INTO analytics_device_clear_state (id, cleared_through) VALUES (1, '2026-08-15T00:00:00.000Z')"
    )
    .run();

  assert.deepEqual(db.backfillAnalyticsHistoryBatch(), {
    complete: true,
    nextCursor: 1,
    scanned: 1,
    inserted: 0,
    skipped: 1,
  });
  assert.equal(db.getAnalyticsSummary().totalDictations, 0);
});

test("backfill preserves the transcription creation time for retention", (t) => {
  const db = createDb(t);
  if (!db) return;

  db.db
    .prepare(
      `INSERT INTO transcriptions (
         text, status, client_transcription_id, timestamp, created_at
       ) VALUES ('old words', 'completed', 'old-retained',
                 '2020-01-01T09:59:00.000Z', '2020-01-01 10:00:00')`
    )
    .run();

  assert.equal(db.backfillAnalyticsHistoryBatch().inserted, 1);
  assert.equal(
    db.db.prepare("SELECT created_at FROM analytics_events WHERE event_id = 'old-retained'").get()
      .created_at,
    "2020-01-01 10:00:00"
  );
  assert.equal(db.deleteTranscriptionsExpiredBefore(30).analyticsPurged, 1);
  assert.equal(db.getAnalyticsSummary().totalDictations, 0);
});

test("new transcription rows retain the original analytics occurrence time", (t) => {
  const db = createDb(t);
  if (!db) return;

  const occurredAt = "2026-09-01T09:58:00.000Z";
  const result = db.saveTranscription("saved words", "saved words", {
    analyticsOccurredAt: occurredAt,
  });
  assert.equal(result.transcription.timestamp, occurredAt.replace("T", " "));
});
