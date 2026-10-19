import type {
  CleanupOperationIdentity,
  CleanupRetryResult,
} from "../../services/ai/personalInferenceTypes";

export function sameCleanupOperation(
  a: CleanupOperationIdentity,
  b: CleanupOperationIdentity
): boolean {
  return a.demoId === b.demoId && a.takeId === b.takeId && a.operationId === b.operationId;
}

/** Retry only the original overlay operation. No settings, text or token crosses here. */
export async function retryCleanupOperation(
  identity: CleanupOperationIdentity
): Promise<CleanupRetryResult> {
  try {
    const result = await window.electronAPI?.retryOnboardingCleanup?.(identity);
    if (result && sameCleanupOperation(identity, result)) return result;
  } catch {
    /* Safe refusal, never provider error bodies. */
  }
  return { ...identity, ok: false, code: "CLEANUP_OPERATION_UNAVAILABLE" };
}

export function cleanupErrorKey(code: string | null): string {
  const suffix =
    code === "UNSUPPORTED_AUTH_SOURCE"
      ? "unsupported"
      : code === "RECIPIENT_CHANGED"
        ? "changed"
        : code === "CLEANUP_OPERATION_BUSY"
          ? "busy"
          : code === "CLEANUP_OPERATION_UNAVAILABLE" || code === "CLEANUP_REQUEST_CHANGED"
            ? "unavailable"
            : "failed";
  return `setupFlow.cleanupAuthority.${suffix}`;
}
