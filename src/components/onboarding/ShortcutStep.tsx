import { useTranslation } from "react-i18next";
import { Check } from "../icons";
import { HotkeyListInput } from "../ui/HotkeyListInput";
import { Toggle } from "../ui/toggle";
import { Button } from "../ui/button";
import { suggestActivationMode, type KeycapState } from "../../utils/onboardingShortcut";
import { LiveKeycap } from "./LiveKeycap";
import { RecoveryCard } from "./RecoveryCard";

export interface ShortcutStepProps {
  platform: "darwin" | "linux" | "win32";
  hotkey: string;
  hotkeyLabel: string;
  activationMode: "tap" | "push";
  pushSupported: boolean;
  keycap: KeycapState;
  accessibilityMissing: boolean;
  onGrantAccessibility(): void;
  autoPasteEnabled: boolean;
  onAutoPasteChange(value: boolean): void;
  onActivationModeChange(mode: "tap" | "push"): void;
  onHotkeyChange(value: string): void;
}

export function ShortcutStep(props: ShortcutStepProps) {
  const { t } = useTranslation();
  const { keycap, hotkeyLabel, activationMode } = props;
  const tried = keycap.presses > 0 && keycap.lastStyle !== null;
  const suggestion = tried
    ? suggestActivationMode(activationMode, keycap.lastStyle!, props.pushSupported)
    : null;

  return (
    <>
      {props.platform === "darwin" && props.accessibilityMissing ? (
        <RecoveryCard
          title={t("setupFlow.try.accessibilityTitle")}
          body={t("setupFlow.shortcut.accessibilityBody")}
          actions={[{ label: t("setupFlow.try.grantAccess"), onClick: props.onGrantAccessibility }]}
        />
      ) : null}
      <section className="onb-card onb-shortcut" aria-labelledby="onb-shortcut-title">
        <h2 id="onb-shortcut-title" className="onb-card__title">
          {t("setupFlow.shortcut.title")}
        </h2>
        <div
          className="onb-tester"
          role="group"
          tabIndex={0}
          aria-label={t("setupFlow.shortcut.testerLabel", { key: hotkeyLabel })}
        >
          <LiveKeycap
            label={hotkeyLabel}
            sublabel={t(`setupFlow.try.keycap.${activationMode}`)}
            pressed={keycap.pressed}
            size={84}
            flashKey={keycap.presses}
          />
          <div className="onb-field" data-state={tried ? "success" : "idle"} aria-live="polite">
            {tried ? (
              <>
                <p className="onb-field__text">{t("setupFlow.shortcut.fills")}</p>
                <p className="onb-field__ok">
                  <Check aria-hidden="true" />
                  {t("setupFlow.shortcut.works")} ·{" "}
                  {t(`setupFlow.shortcut.detected.${keycap.lastStyle}`)}
                </p>
              </>
            ) : (
              <p className="onb-field__hint">
                {t("setupFlow.shortcut.hint", { key: hotkeyLabel })}
              </p>
            )}
          </div>
        </div>
        {suggestion ? (
          <p className="onb-muted">
            {t(`setupFlow.shortcut.suggest.${suggestion}`)}{" "}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => props.onActivationModeChange(suggestion)}
            >
              {t("setupFlow.shortcut.switch")}
            </Button>
          </p>
        ) : null}
        <div>
          <p className="onb-toggle-row__title">{t("setupFlow.shortcut.change")}</p>
          <p className="onb-muted">{t("setupFlow.shortcut.changeHelp")}</p>
          <HotkeyListInput
            value={props.hotkey}
            onChange={props.onHotkeyChange}
            required
            maxHotkeys={1}
          />
        </div>
        <div className="onb-toggle-row">
          <div>
            <p className="onb-toggle-row__title">{t("setupFlow.shortcut.autoPaste")}</p>
            <p className="onb-muted">
              {t(
                props.platform === "darwin"
                  ? "setupFlow.shortcut.autoPasteBodyMac"
                  : "setupFlow.shortcut.autoPasteBodyOther"
              )}
            </p>
          </div>
          <Toggle
            checked={props.autoPasteEnabled}
            onChange={props.onAutoPasteChange}
            aria-label={t("setupFlow.shortcut.autoPaste")}
          />
        </div>
      </section>
    </>
  );
}
