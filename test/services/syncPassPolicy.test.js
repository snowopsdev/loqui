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

// --- purged-space guard -----------------------------------------------------

test("purge guard: entries expire strictly at the TTL", async () => {
  const { prunePurgedSpaceEntries } = await load();
  const now = 1_000_000_000;
  const ttl = 900_000;
  const entry = (at) => ({ at, reason: "deleted" });
  const pruned = prunePurgedSpaceEntries(
    { fresh: entry(now - 1), edge: entry(now - ttl), stale: entry(now - ttl - 1) },
    now,
    ttl
  );
  assert.deepEqual(pruned, { fresh: entry(now - 1) });
  assert.deepEqual(prunePurgedSpaceEntries({}, now, ttl), {});
});

test("purge guard: legacy plain-timestamp entries normalize to the deleted reason", async () => {
  const { normalizePurgedSpaceEntries } = await load();
  const shaped = { at: 123, reason: "revoked" };
  assert.deepEqual(normalizePurgedSpaceEntries({ legacy: 456, shaped }), {
    legacy: { at: 456, reason: "deleted" },
    shaped,
  });
});

// D14: a member removed then re-added must not stay locked out for the TTL.
// Only a still-live "deleted" entry keeps guarding (the delete race the guard
// was built for); a reappearing "revoked" space means re-added access.
test("purge guard: live-set sweep keeps only still-live deleted entries", async () => {
  const { keepPurgedSpaceEntry } = await load();
  assert.equal(keepPurgedSpaceEntry({ at: 1, reason: "deleted" }, true), true);
  assert.equal(keepPurgedSpaceEntry({ at: 1, reason: "revoked" }, true), false);
  assert.equal(keepPurgedSpaceEntry({ at: 1, reason: "deleted" }, false), false);
  assert.equal(keepPurgedSpaceEntry({ at: 1, reason: "revoked" }, false), false);
});

// --- resolvePulledNoteFolderId ---------------------------------------------

test("pull folder resolution accepts only mappings in the note's local space", async () => {
  const { resolvePulledNoteFolderId } = await load();
  const folders = new Map([
    ["same-space", { id: 10, space_id: 2 }],
    ["other-space", { id: 11, space_id: 3 }],
  ]);

  assert.equal(
    resolvePulledNoteFolderId({ space_id: "cloud-space", folder_id: "same-space" }, 2, folders, 99),
    10
  );
  assert.equal(
    resolvePulledNoteFolderId(
      { space_id: "cloud-space", folder_id: "other-space" },
      2,
      folders,
      99
    ),
    null,
    "a team note must fall back to its space root, never another space's folder"
  );
});

test("pull folder resolution uses the default folder only for personal notes", async () => {
  const { resolvePulledNoteFolderId } = await load();
  const folders = new Map();

  assert.equal(resolvePulledNoteFolderId({ space_id: null, folder_id: null }, 1, folders, 99), 99);
  assert.equal(
    resolvePulledNoteFolderId({ space_id: "cloud-space", folder_id: null }, 2, folders, 99),
    null
  );
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
