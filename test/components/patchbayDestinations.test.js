const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { makeSnapshot } = require("../lib/routeFixtures");

const CREDENTIAL_IDS = [
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "xai",
  "mistral",
  "openrouter",
  "tinfoil",
  "deepgram",
  "assemblyai",
  "corti:text",
  "corti:speech",
  "codex",
  "bedrock",
  "azure",
  "vertex",
];
// Main-confirmed presence for all 16 credential ids, as Task 3's facts store publishes it.
const creds = (present = []) => new Map(CREDENTIAL_IDS.map((id) => [id, present.includes(id)]));
// Whole-input replacements start from Task 1's all-local defaults (Whisper "base", local Qwen; both installed).
const BASE = makeSnapshot();
const stt = (o = {}) => ({ ...BASE.stt.dictation, ...o });
const llm = (o = {}) => ({ ...BASE.llm.dictationCleanup, ...o });
const LAN_A = "http://192.168.1.20:11434/v1";
const LAN_B = "http://192.168.1.30:8178";

// The default board: upload on OpenAI, translation on a LAN server, chat on Groq;
// cleanup and screen context off; OpenAI, Anthropic (rejected) and the Corti text key saved.
function snapshot() {
  return makeSnapshot({
    stt: {
      upload: { mode: "providers", cloudProvider: "openai", cloudModel: "gpt-4o-mini-transcribe" },
    },
    llm: {
      dictationTranslation: { mode: "self-hosted", remoteUrl: LAN_A, model: "llama3.1:8b" },
      chatIntelligence: { mode: "providers", provider: "groq", model: "openai/gpt-oss-120b" },
    },
    enabled: { cleanup: false, screenContext: false },
    facts: {
      credentials: creds(["openai", "anthropic", "corti:text"]),
      rejected: new Set(["anthropic"]),
    },
  });
}

const SPEECH = ["openai", "groq", "corti", "deepgram", "custom"];
const TEXT = ["openai", "anthropic", "groq", "corti", "custom"];
const providersFor = (id) =>
  id === "assistantVision"
    ? ["openai", "anthropic"]
    : id === "noteRecordingStt"
      ? ["openai", "corti", "deepgram"]
      : id === "dictationStt" || id === "uploadStt"
        ? SPEECH
        : TEXT;

let graph;
let d;
test.before(async () => {
  graph = await import("../../src/lib/routeGraph.ts");
  d = await import("../../src/components/settings/routing/destinations.ts");
});

function board(s) {
  const routes = graph.resolveRoutes(s);
  const dests = d.buildDestinations(s, routes);
  const route = (id) => routes.find((r) => r.id === id);
  const key = (id) => d.destinationKeyOf(route(id));
  const byId = Object.fromEntries(dests.map((x) => [x.id, x]));
  return { routes, dests, byId, route, key, ids: dests.map((x) => x.id) };
}
const ctx = (s, sealed = false) => d.compatContext(s, sealed, providersFor);

// change-driving: destinations.ts does not exist yet.
test("the default board: device first, one card per host, then providers in use or with a saved credential", () => {
  const b = board(snapshot());
  assert.deepEqual(b.ids, [
    "device",
    "network:192.168.1.20:11434",
    "network:new",
    "anthropic",
    "corti",
    "groq",
    "openai",
  ]);
  assert.equal(b.key("dictationStt"), "device");
  assert.equal(b.key("speakerId"), "device");
  assert.equal(b.key("uploadStt"), "openai");
  assert.equal(b.key("translation"), "network:192.168.1.20:11434");
  assert.equal(b.key("chat"), "groq");
  assert.equal(b.byId["network:192.168.1.20:11434"].host, "192.168.1.20:11434");
  assert.equal(b.byId.openai.host, "api.openai.com");
  assert.equal(
    b.byId.corti.host,
    BASE.capabilities.providerHosts["corti:text"],
    "only the corti:text key is saved, so the card names the Corti text host"
  );
});

// change-driving (I7): a provider card names the host its routes really reach; Corti text and speech differ.
test("a provider card names the host its routes resolve to, or its saved slot's host", () => {
  const hosts = BASE.capabilities.providerHosts;
  const s = snapshot();
  s.llm.chatIntelligence = llm({ mode: "providers", provider: "corti", model: "corti-chat" });
  let b = board(s);
  assert.equal(
    b.route("chat").host,
    hosts["corti:text"],
    "precondition from Task 1: text routes use the corti:text host"
  );
  assert.equal(b.byId.corti.host, hosts["corti:text"]);

  s.stt.dictation = stt({ mode: "providers", cloudProvider: "corti" });
  b = board(s);
  assert.equal(
    b.route("dictationStt").host,
    hosts.corti,
    "precondition from Task 1: speech uses the regional host"
  );
  assert.equal(
    b.byId.corti.host,
    hosts.corti,
    "two distinct in-use hosts fall back to the provider's own entry"
  );

  const keysOnly = snapshot();
  keysOnly.facts.credentials = creds(["corti:text", "corti:speech"]);
  assert.equal(
    board(keysOnly).byId.corti.host,
    hosts.corti,
    "with both keys and no route, the speech slot wins"
  );
});

// change-driving (I7): v1 re-derived the id from settings and read the vision scope.
test("I7: assistant vision following the assistant is attributed to the assistant's provider, whatever the stale vision scope says", () => {
  const s = snapshot();
  s.enabled.screenContext = true;
  s.enabled.visionOverride = false;
  s.llm.dictationAgent = llm({ mode: "providers", provider: "openai", model: "gpt-4o" });
  s.llm.dictationAgentVision = llm({
    mode: "providers",
    provider: "anthropic",
    model: "claude-sonnet-4",
  }); // stale
  s.facts.credentials = creds(["openai"]);
  s.facts.rejected = new Set();
  const b = board(s);
  assert.equal(
    b.route("assistantVision").providerId,
    "openai",
    "precondition from Task 1: vision follows the assistant"
  );
  assert.equal(b.key("assistantVision"), "openai");
  assert.equal(b.key("voiceAssistant"), "openai");
  assert.ok(!b.ids.includes("anthropic"), "the stale vision scope must not create a destination");
});

// change-driving (I7): v1 showed the first configured URL for every network route.
test("I7: two LAN servers are two destinations, and each route lands on its own host", () => {
  const s = snapshot();
  s.stt.dictation = stt({ mode: "self-hosted", remoteUrl: LAN_B, remoteModel: "whisper" });
  const b = board(s);
  assert.deepEqual(
    b.ids.filter((id) => id.startsWith("network:") && id !== "network:new"),
    ["network:192.168.1.20:11434", "network:192.168.1.30:8178"]
  );
  assert.equal(b.key("dictationStt"), "network:192.168.1.30:8178");
  assert.equal(b.key("translation"), "network:192.168.1.20:11434");
  assert.equal(b.byId["network:192.168.1.30:8178"].urls.speech, LAN_B);
  assert.equal(b.byId["network:192.168.1.30:8178"].urls.text, null);
  assert.equal(b.byId["network:192.168.1.20:11434"].urls.text, LAN_A);
  assert.equal(
    b.byId["network:192.168.1.20:11434"].urls.speech,
    null,
    "an LLM server is not a speech server"
  );
});

// change-driving (I7): an inactive loopback URL listed first must not become the network card.
test("I7: inactive and loopback URLs never become a network destination, even listed before the active LAN server", () => {
  const s = snapshot();
  s.stt.dictation = stt({ mode: "local", remoteUrl: "http://localhost:8178" }); // inactive loopback URL, first in object order
  s.stt.meeting = stt({ mode: "local", remoteUrl: "http://10.0.0.9:9" }); // inactive LAN URL
  s.llm.noteFormatting = llm({ mode: "self-hosted", remoteUrl: "http://127.0.0.1:11434/v1" }); // active loopback
  const b = board(s);
  assert.equal(
    b.route("noteFormatting").locality,
    "device",
    "precondition from Task 1: loopback self-hosted is on this device"
  );
  assert.equal(b.key("noteFormatting"), "device");
  assert.deepEqual(
    b.ids.filter((id) => id.startsWith("network:") && id !== "network:new"),
    ["network:192.168.1.20:11434"]
  );
  assert.ok(
    !b.dests.some(
      (x) => x.host === "localhost:8178" || x.host === "10.0.0.9:9" || x.host === "127.0.0.1:11434"
    )
  );
});

// change-driving: custom endpoints are remote with a host; retired and addressless routes have no destination.
test("a LAN custom endpoint is its own destination; a retired service and an addressless server have none", () => {
  const s = snapshot();
  s.llm.noteFormatting = llm({
    mode: "providers",
    provider: "custom",
    model: "m",
    cloudBaseUrl: "http://192.168.1.50:1234/v1",
  });
  s.stt.dictation = stt({ mode: "openwhispr" });
  s.llm.chatIntelligence = llm({ mode: "self-hosted", remoteUrl: "not a url" });
  const b = board(s);
  assert.equal(b.key("noteFormatting"), "custom:192.168.1.50:1234");
  assert.equal(b.byId["custom:192.168.1.50:1234"].kind, "custom");
  assert.equal(b.byId["custom:192.168.1.50:1234"].urls.text, "http://192.168.1.50:1234/v1");
  assert.equal(b.route("dictationStt").state.detail, "retired", "precondition from Task 1");
  assert.equal(b.key("dictationStt"), null);
  assert.ok(!b.ids.includes("openwhispr"));
  assert.equal(b.route("chat").state.status, "needsUrl", "precondition from Task 1");
  assert.equal(b.key("chat"), null);
});

// change-driving: compatibility explains every refusal.
test("compatibility explains every refusal and consults the injected provider catalog", () => {
  const s = snapshot();
  const b = board(s);
  const c = ctx(s);
  const check = (route, id) => d.checkCompatibility(route, b.byId[id], c);
  assert.deepEqual(check("dictationStt", "device"), { ok: true });
  assert.deepEqual(check("chat", "openai"), { ok: true });
  assert.deepEqual(check("dictationStt", "anthropic"), {
    ok: false,
    reasonKey: "patchbay.no.capability",
    params: { provider: "anthropic" },
  });
  assert.equal(check("speakerId", "device").reasonKey, "patchbay.locked.speakerId");
  assert.equal(check("semanticSearch", "openai").reasonKey, "patchbay.locked.semanticSearch");
  assert.equal(check("assistantVision", "device").reasonKey, "patchbay.no.visionCloudOnly");
  assert.equal(check("assistantVision", "network:new").reasonKey, "patchbay.no.visionCloudOnly");
  assert.deepEqual(check("assistantVision", "openai"), { ok: true });
  assert.equal(check("noteRecordingStt", "network:new").reasonKey, "patchbay.no.meetingServer");
  assert.equal(
    check("noteRecordingStt", "network:192.168.1.20:11434").reasonKey,
    "patchbay.no.meetingServer"
  );
  assert.equal(check("noteRecordingStt", "groq").reasonKey, "patchbay.no.capability");
});

// change-driving: a server only offers itself to the kind of task it already serves.
test("a server is offered to speech tasks only when it is a known speech server, and upload shares dictation's server", () => {
  const s = snapshot();
  s.stt.dictation = stt({ mode: "self-hosted", remoteUrl: LAN_B, remoteModel: "whisper" });
  const b = board(s);
  const c = ctx(s);
  const llmServer = b.byId["network:192.168.1.20:11434"];
  const speechServer = b.byId["network:192.168.1.30:8178"];
  assert.deepEqual(d.checkCompatibility("chat", llmServer, c), { ok: true });
  assert.deepEqual(d.checkCompatibility("dictationStt", speechServer, c), { ok: true });
  assert.deepEqual(d.checkCompatibility("dictationStt", llmServer, c), {
    ok: false,
    reasonKey: "patchbay.no.serverKind",
    params: { server: "192.168.1.20:11434", kind: "speech" },
  });
  assert.deepEqual(d.checkCompatibility("chat", speechServer, c), {
    ok: false,
    reasonKey: "patchbay.no.serverKind",
    params: { server: "192.168.1.30:8178", kind: "text" },
  });
  assert.deepEqual(
    d.checkCompatibility("uploadStt", speechServer, c),
    { ok: true },
    "upload may use the server dictation uses"
  );
  assert.equal(
    d.checkCompatibility("uploadStt", b.byId["network:new"], c).reasonKey,
    "patchbay.no.uploadServer"
  );
});

// change-driving (I14): sealed state gates every non-device destination.
test("sealed mode refuses every destination except this device", () => {
  const s = snapshot();
  const b = board(s);
  const c = ctx(s, true);
  assert.deepEqual(d.checkCompatibility("chat", b.byId.device, c), { ok: true });
  for (const id of ["openai", "network:192.168.1.20:11434", "network:new"]) {
    assert.equal(d.checkCompatibility("chat", b.byId[id], c).reasonKey, "patchbay.no.sealed", id);
  }
});

// change-driving: targets are built from the destination alone; no destination reuses "the first URL".
test("targets: device is local, a host reuses its own URL of the right kind, add-server is empty, providers are bare", () => {
  const s = snapshot();
  s.stt.dictation = stt({ mode: "self-hosted", remoteUrl: LAN_B, remoteModel: "whisper" });
  s.llm.noteFormatting = llm({
    mode: "providers",
    provider: "custom",
    model: "m",
    cloudBaseUrl: "http://192.168.1.50:1234/v1",
  });
  const b = board(s);
  assert.deepEqual(d.targetForDestination("chat", b.byId.device), { mode: "local" });
  assert.deepEqual(d.targetForDestination("chat", b.byId["network:192.168.1.20:11434"]), {
    mode: "self-hosted",
    remoteUrl: LAN_A,
  });
  assert.deepEqual(d.targetForDestination("dictationStt", b.byId["network:192.168.1.30:8178"]), {
    mode: "self-hosted",
    remoteUrl: LAN_B,
  });
  assert.deepEqual(d.targetForDestination("chat", b.byId["network:new"]), {
    mode: "self-hosted",
    remoteUrl: "",
  });
  assert.deepEqual(d.targetForDestination("dictationCleanup", b.byId.openai), {
    mode: "providers",
    provider: "openai",
  });
  assert.deepEqual(d.targetForDestination("chat", b.byId["custom:192.168.1.50:1234"]), {
    mode: "providers",
    provider: "custom",
    baseUrl: "http://192.168.1.50:1234/v1",
  });
});

// change-driving (I10): Corti has a text key and a speech client pair; a provider card reports the slot the selected task uses.
test("key state follows the credential slot the task uses, and unknown stays unknown", () => {
  const s = snapshot();
  s.facts.credentials = creds(["openai", "anthropic", "corti:text"]);
  s.facts.rejected = new Set(["anthropic"]);
  const b = board(s);
  const f = s.facts;
  assert.equal(d.destinationKeyState(b.byId.openai, f, "text"), "saved");
  assert.equal(d.destinationKeyState(b.byId.groq, f, "text"), "missing");
  assert.equal(d.destinationKeyState(b.byId.anthropic, f, "text"), "rejected");
  assert.equal(d.destinationKeyState(b.byId.corti, f, "text"), "saved");
  assert.equal(
    d.destinationKeyState(b.byId.corti, f, "speech"),
    "missing",
    "the speech client pair is not saved"
  );
  assert.equal(d.destinationKeyState(b.byId.device, f, "text"), "none");
  assert.equal(
    d.destinationKeyState(
      { ...b.byId.openai, id: "custom:h", kind: "custom", providerId: "custom" },
      f,
      "text"
    ),
    "none"
  );
  assert.equal(
    d.destinationKeyState(b.byId.openai, { ...f, credentials: null }, "text"),
    "unknown"
  );
  // baseline guard: a partially published slot map is uncertainty, not absence.
  assert.equal(
    d.destinationKeyState(
      b.byId.openai,
      { ...f, credentialUnknown: new Set(["openai"]), credentials: new Map() },
      "text"
    ),
    "unknown"
  );
  assert.equal(d.credentialIdFor("corti", "speech"), "corti:speech");
  assert.equal(d.credentialIdFor("corti", "text"), "corti:text");
  assert.equal(d.credentialIdFor("custom", "text"), null);
});

// change-driving: labels never use the English display name.
test("labels: hosts for servers, localized names for providers and custom endpoints", () => {
  const s = snapshot();
  s.llm.noteFormatting = llm({
    mode: "providers",
    provider: "custom",
    model: "m",
    cloudBaseUrl: "http://192.168.1.50:1234/v1",
  });
  const b = board(s);
  const t = (key, o) => (o ? `${key}${JSON.stringify(o)}` : key);
  assert.equal(d.destinationLabel(b.byId.device, t), "locality.device");
  assert.equal(d.destinationLabel(b.byId.openai, t), "OpenAI");
  assert.equal(
    d.destinationLabel(b.byId["network:192.168.1.20:11434"], t),
    'patchbay.dest.serverAt{"host":"192.168.1.20:11434"}'
  );
  assert.equal(
    d.destinationLabel(b.byId["custom:192.168.1.50:1234"], t),
    'patchbay.dest.endpointAt{"name":"locality.customEndpoint","host":"192.168.1.50:1234"}'
  );
  assert.equal(
    d.routeDestinationLabel(b.route("translation"), t),
    'patchbay.dest.serverAt{"host":"192.168.1.20:11434"}'
  );
  // Status-line phrases read inside a sentence ("Chat now runs on this device."), unlike the card headings.
  assert.equal(d.destinationPlace(b.byId.device, t), "patchbay.place.device");
  assert.equal(
    d.destinationPlace(b.byId.openai, t),
    'patchbay.place.provider{"provider":"OpenAI"}'
  );
  assert.equal(
    d.routePlace(b.route("translation"), t),
    'patchbay.place.server{"host":"192.168.1.20:11434"}'
  );
  assert.equal(
    d.destinationPlace(b.byId["custom:192.168.1.50:1234"], t),
    'patchbay.place.endpoint{"name":"locality.customEndpoint","host":"192.168.1.50:1234"}'
  );
  const refusal = d.checkCompatibility("dictationStt", b.byId.anthropic, ctx(s));
  assert.equal(d.compatReason(refusal, t), 'patchbay.no.capability{"provider":"Anthropic"}');
});

// change-driving: tally and cables.
test("the tally counts what stays on this device; cables are horizontal-tangent cubic Beziers", () => {
  const b = board(snapshot());
  // 6 device routes + cleanup (off) + assistant vision (off: screen context is off) stay; translation is on the network; upload and chat are remote.
  assert.deepEqual(d.privacyTally(b.routes), { total: 11, stay: 8, network: 1, remote: 2 });
  assert.equal(
    d.cablePath({ x: 10, y: 20 }, { x: 310, y: 80 }),
    "M 10 20 C 130 20, 190 80, 310 80"
  );
});

// change-driving (source guard): destinations.ts does not exist yet; afterwards this pins I7, so
// destination identity can never be re-derived from settings.
test("destinations.ts reads the resolved route only, never settings, targets or the store", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../src/components/settings/routing/destinations.ts"),
    "utf8"
  );
  assert.doesNotMatch(source, /targetFromSnapshot|settingsStore|routeDraftStore|from "react"/);
  assert.equal(d.destinationKeyOf.length, 1, "identity is a function of the route alone");
});
