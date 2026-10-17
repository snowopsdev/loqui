const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const note = (id, over = {}) => ({
  id,
  title: `Note ${id}`,
  content: "",
  note_type: "personal",
  space_id: 1,
  folder_id: 2,
  deleted_at: null,
  ...over,
});
// The first page of the default folder: ids 1–50. Note 999 is older and outside it.
const FIRST_PAGE = Array.from({ length: 50 }, (_, i) => note(i + 1));
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

async function loadStore(t, api = {}) {
  const calls = { getNotes: 0, getNote: 0 };
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        getSpaces: async () => [{ id: 1, kind: "private", name: "Personal" }],
        getFolders: async () => [{ id: 2, space_id: 1, name: "Work", is_default: 1 }],
        getFolderNoteCounts: async () => [],
        getNotes: async (_type, _limit, folderId) => {
          calls.getNotes += 1;
          return folderId === 2 ? FIRST_PAGE : [];
        },
        getNote: async () => null,
        ...api,
      },
    },
  });
  const vite = await createRendererServer(t);
  const store = await vite.ssrLoadModule("/stores/noteStore.ts");
  return { store, calls };
}

test("a deep link opens a note older than the first page, and the editor can read it", async (t) => {
  const { store } = await loadStore(t, { getNote: async (id) => (id === 999 ? note(999) : null) });
  await store.initializeNotesTree();
  assert.equal(await store.openNoteById(999), "opened");
  assert.equal(store.getActiveNoteIdValue(), 999);
  assert.equal(store.getNoteFromStore(999)?.title, "Note 999");
  assert.equal(store.getActiveFolderIdValue(), 2);
});

test("a note in an already-cached container opens without refetching", async (t) => {
  const { store, calls } = await loadStore(t);
  await store.initializeNotesTree();
  const before = { ...calls };
  assert.equal(await store.openNoteById(5), "opened");
  assert.equal(store.getActiveNoteIdValue(), 5);
  assert.deepEqual(calls, before);
});

test("a folderless note opens at its space root", async (t) => {
  const { store } = await loadStore(t, { getNote: async () => note(7, { folder_id: null }) });
  assert.equal(await store.openNoteById(7), "opened");
  assert.equal(store.getActiveFolderIdValue(), null);
  assert.equal(store.getNoteFromStore(7)?.id, 7);
});

test("a missing note changes nothing", async (t) => {
  const { store } = await loadStore(t);
  await store.initializeNotesTree();
  const before = store.getActiveNoteIdValue();
  assert.equal(await store.openNoteById(404), "missing");
  assert.equal(store.getActiveNoteIdValue(), before);
});

test("an IPC delete of an opened older note clears it from the editor", async (t) => {
  let deleted;
  const { store } = await loadStore(t, {
    getNote: async () => note(999),
    onNoteDeleted: (cb) => {
      deleted = cb;
      return () => {};
    },
  });
  await store.initializeNotesTree();
  await store.openNoteById(999);
  deleted({ id: 999 });
  assert.equal(store.getNoteFromStore(999), null);
  assert.equal(store.getActiveNoteIdValue(), null);
});

// N01: main deletes a folder's notes and broadcasts only folder-deleted.
const ARCHIVE = { id: 3, space_id: 1, name: "Archive", is_default: 0 };

test("deleting the folder of an opened older note evicts it, by broadcast (N01)", async (t) => {
  let folderDeleted;
  let rowExists = true;
  const { store } = await loadStore(t, {
    getFolders: async () => [{ id: 2, space_id: 1, name: "Work", is_default: 1 }, ARCHIVE],
    getNote: async (id) => (id === 999 && rowExists ? note(999, { folder_id: 3 }) : null),
    onFolderDeleted: (cb) => {
      folderDeleted = cb;
      return () => {};
    },
  });
  await store.initializeNotesTree();
  assert.equal(await store.openNoteById(999), "opened");
  rowExists = false; // main deleted the folder and its notes
  folderDeleted({ id: 3 });
  assert.equal(store.getNoteFromStore(999), null, "the editor can no longer resolve it");
  assert.notEqual(store.getActiveNoteIdValue(), 999);
  assert.equal(
    await store.openNoteById(999),
    "missing",
    "a later reopen asks main and reports missing"
  );
});

test("deleting the folder of an opened older note evicts it, locally (N01)", async (t) => {
  let folders = [{ id: 2, space_id: 1, name: "Work", is_default: 1 }, ARCHIVE];
  let rowExists = true;
  const { store } = await loadStore(t, {
    getFolders: async () => folders,
    getNote: async (id) => (id === 999 && rowExists ? note(999, { folder_id: 3 }) : null),
    deleteFolder: async (id) => {
      folders = folders.filter((f) => f.id !== id);
      rowExists = false;
      return { success: true };
    },
  });
  await store.initializeNotesTree();
  await store.openNoteById(999);
  assert.deepEqual(await store.deleteFolder(3), { success: true });
  assert.equal(store.getNoteFromStore(999), null);
  assert.notEqual(store.getActiveNoteIdValue(), 999);
  assert.equal(await store.openNoteById(999), "missing");
});

test("launch restore wins over the tree's first-note pick when the tree loads first", async (t) => {
  const pending = deferred();
  const { store } = await loadStore(t, { getNote: () => pending.promise });
  const restore = store.restoreLaunchNote(999);
  await store.initializeNotesTree();
  assert.equal(store.getActiveNoteIdValue(), null, "no incidental first-note pick while restoring");
  pending.resolve(note(999));
  assert.equal(await restore, "opened");
  assert.equal(store.getActiveNoteIdValue(), 999);
});

test("launch restore wins when the saved note loads first", async (t) => {
  const { store } = await loadStore(t, { getNote: async () => note(999) });
  assert.equal(await store.restoreLaunchNote(999), "opened");
  await store.initializeNotesTree();
  assert.equal(store.getActiveNoteIdValue(), 999);
});

test("a deleted saved note lands on the overview, even after the Notes view initialises again", async (t) => {
  const { store } = await loadStore(t);
  assert.equal(await store.restoreLaunchNote(999), "missing");
  await store.initializeNotesTree();
  await store.initializeNotesTree();
  assert.equal(store.getActiveNoteIdValue(), null);
  store.setActiveNoteId(3);
  assert.equal(store.getActiveNoteIdValue(), 3, "a deliberate pick still works");
});

test("pending native navigation during a restore takes precedence", async (t) => {
  const pending = deferred();
  const { store } = await loadStore(t, { getNote: () => pending.promise });
  const restore = store.restoreLaunchNote(999);
  store.setActiveNoteId(5); // what ControlPanel's pending-note drains do
  pending.resolve(note(999));
  assert.equal(await restore, "superseded");
  assert.equal(store.getActiveNoteIdValue(), 5);
});

for (const method of ["openNoteById", "restoreLaunchNote"]) {
  test(`${method}: a deletion broadcast supersedes a deferred getNote before caching`, async (t) => {
    const pending = deferred();
    let deleted;
    const { store } = await loadStore(t, {
      getNote: () => pending.promise,
      onNoteDeleted: (cb) => {
        deleted = cb;
        return () => {};
      },
    });
    await store.initializeNotesTree();
    const opening = store[method](999);
    deleted({ id: 999 }); // Not present in any page or opened cache yet.
    pending.resolve(note(999));
    assert.equal(await opening, "superseded");
    assert.equal(store.getNoteFromStore(999), null);
    assert.equal(store.getActiveNoteIdValue(), 1);
  });

  for (const local of [false, true]) {
    test(`${method}: ${local ? "local" : "broadcast"} folder deletion fences a deferred getNote`, async (t) => {
      const pending = deferred();
      let folderDeleted;
      const { store } = await loadStore(t, {
        getFolders: async () => [{ id: 2, space_id: 1, name: "Work", is_default: 1 }, ARCHIVE],
        getNote: () => pending.promise,
        deleteFolder: async () => ({ success: true }),
        onFolderDeleted: (cb) => {
          folderDeleted = cb;
          return () => {};
        },
      });
      await store.initializeNotesTree();
      const opening = store[method](999);
      if (local) await store.deleteFolder(3);
      else folderDeleted({ id: 3 });
      store.setActiveNoteId(5);
      pending.resolve(note(999, { folder_id: 3 }));
      assert.equal(await opening, "superseded");
      assert.equal(store.getNoteFromStore(999), null);
      assert.equal(store.getActiveNoteIdValue(), 5);
      assert.equal(store.getActiveFolderIdValue(), 2);
    });
  }

  test(`${method}: newer container navigation keeps its overview and context`, async (t) => {
    const pending = deferred();
    const { store } = await loadStore(t, { getNote: () => pending.promise });
    await store.initializeNotesTree();
    const opening = store[method](999);
    store.navigateToContainer(1, null);
    pending.resolve(note(999));
    assert.equal(await opening, "superseded");
    assert.equal(store.getActiveNoteIdValue(), null);
    assert.equal(store.getActiveFolderIdValue(), null);
    assert.equal(store.getNoteFromStore(999), null);
  });
}

test("the latest of two deferred opens owns selection and cache", async (t) => {
  const first = deferred();
  const second = deferred();
  const { store } = await loadStore(t, {
    getNote: (id) => (id === 998 ? first.promise : second.promise),
  });
  const a = store.openNoteById(998);
  const b = store.openNoteById(999);
  second.resolve(note(999));
  assert.equal(await b, "opened");
  first.resolve(note(998));
  assert.equal(await a, "superseded");
  assert.equal(store.getNoteFromStore(998), null);
  assert.equal(store.getActiveNoteIdValue(), 999);
});

test("an opened older note stays current when updated or moved", async (t) => {
  let updated;
  let folderDeleted;
  const { store } = await loadStore(t, {
    getNote: async () => note(999, { folder_id: 3 }),
    onNoteUpdated: (cb) => {
      updated = cb;
      return () => {};
    },
    onFolderDeleted: (cb) => {
      folderDeleted = cb;
      return () => {};
    },
  });
  await store.initializeNotesTree();
  await store.openNoteById(999);
  updated(note(999, { folder_id: null, title: "Moved" }));
  folderDeleted({ id: 3 });
  assert.equal(store.getNoteFromStore(999)?.title, "Moved");
  assert.equal(await store.openNoteById(999), "opened");
  assert.equal(store.getActiveFolderIdValue(), null);
});

for (const local of [false, true]) {
  test(`folder ${local ? "local deletion" : "broadcast"} also fences the page load started by a deep link`, async (t) => {
    const page = deferred();
    let folderDeleted;
    const { store } = await loadStore(t, {
      getFolders: async () => [{ id: 2, space_id: 1, name: "Work", is_default: 1 }, ARCHIVE],
      getNote: async () => note(999, { folder_id: 3 }),
      getNotes: async (_type, _limit, folderId) => (folderId === 3 ? page.promise : []),
      deleteFolder: async () => ({ success: true }),
      onFolderDeleted: (cb) => {
        folderDeleted = cb;
        return () => {};
      },
    });
    await store.initializeNotesTree();
    await store.openNoteById(999);
    if (local) await store.deleteFolder(3);
    else folderDeleted({ id: 3 });
    page.resolve([note(999, { folder_id: 3 })]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      store.getNoteFromStore(999),
      null,
      "the old container page cannot repopulate the editor cache"
    );
    assert.notEqual(store.getActiveNoteIdValue(), 999);
  });
}
