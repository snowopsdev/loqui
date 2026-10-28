const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("./rendererTestHarness");
const { routeBaseState } = require("./routeStateFixture");
const { fakePrivacy, unverifiedAttestation, tick } = require("../hooks/fakePrivacy");

// Plan 07 Task 13 (spec §5.1 "Native availability", A13, A14): the real
// settings builder → native projection → pure graph → pre-flight, together.
// 07a: no built-in engine is available while sealed, on any platform. Main's
// attestation says so positively (fix round 1, I1): such a route is
// unreachable/nativeUnavailable, and only a missing or stale claim is unknown.

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
  return { routes, native, preflight, store, readiness, base, copy, vite };
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

const NATIVE_UNAVAILABLE = Object.freeze({ status: "unreachable", detail: "nativeUnavailable" });

// Fix round 1, I1: main's 07a attestation positively says that local engines
// can't run while sealed on this build. That is a distinct, settled state,
// not a check in progress. "Checking…" is only for a missing or stale claim.
test("sealed with main's real 07a attestation: every built-in engine route is attested unavailable, never ready", async (t) => {
  const { routes, native, base, copy } = await load(t);
  const plain = routes.buildRouteSnapshot(base, FACTS, copy, true);
  const projected = routes.buildRouteSnapshot(base, FACTS, copy, true, unverifiedAttestation());
  const availability = native.nativeRouteAvailability(plain, unverifiedAttestation());
  for (const id of routes.ROUTE_IDS) {
    assert.deepEqual(availability[id], { status: "unavailable", reason: "isolation" }, id);
    const route = routes.resolveRoute(projected, id);
    assert.equal(route.locality, "device", `${id} stays on the device`);
    assert.deepEqual(route.state, NATIVE_UNAVAILABLE, id);
    // Plan 03's four-argument builder projects nothing: no claim, so unknown.
    assert.deepEqual(routes.resolveRoute(plain, id).state, { status: "unknown" }, id);
  }
  const open = routes.resolveRoutes(routes.buildRouteSnapshot(base, FACTS, copy, false, null));
  assert.deepEqual(
    open.map((r) => r.state.status),
    routes.ROUTE_IDS.map(() => "ready"),
    "unsealed, the overlay does nothing"
  );
  const openWithClaim = routes.resolveRoutes(
    routes.buildRouteSnapshot(base, FACTS, copy, false, unverifiedAttestation({ sealed: false }))
  );
  assert.deepEqual(
    openWithClaim.map((r) => r.state.status),
    routes.ROUTE_IDS.map(() => "ready"),
    "the overlay applies only while the seal is known active"
  );
});

test("no attestation, a stale one, an empty child list or a forged 'available' claim never makes an engine ready", async (t) => {
  const { routes, native, base, copy } = await load(t);
  const plain = routes.buildRouteSnapshot(base, FACTS, copy, true);
  const cases = [
    [null, { status: "unknown" }, "no claim: Checking…"],
    [
      unverifiedAttestation({ at: Date.now() - 31_000 }),
      { status: "unknown" },
      "a stale claim is no claim",
    ],
    [
      unverifiedAttestation({ at: Date.now() + 31_000 }),
      { status: "unknown" },
      "a claim from the future is no claim",
    ],
    [
      unverifiedAttestation({ children: [], networkChildren: [] }),
      NATIVE_UNAVAILABLE,
      "an empty child list is not availability",
    ],
    [
      { ...unverifiedAttestation(), isolation: { selfTest: "passed", mechanism: "sandbox" } },
      NATIVE_UNAVAILABLE,
      "a forged self-test cannot override main's boundary diagnostic",
    ],
    [
      {
        ...unverifiedAttestation(),
        isolation: { selfTest: "passed", mechanism: "sandbox" },
        childDiagnostics: { nativeBoundaryUnavailable: false, unresolved: [] },
      },
      { status: "unknown" },
      "no positive unavailability and no verified availability: unknown, never ready",
    ],
  ];
  for (const [attestation, expected, why] of cases) {
    const projected = native.withNativeRouteAvailability(plain, attestation);
    assert.equal(projected.facts === plain.facts, false, "the input facts are not mutated");
    assert.equal(plain.facts.nativeAvailability, undefined);
    assert.deepEqual(routes.resolveRoute(projected, "dictationStt").state, expected, why);
    for (const id of routes.ROUTE_IDS)
      assert.notEqual(routes.resolveRoute(projected, id).state.status, "ready", `${why}: ${id}`);
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
  // The attested state replaces readiness that is ready or still unknown; a
  // missing model stays the missing model, and off keeps its precedence.
  const whisperUnknown = { ...FACTS, installed: { ...FACTS.installed, whisper: null } };
  assert.deepEqual(
    routes.resolveRoute(routes.buildRouteSnapshot(base, whisperUnknown, copy, true), "dictationStt")
      .state,
    { status: "unknown" },
    "fixture: whisper inventory not yet known"
  );
  const unknownFacts = routes.buildRouteSnapshot(
    base,
    whisperUnknown,
    copy,
    true,
    unverifiedAttestation()
  );
  assert.deepEqual(routes.resolveRoute(unknownFacts, "dictationStt").state, NATIVE_UNAVAILABLE);
  const off = routes.buildRouteSnapshot(
    { ...base, useCleanupModel: false },
    FACTS,
    copy,
    true,
    unverifiedAttestation()
  );
  assert.deepEqual(routes.resolveRoute(off, "dictationCleanup").state, { status: "off" });
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
  assert.equal(preflight.isDictationNativeAttestedUnavailable(base, sealedOf()), true);
  assert.equal(
    preflight.isDictationNativeUnavailable(base, sealedOf(null)),
    true,
    "missing coverage still never starts the engine"
  );
  assert.equal(
    preflight.isDictationNativeAttestedUnavailable(base, sealedOf(null)),
    false,
    "but it is not main's claim about this build"
  );
  assert.equal(preflight.isDictationNativeAttestedUnavailable(remote, sealedOf()), false);
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

test("one event from main reaches the store, Ready/card state, note actions, the Notes hint and the pre-flight together", async (t) => {
  const fake = fakePrivacy({ sealed: false });
  const { routes, preflight, store, readiness, base, vite } = await load(t, fake.api);
  const { routeStateLabel } = await vite.ssrLoadModule(
    "/components/settings/routing/RouteChips.tsx"
  );
  const { notesActionsHint } = await vite.ssrLoadModule(
    "/components/notes/notesActionsHintModel.ts"
  );
  store.ensureSealedSubscribed();
  await tick();
  const remote = { ...base, transcriptionMode: "providers", useLocalWhisper: false };
  const label = (key) => key;
  const view = (settings) => {
    const snapshot = routes.routeSnapshotFromSettings(settings);
    const route = routes.resolveRoute(snapshot, "dictationStt");
    const note = routes.resolveRoute(snapshot, "noteRecordingStt");
    const formatting = routes.resolveRoute(snapshot, "noteFormatting");
    const action = readiness.noteActionState({ route: note, microphone: "granted" });
    const speech = readiness.summarizeReadiness({
      speechRoute: route,
      noteRoute: note,
      localVoiceActive: true,
      voiceDownload: "ready",
      microphone: "granted",
      micHeard: true,
      trialSucceeded: true,
      platform: "linux",
      accessibilityGranted: true,
      shortcutProven: true,
      shortcutLabel: "fn",
      activationMode: "tap",
      cleanupChoice: "none",
      cleanupStatus: "skipped",
      cleanupRoute: routes.resolveRoute(snapshot, "dictationCleanup"),
      cleanupProviderLabel: "OpenAI",
    }).rows[0];
    const snap = store.getSealedSnapshot();
    return {
      state: route.state,
      card: routeStateLabel(route.state, label),
      ready: [speech.status, speech.detail],
      note: [action.status, action.block],
      notesHint: notesActionsHint(formatting.state, false)?.titleKey ?? null,
      sealedBlocks: preflight.isDictationSealed(settings, snap.sealed),
      nativeBlocks: preflight.isDictationNativeUnavailable(settings, snap),
      attested: preflight.isDictationNativeAttestedUnavailable(settings, snap),
    };
  };
  assert.deepEqual(view(base), {
    state: { status: "ready" },
    card: "routes.state.ready",
    ready: ["ready", "speech.proven"],
    note: ["ready", null],
    notesHint: null,
    sealedBlocks: false,
    nativeBlocks: false,
    attested: false,
  });
  assert.deepEqual(view(remote).state, { status: "ready" });

  fake.listeners.sealed(true);
  fake.listeners.attestation(unverifiedAttestation({ version: 2 }));
  assert.deepEqual(
    store.useSealedStore.getState(),
    { sealed: true, known: true },
    "Plan 03's consumers read this"
  );
  const attested = {
    state: NATIVE_UNAVAILABLE,
    card: "routes.state.nativeUnavailable",
    ready: ["pending", "speech.nativeUnavailable"],
    note: ["blocked", "nativeUnavailable"],
    notesHint: "notes.actionsModelHint.nativeUnavailable",
    sealedBlocks: false,
    nativeBlocks: true,
    attested: true,
  };
  assert.deepEqual(view(base), attested, "every surface reads main's settled answer");
  assert.deepEqual(view(remote), {
    ...attested,
    state: { status: "unreachable", detail: "sealed" },
    card: "routes.state.sealed",
    ready: ["pending", "speech.unavailable"],
    sealedBlocks: true,
    nativeBlocks: false,
    attested: false,
  });

  // A stale claim is dropped; the refetch answers with an older version, which
  // never wins. With no claim, every surface says Checking… together, and the
  // engine still does not start.
  fake.listeners.attestation(unverifiedAttestation({ version: 9, at: Date.now() - 60_000 }));
  await tick();
  assert.equal(store.getSealedSnapshot().attestation, null);
  assert.deepEqual(view(base), {
    state: { status: "unknown" },
    card: "routes.state.checking",
    ready: ["pending", "speech.checking"],
    note: ["checking", null],
    notesHint: null,
    sealedBlocks: false,
    nativeBlocks: true,
    attested: false,
  });

  fake.listeners.sealed(false);
  assert.deepEqual(view(base), {
    state: { status: "ready" },
    card: "routes.state.ready",
    ready: ["ready", "speech.proven"],
    note: ["ready", null],
    notesHint: null,
    sealedBlocks: false,
    nativeBlocks: false,
    attested: false,
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
    "isDictationNativeAttestedUnavailable",
    "isDictationNativeUnavailable",
    "isDictationPausedNative",
    "isDictationSealed",
  ]);
});

// Task 13 fix round 2, N1: the store renews main's claim before it expires, so
// the settled card never flips to "Checking…" and back every 30 s (focus loss
// on Home's "Set up", the Notes hint remounting, live regions announcing).
test("N1: while sealed and renewed on schedule, the card stays 'Unavailable in Sealed mode' throughout", async (t) => {
  const fake = fakePrivacy({ sealed: true });
  const { routes, store, base, vite } = await load(t, fake.api);
  const { routeStateLabel } = await vite.ssrLoadModule(
    "/components/settings/routing/RouteChips.tsx"
  );
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  t.after(() => t.mock.timers.reset());
  let version = 0;
  fake.api.getAttestation = async () =>
    unverifiedAttestation({ version: ++version, at: Date.now() });
  const card = () =>
    routeStateLabel(
      routes.resolveRoute(routes.routeSnapshotFromSettings(base), "dictationStt").state,
      (key) => key
    );
  const cards = [];
  store.subscribeSealed(() => cards.push(card()));
  await tick();
  assert.equal(card(), "routes.state.nativeUnavailable");
  for (let second = 1; second <= 100; second++) {
    t.mock.timers.tick(1000);
    await tick();
    assert.equal(card(), "routes.state.nativeUnavailable", `at +${second} s`);
  }
  const settled = cards.slice(cards.indexOf("routes.state.nativeUnavailable"));
  assert.deepEqual(
    [...new Set(settled)],
    ["routes.state.nativeUnavailable"],
    "no Checking… is ever published between two fresh claims"
  );
  assert.ok(version >= 5, `renewed across several boundaries (${version} claims)`);
  t.mock.timers.reset();
});
