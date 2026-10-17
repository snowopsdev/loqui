import { useSyncExternalStore } from "react";
import type { TechnicalErrorDetailsData } from "./TechnicalErrorDetails";

// One notice system with three tiers (DESIGN.md "Notices"):
// - receipt: something happened as asked; it times out.
// - notice: something changed or degraded; it waits when `persistent`.
// - alert: words or work are at risk; role="alert"; it never times out while
//   it carries recovered words.
// A plain module store (not React context), so non-React code such as
// AudioManager callbacks and listeners can call notify() directly.

export type NoticeKind = "receipt" | "notice" | "alert";
export type NoticeRemoval = "user" | "action" | "timeout" | "replaced" | "evicted";

export interface NoticeAction {
  label: string;
  onClick: () => void | Promise<void>;
  /** The chip shows the first primary action inline; the rest live behind "More". */
  primary?: boolean;
  /** Keep the notice up after the action runs (e.g. "Paste again" that may fail). */
  keepOpen?: boolean;
}

interface NoticeBase {
  title: string;
  body?: string;
  actions?: NoticeAction[];
  persistent?: boolean;
  /** Stable id: a later notify() with the same id replaces this notice. */
  id?: string;
  details?: TechnicalErrorDetailsData;
  /** Called exactly once per revision, with the reason it left. */
  onDismiss?: (reason: NoticeRemoval) => void;
}

export type NoticeInput =
  | (NoticeBase & { kind: "alert"; words?: string })
  | (NoticeBase & { kind: "receipt" | "notice"; words?: never });

export type Notice = NoticeInput & {
  id: string;
  revision: number;
  createdAt: number;
  expiresAt: number | null;
  /** Set while hover-paused; the countdown resumes from here. */
  remainingMs: number | null;
  /** An action is running; buttons render disabled and repeat activation is ignored. */
  busy: boolean;
};

export interface NoticeClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const NOTICE_DURATION_MS = {
  receipt: 3500,
  receiptWithAction: 7000,
  notice: 10000,
  alert: 10000,
} as const;
export const NOTICE_MAX_VISIBLE = 3;
export const NOTICE_STAGGER_MS = 40;

const realClock: NoticeClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

let clock: NoticeClock = realClock;
let notices: readonly Notice[] = [];
let seq = 0;
const revisions = new Map<string, number>();
const timers = new Map<string, unknown>();
const listeners = new Set<() => void>();

function emit(next: readonly Notice[]): void {
  notices = next;
  listeners.forEach((listener) => listener());
}

function clearTimer(id: string): void {
  if (!timers.has(id)) return;
  clock.clearTimeout(timers.get(id));
  timers.delete(id);
}

function schedule(id: string, ms: number): void {
  clearTimer(id);
  timers.set(
    id,
    clock.setTimeout(() => dismissNotice(id, "timeout"), ms)
  );
}

/** Recovered words are content at risk: whatever kind the caller asked for, they make an alert. */
function normalize(input: NoticeInput): NoticeInput {
  if (input.words && input.kind !== "alert") return { ...input, kind: "alert" } as NoticeInput;
  return input;
}

export function noticeLifetimeMs(input: NoticeInput): number | null {
  if (input.persistent) return null;
  if (input.kind === "alert" && input.words) return null;
  if (input.kind === "receipt" && input.actions?.length) return NOTICE_DURATION_MS.receiptWithAction;
  return NOTICE_DURATION_MS[input.kind];
}

function remove(target: Notice, reason: NoticeRemoval): void {
  clearTimer(target.id);
  emit(notices.filter((n) => n !== target));
  target.onDismiss?.(reason);
}

export function notify(raw: NoticeInput): string {
  let input = normalize(raw);
  let id = input.id ?? `notice-${++seq}`;
  // Recovered words leave only when the user or an action removes them (R2-C3).
  const held = notices.find((n) => n.id === id && n.words);
  if (held && !input.words) {
    // A status update about held words keeps them.
    input = { ...input, kind: "alert", words: held.words } as NoticeInput;
  } else if (held && input.words !== held.words) {
    // Different words never overwrite: the new words get their own notice.
    id = `${id}~${++seq}`;
  }
  const revision = (revisions.get(id) ?? 0) + 1;
  revisions.set(id, revision);
  const previous = notices.find((n) => n.id === id);
  const lifetime = noticeLifetimeMs(input);
  const now = clock.now();
  const notice = {
    ...input,
    id,
    revision,
    createdAt: now,
    expiresAt: lifetime === null ? null : now + lifetime,
    remainingMs: null,
    busy: false,
  } as Notice;
  let next = [...notices.filter((n) => n.id !== id), notice];
  const evicted: Notice[] = [];
  // Over the cap, the oldest notice that may expire leaves first. Persistent
  // notices and recovered words (expiresAt null) are never picked: they wait,
  // and noticeLayout decides what shows.
  while (next.length > NOTICE_MAX_VISIBLE) {
    const victim = next.find((n) => n.expiresAt !== null && n.id !== id);
    if (!victim) break;
    clearTimer(victim.id);
    evicted.push(victim);
    next = next.filter((n) => n !== victim);
  }
  if (lifetime === null) clearTimer(id);
  else schedule(id, lifetime);
  emit(next);
  previous?.onDismiss?.("replaced");
  evicted.forEach((n) => n.onDismiss?.("evicted"));
  return id;
}

/** Reasons the store gives on its own. None of them may remove recovered words. */
const AUTOMATIC_REMOVALS: ReadonlySet<NoticeRemoval> = new Set(["timeout", "evicted", "replaced"]);

export function dismissNotice(id: string, reason: NoticeRemoval = "user"): void {
  const target = notices.find((n) => n.id === id);
  if (!target) return;
  if (target.words && AUTOMATIC_REMOVALS.has(reason)) return;
  remove(target, reason);
}

/** Move a notice to the newest position, e.g. the card's "N more". No revision bump, no onDismiss. */
export function raiseNotice(id: string): void {
  const target = notices.find((n) => n.id === id);
  if (!target || notices[notices.length - 1] === target) return;
  emit([...notices.filter((n) => n !== target), target]);
}

function replace(target: Notice, patch: Partial<Notice>): void {
  emit(notices.map((n) => (n === target ? ({ ...n, ...patch } as Notice) : n)));
}

export function pauseNotice(id: string): void {
  const n = notices.find((x) => x.id === id);
  if (!n || n.expiresAt === null || n.remainingMs !== null) return;
  clearTimer(id);
  replace(n, { remainingMs: Math.max(0, n.expiresAt - clock.now()) });
}

export function resumeNotice(id: string): void {
  const n = notices.find((x) => x.id === id);
  if (!n || n.remainingMs === null) return;
  const ms = n.remainingMs;
  replace(n, { remainingMs: null, expiresAt: clock.now() + ms });
  schedule(id, ms);
}

/**
 * Runs an action against the revision that was on screen when it was
 * pressed. Only that revision is dismissed afterwards: an action that
 * publishes a replacement under the same id (a failed retry explaining
 * itself) keeps the replacement on screen.
 */
export async function runNoticeAction(id: string, action: NoticeAction): Promise<void> {
  const started = notices.find((n) => n.id === id);
  if (!started || started.busy) return;
  replace(started, { busy: true });
  try {
    await action.onClick();
  } finally {
    const current = notices.find((n) => n.id === id);
    if (current && current.revision === started.revision) {
      if (action.keepOpen) replace(current, { busy: false });
      else remove(current, "action");
    }
  }
}

/** The newest `max` chips. A notice that carries words is the card, never a chip. */
export function visibleNotices(list: readonly Notice[], max = NOTICE_MAX_VISIBLE): Notice[] {
  return max > 0 ? list.filter((n) => !n.words).slice(-max) : [];
}

export function wordsNotices(list: readonly Notice[]): Notice[] {
  return list.filter((n) => !!n.words);
}

/** The card on screen: the newest words notice. `raiseNotice` changes which one that is. */
export function wordsCardNotice(list: readonly Notice[]): Notice | null {
  const held = wordsNotices(list);
  return held.length ? held[held.length - 1] : null;
}

/**
 * §5.3: at most three notices are visible, and the card counts as one. In the
 * 168px pill slot the card fills the space, so chips wait behind it. Held
 * words beyond the card are counted, never dropped; the card's "N more"
 * control raises the oldest of them (R2-C3).
 */
export function noticeLayout(
  list: readonly Notice[],
  placement: "pill" | "panel"
): { card: Notice | null; moreWords: number; chips: Notice[] } {
  const card = wordsCardNotice(list);
  const slots = !card ? NOTICE_MAX_VISIBLE : placement === "pill" ? 0 : NOTICE_MAX_VISIBLE - 1;
  return {
    card,
    moreWords: card ? wordsNotices(list).length - 1 : 0,
    chips: visibleNotices(list, slots),
  };
}

/** Position within a burst of notices that arrived inside one stagger window. */
export function staggerIndex(list: readonly Notice[], id: string): number {
  const visible = visibleNotices(list);
  const at = visible.findIndex((n) => n.id === id);
  if (at < 0) return 0;
  let index = 0;
  for (let i = at; i > 0; i -= 1) {
    if (visible[i].createdAt - visible[i - 1].createdAt > NOTICE_STAGGER_MS) break;
    index += 1;
  }
  return Math.min(index, NOTICE_MAX_VISIBLE - 1);
}

export function getNotices(): readonly Notice[] {
  return notices;
}

export function subscribeNotices(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNotices(): readonly Notice[] {
  return useSyncExternalStore(subscribeNotices, getNotices, getNotices);
}

/** Test seam: swap the clock and clear all state. Call with no argument to restore. */
export function __setNoticeClockForTests(next?: NoticeClock): void {
  for (const id of [...timers.keys()]) clearTimer(id);
  clock = next ?? realClock;
  notices = [];
  seq = 0;
  revisions.clear();
}
