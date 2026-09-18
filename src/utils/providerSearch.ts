export const NATIVE_SEARCH_PROVIDERS = new Set(["openai", "anthropic", "gemini"]);
export function supportsProviderSearch(scope: string, provider: string, mode: string): boolean {
  return (
    ["chatIntelligence", "dictationAgent"].includes(scope) &&
    mode === "providers" &&
    NATIVE_SEARCH_PROVIDERS.has(provider)
  );
}
export function isProviderSearchEnabled(scope: string, provider: string, mode: string): boolean {
  if (!supportsProviderSearch(scope, provider, mode)) return false;
  return localStorage.getItem(`personalWebSearch:${scope}`) === "true";
}
