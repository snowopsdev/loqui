// Main-only, per-adapter content authority. Meeting adapters remain ungated;
// dictation adapters get a closed gate before any async setup can run.
const { admitRealtimeFrame, markRealtimeDispatched } = require("./sttTransport");
const STATE = Symbol("dictationFirstFrame");
const BORROWED = Symbol("borrowedAudio");
// Buffered audio (cold-start, pre-config, replay, aggregation) keeps the
// recording it was captured for, so a later flush is attributed to that
// recording and never to whichever recording owns the adapter at flush time.
const HELD = new WeakMap();
function holdFrame(frame, recording) {
  if (frame && typeof frame === "object" && recording) HELD.set(frame, recording);
  return frame;
}
const heldRecording = (frame) =>
  frame && typeof frame === "object" ? (HELD.get(frame) ?? null) : null;
function firstFrameHandOff(sender, correlationId, owns = () => true) {
  if (typeof correlationId !== "string" || !correlationId || correlationId.length > 100)
    return null;
  let sent = false;
  return () => {
    if (sent || !owns() || sender?.isDestroyed?.()) return;
    sent = true;
    sender?.send?.("dictation-dispatch", { correlationId, task: "dictationStt", payload: "audio" });
  };
}
function armFirstFrame(adapter, handOff) {
  if (adapter) adapter[STATE] = { handOff, done: false };
}
function contentFrameLeaving(adapter) {
  if (!egressOpen(adapter)) return false;
  const state = adapter[STATE];
  if (state && !state.done) {
    state.done = true;
    state.handOff?.();
  }
  return true;
}
function disarmFirstFrame(adapter) {
  if (adapter) adapter[STATE] = null;
}
function egressOpen(adapter) {
  return adapter._egressGate?.() !== false;
}
function zeroAudio(value) {
  if (ArrayBuffer.isView(value))
    new Uint8Array(value.buffer, value.byteOffset, value.byteLength).fill(0);
  else if (value instanceof ArrayBuffer) new Uint8Array(value).fill(0);
}
function discardPendingAudio(adapter) {
  for (const frame of adapter._reconnectingAudio ?? []) zeroAudio(frame);
  adapter._reconnectingAudio = null;
  for (const key of ["coldStartBuffer", "replayBuffer", "preConfigBuffer", "pendingAudio"]) {
    if (!Array.isArray(adapter[key])) continue;
    for (const frame of adapter[key]) zeroAudio(frame);
    adapter[key] = [];
  }
  for (const key of [
    "coldStartBufferSize",
    "replayBufferSize",
    "preConfigBufferSize",
    "pendingAudioBytes",
  ])
    if (key in adapter) adapter[key] = 0;
  // ws still owns any borrowed frames until its completion callback. Every
  // completion (ordinary transmission, close or failure) erases that copy.
}

// The actual content hand-off (Task 9a): a frame leaves only for a live
// recording handle passed with it, and is attributed to that handle only after
// the socket accepted it.
function sendContentFrame(adapter, data, recording) {
  if (!egressOpen(adapter)) {
    discardPendingAudio(adapter);
    return false;
  }
  if (!admitRealtimeFrame(adapter, recording)) return false;
  if (!ArrayBuffer.isView(data) && !(data instanceof ArrayBuffer)) {
    if (!contentFrameLeaving(adapter)) return false;
    adapter.ws.send(data);
    markRealtimeDispatched(adapter, recording, Buffer.byteLength(String(data)));
    return true;
  }
  const copy = Buffer.from(
    new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength)
  );
  const entry = { copy };
  (adapter[BORROWED] ??= new Set()).add(entry);
  const done = () => {
    zeroAudio(copy);
    adapter[BORROWED].delete(entry);
  };
  try {
    if (!contentFrameLeaving(adapter)) {
      done();
      discardPendingAudio(adapter);
      return false;
    }
    adapter.ws.send(copy, done);
  } catch (error) {
    done();
    throw error;
  }
  markRealtimeDispatched(adapter, recording, copy.byteLength);
  return true;
}
module.exports = {
  firstFrameHandOff,
  armFirstFrame,
  contentFrameLeaving,
  disarmFirstFrame,
  egressOpen,
  zeroAudio,
  discardPendingAudio,
  sendContentFrame,
  holdFrame,
  heldRecording,
};
