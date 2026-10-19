import { useEffect, useRef } from "react";
import { shouldAutoHidePill } from "../helpers/voicePillPresentation";

/** The pause before an idle pill hides, so processing can start after recording stops without a flash. */
export const PILL_AUTO_HIDE_DELAY_MS = 500;

/**
 * "Auto-hide when idle" for the floating pill window. A stage that holds the
 * window (Task 10) keeps it on screen, and brings an auto-hidden pill back
 * when that stage starts.
 */
export function usePillAutoHide({
  floatingIconAutoHide,
  isRecording,
  isVisuallyProcessing,
  noticesOnScreen,
  wordsCardHandoffActive,
  assistantMounted,
  liveTranscriptMounted,
  ownership,
}) {
  const holdsWindow = Boolean(ownership?.holdsWindow);
  const prevAutoHideRef = useRef(floatingIconAutoHide);
  const prevHoldsWindowRef = useRef(false);

  useEffect(() => {
    let hideTimeout;
    if (
      shouldAutoHidePill({
        floatingIconAutoHide,
        isRecording,
        isVisuallyProcessing,
        noticesOnScreen,
        wordsCardHandoffActive,
        assistantMounted,
        liveTranscriptMounted,
        ownership: { holdsWindow },
      })
    ) {
      hideTimeout = setTimeout(() => {
        window.electronAPI?.hideWindow?.();
      }, PILL_AUTO_HIDE_DELAY_MS);
    } else if (!floatingIconAutoHide && prevAutoHideRef.current) {
      window.electronAPI?.showDictationPanel?.();
    } else if (floatingIconAutoHide && holdsWindow && !prevHoldsWindowRef.current) {
      // Only when the stage starts: show-dictation-panel also repositions the
      // window to the active display (ipcHandlers.js:1196-1198).
      window.electronAPI?.showDictationPanel?.();
    }
    prevAutoHideRef.current = floatingIconAutoHide;
    prevHoldsWindowRef.current = holdsWindow;
    return () => clearTimeout(hideTimeout);
  }, [
    floatingIconAutoHide,
    isRecording,
    isVisuallyProcessing,
    noticesOnScreen,
    wordsCardHandoffActive,
    assistantMounted,
    liveTranscriptMounted,
    holdsWindow,
  ]);
}
