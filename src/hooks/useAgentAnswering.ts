import { useEffect, useRef, useState } from "react";

/** CSS --motion-slow + --motion-hero finishes before this functional deadline. */
export const AGENT_ANSWERING_MS = 1000;

/** First-token flourish; early completion/new thinking never inherits an old timer. */
export function useAgentAnswering(thinking: boolean, busy: boolean): boolean {
  const wasThinking = useRef(thinking);
  const [answering, setAnswering] = useState(false);
  useEffect(() => {
    const firstToken = wasThinking.current && !thinking && busy;
    wasThinking.current = thinking;
    if (!busy || thinking) {
      setAnswering(false);
      return;
    }
    if (!firstToken) return;
    setAnswering(true);
    const id = setTimeout(() => setAnswering(false), AGENT_ANSWERING_MS);
    return () => clearTimeout(id);
  }, [thinking, busy]);
  // Suppress stale state during the render before the resetting effect runs.
  return answering && busy && !thinking;
}
