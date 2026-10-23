import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UpdateStatus } from "../../types/updates";
import { Button } from "../ui/button";
import { Toggle } from "../ui/toggle";
import { SettingsRow } from "../ui/SettingsSection";
import { isSealedModeError } from "../../utils/sealedModeError";

// Main refuses update checks, downloads and installs while sealed: a check
// carries the [SEALED_MODE] marker, an install the native-boundary refusal.
// Either becomes translated copy; main's raw text is never shown for them.
const isSealedRefusal = (error: unknown) =>
  isSealedModeError(error) ||
  (error instanceof Error && error.message.includes("NATIVE_BOUNDARY_UNAVAILABLE"));
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
  const [sealedRefused, setSealedRefused] = useState(false);
  const api = window.electronAPI?.updates;
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
    setSealedRefused(false);
    try {
      await action();
      setStatus(await api.status());
    } catch (e) {
      if (isSealedRefusal(e)) setSealedRefused(true);
      else setError((e as Error).message);
    }
  }
  if (notice && status?.phase !== "ready") return null;
  // Main's own state: checks, downloads and installs are paused while sealed.
  // A found update stays "available" with its GitHub link (D13).
  const sealed = status?.sealed === true;
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
      {sealedRefused ? (
        <p role="alert" className="text-sm text-destructive">
          {t("updates.sealedRefused")}
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
