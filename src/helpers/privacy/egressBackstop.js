const net = require("node:net");
const dns = require("node:dns");
const dgram = require("node:dgram");
const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");
const { Writable } = require("node:stream");
const { syncBuiltinESMExports } = require("node:module");
const { decideEgress, isLoopbackHost, normalizeHost, hostOf } = require("./egressPolicy");
const gate = require("./egressGate");

// Layer B is a JavaScript transport backstop, not an OS isolation boundary.
// Node traffic is checked at the socket, DNS, UDP and proxy level; Chromium traffic (Electron
// net, electron-updater, renderer loads) at each session's webRequest.
const LOCAL_SCHEMES = new Set([
  "file:",
  "devtools:",
  "chrome:",
  "chrome-extension:",
  "data:",
  "blob:",
  "about:",
]);
const NETWORK_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);
// Every name-resolution entry point Node exposes (C2-R2). The list is checked
// against the live modules by a test, so a new Node API cannot slip past.
const RESOLVER_METHODS = [
  "resolve",
  "resolve4",
  "resolve6",
  "resolveAny",
  "resolveCaa",
  "resolveCname",
  "resolveMx",
  "resolveNaptr",
  "resolveNs",
  "resolvePtr",
  "resolveSoa",
  "resolveSrv",
  "resolveTlsa",
  "resolveTxt",
  "reverse",
];

const installed = { node: false, dns: false, dgram: false, http: false, webContents: false };
const sessions = new Set();
const openRemoteSockets = new Set();
const severedSockets = new WeakMap();
const chromiumInFlight = new Map(); // `${sessionTag}:${id}` → { host, ts, ticket, webContentsId }
const observers = new Set();
let pendingDns = 0;

function addObserver(fn) {
  observers.add(fn);
  return () => observers.delete(fn);
}
function notify(event) {
  let veto = false;
  for (const fn of observers) {
    try {
      if (fn(event) === true) veto = true;
    } catch {
      // An observer must not break enforcement.
    }
  }
  return veto;
}

const block = (host) =>
  gate.recordBackstopBlock({
    host: isLoopbackHost(host) ? "unknown" : (normalizeHost(String(host ?? "")) ?? "unknown"),
    ticket: gate.currentTicket(),
  });
const isPinnedName = (host) => !!host && (host === "localhost" || host.endsWith(".localhost"));

// localhost and *.localhost are answered here, never by DNS or a caller-
// supplied lookup, so a name that claims to be local cannot be steered away.
function pinnedLoopbackLookup(_hostname, options, callback) {
  if (typeof options === "function") [callback, options] = [options, {}];
  if (typeof options === "number") options = { family: options };
  const both = [
    { address: "127.0.0.1", family: 4 },
    { address: "::1", family: 6 },
  ];
  const wanted =
    options?.family === 6 || options?.family === "IPv6"
      ? both.slice(1)
      : options?.family === 4 || options?.family === "IPv4"
        ? both.slice(0, 1)
        : both;
  if (options?.all) process.nextTick(callback, null, wanted);
  else process.nextTick(callback, null, wanted[0].address, wanted[0].family);
}

// net.connect()/tls.connect() call Socket#connect with one normalised
// [options, callback] array; direct callers pass (options | port | path, ...).
function connectTarget(args) {
  const normalized = Array.isArray(args[0]);
  const first = normalized ? args[0][0] : args[0];
  if (first && typeof first === "object") {
    if (first.path) return { local: true };
    return { host: first.host ?? "localhost", options: first };
  }
  if (typeof first === "string" && !/^\d+$/.test(first)) return { local: true };
  const host = normalized ? undefined : args[1];
  return { host: typeof host === "string" ? host : "localhost" };
}

function pinOptions(options, host) {
  // Pin the physical address as well as lookup, including caller-supplied
  // lookup functions. Preserve the TLS name independently of that address.
  return {
    ...options,
    host: options.family === 6 ? "::1" : "127.0.0.1",
    lookup: pinnedLoopbackLookup,
    ...(options.servername === undefined ? { servername: host } : {}),
  };
}
function pinLocal(args, target, host) {
  if (target.options) {
    const options = pinOptions(target.options, host);
    if (Array.isArray(args[0])) return [[options, ...args[0].slice(1)], ...args.slice(1)];
    return [options, ...args.slice(1)];
  }
  const callback = args.find((a) => typeof a === "function");
  return [pinOptions({ port: Number(args[0]) }, host), ...(callback ? [callback] : [])];
}

function installSocketHook() {
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function egressAwareConnect(...args) {
    const target = connectTarget(args);
    if (target.local) return originalConnect.apply(this, args);
    const host = normalizeHost(String(target.host)) ?? "unknown";
    if (isLoopbackHost(host)) {
      notify({ layer: "node", host, allowed: true });
      return originalConnect.apply(this, isPinnedName(host) ? pinLocal(args, target, host) : args);
    }
    const ticket = gate.currentTicket();
    if (gate.isSealed()) {
      const error = gate.recordBackstopBlock({ host, ticket });
      notify({ layer: "node", host, allowed: false });
      process.nextTick(() => this.destroy(error));
      return this;
    }
    // Attribution by context only: a same-host socket opened elsewhere is unexplained.
    let release;
    if (ticket) {
      release = ticket.retainTransport();
      ticket.addHost(host);
      ticket.noteConnection?.(); // an operation with sockets but no metered request is a "connection" row (I3)
      ticket.attachSocket(this);
    }
    const startedAt = Date.now();
    openRemoteSockets.add(this);
    this.once("close", (hadError) => {
      openRemoteSockets.delete(this);
      release?.();
      // One row per connection, recorded when it closes: Loqui cannot see the
      // requests inside it (keep-alive reuse is one row, labelled as such).
      if (!ticket)
        gate.recordUnattributed({
          host,
          kind: "connection",
          outcome: hadError ? "error" : severedSockets.has(this) ? "cancelled" : "ok",
          errorClass: hadError ? "CONNECTION" : (severedSockets.get(this) ?? null),
          bytesOut: this.bytesWritten,
          bytesIn: this.bytesRead,
          ts: startedAt,
        });
    });
    notify({ layer: "node", host, allowed: true });
    try {
      return originalConnect.apply(this, args);
    } catch (error) {
      // A throwing connect can still own a socket. Retire it only on close.
      this.destroy(error);
      throw error;
    }
  };
  installed.node = true;
}

// A local proxy forwards to another machine, so a loopback socket is not proof
// that nothing leaves. Refuse CONNECT tunnels and absolute-form requests that
// name a remote host while sealed.
function forwardTarget(args) {
  let options = {};
  if (typeof args[0] === "string" || args[0] instanceof URL) {
    const url = new URL(String(args[0]));
    options = {
      host: hostOf(args[0]) ?? "unknown",
      path: `${url.pathname}${url.search}`,
      method: "GET",
    };
    if (args[1] && typeof args[1] === "object" && typeof args[1] !== "function")
      options = { ...options, ...args[1] };
  } else if (args[0] && typeof args[0] === "object") {
    options = args[0];
  }
  const host = normalizeHost(String(options.hostname ?? options.host ?? "localhost"));
  const method = String(options.method ?? "GET").toUpperCase();
  const requestPath = String(options.path ?? "/");
  if (method === "CONNECT")
    return { host, forwarding: true, forwardTo: normalizeHost(requestPath) };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(requestPath))
    return { host, forwarding: true, forwardTo: hostOf(requestPath) };
  return { host, forwardTo: null };
}

function rejectedRequest(error) {
  // Do not construct a ClientRequest: its constructor can open a connection.
  const req = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  req.setHeader = () => req;
  req.getHeader = () => undefined;
  req.removeHeader = () => {};
  req.abort = () => req.destroy(error);
  process.nextTick(() => req.destroy(error));
  return req;
}
function installProxyHook() {
  for (const client of [http, https]) {
    const original = client.request;
    const request = function egressAwareRequest(...args) {
      if (gate.isSealed()) {
        let target;
        try {
          target = forwardTarget(args);
        } catch {
          target = {};
        }
        const host = !isLoopbackHost(target.host)
          ? target.host
          : target.forwarding
            ? target.forwardTo
            : target.host;
        if (!isLoopbackHost(target.host) || !isLoopbackHost(host)) {
          notify({ layer: "node", host: host ?? "unknown", allowed: false });
          return rejectedRequest(block(host));
        }
      }
      return original.apply(this, args);
    };
    client.request = request;
    client.get = function egressAwareGet(...args) {
      const req = request.apply(this, args);
      req.end();
      return req;
    };
  }
  installed.http = true;
}

// tls.connect with an already supplied socket need not invoke Socket.connect.
// Check the declared destination here as well as at the physical socket hook.
function installTlsHook() {
  const original = tls.connect;
  tls.connect = function egressAwareTls(...args) {
    let options;
    if (args[0] && typeof args[0] === "object") options = { ...args[0] };
    else {
      options =
        typeof args[0] === "string" && !/^\d+$/.test(args[0])
          ? { path: args[0] }
          : { port: args[0] };
      for (const arg of args.slice(1)) {
        if (typeof arg === "string") options.host = arg;
        else if (arg && typeof arg === "object") Object.assign(options, arg);
      }
    }
    const host = normalizeHost(String(options.host ?? "localhost"));
    const suppliedHost = options.socket ? normalizeHost(options.socket.remoteAddress) : null;
    const unsafeSocket =
      options.socket && (!suppliedHost || !net.isIP(suppliedHost) || !isLoopbackHost(suppliedHost));
    if (gate.isSealed() && (unsafeSocket || (!options.path && !isLoopbackHost(host)))) {
      const socket = new net.Socket();
      const destination = unsafeSocket ? suppliedHost : host;
      const error = block(destination);
      notify({ layer: "node", host: destination ?? "unknown", allowed: false });
      process.nextTick(() => socket.destroy(error));
      return socket;
    }
    if (!options.path && isPinnedName(host)) options = pinOptions(options, host);
    const callback = args.find((arg) => typeof arg === "function");
    return original.call(this, options, ...(callback ? [callback] : []));
  };
}

function withRedirectMetadata(response) {
  Object.defineProperty(response, "redirected", { value: true, configurable: true });
  const clone = response.clone.bind(response);
  Object.defineProperty(response, "clone", {
    value: () => withRedirectMetadata(clone()),
    configurable: true,
  });
  return response;
}

function installFetchHook() {
  if (typeof globalThis.fetch !== "function") return;
  const original = globalThis.fetch;
  globalThis.fetch = async function egressAwareFetch(input, init = {}) {
    // Following ourselves ensures a seal between hops is checked before the
    // next dispatch, even when bundled undici bypasses public net exports.
    const ticket = gate.currentTicket();
    const initialTarget = typeof input === "string" || input instanceof URL ? input : input?.url;
    if (gate.isSealed() && !isLoopbackHost(hostOf(initialTarget))) {
      notify({ layer: "node", host: hostOf(initialTarget) ?? "unknown", allowed: false });
      throw block(hostOf(initialTarget));
    }
    const callerSignal = init.signal === undefined ? input?.signal : init.signal;
    const signal = ticket
      ? callerSignal
        ? AbortSignal.any([ticket.signal, callerSignal])
        : ticket.signal
      : callerSignal;
    let request = new Request(input, { ...init, ...(signal ? { signal } : {}) });
    const mode = request.redirect;
    let replayBody = init.body;
    const reusable = (body) =>
      typeof body === "string" ||
      body instanceof ArrayBuffer ||
      ArrayBuffer.isView(body) ||
      body instanceof Blob ||
      body instanceof URLSearchParams ||
      body instanceof FormData;
    const hosts = [];
    for (let hop = 0; ; hop++) {
      const host = hostOf(request.url);
      if (gate.isSealed() && !isLoopbackHost(host)) {
        notify({ layer: "node", host: host ?? "unknown", allowed: false });
        throw gate.recordBackstopBlock({
          host: host ?? "unknown",
          hosts: hosts.length ? [...hosts, host ?? "unknown"] : null,
          ticket,
        });
      }
      request.signal.throwIfAborted();
      if (host && !hosts.includes(host)) hosts.push(host);
      ticket?.addHost(host);
      const response = await original.call(this, request, {
        ...(init.dispatcher ? { dispatcher: init.dispatcher } : {}),
        redirect: "manual",
        signal: request.signal,
      });
      if (![301, 302, 303, 307, 308].includes(response.status))
        return hop > 0 ? withRedirectMetadata(response) : response;
      const location = response.headers.get("location");
      if (mode === "manual" || !location)
        return hop > 0 ? withRedirectMetadata(response) : response;
      try {
        await response.body?.cancel();
      } catch {}
      if (mode === "error" || hop >= 20) throw new TypeError("Fetch redirect refused");
      const url = new URL(location, request.url);
      const headers = new Headers(request.headers);
      if (url.origin !== new URL(request.url).origin) {
        for (const name of ["authorization", "proxy-authorization", "cookie", "host"])
          headers.delete(name);
      }
      let method = request.method;
      let body = null;
      if (
        (response.status === 303 && method !== "HEAD") ||
        ([301, 302].includes(response.status) && method === "POST")
      ) {
        method = "GET";
        replayBody = null;
        for (const name of [
          "content-type",
          "content-length",
          "content-encoding",
          "content-language",
          "content-location",
        ])
          headers.delete(name);
      } else if (request.body) {
        // Static init bodies can be replayed; a consumed streaming Request
        // cannot be reissued safely (the native fetch restriction as well).
        if (!reusable(replayBody)) throw new TypeError("Fetch redirect requires a replayable body");
        body = replayBody;
        if (body instanceof FormData) {
          headers.delete("content-type");
          headers.delete("content-length");
        }
      }
      request = new Request(url, {
        method,
        body,
        headers,
        signal: request.signal,
        redirect: mode,
        credentials: request.credentials,
        mode: request.mode,
        cache: request.cache,
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
        ...(body ? { duplex: "half" } : {}),
      });
    }
  };
}

function refuseDns(host, callback) {
  const error = block(host);
  if (typeof callback === "function") process.nextTick(callback, error);
  return error;
}

// One query counts in pendingDns from the call until its callback or promise
// settles, exactly once, including a synchronous throw. The sealing barrier and
// the attestation wait for it to reach 0 (Task 7).
function counted(original, self, args, style) {
  let done = false;
  const finish = () => {
    if (!done) {
      done = true;
      pendingDns--;
    }
  };
  pendingDns++;
  try {
    if (style === "promise") return Promise.resolve(original.apply(self, args)).finally(finish);
    const last = args.length - 1;
    const callback = args[last];
    if (typeof callback === "function") {
      args[last] = (...result) => {
        finish();
        callback(...result);
      };
    } else {
      finish(); // Node throws on a missing callback; nothing is in flight.
    }
    return original.apply(self, args);
  } catch (error) {
    finish();
    throw error;
  }
}

// While sealed, nothing reaches the native resolver, except an answer Loqui can
// give itself: localhost names and loopback literals for lookup, and loopback
// addresses for lookupService. Resolver queries (resolve*, reverse) always go to
// a DNS server, so they are refused outright.
function sealedAnswer(kind, args) {
  if (kind === "lookup") {
    const [hostname, maybeOptions] = args;
    const host = normalizeHost(String(hostname ?? ""));
    if (isPinnedName(host)) return { lookup: true };
    if (host && isLoopbackHost(host) && net.isIP(host)) {
      return {
        literal: { address: host, family: net.isIP(host) },
        options: typeof maybeOptions === "object" ? maybeOptions : {},
      };
    }
    return null;
  }
  if (kind === "lookupService") {
    const [address, port] = args;
    return net.isIP(String(address)) && isLoopbackHost(String(address))
      ? { service: { hostname: "localhost", service: String(port) } }
      : null;
  }
  return null;
}

function answerSealed(kind, args, style, answer) {
  if (answer.lookup) {
    if (style === "promise") {
      return new Promise((resolve, reject) =>
        pinnedLoopbackLookup(args[0], args[1] ?? {}, (error, address, family) =>
          error ? reject(error) : resolve(Array.isArray(address) ? address : { address, family })
        )
      );
    }
    pinnedLoopbackLookup(...args);
    return {};
  }
  if (answer.literal) {
    const value = answer.options?.all ? [answer.literal] : answer.literal;
    if (style === "promise") return Promise.resolve(value);
    const callback = args[args.length - 1];
    if (answer.options?.all) process.nextTick(callback, null, value);
    else process.nextTick(callback, null, value.address, value.family);
    return {};
  }
  if (style === "promise") return Promise.resolve(answer.service);
  process.nextTick(args[args.length - 1], null, answer.service.hostname, answer.service.service);
  return undefined;
}

function wrapDnsEntry(target, name, style) {
  const original = target[name];
  if (typeof original !== "function" || original.__loquiEgress) return;
  const kind = name === "lookup" || name === "lookupService" ? name : "resolver";
  const wrapped = function egressAwareDns(...args) {
    if (gate.isSealed()) {
      const answer = sealedAnswer(kind, args);
      if (answer) return answerSealed(kind, args, style, answer);
      const query = String(args[0] ?? "unknown");
      notify({ layer: "node", host: normalizeHost(query) ?? "unknown", allowed: false });
      if (style === "promise") return Promise.reject(block(query));
      refuseDns(query, args[args.length - 1]);
      return kind === "lookup" ? {} : undefined;
    }
    return counted(original, this, args, style);
  };
  wrapped.__loquiEgress = true;
  target[name] = wrapped;
}

function installDnsHook() {
  const targets = [
    [dns, "callback"],
    [dns.Resolver.prototype, "callback"],
    [dns.promises, "promise"],
    [dns.promises.Resolver.prototype, "promise"],
  ];
  for (const [target, style] of targets) {
    for (const name of ["lookup", "lookupService", ...RESOLVER_METHODS])
      wrapDnsEntry(target, name, style);
  }
  installed.dns = true;
}

function installDgramHook() {
  const originalSend = dgram.Socket.prototype.send;
  dgram.Socket.prototype.send = function egressAwareSend(...args) {
    const index = args.findIndex((value, i) => i > 0 && typeof value === "string");
    let address = index >= 0 ? args[index] : null;
    if (address === null) {
      try {
        address = this.remoteAddress().address;
      } catch {
        address = this.type === "udp6" ? "::1" : "127.0.0.1";
      }
    }
    const host = normalizeHost(address);
    if (gate.isSealed() && !isLoopbackHost(host)) {
      const error = block(host);
      notify({ layer: "node", host: host ?? "unknown", allowed: false });
      const callback = args.at(-1);
      process.nextTick(() =>
        typeof callback === "function" ? callback(error) : this.emit("error", error)
      );
      return undefined;
    }
    if (index >= 0 && isPinnedName(host)) args[index] = this.type === "udp6" ? "::1" : "127.0.0.1";
    return originalSend.apply(this, args);
  };
  const originalConnect = dgram.Socket.prototype.connect;
  dgram.Socket.prototype.connect = function egressAwareUdpConnect(port, address, callback) {
    if (typeof address === "function") {
      callback = address;
      address = undefined;
    }
    const host = normalizeHost(address ?? (this.type === "udp6" ? "::1" : "127.0.0.1"));
    if (gate.isSealed() && !isLoopbackHost(host)) {
      const error = block(host);
      notify({ layer: "node", host: host ?? "unknown", allowed: false });
      process.nextTick(() => this.emit("error", error));
      return undefined;
    }
    if (isPinnedName(host)) address = this.type === "udp6" ? "::1" : "127.0.0.1";
    return originalConnect.call(this, port, address, callback);
  };
  installed.dgram = true;
}

function installNodeBackstop() {
  if (installed.node) return;
  installSocketHook();
  installProxyHook();
  installTlsHook();
  installFetchHook();
  installDnsHook();
  installDgramHook();
  // ESM importers of node builtins (SDKs loaded with import()) see the patches too.
  syncBuiltinESMExports();
}

function judge(url) {
  let protocol;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return { cancel: gate.isSealed(), remote: false };
  }
  if (LOCAL_SCHEMES.has(protocol)) return { cancel: false, remote: false };
  if (!NETWORK_SCHEMES.has(protocol)) return { cancel: gate.isSealed(), remote: false };
  const decision = decideEgress({ sealed: gate.isSealed(), target: url });
  if (decision.loopback)
    return {
      cancel: notify({ layer: "chromium", host: decision.host, url, allowed: true }),
      remote: false,
      network: true,
    };
  if (!decision.allow) {
    notify({ layer: "chromium", host: decision.host, url, allowed: false });
    return { cancel: true, remote: true, host: decision.host };
  }
  if (notify({ layer: "chromium", host: decision.host, url, allowed: true }))
    return { cancel: true, remote: true, host: decision.host };
  return { cancel: false, remote: true, network: true, host: decision.host };
}

const judgeChromiumRequest = (url) => ({ cancel: judge(url).cancel });

function finishChromium(key, { outcome, status = null, errorClass = null }) {
  const entry = chromiumInFlight.get(key);
  if (!entry) return;
  chromiumInFlight.delete(key);
  try {
    const owner = entry.attempt;
    if (owner) {
      for (const host of entry.hosts) owner.addHost(host);
      if (entry.cancelPending && entry.managedAttempt) {
        owner.settle({ outcome: "cancelled", errorClass: "SEALED_MODE" });
      } else if (!entry.cancelPending) {
        if (Number.isInteger(status)) {
          owner.noteStatus(status);
          owner.markDelivered();
        }
        if (entry.managedAttempt)
          owner.settle({
            outcome,
            errorClass:
              status >= 500
                ? "HTTP_5XX"
                : status >= 400
                  ? "HTTP_4XX"
                  : (errorClass ?? (outcome === "error" ? "OTHER" : null)),
          });
      }
    } else if (entry.remote && !entry.cancelPending && !entry.ticket) {
      gate.recordUnattributed({
        host: entry.host,
        hosts: entry.hosts,
        kind: "request",
        outcome,
        status,
        errorClass:
          status >= 500
            ? "HTTP_5XX"
            : status >= 400
              ? "HTTP_4XX"
              : (errorClass ?? (outcome === "error" ? "OTHER" : null)),
        ts: entry.ts,
      });
    }
  } finally {
    entry.release?.();
  }
}

// Electron keeps one listener per event. Consumers (including smoke) observe
// through addObserver instead of replacing this module's enforcement hooks.
let sessionSeq = 0;
function watchSession(session) {
  if (!session?.webRequest || sessions.has(session)) return;
  sessions.add(session);
  const sessionId = ++sessionSeq;
  const key = (details) => `${sessionId}:${details.id}`;
  session.webRequest.onBeforeRequest((details, callback) => {
    const verdict = judge(details.url);
    let entry = chromiumInFlight.get(key(details));
    const host = hostOf(details.url) ?? "unknown";
    if (entry && !entry.hosts.includes(host) && entry.hosts.length < 8) entry.hosts.push(host);
    if (verdict.cancel && gate.isSealed() && (verdict.remote || !isLoopbackHost(host))) {
      if (!entry?.cancelPending) {
        gate.recordBackstopBlock({
          host,
          hosts: entry?.hosts,
          ticket: entry?.attempt ?? entry?.ticket ?? null,
        });
        if (entry) entry.cancelPending = true;
      }
      if (entry && verdict.remote) entry.remote = true;
    } else if (!verdict.cancel) {
      // Track local network requests too: their tags must survive a later
      // remote redirect, without counting local work as remote evidence.
      if (verdict.network && !entry) {
        entry = {
          host,
          hosts: [host],
          ts: Date.now(),
          ticket: null,
          remote: verdict.remote,
          webContentsId: details.webContentsId,
        };
        chromiumInFlight.set(key(details), entry);
      } else if (entry && verdict.remote) entry.remote = true;
      if (entry) entry.attempt?.addHost(host);
    }
    callback({ cancel: verdict.cancel });
  });
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    const names = Object.keys(requestHeaders).filter(
      (name) => name.toLowerCase() === gate.EGRESS_TAG_HEADER
    );
    const tags = [...new Set(names.map((name) => requestHeaders[name]))];
    for (const name of names) delete requestHeaders[name];
    const entry = chromiumInFlight.get(key(details));
    const owner = tags.length === 1 ? gate.ticketByTag(tags[0]) : null;
    if (entry && owner && !entry.ticket && (owner.ticket || !owner.settled)) {
      const ticket = owner.ticket ?? owner;
      // Never interpret the public numeric receipt as an operation/tag ID.
      // Retain the exact attempt owner through JS cancellation/settlement.
      entry.ticket = ticket;
      entry.managedAttempt = !owner.ticket;
      entry.attempt = owner.ticket ? owner : ticket.beginAttempt(entry.host);
      entry.release = entry.attempt.retainTransport();
      for (const host of entry.hosts) entry.attempt.addHost(host);
      entry.attempt.markDispatched();
    }
    let cancel = false;
    if (entry && gate.isSealed() && !isLoopbackHost(hostOf(details.url) ?? entry.hosts.at(-1))) {
      if (!entry.cancelPending)
        gate.recordBackstopBlock({
          host: hostOf(details.url) ?? entry.hosts.at(-1),
          hosts: entry.hosts,
          ticket: entry.attempt ?? entry.ticket,
        });
      entry.cancelPending = true;
      cancel = true;
    }
    callback({ requestHeaders, ...(cancel ? { cancel: true } : {}) });
  });
  session.webRequest.onBeforeRedirect((details) => {
    const entry = chromiumInFlight.get(key(details));
    if (!entry) return;
    // The redirect response is delivery evidence for the previous hop only.
    if (Number.isInteger(details.statusCode)) entry.attempt?.noteStatus(details.statusCode);
    const next = hostOf(details.redirectURL) ?? "unknown";
    if (!entry.hosts.includes(next) && entry.hosts.length < 8) entry.hosts.push(next);
  });
  session.webRequest.onCompleted((details) =>
    finishChromium(key(details), {
      outcome: details.statusCode >= 400 ? "error" : "ok",
      status: details.statusCode,
    })
  );
  session.webRequest.onErrorOccurred((details) =>
    finishChromium(key(details), {
      outcome: details.error === "net::ERR_ABORTED" ? "cancelled" : "error",
      errorClass: details.error === "net::ERR_ABORTED" ? "ABORTED" : "OTHER",
      status: Number.isInteger(details.statusCode) ? details.statusCode : null,
    })
  );
}

const guardedApps = new WeakSet();
function installWebContentsGuard(app) {
  if (guardedApps.has(app)) return;
  guardedApps.add(app);
  app.on("web-contents-created", (_event, contents) => {
    contents.setWebRTCIPHandlingPolicy?.("disable_non_proxied_udp");
    contents.once?.("destroyed", () => {
      for (const entry of chromiumInFlight.values())
        if (entry.webContentsId === contents.id) entry.orphaned = true;
    });
  });
  installed.webContents = true;
}

// Node sockets only: loopback connections (self-hosted STT, llama-server) and
// Chromium's pool are left alone. Ticketed Chromium requests are stopped by
// their own abort signals (gate.abortAllRemote); un-ticketed ones are waited
// for, and keep the attestation unverified until they end.
// Each socket leaves openRemoteSockets on its own "close" (the connect hook),
// so the count drops only once a socket has actually closed.
function severAll() {
  const sockets = [...openRemoteSockets];
  for (const socket of sockets) {
    try {
      severedSockets.set(socket, gate.isSealed() ? "SEALED_MODE" : "ABORTED");
      socket.destroy();
    } catch {} // keep failed stops represented until close
  }
  return sockets.length;
}

function proxyConfigured() {
  // NODE_OPTIONS is not reflected in execArgv. Environment enablement is
  // Node's literal "1", not arbitrary truthy strings such as "false".
  const flags = [...(process.env.NODE_OPTIONS ?? "").split(/\s+/), ...process.execArgv];
  let enabled = process.env.NODE_USE_ENV_PROXY === "1";
  for (const flag of flags) {
    if (flag === "--use-env-proxy") enabled = true;
    if (flag === "--no-use-env-proxy") enabled = false;
  }
  return enabled;
}
// Removing a startup setting later cannot prove an existing agent is safe.
const startupEnvProxy = proxyConfigured();
const envProxy = () => startupEnvProxy || proxyConfigured();

const status = () => ({
  ...installed,
  sessions: sessions.size,
  envProxy: envProxy(),
  openRemoteSockets: openRemoteSockets.size,
  chromiumInFlightRemote: [...chromiumInFlight.values()].filter((e) => e.remote).length,
  chromiumUnresolvedAfterDestroy: [...chromiumInFlight.values()].filter(
    (e) => e.remote && e.orphaned
  ).length,
  pendingDns,
});

module.exports = {
  installNodeBackstop,
  watchSession,
  installWebContentsGuard,
  judgeChromiumRequest,
  severAll,
  addObserver,
  status,
};
