const path = require("node:path");
const { execFileSync } = require("node:child_process");

function probeRuntimeVersion(
  binary,
  { platform = process.platform, run = execFileSync, log = console.log } = {}
) {
  const name = path.basename(binary);
  // The first packaged macOS llama execution already took ~13 seconds in a
  // successful hosted run. Allow cold startup headroom without retrying a failed
  // executable or changing which backend/library is loaded.
  const timeout = platform === "darwin" && name.startsWith("llama-server-") ? 60000 : 15000;
  const started = performance.now();
  log(`[package-smoke] ${name} --version (timeout ${timeout} ms)`);
  try {
    run(binary, ["--version"], { stdio: "inherit", timeout, killSignal: "SIGKILL" });
  } catch (error) {
    const elapsed = Math.round(performance.now() - started);
    const reason =
      error.code === "ETIMEDOUT"
        ? `timed out after ${timeout} ms`
        : error.signal
          ? `terminated by ${error.signal}`
          : error.status != null
            ? `exited with status ${error.status}`
            : error.code || error.message;
    throw new Error(`Packaged ${name} --version ${reason} (elapsed ${elapsed} ms)`, {
      cause: error,
    });
  }
  log(`[package-smoke] ${name} --version passed in ${Math.round(performance.now() - started)} ms`);
}

module.exports = { probeRuntimeVersion };
