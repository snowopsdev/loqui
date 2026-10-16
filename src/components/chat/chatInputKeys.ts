export type ComposerKeyAction = "submit" | "queue" | "unqueue" | "none";

export interface ComposerKeyInput {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode?: number;
  isBusy: boolean;
  isQueued: boolean;
  hasText: boolean;
}

/** What a key press in the composer means. IME composition owns Enter
 * (isComposing, or keyCode 229 where Chromium reports the commit key late).
 * Shift+Enter is a newline. */
export function resolveComposerKey(input: ComposerKeyInput): ComposerKeyAction {
  if (input.isComposing || input.keyCode === 229) return "none";
  if (input.key === "Escape") return input.isQueued ? "unqueue" : "none";
  if (input.key !== "Enter" || input.shiftKey || !input.hasText) return "none";
  return input.isBusy ? "queue" : "submit";
}

export const COMPOSER_MAX_HEIGHT_PX = 160;

export function composerHeight(
  scrollHeight: number,
  maxHeight: number = COMPOSER_MAX_HEIGHT_PX
): { height: number; overflowY: "hidden" | "auto" } {
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0)
    return { height: 0, overflowY: "hidden" };
  return scrollHeight > maxHeight
    ? { height: maxHeight, overflowY: "auto" }
    : { height: scrollHeight, overflowY: "hidden" };
}
