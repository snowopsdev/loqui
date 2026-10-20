const { randomUUID } = require("node:crypto");
const CODES = new Set([
  "RECIPIENT_CHANGED",
  "UNSUPPORTED_AUTH_SOURCE",
  "CLEANUP_OPERATION_UNAVAILABLE",
  "CLEANUP_OPERATION_BUSY",
  "CLEANUP_REQUEST_CHANGED",
  "CLEANUP_FAILED",
]);
const matches = (a, b) =>
  a &&
  b &&
  ["demoId", "takeId", "operationId"].every(
    (key) => typeof a[key] === "string" && a[key] && a[key] === b[key]
  );

// Main is the only cross-window broker. No inference capability or request body
// is disclosed to setup. The original overlay executes its retained operation.
function createOnboardingCleanupRelay({
  getSession,
  getSetup,
  getOverlay,
  retire,
  timeoutMs = 600000,
}) {
  let current = null;
  let pending = null;
  const listeners = new Map();
  const unavailable = (identity) => ({
    ...identity,
    ok: false,
    code: "CLEANUP_OPERATION_UNAVAILABLE",
  });
  const validTake = (identity) => {
    const session = getSession();
    return (
      session?.kind === "dictation" &&
      !session.cancelRequested &&
      typeof identity?.takeId === "string" &&
      session.id === identity.demoId &&
      session.takeId === identity.takeId
    );
  };
  const live = (identity) =>
    current &&
    matches(identity, current.identity) &&
    validTake(identity) &&
    getSetup() === current.setup &&
    getOverlay() === current.overlay &&
    !current.setup.isDestroyed() &&
    !current.overlay.isDestroyed();
  const settle = (result) => {
    const old = pending;
    if (!old) return;
    pending = null;
    clearTimeout(old.timer);
    old.resolve(result);
  };
  const clear = () => {
    const old = current;
    current = null;
    if (pending) settle(unavailable(pending.identity));
    if (old) {
      retire(old.overlay, old.token);
      if (!old.overlay.isDestroyed()) old.overlay.send("onboarding-cleanup-retired", old.identity);
    }
    for (const [sender, listener] of listeners) sender.removeListener("destroyed", listener);
    listeners.clear();
  };
  return {
    bind(sender, identity, token) {
      if (
        sender !== getOverlay() ||
        !validTake(identity) ||
        typeof identity.operationId !== "string" ||
        !identity.operationId ||
        identity.operationId.length > 128 ||
        !getSetup() ||
        getSetup().isDestroyed()
      )
        throw Object.assign(new Error("The original cleanup operation is unavailable."), {
          code: "CLEANUP_OPERATION_UNAVAILABLE",
        });
      clear();
      current = { identity: { ...identity }, token, setup: getSetup(), overlay: sender };
      for (const owner of [current.setup, current.overlay]) {
        listeners.set(owner, clear);
        owner.once("destroyed", clear);
      }
    },
    authorized(sender, identity) {
      return sender === current?.overlay && live(identity);
    },
    selector(sender, identity) {
      return sender === current?.overlay && live(identity) ? { ...current.identity } : null;
    },
    retry(sender, identity) {
      if (sender !== current?.setup || !live(identity))
        return Promise.resolve(unavailable(identity));
      if (pending)
        return Promise.resolve({ ...identity, ok: false, code: "CLEANUP_OPERATION_BUSY" });
      return new Promise((resolve) => {
        const requestId = randomUUID();
        pending = {
          identity: { ...identity },
          requestId,
          resolve,
          timer: setTimeout(() => settle(unavailable(identity)), timeoutMs),
        };
        current.overlay.send("onboarding-cleanup-retry", { ...identity, requestId });
      });
    },
    reply(sender, reply) {
      if (
        !pending ||
        sender !== current?.overlay ||
        reply?.requestId !== pending.requestId ||
        !live(reply) ||
        !matches(reply, pending.identity)
      )
        return false;
      const identity = pending.identity;
      settle(
        typeof reply.text === "string" && reply.text.trim() && reply.text.length <= 20000
          ? { ...identity, ok: true, text: reply.text }
          : { ...identity, ok: false, code: CODES.has(reply.code) ? reply.code : "CLEANUP_FAILED" }
      );
      return true;
    },
    retire: clear,
    dispose: clear,
  };
}
module.exports = { createOnboardingCleanupRelay };
