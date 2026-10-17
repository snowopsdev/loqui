const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { deferred } = require("../helpers/harness/deferred");

const original = {
  id: 9,
  title: "Draft",
  content: "Unsaved content stays owned by editor",
  space_id: 1,
  folder_id: 2,
};
async function mount(t, overrides = {}) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const updates = [];
  const events = [];
  const toasts = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        getSpaces: async () => [{ id: 1, kind: "private" }],
        getFolders: async () => [{ id: 2, space_id: 1, name: "Existing" }],
        getFolderNoteCounts: async () => [],
        getSpaceNotes: async () => [],
        getNotes: async (_kind, _limit, folderId) => (folderId === 2 ? [original] : []),
        updateNote: async (...args) => {
          updates.push(args);
          return { success: true };
        },
        deleteNote: async (id) => {
          events.push(["delete", id]);
          return { success: true };
        },
        ...overrides,
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": "const t = key => key; export const useTranslation = () => ({ t });",
    },
  });
  const notes = await vite.ssrLoadModule("/stores/noteStore.ts");
  await notes.initializeNotesTree();
  notes.setActiveContext(1, 2);
  notes.setActiveNoteId(9);
  const { ToastContext } = await vite.ssrLoadModule("/components/ui/useToast.ts");
  const { useNoteTreeActions } = await vite.ssrLoadModule("/hooks/useNoteTreeActions.ts");
  const guard = await vite.ssrLoadModule("/stores/noteDeleteGuard.ts");
  let hook;
  function Probe() {
    hook = useNoteTreeActions();
    return null;
  }
  root = createRoot(container);
  await React.act(async () =>
    root.render(
      React.createElement(
        ToastContext.Provider,
        { value: { toast: (v) => toasts.push(v) } },
        React.createElement(Probe)
      )
    )
  );
  return { hook: () => hook, notes, updates, toasts, events, guard };
}

test("deferred create moves exactly once to returned authoritative folder, absent from old lookup", async (t) => {
  const create = deferred();
  const h = await mount(t, { createFolder: () => create.promise });
  let pending;
  await React.act(async () => {
    pending = h.hook().onCreateFolderAndMove(9, "New");
  });
  assert.equal(h.updates.length, 0);
  await React.act(async () => {
    create.resolve({ success: true, folder: { id: 88, space_id: 3, name: "New" } });
    await pending;
  });
  assert.deepEqual(h.updates, [[9, { folder_id: 88, space_id: 3 }]]);
  assert.equal(h.notes.getActiveFolderIdValue(), 88);
});

test("failed deferred create visibly reports error and leaves note and selection unchanged", async (t) => {
  const create = deferred();
  const h = await mount(t, { createFolder: () => create.promise });
  const before = h.notes.getNoteFromStore(9);
  const pending = h.hook().onCreateFolderAndMove(9, "New");
  await React.act(async () => {
    create.resolve({ success: false, error: "Fixture disk full" });
    await pending;
  });
  assert.deepEqual(h.toasts, [
    {
      title: "notes.folders.couldNotCreate",
      description: "Fixture disk full",
      variant: "destructive",
    },
  ]);
  assert.equal(h.updates.length, 0);
  assert.deepEqual(h.notes.getNoteFromStore(9), before);
  assert.equal(h.notes.getActiveFolderIdValue(), 2);
});

for (const intent of ["other-note", "overview", "view", "A-B-A"]) {
  test(`deferred move respects newer ${intent} intent`, async (t) => {
    const update = deferred();
    const h = await mount(t, { updateNote: () => update.promise });
    const pending = h.hook().onMoveNote(9, { spaceId: 1, folderId: 88 });
    await React.act(async () => {
      if (intent === "view") h.notes.invalidatePendingNoteNavigation();
      else if (intent === "overview") h.notes.navigateToContainer(1, null);
      else {
        h.notes.setActiveNoteId(10);
        if (intent === "A-B-A") h.notes.setActiveNoteId(9);
      }
    });
    await React.act(async () => {
      update.resolve({ success: true });
      await pending;
    });
    assert.equal(h.notes.getActiveFolderIdValue(), intent === "overview" ? null : 2);
    assert.equal(
      h.notes.getActiveNoteIdValue(),
      intent === "overview" ? null : intent === "other-note" ? 10 : 9
    );
  });
}

test("newer intent during create is still respected after its move await", async (t) => {
  const create = deferred();
  const h = await mount(t, { createFolder: () => create.promise });
  const pending = h.hook().onCreateFolderAndMove(9, "New");
  await React.act(async () => h.notes.navigateToContainer(1, null));
  await React.act(async () => {
    create.resolve({ success: true, folder: { id: 88, space_id: 1, name: "New" } });
    await pending;
  });
  assert.equal(h.updates.length, 1);
  assert.equal(h.notes.getActiveNoteIdValue(), null);
  assert.equal(h.notes.getActiveFolderIdValue(), null);
});

test("existing-folder lookup stays separate; delete runs pending-save guard before IPC", async (t) => {
  const h = await mount(t);
  await React.act(async () => h.hook().onMoveToFolder(9, 2));
  await h.hook().onMoveToFolder(9, 999);
  assert.deepEqual(h.updates, [[9, { folder_id: 2, space_id: 1 }]]);
  const release = h.guard.setBeforeNoteDelete((id) => h.events.push(["cancel pending save", id]));
  await h.hook().onDeleteNote(9);
  release();
  assert.deepEqual(h.events, [
    ["cancel pending save", 9],
    ["delete", 9],
  ]);
});

test("failed create without error copy and rejected create still report visibly without moving", async (t) => {
  let rejected = false;
  const h = await mount(t, {
    createFolder: async () => {
      if (rejected) throw new Error("Fixture failure");
      return { success: false };
    },
  });
  await h.hook().onCreateFolderAndMove(9, "New");
  rejected = true;
  await h.hook().onCreateFolderAndMove(9, "New");
  assert.deepEqual(
    h.toasts.map((v) => [v.variant, v.description]),
    [
      ["destructive", "common.error"],
      ["destructive", "Error: Fixture failure"],
    ]
  );
  assert.equal(h.updates.length, 0);
  assert.equal(h.notes.getActiveFolderIdValue(), 2);
});

test("failed move never changes the selected container", async (t) => {
  const h = await mount(t, { updateNote: async () => ({ success: false }) });
  await h.hook().onMoveNote(9, { spaceId: 1, folderId: 88 });
  assert.equal(h.notes.getActiveFolderIdValue(), 2);
});
