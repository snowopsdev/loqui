const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createEnterpriseIdentityManager,
} = require("../../src/helpers/enterpriseIdentityManager.js");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const accountId = "account-a";

function managedConfig() {
  const defaults = {
    dictationCleanup: "deployment-a",
    dictationAgent: "deployment-a",
    noteFormatting: "deployment-a",
    chatIntelligence: "deployment-a",
    dictationTranslation: "deployment-a",
  };
  return {
    workspaceId,
    version: 1,
    identity: {
      issuer: "https://api.example.com/enterprise-identity",
      jwksUri: "https://api.example.com/enterprise-identity/jwks.json",
      subject: `workspace:${workspaceId}`,
      audiences: { bedrock: "sts.amazonaws.com", azure: "api://AzureADTokenExchange" },
    },
    providers: [
      {
        provider: "azure",
        mode: "managed_default",
        allowManualSetup: true,
        config: {
          tenantId: "22222222-2222-4222-8222-222222222222",
          clientId: "33333333-3333-4333-8333-333333333333",
          endpoint: "https://example.openai.azure.com",
          apiVersion: "2024-10-21",
          allowedDeployments: ["deployment-a"],
          scopeDefaults: defaults,
        },
        version: 1,
        updatedAt: "2026-08-10T00:00:00.000Z",
      },
    ],
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function request(overrides = {}) {
  return {
    accountId,
    workspaceId,
    expectedAuthGeneration: 4,
    authHeaders: { Authorization: "Bearer openwhispr-session" },
    inferenceScope: "dictationCleanup",
    setupMode: "auto",
    ...overrides,
  };
}

test("deduplicates config and Azure token refreshes while keeping cloud tokens out of config", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-enterprise-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const calls = { config: 0, assertion: 0, azure: 0 };
  const proxyFetch = async (url) => {
    if (url.includes("/enterprise-providers/azure/assertion")) {
      calls.assertion += 1;
      return jsonResponse({ data: { assertion: "signed-openwhispr-assertion" } });
    }
    if (url.startsWith("https://login.microsoftonline.com/")) {
      calls.azure += 1;
      return jsonResponse({ access_token: "azure-bearer-token", expires_in: 3600 });
    }
    calls.config += 1;
    return jsonResponse({ data: managedConfig() });
  };
  const tokenState = { token: "openwhispr-session", generation: 4 };
  const manager = createEnterpriseIdentityManager({
    cachePath: path.join(tempDir, "config.json"),
    getApiUrl: () => "https://api.example.com",
    getAppVersion: () => "1.8.1",
    proxyFetch,
    tokenStore: { getState: () => tokenState },
  });

  const [left, right] = await Promise.all([
    manager.getConfig(request()),
    manager.getConfig(request()),
  ]);
  assert.equal(left.success, true);
  assert.equal(right.success, true);
  assert.equal(calls.config, 1);
  assert.equal(JSON.stringify(left).includes("azure-bearer-token"), false);
  assert.equal(JSON.stringify(left).includes("signed-openwhispr-assertion"), false);

  const runtime = await manager.resolveProvider(request());
  assert.equal(runtime.managed, true);
  assert.equal(runtime.provider, "azure");
  assert.equal(runtime.model, "deployment-a");
  assert.equal(await runtime.tokenProvider(), "azure-bearer-token");
  assert.equal(await runtime.tokenProvider(), "azure-bearer-token");
  assert.deepEqual(calls, { config: 1, assertion: 1, azure: 1 });
});

test("rejects stale auth generations before making a request", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-enterprise-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  let called = false;
  const manager = createEnterpriseIdentityManager({
    cachePath: path.join(tempDir, "config.json"),
    getApiUrl: () => "https://api.example.com",
    getAppVersion: () => "1.8.1",
    proxyFetch: async () => {
      called = true;
      return jsonResponse({ data: managedConfig() });
    },
    tokenStore: { getState: () => ({ token: "session", generation: 5 }) },
  });

  const result = await manager.getConfig(request());
  assert.equal(result.success, false);
  assert.equal(result.code, "AUTH_CONTEXT_CHANGED");
  assert.equal(called, false);
});

test("Bedrock exchanges the workspace assertion for short-lived web identity credentials", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-enterprise-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const config = managedConfig();
  config.providers = [
    {
      provider: "bedrock",
      mode: "managed_required",
      allowManualSetup: false,
      config: {
        roleArn: "arn:aws:iam::123456789012:role/OpenWhispr",
        region: "us-west-2",
        allowedModels: ["model-a"],
        scopeDefaults: Object.fromEntries(
          Object.keys(config.providers[0].config.scopeDefaults).map((scope) => [scope, "model-a"])
        ),
      },
      version: 2,
      updatedAt: "2026-08-10T00:00:00.000Z",
    },
  ];
  let providerInit;
  let providerCalls = 0;
  const manager = createEnterpriseIdentityManager({
    cachePath: path.join(tempDir, "config.json"),
    getApiUrl: () => "https://api.example.com",
    getAppVersion: () => "1.8.1",
    proxyFetch: async (url) =>
      url.includes("/assertion")
        ? jsonResponse({ data: { assertion: "workspace-assertion" } })
        : jsonResponse({ data: config }),
    tokenStore: {
      getState: () => ({ token: "openwhispr-session", generation: 4 }),
    },
    createAwsWebIdentityProvider: (init) => {
      providerInit = init;
      return async () => {
        providerCalls += 1;
        return {
          accessKeyId: "temporary-access-key",
          secretAccessKey: "temporary-secret",
          sessionToken: "temporary-session",
          expiration: new Date(Date.now() + 15 * 60 * 1000),
        };
      };
    },
  });

  const runtime = await manager.resolveProvider(request({ setupMode: "manual" }));
  const first = await runtime.credentialProvider();
  const second = await runtime.credentialProvider();
  assert.equal(first.accessKeyId, "temporary-access-key");
  assert.equal(second.accessKeyId, "temporary-access-key");
  assert.equal(providerCalls, 1);
  assert.deepEqual(providerInit, {
    roleArn: "arn:aws:iam::123456789012:role/OpenWhispr",
    roleSessionName: `openwhispr-${workspaceId.slice(0, 8)}`,
    webIdentityToken: "workspace-assertion",
    durationSeconds: 900,
    clientConfig: { region: "us-west-2" },
  });
});
