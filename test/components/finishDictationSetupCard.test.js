const assert = require("node:assert/strict");
const test = require("node:test");
const { mountComponent } = require("../helpers/harness/mountComponent");
const progress = (step) =>
  JSON.stringify({
    version: 2,
    step,
    explored: true,
    completed: false,
    visited: ["welcome", step],
  });
for (const step of ["welcome", "speech", "try", "cleanup", "shortcuts", "finish"])
  test(`${step}: neutral per-step links and saved-step Resume`, async (t) => {
    const ui = await mountComponent(t, "/components/FinishDictationSetupCard.tsx", {
      storage: { "loqui.onboarding.progress": progress(step) },
    });
    const events = [];
    globalThis.window.dispatchEvent = (e) => events.push(e);
    const rows = ui.byAttr("data-row-step");
    assert.deepEqual(
      rows.map((n) => n.attributes["data-row-step"]),
      [...(["welcome", "speech", "try"].includes(step) ? [step] : []), "cleanup", "shortcuts"]
    );
    assert.equal(
      ui.byAttr("data-icon", "check").length + ui.byAttr("data-icon", "check-circle-2").length,
      0
    );
    assert.equal(
      ui.findAll((n) => /border-primary|bg-primary|text-primary/.test(n.attributes?.class ?? ""))
        .length,
      0
    );
    for (const row of rows) await ui.click(row);
    await ui.click("setupFlow.resume.resume");
    assert.deepEqual(
      events.map((e) => e.detail.step),
      [...rows.map((n) => n.attributes["data-row-step"]), step]
    );
    assert.equal(ui.byAttr("data-variant", "live").length, 0);
  });
for (const storage of [
  {},
  { "loqui.onboarding.progress": JSON.stringify({ version: 2, completed: true }) },
  {
    "loqui.onboarding.progress": progress("speech"),
    "loqui.onboarding.checklistDismissed": "true",
  },
])
  test("absent, completed or dismissed progress has no card", async (t) => {
    const ui = await mountComponent(t, "/components/FinishDictationSetupCard.tsx", { storage });
    assert.equal(ui.text(), "");
  });
test("preview dismissal/progress stays in its own namespace", async (t) => {
  const config = { step: "cleanup", scenario: "ready", platform: "linux" };
  const key = "loqui.onboarding.preview.linux.ready";
  const ui = await mountComponent(t, "/components/FinishDictationSetupCard.tsx", {
    windowProps: { loquiBrowserPreview: true, loquiBrowserPreviewConfig: config },
    storage: { [key]: progress("cleanup"), "loqui.onboarding.progress": progress("speech") },
  });
  assert.deepEqual(
    ui.byAttr("data-row-step").map((n) => n.attributes["data-row-step"]),
    ["cleanup", "shortcuts"]
  );
  await ui.click(ui.byAttr("aria-label", "setupFlow.resume.dismiss")[0]);
  assert.equal(ui.storage.getItem(`${key}.checklistDismissed`), "true");
  assert.equal(ui.storage.getItem("loqui.onboarding.checklistDismissed"), null);
  assert.equal(ui.storage.getItem("loqui.onboarding.progress"), progress("speech"));
  assert.equal(ui.text(), "");
});

test("a retained preview card reads each current namespace and a reset dismissal", async (t) => {
  const first = { step: "speech", scenario: "ready", platform: "linux" };
  const ui = await mountComponent(t, "/components/FinishDictationSetupCard.tsx", {
    windowProps: { loquiBrowserPreview: true, loquiBrowserPreviewConfig: first },
    storage: {
      "loqui.onboarding.preview.linux.ready": progress("speech"),
      "loqui.onboarding.preview.linux.multilingual": progress("cleanup"),
    },
  });
  await ui.click(ui.byAttr("aria-label", "setupFlow.resume.dismiss")[0]);
  assert.equal(ui.text(), "");
  globalThis.window.loquiBrowserPreviewConfig = { ...first, scenario: "multilingual" };
  await ui.rerender({});
  assert.deepEqual(
    ui.byAttr("data-row-step").map((n) => n.attributes["data-row-step"]),
    ["cleanup", "shortcuts"]
  );
  globalThis.window.loquiBrowserPreviewConfig = first;
  ui.storage.removeItem("loqui.onboarding.preview.linux.ready.checklistDismissed");
  await ui.rerender({});
  assert.equal(ui.byAttr("data-row-step").length, 3);
});
