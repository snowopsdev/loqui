import { providerDisplayLabel } from "./locality";
import type { RoutePlan } from "./routePlanner";

// Toast copy for a committed or applied route change (SET-Q10). Names the
// destination (provider via providerDisplayLabel, or the server host) and
// what is sent, plus any coupled routes that changed with it.

export type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface RouteChangeMessage {
  title: string;
  description?: string;
}

export function routeChangeMessage(
  plan: Pick<RoutePlan, "routeId" | "changes">,
  t: Translate,
  list: (items: string[]) => string
): RouteChangeMessage {
  const main = plan.changes.find((change) => !change.coupled) ?? plan.changes[0];
  if (!main) return { title: t("routes.toast.saved", { task: t(`routes.names.${plan.routeId}`) }) };

  const route = main.after;
  const task = t(`routes.names.${route.id}`);
  const provider = route.providerId ? providerDisplayLabel(route.providerId, t) : "";
  const destination =
    route.locality === "device"
      ? t("routes.toast.thisDevice")
      : route.locality === "network"
        ? route.host
          ? t("routes.toast.serverAt", { host: route.host })
          : t("routes.toast.server")
        : provider;

  const turnedOff = route.state.status === "off" && main.before.state.status !== "off";
  const title = turnedOff
    ? t("routes.toast.off", { task })
    : route.state.status === "off"
      ? t("routes.toast.whenOn", { task, destination })
      : route.locality === "device"
        ? t("routes.toast.local", { task })
        : t("routes.toast.sends", { task, payload: route.sends ?? "", destination });

  const notes: string[] = [];
  if (route.state.status === "needsModel") notes.push(t("routes.toast.chooseModel"));
  if (route.state.status === "needsKey" && provider) {
    notes.push(t("routes.toast.signInNext", { provider }));
  }
  const coupled = plan.changes
    .filter((change) => change !== main)
    .map((change) => t(`routes.names.${change.id}`));
  if (coupled.length > 0) notes.push(t("routes.toast.alsoChanges", { tasks: list(coupled) }));

  return notes.length > 0 ? { title, description: notes.join(" ") } : { title };
}
