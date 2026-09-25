const test = require("node:test");
const assert = require("node:assert/strict");
const { installBrowserGlobals } = require("./rendererTestHarness");
test("native provider search is opt-in and restricted to supported assistant tasks", async (t) => {
  const { storage } = installBrowserGlobals(t);
  const { isProviderSearchEnabled } = await import("../../src/utils/providerSearch.ts");
  assert.equal(isProviderSearchEnabled("chatIntelligence", "openai", "providers"), false);
  storage.setItem("personalWebSearch:chatIntelligence", "true");
  for (const provider of ["openai", "anthropic", "gemini"])
    assert.equal(isProviderSearchEnabled("chatIntelligence", provider, "providers"), true);
  for (const provider of ["local", "codex", "custom", "groq"])
    assert.equal(isProviderSearchEnabled("chatIntelligence", provider, "providers"), false);
  for (const scope of ["dictationCleanup", "noteFormatting", "dictationTranslation"]) {
    storage.setItem(`personalWebSearch:${scope}`, "true");
    assert.equal(isProviderSearchEnabled(scope, "openai", "providers"), false);
  }
  assert.equal(isProviderSearchEnabled("dictationAgent", "openai", "providers"), false);
});
