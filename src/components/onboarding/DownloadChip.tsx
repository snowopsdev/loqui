import { useTranslation } from "react-i18next";
import { Check, CircleAlert } from "../icons";
import { etaParts, type VoiceDownloadState } from "../../utils/onboardingDownload";

const RING = 2 * Math.PI * 6;

/** The footer chip on steps without their own download row (ONB-R4). Truncates, never wraps. */
export function DownloadChip({ state, onStart }: { state: VoiceDownloadState; onStart(): void }) {
  const { t } = useTranslation();
  if (state.status === "idle" || state.status === "checking") return null;
  const eta = state.status === "downloading" ? etaParts(state.etaSeconds) : null;
  const label =
    state.status === "downloading"
      ? eta
        ? t("setupFlow.download.chip", {
            percent: state.percent,
            eta: t(`setupFlow.download.eta.${eta.unit}`, { count: eta.count }),
          })
        : t("setupFlow.download.chipNoEta", { percent: state.percent })
      : t(
          {
            installing: "setupFlow.download.chipInstalling",
            cancelling: "setupFlow.download.chipCancelling",
            cancelled: "setupFlow.download.chipCancelled",
            ready: "setupFlow.download.chipReady",
            error: "setupFlow.download.chipFailed",
          }[state.status]
        );
  const progress = state.status === "downloading" ? state.percent / 100 : 1;
  const action =
    state.status === "error"
      ? "setupFlow.download.retry"
      : state.status === "cancelled"
        ? "setupFlow.download.downloadAgain"
        : null;
  return (
    <span className="onb-chip" data-status={state.status}>
      {state.status === "ready" ? (
        <Check aria-hidden="true" className="onb-chip__icon" />
      ) : state.status === "error" ? (
        <CircleAlert aria-hidden="true" className="onb-chip__icon" />
      ) : (
        <svg aria-hidden="true" className="onb-chip__ring" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="6" />
          <circle
            cx="8"
            cy="8"
            r="6"
            strokeDasharray={RING}
            strokeDashoffset={RING * (1 - progress)}
          />
        </svg>
      )}
      <span className="onb-chip__label">{label}</span>
      {state.status === "error" ? <span className="sr-only">{state.message}</span> : null}
      {action ? (
        <button type="button" className="onb-chip__action" onClick={onStart}>
          {t(action)}
        </button>
      ) : null}
    </span>
  );
}
