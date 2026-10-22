const DISCLOSURE_TASKS = new Set([
  "dictationStt",
  "dictationCleanup",
  "translation",
  "voiceAssistant",
  "assistantVision",
]);
const { randomUUID } = require("node:crypto");
const { createAbortError } = require("./abortError");
const { CodexAppServer } = require("./codexAppServer");
const { isSecureHttpEndpoint } = require("../utils/urlUtils.ts");
const egress = require("./privacy/egressGate");
const { taskForScope, isSealedModeError, sealedPhaseOf } = require("./privacy/egressPolicy");
const { providerEndpoint, effectiveEndpoint } = require("./privacy/providerEndpoints");
const { guardMetered } = require("./privacy/gatedFetch");
const childRegistry = require("./privacy/childRegistry");
const CODEX_HOST = "https://chatgpt.com";

const {
  captureEnterpriseEnvironment,
  resolveEnterpriseCredentialMaterial,
  resolveEnterpriseExecutor,
} = require("./enterpriseRecipientIdentity");
const ENTERPRISE_PROVIDERS = new Set(["azure", "bedrock", "vertex"]);
const isEnterpriseProvider = (provider) => ENTERPRISE_PROVIDERS.has(provider);
function recipientFailure(code) {
  return Object.assign(new Error(code), { code, messageKey: `voiceOverlay.errors.${code}` });
}
function validateDictationRecipientFields(input) {
  const hasSession = input.dictationSessionId != null;
  const hasTag = input.enterpriseRecipientTag != null;
  if (input.dictationOperation !== undefined && input.dictationOperation !== true)
    throw recipientFailure("recipientUnknown");
  if (
    hasSession &&
    (typeof input.dictationSessionId !== "string" ||
      !input.dictationSessionId.trim() ||
      input.dictationSessionId.length > 100)
  )
    throw recipientFailure("recipientUnknown");
  if (
    hasTag &&
    (typeof input.enterpriseRecipientTag !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(input.enterpriseRecipientTag))
  )
    throw recipientFailure("recipientUnknown");
  if (input.dictationOperation === true) {
    if (!hasSession || (isEnterpriseProvider(input.provider) && !hasTag))
      throw recipientFailure("recipientUnknown");
  } else if (hasSession || hasTag) throw recipientFailure("recipientUnknown");
}

const PROVIDERS = new Set([
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "openrouter",
  "custom",
  "lan",
  "local",
  "tinfoil",
  "corti",
  "mistral",
  "xai",
  "codex",
  "bedrock",
  "azure",
  "vertex",
]);
const APP_TOOLS = new Set([
  "search_notes",
  "get_note",
  "create_note",
  "update_note",
  "list_folders",
  "get_calendar_events",
  "get_calendar_availability",
  "get_snippet",
  "update_snippets",
  "update_dictionary",
  "copy_to_clipboard",
]);
const SCOPES = new Set([
  "dictationCleanup",
  "dictationAgent",
  "dictationAgentVision",
  "noteFormatting",
  "chatIntelligence",
  "dictationTranslation",
]);
const WEB_SEARCH_PROVIDERS = new Set(["openai", "anthropic", "gemini"]);
function providerSearchTools(provider) {
  if (provider === "openai")
    return {
      web_search: require("@ai-sdk/openai").openai.tools.webSearch({ searchContextSize: "medium" }),
    };
  if (provider === "anthropic")
    return {
      web_search: require("@ai-sdk/anthropic").anthropic.tools.webSearch_20250305({ maxUses: 5 }),
    };
  if (provider === "gemini")
    return { google_search: require("@ai-sdk/google").google.tools.googleSearch({}) };
  throw new Error("The selected provider does not support native web search.");
}
function searchSourcesText(sources) {
  const urls = new Set();
  for (const source of sources || []) {
    if (source.sourceType !== "url") continue;
    try {
      const url = new URL(source.url);
      if (!["https:", "http:"].includes(url.protocol)) continue;
      urls.add(url.href);
    } catch {
      /* Ignore invalid source metadata. */
    }
  }
  return urls.size
    ? "\n\n" + [...urls].map((url, index) => `[${index + 1}](<${url}>)`).join(" · ")
    : "";
}
const ALIASES = {
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  corti: "https://ai.eu.corti.app/v1",
  mistral: "https://api.mistral.ai/v1",
  xai: "https://api.x.ai/v1",
};
function validateCredentialRef(ref) {
  if (
    typeof ref !== "string" ||
    !(
      (PROVIDERS.has(ref) && !["local", "lan", "custom", "codex"].includes(ref)) ||
      (ref.startsWith("custom:") && SCOPES.has(ref.slice(7)))
    )
  )
    throw new Error("Invalid credential reference.");
  return ref;
}
function validateRequest(input) {
  if (input?.disclosureTask != null && !DISCLOSURE_TASKS.has(input.disclosureTask))
    throw new Error("Invalid disclosure task.");
  if (input) {
    validateDictationRecipientFields(input);
    if (
      input.correlationId != null &&
      (typeof input.correlationId !== "string" || input.correlationId.length > 100)
    )
      throw new Error("Invalid correlation id.");
  }
  if (!input || !PROVIDERS.has(input.provider))
    throw new Error("Choose a supported text provider.");
  if (typeof input.requestId !== "string" || input.requestId.length > 100 || !input.requestId)
    throw new Error("Invalid request id.");
  if (typeof input.model !== "string" || !input.model.trim())
    throw new Error("Choose a text model.");
  if (!Array.isArray(input.messages) || input.messages.length > 1000)
    throw new Error("Invalid conversation.");
  for (const message of input.messages) {
    if (
      !["system", "user", "assistant", "tool"].includes(message.role) ||
      !(typeof message.content === "string" || Array.isArray(message.content))
    )
      throw new Error("Invalid conversation message.");
  }
  if (
    input.provider === "codex" &&
    input.messages.some(
      (message) =>
        Array.isArray(message.content) && message.content.some((part) => part.type === "image")
    )
  )
    throw new Error(
      "Codex supports text processing in this integration. Choose an image-capable provider for screenshots."
    );
  if (JSON.stringify(input).length > 24 * 1024 * 1024)
    throw new Error("This request is too large.");
  if (input.apiKey || input.customApiKey)
    throw new Error("Pass a credential reference, never a key, to inference.");
  if (input.credentialRef) validateCredentialRef(input.credentialRef);
  const scope = SCOPES.has(input.inferenceScope) ? input.inferenceScope : "dictationCleanup";
  if (input.webSearch !== undefined && typeof input.webSearch !== "boolean")
    throw new Error("Invalid web search option.");
  if (
    input.webSearch &&
    (!WEB_SEARCH_PROVIDERS.has(input.provider) ||
      !["chatIntelligence", "dictationAgent", "dictationAgentVision"].includes(scope))
  )
    throw new Error(
      "Web search is available only for assistant tasks using a supported selected provider."
    );
  const expectedRef = ["custom", "lan"].includes(input.provider)
    ? `custom:${scope}`
    : input.provider;
  if (input.credentialRef && input.credentialRef !== expectedRef)
    throw new Error("Credential reference does not match the selected provider and task.");
  if (input.tools?.some((tool) => !APP_TOOLS.has(tool.name)))
    throw new Error("Only registered application tools may be exposed.");
  if (
    input.tools?.length &&
    !["chatIntelligence", "dictationAgent", "dictationAgentVision"].includes(scope)
  )
    throw new Error("This task only supports text processing.");
  let baseUrl = input.baseUrl;
  if (["custom", "lan", "local"].includes(input.provider)) {
    let url;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error("Enter a valid provider endpoint.");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("Provider endpoint must use HTTP or HTTPS without embedded credentials.");
    if (!isSecureHttpEndpoint(url.href))
      throw new Error(
        "Use HTTPS for a remote provider; HTTP is allowed only for local network endpoints."
      );
    if (/(^|\.)openwhispr\.(com|app)$/i.test(url.hostname))
      throw new Error("OpenWhispr hosted endpoints are not available in this app.");
    if (
      input.provider === "local" &&
      !(url.hostname === "127.0.0.1" && /^\/v1\/?$/.test(url.pathname))
    )
      throw new Error("The built-in local runtime must use its loopback endpoint.");
    baseUrl = url.href.replace(/\/$/, "");
  } else if (baseUrl) throw new Error("Only custom providers may override their endpoint.");
  return { ...input, baseUrl, inferenceScope: scope, credentialRef: expectedRef };
}

async function createModel(
  provider,
  model,
  apiKey,
  baseURL,
  disableThinking,
  enterprise,
  enterpriseCredentialMaterial,
  fetchImpl,
  execution
) {
  execution?.assertLive();
  // Slot 8 is main's metered transport (Sealed mode). Captured operations
  // compose their liveness and redirect refusal over it; others use it as is.
  const guardedFetch = execution
    ? (input, init) => {
        execution.assertLive();
        return (fetchImpl || fetch)(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([execution.signal, init.signal])
            : execution.signal,
          redirect: "error",
        });
      }
    : fetchImpl;
  if (["bedrock", "azure", "vertex"].includes(provider))
    return require("./enterpriseAiProviders").getEnterpriseAIModel(
      provider,
      model,
      apiKey,
      enterprise,
      enterpriseCredentialMaterial,
      fetchImpl,
      execution
    );
  const { createOpenAI } = require("@ai-sdk/openai");
  if (provider === "openai")
    return createOpenAI({
      apiKey,
      ...(execution ? { baseURL: enterprise.sdkBaseURL } : {}),
      ...(guardedFetch ? { fetch: guardedFetch } : {}),
    })(model);
  if (provider === "anthropic")
    return require("@ai-sdk/anthropic").createAnthropic({
      apiKey,
      ...(execution ? { baseURL: enterprise.sdkBaseURL } : {}),
      ...(guardedFetch ? { fetch: guardedFetch } : {}),
    })(model);
  if (provider === "gemini")
    return require("@ai-sdk/google").createGoogle({
      apiKey,
      ...(guardedFetch ? { fetch: guardedFetch } : {}),
    })(model);
  if (provider === "groq")
    return require("@ai-sdk/groq").createGroq({
      apiKey,
      ...(guardedFetch ? { fetch: guardedFetch } : {}),
    })(model);
  if (provider === "tinfoil")
    return (await (await import("tinfoil")).createTinfoilAI(apiKey))(model);
  const customFetch =
    provider === "openrouter" && disableThinking
      ? async (url, init) => {
          if (typeof init?.body === "string")
            init = {
              ...init,
              body: JSON.stringify({ ...JSON.parse(init.body), reasoning: { enabled: false } }),
            };
          return (guardedFetch || fetch)(url, init);
        }
      : undefined;
  return createOpenAI({
    apiKey: apiKey || "no-key",
    baseURL: ALIASES[provider] || baseURL,
    headers: execution
      ? enterprise.openCodeHeaders
      : require("./openCodeSession").openCodeSessionHeaders(ALIASES[provider] || baseURL),
    ...(customFetch || guardedFetch ? { fetch: customFetch || guardedFetch } : {}),
  }).chat(model);
}

// The Codex release check downloads from GitHub before the app-server starts.
// Its only transport is the metered fetch; a cached digest sends nothing.
function gatedVerifyRelease(verify = require("./codexCli").verifyOfficialCodex) {
  return (options) =>
    guardMetered({ task: "codex", target: "https://api.github.com" }, (ticket) =>
      verify({
        ...options,
        fetchImpl: egress.meteredFetch(
          ticket,
          options?.fetchImpl ?? ((...args) => globalThis.fetch(...args))
        ),
      })
    );
}

// One opaque ledger session per app-server process: main cannot see the
// child's own requests, only that it ran (owner decision, 2026-10-15). The
// session settles only on the OS exit event, never on a kill signal, and the
// child stays in the registry (Task 6a), whose descendant coverage outlives it.
const codexSessions = new WeakMap();
const codexTicket = () =>
  egress.authorize({
    task: "codex",
    target: CODEX_HOST,
    provider: "codex",
    meter: "opaque",
    payload: "text",
  });
function codexSession(child, ticket = codexSessions.get(child) ?? codexTicket()) {
  codexSessions.delete(child);
  childRegistry.register(child, { kind: "codex" });
  const kill = () => {
    try {
      child.kill();
    } catch {} // Only the exit settles the session.
  };
  ticket.signal.addEventListener("abort", kill, { once: true });
  if (ticket.signal.aborted) kill();
  childRegistry.onChildEnd(child, ({ code, signal, failedToStart }) => {
    ticket.signal.removeEventListener("abort", kill);
    // A process that never started could not send anything.
    if (failedToStart) ticket.discard();
    else
      ticket.settle({
        outcome: ticket.signal.aborted || signal ? "cancelled" : code === 0 ? "ok" : "error",
      });
  });
}
// Authorize the session before the launch and run the launch inside it, so
// the production spawn guard reuses this session rather than opening another.
function spawnInCodexSession(spawn, args) {
  const ticket = codexTicket();
  let child;
  try {
    child = egress.runWithTicket(ticket, () => spawn(...args));
  } catch (error) {
    ticket.discard();
    throw error;
  }
  codexSessions.set(child, ticket);
  return child;
}

// The production Codex server with every Sealed-mode hook wired. Tests pass
// only the process seams (executable lookup, version probe, spawn); they
// cannot replace the gate hooks, so they exercise the shipped wiring.
const CODEX_TEST_SEAMS = [
  "resolveExecutable",
  "runFile",
  "spawnProcess",
  "env",
  "homeDir",
  "platform",
  "timeoutMs",
  "stopTimeoutMs",
];
function createCodexServer({ userDataPath, ...seams } = {}) {
  const allowed = Object.fromEntries(
    Object.entries(seams).filter(([key]) => CODEX_TEST_SEAMS.includes(key))
  );
  // Read the (guarded) spawn at launch time, never a capture from import time.
  const spawn = allowed.spawnProcess ?? ((...args) => require("node:child_process").spawn(...args));
  return new CodexAppServer({
    userDataPath,
    ...allowed,
    spawnProcess: (...args) => spawnInCodexSession(spawn, args),
    verifyRelease: gatedVerifyRelease(),
    beforeSpawn: () => egress.assertAllowed({ task: "codex", target: CODEX_HOST }),
    onSpawn: (child) => codexSession(child),
  });
}

const payloadOf = (messages) =>
  messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((part) => part?.type === "image" || part?.type === "image_url")
  )
    ? "image"
    : "text";

function registerPersonalInferenceIPC({
  ipcMain,
  userDataPath,
  getCredential,
  credentials,
  fetchModels = (...args) => globalThis.fetch(...args),
  saveCredential,
  openExternal,
  codex = createCodexServer({ userDataPath }),
  modelFactory = createModel,
  getEnterpriseConfig = () => ({}),
  waitForAdmission = async () => {},
  fetchImpl,
  textOperationSnapshot = () => ({}),
  authorizeTextOperation = () => true,
  onTextOperationIssued = () => {},
  onTextOperationsDisposed = () => {},
  captureTextFactoryInputs = require("./textOperationCapture").captureTextFactoryInputs,
  aiRuntime = () => require("ai"),
}) {
  const textOperations = require("./textOperationAuthority").createTextOperationAuthority({
    credentials,
    snapshot: textOperationSnapshot,
    waitForAdmission,
    authorize: authorizeTextOperation,
    captureFactoryInputs: captureTextFactoryInputs,
  });
  const recipients = require("./recipientAuthority").createRecipientAuthority();
  const active = new Map();
  const pendingTools = new Map();
  const channels = [];
  const subscribers = new Set();
  const send = (sender, payload) => {
    if (!sender.isDestroyed()) sender.send("personal-inference:event", payload);
  };
  const handle = (name, fn) => {
    const channel = `personal-inference:${name}`;
    channels.push(channel);
    ipcMain.handle(channel, async (...args) => {
      if (
        ![
          "text-cancel",
          "text-tool-result",
          "text-operation-capture",
          "text-operation-run",
          "text-operation-retire",
        ].includes(name)
      )
        await waitForAdmission();
      return fn(...args);
    });
  };
  const ownerKey = (sender, id) => `${sender.id}:${id}`;
  const track = (sender) => {
    if (subscribers.has(sender)) return;
    subscribers.add(sender);
    sender.once("destroyed", () => {
      subscribers.delete(sender);
      for (const [key, entry] of active)
        if (entry.sender === sender) {
          entry.controller.abort();
          active.delete(key);
        }
    });
  };
  const notification = (payload) => {
    if (/^account\//.test(payload.method))
      for (const sender of subscribers) send(sender, { type: "account", ...payload });
  };
  codex.on("notification", notification);
  // Sealed mode: every handler that can start or use the app-server refuses
  // before it could start it. Its traffic is the opaque session row.
  const assertCodexAllowed = () => egress.assertAllowed({ task: "codex", target: CODEX_HOST });
  handle("codex-status", async (event) => {
    assertCodexAllowed();
    track(event.sender);
    return codex.status();
  });
  handle("codex-login", async (event) => {
    assertCodexAllowed();
    track(event.sender);
    const login = await codex.login();
    const url = new URL(login.authUrl);
    if (
      url.protocol !== "https:" ||
      !["auth.openai.com", "auth0.openai.com", "chatgpt.com"].includes(url.hostname)
    )
      throw new Error("Codex returned an unexpected sign-in URL.");
    await openExternal(url.href);
    return { loginId: login.loginId };
  });
  // Cancel stays usable while sealed; it never needs a new connection.
  handle("codex-cancel-login", (_event, loginId) => codex.cancelLogin(loginId));
  handle("codex-logout", () => {
    assertCodexAllowed();
    return codex.logout();
  });
  handle("codex-models", () => {
    assertCodexAllowed();
    return codex.models();
  });
  handle("codex-model-catalog", () => {
    assertCodexAllowed();
    return codex.modelCatalog();
  });
  handle("codex-rate-limits", () => {
    assertCodexAllowed();
    return codex.rateLimits();
  });
  handle("credential-status", async (_event, ref) => {
    validateCredentialRef(ref);
    const enterprise = ["bedrock", "vertex"].includes(ref) ? await getEnterpriseConfig(ref) : {};
    return {
      configured:
        ref === "bedrock"
          ? !!(enterprise.bedrockProfile || enterprise.bedrockAccessKeyId)
          : ref === "vertex"
            ? !!((await getCredential(ref)) || enterprise.vertexProject)
            : !!(await getCredential(ref)),
    };
  });
  handle("credential-save", async (_event, ref, value) => {
    validateCredentialRef(ref);
    if (typeof value !== "string" || value.length > 8192) throw new Error("Invalid credential.");
    await saveCredential(ref, value.trim());
    return { configured: !!value.trim() };
  });
  const discoveryConfig = (input) => {
    if (!["custom", "lan", "openrouter"].includes(input?.provider))
      throw new Error("Model discovery is only available for custom endpoints and OpenRouter.");
    const request = validateRequest({
      provider: input.provider,
      credentialRef: input.credentialRef,
      inferenceScope: input.inferenceScope,
      requestId: "model-discovery",
      model: "discovery",
      messages: [],
      baseUrl: input.provider === "openrouter" ? undefined : input.baseUrl,
    });
    return {
      provider: request.provider,
      baseUrl:
        request.provider === "openrouter"
          ? ALIASES.openrouter
          : request.baseUrl.replace(/\/+$/, ""),
      credentialId: request.credentialRef,
      inferenceScope: request.inferenceScope,
    };
  };
  const discoveryCredential = (config) => {
    const row = credentials?.list().find((row) => row.id === config.credentialId);
    if (!row || row.unknown || credentials.isFenced?.())
      throw new Error("Credential persistence is unavailable.");
    return row;
  };
  handle("describe-models", (event, input) => {
    const config = discoveryConfig(input);
    const credential = discoveryCredential(config);
    return {
      recipientToken: recipients.issue(event.sender, config, credential),
      host: new URL(config.baseUrl).host,
      credentialId: credential.id,
      present: credential.present,
      generation: credential.generation,
    };
  });
  handle("models", async (event, input) => {
    const config = discoveryConfig(input);
    recipients.validate(input.recipientToken, event.sender, config, discoveryCredential(config));
    // Sealed mode: refuse the reviewed recipient before credentials are captured.
    return guardMetered(
      { task: "providerCheck", target: config.baseUrl, provider: config.provider },
      (ticket) => discoverModels(event, input, config, egress.meteredFetch(ticket, fetchModels))
    );
  });
  async function discoverModels(event, input, config, fetchModels) {
    const captured = await credentials.captureCommitted(config.credentialId);
    // Credential persistence can settle while this click waits. Never upgrade
    // a reviewed no-key action or send a replacement/removal under an old label.
    recipients.validate(
      input.recipientToken,
      event.sender,
      config,
      captured ? { id: config.credentialId, ...captured } : null
    );
    recipients.validate(input.recipientToken, event.sender, config, discoveryCredential(config));
    const baseUrl = config.baseUrl;
    const key = captured.values.key || "";
    const response = await fetchModels(`${baseUrl.replace(/\/$/, "")}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        `Model discovery failed (${response.status}). Check the endpoint and credential.`
      );
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 16 * 1024 * 1024) throw new Error("Model catalog is too large.");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel();
    }
    const catalog = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!Array.isArray(catalog.data))
      throw new Error("The endpoint did not return a model catalog.");
    return {
      data: catalog.data
        .filter((model) => typeof model.id === "string")
        .map((model) => ({
          id: model.id,
          name: model.name,
          owned_by: model.owned_by,
          description: model.description,
        })),
    };
  }
  handle("text-cancel", (event, requestId) => {
    active.get(ownerKey(event.sender, requestId))?.controller.abort();
  });
  handle("text-tool-result", (event, { requestId, callId, result, error }) => {
    const key = `${ownerKey(event.sender, requestId)}:${callId}`;
    const pending = pendingTools.get(key);
    if (!pending) return;
    pendingTools.delete(key);
    if (error) pending.reject(new Error(String(error)));
    else pending.resolve(result);
  });

  async function execute(event, raw, streaming, captured = null, operationExecution = null) {
    const request = validateRequest(raw);
    const sender = event.sender;
    track(sender);
    const key = ownerKey(sender, request.requestId);
    if (active.has(key)) throw new Error("Request is already running.");
    const controller = new AbortController();
    active.set(key, { controller, sender });
    const timeout = setTimeout(
      () => controller.abort(new Error("Text request timed out.")),
      Math.min(Math.max(request.timeoutMs || 180000, 1000), 600000)
    );
    const execution = operationExecution
      ? {
          ...operationExecution,
          signal: AbortSignal.any([controller.signal, operationExecution.signal]),
          assertLive() {
            operationExecution.assertLive();
            controller.signal.throwIfAborted();
          },
        }
      : null;
    const emit = (chunk) => send(sender, { type: "chunk", requestId: request.requestId, chunk });
    // The abort reason carries why the request ended (timeout vs. cancel).
    const abortFailure = () =>
      controller.signal.reason instanceof Error
        ? controller.signal.reason
        : createAbortError("Request canceled.");
    const handOff = () => {
      controller.signal.throwIfAborted();
      if (
        !request.correlationId ||
        !request.disclosureTask ||
        request.provider === "local" ||
        sender.isDestroyed()
      )
        return;
      const image = request.messages.some(
        (m) => Array.isArray(m.content) && m.content.some((p) => p?.type === "image")
      );
      for (const payload of image ? ["text", "image"] : ["text"])
        sender.send("dictation-dispatch", {
          correlationId: request.correlationId,
          task: request.disclosureTask,
          payload,
        });
    };
    const executeTool = (name, args, suppliedCallId) =>
      new Promise((resolve, reject) => {
        if (controller.signal.aborted) {
          reject(new Error("Request canceled."));
          return;
        }
        const callId = suppliedCallId || randomUUID();
        const toolKey = `${key}:${callId}`;
        const abort = () => {
          pendingTools.delete(toolKey);
          reject(new Error("Request canceled."));
        };
        controller.signal.addEventListener("abort", abort, { once: true });
        pendingTools.set(toolKey, {
          resolve: (value) => {
            controller.signal.removeEventListener("abort", abort);
            resolve(value);
          },
          reject: (error) => {
            controller.signal.removeEventListener("abort", abort);
            reject(error);
          },
        });
        send(sender, { type: "tool", requestId: request.requestId, callId, name, arguments: args });
      });
    // Sealed mode: one egress ticket per request. Sealing aborts it with the
    // SealedModeError as the reason, which this request then reports.
    const egressTask = request.disclosureTask ?? taskForScope(request.inferenceScope);
    const gated = (target, fn) =>
      egress.guard(
        {
          task: egressTask,
          target,
          model: request.model,
          provider: request.provider,
          payload: payloadOf(request.messages),
          correlationId: request.correlationId ?? null,
        },
        (ticket) => {
          ticket.signal.addEventListener("abort", () => controller.abort(ticket.signal.reason), {
            once: true,
          });
          return fn(ticket);
        }
      );
    try {
      if (request.provider === "codex")
        return await gated(CODEX_HOST, async (ticket) => {
          handOff();
          // The app-server sends from its own process: the hand-off is the
          // dispatch evidence; its traffic is the opaque session row.
          ticket.markDispatched();
          const text = await codex.generate({
            ...request,
            signal: controller.signal,
            executeTool,
            onText: (text) => {
              if (streaming) emit({ type: "content", text });
            },
          });
          if (!text.trim())
            throw new Error(
              "The selected model returned no text. Your original content is preserved."
            );
          if (streaming) emit({ type: "done", finishReason: "stop" });
          return { text };
        });
      // Credentials and enterprise configuration, read only after admission.
      const credentialInputs = async () => {
        execution?.assertLive();
        const apiKey = captured
          ? captured.apiKey
          : ["local", "bedrock"].includes(request.provider)
            ? ""
            : await getCredential(request.credentialRef);
        if (!apiKey && !["local", "lan", "custom", "bedrock", "vertex"].includes(request.provider))
          throw new Error(`Configure the ${request.provider} API key in Settings.`);
        let enterprise, material;
        if (!captured) {
          const enterpriseConfigSnapshot = isEnterpriseProvider(request.provider)
            ? await getEnterpriseConfig(request.provider)
            : undefined;
          const enterpriseEnvironmentSnapshot = isEnterpriseProvider(request.provider)
            ? captureEnterpriseEnvironment(request.provider, process.env)
            : undefined;
          enterprise = isEnterpriseProvider(request.provider)
            ? resolveEnterpriseExecutor(
                request.provider,
                enterpriseConfigSnapshot,
                enterpriseEnvironmentSnapshot
              )
            : undefined;
          if (enterprise && enterprise.status !== "ready")
            throw recipientFailure("recipientUnknown");
          if (
            request.dictationOperation &&
            enterprise &&
            enterprise.tag !== request.enterpriseRecipientTag
          )
            throw recipientFailure("recipientChanged");
          material = enterprise
            ? resolveEnterpriseCredentialMaterial(
                request.provider,
                enterpriseConfigSnapshot,
                apiKey,
                enterpriseEnvironmentSnapshot
              )
            : undefined;
          controller.signal.throwIfAborted();
        }
        return { apiKey, enterprise, material };
      };
      // Tinfoil's SDK brings its own transport: Layer B attributes its sockets,
      // and the hand-off is its dispatch evidence. Every other provider sends
      // through the metered slot-8 fetch, which reports each attempt.
      const unmetered = request.provider === "tinfoil";
      const dispatch = async (ticket, { apiKey, enterprise, material }) => {
        execution?.assertLive();
        const model = await modelFactory(
          request.provider,
          request.model,
          apiKey,
          request.baseUrl,
          request.disableThinking,
          captured ? captured.enterprise : enterprise?.executor,
          material,
          // Slot 8: the metered transport, composed over any injected fetch.
          egress.meteredFetch(ticket, fetchImpl),
          execution
        );
        execution?.assertLive();
        const { streamText, generateText, isStepCount, jsonSchema } = aiRuntime();
        let tools = request.tools?.length
          ? Object.fromEntries(
              request.tools.map((tool) => [
                tool.name,
                {
                  description: tool.description,
                  inputSchema: jsonSchema(tool.parameters),
                  execute: (args) => executeTool(tool.name, args),
                },
              ])
            )
          : undefined;
        if (request.webSearch) tools = { ...tools, ...providerSearchTools(request.provider) };
        const providerOptions = {};
        if (request.disableThinking && request.provider === "gemini") {
          providerOptions.google = {
            thinkingConfig: request.model.startsWith("gemini-3")
              ? {
                  thinkingLevel: request.model.includes("pro") ? "low" : "minimal",
                  includeThoughts: false,
                }
              : { thinkingBudget: request.model.includes("pro") ? 128 : 0, includeThoughts: false },
          };
        }
        if (request.disableThinking && request.provider === "groq")
          providerOptions.groq = {
            reasoningEffort: request.model.includes("gpt-oss") ? "low" : "none",
          };
        const options = {
          model,
          messages: request.messages,
          instructions: request.systemPrompt || undefined,
          abortSignal: execution?.signal || controller.signal,
          tools,
          stopWhen: isStepCount(tools ? 20 : 1),
          maxRetries: 0,
          providerOptions,
          onError: () => {},
        };
        // OpenAI reasoning and recent Claude models reject temperature. Gemini
        // thinking uses the output budget too: do not impose a transcript-sized cap.
        if (
          !["openai", "anthropic", "gemini", "bedrock", "azure", "vertex"].includes(
            request.provider
          )
        ) {
          options.maxOutputTokens = request.maxTokens || 4096;
          if (request.temperature !== undefined) options.temperature = request.temperature;
        }
        if (streaming) {
          handOff();
          if (unmetered) ticket.markDispatched();
          const result = streamText(options);
          const sources = [];
          let finishReason;
          for await (const part of result.stream) {
            if (part.type === "text-delta") emit({ type: "content", text: part.text });
            if (part.type === "error") throw part.error;
            // The SDK reports an aborted request as a clean "abort" part and
            // closes the stream. Surface it so a timeout is not mistaken for a
            // (possibly empty or truncated) completed answer.
            if (part.type === "abort") throw abortFailure();
            if (part.type === "source") sources.push(part);
            if (part.type === "finish") finishReason = part.finishReason;
          }
          const references = request.webSearch ? searchSourcesText(sources) : "";
          if (references) emit({ type: "content", text: references });
          emit({ type: "done", finishReason });
          return {};
        }
        handOff();
        execution?.assertLive();
        if (unmetered) ticket.markDispatched();
        const result = await generateText(options);
        execution?.assertLive();
        if (request.requireCompleteOutput && result.finishReason === "length")
          throw new Error(
            "The model truncated its response. Your original content is preserved; retry with a larger context or output budget."
          );
        if (!result.text.trim())
          throw new Error(
            "The selected model returned no text. Your original content is preserved."
          );
        return { text: result.text + (request.webSearch ? searchSourcesText(result.sources) : "") };
      };
      if (captured || !isEnterpriseProvider(request.provider))
        return await gated(
          effectiveEndpoint(request.provider, {
            baseUrl: request.baseUrl,
            enterprise: captured?.enterprise,
            env: captured ? undefined : process.env,
          }),
          async (ticket) => dispatch(ticket, await credentialInputs())
        );
      // An enterprise recipient is known only from main's own configuration.
      // Refuse while sealed before reading it; then gate the resolved executor.
      egress.assertAllowed({ task: egressTask, target: providerEndpoint(request.provider) });
      const inputs = await credentialInputs();
      return await gated(
        effectiveEndpoint(request.provider, { enterprise: inputs.enterprise?.executor }),
        (ticket) => dispatch(ticket, inputs)
      );
    } catch (error) {
      // Sealing cut this request off: report that, never a timeout or a cancel.
      if (isSealedModeError(controller.signal.reason)) throw controller.signal.reason;
      // A request that ended because it was aborted (timeout or cancel) can
      // surface as a transport error such as "Failed to process successful
      // response"; report the abort reason so a timeout is recognizable.
      if (controller.signal.aborted && error !== controller.signal.reason) throw abortFailure();
      throw error;
    } finally {
      clearTimeout(timeout);
      active.delete(key);
      for (const [toolKey, pending] of pendingTools)
        if (toolKey.startsWith(`${key}:`)) {
          pendingTools.delete(toolKey);
          pending.reject(new Error("Request ended."));
        }
    }
  }
  // Electron invoke does not preserve custom Error properties. New operation
  // channels return a safe code envelope; preload reconstructs the typed error.
  const operationHandle = (name, fn) =>
    handle(name, (...args) => {
      const refused = (error) =>
        // Sealed mode keeps its type and phase: a refusal sent nothing, an
        // interruption may have reached the provider.
        isSealedModeError(error)
          ? { ok: false, code: "SEALED_MODE", phase: sealedPhaseOf(error) }
          : {
              ok: false,
              code: [
                "RECIPIENT_CHANGED",
                "UNSUPPORTED_AUTH_SOURCE",
                "CLEANUP_OPERATION_UNAVAILABLE",
                "CLEANUP_OPERATION_BUSY",
                "CLEANUP_REQUEST_CHANGED",
              ].includes(error?.code)
                ? error.code
                : "CLEANUP_FAILED",
            };
      try {
        return Promise.resolve(fn(...args)).then((value) => ({ ok: true, value }), refused);
      } catch (error) {
        return refused(error);
      }
    });
  operationHandle("text-operation-capture", (event, descriptor) => {
    if (["codex", "tinfoil"].includes(descriptor?.provider))
      throw Object.assign(new Error("The selected authentication source cannot be retained."), {
        code: "UNSUPPORTED_AUTH_SOURCE",
      });
    if (
      descriptor?.inferenceScope !== "dictationCleanup" ||
      descriptor.tools?.length ||
      descriptor.webSearch
    )
      throw new Error("Captured operations support cleanup text only.");
    const request = validateRequest({
      ...descriptor,
      requestId: "captured-cleanup",
      messages: [],
      ...(descriptor.provider === "local" ? { baseUrl: "http://127.0.0.1:1/v1" } : {}),
    });
    if (descriptor.provider === "local") delete request.baseUrl;
    return textOperations.capture(event.sender, request, (token) =>
      onTextOperationIssued(event.sender, request, token)
    );
  });
  const { validateCapturedTextInput } = require("./capturedTextInput.mjs");
  operationHandle("text-operation-run", (event, { token, request }) =>
    textOperations.execute(
      event.sender,
      token,
      validateCapturedTextInput(request),
      (original, captured, execution, descriptor) => {
        if (descriptor.provider === "local")
          throw new Error("Use the captured local reasoning path.");
        return execute(
          event,
          { ...descriptor, ...original, requestId: randomUUID() },
          false,
          captured,
          execution
        );
      }
    )
  );
  operationHandle("text-operation-retire", (event, token) =>
    textOperations.retire(event.sender, token)
  );
  handle("text-generate", async (event, request) => {
    try {
      return await execute(event, request, false);
    } catch (error) {
      if (["recipientUnknown", "recipientChanged"].includes(error?.code))
        return { error: error.code, code: error.code };
      throw error;
    }
  });
  handle("text-stream", async (event, request) => {
    try {
      await execute(event, request, true);
      send(event.sender, { type: "end", requestId: request.requestId });
    } catch (error) {
      // An explicit cancel is the requester's own outcome, not a failure.
      if (error?.name === "AbortError") {
        send(event.sender, { type: "end", requestId: request.requestId });
        return;
      }
      send(event.sender, {
        type: "error",
        requestId: request.requestId,
        error: error?.message || String(error),
        code: error?.code,
      });
    }
  });
  return {
    retireTextOperation: (sender, token) => textOperations.retire(sender, token),
    runCapturedLocal(event, token, request, run) {
      return textOperations.execute(
        event.sender,
        token,
        validateCapturedTextInput(request),
        (original, _captured, execution, descriptor) => {
          if (descriptor.provider !== "local")
            throw new Error("The captured operation is not local.");
          return run(original, descriptor, execution);
        }
      );
    },
    isBusy: () => active.size > 0 || textOperations.isBusy(),
    eraseCodexProfile: () => codex.erase(),
    // Sealed mode: resolves only after the app-server has exited (a pending
    // start is cancelled first); rejects CODEX_STOP_FAILED if it will not.
    stopCodex: () => codex.stopAndWait(),
    // True while a start is pending or a spawned app-server has not exited.
    // Unresolved descendant coverage is reported by the child registry.
    codexRunning: () => codex.alive(),
    dispose() {
      for (const { controller } of active.values()) controller.abort();
      for (const channel of channels) ipcMain.removeHandler(channel);
      recipients.dispose();
      textOperations.dispose();
      onTextOperationsDisposed();
      codex.off("notification", notification);
      codex.stop();
    },
  };
}
module.exports = {
  registerPersonalInferenceIPC,
  gatedVerifyRelease,
  createCodexServer,
  codexSession,
  validateRequest,
  validateCredentialRef,
  APP_TOOLS,
  createModel,
};
