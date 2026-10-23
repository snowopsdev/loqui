const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { PassThrough, Writable } = require("node:stream");
const { installElectronStub } = require("./harness/electronStub");

installElectronStub();
const gate = require("../../src/helpers/privacy/egressGate");
const childRegistry = require("../../src/helpers/privacy/childRegistry");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError, sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");
const {
  providerEndpoint,
  effectiveEndpoint,
} = require("../../src/helpers/privacy/providerEndpoints");
const {
  registerPersonalInferenceIPC,
  gatedVerifyRelease,
  createCodexServer,
  codexSession,
} = require("../../src/helpers/personalInference");
const fixture = require("../fixtures/codex-app-server-0.154.json");

const REACHED = "reached the model factory";
// A strictly increasing clock keeps the ledger's newest-first order exact.
let clock = 0;
const now = () => ++clock;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function harness(t, { sealed = false, modelFactory, fetchImpl, credentials, fetchModels } = {}) {
  const flags = { sealed };
  const recorder = new FlightRecorder({ now });
  gate._resetForTests();
  childRegistry._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now });
  t.after(() => {
    gate._resetForTests();
    childRegistry._resetForTests();
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-pi-sealed-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const handlers = new Map();
  const calls = {
    credential: 0,
    enterpriseConfig: 0,
    factory: [],
    codex: [],
    stopped: 0,
    captured: 0,
    fetchModels: [],
    fetched: [],
  };
  const codex = Object.assign(new EventEmitter(), {
    stop() {},
    erase: async () => {},
    alive: () => false,
    stopAndWait: async () => {
      calls.stopped++;
    },
  });
  for (const method of [
    "status",
    "login",
    "cancelLogin",
    "logout",
    "models",
    "modelCatalog",
    "rateLimits",
    "generate",
  ])
    codex[method] = async () => {
      calls.codex.push(method);
      return method === "login" ? { authUrl: "https://auth.openai.com/x", loginId: "l" } : {};
    };
  const api = registerPersonalInferenceIPC({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn), removeHandler: (c) => handlers.delete(c) },
    userDataPath: dir,
    getCredential: async () => {
      calls.credential++;
      return "sk-test";
    },
    getEnterpriseConfig: async () => {
      calls.enterpriseConfig++;
      return {};
    },
    credentials: credentials?.(calls),
    saveCredential: async () => {},
    openExternal: async () => {},
    codex,
    fetchImpl: fetchImpl
      ? async (...args) => {
          calls.fetched.push(args);
          return fetchImpl(...args);
        }
      : undefined,
    fetchModels: async (...args) => {
      calls.fetchModels.push(args);
      return (fetchModels ?? (async () => new Response('{"data":[]}')))(...args);
    },
    modelFactory:
      modelFactory ??
      (async (...args) => {
        calls.factory.push(args);
        throw new Error(REACHED);
      }),
  });
  t.after(() => api.dispose());
  const sent = [];
  const sender = Object.assign(new EventEmitter(), {
    id: 1,
    isDestroyed: () => false,
    send: (c, p) => sent.push([c, p]),
  });
  const invoke = (name, ...args) => handlers.get(`personal-inference:${name}`)({ sender }, ...args);
  return { flags, recorder, calls, invoke, sent, api, sender };
}

const chatRequest = (overrides = {}) => ({
  provider: "groq",
  requestId: `r-${Math.random()}`,
  model: "llama-3.3",
  credentialRef: "groq",
  inferenceScope: "chatIntelligence",
  messages: [{ role: "user", content: "secret plans" }],
  ...overrides,
});

test("sealed: text-generate is refused before credentials or the SDK are touched", async (t) => {
  const h = harness(t, { sealed: true });
  await assert.rejects(
    h.invoke("text-generate", chatRequest()),
    (e) => sealedPhaseOf(e) === "refused"
  );
  assert.equal(h.calls.credential, 0);
  assert.equal(h.calls.factory.length, 0);
  const rows = h.recorder.list();
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [rows[0].task, rows[0].host, rows[0].outcome, rows[0].bytesOut, rows[0].model],
    ["chat", "api.groq.com", "blocked", 0, "llama-3.3"]
  );
});

test("sealed: an enterprise request is refused before credentials or its config are read", async (t) => {
  const h = harness(t, { sealed: true });
  await assert.rejects(
    h.invoke(
      "text-generate",
      chatRequest({ provider: "azure", credentialRef: "azure", model: "deployment" })
    ),
    isSealedModeError
  );
  assert.equal(h.calls.credential, 0);
  assert.equal(h.calls.enterpriseConfig, 0);
  assert.equal(h.calls.factory.length, 0);
  assert.equal(h.recorder.list()[0].outcome, "blocked");
});

test("sealed: text-stream reports SEALED_MODE as a typed stream error", async (t) => {
  const h = harness(t, { sealed: true });
  const request = chatRequest();
  await h.invoke("text-stream", request);
  const error = h.sent.map(([, p]) => p).find((p) => p.type === "error");
  assert.equal(error.code, "SEALED_MODE");
  assert.equal(error.requestId, request.requestId);
  assert.match(error.error, /\[SEALED_MODE\]/);
});

test("sealed: a loopback provider still reaches the model factory", async (t) => {
  const h = harness(t, { sealed: true });
  await assert.rejects(
    h.invoke(
      "text-generate",
      chatRequest({
        provider: "local",
        credentialRef: undefined,
        baseUrl: "http://127.0.0.1:8080/v1",
        inferenceScope: "dictationCleanup",
      })
    ),
    new RegExp(REACHED)
  );
  assert.equal(h.calls.factory.length, 1);
  assert.equal(h.recorder.list().length, 0, "loopback is never recorded");
});

test("unsealed: slot 8 is a metered fetch over the injected transport; notices carry task, target, payload and correlation id", async (t) => {
  const notices = [];
  const h = harness(t, {
    fetchImpl: async () => new Response("{}", { status: 200 }),
    modelFactory: async (...args) => {
      assert.equal(args.length, 9, "nine factory slots are preserved");
      await args[7]("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        body: "{}",
      });
      throw new Error(REACHED);
    },
  });
  for (const phase of ["dispatched", "delivered"])
    gate.events.on(phase, (n) => notices.push({ phase, ...n }));
  await assert.rejects(
    h.invoke(
      "text-generate",
      chatRequest({ inferenceScope: "noteFormatting", correlationId: "note-7" })
    ),
    new RegExp(REACHED)
  );
  assert.equal(h.calls.fetched.length, 1, "the injected transport carried the request");
  assert.deepEqual(
    notices.map((n) => [n.phase, n.task, n.targetId, n.payload, n.correlationId]),
    [
      ["dispatched", "noteFormatting", "groq", "text", "note-7"],
      ["delivered", "noteFormatting", "groq", "text", "note-7"],
    ]
  );
  assert.equal(typeof notices[0].ticketId, "number");
  const [row] = h.recorder.list();
  assert.deepEqual(
    [row.task, row.host, row.kind, row.status, row.bytesOut],
    ["noteFormatting", "api.groq.com", "request", 200, 2]
  );
});

test("dictation cleanup notices feed the real disclosure tracker for the original session", async (t) => {
  const { createDisclosureTracker } = await import("../../src/helpers/dictationDisclosure.js");
  const h = harness(t, {
    fetchImpl: async () => new Response('{"ok":true}', { status: 200 }),
    modelFactory: async (...args) => {
      const response = await args[7]("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        body: "{}",
      });
      await response.text();
      throw new Error(REACHED);
    },
  });
  const privacyApi = {
    onEgress(listener) {
      const relay = (phase) => (notice) => listener({ phase, ...notice });
      const handlers = ["dispatched", "delivered", "undelivered"].map((phase) => {
        const fn = relay(phase);
        gate.events.on(phase, fn);
        return [phase, fn];
      });
      return () => handlers.forEach(([phase, fn]) => gate.events.off(phase, fn));
    },
  };
  const tracker = createDisclosureTracker({
    session: { id: "session-7", routes: {} },
    privacyApi,
    dispatchApi: {},
  });
  t.after(() => tracker.dispose());
  await assert.rejects(
    h.invoke(
      "text-generate",
      chatRequest({
        inferenceScope: "dictationCleanup",
        disclosureTask: "dictationCleanup",
        correlationId: "session-7",
      })
    ),
    new RegExp(REACHED)
  );
  assert.deepEqual(tracker.get(), {
    target: "groq",
    payload: "text",
    evidence: "attested",
    alsoSentTo: [],
  });
});

test("sealing mid-request rejects as 'interrupted', not as a timeout or as 'nothing sent'", async (t) => {
  const h = harness(t, {
    modelFactory: async () => {
      const ticket = gate.currentTicket();
      await new Promise((_resolve, reject) =>
        ticket.signal.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted", "AbortError"))
        )
      );
    },
  });
  const pending = h.invoke("text-generate", chatRequest());
  await tick();
  h.flags.sealed = true;
  gate.abortAllRemote();
  await assert.rejects(pending, (e) => sealedPhaseOf(e) === "interrupted");
  const [row] = h.recorder.list();
  assert.deepEqual([row.outcome, row.errorClass], ["cancelled", "SEALED_MODE"]);
});

function discoveryCredentials(calls) {
  const row = { id: "openrouter", present: true, generation: 3 };
  return {
    list: () => [row],
    captureCommitted: async (id) => {
      calls.captured++;
      return { ...row, id, values: { key: "or-key" } };
    },
  };
}

test("sealed: model discovery is refused after recipient validation and before credential capture", async (t) => {
  const h = harness(t, { credentials: discoveryCredentials });
  const input = { provider: "openrouter", credentialRef: "openrouter" };
  const { recipientToken } = await h.invoke("describe-models", input);
  h.flags.sealed = true;
  await assert.rejects(h.invoke("models", { ...input, recipientToken }), isSealedModeError);
  assert.equal(h.calls.captured, 0, "no committed credential was captured");
  assert.equal(h.calls.fetchModels.length, 0);
  const [row] = h.recorder.list();
  assert.deepEqual(
    [row.task, row.host, row.outcome],
    ["providerCheck", "openrouter.ai", "blocked"]
  );
  // An unreviewed request still fails on its recipient, never as Sealed mode.
  await assert.rejects(h.invoke("models", { ...input, recipientToken: "forged" }), {
    code: "RECIPIENT_CHANGED",
  });
});

test("unsealed: model discovery is metered under providerCheck", async (t) => {
  const h = harness(t, {
    credentials: discoveryCredentials,
    fetchModels: async () => new Response('{"data":[{"id":"m1"}]}', { status: 200 }),
  });
  const input = { provider: "openrouter", credentialRef: "openrouter" };
  const { recipientToken } = await h.invoke("describe-models", input);
  const result = await h.invoke("models", { ...input, recipientToken });
  assert.deepEqual(
    result.data.map((m) => m.id),
    ["m1"]
  );
  assert.equal(h.calls.fetchModels[0][0], "https://openrouter.ai/api/v1/models");
  assert.equal(h.calls.fetchModels[0][1].redirect, "error");
  assert.equal(
    new Headers(h.calls.fetchModels[0][1].headers).get("authorization"),
    "Bearer or-key"
  );
  const [row] = h.recorder.list();
  assert.deepEqual(
    [row.task, row.host, row.outcome, row.bytesIn],
    ["providerCheck", "openrouter.ai", "ok", 22]
  );
});

test("sealed: every Codex handler that can start or use the app-server is refused; cancel-login is not", async (t) => {
  const h = harness(t, { sealed: true });
  for (const name of [
    "codex-status",
    "codex-login",
    "codex-logout",
    "codex-models",
    "codex-model-catalog",
    "codex-rate-limits",
  ])
    await assert.rejects(h.invoke(name), isSealedModeError, name);
  await assert.rejects(
    h.invoke("text-generate", chatRequest({ provider: "codex", credentialRef: undefined })),
    isSealedModeError
  );
  assert.deepEqual(h.calls.codex, []);
  await h.invoke("codex-cancel-login", "l");
  assert.deepEqual(h.calls.codex, ["cancelLogin"]);
  assert.ok(h.recorder.list().every((row) => row.host === "chatgpt.com"));
});

function codexChild(pid, results = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.received = [];
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    setImmediate(() => child.emit("exit", null, "SIGTERM"));
    return true;
  };
  const answers = { initialize: fixture.initialize, ...results };
  child.stdin = new Writable({
    write(bytes, _e, cb) {
      const m = JSON.parse(bytes.toString());
      child.received.push(m.method);
      cb();
      if (m.id !== undefined && Object.hasOwn(answers, m.method))
        queueMicrotask(() =>
          child.stdout.write(JSON.stringify({ id: m.id, result: answers[m.method] }) + "\n")
        );
    },
  });
  return child;
}

test("the production Codex server refuses its probe and spawn while sealed, and runs each process as one opaque session", async (t) => {
  const h = harness(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-codex-prod-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const executable = path.join(dir, "codex-fixture-binary");
  fs.writeFileSync(executable, "fixture executable bytes");
  let spawned = 0;
  let probes = 0;
  const child = codexChild(777);
  const seams = {
    userDataPath: dir,
    platform: "linux",
    resolveExecutable: async () => executable,
    runFile: async () => {
      probes++;
      return { stdout: fixture.version };
    },
    spawnProcess: () => {
      spawned++;
      // The spawn runs inside the Codex session ticket, so the production
      // spawn guard reuses it instead of opening a second session.
      assert.equal(gate.currentTicket()?.meter, "opaque");
      assert.equal(gate.currentTicket()?.task, "codex");
      return child;
    },
    // Not seams: ignored, so the shipped hooks stay in place.
    beforeSpawn: () => {},
    onSpawn: () => {},
    verifyRelease: async () => {},
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => assert.fail("no release lookup is needed for a cached digest");
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  h.flags.sealed = true;
  await assert.rejects(createCodexServer(seams).start(), isSealedModeError);
  assert.equal(probes, 0, "no native version probe while sealed");
  assert.equal(spawned, 0);
  assert.deepEqual(
    h.recorder.list().map((row) => [row.task, row.host, row.outcome]),
    [["codex", "chatgpt.com", "blocked"]]
  );

  h.flags.sealed = false;
  const server = createCodexServer(seams);
  const { createHash } = require("node:crypto");
  const cpu = { x64: "x86_64", arm64: "aarch64" }[process.arch];
  server.verifiedReleases.set(
    `0.154.0-${cpu}-unknown-linux-musl`,
    createHash("sha256").update(fs.readFileSync(executable)).digest("hex")
  );
  await server.start();
  assert.equal(probes, 1);
  assert.equal(spawned, 1);
  assert.equal(server.alive(), true);
  assert.equal(h.recorder.list().length, 1, "cached verification and a live session write no row");
  assert.equal(gate.activeRemoteCount(), 1, "the live session is remote evidence");
  await server.stopAndWait();
  assert.equal(server.alive(), false);
  const [row] = h.recorder.list();
  assert.deepEqual(
    [row.task, row.host, row.kind, row.opaque, row.bytesOut, row.bytesIn, row.outcome],
    ["codex", "chatgpt.com", "session", true, null, null, "cancelled"]
  );
  assert.equal(gate.activeRemoteCount(), 0);
});

test("each Codex app-server process is one opaque session, settled only by its exit", async (t) => {
  const h = harness(t);
  const run = Object.assign(new EventEmitter(), { pid: 778, kill: () => true });
  codexSession(run);
  assert.equal(h.recorder.list().length, 0, "the session row is written on exit, not on spawn");
  assert.ok(childRegistry.alive("codex").some((c) => c.pid === 778));
  assert.equal(gate.activeRemoteCount(), 1);
  run.emit("exit", 0, null);
  const [row] = h.recorder.list();
  assert.deepEqual(
    [row.task, row.host, row.opaque, row.bytesOut, row.outcome],
    ["codex", "chatgpt.com", true, null, "ok"]
  );
  assert.equal(gate.activeRemoteCount(), 0);
  // 07a: root exit is not whole-tree proof; registry coverage stays unresolved.
  assert.ok(
    childRegistry
      .diagnostics()
      .unresolved.some((e) => e.kind === "codex" && e.pid === 778 && e.rootExited === true)
  );

  // Sealing aborts the session and kills the process; only the exit settles it.
  const second = Object.assign(new EventEmitter(), { pid: 779, kills: 0 });
  second.kill = () => {
    second.kills++;
    return true;
  };
  codexSession(second);
  h.flags.sealed = true;
  gate.abortAllRemote();
  assert.equal(second.kills, 1);
  assert.equal(h.recorder.list().length, 1, "abort does not settle the opaque session");
  second.emit("exit", null, "SIGTERM");
  assert.deepEqual(
    [h.recorder.list()[0].outcome, h.recorder.list()[0].errorClass],
    ["cancelled", "SEALED_MODE"]
  );

  // A spawn that fails asynchronously has no pid and never exits (N2).
  h.flags.sealed = false;
  const failed = new EventEmitter();
  failed.kill = () => true;
  codexSession(failed);
  failed.emit("error", Object.assign(new Error("spawn EACCES"), { code: "EACCES" }));
  failed.emit("close", -2, null);
  assert.equal(gate.activeRemoteCount(), 0, "the session settled; sealing cannot wait on it");
  assert.equal(h.recorder.list().length, 2, "a process that never started writes no session");
});

test("Codex verification is gated; a cached verification writes no row; stopCodex waits", async (t) => {
  const h = harness(t, { sealed: true });
  let verified = 0;
  await assert.rejects(
    gatedVerifyRelease(async () => {
      verified++;
    })({}),
    isSealedModeError
  );
  assert.equal(verified, 0);
  assert.equal(h.recorder.list().length, 1);
  h.flags.sealed = false;
  await gatedVerifyRelease(async () => {
    verified++;
  })({});
  assert.equal(verified, 1);
  assert.equal(h.recorder.list().length, 1, "nothing was fetched, so nothing is recorded");
  let fetched = 0;
  await gatedVerifyRelease(async ({ fetchImpl }) => {
    const response = await fetchImpl("https://api.github.com/repos/openai/codex/releases/tags/x");
    await response.text();
  })({
    fetchImpl: async () => {
      fetched++;
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(fetched, 1);
  assert.deepEqual(
    [h.recorder.list()[0].task, h.recorder.list()[0].host, h.recorder.list()[0].outcome],
    ["codex", "api.github.com", "ok"]
  );
  assert.equal(h.api.codexRunning(), false);
  await h.api.stopCodex();
  assert.equal(h.calls.stopped, 1);
});

test("provider endpoints: named providers use the fixed table, custom ones their URL, unknown is remote", () => {
  assert.equal(providerEndpoint("groq"), "https://api.groq.com/openai/v1");
  assert.equal(providerEndpoint("openai", "http://127.0.0.1:1"), "https://api.openai.com/v1");
  assert.equal(
    providerEndpoint("custom", "http://192.168.1.5:8080/v1"),
    "http://192.168.1.5:8080/v1"
  );
  assert.equal(providerEndpoint("lan"), "https://unknown-provider.invalid");
  assert.equal(providerEndpoint("brand-new"), "https://unknown-provider.invalid");
});

test("effective endpoints follow the captured executor, never a fixed enterprise label", () => {
  assert.equal(
    effectiveEndpoint("azure", { enterprise: { azureEndpoint: "https://a.openai.azure.com" } }),
    "https://a.openai.azure.com"
  );
  assert.equal(
    effectiveEndpoint("azure", { enterprise: { endpoint: "https://b.openai.azure.com" } }),
    "https://b.openai.azure.com"
  );
  assert.equal(
    effectiveEndpoint("bedrock", { enterprise: { bedrockBaseURL: "http://127.0.0.1:4566" } }),
    "http://127.0.0.1:4566"
  );
  assert.equal(
    effectiveEndpoint("bedrock", {
      enterprise: { endpointOverride: "https://bedrock-runtime.eu-west-1.amazonaws.com" },
    }),
    "https://bedrock-runtime.eu-west-1.amazonaws.com"
  );
  assert.equal(
    effectiveEndpoint("vertex", { enterprise: { vertexLocation: "europe-west4" } }),
    "https://europe-west4-aiplatform.googleapis.com"
  );
  assert.equal(
    effectiveEndpoint("openai", { enterprise: { sdkBaseURL: "http://127.0.0.1:9/v1" } }),
    "http://127.0.0.1:9/v1"
  );
  assert.equal(
    effectiveEndpoint("openai", { env: { OPENAI_BASE_URL: "https://proxy.example.invalid/v1" } }),
    "https://proxy.example.invalid/v1"
  );
  assert.equal(effectiveEndpoint("openai", { env: {} }), "https://api.openai.com/v1");
  assert.equal(effectiveEndpoint("azure", {}), "https://unknown-provider.invalid");
  assert.equal(
    effectiveEndpoint("custom", { baseUrl: "http://127.0.0.1:1234/v1" }),
    "http://127.0.0.1:1234/v1"
  );
});

test("captured cleanup run: SEALED_MODE travels as a typed envelope with its phase, not CLEANUP_FAILED", async (t) => {
  const factoryArgs = [];
  const handlers = new Map();
  const recorder = new FlightRecorder({ now });
  const flags = { sealed: false };
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now });
  t.after(() => gate._resetForTests());
  const codex = Object.assign(new EventEmitter(), { stop() {} });
  const api = registerPersonalInferenceIPC({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn), removeHandler: (c) => handlers.delete(c) },
    userDataPath: "/fixture-never-read",
    codex,
    credentials: {
      list: () => [{ id: "azure", present: true, generation: 1 }],
      captureCommitted: async (id) => ({
        id,
        present: true,
        generation: 1,
        values: { key: "azure-key" },
      }),
    },
    textOperationSnapshot: () => ({
      version: 1,
      azureEndpoint: "https://fixture-a.invalid",
      azureApiVersion: "fixture-v1",
    }),
    getCredential: () => assert.fail("captured path must not read live credentials"),
    getEnterpriseConfig: () => assert.fail("captured path must not read live enterprise config"),
    fetchImpl: async () => new Response("{}", { status: 200 }),
    modelFactory: async (...args) => {
      factoryArgs.push(args);
      await args[7]("https://fixture-a.invalid/openai/v1/responses", {
        method: "POST",
        body: "{}",
      });
      return {
        specificationVersion: "v3",
        provider: "fixture",
        modelId: "fixture",
        supportedUrls: {},
        doGenerate: async () => ({
          content: [{ type: "text", text: "Cleaned fixture." }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        }),
      };
    },
  });
  t.after(() => api.dispose());
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send() {} });
  const call = (name, input) => handlers.get(`personal-inference:${name}`)({ sender }, input);
  const capture = await call("text-operation-capture", {
    provider: "azure",
    model: "fixture-model",
    inferenceScope: "dictationCleanup",
  });
  assert.equal(capture.ok, true);
  const request = { messages: [{ role: "user", content: "fixture words" }], wordCount: 2 };
  const first = await call("text-operation-run", { token: capture.value, request });
  assert.deepEqual(first, { ok: true, value: { text: "Cleaned fixture." } });
  assert.deepEqual(await call("text-operation-run", { token: capture.value, request }), first);
  const [args, again] = factoryArgs;
  assert.equal(args.length, 9);
  assert.ok(Object.isFrozen(args[5]), "slot 6 is the frozen captured executor");
  assert.equal(args[5].azureEndpoint, "https://fixture-a.invalid");
  assert.equal(again[5], args[5], "a retry reuses the exact captured executor");
  assert.equal(args[6], undefined, "slot 7 keeps the (absent) credential material");
  assert.equal(typeof args[7], "function", "slot 8 is the metered fetch");
  assert.equal(typeof args[8]?.assertLive, "function", "slot 9 keeps execution liveness");
  assert.ok(args[8].signal instanceof AbortSignal);
  const rows = recorder.list();
  assert.ok(rows.some((r) => r.host === "fixture-a.invalid" && r.task === "dictationCleanup"));

  flags.sealed = true;
  const refused = await call("text-operation-run", { token: capture.value, request });
  assert.deepEqual(refused, { ok: false, code: "SEALED_MODE", phase: "refused" });
  assert.equal(factoryArgs.length, 2, "nothing reached the factory while sealed");
  const blocked = recorder.list()[0];
  assert.deepEqual([blocked.host, blocked.outcome], ["fixture-a.invalid", "blocked"]);
  // Retire stays usable while sealed.
  assert.equal((await call("text-operation-retire", capture.value)).ok, true);
});

function loadPreload(invokeResult) {
  let exposed;
  const electron = {
    contextBridge: {
      executeInMainWorld: () => {},
      exposeInMainWorld: (_name, api) => {
        exposed = api;
      },
    },
    ipcRenderer: {
      invoke: async () => invokeResult,
      on: () => {},
      removeListener: () => {},
      send: () => {},
      sendSync: () => undefined,
    },
    webUtils: {},
  };
  const source = fs.readFileSync(path.join(__dirname, "../../preload.js"), "utf8");
  vm.runInNewContext(source, {
    require: (specifier) => {
      if (specifier === "electron") return electron;
      throw new Error(`Unexpected preload dependency: ${specifier}`);
    },
    process: { ...process, isMainFrame: true },
  });
  return exposed;
}

test("preload rebuilds a typed Sealed mode error for captured operations", async () => {
  for (const phase of ["refused", "interrupted"]) {
    const api = loadPreload({ ok: false, code: "SEALED_MODE", phase });
    await assert.rejects(
      api.personalInference.runTextOperation({ token: "t", request: {} }),
      (error) =>
        error.code === "SEALED_MODE" &&
        isSealedModeError(error) &&
        sealedPhaseOf(error) === phase &&
        error.messageKey ===
          (phase === "interrupted"
            ? "sealedMode.interrupted.generic"
            : "sealedMode.blocked.generic")
    );
  }
  // T18-06: without main's explicit "refused" the envelope is not a refusal.
  for (const envelope of [
    { ok: false, code: "SEALED_MODE" },
    { ok: false, code: "SEALED_MODE", phase: "unknown" },
  ]) {
    const unknown = loadPreload(envelope);
    await assert.rejects(
      unknown.personalInference.runTextOperation({ token: "t", request: {} }),
      (error) =>
        error.code === "SEALED_MODE" &&
        sealedPhaseOf(error) === "interrupted" &&
        error.messageKey === "sealedMode.interrupted.generic" &&
        !/nothing was sent/i.test(error.message)
    );
  }
  const api = loadPreload({ ok: false, code: "CLEANUP_FAILED" });
  await assert.rejects(
    api.personalInference.runTextOperation({ token: "t", request: {} }),
    (error) => error.code === "CLEANUP_FAILED" && !isSealedModeError(error)
  );
});

test("the real inference surface supplies Task 7's Codex hooks to the actual seal transition", async (t) => {
  const { SealedState } = require("../../src/helpers/privacy/sealedState");
  const { createSealTransition } = require("../../src/helpers/privacy/privacyBoot");
  gate._resetForTests();
  childRegistry._resetForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-codex-transition-"));
  t.after(() => {
    gate._resetForTests();
    childRegistry._resetForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const state = new SealedState({ profile: dir });
  const recorder = new FlightRecorder({ now });
  gate.configureEgress({ isSealed: () => state.isSealed(), recorder, now });
  const executable = path.join(dir, "codex-fixture-binary");
  fs.writeFileSync(executable, "fixture executable bytes");
  const child = codexChild(901);
  const codex = createCodexServer({
    userDataPath: dir,
    platform: "linux",
    resolveExecutable: async () => executable,
    runFile: async () => ({ stdout: fixture.version }),
    spawnProcess: () => child,
  });
  const { createHash } = require("node:crypto");
  const cpu = { x64: "x86_64", arm64: "aarch64" }[process.arch];
  codex.verifiedReleases.set(
    `0.154.0-${cpu}-unknown-linux-musl`,
    createHash("sha256").update(fs.readFileSync(executable)).digest("hex")
  );
  const api = registerPersonalInferenceIPC({
    ipcMain: { handle() {}, removeHandler() {} },
    userDataPath: dir,
    codex,
  });
  t.after(() => api.dispose());
  await codex.start();
  assert.equal(api.codexRunning(), true);
  const transition = createSealTransition({
    state,
    getInference: () => api,
    getCalendars: () => [],
    children: childRegistry,
    waitMs: 50,
    sleep: () => new Promise((r) => setImmediate(r)),
  });
  await transition.apply(true);
  assert.equal(api.codexRunning(), false, "the app-server exited");
  const failures = transition.snapshot().failures;
  for (const absent of [
    "codexStop",
    "codexStopUnavailable",
    "codexStatusUnavailable",
    "timeout:codex",
  ])
    assert.equal(failures.includes(absent), false, absent);
  // 07a: still unavailable, and the exited root's descendants stay unresolved.
  assert.ok(failures.includes("NATIVE_BOUNDARY_UNAVAILABLE"));
  assert.ok(failures.some((f) => f.startsWith("child:codex:901:")));
  const [row] = recorder.list();
  assert.deepEqual(
    [row.task, row.opaque, row.outcome, row.errorClass],
    ["codex", true, "cancelled", "SEALED_MODE"]
  );
});

// Review I1: cancel-login must not start an app-server just to cancel.
function realCodexIpc(t, { isSealed, recorder, results } = {}) {
  gate._resetForTests();
  childRegistry._resetForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-codex-cancel-"));
  t.after(() => {
    gate._resetForTests();
    childRegistry._resetForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  gate.configureEgress({ isSealed, recorder, now });
  const executable = path.join(dir, "codex-fixture-binary");
  fs.writeFileSync(executable, "fixture executable bytes");
  const counts = { probes: 0, spawns: 0, opened: [] };
  const children = [];
  const codex = createCodexServer({
    userDataPath: dir,
    platform: "linux",
    resolveExecutable: async () => {
      counts.probes++;
      return executable;
    },
    runFile: async () => {
      counts.probes++;
      return { stdout: fixture.version };
    },
    spawnProcess: () => {
      counts.spawns++;
      const child = codexChild(950 + counts.spawns, results);
      children.push(child);
      return child;
    },
  });
  const { createHash } = require("node:crypto");
  const cpu = { x64: "x86_64", arm64: "aarch64" }[process.arch];
  codex.verifiedReleases.set(
    `0.154.0-${cpu}-unknown-linux-musl`,
    createHash("sha256").update(fs.readFileSync(executable)).digest("hex")
  );
  const handlers = new Map();
  const api = registerPersonalInferenceIPC({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn), removeHandler: (c) => handlers.delete(c) },
    userDataPath: dir,
    openExternal: async (url) => {
      counts.opened.push(url);
    },
    codex,
  });
  t.after(() => api.dispose());
  const sender = Object.assign(new EventEmitter(), {
    id: 1,
    isDestroyed: () => false,
    send() {},
  });
  const invoke = (name, ...args) => handlers.get(`personal-inference:${name}`)({ sender }, ...args);
  return { dir, codex, api, invoke, counts, children };
}

test("sealed: production cancel-login after the seal stopped Codex resolves without a probe, spawn or row", async (t) => {
  const { SealedState } = require("../../src/helpers/privacy/sealedState");
  const { createSealTransition } = require("../../src/helpers/privacy/privacyBoot");
  const recorder = new FlightRecorder({ now });
  let state = null;
  const h = realCodexIpc(t, {
    isSealed: () => state.isSealed(),
    recorder,
    results: {
      "account/login/start": {
        type: "chatgpt",
        loginId: "login-1",
        authUrl: "https://auth.openai.com/fixture",
      },
      "account/login/cancel": { status: "canceled" },
    },
  });
  state = new SealedState({ profile: h.dir });

  // Unsealed with the app-server running: unchanged, the cancel goes to it.
  assert.deepEqual(await h.invoke("codex-login"), { loginId: "login-1" });
  assert.deepEqual(await h.invoke("codex-cancel-login", "login-1"), { status: "canceled" });
  assert.deepEqual([h.counts.probes, h.counts.spawns], [2, 1]);
  assert.ok(h.children[0].received.includes("account/login/cancel"));

  // A second sign-in is pending when the user turns Sealed mode on.
  assert.deepEqual(await h.invoke("codex-login"), { loginId: "login-1" });
  const transition = createSealTransition({
    state,
    getInference: () => h.api,
    getCalendars: () => [],
    children: childRegistry,
    waitMs: 50,
    sleep: () => new Promise((r) => setImmediate(r)),
  });
  await transition.apply(true);
  assert.equal(state.isSealed(), true);
  assert.equal(h.api.codexRunning(), false, "the seal stopped the app-server");
  const rows = recorder.list().map((row) => [row.task, row.host, row.outcome]);
  const cancelsSent = h.children[0].received.filter((m) => m === "account/login/cancel").length;

  // Cancel, twice: each click resolves locally and leaves no trace.
  for (let click = 0; click < 2; click++)
    assert.deepEqual(await h.invoke("codex-cancel-login", "login-1"), {
      appServerStopped: true,
    });
  assert.deepEqual([h.counts.probes, h.counts.spawns], [2, 1], "no probe or spawn while sealed");
  assert.equal(h.codex.alive(), false);
  assert.deepEqual(
    recorder.list().map((row) => [row.task, row.host, row.outcome]),
    rows,
    "no ledger row, blocked or otherwise"
  );
  assert.equal(rows.filter(([, , outcome]) => outcome === "blocked").length, 0);
  assert.equal(
    h.children[0].received.filter((m) => m === "account/login/cancel").length,
    cancelsSent,
    "nothing was sent to the stopped process"
  );
});

test("sealed: cancel-login on a never-started production server resolves with no probe, spawn or row", async (t) => {
  const recorder = new FlightRecorder({ now });
  const h = realCodexIpc(t, { isSealed: () => true, recorder });
  assert.deepEqual(await h.invoke("codex-cancel-login", "login-1"), { appServerStopped: true });
  assert.deepEqual([h.counts.probes, h.counts.spawns], [0, 0]);
  assert.deepEqual(recorder.list(), []);
  // The gated handlers still refuse (and record) as before.
  await assert.rejects(h.invoke("codex-status"), isSealedModeError);
  assert.deepEqual([h.counts.probes, h.counts.spawns], [0, 0]);
});
