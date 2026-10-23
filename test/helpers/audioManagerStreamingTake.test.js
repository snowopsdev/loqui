const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { mountTrial, configureStreamingStartup, flush } = require("./harness/audioRecordingTrial");
const { publishDemoEvent } = require("../../src/helpers/onboardingInputPolicy");

for (const kind of ["partial", "error"]) {
  test(`IR2 actual streaming ${kind} -> mounted hook -> publisher keeps captured take and refuses newer admission`, async (t) => {
    const h = await mountTrial(t);
    const stream = configureStreamingStartup(t, h);
    const take = await h.reserve({ demoId: "demo-A", takeId: "string-A" });
    stream.connect.resolve({ success: true });
    await (await h.start(take)).finish();
    const session = { id: take.demoId, takeId: take.takeId, kind: "dictation" };
    const holder = {};
    const listening = h.events.find((event) => event.status === "listening");
    assert.equal(publishDemoEvent(listening, session, holder)?.status, "listening");
    const callback = stream.listeners[kind];
    // Changing the mutable tag cannot relabel an already attached A callback.
    stream.manager._onboardingTake = {
      demoId: "demo-B",
      takeId: "string-B",
      reservationId: "nonce-B",
    };
    const message = `captured A ${kind}`;
    await React.act(async () => {
      callback(message);
      await stream.manager._streamingStopPromise;
      await flush();
    });
    const event = h.events.findLast(
      (item) => item.status === kind && (item.text === message || item.message === message)
    );
    assert.ok(event, "actual mounted hook published callback event");
    assert.equal(event.demoId, take.demoId);
    assert.equal(event.takeId, take.takeId);
    assert.equal(event.reservationId, take.reservationId);
    assert.equal(
      publishDemoEvent(event, session, holder)?.status,
      kind,
      "current captured take admitted"
    );
    for (const id of [take.demoId, "demo-B"]) {
      const newer = { id, kind: "dictation", takeId: "string-B", sawListening: true };
      const before = { ...newer };
      assert.equal(
        publishDemoEvent(event, newer, holder),
        null,
        "old A cannot enter a newer admission"
      );
      assert.deepEqual(newer, before);
    }
    stream.manager._onboardingTake = take;
    await React.act(async () => {
      await stream.manager.cancelStreamingRecording();
      await flush();
    });
    const count = h.events.length;
    await React.act(async () => {
      callback("late retired A");
      await flush();
    });
    assert.equal(h.events.length, count, "retired session callback is inert");
    assert.deepEqual(h.writes, []);
  });
}
