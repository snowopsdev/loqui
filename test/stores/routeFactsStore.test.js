const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}
const fail = () => Promise.reject(new Error("Available in the Loqui desktop app"));
const models = (...downloaded) => ({
  success: true,
  models: [
    ...downloaded.map((model) => ({ model, downloaded: true })),
    { model: "large", downloaded: false },
  ],
});
const sorted = (set) => (set === null ? null : [...set].sort());

function api(over = {}) {
  return {
    listWhisperModels: async () => models("base"),
    listParakeetModels: async () => models("parakeet-unified-en-0.6b"),
    modelGetAll: async () => [
      { id: "qwen3.5-2b-q4_k_m", isDownloaded: true },
      { id: "qwen3.5-9b-q4_k_m", isDownloaded: false },
    ],
    getDiarizationModelStatus: async () => ({ available: true, modelsDownloaded: true }),
    getSearchModelStatus: async () => ({ downloaded: false }),
    credentials: {
      list: async () => [
        { id: "openai", present: true, generation: 3 },
        { id: "groq", present: false, generation: 0 },
        { id: "codex", present: true, generation: 1 },
      ],
    },
    keyring: {
      list: async () => [
        { id: "openai", status: "verified" },
        { id: "corti:speech", status: "rejected" },
      ],
    },
    ...over,
  };
}

// Each scenario gets a fresh module instance: generations and subscriptions are module state.
async function freshStore(t, windowProps = {}, initialStorage = {}) {
  const { storage } = installBrowserGlobals(t, { window: windowProps, initialStorage });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-route-facts-test-" });
  const store = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  return { vite, storage, store, facts: () => store.useRouteFactsStore.getState().facts };
}

// R2-1/R3-1: main's five enterprise settings (including the migrated auth source) and its
// environment facts (enterprise-route-facts), each call recorded.
const NO_OVERRIDES = {
  bedrockEndpoint: { set: false, host: null },
  bedrockProfile: false,
  vertexApiKeyEnv: false,
  vertexProjectEnv: false,
};
function enterpriseApi(calls, main = {}, envFacts = NO_OVERRIDES) {
  const answer = (name, value) => () => {
    calls.push(name);
    return typeof value === "function" ? value() : Promise.resolve(value);
  };
  return {
    // Fixture reply construction only; production uses one IPC atomic snapshot.
    async getEnterpriseRouteState() {
      calls.push("getEnterpriseRouteState");
      const values = await Promise.all([
        this.getBedrockRegion(),
        this.getAzureEndpoint(),
        this.getVertexProject(),
        this.getVertexLocation(),
        this.getVertexAuthSource(),
      ]);
      return {
        current: Object.fromEntries(
          [
            "bedrockRegion",
            "azureEndpoint",
            "vertexProject",
            "vertexLocation",
            "vertexAuthSource",
          ].map((key, i) => [key, values[i] === null ? "" : values[i]])
        ),
        version: main.version ?? 1,
        facts: await this.enterpriseRouteFacts(),
      };
    },
    getBedrockRegion: answer("getBedrockRegion", main.bedrockRegion ?? ""),
    getAzureEndpoint: answer("getAzureEndpoint", main.azureEndpoint ?? ""),
    getVertexProject: answer("getVertexProject", main.vertexProject ?? null),
    getVertexLocation: answer("getVertexLocation", main.vertexLocation ?? ""),
    getVertexAuthSource: answer("getVertexAuthSource", main.vertexAuthSource ?? "adc"),
    enterpriseRouteFacts: answer("enterpriseRouteFacts", envFacts),
  };
}

test("cold start: every fact is unknown until main answers, then each family is filled", async (t) => {
  // I9: unknown is null, never an empty "nothing installed".
  const { store, facts } = await freshStore(t);
  assert.deepEqual(facts().installed, { whisper: null, sherpa: null, llm: null });
  assert.equal(facts().credentials, null);
  assert.equal(facts().speakerIdModelsReady, null);
  assert.equal(facts().searchModelReady, null);
  assert.equal(facts().rejected.size, 0);

  await store.loadRouteFacts(undefined);
  await store.loadRouteFacts({});
  assert.deepEqual(
    facts().installed,
    { whisper: null, sherpa: null, llm: null },
    "missing calls stay unknown"
  );

  await store.loadRouteFacts(api());
  const f = facts();
  assert.deepEqual(sorted(f.installed.whisper), ["base"]);
  assert.deepEqual(sorted(f.installed.sherpa), ["parakeet-unified-en-0.6b"]);
  assert.deepEqual(sorted(f.installed.llm), ["qwen3.5-2b-q4_k_m"]);
  assert.deepEqual([...f.credentials.entries()].sort(), [
    ["codex", true],
    ["groq", false],
    ["openai", true],
  ]);
  assert.deepEqual([...f.rejected], [], "legacy status rows have no configuration-bound authority");
  assert.equal(f.speakerIdModelsReady, true);
  assert.equal(f.searchModelReady, false);
});

test("a failed Whisper inventory leaves only Whisper unknown; an empty LLM inventory is known-empty", async (t) => {
  // I9: the v1 loader nulled every family when one call failed.
  const { store, facts } = await freshStore(t);
  await store.loadRouteFacts(
    api({
      listWhisperModels: fail,
      listParakeetModels: async () => ({ success: false, models: [] }),
      modelGetAll: async () => [],
    })
  );
  assert.equal(facts().installed.whisper, null);
  assert.equal(facts().installed.sherpa, null, "success:false is a failure, not an empty disk");
  assert.deepEqual(sorted(facts().installed.llm), []);
  assert.equal(facts().speakerIdModelsReady, true);
});

test("a transient failure keeps the last known value and a later answer replaces it", async (t) => {
  // I9: error recovery.
  const { store, facts } = await freshStore(t);
  await store.loadRouteFacts(api());
  await store.loadRouteFacts(
    api({
      listWhisperModels: fail,
      getDiarizationModelStatus: fail,
      credentials: { list: fail },
      keyring: { list: fail },
    })
  );
  assert.deepEqual(sorted(facts().installed.whisper), ["base"]);
  assert.equal(facts().speakerIdModelsReady, true);
  assert.equal(facts().credentials.get("openai"), true);
  assert.deepEqual([...facts().rejected], []);

  await store.loadRouteFacts(
    api({
      listWhisperModels: async () => models("small"),
      getDiarizationModelStatus: async () => ({ available: true, modelsDownloaded: false }),
    })
  );
  assert.deepEqual(sorted(facts().installed.whisper), ["small"]);
  assert.equal(facts().speakerIdModelsReady, false);
});

test("support-model failures on a cold start stay unknown, never ready", async (t) => {
  // I9: support-model failure.
  const { store, facts } = await freshStore(t);
  await store.loadRouteFacts(
    api({ getDiarizationModelStatus: fail, getSearchModelStatus: async () => ({}) })
  );
  assert.equal(facts().speakerIdModelsReady, null);
  assert.equal(facts().searchModelReady, null, "a malformed answer is not a fact");
});

test("each family publishes as soon as its own call resolves", async (t) => {
  // I9: independent publication; I2: one slow call never holds the others back.
  const { store, facts } = await freshStore(t);
  const whisper = deferred();
  const pending = store.loadRouteFacts(api({ listWhisperModels: () => whisper.promise }));
  await flush();
  assert.equal(facts().installed.whisper, null);
  assert.deepEqual(sorted(facts().installed.llm), ["qwen3.5-2b-q4_k_m"]);
  assert.equal(facts().credentials.get("codex"), true);
  whisper.resolve(models("base"));
  await pending;
  assert.deepEqual(sorted(facts().installed.whisper), ["base"]);
});

test("an older, slower response never overwrites a newer one", async (t) => {
  // I9: per-key generation.
  const { store, facts } = await freshStore(t);
  const older = deferred();
  const first = store.loadRouteFacts(api({ listWhisperModels: () => older.promise }));
  await store.loadRouteFacts(api({ listWhisperModels: async () => models("small") }));
  older.resolve(models("base"));
  await first;
  assert.deepEqual(sorted(facts().installed.whisper), ["small"]);
});

test("credential presence follows main's generations, not arrival order", async (t) => {
  // I3: readiness comes from main, refreshed by credentials.onChanged.
  let changed;
  let listCalls = 0;
  const slowList = deferred();
  const { store, facts } = await freshStore(t);
  await store.loadRouteFacts(api());
  globalThis.window.electronAPI = api({
    credentials: {
      list: () => (++listCalls === 1 ? slowList.promise : Promise.resolve([])),
      onChanged: (cb) => {
        changed = cb;
        return () => {};
      },
    },
  });
  store.ensureRouteFactsSubscribed();
  changed({ id: "openai", present: false, generation: 4 });
  assert.equal(facts().credentials.get("openai"), false, "the event applies at once");
  slowList.resolve([{ id: "openai", present: true, generation: 3 }]);
  await flush();
  assert.equal(
    facts().credentials.get("openai"),
    false,
    "a list read before the save cannot undo it"
  );
  changed({ id: "groq", present: true, generation: 1 });
  assert.equal(facts().credentials.get("groq"), true);
});

test("credential field presence comes from the same rows and generations as presence", async (t) => {
  // R3-1: Vertex's persisted source selects the host. These rows carry readiness
  // only; saving/removing/Undoing a key cannot change the committed host.
  let changed;
  const { store, facts } = await freshStore(t);
  assert.equal(facts().credentialFields, null, "unknown until main answers");
  await store.loadRouteFacts(
    api({
      credentials: {
        list: async () => [
          { id: "vertex", present: true, generation: 2, fields: { key: false } },
          { id: "openai", present: true, generation: 1, fields: { key: true } },
        ],
      },
    })
  );
  assert.deepEqual(
    facts().credentialFields.get("vertex"),
    { key: false },
    "present through the project only"
  );
  assert.equal(facts().credentials.get("vertex"), true);
  globalThis.window.electronAPI = api({
    credentials: {
      list: async () => [],
      onChanged: (cb) => {
        changed = cb;
        return () => {};
      },
    },
  });
  store.ensureRouteFactsSubscribed();
  changed({ id: "vertex", present: true, generation: 3, fields: { key: true } });
  assert.deepEqual(
    facts().credentialFields.get("vertex"),
    { key: true },
    "the event applies at once"
  );
  changed({ id: "vertex", present: true, generation: 2, fields: { key: false } });
  assert.deepEqual(
    facts().credentialFields.get("vertex"),
    { key: true },
    "an older generation is ignored"
  );
  changed({ id: "groq", present: true, generation: 1 });
  assert.deepEqual(
    facts().credentialFields.get("groq"),
    {},
    "a row without fields has no field present"
  );
});

test("a credential event before the first list re-reads the list instead of inventing a partial map", async (t) => {
  // I3: no presence is assumed for credentials main has not listed.
  let changed;
  let listCalls = 0;
  const { store, facts } = await freshStore(t, {
    electronAPI: api({
      credentials: {
        list: () =>
          ++listCalls === 1
            ? fail()
            : Promise.resolve([{ id: "openai", present: true, generation: 2 }]),
        onChanged: (cb) => {
          changed = cb;
          return () => {};
        },
      },
    }),
  });
  store.ensureRouteFactsSubscribed();
  await flush();
  assert.equal(facts().credentials, null);
  changed({ id: "openai", present: true, generation: 2 });
  assert.equal(facts().credentials, null, "still unknown until the list answers");
  await flush();
  assert.equal(listCalls, 2);
  assert.equal(facts().credentials.get("openai"), true);
});

test("change-driving N2: atomic main settings and facts publish together; newer versions refresh facts", async (t) => {
  // R2-1, change-driving: v2 read the enterprise slice from localStorage only,
  // while the executor reads main's environment (main.js:447-457).
  const { vite, storage, store, facts } = await freshStore(
    t,
    {},
    {
      azureEndpoint: "https://stale.example.com/openai",
      bedrockRegion: "us-east-1",
    }
  );
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  assert.equal(useSettingsStore.getState().azureEndpoint, "https://stale.example.com/openai");
  assert.equal(facts().enterpriseMain, null, "unknown before main answers");
  const calls = [];
  const slowEndpoint = deferred();
  const proxy = {
    bedrockEndpoint: { set: true, host: "bedrock-proxy.corp.example:8443" },
    bedrockProfile: false,
    vertexApiKeyEnv: false,
    vertexProjectEnv: true,
  };
  const pending = store.loadRouteFacts(
    api(
      enterpriseApi(
        calls,
        { bedrockRegion: "eu-west-1", azureEndpoint: () => slowEndpoint.promise },
        proxy
      )
    ),
    ["enterprise"]
  );
  await flush();
  assert.equal(facts().enterpriseMain, null, "still unknown while main's settings are in flight");
  slowEndpoint.resolve("https://main.example.com/openai");
  await pending;
  const settings = useSettingsStore.getState();
  assert.equal(settings.azureEndpoint, "https://main.example.com/openai", "main wins");
  assert.equal(settings.bedrockRegion, "eu-west-1");
  assert.equal(settings.vertexProject, "", "a null answer is an empty setting");
  assert.equal(settings.vertexLocation, "", "main's empty value replaces the renderer default");
  assert.equal(settings.vertexAuthSource, "adc", "source is synced from main after migration");
  assert.equal(storage.getItem("azureEndpoint"), "https://main.example.com/openai");
  assert.deepEqual(facts().enterpriseMain, proxy);

  // Later loads read an atomic tuple too; facts changes advance authority even when tuple fields stay equal.
  await store.loadRouteFacts(
    api(
      enterpriseApi(
        calls,
        {
          bedrockRegion: "eu-west-1",
          azureEndpoint: "https://main.example.com/openai",
          version: 2,
        },
        NO_OVERRIDES
      )
    ),
    ["enterprise"]
  );
  assert.equal(calls.filter((c) => c === "getEnterpriseRouteState").length, 2);
  assert.equal(calls.filter((c) => c === "enterpriseRouteFacts").length, 2);
  assert.deepEqual(facts().enterpriseMain, NO_OVERRIDES);
  assert.equal(
    useSettingsStore.getState().azureEndpoint,
    "https://main.example.com/openai",
    "not re-synced"
  );
});

test("change-driving Task6: enterprise: a failed or malformed answer is not a sync, and a local write during the sync is kept", async (t) => {
  const failing = await freshStore(t);
  const calls = [];
  await failing.store.loadRouteFacts(api(enterpriseApi(calls, { azureEndpoint: fail })), [
    "enterprise",
  ]);
  assert.equal(failing.facts().enterpriseMain, null, "a failed getter leaves the slice unknown");
  await failing.store.loadRouteFacts(
    api({
      ...enterpriseApi(calls),
      enterpriseRouteFacts: async () => ({ bedrockEndpoint: "https://x" }),
    }),
    ["enterprise"]
  );
  assert.equal(
    failing.facts().enterpriseMain,
    null,
    "a malformed environment answer is not a fact"
  );
  await failing.store.loadRouteFacts(api({ getBedrockRegion: async () => "" }), ["enterprise"]);
  assert.equal(
    failing.facts().enterpriseMain,
    null,
    "a build without the calls cannot confirm main"
  );

  const racing = await freshStore(t);
  const { useSettingsStore } = await racing.vite.ssrLoadModule("/stores/settingsStore.ts");
  const slow = deferred();
  const pending = racing.store.loadRouteFacts(
    api(enterpriseApi([], { azureEndpoint: () => slow.promise })),
    ["enterprise"]
  );
  await flush();
  useSettingsStore.getState().setAzureEndpoint("https://typed.example.com/openai"); // also sent to main
  slow.resolve("https://old.example.com/openai");
  await pending;
  assert.equal(
    useSettingsStore.getState().azureEndpoint,
    "https://typed.example.com/openai",
    "the newer write is kept"
  );
  assert.equal(
    racing.facts().enterpriseMain,
    null,
    "a pending or failed raw draft is never confirmed authority"
  );
});

test("legacy keyring statuses refresh without granting rejection authority", async (t) => {
  // I3: a stale rejected verdict is re-read when main's keyring changes.
  let keyringChanged;
  let rows = [{ id: "groq", status: "rejected" }];
  const { store, facts } = await freshStore(t, {
    electronAPI: api({
      keyring: {
        list: async () => rows,
        onChanged: (cb) => {
          keyringChanged = cb;
          return () => {};
        },
      },
    }),
  });
  store.ensureRouteFactsSubscribed();
  await flush();
  assert.deepEqual([...facts().rejected], [], "legacy status rows are unverified");
  rows = [{ id: "groq", status: "unverified" }];
  keyringChanged();
  await flush();
  assert.deepEqual([...facts().rejected], []);
});

test("focus and local-model events refresh the facts, once per window", async (t) => {
  const listeners = {};
  let whisperCalls = 0;
  const { store } = await freshStore(t, {
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
    electronAPI: api({
      listWhisperModels: async () => {
        whisperCalls++;
        return models("base");
      },
    }),
  });
  store.ensureRouteFactsSubscribed();
  store.ensureRouteFactsSubscribed();
  await flush();
  assert.equal(whisperCalls, 1);
  assert.deepEqual(Object.keys(listeners).sort(), [
    "focus",
    "openwhispr-local-models-changed",
    "openwhispr-models-cleared",
  ]);
  for (const type of Object.keys(listeners)) {
    assert.equal(listeners[type].length, 1, `${type} registered once`);
    listeners[type][0]();
  }
  await flush();
  assert.equal(whisperCalls, 4);
});

// change-driving: concurrent mounts share one startup sync; malformed getters
// are failures, never a fabricated empty confirmed enterprise configuration.
test("change-driving Task6: enterprise startup sync coalesces, and malformed settings stay unknown", async (t) => {
  const { store, facts } = await freshStore(t);
  await store.loadRouteFacts(
    api(enterpriseApi([], { azureEndpoint: () => Promise.resolve({ invalid: true }) })),
    ["enterprise"]
  );
  assert.equal(facts().enterpriseMain, null);
  const slow = deferred();
  const calls = [];
  const source = api(enterpriseApi(calls, { azureEndpoint: () => slow.promise }));
  const one = store.loadRouteFacts(source, ["enterprise"]);
  const two = store.loadRouteFacts(source, ["enterprise"]);
  await flush();
  assert.equal(calls.filter((name) => name === "getAzureEndpoint").length, 1);
  slow.resolve("https://fixture.example/openai");
  await Promise.all([one, two]);
  assert.notEqual(facts().enterpriseMain, null);
});

// change-driving B4: status-only rows never reject; the optional query binds
// canonical non-secret options, generations, and main-issued fingerprints.
test("route health stores only bound main metadata, with per-query ordering and recovery", async (t) => {
  const { store, facts } = await freshStore(t);
  const older = deferred();
  const metadata = (tenant, fingerprint) => ({
    options: { cortiTenant: tenant, cortiEnvironment: "us" },
    current: [{ identity: "corti:speech", generation: 3, configFingerprint: fingerprint }],
    health: [
      {
        identity: "corti:speech",
        generation: 3,
        configFingerprint: fingerprint,
        status: "rejected",
      },
    ],
  });
  const old = store.loadRouteFacts(api({ keyring: { routeHealth: () => older.promise } }), [
    "rejected",
  ]);
  const current = metadata("base", "main-B");
  await store.loadRouteFacts(
    api({
      keyring: {
        routeHealth: async (options) => {
          assert.deepEqual(options, { cortiEnvironment: "us", cortiTenant: "base" });
          return current;
        },
      },
    }),
    ["rejected"]
  );
  assert.equal(
    facts().credentialHealth,
    current,
    "object key order does not change canonical equality"
  );
  older.resolve(metadata("base", "main-A"));
  await old;
  assert.equal(facts().credentialHealth, current);
  await store.loadRouteFacts(api({ keyring: { routeHealth: fail } }), ["rejected"]);
  assert.equal(facts().credentialHealth, current, "transient failure keeps last metadata");
  await store.loadRouteFacts(
    api({ keyring: { routeHealth: async () => metadata("other", "wrong-query") } }),
    ["rejected"]
  );
  assert.equal(facts().credentialHealth, current, "mismatched query capture is not admitted");
});

// change-driving B6 integration: real persistence recovery feeds both changed
// events and cold-window lists. No secrets, provider calls or personal profile.
test("production credential uncertainty survives stale lists and reaches normal/custom routes", async (t) => {
  const { realCredentialEnv } = require("../helpers/harness/realCredentialEnv");
  const { fakeCodexFs } = require("../helpers/harness/fakeCredentialEnv");
  const { createCredentialAuthority } = require("../../src/helpers/credentialAuthority");
  const scenarios = [
    ["openai", "OPENAI_API_KEY", "chatIntelligence", "chat", "providers", "openai"],
    [
      "custom:dictationCleanup",
      "CUSTOM_CLEANUP_API_KEY",
      "dictationCleanup",
      "dictationCleanup",
      "providers",
      "custom",
    ],
    [
      "custom:noteFormatting",
      "NOTE_FORMATTING_CUSTOM_API_KEY",
      "noteFormatting",
      "noteFormatting",
      "self-hosted",
      "lan",
    ],
    [
      "custom:dictationTranslation",
      "TRANSLATION_CUSTOM_API_KEY",
      "dictationTranslation",
      "translation",
      "providers",
      "custom",
    ],
    [
      "custom:dictationAgent",
      "DICTATION_AGENT_CUSTOM_API_KEY",
      "dictationAgent",
      "voiceAssistant",
      "self-hosted",
      "lan",
    ],
    [
      "custom:dictationAgentVision",
      "DICTATION_AGENT_VISION_CUSTOM_API_KEY",
      "dictationAgentVision",
      "assistantVision",
      "providers",
      "custom",
    ],
    [
      "custom:chatIntelligence",
      "CHAT_AGENT_CUSTOM_API_KEY",
      "chatIntelligence",
      "chat",
      "providers",
      "custom",
    ],
  ];
  for (const [slot, key, scope, routeId, mode, provider] of scenarios)
    await t.test(slot, async (st) => {
      const real = realCredentialEnv(st, { [key]: "fixture-secret", VERTEX_AUTH_SOURCE: "adc" });
      const authority = createCredentialAuthority({
        env: real.env,
        fs: fakeCodexFs(),
        codexHome: "/fixture/codex",
        setTimer() {},
      });
      const oldRows = authority.list();
      assert.equal(
        oldRows.find((row) => row.id === slot).present,
        true,
        "fixture uses actual slot env name"
      );
      const slow = deferred();
      const source = api({
        credentials: { list: () => slow.promise, onChanged: (cb) => authority.subscribe(cb) },
      });
      const { store, facts, vite } = await freshStore(st, { electronAPI: source });
      const routes = await vite.ssrLoadModule("/lib/routes.ts");
      const settings = (
        await vite.ssrLoadModule("/stores/settingsStore.ts")
      ).useSettingsStore.getState();
      const scopeKeys = {
        dictationCleanup: "cleanup",
        noteFormatting: "noteFormatting",
        dictationTranslation: "translation",
        dictationAgent: "dictationAgent",
        dictationAgentVision: "dictationAgentVision",
        chatIntelligence: "chatAgent",
      };
      const prefix = scopeKeys[scope];
      const state = {
        ...settings,
        [`${prefix}Mode`]: mode,
        [`${prefix}Provider`]: provider,
        [`${prefix}Model`]: "fixture-model",
        [`${prefix}RemoteUrl`]: "https://fixture.example/v1",
        [`${prefix}CloudBaseUrl`]: "https://fixture.example/v1",
        useCleanupModel: true,
        useDictationTranslation: true,
        useDictationAgent: true,
        voiceAgentScreenContext: true,
        useDictationAgentVisionModel: true,
      };
      const resolved = () =>
        routes.resolveRoute(
          routes.buildRouteSnapshot(state, facts(), routes.currentRouteCopy(), false),
          routeId
        );
      await store.loadRouteFacts(api({ credentials: { list: async () => oldRows } }), [
        "credentials",
      ]);
      assert.equal(resolved().state.status, "ready");
      store.ensureRouteFactsSubscribed();
      real.fs.promises.unlink = async () => {
        throw new Error("fixture removal failure");
      };
      real.fs.promises.rename = async () => {
        throw new Error("fixture rollback failure");
      };
      real.fs.promises.readFile = async () => {
        throw new Error("fixture unreadable storage");
      };
      assert.equal((await authority.remove(slot)).ok, false);
      assert.equal(await authority.captureCommitted(slot), null);
      assert.equal(facts().credentialUnknown.has(slot), true);
      assert.equal(resolved().state.status, "unknown", "event blocks actual refused capture");
      slow.resolve(oldRows);
      await flush();
      assert.equal(
        resolved().state.status,
        "unknown",
        "stale pre-recovery list cannot clear uncertainty"
      );
      const cold = await freshStore(st);
      await cold.store.loadRouteFacts(
        api({ credentials: { list: async () => authority.list() } }),
        ["credentials"]
      );
      assert.equal(
        cold.facts().credentialUnknown.has(slot),
        true,
        "new window sees actual unknown slot"
      );
      if (provider !== "openai") {
        const absent = {
          ...facts(),
          credentials: new Map([[slot, false]]),
          credentialUnknown: new Set(),
        };
        assert.equal(
          routes.resolveRoute(
            routes.buildRouteSnapshot(state, absent, routes.currentRouteCopy(), false),
            routeId
          ).state.status,
          "ready",
          "confirmed absent optional key permits unauthenticated endpoint"
        );
      }
    });
});

// change-driving B6: capture admission precedes profile/ADC selection today;
// independent sources work with known-absent keys, never unknown persistence.
test("production unknown enterprise/speech slots remain non-ready across a deferred old list", async (t) => {
  const { realCredentialEnv } = require("../helpers/harness/realCredentialEnv");
  const { fakeCodexFs } = require("../helpers/harness/fakeCredentialEnv");
  const { createCredentialAuthority } = require("../../src/helpers/credentialAuthority");
  const { enterpriseRouteFacts } = require("../../src/helpers/enterpriseRouteFacts");
  const scenarios = [
    [
      "azure",
      {
        AZURE_OPENAI_API_KEY: "fixture-key",
        AZURE_OPENAI_ENDPOINT: "https://fixture.openai.azure.com/openai",
      },
    ],
    ["vertex", { VERTEX_API_KEY: "fixture-key", VERTEX_AUTH_SOURCE: "apiKey" }],
    [
      "vertex",
      {
        VERTEX_API_KEY: "fixture-key",
        VERTEX_AUTH_SOURCE: "adc",
        VERTEX_PROJECT: "fixture-project",
      },
    ],
    [
      "bedrock",
      {
        BEDROCK_ACCESS_KEY_ID: "fixture-id",
        BEDROCK_SECRET_ACCESS_KEY: "fixture-secret",
        BEDROCK_PROFILE: "",
      },
    ],
    [
      "bedrock",
      {
        BEDROCK_ACCESS_KEY_ID: "fixture-id",
        BEDROCK_SECRET_ACCESS_KEY: "fixture-secret",
        BEDROCK_PROFILE: "fixture-profile",
      },
    ],
    ["corti:speech", { CORTI_CLIENT_ID: "fixture-id", CORTI_CLIENT_SECRET: "fixture-secret" }],
    ["custom:transcription", { CUSTOM_TRANSCRIPTION_API_KEY: "fixture-key" }],
  ];
  for (const [slot, initial] of scenarios)
    await t.test(
      `${slot}:${initial.VERTEX_AUTH_SOURCE || initial.BEDROCK_PROFILE || "static"}`,
      async (st) => {
        const { env, fs } = realCredentialEnv(st, {
          VERTEX_AUTH_SOURCE: "adc",
          BEDROCK_PROFILE: "",
          ...initial,
        });
        const authority = createCredentialAuthority({
          env,
          fs: fakeCodexFs(),
          codexHome: "/fixture/codex",
          setTimer() {},
        });
        const oldRows = authority.list();
        const slow = deferred();
        const source = api({
          ...enterpriseApi(
            [],
            {
              bedrockRegion: env.getBedrockRegion(),
              azureEndpoint: env.getAzureEndpoint(),
              vertexProject: env.getVertexProject(),
              vertexLocation: env.getVertexLocation(),
              vertexAuthSource: env.getVertexAuthSource(),
            },
            enterpriseRouteFacts(process.env)
          ),
          credentials: { list: () => slow.promise, onChanged: (cb) => authority.subscribe(cb) },
        });
        const { store, facts, vite } = await freshStore(st, { electronAPI: source });
        const routes = await vite.ssrLoadModule("/lib/routes.ts");
        const settings = (await vite.ssrLoadModule("/stores/settingsStore.ts")).useSettingsStore;
        await store.loadRouteFacts({ ...source, credentials: { list: async () => oldRows } }, [
          "credentials",
          "enterprise",
        ]);
        const speech = slot === "corti:speech" || slot === "custom:transcription";
        const state = {
          ...settings.getState(),
          chatAgentMode: "enterprise",
          chatAgentProvider: slot,
          chatAgentModel: "fixture-model",
          transcriptionMode: "providers",
          cloudTranscriptionProvider: slot === "corti:speech" ? "corti" : "custom",
          cloudTranscriptionModel: "fixture-model",
          cloudTranscriptionBaseUrl: "https://fixture.example/v1",
        };
        const resolve = (f = facts()) =>
          routes.resolveRoute(
            routes.buildRouteSnapshot(state, f, routes.currentRouteCopy(), false),
            speech ? "dictationStt" : "chat"
          );
        assert.equal(resolve().state.status, "ready");
        const beforeList = { ...facts(), credentials: null, credentialFields: null };
        assert.equal(
          resolve(beforeList).state.status,
          "unknown",
          "slot uncertainty has not been loaded"
        );
        if (initial.VERTEX_AUTH_SOURCE === "adc" || initial.BEDROCK_PROFILE) {
          assert.equal(
            resolve({
              ...facts(),
              credentials: new Map([[slot, false]]),
              credentialFields: new Map([[slot, {}]]),
            }).state.status,
            "ready",
            "known absent keys do not block independent source"
          );
        }
        store.ensureRouteFactsSubscribed();
        fs.promises.unlink = async () => {
          throw new Error("fixture remove failure");
        };
        fs.promises.rename = async () => {
          throw new Error("fixture rollback failure");
        };
        fs.promises.readFile = async () => {
          throw new Error("fixture unreadable recovery");
        };
        await authority.remove(slot);
        assert.equal(await authority.captureCommitted(slot), null);
        assert.equal(facts().credentialUnknown.has(slot), true);
        assert.equal(resolve().state.status, "unknown");
        slow.resolve(oldRows);
        await flush();
        assert.equal(
          resolve().state.status,
          "unknown",
          "old list never downgrades unknown to absent/ready"
        );
      }
    );
});

// change-driving N1: route enterprise facts refresh only after profile ACK,
// including removal; held/failed writes cannot advertise optimistic readiness.
test("Bedrock profile ACK refreshes enterprise facts; failed save keeps committed readiness", async (t) => {
  const { realCredentialEnv } = require("../helpers/harness/realCredentialEnv");
  const { fakeCodexFs } = require("../helpers/harness/fakeCredentialEnv");
  const { createCredentialAuthority } = require("../../src/helpers/credentialAuthority");
  const { enterpriseRouteFacts } = require("../../src/helpers/enterpriseRouteFacts");
  const { env, fs } = realCredentialEnv(t, {
    BEDROCK_PROFILE: "",
    BEDROCK_ACCESS_KEY_ID: "",
    BEDROCK_SECRET_ACCESS_KEY: "",
    VERTEX_AUTH_SOURCE: "adc",
  });
  const authority = createCredentialAuthority({
    env,
    fs: fakeCodexFs(),
    codexHome: "/fixture/codex",
    setTimer() {},
  });
  const source = api({
    ...enterpriseApi([]),
    getEnterpriseRouteState: async () => ({
      ...env.getEnterpriseRouteState(),
      facts: enterpriseRouteFacts(process.env),
    }),
    enterpriseRouteFacts: async () => enterpriseRouteFacts(process.env),
    credentials: { list: async () => authority.list(), onChanged: (cb) => authority.subscribe(cb) },
    saveBedrockProfile: async (value) => {
      const result = await env.saveBedrockProfile(value);
      if (result.success) authority.refresh("bedrock");
      return result;
    },
  });
  const { store, facts, vite } = await freshStore(t, { electronAPI: source });
  const settings = (await vite.ssrLoadModule("/stores/settingsStore.ts")).useSettingsStore;
  store.ensureRouteFactsSubscribed();
  await flush();
  assert.equal(facts().enterpriseMain.bedrockProfile, false);
  fs.holdNext((op, name) => op === "rename" && name === ".env");
  const save = settings.getState().setBedrockProfile("fixture-profile");
  const held = await fs.nextHold();
  assert.equal(facts().enterpriseMain.bedrockProfile, false);
  held.release();
  assert.equal(await save, true);
  await flush();
  assert.equal(facts().enterpriseMain.bedrockProfile, true);
  fs.holdNext((op, name) => op === "rename" && name === ".env");
  const failed = settings.getState().setBedrockProfile("");
  (await fs.nextHold()).fail(new Error("fixture failed profile removal"));
  assert.equal(await failed, false);
  assert.equal(facts().enterpriseMain.bedrockProfile, true);
  assert.equal(settings.getState().bedrockProfile, "fixture-profile");
  assert.equal(await settings.getState().setBedrockProfile(""), true);
  await flush();
  assert.equal(facts().enterpriseMain.bedrockProfile, false);
});

// change-driving R3-1: source has no legacy controlled input; a local ACK
// fences a slow startup read, while pending/failed saves grant no new fence.
test("change-driving N2: acknowledged Vertex source event wins over older atomic startup sync", async (t) => {
  const save = deferred();
  const getter = deferred();
  let changed;
  const { store, vite } = await freshStore(t, {
    electronAPI: {
      saveVertexAuthSource: () => save.promise,
      onEnterpriseRouteChanged: (cb) => {
        changed = cb;
        return () => {};
      },
    },
  });
  const { useSettingsStore, enterpriseLocalWriteCount } = await vite.ssrLoadModule(
    "/stores/settingsStore.ts"
  );
  const source = api(enterpriseApi([], { vertexAuthSource: () => getter.promise }));
  const sync = store.loadRouteFacts(source, ["enterprise"]);
  const before = enterpriseLocalWriteCount();
  const apply = useSettingsStore.getState().setVertexAuthSource("apiKey");
  assert.equal(useSettingsStore.getState().vertexAuthSource, "adc");
  changed({
    current: {
      bedrockRegion: "us-east-1",
      azureEndpoint: "",
      vertexProject: "",
      vertexLocation: "us-central1",
      vertexAuthSource: "apiKey",
    },
    version: 2,
    facts: NO_OVERRIDES,
  });
  save.resolve({ success: true });
  assert.equal(await apply, true);
  getter.resolve("adc");
  await sync;
  assert.equal(useSettingsStore.getState().vertexAuthSource, "apiKey");
  assert.ok(enterpriseLocalWriteCount() > before);
  const confirmed = enterpriseLocalWriteCount();
  globalThis.window.electronAPI.saveVertexAuthSource = async () => ({ success: false });
  assert.equal(await useSettingsStore.getState().setVertexAuthSource("adc"), false);
  assert.equal(useSettingsStore.getState().vertexAuthSource, "apiKey");
  assert.equal(enterpriseLocalWriteCount(), confirmed);
});

// change-driving I3/B6: a first-list race must preserve an event without
// publishing a partial inventory or trusting a stale absent/present row.
test("recovery before the first list is replayed over both deferred older inventories", async (t) => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  let changed;
  const { store, facts } = await freshStore(t, {
    electronAPI: api({
      credentials: {
        list: () => (++calls === 1 ? first.promise : second.promise),
        onChanged: (cb) => {
          changed = cb;
          return () => {};
        },
      },
    }),
  });
  store.ensureRouteFactsSubscribed();
  changed({ id: "openai", present: false, fields: { key: false }, generation: 2, unknown: true });
  assert.equal(facts().credentials, null, "no partial inventory is invented");
  second.resolve([{ id: "openai", present: true, fields: { key: true }, generation: 1 }]);
  await flush();
  assert.equal(facts().credentialUnknown.has("openai"), true);
  assert.equal(facts().credentialGenerations.get("openai"), 2);
  first.resolve([{ id: "openai", present: true, fields: { key: true }, generation: 0 }]);
  await flush();
  assert.equal(facts().credentialUnknown.has("openai"), true);
  assert.equal(facts().credentials.get("openai"), false);
});

// change-driving review R1: refresh events need not bump generation (Codex
// presence is a fresh stat). A list started later is authoritative at equality.
test("a later same-generation credential list supersedes an earlier refresh event", async (t) => {
  const { fakeCredentialEnv } = require("../helpers/harness/fakeCredentialEnv");
  const { createCredentialAuthority } = require("../../src/helpers/credentialAuthority");
  let authFilePresent = false;
  const authority = createCredentialAuthority({
    env: fakeCredentialEnv(),
    fs: { statSync: () => ({ isFile: () => true, size: authFilePresent ? 100 : 0 }) },
    codexHome: "/fixture/codex",
    setTimer() {},
  });
  const source = api({
    credentials: {
      list: async () => authority.list(),
      onChanged: (cb) => authority.subscribe(cb),
    },
  });
  const { store, facts } = await freshStore(t, { electronAPI: source });
  store.ensureRouteFactsSubscribed();
  await flush();
  authority.refresh("codex");
  assert.equal(facts().credentials.get("codex"), false);
  const generation = facts().credentialGenerations.get("codex");
  authFilePresent = true;
  await store.loadRouteFacts(source, ["credentials"]);
  assert.equal(facts().credentialGenerations.get("codex"), generation);
  assert.equal(
    facts().credentials.get("codex"),
    true,
    "an old equal-generation event cannot mask a later list"
  );
});

// change-driving review R1: publishing one response cannot discard an event
// needed by another overlapping read that also began before the event.
test("overlapping lists retain their event fences, then allow newer equal-generation facts", async (t) => {
  const first = deferred();
  const second = deferred();
  let changed;
  const source = api({
    credentials: {
      list: () => first.promise,
      onChanged: (cb) => {
        changed = cb;
        return () => {};
      },
    },
  });
  const { store, facts } = await freshStore(t, { electronAPI: source });
  const row = (present, generation = 1, unknown = false) => ({
    id: "codex",
    present,
    generation,
    fields: {},
    unknown,
  });
  await store.loadRouteFacts(api({ credentials: { list: async () => [row(false)] } }), [
    "credentials",
  ]);
  store.ensureRouteFactsSubscribed();
  const overlap = store.loadRouteFacts(api({ credentials: { list: () => second.promise } }), [
    "credentials",
  ]);
  changed(row(false));
  first.resolve([row(true)]);
  await flush();
  assert.equal(facts().credentials.get("codex"), false);
  second.resolve([row(true)]);
  await overlap;
  assert.equal(
    facts().credentials.get("codex"),
    false,
    "second overlapping response still needs its own event fence"
  );
  await store.loadRouteFacts(api({ credentials: { list: async () => [row(true)] } }), [
    "credentials",
  ]);
  assert.equal(facts().credentials.get("codex"), true, "newer list wins at the same generation");
  const older = deferred();
  const pending = store.loadRouteFacts(api({ credentials: { list: () => older.promise } }), [
    "credentials",
  ]);
  changed(row(false));
  await store.loadRouteFacts(api({ credentials: { list: async () => [row(true)] } }), [
    "credentials",
  ]);
  assert.equal(
    facts().credentials.get("codex"),
    true,
    "a post-event list wins while the event is still retained for an older read"
  );
  older.resolve([row(false)]);
  await pending;
  assert.equal(
    facts().credentials.get("codex"),
    true,
    "late older response cannot regress the newer publication"
  );
  changed(row(false, 3, true));
  await store.loadRouteFacts(api({ credentials: { list: async () => [row(true, 2)] } }), [
    "credentials",
  ]);
  assert.equal(facts().credentialGenerations.get("codex"), 3);
  assert.equal(
    facts().credentialUnknown.has("codex"),
    true,
    "retiring an event never weakens monotonic generation protection"
  );
});
