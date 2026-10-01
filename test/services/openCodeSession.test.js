const test = require("node:test");
const assert = require("node:assert/strict");

const loadSession = () => require("../../src/helpers/openCodeSession");
const loadProviders = async () => ({
  getAIModel: require("../../src/helpers/personalInference").createModel,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("openCodeSessionHeaders recognises OpenCode hosts and nothing else", () => {
  const { openCodeSessionHeaders } = loadSession();
  const hasSession = (baseUrl) => "x-opencode-session" in openCodeSessionHeaders(baseUrl);

  assert.equal(hasSession("https://opencode.ai/zen/go/v1"), true);
  assert.equal(hasSession("https://api.opencode.ai/zen/go/v1"), true);
  assert.equal(hasSession("HTTPS://OpenCode.AI/zen/go/v1"), true);

  // A lookalike host must not borrow the header (and the session id with it).
  assert.equal(hasSession("https://opencode.ai.evil.com/v1"), false);
  assert.equal(hasSession("https://notopencode.ai/v1"), false);
  assert.equal(hasSession("https://api.openai.com/v1"), false);
  assert.equal(hasSession("not a url"), false);
  assert.equal(hasSession(""), false);
  assert.equal(hasSession(null), false);
  assert.equal(hasSession(undefined), false);
});

test("openCodeSessionHeaders mints one id per call and stays empty elsewhere", () => {
  const { openCodeSessionHeaders } = loadSession();

  assert.deepEqual(openCodeSessionHeaders("https://api.openai.com/v1"), {});
  assert.deepEqual(openCodeSessionHeaders(undefined), {});

  const first = openCodeSessionHeaders("https://opencode.ai/zen/go/v1");
  const second = openCodeSessionHeaders("https://opencode.ai/zen/go/v1");
  assert.match(first["x-opencode-session"], UUID_RE);
  // Separate units of work are separate conversations.
  assert.notEqual(first["x-opencode-session"], second["x-opencode-session"]);
});

/** Drains an AI SDK stream and returns the headers the transport actually sent. */
async function captureChatHeaders(t, baseUrl) {
  const { getAIModel } = await loadProviders();
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let sent = null;
  globalThis.fetch = async (input, init = {}) => {
    sent = init.headers || {};
    const chunk = (delta, finishReason = null) =>
      `data: ${JSON.stringify({
        id: "chatcmpl-opencode-session-test",
        object: "chat.completion.chunk",
        created: 1,
        model: "kimi-k2.5",
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`;
    return new Response(`${chunk({ content: "ok" })}${chunk({}, "stop")}data: [DONE]\n\n`, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };

  const model = await getAIModel("custom", "kimi-k2.5", "test-key", baseUrl);
  const { stream } = await model.doStream({
    prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  });
  for await (const _part of stream) {
    // Drain so the request completes.
  }
  return sent;
}

test("the chat transport sends a session id to OpenCode Go", async (t) => {
  const sent = await captureChatHeaders(t, "https://opencode.ai/zen/go/v1");
  assert.match(sent["x-opencode-session"], UUID_RE);
});

test("the chat transport sends no session id to other custom endpoints", async (t) => {
  const sent = await captureChatHeaders(t, "https://responses-only.example/v1");
  assert.equal("x-opencode-session" in sent, false);
});
