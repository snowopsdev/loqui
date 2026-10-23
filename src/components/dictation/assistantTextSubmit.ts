export interface SelectedContextHooks<C> {
  send: (text: string, options?: { selectedContext: C }) => Promise<boolean>;
  /** Hides the chip as the message goes. */
  clear: () => void;
  /** The context selected now, which may be newer than the one sent. */
  current: () => C | null;
  restore: (context: C) => void;
}

/**
 * Sends typed text with the selected context. When the send is not made
 * (`false` or a rejection), ChatInput keeps the words, so the context
 * comes back too: a retry must not silently drop the attachment. A
 * selection made while the send was in flight wins.
 */
export async function sendWithSelectedContext<C>(
  text: string,
  context: C | null,
  hooks: SelectedContextHooks<C>
): Promise<boolean> {
  if (context) hooks.clear();
  let sent = false;
  try {
    sent = await hooks.send(text, context ? { selectedContext: context } : undefined);
    return sent;
  } finally {
    // `current()` may still read the context just sent: a refusal can
    // resolve before React commits the clear. Only a different
    // selection counts as newer.
    const now = hooks.current();
    if (!sent && context && (now === null || now === context)) hooks.restore(context);
  }
}
