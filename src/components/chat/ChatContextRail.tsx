import { useTranslation } from "react-i18next";
import { FileText, Folder, Mic, Users, X } from "lucide-react";
import type { RailModel, PinnedContextItem } from "./contextRail";

const ICON = { note: FileText, meeting: Users, folder: Folder, dictation: Mic } as const;

export function ChatContextRail({
  model,
  onUnpin,
  onOpenNote,
}: {
  model: RailModel;
  onUnpin: (item: PinnedContextItem) => void;
  onOpenNote: (noteId: number) => void;
}) {
  const { t } = useTranslation();
  const heading = "text-caption font-bold uppercase tracking-[0.04em] text-muted-foreground";
  return (
    <aside
      aria-label={t("chat.rail.label")}
      className="flex w-full min-w-0 flex-col gap-4 overflow-y-auto border-s border-border px-3 py-3 text-caption dark:border-white/10"
    >
      <section>
        <h2 className={heading}>{t("chat.rail.inScope")}</h2>
        {model.pinned.length === 0 && model.found.length === 0 && (
          <p className="mt-1.5 text-muted-foreground">{t("chat.rail.emptyScope")}</p>
        )}
        <ul className="mt-1.5 flex flex-col gap-1">
          {model.pinned.map((item) => {
            const Icon = ICON[item.kind];
            return (
              <li
                key={`${item.kind}-${item.id}`}
                className="flex items-center gap-1.5 text-foreground"
              >
                <Icon size={12} aria-hidden className="shrink-0 text-muted-foreground" />
                <span dir="auto" className="flex-1 truncate">
                  {item.label}
                </span>
                <button
                  type="button"
                  onClick={() => onUnpin(item)}
                  aria-label={t("chat.rail.unpin", { label: item.label })}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X size={12} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
        {model.found.length > 0 && (
          <>
            <p className="mt-2 text-muted-foreground">{t("chat.rail.found")}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {model.found.map((item) => {
                const Icon = ICON[item.kind];
                return (
                  <li key={item.noteId}>
                    <button
                      type="button"
                      onClick={() => onOpenNote(item.noteId)}
                      className="flex w-full items-center gap-1.5 text-start text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Icon size={12} aria-hidden className="shrink-0 text-muted-foreground" />
                      <span dir="auto" className="truncate">
                        {item.title || t("notes.list.untitledNote")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      <section>
        <h2 className={heading}>{t("chat.rail.activity")}</h2>
        {model.activity.length === 0 ? (
          <p className="mt-1.5 text-muted-foreground">{t("chat.rail.noActivity")}</p>
        ) : (
          <ol className="mt-1.5 flex flex-col gap-1">
            {model.activity.map((step) => (
              <li key={step.key} className="flex gap-1.5 text-foreground">
                <span
                  aria-hidden
                  className={
                    step.status === "executing"
                      ? "text-agent-text"
                      : step.status === "error"
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }
                >
                  •
                </span>
                <span dir="auto" className="min-w-0 [overflow-wrap:anywhere]">
                  {step.label}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
