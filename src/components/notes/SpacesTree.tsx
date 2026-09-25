import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDialogs } from "../../hooks/useDialogs";
import { useNoteDragAndDrop, type NoteMoveTarget } from "../../hooks/useNoteDragAndDrop";
import {
  createFolder,
  deleteFolder,
  folderContainerKey,
  navigateToContainer,
  renameFolder,
  setActiveNoteId,
  setContainerExpanded,
  spaceContainerKey,
  toggleContainerExpanded,
  useActiveContext,
  useActiveNoteId,
  useExpandedContainers,
  useFolders,
  useNotesByContainer,
  useSpaces,
} from "../../stores/noteStore";
import { ChevronRight, FileText, Folder, MoreHorizontal, Plus } from "../icons";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { useToast } from "../ui/useToast";
import { defaultFolderDisplayName } from "./shared";
import { treeHorizontalIntent, treeRowActionClearanceStyle } from "./treeDirection";

interface Props {
  onDeleteNote: (id: number) => void;
  onMoveNote: (noteId: number, target: NoteMoveTarget) => Promise<void>;
  onCreateFolderAndMove: (noteId: number, folderName: string) => void;
  onNewNote: (spaceId: number, folderId: number | null) => void;
}

/** All folders and notes belong to the single SQLite personal workspace. */
export default function SpacesTree({
  onDeleteNote,
  onMoveNote,
  onCreateFolderAndMove,
  onNewNote,
}: Props) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const spaces = useSpaces();
  const folders = useFolders();
  const notes = useNotesByContainer();
  const expanded = useExpandedContainers();
  const context = useActiveContext();
  const activeNoteId = useActiveNoteId();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [moveAfterCreate, setMoveAfterCreate] = useState<number | null>(null);
  const { confirmDialog, showConfirmDialog, hideConfirmDialog } = useDialogs();
  const { dragState, noteDragHandlers, dropTargetHandlers } = useNoteDragAndDrop({
    untitledLabel: t("notes.editor.untitled"),
    onMoveToTarget: onMoveNote,
    onCrossSpaceDrop: (_note, _target, commit) => commit(),
    onHoverTarget: (key) => setContainerExpanded(key, true),
  });
  const space = spaces.find((item) => item.kind === "private");
  if (!space) return null;
  const personalFolders = folders.filter((folder) => folder.space_id === space.id);
  const reportError = (error: unknown) =>
    toast({ title: t("common.error"), description: String(error), variant: "destructive" });
  const startCreate = (noteId: number | null = null) => {
    setEditing("new");
    setDraft("");
    setMoveAfterCreate(noteId);
  };
  const commit = async () => {
    if (!draft.trim()) return;
    try {
      if (editing === "new" && moveAfterCreate != null) {
        onCreateFolderAndMove(moveAfterCreate, draft.trim());
      } else {
        const result =
          editing === "new"
            ? await createFolder(draft.trim(), space.id)
            : editing != null
              ? await renameFolder(editing, draft.trim())
              : null;
        if (result && !result.success) throw new Error(result.error || t("common.error"));
      }
      setEditing(null);
      setDraft("");
      setMoveAfterCreate(null);
    } catch (error) {
      reportError(error);
    }
  };
  const deleteLocalFolder = async (id: number) => {
    try {
      const result = await deleteFolder(id);
      if (!result.success) throw new Error(result.error || t("common.error"));
    } catch (error) {
      reportError(error);
    }
  };
  const containerKeys = (e: React.KeyboardEvent, key: string) => {
    const intent = treeHorizontalIntent(e.key, i18n.dir());
    if (intent) {
      e.preventDefault();
      setContainerExpanded(key, intent === "inward");
    }
  };
  const renderNotes = (key: string) =>
    (notes[key] ?? []).map((note) => {
      const title = note.title || t("notes.editor.untitled");
      return (
        <div
          key={note.id}
          title={title}
          className="group relative flex items-center ps-5"
          style={treeRowActionClearanceStyle(1)}
          {...noteDragHandlers({
            id: note.id,
            title,
            folderId: note.folder_id ?? null,
            spaceId: space.id,
          })}
        >
          <button
            onClick={() => setActiveNoteId(note.id)}
            className={`flex flex-1 min-w-0 gap-2 items-center py-1.5 text-xs text-start ${activeNoteId === note.id ? "text-primary" : "text-muted-foreground"}`}
          >
            <FileText size={13} />
            <span dir="auto" className="truncate">
              {title}
            </span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="absolute end-1 p-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
                aria-label={t("personal.moreActions")}
              >
                <MoreHorizontal size={13} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {note.folder_id != null && (
                <DropdownMenuItem
                  onSelect={() => void onMoveNote(note.id, { spaceId: space.id, folderId: null })}
                >
                  {t("notes.spaces.personal")}
                </DropdownMenuItem>
              )}
              {personalFolders
                .filter((folder) => folder.id !== note.folder_id && !folder.is_default)
                .map((folder) => (
                  <DropdownMenuItem
                    key={folder.id}
                    onSelect={() =>
                      void onMoveNote(note.id, { spaceId: space.id, folderId: folder.id })
                    }
                  >
                    <Folder size={13} />
                    <span dir="auto">{defaultFolderDisplayName(folder, t)}</span>
                  </DropdownMenuItem>
                ))}
              <DropdownMenuItem onSelect={() => startCreate(note.id)}>
                {t("notes.context.newFolder")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onDeleteNote(note.id)}>
                {t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    });
  const rootKey = spaceContainerKey(space.id);
  return (
    <div className="px-2 py-3 text-sm">
      <div
        className={`group flex items-center rounded-md ${dragState.dragOverKey === rootKey ? "bg-primary/10" : ""}`}
        {...dropTargetHandlers({ spaceId: space.id, folderId: null })}
      >
        <button
          onClick={() => toggleContainerExpanded(rootKey)}
          aria-expanded={expanded.has(rootKey)}
          aria-label={t("notes.spaces.personal")}
          className="p-1"
        >
          <ChevronRight
            size={13}
            className={expanded.has(rootKey) ? "rotate-90" : "rtl:rotate-180"}
          />
        </button>
        <button
          className="flex-1 text-start py-2"
          onKeyDown={(e) => containerKeys(e, rootKey)}
          onClick={() => {
            navigateToContainer(space.id, null);
            setContainerExpanded(rootKey, true);
          }}
        >
          {t("notes.spaces.personal")}
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={t("notes.context.newFolder")}
          onClick={() => startCreate()}
        >
          <Plus size={14} />
        </Button>
      </div>
      {expanded.has(rootKey) && (
        <>
          {renderNotes(rootKey)}
          {personalFolders.map((folder) => {
            const key = folderContainerKey(folder.id);
            const displayName = defaultFolderDisplayName(folder, t);
            return (
              <div key={folder.id}>
                <div
                  className={`group flex items-center rounded-md ${dragState.dragOverKey === key ? "bg-primary/10" : context?.folderId === folder.id ? "bg-primary/8" : "hover:bg-accent"}`}
                  {...dropTargetHandlers({
                    spaceId: space.id,
                    folderId: folder.id,
                    folderName: folder.name,
                    isDefaultFolder: !!folder.is_default,
                  })}
                >
                  <button
                    onClick={() => toggleContainerExpanded(key)}
                    aria-expanded={expanded.has(key)}
                    aria-label={displayName}
                    className="p-1"
                  >
                    <ChevronRight
                      size={13}
                      className={expanded.has(key) ? "rotate-90" : "rtl:rotate-180"}
                    />
                  </button>
                  <button
                    onClick={() => {
                      navigateToContainer(space.id, folder.id);
                      setContainerExpanded(key, true);
                    }}
                    onKeyDown={(e) => containerKeys(e, key)}
                    className="flex flex-1 min-w-0 items-center gap-2 py-2 text-start"
                  >
                    <Folder size={14} />
                    <span dir="auto" className="truncate text-xs">
                      {displayName}
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="p-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
                        aria-label={t("personal.moreActions")}
                      >
                        <MoreHorizontal size={13} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onNewNote(space.id, folder.id)}>
                        {t("notes.list.newNote")}
                      </DropdownMenuItem>
                      {!folder.is_default && (
                        <>
                          <DropdownMenuItem
                            onSelect={() => {
                              setEditing(folder.id);
                              setDraft(folder.name);
                              setMoveAfterCreate(null);
                            }}
                          >
                            {t("notes.context.rename")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              showConfirmDialog({
                                title: t("personal.deleteFolder"),
                                description: folder.name,
                                variant: "destructive",
                                onConfirm: () => {
                                  void deleteLocalFolder(folder.id);
                                },
                              })
                            }
                          >
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {expanded.has(key) && renderNotes(key)}
              </div>
            );
          })}
        </>
      )}
      {editing != null && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void commit();
          }}
          className="mt-2 space-y-1"
        >
          <Input
            dir="auto"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(null);
            }}
          />
          <div className="flex gap-1">
            <Button size="sm" type="submit">
              {t("common.save")}
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={hideConfirmDialog}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
      />
    </div>
  );
}
