const assert = require("node:assert/strict");
const test = require("node:test");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// R1-I4, App level. This renders the real App.jsx with the real stage
// derivation, ownership policy, settings store and VoicePill. Rendering
// evaluates every hook's dependency array, so a value read above its `const`
// throws a ReferenceError here; helper tests cannot see that. Three modules
// are stand-ins:
// - useAudioRecording: the pipeline state each test sets;
// - usePillAutoHide: records what App passes it. SSR runs no effects, and
//   test/hooks/pillAutoHide.test.js mounts the real hook;
// - lib/routes' useResolvedRoute: pinned to on-device routes, so the locality
//   ring does not depend on the test machine's settings.
const MOCKS = {
  "/index.css": "export default {};",
  "/hooks/useAudioRecording": "export const useAudioRecording = () => globalThis.__appPillAudio;",
  "/hooks/usePillAutoHide":
    "export const usePillAutoHide = (input) => { globalThis.__appPillAutoHide.push(input); };",
  "/lib/routes": `
    export * from "/lib/routes.ts";
    export const useResolvedRoute = (id) => ({
      id, kind: "speech", locality: "device", provider: null, model: null,
      state: { status: "ready" }, sends: null, settingsPath: id,
    });
  `,
};

// Every field App reads from useAudioRecording, at its idle value. A task
// that makes App read a new field adds its idle value here.
const pipeline = (state) => ({
  isRecording: false,
  isProcessing: false,
  isAssistantVoice: false,
  isPreparing: false,
  isStopping: false,
  micCaptureStatus: "ok",
  toggleListening() {},
  cancelRecording() {},
  cancelProcessing() {},
  getAudioLevel: () => 0,
  cancelled: null,
  cancelHold: { generation: 1, durationMs: 5000 },
  undoCancel: async () => true,
  pauseUndo() {},
  resumeUndo() {},
  processingStage: null,
  outcome: null,
  activeSession: null,
  ...state,
});

async function renderApp(t, state = {}) {
  // "Auto-hide when idle" is on; the real settings store reads it at load.
  installBrowserGlobals(t, { initialStorage: { floatingIconAutoHide: "true" } });
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-app-pill-",
    mockModules: MOCKS,
  });
  globalThis.__appPillAudio = pipeline(state);
  globalThis.__appPillAutoHide = [];
  t.after(() => {
    delete globalThis.__appPillAudio;
    delete globalThis.__appPillAutoHide;
  });
  const { default: App } = await vite.ssrLoadModule("/App.jsx");
  const html = renderToStaticMarkup(createElement(App));
  return { html, autoHide: globalThis.__appPillAutoHide.at(-1) };
}

const cancelled = {
  sessionId: "s1",
  undoUntil: Date.now() + 5000,
  paused: false,
  remainingMs: 5000,
  remoteAlreadySent: null,
};

test("App renders the Undo capsule with auto-hide on, and auto-hide sees the hold (R1-I4)", async (t) => {
  const { html, autoHide } = await renderApp(t, { cancelled });
  assert.match(html, /data-pill-state="cancelled"[^>]*role="button"/);
  assert.match(html, /class="pill-countdown"/);
  assert.equal(autoHide.floatingIconAutoHide, true);
  assert.deepEqual(autoHide.ownership, {
    holdsWindow: true,
    interactive: true,
    outranksFooter: true,
  });
});

test("an idle App leaves auto-hide free to hide the window", async (t) => {
  const { autoHide } = await renderApp(t);
  assert.equal(autoHide.floatingIconAutoHide, true);
  assert.equal(autoHide.isRecording, false);
  assert.equal(autoHide.ownership.holdsWindow, false);
});

test("live work reaches auto-hide as live work, not as a held stage", async (t) => {
  const { html, autoHide } = await renderApp(t, {
    isProcessing: true,
    processingStage: "transcribing",
  });
  assert.match(html, /data-pill-state="transcribing"/);
  assert.equal(autoHide.isVisuallyProcessing, true);
  assert.equal(autoHide.ownership.holdsWindow, false);
});

test("App passes the frozen active session to locality while live Settings say on-device", async (t) => {
  const frozenRoute = (id, locality, provider) =>
    Object.freeze({
      id,
      kind: id === "dictationStt" ? "speech" : "text",
      locality,
      provider,
      providerId: locality === "remote" ? "anthropic" : null,
      host: null,
      model: null,
      state: Object.freeze({ status: "ready" }),
      sends: null,
      settingsPath: id,
    });
  const activeSession = Object.freeze({
    settings: Object.freeze({ useCleanupModel: true, voiceAgentScreenContext: false }),
    intents: Object.freeze({ voiceAgentRequested: true, translationRequested: false }),
    routes: Object.freeze({
      dictationStt: frozenRoute("dictationStt", "device", null),
      dictationCleanup: frozenRoute("dictationCleanup", "device", null),
      voiceAssistant: frozenRoute("voiceAssistant", "remote", "Anthropic"),
    }),
  });
  const { html } = await renderApp(t, {
    isProcessing: true,
    processingStage: "cleaning",
    activeSession,
  });
  assert.match(html, /data-locality="remote"/);
});

for (const [name, target, alsoSentTo] of [
  ["network hostname", "host:speech.department.company.example", []],
  ["three receivers", "openai", ["anthropic", "gemini"]],
]) {
  test(`actual App exposes complete ${name} in the focusable caption beside usable Undo`, async (t) => {
    const { html } = await renderApp(t, {
      cancelled: {
        ...cancelled,
        remoteAlreadySent: {
          target,
          alsoSentTo,
          payload: "audio",
          evidence: "dispatched",
        },
      },
    });
    assert.match(html, /class="pill-caption" tabindex="0"/);
    assert.match(html, /data-pill-state="cancelled"[^>]*role="button"/);
    if (alsoSentTo.length) {
      for (const receiver of ["OpenAI", "Anthropic", "Google Gemini"])
        assert.ok(html.includes(receiver));
    } else assert.ok(html.includes("speech.department.company.example"));
  });
}
