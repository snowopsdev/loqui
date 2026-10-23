// Mirrors src/helpers/privacy/egressPolicy.js. ipcMain.handle keeps only the
// message of a rejected promise, so main also puts the code and phase in the
// text; result envelopes carry `code`, `phase` and `messageKey` fields.
export const SEALED_MODE = "SEALED_MODE";

export type SealedPhase = "refused" | "interrupted";

type Errorish = {
  code?: unknown;
  message?: unknown;
  error?: unknown;
  phase?: unknown;
  cause?: unknown;
  details?: { phase?: unknown } | null;
};

const textOf = (e: Errorish): string =>
  [e.message, e.error].filter((v): v is string => typeof v === "string").join(" ");

export function isSealedModeError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 3) return false;
  const e = error as Errorish;
  if (e.code === SEALED_MODE) return true;
  if (textOf(e).includes(`[${SEALED_MODE}`)) return true;
  return isSealedModeError(e.cause, depth + 1);
}

const explicitPhase = (value: unknown): SealedPhase | null =>
  value === "refused" || value === "interrupted" ? value : null;

// "interrupted" whenever any evidence says a request was cut off mid-flight,
// or when nothing states a phase: the provider may have received part of it.
// "refused" only when main said so.
export function sealedPhase(error: unknown, depth = 0): SealedPhase | null {
  if (!error || typeof error !== "object" || depth > 3) return null;
  const e = error as Errorish;
  const own = explicitPhase(e.details?.phase) ?? explicitPhase(e.phase);
  if (own) return own;
  const text = textOf(e);
  if (text.includes(`[${SEALED_MODE}:interrupted]`)) return "interrupted";
  if (text.includes(`[${SEALED_MODE}]`)) return "refused";
  const causePhase = sealedPhase(e.cause, depth + 1);
  if (causePhase) return causePhase;
  // A code with no phase is unknown: never "nothing was sent" (T18-06).
  if (e.code === SEALED_MODE) return "interrupted";
  return null;
}

// The translated key for a sealed failure of any surface: "nothing was sent"
// only for a refusal; an interruption says the provider may have received part.
export function sealedGenericMessageKey(error: unknown): string {
  return sealedPhase(error) === "interrupted"
    ? "sealedMode.interrupted.generic"
    : "sealedMode.blocked.generic";
}

// A held operation's actual owner is recovery memory, regardless of global
// retention. Otherwise History is promised only after the saver acknowledged
// that it kept the audio (`audioKept === true`). An interrupted request may
// have reached the provider, so it never says "nothing was sent".
export function sealedDictationMessageKey(
  error: unknown,
  { held = false, audioKept = false }: { held?: boolean; audioKept?: boolean } = {}
): string {
  const family =
    sealedPhase(error) === "interrupted" ? "sealedMode.interrupted" : "sealedMode.blocked";
  if (held) return `${family}.dictationHeld`;
  return `${family}.${audioKept ? "dictationKept" : "dictationNotKept"}`;
}
