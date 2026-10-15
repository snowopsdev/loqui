const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/locality.ts");

test("local mode stays on the device", async () => {
  const { resolveLocality } = await load();
  assert.deepEqual(resolveLocality({ mode: "local", provider: "qwen" }), {
    locality: "device",
    provider: null,
  });
});

test("self-hosted on loopback is the device; elsewhere it is your network", async () => {
  const { resolveLocality } = await load();
  for (const url of [
    "http://localhost:11434/v1",
    "http://127.0.0.1:8080",
    "http://[::1]:8080/v1",
    "http://llm.localhost/v1",
  ]) {
    assert.equal(resolveLocality({ mode: "self-hosted", remoteUrl: url }).locality, "device", url);
  }
  for (const url of [
    "http://192.168.1.20:11434/v1",
    "https://gpu-box.lan/v1",
    "",
    null,
    "not a url",
  ]) {
    assert.equal(
      resolveLocality({ mode: "self-hosted", remoteUrl: url }).locality,
      "network",
      String(url)
    );
  }
});

test("provider modes are remote and name the receiver", async () => {
  const { resolveLocality } = await load();
  assert.deepEqual(resolveLocality({ mode: "providers", provider: "openai" }), {
    locality: "remote",
    provider: "OpenAI",
  });
  assert.deepEqual(resolveLocality({ mode: "providers", provider: "codex" }), {
    locality: "remote",
    provider: "ChatGPT (Codex)",
  });
  assert.deepEqual(resolveLocality({ mode: "enterprise", provider: "bedrock" }), {
    locality: "remote",
    provider: "AWS Bedrock",
  });
});

test("unknown or missing modes fail toward disclosure", async () => {
  const { resolveLocality } = await load();
  assert.deepEqual(resolveLocality({ mode: undefined, provider: undefined }), {
    locality: "remote",
    provider: "Unknown provider",
  });
  assert.deepEqual(resolveLocality({ mode: "providers", provider: "my-new-llm" }), {
    locality: "remote",
    provider: "My New Llm",
  });
});

test("monograms are two letters and ignore punctuation", async () => {
  const { providerMonogram } = await load();
  assert.equal(providerMonogram("OpenAI"), "Op");
  assert.equal(providerMonogram("AWS Bedrock"), "AB");
  assert.equal(providerMonogram("ChatGPT (Codex)"), "CC");
  assert.equal(providerMonogram(""), "?");
});

test("punctuation-only provider ids fall back to the unknown provider name", async () => {
  const { providerDisplayName } = await load();
  assert.equal(providerDisplayName("---"), "Unknown provider");
});

test("providerDisplayLabel localises unknown and custom providers", async () => {
  const { providerDisplayLabel } = await load();
  const t = (k) => "T:" + k;
  assert.equal(providerDisplayLabel(undefined, t), "T:locality.unknownProvider");
  assert.equal(providerDisplayLabel("---", t), "T:locality.unknownProvider");
  assert.equal(providerDisplayLabel("custom", t), "T:locality.customEndpoint");
  assert.equal(providerDisplayLabel("openai", t), "OpenAI");
});

test("inherited object keys are treated as unknown provider ids, never returned raw", async () => {
  const { providerDisplayName, providerDisplayLabel, resolveLocality, providerMonogram } =
    await load();
  const t = (k) => "T:" + k;
  const expected = { constructor: "Constructor", __proto__: "Proto", toString: "Tostring" };
  for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    assert.equal(typeof providerDisplayName(id), "string", id);
    assert.equal(typeof providerDisplayLabel(id, t), "string", id);
    const route = resolveLocality({ mode: "providers", provider: id });
    assert.equal(typeof route.provider, "string", id);
    assert.equal(typeof providerMonogram(route.provider), "string", id);
  }
  for (const [id, name] of Object.entries(expected)) {
    assert.equal(providerDisplayName(id), name, id);
  }
  assert.equal(providerDisplayName("OpenAI"), "OpenAI");
});
