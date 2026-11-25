const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createDb, skipOrFail } = require("./harness/db");
const { setUserDataDir } = require("./harness/electronStub");
const {
  LOCAL_DATABASE_VERSION,
  runLocalDatabaseMigrations,
} = require("../../src/helpers/localDatabaseMigrations");

const EXPECTED_INDEXES = ["idx_transcriptions_active_order", "idx_notes_calendar_event_id"];

// The notes_fts_update trigger every database had before user_version 1.
const LEGACY_FTS_UPDATE_TRIGGER = `
CREATE TRIGGER notes_fts_update AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content, enhanced_content) VALUES ('delete', old.id, old.title, old.content, old.enhanced_content);
  INSERT INTO notes_fts(rowid, title, content, enhanced_content) VALUES (new.id, new.title, new.content, new.enhanced_content);
END;`;

function indexNames(db) {
  return new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row) => row.name)
  );
}

function ftsUpdateTriggerSql(db) {
  return db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'notes_fts_update'")
    .get()?.sql;
}

function assertCurrentSchema(db) {
  assert.equal(db.pragma("user_version", { simple: true }), LOCAL_DATABASE_VERSION);
  const indexes = indexNames(db);
  for (const name of EXPECTED_INDEXES) assert.ok(indexes.has(name), `${name} exists`);
  assert.match(
    ftsUpdateTriggerSql(db),
    /AFTER UPDATE OF title, content, enhanced_content ON notes/,
    "FTS re-indexes only when indexed text changes"
  );
}

function searchNotes(db, term) {
  return db
    .prepare("SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?")
    .all(term)
    .map((row) => row.rowid);
}

test("a fresh database reaches the current user_version with its indexes", (t) => {
  const manager = createDb(t);
  if (!manager) return;
  const { db } = manager;
  assertCurrentSchema(db);
  assert.equal(db.pragma("synchronous", { simple: true }), 1, "synchronous = NORMAL");
  assert.equal(db.pragma("temp_store", { simple: true }), 2, "temp_store = MEMORY");
  assert.equal(db.pragma("busy_timeout", { simple: true }), 5000);
});

test("history lists read live transcriptions in index order without a temp sort", (t) => {
  const manager = createDb(t);
  if (!manager) return;
  for (const includeDiscarded of [false, true]) {
    const statusFilter = includeDiscarded ? "" : " AND status != 'discarded'";
    const plan = manager.db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM transcriptions WHERE deleted_at IS NULL${statusFilter} ORDER BY timestamp DESC, id DESC LIMIT ?`
      )
      .all(50)
      .map((row) => row.detail)
      .join("\n");
    assert.match(plan, /idx_transcriptions_active_order/, plan);
    assert.doesNotMatch(plan, /TEMP B-TREE/, plan);
  }
});

test("an existing pre-versioning database upgrades in place and keeps its data", (t) => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-db-migration-"));
  t.after(() => fs.rmSync(userDataDir, { recursive: true, force: true }));
  let legacy;
  try {
    const BetterSqlite = require("better-sqlite3");
    legacy = new BetterSqlite(path.join(userDataDir, "transcriptions.db"));
  } catch (error) {
    skipOrFail(t, error);
    return;
  }
  // Reproduce a database written by a build without migrations.
  legacy.exec(require("../../src/helpers/localDatabaseSchema"));
  for (const name of EXPECTED_INDEXES) legacy.exec(`DROP INDEX ${name}`);
  legacy.exec("DROP TRIGGER notes_fts_update");
  legacy.exec(LEGACY_FTS_UPDATE_TRIGGER);
  legacy.pragma("user_version = 0");
  legacy
    .prepare("INSERT INTO notes (id, title, content) VALUES (1, 'Quarterly plan', 'budget review')")
    .run();
  legacy.close();

  setUserDataDir(userDataDir);
  const DatabaseManager = require("../../src/helpers/database.js");
  const manager = new DatabaseManager();
  t.after(() => manager.db.close());
  const { db } = manager;

  assertCurrentSchema(db);
  assert.deepEqual(searchNotes(db, "budget"), [1], "existing FTS rows survive the upgrade");

  // Metadata-only writes leave FTS alone; text edits still re-index.
  db.prepare("UPDATE notes SET participants = '[]', calendar_event_id = 'evt' WHERE id = 1").run();
  assert.deepEqual(searchNotes(db, "budget"), [1]);
  db.prepare("UPDATE notes SET content = 'roadmap draft' WHERE id = 1").run();
  assert.deepEqual(searchNotes(db, "budget"), []);
  assert.deepEqual(searchNotes(db, "roadmap"), [1]);

  // Re-running is a no-op once the database is current.
  assert.deepEqual(runLocalDatabaseMigrations(db), {
    from: LOCAL_DATABASE_VERSION,
    to: LOCAL_DATABASE_VERSION,
  });
});

test("a failed migration rolls back its own step and leaves the version unchanged", (t) => {
  let db;
  try {
    const BetterSqlite = require("better-sqlite3");
    db = new BetterSqlite(":memory:");
  } catch (error) {
    skipOrFail(t, error);
    return;
  }
  t.after(() => db.close());
  db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)");
  const migrations = [
    { version: 1, sql: "CREATE INDEX idx_items_id ON items(id);" },
    { version: 2, sql: "CREATE INDEX idx_partial ON items(id); SELECT * FROM missing_table;" },
  ];
  assert.throws(() => runLocalDatabaseMigrations(db, migrations), /missing_table/);
  assert.equal(db.pragma("user_version", { simple: true }), 1);
  const names = indexNames(db);
  assert.ok(names.has("idx_items_id"));
  assert.ok(!names.has("idx_partial"), "the failed step left nothing behind");
});
