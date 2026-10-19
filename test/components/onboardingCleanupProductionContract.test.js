const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (file) => fs.readFileSync(path.join(__dirname, "../..", file), "utf8");
// Targets forbidden execution branches and literal preview badges. Legitimate
// cleanupPreview/MicLevelPreview identifiers and consent/example prose are valid.
const violations = (source) =>
  [
    /\b(?:window|globalThis)\.loquiBrowserPreview(?:Config)?\b/,
    /\bif\s*\(\s*preview\s*(?:\)|&&|\|\|)/,
    /\bif\s*\([^)]*\bscenario\s*(?:[!=]=|\))/,
    />\s*Preview\s*:?\s*</,
  ].filter((pattern) => pattern.test(source));
test("Task16 production checks and UI have no preview globals, scenario fallback or badge", () => {
  const flow = read("src/components/OnboardingFlow.tsx");
  const choose = flow.slice(
    flow.indexOf("  const chooseCleanup ="),
    flow.indexOf("  const applyCleanupToOtherTasks =")
  );
  for (const source of [
    choose,
    read("src/utils/onboardingCleanup.ts"),
    read("src/components/onboarding/CleanupStep.tsx"),
    read("src/components/onboarding/cleanupRunner.ts"),
  ])
    assert.deepEqual(violations(source), []);
  assert.equal(/\b(?:preview|scenario)\s*[,=:]/.test(choose), false);
});
test("guard rejects actual forbidden branches but admits the required names and honest example/consent copy", () => {
  for (const bad of [
    'if (preview) return settle(scenario === "ready");',
    "window.loquiBrowserPreviewConfig.scenario",
    "<span>Preview:</span>",
  ])
    assert.ok(violations(bad).length > 0, bad);
  assert.deepEqual(
    violations(
      'const preview = cleanupPreview(input); if (preview.source === "example") cleanupPreview(input); const mic: MicLevelPreview = value; t("setupFlow.cleanup.exampleNotice"); "Your words were sent for this preview";'
    ),
    []
  );
});
