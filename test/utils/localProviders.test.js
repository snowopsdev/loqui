const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/localProviders.ts");

const provider = (over = {}) => ({
  id: "qwen",
  name: "Qwen",
  models: [
    {
      id: "qwen3.5-9b",
      name: "Qwen3.5 9B",
      size: "5.5GB",
      sizeBytes: 5889811552,
      description: "Powerful hybrid model",
      descriptionKey: "models.descriptions.local.qwen_qwen3_5_9b_q4_k_m",
      hfRepo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      recommended: true,
      contextLength: 262144,
      // Curated: size alone (5.9 GB) would say speed 2, quality 5.
      speedTier: 4,
      qualityTier: 3,
      ...over,
    },
  ],
});

test("the registry-to-picker mapping forwards context length and curated tiers (M2, change-driving)", async () => {
  const { toLocalProviders } = await load();
  const [mapped] = toLocalProviders([provider()]);
  const model = mapped.models[0];
  assert.equal(model.contextLength, 262144);
  assert.equal(model.speedTier, 4);
  assert.equal(model.qualityTier, 3);
});

test("the fields the pickers already read are unchanged (baseline guard)", async () => {
  const { toLocalProviders } = await load();
  const [mapped] = toLocalProviders([provider()]);
  assert.equal(mapped.id, "qwen");
  assert.equal(mapped.name, "Qwen");
  assert.deepEqual(mapped.models[0], {
    id: "qwen3.5-9b",
    name: "Qwen3.5 9B",
    size: "5.5GB",
    sizeBytes: 5889811552,
    description: "Powerful hybrid model",
    descriptionKey: "models.descriptions.local.qwen_qwen3_5_9b_q4_k_m",
    specUrl: "https://huggingface.co/bartowski/Qwen_Qwen3.5-9B-GGUF",
    recommended: true,
    contextLength: 262144,
    speedTier: 4,
    qualityTier: 3,
  });
});

test("change-driving: a model without curated tiers or a repository maps to undefined, not zero", async () => {
  const { toLocalProviders } = await load();
  const [mapped] = toLocalProviders([
    provider({
      hfRepo: undefined,
      speedTier: undefined,
      qualityTier: undefined,
      contextLength: undefined,
    }),
  ]);
  const model = mapped.models[0];
  assert.equal(model.specUrl, undefined);
  assert.equal(model.speedTier, undefined);
  assert.equal(model.qualityTier, undefined);
  assert.equal(model.contextLength, undefined);
});

test("change-driving: every real registry model keeps its context length through the mapping (M2)", async () => {
  const { toLocalProviders } = await load();
  const data = require("../../src/models/modelRegistryData.json");
  const providers = Array.isArray(data.localProviders)
    ? data.localProviders
    : Object.values(data.localProviders);
  const mapped = toLocalProviders(providers);
  for (const [i, p] of providers.entries())
    for (const [j, m] of p.models.entries()) {
      assert.equal(mapped[i].models[j].contextLength, m.contextLength, `${p.id}/${m.id}`);
    }
});
