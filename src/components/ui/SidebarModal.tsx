import React from "react";
import { useTranslation } from "react-i18next";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { dialogEscapeClaimed } from "./escapeClaim";
import { X } from "../icons";
import { InfoBox } from "./InfoBox";
import { SettingsLayoutProvider } from "./useSettingsLayout";
import { useDismissGuard } from "./useDismissGuard";

import { SettingsNav, type SidebarItem } from "./SettingsNav";
export type { SidebarItem } from "./SettingsNav";
import { SettingsTitleBar } from "./SettingsTitleBar";

interface SidebarModalProps<T extends string> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  sidebarItems: SidebarItem<T>[];
  activeSection: T;
  onSectionChange: (section: T) => void;
  children: React.ReactNode;
  sidebarWidth?: string;
  version?: string;
  /** Rendered above the nav (hidden in compact mode), e.g. account identity. */
  header?: React.ReactNode;
  /** Full-width banner above every section, e.g. an organization-managed notice. */
  notice?: React.ReactNode;
  /** Sticky content-column footer, e.g. the route Apply bar. */
  footer?: React.ReactNode;
}

export default function SidebarModal<T extends string>({
  open,
  onOpenChange,
  title,
  sidebarItems,
  activeSection,
  onSectionChange,
  children,
  sidebarWidth = "w-52",
  version,
  header,
  notice,
  footer,
}: SidebarModalProps<T>) {
  const { t } = useTranslation();
  const { registerContent, shouldBlockDismiss } = useDismissGuard<HTMLDivElement>();

  const [isCompact, setIsCompact] = React.useState(false);
  const observerRef = React.useRef<ResizeObserver | null>(null);

  const containerRef = React.useCallback((el: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setIsCompact(width > 0 && width < 800);
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  const activeItem = sidebarItems.find((item) => item.id === activeSection);

  const actualSidebarWidth = isCompact ? "w-12" : sidebarWidth;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          data-settings-dialog=""
          ref={registerContent}
          // Radix focuses the first tabbable on open, which is the close button;
          // focus the dialog itself so the X doesn't open wearing a focus ring.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
          onEscapeKeyDown={(e) => {
            if (dialogEscapeClaimed(document)) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            // A dropdown open over this panel makes the panel inert, so the
            // click that closes the dropdown lands on the overlay and would
            // otherwise take the whole settings modal with it.
            if (shouldBlockDismiss(e)) e.preventDefault();
          }}
          className="fixed left-[50%] top-[50%] z-50 max-h-[85vh] w-[90vw] max-w-5xl translate-x-[-50%] translate-y-[-50%] rounded-xl p-0 overflow-hidden outline-none bg-background border border-border shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] dark:bg-surface-1 dark:border-border-subtle dark:shadow-[0_25px_60px_-12px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.05)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-98 data-[state=open]:zoom-in-98"
        >
          <div className="relative h-full max-h-[85vh] overflow-hidden">
            <div ref={containerRef} className="flex h-[85vh]">
              <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>

              {/* Sidebar */}
              <div
                className={`${actualSidebarWidth} shrink-0 border-e border-border/70 dark:border-border-subtle flex flex-col bg-surface-1 dark:bg-surface-0 transition-[width] duration-200 ease-out`}
              >
                {/* Identity / custom header */}
                {header && !isCompact && <div className="px-4 pt-5 pb-1">{header}</div>}

                {/* Navigation */}
                <SettingsNav
                  items={sidebarItems}
                  activeSection={activeSection}
                  onSectionChange={onSectionChange}
                  isCompact={isCompact}
                  ariaLabel={title}
                />

                {/* Footer / version */}
                {version && (
                  <div
                    className={`border-t border-border/70 dark:border-border-subtle ${
                      isCompact ? "flex justify-center py-2.5" : "px-3 py-2.5"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="h-1 w-1 rounded-full bg-success/60" />
                      {!isCompact && (
                        <span
                          dir="ltr"
                          className="text-xs text-muted-foreground/70 tabular-nums tracking-wide"
                        >
                          v{version}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Main Content */}
              <div className="flex-1 overflow-y-auto bg-background dark:bg-surface-1">
                <SettingsLayoutProvider value={{ isCompact }}>
                  <SettingsTitleBar
                    title={activeItem?.label ?? title}
                    compact={isCompact}
                    close={
                      <DialogPrimitive.Close className="grid h-8 w-8 shrink-0 place-items-center rounded-md opacity-70 outline-none transition-[opacity,background-color] duration-[var(--motion-fast)] hover:opacity-100 hover:bg-muted dark:hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
                        <X className="h-4 w-4 text-muted-foreground" />
                        <span className="sr-only">{t("common.close")}</span>
                      </DialogPrimitive.Close>
                    }
                  />
                  <div className={isCompact ? "px-4 pb-4" : "px-6 pb-6"}>
                    {notice && (
                      <InfoBox className="mb-6 flex items-center gap-2.5 rounded-lg px-4 py-3 text-sm text-primary">
                        {notice}
                      </InfoBox>
                    )}
                    {children}
                    {footer}
                  </div>
                </SettingsLayoutProvider>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
