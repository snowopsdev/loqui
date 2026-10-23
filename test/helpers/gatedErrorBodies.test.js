const assert = require("node:assert/strict");
const test = require("node:test");
const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { gatedNodeFetch } = require("../../src/helpers/privacy/gatedFetch");
const { probeSelfHosted } = require("../../src/helpers/selfHostedProbe");
const { fetchRealtimeTokenForProvider } = require("../../src/helpers/realtimeTokenProviders");

// Final review I7: a gated response whose non-ok body is never read keeps its
// ticket open, writes no row, and is later recorded as a seal interruption.
// Every early return on a non-ok status must consume or cancel the body.
function setup(t) {
  const realFetch = globalThis.fetch;
  const recorder = new FlightRecorder({ now: () => 5 });
  recorder.setPersistence(false);
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => false, recorder, now: () => 5 });
  const calls = [];
  // The terminal leaf: an in-process response, never a socket.
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response("not here", { status: 404 });
  };
  t.after(() => {
    globalThis.fetch = realFetch;
    gate._resetForTests();
  });
  return { recorder, calls };
}

test("a self-hosted Test that gets a 404 settles its ticket and records the request", async (t) => {
  const { recorder, calls } = setup(t);
  const result = await probeSelfHosted(
    "http://192.168.1.20:8080/v1",
    gatedNodeFetch("providerCheck")
  );
  assert.deepEqual(result, { ok: false, code: "http", status: 404 });
  assert.equal(calls.length, 1);
  assert.equal(gate.activeRemoteCount(), 0);
  const rows = recorder.list();
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [rows[0].task, rows[0].status, rows[0].outcome],
    ["providerCheck", 404, "error"]
  );
  // A later seal finds nothing to interrupt.
  assert.equal(gate.abortAllRemote(), 0);
});

test("a rejected AssemblyAI token request settles its ticket and records the request", async (t) => {
  const { recorder } = setup(t);
  await assert.rejects(
    gate.withTask("dictationStt", () =>
      fetchRealtimeTokenForProvider(
        "assemblyai-realtime",
        {
          environmentManager: { getAssemblyAIKey: () => "fixture-key" },
          proxyFetch: gatedNodeFetch("dictationStt"),
        },
        { mode: "byok" }
      )
    ),
    /AssemblyAI token request failed: 404/
  );
  assert.equal(gate.activeRemoteCount(), 0);
  assert.deepEqual(
    recorder.list().map((row) => [row.host, row.status]),
    [["streaming.assemblyai.com", 404]]
  );
  assert.equal(gate.abortAllRemote(), 0);
});
