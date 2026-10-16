// What main's own environment does to enterprise requests (R2-1), as facts the
// route graph can disclose. Hosts and booleans only: never a value, so no key,
// token or credential-bearing URL leaves main. Reads process.env; no network.
//
// Precedence mirrors the installed SDKs on the enterpriseAiProviders.js path:
// - @ai-sdk/amazon-bedrock resolveAmazonBedrockBaseURL (dist/index.js:3113-3129):
//   AWS_ENDPOINT_URL_BEDROCK_RUNTIME, else AWS_ENDPOINT_URL, else the region.
//   loadOptionalSetting (provider-utils dist/index.js:1720-1735) accepts any
//   string, "" included, and the base URL loses one trailing slash.
// - @ai-sdk/google-vertex (dist/index.js:1637-1640, 1814-1820): a truthy
//   GOOGLE_VERTEX_API_KEY is the legacy fallback only in persisted apiKey mode.
//   ADC mode passes apiKey: "" explicitly, suppressing this SDK fallback.
// GOOGLE_VERTEX_PROJECT/LOCATION and AWS_REGION never apply here: the helper
// always passes string settings, which loadSetting returns as they are.

function requestHost(url) {
  try {
    const parsed = new URL(url);
    return parsed.username || parsed.password ? null : parsed.host || null; // fetch refuses credentials
  } catch {
    return null;
  }
}

function enterpriseRouteFacts(env = process.env) {
  const runtime = env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME;
  const raw = typeof runtime === "string" ? runtime : env.AWS_ENDPOINT_URL;
  return {
    bedrockEndpoint:
      typeof raw === "string"
        ? { set: true, host: requestHost(`${raw.replace(/\/$/, "")}/model/fixture/converse`) }
        : { set: false, host: null },
    bedrockProfile: Boolean(env.BEDROCK_PROFILE),
    vertexApiKeyEnv: Boolean(env.GOOGLE_VERTEX_API_KEY),
    vertexProjectEnv: typeof env.GOOGLE_VERTEX_PROJECT === "string",
  };
}

module.exports = { enterpriseRouteFacts };
