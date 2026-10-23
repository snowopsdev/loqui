const test = require("node:test");
const assert = require("node:assert/strict");
const { createModelStorageOps } = require("../../src/helpers/modelStorageOps.js");

// Family managers over an in-memory disk; `removed` records every deletion.
function setup(initial = {}) {
  const disk = {
    whisper: new Set(initial.whisper ?? ["base"]),
    parakeet: new Set(initial.parakeet ?? []),
    llm: new Set(initial.llm ?? ["qwen3.5-2b-q4_k_m"]),
  };
  const removed = [];
  const progress = { percent: 0 };
  const speech = (family, names) => ({
    list: async () => ({
      success: true,
      models: names.map((model) => ({
        model,
        downloaded: disk[family].has(model),
        path: disk[family].has(model) ? `/models/${family}/${model}` : undefined,
        downloadProgress: progress.percent,
      })),
    }),
    remove: async (id) => {
      removed.push([family, id]);
      disk[family].delete(id);
      return { success: true, model: id, deleted: true };
    },
  });
  const families = {
    whisper: speech("whisper", ["base", "small"]),
    parakeet: speech("parakeet", ["parakeet-tdt-0.6b-v3"]),
    llm: {
      list: async () =>
        ["qwen3.5-2b-q4_k_m", "gemma"].map((id) => ({
          id,
          isDownloaded: disk.llm.has(id),
          path: disk.llm.has(id) ? `/models/llm/${id}.gguf` : null,
          downloadedSize: progress.percent,
        })),
      remove: async (id) => {
        removed.push(["llm", id]);
        disk.llm.delete(id);
      },
    },
  };
  return { disk, removed, progress, families, ops: createModelStorageOps({ families }) };
}

const review = async (ops) => {
  const preview = await ops.preview();
  const count =
    preview.whisper.models.filter((m) => m.downloaded).length +
    preview.parakeet.models.filter((m) => m.downloaded).length +
    preview.llm.filter((m) => m.isDownloaded).length;
  return { count, modelsIdentity: preview.modelsIdentity, preview };
};

test("the preview returns each family's list with an identity of the downloaded set", async () => {
  const { ops, progress, disk } = setup();
  const first = await review(ops);
  assert.equal(first.count, 2);
  assert.match(first.modelsIdentity, /^[a-f0-9]{64}$/);
  assert.equal(first.preview.whisper.success, true);
  assert.equal(first.preview.identityError, undefined);
  progress.percent = 42; // download progress is not inventory
  assert.equal((await review(ops)).modelsIdentity, first.modelsIdentity);
  disk.parakeet.add("parakeet-tdt-0.6b-v3");
  assert.notEqual((await review(ops)).modelsIdentity, first.modelsIdentity);
});

test("a model added after review is refused as stale and nothing is deleted", async () => {
  const { ops, disk, removed } = setup();
  const reviewed = await review(ops);
  disk.parakeet.add("parakeet-tdt-0.6b-v3"); // a download lands before the user confirms
  const result = await ops.deleteModels({
    expected: { count: reviewed.count, modelsIdentity: reviewed.modelsIdentity },
  });
  assert.deepEqual(result, { ok: false, remaining: 3, errors: ["stale"], families: null });
  assert.deepEqual(removed, []);
  assert.deepEqual(
    [...disk.whisper, ...disk.parakeet, ...disk.llm],
    ["base", "parakeet-tdt-0.6b-v3", "qwen3.5-2b-q4_k_m"]
  );
});

test("a same-count swap is stale too", async () => {
  const { ops, disk, removed } = setup();
  const reviewed = await review(ops);
  disk.whisper.delete("base");
  disk.whisper.add("small");
  const result = await ops.deleteModels({
    expected: { count: reviewed.count, modelsIdentity: reviewed.modelsIdentity },
  });
  assert.deepEqual(result.errors, ["stale"]);
  assert.deepEqual(removed, []);
});

test("an unchanged set deletes exactly the reviewed models, never a later arrival", async () => {
  const { ops, disk, removed, families } = setup();
  const reviewed = await review(ops);
  // An import finishes while the reviewed deletions are running.
  const erase = families.whisper.remove;
  families.whisper.remove = async (id) => {
    disk.llm.add("gemma");
    return erase(id);
  };
  const result = await ops.deleteModels({
    expected: { count: reviewed.count, modelsIdentity: reviewed.modelsIdentity },
  });
  assert.deepEqual(result, {
    ok: true,
    errors: [],
    families: {
      whisper: { success: true },
      parakeet: { success: true },
      llm: { success: true },
    },
  });
  assert.deepEqual(removed, [
    ["whisper", "base"],
    ["llm", "qwen3.5-2b-q4_k_m"],
  ]);
  assert.deepEqual([...disk.llm], ["gemma"], "the unreviewed import survives");
});

test("per-model failures are typed per family and do not stop the other families", async () => {
  const { ops, families, removed } = setup({ whisper: ["base", "small"] });
  families.whisper.remove = async (id) => {
    removed.push(["whisper", id]);
    if (id === "small") throw new Error("EBUSY");
    return { success: true };
  };
  families.llm.remove = async () => {
    throw new Error("Wait for the local model request to finish before deleting a model.");
  };
  const reviewed = await review(ops);
  const result = await ops.deleteModels({
    expected: { count: reviewed.count, modelsIdentity: reviewed.modelsIdentity },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.families, {
    whisper: { success: false, error: "small: EBUSY" },
    parakeet: { success: true },
    llm: {
      success: false,
      error:
        "qwen3.5-2b-q4_k_m: Wait for the local model request to finish before deleting a model.",
    },
  });
  assert.deepEqual(removed, [
    ["whisper", "base"],
    ["whisper", "small"],
  ]);
});

test("an unreadable family has no identity, and deletion refuses without touching anything", async () => {
  const { ops, families, removed } = setup();
  const reviewed = await review(ops);
  families.parakeet.list = async () => {
    throw new Error("EACCES");
  };
  const preview = await ops.preview();
  assert.equal(preview.modelsIdentity, undefined);
  assert.equal(preview.identityError, "parakeet: EACCES");
  assert.deepEqual(preview.parakeet, { error: "EACCES" });
  const result = await ops.deleteModels({
    expected: { count: reviewed.count, modelsIdentity: reviewed.modelsIdentity },
  });
  assert.deepEqual(result, {
    ok: false,
    remaining: null,
    errors: ["count-failed: parakeet: EACCES"],
    families: null,
  });
  assert.deepEqual(removed, []);
});

test("a request without the reviewed count and identity deletes nothing", async () => {
  const { ops, removed } = setup();
  for (const expected of [
    undefined,
    null,
    { count: 2 },
    { modelsIdentity: "a".repeat(64) },
    { count: -1, modelsIdentity: "a".repeat(64) },
    { count: 2, modelsIdentity: "not-a-digest" },
  ]) {
    const result = await ops.deleteModels({ expected });
    assert.deepEqual(result.errors, ["invalid-request"]);
  }
  assert.deepEqual(removed, []);
});
