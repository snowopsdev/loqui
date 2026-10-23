const assert = require("node:assert/strict");
const net = require("node:net");
const http = require("node:http");
const test = require("node:test");
const gate = require("../../src/helpers/privacy/egressGate");
const backstop = require("../../src/helpers/privacy/egressBackstop");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError } = require("../../src/helpers/privacy/egressPolicy");

// Task 18 re-review T18R-01 and fix-wave re-review m4: while sealed, a request
// to a loopback server is refused when the bytes Node's HTTP client would send
// name another host, whichever way the request was built. Everything here runs
// on the wire against one listener this file owns on 127.0.0.1 (port 0). The
// listener records the request head it receives and forwards nothing. No
// transport leaf is stubbed: the real backstop sits above the safety chain.
backstop.installNodeBackstop();
const flags = { sealed: false };
let recorder;
test.beforeEach(() => {
  flags.sealed = false;
  gate._resetForTests();
  recorder = new FlightRecorder({ now: () => 1 });
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now: () => 1 });
});

let server;
let PORT;
const heads = [];
const sockets = new Set();
test.before(async () => {
  server = net.createServer((socket) => {
    sockets.add(socket);
    let buffer = "";
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const lines = buffer.slice(0, end).split("\r\n");
      heads.push({ line: lines[0], hosts: lines.filter((l) => /^host\s*:/i.test(l)) });
      socket.end("HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  PORT = server.address().port;
});
test.after(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Builds a request, ends it, and reports whether it was refused and what (if
// anything) reached the owned listener.
async function attempt(make, { end = true } = {}) {
  const before = heads.length;
  let error = null;
  let req;
  try {
    req = make();
    req?.on?.("error", (e) => (error ??= e));
    req?.on?.("response", (res) => res.resume());
    if (end) req?.end?.();
  } catch (e) {
    error = e;
  }
  for (let i = 0; i < 100 && heads.length === before && !error; i++) await sleep(5);
  await sleep(20);
  req?.destroy?.();
  return { refused: isSealedModeError(error), error, wire: heads.slice(before) };
}
const base = () => ({ host: "127.0.0.1", port: PORT, agent: new http.Agent() });
// Node's own URL duck typing (isURL): href and protocol, no auth, no path.
const urlLike = (extra = {}) => ({
  href: `http://127.0.0.1:${PORT}/`,
  protocol: "http:",
  hostname: "127.0.0.1",
  port: String(PORT),
  pathname: "/",
  search: "",
  hash: "",
  ...extra,
});
const expectRefused = (row, label) => {
  assert.equal(row.refused, true, `${label}: ${row.error?.message ?? "not refused"}`);
  assert.deepEqual(row.wire, [], `${label}: nothing reaches the listener`);
};

test("sealed: every p9 forwarding shape is refused before its head reaches the listener", async () => {
  flags.sealed = true;
  const rows = {
    "http.request CONNECT": () =>
      http.request({ ...base(), method: "CONNECT", path: "evil.example:443" }),
    "new ClientRequest CONNECT": () =>
      new http.ClientRequest({ ...base(), method: "CONNECT", path: "evil.example:443" }),
    "absolute-form": () => new http.ClientRequest({ ...base(), path: "http://evil.example/" }),
    "one-slash": () => new http.ClientRequest({ ...base(), path: "http:/evil.example/" }),
    "scheme-relative": () => new http.ClientRequest({ ...base(), path: "//evil.example/" }),
    "bare target": () => new http.ClientRequest({ ...base(), path: "evil.example/x" }),
    "Host header": () =>
      new http.ClientRequest({ ...base(), path: "/", headers: { Host: "evil.example" } }),
    "late setHeader Host": () => {
      const r = http.request({ ...base(), path: "/" });
      r.setHeader("Host", "evil.example");
      return r;
    },
    "URL string + CONNECT options": () =>
      http.request(`http://127.0.0.1:${PORT}/`, {
        agent: new http.Agent(),
        method: "CONNECT",
        path: "evil.example:443",
      }),
    "URL instance + CONNECT options": () =>
      http.request(new URL(`http://127.0.0.1:${PORT}/`), {
        agent: new http.Agent(),
        method: "CONNECT",
        path: "evil.example:443",
      }),
    "http.get absolute-form": () => http.get({ ...base(), path: "http://evil.example/" }),
    "removeHeader + appendHeader Host": () => {
      const r = http.request({ ...base(), path: "/" });
      r.removeHeader("Host");
      r.appendHeader("Host", "evil.example");
      return r;
    },
    // The residual shapes the re-review found reaching a loopback forwarder.
    "URL-like object + CONNECT options": () =>
      http.request(urlLike(), {
        agent: new http.Agent(),
        method: "CONNECT",
        path: "evil.example:443",
      }),
    "URL-like object, absolute pathname": () =>
      http.request(urlLike({ pathname: "http://evil.example/" }), { agent: new http.Agent() }),
    "URL-like object + Host header": () =>
      http.request(urlLike(), { agent: new http.Agent(), headers: { Host: "evil.example" } }),
    "new ClientRequest(URL-like, CONNECT)": () =>
      new http.ClientRequest(urlLike(), {
        agent: new http.Agent(),
        method: "CONNECT",
        path: "evil.example:443",
      }),
    "duplicate Host, object array value": () =>
      http.request({ ...base(), path: "/", headers: { Host: ["127.0.0.1", "evil.example"] } }),
    "duplicate Host, raw header array": () =>
      http.request({
        ...base(),
        path: "/",
        headers: ["Host", "127.0.0.1", "Host", "evil.example"],
      }),
    "appendHeader onto the automatic Host": () => {
      const r = http.request({ ...base(), path: "/" });
      r.appendHeader("Host", "evil.example");
      return r;
    },
    "require('_http_client').ClientRequest CONNECT": () =>
      new (require("_http_client").ClientRequest)({
        ...base(),
        method: "CONNECT",
        path: "evil.example:443",
      }),
    // What Node sends, not what the options said: fields changed afterwards.
    "path changed after construction": () => {
      const r = http.request({ ...base(), path: "/" });
      r.path = "http://evil.example/";
      return r;
    },
    "method changed after construction": () => {
      const r = http.request({ ...base(), path: "/" });
      r.method = "CONNECT";
      r.path = "evil.example:443";
      return r;
    },
  };
  for (const [label, make] of Object.entries(rows)) expectRefused(await attempt(make), label);
  // Each refusal is one blocked row naming the forwarded host.
  assert.ok(recorder.list().length >= Object.keys(rows).length);
  assert.ok(recorder.list().every((row) => row.outcome === "blocked"));
});

test("sealed: an origin-form request with a loopback Host still reaches the loopback server", async () => {
  flags.sealed = true;
  const plain = await attempt(() => http.request({ ...base(), path: "/v1/models" }));
  assert.equal(plain.refused, false);
  assert.deepEqual(plain.wire, [
    { line: "GET /v1/models HTTP/1.1", hosts: [`Host: 127.0.0.1:${PORT}`] },
  ]);
  const local = await attempt(() =>
    http.request(urlLike(), { agent: new http.Agent(), headers: { Host: "localhost:8080" } })
  );
  assert.equal(local.refused, false);
  assert.deepEqual(local.wire[0].hosts, ["Host: localhost:8080"]);
});

// m4: a request built before the seal and given a remote Host after it.
test("a request created unsealed is still judged when it names another host after the seal", async () => {
  const late = await attempt(
    () => {
      const r = http.request({ ...base(), path: "/" });
      flags.sealed = true;
      r.setHeader("Host", "evil.example");
      r.end();
      return r;
    },
    { end: false }
  );
  expectRefused(late, "setHeader after the seal");
  flags.sealed = false;
  const appended = await attempt(
    () => {
      const r = http.request({ ...base(), path: "/" });
      flags.sealed = true;
      r.appendHeader("Host", "evil.example");
      r.end();
      return r;
    },
    { end: false }
  );
  expectRefused(appended, "appendHeader after the seal");
});

test("unsealed: forwarding shapes are ordinary requests", async () => {
  const row = await attempt(() =>
    http.request({ ...base(), path: "/", headers: { Host: "evil.example" } })
  );
  assert.equal(row.refused, false);
  assert.deepEqual(row.wire[0].hosts, ["Host: evil.example"]);
});
