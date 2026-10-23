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

for (const kind of ["typed", "spoken"])
  for (const beforeToken of [true, false])
    test(
      `actual App/AssistantPanel ${kind} retires answering on ${beforeToken ? "pre-token Esc" : "answering Stop"} while persistence remains pending`,
      { timeout: 10000 },
      async (t) => {
        let root, service, userSave, assistantSave, transport;
        t.after(async () => {
          userSave?.resolve();
          assistantSave?.resolve();
          transport?.resolve();
          if (root) await act(() => root.unmount());
          service?.destroy();
          delete globalThis.__agentSend;
          delete globalThis.__agentAppOwner;
          delete globalThis.__agentAppAudio;
        });
        userSave = deferred();
        assistantSave = deferred();
        transport = deferred();
        const requests = [],
          saves = [],
          keys = new Set();
        let listener;
        const noop = () => () => {};
        installBrowserGlobals(t, {
          initialStorage: { onboardingCompleted: "true" },
          window: {
            electronAPI: {
              getPlatform: () => "darwin",
              onWindowBlur: noop,
              onToggleDictation: noop,
              onToggleVoiceAgent: noop,
              onToggleTranslation: noop,
              onStartDictation: noop,
              onPrepareDictation: noop,
              onCancelDictationPreparation: noop,
              onStopDictation: noop,
              onCancelDictation: noop,
              resizeMainWindow: async () => ({ success: true }),
              setMainWindowInteractivity() {},
              createAgentConversation: async () => ({ id: 7 }),
              getAgentConversation: async () => ({ id: 7, messages: [] }),
              addAgentMessage: async (id, role, content) => {
                saves.push({ id, role, content });
                await (role === "user" ? userSave.promise : assistantSave.promise);
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
                textCancel: async () => {},
                textStream: async (request) => {
                  structuredClone(request);
                  requests.push(request);
                  await transport.promise;
                },
              },
            },
          },
        });
        installHookDom(t);
        const tree = installTree();
        globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 1);
        globalThis.cancelAnimationFrame = clearTimeout;
        globalThis.window.requestAnimationFrame = globalThis.requestAnimationFrame;
        globalThis.window.cancelAnimationFrame = clearTimeout;
        globalThis.document.querySelector = () => null;
        globalThis.window.clearInterval = () => {};
        globalThis.document.addEventListener = (name, cb) => {
          if (name === "keydown") keys.add(cb);
        };
        globalThis.document.removeEventListener = (name, cb) => {
          if (name === "keydown") keys.delete(cb);
        };
        globalThis.__agentAppAudio = {
          isRecording: false,
          isProcessing: false,
          isAssistantVoice: false,
          isPreparing: false,
          isStopping: false,
          micCaptureStatus: "ok",
          activeSession: null,
          cancelled: null,
          cancelHold: null,
          outcome: null,
          outcomePresentation: null,
          processingStage: null,
          liveText: { committed: "", partial: "", cleaned: null },
          toggleListening() {},
          cancelRecording() {},
          cancelProcessing() {},
          getAudioLevel: () => 0,
          undoCancel: async () => false,
          pauseUndo() {},
          resumeUndo() {},
        };
        const vite = await createRendererServer(
          t,
          rendererOptions("loqui-agent-retirement-app-", {
            "/index.css": "export default {};",
            "/hooks/useWindowResizeCompensation":
              "export const useWindowResizeCompensation=()=>{};",
            "/hooks/useAudioRecording":
              "export const useAudioRecording=()=>globalThis.__agentAppAudio;",
            "/hooks/useAssistantPanel":
              'import {useAssistantPanel as real} from "/hooks/useAssistantPanel.js"; export const useAssistantPanel=p=>(globalThis.__agentAppOwner=real(p));',
            "/chat/useChatMessageSender":
              'import {useChatMessageSender as real} from "/components/chat/useChatMessageSender.ts"; export const useChatMessageSender=p=>(globalThis.__agentSend=real(p));',
            "/components/dictation/VoiceModePanelCore":
              "export const VoiceModePanelCore=p=>p.children;",
            "/components/dictation/LiveTranscriptPanel":
              "export const LiveTranscriptPanel=()=>null;",
            "/useVoiceDraft":
              'export const useVoiceDraft=()=>({status:"idle",start(){},stop(){},cancel(){},elapsed:0,readLevel:()=>0,streamingOnlyProvider:false});',
          })
        );
        const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
        useSettingsStore.setState({
          useDictationAgent: true,
          dictationAgentMode: "providers",
          dictationAgentProvider: "openai",
          dictationAgentModel: "gpt-4o-mini",
          voiceAgentScreenContext: false,
        });
        const { default: App } = await vite.ssrLoadModule("/App.jsx");
        service = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
        root = createRoot(tree.container);
        await act(() => root.render(React.createElement(App)));

        const owner = () => globalThis.__agentAppOwner;
        await act(() => owner().openPanel());
        await act(() => new Promise((r) => setTimeout(r, 20)));
        let pending, commandId;
        const operation = {
          sessionId: "spoken-A",
          enterpriseRecipientTags: {},
          requestOptions: { providerSearch: {} },
          settings: { ...useSettingsStore.getState() },
          presentation: {
            routes: null,
            intents: { voiceAgentRequested: true, translationRequested: false },
          },
        };
        await act(() => {
          if (kind === "typed") pending = globalThis.__agentSend("A pending request");
          else {
            owner().handleCommand({ text: "A pending request", operation });
          }
        });
        commandId = owner().pendingCommand?.id;
        assert.equal(owner().busy, true);
        const orbit = () => tree.find((n) => n.attributes?.class === "agent-orbit");
        if (!beforeToken) {
          await act(() => userSave.resolve());
          await act(() =>
            listener({
              requestId: requests[0].requestId,
              type: "chunk",
              chunk: { type: "content", text: "actual first response" },
            })
          );
          assert.equal(orbit()?.attributes["data-phase"], "answering");
          await act(() => listener({ requestId: requests[0].requestId, type: "end" }));
          const cancel = tree.find(
            (n) => n.tagName === "BUTTON" && n.attributes?.["aria-label"] === "common.cancel"
          );
          assert.ok(cancel, "actual ChatInput Stop remains available during assistant saving");
          await act(() => tree.props(cancel).onClick());
        } else {
          await act(() => {
            for (const cb of [...keys])
              cb({
                key: "Escape",
                target: globalThis.document.documentElement,
                preventDefault() {},
                stopPropagation() {},
              });
          });
        }
        assert.equal(owner().typedPresentation, null);
        assert.equal(owner().responsePhase, null, "Stop retires the exact response phase");
        if (kind === "spoken") {
          assert.equal(
            owner().activeOperation,
            operation,
            "spoken banked route metadata survives Stop until actual settlement"
          );
          await act(() => owner().handleCommandResponse(commandId));
          assert.equal(
            owner().responsePhase,
            null,
            "late A response cannot revive its cancelled phase"
          );
        }
        assert.equal(
          owner().busy,
          true,
          "pending user/assistant persistence keeps the real business busy flag"
        );
        assert.equal(
          Boolean(orbit()),
          false,
          "actual App immediately removes the retired answering phase"
        );
        const locality = tree.find((n) => n.attributes?.class === "locality-ring");
        if (kind === "typed")
          assert.match(
            locality.attributes["aria-label"],
            /unknownProvider|Unknown provider/,
            "retired work stays unknown-safe"
          );
        let releaseB;
        const b = {
          agentOnly: true,
          routes: null,
          settings: {},
          intents: { voiceAgentRequested: true, translationRequested: false },
        };
        await act(() => {
          releaseB = owner().handleTypedAdmission(b);
        });
        await act(async () => {
          userSave.resolve();
          assistantSave.resolve();
          transport.resolve();
          if (beforeToken) {
            await new Promise((r) => setTimeout(r, 0));
            listener({ requestId: requests[0].requestId, type: "end" });
          }
          await pending;
        });
        await act(() => {
          if (kind === "spoken") {
            owner().handleCommandResponse(commandId);
            owner().handleCommandResponseCancelled?.(commandId);
            owner().handleCommandSettled(commandId);
          }
        });
        assert.equal(owner().typedPresentation, b, "late A settlement cannot retire B");
        assert.equal(owner().responsePhase.responded, false);
        assert.equal(
          owner().thinking,
          true,
          "late response/cancellation/settlement cannot clear B thinking"
        );
        assert.notEqual(orbit()?.attributes["data-phase"], "answering");
        await act(() => releaseB());
        assert.equal(saves.filter((s) => s.role === "user").length, 1);
        let next;
        await act(() => {
          next = globalThis.__agentSend("B fresh actual request");
        });
        assert.equal(owner().responsePhase.responded, false);
        await act(() =>
          listener({
            requestId: requests[1].requestId,
            type: "chunk",
            chunk: { type: "content", text: "B first response" },
          })
        );
        assert.equal(
          orbit()?.attributes["data-phase"],
          "answering",
          "a new actual request still starts its own first-token flourish"
        );
        await act(() => new Promise((r) => setTimeout(r, 1030)));
        assert.equal(
          Boolean(orbit()),
          false,
          "the new actual request ends answering after 1000ms while business remains busy"
        );
        assert.equal(owner().busy, true);
        await act(() => listener({ requestId: requests[1].requestId, type: "end" }));
        await act(() => next);
        assert.equal(
          saves.filter((s) => s.role === "user").length,
          2,
          "each admitted request persists its user once"
        );
      }
    );
