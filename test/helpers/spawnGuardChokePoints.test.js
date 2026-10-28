const assert = require("node:assert/strict");
const test = require("node:test");
const childProcess = require("node:child_process");
const gate = require("../../src/helpers/privacy/egressGate");
const registry = require("../../src/helpers/privacy/childRegistry");

// Task 18 T18-04, on the real modules: the guard covers Node's choke point
// (ChildProcess.prototype.spawn) and process.execve, not only the exported
// functions. The arguments are deliberately invalid, so an unguarded call
// fails in Node's own validation and nothing native ever starts.
test("the real ChildProcess.prototype.spawn and process.execve refuse while sealed", (t) => {
  t.after(() => {
    gate._resetForTests();
    registry._resetForTests();
  });
  gate._resetForTests();
  registry._resetForTests();
  const rows = [];
  gate.configureEgress({ isSealed: () => true, recorder: { record: (row) => rows.push(row) } });
  registry.installSpawnGuard();
  assert.throws(() => new childProcess.ChildProcess().spawn({ file: 42, args: [] }), {
    code: "SEALED_MODE",
  });
  if (typeof process.execve === "function")
    assert.throws(() => process.execve(42, []), { code: "SEALED_MODE" });
  assert.ok(rows.length >= 1);
});
