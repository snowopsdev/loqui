const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { setup, startBatch, blob } = require("./harness/cancelledAudioManager");
const { createRendererServer, installHookDom } = require("../lib/rendererTestHarness");
const { undoBridge } = require("./harness/undoBridge");

test("actual hook reinstall retires disposed holds, refs, leases and demo cache across effect dependencies", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__task9ReinstallManager;
    delete globalThis.__task9ReinstallTranslate;
    delete globalThis.__task15ReinstallCues;
  });
  const { manager: original, advance, window: win, AudioManager } = await setup(t);
  const initialFields = {
    ...original,
    cacheMicrophoneDeviceId() {},
    preparedMicCapture: { cancel() {} },
    micStreamHold: { drop() {} },
    saveTranscription: async () => true,
    safePaste: async () => true,
  };
  const installations = [];
  const restores = [];
  globalThis.__task9ReinstallManager = () => {
    const manager = Object.assign(Object.create(AudioManager.prototype), initialFields, {
      restoreCancelled(...args) {
        restores.push({ manager: this, args });
        return AudioManager.prototype.restoreCancelled.apply(this, args);
      },
    });
    installations.push(manager);
    return manager;
  };
  const translate = (key) => key;
  globalThis.__task9ReinstallTranslate = translate;
  const cueLog = [];
  globalThis.__task15ReinstallCues = cueLog;
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-undo-reinstall-",
    noExternal: ["react-i18next"],
    mockModules: {
      "/utils/dictationCues": ["Start", "Stop", "Success", "Cancel", "Error", "MicBack"]
        .map(
          (name) =>
            `export const play${name}Cue = async () => globalThis.__task15ReinstallCues.push("${name}");`
        )
        .join("\n"),
      "/helpers/audioManager":
        "export default class { constructor() { return globalThis.__task9ReinstallManager(); } }",
      "react-i18next":
        'export const useTranslation = () => ({ t: globalThis.__task9ReinstallTranslate }); export const initReactI18next = { type: "3rdParty", init() {} };',
    },
  });
  const { useAudioRecording } = await vite.ssrLoadModule("/hooks/useAudioRecording.js");
  const { useUndoCancelHotkey } = await vite.ssrLoadModule("/hooks/useUndoCancelHotkey.ts");
  // Register after both Vite teardown hooks so inert main leaves remain alive
  // through React unmount and every server/handler continuation.
  const bridge = undoBridge(t);
  const log = [];
  let leaseId = 0;
  const liveLeases = new Set();
  const noop = () => () => {};
  Object.assign(win.electronAPI, {
    onToggleDictation: noop,
    dictationLifecycleStateChanged: (state) => log.push(["lifecycle", state]),
    registerCancelHotkey() {},
    unregisterCancelHotkey() {},
    acquirePillHotkey: async (slot) => {
      const id = ++leaseId;
      liveLeases.add(id);
      log.push(["acquire", slot, id]);
      return { leaseId: id, held: true };
    },
    releasePillHotkey: async (id) => {
      liveLeases.delete(id);
      log.push(["release", id]);
    },
    onPillHotkeyPressed: noop,
    onPillHotkeyReleased: noop,
  });
  const demo = [];
  const publishDemo = (event) => {
    demo.push(event);
    assert.equal(bridge.invoke("onboarding-demo-publish", event), true);
  };
  const ref = {};
  function Harness(props) {
    ref.api = useAudioRecording({ ...props, onDemoEvent: publishDemo });
    ref.hotkey = useUndoCancelHotkey(ref.api.cancelled, ref.api.undoCancel);
    return null;
  }
  const props = { trialMode: false, onToggle() {}, onDictationError() {} };
  root = createRoot(container);
  const render = () => React.act(async () => root.render(React.createElement(Harness, props)));
  await render();

  for (const dependency of ["trialMode", "t", "onToggle", "onDictationError"]) {
    const oldManager = installations.at(-1);
    let recorder;
    await React.act(async () => {
      recorder = startBatch(oldManager, [1], 2, { manualStop: true });
      oldManager.onStateChange(oldManager.getState());
      const before = cueLog.length;
      assert.equal(await ref.api.cancelRecording(), true);
      assert.deepEqual(cueLog.slice(before), ["Cancel"]);
      assert.equal(await ref.api.cancelRecording(), false);
      assert.deepEqual(cueLog.slice(before), ["Cancel"], "real manager no-op stays silent");
      await advance(0);
    });
    const heldA = oldManager._undo.peek();
    const stateA = ref.api.cancelled;
    const staleCancelledCallback = oldManager.onCancelledChange;
    const stalePartial = oldManager.onPartialTranscript;
    const staleCommit = oldManager.onStreamingCommit;
    const staleCompletion = oldManager.onTranscriptionComplete;
    const staleError = oldManager.onError;
    const leaseA = leaseId;
    assert.equal(stateA.sessionId, heldA.session.id);
    assert.equal(ref.hotkey.held, true);
    assert.deepEqual(bridge.windowManager.lastCancelledDictation, { sessionId: heldA.session.id });
    const installCount = installations.length;
    await render();
    assert.equal(
      installations.length,
      installCount,
      "unchanged props preserve the valid installation"
    );
    assert.equal(oldManager._undo.peek(), heldA);
    assert.equal(ref.hotkey.held, true);
    assert.equal(liveLeases.has(leaseA), true);

    if (dependency === "trialMode") props.trialMode = true;
    else if (dependency === "t") globalThis.__task9ReinstallTranslate = (key) => `${key}:new`;
    else props[dependency] = () => {};
    await render();
    const replacement = installations.at(-1);
    assert.notEqual(replacement, oldManager);
    assert.equal(
      oldManager._undo.peek(),
      null,
      `${dependency}: cleanup closes the old real window`
    );
    assert.equal(heldA.isZeroed(), true);
    assert.equal(heldA.context.released, true);
    assert.equal(
      ref.api.cancelled,
      null,
      `${dependency}: a new installation cannot expose erased audio`
    );
    assert.equal(ref.hotkey.held, false);
    assert.deepEqual(ref.api.liveText, { committed: "", partial: "", cleaned: null });
    assert.equal(liveLeases.has(leaseA), false);
    assert.equal(log.filter(([kind, id]) => kind === "release" && id === leaseA).length, 1);
    assert.equal(bridge.windowManager.lastCancelledDictation, null);
    assert.deepEqual(demo.at(-1), {
      kind: "dictation",
      status: "cancelClosed",
      sessionId: heldA.session.id,
      reason: "flushed",
    });
    assert.deepEqual(log.filter(([kind]) => kind === "lifecycle").at(-1), ["lifecycle", "idle"]);
    await React.act(async () => assert.equal(await ref.api.undoCancel(), false));
    assert.equal(restores.at(-1).manager, replacement);
    assert.equal(
      restores.at(-1).args[0],
      undefined,
      "Undo reads a cleared ref, never the disposed session id"
    );

    await React.act(async () => {
      startBatch(replacement, [], 3);
      replacement.onStateChange(replacement.getState());
      const before = cueLog.length;
      assert.equal(await ref.api.cancelRecording(), true);
      assert.deepEqual(cueLog.slice(before), ["Cancel"]);
      await advance(0);
    });
    const heldB = replacement._undo.peek();
    assert.equal(ref.api.cancelled.sessionId, heldB.session.id);
    assert.equal(ref.hotkey.held, true);
    const beforeStale = { demo: demo.length, log: log.length, cues: cueLog.length };
    await React.act(async () => {
      staleError({ message: "retired failure" });
      stalePartial("retired partial");
      staleCommit("retired commit");
      await staleCompletion({ success: true, text: "retired cleaned" });
      staleCancelledCallback(stateA);
      staleCancelledCallback(null, { sessionId: heldA.session.id, reason: "expired" });
      recorder.ondataavailable({ data: blob(9) });
      recorder.finish();
      await advance(0);
    });
    assert.equal(ref.api.cancelled.sessionId, heldB.session.id);
    assert.deepEqual(
      ref.api.liveText,
      { committed: "", partial: "", cleaned: null },
      "retired installation cannot publish words"
    );
    assert.equal(replacement._undo.peek(), heldB);
    assert.equal(heldB.context.released, false);
    assert.equal(ref.hotkey.held, true);
    assert.equal(cueLog.length, beforeStale.cues, "retired real-manager callbacks stay silent");
    assert.equal(demo.length, beforeStale.demo, "retired callbacks cannot publish over B");
    assert.equal(log.length, beforeStale.log, "retired callbacks cannot report lifecycle over B");
    assert.deepEqual(bridge.windowManager.lastCancelledDictation, { sessionId: heldB.session.id });
    await React.act(async () => {
      assert.equal(await ref.api.undoCancel(), true);
      await replacement._restoreRun;
    });
    assert.equal(ref.api.cancelled, null);
    assert.equal(ref.hotkey.held, false);
    assert.equal(liveLeases.size, 0);
    assert.equal(bridge.windowManager.lastCancelledDictation, null);
    const restoredIndex = demo.findIndex(
      (event) => event.status === "cancelClosed" && event.sessionId === heldB.session.id
    );
    assert.equal(demo[restoredIndex].reason, "restored");
    assert.equal(demo[restoredIndex + 1].status, "processing");
  }
  assert.equal(installations.length, 5);
  assert.equal(log.filter(([kind]) => kind === "acquire").length, 8);
  assert.equal(log.filter(([kind]) => kind === "release").length, 8);
});
