const React = require("react");
const { createElement } = React;
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../../lib/rendererTestHarness");
const { rendererOptions, TOAST_MOCK } = require("./rendererMocks");
const { installTree } = require("./fakeDomTree");

const MOCKS = {
  "/ui/useToast": TOAST_MOCK,
  "/useVoiceDraft": `export const useVoiceDraft = props => (globalThis.__composerVoiceTranscript = props.onTranscript, { status: "idle", start() {}, stop() {}, cancel() {}, elapsed: 0, readLevel: () => 0, streamingOnlyProvider: false });`,
};

async function mountComposer(t, onTextSubmit, extraProps = {}) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__composerVoiceTranscript;
  });
  installBrowserGlobals(t);
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(t, rendererOptions("loqui-composer-seed-", MOCKS));
  const { ChatInput } = await vite.ssrLoadModule("/components/chat/ChatInput.tsx");
  // A stable queueKey: Plan 02 Task 13 arms a queue only for a known destination.
  let props = {
    partialTranscript: "",
    agentState: "idle",
    queueKey: "chat|1|route-a",
    onTextSubmit,
    onCancel() {},
    seed: null,
    ...extraProps,
  };
  const render = (next = {}) => {
    props = { ...props, ...next };
    return React.act(async () => {
      root.render(createElement(ChatInput, props));
      await new Promise((r) => setTimeout(r, 0));
    });
  };
  root = createRoot(tree.container);
  await render();
  const textarea = () => tree.find((n) => n.tagName === "TEXTAREA");
  const type = (value) =>
    React.act(async () => tree.props(textarea()).onChange({ target: { value } }));
  const press = (key, nativeEvent = {}) =>
    React.act(async () => {
      tree.props(textarea()).onKeyDown({
        key,
        shiftKey: false,
        nativeEvent: { isComposing: false, keyCode: key === "Enter" ? 13 : 27, ...nativeEvent },
        preventDefault() {},
      });
      await new Promise((r) => setTimeout(r, 0));
    });
  const select = (caret) =>
    React.act(async () =>
      tree
        .props(textarea())
        .onSelect({ currentTarget: { value: tree.props(textarea()).value, selectionStart: caret } })
    );
  const voice = async (text) => {
    await React.act(async () => globalThis.__composerVoiceTranscript(text));
  };
  return { render, type, press, select, voice, value: () => tree.props(textarea()).value };
}

module.exports = { mountComposer };
