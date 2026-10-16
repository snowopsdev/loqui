import { create } from "zustand";
import type { EnterpriseRouteState } from "../types/electron";
import { normalizeRouteVerificationOptions } from "../helpers/routeVerificationOptions.mjs";
import type {
  CredentialId,
  CredentialSlot,
  EnterpriseMainFacts,
  RouteFacts,
  RouteHealthMetadata,
  RouteVerificationOptions,
} from "../lib/routeGraph";
import {
  enterpriseRouteVersion,
  enterpriseSettingsAreConfirmed,
  ensureEnterpriseRouteSubscribed,
  reconcileEnterpriseRouteState,
  subscribeEnterpriseAuthority,
  useSettingsStore,
} from "./settingsStore";

// Facts the route resolver needs that the settings store does not hold.
// Every call here is local to this machine: model inventories on disk, main's
// credential presence (Codex = a file stat in main) and keyring health. Never
// codexStatus, model discovery or key verification (spec rule: route-fact
// loading makes no automatic network calls).
//
// Each fact is loaded and published on its own. A failed or malformed answer
// keeps the previous value; a fact is null only until main first answers.
// Per-key generations stop an older response from overwriting a newer one.

export type RouteFactKey =
  | "whisper"
  | "sherpa"
  | "sherpaCapability"
  | "llm"
  | "speakerId"
  | "search"
  | "credentials"
  | "rejected"
  | "enterprise";

export const ROUTE_FACT_KEYS: readonly RouteFactKey[] = [
  "whisper",
  "sherpa",
  "sherpaCapability",
  "llm",
  "speakerId",
  "search",
  "credentials",
  "rejected",
  "enterprise",
];

interface ModelListResult {
  success?: boolean;
  models?: { model: string; downloaded: boolean }[];
}
interface CredentialRow {
  id: CredentialSlot;
  present: boolean;
  generation: number;
  // Per-field presence, never values (Task 2). Vertex's `key` changes readiness only.
  fields?: Record<string, boolean>;
  unknown?: boolean;
}

export interface RouteFactsApi {
  listWhisperModels?: () => Promise<ModelListResult>;
  checkParakeetInstallation?: () => Promise<{ supported?: boolean }>;
  listParakeetModels?: () => Promise<ModelListResult>;
  modelGetAll?: () => Promise<{ id: string; isDownloaded?: boolean }[]>;
  getDiarizationModelStatus?: () => Promise<{ modelsDownloaded?: boolean }>;
  getSearchModelStatus?: () => Promise<{ downloaded?: boolean }>;
  credentials?: {
    list?: () => Promise<CredentialRow[]>;
    onChanged?: (callback: (event: CredentialRow) => void) => (() => void) | void;
  };
  keyring?: {
    // Optional Task11 forward contract. Legacy list statuses have no bound authority.
    routeHealth?: (options?: RouteVerificationOptions) => Promise<RouteHealthMetadata>;
    list?: () => Promise<{ id: CredentialId; status: string }[]>;
    onChanged?: (callback: () => void) => (() => void) | void;
  };
  // R2-1/R3-1: main's enterprise settings (including migrated Vertex source) and its
  // environment overrides (enterprise-route-facts). All local reads.
  getEnterpriseRouteState?: () => Promise<EnterpriseRouteState>;
  getBedrockRegion?: () => Promise<string | null>;
  getAzureEndpoint?: () => Promise<string | null>;
  getVertexProject?: () => Promise<string | null>;
  getVertexLocation?: () => Promise<string | null>;
  getVertexAuthSource?: () => Promise<"adc" | "apiKey" | null>;
  enterpriseRouteFacts?: () => Promise<EnterpriseMainFacts>;
}

export const EMPTY_ROUTE_FACTS: RouteFacts = {
  installed: { whisper: null, sherpa: null, llm: null },
  sherpaSupported: null,
  credentials: null,
  credentialFields: null,
  credentialUnknown: new Set(),
  credentialGenerations: new Map(),
  enterpriseMain: null,
  rejected: new Set<CredentialId>(),
  speakerIdModelsReady: null,
  searchModelReady: null,
};

export const useRouteFactsStore = create<{ facts: RouteFacts }>()(() => ({
  facts: EMPTY_ROUTE_FACTS,
}));

const requested: Partial<Record<RouteFactKey, number>> = {};
const published: Partial<Record<RouteFactKey, number>> = {};

async function track<T, V>(
  key: RouteFactKey,
  call: () => Promise<T> | undefined,
  read: (raw: T) => V | undefined,
  apply: (facts: RouteFacts, value: V) => RouteFacts
): Promise<void> {
  const generation = (requested[key] = (requested[key] ?? 0) + 1);
  let value: V | undefined;
  try {
    const pending = call();
    if (!pending) return; // this build has no such call; the fact stays as it is
    value = read(await pending);
  } catch {
    return; // transient failure: keep the last known value
  }
  if (value === undefined || generation <= (published[key] ?? 0)) return;
  published[key] = generation;
  useRouteFactsStore.setState((s) => ({ facts: apply(s.facts, value) }));
}

function downloadedIds(result: ModelListResult | undefined): Set<string> | undefined {
  if (!result || result.success === false || !Array.isArray(result.models)) return undefined;
  return new Set(result.models.filter((m) => m.downloaded).map((m) => m.model));
}

function withInstalled(
  facts: RouteFacts,
  family: "whisper" | "sherpa" | "llm",
  ids: ReadonlySet<string>
): RouteFacts {
  return { ...facts, installed: { ...facts.installed, [family]: ids } };
}

// Main's per-credential generation orders presence updates, so a list read
// before a save can never undo the save's event.
const credentialGenerations = new Map<CredentialSlot, number>();
let credentialEventOrder = 0;
const pendingCredentialEvents = new Map<CredentialSlot, { row: CredentialRow; order: number }>();
const activeCredentialLists = new Map<symbol, number>();

function retireCredentialEvents(): void {
  // Before the first full inventory, buffered events are the only copy of
  // slots main has reported. Once known, facts retain their generation fence.
  if (useRouteFactsStore.getState().facts.credentials === null) return;
  for (const [id, event] of pendingCredentialEvents) {
    if (![...activeCredentialLists.values()].some((startedAt) => startedAt < event.order)) {
      pendingCredentialEvents.delete(id);
    }
  }
}

async function loadCredentials(api: RouteFactsApi): Promise<void> {
  const request = Symbol();
  const startedAt = credentialEventOrder;
  activeCredentialLists.set(request, startedAt);
  try {
    await track(
      "credentials",
      () => api.credentials?.list?.(),
      (rows) => (Array.isArray(rows) ? rows : undefined),
      (facts, rows) => {
        const listedGenerations = new Map(
          rows
            .filter((row) => row && typeof row.id === "string")
            .map((row) => [row.id, typeof row.generation === "number" ? row.generation : 0])
        );
        const events = [...pendingCredentialEvents.values()]
          .filter(
            ({ row, order }) =>
              // Equal generations may change on refresh/stat: only events after
              // this read started can override its equally current answer.
              order > startedAt || row.generation > (listedGenerations.get(row.id) ?? -1)
          )
          .map(({ row }) => row);
        return mergeCredentials(facts, [...rows, ...events]);
      }
    );
  } finally {
    activeCredentialLists.delete(request);
    // Retire only events no remaining older read needs. Clearing the entire
    // buffer after one answer would expose another overlapping stale answer.
    retireCredentialEvents();
  }
}

// Only booleans survive: a row can never smuggle a value into renderer state.
function presentFields(fields: unknown): Record<string, boolean> {
  if (!fields || typeof fields !== "object") return {};
  return Object.fromEntries(
    Object.entries(fields as Record<string, unknown>).map(([name, present]) => [
      name,
      present === true,
    ])
  );
}

const sameFields = (a: Readonly<Record<string, boolean>> | undefined, b: Record<string, boolean>) =>
  a !== undefined && JSON.stringify(a) === JSON.stringify(b);

// Presence and field presence move together under one generation, so the
// graph never sees a Vertex key field from a different moment than its presence.
function mergeCredentials(facts: RouteFacts, rows: readonly CredentialRow[]): RouteFacts {
  const next = new Map(facts.credentials ?? []);
  const nextFields = new Map(facts.credentialFields ?? []);
  const unknown = new Set(facts.credentialUnknown ?? []);
  const previousGenerations = facts.credentialGenerations ?? new Map();
  let changed = facts.credentials === null || facts.credentialFields === null;
  for (const row of rows) {
    if (!row || typeof row.id !== "string") continue;
    const generation = typeof row.generation === "number" ? row.generation : 0;
    if (generation < (credentialGenerations.get(row.id) ?? -1)) continue;
    if (previousGenerations.get(row.id) !== generation) changed = true;
    credentialGenerations.set(row.id, generation);
    if (unknown.has(row.id) !== (row.unknown === true)) changed = true;
    if (row.unknown === true) unknown.add(row.id);
    else unknown.delete(row.id);
    if (next.get(row.id) !== (row.present === true)) changed = true;
    next.set(row.id, row.present === true);
    const fields = presentFields(row.fields);
    if (!sameFields(nextFields.get(row.id), fields)) changed = true;
    nextFields.set(row.id, fields);
  }
  return changed
    ? {
        ...facts,
        credentials: next,
        credentialFields: nextFields,
        credentialUnknown: unknown,
        credentialGenerations: new Map(credentialGenerations),
      }
    : facts;
}

// Only atomic, versioned main state can establish enterprise readiness.
let enterpriseSync: Promise<EnterpriseMainFacts | undefined> | undefined;
let latestEnterpriseFacts: EnterpriseMainFacts | undefined;
let latestEnterpriseFactsVersion = -1;
let enterpriseTracking = false;
function confirmedEnterpriseFacts(): EnterpriseMainFacts | null {
  return enterpriseSettingsAreConfirmed() &&
    latestEnterpriseFactsVersion === enterpriseRouteVersion()
    ? (latestEnterpriseFacts ?? null)
    : null;
}
function ensureEnterpriseTracking(): void {
  ensureEnterpriseRouteSubscribed();
  if (enterpriseTracking) return;
  enterpriseTracking = true;
  subscribeEnterpriseAuthority((state) => {
    if (state && state.version === enterpriseRouteVersion()) {
      const facts = enterpriseMainFacts(state.facts);
      if (state.version > latestEnterpriseFactsVersion) {
        latestEnterpriseFacts = facts;
        latestEnterpriseFactsVersion = state.version;
      }
      // Equal versions repeat one complete authority snapshot; they never
      // replace its facts with a differently configured reply.
    }
    useRouteFactsStore.setState((s) => ({
      facts: {
        ...s.facts,
        enterpriseMain: confirmedEnterpriseFacts(),
      },
    }));
  });
}

function enterpriseMainFacts(raw: unknown): EnterpriseMainFacts | undefined {
  const r = raw as Partial<EnterpriseMainFacts> | null | undefined;
  const endpoint = r?.bedrockEndpoint;
  if (
    !r ||
    !endpoint ||
    typeof endpoint.set !== "boolean" ||
    !(endpoint.host === null || typeof endpoint.host === "string") ||
    typeof r.bedrockProfile !== "boolean" ||
    typeof r.vertexApiKeyEnv !== "boolean" ||
    typeof r.vertexProjectEnv !== "boolean"
  ) {
    return undefined; // malformed: not a fact
  }
  return {
    bedrockEndpoint: { set: endpoint.set, host: endpoint.set ? endpoint.host : null },
    bedrockProfile: r.bedrockProfile,
    vertexApiKeyEnv: r.vertexApiKeyEnv,
    vertexProjectEnv: r.vertexProjectEnv,
  };
}

async function loadEnterpriseMain(api: RouteFactsApi): Promise<EnterpriseMainFacts | undefined> {
  ensureEnterpriseTracking();
  if (!api.getEnterpriseRouteState) {
    // Older five-getter bridges cannot prove a coherent tuple.
    useRouteFactsStore.setState((s) => ({ facts: { ...s.facts, enterpriseMain: null } }));
    return undefined;
  }
  if (!enterpriseSync) {
    enterpriseSync = (async () => {
      const state = await api.getEnterpriseRouteState();
      const facts = enterpriseMainFacts(state?.facts);
      if (!facts) return undefined;
      if (state.version < enterpriseRouteVersion()) return undefined;
      if (
        state.version === latestEnterpriseFactsVersion &&
        JSON.stringify(facts) !== JSON.stringify(latestEnterpriseFacts)
      )
        return undefined;
      if (!reconcileEnterpriseRouteState({ ...state, facts })) return undefined;
      latestEnterpriseFacts = facts;
      return enterpriseSettingsAreConfirmed() ? facts : undefined;
    })().finally(() => {
      enterpriseSync = undefined;
    });
  }
  return enterpriseSync;
}

const LOADERS: Record<RouteFactKey, (api: RouteFactsApi) => Promise<void>> = {
  whisper: (api) =>
    track(
      "whisper",
      () => api.listWhisperModels?.(),
      downloadedIds,
      (f, ids) => withInstalled(f, "whisper", ids)
    ),
  sherpa: (api) =>
    track(
      "sherpa",
      () => api.listParakeetModels?.(),
      downloadedIds,
      (f, ids) => withInstalled(f, "sherpa", ids)
    ),
  sherpaCapability: (api) =>
    track(
      "sherpaCapability",
      () => api.checkParakeetInstallation?.(),
      (raw) => (typeof raw?.supported === "boolean" ? raw.supported : undefined),
      (facts, supported) => ({ ...facts, sherpaSupported: supported })
    ),
  llm: (api) =>
    track(
      "llm",
      () => api.modelGetAll?.(),
      (rows) =>
        Array.isArray(rows)
          ? new Set(rows.filter((m) => m.isDownloaded).map((m) => m.id))
          : undefined,
      (f, ids) => withInstalled(f, "llm", ids)
    ),
  speakerId: (api) =>
    track(
      "speakerId",
      () => api.getDiarizationModelStatus?.(),
      (r) => (typeof r?.modelsDownloaded === "boolean" ? r.modelsDownloaded : undefined),
      (f, ready) => ({ ...f, speakerIdModelsReady: ready })
    ),
  search: (api) =>
    track(
      "search",
      () => api.getSearchModelStatus?.(),
      (r) => (typeof r?.downloaded === "boolean" ? r.downloaded : undefined),
      (f, ready) => ({ ...f, searchModelReady: ready })
    ),
  credentials: loadCredentials,
  rejected: (api) =>
    track(
      "rejected",
      async () => {
        if (api.keyring?.routeHealth) {
          const settings = useSettingsStore.getState();
          const options = {
            cortiEnvironment: settings.cortiEnvironment,
            cortiTenant: settings.cortiTenant,
          };
          const result = await api.keyring.routeHealth(options);
          // Main echoes the normalized options for the query it actually bound.
          // Malformed/mismatched captures never grant rejection authority.
          const expected = normalizeRouteVerificationOptions(options);
          if (
            !result ||
            !Array.isArray(result.current) ||
            !Array.isArray(result.health) ||
            (expected === null
              ? result.options !== null
              : !result.options ||
                result.options.cortiEnvironment !== expected.cortiEnvironment ||
                result.options.cortiTenant !== expected.cortiTenant)
          )
            return undefined;
          return result;
        }
        if (!api.keyring?.list) return undefined;
        await api.keyring.list();
        return null; // pre-Task11 legacy statuses are insufficient authority
      },
      (metadata) => metadata,
      (f, metadata) => ({
        ...f,
        credentialHealth: metadata ?? undefined,
        rejected: new Set<CredentialId>(),
      })
    ),
  enterprise: (api) =>
    track(
      "enterprise",
      () => loadEnterpriseMain(api),
      (value) => value,
      // Recheck at final publication: a synchronous event or newer raw draft
      // can arrive after the atomic read reconciles but before this await resumes.
      (f) => ({ ...f, enterpriseMain: confirmedEnterpriseFacts() })
    ),
};

export async function loadRouteFacts(
  api: RouteFactsApi | undefined,
  keys: readonly RouteFactKey[] = ROUTE_FACT_KEYS
): Promise<void> {
  if (!api) return;
  await Promise.all(keys.map((key) => LOADERS[key](api)));
}

const currentApi = (): RouteFactsApi | undefined =>
  typeof window === "undefined" ? undefined : (window.electronAPI as unknown as RouteFactsApi);

export function refreshRouteFacts(keys: readonly RouteFactKey[] = ROUTE_FACT_KEYS): Promise<void> {
  return loadRouteFacts(currentApi(), keys);
}

function applyCredentialChange(event: CredentialRow): void {
  const previous = pendingCredentialEvents.get(event.id);
  const order = ++credentialEventOrder;
  if (!previous || event.generation >= previous.row.generation)
    pendingCredentialEvents.set(event.id, { row: event, order });
  if (useRouteFactsStore.getState().facts.credentials === null) {
    // Main has not listed presence yet: read the full list rather than
    // assume anything about the credentials this event does not name.
    void refreshRouteFacts(["credentials"]);
  } else {
    useRouteFactsStore.setState((s) => ({ facts: mergeCredentials(s.facts, [event]) }));
  }
  retireCredentialEvents();
  // Main resets a key's health on save and remove; re-read the verdict.
  void refreshRouteFacts(["rejected", "enterprise"]);
}

// Facts change on focus, after model downloads or deletes anywhere
// (LOCAL_MODELS_CHANGED_EVENT, src/hooks/useModelDownload.ts:21; the cache
// clear, src/components/SettingsPage.tsx:1478), and when main reports a
// credential or keyring change.
const REFRESH_EVENTS = ["focus", "openwhispr-models-cleared", "openwhispr-local-models-changed"];

let subscribed = false;
export function ensureRouteFactsSubscribed(): void {
  if (subscribed || typeof window === "undefined") return;
  subscribed = true;
  const api = currentApi();
  api?.credentials?.onChanged?.(applyCredentialChange);
  api?.keyring?.onChanged?.(() => void refreshRouteFacts(["rejected"]));
  void refreshRouteFacts();
  for (const event of REFRESH_EVENTS) {
    window.addEventListener(event, () => void refreshRouteFacts());
  }
}
