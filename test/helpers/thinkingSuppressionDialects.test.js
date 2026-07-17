const test = require("node:test");
const assert = require("node:assert/strict");

// Requires Node's native TypeScript type-stripping (Node >= 22.6 with
// --experimental-strip-types, on by default in Node 23.6+/24). CI runs Node 24.

const load = () => import("../../src/services/ai/thinkingSuppressionDialects.ts");

test("groq qwen models get reasoning_effort none and never chat_template_kwargs", async () => {
  const { suppressThinking } = await load();

  const body = {};
  suppressThinking(body, "groq", "qwen/qwen3-32b");

  assert.deepEqual(body, { reasoning_effort: "none" });
  assert.ok(!("chat_template_kwargs" in body), "Groq rejects chat_template_kwargs with a 400");
});

test("groq gpt-oss models get reasoning_effort low, the lowest value that family accepts", async () => {
  const { suppressThinking } = await load();

  const body = {};
  suppressThinking(body, "groq", "openai/gpt-oss-120b");

  assert.deepEqual(body, { reasoning_effort: "low" });
  assert.ok(!("chat_template_kwargs" in body), "Groq rejects chat_template_kwargs with a 400");
});

test("groq model family matching is case insensitive", async () => {
  const { suppressThinking } = await load();

  const qwen = {};
  suppressThinking(qwen, "groq", "Qwen/Qwen3-32B");
  assert.equal(qwen.reasoning_effort, "none");

  const gptOss = {};
  suppressThinking(gptOss, "groq", "OpenAI/GPT-OSS-20B");
  assert.equal(gptOss.reasoning_effort, "low");
});

test("groq models of an unknown family are left untouched rather than sent a guessed enum", async () => {
  const { suppressThinking } = await load();

  const body = { model: "llama-3.3-70b-versatile", messages: [] };
  suppressThinking(body, "groq", "llama-3.3-70b-versatile");

  assert.deepEqual(body, { model: "llama-3.3-70b-versatile", messages: [] });
});

test("groq tolerates a missing model without throwing", async () => {
  const { suppressThinking } = await load();

  const body = {};
  suppressThinking(body, "groq", undefined);

  assert.deepEqual(body, {});
});

test("gemini gets reasoning_effort minimal and nothing else", async () => {
  const { suppressThinking } = await load();

  const body = {};
  suppressThinking(body, "gemini", "gemini-3-flash-preview");

  assert.deepEqual(body, { reasoning_effort: "minimal" });
});

test("openrouter gets its native reasoning toggle and nothing else", async () => {
  const { suppressThinking } = await load();

  const body = {};
  suppressThinking(body, "openrouter", "qwen/qwen3-32b");

  assert.deepEqual(body, { reasoning: { enabled: false } });
});

test("local gets think false plus chat_template_kwargs", async () => {
  const { suppressThinking } = await load();

  const body = {};
  suppressThinking(body, "local", "qwen3-8b");

  assert.deepEqual(body, { think: false, chat_template_kwargs: { enable_thinking: false } });
});

test("lan gets the nested reasoning object plus chat_template_kwargs", async () => {
  const { suppressThinking } = await load();

  const body = {};
  suppressThinking(body, "lan", "qwen3-8b");

  assert.deepEqual(body, {
    reasoning: { effort: "none" },
    chat_template_kwargs: { enable_thinking: false },
  });
});

test("unlisted providers keep the legacy reasoning_effort none plus chat_template_kwargs", async () => {
  const { suppressThinking } = await load();

  const body = {};
  suppressThinking(body, "openai", "gpt-5.2");

  assert.deepEqual(body, {
    reasoning_effort: "none",
    chat_template_kwargs: { enable_thinking: false },
  });
});
