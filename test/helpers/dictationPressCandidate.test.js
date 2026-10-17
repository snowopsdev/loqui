const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
  installMicCaptureGlobals,
} = require("../lib/rendererTestHarness");

async function fixture(t, settings = {}) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const handlers = {},
    visuals = [],
    calls = { prepared: [], starts: [], notices: [] };
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        onToggleDictation: () => () => {},
        onToggleVoiceAgent: () => () => {},
        onToggleTranslation: () => () => {},
        onPrepareDictation: (fn) => {
          handlers.prepare = fn;
          return () => {};
        },
        onCancelDictationPreparation: (fn) => {
          handlers.cancel = fn;
          return () => {};
        },
      },
    },
  });
  const container = installHookDom(t);
  installMicCaptureGlobals(t);
  navigator.mediaDevices.getUserMedia = async () => {
    throw new Error("Fixture forbids actual mic acquisition");
  };
  globalThis.__pressCalls = calls;
  globalThis.__pressVisuals = visuals;
  t.after(() => {
    delete globalThis.__pressCalls;
    delete globalThis.__pressVisuals;
    delete globalThis.__pressManager;
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-press-candidate-hook-",
    mockModules: {
      "/utils/logger":
        "export default { debug() {}, info() {}, warn() {}, error() {}, logReasoning() {} };",
      "/helpers/audioManager": `import Real from "/helpers/audioManager.js";
      export default class extends Real {
        constructor() {
          super(); globalThis.__pressManager = this;
          this.preparedMicCapture.prepare = async () => { globalThis.__pressCalls.prepared.push(this._preparedCaptureCandidate); return null; };
          this.shouldUseStreaming = () => true;
        }
        cacheMicrophoneDeviceId() {}
        async startStreamingRecording(force, candidate) { globalThis.__pressCalls.starts.push(candidate); this.beginDictationSession({}, candidate); return true; }
      }`,
      "/utils/visualFrame":
        "export function waitForVisualFrames() { return new Promise((resolve) => globalThis.__pressVisuals.push(resolve)); }",
      "/components/ui/notices":
        "export const notify = (notice) => globalThis.__pressCalls.notices.push(notice); export const dismissNotice = () => {}; export const getNotices = () => [];",
    },
  });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  useSettingsStore.setState({
    useCleanupModel: false,
    useDictationAgent: false,
    useLocalWhisper: false,
    transcriptionMode: "providers",
    cloudTranscriptionProvider: "deepgram",
    cloudTranscriptionModel: "nova-3",
    voiceAgentScreenContext: false,
    ...settings,
  });
  const { useAudioRecording } = await vite.ssrLoadModule("/hooks/useAudioRecording.js");
  let hook;
  function Harness() {
    hook = useAudioRecording();
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  return {
    hook: () => hook,
    manager: globalThis.__pressManager,
    handlers,
    visuals,
    calls,
    setSettings: (next) => useSettingsStore.setState(next),
  };
}

test("the actual hook prepares the current assistant input and blocks unknown enterprise before visual/mic work", async (t) => {
  const f = await fixture(t, {
    useDictationAgent: true,
    dictationAgentMode: "providers",
    dictationAgentProvider: "azure",
    dictationAgentModel: "deployment",
  });
  assert.equal(f.manager.voiceAgentRequested, false);
  await React.act(async () => f.handlers.prepare({ inputKind: "assistant" }));
  assert.equal(f.visuals.length, 0);
  assert.equal(f.calls.prepared.length, 0);
  assert.equal(f.calls.notices.length, 1);
  assert.match(f.calls.notices[0].body, /destination/);
  assert.equal(f.manager._pressCandidate, null);
});

test("a superseded visual continuation cannot prepare/start or clear a newer candidate", async (t) => {
  const f = await fixture(t);
  let a, b;
  await React.act(async () => {
    a = f.handlers.prepare({ inputKind: "dictation" });
  });
  const first = f.manager._pressCandidate.session;
  await React.act(async () => {
    b = f.handlers.prepare({ inputKind: "dictation" });
  });
  const second = f.manager._pressCandidate.session;
  assert.notEqual(first, second);
  await React.act(async () => {
    f.visuals[0]();
    await a;
  });
  assert.equal(f.calls.prepared.length, 0);
  assert.equal(f.manager._pressCandidate.session, second);
  await React.act(async () => {
    f.visuals[1]();
    await b;
  });
  assert.equal(f.calls.prepared[0], second);
});

test("prepare/start shares the exact provider/privacy candidate across changed settings; a new press captures fresh authority", async (t) => {
  const f = await fixture(t);
  let preparation;
  await React.act(async () => {
    preparation = f.handlers.prepare({ inputKind: "dictation" });
  });
  const first = f.manager._pressCandidate.session;
  await React.act(async () => {
    f.visuals.shift()();
    await preparation;
  });
  f.setSettings({
    cloudTranscriptionProvider: "assemblyai",
    cloudTranscriptionModel: "universal-3-pro",
  });
  f.manager._recordingPrivate = !first.private;
  let start;
  await React.act(async () => {
    start = f.hook().startRecording();
  });
  await React.act(async () => {
    f.visuals.shift()();
    await start;
  });
  assert.equal(f.calls.starts[0], first);
  assert.equal(first.intents.streamingProviderName, "deepgram");
  assert.equal(f.manager.activeSession.private, first.private);
  f.manager._endDictationSession(first);
  await React.act(async () => f.handlers.cancel());
  let next;
  await React.act(async () => {
    next = f.handlers.prepare({ inputKind: "dictation" });
  });
  const second = f.manager._pressCandidate.session;
  assert.notEqual(second, first);
  assert.equal(second.intents.streamingProviderName, "assemblyai");
  await React.act(async () => {
    f.visuals.shift()();
    await next;
  });
});
