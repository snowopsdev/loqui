const assert = require("node:assert/strict");
const test = require("node:test");
const { hasExistingSettingsProfile } = require("../../src/helpers/settingsProfile");
const { initializeVertexAuthSource } = require("../../src/helpers/vertexAuthSourceMigration");
const { createCredentialAuthority } = require("../../src/helpers/credentialAuthority");
const { fakeCodexFs } = require("./harness/fakeCredentialEnv");
const { realCredentialEnv } = require("./harness/realCredentialEnv");

function migrationEnv(t, initial = {}, options = {}) {
  const real = realCredentialEnv(t, initial, options);
  const credentials = createCredentialAuthority({
    env: real.env,
    fs: fakeCodexFs(),
    codexHome: "/profile/codex",
    broadcast() {},
    setTimer() {},
  });
  return { ...real, credentials };
}

// change-driving: Task 2 acknowledged credential boundary.
test("the production profile detector recognizes each selected marker without reading it", async () => {
  const userDataPath = "/profile";
  const markers = [
    "/profile/.env",
    "/profile/secure-keys/.migrated",
    "/profile/transcriptions.db",
    "/profile/transcriptions-dev.db",
  ];
  for (const marker of markers) {
    let statCalls = 0;
    const fs = {
      async stat(path) {
        statCalls++;
        if (path === marker) return { isFile: () => true };
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
      readFile() {
        assert.fail("profile detection must not read marker contents");
      },
    };
    const existing = await hasExistingSettingsProfile({
      fs,
      userDataPath,
      development: marker.endsWith("transcriptions-dev.db"),
    });
    assert.equal(existing, true, marker);
    assert.equal(statCalls, 3);
  }
  const fresh = await hasExistingSettingsProfile({
    fs: {
      stat: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
    },
    userDataPath,
    development: false,
  });
  assert.equal(fresh, false);
  await assert.rejects(
    hasExistingSettingsProfile({
      fs: {
        stat: async () => {
          throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        },
      },
      userDataPath,
      development: false,
    }),
    { code: "EACCES" },
    "an unreadable profile fails closed instead of being classified fresh"
  );
});

// change-driving: Task 2 acknowledged credential boundary.
test("ambient Vertex credentials do not make a fresh profile inherit an existing-install migration", async (t) => {
  await t.test(
    "[change-driving] fresh profile defaults to ADC despite an ambient key",
    async (st) => {
      const fresh = migrationEnv(
        st,
        { GOOGLE_VERTEX_API_KEY: "fixture-legacy-key" },
        { encryptionAvailable: false }
      );
      const freshWrites = [];
      const saveFresh = fresh.env.saveVertexAuthSource.bind(fresh.env);
      fresh.env.saveVertexAuthSource = async (source, options) => {
        freshWrites.push(source);
        return saveFresh(source, options);
      };
      assert.equal(
        await initializeVertexAuthSource({
          hasExistingSettingsProfile: false,
          environment: fresh.env,
          credentials: fresh.credentials,
        }),
        "adc"
      );
      assert.equal(fresh.env.getVertexAuthSource(), "adc");
      assert.deepEqual(freshWrites, ["adc"]);
    }
  );

  await t.test(
    "[baseline guard] existing profile preserves the migrated choice on later initialization",
    async (st) => {
      const existing = migrationEnv(
        st,
        { GOOGLE_VERTEX_API_KEY: "fixture-legacy-key" },
        { encryptionAvailable: false }
      );
      const existingWrites = [];
      const saveExisting = existing.env.saveVertexAuthSource.bind(existing.env);
      existing.env.saveVertexAuthSource = async (source, options) => {
        existingWrites.push(source);
        return saveExisting(source, options);
      };
      const inputs = {
        hasExistingSettingsProfile: true,
        environment: existing.env,
        credentials: existing.credentials,
      };
      assert.equal(await initializeVertexAuthSource(inputs), "apiKey");
      assert.equal(await initializeVertexAuthSource(inputs), "apiKey");
      assert.deepEqual(
        existingWrites,
        ["apiKey", "apiKey"],
        "each boot persists the same choice; the main initializer memoizes calls within a boot"
      );
      assert.equal(
        existingWrites.includes("fixture-legacy-key"),
        false,
        "no value crosses the source saver"
      );
    }
  );
});

// change-driving: Task 2 acknowledged credential boundary.
test("an existing inherited valid source becomes durable before startup admission", async (t) => {
  for (const source of ["adc", "apiKey"]) {
    let savedSource;
    await t.test(
      `[change-driving] ${source}: first launch persists the inherited selection`,
      async (st) => {
        const fixture = migrationEnv(
          st,
          { VERTEX_AUTH_SOURCE: source },
          { encryptionAvailable: false }
        );
        assert.equal(
          await initializeVertexAuthSource({
            hasExistingSettingsProfile: true,
            environment: fixture.env,
            credentials: fixture.credentials,
          }),
          source
        );
        const bytes =
          [...fixture.fs.files.entries()]
            .find(([file]) => file.endsWith("/.env"))?.[1]
            ?.toString("utf8") ?? "";
        const match = bytes.match(/^VERTEX_AUTH_SOURCE=(adc|apiKey)$/m);
        assert.ok(match, "the accepted ambient source must be in the persisted .env snapshot");
        savedSource = match[1];
      }
    );
    await t.test(
      `[baseline guard] ${source}: later launch preserves disk choice despite opposite key presence`,
      async (st) => {
        // New fixture and authority represent another process with no inherited
        // source: dotenv has loaded exactly the source saved by the first boot.
        const fixture = migrationEnv(
          st,
          {
            VERTEX_AUTH_SOURCE: savedSource,
            ...(source === "adc" ? { GOOGLE_VERTEX_API_KEY: "fixture-opposite-key" } : {}),
          },
          { encryptionAvailable: false }
        );
        assert.equal(
          await initializeVertexAuthSource({
            hasExistingSettingsProfile: true,
            environment: fixture.env,
            credentials: fixture.credentials,
          }),
          source,
          "credential presence cannot re-derive an acknowledged selection"
        );
      }
    );
  }
});

// change-driving: Task 2 acknowledged credential boundary.
test("an inherited valid source cannot admit startup without persistence acknowledgement", async (t) => {
  const fixture = migrationEnv(t, { VERTEX_AUTH_SOURCE: "adc" }, { encryptionAvailable: false });
  const expectedEpoch = fixture.env.getEnvWriteEpoch();
  fixture.env.saveVertexAuthSource = async (source, options) => {
    assert.equal(source, "adc");
    assert.deepEqual(options, { expectedEpoch });
    return { success: false };
  };
  await assert.rejects(
    initializeVertexAuthSource({
      hasExistingSettingsProfile: true,
      environment: fixture.env,
      credentials: fixture.credentials,
    }),
    /Could not persist Vertex auth source/
  );
});

// change-driving: Task 2 acknowledged credential boundary.
test("committed stored key wins over the legacy fallback used for migration", async (t) => {
  const fixture = migrationEnv(t, {
    VERTEX_API_KEY: "fixture-stored-key",
    GOOGLE_VERTEX_API_KEY: "fixture-legacy-key",
  });
  const captured = await fixture.credentials.captureCommitted("vertex");
  assert.equal(captured.values.key, "fixture-stored-key");
  assert.deepEqual(
    fixture.credentials.list().find((row) => row.id === "vertex").fields,
    { key: true },
    "presence still describes only the stored slot"
  );
  assert.equal(JSON.stringify(captured).includes("fixture-legacy-key"), false);
});

// change-driving: Task 2 acknowledged credential boundary.
test("Vertex source saves serialize durable writes without exposing a staged source", async (t) => {
  const fixture = migrationEnv(t, { VERTEX_AUTH_SOURCE: "adc" }, { encryptionAvailable: false });
  fixture.fs.holdNext((op, name) => op === "writeFile" && name === ".env.tmp");
  const first = fixture.env.saveVertexAuthSource("apiKey");
  const hold = await fixture.fs.nextHold();
  assert.equal(
    fixture.env.getVertexAuthSource(),
    "adc",
    "a pending source write does not change main's committed source"
  );
  const second = fixture.env.saveVertexAuthSource("apiKey");
  hold.fail(Object.assign(new Error("EIO"), { code: "EIO" }));
  await assert.rejects(first, { code: "EIO" });
  assert.deepEqual(await second, { success: true });
  assert.equal(fixture.env.getVertexAuthSource(), "apiKey");
  const envFile =
    [...fixture.fs.files.entries()]
      .find(([file]) => file.endsWith("/.env"))?.[1]
      ?.toString("utf8") ?? "";
  assert.match(
    envFile,
    /^VERTEX_AUTH_SOURCE=apiKey$/m,
    "the later acknowledged source is the persisted value"
  );
});

// change-driving: Task 2 acknowledged credential boundary.
test("migration waits for an already queued Vertex save before choosing its source", async (t) => {
  const fixture = migrationEnv(t);
  fixture.fs.holdNext((op, name) => op === "rename" && name === "VERTEX_API_KEY.enc");
  const saving = fixture.credentials.save("vertex", "key", "fixture-stored-key");
  const hold = await fixture.fs.nextHold();
  let settled = false;
  const migration = initializeVertexAuthSource({
    hasExistingSettingsProfile: true,
    environment: fixture.env,
    credentials: fixture.credentials,
  }).then((source) => ((settled = true), source));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "migration cannot read a value while the queued write is pending");
  hold.release();
  assert.deepEqual(await saving, { ok: true, generation: 1 });
  assert.equal(await migration, "apiKey");
});

// change-driving: Task 2 acknowledged credential boundary.
test("reset invalidates a migration paused after capture and before its source write", async (t) => {
  const fixture = migrationEnv(
    t,
    { VERTEX_API_KEY: "fixture-stored-key" },
    { encryptionAvailable: false }
  );
  const realSave = fixture.env.saveVertexAuthSource.bind(fixture.env);
  let reachedSave;
  const reached = new Promise((resolve) => (reachedSave = resolve));
  let releaseSave;
  const saveGate = new Promise((resolve) => (releaseSave = resolve));
  fixture.env.saveVertexAuthSource = async (source, options) => {
    reachedSave({ source, options });
    await saveGate;
    return realSave(source, options);
  };
  const migration = initializeVertexAuthSource({
    hasExistingSettingsProfile: true,
    environment: fixture.env,
    credentials: fixture.credentials,
  });
  const pendingWrite = await reached;
  assert.equal(pendingWrite.source, "apiKey");
  assert.equal(typeof pendingWrite.options.expectedEpoch, "number");
  await fixture.credentials.reset(fixture.erase);
  releaseSave();
  await assert.rejects(migration, { code: "ENV_RESET" });
  assert.equal(fixture.env.getVertexAuthSource(), null);
  assert.equal(fixture.env.getVertexApiKey(), "");
  assert.equal(
    [...fixture.fs.files.keys()].some(
      (file) => file.endsWith("/.env") || file.endsWith("/.env.tmp")
    ),
    false,
    "neither the source nor a secret is recreated after reset returns"
  );
});

// change-driving: execute main's actual injected factory configuration getter without booting Electron.
// change-driving: Task 2 acknowledged credential boundary.
test("main factory config waits for migration and carries the committed explicit Vertex source", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const ts = require("typescript");
  const text = fs.readFileSync(path.join(__dirname, "../../main.js"), "utf8");
  const tree = ts.createSourceFile("main.js", text, ts.ScriptTarget.Latest, true);
  let getter;
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === "getEnterpriseConfig")
      getter = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(getter);
  let admit;
  let reads = 0;
  const sourceReady = new Promise((resolve) => {
    admit = resolve;
  });
  const configGetter = vm.runInNewContext(`(${getter})`, {
    ipcHandlers: {
      vertexAuthSourceReady: sourceReady,
      credentials: { captureCommitted: async () => null },
    },
    environmentManager: new Proxy(
      {},
      {
        get: (_, name) => () => {
          reads++;
          return name === "getVertexAuthSource"
            ? "adc"
            : name === "getVertexProject"
              ? "fixture-project"
              : "";
        },
      }
    ),
  });
  const pending = configGetter();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 0);
  admit();
  const config = await pending;
  assert.equal(config.vertexAuthSource, "adc");
  assert.equal(config.vertexProject, "fixture-project");
  await assert.rejects(
    configGetter("bedrock"),
    /Credential persistence is unavailable/,
    "unknown or reset Bedrock storage cannot fall through to SDK credential discovery"
  );
  const model = await require("../../src/helpers/enterpriseAiProviders").getEnterpriseAIModel(
    "vertex",
    "fixture-model",
    "",
    config
  );
  assert.ok(
    model,
    "the actual SDK factory accepts main’s explicit source without a provider request"
  );
  const start = text.indexOf("async function startApp()");
  const profile = text.indexOf("const existingSettingsProfile =", start);
  const managers = text.indexOf("initializeCoreManagers();", start);
  const migration = text.indexOf("await ipcHandlers.initializeVertexAuthSource(", start);
  const sidecars = text.indexOf("registerSidecars();", start);
  assert.ok(start < profile && profile < managers && managers < migration && migration < sidecars);
});
