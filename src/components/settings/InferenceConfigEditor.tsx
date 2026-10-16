import type { ProviderSearchScope, SettingsPatch } from "../../lib/providerSwitchPlans";
import { useRouteDraftStore } from "../../stores/routeDraftStore";
import { StagedRoutePanel } from "./routing/StagedRoutePanel";
import { stagedTargetForMode } from "./routing/stagedTarget";
import { useRouteChange, useRouteCommit } from "./routing/useRouteChange";
import { saveSecret } from "../../stores/settingsStore";
import { SCOPE_ROUTE } from "../../lib/routeGraph";
import { useResolvedRoute } from "../../lib/routes";
import { isSecretStoreKey, unavailableSecretSave } from "../../lib/credentialSlots";
import type { AcknowledgedSecretSave } from "../ui/ApiKeyInput";
import {
  PROVIDER_SEARCH_CHANGED_EVENT,
  readProviderSearchPreference,
  supportsProviderSearch,
} from "../../utils/providerSearch";
import { SettingsRow } from "../ui/SettingsSection";
import { useCallback, useSyncExternalStore } from "react";
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
import { getCloudModel, getLocalModel } from "../../models/ModelRegistry";
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
  const route = useResolvedRoute(SCOPE_ROUTE[scope]);

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

  const routeId = SCOPE_ROUTE[scope];
  const { request, requestPatch } = useRouteChange();
  const stagedMode = useRouteDraftStore((s) =>
    s.draft?.routeId === routeId && s.draft.kind === "target" ? s.draft.target.mode : null
  );
  // The planner clears a provider that is invalid for the new mode
  // (isProviderValidForMode) and stages anything that leaves the device.
  const handleModeSelect = useCallback(
    async (mode: InferenceMode) => {
      if (!isModeAllowed(mode)) return;
      if (mode === effectiveMode) {
        void requestPatch(routeId, {});
        return;
      }
      // Task 7's commit frees llama-server when a scope moves to a server.
      const outcome = await request(
        routeId,
        stagedTargetForMode(mode, routeId, useSettingsStore.getState())
      );
      if (
        outcome === "staged" ||
        outcome === "superseded" ||
        outcome === "save-failed" ||
        !outcome.applied
      )
        return;
      onModeChange?.(mode);
    },
    [routeId, request, requestPatch, effectiveMode, onModeChange, isModeAllowed]
  );

  const commit = useRouteCommit(routeId);
  const routePatch = (patch: SettingsPatch) => void requestPatch(routeId, patch);

  // The scope's custom-endpoint key saves through main and is acknowledged
  // (I3, R2-3); setField would route it through the fire-and-forget setter.
  const customKeyField = INFERENCE_SCOPES[scope].storeKeys.customApiKey;
  const saveCustomKey: AcknowledgedSecretSave = (value) =>
    customKeyField && isSecretStoreKey(customKeyField)
      ? saveSecret(customKeyField, value)
      : unavailableSecretSave(value);

  const renderModelSelector = (mode?: "cloud" | "local") => (
    <ReasoningModelSelector
      requireImages={scope === "dictationAgentVision"}
      credentialRef={`custom:${scope}`}
      reasoningModel={config.model}
      localReasoningProvider={config.provider}
      cloudReasoningBaseUrl={config.cloudBaseUrl ?? ""}
      customReasoningApiKey={config.customApiKey ?? ""}
      saveCustomReasoningApiKey={saveCustomKey}
      onCommit={commit}
      onRoutePatch={routePatch}
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
          label={t("routes.runsOn", { task: t(`routes.names.${route.id}`) })}
          modes={modes}
          activeMode={effectiveMode}
          stagedMode={stagedMode}
          onSelect={handleModeSelect}
          routeState={route.state}
        />
      )}

      <StagedRoutePanel routeId={routeId} />

      {effectiveMode === "providers" && renderModelSelector("cloud")}
      {effectiveMode === "local" && renderModelSelector("local")}

      {effectiveMode === "self-hosted" && (
        <OpenAICompatiblePanel
          credentialRef={`custom:${scope}`}
          baseUrl={config.remoteUrl ?? ""}
          onUseEndpoint={(url) =>
            void commit({ mode: "self-hosted", remoteUrl: url, model: config.model })
          }
          apiKey={config.customApiKey ?? ""}
          saveApiKey={saveCustomKey}
          model={config.model}
          onSelectModel={(model) =>
            void commit({ mode: "self-hosted", remoteUrl: config.remoteUrl ?? "", model })
          }
          baseUrlPlaceholder="http://localhost:11434/v1"
          helpExamples={
            <p className="text-xs text-muted-foreground">
              {t("reasoning.selfHosted.endpointHelp")}
            </p>
          }
        />
      )}

      {supportsProviderSearch(scope, config.provider, config.mode) && (
        <ProviderSearchPreference key={scope} scope={scope as ProviderSearchScope} />
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

// The preference lives in localStorage (personalWebSearch:<scope>). Task 6's
// writer announces every change; "storage" covers other windows.
function subscribeProviderSearch(onChange: () => void): () => void {
  window.addEventListener(PROVIDER_SEARCH_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PROVIDER_SEARCH_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// Web search adds the webSearch payload part (Appendix B), so turning it on
// for a provider is a new payload: the planner stages it. Off is instant.
function ProviderSearchPreference({ scope }: { scope: ProviderSearchScope }) {
  const { t } = useTranslation();
  const enabled = useSyncExternalStore(
    subscribeProviderSearch,
    () => readProviderSearchPreference(scope),
    () => false
  );
  const { requestPatch } = useRouteChange();
  return (
    <SettingsRow
      label={t("personal.providerSearch")}
      description={t("personal.providerSearchDescription")}
    >
      <Toggle
        checked={enabled}
        onChange={(next) =>
          void requestPatch(SCOPE_ROUTE[scope], {
            [`providerSearch:${scope}`]: next,
          } as SettingsPatch)
        }
      />
    </SettingsRow>
  );
}
