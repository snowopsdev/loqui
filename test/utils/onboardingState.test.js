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
