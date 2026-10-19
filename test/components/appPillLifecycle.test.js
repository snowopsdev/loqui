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
    delete globalThis.__pillAppInput;
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
      "/hooks/useLinuxPillInteractivity":
        'import { useLinuxPillInteractivity as real } from "/hooks/useLinuxPillInteractivity.ts"; export const useLinuxPillInteractivity = (p) => { globalThis.__pillAppInput = p; return real(p); };',
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
    liveText: { committed: "", partial: "", cleaned: null },
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
  const tooltipAnchor = () =>
    tree.find((n) => n.attributes?.class?.includes("pill-tooltip-anchor"));
  const tooltip = () => tree.find((n) => n.attributes?.role === "tooltip");
  await render();
  const idlePresence = () =>
    tree.props(tree.find((n) => n.attributes?.class?.includes("assistant-pill-presence")));
  await React.act(async () =>
    idlePresence().onFocusCapture({ target: { closest: () => tooltipAnchor() } })
  );
  assert.equal(
    globalThis.__pillAppOptions.isPillHovered(),
    true,
    "first keyboard focus on the idle tooltip trigger owns reading input"
  );
  await React.act(async () =>
    idlePresence().onBlurCapture({ currentTarget: { contains: () => false }, relatedTarget: null })
  );
  await React.act(async () => tree.props(tooltipAnchor()).onMouseEnter());
  assert.ok(tooltip(), "idle hover retains the full instruction and route");
  assert.match(tooltip().textContent, /Press .* to startSpeech:/);
  assert.equal(
    globalThis.__pillAppInput.captionRef.current,
    tooltip(),
    "actual tooltip uses the shared Linux reading region ref"
  );
  const readingHandlers = () =>
    tree.props(tree.find((n) => n.attributes?.class?.includes("assistant-pill-presence")));
  await React.act(async () => readingHandlers().onFocusCapture());
  assert.equal(
    globalThis.__pillAppOptions.isPillHovered(),
    true,
    "tooltip focus joins existing reader ownership"
  );
  await React.act(async () =>
    readingHandlers().onBlurCapture({
      currentTarget: { contains: () => false },
      relatedTarget: null,
    })
  );
  await React.act(async () => tree.props(tooltipAnchor()).onMouseLeave());
  assert.equal(tooltip(), null);
  await render({ isRecording: true, isAssistantVoice: true, activeSession: session });
  await React.act(async () => tree.props(tooltipAnchor()).onMouseEnter());
  assert.equal(tooltip(), null, "Agent caption owns the layer on actual hover");
  await React.act(async () => tree.props(tooltipAnchor()).onMouseLeave());
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
    "busy without exposed admission remains unknown-safe"
  );
  await React.act(async () => globalThis.__pillAppAssistant.setBusy(false));
  assert.equal(ring().attributes["data-locality"], "device");
  // Production App consumes the typed owner; old spoken settlement cannot reclaim it.
  let releaseTyped;
  const typedPresentation = {
    agentOnly: true,
    settings: { useCleanupModel: false, voiceAgentScreenContext: true },
    intents: { voiceAgentRequested: true, translationRequested: false },
    routes: { assistantVision: route("assistantVision", "remote", "gemini") },
  };
  await React.act(async () => {
    globalThis.__pillAppAssistant.handleCommand({ text: "older spoken", operation });
  });
  const oldCommand = globalThis.__pillAppAssistant.pendingCommand;
  await React.act(async () => {
    releaseTyped = globalThis.__pillAppAssistant.handleTypedAdmission(typedPresentation);
    globalThis.__pillAppAssistant.setBusy(true);
    globalThis.__pillAppAssistant.handleCommandSettled(oldCommand.id, { showPanel: false });
  });
  assert.equal(globalThis.__pillAppAssistant.typedPresentation, typedPresentation);
  globalThis.__pillAppAudio = {
    ...globalThis.__pillAppAudio,
    isRecording: true,
    isAssistantVoice: true,
    activeSession: session,
  };
  await React.act(async () => root.render(React.createElement(App)));
  assert.match(
    tree.text(),
    /Screen context on.*OpenAI/,
    "new frozen voice session outranks an older busy typed recipient"
  );
  assert.doesNotMatch(tree.text(), /Google Gemini/);
  globalThis.__pillAppAudio = {
    ...globalThis.__pillAppAudio,
    isRecording: false,
    isAssistantVoice: false,
    activeSession: null,
  };
  await React.act(async () => root.render(React.createElement(App)));
  assert.match(tree.text(), /Thinking with screen context.*Google Gemini/);
  assert.equal(
    tree.find((n) => n.attributes?.class === "agent-orbit").attributes["data-phase"],
    "thinking"
  );
  await React.act(async () => {
    useSettingsStore.setState({
      voiceAgentScreenContext: false,
      dictationAgentProvider: "anthropic",
    });
    globalThis.__pillAppAssistant.handleTypedResponse(typedPresentation);
  });
  assert.match(tree.text(), /Thinking with screen context.*Google Gemini/);
  assert.equal(
    tree.find((n) => n.attributes?.class === "agent-orbit").attributes["data-phase"],
    "answering",
    "actual App passes answering after the first token"
  );
  const audioBeforeConcurrentHold = globalThis.__pillAppAudio;
  globalThis.__pillAppAudio = {
    ...audioBeforeConcurrentHold,
    cancelled: {
      sessionId: "held-during-answering",
      remainingMs: 5000,
      paused: false,
      undoUntil: Date.now() + 5000,
      remoteAlreadySent: {
        target: "anthropic",
        payload: "audio",
        evidence: "dispatched",
        alsoSentTo: [],
      },
    },
    cancelHold: { generation: 20, durationMs: 5000, session },
  };
  await React.act(async () => root.render(React.createElement(App)));
  assert.match(
    tree.text(),
    /may have received/,
    "D3 receiver disclosure outranks Agent caption during answering"
  );
  assert.doesNotMatch(tree.text(), /Thinking with screen context/);
  await React.act(async () => tree.props(tooltipAnchor()).onMouseEnter());
  assert.equal(tooltip(), null, "D3 disclosure keeps priority over generic hover");
  await React.act(async () => tree.props(tooltipAnchor()).onMouseLeave());
  assert.equal(pill().attributes.role, "button");
  assert.equal(
    tree.find((n) => n.attributes?.class === "agent-orbit"),
    null,
    "answering never wraps or masks Undo"
  );
  globalThis.__pillAppAudio = audioBeforeConcurrentHold;
  await React.act(async () => root.render(React.createElement(App)));
  await React.act(async () => new Promise((resolve) => setTimeout(resolve, 1030)));
  assert.equal(
    tree.find((n) => n.attributes?.class === "agent-orbit"),
    null,
    "actual App never remounts thinking when the dissolve ends"
  );
  await React.act(async () => {
    releaseTyped();
    assert.equal(
      globalThis.__pillAppAssistant.activeOperation,
      null,
      "retired spoken owner never returns after typed settlement"
    );
    globalThis.__pillAppAssistant.setBusy(false);
    globalThis.__pillAppAssistant.handleCommandConsumed(oldCommand.id);
  });
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
  const caption = tree.find((n) => n.attributes?.class === "pill-caption");
  assert.equal(caption.attributes.tabindex, "0", "receiver overflow is keyboard reachable");
  assert.equal(
    globalThis.__pillAppInput.captionRef.current,
    caption,
    "actual caption joins Linux input policy"
  );
  const handlers = () =>
    tree.props(tree.find((n) => n.attributes?.class?.includes("assistant-pill-presence")));
  await React.act(async () => handlers().onFocusCapture());
  await React.act(async () => handlers().onMouseLeave());
  assert.equal(resume, 0, "focus keeps the hold paused after the pointer leaves");
  assert.equal(
    globalThis.__pillAppOptions.isPillHovered(),
    true,
    "focused reader also pauses a newly opened hold"
  );
  await React.act(async () =>
    handlers().onBlurCapture({ currentTarget: { contains: () => true }, relatedTarget: caption })
  );
  assert.equal(resume, 0, "moving focus between caption and Undo retains the pause");
  await React.act(async () => handlers().onFocusCapture());
  assert.equal(pause, 1, "internal focus movement does not publish a second pause");
  await React.act(async () => handlers().onMouseEnter());
  await React.act(async () =>
    handlers().onBlurCapture({ currentTarget: { contains: () => false }, relatedTarget: null })
  );
  assert.equal(pause, 1, "pointer and focus share one active pause");
  assert.equal(resume, 0, "pointer still inside retains pause on focus exit");
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
  await React.act(async () => handlers().onFocusCapture());
  assert.equal(pause, 2, "keyboard-only focus pauses the same hold");
  assert.equal(
    tree.find((n) => n.attributes?.class === "pill-countdown"),
    countdown1,
    "focus never changes hold generation"
  );
  await React.act(async () =>
    handlers().onBlurCapture({ currentTarget: { contains: () => false }, relatedTarget: null })
  );
  assert.equal(resume, 2, "leaving both focus and hover resumes");
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
    liveText: {
      committed: "review on thursday at two",
      partial: "",
      cleaned: "review on Thursday at 2.",
    },
  });
  assert.equal(pill().attributes["data-pill-state"], "pasted");
  assert.match(ring().attributes["aria-label"], /Anthropic/);
  assert.match(tree.text(), /19 words/);
  assert.match(tree.text(), /Thursday/);
  assert.ok(
    tree.find((n) => n.attributes?.class === "condense-word is-changed"),
    "App derives cleanup rewrites for the actual pasted outcome"
  );
  await React.act(async () => new Promise((r) => setTimeout(r, 740)));
  assert.equal(pill().attributes["data-pill-state"], "idle");
  assert.equal(ring().attributes["data-locality"], "device");
  assert.equal(
    tree.find((n) => n.attributes?.class === "condense-track"),
    null,
    "word row ends with the actual outcome beat"
  );
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
  await render();
  await React.act(async () => handlers().onFocusCapture());
  assert.equal(
    globalThis.__pillAppOptions.isPillHovered(),
    false,
    "idle focus does not create a reading hold/capture policy"
  );
});
