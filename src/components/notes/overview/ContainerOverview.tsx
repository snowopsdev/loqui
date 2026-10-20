import { useChatRouteKey } from "../../chat/chatRouteKey";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "../../icons";

import { useContainerChat } from "../../../hooks/useContainerChat";
import {
  useFolderCounts,
  useFolders,
  useNotes,
  useNotesByContainer,
  useSpaceRootCounts,
} from "../../../stores/noteStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import TableView from "../../table/TableView";
import type { FolderItem, NoteItem, SpaceItem } from "../../../types/electron";
import { cn } from "../../lib/utils";
import { PAGE_CONTENT_WIDTH_CLASS } from "../../ui/pageWidth";
import { defaultFolderDisplayName } from "../shared";
import { ContainerIcon } from "./ContainerIcon";
import { OverviewAskSection } from "./OverviewAskSection";
import { OverviewExplainerBanner } from "./OverviewExplainerBanner";
import { OverviewNoteList } from "./OverviewNoteList";
import { SpaceIconButton } from "./SpaceIconButton";

const SPACE_NOTES_LIMIT = 50;

type OverviewView = "list" | "table";
const viewStorageKey = (spaceId: number) => `notes.overview.view.${spaceId}`;
const readView = (spaceId: number): OverviewView =>
  typeof localStorage !== "undefined" && localStorage.getItem(viewStorageKey(spaceId)) === "table"
    ? "table"
    : "list";

export function TableViewSwitch({
  value,
  onChange,
}: {
  value: OverviewView;
  onChange: (value: OverviewView) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("table.view.label")}
      className="inline-flex rounded-full bg-surface-3 p-0.5"
    >
      {(["list", "table"] as const).map((next) => (
        <button
          key={next}
          type="button"
          aria-pressed={value === next}
          onClick={() => onChange(next)}
          className={cn(
            "h-7 rounded-full px-3 text-ui font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === next
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t(`table.view.${next}`)}
        </button>
      ))}
    </div>
  );
}

interface ContainerOverviewProps {
  space: SpaceItem;
  folder: FolderItem | null;
  onOpenNote: (noteId: number) => void;
  onNewNote: () => void;
  onAddExisting?: () => void;
}

export function ContainerOverview({
  space,
  folder,
  onOpenNote,
  onNewNote,
  onAddExisting,
}: ContainerOverviewProps) {
  const { t } = useTranslation();

  const folders = useFolders();
  const containerNotes = useNotes();
  const notesByContainer = useNotesByContainer();
  const folderCounts = useFolderCounts();
  const spaceRootCounts = useSpaceRootCounts();
  const [spaceNotes, setSpaceNotes] = useState<NoteItem[] | null>(null);
  const labsTable = useSettingsStore((s) => s.labsTable);
  // PersonalNotesView remounts this overview for each Space/folder owner.
  const [view, setView] = useState<OverviewView>(() => readView(space.id));
  const tableAvailable = labsTable && folder === null;
  const changeView = (next: OverviewView) => {
    setView(next);
    localStorage.setItem(viewStorageKey(space.id), next);
  };
  const viewSwitch = tableAvailable ? <TableViewSwitch value={view} onChange={changeView} /> : null;

  // Folder overviews mirror the store's active container; space overviews list
  // the whole space (foldered + root), which the store doesn't hold — fetched
  // here and refreshed whenever any container's notes change.
  useEffect(() => {
    if (folder) return;
    let stale = false;
    window.electronAPI
      .getSpaceNotes(space.id, SPACE_NOTES_LIMIT)
      .then((rows) => {
        if (!stale) setSpaceNotes(rows ?? []);
      })
      .catch(() => {
        if (!stale) setSpaceNotes([]);
      });
    return () => {
      stale = true;
    };
  }, [folder, space.id, notesByContainer]);

  const notes = folder ? containerNotes : (spaceNotes ?? []);

  const chat = useContainerChat({ space, folder, notes });
  const routeKey = useChatRouteKey("chatIntelligence");

  const spaceFolders = useMemo(
    () => folders.filter((f) => f.space_id === space.id),
    [folders, space.id]
  );
  // DB-backed counts, as in SpacesTree: the visible list is capped at the
  // container page size, so notes.length undercounts large containers.
  const noteCount = folder
    ? (folderCounts[folder.id] ?? notes.length)
    : spaceFolders.reduce((sum, f) => sum + (folderCounts[f.id] ?? 0), 0) +
      (spaceRootCounts[space.id] ?? 0);

  const metaParts: string[] = [];

  if (!folder && spaceFolders.length > 0) {
    metaParts.push(t("notes.overview.meta.folders", { count: spaceFolders.length }));
  }
  metaParts.push(t("notes.spaces.noteCount", { count: noteCount }));
  if (space.kind === "team" && space.member_count != null) {
    metaParts.push(t("notes.overview.meta.members", { count: space.member_count }));
  }

  if (tableAvailable && view === "table") {
    return <TableView space={space} onOpenNote={onOpenNote} viewSwitch={viewSwitch} />;
  }

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className={cn(PAGE_CONTENT_WIDTH_CLASS, "px-6 py-8 flex flex-col gap-5")}>
        <div className="flex flex-col items-center text-center gap-2 pt-4">
          <div className="h-12 w-12 rounded-xl bg-foreground/4 dark:bg-white/5 border border-border/70 dark:border-white/10 flex items-center justify-center mb-1">
            {folder ? (
              <ContainerIcon space={space} folder={folder} size={20} />
            ) : (
              <SpaceIconButton space={space} size={20} />
            )}
          </div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            {folder ? defaultFolderDisplayName(folder, t) : space.name}
          </h1>
          <p className="text-[13px] text-foreground/50 dark:text-foreground/45">
            {t(`notes.overview.subtitle.${space.kind === "team" ? "team" : "private"}`)}
          </p>
          <p className="text-xs text-foreground/45 dark:text-foreground/45">
            {metaParts.join(" · ")}
          </p>
          <div className="mt-1 flex items-center gap-2">
            {viewSwitch}
            {/* The empty state keeps its own focal create CTA in the list. */}
            {notes.length > 0 && (
              <button
                onClick={onNewNote}
                className="inline-flex items-center gap-1.5 px-3 h-7 rounded-md border border-border/70 dark:border-white/10 text-xs font-medium text-foreground/60 hover:text-foreground/85 hover:border-border/70 hover:bg-foreground/3 dark:hover:bg-white/3 transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/30"
              >
                <Plus size={12} />
                {t("notes.list.newNote")}
              </button>
            )}
          </div>
        </div>

        <OverviewExplainerBanner kind={space.kind === "team" ? "team" : "private"} />

        <OverviewAskSection
          messages={chat.messages}
          agentState={chat.agentState}
          onTextSubmit={chat.sendMessage}
          queueKey={`container|${space.id}|${folder?.id ?? "root"}|${chat.activeConversationId ?? "new"}|${routeKey}`}
          onCancel={chat.cancelStream}
          conversations={chat.conversations}
          activeConversationId={chat.activeConversationId}
          onSwitchConversation={chat.switchConversation}
          onNewChat={chat.startNewChat}
          onOpenNote={onOpenNote}
        />

        <div className="border-t border-border/70 dark:border-white/10">
          <OverviewNoteList
            notes={notes}
            space={space}
            onOpenNote={onOpenNote}
            onNewNote={onNewNote}
            onAddExisting={onAddExisting}
          />
        </div>
      </div>
    </div>
  );
}
