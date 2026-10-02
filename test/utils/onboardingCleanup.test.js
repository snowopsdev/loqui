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
    bridge: { personalInference: { codexStatus: () => check.promise } },
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
      personalInference: { codexStatus: async () => (calls.push("codex"), signedIn) },
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
