import { useCallback, useRef, useSyncExternalStore } from "react";
import { chatRouteKey } from "../chat/chatRouteKey";
import { resolveRoute, routeSnapshotFromSettings, useResolvedRoute } from "../../lib/routes";
import {
  enterpriseRouteVersion,
  enterpriseSettingsAreConfirmed,
  subscribeEnterpriseAuthority,
  useSettingsStore,
} from "../../stores/settingsStore";
import { useRouteFactsStore } from "../../stores/routeFactsStore";
import { useSealedStore } from "../../stores/sealedStore";

// Main's nonsecret version covers same-host project/location/auth-source edits.
// This is an invalidation identity, never another recipient or credential resolver.
function currentDestination() {
  const settings = useSettingsStore.getState();
  const route = resolveRoute(routeSnapshotFromSettings(settings), "chat");
  const enterprise = ["azure", "vertex", "bedrock"].includes(route.providerId ?? "");
  const confirmed = !enterprise || enterpriseSettingsAreConfirmed();
  return {
    ready: route.state.status === "ready" && confirmed,
    key: JSON.stringify([
      chatRouteKey(settings, "chatIntelligence"),
      route.locality,
      route.host,
      route.state.status,
      enterprise ? enterpriseRouteVersion() : null,
      confirmed,
    ]),
  };
}
export function useTableRoute() {
  const route = useResolvedRoute("chat");
  const identity = useRef({ key: "", revision: 0 });
  const read = useCallback(() => {
    const current = currentDestination();
    if (identity.current.key !== current.key) {
      identity.current = { key: current.key, revision: identity.current.revision + 1 };
    }
    return `${identity.current.revision}|${current.key}`;
  }, []);
  const subscribe = useCallback(
    (notify: () => void) => {
      const changed = () => {
        read();
        notify();
      };
      const offs = [
        useSettingsStore.subscribe(changed),
        subscribeEnterpriseAuthority(changed),
        useRouteFactsStore.subscribe(changed),
        useSealedStore.subscribe(changed),
      ];
      return () => offs.forEach((off) => off());
    },
    [read]
  );
  const destinationKey = useSyncExternalStore(subscribe, read, read);
  const canAdmit = useCallback(
    (key: string) => key === read() && currentDestination().ready,
    [read]
  );
  return { route, destinationKey, canAdmit };
}
