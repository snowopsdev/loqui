import type { NoteItem, TranscriptionItem } from "../../types/electron";
import { fuzzyMatch, substringMatch, type MatchRange } from "../../lib/fuzzyMatch";
import { parseDbTimestamp } from "../../lib/homeFeed";
import { SUGGESTED_COMMAND_IDS, type WorkspaceCommand } from "./commands";

export type PaletteSectionId =
  | "suggested"
  | "recent"
  | "commands"
  | "notes"
  | "meetings"
  | "transcripts"
  | "chats"
  | "folders"
  | "nothing";
type Conversation = { id: number; title: string; updated_at: string };
type Container = { spaceId: number; folderId: number | null; label: string };

export type PaletteRow =
  | { kind: "command"; key: string; command: WorkspaceCommand; label: string; ranges: MatchRange[] }
  | { kind: "note" | "meeting"; key: string; note: NoteItem; ranges: MatchRange[] }
  | { kind: "transcript"; key: string; transcript: TranscriptionItem; ranges: MatchRange[] }
  | { kind: "conversation"; key: string; conversation: Conversation; ranges: MatchRange[] }
  | { kind: "container"; key: string; target: Container; ranges: MatchRange[] }
  | { kind: "seeAllTranscripts"; key: string; total: number }
  | { kind: "ask"; key: string; query: string };

export interface PaletteSection {
  id: PaletteSectionId;
  rows: PaletteRow[];
}

export const PALETTE_CAPS = {
  commands: 6,
  notes: 6,
  meetings: 4,
  transcripts: 8,
  chats: 4,
  folders: 5,
  recent: 5,
} as const;

const noteRow = (note: NoteItem, ranges: MatchRange[]): PaletteRow => {
  const kind = note.note_type === "meeting" ? "meeting" : "note";
  return { kind, key: `${kind}-${note.id}`, note, ranges };
};

export function buildPaletteSections(input: {
  query: string;
  commands: Array<{ command: WorkspaceCommand; label: string }>;
  notes: NoteItem[];
  transcripts: TranscriptionItem[];
  conversations: Conversation[];
  containers: Container[];
}): PaletteSection[] {
  const query = input.query.trim();
  if (!query) {
    const suggested = SUGGESTED_COMMAND_IDS.map((id) =>
      input.commands.find((c) => c.command.id === id)
    )
      .filter((c): c is { command: WorkspaceCommand; label: string } => !!c)
      .map<PaletteRow>(({ command, label }) => ({
        kind: "command",
        key: `command-${command.id}`,
        command,
        label,
        ranges: [],
      }));
    const recent = [
      ...input.notes.map((n) => ({ at: parseDbTimestamp(n.updated_at), row: noteRow(n, []) })),
      ...input.transcripts.map((t) => ({
        at: parseDbTimestamp(t.timestamp),
        row: {
          kind: "transcript",
          key: `transcript-${t.id}`,
          transcript: t,
          ranges: [],
        } as PaletteRow,
      })),
      ...input.conversations.map((c) => ({
        at: parseDbTimestamp(c.updated_at),
        row: {
          kind: "conversation",
          key: `conversation-${c.id}`,
          conversation: c,
          ranges: [],
        } as PaletteRow,
      })),
    ]
      .filter((entry) => !Number.isNaN(entry.at))
      .sort((a, b) => b.at - a.at)
      .slice(0, PALETTE_CAPS.recent)
      .map((entry) => entry.row);
    return [
      { id: "suggested", rows: suggested },
      { id: "recent", rows: recent },
    ].filter((s) => s.rows.length > 0) as PaletteSection[];
  }

  const commands = input.commands
    .map(({ command, label }) => {
      const onLabel = fuzzyMatch(query, label);
      const onKeyword = command.keywords.some((word) => word.startsWith(query.toLocaleLowerCase()));
      if (!onLabel && !onKeyword) return null;
      return {
        score: onLabel?.score ?? 1,
        row: {
          kind: "command",
          key: `command-${command.id}`,
          command,
          label,
          ranges: onLabel?.ranges ?? [],
        } as PaletteRow,
      };
    })
    .filter((hit): hit is { score: number; row: PaletteRow } => !!hit)
    .sort((a, b) => b.score - a.score)
    .slice(0, PALETTE_CAPS.commands)
    .map((hit) => hit.row);

  // Notes come from the database search already; only highlight.
  const titled = input.notes.map((n) => noteRow(n, fuzzyMatch(query, n.title ?? "")?.ranges ?? []));
  const notes = titled.filter((r) => r.kind === "note").slice(0, PALETTE_CAPS.notes);
  const meetings = titled.filter((r) => r.kind === "meeting").slice(0, PALETTE_CAPS.meetings);

  const transcriptHits = input.transcripts
    .map((t) => ({ t, match: substringMatch(query, t.text ?? "") }))
    .filter((hit) => hit.match);
  const transcripts: PaletteRow[] = transcriptHits
    .slice(0, PALETTE_CAPS.transcripts)
    .map(({ t, match }) => ({
      kind: "transcript",
      key: `transcript-${t.id}`,
      transcript: t,
      ranges: match!.ranges,
    }));
  if (transcriptHits.length > PALETTE_CAPS.transcripts) {
    transcripts.push({
      kind: "seeAllTranscripts",
      key: "see-all-transcripts",
      total: transcriptHits.length,
    });
  }

  const chats: PaletteRow[] = input.conversations.slice(0, PALETTE_CAPS.chats).map((c) => ({
    kind: "conversation",
    key: `conversation-${c.id}`,
    conversation: c,
    ranges: fuzzyMatch(query, c.title)?.ranges ?? [],
  }));

  const folders: PaletteRow[] = input.containers
    .map((target) => ({ target, match: fuzzyMatch(query, target.label) }))
    .filter((hit) => hit.match)
    .slice(0, PALETTE_CAPS.folders)
    .map(({ target, match }) => ({
      kind: "container",
      key: `container-${target.spaceId}-${target.folderId}`,
      target,
      ranges: match!.ranges,
    }));

  const sections = (
    [
      { id: "commands", rows: commands },
      { id: "notes", rows: notes },
      { id: "meetings", rows: meetings },
      { id: "transcripts", rows: transcripts },
      { id: "chats", rows: chats },
      { id: "folders", rows: folders },
    ] as PaletteSection[]
  ).filter((section) => section.rows.length > 0);
  return sections.length > 0
    ? sections
    : [{ id: "nothing", rows: [{ kind: "ask", key: "ask", query }] }];
}

export type PaletteSelection =
  | { type: "command"; command: WorkspaceCommand }
  | { type: "note"; noteId: number; folderId: number | null; spaceId: number }
  | { type: "transcript"; transcriptId: number }
  | { type: "conversation"; conversationId: number }
  | { type: "container"; spaceId: number; folderId: number | null }
  | { type: "showAllTranscripts"; query: string }
  | { type: "askDraft"; draft: string };

export function resolvePaletteSelection(row: PaletteRow, query: string): PaletteSelection {
  switch (row.kind) {
    case "command":
      return { type: "command", command: row.command };
    case "note":
    case "meeting":
      return {
        type: "note",
        noteId: row.note.id,
        folderId: row.note.folder_id ?? null,
        spaceId: row.note.space_id,
      };
    case "transcript":
      return { type: "transcript", transcriptId: row.transcript.id };
    case "conversation":
      return { type: "conversation", conversationId: row.conversation.id };
    case "container":
      return { type: "container", spaceId: row.target.spaceId, folderId: row.target.folderId };
    case "seeAllTranscripts":
      return { type: "showAllTranscripts", query: query.trim() };
    case "ask":
      return { type: "askDraft", draft: row.query };
  }
}
