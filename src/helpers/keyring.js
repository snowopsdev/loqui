const path = require("node:path");
const os = require("node:os");
// Provider key health (SET-R5 C). Verifying sends a stored credential to its
// provider, so it runs only when the user presses Verify. A verdict is
// recorded only if the credential it tested is still current: every save,
// removal, undo and reset bumps the credential authority's generation
// (credentialAuthority.js), and a result for an older generation is dropped.
// Rows hold metadata only, keyed by authentication identity.

const { createHash } = require("node:crypto");
const { createRecipientAuthority } = require("./recipientAuthority");
const { normalizeRouteVerificationOptions } = require("./routeVerificationOptions.mjs");
const { cortiTokenUrl } = require("./cortiAuth");
const { resolveProviderRequest, isSealedRefusal } = require("./providerConnectionTest");

const KEYRING_IDS = [
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "xai",
  "mistral",
  "openrouter",
  "tinfoil",
  "deepgram",
  "assemblyai",
  "corti:text",
  "corti:speech",
];
// describeVerify also names the recipient of the enterprise "Test connection"
// (Task 9). Those identities have no keyring row and no keyring Verify.
const ENTERPRISE_IDS = ["bedrock", "azure", "vertex"];
const SPEECH_ONLY = new Set(["deepgram", "assemblyai"]);
const ROTATION_DAYS = 90;
const DAY_MS = 86_400_000;
// Same validation cortiAuth.js applies; an invalid target is refused here so
// it can never be recorded as a rejected credential.
// English names for native notifications; mirrors src/lib/locality.ts
// PROVIDER_NAMES (main cannot import the renderer module).
const PROVIDER_NAMES = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  groq: "Groq",
  xai: "xAI",
  mistral: "Mistral",
  openrouter: "OpenRouter",
  tinfoil: "Tinfoil",
  deepgram: "Deepgram",
  assemblyai: "AssemblyAI",
  corti: "Corti",
};

const providerOf = (identity) => identity.split(":")[0];
const keyringDisplayName = (identity) => PROVIDER_NAMES[providerOf(identity)] || identity;

// R2-7. Plan 07's SealedModeError (code "SEALED_MODE", message tagged
// "[SEALED_MODE" or "[SEALED_MODE:interrupted]", possibly as a cause).
// Plan 07 may swap this for its egressPolicy.isSealedModeError; the rule is the same.
// The config _runProviderConnectionTest receives. "__stored__" makes main
// substitute the Corti client pair Verify captured (ipcHandlers.js test method).
function testConfigFor(identity, options = {}) {
  options = options ?? {};
  if (identity === "corti:speech") {
    const normalized = normalizeRouteVerificationOptions(options);
    if (!normalized) return null;
    const { cortiEnvironment: environment, cortiTenant: tenant } = normalized;
    return {
      scope: "transcription",
      provider: "corti",
      clientId: "__stored__",
      clientSecret: "__stored__",
      environment,
      tenant,
    };
  }
  if (SPEECH_ONLY.has(identity)) return { scope: "transcription", provider: identity };
  return { scope: "reasoning", provider: providerOf(identity) };
}

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

// R2-6. The hosts a keyring Verify sends the credential to, computed from the
// same config and the same URL builders as the request itself: cortiTokenUrl
// is what getCortiToken fetches, resolveProviderRequest is what
// testProviderConnection fetches. The placeholder key only satisfies
// resolveProviderRequest's key check; its headers are discarded.
function verifyHostsFor(config) {
  if (!config) return [];
  if (config.provider === "corti" && config.scope === "transcription") {
    return [hostOf(cortiTokenUrl({ environment: config.environment, tenant: config.tenant }))];
  }
  try {
    const { endpoints } = resolveProviderRequest({ ...config, apiKey: "describe-only" });
    return [...new Set(endpoints.map(hostOf).filter(Boolean))];
  } catch {
    return [];
  }
}

// Mirrors @ai-sdk/amazon-bedrock 5.0.94 resolveAmazonBedrockBaseURL.
const AWS_PARTITION_DNS_SUFFIXES = [
  ["cn-", "amazonaws.com.cn"],
  ["us-iso-", "c2s.ic.gov"],
  ["us-isob-", "sc2s.sgov.gov"],
  ["eu-isoe-", "cloud.adc-e.uk"],
  ["us-isof-", "csp.hci.ic.gov"],
  ["eusc-", "amazonaws.eu"],
];

// The host a URL built like the SDK's really reaches; null when it cannot be
// parsed or carries credentials (fetch refuses both). Same rule as Task 1's
// routeGraph requestHost and src/helpers/enterpriseRouteFacts.js.
function requestHost(url) {
  try {
    const parsed = new URL(url);
    return parsed.username || parsed.password ? null : parsed.host || null;
  } catch {
    return null;
  }
}
const hostList = (host) => (host ? [host] : []);

// enterpriseRouteFacts({}): main's environment redirects nothing.
const NO_ENVIRONMENT_OVERRIDES = {
  bedrockEndpoint: { set: false, host: null },
  bedrockProfile: false,
  vertexApiKeyEnv: false,
  vertexProjectEnv: false,
};

// The enterprise Test connection's recipient (Task 9), from main's committed
// enterprise config, the same object personalInference sends with
// (main.js getEnterpriseConfig, :447-457), plus `routeFacts`, Task 1's
// enterpriseRouteFacts(process.env): the environment overrides the SDKs honour.
// The rules are Task 1's enterpriseRequestHost, so this names the host the
// request really reaches; `hosts` is [] wherever that function gives null.
function enterpriseVerifyTarget(identity, enterprise, fields) {
  const env = enterprise.routeFacts || NO_ENVIRONMENT_OVERRIDES;
  if (identity === "azure") {
    try {
      const url = new URL(String(enterprise.azureEndpoint || ""));
      // createAzureModel refuses these (enterpriseAiProviders.js:73-77).
      if (url.protocol !== "https:" || url.username || url.password)
        return { hosts: [], fields: ["key"] };
      return { hosts: [url.host], fields: ["key"] };
    } catch {
      return { hosts: [], fields: ["key"] };
    }
  }
  if (identity === "bedrock") {
    const sent = enterprise.bedrockProfile
      ? ["profile"]
      : ["accessKeyId", "secretAccessKey", "sessionToken"].filter((name) => fields[name]);
    // AWS_ENDPOINT_URL_BEDROCK_RUNTIME, else AWS_ENDPOINT_URL, wins over the
    // region (resolveAmazonBedrockBaseURL, dist/index.js:3120-3129). host null:
    // set but unusable, so no request can be made and no host is named.
    if (env.bedrockEndpoint.set) return { hosts: hostList(env.bedrockEndpoint.host), fields: sent };
    const region = enterprise.bedrockRegion || "us-east-1"; // enterpriseAiProviders.js:26
    const suffix =
      AWS_PARTITION_DNS_SUFFIXES.find(([prefix]) => region.startsWith(prefix))?.[1] ||
      "amazonaws.com";
    return {
      hosts: hostList(requestHost(`https://bedrock-runtime.${region}.${suffix}`)),
      fields: sent,
    };
  }
  // The persisted source is authoritative. Key presence only describes the
  // readiness/field sent within apiKey mode; it never switches the host.
  if (identity === "vertex" && enterprise.vertexAuthSource === "apiKey") {
    const sent = fields.key ? ["key"] : env.vertexApiKeyEnv ? ["environmentKey"] : ["key"];
    return { hosts: ["aiplatform.googleapis.com"], fields: sent };
  }
  if (identity === "vertex" && enterprise.vertexAuthSource !== "adc")
    return { hosts: [], fields: [] };
  // ADC ignores stored and ambient API keys and sends no key field.
  const location = enterprise.vertexLocation || "us-central1"; // :92
  const host =
    location === "global"
      ? "aiplatform.googleapis.com"
      : location === "eu" || location === "us"
        ? `aiplatform.${location}.rep.googleapis.com`
        : `${location}-aiplatform.googleapis.com`;
  const project = enterprise.vertexProject || "";
  return {
    hosts: hostList(
      requestHost(
        `https://${host}/v1beta1/projects/${project}/locations/${location}/publishers/google`
      )
    ),
    fields: [],
  };
}

function classifyResult(result) {
  if (result && result.success) return { status: "verified", errorCode: null, httpStatus: null };
  const errorCode = (result && result.errorCode) || "network";
  const httpStatus = (result && typeof result.status === "number" && result.status) || null;
  return {
    status: errorCode === "credentialsRejected" ? "rejected" : "unreachable",
    errorCode,
    httpStatus,
  };
}

function toEntry(identity, row) {
  return {
    id: identity,
    providerId: providerOf(identity),
    status: row ? row.status : "unverified",
    lastVerifiedAt: row ? row.last_verified_at : null,
    lastErrorCode: row ? row.last_error_code : null,
    lastErrorStatus: row ? row.last_error_status : null,
    reminderDueAt: row ? row.reminder_due_at : null,
  };
}

// All fingerprints derive from an explicit non-secret whitelist. Credential
// values and digests never participate in token/coalescing/persisted metadata.
const fingerprint = (config) => createHash("sha256").update(JSON.stringify(config)).digest("hex");
const recipientChanged = () =>
  Object.assign(new Error("Review the destination again."), { code: "RECIPIENT_CHANGED" });

function createKeyring({
  store,
  credentials,
  runTest,
  runEnterpriseTest,
  now = Date.now,
  broadcast = () => {},
  isSealed = () => false,
  enterpriseConfig = () => ({}),
  environment = () => process.env,
}) {
  const recipients = createRecipientAuthority({ now });
  const inflight = new Map();
  const latest = new Map();
  let legacyValue;
  let legacyRevision = 0;
  const legacyIdentity = () => {
    const value = environment().GOOGLE_VERTEX_API_KEY || "";
    if (value !== legacyValue) {
      legacyValue = value;
      legacyRevision++;
    }
    return legacyRevision;
  };
  const metadata = (identity) => {
    const row = credentials.list().find((entry) => entry.id === identity);
    return credentials.isFenced?.() ? null : row;
  };
  const known = (identity) => {
    if (!KEYRING_IDS.includes(identity)) throw new Error(`Unknown keyring identity: ${identity}`);
  };
  const rowFor = (identity) => store.all().find((row) => row.identity === identity) || null;
  const changed = (id) => broadcast("keyring-changed", { id });
  const blank = (identity) => ({
    identity,
    generation: null,
    config_fingerprint: null,
    status: "unverified",
    last_verified_at: null,
    last_error_code: null,
    last_error_status: null,
    reminder_due_at: null,
    reminded_at: null,
    updated_at: now(),
  });
  const update = (identity, patch) => {
    const row = { ...(rowFor(identity) || blank(identity)), ...patch, updated_at: now() };
    store.save(row);
    return row;
  };
  const fixedSnapshot = (identity, options = {}) => {
    options = options ?? {};
    const config = testConfigFor(identity, options);
    if (!config) return null;
    const env = environment();
    // Freeze the effective override, including its absence: the executor must
    // never resolve a new live environment after credential capture.
    const requestEnvironment = {
      LOQUI_OPENAI_BASE_URL: env.LOQUI_OPENAI_BASE_URL || env.OPENAI_BASE_URL || "",
      OPENAI_BASE_URL: "",
    };
    let endpoints;
    try {
      endpoints =
        identity === "corti:speech"
          ? [cortiTokenUrl(config)]
          : resolveProviderRequest({ ...config, apiKey: "description" }, requestEnvironment)
              .endpoints;
      if (
        endpoints.some((url) => {
          const parsed = new URL(url);
          return (
            !["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password
          );
        })
      )
        return null;
    } catch {
      return null;
    }
    const canonical = {
      identity,
      redirect: "error",
      provider: config.provider,
      scope: config.scope,
      endpoints,
      ...(identity === "corti:speech"
        ? { environment: config.environment, tenant: config.tenant }
        : {}),
    };
    return {
      config,
      canonical,
      requestEnvironment,
      fingerprint: fingerprint(canonical),
      hosts: [...new Set(endpoints.map((url) => new URL(url).host))],
      fields: identity === "corti:speech" ? ["clientId", "clientSecret"] : ["key"],
    };
  };
  const entryFor = (identity, options = {}) => {
    const meta = metadata(identity);
    if (!meta || meta.unknown) return { ...toEntry(identity, null), unknown: true };
    if (!meta.present) return null;
    const row = rowFor(identity);
    const target = fixedSnapshot(identity, options);
    const matches =
      target &&
      row?.generation === meta.generation &&
      row?.config_fingerprint === target.fingerprint;
    return toEntry(
      identity,
      matches ? row : row ? { ...blank(identity), reminder_due_at: row.reminder_due_at } : null
    );
  };
  const unsubscribe = credentials.subscribe((change) => {
    if (!KEYRING_IDS.includes(change.id)) return;
    latest.delete(change.id);
    const row = rowFor(change.id);
    if (change.unknown) {
      changed(change.id);
      return;
    }
    if (!change.present) {
      if (row) store.remove(change.id);
      changed(change.id);
      return;
    }
    if (change.cause !== "save" && change.cause !== "undo") return;
    update(change.id, {
      ...blank(change.id),
      generation: change.generation,
      reminder_due_at: row?.reminder_due_at != null ? now() + ROTATION_DAYS * DAY_MS : null,
    });
    changed(change.id);
  });

  async function verify(identity, options = {}, sender) {
    options = options ?? {};
    known(identity);
    const target = fixedSnapshot(identity, options);
    if (!target) return { outcome: "invalidOptions", entry: entryFor(identity, options) };
    const result = (outcome) => ({ outcome, entry: entryFor(identity, options) });
    const validate = (meta) => {
      const current = fixedSnapshot(identity, options);
      if (!sender || !current || current.fingerprint !== target.fingerprint)
        throw recipientChanged();
      recipients.validate(options.recipientToken, sender, current.canonical, meta);
    };
    try {
      validate(metadata(identity));
    } catch {
      return result("recipientChanged");
    }
    const captured = await credentials.captureCommitted(identity);
    if (!captured) return result("unavailable");
    if (isSealed()) return result("sealed");
    // The reviewed absence may stay absent, but it can never be upgraded to a
    // credential-bearing request under the earlier disclosure.
    try {
      validate({ id: identity, ...captured });
      validate(metadata(identity));
    } catch {
      return result("recipientChanged");
    }
    if (!captured.present) return { outcome: "missing", entry: null };
    if (isSealed()) return result("sealed");
    const key = `${identity}@${captured.generation}@${target.fingerprint}`;
    latest.set(identity, key);
    if (inflight.has(key)) return inflight.get(key);
    const run = (async () => {
      let response;
      try {
        validate(metadata(identity));
        response = await runTest(target.config, captured.values, target.requestEnvironment);
      } catch (error) {
        if (isSealedRefusal(error)) return result("sealed");
        if (error?.code === "RECIPIENT_CHANGED") return result("recipientChanged");
        response = { success: false, errorCode: "network" };
      }
      const meta = metadata(identity);
      const current = fixedSnapshot(identity, options);
      if (
        !meta ||
        meta.unknown ||
        !meta.present ||
        meta.generation !== captured.generation ||
        current?.fingerprint !== target.fingerprint ||
        latest.get(identity) !== key
      )
        return result("superseded");
      const verdict = classifyResult(response);
      update(identity, {
        generation: captured.generation,
        config_fingerprint: target.fingerprint,
        status: verdict.status,
        last_verified_at: now(),
        last_error_code: verdict.errorCode,
        last_error_status: verdict.httpStatus,
      });
      changed(identity);
      return result("recorded");
    })();
    inflight.set(key, run);
    run.finally(() => inflight.delete(key)).catch(() => {});
    return run;
  }

  const enterpriseSnapshot = (identity, options = {}) => {
    options = options ?? {};
    const settings = enterpriseConfig();
    if (!settings) return null;
    const env = environment();
    const region = settings.bedrockRegion || "us-east-1";
    const suffix =
      AWS_PARTITION_DNS_SUFFIXES.find(([prefix]) => region.startsWith(prefix))?.[1] ||
      "amazonaws.com";
    const rawOverride =
      typeof env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME === "string"
        ? env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME
        : env.AWS_ENDPOINT_URL;
    const bedrockCredentialsFile =
      env.AWS_SHARED_CREDENTIALS_FILE || path.join(os.homedir(), ".aws", "credentials");
    const bedrockConfigFile = env.AWS_CONFIG_FILE || path.join(os.homedir(), ".aws", "config");
    // Resolve the ADC source path without opening it. The explicit test reads
    // exactly this file; neither metadata nor a later live GAC value is used.
    const vertexAdcFile =
      env.GOOGLE_APPLICATION_CREDENTIALS ||
      env.google_application_credentials ||
      (process.platform === "win32"
        ? env.APPDATA
          ? path.join(env.APPDATA, "gcloud", "application_default_credentials.json")
          : ""
        : env.HOME
          ? path.join(env.HOME, ".config", "gcloud", "application_default_credentials.json")
          : "");
    const bedrockBaseURL =
      typeof rawOverride === "string"
        ? rawOverride.replace(/\/$/, "")
        : `https://bedrock-runtime.${region}.${suffix}`;
    // Whitelist the selected provider's complete effective request settings.
    // Values unrelated to that provider cannot accidentally authorize a target.
    const stored = metadata(identity);
    const fields = stored?.fields || {};
    const model = typeof options.model === "string" ? options.model.trim() : "";
    if (model.length > 256) return null;
    const canonical = {
      identity,
      redirect: "error",
      model,
      ...(identity === "bedrock"
        ? {
            region,
            profile: settings.bedrockProfile || "",
            baseURL: bedrockBaseURL,
            credentialsFile: bedrockCredentialsFile,
            configFile: bedrockConfigFile,
          }
        : identity === "azure"
          ? {
              endpoint: settings.azureEndpoint || "",
              apiVersion: settings.azureApiVersion || "2024-10-21",
            }
          : {
              source: settings.vertexAuthSource,
              adcFile: settings.vertexAuthSource === "adc" ? vertexAdcFile : null,
              project: settings.vertexProject || "",
              location: settings.vertexLocation || "us-central1",
              legacyKeyRevision:
                settings.vertexAuthSource === "apiKey" && !fields.key ? legacyIdentity() : 0,
            }),
    };
    const enterprise = {
      ...settings,
      bedrockBaseURL,
      bedrockCredentialsFile,
      bedrockConfigFile,
      frozenCredentials: true,
      vertexAdcFile,
      azureApiVersion: settings.azureApiVersion || "2024-10-21",
    };
    const target = enterpriseVerifyTarget(
      identity,
      {
        ...enterprise,
        routeFacts: {
          bedrockEndpoint: {
            set: true,
            host: requestHost(`${bedrockBaseURL}/model/fixture/converse`),
          },
          vertexApiKeyEnv: !!env.GOOGLE_VERTEX_API_KEY,
        },
      },
      fields
    );
    return { canonical, enterprise, target };
  };

  async function describeVerify(identity, options = {}, sender) {
    if (!KEYRING_IDS.includes(identity) && !ENTERPRISE_IDS.includes(identity))
      throw new Error(`Unknown credential identity: ${identity}`);
    const target = ENTERPRISE_IDS.includes(identity)
      ? enterpriseSnapshot(identity, options)
      : fixedSnapshot(identity, options);
    const description = ENTERPRISE_IDS.includes(identity) ? target?.target : target;
    if (!target || !description)
      return {
        hosts: [],
        fields: identity === "corti:speech" ? ["clientId", "clientSecret"] : ["key"],
      };
    const meta = metadata(identity);
    const names = { hosts: description.hosts, fields: description.fields };
    if (!sender || !meta || meta.unknown || names.hosts.length === 0) return names;
    return { ...names, recipientToken: recipients.issue(sender, target.canonical, meta) };
  }

  async function verifyConnection(input, sender) {
    const identity = input?.provider;
    if (
      !ENTERPRISE_IDS.includes(identity) ||
      typeof input?.model !== "string" ||
      !input.model.trim()
    )
      return { success: false, errorCode: "invalidOptions" };
    const options = { model: input.model };
    const snapshot = enterpriseSnapshot(identity, options);
    const changedResult = { success: false, errorCode: "recipientChanged" };
    const validate = (meta) => {
      const current = enterpriseSnapshot(identity, options);
      if (
        !sender ||
        !snapshot ||
        !current ||
        JSON.stringify(current.canonical) !== JSON.stringify(snapshot.canonical)
      )
        throw recipientChanged();
      recipients.validate(input.recipientToken, sender, current.canonical, meta);
    };
    try {
      validate(metadata(identity));
    } catch {
      return changedResult;
    }
    const captured = await credentials.captureCommitted(identity);
    if (!captured) return { success: false, errorCode: "unavailable" };
    try {
      validate({ id: identity, ...captured });
      validate(metadata(identity));
    } catch {
      return changedResult;
    }
    if (isSealed()) return { success: false, errorCode: "sealed" };
    if (!captured.present) return { success: false, errorCode: "invalidOptions" };
    // apiKey mode never silently changes to ADC. Captured values already apply
    // the authority's committed stored-key / supported legacy fallback rule.
    const values = captured.values;
    const enterprise = Object.freeze({
      ...snapshot.enterprise,
      bedrockAccessKeyId: values.accessKeyId || "",
      bedrockSecretAccessKey: values.secretAccessKey || "",
      bedrockSessionToken: values.sessionToken || "",
    });
    const admit = () => {
      validate(metadata(identity));
      if (isSealed()) throw Object.assign(new Error("Sealed"), { code: "SEALED_MODE" });
    };
    try {
      admit();
      await runEnterpriseTest(
        {
          provider: identity,
          model: snapshot.canonical.model,
          apiKey: values.key || "",
          enterprise,
          messages: [{ role: "user", content: "Reply with hello." }],
          maxOutputTokens: 16,
          timeoutMs: 12000,
        },
        admit
      );
      return { success: true };
    } catch (error) {
      if (error?.code === "RECIPIENT_CHANGED") return changedResult;
      if (error?.code === "UNSUPPORTED_AUTH_SOURCE")
        return { success: false, errorCode: "unsupportedAuthSource" };
      if (isSealedRefusal(error)) return { success: false, errorCode: "sealed" };
      if (error?.name === "AbortError" || error?.name === "TimeoutError")
        return { success: false, errorCode: "timeout" };
      const status = Number.isInteger(error?.statusCode)
        ? error.statusCode
        : Number.isInteger(error?.status)
          ? error.status
          : null;
      return {
        success: false,
        errorCode: status === 401 || status === 403 ? "credentialsRejected" : "network",
        ...(status >= 100 && status <= 599 ? { status } : {}),
      };
    }
  }

  return {
    list(options = {}) {
      return KEYRING_IDS.map((id) => entryFor(id, options)).filter(Boolean);
    },
    routeHealth(options = {}) {
      const current = KEYRING_IDS.flatMap((identity) => {
        const meta = metadata(identity);
        const target = fixedSnapshot(identity, options);
        return meta && !meta.unknown && meta.present && target
          ? [{ identity, generation: meta.generation, configFingerprint: target.fingerprint }]
          : [];
      });
      return {
        options: normalizeRouteVerificationOptions(options ?? {}),
        current,
        health: store
          .all()
          .filter(
            (row) =>
              KEYRING_IDS.includes(row.identity) &&
              Number.isSafeInteger(row.generation) &&
              row.config_fingerprint
          )
          .map((row) => ({
            identity: row.identity,
            generation: row.generation,
            configFingerprint: row.config_fingerprint,
            status: row.status,
          })),
      };
    },
    verify,
    describeVerify,
    verifyConnection,
    setReminder(identity, enabled) {
      known(identity);
      const meta = metadata(identity);
      if (!meta || meta.unknown || !meta.present) return null;
      update(identity, {
        reminder_due_at: enabled ? now() + ROTATION_DAYS * DAY_MS : null,
        reminded_at: null,
      });
      changed(identity);
      return entryFor(identity);
    },
    takeDueReminders() {
      const due = store
        .all()
        .filter(
          (row) =>
            KEYRING_IDS.includes(row.identity) &&
            row.reminder_due_at != null &&
            row.reminder_due_at <= now() &&
            row.reminded_at == null &&
            metadata(row.identity)?.present &&
            !metadata(row.identity)?.unknown
        );
      for (const row of due) update(row.identity, { reminded_at: now() });
      return due.map((row) => row.identity);
    },
    dispose() {
      unsubscribe();
      recipients.dispose();
      inflight.clear();
      latest.clear();
      legacyValue = undefined;
    },
  };
}

function startRotationReminders({
  keyring,
  notify,
  intervalMs = 6 * 60 * 60 * 1000,
  setIntervalImpl = setInterval,
  setTimeoutImpl = setTimeout,
  clearIntervalImpl = clearInterval,
  clearTimeoutImpl = clearTimeout,
}) {
  const check = () => {
    let due = [];
    try {
      due = keyring.takeDueReminders();
    } catch {
      return; // a database hiccup must not crash main; the next tick retries
    }
    for (const identity of due) notify(identity);
  };
  const first = setTimeoutImpl(check, 60_000);
  const loop = setIntervalImpl(check, intervalMs);
  first?.unref?.();
  loop?.unref?.();
  return () => {
    clearTimeoutImpl(first);
    clearIntervalImpl(loop);
  };
}

module.exports = {
  KEYRING_IDS,
  ENTERPRISE_IDS,
  ROTATION_DAYS,
  testConfigFor,
  verifyHostsFor,
  enterpriseVerifyTarget,
  isSealedRefusal,
  classifyResult,
  keyringDisplayName,
  createKeyring,
  startRotationReminders,
};
