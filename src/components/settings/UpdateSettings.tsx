import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UpdateStatus } from "../../types/updates";
import { Button } from "../ui/button";
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
          {status?.phase === "manual" ? (
            <Button
              variant="outline"
              onClick={() => window.electronAPI.openExternal(status.releasesUrl)}
            >
              {t("updates.download")}
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={
                !status?.enabled || ["checking", "downloading"].includes(status?.phase ?? "")
              }
              onClick={() => void run(() => api.check())}
            >
              {t("updates.check")}
            </Button>
          )}
          {status?.phase === "ready" && (
            <Button className="ml-2" onClick={() => void run(() => api.restart())}>
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
