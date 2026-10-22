const { AsyncLocalStorage } = require("node:async_hooks");
const { EventEmitter } = require("node:events");
const { randomBytes } = require("node:crypto");
const {
  EGRESS_TASKS,
  decideEgress,
  SealedModeError,
  isSealedModeError,
  normalizeHost,
  hostOf,
  isLoopbackHost,
} = require("./egressPolicy");

// Layer A of Sealed mode (docs/security/sealed-mode-threat-model.md). Every
// known request site asks for a ticket before sending. The ticket carries the
// task for the flight recorder and an AbortSignal that sealing trips.
const EGRESS_TAG_HEADER = "x-loqui-egress";
const USER_ENDPOINT_PROVIDERS = new Set(["custom", "lan", "local"]);
const CONNECT_PHASE_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);
const CONNECT_PHASE_CHROMIUM =
  /ERR_(NAME_NOT_RESOLVED|CONNECTION_REFUSED|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED|NAME_RESOLUTION_FAILED)/;

const { ERROR_CLASSES } = require("./flightRecorder");

const ticketContext = new AsyncLocalStorage();
const taskContext = new AsyncLocalStorage();
const attemptContext = new AsyncLocalStorage();
const pendingBodies = new Set();
// The dictation session and canonical provider for everything inside one
// handler, so provider helpers deep in the call need not thread them (I4-R2).
const metaContext = new AsyncLocalStorage();
const events = new EventEmitter();

const freshTally = () => ({ blockedSinceSealed: 0, recordFailures: 0 });
let config = { isSealed: () => true, recorder: null, now: Date.now };
let active = new Map();
let byTag = new Map();
let nextId = 1;
let tally = freshTally();
let bypass = false;
let generation = 0;

function configureEgress({ isSealed, recorder = config.recorder, now = Date.now }) {
  if (typeof isSealed !== "function") throw new TypeError("isSealed must be a function");
  config = { isSealed, recorder, now };
}
const attachRecorder = (recorder) => {
  config.recorder = recorder;
};
const getRecorder = () => config.recorder;

function isSealed() {
  try {
    return config.isSealed() === true;
  } catch {
    return true;
  }
}

function assertTask(task) {
  if (!EGRESS_TASKS.includes(task)) throw new TypeError(`Unknown egress task: ${task}`);
}
function withTask(task, fn) {
  assertTask(task);
  return taskContext.run(task, fn);
}
const currentTask = () => taskContext.getStore() ?? null;
function withContext({ correlationId = null, provider = null } = {}, fn) {
  const outer = metaContext.getStore() ?? {};
  return metaContext.run(
    {
      correlationId: correlationId ?? outer.correlationId ?? null,
      provider: provider ?? outer.provider ?? null,
    },
    fn
  );
}
const currentTicket = () => ticketContext.getStore() ?? null;
const runWithTicket = (ticket, fn) => ticketContext.run(ticket, fn);

function record(event) {
  // Sanitize even for a recorder-shaped adapter rather than relying on SQLite.
  const host = normalizeHost(event.host) ?? "unknown";
  const count = (n) => (Number.isFinite(n) && n >= 0 ? n : null);
  event = {
    ts: count(event.ts),
    endedAt: count(event.endedAt),
    task: EGRESS_TASKS.includes(event.task) ? event.task : "unattributed",
    host,
    hosts: [...new Set([host, ...(event.hosts ?? []).map(normalizeHost).filter(Boolean)])].slice(
      0,
      8
    ),
    kind: ["request", "stream", "connection", "session", "operation"].includes(event.kind)
      ? event.kind
      : "request",
    bytesOut: count(event.bytesOut),
    bytesIn: count(event.bytesIn),
    outcome: ["ok", "error", "blocked", "cancelled"].includes(event.outcome)
      ? event.outcome
      : "error",
    status:
      Number.isInteger(event.status) && event.status >= 100 && event.status <= 599
        ? event.status
        : null,
    errorClass:
      event.errorClass == null
        ? null
        : ERROR_CLASSES.includes(event.errorClass)
          ? event.errorClass
          : "OTHER",
    model: safeModel(event.model),
    operationId: Number.isInteger(event.operationId) ? event.operationId : null,
    attributed: event.attributed !== false,
    opaque: event.kind === "session",
  };
  try {
    config.recorder?.record(event);
  } catch {
    // The ledger must never decide whether a request runs; enforcement does.
    tally.recordFailures++;
  }
}

// A bounded category, never the provider's code or message (N1). The recorder
// stores only values from its ERROR_CLASSES list.
const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NONAME"]);
const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ECONNABORTED",
  "UND_ERR_SOCKET",
]);
const TIMEOUT_CODES = new Set([
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);
function errorClassOf(error) {
  if (isSealedModeError(error)) return "SEALED_MODE";
  for (let e = error, depth = 0; e && depth < 4; e = e.cause, depth++) {
    const code = typeof e.code === "string" ? e.code : "";
    if (DNS_CODES.has(code)) return "DNS";
    if (CONNECTION_CODES.has(code)) return "CONNECTION";
    if (TIMEOUT_CODES.has(code) || e.name === "TimeoutError") return "TIMEOUT";
    if (/^(ERR_TLS|CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|ERR_SSL)/.test(code)) return "TLS";
    if (e.name === "AbortError") return "ABORTED";
    if (Number.isInteger(e.status) && e.status >= 500) return "HTTP_5XX";
    if (Number.isInteger(e.status) && e.status >= 400) return "HTTP_4XX";
  }
  return "OTHER";
}

function isConnectPhaseError(error) {
  for (let e = error, depth = 0; e && depth < 4; e = e.cause, depth++) {
    if (CONNECT_PHASE_CODES.has(e.code)) return true;
    if (typeof e.message === "string" && CONNECT_PHASE_CHROMIUM.test(e.message)) return true;
  }
  return false;
}

function safeModel(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/.test(value) ||
    value.includes("//") ||
    /:[^/@]*@/.test(value) ||
    /[A-Za-z0-9_]{32,}/.test(value)
  )
    return null;
  return value;
}

function refuse({ task, host, hosts = null, model = null, attributed = true }) {
  tally.blockedSinceSealed++;
  const ts = config.now();
  record({
    ts,
    endedAt: ts,
    task,
    host,
    hosts: hosts ?? [host],
    bytesOut: 0,
    bytesIn: 0,
    outcome: "blocked",
    errorClass: "SEALED_MODE",
    model,
    attributed,
  });
  return new SealedModeError({ task, host });
}

const meterAccumulator = () => ({ total: 0, measured: false, unknown: false });
function addTo(acc, n) {
  if (n === null) acc.unknown = true;
  else if (Number.isFinite(n) && n >= 0) {
    acc.total += n;
    acc.measured = true;
  }
}
const valueOf = (acc) => (acc.unknown || !acc.measured ? null : acc.total);
const targetIdFor = (provider, host) =>
  provider && !USER_ENDPOINT_PROVIDERS.has(provider) ? provider : `host:${host}`;

// Operation identity and transport evidence have different lifetimes. Settling
// JS work never forgets an attached socket or an explicit Chromium hold.
function createTicket({ task, host, loopback, model, meter, payload, correlationId, provider }) {
  const epoch = generation;
  const recordOwned = (event) => {
    if (epoch === generation) record(event);
  };
  const controller = new AbortController();
  const out = meterAccumulator();
  const inbound = meterAccumulator();
  const sockets = new Map();
  const attempts = new Set();
  const announced = new Set();
  let holds = 0;
  let lastStatus = null;
  let openBodies = 0;
  let attemptCount = 0;
  let manualDispatch = false;
  let connections = 0;
  const evidence = new Map();
  let pendingSettlement = null;
  let remote = !loopback;
  const id = nextId++;
  const ticket = {
    id,
    tag: `${id}.${randomBytes(12).toString("hex")}`,
    task,
    host,
    hosts: [host],
    loopback,
    model,
    meter,
    payload,
    correlationId,
    targetId: targetIdFor(provider, host),
    signal: controller.signal,
    settled: false,
    startedAt: config.now(),
    addHost(seen) {
      seen = normalizeHost(seen);
      if (!seen) return;
      appendHost(ticket.hosts, seen);
      if (!isLoopbackHost(seen)) remote = true;
      const attempt = attemptContext.getStore();
      if (attempt?.ticket === ticket && !attempt.settled) attempt.addHost(seen);
    },
    noteConnection() {
      connections++;
    },
    beginAttempt,
    attemptCount: () => attemptCount,
    retainTransport: () => retainTransport(ticket),
    attachSocket(socket) {
      if (sockets.has(socket)) return;
      const close = (hadError) => {
        if (meter === "socket") {
          addTo(out, socket.bytesWritten ?? null);
          addTo(inbound, socket.bytesRead ?? null);
        }
        sockets.delete(socket);
        if (meter === "socket" && sockets.size === 0 && !ticket.settled) {
          ticket.settle(
            hadError
              ? { ...pendingSettlement, outcome: "error", errorClass: "CONNECTION" }
              : (pendingSettlement ?? { outcome: "ok" })
          );
        }
        cleanup();
      };
      sockets.set(socket, close);
      socket.once("close", close);
      active.set(id, ticket);
      if (controller.signal.aborted) socket.destroy(controller.signal.reason);
    },
    socketCount: () => sockets.size,
    addBytes({ out: o, in: i } = {}) {
      if (o !== undefined) addTo(out, o);
      if (i !== undefined) addTo(inbound, i);
    },
    noteStatus(code) {
      if (Number.isInteger(code)) lastStatus = code;
    },
    bodyOpened() {
      openBodies++;
    },
    bodyClosed() {
      openBodies = Math.max(0, openBodies - 1);
    },
    markDispatched() {
      manualDispatch = true;
      announce("dispatched", null);
    },
    markDelivered() {
      manualDispatch = true;
      announce("dispatched", null);
      announce("delivered", null);
    },
    markUndelivered() {
      announce("undelivered", null);
    },
    abort(reason = new DOMException("Aborted", "AbortError")) {
      if (!controller.signal.aborted) controller.abort(reason);
      for (const socket of sockets.keys()) {
        try {
          socket.destroy(reason);
        } catch {} // keep its evidence until close
      }
      // Opaque child sessions are ended by their actual child/tree exit only.
      if (meter === "socket" && sockets.size === 0 && !ticket.settled)
        ticket.settle({ outcome: "cancelled" });
    },
    discard() {
      if (ticket.settled) return;
      ticket.settled = true;
      for (const attempt of attempts) {
        if (!attempt.held()) {
          attempt.settled = true;
          byTag.delete(attempt.tag);
          attempts.delete(attempt);
        }
      }
      cleanup();
    },
    settle(patch = {}) {
      if (ticket.settled) return;
      // A wire meter cannot be finalized using counters from an open socket.
      if (meter === "socket" && sockets.size > 0) {
        pendingSettlement = patch;
        return;
      }
      const final = settlement(patch, controller.signal, lastStatus);
      for (const attempt of [...attempts]) {
        if (!attempt.settled && !attempt.held()) {
          // An answered but unread body is unknown, not an application error.
          attempt.settle(
            final.outcome === "cancelled"
              ? final
              : attempt.responded
                ? httpPatch(attempt.status)
                : final
          );
        }
      }
      ticket.settled = true;
      if (remote && attemptCount === 0) {
        const kind =
          meter === "opaque"
            ? "session"
            : meter === "socket"
              ? "stream"
              : manualDispatch
                ? "request"
                : connections > 0
                  ? "connection"
                  : "operation";
        recordOwned({
          ts: ticket.startedAt,
          endedAt: config.now(),
          task,
          host,
          hosts: ticket.hosts,
          kind,
          operationId: id,
          model,
          ...final,
          bytesOut:
            meter === "opaque"
              ? null
              : patch.bytesOut !== undefined
                ? patch.bytesOut
                : valueOf(out),
          bytesIn:
            meter === "opaque"
              ? null
              : openBodies > 0
                ? null
                : patch.bytesIn !== undefined
                  ? patch.bytesIn
                  : valueOf(inbound),
        });
      }
      cleanup();
      if (remote && epoch === generation) events.emit("settled", { ticketId: id });
    },
    // Diagnostic liveness only, not a native boundary attestation.
    hasRemoteEvidence: () => remote && (!ticket.settled || sockets.size > 0 || holds > 0),
    _cleanupForTests() {
      ticket.abort(new DOMException("Test reset", "AbortError"));
      for (const [socket, listener] of sockets) {
        socket.removeListener("close", listener);
      }
      sockets.clear();
      ticket.settled = true;
    },
  };
  function cleanup() {
    if (epoch !== generation) return;
    for (const attempt of attempts)
      if (attempt.settled && !attempt.held()) {
        byTag.delete(attempt.tag);
        attempts.delete(attempt);
      }
    if (ticket.settled && sockets.size === 0 && holds === 0) {
      byTag.delete(ticket.tag);
      active.delete(id);
    }
  }
  function retainTransport(owner) {
    if (epoch !== generation) throw new TypeError("Stale egress ticket");
    let closed = false;
    holds++;
    owner._transportHolds = (owner._transportHolds ?? 0) + 1;
    active.set(id, ticket);
    byTag.set(owner.tag, owner);
    return () => {
      if (closed) return;
      closed = true;
      holds--;
      owner._transportHolds--;
      cleanup();
    };
  }
  // Plan 04 groups notices by ticketId; delivered is final. attemptId refines
  // correlation without changing that grouping. A retry must never retract it.
  function announce(phase, attemptId, attemptHost = host, local = loopback) {
    if (local || epoch !== generation) return;
    const key = `${attemptId ?? "ticket"}:${phase}`;
    if (announced.has(key)) return;
    const evidenceKey = attemptId ?? "ticket";
    const previous = evidence.get(evidenceKey);
    if (previous !== "delivered") evidence.set(evidenceKey, phase);
    // An uncertain earlier dispatch is evidence too. Plan 04's operation-wide
    // withdrawal is valid only when *all* dispatched attempts were undelivered.
    if (phase === "undelivered" && [...evidence.values()].some((p) => p !== "undelivered")) return;
    announced.add(key);
    events.emit(phase, {
      ticketId: id,
      attemptId,
      task,
      targetId: targetIdFor(provider, attemptHost),
      host: attemptHost,
      payload,
      correlationId,
      ts: config.now(),
    });
  }
  function beginAttempt(target) {
    if (ticket.settled || epoch !== generation)
      throw new TypeError("Cannot reuse a settled egress ticket");
    const attemptHost = normalizeHost(target) ?? host;
    const local = isLoopbackHost(attemptHost);
    if (!local) remote = true;
    appendHost(ticket.hosts, attemptHost);
    attemptCount++;
    const aOut = meterAccumulator();
    const aIn = meterAccumulator();
    const attempt = {
      id: `${id}.${attemptCount}`,
      tag: `${id}.${attemptCount}.${randomBytes(12).toString("hex")}`,
      ticket,
      task,
      host: attemptHost,
      hosts: [attemptHost],
      loopback: local,
      startedAt: config.now(),
      status: null,
      openBodies: 0,
      responded: false,
      settled: false,
      get signal() {
        return controller.signal;
      },
      addHost(seen) {
        seen = normalizeHost(seen);
        if (!seen) return;
        appendHost(attempt.hosts, seen);
        appendHost(ticket.hosts, seen);
        if (!isLoopbackHost(seen)) remote = true;
      },
      abort: (reason) => ticket.abort(reason),
      retainTransport: () => retainTransport(attempt),
      held: () => (attempt._transportHolds ?? 0) > 0,
      addBytes({ out: o, in: i } = {}) {
        if (o !== undefined) addTo(aOut, o);
        if (i !== undefined) addTo(aIn, i);
      },
      noteStatus(code) {
        if (Number.isInteger(code)) attempt.status = code;
      },
      markDispatched: () => announce("dispatched", attempt.id, attemptHost, local),
      markDelivered() {
        attempt.responded = true;
        attempt.markDispatched();
        announce("delivered", attempt.id, attemptHost, local);
      },
      markUndelivered: () => announce("undelivered", attempt.id, attemptHost, local),
      settle(patch = {}) {
        if (attempt.settled) return;
        attempt.settled = true;
        if (!local || attempt.hosts.some((h) => !isLoopbackHost(h)))
          recordOwned({
            ts: attempt.startedAt,
            endedAt: config.now(),
            task,
            host: attemptHost,
            hosts: attempt.hosts,
            kind: "request",
            operationId: id,
            model,
            ...settlement(patch, controller.signal, attempt.status),
            bytesOut: valueOf(aOut),
            bytesIn: attempt.openBodies > 0 ? null : valueOf(aIn),
          });
        cleanup();
      },
    };
    attempts.add(attempt);
    byTag.set(attempt.tag, attempt);
    return attempt;
  }
  active.set(id, ticket);
  byTag.set(ticket.tag, ticket);
  return ticket;
}

function appendHost(trail, host) {
  if (host && !trail.includes(host) && trail.length < 8) trail.push(host);
}
const httpPatch = (status) => ({
  outcome: status >= 400 ? "error" : "ok",
  errorClass: status >= 500 ? "HTTP_5XX" : status >= 400 ? "HTTP_4XX" : null,
});
function settlement(patch, signal, status) {
  status = Number.isInteger(patch.status) ? patch.status : status;
  const sealed = signal.aborted && isSealedModeError(signal.reason);
  const http = httpPatch(status);
  const outcome = signal.aborted
    ? "cancelled"
    : patch.outcome === "ok" && status >= 400
      ? "error"
      : (patch.outcome ?? http.outcome);
  return {
    outcome,
    status,
    errorClass: sealed
      ? "SEALED_MODE"
      : (patch.errorClass ??
        (signal.aborted ? "ABORTED" : outcome === "error" ? http.errorClass : null)),
  };
}

function authorize({
  task = currentTask() ?? "unattributed",
  target,
  model = null,
  provider = null,
  meter = "body",
  payload = "metadata",
  correlationId = null,
} = {}) {
  assertTask(task);
  if (!["body", "socket", "opaque"].includes(meter)) throw new TypeError("Unknown egress meter");
  if (!["audio", "text", "image", "metadata"].includes(payload))
    throw new TypeError("Unknown egress payload");
  const ctx = metaContext.getStore();
  correlationId = correlationId ?? ctx?.correlationId ?? null;
  provider = provider ?? ctx?.provider ?? null;
  const decision = decideEgress({ sealed: !bypass && isSealed(), target });
  if (!decision.allow) throw refuse({ task, host: decision.host, model });
  return createTicket({
    task,
    host: decision.host,
    loopback: decision.loopback,
    model,
    meter,
    payload,
    correlationId,
    provider,
  });
}

function assertAllowed({ task = currentTask() ?? "unattributed", target } = {}) {
  assertTask(task);
  const decision = decideEgress({ sealed: !bypass && isSealed(), target });
  if (!decision.allow) throw refuse({ task, host: decision.host });
}

function failureOutcome(ticket, error, signal = ticket.signal) {
  const reason = ticket.signal.aborted
    ? ticket.signal.reason
    : signal.aborted
      ? signal.reason
      : null;
  const sealedAbort = isSealedModeError(reason);
  return {
    patch: {
      outcome:
        ticket.signal.aborted ||
        signal.aborted ||
        error?.name === "AbortError" ||
        error?.isAbort ||
        error?.code === "DOWNLOAD_CANCELLED"
          ? "cancelled"
          : "error",
      errorClass: sealedAbort ? "SEALED_MODE" : signal.aborted ? "ABORTED" : errorClassOf(error),
      status: Number.isInteger(error?.status) ? error.status : undefined,
    },
    // A request cut off by sealing reports the seal, not a transport error.
    rethrow: sealedAbort ? reason : error,
  };
}

// Racing the signal also covers injected transports and readers that never
// acknowledge abort. Layer B independently retains actual transport evidence.
function abortable(promise, signal) {
  if (signal.aborted) {
    Promise.resolve(promise).catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

async function guard(meta, fn) {
  const ticket = authorize(meta);
  try {
    const work = Promise.resolve(runWithTicket(ticket, () => fn(ticket)));
    // An opaque child's caller must await its actual end, even after abort.
    const result = await (ticket.meter === "opaque" ? work : abortable(work, ticket.signal));
    if (ticket.signal.aborted) throw ticket.signal.reason;
    ticket.settle({ outcome: "ok", ...(meta.settleFrom ? meta.settleFrom(result) : {}) });
    return result;
  } catch (error) {
    const { patch, rethrow } = failureOutcome(ticket, error);
    ticket.settle(patch);
    throw rethrow;
  }
}

async function guardResponse(meta, fn) {
  const ticket = authorize(meta);
  try {
    const pending = Promise.resolve(runWithTicket(ticket, () => fn(ticket))).then((response) => {
      if (ticket.signal.aborted) cancelBody(response, ticket.signal.reason);
      return response;
    });
    let response = await abortable(pending, ticket.signal);
    ticket.noteStatus(response.status);
    // Raw fetch users still represent one actual request, including its body.
    if (ticket.attemptCount() === 0) {
      const attempt = ticket.beginAttempt(ticket.host);
      attempt.markDelivered();
      response = meterResponse(response, attempt, ticket.signal);
    }
    if (!response.body) {
      ticket.settle(httpPatch(response.status));
      return response;
    }
    let branches = 1;
    const hooks = () => ({
      onFinish(error, cancelled) {
        if (error || cancelled)
          ticket.settle(
            error
              ? failureOutcome(ticket, error).patch
              : { outcome: "cancelled", errorClass: "BODY_CANCELLED" }
          );
        else if (--branches === 0) ticket.settle(httpPatch(response.status));
      },
      onClone() {
        branches++;
        return hooks();
      },
    });
    return wrapResponse(response, ticket.signal, hooks());
  } catch (error) {
    const { patch, rethrow } = failureOutcome(ticket, error);
    ticket.settle(patch);
    throw rethrow;
  }
}

// A read, error, cancel and abort share one completion path. In particular,
// controller.error interrupts a pending read even if reader.cancel never ends.
function wrapResponse(response, signal, { onChunk, onFinish = () => {}, onClone } = {}) {
  if (!response.body) return response;
  const reader = response.body.getReader();
  let streamController;
  let finished = false;
  function finish(error = null, cancelled = false) {
    if (finished) return;
    finished = true;
    signal.removeEventListener("abort", abort);
    pendingBodies.delete(abort);
    onFinish(error, cancelled);
  }
  const stopReader = (reason) => {
    try {
      return Promise.resolve(reader.cancel(reason));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  function abort(reason = signal.reason) {
    if (reason?.type === "abort") reason = signal.reason;
    try {
      streamController.error(reason);
    } catch {}
    finish(reason, true);
    stopReader(reason).catch(() => {});
  }
  const body = new ReadableStream(
    {
      start(controller) {
        streamController = controller;
      },
      async pull(controller) {
        try {
          if (signal.aborted) throw signal.reason;
          const { done, value } = await abortable(reader.read(), signal);
          if (finished) return;
          if (done) {
            controller.close();
            finish();
            return;
          }
          onChunk?.(value);
          controller.enqueue(value);
        } catch (error) {
          const reason = signal.aborted ? signal.reason : error;
          try {
            controller.error(reason);
          } catch {}
          finish(reason);
        }
      },
      async cancel(reason) {
        try {
          await abortable(stopReader(reason), signal);
          finish(null, true);
        } catch (error) {
          finish(signal.aborted ? signal.reason : error, true);
          throw signal.aborted ? signal.reason : error;
        }
      },
    },
    { highWaterMark: 0 }
  );
  pendingBodies.add(abort);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const result = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  // Keep transport metadata that a reconstructed Response otherwise loses.
  for (const field of ["url", "redirected", "type"])
    Object.defineProperty(result, field, { value: response[field] });
  const clone = result.clone.bind(result);
  Object.defineProperty(result, "clone", {
    value() {
      const copy = clone();
      // Clones share the source meter; do not count buffered bytes twice. Each
      // clone still has its own abortable read/cancel path.
      return wrapResponse(copy, signal, onClone?.() ?? {});
    },
  });
  return result;
}

function meterResponse(response, attempt, signal) {
  attempt.noteStatus(response.status);
  attempt.ticket.noteStatus(response.status);
  const finalHost = hostOf(response.url);
  if (finalHost) attempt.addHost(finalHost);
  if (!response.body) {
    attempt.addBytes({ in: null });
    attempt.settle(httpPatch(response.status));
    return response;
  }
  attempt.openBodies++;
  return wrapResponse(response, signal, {
    onChunk(chunk) {
      attempt.addBytes({ in: chunk?.byteLength ?? null });
    },
    onFinish(error, cancelled) {
      if (error || cancelled) {
        attempt.settle(
          error
            ? failureOutcome(attempt.ticket, error, signal).patch
            : { outcome: "cancelled", errorClass: "BODY_CANCELLED" }
        );
      } else {
        attempt.openBodies--;
        attempt.addBytes({ in: 0 });
        attempt.settle(httpPatch(response.status));
      }
    },
  });
}

// Request and response bodies only. Headers, FormData and streams are unknown.
function bodyLength(body) {
  if (body == null) return null;
  if (typeof body === "string") return Buffer.byteLength(body);
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof URLSearchParams) return Buffer.byteLength(body.toString());
  if (body instanceof Blob) return body.size;
  return null;
}

// Union contract: ticketByTag returns Ticket | Attempt | null. Attempts expose
// .ticket, task, signal, addHost, abort, noteStatus, settle and retainTransport.
// Task 6 must unwrap .ticket for operation identity and release its diagnostic
// retainTransport() hold only on actual onCompleted/onErrorOccurred.
function tagHeaders(owner, headers = {}) {
  const values =
    headers instanceof Headers || Array.isArray(headers)
      ? Object.fromEntries(new Headers(headers))
      : { ...headers };
  for (const name of Object.keys(values))
    if (name.toLowerCase() === EGRESS_TAG_HEADER) delete values[name];
  return { ...values, [EGRESS_TAG_HEADER]: owner.tag };
}
const ticketByTag = (tag) => byTag.get(tag) ?? null;

function cancelBody(response, reason) {
  try {
    Promise.resolve(response?.body?.cancel(reason)).catch(() => {});
  } catch {}
}

function meteredFetch(
  ticket,
  baseFetch = (...args) => globalThis.fetch(...args),
  { tag = false } = {}
) {
  return async (input, init = {}) => {
    if (ticket.signal.aborted) throw ticket.signal.reason;
    const decision = decideEgress({
      sealed: !bypass && isSealed(),
      target: typeof input === "string" || input instanceof URL ? input : input?.url,
    });
    if (!decision.allow) {
      const refused = ticket.beginAttempt(decision.host);
      tally.blockedSinceSealed++;
      refused.addBytes({ out: 0, in: 0 });
      refused.settle({ outcome: "blocked", errorClass: "SEALED_MODE" });
      throw new SealedModeError({ task: ticket.task, host: decision.host });
    }
    const signal = init.signal ? AbortSignal.any([init.signal, ticket.signal]) : ticket.signal;
    const headers = new Headers(init.headers ?? input?.headers ?? {});
    headers.delete(EGRESS_TAG_HEADER);
    if (signal.aborted) throw signal.reason;
    const attempt = ticket.beginAttempt(decision.host);
    if (tag) headers.set(EGRESS_TAG_HEADER, attempt.tag);
    attempt.addBytes({ out: bodyLength(init.body ?? input?.body) });
    attempt.markDispatched();
    try {
      const pending = runWithTicket(ticket, () =>
        attemptContext.run(attempt, () => baseFetch(input, { ...init, headers, signal }))
      );
      const response = await abortable(
        Promise.resolve(pending).then((value) => {
          const finalHost = hostOf(value?.url);
          if (finalHost) attempt.addHost(finalHost);
          attempt.markDelivered();
          if (signal.aborted) cancelBody(value, signal.reason);
          return value;
        }),
        signal
      );
      return meterResponse(response, attempt, signal);
    } catch (error) {
      if (isConnectPhaseError(error)) attempt.markUndelivered();
      // A backstop may refuse only the final redirect. Preserve the prior
      // hop's dispatch and return interruption semantics through wrappers.
      if (isSealedModeError(error) && (attempt.responded || attempt.hosts.length > 1)) {
        const interrupted = new SealedModeError({
          task: ticket.task,
          host: attempt.hosts.at(-1),
          phase: "interrupted",
        });
        ticket.abort(interrupted);
      }
      const { patch, rethrow } = failureOutcome(
        ticket,
        signal.aborted ? signal.reason : error,
        signal
      );
      attempt.settle(patch);
      throw rethrow;
    }
  };
}

function abortAllRemote() {
  let aborted = 0;
  for (const ticket of [...active.values()]) {
    if (!ticket.hasRemoteEvidence() || ticket.signal.aborted) continue;
    ticket.abort(
      new SealedModeError({ task: ticket.task, host: ticket.host, phase: "interrupted" })
    );
    aborted++;
  }
  return aborted;
}
const activeRemoteCount = () => [...active.values()].filter((t) => t.hasRemoteEvidence()).length;

// kind: "request" for a Chromium request, "connection" for a Node socket whose
// requests Loqui cannot see (recorded when it closes).
function recordUnattributed({
  host,
  hosts = null,
  kind = "request",
  outcome,
  status = null,
  errorClass = null,
  bytesOut = null,
  bytesIn = null,
  ts,
  endedAt,
}) {
  host = normalizeHost(host) ?? "unknown";
  if (isLoopbackHost(host) && !(hosts ?? []).some((h) => !isLoopbackHost(h))) return;
  const now = config.now();
  record({
    ts: ts ?? now,
    endedAt: endedAt ?? now,
    task: "unattributed",
    host,
    hosts: [host, ...(hosts ?? []).map(normalizeHost).filter(Boolean)].slice(0, 8),
    kind,
    outcome,
    status,
    errorClass,
    bytesOut,
    bytesIn,
    attributed: false,
  });
}

// A trail is evidence of earlier dispatched hops. The final hop can be refused
// without claiming those earlier hops were wholly unsent. Task 6 retains its
// separate in-flight entry until actual completion; this hook is not that end.
function recordBackstopBlock({ host, hosts = null, ticket: owner = null }) {
  host = normalizeHost(host) ?? "unknown";
  if (isLoopbackHost(host)) return null;
  if (owner) {
    const ticket = owner.ticket ?? owner;
    const prefix = hosts?.at(-1) === host && hosts.length > 1 ? hosts.slice(0, -1) : (hosts ?? []);
    if (owner.loopback && [...owner.hosts, ...prefix].every(isLoopbackHost)) {
      // Only local hops ran. Omit them; the remote hop itself was refused
      // before dispatch. Do not turn local traffic into provider evidence.
      if (owner.ticket) owner.settle({ outcome: "cancelled" });
      const error = refuse({ task: ticket.task, host, model: ticket.model });
      ticket.abort(error);
      return error;
    }
    for (const seen of hosts ?? [host]) owner.addHost(seen);
    owner.addHost(host);
    tally.blockedSinceSealed++;
    const error = new SealedModeError({ task: ticket.task, host, phase: "interrupted" });
    owner.abort(error);
    return error;
  }
  const prefix = hosts?.at(-1) === host && hosts.length > 1 ? hosts.slice(0, -1) : hosts;
  if (prefix?.some((h) => !isLoopbackHost(h))) {
    tally.blockedSinceSealed++;
    const error = new SealedModeError({ task: "unattributed", host, phase: "interrupted" });
    recordUnattributed({
      host: hosts[0],
      hosts,
      outcome: "cancelled",
      errorClass: "SEALED_MODE",
      bytesOut: null,
      bytesIn: null,
    });
    return error;
  }
  return refuse({ task: "unattributed", host, attributed: false });
}

function onSealChanged(sealed) {
  if (sealed === true) tally.blockedSinceSealed = 0;
}
const counters = () => ({ ...tally });

function assertTestProcess() {
  if (!process.env.NODE_TEST_CONTEXT) throw new Error("Egress test controls require node:test");
}
function _resetForTests() {
  assertTestProcess();
  for (const ticket of active.values()) ticket._cleanupForTests();
  for (const abort of pendingBodies) abort(new DOMException("Test reset", "AbortError"));
  pendingBodies.clear();
  generation++;
  ticketContext.disable();
  attemptContext.disable();
  taskContext.disable();
  metaContext.disable();
  config = { isSealed: () => true, recorder: null, now: Date.now };
  active = new Map();
  byTag = new Map();
  nextId = 1;
  tally = freshTally();
  bypass = false;
  events.removeAllListeners();
}
function _setBypassForTests(on) {
  assertTestProcess();
  bypass = on === true;
}

module.exports = {
  EGRESS_TAG_HEADER,
  configureEgress,
  attachRecorder,
  getRecorder,
  isSealed,
  withTask,
  withContext,
  currentTask,
  currentTicket,
  runWithTicket,
  authorize,
  assertAllowed,
  guard,
  guardResponse,
  meteredFetch,
  tagHeaders,
  ticketByTag,
  abortAllRemote,
  activeRemoteCount,
  recordUnattributed,
  recordBackstopBlock,
  onSealChanged,
  counters,
  events,
  _resetForTests,
  _setBypassForTests,
};
