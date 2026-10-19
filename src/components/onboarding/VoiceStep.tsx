import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "../icons";
import type { SystemProfile } from "../../types/electron";
import {
  modelDownloadBytes,
  outcomeFor,
  voiceSupportsAll,
  type VoicePick,
} from "../../utils/onboardingDetection";
import { byteParts, type VoiceDownloadState } from "../../utils/onboardingDownload";
import {
  ONBOARDING_SPEECH_MODELS,
  supportsSpeechLanguage,
} from "../../utils/onboardingSpeechModels";
import LanguageSelector from "../ui/LanguageSelector";
import { LocalityRing } from "../ui/LocalityRing";
import { Button } from "../ui/button";
import { RadioCardGroup } from "./RadioCardGroup";
import { VoiceDownloadPanel } from "./VoiceDownloadPanel";

export interface VoiceStepProps {
  platform: "darwin" | "linux" | "win32";
  profile: SystemProfile | null;
  pick: VoicePick | null;
  selectedModel: string | null;
  onSelectModel(modelId: string): void;
  language: string;
  spokenLanguages?: readonly string[];
  onLanguageChange(language: string): void;
  languageLocked: boolean;
  compatible: boolean;
  blockedId: string;
  download: VoiceDownloadState;
  onStartDownload(): void;
  onCancelDownload(): void;
}

const ORGANIZATION: Record<string, string> = { oruk: "Oruk", nvidia: "NVIDIA" };

export function VoiceStep(props: VoiceStepProps) {
  const {
    platform,
    profile,
    pick,
    selectedModel,
    onSelectModel,
    language,
    onLanguageChange,
    languageLocked,
    compatible,
    blockedId,
    download,
  } = props;
  const { t, i18n } = useTranslation();
  const locale = i18n?.language;
  const pickerId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const device = platform === "darwin" ? "Mac" : "Other";
  const languageName = (code: string) => {
    try {
      return new Intl.DisplayNames([locale ?? "en"], { type: "language" }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  const size = (bytes: number | null) => {
    const parts = byteParts(bytes ?? 0, locale);
    return t(`setupFlow.units.${parts.unit}`, { value: parts.value });
  };

  if (!profile || !pick)
    return (
      <p role="status" className="onb-muted">
        {t(`setupFlow.voice.checking${device}`)}
      </p>
    );

  const busy =
    download.status === "downloading" ||
    download.status === "installing" ||
    download.status === "cancelling";
  const unsupported = pick.modelId === null;
  const model = ONBOARDING_SPEECH_MODELS.find((entry) => entry.id === selectedModel) ?? null;
  const outcome = selectedModel ? outcomeFor(selectedModel) : null;
  const voiceName = outcome ? t(`setupFlow.voice.outcomes.${outcome}.name`) : "";
  const why = (() => {
    switch (pick.reason.kind) {
      case "english":
        return t(`setupFlow.voice.why.english${device}`);
      case "language":
        return t(`setupFlow.voice.why.language${device}`, {
          voice: voiceName,
          language: languageName(pick.reason.language),
        });
      case "multilingual":
        return t(`setupFlow.voice.why.multilingual${device}`, {
          voice: voiceName,
          languages: new Intl.ListFormat(locale ?? "en", { type: "conjunction" }).format(
            pick.reason.languages.map(languageName)
          ),
        });
      default:
        return t("setupFlow.voice.why.unsupported", {
          language: languageName(pick.reason.language),
        });
    }
  })();
  const gpu =
    profile.gpu.kind === "apple-silicon"
      ? t("setupFlow.voice.gpu.appleSilicon")
      : profile.gpu.kind === "nvidia"
        ? (profile.gpu.name ?? t("setupFlow.voice.gpu.nvidia"))
        : t("setupFlow.voice.gpu.unknown");
  const unknown = t("setupFlow.voice.unknown");
  const signals: Array<[string, string]> = [
    ["systemLanguage", profile.locales[0] ? languageName(profile.locales[0]) : unknown],
    [
      "memory",
      profile.totalMemoryBytes === null
        ? unknown
        : t("setupFlow.units.gb", { value: Math.round(profile.totalMemoryBytes / 1024 ** 3) }),
    ],
    ["freeSpace", profile.freeDiskBytes === null ? unknown : size(profile.freeDiskBytes)],
    ["graphics", gpu],
  ];
  const showPicker = pickerOpen || !compatible;
  const requiredLanguages = props.spokenLanguages ?? [language];
  const unheardLanguages = (modelId: string | null) =>
    new Intl.ListFormat(locale ?? "en", { type: "conjunction" }).format(
      requiredLanguages
        .filter((code) => !modelId || !supportsSpeechLanguage(modelId, code))
        .map((code) => languageName(code.split("-")[0]))
    );

  return (
    <>
      <section className="onb-card" aria-labelledby="onb-voice-title">
        <h2 id="onb-voice-title" className="onb-card__title">
          {t(unsupported ? "setupFlow.voice.unsupportedTitle" : "setupFlow.voice.title")}
        </h2>
        <p className="onb-muted">{why}</p>
        <h3 className="onb-eyebrow">{t("setupFlow.voice.noticed")}</h3>
        <ul className="onb-signals">
          {signals.map(([key, value]) => (
            <li key={key} className="onb-signal">
              <Check aria-hidden="true" className="onb-signal__tick" />
              <span>{t(`setupFlow.voice.signals.${key}`)}</span>
              <strong>{value}</strong>
            </li>
          ))}
        </ul>
        {pick.disk ? (
          <p role="note" className="onb-warning">
            {t("setupFlow.voice.diskShort", {
              needed: size(pick.disk.neededBytes),
              free: size(pick.disk.freeBytes),
            })}
          </p>
        ) : null}
      </section>

      {model && outcome ? (
        <section className="onb-reco" aria-labelledby="onb-voice-reco">
          <p className="onb-eyebrow">{t("setupFlow.voice.recommended")}</p>
          <h3 id="onb-voice-reco" className="onb-reco__name">
            {voiceName}
          </h3>
          <p className="onb-muted">{t(`setupFlow.voice.outcomes.${outcome}.description`)}</p>
          <p className="onb-reco__meta">
            <LocalityRing locality="device" label={t("locality.device")} size={16} />
            <span>{t("locality.device")}</span>
            <span aria-hidden="true">·</span>
            <span>{`${model.name} · ${ORGANIZATION[model.organization] ?? model.organization} · ${size(modelDownloadBytes(model.id))}`}</span>
          </p>
          {download.status === "ready" ? (
            <p className="onb-ok">{t("setupFlow.voice.installed")}</p>
          ) : null}
          <VoiceDownloadPanel
            state={download}
            modelName={voiceName}
            onStart={props.onStartDownload}
            onCancel={props.onCancelDownload}
          />
        </section>
      ) : null}

      {!compatible ? (
        <p id={blockedId} role="note" className="onb-warning">
          {selectedModel
            ? t("setupFlow.voice.blocked.mismatch", { language: unheardLanguages(selectedModel) })
            : t("setupFlow.voice.blocked.none", { language: unheardLanguages(selectedModel) })}
        </p>
      ) : null}

      {compatible ? (
        <Button
          variant="link"
          className="justify-self-start"
          aria-expanded={showPicker}
          aria-controls={pickerId}
          onClick={() => setPickerOpen((open) => !open)}
        >
          {t("setupFlow.voice.notRight")}
        </Button>
      ) : null}

      {showPicker ? (
        <section id={pickerId} className="onb-card" aria-label={t("setupFlow.voice.pickerLabel")}>
          <fieldset className="onb-fieldset" disabled={languageLocked}>
            <LanguageSelector
              value={language}
              onChange={(value) => {
                if (!languageLocked && !busy) onLanguageChange(value);
              }}
            />
          </fieldset>
          {languageLocked ? (
            <p className="onb-muted">{t("setupFlow.voice.languageLocked")}</p>
          ) : null}
          <RadioCardGroup
            label={t("setupFlow.voice.pickerLabel")}
            idPrefix="onb-voice"
            value={selectedModel}
            onChange={onSelectModel}
            options={ONBOARDING_SPEECH_MODELS.map((entry) => {
              const entryOutcome = outcomeFor(entry.id);
              const reason = busy
                ? t("setupFlow.voice.lockedWhileDownloading")
                : voiceSupportsAll(entry.id, requiredLanguages)
                  ? undefined
                  : t("setupFlow.voice.cantHear", { language: unheardLanguages(entry.id) });
              return {
                value: entry.id,
                label: entryOutcome
                  ? t(`setupFlow.voice.outcomes.${entryOutcome}.name`)
                  : entry.name,
                description: entryOutcome
                  ? t(`setupFlow.voice.outcomes.${entryOutcome}.description`)
                  : undefined,
                meta: `${entry.name} · ${size(modelDownloadBytes(entry.id))}`,
                disabledReason: reason,
              };
            })}
          />
        </section>
      ) : null}
    </>
  );
}
