const path = require("node:path");
const os = require("node:os");
const unsupported = (source) =>
  Object.assign(
    new Error(
      `The ${source} authentication source cannot be retained for cleanup. Your original words are preserved.`
    ),
    { code: "UNSUPPORTED_AUTH_SOURCE" }
  );

// Network-free nonsecret descriptor, called synchronously at IPC entry and again
// after waits. Main's config version catches A→B→A committed edits too.
function textOperationSnapshot(environment, request, env = process.env) {
  if (!["bedrock", "azure", "vertex"].includes(request.provider)) {
    const sdkBaseURL =
      request.provider === "openai"
        ? env.OPENAI_BASE_URL || "https://api.openai.com/v1"
        : request.provider === "anthropic"
          ? env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1"
          : null;
    if (sdkBaseURL) {
      const url = new URL(sdkBaseURL);
      if (
        url.username ||
        url.password ||
        !require("../utils/urlUtils.ts").isSecureHttpEndpoint(url.href)
      )
        throw Object.assign(new Error("The cleanup endpoint is invalid."), {
          code: "RECIPIENT_CHANGED",
        });
    }
    return sdkBaseURL ? { sdkBaseURL } : {};
  }
  const state = environment.getEnterpriseRouteState();
  if (!state?.current)
    throw Object.assign(new Error("Cleanup configuration is unavailable."), {
      code: "RECIPIENT_CHANGED",
    });
  const selected = state.current;
  if (request.provider === "azure")
    return {
      version: state.version,
      azureEndpoint: selected.azureEndpoint,
      azureApiVersion: environment.getAzureApiVersion() || "2024-10-21",
    };
  if (request.provider === "vertex")
    return {
      version: state.version,
      vertexAuthSource: selected.vertexAuthSource,
      vertexProject: selected.vertexProject,
      vertexLocation: selected.vertexLocation || "us-central1",
      vertexAdcFile:
        selected.vertexAuthSource === "adc"
          ? env.GOOGLE_APPLICATION_CREDENTIALS ||
            env.google_application_credentials ||
            (process.platform === "win32"
              ? env.APPDATA && path.join(env.APPDATA, "gcloud/application_default_credentials.json")
              : env.HOME &&
                path.join(env.HOME, ".config/gcloud/application_default_credentials.json")) ||
            ""
          : "",
    };
  const region = selected.bedrockRegion || "us-east-1";
  const suffix =
    [
      ["cn-", "amazonaws.com.cn"],
      ["us-iso-", "c2s.ic.gov"],
      ["us-isob-", "sc2s.sgov.gov"],
      ["eu-isoe-", "cloud.adc-e.uk"],
      ["us-isof-", "csp.hci.ic.gov"],
      ["eusc-", "amazonaws.eu"],
    ].find(([prefix]) => region.startsWith(prefix))?.[1] || "amazonaws.com";
  return {
    version: state.version,
    bedrockRegion: region,
    bedrockProfile: environment.getBedrockProfile() || "",
    bedrockBaseURL: (
      env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME ||
      env.AWS_ENDPOINT_URL ||
      `https://bedrock-runtime.${region}.${suffix}`
    ).replace(/\/$/, ""),
    bedrockCredentialsFile:
      env.AWS_SHARED_CREDENTIALS_FILE || path.join(os.homedir(), ".aws/credentials"),
    bedrockConfigFile: env.AWS_CONFIG_FILE || path.join(os.homedir(), ".aws/config"),
  };
}

async function captureTextFactoryInputs(
  request,
  selected,
  values,
  {
    readFile = (...args) => require("node:fs/promises").readFile(...args),
    parseProfiles = (options) => require("@smithy/core/config").parseKnownFiles(options),
  } = {}
) {
  if (request.provider === "codex") throw unsupported("Codex app-server account");
  if (request.provider === "tinfoil") throw unsupported("Tinfoil SDK bootstrap");
  const enterprise = {
    ...selected,
    frozenCredentials: true,
    openCodeHeaders: require("./openCodeSession").openCodeSessionHeaders(request.baseUrl),
  };
  if (request.provider === "bedrock") {
    let keys = {
      accessKeyId: values.accessKeyId || "",
      secretAccessKey: values.secretAccessKey || "",
      sessionToken: values.sessionToken || "",
    };
    if (selected.bedrockProfile) {
      const profiles = await parseProfiles({
        filepath: selected.bedrockCredentialsFile,
        configFilepath: selected.bedrockConfigFile,
        ignoreCache: true,
      });
      const profile = profiles[selected.bedrockProfile];
      const allowed = new Set([
        "aws_access_key_id",
        "aws_secret_access_key",
        "aws_session_token",
        "region",
        "output",
      ]);
      if (!profile || Object.keys(profile).some((key) => !allowed.has(key)))
        throw unsupported("Bedrock non-static profile");
      keys = {
        accessKeyId: profile.aws_access_key_id,
        secretAccessKey: profile.aws_secret_access_key,
        sessionToken: profile.aws_session_token,
      };
    }
    if (!keys.accessKeyId || !keys.secretAccessKey)
      throw unsupported("Bedrock ambient credential chain");
    // The selected static file has already been read. Factory must never ask the
    // profile chain (or ambient environment) again, including on retry.
    Object.assign(enterprise, {
      bedrockProfile: "",
      bedrockAccessKeyId: keys.accessKeyId,
      bedrockSecretAccessKey: keys.secretAccessKey,
      bedrockSessionToken: keys.sessionToken,
    });
  }
  if (request.provider === "vertex" && selected.vertexAuthSource === "adc") {
    if (!selected.vertexAdcFile) throw unsupported("Vertex ambient ADC/metadata");
    let raw;
    try {
      raw = await readFile(selected.vertexAdcFile, "utf8");
    } catch {
      throw unsupported("Vertex ADC file");
    }
    if (raw.length > 131072) throw unsupported("Vertex ADC file");
    try {
      enterprise.capturedAdcCredentials = JSON.parse(raw);
    } catch {
      throw unsupported("Vertex ADC file");
    }
    // The enterprise factory applies its existing strict service-account/user
    // whitelist before any GoogleAuth or transport is constructed.
  }
  return { apiKey: values.key || "", enterprise: Object.freeze(enterprise) };
}
module.exports = { textOperationSnapshot, captureTextFactoryInputs };
