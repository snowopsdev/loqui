const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals } = require("../lib/rendererTestHarness");
const { createProbeRoot, findElement } = require("../lib/probeRoot");
const { rendererServer, routeTestApi, toastCapture } = require("../lib/routeTestApi");
const { MIGRATED_STORAGE, TEST_COPY, testFacts } = require("../lib/routeStateFixture");
const { TEAM_A, TEAM_B, ENDPOINT_CASES, endpointState } = require("../lib/endpointIdentityFixture");

test("change-driving: mounted route application reviews semantic paths before Apply and exact Undo", async (t) => {
  const writes = [];
  let version = 1;
  let main = {};
  const mainFacts = testFacts().enterpriseMain;
  const enterpriseListeners = new Set();
  const api = routeTestApi({
    present: ["azure"],
    extra: {
      getEnterpriseRouteState: async () => ({ current: { ...main }, version, facts: mainFacts }),
      onEnterpriseRouteChanged: (listener) => {
        enterpriseListeners.add(listener);
        return () => enterpriseListeners.delete(listener);
      },
      saveEnterpriseRoutePatch: async ({ patch, expected }) => {
        writes.push({ patch, expected });
        assert.deepEqual(expected, main, "Apply uses its reviewed complete enterprise CAS tuple");
        main = { ...expected, ...patch };
        ++version;
        for (const listener of enterpriseListeners)
          listener({ current: { ...main }, version, facts: mainFacts });
        return { success: true, current: { ...main }, version };
      },
    },
  });
  installBrowserGlobals(t, {
    initialStorage: MIGRATED_STORAGE,
    window: { electronAPI: api, dispatchEvent: () => true },
  });
  const vite = await rendererServer(t, "loqui-mounted-endpoint-identity-");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const { useRouteFactsStore } = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  const { ROUTE_PATCH_KEYS } = await vite.ssrLoadModule("/lib/providerSwitchPlans.ts");
  const { useRouteChange } = await vite.ssrLoadModule(
    "/components/settings/routing/useRouteChange.ts"
  );
  const { StagedRouteBar } = await vite.ssrLoadModule(
    "/components/settings/routing/StagedRouteBar.tsx"
  );
  const { wrap, toasts } = await toastCapture(vite);
  const probes = createProbeRoot(t, { wrap });
  const hook = await probes.mount("application", () => useRouteChange());
  const bar = await probes.mount("bar", () => StagedRouteBar({ shortcut: false }));
  const canonical = () =>
    Object.fromEntries(ROUTE_PATCH_KEYS.map((key) => [key, useSettingsStore.getState()[key]]));
  const reset = async (entry) => {
    await probes.act(() => {
      drafts.useRouteDraftStore.getState().discard();
      const state = endpointState(entry);
      main = Object.fromEntries(
        [
          "azureEndpoint",
          "bedrockRegion",
          "vertexProject",
          "vertexLocation",
          "vertexAuthSource",
        ].map((key) => [key, state[key]])
      );
      ++version;
      useSettingsStore.setState(state);
      useRouteFactsStore.setState({
        facts: testFacts({ credentials: new Map([["azure", true]]) }),
      });
    });
    toasts.length = 0;
    writes.length = 0;
  };
  const apply = async () => {
    assert.equal(bar().props.plan.blocker, null);
    await probes.act(() => bar().props.onApply());
    await probes.settle();
  };
  for (const entry of ENDPOINT_CASES) {
    await t.test(
      `change-driving: ${entry.key} mounted review, Apply and reverse review`,
      async () => {
        await reset(entry);
        const before = canonical();
        let result;
        await probes.act(async () => {
          result = await hook().requestPatch(entry.id, { [entry.key]: TEAM_B });
        });
        assert.equal(result, "staged");
        assert.deepEqual(canonical(), before, "no canonical write before Apply");
        assert.equal(writes.length, 0);
        assert.deepEqual(
          bar().props.plan.changes.map((change) => change.id),
          entry.ids
        );
        const identity = drafts.useRouteDraftStore.getState().draftIdentity;
        await apply();
        assert.equal(useSettingsStore.getState()[entry.key], TEAM_B);
        assert.equal(drafts.useRouteDraftStore.getState().draft, null);
        const undo = toasts.at(-1).actions[0].onClick;
        await probes.act(() => undo());
        assert.equal(
          useSettingsStore.getState()[entry.key],
          TEAM_B,
          "reverse recipient change also awaits review"
        );
        assert.equal(bar().props.plan.kind, "staged");
        assert.deepEqual(
          bar().props.plan.changes.map((change) => change.id),
          entry.ids
        );
        assert.ok(
          drafts.useRouteDraftStore.getState().draftIdentity > identity,
          "Undo has a fresh draft lifetime"
        );
        await apply();
        assert.deepEqual(canonical(), before, "reviewed Undo restores every raw route key exactly");
        if (entry.key === "azureEndpoint") {
          assert.equal(writes.length, 2);
          assert.equal(writes[0].expected.azureEndpoint, TEAM_A);
          assert.equal(writes[1].expected.azureEndpoint, TEAM_B);
        }
      }
    );
  }
  await t.test(
    "baseline guard: an awaiting semantic-path Apply cannot consume a replacement draft lifetime",
    async () => {
      const entry = ENDPOINT_CASES.find((item) => item.key === "dictationAgentRemoteUrl");
      await reset(entry);
      await probes.act(() => hook().requestPatch(entry.id, { [entry.key]: TEAM_B }));
      const owner = drafts.useRouteDraftStore.getState().draft;
      const lifetime = drafts.useRouteDraftStore.getState().draftIdentity;
      const list = api.credentials.list;
      let release;
      api.credentials.list = () =>
        new Promise((resolve) => {
          release = resolve;
        });
      let pending;
      await probes.act(() => {
        pending = hook().apply();
      });
      await probes.settle();
      assert.equal(typeof release, "function");
      const replacement = {
        routeId: entry.id,
        kind: "patch",
        patch: { [entry.key]: "https://gateway.example/team-c" },
      };
      await probes.act(() => drafts.useRouteDraftStore.getState().stage(replacement));
      assert.ok(drafts.useRouteDraftStore.getState().draftIdentity > lifetime);
      const rows = await list();
      api.credentials.list = list;
      let outcome;
      await probes.act(async () => {
        release(rows);
        outcome = await pending;
      });
      assert.equal(outcome, null);
      assert.notEqual(owner, replacement);
      assert.equal(drafts.useRouteDraftStore.getState().draft, replacement);
      assert.equal(useSettingsStore.getState()[entry.key], TEAM_A);
      assert.equal(toasts.length, 0);
      assert.deepEqual(
        bar().props.plan.changes.map((change) => change.id),
        entry.ids
      );
    }
  );
  await t.test(
    "change-driving: real voice-assistant endpoint editor stages inherited vision and closing discards it",
    async () => {
      const entry = ENDPOINT_CASES.find((item) => item.key === "dictationAgentRemoteUrl");
      await reset(entry);
      const Editor = (await vite.ssrLoadModule("/components/settings/InferenceConfigEditor.tsx"))
        .default;
      const editor = await probes.mount("editor", () => Editor({ scope: "dictationAgent" }));
      const panelElement = () =>
        findElement(editor(), (node) => typeof node.props?.onUseEndpoint === "function");
      const panel = await probes.mount("endpoint-panel", () =>
        panelElement().type(panelElement().props)
      );
      const draftElement = () =>
        findElement(panel(), (node) => typeof node.props?.onUse === "function");
      const field = await probes.mount("endpoint-field", () =>
        draftElement().type(draftElement().props)
      );
      await probes.act(() =>
        findElement(field(), (node) => node.props?.value === TEAM_A).props.onChange({
          target: { value: TEAM_B },
        })
      );
      assert.equal(useSettingsStore.getState().dictationAgentRemoteUrl, TEAM_A);
      await probes.act(() =>
        findElement(
          field(),
          (node) => node.props?.["data-action"] === "use-endpoint"
        ).props.onClick()
      );
      await probes.settle();
      assert.equal(useSettingsStore.getState().dictationAgentRemoteUrl, TEAM_A);
      assert.deepEqual(
        bar().props.plan.changes.map((change) => change.id),
        ["voiceAssistant", "assistantVision"]
      );
      await apply();
      assert.equal(useSettingsStore.getState().dictationAgentRemoteUrl, TEAM_B);
      await probes.act(() => toasts.at(-1).actions[0].onClick());
      await apply();
      assert.equal(useSettingsStore.getState().dictationAgentRemoteUrl, TEAM_A);
      await probes.act(() =>
        hook().requestPatch("voiceAssistant", { dictationAgentRemoteUrl: TEAM_B })
      );
      await probes.mount("bar", () => null);
      assert.equal(
        drafts.useRouteDraftStore.getState().draft,
        null,
        "bar owner unmount drops pending path edit"
      );
      assert.equal(useSettingsStore.getState().dictationAgentRemoteUrl, TEAM_A);
      assert.equal(
        drafts.planDraft(
          { routeId: "voiceAssistant", kind: "patch", patch: { dictationAgentRemoteUrl: TEAM_B } },
          TEST_COPY
        ).kind,
        "staged"
      );
    }
  );
});
