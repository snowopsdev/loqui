const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/helpers/llmRequestTimeout.js");

test("uses the configured value when it's within range", async () => {
  const { resolveLlmRequestTimeoutSeconds } = await load();
  assert.equal(resolveLlmRequestTimeoutSeconds(90), 90);
});

test("falls back to the 30s default when unset or invalid", async () => {
  const { resolveLlmRequestTimeoutSeconds } = await load();
  assert.equal(resolveLlmRequestTimeoutSeconds(undefined), 30);
  assert.equal(resolveLlmRequestTimeoutSeconds(NaN), 30);
});

test("clamps below the 10s floor", async () => {
  const { resolveLlmRequestTimeoutSeconds } = await load();
  assert.equal(resolveLlmRequestTimeoutSeconds(1), 10);
});

test("clamps above the 600s ceiling", async () => {
  const { resolveLlmRequestTimeoutSeconds } = await load();
  assert.equal(resolveLlmRequestTimeoutSeconds(9999), 600);
});
