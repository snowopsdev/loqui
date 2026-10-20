import { useEffect, useRef } from "react";

export const RECHECK_POLL_MS = 2000;

/** Recheck on return from settings and every two seconds while recovery is active. */
export function useRecheckOnFocus(check: () => unknown, enabled: boolean): void {
  const checkRef = useRef(check);
  checkRef.current = check;
  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      try {
        // Event listeners and timers have no caller to handle a rejected check.
        void Promise.resolve(checkRef.current()).catch(() => {});
      } catch {
        // Synchronous checks have the same background failure boundary.
      }
    };
    window.addEventListener("focus", run);
    const id = setInterval(run, RECHECK_POLL_MS);
    return () => {
      window.removeEventListener("focus", run);
      clearInterval(id);
    };
  }, [enabled]);
}
