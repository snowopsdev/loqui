// Where a request for each provider is sent. Used for the Sealed mode decision
// and as the ledger's default host; the backstop and metered fetch record the
// host actually contacted. Network-free: nothing here resolves or connects.
const PROVIDER_ENDPOINTS = Object.freeze({
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  corti: "https://ai.eu.corti.app/v1",
  mistral: "https://api.mistral.ai/v1",
  xai: "https://api.x.ai/v1",
  tinfoil: "https://inference.tinfoil.sh/v1",
  codex: "https://chatgpt.com",
  bedrock: "https://bedrock-runtime.amazonaws.com",
  azure: "https://openai.azure.com",
  vertex: "https://aiplatform.googleapis.com",
});
const USER_ENDPOINT_PROVIDERS = new Set(["custom", "lan", "local"]);
const UNKNOWN = "https://unknown-provider.invalid";

function providerEndpoint(provider, baseUrl) {
  if (USER_ENDPOINT_PROVIDERS.has(provider)) return baseUrl || UNKNOWN;
  return PROVIDER_ENDPOINTS[provider] || UNKNOWN;
}

const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

// The recipient a request will actually use, from the executor main captured or
// resolved (A6). Enterprise providers never fall back to a fixed label: an
// unresolved executor is unknown, which is remote (fail toward refusal).
// `env` is a snapshot for the SDKs that read a base-URL override themselves.
function effectiveEndpoint(provider, { baseUrl, enterprise, env } = {}) {
  if (USER_ENDPOINT_PROVIDERS.has(provider)) return text(baseUrl) || UNKNOWN;
  if (provider === "azure")
    return text(enterprise?.endpoint) || text(enterprise?.azureEndpoint) || UNKNOWN;
  if (provider === "bedrock")
    return text(enterprise?.endpointOverride) || text(enterprise?.bedrockBaseURL) || UNKNOWN;
  if (provider === "vertex") {
    const location = text(enterprise?.location) || text(enterprise?.vertexLocation);
    if (!location || !/^[a-z0-9-]+$/i.test(location)) return UNKNOWN;
    return location === "global"
      ? "https://aiplatform.googleapis.com"
      : `https://${location.toLowerCase()}-aiplatform.googleapis.com`;
  }
  if (provider === "openai" || provider === "anthropic") {
    const captured = text(enterprise?.sdkBaseURL);
    if (captured) return captured;
    const override = text(env?.[provider === "openai" ? "OPENAI_BASE_URL" : "ANTHROPIC_BASE_URL"]);
    if (override) return override;
  }
  return PROVIDER_ENDPOINTS[provider] || UNKNOWN;
}

module.exports = {
  PROVIDER_ENDPOINTS,
  UNKNOWN_PROVIDER_ENDPOINT: UNKNOWN,
  providerEndpoint,
  effectiveEndpoint,
};
