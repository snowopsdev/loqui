import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { cn } from "../../lib/utils";
import { groupSlashItems, type SlashItem } from "./slashItems";
import type { SuggestionHandle } from "./suggestionPopup";

export interface SlashMenuProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

export const SlashMenu = forwardRef<SuggestionHandle, SlashMenuProps>(function SlashMenu(
  { items, command },
  ref
) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [items]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected, items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") {
        setSelected((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[selected];
        if (item && !item.disabledReason) command(item);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="w-70 rounded-lg border border-border bg-popover p-3 text-ui text-muted-foreground shadow-lg">
        {t("notes.slash.empty")}
      </div>
    );
  }

  let index = -1;
  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={t("notes.slash.label")}
      className="max-h-80 w-70 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
    >
      {groupSlashItems(items).map(({ group, items: rows }) => (
        <div key={group} role="group" aria-label={t(`notes.slash.groups.${group}`)}>
          <div className="px-2 pb-1 pt-2 text-caption uppercase tracking-[0.06em] text-muted-foreground">
            {t(`notes.slash.groups.${group}`)}
          </div>
          {rows.map((item) => {
            index += 1;
            const rowIndex = index;
            const isSelected = rowIndex === selected;
            return (
              <div
                key={item.id}
                role="option"
                aria-selected={isSelected}
                aria-disabled={item.disabledReason ? true : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setSelected(rowIndex)}
                onClick={() => !item.disabledReason && command(item)}
                className={cn(
                  "flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-ui text-foreground",
                  isSelected && "bg-foreground/6",
                  item.disabledReason && "cursor-not-allowed"
                )}
              >
                {item.group === "ai" && <Sparkles size={14} aria-hidden className="text-ai" />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{item.label}</span>
                  {item.disabledReason && (
                    <span className="text-caption text-muted-foreground">
                      {item.disabledReason}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
});
