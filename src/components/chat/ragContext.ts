import { isSourceId, sourceQuote, truncateSourceText } from "./citations.ts";
import type { RagNoteRef } from "./citations";
type ElectronAPI = Window["electronAPI"];

type RagApi = Partial<Pick<ElectronAPI, "semanticSearchNotes" | "getNote">>;
const RAG_NOTE_LIMIT = 5;
const RAG_NOTE_SNIPPET_LENGTH = 500;
const attr = (value: string) =>
  value.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]!);

type TranscriptSegment = { text?: unknown; speakerName?: unknown; speakerIsPlaceholder?: unknown };

// The notes table stores a transcript as a JSON array of segments. Speaker
// labels are kept only when a person was actually named.
export function formatTranscript(transcript: string | null | undefined): string {
  if (!transcript) return "";
  let segments: unknown;
  try {
    segments = JSON.parse(transcript);
  } catch {
    return transcript.trim();
  }
  if (!Array.isArray(segments)) return "";
  return (segments as TranscriptSegment[])
    .map((segment) => {
      const text = typeof segment?.text === "string" ? segment.text.trim() : "";
      if (!text) return "";
      const name = typeof segment.speakerName === "string" ? segment.speakerName.trim() : "";
      return name && !segment.speakerIsPlaceholder ? `${name}: ${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
}

// Recorded meetings and uploaded audio usually have no typed notes: their text
// lives in the AI summary or the transcript. Match get_note/search_notes, which
// read the summary first, and fall back to the transcript rather than nothing.
export function noteSourceText(note: {
  content?: string | null;
  enhanced_content?: string | null;
  transcript?: string | null;
}): string {
  return note.enhanced_content || note.content || formatTranscript(note.transcript);
}

export async function buildRagContext(
  api: RagApi,
  userText: string,
  scope?: { spaceId?: number | null; folderId?: number | null }
): Promise<{ text: string; notes: RagNoteRef[] }> {
  if (!api?.semanticSearchNotes || !api.getNote) return { text: "", notes: [] };
  try {
    const results = await api.semanticSearchNotes(
      userText,
      RAG_NOTE_LIMIT,
      scope?.spaceId ?? null,
      scope?.folderId ?? null
    );
    const loaded = await Promise.all(
      (results ?? [])
        .filter((r) => isSourceId(r?.id))
        .slice(0, RAG_NOTE_LIMIT)
        .map((r) => api.getNote!(r.id))
    );
    const notes = loaded
      .filter((note) => note && isSourceId(note.id))
      .map((note) => ({ note, body: noteSourceText(note) }));
    return {
      text: notes
        .map(
          ({ note, body }) =>
            `<note id="${note.id}" title="${attr(note.title)}">\n${truncateSourceText(body, RAG_NOTE_SNIPPET_LENGTH)}\n</note>`
        )
        .join("\n\n"),
      notes: notes.map(({ note, body }) => ({
        id: note.id,
        title: note.title,
        type: note.note_type ?? null,
        date: note.updated_at ?? null,
        quote: sourceQuote(body),
      })),
    };
  } catch {
    return { text: "", notes: [] };
  }
}
