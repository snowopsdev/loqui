const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");
const {
  MIGRATED_STORAGE,
  QWEN,
  TEST_COPY,
  routeBaseState,
  testFacts,
} = require("../lib/routeStateFixture");

test("change-driving: route draft store", { timeout: 15000 }, async (t) => {
  // Main's acknowledgement of a key save is held until the test releases it.
  // Task 2's ack-based setter reaches main through one of these channels.
  const pendingSaves = [];
  // Order of the IPC traffic that matters for I3: "save" (sent), "ack" (main
  // answered), "list" (presence read back).
  const log = [];
  const ack = () => {
    log.push("save");
    return new Promise((resolve) => pendingSaves.push(resolve));
  };
  // What main's credentials.list reports. Empty by default, so a list read
  // leaves the facts each test sets untouched (Task 3 merges rows).
  const mainPresence = new Map();
  let listGeneration = 0;
  // R2-8: while holdLists is on, each presence read waits until the test
  // releases it, so a request's fact wait can be held and resolved out of order.
  let holdLists = false;
  const heldLists = [];
  const listCredentials = async () => {
    log.push("list");
    if (holdLists) await new Promise((resolve) => heldLists.push(resolve));
    return [...mainPresence].map(([id, present]) => ({
      id,
      present,
      generation: ++listGeneration,
    }));
  };
  let llamaStops = 0;
  const screenContextCalls = [];
  // Renderer contract fixture, not proof of main admission (production IPC cases below).
  // Task 6's main transaction is the only enterprise writer. The fake keeps
  // the committed five-field tuple and can hold ACKs to exercise route-queue
  // admission and the order between different routes.
  const enterpriseTuple = (state) => ({
    bedrockRegion: state.bedrockRegion || "us-east-1",
    azureEndpoint: state.azureEndpoint || "",
    vertexProject: state.vertexProject || "",
    vertexLocation: state.vertexLocation || "us-central1",
    vertexAuthSource: state.vertexAuthSource,
  });
  let mainEnterprise = enterpriseTuple(routeBaseState());
  let enterpriseVersion = 0;
  const enterpriseListeners = new Set();
  const enterpriseState = () => ({
    current: { ...mainEnterprise },
    version: enterpriseVersion,
    facts: testFacts().enterpriseMain,
  });
  let holdEnterpriseWrites = false;
  const enterpriseWrites = [];
  const pendingEnterpriseWrites = [];
  const saveEnterpriseRoutePatch = (input) => {
    enterpriseWrites.push(input);
    const expected = input.expected;
    if (Object.keys(mainEnterprise).some((key) => expected[key] !== mainEnterprise[key])) {
      return Promise.resolve({
        success: false,
        conflict: true,
        current: { ...mainEnterprise },
        version: enterpriseVersion,
      });
    }
    return new Promise((resolve) => {
      const finish = () => {
        mainEnterprise = { ...mainEnterprise, ...input.patch };
        enterpriseVersion++;
        for (const listener of enterpriseListeners) listener(enterpriseState());
        // The real save ACK deliberately has no facts.
        resolve({ success: true, current: { ...mainEnterprise }, version: enterpriseVersion });
      };
      if (holdEnterpriseWrites) pendingEnterpriseWrites.push(finish);
      else finish();
    });
  };
  installBrowserGlobals(t, {
    initialStorage: MIGRATED_STORAGE,
    window: {
      dispatchEvent: () => true,
      electronAPI: {
        credentials: { save: () => ack(), list: listCredentials, onChanged: () => () => {} },
        saveOpenAIKey: () => ack(),
        llamaServerStop: async () => {
          llamaStops++;
          return { success: true };
        },
        setScreenContextEnabled: async (enabled) => {
          screenContextCalls.push(enabled);
          return { success: true };
        },
        saveEnterpriseRoutePatch,
        getEnterpriseRouteState: async () => enterpriseState(),
        onEnterpriseRouteChanged: (listener) => {
          enterpriseListeners.add(listener);
          return () => enterpriseListeners.delete(listener);
        },
      },
    },
  });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-route-draft-test-" });
  const { useSettingsStore, reconcileEnterpriseRouteState } = await vite.ssrLoadModule(
    "/stores/settingsStore.ts"
  );
  const { useRouteFactsStore, refreshRouteFacts } = await vite.ssrLoadModule(
    "/stores/routeFactsStore.ts"
  );
  await refreshRouteFacts(["enterprise"]);
  const { useSealedStore } = await vite.ssrLoadModule("/stores/sealedStore.ts");
  const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");

  const live = () => useSettingsStore.getState();
  const draft = () => drafts.useRouteDraftStore.getState().draft;
  const stage = (d) => drafts.useRouteDraftStore.getState().stage(d);
  const setFacts = (o) => useRouteFactsStore.setState({ facts: testFacts(o) });
  const request = (id, target) => drafts.requestRouteChange(id, target, TEST_COPY);
  const patch = (id, p) => drafts.requestRoutePatch(id, p, TEST_COPY);
  const apply = () => drafts.applyDraft(TEST_COPY);
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const releaseSaves = () => {
    if (pendingSaves.length) log.push("ack");
    while (pendingSaves.length) pendingSaves.shift()({ ok: true, success: true, generation: 1 });
  };
  const releaseEnterpriseWrite = () => {
    const finish = pendingEnterpriseWrites.shift();
    assert.ok(finish, "an enterprise transaction is awaiting ACK");
    finish();
  };
  // Resolves held presence reads in the given order (indexes into heldLists).
  const releaseLists = async (...order) => {
    const held = [...heldLists];
    heldLists.length = 0;
    for (const index of order) {
      held[index]();
      await tick();
    }
  };
  const reset = (overrides = {}) => {
    holdLists = false;
    heldLists.length = 0;
    holdEnterpriseWrites = false;
    pendingEnterpriseWrites.length = 0;
    enterpriseWrites.length = 0;
    mainPresence.clear();
    useSettingsStore.setState({ ...routeBaseState(), ...overrides });
    mainEnterprise = enterpriseTuple(useSettingsStore.getState());
    enterpriseVersion++;
    reconcileEnterpriseRouteState(enterpriseState());
    drafts.useRouteDraftStore.getState().discard();
    useSealedStore.setState({ sealed: false, known: true });
    setFacts();
  };

  const OPENAI_CHAT = {
    chatAgentMode: "providers",
    chatAgentProvider: "openai",
    chatAgentModel: "gpt-6-astra",
  };
  const LOOPBACK_CHAT = {
    chatAgentMode: "providers",
    chatAgentProvider: "custom",
    chatAgentModel: "m",
    chatAgentCloudBaseUrl: "http://localhost:1234/v1",
  };

  // Change-driving (I1): v1 staged every non-"local" target, so a loopback endpoint waited for Apply.
  await t.test(
    "change-driving: local → loopback endpoint applies instantly, and Undo restores the local model",
    async () => {
      reset();
      const out = await request("chat", {
        mode: "providers",
        provider: "custom",
        baseUrl: "http://localhost:1234/v1",
        model: "m",
      });
      assert.equal(out.applied, true);
      assert.equal(out.blocker, null);
      assert.equal(out.plan.kind, "instant");
      assert.equal(live().chatAgentProvider, "custom");
      assert.equal(live().chatAgentCloudBaseUrl, "http://localhost:1234/v1");
      assert.equal(draft(), null);
      const back = await out.undo();
      assert.equal(back.applied, true);
      assert.equal(live().chatAgentMode, "local");
      assert.equal(live().chatAgentProvider, "qwen");
      assert.equal(live().chatAgentModel, QWEN);
    }
  );

  // Change-driving (I1): a loopback route is on the device, so v1's mode test missed that this adds a recipient.
  await t.test(
    "change-driving: loopback → remote endpoint is staged and writes nothing",
    async () => {
      reset(LOOPBACK_CHAT);
      const target = {
        mode: "providers",
        provider: "custom",
        baseUrl: "https://llm.example.com/v1",
      };
      assert.equal(await request("chat", target), "staged");
      assert.deepEqual(draft(), { routeId: "chat", kind: "target", target });
      assert.equal(live().chatAgentCloudBaseUrl, "http://localhost:1234/v1");
    }
  );

  // Change-driving (I1): v1 applied lateral provider and endpoint changes immediately.
  await t.test(
    "change-driving: changing an active remote endpoint or provider is staged",
    async () => {
      reset({
        translationMode: "self-hosted",
        translationRemoteUrl: "http://192.168.1.20:11434/v1",
        translationModel: "llama3",
      });
      assert.equal(
        await request("translation", {
          mode: "self-hosted",
          remoteUrl: "http://192.168.1.30:11434/v1",
        }),
        "staged"
      );
      assert.equal(live().translationRemoteUrl, "http://192.168.1.20:11434/v1");
      reset(OPENAI_CHAT);
      assert.equal(await request("chat", { mode: "providers", provider: "anthropic" }), "staged");
      assert.equal(live().chatAgentProvider, "openai");
    }
  );

  // Change-driving: no draft store exists yet; a same-recipient model change adds no recipient or payload.
  await t.test(
    "change-driving: a model-only change at the same provider applies instantly and undoes instantly",
    async () => {
      reset(OPENAI_CHAT);
      const out = await request("chat", {
        mode: "providers",
        provider: "openai",
        model: "gpt-5.6-sol",
      });
      assert.equal(out.applied, true);
      assert.equal(live().chatAgentModel, "gpt-5.6-sol");
      assert.equal((await out.undo()).applied, true);
      assert.equal(live().chatAgentModel, "gpt-6-astra");
    }
  );

  // Change-driving (I5, I1): Undo of a move off a provider must not re-send data without review.
  await t.test(
    "change-driving: Undo of a move off a provider stages the provider, and Apply restores it exactly",
    async () => {
      reset(OPENAI_CHAT);
      const out = await request("chat", { mode: "local", provider: "qwen", model: QWEN });
      assert.equal(out.applied, true);
      assert.equal(live().chatAgentMode, "local");
      assert.equal(await out.undo(), "staged");
      assert.deepEqual(draft(), { routeId: "chat", kind: "patch", patch: out.plan.undoPatch });
      assert.equal(live().chatAgentMode, "local", "Undo applied nothing remote");
      const applied = await apply();
      assert.equal(applied.applied, true);
      assert.equal(live().chatAgentMode, "providers");
      assert.equal(live().chatAgentProvider, "openai");
      assert.equal(live().chatAgentModel, "gpt-6-astra");
      assert.equal(draft(), null);
    }
  );

  // Change-driving: same-route draft discard on no-op; other routes' drafts survive.
  await t.test(
    "change-driving: re-selecting the current destination is a no-op that drops only that route's draft",
    async () => {
      reset();
      stage({ routeId: "chat", kind: "target", target: { mode: "providers", provider: "groq" } });
      const out = await request("chat", { mode: "local" });
      assert.equal(out.applied, false);
      assert.equal(out.blocker, null);
      assert.equal(out.plan.kind, "noop");
      assert.equal(draft(), null);
      assert.equal(live().chatAgentProvider, "qwen", "nothing was cleared");
      const translation = {
        routeId: "translation",
        kind: "target",
        target: { mode: "providers", provider: "openai" },
      };
      stage(translation);
      await request("chat", { mode: "local" });
      assert.deepEqual(draft(), translation);
    }
  );

  await t.test(
    "change-driving: an instant change replaces its route's draft; staging replaces the single draft",
    async () => {
      reset();
      stage({
        routeId: "chat",
        kind: "target",
        target: { mode: "providers", provider: "anthropic" },
      });
      const out = await request("chat", {
        mode: "local",
        provider: "qwen",
        model: "qwen3.5-9b-q4_k_m",
      });
      assert.equal(out.applied, true);
      assert.equal(draft(), null);
      stage({
        routeId: "translation",
        kind: "target",
        target: { mode: "providers", provider: "openai" },
      });
      assert.equal(
        await request("dictationStt", { mode: "providers", provider: "groq" }),
        "staged"
      );
      assert.equal(draft().routeId, "dictationStt");
    }
  );

  // Change-driving (I1): Apply re-plans from live state at click time.
  await t.test(
    "change-driving: Apply refuses with a blocker and keeps the draft, then commits once ready",
    async () => {
      reset();
      setFacts({ credentials: new Map([["openai", false]]) });
      assert.equal(
        await request("dictationStt", { mode: "providers", provider: "openai" }),
        "staged"
      );
      const refused = await apply();
      assert.equal(refused.applied, false);
      assert.equal(refused.blocker, "needsKey");
      assert.ok(draft(), "a refused Apply keeps the draft");
      assert.equal(live().transcriptionMode, "local");
      setFacts();
      const ok = await apply();
      assert.equal(ok.applied, true);
      assert.equal(live().transcriptionMode, "providers");
      assert.equal(live().useLocalWhisper, false);
      assert.equal(live().cloudTranscriptionProvider, "openai");
      assert.equal(draft(), null);
    }
  );

  await t.test(
    "change-driving: Apply of a draft that the live state already satisfies is a no-op and clears it",
    async () => {
      reset();
      assert.equal(
        await request("dictationStt", { mode: "providers", provider: "groq" }),
        "staged"
      );
      await live().applyRoutePatch({
        transcriptionMode: "providers",
        useLocalWhisper: false,
        cloudTranscriptionProvider: "groq",
        cloudTranscriptionModel: "whisper-large-v3",
      });
      const out = await apply();
      assert.equal(out.applied, false);
      assert.equal(out.plan.kind, "noop");
      assert.equal(draft(), null);
    }
  );

  // Change-driving (I14): the facts store no longer carries sealed; only getSealed() does.
  await t.test("change-driving: sealed blocks Apply but never a move onto the device", async () => {
    reset(OPENAI_CHAT);
    assert.equal(await request("dictationStt", { mode: "providers", provider: "groq" }), "staged");
    useSealedStore.setState({ sealed: true, known: true });
    assert.equal(drafts.currentPlanContext(TEST_COPY).sealed, true);
    const blocked = await apply();
    assert.equal(blocked.blocker, "sealed");
    assert.ok(draft());
    const home = await request("chat", { mode: "local" });
    assert.equal(home.applied, true, "moving onto the device applies while sealed");
    useSealedStore.setState({ sealed: false, known: true });
    assert.equal((await apply()).applied, true);
  });

  // Change-driving (I3): without the flush, Apply would plan with the key still missing.
  await t.test("change-driving: Apply waits for pending key saves before planning", async () => {
    reset();
    setFacts({ credentials: new Map([["openai", false]]) });
    assert.equal(
      await request("dictationStt", { mode: "providers", provider: "openai" }),
      "staged"
    );
    live().setOpenaiApiKey("sk-test-0001");
    let settled = false;
    const pending = apply().then((outcome) => {
      settled = true;
      return outcome;
    });
    await tick();
    await tick();
    assert.equal(settled, false, "Apply is waiting for main to acknowledge the save");
    assert.ok(pendingSaves.length > 0, "the flush sent the save to main");
    setFacts(); // main confirmed presence (credentials-changed → facts refresh, Tasks 2–3)
    releaseSaves();
    const out = await pending;
    assert.equal(out.applied, true);
    assert.equal(live().cloudTranscriptionProvider, "openai");
  });

  // Change-driving (I3).
  await t.test("change-driving: requestRouteChange waits for pending key saves too", async () => {
    reset(OPENAI_CHAT);
    live().setOpenaiApiKey("sk-test-0002");
    let settled = false;
    const pending = request("chat", {
      mode: "providers",
      provider: "openai",
      model: "gpt-5.6-sol",
    }).then((o) => {
      settled = true;
      return o;
    });
    await tick();
    assert.equal(settled, false);
    assert.equal(live().chatAgentModel, "gpt-6-astra");
    releaseSaves();
    assert.equal((await pending).applied, true);
    assert.equal(live().chatAgentModel, "gpt-5.6-sol");
  });

  await t.test("change-driving: a draft discarded while saves finish is not applied", async () => {
    reset();
    assert.equal(await request("dictationStt", { mode: "providers", provider: "groq" }), "staged");
    live().setOpenaiApiKey("sk-test-0003");
    const pending = apply();
    await tick();
    drafts.useRouteDraftStore.getState().discard();
    releaseSaves();
    assert.equal(await pending, null);
    assert.equal(live().transcriptionMode, "local");
  });

  await t.test(
    "change-driving: withDraftDiscard drops the draft only when the modal closes",
    () => {
      reset();
      stage({ routeId: "chat", kind: "target", target: { mode: "providers", provider: "openai" } });
      const seen = [];
      const onOpenChange = drafts.withDraftDiscard((open) => seen.push(open));
      onOpenChange(true);
      assert.ok(draft());
      const epoch = drafts.useRouteDraftStore.getState().requestEpoch;
      onOpenChange(false);
      assert.equal(draft(), null);
      assert.ok(
        drafts.useRouteDraftStore.getState().requestEpoch > epoch,
        "closing ends the session (R2-8)"
      );
      assert.deepEqual(seen, [true, false]);
    }
  );

  await t.test(
    "change-driving: moving an LLM route to a server frees the local llama-server",
    async () => {
      reset();
      llamaStops = 0;
      const out = await request("chat", {
        mode: "self-hosted",
        remoteUrl: "http://127.0.0.1:11434/v1",
        model: "llama3",
      });
      assert.equal(out.applied, true, "a loopback server is on this device");
      assert.equal(llamaStops, 1);
    }
  );

  await t.test("change-driving: applyDraft with no draft does nothing", async () => {
    reset();
    assert.equal(await apply(), null);
  });

  // Change-driving (I3, I1 follow-up): flushSecretSaves waits only for main's ack.
  // Presence used to arrive later through credentials-changed, so the first Apply after
  // typing a key could still read "no key". No event reaches this window here.
  await t.test(
    "change-driving: planning reads main's credential presence after the save is acknowledged",
    async () => {
      reset();
      setFacts({ credentials: new Map([["openai", false]]) });
      assert.equal(
        await request("dictationStt", { mode: "providers", provider: "openai" }),
        "staged"
      );
      log.length = 0;
      live().setOpenaiApiKey("sk-test-0004");
      const pending = apply();
      await tick();
      mainPresence.set("openai", true); // main persisted the key
      releaseSaves();
      const out = await pending;
      assert.equal(out.applied, true, "Apply saw the saved key");
      assert.equal(live().cloudTranscriptionProvider, "openai");
      const acked = log.indexOf("ack");
      assert.ok(acked > 0, "the save was sent and acknowledged");
      assert.ok(log.lastIndexOf("list") > acked, "presence is read back after the ack");

      for (const call of [
        () => request("chat", { mode: "local" }),
        () => patch("chat", { "providerSearch:chatIntelligence": false }),
      ]) {
        log.length = 0;
        await call();
        assert.deepEqual(log, ["list"], "both request paths refresh presence before planning");
      }
    }
  );

  // Change-driving (I1 follow-up): requestRoutePatch does not exist; the editors' switches wrote the store.
  await t.test(
    "change-driving: requestRoutePatch: turning on a cloud route is staged; turning it off is instant",
    async () => {
      const cloudCleanup = {
        cleanupMode: "providers",
        cleanupProvider: "openai",
        cleanupModel: "gpt-6-astra",
      };
      reset({ ...cloudCleanup, useCleanupModel: false });
      assert.equal(await patch("dictationCleanup", { useCleanupModel: true }), "staged");
      assert.deepEqual(draft(), {
        routeId: "dictationCleanup",
        kind: "patch",
        patch: { useCleanupModel: true },
      });
      assert.equal(live().useCleanupModel, false, "nothing is sent before review");
      const applied = await apply();
      assert.equal(applied.applied, true);
      assert.equal(live().useCleanupModel, true);
      assert.equal(draft(), null);

      const off = await patch("dictationCleanup", { useCleanupModel: false });
      assert.equal(off.applied, true, "off sends nothing, so it applies at once");
      assert.equal(live().useCleanupModel, false);
      assert.equal(await off.undo(), "staged", "Undo would send again, so it waits for review");
      assert.equal(live().useCleanupModel, false);

      reset({ useCleanupModel: false });
      const local = await patch("dictationCleanup", { useCleanupModel: true });
      assert.equal(local.applied, true, "an on-device route turns on at once");
      assert.equal(live().useCleanupModel, true);
    }
  );

  await t.test(
    "change-driving: requestRoutePatch: switching a staged switch back drops its draft",
    async () => {
      reset({
        cleanupMode: "providers",
        cleanupProvider: "openai",
        cleanupModel: "gpt-6-astra",
        useCleanupModel: false,
      });
      assert.equal(await patch("dictationCleanup", { useCleanupModel: true }), "staged");
      const out = await patch("dictationCleanup", { useCleanupModel: false });
      assert.equal(out.plan.kind, "noop");
      assert.equal(draft(), null);
    }
  );

  // Change-driving (I1 follow-up): the region and web-search toggles bypassed review.
  await t.test(
    "change-driving: requestRoutePatch: a Corti region switch and web search on are staged; web search off is instant",
    async () => {
      reset({
        transcriptionMode: "providers",
        useLocalWhisper: false,
        cloudTranscriptionProvider: "corti",
        cloudTranscriptionModel: "corti-transcribe",
      });
      setFacts({ credentials: new Map([["corti:speech", true]]) });
      assert.equal(await patch("dictationStt", { cortiEnvironment: "eu" }), "staged");
      assert.equal(live().cortiEnvironment, "us");
      assert.equal((await apply()).applied, true);
      assert.equal(live().cortiEnvironment, "eu");

      reset(OPENAI_CHAT);
      globalThis.localStorage.setItem("personalWebSearch:chatIntelligence", "false");
      assert.equal(await patch("chat", { "providerSearch:chatIntelligence": true }), "staged");
      assert.equal(globalThis.localStorage.getItem("personalWebSearch:chatIntelligence"), "false");
      assert.equal((await apply()).applied, true);
      assert.equal(globalThis.localStorage.getItem("personalWebSearch:chatIntelligence"), "true");
      const off = await patch("chat", { "providerSearch:chatIntelligence": false });
      assert.equal(off.applied, true);
      assert.equal(globalThis.localStorage.getItem("personalWebSearch:chatIntelligence"), "false");
    }
  );

  // Change-driving: DictationAgentSettings told main itself, so a switch applied from the bar never reached main.
  await t.test(
    "change-driving: committing the screen-context switch tells main, from any entry point",
    async () => {
      reset({
        dictationAgentMode: "providers",
        dictationAgentProvider: "openai",
        dictationAgentModel: "gpt-6-astra",
        voiceAgentScreenContext: false,
      });
      screenContextCalls.length = 0;
      assert.equal(await patch("assistantVision", { voiceAgentScreenContext: true }), "staged");
      assert.deepEqual(screenContextCalls, [], "nothing changes in main before Apply");
      await apply();
      assert.deepEqual(screenContextCalls, [true]);
      const off = await patch("assistantVision", { voiceAgentScreenContext: false });
      assert.equal(off.applied, true);
      assert.deepEqual(screenContextCalls, [true, false]);
    }
  );

  // ---- R2-8: request epoch. Each case is change-driving: v2 settled every request after its
  // waits (the Codex probe reproduced a remote Chat draft after close, and an older request
  // replacing a newer selection).

  await t.test(
    "change-driving: closing Settings during a key save: the request settles to nothing",
    async () => {
      reset();
      live().setOpenaiApiKey("sk-test-0005");
      const pending = request("chat", { mode: "providers", provider: "anthropic" });
      await tick();
      assert.ok(pendingSaves.length > 0, "the request is waiting for main's acknowledgement");
      drafts.endSettingsSession();
      releaseSaves();
      assert.equal(await pending, "superseded");
      assert.equal(draft(), null, "no draft appears after close");
      assert.equal(live().chatAgentMode, "local", "nothing was committed");
    }
  );

  await t.test(
    "change-driving: closing Settings during the presence read: no draft, no commit",
    async () => {
      reset();
      holdLists = true;
      const pending = request("dictationStt", { mode: "providers", provider: "groq" });
      await tick();
      assert.equal(heldLists.length, 1, "the request is waiting for credentials.list");
      drafts.endSettingsSession();
      await releaseLists(0);
      assert.equal(await pending, "superseded");
      assert.equal(draft(), null);
      assert.equal(live().transcriptionMode, "local");
    }
  );

  await t.test(
    "change-driving: an instant on-device change still waiting when Settings closes does not commit",
    async () => {
      reset(OPENAI_CHAT);
      holdLists = true;
      const pending = request("chat", { mode: "local" });
      await tick();
      drafts.endSettingsSession();
      await releaseLists(0);
      assert.equal(await pending, "superseded");
      assert.equal(
        live().chatAgentMode,
        "providers",
        "the Local pick made before close was not applied after it"
      );
      assert.equal(live().chatAgentProvider, "openai");
    }
  );

  await t.test(
    "change-driving: out of order: the newer route selection wins whichever wait finishes first",
    async () => {
      // Newer finishes first.
      reset();
      holdLists = true;
      const older = request("chat", { mode: "providers", provider: "anthropic" });
      await tick();
      const newer = request("chat", {
        mode: "local",
        provider: "qwen",
        model: "qwen3.5-9b-q4_k_m",
      });
      await tick();
      assert.equal(heldLists.length, 2);
      await releaseLists(1, 0);
      assert.equal((await newer).applied, true);
      assert.equal(await older, "superseded");
      assert.equal(draft(), null, "the obsolete remote draft never appears");
      assert.equal(live().chatAgentModel, "qwen3.5-9b-q4_k_m");

      // Older finishes first.
      reset();
      holdLists = true;
      const first = request("chat", { mode: "providers", provider: "anthropic" });
      await tick();
      const second = request("chat", { mode: "providers", provider: "groq" });
      await tick();
      await releaseLists(0, 1);
      assert.equal(await first, "superseded");
      assert.equal(await second, "staged");
      assert.deepEqual(draft(), {
        routeId: "chat",
        kind: "target",
        target: { mode: "providers", provider: "groq" },
      });
    }
  );

  await t.test(
    "change-driving: out of order: a newer route request supersedes an older patch request",
    async () => {
      reset({
        cleanupMode: "providers",
        cleanupProvider: "openai",
        cleanupModel: "gpt-6-astra",
        useCleanupModel: false,
      });
      holdLists = true;
      const older = patch("dictationCleanup", { useCleanupModel: true }); // would be staged
      await tick();
      const newer = request("dictationCleanup", { mode: "local", provider: "qwen", model: QWEN });
      await tick();
      await releaseLists(1, 0);
      assert.equal((await newer).applied, true);
      assert.equal(await older, "superseded");
      assert.equal(draft(), null);
      assert.equal(live().useCleanupModel, false, "the older switch request wrote nothing");
      assert.equal(live().cleanupMode, "local");
    }
  );

  await t.test("change-driving: Discard cancels a request that is still waiting", async () => {
    reset();
    holdLists = true;
    const pending = request("dictationStt", { mode: "providers", provider: "groq" });
    await tick();
    drafts.useRouteDraftStore.getState().discard();
    await releaseLists(0);
    assert.equal(await pending, "superseded");
    assert.equal(draft(), null);
  });

  await t.test("change-driving: Apply in flight when Settings closes applies nothing", async () => {
    reset();
    assert.equal(await request("dictationStt", { mode: "providers", provider: "groq" }), "staged");
    holdLists = true;
    const pending = apply();
    await tick();
    drafts.endSettingsSession();
    await releaseLists(0);
    assert.equal(await pending, null);
    assert.equal(live().transcriptionMode, "local");
  });

  // Change-driving (R2-8 follow-up): v2's epoch was global, so a request on one route
  // silently superseded a request still waiting on another. Epochs are per route now.
  await t.test(
    "change-driving: requests on two different routes during a held key save both settle",
    async () => {
      reset(OPENAI_CHAT);
      live().setOpenaiApiKey("sk-test-0006");
      const chat = request("chat", { mode: "providers", provider: "openai", model: "gpt-5.6-sol" }); // instant
      await tick();
      const stt = request("dictationStt", { mode: "providers", provider: "groq" }); // staged
      await tick();
      assert.ok(pendingSaves.length > 0, "both requests are waiting for main's acknowledgement");
      releaseSaves();
      const chatOut = await chat;
      assert.notEqual(chatOut, "superseded", "a request on another route does not supersede it");
      assert.equal(chatOut.applied, true);
      assert.equal(live().chatAgentModel, "gpt-5.6-sol");
      assert.equal(await stt, "staged");
      assert.deepEqual(draft(), {
        routeId: "dictationStt",
        kind: "target",
        target: { mode: "providers", provider: "groq" },
      });

      // Whichever presence read finishes first, both still settle.
      reset(OPENAI_CHAT);
      holdLists = true;
      const first = request("chat", {
        mode: "providers",
        provider: "openai",
        model: "gpt-5.6-sol",
      });
      await tick();
      const second = request("dictationStt", { mode: "providers", provider: "groq" });
      await tick();
      assert.equal(heldLists.length, 2);
      await releaseLists(1, 0);
      assert.equal(await second, "staged");
      assert.equal((await first).applied, true);
      assert.equal(
        draft().routeId,
        "dictationStt",
        "the instant chat commit leaves another route's draft alone"
      );
    }
  );

  // Change-driving (R2-8 follow-up): an internal draft drop is not the user's Discard.
  await t.test(
    "change-driving: a no-op request that drops its route's draft does not cancel a request on another route",
    async () => {
      reset();
      stage({ routeId: "chat", kind: "target", target: { mode: "providers", provider: "groq" } });
      holdLists = true;
      const waiting = request("dictationStt", { mode: "providers", provider: "groq" });
      await tick();
      const noop = request("chat", { mode: "local" });
      await tick();
      await releaseLists(1, 0);
      assert.equal((await noop).plan.kind, "noop");
      assert.equal(
        await waiting,
        "staged",
        "dropping chat's draft did not supersede dictation's request"
      );
      assert.equal(draft().routeId, "dictationStt");
    }
  );

  // Change-driving (R2-8 follow-up): Undo is the newest intent for the routes it moves.
  await t.test(
    "change-driving: Undo supersedes a waiting request on its own route only",
    async () => {
      reset(OPENAI_CHAT);
      const out = await request("chat", {
        mode: "providers",
        provider: "openai",
        model: "gpt-5.6-sol",
      });
      assert.equal(out.applied, true);
      holdLists = true;
      const sameRoute = request("chat", {
        mode: "providers",
        provider: "openai",
        model: "gpt-5.6-terra",
      });
      await tick();
      const otherRoute = request("dictationStt", { mode: "providers", provider: "groq" });
      await tick();
      assert.equal((await out.undo()).applied, true, "Undo is not gated");
      assert.equal(live().chatAgentModel, "gpt-6-astra");
      await releaseLists(0, 1);
      assert.equal(await sameRoute, "superseded", "the Undo is newer than the waiting pick");
      assert.equal(
        live().chatAgentModel,
        "gpt-6-astra",
        "the older pick did not land on top of the Undo"
      );
      assert.equal(await otherRoute, "staged", "a request on another route still settles");
    }
  );

  // Baseline guard for the intentional post-close path: Undo is asynchronous,
  // waits for any earlier route ACK and is still callable after Settings closes.
  await t.test("baseline guard: a toast's Undo still works after Settings closes", async () => {
    reset(OPENAI_CHAT);
    const out = await request("chat", {
      mode: "providers",
      provider: "openai",
      model: "gpt-5.6-sol",
    });
    assert.equal(out.applied, true);
    drafts.endSettingsSession();
    const back = await out.undo();
    assert.equal(back.applied, true, "a same-recipient Undo applies at once after close");
    assert.equal(live().chatAgentModel, "gpt-6-astra");

    reset(OPENAI_CHAT);
    const home = await request("chat", { mode: "local", provider: "qwen", model: QWEN });
    drafts.endSettingsSession();
    assert.equal(
      await home.undo(),
      "staged",
      "an Undo back to OpenAI waits for review, even after close"
    );
    assert.deepEqual(draft(), { routeId: "chat", kind: "patch", patch: home.plan.undoPatch });
    assert.equal(live().chatAgentMode, "local");
  });

  // ---- R2-9 / R2-1: setup inside the staged editor. Change-driving: v2 had no setup on a draft,
  // so Azure could be applied only before its endpoint existed, and the endpoint field wrote
  // main directly.

  await t.test(
    "change-driving: enterprise setup joins the draft, writes nothing, and applies and undoes with it",
    async () => {
      const ENDPOINT = "https://contoso.openai.azure.com/openai";
      reset({ ...OPENAI_CHAT, azureEndpoint: "" });
      setFacts({
        credentials: new Map([
          ["openai", true],
          ["azure", true],
        ]),
      });
      enterpriseWrites.length = 0;
      const azure = { mode: "providers", provider: "azure", model: "gpt-4o-deploy" };
      assert.equal(await request("chat", azure), "staged");
      assert.equal(
        (await apply()).blocker,
        "needsUrl",
        "Apply waits until Azure has an endpoint (R2-9)"
      );

      assert.equal(
        drafts.stageDraftSetup("translation", { azureEndpoint: ENDPOINT }),
        null,
        "only the draft's own route"
      );
      assert.throws(() => drafts.stageDraftSetup("chat", { openaiApiKey: "sk-x" }), /setup/);
      drafts.stageDraftSetup("chat", { azureEndpoint: ENDPOINT });
      assert.deepEqual(draft(), {
        routeId: "chat",
        kind: "target",
        target: azure,
        setup: { azureEndpoint: ENDPOINT },
      });
      assert.equal(live().azureEndpoint, "", "typing the endpoint commits nothing");
      assert.deepEqual(enterpriseWrites, [], "and tells main nothing");
      const preview = drafts.planDraft(draft(), TEST_COPY);
      assert.equal(preview.patch.azureEndpoint, ENDPOINT);
      assert.equal(
        preview.changes.find((c) => c.id === "chat").after.host,
        "contoso.openai.azure.com",
        "the bar shows the real host"
      );

      // Another model keeps the setup; another provider drops it.
      assert.equal(await request("chat", { ...azure, model: "gpt-4o-mini-deploy" }), "staged");
      assert.deepEqual(draft().setup, { azureEndpoint: ENDPOINT });
      assert.equal(await request("chat", { mode: "providers", provider: "anthropic" }), "staged");
      assert.equal(draft().setup, undefined);

      assert.equal(await request("chat", azure), "staged");
      drafts.stageDraftSetup("chat", { azureEndpoint: ENDPOINT });
      const out = await apply();
      assert.equal(out.applied, true);
      assert.equal(live().chatAgentProvider, "azure");
      assert.equal(live().azureEndpoint, ENDPOINT);
      assert.deepEqual(
        enterpriseWrites.map(({ patch }) => patch),
        [{ azureEndpoint: ENDPOINT }],
        "the commit tells main once (Task 6's atomic transaction)"
      );
      assert.equal(await out.undo(), "staged", "back to OpenAI is a new recipient: reviewed");
      assert.equal((await apply()).applied, true);
      assert.equal(live().chatAgentProvider, "openai");
      assert.equal(live().azureEndpoint, "", "Undo restores the endpoint exactly");
    }
  );

  // Change-driving (R2-1 staging gap): before Task 3 syncs facts.enterpriseMain the Azure route
  // is `unknown` with host null on both sides. v2's planner called the edit instant, so
  // settle() committed it and main was told the new endpoint without review.
  await t.test(
    "change-driving: an Azure endpoint edit before main's facts sync is staged, not committed",
    async () => {
      const EAST = "https://contoso.openai.azure.com/openai";
      const WEST = "https://other.example.com/openai";
      const azureFacts = {
        credentials: new Map([["azure", true]]),
        credentialFields: new Map([["azure", { key: true }]]),
      };
      reset({
        chatAgentMode: "enterprise",
        chatAgentProvider: "azure",
        chatAgentModel: "gpt-4o-deploy",
        azureEndpoint: EAST,
      });
      setFacts({ ...azureFacts, enterpriseMain: null });
      enterpriseWrites.length = 0;
      assert.equal(await patch("chat", { azureEndpoint: WEST }), "staged", "settle() staged it");
      assert.deepEqual(draft(), { routeId: "chat", kind: "patch", patch: { azureEndpoint: WEST } });
      assert.equal(live().azureEndpoint, EAST, "nothing was committed");
      assert.deepEqual(enterpriseWrites, [], "main heard nothing");
      const blocked = await apply();
      assert.equal(blocked.applied, false);
      assert.equal(blocked.blocker, "unknown", "Apply waits until main's facts are synced");
      assert.ok(draft(), "the draft is kept");
      assert.equal(live().azureEndpoint, EAST);

      setFacts(azureFacts); // Task 3's sync landed (testFacts' default enterpriseMain)
      const out = await apply();
      assert.equal(out.applied, true);
      assert.equal(live().azureEndpoint, WEST);
      assert.deepEqual(
        enterpriseWrites.map(({ patch }) => patch),
        [{ azureEndpoint: WEST }],
        "main is told once, on Apply"
      );
    }
  );

  await t.test(
    "change-driving: different routes plan and Undo from each prior enterprise ACK",
    async () => {
      const ENDPOINT = "https://contoso.openai.azure.com/openai";
      reset({
        ...OPENAI_CHAT,
        cleanupMode: "providers",
        cleanupProvider: "openai",
        cleanupModel: "gpt-6-astra",
        useCleanupModel: true,
        azureEndpoint: "",
        bedrockRegion: "us-east-1",
      });
      setFacts({
        credentials: new Map([
          ["azure", true],
          ["bedrock", true],
          ["openai", true],
        ]),
        credentialFields: new Map([["bedrock", { accessKeyId: true, secretAccessKey: true }]]),
      });
      holdEnterpriseWrites = true;

      const azure = { mode: "providers", provider: "azure", model: "gpt-4o-deploy" };
      assert.equal(await request("chat", azure), "staged");
      drafts.stageDraftSetup("chat", { azureEndpoint: ENDPOINT });
      const applyAzure = apply();
      for (let i = 0; i < 5 && pendingEnterpriseWrites.length === 0; i++) await tick();
      assert.equal(pendingEnterpriseWrites.length, 1, "the first route owns a held main ACK");
      assert.equal(
        enterpriseWrites[0].expected.azureEndpoint,
        "",
        "the first plan captured the original tuple"
      );

      let bedrockSettled = false;
      const bedrockRequest = request("dictationCleanup", {
        mode: "providers",
        provider: "bedrock",
      }).then((result) => {
        bedrockSettled = true;
        return result;
      });
      await tick();
      assert.equal(
        bedrockSettled,
        false,
        "the other route waits for the first enterprise ACK before planning"
      );
      releaseEnterpriseWrite();
      assert.equal((await applyAzure).applied, true);
      assert.equal(await bedrockRequest, "staged");
      assert.equal(
        drafts.stageDraftSetup("dictationCleanup", { bedrockRegion: "eu-west-1" })?.routeId,
        "dictationCleanup"
      );
      const bedrockPreview = drafts.planDraft(draft(), TEST_COPY);
      assert.equal(
        bedrockPreview.enterpriseBase.azureEndpoint,
        ENDPOINT,
        "the second review includes the first committed endpoint"
      );

      const applyBedrock = apply();
      for (let i = 0; i < 5 && pendingEnterpriseWrites.length === 0; i++) await tick();
      assert.equal(pendingEnterpriseWrites.length, 1);
      assert.equal(enterpriseWrites[1].expected.azureEndpoint, ENDPOINT);
      assert.equal(enterpriseWrites[1].expected.bedrockRegion, "us-east-1");
      assert.deepEqual(enterpriseWrites[1].patch, { bedrockRegion: "eu-west-1" });
      releaseEnterpriseWrite();
      const appliedBedrock = await applyBedrock;
      assert.equal(appliedBedrock.applied, true);
      assert.equal(live().bedrockRegion, "eu-west-1");

      assert.equal(await appliedBedrock.undo(), "staged", "Undo to OpenAI requires review");
      const applyUndo = apply();
      for (let i = 0; i < 5 && pendingEnterpriseWrites.length === 0; i++) await tick();
      assert.equal(pendingEnterpriseWrites.length, 1);
      assert.equal(
        enterpriseWrites[2].expected.azureEndpoint,
        ENDPOINT,
        "Undo keeps the unrelated route's acknowledged endpoint"
      );
      assert.equal(
        enterpriseWrites[2].expected.bedrockRegion,
        "eu-west-1",
        "Undo compares against the state it actually reverses"
      );
      assert.equal(enterpriseWrites[2].patch.bedrockRegion, "us-east-1");
      releaseEnterpriseWrite();
      assert.equal((await applyUndo).applied, true);
      assert.equal(live().azureEndpoint, ENDPOINT);
      assert.equal(live().bedrockRegion, "us-east-1");
    }
  );

  await t.test(
    "change-driving: closing while an enterprise commit waits in the route queue sends no stale patch",
    async () => {
      const ENDPOINT = "https://contoso.openai.azure.com/openai";
      reset({ ...OPENAI_CHAT, azureEndpoint: "", bedrockRegion: "us-east-1" });
      setFacts({ credentials: new Map([["azure", true]]) });
      assert.equal(
        await request("chat", { mode: "providers", provider: "azure", model: "gpt-4o-deploy" }),
        "staged"
      );
      drafts.stageDraftSetup("chat", { azureEndpoint: ENDPOINT });

      holdLists = true;
      holdEnterpriseWrites = true;
      const applying = apply();
      await tick();
      assert.equal(heldLists.length, 1, "Apply is paused after the initial route-queue drain");

      // A different queued enterprise transaction gets ahead of Apply after its
      // drain. The Apply plan will be waiting behind this held main ACK.
      const blocker = live().applyRoutePatch(
        { bedrockRegion: "eu-west-1" },
        {
          expectedEnterprise: { ...mainEnterprise },
        }
      );
      await tick();
      assert.equal(pendingEnterpriseWrites.length, 1);
      let queuedCommit;
      let markQueued;
      const queued = new Promise((resolve) => {
        markQueued = resolve;
      });
      const originalApplyRoutePatch = live().applyRoutePatch;
      useSettingsStore.setState({
        applyRoutePatch: (...args) => {
          queuedCommit = args;
          markQueued();
          return originalApplyRoutePatch(...args);
        },
      });
      await releaseLists(0);
      await queued;
      assert.ok(queuedCommit, "Task 7 admitted its planned patch behind the blocker");
      drafts.endSettingsSession();
      releaseEnterpriseWrite();
      await blocker;
      assert.equal(await applying, null, "closing supersedes the queued Apply");
      assert.equal(enterpriseWrites.length, 1, "the stale queued Apply never contacts main");
      assert.equal(live().azureEndpoint, "", "the draft endpoint was not materialized");
      assert.equal(live().bedrockRegion, "eu-west-1", "the earlier durable ACK is reflected");
      useSettingsStore.setState({ applyRoutePatch: originalApplyRoutePatch });
    }
  );

  await t.test(
    "change-driving: replacing the Apply-owned draft while its commit is queued sends no stale patch",
    async () => {
      const ENDPOINT = "https://contoso.openai.azure.com/openai";
      reset({ ...OPENAI_CHAT, azureEndpoint: "", bedrockRegion: "us-east-1" });
      setFacts({ credentials: new Map([["azure", true]]) });
      assert.equal(
        await request("chat", { mode: "providers", provider: "azure", model: "gpt-4o-deploy" }),
        "staged"
      );
      drafts.stageDraftSetup("chat", { azureEndpoint: ENDPOINT });

      holdLists = true;
      holdEnterpriseWrites = true;
      const applying = apply();
      await tick();
      assert.equal(heldLists.length, 1);

      const blocker = live().applyRoutePatch(
        { bedrockRegion: "eu-west-1" },
        {
          expectedEnterprise: { ...mainEnterprise },
        }
      );
      await tick();
      assert.equal(pendingEnterpriseWrites.length, 1);
      const originalApplyRoutePatch = live().applyRoutePatch;
      let markQueued;
      const queued = new Promise((resolve) => {
        markQueued = resolve;
      });
      useSettingsStore.setState({
        applyRoutePatch: (...args) => {
          markQueued();
          return originalApplyRoutePatch(...args);
        },
      });

      try {
        await releaseLists(0);
        await queued;
        const replacement = {
          routeId: "dictationStt",
          kind: "patch",
          patch: { useDictationTranslation: true },
        };
        stage(replacement);
        releaseEnterpriseWrite();
        await blocker;
        assert.equal(
          await applying,
          null,
          "Apply lost ownership of its exact draft before queue admission"
        );
        assert.equal(enterpriseWrites.length, 1, "the replaced Apply never contacts main");
        assert.equal(live().azureEndpoint, "", "the old Apply endpoint was not materialized");
        assert.equal(live().bedrockRegion, "eu-west-1", "the earlier durable ACK is reflected");
        assert.deepEqual(draft(), replacement, "the newer route draft remains available");
      } finally {
        useSettingsStore.setState({ applyRoutePatch: originalApplyRoutePatch });
        if (pendingEnterpriseWrites.length) releaseEnterpriseWrite();
        if (heldLists.length) await releaseLists(...heldLists.map((_, index) => index));
      }
    }
  );
});

// These cases cross the actual IPC handler, CAS and deferred environment writer.
// All disk writes are in-memory fixture operations; no provider is contacted.
const { enterpriseRouteIpc } = require("../helpers/harness/enterpriseRouteIpc");
const { deferred } = require("../helpers/harness/deferred");
const MAIN_INITIAL = {
  BEDROCK_REGION: "us-east-1",
  AZURE_OPENAI_ENDPOINT: "https://east.openai.azure.com/openai",
  VERTEX_PROJECT: "fixture-project",
  VERTEX_LOCATION: "global",
  VERTEX_AUTH_SOURCE: "adc",
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function productionDrafts(t, overrides = {}) {
  const ipc = enterpriseRouteIpc(t, MAIN_INITIAL);
  const calls = [];
  installBrowserGlobals(t, {
    initialStorage: MIGRATED_STORAGE,
    window: {
      electronAPI: {
        credentials: {
          list: async () => [
            { id: "azure", present: true, fields: { key: true }, generation: 1 },
            { id: "vertex", present: true, fields: { key: true }, generation: 1 },
            {
              id: "corti:speech",
              present: true,
              fields: { clientId: true, clientSecret: true },
              generation: 1,
            },
            { id: "openai", present: true, fields: { key: true }, generation: 1 },
          ],
        },
        getEnterpriseRouteState: () => ipc.invoke("get-enterprise-route-state"),
        onEnterpriseRouteChanged: ipc.onChanged,
        saveEnterpriseRoutePatch: (input) => {
          calls.push(input);
          return ipc.invoke("save-enterprise-route-patch", input);
        },
      },
    },
  });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-task7-main-" });
  const settings = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const facts = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const sealed = await vite.ssrLoadModule("/stores/sealedStore.ts");
  settings.useSettingsStore.setState({
    ...routeBaseState(),
    ...ipc.env.getEnterpriseRouteSettings(),
    ...overrides,
  });
  sealed.useSealedStore.setState({ sealed: false, known: true });
  await facts.refreshRouteFacts(["enterprise", "credentials"]);
  const live = () => settings.useSettingsStore.getState();
  const draft = () => drafts.useRouteDraftStore.getState().draft;
  return {
    ipc,
    calls,
    ...settings,
    ...facts,
    ...drafts,
    live,
    draft,
    request: (id, target) => drafts.requestRouteChange(id, target, TEST_COPY),
    patch: (id, patch) => drafts.requestRoutePatch(id, patch, TEST_COPY),
    apply: () => drafts.applyDraft(TEST_COPY),
  };
}
const azureTarget = { mode: "providers", provider: "azure", model: "fixture-deployment" };
async function stageAzure(r, endpoint = "https://reviewed.openai.azure.com/openai") {
  assert.equal(await r.request("chat", azureTarget), "staged");
  r.stageDraftSetup("chat", { azureEndpoint: endpoint });
  return r.draft();
}

test("change-driving main boundary: durable Apply survives close and Discard without clearing a newer draft", async (t) => {
  for (const action of ["close", "discard"])
    await t.test(`change-driving: ${action}`, async (t) => {
      const r = await productionDrafts(t);
      const owned = await stageAzure(r);
      const preview = r.planDraft(owned, TEST_COPY);
      r.ipc.fs.holdNext((op) => op === "rename");
      const applying = r.apply();
      const hold = await r.ipc.fs.nextHold();
      assert.equal(r.calls.length, 1);
      assert.deepEqual(r.calls[0].expected, preview.enterpriseBase);
      assert.equal(r.live().chatAgentMode, "local", "companions wait for durable ACK");
      assert.equal(r.live().azureEndpoint, MAIN_INITIAL.AZURE_OPENAI_ENDPOINT);
      if (action === "close") r.endSettingsSession();
      else r.useRouteDraftStore.getState().discard();
      const replacement = {
        routeId: "chat",
        kind: "target",
        target: { mode: "providers", provider: "anthropic" },
      };
      r.useRouteDraftStore.getState().stage(replacement);
      hold.release();
      assert.equal(await applying, null, "expired Apply suppresses success");
      assert.equal(r.live().azureEndpoint, owned.setup.azureEndpoint, "durable truth remains");
      assert.equal(r.live().chatAgentProvider, "azure", "whole acknowledged patch materializes");
      assert.equal(r.draft(), replacement);
      assert.notEqual(r.useRouteFactsStore.getState().facts.enterpriseMain, null);
    });
});

test("change-driving main boundary: superseded enterprise ACK preserves newer canonical truth and draft", async (t) => {
  const r = await productionDrafts(t);
  const durable = deferred();
  const reply = deferred();
  globalThis.window.electronAPI.saveEnterpriseRoutePatch = async (input) => {
    const ack = await r.ipc.invoke("save-enterprise-route-patch", input);
    durable.resolve(ack);
    await reply.promise;
    return ack;
  };
  const old = r.patch("chat", {
    azureEndpoint: "https://first.openai.azure.com/openai",
    chatAgentModel: "obsolete-companion",
  });
  const ack = await durable.promise;
  assert.equal(Object.hasOwn(ack, "facts"), false, "real ACK has no facts");
  assert.equal(r.live().chatAgentModel, QWEN);
  assert.equal(
    r.useRouteFactsStore.getState().facts.enterpriseMain,
    null,
    "own event revokes readiness before ACK publication"
  );
  const next = await r.ipc.invoke("save-enterprise-route-patch", {
    expected: r.ipc.env.getEnterpriseRouteSettings(),
    patch: {
      azureEndpoint: "https://latest.openai.azure.com/openai",
      vertexProject: "newer-account",
    },
  });
  const replacement = { routeId: "chat", kind: "patch", patch: { chatAgentModel: "newest-draft" } };
  r.useRouteDraftStore.getState().stage(replacement);
  reply.resolve();
  assert.equal(await old, "superseded", "ENTERPRISE_ROUTE_SUPERSEDED is not save-failed");
  assert.equal(r.live().azureEndpoint, next.current.azureEndpoint);
  assert.equal(r.live().vertexProject, "newer-account");
  assert.equal(r.live().chatAgentModel, QWEN, "stale companion never published");
  assert.equal(r.draft(), replacement);
});

test("change-driving main boundary: conflict refreshes atomic metadata and retains the draft for review", async (t) => {
  const r = await productionDrafts(t);
  const draft = await stageAzure(r);
  r.ipc.pauseEvents();
  const original = globalThis.window.electronAPI.saveEnterpriseRoutePatch;
  let readbacks = 0;
  const read = globalThis.window.electronAPI.getEnterpriseRouteState;
  globalThis.window.electronAPI.getEnterpriseRouteState = () => {
    readbacks++;
    return read();
  };
  globalThis.window.electronAPI.saveEnterpriseRoutePatch = async (input) => {
    await r.ipc.invoke("save-enterprise-route-patch", {
      expected: r.ipc.env.getEnterpriseRouteSettings(),
      patch: { vertexProject: "competing-account" },
    });
    return original(input);
  };
  assert.equal(await r.apply(), "save-failed");
  assert.equal(r.draft(), draft);
  assert.equal(r.live().vertexProject, "competing-account");
  assert.equal(r.live().chatAgentMode, "local", "conflicting companion is not committed");
  assert.equal(readbacks, 1, "conflict explicitly refreshes complete main metadata for review");
  assert.notEqual(r.useRouteFactsStore.getState().facts.enterpriseMain, null);
  assert.equal(r.planDraft(draft, TEST_COPY).enterpriseBase.vertexProject, "competing-account");
});

test("change-driving main boundary: failed and lost replies retain retry state and newest durable truth", async (t) => {
  for (const failure of ["write", "reply"])
    await t.test(`change-driving: ${failure}`, async (t) => {
      const r = await productionDrafts(t);
      const owned = await stageAzure(r);
      let applying;
      if (failure === "write") {
        r.ipc.fs.holdNext((op) => op === "rename");
        applying = r.apply();
        const hold = await r.ipc.fs.nextHold();
        hold.fail(new Error("fixture failed durable rename"));
      } else {
        globalThis.window.electronAPI.saveEnterpriseRoutePatch = async (input) => {
          await r.ipc.invoke("save-enterprise-route-patch", input);
          throw new Error("fixture lost reply");
        };
        applying = r.apply();
      }
      assert.equal(await applying, "save-failed");
      assert.equal(r.draft(), owned);
      assert.equal(r.live().chatAgentMode, "local", "no unacknowledged companion writes");
      assert.equal(r.live().azureEndpoint, r.ipc.env.getEnterpriseRouteSettings().azureEndpoint);
      if (failure === "write")
        assert.equal(r.live().azureEndpoint, MAIN_INITIAL.AZURE_OPENAI_ENDPOINT);
      else
        assert.equal(
          r.live().azureEndpoint,
          owned.setup.azureEndpoint,
          "event's committed truth survives missing reply"
        );
    });
});

test("change-driving main boundary: an expired failed Apply suppresses failure and preserves a newer draft", async (t) => {
  const r = await productionDrafts(t);
  await stageAzure(r);
  r.ipc.fs.holdNext((op) => op === "rename");
  const applying = r.apply();
  const hold = await r.ipc.fs.nextHold();
  r.endSettingsSession();
  const replacement = {
    routeId: "translation",
    kind: "target",
    target: { mode: "providers", provider: "groq" },
  };
  r.useRouteDraftStore.getState().stage(replacement);
  hold.fail(new Error("fixture late failure"));
  assert.equal(await applying, null, "closed ticket cannot settle a save-failed UI result");
  assert.equal(r.draft(), replacement);
  assert.equal(r.live().azureEndpoint, MAIN_INITIAL.AZURE_OPENAI_ENDPOINT);
});

test("baseline guard main protocol: bare ACK cannot reuse old facts; profile-only versions supersede older replies", async (t) => {
  const r = await productionDrafts(t);
  r.ipc.pauseEvents();
  const out = await r.patch("chat", { azureEndpoint: "https://no-event.openai.azure.com/openai" });
  assert.equal(out.applied, true);
  assert.equal(
    r.useRouteFactsStore.getState().facts.enterpriseMain,
    null,
    "old facts do not match new ACK version"
  );
  await r.refreshRouteFacts(["enterprise"]);
  assert.notEqual(r.useRouteFactsStore.getState().facts.enterpriseMain, null);
  r.ipc.resumeEvents();
  const durable = deferred();
  const reply = deferred();
  globalThis.window.electronAPI.saveEnterpriseRoutePatch = async (input) => {
    const ack = await r.ipc.invoke("save-enterprise-route-patch", input);
    durable.resolve(ack);
    await reply.promise;
    return ack;
  };
  const pending = r.patch("chat", { azureEndpoint: "https://old-profile.openai.azure.com/openai" });
  const ack = await durable.promise;
  await r.ipc.invoke("save-bedrock-profile", "fixture-profile-only");
  assert.deepEqual(
    r.ipc.env.getEnterpriseRouteSettings(),
    ack.current,
    "five route fields are unchanged"
  );
  reply.resolve();
  assert.equal(await pending, "superseded", "profile-only version still fences ACK");
  assert.equal(r.useRouteFactsStore.getState().facts.enterpriseMain.bedrockProfile, true);
});

test("change-driving: all five enterprise setup keys are draft-only; same-provider model requests keep newer setup", async (t) => {
  const r = await productionDrafts(t);
  assert.deepEqual(
    [...r.DRAFT_SETUP_KEYS].sort(),
    ["azureEndpoint", "bedrockRegion", "vertexAuthSource", "vertexLocation", "vertexProject"].sort()
  );
  assert.equal(
    await r.request("chat", { mode: "providers", provider: "vertex", model: "gemini-2.5-pro" }),
    "staged"
  );
  const input = deferred();
  globalThis.window.electronAPI.credentials.list = () => input.promise;
  const selecting = r.request("chat", {
    mode: "providers",
    provider: "vertex",
    model: "gemini-2.5-flash",
  });
  await tick();
  r.stageDraftSetup("chat", {
    vertexProject: "draft-account",
    vertexLocation: "global",
    vertexAuthSource: "apiKey",
  });
  input.resolve([]);
  assert.equal(await selecting, "staged");
  assert.deepEqual(r.draft().setup, {
    vertexProject: "draft-account",
    vertexLocation: "global",
    vertexAuthSource: "apiKey",
  });
  assert.equal(r.calls.length, 0);
  assert.equal(r.live().vertexProject, MAIN_INITIAL.VERTEX_PROJECT);
});

test("change-driving B2: equal-host Vertex source/project changes stage every active route and Undo exact values", async (t) => {
  for (const patch of [{ vertexAuthSource: "apiKey" }, { vertexProject: "other-project" }])
    await t.test(`change-driving: ${Object.keys(patch)[0]}`, async (t) => {
      const vertex = {
        chatAgentMode: "enterprise",
        chatAgentProvider: "vertex",
        chatAgentModel: "gemini-2.5-pro",
        translationMode: "enterprise",
        translationProvider: "vertex",
        translationModel: "gemini-2.5-flash",
      };
      const r = await productionDrafts(t, vertex);
      assert.equal(await r.patch("chat", patch), "staged");
      const preview = r.planDraft(r.draft(), TEST_COPY);
      assert.deepEqual(
        preview.changes.map((c) => c.id),
        ["chat", "translation"]
      );
      assert.ok(
        preview.changes.every((c) => c.before.host === c.after.host),
        "equal host still changes recipient account/source"
      );
      const out = await r.apply();
      assert.equal(out.applied, true);
      assert.equal(await out.undo(), "staged");
      assert.equal((await r.apply()).applied, true);
      for (const key of Object.keys(patch)) assert.equal(r.live()[key], preview.undoPatch[key]);
    });
});

test("change-driving B2: Corti tenant stages coupled speech routes, invalid active inputs block, unused settings stay instant", async (t) => {
  const speech = {
    transcriptionMode: "providers",
    useLocalWhisper: false,
    cloudTranscriptionProvider: "corti",
    cloudTranscriptionModel: "corti-transcribe",
    meetingTranscriptionMode: "providers",
    uploadTranscriptionMode: "providers",
  };
  const r = await productionDrafts(t, speech);
  assert.equal(await r.patch("dictationStt", { cortiTenant: "other-tenant" }), "staged");
  const preview = r.planDraft(r.draft(), TEST_COPY);
  assert.deepEqual(
    preview.changes.map((c) => c.id).sort(),
    ["dictationStt", "noteRecordingStt", "uploadStt"].sort()
  );
  assert.ok(preview.changes.every((c) => c.before.host === c.after.host));
  const out = await r.apply();
  assert.equal(out.applied, true);
  assert.equal(await out.undo(), "staged");
  assert.equal((await r.apply()).applied, true);
  assert.equal(r.live().cortiTenant, "base");
  assert.equal(await r.patch("dictationStt", { cortiTenant: "bad/path" }), "staged");
  assert.equal((await r.apply()).blocker, "unsupported");
  assert.equal(r.live().cortiTenant, "base");
  r.useSettingsStore.setState({
    ...routeBaseState(),
    ...r.ipc.env.getEnterpriseRouteSettings(),
    chatAgentMode: "providers",
    chatAgentProvider: "corti",
    chatAgentModel: "corti",
  });
  assert.equal(
    (await r.patch("chat", { cortiTenant: "unused/path", cortiEnvironment: "invalid" })).applied,
    true,
    "text-only Corti ignores speech options"
  );
  r.useSettingsStore.setState({
    ...speech,
    transcriptionMode: "self-hosted",
    meetingTranscriptionMode: "self-hosted",
    uploadTranscriptionMode: "self-hosted",
    remoteTranscriptionUrl: "http://localhost:8178",
    remoteTranscriptionModel: "local",
  });
  assert.equal(
    (await r.patch("dictationStt", { cortiTenant: "another/unused" })).applied,
    true,
    "retained Corti provider cannot replace self-hosted speech"
  );
});

test("change-driving main boundary: queue admission refuses closed or replaced Apply before IPC", async (t) => {
  for (const action of ["close", "replace"])
    await t.test(`change-driving: ${action}`, async (t) => {
      const r = await productionDrafts(t);
      await stageAzure(r);
      const presence = deferred();
      const list = globalThis.window.electronAPI.credentials.list;
      globalThis.window.electronAPI.credentials.list = () => presence.promise;
      const applying = r.apply();
      await tick();
      r.ipc.fs.holdNext((op) => op === "rename");
      const blocker = r.live().applyRoutePatch({ vertexProject: "earlier-committed-account" });
      const hold = await r.ipc.fs.nextHold();
      const queued = deferred();
      const originalApply = r.live().applyRoutePatch;
      r.useSettingsStore.setState({
        applyRoutePatch: (...args) => {
          queued.resolve();
          return originalApply(...args);
        },
      });
      presence.resolve(await list());
      await queued.promise;
      const replacement = {
        routeId: "translation",
        kind: "patch",
        patch: { translationModel: "new-draft" },
      };
      if (action === "close") r.endSettingsSession();
      else r.useRouteDraftStore.getState().stage(replacement);
      hold.release();
      await blocker;
      assert.equal(await applying, null);
      assert.equal(r.calls.length, 1, "only the admitted blocker contacted actual main handler");
      assert.equal(r.live().vertexProject, "earlier-committed-account");
      assert.equal(r.live().azureEndpoint, MAIN_INITIAL.AZURE_OPENAI_ENDPOINT);
      assert.equal(r.live().chatAgentMode, "local");
      if (action === "replace") assert.equal(r.draft(), replacement);
      r.useSettingsStore.setState({ applyRoutePatch: originalApply });
    });
});

test("change-driving main boundary: conflict refresh wait suppresses expired failure after close or replacement", async (t) => {
  for (const action of ["close", "replace"])
    await t.test(`change-driving: ${action}`, async (t) => {
      const r = await productionDrafts(t);
      await stageAzure(r);
      r.ipc.pauseEvents();
      const entered = deferred();
      const release = deferred();
      globalThis.window.electronAPI.getEnterpriseRouteState = async () => {
        entered.resolve();
        await release.promise;
        return r.ipc.invoke("get-enterprise-route-state");
      };
      globalThis.window.electronAPI.saveEnterpriseRoutePatch = async (input) => {
        await r.ipc.invoke("save-enterprise-route-patch", {
          expected: r.ipc.env.getEnterpriseRouteSettings(),
          patch: { vertexProject: "canonical-conflict-account" },
        });
        return r.ipc.invoke("save-enterprise-route-patch", input);
      };
      const applying = r.apply();
      await entered.promise;
      const replacement = { routeId: "chat", kind: "patch", patch: { chatAgentModel: "newer" } };
      if (action === "close") r.endSettingsSession();
      else r.useRouteDraftStore.getState().stage(replacement);
      release.resolve();
      assert.equal(
        await applying,
        null,
        "the post-refresh failure belongs to an expired UI ticket"
      );
      assert.equal(
        r.live().vertexProject,
        "canonical-conflict-account",
        "canonical read is still durable truth"
      );
      assert.notEqual(r.useRouteFactsStore.getState().facts.enterpriseMain, null);
      if (action === "replace") assert.equal(r.draft(), replacement);
    });
});

test("change-driving main boundary: post-close Undo drains prior durable ACK and uses its exact head tuple", async (t) => {
  const r = await productionDrafts(t);
  const out = await r.patch("chat", { azureEndpoint: "https://undo.openai.azure.com/openai" });
  assert.equal(out.applied, true);
  r.endSettingsSession();
  r.ipc.fs.holdNext((op) => op === "rename");
  const prior = r.live().applyRoutePatch({ vertexProject: "prior-account" });
  const hold = await r.ipc.fs.nextHold();
  const undoing = out.undo();
  await tick();
  assert.equal(r.calls.length, 2, "Undo has not bypassed earlier main persistence");
  hold.release();
  await prior;
  const back = await undoing;
  assert.equal(back.applied, true);
  assert.equal(r.calls[2].expected.vertexProject, "prior-account");
  assert.equal(r.calls[2].expected.azureEndpoint, "https://undo.openai.azure.com/openai");
  assert.equal(r.live().azureEndpoint, MAIN_INITIAL.AZURE_OPENAI_ENDPOINT);
  assert.equal(r.live().vertexProject, "prior-account");
});

test("baseline guard B4: prospective Corti draft does not inherit old generation/config rejection", async (t) => {
  const r = await productionDrafts(t, {
    transcriptionMode: "providers",
    useLocalWhisper: false,
    cloudTranscriptionProvider: "corti",
    cloudTranscriptionModel: "corti-transcribe",
  });
  const binding = {
    identity: "corti:speech",
    generation: 1,
    configFingerprint: "main-issued-us-base-complete-config",
  };
  r.useRouteFactsStore.setState((s) => ({
    facts: {
      ...s.facts,
      credentialHealth: {
        options: { cortiEnvironment: "us", cortiTenant: "base" },
        current: [binding],
        health: [{ ...binding, status: "rejected" }],
      },
    },
  }));
  assert.equal(await r.patch("dictationStt", { cortiTenant: "prospective-tenant" }), "staged");
  const plan = r.planDraft(r.draft(), TEST_COPY);
  assert.equal(
    plan.changes.find((change) => change.id === "dictationStt").before.state.status,
    "needsKey"
  );
  assert.equal(plan.blocker, null, "different full options do not reuse old rejection authority");
  assert.equal((await r.apply()).applied, true);
  assert.equal(r.live().cortiTenant, "prospective-tenant");
});

test("change-driving main boundary: a newer coupled-route intent supersedes Undo before drain or queue admission", async (t) => {
  for (const phase of ["drain", "admission"])
    await t.test(`change-driving: ${phase}`, async (t) => {
      const r = await productionDrafts(t);
      const out = await r.patch("chat", {
        chatAgentModel: "after-chat",
        translationModel: "after-translation",
      });
      assert.equal(out.applied, true);
      assert.deepEqual(
        out.plan.changes.map((change) => change.id),
        ["chat", "translation"]
      );
      r.ipc.fs.holdNext((op) => op === "rename");
      const originalApply = r.live().applyRoutePatch;
      let prior;
      let undoing;
      if (phase === "drain") {
        prior = originalApply({ vertexProject: "earlier-head" });
        undoing = out.undo();
      } else {
        const queued = deferred();
        r.useSettingsStore.setState({
          applyRoutePatch: (...args) => {
            prior = originalApply({ vertexProject: "earlier-head" });
            const result = originalApply(...args);
            queued.resolve();
            return result;
          },
        });
        undoing = out.undo();
        await queued.promise;
        r.useSettingsStore.setState({ applyRoutePatch: originalApply });
      }
      const hold = await r.ipc.fs.nextHold();
      const newer = r.request("translation", {
        mode: "providers",
        provider: "openai",
        model: "gpt-6-astra",
      });
      const replacement = {
        routeId: "translation",
        kind: "target",
        target: { mode: "providers", provider: "groq" },
      };
      r.useRouteDraftStore.getState().stage(replacement);
      assert.equal(r.live().chatAgentModel, "after-chat");
      assert.equal(r.live().translationModel, "after-translation");
      hold.release();
      await prior;
      assert.equal(await undoing, "superseded", "coupled route epoch invalidates the Undo ticket");
      assert.equal(
        r.live().chatAgentModel,
        "after-chat",
        "Undo wrote no primary values before admission"
      );
      assert.equal(r.live().translationModel, "after-translation", "Undo wrote no coupled values");
      assert.equal(await newer, "staged");
      assert.equal(r.draft().routeId, "translation");
      assert.equal(r.draft().target.provider, "openai", "newer intent owns the draft");
      assert.equal(r.calls.length, 1, "only earlier admitted main write ran");
    });
});

test("change-driving main boundary: a coupled-route intent during Undo ACK retains durable tuple and companions but suppresses stale notice", async (t) => {
  const r = await productionDrafts(t);
  const out = await r.patch("chat", {
    azureEndpoint: "https://undo-coupled.openai.azure.com/openai",
    chatAgentModel: "after-chat",
    translationModel: "after-translation",
  });
  assert.equal(out.applied, true);
  const durable = deferred();
  const reply = deferred();
  globalThis.window.electronAPI.saveEnterpriseRoutePatch = async (input) => {
    const ack = await r.ipc.invoke("save-enterprise-route-patch", input);
    durable.resolve();
    await reply.promise;
    return ack;
  };
  const undoing = out.undo();
  await durable.promise;
  const newer = r.request("translation", {
    mode: "providers",
    provider: "openai",
    model: "gpt-6-astra",
  });
  const replacement = {
    routeId: "translation",
    kind: "patch",
    patch: { translationModel: "new-draft" },
  };
  r.useRouteDraftStore.getState().stage(replacement);
  reply.resolve();
  assert.equal(await undoing, "superseded", "settlement checks the coupled route epoch too");
  assert.equal(r.live().azureEndpoint, MAIN_INITIAL.AZURE_OPENAI_ENDPOINT);
  assert.equal(r.live().chatAgentModel, QWEN);
  assert.equal(r.live().translationModel, QWEN, "ACK-owned companions remain durable UI truth");
  assert.equal(r.draft(), replacement, "expired Undo did not clear newer draft");
  assert.equal(await newer, "staged");
});

test("change-driving main boundary: staged Bedrock setup fits remembered models once and Undo restores exact raw state", async (t) => {
  const r = await productionDrafts(t, {
    cleanupMode: "enterprise",
    cleanupProvider: "bedrock",
    cleanupModel: "us.anthropic.claude-fable-5",
    reasoningModelByProvider: { bedrock: "us.anthropic.claude-fable-5" },
  });
  await r.ipc.invoke("save-bedrock-profile", "fixture-profile-readiness");
  assert.equal(await r.request("chat", { mode: "providers", provider: "bedrock" }), "staged");
  r.stageDraftSetup("chat", { bedrockRegion: "eu-west-1" });
  const owned = r.draft();
  const plan = r.planDraft(owned, TEST_COPY);
  assert.equal(plan.patch.chatAgentModel, "eu.anthropic.claude-fable-5");
  assert.equal(plan.patch.cleanupModel, "eu.anthropic.claude-fable-5");
  assert.equal(r.live().bedrockRegion, "us-east-1");
  assert.equal(r.calls.length, 0, "setup and previews do not persist");
  r.ipc.fs.holdNext((op) => op === "rename");
  const applying = r.apply();
  const hold = await r.ipc.fs.nextHold();
  assert.deepEqual(r.calls[0], {
    patch: { bedrockRegion: "eu-west-1" },
    expected: plan.enterpriseBase,
  });
  assert.equal(r.live().cleanupModel, "us.anthropic.claude-fable-5", "coupled model waits for ACK");
  // The reviewed patch pins this companion. Commit must not re-expand from
  // this later raw state and silently change the model's reviewed value.
  r.useSettingsStore.setState({ cleanupModel: "us.fixture-later-raw" });
  hold.release();
  const out = await applying;
  assert.equal(out.applied, true);
  assert.equal(r.live().cleanupModel, plan.patch.cleanupModel);
  assert.equal(r.live().chatAgentModel, plan.patch.chatAgentModel);
  assert.equal(await out.undo(), "staged", "the other active Bedrock route changes host on Undo");
  assert.equal((await r.apply()).applied, true);
  assert.equal(r.live().bedrockRegion, "us-east-1");
  assert.equal(r.live().cleanupModel, "us.anthropic.claude-fable-5");
  assert.equal(r.live().chatAgentMode, "local");
  assert.equal(r.live().chatAgentModel, QWEN);
  assert.deepEqual(r.live().reasoningModelByProvider, { bedrock: "us.anthropic.claude-fable-5" });
});
