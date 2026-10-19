import { ROUTE_IDS, ROUTE_SETTINGS_PATH, type RouteId } from "../../lib/routeGraph";
import { parseSettingsPath } from "../../lib/settingsPaths";
import type { SettingsState } from "../../stores/settingsStore";
import type { SettingsSectionType } from "../SettingsPage";

// One declaration per searchable setting (SET-R2 A). Labels and descriptions are the i18n keys the
// settings rows themselves render, so search shows the page's own words in the user's language;
// keywords are language-neutral technical terms.
//
// Live controls (toggle, select) are limited to settings that cannot change where the user's data
// goes. Everything that feeds the route snapshot is a "link" or "route" entry that navigates: a
// switch here would write the store behind the route planner's back (owner rule 3).

export type ToggleControl = {
  kind: "toggle";
  get: (s: SettingsState) => boolean;
  set: (s: SettingsState, value: boolean) => void;
  disabled?: (s: SettingsState) => boolean;
};
export type SelectControl = {
  kind: "select";
  disabled?: (s: SettingsState) => boolean;
  get: (s: SettingsState) => string;
  set: (s: SettingsState, value: string) => void;
  options: { value: string; labelKey: string }[];
};
export type SettingControl =
  ToggleControl | SelectControl | { kind: "route"; routeId: RouteId } | { kind: "link" };

export interface SettingEntry {
  id: string;
  path: string;
  labelKey: string;
  descriptionKey: string;
  keywords: string;
  control: SettingControl;
  /** Gated screen context may cue its visible assistant prerequisite after the normal wait. */
  fallbackAnchorId?: string;
}

const item = (
  id: string,
  path: string,
  labelKey: string,
  descriptionKey: string,
  keywords: string,
  control: SettingControl,
  fallbackAnchorId?: string
): SettingEntry => ({
  id,
  path,
  labelKey,
  descriptionKey,
  keywords,
  control,
  ...(fallbackAnchorId ? { fallbackAnchorId } : {}),
});
const toggle = (
  get: ToggleControl["get"],
  set: ToggleControl["set"],
  disabled?: ToggleControl["disabled"]
): ToggleControl => ({ kind: "toggle", get, set, disabled });
const link: SettingControl = { kind: "link" };

const G = "settingsPage.general";

export const SETTINGS_REGISTRY: readonly SettingEntry[] = [
  // Preferences
  item(
    "theme",
    "general",
    `${G}.appearance.theme`,
    `${G}.appearance.themeDescription`,
    "appearance dark light mode theme plum night",
    {
      kind: "select",
      get: (s) => s.theme,
      set: (s, v) => s.setTheme(v as SettingsState["theme"]),
      options: [
        { value: "light", labelKey: `${G}.appearance.light` },
        { value: "dark", labelKey: `${G}.appearance.dark` },
        { value: "auto", labelKey: `${G}.appearance.auto` },
      ],
    }
  ),
  item(
    "audioCues",
    "general",
    `${G}.soundEffects.dictationSounds`,
    `${G}.soundEffects.dictationSoundsDescription`,
    "sound effects beep chime audio cues tone",
    toggle(
      (s) => s.audioCuesEnabled,
      (s, v) => s.setAudioCuesEnabled(v)
    )
  ),
  item(
    "dictationCueSet",
    "general",
    `${G}.soundEffects.cueSet`,
    `${G}.soundEffects.dictationSoundsDescription`,
    "sound effects audio cues cueSet soft classic",
    {
      kind: "select",
      get: (s) => s.dictationCueSet,
      set: (s, v) => s.setDictationCueSet(v as SettingsState["dictationCueSet"]),
      disabled: (s) => !s.audioCuesEnabled,
      options: [
        { value: "soft", labelKey: `${G}.soundEffects.cueSetSoft` },
        { value: "classic", labelKey: `${G}.soundEffects.cueSetClassic` },
      ],
    }
  ),
  item(
    "dictationCueVolume",
    "general",
    `${G}.soundEffects.cueVolume`,
    `${G}.soundEffects.dictationSoundsDescription`,
    "sound effects audio cues cueVolume low medium high",
    {
      kind: "select",
      get: (s) => s.dictationCueVolume,
      set: (s, v) => s.setDictationCueVolume(v as SettingsState["dictationCueVolume"]),
      disabled: (s) => !s.audioCuesEnabled,
      options: [
        { value: "low", labelKey: `${G}.soundEffects.cueVolumeLow` },
        { value: "medium", labelKey: `${G}.soundEffects.cueVolumeMedium` },
        { value: "high", labelKey: `${G}.soundEffects.cueVolumeHigh` },
      ],
    }
  ),
  // The page row is "Disable all notifications" (checked = !notificationsEnabled): mirror it.
  item(
    "notifications",
    "general",
    `${G}.notifications.disableAll`,
    `${G}.notifications.disableAllDescription`,
    "notifications alerts mute silence",
    toggle(
      (s) => !s.notificationsEnabled,
      (s, v) => s.setNotificationsEnabled(!v)
    )
  ),
  item(
    "meetingDetection",
    "general",
    `${G}.notifications.meetingDetection`,
    `${G}.notifications.meetingDetectionDescription`,
    "meeting detection zoom facetime notify",
    toggle(
      (s) => s.notifyMeetingDetection,
      (s, v) => s.setNotifyMeetingDetection(v),
      (s) => !s.notificationsEnabled
    )
  ),
  item(
    "calendarReminders",
    "general",
    `${G}.notifications.calendarReminders`,
    `${G}.notifications.calendarRemindersDescription`,
    "calendar reminders events notify",
    toggle(
      (s) => s.notifyCalendarReminders,
      (s, v) => s.setNotifyCalendarReminders(v),
      (s) => !s.notificationsEnabled
    )
  ),
  item(
    "floatingIcon",
    "general",
    `${G}.floatingIcon.autoHide`,
    `${G}.floatingIcon.autoHideDescription`,
    "floating icon pill hide idle",
    toggle(
      (s) => s.floatingIconAutoHide,
      (s, v) => s.setFloatingIconAutoHide(v)
    )
  ),
  item(
    "startMinimized",
    "general",
    `${G}.startup.startMinimized`,
    `${G}.startup.startMinimizedDescription`,
    "startup launch minimized background",
    toggle(
      (s) => s.startMinimized,
      (s, v) => s.setStartMinimized(v)
    )
  ),
  item(
    "launchAtLogin",
    "general",
    `${G}.startup.launchAtLogin`,
    `${G}.startup.launchAtLoginDescription`,
    "startup login autostart boot",
    link
  ),
  item(
    "uiLanguage",
    "general",
    "settings.language.uiLabel",
    "settings.language.uiDescription",
    "language locale interface ui translation",
    link
  ),
  // Dictation (section id "hotkeys")
  item(
    "dictationHotkey",
    "hotkeys",
    `${G}.hotkey.title`,
    `${G}.hotkey.description`,
    "hotkey shortcut keyboard push to talk tap hold",
    link
  ),
  item(
    "microphone",
    "hotkeys",
    `${G}.microphone.title`,
    `${G}.microphone.description`,
    "mic microphone input device audio",
    link
  ),
  item(
    "autoPaste",
    "hotkeys",
    `${G}.clipboard.autoPaste`,
    `${G}.clipboard.autoPasteDescription`,
    "paste auto insert",
    toggle(
      (s) => s.autoPasteEnabled,
      (s, v) => s.setAutoPasteEnabled(v)
    )
  ),
  item(
    "keepInClipboard",
    "hotkeys",
    `${G}.clipboard.keepInClipboard`,
    `${G}.clipboard.keepInClipboardDescription`,
    "clipboard copy restore",
    toggle(
      (s) => s.keepTranscriptionInClipboard,
      (s, v) => s.setKeepTranscriptionInClipboard(v)
    )
  ),
  item(
    "transcriptionLanguage",
    "hotkeys",
    "settings.language.transcriptionLabel",
    "settings.language.transcriptionDescription",
    "language speak spoken locale chinese",
    link
  ),
  item(
    "autoLearn",
    "hotkeys",
    "settingsPage.dictionary.autoLearnTitle",
    "settingsPage.dictionary.autoLearnDescription",
    "dictionary auto learn corrections words vocabulary",
    link
  ),
  // Models: every one of these feeds the route snapshot, so they navigate.
  item(
    "cleanupEnabled",
    "llms/dictationCleanup",
    "settingsPage.aiModels.enableTextCleanup",
    "settingsPage.aiModels.enableTextCleanupDescription",
    "cleanup filler grammar punctuation llm",
    link
  ),
  item(
    "assistantEnabled",
    "llms/dictationAgent",
    "dictationAgent.enabled",
    "settingsSearch.items.assistantEnabled.description",
    "voice assistant agent",
    link
  ),
  item(
    "screenContext",
    "llms/dictationAgent",
    "dictationAgent.screenContext.enable",
    "dictationAgent.screenContext.description",
    "screen screenshot vision context",
    link,
    "assistantEnabled"
  ),
  item(
    "translationEnabled",
    "llms/dictationTranslation",
    "dictationTranslation.enabled",
    "dictationTranslation.enabledDescription",
    "translate translation language",
    link
  ),
  item(
    "supportModels",
    "llms/supportModels",
    "settingsPage.llms.supportModels.title",
    "settingsPage.llms.supportModels.description",
    "speaker diarization embeddings semantic search local download",
    link
  ),
  item(
    "speakerLabels",
    "stt/noteRecording",
    "settings.meeting.speakerDetection.title",
    "settings.meeting.speakerDetection.description",
    "speaker labels diarization meeting who",
    link
  ),
  item(
    "keyring",
    "routing",
    "keyring.title",
    "keyring.subtitle",
    "api key keys verify credentials provider rotate",
    link
  ),
  // Privacy & Data
  item(
    "audioRetention",
    "privacyData",
    "settingsPage.privacy.audioRetention",
    "settingsPage.privacy.audioRetentionDescription",
    "retention audio recordings delete keep days",
    link
  ),
  item(
    "transcriptRetention",
    "privacyData",
    "settingsPage.privacy.transcriptRetention",
    "settingsPage.privacy.transcriptRetentionDescription",
    "retention transcripts history delete keep days",
    link
  ),
  item(
    "dataRetention",
    "privacyData",
    "settingsPage.privacy.dataRetention",
    "settingsPage.privacy.dataRetentionDescription",
    "retention history save transcripts",
    toggle(
      (s) => s.dataRetentionEnabled,
      (s, v) => s.setDataRetentionEnabled(v)
    )
  ),
  item(
    "saveDiscarded",
    "privacyData",
    "settingsPage.privacy.saveDiscarded",
    "settingsPage.privacy.saveDiscardedDescription",
    "discarded cancelled escape save recover",
    toggle(
      (s) => s.saveDiscardedTranscriptions,
      (s, v) => s.setSaveDiscardedTranscriptions(v),
      (s) => !s.dataRetentionEnabled || s.audioRetentionDays === 0
    )
  ),
  item(
    "storage",
    "privacyData",
    "storage.title",
    "settingsSearch.items.storage.description",
    "storage disk delete models audio reset space",
    link
  ),
  item(
    "permissions",
    "privacyData",
    "settingsPage.permissions.title",
    "settingsPage.permissions.description",
    "permissions microphone accessibility screen recording access",
    link
  ),
  // System
  item(
    "updates",
    "system",
    "updates.automatic",
    "updates.description",
    "updates version release check github",
    link
  ),
  item(
    "debugLogging",
    "system",
    "developerSection.debugMode.label",
    "developerSection.description",
    "debug logs logging developer diagnose",
    link
  ),
  // Routes: one per task, shown with where it runs now; selecting one opens its Patchbay row.
  ...ROUTE_IDS.map((routeId): SettingEntry => ({
    id: `route:${routeId}`,
    path: "routing",
    labelKey: `routes.names.${routeId}`,
    descriptionKey: `routes.subtitles.${routeId}`,
    keywords: `route runs on local cloud provider model endpoint url server device ${ROUTE_SETTINGS_PATH[routeId].replace("/", " ")}`,
    control: { kind: "route", routeId },
  })),
];

export interface SearchGroup {
  section: SettingsSectionType;
  entries: SettingEntry[];
}

export function normalizeForSearch(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

export function anchorIdFor(entry: SettingEntry): string {
  return entry.control.kind === "route" ? `route-${entry.control.routeId}` : entry.id;
}

/** The existing tab label for the breadcrumb's second crumb, when the entry sits in a sub-tab. */
export function subTabLabelKey(entry: SettingEntry): string | null {
  const { section, subTab } = parseSettingsPath(entry.path);
  if (!subTab) return null;
  if (section === "speechToText") return `settingsPage.speechToText.tabs.${subTab}`;
  if (section === "llms") return `settingsPage.llms.tabs.${subTab}`;
  return null;
}

export function searchSettings(query: string, translate: (key: string) => string): SearchGroup[] {
  const tokens = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const scored = SETTINGS_REGISTRY.map((entry, index) => {
    const section = parseSettingsPath(entry.path).section;
    const label = normalizeForSearch(translate(entry.labelKey));
    const haystack = normalizeForSearch(
      [
        translate(entry.labelKey),
        translate(entry.descriptionKey),
        translate(`settingsModal.sections.${section}.label`),
        entry.keywords,
        entry.control.kind === "route" ? translate("common.cloud") : "",
      ].join(" ")
    );
    if (!tokens.every((tok) => haystack.includes(tok))) return null;
    // Label hits rank above description/keyword hits; registry order breaks ties.
    const score = tokens.filter((tok) => label.includes(tok)).length;
    return { entry, section, index, score };
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const groups: SearchGroup[] = [];
  for (const s of scored) {
    const group = groups.find((g) => g.section === s.section);
    if (group) group.entries.push(s.entry);
    else groups.push({ section: s.section, entries: [s.entry] });
  }
  return groups;
}
