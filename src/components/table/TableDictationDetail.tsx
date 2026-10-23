import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/button";

/** Full text is read on demand from main; board excerpts and sizing stay bounded. */
export function TableDictationDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const root = useRef<HTMLElement>(null);
  const [detail, setDetail] = useState<{ text: string; failed: boolean } | null>(null);
  useEffect(() => {
    let current = true;
    const previousFocus = document.activeElement as HTMLElement | null;
    root.current?.focus();
    void (async () => {
      try {
        const item = await window.electronAPI?.getTranscriptionById?.(id);
        if (current)
          setDetail(item ? { text: item.text, failed: false } : { text: "", failed: true });
      } catch {
        if (current) setDetail({ text: "", failed: true });
      }
    })();
    return () => {
      current = false;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [id]);
  return (
    <section
      ref={root}
      className="table-detail"
      role="region"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="table-detail__head">
        <h2 id={titleId}>{t("table.kind.dictation")}</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t("table.detail.close")}
        </Button>
      </div>
      {!detail || detail.failed ? (
        <p role="status">{t(detail?.failed ? "table.detail.failed" : "table.detail.loading")}</p>
      ) : (
        <p className="table-detail__text">{detail.text}</p>
      )}
    </section>
  );
}
