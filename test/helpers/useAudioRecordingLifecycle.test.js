const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { deferred } = require("./harness/deferred");

const english = require("../../src/locales/en/translation.json");

const FAKE = `
export default class FakeAudioManager {
  constructor() { this.voiceAgentRequested = false; this.translationRequested = false; this.sttConfig = { success: true }; globalThis.__am = this; this.calls = []; }
  getRecordingAudioLevel() { return null; }
  getState() { return { isRecording: this.recording === true, isProcessing: this.processing === true }; }
  setCallbacks(cb) { this.cb = cb; }
  setVoiceAgentRequested(v) { this.voiceAgentRequested = v; }
  setAssistantSelectionContext() {}
  setTranslationRequested(v) { this.translationRequested = v; }
  shouldUseStreaming() { return false; }
  prepareMicCapture() {} cancelPreparedMicCapture() {} cleanup() {}
  async startRecording() { this.recording = true; return true; }
  async restoreCancelled(sessionId) { this.calls.push(["restore", sessionId]); return globalThis.__restoreResult ?? { restored: true, sessionId }; }
  pauseCancelHold() { this.calls.push(["pause"]); }
  resumeCancelHold() { this.calls.push(["resume"]); }
  flushCancelHold() { this.calls.push(["flush"]); return globalThis.__flush?.promise ?? Promise.resolve(); }
}`;

async function mount(t, electronAPI = {}, hookOptions = {}) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__am;
    delete globalThis.__restoreResult;
    delete globalThis.__flush;
  });
  const noop = () => () => {};
  const listeners = {};
  const on = (name) => (cb) => ((listeners[name] = cb), () => delete listeners[name]);
  const log = [];
  const demo = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        onToggleDictation: noop,
        onToggleVoiceAgent: noop,
        onToggleTranslation: noop,
        onStartDictation: noop,
        onPrepareDictation: noop,
        onCancelDictationPreparation: noop,
        onStopDictation: noop,
        dictationLifecycleStateChanged: (state) => log.push(["lifecycle", state]),
        captureDictationTarget: async () => ({}),
        registerCancelHotkey: (k) => log.push(`+${k}`),
        unregisterCancelHotkey: () => log.push("-esc"),
        acquirePillHotkey: async (slot) => (log.push(`+${slot}`), { leaseId: 1, held: true }),
        releasePillHotkey: async () => log.push("-lease"),
        onPillHotkeyPressed: noop,
        onUndoCancelRequest: on("undo"),
        replyUndoCancel: (token, result) => log.push(["undo-reply", token, result]),
        onDictationFlushRequest: on("flush"),
        replyDictationFlush: (token) => log.push(["flush-reply", token]),
        ...electronAPI,
      },
    },
  });
  const container = installHookDom(t);
  globalThis.requestAnimationFrame = (cb) => (cb(), 1);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-lifecycle-",
    mockModules: { "/helpers/audioManager": FAKE },
  });
  const { useAudioRecording } = await vite.ssrLoadModule("/hooks/useAudioRecording.js");
  const { useUndoCancelHotkey } = await vite.ssrLoadModule("/hooks/useUndoCancelHotkey.ts");
  const ref = {};
  function Harness() {
    ref.api = useAudioRecording({ ...hookOptions, onDemoEvent: (e) => demo.push(e) });
    ref.hotkey = useUndoCancelHotkey(ref.api.cancelled, ref.api.undoCancel);
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  return {
    ref,
    log,
    demo,
    listeners,
    vite,
    unmount: () =>
      React.act(async () => {
        root.unmount();
        root = null;
      }),
  };
}

const fire = (name, ...args) => React.act(async () => globalThis.__am.cb[name](...args));
const STATE = {
  sessionId: "rec-1",
  undoUntil: 5000,
  paused: false,
  remainingMs: 5000,
  remoteAlreadySent: null,
};

test("cancelled mirrors the manager and reaches the onboarding demo channel", async (t) => {
  const { ref, demo } = await mount(t);
  await fire("onCancelledChange", STATE);
  assert.deepEqual(ref.api.cancelled, STATE);
  assert.deepEqual(demo.at(-1), {
    kind: "dictation",
    status: "cancelled",
    sessionId: "rec-1",
    cancelled: STATE,
  });
  await fire("onCancelledChange", null, { sessionId: "rec-1", reason: "expired" });
  assert.equal(ref.api.cancelled, null);
  assert.deepEqual(demo.at(-1), {
    kind: "dictation",
    status: "cancelClosed",
    sessionId: "rec-1",
    reason: "expired",
  });
});

test("Esc is owned by the lifecycle: armed while recording or processing, including an Undo-started processing phase", async (t) => {
  const { log } = await mount(t);
  await fire("onStateChange", { isRecording: true, isProcessing: false });
  await fire("onStateChange", { isRecording: false, isProcessing: true });
  await fire("onStateChange", { isRecording: false, isProcessing: false });
  // Undo: idle → processing, never recording
  await fire("onStateChange", { isRecording: false, isProcessing: true });
  await fire("onStateChange", { isRecording: false, isProcessing: false });
  assert.deepEqual(
    log.filter((e) => typeof e === "string" && /Escape|esc/.test(e)),
    ["+Escape", "-esc", "+Escape", "-esc"]
  );
});

test("another window's Undo request is answered with the manager's UndoResult", async (t) => {
  const { log, listeners } = await mount(t);
  await React.act(async () => listeners.undo({ token: 4, sessionId: "rec-1" }));
  assert.deepEqual(
    log.find((e) => Array.isArray(e) && e[0] === "undo-reply"),
    ["undo-reply", 4, { restored: true, sessionId: "rec-1" }]
  );
});

test("the quit flush replies only after the manager's flush settles", async (t) => {
  const { log, listeners } = await mount(t);
  globalThis.__flush = deferred();
  await React.act(async () => listeners.flush({ token: 9 }));
  assert.equal(
    log.some((e) => Array.isArray(e) && e[0] === "flush-reply"),
    false
  );
  await React.act(async () => globalThis.__flush.resolve());
  assert.deepEqual(
    log.find((e) => Array.isArray(e) && e[0] === "flush-reply"),
    ["flush-reply", 9]
  );
});

test("a failed Undo returns false and explains itself in a notice", async (t) => {
  const { ref, vite } = await mount(t);
  const notices = await vite.ssrLoadModule("/components/ui/notices.ts");
  globalThis.__restoreResult = { restored: false, sessionId: "rec-1", reason: "sealed" };
  await fire("onCancelledChange", STATE);
  let ok;
  await React.act(async () => {
    ok = await ref.api.undoCancel();
  });
  assert.equal(ok, false);
  // Same module instance the hook imported, so this is the notice it raised.
  assert.equal(notices.getNotices().at(-1).title, english.notices.undo.sealed);
  assert.equal(
    notices.getNotices().filter((n) => n.id === "undo-failed").length,
    1,
    "one surface, not two"
  );
});

test("an Undo that arrives after the window closed says so (CCR-1)", async (t) => {
  const { ref, vite } = await mount(t);
  const notices = await vite.ssrLoadModule("/components/ui/notices.ts");
  globalThis.__restoreResult = { restored: false, sessionId: null, reason: "expired" };
  let ok;
  await React.act(async () => {
    ok = await ref.api.undoCancel();
  });
  assert.equal(ok, false);
  assert.equal(notices.getNotices().at(-1).title, english.notices.undo.expired);
});

test("a refusal that keeps the recording says to try again, not that it was empty (R3-I1)", async (t) => {
  const { ref, vite } = await mount(t);
  const notices = await vite.ssrLoadModule("/components/ui/notices.ts");
  await fire("onCancelledChange", STATE); // the window is open again after the refusal
  globalThis.__restoreResult = { restored: false, sessionId: STATE.sessionId, reason: "noAudio" };
  await React.act(async () => {
    await ref.api.undoCancel();
  });
  assert.equal(notices.getNotices().at(-1).title, english.notices.undo.notReady);
});

test("a bridge request passes main's deadline through to the manager (R3-I1)", async (t) => {
  const { listeners } = await mount(t);
  const calls = [];
  globalThis.__am.restoreCancelled = async (sessionId, options) => (
    calls.push([sessionId, options]),
    { restored: true, sessionId }
  );
  await React.act(async () => listeners.undo({ token: 5, sessionId: "rec-1", deadlineAt: 123456 }));
  assert.deepEqual(
    calls,
    [["rec-1", { deadlineAt: 123456 }]],
    "main's absolute deadline, untouched"
  );
});

test("⌥Z is leased while a window is open and released when it closes", async (t) => {
  const { log } = await mount(t);
  await fire("onCancelledChange", STATE);
  await new Promise((r) => setImmediate(r));
  await fire("onCancelledChange", null, { sessionId: "rec-1", reason: "expired" });
  assert.deepEqual(
    log.filter((e) => e === "+undoCancel" || e === "-lease"),
    ["+undoCancel", "-lease"]
  );
});

test("the control panel learns of the window through Plan 06's lifecycle channel only (§5.7)", async (t) => {
  const { log } = await mount(t);
  await fire("onCancelledChange", STATE);
  await fire("onCancelledChange", null, { sessionId: "rec-1", reason: "expired" });
  const states = log.filter((e) => Array.isArray(e) && e[0] === "lifecycle").map((e) => e[1]);
  assert.deepEqual(states.slice(-2), ["cancelled", "idle"]);
});

test("a stale close for A leaves held B, its lifecycle and Undo lease intact", async (t) => {
  const { ref, log, demo } = await mount(t);
  await fire("onCancelledChange", STATE);
  const heldB = { ...STATE, sessionId: "rec-B" };
  await fire("onCancelledChange", heldB);
  const before = { log: log.length, demo: demo.length };
  await fire("onCancelledChange", null, { sessionId: STATE.sessionId, reason: "expired" });
  assert.deepEqual(ref.api.cancelled, heldB);
  assert.equal(ref.hotkey.held, true);
  assert.equal(log.length, before.log, "no idle or lease release over B");
  assert.equal(demo.length, before.demo, "no stale closure after B's open");
  await React.act(async () => ref.api.undoCancel());
  assert.deepEqual(globalThis.__am.calls.at(-1), ["restore", "rec-B"]);
});

test("busy lifecycle owns reports; stage resets at idle and Esc releases once on unmount", async (t) => {
  const { ref, log, unmount, listeners } = await mount(t);
  await fire("onStateChange", { isRecording: false, isProcessing: true });
  await fire("onStateChange", { isRecording: false, isProcessing: true });
  await fire("onProcessingStage", "cleaning");
  assert.equal(ref.api.processingStage, "cleaning");
  const before = log.length;
  await fire("onCancelledChange", STATE);
  assert.equal(
    log.slice(before).some((e) => Array.isArray(e) && e[0] === "lifecycle"),
    false
  );
  await fire("onStateChange", { isRecording: false, isProcessing: false });
  assert.equal(ref.api.processingStage, null);
  assert.deepEqual(log.filter(Array.isArray).at(-1), ["lifecycle", "cancelled"]);
  await fire("onStateChange", { isRecording: false, isProcessing: true });
  await unmount();
  assert.deepEqual(
    log.filter((e) => typeof e === "string" && /Escape|esc/.test(e)),
    ["+Escape", "-esc", "+Escape", "-esc"]
  );
  assert.deepEqual(Object.keys(listeners), []);
});

test("lease expiry removes shortcut authority while click Undo still works", async (t) => {
  const { ref } = await mount(t, {
    onPillHotkeyReleased: (cb) => (
      (globalThis.__releaseUndo = cb),
      () => delete globalThis.__releaseUndo
    ),
  });
  await fire("onCancelledChange", STATE);
  assert.equal(ref.hotkey.held, true);
  await React.act(async () => globalThis.__releaseUndo({ slot: "undoCancel", leaseId: 1 }));
  assert.equal(ref.hotkey.held, false);
  await React.act(async () => assert.equal(await ref.api.undoCancel(), true));
  assert.deepEqual(globalThis.__am.calls.at(-1), ["restore", STATE.sessionId]);
});

test("pause/resume delegate once and an unmounted pending flush never replies", async (t) => {
  const { ref, listeners, log, unmount } = await mount(t);
  ref.api.pauseUndo();
  ref.api.resumeUndo();
  assert.deepEqual(globalThis.__am.calls, [["pause"], ["resume"]]);
  globalThis.__flush = deferred();
  await React.act(async () => listeners.flush({ token: 12 }));
  const pending = globalThis.__flush;
  await unmount();
  await React.act(async () => pending.resolve());
  assert.equal(
    log.some((e) => Array.isArray(e) && e[0] === "flush-reply"),
    false
  );
});

test("paste outcome captures the session before await and counts words", async (t) => {
  const pasted = deferred();
  const { ref, vite } = await mount(t, { replaceSelectedText: () => pasted.promise });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  useSettingsStore.setState({ autoPasteEnabled: true, keepTranscriptionInClipboard: false });
  const manager = globalThis.__am;
  const originalSession = Object.freeze({
    id: "original",
    private: false,
    routes: Object.freeze({ marker: "original destinations" }),
    settings: Object.freeze({ useCleanupModel: true, voiceAgentScreenContext: true }),
    intents: Object.freeze({ voiceAgentRequested: true, translationRequested: false }),
  });
  manager.activeSession = originalSession;
  manager.saveTranscription = async () => true;
  let completion;
  await React.act(async () => {
    completion = manager.cb.onTranscriptionComplete({
      success: true,
      text: " one  two\nthree ",
      selectionEdit: { sessionId: "edit" },
    });
  });
  manager.activeSession = null;
  await React.act(async () => {
    pasted.resolve({ success: true });
    await completion;
  });
  assert.equal(ref.api.outcomePresentation.outcome, ref.api.outcome);
  assert.equal(ref.api.outcomePresentation.session.routes, originalSession.routes);
  assert.equal(ref.api.outcomePresentation.session.settings.voiceAgentScreenContext, true);
  assert.deepEqual(
    { ...ref.api.outcome, at: 0 },
    { sessionId: "original", kind: "pasted", words: 3, at: 0 }
  );
});

for (const success of [true, false]) {
  test(`a stale ${success ? "successful" : "failed"} paste cannot overwrite a newer outcome`, async (t) => {
    const pasted = deferred();
    const { ref, vite } = await mount(t, { replaceSelectedText: () => pasted.promise });
    const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
    useSettingsStore.setState({ autoPasteEnabled: true, keepTranscriptionInClipboard: false });
    const manager = globalThis.__am;
    manager.activeSession = { id: "A" };
    manager.saveTranscription = async () => true;
    let completion;
    await React.act(async () => {
      completion = manager.cb.onTranscriptionComplete({
        success: true,
        text: "old words",
        selectionEdit: { sessionId: "edit" },
      });
    });
    manager.activeSession = { id: "B" };
    await fire("onStateChange", { isRecording: true, isProcessing: false });
    await fire("onError", { message: "fixture B failure" });
    assert.equal(ref.api.outcome.sessionId, "B");
    await React.act(async () => {
      pasted.resolve({ success });
      await completion;
    });
    assert.equal(ref.api.outcome.sessionId, "B");
    assert.equal(ref.api.outcome.kind, "failed");
    assert.equal(ref.api.outcomePresentation.outcome, ref.api.outcome);
    assert.notEqual(ref.api.outcomePresentation.session?.routes?.marker, "original destinations");
  });
}

test("the hook publishes the frozen session through processing, cancel, Undo and idle", async (t) => {
  const { ref } = await mount(t);
  const original = Object.freeze({
    id: "rec-pinned",
    routes: Object.freeze({}),
    settings: Object.freeze({}),
    intents: Object.freeze({ voiceAgentRequested: true, translationRequested: false }),
  });
  const am = globalThis.__am;
  am.getRecordingAudioLevel = () => null; // recording mounts the hook’s level-reporting effect
  assert.equal(ref.api.activeSession, null);
  am.activeSession = original;
  await fire("onStateChange", { isRecording: true, isProcessing: false });
  assert.equal(ref.api.activeSession, original);
  await fire("onStateChange", { isRecording: false, isProcessing: true });
  assert.equal(ref.api.activeSession, original);
  // The callback can precede AudioManager's final session cleanup.
  await fire("onStateChange", { isRecording: false, isProcessing: false });
  assert.equal(ref.api.activeSession, null);
  am.activeSession = null;
  // Undo advertises processing while preflight is pending, before it applies the hold.
  await fire("onStateChange", { isRecording: false, isProcessing: true });
  assert.equal(ref.api.activeSession, null);
  // Task 8 emits again after applySessionIntents admits that original session.
  am.activeSession = original;
  await fire("onStateChange", { isRecording: false, isProcessing: true });
  assert.equal(ref.api.activeSession, original);
  am.activeSession = null;
  await fire("onStateChange", { isRecording: false, isProcessing: false });
  assert.equal(ref.api.activeSession, null);
});

test("each actual open gets a new internal hold even when same-session close/reopen is batched", async (t) => {
  const { ref } = await mount(t);
  await fire("onCancelledChange", STATE);
  const first = ref.api.cancelHold;
  await fire("onCancelledChange", { ...STATE, paused: true, remainingMs: 3100 });
  assert.equal(
    ref.api.cancelHold,
    first,
    "pause/evidence updates retain animation identity and original duration"
  );
  await React.act(async () => {
    globalThis.__am.cb.onCancelledChange(null, { sessionId: STATE.sessionId, reason: "restored" });
    globalThis.__am.cb.onCancelledChange({ ...STATE, remainingMs: 10000 });
  });
  assert.equal(ref.api.cancelled.sessionId, STATE.sessionId, "public identity unchanged");
  assert.ok(ref.api.cancelHold.generation > first.generation);
  assert.equal(ref.api.cancelHold.durationMs, 10000);
});

test("an actual hold opened while already hovered pauses the manager immediately", async (t) => {
  let hovered = true;
  const { ref } = await mount(t, {}, { isPillHovered: () => hovered });
  const am = globalThis.__am;
  am.pauseCancelHold = () => {
    am.calls.push(["pause"]);
    am.cb.onCancelledChange({ ...STATE, paused: true });
  };
  await fire("onCancelledChange", STATE);
  assert.equal(ref.api.cancelled.paused, true);
  assert.deepEqual(am.calls, [["pause"]]);
  const first = ref.api.cancelHold;
  await fire("onCancelledChange", { ...STATE, paused: true, remainingMs: 4000 });
  assert.equal(ref.api.cancelHold, first);
  assert.deepEqual(am.calls, [["pause"]], "not repeated on pause/evidence publications");
  hovered = false;
  await fire("onCancelledChange", null, { sessionId: STATE.sessionId, reason: "expired" });
  await fire("onCancelledChange", STATE);
  assert.equal(ref.api.cancelled.paused, false);
  assert.deepEqual(am.calls, [["pause"]]);
});

test("live words survive recording, commits, cleanup, idle during paste and the owning pasted beat", async (t) => {
  const pasted = deferred();
  const { ref, vite } = await mount(t, { replaceSelectedText: () => pasted.promise });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  useSettingsStore.setState({ autoPasteEnabled: true, keepTranscriptionInClipboard: false });
  const am = globalThis.__am;
  am.activeSession = { id: "live-A" };
  am.saveTranscription = async () => true;
  await fire("onStateChange", { isRecording: true, isProcessing: false });
  assert.deepEqual(ref.api.liveText, { committed: "", partial: "", cleaned: null });
  am.streamingFinalText = "move the review";
  await fire("onPartialTranscript", "to thursday at two");
  assert.deepEqual(ref.api.liveText, {
    committed: "move the review",
    partial: "to thursday at two",
    cleaned: null,
  });
  am.streamingFinalText = "move the review to thursday at two";
  await fire("onStreamingCommit", " to thursday at two");
  assert.deepEqual(ref.api.liveText, {
    committed: am.streamingFinalText,
    partial: "",
    cleaned: null,
  });
  await fire("onStateChange", { isRecording: false, isProcessing: true });
  await fire("onProcessingStage", "cleaning");
  let completion;
  await React.act(async () => {
    completion = am.cb.onTranscriptionComplete({
      success: true,
      text: "move the review to Thursday at 2.",
      selectionEdit: { sessionId: "edit" },
    });
  });
  const owned = ref.api.liveText;
  assert.equal(owned.cleaned, "move the review to Thursday at 2.");
  await fire("onStateChange", { isRecording: false, isProcessing: false });
  am.activeSession = null;
  assert.deepEqual(ref.api.liveText, owned, "idle precedes paste settlement in the real pipeline");
  await React.act(async () => {
    pasted.resolve({ success: true });
    await completion;
  });
  assert.equal(ref.api.outcome.kind, "pasted");
  assert.deepEqual(ref.api.liveText, owned);
  am.activeSession = { id: "live-B" };
  await fire("onStateChange", { isRecording: true, isProcessing: false });
  assert.deepEqual(ref.api.liveText, { committed: "", partial: "", cleaned: null });
});

test("a pending old paste never reclaims replacement words; batch completion captures full raw text", async (t) => {
  const pasted = deferred();
  const { ref, vite } = await mount(t, { replaceSelectedText: () => pasted.promise });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  useSettingsStore.setState({ autoPasteEnabled: true, keepTranscriptionInClipboard: false });
  const am = globalThis.__am;
  am.saveTranscription = async () => true;
  am.activeSession = { id: "A" };
  await fire("onStateChange", { isRecording: true, isProcessing: false });
  let completion;
  await React.act(async () => {
    completion = am.cb.onTranscriptionComplete({
      success: true,
      rawText: "all original batch words",
      text: "All original batch words.",
      selectionEdit: { sessionId: "edit" },
    });
  });
  assert.deepEqual(ref.api.liveText, {
    committed: "all original batch words",
    partial: "",
    cleaned: "All original batch words.",
  });
  // Replacement identity must reset words even if a producer coalesces the idle edge.
  am.activeSession = { id: "B" };
  await fire("onStateChange", { isRecording: true, isProcessing: false });
  am.streamingFinalText = "new";
  await fire("onPartialTranscript", "words");
  const newer = ref.api.liveText;
  await React.act(async () => {
    pasted.resolve({ success: true });
    await completion;
  });
  assert.deepEqual(ref.api.liveText, newer);
  assert.equal(ref.api.outcome, null);
});

test("same-session Undo retains raw words but clears the previous cleaned result", async (t) => {
  const { ref } = await mount(t);
  const am = globalThis.__am;
  am.activeSession = { id: STATE.sessionId };
  await fire("onStateChange", { isRecording: true, isProcessing: false });
  am.streamingFinalText = "retained";
  await fire("onPartialTranscript", "words");
  await fire("onCancelledChange", STATE);
  await fire("onStateChange", { isRecording: false, isProcessing: false });
  await fire("onCancelledChange", null, { sessionId: STATE.sessionId, reason: "restored" });
  await fire("onStateChange", { isRecording: false, isProcessing: true });
  assert.deepEqual(ref.api.liveText, { committed: "retained", partial: "words", cleaned: null });
});
