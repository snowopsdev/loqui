const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/services/syncPassPolicy.ts");

// --- resolvePullCursorAdvance ----------------------------------------------
// The matrix mirrors SyncService's pullFolders/pullNotes cursor semantics: a
// wrongly advanced cursor silently drops teammate edits from the delta pulls.

const base = {
  snapshot: false,
  dirty: false,
  teamOnly: false,
  teamCapable: true,
  hasTeamSpaces: true,
};

test("cursor policy: snapshots and dirty passes never advance", async () => {
  const { resolvePullCursorAdvance } = await load();
  for (const pass of [
    { ...base, snapshot: true },
    { ...base, dirty: true },
    { ...base, snapshot: true, dirty: true, teamOnly: true },
  ]) {
    assert.deepEqual(resolvePullCursorAdvance(pass), {
      advanceCursor: false,
      advanceTeamCursor: false,
    });
  }
});

test("cursor policy: a team-capable full pull advances both cursors", async () => {
  const { resolvePullCursorAdvance } = await load();
  assert.deepEqual(resolvePullCursorAdvance(base), {
    advanceCursor: true,
    advanceTeamCursor: true,
  });
});

test("cursor policy: a team-only pass advances only its own (team) cursor", async () => {
  const { resolvePullCursorAdvance } = await load();
  assert.deepEqual(resolvePullCursorAdvance({ ...base, teamOnly: true }), {
    advanceCursor: true,
    advanceTeamCursor: false,
  });
});

test("cursor policy: with no team spaces a degraded pull still advances fully", async () => {
  const { resolvePullCursorAdvance } = await load();
  assert.deepEqual(
    resolvePullCursorAdvance({ ...base, teamCapable: false, hasTeamSpaces: false }),
    { advanceCursor: true, advanceTeamCursor: true }
  );
});

test("cursor policy: a degraded full pull parks the team cursor for recovery", async () => {
  const { resolvePullCursorAdvance } = await load();
  // The gap this leaves between the cursors is exactly what teamCursorLagging
  // detects to schedule the recovery pull after a capability outage.
  assert.deepEqual(resolvePullCursorAdvance({ ...base, teamCapable: false }), {
    advanceCursor: true,
    advanceTeamCursor: false,
  });
});

test("cursor policy: a degraded team-only pass advances nothing", async () => {
  const { resolvePullCursorAdvance } = await load();
  assert.deepEqual(resolvePullCursorAdvance({ ...base, teamOnly: true, teamCapable: false }), {
    advanceCursor: false,
    advanceTeamCursor: false,
  });
});

// --- prunePurgedSpaceEntries ------------------------------------------------

test("purge guard: entries expire strictly at the TTL", async () => {
  const { prunePurgedSpaceEntries } = await load();
  const now = 1_000_000_000;
  const ttl = 900_000;
  const pruned = prunePurgedSpaceEntries(
    { fresh: now - 1, edge: now - ttl, stale: now - ttl - 1 },
    now,
    ttl
  );
  assert.deepEqual(pruned, { fresh: now - 1 });
  assert.deepEqual(prunePurgedSpaceEntries({}, now, ttl), {});
});

// --- revokedNoteForkUpdate --------------------------------------------------

test("revoked fork: a push rejection moves, forks and clears the retraction", async () => {
  const { revokedNoteForkUpdate } = await load();
  const { update, relocated } = revokedNoteForkUpdate(
    { space_id: 7, cloud_id: "cloud-1" },
    1,
    "push"
  );
  assert.equal(relocated, true);
  assert.equal(update.space_id, 1);
  assert.equal(update.folder_id, null);
  assert.equal(update.cloud_id, null);
  assert.equal(update.left_team, 0);
  assert.equal(typeof update.client_note_id, "string");
});

test("revoked fork: a never-synced push rejection keeps its client identity", async () => {
  const { revokedNoteForkUpdate } = await load();
  const { update } = revokedNoteForkUpdate({ space_id: 7, cloud_id: null }, 1, "push");
  assert.equal("client_note_id" in update, false);
  assert.equal(update.cloud_id, null);
});

test("revoked fork: the pull-side stub always forks and leaves left_team alone", async () => {
  const { revokedNoteForkUpdate } = await load();
  const { update } = revokedNoteForkUpdate({ space_id: 7, cloud_id: null }, 1, "pull");
  assert.equal(typeof update.client_note_id, "string");
  assert.equal("left_team" in update, false);
});

test("revoked fork: an already-private row forks in place without moving", async () => {
  const { revokedNoteForkUpdate } = await load();
  const { update, relocated } = revokedNoteForkUpdate(
    { space_id: 1, cloud_id: "cloud-1" },
    1,
    "pull"
  );
  assert.equal(relocated, false);
  assert.equal("space_id" in update, false);
  assert.equal("folder_id" in update, false);
  assert.equal(update.cloud_id, null);
});
