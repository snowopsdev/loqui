import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, MessageSquare, Mic, NotebookPen } from "../icons";
import { formatMmSs } from "../../utils/formatDuration";
import type { TableCardModel } from "./tableModel";
import { plainExcerpt } from "./tableModel";

const KIND_ICON = {
  note: NotebookPen,
  meeting: CalendarDays,
  dictation: Mic,
  chat: MessageSquare,
} as const;
const EXCERPT = { note: 200, meeting: 160, dictation: 220, chat: 260 } as const;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

export interface TableCardProps {
  card: TableCardModel;
  selected: boolean;
  focusable: boolean;
  dragging: boolean;
  snapping: boolean;
  expanded: boolean;
  onMeasure: (key: string, h: number) => void;
}

// Cards are DOM, not canvas pixels, so text stays selectable by assistive tech
// and inherits theme, zoom and font settings. The dictation glyph is neutral:
// orange is reserved for live voice (D1).
export function TableCard({
  card,
  selected,
  focusable,
  dragging,
  snapping,
  expanded,
  onMeasure,
}: TableCardProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const { entity } = card;
  const Icon = KIND_ICON[entity.kind];
  const kindLabel = t(`table.kind.${entity.kind}`);
  const title =
    entity.title?.trim() || (entity.kind === "dictation" ? "" : t("table.card.untitled"));
  const excerpt = entity.excerpt
    ? plainExcerpt(entity.excerpt, expanded ? 600 : EXCERPT[entity.kind])
    : entity.kind === "chat"
      ? t("table.card.answerPending")
      : "";

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => onMeasure(card.key, el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [card.key, onMeasure]);

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      tabIndex={focusable ? 0 : -1}
      data-card-key={card.key}
      data-kind={entity.kind}
      data-dragging={dragging ? "true" : undefined}
      data-snapping={snapping ? "true" : undefined}
      aria-label={t("table.card.label", { kind: kindLabel, title: title || excerpt.slice(0, 60) })}
      className="table-card"
      style={{
        left: card.rect.x,
        top: card.rect.y,
        width: card.rect.w,
        zIndex: dragging ? 1000 : card.z,
      }}
    >
      <div className="table-card__kind">
        <Icon size={12} aria-hidden="true" />
        <span>{kindLabel}</span>
      </div>
      {title && <h3 className="table-card__title">{title}</h3>}
      {excerpt && <p className="table-card__excerpt">{excerpt}</p>}
      {(entity.durationMs != null || entity.participants.length > 0) && (
        <div className="table-card__meta">
          {entity.participants.length > 0 && (
            <span className="table-card__people" aria-hidden="true">
              {entity.participants.slice(0, 3).map((name) => (
                <span key={name} className="table-card__avatar">
                  {initials(name)}
                </span>
              ))}
            </span>
          )}
          {entity.durationMs != null && (
            <span>{formatMmSs(Math.round(entity.durationMs / 1000))}</span>
          )}
        </div>
      )}
    </div>
  );
}
