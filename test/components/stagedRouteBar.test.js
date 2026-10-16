const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals } = require("../lib/rendererTestHarness");
const { createProbeRoot } = require("../lib/probeRoot");
const {
  primeRouteFacts,
  rendererServer,
  routeTestApi,
  toastCapture,
} = require("../lib/routeTestApi");

const route = (over) => ({
  id: "dictationStt",
  kind: "speech",
  locality: "remote",
  provider: "OpenAI",
  providerId: "openai",
  host: "api.openai.com",
  model: "gpt-4o-mini-transcribe",
  state: { status: "ready" },
  sends: "your audio",
  settingsPath: "stt/dictation",
  ...over,
});
const onDevice = (id) =>
  route({
    id,
    locality: "device",
    provider: null,
    providerId: null,
    host: null,
    sends: null,
    model: "parakeet-unified-en-0.6b",
  });
const stagedPlan = (over = {}) => ({
  routeId: "dictationStt",
  patch: {},
  undoPatch: {},
  kind: "staged",
  blocker: null,
  changes: [
    { id: "dictationStt", coupled: false, before: onDevice("dictationStt"), after: route({}) },
    {
      id: "uploadStt",
      coupled: true,
      before: onDevice("uploadStt"),
      after: route({ id: "uploadStt", sends: "the audio file", settingsPath: "stt/upload" }),
    },
  ],
  ...over,
});

test("change-driving: the Apply bar shows every route the plan changes", async (t) => {
  installBrowserGlobals(t);
  const vite = await rendererServer(t, "loqui-staged-bar-view-");
  const { StagedRouteBarView } = await vite.ssrLoadModule(
    "/components/settings/routing/StagedRouteBar.tsx"
  );
  const render = (plan) =>
    renderToStaticMarkup(
      React.createElement(StagedRouteBarView, {
        plan,
        onApply() {},
        onDiscard() {},
        shortcutHint: "⌘↵",
      })
    );

  // Change-driving (I6, I7, Appendix B): the v1 bar named only the requested route.
  await t.test(
    "change-driving: each change lists destination, host and payload; coupled ones are marked",
    () => {
      const html = render(stagedPlan());
      assert.match(html, /role="region"/);
      assert.match(html, /data-route="dictationStt"/);
      assert.match(html, /data-route="uploadStt"/);
      assert.equal((html.match(/staging\.coupled/g) ?? []).length, 1);
      assert.equal((html.match(/dir="ltr"[^>]*>api\.openai\.com</g) ?? []).length, 2);
      assert.match(html, /staging\.sends\{&quot;payload&quot;:&quot;your audio&quot;\}/);
      assert.match(html, /staging\.sends\{&quot;payload&quot;:&quot;the audio file&quot;\}/);
      assert.match(html, /routes\.payload\.metadataNote/);
      assert.match(html, /<kbd[^>]*>⌘↵<\/kbd>/);
      assert.doesNotMatch(html, /disabled=""/);
    }
  );

  // Change-driving: the bar does not exist; the blocker copy and disabled Apply are new.
  await t.test("change-driving: a blocked plan disables Apply and says why", () => {
    const blocked = stagedPlan({ blocker: "needsKey" });
    blocked.changes[0].after = route({ state: { status: "needsKey", provider: "OpenAI" } });
    const html = render(blocked);
    assert.match(html, /disabled=""/);
    assert.match(
      html,
      /role="status"[^>]*>[^<]*staging\.blocked\.needsKey\{&quot;provider&quot;:&quot;OpenAI&quot;\}/
    );
  });

  // Change-driving (R2-9): v2's routeBlocker let Codex and enterprise needsKey through, and the
  // bar promised "Sign in to X after applying". Apply now stays disabled until the route is Ready.
  await t.test(
    "change-driving: Codex without a sign-in disables Apply and asks for the sign-in first",
    () => {
      const codex = stagedPlan({ blocker: "needsKey" });
      codex.changes = [
        {
          id: "chat",
          coupled: false,
          before: onDevice("chat"),
          after: route({
            id: "chat",
            kind: "text",
            providerId: "codex",
            provider: "ChatGPT (Codex)",
            host: "chatgpt.com",
            state: { status: "needsKey", provider: "ChatGPT (Codex)" },
          }),
        },
      ];
      const html = render(codex);
      assert.match(html, /disabled=""/);
      assert.match(
        html,
        /role="status"[^>]*>[^<]*staging\.blocked\.signIn\{&quot;provider&quot;:&quot;[^&]+&quot;\}/
      );
      assert.doesNotMatch(html, /staging\.setupAfterApply/, "no promise to sign in after applying");
    }
  );

  // Change-driving (R2-9): v2 returned no blocker for a remote route with no model.
  await t.test(
    "change-driving: a remote route with no model disables Apply and asks for a model",
    () => {
      const noModel = stagedPlan({ blocker: "needsModel" });
      noModel.changes[0].after = route({ model: null, state: { status: "needsModel" } });
      const html = render(noModel);
      assert.match(html, /disabled=""/);
      assert.match(html, /staging\.blocked\.chooseModel/);
      assert.doesNotMatch(
        html,
        /staging\.blocked\.needsModel/,
        "nothing to download for a remote model"
      );
    }
  );

  // Change-driving: the bar does not exist; device results must name no host.
  await t.test("change-driving: a route that ends on this device names no host or payload", () => {
    const plan = stagedPlan();
    plan.changes[1].after = onDevice("uploadStt");
    const html = render(plan);
    assert.match(html, /staging\.staysOnDevice/);
    assert.equal((html.match(/>api\.openai\.com</g) ?? []).length, 1);
  });
});

// Change-driving: no bar or shortcut exists yet.
test("change-driving: ⌘↵ applies only inside the Settings dialog", async (t) => {
  installBrowserGlobals(t, {
    window: { dispatchEvent: () => true, electronAPI: routeTestApi({ present: ["openai"] }) },
  });
  const vite = await rendererServer(t, "loqui-staged-bar-keys-");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useRouteDraftStore } = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const { StagedRouteBar } = await vite.ssrLoadModule(
    "/components/settings/routing/StagedRouteBar.tsx"
  );
  await primeRouteFacts(vite);
  const { wrap } = await toastCapture(vite);
  const probes = createProbeRoot(t, { wrap });
  const keydown = [];
  globalThis.document.addEventListener = (type, fn) => {
    if (type === "keydown") keydown.push(fn);
  };
  globalThis.document.removeEventListener = (type, fn) => {
    const index = keydown.indexOf(fn);
    if (index >= 0) keydown.splice(index, 1);
  };

  await probes.act(() =>
    useSettingsStore.setState({
      chatAgentMode: "local",
      chatAgentProvider: "qwen",
      chatAgentModel: "qwen3-4b",
    })
  );
  useRouteDraftStore.getState().stage({
    routeId: "chat",
    kind: "target",
    target: { mode: "providers", provider: "openai", model: "gpt-5.6-luna" },
  });
  await probes.mount("bar", () => StagedRouteBar({}));
  const press = (inside) =>
    probes.act(async () => {
      for (const fn of [...keydown]) {
        fn({
          key: "Enter",
          metaKey: true,
          ctrlKey: false,
          preventDefault() {},
          target: {
            closest: (selector) => (inside && selector === "[data-settings-dialog]" ? {} : null),
          },
        });
      }
    });

  await press(false);
  await probes.settle();
  assert.equal(
    useSettingsStore.getState().chatAgentMode,
    "local",
    "⌘↵ outside Settings applies nothing"
  );
  assert.ok(useRouteDraftStore.getState().draft);

  await press(true);
  await probes.settle();
  assert.equal(useSettingsStore.getState().chatAgentMode, "providers");
  assert.equal(useSettingsStore.getState().chatAgentProvider, "openai");
  assert.equal(useRouteDraftStore.getState().draft, null);
});

// Change-driving: SettingsModal passes onOpenChange straight through today.
test("change-driving: closing Settings discards the draft", async (t) => {
  installBrowserGlobals(t, { window: { dispatchEvent: () => true, electronAPI: routeTestApi() } });
  const vite = await rendererServer(t, "loqui-staged-bar-close-", {
    mockModules: { "/SettingsPage": "export default function SettingsPage() { return null; }" },
  });
  const { useRouteDraftStore } = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const SettingsModal = (await vite.ssrLoadModule("/components/SettingsModal.tsx")).default;
  const probes = createProbeRoot(t);
  const seen = [];
  const tree = await probes.mount("modal", () =>
    SettingsModal({ open: true, onOpenChange: (open) => seen.push(open) })
  );
  const dialog = tree();
  assert.ok("footer" in dialog.props, "the Apply bar rides in the dialog footer");

  await probes.act(() =>
    useRouteDraftStore
      .getState()
      .stage({ routeId: "chat", kind: "target", target: { mode: "providers", provider: "groq" } })
  );
  await probes.act(() => dialog.props.onOpenChange(true));
  assert.ok(useRouteDraftStore.getState().draft, "opening keeps it");
  await probes.act(() => dialog.props.onOpenChange(false));
  assert.equal(useRouteDraftStore.getState().draft, null);
  assert.deepEqual(seen, [true, false]);
});

// Change-driving (R2-8): v2's close cleared only the current draft, so a request still waiting
// for its presence read staged a remote draft after Settings had closed. The real boundary is
// SettingsModal's onOpenChange (SettingsModal.tsx:125-139).
test("change-driving: closing Settings while a route request waits leaves no draft and commits nothing", async (t) => {
  const heldLists = [];
  const api = routeTestApi({ present: ["groq", "openai"] });
  const list = api.credentials.list;
  api.credentials.list = () => new Promise((resolve) => heldLists.push(() => resolve(list())));
  installBrowserGlobals(t, { window: { dispatchEvent: () => true, electronAPI: api } });
  const vite = await rendererServer(t, "loqui-staged-bar-close-pending-", {
    mockModules: { "/SettingsPage": "export default function SettingsPage() { return null; }" },
  });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const { TEST_COPY } = require("../lib/routeStateFixture");
  const SettingsModal = (await vite.ssrLoadModule("/components/SettingsModal.tsx")).default;
  const probes = createProbeRoot(t);
  const tree = await probes.mount("modal", () => SettingsModal({ open: true, onOpenChange() {} }));
  await probes.act(() =>
    useSettingsStore.setState({
      chatAgentMode: "providers",
      chatAgentProvider: "openai",
      chatAgentModel: "gpt-6-astra",
    })
  );

  // A remote pick and an on-device pick, both still waiting when Settings closes.
  const remote = drafts.requestRouteChange(
    "chat",
    { mode: "providers", provider: "groq" },
    TEST_COPY
  );
  const local = drafts.requestRouteChange("translation", { mode: "local" }, TEST_COPY);
  await probes.settle();
  assert.equal(heldLists.length, 2, "both requests are waiting for credentials.list");
  await probes.act(() => tree().props.onOpenChange(false));
  await probes.act(async () => {
    for (const release of heldLists.splice(0)) release();
  });
  assert.equal(await remote, "superseded");
  assert.equal(await local, "superseded");
  assert.equal(drafts.useRouteDraftStore.getState().draft, null, "no draft after close");
  assert.equal(
    useSettingsStore.getState().chatAgentProvider,
    "openai",
    "nothing committed after close"
  );
});

// Baseline guard over Task7 ownership, change-driving for the Task8 toast hook:
// stale requests and Apply's null result must never announce success or failure.
test("baseline guard: the toast hook suppresses superseded requests and expired Apply", async (t) => {
  const api = routeTestApi({ present: ["openai"] });
  installBrowserGlobals(t, { window: { dispatchEvent: () => true, electronAPI: api } });
  const vite = await rendererServer(t, "loqui-route-toast-ownership-");
  const { useRouteChange } = await vite.ssrLoadModule(
    "/components/settings/routing/useRouteChange.ts"
  );
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  await primeRouteFacts(vite);
  const { toasts, wrap } = await toastCapture(vite);
  const probes = createProbeRoot(t, { wrap });
  const hook = await probes.mount("hook", () => useRouteChange());
  await probes.act(() =>
    useSettingsStore.setState({
      chatAgentMode: "local",
      chatAgentProvider: "qwen",
      chatAgentModel: "qwen3-4b",
    })
  );
  const list = api.credentials.list;
  const waiting = [];
  api.credentials.list = () => new Promise((resolve) => waiting.push(() => resolve(list())));
  let request;
  await probes.act(() => {
    request = hook().request("chat", {
      mode: "providers",
      provider: "openai",
      model: "gpt-6-astra",
    });
  });
  await probes.settle();
  await probes.act(() => drafts.endSettingsSession());
  await probes.act(() => {
    for (const release of waiting.splice(0)) release();
  });
  assert.equal(await request, "superseded");
  assert.equal(toasts.length, 0);
  await probes.act(() =>
    drafts.useRouteDraftStore.getState().stage({
      routeId: "chat",
      kind: "target",
      target: { mode: "providers", provider: "openai", model: "gpt-6-astra" },
    })
  );
  let applying;
  await probes.act(() => {
    applying = hook().apply();
  });
  await probes.settle();
  await probes.act(() => drafts.endSettingsSession());
  await probes.act(() => {
    for (const release of waiting.splice(0)) release();
  });
  assert.equal(await applying, null);
  assert.equal(toasts.length, 0);
});

// Change-driving: the bar must re-plan from current facts, including after a
// refused Apply, and leave the user's draft available for setup and retry.
test("baseline guard: live blockers keep the draft visible after Apply refuses", async (t) => {
  const api = routeTestApi({ present: ["openai"] });
  installBrowserGlobals(t, { window: { dispatchEvent: () => true, electronAPI: api } });
  const vite = await rendererServer(t, "loqui-route-bar-live-blocker-");
  const { StagedRouteBar } = await vite.ssrLoadModule(
    "/components/settings/routing/StagedRouteBar.tsx"
  );
  const { useRouteChange } = await vite.ssrLoadModule(
    "/components/settings/routing/useRouteChange.ts"
  );
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useRouteDraftStore } = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const { useRouteFactsStore } = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  await primeRouteFacts(vite);
  const { toasts, wrap } = await toastCapture(vite);
  const probes = createProbeRoot(t, { wrap });
  await probes.act(() =>
    useSettingsStore.setState({
      chatAgentMode: "local",
      chatAgentProvider: "qwen",
      chatAgentModel: "qwen3-4b",
    })
  );
  const owned = {
    routeId: "chat",
    kind: "target",
    target: { mode: "providers", provider: "openai", model: "gpt-6-astra" },
  };
  await probes.act(() => useRouteDraftStore.getState().stage(owned));
  const bar = await probes.mount("bar", () => StagedRouteBar({}));
  const hook = await probes.mount("hook", () => useRouteChange());
  assert.equal(bar().props.plan.blocker, null);
  const rows = await api.credentials.list();
  api.credentials.list = async () =>
    rows.map((row) =>
      row.id === "openai" ? { ...row, present: false, fields: { key: false }, generation: 3 } : row
    );
  await probes.act(() =>
    useRouteFactsStore.setState(({ facts }) => ({
      facts: {
        ...facts,
        credentials: new Map([["openai", false]]),
        credentialGenerations: new Map([["openai", 3]]),
      },
    }))
  );
  assert.equal(bar().props.plan.blocker, "needsKey");
  await probes.act(() => hook().apply());
  assert.equal(useRouteDraftStore.getState().draft, owned);
  assert.equal(bar().props.plan.blocker, "needsKey");
  assert.equal(toasts.length, 0, "a live readiness blocker is not a persistence failure");
});

// Baseline guard for the reviewed Task7 result contract consumed by Task8.
// Conflict uses the generic save-failed UI after refreshing atomic authority.
test("baseline guard: a conflict refreshes canonical state, retains the draft and reports generic failure", async (t) => {
  const state = {
    current: {
      bedrockRegion: "us-east-1",
      azureEndpoint: "",
      vertexProject: "",
      vertexLocation: "us-central1",
      vertexAuthSource: "apiKey",
    },
    version: 1,
    facts: {
      bedrockEndpoint: { set: false, host: null },
      bedrockProfile: false,
      vertexApiKeyEnv: false,
      vertexProjectEnv: false,
    },
  };
  let reads = 0;
  let writes = 0;
  const api = routeTestApi({
    present: ["azure"],
    extra: {
      getEnterpriseRouteState: async () => {
        reads++;
        return { ...state, current: { ...state.current } };
      },
      saveEnterpriseRoutePatch: async () => {
        writes++;
        state.current = {
          ...state.current,
          azureEndpoint: "https://other-resource.openai.azure.com",
        };
        state.version++;
        return {
          success: false,
          conflict: true,
          current: { ...state.current },
          version: state.version,
        };
      },
    },
  });
  installBrowserGlobals(t, { window: { dispatchEvent: () => true, electronAPI: api } });
  const vite = await rendererServer(t, "loqui-route-bar-conflict-");
  const { useRouteChange } = await vite.ssrLoadModule(
    "/components/settings/routing/useRouteChange.ts"
  );
  const { StagedRouteBar } = await vite.ssrLoadModule(
    "/components/settings/routing/StagedRouteBar.tsx"
  );
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  await primeRouteFacts(vite);
  const { toasts, wrap } = await toastCapture(vite);
  const probes = createProbeRoot(t, { wrap });
  useSettingsStore.setState({
    chatAgentMode: "local",
    chatAgentProvider: "qwen",
    chatAgentModel: "qwen3-4b",
  });
  drafts.useRouteDraftStore.getState().stage({
    routeId: "chat",
    kind: "target",
    target: { mode: "providers", provider: "azure", model: "my-deployment" },
  });
  const owned = drafts.stageDraftSetup("chat", {
    azureEndpoint: "https://reviewed-resource.openai.azure.com",
  });
  const hook = await probes.mount("hook", () => useRouteChange());
  const bar = await probes.mount("bar", () => StagedRouteBar({}));
  assert.equal(bar().props.plan.blocker, null);
  const initialReads = reads;
  let result;
  await probes.act(async () => {
    result = await hook().apply();
  });
  assert.equal(result, "save-failed");
  assert.equal(writes, 1);
  assert.ok(reads > initialReads, "conflict rereads a complete current/version/facts tuple");
  assert.equal(useSettingsStore.getState().azureEndpoint, state.current.azureEndpoint);
  assert.equal(useSettingsStore.getState().chatAgentMode, "local");
  assert.equal(drafts.useRouteDraftStore.getState().draft, owned);
  assert.ok(bar(), "the retained draft remains reviewable");
  assert.deepEqual(
    toasts.map(({ title, variant }) => ({ title, variant })),
    [{ title: "common.error", variant: "destructive" }]
  );
});
