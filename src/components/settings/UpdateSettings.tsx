import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UpdateStatus } from "../../types/updates";
import { Button } from "../ui/button";
import { Toggle } from "../ui/toggle";
import { SettingsRow } from "../ui/SettingsSection";
import { useSealedMode } from "../../hooks/useSealedMode";
import { isSealedModeError, sealedPhase } from "../../utils/sealedModeError";

// Main refuses update checks, downloads and installs while sealed: a check
// carries the [SEALED_MODE] marker, an install the native-boundary refusal.
// Either becomes translated copy; main's raw text is never shown for them.
// "Nothing was sent" is only for a refusal: an interruption (or a code with no
// phase) may have reached GitHub, so it gets the interruption copy (T14-M3, m4).
function sealedAlertKey(error: unknown): string | null {
  if (error instanceof Error && error.message.includes("NATIVE_BOUNDARY_UNAVAILABLE"))
    return "updates.sealedRefused";
  if (!isSealedModeError(error)) return null;
  return sealedPhase(error) === "interrupted"
    ? "sealedMode.interrupted.generic"
    : "updates.sealedRefused";
}
export default function UpdateSettings({
  setup = false,
  notice = false,
}: {
  setup?: boolean;
  notice?: boolean;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState("");
  const [sealedAlert, setSealedAlert] = useState<string | null>(null);
  const api = window.electronAPI?.updates;
  // Main's update status, or the renderer's sealed store, whichever knows
  // first: if main's pause hook failed, its status may still read unsealed
  // (main refuses the request either way; m4).
  const { sealed: storeSealed } = useSealedMode();
  const sealed = status?.sealed === true || storeSealed === true;
  // A sealed alert describes the seal; once Sealed mode is off it is no
  // longer true, so it goes (T14-M3).
  useEffect(() => {
    if (!sealed) setSealedAlert(null);
  }, [sealed]);
  useEffect(() => {
    if (!api) return;
    void api
      .status()
      .then(setStatus)
      .catch(() => {});
    return api.onStatus(setStatus);
  }, [api]);
  async function run(action: () => Promise<unknown>) {
    setError("");
    setSealedAlert(null);
    try {
      await action();
      setStatus(await api.status());
    } catch (e) {
      const key = sealedAlertKey(e);
      if (key) setSealedAlert(key);
      else setError((e as Error).message);
    }
  }
  if (notice && status?.phase !== "ready") return null;
  // Checks, downloads and installs are paused while sealed. A found update
  // stays "available" with its GitHub link (D13).
  return (
    <section
      data-setting-id="updates"
      className="space-y-3 rounded-lg border border-border p-4"
      aria-label={t("updates.title")}
    >
      <h2 className="text-sm font-semibold">{t("updates.title")}</h2>
      {sealed && <p className="text-sm text-muted-foreground">{t("updates.sealed")}</p>}
      {!notice && (
        <>
          <SettingsRow label={t("updates.automatic")} description={t("updates.description")}>
            <Toggle
              checked={status?.enabled ?? true}
              onChange={(enabled) => void run(() => api.preferences({ enabled }))}
            />
          </SettingsRow>
          {!setup && (
            <label className="flex items-center gap-3 text-sm">
              {t("updates.channel")}
              <select
                className="rounded border bg-background p-2"
                value={status?.channel ?? "stable"}
                onChange={(e) =>
                  void run(() => api.preferences({ channel: e.target.value as "stable" | "beta" }))
                }
              >
                <option value="stable">{t("updates.stable")}</option>
                <option value="beta">{t("updates.beta")}</option>
              </select>
            </label>
          )}
        </>
      )}
      {!setup && (
        <div className="space-y-2 text-sm">
          {status?.phase === "downloading" && (
            <p>{t("updates.downloading", { percent: Math.round(status.progress ?? 0) })}</p>
          )}
          {status?.phase === "ready" && (
            <p>{t("updates.ready", { version: status.availableVersion })}</p>
          )}
          {status?.phase === "available" && (
            <p>{t("updates.available", { version: status.availableVersion })}</p>
          )}
          {status?.phase === "manual" || status?.phase === "available" ? (
            <Button
              variant="outline"
              onClick={() => window.electronAPI.openExternal(status.releasesUrl)}
            >
              {t("updates.download")}
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={!status || sealed || ["checking", "downloading"].includes(status.phase)}
              onClick={() => void run(() => api.check())}
            >
              {t("updates.check")}
            </Button>
          )}
          {status?.phase === "ready" && (
            <Button
              className="ms-2"
              disabled={sealed}
              onClick={() => void run(() => api.restart())}
            >
              {t("updates.restart")}
            </Button>
          )}
        </div>
      )}
      {sealedAlert ? (
        <p role="alert" className="text-sm text-destructive">
          {t(sealedAlert)}
        </p>
      ) : (
        (error || status?.error) && (
          <p role="alert" className="text-sm text-destructive">
            {error || status?.error}
          </p>
        )
      )}
    </section>
  );
}
