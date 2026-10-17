const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/ui/notices.ts");

function fakeClock() {
  let now = 1_000;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    pending: () => timers.size,
  };
}

async function fresh(t) {
  const m = await load();
  const clock = fakeClock();
  m.__setNoticeClockForTests(clock);
  t.after(() => m.__setNoticeClockForTests());
  return { m, clock };
}

test("receipts expire after 3.5s, undoable receipts after 7s, notices and alerts after 10s", async (t) => {
  const { m, clock } = await fresh(t);
  m.notify({ kind: "receipt", title: "Pasted" });
  m.notify({ kind: "receipt", title: "Route changed", actions: [{ label: "Undo", onClick() {} }] });
  m.notify({ kind: "notice", title: "Pasted without cleanup" });
  clock.advance(3_500);
  assert.deepEqual(m.getNotices().map((n) => n.title), ["Route changed", "Pasted without cleanup"]);
  clock.advance(3_500);
  assert.deepEqual(m.getNotices().map((n) => n.title), ["Pasted without cleanup"]);
  clock.advance(3_000);
  assert.equal(m.getNotices().length, 0);
});

test("persistent notices and alerts that carry words never schedule a timer", async (t) => {
  const { m, clock } = await fresh(t);
  m.notify({ kind: "notice", title: "Model changed", persistent: true });
  m.notify({ kind: "alert", title: "Couldn't paste", words: "hello there" });
  assert.equal(clock.pending(), 0);
  clock.advance(60_000);
  assert.equal(m.getNotices().length, 2);
  assert.equal(m.noticeLifetimeMs({ kind: "alert", title: "x", words: "" }), 10_000);
});

test("content on any kind is never allowed to expire (I13)", async (t) => {
  const { m, clock } = await fresh(t);
  // A JS caller (or a cast) that puts words on a notice gets an alert, not a 10s chip.
  m.notify({ kind: "notice", title: "Recovered", words: "keep me" });
  clock.advance(60_000);
  const [n] = m.getNotices();
  assert.equal(n.kind, "alert");
  assert.equal(n.words, "keep me");
  assert.equal(n.expiresAt, null);
});

test("the same id replaces the earlier notice, bumps its revision and reports 'replaced' once", async (t) => {
  const { m } = await fresh(t);
  const reasons = [];
  const first = m.notify({ id: "cleanup-failed", kind: "notice", title: "A", onDismiss: (r) => reasons.push(`A:${r}`) });
  const second = m.notify({ id: "cleanup-failed", kind: "notice", title: "B", onDismiss: (r) => reasons.push(`B:${r}`) });
  assert.equal(first, "cleanup-failed");
  assert.equal(second, "cleanup-failed");
  assert.deepEqual(m.getNotices().map((n) => [n.title, n.revision]), [["B", 2]]);
  m.dismissNotice("cleanup-failed");
  m.dismissNotice("cleanup-failed");
  assert.deepEqual(reasons, ["A:replaced", "B:user"]);
});

test("a fourth notice evicts the oldest expiring one with reason 'evicted'; persistent ones survive", async (t) => {
  const { m } = await fresh(t);
  const reasons = [];
  m.notify({ kind: "notice", title: "keep", persistent: true });
  m.notify({ kind: "receipt", title: "old", onDismiss: (r) => reasons.push(`old:${r}`) });
  m.notify({ kind: "receipt", title: "mid" });
  m.notify({ kind: "receipt", title: "new" });
  assert.deepEqual(m.getNotices().map((n) => n.title), ["keep", "mid", "new"]);
  assert.deepEqual(reasons, ["old:evicted"]);
});

test("timeouts report 'timeout' exactly once", async (t) => {
  const { m, clock } = await fresh(t);
  const reasons = [];
  m.notify({ kind: "receipt", title: "Pasted", onDismiss: (r) => reasons.push(r) });
  clock.advance(10_000);
  assert.deepEqual(reasons, ["timeout"]);
});

test("visibleNotices shows the newest three when persistent notices overflow", async (t) => {
  const { m } = await fresh(t);
  for (const title of ["a", "b", "c", "d"]) m.notify({ kind: "alert", title, persistent: true });
  assert.equal(m.getNotices().length, 4);
  assert.deepEqual(m.visibleNotices(m.getNotices()).map((n) => n.title), ["b", "c", "d"]);
});

test("recovered words are never evicted, however many arrive (R2-C3)", async (t) => {
  const { m } = await fresh(t);
  const reasons = [];
  for (const words of ["one", "two", "three", "four"]) {
    m.notify({ id: `dictation-recovery:${words}`, kind: "alert", title: "Couldn't paste", words, onDismiss: (r) => reasons.push(r) });
  }
  m.notify({ kind: "receipt", title: "Pasted" });
  m.notify({ kind: "receipt", title: "Copied" });
  assert.deepEqual(m.wordsNotices(m.getNotices()).map((n) => n.words), ["one", "two", "three", "four"]);
  assert.deepEqual(reasons, []);
});

test("only the user or an action removes words; automatic reasons are ignored (R2-C3)", async (t) => {
  const { m } = await fresh(t);
  const id = m.notify({ id: "dictation-recovery:rec-1", kind: "alert", title: "Couldn't paste", words: "keep me" });
  for (const reason of ["timeout", "evicted", "replaced"]) m.dismissNotice(id, reason);
  assert.equal(m.getNotices().length, 1);
  m.dismissNotice(id, "action");
  assert.equal(m.getNotices().length, 0);
});

test("a status update under a words id keeps the words (R2-C3)", async (t) => {
  const { m } = await fresh(t);
  const id = m.notify({ id: "dictation-recovery:rec-1", kind: "alert", title: "Couldn't paste", words: "keep me" });
  m.notify({ id, kind: "notice", title: "Still couldn't paste" });
  const [n] = m.getNotices();
  assert.deepEqual([n.title, n.kind, n.words, n.expiresAt, n.revision], ["Still couldn't paste", "alert", "keep me", null, 2]);
});

test("different words under one id never overwrite the earlier words (R2-C3)", async (t) => {
  const { m } = await fresh(t);
  const first = m.notify({ id: "dictation-recovery:x", kind: "alert", title: "A", words: "first" });
  const second = m.notify({ id: "dictation-recovery:x", kind: "alert", title: "B", words: "second" });
  assert.notEqual(second, first);
  assert.deepEqual(m.wordsNotices(m.getNotices()).map((n) => [n.id, n.words]), [[first, "first"], [second, "second"]]);
});

test("at most three are visible; held words beyond the card are counted and can be raised", async (t) => {
  const { m } = await fresh(t);
  const a = m.notify({ id: "dictation-recovery:a", kind: "alert", title: "A", words: "first" });
  m.notify({ id: "dictation-recovery:b", kind: "alert", title: "B", words: "second" });
  for (const title of ["x", "y", "z"]) m.notify({ kind: "notice", title, persistent: true });

  const pill = m.noticeLayout(m.getNotices(), "pill");
  assert.equal(pill.card.words, "second");
  assert.equal(pill.moreWords, 1);
  assert.deepEqual(pill.chips, []);
  const panel = m.noticeLayout(m.getNotices(), "panel");
  assert.equal(panel.card.words, "second");
  assert.deepEqual(panel.chips.map((n) => n.title), ["y", "z"]); // card + two chips = three

  m.raiseNotice(a);
  assert.equal(m.noticeLayout(m.getNotices(), "pill").card.words, "first");
  assert.equal(m.getNotices().find((n) => n.id === a).revision, 1, "raising is not a new revision");
  assert.equal(m.getNotices().length, 5, "nothing was dropped");
});

test("hover pause freezes the countdown; resume keeps the remaining time", async (t) => {
  const { m, clock } = await fresh(t);
  const id = m.notify({ kind: "receipt", title: "Pasted" });
  clock.advance(3_000);
  m.pauseNotice(id);
  clock.advance(20_000);
  assert.equal(m.getNotices().length, 1);
  m.resumeNotice(id);
  clock.advance(499);
  assert.equal(m.getNotices().length, 1);
  clock.advance(1);
  assert.equal(m.getNotices().length, 0);
});

test("an action dismisses its own revision with reason 'action', unless keepOpen", async (t) => {
  const { m } = await fresh(t);
  const reasons = [];
  let ran = 0;
  const id = m.notify({ kind: "notice", title: "x", onDismiss: (r) => reasons.push(r) });
  await m.runNoticeAction(id, { label: "Go", onClick: () => { ran++; } });
  await m.runNoticeAction(id, { label: "Go", onClick: () => { ran++; } });
  assert.equal(ran, 1, "a dismissed notice runs nothing");
  assert.deepEqual(reasons, ["action"]);
  const kept = m.notify({ kind: "alert", title: "y" });
  await m.runNoticeAction(kept, { label: "Retry", keepOpen: true, onClick: () => {} });
  assert.equal(m.getNotices().length, 1);
});

test("a replacement published by the action survives the action's own dismissal (I10)", async (t) => {
  const { m } = await fresh(t);
  const id = m.notify({ id: "cleanup-failed", kind: "notice", title: "Pasted without cleanup" });
  await m.runNoticeAction(id, {
    label: "Retry cleanup",
    onClick: async () => {
      // The retry fails again and explains why, under the same id.
      m.notify({ id: "cleanup-failed", kind: "alert", title: "Cleanup failed again" });
    },
  });
  assert.deepEqual(m.getNotices().map((n) => [n.title, n.revision]), [["Cleanup failed again", 2]]);
});

test("a notice is busy while its action runs and ignores repeated activation", async (t) => {
  const { m } = await fresh(t);
  let release;
  let runs = 0;
  const gate = new Promise((r) => (release = r));
  const id = m.notify({ kind: "alert", title: "Couldn't paste" });
  const action = { label: "Paste again", keepOpen: true, onClick: async () => { runs++; await gate; } };
  const first = m.runNoticeAction(id, action);
  assert.equal(m.getNotices()[0].busy, true);
  await m.runNoticeAction(id, action);
  release();
  await first;
  assert.equal(runs, 1);
  assert.equal(m.getNotices()[0].busy, false);
});

test("a failing action still dismisses its revision and rethrows", async (t) => {
  const { m } = await fresh(t);
  const id = m.notify({ kind: "notice", title: "x" });
  await assert.rejects(m.runNoticeAction(id, { label: "Boom", onClick: () => { throw new Error("nope"); } }), /nope/);
  assert.equal(m.getNotices().length, 0);
});

test("notices that arrive in the same 40ms window stagger 0, 1, 2", async (t) => {
  const { m, clock } = await fresh(t);
  const a = m.notify({ kind: "receipt", title: "a" });
  clock.advance(10);
  const b = m.notify({ kind: "receipt", title: "b" });
  clock.advance(10);
  const c = m.notify({ kind: "receipt", title: "c" });
  assert.deepEqual([a, b, c].map((id) => m.staggerIndex(m.getNotices(), id)), [0, 1, 2]);
  clock.advance(500);
  const d = m.notify({ kind: "receipt", title: "d" });
  const list = m.getNotices();
  assert.equal(list.some((n) => n.id === a), false); // capped at three
  assert.deepEqual([b, c, d].map((id) => m.staggerIndex(list, id)), [0, 1, 0]);
});
