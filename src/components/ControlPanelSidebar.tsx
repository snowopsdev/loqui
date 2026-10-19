import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Settings } from "./icons";
import { LoquiBrand } from "./LoquiBrand";
import { Tooltip } from "./ui/tooltip";
import { cn } from "./lib/utils";
import { MicStatusCard, CaptureRail } from "./MicStatusCard";
import SpacesTree from "./notes/SpacesTree";
import { useControlPanelNavItems, type ControlPanelView } from "./controlPanelNav";
import { useWorkspaceNavigation } from "./workspaceNavigation";
import { useLiveClock, type CaptureStatusModel } from "../hooks/useCaptureStatus";
import { useCreateNote } from "../hooks/useCreateNote";
import { useHotkey } from "../hooks/useHotkey";
import { useNoteTreeActions } from "../hooks/useNoteTreeActions";
import { useRecentNotes } from "../hooks/useRecentNotes";
import { ROUTE_IDS, useResolvedRoutes } from "../lib/routes";
import { captureRouteIds } from "../lib/captureStatus";
import { shortcutHint } from "../lib/workspaceShortcuts";
import type { SidebarMode } from "../lib/sidebarMode";
import { formatHotkeyLabel, parseHotkeyList } from "../utils/hotkeys";
import { getCachedPlatform } from "../utils/platform";

interface Props {
  mode: SidebarMode;
  capture: CaptureStatusModel;
  activeView: ControlPanelView;
  onViewChange: (view: ControlPanelView) => void;
  onOpenSettings: (section?: string) => void;
}

const RECENT_LIMIT = 4;

export default function ControlPanelSidebar({
  mode,
  capture,
  activeView,
  onViewChange,
  onOpenSettings,
}: Props) {
  const { t } = useTranslation();
  const platform = getCachedPlatform();
  const isMac = platform === "darwin";
  const rail = mode === "rail";
  const navItems = useControlPanelNavItems();
  const navigation = useWorkspaceNavigation();
  // Lifecycle selects the configured route category. During active capture,
  // MicStatusCard labels this configuration as Next capture (R2).
  const routes = useResolvedRoutes();
  const ids = captureRouteIds(capture);
  const routeFor = (id: (typeof ROUTE_IDS)[number]) => routes[ROUTE_IDS.indexOf(id)];
  const route = routeFor(ids.speech);
  const textRoute = ids.text ? routeFor(ids.text) : null;
  const { hotkey } = useHotkey();
  const treeActions = useNoteTreeActions();
  const { createNoteIn } = useCreateNote();
  const recent = useRecentNotes(RECENT_LIMIT);
  const now = useLiveClock(capture.kind === "listening");

  const row = (item: (typeof navItems)[number]) => {
    const isActive = activeView === item.id;
    const Icon = item.icon;
    const hint = item.shortcut ? ` ${shortcutHint(item.shortcut, platform)}` : "";
    return (
      <Tooltip key={item.id} content={`${item.label}${hint}`}>
        <button
          type="button"
          onClick={() => onViewChange(item.id)}
          aria-current={isActive ? "page" : undefined}
          aria-label={rail ? item.label : undefined}
          className={cn(
            "group relative flex h-9 items-center gap-2.5 rounded-md text-ui text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            rail ? "mx-auto w-10 justify-center" : "w-full px-2.5",
            isActive && "bg-foreground/7 text-foreground dark:bg-white/8"
          )}
        >
          <span
            aria-hidden
            className={cn(
              "absolute start-0 top-2 bottom-2 w-0.5 rounded-full bg-nav-marker opacity-0",
              isActive && "opacity-100"
            )}
          />
          <Icon size={16} className={isActive ? "text-nav-marker" : undefined} />
          {!rail && <span className="truncate">{item.label}</span>}
        </button>
      </Tooltip>
    );
  };

  const section = (labelKey: string, children: React.ReactNode) => (
    <div className="flex flex-col gap-0.5">
      {!rail && (
        <div className="px-2.5 pb-1 text-caption font-semibold text-muted-foreground">
          {t(labelKey)}
        </div>
      )}
      {children}
    </div>
  );

  return (
    <div className="relative flex h-full flex-col bg-surface-window" style={{ width: "100%" }}>
      <div
        className={cn("shrink-0 flex items-end gap-2 px-3 pb-2.5", isMac ? "h-20" : "h-12")}
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {!rail && <LoquiBrand variant="wordmark" />}
      </div>

      <nav
        aria-label={t("sidebar.navigation")}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pt-1"
      >
        <div className="flex flex-col gap-0.5">
          {navItems.filter((i) => i.section === "primary").map(row)}
        </div>

        {!rail &&
          section(
            "sidebar.sections.spaces",
            <SpacesTree
              onOpenNote={navigation.openNote}
              onDeleteNote={treeActions.onDeleteNote}
              onMoveNote={treeActions.onMoveNote}
              onCreateFolderAndMove={treeActions.onCreateFolderAndMove}
              onNewNote={(spaceId, folderId) => {
                void createNoteIn(spaceId, folderId);
                onViewChange("personal-notes");
              }}
              onNavigate={() => onViewChange("personal-notes")}
            />
          )}

        {!rail &&
          recent.length > 0 &&
          section(
            "sidebar.sections.recent",
            recent.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => navigation.openNote(note.id)}
                className="h-7 truncate rounded-md px-2.5 text-start text-ui text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span dir="auto">{note.title || t("notes.list.untitledNote")}</span>
              </button>
            ))
          )}

        {section(
          "sidebar.sections.voice",
          <Fragment>{navItems.filter((i) => i.section === "voice").map(row)}</Fragment>
        )}
      </nav>

      <div className="shrink-0 pt-2">
        <MicStatusCard
          status={capture}
          now={now}
          hotkeyLabel={formatHotkeyLabel(parseHotkeyList(hotkey)[0])}
          role={ids.role}
          route={route}
          textRoute={textRoute}
          compact={rail}
          onOpenSettings={() => onOpenSettings(route.settingsPath)}
        />
        <button
          type="button"
          onClick={() => onOpenSettings()}
          aria-label={rail ? t("sidebar.settings") : undefined}
          className={cn(
            "mb-2 flex h-9 items-center gap-2.5 rounded-md text-ui text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            rail ? "mx-auto w-10 justify-center" : "mx-2 px-2.5"
          )}
        >
          <Settings size={16} />
          {!rail && t("sidebar.settings")}
        </button>
      </div>

      <CaptureRail status={capture} readLevel={capture.readLevel} />
    </div>
  );
}
