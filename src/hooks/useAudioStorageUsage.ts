import { useCallback, useEffect, useState } from "react";
import { resolveClearAudioOutcome, type ClearAudioOutcome } from "../utils/audioDeletion";

export type AudioUsage =
  | { status: "loading" }
  | { status: "known"; fileCount: number; totalBytes: number }
  | { status: "unavailable" };

/** Stored-audio usage for Settings. An unreadable folder or a failed read is
 * "unavailable", never zero, and a failed refresh replaces an older count
 * instead of leaving it on screen as if it were current. */
export function useAudioStorageUsage(active: boolean) {
  const [usage, setUsage] = useState<AudioUsage>({ status: "loading" });

  const refresh = useCallback(async (): Promise<AudioUsage> => {
    let next: AudioUsage = { status: "unavailable" };
    try {
      const read = await window.electronAPI?.getAudioStorageUsage?.();
      if (read?.readable) {
        next = { status: "known", fileCount: read.fileCount, totalBytes: read.totalBytes };
      }
    } catch {
      // stays unavailable
    }
    setUsage(next);
    return next;
  }, []);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  const clearAll = useCallback(async (): Promise<ClearAudioOutcome> => {
    let deleted: { failed: number; readable: boolean } | null = null;
    try {
      deleted = (await window.electronAPI?.deleteAllAudio?.()) ?? null;
    } catch {
      deleted = null;
    }
    const after = await refresh();
    return resolveClearAudioOutcome(
      deleted,
      after.status === "known" ? { fileCount: after.fileCount, readable: true } : null
    );
  }, [refresh]);

  return { usage, refresh, clearAll };
}
