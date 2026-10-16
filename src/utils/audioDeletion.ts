export type ClearAudioOutcome = "cleared" | "partial";

/** Cleared only when main deleted every file it could read, and reading the
 * store back finds it readable and empty. Anything unknown is "partial", so
 * the UI never claims audio is gone when it cannot tell. */
export function resolveClearAudioOutcome(
  deleted: { failed: number; readable: boolean } | null,
  after: { fileCount: number; readable: boolean } | null
): ClearAudioOutcome {
  const deletedCleanly = deleted !== null && deleted.readable && deleted.failed === 0;
  const readsEmpty = after !== null && after.readable && after.fileCount === 0;
  return deletedCleanly && readsEmpty ? "cleared" : "partial";
}
