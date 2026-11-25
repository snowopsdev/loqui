const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  copyLibraries,
  findLibrariesInDir,
  matchesPattern,
} = require("../../scripts/lib/download-utils");
const {
  BINARIES,
  WHISPER_CPP_TAG,
  downloadAllBinaries,
  isCompleteInstall,
} = require("../../scripts/download-whisper-cpp");

test("all-platform mode reports failure after attempting every configured download", async () => {
  const attempts = [];
  const download = async (platformArch) => {
    attempts.push(platformArch);
    return platformArch !== "linux-x64";
  };

  assert.equal(await downloadAllBinaries({ assets: [] }, false, download), false);
  assert.deepEqual(attempts, Object.keys(BINARIES));
});

test("cached install is complete only for the current tag with every required library", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "whisper-install-test-"));
  const config = {
    ...BINARIES["linux-x64"],
    requiredLibraries: ["libwhisper.so", "libggml.so"],
  };
  const binaryPath = path.join(tempDir, config.outputName);
  const markerPath = path.join(tempDir, ".whisper-cpp-linux-x64.json");
  const requiredLibraries = config.requiredLibraries;

  fs.writeFileSync(binaryPath, "binary");
  for (const library of requiredLibraries) {
    fs.writeFileSync(path.join(tempDir, library), library);
  }

  try {
    assert.equal(isCompleteInstall(markerPath, binaryPath, config), false);

    fs.writeFileSync(
      markerPath,
      JSON.stringify({ version: "0.0.9", libraries: requiredLibraries })
    );
    assert.equal(isCompleteInstall(markerPath, binaryPath, config), false);

    fs.writeFileSync(
      markerPath,
      JSON.stringify({ version: WHISPER_CPP_TAG, libraries: requiredLibraries.slice(1) })
    );
    assert.equal(isCompleteInstall(markerPath, binaryPath, config), false);

    fs.writeFileSync(
      markerPath,
      JSON.stringify({ version: WHISPER_CPP_TAG, libraries: requiredLibraries })
    );
    assert.equal(isCompleteInstall(markerPath, binaryPath, config), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("copyLibraries copies matching libraries from a nested extract dir", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "whisper-dll-test-"));
  const extractDir = path.join(tempDir, "extract", "nested");
  const destDir = path.join(tempDir, "bin");
  fs.mkdirSync(extractDir, { recursive: true });
  fs.mkdirSync(destDir, { recursive: true });

  const dlls = ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll", "vcomp140.dll"];
  for (const name of [...dlls, "whisper-server-win32-x64-cpu.exe", "README.md"]) {
    fs.writeFileSync(path.join(extractDir, name), name);
  }

  try {
    const copied = copyLibraries(path.join(tempDir, "extract"), destDir, "*.dll");

    assert.deepEqual(copied.sort(), dlls.slice().sort());
    for (const name of dlls) {
      assert.ok(fs.existsSync(path.join(destDir, name)), `${name} should be copied`);
    }
    assert.ok(!fs.existsSync(path.join(destDir, "whisper-server-win32-x64-cpu.exe")));
    assert.ok(!fs.existsSync(path.join(destDir, "README.md")));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("findLibrariesInDir propagates traversal errors by default", () => {
  const missingDir = path.join(os.tmpdir(), `missing-library-dir-${process.pid}-${Date.now()}`);

  assert.throws(() => findLibrariesInDir(missingDir, "*.dll"), { code: "ENOENT" });
});

test("findLibrariesInDir supports explicit best-effort traversal", () => {
  const missingDir = path.join(os.tmpdir(), `missing-library-dir-${process.pid}-${Date.now()}`);

  assert.deepEqual(findLibrariesInDir(missingDir, "*.dll", { ignoreReadErrors: true }), []);
});

test("matchesPattern matches each supported library pattern", () => {
  assert.ok(matchesPattern("msvcp140.dll", "*.dll"));
  assert.ok(!matchesPattern("whisper-server.exe", "*.dll"));
  assert.ok(matchesPattern("libggml.dylib", "*.dylib"));
  assert.ok(!matchesPattern("libggml.dylib", "*.dll"));
  assert.ok(matchesPattern("libonnxruntime.so", "*.so*"));
  assert.ok(matchesPattern("libonnxruntime.so.1.23.2", "*.so*"));
  assert.ok(!matchesPattern("libonnxruntime.so.1.txt", "*.so*"));
});
