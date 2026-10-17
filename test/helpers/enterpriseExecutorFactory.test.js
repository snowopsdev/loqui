const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { getEnterpriseAIModel } = require("../../src/helpers/enterpriseAiProviders");
const {
  resolveEnterpriseExecutor,
  resolveEnterpriseCredentialMaterial,
} = require("../../src/helpers/enterpriseRecipientIdentity");

test("actual enterprise wrapper gives SDKs only the explicit compared executor and separate credentials/fetch", async (t) => {
  const original = Module._load,
    calls = [];
  const sdk = (provider) => (options) => (model) => {
    calls.push({ provider, options, model });
    return { fixture: true };
  };
  Module._load = function (name, parent, isMain) {
    if (parent.filename.endsWith("enterpriseAiProviders.js")) {
      if (name === "@ai-sdk/azure") return { createAzure: sdk("azure") };
      if (name === "@ai-sdk/amazon-bedrock") return { createAmazonBedrock: sdk("bedrock") };
      if (name === "@ai-sdk/google-vertex") return { createVertex: sdk("vertex") };
      if (name === "@aws-sdk/credential-providers")
        return {
          fromNodeProviderChain:
            ({ profile }) =>
            async () => {
              assert.equal(profile, "fixture-profile");
              return { accessKeyId: "synthetic-id", secretAccessKey: "synthetic-secret" };
            },
        };
    }
    return original.call(this, name, parent, isMain);
  };
  t.after(() => {
    Module._load = original;
  });
  const fetchImpl = () => {
    throw new Error("Fixture forbids network");
  };
  const cases = [
    ["azure", { azureEndpoint: "https://azure.example/base", azureApiVersion: "2025-01-01" }, {}],
    [
      "bedrock",
      {
        bedrockRegion: "cn-northwest-1",
        bedrockAccessKeyId: "synthetic-id",
        bedrockSecretAccessKey: "synthetic-secret",
        bedrockSessionToken: "synthetic-token",
      },
      {},
    ],
    [
      "bedrock",
      { bedrockRegion: "eu-west-1", bedrockProfile: "fixture-profile" },
      { AWS_ENDPOINT_URL_BEDROCK_RUNTIME: "https://gateway.example/runtime" },
    ],
    [
      "vertex",
      { vertexProject: "fixture-project", vertexLocation: "europe-west4", vertexAuthSource: "adc" },
      {},
    ],
    [
      "vertex",
      { vertexProject: "", vertexLocation: "us-central1", vertexAuthSource: "apiKey" },
      { GOOGLE_VERTEX_API_KEY: "synthetic-legacy" },
    ],
  ];
  for (const [provider, config, env] of cases) {
    const identity = resolveEnterpriseExecutor(provider, config, env);
    const material = resolveEnterpriseCredentialMaterial(
      provider,
      config,
      provider === "vertex" ? "" : "synthetic-key",
      env
    );
    await getEnterpriseAIModel(
      provider,
      "fixture-model",
      "synthetic-key",
      identity.executor,
      material,
      fetchImpl
    );
    const { options } = calls.at(-1);
    assert.equal(options.fetch, fetchImpl);
    if (provider === "azure") {
      assert.equal(options.baseURL, identity.executor.endpoint);
      assert.equal(options.apiVersion, identity.executor.apiVersion);
    } else if (provider === "bedrock") {
      assert.equal(options.baseURL, identity.executor.endpointOverride);
      assert.equal(options.region, identity.executor.region);
      assert.ok(options.accessKeyId === "synthetic-id");
      assert.equal(options.apiKey, "");
      if (config.bedrockSessionToken) assert.ok(options.sessionToken === "synthetic-token");
    } else {
      assert.equal(options.project, identity.executor.project ?? undefined);
      assert.equal(options.location, identity.executor.location);
      assert.ok(options.apiKey === (config.vertexAuthSource === "adc" ? "" : "synthetic-legacy"));
    }
  }
});

test("installed Azure and Bedrock SDKs receive the frozen raw base with append-before-parse semantics", async () => {
  const prompt = [{ role: "user", content: [{ type: "text", text: "synthetic words" }] }];
  const cases = [
    [
      "https://gateway.example/team/..",
      "https://gateway.example/responses",
      "https://gateway.example/model/fixture/converse",
    ],
    [
      "https://gateway.example/team//",
      "https://gateway.example/team//responses",
      "https://gateway.example/team//model/fixture/converse",
    ],
    [
      "https://gateway.example/team?lane=one",
      "https://gateway.example/team?lane=one/responses",
      "https://gateway.example/team?lane=one/model/fixture/converse",
    ],
    [
      "https://gateway.example/team/.",
      "https://gateway.example/team/responses",
      "https://gateway.example/team/model/fixture/converse",
    ],
  ];
  for (const [raw, azureTarget, bedrockTarget] of cases) {
    for (const provider of ["azure", "bedrock"]) {
      const config = {
        azureEndpoint: raw,
        bedrockRegion: "us-east-1",
        bedrockAccessKeyId: "synthetic-id",
        bedrockSecretAccessKey: "synthetic-secret",
      };
      const env = { AWS_ENDPOINT_URL_BEDROCK_RUNTIME: raw };
      const identity = resolveEnterpriseExecutor(provider, config, env);
      assert.equal(identity.status, "ready");
      assert.equal(identity.executor[provider === "azure" ? "endpoint" : "endpointOverride"], raw);
      const material = resolveEnterpriseCredentialMaterial(provider, config, "synthetic-key", env);
      const received = [];
      const stop = new Error("fixture stops at SDK transport");
      const model = await getEnterpriseAIModel(
        provider,
        "fixture",
        "synthetic-key",
        identity.executor,
        material,
        async (url) => {
          received.push(String(url));
          throw stop;
        }
      );
      await assert.rejects(model.doGenerate({ prompt }), (error) => error === stop);
      assert.deepEqual(
        received.map((url) => new URL(url).href),
        [provider === "azure" ? azureTarget : bedrockTarget]
      );
      if (provider === "bedrock")
        assert.equal(
          received[0],
          raw.replace(/\/$/, "") + "/model/fixture/converse",
          "Bedrock passes its raw appended input to fetch; URL parsing happens at transport"
        );
    }
  }
});
