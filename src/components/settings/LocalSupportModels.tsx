import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import modelRegistryData from "../../models/modelRegistryData.json";
import { refreshRouteFacts } from "../../stores/routeFactsStore";
import { formatDecimalBytes } from "../../utils/formatBytes";
import { Button } from "../ui/button";
import { LocalityRing } from "../ui/LocalityRing";
import { SectionHeader, SettingsPanel, SettingsPanelRow, SettingsRow } from "../ui/SettingsSection";

type ModelKind = "meeting" | "search";

const SUPPORT_MODEL_BYTES: Record<ModelKind, number> = {
  meeting: Object.values(modelRegistryData.diarizationModels).reduce(
    (sum, model) => sum + model.sizeMb * 1_000_000,
    0
  ),
  search: 91_000_000,
};

export default function LocalSupportModels() {
  const { t } = useTranslation();
  const [ready, setReady] = useState<Record<ModelKind, boolean | null>>({
    meeting: null,
    search: null,
  });
  const [checking, setChecking] = useState(true);
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
      })
      .finally(() => {
        if (mounted) setChecking(false);
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
      void refreshRouteFacts();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <SectionHeader
        title={t("settingsPage.llms.supportModels.title")}
        description={t("settingsPage.llms.supportModels.description")}
      />
      <SettingsPanel>
        {(["meeting", "search"] as const).map((kind) => (
          <SettingsPanelRow key={kind}>
            <SettingsRow
              label={t(`personal.supportModels.${kind}`)}
              description={t(`personal.supportModels.${kind}Description`)}
            >
              <div className="flex items-center gap-2">
                <LocalityRing locality="device" label={t("locality.device")} size={18} />
                {checking ? (
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("settingsPage.llms.supportModels.checking")}
                  </span>
                ) : ready[kind] ? (
                  <span className="text-xs font-medium text-locality-device">
                    {t("settingsPage.llms.supportModels.downloaded")}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!busy}
                    onClick={() => void download(kind)}
                  >
                    {busy === kind
                      ? t("personal.downloading")
                      : t("settingsPage.llms.supportModels.download", {
                          size: formatDecimalBytes(SUPPORT_MODEL_BYTES[kind]),
                        })}
                  </Button>
                )}
              </div>
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
