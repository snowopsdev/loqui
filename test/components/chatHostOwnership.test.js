const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");
const { installTree } = require("../helpers/harness/fakeDomTree");
const act = (fn) =>
  React.act(async () => {
    await fn();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const MOCKS = {
  "/useChatStreaming": `export function useChatStreaming() { return {
    agentState: "idle", activeToolName: null, toolStatus: "", cancelStream() {},
    async sendToAI(text, history, options) {
      globalThis.__hostRequests.push({ text, history, current: options.owner.isCurrent() });
      await options.owner.onStreamComplete(options.owner.conversationId, "reply: " + text);
    }
  }; }`,
  "/useVoiceDraft": `export const useVoiceDraft = () => ({ status: "idle", start() {}, stop() {}, cancel() {}, elapsed: 0, readLevel: () => 0 });`,
  "/chatRouteKey": `export const useChatRouteKey = () => "route-a";`,
  "/hooks/useWindowDrag": `export const useWindowDrag = () => ({ handleMouseDown() {}, handleMouseUp() {} });`,
  "/hooks/useCopyFeedback": `export const useCopyFeedback = () => ({ copied: false, copy() {}, copyText() {}, confirmCopied() {} });`,
  "/ui/MarkdownRenderer": `import React from "react"; export const MarkdownRenderer = ({ content }) => React.createElement("p", null, content);`,
};
async function setup(t, api) {
  let root;
  t.after(async () => {
    if (root) await act(() => root.unmount());
  });
  installBrowserGlobals(t, { window: { electronAPI: api } });
  installHookDom(t);
  const tree = installTree();
  const createElement = globalThis.document.createElement;
  globalThis.document.createElement = (...args) => {
    const node = createElement(...args);
    node.style.setProperty = (name, value) => {
      node.style[name] = value;
    };
    node.style.removeProperty = (name) => {
      delete node.style[name];
    };
    return node;
  };
  globalThis.__hostRequests = [];
  t.after(() => delete globalThis.__hostRequests);
  const vite = await createRendererServer(t, rendererOptions("loqui-chat-host-owner-", MOCKS));
  root = createRoot(tree.container);
  const { ChatInput } = await vite.ssrLoadModule("/components/chat/ChatInput.tsx");
  return {
    vite,
    tree,
    ChatInput,
    render: (element) => act(() => root.render(element)),
    unmount: async () => {
      await act(() => root.unmount());
      root = null;
    },
    type: (value) =>
      act(() =>
        tree.props(tree.find((n) => n.tagName === "TEXTAREA")).onChange({ target: { value } })
      ),
    enter: () =>
      act(() =>
        tree.props(tree.find((n) => n.tagName === "TEXTAREA")).onKeyDown({
          key: "Enter",
          shiftKey: false,
          nativeEvent: { isComposing: false, keyCode: 13 },
          preventDefault() {},
        })
      ),
    value: () => tree.props(tree.find((n) => n.tagName === "TEXTAREA")).value,
  };
}
for (const host of ["embedded", "container"]) {
  for (const destination of ["B", "new"]) {
    for (const outcome of ["success", "create failure", "write failure"]) {
      test(`${host}: deferred create to ${destination}, ${outcome} retains host association and draft`, async (t) => {
        const creation = deferred();
        const creates = [];
        const saved = [];
        const histories = new Map([
          [7, []],
          [8, [{ role: "user", content: "B private history" }]],
          [9, []],
        ]);
        const c = await setup(t, {
          createAgentConversation: (...args) => {
            creates.push(args);
            return creates.length === 1 ? creation.promise : Promise.resolve({ id: 9 });
          },
          getConversationsForNote: async () => (creates.length ? [{ id: 7, title: "A" }] : []),
          getConversationsForContainer: async () => (creates.length ? [{ id: 7, title: "A" }] : []),
          getAgentConversation: async (id) => ({ id, messages: histories.get(id) }),
          addAgentMessage: async (id, role, content) => {
            if (id === 7 && role === "user" && outcome === "write failure")
              throw new Error("SQLITE_FULL");
            histories.get(id).push({ role, content });
            saved.push({ id, role, content });
            return { id: saved.length };
          },
        });
        const useHost =
          host === "embedded"
            ? (await c.vite.ssrLoadModule("/hooks/useEmbeddedChat.ts")).useEmbeddedChat
            : (await c.vite.ssrLoadModule("/hooks/useContainerChat.ts")).useContainerChat;
        let chat;
        function Harness() {
          chat = useHost(
            host === "embedded"
              ? { noteId: 41, folderId: 5, noteTitle: "Original note", noteContent: "A context" }
              : {
                  space: { id: 3, name: "Original space" },
                  folder: { id: 5, name: "Original folder" },
                  notes: [],
                }
          );
          return React.createElement(c.ChatInput, {
            agentState: "idle",
            partialTranscript: "",
            queueKey: String(chat.activeConversationId),
            onTextSubmit: chat.sendMessage,
          });
        }
        await c.render(React.createElement(Harness));
        await c.type("A question");
        await c.enter();
        await act(() => chat.switchConversation(8));
        if (destination === "new") await act(() => chat.startNewChat());
        await c.type("newer draft");
        await act(() => creation.resolve(outcome === "create failure" ? null : { id: 7 }));
        assert.equal(chat.activeConversationId, destination === "B" ? 8 : null);
        assert.equal(c.value(), "newer draft");
        assert.deepEqual(
          chat.messages.map((m) => m.content),
          destination === "B" ? ["B private history"] : []
        );
        assert.deepEqual(
          creates[0].slice(1),
          host === "embedded" ? [41, undefined, undefined] : [undefined, 3, 5],
          "IPC permanently associates the admitted conversation with its original host"
        );
        if (outcome !== "create failure")
          assert.equal(
            (chat.noteConversations ?? chat.conversations)[0].id,
            7,
            "A is discoverable in the original host picker"
          );
        if (outcome === "success") {
          assert.deepEqual(saved, [
            { id: 7, role: "user", content: "A question" },
            { id: 7, role: "assistant", content: "reply: A question" },
          ]);
          assert.equal(globalThis.__hostRequests[0].current, false);
          assert.deepEqual(
            globalThis.__hostRequests[0].history.map((m) => m.content),
            ["A question"]
          );
        } else assert.match(c.tree.text(), /agentMode.input.unsent/);
        await c.enter();
        assert.deepEqual(
          globalThis.__hostRequests.at(-1).history.map((m) => m.content),
          destination === "B" ? ["B private history", "newer draft"] : ["newer draft"]
        );
        await act(() => chat.switchConversation(7));
        assert.deepEqual(
          chat.messages.map((m) => m.content),
          outcome === "success" ? ["A question", "reply: A question"] : []
        );
        if (outcome === "success") {
          await c.type("A followup");
          await c.enter();
          assert.deepEqual(
            globalThis.__hostRequests.at(-1).history.map((m) => m.content),
            ["A question", "reply: A question", "A followup"],
            "returning to A never includes B/new-chat history"
          );
        }
      });
    }
  }
  test(`${host}: stale load does not reclaim New Chat`, async (t) => {
    const load = deferred();
    const c = await setup(t, {
      getConversationsForNote: async () => [],
      getConversationsForContainer: async () => [],
      getAgentConversation: () => load.promise,
    });
    const useHost =
      host === "embedded"
        ? (await c.vite.ssrLoadModule("/hooks/useEmbeddedChat.ts")).useEmbeddedChat
        : (await c.vite.ssrLoadModule("/hooks/useContainerChat.ts")).useContainerChat;
    let chat;
    function Harness() {
      chat = useHost(
        host === "embedded"
          ? { noteId: 41, noteTitle: "A", noteContent: "" }
          : { space: { id: 3, name: "A" }, folder: null, notes: [] }
      );
      return null;
    }
    await c.render(React.createElement(Harness));
    let pending;
    await act(() => {
      pending = chat.switchConversation(8);
    });
    await act(() => chat.startNewChat());
    await act(async () => {
      load.resolve({ id: 8, messages: [{ role: "user", content: "stale B" }] });
      await pending;
    });
    assert.equal(chat.activeConversationId, null);
    assert.deepEqual(chat.messages, []);
  });
}

test("Assistant host remount cannot be reclaimed by an old first creation", async (t) => {
  const creation = deferred();
  const saved = [];
  const selected = [];
  let creates = 0;
  const c = await setup(t, {
    createAgentConversation: () =>
      ++creates === 1 ? creation.promise : Promise.resolve({ id: 9 }),
    addAgentMessage: async (id, role, content) => {
      saved.push({ id, role, content });
      return { id: saved.length };
    },
  });
  const { AssistantPanel } = await c.vite.ssrLoadModule("/components/dictation/AssistantPanel.tsx");
  const noop = () => {};
  const props = {
    pendingCommand: null,
    onCommandConsumed: noop,
    onCommandDiscarded: noop,
    onCommandSettled: noop,
    initialConversationId: null,
    onConversationIdChange: (id) => selected.push(id),
    voiceState: "idle",
    thinking: false,
    open: true,
    footerPhase: "actions",
    horizontalDirection: "right",
    onClose: noop,
    onBusyChange: noop,
    onResponseReadyChange: noop,
    onResponseContent: noop,
    onConversationReset: noop,
    onSelectionContextChange: noop,
  };
  await c.render(React.createElement(AssistantPanel, { ...props, key: "A" }));
  await c.type("A question");
  await c.enter();
  await c.render(React.createElement(AssistantPanel, { ...props, key: "new host" }));
  await c.type("newer draft");
  await act(() => creation.resolve({ id: 7 }));
  assert.equal(c.value(), "newer draft");
  assert.ok(!selected.includes(7), "old creation never announces itself to the newer host");
  assert.equal(globalThis.__hostRequests[0].current, false);
  assert.deepEqual(saved, [
    { id: 7, role: "user", content: "A question" },
    { id: 7, role: "assistant", content: "reply: A question" },
  ]);
  await c.enter();
  assert.deepEqual(
    globalThis.__hostRequests[1].history.map((m) => m.content),
    ["newer draft"]
  );
  assert.equal(selected.at(-1), 9);
});

test("embedded note change invalidates creation and keeps the admitted note association reachable", async (t) => {
  const creation = deferred();
  const histories = new Map([[7, []]]);
  const saved = [];
  let stored = false;
  const c = await setup(t, {
    createAgentConversation: async (_title, noteId) => {
      assert.equal(noteId, 41);
      const result = await creation.promise;
      stored = true;
      return result;
    },
    getConversationsForNote: async (noteId) =>
      noteId === 41 && stored ? [{ id: 7, title: "Original note" }] : [],
    getAgentConversation: async (id) => ({ id, messages: histories.get(id) }),
    addAgentMessage: async (id, role, content) => {
      histories.get(id).push({ role, content });
      saved.push({ id, role, content });
      return { id: saved.length };
    },
  });
  const { useEmbeddedChat } = await c.vite.ssrLoadModule("/hooks/useEmbeddedChat.ts");
  let chat;
  function Harness({ noteId }) {
    chat = useEmbeddedChat({
      noteId,
      folderId: 5,
      noteTitle: "Note " + noteId,
      noteContent: "context " + noteId,
    });
    return React.createElement(c.ChatInput, {
      agentState: "idle",
      partialTranscript: "",
      queueKey: String(noteId),
      onTextSubmit: chat.sendMessage,
    });
  }
  await c.render(React.createElement(Harness, { noteId: 41 }));
  await c.type("A question");
  await c.enter();
  await c.render(React.createElement(Harness, { noteId: 42 }));
  await c.type("new note draft");
  await act(() => creation.resolve({ id: 7 }));
  assert.equal(chat.activeConversationId, null);
  assert.deepEqual(chat.messages, []);
  assert.deepEqual(
    chat.noteConversations,
    [],
    "A refresh callback cannot replace the new note's picker"
  );
  assert.equal(c.value(), "new note draft");
  assert.equal(globalThis.__hostRequests[0].current, false);
  await c.render(React.createElement(Harness, { noteId: 41 }));
  assert.equal(chat.activeConversationId, 7);
  assert.equal(chat.noteConversations[0].id, 7);
  assert.deepEqual(
    chat.messages.map((m) => m.content),
    ["A question", "reply: A question"]
  );
});
