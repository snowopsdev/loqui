import type { NoteItem, SpaceItem, TranscriptionItem } from "../types/electron";
import type { PersonalInferenceAPI } from "../services/ai/personalInferenceTypes";
import type { UpdateStatus } from "../types/updates";
import product from "../config/product.json";
import { version } from "../../package.json";

declare global {
  interface Window {
    loquiBrowserPreview?: boolean;
  }
}

const desktopMessage = "Available in the Loqui desktop app. This browser preview uses sample data.";
const unavailable = async (): Promise<never> => {
  throw new Error(desktopMessage);
};
const unsubscribe = () => () => {};
const now = () => new Date().toISOString();

function makeNote(
  id: number,
  title: string,
  content: string,
  noteType: NoteItem["note_type"] = "personal"
): NoteItem {
  return {
    id,
    title,
    content,
    note_type: noteType,
    space_id: 1,
    folder_id: null,
    enhanced_content: null,
    enhancement_prompt: null,
    enhanced_at_content_hash: null,
    source_file: null,
    audio_duration_seconds: null,
    transcript: null,
    calendar_event_id: null,
    participants: null,
    diarization_enabled: null,
    expected_speaker_count: null,
    cloud_id: null,
    is_shared: 0,
    share_token: null,
    created_at: now(),
    updated_at: now(),
    client_note_id: `preview-note-${id}`,
    sync_status: "synced",
    deleted_at: null,
  };
}

// An explicit, in-memory bridge for UI review. No IPC, network proxy, filesystem,
// provider credentials or model downloads are exposed by this adapter.
export function createBrowserPreviewAPI(): Partial<Window["electronAPI"]> {
  let notes = [
    makeNote(
      1,
      "Welcome to Loqui",
      "# A quieter place to think\n\nReview your dictations, collect notes, and explore the assistant.\n\nThis is sample content for the browser preview. Edits last until the page reloads."
    ),
    {
      ...makeNote(
        2,
        "Product catch-up",
        "## Decisions\n\n- Keep setup short and clear.\n- Make local processing easy to understand.\n- Review the desktop navigation together.",
        "meeting"
      ),
      transcript:
        "Speaker 1: Let's make the next step obvious.\nSpeaker 2: Agreed. Start with navigation and settings.",
    },
  ];
  const space: SpaceItem = {
    id: 1,
    client_space_id: "preview-workspace",
    cloud_space_id: null,
    workspace_id: null,
    kind: "private",
    name: "Personal",
    emoji: null,
    sort_order: 0,
    my_role: "admin",
    member_count: 1,
    teams: [],
    sync_status: "synced",
    deleted_at: null,
    created_at: now(),
    updated_at: now(),
  };
  let history: TranscriptionItem[] = [
    "Let's set aside some time tomorrow to review the new desktop experience.",
    "A reminder for the next meeting: bring the notes and keep the agenda short.",
  ].map((text, index) => ({
    id: index + 1,
    text,
    raw_text: text,
    timestamp: now(),
    created_at: now(),
    has_audio: 0,
    audio_duration_ms: null,
    provider: "local",
    model: "Preview",
    status: "completed",
    error_message: null,
    error_code: null,
    client_transcription_id: `preview-${index}`,
    cloud_id: null,
    sync_status: "synced",
    deleted_at: null,
  }));
  let dictionary = ["Loqui", "Parakeet", "Codex"];
  let updateStatus: UpdateStatus = {
    phase: "idle",
    enabled: false,
    channel: "beta",
    version,
    busy: false,
    supported: false,
    releasesUrl: product.releasesUrl,
    error: desktopMessage,
  };
  let snippets: Awaited<ReturnType<Window["electronAPI"]["getSnippets"]>> = [];
  const listeners = new Map<string, Set<(value: any) => void>>();
  const on = (event: string) => (callback: (value: any) => void) => {
    const group = listeners.get(event) ?? new Set();
    listeners.set(event, group);
    group.add(callback);
    return () => {
      group.delete(callback);
    };
  };
  const emit = (event: string, value: unknown) => listeners.get(event)?.forEach((fn) => fn(value));
  const searchNotes = async (query: string) =>
    notes.filter((note) =>
      `${note.title} ${note.content}`.toLowerCase().includes(query.toLowerCase())
    );
  const personalInference: PersonalInferenceAPI = {
    codexStatus: async () => ({ available: false, error: desktopMessage, code: "BROWSER_PREVIEW" }),
    codexLogin: unavailable,
    codexCancelLogin: unavailable,
    codexLogout: unavailable,
    codexModels: async () => ({ data: [], nextCursor: null }),
    codexRateLimits: async () => ({}),
    models: async () => ({ data: [] }),
    credentialStatus: async () => ({ configured: false }),
    credentialSave: unavailable,
    textGenerate: unavailable,
    textStream: unavailable,
    textCancel: async () => {},
    textToolResult: unavailable,
    onTextEvent: unsubscribe,
  };
  return {
    personalInference,
    updates: {
      status: async () => ({ ...updateStatus }),
      preferences: async (patch) => {
        updateStatus = { ...updateStatus, ...patch };
        return { ...updateStatus };
      },
      check: unavailable,
      restart: unavailable,
      completeSetup: async () => ({ ...updateStatus }),
      onStatus: unsubscribe,
      onPrepare: unsubscribe,
      prepared: () => {},
    },
    getPlatform: () =>
      /mac/i.test(navigator.userAgent)
        ? "darwin"
        : /win/i.test(navigator.userAgent)
          ? "win32"
          : "linux",
    getAppVersion: async () => ({ version }),
    getTranscriptions: async () => [...history],
    deleteTranscription: async (id) => {
      history = history.filter((item) => item.id !== id);
      return { success: true };
    },
    clearTranscriptions: async () => {
      const cleared = history.length;
      history = [];
      return { success: true, cleared };
    },
    getSpaces: async () => [{ ...space }],
    getFolders: async () => [],
    getFolderNoteCounts: async () => [{ space_id: 1, folder_id: null, count: notes.length }],
    getNotes: async (type) =>
      notes.filter((note) => !type || note.note_type === type).map((note) => ({ ...note })),
    getSpaceNotes: async () => notes.map((note) => ({ ...note })),
    getNote: async (id) => notes.find((note) => note.id === id) ?? null,
    saveNote: async (title, content, type) => {
      const note = makeNote(
        Math.max(0, ...notes.map((n) => n.id)) + 1,
        title,
        content,
        type === "meeting" ? "meeting" : "personal"
      );
      notes = [note, ...notes];
      emit("noteAdded", note);
      return { success: true, note };
    },
    updateNote: async (id, updates) => {
      const existing = notes.find((note) => note.id === id);
      if (!existing) return { success: false };
      const note = { ...existing, ...updates, updated_at: now() };
      notes = notes.map((item) => (item.id === id ? note : item));
      emit("noteUpdated", note);
      return { success: true, note };
    },
    deleteNote: async (id) => {
      notes = notes.filter((note) => note.id !== id);
      emit("noteDeleted", { id });
      return { success: true };
    },
    onNoteAdded: on("noteAdded"),
    onNoteUpdated: on("noteUpdated"),
    onNoteDeleted: on("noteDeleted"),
    searchNotes,
    semanticSearchNotes: searchNotes,
    semanticReindexAll: async () => ({ success: true, indexed: notes.length }),
    getActions: async () => [],
    getAgentConversationsWithPreview: async () => [],
    getAgentConversations: async () => [],
    getAgentMessages: async () => [],
    semanticSearchConversations: async () => [],
    getDictionary: async () => [...dictionary],
    setDictionary: async (words) => {
      dictionary = [...words];
      return { success: true };
    },
    getSnippets: async () => [...snippets],
    setSnippets: async (items) => {
      snippets = [...items];
      return { success: true };
    },
    getAnalyticsSummary: async () => ({
      totalWords: 33,
      totalDictations: history.length,
      totalSpokenDurationMs: 18000,
      averageWpm: 110,
      currentStreakDays: 1,
      longestStreakDays: 1,
      wpmCoveragePercent: 100,
      daily: [],
    }),
    checkWhisperInstallation: async () => ({ installed: false, working: false }),
    listWhisperModels: async () => ({ success: true, models: [], cache_dir: "Desktop app only" }),
    listParakeetModels: async () => ({ success: true, models: [], cache_dir: "Desktop app only" }),
    modelGetAll: async () => [],
    modelGetActiveDownloads: async () => [],
    modelCheckRuntime: async () => ({ available: false, error: desktopMessage }),
    onModelDownloadProgress: unsubscribe,
    onWhisperDownloadProgress: unsubscribe,
    onParakeetDownloadProgress: unsubscribe,
    modelDownload: unavailable,
    downloadWhisperModel: unavailable,
    downloadParakeetModel: unavailable,
    modelImportGguf: unavailable,
    modelTestLoad: unavailable,
    getSearchModelStatus: async () => ({ downloaded: false }),
    getDiarizationModelStatus: async () => ({ available: false, modelsDownloaded: false }),
    downloadDiarizationModels: unavailable,
    downloadSearchModel: unavailable,
    getAudioStorageUsage: async () => ({ fileCount: 0, totalBytes: 0 }),
    getModelCacheRoot: async () => "Desktop app only",
    noteFilesGetDefaultPath: async () => "Desktop app only",
    getAutoStartEnabled: async () => ({ enabled: false, requiresApproval: false }),
    getDebugState: async () => ({ enabled: false, logPath: null, logLevel: "warn" }),
    setDebugLogging: async () => ({ success: false, error: desktopMessage }),
    openLogsFolder: async () => ({ success: false, error: desktopMessage }),
    acalGetConnectionStatus: async () => ({ connected: false, sourceNames: [] }),
    gcalStartOAuth: async () => ({ success: false, error: desktopMessage }),
    mcalStartOAuth: async () => ({ success: false, error: desktopMessage }),
    acalConnect: async () => ({ success: false, error: desktopMessage }),
    openExternal: async (url) => {
      if (!/^https:\/\//.test(url)) return { success: false };
      window.open(url, "_blank", "noopener,noreferrer");
      return { success: true };
    },
    selectAudioFile: async () => ({ canceled: true, filePaths: [] }),
    downloadUrlAudio: async () => ({ success: false, error: desktopMessage }),
    getSpeakerMappings: async () => [],
  };
}

export function installBrowserPreview() {
  if (!import.meta.env.DEV || window.electronAPI) return;
  window.loquiBrowserPreview = true;
  // Only the explicit subset above is supplied. Optional desktop features remain
  // absent rather than pretending an unsupported operation succeeded.
  window.electronAPI = createBrowserPreviewAPI() as Window["electronAPI"];
  const url = new URL(window.location.href);
  url.searchParams.set("panel", "true");
  window.history.replaceState(null, "", url);
}
