const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

// The pill sits in the workspace top bar while the workspace shows, so it can
// never cover the centred search field or a view's header row. It floats only
// while the workspace (and so its top bar) is hidden.
async function render(t, props) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  globalThis.__meetingPillState = {
    isRecording: true,
    recordingNoteId: 7,
    recordingNoteTitle: "Weekly sync",
    micCaptureStatus: "capturing",
  };
  t.after(() => delete globalThis.__meetingPillState);
  const vite = await createRendererServer(t, {
    noExternal: ["react-i18next", "react-dom"],
    mockModules: {
      "react-i18next": "export const useTranslation = () => ({ t: (key) => key });",
      "/stores/meetingRecordingStore":
        "export const useMeetingRecordingStore = (select) => select(globalThis.__meetingPillState); export const stopRecording = async () => {};",
      "/utils/windowContext": "export const isControlPanelWindow = () => true;",
      "/utils/meetingMicLevel": "export const readMeetingMicLevel = () => 0;",
      "react-dom":
        "export const createPortal = (node, container) => ({ portal: node, container });",
    },
  });
  const { default: MeetingRecordingPill } = await vite.ssrLoadModule(
    "/components/notes/MeetingRecordingPill.tsx"
  );
  let tree;
  function Probe() {
    tree = MeetingRecordingPill({
      activeView: "home",
      activeNoteId: null,
      onReturnToNote: () => {},
      ...props,
    });
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Probe)));
  return tree;
}

test("inline: rendered in flow while the workspace shows, never fixed or portaled", async (t) => {
  const tree = await render(t, { placement: "inline", workspaceActive: true });
  assert.ok(tree && !tree.portal, "inline renders in place");
  assert.doesNotMatch(tree.props.className, /\bfixed\b/);
  assert.match(tree.props.className, /\bmin-w-0\b/, "the slot can shrink");
});

test("inline: a narrow window keeps bars and Stop, truncating then hiding the title", async (t) => {
  const tree = await render(t, { placement: "inline", workspaceActive: true });
  const spans = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (node.type === "span" && node.props.children === "Weekly sync") spans.push(node);
    walk(node.props?.children);
  };
  walk(tree);
  assert.equal(spans.length, 1);
  assert.match(spans[0].props.className, /\btruncate\b/);
  assert.match(spans[0].props.className, /max-w-\[9rem\]/);
  assert.match(spans[0].props.className, /max-\[1023px\]:hidden/);
});

test("inline: hidden while the workspace and its top bar are hidden", async (t) => {
  assert.equal(await render(t, { placement: "inline", workspaceActive: false }), null);
});

test("floating: never while the workspace shows its top bar", async (t) => {
  assert.equal(await render(t, { placement: "floating", workspaceActive: true }), null);
});

test("floating: portaled and fixed while the workspace is hidden", async (t) => {
  const tree = await render(t, { placement: "floating", workspaceActive: false });
  assert.ok(tree.portal, "floating escapes the hidden workspace");
  assert.match(tree.portal.props.className, /\bfixed\b/);
});

test("neither placement shows while the recording note itself is open", async (t) => {
  const props = { activeView: "personal-notes", activeNoteId: 7, workspaceActive: true };
  assert.equal(await render(t, { ...props, placement: "inline" }), null);
});
