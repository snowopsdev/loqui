const Module = require("node:module");
const path = require("node:path");
const { deferred } = require("./deferred");

const ENV_MODULE = require.resolve("../../../src/helpers/environment.js");
// A path that is never created: every filesystem call goes to the fake below.
const USER_DATA = path.join(path.sep, "loqui-test-profile-never-on-disk");
const SECURE_KEYS = path.join(USER_DATA, "secure-keys");

// An in-memory fs/promises whose operations a test can hold (one at a time)
// and then release or fail, to stop the real persistence code mid-write.
function createDeferredFs() {
  const files = new Map();
  const log = [];
  const holds = [];
  let holdNext = null;
  const enoent = (file) => Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
  async function gate(op, file) {
    const name = path.basename(file);
    log.push(`${op} ${name}`);
    if (holdNext && holdNext(op, name)) {
      holdNext = null;
      const gateway = deferred();
      let rejectGate;
      const failed = new Promise((_resolve, reject) => (rejectGate = reject));
      holds.push({
        op,
        name,
        release: () => gateway.resolve(),
        fail: (error) => rejectGate(error),
      });
      await Promise.race([gateway.promise, failed]);
    }
  }
  return {
    files,
    log,
    holdNext(predicate) {
      holdNext = predicate;
    },
    async nextHold() {
      const deadline = Date.now() + 2000;
      while (holds.length === 0) {
        if (Date.now() > deadline)
          throw new Error("Expected fixture filesystem hold was not reached");
        await new Promise((resolve) => setImmediate(resolve));
      }
      return holds.shift();
    },
    promises: {
      mkdir: async (dir) => gate("mkdir", dir),
      writeFile: async (file, data) => {
        await gate("writeFile", file);
        files.set(file, Buffer.from(data));
      },
      rename: async (from, to) => {
        await gate("rename", to);
        if (!files.has(from)) throw enoent(from);
        files.set(to, files.get(from));
        files.delete(from);
      },
      unlink: async (file) => {
        await gate("unlink", file);
        if (!files.delete(file)) throw enoent(file);
      },
      rm: async (target) => {
        await gate("rm", target);
        for (const file of [...files.keys()]) {
          if (file === target || file.startsWith(target + path.sep)) files.delete(file);
        }
      },
      readFile: async (file, encoding) => {
        if (!files.has(file)) throw enoent(file);
        return encoding ? files.get(file).toString(encoding) : files.get(file);
      },
    },
  };
}

function loadEnvironmentManager(fakeFs, { encryptionAvailable = true } = {}) {
  const ciphertext = new Map();
  let serial = 0;
  const parse = require("dotenv").parse;
  const originalLoad = Module._load;
  Module._load = function loadForEnvironment(request, parent, isMain) {
    if (parent?.filename === ENV_MODULE) {
      if (request === "fs/promises") return fakeFs.promises;
      if (request === "fs") return { existsSync: (file) => fakeFs.files.has(file) };
      if (request === "electron") return { app: { getPath: () => USER_DATA } };
      if (request === "dotenv") {
        return {
          parse,
          config: ({ path: envPath }) => {
            fakeFs.dotenvLoads.push(envPath);
            const bytes = fakeFs.files.get(envPath);
            if (!bytes) return {};
            for (const line of bytes.toString("utf8").split("\n")) {
              const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
              if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
            }
            return {};
          },
        };
      }
      // Encryption "available", and ciphertext that never contains the value.
      if (request === "./secretCrypto") {
        return {
          isAvailable: () => encryptionAvailable,
          encrypt: (value) => {
            const token = `sealed:${++serial}`;
            ciphertext.set(token, value);
            return Buffer.from(token);
          },
          decrypt: (bytes) => {
            const value = ciphertext.get(bytes.toString());
            if (value === undefined) throw new Error("Unreadable fixture");
            return { value };
          },
        };
      }
      if (request === "./debugLogger") return new Proxy({}, { get: () => () => {} });
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[ENV_MODULE];
    const Manager = require(ENV_MODULE);
    Manager.prototype._fixtureEncrypt = (value) => {
      const token = `sealed:${++serial}`;
      ciphertext.set(token, value);
      return Buffer.from(token);
    };
    return Manager;
  } finally {
    Module._load = originalLoad;
    delete require.cache[ENV_MODULE];
  }
}

// The real EnvironmentManager prototype (persistSecret, _saveSecretKey,
// _deleteSecretKey, clearAllPersistedData and every getter) over the deferred
// fs. The constructor is skipped: it only loads dotenv files from disk.
function realCredentialEnv(t, initial = {}, options = {}) {
  const savedEnv = { ...process.env };
  t.after(() => {
    for (const name of Object.keys(process.env)) if (!(name in savedEnv)) delete process.env[name];
    Object.assign(process.env, savedEnv);
  });
  const fs = createDeferredFs();
  fs.dotenvLoads = [];
  const EnvironmentManager = loadEnvironmentManager(fs, options);
  const env = Object.create(EnvironmentManager.prototype);
  if (options.encryptionAvailable !== false && options.migrationComplete !== false)
    fs.files.set(path.join(SECURE_KEYS, ".migrated"), Buffer.from(""));
  const secretFile = (name) => path.join(SECURE_KEYS, `${name}.enc`);
  for (const [name, value] of Object.entries(initial)) {
    process.env[name] = value;
    fs.files.set(
      secretFile(name),
      env._encryptionAvailable() ? env._fixtureEncrypt(value) : Buffer.from("fixture")
    );
  }
  return {
    env,
    fs,
    dotenvLoads: fs.dotenvLoads,
    stored: (name) => fs.files.has(secretFile(name)),
    erase: () => env.clearAllPersistedData(),
  };
}

module.exports = { realCredentialEnv };
