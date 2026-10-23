const test = require("node:test");
const assert = require("node:assert/strict");
// The exact `require("./harness/db")` spelling routes this file to the
// non-tsx native group in scripts/run-tests.js.
const { createDb } = require("./harness/db");

const row = {
  identity: "corti:speech",
  generation: 3,
  config_fingerprint: "fixture-canonical-config",
  status: "rejected",
  last_verified_at: 5,
  last_error_code: "credentialsRejected",
  last_error_status: 401,
  reminder_due_at: null,
  reminded_at: null,
  updated_at: 5,
};

// change-driving: the table and accessors do not exist yet.
test("key health rows round-trip and upsert by identity", (t) => {
  const db = createDb(t);
  if (!db) return;
  assert.deepEqual(db.getKeyHealth(), []);
  db.saveKeyHealth(row);
  db.saveKeyHealth({
    ...row,
    identity: "corti:text",
    status: "verified",
    last_error_code: null,
    last_error_status: null,
  });
  db.saveKeyHealth({
    ...row,
    status: "verified",
    last_error_code: null,
    last_error_status: null,
    updated_at: 6,
  });
  assert.deepEqual(db.getKeyHealth(), [
    {
      ...row,
      identity: "corti:speech",
      status: "verified",
      last_error_code: null,
      last_error_status: null,
      updated_at: 6,
    },
    {
      ...row,
      identity: "corti:text",
      status: "verified",
      last_error_code: null,
      last_error_status: null,
    },
  ]);
  db.deleteKeyHealth("corti:speech");
  assert.deepEqual(
    db.getKeyHealth().map((r) => r.identity),
    ["corti:text"]
  );
});

// baseline guard strengthened after original RED: assert the SQLite constraint,
// so a missing accessor cannot accidentally satisfy the assertion.
test("the schema refuses unknown health states", (t) => {
  const db = createDb(t);
  if (!db) return;
  assert.throws(() => db.saveKeyHealth({ ...row, status: "great" }), /CHECK constraint failed/);
});
