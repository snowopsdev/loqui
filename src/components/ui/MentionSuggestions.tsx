import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import PersonAvatar from "./PersonAvatar";
import { cn } from "../lib/utils";
import { MENTION_GROUP_ORDER, type MentionResult } from "../../lib/mentionSearch";
import type { MentionKind } from "../../utils/mentionMarkdown";

export type MentionSuggestionItem = MentionResult;
export interface MentionSuggestionsProps {
  items: MentionSuggestionItem[];
  command: (item: MentionSuggestionItem) => void;
}
export interface MentionSuggestionsHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export function MentionMarker({
  kind,
  email,
  label,
}: {
  kind: MentionKind;
  email: string | null;
  label: string;
}) {
  if (kind === "person")
    return (
      <PersonAvatar
        email={email}
        displayName={label}
        size={18}
        initialFontSize={11}
        className="text-primary-foreground"
      />
    );
  const shape = {
    note: "size-2 rounded-[2px] border border-current text-muted-foreground",
    meeting: "size-[9px] rounded-[3px] bg-ai",
    dictation: "size-[7px] rounded-full bg-muted-foreground",
    folder: "h-[7px] w-2.5 rounded-[2px] border border-current text-muted-foreground",
  }[kind];
  return <span aria-hidden className={cn("inline-block shrink-0", shape)} />;
}

/** Options retain editor focus; the imperative ref owns the keyboard. */
const MentionSuggestions = forwardRef<MentionSuggestionsHandle, MentionSuggestionsProps>(
  function MentionSuggestions({ items, command }, ref) {
    const { t } = useTranslation();
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);
    useEffect(() => setSelectedIndex(0), [items]);
    useEffect(() => {
      listRef.current
        ?.querySelector('[aria-selected="true"]')
        ?.scrollIntoView?.({ block: "nearest" });
    }, [selectedIndex, items]);
    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: (event) => {
          if (!items.length) return false;
          if (event.key === "ArrowDown") {
            setSelectedIndex((i) => (i + 1) % items.length);
            return true;
          }
          if (event.key === "ArrowUp") {
            setSelectedIndex((i) => (i - 1 + items.length) % items.length);
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            const item = items[selectedIndex];
            if (item) command(item);
            return true;
          }
          return false;
        },
      }),
      [items, selectedIndex, command]
    );
    return (
      <div
        ref={listRef}
        role="listbox"
        aria-label={t("mention.pickerLabel")}
        className="w-[262px] max-h-[236px] overflow-y-auto rounded-md border border-border bg-popover p-1 text-foreground shadow-lg"
      >
        {!items.length && (
          <p className="px-2 py-2 text-caption text-muted-foreground">{t("mention.empty")}</p>
        )}
        {MENTION_GROUP_ORDER.map((kind) => {
          const rows = items.filter((item) => item.kind === kind);
          if (!rows.length) return null;
          return (
            <div key={kind} role="group" aria-label={t(`mention.groups.${kind}`)}>
              <p className="px-2 py-1 text-caption uppercase text-muted-foreground">
                {t(`mention.groups.${kind}`)}
              </p>
              {rows.map((item) => {
                const index = items.indexOf(item);
                return (
                  <div
                    key={item.key}
                    role="option"
                    aria-selected={index === selectedIndex}
                    data-kind={kind}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => command(item)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      "flex min-h-[30px] w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-start text-foreground",
                      index === selectedIndex && "bg-foreground/5"
                    )}
                  >
                    <MentionMarker kind={kind} email={item.email} label={item.label} />
                    <span className="min-w-0 flex-1">
                      <span dir="auto" className="block truncate text-ui">
                        {item.label}
                      </span>
                      {item.meta && (
                        <span
                          dir={kind === "person" ? "ltr" : "auto"}
                          className="block truncate text-caption text-muted-foreground"
                        >
                          {item.meta}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }
);
export default MentionSuggestions;
