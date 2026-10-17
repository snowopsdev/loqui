import { create } from "zustand";

export type HomeFilter = "all" | "dictations" | "meetings" | "notes" | "failed";
export const HOME_FILTERS: readonly HomeFilter[] = [
  "all",
  "dictations",
  "meetings",
  "notes",
  "failed",
];

interface HomeViewState {
  filter: HomeFilter;
  query: string;
  /** Transcript the palette, a mention or a citation asked Home to reveal. */
  focusTranscriptId: number | null;
  /** Bumped on every request so asking twice re-rings the row. */
  focusNonce: number;
}

export const useHomeViewStore = create<HomeViewState>()(() => ({
  filter: "all",
  query: "",
  focusTranscriptId: null,
  focusNonce: 0,
}));

export const setHomeFilter = (filter: HomeFilter) => useHomeViewStore.setState({ filter });
export const setHomeQuery = (query: string) => useHomeViewStore.setState({ query });
export const showHomeQuery = (query: string) => useHomeViewStore.setState({ filter: "all", query });

// Whatever hides the row (a chip, the in-view search) is cleared first, so
// the deep link always lands on something visible.
export function requestTranscriptFocus(transcriptId: number): void {
  useHomeViewStore.setState((state) => ({
    filter: "all",
    query: "",
    focusTranscriptId: transcriptId,
    focusNonce: state.focusNonce + 1,
  }));
}

export const clearTranscriptFocus = () => useHomeViewStore.setState({ focusTranscriptId: null });
