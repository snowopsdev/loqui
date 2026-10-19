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

// Mounted production sender + streaming + reasoning + persistence. Only typed
// preload IPC is synthetic: no provider, profile, credentials, or network.
async function harness(
  t,
  { firstSend = false, citations = true, fallback = false, pins = false } = {}
) {
  let root;
  let service;
  t.mock.method(console, "log", (message) =>
    assert.match(String(message), /Repaired transcription routing/)
  );
  t.after(async () => {
    if (root) await act(() => root.unmount());
    service?.destroy();
  });
  const writes = [];
  const histories = new Map([
    [7, []],
    [8, [{ role: "user", content: "B history" }]],
  ]);
  const creation = deferred(),
    userWrite = deferred(),
    search = deferred(),
    assistantWrite = deferred();
  let deferAssistant = false;
  const searches = [],
    requests = [],
    toolResults = [],
    listeners = new Set();
  let currentRequest;
  const emit = (event) => {
    for (const fn of listeners) fn({ requestId: currentRequest.requestId, ...event });
  };
  const note = {
    id: 17,
    title: "A source",
    content: "A raw source",
    enhanced_content: "A enhanced source",
    note_type: "meeting",
    updated_at: "2026-10-13",
  };
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        createAgentConversation: () => creation.promise,
        semanticSearchNotes: async (...args) => {
          searches.push(args);
          return search.promise;
        },
        getNote: async (id) => (id === 17 ? note : null),
        getAgentConversation: async (id) => ({ id, messages: histories.get(id) }),
        addAgentMessage: async (id, role, content, metadata) => {
          writes.push({ id, role, content, metadata });
          if (role === "user") await userWrite.promise;
          if (role === "assistant" && deferAssistant) await assistantWrite.promise;
          const saved = {
            ...row(content),
            conversation_id: id,
            role,
            metadata: metadata ? JSON.stringify(metadata) : undefined,
          };
          histories.get(id).push(saved);
          return saved;
        },
        personalInference: {
          onTextEvent: (fn) => {
            listeners.add(fn);
            return () => listeners.delete(fn);
          },
          textStream: async (request) => {
            currentRequest = request;
            requests.push(request);
          },
          textToolResult: async (result) => {
            toolResults.push(result);
          },
          textCancel: async () => emit({ type: "end" }),
        },
      },
    },
  });
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(t, rendererOptions("loqui-citation-persistence-"));
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useChatStreaming } = await vite.ssrLoadModule("/components/chat/useChatStreaming.ts");
  const { useChatPersistence } = await vite.ssrLoadModule("/components/chat/useChatPersistence.ts");
  const { useChatMessageSender } = await vite.ssrLoadModule(
    "/components/chat/useChatMessageSender.ts"
  );
  service = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
  useSettingsStore.setState({
    chatAgentMode: "providers",
    chatAgentProvider: "custom",
    chatAgentModel: "model-a",
    chatAgentCloudBaseUrl: "https://a.invalid/v1",
    chatAgentDisableThinking: true,
  });
  let pinnedItems = [{ kind: "note", id: 27, label: "P pinned" }];
  const pinnedRead = deferred();
  const pinReads = [];
  const { buildPinnedContext } = await vite.ssrLoadModule("/components/chat/contextRail.ts");
  let external = "A external context",
    scope = { spaceId: 3, folderId: 4 };
  const h = {
    writes,
    histories,
    creation,
    userWrite,
    search,
    searches,
    requests,
    toolResults,
    emit,
    note,
    useSettingsStore,
    vite,
    assistantWrite,
    listeners,
    pinnedRead,
    pinReads,
    changePins: () => {
      pinnedItems = [{ kind: "note", id: 28, label: "Q pinned" }];
    },
  };
  function Harness() {
    const persistence = useChatPersistence({ conversationId: firstSend ? null : 7 });
    const streaming = useChatStreaming({
      conversationId: persistence.conversationId,
      messages: persistence.messages,
      setMessages: persistence.setMessages,
      noteContext: external,
      searchScope: scope,
      citations,
      ...(pins
        ? {
            getPinnedContext: () =>
              buildPinnedContext(
                pinnedItems.map((item) => ({ ...item })),
                {
                  getNote: (id) => {
                    pinReads.push(id);
                    return id === 27
                      ? pinnedRead.promise
                      : Promise.resolve({ id: 28, title: "Q pinned", content: "Q body" });
                  },
                  getNotes: async () => [],
                  getTranscriptionById: async () => null,
                }
              ),
          }
        : {}),
      onStreamComplete: fallback
        ? (_id, content, calls, context) =>
            persistence.saveAssistantMessage(content, calls, undefined, context)
        : () => {
            throw new Error("owner must handle persistence");
          },
    });
    h.persistence = persistence;
    h.streaming = streaming;
    h.send = useChatMessageSender({
      conversationId: persistence.conversationId,
      persistence,
      streaming,
      createConversation: (text, selection) =>
        persistence.createConversation(text, undefined, undefined, selection),
    });
    return null;
  }
  root = createRoot(tree.container);
  await act(() => root.render(React.createElement(Harness)));
  h.context = async (text, nextScope) => {
    external = text;
    scope = nextScope;
    await act(() => root.render(React.createElement(Harness)));
  };
  h.unmount = async () => {
    await act(() => root.unmount());
    root = null;
  };
  h.deferAssistant = () => {
    deferAssistant = true;
  };
  return h;
}

for (const firstSend of [false, true]) {
  test(`late source metadata stays with admitted A through user-save and RAG waits (${firstSend ? "first creation" : "existing"})`, async (t) => {
    const h = await harness(t, { firstSend });
    const { useRouteFactsStore } = await h.vite.ssrLoadModule("/stores/routeFactsStore.ts");
    const { useSealedStore } = await h.vite.ssrLoadModule("/stores/sealedStore.ts");
    let pending;
    await act(() => {
      pending = h.send("A question");
    });
    await act(() => h.persistence.loadConversation(8));
    await h.context("B context during user-save", { spaceId: 8 });
    h.useSettingsStore.setState({
      chatAgentModel: "model-b",
      chatAgentCloudBaseUrl: "https://b.invalid/v1",
    });
    useRouteFactsStore.setState(({ facts }) => ({
      facts: {
        ...facts,
        credentials: new Map([["openai", true]]),
        installed: { ...facts.installed, llm: new Set(["new-model"]) },
      },
    }));
    useSealedStore.setState({ sealed: true, known: true });
    if (firstSend) await act(() => h.creation.resolve({ id: 7 }));
    assert.equal(h.requests.length, 0);
    await act(() => h.userWrite.resolve());
    assert.deepEqual(h.searches, [["A question", 5, 3, 4]]);
    assert.equal(h.requests.length, 0, "RAG is still pending");
    await h.context("B context during RAG", { spaceId: 9 });
    h.useSettingsStore.setState({
      chatAgentMode: "providers",
      chatAgentProvider: "openai",
      chatAgentModel: "gpt-4o",
    });
    useRouteFactsStore.setState(({ facts }) => ({ facts: { ...facts, credentials: null } }));
    useSealedStore.setState({ sealed: false, known: true });
    await act(() => h.search.resolve([{ id: 17, title: "A source" }]));
    const visibleB = h.persistence.messages;
    assert.equal(h.requests[0].model, "model-a");
    assert.equal(h.requests[0].baseUrl, "https://a.invalid/v1");
    assert.match(h.requests[0].systemPrompt, /A external context/);
    assert.match(h.requests[0].systemPrompt, /A raw source/);
    assert.doesNotMatch(h.requests[0].systemPrompt, /B context/);
    assert.match(h.requests[0].systemPrompt, /\[note:ID\]/);
    assert.deepEqual(h.requests[0].messages, [{ role: "user", content: "A question" }]);
    await act(() =>
      h.emit({ type: "tool", callId: "get-17", name: "get_note", arguments: { id: 17 } })
    );
    assert.equal(h.toolResults.length, 1);
    await act(() => {
      h.emit({ type: "chunk", chunk: { type: "content", text: "A answer [note:17]" } });
      h.emit({ type: "end" });
    });
    await act(async () => assert.equal(await pending, true));
    assert.deepEqual(
      h.writes.map(({ id, role }) => [id, role]),
      [
        [7, "user"],
        [7, "assistant"],
      ]
    );
    assert.deepEqual(h.persistence.messages, visibleB);
    assert.deepEqual(h.histories.get(8), [{ role: "user", content: "B history" }]);
    const expected = {
      ragNotes: [
        { id: 17, title: "A source", type: "meeting", date: "2026-10-13", quote: "A raw source" },
      ],
      route: { model: "model-a", providerId: "custom", locality: "remote" },
    };
    assert.deepEqual(h.writes[1].metadata.context, expected);
    assert.deepEqual(h.writes[1].metadata.toolCalls[0].metadata, {
      id: 17,
      title: "A source",
      date: "2026-10-13",
      type: "meeting",
      quote: "A enhanced source",
    });
    await act(() => h.persistence.loadConversation(7));
    assert.deepEqual(h.persistence.messages[1].context, expected);
    assert.deepEqual(h.persistence.messages[1].toolCalls, h.writes[1].metadata.toolCalls);
    assert.equal(h.listeners.size, 0, "reasoning unsubscribes after finishing");
    // The following admission takes the changed context/scope/model.
    await act(() => {
      pending = h.send("next question");
    });
    assert.deepEqual(h.searches[1], ["next question", 5, 9, null]);
    assert.equal(h.requests[1].model, "gpt-4o");
    assert.match(h.requests[1].systemPrompt, /B context during RAG/);
    await act(() => h.emit({ type: "end" }));
    await act(() => pending);
    assert.equal(h.writes.at(-1).metadata.context.route.providerId, "openai");
    assert.equal(h.writes.at(-1).metadata.context.route.locality, "remote");
  });
}

for (const fallback of [false, true]) {
  for (const finish of ["complete", "unmount", "stop"]) {
    test(`${fallback ? "fallback" : "owner"} completion carries source context (${finish})`, async (t) => {
      const h = await harness(t, { fallback });
      h.search.resolve([{ id: 17 }]);
      let pending;
      let deliveries = 0;
      h.userWrite.resolve();
      await act(() => {
        pending = fallback
          ? h.streaming.sendToAI("question", [], { onComplete: () => deliveries++ })
          : h.send("question", { onComplete: () => deliveries++ });
      });
      await act(() => h.emit({ type: "chunk", chunk: { type: "content", text: "partial" } }));
      if (finish === "unmount") await h.unmount();
      else if (finish === "stop") await act(() => h.streaming.cancelStream());
      else await act(() => h.emit({ type: "end" }));
      await act(() => pending);
      assert.equal(deliveries, finish === "complete" ? 1 : 0);
      const assistantWrites = h.writes.filter((w) => w.role === "assistant");
      assert.equal(assistantWrites.length, finish === "stop" ? 0 : 1);
      if (finish !== "stop") {
        assert.equal(assistantWrites[0].metadata.context.ragNotes[0].id, 17);
        assert.deepEqual(assistantWrites[0].metadata.context.route, {
          model: "model-a",
          providerId: "custom",
          locality: "remote",
        });
      }
      assert.equal(h.listeners.size, 0);
    });
  }
}

for (const interruption of ["stop", "unmount"]) {
  test(`source persistence retains rows but blocks delivery after ${interruption} during assistant-save`, async (t) => {
    const h = await harness(t);
    h.userWrite.resolve();
    h.search.resolve([{ id: 17 }]);
    h.deferAssistant();
    let pending;
    let deliveries = 0;
    await act(() => {
      pending = h.send("question", { onComplete: () => deliveries++ });
    });
    await act(() => {
      h.emit({ type: "chunk", chunk: { type: "content", text: "answer" } });
      h.emit({ type: "end" });
    });
    assert.equal(h.writes.length, 2);
    if (interruption === "stop") await act(() => h.streaming.cancelStream());
    else await h.unmount();
    await act(() => h.assistantWrite.resolve());
    await act(() => pending);
    assert.equal(deliveries, 0);
    assert.equal(h.histories.get(7).length, 2);
    assert.equal(JSON.parse(h.histories.get(7)[1].metadata).context.ragNotes[0].id, 17);
  });
}

test("legacy and malformed history metadata stays loadable", async (t) => {
  const h = await harness(t);
  h.histories.set(
    7,
    [
      undefined,
      "{bad",
      "null",
      "[]",
      '{"context":null}',
      '{"context":{"route":null}}',
      '{"context":"bad"}',
      '{"context":{"ragNotes":{}}}',
      '{"context":{"pinnedNotes":"bad"}}',
    ].map((metadata) => ({
      role: "assistant",
      content: "old",
      metadata,
    }))
  );
  await act(() => h.persistence.loadConversation(7));
  assert.equal(h.persistence.messages.length, 9);
  assert.ok(
    h.persistence.messages.filter((_, index) => index !== 5).every((m) => m.context === undefined)
  );
  assert.deepEqual(h.persistence.messages[5].context, { route: null });
});

for (const destination of ["new-null", "A-again"]) {
  test(`selection generation prevents late A citation UI after A→B→${destination}`, async (t) => {
    const h = await harness(t, { firstSend: destination === "new-null" });
    h.search.resolve([{ id: 17 }]);
    let pending;
    await act(() => {
      pending = h.send("admitted A");
    });
    await act(() => h.persistence.loadConversation(8));
    if (destination === "new-null") await act(() => h.persistence.handleNewChat());
    else await act(() => h.persistence.loadConversation(7));
    const visible = h.persistence.messages;
    if (destination === "new-null") await act(() => h.creation.resolve({ id: 7 }));
    await act(() => h.userWrite.resolve());
    await act(() => {
      h.emit({ type: "chunk", chunk: { type: "content", text: "late A" } });
      h.emit({ type: "end" });
    });
    await act(() => pending);
    assert.equal(h.persistence.conversationId, destination === "new-null" ? null : 7);
    assert.deepEqual(
      h.persistence.messages,
      visible,
      "same id does not restore an older display generation"
    );
    assert.deepEqual(
      h.writes.map((w) => [w.id, w.role]),
      [
        [7, "user"],
        [7, "assistant"],
      ]
    );
    assert.equal(h.writes[1].metadata.context.ragNotes[0].id, 17);
    assert.deepEqual(h.histories.get(8), [{ role: "user", content: "B history" }]);
  });
}

for (const citations of [false, true]) {
  test(`citation suffix opt-in=${citations} only applies when a source lane exists`, async (t) => {
    const h = await harness(t, { fallback: true, citations });
    h.search.resolve([]);
    // <4B local/LAN model has no tool registry. No RAG hits means no sources.
    h.useSettingsStore.setState({
      chatAgentMode: "self-hosted",
      chatAgentProvider: "lan",
      chatAgentModel: "qwen-1b",
      chatAgentRemoteUrl: "https://local-fixture.invalid/v1",
    });
    let pending;
    await act(() => {
      pending = h.streaming.sendToAI("no sources", []);
    });
    assert.doesNotMatch(h.requests[0].systemPrompt, /\[note:ID\]/);
    await act(() => h.emit({ type: "end" }));
    await act(() => pending);
    h.useSettingsStore.setState({
      chatAgentMode: "providers",
      chatAgentProvider: "custom",
      chatAgentModel: "model-a",
    });
    await act(() => {
      pending = h.streaming.sendToAI("tools available", []);
    });
    assert.equal(h.requests[1].systemPrompt.includes("[note:ID]"), citations);
    await act(() => h.emit({ type: "end" }));
    await act(() => pending);
  });
}

for (const firstSend of [false, true])
  test(`pins captured before creation/user-save persist only A through B (${firstSend})`, async (t) => {
    const h = await harness(t, { firstSend, pins: true });
    let pending;
    await act(() => {
      pending = h.send("pin question");
    });
    assert.deepEqual(
      h.pinReads,
      [27],
      "local content read begins before user-save/create finishes"
    );
    h.changePins();
    await act(() => h.persistence.loadConversation(8));
    await h.context("B live context", { spaceId: 8 });
    h.useSettingsStore.setState({
      chatAgentModel: "model-b",
      chatAgentCloudBaseUrl: "https://b.invalid/v1",
    });
    if (firstSend) await act(() => h.creation.resolve({ id: 7 }));
    await act(() => h.userWrite.resolve());
    await act(() => h.search.resolve([]));
    assert.equal(h.requests.length, 0, "pins are still pending after user-save and RAG");
    await act(() =>
      h.pinnedRead.resolve({ id: 27, title: "P pinned", content: "P original body" })
    );
    assert.equal(h.requests.length, 1);
    const request = h.requests[0];
    assert.equal(request.model, "model-a");
    assert.equal(request.baseUrl, "https://a.invalid/v1");
    assert.match(request.systemPrompt, /A external context/);
    assert.match(request.systemPrompt, /P original body/);
    assert.doesNotMatch(request.systemPrompt, /Q body|B live context/);
    assert.match(request.systemPrompt, /\[note:ID\]/);
    const visibleB = h.persistence.messages;
    await act(() => {
      h.emit({ type: "chunk", chunk: { type: "content", text: "Pinned answer [note:27]" } });
      h.emit({ type: "end" });
    });
    await act(() => pending);
    assert.deepEqual(h.persistence.messages, visibleB);
    assert.deepEqual(h.histories.get(8), [{ role: "user", content: "B history" }]);
    assert.deepEqual(
      h.writes.map((w) => [w.id, w.role]),
      [
        [7, "user"],
        [7, "assistant"],
      ]
    );
    assert.deepEqual(
      h.writes[1].metadata.context.pinnedNotes.map((n) => n.id),
      [27]
    );
    await act(() => h.persistence.loadConversation(7));
    assert.equal(h.persistence.messages[1].context.pinnedNotes[0].title, "P pinned");
    assert.deepEqual(h.persistence.messages[1].context.route, {
      model: "model-a",
      providerId: "custom",
      locality: "remote",
    });
    await act(() => {
      pending = h.send("next current");
    });
    assert.deepEqual(h.pinReads, [27, 28]);
    assert.match(h.requests[1].systemPrompt, /Q body/);
    assert.doesNotMatch(h.requests[1].systemPrompt, /P original body/);
    await act(() => h.emit({ type: "end" }));
    await act(() => pending);
  });
