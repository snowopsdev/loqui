import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import modelRegistryData from "../../models/modelRegistryData.json";
import { refreshRouteFacts } from "../../stores/routeFactsStore";
import { formatDecimalBytes } from "../../utils/formatBytes";
import { Button } from "../ui/button";
import { LocalityRing } from "../ui/LocalityRing";
import { SectionHeader, SettingsPanel, SettingsPanelRow, SettingsRow } from "../ui/SettingsSection";

type ModelKind = "meeting" | "search";

interface ModelStatus {
  downloaded: boolean | null;
  checking: boolean;
  error: string | null;
}

const SUPPORT_MODEL_BYTES: Record<ModelKind, number> = {
  meeting: Object.values(modelRegistryData.diarizationModels).reduce(
    (sum, model) => sum + model.sizeMb * 1_000_000,
    0
  ),
  search: 91_000_000,
};

const initialStatus = (): ModelStatus => ({ downloaded: null, checking: true, error: null });

export default function LocalSupportModels() {
  const { t } = useTranslation();
  const translate = useRef(t);
  translate.current = t;
  const [statuses, setStatuses] = useState<Record<ModelKind, ModelStatus>>({
    meeting: initialStatus(),
    search: initialStatus(),
  });
  const [busy, setBusy] = useState<ModelKind | null>(null);
  const requestVersion = useRef<Record<ModelKind, number>>({ meeting: 0, search: 0 });
  const mounted = useRef(true);

  const refreshStatus = useCallback(async (kind: ModelKind) => {
    const request = ++requestVersion.current[kind];
    setStatuses((previous) => ({
      ...previous,
      [kind]: { ...previous[kind], checking: true, error: null },
    }));
    try {
      const api = window.electronAPI;
      const getStatus =
        kind === "meeting" ? api?.getDiarizationModelStatus : api?.getSearchModelStatus;
      if (typeof getStatus !== "function") {
        throw new Error(translate.current("settingsPage.llms.supportModels.statusUnavailable"));
      }
      const result = await getStatus.call(api);
      const downloaded = kind === "meeting" ? result?.modelsDownloaded : result?.downloaded;
      if (typeof downloaded !== "boolean") {
        throw new Error(translate.current("settingsPage.llms.supportModels.statusUnavailable"));
      }
      if (mounted.current && requestVersion.current[kind] === request) {
        setStatuses((previous) => ({
          ...previous,
          [kind]: { downloaded, checking: false, error: null },
        }));
      }
    } catch (error) {
      if (mounted.current && requestVersion.current[kind] === request) {
        setStatuses((previous) => ({
          ...previous,
          [kind]: { downloaded: null, checking: false, error: String(error) },
        }));
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const currentRequestVersion = requestVersion.current;
    void Promise.all([refreshStatus("meeting"), refreshStatus("search")]);
    return () => {
      mounted.current = false;
      currentRequestVersion.meeting += 1;
      currentRequestVersion.search += 1;
    };
  }, [refreshStatus]);

  const download = async (kind: ModelKind) => {
    setBusy(kind);
    try {
      const result =
        kind === "meeting"
          ? await window.electronAPI.downloadDiarizationModels?.()
          : await window.electronAPI.downloadSearchModel?.();
      if (!result?.success) throw new Error(result?.error || t("personal.supportDownloadFailed"));
      setStatuses((previous) => ({
        ...previous,
        [kind]: { downloaded: true, checking: false, error: null },
      }));
      void refreshRouteFacts();
    } catch (error) {
      setStatuses((previous) => ({
        ...previous,
        [kind]: { ...previous[kind], checking: false, error: String(error) },
      }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-setting-id="supportModels" className="space-y-3">
      <SectionHeader
        title={t("settingsPage.llms.supportModels.title")}
        description={t("settingsPage.llms.supportModels.description")}
      />
      <SettingsPanel>
        {(["meeting", "search"] as const).map((kind) => {
          const status = statuses[kind];
          return (
            <SettingsPanelRow key={kind}>
              <SettingsRow
                label={t(`personal.supportModels.${kind}`)}
                description={t(`personal.supportModels.${kind}Description`)}
              >
                <div className="flex items-center gap-2">
                  <LocalityRing locality="device" label={t("locality.device")} size={18} />
                  {status.checking ? (
                    <span className="text-xs font-medium text-muted-foreground">
                      {t("settingsPage.llms.supportModels.checking")}
                    </span>
                  ) : status.downloaded === true ? (
                    <span className="text-xs font-medium text-locality-device">
                      {t("settingsPage.llms.supportModels.downloaded")}
                    </span>
                  ) : status.downloaded === false ? (
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
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t("settingsPage.llms.supportModels.statusUnavailable")}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!busy}
                        onClick={() => void refreshStatus(kind)}
                      >
                        {t("common.retry")}
                      </Button>
                    </div>
                  )}
                </div>
              </SettingsRow>
            </SettingsPanelRow>
          );
        })}
      </SettingsPanel>
      {(["meeting", "search"] as const).map((kind) =>
        statuses[kind].error ? (
          <p key={kind} role="alert" className="text-xs text-destructive">
            {t(`personal.supportModels.${kind}`)}: {statuses[kind].error}
          </p>
        ) : null
      )}
    </div>
  );
}
