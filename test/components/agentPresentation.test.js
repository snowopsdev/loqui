const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  installBrowserGlobals,
  installHookDom,
  createRendererServer,
} = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");
const { installTree } = require("../helpers/harness/fakeDomTree");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const act = (fn) =>
  React.act(async () => {
    await fn();
    await new Promise((r) => setTimeout(r, 0));
  });

// Production panel -> shared sender -> inference/streaming/persistence -> synthetic IPC.
// No second inference capture, attachment capture or real provider is substituted.
for (const [name, attachment, acceptedImage, terminal] of [
  ["text", false, false, "stop"],
  ["vision", true, true, "stop"],
  ["unsupported image", true, false, "stop"],
  ["unmount", false, false, "unmount"],
])
  test(`typed Agent publishes its actual ${name} admission before create/save and retires on ${terminal} against a hung transport`, async (t) => {
    let root, service;
    t.after(async () => {
      if (root) await act(() => root.unmount());
      service?.destroy();
      delete globalThis.__agentSend;
    });
    const create = deferred(),
      save = deferred(),
      assistantSave = deferred(),
      transport = deferred();
    const requests = [],
      saves = [];
    let listener;
    installBrowserGlobals(t, {
      window: {
        electronAPI: {
          getPlatform: () => "linux",
          onWindowBlur: () => () => {},
          createAgentConversation: () => create.promise,
          addAgentMessage: async (id, role, content) => {
            saves.push({ id, role, content });
            if (role === "user") await save.promise;
            else await assistantSave.promise;
            return {
              id: saves.length,
              conversation_id: id,
              role,
              content,
              created_at: "2026-10-19",
            };
          },
          personalInference: {
            onTextEvent: (cb) => ((listener = cb), () => {}),
            textStream: async (request) => {
              requests.push(request);
              await transport.promise;
              listener({ requestId: request.requestId, type: "end" });
            },
            textCancel: async () => {},
          },
        },
      },
    });
    installHookDom(t);
    const tree = installTree();
    const vite = await createRendererServer(
      t,
      rendererOptions("loqui-agent-presentation-", {
        "/chat/useChatMessageSender": `import {useChatMessageSender as real} from "/components/chat/useChatMessageSender.ts"; export function useChatMessageSender(p) { const send=real(p); globalThis.__agentSend=send; return send; }`,
        "/useVoiceDraft": `export const useVoiceDraft = () => ({status:"idle",start(){},stop(){},cancel(){},elapsed:0,readLevel:()=>0,streamingOnlyProvider:false});`,
      })
    );
    const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
    useSettingsStore.setState({
      useDictationAgent: true,
      dictationAgentMode: "providers",
      dictationAgentProvider: "openai",
      dictationAgentModel: attachment && !acceptedImage ? "o1-mini" : "gpt-4o-mini",
      voiceAgentScreenContext: true,
      useDictationAgentVisionModel: acceptedImage,
      dictationAgentVisionMode: "providers",
      dictationAgentVisionProvider: "anthropic",
      dictationAgentVisionModel: "claude-sonnet-4-5",
    });
    const { AssistantPanel } = await vite.ssrLoadModule("/components/dictation/AssistantPanel.tsx");
    const { useAssistantPanel } = await vite.ssrLoadModule("/hooks/useAssistantPanel.js");
    const { agentPillCaption, sessionPillRoutes } = await vite.ssrLoadModule(
      "/components/dictation/pillLocality.ts"
    );
    service = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
    let owner;
    let panelVisible = true;
    function Harness() {
      owner = useAssistantPanel({
        requestMainWindowSize: async () => {},
        wordsCardVisible: false,
        recordingControlsRef: { current: null },
      });
      return panelVisible
        ? React.createElement(AssistantPanel, {
            pendingCommand: null,
            onCommandConsumed: owner.handleCommandConsumed,
            onCommandDiscarded: owner.handleCommandDiscarded,
            onCommandSettled: owner.handleCommandSettled,
            initialConversationId: null,
            onConversationIdChange: owner.setConversationId,
            voiceState: "idle",
            thinking: owner.thinking,
            open: true,
            footerPhase: "pill",
            horizontalDirection: "right",
            onClose: owner.handleClose,
            onBusyChange: owner.setBusy,
            onAdmissionPresentation: owner.handleTypedAdmission,
            onResponseReadyChange: owner.setResponseReady,
            onResponseContent: owner.handleResponseContent,
            onConversationReset: owner.handleConversationReset,
            onSelectionContextChange: owner.handleSelectionContextChange,
          })
        : null;
    }
    root = createRoot(tree.container);
    await act(() => root.render(React.createElement(Harness)));
    let pending;
    const submittedOptions = attachment
      ? { attachment: { image: "data:image/png;base64,AA==", mediaType: "image/png" } }
      : {};
    await act(() => {
      pending = globalThis.__agentSend("keep this turn", submittedOptions);
    });
    // Replacing the composer's current attachment across either wait must not
    // replace the admitted turn's attachment or create a new vision decision.
    submittedOptions.attachment = { image: "data:image/png;base64,Qg==", mediaType: "image/png" };
    const presentation = owner.typedPresentation;
    assert.ok(presentation, "published synchronously before first creation await");
    assert.equal(owner.thinking, true);
    const route = sessionPillRoutes(presentation)[0];
    assert.equal(route.providerId, acceptedImage ? "anthropic" : "openai");
    assert.equal(
      presentation.settings.voiceAgentScreenContext,
      acceptedImage,
      "typed text does not inherit a live screen intent without an accepted attachment"
    );
    assert.equal(Object.isFrozen(presentation.routes), true);
    const encoded = JSON.stringify(presentation);
    assert.doesNotMatch(encoded, /customApiKey|credential|data:image|claude.*secret|https:/i);
    assert.deepEqual(Object.keys(presentation.settings).sort(), [
      "useCleanupModel",
      "voiceAgentScreenContext",
    ]);
    const caption = () =>
      agentPillCaption(owner.typedPresentation, "thinking", (k, o) => `${k}|${o?.where ?? ""}`);
    assert.match(
      caption(),
      acceptedImage ? /thinkingScreenContext\|Anthropic/ : /thinking\|OpenAI/
    );
    await act(() =>
      useSettingsStore.setState({
        dictationAgentProvider: "gemini",
        dictationAgentModel: "gemini-2.5-flash",
        voiceAgentScreenContext: false,
        dictationAgentVisionProvider: "openai",
        dictationAgentVisionModel: "gpt-4o",
      })
    );
    await act(() => create.resolve({ id: 7 }));
    assert.equal(owner.typedPresentation, presentation);
    assert.equal(requests.length, 0);
    await act(() =>
      useSettingsStore.setState({
        dictationAgentMode: "local",
        dictationAgentModel: "different-local-model",
      })
    );
    submittedOptions.attachment = undefined;
    await act(() => save.resolve());
    assert.equal(requests.length, 1);
    assert.equal(requests[0].provider, route.providerId);
    assert.equal(requests[0].model, route.model);
    assert.equal(
      owner.typedPresentation,
      presentation,
      "streaming retains the same owner despite settings changes"
    );
    assert.equal(saves.filter((s) => s.role === "user").length, 1);
    assert.equal(
      JSON.stringify(requests[0]).includes("data:image"),
      acceptedImage,
      "only the admitted accepted attachment travels"
    );
    assert.equal(
      JSON.stringify(requests[0]).includes("Qg=="),
      false,
      "a newly selected attachment never replaces the admitted one"
    );
    await act(() =>
      listener({
        requestId: requests[0].requestId,
        type: "chunk",
        chunk: { type: "content", text: "partial reply" },
      })
    );
    await act(() => listener({ requestId: requests[0].requestId, type: "end" }));
    assert.equal(
      saves.filter((s) => s.role === "assistant").length,
      1,
      "assistant persistence has begun"
    );
    // Actual ChatInput Stop, while the synthetic transport deliberately ignores cancel.
    const stop = tree.find(
      (n) => n.tagName === "BUTTON" && n.attributes?.["aria-label"] === "agentMode.input.cancel"
    );
    const cancel =
      stop ??
      tree.find((n) => n.tagName === "BUTTON" && n.attributes?.["aria-label"] === "common.cancel");
    assert.ok(cancel, "actual Stop is present");
    await act(() => {
      if (terminal === "unmount") {
        panelVisible = false;
        root.render(React.createElement(Harness));
      } else tree.props(cancel).onClick();
    });
    assert.equal(
      owner.typedPresentation,
      null,
      "Stop retires ownership before hung transport finally"
    );
    assert.equal(owner.thinking, false);
    let finished = false;
    pending.then(() => {
      finished = true;
    });
    assert.equal(
      finished,
      false,
      "assistant persistence still owns the old asynchronous completion"
    );
    let releaseNew;
    const next = {
      ...presentation,
      settings: { ...presentation.settings, voiceAgentScreenContext: false },
    };
    await act(() => {
      releaseNew = owner.handleTypedAdmission(next);
    });
    await act(async () => {
      assistantSave.resolve();
      transport.resolve();
      await pending;
    });
    assert.equal(
      saves.filter((s) => s.role === "assistant").length,
      1,
      "assistant reply persists exactly once despite Stop during save"
    );
    assert.equal(owner.typedPresentation, next, "old finally cannot clear the new owner");
    await act(() => releaseNew());
    assert.equal(owner.typedPresentation, null);
  });
