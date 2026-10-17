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
  const items = await window.electronAPI.getTranscriptions(limit, { includeDiscarded });
  useTranscriptionStore.setState({ transcriptions: items, includeDiscarded });
  return items;
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
  const { transcriptions } = useTranscriptionStore.getState();
  const next = transcriptions.filter((item) => item.id !== id);
  if (next.length === transcriptions.length) return;
  useTranscriptionStore.setState({ transcriptions: next });
}

export function updateTranscription(item: TranscriptionItem) {
  if (!item) return;
  const { transcriptions } = useTranscriptionStore.getState();
  const next = transcriptions.map((existing) => (existing.id === item.id ? item : existing));
  useTranscriptionStore.setState({ transcriptions: next });
}

export function clearTranscriptions() {
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
