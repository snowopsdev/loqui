const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function setup(t, { chunks = ["Answer"], finish = true, error, onStream, startLocal } = {}) {
  const listeners = new Set();
  const requests = [];
  const cancellations = [];
  const results = [];
  const emit = (event) => {
    for (const listener of listeners) listener(event);
  };
  const api = {
    textGenerate: async (request) => {
      requests.push(request);
      return { text: "Cleaned" };
    },
    textStream: async (request) => {
      requests.push(request);
      if (onStream) return onStream(request, emit);
      for (const text of chunks)
        emit({ type: "chunk", requestId: request.requestId, chunk: { type: "content", text } });
      if (error) emit({ type: "error", requestId: request.requestId, error });
      else if (finish) {
        emit({
          type: "chunk",
          requestId: request.requestId,
          chunk: { type: "done", finishReason: "stop" },
        });
        emit({ type: "end", requestId: request.requestId });
      }
    },
    textCancel: async (id) => cancellations.push(id),
    textToolResult: async (result) => {
      results.push(result);
      emit({ type: "end", requestId: result.requestId });
    },
    onTextEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    credentialStatus: async () => ({ configured: true }),
    codexStatus: async () => ({ available: true, account: { type: "chatgpt" } }),
  };
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        personalInference: api,
        llamaServerStart: startLocal || (async () => ({ success: true, port: 8080 })),
        processLocalReasoning: async () => ({ success: false, error: "Local model missing" }),
      },
    },
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "personal-reasoning-stream-",
    mockModules: {
      "/stores/settingsStore": `export const getSettings = () => ({ cleanupMode: "local", cleanupProvider: "local", preferredLanguage: "en", customDictionary: [], snippets: [] });`,
      "/models/ModelRegistry": `export const resolveInferenceProvider = (provider) => provider === "qwen" ? "local" : provider;`,
    },
  });
  const service = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
  t.after(() => service.destroy());
  return { service, api, requests, cancellations, results, emit, listeners };
}
const messages = [{ role: "user", content: "Hello" }];
const config = { systemPrompt: "Reply", inferenceScope: "chatIntelligence" };
async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}
const content = (chunks) =>
  chunks
    .filter((chunk) => chunk.type === "content")
    .map((chunk) => chunk.text)
    .join("");

test("local streaming removes think blocks split across IPC events", async (t) => {
  const { service, requests, listeners } = await setup(t, {
    chunks: ["<thi", "nk>private reason", "ing</think>", "Answer"],
  });
  assert.equal(
    content(await collect(service.processTextStreamingAI(messages, "qwen", "local", config))),
    "Answer"
  );
  assert.equal(requests[0].baseUrl, "http://127.0.0.1:8080/v1");
  assert.equal(listeners.size, 0);
});
test("thinking suppression is optional and does not remove BYOK text", async (t) => {
  const { service } = await setup(t, { chunks: ["<think>Visible</think>Answer"] });
  assert.equal(
    content(
      await collect(
        service.processTextStreamingAI(messages, "qwen", "local", {
          ...config,
          disableThinking: false,
        })
      )
    ),
    "<think>Visible</think>Answer"
  );
  assert.equal(
    content(await collect(service.processTextStreamingAI(messages, "gpt-test", "openai", config))),
    "<think>Visible</think>Answer"
  );
});
test("stream errors propagate instead of appearing as successful completion", async (t) => {
  const { service, listeners } = await setup(t, { error: "Quota exhausted" });
  await assert.rejects(
    collect(service.processTextStreamingAI(messages, "codex-model", "codex", config)),
    /Quota exhausted/
  );
  assert.equal(listeners.size, 0);
});
test("cancellation releases subscriptions and cancels the owning request", async (t) => {
  const { service, cancellations, requests, listeners } = await setup(t, { finish: false });
  const stream = service.processTextStreamingAI(messages, "codex-model", "codex", config);
  assert.equal((await stream.next()).value.text, "Answer");
  service.cancelActiveStream();
  assert.equal((await stream.next()).done, true);
  assert.ok(cancellations.includes(requests[0].requestId));
  assert.equal(listeners.size, 0);
});
test("cancellation during local startup cannot launch a later request", async (t) => {
  let ready;
  const { service, requests } = await setup(t, {
    startLocal: () =>
      new Promise((resolve) => {
        ready = resolve;
      }),
  });
  const pending = service.processTextStreamingAI(messages, "qwen", "local", config).next();
  service.cancelActiveStream();
  ready({ success: true, port: 8080 });
  assert.equal((await pending).done, true);
  assert.equal(requests.length, 0);
});
test("an interrupted consumer closes its IPC stream", async (t) => {
  const { service, requests, cancellations } = await setup(t, { finish: false });
  const stream = service.processTextStreamingAI(messages, "gpt", "openai", config);
  await stream.next();
  await stream.return();
  assert.ok(cancellations.includes(requests[0].requestId));
});
test("assistant tools are described over IPC and executed only by their registry callback", async (t) => {
  const { service, results } = await setup(t, {
    onStream: (request, emit) =>
      emit({
        type: "tool",
        requestId: request.requestId,
        name: "search_notes",
        callId: "call-1",
        arguments: { query: "demo" },
      }),
  });
  let args;
  let executionOptions;
  const tools = {
    search_notes: {
      description: "Find notes",
      inputSchema: { jsonSchema: { type: "object" } },
      execute: async (input, options) => {
        args = input;
        executionOptions = options;
        return { notes: [] };
      },
    },
  };
  const chunks = await collect(
    service.processTextStreamingAI(messages, "codex-model", "codex", config, tools)
  );
  assert.deepEqual(args, { query: "demo" });
  assert.equal(executionOptions.toolCallId, "call-1");
  assert.equal(executionOptions.context, undefined);
  assert.ok(Object.hasOwn(executionOptions, "context"));
  assert.ok(executionOptions.abortSignal instanceof AbortSignal);
  assert.deepEqual(results[0].result, { notes: [] });
  assert.equal(chunks[0].type, "tool_calls");
});
test("generation sends task credential references and no renderer secrets", async (t) => {
  const { service, requests } = await setup(t);
  assert.equal(
    await service.processText("raw", "model", null, {
      provider: "custom",
      baseUrl: "https://example.invalid/v1",
      customApiKey: "do-not-forward",
      inferenceScope: "noteFormatting",
      systemPrompt: "Summarize",
    }),
    "Cleaned"
  );
  assert.equal(requests[0].credentialRef, "custom:noteFormatting");
  assert.equal(JSON.stringify(requests).includes("do-not-forward"), false);
  assert.equal(requests[0].timeoutMs, 600000);
});
test("all direct providers and Codex preserve their explicit routing", async (t) => {
  const { service, requests } = await setup(t);
  for (const provider of [
    "openai",
    "anthropic",
    "gemini",
    "groq",
    "openrouter",
    "tinfoil",
    "corti",
    "codex",
    "bedrock",
    "azure",
    "vertex",
  ]) {
    await service.processText("raw", "model", null, {
      provider,
      inferenceScope: "dictationTranslation",
      systemPrompt: "Translate",
    });
    assert.equal(requests.at(-1).provider, provider);
  }
});
test("local failures and removed providers never redirect to another provider", async (t) => {
  const { service, requests } = await setup(t);
  await assert.rejects(
    service.processText("raw", "qwen", null, { provider: "local", systemPrompt: "Clean" }),
    /Local model missing/
  );
  await assert.rejects(
    service.processText("raw", "model", null, { provider: "openwhispr" }),
    /Unsupported/
  );
  assert.equal(requests.length, 0);
});
