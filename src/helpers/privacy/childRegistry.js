const path = require("node:path");
const { syncBuiltinESMExports } = require("node:module");
const { promisify } = require("node:util");
const { performance } = require("node:perf_hooks");
const gate = require("./egressGate");

// Classification describes intent only. 07a has no native launch capability.
const NETWORK =
  /^(?:codex(?:\.exe)?|yt-dlp.*|curl(?:\.exe)?|wget(?:\.exe)?|ffplay.*|aws(?:\.exe)?|gcloud.*|ssh(?:\.exe)?|git(?:\.exe)?)$/;
const SIDECAR = /^(?:llama-server|whisper-server|qdrant|sherpa-onnx-)/;
const OS_TOOLS = new Set(
  "xsel xclip wl-copy wl-paste xdotool kdotool ydotool osascript systemctl hyprctl gsettings qdbus which where.exe taskkill tasklist ps pidof pgrep groups journalctl sleep tar unzip nvidia-smi nvidia-smi.exe taskkill.exe tasklist.exe tar.exe open sh explorer.exe powershell powershell.exe".split(
    " "
  )
);
const baseName = (command) =>
  String(command ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .toLowerCase();
const initialDirs = () => [
  path.resolve(__dirname, "../../../resources/bin"),
  ...(process.resourcesPath ? [path.resolve(process.resourcesPath)] : []),
];
let localBinaryDirs = new Set(initialDirs());
let entries = new Set();
let children = new WeakMap();
let sessions = new WeakSet();
let legacy = new Map();
let nextSyncRecord = 0;
let launchIntent = null;
const guarded = new WeakSet();
const endObservers = new WeakMap();

function kindOf(command) {
  const base = baseName(command);
  return /^codex/.test(base) ? "codex" : /^yt-dlp/.test(base) ? "yt-dlp" : base;
}
function registerLocalBinaryDir(dir) {
  if (dir) localBinaryDirs.add(path.resolve(dir));
}
function classify(command, stack = "") {
  const base = baseName(command);
  if (NETWORK.test(base)) return "network";
  if (/^ffmpeg/.test(base)) return "ffmpeg";
  if (/[\\/]node_modules[\\/]/.test(stack)) return "thirdParty";
  if (command === process.execPath) return "self";
  if (SIDECAR.test(base)) return "bundled";
  if (
    path.isAbsolute(String(command)) &&
    [...localBinaryDirs].some((dir) => path.resolve(command).startsWith(dir + path.sep))
  )
    return "bundled";
  return OS_TOOLS.has(base) ? "osTool" : "unclassified";
}
function getNativeBoundary() {
  return { available: false, reason: "NATIVE_BOUNDARY_UNAVAILABLE" };
}

// Shared once-only actual-end observer. A pid seen at any time latches start;
// a later error (or loss of child.pid) cannot turn it into a failed start.
function onChildEnd(child, fn) {
  let state = endObservers.get(child);
  if (!state) {
    state = { started: Number.isInteger(child.pid) && child.pid > 0, done: false, callbacks: [] };
    endObservers.set(child, state);
    const end = (code, signal, failedToStart = false) => {
      if (state.done) return;
      state.done = true;
      state.detail = { code: code ?? null, signal: signal ?? null, failedToStart };
      for (const callback of state.callbacks.splice(0)) callback(state.detail);
    };
    child.once("spawn", () => {
      state.started = true;
    });
    child.once("exit", (code, signal) => end(code, signal));
    child.once("close", (code, signal) => end(code, signal, !state.started && !child.pid));
    child.on("error", () => {
      state.started ||= Number.isInteger(child.pid) && child.pid > 0;
      if (!state.started) end(null, null, true);
    });
  }
  if (state.done) fn(state.detail);
  else state.callbacks.push(fn);
}
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}
function listProcesses() {
  // Do not capture an unguarded native alias. This inspection is itself a
  // launch, unavailable sealed even when called before guard installation.
  if (gate.isSealed()) throw new Error("INSPECTION_REFUSED_SEALED");
  const cp = require("node:child_process");
  const output =
    process.platform === "win32"
      ? cp.execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
          ],
          { encoding: "utf8", timeout: 2000, windowsHide: true }
        )
      : cp.execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8", timeout: 2000 });
  return output
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number);
      if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(ppid) || ppid < 0)
        throw new Error("INSPECTION_FAILED");
      return { pid, ppid };
    });
}
const defaults = () => ({
  listProcesses,
  pidAlive,
  groupAlive: (pid) => pidAlive(-pid),
  killGroup: (pid, signal) => process.kill(-pid, signal),
  // Monotonic: a wall-clock jump must not end or stretch group continuity (T10-m1).
  now: () => performance.now(),
  every: (fn, ms) => {
    const timer = setInterval(fn, ms);
    timer.unref?.();
    return () => clearInterval(timer);
  },
});
let system = defaults();
let groupWatches = new Set();

// A detached POSIX child leads its own process group, whose id is the root's
// pid. Signalling that group is safe only while the id, observed continuously, still names
// OUR group:
// - While the root is unreaped (alive or a zombie), its pid cannot be reused,
//   so the group id is ours. This is the strict case.
// - Once the root is reaped, the id stays ours only while the group keeps at
//   least one member: POSIX and the Linux/XNU allocators never hand out a pid
//   still in use as a process group id. When the last member leaves, the id
//   may later be reused by an unrelated process that then leads a new group.
//   Node exposes no pidfd, so continuity is observed: probed in the same turn
//   as the root's exit notification, then every GROUP_WATCH_MS. A probe that
//   fails, throws, or comes more than GROUP_CONTINUITY_GAP_MS after the last
//   one ends continuity for good, and the group is never signalled again.
//   Reuse inside that gap would need the kernel's cyclic pid allocator to wrap
//   the whole pid space within it (Linux pid_max: 32768 by default, 4194304
//   under systemd; macOS: 99999). That is an allocator argument, not identity
//   proof.
// None of this resolves the tree: a signal, a root exit or an absent group is
// never evidence that descendants ended (A2/A23), and the entry stays
// DESCENDANTS_UNVERIFIED.
const GROUP_WATCH_MS = 100;
const GROUP_CONTINUITY_GAP_MS = 400;
const posixGroup = (entry) =>
  entry.group && process.platform !== "win32" && Number.isInteger(entry.pid) && entry.pid > 0;
function rootUnreaped(entry) {
  const child = entry.child;
  return !entry.exited && !!child && child.exitCode == null && child.signalCode == null;
}
function endGroupContinuity(entry, state) {
  entry.groupContinuity = { state };
  entry.stopGroupWatch?.();
  return false;
}
// Re-observes a reaped root's group. True only when continuity still holds.
function groupStillOurs(entry) {
  const continuity = entry.groupContinuity;
  if (continuity?.state !== "observed") return false;
  const at = system.now();
  if (!(at - continuity.seenAt <= GROUP_CONTINUITY_GAP_MS))
    return endGroupContinuity(entry, "lost");
  let exists;
  try {
    exists = system.groupAlive(entry.pid) === true;
  } catch {
    return endGroupContinuity(entry, "lost");
  }
  if (!exists) return endGroupContinuity(entry, "ended");
  continuity.seenAt = at;
  return true;
}
function observeGroupAtRootExit(entry) {
  if (!posixGroup(entry)) return;
  entry.groupContinuity = { state: "observed", seenAt: system.now() };
  if (!groupStillOurs(entry)) return;
  let stop = null;
  let stopped = false;
  entry.stopGroupWatch = () => {
    stopped = true;
    if (!stop) return;
    groupWatches.delete(stop);
    stop();
    stop = null;
  };
  const watch = system.every(() => groupStillOurs(entry), GROUP_WATCH_MS);
  if (stopped) return watch();
  stop = watch;
  groupWatches.add(stop);
}
// Signals the entry's whole group while continuity still holds (observed, not proven).
function signalEntryGroup(entry, sig) {
  if (!posixGroup(entry)) return false;
  if (!rootUnreaped(entry) && !groupStillOurs(entry)) return false;
  system.killGroup(entry.pid, sig);
  return true;
}
function refreshTree(entry) {
  if (!entry.tree || entry.exited || !entry.started || entry.listing) return;
  if (gate.isSealed()) {
    entry.inspection = "refused-sealed";
    return;
  }
  if (entry.listedAt !== undefined && Date.now() - entry.listedAt < 250) return;
  entry.listedAt = Date.now();
  entry.listing = true;
  try {
    const all = system.listProcesses();
    const found = new Set([entry.pid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of all)
        if (found.has(p.ppid) && !found.has(p.pid)) {
          found.add(p.pid);
          changed = true;
        }
    }
    found.delete(entry.pid);
    for (const pid of found) entry.descendants.add(pid);
    entry.inspection = "snapshot-only";
  } catch {
    entry.inspection = "failed";
  } finally {
    entry.listing = false;
  }
}
function register(child, { kind, group = false, tree = false, local = false } = {}) {
  if (children.has(child)) return children.get(child);
  const entry = {
    child,
    kind: kind ?? "unknown",
    pid: child.pid,
    group,
    tree,
    local,
    started: !!child.pid,
    exited: false,
    descendants: new Set(),
    inspection: "unavailable",
  };
  children.set(child, entry);
  entries.add(entry);
  child.once("spawn", () => {
    entry.started = true;
    entry.pid = child.pid;
  });
  onChildEnd(child, (detail) => {
    entry.exited = true;
    entry.started ||= !detail.failedToStart;
    entry.child = null; // Retain failure metadata, never ended-child streams/payload closures.
    // Same turn as the root's exit notification: does its group outlive it?
    if (entry.started) observeGroupAtRootExit(entry);
  });
  return entry;
}
function isAlive(entry) {
  if (!entry.exited) return true;
  if (!entry.started) return false;
  // Partial observations only: PID/group reuse and escaped descendants are
  // unresolved. Even observed absence cannot retire creation-time coverage.
  if (entry.group && process.platform !== "win32" && entry.pid) {
    try {
      entry.observedGroupAlive = system.groupAlive(entry.pid);
    } catch {
      entry.observedGroupAlive = null;
    }
  }
  entry.observedLiveDescendantPids = [...entry.descendants].filter((pid) => {
    try {
      return system.pidAlive(pid);
    } catch {
      return true;
    } // Uninspectable known PIDs remain conservatively live.
  });
  return true;
}
function alive(kind) {
  const result = [];
  for (const entry of entries) {
    refreshTree(entry);
    if (!isAlive(entry)) {
      entries.delete(entry);
      continue;
    }
    if (!kind || entry.kind === kind)
      result.push({ kind: entry.kind, pid: entry.pid, local: entry.local });
  }
  for (const entry of legacy.values())
    if (!kind || entry.kind === kind)
      result.push({ kind: entry.kind, pid: entry.pid, local: true });
  return result;
}
function recordUnresolved({ kind, pid, reason, rootExited = false, source = "sidecar-pid-file" }) {
  const entry = { kind, pid, reason, rootExited, source };
  const key =
    source === "sync-child" ? `${source}:${++nextSyncRecord}` : `${source}:${kind}:${pid}`;
  legacy.set(key, entry);
  return { ...entry };
}
function diagnostics() {
  return {
    nativeBoundaryUnavailable: true,
    unresolved: [
      ...[...legacy.values()].map((e) => ({ ...e })),
      ...[...entries]
        .filter((e) => e.started)
        .map((e) => ({
          kind: e.kind,
          pid: e.pid,
          reason: "DESCENDANTS_UNVERIFIED",
          rootExited: e.exited,
          source: "child-registry",
          inspection: e.inspection,
          knownDescendants: [...e.descendants],
          observedLiveDescendantPids: [...(e.observedLiveDescendantPids ?? [])],
          observedGroupAlive: e.observedGroupAlive ?? null,
        })),
    ],
  };
}
function signal(entry, sig) {
  // Never signal a PID recovered from disk or a root that already exited. A
  // detached root's group is signalled after the root exits only while it is
  // still that group, as observed continuously (see signalEntryGroup). Known descendants are
  // liveness diagnostics only (PID identity may change).
  try {
    if (posixGroup(entry)) signalEntryGroup(entry, sig);
    else if (!entry.exited) entry.child.kill(sig);
  } catch {} // Sending/throwing a signal is never evidence of exit.
}
// For owners that stop their own detached child (abort, timeout, cancel): the
// whole POSIX group, under the same ownership rules as the barrier's stop.
// Returns false when it did not signal (Windows, no group, continuity not observed);
// the caller then falls back to its own root-only kill.
function signalGroup(child, sig) {
  const entry = children.get(child);
  if (!entry) return false;
  try {
    return signalEntryGroup(entry, sig);
  } catch {
    return false;
  }
}
async function waitUntil(targets, ms) {
  const deadline = Date.now() + ms;
  while (targets.some(isAlive) && Date.now() < deadline) {
    for (const entry of targets) refreshTree(entry);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return targets.every((entry) => !isAlive(entry));
}
async function stopAll({ kinds, termGraceMs = 1500, killGraceMs = 1500 } = {}) {
  const matches = (e) => !kinds || kinds.includes(e.kind);
  const targets = [...entries].filter((e) => matches(e) && isAlive(e));
  for (const entry of targets) {
    refreshTree(entry);
    signal(entry, "SIGTERM");
  }
  if (!(await waitUntil(targets, termGraceMs))) {
    for (const entry of targets) if (isAlive(entry)) signal(entry, "SIGKILL");
    await waitUntil(targets, killGraceMs);
  }
  const failed = [...targets.filter(isAlive), ...[...legacy.values()].filter(matches)].map(
    (e) => e.kind
  );
  if (failed.length)
    throw Object.assign(new Error(`Child processes remain unresolved: ${failed.join(", ")}`), {
      code: "CHILD_STOP_FAILED",
      kinds: [...new Set(failed)],
    });
}

function sessionOwner(kind) {
  const current = gate.currentTicket();
  if (current?.meter === "opaque" && !current.settled && !current.signal.aborted)
    return { ticket: current, owns: false };
  return {
    ticket: gate.authorize({
      task: gate.currentTask() ?? "unattributed",
      target: `https://native-${kind.replace(/[^a-z0-9-]/g, "-") || "unknown"}`,
      meter: "opaque",
    }),
    owns: true,
  };
}
function opaqueSession(child, kind) {
  if (sessions.has(child)) return;
  sessions.add(child);
  // Allocate while launch admission is still unsealed, including a utility
  // child that receives its pid later. Starting is not re-authorized on spawn.
  const { ticket, owns } = sessionOwner(kind);
  const release = ticket.retainTransport();
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    ticket.markDispatched();
  };
  if (child.pid) start();
  else child.once("spawn", start);
  onChildEnd(child, ({ code, signal, failedToStart }) => {
    if (owns) {
      if (failedToStart) ticket.discard();
      else ticket.settle({ outcome: signal ? "cancelled" : code === 0 ? "ok" : "error" });
    }
    release();
  });
}
function syncLaunch(original, receiver, args, command, name) {
  const { ticket, owns } = sessionOwner(kindOf(command));
  const finish = (result, error) => {
    const pid = result?.pid ?? error?.pid ?? null;
    const failedStart =
      !pid &&
      (result?.error || error) &&
      ["ENOENT", "EACCES", "EINVAL", "ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_VALUE"].includes(
        (result?.error ?? error).code
      );
    if (failedStart) {
      if (owns) ticket.discard();
      return;
    }
    ticket.markDispatched();
    if (owns)
      ticket.settle({
        outcome:
          error || result?.error || (name === "spawnSync" && result.status !== 0) ? "error" : "ok",
      });
    recordUnresolved({
      kind: kindOf(command),
      pid,
      reason: "DESCENDANTS_UNVERIFIED",
      rootExited: !error || error.status != null || error.signal != null,
      source: "sync-child",
    });
  };
  try {
    const result = original.apply(receiver, args);
    finish(result);
    return result;
  } catch (error) {
    finish(null, error);
    throw error;
  }
}
function check(command, args, options, shellLine = null) {
  // The refusal precedes even FFmpeg validation: no category has a capability.
  // A refused start is recorded as a nativeLaunch operation, not a request.
  if (gate.isSealed()) throw gate.refuseNativeLaunch(kindOf(command));
  const ffmpeg = /^ffmpeg/.test(baseName(command));
  const shellArgs =
    /^(?:sh|bash|dash|zsh|cmd(?:\.exe)?|powershell(?:\.exe)?)$/.test(baseName(command)) &&
    args.some((arg) => /ffmpeg/i.test(String(arg)));
  if (ffmpeg || shellArgs || (shellLine && /ffmpeg/i.test(shellLine))) {
    const { localOnlyInputs } = require("../ffmpegUtils");
    const unsafe = () => {
      throw Object.assign(new Error("FFmpeg requires direct local-only arguments"), {
        code: "FFMPEG_UNSAFE_INPUT",
      });
    };
    if (shellLine || shellArgs || options.shell) unsafe();
    const restricted = localOnlyInputs(args);
    if (restricted.length !== args.length || restricted.some((a, i) => a !== args[i])) unsafe();
  }
}
// Native APIs return synchronously even when their process runs asynchronously.
// Preserve outer exec intent across its internal execFile shell call, without
// carrying that attribution into later callbacks or unrelated async launches.
function callNative(original, receiver, args, intent) {
  const previous = launchIntent;
  launchIntent = intent;
  try {
    return original.apply(receiver, args);
  } finally {
    launchIntent = previous;
  }
}
function installSpawnGuard({
  childProcess = require("node:child_process"),
  utilityProcess = null,
  processObject = process,
} = {}) {
  for (const name of [
    "spawn",
    "exec",
    "execFile",
    "fork",
    "spawnSync",
    "execSync",
    "execFileSync",
  ]) {
    const original = childProcess[name];
    if (typeof original !== "function" || guarded.has(original)) continue;
    const wrapper = function (...args) {
      const options =
        args.find((v, i) => i > 0 && v && typeof v === "object" && !Array.isArray(v)) ?? {};
      const shellLine = name === "exec" || name === "execSync" ? String(args[0]) : null;
      const command =
        name === "fork"
          ? (options.execPath ?? process.execPath)
          : shellLine
            ? shellLine.split(/\s+/)[0]
            : args[0];
      check(command, Array.isArray(args[1]) ? args[1] : [], options, shellLine);
      if (name.endsWith("Sync")) return syncLaunch(original, this, args, command, name);
      const intent = launchIntent ?? command;
      const result = callNative(original, this, args, intent);
      register(result, {
        kind: kindOf(intent),
        group: options.detached === true,
        tree: true,
        local: SIDECAR.test(baseName(intent)),
      });
      opaqueSession(result, kindOf(intent));
      return result;
    };
    if (name === "exec" || name === "execFile")
      wrapper[promisify.custom] = (...args) => {
        let child;
        const promise = new Promise((resolve, reject) => {
          child = wrapper(...args, (error, stdout, stderr) => {
            if (error) {
              error.stdout = stdout;
              error.stderr = stderr;
              reject(error);
            } else resolve({ stdout, stderr });
          });
        });
        promise.child = child;
        return promise;
      };
    guarded.add(wrapper);
    childProcess[name] = wrapper;
  }
  if (
    utilityProcess &&
    typeof utilityProcess.fork === "function" &&
    !guarded.has(utilityProcess.fork)
  ) {
    const original = utilityProcess.fork;
    const wrapper = function (...args) {
      check("utility-process", [], {});
      const result = callNative(original, this, args, "utility-process");
      register(result, { kind: "utility-process", tree: true, local: true });
      opaqueSession(result, "utility-process");
      return result;
    };
    guarded.add(wrapper);
    utilityProcess.fork = wrapper;
  }
  // Every child_process API (and anything holding the class) launches through
  // ChildProcess.prototype.spawn (Task 18 T18-04). A launch that a guarded
  // module function already checked runs under its launch intent and is
  // registered there; a direct call is checked and registered here.
  const proto = childProcess.ChildProcess?.prototype;
  if (proto && typeof proto.spawn === "function" && !guarded.has(proto.spawn)) {
    const original = proto.spawn;
    const wrapper = function (options, ...rest) {
      if (launchIntent !== null) return original.call(this, options, ...rest);
      const file = options?.file;
      check(file, Array.isArray(options?.args) ? options.args.slice(1) : [], options ?? {});
      const result = callNative(original, this, [options, ...rest], file);
      register(this, {
        kind: kindOf(file),
        group: options?.detached === true,
        tree: true,
        local: SIDECAR.test(baseName(file)),
      });
      opaqueSession(this, kindOf(file));
      return result;
    };
    guarded.add(wrapper);
    proto.spawn = wrapper;
  }
  // process.execve replaces Loqui itself with another program: a launch too.
  if (
    processObject &&
    typeof processObject.execve === "function" &&
    !guarded.has(processObject.execve)
  ) {
    const original = processObject.execve;
    const wrapper = function (file, ...rest) {
      check(file, Array.isArray(rest[0]) ? rest[0] : [], {});
      return original.call(this, file, ...rest);
    };
    guarded.add(wrapper);
    processObject.execve = wrapper;
  }
  if (childProcess === require("node:child_process")) syncBuiltinESMExports();
}
function assertTestProcess() {
  if (!process.env.NODE_TEST_CONTEXT)
    throw new Error("Child registry test controls require node:test");
}
function _resetForTests() {
  assertTestProcess();
  entries = new Set();
  children = new WeakMap();
  sessions = new WeakSet();
  legacy = new Map();
  nextSyncRecord = 0;
  for (const stop of groupWatches) stop();
  groupWatches = new Set();
  system = defaults();
  localBinaryDirs = new Set(initialDirs());
}
function _setSystemForTests(overrides) {
  assertTestProcess();
  system = { ...system, ...overrides };
}
module.exports = {
  installSpawnGuard,
  register,
  alive,
  stopAll,
  signalGroup,
  onChildEnd,
  classify,
  kindOf,
  registerLocalBinaryDir,
  getNativeBoundary,
  recordUnresolved,
  diagnostics,
  _resetForTests,
  _setSystemForTests,
};
