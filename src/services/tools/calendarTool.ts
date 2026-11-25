import type { ToolDefinition, ToolResult } from "./ToolRegistry";
import { getMeetingJoinUrl } from "../../helpers/meetingJoinUrl";

type TimeRange = "today" | "tomorrow" | "week";

function getWindowMinutes(timeRange: TimeRange): number {
  if (timeRange === "week") return 10080;

  const now = new Date();
  if (timeRange === "tomorrow") {
    const endOfTomorrow = new Date(now);
    endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);
    endOfTomorrow.setHours(23, 59, 59, 999);
    return Math.ceil((endOfTomorrow.getTime() - now.getTime()) / 60000);
  }

  // "today": remaining minutes until midnight
  const midnight = new Date(now);
  midnight.setHours(23, 59, 59, 999);
  return Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 60000));
}

// Large all-hands invites carry hundreds of attendees; the model needs who is
// in the room, not a token-heavy roster, so the list is capped and the total kept.
const MAX_ATTENDEES = 25;

interface CalendarAttendee {
  name: string | null;
  email: string | null;
  responseStatus: string | null;
  self: boolean;
}

// calendar_events.attendees is JSON written by the Google and Apple calendar
// managers: [{ email, displayName, responseStatus, self }].
export function parseAttendees(raw: unknown): CalendarAttendee[] {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  return parsed.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const a = entry as Record<string, unknown>;
    const attendee = {
      name: text(a.displayName),
      email: text(a.email),
      responseStatus: text(a.responseStatus),
      self: a.self === true,
    };
    return attendee.name || attendee.email ? [attendee] : [];
  });
}

export const calendarTool: ToolDefinition = {
  name: "get_calendar_events",
  description:
    "Get upcoming events from the user's connected calendars for a given time range. Returns event summaries, start/end times, meeting join links, and attendees (name, email, RSVP status; self marks the user) so you can help the user prepare for who they are meeting.",
  parameters: {
    type: "object",
    properties: {
      timeRange: {
        type: "string",
        enum: ["today", "tomorrow", "week"],
        description: 'Time range to fetch events for (default "today")',
      },
    },
    required: [],
    additionalProperties: false,
  },
  readOnly: true,

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const timeRange = (args.timeRange as TimeRange) || "today";
    const windowMinutes = getWindowMinutes(timeRange);

    try {
      const response = await window.electronAPI.gcalGetUpcomingEvents!(windowMinutes);

      if (!response.success) {
        return {
          success: false,
          data: null,
          displayText: "Failed to fetch calendar events",
        };
      }

      // Rows come straight from the calendar_events table (start_time/end_time
      // columns; there is no location column — the join link is what the DB
      // actually has for "where").
      const events = response.events.map((event: Record<string, unknown>) => {
        const attendees = parseAttendees(event.attendees);
        const total =
          typeof event.attendees_count === "number"
            ? Math.max(event.attendees_count, attendees.length)
            : attendees.length;
        return {
          summary: event.summary || "(No title)",
          start: event.start_time,
          end: event.end_time,
          joinUrl: getMeetingJoinUrl(event),
          attendees: attendees.slice(0, MAX_ATTENDEES),
          ...(total > MAX_ATTENDEES ? { attendeeCount: total } : {}),
        };
      });

      if (events.length === 0) {
        return {
          success: true,
          data: [],
          displayText: `No events found for ${timeRange}`,
        };
      }

      return {
        success: true,
        data: events,
        displayText: `Found ${events.length} event${events.length === 1 ? "" : "s"} for ${timeRange}`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        displayText: `Failed to fetch calendar events: ${(error as Error).message}`,
      };
    }
  },
};
