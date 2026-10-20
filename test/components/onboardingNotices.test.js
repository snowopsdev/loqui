const assert = require("node:assert/strict");
const test = require("node:test");

const t = (key, values) => (values ? `${key}(${JSON.stringify(values)})` : key);

test("notices are exactly the §5.3 notify input, whatever the merge order", async () => {
  const { voiceReadyNotice, voiceFailedNotice } =
    await import("../../src/components/onboarding/onboardingNotices.ts");
  assert.deepEqual(voiceReadyNotice(t), {
    kind: "receipt",
    title: "setupFlow.download.readyTitle",
  });
  let retried = 0;
  const failed = voiceFailedNotice(t, "Not enough disk space", () => retried++);
  assert.deepEqual(Object.keys(failed).sort(), ["actions", "body", "kind", "persistent", "title"]);
  assert.deepEqual(
    [failed.kind, failed.title, failed.body, failed.persistent],
    ["alert", "setupFlow.download.failedTitle", "Not enough disk space", true]
  );
  failed.actions[0].onClick();
  assert.equal(retried, 1);
});

test("only steps without their own download status announce", async () => {
  const { shouldAnnounceOffStep } =
    await import("../../src/components/onboarding/onboardingNotices.ts");
  assert.deepEqual(
    ["welcome", "speech", "try", "cleanup", "shortcuts", "finish"].map(shouldAnnounceOffStep),
    [true, false, false, true, true, true]
  );
});

test("the notifier returns the real shared notice owner without an adapter", async () => {
  const { useOnboardingNotifier } =
    await import("../../src/components/onboarding/useOnboardingNotifier.ts");
  const { notify } = await import("../../src/components/ui/notices.ts");
  assert.equal(useOnboardingNotifier(), notify);
});

test("the real notifier and NoticeStack keep a persistent failure until Retry is activated", async (t) => {
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const {
    createRendererServer,
    installBrowserGlobals,
    installHookDom,
  } = require("../lib/rendererTestHarness");
  const { rendererOptions } = require("../helpers/harness/rendererMocks");
  const { installTree } = require("../helpers/harness/fakeDomTree");
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, { window: { location: { search: "?panel=true" } } });
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(t, rendererOptions("loqui-notifier-real-toast-"));
  const { NoticeStack } = await vite.ssrLoadModule("/components/ui/NoticeStack.tsx");
  const { useOnboardingNotifier } = await vite.ssrLoadModule(
    "/components/onboarding/useOnboardingNotifier.ts"
  );
  const { voiceFailedNotice } = await vite.ssrLoadModule(
    "/components/onboarding/onboardingNotices.ts"
  );
  let notify,
    retried = 0;
  function Harness() {
    notify = useOnboardingNotifier();
    return null;
  }
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  root = createRoot(tree.container);
  await React.act(async () =>
    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Harness),
        React.createElement(NoticeStack, { placement: "panel" })
      )
    )
  );
  await React.act(async () =>
    notify(
      voiceFailedNotice(
        (key) => key,
        "fixture disk full",
        () => retried++
      )
    )
  );
  assert.match(tree.text(), /fixture disk full/);
  assert.ok(tree.find((node) => node.attributes?.role === "alert"));
  await React.act(async () => t.mock.timers.tick(60000));
  assert.match(
    tree.text(),
    /fixture disk full/,
    "duration 0 stays visible beyond ordinary toast lifetime"
  );
  await tree.click("setupFlow.download.retry");
  assert.equal(retried, 1);
  await React.act(async () => t.mock.timers.tick(200));
  assert.doesNotMatch(tree.text(), /fixture disk full/);
  await React.act(async () => root.unmount());
  root = null;
  t.mock.timers.reset();
});
