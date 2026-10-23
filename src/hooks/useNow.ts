import { useEffect, useState } from "react";

/** 30 s keeps a live label at most half a minute late and rolls "today" over
 * within 30 s of local midnight, at the cost of one cheap re-render. */
export const NOW_TICK_MS = 30_000;

const systemClock = () => new Date();

/** A clock for time-relative UI ("Now", "today"). `readClock` exists so tests
 * can move time exactly; callers leave it at the system clock. */
export function useNow(
  intervalMs: number = NOW_TICK_MS,
  readClock: () => Date = systemClock
): Date {
  const [now, setNow] = useState(readClock);
  useEffect(() => {
    setNow(readClock());
    const id = setInterval(() => setNow(readClock()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, readClock]);
  return now;
}
