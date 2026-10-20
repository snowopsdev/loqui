const test = require("node:test");
const assert = require("node:assert/strict");
const input = { messages: [{ role: "user", content: "fixture words" }], wordCount: 2 };
test("typed preview boundary retains original descriptor/request, refuses mutation/duplicates/stale completion, and resets", async () => {
  const { createCapturedTextBridge } = await import("../../src/preview/capturedTextBridge.ts");
  let release;
  const calls = [];
  let slow = false;
  const api = createCapturedTextBridge(async (descriptor, sentence) => {
    calls.push({ descriptor, sentence });
    if (slow)
      await new Promise((resolve) => {
        release = resolve;
      });
    return "Fixture.";
  });
  const descriptor = {
    provider: "custom",
    model: "a",
    baseUrl: "https://fixture.invalid/a",
    inferenceScope: "dictationCleanup",
  };
  const token = await api.captureTextOperation(descriptor);
  descriptor.model = "b";
  assert.deepEqual(await api.runTextOperation({ token, request: input }), { text: "Fixture." });
  assert.deepEqual(await api.runTextOperation({ token, request: input }), { text: "Fixture." });
  assert.equal(calls[1].descriptor.model, "a");
  assert.equal(calls[0].sentence, calls[1].sentence);
  await assert.rejects(api.runTextOperation({ token, request: { ...input, wordCount: 3 } }), {
    code: "CLEANUP_REQUEST_CHANGED",
  });
  slow = true;
  const pending = api.runTextOperation({ token, request: input });
  await assert.rejects(api.runTextOperation({ token, request: input }), {
    code: "CLEANUP_OPERATION_BUSY",
  });
  await api.retireTextOperation(token);
  release();
  await assert.rejects(pending, { code: "CLEANUP_OPERATION_UNAVAILABLE" });
  const next = await api.captureTextOperation(descriptor);
  api.reset();
  await assert.rejects(api.runTextOperation({ token: next, request: input }), {
    code: "CLEANUP_OPERATION_UNAVAILABLE",
  });
});
test("preview local captured operation uses admitted model/options and never accepts its token as remote inference", async () => {
  const { createCapturedTextBridge } = await import("../../src/preview/capturedTextBridge.ts");
  const calls = [];
  const api = createCapturedTextBridge(async (descriptor, text) => {
    calls.push({ descriptor, text });
    return "Local.";
  });
  const token = await api.captureTextOperation({
    provider: "local",
    model: "local-a",
    systemPrompt: "captured prompt",
    inferenceScope: "dictationCleanup",
  });
  await assert.rejects(api.runTextOperation({ token, request: input }), {
    code: "CLEANUP_OPERATION_UNAVAILABLE",
  });
  assert.deepEqual(
    await api.processLocalReasoning("fixture words", "changed-model-b", null, {
      textOperationToken: token,
      wordCount: 2,
    }),
    { success: true, text: "Local." }
  );
  assert.equal(calls[0].descriptor.model, "local-a");
  assert.equal(calls[0].descriptor.systemPrompt, "captured prompt");
});

test("fake captured boundary mirrors actual unsupported Codex/Tinfoil sources before text dispatch", async () => {
  const { createCapturedTextBridge } = await import("../../src/preview/capturedTextBridge.ts");
  let calls = 0;
  const api = createCapturedTextBridge(async () => {
    calls++;
    return "unexpected";
  });
  for (const provider of ["codex", "tinfoil"])
    await assert.rejects(
      api.captureTextOperation({ provider, model: "fixture", inferenceScope: "dictationCleanup" }),
      { code: "UNSUPPORTED_AUTH_SOURCE" }
    );
  assert.equal(calls, 0);
});

for (const local of [false, true]) {
  test(`preview ${local ? "local" : "remote"} first/Retry expire at five minutes without renewal, including in-flight`, async () => {
    const { createCapturedTextBridge } = await import("../../src/preview/capturedTextBridge.ts");
    let now = 0,
      calls = 0,
      release;
    let slow = false;
    const api = createCapturedTextBridge(
      async () => {
        calls++;
        if (slow)
          await new Promise((resolve) => {
            release = resolve;
          });
        return "Fixture.";
      },
      { now: () => now }
    );
    const descriptor = {
      provider: local ? "local" : "openai",
      model: "fixture",
      inferenceScope: "dictationCleanup",
    };
    const execute = async (token) => {
      if (!local) return api.runTextOperation({ token, request: input });
      const result = await api.processLocalReasoning("fixture words", "fixture", null, {
        textOperationToken: token,
        wordCount: 2,
      });
      if (!result.success) throw Object.assign(new Error(result.code), { code: result.code });
      return { text: result.text };
    };
    const first = await api.captureTextOperation(descriptor);
    now = 300000;
    await assert.rejects(execute(first), { code: "CLEANUP_OPERATION_UNAVAILABLE" });
    assert.equal(calls, 0);
    const retry = await api.captureTextOperation(descriptor);
    now = 599999;
    assert.deepEqual(await execute(retry), { text: "Fixture." });
    assert.deepEqual(await execute(retry), { text: "Fixture." });
    now = 600000;
    await assert.rejects(execute(retry), { code: "CLEANUP_OPERATION_UNAVAILABLE" });
    assert.equal(calls, 2);
    const inflight = await api.captureTextOperation(descriptor);
    slow = true;
    const pending = execute(inflight);
    now = 900000;
    release();
    await assert.rejects(pending, { code: "CLEANUP_OPERATION_UNAVAILABLE" });
    slow = false;
    const fresh = await api.captureTextOperation(descriptor);
    assert.deepEqual(await execute(fresh), { text: "Fixture." });
    assert.equal(calls, 4);
  });
}
