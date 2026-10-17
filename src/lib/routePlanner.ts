import { INFERENCE_SCOPES } from "../config/inferenceScopes";
import { resolveTranscriptionRoute } from "../helpers/transcriptionRoute";
import { isProviderValidForMode } from "../models/ModelRegistry";
import type { SettingsState } from "../stores/settingsStore";
import type {
  EnterpriseRouteSettings,
  InferenceMode,
  LocalTranscriptionProvider,
} from "../types/electron";
import { adjustBedrockModelForRegion } from "../utils/bedrockRegions";
import { readProviderSearchPreference, supportsProviderSearch } from "../utils/providerSearch";
import {
  ENTERPRISE_PROVIDER_IDS,
  ROUTE_PATCH_KEY_SET,
  bedrockCoupledModelKeys,
  defaultCloudModel,
  planEnterpriseCoupling,
  planReasoningProviderSwitch,
  planTranscriptionProviderSwitch,
  providerSearchScope,
  resolvedScopeField,
  type SettingsPatch,
} from "./providerSwitchPlans";
import {
  buildRouteSnapshot,
  resolveRoutes,
  routePayloadParts,
  type LlmRouteScope,
  type ResolvedRoute,
  type RouteCopy,
  type RouteFacts,
  type RouteId,
  type RouteSettingsSnapshot,
  type SttContext,
} from "./routes";

// The route planner (SET-R3 B). One simulated patch is the preview, the
// commit and (through undoPatch) the Undo, so they cannot disagree. It lists
// every route among the 11 whose effective result changes, including routes
// coupled by inheritance. Pure: it never writes the store.

export type RouteTarget =
  | { mode: "local"; provider?: string; model?: string }
  | { mode: "providers"; provider: string; model?: string; baseUrl?: string } // enterprise providers map to mode "enterprise"
  | { mode: "self-hosted"; remoteUrl: string; model?: string };

export interface RouteChange {
  id: RouteId;
  before: ResolvedRoute;
  after: ResolvedRoute;
  coupled: boolean; // not the requested route
}

export type ApplyBlocker =
  "needsKey" | "chooseProvider" | "needsUrl" | "needsModel" | "sealed" | "unknown" | "unsupported";

export interface RoutePlan {
  routeId: RouteId;
  enterpriseBase: EnterpriseRouteSettings; // exact non-secret tuple this preview/review was computed against; Task 7 passes it unchanged to the main CAS
  patch: SettingsPatch;
  undoPatch: SettingsPatch;
  changes: RouteChange[];
  kind: "noop" | "instant" | "staged";
  blocker: ApplyBlocker | null;
}

export interface PlanContext {
  facts: RouteFacts;
  copy: RouteCopy;
  sealed: boolean;
}

// Providers whose setup (Codex sign-in; enterprise endpoint, region, project
// and credentials) happens in the provider editor, which the staged editor
// shows before Apply (R2-9). Copy only ("sign in here first", Task 8): it
// never unblocks Apply.
export const SETUP_AFTER_APPLY: ReadonlySet<string> = new Set([
  "codex",
  ...ENTERPRISE_PROVIDER_IDS,
]);

type Patch = Record<string, unknown>;
type ProvidersTarget = Extract<RouteTarget, { mode: "providers" }>;

const STT_CONTEXT_OF: Partial<Record<RouteId, SttContext>> = {
  dictationStt: "dictation",
  noteRecordingStt: "meeting",
  uploadStt: "upload",
};

const LLM_SCOPE_OF: Partial<Record<RouteId, LlmRouteScope>> = {
  dictationCleanup: "dictationCleanup",
  voiceAssistant: "dictationAgent",
  assistantVision: "dictationAgentVision",
  translation: "dictationTranslation",
  noteFormatting: "noteFormatting",
  chat: "chatIntelligence",
};

interface SttKeys {
  mode: keyof SettingsState;
  useLocal: keyof SettingsState;
  cloudMode: keyof SettingsState;
  localProvider: keyof SettingsState;
  localModel: Record<LocalTranscriptionProvider, keyof SettingsState>;
  cloudProvider: keyof SettingsState;
  cloudModel: keyof SettingsState;
  cloudBaseUrl: keyof SettingsState;
  remoteUrl: keyof SettingsState | null;
  remoteModel: keyof SettingsState | null;
}

// The keys each STT context's mode handler writes (SettingsPage.tsx:526-533,
// MeetingSettings.tsx:87-95, UploadSettings.tsx:68-74).
const STT_KEYS: Record<SttContext, SttKeys> = {
  dictation: {
    mode: "transcriptionMode",
    useLocal: "useLocalWhisper",
    cloudMode: "cloudTranscriptionMode",
    localProvider: "localTranscriptionProvider",
    localModel: { whisper: "whisperModel", nvidia: "parakeetModel", cohere: "cohereModel" },
    cloudProvider: "cloudTranscriptionProvider",
    cloudModel: "cloudTranscriptionModel",
    cloudBaseUrl: "cloudTranscriptionBaseUrl",
    remoteUrl: "remoteTranscriptionUrl",
    remoteModel: "remoteTranscriptionModel",
  },
  meeting: {
    mode: "meetingTranscriptionMode",
    useLocal: "meetingUseLocalWhisper",
    cloudMode: "meetingCloudTranscriptionMode",
    localProvider: "meetingLocalTranscriptionProvider",
    localModel: {
      whisper: "meetingWhisperModel",
      nvidia: "meetingParakeetModel",
      cohere: "meetingCohereModel",
    },
    cloudProvider: "meetingCloudTranscriptionProvider",
    cloudModel: "meetingCloudTranscriptionModel",
    cloudBaseUrl: "meetingCloudTranscriptionBaseUrl",
    remoteUrl: "meetingRemoteTranscriptionUrl",
    remoteModel: null,
  },
  // Upload has no server of its own. It reads dictation's URL and model
  // (UploadSettings.tsx:132-138), so an upload target never writes them.
  upload: {
    mode: "uploadTranscriptionMode",
    useLocal: "uploadUseLocalWhisper",
    cloudMode: "uploadCloudTranscriptionMode",
    localProvider: "uploadLocalTranscriptionProvider",
    localModel: {
      whisper: "uploadWhisperModel",
      nvidia: "uploadParakeetModel",
      cohere: "uploadCohereModel",
    },
    cloudProvider: "uploadCloudTranscriptionProvider",
    cloudModel: "uploadCloudTranscriptionModel",
    cloudBaseUrl: "uploadCloudTranscriptionBaseUrl",
    remoteUrl: null,
    remoteModel: null,
  },
};

const merged = (state: SettingsState, patch: Patch) => ({ ...state, ...patch }) as SettingsState;

function sttTargetPatch(state: SettingsState, context: SttContext, target: RouteTarget): Patch {
  const k = STT_KEYS[context];
  const patch: Patch = {
    [k.mode]: target.mode,
    [k.useLocal]: target.mode === "local",
    [k.cloudMode]: "byok",
  };
  if (target.mode === "local") {
    if (target.provider !== undefined) patch[k.localProvider] = target.provider;
    if (target.model !== undefined) {
      const provider = (target.provider ?? state[k.localProvider]) as LocalTranscriptionProvider;
      patch[k.localModel[provider] ?? k.localModel.whisper] = target.model;
    }
    return patch;
  }
  if (target.mode === "providers") {
    if (target.provider) {
      Object.assign(
        patch,
        planTranscriptionProviderSwitch(merged(state, patch), context, target.provider)
      );
    } else {
      patch[k.cloudProvider] = "";
    }
    if (target.model !== undefined) patch[k.cloudModel] = target.model;
    if (target.baseUrl !== undefined) patch[k.cloudBaseUrl] = target.baseUrl;
    return patch;
  }
  if (k.remoteUrl) patch[k.remoteUrl] = target.remoteUrl;
  if (k.remoteModel && target.model !== undefined) patch[k.remoteModel] = target.model;
  return patch;
}

function providerPatch(
  state: SettingsState,
  scope: LlmRouteScope,
  target: ProvidersTarget,
  options: { vision: boolean; mode: InferenceMode }
): Patch {
  const keys = INFERENCE_SCOPES[scope].storeKeys as Record<string, string>;
  let patch: Patch;
  if (target.provider) {
    patch = {
      ...planReasoningProviderSwitch(
        state,
        scope,
        target.provider,
        defaultCloudModel(target.provider, { vision: options.vision })
      ),
    };
  } else {
    // "Choose a provider". Like InferenceConfigEditor.tsx:109-112, a model
    // whose provider the new mode cannot use goes with it.
    patch = { [keys.provider]: "" };
    if (!isProviderValidForMode(resolvedScopeField(state, scope, "provider"), options.mode)) {
      patch[keys.model] = "";
    }
  }
  if (target.model !== undefined) {
    patch[keys.model] = target.model;
  } else if (target.provider === "bedrock" && typeof patch[keys.model] === "string") {
    // R2-1: a remembered or default Bedrock profile id follows the region the
    // state holds (bedrockRegions.ts), so switching to Bedrock in eu-west-1 never
    // previews or commits a us.* profile. A caller that stages a region together
    // with a target plans the target against the state with that region applied.
    patch[keys.model] = adjustBedrockModelForRegion(
      patch[keys.model] as string,
      state.bedrockRegion || "us-east-1"
    );
  }
  if (target.baseUrl !== undefined && keys.cloudBaseUrl) patch[keys.cloudBaseUrl] = target.baseUrl;
  return patch;
}

function llmTargetPatch(state: SettingsState, scope: LlmRouteScope, target: RouteTarget): Patch {
  const keys = INFERENCE_SCOPES[scope].storeKeys as Record<string, string>;

  if (scope === "dictationAgentVision") {
    if (target.mode !== "providers") {
      throw new Error("Assistant vision runs on a provider: use a providers target");
    }
    // Only the override flag and the vision provider, model and endpoint. Never
    // screen context, never the vision mode (settingsStore.ts:1757-1758).
    const patch: Patch = {
      useDictationAgentVisionModel: true,
      ...providerPatch(state, scope, target, { vision: true, mode: "providers" }),
    };
    // dictationAgentInference.js:72 treats the override as chosen only when
    // its own model is set; a switch that keeps the inherited model must write it.
    const after = merged(state, patch);
    if (!after.dictationAgentVisionModel) {
      patch.dictationAgentVisionModel =
        resolvedScopeField(after, scope, "model") ||
        defaultCloudModel(target.provider, { vision: true });
    }
    return patch;
  }

  const currentMode = state[keys.mode as keyof SettingsState] as InferenceMode;

  if (target.mode === "local") {
    const patch: Patch = { [keys.mode]: "local", [keys.cloudMode]: "byok" };
    if (target.provider !== undefined) {
      const current = resolvedScopeField(state, scope, "provider");
      patch[keys.provider] = target.provider;
      patch[keys.model] =
        target.model ??
        (target.provider === current ? resolvedScopeField(state, scope, "model") : "");
      return patch;
    }
    // InferenceConfigEditor.tsx:109-112: a provider the new mode cannot use is cleared with its model.
    if (!isProviderValidForMode(resolvedScopeField(state, scope, "provider"), "local")) {
      patch[keys.provider] = "";
      patch[keys.model] = "";
    }
    if (target.model !== undefined) patch[keys.model] = target.model;
    return patch;
  }

  if (target.mode === "self-hosted") {
    const patch: Patch = {
      [keys.mode]: "self-hosted",
      [keys.cloudMode]: "byok",
      [keys.remoteUrl]: target.remoteUrl,
    };
    // A cloud or local model id means nothing to your server.
    if (target.model !== undefined) patch[keys.model] = target.model;
    else if (currentMode !== "self-hosted") patch[keys.model] = "";
    return patch;
  }

  const mode: InferenceMode = ENTERPRISE_PROVIDER_IDS.has(target.provider)
    ? "enterprise"
    : "providers";
  const patch: Patch = { [keys.mode]: mode, [keys.cloudMode]: "byok" };
  return Object.assign(
    patch,
    providerPatch(merged(state, patch), scope, target, { vision: false, mode })
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  if ((a && typeof a === "object") || (b && typeof b === "object")) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  return a === b;
}

function fingerprint(route: ResolvedRoute): string {
  return JSON.stringify([
    route.locality,
    route.providerId,
    route.host,
    route.model,
    route.sends,
    route.state,
  ]);
}

// The value a patch key holds now. The web-search preference is not a store
// field; its current value is the localStorage preference.
function currentValue(state: SettingsState, key: string): unknown {
  const scope = providerSearchScope(key);
  return scope ? readProviderSearchPreference(scope) : (state as unknown as Patch)[key];
}

// buildRouteSnapshot reads the web-search preference from localStorage, which
// a simulated patch has not written. Apply the patched preference here, with
// the request path's own support rule, so the preview is what commit sends.
function withPatchedSearch(snapshot: RouteSettingsSnapshot, written: Patch): RouteSettingsSnapshot {
  let llm = snapshot.llm;
  for (const [key, value] of Object.entries(written)) {
    const scope = providerSearchScope(key);
    if (!scope) continue;
    const input = llm[scope];
    llm = {
      ...llm,
      [scope]: {
        ...input,
        providerSearch: value === true && supportsProviderSearch(scope, input.provider, input.mode),
      },
    };
  }
  return llm === snapshot.llm ? snapshot : { ...snapshot, llm };
}

// Display hosts deliberately omit paths. Review identity must retain the
// effective endpoint, including inherited settings, without exposing credentials.
function endpointIdentity(route: ResolvedRoute, snapshot: RouteSettingsSnapshot): string | null {
  if (route.state.status === "off" || route.locality === "device") return null;
  const context = STT_CONTEXT_OF[route.id];
  if (context) {
    // Meeting has no custom/self-hosted executor. Never invent a transport for it.
    if (context === "meeting") return null;
    const input = snapshot.stt[context];
    const resolved = resolveTranscriptionRoute({
      settings: {
        transcriptionMode: input.mode.trim(),
        useLocalWhisper: false,
        remoteTranscriptionUrl: input.remoteUrl.trim(),
        remoteTranscriptionModel: input.remoteModel,
        cloudTranscriptionProvider: input.cloudProvider.trim(),
        cloudTranscriptionModel: input.cloudModel,
        cloudTranscriptionBaseUrl: input.cloudBaseUrl,
      },
      providers: snapshot.capabilities.transcriptionProviderBaseUrls,
    });
    // Reuse the executor's normalization, suffixes and Azure deployment rules.
    return resolved.transport === "http-batch" ? new URL(resolved.endpoint).href : null;
  }
  const scope =
    route.id === "assistantVision" && !snapshot.enabled.visionOverride
      ? "dictationAgent"
      : LLM_SCOPE_OF[route.id];
  if (!scope) return null;
  const input = snapshot.llm[scope];
  const mode = input.mode.trim();
  const provider = input.provider.trim();
  try {
    if ((mode === "providers" || mode === "enterprise") && provider === "azure") {
      // enterpriseAiProviders uses createAzure's default responses model, with
      // no deployment-based URL option. @ai-sdk/azure 4.0.79 classifies the base
      // first, but appends to the RAW base before parsing the request URL. Parsing
      // the base alone loses terminal dot segments and meaningful separators.
      const raw = snapshot.enterprise.azureEndpoint;
      const base = new URL(raw);
      const azureHost = [
        ".openai.azure.com",
        ".services.ai.azure.com",
        ".cognitiveservices.azure.com",
      ].some((suffix) => base.hostname.endsWith(suffix));
      const pathname = base.pathname.replace(/\/+$/, "");
      const versioned = azureHost && pathname.toLowerCase().endsWith("/openai/v1");
      const target = new URL(
        `${raw.replace(/\/$/, "")}${azureHost && !versioned ? "/v1" : ""}/responses`
      );
      const foundry =
        base.hostname.endsWith(".services.ai.azure.com") && pathname.startsWith("/api/projects/");
      const configuredApiVersion = azureHost && !versioned && !foundry;
      // The SDK overwrites this query key with the same configured version on
      // both sides. Tag that override separately: the snapshot intentionally
      // excludes API version, so an explicit version is conservatively distinct.
      if (configuredApiVersion) target.searchParams.delete("api-version");
      return JSON.stringify([target.href, configuredApiVersion]);
    }
    const endpoint =
      mode === "self-hosted"
        ? input.remoteUrl
        : mode === "providers" && provider === "custom"
          ? input.cloudBaseUrl
          : null;
    // personalInference.validateRequest canonicalizes the URL and removes one
    // trailing slash, then createOpenAI removes one more. Do not collapse all
    // slashes: additional path separators can select another gateway recipient.
    return endpoint === null ? null : new URL(endpoint).href.replace(/\/$/, "").replace(/\/$/, "");
  } catch {
    // Invalid inputs remain governed by the graph's readiness/unknown blockers.
    return null;
  }
}

function endpointEdit(
  before: ResolvedRoute,
  after: ResolvedRoute,
  beforeSnapshot: RouteSettingsSnapshot,
  afterSnapshot: RouteSettingsSnapshot
): boolean {
  return endpointIdentity(before, beforeSnapshot) !== endpointIdentity(after, afterSnapshot);
}

// Instant when nothing new leaves the device: the route is off or ends on the
// device, or it keeps the same effective recipient and
// its payload did not grow. Turning on a route that leaves the device adds a
// recipient. An off-device recipient the graph cannot name (host null, or
// state `unknown`) is never assumed to be the same one (R2-1 staging gap).
function addsNoRecipientOrPayload(
  change: RouteChange,
  beforeSnapshot: RouteSettingsSnapshot,
  afterSnapshot: RouteSettingsSnapshot,
  recipientInputChanged: boolean
): boolean {
  const { before, after } = change;
  // An off route sends nothing, whatever it is configured to use.
  if (after.state.status === "off") return true;
  if (after.locality === "device") return true;
  if (before.state.status === "off") return false;
  if (recipientInputChanged) return false;
  // R2-1 staging gap: until Task 3 syncs facts.enterpriseMain, and while
  // Vertex's key presence is null, enterprise routes resolve `unknown` with
  // host null on both sides, so null === null let an Azure endpoint, Bedrock
  // region or Vertex location edit commit unreviewed. An unnamed recipient is
  // a recipient change: the edit stages, and Apply's `unknown` blocker holds
  // it until the facts load.
  if (before.host === null || after.host === null) return false;
  if (before.state.status === "unknown" || after.state.status === "unknown") return false;
  if (
    after.locality !== before.locality ||
    after.providerId !== before.providerId ||
    after.host !== before.host
  ) {
    return false;
  }
  const had = new Set<string>(routePayloadParts(change.id, beforeSnapshot));
  return routePayloadParts(change.id, afterSnapshot).every((part) => had.has(part));
}

// R2-1 staging gap: the enterprise settings each provider's host is derived
// from (Task 1's enterpriseRequestHost). While a route's recipient is unnamed,
// both fingerprints read `unknown`/null whatever these hold, so a write to one
// of them is listed as a change explicitly; otherwise it would never reach
// addsNoRecipientOrPayload and the empty change list would read as instant.
const ENTERPRISE_RECIPIENT_KEYS: Readonly<Record<string, readonly string[]>> = {
  bedrock: ["bedrockRegion"],
  azure: ["azureEndpoint"],
  vertex: ["vertexProject", "vertexLocation", "vertexAuthSource"],
};

function recipientUnnamed(route: ResolvedRoute): boolean {
  return (
    route.locality !== "device" &&
    route.state.status !== "off" &&
    (route.host === null || route.state.status === "unknown")
  );
}

function writesRecipientInput(route: ResolvedRoute, written: Patch): boolean {
  const keys = route.providerId ? ENTERPRISE_RECIPIENT_KEYS[route.providerId] : undefined;
  return keys !== undefined && keys.some((key) => key in written);
}

// Account, source and authentication paths are recipients even when a display host is equal.
function recipientInputEdit(before: ResolvedRoute, after: ResolvedRoute, written: Patch): boolean {
  for (const route of [before, after]) {
    if (route.state.status === "off" || route.locality === "device") continue;
    if (
      route.providerId === "vertex" &&
      ["vertexProject", "vertexAuthSource"].some((key) => key in written)
    )
      return true;
    if (
      route.providerId === "corti" &&
      ["dictationStt", "noteRecordingStt", "uploadStt"].includes(route.id) &&
      ["cortiEnvironment", "cortiTenant"].some((key) => key in written)
    )
      return true;
  }
  return false;
}

function unnamedRecipientEdit(
  before: ResolvedRoute,
  after: ResolvedRoute,
  written: Patch
): boolean {
  return (
    (recipientUnnamed(before) || recipientUnnamed(after)) &&
    (writesRecipientInput(before, written) || writesRecipientInput(after, written))
  );
}

const BLOCKER_PRIORITY: ApplyBlocker[] = [
  "sealed",
  "unknown",
  "chooseProvider",
  "needsKey",
  "needsUrl",
  "unsupported",
  "needsModel",
];

// R2-9: Apply waits until every changed, enabled, off-device route would run.
// Device routes (on-device changes stay instant) and off routes never block.
// Model choice and provider setup (Codex sign-in, enterprise fields, keys,
// Corti fields) are reachable in the staged editor before Apply, so no
// provider is exempt.
function routeBlocker(route: ResolvedRoute): ApplyBlocker | null {
  if (route.locality === "device") return null;
  const state = route.state;
  switch (state.status) {
    case "ready":
    case "off":
      return null;
    case "unknown":
      return "unknown";
    case "needsUrl":
      return "needsUrl";
    case "unreachable":
      return state.detail === "sealed" ? "sealed" : "unsupported";
    case "needsKey":
      return state.provider === "" ? "chooseProvider" : "needsKey";
    case "needsModel":
      return "needsModel";
    default:
      return "unsupported";
  }
}

export function planPatch(
  state: SettingsState,
  ctx: PlanContext,
  routeId: RouteId,
  patch: SettingsPatch
): RoutePlan {
  // R2-1: coupled writes (a Bedrock region's model rewrite) join the patch
  // before diffing, so the preview, the commit and the undoPatch all carry them.
  const expanded: SettingsPatch = { ...patch, ...planEnterpriseCoupling(state, patch) };
  const written: Patch = {};
  const undo: Patch = {};
  for (const [key, value] of Object.entries(expanded)) {
    if (value === undefined) continue;
    if (!ROUTE_PATCH_KEY_SET.has(key)) throw new Error(`Route patches cannot write ${key}`);
    const now = currentValue(state, key);
    if (sameValue(now, value)) continue;
    written[key] = value;
    undo[key] = now;
  }
  // A region change pins every Bedrock model it could rewrite into the Undo
  // (at its current value), so re-planning undoPatch couples nothing new and
  // restores exactly the starting keys, even a profile id that never matched.
  if ("bedrockRegion" in written) {
    for (const key of bedrockCoupledModelKeys(merged(state, written))) {
      if (!(key in undo)) undo[key as string] = state[key];
    }
  }
  const enterpriseBase: EnterpriseRouteSettings = {
    bedrockRegion: state.bedrockRegion || "us-east-1",
    azureEndpoint: state.azureEndpoint || "",
    vertexProject: state.vertexProject || "",
    vertexLocation: state.vertexLocation || "us-central1",
    vertexAuthSource: state.vertexAuthSource,
  };
  if (Object.keys(written).length === 0) {
    return {
      routeId,
      enterpriseBase,
      patch: {},
      undoPatch: {},
      changes: [],
      kind: "noop",
      blocker: null,
    };
  }

  const beforeSnapshot = buildRouteSnapshot(state, ctx.facts, ctx.copy, ctx.sealed);
  const afterSnapshot = withPatchedSearch(
    buildRouteSnapshot(merged(state, written), ctx.facts, ctx.copy, ctx.sealed),
    written
  );
  const afterById = new Map(resolveRoutes(afterSnapshot).map((route) => [route.id, route]));
  const changes: RouteChange[] = [];
  for (const before of resolveRoutes(beforeSnapshot)) {
    const after = afterById.get(before.id);
    if (!after) continue;
    // R2-1 staging gap: an enterprise field edit on a route whose host is not
    // known yet leaves both fingerprints equal; it is still a recipient edit.
    if (
      fingerprint(after) !== fingerprint(before) ||
      unnamedRecipientEdit(before, after, written) ||
      recipientInputEdit(before, after, written) ||
      endpointEdit(before, after, beforeSnapshot, afterSnapshot)
    ) {
      changes.push({ id: before.id, before, after, coupled: before.id !== routeId });
    }
  }
  changes.sort((a, b) => Number(a.coupled) - Number(b.coupled));

  const instant = changes.every((change) =>
    addsNoRecipientOrPayload(
      change,
      beforeSnapshot,
      afterSnapshot,
      recipientInputEdit(change.before, change.after, written) ||
        endpointEdit(change.before, change.after, beforeSnapshot, afterSnapshot)
    )
  );
  const found = new Set(changes.map((change) => routeBlocker(change.after)));
  const blocker = BLOCKER_PRIORITY.find((candidate) => found.has(candidate)) ?? null;

  return {
    routeId,
    enterpriseBase,
    patch: written as SettingsPatch,
    undoPatch: undo as SettingsPatch,
    changes,
    kind: instant ? "instant" : "staged",
    blocker,
  };
}

export function planRouteChange(
  state: SettingsState,
  ctx: PlanContext,
  id: RouteId,
  target: RouteTarget
): RoutePlan {
  const context = STT_CONTEXT_OF[id];
  const scope = LLM_SCOPE_OF[id];
  if (!context && !scope) {
    throw new Error(`${id} always runs on this device; it has no destination to change`);
  }
  const patch = context
    ? sttTargetPatch(state, context, target)
    : llmTargetPatch(state, scope, target);
  return planPatch(state, ctx, id, patch as SettingsPatch);
}
