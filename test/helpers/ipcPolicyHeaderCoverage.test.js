const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../../src/helpers/ipcHandlers.js"), "utf8");

test("all OpenWhispr multipart transcription transports use policy headers", () => {
  assert.match(source, /async function chunkedCloudTranscribe\([\s\S]*?policyHeaders/);
  assert.doesNotMatch(source, /postMultipart\(url, body, boundary, authHeader/);
  assert.doesNotMatch(source, /chunkedCloudTranscribe\(\{[\s\S]{0,300}?\bauthHeader,/);
  assert.ok(
    (
      source.match(
        /postMultipart\(\s*url,\s*body,\s*boundary,\s*(?:policyHeaders|withPolicyHeaders\(authHeader\))/g
      ) ?? []
    ).length >= 4
  );
});

test("direct policy-aware JSON and token routes apply the shared headers", () => {
  assert.match(
    source,
    /const postServerToken[\s\S]{0,900}?headers:\s*withPolicyHeaders\(/,
    "the shared realtime-token helper must apply policy headers"
  );
  for (const route of [
    "streaming-token",
    "deepgram-streaming-token",
    "reason",
    "agent/stream",
    "agent/web-search",
  ]) {
    const directCalls = source.match(
      new RegExp(
        "proxyFetch\\(`\\$\\{apiUrl\\}/api/" +
          route +
          "`[\\s\\S]{0,300}?headers:\\s*withPolicyHeaders\\(",
        "g"
      )
    );
    assert.ok(directCalls?.length, `/api/${route} direct calls must use policy headers`);
  }
});

test("policy headers are not injected into BYOK or self-hosted transports", () => {
  const thirdPartySections = [
    source.slice(
      source.indexOf('provider === "tinfoil"'),
      source.indexOf('provider === "tinfoil"') + 1200
    ),
    source.slice(
      source.indexOf('kind === "self-hosted"'),
      source.indexOf('kind === "self-hosted"') + 1200
    ),
  ];
  for (const section of thirdPartySections) {
    assert.doesNotMatch(section, /withPolicyHeaders/);
  }
});
