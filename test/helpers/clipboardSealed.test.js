const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const nodeTest = require("node:test");
// Bounded: a regression must fail, never hang the run.
const test = (name, fn) => nodeTest(name, { timeout: 15000 }, fn);

// The portal path reads a saved token: keep it in an owned temp cache root,
// never the real profile's.
const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-clipboard-sealed-"));
const savedCacheRoot = process.env.LOQUI_CACHE_ROOT;
process.env.LOQUI_CACHE_ROOT = cacheRoot;
nodeTest.after(() => {
  if (savedCacheRoot === undefined) delete process.env.LOQUI_CACHE_ROOT;
  else process.env.LOQUI_CACHE_ROOT = savedCacheRoot;
  fs.rmSync(cacheRoot, { recursive: true, force: true });
});

// Plan 07a O1: sealed auto-paste through the real clipboard.js, the real gate
// and the real spawn guard. Only Electron's clipboard and the child_process
// leaf are fakes: no real wl-copy, xdotool, osascript or paste binary runs,
// and an unsealed launch reaches a recording fake that exits 0.

class FakeClipboardItem {
  constructor(data) {
    this.data = data;
    this.types = Object.keys(data);
  }
  async getType(type) {
    return this.data[type];
  }
}
const fakeClipboard = {
  text: "",
  primary: "",
  writes: [],
  async readText() {
    return this.text;
  },
  async writeText(text) {
    await Promise.resolve();
    this.text = text;
    this.writes.push(text);
  },
  async read() {
    return [new FakeClipboardItem({ "text/plain": new Blob([this.text]) })];
  },
  async write(items) {
    for (const item of items) this.text = await (await item.getType("text/plain")).text();
    this.writes.push("<restore>");
  },
  clear() {
    this.text = "";
  },
  selection: {
    async readText() {
      return fakeClipboard.primary;
    },
    async writeText(text) {
      fakeClipboard.primary = text;
    },
  },
};
const accessibility = { onCheck: () => {} };
const fakeElectron = {
  app: { getPath: () => cacheRoot, isPackaged: false },
  clipboard: fakeClipboard,
  ClipboardItem: FakeClipboardItem,
  systemPreferences: {
    isTrustedAccessibilityClient: () => {
      accessibility.onCheck();
      return true;
    },
  },
};

// The leaf: `sh -c "command -v X"` answers from `installed`; every other
// launch is recorded and exits 0. `onProbe` lets a test seal mid-paste, and
// `onSpawn` returning true lets a test settle a launched child itself.
const host = { installed: new Set(), calls: [], onProbe: () => {}, onSpawn: () => false };
const syncResult = (status) => ({
  pid: 0,
  status,
  signal: null,
  stdout: Buffer.alloc(0),
  stderr: Buffer.alloc(0),
  output: [null, Buffer.alloc(0), Buffer.alloc(0)],
});
let nextPid = 52000;
const cp = {
  spawnSync(command, args = []) {
    host.calls.push(["spawnSync", command, args]);
    if (command === "sh") {
      const tool = /^command -v (\S+)$/.exec(args[1] ?? "")?.[1];
      host.onProbe(tool);
      return syncResult(tool && host.installed.has(tool) ? 0 : 1);
    }
    return syncResult(1);
  },
  spawn(command, args = []) {
    host.calls.push(["spawn", command, args]);
    const child = new EventEmitter();
    child.pid = ++nextPid;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    if (host.onSpawn(command, args, child)) return child;
    process.nextTick(() => {
      child.emit("exit", 0, null);
      child.emit("close", 0, null);
    });
    return child;
  },
};
for (const name of ["exec", "execFile", "fork", "execSync", "execFileSync"])
  cp[name] = () => {
    throw new Error(`clipboardSealed fixture: ${name} is not part of the leaf`);
  };

// Production installs the guard before helpers capture child_process (Task 7).
const registry = require("../../src/helpers/privacy/childRegistry");
registry.installSpawnGuard({ childProcess: cp });
const gate = require("../../src/helpers/privacy/egressGate");

// clipboard.js's logger, so a test can act at a named step ("Available paste
// tools" is logged after a tool is chosen and before its timer launches it).
const logHook = { onLog: () => {} };
const fakeLogger = Object.fromEntries(
  ["debug", "info", "warn", "error", "log"].map((level) => [
    level,
    (message) => logHook.onLog(message),
  ])
);

const originalLoad = Module._load;
const clipboardPath = require.resolve("../../src/helpers/clipboard");
function loadClipboardManager() {
  delete require.cache[clipboardPath];
  Module._load = function (request, parent, isMain) {
    if (request === "electron") return fakeElectron;
    if (request === "./debugLogger" && parent?.filename === clipboardPath) return fakeLogger;
    if (request === "child_process" || request === "node:child_process") return cp;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(clipboardPath);
  } finally {
    Module._load = originalLoad;
  }
}
const ClipboardManager = loadClipboardManager();

const flags = { sealed: false };
let rows;
const exitListeners = new Set(process.listeners("exit"));
nodeTest.beforeEach(() => {
  flags.sealed = false;
  rows = [];
  host.installed = new Set();
  host.calls.length = 0;
  host.onProbe = () => {};
  host.onSpawn = () => false;
  accessibility.onCheck = () => {};
  logHook.onLog = () => {};
  fakeClipboard.text = "previous clipboard";
  fakeClipboard.primary = "";
  fakeClipboard.writes = [];
  gate._resetForTests();
  gate.configureEgress({
    isSealed: () => flags.sealed,
    recorder: { record: (row) => rows.push(row) },
  });
  registry._resetForTests();
});
nodeTest.afterEach(() => {
  gate._resetForTests();
  for (const listener of process.listeners("exit"))
    if (!exitListeners.has(listener)) process.removeListener("exit", listener);
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Settled within `ms`, or "pending": the pre-fix paste never settled.
const within = (promise, ms = 3000) =>
  Promise.race([
    promise.then(
      (value) => ({ status: "resolved", value }),
      (error) => ({ status: "rejected", error })
    ),
    delay(ms).then(() => ({ status: "pending" })),
  ]);
const launches = () => host.calls.filter(([kind, command]) => kind === "spawn" || command !== "sh");

// Uncaught exceptions are what the pre-fix timer-callback refusal became.
function captureUncaught(t) {
  const seen = [];
  const listener = (error) => seen.push(error);
  process.prependListener("uncaughtException", listener);
  t.after(() => process.removeListener("uncaughtException", listener));
  return seen;
}

async function withPlatform(platform, env, fn) {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, "platform", descriptor);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
const X11 = {
  XDG_SESSION_TYPE: "x11",
  DISPLAY: ":0",
  WAYLAND_DISPLAY: undefined,
  XDG_CURRENT_DESKTOP: "XFCE",
  XDG_SESSION_DESKTOP: undefined,
  DESKTOP_SESSION: undefined,
  HYPRLAND_INSTANCE_SIGNATURE: undefined,
  SWAYSOCK: undefined,
};
const KDE_WAYLAND = {
  ...X11,
  XDG_SESSION_TYPE: "wayland",
  WAYLAND_DISPLAY: "wayland-1",
  XDG_CURRENT_DESKTOP: "KDE",
};
const GNOME_WAYLAND = { ...KDE_WAYLAND, XDG_CURRENT_DESKTOP: "GNOME" };

function linuxManager() {
  const manager = new ClipboardManager();
  manager.linuxFastPasteChecked = true;
  manager.linuxFastPastePath = "/opt/Loqui/resources/bin/linux-fast-paste";
  return manager;
}
function assertSealedPasteFailure(outcome, { copied = true } = {}) {
  assert.equal(outcome.status, "rejected", `the paste settled (${outcome.status})`);
  assert.equal(outcome.error.code, "SEALED_MODE", outcome.error.message);
  assert.equal(outcome.error.copiedToClipboard, copied);
}

test("Linux: a sealed paste after a warm tool cache settles as a typed sealed failure, starts nothing, keeps the text and frees the queue", async (t) => {
  const uncaught = captureUncaught(t);
  await withPlatform("linux", X11, async () => {
    const manager = linuxManager();
    host.installed = new Set(["xdotool"]);
    // Unsealed: the tools are probed and cached as installed (30 s).
    const first = await within(manager.pasteText("first words", { restoreClipboard: false }));
    assert.equal(first.status, "resolved");
    assert.ok(launches().length > 0, "the unsealed paste reached the fake leaf");

    flags.sealed = true;
    host.calls.length = 0;
    const outcome = await within(manager.pasteText("sealed words"));
    assertSealedPasteFailure(outcome);
    assert.deepEqual(launches(), [], "no paste helper reached the leaf");
    assert.equal(fakeClipboard.text, "sealed words", "the text stays on the clipboard");
    assert.ok(!fakeClipboard.writes.includes("<restore>"), "nothing restored over it");
    // The queue is free: the next clipboard operation runs.
    const next = await within(
      manager.runClipboardOperation(async () => "next"),
      1000
    );
    assert.deepEqual(next, { status: "resolved", value: "next" });
    assert.ok(
      rows.some((r) => r.task === "nativeLaunch" && r.outcome === "blocked"),
      "the refused helper is a nativeLaunch record"
    );
  });
  await delay(100);
  assert.deepEqual(
    uncaught.map((e) => e.message),
    []
  );
});

test("macOS: a sealed paste is refused before any helper or the accessibility check, and the text stays", async (t) => {
  const uncaught = captureUncaught(t);
  let checks = 0;
  accessibility.onCheck = () => checks++;
  await withPlatform("darwin", {}, async () => {
    const manager = new ClipboardManager();
    manager.fastPasteChecked = true;
    manager.fastPastePath = "/Applications/Loqui.app/Contents/Resources/macos-fast-paste";
    flags.sealed = true;
    const outcome = await within(manager.pasteText("mac words"));
    assertSealedPasteFailure(outcome);
    assert.equal(checks, 0, "no accessibility dialog (osascript) path while sealed");
    assert.equal(fakeClipboard.text, "mac words");
    assert.deepEqual(launches(), []);
    assert.ok(rows.some((r) => r.task === "nativeLaunch" && r.host === "native-macos-fast-paste"));
  });
  await delay(150);
  assert.deepEqual(
    uncaught.map((e) => e.message),
    []
  );
});

test("macOS: sealing during the paste delay rejects at once, without a retry or an uncaught exception", async (t) => {
  const uncaught = captureUncaught(t);
  // The accessibility check runs after the clipboard write, inside the macOS
  // branch: seal there, so only the timer-started helper meets the guard.
  accessibility.onCheck = () => {
    flags.sealed = true;
  };
  await withPlatform("darwin", {}, async () => {
    const manager = new ClipboardManager();
    manager.fastPasteChecked = true;
    manager.fastPastePath = "/Applications/Loqui.app/Contents/Resources/macos-fast-paste";
    const outcome = await within(manager.pasteText("raced words"));
    assertSealedPasteFailure(outcome);
    assert.equal(fakeClipboard.text, "raced words");
    assert.equal(
      fakeClipboard.writes.filter((w) => w === "raced words").length,
      1,
      "no retry rewrote the clipboard"
    );
    assert.deepEqual(launches(), []);
  });
  await delay(150);
  assert.deepEqual(
    uncaught.map((e) => e.message),
    []
  );
});

test("Linux: sealing mid-paste turns the refused fallbacks into a typed sealed failure, not 'install xdotool'", async (t) => {
  const uncaught = captureUncaught(t);
  await withPlatform("linux", X11, async () => {
    const manager = linuxManager();
    host.installed = new Set(["xdotool"]);
    // pasteLinux probes xdotool, wtype, ydotool: seal on the last probe.
    host.onProbe = (tool) => {
      if (tool === "ydotool") flags.sealed = true;
    };
    const outcome = await within(manager.pasteText("raced linux words"));
    assertSealedPasteFailure(outcome);
    assert.doesNotMatch(outcome.error.message, /install xdotool/);
    assert.equal(fakeClipboard.text, "raced linux words");
    assert.deepEqual(
      host.calls.filter(([kind]) => kind === "spawn"),
      [],
      "linux-fast-paste and xdotool were both refused before the leaf"
    );
  });
  await delay(150);
  assert.deepEqual(
    uncaught.map((e) => e.message),
    []
  );
});

test("Linux: sealing between choosing xdotool and its timed launch rejects the paste instead of throwing from the timer", async (t) => {
  const uncaught = captureUncaught(t);
  await withPlatform("linux", X11, async () => {
    const manager = new ClipboardManager();
    manager.linuxFastPasteChecked = true;
    manager.linuxFastPastePath = null;
    host.installed = new Set(["xdotool"]);
    logHook.onLog = (message) => {
      if (message === "Available paste tools") flags.sealed = true;
    };
    const outcome = await within(manager.pasteText("timed linux words"));
    assertSealedPasteFailure(outcome);
    assert.equal(fakeClipboard.text, "timed linux words");
    assert.deepEqual(
      host.calls.filter(([kind]) => kind === "spawn"),
      [],
      "xdotool was refused before the leaf"
    );
    assert.ok(rows.some((r) => r.host === "native-xdotool" && r.outcome === "blocked"));
  });
  await delay(150);
  assert.deepEqual(
    uncaught.map((e) => e.message),
    []
  );
});

test("KDE Wayland: a sealed portal refusal does not disable the portal for the rest of the session", async () => {
  await withPlatform("linux", KDE_WAYLAND, async () => {
    const manager = linuxManager();
    host.onProbe = (tool) => {
      if (tool === "ydotool") flags.sealed = true;
    };
    const outcome = await within(manager.pasteText("kde words"));
    assertSealedPasteFailure(outcome);
    assert.equal(manager.portalFailed, false);
    assert.equal(manager.portalDenied, false);
    assert.equal(manager.portalUnavailable, false);
  });
});

test("every timer-started paste helper rejects with the refusal instead of throwing from its timer", async (t) => {
  const uncaught = captureUncaught(t);
  const manager = new ClipboardManager();
  flags.sealed = true;
  const starts = {
    pasteMacOS: () => {
      manager.fastPasteChecked = true;
      manager.fastPastePath = "/x/macos-fast-paste";
      return manager.pasteMacOS(null, {});
    },
    pasteMacOSOsascript: () => {
      manager.fastPasteChecked = true;
      manager.fastPastePath = null;
      return manager.pasteMacOS(null, {});
    },
    pasteWithFastPaste: () => manager.pasteWithFastPaste("C:\\x\\windows-fast-paste.exe", null),
    pasteWithNircmd: () => manager.pasteWithNircmd("C:\\x\\nircmd.exe", null),
    pasteWithPowerShell: () => manager.pasteWithPowerShell(null),
  };
  for (const [name, start] of Object.entries(starts)) {
    const outcome = await within(start(), 2000);
    assert.equal(outcome.status, "rejected", `${name} settled (${outcome.status})`);
    assert.equal(outcome.error.code, "SEALED_MODE", name);
  }
  assert.deepEqual(launches(), []);
  await delay(50);
  assert.deepEqual(
    uncaught.map((e) => e.message),
    []
  );
});

test("a sealed tool probe starts nothing and is not cached, so unsealing finds the tool again", async () => {
  await withPlatform("linux", X11, async () => {
    const manager = new ClipboardManager();
    host.installed = new Set(["xdotool"]);
    flags.sealed = true;
    assert.equal(manager.commandExists("xdotool"), false);
    assert.deepEqual(host.calls, [], "no sh probe while sealed");
    flags.sealed = false;
    assert.equal(manager.commandExists("xdotool"), true, "the sealed answer was not cached");
  });
});

test("unsealed pastes are unchanged: the helper runs and the clipboard is restored", async () => {
  await withPlatform("linux", X11, async () => {
    const manager = linuxManager();
    const result = await manager.pasteText("plain words");
    await result.restoreComplete;
    assert.deepEqual(
      host.calls.filter(([kind]) => kind === "spawn").map(([, command]) => command),
      ["/opt/Loqui/resources/bin/linux-fast-paste"]
    );
    assert.equal(fakeClipboard.text, "previous clipboard", "restored after the paste");
    assert.ok(!rows.some((r) => r.outcome === "blocked"), "nothing refused");
  });
});

// Touch-up 4, N2: sealing kills in-flight children (`children.stopAll`, SIGTERM)
// and refuses new launches. Neither says anything about the portal or the fast
// paste helper, so neither may disable them until restart.
const spawned = (pattern) =>
  host.calls
    .filter(
      ([kind, command, args]) => kind === "spawn" && pattern.test([command, ...args].join(" "))
    )
    .map(([, command, args]) => [command, ...args].join(" "));
// The seal lands while this child runs: the gate flips, then the child dies by
// SIGTERM the way `children.stopAll` ends it.
function sealWhileRunning(pattern) {
  host.onSpawn = (command, args, child) => {
    if (!pattern.test([command, ...args].join(" "))) return false;
    host.onSpawn = () => false;
    setTimeout(() => {
      flags.sealed = true;
      child.emit("exit", null, "SIGTERM");
      child.emit("close", null, "SIGTERM");
    }, 5);
    return true;
  };
}

test("KDE Wayland: a seal that kills the running portal helper leaves the portal enabled, so the next unsealed paste uses it", async (t) => {
  const uncaught = captureUncaught(t);
  await withPlatform("linux", KDE_WAYLAND, async () => {
    const manager = linuxManager();
    sealWhileRunning(/--portal/);
    const outcome = await within(manager.pasteText("kde killed words"));
    assertSealedPasteFailure(outcome);
    assert.equal(spawned(/--portal/).length, 1, "the portal helper had started");
    assert.equal(manager.portalFailed, false, "the kill is not a portal failure");
    assert.equal(manager.portalDenied, false);
    assert.equal(manager.portalUnavailable, false);

    flags.sealed = false;
    host.calls.length = 0;
    const next = await within(manager.pasteText("kde unsealed words", { restoreClipboard: false }));
    assert.equal(next.status, "resolved");
    assert.equal(next.value.method, "portal");
    assert.equal(spawned(/--portal/).length, 1, "the portal ran again after unsealing");
    assert.deepEqual(spawned(/--uinput/), [], "no uinput fallback");
  });
  await delay(100);
  assert.deepEqual(
    uncaught.map((e) => e.message),
    []
  );
});

test("GNOME Wayland with a saved token: a sealed portal refusal does not mark the token as failed, so the next unsealed paste uses the portal", async (t) => {
  const uncaught = captureUncaught(t);
  await withPlatform("linux", GNOME_WAYLAND, async () => {
    const manager = linuxManager();
    manager._savePortalToken("owned-test-token");
    t.after(() => fs.rmSync(manager._getPortalTokenPath(), { force: true }));
    assert.ok(
      manager._getPortalTokenPath().startsWith(cacheRoot),
      "the token stays in the temp root"
    );
    host.onProbe = (tool) => {
      if (tool === "ydotool") flags.sealed = true;
    };
    const outcome = await within(manager.pasteText("gnome sealed words"));
    assertSealedPasteFailure(outcome);
    assert.deepEqual(launches(), [], "the portal helper was refused before the leaf");
    assert.ok(rows.some((r) => r.task === "nativeLaunch" && r.outcome === "blocked"));
    assert.equal(manager.portalTokenPasteFailed, false, "a sealed refusal is not a token failure");
    assert.equal(manager.portalFailed, false);

    flags.sealed = false;
    host.onProbe = () => {};
    host.calls.length = 0;
    const next = await within(
      manager.pasteText("gnome unsealed words", { restoreClipboard: false })
    );
    assert.equal(next.status, "resolved");
    assert.equal(next.value.method, "portal");
    const helperRuns = spawned(/linux-fast-paste/);
    assert.equal(helperRuns.length, 1, "one helper run, with no uinput fallback");
    assert.match(helperRuns[0], / --portal /);
    assert.match(helperRuns[0], / --restore-token owned-test-token$/, "the saved token was used");
  });
  await delay(100);
  assert.deepEqual(
    uncaught.map((e) => e.message),
    []
  );
});

test("GNOME Wayland with a saved token: an unsealed portal failure still marks the token as failed", async () => {
  await withPlatform("linux", GNOME_WAYLAND, async () => {
    const manager = linuxManager();
    manager._savePortalToken("owned-test-token");
    try {
      host.onSpawn = (command, args, child) => {
        if (!args.includes("--portal")) return false;
        setTimeout(() => child.emit("close", 1, null), 5);
        return true;
      };
      const result = await within(
        manager.pasteText("gnome plain words", { restoreClipboard: false })
      );
      assert.equal(result.status, "resolved");
      assert.equal(result.value.method, "uinput");
      assert.equal(manager.portalTokenPasteFailed, true);
      assert.equal(manager.portalFailed, true);
    } finally {
      fs.rmSync(manager._getPortalTokenPath(), { force: true });
    }
  });
});

test("macOS: a seal that kills the running fast-paste helper keeps it, so the next unsealed paste uses it again", async (t) => {
  const uncaught = captureUncaught(t);
  const fastPaste = "/Applications/Loqui.app/Contents/Resources/macos-fast-paste";
  await withPlatform("darwin", {}, async () => {
    const manager = new ClipboardManager();
    manager.fastPasteChecked = true;
    manager.fastPastePath = fastPaste;
    sealWhileRunning(/macos-fast-paste/);
    const outcome = await within(manager.pasteMacOS(null, {}), 2000);
    assert.equal(outcome.status, "rejected", `settled (${outcome.status})`);
    assert.equal(outcome.error.code, "SEALED_MODE", outcome.error.message);
    assert.deepEqual(spawned(/osascript/), [], "the osascript fallback was refused");
    assert.equal(manager.fastPastePath, fastPaste, "the kill does not drop the fast-paste helper");

    flags.sealed = false;
    host.calls.length = 0;
    const next = await within(manager.pasteMacOS(null, {}), 2000);
    assert.equal(next.status, "resolved");
    assert.deepEqual(spawned(/./), [fastPaste], "fast paste ran again after unsealing");
  });
  await delay(100);
  assert.deepEqual(
    uncaught.map((e) => e.message),
    []
  );
});

test("macOS: an unsealed fast-paste failure still falls back to osascript for the session", async () => {
  await withPlatform("darwin", {}, async () => {
    const manager = new ClipboardManager();
    manager.fastPasteChecked = true;
    manager.fastPastePath = "/x/macos-fast-paste";
    host.onSpawn = (command, args, child) => {
      if (!/macos-fast-paste/.test(command)) return false;
      setTimeout(() => child.emit("close", 1, null), 5);
      return true;
    };
    const outcome = await within(manager.pasteMacOS(null, {}), 2000);
    assert.equal(outcome.status, "resolved");
    assert.deepEqual(
      host.calls.filter(([kind]) => kind === "spawn").map(([, command]) => command),
      ["/x/macos-fast-paste", "osascript"]
    );
    assert.equal(manager.fastPastePath, null);
  });
});
