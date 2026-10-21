const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

function text(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" ? text(node.props?.children) : "";
}
function find(node, predicate) {
  if (Array.isArray(node)) return node.map((n) => find(n, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}

test("real tree always notifies intentional container activation without redundant selection mutation", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        getSpaces: async () => [{ id: 1, kind: "private" }],
        getFolders: async () => [{ id: 2, space_id: 1, name: "Work" }],
        getFolderNoteCounts: async () => [],
        getNotes: async () => [{ id: 9, title: "Note 9", folder_id: 2, space_id: 1 }],
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next":
        'const t = key => key; export const useTranslation = () => ({ t, i18n: { dir: () => "ltr" } });',
    },
  });
  const notes = await vite.ssrLoadModule("/stores/noteStore.ts");
  await notes.initializeNotesTree();
  notes.navigateToContainer(1, null);
  const { default: SpacesTree } = await vite.ssrLoadModule("/components/notes/SpacesTree.tsx");
  const seen = [];
  const props = {
    onDeleteNote() {},
    onMoveNote: async () => {},
    onCreateFolderAndMove() {},
    onNewNote() {},
    onNavigate: () => seen.push([notes.getActiveNoteIdValue(), notes.getActiveFolderIdValue()]),
  };
  let tree;
  function Probe() {
    tree = SpacesTree(props);
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Probe)));
  const click = async (predicate) =>
    React.act(async () => {
      const button = find(tree, (n) => n.type === "button" && predicate(n));
      assert.ok(button, "expected production tree button");
      await button.props.onClick();
    });
  await click((n) => n.props["aria-label"] === "Work"); // expand only
  assert.deepEqual(seen, []);
  await click((n) => text(n) === "Work");
  assert.deepEqual(seen, [[null, 2]], "callback sees the already committed container");
  const folderGeneration = notes.getNoteNavigationGeneration();
  await click((n) => text(n) === "Work");
  assert.equal(seen.length, 2);
  assert.equal(
    notes.getNoteNavigationGeneration(),
    folderGeneration,
    "unchanged folder does not reselect"
  );
  await click((n) => text(n) === "Note 9");
  assert.deepEqual(
    seen,
    [
      [null, 2],
      [null, 2],
      [9, 2],
    ],
    "callback sees the already committed note"
  );
  await click((n) => text(n) === "Note 9");
  assert.equal(seen.length, 3);
  await click((n) => text(n) === "notes.spaces.personal");
  assert.deepEqual(seen.at(-1), [null, null]);
  const rootGeneration = notes.getNoteNavigationGeneration();
  await click((n) => text(n) === "notes.spaces.personal");
  assert.equal(seen.length, 5);
  assert.equal(
    notes.getNoteNavigationGeneration(),
    rootGeneration,
    "unchanged root does not reselect"
  );
});

test("sidebar activation delegates an already selected note to workspace navigation", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        getSpaces: async () => [{ id: 1, kind: "private" }],
        getFolders: async () => [{ id: 2, space_id: 1, name: "Work" }],
        getFolderNoteCounts: async () => [],
        getNotes: async () => [{ id: 9, title: "Note 9", folder_id: 2, space_id: 1 }],
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next":
        'const t = key => key; export const useTranslation = () => ({ t, i18n: { dir: () => "ltr" } });',
    },
  });
  const notes = await vite.ssrLoadModule("/stores/noteStore.ts");
  await notes.initializeNotesTree();
  notes.setActiveContext(1, 2);
  notes.setActiveNoteId(9);
  notes.revealContainer(1, 2);
  const { default: SpacesTree } = await vite.ssrLoadModule("/components/notes/SpacesTree.tsx");
  let view = "home";
  const activated = [];
  let tree;
  function Probe() {
    tree = SpacesTree({
      onDeleteNote() {},
      onMoveNote: async () => {},
      onCreateFolderAndMove() {},
      onNewNote() {},
      onNavigate() {
        assert.fail("workspace-owned activation must not run a second selection path");
      },
      onOpenNote(id) {
        activated.push(id);
        view = "personal-notes";
      },
    });
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Probe)));
  await React.act(async () => {
    const button = find(tree, (node) => node.type === "button" && text(node) === "Note 9");
    assert.ok(button);
    button.props.onClick();
  });
  assert.equal(view, "personal-notes");
  assert.deepEqual(activated, [9]);
  assert.equal(notes.getActiveNoteIdValue(), 9);
  assert.equal(notes.getActiveFolderIdValue(), 2);
  const sidebar = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../../src/components/ControlPanelSidebar.tsx"),
    "utf8"
  );
  assert.match(sidebar, /onOpenNote=\{navigation\.openNote\}/);
});

// Full-app M1: the same Space or folder row click from Home or Chat (Notes not
// mounted yet) shows the overview once Notes initialises, as it does from Notes.
for (const row of ["notes.spaces.personal", "Work"]) {
  test(`sidebar ${row === "Work" ? "folder" : "Space"} row lands on the overview when Notes mounts afterwards`, async (t) => {
    let root;
    t.after(async () => {
      if (root) await React.act(async () => root.unmount());
    });
    installBrowserGlobals(t, {
      window: {
        electronAPI: {
          getSpaces: async () => [{ id: 1, kind: "private" }],
          getFolders: async () => [{ id: 2, space_id: 1, name: "Work" }],
          getFolderNoteCounts: async () => [],
          getNotes: async (_type, _limit, folderId) => [
            { id: folderId === 2 ? 9 : 8, title: "Note", folder_id: folderId, space_id: 1 },
          ],
        },
      },
    });
    const container = installHookDom(t);
    const vite = await createRendererServer(t, {
      noExternal: ["react-i18next"],
      mockModules: {
        "react-i18next":
          'const t = key => key; export const useTranslation = () => ({ t, i18n: { dir: () => "ltr" } });',
      },
    });
    const notes = await vite.ssrLoadModule("/stores/noteStore.ts");
    await notes.initializeNotesTree();
    assert.ok(notes.getActiveNoteIdValue() != null, "a note is open before the click");
    const { default: SpacesTree } = await vite.ssrLoadModule("/components/notes/SpacesTree.tsx");
    let navigated = 0;
    let tree;
    function Probe() {
      tree = SpacesTree({
        onDeleteNote() {},
        onMoveNote: async () => {},
        onCreateFolderAndMove() {},
        onNewNote() {},
        onNavigate: () => navigated++,
      });
      return null;
    }
    root = createRoot(container);
    await React.act(async () => root.render(React.createElement(Probe)));
    await React.act(async () => {
      const button = find(tree, (n) => n.type === "button" && text(n) === row);
      assert.ok(button, "expected production tree row");
      await button.props.onClick();
    });
    assert.equal(navigated, 1);
    // PersonalNotesView mounts and initialises the tree (the Home/Chat path).
    await notes.initializeNotesTree();
    assert.equal(notes.getActiveNoteIdValue(), null, "the overview, not the first note");
    assert.equal(notes.getActiveFolderIdValue(), row === "Work" ? 2 : null);
  });
}
