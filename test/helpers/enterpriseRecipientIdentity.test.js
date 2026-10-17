const test = require("node:test");
const assert = require("node:assert/strict");
test("enterprise recipient identity follows Plan 03 auth enums and effective SDK inputs", () => {
  const {
    captureEnterpriseEnvironment,
    resolveEnterpriseCredentialMaterial,
    resolveEnterpriseExecutor,
  } = require("../../src/helpers/enterpriseRecipientIdentity");
  const vertexApiKey = resolveEnterpriseExecutor(
    "vertex",
    {
      vertexProject: "",
      vertexLocation: "europe-west4",
      vertexAuthSource: "apiKey",
    },
    { GOOGLE_VERTEX_API_KEY: "ambient-key", GOOGLE_VERTEX_PROJECT: "ignored-project" }
  );
  assert.equal(vertexApiKey.status, "ready", "apiKey express mode does not require project");
  assert.equal(vertexApiKey.executor.authSource, "apiKey");
  assert.equal(vertexApiKey.executor.project, null);
  assert.equal(vertexApiKey.executor.location, "europe-west4");
  const envOnlyVertexKey = resolveEnterpriseCredentialMaterial(
    "vertex",
    {
      vertexAuthSource: "apiKey",
    },
    "",
    captureEnterpriseEnvironment("vertex", { GOOGLE_VERTEX_API_KEY: "legacy-env-key" })
  );
  assert.ok(
    envOnlyVertexKey.vertexApiKey === "legacy-env-key",
    "captured legacy key supports an environment-only API-key setup"
  );
  const storedVertexKey = resolveEnterpriseCredentialMaterial(
    "vertex",
    {
      vertexAuthSource: "apiKey",
    },
    "stored-vertex-key",
    captureEnterpriseEnvironment("vertex", { GOOGLE_VERTEX_API_KEY: "legacy-env-key" })
  );
  assert.ok(
    storedVertexKey.vertexApiKey === "stored-vertex-key",
    "the stored VERTEX_API_KEY wins over its legacy environment fallback"
  );
  const adcVertex = resolveEnterpriseCredentialMaterial(
    "vertex",
    {
      vertexAuthSource: "adc",
    },
    "stored-vertex-key",
    captureEnterpriseEnvironment("vertex", { GOOGLE_VERTEX_API_KEY: "legacy-env-key" })
  );
  assert.equal(adcVertex.vertexApiKey, "", "ADC suppresses both API-key sources");
  assert.equal(
    resolveEnterpriseExecutor(
      "vertex",
      {
        vertexProject: "",
        vertexLocation: "europe-west4",
        vertexAuthSource: "adc",
      },
      { GOOGLE_VERTEX_PROJECT: "ignored-project" }
    ).status,
    "unknown",
    "ADC requires the committed project"
  );
  assert.equal(
    resolveEnterpriseExecutor(
      "vertex",
      {
        vertexProject: "acme-prod",
        vertexLocation: "europe-west4",
        vertexAuthSource: "api-key",
      },
      {}
    ).status,
    "unknown",
    "do not translate or infer auth-source spellings"
  );

  const bedrockProfile = resolveEnterpriseExecutor(
    "bedrock",
    {
      bedrockRegion: "eu-west-1",
      bedrockProfile: "team-profile",
    },
    { AWS_ENDPOINT_URL_BEDROCK_RUNTIME: "https://gateway.example:8443/bedrock/runtime" }
  );
  assert.equal(bedrockProfile.status, "ready");
  assert.equal(bedrockProfile.executor.authSource, "profile");
  assert.equal(bedrockProfile.executor.profile, "team-profile");
  assert.equal(
    bedrockProfile.executor.endpointOverride,
    "https://gateway.example:8443/bedrock/runtime"
  );
  assert.notEqual(
    bedrockProfile.tag,
    resolveEnterpriseExecutor(
      "bedrock",
      {
        bedrockRegion: "eu-west-1",
        bedrockProfile: "team-profile",
      },
      { AWS_ENDPOINT_URL_BEDROCK_RUNTIME: "https://gateway.example:8443/bedrock/other" }
    ).tag
  );
  const defaultBedrock = resolveEnterpriseExecutor(
    "bedrock",
    { bedrockRegion: "cn-northwest-1" },
    {}
  );
  assert.equal(
    defaultBedrock.executor.endpointOverride,
    "https://bedrock-runtime.cn-northwest-1.amazonaws.com.cn"
  );
  const emptyRuntimeOverride = resolveEnterpriseExecutor(
    "bedrock",
    { bedrockRegion: "eu-west-1" },
    {
      AWS_ENDPOINT_URL_BEDROCK_RUNTIME: "",
      AWS_ENDPOINT_URL: "https://must-not-win.example",
    }
  );
  assert.equal(
    emptyRuntimeOverride.status,
    "unknown",
    "an empty runtime-specific override wins and is unusable"
  );

  const azureV1 = resolveEnterpriseExecutor(
    "azure",
    {
      azureEndpoint: "https://azure.example/openai",
      azureApiVersion: "2024-10-21",
    },
    {}
  );
  const azureV2 = resolveEnterpriseExecutor(
    "azure",
    {
      azureEndpoint: "https://azure.example/openai",
      azureApiVersion: "2025-01-01",
    },
    {}
  );
  assert.notEqual(azureV1.tag, azureV2.tag);
  const vertexChangedLocation = resolveEnterpriseExecutor(
    "vertex",
    {
      vertexProject: "acme-prod",
      vertexLocation: "us-central1",
      vertexAuthSource: "apiKey",
    },
    {}
  );
  assert.notEqual(vertexApiKey.tag, vertexChangedLocation.tag);

  const staticA = resolveEnterpriseExecutor(
    "bedrock",
    {
      bedrockRegion: "us-west-2",
      bedrockAccessKeyId: "old-id",
      bedrockSecretAccessKey: "old-secret",
    },
    {}
  );
  const staticB = resolveEnterpriseExecutor(
    "bedrock",
    {
      bedrockRegion: "us-west-2",
      bedrockAccessKeyId: "rotated-id",
      bedrockSecretAccessKey: "rotated-secret",
    },
    {}
  );
  const staticSessionA = resolveEnterpriseExecutor(
    "bedrock",
    {
      bedrockRegion: "us-west-2",
      bedrockAccessKeyId: "same-id",
      bedrockSecretAccessKey: "same-secret",
      bedrockSessionToken: "fixture-session-a",
    },
    {}
  );
  const staticSessionB = resolveEnterpriseExecutor(
    "bedrock",
    {
      bedrockRegion: "us-west-2",
      bedrockAccessKeyId: "same-id",
      bedrockSecretAccessKey: "same-secret",
      bedrockSessionToken: "fixture-session-b",
    },
    {}
  );
  const staticSessionMaterial = resolveEnterpriseCredentialMaterial("bedrock", {
    bedrockAccessKeyId: "same-id",
    bedrockSecretAccessKey: "same-secret",
    bedrockSessionToken: "fixture-session-a",
  });
  assert.equal(staticA.status, "ready");
  assert.equal(staticA.executor.authSource, "static");
  assert.equal(staticA.tag, staticB.tag, "credential rotation does not change the recipient tag");
  assert.ok(
    staticSessionMaterial.sessionToken === "fixture-session-a",
    "Bedrock STS session token is forwarded as credential material"
  );
  assert.equal(
    staticSessionA.tag,
    staticSessionB.tag,
    "STS token rotation does not change the recipient tag"
  );
  assert.ok(
    !staticSessionA.tag.includes("fixture-session-a"),
    "STS token is excluded from the recipient tag"
  );
  assert.notEqual(
    staticA.tag,
    resolveEnterpriseExecutor(
      "bedrock",
      {
        bedrockRegion: "us-west-2",
        bedrockProfile: "other-profile",
      },
      {}
    ).tag
  );
  assert(!staticA.tag.includes("us-west-2"));
  assert(!staticA.tag.includes("old-id"));
  assert(!bedrockProfile.tag.includes("gateway.example"));
});
