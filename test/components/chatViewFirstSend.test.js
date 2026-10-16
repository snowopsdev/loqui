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
  "/ConversationList": `export default function ConversationList(props) { globalThis.__chatViewNavigation = props; return null; }`,
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
        async sendToAI(text, history, options) { globalThis.__chatViewDispatched.push(text); globalThis.__chatViewRequests.push({ text, history, current: options.owner.isCurrent() }); await options.owner.onStreamComplete(options.owner.conversationId, "answer: " + text); },
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
  globalThis.__chatViewRequests = [];
  t.after(() => {
    delete globalThis.__chatViewDispatched;
    delete globalThis.__chatViewRequests;
    delete globalThis.__chatViewNavigation;
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

for (const destination of ["B", "new"]) {
  for (const outcome of ["success", "create failure", "write failure"]) {
    test(`late creation after selecting ${destination}: ${outcome} preserves selection, history and newer draft`, async (t) => {
      const creation = deferred();
      const writes = [];
      let creates = 0;
      const view = await mountChatView(t, {
        createAgentConversation: () =>
          ++creates === 1 ? creation.promise : Promise.resolve({ id: 9 }),
        getAgentConversation: async (id) => ({
          id,
          messages: [{ role: "user", content: "B private history" }],
        }),
        addAgentMessage: async (id, role, content) => {
          if (id === 7 && role === "user" && outcome === "write failure")
            throw new Error("SQLITE_FULL");
          writes.push({ id, role, content });
          return { id: writes.length };
        },
      });
      await view.type("A first question");
      await view.enter();
      await act(() => globalThis.__chatViewNavigation.onSelectConversation(8));
      if (destination === "new") await act(() => globalThis.__chatViewNavigation.onNewChat());
      await view.type("newer visible draft");
      await act(() => creation.resolve(outcome === "create failure" ? null : { id: 7 }));
      assert.equal(
        globalThis.__chatViewNavigation.activeConversationId,
        destination === "B" ? 8 : null
      );
      assert.equal(view.props(view.textarea()).value, "newer visible draft");
      assert.equal(
        globalThis.__chatViewNavigation.refreshKey,
        outcome === "create failure" ? 0 : 1,
        "stored A remains discoverable in history without selecting it"
      );
      assert.doesNotMatch(
        view.text(),
        /A first question/,
        "stale optimistic insertion never enters the selected history"
      );
      if (destination === "B") assert.match(view.text(), /B private history/);
      else assert.doesNotMatch(view.text(), /B private history/);
      if (outcome === "success") {
        assert.deepEqual(writes, [
          { id: 7, role: "user", content: "A first question" },
          { id: 7, role: "assistant", content: "answer: A first question" },
        ]);
        assert.equal(globalThis.__chatViewRequests[0].current, false);
        assert.deepEqual(
          globalThis.__chatViewRequests[0].history.map((m) => m.content),
          ["A first question"]
        );
      } else {
        assert.deepEqual(writes, []);
        assert.match(
          view.text(),
          /agentMode.input.unsent/,
          "failed admitted text is retained beside newer words"
        );
      }
      await view.enter();
      const followup = globalThis.__chatViewRequests.at(-1);
      assert.equal(followup.text, "newer visible draft");
      assert.deepEqual(
        followup.history.map((m) => m.content),
        destination === "B" ? ["B private history", "newer visible draft"] : ["newer visible draft"]
      );
      assert.equal(writes.at(-2).id, destination === "B" ? 8 : 9);
    });
  }
}

test("stale conversation load cannot reclaim a newer New Chat selection", async (t) => {
  const load = deferred();
  const view = await mountChatView(t, { getAgentConversation: () => load.promise });
  await act(() => {
    void globalThis.__chatViewNavigation.onSelectConversation(8);
  });
  await act(() => globalThis.__chatViewNavigation.onNewChat());
  await view.type("new draft");
  await act(() =>
    load.resolve({ id: 8, messages: [{ role: "user", content: "stale private history" }] })
  );
  assert.equal(globalThis.__chatViewNavigation.activeConversationId, null);
  assert.equal(view.props(view.textarea()).value, "new draft");
  assert.doesNotMatch(view.text(), /stale private history/);
});

for (const missing of [false, true]) {
  test(`stale ${missing ? "missing" : "existing"} B load cannot reclaim selected C`, async (t) => {
    const loadB = deferred();
    const view = await mountChatView(t, {
      getAgentConversation: (id) =>
        id === 8
          ? loadB.promise
          : Promise.resolve({ id, messages: [{ role: "user", content: "C history" }] }),
    });
    await act(() => {
      void globalThis.__chatViewNavigation.onSelectConversation(8);
    });
    await act(() => globalThis.__chatViewNavigation.onSelectConversation(9));
    await view.type("C draft");
    await act(() =>
      loadB.resolve(
        missing ? null : { id: 8, messages: [{ role: "user", content: "B private history" }] }
      )
    );
    assert.equal(globalThis.__chatViewNavigation.activeConversationId, 9);
    assert.equal(view.props(view.textarea()).value, "C draft");
    assert.match(view.text(), /C history/);
    assert.doesNotMatch(view.text(), /B private history/);
  });
}
