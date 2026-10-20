const { randomUUID } = require("node:crypto");
const { slotForCredentialRef } = require("./credentialAuthority");
const failure = (code) =>
  Object.assign(
    new Error(
      {
        CLEANUP_OPERATION_UNAVAILABLE:
          "The original cleanup operation is no longer available. Your original words are preserved.",
        CLEANUP_OPERATION_BUSY: "The original cleanup is already running.",
        CLEANUP_REQUEST_CHANGED:
          "Retry must use the original cleanup request. Your original words are preserved.",
        RECIPIENT_CHANGED:
          "The cleanup recipient or credential changed. Your original words are preserved.",
      }[code]
    ),
    { code }
  );
const copy = (value) => JSON.parse(JSON.stringify(value));
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// Separate purpose from discovery/Verify. Tokens stay with the issuing renderer;
// a setup retry is relayed to that renderer, never executed with its token.
function createTextOperationAuthority({
  credentials,
  snapshot,
  waitForAdmission,
  authorize = () => true,
  captureFactoryInputs = async (request, selected, values) => ({
    apiKey: values.key || "",
    enterprise: { ...selected, ...values, frozenCredentials: true },
  }),
  now = Date.now,
  ttlMs = 300000,
}) {
  const entries = new Map();
  const owners = new Map();
  const metadata = (request) => {
    if (request.provider === "local") return null;
    const id =
      request.provider === "bedrock"
        ? "bedrock"
        : slotForCredentialRef(request.credentialRef || request.provider)?.id;
    const row = credentials?.list().find((row) => row.id === id);
    if (
      !row ||
      row.unknown ||
      !Number.isSafeInteger(row.generation) ||
      typeof row.present !== "boolean" ||
      credentials.isFenced?.()
    )
      throw failure("RECIPIENT_CHANGED");
    return { id, generation: row.generation, present: row.present };
  };
  const retireEntry = (entry) => {
    if (!entry) return;
    entries.delete(entry.token);
    entry.controller?.abort(failure("CLEANUP_OPERATION_UNAVAILABLE"));
    entry.inputs = null;
    entry.request = null;
  };
  const live = (entry) => {
    if (
      !entry ||
      entries.get(entry.token) !== entry ||
      entry.sender.isDestroyed() ||
      !authorize(entry.sender, entry.descriptor) ||
      now() >= entry.expiresAt
    ) {
      retireEntry(entry);
      throw failure("CLEANUP_OPERATION_UNAVAILABLE");
    }
    if (
      JSON.stringify(snapshot(entry.descriptor)) !== entry.selectedKey ||
      JSON.stringify(metadata(entry.descriptor)) !== entry.credentialKey
    )
      throw failure("RECIPIENT_CHANGED");
    entry.controller?.signal.throwIfAborted();
  };
  return {
    isBusy: () => [...entries.values()].some((entry) => entry.busy),
    async capture(sender, descriptor, issued = () => {}) {
      const admitted = freeze(copy(descriptor));
      // Synchronous IPC-entry snapshot: this intentionally precedes admission,
      // credential queues, filesystem/auth-source capture and SDK imports.
      const selected = copy(snapshot(admitted));
      const meta = metadata(admitted);
      // A setup tap discloses this exact configuration. IPC entry must not
      // silently adopt a newer enterprise recipient or credential generation.
      if (
        Object.entries(admitted.expectedEnterprise || {}).some(
          ([key, value]) => selected[key] !== value
        ) ||
        (admitted.expectedAuthority?.enterpriseVersion !== undefined &&
          admitted.expectedAuthority.enterpriseVersion !== selected.version) ||
        (admitted.expectedAuthority?.credentialGeneration !== undefined &&
          admitted.expectedAuthority.credentialGeneration !== meta?.generation)
      )
        throw failure("RECIPIENT_CHANGED");
      const entry = {
        token: randomUUID(),
        sender,
        descriptor: admitted,
        selectedKey: JSON.stringify(selected),
        credentialKey: JSON.stringify(meta),
        expiresAt: now() + ttlMs,
        busy: false,
        request: null,
        inputs: null,
      };
      if (entries.size >= 128) throw failure("CLEANUP_OPERATION_UNAVAILABLE");
      entries.set(entry.token, entry);
      if (!owners.has(sender)) {
        const destroyed = () => {
          for (const e of entries.values()) if (e.sender === sender) retireEntry(e);
          owners.delete(sender);
        };
        owners.set(sender, destroyed);
        sender.once("destroyed", destroyed);
      }
      try {
        issued(entry.token);
        live(entry);
        await waitForAdmission();
        live(entry);
        const captured = meta ? await credentials.captureCommitted(meta.id) : { values: {} };
        live(entry);
        if (
          !captured ||
          (meta &&
            JSON.stringify({
              id: meta.id,
              generation: captured.generation,
              present: captured.present,
            }) !== entry.credentialKey)
        )
          throw failure("RECIPIENT_CHANGED");
        entry.inputs = freeze(await captureFactoryInputs(admitted, selected, captured.values));
        live(entry);
        return entry.token;
      } catch (error) {
        retireEntry(entry);
        throw error;
      }
    },
    async execute(sender, token, input, run) {
      const entry = entries.get(token);
      if (!entry || entry.sender !== sender) throw failure("CLEANUP_OPERATION_UNAVAILABLE");
      live(entry);
      if (entry.busy) throw failure("CLEANUP_OPERATION_BUSY");
      const request = copy(input);
      if (entry.request && JSON.stringify(entry.request) !== JSON.stringify(request))
        throw failure("CLEANUP_REQUEST_CHANGED");
      entry.request ||= freeze(request);
      entry.busy = true;
      const controller = new AbortController();
      entry.controller = controller;
      const timeoutMs = Math.min(Math.max(entry.descriptor.timeoutMs || 180000, 1000), 600000);
      const timer = setTimeout(
        () => controller.abort(new Error("Text request timed out.")),
        timeoutMs
      );
      const execution = {
        signal: controller.signal,
        deadlineAt: now() + timeoutMs,
        assertLive: () => live(entry),
      };
      // Keep immutable local references even if retirement clears registry data.
      const capturedRequest = entry.request;
      const inputs = entry.inputs;
      try {
        execution.assertLive();
        const result = await run(capturedRequest, inputs, execution, entry.descriptor);
        execution.assertLive();
        return result;
      } catch (error) {
        execution.assertLive();
        throw error;
      } finally {
        clearTimeout(timer);
        entry.busy = false;
        if (entry.controller === controller) entry.controller = null;
      }
    },
    retire(sender, token) {
      const entry = entries.get(token);
      if (entry?.sender === sender) retireEntry(entry);
    },
    dispose() {
      for (const entry of entries.values()) retireEntry(entry);
      for (const [sender, listener] of owners) sender.removeListener("destroyed", listener);
      owners.clear();
    },
  };
}
module.exports = { createTextOperationAuthority };
