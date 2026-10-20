import { useCallback } from "react";
import { NoticeChip } from "./NoticeChip";
import { WordsFirstCard } from "./WordsFirstCard";
import { noticeLayout, raiseNotice, staggerIndex, useNotices, wordsNotices } from "./notices";

// Public API keeps the size selector beside its stack; it is also consumed by App.
// eslint-disable-next-line react-refresh/only-export-components
export function useNoticeWindowState(): { noticeCount: number; wordsCardVisible: boolean } {
  const list = useNotices();
  const wordsCardVisible = list.some((n) => !!n.words);
  return { noticeCount: list.filter((n) => !n.words).length, wordsCardVisible };
}

/**
 * Pill placement anchors the stack beside the pill on its inner side, newest
 * nearest the pill (column-reverse). Panel placement is a bottom-end stack.
 */
export function NoticeStack({
  placement,
  horizontalDirection = "right",
  primaryHotkeyLabel = null,
  bottomInset = 0,
}: {
  placement: "pill" | "panel";
  bottomInset?: number;
  horizontalDirection?: "left" | "right";
  /** Shown on the card's primary only while the global hotkey is actually held. */
  primaryHotkeyLabel?: string | null;
}) {
  const list = useNotices();
  // §5.3: at most three visible, the card counting as one. In the 168px pill
  // slot the card fills the space and chips queue behind it. Other held
  // transcripts are one "N more" press away, never dropped (R2-C3).
  const { card, moreWords, chips } = noticeLayout(list, placement);
  const showMore = useCallback(() => {
    const oldest = wordsNotices(list)[0];
    if (oldest) raiseNotice(oldest.id);
  }, [list]);
  const reportHeight = useCallback(
    (px: number) => {
      if (placement === "pill") void window.electronAPI?.resizeDictationErrorWindowToContent?.(px);
    },
    [placement]
  );
  if (!card && chips.length === 0) return null;
  return (
    <div
      style={placement === "panel" && bottomInset ? { bottom: bottomInset + 12 } : undefined}
      className="notice-stack"
      data-placement={placement}
      data-direction={horizontalDirection}
    >
      {card ? (
        <WordsFirstCard
          key={card.id}
          notice={card}
          onHeight={reportHeight}
          hotkeyLabel={primaryHotkeyLabel}
          moreCount={moreWords}
          onShowMore={showMore}
        />
      ) : null}
      {chips
        .slice()
        .reverse()
        .map((notice) => (
          <NoticeChip key={notice.id} notice={notice} stagger={staggerIndex(list, notice.id)} />
        ))}
    </div>
  );
}
