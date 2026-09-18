const product = require("../config/product.json");
const { app } = require("electron");
const cacheName = product.cacheName + (app?.isPackaged === false ? "-development" : "");
const os = require("os");
const fs = require("fs");
const path = require("path");

// Same rule as safeTempDir: native whisper/parakeet binaries crash on Windows
// when model paths contain spaces or non-ASCII (CJK / Cyrillic profile dirs).
function pathHasProblematicChars(candidate) {
  return !/^[\x21-\x7E]*$/.test(candidate);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getAsciiSafeFallbackRoot() {
  const candidates = [
    path.join(process.env.ProgramData || "C:\\ProgramData", "io.github.snowopsdev.loqui", "cache"),
    path.join(process.env.SystemDrive || "C:", "io.github.snowopsdev.loqui", "cache"),
  ];

  for (const candidate of candidates) {
    if (pathHasProblematicChars(candidate)) continue;
    try {
      return ensureDir(candidate);
    } catch {}
  }

  return null;
}

function getPreferredCacheRoot(homeCache) {
  if (process.env[product.env.cache]) {
    return process.env[product.env.cache];
  }

  if (process.platform === "win32") {
    const redirectedProfile = process.env.USERPROFILE;
    if (redirectedProfile && path.isAbsolute(redirectedProfile)) {
      return path.join(redirectedProfile, ".cache", cacheName);
    }
  }

  if (process.platform === "linux") {
    const xdgCacheHome = process.env.XDG_CACHE_HOME;
    if (xdgCacheHome && path.isAbsolute(xdgCacheHome)) {
      return path.join(xdgCacheHome, cacheName);
    }
  }

  return homeCache;
}

function getCacheRoot() {
  const homeDir = app?.getPath?.("home") || os.homedir();
  const homeCache = path.join(homeDir, ".cache", cacheName);
  let targetRoot = getPreferredCacheRoot(homeCache);

  if (process.platform === "win32" && pathHasProblematicChars(targetRoot)) {
    targetRoot = getAsciiSafeFallbackRoot() || homeCache;
  }

  // A cache preference chooses a storage location; it never imports, moves, or
  // deletes files from another location. In particular, test-runner overrides
  // must not move real downloaded models into a temporary directory.
  return targetRoot;
}

function getModelsDirForService(service) {
  return path.join(getCacheRoot(), `${service}-models`);
}

module.exports = {
  getCacheRoot,
  getModelsDirForService,
  pathHasProblematicChars,
};
