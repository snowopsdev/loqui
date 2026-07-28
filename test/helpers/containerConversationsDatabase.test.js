const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

let userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-container-db-"));
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        getPath: () => userDataDir,
        getAppPath: () => process.cwd(),
        isReady: () => false,
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

process.env.NODE_ENV = "test";

const DatabaseManager = require("../../src/helpers/database.js");

function isNativeBindingUnavailable(error) {
  const message = String(error?.message || error);
  return (
    message.includes("NODE_MODULE_VERSION") ||
    message.includes("Could not locate the bindings file")
  );
}

function createDb(t) {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-container-db-"));
  try {
    const BetterSqlite = require("better-sqlite3");
    const probe = new BetterSqlite(path.join(userDataDir, "probe.db"));
    probe.close();
    fs.rmSync(path.join(userDataDir, "probe.db"), { force: true });
  } catch (error) {
    if (isNativeBindingUnavailable(error)) {
      t.skip("better-sqlite3 native binding is not available for this Node runtime");
      return null;
    }
    throw error;
  }

  try {
    return new DatabaseManager();
  } catch (error) {
    if (isNativeBindingUnavailable(error)) {
      t.skip("better-sqlite3 native binding is not available for this Node runtime");
      return null;
    }
    throw error;
  }
}

test("container scope migration is idempotent across launches", (t) => {
  const db = createDb(t);
  if (!db) return;

  const columns = db.db.pragma("table_info('agent_conversations')").map((col) => col.name);
  assert.ok(columns.includes("space_id"));
  assert.ok(columns.includes("folder_id"));

  const noteColumns = db.db.pragma("table_info('notes')").map((col) => col.name);
  assert.ok(noteColumns.includes("updated_by_user_id"));

  db.db.close();

  const db2 = new DatabaseManager();
  const indexes = db2.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'agent_conversations'"
    )
    .all()
    .map((row) => row.name);
  assert.ok(indexes.includes("idx_agent_conversations_container"));
});

test("createAgentConversation stores container scope", (t) => {
  const db = createDb(t);
  if (!db) return;
  const space = db.createSpace({ name: "Eng" }).space;
  const folder = db.createFolder("Docs", space.id).folder;

  const folderConv = db.createAgentConversation("Docs", null, space.id, folder.id);
  assert.equal(folderConv.space_id, space.id);
  assert.equal(folderConv.folder_id, folder.id);

  const spaceConv = db.createAgentConversation("Eng", null, space.id);
  assert.equal(spaceConv.space_id, space.id);
  assert.equal(spaceConv.folder_id, null);

  const globalConv = db.createAgentConversation("Global");
  assert.equal(globalConv.space_id, null);
  assert.equal(globalConv.folder_id, null);
  assert.equal(globalConv.note_id, null);
});

test("getConversationsForContainer separates folder and space-root scopes", (t) => {
  const db = createDb(t);
  if (!db) return;
  const space = db.createSpace({ name: "Eng" }).space;
  const folder = db.createFolder("Docs", space.id).folder;

  const folderConv = db.createAgentConversation("Folder chat", null, space.id, folder.id);
  const spaceConv = db.createAgentConversation("Space chat", null, space.id);
  db.createAgentConversation("Global chat");
  db.addAgentMessage(folderConv.id, "user", "hello");

  const folderList = db.getConversationsForContainer(space.id, folder.id);
  assert.equal(folderList.length, 1);
  assert.equal(folderList[0].id, folderConv.id);
  assert.equal(folderList[0].message_count, 1);

  const spaceList = db.getConversationsForContainer(space.id, null);
  assert.equal(spaceList.length, 1, "space root must exclude folder-scoped conversations");
  assert.equal(spaceList[0].id, spaceConv.id);
  assert.equal(spaceList[0].message_count, 0);
});

test("getConversationsForContainer excludes deleted conversations", (t) => {
  const db = createDb(t);
  if (!db) return;
  const space = db.createSpace({ name: "Eng" }).space;

  const conv = db.createAgentConversation("Doomed", null, space.id);
  db.db
    .prepare("UPDATE agent_conversations SET deleted_at = datetime('now') WHERE id = ?")
    .run(conv.id);

  assert.equal(db.getConversationsForContainer(space.id, null).length, 0);
});

test("searchNotes filters by folder", (t) => {
  const db = createDb(t);
  if (!db) return;
  const space = db.createSpace({ name: "Eng" }).space;
  const folder = db.createFolder("Docs", space.id).folder;

  db.saveNote("Roadmap planning", "quarterly roadmap", "personal", null, null, folder.id, space.id);
  db.saveNote("Roadmap ideas", "more roadmap", "personal", null, null, null, space.id);

  const spaceHits = db.searchNotes("roadmap", 10, space.id);
  assert.equal(spaceHits.length, 2);

  const folderHits = db.searchNotes("roadmap", 10, space.id, folder.id);
  assert.equal(folderHits.length, 1);
  assert.equal(folderHits[0].folder_id, folder.id);
});

test("getNotesForSpace includes foldered notes, unlike the root-only getNotes", (t) => {
  const db = createDb(t);
  if (!db) return;
  const space = db.createSpace({ name: "Eng" }).space;
  const folder = db.createFolder("Docs", space.id).folder;

  const rootNote = db.saveNote("Root", "", "personal", null, null, null, space.id).note;
  const folderNote = db.saveNote("Foldered", "", "personal", null, null, folder.id, space.id).note;
  db.deleteNote(folderNote.id);
  const keptNote = db.saveNote("Kept", "", "personal", null, null, folder.id, space.id).note;

  const rootOnly = db.getNotes(null, 50, null, space.id);
  assert.deepEqual(
    rootOnly.map((n) => n.id),
    [rootNote.id]
  );

  const all = db.getNotesForSpace(space.id);
  assert.deepEqual(new Set(all.map((n) => n.id)), new Set([rootNote.id, keptNote.id]));
});

test("getNoteIdsInFolder excludes deleted notes", (t) => {
  const db = createDb(t);
  if (!db) return;
  const space = db.createSpace({ name: "Eng" }).space;
  const folder = db.createFolder("Docs", space.id).folder;

  const kept = db.saveNote("Kept", "", "personal", null, null, folder.id, space.id).note;
  const removed = db.saveNote("Removed", "", "personal", null, null, folder.id, space.id).note;
  db.deleteNote(removed.id);

  assert.deepEqual(db.getNoteIdsInFolder(folder.id), [kept.id]);
});

test("upsertNoteFromCloud round-trips updated_by_user_id", (t) => {
  const db = createDb(t);
  if (!db) return;
  const privateId = db.getPrivateSpaceId();

  const cloudNote = {
    id: "cloud-1",
    client_note_id: "client-1",
    title: "Synced",
    content: "body",
    updated_by_user_id: "user-a",
    created_at: "2026-07-01 10:00:00",
    updated_at: "2026-07-01 10:00:00",
  };
  const inserted = db.upsertNoteFromCloud(cloudNote, null, privateId);
  assert.equal(inserted.updated_by_user_id, "user-a");

  const updated = db.upsertNoteFromCloud(
    { ...cloudNote, updated_by_user_id: "user-b", updated_at: "2026-07-02 10:00:00" },
    null,
    privateId
  );
  assert.equal(updated.updated_by_user_id, "user-b");

  // A pull without the field must keep the last known editor.
  const unchanged = db.upsertNoteFromCloud(
    { ...cloudNote, updated_by_user_id: null, updated_at: "2026-07-03 10:00:00" },
    null,
    privateId
  );
  assert.equal(unchanged.updated_by_user_id, "user-b");
});

// Container conversations die with their container (space purge, folder
// delete, revocation): synced rows tombstone so the next push retires the
// cloud copy — a hard local delete would let the next pull resurrect the
// conversation as a global one — while never-synced rows hard-delete
// outright (no server row to retire).

test("purgeSpace retires the space's container conversations", (t) => {
  const db = createDb(t);
  if (!db) return;
  const space = db.createSpace({ name: "Eng" }).space;
  const folder = db.createFolder("Docs", space.id).folder;

  const syncedConv = db.createAgentConversation("Synced", null, space.id);
  db.markConversationSynced(syncedConv.id, "cloud-conv-1");
  const localConv = db.createAgentConversation("Local only", null, space.id, folder.id);
  db.addAgentMessage(localConv.id, "user", "hello");
  const globalConv = db.createAgentConversation("Global");

  assert.equal(db.purgeSpace(space.id).success, true);

  const tombstoned = db.db
    .prepare("SELECT * FROM agent_conversations WHERE id = ?")
    .get(syncedConv.id);
  assert.ok(tombstoned.deleted_at, "synced conversation must tombstone for the delete push");
  assert.equal(tombstoned.sync_status, "pending");

  assert.equal(
    db.db.prepare("SELECT COUNT(*) AS n FROM agent_conversations WHERE id = ?").get(localConv.id).n,
    0
  );
  assert.equal(
    db.db
      .prepare("SELECT COUNT(*) AS n FROM agent_messages WHERE conversation_id = ?")
      .get(localConv.id).n,
    0
  );

  const global = db.db.prepare("SELECT * FROM agent_conversations WHERE id = ?").get(globalConv.id);
  assert.equal(global.deleted_at, null, "unscoped conversations are untouched");
});

test("deleteFolder and hardDeleteFolder retire the folder's conversations", (t) => {
  const db = createDb(t);
  if (!db) return;
  const space = db.createSpace({ name: "Eng" }).space;
  const folder = db.createFolder("Docs", space.id).folder;
  const folderConv = db.createAgentConversation("Folder chat", null, space.id, folder.id);
  const spaceConv = db.createAgentConversation("Space chat", null, space.id);

  assert.equal(db.deleteFolder(folder.id).success, true);
  assert.equal(
    db.db.prepare("SELECT COUNT(*) AS n FROM agent_conversations WHERE id = ?").get(folderConv.id)
      .n,
    0
  );
  assert.equal(db.getConversationsForContainer(space.id, null)[0].id, spaceConv.id);

  const folder2 = db.createFolder("Specs", space.id).folder;
  const conv2 = db.createAgentConversation("Specs chat", null, space.id, folder2.id);
  db.markConversationSynced(conv2.id, "cloud-conv-2");
  db.hardDeleteFolder(folder2.id);
  const tombstoned = db.db.prepare("SELECT * FROM agent_conversations WHERE id = ?").get(conv2.id);
  assert.ok(tombstoned.deleted_at);
  assert.equal(tombstoned.sync_status, "pending");
});

test("relocateRevokedFolder moves or retires the folder's conversations", (t) => {
  const db = createDb(t);
  if (!db) return;
  const privateId = db.getPrivateSpaceId();
  const space = db.createSpace({ name: "Eng" }).space;

  const kept = db.createFolder("Kept", space.id).folder;
  const keptConv = db.createAgentConversation("Kept chat", null, space.id, kept.id);
  assert.equal(db.relocateRevokedFolder(kept.id, privateId, true).success, true);
  const moved = db.db.prepare("SELECT * FROM agent_conversations WHERE id = ?").get(keptConv.id);
  assert.equal(moved.space_id, privateId, "chat follows the preserved folder");
  assert.equal(moved.deleted_at, null);

  const dropped = db.createFolder("Dropped", space.id).folder;
  const droppedConv = db.createAgentConversation("Dropped chat", null, space.id, dropped.id);
  assert.equal(db.relocateRevokedFolder(dropped.id, privateId, false).success, true);
  assert.equal(
    db.db.prepare("SELECT COUNT(*) AS n FROM agent_conversations WHERE id = ?").get(droppedConv.id)
      .n,
    0
  );
});
