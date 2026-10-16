import { useTranslation } from "react-i18next";
import type { AudioUsage } from "../../hooks/useAudioStorageUsage";
import { formatBytes } from "../../utils/formatBytes";
import { Button } from "../ui/button";
import { SettingsRow } from "../ui/SettingsSection";

interface AudioStorageRowProps {
  usage: AudioUsage;
  clearError: boolean;
  onClear: () => void;
  onRetry: () => void;
}

export function AudioStorageRow({ usage, clearError, onClear, onRetry }: AudioStorageRowProps) {
  const { t } = useTranslation();
  const description =
    usage.status === "loading"
      ? t("settingsPage.privacy.audioStorageChecking")
      : usage.status === "unavailable"
        ? t("settingsPage.privacy.audioStorageUnavailable")
        : usage.fileCount > 0
          ? t("settingsPage.privacy.audioStorageFiles", {
              count: usage.fileCount,
              size: formatBytes(usage.totalBytes),
            })
          : t("settingsPage.privacy.audioStorageEmpty");
  return (
    <>
      <SettingsRow label={t("settingsPage.privacy.audioStorageUsage")} description={description}>
        {usage.status === "unavailable" ? (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={usage.status !== "known" || usage.fileCount === 0}
            onClick={onClear}
          >
            {t("settingsPage.privacy.clearAllAudio")}
          </Button>
        )}
      </SettingsRow>
      {clearError && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {t("settingsPage.privacy.clearAllAudioFailed")}
        </p>
      )}
    </>
  );
}
