import { useEffect, useState } from "react";
import type { NoteItem } from "../types/electron";

// getNotes(null, limit) with no folder or space is every personal note,
// ordered updated_at DESC (database.js:1097-1124).
export function useRecentNotes(limit: number): NoteItem[] {
  const [notes, setNotes] = useState<NoteItem[]>([]);
  useEffect(() => {
    let alive = true;
    let generation = 0;
    const api = window.electronAPI;
    const load = () => {
      const request = ++generation;
      void api
        ?.getNotes(null, limit)
        .then((rows) => {
          if (alive && request === generation) setNotes(rows ?? []);
        })
        .catch(() => {});
    };
    load();
    const offs = [
      api?.onNoteAdded?.(load),
      api?.onNoteUpdated?.(load),
      api?.onNoteDeleted?.(load),
      api?.onFolderDeleted?.(({ id }) => {
        // The database deletes folder notes without individual note-deleted events.
        // Invalidate older reloads and evict only this persisted Recent projection.
        setNotes((current) => current.filter((note) => note.folder_id !== id));
        load();
      }),
    ];
    return () => {
      alive = false;
      generation += 1;
      for (const off of offs) off?.();
    };
  }, [limit]);
  return notes;
}
