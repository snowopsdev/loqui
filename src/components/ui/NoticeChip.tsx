import { useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Info, X } from "../icons";
import { TechnicalErrorDetails } from "./TechnicalErrorDetails";
import { dismissNotice, pauseNotice, resumeNotice, runNoticeAction, type Notice } from "./notices";

const ICONS = { receipt: Check, notice: Info, alert: AlertTriangle } as const;

/**
 * One 32px line per message (VO-R14 B): icon, title, muted body, the primary
 * action inline, then message disclosure and close. The disclosure expands
 * the complete title and explanation in place, including title-only failures,
 * with every other action (I11). The stack keeps overflow locally scrollable.
 */
export function NoticeChip({
  notice,
  stagger,
  defaultExpanded = false,
}: {
  notice: Notice;
  stagger: number;
  defaultExpanded?: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const Icon = ICONS[notice.kind];
  const actions = notice.actions ?? [];
  const primary = actions.find((a) => a.primary) ?? actions[0];
  const secondary = actions.filter((a) => a !== primary);
  const hasMore = Boolean(notice.title || secondary.length || notice.body || notice.details);
  const moreId = `notice-more-${notice.id}`;
  return (
    <div
      className="notice-chip"
      data-kind={notice.kind}
      data-expanded={expanded ? "true" : undefined}
      role={notice.kind === "alert" ? "alert" : "status"}
      aria-live={notice.kind === "alert" ? "assertive" : "polite"}
      aria-atomic="true"
      style={{ "--notice-stagger": stagger } as CSSProperties}
      onMouseEnter={() => pauseNotice(notice.id)}
      onMouseLeave={() => resumeNotice(notice.id)}
    >
      <div className="notice-chip__row">
        <span className="notice-chip__icon" aria-hidden="true">
          <Icon size={12} />
        </span>
        <b className="notice-chip__title" aria-hidden={expanded && hasMore ? true : undefined}>
          {notice.title}
        </b>
        {notice.body ? <span className="notice-chip__body">{notice.body}</span> : null}
        {primary ? (
          <button
            type="button"
            className="notice-chip__action"
            disabled={notice.busy}
            onClick={() => void runNoticeAction(notice.id, primary)}
          >
            {primary.label}
          </button>
        ) : null}
        {hasMore ? (
          <button
            type="button"
            className="notice-chip__more"
            aria-expanded={expanded ? "true" : "false"}
            aria-controls={moreId}
            aria-label={t("notices.messageDetails")}
            onClick={() => setExpanded((v) => !v)}
          >
            ⋯
          </button>
        ) : null}
        <button
          type="button"
          className="notice-chip__close"
          aria-label={t("notices.dismiss")}
          onClick={() => dismissNotice(notice.id)}
        >
          <X size={12} aria-hidden="true" />
        </button>
      </div>
      {expanded && hasMore ? (
        <div
          id={moreId}
          className="notice-chip__expanded"
          role="group"
          aria-label={t("notices.messageDetails")}
        >
          <p className="notice-chip__expanded-title" dir="auto">
            {notice.title}
          </p>
          {notice.body ? (
            <p className="notice-chip__expanded-body" dir="auto">
              {notice.body}
            </p>
          ) : null}
          <TechnicalErrorDetails details={notice.details} />
          <div className="notice-chip__more-actions">
            {secondary.map((action) => (
              <button
                key={action.label}
                type="button"
                className="notice-chip__secondary"
                disabled={notice.busy}
                onClick={() => void runNoticeAction(notice.id, action)}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
