const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const assert = require("node:assert/strict");
const { deferred, flush } = require("./audioRecordingTrial");

const families = [
  ["openai-realtime", "dictation-realtime", "dictationRealtime", "_dictationStreaming"],
  ["tinfoil-realtime", "dictation-realtime", "dictationRealtime", "_dictationStreaming"],
  ["deepgram", "deepgram-streaming", "deepgramStreaming", "deepgramStreaming"],
  ["assemblyai", "assemblyai-streaming", "assemblyAiStreaming", "assemblyAiStreaming"],
  ["gemini", "gemini-streaming", "geminiStreaming", "geminiStreaming"],
  ["corti", "corti-streaming", "cortiStreaming", "cortiStreaming"],
];
function operation(id) {
  return { correlationId: id, dictationSessionId: id, operationId: `attempt-${id}` };
}
function sender(id) {
  const wc = new EventEmitter();
  Object.assign(wc, {
    id,
    dead: false,
    messages: [],
    isDestroyed: () => wc.dead,
    send: (...args) => wc.messages.push(args),
  });
  return wc;
}
function mainFixture(t, { DeepgramStreaming = null } = {}) {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../../src/helpers/ipcHandlers.js"),
    "utf8"
  );
  const cut = (from, to) => {
    const a = source.indexOf(from),
      b = source.indexOf(to, a);
    assert.ok(a >= 0 && b > a, `actual registration extraction: ${from} -> ${to}`);
    return source.slice(a, b);
  };
  // Whole production groups, including ownership registration inserted directly
  // before setupDictationCallbacks. Never extract only the old handler bodies.
  const registration = cut(
    "    const streamingStartFailure =",
    '    ipcMain.handle(\n      "start-dictation-preview"'
  );
  const handlers = new Map(),
    events = new Map(),
    clients = [],
    tokens = [],
    opened = [];
  const ipcMain = {
    handle(name, fn) {
      assert.ok(!handlers.has(name), name);
      handlers.set(name, fn);
    },
    on(name, fn) {
      events.set(name, fn);
    },
  };
  class Client {
    constructor() {
      this.id = clients.length + 1;
      clients.push(this);
      this.live = false;
      this.isConnected = false;
    }
    adoptMode() {}
    setEgressGate(fn) {
      this._egressGate = fn;
    }
    setLifecycleGate(fn) {
      this._lifecycleGate = fn;
    }
    discardPendingAudio() {}
    hasWarmConnection() {
      return this.warmConnection?.readyState === 1;
    }
    getCachedToken() {
      return null;
    }
    cacheToken() {}
    beginConnecting() {}
    setTokenRefreshFn(fn) {
      this.refresh = fn;
    }
    async connect() {
      this.live = this.isConnected = true;
      this.ws = this.warmConnection ?? { readyState: 1 };
      this.warmConnection = null;
      opened.push(this);
    }
    async warmup() {
      this.live = true;
      this.warmConnection = { readyState: 1 };
      opened.push(this);
    }
    async disconnect() {
      this.live = this.isConnected = false;
      return { text: "" };
    }
    sendAudio() {
      this.sends = (this.sends || 0) + 1;
      return true;
    }
    finalize() {
      this.finals = (this.finals || 0) + 1;
    }
    forceEndpoint() {
      this.finalize();
    }
    cleanupAll() {
      this.warmConnection = null;
      this.live = this.isConnected = false;
    }
    cleanup() {
      this.live = this.isConnected = false;
    }
    getStatus() {
      return { isConnected: this.live };
    }
  }
  const host = {
    environmentManager: Object.fromEntries(
      [
        "getOpenAIKey",
        "getTinfoilKey",
        "getDeepgramKey",
        "getAssemblyAIKey",
        "getGeminiKey",
        "getCortiClientId",
        "getCortiClientSecret",
      ].map((name) => [name, () => "fixture-credential"])
    ),
    windowManager: { showTranscriptionPreview() {}, hideTranscriptionPreview() {} },
    _mintStoredCortiToken: async () => ({
      token: await token(),
      environment: "fixture",
      tenant: "fixture",
    }),
  };
  let nextToken = null;
  const token = async () => {
    const value = nextToken;
    nextToken = null;
    tokens.push(value);
    return value ? value.promise : "fixture-token";
  };
  const noop = () => {};
  const injectedRequire = (name) => {
    assert.equal(name, "./dictationStreamingOperations");
    return require("../../../src/helpers/dictationStreamingOperations");
  };
  new Function(
    "ipcMain",
    "BrowserWindow",
    "debugLogger",
    "fetchRealtimeToken",
    "toPolicyFailure",
    "OpenAIRealtimeStreaming",
    "AssemblyAiStreaming",
    "DeepgramStreaming",
    "GeminiLiveStreaming",
    "CortiStreaming",
    "TINFOIL_REALTIME_MODEL",
    "GEMINI_LIVE_MODEL",
    "createTinfoilRealtimeSocket",
    "require",
    registration
  ).call(
    host,
    ipcMain,
    {
      fromWebContents: (wc) => ({
        id: wc.id,
        isDestroyed: () => wc.isDestroyed(),
        webContents: wc,
      }),
      fromId: () => null,
    },
    { debug: noop, error: noop, warn: noop },
    token,
    (error) => ({ success: false, error: error.message }),
    Client,
    Client,
    DeepgramStreaming || Client,
    Client,
    Client,
    "fixture-tinfoil",
    "fixture-gemini",
    () => {
      throw Error("real socket forbidden");
    },
    injectedRequire
  );
  for (const [, prefix] of families)
    for (const action of ["start", "stop", "warmup"])
      assert.equal(
        typeof handlers.get(`${prefix}-${action}`),
        "function",
        `real ${prefix}-${action} must remain registered`
      );
  for (const [, prefix] of families) {
    assert.equal(
      typeof events.get(`${prefix}-send`),
      "function",
      `real ${prefix}-send must remain registered`
    );
    if (prefix !== "dictation-realtime") {
      const action = prefix === "assemblyai-streaming" ? "force-endpoint" : "finalize";
      assert.equal(
        typeof events.get(`${prefix}-${action}`),
        "function",
        `real ${prefix} finalize must remain registered`
      );
    }
  }
  t.after(() => host.dictationStreamingOperations?.dispose());
  function bridge(wc, hold = null) {
    let api;
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../preload.js"), "utf8"), {
      require(name) {
        assert.equal(name, "electron");
        return {
          contextBridge: {
            executeInMainWorld: () => {},
            exposeInMainWorld(_name, value) {
              api = value;
            },
          },
          ipcRenderer: {
            async invoke(channel, ...args) {
              const result = await handlers.get(channel)({ sender: wc }, ...args);
              if (hold && channel.endsWith("-start")) await hold.promise;
              return result;
            },
            send(channel, ...args) {
              events.get(channel)?.({ sender: wc }, ...args);
            },
            on() {},
            removeListener() {},
            sendSync() {},
          },
          webUtils: {},
        };
      },
      process: { ...process, isMainFrame: true },
    });
    return api;
  }
  return {
    host,
    handlers,
    events,
    clients,
    opened,
    tokens,
    bridge,
    holdToken() {
      nextToken = deferred();
      return nextToken;
    },
    async waitOpen(count) {
      for (let i = 0; i < 100 && opened.length < count; i++) await flush();
      assert.equal(opened.length, count);
    },
  };
}
module.exports = { families, operation, sender, mainFixture };
