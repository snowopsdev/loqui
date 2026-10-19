const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { mountComponent, expectKey } = require("../helpers/harness/mountComponent");

// Plan 03's published chips (§5.1), stubbed so the test sees exactly what the step hands them.
const ROUTE_CHIPS_MOCK = `
import React from "react";
export function RouteDestinationChip({ route }) {
  return React.createElement("span", { "data-route-chip": "destination", "data-locality": route.locality, "data-provider": route.providerId ?? "" });
}
export function RouteStateChip({ state }) {
  return React.createElement("span", { "data-route-chip": "state", "data-state": state.status });
}`;

const SENTENCE = "um remind me to book the room";
const route = (patch = {}) => ({
  id: "dictationCleanup",
  kind: "text",
  locality: "device",
  provider: null,
  providerId: null,
  host: null,
  model: null,
  state: { status: "off" },
  sends: null,
  settingsPath: "llms/dictationCleanup",
  ...patch,
});
const remoteReady = route({
  locality: "remote",
  provider: "OpenAI",
  providerId: "openai",
  state: { status: "ready" },
});

async function cleanup(t, props = {}) {
  const chosen = [];
  const runs = [];
  const ui = await mountComponent(t, "/components/onboarding/CleanupStep.tsx", {
    exportName: "CleanupStep",
    props: {
      choice: "none",
      status: "skipped",
      onChoose: (choice) => chosen.push(choice),
      userText: SENTENCE,
      route: route(),
      providerLabel: "OpenAI",
      selection: {
        provider: "openai",
        model: "fixture-a",
        inferenceScope: "dictationCleanup",
        systemPrompt: "prompt-a",
      },
      isSelectionCurrent: () => true,
      runCleanup: (text) => {
        runs.push(text);
        return { result: Promise.resolve("Remind me to book the room."), retire() {} };
      },
      reuse: false,
      onReuseChange() {},
      ...props,
    },
    mocks: {
      "/CodexConnection": "export default function CodexConnection() { return null; }",
      "routing/RouteChips": ROUTE_CHIPS_MOCK,
    },
  });
  await React.act(async () => {});
  return { ui, chosen, runs };
}

test("one segmented radio group, no Recommended badge, and your words first", async (t) => {
  const { ui, chosen } = await cleanup(t);
  const [group] = ui.byAttr("role", "radiogroup");
  assert.equal(group.attributes["data-variant"], "segmented");
  assert.equal(ui.byAttr("role", "radio").length, 4);
  assert.equal(ui.text().includes("Recommended"), false);
  assert.ok(ui.text().includes(SENTENCE));
  expectKey(ui, "setupFlow.cleanup.nothingChanges");
  expectKey(ui, "setupFlow.cleanup.now.off");
  await ui.click(ui.byAttr("data-value", "codex")[0]);
  assert.deepEqual(chosen, ["codex"]);
});

test("Local runs on your own sentence on this device and marks what changed", async (t) => {
  const { ui, runs } = await cleanup(t, {
    choice: "local",
    status: "ready",
    route: route({ state: { status: "ready" }, model: "Qwen 3.5 2B" }),
  });
  assert.deepEqual(runs, [SENTENCE]);
  assert.ok(ui.text().includes("Remind me to book the room."));
  assert.ok(ui.findAll((node) => node.tagName === "MARK").length >= 1);
  assert.ok(ui.byAttr("data-locality", "device").length >= 1);
});

test("a connected remote cleanup waits for one explicit tap before sending your words (M01)", async (t) => {
  const { ui, runs } = await cleanup(t, { choice: "codex", status: "ready", route: remoteReady });
  assert.deepEqual(runs, [], "nothing leaves on its own");
  expectKey(ui, "setupFlow.cleanup.exampleNotice");
  expectKey(ui, "setupFlow.cleanup.wordsSent", { count: 7, provider: "OpenAI" });
  assert.ok(ui.byAttr("data-locality", "remote").length >= 1);
  await ui.click("setupFlow.cleanup.tryMine");
  assert.deepEqual(runs, [SENTENCE]);
  assert.ok(ui.text().includes("Remind me to book the room."));
  expectKey(ui, "setupFlow.cleanup.sentNotice", { count: 7, provider: "OpenAI" });
  await ui.rerender({ choice: "provider" });
  assert.equal(
    ui.text().includes("Remind me to book the room."),
    false,
    "a new choice drops the old run"
  );
});

test("the consent tap is offered only when the remote route is ready and you have a sentence", async (t) => {
  const { ui } = await cleanup(t, {
    choice: "provider",
    status: "failed",
    route: route({ locality: "remote", providerId: "openai" }),
  });
  assert.equal(ui.text().includes("setupFlow.cleanup.tryMine"), false);
  await ui.rerender({ status: "ready", route: remoteReady, userText: null });
  assert.equal(ui.text().includes("setupFlow.cleanup.tryMine"), false);
});

test("a remote route never runs on its own, even if Local is selected", async (t) => {
  const { runs } = await cleanup(t, { choice: "local", status: "ready", route: remoteReady });
  assert.deepEqual(runs, []);
});

test("Now names the unmet prerequisite of the user's choice, with no raw state chip beside it (I05, R3-M02)", async (t) => {
  // Plan 03 resolves a chosen-but-unvalidated cleanup as `off` (cleanup stays disabled
  // until the check passes), so a raw chip here would read "Off" next to "needs key".
  const stateChips = (ui) => ui.byAttr("data-route-chip", "state");
  const offRoute = route({ locality: "remote", providerId: "openai", state: { status: "off" } });
  const { ui } = await cleanup(t, { choice: "provider", status: "failed", route: offRoute });
  expectKey(ui, "setupFlow.cleanup.now.needsKey", { provider: "OpenAI" });
  assert.equal(ui.text().includes("setupFlow.cleanup.now.off"), false);
  assert.equal(stateChips(ui).length, 0, "failed check: the sentence owns the status");
  await ui.rerender({ choice: "provider", status: "checking" });
  expectKey(ui, "setupFlow.cleanup.now.checking");
  assert.equal(stateChips(ui).length, 0, "still checking: no Off chip");
  await ui.rerender({ choice: "codex", status: "failed" });
  expectKey(ui, "setupFlow.cleanup.now.needsConnection");
  assert.equal(stateChips(ui).length, 0);
  await ui.rerender({ choice: "local", status: "pending", route: route() });
  expectKey(ui, "setupFlow.cleanup.now.needsModel");
  assert.equal(stateChips(ui).length, 0, "local model pending: no Off chip");
  await ui.rerender({
    choice: "provider",
    status: "ready",
    route: { ...remoteReady, model: "GPT-5 mini" },
  });
  expectKey(ui, "setupFlow.cleanup.now.ready", { name: "GPT-5 mini", provider: "OpenAI" });
  assert.deepEqual(
    stateChips(ui).map((chip) => chip.attributes["data-state"]),
    ["ready"],
    "a validated route shows its state"
  );
  assert.equal(
    ui.byAttr("data-route-chip", "destination").length,
    1,
    "the destination chip stays in every case"
  );
});

test("route disclosures use Plan 03's published chips, fed the real route (R2-M02)", async (t) => {
  const { ui } = await cleanup(t, { choice: "codex", status: "ready", route: remoteReady });
  const [destination] = ui.byAttr("data-route-chip", "destination");
  assert.deepEqual(
    [destination.attributes["data-locality"], destination.attributes["data-provider"]],
    ["remote", "openai"]
  );
  assert.equal(ui.byAttr("data-route-chip", "state")[0].attributes["data-state"], "ready");
  await ui.rerender({ choice: "none", status: "skipped", route: route() });
  assert.equal(ui.byAttr("data-route-chip").length, 0, "no route to disclose when cleanup is off");
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const selected = (patch = {}) => ({
  provider: "openai",
  model: "fixture-a",
  inferenceScope: "dictationCleanup",
  baseUrl: undefined,
  systemPrompt: "prompt-a",
  ...patch,
});
const remoteCases = [
  [
    "remote to network",
    { route: route({ ...remoteReady, locality: "network", providerId: null, host: "10.0.0.5" }) },
  ],
  [
    "same-locality provider",
    {
      route: { ...remoteReady, providerId: "anthropic" },
      selection: selected({ provider: "anthropic" }),
    },
  ],
  [
    "same-host full endpoint path",
    { selection: selected({ provider: "custom", baseUrl: "https://fixture.invalid/path-b" }) },
  ],
  [
    "authentication source",
    {
      selection: selected({
        provider: "vertex",
        expectedEnterprise: {
          vertexAuthSource: "adc",
          vertexProject: "project-a",
          vertexLocation: "us-central1",
        },
      }),
    },
  ],
  [
    "enterprise project",
    {
      selection: selected({
        provider: "vertex",
        expectedEnterprise: {
          vertexAuthSource: "apiKey",
          vertexProject: "project-b",
          vertexLocation: "us-central1",
        },
      }),
    },
  ],
  ["generation options", { selection: selected({ disableThinking: false, temperature: 0.5 }) }],
  ["prompt", { selection: selected({ systemPrompt: "prompt-b" }) }],
  [
    "dictionary and language",
    {
      selection: selected({
        cleanupContext: {
          language: "fr",
          uiLanguage: "de",
          dictionary: ["Maya"],
          chineseScriptPreference: "as-transcribed",
        },
      }),
    },
  ],
  [
    "main credential generation",
    { selection: selected({ expectedAuthority: { credentialGeneration: 2 } }) },
  ],
  [
    "main configuration version",
    { selection: selected({ expectedAuthority: { enterpriseVersion: 2 } }) },
  ],
  ["choice", { choice: "codex" }],
  ["sentence", { userText: "please remind me to book another room" }],
];
for (const [name, change] of remoteCases) {
  test(`consent, running and result retire synchronously for ${name}; B requires its own tap`, async (t) => {
    const pending = [],
      captured = [],
      retired = [];
    const { ui } = await cleanup(t, {
      choice: "provider",
      status: "ready",
      route: remoteReady,
      selection: selected(),
      runCleanup: (text, descriptor, isCurrent) => {
        const gate = deferred();
        const id = pending.length;
        pending.push(gate);
        captured.push({ text, descriptor, isCurrent });
        return { result: gate.promise, retire: () => retired.push(id) };
      },
    });
    assert.equal(captured.length, 0);
    await ui.click("setupFlow.cleanup.tryMine");
    assert.equal(captured.length, 1);
    assert.equal(captured[0].isCurrent(), true);
    await ui.rerender(change);
    assert.equal(captured[0].isCurrent(), false);
    assert.ok(retired.includes(0));
    assert.equal(ui.text().includes("setupFlow.cleanup.running"), false);
    assert.equal(captured.length, 1, "old permission never admits B");
    await React.act(async () => pending[0].resolve("Old result A."));
    assert.equal(ui.text().includes("Old result A."), false);
    await ui.click("setupFlow.cleanup.tryMine");
    assert.equal(captured.length, 2);
    await React.act(async () => pending[1].resolve("Fresh result B."));
    assert.ok(ui.text().includes("Fresh result B."));
    assert.equal(ui.text().includes("setupFlow.cleanup.running"), false);
    await ui.rerender({ choice: "none", status: "skipped" });
    assert.equal(ui.text().includes("Fresh result B."), false);
  });
}

test("device to remote requires a fresh named tap; stale local completion cannot become remote output", async (t) => {
  const first = deferred(),
    requests = [],
    retired = [];
  const { ui } = await cleanup(t, {
    choice: "local",
    status: "ready",
    route: route({ state: { status: "ready" }, model: "local-a" }),
    selection: selected({ provider: "local", model: "local-a" }),
    runCleanup: (text, descriptor, isCurrent) => {
      requests.push({ text, descriptor, isCurrent });
      return { result: first.promise, retire: () => retired.push(descriptor.model) };
    },
  });
  assert.equal(requests.length, 1);
  await ui.rerender({ route: remoteReady, selection: selected() });
  assert.equal(requests[0].isCurrent(), false);
  assert.equal(requests.length, 1);
  assert.deepEqual(retired, ["local-a"]);
  await React.act(async () => first.resolve("Old local result."));
  assert.equal(ui.text().includes("Old local result."), false);
  assert.equal(ui.text().includes("setupFlow.cleanup.running"), false);
  expectKey(ui, "setupFlow.cleanup.tryMine", { count: 7, provider: "OpenAI" });
});

test("device model B gets its own automatic operation once; callback changes do not repeat it", async (t) => {
  const requests = [];
  const start = (text, descriptor) => {
    requests.push([text, descriptor.model]);
    return { result: Promise.resolve(`Model ${descriptor.model}.`), retire() {} };
  };
  const { ui } = await cleanup(t, {
    choice: "local",
    status: "ready",
    route: route({ state: { status: "ready" }, model: "A" }),
    selection: selected({ provider: "local", model: "A" }),
    runCleanup: start,
  });
  await ui.rerender({ runCleanup: (...args) => start(...args) });
  assert.deepEqual(
    requests.map(([, model]) => model),
    ["A"]
  );
  await ui.rerender({
    route: route({ state: { status: "ready" }, model: "B" }),
    selection: selected({ provider: "local", model: "B" }),
  });
  assert.deepEqual(
    requests.map(([, model]) => model),
    ["A", "B"]
  );
  assert.ok(ui.text().includes("Model B."));
});

test("failed remote admission preserves raw words and never claims Nothing was sent or displays an example as yours", async (t) => {
  const { ui } = await cleanup(t, {
    choice: "provider",
    status: "ready",
    route: remoteReady,
    runCleanup: () => ({
      result: Promise.reject(
        Object.assign(new Error("private provider body must not render"), {
          code: "CLEANUP_FAILED",
        })
      ),
      retire() {},
    }),
  });
  expectKey(ui, "setupFlow.cleanup.exampleNotice");
  await ui.click("setupFlow.cleanup.tryMine");
  expectKey(ui, "setupFlow.cleanup.attemptNotice", { count: 7, provider: "OpenAI" });
  expectKey(ui, "setupFlow.cleanupAuthority.failed");
  assert.ok(ui.text().includes(SENTENCE));
  assert.equal(ui.text().includes("setupFlow.cleanup.exampleNotice"), false);
  assert.equal(ui.text().includes("setupFlow.cleanup.sentNotice"), false);
  assert.equal(ui.text().includes("private provider body"), false);
  assert.equal(
    ui.byAttr("data-source").length,
    0,
    "failed request has original words, not invented before/after"
  );
});

test("no trial leaves remote cleanup as examples and admits no operation", async (t) => {
  const { ui, runs } = await cleanup(t, {
    choice: "provider",
    status: "ready",
    route: remoteReady,
    userText: null,
  });
  assert.equal(ui.text().includes("setupFlow.cleanup.tryMine"), false);
  assert.deepEqual(runs, []);
  assert.equal(ui.byAttr("data-source", "example").length, 1);
});

test("duplicate taps are blocked synchronously and unmount retires the active owner", async (t) => {
  const gate = deferred();
  let calls = 0,
    retirements = 0;
  const { ui } = await cleanup(t, {
    choice: "provider",
    status: "ready",
    route: remoteReady,
    runCleanup: () => {
      calls++;
      return { result: gate.promise, retire: () => retirements++ };
    },
  });
  const button = ui.findAll(
    (n) => n.tagName === "BUTTON" && n.textContent.includes("setupFlow.cleanup.tryMine")
  )[0];
  const retainedClick = ui.props(button).onClick;
  await React.act(async () => {
    retainedClick();
    retainedClick();
  });
  assert.equal(calls, 1);
  await ui.unmount();
  assert.equal(retirements, 1);
  await React.act(async () => gate.resolve("Too late."));
});

test("rendered published chips use the actual destination and ready state", async (t) => {
  const ui = await mountComponent(t, "/components/onboarding/CleanupStep.tsx", {
    exportName: "CleanupStep",
    props: {
      choice: "provider",
      status: "ready",
      onChoose() {},
      userText: null,
      route: remoteReady,
      providerLabel: "OpenAI",
      selection: selected(),
      isSelectionCurrent: () => true,
      runCleanup: () => assert.fail("no sentence"),
      reuse: false,
      onReuseChange() {},
    },
    mocks: { "/CodexConnection": "export default function CodexConnection(){return null;}" },
  });
  assert.ok(ui.text().includes("routes.state.ready"));
  assert.ok(ui.text().includes("OpenAI"));
  assert.ok(ui.byAttr("data-locality", "remote").length > 0);
});

test("changing recipient after an admitted failed request never restores a blanket Nothing was sent claim", async (t) => {
  const { ui } = await cleanup(t, {
    choice: "provider",
    status: "ready",
    route: remoteReady,
    runCleanup: () => ({
      result: Promise.reject(Object.assign(new Error("failed"), { code: "CLEANUP_FAILED" })),
      retire() {},
    }),
  });
  await ui.click("setupFlow.cleanup.tryMine");
  await ui.rerender({
    route: { ...remoteReady, providerId: "anthropic" },
    providerLabel: "Anthropic",
    selection: selected({ provider: "anthropic" }),
  });
  assert.equal(ui.text().includes("setupFlow.cleanup.exampleNotice"), false);
  expectKey(ui, "setupFlow.cleanup.previousAttemptNotice", { count: 7, provider: "OpenAI" });
});

test("network consent names its actual host instead of a retained cloud-provider label", async (t) => {
  const { ui, runs } = await cleanup(t, {
    choice: "provider",
    status: "ready",
    providerLabel: "OpenAI",
    route: route({
      locality: "network",
      host: "10.0.0.5:9000",
      model: "server-a",
      state: { status: "ready" },
    }),
    selection: selected({ provider: "lan", baseUrl: "http://10.0.0.5:9000/path-a" }),
  });
  assert.deepEqual(runs, []);
  expectKey(ui, "setupFlow.cleanup.tryMine", { count: 7, provider: "10.0.0.5:9000" });
  await ui.click("setupFlow.cleanup.tryMine");
  expectKey(ui, "setupFlow.cleanup.sentNotice", { count: 7, provider: "10.0.0.5:9000" });
});
