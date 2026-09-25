const test = require("node:test");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

// Exercise the real SDK and the adapter resolved from Tinfoil's dependency tree.
// This checks their protocol boundary without creating a SecureClient, bypassing
// attestation, reading credentials, or sending a request to any provider.
async function setup({ stream = false } = {}) {
  const sdk = await import("ai");
  const tinfoilRequire = createRequire(require.resolve("tinfoil"));
  const { createOpenAICompatible } = await import(
    pathToFileURL(tinfoilRequire.resolve("@ai-sdk/openai-compatible")).href
  );
  const requests = [];
  const provider = createOpenAICompatible({
    name: "tinfoil",
    baseURL: "https://tinfoil.invalid/v1",
    apiKey: "offline-fixture",
    fetch: async (url, options) => {
      requests.push({ url: String(url), body: JSON.parse(options.body) });
      const body = stream
        ? [
            {
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: "Offline response" },
                  finish_reason: null,
                },
              ],
            },
            { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
          ]
            .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
            .join("") + "data: [DONE]\n\n"
        : JSON.stringify({
            id: "offline-response",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Offline response" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
          });
      return new Response(body, {
        headers: { "content-type": stream ? "text/event-stream" : "application/json" },
      });
    },
  });
  return { sdk, model: provider("offline-model"), requests };
}

for (const stream of [false, true]) {
  test(`Tinfoil's installed adapter supports SDK ${stream ? "streaming" : "generation"}`, async () => {
    const { sdk, model, requests } = await setup({ stream });
    const options = { model, prompt: "Hello", maxRetries: 0 };
    const result = stream ? sdk.streamText(options) : await sdk.generateText(options);
    assert.equal(await result.text, "Offline response");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://tinfoil.invalid/v1/chat/completions");
    assert.equal(requests[0].body.model, "offline-model");
    assert.equal(requests[0].body.stream === true, stream);
    assert.deepEqual(requests[0].body.messages, [{ role: "user", content: "Hello" }]);
  });
}
