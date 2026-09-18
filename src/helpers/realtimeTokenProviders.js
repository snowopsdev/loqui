// Direct, user-configured speech providers. No hosted token broker.
const dual = (streams, factory) => streams === 2 ? Promise.all([factory(), factory()]) : factory();
const duplicate = (streams, value) => streams === 2 ? [value, value] : value;
const key = (manager, getter, provider) => {
  const value = manager[getter]();
  if (!value) throw Object.assign(new Error(`No ${provider} API key configured. Add your key in Settings.`), {code: "NO_API"});
  return value;
};
const REALTIME_TOKEN_PROVIDERS = {
  "assemblyai-realtime": async ({ environmentManager, proxyFetch }, _options, streams) => {
    const apiKey = key(environmentManager, "getAssemblyAIKey", "AssemblyAI");
    return dual(streams, async () => {
      const response = await proxyFetch("https://streaming.assemblyai.com/v3/token?expires_in_seconds=60", {
        headers: { Authorization: apiKey },
      });
      if (!response.ok) throw new Error(`AssemblyAI token request failed: ${response.status}`);
      const data = await response.json();
      if (!data.token) throw new Error("No AssemblyAI token received");
      return data.token;
    });
  },
  "deepgram-realtime": async ({ environmentManager }, _options, streams) =>
    duplicate(streams, key(environmentManager, "getDeepgramKey", "Deepgram")),
  "gemini-realtime": async ({ environmentManager }, _options, streams) =>
    duplicate(streams, key(environmentManager, "getGeminiKey", "Gemini")),
  "openai-realtime": async ({ environmentManager }, _options, streams) =>
    duplicate(streams, key(environmentManager, "getOpenAIKey", "OpenAI")),
  "tinfoil-realtime": async ({ environmentManager }, _options, streams) =>
    duplicate(streams, key(environmentManager, "getTinfoilKey", "Tinfoil")),
  "corti-realtime": async ({ mintCortiToken }, options, streams) => {
    const { token } = await mintCortiToken(options);
    return duplicate(streams, token);
  },
};
async function fetchRealtimeTokenForProvider(provider, deps, options, { streams } = {}) {
  if (options.mode !== "byok") throw new Error("Select a direct speech provider and configure its API key.");
  const acquire = REALTIME_TOKEN_PROVIDERS[provider];
  if (!acquire) throw new Error(`Unsupported realtime token provider: ${provider}`);
  return acquire(deps, options, streams);
}
module.exports = { REALTIME_TOKEN_PROVIDERS, fetchRealtimeTokenForProvider };
