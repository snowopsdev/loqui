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
