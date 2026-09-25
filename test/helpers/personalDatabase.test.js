const test = require("node:test");
const assert = require("node:assert/strict");
const { createDb } = require("./harness/db");
const DatabaseManager = require("../../src/helpers/database");

test("personal content, FTS, and conversation messages survive reopening without an account", (t) => {
  const db = createDb(t);
  if (!db) return;
  const folder = db.createFolder("Projects").folder;
  const note = db.saveNote(
    "Notebook",
    "searchable aardvark",
    "personal",
    null,
    null,
    folder.id
  ).note;
  db.updateNote(note.id, { content: "updated aardvark" });
  assert.equal(db.searchNotes("aardvark").length, 1);
  const chat = db.createAgentConversation("Chat", note.id);
  db.addAgentMessage(chat.id, "user", "hello");
  db.applyDictionaryChanges({ add: ["Whispr"] });
  db.setSnippets([{ trigger: "hi", replacement: "hello there" }]);
  const meeting = db.saveNote("Meeting", "participants", "meeting").note;
  db.updateNote(meeting.id, { transcript: "A useful meeting", diarization_enabled: 1 });
  db.db.close();
  const reopened = new DatabaseManager();
  t.after(() => reopened.db.close());
  assert.equal(reopened.getNote(note.id).content, "updated aardvark");
  assert.equal(reopened.getNote(meeting.id).transcript, "A useful meeting");
  assert.equal(reopened.getAgentMessages(chat.id).length, 1);
  assert.deepEqual(reopened.getDictionary(), ["Whispr"]);
  assert.equal(reopened.getSnippets().length, 1);
  assert.equal(reopened.searchNotes("aardvark").length, 1);
  assert.equal(reopened.getConversationByClientId(chat.client_conversation_id).id, chat.id);
});

test("local deletion removes notes, FTS matches, speakers and conversations without a pending queue", (t) => {
  const db = createDb(t);
  if (!db) return;
  const folder = db.createFolder("Disposable").folder;
  const note = db.saveNote("Meeting", "temporary aardvark", "meeting", null, null, folder.id).note;
  const chat = db.createAgentConversation("Chat", note.id);
  db.addAgentMessage(chat.id, "user", "hello");
  db.setSpeakerMapping(note.id, "speaker-1", null, "Speaker");
  const result = db.deleteFolder(folder.id);
  assert.equal(result.success, true);
  assert.deepEqual(result.noteIds, [note.id]);
  assert.equal(db.getNote(note.id), null);
  assert.equal(db.getAgentConversation(chat.id), null);
  assert.deepEqual(db.searchNotes("aardvark"), []);
  for (const table of ["speaker_mappings", "agent_messages"]) {
    assert.equal(db.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
  }
  assert.equal(db.deleteFolder(db.getMeetingsFolder().id).success, false);
});

test("schema contains one personal workspace and no hosted identity, sharing or synchronization state", (t) => {
  const db = createDb(t);
  if (!db) return;
  assert.equal(db.getSpaces().length, 1);
  assert.equal(db.getSpaces()[0].kind, "private");
  const schema = db.db
    .prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL")
    .all()
    .map((row) => row.sql)
    .join("\n");
  assert.doesNotMatch(
    schema,
    /\b(cloud_id|sync_status|space_accounts|cloud_team_id|account_id|share_token|owner_user_id)\b/
  );
  assert.equal(typeof db.upsertNoteFromCloud, "undefined");
  assert.equal(typeof db.getPendingNotes, "undefined");
  assert.equal(db.createFolder("Same name").success, true);
  assert.equal(db.createFolder("Same name").success, false);
});

test("local analytics stay idempotent and clearing history leaves no deletion tombstones", (t) => {
  const db = createDb(t);
  if (!db) return;
  const event = {
    eventId: "local-event",
    wordCount: 4,
    occurredAt: "2026-09-18T12:00:00Z",
    localDate: "2026-09-18",
    spokenDurationMs: 2000,
  };
  db.saveTranscription("four words for testing");
  db.recordAnalyticsEvent(event);
  db.recordAnalyticsEvent(event);
  assert.equal(db.getAnalyticsSummary().totalDictations, 1);
  db.clearTranscriptions();
  assert.equal(db.getTranscriptions().length, 0);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM analytics_events").get().count, 0);
  db.recordAnalyticsEvent(event);
  assert.equal(db.getAnalyticsSummary().totalDictations, 0);
});

test("snippets retain stable local identity, deduplicate, and physically delete removed rows", (t) => {
  const db = createDb(t);
  if (!db) return;
  db.setSnippets([
    { trigger: " hi ", replacement: " Hello " },
    { trigger: "HI", replacement: "duplicate" },
  ]);
  const original = db.db.prepare("SELECT * FROM snippets").get();
  db.setSnippets([{ trigger: "hi", replacement: "Good morning" }]);
  assert.equal(db.db.prepare("SELECT * FROM snippets").get().id, original.id);
  assert.deepEqual(db.getSnippets(), [{ trigger: "hi", replacement: "Good morning" }]);
  db.setSnippets([]);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM snippets").get().count, 0);
  db.applyDictionaryChanges({ add: ["Alpha", "Beta"] });
  db.applyDictionaryChanges({ remove: ["Alpha"] });
  assert.deepEqual(db.getDictionary(), ["Beta"]);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM custom_dictionary").get().count, 1);
});

test("folder and workspace conversations stay scoped while global chats remain separate", (t) => {
  const db = createDb(t);
  if (!db) return;
  const spaceId = db.getPrivateSpaceId();
  const folder = db.createFolder("Context").folder;
  const note = db.saveNote("Searchable", "falcon content", "personal", null, null, folder.id).note;
  const scoped = db.createAgentConversation("Folder conversation", null, spaceId, folder.id);
  const root = db.createAgentConversation("Workspace conversation", null, spaceId);
  const global = db.createAgentConversation("Global conversation");
  assert.deepEqual(
    db.getConversationsForContainer(spaceId, folder.id).map((row) => row.id),
    [scoped.id]
  );
  assert.deepEqual(
    db.getConversationsForContainer(spaceId).map((row) => row.id),
    [root.id]
  );
  assert.deepEqual(
    db.getAgentConversations().map((row) => row.id),
    [global.id]
  );
  assert.deepEqual(
    db.searchNotes("falcon", 50, spaceId, folder.id).map((row) => row.id),
    [note.id]
  );
  assert.deepEqual(db.getNoteIdsInScope(spaceId, folder.id, [note.id, 999]), [note.id]);
  assert.equal(db.createAgentConversation("stale", 999), null);
});
