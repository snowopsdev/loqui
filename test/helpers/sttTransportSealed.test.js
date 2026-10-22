const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createUploadCancelRegistry } = require("../../src/helpers/uploadCancelRegistry");

// Drives the real registered speech handlers (BYOK upload, retry, legacy
// proxies, Anthropic proxy) and the real Corti/Gemini/Tinfoil modules against
// the real egress gate. Electron net, the Tinfoil SDK client and FFmpeg are
// in-process recording stubs: no network, no native launch, no real provider.
const handlersModulePath = require.resolve("../../src/helpers/ipcHandlers");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-stt-sealed-"));
const originalLoad = Module._load;
const handlers = new Map();

const netCalls = [];
const jsonResponse = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const defaultNet = (url) => {
  if (url.includes("/protocol/openid-connect/token"))
    return jsonResponse({ access_token: "corti-token", expires_in: 300 });
  if (url.endsWith("/interactions/")) return jsonResponse({ interactionId: "i-1" });
  if (url.endsWith("/recordings/")) return jsonResponse({ recordingId: "r-1" });
  if (url.endsWith("/transcripts/"))
    return jsonResponse({ transcripts: [{ text: "corti words" }] });
  if (url.includes("/interactions/i-1")) return new Response(null, { status: 204 });
  if (url.includes("generativelanguage.googleapis.com"))
    return jsonResponse({ status: "completed", output_text: "gemini words" });
  if (url.includes("api.anthropic.com"))
    return jsonResponse({
      content: [{ type: "text", text: "clean text" }],
      stop_reason: "end_turn",
    });
  return jsonResponse({ text: "provider words" });
};
let netResponder = defaultNet;
const tinfoilCalls = [];
let tinfoilResponder = async () => jsonResponse({ text: "tinfoil words" });
const conversions = [];

const tinfoilClientStub = {
  tinfoilSecureFetch: (requestPath, init) => {
    tinfoilCalls.push({ path: requestPath, init });
    return tinfoilResponder(requestPath, init);
  },
  createTinfoilRealtimeSocket: () => {
    throw new Error("realtime socket not available in this test");
  },
};
const ffmpegStub = {
  isWavFormat: (buffer) =>
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE",
  convertBufferToWav: async (buffer) => {
    conversions.push("wav");
    return buffer;
  },
  convertToMp3: async (_source, target) => {
    conversions.push("mp3");
    fs.writeFileSync(target, Buffer.from("ID3-converted"));
  },
};
const electronStub = {
  app: {
    getPath: () => tempDir,
    getName: () => "test",
    getVersion: () => "0.0.0",
    isPackaged: false,
    on: () => {},
    requestSingleInstanceLock: () => true,
  },
  ipcMain: {
    handle: (channel, fn) => handlers.set(channel, fn),
    on: () => {},
    removeHandler: () => {},
  },
  net: {
    fetch: async (url, init) => {
      netCalls.push({ url: String(url), init });
      return netResponder(String(url), init);
    },
  },
  BrowserWindow: class BrowserWindow {
    static getAllWindows() {
      return [];
    }
    static fromWebContents() {
      return null;
    }
  },
  shell: {},
  dialog: {},
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 0, height: 0 } }) },
  systemPreferences: { getMediaAccessStatus: () => "granted" },
  session: { fromPartition: () => ({}) },
  clipboard: {},
  nativeImage: {},
  globalShortcut: {},
  utilityProcess: {},
  MessageChannelMain: class {},
};
// Real modules on the speech path; every other ipcHandlers dependency is inert.
const REAL_FROM_HANDLERS = new Set([
  "./providerUploadAudio",
  "./uploadCancelRegistry",
  "./debugLogger",
  "./policyResponseError",
  "./anthropicResponse",
  "../config/secretKeys",
  "./streamingHandOff",
  "../models/modelRegistryData.json",
  "./privacy/egressGate",
  "./privacy/gatedFetch",
  "./privacy/egressPolicy",
  "./privacy/providerEndpoints",
  "./sttTransport",
  "./cortiAuth",
  "./cortiTranscription",
  "./geminiTranscription",
  "./tinfoilTranscription",
  "fs",
]);
Module._load = function loadSpeechHarness(request, parent, isMain) {
  if (request === "electron") return electronStub;
  if (request === "./tinfoilSecureClient") return tinfoilClientStub;
  if (request === "./ffmpegUtils") return ffmpegStub;
  if (request === "./safeTempDir") return { getSafeTempDir: () => tempDir };
  if (parent?.filename === handlersModulePath) {
    if (request === "./windowBroadcast") return { broadcastToWindows: () => {} };
    if (request === "./urlAudioDownloader")
      return {
        sweepStaleTempArtifacts() {},
        download() {
          throw Error("No downloads");
        },
      };
    if (
      !REAL_FROM_HANDLERS.has(request) &&
      (request.startsWith(".") || /^(?:node:)?(?:child_process|net|tls|http|https)$/.test(request))
    )
      return anything();
  }
  return originalLoad.call(this, request, parent, isMain);
};
function anything() {
  return new Proxy(function () {}, {
    get: (_target, property) => {
      if (property === Symbol.toPrimitive || property === "toString") return () => "";
      if (property === "then") return undefined;
      return anything();
    },
    apply: () => anything(),
  });
}

const gate = require("../../src/helpers/privacy/egressGate");
const backstop = require("../../src/helpers/privacy/egressBackstop");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError, sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");
const { gatedNetFetch } = require("../../src/helpers/privacy/gatedFetch");
// Loaded lazily so the handler tests also run against a tree without it.
const stt = () => require("../../src/helpers/sttTransport");

let sealed = false;
let recorder;
let clock = 0;
const now = () => ++clock;
const notices = [];
const keyReads = [];
const dbWrites = [];

const WAV = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.alloc(4),
  Buffer.from("WAVE"),
  Buffer.alloc(32),
]);
function fakeThis() {
  const key = (name, value) => () => {
    keyReads.push(name);
    return value;
  };
  const target = {
    sessionId: "test-session",
    _uploadCancelRegistry: createUploadCancelRegistry(),
    audioStorageManager: { getAudioBuffer: (id) => (id === 7 ? Buffer.from([1, 2, 3]) : null) },
    databaseManager: {
      updateTranscriptionText: (...args) => dbWrites.push(["text", ...args]),
      updateTranscriptionStatus: (...args) => dbWrites.push(["status", ...args]),
      updateTranscriptionAudio: (...args) => dbWrites.push(["audio", ...args]),
      getTranscriptionById: (id) => ({ id, audio_duration_ms: 1200 }),
    },
    environmentManager: {
      getOpenAIKey: key("openai", "sk-fixture-openai"),
      getGroqKey: key("groq", "gsk-fixture"),
      getMistralKey: key("mistral", "mk-fixture"),
      getXaiKey: key("xai", "xk-fixture"),
      getTinfoilKey: key("tinfoil", "tk-fixture"),
      getGeminiKey: key("gemini", "gk-fixture"),
      getAnthropicKey: key("anthropic", "ak-fixture"),
      getCustomTranscriptionKey: key("custom", "ck-fixture"),
      getCortiClientId: key("cortiId", "corti-id-fixture"),
      getCortiClientSecret: key("cortiSecret", "corti-secret-fixture"),
    },
  };
  return new Proxy(target, { get: (t, p) => (p in t ? t[p] : anything()) });
}

test.before(() => {
  delete require.cache[handlersModulePath];
  const IPCHandlers = require(handlersModulePath);
  const Ctor = IPCHandlers.default || IPCHandlers;
  Ctor.prototype.setupHandlers.call(fakeThis());
});
test.after(() => {
  gate._resetForTests();
  Module._load = originalLoad;
  delete require.cache[handlersModulePath];
  fs.rmSync(tempDir, { recursive: true, force: true });
});
test.beforeEach(() => {
  sealed = false;
  netCalls.length = 0;
  tinfoilCalls.length = 0;
  conversions.length = 0;
  notices.length = 0;
  keyReads.length = 0;
  dbWrites.length = 0;
  netResponder = defaultNet;
  tinfoilResponder = async () => jsonResponse({ text: "tinfoil words" });
  gate._resetForTests();
  recorder = new FlightRecorder({ now });
  gate.configureEgress({ isSealed: () => sealed, recorder, now });
  for (const phase of ["dispatched", "delivered", "undelivered"])
    gate.events.on(phase, (notice) => notices.push({ phase, ...notice }));
});

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function waitFor(predicate, turns = 2000) {
  for (let i = 0; i < turns; i++) {
    if (predicate()) return;
    await tick();
  }
  throw new Error("condition not reached");
}
const rows = () => recorder.list().slice().reverse();
const rowShape = (row) => [row.task, row.host, row.outcome, row.bytesOut];
const transportCalls = () => netCalls.length + tinfoilCalls.length;
const hangUntilAbort = (_url, init) =>
  new Promise((_resolve, reject) =>
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })
  );
const assertRefused = (result, task, host) => {
  assert.equal(result.success ?? false, false);
  assert.equal(result.code, "SEALED_MODE");
  assert.equal(result.phase, "refused");
  assert.match(result.error, /\[SEALED_MODE\]/);
  assert.equal(transportCalls(), 0, "nothing reached a transport");
  assert.deepEqual(keyReads, [], "no credential was read");
  assert.deepEqual(conversions, [], "no native conversion was attempted");
  assert.deepEqual(rows().map(rowShape), [[task, host, "blocked", 0]]);
  assert.deepEqual(notices, []);
};

// ---------------------------------------------------------------------------
// transcribe-audio-file-byok

const capture = (payload = {}) =>
  handlers.get("transcribe-audio-file-byok")(
    { sender: {} },
    {
      audioBuffer: WAV,
      mimeType: "audio/wav",
      requestId: "upload-1",
      correlationId: "session-1",
      provider: "openai",
      model: "whisper-1",
      transcriptionMode: "providers",
      ...payload,
    }
  );
const uploadFile = (name, payload = {}) => {
  const filePath = path.join(tempDir, name);
  fs.writeFileSync(filePath, Buffer.from("file-audio"));
  return handlers.get("transcribe-audio-file-byok")(
    { sender: {} },
    { filePath, requestId: "file-1", provider: "openai", model: "whisper-1", ...payload }
  );
};

test("sealed: captured dictation audio is refused before any key read or transport", async () => {
  sealed = true;
  const result = await capture();
  assertRefused(result, "dictationStt", "api.openai.com");
  assert.doesNotMatch(result.error, /interrupted/);
});

test("sealed: an uploaded file is refused as uploadStt before its MP3 conversion", async () => {
  sealed = true;
  const result = await uploadFile("talk.mov", { transcriptionMode: "providers" });
  assertRefused(result, "uploadStt", "api.openai.com");
  assert.ok(fs.existsSync(path.join(tempDir, "talk.mov")), "the user's file is untouched");
});

test("sealed: Corti, Gemini and Tinfoil uploads are refused before credentials or attestation", async () => {
  for (const [provider, extra, host] of [
    ["corti", { environment: "eu", tenant: "acme" }, "api.eu.corti.app"],
    ["gemini", {}, "generativelanguage.googleapis.com"],
    ["tinfoil", {}, "inference.tinfoil.sh"],
  ]) {
    sealed = true;
    recorder.clear();
    keyReads.length = 0;
    const result = await capture({ provider, model: "", ...extra });
    assertRefused(result, "dictationStt", host);
  }
});

test("sealed: a remote self-hosted server is refused, a loopback one still transcribes", async () => {
  sealed = true;
  const lan = await capture({
    transcriptionMode: "self-hosted",
    remoteTranscriptionUrl: "http://192.168.1.20:8178",
  });
  assertRefused(lan, "dictationStt", "192.168.1.20");

  recorder.clear();
  const local = await capture({
    transcriptionMode: "self-hosted",
    remoteTranscriptionUrl: "http://127.0.0.1:8178",
  });
  assert.equal(local.success, true, local.error);
  assert.equal(local.text, "provider words");
  assert.equal(new URL(netCalls[0].url).hostname, "127.0.0.1");
  assert.deepEqual(recorder.list(), [], "loopback work is not on the egress ledger");
});

test("unsealed: a captured upload is one metered audio request correlated to the dictation session", async () => {
  const result = await capture();
  assert.equal(result.success, true, result.error);
  assert.equal(netCalls.length, 1);
  const sentBody = netCalls[0].init.body;
  const [row] = rows();
  assert.deepEqual(
    [row.task, row.host, row.outcome, row.status, row.bytesOut],
    ["dictationStt", "api.openai.com", "ok", 200, sentBody.length]
  );
  assert.ok(row.bytesIn > 0);
  assert.deepEqual(
    notices.map((n) => [n.phase, n.task, n.payload, n.correlationId, n.targetId]),
    [
      ["dispatched", "dictationStt", "audio", "session-1", "openai"],
      ["delivered", "dictationStt", "audio", "session-1", "openai"],
    ]
  );
  assert.equal(
    new Headers(netCalls[0].init.headers).get("authorization"),
    "Bearer sk-fixture-openai"
  );
  assert.equal(netCalls[0].init.useSessionCookies, false);
});

test("unsealed: a file upload without a session uses its requestId; custom endpoints are host-named", async () => {
  const result = await uploadFile("talk.mp3", {
    provider: "custom",
    baseUrl: "https://stt.example.test/v1",
    transcriptionMode: "providers",
  });
  assert.equal(result.success, true, result.error);
  assert.deepEqual(
    notices.map((n) => [n.phase, n.task, n.correlationId, n.targetId]),
    [
      ["dispatched", "uploadStt", "file-1", "host:stt.example.test"],
      ["delivered", "uploadStt", "file-1", "host:stt.example.test"],
    ]
  );
  assert.deepEqual(rows().map(rowShape), [
    ["uploadStt", "stt.example.test", "ok", netCalls[0].init.body.length],
  ]);
});

test("unsealed: Corti uses the gated transport for its token and REST flow; only the recording is audio", async () => {
  const result = await capture({ provider: "corti", model: "", environment: "eu", tenant: "acme" });
  assert.equal(result.success, true, result.error);
  assert.equal(result.text, "corti words");
  await waitFor(() => netCalls.some((call) => call.init.method === "DELETE"));
  await waitFor(() => rows().length === netCalls.length);
  assert.ok(netCalls.every((call) => call.init.useSessionCookies === false));
  assert.ok(rows().every((row) => row.task === "dictationStt"));
  const delivered = notices.filter((n) => n.phase === "delivered");
  assert.ok(delivered.every((n) => n.targetId === "corti" && n.correlationId === "session-1"));
  assert.deepEqual(
    delivered.filter((n) => n.payload === "audio").map((n) => n.host),
    ["api.eu.corti.app"],
    "exactly the recording upload carries audio"
  );
});

test("unsealed: Gemini and Tinfoil requests are attributed to the session and provider", async () => {
  const gemini = await capture({ provider: "gemini", model: "" });
  assert.equal(gemini.success, true, gemini.error);
  assert.deepEqual(
    rows().map((row) => [row.task, row.host, row.outcome]),
    [["dictationStt", "generativelanguage.googleapis.com", "ok"]]
  );
  assert.deepEqual(
    notices.map((n) => [n.phase, n.payload, n.targetId, n.correlationId]),
    [
      ["dispatched", "audio", "gemini", "session-1"],
      ["delivered", "audio", "gemini", "session-1"],
    ]
  );

  notices.length = 0;
  recorder.clear();
  const tinfoil = await capture({ provider: "tinfoil", model: "" });
  assert.equal(tinfoil.success, true, tinfoil.error);
  assert.equal(tinfoilCalls.length, 1);
  assert.ok(tinfoilCalls[0].init.signal instanceof AbortSignal);
  assert.deepEqual(
    rows().map((row) => [row.task, row.host, row.outcome, row.status]),
    [["dictationStt", "inference.tinfoil.sh", "ok", 200]]
  );
  assert.deepEqual(
    notices.map((n) => [n.phase, n.payload, n.targetId, n.correlationId]),
    [
      ["dispatched", "audio", "tinfoil", "session-1"],
      ["delivered", "audio", "tinfoil", "session-1"],
    ]
  );
});

test("sealing an in-flight upload reports interrupted, never 'nothing was sent'", async () => {
  for (const provider of ["openai", "tinfoil", "gemini"]) {
    netResponder = hangUntilAbort;
    tinfoilResponder = (_path, init) => hangUntilAbort(null, init);
    sealed = false;
    recorder.clear();
    const pending = capture({ provider, model: "" });
    await waitFor(() => transportCalls() > 0);
    sealed = true;
    assert.equal(gate.abortAllRemote(), 1, provider);
    const result = await pending;
    assert.equal(result.success, false, provider);
    assert.equal(result.code, "SEALED_MODE", provider);
    assert.equal(result.phase, "interrupted", provider);
    assert.match(result.error, /\[SEALED_MODE:interrupted\]/, provider);
    assert.doesNotMatch(result.error, /nothing was sent/, provider);
    const [row] = rows();
    assert.deepEqual([row.outcome, row.errorClass], ["cancelled", "SEALED_MODE"], provider);
    netCalls.length = 0;
    tinfoilCalls.length = 0;
  }
});

test("cancelling an upload is recorded as cancelled", async () => {
  netResponder = hangUntilAbort;
  const pending = capture({ requestId: "cancel-me" });
  await waitFor(() => netCalls.length === 1);
  await handlers.get("cancel-upload-transcription")({}, "cancel-me");
  const result = await pending;
  assert.equal(result.success, false);
  assert.equal(result.phase, undefined, "a user cancel is not a Sealed mode outcome");
  const [row] = rows();
  assert.deepEqual([row.outcome, row.errorClass], ["cancelled", "ABORTED"]);
});

// ---------------------------------------------------------------------------
// retry-transcription

const retry = (settings) =>
  handlers.get("retry-transcription")({ sender: {} }, 7, {
    cloudTranscriptionMode: "byok",
    transcriptionMode: "providers",
    ...settings,
  });

test("sealed: a retry is refused before key reads and re-encodes; the stored row is untouched", async () => {
  for (const [settings, host] of [
    [
      { cloudTranscriptionProvider: "openai", cloudTranscriptionModel: "whisper-1" },
      "api.openai.com",
    ],
    [
      {
        cloudTranscriptionProvider: "custom",
        cloudTranscriptionBaseUrl: "https://stt.example.test/v1",
        cloudTranscriptionModel: "m",
      },
      "stt.example.test",
    ],
    [{ cloudTranscriptionProvider: "mistral" }, "api.mistral.ai"],
    [{ cloudTranscriptionProvider: "corti", cortiEnvironment: "us" }, "api.us.corti.app"],
    [{ cloudTranscriptionProvider: "gemini" }, "generativelanguage.googleapis.com"],
    [{ cloudTranscriptionProvider: "tinfoil" }, "inference.tinfoil.sh"],
  ]) {
    sealed = true;
    recorder.clear();
    const result = await retry(settings);
    assertRefused(result, "dictationStt", host);
    assert.deepEqual(dbWrites, [], "History keeps the stored audio and text");
  }
});

test("sealed: a retry to a loopback self-hosted server still completes", async () => {
  sealed = true;
  const result = await retry({
    transcriptionMode: "self-hosted",
    remoteTranscriptionUrl: "http://127.0.0.1:8178",
  });
  assert.equal(result.success, true, result.error);
  assert.equal(new URL(netCalls[0].url).hostname, "127.0.0.1");
  assert.ok(dbWrites.some(([kind]) => kind === "text"));
  assert.deepEqual(recorder.list(), []);
});

test("unsealed: a retry upload is a gated dictationStt audio request", async () => {
  const result = await retry({
    cloudTranscriptionProvider: "groq",
    cloudTranscriptionModel: "whisper-large-v3",
  });
  assert.equal(result.success, true, result.error);
  assert.deepEqual(
    rows().map((row) => [row.task, row.host, row.outcome]),
    [["dictationStt", "api.groq.com", "ok"]]
  );
  assert.deepEqual(
    notices.map((n) => [n.phase, n.payload, n.targetId]),
    [
      ["dispatched", "audio", "groq"],
      ["delivered", "audio", "groq"],
    ]
  );
});

// ---------------------------------------------------------------------------
// Legacy proxies (no current UI caller, still exposed by preload)

const proxy = (channel, input) =>
  handlers.get(channel)({ sender: {} }, { audioBuffer: new ArrayBuffer(4), ...input });

test("sealed: every legacy speech proxy returns a typed refusal before its credential is read", async () => {
  for (const [channel, host, input] of [
    ["proxy-xai-transcription", "api.x.ai", {}],
    ["proxy-mistral-transcription", "api.mistral.ai", {}],
    ["proxy-corti-transcription", "api.eu.corti.app", { environment: "eu", tenant: "acme" }],
    ["proxy-tinfoil-transcription", "inference.tinfoil.sh", {}],
    ["proxy-gemini-transcription", "generativelanguage.googleapis.com", {}],
  ]) {
    sealed = true;
    recorder.clear();
    const result = await proxy(channel, input);
    assertRefused(result, "dictationStt", host);
    assert.equal(result.messageKey, "sealedMode.blocked.generic", channel);
  }
});

test("sealed: a Corti proxy with an unknown environment is still refused", async () => {
  sealed = true;
  const result = await proxy("proxy-corti-transcription", { environment: "x.localhost#" });
  assertRefused(result, "dictationStt", "unknown");
});

test("unsealed: legacy xAI and Mistral proxies are gated dictationStt audio requests", async () => {
  for (const [channel, provider, host] of [
    ["proxy-xai-transcription", "xai", "api.x.ai"],
    ["proxy-mistral-transcription", "mistral", "api.mistral.ai"],
  ]) {
    notices.length = 0;
    recorder.clear();
    const result = await proxy(channel, {});
    assert.equal(result.text, "provider words", channel);
    assert.deepEqual(
      rows().map((row) => [row.task, row.host, row.outcome]),
      [["dictationStt", host, "ok"]]
    );
    assert.deepEqual(
      notices.map((n) => [n.phase, n.payload, n.targetId]),
      [
        ["dispatched", "audio", provider],
        ["delivered", "audio", provider],
      ]
    );
  }
});

// ---------------------------------------------------------------------------
// process-anthropic-reasoning

const anthropic = (config = {}) =>
  handlers.get("process-anthropic-reasoning")({ sender: {} }, "raw words", "claude-x", "Agent", {
    systemPrompt: "clean",
    ...config,
  });

test("sealed: the legacy Anthropic proxy is refused as dictationCleanup before its key is read", async () => {
  sealed = true;
  const result = await anthropic();
  assertRefused(result, "dictationCleanup", "api.anthropic.com");
});

test("unsealed: the legacy Anthropic proxy is gated; screen context is an image payload", async () => {
  const text = await anthropic();
  assert.deepEqual(text, { success: true, text: "clean text" });
  const image = await anthropic({ screenContext: { mediaType: "image/png", data: "AAAA" } });
  assert.equal(image.success, true);
  assert.deepEqual(
    notices.filter((n) => n.phase === "delivered").map((n) => [n.task, n.payload, n.targetId]),
    [
      ["dictationCleanup", "text", "anthropic"],
      ["dictationCleanup", "image", "anthropic"],
    ]
  );
  assert.deepEqual(
    rows().map((row) => [row.task, row.host, row.outcome]),
    [
      ["dictationCleanup", "api.anthropic.com", "ok"],
      ["dictationCleanup", "api.anthropic.com", "ok"],
    ]
  );
});

test("sealing an in-flight Anthropic proxy request reports interrupted", async () => {
  netResponder = hangUntilAbort;
  const pending = anthropic();
  await waitFor(() => netCalls.length === 1);
  sealed = true;
  gate.abortAllRemote();
  const result = await pending;
  assert.equal(result.code, "SEALED_MODE");
  assert.equal(result.phase, "interrupted");
});

// ---------------------------------------------------------------------------
// sttTransport units

const OPENAI = new URL("https://api.openai.com/v1/audio/transcriptions");
const audio = () =>
  stt().buildMultipartBody(Buffer.from("RIFFdata"), "dictation.wav", "audio/wav", {
    model: "whisper-1",
  });

test("buildMultipartBody keeps its exact wire format", () => {
  const { body, boundary } = stt().buildMultipartBody(Buffer.from("AB"), "a.wav", "audio/wav", {
    model: "m",
    "keywords[]": ["x", null, "y"],
    skipped: undefined,
  });
  assert.match(boundary, /^----OpenWhispr\d+$/);
  assert.equal(
    body.toString(),
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\n` +
      `Content-Type: audio/wav\r\n\r\nAB\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nm\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="keywords[]"\r\n\r\nx\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="keywords[]"\r\n\r\ny\r\n` +
      `--${boundary}--\r\n`
  );
});

test("sealed: postMultipart is refused before net.fetch, attributed to its task", async () => {
  sealed = true;
  const { body, boundary } = audio();
  await assert.rejects(
    gate.withTask("dictationStt", () => stt().postMultipart(OPENAI, body, boundary)),
    (error) => sealedPhaseOf(error) === "refused"
  );
  assert.deepEqual(netCalls, []);
  assert.deepEqual(rows().map(rowShape), [["dictationStt", "api.openai.com", "blocked", 0]]);
});

test("an in-flight loopback transcription survives sealing", async () => {
  let release;
  netResponder = () =>
    new Promise((resolve) => {
      release = () => resolve(jsonResponse({ text: "local" }));
    });
  const { body, boundary } = audio();
  const pending = gate.withTask("dictationStt", () =>
    stt().postMultipart(new URL("http://127.0.0.1:8178/inference"), body, boundary)
  );
  await waitFor(() => release);
  sealed = true;
  assert.equal(gate.abortAllRemote(), 0);
  backstop.severAll();
  release();
  assert.deepEqual(await pending, { statusCode: 200, data: { text: "local" } });
  assert.deepEqual(recorder.list(), []);
});

test("postMultipart keeps the caller's session transport and explicit correlation", async () => {
  const sessionCalls = [];
  const fetchSession = {
    fetch: async (url, init) => {
      sessionCalls.push({ url, init });
      return jsonResponse({ text: "via session" });
    },
  };
  const { body, boundary } = audio();
  const result = await gate.withTask("uploadStt", () =>
    stt().postMultipart(
      new URL("https://api.groq.com/openai/v1/audio/transcriptions"),
      body,
      boundary,
      { Authorization: "Bearer k" },
      { session: fetchSession, correlationId: "upload-3", provider: "groq" }
    )
  );
  assert.deepEqual(result, { statusCode: 200, data: { text: "via session" } });
  assert.equal(netCalls.length, 0);
  assert.equal(sessionCalls.length, 1);
  const headers = new Headers(sessionCalls[0].init.headers);
  assert.equal(headers.get("content-type"), `multipart/form-data; boundary=${boundary}`);
  assert.equal(headers.get("authorization"), "Bearer k");
  assert.equal(sessionCalls[0].init.body, body);
  assert.equal(sessionCalls[0].init.useSessionCookies, false);
  const [row] = rows();
  assert.deepEqual(
    [row.task, row.outcome, row.bytesOut, row.status],
    ["uploadStt", "ok", body.length, 200]
  );
  assert.deepEqual(
    notices.map((n) => [n.phase, n.task, n.payload, n.correlationId, n.targetId]),
    [
      ["dispatched", "uploadStt", "audio", "upload-3", "groq"],
      ["delivered", "uploadStt", "audio", "upload-3", "groq"],
    ]
  );
});

test("a non-JSON provider reply still throws SERVER_ERROR with its status", async () => {
  netResponder = async () => new Response("Payload Too Large", { status: 413 });
  const { body, boundary } = audio();
  await assert.rejects(
    gate.withTask("uploadStt", () => stt().postMultipart(OPENAI, body, boundary)),
    (error) => error.code === "SERVER_ERROR" && error.statusCode === 413
  );
  const [row] = rows();
  assert.deepEqual([row.outcome, row.status, row.errorClass], ["error", 413, "HTTP_4XX"]);
});

test("sealed: proxy requests through gatedNetFetch are refused", async () => {
  sealed = true;
  await assert.rejects(
    gate.withTask("dictationStt", () =>
      gatedNetFetch("https://api.x.ai/v1/stt", { method: "POST", body: "x" }, { payload: "audio" })
    ),
    isSealedModeError
  );
  assert.deepEqual(netCalls, []);
});

// Source ratchet beside the executed tests above: no ungated Electron transport
// remains on the speech paths.
test("no ungated Electron net transport is left in the speech paths", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
  for (const file of [
    "src/helpers/geminiTranscription.js",
    "src/helpers/cortiAuth.js",
    "src/helpers/cortiTranscription.js",
    "src/helpers/tinfoilTranscription.js",
  ]) {
    assert.doesNotMatch(read(file), /\bnet\.(fetch|request)\s*\(/, file);
    assert.doesNotMatch(read(file), /require\("electron"\)/, file);
  }
  const handlersSource = read("src/helpers/ipcHandlers.js");
  assert.doesNotMatch(handlersSource, /function (postMultipart|buildMultipartBody)\(/);
  assert.doesNotMatch(handlersSource, /\bnet\.request\s*\(/);
  // The one remaining direct net.fetch is the provider connection test's
  // transport, composed inside egressGate.meteredFetch (Task 8).
  const direct = [...handlersSource.matchAll(/\bnet\.fetch\s*\(/g)];
  assert.equal(direct.length, 1);
  assert.match(
    handlersSource,
    /egressGate\.meteredFetch\(ticket, \(url, init\) => net\.fetch\(url, init\)/
  );
  assert.match(read("src/helpers/tinfoilTranscription.js"), /egress\.guard\(/);
});
