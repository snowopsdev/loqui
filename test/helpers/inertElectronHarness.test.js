const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const { install } = require("./harness/inertElectron");

test("import-only Electron fixture owns paths and stays inert through awaited cleanup", async () => {
  const originalLoad = Module._load;
  const delegated = Symbol("unrelated parent");
  Module._load = function (request, parent, isMain) {
    if (request === "electron") return delegated;
    return originalLoad.call(this, request, parent, isMain);
  };
  const callbacks = [];
  try {
    install({ after: (callback) => callbacks.push(callback) }, ["sidecarPidFile"]);
    const parent = { filename: path.resolve(__dirname, "../../src/helpers/sidecarPidFile.js") };
    const electron = Module._load("electron", parent);
    assert.equal(Module._load("electron", { filename: parent.filename + ".unowned" }), delegated);
    const root = electron.app.getAppPath();
    for (const name of ["home", "userData", "temp"]) {
      const directory = electron.app.getPath(name);
      assert.equal(path.dirname(directory), root);
      assert.equal(fs.statSync(directory).isDirectory(), true);
    }
    assert.throws(() => electron.app.getPath("../unowned"), /unowned app path/);
    await Promise.resolve();
    assert.throws(
      () => Module._load("electron", parent).net.fetch("https://example.invalid"),
      /forbids native\/network/
    );
    assert.equal(callbacks.length, 1);
    await callbacks[0]();
    assert.equal(fs.existsSync(root), false);
    assert.equal(Module._load("electron", parent), delegated);
  } finally {
    Module._load = originalLoad;
  }
});
