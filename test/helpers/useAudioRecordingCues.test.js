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

async function mount(t) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const noop = () => () => {};
  const listeners = {};
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        onPrepareDictation: (cb) => ((listeners.prepare = cb), () => delete listeners.prepare),
        onCancelDictationPreparation: (cb) => (
          (listeners.cancelPrepare = cb),
          () => delete listeners.cancelPrepare
        ),
        onToggleDictation: noop,
        registerCancelHotkey() {},
        unregisterCancelHotkey() {},
        dictationLifecycleStateChanged() {},
        captureDictationTarget: async () => ({}),
      },
    },
  });
  const container = installHookDom(t);
  globalThis.requestAnimationFrame = (cb) => (cb(), 1);
  globalThis.__cueLog = [];
  t.after(() => {
    delete globalThis.__cueLog;
    delete globalThis.__cueManager;
  });
  const cueModule = ["Start", "Stop", "Success", "Cancel", "Error", "MicBack"]
    .map(
      (name) =>
        `export const play${name}Cue = async () => { globalThis.__cueLog.push("${name}"); };`
    )
    .join("\n");
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-cue-hook-",
    mockModules: {
      "/utils/dictationCues": cueModule,
      "/helpers/audioManager": `export default class {
      constructor(){ globalThis.__cueManager=this; this.allowed=true; this.cancelled=false; }
      getState(){ return { isRecording:this.recording===true, isProcessing:this.processing===true, isStreaming:this.streaming===true }; }
      setCallbacks(cb){this.cb=cb;} cleanup(){} getRecordingAudioLevel(){return null;}
      getOrCreatePressCandidate(intents){return {intents,settings:{}};}
      isPressCandidateAllowed(){return this.allowed;}
      _showUnknownRecipientBlockedStart(){this.cb.onError({message:"unknown recipient"});}
      setVoiceAgentRequested(){} setAssistantSelectionContext(){} setTranslationRequested(){}
      shouldUseStreaming(){return false;} prepareMicCapture(){globalThis.__cueLog.push("mic");} cancelPreparedMicCapture(){}
      async startRecording(){ if(this.fail){this.cb.onError({message:"start failed"});return false;} this.recording=true; return true; }
      cancelRecording(){return this.cancelled;} async cancelStreamingRecording(){return this.pendingCancel ?? this.cancelled;}
      cancelProcessing(){return this.cancelled;} safePaste(){return this.paste ?? true;}
      async saveTranscription(){return true;}
    }`,
    },
  });
  const { useAudioRecording } = await vite.ssrLoadModule("/hooks/useAudioRecording.js");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  useSettingsStore.setState({ autoPasteEnabled: true, keepTranscriptionInClipboard: false });
  const ref = {};
  function Harness(props) {
    ref.api = useAudioRecording(props);
    return null;
  }
  root = createRoot(container);
  const render = (props = {}) =>
    React.act(async () => root.render(React.createElement(Harness, props)));
  await render();
  return {
    ref,
    render,
    listeners,
    manager: () => globalThis.__cueManager,
    log: globalThis.__cueLog,
    unmount: async () => {
      await React.act(async () => root.unmount());
      root = null;
    },
  };
}
const fire = (manager, name, ...args) => React.act(async () => manager.cb[name](...args));

test("press sounds before mic acquisition, failed start then sounds error, busy start stays silent", async (t) => {
  const { ref, manager, log } = await mount(t);
  manager().fail = true;
  await React.act(async () => assert.equal(await ref.api.startRecording(), false));
  assert.deepEqual(log, ["Start", "mic", "Error"]);
  log.length = 0;
  manager().recording = true;
  await React.act(async () => assert.equal(await ref.api.startRecording(), false));
  assert.deepEqual(log, []);
});

test("refused admission acknowledges the press then error without mic acquisition", async (t) => {
  const { ref, manager, log } = await mount(t);
  manager().allowed = false;
  await React.act(async () => assert.equal(await ref.api.startRecording(), false));
  assert.deepEqual(log, ["Start", "Error"]);
});

test("only successful owning paste sounds success; stale paste and stale errors stay silent", async (t) => {
  const { ref, manager, log, render } = await mount(t);
  const am = manager();
  am.activeSession = { id: "A" };
  await fire(am, "onStateChange", { isRecording: true });
  await fire(am, "onStateChange", { isRecording: false });
  await fire(am, "onTranscriptionComplete", { success: true, text: "one two" });
  assert.equal(ref.api.outcome.kind, "pasted");
  assert.deepEqual(log, ["Success"]);
  log.length = 0;
  const paste = deferred();
  am.paste = paste.promise;
  let pending;
  await React.act(async () => {
    pending = am.cb.onTranscriptionComplete({ success: true, text: "old" });
  });
  am.activeSession = { id: "B" };
  await fire(am, "onStateChange", { isRecording: true });
  await React.act(async () => {
    paste.resolve(true);
    await pending;
  });
  assert.deepEqual(log, []);
  const old = am;
  await render({ trialMode: true });
  await fire(old, "onError", { message: "retired" });
  await fire(old, "onNoAudio");
  await fire(old, "onStateChange", { micCaptureStatus: "unavailable" });
  await fire(old, "onStateChange", { micCaptureStatus: "active" });
  await fire(old, "onTranscriptionComplete", { success: true, text: "retired" });
  assert.deepEqual(log, []);
});

test("actual cancellation sounds once while no-op, refused and retired async cancellation stay silent", async (t) => {
  const { ref, manager, log, render } = await mount(t);
  const am = manager();
  await React.act(async () => assert.equal(await ref.api.cancelRecording(), false));
  await React.act(async () => assert.equal(ref.api.cancelProcessing(), false));
  assert.deepEqual(log, []);
  am.cancelled = true;
  am.activeSession = { id: "recording" };
  await React.act(async () => assert.equal(await ref.api.cancelRecording(), true));
  am.activeSession = { id: "processing" };
  await fire(am, "onStateChange", { isProcessing: true });
  await React.act(async () => assert.equal(ref.api.cancelProcessing(), true));
  assert.deepEqual(log, ["Cancel", "Cancel"]);
  log.length = 0;
  am.streaming = true;
  const wait = deferred();
  am.pendingCancel = wait.promise;
  let pending;
  await React.act(async () => {
    pending = ref.api.cancelRecording();
  });
  await render({ trialMode: true });
  await React.act(async () => {
    wait.resolve(true);
    await pending;
  });
  assert.deepEqual(log, []);
});

test("mic recovery sounds only on unavailable→active; cancellation errors and informational notices stay silent", async (t) => {
  const { manager, log } = await mount(t);
  const am = manager();
  await fire(am, "onStateChange", { micCaptureStatus: "active" });
  await fire(am, "onStateChange", { micCaptureStatus: "unavailable" });
  await fire(am, "onStateChange", { micCaptureStatus: "active" });
  await fire(am, "onStateChange", { micCaptureStatus: "active" });
  await fire(am, "onError", { code: "TRANSCRIPTION_CANCELLED" });
  await fire(am, "onError", { variant: "default", message: "informational" });
  assert.deepEqual(log, ["MicBack"]);
  await fire(am, "onError", { message: "real failure" });
  assert.deepEqual(log, ["MicBack", "Error"]);
});

test("prepare acknowledges exact press before mic and start adoption stays silent; cancel/new press acknowledges again", async (t) => {
  const { ref, manager, log, listeners } = await mount(t);
  await React.act(async () => listeners.prepare({ inputKind: "dictation" }));
  assert.deepEqual(log, ["Start", "mic"]);
  await React.act(async () => ref.api.startRecording());
  assert.equal(log.filter((v) => v === "Start").length, 1);
  manager().recording = false;
  log.length = 0;
  await React.act(async () => listeners.prepare({ inputKind: "dictation" }));
  await React.act(async () => listeners.cancelPrepare());
  await React.act(async () => listeners.prepare({ inputKind: "dictation" }));
  assert.deepEqual(log, ["Start", "mic", "Start", "mic"]);
  manager().allowed = false;
  log.length = 0;
  await React.act(async () => listeners.prepare({ inputKind: "dictation" }));
  assert.deepEqual(log, ["Start", "Error"]);
  manager().recording = true;
  log.length = 0;
  await React.act(async () => listeners.prepare({ inputKind: "dictation" }));
  assert.deepEqual(log, []);
});

test("duplicate completion and repeated streaming cancellation join one cue per owning operation", async (t) => {
  const { ref, manager, log } = await mount(t);
  const am = manager();
  am.activeSession = { id: "A" };
  await fire(am, "onTranscriptionComplete", { success: true, text: "one" });
  await fire(am, "onTranscriptionComplete", { success: true, text: "one" });
  assert.deepEqual(log, ["Success"]);
  log.length = 0;
  am.streaming = true;
  am.recording = true;
  const wait = deferred();
  am.pendingCancel = wait.promise;
  let first, second;
  await React.act(async () => {
    first = ref.api.cancelRecording();
    second = ref.api.cancelRecording();
  });
  await React.act(async () => {
    wait.resolve(true);
    await Promise.all([first, second]);
  });
  assert.deepEqual(log, ["Cancel"]);
});

test("a delayed cancellation cannot sound over a newer same-manager session", async (t) => {
  const { ref, manager, log } = await mount(t);
  const am = manager();
  am.activeSession = { id: "A" };
  am.streaming = true;
  const wait = deferred();
  am.pendingCancel = wait.promise;
  let pending;
  await React.act(async () => {
    pending = ref.api.cancelRecording();
  });
  am.activeSession = { id: "B" };
  await fire(am, "onStateChange", { isRecording: true });
  await React.act(async () => {
    wait.resolve(true);
    await pending;
  });
  assert.deepEqual(log, []);
});

test("Undo processing of the same session earns a fresh cancellation cue", async (t) => {
  const { ref, manager, log } = await mount(t);
  const am = manager();
  am.activeSession = { id: "same" };
  am.cancelled = true;
  await fire(am, "onStateChange", { isRecording: true });
  await React.act(async () => ref.api.cancelRecording());
  await fire(am, "onStateChange", { isRecording: false, isProcessing: false });
  await fire(am, "onStateChange", { isRecording: false, isProcessing: true });
  await React.act(async () => ref.api.cancelProcessing());
  assert.deepEqual(log, ["Cancel", "Cancel"]);
});

test("a replacement manager's active microphone is not a restoration of its retired predecessor", async (t) => {
  const { manager, render, log } = await mount(t);
  await fire(manager(), "onStateChange", { micCaptureStatus: "unavailable" });
  await render({ trialMode: true });
  await fire(manager(), "onStateChange", { micCaptureStatus: "active" });
  assert.deepEqual(log, []);
});
