const assert = require("node:assert/strict");
const test = require("node:test");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function load(t) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-dictation-session-" });
  return { vite, ...(await vite.ssrLoadModule("/helpers/dictationSession.js")) };
}

const live = {
  useLocalWhisper: true,
  localTranscriptionProvider: "nvidia",
  parakeetModel: "parakeet-tdt-0.6b-v3",
  cloudTranscriptionProvider: "openai",
  cloudTranscriptionModel: "gpt-4o-mini-transcribe",
  useCleanupModel: true,
  cleanupMode: "providers",
  cleanupProvider: "anthropic",
  customPrompts: { dictationAgent: "Be brief." },
  openaiApiKey: "sk-live",
  customTranscriptionApiKey: "k",
  theme: "dark",
};

test("the snapshot is frozen, credential-free and covers every route key", async (t) => {
  const { captureDictationSession, SESSION_ROUTE_KEYS, isCredentialKey } = await load(t);
  const session = captureDictationSession({
    settings: live,
    private: true,
    intents: {
      voiceAgentRequested: false,
      translationRequested: true,
      streaming: false,
      streamingProviderName: null,
    },
    agentName: "Loqui",
    id: "rec-1",
    now: 5,
  });
  assert.equal(session.id, "rec-1");
  assert.equal(Object.isFrozen(session), true);
  assert.equal(session.private, true, "privacy is frozen with this operation's route");
  assert.equal(Object.isFrozen(session.settings), true);
  assert.equal(session.settings.cleanupProvider, "anthropic");
  assert.equal("theme" in session.settings, false, "only routing and prompt keys are captured");
  for (const key of Object.keys(session.settings)) assert.equal(isCredentialKey(key), false, key);
  assert.equal(SESSION_ROUTE_KEYS.some(isCredentialKey), false);
  assert.equal(session.intents.translationRequested, true);
});

test("the session view keeps the snapshot's route and the live credentials", async (t) => {
  const { captureDictationSession, sessionSettings } = await load(t);
  const session = captureDictationSession({ settings: live, intents: {}, agentName: "Loqui" });
  const changed = {
    ...live,
    useLocalWhisper: false,
    cloudTranscriptionProvider: "groq",
    openaiApiKey: "sk-rotated",
  };
  const view = sessionSettings(session, changed);
  assert.equal(view.useLocalWhisper, true, "local stays local");
  assert.equal(view.cloudTranscriptionProvider, "openai", "provider A stays provider A");
  assert.equal(view.openaiApiKey, "sk-rotated", "credentials are never frozen");
});

test("every inference scope the dictation pipeline uses is covered", async (t) => {
  const { vite, SESSION_ROUTE_KEYS } = await load(t);
  const { INFERENCE_SCOPES } = await vite.ssrLoadModule("/config/inferenceScopes.ts");
  for (const scope of [
    "dictationCleanup",
    "dictationAgent",
    "dictationAgentVision",
    "dictationTranslation",
  ]) {
    const keys = Object.values(INFERENCE_SCOPES[scope].storeKeys);
    assert.ok(keys.length >= 6, `${scope} has store keys`);
    for (const key of keys) {
      if (/apikey|secret/i.test(key)) continue;
      assert.ok(SESSION_ROUTE_KEYS.includes(key), `${scope}: ${key}`);
    }
  }
  // Spot checks that would fail if the scope maps were read from the wrong property.
  for (const key of [
    "translationProvider",
    "translationRemoteUrl",
    "dictationAgentRemoteUrl",
    "dictationAgentVisionProvider",
    "cleanupCloudMode",
  ]) {
    assert.ok(SESSION_ROUTE_KEYS.includes(key), key);
  }
  assert.equal(
    SESSION_ROUTE_KEYS.includes("dictationAgent"),
    false,
    "fallbackScope is not a settings key"
  );
});

test("the operation is the session's own credential-free snapshot and tags", async (t) => {
  const { captureDictationSession, sessionOperation, isCredentialKey } = await load(t);
  const session = captureDictationSession({
    settings: live,
    intents: {},
    agentName: "Loqui",
    id: "rec-2",
  });
  const operation = sessionOperation(session);
  assert.deepEqual(operation, {
    sessionId: "rec-2",
    settings: session.settings,
    requestOptions: session.requestOptions,
    enterpriseRecipientTags: {},
    presentation: { routes: session.routes, intents: session.intents },
  });
  assert.equal(operation.settings, session.settings, "no copy that could drift");
  assert.equal(Object.isFrozen(operation), true);
  assert.equal(Object.isFrozen(operation.enterpriseRecipientTags), true);
  for (const key of Object.keys(operation.settings)) assert.equal(isCredentialKey(key), false, key);
});

test("a session context keeps its first reads and forgets them on release", async (t) => {
  const { createSessionContext } = await load(t);
  const selection = Promise.resolve({ status: "selected", sessionId: "sel-1", text: "old" });
  const screen = Promise.resolve({ data: "A", mediaType: "image/png" });
  const context = createSessionContext({ sessionId: "rec-1", selection, screen });
  assert.equal(context.selection(), selection);
  assert.equal(context.screen(), screen);
  const later = Promise.resolve({ status: "selected", sessionId: "sel-2", text: "new" });
  assert.equal(context.adoptSelection(later), later);
  assert.equal(context.selection(), selection, "a later read never replaces the session's own");
  assert.equal(context.restored, false);
  context.markRestored();
  assert.equal(context.restored, true);
  context.release();
  assert.equal(context.selection(), null);
  assert.equal(context.screen(), null);
  assert.equal(context.released, true);
  assert.equal(context.adoptSelection(later), later);
  assert.equal(context.selection(), null, "a released context adopts nothing");
});

test("absent routing and prompts stay absent; mutable intent context is detached", async (t) => {
  const { captureDictationSession, sessionSettings } = await load(t);
  const context = { text: "original", nested: { word: "first" } };
  const session = captureDictationSession({
    settings: { ...live, cleanupCloudBaseUrl: undefined },
    intents: { assistantSelectionContext: context },
  });
  context.nested.word = "later";
  assert.equal(Object.isFrozen(context), false);
  assert.equal(session.intents.assistantSelectionContext.nested.word, "first");
  const view = sessionSettings(session, {
    cleanupCloudBaseUrl: "https://later.example",
    voiceAgentScreenContext: true,
  });
  assert.equal(view.cleanupCloudBaseUrl, undefined);
  assert.equal(view.voiceAgentScreenContext, undefined);
});
