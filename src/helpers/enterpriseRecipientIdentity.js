const { createHash } = require("node:crypto");
const RECIPIENT_FIELDS = Object.freeze({
  azure: ["endpoint", "apiVersion", "authSource"],
  bedrock: ["region", "profile", "authSource", "endpointOverride"],
  vertex: ["project", "location", "authSource"],
});
const AUTH_SOURCES = Object.freeze({
  azure: new Set(["credential-store"]),
  bedrock: new Set(["profile", "static"]),
  vertex: new Set(["adc", "apiKey"]),
});

function normalizeEndpoint(value, { httpsOnly = false } = {}) {
  if (value == null) return null;
  if (String(value).trim() === "") return undefined;
  try {
    const url = new URL(String(value).trim());
    if (
      !(httpsOnly ? url.protocol === "https:" : ["https:", "http:"].includes(url.protocol)) ||
      url.username ||
      url.password
    )
      return undefined;
    return url.href.replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

// SDKs append request paths to their raw base before URL parsing. Rewriting
// the base first erases terminal dot segments or removes a second separator.
// Validate both stages, then retain exactly the captured SDK input. Identity
// is deliberately conservative for cosmetically different equivalent bases.
function rawExecutorEndpoint(value, provider) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const base = new URL(value);
    const protocols = provider === "azure" ? ["https:"] : ["http:", "https:"];
    if (!protocols.includes(base.protocol) || base.username || base.password) return undefined;
    const azureHost =
      provider === "azure" &&
      [".openai.azure.com", ".services.ai.azure.com", ".cognitiveservices.azure.com"].some(
        (suffix) => base.hostname.endsWith(suffix)
      );
    const versioned =
      azureHost && base.pathname.replace(/\/+$/, "").toLowerCase().endsWith("/openai/v1");
    const suffix =
      provider === "azure"
        ? `${azureHost && !versioned ? "/v1" : ""}/responses`
        : "/model/fixture/converse";
    const target = new URL(`${value.replace(/\/$/, "")}${suffix}`);
    if (!protocols.includes(target.protocol) || target.username || target.password)
      return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function defaultBedrockEndpoint(region) {
  const suffix = region.startsWith("cn-")
    ? "amazonaws.com.cn"
    : region.startsWith("us-iso-")
      ? "c2s.ic.gov"
      : region.startsWith("us-isob-")
        ? "sc2s.sgov.gov"
        : region.startsWith("eu-isoe-")
          ? "cloud.adc-e.uk"
          : region.startsWith("us-isof-")
            ? "csp.hci.ic.gov"
            : region.startsWith("eusc-")
              ? "amazonaws.eu"
              : "amazonaws.com";
  return normalizeEndpoint(`https://bedrock-runtime.${region}.${suffix}`);
}

function captureEnterpriseEnvironment(provider, env = process.env) {
  if (provider === "bedrock")
    return Object.freeze({
      AWS_ENDPOINT_URL_BEDROCK_RUNTIME: env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME,
      AWS_ENDPOINT_URL: env.AWS_ENDPOINT_URL,
    });
  if (provider === "vertex")
    return Object.freeze({
      // Secret; main keeps this snapshot only long enough to resolve explicit
      // credential material. It is never returned by the route-fact publisher.
      GOOGLE_VERTEX_API_KEY: env.GOOGLE_VERTEX_API_KEY,
    });
  return Object.freeze({});
}

function resolveEnterpriseCredentialMaterial(provider, source = {}, storedApiKey = "", env = {}) {
  if (provider === "vertex") {
    if (source.vertexAuthSource === "adc") return Object.freeze({ vertexApiKey: "" });
    if (source.vertexAuthSource === "apiKey") {
      // The stored VERTEX_API_KEY wins; the legacy SDK env key is captured
      // before the recipient check and passed explicitly as credential only.
      const vertexApiKey = storedApiKey || env.GOOGLE_VERTEX_API_KEY || "";
      if (!vertexApiKey)
        throw Object.assign(new Error("Configure a Vertex API key in Settings."), {
          code: "recipientUnknown",
          messageKey: "voiceOverlay.errors.recipientUnknown",
        });
      return Object.freeze({ vertexApiKey });
    }
    return undefined;
  }
  if (provider === "bedrock") {
    const profile = typeof source.bedrockProfile === "string" ? source.bedrockProfile.trim() : "";
    if (profile) return Object.freeze({ authSource: "profile", profile });
    if (!source.bedrockAccessKeyId || !source.bedrockSecretAccessKey)
      throw Object.assign(new Error("Configure both Bedrock access-key fields in Settings."), {
        name: "CredentialsProviderError",
        code: "recipientUnknown",
        messageKey: "voiceOverlay.errors.recipientUnknown",
      });
    return Object.freeze({
      authSource: "static",
      accessKeyId: source.bedrockAccessKeyId,
      secretAccessKey: source.bedrockSecretAccessKey,
      // STS session credentials travel only as credential material, never as
      // part of recipient identity or renderer-visible route facts.
      ...(source.bedrockSessionToken ? { sessionToken: source.bedrockSessionToken } : {}),
    });
  }
  return undefined;
}

function resolveEnterpriseExecutor(provider, source = {}, env = process.env) {
  let executor;
  if (provider === "azure") {
    executor = {
      endpoint: rawExecutorEndpoint(source.azureEndpoint, "azure"),
      apiVersion: source.azureApiVersion || "2024-10-21",
      authSource: "credential-store",
    };
  } else if (provider === "bedrock") {
    const profileValue = source.bedrockProfile ?? null;
    const profile =
      typeof profileValue === "string" && profileValue.trim() ? profileValue.trim() : null;
    // The SDK gives the runtime-specific variable priority even when it is
    // empty. Treat that empty-but-set override as unusable instead of falling
    // through to AWS_ENDPOINT_URL or to the SDK's ambient config chain.
    const rawEndpointOverride = env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME ?? env.AWS_ENDPOINT_URL;
    const region = source.bedrockRegion || "us-east-1";
    executor = {
      region,
      profile,
      // Profile wins exactly as in Plan 03. Otherwise static is the intended
      // source; its live credential pair is validated separately, not tagged.
      authSource: profile ? "profile" : "static",
      // Freeze the full effective base URL, even on the default path, so the
      // SDK cannot observe a later environment override after comparison.
      endpointOverride:
        rawEndpointOverride === undefined
          ? defaultBedrockEndpoint(region)
          : rawExecutorEndpoint(rawEndpointOverride, "bedrock"),
    };
  } else if (provider === "vertex") {
    executor = {
      project: String(source.vertexProject ?? "").trim() || null,
      location: source.vertexLocation || "us-central1",
      // Plan 03's migrated, persisted enum is authoritative. Never infer it
      // from key presence, including GOOGLE_VERTEX_API_KEY.
      authSource: source.vertexAuthSource,
    };
  } else {
    return { status: "unknown" };
  }

  if (Object.values(executor).some((value) => typeof value !== "string" && value !== null))
    return { status: "unknown" };
  if (provider === "azure" && (!executor.endpoint || !executor.apiVersion))
    return { status: "unknown" };
  if (provider === "bedrock" && !executor.endpointOverride) return { status: "unknown" };
  if (provider === "vertex" && executor.authSource === "adc" && !executor.project)
    return { status: "unknown" };
  if (!AUTH_SOURCES[provider].has(executor.authSource)) return { status: "unknown" };
  if (provider === "bedrock" && !/^[a-z0-9-]+$/i.test(executor.region))
    return { status: "unknown" };
  if (provider === "vertex" && executor.project && /[\\/\s?#]/.test(executor.project))
    return { status: "unknown" };
  if (provider === "vertex" && !/^[a-z0-9-]+$/i.test(executor.location))
    return { status: "unknown" };
  // Validate any URL overrides here; return unknown instead of publishing an invalid tag.
  const canonical = JSON.stringify([
    provider,
    ...RECIPIENT_FIELDS[provider].map((key) => [key, executor[key] ?? null]),
  ]);
  const tag = `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
  return { status: "ready", executor: Object.freeze(executor), tag };
}

function buildEnterpriseRecipientFacts(source, env = process.env) {
  return Object.freeze(
    Object.fromEntries(
      Object.keys(RECIPIENT_FIELDS).map((provider) => {
        const resolved = resolveEnterpriseExecutor(provider, source, env);
        return [
          provider,
          resolved.status === "ready"
            ? Object.freeze({ status: "ready", tag: resolved.tag })
            : Object.freeze({ status: "unknown" }),
        ];
      })
    )
  );
}

module.exports = {
  captureEnterpriseEnvironment,
  resolveEnterpriseCredentialMaterial,
  resolveEnterpriseExecutor,
  buildEnterpriseRecipientFacts,
};
