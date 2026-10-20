const assert = require("node:assert/strict");

// A local assertion, never a process-wide warning filter. Any unlisted output
// fails the owning test and prints the captured records in the assertion diff.
function captureDiagnostics(t, methods = ["warn", "error"]) {
  const records = [];
  for (const method of methods)
    t.mock.method(console, method, (...args) => records.push([method, ...args]));
  return records;
}
function assertQuietImport(load) {
  const original = process.emitWarning;
  const warnings = [];
  process.emitWarning = (...args) => warnings.push(args);
  try {
    const result = load();
    assert.deepEqual(warnings, [], "module import emits no unexpected warnings");
    return result;
  } finally {
    process.emitWarning = original;
  }
}
module.exports = { captureDiagnostics, assertQuietImport };
