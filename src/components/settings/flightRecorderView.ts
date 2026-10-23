import type { EgressEvent, EgressNotice, EgressOutcome, EgressTask } from "../../types/privacy";

// Pure view model for the flight recorder (Plan 07, SET-M3). The panel shows
// one window, "today since local midnight", and fetches exactly that window
// (A21): the list, the counts and the timeline all use the same `since`.
// A record belongs to the day it was still running in: a request that started
// before midnight and finished after it is today's, as main lists it.

export type TickKind = "sent" | "session" | "blocked" | "unexplained";
export type Tick = {
  id: number;
  minute: number;
  // Where the tick sits along the day, 0..1 (a DST day is 23 or 25 hours).
  position: number;
  kind: TickKind;
  event: EgressEvent;
};

export const TASKS: readonly EgressTask[] = [
  "dictationStt",
  "noteRecordingStt",
  "uploadStt",
  "dictationCleanup",
  "voiceAssistant",
  "assistantVision",
  "translation",
  "noteFormatting",
  "chat",
  "speakerId",
  "semanticSearch",
  "providerCheck",
  "modelDownload",
  "runtimeDownload",
  "urlImport",
  "appUpdate",
  "codex",
  "calendar",
  "nativeLaunch",
  "unattributed",
];
export const OUTCOMES: readonly EgressOutcome[] = ["ok", "error", "blocked", "cancelled"];
// Main's bounded error categories (Task 4 ERROR_CLASSES); anything else is OTHER.
export const ERROR_CLASSES = [
  "SEALED_MODE",
  "ABORTED",
  "TIMEOUT",
  "DNS",
  "CONNECTION",
  "TLS",
  "HTTP_4XX",
  "HTTP_5XX",
  "PROTOCOL",
  "BODY_CANCELLED",
  "DOWNLOAD_CANCELLED",
  "UPDATE_FAILED",
  "CHILD_EXIT",
  "OTHER",
] as const;

// The page fetches this many rows at first, and at most MAX_LIMIT (main's own cap).
export const PAGE_SIZE = 500;
export const MAX_LIMIT = 5000;
// With local history off, main keeps only this many records, in memory.
export const MEMORY_ROWS = 500;

// Only metadata enum IDs reach a translation key; an unexpected value cannot
// address an arbitrary key.
export const taskId = (task: string): EgressTask =>
  (TASKS as readonly string[]).includes(task) ? (task as EgressTask) : "unattributed";
export const outcomeId = (outcome: string): EgressOutcome =>
  (OUTCOMES as readonly string[]).includes(outcome) ? (outcome as EgressOutcome) : "error";
export const errorClassId = (value: string | null): string | null =>
  value == null ? null : (ERROR_CLASSES as readonly string[]).includes(value) ? value : "OTHER";

// A program start main refused while sealed (I1). It is not a request,
// whatever kind a row claims, so it is never a row, a tick or a live addition.
const isProgramStart = (e: Pick<EgressEvent, "task">) => e.task === "nativeLaunch";

// Operations that never reached a transport did not leave; they are not shown.
export const shownEvents = (events: EgressEvent[]): EgressEvent[] =>
  events.filter((e) => e.kind !== "operation" && !isProgramStart(e));

// The programs main refused to start in the window, by name, once each (main
// records one row per program per seal). An unnamed program is only counted.
export function refusedPrograms(events: EgressEvent[], since: number): string[] {
  const names = events
    .filter((e) => isProgramStart(e) && inWindow(e, since))
    .map((e) => (e.host ?? "").replace(/^native-/, ""))
    .filter((name) => name && name !== "unknown");
  return [...new Set(names)];
}

export function startOfToday(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

// The start of the local day after `since` (DST-safe: 23, 24 or 25 hours
// later). The date moves first: in a zone where DST starts at midnight (e.g.
// America/Santiago) the day's first instant is 01:00, and resetting the hours
// before moving the date would carry that 01:00 into the next day.
export function startOfNextDay(since: number): number {
  const day = new Date(since);
  day.setDate(day.getDate() + 1);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

// A record is in the day starting at `since` if it started before the day
// ends and ended at or after the day began (main's list uses the same rule,
// so the counts and the rows agree).
export function inWindow(e: Pick<EgressEvent, "ts" | "endedAt">, since: number): boolean {
  return e.ts < startOfNextDay(since) && Math.max(e.ts, e.endedAt ?? e.ts) >= since;
}

export function tickKind(e: EgressEvent): TickKind {
  if (e.outcome === "blocked") return "blocked";
  if (!e.attributed) return "unexplained";
  return e.opaque || e.kind === "session" ? "session" : "sent";
}

// One tick per shown record inside the day that starts at `since`. A record
// that started before midnight is drawn at the start of the day.
export function timelineTicks(events: EgressEvent[], since: number): Tick[] {
  const span = startOfNextDay(since) - since;
  return shownEvents(events)
    .filter((e) => inWindow(e, since))
    .map((e) => ({
      id: e.id,
      minute: Math.max(0, Math.floor((e.ts - since) / 60000)),
      position: dayPosition(e.ts, since, span),
      kind: tickKind(e),
      event: e,
    }));
}

function dayPosition(ms: number, since: number, span: number): number {
  return Math.min(1, Math.max(0, (ms - since) / span));
}

// When the list is cut at the fetch limit, the timeline only has the newest
// rows: the hours before the oldest fetched row are not drawn. Returns that
// part of the day (0..1) so the view can mark it, or null when nothing is cut.
export function undrawnUntil(
  events: EgressEvent[],
  since: number,
  truncated: boolean
): number | null {
  if (!truncated) return null;
  const starts = shownEvents(events)
    .filter((e) => inWindow(e, since))
    .map((e) => e.ts);
  if (starts.length === 0) return 1;
  return dayPosition(Math.min(...starts), since, startOfNextDay(since) - since);
}

// A live "recorded" notice joins the list once, if it belongs to the window.
// Dispatch receipts and operations that never left are not rows.
export function mergeNotice(
  events: EgressEvent[],
  notice: EgressNotice,
  since: number
): EgressEvent[] {
  if (notice.phase !== "recorded") return events;
  const event = notice.event;
  if (!event || !inWindow(event, since)) return events;
  if (event.kind === "operation" || isProgramStart(event)) return events;
  if (events.some((e) => e.id === event.id)) return events;
  return [event, ...events];
}

// Main reports null when it could not measure; that is not zero.
export function bytesCell(
  n: number | null,
  format: (n: number) => string
): { text: string; unknown: boolean } {
  return n == null ? { text: "—", unknown: true } : { text: format(n), unknown: false };
}

// Sent bytes for a row that did leave. Only a refusal records 0 sent, and a
// refused row says "Not sent" instead of a number; a 0 anywhere else would
// read as "nothing left" for a request whose headers did, so it is unknown.
export function sentCell(
  e: EgressEvent,
  format: (n: number) => string
): { text: string; unknown: boolean } {
  return bytesCell(e.bytesOut === 0 ? null : e.bytesOut, format);
}

// Every host the request reached, in order (redirects, CDN hosts).
export function hostTrail(e: EgressEvent): string {
  return (e.hosts?.length ? e.hosts : [e.host]).join(" → ");
}

// Start time, plus the end time when the request ran for a second or more.
export function timeCell(e: EgressEvent, formatTime: (ms: number) => string): string {
  return e.endedAt != null && e.endedAt - e.ts >= 1000
    ? `${formatTime(e.ts)}–${formatTime(e.endedAt)}`
    : formatTime(e.ts);
}

// Hostnames are always left-to-right. Inside translated sentences they are
// wrapped in a left-to-right isolate (LRI…PDI) so RTL copy cannot reorder them.
export const ltr = (text: string): string => `⁦${text}⁩`;

// The IPC rejection carries main's stable code inside Electron's wrapper text.
export function classifyRecorderError(error: unknown): "unavailable" | "failed" {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return text.includes("PRIVACY_RECORDER_UNAVAILABLE") ? "unavailable" : "failed";
}
