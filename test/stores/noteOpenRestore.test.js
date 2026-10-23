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

test("final-overview: a rejected explicit read retains the prior overview through tree initialization", async (t) => {
  const { store } = await loadStore(t, {
    getNote: async (id) => {
      if (id === 500) throw new Error("fixture read failure");
      return null;
    },
  });
  assert.equal(await store.restoreLaunchNote(404), "missing");
  assert.equal(await store.openNoteById(500), "error");
  await store.initializeNotesTree();
  assert.equal(
    store.getActiveNoteIdValue(),
    null,
    "failure cannot rearm an incidental first-note pick"
  );
});

for (const method of ["openNoteById", "restoreLaunchNote"]) {
  test(`final lifetime: ${method} retires on owner unmount without newer navigation`, async (t) => {
    const pending = deferred();
    const { store } = await loadStore(t, { getNote: () => pending.promise });
    let alive = true;
    const notices = [];
    const generation = store.getNoteNavigationGeneration();
    const opening = store[method](999, {
      isEligible: () => alive,
      onMissing: () => notices.push("missing"),
      onLoadError: () => notices.push("error"),
    });
    alive = false;
    pending.resolve(note(999));
    assert.equal(await opening, "superseded");
    assert.equal(store.getNoteNavigationGeneration(), generation + 1);
    assert.equal(store.getNoteFromStore(999), null);
    assert.equal(store.getActiveNoteIdValue(), null);
    assert.equal(store.getActiveFolderIdValue(), null);
    assert.deepEqual(notices, []);
  });

  test(`final truth: ${method} preserves selection on rejection and retries only the failed intent`, async (t) => {
    let reads = 0;
    let retry;
    const { store } = await loadStore(t, {
      getNote: async () => {
        if (++reads <= 2) throw new Error("fixture read failed");
        return note(999);
      },
    });
    store.setActiveNoteId(7);
    let missing = 0;
    const options = {
      onMissing: () => missing++,
      onLoadError: (value) => {
        retry = value;
      },
    };
    assert.equal(await store[method](999, options), "error");
    assert.equal(store.getActiveNoteIdValue(), 7);
    assert.equal(missing, 0);
    assert.equal(await retry(), "error");
    assert.equal(await retry(), "opened");
    assert.equal(store.getActiveNoteIdValue(), 999);
    assert.equal(reads, 3);
    assert.equal(await retry(), "superseded", "a completed intent cannot be replayed");
    assert.equal(reads, 3);
  });

  for (const retirement of ["navigation", "reset", "delete", "unmount"]) {
    test(`final retry: ${method} ${retirement} is inert before read or generation claim`, async (t) => {
      let retry;
      let reads = 0;
      let alive = true;
      let deleted;
      const { store } = await loadStore(t, {
        getNote: async () => {
          reads++;
          throw new Error("fixture read failed");
        },
        onNoteDeleted: (cb) => {
          deleted = cb;
          return () => {};
        },
      });
      assert.equal(
        await store[method](999, {
          isEligible: () => alive,
          onLoadError: (value) => {
            retry = value;
          },
        }),
        "error"
      );
      if (retirement === "navigation") store.navigateToContainer(1, null);
      if (retirement === "reset") store.invalidatePendingNoteNavigation();
      if (retirement === "delete") deleted({ id: 999 });
      if (retirement === "unmount") alive = false;
      const generation = store.getNoteNavigationGeneration();
      assert.equal(await retry(), "superseded");
      assert.equal(reads, 1);
      assert.equal(store.getNoteNavigationGeneration(), generation);
    });
  }
}

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

// Exact review round 1 interleavings: the page has already captured old rows.
test("R1 I1: a deferred deep-link page cannot re-cache a deleted note", async (t) => {
  const page = deferred();
  let deleted;
  let exists = true;
  const { store } = await loadStore(t, {
    getNote: async () => (exists ? note(999) : null),
    getNotes: async (_type, _limit, folderId) => (folderId === 2 ? page.promise : []),
    onNoteDeleted: (cb) => {
      deleted = cb;
      return () => {};
    },
  });
  assert.equal(await store.openNoteById(999), "opened");
  exists = false;
  deleted({ id: 999 });
  assert.equal(store.getNoteFromStore(999), null);
  page.resolve([note(999)]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.getNoteFromStore(999), null, "the captured page cannot resurrect the row");
  assert.equal(await store.openNoteById(999), "missing");
  assert.equal(store.getActiveNoteIdValue(), null);
});

test("R1 I2: an old tree page cannot replace a newer space-root overview", async (t) => {
  const page = deferred();
  const requested = deferred();
  const saved = deferred();
  const { store } = await loadStore(t, {
    getNote: () => saved.promise,
    getNotes: async (_type, _limit, folderId) => {
      if (folderId !== 2) return [];
      requested.resolve();
      return page.promise;
    },
  });
  const restore = store.restoreLaunchNote(999);
  const tree = store.initializeNotesTree();
  await requested.promise;
  store.navigateToContainer(1, null);
  saved.resolve(note(999));
  assert.equal(await restore, "superseded");
  page.resolve([note(1)]);
  await tree;
  assert.equal(store.getActiveNoteIdValue(), null);
  assert.equal(store.getActiveFolderIdValue(), null);
});

test("R1 I2: an old tree page cannot select a note from a deleted folder", async (t) => {
  const page = deferred();
  const requested = deferred();
  let folderDeleted;
  let folders = [{ id: 2, space_id: 1, name: "Work", is_default: 1 }];
  const { store } = await loadStore(t, {
    getFolders: async () => folders,
    getNotes: async (_type, _limit, folderId) => {
      if (folderId !== 2) return [];
      requested.resolve();
      return page.promise;
    },
    onFolderDeleted: (cb) => {
      folderDeleted = cb;
      return () => {};
    },
  });
  const tree = store.initializeNotesTree();
  await requested.promise;
  folders = [];
  folderDeleted({ id: 2 });
  page.resolve([note(1)]);
  await tree;
  assert.equal(store.getActiveNoteIdValue(), null);
  assert.equal(store.getNoteFromStore(1), null);
  assert.equal(store.getActiveFolderIdValue(), null);
});

test("R1 I2: the confirmed-reset fence retires a pending tree first-note pick", async (t) => {
  const page = deferred();
  const requested = deferred();
  const { store } = await loadStore(t, {
    getNotes: async (_type, _limit, folderId) => {
      if (folderId !== 2) return [];
      requested.resolve();
      return page.promise;
    },
  });
  const tree = store.initializeNotesTree();
  await requested.promise;
  store.invalidatePendingNoteNavigation(); // The real StorageList admission function.
  page.resolve([note(1)]);
  await tree;
  assert.equal(store.getActiveNoteIdValue(), null);
});

test("R1 I1: deletion fences a page even when the deleted id has never been cached", async (t) => {
  const page = deferred();
  let deleted;
  const { store } = await loadStore(t, {
    getNotes: async (_type, _limit, folderId) => (folderId === 2 ? page.promise : []),
    onNoteDeleted: (cb) => {
      deleted = cb;
      return () => {};
    },
  });
  const loading = store.initializeNotes(null, 50, 2);
  assert.equal(store.getNoteFromStore(999), null);
  deleted({ id: 999 });
  page.resolve([note(999)]);
  assert.deepEqual(await loading, [note(999)], "the public page return contract is preserved");
  assert.equal(store.getNoteFromStore(999), null);
  assert.equal(await store.openNoteById(999), "missing");
});

for (const duringMetadata of [false, true]) {
  test(`R1 validity: tree admission precedes ${duringMetadata ? "metadata" : "page"} await and a newer deliberate overview`, async (t) => {
    const metadata = deferred();
    const requested = deferred();
    const page = deferred();
    const { store } = await loadStore(t, {
      getFolders: () => metadata.promise,
      getNotes: async (_type, _limit, folderId) => {
        if (folderId !== 2) return [];
        requested.resolve();
        return page.promise;
      },
    });
    const tree = store.initializeNotesTree();
    if (!duringMetadata) {
      metadata.resolve([{ id: 2, space_id: 1, name: "Work", is_default: 1 }]);
      await requested.promise;
    }
    store.navigateToContainer(1, duringMetadata ? 2 : null);
    // The same-folder preset can be resolved after metadata, but cannot rearm
    // the earlier tree admission's incidental first-note selection.
    if (duringMetadata) {
      metadata.resolve([{ id: 2, space_id: 1, name: "Work", is_default: 1 }]);
      await requested.promise;
    }
    page.resolve([note(1)]);
    await tree;
    assert.equal(store.getActiveNoteIdValue(), null);
    assert.equal(store.getActiveFolderIdValue(), duringMetadata ? 2 : null);
  });
}

test("R1 validity: tree selection requires its committed page, not a rejected older return", async (t) => {
  const old = deferred();
  const requested = deferred();
  let calls = 0;
  const { store } = await loadStore(t, {
    getNotes: async (_type, _limit, folderId) => {
      if (folderId !== 2) return [];
      if (++calls > 1) return [note(2)];
      requested.resolve();
      return old.promise;
    },
  });
  const tree = store.initializeNotesTree();
  await requested.promise;
  await store.initializeNotes(null, 50, 2);
  old.resolve([note(1)]);
  await tree;
  assert.equal(store.getNoteFromStore(1), null);
  assert.equal(store.getNoteFromStore(2)?.id, 2);
  assert.equal(store.getActiveNoteIdValue(), null, "rejected page cannot select an uncached id");
});

test("R1 validity: a context-only change also prevents the tree's final selection", async (t) => {
  const page = deferred();
  const requested = deferred();
  const { store } = await loadStore(t, {
    getNotes: async (_type, _limit, folderId) => {
      if (folderId !== 2) return [];
      requested.resolve();
      return page.promise;
    },
  });
  const tree = store.initializeNotesTree();
  await requested.promise;
  store.setActiveContext(1, null);
  page.resolve([note(1)]);
  await tree;
  assert.equal(store.getActiveNoteIdValue(), null);
  assert.equal(store.getActiveFolderIdValue(), null);
});

test("R1 validity: deletion fences legacy flat loads and admits a later fresh page", async (t) => {
  const page = deferred();
  let deleted;
  let calls = 0;
  const { store } = await loadStore(t, {
    getNotes: () => (++calls === 1 ? page.promise : Promise.resolve([note(2)])),
    onNoteDeleted: (cb) => {
      deleted = cb;
      return () => {};
    },
  });
  const loading = store.initializeNotes();
  deleted({ id: 999 });
  page.resolve([note(999)]);
  assert.deepEqual(await loading, [note(999)]);
  assert.equal(store.getNoteFromStore(999), null);
  await store.initializeNotes(null, 50, 2);
  assert.equal(store.getNoteFromStore(2)?.id, 2);
});

for (const newerIntent of ["overview", "reset", "note-deleted"]) {
  test(`R1 validity: local folder fallback rechecks ${newerIntent} before selecting`, async (t) => {
    const page = deferred();
    const requested = deferred();
    let folders = [{ id: 2, space_id: 1, name: "Work", is_default: 1 }, ARCHIVE];
    let deleted;
    const { store } = await loadStore(t, {
      getFolders: async () => folders,
      getNotes: async (_type, _limit, folderId) => {
        if (folderId !== 2) return [];
        requested.resolve();
        return page.promise;
      },
      deleteFolder: async () => {
        folders = folders.filter((f) => f.id !== 3);
        return { success: true };
      },
      onNoteDeleted: (cb) => {
        deleted = cb;
        return () => {};
      },
    });
    store.setActiveFolderId(3);
    await store.initializeNotesTree();
    const removing = store.deleteFolder(3);
    await requested.promise;
    assert.equal(store.getActiveFolderIdValue(), 2);
    if (newerIntent === "overview") store.navigateToContainer(1, null);
    else if (newerIntent === "reset") store.invalidatePendingNoteNavigation();
    else deleted({ id: 1 });
    page.resolve([note(1)]);
    await removing;
    assert.equal(store.getActiveNoteIdValue(), null);
    assert.equal(store.getActiveFolderIdValue(), newerIntent === "overview" ? null : 2);
    if (newerIntent === "note-deleted") assert.equal(store.getNoteFromStore(1), null);
  });
}
