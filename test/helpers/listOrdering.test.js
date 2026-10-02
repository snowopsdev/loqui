const test = require("node:test");
const assert = require("node:assert/strict");
const { createDb } = require("./harness/db");

// SQLite's CURRENT_TIMESTAMP has one-second resolution, so rows written in the
// same second tie on every timestamp column. The renderer prepends a new row to
// the list it already holds, so a reload has to put those ties back in the same
// newest-first order.

function pinSameSecond(db, table, column, value) {
  db.db.prepare(`UPDATE ${table} SET ${column} = ?`).run(value);
}

test("transcriptions written in the same second list newest first and keep the newest under a limit", (t) => {
  const db = createDb(t);
  if (!db) return;

  for (const text of ["first", "second", "third", "fourth"]) db.saveTranscription(text);
  pinSameSecond(db, "transcriptions", "timestamp", "2026-01-01 10:00:00");

  assert.deepEqual(
    db.getTranscriptions(10).map((row) => row.text),
    ["fourth", "third", "second", "first"]
  );
  assert.deepEqual(
    db.getTranscriptions(2).map((row) => row.text),
    ["fourth", "third"],
    "a limit must drop the oldest rows, not the newest"
  );
});

test("a later timestamp still outranks a higher id", (t) => {
  const db = createDb(t);
  if (!db) return;

  db.saveTranscription("spoken early, saved late", null, {
    analyticsOccurredAt: "2026-01-01T09:00:00.000Z",
  });
  db.saveTranscription("spoken late", null, { analyticsOccurredAt: "2026-01-01T11:00:00.000Z" });
  db.saveTranscription("spoken middle", null, { analyticsOccurredAt: "2026-01-01T10:00:00.000Z" });

  assert.deepEqual(
    db.getTranscriptions(10).map((row) => row.text),
    ["spoken late", "spoken middle", "spoken early, saved late"]
  );
});

test("notes updated in the same second list newest first in every scope", (t) => {
  const db = createDb(t);
  if (!db) return;

  const folder = db.createFolder("Ideas").folder;
  const spaceId = db.getPrivateSpaceId();
  for (const title of ["a", "b", "c"])
    db.saveNote(title, "body", "personal", null, null, folder.id);
  for (const title of ["d", "e"]) db.saveNote(title, "body");
  pinSameSecond(db, "notes", "updated_at", "2026-01-01 10:00:00");

  assert.deepEqual(
    db.getNotes(null, 100, folder.id).map((note) => note.title),
    ["c", "b", "a"]
  );
  assert.deepEqual(
    db.getNotes().map((note) => note.title),
    ["e", "d", "c", "b", "a"]
  );
  assert.deepEqual(
    db.getNotesForSpace(spaceId).map((note) => note.title),
    ["e", "d", "c", "b", "a"]
  );
});

test("a conversation's preview shows its newest message even within one second", (t) => {
  const db = createDb(t);
  if (!db) return;

  const conversation = db.createAgentConversation("chat");
  db.addAgentMessage(conversation.id, "user", "question");
  db.addAgentMessage(conversation.id, "assistant", "answer");
  pinSameSecond(db, "agent_messages", "created_at", "2026-01-01 10:00:00");

  const [preview] = db.getAgentConversationsWithPreview();
  assert.equal(preview.last_message, "answer");
  assert.equal(preview.last_message_role, "assistant");
  assert.deepEqual(
    db.getAgentMessages(conversation.id).map((message) => message.content),
    ["question", "answer"]
  );
});

test("conversations updated in the same second list newest first", (t) => {
  const db = createDb(t);
  if (!db) return;

  for (const title of ["one", "two", "three"]) db.createAgentConversation(title);
  pinSameSecond(db, "agent_conversations", "updated_at", "2026-01-01 10:00:00");

  const titles = (rows) => rows.map((row) => row.title);
  assert.deepEqual(titles(db.getAgentConversations()), ["three", "two", "one"]);
  assert.deepEqual(titles(db.getAgentConversationsWithPreview()), ["three", "two", "one"]);
});
