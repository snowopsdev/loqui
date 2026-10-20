import {
  AudioLines,
  Cpu,
  Home,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  NotebookPen,
  Plus,
  Settings,
  SunMoon,
  Upload,
  Sparkles,
} from "lucide-react";
import type { WorkspaceAction } from "../../lib/workspaceShortcuts";
import type { WorkspaceNavigation } from "../workspaceNavigation";

export interface CommandDeps {
  toggleDictation(): void;
  toggleTheme(): void;
  /** The dictationStt route's settingsPath, read at click time (§5.1). */
  speechSettingsPath(): string;
}

export interface WorkspaceCommand {
  id:
    | "newNote"
    | "startDictation"
    | "askAssistant"
    | "goNotes"
    | "goHome"
    | "goChat"
    | "recordMeeting"
    | "uploadAudio"
    | "newChat"
    | "openSettings"
    | "switchSpeechModel"
    | "toggleTheme";
  labelKey: string;
  keywords: readonly string[];
  shortcut?: WorkspaceAction;
  usesHotkey?: boolean;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  run(nav: WorkspaceNavigation, deps: CommandDeps): void;
}

const k = (id: string) => `commandSearch.commands.${id}`;

// WS-R5 A. Every command navigates or toggles; none sends content anywhere.
export const WORKSPACE_COMMANDS: readonly WorkspaceCommand[] = [
  {
    id: "newNote",
    labelKey: k("newNote"),
    keywords: ["create", "write"],
    shortcut: "newNote",
    icon: Plus,
    run: (nav) => nav.newNote(),
  },
  {
    id: "startDictation",
    labelKey: k("startDictation"),
    keywords: ["dictate", "mic", "voice", "record"],
    usesHotkey: true,
    icon: Mic,
    run: (_nav, deps) => deps.toggleDictation(),
  },
  {
    id: "askAssistant",
    labelKey: k("askAssistant"),
    keywords: ["chat", "ai", "question"],
    shortcut: "askAssistant",
    icon: Sparkles,
    run: (nav) => nav.focusAssistant(),
  },
  {
    id: "goNotes",
    labelKey: k("goNotes"),
    keywords: ["notes", "spaces"],
    shortcut: "goNotes",
    icon: NotebookPen,
    run: (nav) => nav.openView("personal-notes"),
  },
  {
    id: "goHome",
    labelKey: k("goHome"),
    keywords: ["home", "history", "today"],
    shortcut: "goHome",
    icon: Home,
    run: (nav) => nav.openView("home"),
  },
  {
    id: "goChat",
    labelKey: k("goChat"),
    keywords: ["chat", "conversations"],
    shortcut: "goChat",
    icon: MessageSquare,
    run: (nav) => nav.openView("chat"),
  },
  {
    id: "recordMeeting",
    labelKey: k("recordMeeting"),
    keywords: ["meeting", "call", "transcribe"],
    shortcut: "recordMeeting",
    icon: AudioLines,
    run: (nav) => nav.recordMeeting(),
  },
  {
    id: "uploadAudio",
    labelKey: k("uploadAudio"),
    keywords: ["file", "import", "audio"],
    shortcut: "uploadAudio",
    icon: Upload,
    run: (nav) => nav.openUpload(),
  },
  {
    id: "newChat",
    labelKey: k("newChat"),
    keywords: ["conversation", "assistant"],
    shortcut: "newChat",
    icon: MessageSquarePlus,
    run: (nav) => nav.startChat(),
  },
  {
    id: "openSettings",
    labelKey: k("openSettings"),
    keywords: ["preferences", "options"],
    shortcut: "openSettings",
    icon: Settings,
    run: (nav) => nav.openSettings(),
  },
  {
    id: "switchSpeechModel",
    labelKey: k("switchSpeechModel"),
    keywords: ["model", "transcription", "whisper", "parakeet"],
    icon: Cpu,
    run: (nav, deps) => nav.openSettings(deps.speechSettingsPath()),
  },
  {
    id: "toggleTheme",
    labelKey: k("toggleTheme"),
    keywords: ["dark", "light", "appearance", "theme"],
    icon: SunMoon,
    run: (_nav, deps) => deps.toggleTheme(),
  },
];

export const SUGGESTED_COMMAND_IDS: readonly WorkspaceCommand["id"][] = [
  "newNote",
  "startDictation",
  "askAssistant",
  "goNotes",
];
