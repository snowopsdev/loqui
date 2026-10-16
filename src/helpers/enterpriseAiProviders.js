// Main-process AI SDK factory for enterprise providers (Bedrock, Azure,
// Vertex). These SDKs depend on Node-only APIs (fs, process, AWS/Azure/Google
// credential chains) and can't run in a Vite-bundled renderer, which is why
// they live here and not in `src/services/ai/providers.ts`. The renderer's
// counterpart handles cloud + local providers only.
//
// Each enterprise SDK is required lazily inside its create*Model function so
// app startup doesn't eager-load ~100 MB of AWS/Azure/Google SDKs for users
// who never select an enterprise provider.

// Explicit verification never follows a credential-bearing redirect. General
// model construction keeps the existing SDK transport defaults.
const verificationFetch = (input, init) => fetch(input, { ...init, redirect: "error" });

async function getEnterpriseAIModel(provider, model, apiKey, enterprise) {
  switch (provider) {
    case "bedrock":
      return createBedrockModel(model, enterprise);
    case "azure":
      return createAzureModel(model, apiKey, enterprise);
    case "vertex":
      return createVertexModel(model, apiKey, enterprise);
    default:
      throw new Error(`Unsupported enterprise provider: ${provider}`);
  }
}

async function createBedrockModel(model, enterprise) {
  const { createAmazonBedrock } = require("@ai-sdk/amazon-bedrock");
  const region = enterprise?.bedrockRegion || "us-east-1";
  const explicitCredentialSource = enterprise?.bedrockProfile
    ? "profile credential provider"
    : enterprise?.bedrockAccessKeyId || enterprise?.bedrockSecretAccessKey
      ? "static credentials"
      : null;
  let credentials;
  if (enterprise?.bedrockProfile && enterprise.frozenCredentials) {
    // Explicit Test supports a static selected profile only. Parse once: a
    // precheck followed by fromIni would re-read mutable profile/source data.
    const profiles = await require("@smithy/core/config").parseKnownFiles({
      filepath: enterprise.bedrockCredentialsFile,
      configFilepath: enterprise.bedrockConfigFile,
      ignoreCache: true,
    });
    const profile = profiles[enterprise.bedrockProfile];
    const allowed = new Set([
      "aws_access_key_id",
      "aws_secret_access_key",
      "aws_session_token",
      "region",
      "output",
    ]);
    if (
      !profile ||
      Object.keys(profile).some((key) => !allowed.has(key)) ||
      !profile.aws_access_key_id ||
      !profile.aws_secret_access_key
    ) {
      throw Object.assign(
        new Error(
          "This profile authentication source cannot be tested with a captured configuration."
        ),
        { code: "UNSUPPORTED_AUTH_SOURCE" }
      );
    }
    credentials = {
      accessKeyId: profile.aws_access_key_id,
      secretAccessKey: profile.aws_secret_access_key,
      sessionToken: profile.aws_session_token,
    };
  } else {
    credentials = enterprise?.bedrockProfile
      ? await require("@aws-sdk/credential-providers").fromNodeProviderChain({
          profile: enterprise.bedrockProfile,
        })()
      : explicitCredentialSource
        ? {
            accessKeyId: enterprise.bedrockAccessKeyId,
            secretAccessKey: enterprise.bedrockSecretAccessKey,
            sessionToken: enterprise.bedrockSessionToken,
          }
        : null;
  }

  if (
    explicitCredentialSource &&
    (!credentials ||
      typeof credentials.accessKeyId !== "string" ||
      credentials.accessKeyId.length === 0 ||
      typeof credentials.secretAccessKey !== "string" ||
      credentials.secretAccessKey.length === 0)
  ) {
    const error = new Error(
      `AWS ${explicitCredentialSource} returned invalid credentials. Expected accessKeyId and secretAccessKey.`
    );
    error.name = "CredentialsProviderError";
    throw error;
  }

  return createAmazonBedrock({
    region,
    ...(enterprise?.frozenCredentials
      ? {
          baseURL: enterprise.bedrockBaseURL,
          apiKey: "",
          accessKeyId: "",
          secretAccessKey: "",
          fetch: verificationFetch,
        }
      : {}),
    ...(credentials
      ? {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken,
        }
      : {}),
  })(model);
}

function createAzureModel(model, apiKey, enterprise) {
  const { createAzure } = require("@ai-sdk/azure");
  if (!apiKey || !enterprise?.azureEndpoint)
    throw new Error("Configure your Azure endpoint and API key.");
  const endpoint = new URL(enterprise.azureEndpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password)
    throw new Error("Azure requires an HTTPS endpoint without embedded credentials.");
  return createAzure({
    apiKey,
    baseURL: enterprise.azureEndpoint,
    apiVersion: enterprise.azureApiVersion || "2024-10-21",
    ...(enterprise.frozenCredentials ? { fetch: verificationFetch } : {}),
  })(model);
}

async function createVertexModel(model, apiKey, enterprise) {
  const { createVertex } = require("@ai-sdk/google-vertex");
  if (enterprise?.vertexAuthSource === "apiKey") {
    const effectiveKey = enterprise.frozenCredentials
      ? apiKey
      : apiKey || process.env.GOOGLE_VERTEX_API_KEY || "";
    if (!effectiveKey) throw new Error("Configure a Vertex API key in Settings.");
    // Main's committed stored key wins over the supported legacy fallback.
    return createVertex({
      apiKey: effectiveKey,
      ...(enterprise.frozenCredentials ? { fetch: verificationFetch } : {}),
    })(model);
  }
  if (enterprise?.vertexAuthSource === "adc") {
    // Explicit empty suppresses the SDK's ambient GOOGLE_VERTEX_API_KEY fallback.
    let googleAuthOptions;
    if (enterprise.frozenCredentials) {
      const unsupported = () =>
        Object.assign(
          new Error("This ADC source cannot be tested with a captured configuration."),
          { code: "UNSUPPORTED_AUTH_SOURCE" }
        );
      let input;
      try {
        if (!enterprise.vertexAdcFile) throw unsupported();
        const raw = await require("node:fs/promises").readFile(enterprise.vertexAdcFile, "utf8");
        if (raw.length > 131072) throw unsupported();
        input = JSON.parse(raw);
      } catch {
        throw unsupported();
      }
      const service = input?.type === "service_account";
      const user = input?.type === "authorized_user";
      const allowed = new Set(
        service
          ? [
              "type",
              "project_id",
              "private_key_id",
              "private_key",
              "client_email",
              "client_id",
              "auth_uri",
              "token_uri",
              "auth_provider_x509_cert_url",
              "client_x509_cert_url",
              "universe_domain",
            ]
          : [
              "type",
              "client_id",
              "client_secret",
              "refresh_token",
              "quota_project_id",
              "account",
              "universe_domain",
            ]
      );
      const required = service
        ? ["private_key", "client_email"]
        : ["client_id", "client_secret", "refresh_token"];
      if (
        (!service && !user) ||
        Object.keys(input).some((key) => !allowed.has(key)) ||
        required.some((key) => typeof input[key] !== "string" || !input[key]) ||
        (input.universe_domain && input.universe_domain !== "googleapis.com") ||
        (input.token_uri &&
          ![
            "https://oauth2.googleapis.com/token",
            "https://accounts.google.com/o/oauth2/token",
          ].includes(input.token_uri))
      )
        throw unsupported();
      const credentials = service
        ? {
            type: input.type,
            private_key: input.private_key,
            client_email: input.client_email,
            private_key_id: input.private_key_id,
            project_id: input.project_id,
          }
        : {
            type: input.type,
            client_id: input.client_id,
            client_secret: input.client_secret,
            refresh_token: input.refresh_token,
          };
      const { GoogleAuth } = require("google-auth-library");
      const auth = new GoogleAuth({
        credentials,
        projectId: enterprise.vertexProject,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        clientOptions: {
          transporterOptions: {
            fetchImplementation: verificationFetch,
            maxRedirects: 0,
            timeout: 12000,
          },
        },
      });
      const token = await auth.getAccessToken();
      if (typeof token !== "string" || !token) throw unsupported();
      // The SDK creates GoogleAuth lazily. Its supplied cached authClient can
      // only return this token, so it cannot reload ADC, environment or metadata.
      googleAuthOptions = { authClient: { getAccessToken: async () => ({ token }) } };
    }
    return createVertex({
      apiKey: "",
      project: enterprise.vertexProject,
      location: enterprise.vertexLocation || "us-central1",
      ...(googleAuthOptions ? { googleAuthOptions, fetch: verificationFetch } : {}),
    })(model);
  }
  throw new Error("Choose a supported Vertex authentication source.");
}

module.exports = { getEnterpriseAIModel };
