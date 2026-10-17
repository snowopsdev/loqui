import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "../icons";

const isMac = () => typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export const SettingsSearchField = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (value: string) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    /** Clears a non-empty query and returns true. While one exists the field claims Escape (Task 10's escapeClaim). */
    onEscape: () => boolean;
  }
>(function SettingsSearchField({ value, onChange, onKeyDown, onEscape }, ref) {
  const { t } = useTranslation();
  return (
    <div className="relative" data-escape-active={value ? "true" : "false"}>
      <Search
        className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && onEscape()) {
            e.stopPropagation();
            return;
          }
          onKeyDown(e);
        }}
        placeholder={t("settingsSearch.placeholder")}
        aria-label={t("settingsSearch.placeholder")}
        aria-keyshortcuts="Meta+F Control+F /"
        autoComplete="off"
        className="h-8 w-full rounded-lg border border-input-border bg-background ps-8 pe-12 text-xs text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <kbd
        aria-hidden="true"
        dir="ltr"
        className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground"
      >
        {isMac() ? "⌘F" : "Ctrl F"}
      </kbd>
    </div>
  );
});
