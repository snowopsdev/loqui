const { randomUUID } = require("node:crypto");
const { CodexAppServer } = require("./codexAppServer");
const { isSecureHttpEndpoint } = require("../utils/urlUtils.ts");

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

async function createModel(provider, model, apiKey, baseURL, disableThinking, enterprise) {
  if (["bedrock", "azure", "vertex"].includes(provider))
    return require("./enterpriseAiProviders").getEnterpriseAIModel(
      provider,
      model,
      apiKey,
      enterprise
    );
  const { createOpenAI } = require("@ai-sdk/openai");
  if (provider === "openai") return createOpenAI({ apiKey })(model);
  if (provider === "anthropic")
    return require("@ai-sdk/anthropic").createAnthropic({ apiKey })(model);
  if (provider === "gemini")
    return require("@ai-sdk/google").createGoogleGenerativeAI({ apiKey })(model);
  if (provider === "groq") return require("@ai-sdk/groq").createGroq({ apiKey })(model);
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
          return fetch(url, init);
        }
      : undefined;
  return createOpenAI({
    apiKey: apiKey || "no-key",
    baseURL: ALIASES[provider] || baseURL,
    headers: require("./openCodeSession").openCodeSessionHeaders(ALIASES[provider] || baseURL),
    ...(customFetch ? { fetch: customFetch } : {}),
  }).chat(model);
}

function registerPersonalInferenceIPC({
  ipcMain,
  userDataPath,
  getCredential,
  saveCredential,
  openExternal,
  codex = new CodexAppServer({ userDataPath }),
  modelFactory = createModel,
  getEnterpriseConfig = () => ({}),
}) {
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
    ipcMain.handle(channel, fn);
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
  handle("codex-status", async (event) => {
    track(event.sender);
    return codex.status();
  });
  handle("codex-login", async (event) => {
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
  handle("codex-cancel-login", (_event, loginId) => codex.cancelLogin(loginId));
  handle("codex-logout", () => codex.logout());
  handle("codex-models", () => codex.models());
  handle("codex-rate-limits", () => codex.rateLimits());
  handle("credential-status", async (_event, ref) => {
    validateCredentialRef(ref);
    const enterprise = ["bedrock", "vertex"].includes(ref) ? await getEnterpriseConfig() : {};
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
  handle("models", async (_event, input) => {
    if (!["custom", "lan", "openrouter"].includes(input?.provider))
      throw new Error("Model discovery is only available for custom endpoints and OpenRouter.");
    const request = validateRequest({
      ...input,
      requestId: "model-discovery",
      model: "discovery",
      messages: [],
      baseUrl: input.provider === "openrouter" ? undefined : input.baseUrl,
    });
    const baseUrl = request.provider === "openrouter" ? ALIASES.openrouter : request.baseUrl;
    const key = await getCredential(request.credentialRef);
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
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
  });
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

  async function execute(event, raw, streaming) {
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
    const emit = (chunk) => send(sender, { type: "chunk", requestId: request.requestId, chunk });
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
    try {
      if (request.provider === "codex") {
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
      }
      const apiKey = ["local", "bedrock"].includes(request.provider)
        ? ""
        : await getCredential(request.credentialRef);
      if (!apiKey && !["local", "lan", "custom", "bedrock", "vertex"].includes(request.provider))
        throw new Error(`Configure the ${request.provider} API key in Settings.`);
      const model = await modelFactory(
        request.provider,
        request.model,
        apiKey,
        request.baseUrl,
        request.disableThinking,
        ["bedrock", "azure", "vertex"].includes(request.provider)
          ? await getEnterpriseConfig()
          : undefined
      );
      const { streamText, generateText, stepCountIs, jsonSchema } = require("ai");
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
        system: request.systemPrompt || undefined,
        abortSignal: controller.signal,
        tools,
        stopWhen: stepCountIs(tools ? 20 : 1),
        maxRetries: 0,
        providerOptions,
        onError: () => {},
      };
      // OpenAI reasoning and recent Claude models reject temperature. Gemini
      // thinking uses the output budget too: do not impose a transcript-sized cap.
      if (
        !["openai", "anthropic", "gemini", "bedrock", "azure", "vertex"].includes(request.provider)
      ) {
        options.maxOutputTokens = request.maxTokens || 4096;
        if (request.temperature !== undefined) options.temperature = request.temperature;
      }
      if (streaming) {
        const result = streamText(options);
        const sources = [];
        let finishReason;
        for await (const part of result.fullStream) {
          if (part.type === "text-delta") emit({ type: "content", text: part.text });
          if (part.type === "error") throw part.error;
          if (part.type === "source") sources.push(part);
          if (part.type === "finish") finishReason = part.finishReason;
        }
        const references = request.webSearch ? searchSourcesText(sources) : "";
        if (references) emit({ type: "content", text: references });
        emit({ type: "done", finishReason });
        return {};
      }
      const result = await generateText(options);
      if (request.requireCompleteOutput && result.finishReason === "length")
        throw new Error(
          "The model truncated its response. Your original content is preserved; retry with a larger context or output budget."
        );
      if (!result.text.trim())
        throw new Error("The selected model returned no text. Your original content is preserved.");
      return { text: result.text + (request.webSearch ? searchSourcesText(result.sources) : "") };
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
  handle("text-generate", (event, request) => execute(event, request, false));
  handle("text-stream", async (event, request) => {
    try {
      await execute(event, request, true);
      send(event.sender, { type: "end", requestId: request.requestId });
    } catch (error) {
      send(event.sender, {
        type: "error",
        requestId: request.requestId,
        error: error?.message || String(error),
        code: error?.code,
      });
    }
  });
  return {
    isBusy: () => active.size > 0,
    dispose() {
      for (const { controller } of active.values()) controller.abort();
      for (const channel of channels) ipcMain.removeHandler(channel);
      codex.off("notification", notification);
      codex.stop();
    },
  };
}
module.exports = {
  registerPersonalInferenceIPC,
  validateRequest,
  validateCredentialRef,
  APP_TOOLS,
  createModel,
  providerSearchTools,
  searchSourcesText,
};
