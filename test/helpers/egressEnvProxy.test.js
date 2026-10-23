const assert = require("node:assert/strict");
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");
const test = require("node:test");
const undici = require("undici");
const { HttpsProxyAgent } = require("https-proxy-agent");
const gate = require("../../src/helpers/privacy/egressGate");
const backstop = require("../../src/helpers/privacy/egressBackstop");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError } = require("../../src/helpers/privacy/egressPolicy");

// Owner decision D-5: while sealed, Loqui's own Node requests are never
// forwarded through a proxy taken from the environment, from Node's
// proxy-configured agents, from undici's dispatchers (the global one
// included) or from a per-SDK proxy agent. Everything runs against listeners
// this file owns on 127.0.0.1 (port 0): a "proxy" that counts every byte it
// receives and forwards nothing, and a plain "service". NODE_USE_ENV_PROXY
// acts at process start, so its two effects are installed the way Node
// installs them: a global dispatcher that is an EnvHttpProxyAgent, and global
// agents built with proxyEnv. The safety chain's fetch stand-in cannot read
// the Request objects the backstop's fetch hook hands on, so fetch through the
// global dispatcher is driven with npm undici's fetch, which reads the same
// global dispatcher; https.request is forbidden by the chain, so the
// https-proxy-agent case uses http.request. The real backstop sits above the
// safety chain.
backstop.installNodeBackstop();
const flags = { sealed: false };
test.beforeEach(() => {
  flags.sealed = false;
  gate._resetForTests();
  gate.configureEgress({
    isSealed: () => flags.sealed,
    recorder: new FlightRecorder({ now: () => 1 }),
    now: () => 1,
  });
});

function listener(reply) {
  const state = { bytes: 0, connections: 0, server: null, port: 0, sockets: new Set() };
  state.server = net.createServer((socket) => {
    state.connections++;
    state.sockets.add(socket);
    socket.on("error", () => {});
    let head = "";
    socket.on("data", (chunk) => {
      state.bytes += chunk.length;
      head += chunk.toString("latin1");
      if (head.includes("\r\n\r\n")) socket.end(reply);
    });
  });
  return state;
}
const proxy = listener(
  "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
);
const service = listener("HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
test.before(async () => {
  for (const owned of [proxy, service]) {
    await new Promise((resolve) => owned.server.listen(0, "127.0.0.1", resolve));
    owned.port = owned.server.address().port;
  }
});
test.after(async () => {
  for (const owned of [proxy, service]) {
    for (const socket of owned.sockets) socket.destroy();
    await new Promise((resolve) => owned.server.close(resolve));
  }
});

const ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"];
const GLOBAL_DISPATCHER = Symbol.for("undici.globalDispatcher.1");
// Sets the proxy environment (and, for Node's own env-proxy mode, the global
// dispatcher and agents) for one test, and restores all of it afterwards.
function withProxyEnv(t, { noProxy, nodeEnvProxy = false } = {}) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const savedDispatcher = globalThis[GLOBAL_DISPATCHER];
  const savedAgents = [http.globalAgent, https.globalAgent];
  const url = `http://127.0.0.1:${proxy.port}`;
  process.env.HTTP_PROXY = url;
  process.env.HTTPS_PROXY = url;
  delete process.env.ALL_PROXY;
  if (noProxy) process.env.NO_PROXY = noProxy;
  else delete process.env.NO_PROXY;
  if (nodeEnvProxy) {
    globalThis[GLOBAL_DISPATCHER] = new undici.EnvHttpProxyAgent();
    http.globalAgent = new http.Agent({ proxyEnv: { ...process.env } });
    https.globalAgent = new https.Agent({ proxyEnv: { ...process.env } });
  }
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalThis[GLOBAL_DISPATCHER] = savedDispatcher;
    [http.globalAgent, https.globalAgent] = savedAgents;
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Runs one request and reports how it ended and how many bytes each listener got.
async function attempt(run) {
  const before = { proxy: proxy.bytes, service: service.bytes };
  let error = null;
  let status = null;
  try {
    status = await run();
  } catch (caught) {
    error = caught;
  }
  await sleep(30);
  return {
    error,
    status,
    refused: isSealedModeError(error),
    proxyBytes: proxy.bytes - before.proxy,
    serviceBytes: service.bytes - before.service,
  };
}
const nodeRequest = (client, options) =>
  new Promise((resolve, reject) => {
    const req = client.request(options, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
const fetchStatus = async (url, init) => {
  const res = await undici.fetch(url, init);
  await res.arrayBuffer();
  return res.status;
};
const undiciStatus = async (url, dispatcher) => {
  const res = await undici.request(url, { dispatcher });
  await res.body.dump();
  return res.statusCode;
};

test("sealed: undici's EnvHttpProxyAgent cannot carry a remote request to the environment proxy", async (t) => {
  withProxyEnv(t);
  flags.sealed = true;
  const result = await attempt(() =>
    undiciStatus("http://remote.example/", new undici.EnvHttpProxyAgent())
  );
  assert.equal(result.refused, true, String(result.error));
  assert.equal(result.proxyBytes, 0, "the proxy received nothing");
});

test("sealed: an explicit undici ProxyAgent is refused, with fetch or undici.request", async (t) => {
  withProxyEnv(t);
  delete process.env.HTTP_PROXY; // only the agent names the proxy
  delete process.env.HTTPS_PROXY;
  flags.sealed = true;
  const agent = new undici.ProxyAgent(`http://127.0.0.1:${proxy.port}`);
  const viaRequest = await attempt(() => undiciStatus("http://remote.example/", agent));
  assert.equal(viaRequest.refused, true, String(viaRequest.error));
  const viaFetch = await attempt(() =>
    fetchStatus(`http://127.0.0.1:${service.port}/`, { dispatcher: agent })
  );
  assert.equal(viaFetch.refused, true, String(viaFetch.error));
  assert.equal(viaRequest.proxyBytes + viaFetch.proxyBytes, 0, "the proxy received nothing");
  assert.equal(viaFetch.serviceBytes, 0);
});

test("sealed, NODE_USE_ENV_PROXY: fetch through the global dispatcher never reaches the proxy", async (t) => {
  withProxyEnv(t, { nodeEnvProxy: true });
  flags.sealed = true;
  const remote = await attempt(() => fetchStatus("http://remote.example/"));
  assert.equal(remote.refused, true, String(remote.error));
  const local = await attempt(() => fetchStatus(`http://127.0.0.1:${service.port}/`));
  assert.equal(local.refused, true, String(local.error));
  assert.equal(remote.proxyBytes + local.proxyBytes, 0, "the proxy received nothing");
});

test("sealed, NODE_USE_ENV_PROXY: Node's own http agent never reaches the proxy", async (t) => {
  withProxyEnv(t, { nodeEnvProxy: true });
  flags.sealed = true;
  const result = await attempt(() =>
    nodeRequest(http, { host: "127.0.0.1", port: service.port, path: "/" })
  );
  assert.equal(result.refused, true, String(result.error));
  assert.equal(result.proxyBytes, 0, "the proxy received nothing");
  assert.equal(result.serviceBytes, 0);
});

test("sealed: a per-SDK proxy agent (https-proxy-agent, as gaxios builds) is refused", async (t) => {
  withProxyEnv(t);
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  flags.sealed = true;
  const agent = new HttpsProxyAgent(`http://127.0.0.1:${proxy.port}`);
  const result = await attempt(() =>
    nodeRequest(http, { host: "127.0.0.1", port: service.port, path: "/", agent })
  );
  assert.equal(result.refused, true, String(result.error));
  assert.equal(result.proxyBytes, 0, "the proxy received nothing");
});

test("sealed: a request NO_PROXY sends direct still goes direct", async (t) => {
  withProxyEnv(t, { noProxy: "127.0.0.1", nodeEnvProxy: true });
  flags.sealed = true;
  const result = await attempt(() => fetchStatus(`http://127.0.0.1:${service.port}/`));
  assert.equal(result.error, null, String(result.error));
  assert.equal(result.status, 204);
  assert.equal(result.proxyBytes, 0);
  assert.ok(result.serviceBytes > 0, "the service answered directly");
});

test("sealed: the refusal is a typed proxy refusal and is counted", async (t) => {
  withProxyEnv(t, { nodeEnvProxy: true });
  flags.sealed = true;
  const before = backstop.status().proxyRefusals;
  const result = await attempt(() => fetchStatus(`http://127.0.0.1:${service.port}/`));
  let error = result.error;
  while (error && !error.details) error = error.cause;
  assert.equal(error?.details?.reason, "proxy");
  assert.equal(error?.details?.phase, "refused");
  assert.ok(backstop.status().proxyRefusals > before);
});

test("unsealed: the same requests still use the proxy (behaviour unchanged)", async (t) => {
  withProxyEnv(t, { nodeEnvProxy: true });
  const viaUndici = await attempt(() =>
    undiciStatus("http://remote.example/", new undici.EnvHttpProxyAgent())
  );
  assert.equal(viaUndici.refused, false, String(viaUndici.error));
  assert.ok(viaUndici.proxyBytes > 0, "undici used the proxy");
  const viaFetch = await attempt(() => fetchStatus(`http://127.0.0.1:${service.port}/`));
  assert.equal(viaFetch.refused, false, String(viaFetch.error));
  assert.ok(viaFetch.proxyBytes > 0, "fetch used the proxy");
  const viaHttp = await attempt(() =>
    nodeRequest(http, { host: "127.0.0.1", port: service.port, path: "/" })
  );
  assert.equal(viaHttp.refused, false, String(viaHttp.error));
  assert.equal(viaHttp.status, 502, "the proxy answered");
  assert.ok(viaHttp.proxyBytes > 0, "Node's agent used the proxy");
});
