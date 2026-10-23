import { useTranslation } from "react-i18next";
import { providerDisplayLabel, type Locality } from "../../lib/locality";
import { useResolvedRoute, type ResolvedRoute } from "../../lib/routes";
import { useSealedStore } from "../../stores/sealedStore";

type T = (key: string, options?: Record<string, unknown>) => string;

export interface PillLocality {
  locality: Locality;
  provider: string | null;
  blocked: boolean;
  label: string;
  routeLine: string;
}

export type PillRouteId =
  "dictationStt" | "dictationCleanup" | "translation" | "voiceAssistant" | "assistantVision";

export interface PillSession {
  /** Typed Agent turns have no speech/cleanup stages. */
  readonly agentOnly?: boolean;
  readonly routes: Readonly<Partial<Record<PillRouteId, ResolvedRoute>>> | null;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly intents: {
    readonly voiceAgentRequested: boolean;
    readonly translationRequested: boolean;
  };
}

// A failed snapshot reader cannot turn active work into an on-device claim (D4).
const unknownRoute = (id: PillRouteId): ResolvedRoute => ({
  id,
  kind: id === "dictationStt" ? "speech" : "text",
  locality: "remote",
  provider: null,
  providerId: null,
  recipient: null,
  host: null,
  model: null,
  state: { status: "unreachable" },
  sends: null,
  settingsPath: id,
});

/** The same enabled intents as Task 8's Sealed pre-check; never read live Settings. */
export function sessionPillRoutes(session: PillSession | null): ResolvedRoute[] {
  if (!session) return [unknownRoute("dictationStt")];
  const read = (id: PillRouteId) => session.routes?.[id] ?? unknownRoute(id);
  if (session.agentOnly) {
    return [read(session.settings.voiceAgentScreenContext ? "assistantVision" : "voiceAssistant")];
  }
  const cleanup = read("dictationCleanup");
  const routes = [
    read("dictationStt"),
    session.settings.useCleanupModel ? cleanup : { ...cleanup, state: { status: "off" as const } },
  ];
  if (session.intents.translationRequested) routes.push(read("translation"));
  if (session.intents.voiceAgentRequested) {
    routes.push(read("voiceAssistant"));
    if (session.settings.voiceAgentScreenContext) routes.push(read("assistantVision"));
  }
  return routes;
}

const RANK: Record<Locality, number> = { device: 0, network: 1, remote: 2 };

/** UI labels use the raw route id; malformed legacy routes fail to localized Unknown. */
export function routeProviderLabel(route: ResolvedRoute, t: T): string {
  return providerDisplayLabel(route.providerId, t);
}

function stageLine(
  route: ResolvedRoute | undefined,
  t: T,
  stageKey: "speech" | "cleanup" | "translation" | "agent" | "vision"
): string {
  if (!route) return "";
  if (route.state.status === "off") return t(`pill.route.${stageKey}Off`);
  const where =
    route.locality === "remote"
      ? t("pill.locality.remote", { provider: routeProviderLabel(route, t) })
      : t(`locality.${route.locality}`);
  return t(`pill.route.${stageKey}`, { where });
}

/** The ring shows the most remote active stage (fail toward disclosure, D4). */
export function combinePillLocality(routes: ResolvedRoute[], t: T, sealed?: boolean): PillLocality {
  const active = routes.filter((r) => r.state.status !== "off");
  const top = active.reduce<ResolvedRoute | null>(
    (best, r) => (!best || RANK[r.locality] > RANK[best.locality] ? r : best),
    null
  );
  const locality: Locality = top?.locality ?? "device";
  const blocked = active.some(
    (r) =>
      r.locality !== "device" &&
      (sealed ?? (r.state.status === "unreachable" && r.state.detail === "sealed"))
  );
  const provider = locality === "remote" && top ? routeProviderLabel(top, t) : null;
  const label = blocked
    ? t("pill.locality.sealed")
    : locality === "remote"
      ? t("pill.locality.remote", { provider: provider ?? "" })
      : t(`locality.${locality}`);
  const stages = [
    ["dictationStt", "speech"],
    ["dictationCleanup", "cleanup"],
    ["translation", "translation"],
    ["voiceAssistant", "agent"],
    ["assistantVision", "vision"],
  ] as const;
  const routeLine = stages
    .map(([id, key]) =>
      stageLine(
        routes.find((r) => r.id === id),
        t,
        key
      )
    )
    .filter(Boolean)
    .join(" · ");
  return { locality, provider, blocked, label, routeLine };
}

export function usePillLocality(session: PillSession | null, busy: boolean): PillLocality {
  const { t } = useTranslation();
  // Keep hooks unconditional. Their live results are consumed only while idle.
  const stt = useResolvedRoute("dictationStt");
  const cleanup = useResolvedRoute("dictationCleanup");
  const sealed = useSealedStore((s) => s.sealed);
  // Sealed is a live gate over the frozen destinations, not permission to retarget them.
  return combinePillLocality(busy ? sessionPillRoutes(session) : [stt, cleanup], t, sealed);
}

/** Frozen Agent intent and effective destination, never a receipt. */
export function agentPillCaption(
  session: PillSession | null,
  phase: "listening" | "thinking",
  t: T
): string {
  const screen = session?.settings.voiceAgentScreenContext === true;
  const route = session?.routes?.[screen ? "assistantVision" : "voiceAssistant"];
  const where = !route
    ? t("locality.unknownProvider")
    : route.locality === "remote"
      ? routeProviderLabel(route, t)
      : t(`locality.${route.locality}`);
  return phase === "listening"
    ? screen
      ? t("pill.agent.screenContext", { where })
      : t("pill.agent.listening")
    : screen
      ? t("pill.agent.thinkingScreenContext", { where })
      : t("pill.agent.thinking", { where });
}
