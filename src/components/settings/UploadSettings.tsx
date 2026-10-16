import { useRouteDraftStore } from "../../stores/routeDraftStore";
import { StagedRoutePanel } from "./routing/StagedRoutePanel";
import { stagedTargetForMode } from "./routing/stagedTarget";
import { useRouteChange, useRouteCommit } from "./routing/useRouteChange";
import { useTranslation } from "react-i18next";
import { useInferenceModeOptions } from "../../hooks/useInferenceOptions";
import { useStartOnboarding } from "../../hooks/useStartOnboarding";
import { useSettingsStore } from "../../stores/settingsStore";
import { useResolvedRoute } from "../../lib/routes";
import type { InferenceMode } from "../../types/electron";
import { Cpu, Key, Network } from "../icons";
import SelfHostedPanel from "../SelfHostedPanel";
import TranscriptionModelPicker from "../TranscriptionModelPicker";
import { InferenceModeSelector } from "../ui/SettingsSection";

export function UploadTranscriptionPanel() {
  const { t } = useTranslation();
  const route = useResolvedRoute("uploadStt");
  const startOnboarding = useStartOnboarding();

  const {
    uploadTranscriptionMode,
    uploadWhisperModel,
    uploadLocalTranscriptionProvider,
    uploadParakeetModel,
    uploadCohereModel,
    uploadCloudTranscriptionProvider,
    uploadCloudTranscriptionModel,
    uploadCloudTranscriptionBaseUrl,
    remoteTranscriptionUrl,
    remoteTranscriptionModel,
  } = useSettingsStore();
  const {
    modes: transcriptionModes,
    effectiveMode: effectiveTranscriptionMode,
    isModeAllowed,
  } = useInferenceModeOptions(
    [
      {
        id: "providers",
        label: t("settingsPage.transcription.modes.providers"),
        description: t("settingsPage.transcription.modes.providersDesc"),
        icon: <Key className="w-4 h-4" />,
      },
      {
        id: "local",
        label: t("settingsPage.transcription.modes.local"),
        description: t("settingsPage.transcription.modes.localDesc"),
        icon: <Cpu className="w-4 h-4" />,
      },
      {
        id: "self-hosted",
        label: t("settingsPage.transcription.modes.selfHosted"),
        description: t("settingsPage.transcription.modes.selfHostedDesc"),
        icon: <Network className="w-4 h-4" />,
      },
      ...[],
    ],
    uploadTranscriptionMode
  );
  const { request, requestPatch } = useRouteChange();
  const stagedMode = useRouteDraftStore((s) =>
    s.draft?.routeId === "uploadStt" && s.draft.kind === "target" ? s.draft.target.mode : null
  );
  const handleTranscriptionModeSelect = (mode: InferenceMode) => {
    if (!isModeAllowed(mode)) return;
    if (mode === effectiveTranscriptionMode) {
      void requestPatch("uploadStt", {});
      return;
    }
    // Self-hosted upload reads dictation's server; the planner never writes it from here.
    void request("uploadStt", stagedTargetForMode(mode, "uploadStt", useSettingsStore.getState()));
  };

  const commituploadStt = useRouteCommit("uploadStt");

  const renderTranscriptionPicker = (mode: "cloud" | "local") => (
    <TranscriptionModelPicker
      onCommit={commituploadStt}
      transcriptionContext="upload"
      selectedCloudProvider={uploadCloudTranscriptionProvider}
      selectedCloudModel={uploadCloudTranscriptionModel}
      selectedLocalModel={
        uploadLocalTranscriptionProvider === "nvidia"
          ? uploadParakeetModel
          : uploadLocalTranscriptionProvider === "cohere"
            ? uploadCohereModel
            : uploadWhisperModel
      }
      selectedLocalProvider={uploadLocalTranscriptionProvider}
      useLocalWhisper={mode === "local"}
      mode={mode}
      cloudTranscriptionBaseUrl={uploadCloudTranscriptionBaseUrl}
      variant="settings"
    />
  );

  return (
    <div className="space-y-3">
      <InferenceModeSelector
        label={t("routes.runsOn", { task: t("routes.names.uploadStt") })}
        modes={transcriptionModes}
        activeMode={effectiveTranscriptionMode}
        stagedMode={stagedMode}
        onSelect={handleTranscriptionModeSelect}
        routeState={route.state}
      />
      <StagedRoutePanel routeId="uploadStt" />

      {effectiveTranscriptionMode === "providers" && renderTranscriptionPicker("cloud")}
      {effectiveTranscriptionMode === "local" && renderTranscriptionPicker("local")}
      {effectiveTranscriptionMode === "self-hosted" && (
        <SelfHostedPanel
          service="transcription"
          url={remoteTranscriptionUrl}
          model={remoteTranscriptionModel}
        />
      )}
    </div>
  );
}
