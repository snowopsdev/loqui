const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "../..");
const { getSupportCacheDir } = require("../../src/helpers/supportCacheDir");

// An isolated run (LOQUI_PROFILE_DIR / LOQUI_CACHE_ROOT) must neither read,
// write nor erase the real profile's home-directory state.

test("support caches follow LOQUI_CACHE_ROOT and keep the legacy home location otherwise", () => {
  const homeDir = path.join(path.sep, "home", "someone");
  assert.equal(
    getSupportCacheDir("qdrant-data", { env: { LOQUI_CACHE_ROOT: "/tmp/iso" }, homeDir }),
    path.join("/tmp/iso", "qdrant-data")
  );
  assert.equal(
    getSupportCacheDir("yt-dlp", { env: {}, homeDir }),
    path.join(homeDir, ".cache", "loqui-snowopsdev", "yt-dlp")
  );
});

test("the embedding model cache honors LOQUI_CACHE_ROOT", () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-iso-cache-"));
  const previous = process.env.LOQUI_CACHE_ROOT;
  process.env.LOQUI_CACHE_ROOT = cacheRoot;
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === "./onnxWorkerClient") return {};
    if (request === "./debugLogger") return { debug() {}, info() {}, warn() {}, error() {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  const modulePath = require.resolve("../../src/helpers/localEmbeddings");
  delete require.cache[modulePath];
  try {
    const loaded = require(modulePath);
    const LocalEmbeddings = loaded.LocalEmbeddings || loaded;
    const { modelDir } = new LocalEmbeddings();
    // Bundled/project copies legitimately take precedence when present.
    if (modelDir.startsWith(root)) return;
    assert.equal(modelDir, path.join(cacheRoot, "embedding-models", "all-MiniLM-L6-v2"));
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
    if (previous === undefined) delete process.env.LOQUI_CACHE_ROOT;
    else process.env.LOQUI_CACHE_ROOT = previous;
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

// Cache locations must come from getSupportCacheDir / modelDirUtils so that
// LOQUI_CACHE_ROOT applies. Anything that builds one from XDG_CACHE_HOME or a
// literal ".cache" (or the product cache name next to a home directory) bypasses it.
test("no source file builds a loqui cache path outside the isolation-aware helpers", () => {
  const allowed = new Set([
    "src/helpers/supportCacheDir.js",
    "src/helpers/modelDirUtils.js",
    // Not a cache: the CLI bridge file's fixed home location (isolated runs are
    // redirected by resolveBridgeFilePath, covered below).
    "src/helpers/cliBridge.js",
  ]);
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!["locales", "node_modules"].includes(entry.name)) walk(rel);
      } else if (/\.(js|cjs|mjs|ts|tsx|jsx)$/.test(entry.name) && !allowed.has(rel)) {
        const source = fs.readFileSync(path.join(root, rel), "utf8");
        if (
          /XDG_CACHE_HOME/.test(source) ||
          /["']\.cache["']/.test(source) ||
          /["']\.cache[\\/]/.test(source) ||
          /(homedir\(\)|getPath\(["']home["']\))[\s\S]{0,120}loqui-snowopsdev/.test(source)
        ) {
          offenders.push(rel);
        }
      }
    }
  };
  walk("src");
  const mainSource = fs.readFileSync(path.join(root, "main.js"), "utf8");
  if (/XDG_CACHE_HOME|["']\.cache["']/.test(mainSource)) offenders.push("main.js");
  assert.deepEqual(offenders, []);
});

test("device erasure resolves cache directories through the isolation-aware helper", () => {
  const source = fs.readFileSync(path.join(root, "src/helpers/ipcHandlers.js"), "utf8");
  assert.ok(!/os\.homedir\(\),\s*"\.cache"/.test(source));
  assert.ok(source.includes("getSupportCacheDir(cacheName)"));
});

test("an isolated profile keeps its CLI bridge file out of the real home directory", () => {
  const CliBridge = require("../../src/helpers/cliBridge");
  const userDataPath = path.join(os.tmpdir(), "loqui-iso-profile");

  assert.equal(
    CliBridge.resolveBridgeFilePath({ isolatedProfile: true, userDataPath }),
    path.join(userDataPath, "cli-bridge.json")
  );
  assert.equal(
    CliBridge.resolveBridgeFilePath({ isolatedProfile: false, userDataPath }),
    path.join(os.homedir(), ".loqui-snowopsdev", "cli-bridge.json")
  );

  const mainSource = fs.readFileSync(path.join(root, "main.js"), "utf8");
  assert.ok(mainSource.includes("CliBridge.resolveBridgeFilePath"));
  assert.ok(mainSource.includes("!app.isPackaged && !!process.env.LOQUI_PROFILE_DIR"));
});
