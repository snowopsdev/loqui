const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

// Run with an empty inherited environment and synthetic profile/resources.
// These checks never read the developer's credentials or application profile.
const fixture = String.raw`
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const Module = require("node:module");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-dotenv-fixture-"));
  const profile = path.join(root, "profile");
  const resources = path.join(root, "resources");
  fs.mkdirSync(profile);
  fs.mkdirSync(resources);
  process.resourcesPath = resources;
  const profileEnv = path.join(profile, ".env");
  const expectedSecret = "fixture value # with=punctuation";
  fs.writeFileSync(profileEnv, 'OPENAI_API_KEY="' + expectedSecret + '"\nDICTATION_KEY=F8\n');
  fs.writeFileSync(path.join(resources, ".env"), "OPENAI_API_KEY=fixture-fallback\nDICTATION_KEY=F9\nUI_LANGUAGE=fr\n");
  process.env.OPENAI_API_KEY = "fixture-system";
  process.env.DICTATION_KEY = "F7";
  const logs = [];
  console.log = (...args) => logs.push(args);
  console.error = (...args) => logs.push(args);
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === "electron") return { app: { getPath: () => profile } };
    if (request === "./debugLogger") return { info() {}, error() {}, warn() {} };
    if (request === "./i18nMain") return { normalizeUiLanguage: value => value };
    if (request === "./secretCrypto") return {
      isAvailable: () => true,
      encrypt(value) {
        if (process.argv[1] === "failure") throw new Error("Fixture encryption unavailable");
        return Buffer.from("fixture:" + value);
      },
      decrypt(buffer) { return { value: buffer.toString().slice(8), needsReencrypt: false }; },
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  // Only the synthetic resources/profile .env files participate, even if a
  // developer later adds a repository .env next to this test checkout.
  const exists = fs.existsSync;
  fs.existsSync = function(file) {
    if (file === path.join(process.cwd(), ".env")) return false;
    return exists(file);
  };
  (async () => {
    try {
      const EnvironmentManager = require("./src/helpers/environment");
      const manager = new EnvironmentManager();
      assert.equal(process.env.OPENAI_API_KEY, expectedSecret);
      assert.equal(process.env.DICTATION_KEY, "F8");
      assert.equal(process.env.UI_LANGUAGE, "fr");
      await manager.init();
      const sentinel = path.join(profile, "secure-keys", ".migrated");
      if (process.argv[1] === "failure") {
        assert.equal(fs.existsSync(sentinel), false);
        assert.ok(fs.readFileSync(profileEnv, "utf8").includes(expectedSecret));
      } else {
        assert.equal(fs.existsSync(sentinel), true);
        assert.equal(fs.readFileSync(profileEnv, "utf8").includes(expectedSecret), false);
        process.env.OPENAI_API_KEY = "fixture-old-environment";
        await manager.init();
        assert.equal(process.env.OPENAI_API_KEY, expectedSecret);
        await manager.saveAllKeysToEnvFile();
        assert.equal(fs.readFileSync(profileEnv, "utf8").includes("OPENAI_API_KEY="), false);
      }
      assert.equal(logs.length, 0, "dotenv must not write startup or settings logs");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  })().catch(error => { process.stderr.write(error.stack); process.exitCode = 1; });
`;

for (const mode of ["success", "failure"]) {
  test(`real dotenv preserves profile precedence and secrets when migration is ${mode}`, () => {
    const result = spawnSync(process.execPath, ["-e", fixture, mode], {
      cwd: path.join(__dirname, "../.."),
      env: {},
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  });
}
