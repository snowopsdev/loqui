const path = require("path");
const fs = require("fs");
const os = require("os");

// Clean build directories
console.log("🧹 Cleaning build directories...");
const dirsToClean = ["dist/", "src/dist/", "node_modules/.cache/"];

dirsToClean.forEach((dir) => {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`✅ Cleaned: ${dir}`);
  } else {
    console.log(`ℹ️ Directory not found: ${dir}`);
  }
});

// Clean development database
console.log("🗄️ Cleaning development database...");
try {
  // Mirror main.js: the development channel profile lives under appData as
  // `${profileName}-development`, unless LOQUI_PROFILE_DIR overrides it.
  const product = require("./src/config/product.json");
  const appDataPath =
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support")
      : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const userDataPath =
    process.env[product.env.profile] ||
    path.join(appDataPath, `${product.profileName}-development`);

  const devDbPath = path.join(userDataPath, "transcriptions-dev.db");

  // Clean development database
  if (fs.existsSync(devDbPath)) {
    fs.unlinkSync(devDbPath);
    console.log(`✅ Development database cleaned: ${devDbPath}`);
  } else {
    console.log("ℹ️ No development database found to clean");
  }
} catch (error) {
  console.error("❌ Error cleaning database files:", error.message);
}

console.log("✨ Cleanup completed successfully!");
