const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererServer } = require("../lib/routeTestApi");

test("change-driving: provider catalog", async (t) => {
  installBrowserGlobals(t);
  const vite = await rendererServer(t, "loqui-provider-catalog-");
  const c = await vite.ssrLoadModule("/components/settings/routing/providerCatalog.ts");

  await t.test("change-driving: capabilities follow the route", () => {
    assert.equal(c.capabilityOf("uploadStt"), "speech");
    assert.equal(c.capabilityOf("chat"), "text");
    assert.equal(c.capabilityOf("assistantVision"), "vision");
    assert.equal(c.capabilityOf("semanticSearch"), null);
  });

  await t.test(
    "change-driving: dictation offers every speech provider and custom, never text-only services",
    () => {
      const ids = c.providersForRoute("dictationStt");
      assert.ok(ids.includes("openai") && ids.includes("deepgram"));
      assert.ok(!ids.includes("anthropic") && !ids.includes("codex"));
      assert.equal(ids.at(-1), "custom");
    }
  );

  await t.test(
    "change-driving: note recording offers exactly the streaming providers main runs",
    () => {
      assert.deepEqual([...c.providersForRoute("noteRecordingStt")].sort(), [
        "assemblyai",
        "corti",
        "deepgram",
        "openai",
        "tinfoil",
      ]);
    }
  );

  await t.test("change-driving: upload drops realtime-only providers and keeps custom", () => {
    const ids = c.providersForRoute("uploadStt");
    assert.ok(!ids.includes("deepgram") && !ids.includes("assemblyai"));
    assert.ok(ids.includes("openai"));
    assert.equal(ids.at(-1), "custom");
  });

  await t.test("change-driving: text and vision use the provider registry's capabilities", () => {
    const text = c.providersForRoute("chat");
    assert.ok(text.includes("codex") && text.includes("corti") && text.includes("custom"));
    const vision = c.providersForRoute("assistantVision");
    assert.ok(vision.includes("openai") && vision.includes("custom"));
    assert.ok(
      !vision.includes("codex") && !vision.includes("corti") && !vision.includes("tinfoil")
    );
    assert.deepEqual(c.providersForRoute("speakerId"), []);
  });

  await t.test(
    "change-driving: every text tab is a provider main runs (Task 1's list)",
    async () => {
      const { TEXT_PROVIDER_IDS } = await vite.ssrLoadModule("/lib/routes.ts");
      assert.deepEqual(
        c.TEXT_PROVIDER_TABS.filter((id) => !TEXT_PROVIDER_IDS.includes(id)),
        []
      );
      assert.equal(c.TEXT_PROVIDER_IDS, undefined, "the catalog does not shadow Task 1's name");
    }
  );

  await t.test("change-driving: Corti asks each route for its own credential (I10)", () => {
    assert.deepEqual(c.credentialFor("dictationStt", "corti"), {
      credentialId: "corti:speech",
      fields: [
        { storeKey: "cortiClientId", labelKey: "transcription.corti.clientId" },
        { storeKey: "cortiClientSecret", labelKey: "transcription.corti.clientSecret" },
      ],
    });
    assert.equal(c.credentialFor("noteRecordingStt", "corti").credentialId, "corti:speech");
    assert.deepEqual(c.credentialFor("chat", "corti"), {
      credentialId: "corti:text",
      fields: [{ storeKey: "cortiApiKey", labelKey: "common.apiKey" }],
    });
    assert.equal(c.credentialFor("dictationStt", "deepgram").fields[0].storeKey, "deepgramApiKey");
    assert.equal(c.credentialFor("chat", "custom"), null);
    assert.equal(c.credentialFor("chat", "codex"), null);
    assert.equal(c.setsUpInEditor("vertex"), true);
    assert.equal(c.setsUpInEditor("openai"), false);
  });

  // Change-driving (R2-9): the staged panel had no model choice, so a remote text route could only
  // be applied without a model.
  await t.test(
    "change-driving: the staged panel offers the registry's models, or a typed id where there is no list",
    async () => {
      const { REASONING_PROVIDERS, getTranscriptionModels } = await vite.ssrLoadModule(
        "/models/ModelRegistry.ts"
      );
      assert.deepEqual(
        c.modelsForRoute("chat", "openai").map((m) => m.id),
        REASONING_PROVIDERS.openai.models.map((m) => m.value)
      );
      assert.deepEqual(
        c.modelsForRoute("dictationStt", "openai").map((m) => m.id),
        getTranscriptionModels("openai").map((m) => m.id)
      );
      for (const typed of ["custom", "openrouter", "codex", "azure", "bedrock", "vertex"]) {
        assert.deepEqual(
          c.modelsForRoute("chat", typed),
          [],
          `${typed} takes a typed or listed id`
        );
      }
    }
  );
});

// Change-driving: nonempty draft text is not proof that main saved a key.
test("change-driving: saved credential copy requires acknowledged sentinels", async (t) => {
  installBrowserGlobals(t);
  const vite = await rendererServer(t, "loqui-provider-ack-copy-");
  const c = await vite.ssrLoadModule("/components/settings/routing/providerCatalog.ts");
  const spec = c.credentialFor("dictationStt", "corti");
  assert.equal(
    c.hasSavedCredential(spec, { cortiClientId: "draft", cortiClientSecret: "draft" }),
    false
  );
  assert.equal(
    c.hasSavedCredential(spec, { cortiClientId: "__stored__", cortiClientSecret: "" }),
    false
  );
  assert.equal(
    c.hasSavedCredential(spec, { cortiClientId: "__stored__", cortiClientSecret: "__stored__" }),
    true
  );
});
