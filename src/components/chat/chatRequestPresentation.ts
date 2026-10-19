import type { ChatInferenceSnapshot } from "./useChatStreaming";
import type { PillSession } from "../dictation/pillLocality";
import { resolveLocality } from "../../lib/locality";

/** Allowlisted display data only. Never the inference config, URL, auth or attachment. */
export type ChatAdmissionPresentation = PillSession & { readonly agentOnly: true };

/** Project the SAME effective snapshot consumed by sendToAI; no live reads/resolution. */
export function chatAdmissionPresentation(
  snapshot: ChatInferenceSnapshot
): ChatAdmissionPresentation {
  const { config, attachScreenContext } = snapshot.inference;
  const id = attachScreenContext ? "assistantVision" : "voiceAssistant";
  const { locality } = resolveLocality({
    mode: config.mode,
    provider: config.provider,
    remoteUrl: config.remoteUrl,
  });
  const route = Object.freeze({
    id,
    kind: "text" as const,
    locality,
    provider: null,
    providerId: locality === "remote" ? config.provider || null : null,
    model: config.model || null,
    host: null,
    recipient: null,
    state: Object.freeze({ status: "unreachable" as const }),
    sends: null,
    settingsPath: id,
  });
  return Object.freeze({
    agentOnly: true as const,
    routes: Object.freeze({ [id]: route }),
    settings: Object.freeze({
      useCleanupModel: false,
      voiceAgentScreenContext: attachScreenContext,
    }),
    intents: Object.freeze({ voiceAgentRequested: true, translationRequested: false }),
  });
}
