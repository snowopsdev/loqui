// Every non-streaming reasoning request (cleanup, note formatting, chat/dictation
// agent tool calls, self-hosted LAN calls) shares one configurable abort timeout.
// Self-hosted/local models can legitimately take well past the historical 30s
// default; the range below just keeps a bad or hand-edited value from firing
// instantly or hanging forever. Streaming requests have their own inactivity
// timeouts and don't use this.
export const LLM_REQUEST_TIMEOUT_SECONDS_MIN = 10;
export const LLM_REQUEST_TIMEOUT_SECONDS_MAX = 600;
export const LLM_REQUEST_TIMEOUT_SECONDS_DEFAULT = 30;

export function resolveLlmRequestTimeoutSeconds(configured) {
  const seconds = Number.isFinite(configured) ? configured : LLM_REQUEST_TIMEOUT_SECONDS_DEFAULT;
  return Math.min(
    LLM_REQUEST_TIMEOUT_SECONDS_MAX,
    Math.max(LLM_REQUEST_TIMEOUT_SECONDS_MIN, seconds)
  );
}
