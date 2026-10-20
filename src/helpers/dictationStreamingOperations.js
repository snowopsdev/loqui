// Ephemeral main connection ownership. The tuple matches Plan04's published
// operation contract; it is not a recording/session/Undo authority.
function createDictationStreamingOperations(ipcMain, host) {
  const rows = new Map([
    ["dictation-realtime", "_dictationStreaming"],
    ["assemblyai-streaming", "assemblyAiStreaming"],
    ["deepgram-streaming", "deepgramStreaming"],
    ["gemini-streaming", "geminiStreaming"],
    ["corti-streaming", "cortiStreaming"],
  ]);
  const current = new Map(),
    stops = new Map(),
    attempts = new WeakMap();
  let disposed = false;
  const stale = () => ({
    success: false,
    reason: "stale-session",
    error: "Streaming operation ended",
  });
  const identityOf = (value = {}) => {
    const keys = ["correlationId", "dictationSessionId", "operationId"];
    if (!keys.some((key) => value?.[key] != null)) return null;
    if (
      !keys.every(
        (key) => typeof value?.[key] === "string" && value[key] && value[key].length <= 100
      ) ||
      value.dictationSessionId !== value.correlationId
    )
      throw new Error("Invalid streaming operation identity");
    return Object.freeze(Object.fromEntries(keys.map((key) => [key, value[key]])));
  };
  const isCurrent = (record) =>
    !!record &&
    !disposed &&
    !record.closed &&
    !record.sender.isDestroyed?.() &&
    current.get(record.prefix) === record &&
    (!record.adapter || host[rows.get(record.prefix)] === record.adapter);
  const canPublish = (record) =>
    !!record &&
    !disposed &&
    !record.retired &&
    (!record.closed || !record.pending) &&
    !record.sender.isDestroyed?.() &&
    current.get(record.prefix) === record &&
    host[rows.get(record.prefix)] === record.adapter;
  const matches = (record, event, input) => {
    if (!record || record.sender !== event.sender || record.sender.isDestroyed?.()) return false;
    try {
      const identity = identityOf(input);
      return record.identity
        ? !!identity && Object.keys(identity).every((key) => identity[key] === record.identity[key])
        : identity === null; // Legacy callers can control only their own unlabeled record.
    } catch {
      return false;
    }
  };
  const release = (record) => {
    if (record.released) return;
    record.released = true;
    record.closed = true;
    record.detach?.();
    if (current.get(record.prefix) === record) current.delete(record.prefix);
    const slot = rows.get(record.prefix);
    if (host[slot] === record.adapter) host[slot] = null;
    // Disconnect can reject/throw. Reclaim the captured adapter's remaining
    // sockets/timers independently; no global slot lookup may target B.
    for (const method of ["cleanupAll", "cleanupWarmConnection", "cleanup"]) {
      try {
        record.adapter?.[method]?.();
      } catch {
        /* Continue the other cleanup leaves. */
      }
    }
  };
  const stop = (record) => {
    if (record.stopPromise) return record.stopPromise;
    record.closed = true;
    record.stopping = true;
    // Only the core handler's startup is awaited, never this teardown or the
    // surrounding start wrapper. Install before invoking reentrant adapters.
    record.stopPromise = Promise.resolve()
      .then(() => record.startPromise?.catch(() => {}))
      .then(() => stops.get(record.prefix)({ sender: record.sender }, record.identity, record))
      .catch((error) => ({ success: false, error: error.message }))
      .finally(() => release(record));
    return record.stopPromise;
  };
  const channelRow = (channel) =>
    [...rows.keys()].find((prefix) => channel.startsWith(prefix + "-"));
  const api = {
    isCurrent,
    canPublish,
    attach(record, adapter) {
      if (record) record.adapter = adapter;
    },
    handle(channel, handler) {
      const prefix = channelRow(channel),
        action = channel.slice(prefix.length + 1);
      if (action === "stop") {
        stops.set(prefix, handler);
        ipcMain.handle(channel, (event, identity) => {
          const record = current.get(prefix);
          if (!matches(record, event, identity)) return stale();
          return stop(record);
        });
      } else if (action === "start" || action === "warmup") {
        ipcMain.handle(channel, async function begin(event, options = {}) {
          const prior = current.get(prefix);
          if (disposed || event.sender.isDestroyed?.()) return stale();
          if (
            prior?.pending &&
            prior.kind === "warmup" &&
            action === "start" &&
            prior.sender === event.sender
          ) {
            if (prior.handoff) return { success: false, error: "Operation in progress" };
            prior.handoff = true;
            const selected = structuredClone(options);
            await prior.startPromise.catch(() => {});
            if (prior.stopPromise) await prior.stopPromise;
            if (
              disposed ||
              prior.ownerLost ||
              event.sender.isDestroyed?.() ||
              (current.has(prefix) && current.get(prefix) !== prior)
            )
              return stale();
            return begin(event, selected);
          }
          if (prior?.pending || prior?.stopping || (action === "warmup" && prior?.kind === "start"))
            return { success: false, error: "Operation in progress" };
          let identity;
          try {
            options = structuredClone(options);
            if (Array.isArray(options.keyterms)) Object.freeze(options.keyterms);
            options = Object.freeze(options);
            identity = identityOf(options);
          } catch (error) {
            return { success: false, error: error.message };
          }
          if (identity && action === "start") {
            const used = attempts.get(event.sender) ?? new Set();
            if (used.has(identity.operationId)) return stale();
            used.add(identity.operationId);
            attempts.set(event.sender, used);
          }
          const record = {
            prefix,
            kind: action,
            sender: event.sender,
            identity,
            options,
            pending: true,
            closed: false,
            adapter: null,
          };
          const reuseWarm =
            prior?.kind === "warmup" &&
            prior.sender === event.sender &&
            isCurrent(prior) &&
            !options.forceNew &&
            [
              "provider",
              "model",
              "mode",
              "language",
              "sampleRate",
              "keyterms",
              "environment",
              "tenant",
            ].every((key) => JSON.stringify(prior.options[key]) === JSON.stringify(options[key]));
          if (prior) {
            prior.detach?.();
            if (reuseWarm) {
              prior.closed = true;
              record.adapter = prior.adapter;
            }
          }
          current.set(prefix, record);
          const lost = () => {
            record.ownerLost = true;
            record.retired = true;
            void stop(record).catch(() => {});
          };
          record.sender.once?.("destroyed", lost);
          record.sender.once?.("did-start-navigation", lost);
          record.detach = () => {
            record.sender.removeListener?.("destroyed", lost);
            record.sender.removeListener?.("did-start-navigation", lost);
          };
          record.startPromise = Promise.resolve().then(async () => {
            if (prior && !reuseWarm) await stop(prior).catch(() => {});
            // A lost sender never starts another transport after retirement.
            if (!isCurrent(record)) return stale();
            return handler(event, options, record);
          });
          let result;
          try {
            result = await record.startPromise;
          } catch (error) {
            result = { success: false, error: error.message };
          }
          record.pending = false;
          if (!isCurrent(record) || !result?.success) {
            record.retired = true;
            await stop(record).catch(() => {});
            return result?.success ? stale() : result;
          }
          return result;
        });
      } else ipcMain.handle(channel, handler);
    },
    on(channel, handler) {
      const prefix = channelRow(channel);
      ipcMain.on(channel, (event, value, identity) => {
        const isSend = channel.endsWith("-send");
        const record = current.get(prefix);
        if (!isCurrent(record) || !matches(record, event, isSend ? identity : value)) return;
        return handler(event, value, record);
      });
    },
    dispose() {
      disposed = true;
      return Promise.allSettled([...current.values()].map(stop));
    },
  };
  return api;
}
module.exports = { createDictationStreamingOperations };
