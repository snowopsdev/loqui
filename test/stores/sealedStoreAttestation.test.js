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
  // Fix round 2, N1: with under 10 s left the claim's refresh is asked at once
  // (and its older answer ignored); then the expiry asks main again.
  assert.equal(refetches, 3, "a refresh, then the expiry, asked main again");
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

// Task 13 fix round 2, N1: while sealed, main's claim is renewed before it
// expires, so local routes never flip to "Checking…" between two fresh
// claims. The hard expiry at main's at + 30 s is unchanged: a refresh that
// is late or fails still drops the claim then, and nothing extends a claim.
async function scheduled(t, getAttestation) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const fake = fakePrivacy();
  const asked = [];
  fake.api.getAttestation = (...args) => {
    asked.push(Date.now());
    return getAttestation(...args);
  };
  const store = await fresh(t, fake.api);
  const seen = [];
  store.subscribeSealed(() => seen.push(store.getSealedSnapshot().attestation));
  await tick();
  return { store, fake, asked, seen };
}

test("N1: a claim renewed on schedule is replaced before it expires, never by unknown", async (t) => {
  let version = 0;
  const { store, asked, seen } = await scheduled(t, async () =>
    unverifiedAttestation({ version: ++version, at: Date.now() })
  );
  assert.equal(store.getSealedSnapshot().attestation.version, 1);
  for (let second = 1; second <= 150; second++) {
    t.mock.timers.tick(1000);
    await tick();
    const current = store.getSealedSnapshot().attestation;
    assert.notEqual(current, null, `a claim is shown at +${second} s`);
    assert.equal(store.isAttestationFresh(current, Date.now()), true, "never past its expiry");
  }
  const adopted = seen.slice(seen.findIndex((a) => a !== null));
  assert.equal(adopted.includes(null), false, "no unknown is published between fresh claims");
  assert.ok(version >= 7, `renewed across several at + 30 s boundaries (${version} claims)`);
  for (let i = 1; i < asked.length; i++) {
    const gap = asked[i] - asked[i - 1];
    assert.ok(gap >= 19_000 && gap <= 21_000, `each renewal is asked about 20 s in (${gap} ms)`);
  }
  assert.equal(store._sealedStoreTimersForTests(), 2, "one refresh and one hard expiry, no more");
});

test("N1: a refresh that has not answered by main's at + 30 s still drops the claim then", async (t) => {
  let first = true;
  const { store, asked } = await scheduled(t, () => {
    if (!first) return new Promise(() => {});
    first = false;
    return Promise.resolve(unverifiedAttestation({ version: 1, at: Date.now() }));
  });
  assert.equal(store.getSealedSnapshot().attestation.version, 1);
  t.mock.timers.tick(20_000);
  await tick();
  assert.equal(asked.length, 2, "the refresh was asked at at + 20 s");
  assert.equal(store.getSealedSnapshot().attestation.version, 1, "the claim is kept meanwhile");
  t.mock.timers.tick(9_999);
  await tick();
  assert.equal(store.getSealedSnapshot().attestation.version, 1, "fresh until at + 30 s");
  t.mock.timers.tick(2);
  await tick();
  assert.equal(store.getSealedSnapshot().attestation, null, "a late refresh extends nothing");
  assert.equal(asked.length, 3, "expiry asked main again");
  assert.equal(store._sealedStoreTimersForTests(), 0);
});

test("N1: a refresh that fails drops the claim at once (fail closed)", async (t) => {
  let first = true;
  const { store, asked } = await scheduled(t, async () => {
    if (!first) throw new Error("ipc");
    first = false;
    return unverifiedAttestation({ version: 1, at: Date.now() });
  });
  assert.equal(store.getSealedSnapshot().attestation.version, 1);
  t.mock.timers.tick(20_000);
  await tick();
  assert.equal(asked.length, 2);
  assert.equal(store.getSealedSnapshot().attestation, null);
  assert.equal(store._sealedStoreTimersForTests(), 0, "both timers are cleared");
  t.mock.timers.tick(60_000);
  await tick();
  assert.equal(asked.length, 2, "nothing left armed to ask again");
});

test("N1: a late claim is refreshed once, the same answer never loops, and its expiry holds", async (t) => {
  const late = unverifiedAttestation({ version: 5, at: 1_000_000 - 25_000 });
  const { store, asked } = await scheduled(t, async () => late);
  assert.equal(store.getSealedSnapshot().attestation.version, 5, "5 s of life left");
  t.mock.timers.tick(1);
  await tick();
  assert.equal(asked.length, 2, "with under 10 s left the refresh is asked at once");
  for (let i = 0; i < 3; i++) {
    t.mock.timers.tick(1000);
    await tick();
  }
  assert.equal(asked.length, 2, "main's unchanged answer is not refreshed again");
  assert.equal(store.getSealedSnapshot().attestation.version, 5);
  t.mock.timers.tick(2_000);
  await tick();
  assert.equal(store.getSealedSnapshot().attestation, null, "gone at its own at + 30 s");
  assert.equal(asked.length, 3, "expiry asked once more");
  t.mock.timers.tick(60_000);
  await tick();
  assert.equal(asked.length, 3, "a stale answer to the expiry's ask arms nothing");
  assert.equal(store._sealedStoreTimersForTests(), 0);
});

test("N1: a delayed refresh reply never replaces a newer push", async (t) => {
  let answer;
  let first = true;
  const { store, fake } = await scheduled(t, () => {
    if (first) {
      first = false;
      return Promise.resolve(unverifiedAttestation({ version: 1, at: Date.now() }));
    }
    return new Promise((resolve) => (answer = resolve));
  });
  t.mock.timers.tick(20_000);
  await tick();
  assert.equal(typeof answer, "function", "the refresh is in flight");
  fake.listeners.attestation(unverifiedAttestation({ version: 10, at: Date.now() }));
  answer(unverifiedAttestation({ version: 2, at: Date.now() - 20_000 })); // left main earlier
  await tick();
  assert.equal(store.getSealedSnapshot().attestation.version, 10);
  t.mock.timers.tick(29_000);
  await tick();
  assert.notEqual(store.getSealedSnapshot().attestation, null);
});

test("N1: timers are cleaned up: never more than two, none after reset, expiry or a stale claim", async (t) => {
  const { store, fake, asked } = await scheduled(t, () => new Promise(() => {}));
  assert.equal(store._sealedStoreTimersForTests(), 0, "no claim, no timer");
  for (let v = 1; v <= 3; v++)
    fake.listeners.attestation(unverifiedAttestation({ version: v, at: Date.now() }));
  assert.equal(store._sealedStoreTimersForTests(), 2, "adopting re-arms; it never accumulates");
  fake.listeners.attestation(
    unverifiedAttestation({ version: 4, at: Date.now() - store.ATTESTATION_MAX_AGE_MS - 1 })
  );
  assert.equal(store._sealedStoreTimersForTests(), 0, "a stale claim clears both");
  fake.listeners.attestation(unverifiedAttestation({ version: 5, at: Date.now() }));
  assert.equal(store._sealedStoreTimersForTests(), 2);
  store._resetSealedStoreForTests();
  assert.equal(store._sealedStoreTimersForTests(), 0, "reset clears both");
  const before = asked.length;
  t.mock.timers.tick(120_000);
  await tick();
  assert.equal(asked.length, before, "a cleared timer never fires");
});
