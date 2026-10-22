const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");
const {
  gatedNetFetch,
  gatedNodeFetch,
  guardMetered,
} = require("../../src/helpers/privacy/gatedFetch");

let clock = 0;
const now = () => ++clock;
function harness(t, { sealed = false } = {}) {
  const flags = { sealed };
  const recorder = new FlightRecorder({ now });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now });
  t.after(() => gate._resetForTests());
  return { flags, recorder };
}

test("gatedNodeFetch refuses while sealed before the transport and holds its ticket until the body ends", async (t) => {
  const h = harness(t, { sealed: true });
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push([String(url), init]);
    return new Response("abcd", { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  const send = gatedNodeFetch("providerCheck", { provider: "groq" });
  await assert.rejects(send("https://api.groq.com/x"), (e) => sealedPhaseOf(e) === "refused");
  assert.deepEqual(calls, []);
  h.flags.sealed = false;
  const response = await send("https://api.groq.com/x", { method: "POST", body: "12" });
  assert.equal(calls.length, 1);
  assert.equal(gate.activeRemoteCount(), 1, "the body is still open");
  assert.equal(await response.text(), "abcd");
  assert.equal(gate.activeRemoteCount(), 0);
  const [row] = h.recorder.list();
  assert.deepEqual(
    [row.task, row.host, row.bytesOut, row.bytesIn, row.outcome],
    ["providerCheck", "api.groq.com", 2, 4, "ok"]
  );
});

test("sealing interrupts an open gatedNodeFetch body as interrupted", async (t) => {
  const h = harness(t);
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({ pull() {} }), { status: 200 });
  t.after(() => {
    globalThis.fetch = original;
  });
  const response = await gatedNodeFetch("chat")("https://api.groq.com/x");
  const reading = response.text();
  h.flags.sealed = true;
  gate.abortAllRemote();
  await assert.rejects(reading, (e) => sealedPhaseOf(e) === "interrupted");
  assert.equal(h.recorder.list()[0].outcome, "cancelled");
});

test("gatedNetFetch uses Electron net without session cookies and tags the attempt for the backstop", async (t) => {
  harness(t);
  const calls = [];
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "electron")
      return {
        net: {
          fetch: async (url, init) => {
            calls.push([url, init]);
            return new Response("{}", { status: 200 });
          },
        },
      };
    return original.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = original;
  });
  const response = await gatedNetFetch(
    "https://auth.eu.corti.app/x",
    {},
    { task: "providerCheck" }
  );
  await response.text();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].useSessionCookies, false);
  assert.match(new Headers(calls[0][1].headers).get(gate.EGRESS_TAG_HEADER), /^\d+\.1\./);
});

test("guardMetered writes no row for an exchange that sent nothing, and meters one that did", async (t) => {
  const h = harness(t);
  assert.equal(
    await guardMetered({ task: "codex", target: "https://api.github.com" }, async () => "cached"),
    "cached"
  );
  assert.equal(h.recorder.list().length, 0);
  assert.equal(gate.activeRemoteCount(), 0);
  await guardMetered({ task: "codex", target: "https://api.github.com" }, async (ticket) => {
    const response = await gate.meteredFetch(
      ticket,
      async () => new Response("ok")
    )("https://api.github.com/x");
    return response.text();
  });
  const [row] = h.recorder.list();
  assert.deepEqual(
    [row.task, row.host, row.kind, row.outcome],
    ["codex", "api.github.com", "request", "ok"]
  );
  h.flags.sealed = true;
  await assert.rejects(
    guardMetered({ task: "codex", target: "https://api.github.com" }, async () => "never"),
    (e) => sealedPhaseOf(e) === "refused"
  );
  assert.equal(h.recorder.list()[0].outcome, "blocked");
});
