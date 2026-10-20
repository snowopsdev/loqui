const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/utils/onboardingState.ts");

function installStorage(t, initial) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size;
      },
      key: (index) => [...values.keys()][index] ?? null,
      getItem: (key) => (values.has(key) ? values.get(key) : null),
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  });
  return values;
}

test("preview restart clears every entry stored for that scenario and nothing else", async (t) => {
  const { clearOnboardingPreviewState } = await load();
  const prefix = "loqui.onboarding.preview.";
  const values = installStorage(t, {
    [`${prefix}macos.fresh`]: '{"version":2}',
    [`${prefix}macos.fresh.speechReadyModel`]: "parakeet-unified-en-0.6b",
    [`${prefix}macos.fresh.speechModel`]: "parakeet-unified-en-0.6b",
    [`${prefix}macos.fresh.reuseCleanup`]: "true",
    [`${prefix}macos.fresh.checklistDismissed`]: "true",
    [`${prefix}macos.fresh.addedLater`]: "x",
    [`${prefix}macos.ready`]: '{"version":2}',
    [`${prefix}linux.fresh`]: '{"version":2}',
    [`${prefix}macos.freshly`]: "different scenario name",
    "loqui.onboarding.progress": '{"version":2}',
    onboardingCompleted: "true",
    cleanupMode: "local",
  });

  clearOnboardingPreviewState({ step: "welcome", scenario: "fresh", platform: "macos" });

  assert.deepEqual(
    [...values.keys()].sort(),
    [
      "cleanupMode",
      "loqui.onboarding.progress",
      "onboardingCompleted",
      `${prefix}linux.fresh`,
      `${prefix}macos.freshly`,
      `${prefix}macos.ready`,
    ].sort()
  );
});

test("clearing preview state without browser storage does nothing", async () => {
  const { clearOnboardingPreviewState } = await load();
  assert.doesNotThrow(() =>
    clearOnboardingPreviewState({ step: "welcome", scenario: "fresh", platform: "linux" })
  );
});

function stubStorage(t, initial = {}) {
  const values = new Map(Object.entries(initial));
  const storage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage;
  t.after(() => {
    globalThis.localStorage = previous;
  });
  return values;
}

test("progress remembers visited steps and drops unknown ones", async (t) => {
  stubStorage(t, {
    "loqui.onboarding.progress": JSON.stringify({
      version: 2,
      step: "try",
      explored: false,
      completed: false,
      visited: ["welcome", "speech", "bogus", 7],
    }),
  });
  const { readOnboardingProgress, writeOnboardingProgress } =
    await import("../../src/utils/onboardingState.ts");
  assert.deepEqual(readOnboardingProgress().visited, ["welcome", "speech"]);
  assert.deepEqual(writeOnboardingProgress({ visited: ["welcome", "speech", "try"] }).visited, [
    "welcome",
    "speech",
    "try",
  ]);
});

test("records written before visited existed still load", async (t) => {
  stubStorage(t, {
    "loqui.onboarding.progress": JSON.stringify({
      version: 2,
      step: "cleanup",
      explored: true,
      completed: false,
    }),
  });
  const { readOnboardingProgress } = await import("../../src/utils/onboardingState.ts");
  assert.deepEqual(readOnboardingProgress(), {
    version: 2,
    step: "cleanup",
    explored: true,
    completed: false,
    visited: [],
  });
});

test("every preview scenario round-trips through the URL", async () => {
  const { ONBOARDING_SCENARIOS, parseOnboardingPreviewConfig } =
    await import("../../src/utils/onboardingState.ts");
  for (const scenario of [
    "accessibility-missing",
    "nothing-heard",
    "low-disk",
    "multilingual",
    "fresh",
  ]) {
    assert.ok(ONBOARDING_SCENARIOS.includes(scenario));
    assert.equal(parseOnboardingPreviewConfig(`?scenario=${scenario}`).scenario, scenario);
  }
  assert.equal(parseOnboardingPreviewConfig("?scenario=nope").scenario, "fresh");
});
