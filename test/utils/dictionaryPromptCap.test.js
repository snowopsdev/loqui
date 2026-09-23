const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/utils/dictionaryPromptCap.js");

test("Groq prompt limits recognize the selected provider and an exact normalized hostname", async () => {
  const { dictionaryPromptLimit, GROQ_PROMPT_CHARS } = await load();
  assert.equal(dictionaryPromptLimit({ provider: "groq" }), GROQ_PROMPT_CHARS);
  for (const endpoint of [
    "https://api.groq.com/openai/v1/audio/transcriptions",
    "https://API.GROQ.COM/openai/v1",
    "https://api.groq.com:443/openai/v1",
  ]) {
    assert.equal(
      dictionaryPromptLimit({ provider: "custom", endpoint, model: "gpt-4o-transcribe" }),
      GROQ_PROMPT_CHARS,
      endpoint
    );
  }
});

test("Groq text in a URL path, query, userinfo, or different hostname does not reduce the model budget", async () => {
  const { dictionaryPromptLimit, TRANSCRIBE_PROMPT_CHARS, WHISPER_PROMPT_CHARS } = await load();
  for (const endpoint of [
    "https://example.test/api.groq.com/openai/v1",
    "https://example.test/v1?provider=api.groq.com",
    "https://example.test/v1#api.groq.com",
    "https://api.groq.com@example.test/v1",
    "https://api.groq.com.example.test/v1",
    "https://other-api.groq.com/v1",
    "https://api.groq.com./v1",
  ]) {
    assert.equal(
      dictionaryPromptLimit({ provider: "custom", endpoint, model: "gpt-4o-transcribe" }),
      TRANSCRIBE_PROMPT_CHARS,
      endpoint
    );
    assert.equal(
      dictionaryPromptLimit({ provider: "custom", endpoint, model: "whisper-1" }),
      WHISPER_PROMPT_CHARS,
      endpoint
    );
  }
});

test("malformed and local custom endpoints retain the existing fallback without throwing", async () => {
  const { dictionaryPromptLimit, TRANSCRIBE_PROMPT_CHARS, WHISPER_PROMPT_CHARS } = await load();
  assert.equal(dictionaryPromptLimit(), WHISPER_PROMPT_CHARS);
  for (const endpoint of [
    "",
    "not a URL",
    "api.groq.com/v1",
    "https://[",
    "http://localhost:1234/v1",
  ]) {
    assert.equal(
      dictionaryPromptLimit({ endpoint, model: "gpt-4o-mini-transcribe" }),
      TRANSCRIBE_PROMPT_CHARS
    );
    assert.equal(dictionaryPromptLimit({ endpoint, model: "custom-model" }), WHISPER_PROMPT_CHARS);
  }
});
