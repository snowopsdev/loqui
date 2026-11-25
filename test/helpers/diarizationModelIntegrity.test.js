const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

// diarization.js reaches for electron at load time; stub what it touches.
require.cache[require.resolve("electron")] = {
  exports: {
    app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd(), isPackaged: false },
    net: {},
  },
};

// Record every model download instead of hitting the network.
const downloadUtilsPath = require.resolve("../../src/helpers/downloadUtils.js");
const realDownloadUtils = require(downloadUtilsPath);
const downloads = [];
require.cache[downloadUtilsPath].exports = {
  ...realDownloadUtils,
  checkDiskSpace: async () => ({ ok: true, availableBytes: Number.MAX_SAFE_INTEGER }),
  downloadFile: async (url, destPath, options) => {
    downloads.push({ url, destPath, sha256: options.sha256 });
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, "model bytes");
    return destPath;
  },
};

const DiarizationManager = require("../../src/helpers/diarization.js");
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

function managerIn(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diarization-integrity-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manager = new DiarizationManager();
  manager.getModelsDir = () => dir;
  manager.getBundledModelsDir = () => null;
  manager._extractTarBz2 = async (_archive, destDir) => {
    const segDir = path.join(destDir, "sherpa-onnx-pyannote-segmentation-3-0");
    fs.mkdirSync(segDir, { recursive: true });
    fs.writeFileSync(path.join(segDir, "model.onnx"), "segmentation");
  };
  return { manager, dir };
}

test("in-app diarization pins match runtime-assets.json", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../runtime-assets.json"), "utf8")
  );
  const pinned = new Map(manifest.assets.map((asset) => [asset.url, asset]));
  assert.equal(DiarizationManager.PINNED_DOWNLOADS.length, 3);
  for (const { url, sha256: digest } of DiarizationManager.PINNED_DOWNLOADS) {
    const asset = pinned.get(url);
    assert.ok(asset, `${url} is pinned in runtime-assets.json`);
    // A plain file digest, not tar-contents-v1, so it applies to the downloaded bytes.
    assert.equal(asset.hashKind, undefined, url);
    assert.equal(digest, asset.sha256, url);
  }
});

test("every model download carries its pinned digest", async (t) => {
  downloads.length = 0;
  const { manager } = managerIn(t);
  await manager.downloadModels();
  const expected = new Map(DiarizationManager.PINNED_DOWNLOADS.map((p) => [p.url, p.sha256]));
  assert.equal(downloads.length, 3);
  for (const download of downloads) {
    assert.ok(expected.has(download.url), download.url);
    assert.equal(download.sha256, expected.get(download.url), download.url);
  }
});

test("a downloaded model that doesn't match its pin is replaced, a matching one kept", async (t) => {
  const { manager, dir } = managerIn(t);
  const file = path.join(dir, "model.onnx");

  fs.writeFileSync(file, "the expected bytes");
  await manager._discardMismatchedDownload(file, sha256("the expected bytes"));
  assert.equal(fs.readFileSync(file, "utf8"), "the expected bytes");

  fs.writeFileSync(file, "a re-uploaded or damaged file");
  await manager._discardMismatchedDownload(file, sha256("the expected bytes"));
  assert.equal(fs.existsSync(file), false);

  // A missing file is simply not there yet.
  await manager._discardMismatchedDownload(file, sha256("the expected bytes"));
});

test("downloadModels re-fetches an existing embedding model that fails its pin", async (t) => {
  downloads.length = 0;
  const { manager, dir } = managerIn(t);
  // Everything already present, but the embedding model is the wrong file.
  await manager.downloadModels();
  downloads.length = 0;
  fs.writeFileSync(path.join(dir, "3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx"), "stale");

  await manager.downloadModels();

  const embedding = DiarizationManager.PINNED_DOWNLOADS[1];
  assert.ok(downloads.some((d) => d.url === embedding.url && d.sha256 === embedding.sha256));
});
