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

test("real tree notifies only after note/container selection changes, never expansion or an unchanged row", async (t) => {
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
  const { ToastContext } = await vite.ssrLoadModule("/components/ui/useToast.ts");
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
  await React.act(async () =>
    root.render(
      React.createElement(
        ToastContext.Provider,
        { value: { toast() {} } },
        React.createElement(Probe)
      )
    )
  );
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
  await click((n) => text(n) === "Work");
  assert.equal(seen.length, 1);
  await click((n) => text(n) === "Note 9");
  assert.deepEqual(
    seen,
    [
      [null, 2],
      [9, 2],
    ],
    "callback sees the already committed note"
  );
  await click((n) => text(n) === "Note 9");
  assert.equal(seen.length, 2);
  await click((n) => text(n) === "notes.spaces.personal");
  assert.deepEqual(seen.at(-1), [null, null]);
  await click((n) => text(n) === "notes.spaces.personal");
  assert.equal(seen.length, 3);
});
