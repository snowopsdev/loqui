const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const fixtureMasterKey = Buffer.alloc(32, 7);
const service = require("../../src/config/product.json").credentialService;

function encryptExisting(plaintext) {
  const iv = Buffer.alloc(12, 3);
  const cipher = crypto.createCipheriv("aes-256-gcm", fixtureMasterKey, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

// Every native store and filesystem operation is intercepted. This fixture must
// never query the machine's keychain, Safe Storage backend, or profile directory.
function setup({
  stored = fixtureMasterKey.toString("base64"),
  readError,
  writeError,
  constructorError,
  backup,
  safeStorageAvailable = false,
  isPackaged = true,
} = {}) {
  const entries = [];
  const keyWrites = [];
  const fileWrites = [];
  const files = new Map();
  const backupPath = path.join("/fixture/profile", "secure-keys", "master-key-backup.enc");
  const encodeSafeStorage = (value) => Buffer.from(`safe-storage-fixture:${value}`);
  if (backup !== undefined) files.set(backupPath, encodeSafeStorage(backup));
  class Entry {
    constructor(...args) {
      entries.push(args);
      if (constructorError) throw constructorError;
    }
    getPassword() {
      if (readError) throw readError;
      return stored;
    }
    setPassword(value) {
      keyWrites.push(value);
      if (writeError) throw writeError;
      stored = value;
    }
  }
  const mocks = {
    crypto,
    path,
    fs: {
      mkdirSync() {},
      readFileSync: (name) => {
        if (!files.has(name)) throw Object.assign(new Error("fixture absent"), { code: "ENOENT" });
        return files.get(name);
      },
      writeFileSync: (name, data, options) => {
        fileWrites.push({ name, options });
        files.set(name, Buffer.from(data));
      },
      renameSync: (from, to) => {
        files.set(to, files.get(from));
        files.delete(from);
      },
    },
    electron: {
      app: { isPackaged, getPath: () => "/fixture/profile" },
      safeStorage: {
        isEncryptionAvailable: () => safeStorageAvailable,
        encryptString: encodeSafeStorage,
        decryptString: (value) => {
          const text = value.toString();
          if (!text.startsWith("safe-storage-fixture:")) throw new Error("not a Safe Storage blob");
          return text.slice("safe-storage-fixture:".length);
        },
      },
    },
    "@napi-rs/keyring": { Entry },
    "./debugLogger": { warn() {}, info() {} },
    "../config/product.json": { credentialService: service },
  };
  const filename = path.resolve(__dirname, "../../src/helpers/secretCrypto.js");
  const context = {
    Buffer,
    process: { platform: "linux" },
    module: { exports: {} },
    require: (name) => {
      assert.ok(Object.hasOwn(mocks, name), `unexpected module: ${name}`);
      return mocks[name];
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return {
    secretCrypto: context.module.exports,
    entries,
    keyWrites,
    fileWrites,
    files,
    backupPath,
  };
}

for (const isPackaged of [true, false]) {
  test(`existing ${isPackaged ? "production" : "development"} credentials retain their identity and AES key`, () => {
    const { secretCrypto, entries, keyWrites, fileWrites } = setup({ isPackaged });
    const result = secretCrypto.decrypt(encryptExisting("saved-provider-key"));
    assert.equal(result.value, "saved-provider-key");
    assert.equal(result.needsReencrypt, false);
    assert.deepEqual(entries, [
      [service + (isPackaged ? "" : "-development"), "secrets-master-key"],
    ]);
    assert.equal(keyWrites.length, 0);
    assert.equal(fileWrites.length, 0);
  });
}

test("a failed keychain read recovers its backup without replacing the master key", () => {
  const { secretCrypto, keyWrites, fileWrites, files, backupPath } = setup({
    readError: new Error("fixture keychain locked"),
    backup: fixtureMasterKey.toString("base64"),
    safeStorageAvailable: true,
  });
  const previousBackup = Buffer.from(files.get(backupPath));
  assert.equal(
    secretCrypto.decrypt(encryptExisting("saved-provider-key")).value,
    "saved-provider-key"
  );
  assert.equal(keyWrites.length, 0);
  assert.equal(fileWrites.length, 0);
  assert.deepEqual(files.get(backupPath), previousBackup);
});

test("a failed keychain read without a recovery backend never creates or overwrites a key", () => {
  const { secretCrypto, keyWrites, fileWrites } = setup({ readError: new Error("access denied") });
  assert.equal(secretCrypto.isAvailable(), false);
  assert.throws(() => secretCrypto.encrypt("new-value"), /no encryption backend/);
  assert.equal(keyWrites.length, 0);
  assert.equal(fileWrites.length, 0);
});

test("a fresh profile creates one master key and an encrypted backup", () => {
  const { secretCrypto, keyWrites, fileWrites } = setup({
    stored: null,
    safeStorageAvailable: true,
  });
  const first = secretCrypto.encrypt("first-value");
  secretCrypto.encrypt("second-value");
  assert.equal(secretCrypto.decrypt(first).value, "first-value");
  assert.equal(keyWrites.length, 1);
  assert.equal(Buffer.from(keyWrites[0], "base64").length, 32);
  assert.equal(fileWrites.length, 1);
  assert.equal(fileWrites[0].options.mode, 0o600);
});

for (const stored of ["", "invalid-key"]) {
  test(`an invalid stored master key (${stored ? "malformed" : "empty"}) is never overwritten`, () => {
    const { secretCrypto, keyWrites } = setup({ stored });
    assert.equal(secretCrypto.isAvailable(), false);
    assert.equal(keyWrites.length, 0);
  });
}

test("an unavailable native store retains the existing Safe Storage fallback", () => {
  const { secretCrypto, keyWrites } = setup({
    constructorError: new Error("fixture store unavailable"),
    safeStorageAvailable: true,
  });
  const blob = secretCrypto.encrypt("fallback-key");
  assert.equal(secretCrypto.decrypt(blob).value, "fallback-key");
  assert.equal(keyWrites.length, 0);
});

test("legacy Safe Storage secrets remain readable with an existing keychain key", () => {
  const { secretCrypto, keyWrites } = setup({ safeStorageAvailable: true });
  const result = secretCrypto.decrypt(Buffer.from("safe-storage-fixture:legacy-key"));
  assert.equal(result.value, "legacy-key");
  assert.equal(result.needsReencrypt, true);
  assert.equal(keyWrites.length, 0);
});
