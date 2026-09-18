const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { registerPersonalInferenceIPC } = require("../../src/helpers/personalInference");

function harness(t, behavior = {}) {
  const handlers = new Map();
  const emitted = [];
  const modelCalls = [];
  const sender = new EventEmitter();
  sender.id = 7;
  sender.isDestroyed = () => false;
  sender.send = (_channel, payload) => emitted.push(payload);
  const otherSender = new EventEmitter();
  otherSender.id = 8;
  otherSender.isDestroyed = () => false;
  const codex = new EventEmitter();
  codex.stop = () => {};
  const usage = {
    inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 4, text: 4, reasoning: 0 },
  };
  const model = {
    specificationVersion: "v3",
    provider: "fixture",
    modelId: "fixture",
    supportedUrls: {},
    doGenerate: async (options) => {
      modelCalls.push(options);
      if (behavior.error) throw new Error(behavior.error);
      if (behavior.wait)
        return new Promise((_resolve, reject) =>
          options.abortSignal.addEventListener("abort", () => reject(options.abortSignal.reason), {
            once: true,
          })
        );
      return {
        content: [
          { type: "text", text: behavior.text ?? "Cleaned text." },
          ...(behavior.sources || []),
        ],
        finishReason: { unified: behavior.finish || "stop", raw: behavior.finish || "stop" },
        usage,
        warnings: [],
      };
    },
    doStream: async (options) => {
      modelCalls.push(options);
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "text-1" });
            controller.enqueue({ type: "text-delta", id: "text-1", delta: "Cleaned " });
            if (behavior.error)
              controller.enqueue({ type: "error", error: new Error(behavior.error) });
            else controller.enqueue({ type: "text-delta", id: "text-1", delta: "text." });
            controller.enqueue({ type: "text-end", id: "text-1" });
            for (const source of behavior.sources || []) controller.enqueue(source);
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage,
            });
            controller.close();
          },
        }),
      };
    },
  };
  const secrets = [];
  const service = registerPersonalInferenceIPC({
    ipcMain: {
      handle: (name, fn) => handlers.set(name, fn),
      removeHandler: (name) => handlers.delete(name),
    },
    userDataPath: "/tmp/unused",
    codex,
    getCredential: async (ref) => {
      secrets.push(ref);
      return "fixture-secret";
    },
    saveCredential: async () => {},
    modelFactory: async (provider, id, key, baseUrl) => {
      assert.equal(key, "fixture-secret");
      modelCalls.push({ provider, id, baseUrl });
      return model;
    },
  });
  t.after(() => service.dispose());
  const request = {
    requestId: "req-1",
    provider: "openai",
    model: "fixture",
    messages: [{ role: "user", content: "raw transcript" }],
    requireCompleteOutput: true,
  };
  return {
    request,
    emitted,
    modelCalls,
    secrets,
    sender,
    invoke: (name, payload, owner = sender) =>
      handlers.get(`personal-inference:${name}`)({ sender: owner }, payload),
    otherSender,
  };
}

test("BYOK generation resolves only the selected credential in the main process", async (t) => {
  const { invoke, request, secrets, modelCalls } = harness(t);
  assert.deepEqual(await invoke("text-generate", request), { text: "Cleaned text." });
  assert.deepEqual(secrets, ["openai"]);
  assert.equal(modelCalls[0].provider, "openai");
  assert.equal(
    modelCalls[1].maxOutputTokens,
    undefined,
    "reasoning output is not capped to the transcript length"
  );
  assert.equal(JSON.stringify(modelCalls).includes("fixture-secret"), false);
});

test("web search is opt-in and runs only on the selected supported provider", async (t) => {
  for (const [provider, toolName, toolId] of [
    ["openai", "web_search", "openai.web_search"],
    ["anthropic", "web_search", "anthropic.web_search_20250305"],
    ["gemini", "google_search", "google.google_search"],
  ]) {
    const { invoke, request, modelCalls, secrets } = harness(t);
    await invoke("text-generate", {
      ...request,
      provider,
      inferenceScope: "chatIntelligence",
      webSearch: true,
    });
    assert.deepEqual(secrets, [provider]);
    const search = modelCalls[1].tools.find((tool) => tool.name === toolName);
    assert.equal(search.type, "provider");
    assert.equal(search.id, toolId);
    assert.equal(search.execute, undefined, "the application never proxies provider search");
  }
  const { invoke, request, modelCalls } = harness(t);
  await invoke("text-generate", { ...request, inferenceScope: "chatIntelligence" });
  assert.equal(modelCalls[1].tools, undefined);
  for (const rejected of [
    { ...request, webSearch: true },
    { ...request, provider: "codex", inferenceScope: "chatIntelligence", webSearch: true },
    { ...request, provider: "groq", inferenceScope: "chatIntelligence", webSearch: true },
  ])
    await assert.rejects(invoke("text-generate", rejected), /Web search is available only/);
});

test("native search citations survive generated and streamed answers", async (t) => {
  const sources = [
    {
      type: "source",
      sourceType: "url",
      id: "source-1",
      url: "https://example.org/result",
      title: "Result",
    },
  ];
  const { invoke, request, emitted } = harness(t, { sources });
  const input = { ...request, inferenceScope: "chatIntelligence", webSearch: true };
  assert.match(
    (await invoke("text-generate", input)).text,
    /\[1\]\(<https:\/\/example.org\/result>\)/
  );
  await invoke("text-stream", input);
  const text = emitted
    .filter((event) => event.chunk?.type === "content")
    .map((event) => event.chunk.text)
    .join("");
  assert.match(text, /\[1\]\(<https:\/\/example.org\/result>\)/);
  assert.equal(emitted.at(-1).type, "end");
});
test("empty model output is an error and never echoes the original transcript as a result", async (t) => {
  const { invoke, request } = harness(t, { text: "" });
  await assert.rejects(invoke("text-generate", request), /no text/);
});
test("incomplete summaries fail while callers that allow partial output can accept it", async (t) => {
  const { invoke, request } = harness(t, { text: "Partial", finish: "length" });
  await assert.rejects(invoke("text-generate", request), /truncated/);
  assert.deepEqual(await invoke("text-generate", { ...request, requireCompleteOutput: false }), {
    text: "Partial",
  });
});
test("invalid keys surface errors without provider fallback", async (t) => {
  const { invoke, request, secrets, modelCalls } = harness(t, { error: "Invalid API key" });
  await assert.rejects(invoke("text-generate", request), /Invalid API key/);
  assert.deepEqual(secrets, ["openai"]);
  assert.equal(modelCalls.filter((call) => call.provider).length, 1);
});
test("streaming forwards text and terminal events without credentials", async (t) => {
  const { invoke, request, emitted } = harness(t);
  await invoke("text-stream", request);
  assert.equal(
    emitted
      .filter((event) => event.chunk?.type === "content")
      .map((event) => event.chunk.text)
      .join(""),
    "Cleaned text."
  );
  assert.equal(emitted.at(-1).type, "end");
  assert.equal(JSON.stringify(emitted).includes("fixture-secret"), false);
});
test("stream errors produce a terminal error instead of a successful empty answer", async (t) => {
  const { invoke, request, emitted } = harness(t, { error: "Account limit exhausted" });
  await invoke("text-stream", request);
  assert.equal(emitted.at(-1).type, "error");
  assert.match(emitted.at(-1).error, /limit exhausted/);
});
test("cancellation is scoped to the requesting window", async (t) => {
  const { invoke, request, otherSender, modelCalls } = harness(t, { wait: true });
  const pending = invoke("text-generate", request);
  while (modelCalls.length < 2) await new Promise((resolve) => setImmediate(resolve));
  await invoke("text-cancel", request.requestId, otherSender);
  assert.equal(modelCalls[1].abortSignal.aborted, false);
  await invoke("text-cancel", request.requestId);
  await assert.rejects(pending, /abort/i);
});

test("note formatting survives the dictation deadline and times out once without a retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { invoke, request, modelCalls } = harness(t, { wait: true });
  let outcome;
  const pending = invoke("text-generate", {
    ...request,
    inferenceScope: "noteFormatting",
    timeoutMs: 600000,
  }).then(
    (value) => {
      outcome = { value };
    },
    (error) => {
      outcome = { error };
    }
  );
  while (modelCalls.length < 2) await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(30000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(outcome, undefined);
  t.mock.timers.tick(570001);
  await pending;
  assert.match(outcome.error.message, /timed out/);
  assert.equal(modelCalls.filter((call) => call.provider).length, 1);
});

test("Gemini and Groq thinking controls use supported low-reasoning settings", async (t) => {
  const { invoke, request, modelCalls } = harness(t);
  for (const [model, thinkingConfig] of [
    ["gemini-3.5-flash", { thinkingLevel: "minimal", includeThoughts: false }],
    ["gemini-3.1-pro", { thinkingLevel: "low", includeThoughts: false }],
    ["gemini-2.5-pro", { thinkingBudget: 128, includeThoughts: false }],
    ["gemini-2.5-flash", { thinkingBudget: 0, includeThoughts: false }],
  ]) {
    await invoke("text-generate", { ...request, provider: "gemini", model, disableThinking: true });
    assert.deepEqual(modelCalls.at(-1).providerOptions.google.thinkingConfig, thinkingConfig);
    assert.equal(modelCalls.at(-1).maxOutputTokens, undefined);
  }
  await invoke("text-generate", {
    ...request,
    provider: "groq",
    model: "openai/gpt-oss-120b",
    disableThinking: true,
  });
  assert.deepEqual(modelCalls.at(-1).providerOptions.groq, { reasoningEffort: "low" });
});
