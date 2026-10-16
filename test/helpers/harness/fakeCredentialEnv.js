const { BYOK_API_KEYS } = require("../../../src/config/secretKeys");

// An in-memory stand-in for EnvironmentManager's credential surface: every
// getter the credential authority reads plus an awaitable persistSecret whose
// timing and failure a test controls through persistImpl. It records only the
// names it persisted, never the values.
const GETTERS = {
  ...Object.fromEntries(BYOK_API_KEYS.map((k) => [k.get, k.env])),
  getCortiClientId: "CORTI_CLIENT_ID",
  getCortiClientSecret: "CORTI_CLIENT_SECRET",
  getCustomTranscriptionKey: "CUSTOM_TRANSCRIPTION_API_KEY",
  getCleanupCustomKey: "CUSTOM_CLEANUP_API_KEY",
  getBedrockAccessKeyId: "BEDROCK_ACCESS_KEY_ID",
  getBedrockSecretAccessKey: "BEDROCK_SECRET_ACCESS_KEY",
  getBedrockSessionToken: "BEDROCK_SESSION_TOKEN",
  getBedrockProfile: "BEDROCK_PROFILE",
  getAzureApiKey: "AZURE_OPENAI_API_KEY",
  getVertexApiKey: "VERTEX_API_KEY",
  getVertexProject: "VERTEX_PROJECT",
};

function fakeCredentialEnv(initial = {}) {
  const values = new Map(Object.entries(initial));
  const env = { values, persisted: [], persistImpl: null };
  for (const [getter, name] of Object.entries(GETTERS)) env[getter] = () => values.get(name) || "";
  env.getVertexAuthSource = () => {
    const source = values.get("VERTEX_AUTH_SOURCE");
    return source === "adc" || source === "apiKey" ? source : null;
  };
  // Main-only legacy SDK fallback. Credential presence still reports only the
  // stored VERTEX_API_KEY field; committed captures apply this fallback later.
  env.getLegacyVertexApiKey = () => values.get("GOOGLE_VERTEX_API_KEY") || "";
  env.persistSecret = async (name, value) => {
    env.persisted.push(name);
    if (env.persistImpl) await env.persistImpl(name, value);
    if (value) values.set(name, value);
    else values.delete(name);
  };
  return env;
}

// fs double for Codex presence: stat answers from `size` (null = no file) and
// any attempt to read the credential file fails the test.
function fakeCodexFs({ size = null } = {}) {
  const calls = [];
  return {
    calls,
    statSync(file) {
      calls.push(file);
      if (size === null) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { isFile: () => true, size };
    },
    readFileSync() {
      throw new Error("credential presence must never read auth.json");
    },
    promises: {
      readFile() {
        throw new Error("credential presence must never read auth.json");
      },
    },
  };
}

module.exports = { fakeCredentialEnv, fakeCodexFs };
