const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { connectRealtime } = require("../../src/helpers/sttTransport");

// T9a-M2: a ws protocol error followed by a clean TCP close is a failed
// connection. The gate's own TCP close listener runs before ws's close, so the
// failure must be recorded when the error happens. Every socket is an
// in-process EventEmitter: nothing connects.
test("a realtime connection that saw a ws error is recorded as failed", (t) => {
  const recorder = new FlightRecorder({ now: () => 5 });
  recorder.setPersistence(false);
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => false, recorder, now: () => 5 });
  t.after(() => gate._resetForTests());
  const ws = new EventEmitter();
  ws.terminate = () => {};
  const tcp = Object.assign(new EventEmitter(), { bytesWritten: 40, bytesRead: 60 });
  tcp.destroy = () => {};
  connectRealtime(
    { task: "dictationStt", provider: "deepgram", target: "wss://api.deepgram.com/v1/listen" },
    () => ws
  );
  ws.emit("upgrade", { socket: tcp });
  ws.emit("error", new Error("Invalid WebSocket frame"));
  tcp.emit("close", false);
  ws.emit("close");
  const rows = recorder.list();
  assert.deepEqual(
    rows.map((row) => [row.kind, row.outcome, row.errorClass, row.bytesOut, row.bytesIn]),
    [["connection", "error", "CONNECTION", 40, 60]]
  );
});
