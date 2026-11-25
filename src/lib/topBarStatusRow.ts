// The workspace top bar shows a live status (the meeting recording pill)
// inline beside Capture and the window controls. When the header is too narrow
// for all of them, the status moves to its own row below the header instead of
// pushing the controls past the edge.

export interface StatusRowState {
  /** The status sits in its own row below the header. */
  stacked: boolean;
  /** Header width the inline layout needed when it last overflowed. */
  neededWidth: number;
}

export const INLINE_STATUS_ROW: StatusRowState = { stacked: false, neededWidth: 0 };

/**
 * Decide where the status goes after measuring the header. Inline, an
 * overflowing header (scrollWidth past clientWidth) stacks the status and
 * remembers the width the inline layout needed. Stacked, it returns inline only
 * once the header is at least that wide again, so it never flips back and forth
 * at a single width.
 */
export function nextStatusRow(
  state: StatusRowState,
  header: { clientWidth: number; scrollWidth: number }
): StatusRowState {
  if (!state.stacked) {
    return header.scrollWidth > header.clientWidth + 1
      ? { stacked: true, neededWidth: header.scrollWidth }
      : state;
  }
  return header.clientWidth >= state.neededWidth ? INLINE_STATUS_ROW : state;
}
