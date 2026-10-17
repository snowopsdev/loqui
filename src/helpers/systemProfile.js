"use strict";
// Facts setup uses to recommend a voice (spec D8): OS languages, free space
// where models are stored, and the GPU. Total memory comes from Plan 03's
// get-total-memory (§5.1). Read on this device, returned to the setup window,
// never stored or sent anywhere.
const path = require("path");
const fsPromises = require("fs/promises");

const MAX_LOCALES = 8;
const MAX_PARENT_HOPS = 8;

function normalizeLocales(list, fallback) {
  const values = (Array.isArray(list) ? list : [])
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim());
  if (values.length === 0 && typeof fallback === "string" && fallback.trim()) {
    values.push(fallback.trim());
  }
  return [...new Set(values)].slice(0, MAX_LOCALES);
}

// The cache root may not exist on first run; free space is the same for the
// nearest existing parent on the same volume.
async function freeBytesAt(directory, statfs) {
  let current = directory;
  for (let hop = 0; hop <= MAX_PARENT_HOPS; hop++) {
    try {
      const stats = await statfs(current);
      const free = Number(stats.bavail) * Number(stats.bsize);
      return Number.isFinite(free) && free >= 0 ? free : null;
    } catch (error) {
      const parent = path.dirname(current);
      if (error?.code !== "ENOENT" || parent === current) return null;
      current = parent;
    }
  }
  return null;
}

async function detectGpuKind({ platform, arch, detectGpu }) {
  if (platform === "darwin" && arch === "arm64") return { kind: "apple-silicon", name: null };
  if (typeof detectGpu !== "function") return { kind: "unknown", name: null };
  try {
    const info = await detectGpu();
    if (info?.hasNvidiaGpu) return { kind: "nvidia", name: info.gpuName ?? null };
  } catch {
    // A missing nvidia-smi is the common case, not an error.
  }
  return { kind: "unknown", name: null };
}

async function getSystemProfile({
  app,
  platform = process.platform,
  arch = process.arch,
  statfs = fsPromises.statfs,
  cacheRoot,
  detectGpu,
} = {}) {
  return {
    locales: normalizeLocales(app?.getPreferredSystemLanguages?.(), app?.getLocale?.()),
    freeDiskBytes: cacheRoot ? await freeBytesAt(cacheRoot, statfs) : null,
    gpu: await detectGpuKind({ platform, arch, detectGpu }),
  };
}

module.exports = { getSystemProfile, normalizeLocales };
