import { memo, useCallback, useEffect, useLayoutEffect, useRef } from "react";
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
function TableCardContent({
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
  const contentRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sizedRef = useRef(false);
  sizedRef.current = card.fixedH != null;
  const updateOverflow = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;
    // The cue changes paint only. Keep it synchronous with actual layout without
    // scheduling another React commit for otherwise unchanged card content.
    if (sizedRef.current && content.scrollHeight > content.clientHeight)
      content.setAttribute("data-overflowing", "true");
    else content.removeAttribute("data-overflowing");
  }, []);
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

  // Prop-driven resize/cancel/content changes settle the paint cue before paint.
  // The stable observer also catches intrinsic wrapping/font/theme reflow.
  useLayoutEffect(updateOverflow, [
    card.fixedH,
    card.rect.w,
    title,
    excerpt,
    kindLabel,
    entity.durationMs,
    entity.participants,
    updateOverflow,
  ]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      onMeasure(card.key, el.offsetHeight);
      updateOverflow();
    });
    observer.observe(el);
    if (bodyRef.current) observer.observe(bodyRef.current);
    return () => observer.disconnect();
  }, [card.key, onMeasure, updateOverflow]);

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
      data-sized={card.fixedH != null ? "true" : undefined}
      aria-label={t("table.card.label", {
        kind: kindLabel,
        title: title || excerpt.slice(0, 60),
      })}
      className="table-card"
      style={{
        left: card.rect.x,
        top: card.rect.y,
        width: card.rect.w,
        zIndex: dragging ? 1000 : card.z,
        ...(card.fixedH != null ? { height: card.fixedH, overflow: "hidden" } : {}),
      }}
    >
      <div ref={contentRef} className="table-card__content">
        <div ref={bodyRef} className="table-card__body">
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
      </div>
      <span className="table-card__resize" data-resize-handle="" aria-hidden="true" />
    </div>
  );
}

// Reuse the text/metadata subtree while another card or the viewport moves.
export const TableCard = memo(TableCardContent, (previous, next) => {
  const a = previous.card;
  const b = next.card;
  return (
    a.key === b.key &&
    a.entity === b.entity &&
    a.z === b.z &&
    a.fixedH === b.fixedH &&
    a.rect.x === b.rect.x &&
    a.rect.y === b.rect.y &&
    a.rect.w === b.rect.w &&
    a.rect.h === b.rect.h &&
    previous.selected === next.selected &&
    previous.focusable === next.focusable &&
    previous.dragging === next.dragging &&
    previous.snapping === next.snapping &&
    previous.expanded === next.expanded &&
    previous.onMeasure === next.onMeasure
  );
});
