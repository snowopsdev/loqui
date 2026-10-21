import { useState } from "react";

/**
 * Radix returns focus to a Dialog.Trigger on close; dialogs opened from a
 * button, shortcut or palette have none, so focus fell to <body>. Remember the
 * invoker when the dialog takes focus and return to it on close, unless the
 * closing action already moved focus somewhere real (such as an opened note).
 */
export function createDialogReturnFocus(doc: Pick<Document, "activeElement" | "body">) {
  let invoker: HTMLElement | null = null;
  return {
    remember() {
      const active = doc.activeElement as HTMLElement | null;
      invoker = active && active !== doc.body && typeof active.focus === "function" ? active : null;
    },
    restore(event: Pick<Event, "preventDefault" | "currentTarget">) {
      const target = invoker;
      invoker = null;
      const content = event.currentTarget as Node | null;
      const active = doc.activeElement;
      const unclaimed = !active || active === doc.body || !!content?.contains?.(active);
      if (!unclaimed) {
        event.preventDefault();
        return;
      }
      if (target?.isConnected) {
        event.preventDefault();
        target.focus({ preventScroll: true });
      }
    },
  };
}

export function useDialogReturnFocus() {
  return useState(() => createDialogReturnFocus(document))[0];
}
