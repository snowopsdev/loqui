const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/utils/onboardingCleanup.ts");

function createSettings(overrides = {}) {
  const state = { useCleanupModel: false, mode: "local", provider: "local", ...overrides };
  return {
    state,
    get cleanupModel() {
      return state.model ?? "";
    },
    setUseCleanupModel: (value) => (state.useCleanupModel = value),
    setCleanupMode: (value) => (state.mode = value),
    setCleanupProvider: (value) => (state.provider = value),
    setCleanupModel: (value) => (state.model = value),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

const signedIn = { available: true, account: { type: "chatgpt" } };
const codexCatalog = {
  data: [{ model: "codex-fixture-b" }, { model: "codex-fixture-a", isDefault: true }],
};
const catalog = {
  owns: (provider, model) => provider === "openai" && model.startsWith("gpt-"),
  defaultModel: (provider) => (provider === "openai" ? "gpt-fixture" : ""),
};

// The harness mirrors OnboardingFlow: every pick bumps a counter and a result
// is only applied while its own pick is still the latest one.
function createChooser({ settings, bridge, preview = false, scenario = "fresh" }) {
  const statuses = [];
  let latest = 0;
  return {
    statuses,
    async choose(choice) {
      const { applyCleanupChoice } = await load();
      const request = ++latest;
      return applyCleanupChoice({
        choice,
        settings,
        bridge,
        catalog,
        preview,
        scenario,
        setStatus: (status) => statuses.push(status),
        isCurrent: () => latest === request,
      });
    },
  };
}

test("a Codex check that settles after No cleanup was chosen never activates cleanup", async () => {
  const settings = createSettings();
  const check = deferred();
  const chooser = createChooser({
    settings,
    bridge: {
      personalInference: {
        codexStatus: () => check.promise,
        codexModels: async () => codexCatalog,
      },
    },
  });
  const pending = chooser.choose("codex");
  await chooser.choose("none");
  check.resolve(signedIn);
  await pending;
  assert.equal(settings.state.useCleanupModel, false);
  assert.equal(chooser.statuses.at(-1), "skipped");
});

test("a slow local model load cannot activate cleanup after the user picked another option", async () => {
  const settings = createSettings();
  const load = deferred();
  const credentialRefs = [];
  const chooser = createChooser({
    settings,
    bridge: {
      modelTestLoad: () => load.promise,
      personalInference: {
        credentialStatus: async (ref) => (credentialRefs.push(ref), { configured: false }),
      },
    },
  });
  const slow = chooser.choose("local");
  await chooser.choose("provider");
  load.resolve({ success: true });
  await slow;
  assert.equal(settings.state.useCleanupModel, false);
  assert.equal(settings.state.provider, "openai");
  assert.equal(chooser.statuses.at(-1), "failed");
  assert.deepEqual(credentialRefs, ["openai"]);
});

test("the latest check still activates cleanup once it succeeds", async () => {
  const settings = createSettings();
  const stale = deferred();
  const calls = [];
  const chooser = createChooser({
    settings,
    bridge: {
      modelTestLoad: () => stale.promise,
      personalInference: {
        codexStatus: async () => (calls.push("codex"), signedIn),
        codexModels: async () => codexCatalog,
      },
    },
  });
  const first = chooser.choose("local");
  await chooser.choose("codex");
  stale.resolve({ success: false });
  await first;
  assert.equal(settings.state.useCleanupModel, true);
  assert.equal(settings.state.provider, "codex");
  assert.equal(chooser.statuses.at(-1), "ready");
});

test("an unavailable provider leaves cleanup off and reports the failure", async () => {
  const settings = createSettings();
  const chooser = createChooser({
    settings,
    bridge: {
      personalInference: {
        codexStatus: async () => ({ available: true, account: null }),
        codexModels: async () => codexCatalog,
        credentialStatus: async () => {
          throw new Error("keychain locked");
        },
      },
    },
  });
  await chooser.choose("codex");
  assert.equal(settings.state.useCleanupModel, false);
  assert.equal(chooser.statuses.at(-1), "failed");
  await chooser.choose("provider");
  assert.equal(settings.state.useCleanupModel, false);
  assert.equal(chooser.statuses.at(-1), "failed");
});

test("preview scenarios activate cleanup only for the ready scenario", async () => {
  for (const [scenario, expected] of [
    ["ready", true],
    ["codex-expired", false],
  ]) {
    const settings = createSettings();
    const chooser = createChooser({ settings, preview: true, scenario });
    await chooser.choose("codex");
    assert.equal(settings.state.useCleanupModel, expected, scenario);
  }
});

test("a provider key never keeps the local default model", async () => {
  const settings = createSettings({ model: "qwen3.5-2b-q4_k_m" });
  const chooser = createChooser({
    settings,
    bridge: { personalInference: { credentialStatus: async () => ({ configured: true }) } },
  });
  await chooser.choose("provider");
  assert.equal(settings.state.useCleanupModel, true);
  assert.equal(settings.state.provider, "openai");
  assert.equal(settings.state.model, "gpt-fixture");
  assert.equal(chooser.statuses.at(-1), "ready");
});

test("a provider model the provider already serves is kept", async () => {
  const settings = createSettings({ model: "gpt-custom-pick" });
  const chooser = createChooser({
    settings,
    bridge: { personalInference: { credentialStatus: async () => ({ configured: true }) } },
  });
  await chooser.choose("provider");
  assert.equal(settings.state.model, "gpt-custom-pick");
});

test("a missing provider key does not rewrite the stored model", async () => {
  const settings = createSettings({ model: "qwen3.5-2b-q4_k_m" });
  const chooser = createChooser({
    settings,
    bridge: { personalInference: { credentialStatus: async () => ({ configured: false }) } },
  });
  await chooser.choose("provider");
  assert.equal(settings.state.useCleanupModel, false);
  assert.equal(settings.state.model, "qwen3.5-2b-q4_k_m");
  assert.equal(chooser.statuses.at(-1), "failed");
});

test("Codex cleanup selects a model Codex lists instead of the local default", async () => {
  const settings = createSettings({ model: "qwen3.5-2b-q4_k_m" });
  const chooser = createChooser({
    settings,
    bridge: {
      personalInference: {
        codexStatus: async () => signedIn,
        codexModels: async () => codexCatalog,
      },
    },
  });
  await chooser.choose("codex");
  assert.equal(settings.state.useCleanupModel, true);
  assert.equal(settings.state.provider, "codex");
  assert.equal(settings.state.model, "codex-fixture-a");
});

test("a Codex model the account already serves is kept", async () => {
  const settings = createSettings({ model: "codex-fixture-b" });
  const chooser = createChooser({
    settings,
    bridge: {
      personalInference: {
        codexStatus: async () => signedIn,
        codexModels: async () => codexCatalog,
      },
    },
  });
  await chooser.choose("codex");
  assert.equal(settings.state.model, "codex-fixture-b");
});

test("Codex without a usable model list is reported as needing attention", async () => {
  for (const codexModels of [
    async () => ({ data: [] }),
    async () => Promise.reject(new Error("offline")),
  ]) {
    const settings = createSettings({ model: "qwen3.5-2b-q4_k_m" });
    const chooser = createChooser({
      settings,
      bridge: { personalInference: { codexStatus: async () => signedIn, codexModels } },
    });
    await chooser.choose("codex");
    assert.equal(settings.state.useCleanupModel, false);
    assert.equal(settings.state.model, "qwen3.5-2b-q4_k_m");
    assert.equal(chooser.statuses.at(-1), "failed");
  }
});
