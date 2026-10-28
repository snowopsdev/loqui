const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

let userDataDir;
const electronPath = require.resolve("electron");
require.cache[electronPath] = {
  exports: {
    app: {
      getPath: () => userDataDir,
    },
  },
};

const { write, clear, readAll } = require("../../src/helpers/sidecarPidFile");

function createUserDataDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-sidecar-pids-"));
  userDataDir = dir;
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "sidecar-pids");
}

test("an unreadable PID entry does not hide valid sidecar entries", (t) => {
  const pidDir = createUserDataDir(t);
  fs.mkdirSync(pidDir);
  fs.writeFileSync(path.join(pidDir, "qdrant.pid"), "1234");
  fs.mkdirSync(path.join(pidDir, "broken.pid"));

  assert.deepEqual(readAll(), [{ name: "qdrant", pid: 1234 }]);
});

test("an unreadable PID registry is treated as empty", (t) => {
  const pidDir = createUserDataDir(t);
  fs.writeFileSync(pidDir, "not a directory");

  assert.deepEqual(readAll(), []);
});

test("missing, malformed, and unrelated entries are ignored", (t) => {
  const pidDir = createUserDataDir(t);
  assert.deepEqual(readAll(), []);

  fs.mkdirSync(pidDir);
  fs.writeFileSync(path.join(pidDir, "zero.pid"), "0");
  fs.writeFileSync(path.join(pidDir, "fraction.pid"), "12.5");
  fs.writeFileSync(path.join(pidDir, "text.pid"), "not-a-pid");
  fs.writeFileSync(path.join(pidDir, "notes.txt"), "5678");

  assert.deepEqual(readAll(), []);
});

test("valid PID entries still round-trip through write, read, and clear", (t) => {
  createUserDataDir(t);

  write("whisper", 4321);
  assert.deepEqual(readAll(), [{ name: "whisper", pid: 4321 }]);

  clear("whisper");
  assert.deepEqual(readAll(), []);
});

test("startup reader exposes unreadable and invalid evidence without deleting it", (t) => {
  const dir = createUserDataDir(t);
  fs.mkdirSync(dir);
  fs.mkdirSync(path.join(dir, "broken.pid"));
  fs.writeFileSync(path.join(dir, "invalid.pid"), "not-a-pid");
  write("qdrant", 1234);
  const { readForReaping } = require("../../src/helpers/sidecarPidFile");
  assert.deepEqual(readForReaping(), {
    entries: [{ name: "qdrant", pid: 1234 }],
    unresolved: [
      {
        kind: "broken",
        pid: null,
        reason: "PID_RECORD_UNREADABLE",
        rootExited: false,
        source: "sidecar-pid-file",
      },
      {
        kind: "invalid",
        pid: null,
        reason: "PID_RECORD_INVALID",
        rootExited: false,
        source: "sidecar-pid-file",
      },
    ],
  });
  assert.equal(fs.existsSync(path.join(dir, "broken.pid")), true);
  assert.equal(fs.existsSync(path.join(dir, "invalid.pid")), true);
});
test("startup reader distinguishes a missing registry from unreadable registry", (t) => {
  const dir = createUserDataDir(t);
  const { readForReaping } = require("../../src/helpers/sidecarPidFile");
  assert.deepEqual(readForReaping(), { entries: [], unresolved: [] });
  fs.writeFileSync(dir, "not a directory");
  assert.ok(readForReaping().unresolved.length > 0);
  assert.ok(readForReaping().unresolved.every((e) => e.reason === "PID_REGISTRY_UNREADABLE"));
});

test("preserved legacy evidence survives a manager replacing/clearing its current PID", (t) => {
  createUserDataDir(t);
  const { preserve, readForReaping } = require("../../src/helpers/sidecarPidFile");
  write("qdrant", 1234);
  assert.equal(preserve("qdrant", 1234), true);
  assert.deepEqual(readForReaping().entries, [{ name: "qdrant", pid: 1234 }]);
  write("qdrant", 5678);
  clear("qdrant");
  assert.deepEqual(readAll(), [], "compatibility reader describes current manager records only");
  assert.deepEqual(readForReaping().entries, [{ name: "qdrant", pid: 1234 }]);
});

test("failed preservation protects the original against manager write/clear", (t) => {
  const dir = createUserDataDir(t);
  const { preserve, readForReaping } = require("../../src/helpers/sidecarPidFile");
  write("qdrant", 1234);
  fs.writeFileSync(path.join(dir, "unresolved"), "not a directory");
  assert.equal(preserve("qdrant", 1234), false);
  write("qdrant", 5678);
  clear("qdrant");
  assert.deepEqual(readAll(), [{ name: "qdrant", pid: 1234 }]);
  assert.ok(readForReaping().unresolved.some((e) => e.reason === "PID_REGISTRY_UNREADABLE"));
});

for (const order of [
  "failure-then-prior-success",
  "prior-success-then-failure",
  "failure-retry-success",
]) {
  test(`preservation obligations remain tied to their PID: ${order}`, (t) => {
    const dir = createUserDataDir(t);
    const { preserve, readForReaping } = require("../../src/helpers/sidecarPidFile");
    write("qdrant", 1234);
    assert.equal(preserve("qdrant", 1234), true);
    write("qdrant", 5678);
    assert.deepEqual(
      readForReaping().entries,
      [
        { name: "qdrant", pid: 5678 },
        { name: "qdrant", pid: 1234 },
      ],
      "normal reaper order visits the current record before the old archive"
    );
    const originalWrite = fs.writeFileSync;
    fs.writeFileSync = (file, ...args) => {
      if (file === path.join(dir, "unresolved", "qdrant.5678.pid"))
        throw Object.assign(new Error("fixture disk full"), { code: "ENOSPC" });
      return originalWrite(file, ...args);
    };
    t.after(() => {
      fs.writeFileSync = originalWrite;
    });
    if (order === "prior-success-then-failure") assert.equal(preserve("qdrant", 1234), true);
    assert.equal(preserve("qdrant", 5678), false);
    assert.equal(preserve("qdrant", 1234), true, "old EEXIST success is not current preservation");
    // Also exercise a newly written, different-PID archive after the failure.
    assert.equal(preserve("qdrant", 2345), true);
    write("qdrant", 9999);
    clear("qdrant");
    assert.deepEqual(readAll(), [{ name: "qdrant", pid: 5678 }]);
    assert.equal(fs.readFileSync(path.join(dir, "qdrant.pid"), "utf8"), "5678");
    assert.deepEqual(
      readForReaping()
        .entries.map((e) => e.pid)
        .sort(),
      [1234, 2345, 5678]
    );

    if (order === "failure-retry-success") {
      fs.writeFileSync = originalWrite;
      assert.equal(preserve("qdrant", 5678), true, "only the same PID success unlocks replacement");
      write("qdrant", 9999);
      assert.deepEqual(readAll(), [{ name: "qdrant", pid: 9999 }]);
      clear("qdrant");
      assert.deepEqual(readAll(), []);
      assert.deepEqual(
        readForReaping()
          .entries.map((e) => e.pid)
          .sort(),
        [1234, 2345, 5678]
      );
    }
  });
}

test("reordered preservation successes release only their own failed obligations", (t) => {
  const dir = createUserDataDir(t);
  const { preserve, readForReaping } = require("../../src/helpers/sidecarPidFile");
  write("qdrant", 5678);
  const failed = new Set([1234, 5678]);
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = (file, ...args) => {
    if ([...failed].some((pid) => file === path.join(dir, "unresolved", `qdrant.${pid}.pid`)))
      throw Object.assign(new Error("fixture disk full"), { code: "ENOSPC" });
    return originalWrite(file, ...args);
  };
  t.after(() => {
    fs.writeFileSync = originalWrite;
  });
  assert.equal(preserve("qdrant", 1234), false);
  assert.equal(preserve("qdrant", 5678), false);
  failed.delete(5678);
  assert.equal(preserve("qdrant", 5678), true);
  // A remaining older failure is still an obligation, even after the newer
  // copy succeeds. Preserve conservatively until every exact copy succeeds.
  write("qdrant", 9999);
  clear("qdrant");
  assert.deepEqual(readAll(), [{ name: "qdrant", pid: 5678 }]);
  failed.clear();
  assert.equal(preserve("qdrant", 1234), true);
  write("qdrant", 9999);
  assert.deepEqual(readAll(), [{ name: "qdrant", pid: 9999 }]);
  clear("qdrant");
  assert.deepEqual(readAll(), []);
  assert.deepEqual(
    readForReaping()
      .entries.map((e) => e.pid)
      .sort(),
    [1234, 5678]
  );
});
