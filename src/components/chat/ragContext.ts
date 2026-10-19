import { isSourceId, sourceQuote, truncateSourceText } from "./citations.ts";
import type { RagNoteRef } from "./citations";
type ElectronAPI = Window["electronAPI"];

type RagApi = Partial<Pick<ElectronAPI, "semanticSearchNotes" | "getNote">>;
const RAG_NOTE_LIMIT = 5;
const RAG_NOTE_SNIPPET_LENGTH = 500;
const attr = (value: string) =>
  value.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]!);

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
    const notes = loaded.filter((note) => note && isSourceId(note.id));
    return {
      text: notes
        .map(
          (note) =>
            `<note id="${note.id}" title="${attr(note.title)}">\n${truncateSourceText(note.content || "", RAG_NOTE_SNIPPET_LENGTH)}\n</note>`
        )
        .join("\n\n"),
      notes: notes.map((note) => ({
        id: note.id,
        title: note.title,
        type: note.note_type ?? null,
        date: note.updated_at ?? null,
        quote: sourceQuote(note.content || ""),
      })),
    };
  } catch {
    return { text: "", notes: [] };
  }
}
