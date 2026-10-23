const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { deferred } = require("../helpers/harness/deferred");

const note = (id, folder_id = 2) => ({
  id,
  title: `Fixture ${id}`,
  content: "retained",
  note_type: "personal",
  space_id: 1,
  folder_id,
  deleted_at: null,
});

async function fixture(t, api = {}) {
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        getSpaces: async () => [{ id: 1, kind: "private", name: "Personal" }],
        getFolders: async () => [{ id: 2, space_id: 1, name: "Work", is_default: 1 }],
        getFolderNoteCounts: async () => [],
        getNotes: async (_type, _limit, folder) => [note(folder === null ? 2 : 1, folder)],
        getNote: async () => {
          throw new Error("local read unavailable");
        },
        ...api,
      },
    },
  });
  const vite = await createRendererServer(t);
  return vite.ssrLoadModule("/stores/noteStore.ts");
}

for (const folder of [2, null]) {
  for (const order of ["read-first", "tree-first"]) {
    test(`ordinary ${folder === null ? "root" : "folder"} overview: ${order} rejection and Retry preserve intent`, async (t) => {
      const pending = deferred();
      let reads = 0;
      let retry;
      let missing = 0;
      const store = await fixture(t, {
        getNote: async () => {
          if (++reads === 1) await pending.promise;
          if (reads <= 2) throw new Error("local read unavailable");
          return note(500, folder);
        },
      });
      await store.initializeNotesTree();
      assert.equal(store.getActiveNoteIdValue(), 1, "ordinary startup still selects first note");
      store.navigateToContainer(1, folder);
      const opening = store.openNoteById(500, {
        onMissing: () => missing++,
        onLoadError: (value) => (retry = value),
      });
      if (order === "tree-first") {
        await store.initializeNotesTree();
        assert.equal(store.getActiveNoteIdValue(), null, "pending intentional read owns overview");
      }
      pending.resolve();
      assert.equal(await opening, "error");
      await store.initializeNotesTree();
      assert.equal(
        store.getActiveNoteIdValue(),
        null,
        "failed read must not pick unrelated note 1"
      );
      assert.equal(store.getActiveFolderIdValue(), folder);
      assert.equal(store.getNoteFromStore(500), null);
      assert.equal(missing, 0);
      assert.equal(await retry(), "error");
      await store.initializeNotesTree();
      assert.equal(store.getActiveNoteIdValue(), null);
      assert.equal(await retry(), "opened");
      await store.initializeNotesTree();
      assert.equal(store.getActiveNoteIdValue(), 500);
      assert.equal(store.getActiveFolderIdValue(), folder);
      assert.equal(await retry(), "superseded");
      assert.equal(reads, 3);
    });
  }
}

for (const retirement of ["selection", "overview", "reset", "delete", "unmount"]) {
  test(`ordinary failed read: ${retirement} retires its initializer protection and Retry`, async (t) => {
    let alive = true;
    let retry;
    let deleted;
    let reads = 0;
    const store = await fixture(t, {
      onNoteDeleted: (cb) => {
        deleted = cb;
        return () => {};
      },
      getNote: async () => {
        reads++;
        throw new Error("local read unavailable");
      },
    });
    await store.initializeNotesTree();
    store.navigateToContainer(1, 2);
    assert.equal(
      await store.openNoteById(500, {
        isEligible: () => alive,
        onLoadError: (value) => (retry = value),
      }),
      "error"
    );
    if (retirement === "selection") store.setActiveNoteId(7);
    if (retirement === "overview") store.navigateToContainer(1, null);
    if (retirement === "reset") store.invalidatePendingNoteNavigation();
    if (retirement === "delete") deleted({ id: 500 });
    if (retirement === "unmount") alive = false;
    const generation = store.getNoteNavigationGeneration();
    assert.equal(await retry(), "superseded");
    assert.equal(reads, 1);
    assert.equal(store.getNoteNavigationGeneration(), generation);
    assert.equal(store.getActiveNoteIdValue(), retirement === "selection" ? 7 : null);
    assert.equal(store.getActiveFolderIdValue(), retirement === "overview" ? null : 2);
    // A retired read must not leave a permanent startup prohibition.
    await store.initializeNotesTree();
    assert.equal(
      store.getActiveNoteIdValue(),
      retirement === "selection" ? 7 : retirement === "overview" ? 2 : 1
    );
    assert.equal(store.getNoteFromStore(500), null);
  });
}

for (const target of ["success", "missing"]) {
  test(`ordinary ${target} read retains existing initializer behavior`, async (t) => {
    let missing = 0;
    const store = await fixture(t, {
      getNote: async () => (target === "success" ? note(500) : null),
    });
    await store.initializeNotesTree();
    store.navigateToContainer(1, 2);
    assert.equal(
      await store.openNoteById(500, { onMissing: () => missing++ }),
      target === "success" ? "opened" : "missing"
    );
    await store.initializeNotesTree();
    assert.equal(store.getActiveNoteIdValue(), target === "success" ? 500 : 1);
    assert.equal(missing, target === "missing" ? 1 : 0);
  });
}

for (const newer of ["note", "overview"]) {
  test(`ordinary pending read: newer ${newer} wins over a late rejection without a notice`, async (t) => {
    const pending = deferred();
    let notices = 0;
    const store = await fixture(t, {
      getNote: async () => {
        await pending.promise;
        throw new Error("retired read failure");
      },
    });
    await store.initializeNotesTree();
    store.navigateToContainer(1, 2);
    const opening = store.openNoteById(500, {
      onLoadError: () => notices++,
      onMissing: () => notices++,
    });
    if (newer === "note") assert.equal(await store.openNoteById(1), "opened");
    else store.navigateToContainer(1, null);
    pending.resolve();
    assert.equal(await opening, "superseded");
    assert.equal(store.getActiveNoteIdValue(), newer === "note" ? 1 : null);
    assert.equal(store.getActiveFolderIdValue(), newer === "note" ? 2 : null);
    assert.equal(store.getNoteFromStore(500), null);
    assert.equal(notices, 0);
  });
}
