import { useRouteDraftStore } from "../../stores/routeDraftStore";
import { StagedRoutePanel } from "./routing/StagedRoutePanel";
import { stagedTargetForMode } from "./routing/stagedTarget";
import { useRouteChange } from "./routing/useRouteChange";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useInferenceModeOptions } from "../../hooks/useInferenceOptions";
import { useStartOnboarding } from "../../hooks/useStartOnboarding";
import { getMeetingStreamingTranscriptionProviders } from "../../models/ModelRegistry";
import { useSettingsStore } from "../../stores/settingsStore";
import { useResolvedRoute } from "../../lib/routes";
import type { InferenceMode } from "../../types/electron";
import { Cpu, Key, Network } from "../icons";
import TranscriptionModelPicker from "../TranscriptionModelPicker";
import { InferenceModeSelector, SettingsRow } from "../ui/SettingsSection";
import { Toggle } from "../ui/toggle";

const MEETING_BYOK_PROVIDER_IDS = getMeetingStreamingTranscriptionProviders().map(
  (provider) => provider.id
);

function MeetingSpeakerDetectionRow() {
  const { t } = useTranslation();
  const speakerDiarizationEnabled = useSettingsStore((s) => s.speakerDiarizationEnabled);
  const setSpeakerDiarizationEnabled = useSettingsStore((s) => s.setSpeakerDiarizationEnabled);

  return (
    <SettingsRow
      label={t("settings.meeting.speakerDetection.title")}
      description={t("settings.meeting.speakerDetection.description")}
    >
      <Toggle checked={speakerDiarizationEnabled} onChange={setSpeakerDiarizationEnabled} />
    </SettingsRow>
  );
}

const noop = () => {};

export function MeetingTranscriptionPanel() {
  const { t } = useTranslation();
  const route = useResolvedRoute("noteRecordingStt");
  const startOnboarding = useStartOnboarding();

  const {
    meetingTranscriptionMode,
    meetingWhisperModel,
    setMeetingWhisperModel,
    meetingLocalTranscriptionProvider,
    setMeetingLocalTranscriptionProvider,
    meetingParakeetModel,
    setMeetingParakeetModel,
    meetingCohereModel,
    setMeetingCohereModel,
    meetingCloudTranscriptionProvider,
    setMeetingCloudTranscriptionProvider,
    meetingCloudTranscriptionModel,
    setMeetingCloudTranscriptionModel,
    meetingCloudTranscriptionBaseUrl,
    setMeetingCloudTranscriptionBaseUrl,
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
        disabled: true,
        badge: t("common.comingSoon"),
      },
    ],
    meetingTranscriptionMode
  );
  const { request, requestPatch } = useRouteChange();
  const stagedMode = useRouteDraftStore((s) =>
    s.draft?.routeId === "noteRecordingStt" && s.draft.kind === "target"
      ? s.draft.target.mode
      : null
  );
  const handleTranscriptionModeSelect = (mode: InferenceMode) => {
    if (!isModeAllowed(mode)) return;
    if (mode === "self-hosted") return;
    if (mode === effectiveTranscriptionMode) {
      void requestPatch("noteRecordingStt", {});
      return;
    }
    void request(
      "noteRecordingStt",
      stagedTargetForMode(mode, "noteRecordingStt", useSettingsStore.getState())
    );
  };

  const handleLocalTranscriptionModelSelect = useCallback(
    (modelId: string, providerId?: string) => {
      const provider = providerId ?? meetingLocalTranscriptionProvider;
      if (provider === "nvidia") {
        setMeetingParakeetModel(modelId);
      } else if (provider === "cohere") {
        setMeetingCohereModel(modelId);
      } else {
        setMeetingWhisperModel(modelId);
      }
    },
    [
      meetingLocalTranscriptionProvider,
      setMeetingParakeetModel,
      setMeetingCohereModel,
      setMeetingWhisperModel,
    ]
  );

  const renderTranscriptionPicker = (mode: "cloud" | "local") => (
    <TranscriptionModelPicker
      streamingOnly
      transcriptionContext="meeting"
      selectedCloudProvider={meetingCloudTranscriptionProvider}
      onCloudProviderSelect={setMeetingCloudTranscriptionProvider}
      selectedCloudModel={meetingCloudTranscriptionModel}
      onCloudModelSelect={setMeetingCloudTranscriptionModel}
      selectedLocalModel={
        meetingLocalTranscriptionProvider === "nvidia"
          ? meetingParakeetModel
          : meetingLocalTranscriptionProvider === "cohere"
            ? meetingCohereModel
            : meetingWhisperModel
      }
      onLocalModelSelect={handleLocalTranscriptionModelSelect}
      selectedLocalProvider={meetingLocalTranscriptionProvider}
      onLocalProviderSelect={setMeetingLocalTranscriptionProvider}
      useLocalWhisper={mode === "local"}
      onModeChange={noop}
      mode={mode}
      cloudTranscriptionBaseUrl={meetingCloudTranscriptionBaseUrl}
      setCloudTranscriptionBaseUrl={setMeetingCloudTranscriptionBaseUrl}
      variant="settings"
    />
  );

  return (
    <div className="space-y-3">
      <InferenceModeSelector
        label={t("routes.runsOn", { task: t("routes.names.noteRecordingStt") })}
        modes={transcriptionModes}
        activeMode={effectiveTranscriptionMode}
        stagedMode={stagedMode}
        onSelect={handleTranscriptionModeSelect}
        routeState={route.state}
      />
      <StagedRoutePanel routeId="noteRecordingStt" />

      {effectiveTranscriptionMode === "providers" && renderTranscriptionPicker("cloud")}
      {effectiveTranscriptionMode === "local" && renderTranscriptionPicker("local")}
      <MeetingSpeakerDetectionRow />
    </div>
  );
}
