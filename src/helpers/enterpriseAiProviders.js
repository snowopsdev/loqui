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
// model construction uses explicitly captured executor inputs.
function checkVerification(execution) {
  if (!execution) return;
  execution.assertLive?.();
  execution.signal.throwIfAborted();
  if (Date.now() >= execution.deadlineAt)
    throw new DOMException("The connection test timed out.", "TimeoutError");
}

// Composed over main's metered transport when one is supplied (Sealed mode),
// so captured SDK, ADC and auth requests are each gated and recorded.
const verificationFetch = (execution, fetchImpl) => (input, init) => {
  checkVerification(execution);
  const signal =
    init?.signal && init.signal !== execution.signal
      ? AbortSignal.any([execution.signal, init.signal])
      : execution.signal;
  signal.throwIfAborted();
  return (fetchImpl || fetch)(input, { ...init, signal, redirect: "error" });
};

async function getEnterpriseAIModel(
  provider,
  model,
  apiKey,
  enterprise,
  credentialMaterial,
  fetchImpl,
  execution
) {
  if (!enterprise?.frozenCredentials) {
    // Older non-dictation main callers enter the same normalizer here. Once
    // resolved, SDK factories see only explicit executor and credential inputs.
    if (!enterprise?.authSource) {
      const identity = require("./enterpriseRecipientIdentity");
      const env = identity.captureEnterpriseEnvironment(provider, process.env);
      const resolved = identity.resolveEnterpriseExecutor(provider, enterprise, env);
      if (resolved.status !== "ready")
        throw Object.assign(
          new Error(
            provider === "azure"
              ? "Configure your Azure endpoint and API key."
              : provider === "vertex"
                ? "Choose a supported Vertex authentication source."
                : "recipientUnknown"
          ),
          { code: "recipientUnknown", messageKey: "voiceOverlay.errors.recipientUnknown" }
        );
      credentialMaterial = identity.resolveEnterpriseCredentialMaterial(
        provider,
        enterprise,
        apiKey,
        env
      );
      enterprise = resolved.executor;
    }
    return createExplicitModel(provider, model, apiKey, enterprise, credentialMaterial, fetchImpl);
  }
  // Main passes the probe's one overall budget. Direct frozen-factory callers
  // also get a bounded lifetime; general chat/auth keeps its existing defaults.
  const verification = enterprise?.frozenCredentials
    ? execution || { signal: AbortSignal.timeout(12000), deadlineAt: Date.now() + 12000 }
    : null;
  checkVerification(verification);
  switch (provider) {
    case "bedrock":
      return createBedrockModel(model, enterprise, verification, fetchImpl);
    case "azure":
      return createAzureModel(model, apiKey, enterprise, verification, fetchImpl);
    case "vertex":
      return createVertexModel(model, apiKey, enterprise, verification, fetchImpl);
    default:
      throw new Error(`Unsupported enterprise provider: ${provider}`);
  }
}

async function createExplicitModel(provider, model, apiKey, executor, material, fetchImpl) {
  const transport = fetchImpl ? { fetch: fetchImpl } : {};
  if (provider === "azure") {
    if (!apiKey)
      throw Object.assign(new Error("Configure your Azure endpoint and API key."), {
        code: "recipientUnknown",
        messageKey: "voiceOverlay.errors.recipientUnknown",
      });
    return require("@ai-sdk/azure").createAzure({
      apiKey,
      baseURL: executor.endpoint,
      apiVersion: executor.apiVersion,
      ...transport,
    })(model);
  }
  if (provider === "bedrock") {
    if (!material || material.authSource !== executor.authSource)
      throw new Error("Invalid Bedrock credential source");
    const credentials =
      executor.authSource === "profile"
        ? await require("@aws-sdk/credential-providers").fromNodeProviderChain({
            profile: executor.profile,
          })()
        : material;
    if (!credentials.accessKeyId || !credentials.secretAccessKey)
      throw new Error("Invalid Bedrock credentials");
    return require("@ai-sdk/amazon-bedrock").createAmazonBedrock({
      region: executor.region,
      baseURL: executor.endpointOverride,
      apiKey: "",
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
      ...transport,
    })(model);
  }
  if (provider === "vertex") {
    if (executor.authSource === "apiKey" && !material?.vertexApiKey)
      throw new Error("Configure a Vertex API key in Settings.");
    return require("@ai-sdk/google-vertex").createVertex({
      apiKey: executor.authSource === "adc" ? "" : material.vertexApiKey,
      project: executor.project ?? undefined,
      location: executor.location,
      ...transport,
    })(model);
  }
  throw new Error("Unsupported enterprise provider");
}

async function createBedrockModel(model, enterprise, execution, fetchImpl) {
  checkVerification(execution);
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
    checkVerification(execution);
    const profiles = await require("@smithy/core/config").parseKnownFiles({
      filepath: enterprise.bedrockCredentialsFile,
      configFilepath: enterprise.bedrockConfigFile,
      ignoreCache: true,
    });
    checkVerification(execution);
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

  checkVerification(execution);
  return createAmazonBedrock({
    region,
    ...(enterprise?.frozenCredentials
      ? {
          baseURL: enterprise.bedrockBaseURL,
          apiKey: "",
          accessKeyId: "",
          secretAccessKey: "",
          fetch: verificationFetch(execution, fetchImpl),
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

function createAzureModel(model, apiKey, enterprise, execution, fetchImpl) {
  checkVerification(execution);
  const { createAzure } = require("@ai-sdk/azure");
  if (!apiKey || !enterprise?.azureEndpoint)
    throw new Error("Configure your Azure endpoint and API key.");
  const endpoint = new URL(enterprise.azureEndpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password)
    throw new Error("Azure requires an HTTPS endpoint without embedded credentials.");
  checkVerification(execution);
  return createAzure({
    apiKey,
    baseURL: enterprise.azureEndpoint,
    apiVersion: enterprise.azureApiVersion || "2024-10-21",
    ...(enterprise.frozenCredentials ? { fetch: verificationFetch(execution, fetchImpl) } : {}),
  })(model);
}

async function createVertexModel(model, apiKey, enterprise, execution, fetchImpl) {
  checkVerification(execution);
  const { createVertex } = require("@ai-sdk/google-vertex");
  if (enterprise?.vertexAuthSource === "apiKey") {
    const effectiveKey = apiKey;
    if (!effectiveKey) throw new Error("Configure a Vertex API key in Settings.");
    // Main's committed stored key wins over the supported legacy fallback.
    checkVerification(execution);
    return createVertex({
      apiKey: effectiveKey,
      ...(enterprise.frozenCredentials ? { fetch: verificationFetch(execution, fetchImpl) } : {}),
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
        if (enterprise.capturedAdcCredentials) {
          input = enterprise.capturedAdcCredentials;
        } else {
          if (!enterprise.vertexAdcFile) throw unsupported();
          checkVerification(execution);
          const raw = await require("node:fs/promises").readFile(enterprise.vertexAdcFile, {
            encoding: "utf8",
            signal: execution.signal,
          });
          checkVerification(execution);
          if (raw.length > 131072) throw unsupported();
          input = JSON.parse(raw);
        }
      } catch {
        checkVerification(execution);
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
      checkVerification(execution);
      const auth = new GoogleAuth({
        credentials,
        projectId: enterprise.vertexProject,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        clientOptions: {
          transporterOptions: {
            fetchImplementation: verificationFetch(execution, fetchImpl),
            maxRedirects: 0,
            signal: execution.signal,
            retry: false,
            // OAuth2Client enables POST retries per request; this predicate is
            // retained by Gaxios's merged options and forbids all probe retries.
            retryConfig: { retry: 0, noResponseRetries: 0, shouldRetry: () => false },
          },
        },
      });
      checkVerification(execution);
      const token = await auth.getAccessToken();
      checkVerification(execution);
      if (typeof token !== "string" || !token) throw unsupported();
      // The SDK creates GoogleAuth lazily. Its supplied cached authClient can
      // only return this token, so it cannot reload ADC, environment or metadata.
      googleAuthOptions = {
        authClient: {
          getAccessToken: async () => {
            checkVerification(execution);
            return { token };
          },
        },
      };
    }
    checkVerification(execution);
    return createVertex({
      apiKey: "",
      project: enterprise.vertexProject,
      location: enterprise.vertexLocation || "us-central1",
      ...(googleAuthOptions
        ? { googleAuthOptions, fetch: verificationFetch(execution, fetchImpl) }
        : {}),
    })(model);
  }
  throw new Error("Choose a supported Vertex authentication source.");
}

module.exports = { getEnterpriseAIModel };
