const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { createElement } = React;
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions, TOAST_MOCK } = require("../helpers/harness/rendererMocks");
const { installTree } = require("../helpers/harness/fakeDomTree");

// The real ChatView, persistence, sender and composer. Only leaf views, the
// provider stream and the route key are stubbed.
const VIEW_MOCKS = {
  "/ui/useToast": TOAST_MOCK,
  "/useVoiceDraft": `export const useVoiceDraft = () => ({ status: "idle", start() {}, stop() {}, cancel() {}, elapsed: 0, readLevel: () => 0, streamingOnlyProvider: false });`,
  "/ConversationList": `export default function ConversationList() { return null; }`,
  "/EmptyChatState": `
    import React from "react";
    export default function EmptyChatState() { return React.createElement("p", null, "EMPTY_CHAT"); }
  `,
  "/ChatMessages": `
    import React from "react";
    export function ChatMessages({ messages }) {
      return React.createElement("ol", null, messages.map((m) => React.createElement("li", { key: m.id }, m.content)));
    }
  `,
  "/ChatEmptyIllustration": `export function ChatEmptyIllustration() { return null; }`,
  "/useChatStreaming": `
    export function useChatStreaming() {
      return {
        agentState: "idle",
        activeToolName: null,
        toolStatus: "",
        cancelStream() {},
        async sendToAI(text) { globalThis.__chatViewDispatched.push(text); },
      };
    }
  `,
  "/chatRouteKey": `export const chatRouteKey = () => "route-a"; export const useChatRouteKey = () => "route-a";`,
  "/ui/dialog": `export function ConfirmDialog() { return null; }`,
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const act = (fn) =>
  React.act(async () => {
    await fn();
    await settle();
  });

async function mountChatView(t, electronAPI) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  globalThis.__chatViewDispatched = [];
  t.after(() => {
    delete globalThis.__chatViewDispatched;
  });
  installBrowserGlobals(t, { window: { electronAPI } });
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(
    t,
    rendererOptions("loqui-chat-view-first-send-", VIEW_MOCKS)
  );
  const { default: ChatView } = await vite.ssrLoadModule("/components/chat/ChatView.tsx");
  root = createRoot(tree.container);
  await act(() => root.render(createElement(ChatView)));
  const textarea = () => tree.find((node) => node.tagName === "TEXTAREA");
  return {
    ...tree,
    textarea,
    type: (value) => act(() => tree.props(textarea()).onChange({ target: { value } })),
    enter: () =>
      act(() =>
        tree.props(textarea()).onKeyDown({
          key: "Enter",
          shiftKey: false,
          nativeEvent: { isComposing: false, keyCode: 13 },
          preventDefault() {},
        })
      ),
  };
}

test("a first send whose conversation cannot be created keeps the composer and the words", async (t) => {
  const creation = deferred();
  const view = await mountChatView(t, {
    createAgentConversation: () => creation.promise,
    addAgentMessage: async () => assert.fail("nothing is saved without a conversation"),
  });
  await view.type("hello");
  await view.enter();
  assert.ok(view.textarea(), "the composer stays while the conversation is created");
  assert.doesNotMatch(view.text(), /EMPTY_CHAT/);
  await act(() => creation.resolve(null)); // main returns null for a scope that is gone
  assert.ok(view.textarea(), "the composer is still mounted after the failure");
  assert.doesNotMatch(view.text(), /EMPTY_CHAT/);
  assert.equal(view.props(view.textarea()).value, "hello", "the words are back");
  await view.type("hello again");
  assert.equal(view.props(view.textarea()).value, "hello again", "and editable");
  assert.deepEqual(globalThis.__chatViewDispatched, []);
});

test("a first send that succeeds keeps the composer and shows the message", async (t) => {
  const view = await mountChatView(t, {
    createAgentConversation: async (title) => ({ id: 7, title }),
    addAgentMessage: async (id, role, content) => ({
      id: 1,
      conversation_id: id,
      role,
      content,
      created_at: "2026-10-15 09:00:00",
    }),
  });
  await view.type("hello");
  await view.enter();
  assert.ok(view.textarea());
  assert.equal(view.props(view.textarea()).value, "");
  assert.match(view.text(), /hello/);
  assert.deepEqual(globalThis.__chatViewDispatched, ["hello"]);
});

test("ChatView marks the chat started only once the message is saved", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../src/components/chat/ChatView.tsx"),
    "utf8"
  );
  assert.doesNotMatch(source, /onBeforeSend: markChatStarted/);
  assert.match(source, /onMessagePersisted: markChatStarted/);
});
