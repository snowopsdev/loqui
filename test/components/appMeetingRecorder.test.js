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
const act = (fn) =>
  React.act(async () => {
    await fn();
    await new Promise((r) => setImmediate(r));
  });

test("actual App meeting Stop, outcomes, ownership gates and setting/reveal use production policy", async (t) => {
  let root, service;
  t.after(async () => {
    if (root) await act(() => root.unmount());
    service?.destroy();
    for (const k of [
      "__meetingAudio",
      "__meetingAssistant",
      "__meetingInput",
      "__meetingResize",
      "__meetingPanel",
    ])
      delete globalThis[k];
  });
  const events = [],
    subscriptions = {};
  let presence = null;
  const noop = () => () => {};
  const api = {
    getPlatform: () => "darwin",
    onToggleDictation: noop,
    onToggleVoiceAgent: noop,
    onToggleTranslation: noop,
    onStartDictation: noop,
    onPrepareDictation: noop,
    onCancelDictationPreparation: noop,
    onStopDictation: noop,
    onCancelDictation: noop,
    hideWindow: async () => events.push("hide"),
    showDictationPanel: async () => events.push("show"),
    resizeMainWindow: async () => ({ success: true }),
    setMainWindowInteractivity() {},
    startWindowDrag: () => events.push("drag"),
    stopWindowDrag: () => events.push("drag-stop"),
    acquirePillHotkey: async () => ({ leaseId: 1, held: true }),
    releasePillHotkey: async () => {},
    getMeetingRecordingPresence: async () => presence,
    requestStopMeetingRecording: async (id) => events.push({ stop: id }),
    showControlPanel: async () => events.push("notes"),
  };
  for (const name of [
    "onMeetingRecordingPresenceChanged",
    "onMeetingRecorderRevealRequested",
    "onMeetingRecordingOutcome",
  ])
    api[name] = (cb) => {
      subscriptions[name] = cb;
      return () => delete subscriptions[name];
    };
  installBrowserGlobals(t, {
    initialStorage: { floatingIconAutoHide: "true", onboardingCompleted: "true" },
    window: { electronAPI: api },
  });
  installHookDom(t);
  const tree = installTree({ trackFocusRemoval: true });
  globalThis.document.querySelector = () => null;
  globalThis.window.clearInterval = () => {};
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-app-meeting-",
    mockModules: {
      "/index.css": "export default {};",
      "/hooks/useWindowResizeCompensation": "export const useWindowResizeCompensation=()=>{};",
      "/hooks/useAudioRecording":
        'import {useMeetingRecordingPresence} from "/hooks/useMeetingRecordingPresence.ts"; export const useAudioRecording=()=>({...globalThis.__meetingAudio,meetingRecording:useMeetingRecordingPresence()});',
      "/hooks/useLinuxPillInteractivity":
        'import {useLinuxPillInteractivity as real} from "/hooks/useLinuxPillInteractivity.ts";export const useLinuxPillInteractivity=p=>{globalThis.__meetingInput=p;return real(p);};',
      "/hooks/useMainWindowSizeOwner":
        'import {useMainWindowSizeOwner as real} from "/hooks/useMainWindowSizeOwner.js";export const useMainWindowSizeOwner=p=>({...real(p),panelReturnResizeActive:globalThis.__meetingResize??false});',
      "/hooks/useAssistantPanel":
        'import {useAssistantPanel as real} from "/hooks/useAssistantPanel.js";export const useAssistantPanel=p=>(globalThis.__meetingAssistant=real(p));',
      "/components/dictation/AssistantPanel":
        "export const AssistantPanel=p=>{globalThis.__meetingPanel=p;return null;};",
      "/components/dictation/VoiceModePanelCore": "export const VoiceModePanelCore=p=>p.children;",
      "/components/dictation/LiveTranscriptPanel": "export const LiveTranscriptPanel=()=>null;",
    },
  });
  const { default: App } = await vite.ssrLoadModule("/App.jsx");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const notices = await vite.ssrLoadModule("/components/ui/notices.ts");
  service = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
  globalThis.__meetingAudio = {
    isRecording: false,
    isProcessing: false,
    isAssistantVoice: false,
    isPreparing: false,
    isStopping: false,
    micCaptureStatus: "ok",
    toggleListening: () => events.push("dictation"),
    cancelRecording() {},
    cancelProcessing() {},
    getAudioLevel: () => 0,
    cancelled: null,
    cancelHold: null,
    undoCancel: async () => true,
    pauseUndo() {},
    resumeUndo() {},
    processingStage: null,
    outcome: null,
    activeSession: null,
    outcomePresentation: null,
    liveText: { committed: "", partial: "", cleaned: null },
  };
  root = createRoot(tree.container);
  const render = () => act(() => root.render(React.createElement(App)));
  const pill = () => tree.find((n) => Boolean(n.attributes?.["data-pill-state"]));
  const stop = () => tree.find((n) => n.attributes?.class === "meeting-capsule__stop");
  const inner = () => tree.find((n) => n.attributes?.class?.includes("assistant-pill-presence"));
  const outer = () =>
    tree.find((n) => n.attributes?.class?.includes("voice-pill-position voice-pill-position-"));
  const meeting = {
    sessionId: "m1",
    startedAt: Date.now() - 761000,
    interruption: null,
    quiet: false,
  };
  const send = async (value) =>
    act(() => {
      presence = value;
      subscriptions.onMeetingRecordingPresenceChanged(value);
    });
  // Bubble through actual mounted handlers, including parent dictation activation.
  const fire = async (target, name, extra = {}) =>
    act(() => {
      let stopped = false;
      const event = {
        target,
        preventDefault() {},
        stopPropagation() {
          stopped = true;
        },
        ...extra,
      };
      for (let n = target; n && !stopped; n = n.parentNode) {
        event.currentTarget = n;
        tree.props(n)?.[name]?.(event);
      }
    });
  const present = () => {
    assert.equal(pill().attributes["data-pill-state"], "meeting");
    assert.equal(pill().attributes.role, "group");
    assert.equal(
      inner().attributes["data-assistant-footer-phase"],
      globalThis.__meetingAssistant.open ? "pill" : undefined
    );
    assert.match(outer().attributes.class, /opacity-100/);
    assert.doesNotMatch(outer().attributes.class, /pointer-events-none/);
    assert.equal(globalThis.__meetingInput.pillInteractive, true);
    assert.equal(Boolean(stop()), true);
  };
  await render();
  await send(meeting);
  present();
  assert.equal(pill().style.width, "124px");
  assert.equal(
    Boolean(tree.find((n) => n.attributes?.class?.includes("voice-pill-identity-slot"))),
    false
  );
  const dictationCount = () => events.filter((x) => x === "dictation").length;
  for (const key of ["Enter", " "]) {
    await fire(stop(), "onKeyDown", { key });
    await fire(stop(), "onKeyUp", { key });
    await fire(stop(), "onClick");
  }
  for (const name of ["onPointerDown", "onMouseDown", "onMouseUp"])
    await fire(stop(), name, { button: 0, clientX: 10, clientY: 10 });
  assert.equal(dictationCount(), 0, "Stop never activates dictation or starts parent drag");
  assert.equal(events.includes("drag"), false);
  assert.deepEqual(
    events.filter((x) => x?.stop),
    [{ stop: "m1" }, { stop: "m1" }]
  );
  await fire(pill(), "onKeyDown", { key: "Enter" });
  await fire(pill(), "onKeyDown", { key: " " });
  await fire(pill(), "onClick");
  assert.equal(dictationCount(), 3, "body pointer and keyboard activation still work");
  // A pending owned microphone acquisition keeps the existing press acknowledgement.
  globalThis.__meetingAudio.isPreparing = true;
  await render();
  const preparing = () => {
    assert.equal(pill().attributes["data-pill-state"], "processing");
    assert.equal(pill().attributes.role, "button");
    assert.equal(pill().style.width, "40px");
    assert.equal(Boolean(stop()), false, "the resting meeting control yields coherently");
    assert.equal(
      Boolean(
        tree.find(
          (n) =>
            n.attributes?.class?.includes("voice-pill-identity-icon") &&
            n.attributes.class.includes("animate-pulse")
        )
      ),
      true
    );
    assert.match(pill().attributes["aria-label"], /Processing/);
    assert.equal(globalThis.__meetingInput.pillInteractive, true);
  };
  preparing();
  const beforePreparationBody = dictationCount();
  await fire(pill(), "onClick");
  await fire(pill(), "onKeyDown", { key: "Enter" });
  await fire(pill(), "onKeyDown", { key: " " });
  assert.equal(
    dictationCount(),
    beforePreparationBody,
    "preparation body cannot admit another start"
  );
  globalThis.__meetingAudio.isPreparing = false;
  globalThis.__meetingAudio.isRecording = true;
  await render();
  assert.equal(pill().attributes["data-pill-state"], "recording");
  globalThis.__meetingAudio.isRecording = false;
  await render();
  present();
  for (const terminal of ["cancel", "failure"]) {
    globalThis.__meetingAudio.isPreparing = true;
    await render();
    preparing();
    globalThis.__meetingAudio.isPreparing = false;
    await render();
    present();
    assert.equal(Boolean(stop()), true, `${terminal} returns session-bound meeting Stop`);
  }
  await send({ ...meeting, interruption: "mic" });
  assert.equal(pill().style.width, "184px");
  assert.match(tree.text(), /Microphone lost/);
  await act(() => useSettingsStore.setState({ showMeetingRecorderOnScreen: false }));
  assert.notEqual(pill().attributes["data-pill-state"], "meeting");
  await act(() => subscriptions.onMeetingRecorderRevealRequested("m0"));
  assert.notEqual(pill().attributes["data-pill-state"], "meeting");
  await act(() => subscriptions.onMeetingRecorderRevealRequested("m1"));
  present();
  await send(null);
  assert.equal(notices.getNotices().length, 0, "presence disappearance is never a saved receipt");
  await send(meeting);
  assert.notEqual(pill().attributes["data-pill-state"], "meeting", "ended reveal retired");
  await act(() => useSettingsStore.setState({ showMeetingRecorderOnScreen: true }));
  present();
  // Plain dictation preparation belongs to the opposite-edge companion while
  // the Agent panel is open; only preparation owned by this pill can replace it.
  globalThis.requestAnimationFrame = (cb) => {
    cb();
    return 1;
  };
  await act(() => globalThis.__meetingAssistant.openPanel());
  assert.equal(globalThis.__meetingAssistant.open, true);
  globalThis.__meetingAudio.isPreparing = true;
  await render();
  present();
  const beforeCompanionStop = dictationCount();
  await fire(stop(), "onKeyDown", { key: "Enter" });
  await fire(stop(), "onClick");
  assert.equal(dictationCount(), beforeCompanionStop);
  globalThis.__meetingAudio.isAssistantVoice = true;
  await render();
  assert.equal(pill().attributes["data-pill-state"], "processing");
  assert.equal(pill().attributes.role, "status");
  assert.equal(Boolean(stop()), false);
  assert.equal(globalThis.__meetingInput.pillInteractive, false);
  globalThis.__meetingResize = true;
  await render();
  assert.match(
    outer().attributes.class,
    /opacity-0/,
    "preparation retains the existing resize hard gate"
  );
  globalThis.__meetingResize = false;
  globalThis.__meetingAudio.isPreparing = false;
  globalThis.__meetingAudio.isAssistantVoice = false;
  await render();
  present();
  // Real typed ownership and exact response phase preempt the resting capsule.
  // Business busy intentionally remains true after retirement.
  await act(() => globalThis.__meetingAssistant.openPanel());
  const presentation = {
    settings: { voiceAgentScreenContext: false },
    routes: null,
    intents: { voiceAgentRequested: true },
  };
  let retireA, retireB;
  await act(() => {
    retireA = globalThis.__meetingAssistant.handleTypedAdmission(presentation);
    globalThis.__meetingAssistant.setBusy(true);
  });
  assert.equal(pill().attributes["data-pill-state"], "thinking");
  assert.equal(
    tree.find((n) => n.attributes?.class === "agent-orbit")?.attributes["data-phase"],
    "thinking"
  );
  await act(() => globalThis.__meetingAssistant.handleTypedResponse(presentation));
  assert.equal(
    tree.find((n) => n.attributes?.class === "agent-orbit")?.attributes["data-phase"],
    "answering"
  );
  await act(() => retireA());
  assert.equal(globalThis.__meetingAssistant.busy, true);
  present();
  assert.equal(Boolean(tree.find((n) => n.attributes?.class === "agent-orbit")), false);
  assert.equal(
    Boolean(tree.find((n) => n.attributes?.class === "pill-caption")),
    false,
    "retired Agent caption cannot own the meeting surface"
  );
  await act(() => {
    retireB = globalThis.__meetingAssistant.handleTypedAdmission({ ...presentation });
  });
  await act(() => retireA());
  assert.equal(
    pill().attributes["data-pill-state"],
    "thinking",
    "stale A retirement cannot clear B"
  );
  globalThis.__meetingAudio.cancelled = {
    sessionId: "d-priority",
    undoUntil: Date.now() + 5000,
    paused: false,
    remainingMs: 5000,
    remoteAlreadySent: null,
  };
  await render();
  assert.equal(pill().attributes["data-pill-state"], "cancelled");
  globalThis.__meetingAudio.cancelled = null;
  const pasted = { kind: "pasted", words: 2, at: Date.now() };
  globalThis.__meetingAudio.outcome = pasted;
  await render();
  assert.equal(pill().attributes["data-pill-state"], "pasted");
  globalThis.__meetingAudio.outcome = null;
  await act(() => retireB());
  await render();
  present();
  await act(() => globalThis.__meetingAssistant.setBusy(false));
  await act(() => {
    globalThis.__meetingAssistant.handleClose();
    globalThis.__meetingAssistant.completeContentFade();
  });
  await act(() => new Promise((r) => setTimeout(r, 350)));
  // Active dictation and held Undo outrank the resting meeting recorder.
  globalThis.__meetingAudio.isRecording = true;
  await render();
  assert.equal(pill().attributes["data-pill-state"], "recording");
  globalThis.__meetingAudio.isRecording = false;
  globalThis.__meetingAudio.cancelled = {
    sessionId: "d1",
    undoUntil: Date.now() + 5000,
    paused: false,
    remainingMs: 5000,
    remoteAlreadySent: null,
  };
  await render();
  assert.equal(pill().attributes["data-pill-state"], "cancelled");
  globalThis.__meetingAudio.cancelled = null;
  await render();
  present();
  globalThis.requestAnimationFrame = (cb) => {
    cb();
    return 1;
  };
  await act(() => globalThis.__meetingAssistant.openPanel());
  await act(() => globalThis.__meetingAssistant.setResponseReady(true));
  assert.equal(globalThis.__meetingAssistant.footerPhase, "pill-exiting");
  assert.equal(globalThis.__meetingPanel.footerPhase, "pill-exiting");
  present();
  await fire(stop(), "onClick");
  await act(() => globalThis.__meetingAssistant.handleClose());
  assert.equal(globalThis.__meetingAssistant.closing, true);
  present();
  await fire(stop(), "onClick");
  await act(() => globalThis.__meetingAssistant.completeContentFade());
  await act(() => new Promise((r) => setTimeout(r, 350)));
  globalThis.__meetingResize = true;
  await render();
  present();
  await fire(stop(), "onClick");
  globalThis.__meetingResize = false;
  await render();
  present();
  await send(null);
  for (const reason of ["save", "stop", "ownerLost"]) {
    await act(() =>
      subscriptions.onMeetingRecordingOutcome({ sessionId: reason, kind: "failed", reason })
    );
    const notice = notices.getNotices().find((n) => n.id === `meeting-${reason}`);
    assert.equal(notice.kind, "alert");
    assert.equal(notice.expiresAt, null);
    await act(() => notice.actions[0].onClick());
  }
  assert.equal(events.filter((x) => x === "notes").length, 3);
  await act(() =>
    subscriptions.onMeetingRecordingOutcome({
      sessionId: "saved",
      kind: "saved",
      durationMs: 761000,
      noteId: 1,
    })
  );
  const receipt = notices.getNotices().find((n) => n.id === "meeting-saved");
  assert.equal(receipt.kind, "receipt");
  assert.equal(receipt.title, "Meeting saved · 12:41");
  await act(() => {
    for (const notice of [...notices.getNotices()]) notices.dismissNotice(notice.id);
  });
  await act(() => root.unmount());
  root = null;
  assert.deepEqual(Object.keys(subscriptions), []);
});
