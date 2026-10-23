import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { VoiceDownloadState } from "../../utils/onboardingDownload";
import { Button } from "../ui/button";
import { VoiceDownloadPanel } from "./VoiceDownloadPanel";

// eslint-disable-next-line react-refresh/only-export-components -- Task14 requires the shared motion hook in this module.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => globalThis.window?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export interface TryStageProps {
  download: VoiceDownloadState;
  /** Current explicit Voice choice matches the committed dictation configuration. */
  voiceCommitted: boolean;
  /** Task13's actual ready Plan03 local route; installed status alone cannot admit a trial. */
  trialReady: boolean;
  onStart(): void;
  onCancel(): void;
  onChooseVoice(): void;
  tour: ReactNode;
  children: ReactNode;
}

/** Say something: the tour while the voice downloads, the trial the moment it lands. */
export function TryStage({
  download,
  voiceCommitted,
  trialReady,
  onStart,
  onCancel,
  onChooseVoice,
  tour,
  children,
}: TryStageProps) {
  const { t } = useTranslation();
  const ready = download.status === "ready" && trialReady && voiceCommitted;
  const wasWaiting = useRef(download.status === "downloading" || download.status === "installing");
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    if (download.status === "downloading" || download.status === "installing") {
      wasWaiting.current = true;
      setArrived(false);
    } else if (ready && wasWaiting.current) {
      wasWaiting.current = false;
      setArrived(true);
    } else if (download.status === "error" || download.status === "cancelled") {
      wasWaiting.current = false;
      setArrived(false);
    } else if (!ready) {
      setArrived(false);
    }
  }, [download.status, ready]);

  if (!ready) {
    return (
      <div className="onb-stage">
        {!voiceCommitted || download.status === "idle" ? (
          <div className="onb-download__row">
            <span>{t("setupFlow.tour.noVoice")}</span>
            <Button size="sm" onClick={onChooseVoice}>
              {t("setupFlow.tour.chooseVoice")}
            </Button>
          </div>
        ) : download.status === "checking" || download.status === "ready" ? (
          <p className="onb-muted" role="status">
            {t("setupFlow.download.checking")}
          </p>
        ) : (
          <VoiceDownloadPanel
            state={download}
            modelName={t("setupFlow.download.voiceModel")}
            onStart={onStart}
            onCancel={onCancel}
          />
        )}
        {tour}
      </div>
    );
  }
  return (
    <div className="onb-stage" data-arrived={arrived || undefined}>
      {arrived ? (
        <div className="onb-stage__ready">
          <p className="onb-card__title">{t("setupFlow.tour.readyTitle")}</p>
          <p className="onb-muted">{t("setupFlow.tour.readyBody")}</p>
        </div>
      ) : null}
      {children}
    </div>
  );
}
