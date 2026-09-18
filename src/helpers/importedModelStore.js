const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { pipeline } = require("stream/promises");
const { readGgufMetadataFromFile } = require("./ggufMetadata");
const { checkDiskSpace } = require("./downloadUtils");

const IMPORTED_PROVIDER = { id: "imported", name: "Imported GGUF", baseUrl: "" };
const IMPORT_ID = /^imported-[a-f0-9-]{36}$/;

function importError(message, code) {
  return Object.assign(new Error(message), { code });
}

class ImportedModelStore {
  constructor(modelsDir) {
    this.modelsDir = modelsDir;
    this.manifestPath = path.join(modelsDir, "imported-models.json");
    this.models = [];
    try {
      const manifest = JSON.parse(fs.readFileSync(this.manifestPath, "utf8"));
      if (manifest.version !== 1 || !Array.isArray(manifest.models)) throw new Error("version");
      this.models = manifest.models.filter(
        (model) =>
          model &&
          IMPORT_ID.test(model.id) &&
          model.fileName === `${model.id}.gguf` &&
          typeof model.name === "string" &&
          typeof model.architecture === "string" &&
          Number.isFinite(model.sizeBytes) &&
          model.sizeBytes > 1_000_000
      );
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw importError(
          "The imported model catalog is unreadable. Restore imported-models.json before importing or deleting models.",
          "INVALID_MODEL_CATALOG"
        );
      }
    }
  }

  provider() {
    return { ...IMPORTED_PROVIDER, models: this.models };
  }

  save() {
    fs.mkdirSync(this.modelsDir, { recursive: true });
    const temporary = `${this.manifestPath}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, models: this.models }, null, 2), {
        mode: 0o600,
        flag: "wx",
      });
      fs.renameSync(temporary, this.manifestPath);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  async importFile(sourcePath, { signal } = {}) {
    if (typeof sourcePath !== "string" || path.extname(sourcePath).toLowerCase() !== ".gguf") {
      throw importError("Choose a GGUF model file.", "INVALID_GGUF");
    }
    const stat = await fs.promises.stat(sourcePath);
    if (!stat.isFile() || stat.size <= 1_000_000)
      throw importError("The model file is incomplete or too small.", "INVALID_GGUF");
    const metadata = await readGgufMetadataFromFile(sourcePath);
    if (
      !metadata ||
      !metadata.tensorCount ||
      !Number.isInteger(metadata.contextLength) ||
      metadata.contextLength < 1
    ) {
      throw importError(
        "This file does not contain valid GGUF text-model metadata.",
        "INVALID_GGUF"
      );
    }
    // Architecture compatibility is verified by the bundled runtime's load test.
    // An allow-list here would reject valid new llama.cpp architectures.
    if (metadata.splitCount > 1)
      throw importError(
        "Split GGUF models are not supported. Choose a single-file model.",
        "UNSUPPORTED_GGUF"
      );
    if (metadata.type && metadata.type !== "model")
      throw importError(
        "Choose a full text model, rather than an adapter or projector.",
        "UNSUPPORTED_GGUF"
      );
    signal?.throwIfAborted();
    await fs.promises.mkdir(this.modelsDir, { recursive: true });
    const space = await checkDiskSpace(this.modelsDir, stat.size);
    if (!space.ok)
      throw importError(
        "Not enough disk space to copy this model into the app.",
        "INSUFFICIENT_DISK_SPACE"
      );
    const id = `imported-${randomUUID()}`;
    const fileName = `${id}.gguf`;
    const modelPath = path.join(this.modelsDir, fileName);
    const temporary = `${modelPath}.importing`;
    try {
      await pipeline(
        fs.createReadStream(sourcePath),
        fs.createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
        { signal }
      );
      const copiedMetadata = await readGgufMetadataFromFile(temporary);
      const copiedStat = await fs.promises.stat(temporary);
      if (
        !copiedMetadata ||
        copiedStat.size !== stat.size ||
        JSON.stringify(copiedMetadata) !== JSON.stringify(metadata)
      ) {
        throw importError(
          "The model file changed during import. Please try again.",
          "INVALID_GGUF"
        );
      }
      signal?.throwIfAborted();
      await fs.promises.rename(temporary, modelPath);
      const model = {
        id,
        fileName,
        name: metadata.name?.slice(0, 160) || path.basename(sourcePath, path.extname(sourcePath)),
        size: `${(stat.size / 1_000_000_000).toFixed(2)} GB`,
        sizeBytes: stat.size,
        description: `Imported ${metadata.architecture} model`,
        architecture: metadata.architecture,
        contextLength: metadata.contextLength,
        quantization: "GGUF",
        hfRepo: "",
        imported: true,
        loadStatus: "untested",
      };
      this.models.push(model);
      try {
        this.save();
      } catch (error) {
        this.models = this.models.filter((entry) => entry.id !== id);
        throw error;
      }
      return model;
    } catch (error) {
      await fs.promises.rm(modelPath, { force: true });
      throw error;
    } finally {
      await fs.promises.rm(temporary, { force: true });
    }
  }

  updateLoadStatus(modelId, loadStatus, loadError) {
    const model = this.models.find((entry) => entry.id === modelId);
    if (!model) return;
    model.loadStatus = loadStatus;
    if (loadError) model.loadError = loadError;
    else delete model.loadError;
    this.save();
  }

  async deleteModel(modelId) {
    const model = this.models.find((entry) => entry.id === modelId);
    if (!model || !IMPORT_ID.test(modelId) || model.fileName !== `${modelId}.gguf`) {
      throw importError("Imported model not found.", "MODEL_NOT_FOUND");
    }
    // Only unlink the generated basename inside our own directory. A symlink
    // is unlinked itself; neither the original file nor a target is removed.
    await fs.promises.unlink(path.join(this.modelsDir, model.fileName)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    this.models = this.models.filter((entry) => entry.id !== modelId);
    this.save();
  }
}

module.exports = { ImportedModelStore, IMPORTED_PROVIDER };
