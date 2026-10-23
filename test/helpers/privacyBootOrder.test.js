const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const gate = require("../../src/helpers/privacy/egressGate");
const registry = require("../../src/helpers/privacy/childRegistry");
const boot = require("../../src/helpers/privacy/privacyBoot");
const main = fs.readFileSync(path.join(__dirname, "../../main.js"), "utf8");

test("actual early main reads selected channel/profile before guarded XWayland admission", async (t) => {
  gate._resetForTests();
  registry._resetForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-boot-"));
  fs.writeFileSync(
    path.join(dir, "privacy.json"),
    JSON.stringify({ sealed: true, sealedSince: 10 })
  );
  t.after(() => {
    gate._resetForTests();
    registry._resetForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let selected;
  let attempts = 0;
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false,
    setName() {},
    setPath: (_, p) => {
      selected = p;
    },
    getPath: (name) => (name === "userData" ? selected : dir),
    whenReady: () => Promise.resolve(),
  });
  const fakeCP = {
    spawn() {
      attempts++;
      throw Error("native leaf reached");
    },
  };
  registry.installSpawnGuard({ childProcess: fakeCP });
  const webRequest = new Proxy({}, { get: () => () => {} });
  const context = {
    __dirname: path.join(__dirname, "../.."),
    process: {
      argv: ["electron", "app"],
      execPath: "/electron",
      env: { NODE_ENV: "development", LOQUI_PROFILE_DIR: dir },
      exit() {
        throw Error("must not exit sealed");
      },
    },
    require: (name) => {
      if (name === "electron") return { app, session: { defaultSession: { webRequest } } };
      if (name === "child_process" || name === "node:child_process") return fakeCP;
      if (name === "./src/helpers/xwayland")
        return { XWAYLAND_FLAG: "--ozone-platform=x11", shouldForceXWayland: () => true };
      if (name === "dotenv") return { config() {} };
      if (name.startsWith("./")) return require(path.join(__dirname, "../..", name));
      return require(name);
    },
  };
  vm.runInNewContext(main.slice(0, main.indexOf("// Chromium's Windows-only")), context);
  await new Promise((r) => setImmediate(r));
  assert.equal(selected, dir);
  assert.equal(gate.isSealed(), true);
  assert.equal(attempts, 0);
  assert.ok(
    main.indexOf("bootEgressGuards(") < main.indexOf('require("./src/helpers/environment")')
  );
});

test("boot installs utility guard before ready and reports watcher failure without rejection", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-boot-"));
  fs.writeFileSync(path.join(dir, "privacy.json"), '{"sealed":true}');
  t.after(() => {
    gate._resetForTests();
    registry._resetForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const utilityProcess = {
    fork() {
      throw Error("leaf reached");
    },
  };
  const app = Object.assign(new EventEmitter(), { whenReady: () => Promise.resolve() });
  const privacy = boot.bootEgressGuards({
    app,
    profile: dir,
    utilityProcess,
    getDefaultSession: () => {
      throw Error("private exception");
    },
  });
  assert.throws(() => utilityProcess.fork("worker"), { code: "SEALED_MODE" });
  await new Promise((r) => setImmediate(r));
  assert.ok(privacy.bootFailures.includes("sessionWatchUnavailable"));
  assert.equal(privacy.nativeBoundary.available, false);
});

function inert() {
  return new Proxy(function () {}, {
    get: (_, key) =>
      key === "then" ? undefined : key === Symbol.iterator ? function* () {} : inert(),
    apply: () => inert(),
    construct: () => inert(),
  });
}

test("actual startApp consumes A23 return and registry diagnostics before first manager constructor", async (t) => {
  gate._resetForTests();
  registry._resetForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-startup-"));
  fs.writeFileSync(path.join(dir, "privacy.json"), '{"sealed":true}');
  t.after(() => {
    gate._resetForTests();
    registry._resetForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const marker = new Error("STOP_AT_MANAGER_BOUNDARY");
  let selected;
  let inspections = 0;
  let preserves = 0;
  let constructors = 0;
  const app = new Proxy(
    Object.assign(new EventEmitter(), {
      isPackaged: false,
      getPath: (name) => (name === "userData" ? selected : dir),
      setName() {},
      setPath: (_, p) => {
        selected = p;
      },
      requestSingleInstanceLock: () => false,
      whenReady: () => new Promise(() => {}),
      exit() {},
      commandLine: { appendSwitch() {} },
    }),
    { get: (target, key) => (key in target ? target[key] : inert()) }
  );
  // Execute the real reaper with only PID storage/process terminal boundaries mocked.
  const reaperModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../../src/helpers/sidecarReaper"), "utf8"), {
    module: reaperModule,
    process: {
      platform: process.platform,
      kill: (_pid, signal) => {
        assert.equal(signal, 0);
      },
    },
    require: (name) => {
      if (name === "./privacy/egressGate") return gate;
      if (name === "./privacy/childRegistry") return registry;
      if (name === "./debugLogger") return inert();
      if (name === "node:child_process")
        return {
          execFileSync() {
            inspections++;
            throw Error("native inspection forbidden");
          },
        };
      if (name === "./sidecarPidFile")
        return {
          readForReaping: () => ({ entries: [{ name: "whisper", pid: 567 }], unresolved: [] }),
          preserve: () => {
            preserves++;
            return true;
          },
        };
      throw Error(name);
    },
  });
  // Observe actual main consumption, independently of the reaper's own registry insertion.
  const reaper = {
    reapStaleSidecars: async () => {
      const result = await reaperModule.exports.reapStaleSidecars();
      registry._resetForTests();
      return result;
    },
  };
  const context = {
    __dirname: path.join(__dirname, "../.."),
    setTimeout,
    clearTimeout,
    process: {
      env: { NODE_ENV: "development", LOQUI_PROFILE_DIR: dir },
      platform: process.platform,
      argv: ["electron", "."],
      execPath: "/electron",
      on() {},
    },
    require: (name) => {
      if (name === "electron") return { app, ipcMain: { on() {} } };
      if (name === "path") return path;
      if (name === "dotenv") return { config() {} };
      if (name === "tls") return { getCACertificates: () => [] };
      if (name === "node:fs/promises") return {};
      if (name === "./src/config/product.json") return require("../../src/config/product.json");
      if (name === "./src/helpers/xwayland") return { shouldForceXWayland: () => false };
      if (name === "./src/helpers/settingsProfile")
        return { hasExistingSettingsProfile: async () => false };
      if (name === "./src/helpers/sidecarReaper") return reaper;
      if (name === "./src/helpers/privacy/privacyBoot") return boot;
      if (name === "./src/helpers/privacy/childRegistry") return registry;
      if (name === "./src/helpers/environment")
        return class {
          constructor() {
            constructors++;
            assert.equal(inspections, 0);
            assert.equal(preserves, 1);
            const record = registry.diagnostics().unresolved.find((e) => e.kind === "whisper");
            assert.equal(record.pid, 567);
            assert.equal(record.reason, "INSPECTION_REFUSED_SEALED");
            assert.equal(record.rootExited, false);
            assert.throws(() => require("node:child_process").spawn("native-probe"), {
              code: "SEALED_MODE",
            });
            throw marker;
          }
        };
      return inert();
    },
  };
  vm.runInNewContext(
    main + "\nglobalThis.start = startApp; globalThis.bootPrivacy = privacy;",
    context
  );
  await assert.rejects(context.start(), (e) => e === marker);
  assert.equal(constructors, 1);
  assert.ok(
    context.bootPrivacy.bootFailures.includes("child:whisper:567:INSPECTION_REFUSED_SEALED")
  );
});

test("actual early boot keeps channel profiles and packaged override rules", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-profiles-"));
  const product = require("../../src/config/product.json");
  t.after(() => {
    gate._resetForTests();
    registry._resetForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  for (const [channel, packaged, override] of [
    ["production", true, true],
    ["staging", true, false],
    ["development", false, false],
    ["staging", false, true],
  ]) {
    let selected;
    const overridePath = path.join(dir, "override");
    const expected =
      override && !packaged
        ? overridePath
        : path.join(
            dir,
            channel === "production" ? product.profileName : `${product.profileName}-${channel}`
          );
    fs.mkdirSync(expected, { recursive: true });
    fs.writeFileSync(path.join(expected, "privacy.json"), '{"sealed":true}');
    const app = Object.assign(new EventEmitter(), {
      isPackaged: packaged,
      setName() {},
      setPath: (_, p) => {
        selected = p;
      },
      getPath: (name) => (name === "userData" ? selected : dir),
      whenReady: () => new Promise(() => {}),
    });
    vm.runInNewContext(main.slice(0, main.indexOf("// Chromium's Windows-only")), {
      __dirname: path.join(__dirname, "../.."),
      process: {
        argv: ["app"],
        execPath: "/loqui",
        env: { LOQUI_CHANNEL: channel, ...(override ? { LOQUI_PROFILE_DIR: overridePath } : {}) },
      },
      require: (name) => {
        if (name === "electron") return { app };
        if (name === "dotenv") return { config() {} };
        if (name === "tls") return { getCACertificates: () => [] };
        if (name === "./src/helpers/xwayland") return { shouldForceXWayland: () => false };
        if (name.startsWith("./")) return require(path.join(__dirname, "../..", name));
        return require(name);
      },
    });
    assert.equal(selected, expected);
    assert.equal(gate.isSealed(), true);
  }
});

// Task 8 (A4): main supplies IPCHandlers a live predicate over the same state
// the gate reads, never a default false.
test("actual startApp gives IPCHandlers a live isSealed predicate over boot state", async (t) => {
  gate._resetForTests();
  registry._resetForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-startup-sealed-"));
  t.after(() => {
    gate._resetForTests();
    registry._resetForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const marker = new Error("STOP_AT_IPC_HANDLERS");
  // Managers before IPCHandlers are stand-ins that also survive coercion.
  const soft = () =>
    new Proxy(function () {}, {
      get: (_, key) =>
        key === "then"
          ? undefined
          : key === Symbol.iterator
            ? function* () {}
            : key === Symbol.toPrimitive
              ? () => ""
              : soft(),
      apply: () => soft(),
      construct: () => soft(),
    });
  let selected;
  let managers;
  const app = new Proxy(
    Object.assign(new EventEmitter(), {
      isPackaged: false,
      getPath: (name) => (name === "userData" ? selected : dir),
      setName() {},
      setPath: (_, p) => {
        selected = p;
      },
      requestSingleInstanceLock: () => false,
      whenReady: () => new Promise(() => {}),
      exit() {},
      commandLine: { appendSwitch() {} },
    }),
    { get: (target, key) => (key in target ? target[key] : soft()) }
  );
  const context = {
    __dirname: path.join(__dirname, "../.."),
    setTimeout,
    clearTimeout,
    process: {
      env: { NODE_ENV: "development", LOQUI_PROFILE_DIR: dir },
      platform: "linux",
      argv: ["electron", "."],
      execPath: "/electron",
      on() {},
    },
    require: (name) => {
      if (name === "electron") return { app, ipcMain: { on() {} } };
      if (name === "path") return path;
      if (name === "dotenv") return { config() {} };
      if (name === "tls") return { getCACertificates: () => [] };
      if (name === "node:fs/promises") return {};
      if (name === "./src/config/product.json") return require("../../src/config/product.json");
      if (name === "./src/helpers/xwayland") return { shouldForceXWayland: () => false };
      if (name === "./src/helpers/settingsProfile")
        return { hasExistingSettingsProfile: async () => false };
      if (name === "./src/helpers/sidecarReaper")
        return { reapStaleSidecars: async () => ({ unresolved: [] }) };
      if (name === "./src/helpers/privacy/privacyBoot") return boot;
      if (name === "./src/helpers/privacy/childRegistry") return registry;
      if (name === "./src/helpers/ipcHandlers")
        return class {
          constructor(received) {
            managers = received;
            throw marker;
          }
        };
      return soft();
    },
  };
  vm.runInNewContext(
    main + "\nglobalThis.start = startApp; globalThis.bootPrivacy = privacy;",
    context
  );
  await assert.rejects(context.start(), (e) => e === marker);
  assert.equal(typeof managers.isSealed, "function");
  assert.equal(managers.isSealed(), false);
  context.bootPrivacy.state.set(true);
  assert.equal(managers.isSealed(), true, "the predicate reads live state");
  assert.equal(gate.isSealed(), true, "the gate reads the same state");
});

test("actual startApp hands attachUpdateIPC main's live seal state (Task 10)", async (t) => {
  gate._resetForTests();
  registry._resetForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-startup-updates-"));
  t.after(() => {
    gate._resetForTests();
    registry._resetForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const marker = new Error("STOP_AT_UPDATE_IPC");
  const soft = () =>
    new Proxy(function () {}, {
      get: (_, key) =>
        key === "then"
          ? undefined
          : key === Symbol.iterator
            ? function* () {}
            : key === Symbol.toPrimitive
              ? () => ""
              : soft(),
      apply: () => soft(),
      construct: () => soft(),
    });
  let selected;
  let options;
  const app = new Proxy(
    Object.assign(new EventEmitter(), {
      isPackaged: false,
      getPath: (name) => (name === "userData" ? selected : dir),
      setName() {},
      setPath: (_, p) => {
        selected = p;
      },
      requestSingleInstanceLock: () => false,
      whenReady: () => new Promise(() => {}),
      exit() {},
      commandLine: { appendSwitch() {} },
    }),
    { get: (target, key) => (key in target ? target[key] : soft()) }
  );
  const context = {
    __dirname: path.join(__dirname, "../.."),
    setTimeout,
    clearTimeout,
    setInterval: () => soft(),
    clearInterval() {},
    process: {
      env: { NODE_ENV: "development", LOQUI_PROFILE_DIR: dir },
      platform: "linux",
      argv: ["electron", "."],
      execPath: "/electron",
      on() {},
    },
    require: (name) => {
      if (name === "electron") return { app, ipcMain: soft() };
      if (name === "path") return path;
      if (name === "dotenv") return { config() {} };
      if (name === "tls") return { getCACertificates: () => [] };
      if (name === "node:fs/promises") return {};
      if (name === "./src/config/product.json") return require("../../src/config/product.json");
      if (name === "./src/helpers/xwayland") return { shouldForceXWayland: () => false };
      if (name === "./src/helpers/settingsProfile")
        return { hasExistingSettingsProfile: async () => false };
      if (name === "./src/helpers/sidecarReaper")
        return { reapStaleSidecars: async () => ({ unresolved: [] }) };
      if (name === "./src/helpers/privacy/privacyBoot") return boot;
      if (name === "./src/helpers/privacy/childRegistry") return registry;
      if (name === "./src/helpers/updateIPC")
        return {
          trackUpdateActivity: () => soft(),
          attachUpdateIPC: (received) => {
            options = received;
            throw marker;
          },
        };
      return soft();
    },
  };
  vm.runInNewContext(
    main + "\nglobalThis.start = startApp; globalThis.bootPrivacy = privacy;",
    context
  );
  await assert.rejects(context.start(), (e) => e === marker);
  assert.equal(typeof options.sealed, "function", "the manager is not left on a default");
  assert.equal(options.sealed(), false);
  context.bootPrivacy.state.set(true);
  assert.equal(options.sealed(), true, "the predicate reads main's live state");
  assert.equal(gate.isSealed(), true, "the gate reads the same state");
});

test("actual main installs the sealed handoff guard before startup and wires Task 11 seams", async (t) => {
  gate._resetForTests();
  registry._resetForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-startup-links-"));
  t.after(() => {
    gate._resetForTests();
    registry._resetForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const marker = new Error("STOP_AT_SEAL_TRANSITION");
  const soft = () =>
    new Proxy(function () {}, {
      get: (_, key) =>
        key === "then"
          ? undefined
          : key === Symbol.iterator
            ? function* () {}
            : key === Symbol.toPrimitive
              ? () => ""
              : soft(),
      apply: () => soft(),
      construct: () => soft(),
    });
  let selected;
  const guards = [];
  const viaHelper = [];
  const shown = [];
  let calendarOptions;
  let codexOptions;
  let transitionOptions;
  let cancelled = 0;
  const app = new Proxy(
    Object.assign(new EventEmitter(), {
      isPackaged: false,
      getPath: (name) => (name === "userData" ? selected : dir),
      setName() {},
      setPath: (_, p) => {
        selected = p;
      },
      requestSingleInstanceLock: () => false,
      whenReady: () => new Promise(() => {}),
      exit() {},
      commandLine: { appendSwitch() {} },
    }),
    { get: (target, key) => (key in target ? target[key] : soft()) }
  );
  const context = {
    __dirname: path.join(__dirname, "../.."),
    setTimeout,
    clearTimeout,
    setInterval: () => soft(),
    clearInterval() {},
    process: {
      env: { NODE_ENV: "development", LOQUI_PROFILE_DIR: dir },
      platform: "linux",
      argv: ["electron", "."],
      execPath: "/electron",
      on() {},
    },
    require: (name) => {
      if (name === "electron")
        return {
          app,
          ipcMain: soft(),
          dialog: {
            showMessageBox: async (...args) => {
              shown.push(args.at(-1));
              return { response: args.at(-1).defaultId };
            },
          },
          BrowserWindow: { fromWebContents: () => undefined, getAllWindows: () => [] },
          shell: {
            openExternal: () => assert.fail("main must not hand a URL to the OS directly"),
          },
        };
      if (name === "path") return path;
      if (name === "dotenv") return { config() {} };
      if (name === "tls") return { getCACertificates: () => [] };
      if (name === "node:fs/promises") return {};
      if (name === "./src/config/product.json") return require("../../src/config/product.json");
      if (name === "./src/helpers/xwayland") return { shouldForceXWayland: () => false };
      if (name === "./src/helpers/settingsProfile")
        return { hasExistingSettingsProfile: async () => false };
      if (name === "./src/helpers/sidecarReaper")
        return { reapStaleSidecars: async () => ({ unresolved: [] }) };
      if (name === "./src/helpers/privacy/childRegistry") return registry;
      if (name === "./src/helpers/i18nMain")
        return { i18nMain: { t: (key) => key }, changeLanguage() {} };
      if (name === "./src/helpers/externalUrlOpener")
        return {
          setExternalOpenGuard: (guard) => guards.push(guard),
          openExternalUrl: async (url) => {
            viaHelper.push(url);
            return true;
          },
        };
      if (name === "./src/helpers/privacy/calendarGuard")
        return {
          createCalendarGuard: (options) => {
            calendarOptions = options;
            return {
              start() {},
              onFocus() {},
              onWake() {},
              cancelPending: () => {
                cancelled++;
                return 0;
              },
            };
          },
        };
      if (name === "./src/helpers/personalInference")
        return {
          registerPersonalInferenceIPC: (options) => {
            codexOptions = options;
            return soft();
          },
        };
      if (name === "./src/helpers/privacy/privacyBoot")
        return {
          ...boot,
          createSealTransition: (options) => {
            transitionOptions = options;
            throw marker;
          },
        };
      return soft();
    },
  };
  vm.runInNewContext(
    main + "\nglobalThis.start = startApp; globalThis.bootPrivacy = privacy;",
    context
  );
  // Installed while main loads, before any window or manager exists.
  assert.equal(guards.length, 1);
  assert.equal(await guards[0]("https://example.com/x", { kind: "link" }), true);
  assert.deepEqual(shown, [], "unsealed links open without a dialog");
  context.bootPrivacy.state.set(true);
  assert.equal(await guards[0]("https://example.com/x", { kind: "link" }), false);
  assert.equal(await guards[0]("ms-settings:sound", { kind: "systemSettings" }), false);
  assert.deepEqual(
    shown.map((options) => [options.title, options.defaultId, options.cancelId]),
    [
      ["sealedMode.confirmLink.title", 0, 0],
      ["sealedMode.confirmSettings.title", 0, 0],
    ]
  );
  assert.equal(calendarOptions.isSealed(), true, "the calendar guard reads live state");
  context.bootPrivacy.state.set(false);
  assert.equal(calendarOptions.isSealed(), false);

  await assert.rejects(context.start(), (e) => e === marker);
  // The Codex sign-in page goes through the guarded helper.
  await codexOptions.openExternal("https://auth.openai.com/authorize?x=1");
  assert.deepEqual(viaHelper, ["https://auth.openai.com/authorize?x=1"]);
  // Seal cancels pending calendar sign-ins through the calendar guard.
  assert.equal(typeof transitionOptions.cancelPending, "function");
  transitionOptions.cancelPending();
  assert.equal(cancelled, 1);
  assert.equal(transitionOptions.getCalendars().length, 3, "Apple is not exempt");
});

test("main triggers remote and Apple calendar work only through the calendar guard (ratchet)", () => {
  // Beside the executed calendarSealed tests: main has no direct trigger left.
  for (const method of ["start", "syncOnFocus", "onWakeFromSleep"])
    assert.doesNotMatch(
      main,
      new RegExp(`(?:google|microsoft|apple)CalendarManager\\??\\.${method}\\(`),
      method
    );
  assert.match(main, /calendarGuard\.start\(calendars\(\)\)/);
  assert.match(main, /calendarGuard\.onFocus\(calendars\(\)\)/);
  assert.match(main, /calendarGuard\.onWake\(calendars\(\)\)/);
  assert.doesNotMatch(main, /shell\.openExternal/, "no raw OS handoff in main");
});
