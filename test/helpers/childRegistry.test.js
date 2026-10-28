const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const gate = require("../../src/helpers/privacy/egressGate");
const registry = require("../../src/helpers/privacy/childRegistry");
let sealed;
let rows;
test.beforeEach(() => {
  sealed = false;
  rows = [];
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => sealed, recorder: { record: (row) => rows.push(row) } });
  registry._resetForTests();
  registry._setSystemForTests({
    listProcesses: () => [],
    pidAlive: () => false,
    groupAlive: () => false,
    killGroup: () => {},
  });
});
function child(pid = 41001) {
  const c = new EventEmitter();
  c.pid = pid;
  c.signals = [];
  c.kill = (s) => {
    c.signals.push(s);
    return true;
  };
  return c;
}
function leaf() {
  const calls = [];
  const cp = { calls };
  for (const name of ["spawn", "exec", "execFile", "fork", "spawnSync", "execSync", "execFileSync"])
    cp[name] = (...args) => {
      calls.push({ name, args });
      return name.endsWith("Sync") ? { status: 0 } : child();
    };
  return cp;
}
for (const name of ["spawn", "exec", "execFile", "fork", "spawnSync", "execSync", "execFileSync"]) {
  test(`${name} refuses every classification before its native leaf while sealed`, () => {
    const cp = leaf();
    registry.installSpawnGuard({ childProcess: cp });
    sealed = true;
    for (const command of [
      "curl",
      "llama-server",
      "qdrant",
      "ffmpeg",
      "ps",
      "sh",
      "unknown",
      process.execPath,
      "/tmp/node_modules/sdk/helper",
      path.resolve("resources/bin/helper"),
    ]) {
      const args =
        command === "ffmpeg" ? ["-protocol_whitelist", "file,pipe", "-i", "pipe:0", "pipe:1"] : [];
      assert.throws(() => cp[name](command, args), { code: "SEALED_MODE" });
    }
    assert.equal(cp.calls.length, 0);
    // One nativeLaunch row per refused program per seal (final review I1):
    // the two "helper" launches share a row, and fork always starts Node.
    assert.equal(rows.length, name === "fork" ? 1 : 9);
    assert.ok(
      rows.every((r) => r.task === "nativeLaunch" && r.outcome === "blocked" && r.bytesOut === 0)
    );
  });
}
test("utility guard installs independently and idempotently, and worker paths confer no admission", () => {
  const cp = leaf();
  let calls = 0;
  const utility = {
    fork: () => {
      calls++;
      return child();
    },
  };
  registry.installSpawnGuard({ childProcess: cp });
  const first = cp.spawn;
  registry.installSpawnGuard({ childProcess: cp, utilityProcess: utility });
  const fork = utility.fork;
  registry.installSpawnGuard({ childProcess: cp, utilityProcess: utility });
  assert.equal(cp.spawn, first);
  assert.equal(utility.fork, fork);
  sealed = true;
  for (const p of [path.resolve("src/workers/onnxWorker.js"), "/tmp/worker.js"])
    assert.throws(() => utility.fork(p), { code: "SEALED_MODE" });
  assert.equal(calls, 0);
  sealed = false;
  const c = utility.fork("/tmp/fixture.js");
  assert.equal(registry.alive().length, 1);
  c.emit("exit", 0, null);
  assert.equal(registry.diagnostics().unresolved[0].reason, "DESCENDANTS_UNVERIFIED");
});
test("classification and binary directories are diagnostic only", () => {
  registry.registerLocalBinaryDir("/tmp/loqui-fixture-bin");
  assert.equal(registry.classify("/tmp/loqui-fixture-bin/tool"), "bundled");
  assert.equal(registry.classify("/tmp/loqui-fixture-bin-else/tool"), "unclassified");
  assert.equal(registry.classify("llama-server"), "bundled");
  assert.equal(registry.classify("ffmpeg"), "ffmpeg");
  assert.equal(registry.classify(process.execPath), "self");
  assert.equal(registry.classify("tool", "at /tmp/node_modules/sdk/index.js"), "thirdParty");
  assert.equal(registry.classify("C:\\tools\\yt-dlp.exe"), "network");
  assert.equal(registry.kindOf("C:\\tools\\yt-dlp.exe"), "yt-dlp");
  assert.deepEqual(registry.getNativeBoundary(), {
    available: false,
    reason: "NATIVE_BOUNDARY_UNAVAILABLE",
  });
});
test("signal is never an exit, local entries are stopped too, escalation waits", async () => {
  const c = child();
  registry.register(c, { kind: "llama", local: true });
  c.kill = (s) => {
    c.signals.push(s);
    if (s === "SIGKILL") setTimeout(() => c.emit("exit", null, s), 5);
  };
  await assert.rejects(registry.stopAll({ termGraceMs: 10, killGraceMs: 30 }), {
    code: "CHILD_STOP_FAILED",
  });
  assert.deepEqual(c.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(registry.diagnostics().unresolved[0].rootExited, true);
});
test("surviving or throwing kills retain named failure evidence", async () => {
  const c = child();
  c.kill = () => {
    throw Object.assign(new Error("denied"), { code: "EPERM" });
  };
  registry.register(c, { kind: "codex" });
  await assert.rejects(
    registry.stopAll({ termGraceMs: 1, killGraceMs: 1 }),
    (e) => e.code === "CHILD_STOP_FAILED" && e.kinds.includes("codex")
  );
  assert.equal(registry.alive().length, 1);
});
test("actual end is once; errors after start (even with cleared pid) are not ends", () => {
  const c = child();
  const ends = [];
  registry.onChildEnd(c, (end) => ends.push(end));
  registry.register(c, { kind: "fixture" });
  c.pid = undefined;
  c.emit("error", new Error("after start"));
  assert.equal(ends.length, 0);
  assert.equal(registry.alive().length, 1);
  c.emit("close", 3, null);
  c.emit("exit", 3, null);
  assert.deepEqual(ends, [{ code: 3, signal: null, failedToStart: false }]);
  assert.equal(registry.diagnostics().unresolved[0].rootExited, true);
});
test("pending/no-pid start waits for actual failure and produces no running session", () => {
  const c = child(undefined);
  c.pid = undefined;
  const ends = [];
  registry.onChildEnd(c, (e) => ends.push(e));
  registry.register(c, { kind: "fixture", tree: true });
  assert.equal(registry.alive().length, 1);
  c.emit("error", new Error("failed start"));
  c.emit("close", -2, null);
  assert.deepEqual(ends, [{ code: null, signal: null, failedToStart: true }]);
  assert.deepEqual(registry.alive(), []);
});
test("group liveness is retained after root exit; absence is not whole-tree proof", async () => {
  let groupAlive = true;
  registry._setSystemForTests({ groupAlive: () => groupAlive });
  const c = child();
  registry.register(c, { kind: "fixture", group: true, tree: true });
  c.emit("exit", 0, null);
  assert.equal(registry.alive().length, 1);
  groupAlive = false;
  await assert.rejects(registry.stopAll({ termGraceMs: 1, killGraceMs: 1 }), {
    code: "CHILD_STOP_FAILED",
  });
  assert.equal(registry.diagnostics().unresolved[0].reason, "DESCENDANTS_UNVERIFIED");
});
test("known descendants refresh unsealed, but snapshots cannot retire unknown coverage", async () => {
  let lists = 0;
  registry._setSystemForTests({
    listProcesses: () => {
      lists++;
      return [{ pid: 41002, ppid: 41001 }];
    },
    pidAlive: () => false,
  });
  const c = child();
  registry.register(c, { kind: "fixture", tree: true });
  registry.alive();
  registry.alive();
  assert.equal(lists, 1);
  c.emit("exit", 0, null);
  assert.equal(registry.alive().length, 1);
  assert.deepEqual(registry.diagnostics().unresolved[0].knownDescendants, [41002]);
  await assert.rejects(registry.stopAll({ termGraceMs: 1, killGraceMs: 1 }), {
    code: "CHILD_STOP_FAILED",
  });
});
test("sealed tree inspection sends no native probe, and failed inspection retains discoveries", () => {
  let lists = 0;
  registry._setSystemForTests({
    listProcesses: () => {
      lists++;
      throw new Error("inspection failed");
    },
  });
  sealed = true;
  registry.register(child(), { kind: "fixture", tree: true });
  registry.alive();
  assert.equal(lists, 0);
  sealed = false;
  registry.alive();
  assert.equal(lists, 1);
  assert.equal(registry.diagnostics().unresolved[0].inspection, "failed");
});
test("each unsealed launch has one opaque session at actual end, no duplicate registration", () => {
  const cp = leaf();
  registry.installSpawnGuard({ childProcess: cp });
  const c = cp.spawn("curl", []);
  registry.register(c, { kind: "curl" });
  c.emit("error", new Error("after start"));
  assert.equal(rows.length, 0);
  c.emit("exit", 2, null);
  c.emit("close", 2, null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "session");
  assert.equal(rows[0].outcome, "error");
  assert.equal(rows[0].bytesOut, null);
  assert.equal(rows[0].bytesIn, null);
  assert.equal(registry.alive().length, 1, "uncontained descendants stay unresolved");
});
test("a caller-owned opaque ticket is retained and never double-settled by registry", () => {
  const cp = leaf();
  registry.installSpawnGuard({ childProcess: cp });
  const ticket = gate.authorize({
    task: "unattributed",
    target: "https://fixture.invalid",
    meter: "opaque",
  });
  const c = gate.runWithTicket(ticket, () => cp.spawn("curl", []));
  ticket.settle({ outcome: "error" });
  assert.equal(gate.activeRemoteCount(), 1);
  c.emit("exit", 0, null);
  assert.equal(rows.length, 1);
  assert.equal(gate.activeRemoteCount(), 0);
});
test(
  "real builtin and ESM wrappers refuse before starting a subprocess",
  { timeout: 10000 },
  async (t) => {
    const script = `
    const gate = require(${JSON.stringify(require.resolve("../../src/helpers/privacy/egressGate"))});
    gate.configureEgress({isSealed: () => true});
    require(${JSON.stringify(require.resolve("../../src/helpers/privacy/childRegistry"))}).installSpawnGuard();
    (async () => {
      const cp = await import('node:child_process');
      for (const name of ['spawn','exec','execFile','fork','spawnSync','execSync','execFileSync']) {
        try { cp[name](process.execPath, ['-e','process.exit(99)']); throw Error('reached'); }
        catch(e) { if(e.code !== 'SEALED_MODE') throw e; }
      }
    })().catch(e => { console.error(e); process.exitCode=1; });`;
    const c = spawn(process.execPath, ["-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
      killSignal: "SIGKILL",
      timeout: 8000,
    });
    t.after(() => {
      if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
    });
    let stderr = "";
    c.stderr.on("data", (b) => {
      stderr += b;
    });
    assert.deepEqual(await once(c, "close"), [0, null], stderr);
  }
);

test("pending native start admitted unsealed stays owned across seal, failed starts have no session", () => {
  const cp = leaf();
  cp.spawn = () => {
    const c = child();
    c.pid = undefined;
    return c;
  };
  registry.installSpawnGuard({ childProcess: cp });
  const failed = cp.spawn("curl", []);
  failed.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" }));
  assert.equal(rows.length, 0);
  const pending = cp.spawn("curl", []);
  sealed = true;
  pending.pid = 41001;
  pending.emit("spawn");
  pending.emit("exit", 0, null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "session");
  assert.equal(rows[0].outcome, "ok");
});
test("Sync returns and after-start failures retain opaque and unknown-descendant evidence", () => {
  const cp = leaf();
  cp.spawnSync = () => ({ status: 0, pid: 41001 });
  cp.execFileSync = () => Buffer.from("fixture");
  cp.execSync = () => {
    throw Object.assign(new Error("after start"), { pid: 41003, status: 1 });
  };
  registry.installSpawnGuard({ childProcess: cp });
  cp.spawnSync(process.execPath, []);
  cp.execFileSync(process.execPath, []);
  assert.throws(() => cp.execSync("fixture"));
  assert.equal(rows.filter((r) => r.kind === "session").length, 3);
  assert.equal(registry.diagnostics().unresolved.length, 3);
  assert.ok(registry.diagnostics().unresolved.every((e) => e.rootExited));
});
test("a failed native start with no pid makes no opaque session or tree evidence", () => {
  const cp = leaf();
  cp.spawnSync = () => ({ error: Object.assign(new Error("missing"), { code: "ENOENT" }), pid: 0 });
  cp.execFileSync = () => {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  };
  registry.installSpawnGuard({ childProcess: cp });
  cp.spawnSync("fixture", []);
  assert.throws(() => cp.execFileSync("fixture", []));
  assert.equal(rows.length, 0);
  assert.deepEqual(registry.diagnostics().unresolved, []);
});
test("promisified exec entry still refuses sealed before native leaf", async () => {
  const cp = leaf();
  registry.installSpawnGuard({ childProcess: cp });
  sealed = true;
  for (const name of ["exec", "execFile"])
    await assert.rejects(require("node:util").promisify(cp[name])("fixture"), {
      code: "SEALED_MODE",
    });
  assert.equal(cp.calls.length, 0);
});

test("nested exec/execFile wrappers record exactly one session", () => {
  const cp = leaf();
  cp.exec = (...args) => cp.execFile(...args);
  registry.installSpawnGuard({ childProcess: cp });
  const c = cp.exec("fixture");
  c.emit("exit", 0, null);
  assert.equal(rows.filter((r) => r.kind === "session").length, 1);
});
test("a root-only registration never erases uncontained descendant coverage", async () => {
  const c = child();
  registry.register(c, { kind: "fixture" });
  c.emit("exit", 0, null);
  assert.equal(registry.alive().length, 1);
  await assert.rejects(registry.stopAll({ termGraceMs: 0, killGraceMs: 0 }), {
    code: "CHILD_STOP_FAILED",
  });
  assert.equal(registry.diagnostics().unresolved[0].reason, "DESCENDANTS_UNVERIFIED");
});

test("a failed later snapshot preserves earlier known-descendant evidence", () => {
  const c = child();
  let now = 0;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    registry._setSystemForTests({ listProcesses: () => [{ pid: 41002, ppid: 41001 }] });
    registry.register(c, { kind: "fixture", tree: true });
    registry.alive();
    now = 251;
    registry._setSystemForTests({
      listProcesses: () => {
        throw Error("failed");
      },
    });
    registry.alive();
    const unresolved = registry.diagnostics().unresolved[0];
    assert.equal(unresolved.inspection, "failed");
    assert.deepEqual(unresolved.knownDescendants, [41002]);
    c.emit("exit", 0, null);
    assert.equal(registry.alive().length, 1);
  } finally {
    Date.now = originalNow;
  }
});

test("ended children retain metadata without retaining child streams or callback payloads", () => {
  const c = child();
  const entry = registry.register(c, { kind: "fixture" });
  c.emit("exit", 0, null);
  assert.equal(entry.child, null);
  assert.equal(registry.diagnostics().unresolved[0].rootExited, true);
});
test("separate no-pid Sync completions are separate unresolved observations", () => {
  const cp = leaf();
  cp.execFileSync = () => Buffer.from("fixture");
  registry.installSpawnGuard({ childProcess: cp });
  cp.execFileSync("fixture", []);
  cp.execFileSync("fixture", []);
  assert.equal(registry.diagnostics().unresolved.length, 2);
  assert.equal(rows.filter((r) => r.kind === "session").length, 2);
});

test("exec's internal execFile shell keeps the outer program kind and one opaque session", () => {
  const cp = leaf();
  cp.exec = () => cp.execFile("/bin/sh", ["-c", "curl fixture"]);
  registry.installSpawnGuard({ childProcess: cp });
  const c = cp.exec("curl fixture");
  assert.equal(registry.alive()[0].kind, "curl");
  c.emit("exit", 0, null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].host, "native-curl");
});

test("known descendant PID liveness changes without resolving unknown coverage", () => {
  const running = new Set([41002]);
  registry._setSystemForTests({
    listProcesses: () => [{ pid: 41002, ppid: 41001 }],
    pidAlive: (pid) => running.has(pid),
  });
  const c = child();
  registry.register(c, { kind: "fixture", tree: true });
  registry.alive();
  c.emit("exit", 0, null);
  registry.alive();
  assert.deepEqual(registry.diagnostics().unresolved[0].observedLiveDescendantPids, [41002]);
  running.clear();
  registry.alive();
  assert.deepEqual(registry.diagnostics().unresolved[0].observedLiveDescendantPids, []);
  assert.equal(registry.diagnostics().unresolved[0].reason, "DESCENDANTS_UNVERIFIED");
});

// --- Process groups after the root exits (Task 10 fix round 1, I1) ---
//
// Every process fact below is a fake: the group id is beyond every kernel's
// pid range (Linux PID_MAX_LIMIT 4194304, macOS 99999), and killGroup,
// groupAlive, the clock and the continuity watch are all injected. Nothing is
// probed or signalled for real.
const FAKE_GROUP = 4_206_649;
const posixGroups = {
  skip: process.platform === "win32" && "process groups are POSIX-only (Windows is 07b)",
};
// D-3 identity facts: the leader as read at spawn, the process (if any) now
// holding the leader's pid, and the group's members. By default the root's
// payload outlives it in the same session, started after the leader.
const LEADER = { pid: FAKE_GROUP, pgid: FAKE_GROUP, sid: FAKE_GROUP, startTime: 1000 };
const PAYLOAD = { pid: FAKE_GROUP + 1, pgid: FAKE_GROUP, sid: FAKE_GROUP, startTime: 1001 };
function groupFacts({ alive = true } = {}) {
  const facts = {
    alive,
    now: 0,
    kills: [],
    probes: 0,
    watches: [],
    leader: { ...LEADER },
    holder: null,
    members: [{ ...PAYLOAD }],
    reads: 0,
  };
  let spawned = false;
  registry._setSystemForTests({
    readIdentity: (pid) => {
      assert.equal(pid, FAKE_GROUP);
      facts.reads++;
      if (!spawned) {
        spawned = true; // the first read is the one at spawn
        if (facts.leader instanceof Error) throw facts.leader;
        return facts.leader;
      }
      if (facts.holder instanceof Error) throw facts.holder;
      return facts.holder;
    },
    groupMembers: (pgid) => {
      assert.equal(pgid, FAKE_GROUP);
      if (facts.members instanceof Error) throw facts.members;
      return facts.members;
    },
    groupAlive: (pid) => {
      assert.equal(pid, FAKE_GROUP);
      facts.probes++;
      return facts.alive;
    },
    killGroup: (pid, signal) => facts.kills.push([pid, signal]),
    now: () => facts.now,
    every: (fn) => {
      facts.watches.push(fn);
      return () => (facts.watches = facts.watches.filter((watch) => watch !== fn));
    },
  });
  facts.tick = (ms) => {
    facts.now += ms;
    for (const watch of [...facts.watches]) watch();
  };
  return facts;
}

test(
  "signalGroup signals a live detached root's whole group, and nothing it does not own",
  posixGroups,
  () => {
    const facts = groupFacts();
    const root = child(FAKE_GROUP);
    registry.register(root, { kind: "yt-dlp", group: true, tree: true });
    assert.equal(registry.signalGroup(root, "SIGKILL"), true);
    assert.deepEqual(facts.kills, [[FAKE_GROUP, "SIGKILL"]]);
    assert.deepEqual(root.signals, [], "the group signal already reaches the root");

    assert.equal(registry.signalGroup(child(FAKE_GROUP), "SIGKILL"), false, "unregistered");
    const rootOnly = child(FAKE_GROUP);
    registry.register(rootOnly, { kind: "fixture", tree: true });
    assert.equal(registry.signalGroup(rootOnly, "SIGKILL"), false, "not its own group");
    const unstarted = child();
    unstarted.pid = undefined;
    registry.register(unstarted, { kind: "yt-dlp", group: true, tree: true });
    assert.equal(registry.signalGroup(unstarted, "SIGKILL"), false, "no pid, no group");
    assert.equal(facts.kills.length, 1);
  }
);

test(
  "a group that outlives its root is still stopped, and stays unresolved",
  posixGroups,
  async () => {
    const facts = groupFacts();
    const root = child(FAKE_GROUP);
    registry.register(root, { kind: "yt-dlp", group: true, tree: true });
    root.emit("exit", null, "SIGKILL"); // the bootloader root died; its payload did not
    facts.tick(100);
    facts.tick(100);
    await assert.rejects(registry.stopAll({ termGraceMs: 1, killGraceMs: 1 }), {
      code: "CHILD_STOP_FAILED",
    });
    assert.deepEqual(facts.kills, [
      [FAKE_GROUP, "SIGTERM"],
      [FAKE_GROUP, "SIGKILL"],
    ]);
    assert.deepEqual(root.signals, []);
    assert.equal(registry.alive().length, 1, "a signal and a root exit are not whole-tree proof");
    const [fact] = registry.diagnostics().unresolved;
    assert.deepEqual([fact.reason, fact.rootExited], ["DESCENDANTS_UNVERIFIED", true]);
  }
);

// Owner decision D-3: proof of ownership before signalling a reaped root's group.
async function stopRefused(facts) {
  const error = await registry.stopAll({ termGraceMs: 1, killGraceMs: 1 }).catch((e) => e);
  assert.equal(error?.code, "CHILD_STOP_FAILED", "the barrier fails closed");
  assert.deepEqual(facts.kills, [], "no signal to an unproven group");
  assert.equal(registry.alive().length, 1, "the obligation stays unresolved");
  const [fact] = registry.diagnostics().unresolved;
  assert.equal(fact.reason, "GROUP_OWNERSHIP_UNPROVEN");
  return { error, fact };
}
function exitedRoot(facts) {
  const root = child(FAKE_GROUP);
  registry.register(root, { kind: "yt-dlp", group: true, tree: true });
  root.emit("exit", 0, null);
  facts.tick(100);
  return root;
}

test("D-3: the leader's identity is read once, at spawn", posixGroups, () => {
  const facts = groupFacts();
  const root = child(FAKE_GROUP);
  registry.register(root, { kind: "yt-dlp", group: true, tree: true });
  root.emit("spawn");
  assert.equal(facts.reads, 1);
});

test("D-3: a matching group is signalled after its root exits", posixGroups, async () => {
  const facts = groupFacts();
  exitedRoot(facts);
  assert.equal(registry.signalGroup(child(FAKE_GROUP), "SIGTERM"), false, "unregistered");
  await assert.rejects(registry.stopAll({ termGraceMs: 1, killGraceMs: 1 }), {
    code: "CHILD_STOP_FAILED", // a signal is still not whole-tree proof
  });
  assert.deepEqual(facts.kills, [
    [FAKE_GROUP, "SIGTERM"],
    [FAKE_GROUP, "SIGKILL"],
  ]);
  const [fact] = registry.diagnostics().unresolved;
  assert.deepEqual([fact.reason, fact.groupProof], ["DESCENDANTS_UNVERIFIED", "proven"]);
});

test("D-3: a reused PGID is never killed", posixGroups, async (t) => {
  for (const [label, change, reason] of [
    [
      "an unrelated process now holds the leader's pid",
      (f) => (f.holder = { ...LEADER, startTime: 9000 }),
      "PID_REUSED",
    ],
    [
      "a group member started before our leader",
      (f) => (f.members = [{ ...PAYLOAD, startTime: 999 }]),
      "PGID_REUSED",
    ],
    [
      "a group member in another session",
      (f) => (f.members = [{ ...PAYLOAD, sid: 77 }]),
      "PGID_REUSED",
    ],
  ]) {
    await t.test(label, async () => {
      registry._resetForTests();
      const facts = groupFacts();
      const root = exitedRoot(facts);
      change(facts);
      assert.equal(registry.signalGroup(root, "SIGKILL"), false);
      const { error, fact } = await stopRefused(facts);
      assert.equal(fact.groupProof, reason);
      assert.deepEqual(error.unproven, [{ kind: "yt-dlp", pid: FAKE_GROUP, reason }]);
    });
  }
});

test("D-3: unreadable proc data is never killed and fails closed", posixGroups, async (t) => {
  const unreadable = () => Object.assign(new Error("EACCES"), { code: "EACCES" });
  for (const [label, change, reason] of [
    ["the group's members cannot be read", (f) => (f.members = unreadable()), "PROC_UNREADABLE"],
    ["the leader's pid cannot be read", (f) => (f.holder = unreadable()), "PROC_UNREADABLE"],
    [
      "a member's start time is missing",
      (f) => (f.members = [{ ...PAYLOAD, startTime: undefined }]),
      "PROC_UNREADABLE",
    ],
    ["no identity was recorded at spawn", (f) => void f, "PROC_UNREADABLE"],
  ]) {
    await t.test(label, async () => {
      registry._resetForTests();
      const facts = groupFacts();
      if (label.startsWith("no identity")) facts.leader = unreadable();
      const root = exitedRoot(facts);
      change(facts);
      assert.equal(registry.signalGroup(root, "SIGKILL"), false);
      const { fact } = await stopRefused(facts);
      assert.equal(fact.groupProof, reason);
    });
  }
});

test("D-3: a spawn read that finds no group leader records why", posixGroups, async () => {
  const facts = groupFacts();
  facts.leader = { ...LEADER, pgid: 12 }; // not the leader of its own group
  exitedRoot(facts);
  const { fact } = await stopRefused(facts);
  assert.equal(fact.groupProof, "NOT_GROUP_LEADER");
});

// Review M-3: after our group fully ended, an unrelated process got the pid,
// called setsid (so its pgid and sid equal ours), forked and exited. Every
// field the spawn-time identity checks matches; only the members seen when
// our root exited tell the groups apart.
test("D-3: a reuser that leads a new session and exits is never killed", posixGroups, async () => {
  const facts = groupFacts();
  const root = exitedRoot(facts);
  facts.members = [{ pid: FAKE_GROUP + 7, pgid: FAKE_GROUP, sid: FAKE_GROUP, startTime: 5000 }];
  assert.equal(registry.signalGroup(root, "SIGKILL"), false);
  const { fact } = await stopRefused(facts);
  assert.equal(fact.groupProof, "PGID_REUSED");
});

test(
  "D-3: a member seen at the root's exit proves the group, even after it gained members",
  posixGroups,
  () => {
    const facts = groupFacts();
    const root = exitedRoot(facts);
    facts.members = [{ ...PAYLOAD }, { ...PAYLOAD, pid: FAKE_GROUP + 2, startTime: 4000 }];
    assert.equal(registry.signalGroup(root, "SIGTERM"), true);
    assert.deepEqual(facts.kills, [[FAKE_GROUP, "SIGTERM"]]);
  }
);

test(
  "D-3: a group whose members could not be read at the root's exit fails closed",
  posixGroups,
  async () => {
    const facts = groupFacts();
    const readable = facts.members;
    facts.members = Object.assign(new Error("EACCES"), { code: "EACCES" });
    const root = exitedRoot(facts);
    facts.members = readable; // readable again when the stop comes
    assert.equal(registry.signalGroup(root, "SIGKILL"), false);
    const { fact } = await stopRefused(facts);
    assert.equal(fact.groupProof, "PROC_UNREADABLE");
  }
);

// Review M-4: macOS reads identities with ps. At spawn (and at the root's
// exit) that read is asynchronous, so it never blocks main; until it lands
// the group is unproven, and a read that lands after the root was reaped is
// discarded.
test(
  "D-3: an asynchronous identity read never proves a group before it lands",
  posixGroups,
  async () => {
    const facts = groupFacts();
    const pending = [];
    registry._setSystemForTests({
      readIdentity: () => null, // before the signal: nothing holds the leader's pid
      readIdentityAsync: (pid) =>
        new Promise((resolve) => pending.push(() => resolve({ ...LEADER, pid }))),
      groupMembersAsync: async () => [{ ...PAYLOAD }],
    });
    const root = child(FAKE_GROUP);
    registry.register(root, { kind: "yt-dlp", group: true, tree: true });
    root.emit("spawn");
    assert.equal(pending.length, 1, "the spawn read is asynchronous");
    pending[0](); // lands while the root runs
    await new Promise((r) => setImmediate(r));
    root.emit("exit", 0, null);
    await new Promise((r) => setImmediate(r));
    facts.tick(100);
    assert.equal(registry.signalGroup(root, "SIGTERM"), true, "proven once both reads landed");

    registry._resetForTests();
    const late = groupFacts();
    const waiting = [];
    registry._setSystemForTests({
      readIdentityAsync: (pid) =>
        new Promise((resolve) => waiting.push(() => resolve({ ...LEADER, pid }))),
      groupMembersAsync: async () => [{ ...PAYLOAD }],
    });
    const lateRoot = child(FAKE_GROUP);
    registry.register(lateRoot, { kind: "yt-dlp", group: true, tree: true });
    lateRoot.emit("spawn");
    lateRoot.emit("exit", 0, null); // reaped before the read landed
    waiting[0]();
    await new Promise((r) => setImmediate(r));
    late.tick(100);
    assert.equal(registry.signalGroup(lateRoot, "SIGKILL"), false);
    const { fact } = await stopRefused(late);
    assert.equal(fact.groupProof, "IDENTITY_NOT_RECORDED");
  }
);

test("D-3: the macOS ps reader runs asynchronously and never while sealed", async () => {
  const { forPlatform } = require("../../src/helpers/privacy/processIdentity");
  const calls = [];
  const execFile = (file, args, options, callback) => {
    calls.push([file, args, options.env.LC_ALL]);
    setImmediate(() =>
      callback(
        null,
        `${FAKE_GROUP} ${FAKE_GROUP} Fri Oct 23 10:00:00 2026\n${FAKE_GROUP + 1} ${FAKE_GROUP} Fri Oct 23 10:00:01 2026\n`
      )
    );
  };
  const darwin = forPlatform("darwin", { execFile });
  const read = darwin.readIdentityAsync(FAKE_GROUP);
  assert.ok(read instanceof Promise);
  assert.deepEqual(await read, {
    pid: FAKE_GROUP,
    pgid: FAKE_GROUP,
    sid: null,
    startTime: Date.parse("Fri Oct 23 10:00:00 2026"),
  });
  assert.deepEqual(
    (await darwin.groupMembersAsync(FAKE_GROUP)).map((m) => m.pid),
    [FAKE_GROUP, FAKE_GROUP + 1]
  );
  assert.deepEqual(calls[0], ["ps", ["-o", "pid=,pgid=,lstart=", "-p", String(FAKE_GROUP)], "C"]);
  sealed = true;
  await assert.rejects(darwin.readIdentityAsync(FAKE_GROUP), /INSPECTION_REFUSED_SEALED/);
  assert.equal(calls.length, 2, "no ps launch while sealed");
});

test(
  "D-3: a live root is signalled without a proc read (its pid cannot be reused)",
  posixGroups,
  () => {
    const facts = groupFacts();
    facts.members = new Error("must not be read");
    const root = child(FAKE_GROUP);
    registry.register(root, { kind: "yt-dlp", group: true, tree: true });
    assert.equal(registry.signalGroup(root, "SIGTERM"), true);
    assert.deepEqual(facts.kills, [[FAKE_GROUP, "SIGTERM"]]);
  }
);

test("D-3: the real Linux reader parses /proc stat, including a name with spaces and parens", () => {
  const { parseStat } = require("../../src/helpers/privacy/processIdentity");
  const fields = Array.from({ length: 50 }, (_, i) => String(i + 3));
  fields[2] = "4100"; // pgrp
  fields[3] = "4100"; // session
  fields[19] = "123456"; // starttime
  assert.deepEqual(parseStat(`4100 (yt dlp) (x)) S ${fields.slice(1).join(" ")}`), {
    pid: 4100,
    pgid: 4100,
    sid: 4100,
    startTime: 123456,
  });
  assert.throws(() => parseStat("4100 (truncated"), /PROC_UNREADABLE/);
  assert.throws(() => parseStat("4100 (x) S 1 2"), /PROC_UNREADABLE/);
});

test(
  "D-3: this process reads as its own identity on Linux",
  { skip: process.platform !== "linux" && "Linux /proc only" },
  () => {
    const { forPlatform } = require("../../src/helpers/privacy/processIdentity");
    const { readIdentity, groupMembers } = forPlatform("linux");
    const self = readIdentity(process.pid);
    assert.equal(self.pid, process.pid);
    assert.ok(self.startTime > 0);
    assert.ok(groupMembers(self.pgid).some((member) => member.pid === process.pid));
    assert.equal(readIdentity(2 ** 30), null, "no such process");
  }
);

test("a group already gone when its root exits is never signalled later", posixGroups, async () => {
  const facts = groupFacts({ alive: false });
  const root = child(FAKE_GROUP);
  registry.register(root, { kind: "yt-dlp", group: true, tree: true });
  root.emit("exit", 0, null);
  assert.equal(facts.watches.length, 0, "nothing left to watch");
  facts.alive = true; // the same id now names someone else's group
  await assert.rejects(registry.stopAll({ termGraceMs: 1, killGraceMs: 1 }), {
    code: "CHILD_STOP_FAILED",
  });
  assert.deepEqual(facts.kills, []);
  assert.equal(registry.alive().length, 1);
});

test("a watch that sees the group gone ends continuity for good", posixGroups, async () => {
  const facts = groupFacts();
  const root = child(FAKE_GROUP);
  registry.register(root, { kind: "yt-dlp", group: true, tree: true });
  root.emit("exit", 0, null);
  assert.equal(facts.watches.length, 1);
  facts.alive = false;
  facts.tick(100);
  assert.equal(facts.watches.length, 0, "the watch stops once the group is gone");
  facts.alive = true; // a reused id
  facts.tick(100);
  await assert.rejects(registry.stopAll({ termGraceMs: 1, killGraceMs: 1 }), {
    code: "CHILD_STOP_FAILED",
  });
  assert.deepEqual(facts.kills, []);
});

test(
  "observations too far apart break continuity: the group is not signalled",
  posixGroups,
  async () => {
    const facts = groupFacts();
    const root = child(FAKE_GROUP);
    registry.register(root, { kind: "yt-dlp", group: true, tree: true });
    root.emit("exit", 0, null);
    facts.now += 10_000; // the event loop stalled; the group may have ended and its id been reused
    await assert.rejects(registry.stopAll({ termGraceMs: 1, killGraceMs: 1 }), {
      code: "CHILD_STOP_FAILED",
    });
    assert.deepEqual(facts.kills, []);
    assert.equal(facts.watches.length, 0);
    assert.equal(registry.alive().length, 1);
  }
);

test("a thrown group probe at root exit never authorizes a later signal", posixGroups, async () => {
  const facts = groupFacts();
  registry._setSystemForTests({
    groupAlive: () => {
      throw Object.assign(new Error("probe failed"), { code: "EINVAL" });
    },
  });
  const root = child(FAKE_GROUP);
  registry.register(root, { kind: "yt-dlp", group: true, tree: true });
  root.emit("exit", 0, null);
  await assert.rejects(registry.stopAll({ termGraceMs: 1, killGraceMs: 1 }), {
    code: "CHILD_STOP_FAILED",
  });
  assert.deepEqual(facts.kills, []);
});

// Task 18 T18-04: every child_process API funnels through
// ChildProcess.prototype.spawn, and process.execve replaces the process. Both
// get the same sealed check as the module functions.
function chokePointLeaf() {
  const cp = leaf();
  cp.protoCalls = [];
  cp.ChildProcess = class extends EventEmitter {
    spawn(options) {
      cp.protoCalls.push(options);
      this.pid = 41010;
      return undefined;
    }
  };
  // Node's own spawn builds a ChildProcess and calls its spawn method.
  cp.spawn = (command, args = []) => {
    const c = new cp.ChildProcess();
    c.spawn({ file: command, args: [command, ...args] });
    return c;
  };
  return cp;
}
test("ChildProcess.prototype.spawn and process.execve are refused while sealed", () => {
  const cp = chokePointLeaf();
  const execveCalls = [];
  const processObject = { execve: (...args) => execveCalls.push(args) };
  registry.installSpawnGuard({ childProcess: cp, processObject });
  sealed = true;
  assert.throws(
    () => new cp.ChildProcess().spawn({ file: "curl", args: ["curl", "https://x.invalid"] }),
    { code: "SEALED_MODE" }
  );
  assert.throws(() => processObject.execve("/bin/sh", ["sh", "-c", "curl x"]), {
    code: "SEALED_MODE",
  });
  assert.deepEqual(cp.protoCalls, []);
  assert.deepEqual(execveCalls, []);
  sealed = false;
  const direct = new cp.ChildProcess();
  direct.spawn({ file: "curl", args: ["curl"] });
  assert.equal(cp.protoCalls.length, 1);
  assert.deepEqual(
    registry.alive().map((e) => e.kind),
    ["curl"]
  );
  processObject.execve("/bin/true", ["true"]);
  assert.equal(execveCalls.length, 1);
});
test("a guarded module launch through ChildProcess.prototype.spawn is one session, not two", () => {
  const cp = chokePointLeaf();
  registry.installSpawnGuard({ childProcess: cp, processObject: {} });
  const c = cp.spawn("curl", ["fixture"]);
  assert.equal(cp.protoCalls.length, 1);
  assert.equal(registry.alive().length, 1);
  c.emit("exit", 0, null);
  assert.equal(rows.filter((r) => r.kind === "session").length, 1);
});

// Final review I1: sealed periodic pollers (meeting detection's pactl and ps)
// write at most one row per program per seal, through the real spawn guard,
// and none of it is an unexplained request or a blocked request.
test("sealed polling of refused programs yields one attributed row per program", () => {
  const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
  const recorder = new FlightRecorder({ now: () => 5 });
  recorder.setPersistence(false);
  gate.configureEgress({ isSealed: () => sealed, recorder });
  const cp = leaf();
  registry.installSpawnGuard({ childProcess: cp, processObject: {} });
  sealed = true;
  gate.onSealChanged(true);
  for (let tick = 0; tick < 30; tick++) {
    assert.throws(() => cp.execFile("pactl", ["list"], () => {}), { code: "SEALED_MODE" });
    assert.throws(() => cp.spawn("ps", ["-A"]), { code: "SEALED_MODE" });
    assert.throws(() => cp.exec("pactl subscribe"), { code: "SEALED_MODE" });
  }
  assert.deepEqual(cp.calls, []);
  const rows = recorder.list();
  assert.deepEqual(rows.map((row) => row.host).sort(), ["native-pactl", "native-ps"]);
  assert.ok(rows.every((row) => row.task === "nativeLaunch" && row.attributed));
  const summary = recorder.summary();
  assert.deepEqual(summary.unattributedHosts, []);
  assert.equal(summary.blocked, 0);
  assert.equal(gate.counters().blockedSinceSealed, 0);
});

// T10-m1: the group-continuity window is measured on a monotonic clock, so a
// wall-clock jump neither ends continuity early nor stretches it.
test("group continuity is measured on a monotonic clock, not the wall clock", (t) => {
  const realNow = Date.now;
  t.after(() => {
    Date.now = realNow;
  });
  const kills = [];
  const spawnReads = new Set();
  registry._resetForTests();
  registry._setSystemForTests({
    listProcesses: () => [],
    pidAlive: () => false,
    groupAlive: () => true,
    killGroup: (pid, sig) => kills.push([pid, sig]),
    every: () => () => {},
    // D-3: ownership is proven (identity at spawn, then a payload member), so
    // only the clock decides here.
    readIdentity: (pid) =>
      spawnReads.has(pid)
        ? null
        : (spawnReads.add(pid), { pid, pgid: pid, sid: pid, startTime: 1 }),
    groupMembers: (pgid) => [{ pid: pgid + 1, pgid, sid: pgid, startTime: 2 }],
  });
  for (const jump of [3600000, -3600000]) {
    const c = child(41020 + kills.length);
    registry.register(c, { kind: "fixture", group: true });
    c.emit("exit", 0, null);
    Date.now = () => realNow() + jump;
    assert.equal(registry.signalGroup(c, "SIGTERM"), true, `jump ${jump}`);
    Date.now = realNow;
  }
  assert.equal(kills.length, 2);
});
