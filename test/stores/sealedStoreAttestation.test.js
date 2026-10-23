const assert = require("node:assert/strict");
const test = require("node:test");
const { fakePrivacy, unverifiedAttestation, tick } = require("../hooks/fakePrivacy");

// sealedStore.ts imports only zustand and types, so tsx loads it directly.
const load = () => import("../../src/stores/sealedStore.ts");

async function fresh(t, privacy) {
  const store = await load();
  store._resetSealedStoreForTests();
  globalThis.window = { electronAPI: privacy === undefined ? {} : { privacy } };
  t.after(() => {
    delete globalThis.window;
    store._resetSealedStoreForTests();
  });
  return store;
}

test("unknown until main answers; then follows main's broadcasts, never claiming nothingLeaves", async (t) => {
  const fake = fakePrivacy();
  const store = await fresh(t, fake.api);
  assert.deepEqual(store.getSealedSnapshot(), { sealed: null, attestation: null });
  assert.deepEqual(fake.calls, [], "reading the snapshot starts nothing (A12)");
  let notified = 0;
  store.subscribeSealed(() => notified++);
  await tick();
  assert.equal(store.getSealedSnapshot().sealed, true);
  assert.equal(store.getSealedSnapshot().attestation.nothingLeaves, false);
  assert.equal(store.getSealedSnapshot().attestation.effectiveSince, null);
  fake.listeners.attestation(unverifiedAttestation({ version: 5 }));
  assert.equal(store.getSealedSnapshot().attestation.version, 5, "main pushes attestation changes");
  fake.listeners.sealed(false);
  assert.equal(store.getSealedSnapshot().sealed, false);
  assert.ok(notified >= 3);
});

test("Plan 03's API keeps working over the new internals", async (t) => {
  const fake = fakePrivacy({ pending: true });
  const store = await fresh(t, fake.api);
  store.ensureSealedSubscribed();
  store.ensureSealedSubscribed();
  await tick();
  assert.deepEqual(store.useSealedStore.getState(), { sealed: false, known: false });
  assert.equal(store.getSealed(), false, "unknown reads false for route snapshots");
  assert.equal(store.getSealedSnapshot().sealed, null, "and null for anything that makes a claim");
  assert.equal(fake.calls.filter((c) => c === "getSealed").length, 1, "subscribes once");
  fake.listeners.sealed(true);
  assert.deepEqual(store.useSealedStore.getState(), { sealed: true, known: true });
  assert.equal(store.getSealed(), true);
  assert.equal(store.getSealedSnapshot().sealed, true);
});

test("the snapshot object is stable until something changes (useSyncExternalStore)", async (t) => {
  const fake = fakePrivacy();
  const store = await fresh(t, fake.api);
  store.subscribeSealed(() => {});
  await tick();
  const a = store.getSealedSnapshot();
  assert.equal(store.getSealedSnapshot() === a, true);
  assert.equal(Object.isFrozen(a), true);
  fake.listeners.sealed(true);
  assert.equal(store.getSealedSnapshot() === a, true, "an unchanged value republishes nothing");
  fake.listeners.sealed(false);
  assert.equal(store.getSealedSnapshot() === a, false);
});

test("an older attestation never replaces a newer one", async (t) => {
  const fake = fakePrivacy();
  const store = await fresh(t, fake.api);
  store.subscribeSealed(() => {});
  await tick();
  fake.listeners.attestation(unverifiedAttestation({ version: 9 }));
  fake.listeners.attestation(unverifiedAttestation({ version: 8, failures: [] }));
  assert.equal(store.getSealedSnapshot().attestation.version, 9);
});

test("a reply without a finite version or timestamp is not evidence", async (t) => {
  const fake = fakePrivacy();
  const store = await fresh(t, fake.api);
  store.subscribeSealed(() => {});
  await tick();
  assert.equal(store.getSealedSnapshot().attestation.version, 1);
  fake.listeners.attestation({ ...unverifiedAttestation({ version: 2 }), at: Number.NaN });
  assert.equal(
    store.getSealedSnapshot().attestation,
    null,
    "an unverifiable push drops to unknown"
  );
  fake.listeners.attestation({ ...unverifiedAttestation(), version: "7" });
  assert.equal(store.getSealedSnapshot().attestation, null);
});

test("a failed attestation read drops to unknown rather than keeping a stale claim", async (t) => {
  const store = await fresh(t, fakePrivacy({ failAttestation: true }).api);
  store.subscribeSealed(() => {});
  await tick();
  assert.equal(store.getSealedSnapshot().attestation, null);
});

test("setSealedMode adopts main's answer, including a declined unseal", async (t) => {
  const fake = fakePrivacy({ sealed: true });
  fake.api.setSealed = async () => ({ ...unverifiedAttestation({ version: 3 }), declined: true });
  const store = await fresh(t, fake.api);
  const result = await store.setSealedMode(false);
  assert.equal(result.declined, true);
  assert.equal(store.getSealedSnapshot().sealed, true);
  assert.equal(store.getSealedSnapshot().attestation.version, 3);
});

test("a claim delivered late lives only until main's at + 30 s, not 30 s after it arrived", async (t) => {
  const fake = fakePrivacy();
  let refetches = 0;
  fake.api.getAttestation = async () => {
    refetches++;
    return unverifiedAttestation({ version: 1 });
  };
  const store = await fresh(t, fake.api);
  store.subscribeSealed(() => {});
  await tick();
  fake.listeners.attestation(
    unverifiedAttestation({ version: 7, at: Date.now() - store.ATTESTATION_MAX_AGE_MS + 40 })
  );
  assert.equal(store.getSealedSnapshot().attestation.version, 7, "fresh for 40 more ms");
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(store.getSealedSnapshot().attestation, null, "gone at at + 30 s");
  await tick();
  assert.equal(refetches, 2, "expiry asked main again");
  assert.equal(
    store.getSealedSnapshot().attestation,
    null,
    "the older reply (version 1) is never adopted over the expired version 7"
  );
});

test("after a claim expires, a late older reply is never adopted", async (t) => {
  const fake = fakePrivacy();
  const replies = [];
  fake.api.getAttestation = () => new Promise((r) => replies.push(r));
  const store = await fresh(t, fake.api);
  store.subscribeSealed(() => {});
  fake.listeners.attestation(
    unverifiedAttestation({ version: 9, at: Date.now() - store.ATTESTATION_MAX_AGE_MS - 1 })
  );
  assert.equal(store.getSealedSnapshot().attestation, null, "stale on arrival: unknown");
  replies[0](unverifiedAttestation({ version: 8 })); // left main before version 9
  await tick();
  assert.equal(store.getSealedSnapshot().attestation, null, "the watermark outlives the claim");
  fake.listeners.attestation(unverifiedAttestation({ version: 10 }));
  assert.equal(store.getSealedSnapshot().attestation.version, 10, "a newer push is adopted");
});

test("a failed refresh while a newer push arrives keeps the newer push", async (t) => {
  const fake = fakePrivacy();
  let fail;
  fake.api.getAttestation = () =>
    new Promise((_r, reject) => {
      fail = reject;
    });
  const store = await fresh(t, fake.api);
  store.subscribeSealed(() => {});
  fake.listeners.attestation(unverifiedAttestation({ version: 3 }));
  fail(new Error("ipc")); // the refresh started before version 3 arrived
  await tick();
  assert.equal(store.getSealedSnapshot().attestation.version, 3);
  fake.listeners.attestation(unverifiedAttestation({ version: 4 }));
  assert.equal(store.getSealedSnapshot().attestation.version, 4);
});

test("a stale claim with a higher version is dropped, re-fetched, and 12 never replaces 50", async (t) => {
  const fake = fakePrivacy();
  let fetches = 0;
  fake.api.getAttestation = async () => {
    fetches++;
    return unverifiedAttestation({ version: 10 + fetches });
  };
  const store = await fresh(t, fake.api);
  store.subscribeSealed(() => {});
  await tick();
  assert.equal(store.getSealedSnapshot().attestation.version, 11);
  fake.listeners.attestation(
    unverifiedAttestation({ version: 50, at: Date.now() - store.ATTESTATION_MAX_AGE_MS - 1 })
  );
  assert.equal(store.getSealedSnapshot().attestation, null, "a stale claim is not shown");
  await tick();
  assert.equal(fetches, 2, "a fresh one was requested");
  assert.equal(
    store.getSealedSnapshot().attestation,
    null,
    "the highest version survives expiry: version 12 does not replace 50"
  );
  fake.listeners.attestation(unverifiedAttestation({ version: 51 }));
  assert.equal(store.getSealedSnapshot().attestation.version, 51);
});

test("a timestamp far in the future is not fresh", async (t) => {
  const store = await load();
  const now = Date.now();
  assert.equal(store.isAttestationFresh(unverifiedAttestation({ at: now }), now), true);
  assert.equal(
    store.isAttestationFresh(
      unverifiedAttestation({ at: now + store.ATTESTATION_MAX_AGE_MS + 1 }),
      now
    ),
    false
  );
  assert.equal(store.isAttestationFresh(null, now), false);
  t.after(() => store._resetSealedStoreForTests());
});

test("focus rechecks age, because hidden-window timers are throttled", async (t) => {
  const store = await load();
  store._resetSealedStoreForTests();
  const handlers = {};
  const fake = fakePrivacy();
  globalThis.window = {
    electronAPI: { privacy: fake.api },
    addEventListener: (name, fn) => (handlers[name] = fn),
    removeEventListener: () => {},
  };
  t.after(() => {
    delete globalThis.window;
    store._resetSealedStoreForTests();
  });
  const realNow = Date.now;
  t.after(() => (Date.now = realNow));
  store.subscribeSealed(() => {});
  await tick();
  assert.equal(store.getSealedSnapshot().attestation.version, 1);
  const base = realNow();
  Date.now = () => base + store.ATTESTATION_MAX_AGE_MS + 5;
  handlers.focus();
  assert.equal(store.getSealedSnapshot().attestation, null);
});

test("a build without the privacy bridge cannot be sealed, and that is known (Plan 03's rule)", async (t) => {
  const store = await fresh(t, undefined);
  store.subscribeSealed(() => {});
  await tick();
  assert.deepEqual(store.getSealedSnapshot(), { sealed: false, attestation: null });
});
