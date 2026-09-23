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
      return behavior.model || model;
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
    model,
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

test("SDK 7 keeps instructions separate from cleanup and assistant conversation history", async (t) => {
  for (const specificationVersion of ["v3", "v4"]) {
    const { invoke, request, model, modelCalls, emitted } = harness(t);
    model.specificationVersion = specificationVersion;
    const cleanup = { ...request, systemPrompt: "Format the transcript." };
    assert.deepEqual(await invoke("text-generate", cleanup), { text: "Cleaned text." });
    assert.deepEqual(modelCalls.at(-1).prompt[0], {
      role: "system",
      content: cleanup.systemPrompt,
    });
    const chat = {
      ...request,
      inferenceScope: "chatIntelligence",
      systemPrompt: "Answer using my notes.",
      messages: [
        { role: "user", content: "Find my note" },
        { role: "assistant", content: "Which note?" },
        { role: "user", content: "The meeting" },
      ],
    };
    await invoke("text-stream", chat);
    const prompt = modelCalls.at(-1).prompt;
    assert.deepEqual(
      prompt.map(({ role }) => role),
      ["system", "user", "assistant", "user"]
    );
    assert.equal(prompt[0].content, chat.systemPrompt);
    assert.equal(emitted.at(-1).type, "end");
    assert.equal(emitted.find((event) => event.chunk?.type === "done").chunk.finishReason, "stop");
    assert.deepEqual(
      chat.messages.map(({ role }) => role),
      ["user", "assistant", "user"]
    );
  }
});

test("SDK 7 application tools complete their IPC round trip and resume the selected model", async (t) => {
  for (const specificationVersion of ["v3", "v4"]) {
    const { invoke, request, model, emitted, sender, modelCalls } = harness(t);
    model.specificationVersion = specificationVersion;
    const originalStream = model.doStream;
    let firstStep = true;
    model.doStream = async (options) => {
      if (!firstStep) return originalStream(options);
      firstStep = false;
      modelCalls.push(options);
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({
              type: "tool-call",
              toolCallId: "sdk-call-1",
              toolName: "search_notes",
              input: JSON.stringify({ query: "meeting" }),
            });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "tool-calls", raw: "tool_calls" },
              usage: { inputTokens: { total: 2 }, outputTokens: { total: 1 } },
            });
            controller.close();
          },
        }),
      };
    };
    const originalSend = sender.send;
    sender.send = (channel, payload) => {
      originalSend(channel, payload);
      if (payload.type === "tool")
        void invoke("text-tool-result", {
          requestId: payload.requestId,
          callId: payload.callId,
          result: { notes: [{ title: "Meeting" }] },
        });
    };
    await invoke("text-stream", {
      ...request,
      inferenceScope: "chatIntelligence",
      systemPrompt: "Search my notes.",
      tools: [
        {
          name: "search_notes",
          description: "Search local notes",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false,
          },
        },
      ],
    });
    const toolEvent = emitted.find((event) => event.type === "tool");
    assert.equal(toolEvent.name, "search_notes");
    assert.deepEqual(toolEvent.arguments, { query: "meeting" });
    assert.equal(emitted.filter((event) => event.type === "tool").length, 1);
    assert.equal(modelCalls.length, 3, "one provider selection and two model steps");
    const toolResult = modelCalls.at(-1).prompt.find((message) => message.role === "tool");
    assert.equal(toolResult.content[0].toolCallId, "sdk-call-1");
    assert.deepEqual(toolResult.content[0].output, {
      type: "json",
      value: { notes: [{ title: "Meeting" }] },
    });
    assert.equal(emitted.at(-1).type, "end");
    assert.equal(
      emitted.some((event) => event.type === "error"),
      false
    );
  }
});

test("upgraded Anthropic and Vertex providers generate and stream through SDK 7 without network", async (t) => {
  const { createAnthropic } = require("@ai-sdk/anthropic");
  const { createVertex } = require("@ai-sdk/google-vertex");
  const anthropicResponse = {
    id: "fixture-message",
    type: "message",
    role: "assistant",
    model: "fixture-model",
    content: [{ type: "text", text: "Cleaned text." }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 2, output_tokens: 3 },
  };
  const vertexResponse = {
    candidates: [
      {
        index: 0,
        content: { role: "model", parts: [{ text: "Cleaned text." }] },
        finishReason: "STOP",
      },
    ],
    usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 },
  };
  for (const [provider, create, body, chunks] of [
    [
      "anthropic",
      createAnthropic,
      anthropicResponse,
      [
        {
          type: "message_start",
          message: {
            ...anthropicResponse,
            content: [],
            stop_reason: null,
            usage: { input_tokens: 2, output_tokens: 0 },
          },
        },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Cleaned text." },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 3 },
        },
        { type: "message_stop" },
      ],
    ],
    ["vertex", createVertex, vertexResponse, [vertexResponse]],
  ]) {
    const fetches = [];
    const model = create({
      apiKey: "fixture-key",
      fetch: async (url, init) => {
        const input = JSON.parse(init.body);
        fetches.push({ url: String(url), input });
        const streaming = input.stream || String(url).includes("streamGenerateContent");
        return new Response(
          streaming
            ? chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")
            : JSON.stringify(body),
          {
            headers: { "content-type": streaming ? "text/event-stream" : "application/json" },
          }
        );
      },
    })("fixture-model");
    assert.equal(model.specificationVersion, "v4");
    const { invoke, request, emitted, secrets } = harness(t, { model });
    const input = { ...request, provider, systemPrompt: "Format the transcript." };
    assert.deepEqual(await invoke("text-generate", input), { text: "Cleaned text." });
    await invoke("text-stream", input);
    assert.equal(
      emitted
        .filter((event) => event.chunk?.type === "content")
        .map((event) => event.chunk.text)
        .join(""),
      "Cleaned text."
    );
    assert.equal(emitted.at(-1).type, "end");
    assert.deepEqual(secrets, [provider, provider]);
    assert.equal(fetches.length, 2);
    assert.ok(
      fetches.every(
        ({ url }) =>
          new URL(url).hostname ===
          (provider === "anthropic" ? "api.anthropic.com" : "aiplatform.googleapis.com")
      )
    );
  }
});
