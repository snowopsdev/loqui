const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals } = require("../lib/rendererTestHarness");
const { createProbeRoot, findElement } = require("../lib/probeRoot");
const {
  SRC,
  primeRouteFacts,
  rendererServer,
  routeTestApi,
  toastCapture,
} = require("../lib/routeTestApi");
const { TEST_COPY } = require("../lib/routeStateFixture");

const EAST = "https://east.openai.azure.com/openai";
const WEST = "https://west.openai.azure.com/openai";

test("change-driving: enterprise recipients go through the planner (R2-1, R2-6, R2-9)", async (t) => {
  // Main's committed enterprise configuration (main.js:447-457). Only the
  // expected-tuple transaction changes it; no individual saver is exposed.
  const main = {
    azureEndpoint: EAST,
    bedrockRegion: "us-east-1",
    vertexProject: "acme-prod",
    vertexLocation: "europe-west4",
    vertexAuthSource: "adc",
  };
  const writes = [];
  let mainVersion = 1;
  const enterpriseListeners = new Set();
  const atomic = () => ({
    current: { ...main },
    version: mainVersion,
    facts: {
      bedrockEndpoint: { set: false, host: null },
      bedrockProfile: false,
      vertexApiKeyEnv: false,
      vertexProjectEnv: false,
    },
  });
  const saveEnterpriseRoutePatch = async ({ patch, expected }) => {
    writes.push({ patch: { ...patch }, expected: { ...expected } });
    if (Object.keys(main).some((key) => expected[key] !== main[key])) {
      return { success: false, conflict: true, current: { ...main }, version: mainVersion };
    }
    Object.assign(main, patch);
    ++mainVersion;
    enterpriseListeners.forEach((fn) => fn(atomic()));
    return { success: true, current: { ...main }, version: mainVersion };
  };
  // One host rule for both the disclosure and the request, as main uses one configuration for both.
  let vertexKeyPresent = false;
  const hostsFor = (provider) => {
    if (provider === "bedrock")
      return [`bedrock-runtime.${main.bedrockRegion || "us-east-1"}.amazonaws.com`];
    if (provider === "vertex") {
      if (main.vertexAuthSource === "apiKey") return ["aiplatform.googleapis.com"];
      const location = main.vertexLocation || "us-central1";
      return [
        location === "global"
          ? "aiplatform.googleapis.com"
          : `${location}-aiplatform.googleapis.com`,
      ];
    }
    if (provider !== "azure") return [];
    try {
      const url = new URL(main.azureEndpoint);
      return url.protocol === "https:" && !url.username && !url.password ? [url.host] : [];
    } catch {
      return [];
    }
  };
  const describeCalls = [];
  const captured = [];
  const codexCalls = [];
  const credentialListeners = new Set();
  let credentialGeneration = 1;
  const CREDENTIAL_IDS = [
    "custom:transcription",
    "custom:dictationCleanup",
    "custom:noteFormatting",
    "custom:dictationAgent",
    "custom:dictationAgentVision",
    "custom:chatIntelligence",
    "custom:dictationTranslation",
    "openai",
    "anthropic",
    "gemini",
    "groq",
    "xai",
    "mistral",
    "openrouter",
    "tinfoil",
    "deepgram",
    "assemblyai",
    "corti:text",
    "corti:speech",
    "codex",
    "bedrock",
    "azure",
    "vertex",
  ];
  const emitVertexPresence = () => {
    const change = {
      id: "vertex",
      present: vertexKeyPresent,
      generation: ++credentialGeneration,
      fields: { key: vertexKeyPresent },
    };
    credentialListeners.forEach((listener) => listener(change));
    globalThis.window.dispatchEvent(new CustomEvent("credentials-changed", { detail: change }));
  };
  const codex = (name, value) => async () => {
    codexCalls.push(name);
    return value;
  };
  const api = routeTestApi({
    present: ["openai", "azure", "bedrock"],
    extra: {
      saveEnterpriseRoutePatch,
      getEnterpriseRouteState: async () => atomic(),
      onEnterpriseRouteChanged: (fn) => {
        enterpriseListeners.add(fn);
        return () => enterpriseListeners.delete(fn);
      },
      getBedrockRegion: async () => main.bedrockRegion,
      getAzureEndpoint: async () => main.azureEndpoint,
      getVertexProject: async () => main.vertexProject,
      getVertexLocation: async () => main.vertexLocation,
      getVertexAuthSource: async () => main.vertexAuthSource,
      enterpriseRouteFacts: async () => ({
        bedrockEndpoint: { set: false, host: null },
        bedrockProfile: false,
        vertexApiKeyEnv: false,
        vertexProjectEnv: false,
      }),
      credentials: {
        list: async () =>
          CREDENTIAL_IDS.map((id) => ({
            id,
            present:
              id === "vertex" ? vertexKeyPresent : ["openai", "azure", "bedrock"].includes(id),
            generation: credentialGeneration,
            unknown: false,
            fields:
              id === "vertex"
                ? { key: vertexKeyPresent }
                : id === "bedrock"
                  ? { accessKeyId: true, secretAccessKey: true, sessionToken: false }
                  : { key: ["openai", "azure"].includes(id) },
          })),
        save: async (id, field) => {
          if (id === "vertex" && field === "key") vertexKeyPresent = true;
          emitVertexPresence();
          return { ok: true, generation: credentialGeneration };
        },
        remove: async (id) => {
          if (id !== "vertex") return { ok: false, error: "unused" };
          vertexKeyPresent = false;
          emitVertexPresence();
          return {
            ok: true,
            undoToken: "vertex-undo-token",
            expiresAt: Date.now() + 8000,
            generation: credentialGeneration,
          };
        },
        undoRemove: async (token) => {
          if (token !== "vertex-undo-token") return { ok: false, reason: "unknown" };
          vertexKeyPresent = true;
          emitVertexPresence();
          return { ok: true, generation: credentialGeneration };
        },
        onChanged: (listener) => {
          credentialListeners.add(listener);
          return () => credentialListeners.delete(listener);
        },
      },
      keyring: {
        verifyConnection: async (request) => {
          assert.equal(request.recipientToken, `fixture-${mainVersion}-${credentialGeneration}`);
          captured.push(hostsFor(request.provider)[0] ?? null);
          return { text: "hello" };
        },
        describeVerify: async (identity) => {
          describeCalls.push(identity);
          return {
            recipientToken: `fixture-${mainVersion}-${credentialGeneration}`,
            hosts: hostsFor(identity),
            fields:
              identity === "vertex"
                ? main.vertexAuthSource === "adc"
                  ? []
                  : vertexKeyPresent
                    ? ["key"]
                    : ["key"]
                : identity === "azure"
                  ? ["key"]
                  : ["accessKeyId", "secretAccessKey"],
          };
        },
      },
      personalInference: {
        // The fake transport: the host this request would reach, from main's committed config.
        textGenerate: async (request) => {
          captured.push(hostsFor(request.provider)[0] ?? null);
          return { text: "hello" };
        },
        codexStatus: codex("codexStatus", { available: true, account: null }),
        codexRateLimits: codex("codexRateLimits", {}),
        codexModels: codex("codexModels", { data: [], nextCursor: null }),
        codexLogin: codex("codexLogin", { loginId: "fixture" }),
        onTextEvent: () => () => {},
      },
    },
  });
  installBrowserGlobals(t, {
    window: {
      location: { search: "" },
      dispatchEvent() {},
      electronAPI: api,
    },
  });
  const vite = await rendererServer(t, "loqui-enterprise-routes-");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const { useRouteChange, useRouteCommit } = await vite.ssrLoadModule(
    "/components/settings/routing/useRouteChange.ts"
  );
  const { StagedRouteBarView } = await vite.ssrLoadModule(
    "/components/settings/routing/StagedRouteBar.tsx"
  );
  const { StagedRoutePanel } = await vite.ssrLoadModule(
    "/components/settings/routing/StagedRoutePanel.tsx"
  );
  const routes = await vite.ssrLoadModule("/lib/routes.ts");
  const Selector = (await vite.ssrLoadModule("/components/ReasoningModelSelector.tsx")).default;
  await primeRouteFacts(vite);
  const { wrap } = await toastCapture(vite);
  const probes = createProbeRoot(t, { wrap });

  const act = async (fn) => {
    let result;
    await probes.act(async () => {
      result = await fn();
    });
    return result;
  };
  const live = () => useSettingsStore.getState();
  const draft = () => drafts.useRouteDraftStore.getState().draft;
  const reset = async (state) => {
    await probes.mount("panel-setup", () => null);
    await probes.mount("codex-setup", () => null);
    await probes.mount("vertex-api-key", () => null);
    return probes.act(() => {
      drafts.useRouteDraftStore.getState().discard();
      Object.assign(main, {
        azureEndpoint: state.azureEndpoint ?? "",
        bedrockRegion: state.bedrockRegion ?? "us-east-1",
        vertexProject: state.vertexProject ?? "acme-prod",
        vertexLocation: state.vertexLocation ?? "europe-west4",
        vertexAuthSource: state.vertexAuthSource ?? "adc",
      });
      vertexKeyPresent = Boolean(state.vertexApiKey);
      useSettingsStore.setState({
        azureEndpoint: "",
        bedrockRegion: "us-east-1",
        vertexApiKey: vertexKeyPresent ? "__stored__" : "",
        useCleanupModel: false,
        ...state,
      });
      ++mainVersion;
      enterpriseListeners.forEach((fn) => fn(atomic()));
      writes.length = 0;
      captured.length = 0;
      describeCalls.length = 0;
      codexCalls.length = 0;
    });
  };
  let mounts = 0;
  // The editor exactly as InferenceConfigEditor wires it.
  const mountEnterprise = async (routeId, provider, model) => {
    const selector = await probes.mount("selector", () => {
      const { requestPatch } = useRouteChange();
      const commit = useRouteCommit(routeId);
      return Selector({
        mode: "cloud",
        reasoningModel: model,
        localReasoningProvider: provider,
        cloudReasoningBaseUrl: "",
        onCommit: commit,
        onRoutePatch: (patch) => void requestPatch(routeId, patch),
      });
    });
    return probes.mount("enterprise", () => {
      const element = findElement(
        selector(),
        (node) => node.type?.name === "EnterpriseProviderConfig"
      );
      return element ? element.type(element.props) : null;
    });
  };
  const field = (tree, label) =>
    findElement(tree, (node) => node.type?.name === "DraftField" && node.props.label === label);
  // Types into a DraftField, checks nothing was written per keystroke, then leaves the field.
  const typeAndLeave = async (element, text) => {
    const view = await probes.mount(`field-${++mounts}`, () => element.type(element.props));
    const input = () => findElement(view(), (node) => typeof node.props?.onBlur === "function");
    await probes.act(() => input().props.onChange({ target: { value: text } }));
    assert.deepEqual(writes, [], "typing writes nothing and tells main nothing");
    await probes.act(() => input().props.onBlur());
    await probes.settle();
  };
  const reviewHtml = () =>
    renderToStaticMarkup(
      React.createElement(StagedRouteBarView, {
        plan: drafts.planDraft(draft(), TEST_COPY),
        onApply() {},
        onDiscard() {},
        shortcutHint: null,
      })
    );
  const testButton = (tree) =>
    findElement(tree, (node) => node.props?.["data-action"] === "enterprise-test");

  // Change-driving: the endpoint Field called settings.setAzureEndpoint per keystroke
  // (EnterpriseProviderConfig.tsx:145-148), which persisted to main at once (settingsStore.ts:2060-2063).
  await t.test(
    "an active Azure endpoint edit changes no committed destination before Apply",
    async () => {
      await reset({
        chatAgentMode: "enterprise",
        chatAgentProvider: "azure",
        chatAgentModel: "gpt-4o-deploy",
        cleanupMode: "enterprise",
        cleanupProvider: "azure",
        cleanupModel: "gpt-4o-mini-deploy",
        useCleanupModel: true,
        azureEndpoint: EAST,
      });
      const config = await mountEnterprise("chat", "azure", "gpt-4o-deploy");
      await typeAndLeave(field(config(), "reasoning.enterprise.endpoint"), WEST);
      assert.deepEqual(draft(), { routeId: "chat", kind: "patch", patch: { azureEndpoint: WEST } });
      assert.equal(live().azureEndpoint, EAST, "the store is unchanged");
      assert.deepEqual(writes, [], "main still sends to the old endpoint");
      assert.equal(main.azureEndpoint, EAST);

      // The review is accurate: both routes that share the endpoint, the second marked coupled.
      const plan = drafts.planDraft(draft(), TEST_COPY);
      const byId = Object.fromEntries(plan.changes.map((change) => [change.id, change]));
      assert.equal(byId.chat.coupled, false);
      assert.equal(byId.dictationCleanup.coupled, true);
      for (const change of [byId.chat, byId.dictationCleanup]) {
        assert.equal(change.before.host, "east.openai.azure.com");
        assert.equal(change.after.host, "west.openai.azure.com");
      }
      const html = reviewHtml();
      assert.match(html, /data-route="chat"/);
      assert.match(html, /data-route="dictationCleanup"/);
      assert.equal((html.match(/>west\.openai\.azure\.com</g) ?? []).length, 2);

      // Apply commits through Task 6's applyRoutePatch, which alone tells main.
      const out = await act(() => drafts.applyDraft(TEST_COPY));
      assert.equal(out.applied, true);
      assert.equal(live().azureEndpoint, WEST);
      assert.deepEqual(
        writes.map(({ patch }) => patch),
        [{ azureEndpoint: WEST }]
      );

      // Undo is exact: the old host is a recipient change, so it is reviewed, then restores the old value.
      assert.equal(await act(() => out.undo()), "staged");
      assert.equal(live().azureEndpoint, WEST);
      assert.equal((await act(() => drafts.applyDraft(TEST_COPY))).applied, true);
      assert.equal(live().azureEndpoint, EAST);
      assert.deepEqual(
        writes.map(({ patch }) => patch),
        [{ azureEndpoint: WEST }, { azureEndpoint: EAST }]
      );
    }
  );

  // Change-driving: the region Field called setBedrockRegion and rewrote the model per keystroke
  // (EnterpriseProviderConfig.tsx:114-118), outside review and Undo.
  await t.test(
    "a Bedrock region edit is staged with the model's region prefix, and Undo restores both",
    async () => {
      await reset({
        chatAgentMode: "enterprise",
        chatAgentProvider: "bedrock",
        chatAgentModel: "us.anthropic.claude-sonnet-4-5",
        bedrockRegion: "us-east-1",
      });
      const config = await mountEnterprise("chat", "bedrock", "us.anthropic.claude-sonnet-4-5");
      await typeAndLeave(field(config(), "reasoning.enterprise.region"), "eu-west-1");
      assert.deepEqual(draft(), {
        routeId: "chat",
        kind: "patch",
        patch: { bedrockRegion: "eu-west-1" },
      });
      assert.equal(live().bedrockRegion, "us-east-1");
      assert.equal(
        live().chatAgentModel,
        "us.anthropic.claude-sonnet-4-5",
        "the model is not rewritten before Apply"
      );
      const plan = drafts.planDraft(draft(), TEST_COPY);
      assert.equal(
        plan.patch.chatAgentModel,
        "eu.anthropic.claude-sonnet-4-5",
        "Task 6 couples the model update"
      );
      assert.match(plan.changes.find((change) => change.id === "chat").after.host, /eu-west-1/);

      const out = await act(() => drafts.applyDraft(TEST_COPY));
      assert.equal(out.applied, true);
      assert.equal(live().bedrockRegion, "eu-west-1");
      assert.equal(live().chatAgentModel, "eu.anthropic.claude-sonnet-4-5");
      assert.deepEqual(
        writes.map(({ patch }) => patch),
        [{ bedrockRegion: "eu-west-1" }]
      );
      assert.equal(await act(() => out.undo()), "staged");
      await act(() => drafts.applyDraft(TEST_COPY));
      assert.equal(live().bedrockRegion, "us-east-1");
      assert.equal(live().chatAgentModel, "us.anthropic.claude-sonnet-4-5");
    }
  );

  // Change-driving (R2-6): Test connection sent a credential-bearing request behind a generic label
  // (EnterpriseProviderConfig.tsx:86-100, :195-206).
  await t.test(
    "Test connection names main's host and fields, and the request goes to that host",
    async () => {
      await reset({
        chatAgentMode: "enterprise",
        chatAgentProvider: "azure",
        chatAgentModel: "gpt-4o-deploy",
        azureEndpoint: EAST,
      });
      const config = await mountEnterprise("chat", "azure", "gpt-4o-deploy");
      await probes.settle();
      let button = testButton(config());
      assert.equal(button.props["data-host"], "east.openai.azure.com");
      assert.match(button.props.title, /reasoning\.enterprise\.testSends/);
      assert.match(button.props.title, /east\.openai\.azure\.com/);
      assert.match(button.props.title, /reasoning\.enterprise\.field\.key/);
      await probes.act(() => button.props.onClick());
      await probes.settle();
      assert.deepEqual(captured, [button.props["data-host"]], "displayed host == requested host");

      // A staged endpoint does not move Test: main still sends to the committed one.
      await probes.act(() => field(config(), "reasoning.enterprise.endpoint").props.onCommit(WEST));
      await probes.settle();
      assert.equal(testButton(config()).props["data-host"], "east.openai.azure.com");

      // Applied while mounted: the label re-queries main (never frozen at mount).
      await act(() => drafts.applyDraft(TEST_COPY));
      await probes.settle();
      button = testButton(config());
      assert.equal(button.props["data-host"], "west.openai.azure.com");
      assert.ok(describeCalls.length >= 2, "describeVerify ran again after the committed change");
      await probes.act(() => button.props.onClick());
      await probes.settle();
      assert.deepEqual(captured, ["east.openai.azure.com", "west.openai.azure.com"]);

      // No host, no test: nothing can be sent without a named recipient.
      main.azureEndpoint = "";
      await probes.act(() => useSettingsStore.setState({ azureEndpoint: "" }));
      await probes.settle();
      button = testButton(config());
      assert.equal(button.props.disabled, true);
      assert.match(button.props.title, /reasoning\.enterprise\.testHostUnknown/);
    }
  );

  // Change-driving (R2-9): enterprise setup existed only after Apply, so Azure was applied first.
  await t.test(
    "staged Azure: endpoint and deployment are set up inside the panel without committing",
    async () => {
      await reset({
        chatAgentMode: "providers",
        chatAgentProvider: "openai",
        chatAgentModel: "gpt-5.6-luna",
        azureEndpoint: "",
      });
      assert.equal(
        await act(() =>
          drafts.requestRouteChange(
            "chat",
            { mode: "providers", provider: "azure", model: "gpt-4o-deploy" },
            TEST_COPY
          )
        ),
        "staged"
      );
      assert.equal(
        drafts.planDraft(draft(), TEST_COPY).blocker,
        "needsUrl",
        "Apply is disabled until the endpoint exists"
      );
      const panel = await probes.mount("panel", () => StagedRoutePanel({ routeId: "chat" }));
      const setup = () =>
        findElement(panel(), (node) => typeof node.props?.onTarget === "function")?.props.setup;
      assert.equal(setup().type.name, "EnterpriseProviderConfig");
      assert.equal(
        setup().props.testConnection,
        false,
        "nothing is committed, so there is nothing to test"
      );
      let config = await probes.mount("panel-setup", () =>
        setup() ? setup().type(setup().props) : null
      );
      await typeAndLeave(field(config(), "reasoning.enterprise.endpoint"), WEST);
      assert.deepEqual(draft().setup, { azureEndpoint: WEST });
      assert.equal(live().azureEndpoint, "");
      assert.deepEqual(writes, []);
      assert.equal(drafts.planDraft(draft(), TEST_COPY).blocker, null, "ready: Apply is enabled");
      assert.equal(live().chatAgentProvider, "openai", "the route is not committed");

      config = await probes.mount("panel-setup", () =>
        setup() ? setup().type(setup().props) : null
      );
      await typeAndLeave(
        field(config(), "reasoning.enterprise.deploymentName"),
        "gpt-4o-mini-deploy"
      );
      assert.equal(draft().target.model, "gpt-4o-mini-deploy");
      assert.deepEqual(draft().setup, { azureEndpoint: WEST }, "the setup stays with the draft");
      assert.equal(live().chatAgentProvider, "openai");
    }
  );

  // Change-driving (R2-9): Codex was applied before any sign-in ("Sign in after applying").
  await t.test(
    "staged Codex: Connect is inside the panel; mounting starts nothing and the route stays staged",
    async () => {
      await reset({
        chatAgentMode: "providers",
        chatAgentProvider: "openai",
        chatAgentModel: "gpt-5.6-luna",
      });
      assert.equal(
        await act(() =>
          drafts.requestRouteChange(
            "chat",
            { mode: "providers", provider: "codex", model: "gpt-5.6-codex" },
            TEST_COPY
          )
        ),
        "staged"
      );
      assert.equal(drafts.planDraft(draft(), TEST_COPY).blocker, "needsKey");
      const panel = await probes.mount("codex-panel", () => StagedRoutePanel({ routeId: "chat" }));
      const setup = findElement(panel(), (node) => typeof node.props?.onTarget === "function").props
        .setup;
      assert.equal(setup.type.name, "CodexConnection");
      const connection = await probes.mount("codex-setup", () => setup.type(setup.props));
      await probes.settle();
      assert.deepEqual(codexCalls, [], "the panel starts no Codex process on mount");
      const connect = findElement(
        connection(),
        (node) =>
          typeof node.props?.onClick === "function" &&
          /codexConnection\.connect/.test(String(node.props.children))
      );
      assert.equal(connect.props.disabled, false);
      await probes.act(() => connect.props.onClick());
      await probes.settle();
      assert.ok(codexCalls.includes("codexLogin"), "sign-in is the explicit action");
      assert.equal(live().chatAgentProvider, "openai", "signing in commits no route");
      assert.equal(draft().target.provider, "codex");
    }
  );

  // Change-driving (R3-1): secret presence used to move Vertex from ADC to Express without Apply.
  await t.test(
    "mounted Vertex save plus main Remove and Undo metadata change readiness only; source changes wait for Apply",
    async () => {
      await reset({
        chatAgentMode: "enterprise",
        chatAgentProvider: "vertex",
        chatAgentModel: "gemini-2.5-flash",
        vertexProject: "acme-prod",
        vertexLocation: "europe-west4",
        vertexAuthSource: "apiKey",
      });
      const config = await mountEnterprise("chat", "vertex", "gemini-2.5-flash");
      const chat = () => routes.resolveRoute(routes.routeSnapshotFromSettings(live()), "chat");
      await probes.settle();
      assert.equal(chat().host, "aiplatform.googleapis.com");
      assert.equal(chat().state.status, "needsKey");

      const apiKeyElement = () =>
        findElement(config(), (node) => node.type?.name === "ApiKeyInput");
      const keyView = await probes.mount("vertex-api-key", () =>
        apiKeyElement().type(apiKeyElement().props)
      );
      const keyAction = (action) =>
        findElement(
          keyView(),
          (node) =>
            node.props?.["aria-label"] === (action === "save-key" ? "apiKeyInput.save" : action)
        );
      const keyEdit = () =>
        findElement(
          keyView(),
          (node) => node.type === "button" && node.props?.className?.includes("cursor-pointer")
        );
      await probes.act(() => keyEdit().props.onClick());
      await probes.act(() =>
        findElement(keyView(), (node) => node.props?.type === "password").props.onChange({
          target: { value: "vertex-fixture-secret" },
        })
      );
      await probes.act(() => keyAction("save-key").props.onClick());
      await probes.settle();
      assert.equal(
        chat().host,
        "aiplatform.googleapis.com",
        "acknowledged save keeps the apiKey recipient"
      );
      assert.equal(chat().state.status, "ready", "the committed key makes this source ready");
      assert.equal(main.vertexAuthSource, "apiKey");

      // Baseline guard for Task9: main lifecycle metadata only. Task12 owns
      // the actual mounted token Remove/toast/Undo acceptance.
      const removed = await act(() => api.credentials.remove("vertex"));
      await probes.settle();
      assert.equal(chat().host, "aiplatform.googleapis.com");
      assert.equal(chat().state.status, "needsKey");
      await act(() => api.credentials.undoRemove(removed.undoToken));
      await probes.settle();
      assert.equal(chat().host, "aiplatform.googleapis.com");
      assert.equal(chat().state.status, "ready");
      assert.equal(main.vertexAuthSource, "apiKey");

      const source = findElement(
        config(),
        (node) => node.props?.["data-route-field"] === "vertexAuthSource"
      );
      await probes.act(() => source.props.onChange({ currentTarget: { value: "adc" } }));
      await probes.settle();
      assert.deepEqual(draft(), {
        routeId: "chat",
        kind: "patch",
        patch: { vertexAuthSource: "adc" },
      });
      assert.equal(main.vertexAuthSource, "apiKey", "selecting ADC only stages the source");
      const review = drafts.planDraft(draft(), TEST_COPY);
      assert.equal(
        review.changes.find((change) => change.id === "chat").before.host,
        "aiplatform.googleapis.com"
      );
      assert.equal(
        review.changes.find((change) => change.id === "chat").after.host,
        "europe-west4-aiplatform.googleapis.com"
      );
      assert.equal((await act(() => drafts.applyDraft(TEST_COPY))).applied, true);
      assert.equal(main.vertexAuthSource, "adc");
      assert.equal(chat().host, "europe-west4-aiplatform.googleapis.com");
      assert.equal(chat().state.status, "ready", "ADC requires project, not an API key");
    }
  );
});

// Source guard, change-driving: each pattern is a direct write today.
test("change-driving: enterprise route fields have no direct writer in the UI", () => {
  const config = fs.readFileSync(path.join(SRC, "components/EnterpriseProviderConfig.tsx"), "utf8");
  for (const pattern of [
    /setBedrockRegion/,
    /setAzureEndpoint/,
    /setVertexProject/,
    /setVertexLocation/,
    /adjustBedrockModelForRegion/,
    /onChange=\{settings\./,
  ]) {
    assert.doesNotMatch(config, pattern);
  }
  assert.match(config, /describeVerify\(provider,/);
  const editor = fs.readFileSync(
    path.join(SRC, "components/settings/InferenceConfigEditor.tsx"),
    "utf8"
  );
  assert.match(
    editor,
    /const routePatch = \(patch: SettingsPatch\) => void requestPatch\(routeId, patch\)/
  );
  assert.match(editor, /onRoutePatch=\{routePatch\}/);
  const onboarding = fs.readFileSync(
    path.join(SRC, "components/notes/NotesOnboarding.tsx"),
    "utf8"
  );
  assert.match(
    onboarding,
    /onRoutePatch=\{\(patch\) => void requestPatch\("dictationCleanup", patch\)\}/
  );
});

// Change-driving: A→B→A re-pick must cancel waiting B even when A equals
// committed state; unrelated canonical events must preserve newer local text.
test("change-driving: enterprise local fields submit touched committed values and retain newer text", async (t) => {
  installBrowserGlobals(t, { window: { electronAPI: routeTestApi() } });
  const vite = await rendererServer(t, "loqui-enterprise-local-ownership-");
  const Config = (await vite.ssrLoadModule("/components/EnterpriseProviderConfig.tsx")).default;
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  useSettingsStore.setState({ azureEndpoint: EAST });
  const probes = createProbeRoot(t);
  const changes = [];
  const config = await probes.mount("config", () =>
    Config({
      provider: "azure",
      reasoningModel: "fixture",
      onSelectModel() {},
      onRoutePatch: (patch) => changes.push(patch),
      testConnection: false,
    })
  );
  const field = findElement(
    config(),
    (node) =>
      node.type?.name === "DraftField" && node.props.label === "reasoning.enterprise.endpoint"
  );
  let value = EAST;
  const draft = await probes.mount("field", () => field.type({ ...field.props, value }));
  await probes.act(() => draft().props.children[1].props.onChange({ target: { value: WEST } }));
  await probes.act(() => draft().props.children[1].props.onBlur());
  await probes.act(() => draft().props.children[1].props.onChange({ target: { value: EAST } }));
  await probes.act(() => draft().props.children[1].props.onBlur());
  assert.deepEqual(changes, [{ azureEndpoint: WEST }, { azureEndpoint: EAST }]);
  await probes.act(() =>
    draft().props.children[1].props.onChange({ target: { value: "https://typed.fixture.test" } })
  );
  value = "https://peer.fixture.test";
  await probes.act(() => useSettingsStore.setState({ azureEndpoint: value }));
  assert.equal(draft().props.children[1].props.value, "https://typed.fixture.test");
});

// Baseline guard Task9 integration, beyond the target-only sample: enterprise
// setup belongs to the original enable patch, including inherited vision.
for (const inheritedVision of [false, true])
  test(`baseline guard: enterprise patch setup preserves enable intent (vision=${inheritedVision})`, async (t) => {
    const current = {
      bedrockRegion: "us-east-1",
      azureEndpoint: "",
      vertexProject: "",
      vertexLocation: "us-central1",
      vertexAuthSource: "adc",
    };
    const api = routeTestApi({
      present: ["azure"],
      extra: {
        getEnterpriseRouteState: async () => ({
          current,
          version: 1,
          facts: {
            bedrockEndpoint: { set: false, host: null },
            bedrockProfile: false,
            vertexApiKeyEnv: false,
            vertexProjectEnv: false,
          },
        }),
      },
    });
    installBrowserGlobals(t, { window: { electronAPI: api } });
    const vite = await rendererServer(t, "loqui-task9-enterprise-patch-");
    const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
    const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
    const { StagedRoutePanel } = await vite.ssrLoadModule(
      "/components/settings/routing/StagedRoutePanel.tsx"
    );
    await primeRouteFacts(vite);
    useSettingsStore.setState({
      ...current,
      useCleanupModel: false,
      cleanupMode: "enterprise",
      cleanupProvider: "azure",
      cleanupModel: "",
      useDictationAgent: inheritedVision,
      voiceAgentScreenContext: false,
      useDictationAgentVisionModel: false,
      dictationAgentMode: "enterprise",
      dictationAgentProvider: "azure",
      dictationAgentModel: "",
    });
    const owner = inheritedVision ? "assistantVision" : "dictationCleanup";
    const enable = inheritedVision ? { voiceAgentScreenContext: true } : { useCleanupModel: true };
    assert.equal(await drafts.requestRoutePatch(owner, enable, TEST_COPY), "staged");
    const { wrap } = await toastCapture(vite);
    const probes = createProbeRoot(t, { wrap });
    const panel = await probes.mount("panel", () => StagedRoutePanel({ routeId: owner }));
    const setup = () =>
      findElement(panel(), (node) => typeof node.props?.onTarget === "function").props.setup;
    assert.equal(setup().type.name, "EnterpriseProviderConfig");
    await probes.act(() => setup().props.onRoutePatch({ azureEndpoint: WEST }));
    await probes.settle();
    await probes.act(() => setup().props.onSelectModel("fixture-deployment"));
    await probes.settle();
    const draft = drafts.useRouteDraftStore.getState().draft;
    assert.equal(draft.routeId, owner);
    assert.equal(draft.kind, "patch");
    for (const [key, value] of Object.entries(enable)) assert.equal(draft.patch[key], value);
    assert.equal(draft.patch.azureEndpoint, WEST);
    assert.equal(
      draft.patch[inheritedVision ? "dictationAgentModel" : "cleanupModel"],
      "fixture-deployment"
    );
    assert.equal(draft.patch.useDictationAgentVisionModel, undefined);
    assert.equal(useSettingsStore.getState().azureEndpoint, "");
    assert.equal(drafts.planDraft(draft, TEST_COPY).blocker, null);
  });

// Baseline guard: a host-only description never enables the forward Test API.
test("baseline guard: enterprise Test requires a main recipient token", async (t) => {
  let calls = 0;
  installBrowserGlobals(t, {
    window: {
      electronAPI: routeTestApi({
        extra: {
          keyring: {
            describeVerify: async () => ({ hosts: ["fixture.test"], fields: ["key"] }),
            verifyConnection: async () => {
              calls++;
            },
          },
        },
      }),
    },
  });
  const vite = await rendererServer(t, "loqui-enterprise-token-required-");
  const Config = (await vite.ssrLoadModule("/components/EnterpriseProviderConfig.tsx")).default;
  const probes = createProbeRoot(t);
  const tree = await probes.mount("config", () =>
    Config({ provider: "azure", reasoningModel: "fixture", onSelectModel() {}, onRoutePatch() {} })
  );
  await probes.settle();
  const button = findElement(tree(), (node) => node.props?.["data-action"] === "enterprise-test");
  assert.equal(button.props.disabled, true);
  await probes.act(() => button.props.onClick());
  assert.equal(calls, 0);
});

// Baseline guard for the change-driving local-field fix: the actual planner
// cancels waiting B after touched A is resubmitted, retaining unrelated intent.
test("baseline guard: enterprise A→B→A field intent supersedes waiting metadata without global discard", async (t) => {
  const api = routeTestApi({ present: ["azure"] });
  installBrowserGlobals(t, { window: { electronAPI: api } });
  const vite = await rendererServer(t, "loqui-task9-field-planner-wait-");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const Config = (await vite.ssrLoadModule("/components/EnterpriseProviderConfig.tsx")).default;
  await primeRouteFacts(vite);
  useSettingsStore.setState({
    azureEndpoint: EAST,
    chatAgentMode: "enterprise",
    chatAgentProvider: "azure",
    chatAgentModel: "fixture",
  });
  const unrelated = {
    routeId: "translation",
    kind: "target",
    target: { mode: "providers", provider: "openai", model: "fixture" },
  };
  drafts.useRouteDraftStore.getState().stage(unrelated);
  const list = api.credentials.list;
  const held = [];
  api.credentials.list = () => new Promise((resolve) => held.push(() => resolve(list())));
  const pending = [];
  const { wrap } = await toastCapture(vite);
  const probes = createProbeRoot(t, { wrap });
  const config = await probes.mount("config", () =>
    Config({
      provider: "azure",
      reasoningModel: "fixture",
      onSelectModel() {},
      onRoutePatch: (patch) => {
        pending.push(drafts.requestRoutePatch("chat", patch, TEST_COPY));
      },
      testConnection: false,
    })
  );
  const element = findElement(
    config(),
    (node) =>
      node.type?.name === "DraftField" && node.props.label === "reasoning.enterprise.endpoint"
  );
  const field = await probes.mount("field", () => element.type(element.props));
  const input = () => findElement(field(), (node) => typeof node.props?.onBlur === "function");
  for (const value of [WEST, EAST]) {
    await probes.act(() => input().props.onChange({ target: { value } }));
    await probes.act(() => input().props.onBlur());
  }
  assert.equal(pending.length, 2);
  assert.ok(held.length >= 1);
  await probes.act(async () => {
    for (const release of held.splice(0)) release();
    await Promise.all(pending);
  });
  assert.deepEqual(drafts.useRouteDraftStore.getState().draft, unrelated);
  assert.equal(useSettingsStore.getState().azureEndpoint, EAST);
});

// Change-driving: immediate successful Connect can be the first status read;
// onboarding's baseline callback rule must not leave staged Codex facts stale.
test("change-driving: first-read Codex sign-in refreshes readiness without committing its patch", async (t) => {
  let signedIn = false;
  const api = routeTestApi({
    extra: {
      personalInference: {
        codexLogin: async () => {
          signedIn = true;
          return { loginId: "fixture" };
        },
        codexStatus: async () => ({
          available: true,
          account: signedIn ? { type: "chatgpt" } : null,
        }),
        codexRateLimits: async () => ({}),
        onTextEvent: () => () => {},
      },
    },
  });
  const list = api.credentials.list;
  api.credentials.list = async () =>
    (await list()).map((row) => (row.id === "codex" ? { ...row, present: signedIn } : row));
  installBrowserGlobals(t, { window: { electronAPI: api } });
  const vite = await rendererServer(t, "loqui-codex-first-read-ready-");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const { StagedRoutePanel } = await vite.ssrLoadModule(
    "/components/settings/routing/StagedRoutePanel.tsx"
  );
  await primeRouteFacts(vite);
  useSettingsStore.setState({
    useCleanupModel: false,
    cleanupMode: "providers",
    cleanupProvider: "codex",
    cleanupModel: "fixture-codex",
  });
  await drafts.requestRoutePatch("dictationCleanup", { useCleanupModel: true }, TEST_COPY);
  const { wrap } = await toastCapture(vite);
  const probes = createProbeRoot(t, { wrap });
  const panel = await probes.mount("panel", () =>
    StagedRoutePanel({ routeId: "dictationCleanup" })
  );
  const setup = findElement(panel(), (node) => typeof node.props?.onTarget === "function").props
    .setup;
  const connection = await probes.mount("connection", () => setup.type(setup.props));
  assert.equal(
    drafts.planDraft(drafts.useRouteDraftStore.getState().draft, TEST_COPY).blocker,
    "needsKey"
  );
  const connect = findElement(
    connection(),
    (node) =>
      typeof node.props?.onClick === "function" && node.props.children === "codexConnection.connect"
  );
  await probes.act(() => connect.props.onClick());
  await probes.settle();
  assert.equal(
    drafts.planDraft(drafts.useRouteDraftStore.getState().draft, TEST_COPY).blocker,
    null
  );
  assert.equal(useSettingsStore.getState().useCleanupModel, false);
  assert.equal(drafts.useRouteDraftStore.getState().draft.patch.useCleanupModel, true);
});
