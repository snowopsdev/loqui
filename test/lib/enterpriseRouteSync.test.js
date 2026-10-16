const assert = require("node:assert/strict");
const test = require("node:test");
const { enterpriseRouteIpc } = require("../helpers/harness/enterpriseRouteIpc");
const { createRendererServer, installBrowserGlobals } = require("./rendererTestHarness");
const { routeBaseState, MIGRATED_STORAGE } = require("./routeStateFixture");
const { deferred } = require("../helpers/harness/deferred");
const INITIAL = {
  BEDROCK_REGION: "us-east-1",
  AZURE_OPENAI_ENDPOINT: "https://east.openai.azure.com/openai",
  VERTEX_PROJECT: "acme-prod",
  VERTEX_LOCATION: "us-central1",
  VERTEX_AUTH_SOURCE: "adc",
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const fields = [
  "bedrockRegion",
  "azureEndpoint",
  "vertexProject",
  "vertexLocation",
  "vertexAuthSource",
];
const tuple = (store) => Object.fromEntries(fields.map((key) => [key, store.getState()[key]]));
async function renderer(t, ipc) {
  const listeners = new Map();
  const { storage } = installBrowserGlobals(t, {
    initialStorage: MIGRATED_STORAGE,
    window: {
      addEventListener: (name, fn) => listeners.set(name, [...(listeners.get(name) || []), fn]),
      electronAPI: {
        getEnterpriseRouteState: () => ipc.invoke("get-enterprise-route-state"),
        onEnterpriseRouteChanged: ipc.onChanged,
        setDictionary: async () => {},
        saveEnterpriseRoutePatch: (input) => ipc.invoke("save-enterprise-route-patch", input),
      },
    },
  });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-task6-sync-" });
  const settings = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const facts = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  await settings.initializeSettings();
  assert.ok(listeners.get("storage")?.length, "actual production storage subscription installed");
  settings.useSettingsStore.setState({
    ...routeBaseState(),
    ...ipc.env.getEnterpriseRouteSettings(),
  });
  return { ...settings, ...facts, vite, storage, listeners };
}
function legacyApi(ipc) {
  return Object.fromEntries(
    [
      ["getBedrockRegion", "get-bedrock-region"],
      ["getAzureEndpoint", "get-azure-endpoint"],
      ["getVertexProject", "get-vertex-project"],
      ["getVertexLocation", "get-vertex-location"],
      ["getVertexAuthSource", "get-vertex-auth-source"],
      ["enterpriseRouteFacts", "enterprise-route-facts"],
    ].map(([key, channel]) => [key, () => ipc.invoke(channel)])
  );
}

test("change-driving N2: five separate startup replies cannot admit a mixed tuple", async (t) => {
  const ipc = enterpriseRouteIpc(t, INITIAL);
  const r = await renderer(t, ipc);
  const before = ipc.env.getEnterpriseRouteSettings();
  const api = legacyApi(ipc);
  let called = 0;
  for (const key of Object.keys(api)) {
    const read = api[key];
    api[key] = () => {
      called++;
      return read();
    };
  }
  await r.loadRouteFacts(api, ["enterprise"]);
  assert.equal(called, 0, "five separate getters are never used as tuple authority");
  assert.equal(r.useRouteFactsStore.getState().facts.enterpriseMain, null);
  await ipc.invoke("save-enterprise-route-patch", {
    expected: before,
    patch: {
      bedrockRegion: "eu-west-1",
      azureEndpoint: "https://west.openai.azure.com/openai",
    },
  });
  await r.loadRouteFacts(globalThis.window.electronAPI, ["enterprise"]);
  assert.deepEqual(tuple(r.useSettingsStore), ipc.env.getEnterpriseRouteSettings());
  assert.notEqual(
    r.useRouteFactsStore.getState().facts.enterpriseMain,
    null,
    "atomic state eventually becomes authoritative"
  );
});

test("change-driving N2: an older Apply ACK cannot replace a competing window's newer commit", async (t) => {
  const ipc = enterpriseRouteIpc(t, INITIAL);
  const r = await renderer(t, ipc);
  const before = ipc.env.getEnterpriseRouteSettings();
  const acknowledged = deferred();
  const release = deferred();
  globalThis.window.electronAPI.saveEnterpriseRoutePatch = async (input) => {
    const ack = await ipc.invoke("save-enterprise-route-patch", input);
    acknowledged.resolve();
    await release.promise;
    return ack;
  };
  await r.loadRouteFacts(globalThis.window.electronAPI, ["enterprise"]);
  const apply = r.useSettingsStore.getState().applyRoutePatch({
    azureEndpoint: "https://first.openai.azure.com/openai",
    chatAgentModel: "stale-companion",
  });
  const superseded = assert.rejects(apply, { code: "ENTERPRISE_ROUTE_SUPERSEDED" });
  await acknowledged.promise;
  const next = await ipc.invoke("save-enterprise-route-patch", {
    expected: ipc.env.getEnterpriseRouteSettings(),
    patch: {
      azureEndpoint: "https://second.openai.azure.com/openai",
      vertexProject: "other-account",
    },
  });
  // Deliver the second window's durable state before the older ACK reaches the first.
  for (const key of fields) {
    r.storage.setItem(key, next.current[key]);
    for (const listener of r.listeners.get("storage") || [])
      listener({ key, newValue: next.current[key], storageArea: r.storage });
  }
  release.resolve();
  await superseded;
  await tick();
  assert.deepEqual(
    tuple(r.useSettingsStore),
    ipc.env.getEnterpriseRouteSettings(),
    `old durable ACK must not regress newer authority (initial ${before.azureEndpoint})`
  );
  assert.notEqual(r.useSettingsStore.getState().chatAgentModel, "stale-companion");
  assert.notEqual(
    r.useRouteFactsStore.getState().facts.enterpriseMain,
    null,
    "newer committed state is eventually known"
  );
});

test("change-driving N2: individual peer storage events cannot publish a partly updated ready tuple", async (t) => {
  const ipc = enterpriseRouteIpc(t, INITIAL);
  const r = await renderer(t, ipc);
  await r.loadRouteFacts(globalThis.window.electronAPI, ["enterprise"]);
  const before = tuple(r.useSettingsStore);
  ipc.pauseEvents();
  const ack = await ipc.invoke("save-enterprise-route-patch", {
    expected: before,
    patch: {
      azureEndpoint: "https://west.openai.azure.com/openai",
      vertexProject: "other-account",
    },
  });
  r.storage.setItem("azureEndpoint", ack.current.azureEndpoint);
  for (const listener of r.listeners.get("storage") || [])
    listener({ key: "azureEndpoint", newValue: ack.current.azureEndpoint, storageArea: r.storage });
  const actual = tuple(r.useSettingsStore);
  assert.deepEqual(actual, before, "individual storage key is ignored");
  assert.ok(
    JSON.stringify(actual) === JSON.stringify(before) ||
      JSON.stringify(actual) === JSON.stringify(ack.current) ||
      r.useRouteFactsStore.getState().facts.enterpriseMain === null,
    `partly delivered peer tuple admitted as authoritative: ${JSON.stringify(actual)}`
  );
  ipc.deliver(await ipc.invoke("get-enterprise-route-state"));
  assert.deepEqual(tuple(r.useSettingsStore), ack.current);
  assert.notEqual(
    r.useRouteFactsStore.getState().facts.enterpriseMain,
    null,
    "complete peer event restores latest known state"
  );
});

test("change-driving N2: delayed atomic startup response never replaces a newer committed event", async (t) => {
  const ipc = enterpriseRouteIpc(t, INITIAL);
  const r = await renderer(t, ipc);
  const captured = deferred();
  const release = deferred();
  const load = r.loadRouteFacts(
    {
      getEnterpriseRouteState: async () => {
        const old = await ipc.invoke("get-enterprise-route-state");
        captured.resolve();
        await release.promise;
        return old;
      },
    },
    ["enterprise"]
  );
  await captured.promise;
  await ipc.invoke("save-enterprise-route-patch", {
    expected: ipc.env.getEnterpriseRouteSettings(),
    patch: { vertexProject: "new-window-account" },
  });
  release.resolve();
  await load;
  assert.deepEqual(tuple(r.useSettingsStore), ipc.env.getEnterpriseRouteSettings());
  assert.notEqual(r.useRouteFactsStore.getState().facts.enterpriseMain, null);
});

test("change-driving N2: legacy A→B→A input revisions preserve text and readiness through old ACKs and failed writes", async (t) => {
  const ipc = enterpriseRouteIpc(t, INITIAL);
  const r = await renderer(t, ipc);
  await r.loadRouteFacts(globalThis.window.electronAPI, ["enterprise"]);
  const receipts = [];
  globalThis.window.electronAPI.saveAzureEndpoint = async (value) => {
    const ack = await ipc.invoke("save-azure-endpoint", value);
    const release = deferred();
    receipts.push({ ack, release });
    await release.promise;
    return ack;
  };
  const live = () => r.useSettingsStore.getState();
  const a = "https://a.openai.azure.com/openai";
  const b = "https://b.openai.azure.com/openai";
  live().setAzureEndpoint(a);
  live().setAzureEndpoint(b);
  live().setAzureEndpoint(a);
  while (receipts.length < 3) await tick();
  assert.equal(live().azureEndpoint, a, "newest raw text retained through all durable events");
  assert.equal(
    r.useRouteFactsStore.getState().facts.enterpriseMain,
    null,
    "same-value old ACK cannot confirm newer submission"
  );
  receipts[0].release.resolve();
  receipts[1].release.resolve();
  await tick();
  assert.equal(live().azureEndpoint, a);
  assert.equal(r.useRouteFactsStore.getState().facts.enterpriseMain, null);
  receipts[2].release.resolve();
  await tick();
  assert.deepEqual(tuple(r.useSettingsStore), ipc.env.getEnterpriseRouteSettings());
  assert.notEqual(r.useRouteFactsStore.getState().facts.enterpriseMain, null);
  ipc.fs.holdNext((op, name) => op === "rename" && name === ".env");
  live().setAzureEndpoint("https://failed.openai.azure.com/openai");
  (await ipc.fs.nextHold()).fail(new Error("fixture failure"));
  await tick();
  assert.equal(
    live().azureEndpoint,
    "https://failed.openai.azure.com/openai",
    "failed write retains typed draft"
  );
  assert.equal(ipc.env.getEnterpriseRouteSettings().azureEndpoint, a);
  assert.equal(r.useRouteFactsStore.getState().facts.enterpriseMain, null);
  // A later canonical refresh cannot bless the failed raw draft.
  await r.loadRouteFacts(globalThis.window.electronAPI, ["enterprise"]);
  assert.equal(live().azureEndpoint, "https://failed.openai.azure.com/openai");
  assert.equal(r.useRouteFactsStore.getState().facts.enterpriseMain, null);
});

test("change-driving N2/N1: Bedrock profile facts advance authority with an unchanged tuple, and reset fences old authority", async (t) => {
  const ipc = enterpriseRouteIpc(t, INITIAL);
  const r = await renderer(t, ipc);
  await r.loadRouteFacts(globalThis.window.electronAPI, ["enterprise"]);
  const version = ipc.env.getEnterpriseRouteState().version;
  await ipc.invoke("save-bedrock-profile", "fixture-profile");
  assert.ok(ipc.env.getEnterpriseRouteState().version > version);
  assert.equal(r.useRouteFactsStore.getState().facts.enterpriseMain.bedrockProfile, true);
  await ipc.invoke("save-bedrock-profile", "");
  assert.equal(r.useRouteFactsStore.getState().facts.enterpriseMain.bedrockProfile, false);
  const old = await ipc.invoke("get-enterprise-route-state");
  await ipc.env.clearAllPersistedData();
  ipc.deliver(old);
  assert.equal(
    r.useRouteFactsStore.getState().facts.enterpriseMain,
    null,
    "reset revokes even previously complete state"
  );
  await ipc.env.saveVertexAuthSource("adc", { expectedEpoch: ipc.env.getEnvWriteEpoch() });
  await r.loadRouteFacts(globalThis.window.electronAPI, ["enterprise"]);
  assert.notEqual(
    r.useRouteFactsStore.getState().facts.enterpriseMain,
    null,
    "new migration state is eventually known"
  );
  assert.ok(ipc.env.getEnterpriseRouteState().version > old.version);
});

test("change-driving N1/N2: delayed pre-removal atomic profile facts cannot overwrite the removal event", async (t) => {
  const ipc = enterpriseRouteIpc(t, INITIAL);
  const r = await renderer(t, ipc);
  await ipc.invoke("save-bedrock-profile", "fixture-profile");
  await r.loadRouteFacts(globalThis.window.electronAPI, ["enterprise"]);
  assert.equal(r.useRouteFactsStore.getState().facts.enterpriseMain.bedrockProfile, true);
  const captured = deferred();
  const release = deferred();
  const pending = r.loadRouteFacts(
    {
      getEnterpriseRouteState: async () => {
        const old = await ipc.invoke("get-enterprise-route-state");
        captured.resolve();
        await release.promise;
        return old;
      },
    },
    ["enterprise"]
  );
  await captured.promise;
  await ipc.invoke("save-bedrock-profile", "");
  assert.equal(r.useRouteFactsStore.getState().facts.enterpriseMain.bedrockProfile, false);
  release.resolve();
  await pending;
  assert.equal(
    r.useRouteFactsStore.getState().facts.enterpriseMain.bedrockProfile,
    false,
    "delayed pre-removal facts cannot resurrect profile readiness"
  );
  const routes = await r.vite.ssrLoadModule("/lib/routes.ts");
  r.useSettingsStore.setState({
    chatAgentMode: "enterprise",
    chatAgentProvider: "bedrock",
    chatAgentModel: "us.anthropic.claude-fable-5",
  });
  r.useRouteFactsStore.setState((s) => ({
    facts: {
      ...s.facts,
      credentials: new Map([["bedrock", false]]),
      credentialFields: new Map([["bedrock", { accessKeyId: false, secretAccessKey: false }]]),
    },
  }));
  assert.equal(
    routes.resolveRoute(routes.routeSnapshotFromSettings(r.useSettingsStore.getState()), "chat")
      .state.status,
    "needsKey"
  );
});

test("change-driving N2: synchronous subscribers never admit optimistic raw drafts as confirmed enterprise state", async (t) => {
  const ipc = enterpriseRouteIpc(t, INITIAL);
  const r = await renderer(t, ipc);
  await r.loadRouteFacts(globalThis.window.electronAPI, ["enterprise"]);
  globalThis.window.electronAPI.saveAzureEndpoint = (value) =>
    ipc.invoke("save-azure-endpoint", value);
  const admitted = [];
  const unsubscribe = r.useSettingsStore.subscribe(() => {
    if (r.useRouteFactsStore.getState().facts.enterpriseMain !== null)
      admitted.push(tuple(r.useSettingsStore));
  });
  ipc.fs.holdNext((op, name) => op === "rename" && name === ".env");
  r.useSettingsStore.getState().setAzureEndpoint("https://typing.openai.azure.com/openai");
  const hold = await ipc.fs.nextHold();
  assert.deepEqual(
    admitted,
    [],
    "typed raw setting must invalidate facts before setState subscribers run"
  );
  hold.release();
  await tick();
  unsubscribe();
});

test("change-driving N2: all four legacy controlled inputs keep newer text while an older write is acknowledged", async (t) => {
  const cases = [
    [
      "bedrockRegion",
      "setBedrockRegion",
      "saveBedrockRegion",
      "save-bedrock-region",
      "eu-west-1",
      "us-west-2",
    ],
    [
      "azureEndpoint",
      "setAzureEndpoint",
      "saveAzureEndpoint",
      "save-azure-endpoint",
      "https://a.openai.azure.com/openai",
      "https://b.openai.azure.com/openai",
    ],
    [
      "vertexProject",
      "setVertexProject",
      "saveVertexProject",
      "save-vertex-project",
      "project-a",
      "project-b",
    ],
    [
      "vertexLocation",
      "setVertexLocation",
      "saveVertexLocation",
      "save-vertex-location",
      "europe-west4",
      "global",
    ],
  ];
  for (const [key, setter, method, channel, first, second] of cases) {
    await t.test(`change-driving: ${key}`, async (st) => {
      const ipc = enterpriseRouteIpc(st, INITIAL);
      const r = await renderer(st, ipc);
      await r.loadRouteFacts(globalThis.window.electronAPI, ["enterprise"]);
      const receipts = [];
      globalThis.window.electronAPI[method] = async (value) => {
        const ack = await ipc.invoke(channel, value);
        const release = deferred();
        receipts.push({ ack, release });
        await release.promise;
        return ack;
      };
      r.useSettingsStore.getState()[setter](first);
      r.useSettingsStore.getState()[setter](second);
      while (receipts.length < 2) await tick();
      receipts[0].release.resolve();
      await tick();
      assert.equal(r.useSettingsStore.getState()[key], second);
      assert.equal(r.useRouteFactsStore.getState().facts.enterpriseMain, null);
      receipts[1].release.resolve();
      await tick();
      assert.equal(r.useSettingsStore.getState()[key], second);
      assert.deepEqual(tuple(r.useSettingsStore), ipc.env.getEnterpriseRouteSettings());
      assert.notEqual(r.useRouteFactsStore.getState().facts.enterpriseMain, null);
    });
  }
});

test("change-driving N2/I5: own committed event cannot split an enterprise patch from its local model companion", async (t) => {
  const ipc = enterpriseRouteIpc(t, INITIAL);
  const r = await renderer(t, ipc);
  await r.loadRouteFacts(globalThis.window.electronAPI, ["enterprise"]);
  r.useSettingsStore.setState({
    chatAgentMode: "enterprise",
    chatAgentProvider: "bedrock",
    chatAgentModel: "us.anthropic.claude-fable-5",
  });
  const captured = deferred();
  const release = deferred();
  globalThis.window.electronAPI.saveEnterpriseRoutePatch = async (input) => {
    const ack = await ipc.invoke("save-enterprise-route-patch", input);
    captured.resolve();
    await release.promise;
    return ack;
  };
  const seen = [];
  const unsubscribe = r.useSettingsStore.subscribe((state) =>
    seen.push([state.bedrockRegion, state.chatAgentModel])
  );
  const pending = r.useSettingsStore
    .getState()
    .applyRoutePatch({ bedrockRegion: "eu-west-1", chatAgentModel: "eu.anthropic.claude-fable-5" });
  await captured.promise;
  try {
    assert.deepEqual(
      seen,
      [],
      "a committed event must not publish only the enterprise half of the patch"
    );
    assert.equal(
      r.useRouteFactsStore.getState().facts.enterpriseMain,
      null,
      "pending canonical divergence is not ready"
    );
  } finally {
    release.resolve();
    await pending;
    unsubscribe();
  }
  assert.deepEqual(seen, [["eu-west-1", "eu.anthropic.claude-fable-5"]]);
  assert.notEqual(r.useRouteFactsStore.getState().facts.enterpriseMain, null);
});

test("change-driving N2: lost Apply reply exposes committed canonical truth without unacknowledged companions", async (t) => {
  const ipc = enterpriseRouteIpc(t, INITIAL);
  const r = await renderer(t, ipc);
  await r.loadRouteFacts(globalThis.window.electronAPI, ["enterprise"]);
  const beforeModel = r.useSettingsStore.getState().chatAgentModel;
  globalThis.window.electronAPI.saveEnterpriseRoutePatch = async (input) => {
    await ipc.invoke("save-enterprise-route-patch", input);
    throw new Error("fixture lost reply");
  };
  await assert.rejects(
    r.useSettingsStore.getState().applyRoutePatch({
      azureEndpoint: "https://durable.openai.azure.com/openai",
      chatAgentModel: "unacknowledged-companion",
    }),
    /lost reply/
  );
  assert.deepEqual(tuple(r.useSettingsStore), ipc.env.getEnterpriseRouteSettings());
  assert.equal(r.useSettingsStore.getState().chatAgentModel, beforeModel);
  assert.notEqual(r.useRouteFactsStore.getState().facts.enterpriseMain, null);
});

test("change-driving N2: a newer ACK without matching complete facts cannot reuse an older facts identity", async (t) => {
  const ipc = enterpriseRouteIpc(t, INITIAL);
  const r = await renderer(t, ipc);
  await r.loadRouteFacts(globalThis.window.electronAPI, ["enterprise"]);
  ipc.pauseEvents();
  await r.useSettingsStore.getState().applyRoutePatch({ vertexProject: "new-ack-account" });
  assert.deepEqual(tuple(r.useSettingsStore), ipc.env.getEnterpriseRouteSettings());
  assert.equal(
    r.useRouteFactsStore.getState().facts.enterpriseMain,
    null,
    "ACK has no facts, so older facts cannot grant newer authority"
  );
  await r.loadRouteFacts(globalThis.window.electronAPI, ["enterprise"]);
  assert.notEqual(
    r.useRouteFactsStore.getState().facts.enterpriseMain,
    null,
    "matching complete read eventually confirms latest authority"
  );
});

test("baseline guard N2: a repeated authority version cannot replace its normalized facts", async (t) => {
  const ipc = enterpriseRouteIpc(t, INITIAL);
  const r = await renderer(t, ipc);
  await r.loadRouteFacts(globalThis.window.electronAPI, ["enterprise"]);
  const current = await ipc.invoke("get-enterprise-route-state");
  const inconsistent = { ...current, facts: { ...current.facts, bedrockProfile: true } };
  ipc.deliver(inconsistent);
  assert.equal(r.useRouteFactsStore.getState().facts.enterpriseMain.bedrockProfile, false);
  await r.loadRouteFacts({ getEnterpriseRouteState: async () => inconsistent }, ["enterprise"]);
  assert.equal(r.useRouteFactsStore.getState().facts.enterpriseMain.bedrockProfile, false);
});

test("change-driving N2: a draft created between atomic reconciliation and fact publication cannot regain readiness", async (t) => {
  const ipc = enterpriseRouteIpc(t, INITIAL);
  const r = await renderer(t, ipc);
  r.useSettingsStore.setState({ azureEndpoint: "https://stale.openai.azure.com/openai" });
  const held = deferred();
  globalThis.window.electronAPI.saveAzureEndpoint = () => held.promise;
  let scheduled = false;
  const unsubscribe = r.useSettingsStore.subscribe(() => {
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() =>
        r.useSettingsStore
          .getState()
          .setAzureEndpoint("https://newer-draft.openai.azure.com/openai")
      );
    }
  });
  await r.loadRouteFacts(globalThis.window.electronAPI, ["enterprise"]);
  unsubscribe();
  assert.equal(
    r.useSettingsStore.getState().azureEndpoint,
    "https://newer-draft.openai.azure.com/openai"
  );
  assert.equal(
    r.useRouteFactsStore.getState().facts.enterpriseMain,
    null,
    "final async fact admission must check raw/canonical agreement again"
  );
  held.resolve({ success: false });
  await tick();
});
