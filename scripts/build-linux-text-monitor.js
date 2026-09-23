#!/usr/bin/env node
/**
 * Ensures the Linux text monitor binary is available.
 *
 * Strategy:
 * 1. Compile the checked-in source in CI and release builds, failing on errors
 * 2. Reuse a matching local build during development
 * 3. Allow the existing Python fallback for development without AT-SPI2 headers
 *
 * Native helpers never come from upstream application release downloads.
 */

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const isLinux = process.platform === "linux";
if (!isLinux) {
  process.exit(0);
}
const strictBuild =
  process.env.LOQUI_RELEASE_BUILD === "1" || ["1", "true"].includes(process.env.CI);

const projectRoot = path.resolve(__dirname, "..");
const cSource = path.join(projectRoot, "resources", "linux-text-monitor.c");
const outputDir = path.join(projectRoot, "resources", "bin");
const outputBinary = path.join(outputDir, "linux-text-monitor");
const hashFile = path.join(outputDir, ".linux-text-monitor.hash");

function log(message) {
  console.log(`[linux-text-monitor] ${message}`);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function isBinaryUpToDate() {
  if (!fs.existsSync(outputBinary)) {
    return false;
  }

  if (!fs.existsSync(cSource)) {
    return false;
  }

  try {
    const binaryStat = fs.statSync(outputBinary);
    const sourceStat = fs.statSync(cSource);
    if (binaryStat.mtimeMs < sourceStat.mtimeMs) {
      return false;
    }
  } catch {
    return false;
  }

  // Check source + build flags hash
  try {
    const pkgFlags = getPkgConfigFlags();
    if (!pkgFlags) return false;
    const flagStr = pkgFlags.join(" ");
    const sourceContent = fs.readFileSync(cSource, "utf8");
    const currentHash = crypto
      .createHash("sha256")
      .update(sourceContent + flagStr)
      .digest("hex");

    if (fs.existsSync(hashFile)) {
      const savedHash = fs.readFileSync(hashFile, "utf8").trim();
      if (savedHash !== currentHash) {
        log("Source or build flags changed, rebuild needed");
        return false;
      }
    } else {
      // An existing binary without a build hash has unknown provenance.
      return false;
    }
  } catch (err) {
    log(`Hash check failed: ${err.message}, forcing rebuild`);
    return false;
  }

  return true;
}

function getPkgConfigFlags() {
  try {
    const check = spawnSync("pkg-config", ["--exists", "atspi-2"], {
      stdio: "pipe",
      env: process.env,
    });
    if (check.status !== 0) return null;

    const result = spawnSync("pkg-config", ["--cflags", "--libs", "atspi-2"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    if (result.status !== 0) return null;

    // atspi-2.pc lists gobject-2.0 under Requires.private, so plain --libs
    // omits -lgobject-2.0; add it explicitly for --as-needed linkers.
    return [...result.stdout.toString().trim().split(/\s+/).filter(Boolean), "-lgobject-2.0"];
  } catch {
    return null;
  }
}

function attemptCompile(command, args) {
  log(`Compiling with ${[command, ...args].join(" ")}`);
  return spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
}

function tryCompile() {
  if (!fs.existsSync(cSource)) {
    log("C source not found, cannot compile locally");
    return false;
  }

  const pkgFlags = getPkgConfigFlags();
  if (!pkgFlags) {
    log("AT-SPI2 development headers not found, cannot compile locally");
    return false;
  }

  log("Attempting local compilation...");

  const compiledBinary = `${outputBinary}.building-${process.pid}`;
  fs.rmSync(compiledBinary, { force: true });
  const compileArgs = ["-O2", cSource, "-o", compiledBinary, ...pkgFlags];

  let result = attemptCompile("gcc", compileArgs);
  if (result.status !== 0) {
    result = attemptCompile("cc", compileArgs);
  }

  if (result.status !== 0) {
    fs.rmSync(compiledBinary, { force: true });
    return false;
  }

  if (!fs.existsSync(compiledBinary) || fs.statSync(compiledBinary).size === 0) {
    fs.rmSync(compiledBinary, { force: true });
    log("Compiler did not produce a nonempty text monitor binary");
    return false;
  }

  try {
    fs.chmodSync(compiledBinary, 0o755);
  } catch (error) {
    if (strictBuild) throw error;
    console.warn(`[linux-text-monitor] Unable to set executable permissions: ${error.message}`);
  }
  fs.renameSync(compiledBinary, outputBinary);

  try {
    const sourceContent = fs.readFileSync(cSource, "utf8");
    const flagStr = pkgFlags.join(" ");
    const hash = crypto
      .createHash("sha256")
      .update(sourceContent + flagStr)
      .digest("hex");
    fs.writeFileSync(hashFile, hash);
  } catch (err) {
    if (strictBuild) throw err;
    log(`Warning: Could not save source hash: ${err.message}`);
  }

  log("Successfully built Linux text monitor binary");
  return true;
}

function main() {
  ensureDir(outputDir);

  if (!strictBuild && isBinaryUpToDate()) {
    log("Binary is up to date, skipping build");
    return;
  }

  const compiled = tryCompile();
  if (compiled) {
    return;
  }

  if (strictBuild) {
    throw Error(
      "A source-built Linux text monitor is required in CI/release builds. Install pkg-config, libatspi2.0-dev and libglib2.0-dev, then fix any compiler errors."
    );
  }
  console.warn("[linux-text-monitor] Could not compile the native text monitor.");
  console.warn(
    "[linux-text-monitor] Install libatspi2.0-dev and libglib2.0-dev for the native helper. Development can use the Python fallback when Python AT-SPI bindings are installed."
  );
}

try {
  main();
} catch (error) {
  console.error("[linux-text-monitor] Unexpected error:", error);
  process.exitCode = 1;
}
