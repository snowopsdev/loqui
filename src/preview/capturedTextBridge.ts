import { validateCapturedTextInput } from "../helpers/capturedTextInput.mjs";
import type {
  PersonalInferenceAPI,
  TextOperationDescriptor,
  CapturedTextInput,
} from "../services/ai/personalInferenceTypes";

/** In-memory production-boundary fixture; no credentials, runtime or transport. */
export function createCapturedTextBridge(
  run: (descriptor: TextOperationDescriptor, sentence: string) => Promise<string>
) {
  const operations = new Map<
    string,
    { descriptor: TextOperationDescriptor; request: string | null; busy: boolean }
  >();
  let sequence = 0;
  const execute = async (token: string, input: CapturedTextInput, local: boolean) => {
    const request = validateCapturedTextInput(input);
    const operation = operations.get(token);
    const fail = (code: string): never => {
      throw Object.assign(new Error(code), { code });
    };
    if (!operation || (operation.descriptor.provider === "local") !== local)
      return fail("CLEANUP_OPERATION_UNAVAILABLE");
    if (operation.busy) return fail("CLEANUP_OPERATION_BUSY");
    const original = JSON.stringify(request);
    if (operation.request !== null && operation.request !== original)
      return fail("CLEANUP_REQUEST_CHANGED");
    operation.request = original;
    operation.busy = true;
    try {
      const text = await run(operation.descriptor, request.messages[0].content as string);
      if (operations.get(token) !== operation) return fail("CLEANUP_OPERATION_UNAVAILABLE");
      return { text };
    } finally {
      operation.busy = false;
    }
  };
  return {
    captureTextOperation: async (descriptor) => {
      if (["codex", "tinfoil"].includes(descriptor.provider))
        throw Object.assign(new Error("Unsupported captured authentication source."), {
          code: "UNSUPPORTED_AUTH_SOURCE",
        });
      const token = `preview-cleanup-${++sequence}`;
      operations.set(token, {
        descriptor: structuredClone(descriptor),
        request: null,
        busy: false,
      });
      return token;
    },
    runTextOperation: ({ token, request }) => execute(token, request, false),
    retireTextOperation: async (token) => {
      operations.delete(token);
    },
    processLocalReasoning: async (text, _model, _agent, config) => {
      try {
        const result = await execute(
          config?.textOperationToken,
          { messages: [{ role: "user", content: text }], wordCount: config?.wordCount },
          true
        );
        return { success: true, text: result.text };
      } catch (error) {
        return { success: false, code: (error as { code?: string }).code || "CLEANUP_FAILED" };
      }
    },
    reset: () => operations.clear(),
  } satisfies Pick<
    PersonalInferenceAPI,
    "captureTextOperation" | "runTextOperation" | "retireTextOperation"
  > &
    Pick<Window["electronAPI"], "processLocalReasoning"> & { reset(): void };
}
