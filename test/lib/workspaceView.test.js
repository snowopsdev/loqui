const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/workspaceView.ts");

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

test("first launch opens Home with no note", async () => {
  const { readPersistedWorkspace } = await load();
  assert.deepEqual(readPersistedWorkspace(memoryStorage()), { view: "home", noteId: null });
  assert.deepEqual(readPersistedWorkspace(null), { view: "home", noteId: null });
});

test("a saved view and note are restored", async () => {
  const { readPersistedWorkspace, WORKSPACE_VIEW_KEY, WORKSPACE_NOTE_KEY } = await load();
  const storage = memoryStorage({
    [WORKSPACE_VIEW_KEY]: "personal-notes",
    [WORKSPACE_NOTE_KEY]: "42",
  });
  assert.deepEqual(readPersistedWorkspace(storage), { view: "personal-notes", noteId: 42 });
});

test("an unknown view id or a junk note id falls back safely", async () => {
  const { readPersistedWorkspace, WORKSPACE_VIEW_KEY, WORKSPACE_NOTE_KEY } = await load();
  for (const [view, note] of [
    ["timeline", "42"],
    ["chat", "-3"],
    ["chat", "1.5"],
    ["chat", "abc"],
    ["chat", ""],
  ]) {
    const result = readPersistedWorkspace(
      memoryStorage({ [WORKSPACE_VIEW_KEY]: view, [WORKSPACE_NOTE_KEY]: note })
    );
    assert.equal(result.view, view === "timeline" ? "home" : "chat", view);
    assert.equal(result.noteId, view === "timeline" ? 42 : null, `${view}/${note}`);
  }
});

test("storage that throws is treated as empty", async () => {
  const { readPersistedWorkspace, writePersistedWorkspace } = await load();
  const hostile = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
    removeItem: () => {},
  };
  assert.deepEqual(readPersistedWorkspace(hostile), { view: "home", noteId: null });
  assert.doesNotThrow(() => writePersistedWorkspace(hostile, { view: "chat", noteId: 1 }));
});

test("writing a null note removes the key", async () => {
  const { writePersistedWorkspace, WORKSPACE_NOTE_KEY } = await load();
  const storage = memoryStorage({ [WORKSPACE_NOTE_KEY]: "7" });
  writePersistedWorkspace(storage, { view: "home", noteId: null });
  assert.deepEqual(storage.dump(), { "workspace.activeView": "home" });
});
