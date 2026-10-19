import { useTranslation } from "react-i18next";
import { Quote } from "lucide-react";
import type { MentionKind } from "../../utils/mentionMarkdown";

export type MentionPreviewState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error" }
  | { status: "ready"; title: string; meta: string | null; excerpt: string };

export function MentionPreview({
  kind,
  state,
  onOpen,
  onInsertQuote,
  onRetry,
}: {
  kind: MentionKind;
  state: MentionPreviewState;
  onOpen: () => void;
  onInsertQuote?: () => void;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="w-60 rounded-lg border border-border bg-popover p-3 text-start shadow-lg">
      {state.status === "loading" && (
        <p className="text-caption text-muted-foreground">{t("mention.loading")}</p>
      )}
      {state.status === "missing" && (
        <p className="text-caption text-muted-foreground">{t("mention.missing")}</p>
      )}
      {state.status === "error" && (
        <>
          <p className="text-caption text-muted-foreground">{t("mention.error")}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 rounded-sm text-ui text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("mention.retry")}
            </button>
          )}
        </>
      )}
      {state.status === "ready" && (
        <>
          <p dir="auto" className="truncate text-ui font-semibold text-foreground">
            {state.title}
          </p>
          {state.meta && <p className="text-caption text-muted-foreground">{state.meta}</p>}
          {state.excerpt && (
            <p
              dir="auto"
              className="mt-2 line-clamp-3 border-s-2 border-agent ps-2 text-caption text-foreground"
            >
              {state.excerpt}
            </p>
          )}
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={onOpen}
              className="rounded-sm text-ui text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("mention.open")}
            </button>
            {state.excerpt.trim() &&
              onInsertQuote &&
              (kind === "meeting" || kind === "dictation") && (
                <button
                  type="button"
                  onClick={onInsertQuote}
                  className="flex items-center gap-1 rounded-sm text-ui text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Quote size={12} aria-hidden />
                  {t("mention.insertQuote")}
                </button>
              )}
          </div>
        </>
      )}
    </div>
  );
}
