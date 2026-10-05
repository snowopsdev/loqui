const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const modulePath = require.resolve("../../src/helpers/clipboard");

function loadClipboardManager() {
  delete require.cache[modulePath];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === "electron") {
      return { clipboard: {}, ClipboardItem: class {}, systemPreferences: {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function withEnv(values, fn) {
  const saved = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

// The RemoteDesktop restore token lets the app paste without re-prompting. An
// isolated run (LOQUI_CACHE_ROOT) must keep its token out of the real cache.
test("the portal paste token is written inside LOQUI_CACHE_ROOT, never the XDG/home cache", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-portal-token-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const isolated = path.join(root, "isolated");
  const xdg = path.join(root, "xdg");
  const ClipboardManager = loadClipboardManager();
  const manager = Object.create(ClipboardManager.prototype);

  withEnv({ LOQUI_CACHE_ROOT: isolated, XDG_CACHE_HOME: xdg }, () => {
    manager._savePortalToken("fixture-token");
    assert.equal(manager._readPortalToken(), "fixture-token");
  });

  assert.equal(fs.readFileSync(path.join(isolated, "portal-paste-token"), "utf8"), "fixture-token");
  assert.equal(fs.existsSync(xdg), false, "the XDG cache must stay untouched");
});

test("without an override the token keeps its XDG_CACHE_HOME / ~/.cache location", () => {
  const ClipboardManager = loadClipboardManager();
  const manager = Object.create(ClipboardManager.prototype);

  withEnv({ LOQUI_CACHE_ROOT: undefined, XDG_CACHE_HOME: "/xdg/cache" }, () => {
    assert.equal(
      manager._getPortalTokenPath(),
      path.join("/xdg/cache", "loqui-snowopsdev", "portal-paste-token")
    );
  });
  withEnv({ LOQUI_CACHE_ROOT: undefined, XDG_CACHE_HOME: undefined }, () => {
    assert.equal(
      manager._getPortalTokenPath(),
      path.join(os.homedir(), ".cache", "loqui-snowopsdev", "portal-paste-token")
    );
  });
});
