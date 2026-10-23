const fs = require("node:fs");
const gate = require("./egressGate");
const { toCsv, MAX_ROWS } = require("./flightRecorder");

function startOfToday(ms) {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}
function attachPrivacyIPC({
  ipcMain,
  BrowserWindow,
  dialog,
  state,
  recorder,
  attest,
  transition,
  isTrustedSender,
  confirm,
  now = Date.now,
}) {
  const windows = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  const broadcast = (channel, payload) => {
    for (const w of windows()) {
      try {
        if (!isTrustedSender({ sender: w.webContents, senderFrame: w.webContents.mainFrame }))
          continue;
        w.webContents.send(channel, payload);
      } catch {
        /* Closing windows cannot break main's barrier. */
      }
    }
  };
  const broadcastAttestation = () => broadcast("privacy:attestation", attest());
  const channels = [];
  let disposed = false;
  const trusted = (event) => {
    if (disposed || !isTrustedSender(event)) throw new Error("PRIVACY_SENDER_REFUSED");
  };
  const handle = (name, fn) => {
    const channel = `privacy:${name}`;
    channels.push(channel);
    ipcMain.handle(channel, (event, ...args) => {
      trusted(event);
      return fn(event, ...args);
    });
  };
  const range = (options) => {
    if (
      options !== undefined &&
      (!options || typeof options !== "object" || Array.isArray(options))
    )
      throw new TypeError("INVALID_PRIVACY_RANGE");
    if (options && Object.keys(options).some((key) => !["since", "limit"].includes(key)))
      throw new TypeError("INVALID_PRIVACY_RANGE");
    const since = options?.since ?? startOfToday(now());
    const limit = options?.limit ?? 500;
    if (
      !Number.isSafeInteger(since) ||
      since < 0 ||
      since > 8640000000000000 ||
      !Number.isSafeInteger(limit) ||
      limit < 1
    )
      throw new TypeError("INVALID_PRIVACY_RANGE");
    return { since, limit: Math.min(limit, 5000) };
  };
  // Only a read failure hides the records. A pending write failure leaves them
  // readable; the summary says the list may be incomplete, and clear and
  // export stay available (final review I5).
  const readable = () => {
    if (recorder.readError) throw new Error("PRIVACY_RECORDER_UNAVAILABLE");
  };
  let queue = Promise.resolve();
  let intent = 0;
  const serialize = (fn) => {
    const result = queue.then(fn, fn);
    queue = result.catch(() => {});
    return result;
  };
  handle("get-sealed", () => state.isSealed());
  handle("attestation", () => attest());
  handle("set-sealed", (event, sealed) => {
    if (typeof sealed !== "boolean") throw new TypeError("sealed must be a boolean");
    const request = ++intent;
    // Close admission even while a native confirmation or another barrier is
    // pending. An earlier pending unseal cannot undo this newer seal intent.
    const sealing = sealed ? transition.apply(true) : null;
    // Observe promptly even if a dialog delays this request's serialized reply.
    sealing?.catch(() => {});
    return serialize(async () => {
      trusted(event);
      if (!sealed && state.isSealed()) {
        if (!(await confirm.unseal(event))) return { ...attest(), declined: true };
        trusted(event);
        if (request !== intent) return { ...attest(), declined: true };
      }
      await (sealing ?? transition.apply(false));
      broadcast("privacy:sealed-changed", state.isSealed());
      return attest();
    });
  });
  handle("egress-list", (_event, options) => {
    const rows = recorder.list(range(options));
    readable();
    return rows;
  });
  handle("egress-summary", (_event, options) => {
    const result = recorder.summary({ since: range(options).since });
    readable();
    return { ...result, persistError: recorder.persistError ?? null };
  });
  handle("egress-clear", (event) =>
    serialize(async () => {
      trusted(event);
      const count = recorder.list({ since: 0, limit: MAX_ROWS }).length;
      readable();
      if (!(await confirm.clear(count, event))) return false;
      trusted(event);
      if (recorder.clear() === false) throw new Error("PRIVACY_RECORDER_UNAVAILABLE");
      readable();
      return true;
    })
  );
  handle("egress-export", (event) =>
    serialize(async () => {
      trusted(event);
      const stamp = new Date(now()).toISOString().slice(0, 10);
      let selection;
      try {
        selection = await dialog.showSaveDialog({
          defaultPath: `loqui-flight-recorder-${stamp}.csv`,
          filters: [{ name: "CSV", extensions: ["csv"] }],
        });
      } catch {
        throw new Error("PRIVACY_EXPORT_FAILED");
      }
      const { canceled, filePath } = selection;
      if (canceled || !filePath) return { saved: false };
      trusted(event);
      const rows = recorder.list({ since: 0, limit: MAX_ROWS });
      readable();
      try {
        fs.writeFileSync(filePath, toCsv(rows), { mode: 0o600 });
      } catch {
        throw new Error("PRIVACY_EXPORT_FAILED");
      }
      return { saved: true };
    })
  );
  let pending = null;
  const onSettled = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      transition.recheck();
      broadcastAttestation();
    }, 50);
    pending.unref?.();
  };
  const onEvent = (event) => broadcast("privacy:egress-event", { phase: "recorded", event });
  const relay = (phase) => (notice) => broadcast("privacy:egress-event", { phase, ...notice });
  const onDispatched = relay("dispatched");
  const onDelivered = relay("delivered");
  const onUndelivered = relay("undelivered");
  const onCleared = () => broadcast("privacy:egress-cleared");
  recorder.on("event", onEvent);
  recorder.on("cleared", onCleared);
  gate.events.on("dispatched", onDispatched);
  gate.events.on("delivered", onDelivered);
  gate.events.on("undelivered", onUndelivered);
  gate.events.on("settled", onSettled);
  const offTransition = transition.on("change", broadcastAttestation);
  const poll = setInterval(() => {
    if (transition.snapshot().phase === "sealing") transition.recheck();
  }, 500);
  poll.unref?.();
  return {
    broadcastAttestation,
    dispose() {
      disposed = true;
      clearTimeout(pending);
      clearInterval(poll);
      for (const channel of channels) ipcMain.removeHandler(channel);
      recorder.off("event", onEvent);
      recorder.off("cleared", onCleared);
      gate.events.off("dispatched", onDispatched);
      gate.events.off("delivered", onDelivered);
      gate.events.off("undelivered", onUndelivered);
      gate.events.off("settled", onSettled);
      if (typeof offTransition === "function") offTransition();
    },
  };
}
module.exports = { attachPrivacyIPC };
