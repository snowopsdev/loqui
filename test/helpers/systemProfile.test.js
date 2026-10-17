const assert = require("node:assert/strict");
const test = require("node:test");
const { getSystemProfile, normalizeLocales } = require("../../src/helpers/systemProfile");

const enoent = () => Object.assign(new Error("missing"), { code: "ENOENT" });

test("reads preferred languages, free space and Apple silicon without probing NVIDIA", async () => {
  const profile = await getSystemProfile({
    app: { getPreferredSystemLanguages: () => ["es-ES", "en-US", "es-ES"], getLocale: () => "en-US" },
    platform: "darwin",
    arch: "arm64",
    statfs: async (dir) => {
      assert.equal(dir, "/cache/loqui");
      return { bavail: 1000, bsize: 4096 };
    },
    cacheRoot: "/cache/loqui",
    detectGpu: async () => {
      throw new Error("must not probe NVIDIA on Apple silicon");
    },
  });
  assert.deepEqual(profile, {
    locales: ["es-ES", "en-US"],
    freeDiskBytes: 4096000,
    gpu: { kind: "apple-silicon", name: null },
  });
  assert.equal("totalMemoryBytes" in profile, false, "memory comes from Plan 03's get-total-memory (§5.1)");
});

test("free space is read from the nearest existing parent of the model cache", async () => {
  const seen = [];
  const profile = await getSystemProfile({
    app: { getLocale: () => "en-US" },
    platform: "linux",
    arch: "x64",
    statfs: async (dir) => {
      seen.push(dir);
      if (dir !== "/home/u") throw enoent();
      return { bavail: 10, bsize: 1000 };
    },
    cacheRoot: "/home/u/.cache/loqui",
    detectGpu: async () => ({ hasNvidiaGpu: false }),
  });
  assert.deepEqual(seen, ["/home/u/.cache/loqui", "/home/u/.cache", "/home/u"]);
  assert.equal(profile.freeDiskBytes, 10000);
  assert.deepEqual(profile.gpu, { kind: "unknown", name: null });
});

test("unknowns are null, never guesses; an NVIDIA card is named", async () => {
  const profile = await getSystemProfile({
    app: { getLocale: () => "fr-FR" },
    platform: "win32",
    arch: "x64",
    statfs: async () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    },
    cacheRoot: "C:\\cache",
    detectGpu: async () => ({ hasNvidiaGpu: true, gpuName: "NVIDIA GeForce RTX 4070" }),
  });
  assert.deepEqual(profile, {
    locales: ["fr-FR"],
    freeDiskBytes: null,
    gpu: { kind: "nvidia", name: "NVIDIA GeForce RTX 4070" },
  });
});

test("a failing GPU probe is unknown, not an error", async () => {
  const profile = await getSystemProfile({
    app: {},
    platform: "linux",
    arch: "x64",
    statfs: async () => ({ bavail: 1, bsize: 1 }),
    cacheRoot: "/c",
    detectGpu: async () => {
      throw new Error("nvidia-smi missing");
    },
  });
  assert.deepEqual(profile.gpu, { kind: "unknown", name: null });
  assert.deepEqual(profile.locales, []);
});

test("locales are trimmed, deduplicated and capped at eight", () => {
  assert.deepEqual(normalizeLocales([" en-US ", "", 3, "en-US", "de-DE"], "fr-FR"), ["en-US", "de-DE"]);
  assert.deepEqual(normalizeLocales(undefined, "ja-JP"), ["ja-JP"]);
  assert.equal(normalizeLocales(Array.from({ length: 20 }, (_, i) => `x${i}`)).length, 8);
});
