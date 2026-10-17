import { INFERENCE_SCOPES } from "../config/inferenceScopes";
import { isProviderSearchEnabled } from "../utils/providerSearch";
import { routeSnapshotFromSettings, resolveRoutes, selectRouteProvider } from "../lib/routes";

function resolveSessionRoutes(settings) {
  try {
    const snapshot = routeSnapshotFromSettings(settings);
    return {
      routes: Object.fromEntries(
        resolveRoutes(snapshot).map((route) => [route.id, structuredClone(route)])
      ),
      // The panel deliberately uses the Agent search preference for its vision
      // override too. Capture both possible targets before screenshot awaits.
      requestOptions: {
        providerSearch: Object.fromEntries(
          ["dictationAgent", "dictationAgentVision"].map((scope) => {
            const input = snapshot.llm[scope];
            return [scope, isProviderSearchEnabled("dictationAgent", input.provider, input.mode)];
          })
        ),
      },
    };
  } catch {
    return { routes: null, requestOptions: { providerSearch: {} } }; // Unknown facts cannot authorize an enterprise request.
  }
}

// Every settings-store key that decides where a dictation's audio or text
// goes, or what prompt it is sent with. Credentials are never captured:
// existing main credential bridges remain authoritative by provider id,
// so a revoked key fails the request instead of rerouting it.
const STT_KEYS = [
  "useLocalWhisper",
  "localTranscriptionProvider",
  "whisperModel",
  "parakeetModel",
  "cohereModel",
  "transcriptionMode",
  "cloudTranscriptionMode",
  "cloudTranscriptionProvider",
  "cloudTranscriptionModel",
  "cloudTranscriptionBaseUrl",
  "remoteTranscriptionUrl",
  "remoteTranscriptionModel",
  "remoteTranscriptionType",
  "cortiEnvironment",
  "cortiTenant",
  "preferredLanguage",
  "translationSourceLanguage",
  "translationTargetLanguage",
  "chineseScriptPreference",
  "customDictionary",
];
const TEXT_FLAG_KEYS = [
  "useCleanupModel",
  "cleanupMode",
  "cleanupProvider",
  "cleanupModel",
  "cleanupCloudBaseUrl",
  "cleanupRemoteUrl",
  "cleanupDisableThinking",
  "useDictationAgent",
  "dictationAgentMode",
  "useDictationAgentVisionModel",
  "dictationAgentVisionModel",
  "dictationAgentVisionCloudBaseUrl",
  "useDictationTranslation",
  "snippets",
  "customPrompts",
  "uiLanguage",
  "autoPasteEnabled",
  "voiceAgentScreenContext",
  "gcalConnected",
  "mcalConnected",
  "appleCalendarConnected",
];
const DICTATION_SCOPES = [
  "dictationCleanup",
  "dictationAgent",
  "dictationAgentVision",
  "dictationTranslation",
];

export function isCredentialKey(key) {
  return /apikey|secret|token|clientid|password|credential/i.test(key);
}

// Each scope's settings keys live under `storeKeys` (inferenceScopes.ts:3-19).
function scopeKeys(scope) {
  return Object.values(INFERENCE_SCOPES[scope]?.storeKeys ?? {});
}

export const SESSION_ROUTE_KEYS = Object.freeze(
  [...new Set([...STT_KEYS, ...TEXT_FLAG_KEYS, ...DICTATION_SCOPES.flatMap(scopeKeys)])].filter(
    (key) => !isCredentialKey(key)
  )
);

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

export function captureDictationSession({
  settings,
  intents = {},
  agentName = "",
  private: isPrivate = false,
  id,
  now = Date.now(),
}) {
  const snapshot = {};
  for (const key of SESSION_ROUTE_KEYS) {
    snapshot[key] = settings[key] === undefined ? undefined : structuredClone(settings[key]);
  }
  const capturedIntents = {
    voiceAgentRequested: Boolean(intents.voiceAgentRequested),
    screenContextRequested: Boolean(
      intents.voiceAgentRequested && settings.voiceAgentScreenContext
    ),
    translationRequested: Boolean(intents.translationRequested),
    streaming: Boolean(intents.streaming),
    streamingProviderName: intents.streamingProviderName ?? null,
    assistantSelectionContext: structuredClone(intents.assistantSelectionContext ?? null),
  };
  // This is synchronous: route facts and the exact user's requested stage set
  // are captured before any UI, target-capture or microphone await.
  const { routes, requestOptions } = resolveSessionRoutes(settings);
  const session = {
    id: id ?? crypto.randomUUID(),
    startedAt: now,
    private: isPrivate === true,
    settings: snapshot,
    agentName,
    intents: capturedIntents,
    routes,
    requestOptions,
  };
  const enterpriseRecipientTags = Object.fromEntries(
    operationEnterpriseRecipients(session).map(({ provider, tag }) => [provider, tag])
  );
  return deepFreeze({ ...session, enterpriseRecipientTags });
}

/** Live settings with every route key pinned to the session's snapshot. */
export function sessionSettings(session, live) {
  return session ? { ...live, ...session.settings } : live;
}

/**
 * The dictation's route for work that outlives its pipeline: the assistant
 * panel answers a banked Agent command on it (R1-C2). Credential-free, because
 * `session.settings` is.
 */
export function sessionOperation(session) {
  return Object.freeze({
    sessionId: session.id,
    presentation: Object.freeze({ routes: session.routes, intents: session.intents }),
    settings: session.settings,
    requestOptions: session.requestOptions,
    // Copy the immutable press-time set, including the optional wake-word
    // Agent route when it was known. Do not resolve facts again in the panel.
    enterpriseRecipientTags: Object.freeze({ ...session.enterpriseRecipientTags }),
  });
}

const ENTERPRISE_PROVIDERS = new Set(["azure", "bedrock", "vertex"]);

function selectedEnterpriseRouteIds(session) {
  const settings = session.settings;
  const routeIds = ["dictationStt"];
  if (settings.useCleanupModel) routeIds.push("dictationCleanup");
  if (session.intents.translationRequested) routeIds.push("translation");
  if (session.intents.voiceAgentRequested) routeIds.push("voiceAssistant");
  if (session.intents.voiceAgentRequested && settings.voiceAgentScreenContext)
    routeIds.push("assistantVision");
  return routeIds;
}

export function operationEnterpriseRecipients(session) {
  // A normal dictation can invoke an Agent later when its transcript contains
  // the wake word. Capture that known route now, but do not make an unknown
  // optional Agent fact block ordinary dictation startup.
  const routeIds = new Set(selectedEnterpriseRouteIds(session));
  if (session.agentName) routeIds.add("voiceAssistant");
  const recipients = new Map();
  for (const routeId of routeIds) {
    const route = session.routes?.[routeId];
    const fact = route?.recipient;
    if (!ENTERPRISE_PROVIDERS.has(route?.providerId) || fact?.status !== "ready") continue;
    recipients.set(route.providerId, fact.tag);
  }
  return [...recipients].map(([provider, tag]) => ({ provider, tag }));
}

export function selectedEnterpriseRecipients(session) {
  const recipients = new Map();
  for (const routeId of selectedEnterpriseRouteIds(session)) {
    const route = session.routes?.[routeId];
    const fact = route?.recipient;
    if (!ENTERPRISE_PROVIDERS.has(route?.providerId)) continue;
    if (fact?.status === "ready") recipients.set(route.providerId, fact.tag);
  }
  return [...recipients].map(([provider, tag]) => ({ provider, tag }));
}

export function hasUnknownSelectedEnterpriseRecipient(session) {
  const selected = selectedEnterpriseRouteIds(session);
  return selected.some((routeId) => {
    const route = session.routes?.[routeId];
    // The selector is the same one `resolveRoute` uses. It still identifies a
    // local/non-enterprise stage when route facts are unavailable; an unresolved
    // route selection itself fails closed.
    const selection = route
      ? { status: "known", providerId: route.providerId }
      : selectRouteProvider(session.settings, routeId);
    if (selection.status === "unknown") return true;
    return ENTERPRISE_PROVIDERS.has(selection.providerId) && route?.recipient?.status !== "ready";
  });
}

/**
 * What the user pointed at when this dictation started: the OS selection read
 * and the screenshot, both requested at press time. One session owns them.
 * They move with the session into the cancel buffer and back on Undo (Task 8),
 * and are released when the session or its undo window ends.
 */
export function createSessionContext({ sessionId, selection = null, screen = null }) {
  let selectionRead = selection;
  let screenRead = screen;
  let restored = false;
  let released = false;
  return {
    sessionId,
    get restored() {
      return restored;
    },
    get released() {
      return released;
    },
    selection: () => selectionRead,
    /** Keep the first read this session takes; a later read never replaces it. */
    adoptSelection(read) {
      if (!released && !selectionRead && read) selectionRead = read;
      return read;
    },
    screen: () => screenRead,
    markRestored() {
      restored = true;
    },
    release() {
      released = true;
      selectionRead = null;
      screenRead = null;
    },
  };
}
