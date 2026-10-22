const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Writable } = require("node:stream");
const net = require("node:net");
const tls = require("node:tls");
const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns");
const dgram = require("node:dgram");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError, sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");

// The required preloaded chain remains installed. Only terminal transport and
// resolver leaves are simulated below it; no gate/backstop function is mocked.
// Numeric TCP/HTTP/fetch fixtures still pass through the chain's owned-port guard.
const leaves = [];
const socketLeaf = net.Socket.prototype.connect;
const socketDestinations = new Map();
net.Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  leaves.push({ kind: "socket", options });
  if (
    this instanceof net.Socket &&
    socketDestinations.has(Number(options?.port)) &&
    socketDestinations.get(Number(options?.port)) === options?.host
  ) {
    const physical = { ...options, host: "127.0.0.1", lookup: undefined };
    leaves.push({ kind: "physical", options: physical });
    const forwarded = Array.isArray(args[0])
      ? [[physical, ...args[0].slice(1)]]
      : [physical, ...args.slice(1)];
    return socketLeaf.apply(this, forwarded);
  }
  if (this instanceof net.Socket && options?.host === "127.0.0.1")
    return socketLeaf.apply(this, args);
  if (this instanceof net.Socket) process.nextTick(() => this.emit("connect"));
  return this;
};
tls.connect = function (...args) {
  const options = args[0];
  leaves.push({ kind: "tls", options });
  const socket = new net.Socket();
  return socket;
};
for (const [client, kind] of [
  [http, "http"],
  [https, "https"],
]) {
  const requestLeaf = client.request;
  client.request = function (...args) {
    const input = args[0];
    const url = typeof input === "string" || input instanceof URL ? new URL(input) : null;
    const options = {
      ...(url ? { host: url.hostname, port: url.port, path: url.pathname } : input),
      ...(url && typeof args[1] === "object" ? args[1] : {}),
    };
    leaves.push({ kind, options });
    if ((options.hostname ?? options.host) === "127.0.0.1") return requestLeaf.apply(this, args);
    const req = new Writable({
      write(_chunk, _encoding, cb) {
        cb();
      },
    });
    req.setHeader = () => {};
    req.getHeader = () => undefined;
    return req;
  };
  client.get = function (...args) {
    const req = client.request(...args);
    req.end();
    return req;
  };
}
const fetchLeaf = globalThis.fetch;
let fetchAnswer = async () => new Response(null, { status: 200 });
globalThis.fetch = function (input, init) {
  leaves.push({ kind: "fetch", input, init });
  if (new URL(input?.url ?? input).hostname === "127.0.0.1")
    return fetchLeaf(input.url ?? input, {
      method: input.method,
      headers: input.headers,
      signal: input.signal,
      ...init,
    });
  return fetchAnswer(input, init);
};
const DNS_ENTRY = /^(lookup|lookupService|resolve\w*|reverse)$/;
const dnsPending = [];
let dnsThrow = false;
const dnsTargets = [
  [dns, false],
  [dns.promises, true],
  [dns.Resolver.prototype, false],
  [dns.promises.Resolver.prototype, true],
];
for (const [target, promise] of dnsTargets) {
  for (const name of Object.getOwnPropertyNames(target).filter(
    (n) => DNS_ENTRY.test(n) && typeof target[n] === "function"
  )) {
    target[name] = function (...args) {
      leaves.push({ kind: "dns", name, args });
      if (dnsThrow) throw new TypeError("fixture resolver throw");
      // Server.listen(127.0.0.1) asks lookup even for its literal bind address.
      // Answer that exact literal in the mock; never invoke a resolver.
      if (name === "lookup" && args[0] === "127.0.0.1") {
        if (promise) return Promise.resolve({ address: "127.0.0.1", family: 4 });
        const cb = args.at(-1);
        process.nextTick(() =>
          args[1]?.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4)
        );
        return {};
      }
      if (promise) return new Promise((resolve, reject) => dnsPending.push({ resolve, reject }));
      const callback = args.at(-1);
      if (typeof callback !== "function") throw new TypeError("callback required");
      dnsPending.push({
        resolve: (...values) => callback(null, ...values),
        reject: (e) => callback(e),
      });
      return {};
    };
  }
}
const udpPorts = new Set();
for (const method of ["send", "connect"]) {
  const original = dgram.Socket.prototype[method];
  dgram.Socket.prototype[method] = function (...args) {
    leaves.push({ kind: `udp.${method}`, args });
    const address = method === "send" ? args.slice(1).find((v) => typeof v === "string") : args[1];
    const port = method === "send" ? args[1] : args[0];
    if (address === "127.0.0.1" && udpPorts.has(port)) return original.apply(this, args);
    const cb = args.at(-1);
    if (typeof cb === "function") process.nextTick(cb, null);
    return undefined;
  };
}
const backstop = require("../../src/helpers/privacy/egressBackstop");
backstop.installNodeBackstop();
const flags = { sealed: false };
let recorder;
test.beforeEach(() => {
  leaves.length = 0;
  dnsThrow = false;
  assert.equal(dnsPending.length, 0);
  flags.sealed = false;
  gate._resetForTests();
  recorder = new FlightRecorder({ now: () => 1 });
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now: () => 1 });
  fetchAnswer = async () => new Response(null, { status: 200 });
});
const once = (emitter, event) => new Promise((resolve) => emitter.once(event, resolve));
class SocketFixture extends EventEmitter {
  bytesWritten = 3;
  bytesRead = 2;
  destroyed = false;
  destroy(error) {
    this.destroyed = true;
    this.reason = error;
    return this;
  }
}
const connectFixture = (options, socket = new SocketFixture()) => {
  net.Socket.prototype.connect.call(socket, options);
  return socket;
};
const ticketFor = (extra = {}) =>
  gate.authorize({ task: "chat", target: "https://api.example", ...extra });
function session() {
  const listeners = {};
  const webRequest = {};
  for (const name of [
    "onBeforeRequest",
    "onBeforeSendHeaders",
    "onBeforeRedirect",
    "onCompleted",
    "onErrorOccurred",
  ])
    webRequest[name] = (fn) => {
      assert.equal(listeners[name], undefined);
      listeners[name] = fn;
    };
  const s = { listeners, webRequest };
  backstop.watchSession(s);
  return s;
}
let requestId = 0;
const before = (s, url, id = ++requestId, webContentsId = 7) => {
  let verdict;
  s.listeners.onBeforeRequest({ id, url, webContentsId }, (v) => {
    verdict = v;
  });
  return { id, ...verdict };
};
const headers = (s, id, requestHeaders) => {
  let verdict;
  s.listeners.onBeforeSendHeaders({ id, requestHeaders }, (v) => {
    verdict = v;
  });
  return verdict;
};

for (const [name, run] of [
  [
    "raw TCP",
    () => {
      const s = new net.Socket();
      const error = once(s, "error");
      s.connect({
        host: "remote.invalid",
        port: 443,
        lookup() {
          throw new Error("lookup reached");
        },
      });
      return error;
    },
  ],
  ["TLS", () => once(tls.connect({ host: "remote.invalid", port: 443 }), "error")],
  [
    "https.request",
    () => {
      const r = https.request("https://remote.invalid/");
      const e = once(r, "error");
      r.end();
      return e;
    },
  ],
  ["http.get", () => once(http.get("http://remote.invalid/"), "error")],
  [
    "fetch",
    async () => {
      try {
        await fetch("https://remote.invalid/");
      } catch (e) {
        return e;
      }
    },
  ],
  ["ws", () => once(new (require("ws"))("wss://remote.invalid/stream"), "error")],
])
  test(`sealed ${name} refuses before the terminal leaf`, async () => {
    flags.sealed = true;
    const error = await run();
    assert.ok(isSealedModeError(error));
    assert.equal(sealedPhaseOf(error), "refused");
    assert.equal(leaves.length, 0);
    assert.equal(recorder.list()[0].outcome, "blocked");
  });

test("default supplier fails closed, malformed destinations fail sealed", async () => {
  gate._resetForTests();
  assert.equal(backstop.judgeChromiumRequest("https://remote.invalid/").cancel, true);
  for (const host of ["127.1", "0177.0.0.1", "bad host", "localhost/remote"]) {
    const socket = connectFixture({ host, port: 443 });
    await new Promise((r) => process.nextTick(r));
    assert.ok(isSealedModeError(socket.reason));
  }
  assert.equal(leaves.length, 0);
});

test("localhost overloads pin the physical numeric destination and override hostile lookup", () => {
  flags.sealed = true;
  const hostile = () => {
    throw new Error("custom lookup reached");
  };
  for (const host of ["localhost", "app.localhost", "LOCALHOST."]) {
    for (const family of [4, 6]) {
      connectFixture({ host, port: 12345, family, lookup: hostile });
      assert.equal(leaves.at(-1).options.host, family === 6 ? "::1" : "127.0.0.1");
      assert.notEqual(leaves.at(-1).options.lookup, hostile);
    }
  }
  const s = new SocketFixture();
  net.Socket.prototype.connect.call(s, 12345, "app.localhost");
  assert.equal(leaves.at(-1).options.host, "127.0.0.1");
  net.Socket.prototype.connect.call(s, [{ host: "app.localhost", port: 12345 }, () => {}]);
  assert.equal(leaves.at(-1).options.host, "127.0.0.1");
  assert.equal(recorder.list().length, 0);
});

test("TLS preserves SNI while pinning localhost, supplied socket cannot exempt a remote target", async () => {
  flags.sealed = true;
  const local = tls.connect({
    host: "app.localhost",
    port: 443,
    family: 4,
    lookup() {
      throw new Error("hostile");
    },
  });
  assert.equal(leaves[0].options.host, "127.0.0.1");
  assert.equal(leaves[0].options.servername, "app.localhost");
  local.destroy();
  leaves.length = 0;
  const remote = tls.connect({ host: "remote.invalid", port: 443, socket: new net.Socket() });
  assert.ok(isSealedModeError(await once(remote, "error")));
  assert.equal(leaves.length, 0);
});

test("real numeric owned TCP, HTTP and fetch remain usable while sealed", async (t) => {
  flags.sealed = true;
  const server = http.createServer((_req, res) => res.end("local"));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const port = server.address().port;
  const socket = net.connect({ host: "127.0.0.1", port });
  await once(socket, "connect");
  assert.equal(backstop.severAll(), 0);
  assert.equal(socket.destroyed, false);
  const closed = once(socket, "close");
  socket.destroy();
  await closed;
  const body = await new Promise((resolve, reject) =>
    http
      .get({ host: "127.0.0.1", port }, (r) => {
        let data = "";
        r.on("data", (c) => {
          data += c;
        });
        r.on("end", () => resolve(data));
      })
      .on("error", reject)
  );
  assert.equal(body, "local");
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), "local");
  assert.equal(recorder.list().length, 0);
});

for (const [clientName, client] of [
  ["http", http],
  ["https", https],
]) {
  for (const method of ["request", "get"])
    test(`${clientName}.${method} blocks proxy CONNECT/absolute-form before dispatch`, async () => {
      flags.sealed = true;
      for (const options of [
        { host: "localhost", method: "CONNECT", path: "api.example:443" },
        { host: "127.0.0.1", path: "http://api.example/a" },
        { host: "127.0.0.1", method: "CONNECT", path: "malformed/target" },
        { host: "127.0.0.1", path: "http://127.1/a" },
      ]) {
        const req = client[method](options);
        const error = once(req, "error");
        if (method === "request") req.end();
        assert.ok(isSealedModeError(await error));
      }
      assert.equal(leaves.length, 0);
    });
}

test("fetch checks actual redirect hops and retains interruption semantics and effective signal", async () => {
  const ticket = ticketFor();
  const caller = new AbortController();
  fetchAnswer = async (_input, init) => {
    assert.equal(init.redirect, "manual");
    assert.equal(init.signal.aborted, false);
    flags.sealed = true;
    return new Response(null, { status: 302, headers: { location: "https://next.example/b" } });
  };
  await assert.rejects(
    gate.runWithTicket(ticket, () => fetch("https://api.example/a", { signal: caller.signal })),
    isSealedModeError
  );
  assert.equal(leaves.filter((l) => l.kind === "fetch").length, 1);
  assert.equal(sealedPhaseOf(ticket.signal.reason), "interrupted");
  ticket.settle({ outcome: "cancelled" });
  const row = recorder.list()[0];
  assert.equal(row.outcome, "cancelled");
  assert.equal(row.bytesOut, null);
  assert.deepEqual(row.hosts, ["api.example", "next.example"]);
});

test("sockets are context-only attributed, count through settlement and sever until observed close", () => {
  const ticket = ticketFor();
  const owned = gate.runWithTicket(ticket, () =>
    connectFixture({ host: "edge.example", port: 443 })
  );
  const unexplained = connectFixture({ host: "api.example", port: 443 });
  const local = connectFixture({ host: "127.0.0.1", port: 123 });
  assert.equal(backstop.status().openRemoteSockets, 2);
  ticket.settle({ outcome: "ok" });
  assert.equal(gate.activeRemoteCount(), 1);
  assert.equal(backstop.severAll(), 2);
  assert.equal(backstop.status().openRemoteSockets, 2);
  assert.equal(local.destroyed, false);
  owned.emit("close", false);
  assert.equal(gate.activeRemoteCount(), 0);
  unexplained.emit("close", true);
  const row = recorder.list().find((r) => r.attributed === false);
  assert.deepEqual(
    [row.host, row.kind, row.bytesOut, row.bytesIn, row.outcome],
    ["api.example", "connection", 3, 2, "error"]
  );
  assert.equal(backstop.status().openRemoteSockets, 0);
});

test("socket meters settle on real close and preauthorized sockets are interrupted after seal", async () => {
  const ticket = ticketFor({ meter: "socket" });
  const socket = gate.runWithTicket(ticket, () =>
    connectFixture({ host: "edge.example", port: 443 })
  );
  ticket.settle({ outcome: "ok" });
  assert.equal(recorder.list().length, 0);
  socket.emit("close", false);
  assert.deepEqual([recorder.list()[0].bytesOut, recorder.list()[0].bytesIn], [3, 2]);
  const other = ticketFor();
  flags.sealed = true;
  const denied = gate.runWithTicket(other, () =>
    connectFixture({ host: "api.example", port: 443 })
  );
  await new Promise((r) => process.nextTick(r));
  assert.equal(sealedPhaseOf(denied.reason), "interrupted");
  other.discard();
});

for (const [index, [target, promise]] of dnsTargets.entries()) {
  const names = Object.getOwnPropertyNames(target).filter(
    (n) => DNS_ENTRY.test(n) && typeof target[n] === "function"
  );
  test(`all DNS API leaves ${index} refuse sealed remote names without dispatch`, async () => {
    flags.sealed = true;
    const resolver =
      index === 2 ? new dns.Resolver() : index === 3 ? new dns.promises.Resolver() : target;
    assert.ok(names.length >= 10);
    for (const name of names) {
      assert.equal(target[name].__loquiEgress, true, name);
      const args =
        name === "lookupService"
          ? ["192.0.2.1", 443]
          : [name === "reverse" ? "192.0.2.1" : "remote.invalid"];
      if (promise) await assert.rejects(resolver[name](...args), isSealedModeError);
      else assert.ok(isSealedModeError(await new Promise((r) => resolver[name](...args, r))), name);
    }
    assert.equal(leaves.length, 0);
    assert.equal(backstop.status().pendingDns, 0);
  });
  test(`all DNS APIs ${index} count exact pending lifetime across seal and error`, async () => {
    for (const name of names) {
      flags.sealed = false;
      const resolver =
        index === 2 ? new dns.Resolver() : index === 3 ? new dns.promises.Resolver() : target;
      const args = name === "lookupService" ? ["127.0.0.1", 22] : ["fixture.invalid"];
      const pending = promise
        ? resolver[name](...args).catch((e) => e)
        : new Promise((r) => resolver[name](...args, r));
      assert.equal(backstop.status().pendingDns, 1, name);
      flags.sealed = true;
      assert.equal(backstop.status().pendingDns, 1);
      dnsPending.shift().reject(Object.assign(new Error("fixture"), { code: "ECANCELLED" }));
      await pending;
      assert.equal(backstop.status().pendingDns, 0, name);
    }
  });
}

test("DNS throws, missing callbacks and duplicate callbacks decrement exactly once", () => {
  dnsThrow = true;
  assert.throws(() => dns.resolve4("fixture.invalid", () => {}));
  assert.equal(backstop.status().pendingDns, 0);
  dnsThrow = false;
  assert.throws(() => dns.lookup("fixture.invalid"));
  assert.equal(backstop.status().pendingDns, 0);
  dns.lookup("fixture.invalid", () => {});
  const entry = dnsPending.shift();
  entry.resolve("127.0.0.1", 4);
  entry.resolve("127.0.0.1", 4);
  assert.equal(backstop.status().pendingDns, 0);
});

test("sealed DNS local answers never call native resolver, including numeric family and service", async () => {
  flags.sealed = true;
  assert.deepEqual(await dns.promises.lookup("app.localhost", 6), { address: "::1", family: 6 });
  assert.deepEqual(await dns.promises.lookup("localhost", { all: true, family: 4 }), [
    { address: "127.0.0.1", family: 4 },
  ]);
  assert.deepEqual(await dns.promises.lookup("127.0.0.2"), { address: "127.0.0.2", family: 4 });
  assert.deepEqual(await dns.promises.lookupService("127.0.0.1", 22), {
    hostname: "localhost",
    service: "22",
  });
  assert.ok(isSealedModeError(await new Promise((r) => dns.lookupService("localhost", 22, r))));
  assert.equal(leaves.length, 0);
  assert.equal(backstop.status().pendingDns, 0);
});

test("UDP remote send/connect are refused; alias overloads pin numeric destination", async () => {
  flags.sealed = true;
  const s = dgram.createSocket("udp4");
  assert.ok(
    isSealedModeError(await new Promise((r) => s.send(Buffer.from("x"), 53, "192.0.2.1", r)))
  );
  assert.ok(isSealedModeError(await once((s.connect(53, "192.0.2.1"), s), "error")));
  assert.equal(leaves.length, 0);
  await new Promise((r) => s.send(Buffer.from("x"), 53, "app.localhost", r));
  assert.equal(leaves.at(-1).args[2], "127.0.0.1");
  await new Promise((r) => s.send(Buffer.from("x"), 0, 1, 53, "localhost", r));
  assert.equal(leaves.at(-1).args[4], "127.0.0.1");
});

test("numeric UDP fixture sends only to its own bound endpoint", async (t) => {
  flags.sealed = true;
  const receiver = dgram.createSocket("udp4");
  const sender = dgram.createSocket("udp4");
  await new Promise((r) => receiver.bind(0, "127.0.0.1", r));
  const port = receiver.address().port;
  udpPorts.add(port);
  t.after(() => {
    udpPorts.delete(port);
    receiver.close();
    sender.close();
  });
  const got = once(receiver, "message");
  sender.send(Buffer.from("local"), port, "127.0.0.1");
  assert.equal(String(await got), "local");
});

test("Chromium schemes, loopback, malformed targets and observer veto use actual registered handlers", () => {
  const s = session();
  backstop.watchSession(s);
  flags.sealed = true;
  for (const url of [
    "file:///tmp/fixture",
    "devtools://devtools/index",
    "data:text/plain,hi",
    "http://localhost/a",
    "http://127.0.0.1/a",
  ])
    assert.equal(before(s, url).cancel, false);
  for (const url of [
    "https://api.example/a",
    "unparseable",
    "https://127.1/a",
    "ftp://remote.invalid/a",
  ])
    assert.equal(before(s, url).cancel, true);
  flags.sealed = false;
  const off = backstop.addObserver((e) => e.layer === "chromium" && e.host === "api.example");
  assert.equal(before(s, "https://api.example/a").cancel, true);
  off();
  const id = before(s, "https://api.example/a").id;
  s.listeners.onCompleted({ id, statusCode: 200 });
});

for (const end of ["onCompleted", "onErrorOccurred"]) {
  for (const tagKind of ["none", "ticket", "attempt"])
    test(`Chromium ${tagKind} redirect cancellation retains evidence through settlement until ${end}`, () => {
      const s = session();
      const ticket = tagKind === "none" ? null : ticketFor();
      const owner = tagKind === "attempt" ? ticket.beginAttempt("api.example") : ticket;
      const base = backstop.status().chromiumInFlightRemote;
      const id = before(s, "https://api.example/a").id;
      const stripped = headers(s, id, {
        Accept: "*/*",
        "X-Loqui-Egress": owner?.tag ?? "invalid",
        "x-loqui-egress": owner?.tag ?? "invalid",
      });
      assert.deepEqual(stripped.requestHeaders, { Accept: "*/*" });
      ticket?.settle({ outcome: "ok" });
      if (owner) assert.ok(gate.ticketByTag(owner.tag));
      flags.sealed = true;
      s.listeners.onBeforeRedirect({ id, statusCode: 302, redirectURL: "https://next.example/b" });
      assert.equal(before(s, "https://next.example/b", id).cancel, true);
      assert.equal(backstop.status().chromiumInFlightRemote, base + 1);
      if (ticket) assert.equal(sealedPhaseOf(ticket.signal.reason), "interrupted");
      if (tagKind === "attempt") owner.settle({ outcome: "cancelled", errorClass: "SEALED_MODE" });
      s.listeners[end]({ id, statusCode: 200, error: "net::ERR_BLOCKED_BY_CLIENT" });
      s.listeners.onErrorOccurred({ id });
      assert.equal(backstop.status().chromiumInFlightRemote, base);
      if (ticket) {
        ticket.discard();
        assert.equal(gate.activeRemoteCount(), 0);
      }
      const row = recorder.list().find((r) => r.kind === "request");
      assert.equal(row.outcome, "cancelled");
      assert.equal(row.bytesOut, null);
      assert.deepEqual(row.hosts, ["api.example", "next.example"]);
    });
}

for (const code of [200, 404, 503])
  test(`Chromium operation tags create per-request attempts and preserve HTTP ${code}`, () => {
    const s = session();
    const ticket = ticketFor();
    const id = before(s, "https://api.example/a").id;
    headers(s, id, { [gate.EGRESS_TAG_HEADER]: ticket.tag });
    ticket.settle({ outcome: "ok" });
    assert.equal(gate.activeRemoteCount(), 1);
    s.listeners.onCompleted({ id, statusCode: code });
    const rows = recorder.list();
    assert.equal(rows.length, 1);
    assert.deepEqual(
      [rows[0].outcome, rows[0].status, rows[0].errorClass],
      [
        code >= 400 ? "error" : "ok",
        code,
        code >= 500 ? "HTTP_5XX" : code >= 400 ? "HTTP_4XX" : null,
      ]
    );
    assert.equal(gate.activeRemoteCount(), 0);
  });

test("Chromium error retains unknown bytes, untagged same host stays unattributed, sessions isolate IDs", () => {
  const ticket = ticketFor();
  const a = session();
  const b = session();
  before(a, "https://api.example/a", 900);
  before(b, "https://api.example/b", 900);
  headers(a, 900, {});
  headers(b, 900, { [gate.EGRESS_TAG_HEADER]: "unknown" });
  a.listeners.onCompleted({ id: 900, statusCode: 404 });
  b.listeners.onErrorOccurred({ id: 900, error: "secret error message" });
  assert.equal(recorder.list().length, 2);
  for (const row of recorder.list()) {
    assert.equal(row.attributed, false);
    assert.equal(row.bytesOut, null);
    assert.equal(row.outcome, "error");
  }
  ticket.discard();
});

test("local-to-remote redirect is rejudged and local tags retained without manufacturing prior remote dispatch", () => {
  const s = session();
  const ticket = ticketFor({ target: "http://localhost/a" });
  const id = before(s, "http://localhost/a").id;
  headers(s, id, { [gate.EGRESS_TAG_HEADER]: ticket.tag });
  flags.sealed = true;
  s.listeners.onBeforeRedirect({ id, statusCode: 302, redirectURL: "https://remote.invalid/b" });
  assert.equal(before(s, "https://remote.invalid/b", id).cancel, true);
  assert.equal(sealedPhaseOf(ticket.signal.reason), "refused");
  s.listeners.onErrorOccurred({ id });
  ticket.discard();
  assert.equal(recorder.list().filter((r) => r.outcome === "blocked").length, 1);
});

test("destroyed webContents retains named unresolved evidence until actual end and guard is idempotent", () => {
  const app = new EventEmitter();
  backstop.installWebContentsGuard(app);
  backstop.installWebContentsGuard(app);
  assert.equal(app.listenerCount("web-contents-created"), 1);
  const policies = [];
  const contents = Object.assign(new EventEmitter(), {
    id: 42,
    setWebRTCIPHandlingPolicy: (p) => policies.push(p),
  });
  app.emit("web-contents-created", {}, contents);
  assert.deepEqual(policies, ["disable_non_proxied_udp"]);
  const s = session();
  const ticket = ticketFor();
  const id = before(s, "https://api.example/a", undefined, 42).id;
  headers(s, id, { [gate.EGRESS_TAG_HEADER]: ticket.tag });
  ticket.settle();
  contents.emit("destroyed");
  assert.equal(backstop.status().chromiumInFlightRemote, 1);
  assert.equal(backstop.status().chromiumUnresolvedAfterDestroy, 1);
  assert.equal(gate.activeRemoteCount(), 1);
  s.listeners.onErrorOccurred({ id });
  assert.equal(backstop.status().chromiumUnresolvedAfterDestroy, 0);
  assert.equal(gate.activeRemoteCount(), 0);
});

test("installation/status, observer unsubscribe and honest env proxy diagnostics", () => {
  const connect = net.Socket.prototype.connect;
  backstop.installNodeBackstop();
  assert.equal(net.Socket.prototype.connect, connect);
  const state = backstop.status();
  assert.deepEqual(
    [state.node, state.dns, state.dgram, state.http, state.webContents],
    [true, true, true, true, true]
  );
  assert.ok(state.sessions >= 1);
  assert.equal(backstop.closeChromiumConnections, undefined);
  const prior = process.env.NODE_USE_ENV_PROXY;
  try {
    process.env.NODE_USE_ENV_PROXY = "1";
    assert.equal(backstop.status().envProxy, true);
  } finally {
    if (prior === undefined) delete process.env.NODE_USE_ENV_PROXY;
    else process.env.NODE_USE_ENV_PROXY = prior;
  }
});

test("only backstop owns webRequest, smoke uses observer; no proxy dispatcher or peer connections", () => {
  const root = path.join(__dirname, "../..");
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const file = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.[cm]?[jt]sx?$/.test(file)) files.push(file);
    }
  }
  walk("src");
  walk("scripts");
  files.push("main.js", "preload.js");
  const owners = files.filter((f) =>
    /webRequest\.(onBeforeRequest|onBeforeSendHeaders|onBeforeRedirect|onCompleted|onErrorOccurred)\s*\(/.test(
      fs.readFileSync(path.join(root, f), "utf8")
    )
  );
  assert.deepEqual(owners, ["src/helpers/privacy/egressBackstop.js"]);
  assert.match(
    fs.readFileSync(path.join(root, "scripts/smoke-electron.cjs"), "utf8"),
    /\.addObserver\(/
  );
  for (const file of files) {
    const text = fs
      .readFileSync(path.join(root, file), "utf8")
      .replace(
        /\/\/ BEGIN sealed-mode: WebRTC removal[\s\S]*?\/\/ END sealed-mode: WebRTC removal/,
        ""
      );
    assert.doesNotMatch(text, /\b(ProxyAgent|EnvHttpProxyAgent|setGlobalDispatcher)\b/);
    if (file !== "scripts/sealed-acceptance.cjs")
      assert.doesNotMatch(text, /\b(RTCPeerConnection|webkitRTCPeerConnection)\b/);
  }
});

test("metered Chromium completion cannot settle before body accounting; retained tags survive JS cancellation", async () => {
  const s = session();
  const ticket = ticketFor();
  let id;
  const response = await gate.meteredFetch(
    ticket,
    async (_input, init) => {
      id = before(s, "https://api.example/body").id;
      headers(s, id, Object.fromEntries(init.headers));
      return new Response("body", { status: 503 });
    },
    { tag: true }
  )("https://api.example/body");
  s.listeners.onCompleted({ id, statusCode: 503 });
  assert.equal(recorder.list().length, 0, "Layer A owns body settlement");
  assert.equal(await response.text(), "body");
  ticket.settle();
  assert.deepEqual([recorder.list()[0].bytesIn, recorder.list()[0].status], [4, 503]);

  let activeId;
  let activeTag;
  const work = gate.guard({ task: "chat", target: "https://api.example" }, (owner) =>
    gate.meteredFetch(
      owner,
      async (_input, init) => {
        activeId = before(s, "https://api.example/pending").id;
        activeTag = init.headers.get(gate.EGRESS_TAG_HEADER);
        headers(s, activeId, Object.fromEntries(init.headers));
        return new Promise(() => {});
      },
      { tag: true }
    )("https://api.example/pending")
  );
  flags.sealed = true;
  gate.abortAllRemote();
  await assert.rejects(work, isSealedModeError);
  assert.ok(gate.ticketByTag(activeTag));
  assert.equal(gate.activeRemoteCount(), 1);
  assert.equal(backstop.status().chromiumInFlightRemote, 1);
  s.listeners.onErrorOccurred({ id: activeId, error: "net::ERR_ABORTED" });
  assert.equal(gate.activeRemoteCount(), 0);
  assert.equal(gate.ticketByTag(activeTag), null);
});

test("every ticket-owned socket is aborted by its signal but remains counted to close", () => {
  const ticket = ticketFor();
  const socket = gate.runWithTicket(ticket, () =>
    connectFixture({ host: "api.example", port: 443 })
  );
  gate.abortAllRemote();
  assert.equal(socket.destroyed, true);
  assert.equal(backstop.status().openRemoteSockets, 1);
  ticket.settle();
  socket.emit("close", false);
  assert.equal(backstop.status().openRemoteSockets, 0);
});

test(
  "TLS supplied remote socket cannot masquerade as local or default localhost",
  { timeout: 1000 },
  async () => {
    flags.sealed = true;
    for (const options of [{ host: "localhost" }, {}, { path: "/tmp/local.sock" }]) {
      const supplied = Object.assign(new EventEmitter(), { remoteAddress: "192.0.2.1" });
      const socket = tls.connect({ ...options, socket: supplied });
      assert.ok(isSealedModeError(await once(socket, "error")));
    }
    assert.equal(leaves.length, 0);
  }
);

test("Chromium header dispatch rechecks a seal that changed after request admission", () => {
  const s = session();
  const id = before(s, "https://api.example/a").id;
  flags.sealed = true;
  assert.equal(headers(s, id, { "X-Loqui-Egress": "invalid" }).cancel, true);
  assert.equal(backstop.status().chromiumInFlightRemote, 1);
  s.listeners.onErrorOccurred({ id });
  assert.equal(backstop.status().chromiumInFlightRemote, 0);
});

test("ESM builtins see the installed Node transport wrappers", async () => {
  const modules = await Promise.all([
    import("node:net"),
    import("node:dns"),
    import("node:dns/promises"),
    import("node:http"),
    import("node:https"),
    import("node:tls"),
    import("node:dgram"),
  ]);
  assert.equal(modules[0].Socket.prototype.connect, net.Socket.prototype.connect);
  assert.equal(modules[1].lookup, dns.lookup);
  assert.equal(modules[2].resolveTxt, dns.promises.resolveTxt);
  assert.equal(modules[3].request, http.request);
  assert.equal(modules[4].get, https.get);
  assert.equal(modules[5].connect, tls.connect);
  assert.equal(modules[6].Socket.prototype.send, dgram.Socket.prototype.send);
});

test("fetch and HTTP preserve raw-host validation before WHATWG canonicalization", async () => {
  flags.sealed = true;
  for (const input of ["http://127.1/", "http://0177.0.0.1/", "http://bad host/"]) {
    await assert.rejects(fetch(input), isSealedModeError);
    const req = http.request(input);
    const error = once(req, "error");
    req.end();
    assert.ok(isSealedModeError(await error));
  }
  assert.equal(leaves.length, 0);
});

test("UDP connected peers, no-callback errors and UDP6 aliases use the same production checks", async () => {
  flags.sealed = true;
  const remote = Object.assign(new EventEmitter(), {
    type: "udp4",
    remoteAddress: () => ({ address: "192.0.2.1", port: 53 }),
  });
  const error = once(remote, "error");
  dgram.Socket.prototype.send.call(remote, Buffer.from("x"));
  assert.ok(isSealedModeError(await error));
  assert.equal(leaves.length, 0);
  const local = Object.assign(new EventEmitter(), { type: "udp6" });
  dgram.Socket.prototype.connect.call(local, 53, "app.localhost");
  assert.equal(leaves.at(-1).args[1], "::1");
  await new Promise((r) =>
    dgram.Socket.prototype.send.call(local, Buffer.from("x"), 53, "localhost", r)
  );
  assert.equal(leaves.at(-1).args[2], "::1");
});

test("DNS all native-bound resolver methods reject even localhost and loopback queries sealed", async () => {
  flags.sealed = true;
  for (const host of ["localhost", "127.0.0.1", "::1"]) {
    await assert.rejects(dns.promises.resolve4(host), isSealedModeError);
    assert.ok(isSealedModeError(await new Promise((r) => dns.reverse(host, r))));
  }
  assert.equal(leaves.length, 0);
  assert.equal(backstop.status().pendingDns, 0);
});

test("Chromium multiple requests on a whole-operation tag use independent attempts and numeric receipts", () => {
  const s = session();
  const ticket = ticketFor();
  const notices = [];
  gate.events.on("dispatched", (n) => notices.push(n));
  const a = before(s, "https://api.example/a").id;
  const b = before(s, "https://api.example/b").id;
  headers(s, a, { [gate.EGRESS_TAG_HEADER]: ticket.tag });
  headers(s, b, { [gate.EGRESS_TAG_HEADER]: ticket.tag });
  s.listeners.onCompleted({ id: a, statusCode: 200 });
  s.listeners.onCompleted({ id: b, statusCode: 500 });
  ticket.settle();
  assert.equal(recorder.list().length, 2);
  assert.equal(notices.length, 2);
  assert.ok(notices.every((n) => Number.isSafeInteger(n.ticketId) && n.operationId === ticket.id));
  assert.notEqual(notices[0].ticketId, notices[1].ticketId);
  assert.notEqual(notices[0].attemptId, notices[1].attemptId);
});

test("Chromium every allowed redirect hop is rejudged; remote-to-local trails and cancellations remain remote evidence", () => {
  const a = session();
  const ticket = ticketFor();
  const id = before(a, "https://api.example/a").id;
  headers(a, id, { [gate.EGRESS_TAG_HEADER]: ticket.tag });
  a.listeners.onBeforeRedirect({ id, statusCode: 302, redirectURL: "http://127.0.0.1/local" });
  flags.sealed = true;
  assert.equal(before(a, "http://127.0.0.1/local", id).cancel, false);
  assert.equal(backstop.status().chromiumInFlightRemote, 1);
  a.listeners.onCompleted({ id, statusCode: 404 });
  ticket.settle();
  assert.deepEqual(recorder.list()[0].hosts, ["api.example", "127.0.0.1"]);
  assert.equal(recorder.list()[0].outcome, "error");
});

test("fetch redirects preserve method rewriting, sensitive headers, caller signal and HTTP failures", async () => {
  const controller = new AbortController();
  let calls = 0;
  fetchAnswer = async (request, init) => {
    assert.equal(init.signal.aborted, false);
    if (calls++ === 0) {
      assert.equal(request.method, "POST");
      assert.equal(await request.text(), "data");
      return new Response(null, { status: 302, headers: { location: "https://next.example/b" } });
    }
    assert.equal(request.method, "GET");
    assert.equal(request.headers.get("authorization"), null);
    assert.equal(request.headers.get("content-type"), null);
    return new Response("failed", { status: 503 });
  };
  const result = await fetch("https://api.example/a", {
    method: "POST",
    body: "data",
    headers: { authorization: "fixture", "content-type": "text/plain" },
    signal: controller.signal,
  });
  assert.equal(result.status, 503);
  assert.equal(await result.text(), "failed");
  assert.equal(calls, 2);
  calls = 0;
  controller.abort();
  await assert.rejects(fetch("https://api.example/a", { signal: controller.signal }));
  assert.equal(calls, 0);
});

test("proxy environment diagnostics include NODE_OPTIONS and reject truthy non-enabling values", () => {
  const env = process.env.NODE_USE_ENV_PROXY;
  const opts = process.env.NODE_OPTIONS;
  try {
    process.env.NODE_USE_ENV_PROXY = "false";
    assert.equal(backstop.status().envProxy, false);
    process.env.NODE_OPTIONS = `${opts} --use-env-proxy`;
    assert.equal(backstop.status().envProxy, true);
    process.env.NODE_OPTIONS += " --no-use-env-proxy";
    assert.equal(backstop.status().envProxy, false);
  } finally {
    if (env === undefined) delete process.env.NODE_USE_ENV_PROXY;
    else process.env.NODE_USE_ENV_PROXY = env;
    process.env.NODE_OPTIONS = opts;
  }
});

test(
  "logical remote fixture maps only its exact owned port at the terminal leaf and records actual wire bytes",
  { timeout: 3000 },
  async (t) => {
    const server = net.createServer((socket) => socket.pipe(socket));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    socketDestinations.set(port, "wire-fixture.invalid");
    t.after(() => {
      socketDestinations.delete(port);
      server.close();
    });
    const socket = new net.Socket();
    t.after(() => socket.destroy());
    socket.connect({
      host: "wire-fixture.invalid",
      port,
      lookup() {
        throw new Error("DNS forbidden");
      },
    });
    await once(socket, "connect");
    assert.equal(socket.remoteAddress, "127.0.0.1");
    assert.equal(leaves.find((l) => l.kind === "physical").options.host, "127.0.0.1");
    socket.resume();
    const closed = once(socket, "close");
    socket.end("abc");
    await closed;
    assert.deepEqual(
      [recorder.list()[0].host, recorder.list()[0].bytesOut, recorder.list()[0].bytesIn],
      ["wire-fixture.invalid", 3, 3]
    );
    assert.equal(backstop.status().openRemoteSockets, 0);
  }
);

test(
  "real ws handshake and echo use an owned numeric HTTP listener while sealed",
  { timeout: 3000 },
  async (t) => {
    flags.sealed = true;
    const WebSocket = require("ws");
    const server = http.createServer();
    const wss = new WebSocket.WebSocketServer({ server });
    wss.on("connection", (socket) => socket.on("message", (data) => socket.send(data)));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    t.after(() => {
      wss.close();
      server.close();
    });
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/`);
    t.after(() => socket.terminate());
    await once(socket, "open");
    const got = once(socket, "message");
    socket.send("echo");
    assert.equal(String(await got), "echo");
    const closed = once(socket, "close");
    socket.close();
    await closed;
    assert.equal(recorder.list().length, 0);
  }
);

test("Chromium observers see and can veto loopback; observer exceptions cannot change enforcement", () => {
  flags.sealed = true;
  const s = session();
  const seen = [];
  const off = backstop.addObserver((e) => {
    seen.push(e);
    return e.layer === "chromium" && e.host === "localhost";
  });
  assert.equal(before(s, "http://localhost/a").cancel, true);
  off();
  assert.deepEqual([seen[0].layer, seen[0].host, seen[0].allowed], ["chromium", "localhost", true]);
  const unthrow = backstop.addObserver(() => {
    throw new Error("observer");
  });
  assert.equal(before(s, "https://api.example/a").cancel, true);
  unthrow();
});

test("fetch replays static 307 bodies, preserves dispatcher and redirect metadata on clones", async () => {
  const dispatcher = { fixture: true };
  let calls = 0;
  fetchAnswer = async (request, init) => {
    assert.equal(init.dispatcher, dispatcher);
    assert.equal(request.method, "POST");
    assert.equal(await request.text(), "data");
    if (calls++ === 0)
      return new Response(null, { status: 307, headers: { location: "https://next.example/b" } });
    return new Response("ok", { status: 200 });
  };
  const response = await fetch("https://api.example/a", {
    method: "POST",
    body: "data",
    dispatcher,
  });
  assert.equal(calls, 2);
  assert.equal(response.redirected, true);
  const copy = response.clone();
  assert.equal(copy.redirected, true);
  assert.equal(await response.text(), "ok");
  assert.equal(await copy.text(), "ok");
});

test("severAll cancellation records observed wire bytes only on close, without fabricating success", () => {
  const socket = connectFixture({ host: "api.example", port: 443 });
  flags.sealed = true;
  backstop.severAll();
  assert.equal(recorder.list().length, 0);
  socket.emit("close", false);
  assert.deepEqual(
    [recorder.list()[0].outcome, recorder.list()[0].errorClass, recorder.list()[0].bytesOut],
    ["cancelled", "SEALED_MODE", 3]
  );
});

test("Chromium observed aborts are cancelled and error events preserve an available HTTP status", () => {
  const s = session();
  const a = before(s, "https://api.example/a").id;
  s.listeners.onErrorOccurred({ id: a, error: "net::ERR_ABORTED" });
  assert.deepEqual(
    [recorder.list()[0].outcome, recorder.list()[0].errorClass],
    ["cancelled", "ABORTED"]
  );
  const b = before(s, "https://api.example/b").id;
  s.listeners.onErrorOccurred({ id: b, statusCode: 503, error: "net::ERR_FAILED" });
  const row = recorder.list().find((r) => r.status === 503);
  assert.equal(row.outcome, "error");
  assert.equal(row.errorClass, "HTTP_5XX");
});

test.after(() => {
  const state = backstop.status();
  assert.equal(state.openRemoteSockets, 0, "all actual or simulated remote sockets observed close");
  assert.equal(state.pendingDns, 0, "all simulated native resolver operations ended");
  assert.equal(state.chromiumInFlightRemote, 0, "all remote Chromium requests observed an end");
  assert.equal(state.chromiumUnresolvedAfterDestroy, 0);
  assert.equal(socketDestinations.size, 0);
  assert.equal(udpPorts.size, 0);
});
