import { useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Info, X } from "../icons";
import { dismissNotice, pauseNotice, resumeNotice, runNoticeAction, type Notice } from "./notices";

const ICONS = { receipt: Check, notice: Info, alert: AlertTriangle } as const;

/**
 * One 32px line per message (VO-R14 B): icon, title, muted body, the primary
 * action inline, then "More" when there are other actions, then close. "More"
 * expands the chip in place with every other action (I11), so a notice never
 * hides an action its sender relies on.
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
  const moreId = `notice-more-${notice.id}`;
  return (
    <div
      className="notice-chip"
      data-kind={notice.kind}
      data-expanded={expanded ? "true" : undefined}
      role={notice.kind === "alert" ? "alert" : "status"}
      aria-live={notice.kind === "alert" ? "assertive" : "polite"}
      style={{ "--notice-stagger": stagger } as CSSProperties}
      onMouseEnter={() => pauseNotice(notice.id)}
      onMouseLeave={() => resumeNotice(notice.id)}
    >
      <div className="notice-chip__row">
        <span className="notice-chip__icon" aria-hidden="true">
          <Icon size={12} />
        </span>
        <b className="notice-chip__title">{notice.title}</b>
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
        {secondary.length > 0 ? (
          <button
            type="button"
            className="notice-chip__more"
            aria-expanded={expanded ? "true" : "false"}
            aria-controls={moreId}
            aria-label={t("notices.moreActions")}
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
      {expanded && secondary.length > 0 ? (
        <div
          id={moreId}
          className="notice-chip__more-actions"
          role="group"
          aria-label={t("notices.moreActions")}
        >
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
      ) : null}
    </div>
  );
}
