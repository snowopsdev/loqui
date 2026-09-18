const test = require("node:test");
const assert = require("node:assert/strict");
const { getEnterpriseAIModel } = require("../../src/helpers/enterpriseAiProviders");
test("manual Azure rejects unencrypted or credential-bearing endpoint URLs", async () => {
  for (const azureEndpoint of [
    "http://example.openai.azure.com",
    "https://user:password@example.openai.azure.com",
    "not a URL",
  ]) {
    await assert.rejects(getEnterpriseAIModel("azure", "model", "fixture-key", { azureEndpoint }));
  }
});
test("manual Azure needs an explicit API key and endpoint", async () => {
  await assert.rejects(
    getEnterpriseAIModel("azure", "model", "", {
      azureEndpoint: "https://example.openai.azure.com",
    }),
    /endpoint and API key/
  );
  await assert.rejects(
    getEnterpriseAIModel("azure", "model", "fixture-key", {}),
    /endpoint and API key/
  );
});
