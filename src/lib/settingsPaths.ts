import type { SettingsSectionType } from "../components/SettingsPage";

export interface SettingsLocation {
  section: SettingsSectionType;
  subTab?: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSectionType[] = [
  "general",
  "hotkeys",
  "routing",
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
  routes: "routing",
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

function ownStringValue(values: Record<string, string>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(values, key) && typeof values[key] === "string"
    ? values[key]
    : undefined;
}

export function parseSettingsPath(path: string | null | undefined): SettingsLocation {
  if (!path) return { section: "general" };
  const [head, sub] = path.split("/", 2);
  const resolvedSection = (SETTINGS_SECTIONS as readonly string[]).includes(head)
    ? head
    : ownStringValue(SECTION_ALIASES, head);
  if (!resolvedSection || !(SETTINGS_SECTIONS as readonly string[]).includes(resolvedSection)) {
    return { section: "general" };
  }
  const section = resolvedSection as SettingsSectionType;
  const subTab = sub || ownStringValue(LEGACY_SUB_TAB, head);
  const known = SUB_TABS[section];
  return subTab && (!known || known.includes(subTab)) ? { section, subTab } : { section };
}
