const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/lib/noteEditorPendingSave.ts");

test("returns no update when the editor has no pending timers", async () => {
  const { buildPendingNoteUpdates } = await load();

  assert.equal(
    buildPendingNoteUpdates({
      title: "Title",
      content: "Body",
      enhancedContent: "Enhanced",
      documentPending: false,
      enhancedPending: false,
      bufferOwnerId: 5,
      targetNoteId: 5,
    }),
    null
  );
});

test("flushes only the editor buffers represented by pending timers", async () => {
  const { buildPendingNoteUpdates } = await load();
  const snapshot = {
    title: "Latest title",
    content: "Latest body",
    enhancedContent: "Latest enhancement",
    bufferOwnerId: 5,
    targetNoteId: 5,
  };

  assert.deepEqual(
    buildPendingNoteUpdates({
      ...snapshot,
      documentPending: true,
      enhancedPending: false,
    }),
    { title: "Latest title", content: "Latest body" }
  );
  assert.deepEqual(
    buildPendingNoteUpdates({
      ...snapshot,
      documentPending: false,
      enhancedPending: true,
    }),
    { enhanced_content: "Latest enhancement" }
  );
  assert.deepEqual(
    buildPendingNoteUpdates({
      ...snapshot,
      documentPending: true,
      enhancedPending: true,
    }),
    {
      title: "Latest title",
      content: "Latest body",
      enhanced_content: "Latest enhancement",
    }
  );
});

test("never writes a buffer to a note it does not belong to", async () => {
  const { buildPendingNoteUpdates } = await load();

  // The editor buffer still holds note A's content while the active-note ref
  // has already been repointed at the freshly created note B. A flush here
  // must write nothing, otherwise B silently fills with A's text.
  assert.equal(
    buildPendingNoteUpdates({
      title: "A's title",
      content: "A's body",
      enhancedContent: "A's enhancement",
      documentPending: true,
      enhancedPending: true,
      bufferOwnerId: 1,
      targetNoteId: 2,
    }),
    null
  );
});

test("deleting another sidebar note keeps the active note's pending save", async () => {
  const { shouldCancelPendingSavesForDelete } = await load();

  assert.equal(shouldCancelPendingSavesForDelete(17, 23), false);
  assert.equal(shouldCancelPendingSavesForDelete(17, 17), true);
  assert.equal(shouldCancelPendingSavesForDelete(null, 17), false);
});
