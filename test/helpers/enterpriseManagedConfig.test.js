const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveManagedEnterpriseScope,
  validateManagedEnterpriseEnvelope,
} = require("../../src/helpers/enterpriseManagedConfig.mjs");

const scopes = {
  dictationCleanup: "model-a",
  dictationAgent: "model-a",
  noteFormatting: "model-a",
  chatIntelligence: "model-a",
  dictationTranslation: "model-a",
};

function provider(overrides = {}) {
  return {
    provider: "bedrock",
    mode: "managed_default",
    allowManualSetup: true,
    config: {
      roleArn: "arn:aws:iam::123456789012:role/OpenWhispr",
      region: "us-east-1",
      allowedModels: ["model-a"],
      scopeDefaults: scopes,
    },
    version: 1,
    updatedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function envelope(providers = [provider()]) {
  return {
    workspaceId: "workspace-a",
    version: 1,
    identity: {
      issuer: "https://api.example.com/enterprise-identity",
      jwksUri: "https://api.example.com/enterprise-identity/jwks.json",
      subject: "workspace:workspace-a",
      audiences: { bedrock: "sts.amazonaws.com", azure: "api://AzureADTokenExchange" },
    },
    providers,
  };
}

test("validates safe managed configuration and rejects unknown models", () => {
  assert.ok(validateManagedEnterpriseEnvelope(envelope(), "workspace-a"));
  const invalid = envelope([
    provider({
      config: {
        ...provider().config,
        scopeDefaults: { ...scopes, dictationCleanup: "not-allowed" },
      },
    }),
  ]);
  assert.equal(validateManagedEnterpriseEnvelope(invalid, "workspace-a"), null);
  assert.equal(
    validateManagedEnterpriseEnvelope(
      envelope([
        provider({
          config: {
            ...provider().config,
            scopeDefaults: { dictationCleanup: "model-a" },
          },
        }),
      ]),
      "workspace-a"
    ),
    null
  );
});

test("rejects unsafe cached cloud destinations and identity metadata", () => {
  const unsafeAzure = provider({
    provider: "azure",
    config: {
      tenantId: "11111111-1111-4111-8111-111111111111",
      clientId: "22222222-2222-4222-8222-222222222222",
      endpoint: "https://openai.azure.com.evil.example",
      apiVersion: "2025-01-01-preview",
      allowedDeployments: ["deployment-a"],
      scopeDefaults: Object.fromEntries(
        Object.keys(scopes).map((scope) => [scope, "deployment-a"])
      ),
    },
  });
  assert.equal(validateManagedEnterpriseEnvelope(envelope([unsafeAzure]), "workspace-a"), null);
  assert.equal(
    validateManagedEnterpriseEnvelope(
      { ...envelope(), identity: { ...envelope().identity, subject: "workspace:other" } },
      "workspace-a"
    ),
    null
  );
});

test("managed default preserves an explicit legacy manual setup", () => {
  assert.equal(
    resolveManagedEnterpriseScope(envelope(), "dictationCleanup", "manual").kind,
    "manual"
  );
  assert.deepEqual(resolveManagedEnterpriseScope(envelope(), "dictationCleanup", "auto"), {
    kind: "managed",
    provider: "bedrock",
    model: "model-a",
    mode: "managed_default",
    allowManualSetup: true,
    record: provider(),
  });
});

test("required managed access overrides manual setup", () => {
  const result = resolveManagedEnterpriseScope(
    envelope([provider({ mode: "managed_required", allowManualSetup: false })]),
    "chatIntelligence",
    "manual"
  );
  assert.equal(result.kind, "managed");
  assert.equal(result.model, "model-a");
});

test("ambiguous organization defaults fail with an administrator action", () => {
  const azure = provider({
    provider: "azure",
    config: {
      tenantId: "11111111-1111-4111-8111-111111111111",
      clientId: "22222222-2222-4222-8222-222222222222",
      endpoint: "https://example.openai.azure.com",
      apiVersion: "2024-10-21",
      allowedDeployments: ["deployment-a"],
      scopeDefaults: Object.fromEntries(
        Object.keys(scopes).map((scope) => [scope, "deployment-a"])
      ),
    },
  });
  const result = resolveManagedEnterpriseScope(
    envelope([provider(), azure]),
    "dictationCleanup",
    "auto"
  );
  assert.equal(result.kind, "error");
  assert.equal(result.code, "MANAGED_PROVIDER_AMBIGUOUS");
});
