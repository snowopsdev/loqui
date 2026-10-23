const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { setup, startBatch } = require("./harness/cancelledAudioManager");
const { createRendererServer, installHookDom } = require("../lib/rendererTestHarness");

test("real hold callbacks freeze presentation and preserve pointer/focus pause through same-id reholds", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__pillRealManager;
  });
  const {
    manager,
    window: win,
    advance,
    setSettings,
  } = await setup(t, {
    useLocalWhisper: true,
    localTranscriptionProvider: "nvidia",
    transcriptionMode: "local",
    useCleanupModel: false,
    useDictationAgent: true,
    dictationAgentMode: "providers",
    dictationAgentProvider: "anthropic",
    dictationAgentModel: "claude-test",
    voiceAgentScreenContext: true,
    saveDiscardedTranscriptions: false,
  });
  Object.assign(manager, {
    cacheMicrophoneDeviceId() {},
    preparedMicCapture: { cancel() {} },
    micStreamHold: { drop() {} },
    saveTranscription: async () => true,
    safePaste: async () => true,
  });
  globalThis.__pillRealManager = manager;
  const noop = () => () => {};
  Object.assign(win.electronAPI, {
    onToggleDictation: noop,
    onToggleVoiceAgent: noop,
    onToggleTranslation: noop,
    onStartDictation: noop,
    onPrepareDictation: noop,
    onCancelDictationPreparation: noop,
    onStopDictation: noop,
  });
  const container = installHookDom(t);
  const hookVite = await createRendererServer(t, {
    cachePrefix: "loqui-real-pill-hold-",
    mockModules: {
      "/helpers/audioManager":
        "export default class { constructor() { return globalThis.__pillRealManager; } }",
    },
  });
  const { useAudioRecording } = await hookVite.ssrLoadModule("/hooks/useAudioRecording.js");
  let api;
  let hovered = true;
  let focused = false;
  function Harness() {
    api = useAudioRecording({ isPillHovered: () => hovered || focused });
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  let recorder;
  await React.act(async () => {
    manager.setVoiceAgentRequested(true);
    recorder = startBatch(manager, [1], 2, { manualStop: true });
    manager.cancelRecording();
  });
  const original = manager._undo.peek();
  const first = api.cancelHold;
  assert.equal(api.cancelled.paused, true, "real manager pause publication, no new mouseenter");
  assert.equal(first.session.routes, original.session.routes);
  assert.equal(first.session.intents.voiceAgentRequested, true);
  assert.equal(first.session.settings.voiceAgentScreenContext, true);
  assert.deepEqual(Object.keys(first.session).sort(), ["intents", "routes", "settings"]);
  assert.deepEqual(Object.keys(first.session.settings).sort(), [
    "useCleanupModel",
    "voiceAgentScreenContext",
  ]);
  assert.equal(Object.isFrozen(first.session), true);
  setSettings({
    useLocalWhisper: true,
    localTranscriptionProvider: "nvidia",
    transcriptionMode: "local",
    useCleanupModel: false,
    dictationAgentMode: "local",
    voiceAgentScreenContext: false,
  });
  await React.act(async () => {
    await advance(2000);
    manager._emitCancelled(original);
  });
  assert.equal(
    api.cancelHold,
    first,
    "evidence/paused-clock publications preserve generation and duration"
  );
  hovered = false;
  focused = true;
  // The pointer is outside, but the reader retains keyboard focus. A refused
  // restore takes the real RAM buffer then reinstalls its SAME session/buffer
  // in a fresh, initially running undo window, within one React batch.
  await React.act(async () => {
    assert.equal(manager._undo.take(), original);
    manager.onCancelledChange(null, { sessionId: original.session.id, reason: "restored" });
    manager._openCancelled(original);
  });
  const second = api.cancelHold;
  assert.ok(
    second.generation > first.generation,
    "a close/reopen is a fresh window even for the identical session and buffer"
  );
  assert.equal(second.session.routes, original.session.routes);
  assert.equal(api.cancelled.paused, true, "retained focus pauses the fresh same-buffer window");
  assert.equal(manager._undo.state().paused, true, "real clock, not only renderer state");
  await React.act(async () => advance(12000));
  assert.equal(manager._undo.peek(), original, "focused reading outlives the unpaused5s deadline");
  assert.equal(api.cancelHold, second, "clock/evidence cannot invent a new UI generation");
  assert.equal(api.cancelled.remainingMs, 5000);
  // Replacing a hold with a fresh buffer for that same session also resets it,
  // even if a producer does not emit an intermediate close publication.
  const { createCancelBuffer } = await hookVite.ssrLoadModule("/helpers/cancelBuffer.js");
  const replacement = createCancelBuffer({
    session: original.session,
    kind: "batch",
    mimeType: "audio/webm",
    durationSeconds: 35,
  });
  await React.act(async () => manager._openCancelled(replacement));
  assert.ok(api.cancelHold.generation > second.generation);
  assert.equal(api.cancelHold.durationMs, 10000);
  assert.equal(api.cancelHold.session.routes, original.session.routes);
  assert.equal(api.cancelHold.session.settings.voiceAgentScreenContext, true);
  assert.equal(
    api.cancelled.paused,
    true,
    "same-session fresh buffer also opens paused under retained focus"
  );
  const third = api.cancelHold;
  await React.act(async () => advance(12000));
  assert.equal(
    manager._undo.peek(),
    replacement,
    "focused replacement outlives its unpaused10s deadline"
  );
  assert.equal(api.cancelHold, third);
  assert.equal(api.cancelled.remainingMs, 10000);
  focused = false;
  await React.act(async () => {
    manager.resumeCancelHold();
    await advance(100);
    manager._emitCancelled(replacement);
  });
  assert.equal(
    api.cancelled.paused,
    false,
    "leaving the reading focus resumes the existing window"
  );
  assert.equal(api.cancelled.remainingMs, 9900);
  assert.equal(api.cancelHold, third, "resume does not reset generation or duration");
  await React.act(async () => {
    recorder.finish();
    await manager.flushCancelHold();
  });
  assert.equal(api.cancelHold, null);
  assert.equal(api.cancelled, null);
});
