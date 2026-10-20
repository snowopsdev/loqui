import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Mic } from "../icons";
import { Button } from "../ui/button";
import { LevelBars } from "../ui/LevelBars";
import { BUILT_IN_MIC, SYSTEM_MIC, type MicPickerModel } from "../../utils/onboardingMic";
import { RecoveryCard } from "./RecoveryCard";
import { openMicrophoneHelp, type MicAccess } from "./useMicrophoneAccess";
import type { MicLevelPreview } from "./useMicLevelPreview";

export interface HelloStepProps {
  platform: "darwin" | "linux" | "win32";
  access: MicAccess;
  preview: MicLevelPreview;
  picker: MicPickerModel;
  onPickMicrophone(value: string): void;
  onAllow(): void;
  onRecheck(): void;
}

export function HelloStep({
  platform,
  access,
  preview,
  picker,
  onPickMicrophone,
  onAllow,
  onRecheck,
}: HelloStepProps) {
  const { t } = useTranslation();
  const pickerId = useId();
  const recheck = {
    label: t("setupFlow.hello.recheck"),
    onClick: onRecheck,
    variant: "ghost" as const,
  };

  if (access === "denied") {
    return (
      <RecoveryCard
        title={t("setupFlow.hello.deniedTitle")}
        body={t(
          platform === "darwin"
            ? "setupFlow.hello.deniedBodyMac"
            : "setupFlow.hello.deniedBodyOther"
        )}
        actions={[
          {
            label: t("setupFlow.hello.openSettings"),
            onClick: () => void openMicrophoneHelp(platform),
          },
          recheck,
        ]}
      />
    );
  }
  if (preview.status === "failed") {
    return (
      <RecoveryCard
        title={t("setupFlow.hello.unavailableTitle")}
        body={t("setupFlow.hello.unavailableBody")}
        actions={[
          { label: t("setupFlow.hello.retryOpen"), onClick: preview.retry },
          {
            label: t("setupFlow.hello.openSound"),
            onClick: () => void window.electronAPI?.openSoundInputSettings?.(),
            variant: "ghost",
          },
        ]}
      />
    );
  }
  return (
    <section className="onb-card" aria-labelledby="onb-hello-mic">
      <h2 id="onb-hello-mic" className="onb-card__title">
        {t("setupFlow.hello.micTitle")}
      </h2>
      {access === "granted" ? (
        <>
          <div className="onb-mic-row">
            <Mic aria-hidden="true" className="onb-mic-row__icon" />
            {preview.status === "live" ? (
              <LevelBars readLevel={preview.readLevel} height={20} />
            ) : null}
            <span>
              {preview.status !== "live"
                ? t("setupFlow.hello.starting")
                : preview.deviceLabel
                  ? t("setupFlow.hello.micReady", { device: preview.deviceLabel })
                  : t("setupFlow.hello.micReadyGeneric")}
            </span>
          </div>
          <div
            className="onb-select-row"
            data-attention={preview.silent || picker.missing || undefined}
          >
            <label htmlFor={pickerId}>{t("setupFlow.hello.micLabel")}</label>
            <select
              id={pickerId}
              value={picker.value}
              onChange={(event) => onPickMicrophone(event.target.value)}
            >
              <option value={SYSTEM_MIC}>{t("setupFlow.hello.systemDefault")}</option>
              {picker.hasBuiltIn ? (
                <option value={BUILT_IN_MIC}>{t("setupFlow.hello.builtIn")}</option>
              ) : null}
              {picker.devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || t("setupFlow.hello.unnamedMic")}
                </option>
              ))}
            </select>
          </div>
          {preview.silent ? (
            <p className="onb-warning" role="status">
              {t("setupFlow.hello.notHearing")}
            </p>
          ) : null}
          {picker.missing ? (
            <p className="onb-muted">{t("setupFlow.hello.savedMicMissing")}</p>
          ) : null}
        </>
      ) : (
        <Button variant="live" onClick={onAllow}>
          <Mic aria-hidden="true" />
          {t("setupFlow.hello.allowMic")}
        </Button>
      )}
      <p className="onb-muted">{t("setupFlow.hello.micBody")}</p>
    </section>
  );
}
