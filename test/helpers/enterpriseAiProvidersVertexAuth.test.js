const assert = require("node:assert/strict");
const test = require("node:test");
const { getEnterpriseAIModel } = require("../../src/helpers/enterpriseAiProviders.js");

// Change-driving: use the installed SDK, fixture keys and a local fetch stub.
// ADC construction inspects its base URL without asking Google for a token.
test("change-driving: Vertex explicit source binds stored and legacy keys without ADC fallback", async (t) => {
  const names = ["GOOGLE_VERTEX_API_KEY", "GOOGLE_VERTEX_PROJECT", "GOOGLE_VERTEX_LOCATION"];
  const saved = new Map(names.map((name) => [name, process.env[name]]));
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.GOOGLE_VERTEX_API_KEY = "fixture-legacy-key";
  process.env.GOOGLE_VERTEX_PROJECT = "ignored-project";
  process.env.GOOGLE_VERTEX_LOCATION = "ignored-location";
  const requests = [];
  global.fetch = async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init.headers) });
    return new Response('{"error":{"message":"fixture"}}', {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  };
  const enterprise = {
    vertexProject: "fixture-project",
    vertexLocation: "europe-west4",
    vertexAuthSource: "apiKey",
  };
  for (const [stored, expected] of [
    ["fixture-stored-key", "fixture-stored-key"],
    ["", "fixture-legacy-key"],
  ]) {
    const model = await getEnterpriseAIModel("vertex", "gemini-2.5-flash", stored, enterprise);
    await assert.rejects(
      model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      })
    );
    const request = requests.at(-1);
    assert.equal(new URL(request.url).host, "aiplatform.googleapis.com");
    assert.equal(request.headers.get("x-goog-api-key"), expected);
  }
  const adc = await getEnterpriseAIModel("vertex", "gemini-2.5-flash", "fixture-stored-key", {
    ...enterprise,
    vertexAuthSource: "adc",
  });
  assert.equal(
    adc.config.baseURL,
    "https://europe-west4-aiplatform.googleapis.com/v1beta1/projects/fixture-project/locations/europe-west4/publishers/google"
  );
  assert.equal(requests.length, 2, "ADC construction makes no request");
  delete process.env.GOOGLE_VERTEX_API_KEY;
  await assert.rejects(
    getEnterpriseAIModel("vertex", "fixture-model", "", enterprise),
    /Configure a Vertex API key in Settings/
  );
  for (const source of [undefined, "unknown"]) {
    await assert.rejects(
      getEnterpriseAIModel("vertex", "fixture-model", "fixture-stored-key", {
        ...enterprise,
        vertexAuthSource: source,
      }),
      /Choose a supported Vertex authentication source/
    );
  }
  assert.equal(requests.length, 2, "refused configurations never dispatch");
});
