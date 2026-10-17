const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// change-driving: every test below fails first because src/components/settings/screenContextCopy.ts
// does not exist yet (SET-Q15: the description never named where the screenshot goes).
const tr = (key, options) => (options ? `${key}${JSON.stringify(options)}` : key);
const load = () => import("../../src/components/settings/screenContextCopy.ts");
const PAYLOAD = "your spoken request and a screenshot of your screen";

test("[change-driving] a device route says the screenshot stays on this device", async () => {
  const { screenContextCopy } = await load();
  assert.equal(
    screenContextCopy(
      { locality: "device", providerId: null, host: null, model: "Qwen3.5 2B", sends: null },
      tr
    ),
    'dictationAgent.screenContext.goesToDevice{"model":"Qwen3.5 2B"}'
  );
  assert.equal(
    screenContextCopy(
      { locality: "device", providerId: null, host: null, model: null, sends: null },
      tr
    ),
    "dictationAgent.screenContext.goesToDeviceNoModel"
  );
});

test("[change-driving] a server route names its host and lists what it receives", async () => {
  const { screenContextCopy } = await load();
  assert.equal(
    screenContextCopy(
      {
        locality: "network",
        providerId: null,
        host: "192.168.1.20:11434",
        model: null,
        sends: PAYLOAD,
      },
      tr
    ),
    `dictationAgent.screenContext.goesToServer{"host":"192.168.1.20:11434","payload":"${PAYLOAD}"}`
  );
  assert.equal(
    screenContextCopy(
      { locality: "network", providerId: null, host: null, model: null, sends: PAYLOAD },
      tr
    ),
    "dictationAgent.screenContext.destinationUnspecified"
  );
});

test("[change-driving] a provider route names the provider, its host and the payload", async () => {
  const { screenContextCopy } = await load();
  assert.equal(
    screenContextCopy(
      {
        locality: "remote",
        providerId: "anthropic",
        host: "api.anthropic.com",
        model: "Claude Sonnet",
        sends: PAYLOAD,
      },
      tr
    ),
    `dictationAgent.screenContext.goesToProvider{"provider":"Anthropic","host":"api.anthropic.com","payload":"${PAYLOAD}"}`
  );
  assert.equal(
    screenContextCopy(
      { locality: "remote", providerId: "openai", host: null, model: null, sends: null },
      tr
    ),
    'dictationAgent.screenContext.goesToProviderNoHost{"provider":"OpenAI","payload":"routes.payload.screenshot"}',
    "a missing payload list falls back to the screenshot alone"
  );
});

test("[change-driving] a custom endpoint is named through the localised label, never the English one", async () => {
  const { screenContextCopy } = await load();
  const de = (key, options) =>
    key === "locality.customEndpoint" ? "Eigener Endpunkt" : tr(key, options);
  assert.match(
    screenContextCopy(
      {
        locality: "remote",
        providerId: "custom",
        host: "llm.example.org",
        model: null,
        sends: PAYLOAD,
      },
      de
    ),
    /"provider":"Eigener Endpunkt"/
  );
  const source = fs.readFileSync(
    path.join(__dirname, "../../src/components/settings/screenContextCopy.ts"),
    "utf8"
  );
  assert.doesNotMatch(source, /\bproviderDisplayName\b/);
});

// Baseline guards for the controller-approved incomplete-destination boundary;
// original RED was the missing module, not independent execution of these cases.
test("[baseline guard] unknown destination never invents a recipient or route status", async () => {
  const { screenContextCopy } = await load();
  const copy = screenContextCopy(
    { locality: "remote", providerId: null, host: null, model: null, sends: null },
    tr
  );
  assert.equal(copy, "dictationAgent.screenContext.destinationUnspecified");
  assert.doesNotMatch(copy, /ready|enabled|installed|off/i);
});
