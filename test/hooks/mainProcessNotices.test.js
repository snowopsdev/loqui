const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

test("main notifications keep failed GPU Retry/Undo explanations until explicit success", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const listeners = {},
    removed = [];
  let success = false;
  const api = {};
  for (const name of [
    "onHotkeyFallbackUsed",
    "onHotkeyRegistrationFailed",
    "onCudaFallbackNotification",
    "onGpuFallbackNotification",
    "onCorrectionsLearned",
  ]) {
    api[name] = (fn) => {
      listeners[name] = fn;
      return () => removed.push(name);
    };
  }
  api.whisperGpuRetry = async () => ({ success });
  api.undoLearnedCorrections = async () => ({ success });
  installBrowserGlobals(t, { window: { electronAPI: api } });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-main-notices-" });
  const notices = await vite.ssrLoadModule("/components/ui/notices.ts");
  notices.__setNoticeClockForTests();
  t.after(() => notices.__setNoticeClockForTests());
  const { useMainProcessNotifications } = await vite.ssrLoadModule(
    "/hooks/useMainProcessNotifications.tsx"
  );
  const translate = (key) => key;
  function Harness() {
    useMainProcessNotifications({ t: translate });
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  listeners.onHotkeyFallbackUsed({ original: "A", fallback: "B" });
  assert.equal(notices.getNotices()[0].kind, "notice");
  listeners.onGpuFallbackNotification();
  const gpu = notices.getNotices().at(-1);
  await notices.runNoticeAction(gpu.id, gpu.actions[0]);
  assert.ok(notices.getNotices().some((n) => n.id === gpu.id));
  success = true;
  await notices.runNoticeAction(gpu.id, gpu.actions[0]);
  assert.equal(
    notices.getNotices().some((n) => n.id === gpu.id),
    false
  );
  listeners.onCorrectionsLearned(["Loqui"]);
  const correction = notices.getNotices().at(-1);
  assert.equal(correction.kind, "receipt");
  success = false;
  await notices.runNoticeAction(correction.id, correction.actions[0]);
  assert.ok(notices.getNotices().some((n) => n.id === correction.id));
  success = true;
  await notices.runNoticeAction(correction.id, correction.actions[0]);
  assert.equal(
    notices.getNotices().some((n) => n.id === correction.id),
    false
  );
  await React.act(async () => root.unmount());
  root = null;
  assert.equal(removed.length, 5);
});
