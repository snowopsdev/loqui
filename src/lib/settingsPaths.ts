import type { SettingsSectionType } from "../components/SettingsPage";

export interface SettingsLocation {
  section: SettingsSectionType;
  subTab?: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSectionType[] = [
  "general",
  "hotkeys",
  "speechToText",
  "llms",
  "privacyData",
  "system",
];

export const SPEECH_SUB_TABS = ["dictation", "noteRecording", "upload"] as const;
export const LLM_SUB_TABS = [
  "dictationCleanup",
  "dictationAgent",
  "dictationTranslation",
  "noteFormatting",
  "chatIntelligence",
  "supportModels",
] as const;

const SUB_TABS: Partial<Record<SettingsSectionType, readonly string[]>> = {
  speechToText: SPEECH_SUB_TABS,
  llms: LLM_SUB_TABS,
};

export const SECTION_ALIASES: Record<string, SettingsSectionType> = {
  aiModels: "llms",
  agentConfig: "llms",
  agentMode: "llms",
  dictationAgent: "llms",
  intelligence: "llms",
  meetings: "llms",
  prompts: "llms",
  transcription: "speechToText",
  uploadTranscription: "speechToText",
  stt: "speechToText",
  softwareUpdates: "system",
  privacy: "privacyData",
  permissions: "privacyData",
  developer: "system",
};

export const LEGACY_SUB_TAB: Record<string, string> = {
  transcription: "dictation",
  uploadTranscription: "upload",
  dictationAgent: "dictationAgent",
  meetings: "noteFormatting",
  intelligence: "dictationCleanup",
  agentMode: "chatIntelligence",
  agentConfig: "chatIntelligence",
  aiModels: "dictationCleanup",
  prompts: "dictationCleanup",
};

export function parseSettingsPath(path: string | null | undefined): SettingsLocation {
  if (!path) return { section: "general" };
  const [head, sub] = path.split("/", 2);
  const section = (SETTINGS_SECTIONS as readonly string[]).includes(head)
    ? (head as SettingsSectionType)
    : SECTION_ALIASES[head];
  if (!section) return { section: "general" };
  const subTab = sub || LEGACY_SUB_TAB[head];
  const known = SUB_TABS[section];
  return subTab && (!known || known.includes(subTab)) ? { section, subTab } : { section };
}
