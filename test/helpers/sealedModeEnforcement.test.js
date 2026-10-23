// Plan 07a Task 12: the sealed-mode enforcement matrix.
//
// One real main process wiring, driven through its REAL registered IPC
// handlers: `new IPCHandlers(managers)` (whose constructor runs setupHandlers
// and builds the credential authority and Keyring), `registerPersonalInferenceIPC`
// over the production Codex factory, `attachUpdateIPC` over a real
// UpdateManager, the real external-open guard and confirmation dialog, and
// main.js itself (in a VM) for its own handlers and its A23 startup wiring.
// Credentials, enterprise config and recipient tokens are prepared through
// the real EnvironmentManager and credential authority with synthetic values.
//
// Only terminal leaves are fakes, and each is counted:
// - Electron `net.fetch` / `net.request` / `session.fetch` (Chromium transport),
// - Node's global `fetch` UNDER the real Layer B backstop (its socket leaf),
// - the `ws` constructor (routed to an owned numeric 127.0.0.1 listener),
// - the Tinfoil SDK client,
// - the native `child_process` / utilityProcess leaves UNDER the real spawn guard,
// - `shell.openExternal` / `shell.openPath` and `app.relaunch` (OS handoffs).
// Nothing in this file talks to a provider, resolves DNS or launches a child.
//
// Every refused row asserts: a typed SEALED_MODE result that states the phase
// "refused" (or a documented typed shape, or the confirmation path for OS
// handoffs); no transport, socket, native leaf or credential read;
// a blocked ledger row with bytesOut 0 and the right task; content preserved
// where the row carries user content. Every refused row then runs again with
// Layer A disabled; that run must reach a terminal leaf or a Layer B refusal,
// or its "refusal" proved nothing (a missing fake or an early validation error).
//
// The ratchet at the end enumerates every channel the real code registers and
// fails when one is neither a matrix row nor declared with its reason. A
// declared channel must not be able to make a request without a native launch
// (those are rows); declared native launches go through the spawn guard.
//
// What this does not prove: real Chromium sessions, ws upgrades over real
// sockets, redirects, electron-updater, OS isolation of native children
// (07b/D14-D16) and packaged builds. Task 16 and 07b own those.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// ---------------------------------------------------------------------------
// 1. Terminal leaves, installed BEFORE the real guards wrap them.

const transport = {
  netFetch: 0,
  netRequest: 0,
  sessionFetch: 0,
  nodeFetch: 0,
  socket: 0,
  ws: 0,
  tinfoilSdk: 0,
  nativeLeaf: 0,
  utilityLeaf: 0,
  shellOpen: 0,
  relaunch: 0,
};
const zeroTransport = () => Object.fromEntries(Object.keys(transport).map((k) => [k, 0]));
const nativeLeafCalls = [];
for (const name of ["spawn", "exec", "execFile", "fork", "spawnSync", "execSync", "execFileSync"]) {
  childProcess[name] = (...args) => {
    transport.nativeLeaf++;
    nativeLeafCalls.push([name, String(args[0])]);
    throw Object.assign(new Error(`native leaf reached: ${name} ${args[0]}`), {
      code: "MATRIX_NATIVE_LEAF",
    });
  };
}
const utilityProcess = {
  fork: () => {
    transport.utilityLeaf++;
    throw new Error("utilityProcess leaf reached");
  },
};

// Node fetch: the backstop wraps whatever global fetch is installed when it
// is installed, so this leaf sits under Layer B. Owned 127.0.0.1 listeners go
// to the safety chain's owned-loopback fetch; anything else is counted and
// answered in-process (never a socket).
const ownedFetch = globalThis.fetch;
let nodeFetchImpl = async () => {
  throw new Error("Node fetch leaf reached");
};
globalThis.fetch = (input, init) => {
  const url = new URL(String(input?.url ?? input));
  if (url.hostname === "127.0.0.1") {
    // The owned-loopback fetch reads a string destination; unwrap a Request.
    if (typeof input === "string" || input instanceof URL) return ownedFetch(input, init);
    return ownedFetch(url.href, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      duplex: input.body ? "half" : undefined,
      signal: input.signal,
      redirect: input.redirect,
      ...init,
    });
  }
  transport.nodeFetch++;
  return nodeFetchImpl(input, init);
};

const gate = require("../../src/helpers/privacy/egressGate");
const registry = require("../../src/helpers/privacy/childRegistry");
const backstop = require("../../src/helpers/privacy/egressBackstop");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const {
  isSealedModeError,
  sealedPhaseOf,
  isLoopbackHost,
} = require("../../src/helpers/privacy/egressPolicy");

registry.installSpawnGuard({ childProcess, utilityProcess });
backstop.installNodeBackstop();
let layerB = 0;
backstop.addObserver((event) => {
  if (!event.allowed) layerB++;
  else if (!isLoopbackHost(event.host)) transport.socket++;
});

// ---------------------------------------------------------------------------
// 2. Electron, Tinfoil SDK and ws leaves.

let netFetchImpl = async () => {
  throw new Error("Electron net.fetch leaf reached");
};
const opened = [];
const dialogs = [];
let dialogAnswers = [];
const electron = {
  net: {
    fetch: (url, init) => {
      transport.netFetch++;
      return netFetchImpl(String(url), init);
    },
    request: () => {
      transport.netRequest++;
      throw new Error("Electron net.request leaf reached");
    },
  },
  session: {
    fromPartition: () => ({
      fetch: (url, init) => {
        transport.sessionFetch++;
        return netFetchImpl(String(url), init);
      },
    }),
    defaultSession: {},
  },
  shell: {
    openExternal: async (url) => {
      transport.shellOpen++;
      opened.push(String(url));
    },
    openPath: async (target) => {
      transport.shellOpen++;
      opened.push(String(target));
      return "";
    },
    showItemInFolder: (target) => {
      transport.shellOpen++;
      opened.push(String(target));
    },
  },
  dialog: {
    showMessageBox: async (...args) => {
      dialogs.push(args.at(-1));
      return { response: dialogAnswers.length ? dialogAnswers.shift() : 0 };
    },
  },
  utilityProcess,
  // A renderer's window, for handlers that address the sender's window
  // (meeting reconnects replay to it).
  BrowserWindow: class BrowserWindow {
    static getAllWindows() {
      return [];
    }
    static fromWebContents(webContents) {
      return webContents ? { id: webContents.id, webContents, isDestroyed: () => false } : null;
    }
  },
};

const tinfoilSdk = {
  tinfoilSecureFetch: () => {
    transport.tinfoilSdk++;
    throw new Error("Tinfoil SDK leaf reached");
  },
  createTinfoilRealtimeSocket: async () => {
    transport.tinfoilSdk++;
    throw new Error("Tinfoil SDK leaf reached");
  },
};

// The provider ws boundary: an adapter's socket is constructed with the
// provider's own URL (what the gate authorizes) and routed to an owned numeric
// 127.0.0.1 fixture speaking the Deepgram protocol. Every construction counts.
const RealWebSocket = require("ws");
const wsFixture = { server: null, port: 0, conns: [] };
class RoutedWebSocket extends RealWebSocket {
  constructor(address, protocols, options) {
    transport.ws++;
    if (protocols && typeof protocols === "object" && !Array.isArray(protocols)) {
      options = protocols;
      protocols = undefined;
    }
    if (!wsFixture.port) throw new Error("ws leaf reached (no fixture listening)");
    const logical = new URL(address);
    super(
      `ws://127.0.0.1:${wsFixture.port}${logical.pathname}${logical.search}`,
      protocols,
      options
    );
  }
}
RoutedWebSocket.WebSocketServer = RealWebSocket.WebSocketServer;
async function startWsFixture() {
  if (wsFixture.server) return;
  await new Promise((resolve) => {
    wsFixture.server = new RealWebSocket.WebSocketServer({ host: "127.0.0.1", port: 0 }, resolve);
  });
  wsFixture.port = wsFixture.server.address().port;
  wsFixture.server.on("connection", (ws) => {
    const conn = { ws, content: 0 };
    wsFixture.conns.push(conn);
    ws.send(JSON.stringify({ type: "Metadata", request_id: `dg-${wsFixture.conns.length}` }));
    ws.on("message", (data, binary) => {
      if (binary && !data.every((b) => b === 0)) conn.content += data.length;
    });
  });
}
test.after(async () => {
  for (const conn of wsFixture.conns) conn.ws.terminate();
  if (wsFixture.server) await new Promise((resolve) => wsFixture.server.close(resolve));
});

// ---------------------------------------------------------------------------
// 3. Real credentials and config (synthetic values) through the real
// EnvironmentManager, with every secret getter counted.

const { realCredentialEnv } = require("./harness/realCredentialEnv");
const { loadIpcHandlers, inertUi } = require("./harness/ipcHandlersHarness");
const { BYOK_API_KEYS } = require("../../src/config/secretKeys");

const cleanups = [];
const fixtureEnv = realCredentialEnv(
  { after: (fn) => cleanups.push(fn) },
  {
    ...Object.fromEntries(BYOK_API_KEYS.map((k) => [k.env, `fixture-${k.base}-SECRET`])),
    CORTI_CLIENT_ID: "fixture-corti-id",
    CORTI_CLIENT_SECRET: "fixture-corti-SECRET",
    CUSTOM_TRANSCRIPTION_API_KEY: "fixture-custom-stt-SECRET",
    BEDROCK_ACCESS_KEY_ID: "AKIAFIXTURE",
    BEDROCK_SECRET_ACCESS_KEY: "fixture-bedrock-SECRET",
    AZURE_OPENAI_API_KEY: "fixture-azure-SECRET",
    VERTEX_API_KEY: "fixture-vertex-SECRET",
    VERTEX_AUTH_SOURCE: "apiKey",
    VERTEX_PROJECT: "fixture-project",
    VERTEX_LOCATION: "us-central1",
    GOOGLE_CALENDAR_CLIENT_ID: "fixture-google-client",
    MICROSOFT_CALENDAR_CLIENT_ID: "fixture-microsoft-client",
  }
);
const env = fixtureEnv.env;
const SECRET_GETTERS = [
  ...BYOK_API_KEYS.map((k) => k.get),
  "getCortiClientId",
  "getCortiClientSecret",
  "getCustomTranscriptionKey",
  "getCleanupCustomKey",
  "getBedrockAccessKeyId",
  "getBedrockSecretAccessKey",
  "getBedrockSessionToken",
  "getAzureApiKey",
  "getVertexApiKey",
  "getLegacyVertexApiKey",
];
let secretReads = 0;
// The credential authority's list() reports presence and generation only (no
// value leaves it); getter calls made inside it are not counted as reads.
let presenceOnly = 0;
for (const name of SECRET_GETTERS) {
  const read = env[name];
  if (typeof read !== "function") continue;
  env[name] = function countedSecretRead(...args) {
    if (presenceOnly === 0) secretReads++;
    return read.apply(this, args);
  };
}

// ---------------------------------------------------------------------------
// 4. Main's seal state. Layer A (the gate's authorization, and main's own
// predicates handed to IPCHandlers, UpdateManager, the calendar guard and the
// external-open guard) can be disabled for the sensitivity runs; Layer B (the
// backstop and the spawn guard read the gate's sealed supplier) cannot.

const flags = { sealed: true, layerAOff: false };
const mainSealed = () => flags.sealed && !flags.layerAOff;
let recorder;
let clock = 0;
const now = () => ++clock;
function resetGate() {
  gate._resetForTests();
  recorder = new FlightRecorder({ now });
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now });
}
resetGate();

// ---------------------------------------------------------------------------
// 5. The real handlers.

const databaseRows = { writes: [], health: new Map() };
const databaseManager = {
  getKeyHealth: () => [...databaseRows.health.values()],
  saveKeyHealth: (row) => databaseRows.health.set(row.identity, { ...row }),
  deleteKeyHealth: (identity) => databaseRows.health.delete(identity),
  getTranscriptionById: (id) => ({ id, audio_duration_ms: 1200, text: "original words" }),
  updateTranscriptionText: (...args) => databaseRows.writes.push(["text", ...args]),
  updateTranscriptionStatus: (...args) => databaseRows.writes.push(["status", ...args]),
  updateTranscriptionAudio: (...args) => databaseRows.writes.push(["audio", ...args]),
};

const TINFOIL_CLIENT = require.resolve("../../src/helpers/tinfoilSecureClient");
// Calendar accounts and tokens a connected user would have (synthetic).
const FAR_FUTURE = Date.now() + 365 * 24 * 3600 * 1000;
Object.assign(databaseManager, {
  getGoogleAccounts: () => [{ google_email: "fixture@example.test" }],
  getGoogleTokens: () => googleTokens(),
  getGoogleTokensByEmail: () => googleTokens(),
  saveGoogleTokens() {},
  getSelectedCalendars: () => [{ id: "primary", account_email: "fixture@example.test" }],
  getCalendars: () => [{ id: "primary", account_email: "fixture@example.test", is_selected: 1 }],
  getMicrosoftAccounts: () => [{ microsoft_email: "fixture@example.test" }],
  getMicrosoftTokens: () => microsoftTokens(),
  getMicrosoftTokensByEmail: () => microsoftTokens(),
  saveMicrosoftTokens() {},
  getSelectedMicrosoftCalendars: () => [{ id: "cal-1", account_email: "fixture@example.test" }],
  updateCalendarSelection() {},
  updateMicrosoftCalendarSelection() {},
});
function googleTokens() {
  return {
    google_email: "fixture@example.test",
    access_token: "fixture-google-access",
    refresh_token: "fixture-google-refresh",
    expires_at: FAR_FUTURE,
  };
}
function microsoftTokens() {
  return {
    microsoft_email: "fixture@example.test",
    access_token: "fixture-ms-access",
    refresh_token: "fixture-ms-refresh",
    expires_at: FAR_FUTURE,
  };
}
const reminders = { scheduleNextMeeting() {}, reset() {} };
const ipc = loadIpcHandlers({
  electron: { ...electron, app: { isReady: () => true } },
  leaves: {
    "./tinfoilSecureClient": tinfoilSdk,
    [TINFOIL_CLIENT]: tinfoilSdk,
    ws: RoutedWebSocket,
  },
  // Real local-engine and calendar managers, constructed the way main.js does.
  managers: () => {
    const WhisperManager = require("../../src/helpers/whisper");
    const ParakeetManager = require("../../src/helpers/parakeet");
    const DiarizationManager = require("../../src/helpers/diarization");
    const WhisperCudaManager = require("../../src/helpers/whisperCudaManager");
    const WhisperVulkanManager = require("../../src/helpers/whisperVulkanManager");
    const GoogleCalendarManager = require("../../src/helpers/googleCalendarManager");
    const MicrosoftCalendarManager = require("../../src/helpers/microsoftCalendarManager");
    const AppleCalendarManager = require("../../src/helpers/appleCalendarManager");
    const whisperManager = new WhisperManager();
    const whisperCudaManager = new WhisperCudaManager();
    const whisperVulkanManager = new WhisperVulkanManager();
    whisperManager.setGpuBinaryManagers({ cuda: whisperCudaManager, vulkan: whisperVulkanManager });
    return {
      environmentManager: env,
      databaseManager,
      whisperManager,
      whisperCudaManager,
      whisperVulkanManager,
      parakeetManager: new ParakeetManager(),
      diarizationManager: new DiarizationManager(),
      googleCalendarManager: new GoogleCalendarManager(databaseManager, inertUi(), reminders),
      microsoftCalendarManager: new MicrosoftCalendarManager(databaseManager, reminders),
      appleCalendarManager: new AppleCalendarManager(databaseManager, reminders),
      isSealed: mainSealed,
      getTrayManager: () => null,
      getQdrantManager: () => null,
      getPersonalInference: () => inference,
      windowManager: inertUi(),
      clipboardManager: inertUi(),
      windowsKeyManager: inertUi(),
      linuxKeyManager: inertUi(),
      textEditMonitor: inertUi(),
      selectionManager: inertUi(),
      meetingDetectionEngine: inertUi(),
      audioTapManager: inertUi(),
      linuxPortalAudioManager: inertUi(),
      windowsLoopbackAudioManager: inertUi(),
      meetingAecManager: inertUi(),
    };
  },
});
ipc.instance.resolveVertexAuthSourceReady?.();

const { registerPersonalInferenceIPC, createCodexServer, gatedVerifyRelease } = (() => {
  return require("../../src/helpers/personalInference");
})();
const codexBinary = path.join(ipc.userData, "codex-bin", "codex");
fs.mkdirSync(path.dirname(codexBinary), { recursive: true });
fs.writeFileSync(codexBinary, "#!/bin/sh\n", { mode: 0o700 });
const credentials = ipc.instance.credentials;
{
  const list = credentials.list;
  credentials.list = (...args) => {
    presenceOnly++;
    try {
      return list(...args);
    } finally {
      presenceOnly--;
    }
  };
}
const { slotForCredentialRef } = require("../../src/helpers/credentialAuthority");
const codexServer = createCodexServer({
  userDataPath: ipc.userData,
  resolveExecutable: async () => codexBinary,
});
// A spy (not a fake): a Codex handler must refuse before Codex is asked at
// all, not merely before the later spawn guard (N18).
const codexAsked = [];
for (const method of [
  "start",
  "status",
  "login",
  "logout",
  "models",
  "modelCatalog",
  "rateLimits",
  "generate",
]) {
  const original = codexServer[method];
  if (typeof original !== "function") continue;
  codexServer[method] = function spiedCodexMethod(...args) {
    codexAsked.push(method);
    return original.apply(this, args);
  };
}
const inference = registerPersonalInferenceIPC({
  ipcMain: ipc.electron.ipcMain,
  userDataPath: ipc.userData,
  credentials,
  textOperationSnapshot: (request) =>
    require("../../src/helpers/textOperationCapture").textOperationSnapshot(env, request),
  authorizeTextOperation: () => true,
  waitForAdmission: () => ipc.instance.vertexAuthSourceReady,
  // main.js's credential and enterprise-config readers, verbatim in shape.
  getCredential: async (ref) => {
    const target = slotForCredentialRef(ref);
    const capture = target ? await credentials.captureCommitted(target.id) : null;
    if (target && !capture) throw new Error("Credential persistence is unavailable.");
    return capture?.values.key || "";
  },
  saveCredential: async () => {
    throw new Error("The matrix never saves credentials");
  },
  getEnterpriseConfig: async (provider) => {
    const bedrock = provider === "bedrock" ? await credentials.captureCommitted("bedrock") : null;
    return {
      bedrockRegion: env.getBedrockRegion(),
      bedrockProfile: env.getBedrockProfile(),
      bedrockAccessKeyId: bedrock ? bedrock.values.accessKeyId : env.getBedrockAccessKeyId(),
      bedrockSecretAccessKey: bedrock
        ? bedrock.values.secretAccessKey
        : env.getBedrockSecretAccessKey(),
      bedrockSessionToken: bedrock ? bedrock.values.sessionToken : env.getBedrockSessionToken(),
      azureEndpoint: env.getAzureEndpoint(),
      azureApiVersion: env.getAzureApiVersion(),
      vertexProject: env.getVertexProject(),
      vertexLocation: env.getVertexLocation(),
      vertexAuthSource: env.getVertexAuthSource(),
    };
  },
  openExternal: (url) => require("../../src/helpers/externalUrlOpener").openExternalUrl(url),
  // The production factory. Only executable discovery is a seam: it would
  // otherwise search this machine's PATH. The version probe and the
  // app-server spawn go through the real guarded child_process.
  codex: codexServer,
});

test.after(async () => {
  try {
    inference.dispose?.();
    ipc.instance?.keyring?.dispose?.();
    ipc.instance?.dictationStreamingOperations?.dispose?.();
    eraseIpc.instance?.keyring?.dispose?.();
  } finally {
    try {
      // Loaded second, so restored first: each restore puts back the module
      // loader it wrapped.
      eraseIpc.restore();
    } finally {
      ipc.restore();
      for (const fn of cleanups.splice(0)) fn();
      gate._resetForTests();
      registry._resetForTests();
    }
  }
});

// ---------------------------------------------------------------------------
// 6. Row helpers.

function sender(id = 7) {
  return Object.assign(new EventEmitter(), {
    id,
    sent: [],
    isDestroyed: () => false,
    send(channel, payload) {
      this.sent.push([channel, payload]);
    },
    getURL: () => "file:///loqui/index.html",
    mainFrame: { url: "file:///loqui/index.html" },
  });
}
const call = (channel, ...args) => ipc.invokeWith({ sender: sender() }, channel, ...args);
const pi = (name, ...args) => call(`personal-inference:${name}`, ...args);
const WAV = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.alloc(4),
  Buffer.from("WAVE"),
  Buffer.alloc(32),
]);
const arrayBuffer = (buffer) =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const chat = (overrides = {}) => ({
  provider: "groq",
  credentialRef: "groq",
  requestId: `m-${Math.random()}`,
  model: "llama-3.3-70b-versatile",
  inferenceScope: "chatIntelligence",
  messages: [{ role: "user", content: "the user's words" }],
  ...overrides,
});

async function outcomeOf(action) {
  try {
    return { value: await action() };
  } catch (thrown) {
    return { thrown };
  }
}
// The phase a sealed result states: `phase`, `details.phase`, or the marker in
// its message/error text ("[SEALED_MODE]" refused, "[SEALED_MODE:interrupted]"),
// searched down a bounded cause chain. This is sealedPhaseOf without its
// code-only fallback: a bare `code: "SEALED_MODE"` states no phase, and an
// explicit phase wins over a marker, so an interrupted result never reads as
// a refusal (review M6).
function statedPhaseOf(subject, depth = 0) {
  if (!subject || typeof subject !== "object" || depth > 3) return null;
  const explicit = subject.phase ?? subject.details?.phase;
  if (explicit != null) return explicit;
  for (const text of [subject.message, subject.error]) {
    if (typeof text !== "string") continue;
    if (text.includes("[SEALED_MODE:interrupted]")) return "interrupted";
    if (text.includes("[SEALED_MODE]")) return "refused";
  }
  return statedPhaseOf(subject.cause, depth + 1);
}
// A typed sealed refusal: a thrown SealedModeError, an envelope whose code is
// SEALED_MODE, or a streaming error event with that code, each of which must
// state the phase "refused" (sealedPhaseOf agrees for thrown errors).
function sealedRefusal(outcome) {
  if (outcome.thrown)
    return (
      isSealedModeError(outcome.thrown) &&
      sealedPhaseOf(outcome.thrown) === "refused" &&
      statedPhaseOf(outcome.thrown) === "refused"
    );
  return sealedEnvelope(outcome.value);
}
function sealedEnvelope(value) {
  if (!value || typeof value !== "object" || value.code !== "SEALED_MODE") return false;
  return statedPhaseOf(value) === "refused";
}

function snapshot() {
  return {
    transport: { ...transport },
    layerB,
    secretReads,
    rows: recorder.list().length,
  };
}
function resetCounters() {
  for (const key of Object.keys(transport)) transport[key] = 0;
  nativeLeafCalls.length = 0;
  layerB = 0;
  secretReads = 0;
  opened.length = 0;
  dialogs.length = 0;
  dialogAnswers = [];
  databaseRows.writes.length = 0;
  codexAsked.length = 0;
}
test.beforeEach(() => {
  flags.sealed = true;
  flags.layerAOff = false;
  resetGate();
  resetCounters();
  netFetchImpl = async () => {
    throw new Error("Electron net.fetch leaf reached");
  };
  nodeFetchImpl = async () => {
    throw new Error("Node fetch leaf reached");
  };
});

const ROWS = [];
// row: {
//   id: inventory row (N1..N26 or A23), family, label, channel (registered
//   channel it drives, or null for a production service with no channel),
//   task: expected ledger task, action: () => result,
//   accept?: (outcome) => boolean (a documented typed sealed shape),
//   check?: (outcome) => void (row-specific extra assertions),
//   secrets?: false when the row legitimately reads no credential either way,
//   drill?: "bypass" (default) | "unsealed" | (async () => void) custom,
//   reached?: () => boolean (custom "reached its egress point" predicate),
//   drillCheck?: () => void (row-specific assertions after the drill),
// }
const row = (spec) => ROWS.push(spec);

function blockedRows() {
  return recorder.list().filter((r) => r.outcome === "blocked");
}
// A refused program start is a nativeLaunch operation, never a request (I1).
const nativeLaunchRows = () => recorder.list().filter((r) => r.task === "nativeLaunch");
const nativeRefusals = () => nativeLaunchRows().length;
const touched = () => Object.values(transport).reduce((sum, value) => sum + value, 0);

// Synthetic user content and credentials files, under this run's own profile.
const uploadFile = path.join(ipc.userData, "user-upload.wav");
fs.writeFileSync(uploadFile, WAV);
// Google "authorized user" ADC: exchanging it is a token request, never a file read elsewhere.
const adcFile = path.join(ipc.userData, "adc.json");
fs.writeFileSync(
  adcFile,
  JSON.stringify({
    type: "authorized_user",
    client_id: "fixture.apps.googleusercontent.com",
    client_secret: "fixture-SECRET",
    refresh_token: "fixture-refresh",
  })
);
let retryAudio = null;
let storedAudioSeq = 4100;
function saveStoredAudio() {
  const id = ++storedAudioSeq;
  ipc.instance.audioStorageManager.saveAudio(id, WAV, Date.now());
  return id;
}

// A sender that owns describe/verify recipient tokens across two calls.
const owner = sender(11);
const as = (who, channel, ...args) => ipc.invokeWith({ sender: who }, channel, ...args);
// Describing a recipient (Plan 03) is preparation, not a send: it runs in the
// row's setup, and the row drives the Verify that uses its token.
const verifyRow = (identity, options = {}) => {
  let recipientToken;
  return {
    setup: async () => {
      ({ recipientToken } = await as(owner, "keyring-describe-verify", identity, options));
      assert.ok(recipientToken, `${identity} described`);
    },
    action: () => as(owner, "keyring-verify", identity, { ...options, recipientToken }),
  };
};
const connectRow = (provider, model, prepare) => {
  let recipientToken;
  return {
    setup: async () => {
      await prepare?.();
      ({ recipientToken } = await as(owner, "keyring-describe-verify", provider, { model }));
      assert.ok(recipientToken, `${provider} described`);
    },
    action: () => as(owner, "keyring-verify-connection", { provider, model, recipientToken }),
  };
};
// Plan 03 enterprise configuration, committed through the real environment.
async function enterprise(values) {
  const { current } = env.getEnterpriseRouteState();
  const result = await env.saveEnterpriseRoutePatch(values, { expected: current });
  assert.notEqual(result?.ok, false, "fixture enterprise config committed");
}
const keyringSealed = (o) => o.value?.outcome === "sealed" || o.value?.errorCode === "sealed";
const probeSealed = (o) => o.value?.ok === false && o.value?.code === "sealed";
const streamSealed = (who) => (o) =>
  sealedRefusal(o) || who.sent.some(([, p]) => p?.type === "error" && sealedEnvelope(p));

// ---------------------------------------------------------------------------
// 7. The blocked rows (inventory N1-N20), each through its real handler.

// N1: provider inference (cloud chat, vision, cleanup, streaming).
row({
  id: "N1",
  family: "inference",
  label: "text-generate (cloud chat)",
  channel: "personal-inference:text-generate",
  task: "chat",
  action: () => pi("text-generate", chat()),
});
row({
  id: "N1",
  family: "inference",
  label: "text-generate (vision, image payload)",
  channel: "personal-inference:text-generate",
  task: "chat",
  action: () =>
    pi(
      "text-generate",
      chat({
        provider: "openai",
        credentialRef: "openai",
        model: "gpt-4.1",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "what is this" },
              { type: "image", image: "data:image/png;base64,AAAA" },
            ],
          },
        ],
      })
    ),
});
{
  const who = sender(21);
  row({
    id: "N1",
    family: "inference",
    label: "text-stream (typed stream error)",
    channel: "personal-inference:text-stream",
    task: "chat",
    action: () => as(who, "personal-inference:text-stream", chat()),
    accept: streamSealed(who),
  });
}
// Captured text operations (Plan 02 cleanup): captured unsealed, run sealed.
{
  const who = sender(22);
  let token = null;
  const request = {
    messages: [{ role: "user", content: "the user's dictated words" }],
    wordCount: 4,
  };
  row({
    id: "N1",
    family: "inference",
    label: "text-operation-run (captured cleanup)",
    channel: "personal-inference:text-operation-run",
    task: "dictationCleanup",
    setup: async () => {
      flags.sealed = false;
      const capture = await as(who, "personal-inference:text-operation-capture", {
        provider: "groq",
        credentialRef: "groq",
        model: "llama-3.3-70b-versatile",
        inferenceScope: "dictationCleanup",
      });
      flags.sealed = true;
      assert.equal(capture.ok, true, JSON.stringify(capture));
      token = capture.value;
    },
    action: () => as(who, "personal-inference:text-operation-run", { token, request }),
    // The user's words stay with the renderer; the captured operation is
    // intact and still retirable while sealed.
    check: async () =>
      assert.equal((await as(who, "personal-inference:text-operation-retire", token)).ok, true),
  });
}

// N2: enterprise SDK inference and the legacy enterprise handlers.
row({
  id: "N2",
  family: "inference",
  label: "text-generate (Bedrock SDK)",
  channel: "personal-inference:text-generate",
  task: "noteFormatting",
  action: () =>
    pi(
      "text-generate",
      chat({
        provider: "bedrock",
        credentialRef: "bedrock",
        model: "anthropic.claude",
        inferenceScope: "noteFormatting",
      })
    ),
});
row({
  id: "N2",
  family: "inference",
  label: "text-generate (Azure SDK)",
  channel: "personal-inference:text-generate",
  task: "chat",
  setup: () => enterprise({ azureEndpoint: "https://fixture-azure.example/openai" }),
  action: () =>
    pi("text-generate", chat({ provider: "azure", credentialRef: "azure", model: "deployment" })),
});
row({
  id: "N2",
  family: "inference",
  label: "text-generate (Vertex SDK)",
  channel: "personal-inference:text-generate",
  task: "chat",
  action: () =>
    pi(
      "text-generate",
      chat({ provider: "vertex", credentialRef: "vertex", model: "gemini-2.5-flash" })
    ),
});
row({
  id: "N2",
  family: "inference",
  label: "process-enterprise-reasoning",
  channel: "process-enterprise-reasoning",
  task: "dictationCleanup",
  action: () =>
    call("process-enterprise-reasoning", "text", "model", "agent", {
      provider: "bedrock",
      bedrockRegion: "eu-west-1",
      bedrockAccessKeyId: "AKIAFIXTURE",
      bedrockSecretAccessKey: "fixture-SECRET",
      inferenceScope: "dictationCleanup",
    }),
});
{
  const who = sender(23);
  row({
    id: "N2",
    family: "inference",
    label: "enterprise-stream-start",
    channel: "enterprise-stream-start",
    task: "chat",
    action: () =>
      as(who, "enterprise-stream-start", {
        streamId: "s-1",
        provider: "vertex",
        modelId: "gemini-2.5-flash",
        config: {
          vertexLocation: "us-east1",
          vertexProject: "fixture-project",
          vertexAuthSource: "apiKey",
          apiKey: "fixture-SECRET",
        },
        options: {
          prompt: [{ role: "user", content: [{ type: "text", text: "the user's words" }] }],
        },
      }),
    accept: streamSealed(who),
  });
}
row({
  id: "N2",
  family: "checks",
  label: "test-enterprise-connection",
  channel: "test-enterprise-connection",
  task: "providerCheck",
  action: () =>
    call("test-enterprise-connection", "azure", {
      azureEndpoint: "https://legacy-azure.example",
      apiKey: "fixture-SECRET",
      model: "deployment",
    }),
});
row({
  id: "N3",
  family: "discovery",
  label: "bedrock-list-models",
  channel: "bedrock-list-models",
  task: "providerCheck",
  action: () =>
    call("bedrock-list-models", {
      bedrockRegion: "eu-west-1",
      bedrockAccessKeyId: "AKIAFIXTURE",
      bedrockSecretAccessKey: "fixture-SECRET",
    }),
});

// N3: explicit model discovery, after the recipient token is validated.
{
  const who = sender(24);
  row({
    id: "N3",
    family: "discovery",
    label: "personal-inference:models (recipient-bound)",
    channel: "personal-inference:models",
    task: "providerCheck",
    setup: async () => {
      const described = await as(who, "personal-inference:describe-models", {
        provider: "openrouter",
        credentialRef: "openrouter",
      });
      assert.ok(described?.recipientToken, JSON.stringify(described));
      who.recipientToken = described.recipientToken;
    },
    action: () =>
      as(who, "personal-inference:models", {
        provider: "openrouter",
        credentialRef: "openrouter",
        recipientToken: who.recipientToken,
      }),
  });
}

// N4: provider checks and Verify.
row({
  id: "N4",
  family: "checks",
  label: "test-provider-connection (ordinary)",
  channel: "test-provider-connection",
  task: "providerCheck",
  action: () => call("test-provider-connection", { provider: "groq" }),
});
row({
  id: "N4",
  family: "checks",
  label: "test-provider-connection (stored Corti)",
  channel: "test-provider-connection",
  task: "providerCheck",
  action: () =>
    call("test-provider-connection", {
      provider: "corti",
      scope: "transcription",
      environment: "eu",
      tenant: "fixture",
      clientId: "__stored__",
      clientSecret: "__stored__",
    }),
});
row({
  id: "N4",
  family: "checks",
  label: "keyring-verify (ordinary)",
  channel: "keyring-verify",
  task: "providerCheck",
  ...verifyRow("groq"),
  accept: keyringSealed,
});
row({
  id: "N4",
  family: "checks",
  label: "keyring-verify (Corti)",
  channel: "keyring-verify",
  task: "providerCheck",
  ...verifyRow("corti:speech", { cortiEnvironment: "eu", cortiTenant: "fixture" }),
  accept: keyringSealed,
});
row({
  id: "N4",
  family: "checks",
  label: "keyring-verify-connection (Azure SDK)",
  channel: "keyring-verify-connection",
  task: "providerCheck",
  ...connectRow("azure", "deployment", () =>
    enterprise({ azureEndpoint: "https://fixture-azure.example/openai" })
  ),
  accept: keyringSealed,
});
row({
  id: "N4",
  family: "checks",
  label: "keyring-verify-connection (Vertex ADC)",
  channel: "keyring-verify-connection",
  task: "providerCheck",
  ...connectRow("vertex", "gemini-2.5-flash", () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = adcFile;
    return enterprise({
      vertexAuthSource: "adc",
      vertexProject: "fixture-project",
      vertexLocation: "us-central1",
    });
  }),
  teardown: () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    return enterprise({ vertexAuthSource: "apiKey" });
  },
  accept: keyringSealed,
});
row({
  id: "N4",
  family: "checks",
  label: "keyring-verify-connection (Bedrock SDK)",
  channel: "keyring-verify-connection",
  task: "providerCheck",
  ...connectRow("bedrock", "anthropic.claude", () => enterprise({ bedrockRegion: "eu-west-1" })),
  accept: keyringSealed,
});
row({
  id: "N4",
  family: "checks",
  label: "probe-self-hosted (LAN server)",
  channel: "probe-self-hosted",
  task: "providerCheck",
  action: () => call("probe-self-hosted", "http://192.168.1.20:11434/v1"),
  accept: probeSealed,
});
row({
  id: "N4",
  family: "checks",
  label: "probe-self-hosted (public HTTPS server)",
  channel: "probe-self-hosted",
  task: "providerCheck",
  action: () => call("probe-self-hosted", "https://stt.example.net/v1"),
  accept: probeSealed,
});

// N5-N8: batch speech, retry, legacy proxies and the Anthropic proxy.
const audio = (overrides = {}) => ({
  audioBuffer: arrayBuffer(WAV),
  mimeType: "audio/wav",
  requestId: `r-${Math.random()}`,
  correlationId: "session-matrix",
  model: "whisper-1",
  provider: "openai",
  language: "en",
  ...overrides,
});
row({
  id: "N5",
  family: "batch-stt",
  label: "transcribe-audio-file-byok (captured audio)",
  channel: "transcribe-audio-file-byok",
  task: "dictationStt",
  action: () => call("transcribe-audio-file-byok", audio()),
});
row({
  id: "N5",
  family: "batch-stt",
  label: "transcribe-audio-file-byok (uploaded file)",
  channel: "transcribe-audio-file-byok",
  task: "uploadStt",
  action: () =>
    call("transcribe-audio-file-byok", {
      ...audio({ audioBuffer: undefined }),
      filePath: uploadFile,
    }),
  // The user's file is untouched.
  check: () => assert.deepEqual(fs.readFileSync(uploadFile), WAV),
});
row({
  id: "N5",
  family: "batch-stt",
  label: "transcribe-audio-file-byok (custom server)",
  channel: "transcribe-audio-file-byok",
  task: "dictationStt",
  action: () =>
    call(
      "transcribe-audio-file-byok",
      audio({ provider: "custom", baseUrl: "https://stt.example.net/v1" })
    ),
});
for (const provider of ["gemini", "corti", "tinfoil", "xai", "mistral"])
  row({
    id: ["gemini", "corti", "tinfoil"].includes(provider) ? "N6" : "N8",
    family: "batch-stt",
    label: `proxy-${provider}-transcription`,
    channel: `proxy-${provider}-transcription`,
    task: "dictationStt",
    action: () =>
      call(
        `proxy-${provider}-transcription`,
        audio({ provider, environment: "eu", tenant: "fixture" })
      ),
  });
row({
  id: "N7",
  family: "batch-stt",
  label: "retry-transcription",
  channel: "retry-transcription",
  task: "dictationStt",
  setup: () => {
    retryAudio = saveStoredAudio();
  },
  action: () =>
    call("retry-transcription", retryAudio, {
      cloudTranscriptionMode: "byok",
      transcriptionMode: "providers",
      cloudTranscriptionProvider: "openai",
      cloudTranscriptionModel: "whisper-1",
      preferredLanguage: "en",
    }),
  // History is not rewritten and the stored recording is kept.
  check: () => {
    assert.deepEqual(databaseRows.writes, []);
    assert.ok(ipc.instance.audioStorageManager.getAudioBuffer(retryAudio));
  },
});
row({
  id: "N8",
  family: "inference",
  label: "process-anthropic-reasoning",
  channel: "process-anthropic-reasoning",
  task: "dictationCleanup",
  action: () =>
    call("process-anthropic-reasoning", "the user's words", "claude-sonnet-4-5", "", {}),
});

// N9/N10: realtime warmup and start, discovered from the registered channels.
const REALTIME_OPTIONS = {
  "dictation-realtime": [{ provider: "openai-realtime" }, { provider: "tinfoil-realtime" }],
  "assemblyai-streaming": [{}],
  "deepgram-streaming": [{}],
  "gemini-streaming": [{}],
  "corti-streaming": [{ environment: "us", tenant: "fixture" }],
};
const REALTIME = ipc.channels().filter((c) => /-(streaming|realtime)-(warmup|start)$/.test(c));
for (const channel of REALTIME) {
  const prefix = channel.replace(/-(warmup|start)$/, "");
  const variants = REALTIME_OPTIONS[prefix];
  if (!variants) continue; // the ratchet below fails on an unknown realtime family
  for (const options of variants) {
    const label = `${channel}${options.provider ? ` (${options.provider})` : ""}`;
    const identity = {
      correlationId: `rt-${label}`,
      dictationSessionId: `rt-${label}`,
      operationId: `op-${label}`,
    };
    row({
      // Families that mint a token or credential before their socket (N10).
      id: /^(assemblyai|corti)-/.test(channel) ? "N10" : "N9",
      family: "realtime",
      label,
      channel,
      task: "dictationStt",
      action: () =>
        call(channel, channel.endsWith("-start") ? { ...options, ...identity } : { ...options }),
    });
  }
}
const { ALLOWED_MEETING_PROVIDERS } = require("../../src/helpers/meetingStreamingProviders");
for (const provider of [...ALLOWED_MEETING_PROVIDERS].filter((p) => p !== "local"))
  for (const channel of ["meeting-transcription-prepare", "meeting-transcription-start"])
    row({
      id: /^(assemblyai|corti)-/.test(provider) ? "N10" : "N9",
      family: "realtime",
      label: `${channel} (${provider})`,
      channel,
      task: "noteRecordingStt",
      action: () =>
        call(channel, {
          provider,
          mode: "byok",
          sessionId: `meeting-${provider}`,
          cortiEnvironment: "us",
          cortiTenant: "fixture",
        }),
    });

// N11: the Tinfoil catalog and its attestation.
row({
  id: "N11",
  family: "discovery",
  label: "get-tinfoil-chat-models",
  channel: "get-tinfoil-chat-models",
  task: "providerCheck",
  action: () => call("get-tinfoil-chat-models"),
});

// N12/N13: model, runtime and GPU downloads through the real managers.
row({
  id: "N12",
  family: "downloads",
  label: "model-download (local LLM)",
  channel: "model-download",
  task: "modelDownload",
  action: () => call("model-download", "qwen3.5-2b-q4_k_m"),
});
row({
  id: "N12",
  family: "downloads",
  label: "download-whisper-model",
  channel: "download-whisper-model",
  task: "modelDownload",
  action: () => call("download-whisper-model", "base"),
});
row({
  id: "N12",
  family: "downloads",
  label: "download-parakeet-model",
  channel: "download-parakeet-model",
  task: "modelDownload",
  action: () => call("download-parakeet-model", "parakeet-tdt-0.6b-v3"),
});
row({
  id: "N12",
  family: "downloads",
  label: "download-diarization-models",
  channel: "download-diarization-models",
  task: "modelDownload",
  action: () => call("download-diarization-models"),
});
row({
  id: "N13",
  family: "downloads",
  label: "download-cuda-whisper-binary",
  channel: "download-cuda-whisper-binary",
  task: "runtimeDownload",
  action: () => call("download-cuda-whisper-binary"),
});
row({
  id: "N13",
  family: "downloads",
  label: "download-vulkan-whisper-binary",
  channel: "download-vulkan-whisper-binary",
  task: "runtimeDownload",
  action: () => call("download-vulkan-whisper-binary"),
});
row({
  id: "N13",
  family: "downloads",
  label: "download-llama-vulkan-binary",
  channel: "download-llama-vulkan-binary",
  task: "runtimeDownload",
  action: () => call("download-llama-vulkan-binary"),
});
{
  const { downloadFile, fetchJson } = require("../../src/helpers/downloadUtils");
  row({
    id: "N12",
    family: "downloads",
    label: "downloadFile (shared by every manager)",
    channel: null,
    task: "modelDownload",
    action: () =>
      downloadFile("https://huggingface.co/fixture/model.bin", path.join(ipc.userData, "m.bin")),
  });
  row({
    id: "N13",
    family: "downloads",
    label: "fetchJson (runtime release lookup)",
    channel: null,
    task: "runtimeDownload",
    action: () =>
      fetchJson("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest", {
        egressTask: "runtimeDownload",
      }),
  });
}

// N16: the updater (check through the real IPC; restart and relaunch refused).
// Registered below with attachUpdateIPC; see section 8.

// N17/N18: Codex. Every handler is refused before Codex is asked, so before
// its version probe or spawn; the release lookup is metered and gated.
for (const name of [
  "codex-status",
  "codex-login",
  "codex-logout",
  "codex-models",
  "codex-model-catalog",
  "codex-rate-limits",
])
  row({
    id: "N18",
    family: "codex",
    label: `personal-inference:${name}`,
    channel: `personal-inference:${name}`,
    task: "codex",
    action: () => pi(name),
    check: () => {
      assert.deepEqual(nativeLeafCalls, [], "no version probe or app-server spawn");
      assert.deepEqual(codexAsked, [], "refused in the handler, before Codex was asked");
    },
    // The catalog read is passive (no process, file or request) even when
    // allowed: its drill asserts exactly that instead of an egress point.
    ...(name === "codex-model-catalog" ? { drill: "passive" } : {}),
  });
row({
  id: "N17",
  family: "codex",
  label: "Codex release verification (api.github.com)",
  channel: null,
  task: "codex",
  action: () =>
    gatedVerifyRelease()({
      executable: codexBinary,
      version: "0.154.0",
      verifiedReleases: new Map(),
      platform: "linux",
      timeoutMs: 1000,
    }),
});

// N19: calendar sign-in, sync and selection through the real handlers.
for (const [channel, args] of [
  ["gcal-start-oauth", []],
  ["mcal-start-oauth", []],
  ["gcal-sync-events", []],
  ["gcal-set-calendar-selection", ["primary", true]],
  ["gcal-set-primary-only", [false]],
  ["mcal-set-primary-only", [false]],
])
  row({
    id: "N19",
    family: "calendar",
    label: channel,
    channel,
    task: "calendar",
    // A connected account (synthetic tokens in the fake database), loaded the
    // way start/resumeAfterSeal load it.
    setup: () => {
      ipc.instance.googleCalendarManager._loadAccounts();
      ipc.instance.microsoftCalendarManager._loadAccounts();
    },
    action: () =>
      call(
        channel,
        ...(channel.endsWith("-set-primary-only")
          ? [
              !(
                channel.startsWith("g")
                  ? ipc.instance.googleCalendarManager
                  : ipc.instance.microsoftCalendarManager
              ).primaryOnly,
            ]
          : args)
      ),
    drillCleanup: () =>
      require("../../src/helpers/oauthLoopbackFlow").cancelAllOAuthFlows(new Error("matrix drill")),
  });

// N19 (review I1): "Erase all data" (cleanup-app) revokes the Google grant
// (googleCalendarManager.revokeAllTokens -> oauth2.googleapis.com/revoke) with
// no native launch. It runs on its own instance of the real handlers, because
// the erase is real: it resets the credential store (process.env and the
// environment module), closes and deletes the database, and removes audio,
// models, caches, the autostart entry and browser storage. Its managers are
// real and its own (calendar, local engines, credentials over a second real
// EnvironmentManager); Electron is the same counted stub. Task 11 decided the
// sealed outcome: the revoke is refused before any socket (one blocked
// calendar row, swallowed by revokeToken's best-effort catch) and the local
// erase still completes, local Google tokens included.
const eraseRun = {
  googleCleared: 0,
  dbClosed: 0,
  resets: 0,
  browser: { storage: 0, cache: 0 },
  tokens: [],
  savedEnv: null,
};
const eraseDb = {
  db: { close: () => eraseRun.dbClosed++ },
  getAllGoogleTokens: () => eraseRun.tokens.map((t) => ({ ...t })),
  getGoogleAccounts: () => (eraseRun.tokens.length ? [{ google_email: "erase@example.test" }] : []),
  getGoogleTokens: () => eraseRun.tokens[0] ?? null,
  getGoogleTokensByEmail: () => eraseRun.tokens[0] ?? null,
  getMicrosoftAccounts: () => [],
  clearGoogleCalendarData: () => {
    eraseRun.googleCleared++;
    eraseRun.tokens = [];
  },
  getKeyHealth: () => [],
  saveKeyHealth() {},
  deleteKeyHealth() {},
};
const eraseEnv = realCredentialEnv({ after: (fn) => cleanups.push(fn) });
// The in-memory secure-keys folder (the harness marks its migration there).
const eraseSecureKeys = path.dirname(
  [...eraseEnv.fs.files.keys()].find((file) => file.endsWith(".migrated"))
);
const eraseIpc = (() => {
  const liveSpeakerIdentifier = require("../../src/helpers/liveSpeakerIdentifier");
  const loaded = loadIpcHandlers({
    electron: { ...electron, app: { isReady: () => true } },
    leaves: {
      "./tinfoilSecureClient": tinfoilSdk,
      [TINFOIL_CLIENT]: tinfoilSdk,
      ws: RoutedWebSocket,
    },
    managers: () => {
      const GoogleCalendarManager = require("../../src/helpers/googleCalendarManager");
      const MicrosoftCalendarManager = require("../../src/helpers/microsoftCalendarManager");
      const AppleCalendarManager = require("../../src/helpers/appleCalendarManager");
      const WhisperManager = require("../../src/helpers/whisper");
      const ParakeetManager = require("../../src/helpers/parakeet");
      const DiarizationManager = require("../../src/helpers/diarization");
      return {
        environmentManager: eraseEnv.env,
        databaseManager: eraseDb,
        whisperManager: new WhisperManager(),
        parakeetManager: new ParakeetManager(),
        diarizationManager: new DiarizationManager(),
        googleCalendarManager: new GoogleCalendarManager(eraseDb, inertUi(), reminders),
        microsoftCalendarManager: new MicrosoftCalendarManager(eraseDb, reminders),
        appleCalendarManager: new AppleCalendarManager(eraseDb, reminders),
        isSealed: mainSealed,
        getTrayManager: () => null,
        windowManager: inertUi(),
        clipboardManager: inertUi(),
        windowsKeyManager: inertUi(),
        linuxKeyManager: inertUi(),
        textEditMonitor: inertUi(),
        selectionManager: inertUi(),
        meetingDetectionEngine: inertUi(),
        audioTapManager: inertUi(),
        linuxPortalAudioManager: inertUi(),
        windowsLoopbackAudioManager: inertUi(),
        meetingAecManager: inertUi(),
      };
    },
  });
  // The constructor points the process-wide live speaker identifier at its own
  // diarization manager; hand it back to the matrix's main instance.
  liveSpeakerIdentifier.setDiarizationManager(ipc.instance.diarizationManager);
  // AudioStorageManager reads userData through the Electron module it was
  // first loaded with (the main instance's): give this instance its own audio
  // folder, so the erase never deletes the matrix's stored recordings.
  const audio = loaded.instance.audioStorageManager;
  audio.audioDir = path.join(loaded.userData, "audio");
  audio.ensureAudioDir();
  const reset = loaded.instance.credentials.reset;
  loaded.instance.credentials.reset = function countedReset(...args) {
    eraseRun.resets++;
    return reset.apply(this, args);
  };
  return loaded;
})();
const eraser = Object.assign(sender(41), {
  session: {
    clearStorageData: async () => eraseRun.browser.storage++,
    clearCache: async () => eraseRun.browser.cache++,
  },
});
const eraseFiles = () => {
  const configHome = path.join(eraseIpc.userData, "xdg-config");
  const { getModelsDirForService } = require("../../src/helpers/modelDirUtils");
  const { getSupportCacheDir } = require("../../src/helpers/supportCacheDir");
  return {
    configHome,
    database: path.join(
      eraseIpc.userData,
      process.env.NODE_ENV === "development" ? "transcriptions-dev.db" : "transcriptions.db"
    ),
    autostart: path.join(
      configHome,
      "autostart",
      path.basename(require("../../src/helpers/linuxAutostart").getDesktopFilePath())
    ),
    whisperModel: path.join(getModelsDirForService("whisper"), "erase-fixture.bin"),
    ytDlpCache: path.join(getSupportCacheDir("yt-dlp"), "erase-fixture"),
  };
};
const storedAudio = () => {
  const { isStoredAudioFile } = require("../../src/helpers/storageOps");
  return fs.readdirSync(eraseIpc.instance.audioStorageManager.audioDir).filter(isStoredAudioFile);
};
function restoreEraseEnv() {
  const saved = eraseRun.savedEnv;
  if (!saved) return;
  for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
  Object.assign(process.env, saved);
  eraseRun.savedEnv = null;
}
const secureKeyFiles = () =>
  [...eraseEnv.fs.files.keys()].filter((f) => f.startsWith(eraseSecureKeys + path.sep));
row({
  id: "N19",
  family: "calendar",
  label: "cleanup-app (erase all data: Google token revoke)",
  channel: "cleanup-app",
  task: "calendar",
  setup: () => {
    // The erase must only ever touch this run's own temporary trees: the
    // runner's LOQUI_CACHE_ROOT/XDG_CACHE_HOME, and an XDG_CONFIG_HOME under
    // this instance's userData for the autostart entry (never HOME).
    eraseRun.savedEnv = { ...process.env };
    try {
      const tmp = require("node:os").tmpdir();
      const roots = [tmp, fs.realpathSync(tmp)];
      const within = (p) => roots.some((root) => path.resolve(p).startsWith(root + path.sep));
      process.env.XDG_CONFIG_HOME = eraseFiles().configHome;
      const files = eraseFiles();
      for (const [name, file] of Object.entries(files)) {
        // Checked before anything is created: a missing LOQUI_CACHE_ROOT would
        // otherwise point the model and cache erase at the real profile.
        assert.ok(within(file), `cleanup-app fixture ${name} is outside the temp dir: ${file}`);
        if (name === "configHome") continue;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "fixture");
      }
      eraseRun.tokens = [
        {
          google_email: "erase@example.test",
          access_token: "fixture-erase-access",
          refresh_token: "fixture-erase-refresh",
          expires_at: FAR_FUTURE,
        },
      ];
      eraseRun.googleCleared = 0;
      eraseRun.dbClosed = 0;
      eraseRun.resets = 0;
      eraseRun.browser = { storage: 0, cache: 0 };
      eraseEnv.fs.files.set(path.join(eraseSecureKeys, ".migrated"), Buffer.from(""));
      eraseEnv.fs.files.set(path.join(eraseSecureKeys, "ERASE_FIXTURE.enc"), Buffer.from("x"));
      eraseIpc.instance.audioStorageManager.saveAudio(++storedAudioSeq, WAV, Date.now());
      assert.equal(storedAudio().length, 1, "a stored recording to erase");
      eraseIpc.instance.googleCalendarManager._loadAccounts();
    } catch (error) {
      restoreEraseEnv();
      throw error;
    }
  },
  // The real environment reset deletes every persisted key from process.env,
  // which the matrix's main fixture shares: put it back exactly.
  teardown: () => restoreEraseEnv(),
  action: () => eraseIpc.invokeWith({ sender: eraser }, "cleanup-app"),
  // Task 11: the refusal is swallowed by the best-effort revoke, so the erase
  // reports an ordinary, error-free result; the typed refusal is the blocked
  // calendar row at the revoke endpoint (asserted with the rest below).
  accept: (o) => {
    eraseRun.lastValue = o.value;
    return (
      o.value?.success === true &&
      o.value.message === "Cleanup completed" &&
      Array.isArray(o.value.errors) &&
      o.value.errors.length === 0
    );
  },
  check: () => {
    // T11-M5 (Task 13): the erase says the grant stays valid at Google.
    assert.equal(eraseRun.lastValue?.googleGrantKept, true, "the refused revoke is surfaced");
    const [revoke] = recorder.list();
    assert.deepEqual(
      [revoke.task, revoke.host, revoke.outcome, revoke.errorClass, revoke.bytesOut],
      ["calendar", "oauth2.googleapis.com", "blocked", "SEALED_MODE", 0]
    );
    assert.equal(recorder.list().length, 1, "one refusal: the revoke");
    // The local erase completed, local Google tokens included.
    assert.equal(eraseRun.googleCleared, 1, "local Google calendar data cleared");
    assert.equal(eraseIpc.instance.googleCalendarManager.accounts.size, 0);
    assert.equal(eraseRun.dbClosed, 1, "database closed");
    assert.equal(eraseRun.resets, 1, "credential store reset");
    assert.deepEqual(secureKeyFiles(), [], "stored credentials erased");
    assert.deepEqual(eraseRun.browser, { storage: 1, cache: 1 }, "browser storage cleared");
    assert.deepEqual(storedAudio(), [], "stored recordings erased");
    for (const [name, file] of Object.entries(eraseFiles())) {
      if (name === "configHome") continue;
      assert.equal(fs.existsSync(file), false, `${name} erased`);
    }
  },
  // Layer A off: the same revoke reaches Electron's net.fetch leaf (and the
  // erase still completes).
  drillCheck: () => {
    assert.equal(transport.netFetch, 1, "the revoke reached net.fetch");
    assert.equal(eraseRun.googleCleared, 1);
  },
});

// N16: the updater through the real attachUpdateIPC and UpdateManager. Only
// electron-updater itself is a terminal leaf (its feed request and download).
const updater = Object.assign(new EventEmitter(), {
  checks: 0,
  downloads: 0,
  installs: 0,
  setFeedURL() {},
  checkForUpdates: async () => {
    updater.checks++;
    transport.netRequest++;
    throw new Error("electron-updater leaf reached");
  },
  downloadUpdate: async () => {
    updater.downloads++;
    transport.netRequest++;
  },
  quitAndInstall: () => {
    updater.installs++;
    transport.relaunch++;
  },
});
const updateWindow = { webContents: null, isDestroyed: () => false };
const updateOwner = sender(31);
// The renderer answers the restart preparation (pending edits saved).
updateOwner.send = function (channel, payload) {
  this.sent.push([channel, payload]);
  if (channel === "loqui-update:prepare")
    setImmediate(() =>
      ipc.listeners.get("loqui-update:prepared")?.({ sender: updateOwner }, payload)
    );
};
updateWindow.webContents = updateOwner;
let updateManager;
{
  const savedAppImage = process.env.APPIMAGE;
  process.env.APPIMAGE = path.join(ipc.userData, "Loqui.AppImage");
  try {
    updateManager = require("../../src/helpers/updateIPC").attachUpdateIPC({
      app: { ...ipc.electron.app, isPackaged: true, getVersion: () => "1.0.0" },
      ipcMain: ipc.electron.ipcMain,
      BrowserWindow: { getAllWindows: () => [updateWindow] },
      updater,
      sealed: mainSealed,
      // main.js's own restart closure, captured from the VM run in section 15
      // (T12-M2), never a test copy of it.
      assertRestartAllowed: () => mainRestartAllowed(),
      activity: { lock() {}, busy: () => false },
      busy: () => false,
      teardown: async () => {},
    });
  } finally {
    if (savedAppImage === undefined) delete process.env.APPIMAGE;
    else process.env.APPIMAGE = savedAppImage;
  }
}
const updateCall = (name) => ipc.invokeWith({ sender: updateOwner }, `loqui-update:${name}`);
row({
  id: "N16",
  family: "updates",
  label: "loqui-update:check (manual)",
  channel: "loqui-update:check",
  task: "appUpdate",
  // An onboarded user with automatic updates (the real setup-complete IPC).
  setup: () => Promise.resolve(updateCall("setup-complete")),
  action: () => updateCall("check"),
  check: () =>
    assert.deepEqual([updater.checks, updater.downloads], [0, 0], "no feed request or download"),
});
// Restart/install and relaunch are native launches: refused before teardown,
// quitAndInstall or app.relaunch. They record no request (nothing was asked of
// the network), so their ledger task is null and the refusal is the typed
// NATIVE_BOUNDARY_UNAVAILABLE.
const nativeUnavailable = (o) =>
  /NATIVE_BOUNDARY_UNAVAILABLE/.test(o.thrown?.message ?? o.value?.error ?? "");
row({
  id: "N16",
  family: "updates",
  label: "loqui-update:restart (install)",
  channel: "loqui-update:restart",
  task: null,
  action: () => updateCall("restart"),
  setup: () => runMainToUpdateIpc(),
  accept: nativeUnavailable,
  check: () => {
    assert.equal(updater.installs, 0);
    assert.ok(mainRun.restartChecks > 0, "main.js's own restart closure refused it");
  },
  // Unsealed, with a verified update ready (synthetic state), the same IPC
  // reaches electron-updater's quitAndInstall leaf.
  drill: async () => {
    updateManager.prefs.enabled = true;
    updateManager.state = { ...updateManager.state, phase: "ready", availableVersion: "1.0.1" };
    try {
      await updateCall("restart");
    } finally {
      updateManager.restarting = false;
      updateManager.state = { ...updateManager.state, phase: "idle", availableVersion: undefined };
    }
  },
});
row({
  id: "N16",
  family: "updates",
  label: "relaunch-app",
  channel: "relaunch-app",
  task: null,
  action: () => call("relaunch-app"),
  accept: nativeUnavailable,
  drill: "unsealed",
});

// N14/N15: URL import and yt-dlp (including its self-update) are driven by the
// same matrix runner in test/helpers/urlAudioDownloader.test.js: the safety
// chain lets only that exact file load the real downloader.
const CROSS_FILE_ROWS = {
  "download-url-audio": "test/helpers/urlAudioDownloader.test.js",
};

// ---------------------------------------------------------------------------
// 9. Native launches (N24/N26 and the local engines): a cold start while
// sealed is refused by the real spawn guard before the native leaf, with a
// blocked native-* ledger row; unsealed, the same IPC reaches the leaf.

const NATIVE = [];
const nativeRow = (spec) => NATIVE.push(spec);
const segment = () => ({ buffer: arrayBuffer(WAV), mimeType: "audio/wav" });
nativeRow({
  id: "N24",
  label: "merge-audio-segments (FFmpeg)",
  channel: "merge-audio-segments",
  action: () => call("merge-audio-segments", [segment(), segment()], {}),
});
nativeRow({
  id: "N26",
  label: "get-system-default-microphone (refresh)",
  channel: "get-system-default-microphone",
  action: () => call("get-system-default-microphone", { refresh: true }),
});
nativeRow({
  id: "N26",
  label: "toggle-media-playback",
  channel: "toggle-media-playback",
  action: () => call("toggle-media-playback"),
});
// Pause and resume use the same media helper as the toggle (playerctl and
// dbus-send by PATH name on Linux). Resume only acts on media the app paused
// itself, so its setup leaves the state a pause before the seal would leave.
const mediaPlayer = require("../../src/helpers/mediaPlayer");
nativeRow({
  id: "N26",
  label: "pause-media-playback",
  channel: "pause-media-playback",
  action: () => call("pause-media-playback"),
});
nativeRow({
  id: "N26",
  label: "resume-media-playback (media paused before the seal)",
  channel: "resume-media-playback",
  setup: () => {
    mediaPlayer._pausedPlayers = ["playerctl"];
  },
  action: () => call("resume-media-playback"),
});
nativeRow({
  id: "N26",
  label: "get-ydotool-status",
  channel: "get-ydotool-status",
  action: () => call("get-ydotool-status"),
});
nativeRow({
  id: "N26",
  label: "detect-gpu",
  channel: "detect-gpu",
  action: () => call("detect-gpu"),
});
// The GPU picker runs nvidia-smi by PATH name, like detect-gpu. Its answer is
// cached per process, so each run starts from an empty cache.
nativeRow({
  id: "N26",
  label: "list-gpus",
  channel: "list-gpus",
  setup: () => require("../../src/utils/gpuDetection").clearCache(),
  action: () => call("list-gpus"),
});
// The llama.cpp check looks the binary up with `which`/`where` first.
nativeRow({
  id: "N26",
  label: "llama-cpp-check",
  channel: "llama-cpp-check",
  action: () => call("llama-cpp-check"),
});

for (const r of NATIVE) {
  const name = `${r.id} native: ${r.label}`;
  test(
    `${name} — sealed: refused by the spawn guard before the native leaf`,
    { timeout: 20000 },
    async (t) => {
      await r.setup?.();
      resetCounters();
      recorder.clear();
      const outcome = await outcomeOf(r.action);
      t.diagnostic(`result: ${describeOutcome(outcome).slice(0, 200)}`);
      assert.deepEqual(nativeLeafCalls, [], `${name} reached a native leaf`);
      assert.equal(transport.utilityLeaf, 0);
      assert.deepEqual(transport, zeroTransport(), `${name} touched a transport`);
      const rows = recorder.list();
      const native = rows.filter((x) => x.task === "nativeLaunch");
      assert.ok(native.length > 0, `${name} never attempted its launch: ${JSON.stringify(rows)}`);
      for (const x of native)
        assert.deepEqual(
          [x.kind, x.attributed, x.outcome, x.bytesOut, /^native-[a-z0-9-]+$/.test(x.host)],
          ["operation", true, "blocked", 0, true],
          `${name}: a refused program start is an attributed operation, not a request`
        );
      assert.deepEqual(
        rows.filter((x) => x.outcome !== "blocked"),
        []
      );
    }
  );
  test(`${name} — unsealed: the same IPC reaches its native leaf`, { timeout: 20000 }, async () => {
    await r.setup?.();
    resetCounters();
    flags.sealed = false;
    try {
      await outcomeOf(r.action);
    } finally {
      flags.sealed = true;
    }
    assert.ok(
      transport.nativeLeaf + transport.utilityLeaf > 0,
      `${name} never reached a native leaf unsealed`
    );
  });
}

test("N20 acal-connect: the EventKit helper is refused before launch while sealed", async () => {
  resetCounters();
  recorder.clear();
  assert.deepEqual(await call("acal-connect"), {
    success: false,
    reason: "sealed",
    error: "NATIVE_BOUNDARY_UNAVAILABLE",
  });
  assert.deepEqual(transport, zeroTransport());
});

// ---------------------------------------------------------------------------
// 10. OS handoffs (N21): allowed only after main's own dialog says yes.
// main.js installs exactly this guard and these confirmations (Task 11).

const externalUrlOpener = require("../../src/helpers/externalUrlOpener");
const privacyBoot = require("../../src/helpers/privacy/privacyBoot");
const confirmations = privacyBoot.createConfirmations({
  dialog: electron.dialog,
  BrowserWindow: { fromWebContents: () => undefined },
  t: (key) => key,
});
externalUrlOpener.setExternalOpenGuard(
  privacyBoot.createExternalOpenGuard({ isSealed: mainSealed, confirm: confirmations })
);
test.after(() => externalUrlOpener.setExternalOpenGuard(null));

test("N21 open-external: sealed, the browser opens only after the main-owned dialog says yes; declining is silent", async () => {
  dialogAnswers = [0]; // "Don't open" (the default and cancel button)
  assert.deepEqual(await call("open-external", "https://example.com/help?q=private"), {
    success: false,
    declined: true,
  });
  assert.equal(transport.shellOpen, 0, "nothing reached the OS");
  assert.equal(dialogs.length, 1);
  assert.equal(dialogs[0].defaultId, 0);
  assert.equal(dialogs[0].cancelId, 0);
  assert.doesNotMatch(
    JSON.stringify(dialogs[0]),
    /private|\/help/,
    "the dialog names the host only"
  );
  assert.equal(recorder.list().length, 0, "a declined handoff is not an error and not a request");
  dialogAnswers = [1]; // "Open link"
  assert.deepEqual(await call("open-external", "https://example.com/help"), { success: true });
  assert.deepEqual(opened, ["https://example.com/help"]);
  // Unsealed: no dialog.
  flags.sealed = false;
  dialogs.length = 0;
  assert.deepEqual(await call("open-external", "https://example.com/"), { success: true });
  assert.equal(dialogs.length, 0);
});

test("N21 mailto and the Codex sign-in page go through the same confirmation", async () => {
  dialogAnswers = [0, 0];
  assert.deepEqual(await call("open-external", "mailto:someone@example.com"), {
    success: false,
    declined: true,
  });
  assert.doesNotMatch(JSON.stringify(dialogs[0]), /someone@example\.com/, "never the address");
  assert.equal(await externalUrlOpener.openExternalUrl("https://auth.openai.com/oauth"), false);
  assert.equal(transport.shellOpen, 0);
  assert.equal(dialogs.length, 2);
});

const SETTINGS_CHANNELS = [
  "open-microphone-settings",
  "open-sound-input-settings",
  "open-accessibility-settings",
  "open-system-audio-settings",
  "open-screen-recording-settings",
  "open-login-items-settings",
  "open-calendar-privacy-settings",
];
for (const channel of SETTINGS_CHANNELS)
  test(`N21 ${channel}: sealed, the OS settings app opens only after the dialog says yes (macOS table)`, async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "darwin" });
    try {
      dialogAnswers = [0];
      assert.deepEqual(await call(channel), { success: false, declined: true });
      assert.equal(transport.shellOpen, 0);
      assert.equal(dialogs.length, 1);
      dialogAnswers = [1];
      assert.deepEqual(await call(channel), { success: true });
      assert.equal(opened.length, 1);
      assert.match(opened[0], /^x-apple\.systempreferences:/);
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

// ---------------------------------------------------------------------------
// 11. Prevented rows: background work that is simply not started.

test("N18 prevented: the production Codex server refuses before resolving, probing or spawning", async () => {
  let resolved = 0;
  const server = createCodexServer({
    userDataPath: ipc.userData,
    resolveExecutable: async () => {
      resolved++;
      return codexBinary;
    },
    // Ignored by the production factory: the shipped guard stays in place.
    beforeSpawn: () => {},
  });
  await assert.rejects(
    server.start(),
    // The phase is stated by the error itself, never read from a bare code (N18, M6).
    (e) => isSealedModeError(e) && statedPhaseOf(e) === "refused"
  );
  assert.equal(resolved, 0);
  assert.deepEqual(nativeLeafCalls, []);
  assert.deepEqual(
    blockedRows().map((x) => [x.task, x.bytesOut]),
    [["codex", 0]]
  );
  // Layer A off: the version probe is the next native step, refused by the spawn guard.
  flags.layerAOff = true;
  gate._setBypassForTests(true);
  try {
    await assert.rejects(server.start());
  } finally {
    gate._setBypassForTests(false);
    flags.layerAOff = false;
  }
  assert.equal(resolved, 1);
  assert.ok(nativeRefusals() > 0, "the probe reached the spawn guard");
  assert.deepEqual(nativeLeafCalls, []);
});

test("N18 codex-cancel-login stays usable while sealed: no probe, spawn or row", async () => {
  assert.deepEqual(await pi("codex-cancel-login", "login-1"), { appServerStopped: true });
  assert.deepEqual(transport, zeroTransport());
  assert.equal(recorder.list().length, 0);
});

test("N20 prevented: main's calendar guard starts, focus-syncs and wake-syncs nothing while sealed", async () => {
  const { createCalendarGuard } = require("../../src/helpers/privacy/calendarGuard");
  const guard = createCalendarGuard({ isSealed: mainSealed });
  const managers = [
    ipc.instance.googleCalendarManager,
    ipc.instance.microsoftCalendarManager,
    ipc.instance.appleCalendarManager,
  ];
  try {
    guard.start(managers);
    guard.onFocus(managers);
    guard.onWake(managers);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(transport, zeroTransport());
    assert.equal(recorder.list().length, 0, "nothing was attempted, so nothing was refused");
    // Sensitivity: unsealed, the same guard and managers do reach the network.
    flags.sealed = false;
    netFetchImpl = async () => new Response("{}", { status: 200 });
    guard.start(managers);
    for (let i = 0; i < 100 && transport.netFetch === 0; i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.ok(transport.netFetch > 0, "an unsealed start reaches Electron net");
  } finally {
    flags.sealed = true;
    for (const manager of managers) manager.stop?.();
  }
});

// N16 (re-audit for review I1): two update channels that were declared local
// can start a request with no native launch. Finishing setup starts the
// automatic checks (the first runs at once), and turning automatic updates on
// fetches an update a manual check already found. While sealed both are
// skipped without a record (D13: a scheduled check is not a refusal and does
// not advance lastCheck); with Layer A off the same IPC reaches
// electron-updater's feed request.
test("N16 prevented: setup-complete and enabling automatic updates start no check or fetch while sealed", async () => {
  const saved = { prefs: { ...updateManager.prefs }, state: { ...updateManager.state } };
  const stopTimer = () => {
    clearInterval(updateManager.timer);
    updateManager.timer = null;
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  const drive = {
    "setup-complete": async () => {
      stopTimer();
      Object.assign(updateManager.prefs, { onboarded: false, enabled: true, lastCheck: 0 });
      updateManager.failures = 0;
      await updateCall("setup-complete");
    },
    preferences: async () => {
      stopTimer();
      Object.assign(updateManager.prefs, { onboarded: true, enabled: false, lastCheck: 0 });
      updateManager.state = {
        ...updateManager.state,
        phase: "available",
        availableVersion: "1.0.1",
      };
      await ipc.invokeWith({ sender: updateOwner }, "loqui-update:preferences", { enabled: true });
    },
  };
  try {
    for (const [channel, run] of Object.entries(drive)) {
      resetCounters();
      updater.checks = 0;
      recorder.clear();
      await run();
      await settle();
      assert.equal(updater.checks, 0, `${channel}: no feed request while sealed`);
      assert.deepEqual(transport, zeroTransport(), `${channel} touched a transport`);
      assert.equal(recorder.list().length, 0, `${channel}: nothing attempted, nothing recorded`);
      // Layer A disabled: the same IPC reaches electron-updater.
      flags.layerAOff = true;
      gate._setBypassForTests(true);
      try {
        await run();
        await waitFor(() => updater.checks > 0 && !updateManager.running, `${channel} check`);
      } finally {
        gate._setBypassForTests(false);
        flags.layerAOff = false;
      }
      assert.equal(transport.netRequest, 1, `${channel} reached electron-updater's feed request`);
    }
  } finally {
    stopTimer();
    updateManager.failures = 0;
    Object.assign(updateManager.prefs, saved.prefs);
    updateManager.state = saved.state;
    updater.checks = 0;
  }
});

// ---------------------------------------------------------------------------
// 12. Interruption rows: sealing mid-flight reports "interrupted", never
// "nothing was sent", and leaves a cancelled (not blocked) row.

const hangUntilAborted = (_url, init) =>
  new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
async function waitFor(predicate, label) {
  for (let i = 0; i < 400; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`${label} not reached`);
}
function seal() {
  // The transition's synchronous step (privacyBoot.createSealTransition).
  flags.sealed = true;
  gate.abortAllRemote();
  backstop.severAll();
}
const interrupted = (o) => {
  const error = o.thrown ?? (o.value?.error ? { message: o.value.error } : null);
  return (o.value?.phase ?? sealedPhaseOf(error)) === "interrupted";
};
const NOTHING_SENT = /nothing was sent/i;

test("interrupted: a captured-audio upload sealed mid-flight", async () => {
  flags.sealed = false;
  netFetchImpl = hangUntilAborted;
  const pending = outcomeOf(() => call("transcribe-audio-file-byok", audio()));
  await waitFor(() => transport.netFetch > 0, "upload dispatched");
  seal();
  const outcome = await pending;
  assert.ok(interrupted(outcome), describeOutcome(outcome));
  assert.equal(outcome.value?.code, "SEALED_MODE");
  assert.doesNotMatch(JSON.stringify(outcome.value), NOTHING_SENT);
  const [row] = recorder.list();
  assert.deepEqual(
    [row.task, row.outcome, row.errorClass],
    ["dictationStt", "cancelled", "SEALED_MODE"]
  );
});

test("interrupted: a cloud inference request sealed mid-flight", async () => {
  flags.sealed = false;
  nodeFetchImpl = hangUntilAborted;
  const pending = outcomeOf(() => pi("text-generate", chat()));
  await waitFor(() => transport.nodeFetch > 0, "inference dispatched");
  seal();
  const outcome = await pending;
  assert.ok(interrupted(outcome), describeOutcome(outcome));
  assert.doesNotMatch(String(outcome.thrown?.message), NOTHING_SENT);
  assert.ok(recorder.list().some((x) => x.task === "chat" && x.outcome === "cancelled"));
});

test("interrupted (T11a-M3): the self-hosted probe sealed during its body is 'sealed', never a model count", async () => {
  flags.sealed = false;
  let release;
  nodeFetchImpl = async (_url, init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":[{"id":"a"},'));
          release = () => controller.error(init.signal.reason);
          init.signal.addEventListener("abort", () => release(), { once: true });
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  const pending = call("probe-self-hosted", "http://192.168.1.20:11434/v1");
  await waitFor(() => release, "probe headers received");
  seal();
  assert.deepEqual(await pending, { ok: false, code: "sealed" });
  const [row] = recorder.list();
  assert.deepEqual(
    [row.task, row.host, row.outcome, row.errorClass],
    ["providerCheck", "192.168.1.20", "cancelled", "SEALED_MODE"]
  );
});

test("interrupted: a Verify sealed mid-flight is 'sealed' and writes no credential verdict", async () => {
  const { recipientToken } = await as(owner, "keyring-describe-verify", "groq", {});
  flags.sealed = false;
  nodeFetchImpl = hangUntilAborted;
  const before = databaseRows.health.get("groq");
  const pending = as(owner, "keyring-verify", "groq", { recipientToken });
  await waitFor(() => transport.nodeFetch > 0, "verify dispatched");
  seal();
  assert.equal((await pending).outcome, "sealed");
  assert.deepEqual(databaseRows.health.get("groq"), before, "no health verdict");
});

test("interrupted: a pending calendar sign-in is cancelled at the seal, its listener closed", async () => {
  const { activeOAuthFlowCount } = require("../../src/helpers/oauthLoopbackFlow");
  const { createCalendarGuard } = require("../../src/helpers/privacy/calendarGuard");
  flags.sealed = false;
  const pending = call("gcal-start-oauth");
  await waitFor(() => transport.shellOpen > 0, "consent page handed to the browser");
  assert.equal(activeOAuthFlowCount(), 1);
  seal();
  createCalendarGuard({ isSealed: mainSealed }).cancelPending(); // the transition's cancelPending hook
  const result = await pending;
  assert.deepEqual(
    [result.success, result.code, result.phase],
    [false, "SEALED_MODE", "interrupted"]
  );
  assert.equal(activeOAuthFlowCount(), 0);
  assert.equal(transport.netFetch, 0, "no token exchange");
});

// ---------------------------------------------------------------------------
// 13. Loopback rows: local work keeps working, including through a seal.

test("loopback: a local self-hosted probe in flight survives sealing; a remote one beside it is interrupted", async (t) => {
  flags.sealed = false;
  let respond;
  const server = http.createServer((_req, res) => {
    respond = () => res.end(JSON.stringify({ data: [{ id: "local" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  netFetchImpl = hangUntilAborted;
  const local = call("probe-self-hosted", `http://127.0.0.1:${server.address().port}/v1`);
  const remote = outcomeOf(() => call("transcribe-audio-file-byok", audio()));
  await waitFor(() => respond && transport.netFetch > 0, "both in flight");
  seal();
  respond();
  assert.deepEqual(await local, { ok: true, count: 1 });
  assert.ok(interrupted(await remote));
  assert.ok(
    recorder.list().every((x) => !isLoopbackHost(x.host)),
    "loopback is never recorded"
  );
});

test("loopback: sealed, a local inference server is still reached through the real model factory", async (t) => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    res.statusCode = 500;
    res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const localOutcome = await outcomeOf(() =>
    pi(
      "text-generate",
      chat({
        provider: "local",
        credentialRef: undefined,
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        inferenceScope: "dictationCleanup",
      })
    )
  );
  assert.ok(
    seen.length > 0,
    `the local request reached the owned loopback server: ${describeOutcome(localOutcome)}`
  );
  assert.equal(layerB, 0);
  assert.equal(recorder.list().length, 0, "loopback is never recorded");
});

// ---------------------------------------------------------------------------
// 14. Layer B: a request site nobody gated is still refused at the socket.

test("Layer B: an un-gated Node request is refused before its socket and recorded unattributed", async () => {
  const https = require("node:https");
  const error = await new Promise((resolve) => {
    const request = https.request("https://new-feature.example/upload", { method: "POST" });
    request.once("error", resolve);
    request.end("the user's content");
  });
  assert.ok(isSealedModeError(error));
  assert.equal(layerB, 1);
  assert.equal(transport.socket, 0);
  const [row] = recorder.list();
  assert.deepEqual([row.outcome, row.attributed, row.bytesOut], ["blocked", false, 0]);
  // And global fetch, and DNS.
  await assert.rejects(fetch("https://new-feature.example/"), isSealedModeError);
  await assert.rejects(
    require("node:dns").promises.lookup("new-feature.example"),
    isSealedModeError
  );
  assert.equal(transport.nodeFetch, 0);
});

// ---------------------------------------------------------------------------
// 15. main.js itself (A23 and its own handlers). The real main.js runs in a VM
// against the real privacy boot, child registry, sidecar reaper and PID files;
// every manager main constructs is an inert stand-in, and the run stops at
// attachUpdateIPC (whose real wiring is driven above).

const ROOT = path.join(__dirname, "../..");
const mainChannels = new Map();
const mainListeners = new Map();
function soft() {
  return new Proxy(function () {}, {
    get: (_target, key) =>
      key === "then"
        ? undefined
        : key === Symbol.iterator
          ? function* () {}
          : key === Symbol.toPrimitive
            ? () => ""
            : soft(),
    apply: () => soft(),
    construct: () => soft(),
  });
}
let mainRun = null;
async function runMainToUpdateIpc() {
  if (mainRun) return mainRun;
  const profile = path.join(ipc.userData, "main-profile");
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, "privacy.json"), '{"sealed":true}');
  // A live saved sidecar record (this test's own pid, so liveness is real and
  // nothing else can be signalled) and the PID file directory main reads.
  const pidDir = path.join(ipc.userData, "sidecar-pids");
  fs.mkdirSync(pidDir, { recursive: true });
  fs.writeFileSync(path.join(pidDir, "whisper.pid"), String(process.pid));
  const signals = [];
  const realKill = process.kill;
  process.kill = (pid, signal) => {
    if (signal !== 0 && signal !== undefined) {
      signals.push([pid, signal]);
      throw new Error("the matrix forbids signalling any process");
    }
    return realKill.call(process, pid, 0);
  };
  const marker = new Error("STOP_AT_UPDATE_IPC");
  const observed = { managerConstructed: false, atFirstManager: null };
  let selected;
  const app = new Proxy(
    Object.assign(new EventEmitter(), {
      isPackaged: false,
      getPath: (name) => (name === "userData" ? selected : profile),
      setName() {},
      setPath: (_name, value) => {
        selected = value;
      },
      requestSingleInstanceLock: () => false,
      whenReady: () => new Promise(() => {}),
      exit() {},
      commandLine: { appendSwitch() {} },
    }),
    { get: (target, key) => (key in target ? target[key] : soft()) }
  );
  const ipcMain = new Proxy(
    {
      handle: (channel, fn) => mainChannels.set(channel, fn),
      on: (channel, fn) => mainListeners.set(channel, fn),
    },
    { get: (target, key) => (key in target ? target[key] : soft()) }
  );
  // Only this startup's evidence: earlier unsealed drills left their own
  // (deliberately unresolved) registry entries.
  registry._resetForTests();
  const nativeBefore = transport.nativeLeaf;
  const context = {
    __dirname: ROOT,
    setTimeout,
    clearTimeout,
    setInterval: () => soft(),
    clearInterval() {},
    process: {
      env: { NODE_ENV: "development", LOQUI_PROFILE_DIR: profile },
      platform: process.platform,
      argv: ["electron", "."],
      execPath: "/electron",
      on() {},
    },
    require: (name) => {
      if (name === "electron") return { app, ipcMain };
      if (name === "path") return path;
      if (name === "dotenv") return { config() {} };
      if (name === "tls") return { getCACertificates: () => [] };
      if (name === "node:fs/promises") return {};
      if (name === "./src/config/product.json") return require("../../src/config/product.json");
      if (name === "./src/helpers/xwayland") return { shouldForceXWayland: () => false };
      if (name === "./src/helpers/settingsProfile")
        return { hasExistingSettingsProfile: async () => false };
      // Real: the privacy boot, the registry, the reaper and its PID files.
      if (name === "./src/helpers/privacy/privacyBoot") return privacyBoot;
      if (name === "./src/helpers/privacy/childRegistry") return registry;
      if (name === "./src/helpers/privacy/egressPolicy")
        return require("../../src/helpers/privacy/egressPolicy");
      if (name === "./src/helpers/sidecarReaper") return require("../../src/helpers/sidecarReaper");
      if (name === "./src/helpers/localEmbeddings")
        return require("../../src/helpers/localEmbeddings");
      if (name === "./src/helpers/environment")
        return class {
          constructor() {
            if (observed.managerConstructed) return soft();
            observed.managerConstructed = true;
            observed.atFirstManager = {
              inspections: transport.nativeLeaf - nativeBefore,
              unresolved: registry
                .diagnostics()
                .unresolved.map((e) => [e.kind, e.pid, e.reason, e.rootExited]),
              records: fs.readdirSync(pidDir, { recursive: true }).map(String).sort(),
            };
            return soft();
          }
        };
      if (name === "./src/helpers/updateIPC")
        return {
          trackUpdateActivity: () => soft(),
          attachUpdateIPC: (options) => {
            observed.updateOptions = options;
            throw marker;
          },
        };
      return soft();
    },
  };
  try {
    vm.runInNewContext(
      `${fs.readFileSync(path.join(ROOT, "main.js"), "utf8")}\nglobalThis.start = startApp; globalThis.bootPrivacy = privacy;`,
      context
    );
    await assert.rejects(context.start(), (e) => e === marker);
  } finally {
    process.kill = realKill;
    // main's boot configured the shared gate from its own profile state.
    resetGate();
  }
  mainRun = {
    observed,
    signals,
    bootFailures: [...context.bootPrivacy.bootFailures],
    pidDir,
    // main.js's own restart closure and the SealedState it reads (T12-M2).
    assertRestartAllowed: observed.updateOptions?.assertRestartAllowed,
    privacyState: context.bootPrivacy.state,
    restartChecks: 0,
  };
  return mainRun;
}
// Runs main.js's restart closure. Main's SealedState follows the matrix's seal
// flag for this call only, by shadowing its isSealed reader: set() would emit a
// change event into the shared gate.
function mainRestartAllowed() {
  assert.equal(typeof mainRun?.assertRestartAllowed, "function", "main.js ran to its update IPC");
  const state = mainRun.privacyState;
  mainRun.restartChecks += 1;
  state.isSealed = mainSealed;
  try {
    return mainRun.assertRestartAllowed();
  } finally {
    delete state.isSealed;
  }
}

test("A23: sealed startup preserves saved PID records and hands them to main's registry before the first manager, with no ps/tasklist", async () => {
  const run = await runMainToUpdateIpc();
  assert.ok(run.observed.managerConstructed, "main reached its first manager");
  const first = run.observed.atFirstManager;
  assert.equal(first.inspections, 0, "no native process inspection while sealed");
  assert.deepEqual(first.unresolved, [
    ["whisper", process.pid, "INSPECTION_REFUSED_SEALED", false],
  ]);
  assert.ok(first.records.includes("whisper.pid"), "the original record is kept");
  assert.ok(
    first.records.some((f) => /^unresolved[\\/]whisper\.\d+\.pid$/.test(f)),
    `a preserved copy exists: ${first.records}`
  );
  assert.deepEqual(run.signals, [], "nothing was signalled");
  assert.ok(run.bootFailures.includes(`child:whisper:${process.pid}:INSPECTION_REFUSED_SEALED`));
});

row({
  id: "N12",
  family: "downloads",
  label: "download-search-model (main.js)",
  channel: "download-search-model",
  task: "modelDownload",
  setup: () => runMainToUpdateIpc(),
  action: () => mainChannels.get("download-search-model")({ sender: sender() }),
});

// ---------------------------------------------------------------------------
// 8. The runner: refusal, then the Layer A sensitivity drill, per row.

function describeOutcome(outcome) {
  if (outcome.thrown) return `threw ${outcome.thrown?.code ?? ""} ${outcome.thrown?.message}`;
  try {
    return `returned ${JSON.stringify(outcome.value)}`;
  } catch {
    return `returned ${String(outcome.value)}`;
  }
}
const quiet = (fn) =>
  Promise.resolve()
    .then(fn)
    .catch(() => {});

for (const r of ROWS) {
  const name = `${r.id} ${r.family}: ${r.label}`;
  test(
    `${name} — sealed: typed refusal before any transport, credential or native launch`,
    { timeout: 20000 },
    async () => {
      await r.setup?.();
      resetCounters();
      recorder.clear();
      try {
        const outcome = await outcomeOf(r.action);
        assert.ok(
          (r.accept ?? sealedRefusal)(outcome),
          `${name} was not a typed sealed refusal: ${describeOutcome(outcome)}`
        );
        assert.deepEqual(transport, zeroTransport(), `${name} touched a transport`);
        assert.equal(layerB, 0, `${name} was left to Layer B: Layer A did not refuse it`);
        assert.equal(secretReads, 0, `${name} read a credential before refusing`);
        assert.deepEqual(nativeLeafCalls, [], `${name} reached a native leaf`);
        const rows = recorder.list();
        if (r.task === null) {
          assert.deepEqual(
            rows.filter((x) => x.outcome !== "blocked"),
            [],
            `${name} recorded a request`
          );
        } else {
          const blocked = rows.filter((x) => x.outcome === "blocked");
          assert.ok(
            blocked.some((x) => x.task === r.task),
            `${name} left no blocked ${r.task} row: ${JSON.stringify(rows)}`
          );
          for (const x of blocked)
            assert.equal(x.bytesOut, 0, `${name} blocked row has bytesOut ${x.bytesOut}`);
          assert.deepEqual(
            rows.filter((x) => x.outcome !== "blocked"),
            [],
            `${name} recorded something other than refusals`
          );
        }
        await r.check?.(outcome);
      } finally {
        await quiet(r.teardown);
      }
    }
  );

  test(
    `${name} — Layer A disabled: it reaches its egress point or a Layer B refusal`,
    { timeout: 20000 },
    async (t) => {
      await r.setup?.();
      resetCounters();
      recorder.clear();
      const mode = r.drill ?? "bypass";
      // A pending OAuth sign-in waits for its browser callback: once the drill
      // reached the browser handoff, cancel it instead of waiting 120 s.
      const watcher = setInterval(() => {
        if (transport.shellOpen > 0) quiet(r.drillCleanup);
      }, 10);
      if (mode === "unsealed" || typeof mode === "function") flags.sealed = false;
      else {
        flags.layerAOff = true;
        gate._setBypassForTests(true);
      }
      try {
        await outcomeOf(typeof mode === "function" ? mode : r.action);
      } finally {
        clearInterval(watcher);
        gate._setBypassForTests(false);
        flags.layerAOff = false;
        flags.sealed = true;
        await quiet(r.drillCleanup);
        await quiet(r.teardown);
      }
      if (mode === "passive") {
        assert.deepEqual(transport, zeroTransport(), `${name} is passive even when allowed`);
        assert.equal(recorder.list().length, 0);
        return;
      }
      const reached = touched() > 0 || layerB > 0 || nativeRefusals() > 0;
      assert.ok(
        reached,
        `${name} never reached its egress point with Layer A disabled (${mode}): ${JSON.stringify(snapshot())} ${JSON.stringify(recorder.list())}`
      );
      if (mode !== "bypass") assert.ok(touched() > 0, `${name} unsealed did not reach its leaf`);
      await r.drillCheck?.();
      t.diagnostic(
        `reached: ${JSON.stringify({ ...Object.fromEntries(Object.entries(transport).filter(([, v]) => v)), layerB, nativeRefusals: nativeRefusals() })}`
      );
    }
  );
}

// ---------------------------------------------------------------------------
// 16. Every channel the real code registers, for the ratchet.

function otherRegistrations() {
  const handles = new Map();
  const ons = new Map();
  const recordingIpc = {
    handle: (c, fn) => handles.set(c, fn),
    on: (c, fn) => ons.set(c, fn),
    removeHandler() {},
  };
  require("../../src/helpers/privacy/privacyIPC").attachPrivacyIPC({
    ipcMain: recordingIpc,
    BrowserWindow: { getAllWindows: () => [] },
    dialog: electron.dialog,
    state: { isSealed: () => true, set() {}, on() {} },
    recorder,
    attest: () => ({}),
    transition: { apply: async () => {}, recheck() {}, on() {}, off() {} },
    isTrustedSender: () => false,
    confirm: confirmations,
  });
  require("../../src/helpers/modelImportIpc").registerModelImportHandlers({
    ipcMain: recordingIpc,
    dialog: electron.dialog,
    modelManager: inertUi(),
    getWindow: () => null,
  });
  return { handles: [...handles.keys()], ons: [...ons.keys()] };
}
async function allRegisteredChannels() {
  await runMainToUpdateIpc();
  const other = otherRegistrations();
  return [
    ...new Set([
      ...ipc.channels(),
      ...ipc.listenerChannels(),
      ...mainChannels.keys(),
      ...mainListeners.keys(),
      ...other.handles,
      ...other.ons,
    ]),
  ].sort();
}

// ---------------------------------------------------------------------------
// 17. The ratchet. Every channel the real code registers is either a matrix
// row above (or in CROSS_FILE_ROWS), or declared here with the reason it has
// no outbound capability of its own. A new channel fails until it is one or
// the other, so the matrix cannot silently go stale.

const DECLARED = {
  // Follow-ups of an operation admitted earlier (send/flush/stop/cancel/status
  // of a realtime session, cancels): they open no connection and read no
  // credential; frames leave only on a live, admitted recording handle (Task
  // 9a). Executed below while sealed.
  follow: [
    "assemblyai-streaming-cancel",
    "assemblyai-streaming-force-endpoint",
    "assemblyai-streaming-send",
    "assemblyai-streaming-status",
    "assemblyai-streaming-stop",
    "cancel-upload-transcription",
    "cancel-url-download",
    "corti-streaming-cancel",
    "corti-streaming-finalize",
    "corti-streaming-send",
    "corti-streaming-status",
    "corti-streaming-stop",
    "deepgram-streaming-cancel",
    "deepgram-streaming-finalize",
    "deepgram-streaming-send",
    "deepgram-streaming-status",
    "deepgram-streaming-stop",
    "dictation-realtime-cancel",
    "dictation-realtime-send",
    "dictation-realtime-stop",
    "enterprise-reasoning-cancel",
    "enterprise-stream-cancel",
    "gemini-streaming-cancel",
    "gemini-streaming-finalize",
    "gemini-streaming-send",
    "gemini-streaming-status",
    "gemini-streaming-stop",
    "meeting-transcription-cancel",
    "meeting-transcription-send",
    "meeting-transcription-set-system-audio-available",
    "meeting-transcription-stop",
    "personal-inference:text-cancel",
    "personal-inference:text-operation-retire",
    "personal-inference:text-tool-result",
    "request-stop-meeting-recording",
  ],
  // Local engines (Whisper, Parakeet, llama.cpp, diarization, the ONNX/Qdrant
  // index) and their GPU/runtime settings. They spawn a sidecar only when its
  // binary and model are present, and neither is on this machine (downloads
  // are forbidden here); a Whisper/Parakeet/llama cold start also first probes
  // its port with a 0.0.0.0 bind, which the safety chain forbids. Stops and
  // settings act on a running sidecar, and none runs; the semantic searches
  // fall back to SQLite while the index is not ready; diarization returns
  // "models not downloaded"; model-check-runtime only checks the bundled
  // binary's file. No request either way: the process-wide spawn guard refuses
  // every start while sealed (the native rows, Codex, relaunch and A23 drive
  // it). 07b owns isolation.
  engine: [
    "transcribe-local-whisper",
    "transcribe-local-parakeet",
    "whisper-server-start",
    "parakeet-server-start",
    "llama-server-start",
    "process-local-reasoning",
    "diarize-audio-file",
    "transcribe-audio-file",
    "model-check-runtime",
    "model-test-load",
    "whisper-gpu-retry",
    "llama-gpu-reset",
    "set-gpu-device-index",
    "db-semantic-search-notes",
    "db-semantic-reindex-all",
    "db-semantic-search-conversations",
    "start-dictation-preview",
    "dictation-preview-audio",
    "whisper-server-stop",
    "parakeet-server-stop",
    "llama-server-stop",
  ],
  // Not driven because the manager they act through is an inertUi stand-in in
  // this harness (windowManager and its hotkey manager/leases,
  // clipboardManager, selectionManager): the real ones need live windows, key
  // listeners or accessibility access. They paste, read or replace the
  // selection, register hotkeys or check the paste/accessibility tools on this
  // machine (some backends run an OS tool, which the spawn guard governs). None
  // makes a request.
  standIn: [
    "paste-text",
    "paste-at-captured-target",
    "capture-selected-text",
    "replace-selected-text",
    "check-paste-tools",
    "check-accessibility-permission",
    "get-hyprland-config-status",
    "update-hotkey",
    "update-voice-agent-hotkey",
    "update-translation-hotkey",
    "register-cancel-hotkey",
    "unregister-cancel-hotkey",
    "set-hotkey-listening-mode",
    "acquire-pill-hotkey",
    "release-pill-hotkey",
  ],
  // OS permission, capture and system-audio access. On Linux the access
  // checks go through linuxPortalAudioManager, and on macOS through
  // audioTapManager, both inertUi stand-ins here; the macOS-only APIs
  // (systemPreferences prompts, desktopCapturer) give their non-darwin answer
  // on this Linux run, and the test rules forbid native capture. On macOS,
  // request-screen-recording-access may hand off to System Settings through
  // the guarded opener that the N21 settings rows drive. None makes a request.
  permission: [
    "request-microphone-access",
    "prompt-accessibility-permission",
    "check-system-audio-access",
    "request-system-audio-access",
    "check-screen-recording-access",
    "request-screen-recording-access",
    "capture-screen-context",
  ],
  // Local OS facts and settings, no request: the system profile (OS and memory
  // facts, plus the nvidia-smi probe that the detect-gpu row drives), the
  // login-item/XDG autostart entry (a local file; the cleanup-app row runs its
  // disable path under a temporary XDG_CONFIG_HOME), and an OS notification
  // through Electron's Notification (stubbed unsupported here).
  os: ["get-system-profile", "set-auto-start-enabled", "show-system-notification"],
  // File-manager reveals of app-owned local paths: no destination, so not
  // confirmed (Task 11 decision, threat-model N21).
  reveal: [
    "show-audio-in-folder",
    "show-note-file",
    "show-folder-in-explorer",
    "open-logs-folder",
    "open-whisper-models-folder",
  ],
  // Hand a meeting link to the guarded opener (N21 confirmation, as above):
  // joining a calendar meeting, or answering "join" on a meeting notification.
  // Not driven because both act through the meeting detection engine, which
  // is an inertUi stand-in here; the opener they reach is the one the N21 rows
  // drive.
  handoff: ["join-calendar-meeting", "meeting-notification-respond"],
  // Local only: history, notes, dictionary, credentials and config storage
  // (main-owned, never sent), windows, hotkeys, dictation lifecycle, privacy
  // IPC, update status, onboarding, model bookkeeping, recipient description,
  // calendar reads and disconnects (no revoke: only cleanup-app revokes), and
  // GPU/runtime status reads (get-cuda-/get-vulkan-whisper-status also run the
  // nvidia-smi probe the detect-gpu row drives). Re-audited for review I1: none
  // makes a request while sealed. (privacy:set-sealed(false) leaves sealed
  // mode; the resume work after it runs unsealed, Task 11.)
  local: [
    "acal-disconnect",
    "acal-get-connection-status",
    "acquire-recording-lock",
    "agent-open-note",
    "analytics-get-summary",
    "analytics-record-event",
    "app-log",
    "approve-audio-path",
    "attach-speaker-email",
    "auto-learn-changed",
    "calendar-get-availability",
    "cancel-agent-panel-dictation",
    "cancel-cuda-whisper-download",
    "cancel-diarization-download",
    "cancel-llama-vulkan-download",
    "cancel-parakeet-download",
    "cancel-vulkan-whisper-download",
    "cancel-whisper-download",
    "capture-dictation-target",
    "check-ffmpeg-availability",
    "check-local-reasoning-available",
    "check-microphone-access",
    "check-model-status",
    "check-parakeet-installation",
    "check-parakeet-model-status",
    "check-whisper-installation",
    "complete-dictation-preview",
    "control-panel-toggle-dictation",
    "credentials-list",
    "credentials-remove",
    "credentials-save",
    "credentials-undo-remove",
    "db-add-agent-message",
    "db-apply-dictionary-changes",
    "db-archive-agent-conversation",
    "db-broadcast-dictionary-updated",
    "db-broadcast-snippets-updated",
    "db-clear-transcriptions",
    "db-create-action",
    "db-create-agent-conversation",
    "db-create-folder",
    "db-delete-action",
    "db-delete-agent-conversation",
    "db-delete-folder",
    "db-delete-note",
    "db-delete-transcription",
    "db-get-action",
    "db-get-actions",
    "db-get-agent-conversation",
    "db-get-agent-conversations",
    "db-get-agent-conversations-with-preview",
    "db-get-agent-messages",
    "db-get-conversation-by-client-id",
    "db-get-conversations-for-container",
    "db-get-conversations-for-note",
    "db-get-dictionary",
    "db-get-dictionary-by-client-id",
    "db-get-folder-by-client-id",
    "db-get-folder-id-map",
    "db-get-folder-note-counts",
    "db-get-folders",
    "db-get-note",
    "db-get-note-by-client-id",
    "db-get-notes",
    "db-get-snippets",
    "db-get-space-notes",
    "db-get-spaces",
    "db-get-table-board",
    "db-get-transcription-by-client-id",
    "db-get-transcriptions",
    "db-hide-table-cards",
    "db-link-table-cards",
    "db-move-folder-to-space",
    "db-place-table-cards",
    "db-rename-folder",
    "db-save-note",
    "db-save-transcription",
    "db-search-agent-conversations",
    "db-search-notes",
    "db-set-dictionary",
    "db-set-snippets",
    "db-set-table-viewport",
    "db-unarchive-agent-conversation",
    "db-update-action",
    "db-update-agent-conversation-title",
    "db-update-note",
    "db-update-space",
    "delete-all-audio",
    "delete-all-parakeet-models",
    "delete-all-whisper-models",
    "delete-cuda-whisper-binary",
    "delete-diarization-models",
    "delete-llama-vulkan-binary",
    "delete-parakeet-model",
    "delete-temp-audio",
    "delete-temp-file",
    "delete-transcription-audio",
    "delete-vulkan-whisper-binary",
    "delete-whisper-model",
    "detect-vulkan-gpu",
    "dictation-audio-level-changed",
    "dictation-lifecycle-state-changed",
    "dismiss-dictation-preview",
    "dismiss-gpu-pack-migration-notice",
    "enterprise-route-facts",
    "export-dictionary",
    "export-note",
    "export-transcript",
    "force-stop-dictation",
    "gcal-disconnect",
    "gcal-get-calendars",
    "gcal-get-connection-status",
    "gcal-get-event",
    "gcal-get-upcoming-events",
    "get-activation-mode",
    "get-active-dictation-key",
    "get-agent-dictation-pill-state",
    "get-anthropic-key",
    "get-app-version",
    "get-assemblyai-key",
    "get-audio-buffer",
    "get-audio-diagnostics",
    "get-audio-path",
    "get-audio-storage-usage",
    "get-auto-start-enabled",
    "get-azure-api-key",
    "get-azure-api-version",
    "get-azure-deployment",
    "get-azure-endpoint",
    "get-bedrock-access-key-id",
    "get-bedrock-profile",
    "get-bedrock-region",
    "get-bedrock-secret-access-key",
    "get-bedrock-session-token",
    "get-chat-agent-custom-key",
    "get-cleanup-custom-key",
    "get-corti-client-id",
    "get-corti-client-secret",
    "get-corti-key",
    "get-cuda-whisper-status",
    "get-custom-transcription-key",
    "get-debug-state",
    "get-deepgram-key",
    "get-diarization-model-status",
    "get-dictation-agent-custom-key",
    "get-dictation-agent-vision-custom-key",
    "get-dictation-binding",
    "get-dictation-key",
    "get-dictation-lifecycle-state",
    "get-effective-default-hotkey",
    "get-enterprise-route-state",
    "get-file-size",
    "get-gemini-key",
    "get-gpu-device-index",
    "get-gpu-pack-migration-notice",
    "get-groq-key",
    "get-hotkey-mode-info",
    "get-llama-vulkan-status",
    "get-log-level",
    "get-main-window-horizontal-direction",
    "get-md5-hash",
    "get-meeting-notification-data",
    "get-meeting-recording-presence",
    "get-mistral-key",
    "get-model-cache-root",
    "get-note-formatting-custom-key",
    "get-openai-key",
    "get-openrouter-key",
    "get-parakeet-diagnostics",
    "get-pending-meeting-note-navigation",
    "get-pending-note-navigation",
    "get-search-model-status",
    "get-speaker-mappings",
    "get-speaker-profiles",
    "get-tinfoil-key",
    "get-total-memory",
    "get-transcription-by-id",
    "get-translation-custom-key",
    "get-translation-key",
    "get-ui-language",
    "get-vertex-api-key",
    "get-vertex-auth-source",
    "get-vertex-location",
    "get-vertex-project",
    "get-voice-agent-key",
    "get-vulkan-whisper-status",
    "get-xai-key",
    "granola-import-pick-and-preview",
    "granola-import-run",
    "hide-dictation-preview",
    "hide-window",
    "keyring-describe-verify",
    "keyring-list",
    "keyring-route-health",
    "keyring-set-reminder",
    "list-parakeet-models",
    "list-whisper-models",
    "llama-cpp-install",
    "llama-cpp-uninstall",
    "llama-server-status",
    "loqui-update:prepared",
    "loqui-update:status",
    "mac-accessibility-features-ready",
    "mcal-disconnect",
    "mcal-get-connection-status",
    "meeting-detection-get-preferences",
    // T12-m4: can start the audio-activity detector, which spawns OS tools (a
    // native launch, never a request). While sealed the engine starts no
    // detector (I1) and the spawn guard refuses any launch.
    "meeting-detection-set-preferences",
    "meeting-notification-ready",
    "meeting-recording-outcome",
    "meeting-recording-presence",
    "meeting-set-session-speaker-config",
    "meeting-set-speaker-diarization-enabled",
    "merge-speaker-text",
    "mic-warm-hold-changed",
    "model-cancel-download",
    "model-cancel-load-test",
    "model-check",
    "model-delete",
    "model-delete-all",
    "model-get-active-downloads",
    "model-get-all",
    "model-import-gguf",
    "note-files-get-default-path",
    "note-files-pick-folder",
    "note-files-rebuild",
    "note-files-set-enabled",
    "note-files-set-path",
    "onboarding-cleanup-reply",
    "onboarding-cleanup-retry",
    "onboarding-demo-admission-invalidated",
    "onboarding-demo-admission-reply",
    "onboarding-demo-begin",
    "onboarding-demo-cancel",
    "onboarding-demo-end",
    "onboarding-demo-publish",
    "onboarding-demo-stop",
    "onboarding-demo-toggle",
    "onboarding-demo-undo-cancel",
    "onboarding-set-active",
    "onboarding-set-window-mode",
    "open-settings-at",
    "parakeet-server-status",
    "personal-inference:credential-save",
    "personal-inference:credential-status",
    "personal-inference:describe-models",
    "personal-inference:text-operation-capture",
    "privacy:attestation",
    "privacy:egress-clear",
    "privacy:egress-export",
    "privacy:egress-list",
    "privacy:egress-summary",
    "privacy:get-sealed",
    "privacy:set-sealed",
    "read-clipboard",
    "release-recording-lock",
    "remove-speaker-mapping",
    "resize-agent-dictation-pill-to-content",
    "resize-assistant-window-to-content",
    "resize-dictation-error-window-to-content",
    "resize-main-window",
    "restore-from-meeting-mode",
    "retention-settings-changed",
    "save-activation-mode",
    "save-all-keys-to-env",
    "save-anthropic-key",
    "save-assemblyai-key",
    "save-azure-api-key",
    "save-azure-api-version",
    "save-azure-deployment",
    "save-azure-endpoint",
    "save-bedrock-access-key-id",
    "save-bedrock-profile",
    "save-bedrock-region",
    "save-bedrock-secret-access-key",
    "save-bedrock-session-token",
    "save-chat-agent-custom-key",
    "save-cleanup-custom-key",
    "save-corti-client-id",
    "save-corti-client-secret",
    "save-corti-key",
    "save-custom-transcription-key",
    "save-deepgram-key",
    "save-dictation-agent-custom-key",
    "save-dictation-agent-vision-custom-key",
    "save-dictation-key",
    "save-enterprise-route-patch",
    "save-gemini-key",
    "save-groq-key",
    "save-mistral-key",
    "save-note-formatting-custom-key",
    "save-note-speaker-embeddings",
    "save-openai-key",
    "save-openrouter-key",
    "save-temp-audio",
    "save-tinfoil-key",
    "save-transcription-audio",
    "save-translation-custom-key",
    "save-ui-language",
    "save-vertex-api-key",
    "save-vertex-auth-source",
    "save-vertex-location",
    "save-vertex-project",
    "save-xai-key",
    "screen-context-set-enabled",
    "search-contacts",
    "select-audio-file",
    "set-agent-dictation-pill-interactivity",
    "set-assistant-panel-busy",
    "set-assistant-panel-open",
    "set-debug-logging",
    "set-main-window-input-region",
    "set-main-window-interactivity",
    "set-notification-interactivity",
    "set-speaker-mapping",
    "set-ui-language",
    "settings-link-ack",
    "settings-link-pending",
    "show-agent-dictation-final-transcript",
    "show-control-panel",
    "show-dictation-panel",
    "snap-to-meeting-mode",
    "start-control-panel-drag",
    "start-manual-meeting",
    "start-window-drag",
    "stop-control-panel-drag",
    "stop-dictation-preview",
    "stop-window-drag",
    "storage-delete-audio",
    "storage-delete-history",
    "storage-preview",
    // T12-m4: same detector start as meeting-detection-set-preferences.
    "sync-notification-preferences",
    "sync-startup-preferences",
    "toggle-agent-panel-dictation",
    "undo-learned-corrections",
    "update-dictation-preview",
    "update-transcription-text",
    "upsert-contact",
    "whisper-server-status",
    "whisper-vad-get-config",
    "whisper-vad-set-config",
    "window-close",
    "window-is-maximized",
    "window-maximize",
    "window-minimize",
    "write-clipboard",
  ],
};

// main.js channels registered after the VM run's stop point: window and
// hotkey preferences and the macOS accessibility check (local only).
const MAIN_LATE = [
  "activation-mode-changed",
  "check-accessibility-trusted",
  "floating-icon-auto-hide-changed",
  "hotkey-changed",
  "hotkey-listening-mode-changed",
  "panel-start-position-changed",
  "register-meeting-hotkey",
  "start-minimized-changed",
];

const MATRIX_CHANNELS = () =>
  new Set([
    ...ROWS.map((r) => r.channel).filter(Boolean),
    ...NATIVE.map((r) => r.channel),
    "open-external",
    "acal-connect",
    "personal-inference:codex-cancel-login",
    "loqui-update:setup-complete",
    "loqui-update:preferences",
    ...SETTINGS_CHANNELS,
    ...Object.keys(CROSS_FILE_ROWS),
  ]);

test("ratchet: every registered channel is a matrix row or declared without outbound capability", async () => {
  const registered = await allRegisteredChannels();
  const matrix = MATRIX_CHANNELS();
  const declared = new Map();
  for (const [group, channels] of Object.entries(DECLARED))
    for (const channel of channels) {
      assert.ok(!declared.has(channel), `${channel} declared twice`);
      assert.ok(!matrix.has(channel), `${channel} is a matrix row and declared ${group}`);
      declared.set(channel, group);
    }
  const unclassified = registered.filter((c) => !matrix.has(c) && !declared.has(c));
  assert.deepEqual(unclassified, [], "new channels need a matrix row or a declared reason");
  const stale = [...matrix, ...declared.keys()].filter((c) => !registered.includes(c));
  assert.deepEqual(stale, [], "rows or declarations for channels nothing registers");
});

test("ratchet: main.js's own literal channels are classified too (beside the executed VM run)", () => {
  const source = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
  const literal = [...source.matchAll(/ipcMain\.(?:handle|on)\(\s*"([^"]+)"/g)].map((m) => m[1]);
  const known = new Set([...MATRIX_CHANNELS(), ...Object.values(DECLARED).flat(), ...MAIN_LATE]);
  assert.deepEqual(
    literal.filter((c) => !known.has(c)),
    []
  );
});

test("ratchet: every realtime family and meeting provider the handlers register is a row", () => {
  const prefixes = new Set(REALTIME.map((c) => c.replace(/-(warmup|start)$/, "")));
  assert.deepEqual(
    [...prefixes].filter((p) => !REALTIME_OPTIONS[p]),
    [],
    "a new realtime family needs options here"
  );
  for (const channel of REALTIME)
    assert.ok(
      ROWS.some((r) => r.channel === channel),
      channel
    );
  assert.ok(REALTIME.length >= 10);
  for (const provider of [...ALLOWED_MEETING_PROVIDERS].filter((p) => p !== "local"))
    assert.ok(
      ROWS.some((r) => r.label === `meeting-transcription-start (${provider})`),
      provider
    );
  for (const provider of ipc.channels().filter((c) => /^proxy-.*-transcription$/.test(c)))
    assert.ok(
      ROWS.some((r) => r.channel === provider),
      provider
    );
});

test("ratchet: every blocked threat-model row has an executed row (N25 is Chromium-only: Task 16)", () => {
  const doc = fs.readFileSync(path.join(ROOT, "docs/security/sealed-mode-threat-model.md"), "utf8");
  const blocked = doc
    .split("\n")
    .filter((line) => /^\| N\d+\s*\|/.test(line) && /\|\s*blocked\s*\|/.test(line))
    .map((line) => line.match(/^\| (N\d+)/)[1]);
  assert.ok(blocked.length >= 20);
  const covered = new Set([
    ...ROWS.map((r) => r.id),
    ...NATIVE.map((r) => r.id),
    "N14",
    "N15",
    "N18",
    "N20",
    "N25",
  ]);
  // N14/N15: urlAudioDownloader.test.js; N23 (ONNX utility worker): declared
  // native (db-semantic-*), refused by the utility guard (Task 6a test).
  covered.add("N23");
  assert.deepEqual(
    blocked.filter((id) => !covered.has(id)),
    []
  );
});

test("ratchet: URL import and yt-dlp rows live in urlAudioDownloader.test.js and still exist", () => {
  for (const [channel, file] of Object.entries(CROSS_FILE_ROWS)) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(source, new RegExp(`Task 12 matrix: ${channel}`), `${file} drives ${channel}`);
    assert.match(source, /Task 12 matrix: yt-dlp self-update/);
  }
});

// T12-M7: this sweep proves only that follow-ups naming an unknown session do
// nothing while sealed. A follow-up on a session admitted before the seal is
// driven by the meeting test below (its replacement connection is refused).
test("session follow-ups for an unknown session, invoked while sealed, open nothing and read no credential", async () => {
  const identity = { correlationId: "none", dictationSessionId: "none", operationId: "op-none" };
  for (const channel of DECLARED.follow) {
    const handler = ipc.handlers.get(channel);
    const listener = ipc.listeners.get(channel);
    await outcomeOf(() =>
      handler
        ? ipc.invokeWith({ sender: sender() }, channel, identity)
        : listener({ sender: sender() }, new Uint8Array(320), identity)
    );
  }
  assert.deepEqual(transport, zeroTransport());
  assert.equal(secretReads, 0);
  assert.equal(layerB, 0);
  assert.deepEqual(
    recorder.list().filter((x) => x.outcome !== "blocked"),
    []
  );
});

test("interrupted: a meeting sealed mid-stream; its replacement connection is refused before token or socket", async (t) => {
  await startWsFixture();
  // Meeting capture stand-ins (system audio tap and detection engine).
  const saved = {};
  for (const [key, value] of Object.entries({
    audioTapManager: { isSupported: () => true, start: async () => true, stop: async () => {} },
    meetingAecManager: { isAvailable: () => false, stop: async () => {} },
    meetingDetectionEngine: {
      endRecordingSession: () => true,
      setUserRecording() {},
      beginRecordingSession: async () => {},
      recordMeetingAudioChunk() {},
    },
    linuxPortalAudioManager: null,
    windowsLoopbackAudioManager: null,
  })) {
    saved[key] = ipc.instance[key];
    ipc.instance[key] = value;
  }
  const who = sender(41);
  t.after(async () => {
    await quiet(() => as(who, "meeting-transcription-stop", null));
    Object.assign(ipc.instance, saved);
  });
  flags.sealed = false;
  const start = await as(who, "meeting-transcription-start", {
    provider: "deepgram-realtime",
    mode: "byok",
    sessionId: "meet-matrix",
  });
  assert.equal(start.success, true, JSON.stringify(start));
  ipc.listeners.get("meeting-transcription-send")(
    { sender: who },
    new Uint8Array(3200).fill(7),
    "system"
  );
  await waitFor(
    () => wsFixture.conns.reduce((n, c) => n + c.content, 0) >= 3200,
    "meeting audio delivered"
  );
  const socketsBefore = transport.ws;
  seal();
  await waitFor(
    () => recorder.list().filter((x) => x.kind === "connection").length >= 1,
    "sockets settled"
  );
  // Audio after the seal asks for a replacement connection.
  ipc.listeners.get("meeting-transcription-send")(
    { sender: who },
    new Uint8Array(3200).fill(7),
    "system"
  );
  const stop = await as(who, "meeting-transcription-stop", "meet-matrix");
  assert.ok(
    recorder
      .list()
      .some((x) => x.task === "noteRecordingStt" && x.outcome === "blocked" && x.bytesOut === 0),
    `the replacement connection was refused: ${JSON.stringify(recorder.list())}`
  );
  assert.equal(transport.ws, socketsBefore, "no replacement socket was constructed");
  assert.equal(stop.phase, "interrupted");
  assert.doesNotMatch(JSON.stringify(stop), NOTHING_SENT);
  for (const x of recorder.list().filter((r) => r.outcome === "blocked"))
    assert.equal(x.bytesOut, 0);
  const stream = recorder.list().find((x) => x.kind === "stream");
  assert.deepEqual(
    [stream.task, stream.outcome, stream.errorClass],
    ["noteRecordingStt", "cancelled", "SEALED_MODE"]
  );
});
