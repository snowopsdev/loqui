import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Attestation } from "../../types/privacy";
import { useSealedMode } from "../../hooks/useSealedMode";
import { setSealedMode } from "../../stores/sealedStore";
import { Lock } from "../icons";
import { Toggle } from "../ui/toggle";
import { sealedStatusLines, type StatusTone } from "./sealedModeCopy";

// SET-R6 C: the first block of Privacy & Data. Off, an ordinary card; on, the
// navy sealed palette. Only colours change (over --motion-slow), so reduced
// motion keeps the whole transition: there is no transform to drop.
const SEALED_TONE: Record<StatusTone, string> = {
  neutral: "text-[var(--color-sealed-muted)]",
  warn: "text-[var(--color-sealed-warn)]",
};
const OPEN_TONE: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  warn: "font-medium text-foreground",
};

export function SealedModePanelView({
  t,
  sealed,
  attestation,
  busy,
  error,
  onToggle,
  now,
}: {
  t: (key: string, params?: Record<string, unknown>) => string;
  sealed: boolean | null;
  attestation: Attestation | null;
  busy: boolean;
  error: boolean;
  onToggle: (next: boolean) => void;
  now?: number;
}) {
  const headingId = `sealed-mode-${useId()}`;
  const lines = sealedStatusLines(sealed, attestation, now);
  const on = sealed === true;
  const tone = on ? SEALED_TONE : OPEN_TONE;
  return (
    <section
      aria-labelledby={headingId}
      data-setting-id="sealedMode"
      data-sealed={on ? "true" : "false"}
      className={[
        "rounded-lg border p-4",
        "transition-[background-color,color,border-color] duration-[var(--motion-slow)] ease-[var(--motion-ease-std)]",
        on
          ? "border-[var(--color-sealed-border)] bg-[var(--color-sealed-bg)] text-[var(--color-sealed-fg)]"
          : "border-border bg-card text-foreground",
      ].join(" ")}
    >
      <div className="flex items-center gap-3">
        <Lock className="size-4 shrink-0" aria-hidden="true" />
        <h3 id={headingId} className="min-w-0 flex-1 text-[13px] font-semibold">
          {t("settingsPage.privacy.sealed.title")}
        </h3>
        <Toggle
          checked={on}
          disabled={sealed === null || busy}
          onChange={onToggle}
          aria-label={t("settingsPage.privacy.sealed.title")}
        />
      </div>
      <div className="mt-2 space-y-1 text-start text-xs leading-relaxed" aria-live="polite">
        {lines.map((line) => (
          <p key={line.key} className={tone[line.tone]}>
            {t(line.key, line.params)}
          </p>
        ))}
        {error && (
          <p role="alert" className={tone.warn}>
            {t("settingsPage.privacy.sealed.toggleError")}
          </p>
        )}
      </div>
    </section>
  );
}

export default function SealedModePanel() {
  const { t } = useTranslation();
  const { sealed, attestation } = useSealedMode();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  // Main answers after its barrier, or with declined: true when the user kept
  // the seal in main's own dialog (whose default is "Keep sealed"). The store
  // adopts either answer; the switch follows the store. Main's error text is
  // never shown: it can carry codes, not copy.
  async function onToggle(next: boolean) {
    setBusy(true);
    setError(false);
    try {
      await setSealedMode(next);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <SealedModePanelView
      t={t}
      sealed={sealed}
      attestation={attestation}
      busy={busy}
      error={error}
      onToggle={(next) => void onToggle(next)}
    />
  );
}
