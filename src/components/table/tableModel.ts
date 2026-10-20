import type { TranscriptionItem } from "../../types/electron";
import type {
  TableBoardData,
  TableCardKind,
  TableEntity,
  TableEntityRef,
  TableLink,
  TablePlacement,
} from "../../types/table";
import {
  autoPlace,
  DEFAULT_VIEWPORT,
  snapToGrid,
  type Point,
  type Rect,
  type Viewport,
} from "./tableGeometry";

export const CARD_WIDTH: Record<TableCardKind, number> = {
  note: 280,
  meeting: 320,
  dictation: 220,
  chat: 340,
};
export const CARD_HEIGHT_ESTIMATE: Record<TableCardKind, number> = {
  note: 152,
  meeting: 176,
  dictation: 112,
  chat: 176,
};
export const SELECTION_AI_LIMIT = 12;
const CONTEXT_CHARS = 600;
const BOARD_CARD_LIMIT = 500;

export const refKey = (ref: TableEntityRef) => `${ref.type}:${ref.id}`;

export function parseRefKey(key: string): TableEntityRef | null {
  const match = /^(note|dictation|chat):([1-9]\d*)$/.exec(key);
  const id = match ? Number(match[2]) : Number.NaN;
  return match && Number.isSafeInteger(id)
    ? { type: match[1] as TableEntityRef["type"], id }
    : null;
}

export interface TableCardModel {
  key: string;
  entity: TableEntity;
  rect: Rect;
  placed: boolean;
  z: number;
}

// An explicit (resized, persisted) height wins over the measured content
// height: a card shrunk below its content stays that size and clips.
const sizeOf = (e: TableEntity, measured: Record<string, number>) => ({
  w: e.layout?.w ?? CARD_WIDTH[e.kind],
  h: e.layout?.h ?? measured[refKey(e.ref)] ?? CARD_HEIGHT_ESTIMATE[e.kind],
});

export function buildCards(
  entities: TableEntity[],
  measured: Record<string, number> = {}
): TableCardModel[] {
  const placed = entities.filter((e) => e.layout && !e.layout.hidden);
  const unplaced = entities.filter((e) => !e.layout || e.layout.hidden);
  const placedCards = placed.map((e) => ({
    key: refKey(e.ref),
    entity: e,
    rect: { x: e.layout!.x, y: e.layout!.y, ...sizeOf(e, measured) },
    placed: true,
    z: e.layout!.z,
  }));
  const spots = autoPlace(
    unplaced.map((e) => sizeOf(e, measured)),
    placedCards.map((c) => c.rect)
  );
  const autoCards = unplaced.map((e, i) => ({
    key: refKey(e.ref),
    entity: e,
    rect: { ...spots[i], ...sizeOf(e, measured) },
    placed: false,
    z: 0,
  }));
  return [...placedCards, ...autoCards];
}

export function deriveEdges(
  cards: TableCardModel[],
  links: TableLink[],
  parseHref: (href: string) => TableEntityRef | null
): Array<{ a: string; b: string }> {
  const present = new Set(cards.map((c) => c.key));
  const seen = new Set<string>();
  const out: Array<{ a: string; b: string }> = [];
  const add = (x: string, y: string) => {
    if (x === y || !present.has(x) || !present.has(y)) return;
    const [a, b] = x < y ? [x, y] : [y, x];
    if (seen.has(`${a}|${b}`)) return;
    seen.add(`${a}|${b}`);
    out.push({ a, b });
  };
  for (const link of links) add(refKey(link.a), refKey(link.b));
  for (const card of cards) {
    if (card.entity.kind === "chat" && card.entity.noteId != null) {
      add(card.key, refKey({ type: "note", id: card.entity.noteId }));
    }
    for (const href of card.entity.hrefs) {
      const ref = parseHref(href);
      if (ref) add(card.key, refKey(ref));
    }
  }
  return out;
}

export function plainExcerpt(markdown: string, max = 240): string {
  const text = String(markdown || "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "")
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > 0 ? cut.slice(0, space) : cut}…`;
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

const itemBlock = (e: TableEntity) =>
  `<item type="${e.kind}" title="${escapeAttr(e.title ?? "")}" at="${escapeAttr(e.at)}">\n${e.excerpt.slice(0, CONTEXT_CHARS)}\n</item>`;

// Instructions to the model, not UI copy: English like useContainerChat's context.
// Every given item is included; callers enforce SELECTION_AI_LIMIT up front.
export function buildSelectionContext(spaceName: string, entities: TableEntity[]): string {
  const header = `The user selected ${entities.length} items on the canvas of the space "${spaceName}". Answer about these items only. Each item is an excerpt.`;
  return [header, ...entities.map(itemBlock)].join("\n\n");
}

export function buildBoardContext(spaceName: string, entities: TableEntity[]): string {
  const shown = entities.slice(0, SELECTION_AI_LIMIT);
  const header =
    `The user is looking at the canvas of the space "${spaceName}", which holds ${entities.length} cards. ` +
    (shown.length < entities.length
      ? `Excerpts of the first ${shown.length} are below; the rest are not included.`
      : "Excerpts of all of them are below.");
  return [header, ...shown.map(itemBlock)].join("\n\n");
}

export function pinSelection(
  spaceName: string,
  entities: TableEntity[]
): { keys: string[]; context: string } | { error: "empty" | "tooMany" } {
  if (entities.length === 0) return { error: "empty" };
  if (entities.length > SELECTION_AI_LIMIT) return { error: "tooMany" };
  return {
    keys: entities.map((e) => refKey(e.ref)),
    context: buildSelectionContext(spaceName, entities),
  };
}

export function buildGroupedNote(
  entities: TableEntity[],
  labels: { title: string; untitled: string; kind: Record<TableCardKind, string> }
): { title: string; content: string } {
  const lines = entities.map((e) => {
    const name =
      e.title?.trim() || (e.kind === "dictation" ? labels.kind.dictation : labels.untitled);
    return `- **${name}**: ${plainExcerpt(e.excerpt, 160)}`;
  });
  return { title: labels.title, content: lines.join("\n") };
}

export function dictationEntityFromItem(
  item: Pick<TranscriptionItem, "id" | "text" | "timestamp" | "audio_duration_ms">
): TableEntity {
  return {
    ref: { type: "dictation", id: item.id },
    kind: "dictation",
    title: null,
    excerpt: String(item.text || "").slice(0, CONTEXT_CHARS),
    at: item.timestamp,
    durationMs: item.audio_duration_ms ?? null,
    participants: [],
    hrefs: [],
    noteId: null,
    layout: null,
  };
}

export interface TableState {
  board: TableBoardData | null;
  measured: Record<string, number>;
  overrides: Record<string, Point>;
  selection: string[];
  focused: string | null;
  viewport: Viewport;
}

export type TableAction =
  | { type: "loaded"; board: TableBoardData }
  | { type: "measured"; key: string; h: number }
  | { type: "moved"; positions: Record<string, Point> }
  | { type: "placed"; placements: TablePlacement[] }
  | { type: "hidden"; keys: string[] }
  | { type: "inboxArrived"; entity: TableEntity }
  | { type: "clickCard"; key: string; additive: boolean }
  | { type: "select"; keys: string[] }
  | { type: "focus"; key: string | null }
  | { type: "viewport"; viewport: Viewport };

export function initialTableState(): TableState {
  return {
    board: null,
    measured: {},
    overrides: {},
    selection: [],
    focused: null,
    viewport: DEFAULT_VIEWPORT,
  };
}

// Match getTableBoard: arranged notes, dictations, chats (each newest first),
// followed by newest automatic notes within the remaining room. This is a
// bounded local projection of accepted placements, not a substitute for the
// hook's authoritative reload (which can also discover unseen content).
function projectPlacedCards(entities: TableEntity[]): TableEntity[] {
  const typeOrder: Record<TableEntityRef["type"], number> = { note: 0, dictation: 1, chat: 2 };
  const recentFirst = (a: TableEntity, b: TableEntity) =>
    (a.at === b.at ? 0 : a.at > b.at ? -1 : 1) || b.ref.id - a.ref.id;
  const arranged = entities
    .filter((e) => e.layout && !e.layout.hidden)
    .sort((a, b) => typeOrder[a.ref.type] - typeOrder[b.ref.type] || recentFirst(a, b));
  const automatic = entities.filter((e) => !e.layout).sort(recentFirst);
  return [...arranged, ...automatic].slice(0, BOARD_CARD_LIMIT);
}

export function tableReducer(state: TableState, action: TableAction): TableState {
  switch (action.type) {
    case "loaded": {
      const present = new Set(action.board.cards.map((e) => refKey(e.ref)));
      return {
        ...state,
        board: action.board,
        overrides: {},
        selection: state.selection.filter((k) => present.has(k)),
        focused: state.focused && present.has(state.focused) ? state.focused : null,
        // Only the first load restores the saved view; later reloads (after a
        // placement or a chat answer) must not snap a pan the user just made.
        viewport: state.board === null ? (action.board.viewport ?? state.viewport) : state.viewport,
      };
    }
    case "measured":
      return state.measured[action.key] === action.h
        ? state
        : { ...state, measured: { ...state.measured, [action.key]: action.h } };
    case "moved":
      return { ...state, overrides: { ...state.overrides, ...action.positions } };
    case "placed": {
      if (!state.board) return state;
      const byKey = new Map(action.placements.map((p) => [refKey(p), p]));
      const place = (e: TableEntity): TableEntity => {
        const p = byKey.get(refKey(e.ref));
        return p
          ? {
              ...e,
              layout: {
                x: p.x,
                y: p.y,
                w: p.w ?? null,
                h: p.h ?? null,
                z: p.z ?? 0,
                hidden: false,
              },
            }
          : e;
      };
      const fromInbox = state.board.inbox.filter((e) => byKey.has(refKey(e.ref))).map(place);
      const candidates = [...state.board.cards.map(place), ...fromInbox];
      const cards = projectPlacedCards(candidates);
      const present = new Set(cards.map((e) => refKey(e.ref)));
      const inbox = state.board.inbox.filter((e) => !byKey.has(refKey(e.ref)));
      const linkable = new Set([...present, ...inbox.map((e) => refKey(e.ref))]);
      const overrides = { ...state.overrides };
      for (const key of Object.keys(overrides)) {
        if (byKey.has(key) || !present.has(key)) delete overrides[key];
      }
      return {
        ...state,
        overrides,
        selection: state.selection.filter((key) => present.has(key)),
        focused: state.focused && present.has(state.focused) ? state.focused : null,
        board: {
          ...state.board,
          cards,
          inbox,
          links: state.board.links.filter(
            (link) => linkable.has(refKey(link.a)) && linkable.has(refKey(link.b))
          ),
          truncated: state.board.truncated || candidates.length > cards.length,
        },
      };
    }
    case "hidden": {
      if (!state.board) return state;
      const gone = new Set(action.keys);
      const leaving = state.board.cards.filter((e) => gone.has(refKey(e.ref)));
      return {
        ...state,
        selection: state.selection.filter((k) => !gone.has(k)),
        focused: state.focused && gone.has(state.focused) ? null : state.focused,
        board: {
          ...state.board,
          cards: state.board.cards.filter((e) => !gone.has(refKey(e.ref))),
          inbox: [...leaving.map((e) => ({ ...e, layout: null })), ...state.board.inbox],
        },
      };
    }
    case "inboxArrived": {
      if (!state.board) return state;
      const key = refKey(action.entity.ref);
      const known = [...state.board.cards, ...state.board.inbox].some((e) => refKey(e.ref) === key);
      return known
        ? state
        : { ...state, board: { ...state.board, inbox: [action.entity, ...state.board.inbox] } };
    }
    case "clickCard": {
      if (!action.additive) return { ...state, selection: [action.key], focused: action.key };
      const has = state.selection.includes(action.key);
      return {
        ...state,
        focused: action.key,
        selection: has
          ? state.selection.filter((k) => k !== action.key)
          : [...state.selection, action.key],
      };
    }
    case "select":
      return { ...state, selection: action.keys };
    case "focus":
      return { ...state, focused: action.key };
    case "viewport":
      return { ...state, viewport: action.viewport };
  }
}

export function cardsFor(state: TableState): TableCardModel[] {
  if (!state.board) return [];
  return buildCards(state.board.cards, state.measured).map((card) => {
    const o = state.overrides[card.key];
    return o ? { ...card, rect: { ...card.rect, x: o.x, y: o.y } } : card;
  });
}

export function placementsFor(
  state: TableState,
  keys: string[],
  positions: Record<string, Point> = {}
): TablePlacement[] {
  const wanted = new Set(keys);
  return cardsFor(state)
    .filter((card) => wanted.has(card.key))
    .map((card) => {
      const at = positions[card.key] ?? card.rect;
      return {
        ...card.entity.ref,
        x: snapToGrid(at.x),
        y: snapToGrid(at.y),
        w: card.entity.layout?.w ?? null,
        h: card.entity.layout?.h ?? null,
        z: card.z,
      };
    });
}
