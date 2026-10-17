const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
async function load(t) {
  installBrowserGlobals(t);
  const v = await createRendererServer(t, { cachePrefix: "loqui-disclosure-" });
  return v.ssrLoadModule("/helpers/dictationDisclosure.js");
}
const session = {
  id: "rec-1",
  settings: {},
  routes: {
    dictationStt: { locality: "remote", providerId: "openai" },
    translation: { locality: "remote", providerId: "anthropic" },
  },
};
test("mixed payload evidence cannot attest audio from a text receipt", async (t) => {
  const { createDisclosureTracker } = await load(t);
  const d = createDisclosureTracker({ session });
  d.record({ task: "dictationStt", payload: "text", evidence: "attested" });
  d.record({ task: "dictationStt", payload: "audio", evidence: "dispatched" });
  assert.deepEqual(d.get(), {
    target: "openai",
    payload: "audio",
    evidence: "dispatched",
    alsoSentTo: [],
  });
});
test("every named receiver must support attested wording", async (t) => {
  const { createDisclosureTracker } = await load(t);
  const d = createDisclosureTracker({ session });
  d.record({ task: "translation", payload: "text", evidence: "dispatched" });
  d.record({ task: "dictationStt", payload: "audio", evidence: "attested" });
  assert.deepEqual(d.get(), {
    target: "openai",
    payload: "audio",
    evidence: "dispatched",
    alsoSentTo: ["anthropic"],
  });
});
test("optional main feed replaces renderer evidence and withdraws individual tickets", async (t) => {
  const { createDisclosureTracker } = await load(t);
  let notice, dispatch;
  let off = 0;
  const d = createDisclosureTracker({
    session,
    privacyApi: { onEgress: (f) => ((notice = f), () => off++) },
    dispatchApi: { onDictationDispatch: (f) => ((dispatch = f), () => off++) },
  });
  dispatch({ correlationId: "rec-1", task: "dictationStt", payload: "audio" });
  assert.equal(d.get(), null);
  const n = (ticketId, payload, phase) =>
    notice({
      correlationId: "rec-1",
      targetId: "openai",
      task: "dictationStt",
      ticketId,
      payload,
      phase,
    });
  n(1, "text", "delivered");
  n(2, "audio", "dispatched");
  assert.equal(d.get().evidence, "dispatched");
  n(2, "audio", "undelivered");
  assert.equal(d.get().payload, "text");
  assert.equal(d.get().evidence, "attested");
  d.dispose();
  assert.equal(off, 2);
});

test("disclosure keeps payload evidence separate in both arrival orders", async (t) => {
  const { createDisclosureTracker } = await load(t);
  for (const reverse of [false, true])
    for (const other of ["dispatched", "attested"]) {
      const d = createDisclosureTracker({ session });
      let events = [
        { task: "dictationStt", payload: "text", evidence: "attested" },
        { task: "dictationStt", payload: "audio", evidence: "dispatched" },
      ];
      if (reverse) events.reverse();
      events.forEach((e) => d.record(e));
      d.record({ task: "translation", payload: "text", evidence: other });
      assert.equal(d.get().evidence, "dispatched");
      d.record({ task: "dictationStt", payload: "audio", evidence: "attested" });
      assert.equal(d.get().evidence, other);
      d.dispose();
    }
});
test("device routes and malformed unrelated evidence never disclose", async (t) => {
  const { createDisclosureTracker, disclosureTargetFor } = await load(t);
  const d = createDisclosureTracker({
    session: { ...session, routes: { dictationStt: { locality: "device" } } },
  });
  d.record({ task: "dictationStt", payload: "audio", evidence: "dispatched" });
  d.record({ task: "chat", payload: "text", evidence: "attested" });
  assert.equal(d.get(), null);
  assert.equal(
    disclosureTargetFor(
      { id: "translation", locality: "network" },
      { translationRemoteUrl: "http://gpu.lan:8080" }
    ),
    "host:gpu.lan"
  );
});

const { EventEmitter } = require("node:events");
const { loadAudioManager, realSettingsStoreSource } = require("./harness/audioManager");
const REMOTE_STT = {
  useLocalWhisper: false,
  transcriptionMode: "providers",
  cloudTranscriptionProvider: "openai",
  cloudTranscriptionModel: "whisper-1",
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const blob = () => new Blob([new Uint8Array(8)], { type: "audio/webm" });

async function managerWith(t, electronAPI, { mockModules = {} } = {}) {
  const loaded = await loadAudioManager(t, {
    cachePrefix: "loqui-disclosure-",
    settingsKey: "__disclosureSettings",
    settings: REMOTE_STT,
    mockModules: {
      "/stores/settingsStore": realSettingsStoreSource("__disclosureSettings"),
      ...mockModules,
    },
  });
  const bus = new EventEmitter();
  loaded.window.electronAPI = {
    ...loaded.window.electronAPI,
    cancelUploadTranscription: () => {},
    onDictationDispatch: (cb) => (bus.on("d", cb), () => bus.off("d", cb)),
    ...electronAPI(bus),
  };
  const manager = loaded.createManager({ isProcessing: true });
  manager.beginDictationSession({}); // the tracker subscribes to main's hand-off here
  return { ...loaded, manager, bus };
}

test("a held upload discloses when main hands it off, before the provider answers", async (t) => {
  let answer;
  const { manager } = await managerWith(t, (bus) => ({
    transcribeAudioFileByok: (payload) => {
      bus.emit("d", {
        correlationId: payload.correlationId,
        task: "dictationStt",
        payload: "audio",
      });
      return new Promise((resolve) => (answer = resolve));
    },
  }));
  const pending = manager.processWithOpenAIAPI(blob(), {}, () => false);
  while (!answer) await tick();
  assert.deepEqual(manager.getDisclosure(), {
    target: "openai",
    payload: "audio",
    evidence: "dispatched",
    alsoSentTo: [],
  });
  answer({ success: false, error: "Rate limit exceeded. Please try again later." });
  await assert.rejects(pending, /Rate limit/);
  assert.equal(
    manager.getDisclosure().evidence,
    "dispatched",
    "an error after the hand-off keeps the evidence"
  );
});

test("an upload main refuses before sending discloses nothing", async (t) => {
  const { manager } = await managerWith(t, () => ({
    transcribeAudioFileByok: async () => ({
      success: false,
      error: "Sealed mode is on",
      code: "SEALED_BLOCKED",
    }),
  }));
  await assert.rejects(
    manager.processWithOpenAIAPI(blob(), {}, () => false),
    /Sealed mode/
  );
  assert.equal(manager.getDisclosure(), null);
});

test("a cancelled start never reaches IPC and discloses nothing", async (t) => {
  let calls = 0;
  const { manager } = await managerWith(t, () => ({
    transcribeAudioFileByok: async () => (calls++, { success: true, text: "hello" }),
  }));
  await assert.rejects(
    manager.processWithOpenAIAPI(blob(), {}, () => true),
    { name: "AbortError" }
  );
  assert.equal(calls, 0);
  assert.equal(manager.getDisclosure(), null);
});

test("a text request refused before IPC or by main discloses nothing", async (t) => {
  const { manager, vite } = await managerWith(
    t,
    () => ({
      personalInference: {
        onTextEvent: () => () => {},
        // Main's own rejection: no hand-off was sent (personalInference.js:409-411).
        textGenerate: async () => {
          throw new Error("Configure the anthropic API key in Settings.");
        },
      },
    }),
    {
      mockModules: {
        "/services/ReasoningService": 'export { default } from "/services/ReasoningService.ts";',
      },
    }
  );
  const reasoning = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
  t.after(() => reasoning.destroy());
  const config = {
    provider: "anthropic",
    inferenceScope: "dictationCleanup",
    disclosureTask: "dictationCleanup",
    systemPrompt: "Clean up.",
  };
  // ReasoningService.ts:47 and :44-45: renderer-side failures before IPC.
  await assert.rejects(
    manager.processWithReasoningModel("hello", "", "Loqui", config),
    /No reasoning model selected/
  );
  await assert.rejects(
    manager.processWithReasoningModel("hello", "m", "Loqui", {
      ...config,
      provider: "not-a-provider",
    }),
    /Unsupported reasoning provider/
  );
  await assert.rejects(
    manager.processWithReasoningModel("hello", "claude", "Loqui", config),
    /Configure the anthropic API key/
  );
  assert.equal(manager.getDisclosure(), null);
});

test("detached sessions keep their own late receipts and reuse the tracker at the actual apply seam", async (t) => {
  const { manager, bus } = await managerWith(t, () => ({}));
  const held = manager._detachSessionOperation();
  const newer = manager.beginDictationSession({});
  assert.notEqual(newer.id, held.session.id);
  bus.emit("d", { correlationId: held.session.id, task: "dictationStt", payload: "audio" });
  assert.equal(manager.getDisclosure(), null);
  assert.equal(held.tracker.get().evidence, "dispatched");
  manager.applySessionIntents(held.session, { context: held.context, tracker: held.tracker });
  assert.equal(manager._disclosure, held.tracker);
  assert.equal(manager.getDisclosure().evidence, "dispatched");
  manager._endDictationSession(held.session);
  assert.equal(bus.listenerCount("d"), 0);
});
test("disposal makes cached feed callbacks inert", async (t) => {
  const { createDisclosureTracker } = await load(t);
  let callback;
  const d = createDisclosureTracker({
    session,
    dispatchApi: { onDictationDispatch: (f) => ((callback = f), () => {}) },
  });
  d.dispose();
  callback({ correlationId: session.id, task: "dictationStt", payload: "audio" });
  assert.equal(d.get(), null);
  assert.equal(d.attested(), false);
});

test("network translation disclosure uses the scope's actual captured URL field", async (t) => {
  const { disclosureTargetFor } = await load(t);
  assert.equal(
    disclosureTargetFor(
      { id: "translation", locality: "network" },
      { translationRemoteUrl: "http://translate.lan:8080/v1" }
    ),
    "host:translate.lan"
  );
});
