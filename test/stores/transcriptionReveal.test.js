const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/stores/transcriptionStore.ts");
const row = (id, timestamp) => ({ id, text: `t${id}`, timestamp, status: "completed" });

test("an older dictation is revealed in order, beyond the loaded page", async () => {
  const store = await load();
  store.useTranscriptionStore.setState({
    transcriptions: [row(3, "2026-10-14 12:00:00"), row(2, "2026-10-13 12:00:00")],
  });
  store.revealTranscription(row(1, "2026-09-01 08:00:00"));
  store.revealTranscription(row(9, "2026-10-13 18:00:00"));
  assert.deepEqual(
    store.useTranscriptionStore.getState().transcriptions.map((r) => r.id),
    [3, 9, 2, 1]
  );
});

test("revealing a row that is already loaded replaces it in place", async () => {
  const store = await load();
  store.useTranscriptionStore.setState({ transcriptions: [row(3, "2026-10-14 12:00:00")] });
  store.revealTranscription({ ...row(3, "2026-10-14 12:00:00"), text: "edited" });
  assert.deepEqual(
    store.useTranscriptionStore.getState().transcriptions.map((r) => [r.id, r.text]),
    [[3, "edited"]]
  );
});

test("existing replacements retain their slot even with synthetic changed time; inputs stay untouched", async () => {
  const store = await load();
  const rows = Object.freeze([
    Object.freeze(row(3, "2026-10-14 12:00:00")),
    Object.freeze(row(2, "2026-10-13 12:00:00")),
  ]);
  store.useTranscriptionStore.setState({ transcriptions: rows });
  const replacement = Object.freeze({ ...row(2, "2026-10-20 12:00:00"), text: "edited" });
  store.revealTranscription(replacement);
  assert.deepEqual(
    store.useTranscriptionStore.getState().transcriptions.map((r) => r.id),
    [3, 2]
  );
  assert.equal(store.useTranscriptionStore.getState().transcriptions[1], replacement);
  assert.equal(rows[1].text, "t2");
});
test("new ids break equal timestamp ties by descending id without limiting the revealed page", async () => {
  const store = await load();
  const rows = Array.from({ length: 50 }, (_, i) => row(100 - i, "2026-10-14 12:00:00"));
  store.useTranscriptionStore.setState({ transcriptions: rows });
  store.revealTranscription(row(101, "2026-10-14 12:00:00"));
  store.revealTranscription(row(1, "2026-09-01 12:00:00"));
  assert.deepEqual(
    store.useTranscriptionStore.getState().transcriptions.map((r) => r.id),
    [101, ...rows.map((r) => r.id), 1]
  );
  assert.equal(rows.length, 50);
});

test("landing retention follows page inclusion, current ownership, and explicit release", async (t) => {
  const store = await load();
  const previousWindow = globalThis.window;
  const pending = [];
  globalThis.window = {
    addEventListener() {},
    electronAPI: { getTranscriptions: () => new Promise((resolve) => pending.push(resolve)) },
  };
  t.after(() => {
    globalThis.window = previousWindow;
  });
  store.useTranscriptionStore.setState({ transcriptions: [], includeDiscarded: true });
  let current = true;
  const landing = store.retainTranscriptionForLanding(1, () => current);
  t.after(landing.release);
  const page = store.initializeTranscriptions(50, true);
  landing.reveal({ ...row(1, "2026-09-01 12:00:00"), status: "discarded" });
  landing.releaseAfterPages();
  pending.shift()([row(20, "2026-10-14 12:00:00")]);
  await page;
  assert.deepEqual(
    store.useTranscriptionStore.getState().transcriptions.map((r) => r.id),
    [20, 1]
  );
  const later = store.initializeTranscriptions(50, true);
  pending.shift()([row(20, "2026-10-14 12:00:00")]);
  await later;
  assert.deepEqual(
    store.useTranscriptionStore.getState().transcriptions.map((r) => r.id),
    [20]
  );
  current = false;
  landing.reveal(row(1, "2026-09-01 12:00:00"));
  assert.deepEqual(
    store.useTranscriptionStore.getState().transcriptions.map((r) => r.id),
    [20]
  );
});

test("a rejected page releases completed landing retention rather than pinning a later page", async (t) => {
  const store = await load();
  const previousWindow = globalThis.window;
  let rejectPage;
  globalThis.window = {
    addEventListener() {},
    electronAPI: {
      getTranscriptions: () =>
        new Promise((_resolve, reject) => {
          rejectPage = reject;
        }),
    },
  };
  t.after(() => {
    globalThis.window = previousWindow;
  });
  store.useTranscriptionStore.setState({ transcriptions: [], includeDiscarded: false });
  const landing = store.retainTranscriptionForLanding(1, () => true);
  t.after(landing.release);
  const page = store.initializeTranscriptions(50, false);
  landing.reveal(row(1, "2026-09-01 12:00:00"));
  landing.releaseAfterPages();
  rejectPage(new Error("Temporary page failure"));
  await assert.rejects(page, /Temporary page failure/);
  globalThis.window.electronAPI.getTranscriptions = async () => [row(20, "2026-10-14 12:00:00")];
  await store.initializeTranscriptions(50, false);
  assert.deepEqual(
    store.useTranscriptionStore.getState().transcriptions.map((r) => r.id),
    [20]
  );
});

test("a page tombstone invalidates retention through another pending page", async (t) => {
  const store = await load();
  const previousWindow = globalThis.window;
  const pending = [];
  globalThis.window = {
    addEventListener() {},
    electronAPI: { getTranscriptions: () => new Promise((resolve) => pending.push(resolve)) },
  };
  t.after(() => {
    globalThis.window = previousWindow;
  });
  store.useTranscriptionStore.setState({ transcriptions: [], includeDiscarded: false });
  const landing = store.retainTranscriptionForLanding(1, () => true);
  t.after(landing.release);
  const first = store.initializeTranscriptions(50, false);
  const second = store.initializeTranscriptions(50, false);
  landing.reveal(row(1, "2026-09-01 12:00:00"));
  pending.shift()([{ ...row(1, "2026-09-01 12:00:00"), deleted_at: "2026-10-17 12:00:00" }]);
  await first;
  pending.shift()([row(20, "2026-10-14 12:00:00")]);
  await second;
  assert.equal(landing.isCurrent(), false);
  assert.deepEqual(
    store.useTranscriptionStore.getState().transcriptions.map((r) => r.id),
    [20]
  );
});
