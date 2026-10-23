import { isSealedModeError, sealedPhase } from "../../utils/sealedModeError";

// The assistant bubble's text when a reply fails. The user's own message is
// never touched. A sealed failure says what happened instead of a raw
// transport error: "nothing was sent" only for a refusal; an interruption
// says the provider may have received part of the conversation.
export function chatErrorContent(error: unknown, t: (key: string) => string): string {
  if (isSealedModeError(error))
    return t(
      sealedPhase(error) === "interrupted"
        ? "sealedMode.interrupted.chat"
        : "sealedMode.blocked.chat"
    );
  const message =
    error && typeof error === "object" && typeof (error as Error).message === "string"
      ? (error as Error).message
      : String(error);
  return `${t("agentMode.chat.errorPrefix")}: ${message}`;
}
