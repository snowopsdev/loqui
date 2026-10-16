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
const row = (content) => ({
  id: 1,
  conversation_id: 7,
  role: "user",
  content,
  created_at: "2026-10-15 09:00:00",
});

// The real useChatPersistence behind the real sender. Only the IPC bridge and
// the provider call are fakes.
async function mountRealSender(t, addAgentMessage, sendToAI) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        createAgentConversation: async (title) => ({ id: 7, title }),
        addAgentMessage,
      },
    },
  });
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(t, rendererOptions("loqui-chat-persistence-send-"));
  const { useChatPersistence } = await vite.ssrLoadModule("/components/chat/useChatPersistence.ts");
  const { useChatMessageSender } = await vite.ssrLoadModule(
    "/components/chat/useChatMessageSender.ts"
  );
  const h = {};
  function Harness() {
    const persistence = useChatPersistence();
    h.messages = persistence.messages;
    h.send = useChatMessageSender({
      conversationId: persistence.conversationId,
      persistence,
      streaming: { sendToAI },
      createConversation: (text) => persistence.createConversation(text),
    });
    return null;
  }
  root = createRoot(tree.container);
  await act(() => root.render(React.createElement(Harness)));
  return h;
}

test("the provider request waits until the user message is saved", async (t) => {
  const write = deferred();
  const dispatched = [];
  const h = await mountRealSender(
    t,
    () => write.promise,
    async (text) => dispatched.push(text)
  );
  let result;
  await act(() => {
    result = h.send("hello");
  });
  assert.deepEqual(dispatched, [], "nothing goes to the provider while the write is pending");
  await act(() => write.resolve(row("hello")));
  assert.equal(await result, true);
  assert.deepEqual(dispatched, ["hello"]);
  assert.deepEqual(
    h.messages.map((m) => m.content),
    ["hello"]
  );
});

for (const [outcome, settleWrite, reason] of [
  ["rejects", (write) => write.reject(new Error("SQLITE_FULL")), /SQLITE_FULL/],
  [
    "returns null (the conversation is gone)",
    (write) => write.resolve(null),
    /no longer available/,
  ],
]) {
  test(`a write that ${outcome} rejects the send, rolls back and dispatches nothing`, async (t) => {
    const write = deferred();
    const dispatched = [];
    const h = await mountRealSender(
      t,
      () => write.promise,
      async (text) => dispatched.push(text)
    );
    let result;
    await act(() => {
      result = h.send("hello");
      result.catch(() => {}); // asserted below
    });
    await act(() => settleWrite(write));
    await assert.rejects(result, reason);
    assert.deepEqual(h.messages, [], "the optimistic message is taken back out");
    assert.deepEqual(dispatched, []);
  });
}

test("once saved, a failing reply still counts as sent", async (t) => {
  const diagnostic = t.mock.method(console, "error", () => {});
  t.after(() => assert.equal(diagnostic.mock.callCount(), 1));
  const h = await mountRealSender(
    t,
    async (_id, _role, content) => row(content),
    async () => {
      throw new Error("stream setup failed");
    }
  );
  let result;
  await act(() => {
    result = h.send("hello");
  });
  assert.equal(await result, true);
  assert.deepEqual(
    h.messages.map((m) => m.content),
    ["hello"],
    "the thread shows it, so the composer must not offer it again"
  );
});

for (const firstSend of [false, true]) {
  test(`admitted route survives a deferred ${firstSend ? "conversation creation and " : ""}write through real request construction`, async (t) => {
    let root;
    let service;
    t.mock.method(console, "log", (message) => {
      assert.match(String(message), /Repaired transcription routing/);
    });
    t.after(async () => {
      if (root) await React.act(async () => root.unmount());
      service?.destroy();
    });
    const write = deferred();
    const creation = deferred();
    const finishStream = deferred();
    let agentState;
    const requests = [];
    let eventListener;
    installBrowserGlobals(t, {
      window: {
        electronAPI: {
          createAgentConversation: () => creation.promise,
          addAgentMessage: () => write.promise,
          personalInference: {
            onTextEvent(listener) {
              eventListener = listener;
              return () => {};
            },
            async textStream(request) {
              requests.push(request);
              await finishStream.promise;
              eventListener({ requestId: request.requestId, type: "end" });
            },
            async textCancel() {
              finishStream.resolve();
            },
          },
        },
      },
    });
    installHookDom(t);
    const tree = installTree();
    const vite = await createRendererServer(t, rendererOptions("loqui-chat-admission-"));
    const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
    const { useChatStreaming } = await vite.ssrLoadModule("/components/chat/useChatStreaming.ts");
    const { useChatPersistence } = await vite.ssrLoadModule(
      "/components/chat/useChatPersistence.ts"
    );
    const { useChatMessageSender } = await vite.ssrLoadModule(
      "/components/chat/useChatMessageSender.ts"
    );
    service = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
    const routeA = {
      chatAgentMode: "providers",
      chatAgentProvider: "custom",
      chatAgentModel: "model-a",
      chatAgentCloudBaseUrl: "https://a.invalid/v1",
      chatAgentDisableThinking: true,
    };
    useSettingsStore.setState(routeA);
    localStorage.setItem("personalWebSearch:chatIntelligence", "true");
    let send;
    function Harness() {
      const persistence = useChatPersistence({ conversationId: firstSend ? null : 7 });
      const streaming = useChatStreaming({
        conversationId: persistence.conversationId,
        messages: persistence.messages,
        setMessages: persistence.setMessages,
      });
      agentState = streaming.agentState;
      send = useChatMessageSender({
        conversationId: persistence.conversationId,
        persistence,
        streaming,
        createConversation: (text) => persistence.createConversation(text),
      });
      return null;
    }
    root = createRoot(tree.container);
    await act(() => root.render(React.createElement(Harness)));
    let pending;
    await act(() => {
      pending = send("bound to A");
    });
    assert.equal(requests.length, 0);
    useSettingsStore.setState({
      chatAgentMode: "self-hosted",
      chatAgentProvider: "lan",
      chatAgentModel: "model-b",
      chatAgentRemoteUrl: "https://b.invalid/v1",
      chatAgentDisableThinking: false,
    });
    if (firstSend) await act(() => creation.resolve({ id: 7 }));
    assert.equal(requests.length, 0, "no provider request before saved row");
    await act(() => write.resolve(row("bound to A")));
    assert.equal(
      agentState,
      "streaming",
      "first-conversation creation must not clear its active reply state"
    );
    await act(async () => {
      finishStream.resolve();
      assert.equal(await pending, true);
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].provider, "custom");
    assert.equal(requests[0].model, "model-a");
    assert.equal(requests[0].baseUrl, "https://a.invalid/v1");
    assert.equal(requests[0].disableThinking, true);
    assert.equal(requests[0].inferenceScope, "chatIntelligence");
  });
}

for (const finish of ["complete", "unmount"]) {
  test(`admitted A reply stays in A after loading B (${finish})`, async (t) => {
    let root;
    let service;
    t.mock.method(console, "log", (message) => {
      assert.match(String(message), /Repaired transcription routing/);
    });
    t.after(async () => {
      if (root) await React.act(async () => root.unmount());
      service?.destroy();
    });
    const write = deferred();
    const streamDone = deferred();
    const started = deferred();
    const writes = [];
    const requests = [];
    const searchScopes = [];
    const histories = new Map([
      [7, []],
      [8, [{ role: "user", content: "B history" }]],
    ]);
    let listener;
    installBrowserGlobals(t, {
      window: {
        electronAPI: {
          async semanticSearchNotes(_text, _limit, spaceId, folderId) {
            searchScopes.push({ spaceId, folderId });
            return [];
          },
          async getAgentConversation(id) {
            return { id, messages: histories.get(id) };
          },
          async addAgentMessage(id, role, content) {
            writes.push({ id, role, content });
            if (role === "user") await write.promise;
            histories.get(id).push({ role, content });
            return { ...row(content), conversation_id: id, role };
          },
          personalInference: {
            onTextEvent(fn) {
              listener = fn;
              return () => {};
            },
            async textStream(request) {
              requests.push(request);
              listener({
                requestId: request.requestId,
                type: "chunk",
                chunk: { type: "content", text: "A answer" },
              });
              started.resolve();
              await streamDone.promise;
              listener({ requestId: request.requestId, type: "end" });
            },
            async textCancel() {
              streamDone.resolve();
            },
          },
        },
      },
    });
    installHookDom(t);
    const tree = installTree();
    const vite = await createRendererServer(t, rendererOptions("loqui-chat-navigation-owner-"));
    const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
    const { useChatStreaming } = await vite.ssrLoadModule("/components/chat/useChatStreaming.ts");
    const { useChatPersistence } = await vite.ssrLoadModule(
      "/components/chat/useChatPersistence.ts"
    );
    const { useChatMessageSender } = await vite.ssrLoadModule(
      "/components/chat/useChatMessageSender.ts"
    );
    service = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
    useSettingsStore.setState({
      chatAgentMode: "providers",
      chatAgentProvider: "custom",
      chatAgentModel: "model-a",
      chatAgentCloudBaseUrl: "https://a.invalid/v1",
    });
    let persistence;
    let send;
    let persistedAnnouncements = 0;
    function Harness() {
      persistence = useChatPersistence({ conversationId: 7 });
      const streaming = useChatStreaming({
        conversationId: persistence.conversationId,
        messages: persistence.messages,
        setMessages: persistence.setMessages,
        noteContext: persistence.conversationId === 7 ? "A note context" : "B note context",
        searchScope: { spaceId: persistence.conversationId ?? 7 },
        onStreamComplete: (_id, text, tools) => {
          void persistence.saveAssistantMessage(text, tools);
        },
      });
      send = useChatMessageSender({
        conversationId: persistence.conversationId,
        persistence,
        streaming,
        createConversation: async () => 7,
        onMessagePersisted: () => {
          persistedAnnouncements += 1;
        },
      });
      return null;
    }
    root = createRoot(tree.container);
    await act(() => root.render(React.createElement(Harness)));
    let pending;
    await act(() => {
      pending = send("A question");
    });
    await act(() => persistence.loadConversation(8));
    const visibleB = persistence.messages;
    useSettingsStore.setState({
      chatAgentModel: "model-b",
      chatAgentCloudBaseUrl: "https://b.invalid/v1",
    });
    await act(() => write.resolve());
    await started.promise;
    assert.deepEqual(searchScopes, [{ spaceId: 7, folderId: null }]);
    assert.match(requests[0].systemPrompt, /A note context/);
    assert.doesNotMatch(requests[0].systemPrompt, /B note context/);
    assert.equal(requests[0].model, "model-a");
    assert.equal(requests[0].baseUrl, "https://a.invalid/v1");
    assert.deepEqual(
      persistence.messages,
      visibleB,
      "A placeholder/content never enters B's visible messages"
    );
    if (finish === "unmount") {
      await act(() => root.unmount());
      root = null;
    } else await act(() => streamDone.resolve());
    await act(async () => assert.equal(await pending, true));
    assert.equal(
      persistedAnnouncements,
      0,
      "A persistence callback cannot change B composer state"
    );
    assert.deepEqual(writes, [
      { id: 7, role: "user", content: "A question" },
      { id: 7, role: "assistant", content: "A answer" },
    ]);
    assert.deepEqual(histories.get(8), [{ role: "user", content: "B history" }]);
    assert.deepEqual(persistence.messages, visibleB);
  });
}
