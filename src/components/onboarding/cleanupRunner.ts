import type {
  CleanupOperationIdentity,
  CleanupRetryResult,
  TextOperationDescriptor,
} from "../../services/ai/personalInferenceTypes";
import { countWords, copyCleanupDescriptor } from "../../utils/onboardingCleanupPreview";
import { applyChineseScript, resolveChineseScriptTarget } from "../../utils/chineseScript";

export interface SetupCleanupOperation {
  result: Promise<string>;
  retire(): void;
}
type CleanupFactory = typeof import("../../services/capturedCleanupOperation");

/** Fresh setup owner, never the overlay retry relay. Capture before the import. */
export function createSetupCleanupOperation(
  text: string,
  descriptor: TextOperationDescriptor,
  isCurrent: () => boolean,
  load: () => Promise<Pick<CleanupFactory, "createCapturedCleanupOperation">> = () =>
    import("../../services/capturedCleanupOperation")
): SetupCleanupOperation {
  const admitted = Object.freeze({
    text,
    wordCount: countWords(text),
    descriptor: copyCleanupDescriptor(descriptor),
  });
  let retired = false;
  let operation: ReturnType<CleanupFactory["createCapturedCleanupOperation"]> | undefined;
  const assertCurrent = () => {
    if (retired || !isCurrent())
      throw Object.assign(new Error("Cleanup selection changed."), { code: "RECIPIENT_CHANGED" });
  };
  const result = (async () => {
    assertCurrent();
    const factory = await load();
    assertCurrent();
    const context = admitted.descriptor.cleanupContext;
    operation = factory.createCapturedCleanupOperation(
      undefined,
      admitted.descriptor,
      (output) =>
        applyChineseScript(
          output,
          resolveChineseScriptTarget(context?.language, context?.chineseScriptPreference, output)
        ),
      () => !retired && isCurrent()
    );
    try {
      // run captures the already-admitted sentence/count before its IPC wait.
      assertCurrent();
      const cleaned = await operation.run(admitted.text);
      assertCurrent();
      if (!cleaned?.trim())
        throw Object.assign(new Error("Cleanup failed."), { code: "CLEANUP_FAILED" });
      return cleaned;
    } finally {
      operation.retire();
    }
  })();
  return {
    result,
    retire() {
      retired = true;
      operation?.retire();
    },
  };
}

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
