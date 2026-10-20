const crypto = require("node:crypto");
const {
  firstFrameHandOff,
  armFirstFrame,
  disarmFirstFrame,
  zeroAudio,
} = require("./streamingHandOff");

// One main authority: captured sender/attempt/adapter plus the complete main
// credential/configuration fingerprint. Setup and ordinary dictation share it.
function createDictationStreamingOperations(
  ipcMain,
  host,
  {
    OpenAIRealtimeStreaming,
    AssemblyAiStreaming,
    DeepgramStreaming,
    GeminiLiveStreaming,
    CortiStreaming,
    TINFOIL_REALTIME_MODEL,
    GEMINI_LIVE_MODEL,
    createTinfoilRealtimeSocket,
    fetchRealtimeToken,
    streamingStartFailure,
  }
) {
  const streamingOperationError = (message) =>
    Object.assign(new Error(message), {
      messageKey: "voiceOverlay.errors.streamingUnavailable",
    });
  let disposed = false;
  // All dictation streaming channels use one admission policy. Each record
  // owns its exact adapter, webContents and attempt across every await. The
  // separate meeting transport family never enters this registry.
  const dictationOperations = new Map();
  const dictationWarm = new Map();
  const usedStreamingAttempts = new WeakMap();
  let dictationGeneration = 0;
  const rows = [
    {
      id: "realtime",
      prefix: "dictation-realtime",
      slot: "_dictationStreaming",
      Ctor: OpenAIRealtimeStreaming,
    },
    {
      id: "assemblyai",
      prefix: "assemblyai-streaming",
      slot: "assemblyAiStreaming",
      Ctor: AssemblyAiStreaming,
    },
    {
      id: "deepgram",
      prefix: "deepgram-streaming",
      slot: "deepgramStreaming",
      Ctor: DeepgramStreaming,
    },
    {
      id: "gemini",
      prefix: "gemini-streaming",
      slot: "geminiStreaming",
      Ctor: GeminiLiveStreaming,
    },
    { id: "corti", prefix: "corti-streaming", slot: "cortiStreaming", Ctor: CortiStreaming },
  ];
  const normalizeStreaming = (row, input) => {
    const provider = row.id === "realtime" ? input.provider || "openai-realtime" : row.id;
    if (row.id === "realtime" && !["openai-realtime", "tinfoil-realtime"].includes(provider))
      throw streamingOperationError("Unsupported realtime provider");
    const model =
      row.id === "realtime"
        ? input.model ||
          (provider === "tinfoil-realtime" ? TINFOIL_REALTIME_MODEL : "gpt-4o-mini-transcribe")
        : row.id === "gemini"
          ? input.model || GEMINI_LIVE_MODEL
          : row.id === "deepgram"
            ? input.model || "nova-3"
            : row.id === "corti"
              ? "corti-transcribe"
              : input.model || "universal-streaming-multilingual";
    const options = structuredClone({
      ...input,
      provider,
      model,
      mode: input.mode || "byok",
      sampleRate: input.sampleRate || 16000,
    });
    if (Array.isArray(options.keyterms)) Object.freeze(options.keyterms);
    return Object.freeze(options);
  };
  const streamingAuthority = (options) => {
    const getters = {
      "openai-realtime": ["getOpenAIKey"],
      "tinfoil-realtime": ["getTinfoilKey"],
      deepgram: ["getDeepgramKey"],
      assemblyai: ["getAssemblyAIKey"],
      gemini: ["getGeminiKey"],
      corti: ["getCortiClientId", "getCortiClientSecret"],
    };
    const credentials = getters[options.provider].map((name) => host.environmentManager[name]());
    if (credentials.some((value) => typeof value !== "string" || !value))
      throw Object.assign(new Error("Configure the selected speech provider in Settings."), {
        code: "NO_API",
      });
    // This hash never leaves main. Unlike enterprise recipient tags it also
    // binds the current secret material, so rotation invalidates warm reuse.
    const config = { ...options };
    for (const key of ["correlationId", "dictationSessionId", "operationId", "forceNew", "preview"])
      delete config[key];
    return crypto
      .createHash("sha256")
      .update(
        JSON.stringify([Object.entries(config).sort(([a], [b]) => a.localeCompare(b)), credentials])
      )
      .digest("hex");
  };
  const alive = (record) => !disposed && !record.cancelled && !record.sender.isDestroyed?.();
  const owns = (row, record) =>
    alive(record) &&
    dictationOperations.get(row.id) === record &&
    host[row.slot] === record.adapter;
  const contentAuthorized = (row, record) => {
    if (!owns(row, record)) return false;
    try {
      if (streamingAuthority(record.options) === record.authority) return true;
    } catch {
      // Removed/unreadable authority is a refusal, never a warm fallback.
    }
    record.cancelled = true;
    record.adapter.discardPendingAudio();
    return false;
  };
  const warmTransportReady = (row, record) => {
    const adapter = record.adapter;
    // A current Deepgram adapter may rotate its warm socket after a guarded
    // token refresh. Ownership remains the captured adapter and authority;
    // readiness must inspect that adapter's current transport, not its retired socket.
    const socket = row.id === "deepgram" ? adapter.warmConnection : record.transport;
    if (host[row.slot] !== adapter || !socket || socket.readyState !== 1) return false;
    return ["realtime", "gemini"].includes(row.id)
      ? adapter.isConnected && adapter.ws === socket
      : adapter.warmConnection === socket && adapter.hasWarmConnection();
  };
  const identityMatches = (record, event, identity) =>
    record &&
    record.sender === event.sender &&
    (record.operationId
      ? identity?.operationId === record.operationId &&
        identity?.dictationSessionId === record.correlationId &&
        identity?.correlationId === record.correlationId
      : !identity?.operationId && !identity?.correlationId && !identity?.dictationSessionId);
  const releaseAdapter = (adapter) => {
    if (!adapter) return;
    adapter.setEgressGate(() => false);
    adapter.setLifecycleGate(() => false);
    adapter.discardPendingAudio();
    disarmFirstFrame(adapter);
    adapter.cleanupAll?.();
    adapter.cleanupWarmConnection?.();
    adapter.cleanup();
  };
  const watchStreamingOwner = (row, record, registry) => {
    const lost = () => {
      if (registry.get(row.id) !== record) return;
      record.cancelled = true;
      record.detachOwner?.();
      clearTimeout(record.idleTimer);
      releaseAdapter(record.adapter);
      registry.delete(row.id);
      if (host[row.slot] === record.adapter) host[row.slot] = null;
    };
    record.sender.once?.("destroyed", lost);
    record.sender.once?.("did-start-navigation", lost);
    record.detachOwner = () => {
      record.sender.removeListener?.("destroyed", lost);
      record.sender.removeListener?.("did-start-navigation", lost);
    };
  };
  const bindCallbacks = (row, record) => {
    const emit = (suffix, data) => {
      if (!owns(row, record)) return;
      const channel =
        row.id === "realtime"
          ? `dictation-realtime-${suffix}`
          : `${row.id}-${suffix === "partial" ? "partial-transcript" : suffix === "final" ? "final-transcript" : suffix}`;
      record.sender.send(channel, data);
      if (row.id === "realtime" && record.options.preview) {
        if (suffix === "partial" && data) host.windowManager.showTranscriptionPreview(data);
        if (suffix === "error" || suffix === "session-end")
          host.windowManager.hideTranscriptionPreview();
      }
    };
    record.adapter.onPartialTranscript = (text) => emit("partial", text);
    record.adapter.onFinalTranscript = (text) => emit("final", text);
    record.adapter.onError = (error) => emit("error", error.message);
    record.adapter.onSessionEnd = (data) => emit("session-end", data || {});
  };
  const acquireStreamingToken = async (row, event, options) => {
    if (row.id === "corti") return host._mintStoredCortiToken(options);
    const provider = row.id === "realtime" ? options.provider : `${row.id}-realtime`;
    return { token: await fetchRealtimeToken(event, { ...options, provider }) };
  };
  const connectOwnedStreaming = async (row, record, material, warm = false) => {
    const adapter = record.adapter;
    const options = record.options;
    if (row.id === "realtime") {
      if (options.provider === "tinfoil-realtime")
        await adapter.connect({
          apiKey: material.token,
          model: options.model,
          inputRate: 16000,
          createSocket: () =>
            createTinfoilRealtimeSocket({ model: options.model, apiKey: material.token }),
        });
      else
        await adapter.connect({
          apiKey: material.token,
          model: options.model,
          captureRate: 16000,
          preconfigured: false,
        });
    } else if (row.id === "gemini") {
      await adapter.connect({
        ...options,
        token: material.token,
        refreshToken: async () => {
          if (!owns(row, record) || streamingAuthority(options) !== record.authority)
            throw streamingOperationError("Streaming operation ended");
          const next = await acquireStreamingToken(row, { sender: record.sender }, options);
          if (!owns(row, record) || streamingAuthority(options) !== record.authority)
            throw streamingOperationError("Streaming operation ended");
          return next.token;
        },
      });
    } else {
      const args = { ...options, ...material };
      if (warm) await adapter.warmup(args);
      else await adapter.connect(args);
    }
  };
  for (const row of rows) {
    ipcMain.handle(`${row.prefix}-warmup`, async (event, input = {}) => {
      if (dictationOperations.has(row.id))
        return { success: false, error: "Operation in progress" };
      let record;
      try {
        const options = normalizeStreaming(row, input);
        const authority = streamingAuthority(options);
        const prior = dictationWarm.get(row.id);
        if (
          prior &&
          prior.sender === event.sender &&
          prior.authority === authority &&
          alive(prior)
        ) {
          await prior.promise;
          if (
            dictationWarm.get(row.id) !== prior ||
            dictationOperations.has(row.id) ||
            !alive(prior) ||
            streamingAuthority(options) !== authority
          )
            throw streamingOperationError("Streaming warmup superseded");
          if (warmTransportReady(row, prior)) return { success: true, alreadyWarm: true };
        }
        if (prior) {
          prior.cancelled = true;
          clearTimeout(prior.idleTimer);
          prior.detachOwner?.();
          releaseAdapter(prior.adapter);
        }
        const adapter = new row.Ctor();
        adapter.setEgressGate(() => false);
        record = {
          generation: ++dictationGeneration,
          sender: event.sender,
          options,
          authority,
          correlationId: options.correlationId,
          operationId: options.operationId,
          adapter,
          cancelled: false,
        };
        dictationWarm.set(row.id, record);
        watchStreamingOwner(row, record, dictationWarm);
        adapter.setLifecycleGate(() => {
          try {
            return (
              alive(record) &&
              (dictationWarm.get(row.id) === record ||
                dictationOperations.get(row.id)?.adapter === adapter) &&
              streamingAuthority(options) === authority
            );
          } catch {
            return false;
          }
        });
        host[row.slot] = adapter;
        if (row.id === "deepgram")
          adapter.setTokenRefreshFn(async () => {
            const current = () =>
              alive(record) &&
              (dictationWarm.get(row.id) === record ||
                dictationOperations.get(row.id)?.adapter === adapter) &&
              host[row.slot] === adapter &&
              streamingAuthority(options) === authority;
            if (!current()) throw streamingOperationError("Streaming operation ended");
            const material = await acquireStreamingToken(row, event, options);
            if (!current()) throw streamingOperationError("Streaming operation ended");
            return material.token;
          });
        record.promise = (async () => {
          const material = await acquireStreamingToken(row, event, options);
          if (
            dictationWarm.get(row.id) !== record ||
            !alive(record) ||
            streamingAuthority(options) !== authority
          )
            throw streamingOperationError("Streaming warmup superseded");
          await connectOwnedStreaming(row, record, material, true);
          if (!alive(record) || dictationWarm.get(row.id) !== record) {
            releaseAdapter(adapter);
            throw streamingOperationError("Streaming warmup superseded");
          }
          record.transport = ["realtime", "gemini"].includes(row.id)
            ? adapter.ws
            : adapter.warmConnection;
          if (
            dictationWarm.get(row.id) !== record ||
            !alive(record) ||
            streamingAuthority(options) !== authority ||
            !warmTransportReady(row, record)
          )
            throw streamingOperationError("Streaming warmup superseded");
        })();
        await record.promise;
        record.idleTimer = setTimeout(
          () => {
            if (dictationWarm.get(row.id) !== record) return;
            record.cancelled = true;
            record.detachOwner?.();
            releaseAdapter(record.adapter);
            dictationWarm.delete(row.id);
            if (host[row.slot] === record.adapter) host[row.slot] = null;
          },
          5 * 60 * 1000
        );
        record.idleTimer.unref?.();
        return { success: true };
      } catch (error) {
        if (record && dictationWarm.get(row.id) === record) {
          dictationWarm.delete(row.id);
          record.detachOwner?.();
          releaseAdapter(record.adapter);
          if (host[row.slot] === record.adapter) host[row.slot] = null;
        }
        return streamingStartFailure(error);
      }
    });
    ipcMain.handle(`${row.prefix}-start`, async (event, input = {}) => {
      const prior = dictationOperations.get(row.id);
      if (prior?.pending || prior?.stopping || disposed)
        return { success: false, error: "Operation in progress" };
      let record;
      try {
        const options = normalizeStreaming(row, input);
        const labeled =
          options.correlationId != null ||
          options.dictationSessionId != null ||
          options.operationId != null;
        if (
          labeled &&
          (typeof options.correlationId !== "string" ||
            !options.correlationId ||
            options.correlationId.length > 100 ||
            options.dictationSessionId !== options.correlationId ||
            typeof options.operationId !== "string" ||
            !options.operationId ||
            options.operationId.length > 100)
        )
          throw streamingOperationError("Invalid streaming operation identity");
        const authority = streamingAuthority(options);
        record = {
          generation: ++dictationGeneration,
          sender: event.sender,
          options,
          authority,
          correlationId: options.correlationId,
          operationId: options.operationId,
          adapter: null,
          cancelled: false,
          pending: true,
        };
        // Stop can retire a pending attempt before its credential/socket
        // await settles. Its public Start must settle independently of that
        // old transport, without letting a late continuation reclaim a replay.
        record.ended = new Promise((_, reject) => {
          record.endPending = () => reject(streamingOperationError("Streaming operation ended"));
        });
        record.ended.catch(() => {});
        const pending = (promise) => Promise.race([promise, record.ended]);
        if (labeled) {
          const attempts = usedStreamingAttempts.get(event.sender) ?? new Set();
          if (attempts.has(options.operationId))
            throw streamingOperationError("Streaming attempt already ended");
          attempts.add(options.operationId);
          usedStreamingAttempts.set(event.sender, attempts);
        }
        if (prior) {
          prior.cancelled = true;
          prior.detachOwner?.();
          releaseAdapter(prior.adapter);
        }
        dictationOperations.set(row.id, record);
        watchStreamingOwner(row, record, dictationOperations);
        const warm = dictationWarm.get(row.id);
        if (warm) await pending(warm.promise.catch(() => {}));
        if (
          !alive(record) ||
          dictationOperations.get(row.id) !== record ||
          streamingAuthority(options) !== authority
        )
          throw streamingOperationError("Streaming operation ended");
        const reuseAdapter =
          warm &&
          dictationWarm.get(row.id) === warm &&
          alive(warm) &&
          warm.sender === event.sender &&
          warm.authority === authority &&
          host[row.slot] === warm.adapter &&
          !options.forceNew;
        const useWarm = reuseAdapter && warmTransportReady(row, warm);
        if (warm) {
          clearTimeout(warm.idleTimer);
          warm.detachOwner?.();
          dictationWarm.delete(row.id);
          if (!reuseAdapter) {
            warm.cancelled = true;
            releaseAdapter(warm.adapter);
          }
        }
        const adapter = reuseAdapter ? warm.adapter : new row.Ctor();
        record.adapter = adapter;
        host[row.slot] = adapter;
        adapter.setLifecycleGate(() => contentAuthorized(row, record));
        adapter.setEgressGate(() => contentAuthorized(row, record));
        armFirstFrame(
          adapter,
          firstFrameHandOff(event.sender, record.correlationId, () =>
            contentAuthorized(row, record)
          )
        );
        bindCallbacks(row, record);
        if (row.id === "deepgram")
          adapter.setTokenRefreshFn(async () => {
            if (!owns(row, record) || streamingAuthority(options) !== authority)
              throw streamingOperationError("Streaming operation ended");
            const result = await acquireStreamingToken(row, event, options);
            if (!owns(row, record) || streamingAuthority(options) !== authority)
              throw streamingOperationError("Streaming operation ended");
            return result.token;
          });
        const connectedWarm = useWarm && ["realtime", "gemini"].includes(row.id);
        if (!connectedWarm) {
          adapter.beginConnecting?.();
          const material = await pending(acquireStreamingToken(row, event, options));
          if (!owns(row, record) || streamingAuthority(options) !== authority)
            throw streamingOperationError("Streaming operation ended");
          record.connectionPromise = connectOwnedStreaming(row, record, material).finally(() => {
            if (!owns(row, record)) releaseAdapter(adapter);
          });
          await pending(record.connectionPromise);
        }
        if (!contentAuthorized(row, record) || !adapter.isConnected || adapter.ws?.readyState !== 1)
          throw streamingOperationError("Streaming operation ended");
        record.pending = false;
        return { success: true, usedWarmConnection: !!useWarm };
      } catch (error) {
        if (record && dictationOperations.get(row.id) === record) {
          record.cancelled = true;
          record.detachOwner?.();
          releaseAdapter(record.adapter);
          dictationOperations.delete(row.id);
          if (host[row.slot] === record.adapter) host[row.slot] = null;
        }
        return streamingStartFailure(error);
      }
    });
    ipcMain.on(`${row.prefix}-send`, (event, data, identity) => {
      const record = dictationOperations.get(row.id);
      if (!identityMatches(record, event, identity) || !contentAuthorized(row, record)) return;
      if (
        !(data instanceof ArrayBuffer || ArrayBuffer.isView(data)) ||
        !data.byteLength ||
        data.byteLength % 2
      )
        return;
      const frame = Buffer.from(
        new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength)
      );
      try {
        record.adapter.sendAudio(frame);
      } catch (error) {
        record.adapter.onError?.(error);
      } finally {
        zeroAudio(frame);
      }
    });
    const finalizeChannel = row.id === "assemblyai" ? "force-endpoint" : "finalize";
    if (row.id !== "realtime")
      ipcMain.on(`${row.prefix}-${finalizeChannel}`, (event, identity) => {
        const record = dictationOperations.get(row.id);
        if (identityMatches(record, event, identity) && owns(row, record))
          row.id === "assemblyai" ? record.adapter.forceEndpoint() : record.adapter.finalize();
      });
    ipcMain.handle(`${row.prefix}-cancel`, (event, identity) => {
      const record = dictationOperations.get(row.id);
      if (!identityMatches(record, event, identity))
        return { success: false, reason: "stale-session" };
      record.cancelled = true;
      record.adapter?.discardPendingAudio();
      if (record.pending) {
        releaseAdapter(record.adapter);
        record.endPending?.();
      }
      disarmFirstFrame(record.adapter);
      return { success: true };
    });
    ipcMain.handle(`${row.prefix}-stop`, async (event, identity) => {
      const record = dictationOperations.get(row.id) ?? dictationWarm.get(row.id);
      if (!record) return { success: true, text: "" };
      if (!identityMatches(record, event, identity))
        return { success: false, reason: "stale-session" };
      if (record.pending) {
        record.cancelled = true;
        record.detachOwner?.();
        // Retire only this exact attempt. A fresh Undo may reuse the frozen
        // session id immediately, but always has a new operationId/adapter.
        if (dictationOperations.get(row.id) === record) dictationOperations.delete(row.id);
        if (host[row.slot] === record.adapter) host[row.slot] = null;
        try {
          releaseAdapter(record.adapter);
        } finally {
          record.endPending?.();
        }
        return { success: true, text: "" };
      }
      if (record.stopPromise) return record.stopPromise;
      record.stopping = true;
      const adapter = record.adapter;
      record.stopPromise = Promise.resolve().then(async () => {
        try {
          const model = adapter.currentModel || record.options.model;
          const audioBytesSent = adapter.audioBytesSent || 0;
          const result = await adapter.disconnect(
            row.id === "realtime" ? { commit: !record.cancelled } : !record.cancelled
          );
          return { success: true, text: result?.text || "", model, audioBytesSent };
        } catch (error) {
          return { success: false, error: error.message };
        } finally {
          const stillOwner = dictationOperations.get(row.id) === record;
          record.cancelled = true;
          record.detachOwner?.();
          releaseAdapter(adapter);
          if (dictationOperations.get(row.id) === record) dictationOperations.delete(row.id);
          if (host[row.slot] === adapter) host[row.slot] = null;
          if (dictationWarm.get(row.id) === record) dictationWarm.delete(row.id);
          clearTimeout(record.idleTimer);
          if (stillOwner && row.id === "realtime" && record.options.preview)
            host.windowManager.hideTranscriptionPreview();
        }
      });
      return record.stopPromise;
    });
    if (row.id !== "realtime")
      ipcMain.handle(
        `${row.prefix}-status`,
        () => host[row.slot]?.getStatus() || { isConnected: false, sessionId: null }
      );
  }

  return {
    dispose() {
      disposed = true;
      for (const registry of [dictationOperations, dictationWarm]) {
        for (const [id, record] of registry) {
          record.cancelled = true;
          record.detachOwner?.();
          clearTimeout(record.idleTimer);
          record.endPending?.();
          releaseAdapter(record.adapter);
          const row = rows.find((item) => item.id === id);
          if (host[row.slot] === record.adapter) host[row.slot] = null;
        }
        registry.clear();
      }
    },
  };
}
module.exports = { createDictationStreamingOperations };
