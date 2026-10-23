const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { loadAudioManager } = require("./harness/audioManager");

// Touch-up 4, N1: a sealed auto-paste must leave one card the user can read,
// the sealed one, still holding the words. This drives the real hook, the
// real notice store, real English copy and the real AudioManager.safePaste;
// only the manager's recording machinery and main's paste-text are fakes.
const FAKE_AUDIO_MANAGER_SOURCE = `
export default class FakeAudioManager {
  _ownedAudioSnapshot() { return { blob: null, private: false, sessionId: null }; }
  constructor() {
    this.voiceAgentRequested = false;
    this.translationRequested = false;
    this.sttConfig = { success: true };
    globalThis.__sealedPasteCardManager = this;
  }
  setCallbacks(callbacks) {
    this.callbacks = callbacks;
    this.onError = callbacks.onError;
  }
  getState() { return {}; }
  shouldUseStreaming() { return false; }
  safePaste(...args) { return globalThis.__sealedPasteCardRealSafePaste.apply(this, args); }
  async saveTranscription() { return true; }
  cleanup() {}
}
`;

const SEALED_TITLE = "Sealed mode stopped automatic paste";
const SEALED_COPIED =
  "Sealed mode is on, so Loqui couldn't paste automatically. Your text is on the clipboard, so you can paste it yourself.";
const SEALED_NOT_COPIED = "Sealed mode is on, so Loqui couldn't paste automatically.";
const GENERIC_TITLE = "Couldn’t paste your words";

async function mountHook(t) {
  // After-hooks run in registration order: unmount before any globals go.
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__sealedPasteCardManager;
    delete globalThis.__sealedPasteCardRealSafePaste;
    delete globalThis.__sealedPasteCardPasteText;
  });
  const { AudioManager } = await loadAudioManager(t, {
    cachePrefix: "loqui-sealed-paste-card-manager-",
    settingsKey: "__sealedPasteCardManagerSettings",
  });
  globalThis.__sealedPasteCardRealSafePaste = AudioManager.prototype.safePaste;

  const pasteCalls = [];
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
        completeDictationPreview: async () => {},
        hideDictationPreview: async () => {},
        dictationLifecycleStateChanged: () => {},
        async pasteText(text, options) {
          pasteCalls.push([text, options]);
          return globalThis.__sealedPasteCardPasteText(text, options);
        },
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-sealed-paste-card-hook-",
    mockModules: {
      "/helpers/audioManager": FAKE_AUDIO_MANAGER_SOURCE,
      "/utils/logger": "export default { debug() {}, info() {}, warn() {}, error() {} };",
    },
  });
  await vite.ssrLoadModule("/i18n.ts");
  const { useAudioRecording } = await vite.ssrLoadModule("/hooks/useAudioRecording.js");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const notices = await vite.ssrLoadModule("/components/ui/notices.ts");
  useSettingsStore.setState({
    autoPasteEnabled: true,
    keepTranscriptionInClipboard: false,
    pauseMediaOnDictation: false,
    snippets: [],
  });
  notices.__setNoticeClockForTests();
  t.after(() => notices.__setNoticeClockForTests());

  // Every title that reached the store, in order: what the user could have seen.
  const seenTitles = [];
  const unsubscribe = notices.subscribeNotices(() => {
    const newest = notices.getNotices().at(-1);
    if (newest && seenTitles.at(-1) !== newest.title) seenTitles.push(newest.title);
  });
  t.after(unsubscribe);

  function Harness() {
    useAudioRecording({ onDemoEvent: () => {} });
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));

  return {
    notices,
    pasteCalls,
    seenTitles,
    // Primitives only: never a notice object or a DOM node into an assertion.
    snapshot: () =>
      notices.getNotices().map((n) => ({
        title: n.title,
        body: n.body ?? null,
        words: n.words ?? null,
        actions: (n.actions ?? []).map((a) => a.label),
      })),
    reset: () => {
      notices.__setNoticeClockForTests();
      seenTitles.length = 0;
      pasteCalls.length = 0;
    },
    complete: async (text) => {
      const manager = globalThis.__sealedPasteCardManager;
      await React.act(async () =>
        manager.callbacks.onTranscriptionComplete({
          success: true,
          text,
          rawText: text,
          source: "local",
        })
      );
    },
  };
}

test("a sealed auto-paste leaves one card: the sealed title and copy, holding the words", async (t) => {
  const hook = await mountHook(t);

  globalThis.__sealedPasteCardPasteText = async () => ({
    success: false,
    pasted: false,
    code: "SEALED_MODE",
    phase: "refused",
    copiedToClipboard: true,
  });
  await hook.complete("sealed copied words");
  assert.equal(hook.pasteCalls.length, 1);
  assert.deepEqual(hook.snapshot(), [
    {
      title: SEALED_TITLE,
      body: SEALED_COPIED,
      words: "sealed copied words",
      actions: ["Paste again"],
    },
  ]);
  assert.deepEqual(hook.seenTitles, [SEALED_TITLE], "no other card was ever shown");

  // Main did not report the copy: the card makes no clipboard claim.
  hook.reset();
  globalThis.__sealedPasteCardPasteText = async () => ({
    success: false,
    pasted: false,
    code: "SEALED_MODE",
    phase: "refused",
    copiedToClipboard: false,
  });
  await hook.complete("sealed uncopied words");
  assert.deepEqual(hook.snapshot(), [
    {
      title: SEALED_TITLE,
      body: SEALED_NOT_COPIED,
      words: "sealed uncopied words",
      actions: ["Paste again"],
    },
  ]);
  assert.deepEqual(hook.seenTitles, [SEALED_TITLE]);

  // A rejection carrying main's marker: sealed, and no clipboard claim.
  hook.reset();
  globalThis.__sealedPasteCardPasteText = async () => {
    throw new Error(
      "Error invoking remote method 'paste-text': SealedModeError: [SEALED_MODE] Sealed mode blocked nativeLaunch to native-osascript before any socket opened; nothing was sent."
    );
  };
  await hook.complete("sealed rejected words");
  assert.deepEqual(hook.snapshot(), [
    {
      title: SEALED_TITLE,
      body: SEALED_NOT_COPIED,
      words: "sealed rejected words",
      actions: ["Paste again"],
    },
  ]);
});

test("Paste again on the sealed card, still sealed, says why and keeps the words", async (t) => {
  const hook = await mountHook(t);
  globalThis.__sealedPasteCardPasteText = async () => ({
    success: false,
    pasted: false,
    code: "SEALED_MODE",
    phase: "refused",
    copiedToClipboard: true,
  });
  await hook.complete("held words");
  const card = hook.notices.getNotices().find((n) => n.words === "held words");
  const pasteAgain = card.actions.find((a) => a.label === "Paste again");
  await React.act(async () => hook.notices.runNoticeAction(card.id, pasteAgain));
  assert.equal(hook.pasteCalls.length, 2);
  assert.deepEqual(
    hook.snapshot().map(({ title, body, words }) => ({ title, body, words })),
    [
      { title: SEALED_TITLE, body: SEALED_COPIED, words: "held words" },
      { title: SEALED_TITLE, body: SEALED_COPIED, words: null },
    ]
  );
});

test("a non-sealed paste failure keeps the generic words card", async (t) => {
  const hook = await mountHook(t);

  // Main resolved without pasting.
  globalThis.__sealedPasteCardPasteText = async () => ({ success: true, pasted: false });
  await hook.complete("unpasted words");
  assert.deepEqual(hook.snapshot(), [
    { title: GENERIC_TITLE, body: null, words: "unpasted words", actions: ["Paste again"] },
  ]);
  assert.deepEqual(hook.seenTitles, [GENERIC_TITLE]);

  // An ordinary rejection: as before, the words card replaces the Paste Error card.
  hook.reset();
  globalThis.__sealedPasteCardPasteText = async () => {
    throw new Error("accessibility denied");
  };
  await hook.complete("rejected words");
  assert.deepEqual(hook.snapshot(), [
    { title: GENERIC_TITLE, body: null, words: "rejected words", actions: ["Paste again"] },
  ]);
  assert.deepEqual(hook.seenTitles, ["Paste Error", GENERIC_TITLE]);
});
