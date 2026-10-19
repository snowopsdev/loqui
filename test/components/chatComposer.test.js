const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { createElement } = React;
const { createRoot } = require("react-dom/client");
const { installTree } = require("../helpers/harness/fakeDomTree");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

const loadKeys = () => import("../../src/components/chat/chatInputKeys.ts");
const source = fs.readFileSync(
  path.join(__dirname, "../../src/components/chat/ChatInput.tsx"),
  "utf8"
);
const COMPOSER_MOCKS = {
  "/useVoiceDraft": `export const useVoiceDraft = () => ({ status: "idle", start() {}, stop() {}, cancel() {}, elapsed: 0, readLevel: () => 0, streamingOnlyProvider: false });`,
};
const base = { shiftKey: false, isComposing: false, isBusy: false, isQueued: false, hasText: true };

test("Enter submits when idle and queues while the agent is busy", async () => {
  const { resolveComposerKey } = await loadKeys();
  assert.equal(resolveComposerKey({ ...base, key: "Enter" }), "submit");
  assert.equal(resolveComposerKey({ ...base, key: "Enter", isBusy: true }), "queue");
  assert.equal(resolveComposerKey({ ...base, key: "Enter", hasText: false }), "none");
  assert.equal(resolveComposerKey({ ...base, key: "Enter", shiftKey: true }), "none");
});

test("Enter during IME composition does nothing", async () => {
  const { resolveComposerKey } = await loadKeys();
  assert.equal(resolveComposerKey({ ...base, key: "Enter", isComposing: true }), "none");
  assert.equal(resolveComposerKey({ ...base, key: "Enter", keyCode: 229 }), "none");
  assert.equal(
    resolveComposerKey({ ...base, key: "Enter", isBusy: true, isComposing: true }),
    "none"
  );
});

test("Escape unqueues only a queued draft", async () => {
  const { resolveComposerKey } = await loadKeys();
  assert.equal(resolveComposerKey({ ...base, key: "Escape", isQueued: true }), "unqueue");
  assert.equal(resolveComposerKey({ ...base, key: "Escape" }), "none");
});

test("the textarea grows to a cap and then scrolls", async () => {
  const { composerHeight, COMPOSER_MAX_HEIGHT_PX } = await loadKeys();
  assert.deepEqual(composerHeight(40), { height: 40, overflowY: "hidden" });
  assert.deepEqual(composerHeight(400), { height: COMPOSER_MAX_HEIGHT_PX, overflowY: "auto" });
  assert.deepEqual(composerHeight(Number.NaN), { height: 0, overflowY: "hidden" });
});

test("the composer stays typeable while the agent is busy", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(
    t,
    rendererOptions("loqui-chat-composer-", COMPOSER_MOCKS)
  );
  const { ChatInput } = await vite.ssrLoadModule("/components/chat/ChatInput.tsx");
  const html = renderToStaticMarkup(
    createElement(ChatInput, {
      partialTranscript: "",
      agentState: "thinking",
      onTextSubmit() {},
      onCancel() {},
    })
  );
  const textarea = html.match(/<textarea[^>]*>/);
  assert.ok(textarea, "the composer is a textarea");
  assert.doesNotMatch(textarea[0], /disabled/);
  assert.match(textarea[0], /dir="auto"/);
  assert.match(textarea[0], /rows="1"/);
  assert.match(html, /aria-label="common\.cancel"/, "Stop is still offered");
});

test("the busy state is not a disabled field, and every focus ring is full opacity", () => {
  assert.doesNotMatch(source, /disabled=\{isBusy\}/);
  assert.doesNotMatch(source, /cursor-not-allowed/);
  assert.doesNotMatch(source, /ring-(ring|primary)\/\d+/);
});

test("busy Enter queues without submitting or changing the draft", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(
    t,
    rendererOptions("loqui-composer-keys-", COMPOSER_MOCKS)
  );
  const { ChatInput } = await vite.ssrLoadModule("/components/chat/ChatInput.tsx");
  const submissions = [];
  root = createRoot(tree.container);
  await React.act(async () =>
    root.render(
      createElement(ChatInput, {
        partialTranscript: "",
        agentState: "thinking",
        queueKey: "chat|1|route",
        onTextSubmit: (text) => submissions.push(text),
        onCancel() {},
      })
    )
  );
  const field = tree.find((node) => node.tagName === "TEXTAREA");
  assert.ok(field);
  await React.act(async () => tree.props(field).onChange({ target: { value: "Keep this draft" } }));
  for (const [overrides, expectedPrevented] of [
    [{}, true],
    [{ shiftKey: true }, false],
    [{ nativeEvent: { isComposing: true, keyCode: 13 } }, false],
    [{ nativeEvent: { isComposing: false, keyCode: 229 } }, false],
  ]) {
    let prevented = false;
    const event = {
      key: "Enter",
      shiftKey: false,
      nativeEvent: { isComposing: false, keyCode: 13 },
      preventDefault() {
        prevented = true;
      },
      ...overrides,
    };
    await React.act(async () => tree.props(field).onKeyDown(event));
    assert.equal(prevented, expectedPrevented);
    assert.equal(tree.props(field).value, "Keep this draft");
    assert.deepEqual(submissions, []);
  }
});

test("every caller passes a queue key built from its destination and route", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
  assert.match(
    read("src/components/chat/ChatView.tsx"),
    /queueKey=\{`chat\|\$\{activeConversationId \?\? "new"\}\|\$\{routeKey\}`\}/
  );
  assert.match(
    read("src/components/notes/NoteEditor.tsx"),
    /const embeddedQueueKey = `note\|\$\{note\.id\}\|/
  );
  assert.equal(
    read("src/components/notes/NoteEditor.tsx").match(/queueKey=\{embeddedQueueKey\}/g)?.length,
    2
  );
  assert.match(
    read("src/components/notes/overview/ContainerOverview.tsx"),
    /queueKey=\{`container\|\$\{space\.id\}\|/
  );
  assert.match(
    read("src/components/dictation/AssistantPanel.tsx"),
    /queueKey=\{`assistant\|\$\{persistence\.conversationId \?\? "new"\}\|\$\{routeKey\}\|/
  );
  assert.match(read("src/components/notes/EmbeddedChat.tsx"), /queueKey=\{queueKey\}/);
  assert.match(
    read("src/components/notes/overview/OverviewAskSection.tsx"),
    /queueKey=\{queueKey\}/
  );
});

test("the route key changes with the route and never carries a secret", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-chat-route-key-"));
  const { chatRouteKey } = await vite.ssrLoadModule("/components/chat/chatRouteKey.ts");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const state = {
    ...useSettingsStore.getState(),
    chatAgentMode: "providers",
    chatAgentProvider: "openai",
    chatAgentModel: "model-a",
  };
  const a = chatRouteKey(state, "chatIntelligence");
  assert.notEqual(chatRouteKey({ ...state, chatAgentModel: "model-b" }, "chatIntelligence"), a);
  assert.notEqual(chatRouteKey(state, "dictationAgent"), a);
  const withKey = chatRouteKey(
    { ...state, chatAgentCustomApiKey: "sk-secret" },
    "chatIntelligence"
  );
  assert.equal(withKey, a);
  assert.doesNotMatch(withKey, /sk-secret/);
});

test("AssistantPanel submits through sendWithSelectedContext", () => {
  const panel = fs.readFileSync(
    path.join(__dirname, "../../src/components/dictation/AssistantPanel.tsx"),
    "utf8"
  );
  assert.match(panel, /sendWithSelectedContext\(text, selectedContext, \{/);
  assert.doesNotMatch(panel, /void sendMessage\(text, context/);
});

test("unchanged multiline draft is resized when the textarea returns after voice state", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  installHookDom(t);
  const tree = installTree();
  const create = globalThis.document.createElement;
  globalThis.document.createElement = (...args) => {
    const node = create(...args);
    if (node.tagName === "TEXTAREA") node.scrollHeight = 140;
    return node;
  };
  const vite = await createRendererServer(
    t,
    rendererOptions("loqui-composer-remount-", {
      ...COMPOSER_MOCKS,
      "/ui/LevelBars": `export const LevelBars = () => null;`,
      "/useVoiceDraft": `export const useVoiceDraft = () => ({ status: globalThis.__composerVoiceStatus ?? "idle", start() {}, stop() {}, cancel() {}, elapsed: 0, readLevel: () => 0 });`,
    })
  );
  const { ChatInput } = await vite.ssrLoadModule("/components/chat/ChatInput.tsx");
  root = createRoot(tree.container);
  const render = (agentState) =>
    React.act(async () =>
      root.render(
        createElement(ChatInput, {
          agentState,
          partialTranscript: "",
          onTextSubmit() {},
        })
      )
    );
  await render("idle");
  let field = tree.find((node) => node.tagName === "TEXTAREA");
  await React.act(async () =>
    tree.props(field).onChange({ target: { value: "line one\nline two" } })
  );
  assert.equal(field.style.height, "140px");
  t.after(() => {
    delete globalThis.__composerVoiceStatus;
  });
  globalThis.__composerVoiceStatus = "recording";
  await render("idle");
  assert.equal(
    tree.find((node) => node.tagName === "TEXTAREA"),
    null
  );
  globalThis.__composerVoiceStatus = "idle";
  await render("idle");
  field = tree.find((node) => node.tagName === "TEXTAREA");
  assert.equal(tree.props(field).value, "line one\nline two");
  assert.equal(field.style.height, "140px");
  assert.equal(field.style.overflowY, "hidden");
});
