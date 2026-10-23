const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

// Mounts the real usePillAutoHide with "Auto-hide when idle" on. `stage` goes
// through the real resolvePillOwnership (Task 10), so a policy change reaches
// this test.
async function mountAutoHide(t, initial = {}) {
  // Registered before the browser globals so React still has `window` when the
  // harness tears the root down (the order dictationErrorAutoHide.test.js uses).
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });

  const calls = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        hideWindow: async () => calls.push("hide"),
        showDictationPanel: async () => calls.push("show"),
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-pill-auto-hide-" });
  const { usePillAutoHide, PILL_AUTO_HIDE_DELAY_MS } = await vite.ssrLoadModule(
    "/hooks/usePillAutoHide.js"
  );
  const { resolvePillOwnership } = await vite.ssrLoadModule("/helpers/voicePillPresentation.js");

  let props = {
    floatingIconAutoHide: true,
    isRecording: false,
    isVisuallyProcessing: false,
    noticesOnScreen: false,
    wordsCardHandoffActive: false,
    assistantMounted: false,
    liveTranscriptMounted: false,
    stage: null,
    ...initial,
  };
  function Harness() {
    const { stage, ...input } = props;
    usePillAutoHide({ ...input, ownership: resolvePillOwnership(stage) });
    return null;
  }

  root = createRoot(container);
  const render = async (next = {}) => {
    props = { ...props, ...next };
    await React.act(async () => {
      root.render(React.createElement(Harness));
      await Promise.resolve();
    });
  };
  // Real timers: wait just past the hide delay.
  const wait = async () => {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, PILL_AUTO_HIDE_DELAY_MS + 100));
    });
  };

  await render();
  return { calls, render, wait };
}

test("an idle pill still auto-hides", async (t) => {
  const { calls, wait } = await mountAutoHide(t);
  await wait();
  assert.deepEqual(calls, ["hide"]);
});

test("Esc during a recording keeps the window for the whole undo window (R1-I4)", async (t) => {
  const { calls, render, wait } = await mountAutoHide(t, { isRecording: true });
  // The cancel lands: recording stops and the cancelled stage starts in one render.
  await render({ isRecording: false, stage: "cancelled" });
  await wait();
  assert.deepEqual(calls, ["show"], "the stage brings the window back and nothing hides it");
  // The undo window closes; the idle pill hides as before.
  await render({ stage: null });
  await wait();
  assert.deepEqual(calls, ["show", "hide"]);
});

for (const stage of ["pasted", "failed", "sealedPaused", "meeting"]) {
  test(`the ${stage} stage holds the window`, async (t) => {
    const { calls, wait } = await mountAutoHide(t, { stage });
    await wait();
    assert.deepEqual(calls, ["show"]);
  });
}

test("a stage shows the window once, not on every render", async (t) => {
  // show-dictation-panel repositions to the active display, so repeats would move the pill.
  const { calls, render, wait } = await mountAutoHide(t, { stage: "meeting" });
  await render({ isVisuallyProcessing: true });
  await render({ isVisuallyProcessing: false });
  await wait();
  assert.deepEqual(calls, ["show"]);
});

test("turning auto-hide off still brings the pill back", async (t) => {
  const { calls, render } = await mountAutoHide(t, { isRecording: true });
  await render({ floatingIconAutoHide: false });
  assert.deepEqual(calls, ["show"]);
});
