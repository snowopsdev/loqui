// D3: a cancelled dictation is held in RAM only, for a short undo window, and
// zeroed when the window closes. The buffer owns byte copies of every source;
// a copy that completes after the buffer was zeroed is zeroed on arrival.
export const UNDO_WINDOW_MS = 5000;
export const LONG_UNDO_WINDOW_MS = 10000;
export const LONG_RECORDING_SECONDS = 30;
export const REPLAY_BATCH_FRAMES = 4;
export const REPLAY_PACE_MS = 50;
// Restore waits this long for the recorder's final chunk before it gives up and keeps the hold (R2-C1).
export const FINAL_AUDIO_WAIT_MS = 5000;
// With retention on, closing waits this long for in-flight copies, then saves what it has (R1-I1).
export const CLOSE_SAVE_WAIT_MS = 3000;

export function undoWindowMs(durationSeconds) {
  return Number(durationSeconds) > LONG_RECORDING_SECONDS ? LONG_UNDO_WINDOW_MS : UNDO_WINDOW_MS;
}

export function createCancelBuffer({
  session,
  kind,
  mimeType,
  durationSeconds,
  analyticsOccurredAt,
  tracker = null,
  context = null,
}) {
  const owned = []; // { role, bytes: Uint8Array }
  const frames = []; // Int16Array, transferred from the worklet
  const pending = new Set(); // byte copies in flight
  const expected = new Set(); // sources that have not delivered yet (the recorder's final chunk)
  let zeroed = false;
  const track = (promise, set) => {
    set.add(promise);
    promise.then(
      () => set.delete(promise),
      () => set.delete(promise)
    );
  };

  const buffer = {
    session,
    kind,
    mimeType: mimeType || "audio/webm",
    durationSeconds,
    analyticsOccurredAt,
    tracker,
    // Task 6's session context (press-time selection and screenshot). zero() never releases it:
    // a restore hands it back to the session. _closeCancelled releases it.
    context,
    adoptBlob(blob, role) {
      if (!blob) return;
      const slot = { role, bytes: null };
      if (!zeroed) owned.push(slot);
      let result;
      try {
        result = blob.arrayBuffer();
      } catch {
        return;
      }
      const copy = Promise.resolve(result)
        .then((arrayBuffer) => {
          const bytes = new Uint8Array(arrayBuffer);
          if (zeroed) bytes.fill(0);
          else slot.bytes = bytes;
        })
        .catch(() => {});
      track(copy, pending);
    },
    /**
     * Registers audio that will arrive later: MediaRecorder's final dataavailable/onstop
     * lands after cancel returns. Call it before the window opens, so `ready()` waits for
     * it. Exactly one of deliver/fail settles it; later calls are ignored.
     */
    expect(role) {
      let settle;
      const gate = new Promise((resolve) => (settle = resolve));
      track(gate, expected);
      let done = false;
      return {
        deliver(blob) {
          if (done) return;
          done = true;
          buffer.adoptBlob(blob, role); // registers its copy before the gate opens
          settle();
        },
        fail() {
          if (done) return;
          done = true;
          settle();
        },
      };
    },
    adoptFrames(list) {
      for (const frame of list) {
        if (zeroed) frame.fill(0);
        else frames.push(frame);
      }
    },
    /**
     * Resolves true once every expected source has delivered and every copy has settled
     * (rejected copies count as settled). Resolves false if `until` settles first.
     */
    async ready({ until } = {}) {
      const drained = (async () => {
        while (expected.size || pending.size) await Promise.all([...expected, ...pending]);
        return true;
      })();
      return until ? Promise.race([drained, until.then(() => false)]) : drained;
    },
    awaiting: () => expected.size > 0,
    bytes: (role) => owned.filter((o) => o.role === role && o.bytes).map((o) => o.bytes),
    frames: () => [...frames],
    zero() {
      zeroed = true;
      buffer.releaseSources?.();
      buffer.releaseSources = null;
      owned.forEach((o) => o.bytes?.fill(0));
      owned.length = 0;
      frames.forEach((f) => f.fill(0));
      frames.length = 0;
    },
    isZeroed: () => zeroed,
  };
  return buffer;
}

export function createUndoWindow({
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onClose,
} = {}) {
  let current = null; // { buffer, expiresAt, remainingMs, timer }
  const closing = new Set(); // closes still saving; a flush joins them (R1-I9)
  const wait = (ms) => new Promise((resolve) => setTimer(resolve, ms));

  // onClose decides when the bytes may be zeroed. It zeroes at once when nothing will be
  // saved, and otherwise right after copying them into Blobs (R1-I1). The final zero()
  // here covers an onClose that throws.
  const close = (buffer, reason) => {
    const done = (async () => {
      try {
        await onClose?.(buffer, reason, { wait });
      } finally {
        buffer.zero();
      }
    })();
    closing.add(done);
    done.then(
      () => closing.delete(done),
      () => closing.delete(done)
    );
    return done;
  };

  const end = (reason) => {
    if (!current) return Promise.resolve();
    const entry = current;
    current = null;
    clearTimer(entry.timer);
    return close(entry.buffer, reason);
  };

  return {
    open(buffer) {
      if (current) void end("replaced").catch(() => {});
      const ms = undoWindowMs(buffer.durationSeconds);
      current = {
        buffer,
        expiresAt: now() + ms,
        remainingMs: null,
        timer: setTimer(() => void end("expired").catch(() => {}), ms),
      };
    },
    peek: () => current?.buffer ?? null,
    take() {
      if (!current) return null;
      const { buffer, timer } = current;
      clearTimer(timer);
      current = null;
      return buffer;
    },
    pause() {
      if (!current || current.remainingMs !== null) return;
      clearTimer(current.timer);
      current.remainingMs = Math.max(0, current.expiresAt - now());
    },
    resume() {
      if (!current || current.remainingMs === null) return;
      const ms = current.remainingMs;
      current.remainingMs = null;
      current.expiresAt = now() + ms;
      current.timer = setTimer(() => void end("expired").catch(() => {}), ms);
    },
    /** Closes the open window and joins every close still saving, including earlier ones. */
    async expireNow() {
      void end("flushed").catch(() => {});
      while (closing.size) await Promise.all([...closing]);
    },
    /** Closes a buffer that is not (or no longer) in the window, through the same path. */
    discard: (buffer, reason) => close(buffer, reason),
    state() {
      if (!current) return null;
      const paused = current.remainingMs !== null;
      return {
        undoUntil: current.expiresAt,
        paused,
        remainingMs: paused ? current.remainingMs : Math.max(0, current.expiresAt - now()),
      };
    },
  };
}
