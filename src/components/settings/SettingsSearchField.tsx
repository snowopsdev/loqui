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
  // Chrome follows the interface direction; only the query chooses its content direction.
  // The label keeps whole-field click-to-focus; its inline input shares one wrapper edge/focus cue.
  return (
    <label
      className="flex h-8 w-full items-center gap-2 rounded-md border border-input-border bg-background px-2.5 transition-[background-color,border-color,color,box-shadow] duration-[var(--motion-fast)] ease-[var(--motion-ease-std)] focus-within:border-ring focus-within:bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background dark:bg-input dark:focus-within:bg-background"
      data-escape-active={value ? "true" : "false"}
    >
      <Search
        className="pointer-events-none h-3.5 w-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        dir="auto"
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
        className="input-inline h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-xs text-foreground placeholder:text-muted-foreground outline-none"
      />
      <kbd
        aria-hidden="true"
        dir="ltr"
        className="pointer-events-none shrink-0 font-mono text-[10px] text-muted-foreground"
      >
        {isMac() ? "⌘F" : "Ctrl F"}
      </kbd>
    </label>
  );
});
