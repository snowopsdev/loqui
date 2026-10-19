import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, CircleAlert } from "../icons";
import { Button } from "../ui/button";
import { isSilent, type TrialState } from "../../utils/onboardingTrial";
import type { KeycapState } from "../../utils/onboardingShortcut";
import { cleanupErrorKey } from "./cleanupRunner";
import { LiveKeycap } from "./LiveKeycap";
import { RecoveryCard } from "./RecoveryCard";
import { openMicrophoneHelp } from "./useMicrophoneAccess";

export interface HotkeyTrialProps {
  platform: "darwin" | "linux" | "win32";
  trial: TrialState;
  nowMs: number;
  hotkeyLabel: string;
  activationMode: "tap" | "push";
  keycap: KeycapState;
  usedHotkey: boolean;
  accessibilityMissing: boolean;
  cleanupCode?: string | null;
  available?: boolean;
  controlError?: boolean;
  onToggle(): void;
  onCancel(): void;
  onGrantAccessibility(): void;
  onRetryCleanup(): void;
  onTurnCleanupOff(): void;
  onBackToVoice(): void;
  onChangeMicrophone(): void; // back to Hello's picker (owner decision 6)
}

export function HotkeyTrial(props: HotkeyTrialProps) {
  const { t } = useTranslation();
  const { trial, platform, hotkeyLabel, activationMode } = props;
  const [buttonMode, setButtonMode] = useState(false);
  const recording = trial.phase === "recording";
  const key = { key: hotkeyLabel };
  const openSound = {
    label: t("setupFlow.hello.openSound"),
    onClick: () => void window.electronAPI?.openSoundInputSettings?.(),
  };
  const changeMic = { label: t("setupFlow.try.changeMic"), onClick: props.onChangeMicrophone };

  const failure = (() => {
    if (trial.phase !== "error") return null;
    switch (trial.errorKind) {
      case "microphone":
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
            ]}
          />
        );
      case "noAudio":
        return (
          <RecoveryCard
            title={t("setupFlow.try.noAudioTitle")}
            body={t("setupFlow.try.noAudioBody")}
            actions={[changeMic, { ...openSound, variant: "ghost" }]}
          />
        );
      case "memory":
        return (
          <RecoveryCard
            title={t("setupFlow.try.memoryTitle")}
            body={t("setupFlow.try.memoryBody")}
            actions={[{ label: t("setupFlow.try.chooseSmaller"), onClick: props.onBackToVoice }]}
          />
        );
      default:
        return (
          <RecoveryCard
            title={t("setupFlow.try.otherTitle")}
            body={t("setupFlow.try.otherBody")}
            actions={[{ label: t("setupFlow.try.again"), onClick: props.onToggle }]}
            tone="neutral"
          />
        );
    }
  })();

  return (
    <section className="onb-trial" aria-labelledby="onb-trial-title">
      <h2 id="onb-trial-title" className="sr-only">
        {t("setupFlow.steps.try")}
      </h2>
      {props.accessibilityMissing ? (
        <RecoveryCard
          title={t("setupFlow.try.accessibilityTitle")}
          body={t("setupFlow.try.accessibilityBody")}
          actions={[
            { label: t("setupFlow.try.grantAccess"), onClick: props.onGrantAccessibility },
            {
              label: t("setupFlow.try.useButton"),
              onClick: () => setButtonMode(true),
              variant: "ghost",
            },
          ]}
        />
      ) : null}
      <div className="onb-trial__card" data-phase={trial.phase}>
        <LiveKeycap
          label={hotkeyLabel}
          sublabel={t(`setupFlow.try.keycap.${activationMode}`)}
          pressed={props.keycap.pressed || recording}
          flashKey={props.keycap.presses}
        />
        <div className="onb-field" data-state={trial.phase} aria-live="polite">
          {trial.phase === "idle" ? (
            <p className="onb-field__hint">{t(`setupFlow.try.idle.${activationMode}`, key)}</p>
          ) : null}
          {recording ? <p className="onb-field__status">{t("setupFlow.try.listening")}</p> : null}
          {trial.phase === "processing" ? (
            <p className="onb-field__status">{t("setupFlow.try.processing")}</p>
          ) : null}
          {trial.text && trial.phase !== "cancelled" ? (
            <p className="onb-field__text">{trial.text}</p>
          ) : null}
          {trial.phase === "success" ? (
            <p className="onb-field__ok">
              <Check aria-hidden="true" />
              {t(props.usedHotkey ? "setupFlow.try.shortcutWorks" : "setupFlow.try.heardYou")}
            </p>
          ) : null}
          {trial.phase === "cancelled" ? (
            // Task 22 adds the disclosure (disclosureCopy) and Undo here.
            <p className="onb-field__status">{t("setupFlow.try.discarded")}</p>
          ) : null}
        </div>
        {isSilent(trial, props.nowMs) ? (
          <p className="onb-warning">
            {t("setupFlow.try.silent")}{" "}
            <Button size="sm" variant="link" onClick={changeMic.onClick}>
              {changeMic.label}
            </Button>
          </p>
        ) : null}
        {trial.phase === "success" && trial.cleanup === "failed" ? (
          <div className="onb-warning" role="status">
            <CircleAlert aria-hidden="true" />
            <p>
              {t(
                props.cleanupCode === "UNSUPPORTED_AUTH_SOURCE"
                  ? "setupFlow.try.cleanupUnsupported"
                  : props.cleanupCode && props.cleanupCode !== "CLEANUP_FAILED"
                    ? cleanupErrorKey(props.cleanupCode)
                    : trial.cleanupRetry === "failed"
                      ? "setupFlow.try.retryFailed"
                      : "setupFlow.try.cleanupFailed"
              )}
            </p>
            <div className="onb-recovery__actions">
              <Button
                size="sm"
                onClick={props.onRetryCleanup}
                disabled={trial.cleanupRetry === "running"}
              >
                {t("setupFlow.try.retryCleanup")}
              </Button>
              <Button size="sm" variant="ghost" onClick={props.onTurnCleanupOff}>
                {t("setupFlow.try.cleanupOff")}
              </Button>
            </div>
            <p className="onb-muted">{t("setupFlow.try.wordsSafe")}</p>
          </div>
        ) : null}
        {props.controlError ? (
          <p className="onb-warning" role="alert">
            {t("setupFlow.try.controlUnavailable")}
          </p>
        ) : null}
        {failure}
        {recording || trial.phase === "processing" ? (
          <Button size="sm" variant="ghost" onClick={props.onCancel}>
            {t("setupFlow.try.cancel")}
          </Button>
        ) : null}
        {buttonMode ? (
          <Button
            variant="live"
            onClick={props.onToggle}
            disabled={props.available === false || trial.phase === "processing"}
          >
            {t(recording ? "setupFlow.try.stop" : "setupFlow.try.start")}
          </Button>
        ) : null}
        <p className="onb-muted">
          {t("setupFlow.try.privacyLine")}{" "}
          {!buttonMode && !props.accessibilityMissing ? (
            <Button size="sm" variant="link" onClick={() => setButtonMode(true)}>
              {t("setupFlow.try.useButton")}
            </Button>
          ) : null}
        </p>
      </div>
    </section>
  );
}
