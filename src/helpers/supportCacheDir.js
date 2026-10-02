const os = require("os");
const path = require("path");
const product = require("../config/product.json");

// Cache directories for support data that is not a downloaded speech/LLM model
// (vector index, embedding model, yt-dlp). They default to the shared home
// cache, but an explicit LOQUI_CACHE_ROOT must redirect every one of them:
// that override is how tests and isolated runs avoid reading, writing or
// erasing the real profile's data. Without the override the legacy location is
// kept unchanged so existing installs are never silently relocated.
function getSupportCacheDir(name, { env = process.env, homeDir = os.homedir() } = {}) {
  const override = env[product.env.cache];
  const root = override || path.join(homeDir, ".cache", product.cacheName);
  return path.join(root, name);
}

module.exports = { getSupportCacheDir };
