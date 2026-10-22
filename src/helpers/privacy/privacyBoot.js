const { EventEmitter } = require("node:events");
const gate = require("./egressGate");
const backstop = require("./egressBackstop");
const { SealedState } = require("./sealedState");
const { FlightRecorder } = require("./flightRecorder");
const childRegistry = require("./childRegistry");
const UNAVAILABLE = "NATIVE_BOUNDARY_UNAVAILABLE";

function bootEgressGuards({
  app,
  profile,
  getDefaultSession,
  utilityProcess = null,
  now = Date.now,
}) {
  const state = new SealedState({ profile, now });
  const recorder = new FlightRecorder({ now });
  const bootFailures = [];
  gate.configureEgress({ isSealed: () => state.isSealed(), recorder, now });
  state.on("change", ({ sealed }) => gate.onSealChanged(sealed));
  backstop.installNodeBackstop();
  childRegistry.installSpawnGuard({ utilityProcess });
  const nativeBoundary = childRegistry.getNativeBoundary();
  backstop.installWebContentsGuard(app);
  const watch = (session) => {
    try {
      backstop.watchSession(session);
    } catch {
      if (!bootFailures.includes("sessionWatchUnavailable"))
        bootFailures.push("sessionWatchUnavailable");
    }
  };
  app.on("session-created", watch);
  // A failing deferred session lookup must not create an unhandled rejection.
  Promise.resolve(app.whenReady())
    .then(() => watch(getDefaultSession()))
    .catch(() => {
      if (!bootFailures.includes("sessionWatchUnavailable"))
        bootFailures.push("sessionWatchUnavailable");
    });
  return { state, recorder, bootedAt: now(), nativeBoundary, bootFailures };
}

// 07a deliberately has no native success, replacement, pause or proof API.
// The setting closes admission immediately; the serialized barrier observes
// actual ends without resetting sessions, sockets, DNS or registry evidence.
function createSealTransition({
  state,
  getUpdateManager = () => null,
  getInference = () => null,
  getCalendars = () => [],
  children = childRegistry,
  bootFailures = [],
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
  waitMs = 2000,
}) {
  const emitter = new EventEmitter();
  let operations = [];
  let queue = Promise.resolve();
  let latestSeal = 0;
  let sequence = 0;
  let snapshot = {
    phase: state.isSealed() ? "sealing" : "open",
    effectiveSince: null,
    failures: state.isSealed() ? [UNAVAILABLE] : [],
    notes: [],
  };
  const set = (next) => {
    if (JSON.stringify(snapshot) === JSON.stringify(next)) return;
    snapshot = next;
    emitter.emit("change", copy());
  };
  const copy = () => ({
    ...snapshot,
    failures: [...snapshot.failures],
    notes: [...snapshot.notes],
  });
  const diagnostics = () => {
    try {
      return children.diagnostics();
    } catch {
      return { unresolved: [], unavailable: true };
    }
  };
  function running() {
    const result = [];
    try {
      if (gate.activeRemoteCount()) result.push("tickets");
    } catch {
      result.push("ticketsUnknown");
    }
    const status = backstop.status();
    if (status.openRemoteSockets) result.push("sockets");
    if (status.chromiumInFlightRemote) result.push("chromium");
    if (status.pendingDns) result.push("dns");
    try {
      if (children.alive().length) result.push("children");
    } catch {
      result.push("childrenUnknown");
    }
    try {
      const inference = getInference();
      if (typeof inference?.codexRunning !== "function") result.push("codexStatusUnavailable");
      else if (inference.codexRunning()) result.push("codex");
    } catch {
      result.push("codexStatusUnavailable");
    }
    return result;
  }
  function failures() {
    const guards = backstop.status();
    const missing = ["node", "dns", "dgram", "http", "webContents"]
      .filter((k) => !guards[k])
      .map((k) => `guard:${k}`);
    if (!guards.sessions) missing.push("guard:sessions");
    if (guards.envProxy) missing.push("envProxy");
    const facts = diagnostics();
    return [
      ...new Set([
        UNAVAILABLE,
        ...bootFailures,
        ...operations,
        ...missing,
        ...(facts.unavailable ? ["childDiagnosticsUnavailable"] : []),
        ...facts.unresolved.map((e) => `child:${e.kind}:${e.pid ?? "unknown"}:${e.reason}`),
        ...running().map((key) => `timeout:${key}`),
      ]),
    ];
  }
  function recheck() {
    if (!state.isSealed()) return;
    set({ phase: "sealing", effectiveSince: null, failures: failures(), notes: [] });
  }
  async function hook(getOwner, name, failure) {
    try {
      const owner = getOwner();
      if (typeof owner?.[name] !== "function") {
        operations.push(`${failure}Unavailable`);
        return;
      }
      await owner[name]();
    } catch {
      operations.push(failure);
    }
  }
  async function calendars(name) {
    let list;
    try {
      list = getCalendars();
    } catch {
      operations.push("calendarsUnavailable");
      return;
    }
    if (!Array.isArray(list)) {
      operations.push("calendarsUnavailable");
      return;
    }
    for (const calendar of list) {
      if (name === "start" && state.isSealed()) return;
      if (calendar) await hook(() => calendar, name, `calendar:${name}`);
    }
  }
  function apply(sealed) {
    if (typeof sealed !== "boolean") throw new TypeError("sealed must be a boolean");
    const request = ++sequence;
    if (sealed) {
      latestSeal = request;
      state.set(true);
      gate.abortAllRemote();
      backstop.severAll();
      recheck();
    }
    const work = async () => {
      operations = [];
      if (!sealed) {
        // A newer seal supersedes an unseal waiting behind a running barrier.
        if (latestSeal > request) return;
        state.set(false);
        await calendars("start");
        if (!state.isSealed()) await hook(getUpdateManager, "resumeAfterSeal", "updatesResume");
        if (state.isSealed()) {
          recheck();
          return;
        }
        set({ phase: "open", effectiveSince: null, failures: [...operations], notes: [] });
        return;
      }
      state.set(true);
      recheck();
      await hook(getUpdateManager, "pauseForSeal", "updatesPause");
      await calendars("stop");
      await Promise.all([
        hook(getInference, "stopCodex", "codexStop"),
        hook(
          () => ({
            stop: () => children.stopAll({ termGraceMs: waitMs / 2, killGraceMs: waitMs / 2 }),
          }),
          "stop",
          "childStop"
        ),
      ]);
      const deadline = now() + waitMs;
      while (running().length && now() < deadline) await sleep(Math.min(25, waitMs));
      recheck();
    };
    const result = queue.then(work, work);
    queue = result.catch(() => {});
    return result;
  }
  return {
    apply,
    recheck,
    snapshot: copy,
    on(event, fn) {
      emitter.on(event, fn);
      return () => emitter.off(event, fn);
    },
  };
}

function createAttestor({
  state,
  transition,
  getInference = () => null,
  children = childRegistry,
  now = Date.now,
}) {
  let version = 0;
  return () => {
    const saved = state.snapshot();
    let nativeChildren = [];
    let childDiagnostics;
    const extra = [];
    try {
      nativeChildren = children.alive().map(({ kind, pid, local }) => ({ kind, pid, local }));
    } catch {
      extra.push("childrenUnavailable");
    }
    try {
      childDiagnostics = children.diagnostics();
    } catch {
      childDiagnostics = { nativeBoundaryUnavailable: true, unresolved: [] };
      extra.push("childDiagnosticsUnavailable");
    }
    let codex = false;
    try {
      codex = getInference()?.codexRunning?.() === true;
    } catch {
      extra.push("codexStatusUnavailable");
    }
    const current = transition.snapshot();
    const tally = gate.counters();
    return {
      ...saved,
      ...current,
      effectiveSince: null,
      failures: [
        ...new Set([...current.failures, ...extra, ...(saved.sealed ? [UNAVAILABLE] : [])]),
      ],
      guards: backstop.status(),
      children: nativeChildren,
      childDiagnostics,
      networkChildren: [
        ...new Set([...nativeChildren.map((c) => c.kind), ...(codex ? ["codex"] : [])]),
      ],
      isolation: {
        platform: process.platform,
        mechanism: "none",
        selfTest: "unavailable",
        checkedAt: null,
        reason: UNAVAILABLE,
        pauseReason: null,
      },
      paused: [],
      activeRemote: gate.activeRemoteCount(),
      blockedSinceSealed: tally.blockedSinceSealed,
      recordFailures: tally.recordFailures,
      persistError: gate.getRecorder()?.persistError ?? null,
      saveError: saved.saveError
        ? /^[A-Z0-9_]{1,40}$/.test(saved.saveError)
          ? saved.saveError
          : "PERSISTENCE_ERROR"
        : null,
      version: ++version,
      at: now(),
      nothingLeaves: false,
    };
  };
}

function createConfirmations({ dialog, BrowserWindow, t }) {
  const ask = async (event, options) => {
    const parent = BrowserWindow.fromWebContents?.(event?.sender);
    const args = { type: "warning", defaultId: 0, cancelId: 0, noLink: true, ...options };
    try {
      const { response } = await (parent
        ? dialog.showMessageBox(parent, args)
        : dialog.showMessageBox(args));
      return response === 1;
    } catch {
      throw new Error("PRIVACY_CONFIRMATION_FAILED");
    }
  };
  return {
    unseal: (event) =>
      ask(event, {
        title: t("sealedMode.confirmUnseal.title"),
        message: t("sealedMode.confirmUnseal.message"),
        detail: t("sealedMode.confirmUnseal.detail"),
        buttons: [t("sealedMode.confirmUnseal.keep"), t("sealedMode.confirmUnseal.turnOff")],
      }),
    clear: (count, event) =>
      ask(event, {
        title: t("sealedMode.confirmClear.title"),
        message: t("sealedMode.confirmClear.message"),
        detail: t("sealedMode.confirmClear.detail", { count }),
        buttons: [t("sealedMode.confirmClear.keep"), t("sealedMode.confirmClear.clear")],
      }),
  };
}
module.exports = { bootEgressGuards, createSealTransition, createAttestor, createConfirmations };
