const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("node:module");
const { describe, it, beforeEach, afterEach } = require("node:test");

describe("modelDirUtils cache policy (#1279, #1399)", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  const originalEnv = { ...process.env };
  const originalLoad = Module._load;
  let tempRoot;
  let mockedHome;

  function loadFresh(homeDir) {
    mockedHome = homeDir;
    Module._load = function loadWithElectronStub(request, parent, isMain) {
      if (request === "electron") {
        return {
          app: {
            getPath: (name) => (name === "home" ? mockedHome : tempRoot),
            isReady: () => true,
          },
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    const resolved = require.resolve("../../src/helpers/modelDirUtils");
    delete require.cache[resolved];
    return require("../../src/helpers/modelDirUtils");
  }

  function setPlatform(platform) {
    Object.defineProperty(process, "platform", { value: platform });
  }

  function createRedirectedWindowsFixture() {
    setPlatform("win32");
    const home = path.join(tempRoot, "Users", "stan");
    const legacyRoot = path.join(home, ".cache", "loqui-snowopsdev");
    const redirectedProfile = path.join(tempRoot, "RedirectedUsers", "stan");
    const redirectedRoot = path.join(redirectedProfile, ".cache", "loqui-snowopsdev");
    process.env.USERPROFILE = redirectedProfile;
    return { home, legacyRoot, redirectedRoot };
  }

  function writeModel(directory, name, contents) {
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, name);
    fs.writeFileSync(filePath, contents);
    return filePath;
  }

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ow-cache-test-"));
    process.env = { ...originalEnv };
    delete process.env.LOQUI_CACHE_ROOT;
    delete process.env.USERPROFILE;
    delete process.env.XDG_CACHE_HOME;
  });

  afterEach(() => {
    Module._load = originalLoad;
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
    process.env = { ...originalEnv };
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("pathHasProblematicChars flags non-ASCII and spaces", () => {
    const { pathHasProblematicChars } = loadFresh(path.join(tempRoot, "ascii-user"));
    assert.strictEqual(pathHasProblematicChars("C:\\Users\\Anton\\.cache\\openwhispr"), false);
    assert.strictEqual(pathHasProblematicChars("C:\\Users\\Антон\\.cache\\openwhispr"), true);
    assert.strictEqual(pathHasProblematicChars("C:\\Users\\詩涵\\.cache\\openwhispr"), true);
    assert.strictEqual(pathHasProblematicChars("C:\\Users\\Stan Shih\\.cache\\openwhispr"), true);
  });

  it("honors LOQUI_CACHE_ROOT when ASCII-safe", () => {
    setPlatform("win32");
    const override = path.join(tempRoot, "ascii-cache");
    process.env.LOQUI_CACHE_ROOT = override;
    const { getCacheRoot } = loadFresh(path.join(tempRoot, "使用者", "詩涵"));
    assert.strictEqual(getCacheRoot(), override);
  });

  it("gives LOQUI_CACHE_ROOT precedence over an ASCII-safe Windows home", () => {
    setPlatform("win32");
    const home = path.join(tempRoot, "Users", "stan");
    const override = path.join(tempRoot, "custom-cache");
    process.env.LOQUI_CACHE_ROOT = override;

    const { getCacheRoot } = loadFresh(home);

    assert.strictEqual(getCacheRoot(), override);
  });

  it("uses a redirected USERPROFILE on Windows", () => {
    const { home, redirectedRoot } = createRedirectedWindowsFixture();

    const { getCacheRoot } = loadFresh(home);

    assert.strictEqual(getCacheRoot(), redirectedRoot);
  });

  it("honors an absolute XDG_CACHE_HOME on Linux", () => {
    setPlatform("linux");
    const home = path.join(tempRoot, "home", "stan");
    const xdgCacheHome = path.join(tempRoot, "xdg-cache");
    process.env.XDG_CACHE_HOME = xdgCacheHome;

    const { getCacheRoot } = loadFresh(home);

    assert.strictEqual(getCacheRoot(), path.join(xdgCacheHome, "loqui-snowopsdev"));
  });

  it("gives LOQUI_CACHE_ROOT precedence over XDG_CACHE_HOME", () => {
    setPlatform("linux");
    const home = path.join(tempRoot, "home", "stan");
    const override = path.join(tempRoot, "custom-cache");
    process.env.LOQUI_CACHE_ROOT = override;
    process.env.XDG_CACHE_HOME = path.join(tempRoot, "xdg-cache");

    const { getCacheRoot } = loadFresh(home);

    assert.strictEqual(getCacheRoot(), override);
  });

  it("keeps the home cache when XDG_CACHE_HOME is relative", () => {
    setPlatform("linux");
    const home = path.join(tempRoot, "home", "stan");
    process.env.XDG_CACHE_HOME = "relative-cache";

    const { getCacheRoot } = loadFresh(home);

    assert.strictEqual(getCacheRoot(), path.join(home, ".cache", "loqui-snowopsdev"));
  });

  it("preserves the macOS home-cache default", () => {
    setPlatform("darwin");
    const home = path.join(tempRoot, "Users", "stan");

    const { getCacheRoot } = loadFresh(home);

    assert.strictEqual(getCacheRoot(), path.join(home, ".cache", "loqui-snowopsdev"));
  });

  it("honors LOQUI_CACHE_ROOT on macOS", () => {
    setPlatform("darwin");
    const home = path.join(tempRoot, "Users", "stan");
    const override = path.join(tempRoot, "custom-cache");
    process.env.LOQUI_CACHE_ROOT = override;

    const { getCacheRoot } = loadFresh(home);

    assert.strictEqual(getCacheRoot(), override);
  });

  it("falls back to ProgramData when redirected USERPROFILE is unsafe", () => {
    setPlatform("win32");
    const home = path.join(tempRoot, "Users", "stan");
    const programData = path.join(tempRoot, "ProgramData");
    process.env.USERPROFILE = path.join(tempRoot, "Redirected Users", "stan");
    process.env.ProgramData = programData;

    const { getCacheRoot } = loadFresh(home);

    assert.strictEqual(getCacheRoot(), path.join(programData, "io.github.snowopsdev.loqui", "cache"));
  });

  it("skips an unsafe ProgramData fallback", () => {
    setPlatform("win32");
    const home = path.join(tempRoot, "Users", "stan");
    const systemDrive = path.join(tempRoot, "SystemDrive");
    process.env.USERPROFILE = path.join(tempRoot, "Redirected Users", "stan");
    process.env.ProgramData = path.join(tempRoot, "Program Data");
    process.env.SystemDrive = systemDrive;

    const { getCacheRoot } = loadFresh(home);

    assert.strictEqual(getCacheRoot(), path.join(systemDrive, "io.github.snowopsdev.loqui", "cache"));
  });

  it("keeps all model consumers on the selected cache root", () => {
    setPlatform("win32");
    const home = path.join(tempRoot, "Users", "stan");
    const override = path.join(tempRoot, "custom-cache");
    process.env.LOQUI_CACHE_ROOT = override;

    const { getCacheRoot, getModelsDirForService } = loadFresh(home);

    assert.strictEqual(getCacheRoot(), override);
    assert.strictEqual(getModelsDirForService("whisper"), path.join(override, "whisper-models"));
    assert.strictEqual(getModelsDirForService("parakeet"), path.join(override, "parakeet-models"));
    assert.strictEqual(
      getModelsDirForService("diarization"),
      path.join(override, "diarization-models")
    );
    assert.strictEqual(path.join(getCacheRoot(), "models"), path.join(override, "models"));
  });

  it("falls back to ProgramData cache when home cache path is non-ASCII", () => {
    setPlatform("win32");
    const programData = path.join(tempRoot, "ProgramData");
    process.env.ProgramData = programData;

    const { getCacheRoot, getModelsDirForService } = loadFresh(
      path.join(tempRoot, "使用者", "詩涵")
    );
    const root = getCacheRoot();
    assert.strictEqual(root, path.join(programData, "io.github.snowopsdev.loqui", "cache"));
    assert.ok(fs.existsSync(root));
    assert.strictEqual(getModelsDirForService("whisper"), path.join(root, "whisper-models"));
  });

  it("keeps home cache on Windows when the path is ASCII-safe", () => {
    setPlatform("win32");
    const home = path.join(tempRoot, "Users", "stan");
    const { getCacheRoot } = loadFresh(home);
    assert.strictEqual(getCacheRoot(), path.join(home, ".cache", "loqui-snowopsdev"));
  });

  function populateDefaultCache(home) {
    const root = path.join(home, ".cache", "loqui-snowopsdev");
    return [
      ["models", "Qwen_Qwen3.5-2B-Q4_K_M.gguf", "real text model"],
      ["models", "imported-models.json", '{"version":1,"models":[]}'],
      ["parakeet-models", "model.onnx", "real speech model"],
      ["whisper-models", "ggml-base.bin", "real whisper model"],
      ["diarization-models", "speaker.onnx", "real speaker model"],
      ["embedding-models", "model.onnx", "real embedding model"],
    ].map(([directory, name, contents]) => {
      const file = writeModel(path.join(root, directory), name, contents);
      return { file, contents, inode: fs.statSync(file).ino };
    });
  }

  function assertDefaultCacheUntouched(fixtures) {
    for (const { file, contents, inode } of fixtures) {
      assert.equal(fs.readFileSync(file, "utf8"), contents, `preserved contents: ${file}`);
      assert.equal(fs.statSync(file).ino, inode, `preserved original file: ${file}`);
    }
  }

  for (const platform of ["linux", "darwin", "win32"]) {
    it(`an explicit cache override never moves default models on ${platform}`, () => {
      setPlatform(platform);
      const home = path.join(tempRoot, "home");
      const fixtures = populateDefaultCache(home);
      const override = path.join(tempRoot, "disposable-test-cache");
      fs.mkdirSync(override);
      process.env.LOQUI_CACHE_ROOT = override;
      const { getCacheRoot, getModelsDirForService } = loadFresh(home);

      assert.equal(getCacheRoot(), override);
      assert.equal(getModelsDirForService("parakeet"), path.join(override, "parakeet-models"));
      assert.deepEqual(fs.readdirSync(override), [], "selection must not import real model files");
      assertDefaultCacheUntouched(fixtures);

      // Mirrors scripts/run-tests.js cleanup, the operation that exposed the bug.
      fs.rmSync(override, { recursive: true, force: true });
      assertDefaultCacheUntouched(fixtures);
      delete process.env.LOQUI_CACHE_ROOT;
      assert.equal(getCacheRoot(), path.join(home, ".cache", "loqui-snowopsdev"));
    });
  }

  it("changing XDG_CACHE_HOME selects an independent cache without migrating models", () => {
    setPlatform("linux");
    const home = path.join(tempRoot, "home");
    const fixtures = populateDefaultCache(home);
    process.env.XDG_CACHE_HOME = path.join(tempRoot, "xdg");
    const { getCacheRoot } = loadFresh(home);
    const selected = getCacheRoot();
    assert.equal(selected, path.join(process.env.XDG_CACHE_HOME, "loqui-snowopsdev"));
    assert.equal(fs.existsSync(path.join(selected, "models")), false);
    assertDefaultCacheUntouched(fixtures);
  });

  it("redirected USERPROFILE does not import files from the old home cache", () => {
    const { home, redirectedRoot } = createRedirectedWindowsFixture();
    const fixtures = populateDefaultCache(home);
    const { getCacheRoot } = loadFresh(home);
    assert.equal(getCacheRoot(), redirectedRoot);
    assert.equal(fs.existsSync(path.join(redirectedRoot, "models")), false);
    assertDefaultCacheUntouched(fixtures);
  });

  it("an ASCII-safe Windows fallback leaves existing home models in place", () => {
    setPlatform("win32");
    const home = path.join(tempRoot, "使用者", "詩涵");
    const fixtures = populateDefaultCache(home);
    process.env.ProgramData = path.join(tempRoot, "ProgramData");
    const { getCacheRoot } = loadFresh(home);
    const selected = getCacheRoot();
    assert.equal(selected, path.join(process.env.ProgramData, "io.github.snowopsdev.loqui", "cache"));
    assert.equal(fs.existsSync(path.join(selected, "models")), false);
    assertDefaultCacheUntouched(fixtures);
  });
});
