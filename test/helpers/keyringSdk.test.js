const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");
const { getEnterpriseAIModel } = require("../../src/helpers/enterpriseAiProviders");

// change-driving B1: invoke the real SDK with fixture fetch; no credential chain.
test("frozen Bedrock baseURL and credential source survive late ambient overrides", async (t) => {
  const originalFetch = globalThis.fetch;
  const variables = [
    "AWS_ENDPOINT_URL",
    "AWS_ENDPOINT_URL_BEDROCK_RUNTIME",
    "AWS_BEARER_TOKEN_BEDROCK",
  ];
  const prior = variables.map((key) => [key, process.env[key]]);
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const baseURL of [
    "https://accepted.example/tenant-a",
    "https://bedrock-runtime.eu-west-1.amazonaws.com",
  ]) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({
        url: String(url),
        headers: new Headers(init?.headers),
        redirect: init?.redirect,
      });
      return new Response('{"message":"fixture"}', { status: 400 });
    };
    const model = await getEnterpriseAIModel("bedrock", "fixture-model", "", {
      frozenCredentials: true,
      bedrockBaseURL: baseURL,
      bedrockRegion: "eu-west-1",
      bedrockAccessKeyId: "AKIAFIXTURE",
      bedrockSecretAccessKey: "fixture-secret",
    });
    process.env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME = "https://unreviewed.example";
    process.env.AWS_BEARER_TOKEN_BEDROCK = "fixture-unreviewed-bearer";
    await assert.rejects(
      model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }] })
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.startsWith(baseURL + "/"), true);
    assert.equal(calls[0].redirect, "error");
    assert.match(calls[0].headers.get("authorization"), /^AWS4-HMAC-SHA256 /);
  }
});

// change-driving B1: empty captured key cannot upgrade to a late legacy key.
test("frozen Vertex uses exactly the captured key and source", async (t) => {
  const prior = process.env.GOOGLE_VERTEX_API_KEY;
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (prior === undefined) delete process.env.GOOGLE_VERTEX_API_KEY;
    else process.env.GOOGLE_VERTEX_API_KEY = prior;
  });
  process.env.GOOGLE_VERTEX_API_KEY = "fixture-unreviewed";
  await assert.rejects(
    getEnterpriseAIModel("vertex", "fixture", "", {
      frozenCredentials: true,
      vertexAuthSource: "apiKey",
    })
  );
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), redirect: init?.redirect });
    return new Response("{}", { status: 400 });
  };
  const model = await getEnterpriseAIModel("vertex", "fixture", "fixture-authorized", {
    frozenCredentials: true,
    vertexAuthSource: "apiKey",
  });
  await assert.rejects(
    model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }] })
  );
  assert.equal(new URL(calls[0].url).host, "aiplatform.googleapis.com");
  assert.equal(calls[0].headers.get("x-goog-api-key"), "fixture-authorized");
  assert.equal(calls[0].redirect, "error");
  const adc = await getEnterpriseAIModel("vertex", "fixture", "fixture-authorized", {
    frozenCredentials: false,
    vertexAuthSource: "adc",
    vertexProject: "p",
    vertexLocation: "europe-west4",
  });
  assert.equal(new URL(adc.config.baseURL).host, "europe-west4-aiplatform.googleapis.com");
});

// change-driving B1: parse exactly once, freeze static profile, reject dynamic selectors.
test("frozen Bedrock static profile captures once and refuses all dynamic sources", async (t) => {
  const originalLoad = Module._load;
  const seen = [];
  let selected = { aws_access_key_id: "AKIAFIXTURE", aws_secret_access_key: "fixture-secret" };
  Module._load = function (request, parent, isMain) {
    if (request === "@smithy/core/config")
      return {
        parseKnownFiles: async (config) => {
          seen.push(config);
          return { accepted: selected };
        },
      };
    if (request === "@aws-sdk/credential-providers") throw new Error("unreviewed credential chain");
    return originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = originalLoad;
  });
  const input = {
    frozenCredentials: true,
    bedrockProfile: "accepted",
    bedrockRegion: "eu-west-1",
    bedrockBaseURL: "https://accepted.example",
    bedrockCredentialsFile: "/fixture/credentials",
    bedrockConfigFile: "/fixture/config",
  };
  await getEnterpriseAIModel("bedrock", "fixture", "", input);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].filepath, "/fixture/credentials");
  assert.equal(seen[0].configFilepath, "/fixture/config");
  for (const selector of [
    "credential_source",
    "source_profile",
    "role_arn",
    "credential_process",
    "sso_session",
    "sso_start_url",
    "login_session",
    "web_identity_token_file",
    "future_unknown_selector",
  ]) {
    selected = {
      aws_access_key_id: "AKIAFIXTURE",
      aws_secret_access_key: "fixture-secret",
      [selector]: "fixture",
    };
    await assert.rejects(getEnterpriseAIModel("bedrock", "fixture", "", input), {
      code: "UNSUPPORTED_AUTH_SOURCE",
    });
  }
});

// change-driving B1: ADC is resolved from one captured file, then the SDK uses
// only a frozen token client; no filesystem, ADC chain or auth network here.
test("frozen Vertex ADC snapshots supported files and cannot reread live ADC environment", async (t) => {
  const originalLoad = Module._load;
  const modelModule = require.resolve("../../src/helpers/enterpriseAiProviders");
  const originalFetch = globalThis.fetch;
  const reads = [];
  const credentials = [];
  let selected = {
    type: "authorized_user",
    client_id: "fixture-client",
    client_secret: "fixture-secret",
    refresh_token: "fixture-refresh",
  };
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === modelModule && request === "node:fs/promises")
      return {
        readFile: async (file) => {
          reads.push(file);
          return JSON.stringify(selected);
        },
      };
    if (parent?.filename === modelModule && request === "google-auth-library")
      return {
        GoogleAuth: class {
          constructor(options) {
            credentials.push(options.credentials);
          }
          async getAccessToken() {
            return "fixture-frozen-token";
          }
        },
      };
    return originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = originalLoad;
    globalThis.fetch = originalFetch;
  });
  const input = {
    frozenCredentials: true,
    vertexAuthSource: "adc",
    vertexProject: "fixture-project",
    vertexLocation: "europe-west4",
    vertexAdcFile: "/fixture/accepted.json",
  };
  const model = await getEnterpriseAIModel("vertex", "fixture-model", "", input);
  assert.deepEqual(reads, ["/fixture/accepted.json"]);
  assert.equal(credentials[0].client_id, "fixture-client");
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({
      host: new URL(String(url)).host,
      headers: new Headers(init?.headers),
      redirect: init?.redirect,
    });
    return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
  };
  await assert.rejects(
    model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }] })
  );
  assert.equal(calls.length, 1, "only the Vertex SDK request, no ADC token request");
  assert.equal(calls[0].host, "europe-west4-aiplatform.googleapis.com");
  assert.equal(calls[0].headers.get("authorization"), "Bearer fixture-frozen-token");
  // baseline guard added after the initial ADC RED: service accounts use the
  // same frozen token adapter; fixture resolver never signs or reads a file.
  selected = {
    type: "service_account",
    client_email: "fixture@example.invalid",
    private_key: "fixture-private-key",
  };
  await getEnterpriseAIModel("vertex", "fixture-model", "", input);
  assert.equal(credentials.at(-1).client_email, "fixture@example.invalid");
  for (const type of [
    "external_account",
    "impersonated_service_account",
    "external_account_authorized_user",
    "future_unknown",
  ]) {
    selected = { type };
    await assert.rejects(getEnterpriseAIModel("vertex", "fixture", "", input), {
      code: "UNSUPPORTED_AUTH_SOURCE",
    });
  }
});

// change-driving: real GoogleAuth -> real Gaxios -> fixture fetch must carry
// redirect:error; constructor assertion prevents any unprotected RED network.
test("frozen ADC token exchange and Vertex SDK both refuse redirects", async (t) => {
  const { GoogleAuth } = require("google-auth-library");
  const originalLoad = Module._load;
  const modelModule = require.resolve("../../src/helpers/enterpriseAiProviders");
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(init.redirect, "error");
    calls.push(new URL(String(url)).host);
    if (calls.length === 1)
      return new Response(
        '{"access_token":"fixture-frozen-oauth-token","expires_in":3600,"token_type":"Bearer"}',
        { status: 200, headers: { "content-type": "application/json" } }
      );
    return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
  };
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === modelModule && request === "node:fs/promises")
      return {
        readFile: async () =>
          JSON.stringify({
            type: "authorized_user",
            client_id: "fixture-client",
            client_secret: "fixture-secret",
            refresh_token: "fixture-refresh",
          }),
      };
    if (parent?.filename === modelModule && request === "google-auth-library")
      return {
        GoogleAuth: class extends GoogleAuth {
          constructor(options) {
            assert.equal(
              typeof options.clientOptions?.transporterOptions?.fetchImplementation,
              "function",
              "RED fails before any default auth transport"
            );
            super(options);
          }
        },
      };
    return originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = originalLoad;
    globalThis.fetch = originalFetch;
  });
  const model = await getEnterpriseAIModel("vertex", "fixture-model", "", {
    frozenCredentials: true,
    vertexAuthSource: "adc",
    vertexAdcFile: "/fixture/oauth.json",
    vertexProject: "fixture-project",
    vertexLocation: "global",
  });
  await assert.rejects(
    model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }] })
  );
  assert.deepEqual(calls, ["oauth2.googleapis.com", "aiplatform.googleapis.com"]);
});
