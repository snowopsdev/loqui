const assert = require("node:assert/strict");
const test = require("node:test");

// Owner decision D-1: the renderer only says what main reports about a
// pending Google revoke. Labels are keys here (t is the identity).
const t = (key) => key;
const load = () => import("../../src/components/googleRevokeNotice.ts");
const C = "sealedMode.calendar";
const status = (over = {}) => ({
  pending: 1,
  failed: 0,
  unreadable: false,
  running: false,
  ...over,
});

test("a kept revoke is announced as later, automatic work", async () => {
  const { googleRevokeNotice } = await load();
  const notice = googleRevokeNotice({ kind: "queued", status: status() }, t, {});
  assert.deepEqual(
    [notice.id, notice.kind, notice.title, notice.body],
    ["gcal-pending-revoke", "notice", `${C}.revokeQueuedTitle`, `${C}.revokeQueued`]
  );
});

test("a finished revoke is a receipt only when nothing is left pending", async () => {
  const { googleRevokeNotice } = await load();
  const done = googleRevokeNotice({ kind: "revoked", status: status({ pending: 0 }) }, t, {});
  assert.deepEqual([done.kind, done.title], ["receipt", `${C}.revokeDoneTitle`]);
  const partial = googleRevokeNotice({ kind: "revoked", status: status({ failed: 1 }) }, t, {});
  assert.equal(partial.kind, "alert", "something is still pending: say so");
});

test("a failure stays up, says the grant may still be active, and offers Retry and the manual route", async () => {
  const { googleRevokeNotice } = await load();
  const calls = [];
  const api = {
    gcalPendingRevokeRetry: async () => calls.push("retry"),
    openExternal: (url) => calls.push(["open", url]),
  };
  const notice = googleRevokeNotice({ kind: "failed", status: status({ failed: 1 }) }, t, api);
  assert.deepEqual(
    [notice.kind, notice.persistent, notice.title, notice.body],
    ["alert", true, `${C}.revokeFailedTitle`, `${C}.revokeFailed`]
  );
  assert.deepEqual(
    notice.actions.map((a) => [a.label, !!a.primary, !!a.keepOpen]),
    [
      [`${C}.revokeRetry`, true, true],
      [`${C}.revokeOpenAccount`, false, true],
    ]
  );
  await notice.actions[0].onClick();
  notice.actions[1].onClick();
  assert.deepEqual(calls, ["retry", ["open", "https://myaccount.google.com/permissions"]]);
});

test("nothing pending means no notice", async () => {
  const { googleRevokeNotice } = await load();
  assert.equal(googleRevokeNotice({ kind: "failed", status: status({ pending: 0 }) }, t, {}), null);
});

test("the English copy is plain about what may remain at Google", async () => {
  const en = require("../../src/locales/en/translation.json").sealedMode.calendar;
  assert.match(en.revokeFailed, /may still be active at Google/);
  assert.match(en.revokeQueued, /automatically after you turn off Sealed mode/);
  assert.match(en.googleRevokeFailedReset, /may still be active at Google/);
  assert.match(en.revokeUnsaved, /until you remove it in your Google Account/);
});

// Review I-1: an unreadable record is a revoke whose state is unknown.
test("an unreadable record says the grant may still be active, links the Google Account page, offers no Retry, and is forgotten only once dismissed", async () => {
  const { googleRevokeNotice } = await load();
  const calls = [];
  const api = {
    gcalPendingRevokeRetry: async () => calls.push("retry"),
    gcalPendingRevokeForget: async () => calls.push("forget"),
    openExternal: (url) => calls.push(["open", url]),
  };
  for (const kind of ["unreadable", "failed", "revoked"]) {
    const notice = googleRevokeNotice(
      { kind, status: status({ pending: 0, unreadable: true }) },
      t,
      api
    );
    assert.deepEqual(
      [notice.kind, notice.persistent, notice.title, notice.body],
      ["alert", true, `${C}.revokeUnreadableTitle`, `${C}.revokeUnreadable`],
      kind
    );
    assert.deepEqual(
      notice.actions.map((a) => [a.label, !!a.keepOpen]),
      [
        [`${C}.revokeOpenAccount`, true],
        [`${C}.revokeUnreadableDismiss`, false],
      ],
      "no Retry: no token is usable"
    );
    notice.actions[0].onClick();
    notice.onDismiss("replaced");
    notice.onDismiss("evicted");
    assert.deepEqual(calls, [["open", "https://myaccount.google.com/permissions"]]);
    notice.onDismiss("action");
    notice.onDismiss("user");
    assert.deepEqual(calls.slice(1), ["forget", "forget"]);
    calls.length = 0;
  }
});

test("the window's startup read shows a failure or an unreadable record, nothing else", async () => {
  const { startupRevokeEvent } = await load();
  assert.equal(startupRevokeEvent(undefined), null);
  assert.equal(startupRevokeEvent(status()), null, "pending, not failed: main runs it");
  assert.deepEqual(startupRevokeEvent(status({ failed: 1 })), {
    kind: "failed",
    status: status({ failed: 1 }),
  });
  const unreadable = status({ pending: 0, unreadable: true });
  assert.deepEqual(startupRevokeEvent(unreadable), { kind: "unreadable", status: unreadable });
});

test("the English unreadable copy is plain that the access may still be active", async () => {
  const en = require("../../src/locales/en/translation.json").sealedMode.calendar;
  assert.match(en.revokeUnreadable, /may still be active at Google/);
  assert.match(en.revokeUnreadable, /Google Account/);
});
