import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Dispatch, SetStateAction } from "react";

/** One paint owner per Table. Logical actions never run in this queue. */
export function createTablePublication() {
  let frame: number | null = null;
  let active = true;
  let revision = 0;
  const pending = new Map<object, () => void>();
  const flush = (owner: number) => {
    if (owner !== revision) return;
    frame = null;
    if (!active) return;
    const callbacks = [...pending.values()];
    pending.clear();
    flushSync(() => callbacks.forEach((callback) => callback()));
  };
  return {
    schedule(key: object, publish: () => void) {
      if (!active) return;
      pending.set(key, publish);
      if (frame === null) {
        const owner = revision;
        frame = requestAnimationFrame(() => flush(owner));
      }
    },
    cancel(key: object) {
      pending.delete(key);
      if (!pending.size && frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
        revision++;
      }
    },
    flushNow() {
      if (!active || !pending.size) return;
      revision++;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      const callbacks = [...pending.values()];
      pending.clear();
      flushSync(() => callbacks.forEach((callback) => callback()));
    },
    activate() {
      active = true;
    },
    dispose() {
      revision++;
      active = false;
      pending.clear();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    },
  };
}

export type TablePublication = ReturnType<typeof createTablePublication>;

/** Paint snapshots share a frame; the returned ref is always the current value. */
export function useTablePaintState<T>(initial: T, publication?: TablePublication) {
  const [paint, publish] = useState(initial);
  const current = useRef(paint);
  const key = useRef({});
  // An ancestor may render while a Table snapshot is waiting for its frame.
  // Consume the current logical snapshot in that render, then retire only the
  // queued publication that this committed render actually covered.
  const snapshot = publication ? current.current : paint;
  useLayoutEffect(() => {
    if (publication && Object.is(snapshot, current.current)) publication.cancel(key.current);
  });
  const set: Dispatch<SetStateAction<T>> = useCallback(
    (action) => {
      const next =
        typeof action === "function" ? (action as (previous: T) => T)(current.current) : action;
      if (Object.is(next, current.current)) return;
      current.current = next;
      if (publication) publication.schedule(key.current, () => publish(current.current));
      else publish(next);
    },
    [publication]
  );
  useLayoutEffect(() => {
    const owner = key.current;
    return () => publication?.cancel(owner);
  }, [publication]);
  const reset = useCallback(
    (value: T) => {
      publication?.cancel(key.current);
      current.current = value;
      publish(value);
    },
    [publication]
  );
  const project = useCallback((value: T) => {
    current.current = value;
  }, []);
  return [snapshot, set, current, reset, project] as const;
}
