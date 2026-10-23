import { useTranslation } from "react-i18next";
import mark from "../assets/brand/mark.png";
import { X } from "./icons";
import { Button } from "./ui/button";

interface MeetingNotificationCardProps {
  title: string;
  body: string;
  startLabel: string;
  onStart?: () => void;
  onDismiss?: () => void;
  phase?: "card" | "mini" | "accepted";
  privacyLine?: string;
  hotkeyLabel?: string | null;
  miniLabel?: string;
  className?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function MeetingNotificationCard({
  title,
  body,
  startLabel,
  onStart,
  onDismiss,
  phase = "card",
  privacyLine,
  hotkeyLabel,
  miniLabel,
  className = "",
  onMouseEnter,
  onMouseLeave,
}: MeetingNotificationCardProps) {
  const { t } = useTranslation();
  return (
    <div
      className={`meeting-card meeting-drop bg-card/95 dark:bg-surface-2/95 border border-border/70 dark:border-border-subtle/60 ${className}`}
      data-phase={phase}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("meetingNotification.dismiss")}
        className="meeting-card__close"
      >
        <X className="size-3" aria-hidden="true" />
      </button>
      {phase === "mini" ? (
        <button
          type="button"
          className="meeting-card__mini"
          onClick={onStart}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            event.currentTarget.querySelector(".meeting-card__mini-label")?.scrollBy({
              left: event.key === "ArrowRight" ? 80 : -80,
            });
          }}
        >
          <span className="meeting-card__dot" aria-hidden="true" />
          <span className="meeting-card__mini-label">{miniLabel}</span>
          {hotkeyLabel ? <kbd dir="ltr">{hotkeyLabel}</kbd> : null}
        </button>
      ) : (
        <>
          <div className="meeting-card__main">
            <img src={mark} alt="" className="size-6.5 shrink-0" draggable={false} />
            <div className="meeting-card__copy" tabIndex={0}>
              <p className="meeting-card__title">
                {phase === "accepted" ? t("meetingNotification.accepted") : title}
              </p>
              <p className="meeting-card__body">{body}</p>
            </div>
            {phase !== "accepted" ? (
              <Button variant="live" size="sm" onClick={onStart} className="meeting-card__start">
                <span>{startLabel}</span>
              </Button>
            ) : null}
          </div>
          <div className="meeting-card__footer">
            {privacyLine ? (
              <p className="meeting-card__privacy text-success" tabIndex={0}>
                {privacyLine}
              </p>
            ) : null}
            {hotkeyLabel && phase !== "accepted" ? <kbd dir="ltr">{hotkeyLabel}</kbd> : null}
          </div>
        </>
      )}
    </div>
  );
}
