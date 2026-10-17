const assert = require("node:assert/strict");
const test = require("node:test");
const { mountComponent } = require("../helpers/harness/mountComponent");

const PREVIEW = { step: "speech", scenario: "ready", platform: "linux" };
const SETTINGS_PAGE = {
  "/SettingsPage": "export default function SettingsPage() { return null; }",
};

async function mountFlow(t, props = {}, options = {}) {
  const completed = [];
  const ui = await mountComponent(t, "/components/OnboardingFlow.tsx", {
    props: {
      onComplete: (opts) => completed.push(opts ?? null),
      previewConfig: PREVIEW,
      initialStep: "speech",
      ...props,
    },
    mocks: SETTINGS_PAGE,
    ...options,
  });
  return { ui, completed: () => completed };
}

const primary = (ui) => ui.byAttr("data-onb-primary")[0];
const buttonWithText = (ui, text) =>
  ui.findAll((node) => node.tagName === "BUTTON" && node.textContent.includes(text))[0];
const currentStep = (ui) =>
  ui.byAttr("aria-current", "step")[0]?.attributes["aria-label"] ?? "ready";

// The footer primary when there is one. Say something has none (its band owns the
// next step), so the walk skips it. Ready ends through its own Open workspace (Task 18).
async function advance(ui) {
  const target =
    primary(ui) ??
    buttonWithText(ui, "setupFlow.skipStep") ??
    buttonWithText(ui, "setupFlow.ready.openWorkspace");
  await ui.click(target);
}

test("Continue walks both phases and completes once without accounts or implicit downloads", async (t) => {
  const { ui, completed } = await mountFlow(t, { initialStep: "welcome" });
  const seen = [];
  for (let guard = 0; guard < 8 && completed().length === 0; guard++) {
    if (guard === 0) {
      assert.ok(ui.text().includes("Keep local history"));
      assert.ok(ui.text().includes("Download updates automatically"));
    }
    seen.push(currentStep(ui));
    await advance(ui);
  }
  assert.deepEqual(seen, [
    "setupFlow.progress.goTo(step=setupFlow.steps.welcome)",
    "setupFlow.progress.goTo(step=setupFlow.steps.speech)",
    "setupFlow.progress.goTo(step=setupFlow.steps.try)",
    "setupFlow.progress.goTo(step=setupFlow.steps.cleanup)",
    "setupFlow.progress.goTo(step=setupFlow.steps.shortcuts)",
    "ready",
  ]);
  assert.equal(completed().length, 1);
  const accountish = ui.calls.filter(([name]) => /auth|signIn|login|account|cloud/i.test(name));
  assert.deepEqual(
    ui.calls.filter(([name]) => /^(download|start.*Download)/i.test(name)),
    []
  );
  assert.deepEqual(
    accountish,
    [],
    "setup never touches accounts (restores the old personalWorkspace check)"
  );
});

test("Finish later exits from any step and remembers where you were", async (t) => {
  const { ui, completed } = await mountFlow(t, { initialStep: "cleanup" });
  await ui.click("setupFlow.finishLater");
  assert.equal(completed().length, 1);
  const stored = JSON.parse(ui.storage.getItem("loqui.onboarding.preview.linux.ready"));
  assert.deepEqual([stored.step, stored.explored, stored.visited], ["cleanup", true, ["cleanup"]]);
});

test("Back goes to the previous step in the new order", async (t) => {
  const { ui } = await mountFlow(t, { initialStep: "cleanup" });
  await ui.click("setupFlow.back");
  assert.equal(currentStep(ui), "setupFlow.progress.goTo(step=setupFlow.steps.try)");
});

test("production ignores the preview config global and stores its own visited steps", async (t) => {
  const { ui } = await mountFlow(
    t,
    { initialStep: undefined, previewConfig: undefined },
    {
      api: { getPlatform: () => "linux" },
      windowProps: {
        loquiBrowserPreviewConfig: { step: "finish", scenario: "ready", platform: "macos" },
      },
    }
  );
  assert.equal(currentStep(ui), "setupFlow.progress.goTo(step=setupFlow.steps.welcome)");
  await advance(ui);
  const stored = JSON.parse(ui.storage.getItem("loqui.onboarding.progress"));
  assert.deepEqual(stored.visited, ["welcome", "speech"]);
  assert.equal(ui.byAttr("data-platform")[0].attributes["data-platform"], "linux");
  assert.equal(ui.byAttr("data-onb-announcer").length, 0, "T14 owns announcements");
});
