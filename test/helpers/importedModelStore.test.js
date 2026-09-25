const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ImportedModelStore } = require("../../src/helpers/importedModelStore");
const { TYPE, buildGguf, LLAMA_3_2_3B_ENTRIES } = require("./harness/ggufFixtures");

async function fixture(t, extra = []) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "personal-gguf-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, "original.gguf");
  const bytes = Buffer.alloc(1_000_001);
  buildGguf([...LLAMA_3_2_3B_ENTRIES, ...extra]).copy(bytes);
  bytes.writeBigUInt64LE(1n, 8);
  await fs.writeFile(source, bytes);
  return { source, dir, store: new ImportedModelStore(path.join(dir, "models")) };
}

test("copies a GGUF into owned storage, persists metadata/readiness, and preserves original on deletion", async (t) => {
  const { source, dir, store } = await fixture(t, [
    { key: "general.name", type: TYPE.STRING, value: "My private model" },
  ]);
  const model = await store.importFile(source);
  assert.equal(model.name, "My private model");
  assert.equal(model.architecture, "llama");
  assert.equal(model.loadStatus, "untested");
  assert.notEqual(path.join(store.modelsDir, model.fileName), source);
  store.updateLoadStatus(model.id, "ready");
  const reloaded = new ImportedModelStore(path.join(dir, "models"));
  assert.equal(reloaded.models[0].id, model.id);
  assert.equal(reloaded.models[0].loadStatus, "ready");
  assert.deepEqual(
    await fs.readFile(source),
    await fs.readFile(path.join(store.modelsDir, model.fileName))
  );
  await reloaded.deleteModel(model.id);
  assert.equal((await fs.stat(source)).size, 1_000_001);
  assert.equal(new ImportedModelStore(store.modelsDir).models.length, 0);
});

test("rejects corrupt, zero-tensor, incomplete, split, and adapter files without catalog entries", async (t) => {
  const { source, store } = await fixture(t);
  for (const modify of [
    (bytes) => bytes.writeUInt32LE(0, 0),
    (bytes) => bytes.writeBigUInt64LE(0n, 8),
  ]) {
    const bytes = await fs.readFile(source);
    modify(bytes);
    await fs.writeFile(source, bytes);
    await assert.rejects(store.importFile(source), { code: "INVALID_GGUF" });
  }
  assert.equal(store.models.length, 0);
  const split = await fixture(t, [{ key: "split.count", type: TYPE.UINT16, value: 2 }]);
  await assert.rejects(split.store.importFile(split.source), { code: "UNSUPPORTED_GGUF" });
  const adapter = await fixture(t, [{ key: "general.type", type: TYPE.STRING, value: "adapter" }]);
  await assert.rejects(adapter.store.importFile(adapter.source), { code: "UNSUPPORTED_GGUF" });
  await fs.truncate(source, 128);
  await assert.rejects(store.importFile(source), { code: "INVALID_GGUF" });
});

test("canceled imports leave no partial files or entries", async (t) => {
  const { source, store } = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(store.importFile(source, { signal: controller.signal }), {
    name: "AbortError",
  });
  assert.equal(store.models.length, 0);
  assert.equal(
    await fs
      .readdir(store.modelsDir)
      .catch(() => [])
      .then((files) => files.length),
    0
  );
});

test("manifest path injection cannot remove files outside owned storage", async (t) => {
  const { source, store } = await fixture(t);
  const model = await store.importFile(source);
  await fs.writeFile(
    store.manifestPath,
    JSON.stringify({ version: 1, models: [{ ...model, fileName: "../original.gguf" }] })
  );
  const reloaded = new ImportedModelStore(store.modelsDir);
  assert.equal(reloaded.models.length, 0);
  await assert.rejects(reloaded.deleteModel(model.id), { code: "MODEL_NOT_FOUND" });
  assert.equal((await fs.stat(source)).size, 1_000_001);
});

test("unreadable catalog fails without replacing user model entries", async (t) => {
  const { source, store } = await fixture(t);
  await store.importFile(source);
  await fs.writeFile(store.manifestPath, "{broken");
  assert.throws(() => new ImportedModelStore(store.modelsDir), { code: "INVALID_MODEL_CATALOG" });
  assert.equal(await fs.readFile(store.manifestPath, "utf8"), "{broken");
});
