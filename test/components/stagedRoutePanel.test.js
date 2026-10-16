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
