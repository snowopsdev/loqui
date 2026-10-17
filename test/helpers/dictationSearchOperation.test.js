const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

for (const captured of [false, true])
  test(`spoken hosted-search ${captured} stays pinned through handoff/create/save; typed admission stays fresh`, async (t) => {
    const requests = [],
      listeners = new Set();
    installBrowserGlobals(t, {
      window: {
        electronAPI: {
          personalInference: {
            onTextEvent: (listener) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
            textCancel: async () => {},
            textStream: async (request) => {
              requests.push(request);
              for (const listener of listeners)
                listener({
                  requestId: request.requestId,
                  type: "chunk",
                  chunk: { type: "content", text: "Answer." },
                });
              for (const listener of listeners)
                listener({ requestId: request.requestId, type: "end" });
            },
          },
        },
      },
    });
    const vite = await createRendererServer(t, { cachePrefix: "loqui-spoken-search-admission-" });
    const settings = await vite.ssrLoadModule("/stores/settingsStore.ts");
    settings.useSettingsStore.setState({
      useDictationAgent: true,
      dictationAgentMode: "providers",
      dictationAgentProvider: "openai",
      dictationAgentModel: "gpt-4o-mini",
      voiceAgentScreenContext: false,
      customPrompts: {},
    });
    localStorage.setItem("personalWebSearch:dictationAgent", String(captured));
    const { captureDictationSession, sessionOperation } = await vite.ssrLoadModule(
      "/helpers/dictationSession.js"
    );
    const session = captureDictationSession({
      settings: settings.getSettings(),
      intents: { voiceAgentRequested: true },
    });
    const operation = sessionOperation(session);
    assert.equal(Object.isFrozen(operation.requestOptions.providerSearch), true);
    localStorage.setItem("personalWebSearch:dictationAgent", String(!captured));
    const { useChatStreaming } = await vite.ssrLoadModule("/components/chat/useChatStreaming.ts");
    const { useChatMessageSender } = await vite.ssrLoadModule(
      "/components/chat/useChatMessageSender.ts"
    );
    const reasoning = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
    t.after(() => reasoning.destroy());
    let createGate = deferred(),
      saveGate = deferred(),
      createEntered = deferred(),
      saveEntered = deferred();
    const persistence = {
      messages: [],
      setMessages() {},
      captureSelection: () => ({ isCurrent: () => true }),
      saveUserMessage: async () => {
        saveEntered.resolve();
        await saveGate.promise;
      },
      saveAssistantMessage: async () => {},
    };
    let send;
    function Harness() {
      const streaming = useChatStreaming({
        messages: [],
        setMessages() {},
        inferenceScope: "dictationAgent",
      });
      send = useChatMessageSender({
        conversationId: null,
        persistence,
        streaming,
        createConversation: async () => {
          createEntered.resolve();
          await createGate.promise;
          return 11;
        },
      });
      return null;
    }
    renderToStaticMarkup(React.createElement(Harness));
    const spoken = send("original spoken words", { operation });
    await createEntered.promise;
    localStorage.setItem("personalWebSearch:dictationAgent", String(!captured));
    createGate.resolve();
    await saveEntered.promise;
    localStorage.setItem("personalWebSearch:dictationAgent", String(!captured));
    saveGate.resolve();
    assert.equal(await spoken, true);
    assert.equal(requests[0].webSearch, captured);
    assert.equal(requests[0].dictationSessionId, session.id);
    // Typed follow-up admits current preferences before either persistence wait.
    createGate = deferred();
    saveGate = deferred();
    createEntered = deferred();
    saveEntered = deferred();
    const typed = send("typed follow-up");
    await createEntered.promise;
    localStorage.setItem("personalWebSearch:dictationAgent", String(captured));
    createGate.resolve();
    await saveEntered.promise;
    saveGate.resolve();
    assert.equal(await typed, true);
    assert.equal(requests[1].webSearch, !captured);
    assert.equal(requests[1].dictationOperation, undefined);
    assert.equal(requests[1].correlationId, null);
  });
