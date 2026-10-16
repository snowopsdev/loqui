const assert = require("node:assert/strict");
const test = require("node:test");

// change-driving: src/components/ui/cartridgeMath.ts does not exist yet, so every test fails on import.
const load = () => import("../../src/components/ui/cartridgeMath.ts");
const GB = 1_000_000_000;

test("change-driving: tiers come from curated data when present, otherwise from size, and say so", async () => {
  const { estimateTiers } = await load();
  assert.deepEqual(estimateTiers({ sizeBytes: 1.3 * GB }), {
    speed: 4,
    quality: 3,
    memory: 1,
    estimated: true,
  });
  assert.deepEqual(estimateTiers({ sizeBytes: 2.7 * GB }), {
    speed: 3,
    quality: 4,
    memory: 2,
    estimated: true,
  });
  assert.deepEqual(estimateTiers({ sizeBytes: 5.5 * GB }), {
    speed: 2,
    quality: 5,
    memory: 4,
    estimated: true,
  });
  assert.deepEqual(estimateTiers({ sizeBytes: 5.5 * GB, speedTier: 3, qualityTier: 4 }), {
    speed: 3,
    quality: 4,
    memory: 4,
    estimated: false,
  });
  assert.deepEqual(estimateTiers({}), {
    speed: null,
    quality: null,
    memory: null,
    estimated: true,
  });
});

test("change-driving: fit compares the RAM estimate with this device", async () => {
  const { fitFor, estimateRamBytes } = await load();
  assert.equal(estimateRamBytes(1 * GB), 1.15 * GB);
  assert.equal(fitFor(1.3 * GB, 16 * GB), "comfortable");
  assert.equal(fitFor(7 * GB, 16 * GB), "tight");
  assert.equal(fitFor(12 * GB, 16 * GB), "tooLarge");
  assert.equal(fitFor(1 * GB, null), "unknown");
  assert.equal(fitFor(undefined, 16 * GB), "unknown");
});

test("change-driving: sort puts Recommended first, then smaller models; collapse keeps the selection visible", async () => {
  const { sortForDisplay, visibleModels } = await load();
  const models = [
    { id: "9b", sizeBytes: 5.5 * GB },
    { id: "2b", sizeBytes: 1.3 * GB, recommended: true },
    { id: "x", sizeBytes: undefined },
    { id: "4b", sizeBytes: 2.7 * GB },
    { id: "0.8b", sizeBytes: 0.8 * GB },
  ];
  assert.deepEqual(
    sortForDisplay(models).map((m) => m.id),
    ["2b", "0.8b", "4b", "9b", "x"]
  );
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}` }));
  assert.deepEqual(
    visibleModels(many, "m0", false).map((m) => m.id),
    ["m0", "m1", "m2", "m3", "m4"]
  );
  assert.deepEqual(
    visibleModels(many, "m7", false).map((m) => m.id),
    ["m0", "m1", "m2", "m3", "m4", "m7"]
  );
  assert.equal(visibleModels(many, "m0", true).length, 8);
});

test("change-driving: a registry model's context length and curated tiers survive into the cartridge (M2)", async () => {
  const { cartridgeFromLocalModel, estimateTiers } = await load();
  // Size alone would say speed 2 and quality 5 for 5.5 GB; the curated tiers differ.
  const model = {
    id: "big",
    name: "Big",
    sizeBytes: 5.5 * GB,
    contextLength: 131072,
    speedTier: 4,
    qualityTier: 3,
    recommended: true,
  };
  const card = cartridgeFromLocalModel(model, {
    downloaded: true,
    downloading: false,
    progress: 12,
    badge: "ready",
    href: "https://x.test",
    hrefLabel: "Card",
    installing: true,
    cancelling: true,
  });
  assert.equal(card.contextLength, 131072);
  assert.equal(card.speedTier, 4);
  assert.equal(card.qualityTier, 3);
  assert.equal(card.recommended, true);
  assert.deepEqual(
    {
      d: card.isDownloaded,
      g: card.isDownloading,
      c: card.isCancelling,
      i: card.isInstalling,
      p: card.progress,
      b: card.badge,
      h: card.href,
      l: card.hrefLabel,
    },
    { d: true, g: false, c: true, i: true, p: 12, b: "ready", h: "https://x.test", l: "Card" }
  );
  assert.deepEqual(estimateTiers(card), { speed: 4, quality: 3, memory: 4, estimated: false });
  assert.deepEqual(estimateTiers({ sizeBytes: card.sizeBytes }), {
    speed: 2,
    quality: 5,
    memory: 4,
    estimated: true,
  });
});

test("change-driving: in-use chips list device routes that are on, by name or id", async () => {
  const { usedByMap } = await load();
  const models = [
    { id: "qwen-2b", name: "Qwen3.5 2B" },
    { id: "qwen-9b", name: "Qwen3.5 9B" },
  ];
  const routes = [
    { id: "chat", locality: "device", model: "Qwen3.5 2B", state: { status: "ready" } },
    { id: "dictationCleanup", locality: "device", model: "qwen-2b", state: { status: "ready" } },
    { id: "translation", locality: "device", model: "Qwen3.5 2B", state: { status: "off" } },
    { id: "noteFormatting", locality: "remote", model: "Qwen3.5 2B", state: { status: "ready" } },
  ];
  assert.deepEqual(
    usedByMap(models, routes, (id) => `T:${id}`),
    { "qwen-2b": ["T:chat", "T:dictationCleanup"] }
  );
});
