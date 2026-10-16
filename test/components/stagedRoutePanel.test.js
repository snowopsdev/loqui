const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals } = require("../lib/rendererTestHarness");
const { createProbeRoot, findElement } = require("../lib/probeRoot");
const {
  primeRouteFacts,
  rendererServer,
  routeTestApi,
  toastCapture,
} = require("../lib/routeTestApi");

test("change-driving: staged panel markup", async (t) => {
  installBrowserGlobals(t);
  const vite = await rendererServer(t, "loqui-staged-panel-view-");
  const { StagedRoutePanelView } = await vite.ssrLoadModule(
    "/components/settings/routing/StagedRoutePanel.tsx"
  );
  const base = {
    routeId: "dictationStt",
    providers: [
      { id: "openai", name: "OpenAI", key: "saved" },
      { id: "corti", name: "Corti", key: "missing" },
      { id: "custom", name: "locality.customEndpoint", key: "none" },
    ],
    credential: null,
    models: [],
    sharedServerUrl: null,
    onTarget() {},
  };
  const render = (props) =>
    renderToStaticMarkup(React.createElement(StagedRoutePanelView, { ...base, ...props }));

  // Change-driving (SET-13): no provider is chosen for the user.
  await t.test("change-driving: Cloud opens with no provider armed", () => {
    const html = render({ target: { mode: "providers", provider: "" } });
    assert.match(html, /role="group"[^>]*aria-label="staging\.provider"/);
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 0);
    assert.match(html, /staging\.keySaved/);
    assert.match(html, /staging\.noKey/);
  });

  // Change-driving (I10): v1 showed the text API key for Corti speech.
  await t.test(
    "change-driving: Corti speech shows the client id and secret, never the API key",
    () => {
      const html = render({
        target: { mode: "providers", provider: "corti" },
        credential: {
          credentialId: "corti:speech",
          inputs: [
            {
              storeKey: "cortiClientId",
              label: "transcription.corti.clientId",
              value: "",
              save: async () => ({ ok: true }),
            },
            {
              storeKey: "cortiClientSecret",
              label: "transcription.corti.clientSecret",
              value: "",
              save: async () => ({ ok: true }),
            },
          ],
        },
      });
      assert.match(html, /transcription\.corti\.clientId/);
      assert.match(html, /transcription\.corti\.clientSecret/);
      assert.doesNotMatch(html, /common\.apiKey/);
    }
  );

  // Change-driving (R2-9): no model choice existed in the staged panel.
  await t.test(
    "change-driving: a chosen provider lists its models as a labelled single choice",
    () => {
      const html = render({
        routeId: "chat",
        target: { mode: "providers", provider: "openai", model: "gpt-5.6-luna" },
        models: [
          { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
          { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
        ],
      });
      assert.match(html, /role="radiogroup"[^>]*aria-label="staging\.model"/);
      assert.equal((html.match(/role="radio"/g) ?? []).length, 2);
      assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 1);
    }
  );

  await t.test("change-driving: a provider without a model list takes a labelled model id", () => {
    const html = render({ routeId: "chat", target: { mode: "providers", provider: "openrouter" } });
    const id = html.match(/<label[^>]*for="([^"]+)"[^>]*>staging\.modelId</)?.[1];
    assert.ok(id && html.includes(`id="${id}"`));
    assert.match(html, /staging\.useModel/);
  });

  // Change-driving (I5): v1 let upload edit the shared dictation URL.
  await t.test("change-driving: upload shows dictation's server read-only", () => {
    const html = render({
      routeId: "uploadStt",
      target: { mode: "self-hosted", remoteUrl: "http://192.168.1.5:8178" },
      sharedServerUrl: "http://192.168.1.5:8178",
    });
    assert.match(html, /staging\.sharedWithDictation/);
    assert.doesNotMatch(html, /<input/);
  });

  // Change-driving (SET-Q19): the panel does not exist; the label/htmlFor pair is new.
  await t.test("change-driving: a server address field is labelled and explains plain http", () => {
    const html = render({
      routeId: "translation",
      target: { mode: "self-hosted", remoteUrl: "http://192.168.1.20:11434/v1" },
    });
    const id = html.match(/<label[^>]*for="([^"]+)"[^>]*>staging\.serverUrl</)?.[1];
    assert.ok(id, "the label points at the input");
    assert.ok(html.includes(`id="${id}"`), "the input carries the label's id");
    assert.match(html, /staging\.url\.http/);
    assert.match(html, /staging\.useServer/);
  });
});

test("change-driving: staged panel behaviour", async (t) => {
  const saves = [];
  installBrowserGlobals(t, {
    window: {
      dispatchEvent: () => true,
      electronAPI: routeTestApi({ present: ["openai"], saves }),
    },
  });
  const vite = await rendererServer(t, "loqui-staged-panel-mounted-");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useRouteDraftStore } = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const { StagedRoutePanel } = await vite.ssrLoadModule(
    "/components/settings/routing/StagedRoutePanel.tsx"
  );
  await primeRouteFacts(vite);
  const { wrap } = await toastCapture(vite);
  const probes = createProbeRoot(t, { wrap });
  const viewOf = (tree) => findElement(tree, (node) => typeof node.props?.onTarget === "function");

  // Change-driving (I3, I10): keys go through Task 2's acknowledged saveSecret, to the route's own slot.
  await t.test(
    "change-driving: key fields save through the acknowledged path with the route's credential identity",
    async () => {
      await probes.act(() =>
        useSettingsStore.setState({ cortiClientId: "", cortiClientSecret: "", cortiApiKey: "" })
      );
      await probes.act(() =>
        useRouteDraftStore.getState().stage({
          routeId: "dictationStt",
          kind: "target",
          target: { mode: "providers", provider: "corti" },
        })
      );
      const speech = await probes.mount("speech", () =>
        StagedRoutePanel({ routeId: "dictationStt" })
      );
      const credential = viewOf(speech()).props.credential;
      assert.equal(credential.credentialId, "corti:speech");
      assert.deepEqual(
        credential.inputs.map((input) => input.storeKey),
        ["cortiClientId", "cortiClientSecret"]
      );
      await probes.act(() => credential.inputs[0].save("client-123"));
      assert.deepEqual(
        saves,
        [["corti:speech", "clientId"]],
        "main received the speech slot, not the text key"
      );
      assert.equal(
        useSettingsStore.getState().cortiClientId,
        "__stored__",
        "only the acknowledged sentinel is stored"
      );

      await probes.act(() =>
        useRouteDraftStore.getState().stage({
          routeId: "chat",
          kind: "target",
          target: { mode: "providers", provider: "corti" },
        })
      );
      const text = await probes.mount("text", () => StagedRoutePanel({ routeId: "chat" }));
      assert.equal(viewOf(text()).props.credential.credentialId, "corti:text");
      assert.deepEqual(
        viewOf(text()).props.credential.inputs.map((input) => input.storeKey),
        ["cortiApiKey"]
      );
    }
  );

  // Change-driving (I1): an endpoint the planner resolves to this device applies at once.
  await t.test(
    "change-driving: Use this server on loopback applies instantly; a remote server is staged",
    async () => {
      const useServer = async (url) => {
        await probes.act(() =>
          useSettingsStore.setState({
            chatAgentMode: "local",
            chatAgentProvider: "qwen",
            chatAgentModel: "qwen3-4b",
            chatAgentRemoteUrl: "",
          })
        );
        await probes.act(() =>
          useRouteDraftStore.getState().stage({
            routeId: "chat",
            kind: "target",
            target: { mode: "self-hosted", remoteUrl: "" },
          })
        );
        const panel = await probes.mount("server-panel", () =>
          StagedRoutePanel({ routeId: "chat" })
        );
        const view = await probes.mount("server-view", () => {
          const element = viewOf(panel());
          return element.type(element.props);
        });
        const field = findElement(view(), (node) => typeof node.props?.onUse === "function");
        await probes.act(() => field.props.onUse({ url, model: "" }));
        await probes.settle();
      };

      await useServer("http://localhost:11434/v1");
      assert.equal(useSettingsStore.getState().chatAgentMode, "self-hosted");
      assert.equal(useSettingsStore.getState().chatAgentRemoteUrl, "http://localhost:11434/v1");
      assert.equal(useRouteDraftStore.getState().draft, null);

      await useServer("https://llm.example.test/v1");
      assert.equal(
        useSettingsStore.getState().chatAgentMode,
        "local",
        "nothing is applied before review"
      );
      assert.deepEqual(useRouteDraftStore.getState().draft, {
        routeId: "chat",
        kind: "target",
        target: { mode: "self-hosted", remoteUrl: "https://llm.example.test/v1" },
      });
    }
  );

  // Change-driving (R2-9): v2 applied a remote text route with no model and left the choice for
  // after Apply. The model is now chosen inside the staged panel and nothing is committed.
  await t.test(
    "change-driving: Apply stays blocked until a model is chosen in the panel; choosing one commits nothing",
    async () => {
      const { planDraft } = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
      const { TEST_COPY } = require("../lib/routeStateFixture");
      await probes.act(() =>
        useSettingsStore.setState({
          chatAgentMode: "local",
          chatAgentProvider: "qwen",
          chatAgentModel: "qwen3-4b",
        })
      );
      await probes.act(() =>
        useRouteDraftStore.getState().stage({
          routeId: "chat",
          kind: "target",
          target: { mode: "providers", provider: "openai", model: "" },
        })
      );
      assert.equal(planDraft(useRouteDraftStore.getState().draft, TEST_COPY).blocker, "needsModel");
      const panel = await probes.mount("model-panel", () => StagedRoutePanel({ routeId: "chat" }));
      const view = viewOf(panel());
      assert.ok(view.props.models.length > 0, "the registry's OpenAI models are offered");
      const pick = view.props.models[0].id;
      await probes.act(() =>
        view.props.onTarget({ mode: "providers", provider: "openai", model: pick })
      );
      await probes.settle();
      assert.deepEqual(useRouteDraftStore.getState().draft.target, {
        mode: "providers",
        provider: "openai",
        model: pick,
      });
      assert.equal(
        planDraft(useRouteDraftStore.getState().draft, TEST_COPY).blocker,
        null,
        "ready: Apply is enabled"
      );
      assert.equal(useSettingsStore.getState().chatAgentMode, "local", "nothing was committed");
    }
  );

  // Change-driving (R2-9): Codex used to be applied before any sign-in.
  await t.test("baseline guard: Codex without a stored sign-in stays blocked", async () => {
    const { planDraft } = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
    const { TEST_COPY } = require("../lib/routeStateFixture");
    await probes.act(() =>
      useSettingsStore.setState({
        chatAgentMode: "local",
        chatAgentProvider: "qwen",
        chatAgentModel: "qwen3-4b",
      })
    );
    await probes.act(() =>
      useRouteDraftStore.getState().stage({
        routeId: "chat",
        kind: "target",
        target: { mode: "providers", provider: "codex", model: "gpt-5.6-codex" },
      })
    );
    assert.equal(planDraft(useRouteDraftStore.getState().draft, TEST_COPY).blocker, "needsKey");
  });
});

// Change-driving: the new model radios must support keyboard navigation in RTL
// and expose a readable control outline on their actual rendered surface.
test("change-driving: staged model choices rove in RTL without changing the draft", async (t) => {
  installBrowserGlobals(t);
  const vite = await rendererServer(t, "loqui-staged-panel-keys-");
  const { StagedRoutePanelView } = await vite.ssrLoadModule(
    "/components/settings/routing/StagedRoutePanel.tsx"
  );
  const { findAll } = require("../lib/probeRoot");
  const probes = createProbeRoot(t);
  const targets = [];
  const tree = await probes.mount("choices", () =>
    StagedRoutePanelView({
      routeId: "chat",
      target: { mode: "providers", provider: "openai", model: "a" },
      providers: [
        { id: "openai", name: "OpenAI", key: "saved" },
        { id: "groq", name: "Groq", key: "missing" },
      ],
      credential: null,
      models: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
      ],
      sharedServerUrl: null,
      onTarget: (target) => targets.push(target),
    })
  );
  const radios = () => findAll(tree(), (node) => node.props?.role === "radio");
  assert.equal(radios().filter((node) => node.props.tabIndex === 0).length, 1);
  const focused = [];
  for (const [i, radio] of radios().entries()) radio.props.ref({ focus: () => focused.push(i) });
  await probes.act(() =>
    radios()[0].props.onKeyDown({
      key: "ArrowLeft",
      preventDefault() {},
      currentTarget: { closest: () => ({ getAttribute: () => "rtl" }) },
    })
  );
  assert.deepEqual(focused, [1], "Left moves forward in RTL");
  assert.equal(radios()[1].props.tabIndex, 0);
  assert.deepEqual(targets, [], "arrows move focus; activation is explicit");
  await probes.act(() => radios()[1].props.onClick());
  assert.deepEqual(targets, [{ mode: "providers", provider: "openai", model: "b" }]);
  const controls = findAll(tree(), (node) => node.type === "button");
  for (const control of controls) {
    assert.match(control.props.className, /(?:border-muted-foreground|border-ring)/);
    assert.match(control.props.className, /bg-background/);
  }
  const fs = require("node:fs");
  const path = require("node:path");
  const { resolveTokens } = require("../helpers/harness/cssTokens");
  const { contrastRatio, parseHexColor } = await import("../../src/utils/contrast.ts");
  const themes = resolveTokens(
    fs.readFileSync(path.resolve(__dirname, "../../src/index.css"), "utf8")
  );
  const composite = (foreground, alpha, background) => {
    const f = parseHexColor(foreground);
    const b = parseHexColor(background);
    return (
      "#" +
      ["r", "g", "b"]
        .map((key) =>
          Math.round(f[key] * alpha + b[key] * (1 - alpha))
            .toString(16)
            .padStart(2, "0")
        )
        .join("")
    );
  };
  assert.match(tree().props.className, /bg-locality-remote\/5/);
  for (const tokens of [themes.light, themes.dark]) {
    for (const role of ["--color-muted-foreground", "--color-ring"]) {
      assert.ok(contrastRatio(tokens[role], tokens["--color-background"]) >= 3);
    }
    assert.ok(
      contrastRatio(tokens["--color-muted-foreground"], tokens["--color-background"]) >= 4.5
    );
    // Panel prose and endpoint validation sit on the real translucent fill.
    const pane =
      tokens === themes.dark ? tokens["--color-surface-1"] : tokens["--color-background"];
    const panel = composite(tokens["--color-locality-remote"], 0.05, pane);
    for (const role of ["--color-foreground", "--color-muted-foreground", "--color-destructive"])
      assert.ok(contrastRatio(tokens[role], panel) >= 4.5, `${role} on staged panel ${panel}`);
  }
});

// Baseline guard: dirty URL/model input is a local draft, and an invalid URL
// cannot be handed to the route planner.
test("baseline guard: endpoint typing and blur make no calls; Use submits the trimmed pair", async (t) => {
  installBrowserGlobals(t);
  const vite = await rendererServer(t, "loqui-endpoint-draft-");
  const { EndpointDraft, endpointHint } = await vite.ssrLoadModule(
    "/components/settings/routing/EndpointDraft.tsx"
  );
  const { findAll } = require("../lib/probeRoot");
  const probes = createProbeRoot(t);
  const used = [];
  const tree = await probes.mount("endpoint", () =>
    EndpointDraft({
      label: "URL",
      url: "",
      urlPlaceholder: "https://example.test",
      model: "",
      modelLabel: "Model",
      useLabel: "Use",
      onUse: (value) => used.push(value),
    })
  );
  const fields = () => findAll(tree(), (node) => typeof node.props?.onChange === "function");
  const use = () => findElement(tree(), (node) => node.props?.["data-action"] === "use-endpoint");
  await probes.act(() =>
    fields()[0].props.onChange({ target: { value: " https://example.test/v1 " } })
  );
  await probes.act(() => fields()[1].props.onChange({ target: { value: " model-id " } }));
  assert.deepEqual(used, []);
  assert.equal(fields()[0].props.onBlur, undefined);
  assert.equal(use().props.disabled, false);
  await probes.act(() => use().props.onClick());
  assert.deepEqual(used, [{ url: "https://example.test/v1", model: "model-id" }]);
  for (const [url, hint] of [
    ["", "empty"],
    ["wrong", "invalid"],
    ["ftp://example.test", "invalid"],
    ["http://example.test", "insecure"],
    ["http://localhost:8178", "http"],
    ["https://example.test", "ok"],
  ])
    assert.equal(endpointHint(url), hint);
});

// Change-driving I1: model/provider/endpoint edits augment a pending enable,
// rather than replacing it with a target-only draft or committing an off route.
test("change-driving FIX1: provider and endpoint edits preserve a pending enable and exact Undo", async (t) => {
  installBrowserGlobals(t, {
    window: { dispatchEvent: () => true, electronAPI: routeTestApi({ present: ["openai"] }) },
  });
  const vite = await rendererServer(t, "loqui-fix1-provider-endpoint-");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const { StagedRoutePanel } = await vite.ssrLoadModule(
    "/components/settings/routing/StagedRoutePanel.tsx"
  );
  const { TEST_COPY } = require("../lib/routeStateFixture");
  await primeRouteFacts(vite);
  const { wrap } = await toastCapture(vite);
  const probes = createProbeRoot(t, { wrap });
  useSettingsStore.setState({
    useDictationTranslation: false,
    translationMode: "providers",
    translationProvider: "custom",
    translationModel: "",
    translationCloudBaseUrl: "https://old.example.test/v1",
  });
  const before = { ...useSettingsStore.getState() };
  assert.equal(
    await drafts.requestRoutePatch("translation", { useDictationTranslation: true }, TEST_COPY),
    "staged"
  );
  const panel = await probes.mount("panel", () => StagedRoutePanel({ routeId: "translation" }));
  const view = () => findElement(panel(), (node) => typeof node.props?.onTarget === "function");
  assert.ok(view());
  assert.deepEqual(view().props.target, {
    mode: "providers",
    provider: "custom",
    model: "",
    baseUrl: "https://old.example.test/v1",
  });
  for (const target of [
    { mode: "providers", provider: "openai", model: "gpt-6-astra" },
    {
      mode: "providers",
      provider: "custom",
      baseUrl: "https://new.example.test/v1",
      model: "my-model",
    },
  ]) {
    await probes.act(() => view().props.onTarget(target));
    await probes.settle();
    const plan = drafts.planDraft(drafts.useRouteDraftStore.getState().draft, TEST_COPY);
    assert.equal(plan.patch.useDictationTranslation, true);
    assert.equal(useSettingsStore.getState().useDictationTranslation, false);
    assert.equal(useSettingsStore.getState().translationProvider, "custom");
    assert.equal(
      useSettingsStore.getState().translationCloudBaseUrl,
      before.translationCloudBaseUrl
    );
  }
  let applied;
  await probes.act(async () => {
    applied = await drafts.applyDraft(TEST_COPY);
  });
  assert.equal(applied.applied, true);
  assert.equal(useSettingsStore.getState().useDictationTranslation, true);
  assert.equal(useSettingsStore.getState().translationCloudBaseUrl, "https://new.example.test/v1");
  await probes.act(async () => {
    const undo = await applied.undo();
    if (undo === "staged") await drafts.applyDraft(TEST_COPY);
  });
  for (const key of Object.keys(applied.plan.undoPatch))
    assert.deepEqual(useSettingsStore.getState()[key], before[key], `Undo restores ${key}`);
});

// Change-driving I1: a screen-context enable inherits the assistant recipient;
// editing setup must not silently create a vision override.
test("change-driving FIX1: inherited vision setup edits the actual assistant with coupled review", async (t) => {
  installBrowserGlobals(t, {
    window: { dispatchEvent: () => true, electronAPI: routeTestApi({ present: ["openai"] }) },
  });
  const vite = await rendererServer(t, "loqui-fix1-inherited-vision-");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const { StagedRoutePanel } = await vite.ssrLoadModule(
    "/components/settings/routing/StagedRoutePanel.tsx"
  );
  const { TEST_COPY } = require("../lib/routeStateFixture");
  await primeRouteFacts(vite);
  const { wrap } = await toastCapture(vite);
  const probes = createProbeRoot(t, { wrap });
  useSettingsStore.setState({
    useDictationAgent: true,
    voiceAgentScreenContext: false,
    useDictationAgentVisionModel: false,
    dictationAgentMode: "providers",
    dictationAgentProvider: "openai",
    dictationAgentModel: "",
    dictationAgentVisionProvider: "anthropic",
    dictationAgentVisionModel: "old-override",
  });
  assert.equal(
    await drafts.requestRoutePatch("assistantVision", { voiceAgentScreenContext: true }, TEST_COPY),
    "staged"
  );
  const panel = await probes.mount("panel", () => StagedRoutePanel({ routeId: "assistantVision" }));
  const view = () => findElement(panel(), (node) => typeof node.props?.onTarget === "function");
  assert.ok(view());
  assert.equal(view().props.target.provider, "openai");
  await probes.act(() =>
    view().props.onTarget({ mode: "providers", provider: "openai", model: "gpt-6-astra" })
  );
  await probes.settle();
  const plan = drafts.planDraft(drafts.useRouteDraftStore.getState().draft, TEST_COPY);
  assert.equal(plan.patch.voiceAgentScreenContext, true);
  assert.equal(plan.patch.dictationAgentModel, "gpt-6-astra");
  assert.equal(plan.patch.useDictationAgentVisionModel, undefined);
  assert.ok(plan.changes.some((change) => change.id === "voiceAssistant" && change.coupled));
  assert.equal(useSettingsStore.getState().voiceAgentScreenContext, false);
  let applied;
  await probes.act(async () => {
    applied = await drafts.applyDraft(TEST_COPY);
  });
  assert.equal(applied.applied, true);
  assert.equal(useSettingsStore.getState().useDictationAgentVisionModel, false);
  assert.equal(useSettingsStore.getState().dictationAgentVisionModel, "old-override");
  await probes.act(() => applied.undo());
  assert.equal(useSettingsStore.getState().voiceAgentScreenContext, false);
  assert.equal(useSettingsStore.getState().dictationAgentModel, "");
});

// Baseline guard FIX1: the additive draft-target entry point reuses the
// reviewed route/session guards and keeps newer draft ownership across waits.
test("baseline guard FIX1: pending setup cannot overwrite a newer draft or recreate after close", async (t) => {
  for (const action of ["replace", "replace-same", "close", "setup"])
    await t.test(`baseline guard FIX1: ${action}`, async (t) => {
      const api = routeTestApi({ present: ["openai"] });
      installBrowserGlobals(t, { window: { dispatchEvent: () => true, electronAPI: api } });
      const vite = await rendererServer(t, `loqui-fix1-ownership-${action}-`);
      const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
      const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
      const { TEST_COPY } = require("../lib/routeStateFixture");
      await primeRouteFacts(vite);
      useSettingsStore.setState({
        useDictationTranslation: false,
        translationMode: "providers",
        translationProvider: "openai",
        translationModel: "",
      });
      drafts.useRouteDraftStore
        .getState()
        .stage({ routeId: "translation", kind: "patch", patch: { useDictationTranslation: true } });
      const rows = await api.credentials.list();
      const held = [];
      api.credentials.list = () => new Promise((resolve) => held.push(() => resolve(rows)));
      const pending = drafts.requestDraftTarget(
        "translation",
        { mode: "providers", provider: "openai", model: "gpt-6-astra" },
        TEST_COPY
      );
      await new Promise((resolve) => setImmediate(resolve));
      assert.ok(held.length > 0);
      const replacement = {
        routeId: action === "replace-same" ? "translation" : "chat",
        kind: "target",
        target: { mode: "providers", provider: "groq", model: "gpt-oss-120b" },
      };
      if (action === "close") drafts.endSettingsSession();
      else if (action === "setup")
        drafts.stageDraftSetup("translation", {
          azureEndpoint: "https://fixture.openai.azure.com",
        });
      else drafts.useRouteDraftStore.getState().stage(replacement);
      const expected = drafts.useRouteDraftStore.getState().draft;
      for (const release of held.splice(0)) release();
      assert.equal(await pending, "superseded");
      assert.equal(drafts.useRouteDraftStore.getState().draft, expected);
      assert.equal(useSettingsStore.getState().useDictationTranslation, false);
      assert.equal(useSettingsStore.getState().translationModel, "");
      if (action === "setup")
        assert.deepEqual(expected.patch, {
          useDictationTranslation: true,
          azureEndpoint: "https://fixture.openai.azure.com",
        });
    });
});

// Baseline guard FIX1: target setup re-plans with newly acknowledged facts;
// a credential removed while the local read waits cannot unblock Apply.
test("baseline guard FIX1: setup retains the enable intent when live credential facts block Apply", async (t) => {
  const api = routeTestApi({ present: ["openai"] });
  installBrowserGlobals(t, { window: { dispatchEvent: () => true, electronAPI: api } });
  const vite = await rendererServer(t, "loqui-fix1-live-setup-facts-");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const { TEST_COPY } = require("../lib/routeStateFixture");
  await primeRouteFacts(vite);
  useSettingsStore.setState({
    useDictationTranslation: false,
    translationMode: "providers",
    translationProvider: "openai",
    translationModel: "",
  });
  drafts.useRouteDraftStore
    .getState()
    .stage({ routeId: "translation", kind: "patch", patch: { useDictationTranslation: true } });
  const rows = await api.credentials.list();
  let release;
  api.credentials.list = () =>
    new Promise((resolve) => {
      release = () =>
        resolve(
          rows.map((row) =>
            row.id === "openai"
              ? { ...row, present: false, fields: { key: false }, generation: 3 }
              : row
          )
        );
    });
  const pending = drafts.requestDraftTarget(
    "translation",
    { mode: "providers", provider: "openai", model: "gpt-6-astra" },
    TEST_COPY
  );
  await new Promise((resolve) => setImmediate(resolve));
  release();
  assert.equal(await pending, "staged");
  const plan = drafts.planDraft(drafts.useRouteDraftStore.getState().draft, TEST_COPY);
  assert.equal(plan.patch.useDictationTranslation, true);
  assert.equal(plan.blocker, "needsKey");
  assert.equal(useSettingsStore.getState().translationModel, "");
  assert.equal(useSettingsStore.getState().useDictationTranslation, false);
});

// Baseline guard Task9/M2: the coupled upload description uses the same
// prospective shared URL as its actual target and planner review.
test("baseline guard Task9: coupled Upload displays the prospective dictation server", async (t) => {
  installBrowserGlobals(t, { window: { electronAPI: routeTestApi() } });
  const vite = await rendererServer(t, "loqui-task9-coupled-server-");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const { StagedRoutePanel, StagedRoutePanelView } = await vite.ssrLoadModule(
    "/components/settings/routing/StagedRoutePanel.tsx"
  );
  const { TEST_COPY } = require("../lib/routeStateFixture");
  await primeRouteFacts(vite);
  useSettingsStore.setState({
    transcriptionMode: "self-hosted",
    useLocalWhisper: false,
    remoteTranscriptionUrl: "https://old.fixture.test/v1",
    remoteTranscriptionModel: "whisper-1",
    uploadTranscriptionMode: "self-hosted",
  });
  await drafts.requestRouteChange(
    "dictationStt",
    { mode: "self-hosted", remoteUrl: "https://new.fixture.test/v1", model: "whisper-1" },
    TEST_COPY
  );
  const { wrap } = await toastCapture(vite);
  const probes = createProbeRoot(t, { wrap });
  const tree = await probes.mount("upload", () => StagedRoutePanel({ routeId: "uploadStt" }));
  const view = findElement(tree(), (node) => node.type === StagedRoutePanelView);
  assert.equal(view.props.sharedServerUrl, "https://new.fixture.test/v1");
  assert.equal(view.props.target.remoteUrl, view.props.sharedServerUrl);
  const display = await probes.mount("view", () => StagedRoutePanelView(view.props));
  const text = findElement(
    display(),
    (node) =>
      typeof node.props?.children === "string" &&
      node.props.children.includes("sharedWithDictation")
  );
  assert.match(text.props.children, /new\.fixture\.test/);
  assert.equal(useSettingsStore.getState().remoteTranscriptionUrl, "https://old.fixture.test/v1");
});
