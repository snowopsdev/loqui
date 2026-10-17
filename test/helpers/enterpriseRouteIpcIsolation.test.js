const assert = require("node:assert/strict");
const test = require("node:test");
const { enterpriseRouteIpc } = require("./harness/enterpriseRouteIpc");

test("enterprise IPC fixture isolates unrelated leaves through setup and awaited handlers", async (t) => {
  const ipc = enterpriseRouteIpc(t, { BEDROCK_REGION: "us-east-1", VERTEX_AUTH_SOURCE: "adc" });
  assert.equal(ipc.isolation.sweepStubCalls, 1, "setup calls only the stubbed sweep");
  assert.equal(require.cache[require.resolve("../../src/helpers/urlAudioDownloader")], undefined);
  await Promise.resolve();
  const state = await ipc.invoke("get-enterprise-route-state");
  assert.equal(state.current.bedrockRegion, "us-east-1");
  assert.equal(state.current.vertexAuthSource, "adc");
  assert.deepEqual(state.facts.bedrockEndpoint, { set: false, host: null });
  assert.equal(ipc.isolation.blockedDownloads, 0);
  assert.ok(
    ipc.isolation.unrelatedLoads.includes("./whisper"),
    "native/runtime leaf is stubbed before import"
  );
  assert.ok(
    ipc.isolation.unrelatedLoads.includes("./deepgramStreaming"),
    "provider leaf is stubbed before import"
  );
  const refused = await ipc.handlers.get("download-url-audio")({}, "https://fixture.invalid/audio");
  assert.equal(refused.success, false);
  assert.equal(ipc.isolation.blockedDownloads, 1, "late unrelated download stays fail closed");
  assert.equal(require.cache[require.resolve("../../src/helpers/urlAudioDownloader")], undefined);
});
