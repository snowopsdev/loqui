const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

// Drives the real OnboardingFlow on its Cleanup step. The shared fake DOM has no
// events, so this keeps a tiny element tree and invokes the onClick handlers
// React stored on the nodes.
function installTree() {
  const document = globalThis.document;
  const make = (nodeType, props) => {
    const node = {
      nodeType,
      ownerDocument: document,
      style: {},
      childNodes: [],
      parentNode: null,
      appendChild(child) {
        node.insertBefore(child, null);
        return child;
      },
      insertBefore(child, before) {
        if (child.parentNode) child.parentNode.removeChild(child);
        const index = before ? node.childNodes.indexOf(before) : -1;
        child.parentNode = node;
        if (index < 0) node.childNodes.push(child);
        else node.childNodes.splice(index, 0, child);
        return child;
      },
      removeChild(child) {
        const index = node.childNodes.indexOf(child);
        if (index >= 0) node.childNodes.splice(index, 1);
        child.parentNode = null;
        return child;
      },
      get firstChild() {
        return node.childNodes[0] ?? null;
      },
      get nextSibling() {
        const siblings = node.parentNode?.childNodes ?? [];
        return siblings[siblings.indexOf(node) + 1] ?? null;
      },
      get textContent() {
        return node.nodeType === 3 ? node.data : node.childNodes.map((c) => c.textContent).join("");
      },
      set textContent(value) {
        node.childNodes = [];
        if (value) node.appendChild(make(3, { nodeName: "#text", data: String(value) }));
      },
      attributes: {},
      setAttribute(name, value) {
        node.attributes[name] = String(value);
      },
      removeAttribute(name) {
        delete node.attributes[name];
      },
      addEventListener() {},
      removeEventListener() {},
      focus() {},
      querySelector: () => null,
      ...props,
    };
    return node;
  };
  document.createElement = (tag) =>
    make(1, {
      nodeName: tag.toUpperCase(),
      tagName: tag.toUpperCase(),
      namespaceURI: "http://www.w3.org/1999/xhtml",
    });
  document.createElementNS = (namespaceURI, tag) =>
    make(1, { nodeName: tag, tagName: tag, namespaceURI });
  document.createTextNode = (data) => make(3, { nodeName: "#text", data });
  const container = make(1, { nodeName: "DIV", tagName: "DIV" });
  const walk = (node, visit) => {
    visit(node);
    for (const child of node.childNodes) walk(child, visit);
  };
  const click = async (label) => {
    let target = null;
    walk(container, (node) => {
      if (target || node.tagName !== "BUTTON") return;
      if (node.textContent.includes(label)) target = node;
    });
    assert.ok(target, `button containing "${label}" is rendered`);
    const key = Object.keys(target).find((name) => name.startsWith("__reactProps$"));
    await React.act(async () => {
      // The handler returns the pending check; awaiting it would deadlock the test.
      void target[key].onClick();
    });
  };
  const text = () => container.textContent;
  return { container, click, text };
}

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
  const vite = await createRendererServer(t, { cachePrefix: "loqui-onboarding-wiring-test-" });
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
    cleanupSettings: () => {
      const state = settings.useSettingsStore.getState();
      return { provider: state.cleanupProvider, model: state.cleanupModel };
    },
  };
}

const signedIn = { available: true, account: { type: "chatgpt" } };

test("OnboardingFlow: a Codex check finishing after No cleanup was chosen leaves cleanup off", async (t) => {
  const check = deferred();
  const flow = await mountCleanupStep(t, {
    codexStatus: () => check.promise,
    codexModels: async () => ({ data: [{ model: "fixture-model", isDefault: true }] }),
    codexRateLimits: async () => ({}),
    onTextEvent: () => () => {},
  });
  await flow.click("ChatGPT subscription");
  await flow.click("No cleanup");
  await React.act(async () => check.resolve(signedIn));
  assert.equal(flow.cleanupEnabled(), false);
});

test("OnboardingFlow: a Codex check finishing after setup closed leaves cleanup off", async (t) => {
  const check = deferred();
  const flow = await mountCleanupStep(t, {
    codexStatus: () => check.promise,
    codexModels: async () => ({ data: [{ model: "fixture-model", isDefault: true }] }),
    codexRateLimits: async () => ({}),
    onTextEvent: () => () => {},
  });
  await flow.click("ChatGPT subscription");
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
      if (index !== 2) return Promise.resolve(account);
      return new Promise((resolve) => (lateRead = resolve));
    },
    codexModels: async () => ({ data: [{ model: "fixture-model", isDefault: true }] }),
    codexRateLimits: async () => ({}),
    onTextEvent: (listener) => {
      events.listener = listener;
      return () => {};
    },
  });
  await flow.click("ChatGPT subscription");
  assert.equal(flow.cleanupEnabled(), false, "signed out: cleanup stays off");
  // Sign-in completes: the embedded connection starts a refresh that is still pending.
  account = signedIn;
  await React.act(async () =>
    events.listener({ type: "account", method: "account/login/completed" })
  );
  await flow.click("No cleanup");
  assert.ok(lateRead, "the sign-in refresh is still pending");
  await React.act(async () => lateRead(signedIn));
  assert.equal(flow.cleanupEnabled(), false);
});

test("OnboardingFlow: an OpenAI key starts cleanup on GPT-6.1 Sol", async (t) => {
  const flow = await mountCleanupStep(t, {
    credentialStatus: async () => ({ configured: true }),
  });
  await flow.click("Provider API key");
  await React.act(async () => {});
  assert.deepEqual(flow.cleanupSettings(), { provider: "openai", model: "gpt-6.1-sol" });
  assert.equal(flow.cleanupEnabled(), true);
});
