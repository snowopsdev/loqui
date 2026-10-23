const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { mountComponent } = require("../helpers/harness/mountComponent");
const { MIGRATED_STORAGE } = require("../lib/routeStateFixture");

test("actual Settings Codex picker discovers only on its labeled button; account events invalidate the list", async (t) => {
  const listeners = new Set();
  let discoveries = 0;
  const ui = await mountComponent(t, "/components/ReasoningModelSelector.tsx", {
    storage: MIGRATED_STORAGE,
    // Geometry-only tab strip is outside this discovery test; retain the actual
    // selector, CodexModelPicker, connection, effects and model-card list.
    mocks: { "/ui/ProviderTabs": "export function ProviderTabs(){ return null; }" },
    props: {
      reasoningModel: "",
      localReasoningProvider: "codex",
      cloudReasoningBaseUrl: "",
      mode: "cloud",
      onCommit() {},
      onRoutePatch() {},
    },
    api: {
      getPlatform: () => "linux",
      personalInference: {
        onTextEvent: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        codexStatus: async () => ({ available: true, account: { type: "chatgpt" } }),
        codexRateLimits: async () => ({}),
        codexModels: async () => {
          discoveries++;
          return {
            data: [{ model: "explicit-fixture", displayName: "Explicit fixture" }],
            nextCursor: null,
          };
        },
      },
    },
  });
  assert.equal(discoveries, 0);
  await React.act(async () => {
    for (const listener of [...listeners])
      listener({ type: "account", method: "account/updated", params: {} });
  });
  assert.equal(discoveries, 0, "account notification must not populate the acknowledged catalog");
  await ui.click("reasoning.codex.listModels");
  assert.equal(discoveries, 1);
  assert.ok(ui.text().includes("Explicit fixture"));
  await React.act(async () => {
    for (const listener of [...listeners])
      listener({ type: "account", method: "account/updated", params: {} });
  });
  assert.equal(discoveries, 1);
  assert.equal(ui.text().includes("Explicit fixture"), false);
});
