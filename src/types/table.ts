export type TableEntityType = "note" | "dictation" | "chat";
export type TableCardKind = "note" | "meeting" | "dictation" | "chat";
export interface TableEntityRef {
  type: TableEntityType;
  id: number;
}
export interface TableLayout {
  x: number;
  y: number;
  w: number | null;
  h: number | null;
  z: number;
  hidden: boolean;
}
export interface TableEntity {
  ref: TableEntityRef;
  kind: TableCardKind;
  title: string | null;
  excerpt: string; // raw markdown/plain text, ≤ 600 chars
  at: string; // updated_at / timestamp, DB format
  durationMs: number | null;
  participants: string[]; // display names, ≤ 6
  hrefs: string[]; // non-web, non-person link targets found in the note body, ≤ 50
  noteId: number | null; // chat: the note the conversation is about
  layout: TableLayout | null;
}
export interface TableLink {
  a: TableEntityRef;
  b: TableEntityRef;
}
export interface TableViewport {
  x: number;
  y: number;
  scale: number;
}
export interface TableBoardData {
  spaceId: number;
  cards: TableEntity[]; // all placed, visible cards, then the newest unplaced space notes up to 500 in total
  inbox: TableEntity[]; // removed cards of any kind or age (≤ 50 each), new dictations (7 days, ≤ 20), new answered chats (≤ 10)
  links: TableLink[]; // only links whose two ends are in cards ∪ inbox
  viewport: TableViewport | null;
  truncated: boolean;
}
export interface TablePlacement extends TableEntityRef {
  x: number;
  y: number;
  w?: number | null;
  h?: number | null;
  z?: number;
}
