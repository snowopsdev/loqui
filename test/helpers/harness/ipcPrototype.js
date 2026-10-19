const Module = require("node:module");
const handlersPath = require.resolve("../../../src/helpers/ipcHandlers");
function unrelated() {
  return new Proxy(function () {}, {
    get: (_target, key) => (key === "then" ? undefined : unrelated()),
    apply: () => unrelated(),
  });
}
function loadIpcPrototype(t) {
  const originalLoad = Module._load;
  const diagnostics = [];
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === handlersPath) {
      if (request === "./analytics") return originalLoad.call(this, request, parent, isMain);
      if (request === "./debugLogger")
        return { info() {}, error: (...args) => diagnostics.push(args) };
      // A prototype-only unit never registers main handlers or owns the
      // unrelated installer, sweep, provider, credentials or native leaves.
      if (request === "electron" || request.startsWith(".")) return unrelated();
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = originalLoad;
    delete require.cache[handlersPath];
  });
  delete require.cache[handlersPath];
  return { IPCHandlers: require(handlersPath), diagnostics };
}
module.exports = { loadIpcPrototype };
