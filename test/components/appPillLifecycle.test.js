const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  installBrowserGlobals,
  installHookDom,
  createRendererServer,
} = require("../lib/rendererTestHarness");
const { installTree } = require("../helpers/harness/fakeDomTree");
const route = (id, locality, providerId = null) =>
  Object.freeze({
    id,
    kind: id === "dictationStt" ? "speech" : "text",
    locality,
    providerId,
    provider: providerId,
    recipient: null,
    host: null,
    model: null,
    state: Object.freeze({ status: "ready" }),
    sends: null,
    settingsPath: id,
  });
const session = Object.freeze({
  settings: Object.freeze({ useCleanupModel: false, voiceAgentScreenContext: true }),
  intents: Object.freeze({ voiceAgentRequested: true, translationRequested: false }),
  routes: Object.freeze({
    dictationStt: route("dictationStt", "device"),
    voiceAssistant: route("voiceAssistant", "remote", "anthropic"),
    assistantVision: route("assistantVision", "remote", "openai"),
  }),
});

// One bounded Vite graph. App, stage policy, useAssistantPanel, locality,
// outcome lifetime, ownership, VoicePill and caption are production code.
// Audio state, panel contents and native window/capture/clipboard leaves are synthetic.
test("App retains original destinations through audio, banked consumption/busy, held Undo and outcomes", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__pillAppAudio;
    delete globalThis.__pillAppAssistant;
    delete globalThis.__pillAppPanel;
    delete globalThis.__pillAppOptions;
    delete globalThis.__pillAppReturnResize;
  });
  const calls = [];
  let releaseUndo;
  const noop = () => () => {};
  installBrowserGlobals(t, {
    initialStorage: { floatingIconAutoHide: "true", onboardingCompleted: "true" },
    window: {
      electronAPI: {
        getPlatform: () => "darwin",
        onToggleDictation: noop,
        onToggleVoiceAgent: noop,
        onToggleTranslation: noop,
        onStartDictation: noop,
        onPrepareDictation: noop,
        onCancelDictationPreparation: noop,
        onStopDictation: noop,
        onCancelDictation: noop,
        hideWindow: async () => calls.push("hide"),
        showDictationPanel: async () => calls.push("show"),
        resizeMainWindow: async () => ({ success: true }),
        setMainWindowInteractivity() {},
        acquirePillHotkey: async () => ({ leaseId: 1, held: true }),
        releasePillHotkey: async () => {},
        onPillHotkeyPressed: noop,
        onPillHotkeyReleased: (cb) => {
          releaseUndo = cb;
          return () => {};
        },
      },
    },
  });
  installHookDom(t);
  const tree = installTree();
  globalThis.document.querySelector = () => null;
  globalThis.window.clearInterval = () => {};
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-app-pill-lifecycle-",
    mockModules: {
      "/index.css": "export default {};",
      "/hooks/useWindowResizeCompensation": "export const useWindowResizeCompensation = () => {};",
      "/hooks/useAudioRecording":
        "export const useAudioRecording = (options) => { globalThis.__pillAppOptions = options; return globalThis.__pillAppAudio; };",
      "/hooks/useMainWindowSizeOwner":
        'import { useMainWindowSizeOwner as real } from "/hooks/useMainWindowSizeOwner.js"; export const useMainWindowSizeOwner = (p) => { const value = real(p); return { ...value, panelReturnResizeActive: globalThis.__pillAppReturnResize ?? value.panelReturnResizeActive }; };',
      "/hooks/useAssistantPanel":
        'import { useAssistantPanel as real } from "/hooks/useAssistantPanel.js"; export const useAssistantPanel = (p) => (globalThis.__pillAppAssistant = real(p));',
      "/components/dictation/AssistantPanel":
        "export const AssistantPanel = (p) => { globalThis.__pillAppPanel = p; return null; };",
      // Native geometry and the unrelated transcript UI are leaves. No pill state is mocked.
      "/components/dictation/VoiceModePanelCore":
        "export const VoiceModePanelCore = (p) => p.children;",
      "/components/dictation/LiveTranscriptPanel": "export const LiveTranscriptPanel = () => null;",
    },
  });
  const { default: App } = await vite.ssrLoadModule("/App.jsx");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useSealedStore } = await vite.ssrLoadModule("/stores/sealedStore.ts");
  let undo = 0,
    pause = 0,
    resume = 0;
  globalThis.__pillAppAudio = {
    isRecording: false,
    isProcessing: false,
    isAssistantVoice: false,
    isPreparing: false,
    isStopping: false,
    micCaptureStatus: "ok",
    toggleListening() {},
    cancelRecording() {},
    cancelProcessing() {},
    getAudioLevel: () => 0,
    cancelled: null,
    undoCancel: async () => {
      undo++;
      return true;
    },
    pauseUndo: () => pause++,
    resumeUndo: () => resume++,
    processingStage: null,
    outcome: null,
    activeSession: null,
    cancelHold: null,
    outcomePresentation: null,
  };
  root = createRoot(tree.container);
  const render = async (next = {}) => {
    Object.assign(globalThis.__pillAppAudio, next);
    await React.act(async () => root.render(React.createElement(App)));
  };
  const pill = () => tree.find((n) => n.attributes?.["data-pill-state"]);
  const ring = () => tree.find((n) => n.attributes?.["data-locality"]);
  const updateSettings = async () =>
    React.act(async () =>
      useSettingsStore.setState({
        useLocalWhisper: true,
        localTranscriptionProvider: "nvidia",
        transcriptionMode: "local",
        useCleanupModel: false,
        useDictationAgent: true,
        dictationAgentMode: "local",
        voiceAgentScreenContext: false,
      })
    );
  await render({ isRecording: true, isAssistantVoice: true, activeSession: session });
  assert.match(ring().attributes["aria-label"], /Anthropic/);
  await updateSettings();
  assert.equal(ring().attributes["data-locality"], "remote");
  await render({ isRecording: false, isProcessing: true, processingStage: "cleaning" });
  assert.match(ring().attributes["aria-label"], /Anthropic/);
  const operation = Object.freeze({
    sessionId: "A",
    settings: session.settings,
    presentation: Object.freeze({ routes: session.routes, intents: session.intents }),
  });
  await React.act(async () =>
    globalThis.__pillAppAssistant.handleCommand({ text: "original words", operation })
  );
  await render({ isProcessing: false, activeSession: null, isAssistantVoice: false });
  const command = globalThis.__pillAppAssistant.pendingCommand;
  await React.act(async () => globalThis.__pillAppAssistant.handleCommandConsumed(command.id));
  assert.equal(globalThis.__pillAppAssistant.pendingCommand, null);
  await React.act(async () => globalThis.__pillAppAssistant.setBusy(true));
  assert.equal(globalThis.__pillAppAssistant.activeOperation, operation);
  assert.equal(pill().attributes.role, "status", "banked panel currently owns input");
  const presence = tree.find((n) => n.attributes?.class?.includes("assistant-pill-presence"));
  await React.act(async () => tree.props(presence).onMouseEnter());
  assert.equal(
    globalThis.__pillAppOptions.isPillHovered(),
    true,
    "actual already-hovered pointer is retained even before Undo owns input"
  );
  await React.act(async () => tree.props(presence).onMouseLeave());
  assert.equal(globalThis.__pillAppOptions.isPillHovered(), false);
  assert.match(ring().attributes["aria-label"], /Anthropic/);
  assert.equal(
    globalThis.__pillAppAssistant.activeOperation.presentation.intents.voiceAgentRequested,
    true
  );
  assert.equal(
    globalThis.__pillAppAssistant.activeOperation.settings.voiceAgentScreenContext,
    true
  );
  // Matching completion releases the operation; subsequent idle uses current settings.
  await React.act(async () => {
    globalThis.__pillAppAssistant.setBusy(false);
    globalThis.__pillAppAssistant.handleCommandSettled(command.id, { showPanel: false });
  });
  assert.equal(globalThis.__pillAppAssistant.activeOperation, null);
  assert.equal(ring().attributes["data-locality"], "device");
  await React.act(async () => globalThis.__pillAppAssistant.setBusy(true));
  assert.match(
    ring().attributes["aria-label"],
    /Unknown provider/,
    "typed busy without exposed admission is unknown-safe until Task 13"
  );
  await React.act(async () => globalThis.__pillAppAssistant.setBusy(false));
  assert.equal(ring().attributes["data-locality"], "device");
  const held = {
    sessionId: "A",
    undoUntil: Date.now() + 5000,
    remainingMs: 5000,
    paused: false,
    remoteAlreadySent: {
      target: "anthropic",
      payload: "text",
      evidence: "dispatched",
      alsoSentTo: [],
    },
  };
  await React.act(async () => globalThis.__pillAppAssistant.setBusy(true));
  await render({ cancelled: held, cancelHold: { generation: 1, durationMs: 5000, session } });
  assert.equal(pill().attributes["data-pill-state"], "cancelled");
  assert.equal(pill().attributes.role, "button");
  assert.match(ring().attributes["aria-label"], /Anthropic/);
  assert.match(tree.text(), /may have received/);
  assert.doesNotMatch(tree.text(), /already received/);
  const shortcut = tree.find((n) => n.attributes?.class === "pill-undo-shortcut");
  assert.ok(shortcut, "held lease exposes its shortcut");
  assert.equal(shortcut.attributes.dir, "ltr", "keyboard chord is isolated from Arabic RTL");
  await React.act(async () => releaseUndo({ slot: "undoCancel", leaseId: 1 }));
  assert.equal(
    tree.find((n) => n.attributes?.class === "pill-undo-shortcut"),
    null,
    "expiry removes the visible chord"
  );
  const countdown1 = tree.find((n) => n.attributes?.class === "pill-countdown");
  await React.act(async () =>
    tree
      .props(tree.find((n) => n.attributes?.class?.includes("assistant-pill-presence")))
      .onMouseEnter()
  );
  assert.equal(pause, 1);
  await React.act(async () => tree.props(pill()).onClick({ preventDefault() {} }));
  await React.act(async () =>
    tree.props(pill()).onKeyDown({ key: "Enter", repeat: false, preventDefault() {} })
  );
  assert.equal(undo, 2);
  await React.act(async () => globalThis.__pillAppAssistant.setBusy(false));
  await React.act(async () =>
    tree
      .props(tree.find((n) => n.attributes?.class?.includes("assistant-pill-presence")))
      .onMouseLeave()
  );
  assert.equal(resume, 1);
  await render({ cancelHold: { generation: 2, durationMs: 10000, session } });
  const countdown2 = tree.find((n) => n.attributes?.class === "pill-countdown");
  assert.notEqual(
    countdown2,
    countdown1,
    "fresh internal generation remounts the actual countdown DOM"
  );
  await render({ cancelled: null, cancelHold: null, isProcessing: true, activeSession: session });
  assert.match(ring().attributes["aria-label"], /Anthropic/, "Undo uses original session");
  const outcome = { kind: "pasted", words: 19, at: Date.now() };
  await render({
    isProcessing: false,
    activeSession: null,
    outcome,
    outcomePresentation: { outcome, session },
  });
  assert.equal(pill().attributes["data-pill-state"], "pasted");
  assert.match(ring().attributes["aria-label"], /Anthropic/);
  assert.match(tree.text(), /19 words/);
  await React.act(async () => new Promise((r) => setTimeout(r, 740)));
  assert.equal(pill().attributes["data-pill-state"], "idle");
  assert.equal(ring().attributes["data-locality"], "device");
  const preempted = { kind: "pasted", words: 2, at: Date.now() };
  await render({ outcome: preempted, outcomePresentation: { outcome: preempted, session } });
  assert.equal(pill().attributes["data-pill-state"], "pasted");
  await React.act(async () => globalThis.__pillAppAssistant.setBusy(true));
  assert.match(
    ring().attributes["aria-label"],
    /Unknown provider/,
    "an old outcome cannot disclose a different typed operation"
  );
  assert.notEqual(pill().attributes["data-pill-state"], "pasted");
  await React.act(async () => globalThis.__pillAppAssistant.setBusy(false));
  assert.equal(
    pill().attributes["data-pill-state"],
    "idle",
    "the old beat cannot reclaim a newer owner after settlement"
  );
  // Existing optional Sealed reader only: full production paused appearance/label/footprint.
  await React.act(async () => useSealedStore.setState({ sealed: true }));
  const failed = { kind: "failed", at: Date.now() };
  await render({ outcome: failed, outcomePresentation: { outcome: failed, session } });
  assert.equal(pill().attributes["data-pill-state"], "sealedPaused");
  assert.equal(pill().style.width, "124px");
  assert.match(tree.text(), /Paused/);
  assert.match(tree.text(), /Sealed mode is on/);
  assert.match(ring().attributes.class, /locality-ring--blocked/);

  // Exercise each footer gate independently with the real panel lifecycle.
  // Native resize acknowledgement is a synthetic leaf; this override supplies
  // only its in-flight return flag, not stage/ownership/interaction policy.
  await React.act(async () => useSealedStore.setState({ sealed: false }));
  await React.act(async () => {
    globalThis.__pillAppAssistant.handleClose();
    globalThis.__pillAppAssistant.completeContentFade();
  });
  await React.act(async () => new Promise((r) => setTimeout(r, 350)));
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  const hold = () =>
    render({
      outcome: null,
      outcomePresentation: null,
      cancelled: held,
      cancelHold: { generation: 3, durationMs: 5000, session },
    });
  const clearHold = () => render({ cancelled: null, cancelHold: null });
  const assertPresent = () => {
    const outer = tree.find(
      (n) =>
        n.attributes?.class?.includes("voice-pill-position fixed") ||
        n.attributes?.class?.includes("voice-pill-position voice-pill-position-")
    );
    assert.match(outer.attributes.class, /opacity-100/);
    assert.doesNotMatch(outer.attributes.class, /pointer-events-none/);
    assert.equal(outer.attributes["aria-hidden"], undefined);
    assert.equal(pill().attributes.role, "button");
    assert.notEqual(pill().attributes["aria-disabled"], "true");
  };
  const inner = () => tree.find((n) => n.attributes?.class?.includes("assistant-pill-presence"));
  await hold();
  await React.act(async () => globalThis.__pillAppAssistant.openPanel());
  assert.equal(globalThis.__pillAppAssistant.open, true);
  await React.act(async () => globalThis.__pillAppAssistant.setResponseReady(true));
  assert.equal(globalThis.__pillAppAssistant.footerPhase, "pill-exiting");
  assert.equal(globalThis.__pillAppPanel.footerPhase, "pill-exiting", "actions keep raw phase");
  assert.equal(
    inner().attributes["data-assistant-footer-phase"],
    "pill",
    "owned capsule bypasses inner exit animation"
  );
  assertPresent();
  await clearHold();
  assert.equal(
    inner().attributes["data-assistant-footer-phase"],
    "pill-exiting",
    "idle retains legacy footer animation"
  );
  await hold();
  await React.act(async () => globalThis.__pillAppAssistant.handleClose());
  assert.equal(globalThis.__pillAppAssistant.closing, true);
  assertPresent();
  await clearHold();
  assert.ok(
    tree.find(
      (n) =>
        n.attributes?.["aria-hidden"] === "true" &&
        n.attributes?.class?.includes("voice-pill-position")
    ),
    "idle close remains hidden"
  );
  await hold();
  await React.act(async () => globalThis.__pillAppAssistant.completeContentFade());
  await React.act(async () => new Promise((r) => setTimeout(r, 350)));
  assert.equal(globalThis.__pillAppAssistant.closing, false);
  globalThis.__pillAppReturnResize = true;
  await hold();
  assertPresent();
  await clearHold();
  assert.ok(
    tree.find(
      (n) =>
        n.attributes?.["aria-hidden"] === "true" &&
        n.attributes?.class?.includes("voice-pill-position")
    ),
    "idle return resize retains its mask"
  );
  globalThis.__pillAppReturnResize = false;
});
