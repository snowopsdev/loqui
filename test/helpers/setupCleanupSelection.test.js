const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { MIGRATED_STORAGE } = require("../lib/routeStateFixture");

test("actual setup selection captures full selected nonsecret config; every meaningful field and main generation revokes it", async (t) => {
  installBrowserGlobals(t, { initialStorage: MIGRATED_STORAGE });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-setup-selection-" });
  const service = await vite.ssrLoadModule("/services/capturedCleanupOperation.ts");
  const { useSettingsStore: store } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useRouteFactsStore: facts } = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  store.setState({
    useCleanupModel: true,
    cleanupMode: "providers",
    cleanupProvider: "custom",
    cleanupModel: "fixture-a",
    cleanupCloudBaseUrl: "https://fixture.invalid/path-a",
    cleanupDisableThinking: true,
    preferredLanguage: "en",
    uiLanguage: "en",
    customDictionary: ["Maya"],
    customPrompts: { cleanup: "prompt-a" },
    cleanupCustomApiKey: "fixture-secret-must-stay-out",
  });
  const selected = service.captureSetupCleanupSelection();
  assert.equal(selected.baseUrl, "https://fixture.invalid/path-a");
  assert.equal(selected.model, "fixture-a");
  assert.equal(selected.inferenceScope, "dictationCleanup");
  assert.deepEqual(selected.cleanupContext.dictionary, ["Maya"]);
  assert.ok(selected.systemPrompt.includes("prompt-a"));
  assert.equal(JSON.stringify(selected).includes("fixture-secret-must-stay-out"), false);
  assert.equal(service.isSetupCleanupSelectionCurrent(selected), true);
  for (const [field, value] of [
    ["cleanupCloudBaseUrl", "https://fixture.invalid/path-b"],
    ["cleanupModel", "fixture-b"],
    ["cleanupProvider", "openai"],
    ["cleanupDisableThinking", false],
    ["preferredLanguage", "fr"],
    ["uiLanguage", "de"],
    ["chineseScriptPreference", "traditional"],
    ["customDictionary", ["Thursday"]],
    ["customPrompts", { cleanup: "prompt-b" }],
    ["useCleanupModel", false],
  ]) {
    const previous = store.getState()[field];
    store.setState({ [field]: value });
    assert.equal(service.isSetupCleanupSelectionCurrent(selected), false, field);
    store.setState({ [field]: previous });
  }
  facts.setState(({ facts: old }) => ({
    facts: { ...old, credentialGenerations: new Map([["custom:dictationCleanup", 1]]) },
  }));
  const generationA = service.captureSetupCleanupSelection();
  facts.setState(({ facts: old }) => ({
    facts: { ...old, credentialGenerations: new Map([["custom:dictationCleanup", 2]]) },
  }));
  assert.equal(service.isSetupCleanupSelectionCurrent(generationA), false);
  store.setState({
    cleanupProvider: "vertex",
    vertexAuthSource: "apiKey",
    vertexProject: "project-a",
    vertexLocation: "us-central1",
  });
  const vertex = service.captureSetupCleanupSelection();
  for (const [field, value] of [
    ["vertexAuthSource", "adc"],
    ["vertexProject", "project-b"],
    ["vertexLocation", "europe-west1"],
  ]) {
    const previous = store.getState()[field];
    store.setState({ [field]: value });
    assert.equal(service.isSetupCleanupSelectionCurrent(vertex), false, field);
    store.setState({ [field]: previous });
  }
});

test("actual synchronous setters revoke ABA selection before import/dispatch and completion; unrelated noise and fresh final A succeed", async (t) => {
  installBrowserGlobals(t, {
    initialStorage: MIGRATED_STORAGE,
    window: { electronAPI: { setDictionary: async () => {} } },
  });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-cleanup-aba-" });
  const service = await vite.ssrLoadModule("/services/capturedCleanupOperation.ts");
  const { useSettingsStore: store } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  store.setState({
    useCleanupModel: true,
    cleanupMode: "providers",
    cleanupProvider: "openai",
    cleanupModel: "a",
  });
  const first = service.captureSetupCleanupSelection();
  store.getState().setCleanupModel("b");
  store.getState().setCleanupModel("a");
  assert.equal(service.isSetupCleanupSelectionCurrent(first), false, "ABA never restores consent");
  for (const [field, change, restore] of [
    [
      "dictionary",
      () => store.getState().setCustomDictionary(["Maya"]),
      () => store.getState().setCustomDictionary([]),
    ],
    [
      "prompt",
      () => store.getState().setCustomPrompt("cleanup", "new prompt"),
      () => store.getState().setCustomPrompt("cleanup", ""),
    ],
  ]) {
    const selected = service.captureSetupCleanupSelection();
    change();
    restore();
    assert.equal(service.isSetupCleanupSelectionCurrent(selected), false, field);
  }
  const fresh = service.captureSetupCleanupSelection();
  store.setState({ theme: "dark" });
  assert.equal(service.isSetupCleanupSelectionCurrent(fresh), true);
});

for (const boundary of ["import", "result"]) {
  test(`actual setup runner rejects synchronous setter ABA during deferred ${boundary}, fresh named final A succeeds`, async (t) => {
    installBrowserGlobals(t, { initialStorage: MIGRATED_STORAGE });
    const vite = await createRendererServer(t, { cachePrefix: "loqui-cleanup-aba-runner-" });
    const service = await vite.ssrLoadModule("/services/capturedCleanupOperation.ts");
    const { createSetupCleanupOperation } = await vite.ssrLoadModule(
      "/components/onboarding/cleanupRunner.ts"
    );
    const { createCapturedTextBridge } = await vite.ssrLoadModule("/preview/capturedTextBridge.ts");
    const { useSettingsStore: store } = await vite.ssrLoadModule("/stores/settingsStore.ts");
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const calls = [];
    globalThis.window.electronAPI.personalInference = createCapturedTextBridge(
      async (descriptor, input) => {
        calls.push({ descriptor, input });
        if (boundary === "result") await held;
        return "Cleaned A.";
      }
    );
    store.setState({
      useCleanupModel: true,
      cleanupMode: "providers",
      cleanupProvider: "openai",
      cleanupModel: "a",
    });
    const selected = service.captureSetupCleanupSelection();
    const operation = createSetupCleanupOperation(
      "original raw words",
      selected,
      () => service.isSetupCleanupSelectionCurrent(selected),
      async () => {
        if (boundary === "import") await held;
        return service;
      }
    );
    const rejected = assert.rejects(operation.result, { code: "RECIPIENT_CHANGED" });
    if (boundary === "result")
      for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
    store.getState().setCleanupModel("b");
    store.getState().setCleanupModel("a");
    release();
    await rejected;
    assert.equal(calls.length, boundary === "import" ? 0 : 1);
    if (calls.length) {
      assert.equal(calls[0].descriptor.model, "a");
      assert.ok(calls[0].input.includes("original raw words"));
    }
    const retry = createSetupCleanupOperation(
      "original raw words",
      selected,
      () => service.isSetupCleanupSelectionCurrent(selected),
      async () => service
    );
    await assert.rejects(retry.result, { code: "RECIPIENT_CHANGED" });
    assert.equal(calls.length, boundary === "import" ? 0 : 1, "Retry cannot renew stale consent");
    const fresh = service.captureSetupCleanupSelection();
    store.setState({ theme: "dark" });
    const admitted = createSetupCleanupOperation(
      "original raw words",
      fresh,
      () => service.isSetupCleanupSelectionCurrent(fresh),
      async () => service
    );
    assert.equal(await admitted.result, "Cleaned A.");
  });
}

// Task 18 T18-06: a local cleanup envelope that says SEALED_MODE without
// main's explicit "refused" is not reported as a refusal.
test("a phase-less SEALED_MODE local cleanup envelope is never a refusal", async (t) => {
  installBrowserGlobals(t, { initialStorage: MIGRATED_STORAGE });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-setup-sealed-phaseless-" });
  const service = await vite.ssrLoadModule("/services/capturedCleanupOperation.ts");
  const { sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");
  for (const [envelope, phase] of [
    [{ success: false, code: "SEALED_MODE" }, "interrupted"],
    [{ success: false, code: "SEALED_MODE", phase: "unknown" }, "interrupted"],
    [{ success: false, code: "SEALED_MODE", phase: "refused" }, "refused"],
  ]) {
    globalThis.window.electronAPI = {
      processLocalReasoning: async () => envelope,
      personalInference: {
        captureTextOperation: async () => "fixture-token",
        runTextOperation: async () => ({ text: "unused" }),
        retireTextOperation: async () => {},
      },
    };
    const operation = service.createCapturedCleanupOperation(undefined, {
      provider: "local",
      model: "fixture-model",
      inferenceScope: "dictationCleanup",
    });
    await assert.rejects(
      operation.run("fixture words"),
      (error) => error.code === "SEALED_MODE" && sealedPhaseOf(error) === phase,
      JSON.stringify(envelope)
    );
  }
});

// Re-review m3: a remote cleanup rejected with SEALED_MODE but no stated phase
// (no details, no marker) is never reported as a refusal.
test("a phase-less SEALED_MODE remote cleanup rejection is interrupted, never refused", async (t) => {
  installBrowserGlobals(t, { initialStorage: MIGRATED_STORAGE });
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-setup-sealed-remote-phaseless-",
  });
  const service = await vite.ssrLoadModule("/services/capturedCleanupOperation.ts");
  const { sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");
  globalThis.window.electronAPI = {
    personalInference: {
      captureTextOperation: async () => "fixture-token",
      runTextOperation: async () => {
        throw Object.assign(new Error("stopped"), { code: "SEALED_MODE" });
      },
      retireTextOperation: async () => {},
    },
  };
  const operation = service.createCapturedCleanupOperation(undefined, {
    provider: "openai",
    model: "fixture-model",
    inferenceScope: "dictationCleanup",
  });
  await assert.rejects(
    operation.run("fixture words"),
    (error) => error.code === "SEALED_MODE" && sealedPhaseOf(error) === "interrupted"
  );
});

// Task 8: a Sealed mode refusal or interruption from main keeps its type and
// phase through the captured operation, under the existing translated copy.
test("a captured cleanup refused or interrupted by Sealed mode stays typed with its phase", async (t) => {
  installBrowserGlobals(t, { initialStorage: MIGRATED_STORAGE });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-setup-sealed-" });
  const service = await vite.ssrLoadModule("/services/capturedCleanupOperation.ts");
  const { isSealedModeError, sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");
  // installBrowserGlobals restores the whole window after this test.
  for (const phase of ["refused", "interrupted"]) {
    const sealed = Object.assign(
      new Error(
        phase === "interrupted"
          ? "[SEALED_MODE:interrupted] Sealed mode"
          : "[SEALED_MODE] Sealed mode"
      ),
      { code: "SEALED_MODE", details: { phase } }
    );
    globalThis.window.electronAPI = {
      personalInference: {
        captureTextOperation: async () => "fixture-token",
        runTextOperation: async () => {
          throw sealed;
        },
        retireTextOperation: async () => {},
      },
    };
    const operation = service.createCapturedCleanupOperation(undefined, {
      provider: "openai",
      model: "fixture-model",
      inferenceScope: "dictationCleanup",
    });
    await assert.rejects(
      operation.run("fixture words"),
      (error) =>
        error.code === "SEALED_MODE" &&
        isSealedModeError(error) &&
        sealedPhaseOf(error) === phase &&
        error.messageKey === "setupFlow.cleanupAuthority.failed"
    );
  }
});
