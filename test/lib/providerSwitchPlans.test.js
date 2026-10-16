const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("./rendererTestHarness");
const { MIGRATED_STORAGE, routeBaseState } = require("./routeStateFixture");

let ackVersion = 0;

test("change-driving: provider-switch planners and applyRoutePatch", async (t) => {
  const events = [];
  const { storage } = installBrowserGlobals(t, {
    initialStorage: MIGRATED_STORAGE,
    window: {
      dispatchEvent: (event) => {
        events.push(event.type);
        return true;
      },
    },
  });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-provider-switch-plans-test-" });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const plans = await vite.ssrLoadModule("/lib/providerSwitchPlans.ts");
  const live = () => useSettingsStore.getState();
  const reset = (overrides = {}) =>
    useSettingsStore.setState({ ...routeBaseState(), ...overrides });
  const pick = (state) => Object.fromEntries(plans.ROUTE_PATCH_KEYS.map((k) => [k, state[k]]));

  // Change-driving: the module does not exist yet. Each case plans a switch
  // on the live state, runs the store action, and requires the store to end
  // exactly at "before + patch". That shows one shared implementation.
  await t.test(
    "change-driving: the store's switch actions await and commit exactly the planned patch",
    async () => {
      const cases = [
        {
          setup: {
            cloudTranscriptionProvider: "custom",
            cloudTranscriptionModel: "parasail-whisper-v3",
          },
          run: ["stt", "dictation", "groq"],
        },
        {
          setup: { transcriptionModelByProvider: { "dictation:groq": "whisper-large-v3-turbo" } },
          run: ["stt", "dictation", "groq"],
        },
        { setup: {}, run: ["stt", "meeting", "deepgram"] },
        { setup: { uploadCloudTranscriptionProvider: "groq" }, run: ["stt", "upload", "groq"] },
        {
          setup: {
            cleanupMode: "providers",
            cleanupProvider: "custom",
            cleanupModel: "parasail-llm-v1",
          },
          run: ["llm", "dictationCleanup", "openai", "gpt-6-astra"],
        },
        {
          setup: {
            chatAgentMode: "providers",
            chatAgentProvider: "openai",
            chatAgentModel: "gpt-6-astra",
            reasoningModelByProvider: { "chatIntelligence:anthropic": "claude-sonnet-5" },
          },
          run: ["llm", "chatIntelligence", "anthropic", "claude-fable-5-1"],
        },
        {
          setup: { dictationAgentProvider: "openai", dictationAgentModel: "gpt-6-astra" },
          run: ["llm", "dictationAgentVision", "anthropic", "claude-fable-5-1"],
        },
        {
          setup: {
            chatAgentMode: "providers",
            chatAgentProvider: "openai",
            chatAgentModel: "gpt-6-astra",
          },
          run: ["llm", "chatIntelligence", "openai", "gpt-5.6-sol"],
        },
      ];
      for (const { setup, run } of cases) {
        reset(setup);
        const before = pick(live());
        const [kind, scope, provider, fallback] = run;
        const patch =
          kind === "stt"
            ? plans.planTranscriptionProviderSwitch(live(), scope, provider)
            : plans.planReasoningProviderSwitch(live(), scope, provider, fallback);
        assert.deepEqual(pick(live()), before, `${run.join(" ")}: planning writes nothing`);
        if (kind === "stt") await live().switchCloudTranscriptionProvider(scope, provider);
        else await live().switchReasoningProvider(scope, provider, fallback);
        assert.deepEqual(pick(live()), { ...before, ...patch }, run.join(" "));
      }
    }
  );

  await t.test(
    "change-driving: the vision scope reads its provider through the assistant fallback",
    () => {
      reset({ dictationAgentProvider: "openai", dictationAgentModel: "gpt-6-astra" });
      const patch = plans.planReasoningProviderSwitch(
        live(),
        "dictationAgentVision",
        "anthropic",
        "claude-fable-5-1"
      );
      assert.equal(patch.reasoningModelByProvider["dictationAgentVision:openai"], "gpt-6-astra");
      assert.equal(patch.dictationAgentVisionProvider, "anthropic");
      assert.equal(patch.dictationAgentVisionModel, "claude-fable-5-1");
    }
  );

  await t.test(
    "change-driving: default cloud models follow the registry rule; vision skips text-only models",
    () => {
      const { cloudProviders } = require("../../src/models/modelRegistryData.json");
      const tinfoil = cloudProviders.find((p) => p.id === "tinfoil");
      assert.equal(plans.defaultCloudModel("tinfoil"), tinfoil.defaultModel);
      assert.equal(
        plans.defaultCloudModel("openai"),
        cloudProviders.find((p) => p.id === "openai").models[0].id
      );
      assert.equal(
        plans.defaultCloudModel("groq", { vision: true }),
        "",
        "Groq has no vision model"
      );
      assert.equal(plans.defaultCloudModel("bedrock"), "us.anthropic.claude-fable-5");
      assert.equal(plans.defaultCloudModel("codex"), "");
    }
  );

  // Change-driving: applyRoutePatch does not exist yet.
  await t.test(
    "change-driving: applyRoutePatch writes every local key in one setState",
    async () => {
      reset();
      let notifications = 0;
      const unsubscribe = useSettingsStore.subscribe(() => notifications++);
      await live().applyRoutePatch({
        chatAgentMode: "providers",
        chatAgentProvider: "openai",
        useDictationAgentVisionModel: true,
        reasoningModelByProvider: { "chatIntelligence:groq": "openai/gpt-oss-120b" },
      });
      unsubscribe();
      assert.equal(notifications, 1, "one setState");
      assert.equal(live().chatAgentProvider, "openai");
      assert.equal(storage.getItem("chatAgentMode"), "providers");
      assert.equal(storage.getItem("useDictationAgentVisionModel"), "true");
      assert.deepEqual(JSON.parse(storage.getItem("reasoningModelByProvider")), {
        "chatIntelligence:groq": "openai/gpt-oss-120b",
      });
    }
  );

  await t.test(
    "change-driving: applyRoutePatch refuses secrets and non-route keys before writing anything",
    async () => {
      reset();
      await assert.rejects(
        live().applyRoutePatch({ cleanupMode: "providers", openaiApiKey: "sk-x" }),
        /secret/
      );
      assert.equal(live().cleanupMode, "local", "nothing was written");
      assert.notEqual(live().openaiApiKey, "sk-x");
      await assert.rejects(
        live().applyRoutePatch({ dictationAgentVisionMode: "local" }),
        /not a route setting/
      );
      for (const key of plans.ROUTE_PATCH_KEYS) {
        assert.doesNotMatch(
          key,
          /ApiKey$|ClientSecret$|ClientId$|AccessKeyId$|SecretAccessKey$|SessionToken$/,
          key
        );
      }
    }
  );

  // Change-driving (I1 follow-up): these keys are outside v1's allowlist.
  await t.test(
    "change-driving: applyRoutePatch writes enable switches and the Corti region like their old setters",
    async () => {
      reset({ useCleanupModel: false, voiceAgentScreenContext: false });
      await live().applyRoutePatch({
        useCleanupModel: true,
        voiceAgentScreenContext: true,
        cortiEnvironment: "eu",
        cortiTenant: "acme",
      });
      assert.equal(live().useCleanupModel, true);
      assert.equal(live().cortiEnvironment, "eu");
      assert.equal(storage.getItem("useCleanupModel"), "true");
      assert.equal(storage.getItem("voiceAgentScreenContext"), "true");
      assert.equal(storage.getItem("cortiEnvironment"), "eu");
      assert.equal(storage.getItem("cortiTenant"), "acme");
    }
  );

  // Change-driving (R3-4): a route patch may contain several recipient fields.
  // Local state must not move until main's one atomic transaction acknowledges it.
  await t.test(
    "change-driving: applyRoutePatch sends one expected-tuple transaction and commits local fields only after ACK",
    async () => {
      reset();
      const oldTuple = {
        bedrockRegion: live().bedrockRegion,
        azureEndpoint: live().azureEndpoint,
        vertexProject: live().vertexProject,
        vertexLocation: live().vertexLocation,
        vertexAuthSource: live().vertexAuthSource,
      };
      let finish;
      const calls = [];
      const previous = globalThis.window.electronAPI;
      globalThis.window.electronAPI = {
        saveEnterpriseRoutePatch: (input) => {
          calls.push(input);
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
      };
      let notifications = 0;
      const unsubscribe = useSettingsStore.subscribe(() => notifications++);
      const { enterpriseLocalWriteCount } = await vite.ssrLoadModule("/stores/settingsStore.ts");
      const writesBefore = enterpriseLocalWriteCount();
      try {
        const pending = live().applyRoutePatch({
          bedrockRegion: "eu-west-1",
          azureEndpoint: "https://myres.openai.azure.com/openai",
          vertexProject: "acme-prod",
          vertexLocation: "europe-west4",
          vertexAuthSource: "apiKey",
          chatAgentModel: "eu.anthropic.claude-fable-5",
        });
        assert.equal(
          live().azureEndpoint,
          "",
          "the renderer still shows the committed tuple while main is writing"
        );
        assert.equal(
          storage.getItem("azureEndpoint"),
          null,
          "localStorage does not run ahead of the main ACK"
        );
        assert.equal(notifications, 0, "subscribers see no partial route commit");
        assert.equal(calls.length, 1, "all enterprise fields use one main transaction");
        assert.deepEqual(calls[0], {
          patch: {
            bedrockRegion: "eu-west-1",
            azureEndpoint: "https://myres.openai.azure.com/openai",
            vertexProject: "acme-prod",
            vertexLocation: "europe-west4",
            vertexAuthSource: "apiKey",
          },
          expected: oldTuple,
        });
        finish({
          success: true,
          version: ++ackVersion,
          current: { ...oldTuple, ...calls[0].patch },
        });
        await pending;
      } finally {
        unsubscribe();
        globalThis.window.electronAPI = previous;
      }
      assert.equal(notifications, 1, "one setState");
      assert.equal(
        enterpriseLocalWriteCount(),
        writesBefore + 1,
        "Task 3's main sync keeps this acknowledged write"
      );
      assert.equal(live().azureEndpoint, "https://myres.openai.azure.com/openai");
      assert.equal(
        live().chatAgentModel,
        "eu.anthropic.claude-fable-5",
        "applyRoutePatch never adds coupled writes"
      );
      for (const [key, value] of [
        ["bedrockRegion", "eu-west-1"],
        ["azureEndpoint", "https://myres.openai.azure.com/openai"],
        ["vertexProject", "acme-prod"],
        ["vertexLocation", "europe-west4"],
        ["vertexAuthSource", "apiKey"],
      ]) {
        assert.equal(storage.getItem(key), value, key);
      }
      assert.deepEqual(
        [...plans.ROUTE_ENTERPRISE_KEYS],
        ["bedrockRegion", "azureEndpoint", "vertexProject", "vertexLocation", "vertexAuthSource"]
      );
      await assert.rejects(
        live().applyRoutePatch({ azureApiVersion: "2025-01-01" }),
        /not a route setting/,
        "the API version keeps the host"
      );
      await assert.rejects(live().applyRoutePatch({ azureApiKey: "x" }), /secret/);
    }
  );

  await t.test(
    "change-driving: an enterprise write rejection leaves the previous renderer tuple and localStorage untouched",
    async () => {
      reset({ azureEndpoint: "https://east.openai.azure.com/openai" });
      storage.setItem("azureEndpoint", "https://east.openai.azure.com/openai");
      const before = { ...live() };
      const previous = globalThis.window.electronAPI;
      globalThis.window.electronAPI = {
        saveEnterpriseRoutePatch: async () => {
          throw new Error("disk unavailable");
        },
      };
      try {
        await assert.rejects(
          live().applyRoutePatch({ azureEndpoint: "https://west.openai.azure.com/openai" }),
          /disk unavailable/
        );
      } finally {
        globalThis.window.electronAPI = previous;
      }
      assert.equal(live().azureEndpoint, before.azureEndpoint);
      assert.equal(storage.getItem("azureEndpoint"), "https://east.openai.azure.com/openai");
    }
  );

  await t.test(
    "change-driving: a conflict refresh fences an older pending first-read snapshot",
    async (t) => {
      // Use a fresh module graph so Task 3's one-time getter read is genuinely pending.
      const isolated = await createRendererServer(t, {
        cachePrefix: "loqui-enterprise-conflict-startup-race-",
      });
      const { useSettingsStore: isolatedStore } = await isolated.ssrLoadModule(
        "/stores/settingsStore.ts"
      );
      const { loadRouteFacts } = await isolated.ssrLoadModule("/stores/routeFactsStore.ts");
      const { enterpriseLocalWriteCount } = await isolated.ssrLoadModule(
        "/stores/settingsStore.ts"
      );
      const stale = {
        bedrockRegion: "us-east-1",
        azureEndpoint: "https://old.example.com/openai",
        vertexProject: "",
        vertexLocation: "us-central1",
        vertexAuthSource: "adc",
      };
      const canonical = {
        ...stale,
        azureEndpoint: "https://other-globalThis.window.example.com/openai",
      };
      isolatedStore.setState({ ...routeBaseState(), ...stale });
      let finishOldRead;
      const slowEndpoint = new Promise((resolve) => {
        finishOldRead = resolve;
      });
      const initialRead = loadRouteFacts(
        {
          getEnterpriseRouteState: async () => {
            await slowEndpoint;
            return {
              current: stale,
              version: 0,
              facts: {
                bedrockEndpoint: { set: false, host: null },
                bedrockProfile: false,
                vertexApiKeyEnv: false,
                vertexProjectEnv: false,
              },
            };
          },
        },
        ["enterprise"]
      );
      await new Promise((resolve) => setImmediate(resolve));

      const previous = globalThis.window.electronAPI;
      globalThis.window.electronAPI = {
        saveEnterpriseRoutePatch: async ({ expected }) => {
          assert.deepEqual(expected, stale);
          return { success: false, version: ++ackVersion, conflict: true, current: canonical };
        },
      };
      const writesBefore = enterpriseLocalWriteCount();
      try {
        await assert.rejects(
          isolatedStore
            .getState()
            .applyRoutePatch(
              { azureEndpoint: "https://attempt.example.com/openai" },
              { expectedEnterprise: stale }
            ),
          /changed/
        );
        assert.equal(
          enterpriseLocalWriteCount(),
          writesBefore + 1,
          "conflict refresh increments the startup-sync fence"
        );
        assert.equal(isolatedStore.getState().azureEndpoint, canonical.azureEndpoint);
        finishOldRead(stale.azureEndpoint);
        await initialRead;
        assert.equal(
          isolatedStore.getState().azureEndpoint,
          canonical.azureEndpoint,
          "the older initial read cannot roll back main's canonical tuple"
        );
      } finally {
        globalThis.window.electronAPI = previous;
      }
    }
  );

  // Change-driving (R2-1): the region's model rewrite lived only in EnterpriseProviderConfig.tsx:115-118.
  await t.test(
    "change-driving: planEnterpriseCoupling rewrites every Bedrock scope's own geo-scoped model, and nothing else",
    () => {
      const state = {
        ...routeBaseState(),
        bedrockRegion: "us-east-1",
        chatAgentMode: "enterprise",
        chatAgentProvider: "bedrock",
        chatAgentModel: "us.anthropic.claude-fable-5",
        noteFormattingMode: "enterprise",
        noteFormattingProvider: "bedrock",
        noteFormattingModel: "anthropic.claude-3-haiku", // on-demand id: valid in any region
        dictationAgentMode: "enterprise",
        dictationAgentProvider: "bedrock",
        dictationAgentModel: "us.anthropic.claude-fable-5",
        dictationAgentVisionProvider: "", // inherits the assistant, which is adjusted itself
        dictationAgentVisionModel: "",
        translationMode: "providers",
        translationProvider: "openai",
        translationModel: "gpt-6-astra",
      };
      assert.deepEqual(plans.planEnterpriseCoupling(state, { bedrockRegion: "eu-west-1" }), {
        chatAgentModel: "eu.anthropic.claude-fable-5",
        dictationAgentModel: "eu.anthropic.claude-fable-5",
      });
      assert.deepEqual(
        plans.planEnterpriseCoupling(state, { azureEndpoint: "https://x.example.com" }),
        {},
        "only the region couples"
      );
      assert.deepEqual(
        plans.planEnterpriseCoupling(state, {
          bedrockRegion: "eu-west-1",
          chatAgentModel: "us.anthropic.claude-fable-5",
        }),
        { dictationAgentModel: "eu.anthropic.claude-fable-5" },
        "a model the same patch writes is kept verbatim, so a re-planned Undo patch adds nothing"
      );
      assert.deepEqual(
        plans.planEnterpriseCoupling(state, { bedrockRegion: "us-west-2" }),
        {},
        "same geography"
      );
      assert.deepEqual(
        plans.planEnterpriseCoupling(
          { ...state, chatAgentModel: "eu.anthropic.claude-fable-5" },
          { bedrockRegion: "us-east-1" }
        ),
        {},
        "re-typing the current region writes nothing"
      );
    }
  );

  // Change-driving (I1 follow-up): the preference lived only in the toggle's useLocalStorage.
  await t.test(
    "change-driving: a web-search patch writes the localStorage preference and announces it",
    async () => {
      reset();
      events.length = 0;
      let notifications = 0;
      const unsubscribe = useSettingsStore.subscribe(() => notifications++);
      await live().applyRoutePatch({ "providerSearch:chatIntelligence": true });
      unsubscribe();
      assert.equal(storage.getItem("personalWebSearch:chatIntelligence"), "true");
      assert.deepEqual(events, ["loqui-provider-search-changed"]);
      assert.equal(notifications, 0, "the preference is not a store field");
      assert.equal(plans.providerSearchScope("providerSearch:dictationAgent"), "dictationAgent");
      assert.equal(plans.providerSearchScope("chatAgentMode"), null);
      await assert.rejects(
        live().applyRoutePatch({ "providerSearch:noteFormatting": true }),
        /not a route setting/
      );
    }
  );
  await t.test(
    "change-driving: held enterprise ACK serializes local patches, execution-time plans, cancellation and flush",
    async () => {
      reset();
      let finish;
      const api = globalThis.window.electronAPI;
      globalThis.window.electronAPI = {
        saveEnterpriseRoutePatch: (input) =>
          new Promise((resolve) => {
            finish = () =>
              resolve({
                success: true,
                version: ++ackVersion,
                current: { ...input.expected, ...input.patch },
              });
          }),
      };
      const first = live().applyRoutePatch({
        azureEndpoint: "https://queued.openai.azure.com/openai",
        cloudTranscriptionModel: "gpt-4o-transcribe",
      });
      const second = live().switchCloudTranscriptionProvider("dictation", "groq");
      let admitted = true;
      const rejected = live().applyRoutePatch(
        { chatAgentProvider: "anthropic" },
        { canCommit: () => admitted }
      );
      const rejectedCheck = assert.rejects(rejected, { code: "ROUTE_PATCH_SUPERSEDED" });
      admitted = false;
      assert.equal(live().cloudTranscriptionProvider, "openai");
      assert.equal(live().cloudTranscriptionModel, "gpt-4o-mini-transcribe");
      const { flushRoutePatchSaves } = await vite.ssrLoadModule("/stores/settingsStore.ts");
      let flushed = false;
      const flush = flushRoutePatchSaves().then(() => {
        flushed = true;
      });
      await Promise.resolve();
      assert.equal(flushed, false);
      finish();
      await Promise.all([first, second, rejectedCheck, flush]);
      assert.equal(live().cloudTranscriptionProvider, "groq");
      assert.equal(
        live().transcriptionModelByProvider["dictation:openai"],
        "gpt-4o-transcribe",
        "queued provider plan uses the committed queue-head model"
      );
      assert.equal(live().chatAgentProvider, "qwen", "superseded patch wrote nothing");
      globalThis.window.electronAPI = api;
    }
  );

  await t.test("change-driving: subscriber reentrancy cannot bypass the active patch", async () => {
    reset();
    let nested;
    const seen = [];
    const unsubscribe = useSettingsStore.subscribe((state) => {
      seen.push(state.cloudTranscriptionProvider);
      if (seen.length === 1)
        nested = state.applyRoutePatch({ cloudTranscriptionProvider: "deepgram" });
    });
    await live().applyRoutePatch({ cloudTranscriptionProvider: "groq" });
    await nested;
    unsubscribe();
    assert.deepEqual(seen, ["groq", "deepgram"]);
    assert.equal(storage.getItem("cloudTranscriptionProvider"), "deepgram");
  });
});
