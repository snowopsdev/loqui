import type { CalendarEvent } from "../types/calendar";
import { parseEventDate } from "./dateFormatting";

// Today plus the next days that have events, capped at a working week.
export const MAX_DAY_CARDS = 5;

export interface DayGroup {
  key: string;
  date: Date;
  isToday: boolean;
  items: CalendarEvent[];
}

export function groupEventsByDay(events: CalendarEvent[], now: Date): DayGroup[] {
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const event of events) {
    const date = parseEventDate(event.start_time);
    if (!date) continue;
    const key = date.toDateString();
    let group = byKey.get(key);
    if (!group) {
      group = { key, date, isToday: key === now.toDateString(), items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(event);
  }
  // Surface "today" even when it has nothing scheduled, so the list always
  // answers "what's next today?" at a glance.
  if (groups.length > 0 && !groups.some((g) => g.isToday)) {
    groups.unshift({ key: now.toDateString(), date: now, isToday: true, items: [] });
  }
  return groups.slice(0, MAX_DAY_CARDS);
}

/** Live from start to end, inclusive. Uses parseEventDate like the grouping
 * above, so an all-day "YYYY-MM-DD" event is read in local time, not UTC
 * (the old isNowFn used new Date() and disagreed west of UTC). Unparseable
 * times compare false. */
export function isEventLive(
  event: Pick<CalendarEvent, "start_time" | "end_time">,
  now: Date
): boolean {
  const start = parseEventDate(event.start_time);
  const end = parseEventDate(event.end_time);
  if (!start || !end) return false;
  return start <= now && now <= end;
}
