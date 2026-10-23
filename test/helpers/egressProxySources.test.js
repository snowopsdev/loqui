const assert = require("node:assert/strict");
const net = require("node:net");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");

// Review M-1/M-2 (D-5): every proxy source the threat model names is caught
// with NO proxy environment variable set, so nothing here can pass because
// HTTP_PROXY happens to name the same listener. Each case gets its own
// "proxy": a listener this file owns on an exact 127.0.0.1 port (port 0,
// read back), which answers like a keep-alive forward proxy (and accepts
// CONNECT) and counts every byte it receives. Targets are remote names that
// are never resolved: only the proxy is ever connected to.
const PROXY_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "NODE_USE_ENV_PROXY",
];
for (const key of PROXY_KEYS)
  assert.equal(process.env[key], undefined, `${key} must not be set for this file`);

const undici6 = require("undici");
const undici7 = require(
  path.join(__dirname, "../../node_modules/@ai-sdk/provider-utils/node_modules/undici")
);
const { HttpProxyAgent } = require("http-proxy-agent");
const { HttpsProxyAgent } = require("https-proxy-agent");
const gate = require("../../src/helpers/privacy/egressGate");
const backstop = require("../../src/helpers/privacy/egressBackstop");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError } = require("../../src/helpers/privacy/egressPolicy");

assert.match(undici6.Agent.name, /Agent/);
assert.notEqual(undici6, undici7, "two undici copies, as in the dependency tree");

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
// What the seal transition does to Node sockets (privacyBoot apply(true)).
function seal() {
  flags.sealed = true;
  backstop.severAll();
}

const OK = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nok";
async function ownedProxy(t) {
  const state = { bytes: 0, connections: 0, port: 0 };
  const sockets = new Set();
  const server = net.createServer((socket) => {
    state.connections++;
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    let pending = "";
    socket.on("data", (chunk) => {
      state.bytes += chunk.length;
      pending += chunk.toString("latin1");
      let end;
      while ((end = pending.indexOf("\r\n\r\n")) >= 0) {
        const head = pending.slice(0, end);
        pending = pending.slice(end + 4);
        socket.write(
          head.startsWith("CONNECT ") ? "HTTP/1.1 200 Connection Established\r\n\r\n" : OK
        );
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.port = server.address().port;
  state.url = `http://127.0.0.1:${state.port}`;
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return state;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function causeChain(error) {
  for (let e = error, i = 0; e && i < 5; e = e.cause, i++) if (isSealedModeError(e)) return e;
  return null;
}
async function attempt(proxy, run) {
  const before = proxy.bytes;
  let error = null;
  let status = null;
  try {
    status = await run();
  } catch (caught) {
    error = caught;
  }
  await sleep(30);
  const sealedError = causeChain(error);
  return {
    error,
    status,
    refused: !!sealedError,
    reason: sealedError?.details?.reason ?? null,
    proxyBytes: proxy.bytes - before,
  };
}
const nodeGet = (url, agent) =>
  new Promise((resolve, reject) => {
    const req = http.request(url, { method: "POST", agent }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end("sealed-content");
  });
const undiciPost = (undici, dispatcher) => async (url) => {
  const res = await undici.request(url, { method: "POST", body: "sealed-content", dispatcher });
  await res.body.dump();
  return res.statusCode;
};
function assertRefused(result, label) {
  assert.equal(result.refused, true, `${label}: ${String(result.error)} (status ${result.status})`);
  assert.equal(result.proxyBytes, 0, `${label}: the proxy received nothing`);
}

// One entry per source: how to build the client for a proxy, and how to send.
const SOURCES = [
  {
    name: "a Node agent built with proxyEnv (not mirrored in process.env)",
    client: (proxy) => {
      const agent = new http.Agent({ keepAlive: true, proxyEnv: { HTTP_PROXY: proxy.url } });
      return (url) => nodeGet(url, agent);
    },
  },
  {
    name: "http-proxy-agent (agent-base, forward mode)",
    client: (proxy) => {
      const agent = new HttpProxyAgent(proxy.url, { keepAlive: true });
      return (url) => nodeGet(url, agent);
    },
  },
  {
    name: "https-proxy-agent (agent-base, CONNECT)",
    client: (proxy) => {
      const agent = new HttpsProxyAgent(proxy.url);
      return (url) => nodeGet(url, agent);
    },
  },
  ...[
    ["undici 6", undici6],
    ["undici 7", undici7],
  ].flatMap(([label, undici]) => [
    {
      name: `${label} ProxyAgent, CONNECT tunnel`,
      client: (proxy) => undiciPost(undici, new undici.ProxyAgent(proxy.url)),
    },
    {
      name: `${label} ProxyAgent, forward mode (proxyTunnel: false)`,
      client: (proxy) =>
        undiciPost(undici, new undici.ProxyAgent({ uri: proxy.url, proxyTunnel: false })),
    },
    {
      name: `${label} EnvHttpProxyAgent with an explicit httpProxy`,
      client: (proxy) => undiciPost(undici, new undici.EnvHttpProxyAgent({ httpProxy: proxy.url })),
    },
  ]),
];

for (const source of SOURCES) {
  test(`no proxy env, sealed: ${source.name} cannot carry a remote request to its proxy`, async (t) => {
    const proxy = await ownedProxy(t);
    const service = await ownedProxy(t); // an owned loopback target, never reached
    const send = source.client(proxy);
    flags.sealed = true;
    const remote = await attempt(proxy, () => send("http://remote.example/sealed"));
    assertRefused(remote, `${source.name}, remote target`);
    // A loopback target names no remote host, so only the proxy rule stops it.
    const local = await attempt(proxy, () => send(`${service.url}/sealed`));
    assertRefused(local, `${source.name}, loopback target`);
    assert.equal(local.reason, "proxy");
    assert.equal(service.bytes, 0, "the target was never contacted either");
  });

  test(`no proxy env: ${source.name} pooled before the seal carries nothing after it`, async (t) => {
    const proxy = await ownedProxy(t);
    const service = await ownedProxy(t);
    const send = source.client(proxy);
    // The safety chain allows only owned loopback targets, so the unsealed
    // request names the owned service; the proxy answers it.
    const unsealed = await attempt(proxy, () => send(`${service.url}/open`));
    assert.equal(unsealed.error, null, `unsealed is unchanged: ${String(unsealed.error)}`);
    assert.equal(unsealed.status, 200, "the proxy answered");
    assert.ok(unsealed.proxyBytes > 0);
    seal();
    assertRefused(
      await attempt(proxy, () => send("http://remote.example/sealed")),
      `${source.name}, remote target`
    );
    assertRefused(
      await attempt(proxy, () => send(`${service.url}/sealed`)),
      `${source.name}, loopback target`
    );
    assert.equal(service.bytes, 0, "the target was never contacted");
  });
}

test("no proxy env, sealed: undici's global dispatcher set to a forward-mode ProxyAgent is refused", async (t) => {
  const proxy = await ownedProxy(t);
  const key = Symbol.for("undici.globalDispatcher.1");
  const saved = globalThis[key];
  t.after(() => {
    globalThis[key] = saved;
  });
  globalThis[key] = new undici7.ProxyAgent({ uri: proxy.url, proxyTunnel: false });
  flags.sealed = true;
  const result = await attempt(proxy, async () => {
    const res = await undici7.fetch("http://remote.example/sealed", {
      method: "POST",
      body: "sealed-content",
    });
    await res.arrayBuffer();
    return res.status;
  });
  assertRefused(result, "global dispatcher");
});

test("sealing severs a pooled socket to a known proxy, and leaves other loopback sockets alone", async (t) => {
  const proxy = await ownedProxy(t);
  const plain = await ownedProxy(t); // a loopback service no proxy setting names
  const agent = new http.Agent({ keepAlive: true, proxyEnv: { HTTP_PROXY: proxy.url } });
  const direct = new http.Agent({ keepAlive: true });
  assert.equal((await attempt(proxy, () => nodeGet(`${plain.url}/`, agent))).status, 200);
  assert.equal(
    (await attempt(plain, () => nodeGet(`${plain.url}/`, direct))).status,
    200,
    "a plain loopback keep-alive socket"
  );
  const pooled = (a) => Object.values(a.freeSockets).flat();
  assert.equal(pooled(agent).length, 1);
  assert.equal(pooled(direct).length, 1);
  seal();
  await sleep(30);
  assert.equal(pooled(agent).length, 0, "the proxy socket is gone");
  assert.equal(pooled(direct).length, 1, "a loopback service socket is kept");
  direct.destroy();
  agent.destroy();
});
