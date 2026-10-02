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
