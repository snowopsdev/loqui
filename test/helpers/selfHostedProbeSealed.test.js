const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");
const { once } = require("node:events");
const test = require("node:test");
const { registerHttpServerCleanup } = require("./harness/httpServerCleanup");

// Plan 07 Task 11a: drives the REAL probe-self-hosted handler registered by
// IPCHandlers.setupHandlers, against the real egress gate and recorder. The
// only transport is an owned numeric 127.0.0.1 listener; any other destination
// is refused by the fetch guard below before a socket could open.
const handlersPath = require.resolve("../../src/helpers/ipcHandlers");
const handlers = new Map();
function anything() {
  return new Proxy(function () {}, {
    get: (_target, key) =>
      key === "then" ? undefined : key === Symbol.toPrimitive ? () => "" : anything(),
    apply: () => anything(),
  });
}
const electron = {
  app: { getPath: () => "/tmp", getName: () => "test", getVersion: () => "0.0.0", on() {} },
  ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {}, removeHandler() {} },
  BrowserWindow: class {
    static getAllWindows() {
      return [];
    }
  },
  net: {
    fetch: () => {
      throw new Error("The self-hosted probe never uses Electron's network");
    },
  },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 0, height: 0 } }) },
  systemPreferences: { getMediaAccessStatus: () => "granted" },
  session: { fromPartition: () => ({}) },
};
// The probe path is real end to end: handler → selfHostedProbe → gatedFetch →
// egressGate/egressPolicy. Unrelated leaves of ipcHandlers stay inert.
const REAL = new Set([
  "./selfHostedProbe",
  "./providerConnectionTest",
  "./privacy/gatedFetch",
  "./privacy/egressGate",
  "./privacy/egressPolicy",
]);
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return electron;
  if (parent?.filename === handlersPath) {
    if (REAL.has(request)) return originalLoad.call(this, request, parent, isMain);
    if (request.startsWith(".") || request === "fs") return anything();
    if (/^(?:node:)?(?:child_process|http|https|net|tls|dgram)$/.test(request))
      throw new Error(`Forbidden probe fixture boundary: ${request}`);
  }
  return originalLoad.call(this, request, parent, isMain);
};

const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { gatedNodeFetch } = require("../../src/helpers/privacy/gatedFetch");
const { SealedModeError } = require("../../src/helpers/privacy/egressPolicy");
const { probeSelfHosted } = require("../../src/helpers/selfHostedProbe");

const originalFetch = globalThis.fetch;
const fetchCalls = [];
let ownedPort = null;
let sealed = true;
let recorder;
let clock = 0;

test.before(() => {
  globalThis.fetch = (input, init) => {
    const href = String(input?.url ?? input);
    fetchCalls.push(href);
    const url = new URL(href);
    if (url.hostname !== "127.0.0.1" || Number(url.port) !== ownedPort)
      return Promise.reject(new TypeError(`fixture refuses ${url.host}`));
    return originalFetch(input, init);
  };
  delete require.cache[handlersPath];
  const Ctor = require(handlersPath);
  Ctor.prototype.setupHandlers.call(new Proxy({}, { get: () => anything() }));
});

test.after(() => {
  globalThis.fetch = originalFetch;
  gate._resetForTests();
  Module._load = originalLoad;
  delete require.cache[handlersPath];
});

test.beforeEach(() => {
  sealed = true;
  fetchCalls.length = 0;
  gate._resetForTests();
  recorder = new FlightRecorder({ now: () => ++clock });
  gate.configureEgress({ isSealed: () => sealed, recorder, now: () => ++clock });
});

const probe = (baseUrl) => {
  const handler = handlers.get("probe-self-hosted");
  if (!handler) throw new Error("Missing production IPC handler: probe-self-hosted");
  return handler({}, baseUrl);
};

async function ownedServer(t, respond) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    respond(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  ownedPort = server.address().port;
  registerHttpServerCleanup(t, server);
  t.after(() => {
    ownedPort = null;
  });
  return { base: `http://127.0.0.1:${ownedPort}`, port: ownedPort, requests, server };
}
const models = (count) => (_req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ data: Array.from({ length: count }, (_, i) => ({ id: `m${i}` })) }));
};

test("sealed: a LAN probe is refused as 'sealed', not 'network', and recorded as blocked", async () => {
  assert.deepEqual(await probe("http://192.168.1.20:11434/v1"), { ok: false, code: "sealed" });
  assert.deepEqual(fetchCalls, [], "refused before any transport");
  const rows = recorder.list();
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [rows[0].task, rows[0].host, rows[0].outcome, rows[0].bytesOut],
    ["providerCheck", "192.168.1.20", "blocked", 0]
  );
});

test("sealed: an HTTPS server elsewhere is refused as 'sealed' too", async () => {
  assert.deepEqual(await probe("https://gpu-box.lan/v1"), { ok: false, code: "sealed" });
  assert.deepEqual(fetchCalls, []);
  assert.deepEqual(
    recorder.list().map((row) => [row.task, row.host, row.outcome]),
    [["providerCheck", "gpu-box.lan", "blocked"]]
  );
});

test("sealed: a loopback probe still reaches the owned local server, with no headers and no row", async (t) => {
  const server = await ownedServer(t, models(1));
  assert.deepEqual(await probe(`${server.base}/v1/`), { ok: true, count: 1 });
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].method, "GET");
  assert.equal(server.requests[0].url, "/v1/models");
  assert.equal(server.requests[0].headers.authorization, undefined, "no key, ever");
  assert.equal(recorder.list().length, 0, "loopback is never recorded");
});

test("sealed: spellings main does not treat as loopback are refused before the owned server sees them", async (t) => {
  const server = await ownedServer(t, models(2));
  for (const base of [
    `http://127.1:${server.port}/v1`,
    `http://0x7f.0.0.1:${server.port}/v1`,
    `http://2130706433:${server.port}/v1`,
    `http://127.0.0.1:${server.port}\\@evil.example/v1`,
  ]) {
    assert.deepEqual(await probe(base), { ok: false, code: "sealed" }, base);
  }
  assert.deepEqual(fetchCalls, []);
  assert.equal(server.requests.length, 0);
  assert.deepEqual(
    recorder.list().map((row) => [row.task, row.host, row.outcome]),
    Array(4).fill(["providerCheck", "unknown", "blocked"])
  );
});

test("unsealed: the loopback probe is unchanged and still writes no row", async (t) => {
  sealed = false;
  const server = await ownedServer(t, models(3));
  assert.deepEqual(await probe(server.base), { ok: true, count: 3 });
  assert.equal(server.requests[0].url, "/models");
  assert.equal(recorder.list().length, 0);
});

test("validation still answers first: no egress decision for an invalid address", async () => {
  assert.deepEqual(await probe("http://example.com/v1"), { ok: false, code: "httpsRequired" });
  assert.deepEqual(await probe("not a url"), { ok: false, code: "invalidUrl" });
  assert.deepEqual(await probe("http://user:pw@192.168.1.2/"), { ok: false, code: "invalidUrl" });
  assert.deepEqual(fetchCalls, []);
  assert.equal(recorder.list().length, 0);
});

test("a timeout through the gate is still 'timeout'", async (t) => {
  let clientGone;
  const gone = new Promise((resolve) => {
    clientGone = resolve;
  });
  // Never answers; the probe's own deadline must end the request.
  const server = await ownedServer(t, (_req, res) => res.on("close", clientGone));
  let connections = 0;
  let reconnected;
  const reconnect = new Promise((resolve) => {
    reconnected = resolve;
  });
  server.server.on("connection", () => {
    if (++connections === 2) reconnected();
  });
  const result = await probeSelfHosted(server.base, gatedNodeFetch("providerCheck"), 50);
  assert.deepEqual(result, { ok: false, code: "timeout" });
  // The abort reached the transport: the client closed its own connection.
  let timer;
  await Promise.race([
    gone,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("the aborted probe kept its connection")), 3000);
    }),
  ]).finally(() => clearTimeout(timer));
  // Node's fetch pool reopens one idle connection after an aborted request.
  // Let it land on the owned listener while it is still up, so teardown never
  // leaves a connect aimed at a retired port.
  await Promise.race([reconnect, new Promise((resolve) => (timer = setTimeout(resolve, 500)))]);
  clearTimeout(timer);
  assert.equal(server.requests.length, 1, "no second request, only an idle connection");
});

test("a seal that interrupts the probe, before or during the body, is 'sealed', never a model count", async () => {
  const refused = new SealedModeError({ task: "providerCheck", host: "192.168.1.20" });
  const interrupted = new SealedModeError({
    task: "providerCheck",
    host: "192.168.1.20",
    phase: "interrupted",
  });
  assert.deepEqual(
    await probeSelfHosted("http://192.168.1.20:11434/v1", async () => {
      throw refused;
    }),
    { ok: false, code: "sealed" }
  );
  assert.deepEqual(
    await probeSelfHosted("http://192.168.1.20:11434/v1", async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw interrupted;
      },
    })),
    { ok: false, code: "sealed" }
  );
  // An ordinary unreadable body keeps Plan 03's lenient count.
  assert.deepEqual(
    await probeSelfHosted("http://192.168.1.20:11434/v1", async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    })),
    { ok: true, count: 0 }
  );
});
