const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const test = require("node:test");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { getParakeetCapability } = require("../../src/helpers/parakeetCapability");

// Execute the real main manager's metadata methods with file/binary fixtures.
// Never instantiate its native server or read a real model directory.
function mainMetadata(systemVersion, binary = true) {
  const file = path.resolve(__dirname, "../../src/helpers/parakeet.js");
  const realRequire = createRequire(file);
  const stubs = {
    "./parakeetServer": class {},
    "./debugLogger": {},
    "./downloadUtils": {},
    "./modelDirUtils": {},
    "./parakeetCapability": {
      getParakeetCapability: () => getParakeetCapability({ platform: "darwin", systemVersion }),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(file, "utf8"),
    {
      module,
      exports: module.exports,
      require: (id) => (Object.hasOwn(stubs, id) ? stubs[id] : realRequire(id)),
    },
    { filename: file }
  );
  const proto = module.exports.prototype;
  const manager = {
    serverManager: {
      getBinaryPath: () => (binary ? "/fixture/sherpa" : null),
      isModelDownloaded: () => true,
    },
    getModelPath: () => "/fixture/model",
    _getModelWeightsSize: () => 600000000,
    getModelsDir: () => "/fixture/models",
  };
  manager.checkModelStatus = proto.checkModelStatus.bind(manager);
  return {
    listParakeetModels: proto.listParakeetModels.bind(manager),
    checkParakeetInstallation: proto.checkInstallation.bind(manager),
  };
}

async function fixture(t, api) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-cartridge-capability-" });
  const store = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  const routes = await vite.ssrLoadModule("/lib/routes.ts");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { resolveRoute } = await import("../../src/lib/routeGraph.ts");
  useSettingsStore.setState({
    transcriptionMode: "local",
    useLocalWhisper: true,
    localTranscriptionProvider: "nvidia",
    parakeetModel: "parakeet-tdt-0.6b-v3",
    meetingTranscriptionMode: "local",
    meetingLocalTranscriptionProvider: "cohere",
    meetingCohereModel: "cohere-transcribe-03-2026",
    uploadTranscriptionMode: "local",
    uploadLocalTranscriptionProvider: "nvidia",
    uploadParakeetModel: "parakeet-tdt-0.6b-v3",
  });
  await store.loadRouteFacts(api);
  const facts = () => store.useRouteFactsStore.getState().facts;
  const snapshot = () =>
    routes.buildRouteSnapshot(
      useSettingsStore.getState(),
      facts(),
      routes.currentRouteCopy(),
      false
    );
  return {
    store,
    facts,
    snapshot,
    resolve: (id) => resolveRoute(snapshot(), id),
    settings: useSettingsStore.getState,
  };
}

test("change-driving: installed sherpa files on unsupported macOS stay unsupported through actual main metadata, route facts, snapshot and pure resolver", async (t) => {
  const api = mainMetadata("12.7.6");
  const inventory = await api.listParakeetModels();
  assert.ok(inventory.models.some((m) => m.downloaded));
  assert.equal((await api.checkParakeetInstallation()).supported, false);
  const h = await fixture(t, api);
  for (const id of ["dictationStt", "noteRecordingStt", "uploadStt"]) {
    assert.deepEqual(h.resolve(id).state, { status: "unreachable", detail: "unsupported" });
    assert.equal(h.resolve(id).locality, "device");
  }
  assert.equal(h.settings().localTranscriptionProvider, "nvidia");
  assert.equal(h.settings().parakeetModel, "parakeet-tdt-0.6b-v3");
  assert.equal(h.settings().meetingLocalTranscriptionProvider, "cohere");
});

test("change-driving: installed sherpa files wait for missing, malformed or failed capability metadata", async (t) => {
  const api = mainMetadata("15.5");
  delete api.checkParakeetInstallation;
  const h = await fixture(t, api);
  assert.equal(h.resolve("dictationStt").state.status, "unknown");
  for (const check of [
    async () => ({}),
    async () => {
      throw new Error("unavailable");
    },
  ]) {
    await h.store.loadRouteFacts({ ...api, checkParakeetInstallation: check });
    assert.equal(h.resolve("dictationStt").state.status, "unknown");
  }
});

test("baseline guard: supported main metadata retains READY independently of binary installation", async (t) => {
  const api = mainMetadata("15.5", false);
  const metadata = await api.checkParakeetInstallation();
  assert.equal(metadata.supported, true);
  assert.equal(metadata.installed, false);
  const h = await fixture(t, api);
  assert.equal(h.resolve("dictationStt").state.status, "ready");
});

test("baseline guard: capability refresh is independent of inventory and an older supported reply cannot overwrite unsupported main metadata", async (t) => {
  const api = mainMetadata("15.5");
  const h = await fixture(t, api);
  let answer;
  const held = new Promise((resolve) => {
    answer = resolve;
  });
  const old = h.store.loadRouteFacts({ checkParakeetInstallation: () => held }, [
    "sherpaCapability",
  ]);
  await h.store.loadRouteFacts(mainMetadata("12.7.6"), ["sherpaCapability"]);
  answer({ supported: true });
  await old;
  assert.equal(h.facts().sherpaSupported, false);
  assert.ok(h.facts().installed.sherpa.size > 0, "unsupported does not erase installed files");
  assert.deepEqual(h.resolve("dictationStt").state, {
    status: "unreachable",
    detail: "unsupported",
  });
  await h.store.loadRouteFacts(
    {
      checkParakeetInstallation: async () => {
        throw new Error("read failed");
      },
    },
    ["sherpaCapability"]
  );
  assert.equal(
    h.facts().sherpaSupported,
    false,
    "transient failure retains the last main-confirmed fact"
  );
  await h.store.loadRouteFacts(api, ["sherpaCapability"]);
  assert.equal(h.resolve("dictationStt").state.status, "ready");
});
