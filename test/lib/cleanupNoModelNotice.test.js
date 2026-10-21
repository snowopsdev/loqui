const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createRendererServer, installBrowserGlobals } = require("./rendererTestHarness");

// Full-app M4: notices.cleanupFailed.noModel was never used. A cleanup step
// with no model (the translation chain's cleanup, or a captured Retry cleanup)
// surfaced main's raw English "No reasoning model selected" in the notice.
async function load(t) {
  installBrowserGlobals(t, { window: { electronAPI: {} } });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-cleanup-nomodel-" });
  return (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
}
const settingsView = { cleanupMode: "cloud", cleanupProvider: "openai", cleanupCloudBaseUrl: "" };

test("a cleanup with no model names the fix through the cleanup notice key", async (t) => {
  const service = await load(t);
  const error = await service
    .processText("words", "", null, { provider: "openai", settingsView })
    .then(
      () => null,
      (e) => e
    );
  assert.ok(error instanceof Error, "the request is refused before any call");
  assert.equal(error.messageKey, "notices.cleanupFailed.noModel");
  assert.equal(error.message, "No reasoning model selected", "logs keep the technical message");
});

test("other scopes keep their own copy: no cleanup key outside dictation cleanup", async (t) => {
  const service = await load(t);
  for (const inferenceScope of ["chatIntelligence", "noteFormatting", "dictationAgent"]) {
    const error = await service
      .processText("words", "", null, { provider: "openai", settingsView, inferenceScope })
      .then(
        () => null,
        (e) => e
      );
    assert.ok(error instanceof Error, inferenceScope);
    assert.equal(error.messageKey, undefined, inferenceScope);
  }
});

test("the three orphan keys are resolved in every locale", () => {
  const dir = path.join(__dirname, "../../src/locales");
  for (const locale of fs.readdirSync(dir).filter((d) => !d.includes("."))) {
    const copy = JSON.parse(fs.readFileSync(path.join(dir, locale, "translation.json"), "utf8"));
    assert.ok(copy.notices.cleanupFailed.noModel, `${locale}: noModel is kept, now wired`);
    assert.equal("moreActions" in copy.notices, false, `${locale}: notices.moreActions removed`);
    assert.equal("commitToTry" in copy.setupFlow.voice, false, `${locale}: commitToTry removed`);
  }
});
