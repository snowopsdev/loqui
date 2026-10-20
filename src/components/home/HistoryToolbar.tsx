import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import { HOME_FILTERS, type HomeFilter } from "../../stores/homeViewStore";

export interface HistoryToolbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  filter: HomeFilter;
  onFilterChange: (filter: HomeFilter) => void;
  counts: Record<HomeFilter, number>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  menu: React.ReactNode;
}

export function HistoryToolbar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  counts,
  inputRef,
  menu,
}: HistoryToolbarProps) {
  const { t } = useTranslation();
  return (
    <div className="mb-2 flex min-h-10 flex-wrap items-center gap-2">
      <label className="flex h-8 min-w-48 flex-1 items-center gap-2 rounded-lg border border-input-border px-2.5 focus-within:ring-2 focus-within:ring-ring @min-[640px]:flex-none">
        <Search size={14} aria-hidden className="text-muted-foreground" />
        <input
          ref={inputRef}
          dir="auto"
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label={t("home.history.filterLabel")}
          placeholder={t("home.history.filterPlaceholder")}
          className="input-inline min-w-0 flex-1 appearance-none border-0 p-0 bg-transparent text-ui text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <kbd dir="ltr" className="text-caption text-muted-foreground">
          /
        </kbd>
      </label>
      <div
        role="group"
        aria-label={t("home.history.chipsLabel")}
        className="flex flex-wrap items-center gap-1.5"
      >
        {HOME_FILTERS.map((value) => {
          const selected = filter === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              onClick={() => onFilterChange(value)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-caption font-semibold focus-visible:ring-2 focus-visible:ring-ring",
                selected ? "bg-foreground text-background" : "text-foreground hover:bg-foreground/6"
              )}
            >
              {t(`home.history.chips.${value}`)}
              {value === "failed" && counts.failed > 0 && (
                <span
                  data-failed-count={counts.failed}
                  className={cn(
                    "min-w-4 rounded-full px-1 text-micro text-foreground",
                    selected ? "bg-background" : "bg-destructive/15"
                  )}
                >
                  {counts.failed}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="ms-auto">{menu}</div>
    </div>
  );
}
