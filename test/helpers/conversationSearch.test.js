const test = require("node:test");
const assert = require("node:assert/strict");
const { createDb } = require("./harness/db");

function seed(db, title, messages) {
  const conversation = db.createAgentConversation(title);
  for (const [role, content] of messages) db.addAgentMessage(conversation.id, role, content);
  return conversation;
}

test("keyword search reports the same message count as the conversation list", (t) => {
  const db = createDb(t);
  if (!db) return;

  seed(db, "Trip", [
    ["user", "plan the trip"],
    ["assistant", "which trip?"],
    ["user", "the trip to Lisbon"],
    ["assistant", "trip booked"],
  ]);

  const [listed] = db.getAgentConversationsWithPreview();
  const [found] = db.searchAgentConversations("trip");

  assert.equal(listed.message_count, 4);
  assert.equal(found.message_count, 4, "a title and several message hits must not multiply rows");
  assert.equal(found.last_message, listed.last_message);
});

test("keyword search treats % and _ in the query literally", (t) => {
  const db = createDb(t);
  if (!db) return;

  seed(db, "Budget", [["user", "we hit 100% of the target"]]);
  seed(db, "Other", [["user", "a thousand users"]]);
  seed(db, "snake_case", [["user", "naming"]]);
  seed(db, "snakeXcase", [["user", "naming"]]);

  const titles = (query) => db.searchAgentConversations(query).map((row) => row.title);
  assert.deepEqual(titles("%"), ["Budget"]);
  assert.deepEqual(titles("100%"), ["Budget"]);
  assert.deepEqual(titles("_"), ["snake_case"]);
  assert.deepEqual(titles("snake_case"), ["snake_case"]);
  assert.deepEqual(titles("\\"), []);
});

test("contact search treats % and _ in the query literally", (t) => {
  const db = createDb(t);
  if (!db) return;

  db.upsertContacts([
    { email: "john_doe@example.com", displayName: "John Doe" },
    { email: "johnxdoe@example.com", displayName: "Johnx Doe" },
  ]);

  const emails = (query) => db.searchContacts(query).map((row) => row.email);
  assert.deepEqual(emails("john_doe"), ["john_doe@example.com"]);
  assert.deepEqual(emails("%"), []);
  assert.deepEqual(emails(""), ["john_doe@example.com", "johnxdoe@example.com"]);
});
