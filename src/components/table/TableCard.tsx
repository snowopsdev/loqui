import { memo, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, MessageSquare, Mic, NotebookPen } from "../icons";
import { sameTableCard, type TableCardProps } from "./tableCardIdentity";
import { tableCardContent } from "./tableCardContent";
export type { TableCardProps } from "./tableCardIdentity";

const KIND_ICON = {
  note: NotebookPen,
  meeting: CalendarDays,
  dictation: Mic,
  chat: MessageSquare,
} as const;
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
  onNode,
  observe,
}: TableCardProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sizedRef = useRef(false);
  sizedRef.current = card.fixedH != null;
  const updateOverflow = useCallback((fixed?: boolean) => {
    if (fixed !== undefined) sizedRef.current = fixed;
    const content = contentRef.current;
    if (!content) return;
    // The cue changes paint only. Keep it synchronous with actual layout without
    // scheduling another React commit for otherwise unchanged card content.
    if ((fixed ?? sizedRef.current) && content.scrollHeight > content.clientHeight)
      content.setAttribute("data-overflowing", "true");
    else content.removeAttribute("data-overflowing");
  }, []);
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      ref.current = node;
      onNode?.(card.key, node, updateOverflow);
    },
    [card.key, onNode, updateOverflow]
  );
  const { entity } = card;
  const Icon = KIND_ICON[entity.kind];
  const { kindLabel, title, excerpt, label, duration, participants } = tableCardContent(
    card,
    expanded,
    t
  );

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
    let active = true;
    const measure = () => {
      if (!active) return;
      onMeasure(card.key, el.offsetHeight);
      updateOverflow();
    };
    if (observe) {
      const stop = observe(el, bodyRef.current, measure);
      return () => {
        active = false;
        stop();
      };
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (bodyRef.current) observer.observe(bodyRef.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [card.key, onMeasure, updateOverflow, observe]);

  return (
    <div
      ref={attach}
      role="option"
      aria-selected={selected}
      tabIndex={focusable ? 0 : -1}
      data-card-key={card.key}
      data-kind={entity.kind}
      data-dragging={dragging ? "true" : undefined}
      data-snapping={snapping ? "true" : undefined}
      data-sized={card.fixedH != null ? "true" : undefined}
      aria-label={label}
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
                  {entity.participants.slice(0, 3).map((name, index) => (
                    <span key={name} className="table-card__avatar">
                      {participants[index]}
                    </span>
                  ))}
                </span>
              )}
              {entity.durationMs != null && <span>{duration}</span>}
            </div>
          )}
        </div>
      </div>
      <span className="table-card__resize" data-resize-handle="" aria-hidden="true" />
    </div>
  );
}

// Reuse the text/metadata subtree while another card or the viewport moves.
export const TableCard = memo(TableCardContent, sameTableCard);
