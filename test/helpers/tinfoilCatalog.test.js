const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const catalogModulePath = require.resolve("../../src/helpers/tinfoilCatalog.js");
const originalLoad = Module._load;
// The catalog is gated (Sealed mode). These tests run unsealed unless stated.
const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");
let sealed = false;
// A strictly increasing clock keeps the ledger's newest-first order exact.
let clock = 0;
const now = () => ++clock;
const recorder = new FlightRecorder({ now });
gate.configureEgress({ isSealed: () => sealed, recorder, now });

function loadCatalog(fetchImpl) {
  delete require.cache[catalogModulePath];

  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === "./tinfoilSecureClient") {
      return { tinfoilSecureFetch: fetchImpl };
    }
    if (request === "./debugLogger") {
      return { warn() {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(catalogModulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function okResponse(data) {
  return { ok: true, status: 200, json: async () => ({ object: "list", data }) };
}

const CHAT_MODEL = {
  id: "glm-5-3",
  name: "GLM-5.3",
  description: "d",
  type: "chat",
  reasoning: true,
  endpoints: ["/v1/chat/completions"],
};

test("keeps only chat models reachable at /v1/chat/completions", async () => {
  const { getTinfoilChatModels } = loadCatalog(async () =>
    okResponse([
      CHAT_MODEL,
      { id: "voxtral", name: "Voxtral", type: "audio", endpoints: ["/v1/audio/transcriptions"] },
      { id: "embed", name: "Embed", type: "embedding", endpoints: ["/v1/embeddings"] },
      { id: "chat-no-endpoint", name: "Odd", type: "chat", endpoints: ["/v1/responses"] },
    ])
  );

  assert.deepEqual(await getTinfoilChatModels(), [
    { id: "glm-5-3", name: "GLM-5.3", description: "d", supportsThinking: true },
  ]);
});

test("reports supportsThinking from the reasoning flag", async () => {
  const { getTinfoilChatModels } = loadCatalog(async () =>
    okResponse([{ ...CHAT_MODEL, id: "llama3-3-70b", name: "Llama", reasoning: false }])
  );

  const [model] = await getTinfoilChatModels();
  assert.equal(model.supportsThinking, false);
});

test("shares one in-flight request between concurrent callers", async () => {
  let calls = 0;
  const { getTinfoilChatModels } = loadCatalog(async () => {
    calls += 1;
    return okResponse([CHAT_MODEL]);
  });

  const [first, second] = await Promise.all([getTinfoilChatModels(), getTinfoilChatModels()]);

  assert.equal(calls, 1);
  assert.equal(first, second);
});

test("rejects rather than returning a list when the payload is malformed", async () => {
  const { getTinfoilChatModels } = loadCatalog(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ object: "list" }),
  }));

  await assert.rejects(getTinfoilChatModels(), /Malformed models list/);
});

test("rejects on a non-200 response", async () => {
  const { getTinfoilChatModels } = loadCatalog(async () => ({ ok: false, status: 503 }));

  await assert.rejects(getTinfoilChatModels(), /503/);
});

test("backs off after a failure instead of refetching on every call", async () => {
  let calls = 0;
  const { getTinfoilChatModels } = loadCatalog(async () => {
    calls += 1;
    throw new Error("ENOTFOUND");
  });

  await assert.rejects(getTinfoilChatModels());
  await assert.rejects(getTinfoilChatModels(), /unavailable/);
  await assert.rejects(getTinfoilChatModels(), /unavailable/);

  assert.equal(calls, 1);
});

test("sealed: the catalog is refused before the SDK attests, and a refusal is not a Tinfoil failure", async () => {
  let calls = 0;
  const { getTinfoilChatModels } = loadCatalog(async () => {
    calls += 1;
    return okResponse([CHAT_MODEL]);
  });
  sealed = true;
  try {
    await assert.rejects(getTinfoilChatModels(), (error) => sealedPhaseOf(error) === "refused");
  } finally {
    sealed = false;
  }
  assert.equal(calls, 0, "nothing reached the attested client");
  assert.deepEqual(
    [recorder.list()[0].task, recorder.list()[0].host, recorder.list()[0].outcome],
    ["providerCheck", "inference.tinfoil.sh", "blocked"]
  );
  // No back-off: the first unsealed request is sent.
  assert.equal((await getTinfoilChatModels()).length, 1);
  assert.equal(calls, 1);
  const row = recorder.list()[0];
  assert.deepEqual(
    [row.task, row.kind, row.outcome, row.status],
    ["providerCheck", "request", "ok", 200]
  );
});
