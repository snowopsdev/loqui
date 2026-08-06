const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/stores/policyLifecycle.ts");

test("accepts only monotonic snapshots for the active account and credential generation", async () => {
  const { shouldAcceptPolicySnapshot } = await load();
  const current = { accountId: "account-a", authGeneration: 7, revision: 4 };

  assert.equal(
    shouldAcceptPolicySnapshot(current, { accountId: "account-a", authGeneration: 7, revision: 5 }),
    true
  );
  assert.equal(
    shouldAcceptPolicySnapshot(current, { accountId: "account-a", authGeneration: 7, revision: 3 }),
    false
  );
  assert.equal(
    shouldAcceptPolicySnapshot(current, { accountId: "account-b", authGeneration: 7, revision: 5 }),
    false
  );
  assert.equal(
    shouldAcceptPolicySnapshot(current, { accountId: "account-a", authGeneration: 8, revision: 5 }),
    false
  );
});

test("selects only resolved policy identities for cadence and focus refresh", async () => {
  const { resolvedPolicyRefreshIdentity } = await load();
  const identity = { accountId: "account-a", authGeneration: 7 };

  assert.deepEqual(resolvedPolicyRefreshIdentity({ ...identity, status: "managed" }), identity);
  assert.deepEqual(resolvedPolicyRefreshIdentity({ ...identity, status: "unmanaged" }), identity);
  assert.deepEqual(resolvedPolicyRefreshIdentity({ ...identity, status: "error" }), identity);
  assert.equal(resolvedPolicyRefreshIdentity({ ...identity, status: "loading" }), null);
  assert.equal(
    resolvedPolicyRefreshIdentity({ status: "managed", accountId: null, authGeneration: null }),
    null
  );
});
