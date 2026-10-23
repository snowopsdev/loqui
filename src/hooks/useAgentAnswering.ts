import { useEffect, useRef, useState } from "react";

/** CSS --motion-slow + --motion-hero finishes before this functional deadline. */
export const AGENT_ANSWERING_MS = 1000;

export interface AgentResponsePhase {
  readonly owner: object;
  readonly responded: boolean;
}

/** Exact response lifetime in App; the optional signal preserves two-boolean callers. */
export function useAgentAnswering(
  thinking: boolean,
  busy: boolean,
  response?: AgentResponsePhase | null
): boolean {
  const wasThinking = useRef(thinking);
  const startedOwner = useRef<object | null>(null);
  const [answeringFor, setAnsweringFor] = useState<object | null>(null);
  const legacy = response === undefined;
  const owner = response?.owner ?? null;
  const responded = response?.responded === true;
  useEffect(() => {
    const firstToken = wasThinking.current && !thinking && busy;
    wasThinking.current = thinking;
    if (!busy || thinking || (!legacy && (!owner || !responded))) {
      setAnsweringFor(null);
      return;
    }
    if (legacy ? !firstToken : startedOwner.current === owner) return;
    const phaseOwner = legacy ? {} : owner!;
    startedOwner.current = phaseOwner;
    setAnsweringFor(phaseOwner);
    const id = setTimeout(() => {
      setAnsweringFor((current) => (current === phaseOwner ? null : current));
    }, AGENT_ANSWERING_MS);
    return () => clearTimeout(id);
  }, [thinking, busy, legacy, owner, responded]);
  // Retirement/replacement is suppressed in this render, before effect cleanup.
  return Boolean(
    answeringFor && busy && !thinking && (legacy || (answeringFor === owner && responded))
  );
}
