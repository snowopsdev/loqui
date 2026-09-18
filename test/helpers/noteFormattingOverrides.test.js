const test = require("node:test");
const assert = require("node:assert/strict");
const load = () => import("../../src/helpers/noteFormattingOverrides.js");
test("self-hosted formatting pins its endpoint and task credential reference", async () => {
  const { buildNoteFormattingOverrides } = await load();
  const result = buildNoteFormattingOverrides({
    mode: "self-hosted",
    remoteUrl: "http://127.0.0.1:8080/v1",
    customApiKey: "never-forward",
  });
  assert.equal(result.provider, "lan");
  assert.equal(result.lanUrl, "http://127.0.0.1:8080/v1");
  assert.equal(result.credentialRef, "custom:noteFormatting");
  assert.equal(Object.hasOwn(result, "customApiKey"), false);
});
test("local and subscription formatting remain independent from cleanup settings", async () => {
  const { buildNoteFormattingOverrides } = await load();
  for (const [mode, provider] of [
    ["local", "local"],
    ["providers", "codex"],
    ["providers", "anthropic"],
  ]) {
    const result = buildNoteFormattingOverrides({ mode, provider, customApiKey: "never-forward" });
    assert.equal(result.provider, provider);
    assert.equal(result.inferenceScope, "noteFormatting");
    assert.equal(Object.hasOwn(result, "customApiKey"), false);
  }
});
test("custom formatting keeps its own endpoint and removed modes fail", async () => {
  const { buildNoteFormattingOverrides } = await load();
  const result = buildNoteFormattingOverrides({
    mode: "providers",
    provider: "custom",
    cloudBaseUrl: "https://example.invalid/v1",
  });
  assert.equal(result.baseUrl, "https://example.invalid/v1");
  assert.equal(result.credentialRef, "custom:noteFormatting");
  assert.throws(() => buildNoteFormattingOverrides({ mode: "openwhispr" }), /Choose a provider/);
});
