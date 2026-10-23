const { SealedModeError } = require("./egressPolicy");

// Calendar sync is network traffic (Google, Microsoft) or a native helper
// launch (Apple EventKit). main.js routes every start, focus and wake trigger
// through here, so the sealed check is code a test executes, not a pattern in
// main.js. Apple is not exempt: its helper is a native child, which 07a never
// runs while sealed (the spawn guard refuses it in any case).
//
// cancelPending() is the seal transition's hook for sign-ins in progress: a
// consent page that completes later must find nothing listening, and a token
// exchange already under way is aborted.
function createCalendarGuard({
  isSealed,
  cancelFlows = (reason) => require("../oauthLoopbackFlow").cancelAllOAuthFlows(reason),
}) {
  const sealed = () => {
    try {
      return isSealed() !== false;
    } catch {
      return true;
    }
  };
  const each = (managers, method) => {
    if (sealed()) return;
    for (const manager of managers) manager?.[method]?.();
  };
  return {
    start: (managers) => each(managers, "start"),
    onFocus: (managers) => each(managers, "syncOnFocus"),
    onWake: (managers) => each(managers, "onWakeFromSleep"),
    cancelPending: () =>
      cancelFlows(
        ({ host }) =>
          new SealedModeError({
            task: "calendar",
            host: host ?? "calendar sign-in",
            phase: "interrupted",
          })
      ),
  };
}

module.exports = { createCalendarGuard };
