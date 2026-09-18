import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/button";
import { SettingsPanel, SettingsPanelRow, SettingsRow } from "../ui/SettingsSection";

type ModelKind = "meeting" | "search";
export default function LocalSupportModels() {
  const { t } = useTranslation();
  const [ready, setReady] = useState<Record<ModelKind, boolean>>({ meeting: false, search: false });
  const [busy, setBusy] = useState<ModelKind | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    const api = window.electronAPI;
    void Promise.all([api.getDiarizationModelStatus?.(), api.getSearchModelStatus?.()])
      .then(([meeting, search]) => {
        if (mounted)
          setReady({ meeting: !!meeting?.modelsDownloaded, search: !!search?.downloaded });
      })
      .catch((error) => {
        if (mounted) setError(String(error));
      });
    return () => {
      mounted = false;
    };
  }, []);
  const download = async (kind: ModelKind) => {
    setBusy(kind);
    setError("");
    try {
      const result =
        kind === "meeting"
          ? await window.electronAPI.downloadDiarizationModels?.()
          : await window.electronAPI.downloadSearchModel?.();
      if (!result?.success) throw new Error(result?.error || t("personal.supportDownloadFailed"));
      setReady((previous) => ({ ...previous, [kind]: true }));
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-2">
      <SettingsPanel>
        {(["meeting", "search"] as const).map((kind) => (
          <SettingsPanelRow key={kind}>
            <SettingsRow
              label={t(`personal.supportModels.${kind}`)}
              description={t(`personal.supportModels.${kind}Description`)}
            >
              <Button
                size="sm"
                variant="outline"
                disabled={ready[kind] || !!busy}
                onClick={() => void download(kind)}
              >
                {t(
                  ready[kind]
                    ? "localModels.ready"
                    : busy === kind
                      ? "personal.downloading"
                      : "common.download"
                )}
              </Button>
            </SettingsRow>
          </SettingsPanelRow>
        ))}
      </SettingsPanel>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
