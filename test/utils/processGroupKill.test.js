const assert = require("node:assert/strict");
const test = require("node:test");
const { killProcessGroup } = require("../../src/utils/process");

// Owner decision D-3: a group is signalled by pid only while its root is
// unreaped. A root that ended by a signal has exitCode null and signalCode
// set; it is reaped, its pid may be reused, so its group is never signalled.
const posix = { skip: process.platform === "win32" && "process groups are POSIX-only" };
function fakeRoot(over = {}) {
  const sent = [];
  return {
    pid: 4_206_650,
    exitCode: null,
    signalCode: null,
    kill: (s) => sent.push(s),
    sent,
    ...over,
  };
}

test("a live root's group is signalled", posix, (t) => {
  const kills = [];
  t.mock.method(process, "kill", (pid, signal) => kills.push([pid, signal]));
  killProcessGroup(fakeRoot(), "SIGTERM");
  assert.deepEqual(kills, [[-4_206_650, "SIGTERM"]]);
});

test("a root that exited, by code or by signal, is never group-signalled", posix, (t) => {
  const kills = [];
  t.mock.method(process, "kill", (pid, signal) => kills.push([pid, signal]));
  for (const over of [{ exitCode: 0 }, { signalCode: "SIGKILL" }]) {
    const root = fakeRoot(over);
    killProcessGroup(root, "SIGKILL");
    assert.deepEqual(root.sent, [], JSON.stringify(over));
  }
  assert.deepEqual(kills, []);
});
