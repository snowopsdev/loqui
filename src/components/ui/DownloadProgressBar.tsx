import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "../icons";
import { formatETA, type DownloadProgress } from "../../hooks/useModelDownload";

interface DownloadProgressBarProps {
  modelName: string;
  progress: DownloadProgress;
  isInstalling?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)}KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)}GB`;
}

export function DownloadProgressBar({
  modelName,
  progress,
  isInstalling,
}: DownloadProgressBarProps) {
  const { t } = useTranslation();
  const labelId = useId();
  const { percentage, downloadedBytes, totalBytes, speed, eta } = progress;
  // A disconnected progress stream can report NaN or overshoot; never render
  // either as text or as a bar width.
  const pct = Number.isFinite(percentage) ? Math.max(0, Math.min(100, Math.round(percentage))) : 0;
  const speedText = speed ? `${speed.toFixed(1)} MB/s` : "";
  const etaText = eta ? formatETA(eta) : "";
  const indeterminate = !isInstalling && totalBytes === 0 && downloadedBytes > 0;
  // ARIA spells "indeterminate" as a progressbar without aria-valuenow.
  const reportsValue = !isInstalling && !indeterminate;

  return (
    <div className="px-2.5 py-2 border-b border-border-subtle">
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex items-center justify-center h-6 min-w-6 px-1.5 shrink-0">
          <div
            className={`absolute inset-0 rounded-md bg-muted ${isInstalling || indeterminate ? "progress-pulse" : ""}`}
          />
          {isInstalling ? (
            <Loader2 className="relative w-3.5 h-3.5 text-foreground motion-safe:animate-[spinner-rotate_calc(var(--motion-hero)*2)_linear_infinite]" />
          ) : (
            <span className="relative text-xs font-bold text-foreground tabular-nums">
              {indeterminate ? "···" : `${pct}%`}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p id={labelId} className="text-xs font-medium text-foreground truncate">
            {isInstalling
              ? t("models.installingNamed", { model: modelName })
              : t("models.downloadingNamed", { model: modelName })}
          </p>
          {!isInstalling && (indeterminate || speedText || etaText) && (
            <div className="flex items-center gap-1.5 mt-0.5">
              {indeterminate && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatBytes(downloadedBytes)}
                </span>
              )}
              {speedText && (
                <span className="text-xs text-muted-foreground tabular-nums">{speedText}</span>
              )}
              {etaText && (
                <>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{etaText}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={reportsValue ? pct : undefined}
        // Ink fill on a muted track with a 3:1 edge. Orange means live voice (D1),
        // and an orange fill on this track was 2.86:1.
        className="w-full rounded-full overflow-hidden bg-muted ring-1 ring-inset ring-input-border"
        style={{ height: 4 }}
      >
        {indeterminate ? (
          <div className="h-full w-1/3 rounded-full bg-foreground animate-[indeterminate_calc(var(--motion-slow)*4)_var(--motion-ease-std)_infinite]" />
        ) : (
          <div
            className={`${isInstalling ? "progress-pulse" : ""} bg-foreground`}
            style={{
              height: "100%",
              width: `${isInstalling ? 100 : pct}%`,
              borderRadius: 9999,
              transition: "width var(--motion-base) var(--motion-ease-std)",
            }}
          />
        )}
      </div>
    </div>
  );
}
