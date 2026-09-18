import {
  resolveAgentImageTarget,
  resolveDictationAgentDisplayProvider,
  resolveDictationAgentProvider,
  resolveDictationAgentReachability,
  resolveModeProvider,
  resolveModeReachability,
} from "./dictationRouting.js";
import { getCloudModel, isProviderValidForMode } from "../models/ModelRegistry";
import { selectResolvedLLMConfig } from "../stores/settingsStore";
import { inheritsFallbackEndpoint } from "./reasoningRouting.js";

// The dictation agent's inference scope, shared by the dictation route in
// audioManager and the Prompt Studio test tab so a prompt test hits the same
// provider, endpoint and credentials a real dictation does.
//
// Callers must add `systemPrompt` to the config: ReasoningService treats a
// missing one as its cleanup path, which echoes the input back instead of
// running the instruction.
export function resolveDictationAgentInference(settings) {
  const model = settings.dictationAgentModel?.trim() || "";
  const isSelfHosted =
    settings.dictationAgentMode === "self-hosted" && !!settings.dictationAgentRemoteUrl?.trim();
  const storedProvider = settings.dictationAgentProvider?.trim() || "";
  const providerForMode = isProviderValidForMode(storedProvider, settings.dictationAgentMode)
    ? storedProvider
    : undefined;
  const provider = resolveDictationAgentProvider({
    dictationAgentMode: settings.dictationAgentMode,
    dictationAgentProvider: providerForMode,
  });
  const isCustom = settings.dictationAgentMode === "providers" && provider === "custom";

  return {
    reachable: resolveDictationAgentReachability({
      useDictationAgent: settings.useDictationAgent,
      dictationAgentMode: settings.dictationAgentMode,
      dictationAgentProvider: provider,
      dictationAgentModel: model,
      isSelfHostedAgent: isSelfHosted,
    }),
    model,
    displayProvider: resolveDictationAgentDisplayProvider({
      dictationAgentMode: settings.dictationAgentMode,
      dictationAgentProvider: providerForMode,
    }),
    config: {
      inferenceScope: /** @type {const} */ ("dictationAgent"),
      provider,
      lanUrl: isSelfHosted ? settings.dictationAgentRemoteUrl : undefined,
      baseUrl: isCustom ? settings.dictationAgentCloudBaseUrl || undefined : undefined,
      credentialRef: isCustom || isSelfHosted ? "custom:dictationAgent" : undefined,
      disableThinking: settings.dictationAgentDisableThinking,
    },
  };
}

// The optional vision override: the scope a voice-agent request uses when it
// carries a screen-context screenshot. Resolved through the store selector so
// unset fields inherit the agent's own config, and treated as "active" only
// once the user has actually chosen a target — an inherited config is the
// agent scope, which the base routing rules already cover.
export function resolveDictationAgentVisionInference(settings) {
  const resolved = selectResolvedLLMConfig(settings, "dictationAgentVision");
  const mode = resolved.mode;
  const model = resolved.model?.trim() || "";
  const storedProvider = resolved.provider?.trim() || "";
  const providerForMode = isProviderValidForMode(storedProvider, mode) ? storedProvider : undefined;
  const provider = resolveModeProvider({ mode, provider: providerForMode });
  const isCustom = mode === "providers" && provider === "custom";

  const chosen = !!settings.dictationAgentVisionModel?.trim();

  // The endpoint falls back to the agent scope, so the key that opens it must
  // too — an inherited endpoint with only the vision key (or none) would call
  // the agent's host with the wrong credential.
  const agent = selectResolvedLLMConfig(settings, "dictationAgent");
  const borrowsAgentEndpoint = inheritsFallbackEndpoint(
    { mode, cloudBaseUrl: settings.dictationAgentVisionCloudBaseUrl },
    agent.mode
  );

  return {
    active:
      !!settings.useDictationAgentVisionModel &&
      chosen &&
      resolveModeReachability({ mode, provider, model, isSelfHosted: false }),
    mode,
    model,
    config: {
      inferenceScope: /** @type {import("../config/inferenceScopes").InferenceScope} */ (
        borrowsAgentEndpoint ? "dictationAgent" : "dictationAgentVision"
      ),
      provider,
      baseUrl: isCustom ? resolved.cloudBaseUrl || undefined : undefined,
      credentialRef: isCustom
        ? `custom:${borrowsAgentEndpoint ? "dictationAgent" : "dictationAgentVision"}`
        : undefined,
      disableThinking: resolved.disableThinking,
    },
  };
}

/**
 * What a chat conversation streams on, and whether its screenshot rides along.
 *
 * Typed chat surfaces resolve Chat; spoken commands resolve Voice Assistant.
 * Missing configuration stays on its selected scope and surfaces an error.
 *
 * Screenshots follow the dictation route's rules (resolveAgentImageTarget): a
 * configured vision override is trusted to see images and swapped in; an
 * override that cannot drops the screenshot rather than redirecting it to a
 * model the user did not choose; the base scope attaches only where its
 * provider is image-wired and the registry says its model has vision.
 *
 * `isProviderImageWired` is injected: the provider registry reads Vite env at
 * load, which this helper's callers and tests do not all have.
 *
 * @param {import("../stores/settingsStore").SettingsState} settings
 * @param {{
 *   inferenceScope?: "chatIntelligence" | "dictationAgent",
 *   hasScreenContext?: boolean,
 *   isProviderImageWired?: (providerId: string | undefined) => boolean,
 * }} [options]
 * @returns {{
 *   config: import("../stores/settingsStore").ResolvedLLMConfig,
 *   attachScreenContext: boolean,
 * }}
 */
export function resolveChatStreamingInference(
  settings,
  {
    inferenceScope = "chatIntelligence",
    hasScreenContext = false,
    isProviderImageWired = () => false,
  } = {}
) {
  const onAgentScope = inferenceScope === "dictationAgent";
  const config = selectResolvedLLMConfig(
    settings,
    onAgentScope ? "dictationAgent" : "chatIntelligence"
  );
  const vision =
    onAgentScope && hasScreenContext ? resolveDictationAgentVisionInference(settings) : null;

  const { attach, useVisionOverride } = resolveAgentImageTarget({
    hasScreenContext,
    visionOverrideActive: !!vision?.active,
    visionProviderImageWired: isProviderImageWired(vision?.config.provider),
    baseProviderImageWired: isProviderImageWired(
      resolveModeProvider({ mode: config.mode, provider: config.provider })
    ),
    baseModelSupportsVision: !!getCloudModel(config.model, config.provider)?.supportsVision,
  });
  if (!useVisionOverride) return { config, attachScreenContext: attach };
  return {
    config: {
      scope: "dictationAgentVision",
      mode: vision.mode,
      provider: vision.config.provider,
      model: vision.model,
      cloudBaseUrl: vision.config.baseUrl,

      disableThinking: vision.config.disableThinking,
    },
    attachScreenContext: true,
  };
}
