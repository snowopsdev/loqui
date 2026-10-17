import type { NoteItem, TranscriptionItem } from "../types/electron";
import type { HomeFilter } from "../stores/homeViewStore";
import type { Locality } from "./locality";

// WS-R4 B: Home is one chronological feed across dictations, notes and
// meetings, with chips, an in-view search, and dictation sessions.
export const SESSION_GAP_MS = 300_000;

export type HomeEntry =
  | { kind: "dictation"; key: string; at: number; item: TranscriptionItem; words: number }
  | {
      kind: "session";
      key: string;
      at: number;
      items: TranscriptionItem[];
      words: number;
      durationMs: number;
    }
  | { kind: "note"; key: string; at: number; note: NoteItem }
  | { kind: "meeting"; key: string; at: number; note: NoteItem };

export interface HomeDayGroup {
  dayKey: string;
  at: number;
  entries: HomeEntry[];
  captures: number;
  words: number;
}

export interface HomeFeed {
  groups: HomeDayGroup[];
  counts: Record<HomeFilter, number>;
  rows: number;
  captures: number;
}

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

export function parseDbTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  return Date.parse(HAS_ZONE.test(iso) ? iso : `${iso}Z`);
}

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;

export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  if (segmenter) {
    let count = 0;
    for (const segment of segmenter.segment(text)) if (segment.isWordLike) count += 1;
    return count;
  }
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function localDayKey(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const isFoldable = (item: TranscriptionItem) => item.status === "completed";
const matches = (haystacks: Array<string | null | undefined>, needle: string) =>
  !needle || haystacks.some((text) => text?.toLocaleLowerCase().includes(needle));

type Flat = Exclude<HomeEntry, { kind: "session" }>;

export function buildHomeFeed(input: {
  transcriptions: TranscriptionItem[];
  notes: NoteItem[];
  filter: HomeFilter;
  query: string;
  sessionGapMs?: number;
}): HomeFeed {
  const gap = input.sessionGapMs ?? SESSION_GAP_MS;
  const needle = input.query.trim().toLocaleLowerCase();

  const timeline: Flat[] = [];
  for (const item of input.transcriptions) {
    const at = parseDbTimestamp(item.timestamp);
    if (Number.isNaN(at)) continue;
    timeline.push({
      kind: "dictation",
      key: `dictation-${item.id}`,
      at,
      item,
      words: countWords(item.text),
    });
  }
  for (const note of input.notes) {
    const at = parseDbTimestamp(note.updated_at);
    if (Number.isNaN(at)) continue;
    const kind = note.note_type === "meeting" ? "meeting" : "note";
    timeline.push({ kind, key: `${kind}-${note.id}`, at, note });
  }

  timeline.sort((a, b) => b.at - a.at);
  const matchesQuery = (entry: Flat) =>
    entry.kind === "dictation"
      ? matches([entry.item.text, entry.item.raw_text], needle)
      : matches([entry.note.title, entry.note.content], needle);
  const searched = timeline.filter(matchesQuery);

  const isFailed = (entry: Flat) => entry.kind === "dictation" && entry.item.status === "failed";
  const counts: Record<HomeFilter, number> = {
    all: searched.length,
    dictations: searched.filter((entry) => entry.kind === "dictation").length,
    meetings: searched.filter((entry) => entry.kind === "meeting").length,
    notes: searched.filter((entry) => entry.kind === "note").length,
    failed: searched.filter(isFailed).length,
  };

  const visible = timeline
    .map((entry, timelineIndex) => ({ entry, timelineIndex }))
    .filter(({ entry }) => {
      if (!matchesQuery(entry)) return false;
      switch (input.filter) {
        case "dictations":
          return entry.kind === "dictation";
        case "meetings":
          return entry.kind === "meeting";
        case "notes":
          return entry.kind === "note";
        case "failed":
          return isFailed(entry);
        default:
          return true;
      }
    });

  const entries: HomeEntry[] = [];
  const entryTimelineIndices: number[] = [];
  for (const { entry, timelineIndex } of visible) {
    const previous = entries.at(-1);
    const canJoin =
      entry.kind === "dictation" &&
      isFoldable(entry.item) &&
      previous &&
      // Session adjacency follows the recorded timeline, not current visibility.
      entryTimelineIndices.at(-1) === timelineIndex - 1 &&
      (previous.kind === "session" ||
        (previous.kind === "dictation" && isFoldable(previous.item))) &&
      localDayKey(previous.at) === localDayKey(entry.at);
    if (canJoin) {
      const items = previous.kind === "session" ? previous.items : [previous.item];
      const lastAt = parseDbTimestamp(items.at(-1)!.timestamp);
      if (lastAt - entry.at <= gap) {
        const merged = [...items, entry.item];
        entries[entries.length - 1] = {
          kind: "session",
          key: `session-${merged[0].id}`,
          at: parseDbTimestamp(merged[0].timestamp),
          items: merged,
          words: merged.reduce((sum, item) => sum + countWords(item.text), 0),
          durationMs: merged.reduce((sum, item) => sum + (item.audio_duration_ms ?? 0), 0),
        };
        entryTimelineIndices[entryTimelineIndices.length - 1] = timelineIndex;
        continue;
      }
    }
    entries.push(entry);
    entryTimelineIndices.push(timelineIndex);
  }

  const groups: HomeDayGroup[] = [];
  for (const entry of entries) {
    const dayKey = localDayKey(entry.at);
    let group = groups.at(-1);
    if (!group || group.dayKey !== dayKey) {
      group = { dayKey, at: entry.at, entries: [], captures: 0, words: 0 };
      groups.push(group);
    }
    group.entries.push(entry);
    if (entry.kind === "dictation") {
      group.captures += 1;
      group.words += entry.words;
    } else if (entry.kind === "session") {
      group.captures += entry.items.length;
      group.words += entry.words;
    }
  }

  return {
    groups,
    counts,
    rows: entries.length,
    captures: groups.reduce((sum, group) => sum + group.captures, 0),
  };
}

export function locateTranscript(
  feed: HomeFeed,
  transcriptId: number
): { dayKey: string; entryKey: string; inSession: boolean } | null {
  for (const group of feed.groups) {
    for (const entry of group.entries) {
      if (entry.kind === "dictation" && entry.item.id === transcriptId) {
        return { dayKey: group.dayKey, entryKey: entry.key, inSession: false };
      }
      if (entry.kind === "session" && entry.items.some((item) => item.id === transcriptId)) {
        return { dayKey: group.dayKey, entryKey: entry.key, inSession: true };
      }
    }
  }
  return null;
}

// A missing provider is unrecorded history, never a guess. The URL of a
// self-hosted transcription is not recorded, so its locality is network.
export function transcriptionLocality(
  provider: string | null | undefined
): { locality: Locality; providerId: string | null } | null {
  if (!provider) return null;
  if (provider === "local" || provider.startsWith("local-"))
    return { locality: "device", providerId: null };
  if (provider === "self-hosted") return { locality: "network", providerId: null };
  return { locality: "remote", providerId: provider };
}
