const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

const FAKE_AUDIO_MANAGER_SOURCE = `
export default class FakeAudioManager {
  _ownedAudioSnapshot() { return { blob: this.lastAudioBlob ?? null, private: false, sessionId: this.activeSession?.id ?? null }; }
  isPressCandidateAllowed() { return true; }
  getOrCreatePressCandidate(intents) { return { intents, settings: {}, routes: { dictationStt: { providerId: null }, voiceAssistant: { providerId: null }, translation: { providerId: null } } }; }

  constructor() {
    this.voiceAgentRequested = false;
    this.translationRequested = false;
    this.sttConfig = {};
    this.activeSession = null;
    globalThis.__forceStopAudioManager = this;
  }
  getState() {
    return {};
  }
  setCallbacks(callbacks) {
    this.callbacks = callbacks;
  }
  setVoiceAgentRequested() {}
  setAssistantSelectionContext() {}
  setTranslationRequested() {}
  startRecording() {
    return Promise.resolve(true);
  }
  complete(result) {
    return this.callbacks.onTranscriptionComplete(result);
  }
  async safePaste(text, options) {
    globalThis.__forceStopPastes.push({ text, options });
    if (globalThis.__forceStopPasteGate) await globalThis.__forceStopPasteGate;
    return globalThis.__forceStopPasteResult !== false;
  }
  saveTranscription() {
    return Promise.resolve(true);
  }
  shouldUseStreaming() {
    return false;
  }
  cleanup() {}
}
`;

const SETTINGS_STORE_SOURCE = `
export const useSettingsStore = { subscribe: () => () => {} };
export const getSettings = () => globalThis.__forceStopSettings;
`;

const LOGGER_SOURCE = `
const noop = () => {};
export default {
  trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
  logReasoning: noop,
};
`;

const TRANSLATION_SOURCE = `
const translate = (key) => key;
export const useTranslation = () => ({ t: translate });
`;

const NOOP = () => {};

async function mountHarness(t, { settings, writeClipboard, pasteResult = true } = {}) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });

  const clipboardWrites = [];
  let forceStopListener = null;
  const noopDispose = () => () => {};

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
        onDictationForceStopped: (callback) => {
          forceStopListener = callback;
          return () => {};
        },
        dictationLifecycleStateChanged: NOOP,
        completeDictationPreview: NOOP,
        hideDictationPreview: NOOP,
        setScreenContextEnabled: NOOP,
        async writeClipboard(text) {
          clipboardWrites.push(text);
          return writeClipboard ? writeClipboard(text) : { success: true };
        },
      },
    },
  });
  const container = installHookDom(t);

  globalThis.__forceStopSettings = {
    autoPasteEnabled: true,
    keepTranscriptionInClipboard: false,
    showTranscriptionPreview: false,
    snippets: [],
    useLocalWhisper: false,
    pauseMediaOnDictation: false,
    voiceAgentScreenContext: false,
    ...settings,
  };
  globalThis.__forceStopPastes = [];
  globalThis.__forceStopPasteResult = pasteResult;
  globalThis.__forceStopPasteGate = null;

  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-audio-recording-force-stop-",
    noExternal: ["react-i18next"],
    mockModules: {
      "/helpers/audioManager": FAKE_AUDIO_MANAGER_SOURCE,
      "/stores/settingsStore": SETTINGS_STORE_SOURCE,
      "/utils/logger": LOGGER_SOURCE,
      "react-i18next": TRANSLATION_SOURCE,
    },
  });
  const notices = await vite.ssrLoadModule("/components/ui/notices.ts");
  notices.__setNoticeClockForTests();
  t.after(() => notices.__setNoticeClockForTests());
  const { useAudioRecording } = await vite.ssrLoadModule("/hooks/useAudioRecording.js");

  const api = {};
  function Harness() {
    Object.assign(api, useAudioRecording({ onDemoEvent: NOOP }));
    return null;
  }

  root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(Harness));
  });

  return {
    clipboardWrites,
    pastes: globalThis.__forceStopPastes,
    get toasts() {
      return notices.getNotices();
    },
    notices,
    session: (id) => {
      globalThis.__forceStopAudioManager.activeSession = id ? { id } : null;
    },
    fail: async (error) => {
      await React.act(async () => globalThis.__forceStopAudioManager.callbacks.onError(error));
    },
    forceStop: async (reason) => {
      assert.ok(forceStopListener, "the hook must subscribe to dictation-force-stopped");
      await React.act(async () => forceStopListener({ reason }));
    },
    startRecording: async () => {
      await React.act(async () => api.startRecording());
    },
    complete: async (result) => {
      await React.act(async () => {
        await globalThis.__forceStopAudioManager.complete({
          success: true,
          text: "held too long",
          rawText: "held too long",
          clientTranscriptionId: "force-stop",
          source: "openai",
          ...result,
        });
      });
    },
  };
}

const errorToasts = (harness) =>
  harness.toasts.filter(
    (entry) => entry.id === "dictation-error" || entry.id.startsWith("dictation-recovery:")
  );

// The whole point of the fix: the trigger keys are still down, so the paste
// shortcut must not be injected, and the transcript must stay recoverable.
for (const reason of ["timeout", "reset"]) {
  test(`a push force-stopped by "${reason}" keeps the transcript instead of pasting it`, async (t) => {
    const harness = await mountHarness(t);

    await harness.forceStop(reason);
    await harness.complete();

    assert.deepEqual(harness.pastes, [], "nothing may be injected into held keys");
    assert.deepEqual(harness.clipboardWrites, ["held too long"]);
    const [toast] = errorToasts(harness);
    assert.ok(toast, "the transcript is surfaced, not dropped");
    assert.equal(toast.body, "hooks.audioRecording.pushForceStopped.description");
    // A batch transcription has no streaming text, so the pill's transcript
    // argument is the only thing that can produce this action — and it is the
    // sole in-app recovery when the clipboard write is the part that failed.
    assert.equal(toast.words, "held too long");
    assert.equal(toast.actions[0].label, "notices.actions.pasteAgain");
  });
}

test("an ordinary dictation still pastes", async (t) => {
  const harness = await mountHarness(t);

  await harness.complete();

  assert.equal(harness.pastes.length, 1);
  assert.deepEqual(harness.clipboardWrites, []);
  assert.deepEqual(errorToasts(harness), []);
});

// With auto-paste off nothing was going to be injected, so there is no loss to
// report — and overriding keepTranscriptionInClipboard would clobber a clipboard
// the user asked to leave alone.
test("a force stop is inert when auto-paste is disabled", async (t) => {
  const harness = await mountHarness(t, { settings: { autoPasteEnabled: false } });

  await harness.forceStop("timeout");
  await harness.complete();

  assert.deepEqual(harness.pastes, []);
  assert.deepEqual(harness.clipboardWrites, [], "keepTranscriptionInClipboard is off");
  assert.deepEqual(errorToasts(harness), [], "no paste was lost, so no error");
});

// The latch is per-recording. If it survived, every later dictation in the
// session would stop pasting and dump onto the clipboard instead.
test("the latch does not leak into the next dictation", async (t) => {
  const harness = await mountHarness(t);

  await harness.forceStop("timeout");
  await harness.complete();
  assert.deepEqual(harness.pastes, [], "the force-stopped one is held back");

  await harness.startRecording();
  await harness.complete();

  assert.equal(harness.pastes.length, 1, "the next dictation pastes normally");
  assert.equal(errorToasts(harness).length, 1, "the first card stays; no second card");
});

// Only reasons that leave the keys down may suppress a paste. A stop the
// renderer asked for itself must not be swept in.
test("a reason that is not a forced key-down stop does not latch", async (t) => {
  const harness = await mountHarness(t);

  await harness.forceStop("manual");
  await harness.complete();

  assert.equal(harness.pastes.length, 1, "a manual stop still pastes");
  assert.deepEqual(harness.clipboardWrites, []);
  assert.deepEqual(errorToasts(harness), []);
});

// The pill must not promise a clipboard that rejected the write — the transcript
// action on it is the recovery path either way.
for (const [label, writeClipboard] of [
  ["reports failure", async () => ({ success: false })],
  [
    "throws",
    async () => {
      throw new Error("clipboard unavailable");
    },
  ],
]) {
  test(`a clipboard write that ${label} is not described as a success`, async (t) => {
    const harness = await mountHarness(t, { writeClipboard });

    await harness.forceStop("timeout");
    await harness.complete();

    assert.deepEqual(harness.pastes, [], "still nothing injected into held keys");
    const [toast] = errorToasts(harness);
    assert.ok(toast, "the transcript is still surfaced");
    assert.equal(toast.body, "hooks.audioRecording.pushForceStopped.descriptionClipboardFailed");
  });
}

test("an error card that holds the transcript never auto-dismisses", async (t) => {
  const harness = await mountHarness(t);
  await harness.forceStop("timeout");
  await harness.complete();
  const [toast] = errorToasts(harness);
  assert.equal(toast.words, "held too long");
  assert.equal(toast.expiresAt, null, "the user's words stay until they act on them");
});

test("an error card without a transcript keeps the reading-time timer", async (t) => {
  const harness = await mountHarness(t);
  await React.act(async () =>
    globalThis.__forceStopAudioManager.callbacks.onError({ message: "Network down" })
  );
  const [toast] = errorToasts(harness);
  assert.ok(toast, "the error is shown");
  assert.ok(toast.expiresAt > toast.createdAt, "a status-only alert has a reading-time deadline");
});

test("two failed deliveries both stay recoverable, through a status error and a third successful dictation (R2-C3)", async (t) => {
  const harness = await mountHarness(t, {
    writeClipboard: async () => {
      throw new Error("clipboard unavailable");
    },
  });
  const held = () =>
    harness.notices.wordsNotices(harness.notices.getNotices()).map((n) => [n.id, n.words]);

  harness.session("rec-1");
  await harness.forceStop("timeout");
  await harness.complete({ text: "first words", rawText: "first words" });

  await harness.startRecording();
  harness.session("rec-2");
  await harness.forceStop("timeout");
  await harness.complete({ text: "second words", rawText: "second words" });
  assert.deepEqual(held(), [
    ["dictation-recovery:rec-1", "first words"],
    ["dictation-recovery:rec-2", "second words"],
  ]);

  // A failure without content takes the stable status id…
  await harness.fail({
    title: "Transcription Error",
    description: "Transcription failed: timeout",
  });
  assert.equal(harness.toasts.filter((n) => n.id === "dictation-error").length, 1);

  // …and the next start and success clear that one, and only that one.
  await harness.startRecording();
  harness.session("rec-3");
  await harness.complete({ text: "third words", rawText: "third words" });
  assert.equal(harness.pastes.at(-1).text, "third words", "the third dictation pasted");
  assert.equal(
    harness.toasts.some((n) => n.id === "dictation-error"),
    false
  );
  assert.deepEqual(held(), [
    ["dictation-recovery:rec-1", "first words"],
    ["dictation-recovery:rec-2", "second words"],
  ]);

  // Paste again on the first card recovers it, and removes that card only.
  const first = harness.toasts.find((n) => n.id === "dictation-recovery:rec-1");
  await React.act(() =>
    harness.notices.runNoticeAction(
      first.id,
      first.actions.find((a) => a.primary)
    )
  );
  assert.equal(harness.pastes.at(-1).text, "first words");
  assert.deepEqual(held(), [["dictation-recovery:rec-2", "second words"]]);
});

test("a refused ordinary batch paste keeps the exact words under its captured session", async (t) => {
  const harness = await mountHarness(t, { pasteResult: false });
  harness.session("batch-failed");
  await harness.complete({ text: "  keep these words\n", rawText: "  keep these words\n" });
  const [notice] = errorToasts(harness);
  assert.equal(notice?.id, "dictation-recovery:batch-failed");
  assert.equal(notice.words, "  keep these words\n");
  await harness.startRecording();
  assert.equal(errorToasts(harness)[0].words, "  keep these words\n");
  await React.act(() => harness.notices.runNoticeAction(notice.id, notice.actions[0]));
  assert.equal(
    errorToasts(harness)[0].words,
    "  keep these words\n",
    "Paste again refusal retains words"
  );
});

test("a pending Paste again cannot dismiss a newer revision of the same recovery card", async (t) => {
  const harness = await mountHarness(t);
  harness.session("revision-session");
  await harness.forceStop("timeout");
  await harness.complete();
  const [original] = errorToasts(harness);
  let finish;
  globalThis.__forceStopPasteGate = new Promise((resolve) => {
    finish = resolve;
  });
  const pending = harness.notices.runNoticeAction(original.id, original.actions[0]);
  harness.notices.notify({
    id: original.id,
    kind: "alert",
    title: "Newer explanation",
    words: original.words,
    actions: original.actions,
  });
  await React.act(async () => {
    finish();
    await pending;
  });
  assert.equal(errorToasts(harness)[0].title, "Newer explanation");
  assert.equal(errorToasts(harness)[0].words, "held too long");
});
