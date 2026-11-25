// Versioned changes to the local database, tracked in PRAGMA user_version.
//
// localDatabaseSchema.js always describes the current schema, so a fresh
// database already has everything below; these steps bring databases created
// by earlier builds up to the same shape. Every step must therefore be
// idempotent (IF NOT EXISTS / DROP ... IF EXISTS), and versions only ever grow:
// append a new entry instead of editing a shipped one.

const NOTES_FTS_UPDATE_TRIGGER = `
CREATE TRIGGER notes_fts_update AFTER UPDATE OF title, content, enhanced_content ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content, enhanced_content) VALUES ('delete', old.id, old.title, old.content, old.enhanced_content);
  INSERT INTO notes_fts(rowid, title, content, enhanced_content) VALUES (new.id, new.title, new.content, new.enhanced_content);
END;`;

const LOCAL_DATABASE_MIGRATIONS = [
  {
    version: 1,
    description: "list/lookup indexes; re-index notes FTS only when indexed text changes",
    sql: `
CREATE INDEX IF NOT EXISTS idx_transcriptions_live_status_time
  ON transcriptions(deleted_at, status, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_notes_calendar_event_id ON notes(calendar_event_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_time_range ON calendar_events(start_time, end_time);
DROP TRIGGER IF EXISTS notes_fts_update;
${NOTES_FTS_UPDATE_TRIGGER}
`,
  },
];

const LOCAL_DATABASE_VERSION = LOCAL_DATABASE_MIGRATIONS.at(-1).version;

function getUserVersion(db) {
  return db.pragma("user_version", { simple: true });
}

/**
 * Applies every migration newer than the database's user_version, each in its
 * own transaction together with its version bump, so an interrupted upgrade
 * resumes at the first step that did not commit.
 * @returns {{ from: number, to: number }}
 */
function runLocalDatabaseMigrations(db, migrations = LOCAL_DATABASE_MIGRATIONS) {
  const from = getUserVersion(db);
  let current = from;
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      // PRAGMA arguments cannot be bound; versions are integers from this file.
      db.pragma(`user_version = ${Number.parseInt(migration.version, 10)}`);
    })();
    current = migration.version;
  }
  return { from, to: current };
}

module.exports = {
  LOCAL_DATABASE_MIGRATIONS,
  LOCAL_DATABASE_VERSION,
  NOTES_FTS_UPDATE_TRIGGER,
  runLocalDatabaseMigrations,
};
