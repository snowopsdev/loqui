import { getSetupCleanupRevision } from "../stores/setupCleanupAdmission";
import { useRouteFactsStore } from "../stores/routeFactsStore";
import type { CredentialSlot } from "../lib/routeGraph";
import { copyCleanupDescriptor } from "../utils/onboardingCleanupPreview";
import i18n from "../i18n";
import { providerDisplayLabel } from "../lib/locality";
import {
  getSettings,
  selectResolvedLLMConfig,
  enterpriseRouteVersion,
  type SettingsState,
} from "../stores/settingsStore";
import { getCleanupSystemPrompt, wrapCleanupTranscript } from "../config/prompts";
import { getDictionaryHintWords } from "../utils/snippets";
import { resolveCleanupLanguage } from "../utils/chineseScript";
import { getLlmRequestTimeoutSeconds } from "../helpers/llmRequestTimeout.js";
import type {
  CapturedTextInput,
  CleanupOperationIdentity,
  TextOperationDescriptor,
} from "./ai/personalInferenceTypes";

// Main's typed envelope for a Sealed mode refusal or interruption. Only main's
// explicit "refused" is a refusal; a missing phase never says nothing was sent
// (Task 18 T18-06).
function sealedModeError(result: { phase?: unknown }) {
  const interrupted = result.phase !== "refused";
  return Object.assign(
    new Error(interrupted ? "[SEALED_MODE:interrupted] Sealed mode" : "[SEALED_MODE] Sealed mode"),
    {
      code: "SEALED_MODE",
      messageKey: interrupted ? "sealedMode.interrupted.generic" : "sealedMode.blocked.generic",
      details: { phase: interrupted ? "interrupted" : "refused" },
    }
  );
}

function operationError(code = "CLEANUP_FAILED", provider = "") {
  const suffix =
    code === "RECIPIENT_CHANGED"
      ? "changed"
      : code === "UNSUPPORTED_AUTH_SOURCE"
        ? "unsupported"
        : code === "CLEANUP_OPERATION_BUSY"
          ? "busy"
          : code === "CLEANUP_OPERATION_UNAVAILABLE" || code === "CLEANUP_REQUEST_CHANGED"
            ? "unavailable"
            : "failed";
  const messageKey = `setupFlow.cleanupAuthority.${suffix}`;
  const messageParams = { provider: providerDisplayLabel(provider, i18n.t.bind(i18n)) };
  return Object.assign(new Error(i18n.t(messageKey, messageParams)), {
    code,
    messageKey,
    messageParams,
  });
}
const unavailable = () => operationError("CLEANUP_OPERATION_UNAVAILABLE");

/** Synchronous, before any import/IPC/microphone await. No secret store fields. */
export function captureCleanupSelection(
  settings: SettingsState = getSettings()
): TextOperationDescriptor | null {
  const selected = selectResolvedLLMConfig(settings, "dictationCleanup");
  const model = selected.model;
  if (!settings.useCleanupModel || !model) return null;
  const provider =
    selected.mode === "local"
      ? "local"
      : selected.mode === "self-hosted"
        ? "lan"
        : selected.provider;
  const expectedEnterprise =
    provider === "azure"
      ? {
          azureEndpoint: settings.azureEndpoint,
          azureApiVersion: settings.azureApiVersion || "2024-10-21",
        }
      : provider === "vertex"
        ? {
            vertexProject: settings.vertexProject,
            vertexLocation: settings.vertexLocation || "us-central1",
            vertexAuthSource: settings.vertexAuthSource,
          }
        : provider === "bedrock"
          ? {
              bedrockRegion: settings.bedrockRegion || "us-east-1",
              bedrockProfile: settings.bedrockProfile || "",
            }
          : undefined;
  return Object.freeze({
    provider,
    model,
    inferenceScope: "dictationCleanup",
    cleanupContext: Object.freeze({
      language: settings.preferredLanguage,
      uiLanguage: settings.uiLanguage,
      dictionary: Object.freeze([...getDictionaryHintWords(settings)]),
      chineseScriptPreference: settings.chineseScriptPreference,
    }),
    ...(provider === "lan" || provider === "custom"
      ? {
          baseUrl:
            selected.mode === "self-hosted"
              ? settings.cleanupRemoteUrl
              : settings.cleanupCloudBaseUrl,
          credentialRef: "custom:dictationCleanup",
        }
      : {}),
    systemPrompt: getCleanupSystemPrompt(
      null,
      getDictionaryHintWords(settings),
      resolveCleanupLanguage(settings.preferredLanguage),
      settings.uiLanguage
    ),
    disableThinking: settings.cleanupDisableThinking,
    temperature: provider === "gemini" ? undefined : 0,
    requireCompleteOutput: true,
    timeoutMs: getLlmRequestTimeoutSeconds({ scope: "dictationCleanup" }) * 1000,
    ...(expectedEnterprise ? { expectedEnterprise } : {}),
  });
}

/** Current take only. First input is captured synchronously; retry has no input.
 * Setup never receives the sender-bound token; main relays its selector to us.
 * Shared capture/runner API is also usable by a newly consented setup operation.
 */
export function createCapturedCleanupOperation(
  identity?: CleanupOperationIdentity,
  descriptor = captureCleanupSelection(),
  finalize: (text: string) => Promise<string> = async (text) => text,
  isCurrent: () => boolean = () => true
) {
  const api = window.electronAPI?.personalInference;
  let retired = false;
  let rejectRetired: (error: Error) => void;
  const retirement = new Promise<never>((_resolve, reject) => {
    rejectRetired = reject;
  });
  void retirement.catch(() => {});
  const waitForOwner = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, retirement]);
  let busy = false;
  let original: CapturedTextInput | null = null;
  const selected = descriptor
    ? Object.freeze({
        ...descriptor,
        ...(identity ? { cleanupIdentity: Object.freeze({ ...identity }) } : {}),
      })
    : null;
  // Settle rejection eagerly: a long recording must not produce an unhandled
  // rejection while text has not arrived yet. The same refusal reaches first run.
  let admission: Promise<string | null>;
  try {
    admission = selected
      ? api?.captureTextOperation?.(selected) || Promise.reject(unavailable())
      : Promise.resolve(null);
  } catch (error) {
    admission = Promise.reject(error);
  }
  const capture = admission.then(
    (token) => ({ token, error: null }),
    (error) => ({ token: null, error })
  );
  const live = () => {
    if (retired) throw unavailable();
    if (!isCurrent()) throw operationError("RECIPIENT_CHANGED", selected?.provider);
  };
  const finalizeOutput = async (text: string) => {
    live();
    const result = await waitForOwner(finalize(text));
    live();
    return result;
  };
  const execute = async () => {
    live();
    if (!selected) return null;
    if (!original) throw unavailable();
    if (busy) throw operationError("CLEANUP_OPERATION_BUSY");
    busy = true;
    const request = original;
    try {
      const captured = await waitForOwner(capture);
      live();
      if (captured.error) throw captured.error;
      if (!captured.token) throw unavailable();
      if (selected.provider === "local") {
        const result = await waitForOwner(
          window.electronAPI.processLocalReasoning(
            request.messages[0].content as string,
            selected.model,
            null,
            {
              textOperationToken: captured.token,
              wordCount: request.wordCount,
            }
          )
        );
        live();
        if (result.code === "SEALED_MODE") throw sealedModeError(result);
        if (!result.success || !result.text?.trim())
          throw Object.assign(new Error("Cleanup failed. Your original words are preserved."), {
            code: result.code || "CLEANUP_FAILED",
          });
        return await finalizeOutput(result.text);
      }
      const result = await waitForOwner(api.runTextOperation({ token: captured.token, request }));
      live();
      return await finalizeOutput(result.text);
    } catch (error) {
      const code = (error as { code?: string }).code;
      // Sealed mode stays typed with its phase (refused vs interrupted) under
      // the existing translated failure copy; the caller keeps the words.
      if (code === "SEALED_MODE")
        throw Object.assign(operationError(code, selected.provider), {
          details: (error as { details?: unknown }).details ?? { phase: "refused" },
          cause: error,
        });
      throw operationError(code, selected.provider);
    } finally {
      busy = false;
    }
  };
  return {
    get isRunning() {
      return busy;
    },
    identity,
    finalizeOutput,
    run(text: string) {
      live();
      if (original) throw operationError("CLEANUP_REQUEST_CHANGED");
      original = Object.freeze({
        messages: [{ role: "user", content: wrapCleanupTranscript(text) }],
        wordCount: text.trim().split(/\s+/).filter(Boolean).length,
      });
      return execute();
    },
    retry: execute,
    retire() {
      if (retired) return;
      retired = true;
      rejectRetired(unavailable());
      original = null;
      void capture
        .then(({ token }) => {
          if (token) return api.retireTextOperation(token);
        })
        .catch(() => {});
    },
  };
}

export { revokeSetupCleanupSelection } from "../stores/setupCleanupAdmission";

/** Network-free synchronous snapshot; main still owns execution authority. */
export function captureSetupCleanupSelection(): TextOperationDescriptor | null {
  const selected = captureCleanupSelection();
  if (!selected) return null;
  const slot =
    selected.credentialRef ??
    (selected.provider === "lan" || selected.provider === "custom"
      ? "custom:dictationCleanup"
      : selected.provider);
  const facts = useRouteFactsStore.getState().facts;
  return copyCleanupDescriptor({
    ...selected,
    selectionRevision: getSetupCleanupRevision(),
    expectedAuthority: {
      credentialGeneration:
        selected.provider === "local"
          ? undefined
          : facts.credentialGenerations?.get(slot as CredentialSlot),
      enterpriseVersion: ["azure", "vertex", "bedrock"].includes(selected.provider)
        ? enterpriseRouteVersion()
        : undefined,
    },
  });
}

export function isSetupCleanupSelectionCurrent(selected: TextOperationDescriptor): boolean {
  return JSON.stringify(selected) === JSON.stringify(captureSetupCleanupSelection());
}
