const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

const { installTree } = require("../helpers/harness/fakeDomTree");
const { TOAST_MOCK } = require("../helpers/harness/rendererMocks");

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

async function mountCleanupStep(t, personalInference) {
  // Registered first so it runs before the globals it needs are restored.
  let root = null;
  const unmount = async () => {
    if (!root) return;
    const current = root;
    root = null;
    await React.act(async () => current.unmount());
  };
  t.after(unmount);
  const { storage } = installBrowserGlobals(t, {
    window: {
      electronAPI: new Proxy(
        { personalInference, getPlatform: () => "linux" },
        {
          get(target, name) {
            if (name in target) return target[name];
            if (typeof name === "symbol" || name === "then") return undefined;
            return () => (/^on[A-Z]/.test(String(name)) ? () => {} : Promise.resolve());
          },
        }
      ),
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    },
  });
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-onboarding-wiring-test-",
    mockModules: { "/ui/useToast": TOAST_MOCK },
  });
  const { default: OnboardingFlow } = await vite.ssrLoadModule("/components/OnboardingFlow.tsx");
  const settings = await vite.ssrLoadModule("/stores/settingsStore.ts");
  root = createRoot(tree.container);
  await React.act(async () => {
    root.render(React.createElement(OnboardingFlow, { onComplete() {}, initialStep: "cleanup" }));
  });
  return {
    ...tree,
    unmount,
    storage,
    cleanupEnabled: () => settings.useSettingsStore.getState().useCleanupModel,
  };
}

const signedIn = { connected: true, data: [{ model: "fixture-model", isDefault: true }] };

test("OnboardingFlow: a Codex check finishing after No cleanup was chosen leaves cleanup off", async (t) => {
  const check = deferred();
  const flow = await mountCleanupStep(t, {
    codexModelCatalog: () => check.promise,
    codexModels: async () => ({ data: [{ model: "fixture-model", isDefault: true }] }),
    codexRateLimits: async () => ({}),
    onTextEvent: () => () => {},
  });
  await flow.click("ChatGPT");
  await flow.click("None");
  await React.act(async () => check.resolve(signedIn));
  assert.equal(flow.cleanupEnabled(), false);
});

test("OnboardingFlow: a Codex check finishing after setup closed leaves cleanup off", async (t) => {
  const check = deferred();
  const flow = await mountCleanupStep(t, {
    codexModelCatalog: () => check.promise,
    codexModels: async () => ({ data: [{ model: "fixture-model", isDefault: true }] }),
    codexRateLimits: async () => ({}),
    onTextEvent: () => () => {},
  });
  await flow.click("ChatGPT");
  await flow.unmount();
  await React.act(async () => check.resolve(signedIn));
  assert.equal(flow.cleanupEnabled(), false);
});

test("OnboardingFlow: a late sign-in read cannot re-enable cleanup after No cleanup", async (t) => {
  let calls = 0;
  let lateRead = null;
  const events = { listener: null };
  let account = { available: true, account: null };
  const flow = await mountCleanupStep(t, {
    codexStatus: () => {
      const index = calls++;
      // Only the read started by the sign-in event stays pending.
      if (index !== 0) return Promise.resolve(account);
      return new Promise((resolve) => (lateRead = resolve));
    },
    codexModels: async () => ({ data: [{ model: "fixture-model", isDefault: true }] }),
    codexRateLimits: async () => ({}),
    onTextEvent: (listener) => {
      events.listener = listener;
      return () => {};
    },
  });
  await flow.click("ChatGPT");
  assert.equal(flow.cleanupEnabled(), false, "signed out: cleanup stays off");
  // Sign-in completes: the embedded connection starts a refresh that is still pending.
  account = signedIn;
  await React.act(async () =>
    events.listener({ type: "account", method: "account/login/completed" })
  );
  await flow.click("None");
  assert.ok(lateRead, "the sign-in refresh is still pending");
  await React.act(async () => lateRead({ available: true, account: { type: "chatgpt" } }));
  assert.equal(flow.cleanupEnabled(), false);
});

test("OnboardingFlow: leaving Cleanup supersedes its pending connection check", async (t) => {
  const check = deferred();
  const flow = await mountCleanupStep(t, {
    codexModelCatalog: () => check.promise,
    codexModels: async () => ({ data: [{ model: "fixture-model", isDefault: true }] }),
    onTextEvent: () => () => {},
  });
  await flow.click("ChatGPT");
  await flow.click("Skip this step");
  await React.act(async () => check.resolve(signedIn));
  assert.equal(flow.cleanupEnabled(), false, "a departed check cannot silently enable cleanup");
});

test("OnboardingFlow: Finish later supersedes a pending cleanup check even before parent unmount", async (t) => {
  const check = deferred();
  const flow = await mountCleanupStep(t, {
    codexModelCatalog: () => check.promise,
    codexModels: async () => ({ data: [{ model: "fixture-model", isDefault: true }] }),
    onTextEvent: () => () => {},
  });
  await flow.click("ChatGPT");
  await flow.click("Finish later");
  await React.act(async () => check.resolve(signedIn));
  assert.equal(flow.cleanupEnabled(), false);
});
