import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "../icons";
import { TechnicalErrorDetails } from "./TechnicalErrorDetails";
import { Button } from "./button";
import { useCopyFeedback } from "../../hooks/useCopyFeedback";
import { dismissNotice, runNoticeAction, type Notice } from "./notices";

/**
 * VO-R6 B: the card *is* the transcript. The error is a one-line chip above
 * the recovered words; the words are selectable and draggable straight into
 * the target field. Primary actions use the ink Button (D1: orange is for
 * voice controls only). Only Dismiss, or an action that delivered the words,
 * removes the card; Copy never does.
 */
export function WordsFirstCard({
  notice,
  onHeight,
  hotkeyLabel = null,
  moreCount = 0,
  onShowMore,
}: {
  notice: Notice;
  onHeight?: (px: number) => void;
  hotkeyLabel?: string | null;
  moreCount?: number;
  onShowMore?: () => void;
}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLElement>(null);
  const words = notice.words ?? "";
  const live = useRef(true);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const currentNotice = useRef(notice);
  currentNotice.current = notice;
  // "Copied" only after a clipboard confirmed the write (R2-I3).
  const { copied, copyText, confirmCopied } = useCopyFeedback(words, { resetMs: 1200 });
  const [copyFailed, setCopyFailed] = useState(false);

  useLayoutEffect(() => {
    const card = rootRef.current;
    if (!card || !onHeight) return;
    let lastHeight = 0;
    const measure = () => {
      const height = Math.ceil(Math.max(card.offsetHeight, card.scrollHeight));
      if (height > 0 && height !== lastHeight) {
        lastHeight = height;
        onHeight(height);
      }
    };
    measure();
    card.addEventListener("toggle", measure, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(card);
    return () => {
      card.removeEventListener("toggle", measure, true);
      observer?.disconnect();
    };
  }, [words, notice.title, notice.details, copyFailed, moreCount, onHeight]);

  const copy = async () => {
    const ok = await copyText(words);
    if (!live.current || currentNotice.current !== notice) return;
    setCopyFailed(!ok);
    if (ok) confirmCopied(words);
  };
  const copyState = copyFailed ? "failed" : copied ? "copied" : "idle";

  return (
    <section ref={rootRef} className="words-card" role="alert" aria-live="assertive">
      <span className="words-card__chip">
        <AlertTriangle size={11} aria-hidden="true" />
        {notice.body ? `${notice.title} · ${notice.body}` : notice.title}
      </span>
      <p
        className="words-card__words"
        dir="auto"
        draggable="true"
        title={t("notices.wordsCard.dragHint")}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", words);
          e.dataTransfer.effectAllowed = "copy";
          e.currentTarget.classList.add("is-drag");
        }}
        onDragEnd={(e) => e.currentTarget.classList.remove("is-drag")}
      >
        {words}
      </p>
      <div className="words-card__actions">
        {(notice.actions ?? []).map((action) => (
          <Button
            key={action.label}
            size="sm"
            variant={action.primary ? "default" : "outline"}
            disabled={notice.busy}
            onClick={() => void runNoticeAction(notice.id, action)}
          >
            {action.label}
            {action.primary && hotkeyLabel ? (
              <kbd className="words-card__kbd">{hotkeyLabel}</kbd>
            ) : null}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          data-copy=""
          data-copy-state={copyState}
          onClick={() => void copy()}
        >
          {copyState === "failed"
            ? t("notices.wordsCard.copyFailed")
            : copyState === "copied"
              ? t("notices.wordsCard.copied")
              : t("notices.wordsCard.copy")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dismissNotice(notice.id)}>
          {t("notices.dismiss")}
        </Button>
      </div>
      {copyFailed ? (
        <p className="words-card__copy-failed">{t("notices.wordsCard.copyFailedHint")}</p>
      ) : null}
      {moreCount > 0 && onShowMore ? (
        <button type="button" className="words-card__more" onClick={onShowMore}>
          {t("notices.wordsCard.more", { count: moreCount })}
        </button>
      ) : null}
      <TechnicalErrorDetails details={notice.details} />
      <p className="words-card__hint">{t("notices.wordsCard.hint")}</p>
    </section>
  );
}
