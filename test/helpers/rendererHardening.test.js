const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const repoRoot = path.join(__dirname, "../..");

test("every exported window config is sandboxed with web security enabled", () => {
  const configs = require("../../src/helpers/windowConfig");
  const all = Object.entries(configs).filter(([, value]) => value?.webPreferences);
  assert.ok(all.length >= 3, "found all shared window configs");
  for (const [name, config] of all) {
    assert.equal(config.webPreferences.sandbox, true, `${name}.sandbox`);
    assert.notEqual(config.webPreferences.webSecurity, false, `${name}.webSecurity`);
    assert.equal(config.webPreferences.nodeIntegration, false, `${name}.nodeIntegration`);
    assert.equal(config.webPreferences.contextIsolation, true, `${name}.contextIsolation`);
    assert.equal(
      config.webPreferences.nodeIntegrationInSubFrames,
      true,
      `${name}.nodeIntegrationInSubFrames`
    );
    assert.match(String(config.webPreferences.preload), /preload\.js$/, `${name}.preload`);
  }

  const windowManager = fs.readFileSync(
    path.join(repoRoot, "src/helpers/windowManager.js"),
    "utf8"
  );
  assert.equal((windowManager.match(/new BrowserWindow\(/g) || []).length, 4);
  assert.match(windowManager, /new BrowserWindow\(\{\s*\.\.\.MAIN_WINDOW_CONFIG/);
  assert.match(windowManager, /new BrowserWindow\(CONTROL_PANEL_CONFIG\)/);
  assert.equal((windowManager.match(/\.\.\.NOTIFICATION_WINDOW_CONFIG/g) || []).length, 2);
});

// Task 18 T18-02: windows without text input never run the spellchecker, so
// its dictionary download cannot start from them. The main window keeps it
// for the Assistant's composer; the session turns it off while sealed.
test("notification and control-panel windows run no spellchecker", () => {
  const {
    NOTIFICATION_WINDOW_CONFIG,
    CONTROL_PANEL_CONFIG,
  } = require("../../src/helpers/windowConfig");
  assert.equal(NOTIFICATION_WINDOW_CONFIG.webPreferences.spellcheck, false);
  assert.equal(CONTROL_PANEL_CONFIG.webPreferences.spellcheck, false);
});

test("renderer documents disable DNS prefetch, frames, and objects", () => {
  const html = fs.readFileSync(path.join(repoRoot, "src/index.html"), "utf8");
  assert.match(html, /<meta http-equiv="x-dns-prefetch-control" content="off"\s*\/>/);
  assert.match(
    html,
    /<meta http-equiv="Content-Security-Policy" content="frame-src 'none'; object-src 'none'"\s*\/>/
  );
});

test("the actual preload removes WebRTC in the main frame and a subframe", () => {
  const preload = fs.readFileSync(path.join(repoRoot, "preload.js"), "utf8");
  const loadFrame = (isMainFrame) => {
    const seen = { mainWorld: null, exposed: [] };
    const electron = {
      contextBridge: {
        executeInMainWorld: ({ func }) => {
          seen.mainWorld = func;
          vm.runInContext(`(${func.toString()})()`, seen.page);
        },
        exposeInMainWorld: (name) => seen.exposed.push(name),
      },
      ipcRenderer: {
        invoke: async () => {},
        on() {},
        removeListener() {},
        send() {},
        sendSync() {},
      },
      webUtils: {},
    };
    seen.page = vm.createContext({
      RTCPeerConnection() {},
      webkitRTCPeerConnection() {},
      RTCDataChannel() {},
      RTCRtpSender() {},
      RTCRtpReceiver() {},
      RTCIceCandidate() {},
      RTCSessionDescription() {},
    });
    vm.runInNewContext(preload, {
      require: (specifier) => (specifier === "electron" ? electron : require(specifier)),
      process: { ...process, isMainFrame },
    });
    return seen;
  };

  for (const isMainFrame of [false, true]) {
    const frame = loadFrame(isMainFrame);
    assert.equal(typeof frame.mainWorld, "function", "the frame runs actual WebRTC removal");
    for (const name of [
      "RTCPeerConnection",
      "webkitRTCPeerConnection",
      "RTCDataChannel",
      "RTCRtpSender",
      "RTCRtpReceiver",
      "RTCIceCandidate",
      "RTCSessionDescription",
    ]) {
      assert.equal(vm.runInContext(`typeof ${name}`, frame.page), "undefined", name);
      vm.runInContext(`globalThis.${name} = function () {}`, frame.page);
      assert.equal(
        vm.runInContext(`typeof ${name}`, frame.page),
        "undefined",
        `${name} cannot be restored`
      );
      // T7a-M3: the slot is locked, so no later page script can redefine it either.
      const descriptor = vm.runInContext(
        `(() => { const d = Object.getOwnPropertyDescriptor(globalThis, "${name}");
          return d && [d.configurable, d.writable, "value" in d, d.value === undefined].join(); })()`,
        frame.page
      );
      assert.equal(descriptor, "false,false,true,true", `${name} is non-configurable`);
      assert.throws(
        () =>
          vm.runInContext(
            `Object.defineProperty(globalThis, "${name}", { value: function () {} })`,
            frame.page
          ),
        { name: "TypeError" }, // thrown in the page realm
        `${name} cannot be redefined`
      );
    }
    assert.deepEqual(frame.exposed, isMainFrame ? ["electronAPI"] : []);
  }
});
