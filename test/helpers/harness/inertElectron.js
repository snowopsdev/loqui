const Module = require("node:module");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Import-only Electron leaves for modules whose real logic is exercised under
// Node. Callers name exact source parents; there is no global Electron fallback.
function install(test, parentNames) {
  const parents = new Set(
    parentNames.map((name) => path.resolve(__dirname, `../../../src/helpers/${name}.js`))
  );
  const originalLoad = Module._load;
  let ownedDirectory;
  const ownedRoot = () => {
    ownedDirectory ??= fs.mkdtempSync(path.join(os.tmpdir(), "loqui-inert-electron-"));
    return ownedDirectory;
  };
  const forbidden = () => {
    throw new Error("Inert Electron fixture forbids native/network actions");
  };
  const electron = {
    app: {
      isReady: () => false,
      isPackaged: false,
      getAppPath: ownedRoot,
      getVersion: () => "0.0.0-fixture",
      getLocale: () => "en",
      getPath: (name) => {
        if (typeof name !== "string" || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) {
          throw new Error("Inert Electron fixture forbids unowned app path");
        }
        const directory = path.join(ownedRoot(), name);
        fs.mkdirSync(directory, { recursive: true });
        return directory;
      },
    },
    net: { fetch: forbidden, request: forbidden },
    globalShortcut: { register: forbidden, unregister: forbidden },
    BrowserWindow: { getAllWindows: () => [] },
  };
  Module._load = function (request, parent, isMain) {
    if (request === "electron" && parents.has(parent?.filename)) return electron;
    return originalLoad.call(this, request, parent, isMain);
  };
  test.after(() => {
    Module._load = originalLoad;
    if (ownedDirectory) fs.rmSync(ownedDirectory, { recursive: true, force: true });
  });
}
module.exports = { install };
