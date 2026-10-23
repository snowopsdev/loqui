import type { EgressEvent, EgressNotice, EgressSummary, PrivacyAPI } from "../../types/privacy";
import {
  MAX_LIMIT,
  PAGE_SIZE,
  classifyRecorderError,
  mergeNotice,
  startOfNextDay,
  startOfToday,
} from "./flightRecorderView";

// The flight recorder's data feed: one window (today since local midnight),
// fetched as a pair (list + counts) and kept consistent with main (A21).
//
// - A fetch applies only if nothing newer started after it (a generation
//   counter), so a slow reply can never bring back records that a clear, a
//   newer fetch or the midnight rollover replaced.
// - A clear from main empties the view at once and refetches; it never shows
//   "0" or the empty state before main answers.
// - A failed fetch is a translated error with Retry, never an endless
//   "Loading…", and never the last list presented as current.
// - Live events show at once and are confirmed by a short debounced refetch,
//   so the counts and the list come from the same answer.
// - The day is re-checked against the real clock at least once a minute and
//   whenever the panel regains focus or becomes visible, so a machine that
//   slept across midnight does not keep showing yesterday.

export type RecorderError = "unavailable" | "failed";
export type RecorderNotice = "exported" | "exportError" | "clearError" | "cleared";
export type RecorderBusy = "clearing" | "exporting" | null;

export type RecorderFeedState = Readonly<{
  status: "loading" | "ready" | "error";
  error: RecorderError | null;
  events: EgressEvent[];
  summary: EgressSummary | null;
  since: number;
  limit: number;
  // The last fetch returned as many rows as it asked for: there may be more.
  truncated: boolean;
  busy: RecorderBusy;
  notice: RecorderNotice | null;
}>;

type RecorderBridge = Pick<
  PrivacyAPI,
  | "listEgress"
  | "egressSummary"
  | "clearEgress"
  | "exportEgressCsv"
  | "onEgress"
  | "onEgressCleared"
>;

type Timer = ReturnType<typeof setTimeout>;

export const LIVE_REFRESH_MS = 400;
// The rollover refetch waits this long past midnight, so its `since` is the new day.
const ROLLOVER_SLACK_MS = 1000;
// A single long timer can fire hours late after sleep; the rollover check is
// re-armed at most this far ahead and compares against the real clock.
export const ROLLOVER_CHECK_MS = 60_000;

export class RecorderFeed {
  private state: RecorderFeedState;
  private generation = 0;
  private buffered: EgressNotice[] = [];
  private inFlight = false;
  private disposed = false;
  private liveTimer: Timer | null = null;
  private rolloverTimer: Timer | null = null;
  private offEvent: (() => void) | null = null;
  private offCleared: (() => void) | null = null;
  private readonly listeners = new Set<(state: RecorderFeedState) => void>();

  constructor(
    private readonly api: RecorderBridge,
    private readonly now: () => number = () => Date.now(),
    private readonly timers: {
      set: (fn: () => void, ms: number) => Timer;
      clear: (timer: Timer) => void;
    } = { set: (fn, ms) => setTimeout(fn, ms), clear: (timer) => clearTimeout(timer) }
  ) {
    this.state = Object.freeze({
      status: "loading",
      error: null,
      events: [],
      summary: null,
      since: startOfToday(this.now()),
      limit: PAGE_SIZE,
      truncated: false,
      busy: null,
      notice: null,
    });
  }

  getState(): RecorderFeedState {
    return this.state;
  }

  subscribe(listener: (state: RecorderFeedState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): () => void {
    this.offEvent = this.api.onEgress((notice) => this.onNotice(notice));
    this.offCleared = this.api.onEgressCleared(() => this.onCleared());
    void this.refresh();
    return () => this.dispose();
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.offEvent?.();
    this.offCleared?.();
    this.offEvent = this.offCleared = null;
    if (this.liveTimer) this.timers.clear(this.liveTimer);
    if (this.rolloverTimer) this.timers.clear(this.rolloverTimer);
    this.liveTimer = this.rolloverTimer = null;
    this.listeners.clear();
  }

  private set(patch: Partial<RecorderFeedState>): void {
    if (this.disposed) return;
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of [...this.listeners]) listener(this.state);
  }

  // Fetch the window's list and counts together. `reset` drops what is shown
  // first (a clear, a new day, a failed fetch's retry): nothing old stays up.
  async refresh({ reset = false }: { reset?: boolean } = {}): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    const since = startOfToday(this.now());
    const limit = this.state.limit;
    const dayChanged = since !== this.state.since;
    if (reset || dayChanged || this.state.status === "error") {
      this.buffered = [];
      this.set({
        status: "loading",
        error: null,
        events: [],
        summary: null,
        since,
        truncated: false,
      });
    }
    this.inFlight = true;
    try {
      const [list, summary] = await Promise.all([
        this.api.listEgress({ since, limit }),
        this.api.egressSummary({ since }),
      ]);
      if (generation !== this.generation || this.disposed) return;
      const rows = Array.isArray(list) ? list : [];
      const events = this.buffered.reduce((acc, notice) => mergeNotice(acc, notice, since), rows);
      this.buffered = [];
      this.inFlight = false;
      this.set({
        status: "ready",
        error: null,
        events,
        summary,
        since,
        truncated: rows.length >= limit,
      });
      this.armRollover(since);
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      this.buffered = [];
      this.inFlight = false;
      // Never the last list as if current: an error replaces it.
      this.set({
        status: "error",
        error: classifyRecorderError(error),
        events: [],
        summary: null,
        since,
        truncated: false,
      });
    }
  }

  // The window is "today": if the real day has moved on (after sleep, or when
  // the panel regains focus), drop yesterday and fetch the new day.
  checkDay(): void {
    if (this.disposed) return;
    if (startOfToday(this.now()) !== this.state.since) void this.refresh({ reset: true });
  }

  retry(): Promise<void> {
    return this.refresh({ reset: true });
  }

  showMore(): Promise<void> {
    if (this.state.limit >= MAX_LIMIT) return Promise.resolve();
    this.set({ limit: Math.min(MAX_LIMIT, this.state.limit + PAGE_SIZE) });
    return this.refresh();
  }

  private onNotice(notice: EgressNotice): void {
    if (this.disposed || notice?.phase !== "recorded") return;
    const settled = Math.max(notice.event.ts, notice.event.endedAt ?? notice.event.ts);
    if (
      settled >= startOfNextDay(this.state.since) ||
      startOfToday(this.now()) !== this.state.since
    ) {
      // A new day began: the window moves, and nothing from yesterday stays.
      void this.refresh({ reset: true });
      return;
    }
    if (this.inFlight) this.buffered.push(notice);
    if (this.state.status === "ready") {
      const events = mergeNotice(this.state.events, notice, this.state.since);
      if (events !== this.state.events) this.set({ events });
    }
    this.scheduleLiveRefresh();
  }

  private onCleared(): void {
    if (this.disposed) return;
    // Main deleted every record. Any fetch already under way is now stale.
    void this.refresh({ reset: true });
  }

  private scheduleLiveRefresh(): void {
    if (this.liveTimer) return;
    this.liveTimer = this.timers.set(() => {
      this.liveTimer = null;
      if (this.state.status !== "error") void this.refresh();
    }, LIVE_REFRESH_MS);
  }

  private armRollover(since: number): void {
    if (this.rolloverTimer) this.timers.clear(this.rolloverTimer);
    const wait = Math.min(
      ROLLOVER_CHECK_MS,
      Math.max(0, startOfNextDay(since) - this.now()) + ROLLOVER_SLACK_MS
    );
    this.rolloverTimer = this.timers.set(() => {
      this.rolloverTimer = null;
      if (this.disposed || since !== this.state.since) return;
      if (startOfToday(this.now()) !== since) void this.refresh({ reset: true });
      else this.armRollover(since);
    }, wait);
  }

  // Main asks in its own dialog ("Keep records" resolves false). The view
  // empties when main's cleared notice arrives; a resolved `true` refetches too,
  // in case that notice was missed.
  async clear(): Promise<void> {
    if (this.state.busy) return;
    this.set({ busy: "clearing", notice: null });
    try {
      const cleared = await this.api.clearEgress();
      if (cleared === true) {
        this.set({ busy: null, notice: "cleared" });
        await this.refresh({ reset: true });
        return;
      }
      this.set({ busy: null });
    } catch {
      this.set({ busy: null, notice: "clearError" });
    }
  }

  async exportCsv(): Promise<void> {
    if (this.state.busy) return;
    this.set({ busy: "exporting", notice: null });
    try {
      const result = await this.api.exportEgressCsv();
      this.set({ busy: null, notice: result?.saved === true ? "exported" : null });
    } catch {
      this.set({ busy: null, notice: "exportError" });
    }
  }
}
