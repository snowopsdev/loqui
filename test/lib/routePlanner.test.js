const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("./rendererTestHarness");
const {
  MIGRATED_STORAGE,
  QWEN,
  TEST_COPY,
  routeBaseState,
  testFacts,
} = require("./routeStateFixture");

let ackVersion = 0;

test("change-driving: route planner", async (t) => {
  const { storage } = installBrowserGlobals(t, {
    initialStorage: MIGRATED_STORAGE,
    window: {
      electronAPI: {
        saveEnterpriseRoutePatch: async ({ patch, expected }) => ({
          success: true,
          version: ++ackVersion,
          current: { ...expected, ...patch },
        }),
      },
    },
  });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-route-planner-test-" });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const routes = await vite.ssrLoadModule("/lib/routes.ts");
  const planner = await vite.ssrLoadModule("/lib/routePlanner.ts");
  const { ROUTE_PATCH_KEYS } = await vite.ssrLoadModule("/lib/providerSwitchPlans.ts");

  const live = () => useSettingsStore.getState();
  const reset = (overrides = {}) => {
    // The web-search preference lives in localStorage, outside the store.
    storage.setItem("personalWebSearch:chatIntelligence", "false");
    storage.setItem("personalWebSearch:dictationAgent", "false");
    useSettingsStore.setState({ ...routeBaseState(), ...overrides });
  };
  const ctx = (o = {}) => ({
    facts: testFacts(o.facts),
    copy: TEST_COPY,
    sealed: o.sealed ?? false,
  });
  const plan = (id, target, o) => planner.planRouteChange(live(), ctx(o), id, target);
  const resolveLive = () =>
    routes.resolveRoutes(routes.buildRouteSnapshot(live(), testFacts(), TEST_COPY, false));
  const routeKeys = () => Object.fromEntries(ROUTE_PATCH_KEYS.map((k) => [k, live()[k]]));
  const change = (p, id) => p.changes.find((c) => c.id === id);

  const OPENAI_CHAT = {
    chatAgentMode: "providers",
    chatAgentProvider: "openai",
    chatAgentModel: "gpt-6-astra",
  };

  // Change-driving (I5): v1 previewed a registry default while commit restored memory.
  await t.test(
    "change-driving: a remembered model is used, and an explicit model overrides memory",
    () => {
      reset({
        chatAgentMode: "providers",
        chatAgentProvider: "groq",
        chatAgentModel: "openai/gpt-oss-120b",
        reasoningModelByProvider: { "chatIntelligence:openai": "gpt-5.6-sol" },
      });
      const remembered = plan("chat", { mode: "providers", provider: "openai" });
      assert.equal(remembered.patch.chatAgentModel, "gpt-5.6-sol");
      assert.equal(
        remembered.patch.reasoningModelByProvider["chatIntelligence:groq"],
        "openai/gpt-oss-120b"
      );
      assert.equal(
        change(remembered, "chat").after.model,
        "GPT-5.6 Sol",
        "the preview shows the remembered model"
      );

      const explicit = plan("chat", {
        mode: "providers",
        provider: "openai",
        model: "gpt-5.6-terra",
      });
      assert.equal(explicit.patch.chatAgentModel, "gpt-5.6-terra");
      assert.equal(change(explicit, "chat").after.model, "GPT-5.6 Terra");

      reset({
        transcriptionMode: "providers",
        useLocalWhisper: false,
        transcriptionModelByProvider: { "dictation:groq": "whisper-large-v3-turbo" },
      });
      const stt = plan("dictationStt", { mode: "providers", provider: "groq" });
      assert.equal(stt.patch.cloudTranscriptionModel, "whisper-large-v3-turbo");
      assert.equal(
        stt.patch.transcriptionModelByProvider["dictation:openai"],
        "gpt-4o-mini-transcribe"
      );
    }
  );

  // Change-driving (I5): v1's upload writer dropped target.model and could re-point dictation's server.
  await t.test(
    "change-driving: upload writes its own model and never the shared dictation server",
    () => {
      reset({ remoteTranscriptionUrl: "http://192.168.1.5:8178" });
      const cloud = plan("uploadStt", {
        mode: "providers",
        provider: "groq",
        model: "whisper-large-v3-turbo",
      });
      assert.equal(cloud.patch.uploadTranscriptionMode, "providers");
      assert.equal(cloud.patch.uploadUseLocalWhisper, false);
      assert.equal(cloud.patch.uploadCloudTranscriptionMode, "byok");
      assert.equal(cloud.patch.uploadCloudTranscriptionProvider, "groq");
      assert.equal(cloud.patch.uploadCloudTranscriptionModel, "whisper-large-v3-turbo");
      assert.equal("cloudTranscriptionProvider" in cloud.patch, false);

      const server = plan("uploadStt", {
        mode: "self-hosted",
        remoteUrl: "http://elsewhere.example:1",
      });
      assert.equal(server.patch.uploadTranscriptionMode, "self-hosted");
      assert.equal("remoteTranscriptionUrl" in server.patch, false);
      assert.equal("remoteTranscriptionModel" in server.patch, false);
    }
  );

  // Change-driving (I5): v1 kept gpt-4o on a self-hosted preview and reported it ready.
  await t.test("change-driving: a mode change clears what the new mode cannot use", () => {
    reset(OPENAI_CHAT);
    const server = plan("chat", { mode: "self-hosted", remoteUrl: "http://192.168.1.20:11434/v1" });
    assert.equal(server.patch.chatAgentMode, "self-hosted");
    assert.equal(server.patch.chatAgentRemoteUrl, "http://192.168.1.20:11434/v1");
    assert.equal(server.patch.chatAgentModel, "", "a cloud model id means nothing to your server");
    const named = plan("chat", {
      mode: "self-hosted",
      remoteUrl: "http://192.168.1.20:11434/v1",
      model: "llama3",
    });
    assert.equal(named.patch.chatAgentModel, "llama3");

    const local = plan("chat", { mode: "local" });
    assert.equal(
      local.patch.chatAgentProvider,
      "",
      "openai is not a local provider (ModelRegistry.ts:272)"
    );
    assert.equal(local.patch.chatAgentModel, "");

    reset();
    assert.equal(
      plan("chat", { mode: "self-hosted", remoteUrl: "http://192.168.1.20:11434/v1" }).patch
        .chatAgentModel,
      ""
    );
    const groq = plan("chat", { mode: "providers", provider: "groq" });
    assert.equal(groq.patch.chatAgentMode, "providers");
    assert.equal(groq.patch.chatAgentModel, "openai/gpt-oss-120b");
    assert.equal(
      plan("chat", { mode: "providers", provider: "bedrock" }).patch.chatAgentMode,
      "enterprise"
    );
  });

  // Change-driving (I5): v1's local target carried no provider/model, so Undo cleared a working local setup.
  await t.test(
    "change-driving: local → remote → Undo restores the local selection exactly",
    async () => {
      const cases = [
        ["chat", { mode: "providers", provider: "openai" }],
        ["dictationStt", { mode: "providers", provider: "openai" }],
        ["noteRecordingStt", { mode: "providers", provider: "deepgram" }],
        ["translation", { mode: "self-hosted", remoteUrl: "http://192.168.1.20:11434/v1" }],
      ];
      for (const [id, target] of cases) {
        reset({ whisperModel: "small", chatAgentModel: "qwen3.5-9b-q4_k_m" });
        const before = routeKeys();
        const forward = plan(id, target);
        await live().applyRoutePatch(forward.patch);
        assert.notDeepEqual(routeKeys(), before, `${id}: moved`);
        const back = planner.planPatch(live(), ctx(), id, forward.undoPatch);
        assert.equal(back.kind, "instant", `${id}: moving back to this device is instant`);
        await live().applyRoutePatch(forward.undoPatch);
        assert.deepEqual(routeKeys(), before, `${id}: every key restored`);
      }
    }
  );

  // Change-driving (I6): v1 resolved only the selected route.
  await t.test(
    "change-driving: routes that inherit dictation are listed as coupled changes",
    () => {
      reset({
        transcriptionMode: "providers",
        useLocalWhisper: false,
        meetingTranscriptionMode: "providers",
        meetingUseLocalWhisper: false,
        uploadTranscriptionMode: "providers",
        uploadUseLocalWhisper: false,
      });
      const p = plan("dictationStt", { mode: "providers", provider: "groq" });
      assert.deepEqual(p.changes.map((c) => [c.id, c.coupled]).sort(), [
        ["dictationStt", false],
        ["noteRecordingStt", true],
        ["uploadStt", true],
      ]);
      assert.equal(p.changes[0].id, "dictationStt", "the requested route comes first");
      assert.equal(change(p, "uploadStt").after.providerId, "groq");
      assert.equal(p.kind, "staged");

      const meeting = plan("noteRecordingStt", { mode: "providers", provider: "deepgram" });
      assert.equal(meeting.patch.meetingCloudTranscriptionProvider, "deepgram");
      assert.equal(
        meeting.undoPatch.meetingCloudTranscriptionProvider,
        "",
        "Undo restores the inheritance blank"
      );
      assert.equal(meeting.undoPatch.meetingCloudTranscriptionModel, "");

      reset({
        dictationAgentMode: "providers",
        dictationAgentProvider: "openai",
        dictationAgentModel: "gpt-6-astra",
      });
      const assistant = plan("voiceAssistant", { mode: "providers", provider: "anthropic" });
      const vision = change(assistant, "assistantVision");
      assert.ok(vision, "vision follows the assistant while the override is off");
      assert.equal(vision.coupled, true);
      assert.equal(vision.after.providerId, "anthropic");
    }
  );

  // Change-driving (I5): v1's vision preview turned screen context on and wrote mode; its writer did neither.
  await t.test(
    "change-driving: a vision target sets the override and the vision provider only",
    () => {
      reset({
        voiceAgentScreenContext: false,
        dictationAgentMode: "providers",
        dictationAgentProvider: "openai",
        dictationAgentModel: "gpt-6-astra",
      });
      const bedrock = plan("assistantVision", { mode: "providers", provider: "bedrock" });
      assert.equal(bedrock.patch.useDictationAgentVisionModel, true);
      assert.equal(bedrock.patch.dictationAgentVisionProvider, "bedrock");
      assert.equal(bedrock.patch.dictationAgentVisionModel, "us.anthropic.claude-fable-5");
      assert.equal("voiceAgentScreenContext" in bedrock.patch, false);
      assert.equal("dictationAgentVisionMode" in bedrock.patch, false);
      assert.equal(bedrock.undoPatch.useDictationAgentVisionModel, false);
      assert.equal(bedrock.undoPatch.dictationAgentVisionProvider, "");

      const visionTarget = {
        mode: "providers",
        provider: "custom",
        baseUrl: "https://vision.example.com/v1",
        model: "llava-next",
      };
      const custom = plan("assistantVision", visionTarget);
      assert.equal(custom.patch.dictationAgentVisionCloudBaseUrl, "https://vision.example.com/v1");
      assert.equal(custom.patch.dictationAgentVisionModel, "llava-next");
      assert.equal(change(custom, "assistantVision").after.state.status, "off");
      assert.equal(
        custom.kind,
        "instant",
        "screen context is off, so the vision route sends nothing yet"
      );

      const same = plan("assistantVision", { mode: "providers", provider: "openai" });
      assert.equal(
        same.patch.dictationAgentVisionModel,
        "gpt-6-astra",
        "an inherited model is written so the override counts as chosen"
      );

      reset({
        dictationAgentMode: "providers",
        dictationAgentProvider: "openai",
        dictationAgentModel: "gpt-6-astra",
      });
      assert.equal(
        plan("assistantVision", visionTarget).kind,
        "staged",
        "with screen context on, screenshots go to a new endpoint"
      );
      assert.throws(() => plan("assistantVision", { mode: "local" }), /provider/);
      assert.throws(() => plan("speakerId", { mode: "local" }), /device/);
    }
  );

  // Change-driving (I1): v1 staged by target.mode, not by where data goes.
  await t.test("change-driving: kind follows the effective recipient and payload", () => {
    reset();
    assert.equal(
      plan("chat", {
        mode: "providers",
        provider: "custom",
        baseUrl: "http://localhost:1234/v1",
        model: "m",
      }).kind,
      "instant",
      "loopback endpoint"
    );
    assert.equal(
      plan("chat", { mode: "self-hosted", remoteUrl: "http://127.0.0.1:11434/v1", model: "llama3" })
        .kind,
      "instant",
      "loopback server"
    );
    assert.equal(
      plan("dictationStt", { mode: "providers", provider: "groq" }).kind,
      "staged",
      "device → provider"
    );
    const noop = plan("chat", { mode: "local" });
    assert.equal(noop.kind, "noop");
    assert.deepEqual(noop.patch, {});
    assert.deepEqual(noop.changes, []);

    reset({
      chatAgentMode: "providers",
      chatAgentProvider: "custom",
      chatAgentModel: "m",
      chatAgentCloudBaseUrl: "http://localhost:1234/v1",
    });
    assert.equal(
      plan("chat", { mode: "providers", provider: "custom", baseUrl: "https://llm.example.com/v1" })
        .kind,
      "staged",
      "loopback → remote"
    );

    reset({
      translationMode: "self-hosted",
      translationRemoteUrl: "http://192.168.1.20:11434/v1",
      translationModel: "llama3",
    });
    assert.equal(
      plan("translation", { mode: "self-hosted", remoteUrl: "http://192.168.1.30:11434/v1" }).kind,
      "staged",
      "another server"
    );

    reset(OPENAI_CHAT);
    assert.equal(
      plan("chat", { mode: "providers", provider: "openai", model: "gpt-5.6-sol" }).kind,
      "instant",
      "same provider, same payload"
    );
  });

  // Change-driving: blockers are computed over every changed off-device route.
  // R2-9 reversed two v2 exemptions: Codex/enterprise sign-in and the remote
  // model are chosen in the staged editor before Apply, so both now block.
  await t.test("change-driving: blockers", () => {
    reset();
    const noOpenAiKey = { facts: { credentials: new Map([["openai", false]]) } };
    assert.equal(
      plan("dictationStt", { mode: "providers", provider: "openai" }, noOpenAiKey).blocker,
      "needsKey"
    );
    assert.equal(
      plan("chat", { mode: "providers", provider: "codex" }).blocker,
      "needsKey",
      "R2-9: Codex signs in before Apply"
    );
    assert.equal(
      plan("chat", { mode: "providers", provider: "bedrock" }).blocker,
      "needsKey",
      "R2-9: no enterprise exemption"
    );
    assert.equal(plan("chat", { mode: "providers", provider: "" }).blocker, "chooseProvider");
    assert.equal(
      plan("chat", { mode: "self-hosted", remoteUrl: "", model: "llama3" }).blocker,
      "needsUrl"
    );
    assert.equal(
      plan("dictationStt", { mode: "providers", provider: "groq" }, { sealed: true }).blocker,
      "sealed"
    );
    assert.equal(
      plan(
        "dictationStt",
        { mode: "providers", provider: "groq" },
        { facts: { credentials: null } }
      ).blocker,
      "unknown"
    );
    assert.equal(
      plan("chat", { mode: "providers", provider: "openai", model: "" }).blocker,
      "needsModel",
      "R2-9: the model is chosen before Apply"
    );
    const azureNoEndpoint = plan(
      "chat",
      { mode: "providers", provider: "azure", model: "gpt-4o-deploy" },
      {
        facts: { credentials: new Map([["azure", true]]) },
      }
    );
    assert.equal(
      azureNoEndpoint.blocker,
      "needsUrl",
      "R2-1: a saved Azure key without an endpoint cannot apply"
    );
    assert.equal(
      plan("chat", { mode: "providers", provider: "openai" }).blocker,
      null,
      "ready routes never block"
    );
    reset(OPENAI_CHAT);
    const home = plan("chat", { mode: "local" }, { sealed: true });
    assert.equal(home.blocker, null, "moving onto the device is never blocked");
    assert.equal(home.kind, "instant");
  });

  await t.test("change-driving: planPatch refuses keys outside the route settings", () => {
    reset();
    assert.throws(
      () => planner.planPatch(live(), ctx(), "chat", { openaiApiKey: "sk-x" }),
      /cannot write/
    );
    assert.throws(
      () => planner.planPatch(live(), ctx(), "chat", { azureApiVersion: "2025-01-01" }),
      /cannot write/
    );
  });

  // R2-1: the enterprise fields were direct setter writes (EnterpriseProviderConfig.tsx:114-118,
  // 145-148,166-174) that settingsStore.ts:2060-2063 persisted to main at once.
  const AZURE = { mode: "enterprise", provider: "azure", model: "gpt-4o-deploy" };
  const azureScope = (prefix) => ({
    [`${prefix}Mode`]: AZURE.mode,
    [`${prefix}Provider`]: AZURE.provider,
    [`${prefix}Model`]: AZURE.model,
  });
  const azureKey = {
    facts: {
      credentials: new Map([["azure", true]]),
      credentialFields: new Map([["azure", { key: true }]]),
    },
  };

  // Change-driving (R2-1): v2's allowlist refused azureEndpoint and the graph gave Azure no host.
  await t.test(
    "change-driving: an Azure endpoint change on the active route is an off-device recipient change: it stages",
    async () => {
      reset({ ...azureScope("chatAgent"), azureEndpoint: "https://myres.openai.azure.com/openai" });
      const p = planner.planPatch(live(), ctx(azureKey), "chat", {
        azureEndpoint: "https://other.example.com/openai",
      });
      assert.equal(p.kind, "staged");
      assert.deepEqual(
        p.changes.map((c) => c.id),
        ["chat"]
      );
      assert.equal(change(p, "chat").before.host, "myres.openai.azure.com");
      assert.equal(change(p, "chat").after.host, "other.example.com");
      assert.equal(p.blocker, null, "the new endpoint is valid and the key is saved");
      assert.deepEqual(p.patch, { azureEndpoint: "https://other.example.com/openai" });
      assert.deepEqual(p.undoPatch, { azureEndpoint: "https://myres.openai.azure.com/openai" });
      assert.equal(
        live().azureEndpoint,
        "https://myres.openai.azure.com/openai",
        "planning commits nothing"
      );

      const refused = planner.planPatch(live(), ctx(azureKey), "chat", {
        azureEndpoint: "http://myres.openai.azure.com/openai",
      });
      assert.equal(change(refused, "chat").after.host, null);
      assert.equal(refused.blocker, "needsUrl", "Apply waits for an endpoint the executor accepts");

      const samePlace = planner.planPatch(live(), ctx(azureKey), "chat", {
        azureEndpoint: "https://myres.openai.azure.com/openai/",
      });
      assert.equal(samePlace.kind, "instant", "a path-only edit keeps the recipient");
      assert.deepEqual(samePlace.changes, []);

      await live().applyRoutePatch(p.patch);
      assert.equal(
        resolveLive().find((r) => r.id === "chat").host,
        "other.example.com",
        "commit is the preview"
      );
      await live().applyRoutePatch(p.undoPatch);
      assert.equal(
        live().azureEndpoint,
        "https://myres.openai.azure.com/openai",
        "Undo restores the endpoint exactly"
      );

      reset({ azureEndpoint: "https://myres.openai.azure.com/openai" });
      const unused = planner.planPatch(live(), ctx(azureKey), "chat", {
        azureEndpoint: "https://other.example.com/openai",
      });
      assert.equal(unused.kind, "instant", "no route uses Azure, so nothing new is sent");
      assert.deepEqual(unused.changes, []);
    }
  );

  // Change-driving (R2-1 staging gap): until Task 3 has synced facts.enterpriseMain, or while
  // Vertex's key presence is still null, enterprise routes resolve `unknown` with host null on
  // both sides. The v2 planner compared null === null (and the fingerprints were equal), so an
  // endpoint, region or location edit was instant and committed without review.
  await t.test(
    "change-driving: an enterprise recipient edit stages while the graph cannot name the host",
    () => {
      const unsynced = { facts: { ...azureKey.facts, enterpriseMain: null } };
      reset({ ...azureScope("chatAgent"), azureEndpoint: "https://myres.openai.azure.com/openai" });
      const p = planner.planPatch(live(), ctx(unsynced), "chat", {
        azureEndpoint: "https://other.example.com/openai",
      });
      assert.equal(p.kind, "staged", "an unnamed recipient is never assumed to be the same one");
      assert.deepEqual(
        p.changes.map((c) => c.id),
        ["chat"]
      );
      assert.equal(change(p, "chat").before.host, null);
      assert.equal(change(p, "chat").after.host, null);
      assert.equal(change(p, "chat").after.state.status, "unknown");
      assert.equal(p.blocker, "unknown", "Apply waits until main's facts are synced");
      assert.deepEqual(p.patch, { azureEndpoint: "https://other.example.com/openai" });
      assert.deepEqual(p.undoPatch, { azureEndpoint: "https://myres.openai.azure.com/openai" });
      assert.equal(
        live().azureEndpoint,
        "https://myres.openai.azure.com/openai",
        "planning commits nothing"
      );

      // A Bedrock region edit, with its coupled model rewrite, stages too.
      reset({
        bedrockRegion: "us-east-1",
        chatAgentMode: "enterprise",
        chatAgentProvider: "bedrock",
        chatAgentModel: "us.anthropic.claude-fable-5",
      });
      const region = planner.planPatch(
        live(),
        ctx({ facts: { credentials: new Map([["bedrock", true]]), enterpriseMain: null } }),
        "chat",
        { bedrockRegion: "eu-west-1" }
      );
      assert.equal(region.kind, "staged");
      assert.equal(region.blocker, "unknown");
      assert.deepEqual(region.patch, {
        bedrockRegion: "eu-west-1",
        chatAgentModel: "eu.anthropic.claude-fable-5",
      });

      // Baseline guards: what was instant stays instant while the facts load.
      reset({ azureEndpoint: "https://myres.openai.azure.com/openai" });
      const unused = planner.planPatch(live(), ctx(unsynced), "chat", {
        azureEndpoint: "https://other.example.com/openai",
      });
      assert.equal(
        unused.kind,
        "instant",
        "no route uses Azure, so nothing is sent whatever the facts"
      );
      assert.deepEqual(unused.changes, []);
      reset(OPENAI_CHAT);
      assert.equal(
        plan(
          "chat",
          { mode: "providers", provider: "openai", model: "gpt-5.6-sol" },
          { facts: { enterpriseMain: null } }
        ).kind,
        "instant",
        "a model change at the same provider and host does not wait for enterprise facts"
      );
      reset({ ...azureScope("chatAgent"), azureEndpoint: "https://myres.openai.azure.com/openai" });
      assert.equal(
        plan("chat", { mode: "local" }, unsynced).kind,
        "instant",
        "moving onto the device is instant"
      );
    }
  );

  // R3-1: Vertex's persisted source determines its host; key presence only changes readiness.
  await t.test(
    "change-driving: an ADC Vertex location edit stages without waiting for key presence",
    () => {
      const vertex = {
        chatAgentMode: "enterprise",
        chatAgentProvider: "vertex",
        chatAgentModel: "gemini-2.5-flash",
        vertexProject: "acme-prod",
        vertexLocation: "us-central1",
        vertexAuthSource: "adc",
      };
      reset(vertex);
      const loading = {
        facts: {
          credentials: new Map([["vertex", false]]),
          credentialFields: new Map([["vertex", { key: false }]]),
        },
      };
      const p = planner.planPatch(live(), ctx(loading), "chat", { vertexLocation: "europe-west4" });
      assert.equal(p.kind, "staged");
      assert.equal(change(p, "chat").before.host, "us-central1-aiplatform.googleapis.com");
      assert.equal(change(p, "chat").after.host, "europe-west4-aiplatform.googleapis.com");
      assert.deepEqual(
        change(p, "chat").after.state,
        { status: "ready" },
        "ADC does not wait for key listing"
      );
      assert.equal(p.blocker, null);
      const unknown = planner.planPatch(
        live(),
        ctx({ facts: { credentials: null, credentialFields: null } }),
        "chat",
        { vertexLocation: "europe-west4" }
      );
      assert.equal(unknown.kind, "staged");
      assert.equal(
        unknown.blocker,
        "unknown",
        "unreadable durable storage remains fail-closed for ADC"
      );
      const project = planner.planPatch(live(), ctx(loading), "chat", {
        vertexProject: "acme-staging",
      });
      assert.equal(project.kind, "staged", "the project names the recipient account");
    }
  );

  await t.test(
    "change-driving: Vertex source edits stage across coupled active routes and Apply/Undo use that exact source",
    async () => {
      reset({
        chatAgentMode: "enterprise",
        chatAgentProvider: "vertex",
        chatAgentModel: "gemini-2.5-flash",
        noteFormattingMode: "enterprise",
        noteFormattingProvider: "vertex",
        noteFormattingModel: "gemini-2.5-flash",
        vertexProject: "acme-prod",
        vertexLocation: "europe-west4",
        vertexAuthSource: "adc",
      });
      const readyKey = {
        facts: {
          credentials: new Map([["vertex", true]]),
          credentialFields: new Map([["vertex", { key: true }]]),
        },
      };
      const p = planner.planPatch(live(), ctx(readyKey), "chat", { vertexAuthSource: "apiKey" });
      assert.equal(p.kind, "staged");
      assert.deepEqual(
        p.changes.map((c) => c.id),
        ["chat", "noteFormatting"]
      );
      for (const c of p.changes) {
        assert.equal(c.before.host, "europe-west4-aiplatform.googleapis.com", c.id);
        assert.equal(c.after.host, "aiplatform.googleapis.com", c.id);
        assert.deepEqual(c.after.state, { status: "ready" }, c.id);
      }
      assert.equal(p.blocker, null);
      assert.deepEqual(p.patch, { vertexAuthSource: "apiKey" });
      assert.deepEqual(p.undoPatch, { vertexAuthSource: "adc" });
      assert.equal(live().vertexAuthSource, "adc", "planning leaves main/store unchanged");
      await live().applyRoutePatch(p.patch);
      assert.equal(
        resolveLive().find((r) => r.id === "chat").host,
        "aiplatform.googleapis.com",
        "Apply commits the previewed recipient"
      );
      await live().applyRoutePatch(p.undoPatch);
      assert.equal(live().vertexAuthSource, "adc", "Undo restores the committed source");
      assert.equal(
        resolveLive().find((r) => r.id === "chat").host,
        "europe-west4-aiplatform.googleapis.com"
      );
    }
  );

  await t.test(
    "change-driving B2: same-host Vertex source and project edits include every active route with exact Undo",
    async () => {
      const ready = {
        facts: {
          credentials: new Map([["vertex", true]]),
          credentialFields: new Map([["vertex", { key: true }]]),
        },
      };
      for (const source of ["adc", "apiKey"]) {
        reset({
          chatAgentMode: "enterprise",
          chatAgentProvider: "vertex",
          chatAgentModel: "gemini-2.5-flash",
          dictationAgentMode: "enterprise",
          dictationAgentProvider: "vertex",
          dictationAgentModel: "gemini-2.5-flash",
          noteFormattingMode: "enterprise",
          noteFormattingProvider: "vertex",
          noteFormattingModel: "gemini-2.5-flash",
          vertexProject: "acme-prod",
          vertexLocation: "global",
          vertexAuthSource: source,
        });
        for (const patch of [
          { vertexAuthSource: source === "adc" ? "apiKey" : "adc" },
          { vertexProject: "acme-staging" },
        ]) {
          const before = routeKeys();
          const p = planner.planPatch(live(), ctx(ready), "chat", patch);
          assert.equal(p.kind, "staged");
          assert.deepEqual(p.changes.map((c) => c.id).sort(), [
            "assistantVision",
            "chat",
            "noteFormatting",
            "voiceAssistant",
          ]);
          for (const c of p.changes) assert.equal(c.before.host, c.after.host, c.id);
          assert.deepEqual(
            p.undoPatch,
            Object.fromEntries(Object.keys(patch).map((k) => [k, before[k]]))
          );
          await live().applyRoutePatch(p.patch);
          await live().applyRoutePatch(p.undoPatch);
          assert.deepEqual(routeKeys(), before);
        }
      }
      reset();
      assert.equal(
        planner.planPatch(live(), ctx(ready), "chat", { vertexProject: "unused" }).kind,
        "instant"
      );
    }
  );

  await t.test(
    "change-driving B2: Corti tenant path edits stage all inheriting speech routes and Undo raw values",
    async () => {
      reset({
        transcriptionMode: "providers",
        useLocalWhisper: false,
        cloudTranscriptionProvider: "corti",
        cloudTranscriptionModel: "corti-transcribe",
        meetingTranscriptionMode: "providers",
        meetingUseLocalWhisper: false,
        uploadTranscriptionMode: "providers",
        uploadUseLocalWhisper: false,
      });
      const c = ctx({ facts: { credentials: new Map([["corti:speech", true]]) } });
      const before = routeKeys();
      const p = planner.planPatch(live(), c, "dictationStt", { cortiTenant: "other-tenant" });
      assert.equal(p.kind, "staged");
      assert.deepEqual(
        p.changes.map((c) => c.id),
        ["dictationStt", "noteRecordingStt", "uploadStt"]
      );
      for (const change of p.changes) assert.equal(change.before.host, change.after.host);
      assert.deepEqual(p.undoPatch, { cortiTenant: "base" });
      await live().applyRoutePatch(p.patch);
      await live().applyRoutePatch(p.undoPatch);
      assert.deepEqual(routeKeys(), before);
      reset({
        chatAgentMode: "providers",
        chatAgentProvider: "corti",
        chatAgentModel: "corti-chat",
      });
      assert.equal(
        planner.planPatch(live(), c, "chat", { cortiTenant: "unused-speech" }).kind,
        "instant"
      );
    }
  );

  // Change-driving (I6 for R2-1): one enterprise field moves every route on that provider.
  await t.test(
    "change-driving: coupled-route review lists every route an enterprise field moves",
    () => {
      reset({
        ...azureScope("chatAgent"),
        ...azureScope("noteFormatting"),
        ...azureScope("dictationAgent"),
        cleanupMode: "providers",
        cleanupProvider: "openai",
        cleanupModel: "gpt-6-astra",
        azureEndpoint: "https://myres.openai.azure.com/openai",
      });
      const p = planner.planPatch(live(), ctx(azureKey), "chat", {
        azureEndpoint: "https://other.example.com/openai",
      });
      assert.deepEqual(
        p.changes.map((c) => [c.id, c.coupled]).sort(),
        [
          ["assistantVision", true],
          ["chat", false],
          ["noteFormatting", true],
          ["voiceAssistant", true],
        ],
        "vision follows the assistant; cleanup on OpenAI is untouched"
      );
      assert.equal(p.changes[0].id, "chat", "the requested route comes first");
      for (const c of p.changes) assert.equal(c.after.host, "other.example.com", c.id);
      assert.equal(p.kind, "staged");
    }
  );

  // Change-driving (R2-1): the region's model rewrite lived only in EnterpriseProviderConfig.tsx:115-118.
  await t.test(
    "change-driving: a Bedrock region change adds the model adjustment to the same patch, and Undo is exact",
    async () => {
      const bedrockKey = { facts: { credentials: new Map([["bedrock", true]]) } };
      reset({
        bedrockRegion: "us-east-1",
        chatAgentMode: "enterprise",
        chatAgentProvider: "bedrock",
        chatAgentModel: "us.anthropic.claude-fable-5",
        noteFormattingMode: "enterprise",
        noteFormattingProvider: "bedrock",
        noteFormattingModel: "anthropic.claude-3-haiku", // on-demand id: valid in every region
      });
      const before = routeKeys();
      const p = planner.planPatch(live(), ctx(bedrockKey), "chat", { bedrockRegion: "eu-west-1" });
      assert.deepEqual(p.patch, {
        bedrockRegion: "eu-west-1",
        chatAgentModel: "eu.anthropic.claude-fable-5",
      });
      assert.deepEqual(p.undoPatch, {
        bedrockRegion: "us-east-1",
        chatAgentModel: "us.anthropic.claude-fable-5",
        noteFormattingModel: "anthropic.claude-3-haiku", // pinned: a re-planned Undo must not rewrite it
      });
      assert.equal(p.kind, "staged");
      const chat = change(p, "chat");
      assert.equal(chat.coupled, false);
      assert.equal(chat.before.host, "bedrock-runtime.us-east-1.amazonaws.com");
      assert.equal(chat.after.host, "bedrock-runtime.eu-west-1.amazonaws.com");
      assert.equal(
        chat.after.model,
        "eu.anthropic.claude-fable-5",
        "the preview shows the adjusted model"
      );
      assert.equal(
        change(p, "noteFormatting").coupled,
        true,
        "the other Bedrock route changes region too"
      );
      assert.equal(
        change(p, "noteFormatting").after.host,
        "bedrock-runtime.eu-west-1.amazonaws.com"
      );

      await live().applyRoutePatch(p.patch);
      assert.equal(live().chatAgentModel, "eu.anthropic.claude-fable-5");
      // Task 7's Undo re-plans the undoPatch against the live state.
      const back = planner.planPatch(live(), ctx(bedrockKey), "chat", p.undoPatch);
      assert.deepEqual(back.patch, {
        bedrockRegion: "us-east-1",
        chatAgentModel: "us.anthropic.claude-fable-5",
      });
      await live().applyRoutePatch(back.patch);
      assert.deepEqual(routeKeys(), before, "every key restored");

      // A profile id that never matched its region is restored too, not "fixed" by the Undo.
      reset({
        bedrockRegion: "us-east-1",
        chatAgentMode: "enterprise",
        chatAgentProvider: "bedrock",
        chatAgentModel: "eu.anthropic.claude-fable-5",
      });
      const mismatched = routeKeys();
      const forward = planner.planPatch(live(), ctx(bedrockKey), "chat", {
        bedrockRegion: "eu-west-1",
      });
      assert.deepEqual(forward.patch, { bedrockRegion: "eu-west-1" }, "already an eu.* id");
      await live().applyRoutePatch(forward.patch);
      await live().applyRoutePatch(
        planner.planPatch(live(), ctx(bedrockKey), "chat", forward.undoPatch).patch
      );
      assert.deepEqual(routeKeys(), mismatched);

      // Switching to Bedrock picks the profile id for the region the state holds.
      reset({ bedrockRegion: "eu-west-1" });
      assert.equal(
        plan("chat", { mode: "providers", provider: "bedrock" }, bedrockKey).patch.chatAgentModel,
        "eu.anthropic.claude-fable-5"
      );
    }
  );

  // Change-driving (I1 follow-up): v1's allowlist refused the enable switches,
  // so the editors wrote them directly and turning a cloud route on sent data unreviewed.
  await t.test(
    "change-driving: enable switches: turning an off-device route on stages; turning it off is instant",
    () => {
      const cases = [
        [
          "useCleanupModel",
          "dictationCleanup",
          { cleanupMode: "providers", cleanupProvider: "openai", cleanupModel: "gpt-6-astra" },
        ],
        [
          "useDictationTranslation",
          "translation",
          {
            translationMode: "providers",
            translationProvider: "openai",
            translationModel: "gpt-6-astra",
          },
        ],
      ];
      for (const [key, id, cloud] of cases) {
        reset({ ...cloud, [key]: false });
        const on = planner.planPatch(live(), ctx(), id, { [key]: true });
        assert.equal(on.kind, "staged", `${key}: on sends to OpenAI`);
        assert.deepEqual(
          on.changes.map((c) => c.id),
          [id]
        );
        assert.equal(change(on, id).before.state.status, "off");
        assert.equal(change(on, id).after.providerId, "openai");
        assert.deepEqual(on.undoPatch, { [key]: false });
        assert.equal(on.blocker, null);
        const noKey = planner.planPatch(
          live(),
          ctx({ facts: { credentials: new Map([["openai", false]]) } }),
          id,
          { [key]: true }
        );
        assert.equal(noKey.blocker, "needsKey", `${key}: Apply waits for the key`);

        reset(cloud);
        const off = planner.planPatch(live(), ctx(), id, { [key]: false });
        assert.equal(off.kind, "instant", `${key}: off sends nothing`);
        assert.equal(change(off, id).after.state.status, "off");

        reset({ [key]: false });
        assert.equal(
          planner.planPatch(live(), ctx(), id, { [key]: true }).kind,
          "instant",
          `${key}: an on-device route turns on at once`
        );
        assert.equal(planner.planPatch(live(), ctx(), id, { [key]: false }).kind, "noop");
      }
    }
  );

  // Change-driving (I1 follow-up): the assistant's switches change who receives screenshots.
  await t.test(
    "change-driving: assistant switches: screen context adds the screenshot; the vision override moves it",
    async () => {
      const cloudAssistant = {
        dictationAgentMode: "providers",
        dictationAgentProvider: "openai",
        dictationAgentModel: "gpt-6-astra",
      };
      reset({ ...cloudAssistant, voiceAgentScreenContext: false });
      const screen = planner.planPatch(live(), ctx(), "voiceAssistant", {
        voiceAgentScreenContext: true,
      });
      assert.equal(screen.kind, "staged");
      assert.doesNotMatch(change(screen, "voiceAssistant").before.sends, /<screenshot>/);
      assert.match(change(screen, "voiceAssistant").after.sends, /<screenshot>/);
      assert.equal(
        change(screen, "assistantVision").coupled,
        true,
        "the vision route turns on with it"
      );

      reset({ ...cloudAssistant, useDictationAgent: false });
      assert.equal(
        planner.planPatch(live(), ctx(), "voiceAssistant", { useDictationAgent: true }).kind,
        "staged"
      );
      reset(cloudAssistant);
      const off = planner.planPatch(live(), ctx(), "voiceAssistant", { useDictationAgent: false });
      assert.equal(off.kind, "instant");
      assert.deepEqual(
        off.changes.map((c) => [c.id, c.after.state.status]),
        [
          ["voiceAssistant", "off"],
          ["assistantVision", "off"],
        ]
      );

      // The override is not an off switch: either direction can hand screenshots to another provider.
      reset({
        ...cloudAssistant,
        dictationAgentVisionProvider: "anthropic",
        dictationAgentVisionModel: "claude-fable-5-1",
      });
      const override = planner.planPatch(live(), ctx(), "assistantVision", {
        useDictationAgentVisionModel: true,
      });
      assert.equal(override.kind, "staged", "screenshots move to Anthropic");
      assert.equal(change(override, "assistantVision").after.providerId, "anthropic");
      await live().applyRoutePatch(override.patch);
      const follow = planner.planPatch(live(), ctx(), "assistantVision", {
        useDictationAgentVisionModel: false,
      });
      assert.equal(
        follow.kind,
        "staged",
        "following the assistant again sends screenshots to OpenAI"
      );
      assert.equal(change(follow, "assistantVision").after.providerId, "openai");
    }
  );

  // Change-driving (I1 follow-up): v1 had no Corti host input, so a region switch changed the recipient silently.
  await t.test(
    "change-driving: the Corti region picks the receiving host, so switching it stages",
    () => {
      const corti = {
        transcriptionMode: "providers",
        useLocalWhisper: false,
        cloudTranscriptionProvider: "corti",
        cloudTranscriptionModel: "corti-transcribe",
      };
      const cortiKeys = { facts: { credentials: new Map([["corti:speech", true]]) } };
      reset(corti);
      const eu = planner.planPatch(live(), ctx(cortiKeys), "dictationStt", {
        cortiEnvironment: "eu",
      });
      assert.equal(eu.kind, "staged");
      assert.equal(change(eu, "dictationStt").before.host, "api.us.corti.app");
      assert.equal(change(eu, "dictationStt").after.host, "api.eu.corti.app");
      assert.deepEqual(eu.undoPatch, { cortiEnvironment: "us" });

      const tenant = planner.planPatch(live(), ctx(cortiKeys), "dictationStt", {
        cortiTenant: "acme",
      });
      assert.equal(tenant.kind, "staged", "the tenant changes the authentication recipient path");
      assert.deepEqual(
        tenant.changes.map((c) => c.id),
        ["dictationStt"]
      );

      reset();
      assert.equal(
        planner.planPatch(live(), ctx(), "dictationStt", { cortiEnvironment: "eu" }).kind,
        "instant",
        "no route uses Corti"
      );

      // Corti text always calls ai.eu.corti.app (Task 1/3's providerHosts["corti:text"]), so the region moves no text route.
      reset({
        chatAgentMode: "providers",
        chatAgentProvider: "corti",
        chatAgentModel: "corti-chat",
      });
      const text = planner.planPatch(
        live(),
        ctx({ facts: { credentials: new Map([["corti:text", true]]) } }),
        "chat",
        { cortiEnvironment: "eu" }
      );
      assert.equal(text.kind, "instant", "a text-only Corti profile keeps its recipient");
      assert.deepEqual(text.changes, []);
    }
  );

  // Change-driving (I1 follow-up): the toggle wrote localStorage directly and added webSearch unreviewed.
  await t.test(
    "change-driving: provider web search: on adds a payload part and stages; off is instant",
    async () => {
      const key = "providerSearch:chatIntelligence";
      reset(OPENAI_CHAT);
      const on = planner.planPatch(live(), ctx(), "chat", { [key]: true });
      assert.equal(on.kind, "staged");
      assert.doesNotMatch(change(on, "chat").before.sends, /<webSearch>/);
      assert.match(change(on, "chat").after.sends, /<webSearch>/);
      assert.deepEqual(on.undoPatch, { [key]: false }, "Undo restores the stored preference");

      await live().applyRoutePatch(on.patch);
      assert.equal(storage.getItem("personalWebSearch:chatIntelligence"), "true");
      assert.equal(planner.planPatch(live(), ctx(), "chat", { [key]: true }).kind, "noop");
      const off = planner.planPatch(live(), ctx(), "chat", { [key]: false });
      assert.equal(off.kind, "instant");
      assert.doesNotMatch(change(off, "chat").after.sends, /<webSearch>/);

      reset({
        chatAgentMode: "providers",
        chatAgentProvider: "groq",
        chatAgentModel: "openai/gpt-oss-120b",
      });
      const groq = planner.planPatch(live(), ctx(), "chat", { [key]: true });
      assert.equal(groq.kind, "instant", "Groq has no native search, so nothing new is sent");
      assert.deepEqual(groq.changes, []);
    }
  );

  // Change-driving (I5): the preview must be the state that commit produces.
  await t.test(
    "change-driving: preview equals the state after applying the patch, and Undo returns to the start",
    async () => {
      const start = {
        transcriptionMode: "providers",
        useLocalWhisper: false,
        meetingTranscriptionMode: "providers",
        meetingUseLocalWhisper: false,
        chatAgentMode: "providers",
        chatAgentProvider: "groq",
        chatAgentModel: "openai/gpt-oss-120b",
        translationMode: "self-hosted",
        translationRemoteUrl: "http://192.168.1.20:11434/v1",
        translationModel: "llama3",
        dictationAgentMode: "providers",
        dictationAgentProvider: "openai",
        dictationAgentModel: "gpt-6-astra",
        reasoningModelByProvider: { "chatIntelligence:anthropic": "claude-sonnet-5" },
      };
      const targets = [
        ["dictationStt", { mode: "providers", provider: "groq" }],
        ["dictationStt", { mode: "providers", provider: "openai", model: "gpt-4o-transcribe" }],
        ["dictationStt", { mode: "local", provider: "nvidia", model: "parakeet-unified-en-0.6b" }],
        ["uploadStt", { mode: "providers", provider: "groq", model: "whisper-large-v3-turbo" }],
        ["noteRecordingStt", { mode: "providers", provider: "deepgram" }],
        ["chat", { mode: "providers", provider: "anthropic" }],
        [
          "chat",
          { mode: "self-hosted", remoteUrl: "http://192.168.1.40:8080/v1", model: "mistral" },
        ],
        [
          "translation",
          {
            mode: "providers",
            provider: "custom",
            baseUrl: "http://localhost:1234/v1",
            model: "m",
          },
        ],
        ["voiceAssistant", { mode: "local", provider: "qwen", model: QWEN }],
        ["assistantVision", { mode: "providers", provider: "bedrock" }],
        ["dictationCleanup", { mode: "providers", provider: "openai" }],
      ];
      for (const [id, target] of targets) {
        reset(start);
        const before = resolveLive();
        const p = plan(id, target);
        await live().applyRoutePatch(p.patch);
        for (const route of resolveLive()) {
          const c = change(p, route.id);
          const expected = c ? c.after : before.find((r) => r.id === route.id);
          assert.deepEqual(route, expected, `${id} → ${JSON.stringify(target)}: ${route.id}`);
          if (c)
            assert.deepEqual(
              c.before,
              before.find((r) => r.id === route.id)
            );
        }
        await live().applyRoutePatch(p.undoPatch);
        assert.deepEqual(resolveLive(), before, `${id}: Undo returns every route`);
      }
    }
  );
});
