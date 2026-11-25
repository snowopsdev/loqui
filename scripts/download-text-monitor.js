#!/usr/bin/env node
/**
 * Legacy entry point. Text monitors are built from checked-in sources:
 * Linux from resources/linux-text-monitor.c, macOS via build-text-monitor.js.
 * Nothing is downloaded.
 *
 * Usage:
 *   node scripts/download-text-monitor.js
 */

const path = require("path");

// Keep the old command usable without fetching an inherited application asset.
if (process.platform === "linux") {
  const { spawnSync } = require("node:child_process");
  console.log("[linux-text-monitor] Building the checked-in native source (no prebuilt download)");
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "build-linux-text-monitor.js")],
    {
      stdio: "inherit",
    }
  );
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}

console.log(`[text-monitor] Skipping download (no prebuilt binary for ${process.platform})`);
