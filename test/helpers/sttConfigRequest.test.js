const test = require("node:test");
const assert = require("node:assert/strict");

const { createSttConfigRequestHandler } = require("../../src/helpers/sttConfigRequest");

test("the STT config handler preserves policy and upgrade response metadata", async () => {
  const handler = createSttConfigRequestHandler({
    getApiUrl: () => "https://api.openwhispr.test",
    getAuthHeader: async () => ({ Authorization: "Bearer token-a" }),
    proxyFetch: async (_url, options) => {
      assert.equal(options.headers["x-openwhispr-policy-version"], "1");
      return new Response(
        JSON.stringify({
          error: "Update required",
          code: "UPGRADE_REQUIRED",
          data: { minAppVersion: "2.0.0" },
        }),
        { status: 426 }
      );
    },
    withPolicyHeaders: (headers) => ({ ...headers, "x-openwhispr-policy-version": "1" }),
    logger: { error() {} },
  });

  assert.deepEqual(await handler({ sender: {} }), {
    success: false,
    error: "Update required",
    code: "UPGRADE_REQUIRED",
    status: 426,
    minAppVersion: "2.0.0",
    details: { minAppVersion: "2.0.0" },
  });
});

test("the STT config handler keeps successful and legacy auth results compatible", async () => {
  const responses = [
    new Response(JSON.stringify({ dictation: { mode: "streaming" } }), { status: 200 }),
    new Response("{}", { status: 401 }),
  ];
  const handler = createSttConfigRequestHandler({
    getApiUrl: () => "https://api.openwhispr.test",
    getAuthHeader: async () => ({ Authorization: "Bearer token-a" }),
    proxyFetch: async () => responses.shift(),
    withPolicyHeaders: (headers) => headers,
    logger: { error() {} },
  });

  assert.deepEqual(await handler({ sender: {} }), {
    success: true,
    dictation: { mode: "streaming" },
  });
  assert.deepEqual(await handler({ sender: {} }), {
    success: false,
    error: "Session expired",
    code: "AUTH_EXPIRED",
    status: 401,
  });
});
