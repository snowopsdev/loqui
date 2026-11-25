import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UpdateStatus } from "../../types/updates";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle } from "../ui/toggle";
import { SettingsRow } from "../ui/SettingsSection";
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
  // Set once a manual check finishes, so "latest version" answers that check
  // rather than appearing on every idle status.
  const [checked, setChecked] = useState(false);
  const channelLabelId = useId();
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
    setChecked(false);
    try {
      await action();
      setStatus(await api.status());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (notice && status?.phase !== "ready") return null;
  return (
    <section
      data-setting-id="updates"
      className="space-y-3 rounded-lg border border-border p-4"
      aria-label={t("updates.title")}
    >
      <h2 className="text-sm font-semibold">{t("updates.title")}</h2>
      {!notice && (
        <>
          <SettingsRow label={t("updates.automatic")} description={t("updates.description")}>
            <Toggle
              checked={status?.enabled ?? true}
              onChange={(enabled) => void run(() => api.preferences({ enabled }))}
            />
          </SettingsRow>
          {!setup && (
            <div className="flex items-center gap-3 text-sm">
              <span id={channelLabelId}>{t("updates.channel")}</span>
              <Select
                value={status?.channel ?? "stable"}
                onValueChange={(channel) =>
                  void run(() => api.preferences({ channel: channel as "stable" | "beta" }))
                }
              >
                <SelectTrigger aria-labelledby={channelLabelId} className="h-8 w-44 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stable">{t("updates.stable")}</SelectItem>
                  <SelectItem value="beta">{t("updates.beta")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </>
      )}
      {!setup && (
        <div className="space-y-2 text-sm" aria-live="polite">
          {status?.phase === "checking" && (
            <p className="text-muted-foreground">{t("settingsPage.general.updates.checking")}</p>
          )}
          {checked && status?.phase === "idle" && !status.error && (
            <p className="text-muted-foreground">
              {t("settingsPage.general.updates.latestVersion")}
            </p>
          )}
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
              disabled={!status || ["checking", "downloading"].includes(status.phase)}
              onClick={() =>
                void run(async () => {
                  await api.check();
                  setChecked(true);
                })
              }
            >
              {t("updates.check")}
            </Button>
          )}
          {status?.phase === "ready" && (
            <Button className="ms-2" onClick={() => void run(() => api.restart())}>
              {t("updates.restart")}
            </Button>
          )}
        </div>
      )}
      {(error || status?.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error || status?.error}
        </p>
      )}
    </section>
  );
}
