const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");
const MODEL = "parakeet-unified-en-0.6b";
const OTHER = "orukeet-v0.1.0";

function clock() {
  let now = 0;
  const queue = new Set();
  return {
    setTimeout(callback, ms) {
      const item = { callback, at: now + ms };
      queue.add(item);
      return item;
    },
    clearTimeout(item) {
      queue.delete(item);
    },
    now: () => now,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const item = [...queue].sort((a, b) => a.at - b.at)[0];
        if (!item || item.at > end) break;
        queue.delete(item);
        now = item.at;
        item.callback();
      }
      now = end;
    },
  };
}

async function server(t) {
  return createRendererServer(t, rendererOptions("loqui-onboarding-bridge-"));
}

test("installed browser preview exposes the scenario API without inventing desktop authority", async (t) => {
  let installedBridge;
  t.after(() => installedBridge?.reset());
  const url = new URL(
    "http://127.0.0.1:5186/?preview=onboarding&step=speech&scenario=multilingual"
  );
  const urls = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: undefined,
      location: url,
      history: {
        replaceState(_state, _title, value) {
          urls.push(String(value));
        },
      },
    },
  });
  const vite = await server(t);
  const { installBrowserPreview } = await vite.ssrLoadModule("/preview/browserPreview.ts");
  installBrowserPreview();
  installedBridge = globalThis.window.loquiPreviewBridge;
  const api = globalThis.window.electronAPI;
  assert.deepEqual((await api.getSystemProfile()).locales, ["es-ES", "en-US"]);
  assert.equal(typeof globalThis.window.loquiPreviewBridge.simulateHotkey, "function");
  assert.equal(typeof globalThis.window.loquiPreviewBridge.reset, "function");
  assert.equal(api.publishOnboardingDemoEvent, undefined);
  assert.equal(api.onRecordingSessionEvent, undefined);
  assert.equal(api.personalInference.textGenerate instanceof Function, true);
  await assert.rejects(api.personalInference.textGenerate({}), /desktop app/);
  const events = [];
  api.onOnboardingDemoEvent((event) => events.push(event));
  assert.equal(await api.beginOnboardingDemo({ id: "installed", kind: "dictation" }), true);
  const binding = await api.getDictationBinding();
  assert.ok(binding, "fake owner acknowledges the current binding");
  globalThis.window.loquiPreviewBridge.simulateHotkey("down");
  assert.deepEqual(events, [
    {
      demoId: "installed",
      takeId: "1",
      kind: "dictation",
      origin: "hotkey",
      binding,
      status: "preparing",
    },
    {
      demoId: "installed",
      takeId: "1",
      kind: "dictation",
      origin: "hotkey",
      binding,
      status: "listening",
    },
  ]);
  globalThis.window.loquiPreviewBridge.reset();
  assert.equal(await api.toggleOnboardingDemo("installed"), false);
  assert.match(urls[0], /panel=true/);
  installBrowserPreview();
  assert.equal(
    globalThis.window.electronAPI,
    api,
    "installation does not replace an existing desktop/preview API"
  );
});

async function mount(t, scenario) {
  let root;
  let bridge;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    bridge?.reset();
  });
  const events = new EventTarget();
  installBrowserGlobals(t, {
    window: {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    },
  });
  const container = installHookDom(t);
  const vite = await server(t);
  const { createOnboardingScenarioBridge } = await vite.ssrLoadModule(
    "/preview/onboardingScenarioBridge.ts"
  );
  const { useVoiceDownload } = await vite.ssrLoadModule(
    "/components/onboarding/useVoiceDownload.ts"
  );
  const time = clock();
  const config = { step: "speech", scenario, platform: "linux" };
  bridge = createOnboardingScenarioBridge(() => config, time);
  globalThis.window.electronAPI = bridge.api;
  let current;
  function Harness({ id }) {
    current = useVoiceDownload(id);
    return null;
  }
  root = createRoot(container);
  return {
    api: bridge.api,
    time,
    bridge,
    current: () => current,
    render: (id) => React.act(async () => root.render(React.createElement(Harness, { id }))),
    advance: (ms) => React.act(async () => time.advance(ms)),
  };
}

test("real download hooks rehydrate, cancel, and resume with the same fake preload", async (t) => {
  const h = await mount(t, "downloading");
  await h.render(MODEL);
  assert.equal(h.current().state.status, "downloading");
  assert.equal(h.current().state.percent, 35);
  await React.act(async () => h.current().cancel());
  assert.equal(h.current().state.status, "cancelled");
  assert.deepEqual(await h.api.modelGetActiveDownloads(), []);
  await React.act(async () => h.current().start());
  await h.advance(400);
  assert.equal(h.current().state.percent, 7);
  await h.advance(10000);
  assert.equal(h.current().state.status, "ready");
});

test("real hooks retain off-selection network evidence and retry from the retained bytes", async (t) => {
  const h = await mount(t, "download-interrupted");
  await h.render(MODEL);
  await React.act(async () => h.current().start());
  await h.render(OTHER);
  await h.advance(10000);
  await h.render(MODEL);
  assert.equal(h.current().state.status, "error");
  assert.equal(h.current().state.progressKept, true);
  await React.act(async () => h.current().start());
  await h.advance(400);
  assert.equal(h.current().state.percent, 42);
  await h.advance(10000);
  assert.equal(h.current().state.status, "ready");
  await h.render(OTHER);
  assert.equal(h.current().state.status, "idle");
});

test("real Parakeet singleton refuses both concurrent model IDs without replacing its owner", async (t) => {
  const electronPath = require.resolve("electron");
  const originalElectron = require.cache[electronPath];
  require.cache[electronPath] = {
    exports: {
      app: { isReady: () => false, isPackaged: false },
      net: {
        request() {
          throw new Error("Busy admission must not request network");
        },
      },
    },
  };
  t.after(() => {
    if (originalElectron) require.cache[electronPath] = originalElectron;
    else delete require.cache[electronPath];
  });
  const ParakeetManager = require("../../src/helpers/parakeet");
  const manager = new ParakeetManager();
  manager.getModelPath = () => "/fixture/model";
  manager.getModelsDir = () => "/fixture";
  manager.serverManager.isModelDownloaded = () => false;
  const owner = { model: MODEL, abort() {} };
  manager.currentDownloadProcess = owner;
  for (const id of [MODEL, OTHER]) {
    await assert.rejects(manager.downloadParakeetModel(id), {
      code: "DOWNLOAD_IN_PROGRESS",
      message: "A model is already being downloaded",
    });
    assert.equal(manager.currentDownloadProcess, owner);
  }
});

test("two real download-hook callers can race admission without replacing the transfer", async (t) => {
  let root;
  let bridge;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    bridge?.reset();
  });
  const events = new EventTarget();
  installBrowserGlobals(t, {
    window: {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    },
  });
  const container = installHookDom(t);
  const vite = await server(t);
  const { createOnboardingScenarioBridge } = await vite.ssrLoadModule(
    "/preview/onboardingScenarioBridge.ts"
  );
  const { useModelDownload } = await vite.ssrLoadModule("/hooks/useModelDownload.ts");
  const time = clock();
  const config = { step: "speech", scenario: "fresh", platform: "linux" };
  bridge = createOnboardingScenarioBridge(() => config, time);
  const requests = [];
  const results = [];
  globalThis.window.electronAPI = {
    ...bridge.api,
    downloadParakeetModel: (id) => {
      requests.push(id);
      return bridge.api.downloadParakeetModel(id).then((result) => {
        results.push(result);
        return result;
      });
    },
  };
  let first, second;
  function Harness() {
    first = useModelDownload({ modelType: "parakeet" });
    second = useModelDownload({ modelType: "parakeet" });
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  let owner;
  await React.act(async () => {
    owner = first.downloadModel(MODEL);
    await second.downloadModel(OTHER);
  });
  assert.deepEqual(
    requests,
    [MODEL, OTHER],
    "both real hooks called preload before either UI lock rendered"
  );
  assert.equal(results[0].code, "DOWNLOAD_IN_PROGRESS");
  assert.equal((await bridge.api.modelGetActiveDownloads())[0].modelId, MODEL);
  await React.act(async () => {
    time.advance(10000);
    await owner;
  });
  assert.equal(results[1].success, true);
  assert.deepEqual(await bridge.api.modelGetActiveDownloads(), []);
  assert.equal((await bridge.api.checkParakeetModelStatus(OTHER)).downloaded, false);
});
