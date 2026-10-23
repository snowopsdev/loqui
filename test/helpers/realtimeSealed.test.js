const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

// Task 9a (N9/N10): realtime speech attribution through the real registered
// handlers. setupHandlers() registers the real meeting channels and wires the
// real dictation streaming authority (dictationStreamingOperations.js); the
// real provider adapters, egress gate, flight recorder and Plan 04 disclosure
// tracker run unchanged. Only the provider transport boundary is redirected:
// the adapters' `ws` constructor dials an owned numeric 127.0.0.1 fixture that
// speaks each provider's protocol, while the gate still sees the provider's
// own URL. Token/auth fetches go to an in-process Electron net stub. No DNS,
// no remote host, no provider, no credentials, no native launch.
const RealWebSocket = require("ws");

const handlersModulePath = require.resolve("../../src/helpers/ipcHandlers");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-realtime-sealed-"));
const savedTmp = process.env.TMPDIR;
// Meeting capture writes its diarization scratch under os.tmpdir().
process.env.TMPDIR = tempDir;

// ---------------------------------------------------------------------------
// Owned 127.0.0.1 provider fixture.
const fixture = { port: 0, server: null, conns: [], silentDeepgram: false, holdReady: false };
const routed = [];
const isSilence = (data) => data.every((byte) => byte === 0);
const reply = (conn, value) => {
  if (conn.ws.readyState === 1) conn.ws.send(JSON.stringify(value));
};
const content = (conn, data) => {
  conn.content += data.length;
  conn.frames++;
};
function openaiProtocol(conn) {
  reply(conn, { type: "session.created", session: {} });
  conn.ws.on("message", (data) => {
    const message = JSON.parse(String(data));
    if (message.type === "session.update") reply(conn, { type: "session.updated" });
    if (message.type === "input_audio_buffer.append") content(conn, data);
    if (message.type === "input_audio_buffer.commit")
      reply(conn, {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "realtime words",
      });
  });
}
function deepgramProtocol(conn) {
  if (!fixture.holdReady)
    reply(conn, { type: "Metadata", request_id: `dg-${fixture.conns.length}` });
  conn.ws.on("message", (data, binary) => {
    if (binary) {
      if (isSilence(data)) return; // the warm keep-alive frame is not audio
      content(conn, data);
      if (!fixture.silentDeepgram)
        reply(conn, {
          type: "Results",
          is_final: true,
          start: 0,
          channel: { alternatives: [{ transcript: "deepgram words" }] },
        });
      return;
    }
    if (JSON.parse(String(data)).type === "CloseStream") conn.ws.close(1000);
  });
}
function assemblyProtocol(conn) {
  reply(conn, { type: "Begin", id: "aai-session" });
  conn.ws.on("message", (data, binary) => {
    if (binary) return content(conn, data);
    const message = JSON.parse(String(data));
    if (message.type === "Terminate") {
      reply(conn, { type: "Termination", audio_duration_seconds: 1 });
      conn.ws.close(1000);
    }
  });
}
function geminiProtocol(conn) {
  conn.ws.on("message", (data) => {
    const message = JSON.parse(String(data));
    if (message.setup) reply(conn, { setupComplete: {} });
    if (message.realtimeInput?.audio) content(conn, data);
    if (message.realtimeInput?.audioStreamEnd)
      reply(conn, {
        serverContent: { inputTranscription: { text: "gemini words" }, generationComplete: true },
      });
  });
}
function cortiProtocol(conn) {
  conn.ws.on("message", (data, binary) => {
    if (binary) return content(conn, data);
    const message = JSON.parse(String(data));
    if (message.type === "config") reply(conn, { type: "CONFIG_ACCEPTED", sessionId: "c-1" });
    if (message.type === "flush") reply(conn, { type: "flushed" });
    if (message.type === "end") conn.ws.close(1000);
  });
}
const PROTOCOLS = {
  "api.openai.com": openaiProtocol,
  "inference.tinfoil.sh": openaiProtocol,
  "api.deepgram.com": deepgramProtocol,
  "streaming.assemblyai.com": assemblyProtocol,
  "generativelanguage.googleapis.com": geminiProtocol,
  "api.us.corti.app": cortiProtocol,
};

// The provider transport boundary: the adapter's own URL is kept for the gate
// (it is what connectRealtime authorizes); the bytes go to the owned fixture.
class RoutedWebSocket extends RealWebSocket {
  constructor(address, protocols, options) {
    if (protocols && typeof protocols === "object" && !Array.isArray(protocols)) {
      options = protocols;
      protocols = undefined;
    }
    const logical = new URL(address);
    if (!fixture.port) throw new Error("fixture not listening");
    super(`ws://127.0.0.1:${fixture.port}${logical.pathname}${logical.search}`, protocols, {
      ...options,
      headers: { ...(options?.headers ?? {}), "x-logical-host": logical.hostname },
    });
    routed.push(logical.hostname);
  }
}

// ---------------------------------------------------------------------------
// Electron and module boundary.
const netCalls = [];
const keyReads = [];
const jsonResponse = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const netResponder = (url) => {
  if (url.startsWith("https://streaming.assemblyai.com/v3/token"))
    return jsonResponse({ token: "aai-temp-token" });
  if (url.includes("/protocol/openid-connect/token"))
    return jsonResponse({ access_token: "corti-access", expires_in: 300 });
  return jsonResponse({ error: "unexpected" }, 500);
};
const handlers = new Map();
const events = new Map();
const invoked = new Set();
const windowFor = (wc) => ({ id: wc.id, webContents: wc, isDestroyed: () => wc.isDestroyed() });
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
    on: (channel, fn) => events.set(channel, fn),
    removeHandler: () => {},
    removeListener: () => {},
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
    static fromWebContents(wc) {
      return wc ? windowFor(wc) : null;
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
const tinfoilClientStub = {
  // The attested factory resolves a socket; the fixture stands in for the enclave.
  createTinfoilRealtimeSocket: async ({ model, apiKey }) =>
    new RoutedWebSocket(
      `wss://inference.tinfoil.sh/v1/realtime?model=${encodeURIComponent(model)}&intent=transcription`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    ),
  tinfoilSecureFetch: () => {
    throw new Error("No Tinfoil fetch in realtime tests");
  },
};
const liveSpeakerStub = {
  isAvailable: () => false,
  stop: async () => null,
  feedAudio() {},
};
// Real modules on the realtime path; every other ipcHandlers dependency is inert.
const REAL_FROM_HANDLERS = new Set([
  "./debugLogger",
  "./policyResponseError",
  "../config/secretKeys",
  "../models/modelRegistryData.json",
  "./privacy/egressGate",
  "./privacy/gatedFetch",
  "./privacy/egressPolicy",
  "./privacy/providerEndpoints",
  "./sttTransport",
  "./streamingHandOff",
  "./cortiAuth",
  "./openaiRealtimeStreaming",
  "./assemblyAiStreaming",
  "./deepgramStreaming",
  "./geminiLiveStreaming",
  "./cortiStreaming",
  "./tinfoilRealtimeStreaming",
  "./realtimeTokenProviders",
  "./meetingStreamingProviders",
  "./dictationStreamingOperations",
  "./meetingTranscriptionLifecycle",
  "./meetingEchoLeakDetector",
  "./meetingSystemAudioWatchdog",
  "./meetingMicHoldback",
  "./meetingMicGate",
  "./meetingDiarizationInput",
  "./meetingAudioTimeline",
  "./liveSpeakerIdPolicy",
  "./transcriptText",
  "../utils/audioUtils",
  "fs",
]);
const originalLoad = Module._load;
Module._load = function loadRealtimeHarness(request, parent, isMain) {
  if (request === "ws") return RoutedWebSocket;
  if (request === "electron") return electronStub;
  if (request === "./tinfoilSecureClient") return tinfoilClientStub;
  if (parent?.filename === handlersModulePath) {
    if (request === "./liveSpeakerIdentifier") return liveSpeakerStub;
    if (request === "./windowBroadcast") return { broadcastToWindows: () => {} };
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
      if (property === Symbol.iterator) return undefined;
      return anything();
    },
    apply: () => anything(),
  });
}

const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { createDisclosureTracker } = require("../../src/helpers/dictationDisclosure");
// Loaded lazily so the handler tests also run against a tree without them.
const stt = () => require("../../src/helpers/sttTransport");
const handOff = () => require("../../src/helpers/streamingHandOff");

let sealed = false;
let recorder;
let clock = 0;
const now = () => ++clock;
const notices = [];

const tap = { onChunk: null };
let host;
function fakeThis() {
  const key = (name, value) => () => {
    keyReads.push(name);
    return value;
  };
  const target = {
    environmentManager: {
      getOpenAIKey: key("openai", "sk-fixture-openai"),
      getTinfoilKey: key("tinfoil", "tk-fixture"),
      getDeepgramKey: key("deepgram", "dg-fixture"),
      getAssemblyAIKey: key("assemblyai", "aai-fixture"),
      getGeminiKey: key("gemini", "gk-fixture"),
      getCortiClientId: key("cortiId", "corti-id-fixture"),
      getCortiClientSecret: key("cortiSecret", "corti-secret-fixture"),
    },
    windowManager: {
      showTranscriptionPreview() {},
      hideTranscriptionPreview() {},
      controlPanelWindow: null,
    },
    _dictationStreaming: null,
    assemblyAiStreaming: null,
    deepgramStreaming: null,
    geminiStreaming: null,
    cortiStreaming: null,
    _meetingMicStreaming: null,
    _meetingSystemStreaming: null,
    activeMeetingSpeakerConfig: null,
    _activeMeetingNoteId: null,
    linuxPortalAudioManager: null,
    windowsLoopbackAudioManager: null,
    audioTapManager: {
      isSupported: () => true,
      start: async ({ onChunk }) => {
        tap.onChunk = onChunk;
        return true;
      },
      stop: async () => {
        tap.onChunk = null;
      },
    },
    meetingAecManager: { isAvailable: () => false, stop: async () => {} },
    meetingDetectionEngine: {
      endRecordingSession: () => true,
      setUserRecording() {},
      beginRecordingSession: async () => {},
      recordMeetingAudioChunk() {},
    },
  };
  return new Proxy(target, { get: (t, p) => (p in t ? t[p] : anything()) });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, label = "condition", ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error(`${label} not reached`);
}

test.before(async () => {
  await new Promise((resolve) => {
    fixture.server = new RealWebSocket.WebSocketServer({ host: "127.0.0.1", port: 0 }, resolve);
  });
  fixture.port = fixture.server.address().port;
  fixture.server.on("connection", (ws, request) => {
    const conn = { host: request.headers["x-logical-host"], ws, content: 0, frames: 0 };
    conn.closed = new Promise((resolve) => ws.once("close", resolve));
    fixture.conns.push(conn);
    PROTOCOLS[conn.host]?.(conn);
  });
  delete require.cache[handlersModulePath];
  const IPCHandlers = require(handlersModulePath);
  const Ctor = IPCHandlers.default || IPCHandlers;
  host = fakeThis();
  // The real main-owned Corti credential exchange (cortiAuth over the gate).
  host._mintStoredCortiToken = Ctor.prototype._mintStoredCortiToken;
  Ctor.prototype.setupHandlers.call(host);
  for (const [channel, fn] of [...handlers]) {
    handlers.set(channel, (...args) => {
      invoked.add(channel);
      return fn(...args);
    });
  }
  for (const [channel, fn] of [...events]) {
    events.set(channel, (...args) => {
      invoked.add(channel);
      return fn(...args);
    });
  }
});
test.after(async () => {
  // Retire anything a failed test left running (meeting timers, warm sockets).
  await handlers.get("meeting-transcription-stop")?.({ sender: null }, null);
  host?.dictationStreamingOperations?.dispose();
  gate._resetForTests();
  for (const conn of fixture.conns) conn.ws.terminate();
  await new Promise((resolve) => fixture.server.close(resolve));
  Module._load = originalLoad;
  delete require.cache[handlersModulePath];
  if (savedTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = savedTmp;
  fs.rmSync(tempDir, { recursive: true, force: true });
});
test.beforeEach(() => {
  sealed = false;
  fixture.silentDeepgram = false;
  fixture.holdReady = false;
  netCalls.length = 0;
  keyReads.length = 0;
  notices.length = 0;
  routed.length = 0;
  gate._resetForTests();
  recorder = new FlightRecorder({ now });
  gate.configureEgress({ isSealed: () => sealed, recorder, now });
  for (const phase of ["dispatched", "delivered", "undelivered"])
    gate.events.on(phase, (notice) => notices.push({ phase, ...notice }));
});

const rows = () => recorder.list().slice().reverse();
const rowsOf = (kind, host) =>
  rows().filter((row) => row.kind === kind && (!host || row.host === host));
const audioNotices = (correlationId) =>
  notices.filter(
    (n) =>
      n.payload === "audio" && (correlationId === undefined || n.correlationId === correlationId)
  );
const contentTo = (host, from = 0) =>
  fixture.conns
    .slice(from)
    .filter((conn) => conn.host === host)
    .reduce((sum, conn) => sum + conn.content, 0);

let senderId = 0;
function webContents() {
  const wc = new EventEmitter();
  Object.assign(wc, {
    id: ++senderId,
    dead: false,
    messages: [],
    isDestroyed: () => wc.dead,
    send: (...args) => wc.messages.push(args),
  });
  return wc;
}
const identity = (id) => ({ correlationId: id, dictationSessionId: id, operationId: `op-${id}` });
const frame = (bytes, fill = 0x11) => new Uint8Array(bytes).fill(fill);

const FAMILIES = [
  {
    name: "openai",
    prefix: "dictation-realtime",
    options: { provider: "openai-realtime" },
    host: "api.openai.com",
    target: "openai",
  },
  {
    name: "tinfoil",
    prefix: "dictation-realtime",
    options: { provider: "tinfoil-realtime" },
    host: "inference.tinfoil.sh",
    target: "tinfoil",
  },
  {
    name: "deepgram",
    prefix: "deepgram-streaming",
    options: {},
    host: "api.deepgram.com",
    target: "deepgram",
    finalize: "finalize",
  },
  {
    name: "assemblyai",
    prefix: "assemblyai-streaming",
    options: {},
    host: "streaming.assemblyai.com",
    target: "assemblyai",
    finalize: "force-endpoint",
  },
  {
    name: "gemini",
    prefix: "gemini-streaming",
    options: {},
    host: "generativelanguage.googleapis.com",
    target: "gemini",
    finalize: "finalize",
  },
  {
    name: "corti",
    prefix: "corti-streaming",
    options: { environment: "us", tenant: "acme" },
    host: "api.us.corti.app",
    target: "corti",
    finalize: "finalize",
  },
];
const family = (name) => FAMILIES.find((f) => f.name === name);

function dictation(fam, wc = webContents()) {
  const call = (action, ...args) =>
    handlers.get(`${fam.prefix}-${action}`)({ sender: wc }, ...args);
  const emit = (action, ...args) => events.get(`${fam.prefix}-${action}`)({ sender: wc }, ...args);
  return {
    wc,
    warmup: () => call("warmup", { ...fam.options }),
    start: (id) => call("start", { ...fam.options, ...identity(id) }),
    send: (id, data) => emit("send", data, identity(id)),
    finalize: (id) => fam.finalize && emit(fam.finalize, identity(id)),
    cancel: (id) => call("cancel", identity(id)),
    stop: (id) => call("stop", identity(id)),
  };
}
const NOTHING_SENT = /nothing was sent/i;

// ---------------------------------------------------------------------------
// 1. Sealed: refused before any token request, credential read or socket.

test("sealed: every dictation warmup and start is refused before token, key read or socket", async () => {
  sealed = true;
  for (const fam of FAMILIES) {
    recorder.clear();
    const d = dictation(fam);
    for (const result of [await d.warmup(), await d.start(`sealed-${fam.name}`)]) {
      assert.equal(result.success, false, fam.name);
      assert.equal(result.code, "SEALED_MODE", fam.name);
      assert.equal(result.phase, "refused", fam.name);
      assert.match(result.error, /\[SEALED_MODE\]/);
    }
    assert.deepEqual(
      rows().map((row) => [row.task, row.host, row.outcome, row.bytesOut]),
      [
        ["dictationStt", fam.host, "blocked", 0],
        ["dictationStt", fam.host, "blocked", 0],
      ],
      fam.name
    );
  }
  assert.deepEqual(netCalls, [], "no token or auth request");
  assert.deepEqual(keyReads, [], "no credential was read");
  assert.deepEqual(routed, [], "no socket was constructed");
  assert.deepEqual(notices, []);
});

test("sealed: meeting prepare and start are refused before token or socket", async () => {
  sealed = true;
  const wc = webContents();
  const prepare = await handlers.get("meeting-transcription-prepare")(
    { sender: wc },
    { provider: "assemblyai-realtime", mode: "byok" }
  );
  const start = await handlers.get("meeting-transcription-start")(
    { sender: wc },
    { provider: "assemblyai-realtime", mode: "byok", sessionId: "meeting-sealed" }
  );
  for (const result of [prepare, start]) {
    assert.equal(result.success, false);
    assert.equal(result.code, "SEALED_MODE");
    assert.equal(result.phase, "refused");
  }
  assert.deepEqual(
    rows().map((row) => [row.task, row.host, row.outcome, row.bytesOut]),
    [
      ["noteRecordingStt", "streaming.assemblyai.com", "blocked", 0],
      ["noteRecordingStt", "streaming.assemblyai.com", "blocked", 0],
    ]
  );
  assert.deepEqual(netCalls, []);
  assert.deepEqual(keyReads, []);
  assert.deepEqual(routed, []);
  assert.deepEqual(notices, []);
});

// ---------------------------------------------------------------------------
// 2. Warm socket, then sequential recordings: one connection, one stream each.

test("warm then two sequential recordings: distinct connection and stream records, exact bytes", async () => {
  const fam = family("deepgram");
  const d = dictation(fam);
  const from = fixture.conns.length;

  assert.equal((await d.warmup()).success, true);
  await waitFor(() => fixture.conns.length === from + 1, "warm socket");
  assert.deepEqual(audioNotices(), [], "a warmed socket with no frames has no audio notice");
  assert.equal((await d.start("rec-A")).usedWarmConnection, true);
  d.send("rec-A", frame(3200));
  d.send("rec-A", frame(3200));
  await waitFor(() => contentTo(fam.host, from) === 6400, "A frames");
  d.finalize("rec-A");
  assert.equal((await d.stop("rec-A")).success, true);

  assert.equal((await d.warmup()).success, true);
  assert.equal(audioNotices("rec-B").length, 0, "a new warm socket adopts nothing");
  assert.equal((await d.start("rec-B")).usedWarmConnection, true);
  for (let i = 0; i < 3; i++) d.send("rec-B", frame(3200, 0x22));
  await waitFor(() => contentTo(fam.host, from) === 6400 + 9600, "B frames");
  assert.equal((await d.stop("rec-B")).success, true);
  await waitFor(() => rowsOf("connection", fam.host).length === 2, "both connections closed");

  const streams = rowsOf("stream", fam.host);
  assert.deepEqual(
    streams.map((row) => [row.task, row.outcome, row.bytesOut, row.bytesIn]),
    [
      ["dictationStt", "ok", 6400, null],
      ["dictationStt", "ok", 9600, null],
    ]
  );
  const connections = rowsOf("connection", fam.host);
  for (const row of connections) {
    assert.equal(row.task, "dictationStt");
    assert.equal(row.outcome, "ok");
    // Wire bytes counted on the connection's own socket (frames, framing, TLS-free here).
    assert.ok(row.bytesOut > 0 && row.bytesIn > 0, JSON.stringify(row));
  }
  assert.notEqual(connections[0].operationId, connections[1].operationId);
  assert.ok(connections[0].bytesOut > 6400 && connections[1].bytesOut > 9600);

  const a = audioNotices("rec-A");
  const b = audioNotices("rec-B");
  assert.deepEqual(
    [...a, ...b].map((n) => [n.phase, n.correlationId, n.targetId, n.task]),
    [
      ["dispatched", "rec-A", "deepgram", "dictationStt"],
      ["dispatched", "rec-B", "deepgram", "dictationStt"],
    ]
  );
  assert.notEqual(a[0].ticketId, b[0].ticketId);
  assert.notEqual(a[0].operationId, b[0].operationId);
  assert.equal(audioNotices().length, 2, "no audio notice without a recording");
  assert.ok(
    notices.every((n) => n.correlationId === null || ["rec-A", "rec-B"].includes(n.correlationId))
  );
});

// ---------------------------------------------------------------------------
// 3. Concurrent sessions with interleaved frames keep their own handles.

test("two concurrent recordings with interleaved frames stay attached to their own handles", async () => {
  const dg = dictation(family("deepgram"));
  const aai = dictation(family("assemblyai"));
  const from = fixture.conns.length;
  assert.equal((await dg.start("mix-A")).success, true);
  assert.equal((await aai.start("mix-B")).success, true);
  for (let i = 0; i < 3; i++) {
    dg.send("mix-A", frame(3200, 0x31));
    if (i < 2) aai.send("mix-B", frame(4800, 0x32));
  }
  await waitFor(
    () =>
      contentTo("api.deepgram.com", from) === 9600 &&
      contentTo("streaming.assemblyai.com", from) === 9600,
    "interleaved frames"
  );
  await Promise.all([dg.stop("mix-A"), aai.stop("mix-B")]);

  assert.deepEqual(
    rowsOf("stream").map((row) => [row.host, row.bytesOut, row.outcome]),
    [
      ["api.deepgram.com", 9600, "ok"],
      ["streaming.assemblyai.com", 9600, "ok"],
    ].filter(Boolean)
  );
  assert.deepEqual(
    audioNotices().map((n) => [n.correlationId, n.targetId]),
    [
      ["mix-A", "deepgram"],
      ["mix-B", "assemblyai"],
    ]
  );
  // N10: AssemblyAI's temporary token is a dictationStt metadata request of
  // the connection, never the recording's correlation or an audio receipt.
  const token = rows().find(
    (row) => row.host === "streaming.assemblyai.com" && row.kind === "request"
  );
  assert.deepEqual([token.task, token.outcome], ["dictationStt", "ok"]);
  const tokenNotices = notices.filter((n) => n.payload === "metadata");
  assert.ok(tokenNotices.length > 0);
  assert.ok(tokenNotices.every((n) => n.correlationId === null && n.task === "dictationStt"));
});

// ---------------------------------------------------------------------------
// 4. Unknown, finished, foreign and mismatched handles are refused.

test("a send for a finished or mismatched recording is refused and mutates no other recording", async () => {
  const fam = family("deepgram");
  const d = dictation(fam);
  const from = fixture.conns.length;
  await d.start("old-A");
  d.send("old-A", frame(3200));
  await waitFor(() => contentTo(fam.host, from) === 3200, "A frame");
  await d.stop("old-A");
  await d.start("new-B");
  d.send("old-A", frame(3200)); // finished recording's identity
  d.send("new-B", frame(2)); // B's own
  events.get(`${fam.prefix}-send`)(
    { sender: d.wc },
    frame(3200),
    { ...identity("new-B"), correlationId: "old-A" } // mismatched session
  );
  events.get(`${fam.prefix}-send`)({ sender: webContents() }, frame(3200), identity("new-B"));
  await waitFor(() => contentTo(fam.host, from) === 3202, "B frame");
  await sleep(50);
  assert.equal(contentTo(fam.host, from), 3202, "only B's own frame left");
  await d.stop("new-B");
  assert.deepEqual(
    rowsOf("stream").map((row) => row.bytesOut),
    [3200, 2]
  );
  assert.deepEqual(
    audioNotices().map((n) => n.correlationId),
    ["old-A", "new-B"]
  );
});

test("the frame hand-off refuses missing, forged, finished and foreign handles", () => {
  const { sendContentFrame } = handOff();
  const { beginRealtimeRecording, finishRealtimeRecording } = stt();
  const sent = [];
  const adapter = { ws: { send: (data, done) => (sent.push(Buffer.from(data)), done?.()) } };
  const live = beginRealtimeRecording({
    task: "dictationStt",
    provider: "deepgram",
    correlationId: "live",
  });
  const finished = beginRealtimeRecording({
    task: "dictationStt",
    provider: "deepgram",
    correlationId: "done",
  });
  finishRealtimeRecording(finished, "ok");
  const forged = Object.freeze({ ...live });
  for (const handle of [undefined, null, forged, finished, { token: live.token }])
    assert.equal(sendContentFrame(adapter, Buffer.alloc(4, 1), handle), false);
  assert.equal(sent.length, 0, "nothing left for a refused handle");
  assert.equal(sendContentFrame(adapter, Buffer.alloc(4, 1), live), true);
  assert.equal(sent.length, 1);
  finishRealtimeRecording(live, "ok");
  assert.equal(sendContentFrame(adapter, Buffer.alloc(4, 1), live), false);
  assert.deepEqual(
    rowsOf("stream").map((row) => [row.host, row.bytesOut, row.outcome]),
    [["api.deepgram.com", 4, "ok"]]
  );
  assert.deepEqual(
    audioNotices().map((n) => n.correlationId),
    ["live"]
  );
});

test("one connection serving two recordings yields two distinct stream records", () => {
  const { sendContentFrame } = handOff();
  const { beginRealtimeRecording, finishRealtimeRecording, connectRealtime } = stt();
  const sent = [];
  const socket = new EventEmitter();
  socket.send = (data, done) => (sent.push(data.length), done?.());
  socket.terminate = () => socket.emit("close");
  const adapter = {
    ws: connectRealtime(
      { task: "dictationStt", provider: "deepgram", target: "wss://api.deepgram.com/v1/listen" },
      () => socket
    ),
  };
  const one = beginRealtimeRecording({
    task: "dictationStt",
    provider: "deepgram",
    correlationId: "one",
  });
  const two = beginRealtimeRecording({
    task: "dictationStt",
    provider: "deepgram",
    correlationId: "two",
  });
  sendContentFrame(adapter, Buffer.alloc(10, 1), one);
  sendContentFrame(adapter, Buffer.alloc(20, 1), two);
  sendContentFrame(adapter, Buffer.alloc(30, 1), one);
  finishRealtimeRecording(one, "ok");
  sendContentFrame(adapter, Buffer.alloc(40, 1), one); // finished: refused
  sendContentFrame(adapter, Buffer.alloc(50, 1), two);
  finishRealtimeRecording(two, "cancelled");
  socket.emit("close");
  assert.deepEqual(sent, [10, 20, 30, 50]);
  assert.deepEqual(
    rows().map((row) => [row.kind, row.bytesOut, row.outcome]),
    [
      // Rows are ordered by start: the connection opened before both recordings.
      ["connection", null, "ok"],
      ["stream", 40, "ok"],
      ["stream", 70, "cancelled"],
    ]
  );
  assert.deepEqual(
    audioNotices().map((n) => [n.correlationId, n.targetId]),
    [
      ["one", "deepgram"],
      ["two", "deepgram"],
    ]
  );
  assert.ok(
    notices.every((n) => n.correlationId !== null),
    "the connection has no receipts"
  );
});

// ---------------------------------------------------------------------------
// 5. Main notices reach Plan 04's real disclosure tracker.

test("Plan 04 tracker: one audio disclosure per recording with its own session and target", async () => {
  const privacyApi = {
    onEgress(callback) {
      const relays = ["dispatched", "delivered", "undelivered"].map((phase) => {
        const relay = (notice) => callback({ phase, ...notice });
        gate.events.on(phase, relay);
        return [phase, relay];
      });
      return () => relays.forEach(([phase, relay]) => gate.events.off(phase, relay));
    },
  };
  const session = (id, providerId) => ({
    id,
    routes: { dictationStt: { locality: "cloud", providerId } },
    settings: {},
  });
  const trackerA = createDisclosureTracker({ session: session("trk-A", "deepgram"), privacyApi });
  const trackerB = createDisclosureTracker({
    session: session("trk-B", "assemblyai"),
    privacyApi,
  });
  const dg = dictation(family("deepgram"));
  const aai = dictation(family("assemblyai"));
  const from = fixture.conns.length;
  assert.equal((await aai.warmup()).success, true, "warm token + socket");
  assert.equal(trackerB.get(), null, "a warm connection discloses nothing");
  await dg.start("trk-A");
  await aai.start("trk-B");
  dg.send("trk-A", frame(3200));
  aai.send("trk-B", frame(3200));
  await waitFor(
    () =>
      contentTo("api.deepgram.com", from) === 3200 &&
      contentTo("streaming.assemblyai.com", from) === 3200,
    "frames"
  );
  await dg.stop("trk-A");
  await aai.stop("trk-B");
  assert.deepEqual(trackerA.get(), {
    target: "deepgram",
    payload: "audio",
    evidence: "dispatched",
    alsoSentTo: [],
  });
  assert.deepEqual(trackerB.get(), {
    target: "assemblyai",
    payload: "audio",
    evidence: "dispatched",
    alsoSentTo: [],
  });
  trackerA.dispose();
  trackerB.dispose();
});

// ---------------------------------------------------------------------------
// 6. Sealing mid-stream interrupts the recording and settles the socket apart.

test("seal mid-stream: recording interrupted with its identity, connection settled separately", async () => {
  const fam = family("deepgram");
  const d = dictation(fam);
  const from = fixture.conns.length;
  await d.start("seal-A");
  d.send("seal-A", frame(3200));
  d.send("seal-A", frame(3200));
  await waitFor(() => contentTo(fam.host, from) === 6400, "frames before seal");

  sealed = true;
  assert.ok(gate.abortAllRemote() >= 2, "stream and connection tickets are both remote work");
  d.send("seal-A", frame(3200));
  await waitFor(() => rowsOf("connection", fam.host).length === 1, "socket closed");
  const result = await d.stop("seal-A");
  assert.equal(result.code, "SEALED_MODE");
  assert.equal(result.phase, "interrupted");
  assert.doesNotMatch(JSON.stringify(result), NOTHING_SENT);
  assert.equal(contentTo(fam.host, from), 6400, "no frame left after sealing");

  const [stream] = rowsOf("stream", fam.host);
  assert.deepEqual(
    [stream.task, stream.outcome, stream.errorClass, stream.bytesOut],
    ["dictationStt", "cancelled", "SEALED_MODE", 6400]
  );
  const [connection] = rowsOf("connection", fam.host);
  assert.deepEqual(
    [connection.task, connection.outcome, connection.errorClass],
    ["dictationStt", "cancelled", "SEALED_MODE"]
  );
  assert.ok(connection.bytesOut > 6400, "wire bytes are still known");
  assert.notEqual(connection.operationId, stream.operationId);
  assert.deepEqual(
    notices.map((n) => [n.phase, n.correlationId, n.payload]),
    [["dispatched", "seal-A", "audio"]],
    "the dispatched receipt is kept; nothing withdraws it"
  );
});

test("seal mid-connect: the start fails as interrupted, never as nothing sent", async () => {
  const fam = family("deepgram");
  const d = dictation(fam);
  const from = fixture.conns.length;
  fixture.holdReady = true; // socket open, provider not ready yet
  const starting = d.start("connect-A");
  await waitFor(() => fixture.conns.length === from + 1, "socket open");
  sealed = true;
  gate.abortAllRemote();
  const result = await starting;
  assert.equal(result.success, false);
  assert.equal(result.code, "SEALED_MODE");
  assert.equal(result.phase, "interrupted");
  assert.doesNotMatch(JSON.stringify(result), NOTHING_SENT);
  await waitFor(() => rowsOf("connection", fam.host).length === 1, "connection settled");
  const [connection] = rowsOf("connection", fam.host);
  assert.deepEqual(
    [connection.task, connection.outcome, connection.errorClass],
    ["dictationStt", "cancelled", "SEALED_MODE"]
  );
  assert.equal(contentTo(fam.host, from), 0, "no audio left");
  assert.deepEqual(rowsOf("stream"), []);
  assert.deepEqual(audioNotices(), []);
});

test("seal mid-meeting: the meeting recording is interrupted and replacement sockets are refused", async () => {
  const wc = webContents();
  const from = fixture.conns.length;
  const start = await handlers.get("meeting-transcription-start")(
    { sender: wc },
    { provider: "deepgram-realtime", mode: "byok", sessionId: "meet-seal" }
  );
  assert.equal(start.success, true, JSON.stringify(start));
  events.get("meeting-transcription-send")({ sender: wc }, frame(3200), "system");
  await waitFor(() => contentTo("api.deepgram.com", from) === 3200, "system frame");
  sealed = true;
  gate.abortAllRemote();
  await waitFor(() => rowsOf("connection", "api.deepgram.com").length === 2, "both sockets");
  events.get("meeting-transcription-send")({ sender: wc }, frame(3200), "system");
  const stop = await handlers.get("meeting-transcription-stop")({ sender: wc }, "meet-seal");
  assert.equal(stop.phase, "interrupted");
  assert.doesNotMatch(JSON.stringify(stop), NOTHING_SENT);
  const [stream] = rowsOf("stream");
  assert.deepEqual(
    [stream.task, stream.outcome, stream.errorClass, stream.bytesOut],
    ["noteRecordingStt", "cancelled", "SEALED_MODE", 3200]
  );
  assert.ok(
    rows().some(
      (row) => row.task === "noteRecordingStt" && row.outcome === "blocked" && row.bytesOut === 0
    ),
    "the replacement connection was refused before its token or socket"
  );
  assert.equal(contentTo("api.deepgram.com", from), 3200);
  assert.deepEqual(
    audioNotices().map((n) => [n.correlationId, n.task]),
    [["meet-seal", "noteRecordingStt"]]
  );
});

// ---------------------------------------------------------------------------
// 7. Every registered realtime route, including meetings, reconnect and refresh.

for (const fam of FAMILIES) {
  test(`${fam.name}: warmup, start, send, flush and stop attribute exactly one recording`, async () => {
    const d = dictation(fam);
    const from = fixture.conns.length;
    const id = `route-${fam.name}`;
    const warmed = await d.warmup();
    assert.equal(warmed.success, true, JSON.stringify(warmed));
    const started = await d.start(id);
    assert.equal(started.success, true, JSON.stringify(started));
    assert.equal(started.usedWarmConnection, true);
    for (let i = 0; i < 3; i++) d.send(id, frame(3200, 0x40 + i));
    d.finalize(id);
    await waitFor(
      () => fixture.conns.slice(from).some((c) => c.frames === 3),
      `${fam.name} frames`
    );
    const stopped = await d.stop(id);
    assert.equal(stopped.success, true, JSON.stringify(stopped));
    assert.equal(stopped.code, undefined);
    await waitFor(() => rowsOf("connection", fam.host).length >= 1, "connection closed");

    const [stream, ...extra] = rowsOf("stream", fam.host);
    assert.equal(extra.length, 0);
    assert.deepEqual(
      [stream.task, stream.outcome, stream.bytesOut],
      ["dictationStt", "ok", contentTo(fam.host, from)]
    );
    for (const connection of rowsOf("connection", fam.host)) {
      assert.equal(connection.task, "dictationStt");
      assert.ok(connection.bytesOut > 0, `${fam.name} wire bytes`);
    }
    assert.deepEqual(
      audioNotices().map((n) => [n.phase, n.correlationId, n.targetId, n.task]),
      [["dispatched", id, fam.target, "dictationStt"]]
    );
    if (fam.name === "corti") {
      const auth = rows().find((row) => row.host === "auth.us.corti.app");
      assert.deepEqual([auth.task, auth.kind], ["dictationStt", "request"]);
    }
  });
}

for (const fam of FAMILIES) {
  test(`${fam.name}: cancel settles only that recording as cancelled`, async () => {
    const d = dictation(fam);
    const from = fixture.conns.length;
    const id = `cancel-${fam.name}`;
    const started = await d.start(id);
    assert.equal(started.success, true, JSON.stringify(started));
    d.send(id, frame(3200));
    await waitFor(() => fixture.conns.slice(from).some((c) => c.frames === 1), "frame");
    const sentBefore = contentTo(fam.host, from);
    assert.equal((await d.cancel(id)).success, true);
    d.send(id, frame(3200));
    await d.stop(id);
    assert.deepEqual(
      rowsOf("stream").map((row) => [row.host, row.bytesOut, row.outcome]),
      [[fam.host, sentBefore, "cancelled"]]
    );
    assert.equal(contentTo(fam.host, from), sentBefore, "nothing left after cancel");
    assert.deepEqual(
      audioNotices().map((n) => n.correlationId),
      [id]
    );
  });
}

test("deepgram liveness reconnect: a replacement connection, replayed audio stays on its recording", async () => {
  const fam = family("deepgram");
  const d = dictation(fam);
  const from = fixture.conns.length;
  fixture.silentDeepgram = true;
  assert.equal((await d.warmup()).success, true);
  await d.start("live-A");
  d.send("live-A", frame(3200));
  await waitFor(() => contentTo(fam.host, from) === 3200, "first frame");
  // No Results within the liveness window: the adapter replaces its socket.
  await waitFor(() => fixture.conns.length === from + 2, "replacement socket", 6000);
  fixture.silentDeepgram = false;
  await waitFor(() => rowsOf("connection", fam.host).length === 1, "retired socket");
  d.send("live-A", frame(3200, 0x55));
  await waitFor(() => contentTo(fam.host, from) === 3200 + 3200 + 3200, "replay and new frame");
  await d.stop("live-A");
  await waitFor(() => rowsOf("connection", fam.host).length === 2, "replacement closed");
  assert.deepEqual(
    rowsOf("stream", fam.host).map((row) => [row.bytesOut, row.outcome]),
    [[9600, "ok"]]
  );
  assert.deepEqual(
    audioNotices().map((n) => n.correlationId),
    ["live-A"]
  );
  assert.ok(rowsOf("connection", fam.host).every((row) => row.task === "dictationStt"));
});

test("meeting: prepare (warm), start, send, reconnect and stop attribute one recording", async () => {
  const wc = webContents();
  const from = fixture.conns.length;
  const prepare = await handlers.get("meeting-transcription-prepare")(
    { sender: wc },
    { provider: "assemblyai-realtime", mode: "byok" }
  );
  assert.equal(prepare.success, true, JSON.stringify(prepare));
  await waitFor(() => fixture.conns.length === from + 2, "mic and system sockets");
  assert.deepEqual(audioNotices(), [], "prepared sockets disclose nothing");
  const start = await handlers.get("meeting-transcription-start")(
    { sender: wc },
    { provider: "assemblyai-realtime", mode: "byok", sessionId: "meet-A" }
  );
  assert.equal(start.success, true, JSON.stringify(start));
  assert.equal(fixture.conns.length, from + 2, "the recording reused the prepared sockets");
  const send = (source, fill) =>
    events.get("meeting-transcription-send")({ sender: wc }, frame(4800, fill), source);
  send("system", 0x61);
  send("mic", 0x62);
  send("system", 0x63);
  await waitFor(() => contentTo("streaming.assemblyai.com", from) >= 9600, "system frames");

  // The provider drops the system socket: the meeting replaces both streams.
  fixture.conns[from + 1].ws.close(1011);
  await waitFor(() => fixture.conns.length === from + 4, "replacement sockets");
  await sleep(50);
  send("system", 0x64);
  const stop = await handlers.get("meeting-transcription-stop")({ sender: wc }, "meet-A");
  assert.equal(stop.success, true, JSON.stringify(stop));
  await waitFor(() => rowsOf("connection", "streaming.assemblyai.com").length === 4, "closed");

  const streams = rowsOf("stream");
  assert.equal(streams.length, 1);
  assert.deepEqual(
    [streams[0].task, streams[0].host, streams[0].outcome, streams[0].bytesOut],
    [
      "noteRecordingStt",
      "streaming.assemblyai.com",
      "ok",
      contentTo("streaming.assemblyai.com", from),
    ]
  );
  assert.ok(rowsOf("connection").every((row) => row.task === "noteRecordingStt"));
  assert.deepEqual(
    audioNotices().map((n) => [n.correlationId, n.task, n.targetId]),
    [["meet-A", "noteRecordingStt", "assemblyai"]]
  );
  const tokens = rows().filter((row) => row.kind === "request");
  assert.ok(tokens.length >= 2 && tokens.every((row) => row.task === "noteRecordingStt"));
  assert.ok(
    notices.filter((n) => n.payload === "metadata").every((n) => n.correlationId === null),
    "token receipts never carry the meeting's id"
  );
});

// Discovery: every registered realtime route was driven above.
test("every registered realtime warmup/start/send/flush/stop route was exercised", () => {
  const ROUTE =
    /^(?:(?:dictation-realtime|assemblyai-streaming|deepgram-streaming|gemini-streaming|corti-streaming)-(?:warmup|start|send|finalize|force-endpoint|cancel|stop)|meeting-transcription-(?:prepare|start|send|stop))$/;
  const registered = [...handlers.keys(), ...events.keys()].filter((name) => ROUTE.test(name));
  assert.ok(registered.length >= 30, `registered: ${registered.length}`);
  assert.deepEqual(
    registered.filter((name) => !invoked.has(name)),
    []
  );
});

// T9a-M1 (Task 13): the reviewer's gap probe as a real test.
for (const name of ["deepgram", "openai"]) {
  test(`seal after connect, before the first frame (${name}): stop is a typed sealed failure, never an empty success`, async () => {
    const fam = family(name);
    const d = dictation(fam);
    const from = fixture.conns.length;
    const started = await d.start(`gap-${name}`);
    assert.equal(started.success, true, JSON.stringify(started));
    sealed = true;
    gate.abortAllRemote();
    await waitFor(() => rowsOf("connection", fam.host).length >= 1, "socket closed");
    d.send(`gap-${name}`, frame(3200));
    const stopped = await d.stop(`gap-${name}`);
    assert.equal(stopped.success, false, JSON.stringify(stopped));
    assert.equal(stopped.code, "SEALED_MODE");
    assert.equal(
      stopped.phase,
      "interrupted",
      "the provider had the session; not 'nothing was sent'"
    );
    assert.equal(stopped.messageKey, "sealedMode.interrupted.generic");
    assert.equal(stopped.text, "");
    assert.match(stopped.error, /\[SEALED_MODE:interrupted\]/);
    assert.doesNotMatch(JSON.stringify(stopped), NOTHING_SENT);
    assert.equal(contentTo(fam.host, from), 0, "no audio of this recording left");
  });
}

test("a recording that ends before any seal stays an ordinary result", async () => {
  const fam = family("deepgram");
  const d = dictation(fam);
  assert.equal((await d.start("no-seal")).success, true);
  const stopped = await d.stop("no-seal");
  assert.equal(stopped.success, true);
  assert.equal(stopped.code, undefined);
  sealed = true;
  gate.abortAllRemote(); // a later seal does not reach back into a finished recording
});
