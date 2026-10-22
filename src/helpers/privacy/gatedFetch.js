const egress = require("./egressGate");

const withTicketSignal = (init, ticket) => ({
  ...init,
  signal: init?.signal ? AbortSignal.any([init.signal, ticket.signal]) : ticket.signal,
});

// Electron net.fetch through the gate. The ticket stays open until the caller
// finishes reading the body, so sealing can interrupt it and the ledger sees
// the real outcome. The task comes from meta or the egress.withTask() context.
function gatedNetFetch(url, init = {}, { task, payload, correlationId, provider } = {}) {
  const { net } = require("electron");
  return egress.guardResponse(
    { task, target: String(url), payload, correlationId, provider },
    (ticket) =>
      // tag: true — the session backstop attributes the request to this attempt
      // and strips the tag before it leaves (Task 6).
      egress.meteredFetch(ticket, (u, i) => net.fetch(u, { ...i, useSessionCookies: false }), {
        tag: true,
      })(url, withTicketSignal(init, ticket))
  );
}

// Node global fetch through the gate, for helpers that take a fetch implementation.
function gatedNodeFetch(task, { payload, correlationId, provider } = {}) {
  return (url, init = {}) =>
    egress.guardResponse(
      { task, target: String(url), payload, correlationId, provider },
      (ticket) => egress.meteredFetch(ticket)(url, withTicketSignal(init, ticket))
    );
}

// One ticket over an exchange whose every transport is metered through
// egress.meteredFetch(ticket). An exchange that made no attempt (a cached
// answer, or a local validation failure) sent nothing, so it writes no row.
// Not for SDKs with their own unmetered transport: their sockets are
// attributed to the ticket by Layer B and must stay on the record.
function guardMetered(meta, fn) {
  return egress.guard(meta, async (ticket) => {
    try {
      return await fn(ticket);
    } finally {
      if (ticket.attemptCount() === 0) ticket.discard();
    }
  });
}

module.exports = { gatedNetFetch, gatedNodeFetch, guardMetered };
