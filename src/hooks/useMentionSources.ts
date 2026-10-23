import { useRef, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import { useTranscriptions } from "../stores/transcriptionStore";
import { useFolders } from "../stores/noteStore";
import { useRecentNotes } from "./useRecentNotes";
import { formatRelativeTime } from "../utils/dateFormatting";
import { formatMmSs } from "../utils/formatDuration";
import type { MentionSources } from "../lib/mentionSearch";
import type { MentionPerson } from "../utils/mentionMarkdown";

export function useMentionSources(people: MentionPerson[]): MutableRefObject<MentionSources> {
  const { t, i18n } = useTranslation();
  // The extension reads current sources lazily without rebuilding the editor.
  const transcriptions = useTranscriptions();
  const folders = useFolders();
  const recentNotes = useRecentNotes(6);
  const sourcesRef = useRef<MentionSources | null>(null);
  sourcesRef.current = {
    people: people,
    searchContacts: async (query) =>
      (await window.electronAPI.searchContacts(query))?.contacts ?? [],
    searchNotes: (query, limit) => window.electronAPI.searchNotes(query, limit),
    recentNotes,
    transcriptions,
    folders,
    describe: {
      note: (note) =>
        [
          folders.find((f) => f.id === note.folder_id)?.name,
          formatRelativeTime(note.updated_at, t, i18n.language),
        ]
          .filter(Boolean)
          .join(" · "),
      meeting: (note) => formatRelativeTime(note.created_at, t, i18n.language),
      dictation: (item) =>
        [
          formatRelativeTime(item.created_at, t, i18n.language),
          item.audio_duration_ms != null ? formatMmSs(item.audio_duration_ms / 1000) : null,
        ]
          .filter(Boolean)
          .join(" · "),
      folder: () => t("mention.folderMeta"),
    },
  };

  return sourcesRef as MutableRefObject<MentionSources>;
}
