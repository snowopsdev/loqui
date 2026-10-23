// Single owner of the pill window's size priority: panel > words card > menu
// > notices > compact listening pill > base. The assistant panel must never be
// collapsed by a notice dismissing underneath it, nor the listening pill
// clipped by a menu closing — higher states always win.
export const SIZE_RANK = {
  BASE: 0,
  RECORDING: 1,
  DICTATION_ERROR_WITH_TRANSCRIPT: 3,
  WITH_MENU: 4,
  WITH_NOTICES: 5,
  EXPANDED: 6,
  ASSISTANT: 7,
};

export function resolveMainWindowSizeKey({
  panelOpen = false,
  menuOpen = false,
  noticeCount = 0,
  compactPill = false,
  wordsCardVisible = false,
} = {}) {
  if (panelOpen) return "ASSISTANT";
  if (wordsCardVisible) return "DICTATION_ERROR_WITH_TRANSCRIPT";
  if (menuOpen && (noticeCount > 0 || compactPill)) return "EXPANDED";
  if (menuOpen) return "WITH_MENU";
  if (noticeCount > 0) return "WITH_NOTICES";
  if (compactPill) return "RECORDING";
  return "BASE";
}
