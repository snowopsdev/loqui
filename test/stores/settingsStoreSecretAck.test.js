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
      listener(change);
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
