const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

// The fake records what the hook tells the manager and hands its callbacks back.
const FAKE_AUDIO_MANAGER_SOURCE = `
export const probe = { privateSession: [], released: 0, callbacks: null, state: {} };
export default class FakeAudioManager {
  setPrivateSession(value) { this._recordingPrivate = value; probe.privateSession.push(value); }
  _ownedAudioSnapshot() { return { private: this._recordingPrivate }; }
  releasePrivateAudio() { probe.released += 1; }
  setCallbacks(callbacks) { probe.callbacks = callbacks; }
  getState() { return probe.state; }
  cacheMicrophoneDeviceId() {}
  cancelPreparedMicCapture() {}
  cancelRecording() {
    if (!probe.state.isRecording) return false;
    probe.callbacks.onCancelledChange({ sessionId: "recording", undoUntil: Date.now()+5000, remainingMs: 5000, paused: false, remoteAlreadySent: null }, undefined, { demoId: "demo", takeId: "take" });
    return true;
  }
  cancelProcessing() { return true; }
  cleanup() {}
}
`;

async function mountHook(t, trialMode) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const noop = () => () => {};
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
        dictationLifecycleStateChanged: () => {},
        hideDictationPreview: () => {},
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-trial-events-test-",
    mockModules: { "/helpers/audioManager": FAKE_AUDIO_MANAGER_SOURCE },
  });
  const { useAudioRecording } = await vite.ssrLoadModule("/hooks/useAudioRecording.js");
  const { probe } = await vite.ssrLoadModule("/helpers/audioManager");
  const events = [];
  // Works before and after Plan 04 changes the signature to useAudioRecording(options):
  // a callable options object is a valid toast today and the options argument tomorrow.
  const options = Object.assign(() => "toast", {
    trialMode,
    onDemoEvent: (event) => events.push(event),
  });
  let api;
  function Harness() {
    api = useAudioRecording(options);
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  return { probe, events, api: () => api };
}

test("the manager is told every recording is private while setup is incomplete", async (t) => {
  const { probe } = await mountHook(t, true);
  assert.deepEqual(probe.privateSession.at(-1), true);
});

test("an empty result reaches setup as NO_AUDIO and releases the private audio", async (t) => {
  const { probe, events } = await mountHook(t, true);
  await React.act(async () =>
    probe.callbacks.onTranscriptionComplete({ success: true, text: "   ", rawText: "" })
  );
  assert.deepEqual(
    events.filter((event) => event.status === "error").map((event) => event.code),
    ["NO_AUDIO"]
  );
  assert.equal(probe.released, 1);
});

test("cancelling publishes the original manager CancelledState through the single callback", async (t) => {
  const { probe, events, api } = await mountHook(t, true);
  probe.state = { isRecording: true };
  await React.act(async () => api().cancelRecording());
  const cancelled = events.filter((event) => event.status === "cancelled");
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].cancelled.sessionId, "recording");
  assert.equal(cancelled[0].takeId, "take");
  assert.equal("undoUntil" in cancelled[0], false, "the retired pair is gone");
  probe.state = {};
  await React.act(async () => api().cancelRecording());
  assert.equal(
    events.filter((event) => event.status === "cancelled").length,
    1,
    "nothing to cancel, nothing said"
  );
});
