import type { ToolCallInfo } from "./types";
import { parseCitationMarkdown, visitEligibleCitationText } from "./citationMarkdown.ts";

export interface SourceHit extends Record<string, unknown> {
  id: number;
  title: string;
  date: string | null;
  type: string | null;
  quote: string;
}
export interface RagNoteRef {
  id: number;
  title: string;
  type: string | null;
  date: string | null;
  quote: string;
}
export interface CitationSource {
  n: number | null;
  noteId: number;
  title: string;
  kind: "note" | "meeting";
  date: string | null;
  quote: string;
}

export const CITATION_MARKER = /\[note:(\d+)\]/g;
const UNCITED_MAX = 5;
const NOTE_TOOLS = new Set(["get_note", "create_note", "update_note"]);

export function isSourceId(id: unknown): id is number {
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}

// Bound stored excerpts in UTF-16 units without leaving a split surrogate pair.
export function truncateSourceText(content: string, limit: number): string {
  const text = content.slice(0, limit);
  return /[\uD800-\uDBFF]$/.test(text) ? text.slice(0, -1) : text;
}

export function sourceQuote(content: string): string {
  return truncateSourceText(content.replace(/\s+/g, " ").trim(), 240);
}

const toHit = (raw: Record<string, unknown>): SourceHit | undefined => {
  if (!isSourceId(raw.id)) return undefined;
  return {
    id: raw.id,
    title: typeof raw.title === "string" ? raw.title : "",
    date:
      ([raw.date, raw.updated_at, raw.created_at].find((v) => typeof v === "string") as string) ??
      null,
    type: typeof raw.type === "string" ? raw.type : null,
    quote: sourceQuote(typeof raw.content === "string" ? raw.content : ""),
  };
};

// Input is the actual AI-SDK result: successful tool data or { error }.
// Create/update may supply only id/title; do not invent content or fetch more.
export function toToolMetadata(
  toolName: string,
  result: unknown
): SourceHit | SourceHit[] | undefined {
  if (!result || typeof result !== "object" || "error" in result) return undefined;
  if (toolName === "search_notes" && Array.isArray(result)) {
    return result.flatMap((raw) => {
      const hit = raw && typeof raw === "object" ? toHit(raw) : undefined;
      return hit ? [hit] : [];
    });
  }
  if (NOTE_TOOLS.has(toolName) && !Array.isArray(result))
    return toHit(result as Record<string, unknown>);
  return undefined;
}

export function collectSources(
  toolCalls: ToolCallInfo[] | undefined,
  ragNotes: RagNoteRef[] | undefined
): Map<number, Omit<CitationSource, "n">> {
  const out = new Map<number, Omit<CitationSource, "n">>();
  const add = (raw: unknown) => {
    if (!raw || typeof raw !== "object") return;
    const hit = raw as RagNoteRef;
    if (
      !isSourceId(hit.id) ||
      out.has(hit.id) ||
      typeof hit.title !== "string" ||
      typeof hit.quote !== "string"
    )
      return;
    out.set(hit.id, {
      noteId: hit.id,
      title: hit.title,
      kind: hit.type === "meeting" ? "meeting" : "note",
      date: typeof hit.date === "string" ? hit.date : null,
      quote: sourceQuote(hit.quote),
    });
  };
  for (const call of toolCalls ?? []) {
    if (call?.status !== "completed" || !call.metadata) continue;
    for (const hit of Array.isArray(call.metadata) ? call.metadata : [call.metadata]) add(hit);
  }
  for (const note of ragNotes ?? []) add(note);
  return out;
}

export function numberCitations(
  content: string,
  candidates: Map<number, Omit<CitationSource, "n">>
): { numbers: Map<number, number>; sources: CitationSource[] } {
  const numbers = new Map<number, number>();
  visitEligibleCitationText(parseCitationMarkdown(content), ({ value }) => {
    for (const match of value.matchAll(CITATION_MARKER)) {
      const id = Number(match[1]);
      if (candidates.has(id) && !numbers.has(id)) numbers.set(id, numbers.size + 1);
    }
  });
  const sources = numbers.size
    ? [...numbers].map(([id, n]) => ({ ...candidates.get(id)!, n }))
    : [...candidates.values()].slice(0, UNCITED_MAX).map((source) => ({ ...source, n: null }));
  return { numbers, sources };
}
