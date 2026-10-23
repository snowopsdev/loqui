const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/stores/homeViewStore.ts");

test("a transcript focus request clears whatever hides the row", async () => {
  const store = await load();
  store.setHomeFilter("meetings");
  store.setHomeQuery("pricing");
  store.requestTranscriptFocus(311);
  const state = store.useHomeViewStore.getState();
  assert.equal(state.filter, "all");
  assert.equal(state.query, "");
  assert.equal(state.focusTranscriptId, 311);
});

test("asking for the same transcript twice re-rings it", async () => {
  const store = await load();
  store.requestTranscriptFocus(5);
  const first = store.useHomeViewStore.getState().focusNonce;
  store.requestTranscriptFocus(5);
  assert.equal(store.useHomeViewStore.getState().focusNonce, first + 1);
  store.clearTranscriptFocus();
  assert.equal(store.useHomeViewStore.getState().focusTranscriptId, null);
});

test("See all in History shows every kind with the query applied", async () => {
  const store = await load();
  store.setHomeFilter("failed");
  store.showHomeQuery("standup");
  assert.deepEqual(
    {
      filter: store.useHomeViewStore.getState().filter,
      query: store.useHomeViewStore.getState().query,
    },
    { filter: "all", query: "standup" }
  );
});
