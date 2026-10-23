import { useEffect, useState } from "react";
import { PILL_OUTCOME_BEAT_MS } from "../helpers/voicePillPresentation";

type Outcome = { kind: "pasted"; words: number; at: number } | { kind: "failed"; at: number };

/** The outcome while its 700ms beat is running, else null (VO-Q12). */
export function useRecentOutcome(
  outcome: Outcome | null,
  windowMs = PILL_OUTCOME_BEAT_MS
): Outcome | null {
  const [recent, setRecent] = useState<Outcome | null>(null);
  useEffect(() => {
    setRecent(null);
    if (!outcome) return;
    const remaining = outcome.at + windowMs - Date.now();
    if (remaining <= 0) return;
    setRecent(outcome);
    const id = setTimeout(() => setRecent(null), remaining);
    return () => clearTimeout(id);
  }, [outcome, windowMs]);
  return recent === outcome && recent && recent.at + windowMs > Date.now() ? recent : null;
}
