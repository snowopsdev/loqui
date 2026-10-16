import { providerDisplayLabel, providerDisplayName, type Locality } from "../../../lib/locality.ts";
import {
  ROUTE_KIND,
  type CredentialId,
  type ResolvedRoute,
  type RouteFacts,
  type RouteId,
  type RouteSettingsSnapshot,
} from "../../../lib/routeGraph.ts";
import type { RouteTarget } from "../../../lib/routePlanner.ts";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type DestinationKind = "device" | "server" | "addServer" | "custom" | "provider";
export type TaskKind = "speech" | "text";
export type KeyState = "saved" | "missing" | "rejected" | "unknown" | "none";

export interface RouteDestination {
  id: string;
  kind: DestinationKind;
  locality: Locality;
  providerId: string | null;
  host: string | null;
  urls: { speech: string | null; text: string | null };
}

export type Compatibility =
  | { ok: true }
  | {
      ok: false;
      reasonKey: string;
      params?: { provider?: string; server?: string; kind?: TaskKind };
    };

export interface CompatContext {
  sealed: boolean;
  providersFor: (id: RouteId) => readonly string[];
  dictationServerHost: string | null;
}

export const ADD_SERVER_ID = "network:new";

const NO_URLS = { speech: null, text: null } as const;

function hostOf(url: string | null | undefined): string | null {
  if (!url || !url.trim()) return null;
  try {
    return new URL(url.trim()).host || null;
  } catch {
    return null;
  }
}

export function taskKind(routeId: RouteId): TaskKind {
  return ROUTE_KIND[routeId] === "speech" ? "speech" : "text";
}

// Identity is a function of the resolved route alone. A retired service and
// a server route with no usable address have no destination: their chip
// already says why, and a card for them would invent a recipient.
export function destinationKeyOf(
  route: Pick<ResolvedRoute, "locality" | "providerId" | "host" | "state">
): string | null {
  if (route.state.status === "unreachable" && route.state.detail === "retired") return null;
  if (route.locality === "device") return "device";
  if (route.locality === "network") return route.host ? `network:${route.host}` : null;
  if (!route.providerId) return null;
  if (route.providerId === "custom") return route.host ? `custom:${route.host}` : null;
  return route.providerId;
}

// Corti has two credential slots: speech uses the client pair, text uses the
// API key (Task 1). Every other provider is its own slot; "custom" has none.
export function credentialIdFor(
  providerId: string | null,
  kind: ResolvedRoute["kind"] | TaskKind
): CredentialId | null {
  if (!providerId || providerId === "custom") return null;
  if (providerId === "corti") return kind === "speech" ? "corti:speech" : "corti:text";
  return providerId as CredentialId;
}

function providerOfCredential(id: string): string {
  return id.startsWith("corti:") ? "corti" : id;
}

// The first URL of this kind that points at this host. Scan order is fixed
// (dictation, upload, meeting; then the LLM scopes in declaration order), so
// the result never depends on object iteration luck.
function knownUrl(
  snapshot: RouteSettingsSnapshot,
  host: string,
  kind: TaskKind,
  field: "remoteUrl" | "cloudBaseUrl"
): string | null {
  const inputs: Array<{ remoteUrl?: string; cloudBaseUrl?: string }> =
    kind === "speech"
      ? [snapshot.stt.dictation, snapshot.stt.upload, snapshot.stt.meeting]
      : Object.values(snapshot.llm);
  for (const input of inputs) {
    const url = (input[field] ?? "").trim();
    if (url && hostOf(url) === host) return url;
  }
  return null;
}

export function buildDestinations(
  snapshot: RouteSettingsSnapshot,
  routes: readonly ResolvedRoute[]
): RouteDestination[] {
  const serverHosts = new Set<string>();
  const customHosts = new Set<string>();
  const providerIds = new Set<string>();
  // Hosts the provider's in-use routes actually resolve to (Corti text and
  // speech differ, Task 1's textHostKey).
  const routeHosts = new Map<string, Set<string>>();
  // For a provider listed only through a saved credential: the providerHosts
  // key of that credential's slot. corti:speech wins over corti:text.
  const credentialHostKey = new Map<string, string>();
  // Off routes keep the destination they would use, but they send nothing, so
  // they do not create cards.
  for (const route of routes) {
    if (route.state.status === "off") continue;
    if (destinationKeyOf(route) === null) continue;
    if (route.locality === "network") serverHosts.add(route.host as string);
    else if (route.locality === "remote" && route.providerId === "custom") {
      customHosts.add(route.host as string);
    } else if (route.locality === "remote") {
      const id = route.providerId as string;
      providerIds.add(id);
      if (route.host) routeHosts.set(id, (routeHosts.get(id) ?? new Set<string>()).add(route.host));
    }
  }
  for (const [id, present] of snapshot.facts.credentials ?? []) {
    if (!present) continue;
    const provider = providerOfCredential(id);
    providerIds.add(provider);
    if (id === "corti:speech") credentialHostKey.set(provider, "corti");
    else if (!credentialHostKey.has(provider)) credentialHostKey.set(provider, id);
  }

  const hosts = snapshot.capabilities.providerHosts;
  const hostAt = (key: string) => (Object.hasOwn(hosts, key) ? hosts[key] : null);
  // One distinct in-use host: that host. Several: the provider's own entry.
  // None: the host of the saved credential's slot.
  const providerCardHost = (id: string): string | null => {
    const inUse = routeHosts.get(id);
    if (inUse && inUse.size === 1) return [...inUse][0];
    if (inUse && inUse.size > 1) return hostAt(id);
    return hostAt(credentialHostKey.get(id) ?? id);
  };
  const device: RouteDestination = {
    id: "device",
    kind: "device",
    locality: "device",
    providerId: null,
    host: null,
    urls: { ...NO_URLS },
  };
  const servers = [...serverHosts].sort().map<RouteDestination>((host) => ({
    id: `network:${host}`,
    kind: "server",
    locality: "network",
    providerId: null,
    host,
    urls: {
      speech: knownUrl(snapshot, host, "speech", "remoteUrl"),
      text: knownUrl(snapshot, host, "text", "remoteUrl"),
    },
  }));
  const addServer: RouteDestination = {
    id: ADD_SERVER_ID,
    kind: "addServer",
    locality: "network",
    providerId: null,
    host: null,
    urls: { ...NO_URLS },
  };
  const customs = [...customHosts].sort().map<RouteDestination>((host) => ({
    id: `custom:${host}`,
    kind: "custom",
    locality: "remote",
    providerId: "custom",
    host,
    urls: {
      speech: knownUrl(snapshot, host, "speech", "cloudBaseUrl"),
      text: knownUrl(snapshot, host, "text", "cloudBaseUrl"),
    },
  }));
  const providers = [...providerIds]
    .sort(
      (a, b) => providerDisplayName(a).localeCompare(providerDisplayName(b)) || a.localeCompare(b)
    )
    .map<RouteDestination>((id) => ({
      id,
      kind: "provider",
      locality: "remote",
      providerId: id,
      host: providerCardHost(id),
      urls: { ...NO_URLS },
    }));
  return [device, ...servers, addServer, ...customs, ...providers];
}

export function compatContext(
  snapshot: RouteSettingsSnapshot,
  sealed: boolean,
  providersFor: CompatContext["providersFor"]
): CompatContext {
  return { sealed, providersFor, dictationServerHost: hostOf(snapshot.stt.dictation.remoteUrl) };
}

export function checkCompatibility(
  routeId: RouteId,
  dest: RouteDestination,
  ctx: CompatContext
): Compatibility {
  if (routeId === "speakerId" || routeId === "semanticSearch") {
    return { ok: false, reasonKey: `patchbay.locked.${routeId}` };
  }
  if (ctx.sealed && dest.kind !== "device") return { ok: false, reasonKey: "patchbay.no.sealed" };
  // Screenshots go to a cloud vision model; the vision scope has no server URL of its own.
  if (routeId === "assistantVision" && dest.locality !== "remote") {
    return { ok: false, reasonKey: "patchbay.no.visionCloudOnly" };
  }
  if (dest.kind === "device") return { ok: true };
  const kind = taskKind(routeId);
  if (dest.kind === "addServer" || dest.kind === "server") {
    // Note recording's self-hosted option is not available (MeetingSettings.tsx:89).
    if (routeId === "noteRecordingStt")
      return { ok: false, reasonKey: "patchbay.no.meetingServer" };
    // Upload reads dictation's server and never writes it, so it can only go
    // to the server dictation already points at.
    if (routeId === "uploadStt") {
      return dest.kind === "server" && dest.host !== null && dest.host === ctx.dictationServerHost
        ? { ok: true }
        : { ok: false, reasonKey: "patchbay.no.uploadServer" };
    }
    if (dest.kind === "addServer" || dest.urls[kind] !== null) return { ok: true };
    return {
      ok: false,
      reasonKey: "patchbay.no.serverKind",
      params: { server: dest.host ?? "", kind },
    };
  }
  if (dest.providerId === null || !ctx.providersFor(routeId).includes(dest.providerId)) {
    return {
      ok: false,
      reasonKey: "patchbay.no.capability",
      params: { provider: dest.providerId ?? "" },
    };
  }
  if (dest.kind === "custom" && dest.urls[kind] === null) {
    return {
      ok: false,
      reasonKey: "patchbay.no.serverKind",
      params: { server: dest.host ?? "", kind },
    };
  }
  return { ok: true };
}

export function compatReason(compat: Extract<Compatibility, { ok: false }>, t: Translate): string {
  const p = compat.params ?? {};
  const options = {
    ...(p.provider !== undefined ? { provider: providerDisplayLabel(p.provider, t) } : {}),
    ...(p.server !== undefined ? { server: p.server } : {}),
    ...(p.kind !== undefined ? { kind: t(`patchbay.kind.${p.kind}`) } : {}),
  };
  return Object.keys(options).length > 0 ? t(compat.reasonKey, options) : t(compat.reasonKey);
}

// The target is built from the destination alone. "Add a server" starts with
// an empty address, which the planner reports as needsUrl and Task 8's staged
// panel asks for; no other task's URL is ever reused.
export function targetForDestination(routeId: RouteId, dest: RouteDestination): RouteTarget {
  const kind = taskKind(routeId);
  switch (dest.kind) {
    case "device":
      return { mode: "local" };
    case "addServer":
      return { mode: "self-hosted", remoteUrl: "" };
    case "server":
      return { mode: "self-hosted", remoteUrl: dest.urls[kind] ?? "" };
    case "custom":
      return { mode: "providers", provider: "custom", baseUrl: dest.urls[kind] ?? "" };
    default:
      return { mode: "providers", provider: dest.providerId as string };
  }
}

// Key readiness for a provider card, from main-confirmed presence only
// (rule 5). null kind (no task selected) is treated as text; callers do not
// show a key line without a selection.
export function destinationKeyState(
  dest: RouteDestination,
  facts: RouteFacts,
  kind: TaskKind | null
): KeyState {
  if (dest.kind !== "provider" || dest.providerId === null) return "none";
  if (facts.credentials === null) return "unknown";
  const id = credentialIdFor(dest.providerId, kind ?? "text");
  if (id === null) return "none";
  if (facts.credentialUnknown?.has(id) || !facts.credentials.has(id)) return "unknown";
  if (facts.rejected.has(id)) return "rejected";
  return facts.credentials.get(id) === true ? "saved" : "missing";
}

export function destinationLabel(dest: RouteDestination, t: Translate): string {
  switch (dest.kind) {
    case "device":
      return t("locality.device");
    case "addServer":
      return t("patchbay.dest.addServer");
    case "server":
      return t("patchbay.dest.serverAt", { host: dest.host });
    case "custom":
      return t("patchbay.dest.endpointAt", {
        name: providerDisplayLabel("custom", t),
        host: dest.host,
      });
    default:
      return providerDisplayLabel(dest.providerId, t);
  }
}

// A resolved route's destination in words, for status lines and the footer.
export function routeDestinationLabel(route: ResolvedRoute, t: Translate): string {
  if (route.locality === "device") return t("locality.device");
  if (route.locality === "network") {
    return route.host ? t("patchbay.dest.serverAt", { host: route.host }) : t("locality.network");
  }
  if (route.providerId === "custom" && route.host) {
    return t("patchbay.dest.endpointAt", {
      name: providerDisplayLabel("custom", t),
      host: route.host,
    });
  }
  return providerDisplayLabel(route.providerId, t);
}

// A destination as a phrase inside a sentence ("on this device", "on OpenAI",
// "on your server at 192.168.1.20:11434"), for the status line. Labels such as
// "On this device" are headings and do not read inside "now runs …".
export function destinationPlace(dest: RouteDestination, t: Translate): string {
  switch (dest.kind) {
    case "device":
      return t("patchbay.place.device");
    case "addServer":
      return t("patchbay.place.anyServer");
    case "server":
      return t("patchbay.place.server", { host: dest.host });
    case "custom":
      return t("patchbay.place.endpoint", {
        name: providerDisplayLabel("custom", t),
        host: dest.host,
      });
    default:
      return t("patchbay.place.provider", { provider: providerDisplayLabel(dest.providerId, t) });
  }
}

export function routePlace(route: ResolvedRoute, t: Translate): string {
  if (route.locality === "device") return t("patchbay.place.device");
  if (route.locality === "network") {
    return route.host
      ? t("patchbay.place.server", { host: route.host })
      : t("patchbay.place.anyServer");
  }
  if (route.providerId === "custom" && route.host) {
    return t("patchbay.place.endpoint", {
      name: providerDisplayLabel("custom", t),
      host: route.host,
    });
  }
  return t("patchbay.place.provider", { provider: providerDisplayLabel(route.providerId, t) });
}

export function privacyTally(routes: readonly ResolvedRoute[]) {
  let stay = 0;
  let network = 0;
  let remote = 0;
  for (const r of routes) {
    if (r.sends === null) stay++;
    else if (r.locality === "network") network++;
    else remote++;
  }
  return { total: routes.length, stay, network, remote };
}

export function cablePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  return `M ${from.x} ${from.y} C ${from.x + 120} ${from.y}, ${to.x - 120} ${to.y}, ${to.x} ${to.y}`;
}
