// Whether the dictation agent has a complete configuration for its active mode.
export function resolveDictationAgentReachability({
  useDictationAgent,
  dictationAgentMode,
  dictationAgentProvider,
  dictationAgentModel,
  isCloudAgent,
  isSelfHostedAgent,
}) {
  if (!useDictationAgent) return false;
  if (dictationAgentMode === "openwhispr") return isCloudAgent;
  if (dictationAgentMode === "self-hosted") return isSelfHostedAgent;

  const hasModel = (dictationAgentModel?.trim()?.length ?? 0) > 0;
  if (dictationAgentMode === "local") return hasModel;
  if (dictationAgentMode === "providers" || dictationAgentMode === "enterprise") {
    return !!dictationAgentProvider?.trim() && hasModel;
  }
  return false;
}

// Whether the translation step can run: cloud/self-hosted accept an empty model,
// every other mode requires one; a target language is always required.
export function resolveDictationTranslationReachability({
  useDictationTranslation,
  translationTargetLanguage,
  translationModel,
  isCloudTranslation,
  isSelfHostedTranslation,
}) {
  if (!useDictationTranslation) return false;
  if (!translationTargetLanguage?.trim()) return false;
  if (isCloudTranslation || isSelfHostedTranslation) return true;
  return (translationModel?.trim()?.length ?? 0) > 0;
}

// Maps the active mode to the provider ReasoningService must dispatch through.
export function resolveDictationAgentProvider({
  isCloudAgent,
  dictationAgentMode,
  dictationAgentProvider,
}) {
  switch (dictationAgentMode) {
    case "openwhispr":
      return isCloudAgent ? "openwhispr" : undefined;
    case "local":
      return "local";
    case "self-hosted":
      return undefined;
    case "providers":
    case "enterprise":
      return dictationAgentProvider?.trim() || undefined;
    default:
      return undefined;
  }
}

export function resolveDictationAgentDisplayProvider({
  dictationAgentMode,
  dictationAgentProvider,
}) {
  if (dictationAgentMode === "openwhispr") return "openwhispr";
  if (dictationAgentMode === "local") return "local";
  if (dictationAgentMode === "self-hosted") return "self-hosted";
  return dictationAgentProvider?.trim() || "none";
}

// Decides which reasoning path ("translation" | "agent" | "cleanup" | "skip")
// a finished dictation takes. A recording started via the voice agent hotkey
// always takes the agent path — no wake word needed — and never falls back to
// cleanup. A translation recording degrades to cleanup instead: the transcript
// is still a useful dictation without the translation step.
export function resolveDictationRouteKind({
  cleanupReachable,
  agentReachable,
  agentInvoked,
  voiceAgentRequested,
  translationRequested,
  translationReachable,
}) {
  if (translationRequested) {
    if (translationReachable) return "translation";
    return cleanupReachable ? "cleanup" : "skip";
  }
  if (voiceAgentRequested) {
    return agentReachable ? "agent" : "skip";
  }
  if (agentReachable && agentInvoked) {
    return "agent";
  }
  if (cleanupReachable) {
    return "cleanup";
  }
  return "skip";
}
