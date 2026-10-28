const test = require("node:test");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { createModel } = require("../../src/helpers/personalInference");

// The SDK's default logger emits each deprecation once per process, so later
// cases would see nothing. A custom logger receives every call's warnings.
function expectLegacyImageWarning(t, legacy = true) {
  const warnings = [];
  const previous = globalThis.AI_SDK_LOG_WARNINGS;
  globalThis.AI_SDK_LOG_WARNINGS = ({ warnings: logged }) => warnings.push(...logged);
  t.after(() => {
    globalThis.AI_SDK_LOG_WARNINGS = previous;
    if (!legacy) {
      assert.deepEqual(warnings, [], "modern file content emits no legacy warning");
      return;
    }
    assert.deepEqual(
      warnings,
      [
        {
          type: "deprecated",
          setting: '"image" content part',
          message:
            "The \"image\" content part type is deprecated. Use a \"file\" part with mediaType: 'image' (or a more specific image/* subtype) instead.",
        },
      ],
      "exactly one supported legacy image conversion warning"
    );
  });
}

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hGAAAAAASUVORK5CYII=";
const pngUrl = `data:image/png;base64,${pngBase64}`;

const imageCases = [
  {
    provider: "openai",
    model: "gpt-4.1-mini",
    image: (body) => body.input[0].content[1].image_url,
    expected: pngUrl,
  },
  {
    provider: "custom",
    model: "fixture",
    baseUrl: "https://fixture.invalid/v1",
    image: (body) => body.messages[0].content[1].image_url.url,
    expected: pngUrl,
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    image: (body) => body.messages[0].content[1].source.data,
    expected: pngBase64,
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
    image: (body) => body.contents[0].parts[1].inlineData.data,
    expected: pngBase64,
  },
  {
    provider: "vertex",
    model: "gemini-2.5-flash",
    // This serialization fixture supplies an API key and must select that source explicitly.
    enterprise: { vertexAuthSource: "apiKey" },
    image: (body) => body.contents[0].parts[1].inlineData.data,
    expected: pngBase64,
  },
  {
    provider: "groq",
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    image: (body) => body.messages[0].content[1].image_url.url,
    expected: pngUrl,
  },
  {
    provider: "azure",
    model: "fixture",
    enterprise: { azureEndpoint: "https://fixture.invalid/openai" },
    image: (body) => body.input[0].content[1].image_url,
    expected: pngUrl,
  },
  {
    provider: "bedrock",
    model: "anthropic.claude-3-sonnet-20240229-v1:0",
    enterprise: {
      bedrockRegion: "us-east-1",
      bedrockAccessKeyId: "fixture-access-key",
      bedrockSecretAccessKey: "fixture-secret-key",
    },
    image: (body) => body.messages[0].content[1].image.source.bytes,
    expected: pngBase64,
  },
];

// AI SDK 7 can accept an older model's specificationVersion while silently
// passing it incompatible file data. Test the real adapters' HTTP bodies:
// checking only model discovery, text generation, or a mock model misses this.
for (const scenario of imageCases)
  for (const contentType of ["file", "image"]) {
    test(`${scenario.provider} preserves ${contentType} screenshot bytes through the SDK and application model factory`, async (t) => {
      expectLegacyImageWarning(t, contentType === "image");
      const { generateText } = await import("ai");
      const bodies = [];
      t.mock.method(globalThis, "fetch", async (input, init) => {
        const body = init?.body ?? (input instanceof Request ? await input.text() : undefined);
        assert.equal(typeof body, "string");
        bodies.push(JSON.parse(body));
        // Stop at serialization: no provider credentials or network are needed.
        return new Response(JSON.stringify({ error: { message: "Fixture transport stopped" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      });
      const model = await createModel(
        scenario.provider,
        scenario.model,
        "fixture-api-key",
        scenario.baseUrl,
        false,
        scenario.enterprise
      );
      await assert.rejects(
        generateText({
          model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Describe this screenshot." },
                // Exercise the installed SDK file-part protocol with identical screenshot bytes.
                contentType === "image"
                  ? { type: "image", image: pngUrl }
                  : { type: "file", data: pngUrl, mediaType: "image/png" },
              ],
            },
          ],
          maxRetries: 0,
        }),
        { name: "AI_APICallError" }
      );
      assert.equal(bodies.length, 1, "the selected provider is called once without fallback");
      assert.equal(scenario.image(bodies[0]), scenario.expected);
    });
  }

test("Tinfoil's resolved adapter supports the installed SDK message protocol", async (t) => {
  expectLegacyImageWarning(t);
  const { generateText } = await import("ai");
  // Resolve the exact adapter used by Tinfoil, including a nested dependency.
  // This checks SDK compatibility only. SecureClient's enclave attestation is
  // neither invoked nor bypassed; live verification requires its own smoke test.
  const requireFromTinfoil = createRequire(require.resolve("tinfoil"));
  const { createOpenAICompatible } = requireFromTinfoil("@ai-sdk/openai-compatible");
  let body;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        id: "fixture",
        object: "chat.completion",
        created: 0,
        model: "fixture",
        choices: [
          { index: 0, message: { role: "assistant", content: "Ready." }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { headers: { "content-type": "application/json" } }
    );
  });
  const model = createOpenAICompatible({
    name: "tinfoil",
    baseURL: "https://fixture.invalid/v1",
    apiKey: "fixture-api-key",
  })("fixture");
  const result = await generateText({
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Check compatibility." },
          { type: "image", image: pngUrl },
        ],
      },
    ],
    maxRetries: 0,
  });
  assert.deepEqual(body.messages[0].content[0], { type: "text", text: "Check compatibility." });
  assert.equal(body.messages[0].content[1].image_url.url, pngUrl);
  assert.equal(result.text, "Ready.");
});
