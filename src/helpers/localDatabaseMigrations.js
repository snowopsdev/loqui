// Versioned changes to the local database, tracked in PRAGMA user_version.
//
// Order at open: localDatabaseSchema.js runs first (CREATE ... IF NOT EXISTS),
// then these migrations. The schema script therefore also runs against old
// databases whose tables predate newer columns, so an index or trigger that
// depends on a column added later belongs here, after the step that adds the
// column, never in the schema script alone.
//
// Steps that only add objects are mirrored in the schema script so a fresh
// database reads complete, which means every step must be idempotent
// (IF NOT EXISTS / DROP ... IF EXISTS). Versions only ever grow: append a new
// entry instead of editing a shipped one.

const NOTES_FTS_UPDATE_TRIGGER = `
CREATE TRIGGER notes_fts_update AFTER UPDATE OF title, content, enhanced_content ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content, enhanced_content) VALUES ('delete', old.id, old.title, old.content, old.enhanced_content);
  INSERT INTO notes_fts(rowid, title, content, enhanced_content) VALUES (new.id, new.title, new.content, new.enhanced_content);
END;`;

// History lists read live rows newest-first, optionally excluding discarded
// ones. The partial index serves that order directly (no temp B-tree); the
// status filter is applied to rows as they stream in index order.
const TRANSCRIPTIONS_ACTIVE_ORDER_INDEX = `CREATE INDEX IF NOT EXISTS idx_transcriptions_active_order
  ON transcriptions(timestamp DESC, id DESC) WHERE deleted_at IS NULL;`;

const LOCAL_DATABASE_MIGRATIONS = [
  {
    version: 1,
    description: "history/meeting lookup indexes; re-index notes FTS only when its text changes",
    sql: `
${TRANSCRIPTIONS_ACTIVE_ORDER_INDEX}
CREATE INDEX IF NOT EXISTS idx_notes_calendar_event_id ON notes(calendar_event_id);
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
