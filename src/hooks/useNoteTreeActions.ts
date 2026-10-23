import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "../components/ui/notices";
import {
  createFolder,
  getNoteFromStore,
  revealContainer,
  setActiveContext,
  getActiveNoteIdValue,
  getNoteNavigationGeneration,
  useFolders,
  useSpaces,
} from "../stores/noteStore";
import { runBeforeNoteDelete } from "../stores/noteDeleteGuard";
import type { NoteMoveTarget } from "./useNoteDragAndDrop";

export function useNoteTreeActions() {
  const { t } = useTranslation();
  const folders = useFolders();
  const spaces = useSpaces();
  const privateSpaceId = useMemo(
    () => spaces.find((s) => s.kind === "private")?.id ?? null,
    [spaces]
  );

  const onDeleteNote = useCallback(async (id: number) => {
    runBeforeNoteDelete(id);
    await window.electronAPI.deleteNote(id);
  }, []);

  const onMoveNote = useCallback(
    async (noteId: number, target: NoteMoveTarget, generation = getNoteNavigationGeneration()) => {
      const result = await window.electronAPI.updateNote(noteId, {
        folder_id: target.folderId,
        space_id: target.spaceId,
      });
      if (
        result.success &&
        generation === getNoteNavigationGeneration() &&
        noteId === getActiveNoteIdValue()
      ) {
        setActiveContext(target.spaceId, target.folderId);
        revealContainer(target.spaceId, target.folderId);
      }
    },
    []
  );

  const onMoveToFolder = useCallback(
    async (noteId: number, folderId: number) => {
      const folder = folders.find((f) => f.id === folderId);
      if (!folder) return;
      await onMoveNote(noteId, { spaceId: folder.space_id, folderId });
    },
    [folders, onMoveNote]
  );

  const onCreateFolderAndMove = useCallback(
    async (noteId: number, folderName: string) => {
      const generation = getNoteNavigationGeneration();
      const spaceId = getNoteFromStore(noteId)?.space_id ?? privateSpaceId;
      if (spaceId == null) return;
      try {
        const result = await createFolder(folderName, spaceId);
        if (result.success && result.folder) {
          // Creation returns the authority; the pre-create folders list cannot contain it.
          await onMoveNote(
            noteId,
            { spaceId: result.folder.space_id, folderId: result.folder.id },
            generation
          );
        } else {
          notify({
            kind: "alert",
            title: t("notes.folders.couldNotCreate"),
            body: result.error || t("common.error"),
          });
        }
      } catch (error) {
        notify({
          kind: "alert",
          title: t("notes.folders.couldNotCreate"),
          body: String(error),
        });
      }
    },
    [privateSpaceId, onMoveNote, t]
  );

  return { onDeleteNote, onMoveNote, onMoveToFolder, onCreateFolderAndMove };
}
