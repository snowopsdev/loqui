const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

test("notes restore from the local database and local broadcasts update the active note", async (t) => {
  const note = {
    id: 9,
    space_id: 1,
    folder_id: 2,
    title: "Local meeting",
    content: "Original",
    note_type: "meeting",
  };
  let updatedListener;
  installBrowserGlobals(t, {
    initialStorage: { "notesTree.expanded": '["s:1","f:2"]' },
    window: {
      electronAPI: {
        getSpaces: async () => [{ id: 1, kind: "private", name: "Personal" }],
        getFolders: async () => [{ id: 2, space_id: 1, name: "Meetings", is_default: 1 }],
        getFolderNoteCounts: async () => [{ folder_id: 2, space_id: 1, count: 1 }],
        getNotes: async (_type, _limit, folderId) => (folderId === 2 ? [note] : []),
        onNoteUpdated: (callback) => {
          updatedListener = callback;
          return () => {};
        },
      },
    },
  });
  const vite = await createRendererServer(t);
  const store = await vite.ssrLoadModule("/stores/noteStore.ts");
  await store.initializeNotesTree();
  assert.equal(store.getActiveNoteIdValue(), 9);
  assert.equal(store.getNoteFromStore(9).content, "Original");
  updatedListener({ ...note, content: "Edited locally" });
  assert.equal(store.getNoteFromStore(9).content, "Edited locally");
  assert.equal(store.getSpacesValue().length, 1);
  assert.equal(store.getActiveFolderIdValue(), 2);
});

test("failed local folder writes do not appear as saved folders", async (t) => {
  installBrowserGlobals(t, {
    window: { electronAPI: { createFolder: async () => ({ success: false, error: "Disk full" }) } },
  });
  const vite = await createRendererServer(t);
  const store = await vite.ssrLoadModule("/stores/noteStore.ts");
  assert.deepEqual(await store.createFolder("Unwritten", 1), {
    success: false,
    error: "Disk full",
  });
  assert.deepEqual(store.getFoldersValue(), []);
});
