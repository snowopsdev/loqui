import {
  selectResolvedLLMConfig,
  useSettingsStore,
  type SettingsState,
} from "../../stores/settingsStore";

export type ChatRouteScope = "chatIntelligence" | "dictationAgent";

/** Fingerprint of where a typed chat message goes: scope, mode, provider,
 * model and endpoint. The secret (customApiKey) and tuning
 * (disableThinking) are left out on purpose. */
export function chatRouteKey(state: SettingsState, scope: ChatRouteScope): string {
  const c = selectResolvedLLMConfig(state, scope);
  return [
    c.scope,
    c.mode,
    c.provider,
    c.model,
    c.cloudMode ?? "",
    c.cloudBaseUrl ?? "",
    c.remoteUrl ?? "",
  ].join("|");
}

export function useChatRouteKey(scope: ChatRouteScope): string {
  return useSettingsStore((state) => chatRouteKey(state, scope));
}
