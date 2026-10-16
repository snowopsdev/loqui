const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const { makeSnapshot, makeRoute } = require("./routeFixtures");

const load = () => import("../../src/lib/routeGraph.ts");
const keys = (...ids) => new Map(ids.map((id) => [id, true]));

async function routesOf(overrides) {
  const { resolveRoutes } = await load();
  return Object.fromEntries(resolveRoutes(makeSnapshot(overrides)).map((r) => [r.id, r]));
}

const OPENAI_STT = {
  mode: "providers",
  cloudProvider: "openai",
  cloudModel: "gpt-4o-mini-transcribe",
};
const OPENAI_CHAT = { mode: "providers", provider: "openai", model: "gpt-4o" };

test("change-driving: 11 routes in contract order with kinds, settings paths and lookup tables", async () => {
  const { resolveRoutes, ROUTE_IDS, SCOPE_ROUTE, STT_CONTEXT_ROUTE } = await load();
  const list = resolveRoutes(makeSnapshot());
  assert.deepEqual(
    list.map((r) => r.id),
    [
      "dictationStt",
      "noteRecordingStt",
      "uploadStt",
      "dictationCleanup",
      "voiceAssistant",
      "assistantVision",
      "translation",
      "noteFormatting",
      "chat",
      "speakerId",
      "semanticSearch",
    ]
  );
  assert.deepEqual(
    [...ROUTE_IDS],
    list.map((r) => r.id)
  );
  assert.deepEqual(
    list.map((r) => r.kind),
    [
      "speech",
      "speech",
      "speech",
      "text",
      "text",
      "text",
      "text",
      "text",
      "text",
      "support",
      "support",
    ]
  );
  assert.deepEqual(
    list.map((r) => r.settingsPath),
    [
      "stt/dictation",
      "stt/noteRecording",
      "stt/upload",
      "llms/dictationCleanup",
      "llms/dictationAgent",
      "llms/dictationAgent",
      "llms/dictationTranslation",
      "llms/noteFormatting",
      "llms/chatIntelligence",
      "llms/supportModels",
      "llms/supportModels",
    ]
  );
  assert.equal(SCOPE_ROUTE.dictationAgentVision, "assistantVision");
  assert.equal(SCOPE_ROUTE.chatIntelligence, "chat");
  assert.equal(STT_CONTEXT_ROUTE.meeting, "noteRecordingStt");
});

test("change-driving: an all-local profile stays on the device, is ready and sends nothing", async () => {
  const r = await routesOf({});
  for (const route of Object.values(r)) {
    assert.equal(route.locality, "device", route.id);
    assert.deepEqual(route.state, { status: "ready" }, route.id);
    assert.equal(route.sends, null, route.id);
    assert.equal(route.provider, null, route.id);
    assert.equal(route.providerId, null, route.id);
    assert.equal(route.host, null, route.id);
  }
  assert.equal(r.dictationStt.model, "Base");
  assert.equal(r.chat.model, "Qwen3.5 2B");
  assert.equal(r.speakerId.model, "3D-Speaker CAM++");
  assert.equal(r.semanticSearch.model, "all-MiniLM-L6-v2");
});

test("change-driving: a cloud route with a confirmed key is remote, named, hosted, ready and says what it sends", async () => {
  const r = await routesOf({
    stt: { dictation: OPENAI_STT },
    facts: { credentials: keys("openai") },
  });
  assert.deepEqual(
    r.dictationStt,
    makeRoute({
      id: "dictationStt",
      locality: "remote",
      provider: "OpenAI",
      providerId: "openai",
      host: "api.openai.com",
      model: "GPT-4o Mini Transcribe",
      sends: "your audio",
    })
  );
  const dict = await routesOf({
    dictionaryInUse: true,
    stt: { dictation: OPENAI_STT },
    facts: { credentials: keys("openai") },
  });
  assert.equal(
    dict.dictationStt.sends,
    "your audio and your dictionary words and snippet triggers"
  );
});

test("change-driving: credential facts not loaded yet resolve to unknown, never ready", async () => {
  const r = await routesOf({
    facts: { credentials: null },
    stt: { dictation: OPENAI_STT, meeting: { mode: "providers", cloudProvider: "deepgram" } },
    llm: {
      chatIntelligence: OPENAI_CHAT,
      dictationCleanup: { mode: "providers", provider: "openai", model: "" },
    },
  });
  assert.deepEqual(r.dictationStt.state, { status: "unknown" });
  assert.deepEqual(r.noteRecordingStt.state, { status: "unknown" });
  assert.deepEqual(r.chat.state, { status: "unknown" });
  assert.deepEqual(
    r.dictationCleanup.state,
    { status: "unknown" },
    "a missing model does not hide unknown key facts"
  );
  assert.equal(
    r.chat.sends,
    "your messages, recent conversation, and notes and calendar details it looks up"
  );
});

test("change-driving: a missing, rejected or unchosen provider key is needsKey", async () => {
  const groq = { mode: "providers", provider: "groq", model: "openai/gpt-oss-120b" };
  assert.deepEqual((await routesOf({ llm: { chatIntelligence: groq } })).chat.state, {
    status: "needsKey",
    provider: "Groq",
  });
  const rejected = await routesOf({
    llm: { chatIntelligence: groq },
    facts: { credentials: keys("groq"), rejected: new Set(["groq"]) },
  });
  assert.deepEqual(rejected.chat.state, { status: "needsKey", provider: "Groq" });
  const unchosen = (
    await routesOf({ llm: { chatIntelligence: { mode: "providers", provider: "", model: "" } } })
  ).chat;
  assert.deepEqual(unchosen.state, { status: "needsKey", provider: "" });
  assert.equal(unchosen.locality, "remote");
  assert.equal(unchosen.provider, null);
  assert.equal(unchosen.host, null);
  const enterprise = await routesOf({
    llm: {
      chatIntelligence: { mode: "enterprise", provider: "bedrock", model: "anthropic.claude" },
    },
    facts: {
      credentials: keys("bedrock"),
      credentialFields: new Map([["bedrock", { accessKeyId: true, secretAccessKey: true }]]),
    },
  });
  assert.deepEqual(enterprise.chat.state, { status: "ready" });
});

test("change-driving: Corti speech and text authenticate with different credentials, and rejection is keyed by identity", async () => {
  const { routeCredentialId } = await load();
  assert.equal(routeCredentialId("dictationStt", "corti"), "corti:speech");
  assert.equal(routeCredentialId("noteRecordingStt", "corti"), "corti:speech");
  assert.equal(routeCredentialId("chat", "corti"), "corti:text");
  assert.equal(routeCredentialId("chat", "custom"), null);
  assert.equal(routeCredentialId("dictationStt", "openai"), "openai");
  const corti = {
    stt: {
      dictation: { mode: "providers", cloudProvider: "corti", cloudModel: "corti-transcribe" },
      meeting: { mode: "providers", cloudProvider: "corti" },
    },
    llm: { chatIntelligence: { mode: "providers", provider: "corti", model: "corti-chat" } },
  };
  const pairOnly = await routesOf({ ...corti, facts: { credentials: keys("corti:speech") } });
  assert.deepEqual(pairOnly.dictationStt.state, { status: "ready" });
  assert.deepEqual(pairOnly.noteRecordingStt.state, { status: "ready" });
  assert.deepEqual(pairOnly.chat.state, { status: "needsKey", provider: "Corti" });
  const keyOnly = await routesOf({ ...corti, facts: { credentials: keys("corti:text") } });
  assert.deepEqual(keyOnly.dictationStt.state, { status: "needsKey", provider: "Corti" });
  assert.deepEqual(keyOnly.chat.state, { status: "ready" });
  const mixed = await routesOf({
    ...corti,
    facts: { credentials: keys("corti:speech", "corti:text"), rejected: new Set(["corti:text"]) },
  });
  assert.deepEqual(
    mixed.dictationStt.state,
    { status: "ready" },
    "a rejected text key does not pause speech"
  );
  assert.deepEqual(mixed.chat.state, { status: "needsKey", provider: "Corti" });
  // Speech goes to the region's host; text always goes to the API-key host
  // (personalInference.js:78), read from providerHosts["corti:text"].
  assert.equal(keyOnly.dictationStt.host, "api.us.corti.app");
  assert.equal(keyOnly.noteRecordingStt.host, "api.us.corti.app");
  assert.equal(keyOnly.chat.host, "ai.eu.corti.app");
  const euSpeech = await routesOf({
    ...corti,
    facts: { credentials: keys("corti:speech", "corti:text") },
    capabilities: { providerHosts: { corti: "api.eu.corti.app" } },
  });
  assert.equal(
    euSpeech.dictationStt.host,
    "api.eu.corti.app",
    "the speech host follows the region"
  );
  assert.equal(euSpeech.chat.host, "ai.eu.corti.app", "the text host does not");
  const { resolveRoute } = await load();
  const noTextHost = makeSnapshot({ ...corti, facts: { credentials: keys("corti:text") } });
  delete noTextHost.capabilities.providerHosts["corti:text"];
  assert.equal(resolveRoute(noTextHost, "chat").host, null, "never falls back to the speech host");
});

test("change-driving: local models are judged per family; a failed inventory is unknown, never ready", async () => {
  const r = await routesOf({
    facts: { installed: { whisper: null, sherpa: new Set(), llm: new Set() } },
    stt: { meeting: { localProvider: "nvidia", localModel: "parakeet-tdt-0.6b-v3" } },
    llm: { noteFormatting: { model: "" } },
  });
  assert.deepEqual(r.dictationStt.state, { status: "unknown" }, "whisper inventory failed");
  assert.deepEqual(r.noteRecordingStt.state, { status: "needsModel", sizeBytes: 680000000 });
  assert.deepEqual(
    r.chat.state,
    { status: "needsModel", sizeBytes: 1329766560 },
    "empty LLM inventory is a known fact"
  );
  assert.deepEqual(
    r.noteFormatting.state,
    { status: "needsModel" },
    "an unset model is a settings fact"
  );
  assert.equal(r.noteFormatting.model, null);
  const unsetWhileUnknown = await routesOf({
    facts: { installed: { llm: null } },
    llm: { chatIntelligence: { model: "" } },
  });
  assert.deepEqual(unsetWhileUnknown.chat.state, { status: "needsModel" });
});

test("change-driving: support models: failed checks are unknown, missing is needsModel, disabled speaker id is off", async () => {
  const failed = await routesOf({ facts: { speakerIdModelsReady: null, searchModelReady: null } });
  assert.deepEqual(failed.speakerId.state, { status: "unknown" });
  assert.deepEqual(failed.semanticSearch.state, { status: "unknown" });
  const r = await routesOf({
    enabled: { speakerId: false },
    facts: { searchModelReady: false },
    sealed: true,
  });
  assert.deepEqual(r.speakerId.state, { status: "off" });
  assert.deepEqual(r.semanticSearch.state, { status: "needsModel" });
  assert.equal(r.semanticSearch.locality, "device");
});

test("change-driving: a usable text provider without a chosen model needs a model; speech does not", async () => {
  const r = await routesOf({
    facts: { credentials: keys("groq") },
    llm: { chatIntelligence: { mode: "providers", provider: "groq", model: "" } },
    stt: { dictation: { mode: "providers", cloudProvider: "groq", cloudModel: "" } },
  });
  assert.deepEqual(r.chat.state, { status: "needsModel" });
  assert.deepEqual(r.dictationStt.state, { status: "ready" });
});

test("change-driving: speech readiness agrees with the batch executor for custom endpoints", async () => {
  const { resolveTranscriptionRoute } = await import("../../src/helpers/transcriptionRoute.ts");
  const providers = makeSnapshot().capabilities.transcriptionProviderBaseUrls;
  const cases = [
    ["", "needsUrl"],
    ["not a url", "needsUrl"],
    ["http://stt.example.com/v1", "needsUrl"], // public HTTP
    ["https://api.openwhispr.com/v1", "needsUrl"], // retired hosted service
    ["https://inference.tinfoil.sh/v1", "needsUrl"], // Tinfoil only through the attested proxy
    ["https://api.openai.com/v1", "needsUrl"], // the untouched store default
    ["ws://localhost:9000/v1", "needsUrl"], // loopback, but not HTTP
    ["http://localhost:9000/v1", "ready"],
    ["https://stt.example.com/v1", "ready"],
  ];
  for (const [url, expected] of cases) {
    const input = {
      mode: "providers",
      cloudProvider: "custom",
      cloudModel: "whisper-1",
      cloudBaseUrl: url,
    };
    const executor = resolveTranscriptionRoute({
      settings: {
        transcriptionMode: "providers",
        cloudTranscriptionProvider: "custom",
        cloudTranscriptionModel: "whisper-1",
        cloudTranscriptionBaseUrl: url,
      },
      providers,
    });
    assert.equal(executor.transport === "error", expected !== "ready", `executor: ${url}`);
    const route = (await routesOf({ stt: { dictation: input } })).dictationStt;
    assert.equal(route.state.status, expected, url);
    if (expected === "needsUrl") {
      assert.equal(route.locality, "remote", `an invalid URL is never the device: ${url}`);
      assert.equal(route.host, null, url);
    }
  }
  const loopback = (
    await routesOf({
      stt: {
        dictation: {
          mode: "providers",
          cloudProvider: "custom",
          cloudBaseUrl: "http://localhost:9000/v1",
        },
      },
    })
  ).dictationStt;
  assert.equal(loopback.locality, "device");
  assert.equal(loopback.providerId, null);
  const hosted = (
    await routesOf({
      stt: {
        upload: {
          mode: "providers",
          cloudProvider: "custom",
          cloudBaseUrl: "https://stt.example.com/v1",
        },
      },
    })
  ).uploadStt;
  assert.equal(hosted.providerId, "custom");
  assert.equal(hosted.provider, "Custom endpoint");
  assert.equal(hosted.host, "stt.example.com");
});

test("change-driving: self-hosted speech: LAN is the network, loopback is the device, invalid needs a URL", async () => {
  const at = async (remoteUrl) =>
    (
      await routesOf({
        stt: { dictation: { mode: "self-hosted", remoteUrl, remoteModel: "whisper-1" } },
      })
    ).dictationStt;
  const lan = await at("http://192.168.1.20:9000/v1");
  assert.equal(lan.locality, "network");
  assert.equal(lan.host, "192.168.1.20:9000");
  assert.deepEqual(lan.state, { status: "ready" });
  assert.equal(lan.model, "whisper-1");
  assert.equal(lan.sends, "your audio");
  assert.equal((await at("http://localhost:9000/v1")).locality, "device");
  for (const url of [
    "",
    "http://stt.example.com/v1",
    "ftp://localhost:9000/v1",
    "https://openwhispr.app/v1",
  ]) {
    const r = await at(url);
    assert.deepEqual(r.state, { status: "needsUrl" }, url);
    assert.equal(r.locality, "network", url);
    assert.equal(r.host, null, url);
  }
});

test("change-driving: unsupported and live-only speech providers follow the executor per context", async () => {
  const unknown = (
    await routesOf({ stt: { upload: { mode: "providers", cloudProvider: "whisper-cloud" } } })
  ).uploadStt;
  assert.deepEqual(unknown.state, { status: "unreachable", detail: "unsupported" });
  assert.equal(unknown.locality, "remote");
  assert.deepEqual(
    (await routesOf({ stt: { upload: { mode: "providers", cloudProvider: "" } } })).uploadStt.state,
    { status: "needsKey", provider: "" }
  );
  const deepgram = { mode: "providers", cloudProvider: "deepgram", cloudModel: "nova-3" };
  const withKey = await routesOf({
    stt: { dictation: deepgram, upload: deepgram },
    facts: { credentials: keys("deepgram") },
  });
  assert.deepEqual(withKey.dictationStt.state, { status: "ready" }, "dictation streams live");
  // §5.1 rule 9: uploadStt on a streaming-only provider is unreachable/unsupported.
  assert.deepEqual(
    withKey.uploadStt.state,
    { status: "unreachable", detail: "unsupported" },
    "uploads need a batch provider"
  );
  assert.deepEqual((await routesOf({ stt: { dictation: deepgram } })).dictationStt.state, {
    status: "needsKey",
    provider: "Deepgram",
  });
  assert.equal(
    (await routesOf({ stt: { upload: { mode: "mystery" } } })).uploadStt.locality,
    "remote",
    "unknown modes fail toward disclosure"
  );
});

test("change-driving: note recording runs only the meeting streaming providers and never self-hosted", async () => {
  // §5.1 rule 9: noteRecordingStt in self-hosted mode, or with a provider outside the meeting providers,
  // is unreachable/unsupported (Plan 05 CCR 5).
  const groq = await routesOf({
    stt: { meeting: { mode: "providers", cloudProvider: "groq" } },
    facts: { credentials: keys("groq") },
  });
  assert.deepEqual(
    groq.noteRecordingStt.state,
    { status: "unreachable", detail: "unsupported" },
    "inherited Groq dictation cannot record notes"
  );
  assert.equal(groq.noteRecordingStt.providerId, "groq");
  const selfHosted = await routesOf({
    stt: { meeting: { mode: "self-hosted", remoteUrl: "http://192.168.1.20:9000/v1" } },
  });
  assert.deepEqual(selfHosted.noteRecordingStt.state, {
    status: "unreachable",
    detail: "unsupported",
  });
  assert.equal(selfHosted.noteRecordingStt.locality, "network");
  const openai = await routesOf({
    stt: { meeting: { mode: "providers", cloudProvider: "openai" } },
    facts: { credentials: keys("openai") },
  });
  assert.deepEqual(openai.noteRecordingStt.state, { status: "ready" });
  assert.equal(openai.noteRecordingStt.sends, "meeting audio from your microphone and the call");
});

test("change-driving: text endpoints use the executor's rule before the loopback decision", async () => {
  const custom = async (cloudBaseUrl) =>
    (
      await routesOf({
        llm: {
          dictationCleanup: { mode: "providers", provider: "custom", model: "m", cloudBaseUrl },
        },
      })
    ).dictationCleanup;
  const selfHosted = async (remoteUrl) =>
    (
      await routesOf({
        llm: { dictationTranslation: { mode: "self-hosted", remoteUrl, model: "llama3.1:8b" } },
      })
    ).translation;
  const invalid = [
    "",
    "not a url",
    "http://llm.example.com/v1", // public HTTP
    "https://api.openwhispr.com/v1", // retired hosted service
    "https://user:secret@llm.example.com/v1", // embedded credentials
    "ws://localhost:1234/v1", // loopback, but not HTTP
    "http://lmstudio.localhost/v1", // loopback name, but not a private host for plain HTTP
  ];
  for (const url of invalid) {
    const c = await custom(url);
    assert.deepEqual(c.state, { status: "needsUrl" }, `custom ${url}`);
    assert.equal(c.locality, "remote", `custom ${url}`);
    assert.equal(c.providerId, "custom", `custom ${url}`);
    assert.equal(c.host, null, `custom ${url}`);
    const sh = await selfHosted(url);
    assert.deepEqual(sh.state, { status: "needsUrl" }, `self-hosted ${url}`);
    assert.equal(sh.locality, "network", `self-hosted ${url}`);
  }
  for (const url of [
    "http://127.0.0.1:8080/v1",
    "http://localhost:1234/v1",
    "http://[::1]:1234/v1",
    "https://lmstudio.localhost/v1",
  ]) {
    const c = await custom(url);
    assert.equal(c.locality, "device", url);
    assert.equal(c.providerId, null, url);
    assert.equal(c.host, new URL(url).host, "preserve a configured loopback endpoint host");
    assert.equal(c.sends, null, url);
    assert.deepEqual(c.state, { status: "ready" }, url);
  }
  const builtin = (await routesOf({})).dictationStt;
  assert.equal(builtin.locality, "device");
  assert.equal(builtin.host, null, "only a built-in engine has device locality and no host");
  const remote = await custom("https://llm.example.com:8443/v1");
  assert.equal(remote.locality, "remote");
  assert.equal(remote.host, "llm.example.com:8443");
  assert.equal(remote.sends, "your transcript text");
  const lan = await selfHosted("http://192.168.1.20:11434/v1");
  assert.equal(lan.locality, "network");
  assert.equal(lan.host, "192.168.1.20:11434");
  assert.equal(lan.providerId, null);
  assert.deepEqual(lan.state, { status: "ready" });
});

test("change-driving: plain-HTTP *.localhost is loopback but refused by the executors, so it needs a URL (§5.1 rule 10)", async () => {
  const { isLoopbackUrl } = await import("../../src/lib/locality.ts");
  const url = "http://lmstudio.localhost/v1";
  // §5 Locality row (Plan 07 CCR-5, pinned by Plan 07's test/fixtures/loopbackCases.json): *.localhost IS loopback.
  assert.equal(isLoopbackUrl(url), true, "*.localhost is loopback");
  // §5.1 rule 10: whether an endpoint is valid is the executors' question, and they refuse plain-HTTP
  // *.localhost. Loopback-but-refused therefore resolves needsUrl, never device and never ready.
  const custom = (
    await routesOf({
      llm: {
        dictationCleanup: { mode: "providers", provider: "custom", model: "m", cloudBaseUrl: url },
      },
    })
  ).dictationCleanup;
  assert.deepEqual(custom.state, { status: "needsUrl" });
  assert.notEqual(custom.locality, "device");
  const speech = (
    await routesOf({
      stt: {
        dictation: {
          mode: "providers",
          cloudProvider: "custom",
          cloudModel: "whisper-1",
          cloudBaseUrl: url,
        },
      },
    })
  ).dictationStt;
  assert.deepEqual(speech.state, { status: "needsUrl" });
  assert.notEqual(speech.locality, "device");
  const selfHosted = (
    await routesOf({
      llm: { dictationTranslation: { mode: "self-hosted", remoteUrl: url, model: "llama3.1:8b" } },
    })
  ).translation;
  assert.deepEqual(selfHosted.state, { status: "needsUrl" });
  assert.equal(selfHosted.locality, "network");
});

test("change-driving: a text provider main refuses is unsupported", async () => {
  const r = await routesOf({
    llm: { chatIntelligence: { mode: "providers", provider: "deepgram", model: "nova-3" } },
    facts: { credentials: keys("deepgram") },
  });
  assert.deepEqual(r.chat.state, { status: "unreachable", detail: "unsupported" });
  const wrongMode = await routesOf({
    llm: { chatIntelligence: { mode: "enterprise", provider: "openai", model: "gpt-4o" } },
    facts: { credentials: keys("openai") },
  });
  assert.deepEqual(wrongMode.chat.state, { status: "unreachable", detail: "unsupported" });
});

// R2-1: enterprise routes derive host and readiness from the enterprise slice.
const enterpriseChat = (provider, model, overrides = {}) => ({
  ...overrides,
  llm: { chatIntelligence: { mode: "enterprise", provider, model } },
});

test("change-driving: Azure: a saved key never makes a missing or refused endpoint ready, and the host is the endpoint's", async () => {
  const { providerDisplayName } = await import("../../src/lib/locality.ts");
  const azure = async (azureEndpoint, credentials = keys("azure")) =>
    (
      await routesOf(
        enterpriseChat("azure", "gpt-4o-deploy", {
          enterprise: { azureEndpoint },
          facts: { credentials },
        })
      )
    ).chat;
  // createAzureModel refuses each of these (enterpriseAiProviders.js:73-77).
  for (const url of [
    "",
    "   ",
    "not a url",
    "http://myres.openai.azure.com/openai",
    "https://user:secret@myres.openai.azure.com/openai",
  ]) {
    const route = await azure(url);
    assert.deepEqual(
      route.state,
      { status: "needsUrl" },
      `a saved key does not make ${JSON.stringify(url)} ready`
    );
    assert.equal(route.host, null, url);
    assert.equal(route.locality, "remote", url);
    assert.equal(route.providerId, "azure", url);
  }
  const first = await azure("https://myres.openai.azure.com/openai");
  assert.deepEqual(first.state, { status: "ready" });
  assert.equal(first.host, "myres.openai.azure.com");
  assert.equal(
    first.sends,
    "your messages, recent conversation, and notes and calendar details it looks up"
  );
  const moved = await azure("https://Proxy.Example.com:8443/openai/");
  assert.equal(moved.host, "proxy.example.com:8443", "an endpoint host change changes route.host");
  assert.notEqual(moved.host, first.host);
  assert.deepEqual((await azure("https://myres.openai.azure.com/openai", keys())).state, {
    status: "needsKey",
    provider: providerDisplayName("azure"),
  });
  assert.deepEqual((await azure("https://myres.openai.azure.com/openai", null)).state, {
    status: "unknown",
  });
  assert.deepEqual(
    (await azure("", null)).state,
    { status: "needsUrl" },
    "a missing endpoint is a settings fact"
  );
  const noDeployment = (
    await routesOf(
      enterpriseChat("azure", "", {
        enterprise: { azureEndpoint: "https://myres.openai.azure.com/openai" },
        facts: { credentials: keys("azure") },
      })
    )
  ).chat;
  assert.deepEqual(noDeployment.state, { status: "needsModel" }, "an empty deployment name");
});

test("change-driving: Bedrock: the host follows the region through the SDK's partition table", async () => {
  const fields = (accessKeyId, secretAccessKey) =>
    new Map([["bedrock", { accessKeyId, secretAccessKey, sessionToken: false }]]);
  const noOverrides = {
    bedrockEndpoint: { set: false, host: null },
    bedrockProfile: false,
    vertexApiKeyEnv: false,
    vertexProjectEnv: false,
  };
  const bedrock = async (bedrockRegion, options = {}) =>
    (
      await routesOf(
        enterpriseChat("bedrock", "us.anthropic.claude-fable-5", {
          enterprise: { bedrockRegion },
          facts: {
            credentials: options.credentials ?? keys("bedrock"),
            credentialFields: options.credentialFields ?? fields(true, true),
            enterpriseMain: { ...noOverrides, ...options.enterpriseMain },
          },
        })
      )
    ).chat;
  for (const [region, host] of [
    ["us-east-1", "bedrock-runtime.us-east-1.amazonaws.com"],
    ["eu-west-1", "bedrock-runtime.eu-west-1.amazonaws.com"],
    ["cn-north-1", "bedrock-runtime.cn-north-1.amazonaws.com.cn"],
    ["", "bedrock-runtime.us-east-1.amazonaws.com"], // enterpriseAiProviders.js:26 default
  ]) {
    const route = await bedrock(region);
    assert.equal(route.host, host, region);
    assert.deepEqual(route.state, { status: "ready" }, region);
  }
  const unusable = await bedrock("us east");
  assert.deepEqual(unusable.state, { status: "needsUrl" }, "no request URL can be built");
  assert.equal(unusable.host, null);
  const noCredentials = await bedrock("eu-west-1", {
    credentials: keys(),
    credentialFields: fields(false, false),
  });
  assert.equal(noCredentials.state.status, "needsKey");
  assert.equal(
    noCredentials.host,
    "bedrock-runtime.eu-west-1.amazonaws.com",
    "the destination is known before sign-in"
  );
  for (const partial of [fields(true, false), fields(false, true)]) {
    const incomplete = await bedrock("eu-west-1", { credentialFields: partial });
    assert.equal(
      incomplete.state.status,
      "needsKey",
      "neither half of static credentials can enable Apply"
    );
    assert.equal(incomplete.host, "bedrock-runtime.eu-west-1.amazonaws.com");
  }
  const profile = await bedrock("eu-west-1", {
    credentials: keys(),
    credentialFields: fields(false, false),
    enterpriseMain: { bedrockProfile: true },
  });
  assert.deepEqual(
    profile.state,
    { status: "ready" },
    "a supported profile is an independent source"
  );
  // The provider-only vision override reaches Bedrock in "providers" mode; same host rule.
  const vision = (
    await routesOf({
      enabled: { visionOverride: true },
      enterprise: { bedrockRegion: "ap-southeast-2" },
      facts: { credentials: keys("bedrock") },
      llm: {
        dictationAgentVision: {
          mode: "providers",
          provider: "bedrock",
          model: "apac.anthropic.claude-fable-5",
        },
      },
    })
  ).assistantVision;
  assert.equal(vision.host, "bedrock-runtime.ap-southeast-2.amazonaws.com");
});

test("change-driving: Bedrock graph readiness matches the real SDK factory for static pairs and profile auth", async (t) => {
  const { getEnterpriseAIModel } = require("../../src/helpers/enterpriseAiProviders.js");
  const helperPath = require.resolve("../../src/helpers/enterpriseAiProviders.js");
  const originalLoad = Module._load;
  const profileCalls = [];
  Module._load = function loadBedrockProfile(request, parent, isMain) {
    if (request === "@aws-sdk/credential-providers" && parent?.filename === helperPath) {
      return {
        fromNodeProviderChain:
          ({ profile }) =>
          async () => {
            profileCalls.push(profile);
            return { accessKeyId: "AKIAFIXTURE", secretAccessKey: "fixture-profile-secret" };
          },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = originalLoad;
  });

  const bedrock = (fields) =>
    getEnterpriseAIModel("bedrock", "fixture-model", "", {
      bedrockRegion: "us-east-1",
      ...fields,
    });
  await assert.rejects(
    bedrock({ bedrockAccessKeyId: "AKIAFIXTURE", bedrockSecretAccessKey: "" }),
    { name: "CredentialsProviderError" },
    "access-key-ID-only is refused by the executor"
  );
  await assert.rejects(
    bedrock({ bedrockAccessKeyId: "", bedrockSecretAccessKey: "fixture-secret" }),
    { name: "CredentialsProviderError" },
    "secret-only is refused by the executor"
  );
  assert.ok(
    await bedrock({ bedrockAccessKeyId: "AKIAFIXTURE", bedrockSecretAccessKey: "fixture-secret" })
  );
  assert.ok(await bedrock({ bedrockProfile: "fixture-profile", bedrockAccessKeyId: "partial" }));
  assert.deepEqual(
    profileCalls,
    ["fixture-profile"],
    "supported profile authentication wins over a partial static pair"
  );
});

test("change-driving: Vertex: the persisted auth source selects the host independently of saved or ambient key presence", async () => {
  const { providerDisplayName } = await import("../../src/lib/locality.ts");
  const fields = (key) => new Map([["vertex", { key }]]);
  const vertex = async (enterprise, facts) =>
    (await routesOf(enterpriseChat("vertex", "gemini-2.5-flash", { enterprise, facts }))).chat;
  const adc = {
    credentials: keys(),
    credentialFields: fields(false),
    enterpriseMain: {
      bedrockEndpoint: { set: false, host: null },
      bedrockProfile: false,
      vertexApiKeyEnv: false,
      vertexProjectEnv: false,
    },
  };
  for (const [vertexLocation, host] of [
    ["europe-west4", "europe-west4-aiplatform.googleapis.com"],
    ["", "us-central1-aiplatform.googleapis.com"], // enterpriseAiProviders.js:92 default
    ["global", "aiplatform.googleapis.com"],
    ["eu", "aiplatform.eu.rep.googleapis.com"],
  ]) {
    const route = await vertex(
      { vertexProject: "acme-prod", vertexLocation, vertexAuthSource: "adc" },
      adc
    );
    assert.equal(route.host, host, vertexLocation);
    assert.deepEqual(route.state, { status: "ready" }, vertexLocation);
  }
  const adcIgnoresKeys = await vertex(
    { vertexProject: "acme-prod", vertexLocation: "europe-west4", vertexAuthSource: "adc" },
    {
      credentials: keys("vertex"),
      credentialFields: fields(true),
      enterpriseMain: { ...adc.enterpriseMain, vertexApiKeyEnv: true },
    }
  );
  assert.equal(adcIgnoresKeys.host, "europe-west4-aiplatform.googleapis.com");
  assert.deepEqual(
    adcIgnoresKeys.state,
    { status: "ready" },
    "ADC ignores stored and legacy environment keys"
  );
  const adcMissingProject = await vertex(
    { vertexProject: "  ", vertexLocation: "us-central1", vertexAuthSource: "adc" },
    {
      credentials: keys("vertex"),
      credentialFields: fields(true),
      enterpriseMain: { ...adc.enterpriseMain, vertexApiKeyEnv: true },
    }
  );
  assert.equal(adcMissingProject.host, "us-central1-aiplatform.googleapis.com");
  assert.deepEqual(adcMissingProject.state, {
    status: "needsKey",
    provider: providerDisplayName("vertex"),
  });
  const express = await vertex(
    { vertexProject: "", vertexLocation: "europe-west4", vertexAuthSource: "apiKey" },
    {
      credentials: keys("vertex"),
      credentialFields: fields(true),
      enterpriseMain: adc.enterpriseMain,
    }
  );
  assert.equal(
    express.host,
    "aiplatform.googleapis.com",
    "the API key ignores project and location"
  );
  assert.deepEqual(express.state, { status: "ready" });
  const envFallback = await vertex(
    { vertexProject: "", vertexLocation: "europe-west4", vertexAuthSource: "apiKey" },
    {
      credentials: keys(),
      credentialFields: fields(false),
      enterpriseMain: { ...adc.enterpriseMain, vertexApiKeyEnv: true },
    }
  );
  assert.equal(envFallback.host, "aiplatform.googleapis.com");
  assert.deepEqual(
    envFallback.state,
    { status: "ready" },
    "the supported legacy key fallback is used only by apiKey mode"
  );
  const noKey = await vertex(
    { vertexProject: "acme-prod", vertexLocation: "europe-west4", vertexAuthSource: "apiKey" },
    { credentials: keys(), credentialFields: fields(false), enterpriseMain: adc.enterpriseMain }
  );
  assert.equal(noKey.host, "aiplatform.googleapis.com");
  assert.deepEqual(
    noKey.state,
    { status: "needsKey", provider: providerDisplayName("vertex") },
    "apiKey never falls back to ADC"
  );
  const badLocation = await vertex(
    { vertexProject: "acme-prod", vertexLocation: "bad location", vertexAuthSource: "adc" },
    adc
  );
  assert.deepEqual(badLocation.state, { status: "needsUrl" });
  assert.equal(badLocation.host, null);
  const unknownApiKey = await vertex(
    { vertexProject: "acme-prod", vertexAuthSource: "apiKey" },
    { credentials: null, credentialFields: null, enterpriseMain: adc.enterpriseMain }
  );
  assert.deepEqual(unknownApiKey.state, { status: "unknown" });
  assert.equal(
    unknownApiKey.host,
    "aiplatform.googleapis.com",
    "auth source determines the host before key listing"
  );
});

test("change-driving: main facts: environment overrides move enterprise hosts, and an unsynced slice is unknown", async () => {
  const unsynced = await routesOf({
    ...enterpriseChat("azure", "gpt-4o-deploy", {
      enterprise: { azureEndpoint: "https://myres.openai.azure.com/openai" },
      facts: { credentials: keys("azure"), enterpriseMain: null },
    }),
  });
  assert.deepEqual(
    unsynced.chat.state,
    { status: "unknown" },
    "the slice may be stale until synced from main"
  );
  assert.equal(unsynced.chat.host, null);
  for (const provider of ["bedrock", "vertex"]) {
    const r = await routesOf(
      enterpriseChat(provider, "m", {
        facts: { credentials: keys(provider), enterpriseMain: null },
      })
    );
    assert.deepEqual(r.chat.state, { status: "unknown" }, provider);
    assert.equal(r.chat.host, null, provider);
  }
  const main = (over) => ({
    bedrockEndpoint: { set: false, host: null },
    bedrockProfile: false,
    vertexApiKeyEnv: false,
    vertexProjectEnv: false,
    ...over,
  });
  const bedrock = async (enterpriseMain) =>
    (
      await routesOf(
        enterpriseChat("bedrock", "eu.anthropic.claude-fable-5", {
          enterprise: { bedrockRegion: "eu-west-1" },
          facts: {
            credentials: keys("bedrock"),
            credentialFields: new Map([["bedrock", { accessKeyId: true, secretAccessKey: true }]]),
            enterpriseMain,
          },
        })
      )
    ).chat;
  const proxied = await bedrock(
    main({ bedrockEndpoint: { set: true, host: "bedrock-proxy.corp.example:8443" } })
  );
  assert.equal(
    proxied.host,
    "bedrock-proxy.corp.example:8443",
    "the override host, not the region's"
  );
  assert.deepEqual(proxied.state, { status: "ready" });
  const unusable = await bedrock(main({ bedrockEndpoint: { set: true, host: null } }));
  assert.deepEqual(unusable.state, { status: "needsUrl" });
  assert.equal(unusable.host, null);
  const vertexEnvKey = (
    await routesOf(
      enterpriseChat("vertex", "gemini-2.5-flash", {
        enterprise: {
          vertexProject: "",
          vertexLocation: "europe-west4",
          vertexAuthSource: "apiKey",
        },
        facts: { credentials: keys(), enterpriseMain: main({ vertexApiKeyEnv: true }) },
      })
    )
  ).chat;
  assert.equal(
    vertexEnvKey.host,
    "aiplatform.googleapis.com",
    "express mode through main's environment key"
  );
  assert.deepEqual(vertexEnvKey.state, { status: "ready" }, "runs without a stored key or project");
  const envProjectOnly = (
    await routesOf(
      enterpriseChat("vertex", "gemini-2.5-flash", {
        enterprise: { vertexProject: "", vertexLocation: "europe-west4", vertexAuthSource: "adc" },
        facts: { credentials: keys("vertex"), enterpriseMain: main({ vertexProjectEnv: true }) },
      })
    )
  ).chat;
  assert.equal(
    envProjectOnly.state.status,
    "needsKey",
    "the helper passes the blank project, never GOOGLE_VERTEX_PROJECT"
  );
  const adcEnvKey = (
    await routesOf(
      enterpriseChat("vertex", "gemini-2.5-flash", {
        enterprise: {
          vertexProject: "acme-prod",
          vertexLocation: "europe-west4",
          vertexAuthSource: "adc",
        },
        facts: {
          credentials: keys(),
          credentialFields: new Map(),
          enterpriseMain: main({ vertexApiKeyEnv: true }),
        },
      })
    )
  ).chat;
  assert.equal(adcEnvKey.host, "europe-west4-aiplatform.googleapis.com");
  assert.deepEqual(
    adcEnvKey.state,
    { status: "ready" },
    "legacy env fallback cannot override the persisted ADC source"
  );
});

test("change-driving: agreement: enterprise hosts and refusals match enterpriseAiProviders.js and the request the AI SDK sends, with main's environment overrides", async (t) => {
  const { enterpriseRequestHost } = await load();
  const { getEnterpriseAIModel } = require("../../src/helpers/enterpriseAiProviders.js");
  // The real main-side reader Task 3 registers as the enterprise-route-facts IPC.
  const { enterpriseRouteFacts } = require("../../src/helpers/enterpriseRouteFacts.js");
  const ENV = [
    "AWS_ENDPOINT_URL",
    "AWS_ENDPOINT_URL_BEDROCK_RUNTIME",
    "AWS_REGION",
    "AWS_BEARER_TOKEN_BEDROCK",
    "GOOGLE_VERTEX_API_KEY",
    "GOOGLE_VERTEX_PROJECT",
    "GOOGLE_VERTEX_LOCATION",
  ];
  const savedEnv = new Map(ENV.map((name) => [name, process.env[name]]));
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
    for (const [name, value] of savedEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const prompt = [{ role: "user", content: [{ type: "text", text: "Hello" }] }];
  // Fixture AWS keys only let Bedrock sign locally; the stubbed fetch answers every request.
  const AWS = { bedrockAccessKeyId: "AKIAFIXTURE", bedrockSecretAccessKey: "fixture-secret" };

  // The host the real executor's request goes to; null when it refuses the
  // configuration or no request can be made (the stub constructs a Request
  // first, so it refuses relative and credential-bearing URLs like fetch does).
  async function executorHost(provider, enterprise, apiKey) {
    let model;
    try {
      model = await getEnterpriseAIModel(provider, "fixture-model", apiKey, {
        ...AWS,
        ...enterprise,
      });
    } catch {
      return null; // refused before any request (enterpriseAiProviders.js:73-77)
    }
    if (provider === "vertex" && enterprise.vertexAuthSource === "adc") {
      // ADC would first ask Google for a token (a real network call), so read the
      // base URL the SDK will call instead (@ai-sdk/google-vertex loadBaseURL).
      // The source implementation must pass apiKey: "" so ambient env cannot
      // silently switch this request to Express mode.
      assert.equal(
        typeof model.config?.baseURL,
        "string",
        "re-read @ai-sdk/google-vertex loadBaseURL"
      );
      try {
        return new URL(model.config.baseURL).host;
      } catch {
        return null;
      }
    }
    let requested = null;
    global.fetch = async (url) => {
      new Request(String(url));
      requested = String(url);
      return new Response('{"error":{"message":"stub"}}', {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    };
    try {
      await model.doGenerate({ prompt });
    } catch {
      // The stub fails every request; an unusable URL fails before or inside fetch.
    } finally {
      global.fetch = originalFetch;
    }
    if (requested === null) return null;
    try {
      return new URL(requested).host;
    } catch {
      return null;
    }
  }

  // Injected environments only; never the developer's own.
  const scenarios = [
    {},
    { AWS_ENDPOINT_URL_BEDROCK_RUNTIME: "https://bedrock-proxy.corp.example:8443/" },
    { AWS_ENDPOINT_URL: "https://aws-gateway.corp.example" },
    {
      AWS_ENDPOINT_URL_BEDROCK_RUNTIME: "https://runtime.corp.example",
      AWS_ENDPOINT_URL: "https://ignored.corp.example",
    },
    { AWS_ENDPOINT_URL_BEDROCK_RUNTIME: "" }, // set, so it wins, and no request URL can be built
    { AWS_ENDPOINT_URL: "https://user:pw@aws-gateway.corp.example" }, // fetch refuses credentials
    { GOOGLE_VERTEX_API_KEY: "fixture-env-key" },
    { GOOGLE_VERTEX_API_KEY: "" },
    {
      GOOGLE_VERTEX_PROJECT: "env-project",
      GOOGLE_VERTEX_LOCATION: "asia-east1",
      AWS_REGION: "ap-south-1",
    }, // never used
  ];
  const base = makeSnapshot().enterprise;
  const cases = [
    ["azure", { azureEndpoint: "https://myres.openai.azure.com/openai" }, "fixture-key"],
    ["azure", { azureEndpoint: "https://Proxy.Example.com:8443/x/" }, "fixture-key"],
    ["azure", { azureEndpoint: "" }, "fixture-key"],
    ["azure", { azureEndpoint: "not a url" }, "fixture-key"],
    ["azure", { azureEndpoint: "http://myres.openai.azure.com/openai" }, "fixture-key"],
    ["azure", { azureEndpoint: "https://u:p@myres.openai.azure.com/openai" }, "fixture-key"],
    ["bedrock", { bedrockRegion: "us-east-1" }, ""],
    ["bedrock", { bedrockRegion: "eu-central-1" }, ""],
    ["bedrock", { bedrockRegion: "cn-northwest-1" }, ""],
    ["bedrock", { bedrockRegion: "us-isob-east-1" }, ""],
    ["bedrock", { bedrockRegion: "" }, ""],
    ["bedrock", { bedrockRegion: "us east" }, ""],
    ["bedrock", { bedrockRegion: "evil.example/x" }, ""], // the SDK really contacts bedrock-runtime.evil.example
    [
      "vertex",
      { vertexProject: "acme-prod", vertexLocation: "europe-west4", vertexAuthSource: "adc" },
      "",
    ],
    ["vertex", { vertexProject: "acme-prod", vertexLocation: "", vertexAuthSource: "adc" }, ""],
    [
      "vertex",
      { vertexProject: "acme-prod", vertexLocation: "global", vertexAuthSource: "adc" },
      "",
    ],
    ["vertex", { vertexProject: "acme-prod", vertexLocation: "us", vertexAuthSource: "adc" }, ""],
    [
      "vertex",
      { vertexProject: "acme-prod", vertexLocation: "bad location", vertexAuthSource: "adc" },
      "",
    ],
    ["vertex", { vertexProject: "", vertexLocation: "europe-west4", vertexAuthSource: "adc" }, ""],
    [
      "vertex",
      { vertexProject: "", vertexLocation: "europe-west4", vertexAuthSource: "apiKey" },
      "fixture-key",
    ],
    [
      "vertex",
      { vertexProject: "acme-prod", vertexLocation: "europe-west4", vertexAuthSource: "apiKey" },
      "",
    ], // committed stored key absent: uses injected legacy fallback or refuses
  ];
  for (const scenario of scenarios) {
    for (const name of ENV) delete process.env[name];
    Object.assign(process.env, scenario);
    const main = enterpriseRouteFacts(process.env);
    assert.equal(
      JSON.stringify(main).includes("fixture-env-key") || JSON.stringify(main).includes("user:pw"),
      false,
      "main's facts carry no value"
    );
    for (const [provider, overrides, apiKey] of cases) {
      const enterprise = { ...base, ...overrides };
      const graphHost = enterpriseRequestHost(provider, enterprise, main);
      const sdkHost = await executorHost(provider, enterprise, apiKey);
      const missingVertexKey =
        provider === "vertex" &&
        enterprise.vertexAuthSource === "apiKey" &&
        !(apiKey || process.env.GOOGLE_VERTEX_API_KEY);
      if (missingVertexKey) {
        assert.equal(
          sdkHost,
          null,
          "the selected apiKey mode refuses without either committed key source"
        );
        assert.equal(
          graphHost,
          "aiplatform.googleapis.com",
          "the configured recipient remains known while readiness is needsKey"
        );
      } else {
        assert.equal(
          graphHost,
          sdkHost,
          `${JSON.stringify(scenario)} ${provider} ${JSON.stringify(overrides)}`
        );
      }
    }
  }
  for (const name of ENV) delete process.env[name];
  // Without its key Azure and Vertex apiKey mode are refused; neither may silently select ADC.
  assert.equal(
    await executorHost(
      "azure",
      { ...base, azureEndpoint: "https://myres.openai.azure.com/openai" },
      ""
    ),
    null
  );
  for (const name of ENV) delete process.env[name];
  assert.equal(
    await executorHost(
      "vertex",
      {
        ...base,
        vertexProject: "acme-prod",
        vertexLocation: "europe-west4",
        vertexAuthSource: "apiKey",
      },
      ""
    ),
    null,
    "missing apiKey-mode credential is refused, not redirected to ADC"
  );
});

test("change-driving: the retired openwhispr mode names a provider and says it cannot run", async () => {
  const bare = (await routesOf({ stt: { upload: { mode: "openwhispr", cloudProvider: "" } } }))
    .uploadStt;
  assert.equal(bare.locality, "remote");
  assert.equal(bare.providerId, "openwhispr");
  assert.notEqual(bare.provider, "Unknown provider");
  assert.deepEqual(bare.state, { status: "unreachable", detail: "retired" });
  const chat = (
    await routesOf({
      llm: { chatIntelligence: { mode: "openwhispr", provider: "openai", model: "x" } },
    })
  ).chat;
  assert.equal(chat.providerId, "openai");
  assert.equal(chat.provider, "OpenAI");
  assert.deepEqual(chat.state, { status: "unreachable", detail: "retired" });
});

test("change-driving: off routes keep their destination but send nothing", async () => {
  const r = await routesOf({
    enabled: { cleanup: false, translation: false },
    facts: { credentials: keys("openai") },
    llm: { dictationCleanup: OPENAI_CHAT },
  });
  assert.deepEqual(r.dictationCleanup.state, { status: "off" });
  assert.equal(r.dictationCleanup.locality, "remote");
  assert.equal(r.dictationCleanup.host, "api.openai.com");
  assert.equal(r.dictationCleanup.sends, null);
  assert.deepEqual(r.translation.state, { status: "off" });
});

test("change-driving: assistant vision follows the assistant unless overridden, and is off without screen context", async () => {
  const llm = {
    dictationAgent: OPENAI_CHAT,
    dictationAgentVision: { mode: "providers", provider: "anthropic", model: "claude-sonnet" }, // stale override values
  };
  const credentials = keys("openai", "anthropic");
  const follow = (await routesOf({ llm, facts: { credentials } })).assistantVision;
  assert.equal(follow.providerId, "openai");
  assert.equal(follow.host, "api.openai.com");
  assert.equal(follow.model, "GPT-4o");
  const override = (
    await routesOf({ llm, facts: { credentials }, enabled: { visionOverride: true } })
  ).assistantVision;
  assert.equal(override.providerId, "anthropic");
  assert.equal(override.host, "api.anthropic.com");
  assert.equal(override.model, "Claude Sonnet");
  assert.deepEqual((await routesOf({ enabled: { screenContext: false } })).assistantVision.state, {
    status: "off",
  });
  assert.deepEqual((await routesOf({ enabled: { voiceAssistant: false } })).assistantVision.state, {
    status: "off",
  });
});

test("change-driving: sealed mode makes every route that leaves the device unreachable, LAN included", async () => {
  const { isSealedLocality } = await load();
  const r = await routesOf({
    sealed: true,
    enabled: { translation: false },
    facts: { credentials: null },
    stt: { dictation: OPENAI_STT },
    llm: {
      noteFormatting: {
        mode: "self-hosted",
        remoteUrl: "http://192.168.1.20:11434/v1",
        model: "llama3.1:8b",
      },
      dictationTranslation: OPENAI_CHAT,
    },
  });
  assert.deepEqual(
    r.dictationStt.state,
    { status: "unreachable", detail: "sealed" },
    "sealed wins over unknown"
  );
  assert.deepEqual(
    r.noteFormatting.state,
    { status: "unreachable", detail: "sealed" },
    "a LAN server is another machine"
  );
  assert.equal(r.noteFormatting.locality, "network");
  assert.deepEqual(r.chat.state, { status: "ready" });
  assert.deepEqual(r.translation.state, { status: "off" });
  assert.equal(isSealedLocality("remote"), true);
  assert.equal(isSealedLocality("network"), true);
  assert.equal(isSealedLocality("device"), false);
});

test("change-driving: payload parts follow Appendix B per route and condition", async () => {
  const { routePayloadParts } = await load();
  const s = makeSnapshot({
    dictionaryInUse: true,
    llm: { dictationAgent: { providerSearch: true }, chatIntelligence: { providerSearch: true } },
  });
  assert.deepEqual(routePayloadParts("dictationStt", s), ["audio", "dictionary"]);
  assert.deepEqual(routePayloadParts("noteRecordingStt", s), ["meetingAudio"]);
  assert.deepEqual(routePayloadParts("uploadStt", s), ["audioFile"]);
  assert.deepEqual(routePayloadParts("dictationCleanup", s), ["transcript", "dictionary"]);
  assert.deepEqual(routePayloadParts("translation", s), ["transcript", "dictionary"]);
  assert.deepEqual(routePayloadParts("voiceAssistant", s), [
    "request",
    "selectedText",
    "history",
    "lookups",
    "dictionary",
    "screenshot",
    "webSearch",
  ]);
  assert.deepEqual(routePayloadParts("assistantVision", s), [
    "request",
    "selectedText",
    "history",
    "lookups",
    "dictionary",
    "screenshot",
    "webSearch",
  ]);
  assert.deepEqual(routePayloadParts("noteFormatting", s), [
    "noteText",
    "meetingTranscript",
    "participants",
    "dictionaryWords",
  ]);
  assert.deepEqual(routePayloadParts("chat", s), [
    "messages",
    "history",
    "lookups",
    "dictionary",
    "webSearch",
  ]);
  assert.deepEqual(routePayloadParts("speakerId", s), []);
  const override = makeSnapshot({
    enabled: { visionOverride: true },
    llm: { dictationAgent: { providerSearch: true } },
  });
  assert.deepEqual(
    routePayloadParts("voiceAssistant", override),
    ["request", "selectedText", "history", "lookups", "webSearch"],
    "the screenshot goes to the vision provider"
  );
  assert.deepEqual(
    routePayloadParts("assistantVision", override),
    ["request", "selectedText", "history", "lookups", "screenshot"],
    "search follows the vision scope"
  );
  const noScreen = makeSnapshot({ enabled: { screenContext: false } });
  assert.deepEqual(routePayloadParts("voiceAssistant", noScreen), [
    "request",
    "selectedText",
    "history",
    "lookups",
  ]);
  const remoteChat = (
    await routesOf({
      dictionaryInUse: true,
      llm: { chatIntelligence: { ...OPENAI_CHAT, providerSearch: true } },
      facts: { credentials: keys("openai") },
    })
  ).chat;
  assert.equal(
    remoteChat.sends,
    "your messages, recent conversation, notes and calendar details it looks up, your dictionary words and snippet triggers, and permission for the provider to search the web"
  );
});

test("change-driving: agreement: Corti meeting options carry keyterms exactly when the disclosure lists dictionary words", async () => {
  const { resolveMeetingTranscriptionOptions } =
    await import("../../src/helpers/meetingTranscriptionRouting.js");
  const byokProviders = [
    { id: "corti", models: [{ id: "corti-transcribe", default: true }] },
    { id: "openai", models: [{ id: "gpt-4o-mini-transcribe", default: true }] },
  ];
  const options = (selectedProvider) =>
    resolveMeetingTranscriptionOptions({
      transcriptionMode: "providers",
      language: "en",
      selectedProvider,
      selectedModel: "",
      byokProviders,
      keyterms: ["Loqui"],
    });
  assert.deepEqual(options("corti").keyterms, ["Loqui"]);
  assert.equal("keyterms" in options("openai"), false);
  const copy = makeSnapshot().copy.parts.dictionaryWords;
  for (const [provider, credential, carries] of [
    ["corti", "corti:speech", true],
    ["openai", "openai", false],
  ]) {
    const route = (
      await routesOf({
        dictionaryInUse: true,
        stt: { meeting: { mode: "providers", cloudProvider: provider } },
        facts: { credentials: keys(credential) },
      })
    ).noteRecordingStt;
    assert.equal(route.sends.includes(copy), carries, provider);
  }
});

test("change-driving: agreement: TEXT_PROVIDER_IDS mirrors the providers main accepts (source guard)", async () => {
  const { TEXT_PROVIDER_IDS } = await load();
  const source = fs.readFileSync(
    path.join(__dirname, "../../src/helpers/personalInference.js"),
    "utf8"
  );
  const block = source.match(/const PROVIDERS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(block, "PROVIDERS set not found in personalInference.js");
  const main = [...block[1].matchAll(/"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((id) => id !== "lan" && id !== "local");
  assert.deepEqual([...TEXT_PROVIDER_IDS].sort(), main.sort());
});

test("change-driving: routeGraph.ts stays Node-loadable: only the three allowed imports (source guard)", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../src/lib/routeGraph.ts"), "utf8");
  const specifiers = [...source.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(specifiers, [
    "../helpers/transcriptionRoute.ts",
    "../utils/urlUtils.ts",
    "./locality.ts",
  ]);
});

test("change-driving: resolveRoute matches the list entry", async () => {
  const { resolveRoute } = await load();
  const s = makeSnapshot({
    stt: { meeting: { mode: "providers", cloudProvider: "openai" } },
    facts: { credentials: keys("openai") },
  });
  assert.deepEqual(
    resolveRoute(s, "noteRecordingStt"),
    (
      await routesOf({
        stt: { meeting: { mode: "providers", cloudProvider: "openai" } },
        facts: { credentials: keys("openai") },
      })
    ).noteRecordingStt
  );
});

test("change-driving: fixtures: makeSnapshot deep-merges and makeRoute follows the contract tables", async () => {
  const { ROUTE_IDS, ROUTE_KIND, ROUTE_SETTINGS_PATH, PAYLOAD_PARTS } = await load();
  const s = makeSnapshot({
    stt: { dictation: { mode: "providers" } },
    facts: { installed: { llm: null } },
  });
  assert.equal(s.stt.dictation.mode, "providers");
  assert.equal(s.stt.dictation.localModel, "base", "siblings survive the merge");
  assert.equal(s.facts.installed.llm, null);
  assert.ok(s.facts.installed.whisper instanceof Set);
  assert.notEqual(
    makeSnapshot().facts.installed.whisper,
    makeSnapshot().facts.installed.whisper,
    "no shared state"
  );
  assert.deepEqual(Object.keys(s.copy.parts).sort(), [...PAYLOAD_PARTS].sort());
  for (const id of ROUTE_IDS) {
    const r = makeRoute({ id });
    assert.equal(r.kind, ROUTE_KIND[id], id);
    assert.equal(r.settingsPath, ROUTE_SETTINGS_PATH[id], id);
  }
});

test("change-driving: rejected health projects only the matching generation and non-secret configuration", async () => {
  const { matchingRejectedCredentials, resolveRoute } = await load();
  const tenantA = { generation: 3, configFingerprint: "corti:us:tenant-a" };
  const tenantB = { generation: 3, configFingerprint: "corti:us:tenant-b" };
  const health = [
    { identity: "corti:speech", ...tenantA, status: "rejected" },
    { identity: "corti:text", generation: 8, configFingerprint: "corti:text", status: "verified" },
  ];
  const current = new Map([["corti:speech", tenantA]]);
  assert.deepEqual([...matchingRejectedCredentials(health, current)], ["corti:speech"]);
  const settings = {
    stt: { meeting: { mode: "providers", cloudProvider: "corti" } },
    facts: {
      credentials: keys("corti:speech"),
      rejected: matchingRejectedCredentials(health, current),
    },
  };
  assert.equal(resolveRoute(makeSnapshot(settings), "noteRecordingStt").state.status, "needsKey");
  for (const identity of [tenantB, { ...tenantA, generation: 4 }]) {
    // Reproject for each supplied settings snapshot, including planner previews.
    const rejected = matchingRejectedCredentials(health, new Map([["corti:speech", identity]]));
    assert.equal(rejected.size, 0, "old options or a replaced key are unverified");
    assert.equal(
      resolveRoute(
        makeSnapshot({ ...settings, facts: { ...settings.facts, rejected } }),
        "noteRecordingStt"
      ).state.status,
      "ready"
    );
  }
  assert.equal(matchingRejectedCredentials(health, new Map()).size, 0);
  assert.equal(
    matchingRejectedCredentials(
      health,
      new Map([["corti:text", { generation: 8, configFingerprint: "corti:text" }]])
    ).size,
    0,
    "a matching verified status is not rejection"
  );
});

test("change-driving: an invalid persisted Vertex auth source never appears ready", async () => {
  const route = (
    await routesOf(
      enterpriseChat("vertex", "gemini-2.5-flash", {
        enterprise: { vertexProject: "fixture-project", vertexAuthSource: "unknown" },
        facts: { credentials: keys("vertex") },
      })
    )
  ).chat;
  assert.equal(route.host, null);
  assert.deepEqual(route.state, { status: "unreachable", detail: "unsupported" });
});

test("change-driving: invalid saved local speech providers cannot borrow an installed sherpa engine", async () => {
  const { localSttModelKey, resolveRoutes } = await load();
  const model = "parakeet-tdt-0.6b-v3";
  for (const localProvider of ["unknown-provider", "", "constructor", "NVIDIA"]) {
    const selected = { mode: "local", localProvider, localModel: model };
    const snapshot = makeSnapshot({
      stt: { dictation: selected, meeting: selected, upload: selected },
      facts: { installed: { whisper: new Set(), sherpa: new Set([model]) } },
    });
    for (const route of resolveRoutes(snapshot).filter((route) => route.kind === "speech")) {
      assert.deepEqual(
        route.state,
        { status: "unreachable", detail: "unsupported" },
        localProvider
      );
      assert.equal(route.locality, "device");
      assert.equal(route.host, null);
      assert.equal(route.providerId, null);
      assert.equal(route.model, model, "keep the saved model id without naming a different engine");
    }
    assert.equal(
      localSttModelKey(localProvider, model),
      null,
      "invalid providers have no inventory key"
    );
    assert.equal(
      snapshot.stt.meeting.localProvider,
      localProvider,
      "do not replace the saved provider"
    );
    assert.equal(snapshot.stt.meeting.localModel, model, "do not replace the saved model");
  }
});

test("change-driving: local speech model keys and readiness recognize only the supported engine ids", async () => {
  const { localSttModelKey, resolveRoute } = await load();
  const { isSherpaLocalProvider } = require("../../src/helpers/parakeetModelInfo.js");
  for (const [localProvider, localModel, family] of [
    ["whisper", "base", "whisper"],
    ["nvidia", "parakeet-tdt-0.6b-v3", "sherpa"],
    ["cohere", "cohere-transcribe-03-2026", "sherpa"],
  ]) {
    assert.equal(isSherpaLocalProvider(localProvider), family === "sherpa");
    assert.equal(localSttModelKey(localProvider, localModel), `${family}:${localModel}`);
    const route = resolveRoute(
      makeSnapshot({
        stt: { meeting: { localProvider, localModel } },
        facts: { installed: { [family]: new Set([localModel]) } },
      }),
      "noteRecordingStt"
    );
    assert.deepEqual(route.state, { status: "ready" }, localProvider);
  }
});
