import type { NoteItem, TranscriptionItem } from "../types/electron";
import type {
  TableBoardData,
  TableEntity,
  TableEntityRef,
  TableLayout,
  TablePlacement,
  TableViewport,
} from "../types/table";

// In-memory browser sample only (Space 1). This is not main's storage/provider
// implementation. See DESIGN.md for the deliberately unsupported acceptance cases.
export function createPreviewTable(source: {
  notes: () => Pick<NoteItem, "id" | "title" | "content" | "note_type" | "updated_at">[];
  history: () => Pick<TranscriptionItem, "id" | "text" | "timestamp" | "audio_duration_ms">[];
}) {
  const layout = new Map<string, TableLayout>();
  const links = new Map<string, { a: TableEntityRef; b: TableEntityRef }>();
  let viewport: TableViewport | null = null;
  const key = (ref: TableEntityRef) => `${ref.type}:${ref.id}`;
  const exists = (ref: TableEntityRef) =>
    !!ref &&
    Number.isSafeInteger(ref.id) &&
    ref.id > 0 &&
    (ref.type === "note"
      ? source.notes().some((n) => n.id === ref.id)
      : ref.type === "dictation" && source.history().some((h) => h.id === ref.id));
  const coord = (n: number) => Math.max(-1e6, Math.min(1e6, n));
  const dimension = (n: number | null | undefined) =>
    typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.min(n, 4000) : null;
  const base = { participants: [], hrefs: [], noteId: null, durationMs: null };

  return {
    getTableBoard: async (spaceId: number): Promise<TableBoardData> => {
      if (spaceId !== 1)
        return { spaceId, cards: [], inbox: [], links: [], viewport: null, truncated: false };
      const notes: TableEntity[] = source.notes().map((n) => ({
        ...base,
        ref: { type: "note", id: n.id },
        kind: n.note_type === "meeting" ? "meeting" : "note",
        title: n.title,
        excerpt: (n.content ?? "").slice(0, 600),
        at: n.updated_at,
        layout: layout.get(`note:${n.id}`) ?? null,
      }));
      const dictations: TableEntity[] = source.history().map((d) => ({
        ...base,
        ref: { type: "dictation", id: d.id },
        kind: "dictation",
        title: null,
        excerpt: d.text.slice(0, 600),
        at: d.timestamp,
        durationMs: d.audio_duration_ms ?? null,
        layout: layout.get(`dictation:${d.id}`) ?? null,
      }));
      const cards = [
        ...notes.filter((e) => e.layout && !e.layout.hidden),
        ...dictations.filter((e) => e.layout && !e.layout.hidden),
        ...notes.filter((e) => !e.layout),
      ];
      const inbox = [
        ...[...notes, ...dictations].filter((e) => e.layout?.hidden),
        ...dictations.filter((e) => !e.layout).slice(0, 3),
      ];
      const present = new Set([...cards, ...inbox].map((e) => key(e.ref)));
      // Copy results like IPC: callers cannot mutate the in-memory store via a read.
      return structuredClone({
        spaceId,
        cards,
        inbox,
        links: [...links.values()].filter((l) => present.has(key(l.a)) && present.has(key(l.b))),
        viewport,
        truncated: false,
      });
    },
    placeTableCards: async (spaceId: number, placements: TablePlacement[]) => {
      if (spaceId !== 1 || !Array.isArray(placements) || placements.length > 500)
        return { success: false as const, code: "INVALID" as const };
      const placedKeys = new Set<string>();
      for (const p of placements) {
        if (!exists(p) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        layout.set(key(p), {
          x: coord(p.x),
          y: coord(p.y),
          w: dimension(p.w),
          h: dimension(p.h),
          z: Number.isSafeInteger(p.z) ? p.z! : 0,
          hidden: false,
        });
        placedKeys.add(key(p));
      }
      return { success: true as const, placed: placedKeys.size, placedKeys: [...placedKeys] };
    },
    hideTableCards: async (spaceId: number, refs: TableEntityRef[]) => {
      if (spaceId !== 1 || !Array.isArray(refs) || refs.length > 500)
        return { success: false, hidden: 0 };
      const hiddenKeys = new Set<string>();
      for (const ref of refs) {
        if (!exists(ref)) continue;
        layout.set(key(ref), {
          ...(layout.get(key(ref)) ?? { x: 0, y: 0, w: null, h: null, z: 0 }),
          hidden: true,
        });
        hiddenKeys.add(key(ref));
      }
      return { success: true, hidden: hiddenKeys.size };
    },
    linkTableCards: async (spaceId: number, a: TableEntityRef, b: TableEntityRef) => {
      if (spaceId !== 1 || !exists(a) || !exists(b) || key(a) === key(b)) return { success: false };
      const [first, second] = key(a) < key(b) ? [a, b] : [b, a];
      links.set(`${key(first)}|${key(second)}`, { a: { ...first }, b: { ...second } });
      return { success: true };
    },
    setTableViewport: async (spaceId: number, next: TableViewport) => {
      if (spaceId !== 1 || !next || ![next.x, next.y, next.scale].every(Number.isFinite))
        return { success: false };
      viewport = {
        x: coord(next.x),
        y: coord(next.y),
        scale: Math.max(0.25, Math.min(2, next.scale)),
      };
      return { success: true };
    },
  };
}
