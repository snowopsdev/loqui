const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { deferred } = require("../helpers/harness/deferred");

const SECRET = "sk-live-SECRET-value";

function fakeCredentials() {
  const calls = [];
  let respond = () => ({ ok: true, generation: 1 });
  let listener = null;
  return {
    calls,
    respond(fn) {
      respond = fn;
    },
    emit(change) {
      listener?.(change);
    },
    api: {
      save: async (id, field, value) => {
        calls.push([id, field, value]);
        return respond(id, field, value);
      },
      onChanged(callback) {
        listener = callback;
        return () => {
          listener = null;
        };
      },
    },
  };
}

// change-driving: Task 2 acknowledged credential boundary.
test("secret setters wait for main's acknowledgement", async (t) => {
  const creds = fakeCredentials();
  installBrowserGlobals(t, {
    window: { electronAPI: { credentials: creds.api }, dispatchEvent() {} },
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-secret-ack-test-",
    mockModules: {
      "/services/ReasoningService": "export default { clearApiKeyCache() {} };",
    },
  });
  const load = async () => {
    vite.moduleGraph.invalidateAll();
    return vite.ssrLoadModule("/stores/settingsStore.ts");
  };

  // change-driving: today the setter writes the raw key into zustand at once.
  await t.test(
    "a slow save keeps the raw key out of the store until main acknowledges",
    async () => {
      const { useSettingsStore } = await load();
      const gate = deferred();
      creds.respond(() => gate.promise);
      const seen = [];
      const stop = useSettingsStore.subscribe((state) => seen.push(state.openaiApiKey));
      const pending = useSettingsStore.getState().setOpenaiApiKey(SECRET);
      assert.equal(useSettingsStore.getState().openaiApiKey, "");
      gate.resolve({ ok: true, generation: 1 });
      assert.deepEqual(await pending, { ok: true });
      assert.equal(useSettingsStore.getState().openaiApiKey, "__stored__");
      assert.ok(!seen.includes(SECRET), "the raw key never entered renderer state");
      assert.deepEqual(creds.calls.at(-1), ["openai", "key", SECRET]);
      stop();
    }
  );

  // change-driving: today failures are only logged and the setter returns nothing.
  await t.test("a failed save keeps the previous presence and returns the error", async () => {
    const { useSettingsStore } = await load();
    useSettingsStore.setState({ groqApiKey: "__stored__" });
    creds.respond(() => ({ ok: false, error: "persistFailed" }));
    assert.deepEqual(await useSettingsStore.getState().setGroqApiKey("gsk-new"), {
      ok: false,
      error: "persistFailed",
    });
    assert.equal(useSettingsStore.getState().groqApiKey, "__stored__");
    creds.respond(() => Promise.reject(new Error("ipc down")));
    assert.deepEqual(await useSettingsStore.getState().setGroqApiKey(""), {
      ok: false,
      error: "persistFailed",
    });
    assert.equal(useSettingsStore.getState().groqApiKey, "__stored__");
  });

  // change-driving: a later failed request must not hide an earlier durable success.
  await t.test("a later failure still reflects the earlier committed acknowledgement", async () => {
    const { useSettingsStore } = await load();
    const earlier = deferred();
    creds.respond((_id, _field, value) =>
      value ? earlier.promise : { ok: false, error: "persistFailed" }
    );
    const saving = useSettingsStore.getState().setGroqApiKey("fixture-new");
    assert.equal((await useSettingsStore.getState().setGroqApiKey("")).ok, false);
    earlier.resolve({ ok: true, generation: 1 });
    await saving;
    assert.equal(useSettingsStore.getState().groqApiKey, "__stored__");
  });

  // change-driving: plaintext legacy copies never enter zustand before acknowledged migration.
  await t.test("initial legacy custom keys stay outside renderer state", async () => {
    localStorage.setItem("noteFormattingCustomApiKey", SECRET);
    const { useSettingsStore } = await load();
    assert.equal(useSettingsStore.getState().noteFormattingCustomApiKey, "");
    localStorage.removeItem("noteFormattingCustomApiKey");
  });

  // change-driving: an older acknowledgement must not overwrite a newer save.
  await t.test("a replacement save is not undone by a slower earlier acknowledgement", async () => {
    const { useSettingsStore } = await load();
    const removal = deferred();
    const replacement = deferred();
    creds.respond((_id, _field, value) => (value === "" ? removal.promise : replacement.promise));
    const removing = useSettingsStore.getState().setMistralApiKey("");
    const replacing = useSettingsStore.getState().setMistralApiKey("mk-new");
    replacement.resolve({ ok: true, generation: 2 });
    await replacing;
    assert.equal(useSettingsStore.getState().mistralApiKey, "__stored__");
    removal.resolve({ ok: true, generation: 1 });
    await removing;
    assert.equal(useSettingsStore.getState().mistralApiKey, "__stored__");
  });

  // change-driving: flushSecretSaves does not exist.
  await t.test("flushSecretSaves waits for every pending save", async () => {
    const { useSettingsStore, flushSecretSaves } = await load();
    const gate = deferred();
    creds.respond(() => gate.promise);
    void useSettingsStore.getState().setAnthropicApiKey("sk-ant");
    let flushed = false;
    const flushing = flushSecretSaves().then(() => (flushed = true));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(flushed, false);
    gate.resolve({ ok: true, generation: 1 });
    await flushing;
    assert.equal(flushed, true);
    await flushSecretSaves();
  });

  // change-driving (I10): Corti text and speech are separate main identities.
  await t.test("each secret field is saved to its own main credential slot", async () => {
    const { useSettingsStore } = await load();
    creds.respond(() => ({ ok: true, generation: 1 }));
    for (const [setter, id, field] of [
      ["setCortiApiKey", "corti:text", "key"],
      ["setCortiClientId", "corti:speech", "clientId"],
      ["setCortiClientSecret", "corti:speech", "clientSecret"],
      ["setCustomTranscriptionApiKey", "custom:transcription", "key"],
      ["setCleanupCustomApiKey", "custom:dictationCleanup", "key"],
      ["setChatAgentCustomApiKey", "custom:chatIntelligence", "key"],
      ["setBedrockAccessKeyId", "bedrock", "accessKeyId"],
      ["setBedrockSessionToken", "bedrock", "sessionToken"],
      ["setAzureApiKey", "azure", "key"],
      ["setVertexApiKey", "vertex", "key"],
    ]) {
      assert.deepEqual(await useSettingsStore.getState()[setter]("v"), { ok: true }, setter);
      assert.deepEqual(creds.calls.at(-1), [id, field, "v"], setter);
    }
  });

  // change-driving: other windows learn about saves and removals from main.
  await t.test("credentials-changed from main updates every matching sentinel", async () => {
    const { useSettingsStore, subscribeCredentialChanges } = await load();
    useSettingsStore.setState({ cortiClientId: "", cortiClientSecret: "__stored__" });
    const stop = subscribeCredentialChanges();
    creds.emit({
      id: "corti:speech",
      present: false,
      generation: 4,
      fields: { clientId: true, clientSecret: false },
    });
    assert.equal(useSettingsStore.getState().cortiClientId, "__stored__");
    assert.equal(useSettingsStore.getState().cortiClientSecret, "");
    creds.emit({ id: "corti:text", present: true, generation: 1, fields: { key: true } });
    assert.equal(useSettingsStore.getState().cortiApiKey, "__stored__");
    creds.emit({
      id: "corti:speech",
      present: true,
      generation: 2,
      fields: { clientId: false, clientSecret: true },
    });
    assert.equal(
      useSettingsStore.getState().cortiClientId,
      "__stored__",
      "older event cannot overwrite generation 4"
    );
    assert.equal(useSettingsStore.getState().cortiClientSecret, "");
    const before = useSettingsStore.getState();
    creds.emit({ id: "codex", present: true, generation: 0, fields: {} });
    assert.equal(useSettingsStore.getState(), before, "no store slot for codex");
    stop();
  });
});

// change-driving review R3: legacy getter snapshots never overwrite newer committed presence.
test("late secret hydration cannot overwrite an acknowledged save/removal", async (t) => {
  for (const removing of [true, false]) {
    await t.test(
      removing ? "removal while initial read is held" : "save while initial read is held",
      async (st) => {
        const creds = fakeCredentials();
        const initial = deferred();
        installBrowserGlobals(st, {
          window: {
            electronAPI: {
              credentials: creds.api,
              getOpenAIKey: () => initial.promise,
              getDictionary: async () => ["Loqui"],
            },
            dispatchEvent() {},
          },
        });
        const vite = await createRendererServer(st, {
          cachePrefix: "loqui-hydration-ack-",
          mockModules: {
            "/services/ReasoningService": "export default { clearApiKeyCache() {} };",
          },
        });
        const { useSettingsStore, initializeSettings } = await vite.ssrLoadModule(
          "/stores/settingsStore.ts"
        );
        useSettingsStore.setState({ openaiApiKey: removing ? "__stored__" : "" });
        const initializing = initializeSettings();
        await useSettingsStore.getState().setOpenaiApiKey(removing ? "" : "fixture-new");
        assert.equal(useSettingsStore.getState().openaiApiKey, removing ? "" : "__stored__");
        initial.resolve(removing ? "__stored__" : "");
        await initializing;
        assert.equal(useSettingsStore.getState().openaiApiKey, removing ? "" : "__stored__");
      }
    );
  }
});

// change-driving review R3: subscribe before both initial getter and legacy migration waits.
test("credential events received during secret hydration survive the initial snapshot", async (t) => {
  for (const migrating of [false, true]) {
    await t.test(
      migrating ? "events and ACKs during legacy migration" : "peer events during initial reads",
      async (st) => {
        const creds = fakeCredentials();
        const gate = deferred();
        const migrationStarted = deferred();
        const browser = installBrowserGlobals(st, {
          initialStorage: migrating
            ? {
                noteFormattingCustomApiKey: "fixture-legacy",
                translationCustomApiKey: "fixture-legacy-translation",
              }
            : {},
          window: {
            electronAPI: {
              credentials: creds.api,
              getOpenAIKey: migrating ? async () => "__stored__" : () => gate.promise,
              getGroqKey: async () => "",
              getDictionary: async () => ["Loqui"],
            },
            dispatchEvent() {},
          },
        });
        if (migrating)
          creds.respond((id) => {
            if (id === "custom:noteFormatting") {
              migrationStarted.resolve();
              return gate.promise;
            }
            return { ok: true, generation: 2 };
          });
        const vite = await createRendererServer(st, {
          cachePrefix: "loqui-hydration-event-",
          mockModules: {
            "/services/ReasoningService": "export default { clearApiKeyCache() {} };",
          },
        });
        const { useSettingsStore, initializeSettings } = await vite.ssrLoadModule(
          "/stores/settingsStore.ts"
        );
        const initializing = initializeSettings();
        if (migrating) await migrationStarted.promise;
        creds.emit({ id: "openai", present: false, generation: 2, fields: { key: false } });
        creds.emit({ id: "groq", present: true, generation: 2, fields: { key: true } });
        if (migrating) {
          await useSettingsStore.getState().setOpenaiApiKey("");
          creds.emit({
            id: "custom:noteFormatting",
            present: false,
            generation: 3,
            fields: { key: false },
          });
          creds.emit({
            id: "custom:dictationTranslation",
            present: true,
            generation: 4,
            fields: { key: true },
          });
          gate.resolve({ ok: true, generation: 1 });
        } else gate.resolve("__stored__");
        await initializing;
        assert.equal(useSettingsStore.getState().openaiApiKey, "");
        assert.equal(useSettingsStore.getState().groqApiKey, "__stored__");
        if (migrating) {
          assert.equal(useSettingsStore.getState().noteFormattingCustomApiKey, "");
          assert.equal(browser.storage.getItem("noteFormattingCustomApiKey"), null);
          assert.equal(useSettingsStore.getState().translationCustomApiKey, "__stored__");
          assert.equal(
            creds.calls.some(
              ([id, , value]) =>
                id === "custom:dictationTranslation" && value === "fixture-legacy-translation"
            ),
            false,
            "peer ACK revokes the delayed legacy admission"
          );
          assert.equal(browser.storage.getItem("translationCustomApiKey"), null);
        }
      }
    );
  }
});

// change-driving review R3: an earlier legacy migration wait must not admit stale later-slot copies.
test("legacy migration waits for pending user saves and never overwrites a newer credential", async (t) => {
  const creds = fakeCredentials();
  const legacyGate = deferred();
  const userGate = deferred();
  const started = deferred();
  const browser = installBrowserGlobals(t, {
    initialStorage: {
      noteFormattingCustomApiKey: "fixture-legacy-note",
      translationCustomApiKey: "fixture-legacy-translation",
    },
    window: {
      electronAPI: { credentials: creds.api, getDictionary: async () => ["Loqui"] },
      dispatchEvent() {},
    },
  });
  creds.respond((id, _field, value) => {
    if (id === "custom:noteFormatting") {
      started.resolve();
      return legacyGate.promise;
    }
    return value === "fixture-current-translation" ? userGate.promise : { ok: true, generation: 3 };
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-hydration-migration-",
    mockModules: { "/services/ReasoningService": "export default { clearApiKeyCache() {} };" },
  });
  const { useSettingsStore, initializeSettings } = await vite.ssrLoadModule(
    "/stores/settingsStore.ts"
  );
  const initializing = initializeSettings();
  await started.promise;
  const saving = useSettingsStore
    .getState()
    .setTranslationCustomApiKey("fixture-current-translation");
  legacyGate.resolve({ ok: true, generation: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  const admittedBeforeUserAck = creds.calls
    .filter(([id]) => id === "custom:dictationTranslation")
    .map(([, , value]) => value);
  userGate.resolve({ ok: true, generation: 2 });
  await saving;
  await initializing;
  assert.deepEqual(admittedBeforeUserAck, ["fixture-current-translation"]);
  assert.deepEqual(
    creds.calls.filter(([id]) => id === "custom:dictationTranslation").map(([, , value]) => value),
    ["fixture-current-translation"]
  );
  assert.equal(useSettingsStore.getState().translationCustomApiKey, "__stored__");
  assert.equal(
    browser.storage.getItem("translationCustomApiKey"),
    null,
    "stale legacy copy cannot resurrect next initialization"
  );
});

// change-driving review R3: a retained failed-migration copy becomes stale after a newer main change.
test("a newer credential event discards a failed legacy migration copy before later startup work completes", async (t) => {
  const creds = fakeCredentials();
  const laterMigration = deferred();
  const started = deferred();
  const browser = installBrowserGlobals(t, {
    initialStorage: {
      noteFormattingCustomApiKey: "fixture-failed-note",
      translationCustomApiKey: "fixture-later-translation",
    },
    window: {
      electronAPI: { credentials: creds.api, getDictionary: async () => ["Loqui"] },
      dispatchEvent() {},
    },
  });
  creds.respond((id) => {
    if (id === "custom:noteFormatting") return { ok: false, error: "persistFailed" };
    started.resolve();
    return laterMigration.promise;
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-hydration-stale-copy-",
    mockModules: { "/services/ReasoningService": "export default { clearApiKeyCache() {} };" },
  });
  const { useSettingsStore, initializeSettings } = await vite.ssrLoadModule(
    "/stores/settingsStore.ts"
  );
  const initializing = initializeSettings();
  await started.promise;
  creds.emit({
    id: "custom:noteFormatting",
    present: false,
    generation: 2,
    fields: { key: false },
  });
  laterMigration.resolve({ ok: true, generation: 1 });
  await initializing;
  assert.equal(useSettingsStore.getState().noteFormattingCustomApiKey, "");
  assert.equal(
    browser.storage.getItem("noteFormattingCustomApiKey"),
    null,
    "a later authoritative removal revokes the failed legacy copy"
  );
});
