// Main-owned model inventory and deletion for Settings > Privacy & Data, the
// model counterpart of storageOps.js. The preview reads the three model
// families once and binds the downloaded set to an opaque identity. Deletion
// rereads that set and refuses, deleting nothing, when it no longer matches
// what the user reviewed. It then deletes exactly the reviewed models, so a
// download or import that lands later is never removed by this confirmation.
const { identityDigest } = require("./storageOps");

const FAMILIES = ["whisper", "parakeet", "llm"];

const describe = (error) => String(error?.message || error);
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isIdentity = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/**
 * families: { whisper, parakeet, llm }, each { list(), remove(id) }.
 * whisper/parakeet list() resolves { success, models: [{ model, downloaded, path }] };
 * llm list() resolves [{ id, isDownloaded, path }]. remove(id) deletes one model.
 */
function createModelStorageOps({ families }) {
  // One read of every family. `lists` is what each family reported (the
  // renderer validates and sums it); `entries` is the downloaded set the
  // identity binds, in a deterministic order.
  async function readInventory() {
    const settled = await Promise.allSettled(FAMILIES.map((family) => families[family].list()));
    const lists = {};
    const entries = [];
    const errors = [];
    FAMILIES.forEach((family, index) => {
      const result = settled[index];
      if (result.status === "rejected") {
        lists[family] = { error: describe(result.reason) };
        errors.push(`${family}: ${describe(result.reason)}`);
        return;
      }
      const value = result.value;
      lists[family] = value;
      const models = family === "llm" ? value : value?.success === true ? value.models : null;
      if (!Array.isArray(models)) {
        errors.push(`${family}: ${typeof value?.error === "string" ? value.error : "unreadable"}`);
        return;
      }
      for (const model of models) {
        if (!(family === "llm" ? model?.isDownloaded : model?.downloaded)) continue;
        const id = family === "llm" ? model.id : model.model;
        if (typeof id !== "string" || !id) {
          errors.push(`${family}: model without an id`);
          continue;
        }
        entries.push({ family, id, path: typeof model.path === "string" ? model.path : null });
      }
    });
    entries.sort(
      (a, b) =>
        FAMILIES.indexOf(a.family) - FAMILIES.indexOf(b.family) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
    const identity =
      errors.length === 0
        ? identityDigest(entries.map(({ family, id, path }) => [family, id, path]))
        : null;
    return { lists, entries, identity, error: errors.length ? errors.join("; ") : null };
  }

  async function preview() {
    const { lists, identity, error } = await readInventory();
    return identity === null
      ? { ...lists, identityError: error }
      : { ...lists, modelsIdentity: identity };
  }

  const refused = (error, remaining = null) => ({
    ok: false,
    remaining,
    errors: [error],
    families: null,
  });

  async function deleteModels({ expected } = {}) {
    if (
      !expected ||
      typeof expected !== "object" ||
      !isCount(expected.count) ||
      !isIdentity(expected.modelsIdentity)
    )
      return refused("invalid-request");
    const inventory = await readInventory();
    if (inventory.identity === null) return refused(`count-failed: ${inventory.error}`);
    if (
      inventory.entries.length !== expected.count ||
      inventory.identity !== expected.modelsIdentity
    )
      return refused("stale", inventory.entries.length);

    // Exactly the reviewed models, one at a time. Nothing outside this set is
    // touched, even if it arrives while these deletions run.
    const results = {};
    for (const family of FAMILIES) {
      const failures = [];
      for (const { id } of inventory.entries.filter((entry) => entry.family === family)) {
        try {
          const result = await families[family].remove(id);
          if (result && typeof result === "object" && result.success === false)
            failures.push(`${id}: ${result.error ?? "not deleted"}`);
        } catch (error) {
          failures.push(`${id}: ${describe(error)}`);
        }
      }
      results[family] = failures.length
        ? { success: false, error: failures.join("; ") }
        : { success: true };
    }
    return {
      ok: FAMILIES.every((family) => results[family].success === true),
      errors: [],
      families: results,
    };
  }

  return { preview, deleteModels };
}

module.exports = { createModelStorageOps, MODEL_STORAGE_FAMILIES: FAMILIES };
