const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const osNode = require("node:os");
const { EventEmitter } = require("node:events");

const handlersModulePath = require.resolve("../../src/helpers/ipcHandlers");
// The real adapters the start handlers drive. Only their `ws` is replaced.
const ADAPTER_PATHS = new Set(
  [
    "openaiRealtimeStreaming",
    "deepgramStreaming",
    "assemblyAiStreaming",
    "geminiLiveStreaming",
    "cortiStreaming",
  ].map((name) => require.resolve(`../../src/helpers/${name}`))
);
const originalLoad = Module._load;

// One timeline for the whole exchange: each content frame that leaves on any
// socket, and each hand-off main sends to the renderer.
const timeline = [];
const dispatches = [];
const sockets = [];
const isContentFrame = (data) =>
  Buffer.isBuffer(data)
    ? data.some((byte) => byte !== 0) // Deepgram's warm keep-alive is all-zero silence, never the user's audio
    : /"input_audio_buffer\.append"|"realtimeInput":\{"audio"/.test(String(data));

// Each provider's close handshake, answered on the next turn.
const SERVER_REPLIES = [
  [
    /"input_audio_buffer\.commit"/,
    { type: "conversation.item.input_audio_transcription.completed", transcript: "" },
  ],
  [/"Terminate"/, { type: "Termination" }],
  [/"type":"flush"/, { type: "flushed" }],
  [/"audioStreamEnd"/, { serverContent: { generationComplete: true } }],
  [/"CloseStream"/, "close"],
];

class FakeSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    super();
    this.url = String(url);
    this.readyState = FakeSocket.CONNECTING;
    this.sent = [];
    sockets.push(this);
  }

  send(data, done) {
    if (done) setImmediate(done);
    this.sent.push(data);
    if (isContentFrame(data)) timeline.push("frame");
    const reply =
      !Buffer.isBuffer(data) && SERVER_REPLIES.find(([pattern]) => pattern.test(String(data)));
    if (!reply) return;
    setImmediate(() => {
      if (reply[1] !== "close") return this.emit("message", JSON.stringify(reply[1]));
      this.readyState = FakeSocket.CLOSED;
      this.emit("close", 1000, Buffer.from(""));
    });
  }

  ping() {}

  terminate() {
    this.readyState = FakeSocket.CLOSED;
  }

  close() {
    this.readyState = FakeSocket.CLOSED;
  }
}

// The token fetch (fetchRealtimeToken, ipcHandlers.js:5938-5949) and Corti's mint
// are network round trips. A test can hold or fail them.
let credential = "credential-1";
let realtimeToken = async () => "token";

const handlers = new Map();
const listeners = new Map();
const electronStub = {
  app: {
    getPath: () => osNode.tmpdir(),
    getName: () => "test",
    getVersion: () => "0.0.0",
    isPackaged: false,
    on: () => {},
    requestSingleInstanceLock: () => true,
  },
  ipcMain: {
    handle: (channel, fn) => handlers.set(channel, fn),
    on: (channel, fn) => listeners.set(channel, fn),
    removeHandler: () => {},
  },
  net: {
    fetch: async () => {
      throw new Error("This suite makes no HTTP requests.");
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

Module._load = function loadWithFakes(request, parent, isMain) {
  if (request === "electron") return electronStub;
  if (request === "ws" && ADAPTER_PATHS.has(parent?.filename)) return FakeSocket;
  if (request === "./safeTempDir") return { getSafeTempDir: () => osNode.tmpdir() };
  if (parent?.filename === handlersModulePath) {
    if (request === "./urlAudioDownloader")
      return {
        sweepStaleTempArtifacts() {},
        download() {
          throw Error("No downloads");
        },
      };
    if (request === "./realtimeTokenProviders")
      return { fetchRealtimeTokenForProvider: (provider) => realtimeToken(provider) };
    if (request === "./tinfoilRealtimeStreaming")
      return { TINFOIL_REALTIME_MODEL: "voxtral-mini-4b-realtime" };
    if (request === "./tinfoilSecureClient")
      return {
        createTinfoilRealtimeSocket: async () => new FakeSocket("wss://tinfoil.test/v1/realtime"),
      };
    const allowed = new Set([
      "./openaiRealtimeStreaming",
      "./deepgramStreaming",
      "./assemblyAiStreaming",
      "./geminiLiveStreaming",
      "./cortiStreaming",
      "./streamingHandOff",
      "./debugLogger",
      "./policyResponseError",
    ]);
    if (!allowed.has(request) && (request.startsWith(".") || request === "fs")) return anything();
  }
  return originalLoad.call(this, request, parent, isMain);
};

function anything() {
  return new Proxy(function () {}, {
    get: (t, prop) => {
      if (prop === Symbol.toPrimitive || prop === "toString") return () => "";
      if (prop === "then") return undefined;
      return anything();
    },
    apply: () => anything(),
  });
}

// The handlers' `this`: every adapter slot starts empty, as in the constructor (ipcHandlers.js:299-306).
const self = new Proxy(
  {
    environmentManager: new Proxy({}, { get: () => () => credential }),
    _dictationStreaming: null,
    _dictationConnectPromise: null,
    _dictationIdleTimer: null,
    _dictationPreviewEnabled: false,
    assemblyAiStreaming: null,
    deepgramStreaming: null,
    geminiStreaming: null,
    cortiStreaming: null,
    _mintStoredCortiToken: async (options) => ({
      token: await realtimeToken("corti"),
      environment: options.environment || "us",
      tenant: options.tenant || "base",
    }),
  },
  { get: (target, prop) => (prop in target ? target[prop] : anything()) }
);

const event = {
  sender: Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: (channel, payload) => {
      if (channel !== "dictation-dispatch") return;
      timeline.push("dispatch");
      dispatches.push(payload);
    },
  }),
};

test.before(() => {
  delete require.cache[handlersModulePath];
  const IPCHandlers = require(handlersModulePath);
  (IPCHandlers.default || IPCHandlers).prototype.setupHandlers.call(self);
});

test.after(() => {
  Module._load = originalLoad;
});

test.beforeEach(() => {
  event.sender.removeAllListeners();
  const Ctor = require(handlersModulePath);
  Ctor.prototype.setupHandlers.call(self);
  timeline.length = 0;
  dispatches.length = 0;
  realtimeToken = async () => "token";
  credential = "credential-1";
});

// A failed assertion can leave a token fetch or a handshake pending, and the next
// start would wait on it. Settle both, then let no keep-alive, liveness or refresh
// timer outlive its test.
test.afterEach(async () => {
  for (const gate of gates.splice(0)) gate.reject(new Error("The test ended."));
  for (const socket of sockets) {
    if (socket.readyState === FakeSocket.CLOSED) continue;
    socket.readyState = FakeSocket.CLOSED;
    socket.emit("close", 1006, Buffer.from(""));
  }
  await tick();
  clearTimeout(self._dictationIdleTimer);
  for (const key of [
    "_dictationStreaming",
    "assemblyAiStreaming",
    "deepgramStreaming",
    "geminiStreaming",
    "cortiStreaming",
  ]) {
    const adapter = self[key];
    if (!adapter) continue;
    adapter.cleanupWarmConnection?.();
    adapter.cleanupAll?.();
    adapter.cleanup();
    adapter.stopKeepAlive?.();
    self[key] = null;
  }
});

const json = (message) => JSON.stringify(message);
const open = (socket) => {
  socket.readyState = FakeSocket.OPEN;
  socket.emit("open");
};
const realtime = (provider, model) => ({
  start: "dictation-realtime-start",
  send: "dictation-realtime-send",
  warmup: "dictation-realtime-warmup",
  stop: "dictation-realtime-stop",
  cancel: "dictation-realtime-cancel",
  options: { provider, model },
  accept: (socket) => {
    socket.emit("message", json({ type: "session.created" }));
    socket.emit("message", json({ type: "session.updated" }));
  },
});
const channels = (prefix) => ({
  start: `${prefix}-streaming-start`,
  send: `${prefix}-streaming-send`,
  warmup: `${prefix}-streaming-warmup`,
  stop: `${prefix}-streaming-stop`,
  cancel: `${prefix}-streaming-cancel`,
  options: {},
});

// sendsBeforeAccept: forwards audio once the socket is open, before the provider accepts the session.
// Warm sockets can carry content only after this exact start is admitted.
// drainsAtAccept: frames buffered before the socket opened leave when the session is accepted.
const PROVIDERS = [
  {
    name: "openai-realtime",
    ...realtime("openai-realtime", "gpt-4o-mini-transcribe"),
    sendsBeforeAccept: true,
    warmSocketCarriesAudio: true,
  },
  {
    name: "tinfoil-realtime",
    ...realtime("tinfoil-realtime", undefined),
    sendsBeforeAccept: true,
    warmSocketCarriesAudio: true,
  },
  {
    name: "deepgram",
    ...channels("deepgram"),
    accept: (s) => s.emit("message", json({ type: "Metadata", request_id: "dg-1" })),
    sendsBeforeAccept: true,
  },
  {
    name: "assemblyai",
    ...channels("assemblyai"),
    accept: (s) => s.emit("message", json({ type: "Begin", id: "aai-1" })),
    sendsBeforeAccept: true,
  },
  {
    name: "gemini",
    ...channels("gemini"),
    accept: (s) => s.emit("message", json({ setupComplete: {} })),
    warmSocketCarriesAudio: true,
    drainsAtAccept: true,
  },
  {
    name: "corti",
    ...channels("corti"),
    accept: (s) => s.emit("message", json({ type: "CONFIG_ACCEPTED", sessionId: "corti-1" })),
  },
];

const FRAME = () => Buffer.alloc(3200, 1); // 100 ms of 16 kHz s16 PCM: over AssemblyAI's 50 ms floor, even-length for Gemini
const tick = () => new Promise((resolve) => setImmediate(resolve));
const startOptions = (row, extra = {}) => ({
  ...row.options,
  sampleRate: 16000,
  mode: "byok",
  ...identity,
  ...extra,
});
const identity = { correlationId: "rec-1", dictationSessionId: "rec-1", operationId: "attempt-1" };
const invoke = (channel, options = identity) => handlers.get(channel)(event, options);
const send = (row, frame = FRAME()) => listeners.get(row.send)(event, frame, identity);

async function socketAt(index) {
  for (let i = 0; i < 200 && !sockets[index]; i += 1) await tick();
  assert.ok(sockets[index], "the adapter opened a socket");
  return sockets[index];
}

async function startCold(row, extra) {
  const index = sockets.length;
  const started = invoke(row.start, startOptions(row, extra));
  return { started, socket: await socketAt(index) };
}

async function warmUp(row) {
  const index = sockets.length;
  const warming = invoke(row.warmup, startOptions(row, { correlationId: undefined }));
  const socket = await socketAt(index);
  open(socket);
  row.accept(socket);
  assert.equal((await warming).success, true);
  return socket;
}

const gates = [];
function held() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  const gate = { promise, resolve, reject };
  gates.push(gate);
  return gate;
}

// The property under test: main hands off once, on the line before the session's
// first content frame leaves, and never while no content frame has left.
function assertHandOff(expected, correlationId = "rec-1") {
  assert.equal(
    timeline.includes("frame"),
    expected,
    expected ? "a content frame left" : "no content frame left"
  );
  assert.deepEqual(
    dispatches,
    expected ? [{ correlationId, task: "dictationStt", payload: "audio" }] : []
  );
  if (expected)
    assert.equal(timeline[0], "dispatch", "the hand-off goes out before the first frame");
}

for (const row of PROVIDERS) {
  test(`${row.name}: a start that connects with no frame sent discloses nothing`, async () => {
    const { started, socket } = await startCold(row);
    open(socket);
    row.accept(socket);
    assert.equal((await started).success, true);
    await tick();
    assertHandOff(false);
  });

  test(`${row.name}: a warm start discloses nothing until the first frame leaves, and later frames add nothing`, async () => {
    const socket = await warmUp(row);
    if (row.name === "deepgram") {
      assert.ok(
        socket.sent.some((data) => Buffer.isBuffer(data) && !isContentFrame(data)),
        "the warm socket sent its silence"
      );
    }
    assert.equal((await invoke(row.start, startOptions(row))).success, true);
    await tick();
    assertHandOff(false);
    send(row);
    assertHandOff(true);
    send(row);
    send(row);
    assertHandOff(true);
  });

  test(`${row.name}: a frame sent while the socket connects is disclosed when it leaves, not before`, async () => {
    const { started, socket } = await startCold(row);
    send(row); // queued, or dropped where the adapter does not queue
    assertHandOff(false);
    open(socket);
    assertHandOff(false);
    row.accept(socket);
    assert.equal((await started).success, true);
    assertHandOff(Boolean(row.drainsAtAccept));
    send(row);
    assertHandOff(true);
  });

  for (const ending of ["completes", "fails"]) {
    test(`${row.name}: during a held handshake that ${ending}, a frame is disclosed only if it leaves`, async () => {
      const { started, socket } = await startCold(row);
      open(socket); // the socket is open; the provider has not accepted the session yet
      send(row);
      assertHandOff(Boolean(row.sendsBeforeAccept));
      if (ending === "completes") {
        row.accept(socket);
        assert.equal((await started).success, true);
        assertHandOff(true); // Gemini and Corti forward the frame they held, now
      } else {
        socket.readyState = FakeSocket.CLOSED;
        socket.emit("close", 1006, Buffer.from(""));
        assert.equal((await started).success, false);
        assertHandOff(Boolean(row.sendsBeforeAccept)); // a frame that left stays disclosed; a held one never leaves
      }
    });
  }

  test(`${row.name}: a connection that never comes up discloses nothing`, async () => {
    const token = held();
    realtimeToken = () => token.promise;
    const started = invoke(row.start, startOptions(row));
    await tick();
    send(row); // there is no socket yet: buffered or dropped
    send(row);
    assertHandOff(false);
    token.reject(new Error("401 Unauthorized"));
    assert.equal((await started).success, false);
    await tick();
    assertHandOff(false);
  });

  test(`${row.name}: a cancel during the token fetch discards the buffered audio, and nothing leaves (§5.2)`, async () => {
    const token = held();
    realtimeToken = () => token.promise;
    const started = invoke(row.start, startOptions(row));
    await tick();
    send(row); // buffered while the token is fetched
    assert.equal((await invoke(row.cancel)).success, true); // the renderer cancels before the start settles
    const index = sockets.length;
    token.resolve("token");
    assert.equal((await started).success, false);
    assert.equal(sockets.length, index, "cancelled token continuation cannot dial");
    send(row); // a late worklet frame after the cancel
    assert.equal((await invoke(row.stop)).success, true);
    assertHandOff(false); // zero content frames on the socket, and no dispatched hand-off
  });

  test(`${row.name}: a cancel while the socket connects discards the buffered audio, and nothing leaves (§5.2)`, async () => {
    const { started, socket } = await startCold(row);
    send(row); // buffered while the socket connects
    send(row);
    assert.equal((await invoke(row.cancel)).success, true);
    open(socket); // OpenAI, Tinfoil and Deepgram would drain here
    row.accept(socket); // Gemini and Corti would drain here
    await started.catch(() => {});
    assert.equal((await invoke(row.stop)).success, true); // Gemini's disconnect flush finds nothing
    assertHandOff(false);
  });

  test(`${row.name}: after a cancel, the next start (an Undo replay) sends again`, async () => {
    const first = await startCold(row);
    send(row);
    await invoke(row.cancel);
    open(first.socket);
    row.accept(first.socket);
    await first.started.catch(() => {});
    await invoke(row.stop);
    assertHandOff(false);
    // Task 8 replays the held frames through a new start with the same correlation id.
    const { started, socket } = await startCold(row, { operationId: "attempt-restore" });
    open(socket);
    row.accept(socket);
    assert.equal((await started).success, true);
    listeners.get(row.send)(event, FRAME(), { ...identity, operationId: "attempt-restore" });
    assertHandOff(true); // the gate reopened for the new start, and the replayed frame left
  });

  test(`${row.name}: each session is handed off once, and a stopped session never discloses the next`, async () => {
    let { started, socket } = await startCold(row);
    open(socket);
    row.accept(socket);
    await started;
    send(row);
    send(row);
    assertHandOff(true);
    assert.equal((await invoke(row.stop)).success, true);

    timeline.length = 0;
    dispatches.length = 0;
    ({ started, socket } = await startCold(row, {
      correlationId: "rec-2",
      dictationSessionId: "rec-2",
      operationId: "attempt-2",
    }));
    open(socket);
    row.accept(socket);
    assert.equal((await started).success, true);
    assertHandOff(false, "rec-2");
    listeners.get(row.send)(event, FRAME(), {
      correlationId: "rec-2",
      dictationSessionId: "rec-2",
      operationId: "attempt-2",
    });
    assertHandOff(true, "rec-2");
  });

  test(`${row.name}: a start that names no dictation never hands off`, async () => {
    const { started, socket } = await startCold(row, {
      correlationId: undefined,
      dictationSessionId: undefined,
      operationId: undefined,
    });
    open(socket);
    row.accept(socket);
    await started;
    listeners.get(row.send)(event, FRAME());
    assert.ok(timeline.includes("frame"));
    assert.deepEqual(dispatches, []);
  });
}

for (const row of PROVIDERS) {
  test(`${row.name}: warm content waits for matching admission`, async () => {
    await warmUp(row);
    send(row);
    assertHandOff(false);
    assert.equal((await invoke(row.start, startOptions(row))).success, true);
    send(row);
    assertHandOff(true);
  });
  test(`${row.name}: rotated credentials cannot reuse a warm transport`, async () => {
    const warm = await warmUp(row);
    credential = "credential-2";
    const { started, socket } = await startCold(row);
    assert.notEqual(socket, warm);
    open(socket);
    row.accept(socket);
    assert.equal((await started).success, true);
    send(row);
    assertHandOff(true);
  });
  test(`${row.name}: removed credentials refuse warm admission`, async () => {
    await warmUp(row);
    credential = "";
    assert.equal((await invoke(row.start, startOptions(row))).success, false);
    send(row);
    assertHandOff(false);
  });
}

test("assemblyai: audio held under the 50 ms floor is disclosed only when the frame carrying it leaves", async () => {
  const row = PROVIDERS.find((p) => p.name === "assemblyai");
  const { started, socket } = await startCold(row);
  open(socket);
  row.accept(socket);
  await started;
  send(row, Buffer.alloc(800, 1)); // 25 ms: carried forward (assemblyAiStreaming.js:613-618)
  assertHandOff(false);
  send(row, Buffer.alloc(800, 1));
  assertHandOff(true);
});
for (const row of PROVIDERS) {
  test(`${row.name}: deferred A cancel and refused B cannot reopen either attempt`, async () => {
    const gate = held();
    realtimeToken = () => gate.promise;
    const a = invoke(row.start, startOptions(row));
    await tick();
    send(row);
    await invoke(row.cancel);
    const b = { ...identity, operationId: "attempt-b" };
    assert.equal((await invoke(row.start, startOptions(row, b))).success, false);
    gate.resolve("token");
    assert.equal((await a).success, false);
    listeners.get(row.send)(event, FRAME(), b);
    send(row);
    assertHandOff(false);
  });
  test(`${row.name}: stale and other-window send finalize stop cancel cannot touch replacement`, async () => {
    const a = await startCold(row);
    open(a.socket);
    row.accept(a.socket);
    await a.started;
    await invoke(row.stop);
    const b = { ...identity, operationId: "attempt-b" };
    const next = await startCold(row, b);
    open(next.socket);
    row.accept(next.socket);
    await next.started;
    assert.equal((await invoke(row.cancel, identity)).success, false);
    assert.equal((await invoke(row.stop, identity)).success, false);
    const stranger = { sender: { ...event.sender } };
    assert.equal((await handlers.get(row.cancel)(stranger, b)).success, false);
    assert.equal((await handlers.get(row.stop)(stranger, b)).success, false);
    listeners.get(row.send)(event, FRAME(), identity);
    listeners.get(row.send)(stranger, FRAME(), b);
    listeners.get(row.send)(event, FRAME());
    assertHandOff(false);
    if (row.name !== "openai-realtime" && row.name !== "tinfoil-realtime") {
      const channel =
        row.name === "assemblyai"
          ? "assemblyai-streaming-force-endpoint"
          : `${row.name}-streaming-finalize`;
      const count = next.socket.sent.length;
      listeners.get(channel)(event, identity);
      assert.equal(next.socket.sent.length, count);
    }
    listeners.get(row.send)(event, FRAME(), b);
    assertHandOff(true);
  });
  test(`${row.name}: mismatched warm configuration cannot receive the next recording`, async () => {
    const old = await warmUp(row);
    const next = await startCold(row, { language: "de", environment: "us", tenant: "other" });
    assert.notEqual(next.socket, old);
    open(next.socket);
    row.accept(next.socket);
    assert.equal((await next.started).success, true);
    send(row);
    assertHandOff(true);
    assert.equal(old.sent.some(isContentFrame), false);
  });
}
for (const [name, file, field] of [
  ["openai", "openaiRealtimeStreaming", "coldStartBuffer"],
  ["deepgram", "deepgramStreaming", "replayBuffer"],
  ["assemblyai", "assemblyAiStreaming", "pendingAudio"],
  ["gemini", "geminiLiveStreaming", "coldStartBuffer"],
  ["corti", "cortiStreaming", "preConfigBuffer"],
]) {
  for (const ending of ["cancel", "terminal"])
    test(`${name}: ${ending} erases owned offset views and retained queue aliases`, () => {
      const loaded = require(`../../src/helpers/${file}`);
      const Ctor = loaded.GeminiLiveStreaming || loaded;
      const adapter = new Ctor();
      const backing = Buffer.alloc(20, 9);
      const view = new Uint8Array(backing.buffer, backing.byteOffset + 4, 8);
      adapter[field] = [view];
      const remainder = Buffer.alloc(8, 7);
      if (name === "deepgram") adapter.coldStartBuffer = [remainder];
      if (ending === "cancel") adapter.discardPendingAudio();
      else adapter.cleanup();
      assert.deepEqual([...view], Array(8).fill(0));
      assert.equal(backing[0], 9);
      assert.equal(backing[15], 9);
      if (name === "deepgram") assert.equal(remainder.some(Boolean), false);
    });
}
test("binary transport borrows owned bytes only until its completion callback", () => {
  const { sendContentFrame, discardPendingAudio } = require("../../src/helpers/streamingHandOff");
  let borrowed, done;
  const adapter = {
    ws: {
      send: (data, cb) => {
        borrowed = data;
        done = cb;
      },
    },
  };
  const original = Buffer.alloc(20, 3);
  sendContentFrame(adapter, original.subarray(4, 12));
  assert.deepEqual([...borrowed], Array(8).fill(3));
  discardPendingAudio(adapter);
  assert.deepEqual([...borrowed], Array(8).fill(3), "do not corrupt a frame still borrowed by ws");
  done();
  assert.deepEqual([...borrowed], Array(8).fill(0));
  assert.equal(original[4], 3);
});

for (const model of ["gpt-4o-transcribe", "tinfoil-next"])
  test(`realtime: warm provider/model authority matches the actual new adapter ${model}`, async () => {
    const row = PROVIDERS[0];
    const old = await warmUp(row);
    const provider = model === "tinfoil-next" ? "tinfoil-realtime" : "openai-realtime";
    const next = await startCold(row, { provider, model });
    open(next.socket);
    row.accept(next.socket);
    assert.equal((await next.started).success, true);
    assert.notEqual(next.socket, old);
    assert.equal(self._dictationStreaming.model, model);
    if (provider === "tinfoil-realtime") assert.match(next.socket.url, /tinfoil/);
    send(row);
    assertHandOff(true);
    assert.equal(old.sent.some(isContentFrame), false);
  });
for (const row of PROVIDERS)
  test(`${row.name}: reusing an ended attempt cannot alias a main generation`, async () => {
    const a = await startCold(row);
    open(a.socket);
    row.accept(a.socket);
    await a.started;
    await invoke(row.stop);
    assert.equal((await invoke(row.start, startOptions(row))).success, false);
  });

for (const row of PROVIDERS) {
  for (const ending of ["cancel", "failed handshake"]) {
    test(`${row.name}: ${ending} erases the actual adapter's queued audio`, async () => {
      const { started, socket } = await startCold(row);
      let queue;
      if (row.name === "assemblyai") {
        open(socket);
        row.accept(socket);
        await started;
        send(row, Buffer.alloc(800, 7));
        queue = self.assemblyAiStreaming.pendingAudio;
      } else if (row.name === "corti") {
        open(socket);
        send(row);
        queue = self.cortiStreaming.preConfigBuffer;
      } else {
        send(row);
        queue = (
          row.name.includes("realtime") ? self._dictationStreaming : self[`${row.name}Streaming`]
        ).coldStartBuffer;
      }
      assert.ok(queue.length > 0, "production sendAudio retained audio");
      const retained = [...queue];
      assert.ok(retained.some((frame) => frame.some(Boolean)));
      if (ending === "cancel") {
        await invoke(row.cancel);
        for (const frame of retained) assert.equal(frame.some(Boolean), false);
        if (socket.readyState === FakeSocket.CONNECTING) open(socket);
        row.accept(socket);
        await started;
      } else {
        socket.readyState = FakeSocket.CLOSED;
        socket.emit("close", 1006, Buffer.from(""));
        await started;
        for (const frame of retained) assert.equal(frame.some(Boolean), false);
      }
      assertHandOff(false);
    });
  }
}

test("Deepgram erases reconnect-owned replay when its credential continuation fails", async () => {
  const row = PROVIDERS.find((p) => p.name === "deepgram");
  const { started, socket } = await startCold(row);
  open(socket);
  row.accept(socket);
  await started;
  const adapter = self.deepgramStreaming;
  adapter.startLivenessCheck();
  send(row);
  const replay = [...adapter.replayBuffer];
  assert.ok(replay.length);
  const gate = held();
  adapter.cachedToken = null;
  adapter.tokenRefreshFn = () => gate.promise;
  const reconnect = adapter.handleLivenessTimeout();
  await tick();
  await invoke(row.cancel);
  for (const frame of replay) assert.equal(frame.some(Boolean), false);
  gate.reject(Error("Synthetic token refusal"));
  await reconnect;
  assert.equal(adapter._reconnectingAudio, null);
});

for (const row of PROVIDERS)
  test(`${row.name}: lost owners close only their own adapter generation`, async () => {
    const { started, socket } = await startCold(row);
    open(socket);
    row.accept(socket);
    await started;
    const slot = row.name.includes("realtime")
      ? "_dictationStreaming"
      : row.name === "assemblyai"
        ? "assemblyAiStreaming"
        : `${row.name}Streaming`;
    const old = self[slot];
    const late = old.onFinalTranscript;
    event.sender.emit("did-start-navigation");
    assert.equal(self[slot], null);
    send(row);
    assertHandOff(false);
    const next = await startCold(row, { operationId: "new-owner-attempt" });
    open(next.socket);
    row.accept(next.socket);
    assert.equal((await next.started).success, true);
    late("old transcript");
    assert.equal(self[slot].isConnected, true);
    listeners.get(row.send)(event, FRAME(), { ...identity, operationId: "new-owner-attempt" });
    assertHandOff(true);
  });

for (const row of PROVIDERS) {
  for (const change of ["unchanged", "removed", "rotated"]) {
    test(`${row.name}: handshake content requires ${change} current credential authority`, async () => {
      const { started, socket } = await startCold(row);
      const slot = row.name.includes("realtime")
        ? "_dictationStreaming"
        : row.name === "assemblyai"
          ? "assemblyAiStreaming"
          : `${row.name}Streaming`;
      const adapter = self[slot];
      if (row.name === "corti" || row.name === "assemblyai") open(socket);
      send(row, row.name === "assemblyai" ? Buffer.alloc(800, 7) : FRAME());
      const retained = [
        ...(adapter.coldStartBuffer ?? []),
        ...(adapter.preConfigBuffer ?? []),
        ...(adapter.pendingAudio ?? []),
      ];
      assertHandOff(false);
      if (change !== "unchanged") credential = change === "removed" ? "" : "credential-2";
      if (socket.readyState === FakeSocket.CONNECTING) open(socket);
      // OpenAI/Deepgram/AssemblyAI can forward before acceptance; Gemini/Corti
      // also drain asynchronously from their actual acceptance callbacks.
      if (row.sendsBeforeAccept)
        send(row, row.name === "assemblyai" ? Buffer.alloc(800, 7) : FRAME());
      row.accept(socket);
      assert.equal((await started).success, change === "unchanged");
      if (change === "unchanged") {
        send(row);
        assertHandOff(true);
      } else {
        assertHandOff(false);
        for (const bytes of retained)
          assert.equal(bytes.some(Boolean), false, "obsolete queued bytes are erased");
      }
    });
  }
  for (const ending of ["close", "error"])
    for (const action of ["start", "warmup"]) {
      test(`${row.name}: ${action} reconnects after a warm transport ${ending}`, async () => {
        const old = await warmUp(row);
        old.readyState = FakeSocket.CLOSED;
        if (ending === "close") old.emit("close", 1006, Buffer.from(""));
        else old.emit("error", Error("Synthetic warm transport failure"));
        const index = sockets.length;
        const pending = invoke(
          action === "start" ? row.start : row.warmup,
          action === "start"
            ? startOptions(row)
            : startOptions(row, {
                correlationId: undefined,
                dictationSessionId: undefined,
                operationId: undefined,
              })
        );
        const next = await socketAt(index);
        assert.notEqual(next, old);
        open(next);
        row.accept(next);
        const result = await pending;
        assert.equal(result.success, true);
        assert.notEqual(result.alreadyWarm, true);
        assert.notEqual(result.usedWarmConnection, true);
        if (action === "start") {
          send(row);
          assertHandOff(true);
        } else assertHandOff(false);
      });
    }
}

for (const row of PROVIDERS) {
  test(`${row.name}: healthy repeated warmup preserves its exact reusable transport`, async () => {
    const warm = await warmUp(row),
      count = sockets.length;
    const result = await invoke(
      row.warmup,
      startOptions(row, {
        correlationId: undefined,
        dictationSessionId: undefined,
        operationId: undefined,
      })
    );
    assert.equal(result.success, true);
    assert.equal(result.alreadyWarm, true);
    assert.equal(sockets.length, count);
    assert.equal((await invoke(row.start, startOptions(row))).success, true);
    assert.equal(sockets.length, count);
    send(row);
    assertHandOff(true);
    assert.ok(warm.sent.some(isContentFrame));
  });
  test(`${row.name}: superseded warm token continuation cannot clean up the replacement`, async () => {
    const gate = held();
    realtimeToken = () => gate.promise;
    const old = invoke(
      row.warmup,
      startOptions(row, {
        correlationId: undefined,
        dictationSessionId: undefined,
        operationId: undefined,
      })
    );
    await tick();
    realtimeToken = async () => "new-token";
    const index = sockets.length;
    const next = invoke(
      row.warmup,
      startOptions(row, {
        correlationId: undefined,
        dictationSessionId: undefined,
        operationId: undefined,
        language: "de",
      })
    );
    const socket = await socketAt(index);
    open(socket);
    row.accept(socket);
    assert.equal((await next).success, true);
    gate.resolve("old-token");
    assert.equal((await old).success, false);
    assert.equal((await invoke(row.start, startOptions(row, { language: "de" }))).success, true);
    send(row);
    assertHandOff(true);
  });
  test(`${row.name}: old warm socket events cannot clean up an adopted replacement`, async () => {
    const old = await warmUp(row);
    const { started, socket } = await startCold(row, { language: "de" });
    open(socket);
    row.accept(socket);
    assert.equal((await started).success, true);
    old.emit("close", 1006, Buffer.from(""));
    old.emit("error", Error("Synthetic old warm error"));
    send(row);
    assertHandOff(true);
    assert.equal(socket.readyState, FakeSocket.OPEN);
  });
}

test("actual cancel buffer and same-session replay isolate a late Gemini handshake and stale Stop", async (t) => {
  const { loadAudioManager } = require("./harness/audioManager");
  const loaded = await loadAudioManager(t, {
    cachePrefix: "loqui-real-replay-main-",
    settingsKey: "__realReplaySettings",
    settings: {
      useLocalWhisper: false,
      transcriptionMode: "providers",
      cloudTranscriptionProvider: "gemini",
      cloudTranscriptionModel: "gemini-2.5-flash-native-audio-preview-12-2025",
      geminiApiKey: "synthetic",
      useCleanupModel: false,
    },
  });
  const row = PROVIDERS.find((row) => row.name === "gemini");
  const bus = new EventEmitter();
  const senderSend = event.sender.send;
  event.sender.send = (channel, payload) => {
    senderSend(channel, payload);
    bus.emit(channel, payload);
  };
  t.after(() => {
    event.sender.send = senderSend;
  });
  const subscribe = (channel) => (cb) => {
    bus.on(channel, cb);
    return () => bus.off(channel, cb);
  };
  const calls = [];
  loaded.window.electronAPI = {
    ...loaded.window.electronAPI,
    geminiStreamingStart: (options) => {
      calls.push(["start", options]);
      return invoke(row.start, options);
    },
    geminiStreamingSend: (bytes, operation) => {
      calls.push(["send", operation]);
      listeners.get(row.send)(event, bytes, operation);
    },
    geminiStreamingCancel: (operation) => {
      calls.push(["cancel", operation]);
      return invoke(row.cancel, operation);
    },
    geminiStreamingStop: (operation) => {
      calls.push(["stop", operation]);
      return invoke(row.stop, operation);
    },
    geminiStreamingFinalize: (operation) =>
      listeners.get("gemini-streaming-finalize")(event, operation),
    onGeminiPartialTranscript: subscribe("gemini-partial-transcript"),
    onGeminiFinalTranscript: subscribe("gemini-final-transcript"),
    onGeminiError: subscribe("gemini-error"),
    onGeminiSessionEnd: subscribe("gemini-session-end"),
    onDictationDispatch: subscribe("dictation-dispatch"),
  };
  const { createUndoWindow } = await loaded.vite.ssrLoadModule("/helpers/cancelBuffer.js");
  const completed = [];
  const manager = loaded.createManager({
    _undoWindowFactory: (opts) => createUndoWindow({ ...opts, setTimer: () => 1, clearTimer() {} }),
    _readSealed: () => false,
    _streamingCancellationGeneration: 0,
    _streamingSessionGeneration: 1,
    _activeStreamingSessionId: 1,
    isStreaming: true,
    isRecording: true,
    isProcessing: false,
    _streamingStartSettlementWaiters: [],
    streamingCleanupFns: [],
    micRecovery: { stop() {} },
    cleanupPreview: async () => {},
    cleanupStreamingAudio() {
      this.isStreaming = false;
    },
    onStateChange() {},
    onTranscriptionComplete: (result) => completed.push(result),
    shouldUseStreaming: () => false,
  });
  const session = manager.beginDictationSession({
    streaming: true,
    streamingProviderName: "gemini",
  });
  const context = manager._sessionContext,
    tracker = manager._disclosure;
  const attempt = {
    correlationId: session.id,
    dictationSessionId: session.id,
    operationId: "actual-original",
  };
  manager._streamingOperation = attempt;
  const frame = new Int16Array(1600).fill(9);
  manager._sessionAudio = {
    session,
    kind: "streaming",
    frames: [frame],
    fallbackSegments: [],
    fallbackChunks: [],
    durationSeconds: 2,
  };
  const index = sockets.length;
  const originalStart = invoke(row.start, { ...startOptions(row), ...attempt });
  const originalSocket = await socketAt(index);
  listeners.get(row.send)(event, frame.buffer, attempt);
  const queued = self.geminiStreaming.coldStartBuffer[0];
  assert.ok(queued.some((byte) => byte !== 0));
  await manager.cancelStreamingRecording();
  assert.equal(calls[0][0], "cancel", "Cancel is synchronous before hold/shutdown");
  const heldBuffer = manager._undo.peek();
  assert.equal(heldBuffer.context, context);
  assert.equal(heldBuffer.tracker, tracker);
  assert.equal(context.released, false);
  assert.equal(
    queued.every((byte) => byte === 0),
    true,
    "main erases old queued bytes"
  );
  assert.equal(heldBuffer.frames()[0][0], 9, "renderer hold survives main queue erasure");
  const replayIndex = sockets.length;
  assert.equal((await manager.restoreCancelled(session.id)).restored, true);
  const replaySocket = await socketAt(replayIndex);
  const replayAttempt = calls.find((call) => call[0] === "start")[1];
  assert.notEqual(replayAttempt.operationId, attempt.operationId);
  assert.equal(replayAttempt.dictationSessionId, session.id);
  assert.equal(replayAttempt.correlationId, session.id);
  open(originalSocket);
  row.accept(originalSocket);
  await originalStart;
  await invoke(row.stop, attempt);
  assert.equal(
    replaySocket.readyState,
    FakeSocket.CONNECTING,
    "late old Stop leaves the fresh replay alone"
  );
  assert.equal(originalSocket.sent.some(isContentFrame), false);
  open(replaySocket);
  row.accept(replaySocket);
  for (let i = 0; i < 20 && !replaySocket.sent.some(isContentFrame); i++) await tick();
  assert.ok(replaySocket.sent.some(isContentFrame));
  replaySocket.emit(
    "message",
    json({ serverContent: { inputTranscription: { text: "Restored words" } } })
  );
  await manager._restoreRun; // actual finalization, adapter Stop and completion
  assert.equal(completed[0].text, "Restored words");
  assert.equal(heldBuffer.isZeroed(), true);
  assert.equal(manager._sessionAudio, null);
  assert.equal(context.released, true);
  assert.equal(manager.isProcessing, false);
  assert.equal(manager.isStreaming, false);
});

for (const row of PROVIDERS) {
  test(`${row.name}: pending Stop settles Start before credentials and admits only a fresh replay attempt`, async () => {
    const token = held();
    realtimeToken = () => token.promise;
    const started = invoke(row.start, startOptions(row));
    await tick();
    await invoke(row.cancel);
    await invoke(row.stop);
    let settled = false;
    started.then(() => {
      settled = true;
    });
    await tick();
    assert.equal(settled, true, "retiring an attempt cannot leave its Start immortal");
    assert.equal((await started).success, false);
    assert.equal(
      (await invoke(row.start, startOptions(row))).success,
      false,
      "ended attempts cannot be reused"
    );
    realtimeToken = async () => "replacement-token";
    const fresh = { ...identity, operationId: "fresh-replay-attempt" };
    const index = sockets.length;
    const replay = invoke(row.start, { ...startOptions(row), ...fresh });
    const socket = await socketAt(index);
    open(socket);
    row.accept(socket);
    assert.equal((await replay).success, true);
    const before = sockets.length;
    token.resolve("old-token");
    await tick();
    assert.equal(sockets.length, before, "late old credentials do not dial");
    assert.equal((await invoke(row.stop)).reason, "stale-session");
    send(row);
    assertHandOff(false);
    listeners.get(row.send)(event, FRAME(), fresh);
    assertHandOff(true);
    assert.equal(socket.readyState, FakeSocket.OPEN);
    await invoke(row.cancel, fresh);
    await invoke(row.stop, fresh);
  });
}
