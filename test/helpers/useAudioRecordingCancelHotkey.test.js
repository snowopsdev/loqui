const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

// A manager whose state the test drives. startRecording and stopRecording
// emit the same onStateChange sequence the real AudioManager does.
const FAKE_AUDIO_MANAGER_SOURCE = `
export default class FakeAudioManager {
  isPressCandidateAllowed() { return true; }
  getOrCreatePressCandidate(intents) { return { intents, settings: {}, routes: { dictationStt: { providerId: null }, voiceAssistant: { providerId: null }, translation: { providerId: null } } }; }

  constructor() {
    this.voiceAgentRequested = false;
    this.translationRequested = false;
    this.sttConfig = {};
    this.state = { isRecording: false, isProcessing: false, isStreaming: false };
    globalThis.__cancelHotkeyManager = this;
  }
  getState() { return this.state; }
  setCallbacks(callbacks) { this.callbacks = callbacks; }
  setVoiceAgentRequested() {}
  setAssistantSelectionContext() {}
  setTranslationRequested() {}
  shouldUseStreaming() { return false; }
  emit(next) {
    this.state = { ...this.state, ...next };
    this.callbacks.onStateChange({ ...this.state });
  }
  // With globalThis.__holdStart set, the mic "opens" only when the test calls
  // releaseStart(), so a stop can land while the start holds the lock.
  startRecording() {
    if (!globalThis.__holdStart) {
      this.emit({ isRecording: !globalThis.__startAlreadyIdle });
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      this.releaseStart = () => {
        this.emit({ isRecording: true });
        resolve(true);
      };
    });
  }
  getRecordingAudioLevel() { return 0; }
  stopRecording() {
    this.stopCalls = (this.stopCalls ?? 0) + 1;
    this.emit({ isRecording: false, isProcessing: true });
    return true;
  }
  cancelProcessing() { this.emit({ isProcessing: false }); return true; }
  cancelRecording() { this.emit({ isRecording: false }); return true; }
  cancelPreparedMicCapture() {}
  cleanup() {}
}
`;

const SETTINGS_STORE_SOURCE = `
export const useSettingsStore = { subscribe: () => () => {} };
export const getSettings = () => ({ pauseMediaOnDictation: false, voiceAgentScreenContext: false, snippets: [] });
`;

const LOGGER_SOURCE = `
const noop = () => {};
export default { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, logReasoning: noop };
`;

const TRANSLATION_SOURCE = `
const translate = (key) => key;
export const useTranslation = () => ({ t: translate });
`;

async function mountHarness(t) {
  let root = null;
  const unmount = async () => {
    if (!root) return;
    const current = root;
    root = null;
    await React.act(async () => current.unmount());
  };
  t.after(unmount);
  const hotkey = [];
  const noopDispose = () => () => {};
  const NOOP = () => {};
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        onToggleDictation: noopDispose,
        onToggleVoiceAgent: noopDispose,
        onToggleTranslation: noopDispose,
        onStartDictation: noopDispose,
        onPrepareDictation: noopDispose,
        onCancelDictationPreparation: noopDispose,
        onStopDictation: noopDispose,
        onDictationForceStopped: noopDispose,
        dictationLifecycleStateChanged: NOOP,
        completeDictationPreview: NOOP,
        hideDictationPreview: NOOP,
        setScreenContextEnabled: NOOP,
        registerCancelHotkey: async (key) => hotkey.push(`register:${key}`),
        unregisterCancelHotkey: async () => hotkey.push("unregister"),
      },
    },
  });
  const container = installHookDom(t);
  // installHookDom stubs requestAnimationFrame with a no-op; give
  // waitForVisualFrames real frames. installHookDom restores the original.
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-cancel-hotkey-",
    noExternal: ["react-i18next"],
    mockModules: {
      "/helpers/audioManager": FAKE_AUDIO_MANAGER_SOURCE,
      "/stores/settingsStore": SETTINGS_STORE_SOURCE,
      "/utils/logger": LOGGER_SOURCE,
      "react-i18next": TRANSLATION_SOURCE,
    },
  });
  const { useAudioRecording } = await vite.ssrLoadModule("/hooks/useAudioRecording.js");
  const api = {};
  const options = { onDemoEvent: NOOP };
  function Harness() {
    Object.assign(api, useAudioRecording(options));
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  const manager = () => globalThis.__cancelHotkeyManager;
  const waitFor = async (check) => {
    for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
    assert.ok(check(), "condition reached");
  };
  return {
    hotkey,
    unmount,
    start: () => React.act(async () => api.startRecording()),
    stop: () => React.act(async () => api.stopRecording()),
    emit: (next) => React.act(async () => manager().emit(next)),
    manager,
    // Starts a recording that waits in the mic-open phase until released.
    // Returns { pending } rather than the promise itself: an async function
    // that returned the held promise would adopt it, and awaiting the helper
    // would then wait for a start that only the test can release.
    beginHeldStart: async () => {
      let pending;
      await React.act(async () => {
        pending = api.startRecording();
        await waitFor(() => typeof manager().releaseStart === "function");
      });
      return { pending };
    },
    releaseStart: (pending) =>
      React.act(async () => {
        manager().releaseStart();
        await pending;
      }),
  };
}

// The arming that happens before recording starts is not under test.
const sinceStart = (hotkey) => hotkey.slice(hotkey.indexOf("register:Escape"));

test("Esc stays registered while a dictation is processing", async (t) => {
  const h = await mountHarness(t);
  await h.start();
  assert.deepEqual(sinceStart(h.hotkey), ["register:Escape"]);
  await h.emit({ isRecording: false, isProcessing: true });
  assert.deepEqual(sinceStart(h.hotkey), ["register:Escape"], "processing keeps Esc armed");
});

test("Esc is released on the idle edge", async (t) => {
  const h = await mountHarness(t);
  await h.start();
  await h.emit({ isRecording: false, isProcessing: true });
  await h.emit({ isProcessing: false });
  assert.deepEqual(sinceStart(h.hotkey), ["register:Escape", "unregister"]);
});

test("stopping a recording does not release Esc before processing ends", async (t) => {
  const h = await mountHarness(t);
  await h.start();
  await h.stop();
  assert.deepEqual(sinceStart(h.hotkey), ["register:Escape"]);
});

test(
  "a stop that lands mid-start still arms Esc for processing",
  { timeout: 10_000 },
  async (t) => {
    globalThis.__holdStart = true;
    t.after(() => delete globalThis.__holdStart);
    const h = await mountHarness(t);
    const { pending } = await h.beginHeldStart();
    await h.stop(); // lands while the start still holds the lock
    assert.equal(h.manager().stopCalls ?? 0, 0, "the stop is deferred, not yet applied");
    await h.releaseStart(pending); // the mic opens; the hook honours the stop
    assert.equal(h.manager().stopCalls, 1, "the deferred stop ran after the release");
    assert.deepEqual(sinceStart(h.hotkey), ["register:Escape"], "processing can be cancelled");
    await h.emit({ isProcessing: false });
    assert.deepEqual(sinceStart(h.hotkey), ["register:Escape", "unregister"]);
  }
);

test("unmounting releases Esc even mid-processing", async (t) => {
  const h = await mountHarness(t);
  await h.start();
  await h.emit({ isRecording: false, isProcessing: true });
  const releasesBeforeUnmount = h.hotkey.filter((entry) => entry === "unregister").length;
  await h.unmount();
  assert.equal(
    h.hotkey.filter((entry) => entry === "unregister").length,
    releasesBeforeUnmount + 1
  );
});

test("a start that never publishes a busy lifecycle never acquires Esc", async (t) => {
  globalThis.__startAlreadyIdle = true;
  t.after(() => delete globalThis.__startAlreadyIdle);
  const h = await mountHarness(t);
  await h.start();
  assert.deepEqual(h.hotkey, [], "an idle lifecycle never owns Escape");
});

test("the cancel hotkey cancels processing when nothing is recording", () => {
  const app = fs.readFileSync(path.join(__dirname, "../../src/App.jsx"), "utf8");
  assert.match(
    app,
    /onCancelHotkeyPressed\?\.\(\(\) => \{\s*if \(isRecordingRef\.current\) cancelRecording\(\);\s*else if \(isProcessingRef\.current\) cancelProcessing\(\);/
  );
});
