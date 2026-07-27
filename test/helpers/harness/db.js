const REQUIRED_DB_FAILURE =
  "DB-backed tests were required (REQUIRE_DB_TESTS is set) but the better-sqlite3 native " +
  "binding could not be loaded, so this test would have been skipped instead of run. In CI " +
  "this almost always means the step that rebuilds better-sqlite3 for the runner's Node " +
  '("npm rebuild better-sqlite3", right after "npm ci --ignore-scripts") is missing or ' +
  "failed. Restore that step instead of deleting this check: without it every DB test " +
  "skips and the suite stays green with no database coverage. Underlying error: ";

function isNativeBindingUnavailable(error) {
  const message = String(error?.message || error);
  return (
    message.includes("NODE_MODULE_VERSION") ||
    message.includes("Could not locate the bindings file") ||
    message.includes("ERR_DLOPEN_FAILED") ||
    error?.code === "ERR_DLOPEN_FAILED"
  );
}

// Locally the binding is built for Electron's ABI, so a plain `node` run must skip. In CI the
// rebuild step makes it loadable, so a skip there means that step vanished and must fail.
function skipOrFail(t, error) {
  if (!isNativeBindingUnavailable(error)) {
    throw error;
  }
  if (process.env.REQUIRE_DB_TESTS) {
    throw new Error(REQUIRED_DB_FAILURE + String(error?.message || error), { cause: error });
  }
  t.skip("better-sqlite3 native binding is not available for this Node runtime");
}

module.exports = { isNativeBindingUnavailable, skipOrFail };
