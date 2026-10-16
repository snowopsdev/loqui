export interface NoteFormattingSnapshot {
  mode: string;
  model: string;
  remoteUrl?: string;
}

/** Whether note Actions can run with the resolved note-formatting config.
 * true: ready. false: cannot run, so show the hint. null: unknown, either
 * still checking or a remote provider; Plan 06's useResolvedRoute("noteFormatting") (§5.1)
 * reports remote readiness. A selected local model only counts once it is
 * on disk. */
export function noteActionsReadiness(
  config: NoteFormattingSnapshot,
  downloadedModelIds: ReadonlySet<string> | null
): boolean | null {
  if (!config.model) return false;
  if (config.mode === "local")
    return downloadedModelIds ? downloadedModelIds.has(config.model) : null;
  if (config.mode === "self-hosted") return Boolean(config.remoteUrl?.trim());
  return null;
}
