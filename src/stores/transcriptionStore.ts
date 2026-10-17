import { create } from "zustand";
import type { TranscriptionItem } from "../types/electron";

interface TranscriptionState {
  transcriptions: TranscriptionItem[];
  includeDiscarded: boolean;
}

export const useTranscriptionStore = create<TranscriptionState>()(() => ({
  transcriptions: [],
  includeDiscarded: false,
}));

let hasBoundIpcListeners = false;
const DEFAULT_LIMIT = 50;
let currentLimit = DEFAULT_LIMIT;

// Only a live Home landing may retain one row across an outstanding page.
// Released after scroll + pending pages, or immediately on replacement/unmount.
const landings = new Set<{
  id: number;
  item?: TranscriptionItem;
  valid: boolean;
  ownsRequest: () => boolean;
}>();
const pageLoads = new Set<{ removed: Set<number>; cleared: boolean }>();
const afterPages = new Set<() => void>();
let pageVersion = 0;

export function retainTranscriptionForLanding(id: number, ownsRequest: () => boolean) {
  const landing = {
    id,
    item: useTranscriptionStore.getState().transcriptions.find((row) => row.id === id),
    valid: true,
    ownsRequest,
  };
  landings.add(landing);
  const isCurrent = () => landing.valid && ownsRequest();
  const waiting = new Set<() => void>();
  const release = () => {
    landing.valid = false;
    for (const callback of waiting) afterPages.delete(callback);
    waiting.clear();
    landings.delete(landing);
    afterPages.delete(release);
  };
  return {
    isCurrent,
    get pageVersion() {
      return pageVersion;
    },
    get hasPendingPages() {
      return pageLoads.size > 0;
    },
    afterPages(callback: () => void) {
      const ready = () => {
        waiting.delete(ready);
        afterPages.delete(ready);
        if (isCurrent()) callback();
      };
      if (pageLoads.size === 0) ready();
      else {
        waiting.add(ready);
        afterPages.add(ready);
      }
    },
    reveal(item: TranscriptionItem) {
      if (
        !isCurrent() ||
        item.deleted_at ||
        (item.status === "discarded" && !useTranscriptionStore.getState().includeDiscarded)
      )
        return;
      landing.item = item;
      revealTranscription(item);
    },
    release,
    releaseAfterPages() {
      if (pageLoads.size === 0) release();
      else afterPages.add(release);
    },
  };
}

function invalidateLanding(id?: number) {
  for (const landing of landings) {
    if (id == null || landing.id === id) landing.valid = false;
  }
  // A response captured before explicit deletion/clear cannot revive its target.
  for (const page of pageLoads) {
    if (id == null) page.cleared = true;
    else page.removed.add(id);
  }
}

function ensureIpcListeners() {
  if (hasBoundIpcListeners || typeof window === "undefined") {
    return;
  }

  const disposers: Array<() => void> = [];

  if (window.electronAPI?.onTranscriptionAdded) {
    const dispose = window.electronAPI.onTranscriptionAdded((item) => {
      if (item) {
        addTranscription(item);
      }
    });
    if (typeof dispose === "function") {
      disposers.push(dispose);
    }
  }

  if (window.electronAPI?.onTranscriptionDeleted) {
    const dispose = window.electronAPI.onTranscriptionDeleted(({ id }) => {
      removeTranscription(id);
    });
    if (typeof dispose === "function") {
      disposers.push(dispose);
    }
  }

  if (window.electronAPI?.onTranscriptionUpdated) {
    const dispose = window.electronAPI.onTranscriptionUpdated((item) => {
      if (item) {
        updateTranscription(item);
      }
    });
    if (typeof dispose === "function") {
      disposers.push(dispose);
    }
  }

  if (window.electronAPI?.onTranscriptionsCleared) {
    const dispose = window.electronAPI.onTranscriptionsCleared(() => {
      clearTranscriptions();
    });
    if (typeof dispose === "function") {
      disposers.push(dispose);
    }
  }

  hasBoundIpcListeners = true;

  window.addEventListener("beforeunload", () => {
    disposers.forEach((dispose) => dispose());
  });
}

export async function initializeTranscriptions(
  limit = currentLimit,
  includeDiscarded = useTranscriptionStore.getState().includeDiscarded
) {
  currentLimit = limit;
  ensureIpcListeners();
  const page = { removed: new Set<number>(), cleared: false };
  pageVersion += 1;
  pageLoads.add(page);
  try {
    const items = await window.electronAPI.getTranscriptions(limit, { includeDiscarded });
    const current = page.cleared ? [] : items.filter((item) => !page.removed.has(item.id));
    useTranscriptionStore.setState({ transcriptions: current, includeDiscarded });
    for (const landing of landings) {
      if (
        landing.valid &&
        landing.ownsRequest() &&
        landing.item &&
        !landing.item.deleted_at &&
        (includeDiscarded || landing.item.status !== "discarded")
      ) {
        // Keep a page's authoritative record (including a tombstone) for any
        // other page still in flight; never reapply the older fetched payload.
        const item = current.find((item) => item.id === landing.id) ?? landing.item;
        landing.item = item;
        if (item.deleted_at) landing.valid = false;
        else revealTranscription(item);
      }
    }
    return items;
  } finally {
    pageLoads.delete(page);
    if (pageLoads.size === 0) for (const release of afterPages) release();
  }
}

function addTranscription(item: TranscriptionItem) {
  if (!item) return;
  if (item.status === "discarded" && !useTranscriptionStore.getState().includeDiscarded) return;
  const { transcriptions } = useTranscriptionStore.getState();
  const withoutDuplicate = transcriptions.filter((existing) => existing.id !== item.id);
  useTranscriptionStore.setState({
    transcriptions: [item, ...withoutDuplicate].slice(0, currentLimit),
  });
}

export function removeTranscription(id: number) {
  if (id == null) return;
  invalidateLanding(id);
  const { transcriptions } = useTranscriptionStore.getState();
  const next = transcriptions.filter((item) => item.id !== id);
  if (next.length === transcriptions.length) return;
  useTranscriptionStore.setState({ transcriptions: next });
}

export function updateTranscription(item: TranscriptionItem) {
  if (!item) return;
  if (item.deleted_at) invalidateLanding(item.id);
  for (const landing of landings) {
    if (landing.id === item.id) landing.item = item;
  }
  const { transcriptions } = useTranscriptionStore.getState();
  const next = transcriptions.map((existing) => (existing.id === item.id ? item : existing));
  useTranscriptionStore.setState({ transcriptions: next });
}

export function clearTranscriptions() {
  invalidateLanding();
  if (useTranscriptionStore.getState().transcriptions.length === 0) return;
  useTranscriptionStore.setState({ transcriptions: [] });
}

export function useTranscriptions() {
  return useTranscriptionStore((state) => state.transcriptions);
}

export function useShowDiscarded() {
  return useTranscriptionStore((state) => state.includeDiscarded);
}

/** Reveal one fetched row beyond the loaded page. Existing ids replace in place
 * (record timestamps are immutable); new ids insert timestamp-DESC/id-DESC.
 * Never mutate the supplied list/row or slice a revealed row off the page. */
export function revealTranscription(item: TranscriptionItem): void {
  useTranscriptionStore.setState((state) => {
    const next = state.transcriptions.slice();
    const existing = next.findIndex((row) => row.id === item.id);
    if (existing !== -1) next[existing] = item;
    else {
      const index = next.findIndex(
        (row) =>
          row.timestamp < item.timestamp || (row.timestamp === item.timestamp && row.id < item.id)
      );
      next.splice(index === -1 ? next.length : index, 0, item);
    }
    return { transcriptions: next };
  });
}
