const { randomBytes } = require("node:crypto");
const egress = require("./privacy/egressGate");
const { guardMetered } = require("./privacy/gatedFetch");
const { isSealedModeError, sealedPhaseOf } = require("./privacy/egressPolicy");

// Moved unchanged from ipcHandlers.js.
function buildMultipartBody(fileBuffer, fileName, contentType, fields = {}) {
  const boundary = `----OpenWhispr${Date.now()}`;
  const parts = [];

  parts.push(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
  );
  parts.push(fileBuffer);
  parts.push("\r\n");

  for (const [name, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item == null) continue;
      parts.push(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
          `${item}\r\n`
      );
    }
  }

  parts.push(`--${boundary}--\r\n`);

  const bodyParts = parts.map((p) => (typeof p === "string" ? Buffer.from(p) : p));
  return { body: Buffer.concat(bodyParts), boundary };
}

// Batch speech uploads (BYOK and self-hosted). The task comes from the
// handler's egress.withTask() context (dictationStt or uploadStt); correlation
// and provider come from the options, else the egress.withContext() context.
// One ticket covers the request and the body read. The request is a metered,
// tagged attempt: bytesOut is the exact multipart body length, its receipts are
// dispatched just before the transport and delivered when the response arrives,
// and sealing it mid-flight is reported as interrupted.
async function postMultipart(
  url,
  body,
  boundary,
  headers = {},
  { signal, session: fetchSession, correlationId = null, provider = null } = {}
) {
  const { net } = require("electron");
  return guardMetered(
    { target: url.toString(), payload: "audio", correlationId, provider },
    async (ticket) => {
      const send = egress.meteredFetch(ticket, (u, init) => (fetchSession ?? net).fetch(u, init), {
        tag: true,
      });
      const response = await send(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          ...headers,
        },
        body,
        useSessionCookies: false,
        signal,
      });
      const text = await response.text();
      try {
        return { statusCode: response.status, data: JSON.parse(text) };
      } catch {
        // Vercel platform errors (413 payload cap, 504 timeout) return non-JSON bodies.
        throw Object.assign(new Error(`Server error ${response.status}: ${text.slice(0, 120)}`), {
          code: "SERVER_ERROR",
          statusCode: response.status,
        });
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Realtime speech (N9/N10, Task 9a). A socket is a connection resource: it may
// be opened before any recording (warm), replaced mid-recording (reconnect,
// token rotation) or serve two meeting sources. A recording is an immutable
// handle. They have separate tickets and separate ledger rows:
// - connection: kind "connection", wire bytes counted on its own socket, no
//   correlation id, no content receipts; settles only when that socket closes.
// - recording: kind "stream", the content bytes its own frames handed to a
//   socket, one audio receipt carrying exactly that recording's correlation id.
// The recording handle is owned by the existing streaming operation record
// (dictation) or meeting session; there is no second ownership registry.
const REALTIME_EGRESS = Symbol("realtimeEgress");
const REALTIME_CONNECTION = Symbol("realtimeConnection");
const REALTIME_TARGETS = Object.freeze({
  openai: "wss://api.openai.com/v1/realtime",
  tinfoil: "wss://inference.tinfoil.sh/v1/realtime",
  deepgram: "wss://api.deepgram.com/v1/listen",
  assemblyai: "wss://streaming.assemblyai.com/v3/ws",
  gemini: "wss://generativelanguage.googleapis.com/ws",
});

// Canonical provider id, the same one Plan 04's tracker names: "openai-realtime"
// and "deepgram-realtime" are "openai" and "deepgram".
const realtimeProviderId = (provider) =>
  typeof provider === "string" && provider ? provider.replace(/-realtime$/, "") : null;

// The socket recipient, before any token or credential work. Corti's region
// follows the token helper's default; an unknown region is an unknown (remote)
// recipient, refused while sealed.
function realtimeTarget(provider, options = {}) {
  const id = realtimeProviderId(provider);
  if (id === "corti") {
    const environment = options.environment || "us";
    return ["eu", "us"].includes(environment)
      ? `wss://api.${environment}.corti.app/audio-bridge/v2/transcribe`
      : null;
  }
  return Object.hasOwn(REALTIME_TARGETS, id) ? REALTIME_TARGETS[id] : null;
}

// Refuses a realtime connection while sealed before its token fetch, its
// credential reads or any socket. The token request and the socket are each
// gated again where they happen.
function admitRealtimeConnection({ task, provider, options = {} }) {
  egress.assertAllowed({ task, target: realtimeTarget(provider, options) });
}

// The owner (dictation operation or meeting) names an adapter's task and
// provider once; every socket that adapter opens, including warm, replacement
// and reconnect sockets, is a connection for that task.
function bindRealtimeEgress(adapter, { task, provider }) {
  if (adapter) adapter[REALTIME_EGRESS] = Object.freeze({ task, provider });
  return adapter;
}

function settleConnection(ticket, failed) {
  ticket.settle(failed ? { outcome: "error", errorClass: "CONNECTION" } : { outcome: "ok" });
}

function bindConnection(socket, ticket) {
  if (!socket) {
    settleConnection(ticket, true);
    return socket;
  }
  socket[REALTIME_CONNECTION] = ticket;
  let failed = false;
  const stop = () => {
    try {
      if (typeof socket.terminate === "function") socket.terminate();
      else socket.close?.();
    } catch {
      // Its close, or the attached socket's, still settles the ticket.
    }
  };
  // Wire bytes on this connection's own socket. Layer B attaches the same
  // socket at connect for remote hosts; attachSocket is idempotent.
  socket.once?.("upgrade", (response) => {
    if (response?.socket) ticket.attachSocket(response.socket);
  });
  socket.once?.("error", () => {
    failed = true;
  });
  socket.once?.("close", () => {
    ticket.signal.removeEventListener("abort", stop);
    // With an attached socket this waits for that socket's actual close.
    settleConnection(ticket, failed);
  });
  if (ticket.signal.aborted) stop();
  else ticket.signal.addEventListener("abort", stop, { once: true });
  return socket;
}

// Authorizes and tracks only a socket connection. connect() constructs the
// socket (or resolves one, for an attested factory) inside the connection's
// ticket, so Layer B attributes its sockets and any attestation fetch to it.
function connectRealtime({ task, provider = null, target = null } = {}, connect) {
  const ticket = egress.authorize({
    task: task ?? egress.currentTask() ?? "unattributed",
    target,
    provider: realtimeProviderId(provider),
    meter: "socket",
    kind: "connection",
    payload: "metadata",
  });
  let made;
  try {
    made = egress.runWithTicket(ticket, connect);
  } catch (error) {
    settleConnection(ticket, true);
    throw error;
  }
  if (typeof made?.then === "function")
    return made.then(
      (socket) => bindConnection(socket, ticket),
      (error) => {
        settleConnection(ticket, true);
        throw error;
      }
    );
  return bindConnection(made, ticket);
}

// Adapter seam: url is the socket's actual address; an attested factory (no
// url yet) uses the bound provider's recipient.
function openRealtimeSocket(adapter, url, construct) {
  const meta = adapter?.[REALTIME_EGRESS] ?? {};
  return connectRealtime(
    { task: meta.task, provider: meta.provider, target: url ?? realtimeTarget(meta.provider) },
    construct
  );
}

const recordings = new WeakMap();

// A distinct, immutable recording handle, even when the recording rides a warm
// socket. Refused while sealed, before any frame. Its stream ticket is opened
// at the first frame, so a recording that sends nothing records nothing.
function beginRealtimeRecording({
  task,
  provider,
  target = null,
  correlationId = null,
  sessionId = null,
} = {}) {
  target = target ?? realtimeTarget(provider);
  egress.assertAllowed({ task, target });
  const handle = Object.freeze({
    token: randomBytes(16).toString("hex"),
    task,
    provider: realtimeProviderId(provider),
    target,
    correlationId: typeof correlationId === "string" && correlationId ? correlationId : null,
    sessionId: typeof sessionId === "string" && sessionId ? sessionId : null,
  });
  recordings.set(handle, {
    ticket: null,
    finished: false,
    refused: false,
    frames: 0,
    sealEpoch: egress.currentSealAbortEpoch(),
    sealedBeforeAudio: false,
  });
  return handle;
}

// Only the exact handle object minted above is live. A copy with the same
// fields, a finished handle or one whose ticket sealing cut off is refused.
function liveRecording(handle) {
  const state = handle && typeof handle === "object" ? recordings.get(handle) : null;
  return state && !state.finished && !state.ticket?.signal.aborted ? state : null;
}

// Called right before a content frame is handed to a socket. Missing, foreign,
// finished or sealed handles refuse the frame; nothing is sent.
function admitRealtimeFrame(_instance, handle) {
  const state = liveRecording(handle);
  if (!state) return false;
  if (state.ticket) return true;
  try {
    state.ticket = egress.authorize({
      task: handle.task,
      target: handle.target,
      provider: handle.provider,
      meter: "socket",
      kind: "stream",
      payload: "audio",
      correlationId: handle.correlationId,
    });
  } catch {
    // Sealed (one blocked row): this recording sends nothing further.
    state.refused = true;
    state.finished = true;
    return false;
  }
  return true;
}

// After the adapter forwarded a frame to its socket: updates only this handle.
// Never looks a ticket up by provider, task or adapter state.
function markRealtimeDispatched(instance, handle, bytes) {
  const state = liveRecording(handle);
  if (!state?.ticket) return false;
  const connection = instance?.ws?.[REALTIME_CONNECTION];
  if (connection?.host) state.ticket.addHost(connection.host);
  state.ticket.markDispatched();
  state.ticket.addBytes({ out: Number.isFinite(bytes) && bytes >= 0 ? bytes : null });
  state.frames++;
  return true;
}

// Settles only this recording, after its flush/stop acknowledgement, stop,
// error or cancellation. A seal already settled it as interrupted.
function finishRealtimeRecording(handle, outcome = "ok") {
  const state = handle && typeof handle === "object" ? recordings.get(handle) : null;
  if (!state || state.finished) return;
  state.finished = true;
  // Sealing happened while this recording was live and before any audio of it
  // left: its connection was cut, so the stop cannot be an empty success.
  if (!state.ticket && egress.currentSealAbortEpoch() !== state.sealEpoch)
    state.sealedBeforeAudio = true;
  const ticket = state.ticket;
  if (!ticket || ticket.settled) return;
  if (state.frames === 0) {
    ticket.discard();
    return;
  }
  ticket.settle(
    outcome === "ok"
      ? { outcome: "ok" }
      : outcome === "cancelled"
        ? { outcome: "cancelled", errorClass: "ABORTED" }
        : { outcome: "error", errorClass: "CONNECTION" }
  );
}

// "interrupted" when sealing cut off a recording that had dispatched audio
// (never "nothing was sent"); "refused" when sealing stopped it before any.
function realtimeRecordingPhase(handle) {
  const state = handle && typeof handle === "object" ? recordings.get(handle) : null;
  if (!state) return null;
  const reason = state.ticket?.signal.aborted ? state.ticket.signal.reason : null;
  if (isSealedModeError(reason)) return state.frames > 0 ? "interrupted" : "refused";
  // Sealed after connect, before this recording's first frame: none of its
  // audio was sent, but the provider already had its session (connection,
  // setup and any keyterms), so this is never reported as "nothing was sent".
  const sealedSince =
    state.sealedBeforeAudio ||
    (state.frames === 0 && egress.currentSealAbortEpoch() !== state.sealEpoch);
  if (sealedSince) return "interrupted";
  return state.refused ? "refused" : null;
}

const sealedFields = (phase) => ({
  code: "SEALED_MODE",
  phase,
  messageKey:
    phase === "interrupted" ? "sealedMode.interrupted.generic" : "sealedMode.blocked.generic",
});

// Sealed-mode envelope fields for a stop/start result of this recording.
function realtimeSealedFields(handle) {
  const phase = realtimeRecordingPhase(handle);
  return phase ? sealedFields(phase) : {};
}

// A realtime start/prepare failure. A typed refusal keeps its phase. Sealing
// that cut off a token, handshake or socket after admission surfaces as a plain
// transport error; it is reported as interrupted, never as "nothing was sent".
function realtimeFailureFields(error, handle = null) {
  if (isSealedModeError(error)) return sealedFields(sealedPhaseOf(error));
  const own = realtimeSealedFields(handle);
  if (own.code) return own;
  return egress.isSealed() ? sealedFields("interrupted") : {};
}

module.exports = {
  buildMultipartBody,
  postMultipart,
  realtimeProviderId,
  realtimeTarget,
  admitRealtimeConnection,
  bindRealtimeEgress,
  connectRealtime,
  openRealtimeSocket,
  beginRealtimeRecording,
  admitRealtimeFrame,
  markRealtimeDispatched,
  finishRealtimeRecording,
  realtimeRecordingPhase,
  realtimeSealedFields,
  realtimeFailureFields,
};
