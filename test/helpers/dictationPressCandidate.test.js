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

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

async function fixture(t, settings = {}) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const handlers = {},
    visuals = [],
    calls = { prepared: [], starts: [], providerStarts: [], cancelled: [], notices: [] };
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
  globalThis.__pressCaptureGate = null;
  globalThis.__pressCaptureEntered = null;
  t.after(() => {
    delete globalThis.__pressCalls;
    delete globalThis.__pressVisuals;
    delete globalThis.__pressManager;
    delete globalThis.__pressCaptureGate;
    delete globalThis.__pressCaptureEntered;
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
          this.workletModuleLoaded = true;
          this.fixtureProvider = {
            start: async (options) => { globalThis.__pressCalls.providerStarts.push(options); return {success: true}; },
            stop: async () => ({success: true}), send() {}, finalize() {},
            onPartial: () => () => {}, onFinal: () => () => {},
            onError: () => () => {}, onSessionEnd: () => () => {},
          };
        }
        cacheMicrophoneDeviceId() {}
        async startStreamingRecording(force, candidate) {
          globalThis.__pressCalls.starts.push(candidate);
          return super.startStreamingRecording(force, candidate);
        }
        cancelPreparedMicCapture(candidate) {
          globalThis.__pressCalls.cancelled.push(candidate);
          return super.cancelPreparedMicCapture(candidate);
        }
        getAudioConstraints() { return {}; }
        async _acquireCaptureStream() {
          globalThis.__pressCaptureEntered?.();
          if (globalThis.__pressCaptureGate) await globalThis.__pressCaptureGate;
          const track = {stop() {}, getSettings: () => ({})};
          return {getTracks: () => [track], getAudioTracks: () => [track]};
        }
        startStreamingFallbackRecorder() {}
        async beginMicRecovery() {}
        getStreamingProvider() { return this.fixtureProvider; }
        getRecordingAudioLevel() { return 0; }
      }`,
      "/utils/dictationCues":
        "export const playStartCue = () => {}; export const playStopCue = () => {}; export const playErrorCue = () => {}; export const playCancelCue = () => {};",
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
    holdCapture() {
      const gate = deferred(),
        entered = deferred();
      globalThis.__pressCaptureGate = gate.promise;
      globalThis.__pressCaptureEntered = entered.resolve;
      return { entered: entered.promise, release: gate.resolve };
    },
    unmount: async () => {
      await React.act(async () => root.unmount());
      root = null;
    },
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
    assert.equal(await start, true);
  });
  assert.equal(f.calls.starts[0], first);
  assert.equal(f.calls.providerStarts[0].correlationId, first.id);
  assert.equal(first.intents.streamingProviderName, "deepgram");
  assert.equal(f.manager.activeSession.private, first.private);
  await React.act(async () => f.hook().cancelRecording());
  assert.equal(f.manager.activeSession, null);
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

for (const order of ["prepare-first", "start-first", "start-completes-first"]) {
  test(`same-press overlapping visual waits retain actual start admission (${order})`, async (t) => {
    const f = await fixture(t);
    let preparation, start;
    await React.act(async () => {
      preparation = f.handlers.prepare({ inputKind: "dictation" });
    });
    const candidate = f.manager._pressCandidate.session;
    await React.act(async () => {
      start = f.hook().startRecording();
    });
    assert.equal(f.visuals.length, 2);
    if (order === "prepare-first") {
      await React.act(async () => {
        f.visuals[0]();
        await preparation;
      });
      await React.act(async () => {
        f.visuals[1]();
        assert.equal(await start, true);
      });
    } else if (order === "start-completes-first") {
      await React.act(async () => {
        f.visuals[1]();
        assert.equal(await start, true);
      });
      await React.act(async () => {
        f.visuals[0]();
        await preparation;
      });
    } else {
      const capture = f.holdCapture();
      await React.act(async () => {
        f.visuals[1]();
        await capture.entered;
      });
      assert.equal(
        f.manager._pressCandidate.session,
        candidate,
        "real start passed its first admission check"
      );
      await React.act(async () => {
        f.visuals[0]();
        await preparation;
      });
      await React.act(async () => {
        capture.release();
        assert.equal(await start, true);
      });
    }
    assert.equal(
      f.calls.cancelled.includes(candidate),
      false,
      "late prepare cannot cancel its transferred start candidate"
    );
    assert.equal(f.calls.starts[0], candidate);
    assert.equal(
      f.calls.providerStarts[0].correlationId,
      candidate.id,
      "actual manager start reaches only the fake provider leaf"
    );
    assert.equal(f.manager.activeSession, candidate);
    await React.act(async () => f.hook().cancelRecording());
    assert.equal(f.manager.activeSession, null);
  });
}

for (const action of ["cancel", "unmount"]) {
  test(`an overlapping prepare/start still releases its candidate on ${action}`, async (t) => {
    const f = await fixture(t);
    let preparation, start;
    await React.act(async () => {
      preparation = f.handlers.prepare({ inputKind: "dictation" });
      start = f.hook().startRecording();
    });
    const candidate = f.manager._pressCandidate.session;
    if (action === "cancel") await React.act(async () => f.handlers.cancel());
    else await f.unmount();
    assert.equal(f.manager._pressCandidate, null);
    await React.act(async () => {
      f.visuals[0]();
      await preparation;
      f.visuals[1]();
      assert.equal(await start, false);
    });
    assert.equal(f.calls.cancelled.includes(candidate), true);
    assert.equal(f.manager.activeSession, null);
    assert.equal(f.calls.providerStarts.length, 0);
  });
}

test("an immediate provider start refusal stays handled while mic recovery is awaiting", async (t) => {
  const f = await fixture(t);
  const gate = deferred(),
    entered = deferred();
  f.manager.fixtureProvider.start = async () => {
    throw Error("Synthetic start refusal");
  };
  f.manager.beginMicRecovery = async () => {
    entered.resolve();
    await gate.promise;
  };
  let starting;
  await React.act(async () => {
    starting = f.hook().startRecording();
  });
  await React.act(async () => {
    f.visuals.shift()();
    await entered.promise;
  });
  // Cross a macrotask while the provider's rejection is already settled.
  await new Promise((resolve) => setImmediate(resolve));
  await React.act(async () => {
    gate.resolve();
    assert.equal(await starting, false);
  });
  assert.equal(f.manager.isRecording, false);
});
