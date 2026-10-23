import type { CancelledState } from "../types/dictation";
import { usePillHotkey } from "./usePillHotkey";

/** ⌥Z restores the cancelled dictation; leased from main only while its window is open (D3). */
export function useUndoCancelHotkey(
  cancelled: CancelledState | null,
  undoCancel: () => Promise<boolean>
) {
  return usePillHotkey("undoCancel", cancelled !== null, () => {
    void undoCancel();
  });
}
