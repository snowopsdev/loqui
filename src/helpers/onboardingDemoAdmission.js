const { randomUUID } = require("node:crypto");
const { ONBOARDING_DEMO_KINDS } = require("./onboardingInputPolicy");
const same = (a, b) => a && b && a.demoId === b.demoId && a.requestId === b.requestId;
const live = (sender) => sender && !sender.isDestroyed();

// A bounded transport broker, not a recording owner. Only the original overlay's
// preparation/start owner can reserve admission. Cached main lifecycle is advisory.
function createOnboardingDemoAdmission({ getSetup, getOverlay, install, end, timeoutMs = 2000 }) {
  let disposed = false;
  let pending = null;
  let current = null;
  const detach = (owner) => {
    clearTimeout(owner.timer);
    for (const sender of [owner.setup, owner.overlay])
      sender.removeListener("destroyed", owner.destroyed);
  };
  const send = (owner, action, takeId) => {
    if (!live(owner.overlay)) return false;
    try {
      owner.overlay.send("onboarding-demo-reservation", {
        demoId: owner.demoId,
        requestId: owner.requestId,
        action,
        ...(typeof takeId === "string" ? { takeId } : {}),
      });
      return true;
    } catch {
      return false;
    }
  };
  const fail = (owner) => {
    if (pending !== owner) return;
    pending = null;
    detach(owner);
    send(owner, "release");
    owner.resolve(false);
  };
  const retire = (identity) => {
    if (pending && (!identity || same(identity, pending))) fail(pending);
    if (!current || (identity && !same(identity, current))) return;
    const owner = current;
    current = null;
    detach(owner);
    send(owner, "release", identity?.takeId);
  };
  const safeEnd = (owner) => {
    try {
      end(owner);
    } catch {
      /* The destroyed original window cannot receive controls. */
    }
    retire(owner);
  };
  const valid = (owner) =>
    live(owner.setup) &&
    live(owner.overlay) &&
    getSetup() === owner.setup &&
    getOverlay() === owner.overlay;
  return {
    begin(sender, session) {
      if (
        disposed ||
        sender !== getSetup() ||
        !live(sender) ||
        !live(getOverlay()) ||
        !session ||
        typeof session.id !== "string" ||
        !session.id ||
        session.id.length > 128 ||
        !ONBOARDING_DEMO_KINDS.has(session.kind) ||
        (session.context !== undefined &&
          (typeof session.context !== "string" || session.context.length > 4096))
      )
        return Promise.resolve(false);
      if (pending) fail(pending);
      return new Promise((resolve) => {
        const owner = {
          demoId: session.id,
          requestId: randomUUID(),
          setup: sender,
          overlay: getOverlay(),
          session: {
            id: session.id,
            kind: session.kind,
            ...(session.context !== undefined ? { context: session.context } : {}),
          },
          deadlineAt: Date.now() + timeoutMs,
          resolve,
        };
        owner.destroyed = () => {
          if (pending === owner) fail(owner);
          if (current === owner) {
            safeEnd(owner);
          }
        };
        pending = owner; // stage before send: a real preload reply may arrive immediately
        for (const peer of [owner.setup, owner.overlay]) peer.once("destroyed", owner.destroyed);
        owner.timer = setTimeout(() => fail(owner), timeoutMs);
        try {
          owner.overlay.send("onboarding-demo-admission", {
            demoId: owner.demoId,
            requestId: owner.requestId,
            kind: owner.session.kind,
            deadlineAt: owner.deadlineAt,
          });
        } catch {
          fail(owner);
        }
      });
    },
    reply(sender, reply) {
      const owner = pending;
      if (!owner || sender !== owner.overlay || !same(reply, owner)) return false;
      if (reply.accepted !== true || !valid(owner) || Date.now() >= owner.deadlineAt) {
        fail(owner);
        return false;
      }
      pending = null;
      clearTimeout(owner.timer);
      // Releasing the prior main session cannot touch this new nonce. The local
      // reservation already excludes queued normal starts before installation.
      if (current) safeEnd(current);
      if (!valid(owner)) {
        detach(owner);
        send(owner, "release");
        owner.resolve(false);
        return false;
      }
      current = owner;
      try {
        if (
          install({ ...owner.session, requestId: owner.requestId, startedAt: Date.now() }) !==
            true ||
          !send(owner, "commit")
        ) {
          safeEnd(owner);
          owner.resolve(false);
          return false;
        }
      } catch {
        safeEnd(owner);
        owner.resolve(false);
        return false;
      }
      owner.resolve(true);
      return true;
    },
    invalidate(sender, identity) {
      if (sender !== getOverlay()) return false;
      if (pending && same(identity, pending)) {
        fail(pending);
        return true;
      }
      if (!current || !same(identity, current)) return false;
      safeEnd(current);
      return true;
    },
    endPending(sender, id) {
      if (pending?.setup === sender && pending.demoId === id) fail(pending);
    },
    retire,
    cancelPending() {
      if (pending) fail(pending);
    },
    dispose() {
      disposed = true;
      if (current) safeEnd(current);
      retire();
    },
  };
}
module.exports = { createOnboardingDemoAdmission };
