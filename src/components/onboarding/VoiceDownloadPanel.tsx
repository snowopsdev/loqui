import { useTranslation } from "react-i18next";
import { Button } from "../ui/button";
import { DownloadProgressBar } from "../ui/DownloadProgressBar";
import { byteParts, type VoiceDownloadState } from "../../utils/onboardingDownload";

/**
 * The rendered progress row (I14): Plan 02's progressbar (percent, speed in MB/s,
 * ETA), received/total, and the action that fits the state.
 */
export function VoiceDownloadPanel({
  state,
  modelName,
  onStart,
  onCancel,
}: {
  state: VoiceDownloadState;
  modelName: string;
  onStart(): void;
  onCancel(): void;
}) {
  const { t, i18n } = useTranslation();
  const size = (bytes: number) => {
    const parts = byteParts(bytes, i18n?.language);
    return t(`setupFlow.units.${parts.unit}`, { value: parts.value });
  };
  if (state.status === "downloading" || state.status === "installing") {
    const downloading = state.status === "downloading";
    return (
      <div className="onb-download">
        <DownloadProgressBar
          modelName={modelName}
          isInstalling={!downloading}
          progress={{
            percentage: downloading ? state.percent : 100,
            downloadedBytes: downloading ? state.downloadedBytes : 0,
            totalBytes: downloading ? state.totalBytes : 0,
            speed: downloading && state.bytesPerSecond ? state.bytesPerSecond / 1e6 : undefined,
            eta: downloading && state.etaSeconds !== null ? state.etaSeconds : undefined,
          }}
        />
        {downloading ? (
          <div className="onb-download__row">
            <span>
              {t("setupFlow.download.received", {
                done: size(state.downloadedBytes),
                total: size(state.totalBytes),
              })}
            </span>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              {t("setupFlow.download.cancel")}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }
  if (state.status === "cancelling")
    return <p className="onb-muted">{t("setupFlow.download.chipCancelling")}</p>;
  if (state.status === "cancelled") {
    return (
      <div className="onb-download__row">
        <span>{t("setupFlow.download.cancelledLine")}</span>
        <Button size="sm" onClick={onStart}>
          {t("setupFlow.download.downloadAgain")}
        </Button>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="onb-warning" role="status">
        <p>
          {state.percent !== null
            ? t(
                state.progressKept === null
                  ? "setupFlow.download.stoppedUnknown"
                  : state.progressKept
                    ? "setupFlow.download.stoppedKept"
                    : "setupFlow.download.stoppedRestart",
                { percent: state.percent }
              )
            : null}{" "}
          {state.message}
        </p>
        <Button size="sm" onClick={onStart}>
          {t("setupFlow.download.retry")}
        </Button>
      </div>
    );
  }
  return null;
}
