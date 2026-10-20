import type { MentionResult } from "../../lib/mentionSearch";
import { collectSources, type RagNoteRef } from "./citations";
import type { Message, ToolCallInfo } from "./types";

export const RAIL_STORAGE_KEY = "chat.contextRailOpen";
const PINNED_NOTE_CHARS = 1500;
const FOLDER_NOTES = 5;
const FOLDER_NOTE_CHARS = 500;

export interface PinnedContextItem {
  kind: "note" | "meeting" | "folder" | "dictation";
  id: number;
  label: string;
}
export interface RailModel {
  pinned: PinnedContextItem[];
  found: Array<{ noteId: number; title: string; kind: "note" | "meeting" }>;
  activity: Array<{ key: string; toolName: string; status: ToolCallInfo["status"]; label: string }>;
}

export function buildRailModel(
  messages: Message[],
  pinned: PinnedContextItem[],
  labelFor: (tc: ToolCallInfo) => string
): RailModel {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const pinnedIds = new Set(
    pinned.filter((p) => p.kind === "note" || p.kind === "meeting").map((p) => p.id)
  );
  const found = [
    ...collectSources(lastAssistant?.toolCalls, lastAssistant?.context?.ragNotes).values(),
  ]
    .filter((s) => !pinnedIds.has(s.noteId))
    .map((s) => ({ noteId: s.noteId, title: s.title, kind: s.kind }));
  const activity = messages.flatMap((m) =>
    (m.toolCalls ?? []).map((tc) => ({
      key: `${m.id}-${tc.id}`,
      toolName: tc.name,
      status: tc.status,
      label: labelFor(tc),
    }))
  );
  return { pinned, found, activity };
}

const MENTION_QUERY = /(^|\s)@([^\s@]{0,26})$/;
export function detectMentionQuery(
  text: string,
  caret: number
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = before.match(MENTION_QUERY);
  if (!match) return null;
  return { start: before.length - match[2].length - 1, query: match[2] };
}

export function removeMentionQuery(text: string, match: { start: number; query: string }): string {
  const end = match.start + 1 + match.query.length;
  if (text.slice(match.start, end) !== `@${match.query}`) return text;
  // Remove at most the single separator at this join. Never normalize the draft.
  const joinEnd =
    match.start > 0 && text[match.start - 1] === " " && text[end] === " " ? end + 1 : end;
  return text.slice(0, match.start) + text.slice(joinEnd);
}

export function pinnedFromMention(result: MentionResult): PinnedContextItem | null {
  if (
    result.kind === "person" ||
    !result.entityId ||
    !/^[1-9]\d*$/.test(result.entityId) ||
    !validId(Number(result.entityId))
  )
    return null;
  return { kind: result.kind, id: Number(result.entityId), label: result.label };
}

const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
// Keep the existing UTF-16 length budgets without splitting a surrogate pair.
const bounded = (text: string, max: number) => {
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
};
const attr = (v: string) =>
  v.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]!);
export interface PinnedContextApi {
  getNote(id: number): Promise<{
    id: number;
    title: string;
    content?: string | null;
    enhanced_content?: string | null;
    deleted_at?: string | null;
    note_type?: string | null;
  } | null>;
  getNotes(
    noteType: string | null,
    limit: number,
    folderId: number | null
  ): Promise<
    Array<{
      id: number;
      title: string;
      content?: string | null;
      deleted_at?: string | null;
      note_type?: string | null;
    }>
  >;
  getTranscriptionById(
    id: number
  ): Promise<{ id: number; text: string; deleted_at?: string | null; status?: string } | null>;
}

// What the user pinned is what the model receives: the rail never shows a
// control that does not change the prompt.
const ref = (
  n: {
    id: number;
    title: string;
    content?: string | null;
    deleted_at?: string | null;
    note_type?: string | null;
  },
  body: string
): RagNoteRef => ({
  id: n.id,
  title: n.title,
  type: n.note_type ?? null,
  date: null,
  quote: bounded(body.replace(/\s+/g, " ").trim(), 240),
});

export async function buildPinnedContext(
  items: PinnedContextItem[],
  api: PinnedContextApi
): Promise<{ text: string; notes: RagNoteRef[] }> {
  const parts = await Promise.all(
    items.map(async (item): Promise<{ text: string; notes: RagNoteRef[] } | null> => {
      try {
        if (!validId(item.id)) return null;
        if (item.kind === "note" || item.kind === "meeting") {
          const note = await api.getNote(item.id);
          if (!note || note.deleted_at || !validId(note.id)) return null;
          const body = bounded(note.enhanced_content || note.content || "", PINNED_NOTE_CHARS);
          return {
            text: `<note id="${note.id}" title="${attr(note.title)}">\n${body}\n</note>`,
            notes: [ref(note, body)],
          };
        }
        if (item.kind === "folder") {
          const notes = (await api.getNotes(null, FOLDER_NOTES, item.id))
            .slice(0, FOLDER_NOTES)
            .filter((n) => !n.deleted_at && validId(n.id));
          if (notes.length === 0) return null;
          return {
            text: notes
              .map(
                (n) =>
                  `<note id="${n.id}" title="${attr(n.title)}">\n${bounded(n.content || "", FOLDER_NOTE_CHARS)}\n</note>`
              )
              .join("\n\n"),
            notes: notes.map((n) => ref(n, bounded(n.content || "", FOLDER_NOTE_CHARS))),
          };
        }
        const dictation = await api.getTranscriptionById(item.id);
        return dictation &&
          !dictation.deleted_at &&
          dictation.status !== "discarded" &&
          validId(dictation.id)
          ? { text: `<dictation id="${dictation.id}">\n${dictation.text}\n</dictation>`, notes: [] }
          : null;
      } catch {
        return null;
      }
    })
  );
  const present = parts.filter((p): p is { text: string; notes: RagNoteRef[] } => !!p);
  return { text: present.map((p) => p.text).join("\n\n"), notes: present.flatMap((p) => p.notes) };
}
