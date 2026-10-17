import { providerDisplayLabel } from "../../lib/locality";
import type { ResolvedRoute } from "../../lib/routeGraph";

type Translate = (key: string, options?: Record<string, unknown>) => string;

// SET-Q15: name where the screenshot goes and what rides with it, from the assistantVision route.
// `sends` is Task 3's translated payload list and already includes the screenshot.
export function screenContextCopy(
  route: Pick<ResolvedRoute, "locality" | "providerId" | "host" | "model" | "sends">,
  t: Translate
): string {
  if (route.locality === "device") {
    return route.model
      ? t("dictationAgent.screenContext.goesToDevice", { model: route.model })
      : t("dictationAgent.screenContext.goesToDeviceNoModel");
  }
  const payload = route.sends ?? t("routes.payload.screenshot");
  if (!route.host && (route.locality === "network" || !route.providerId)) {
    return t("dictationAgent.screenContext.destinationUnspecified");
  }
  if (route.locality === "network") {
    return route.host
      ? t("dictationAgent.screenContext.goesToServer", { host: route.host, payload })
      : t("dictationAgent.screenContext.destinationUnspecified");
  }
  const provider = providerDisplayLabel(route.providerId, (key) => t(key));
  return route.host
    ? t("dictationAgent.screenContext.goesToProvider", { provider, host: route.host, payload })
    : t("dictationAgent.screenContext.goesToProviderNoHost", { provider, payload });
}
