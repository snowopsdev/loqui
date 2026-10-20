const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingFlow.ts");
const loadState = () => import("../../src/utils/onboardingState.ts");

test("first words come before options: two phases, then Ready", async () => {
  const { ONBOARDING_STEPS } = await loadState();
  assert.deepEqual(
    [...ONBOARDING_STEPS],
    ["welcome", "speech", "try", "cleanup", "shortcuts", "finish"]
  );
  const { ONBOARDING_PHASES, phaseOf } = await load();
  assert.deepEqual(
    ONBOARDING_PHASES.map((phase) => [phase.id, [...phase.steps]]),
    [
      ["dictate", ["welcome", "speech", "try"]],
      ["personalize", ["cleanup", "shortcuts"]],
    ]
  );
  assert.equal(phaseOf("try"), "dictate");
  assert.equal(phaseOf("cleanup"), "personalize");
  assert.equal(phaseOf("finish"), "ready");
});

test("next and previous follow the graph and stop at both ends", async () => {
  const { nextStep, previousStep } = await load();
  assert.equal(nextStep("speech"), "try");
  assert.equal(nextStep("try"), "cleanup");
  assert.equal(nextStep("finish"), null);
  assert.equal(previousStep("welcome"), null);
  assert.equal(previousStep("cleanup"), "try");
});

test("progress counts within the current phase only", async () => {
  const { phaseProgress } = await load();
  assert.deepEqual(phaseProgress("speech"), {
    phase: "dictate",
    steps: ["welcome", "speech", "try"],
    index: 1,
  });
  assert.deepEqual(phaseProgress("shortcuts"), {
    phase: "personalize",
    steps: ["cleanup", "shortcuts"],
    index: 1,
  });
  assert.equal(phaseProgress("finish"), null);
});

test("only visited steps other than the current one are navigable", async () => {
  const { canNavigateTo, markVisited } = await load();
  const visited = markVisited(markVisited(["welcome"], "speech"), "speech");
  assert.deepEqual(visited, ["welcome", "speech"]);
  assert.equal(canNavigateTo("welcome", "speech", visited), true);
  assert.equal(canNavigateTo("speech", "speech", visited), false);
  assert.equal(canNavigateTo("try", "speech", visited), false);
});
