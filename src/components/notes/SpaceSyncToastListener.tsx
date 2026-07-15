import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../ui/useToast";

const DEDUPE_MS = 15_000;

/**
 * Headless. Mount once inside ToastProvider so team-space access changes
 * raised by sync surface even when the user is outside the notes view.
 * A rejected push and the following spaces-pass purge can both announce the
 * same space, so access-revoked toasts dedupe by space name; folder name
 * conflicts recur every sync pass while unresolved, so they dedupe too.
 */
export default function SpaceSyncToastListener() {
  const { t } = useTranslation();
  const { toast } = useToast();

  useEffect(() => {
    const lastRevokedAt = new Map<string, number>();
    const lastFolderConflictAt = new Map<string, number>();

    const onSpaceRevoked = (event: Event) => {
      const { spaceName } = (event as CustomEvent<{ spaceName: string | null }>).detail;
      if (!spaceName) return;
      const now = Date.now();
      if (now - (lastRevokedAt.get(spaceName) ?? 0) < DEDUPE_MS) return;
      lastRevokedAt.set(spaceName, now);
      toast({
        title: t("notes.spaces.accessRevoked", { space: spaceName }),
        variant: "destructive",
      });
    };

    const onFolderNameTaken = (event: Event) => {
      const { name } = (event as CustomEvent<{ name: string }>).detail;
      const now = Date.now();
      if (now - (lastFolderConflictAt.get(name) ?? 0) < DEDUPE_MS) return;
      lastFolderConflictAt.set(name, now);
      toast({
        title: t("notes.spaces.folderNameTaken", { name }),
        variant: "destructive",
      });
    };

    const onNoteRelocated = (event: Event) => {
      const { title, spaceName } = (
        event as CustomEvent<{ title: string | null; spaceName: string | null }>
      ).detail;
      if (!spaceName) return;
      toast({
        title: t("notes.spaces.movedToPersonal", {
          space: spaceName,
          title: title || t("notes.list.untitled"),
        }),
      });
    };

    window.addEventListener("openwhispr:space-revoked", onSpaceRevoked);
    window.addEventListener("openwhispr:note-relocated", onNoteRelocated);
    window.addEventListener("openwhispr:folder-name-taken", onFolderNameTaken);
    return () => {
      window.removeEventListener("openwhispr:space-revoked", onSpaceRevoked);
      window.removeEventListener("openwhispr:note-relocated", onNoteRelocated);
      window.removeEventListener("openwhispr:folder-name-taken", onFolderNameTaken);
    };
  }, [toast, t]);

  return null;
}
