/** How the shell asks Chat to do something. A draft is seeded, never sent. */
export type ChatViewRequest =
  | { kind: "new"; draft?: string; nonce: number }
  | { kind: "open"; conversationId: number; nonce: number }
  | { kind: "focus"; nonce: number };

/** Text placed into a composer from outside (palette, Ask AI, a mention
 *  pick). It is never submitted.
 *  - `resetQueue: true`: the seed starts a new intent (new chat, palette
 *    draft, Ask AI). It disarms Plan 02's destination-bound queue, and a
 *    different non-empty draft it replaces moves to Plan 02's unsent buffer
 *    (Restore / Discard) instead of being lost (review I01, I01-R2).
 *  - `resetQueue: false`: an edit of the user's own draft (a mention pick)
 *    or a focus request. The queue and the draft's ownership stay. */
export interface ComposerSeed {
  nonce: number;
  caret?: number; // local edit selection; omitted seeds retain the native caret
  text?: string; // replaces the draft when present
  resetQueue: boolean;
}

/** The seed a Chat request places in the composer. ChatView applies it
 *  during render, so it reaches ChatInput in the same commit as the request. */
export function seedForRequest(request: ChatViewRequest): ComposerSeed {
  if (request.kind === "new")
    return { nonce: request.nonce, text: request.draft, resetQueue: true };
  if (request.kind === "open") return { nonce: request.nonce, resetQueue: true };
  return { nonce: request.nonce, resetQueue: false };
}
