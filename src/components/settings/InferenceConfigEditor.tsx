import { useLocalStorage } from "../../hooks/useLocalStorage";
import { supportsProviderSearch } from "../../utils/providerSearch";
import { SettingsRow } from "../ui/SettingsSection";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useInferenceModeOptions } from "../../hooks/useInferenceOptions";
import {
  selectResolvedLLMConfig,
  setResolvedLLMConfig,
  useSettingsStore,
  type ResolvedLLMConfig,
} from "../../stores/settingsStore";
import { Cpu, Key, Network } from "../icons";
import ReasoningModelSelector from "../ReasoningModelSelector";
import type { InferenceModeOption } from "../ui/SettingsSection";
import { InferenceModeSelector } from "../ui/SettingsSection";

import {
  INFERENCE_SCOPES,
  type InferenceScope,
  type InferenceScopeDefinition,
} from "../../config/inferenceScopes";
import { getCloudModel, getLocalModel, isProviderValidForMode } from "../../models/ModelRegistry";
import type { InferenceMode } from "../../types/electron";
import OpenAICompatiblePanel from "../OpenAICompatiblePanel";
import { Toggle } from "../ui/toggle";

const MODE_LABEL_PREFIX: Record<InferenceScope, string> = {
  dictationCleanup: "settingsPage.aiModels.modes",
  noteFormatting: "settingsPage.aiModels.modes",
  dictationAgent: "dictationAgent.modes",
  dictationAgentVision: "dictationAgent.modes",
  chatIntelligence: "agentMode.settings.modes",
  dictationTranslation: "settingsPage.aiModels.modes",
};

interface InferenceConfigEditorProps {
  scope: InferenceScope;
  onModeChange?: (mode: InferenceMode) => void;
  /** Restrict the selectable modes (e.g. vision override offers cloud/BYOK only). */
  allowedModes?: InferenceMode[];
}

export default function InferenceConfigEditor({
  scope,
  onModeChange,
  allowedModes,
}: InferenceConfigEditorProps) {
  const { t } = useTranslation();

  const config = useSettingsStore(
    useShallow((settings): ResolvedLLMConfig => {
      const effective = settings;
      const resolved = selectResolvedLLMConfig(effective, scope);
      const definition: InferenceScopeDefinition = INFERENCE_SCOPES[scope];
      // Inherited runtime defaults are not an explicit selection in an optional picker.
      return definition.optional
        ? { ...resolved, model: effective[definition.storeKeys.model] as string }
        : resolved;
    })
  );

  const prefix = MODE_LABEL_PREFIX[scope];
  const { modes, effectiveMode, isModeAllowed } = useInferenceModeOptions(
    (
      [
        {
          id: "providers",
          label: t(`${prefix}.providers`),
          description: t(`${prefix}.providersDesc`),
          icon: <Key className="w-4 h-4" />,
        },
        {
          id: "local",
          label: t(`${prefix}.local`),
          description: t(`${prefix}.localDesc`),
          icon: <Cpu className="w-4 h-4" />,
        },
        {
          id: "self-hosted",
          label: t(`${prefix}.selfHosted`),
          description: t(`${prefix}.selfHostedDesc`),
          icon: <Network className="w-4 h-4" />,
        },
      ] as InferenceModeOption[]
    ).filter((mode) => !allowedModes || allowedModes.includes(mode.id)),
    config.mode
  );

  const setField = useCallback(
    <K extends keyof Omit<typeof config, "scope">>(field: K) =>
      (value: NonNullable<(typeof config)[K]>) => {
        setResolvedLLMConfig(scope, { [field]: value });
      },
    [scope]
  );

  const handleModeSelect = useCallback(
    (mode: InferenceMode) => {
      if (!isModeAllowed(mode)) return;

      if (mode === effectiveMode) return;

      const patch: Parameters<typeof setResolvedLLMConfig>[1] = {
        mode,
        cloudMode: "byok",
      };
      if (!isProviderValidForMode(config.provider, mode)) {
        patch.provider = "";
        patch.model = "";
      }
      setResolvedLLMConfig(scope, patch);

      if (mode === "self-hosted") {
        window.electronAPI?.llamaServerStop?.();
      }

      onModeChange?.(mode);
    },
    [scope, config.provider, effectiveMode, onModeChange, isModeAllowed]
  );

  const setMode = setField("mode");
  const setProvider = setField("provider");
  const setModel = setField("model");

  const renderModelSelector = (mode?: "cloud" | "local") => (
    <ReasoningModelSelector
      requireImages={scope === "dictationAgentVision"}
      credentialRef={`custom:${scope}`}
      reasoningModel={config.model}
      setReasoningModel={setModel}
      localReasoningProvider={config.provider}
      setLocalReasoningProvider={setProvider}
      cloudReasoningBaseUrl={config.cloudBaseUrl ?? ""}
      setCloudReasoningBaseUrl={setField("cloudBaseUrl")}
      customReasoningApiKey={config.customApiKey ?? ""}
      setCustomReasoningApiKey={setField("customApiKey")}
      setReasoningMode={setMode}
      mode={mode}
    />
  );

  const showThinkingToggle =
    effectiveMode === "self-hosted" ||
    (effectiveMode === "providers" &&
      (config.provider === "custom" ||
        config.provider === "openrouter" ||
        !!getCloudModel(config.model)?.supportsThinking)) ||
    (effectiveMode === "local" && !!getLocalModel(config.model)?.supportsThinking);

  return (
    <div className="space-y-3">
      {modes.length > 1 && (
        <InferenceModeSelector
          modes={modes}
          activeMode={effectiveMode}
          onSelect={handleModeSelect}
        />
      )}

      {effectiveMode === "providers" && renderModelSelector("cloud")}
      {effectiveMode === "local" && renderModelSelector("local")}

      {effectiveMode === "self-hosted" && (
        <OpenAICompatiblePanel
          credentialRef={`custom:${scope}`}
          baseUrl={config.remoteUrl ?? ""}
          setBaseUrl={setField("remoteUrl")}
          apiKey={config.customApiKey ?? ""}
          setApiKey={setField("customApiKey")}
          model={config.model}
          setModel={setModel}
          baseUrlPlaceholder="http://192.168.1.126:11434/v1"
          helpExamples={
            <p className="text-xs text-muted-foreground">
              {t("reasoning.selfHosted.endpointHelp")}
            </p>
          }
        />
      )}

      {supportsProviderSearch(scope, config.provider, config.mode) && (
        <ProviderSearchPreference key={scope} scope={scope} />
      )}

      {showThinkingToggle && (
        <div className="flex items-start justify-between gap-3 pt-1">
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium text-foreground">
              {t("reasoning.disableThinking.label")}
            </h4>
            <p className="text-xs text-muted-foreground">{t("reasoning.disableThinking.help")}</p>
          </div>
          <Toggle checked={config.disableThinking} onChange={setField("disableThinking")} />
        </div>
      )}
    </div>
  );
}

function ProviderSearchPreference({ scope }: { scope: string }) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useLocalStorage(`personalWebSearch:${scope}`, false);
  return (
    <SettingsRow
      label={t("personal.providerSearch")}
      description={t("personal.providerSearchDescription")}
    >
      <Toggle checked={enabled} onChange={setEnabled} />
    </SettingsRow>
  );
}
