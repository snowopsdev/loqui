import React, { Fragment } from "react";
import type { SidebarMode } from "../lib/sidebarMode";
import { shortcutHint } from "../lib/workspaceShortcuts";
import { useTranslation } from "react-i18next";
import { ChevronLeft, PanelLeftClose, PanelLeftOpen, Search } from "./icons";
import { Button } from "./ui/button";
import WindowControls from "./WindowControls";
import { cn } from "./lib/utils";
import { getCachedPlatform } from "../utils/platform";

const platform = getCachedPlatform();

// Controls inside the drag region must opt out or the click starts a window drag.
const noDragStyle = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

const toggleIconClass =
  "text-muted-foreground group-hover:text-foreground transition-colors duration-(--motion-fast) ease-(--motion-ease-std) rtl:scale-x-[-1]";

interface ControlPanelTopBarProps {
  breadcrumb: string[];
  sidebarMode: SidebarMode;
  onToggleSidebar: () => void;
  onOpenSearch: () => void;
  /** Meeting mode or a narrow window with an open note: sidebar hidden, back button shown. */
  isSidePanelLayout: boolean;
  onExitSidePanel: () => void;
  /** Global actions, right of the search bar; hidden with it in the side-panel layout. */
  actions?: React.ReactNode;
}

export default function ControlPanelTopBar({
  breadcrumb,
  sidebarMode,
  onToggleSidebar,
  onOpenSearch,
  isSidePanelLayout,
  onExitSidePanel,
  actions,
}: ControlPanelTopBarProps) {
  const { t } = useTranslation();
  // With the sidebar out of the way the container's start edge sits under the
  // macOS traffic lights, so the leading controls shift past them.
  const clearTrafficLights = platform === "darwin" && sidebarMode !== "expanded";

  return (
    <header
      className={cn(
        // The trailing column never shrinks past its actions and window controls.
        "grid h-12 shrink-0 grid-cols-[minmax(120px,1fr)_minmax(0,340px)_minmax(max-content,1fr)] items-center gap-4 border-b border-border px-3 dark:border-white/10",
        "transition-[padding] duration-(--motion-base) ease-(--motion-ease-std) motion-reduce:transition-none",
        clearTrafficLights && (sidebarMode === "rail" ? "ltr:ps-5" : "ltr:ps-[76px]")
      )}
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {isSidePanelLayout ? (
          <Button
            variant="outline-flat"
            size="sm"
            onClick={onExitSidePanel}
            className="h-7 gap-1 px-2.5 ps-1.5"
            data-no-window-drag=""
            style={noDragStyle}
          >
            <ChevronLeft size={14} strokeWidth={1.8} className="rtl:rotate-180" />
            {t("controlPanel.backToNotes")}
          </Button>
        ) : (
          <>
            <button
              type="button"
              onClick={onToggleSidebar}
              aria-label={`${t(sidebarMode === "expanded" ? "sidebar.collapse" : "sidebar.expand")} ${shortcutHint("toggleSidebar", platform)}`}
              title={`${t(sidebarMode === "expanded" ? "sidebar.collapse" : "sidebar.expand")} ${shortcutHint("toggleSidebar", platform)}`}
              data-no-window-drag=""
              style={noDragStyle}
              className="group relative z-40 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg outline-none transition-colors duration-(--motion-fast) ease-(--motion-ease-std) motion-reduce:transition-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5"
            >
              {sidebarMode !== "expanded" ? (
                <PanelLeftOpen size={16} className={toggleIconClass} />
              ) : (
                <PanelLeftClose size={16} className={toggleIconClass} />
              )}
            </button>
            <nav
              aria-label={t("controlPanel.breadcrumb")}
              className="flex min-w-0 items-center gap-1.5"
            >
              {breadcrumb.slice(0, -1).map((crumb, index) => (
                <Fragment key={`${index}-${crumb}`}>
                  <span dir="auto" className="max-w-40 truncate text-ui text-muted-foreground">
                    {crumb}
                  </span>
                  <span aria-hidden className="text-ui text-muted-foreground">
                    /
                  </span>
                </Fragment>
              ))}
              <h1
                dir="auto"
                className="truncate text-ui! font-medium! leading-none! tracking-normal! text-foreground"
              >
                {breadcrumb.at(-1)}
              </h1>
            </nav>
          </>
        )}
      </div>

      {!isSidePanelLayout && (
        <button
          type="button"
          onClick={onOpenSearch}
          data-no-window-drag=""
          style={noDragStyle}
          className="flex h-8 w-full items-center gap-2.5 rounded-full border border-border bg-foreground/4 px-4 text-start outline-none transition-colors duration-(--motion-fast) ease-(--motion-ease-std) motion-reduce:transition-none hover:bg-foreground/6 focus-visible:ring-2 focus-visible:ring-ring dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/8"
        >
          <Search size={14} className="shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate text-ui text-muted-foreground">
            {t("commandSearch.placeholder")}
          </span>
          <kbd
            dir="ltr"
            className="shrink-0 rounded-full bg-foreground/6 px-1.5 py-px font-sans text-caption font-medium text-muted-foreground dark:bg-white/8"
          >
            {platform === "darwin" ? "⌘ + K" : "Ctrl + K"}
          </kbd>
        </button>
      )}

      <div className="col-start-3 flex items-center gap-2">
        {!isSidePanelLayout && actions && (
          <div
            data-no-window-drag=""
            style={noDragStyle}
            // macOS keeps no window controls here, so the actions take the far
            // end; elsewhere they sit beside the search, left of the controls.
            className={cn("flex items-center", platform === "darwin" && "ms-auto")}
          >
            {actions}
          </div>
        )}
        {platform !== "darwin" && (
          <div data-no-window-drag="" style={noDragStyle} className="ms-auto">
            <WindowControls />
          </div>
        )}
      </div>
    </header>
  );
}
