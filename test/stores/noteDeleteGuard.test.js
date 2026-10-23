const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/stores/noteDeleteGuard.ts");

test("the open editor cancels its pending save before a tree delete", async () => {
  const { setBeforeNoteDelete, runBeforeNoteDelete } = await load();
  const seen = [];
  const release = setBeforeNoteDelete((id) => seen.push(id));
  runBeforeNoteDelete(9);
  release();
  runBeforeNoteDelete(10);
  assert.deepEqual(seen, [9]);
});

test("a stale cleanup never removes a newer guard", async () => {
  const { setBeforeNoteDelete, runBeforeNoteDelete } = await load();
  const seen = [];
  const releaseOld = setBeforeNoteDelete(() => seen.push("old"));
  setBeforeNoteDelete(() => seen.push("new"));
  releaseOld();
  runBeforeNoteDelete(1);
  assert.deepEqual(seen, ["new"]);
});
