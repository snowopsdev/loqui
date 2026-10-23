const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("./rendererTestHarness");
const { routeBaseState } = require("./routeStateFixture");
const { fakePrivacy, unverifiedAttestation, tick } = require("../hooks/fakePrivacy");

// Plan 07 Task 13 (spec §5.1 "Native availability", A13, A14): the real
// settings builder → native projection → pure graph → pre-flight, together.
// 07a: no built-in engine is available while sealed, on any platform.

const FACTS = Object.freeze({
  installed: {
    whisper: new Set(["base"]),
    sherpa: new Set(["parakeet-unified-en-0.6b"]),
    llm: new Set(["qwen3.5-2b-q4_k_m"]),
  },
  sherpaSupported: true,
  credentials: new Map([["openai", true]]),
  credentialFields: new Map([["openai", { key: true }]]),
  enterpriseRecipients: {
    azure: { status: "unknown" },
    bedrock: { status: "unknown" },
    vertex: { status: "unknown" },
  },
  enterpriseMain: {
    bedrockEndpoint: { set: false, host: null },
    bedrockProfile: false,
    vertexApiKeyEnv: false,
    vertexProjectEnv: false,
  },
  rejected: new Set(),
  speakerIdModelsReady: true,
  searchModelReady: true,
});

async function load(t, privacy = fakePrivacy({ pending: true }).api) {
  installBrowserGlobals(t, { window: { electronAPI: { privacy } } });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-native-route-test-" });
  const routes = await vite.ssrLoadModule("/lib/routes.ts");
  const native = await vite.ssrLoadModule("/lib/nativeRouteAvailability.ts");
  const preflight = await vite.ssrLoadModule("/lib/sealedMode.ts");
  const store = await vite.ssrLoadModule("/stores/sealedStore.ts");
  const facts = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  const readiness = await vite.ssrLoadModule("/utils/onboardingReadiness.ts");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  facts.useRouteFactsStore.setState({ facts: FACTS });
  const base = {
    ...useSettingsStore.getState(),
    ...routeBaseState(),
    speakerDiarizationEnabled: true,
  };
  const copy = routes.routeCopy((key) => key, "en");
  return { routes, native, preflight, store, readiness, base, copy };
}

const sealedOf = (attestation = unverifiedAttestation()) => ({ sealed: true, attestation });

test("all eleven routes: which need Loqui's own engines, from the executor table", async (t) => {
  const { routes, base, copy } = await load(t);
  const s = routes.buildRouteSnapshot(base, FACTS, copy, false);
  const table = Object.fromEntries(
    routes.ROUTE_IDS.map((id) => [id, [...routes.nativeEngineRequirements(s, id)]])
  );
  assert.deepEqual(table, {
    dictationStt: ["whisper-server"],
    noteRecordingStt: ["whisper-server"],
    uploadStt: ["whisper-server", "ffmpeg"],
    dictationCleanup: ["llama-server"],
    voiceAssistant: ["llama-server"],
    assistantVision: ["llama-server"],
    translation: ["llama-server"],
    noteFormatting: ["llama-server"],
    chat: ["llama-server"],
    speakerId: ["sherpa-onnx-diarize", "onnx-worker"],
    semanticSearch: ["onnx-worker", "qdrant"],
  });
  const parakeet = routes.buildRouteSnapshot(
    { ...base, localTranscriptionProvider: "nvidia", parakeetModel: "parakeet-unified-en-0.6b" },
    FACTS,
    copy,
    false
  );
  assert.deepEqual([...routes.nativeEngineRequirements(parakeet, "dictationStt")], ["sherpa-onnx"]);
  const remote = routes.buildRouteSnapshot(
    { ...base, transcriptionMode: "providers", useLocalWhisper: false },
    FACTS,
    copy,
    false
  );
  assert.deepEqual(
    [...routes.nativeEngineRequirements(remote, "dictationStt")],
    [],
    "no engine of Loqui's"
  );
});

test("sealed with main's real 07a attestation: every built-in engine route is unknown, never ready", async (t) => {
  const { routes, native, base, copy } = await load(t);
  const plain = routes.buildRouteSnapshot(base, FACTS, copy, true);
  const projected = routes.buildRouteSnapshot(base, FACTS, copy, true, unverifiedAttestation());
  const availability = native.nativeRouteAvailability(plain, unverifiedAttestation());
  for (const id of routes.ROUTE_IDS) {
    assert.deepEqual(availability[id], { status: "unknown", reason: "isolation" }, id);
    for (const s of [plain, projected]) {
      const route = routes.resolveRoute(s, id);
      assert.equal(route.locality, "device", `${id} stays on the device`);
      assert.deepEqual(route.state, { status: "unknown" }, id);
    }
  }
  const open = routes.resolveRoutes(routes.buildRouteSnapshot(base, FACTS, copy, false, null));
  assert.deepEqual(
    open.map((r) => r.state.status),
    routes.ROUTE_IDS.map(() => "ready"),
    "unsealed, the overlay does nothing"
  );
});

test("no attestation, an empty child list or a forged 'available' claim never makes an engine ready", async (t) => {
  const { routes, native, base, copy } = await load(t);
  const plain = routes.buildRouteSnapshot(base, FACTS, copy, true);
  for (const attestation of [
    null,
    unverifiedAttestation({ children: [], networkChildren: [] }),
    { ...unverifiedAttestation(), isolation: { selfTest: "passed", mechanism: "sandbox" } },
  ]) {
    const projected = native.withNativeRouteAvailability(plain, attestation);
    assert.equal(projected.facts === plain.facts, false, "the input facts are not mutated");
    assert.equal(plain.facts.nativeAvailability, undefined);
    assert.deepEqual(routes.resolveRoute(projected, "dictationStt").state, { status: "unknown" });
  }
  // Only main's verified availability could pass the overlay (07b). The graph
  // itself honours it; 07a's projection can never produce it.
  const hypothetical = {
    ...plain,
    facts: { ...plain.facts, nativeAvailability: { dictationStt: { status: "available" } } },
  };
  assert.deepEqual(routes.resolveRoute(hypothetical, "dictationStt").state, { status: "ready" });
  const notRequiredClaim = {
    ...plain,
    facts: { ...plain.facts, nativeAvailability: { dictationStt: { status: "notRequired" } } },
  };
  assert.deepEqual(
    routes.resolveRoute(notRequiredClaim, "dictationStt").state,
    { status: "unknown" },
    "a built-in requirement is satisfied only by 'available'"
  );
});

test("a user-configured 127.0.0.2 endpoint keeps its host:port and needs no engine of Loqui's", async (t) => {
  const { routes, preflight, base, copy } = await load(t);
  const settings = {
    ...base,
    transcriptionMode: "self-hosted",
    useLocalWhisper: false,
    remoteTranscriptionUrl: "http://127.0.0.2:8178",
  };
  const s = routes.buildRouteSnapshot(settings, FACTS, copy, true, unverifiedAttestation());
  const route = routes.resolveRoute(s, "dictationStt");
  assert.equal(route.host, "127.0.0.2:8178", "host plus port, as the graph publishes it");
  assert.equal(route.locality, "device");
  assert.deepEqual(
    route.state,
    { status: "ready" },
    "sealed, still ready: no Loqui child involved"
  );
  assert.deepEqual([...routes.nativeEngineRequirements(s, "dictationStt")], []);
  assert.equal(preflight.isDictationNativeUnavailable(settings, sealedOf()), false);
  assert.equal(preflight.isDictationSealed(settings, true), false);
  const builtin = routes.resolveRoute(
    routes.buildRouteSnapshot(base, FACTS, copy, true, unverifiedAttestation()),
    "dictationStt"
  );
  assert.equal(builtin.host, null, "the built-in engine has no configured host");
});

test("A13: rule 10's needsUrl keeps precedence while every valid non-device route is sealed", async (t) => {
  const { routes, preflight, base, copy } = await load(t);
  const selfHosted = (url) => ({
    ...base,
    transcriptionMode: "self-hosted",
    useLocalWhisper: false,
    remoteTranscriptionUrl: url,
  });
  const cases = [
    [
      "http://llm.localhost:8178",
      { status: "needsUrl" },
      "plain-HTTP *.localhost is refused by the executor",
    ],
    ["not a url", { status: "needsUrl" }, "malformed"],
    [
      "http://192.168.1.20:8178",
      { status: "unreachable", detail: "sealed" },
      "a LAN server is another machine",
    ],
    ["https://stt.example.com", { status: "unreachable", detail: "sealed" }, "remote"],
  ];
  for (const [url, expected, why] of cases) {
    const settings = selfHosted(url);
    const sealed = routes.resolveRoute(
      routes.buildRouteSnapshot(settings, FACTS, copy, true, null),
      "dictationStt"
    );
    assert.deepEqual(sealed.state, expected, why);
    assert.notEqual(sealed.locality, "device", `${why}: never device`);
    assert.equal(
      preflight.isDictationSealed(settings, true),
      expected.status === "unreachable",
      why
    );
  }
  const unknownRemote = routes.resolveRoute(
    routes.buildRouteSnapshot(
      { ...base, transcriptionMode: "providers", useLocalWhisper: false },
      { ...FACTS, credentials: null },
      copy,
      true,
      null
    ),
    "dictationStt"
  );
  assert.deepEqual(
    unknownRemote.state,
    { status: "unreachable", detail: "sealed" },
    "sealed wins over unknown"
  );
  const off = routes.resolveRoute(
    routes.buildRouteSnapshot({ ...base, useCleanupModel: false }, FACTS, copy, true, null),
    "dictationCleanup"
  );
  assert.deepEqual(off.state, { status: "off" }, "off keeps its precedence");
});

test("pre-flight: remote is sealed; built-in local is unavailable; unknown seal blocks nothing", async (t) => {
  const { preflight, base } = await load(t);
  const remote = { ...base, transcriptionMode: "providers", useLocalWhisper: false };
  assert.equal(preflight.isDictationSealed(remote, true), true);
  assert.equal(preflight.isDictationSealed(remote, false), false);
  assert.equal(preflight.isDictationSealed(remote, null), false, "unknown claims nothing");
  assert.equal(
    preflight.isDictationNativeUnavailable(remote, sealedOf()),
    false,
    "a remote route is isDictationSealed's case"
  );
  assert.equal(preflight.isDictationSealed(base, true), false);
  assert.equal(preflight.isDictationNativeUnavailable(base, sealedOf()), true);
  assert.equal(
    preflight.isDictationNativeUnavailable(base, sealedOf(null)),
    true,
    "missing coverage is unknown"
  );
  assert.equal(
    preflight.isDictationNativeUnavailable(base, { sealed: null, attestation: null }),
    false
  );
  assert.equal(
    preflight.isDictationNativeUnavailable(base, { sealed: false, attestation: null }),
    false
  );
  assert.equal(
    preflight.isDictationPausedNative(base, sealedOf()),
    false,
    "07a acknowledges no pause"
  );
});

test("one event from main reaches the store, Ready/card state, note actions and the pre-flight together", async (t) => {
  const fake = fakePrivacy({ sealed: false });
  const { routes, preflight, store, readiness, base } = await load(t, fake.api);
  store.ensureSealedSubscribed();
  await tick();
  const remote = { ...base, transcriptionMode: "providers", useLocalWhisper: false };
  const view = (settings) => {
    const route = routes.resolveRoute(routes.routeSnapshotFromSettings(settings), "dictationStt");
    const note = routes.resolveRoute(
      routes.routeSnapshotFromSettings(settings),
      "noteRecordingStt"
    );
    const snap = store.getSealedSnapshot();
    return {
      state: route.state,
      note: readiness.noteActionState({ route: note, microphone: "granted" }).status,
      sealedBlocks: preflight.isDictationSealed(settings, snap.sealed),
      nativeBlocks: preflight.isDictationNativeUnavailable(settings, snap),
    };
  };
  assert.deepEqual(view(base), {
    state: { status: "ready" },
    note: "ready",
    sealedBlocks: false,
    nativeBlocks: false,
  });
  assert.deepEqual(view(remote).state, { status: "ready" });

  fake.listeners.sealed(true);
  fake.listeners.attestation(unverifiedAttestation({ version: 2 }));
  assert.deepEqual(
    store.useSealedStore.getState(),
    { sealed: true, known: true },
    "Plan 03's consumers read this"
  );
  assert.deepEqual(view(base), {
    state: { status: "unknown" },
    note: "checking",
    sealedBlocks: false,
    nativeBlocks: true,
  });
  assert.deepEqual(view(remote), {
    state: { status: "unreachable", detail: "sealed" },
    note: "checking", // note recording stays on the local engine in this fixture
    sealedBlocks: true,
    nativeBlocks: false,
  });

  fake.listeners.sealed(false);
  assert.deepEqual(view(base), {
    state: { status: "ready" },
    note: "ready",
    sealedBlocks: false,
    nativeBlocks: false,
  });
});

test("unknown seal: null for claims, false for route snapshots, and no block", async (t) => {
  const { routes, preflight, store, base } = await load(t, fakePrivacy({ pending: true }).api);
  store.ensureSealedSubscribed();
  await tick();
  const remote = { ...base, transcriptionMode: "providers", useLocalWhisper: false };
  assert.equal(store.getSealedSnapshot().sealed, null);
  assert.equal(routes.routeSnapshotFromSettings(remote).sealed, false);
  assert.equal(preflight.isDictationSealed(remote, store.getSealedSnapshot().sealed), false);
  assert.equal(preflight.isDictationNativeUnavailable(base, store.getSealedSnapshot()), false);
});

test("sealedMode.ts defines no sealed rule of its own", async (t) => {
  const { preflight } = await load(t);
  assert.deepEqual(Object.keys(preflight).sort(), [
    "isDictationNativeUnavailable",
    "isDictationPausedNative",
    "isDictationSealed",
  ]);
});
