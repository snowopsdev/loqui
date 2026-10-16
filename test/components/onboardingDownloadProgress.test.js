const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions, TOAST_MOCK } = require("../helpers/harness/rendererMocks");
const { installTree } = require("../helpers/harness/fakeDomTree");

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

async function mountSpeechStep(t, { cancelResult = { success: true } } = {}) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const calls = { downloads: [], cancels: 0 };
  const pending = [];
  const listeners = {};
  const api = {
    getPlatform: () => "darwin",
    downloadParakeetModel: (model) => {
      calls.downloads.push(model);
      const request = deferred();
      pending.push(request);
      return request.promise;
    },
    cancelParakeetDownload: async () => {
      calls.cancels += 1;
      return cancelResult;
    },
    onParakeetDownloadProgress: (callback) => {
      listeners.progress = callback;
      return () => {};
    },
    personalInference: {
      codexStatus: async () => ({ available: false, account: null }),
      codexModels: async () => ({ data: [] }),
      codexRateLimits: async () => ({}),
      onTextEvent: () => () => {},
    },
  };
  installBrowserGlobals(t, {
    window: {
      electronAPI: new Proxy(api, {
        get(target, name) {
          if (name in target) return target[name];
          if (typeof name === "symbol" || name === "then") return undefined;
          return () => (/^on[A-Z]/.test(String(name)) ? () => {} : Promise.resolve());
        },
      }),
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    },
  });
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(
    t,
    rendererOptions("loqui-onboarding-download-", { "/ui/useToast": TOAST_MOCK })
  );
  const { default: OnboardingFlow } = await vite.ssrLoadModule("/components/OnboardingFlow.tsx");
  root = createRoot(tree.container);
  await React.act(async () => {
    root.render(React.createElement(OnboardingFlow, { onComplete() {}, initialStep: "speech" }));
  });
  const progress = async (model, percentage) =>
    React.act(async () =>
      listeners.progress(
        {},
        {
          type: "progress",
          model,
          percentage,
          downloaded_bytes: 265_000_000,
          total_bytes: 631_000_000,
        }
      )
    );
  // A terminal event from main: the hook stops tracking the model.
  const settle = async (model, data) =>
    React.act(async () => listeners.progress({}, { model, ...data }));
  const progressbar = () => tree.find((node) => node.attributes?.role === "progressbar");
  const downloadButton = () =>
    tree.find(
      (node) => node.tagName === "BUTTON" && node.textContent.includes("onboarding.download.start")
    );
  return { ...tree, calls, pending, progress, settle, progressbar, downloadButton };
}

test("the speech step shows the real download percentage", async (t) => {
  const flow = await mountSpeechStep(t);
  await flow.click("onboarding.download.start");
  assert.equal(flow.calls.downloads.length, 1);
  await flow.progress(flow.calls.downloads[0], 42);
  const bar = flow.progressbar();
  assert.ok(bar, "a progressbar replaces the pulsing placeholder");
  assert.equal(bar.attributes["aria-valuenow"], "42");
  const placeholder = flow.find((node) =>
    /\bw-2\/3 animate-pulse\b/.test(node.attributes?.class ?? "")
  );
  assert.equal(placeholder, null, "the fake two-thirds bar is gone");
});

test("a download in flight follows the user to later steps as a footer chip", async (t) => {
  const flow = await mountSpeechStep(t);
  await flow.click("onboarding.download.start");
  await flow.progress(flow.calls.downloads[0], 42);
  await flow.click("Continue");
  assert.match(flow.text(), /onboarding\.download\.chip\(percent=42\)/);
});

test("a confirmed cancel returns to idle and a late result cannot mark it interrupted", async (t) => {
  const flow = await mountSpeechStep(t);
  await flow.click("onboarding.download.start");
  await flow.progress(flow.calls.downloads[0], 42);
  await flow.click("common.cancel");
  assert.equal(flow.calls.cancels, 1);
  // Main reports the aborted request after the user already cancelled.
  await React.act(async () => flow.pending[0].resolve({ success: false, error: "cancelled" }));
  assert.match(flow.text(), /Download the selected model/);
  assert.doesNotMatch(flow.text(), /The download was interrupted/);
  assert.equal(flow.progressbar(), null);
});

test("a cancel main refuses keeps the download and its result", async (t) => {
  const flow = await mountSpeechStep(t, {
    cancelResult: { success: false, code: "INSTALLATION_IN_PROGRESS" },
  });
  await flow.click("onboarding.download.start");
  await flow.progress(flow.calls.downloads[0], 99);
  await flow.click("common.cancel");
  assert.equal(flow.calls.cancels, 1);
  assert.ok(flow.progressbar(), "the download is still on screen");
  await React.act(async () => flow.pending[0].resolve({ success: true, downloaded: true }));
  assert.match(flow.text(), /is ready/, "its success still marks the model ready");
});

test("Download stays disabled until the cancelled request settles", async (t) => {
  const flow = await mountSpeechStep(t);
  await flow.click("onboarding.download.start");
  const model = flow.calls.downloads[0];
  await flow.progress(model, 42);
  await flow.click("common.cancel");
  assert.equal(
    flow.downloadButton().attributes.disabled,
    "",
    "main has not settled the request yet"
  );
  await flow.settle(model, { type: "error", code: "DOWNLOAD_CANCELLED", error: "cancelled" });
  assert.equal(flow.downloadButton().attributes.disabled, undefined);
});

test("installation hides Cancel and follows the user as an installing chip", async (t) => {
  const flow = await mountSpeechStep(t);
  await flow.click("onboarding.download.start");
  await flow.settle(flow.calls.downloads[0], { type: "installing" });
  assert.equal(
    flow.find((node) => node.tagName === "BUTTON" && node.textContent === "common.cancel"),
    null
  );
  await flow.click("Continue");
  assert.match(flow.text(), /onboarding\.download\.chipInstalling/);
});

test("a confirmed cancel ignores a late successful result", async (t) => {
  const flow = await mountSpeechStep(t);
  await flow.click("onboarding.download.start");
  await flow.progress(flow.calls.downloads[0], 42);
  await flow.click("common.cancel");
  await React.act(async () => flow.pending[0].resolve({ success: true, downloaded: true }));
  assert.match(flow.text(), /Download the selected model/);
  assert.ok(flow.downloadButton(), "the model still offers Download after late success");
});
