// Renderer consent revision only. Main's committed credential/config authority
// remains independent. Actual settings and sentence/choice owners revoke here
// synchronously, before React may coalesce an A→B→A update.
let revision = 0;
const listeners = new Set<() => void>();
export function subscribeSetupCleanupRevision(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const getSetupCleanupRevision = (): number => revision;
export function revokeSetupCleanupSelection(): void {
  revision += 1;
  for (const listener of listeners) listener();
}
