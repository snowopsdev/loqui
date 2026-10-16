import { ReactNode, useRef, useEffect, useLayoutEffect, useCallback, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ProviderIcon } from "./ProviderIcon";
import { nextEnabledTabIndex } from "./providerTabsKeys";
import type { ColorScheme as BaseColorScheme } from "../../utils/modelPickerStyles";
import { cn } from "../lib/utils";

export interface ProviderTabItem {
  id: string;
  name: string;
  recommended?: boolean;
  disabled?: boolean;
  disabledLabel?: string;
  keySaved?: boolean;
}

type ColorScheme = Exclude<BaseColorScheme, "blue"> | "dynamic";

interface ProviderTabsProps {
  providers: ProviderTabItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  renderIcon?: (providerId: string) => ReactNode;
  colorScheme?: ColorScheme;
  /** Wrap pills onto multiple lines when there are many providers */
  wrap?: boolean;
}

export function ProviderTabs({
  providers,
  selectedId,
  onSelect,
  renderIcon,
  colorScheme = "purple",
  wrap = false,
}: ProviderTabsProps) {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);

  const updateIndicator = useCallback(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;

    const selectedIndex = providers.findIndex((p) => p.id === selectedId);
    if (selectedIndex === -1) {
      indicator.style.opacity = "0";
      return;
    }

    const buttons = container.querySelectorAll<HTMLButtonElement>("[data-tab-button]");
    const selectedButton = buttons[selectedIndex];
    if (!selectedButton) return;

    const buttonRect = selectedButton.getBoundingClientRect();

    indicator.style.width = `${buttonRect.width}px`;
    indicator.style.height = `${buttonRect.height}px`;
    indicator.style.transform = `translate(${selectedButton.offsetLeft}px, ${selectedButton.offsetTop}px)`;
    indicator.style.opacity = "1";
  }, [providers, selectedId]);

  useLayoutEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  useEffect(() => {
    const observer = new ResizeObserver(() => updateIndicator());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateIndicator]);

  const selectedIndex = providers.findIndex((p) => p.id === selectedId && !p.disabled);
  const tabStopIndex = selectedIndex !== -1 ? selectedIndex : providers.findIndex((p) => !p.disabled);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      containerRef.current?.querySelectorAll<HTMLButtonElement>("[data-tab-button]") ?? []
    );
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1) return;
    const next = nextEnabledTabIndex(
      providers.map((p) => !!p.disabled),
      current,
      event.key,
      i18n?.dir?.() === "rtl" ? "rtl" : "ltr"
    );
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <div
      ref={containerRef}
      role="tablist"
      onKeyDown={handleKeyDown}
      className={cn("relative items-center gap-1 p-0.5", wrap ? "flex flex-wrap" : "inline-flex")}
    >
      <div
        ref={indicatorRef}
        aria-hidden="true"
        className="absolute top-0 left-0 rounded-full bg-primary/10 dark:bg-primary/15 ring-1 ring-primary/30 dark:ring-primary/25 transition-[width,height,transform,opacity] duration-[var(--motion-base)] ease-out pointer-events-none"
        style={{ opacity: 0 }}
      />

      {providers.map((provider, index) => {
        const isDisabled = !!provider.disabled;
        const isSelected = selectedId === provider.id && !isDisabled;

        return (
          <button
            key={provider.id}
            data-tab-button
            type="button"
            role="tab"
            aria-selected={isSelected}
            tabIndex={index === tabStopIndex ? 0 : -1}
            disabled={isDisabled}
            aria-disabled={isDisabled}
            title={isDisabled ? provider.disabledLabel : undefined}
            onClick={() => {
              if (isDisabled) return;
              onSelect(provider.id);
            }}
            className={cn(
              "relative z-10 flex items-center gap-1 px-2.5 py-1 rounded-full font-medium text-xs whitespace-nowrap transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isDisabled
                ? "text-muted-foreground/70 cursor-not-allowed ring-1 ring-border/40 dark:ring-white/5"
                : isSelected
                  ? "text-foreground [&_svg]:text-primary"
                  : "text-muted-foreground ring-1 ring-border/60 dark:ring-white/10 hover:text-foreground hover:bg-foreground/4 dark:hover:bg-white/5"
            )}
          >
            {renderIcon ? renderIcon(provider.id) : <ProviderIcon provider={provider.id} />}
            <span>{provider.name}</span>
            {provider.recommended && (
              <span className="text-[10px] text-primary/70 font-medium">
                {t("common.recommended")}
              </span>
            )}
            {isDisabled && provider.disabledLabel && (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                {provider.disabledLabel}
              </span>
            )}
            {provider.keySaved && (
              <>
                <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
                <span className="sr-only">{t("personal.keyConfigured")}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
