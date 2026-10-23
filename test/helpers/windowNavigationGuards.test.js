const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const {
  guardWindowNavigation,
  installPermissionHandlers,
} = require("../../src/helpers/navigationGuard.js");

// Final review I3 / T11-M7 / T7a-M2 / Task 18 K1: every window denies in-app
// child windows and navigation away from the app, and hands http(s) and mailto
// links to main's guarded opener (which asks while sealed). Fakes only: no
// window, browser or mail client exists here.
const APP_URL = "file:///opt/loqui/resources/app.asar/src/dist/index.html";
function fakeContents() {
  const contents = new EventEmitter();
  contents.setWindowOpenHandler = (fn) => {
    contents.openHandler = fn;
  };
  return contents;
}
function guarded() {
  const contents = fakeContents();
  const routed = [];
  guardWindowNavigation(contents, {
    getAppUrl: () => APP_URL,
    openExternal: (u) => routed.push(u),
  });
  return { contents, routed };
}

test("window.open is always denied; only http(s) and mailto are routed to the guarded opener", () => {
  const { contents, routed } = guarded();
  for (const url of [
    "https://example.com/a",
    "http://example.com/",
    "mailto:someone@example.com?body=hi",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "loqui-internal://x",
    "about:blank",
  ])
    assert.deepEqual(contents.openHandler({ url }), { action: "deny" }, url);
  assert.deepEqual(routed, [
    "https://example.com/a",
    "http://example.com/",
    "mailto:someone@example.com?body=hi",
  ]);
});

test("navigation away from the app is prevented and routed; the app's own reload stays", () => {
  const contents = fakeContents();
  const routed = [];
  guardWindowNavigation(contents, {
    getAppUrl: () => APP_URL,
    openExternal: (u) => routed.push(u),
    allowDevtools: true,
  });
  const navigate = (url) => {
    let prevented = false;
    contents.emit("will-navigate", { preventDefault: () => (prevented = true) }, url);
    return prevented;
  };
  assert.equal(navigate(`${APP_URL}?panel=true`), false);
  assert.equal(navigate("devtools://devtools/bundled/inspector.html"), false);
  assert.equal(navigate("https://example.com/"), true);
  assert.equal(navigate("mailto:a@example.com"), true);
  assert.equal(navigate("file:///etc/passwd"), true);
  assert.deepEqual(routed, ["https://example.com/", "mailto:a@example.com"]);
});

// Task 18 re-review T18R-06: a packaged build allows no devtools:// navigation,
// and a file: URL must name no host (or localhost) to count as the app.
test("packaged windows refuse devtools:// and file: URLs that name a host", () => {
  const { contents, routed } = guarded();
  const navigate = (url) => {
    let prevented = false;
    contents.emit("will-navigate", { preventDefault: () => (prevented = true) }, url);
    return prevented;
  };
  assert.equal(navigate("devtools://devtools/bundled/inspector.html?ws=evil.example:9222"), true);
  assert.equal(navigate(APP_URL.replace("file:///", "file://evil.example/")), true);
  assert.equal(navigate(APP_URL.replace("file:///", "file://localhost/")), false);
  assert.equal(navigate(`${APP_URL}?panel=true`), false);
  assert.deepEqual(routed, []);
});

test("a child window that slips through is closed and its URL routed, never shown", () => {
  const { contents, routed } = guarded();
  let closed = 0;
  contents.emit("did-create-window", { close: () => closed++ }, { url: "https://example.com/x" });
  contents.emit("did-create-window", { close: () => closed++ }, { url: "devtools://x" });
  assert.equal(closed, 2);
  assert.deepEqual(routed, ["https://example.com/x"]);
});

test("the OS external-protocol permission is denied and its URL routed through the guard", () => {
  let handler;
  const routed = [];
  installPermissionHandlers(
    { setPermissionRequestHandler: (fn) => (handler = fn), setPermissionCheckHandler() {} },
    (url) => routed.push(url)
  );
  const answer = (permission, details) => {
    let granted;
    handler({}, permission, (value) => (granted = value), details);
    return granted;
  };
  assert.equal(answer("openExternal", { externalURL: "mailto:a@example.com?body=x" }), false);
  assert.equal(answer("openExternal", { externalURL: "zoommtg://join?x=1" }), false);
  assert.equal(answer("openExternal", {}), false);
  assert.deepEqual(routed, ["mailto:a@example.com?body=x"]);
  assert.equal(answer("media", { mediaTypes: ["audio"] }), true);
});

// Task 18 re-review T18R-04: geolocation is always denied (Chromium's network
// location provider fetches outside session.webRequest), and any permission
// Loqui does not use is denied by default. The check handler answers the same.
test("only the permissions Loqui uses are granted; geolocation and unknown ones never", () => {
  let request;
  let check;
  installPermissionHandlers(
    {
      setPermissionRequestHandler: (fn) => (request = fn),
      setPermissionCheckHandler: (fn) => (check = fn),
    },
    () => {}
  );
  const asked = (permission) => {
    let granted;
    request({}, permission, (value) => (granted = value), {});
    return granted;
  };
  const used = ["media", "display-capture", "clipboard-read", "clipboard-sanitized-write"];
  const refused = [
    "geolocation",
    "notifications",
    "midi",
    "midiSysex",
    "hid",
    "serial",
    "usb",
    "idle-detection",
    "window-management",
    "storage-access",
    "top-level-storage-access",
    "mediaKeySystem",
    "pointerLock",
    "keyboardLock",
    "fullscreen",
    "speaker-selection",
    "unknown",
    "a-future-permission",
  ];
  for (const permission of used) {
    assert.equal(asked(permission), true, permission);
    assert.equal(check({}, permission, "file://", {}), true, `check ${permission}`);
  }
  for (const permission of refused) {
    assert.equal(asked(permission), false, permission);
    assert.equal(check({}, permission, "file://", {}), false, `check ${permission}`);
  }
  assert.equal(check({}, "openExternal", "file://", {}), false);
});

// Ratchet beside the executed tests above: every BrowserWindow windowManager
// creates installs the guard (the control panel keeps its own equivalent).
test("every BrowserWindow in windowManager is guarded", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../src/helpers/windowManager.js"),
    "utf8"
  );
  const sites = [...source.matchAll(/new BrowserWindow\(/g)].map((m) => m.index);
  assert.equal(sites.length, 4);
  for (const index of sites) {
    const following = source.slice(index, index + 1200);
    assert.match(
      following,
      /_guardWindowNavigation\(|setWindowOpenHandler\(/,
      `unguarded BrowserWindow at offset ${index}`
    );
  }
  // T18R-06: devtools:// is allowed only in an unpackaged build, in every window.
  assert.equal(
    (source.match(/allowDevtools: !app\.isPackaged/g) || []).length,
    2,
    "the shared guard and the control panel"
  );
  const main = fs.readFileSync(path.join(__dirname, "../../main.js"), "utf8");
  assert.match(main, /installPermissionHandlers\(\s*session\.defaultSession/);
});
