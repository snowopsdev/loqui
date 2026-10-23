const assert = require("node:assert/strict");
const test = require("node:test");
// Exercises helpers/database via the isolated DB harness (native test-runner group).
const { createDb } = require("../helpers/harness/db");
// Scoped CommonJS transform avoids Node's ambiguous-package ESM reparse, without
// installing the global ESM loader worker beside the native SQLite binding.
const { require: requireTS } = require("tsx/cjs/api");
const load = () => requireTS("../../src/preview/previewTable.ts", __filename);

async function fixture(t) {
  const { createPreviewTable } = await load();
  const db = createDb(t);
  assert.ok(db, "prepared Node native binding is required for the parity fixture");
  const spaceId = db.getPrivateSpaceId();
  assert.equal(spaceId, 1, "browser preview's single sample Space");
  const notes = [db.saveNote("A", "x".repeat(650), "personal", null, null, null, spaceId).note];
  const d = db.saveTranscription("hi", "hi");
  const history = [db.getTranscriptionById(d.id)];
  const api = createPreviewTable({ notes: () => notes, history: () => history });
  const n = { type: "note", id: notes[0].id },
    h = { type: "dictation", id: d.id };
  return { db, spaceId, notes, history, api, n, h };
}
async function sameBoard(c) {
  assert.deepEqual(await c.api.getTableBoard(c.spaceId), c.db.getTableBoard(c.spaceId));
}

test("bounded note/dictation fixture matches main for fresh, place, hide, restore and canonical links", async (t) => {
  const c = await fixture(t);
  await sameBoard(c);
  for (const [method, args] of [
    [
      "placeTableCards",
      [
        [
          { ...c.n, x: 40, y: 48 },
          { type: "note", id: 9999, x: 0, y: 0 },
        ],
      ],
    ],
    ["hideTableCards", [[c.n, c.n, { type: "note", id: 9999 }]]],
    ["placeTableCards", [[{ ...c.h, x: 0, y: 0 }]]],
    ["linkTableCards", [c.h, c.n]],
    ["linkTableCards", [c.n, c.h]],
    ["linkTableCards", [c.n, c.n]],
    ["linkTableCards", [c.n, { type: "dictation", id: 9999 }]],
    ["placeTableCards", [[{ ...c.n, x: 80, y: 96 }]]],
  ]) {
    assert.deepEqual(await c.api[method](1, ...args), c.db[method](1, ...args), method);
    await sameBoard(c);
  }
  assert.equal(c.notes[0].content.length, 650, "remove preserves complete source content");
  assert.equal(c.history[0].text, "hi");
});
test("exercised nullable sizing, finite refusal, coordinate and viewport limits agree with main", async (t) => {
  const c = await fixture(t);
  const batches = [
    [
      { ...c.n, x: 2e6, y: -2e6, w: 9000, h: -4, z: 1.5 },
      { ...c.h, x: NaN, y: 0 },
    ],
    [{ ...c.n, x: 40, y: 48, w: null, h: null }],
    [
      { ...c.n, x: 80, y: 96, w: 300, h: 80, z: 2 },
      { ...c.n, x: 88, y: 104, w: 300, h: 80, z: 3 },
    ],
    [
      { ...c.n, x: Infinity, y: 0 },
      { type: "chat", id: 9999, x: 0, y: 0 },
    ],
    [{ ...c.n, x: 0, y: 0, w: 0, h: Infinity }],
  ];
  for (const placements of batches) {
    assert.deepEqual(
      await c.api.placeTableCards(1, placements),
      c.db.placeTableCards(1, placements)
    );
    await sameBoard(c);
  }
  for (const viewport of [
    { x: -2e6, y: 2e6, scale: 9 },
    { x: 1, y: 2, scale: 0.01 },
    { x: NaN, y: 1, scale: 1 },
  ]) {
    assert.deepEqual(await c.api.setTableViewport(1, viewport), c.db.setTableViewport(1, viewport));
    await sameBoard(c);
  }
});
test("preview reads current sample arrays, stays in memory, and refuses unsupported Spaces", async () => {
  const { createPreviewTable } = await load();
  let notes = [{ id: 1, title: "A", content: "body", note_type: "personal", updated_at: "t" }];
  const source = { notes: () => notes, history: () => [] };
  const api = createPreviewTable(source);
  notes = [...notes, { ...notes[0], id: 2, title: "New" }];
  assert.equal((await api.getTableBoard(1)).cards.length, 2);
  await api.placeTableCards(1, [{ type: "note", id: 2, x: 8, y: 16 }]);
  assert.equal((await createPreviewTable(source).getTableBoard(1)).cards[1].layout, null);
  assert.deepEqual((await api.getTableBoard(2)).cards, []);
  assert.deepEqual(await api.placeTableCards(2, [{ type: "note", id: 1, x: 0, y: 0 }]), {
    success: false,
    code: "INVALID",
  });
  assert.equal((await api.hideTableCards(2, [{ type: "note", id: 1 }])).success, false);
  assert.equal(
    (await api.linkTableCards(2, { type: "note", id: 1 }, { type: "note", id: 2 })).success,
    false
  );
  assert.equal((await api.setTableViewport(2, { x: 0, y: 0, scale: 1 })).success, false);
});
