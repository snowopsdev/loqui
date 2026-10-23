// Task 9a: an adapter forwards a content frame only for a live realtime
// recording handle passed with it. Protocol fixtures that drive an adapter
// directly use this handle. Its recipient is loopback, so it is admitted even
// under the default-sealed gate and is never recorded or announced.
const { beginRealtimeRecording } = require("../../../src/helpers/sttTransport");

function fixtureRecording(correlationId = null) {
  return beginRealtimeRecording({
    task: "dictationStt",
    provider: "fixture",
    target: "ws://127.0.0.1/fixture",
    correlationId,
  });
}

module.exports = { fixtureRecording };
