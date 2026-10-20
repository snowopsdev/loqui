import type { CalendarEvent } from "../types/calendar";
import { parseEventDate } from "../utils/dateFormatting";
import { getMeetingJoinUrl, openJoinUrl } from "../helpers/meetingJoinUrl";

export type EventStart =
  { kind: "now" } | { kind: "minutes"; minutes: number } | { kind: "later"; at: Date };

export function describeStart(event: CalendarEvent, now: Date): EventStart {
  const start = parseEventDate(event.start_time) ?? new Date(Number.NaN);
  const end = parseEventDate(event.end_time) ?? new Date(Number.NaN);
  if (start <= now && now <= end) return { kind: "now" };
  const minutes = Math.ceil((start.getTime() - now.getTime()) / 60_000);
  return minutes < 60 ? { kind: "minutes", minutes } : { kind: "later", at: start };
}

export function nextUpcomingEvent(
  events: CalendarEvent[],
  now: Date
): { event: CalendarEvent; start: EventStart } | null {
  const candidates = events
    .map((event) => ({
      event,
      start: parseEventDate(event.start_time),
      end: parseEventDate(event.end_time),
    }))
    .filter(
      (candidate): candidate is { event: CalendarEvent; start: Date; end: Date } =>
        candidate.event.is_all_day !== 1 &&
        candidate.event.status !== "cancelled" &&
        candidate.start !== null &&
        candidate.end !== null &&
        candidate.end >= now
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const next =
    candidates.find(({ start, end }) => start <= now && now <= end) ??
    candidates.find(({ start }) => start > now);
  return next ? { event: next.event, start: describeStart(next.event, now) } : null;
}

// One explicit action for both Home surfaces; existing opener and IPC authority.
export function startMeetingNotes(event: CalendarEvent): void {
  const joinUrl = getMeetingJoinUrl(event);
  if (joinUrl) openJoinUrl(joinUrl);
  void window.electronAPI?.joinCalendarMeeting?.(event.id);
}
