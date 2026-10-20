import { subscribeSettingsDeepLinks } from "../utils/settingsDeepLink";
import { useStartOnboardingListener } from "../hooks/useStartOnboarding";
import WorkspacePresentation from "./WorkspacePresentation";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import {
  executeTranslationChain,
  hasTextContent,
  shouldRunTranslateStep,
} from "../helpers/translationChain";
import { getSettings } from "../stores/settingsStore";
import { updateTranscription as updateInStore } from "../stores/transcriptionStore";
import { getAgentName } from "../utils/agentName";
import { applyChineseScript, resolveChineseScriptTarget } from "../utils/chineseScript";
import logger from "../utils/logger";
import { Zap } from "./icons";
import { cn } from "./lib/utils";
import { Button } from "./ui/button";
import { PAGE_CONTENT_WIDTH_CLASS } from "./ui/pageWidth";

import { useDialogs } from "../hooks/useDialogs";
import { useHotkey } from "../hooks/useHotkey";

import { AlertDialog, ConfirmDialog } from "./ui/dialog";
import { notify } from "./ui/notices";

import { useSettings } from "../hooks/useSettings";

import { sidebarWidth } from "../lib/sidebarMode";
import { buildWorkspaceBreadcrumb } from "../lib/workspaceBreadcrumb";
import { useCollapsibleSidebar } from "../hooks/useCollapsibleSidebar";

import {
  useIsMeetingMode,
  useIsNarrowWindow,
  useMeetingRecordingStore,
} from "../stores/meetingRecordingStore";
import { useSettingsStore } from "../stores/settingsStore";
import {
  clearTranscriptions as clearStore,
  initializeTranscriptions,
  removeTranscription as removeFromStore,
  useShowDiscarded,
  useTranscriptions,
} from "../stores/transcriptionStore";
import { useControlPanelNavItems, viewTitleKey, type ControlPanelView } from "./controlPanelNav";
import ControlPanelSidebar from "./ControlPanelSidebar";
import ControlPanelTopBar from "./ControlPanelTopBar";
import MeetingRecordingMount from "./MeetingRecordingMount";
import MeetingRecordingPill from "./notes/MeetingRecordingPill";
import CaptureControl from "./CaptureControl";
import { useCaptureStatus } from "../hooks/useCaptureStatus";

import { takeAfterSetupIntent } from "../utils/afterSetupIntent";
import { useCreateNote, type CreateNoteOptions } from "../hooks/useCreateNote";
import { useGpuBannerAvailability } from "../hooks/useGpuBannerAvailability";
import {
  initializeNotes,
  initializeNotesTree,
  useActiveNote,
  useActiveFolderId,
  useFolders,
  invalidatePendingNoteNavigation,
  openNoteById,
  restoreLaunchNote,
  navigateToContainer,
  setActiveFolderId,
  setActiveNoteId,
  useActiveNoteId,
} from "../stores/noteStore";
import { isAccessibilitySkipped } from "../utils/permissions";
import { getCachedPlatform } from "../utils/platform";
import HistoryView from "./HistoryView";
import BackgroundActionNoticeListener from "./notes/BackgroundActionNoticeListener";
import FinishDictationSetupCard from "./FinishDictationSetupCard";

import { readPersistedWorkspace, writePersistedWorkspace } from "../lib/workspaceView";
import { requestTranscriptFocus } from "../stores/homeViewStore";
import { WorkspaceNavigationProvider, type WorkspaceNavigation } from "./workspaceNavigation";
import type { ChatViewRequest } from "./chat/chatRequest";
import {
  resolveWorkspaceShortcut,
  isDialogOpen,
  type WorkspaceAction,
} from "../lib/workspaceShortcuts";

const platform = getCachedPlatform();

// Bump to force a one-time full semantic reindex on next launch (see the
// reindex effect for the per-version history).
const SEMANTIC_REINDEX_VERSION = 2;

const SettingsModal = React.lazy(() => import("./SettingsModal"));

const PersonalNotesView = React.lazy(() => import("./notes/PersonalNotesView"));
const InsightsView = React.lazy(() => import("./InsightsView"));
const DictionaryView = React.lazy(() => import("./DictionaryView"));
const UploadAudioView = React.lazy(() => import("./notes/UploadAudioView"));
const IntegrationsView = React.lazy(() => import("./IntegrationsView"));
const ChatView = React.lazy(() => import("./chat/ChatView"));
const CommandSearch = React.lazy(() => import("./CommandSearch"));

interface ControlPanelProps {
  /** Retain admitted owners during setup, but gate new workspace interaction. Plan06 carries both props. */
  workspaceActive?: boolean;
  /** Host increments synchronously at every setup request, before React commits. */
  workspaceActivationEpoch?: React.RefObject<number>;
  onReturnToWorkspace?: () => void;
  /** Open the settings modal at this section on mount (e.g. after onboarding). */
  initialSettingsSection?: string;
}

export default function ControlPanel({
  initialSettingsSection,
  workspaceActive = true,
  workspaceActivationEpoch,
  onReturnToWorkspace,
}: ControlPanelProps = {}) {
  const activeRef = useRef(workspaceActive);
  activeRef.current = workspaceActive;
  const interactionEpoch = useRef(0);
  const invalidateActivation = useCallback(() => {
    interactionEpoch.current += 1;
  }, []);
  // Also protects default hosts using the public request event without an epoch prop.
  useStartOnboardingListener(invalidateActivation);
  const { t } = useTranslation();
  const history = useTranscriptions();
  const [isLoading, setIsLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(!!initialSettingsSection);

  const [settingsSection, setSettingsSection] = useState<string | undefined>(
    initialSettingsSection
  );
  const [settingsActivationId, setSettingsActivationId] = useState<string | undefined>();
  const [aiCTADismissed, setAiCTADismissed] = useState(
    () => localStorage.getItem("aiCTADismissed") === "true"
  );

  const [showSearch, setShowSearch] = useState(false);
  const showDiscarded = useShowDiscarded();
  const [initialWorkspace] = useState(() => readPersistedWorkspace(window.localStorage));
  const lifetime = useRef(false);
  useEffect(() => {
    lifetime.current = true;
    return () => {
      lifetime.current = false;
    };
  }, []);
  const [activeView, setView] = useState<ControlPanelView>(initialWorkspace.view);
  const setActiveView = useCallback((view: ControlPanelView) => {
    // View navigation may keep the current selection, but a late open cannot reclaim it.
    invalidatePendingNoteNavigation();
    setRestoring(false);
    setView(view);
  }, []);
  const [restoring, setRestoring] = useState(
    initialWorkspace.view === "personal-notes" && initialWorkspace.noteId != null
  );
  const restoreRef = useRef<Promise<unknown> | null>(null);
  // Requests seed the composer and never send a message.
  const [chatRequest, setChatRequest] = useState<ChatViewRequest | null>(null);
  const requestNonceRef = useRef(0);
  const navItems = useControlPanelNavItems();
  const isMeetingMode = useIsMeetingMode();
  const isNarrowWindow = useIsNarrowWindow();
  const activeNoteId = useActiveNoteId();
  useEffect(() => {
    if (restoring) return;
    writePersistedWorkspace(window.localStorage, {
      view: activeView,
      noteId: activeNoteId ?? null,
    });
  }, [activeView, activeNoteId, restoring]);

  useEffect(() => {
    if (initialWorkspace.view !== "personal-notes" || initialWorkspace.noteId == null) return;
    // Reuse the same launch operation if StrictMode replays the effect.
    restoreRef.current ??= restoreLaunchNote(initialWorkspace.noteId, {
      isEligible: () => lifetime.current,
      onMissing: () => notify({ kind: "notice", title: t("workspace.noteMissing") }),
      onLoadError: (retry) =>
        notify({
          kind: "alert",
          title: t("workspace.noteLoadError"),
          persistent: true,
          actions: [{ label: t("common.retry"), keepOpen: true, onClick: async () => {
                const result = await retry();
                if (lifetime.current && result !== "error" && result !== "superseded")
                  setRestoring(false);
              } }],
        }),
    });
    let mounted = true;
    void restoreRef.current.then((result) => {
      if (mounted && result !== "error") setRestoring(false);
    });
    return () => {
      mounted = false;
    };
  }, [initialWorkspace, t]);
  const isSidePanelLayout =
    isMeetingMode || (isNarrowWindow && activeView === "personal-notes" && activeNoteId != null);
  const { mode: sidebarMode, toggle: toggleSidebar } = useCollapsibleSidebar(isSidePanelLayout);
  const activeNote = useActiveNote();
  const activeFolderId = useActiveFolderId();
  const folders = useFolders();
  const breadcrumb = buildWorkspaceBreadcrumb({
    view: activeView,
    viewLabel: t(viewTitleKey(activeView)),
    folderName: folders.find((folder) => folder.id === activeFolderId)?.name ?? null,
    noteTitle: activeNote ? activeNote.title || t("notes.list.untitledNote") : null,
  });
  useEffect(() => {
    void initializeNotesTree();
  }, []);
  const recordingNoteId = useMeetingRecordingStore((s) => s.recordingNoteId);
  const recordingFolderId = useMeetingRecordingStore((s) => s.recordingFolderId);
  const [meetingRecordingRequest, setMeetingRecordingRequest] = useState<{
    noteId: number;
    folderId: number;
    event: any;
  } | null>(null);
  const [gpuBannerDismissed, setGpuBannerDismissed] = useState(
    () => localStorage.getItem("gpuBannerDismissedUnified") === "true"
  );

  const { hotkey } = useHotkey();
  const { useCleanupModel } = useSettings();

  // Suppressed while a deep-linked invitation is open so the two never stack.

  // Invitations are owner/admin-only (server-enforced), so the sidebar row
  // only exists when the user can manage a workspace.

  const capture = useCaptureStatus();
  const { createNote } = useCreateNote();
  // The note is created before the view switches so Notes mounts with it already open.
  const handleNewNote = useCallback(
    async (options?: CreateNoteOptions) => {
      await createNote(options);
      if (!options?.canActivate || options.canActivate()) setActiveView("personal-notes");
    },
    [createNote, setActiveView]
  );

  // Plan06 must carry this Ready hand-off beside handleNewNote. The existing
  // useCreateNote/meeting recorder owns creation and recording, including live capture.
  // Run on each actual workspace return, never while the retained workspace is hidden.
  useEffect(() => {
    if (!workspaceActive) return;
    const intent = takeAfterSetupIntent();
    if (!intent) return;
    if (intent.kind === "dictate-note") {
      const interaction = interactionEpoch.current;
      const setup = workspaceActivationEpoch?.current;
      void handleNewNote({
        canActivate: () =>
          activeRef.current &&
          interactionEpoch.current === interaction &&
          workspaceActivationEpoch?.current === setup,
      });
    } else {
      setSettingsSection(intent.path);
      setSettingsActivationId(crypto.randomUUID());
      setShowSettings(true);
    }
  }, [handleNewNote, workspaceActive, workspaceActivationEpoch]);

  const policyMinAppVersion = null;

  // Policy-effective, because the settings pane the GPU banner links to renders
  // the clamped mode — see eligibleGpuOffers.

  const gpuBannerSettings = useSettingsStore(
    useShallow((settings) => {
      const effective = settings;
      return {
        useLocalWhisper: effective.useLocalWhisper,
        localTranscriptionProvider: effective.localTranscriptionProvider,
        useCleanupModel: effective.useCleanupModel,
        cleanupMode: effective.cleanupMode,
        useDictationAgent: effective.useDictationAgent,
        dictationAgentMode: effective.dictationAgentMode,
      };
    })
  );
  const gpuAccelAvailable = useGpuBannerAvailability({
    settings: gpuBannerSettings,
    agentAllowedByPolicy: true,
    dismissed: gpuBannerDismissed,
    settingsOpen: showSettings,
    platform,
  });

  const {
    confirmDialog,
    alertDialog,
    showConfirmDialog,
    showAlertDialog,
    hideConfirmDialog,
    hideAlertDialog,
  } = useDialogs();

  const loadTranscriptions = useCallback(
    async (includeDiscarded?: boolean) => {
      try {
        setIsLoading(true);
        await initializeTranscriptions(undefined, includeDiscarded);
      } catch {
        showAlertDialog({
          title: t("controlPanel.history.couldNotLoadTitle"),
          description: t("controlPanel.history.couldNotLoadDescription"),
        });
      } finally {
        setIsLoading(false);
      }
    },
    [showAlertDialog, t]
  );

  useEffect(() => {
    loadTranscriptions();
  }, [loadTranscriptions]);

  useEffect(() => {
    const { noteFilesEnabled, noteFilesPath } = useSettingsStore.getState();
    if (!noteFilesEnabled) return;
    window.electronAPI?.noteFilesSetEnabled?.(true, noteFilesPath || undefined, {
      skipRebuild: true,
    });
  }, []);

  // One-time background reindex, versioned: v1 backfilled space_id payloads
  // after the spaces migration; v2 backfills cloud-pulled notes, which were
  // never incrementally indexed before the upsert-from-cloud handler gained a
  // vector upsert. Delayed so the Qdrant sidecar has time to come up; if it
  // isn't ready yet the flag stays unset and the next launch retries.
  useEffect(() => {
    if (Number(localStorage.getItem("semanticReindexVersion")) >= SEMANTIC_REINDEX_VERSION) return;
    const timer = setTimeout(() => {
      window.electronAPI
        ?.semanticReindexAll?.()
        .then((result) => {
          if (result?.success) {
            localStorage.setItem("semanticReindexVersion", String(SEMANTIC_REINDEX_VERSION));
          }
        })
        .catch(() => {});
    }, 15_000);
    return () => clearTimeout(timer);
  }, []);

  const pendingMeetingNavigation = useRef(null);
  const pendingNoteNavigation = useRef(null);
  useEffect(() => {
    if (!workspaceActive) return;
    const drain = async () => {
      const data =
        pendingMeetingNavigation.current ??
        (await window.electronAPI?.getPendingMeetingNoteNavigation?.());
      pendingMeetingNavigation.current = data;
      if (!activeRef.current) return;
      pendingMeetingNavigation.current = null;
      if (!data) return;
      invalidateActivation();
      setActiveFolderId(data.folderId);
      setActiveNoteId(data.noteId);
      setActiveView("personal-notes");
      setMeetingRecordingRequest({
        noteId: data.noteId,
        folderId: data.folderId,
        event: data.event,
      });
      initializeNotes(null, 50, data.folderId);
      if (
        data.trigger === "hotkey" &&
        useSettingsStore.getState().meetingHotkeyLayoutMode === "side-panel"
      ) {
        window.electronAPI?.snapToMeetingMode?.();
      }
    };
    drain();
    const cleanup = window.electronAPI?.onMeetingNoteNavigationPending?.(() => {
      // Receipt is newer workspace work even while its IPC payload is pending.
      invalidateActivation();
      return drain();
    });
    return () => cleanup?.();
  }, [workspaceActive, invalidateActivation, setActiveView]);

  useEffect(() => {
    if (!workspaceActive) return;
    const drain = async () => {
      const data =
        pendingNoteNavigation.current ?? (await window.electronAPI?.getPendingNoteNavigation?.());
      pendingNoteNavigation.current = data;
      if (!activeRef.current) return;
      pendingNoteNavigation.current = null;
      if (!data) return;
      invalidateActivation();
      if (data.folderId) {
        setActiveFolderId(data.folderId);
        initializeNotes(null, 50, data.folderId);
      }
      setActiveNoteId(data.noteId);
      setActiveView("personal-notes");
    };
    drain();
    const cleanup = window.electronAPI?.onNoteNavigationPending?.(() => {
      // Keep initial/return drains separate: an empty getter is not a new command.
      invalidateActivation();
      return drain();
    });
    return () => cleanup?.();
  }, [workspaceActive, invalidateActivation, setActiveView]);

  useEffect(
    () =>
      subscribeSettingsDeepLinks(window.electronAPI, (section, activationId) => {
        if (!activeRef.current) return;
        invalidateActivation();
        setSettingsSection(section);
        setSettingsActivationId(activationId);
        setShowSettings(true);
      }),
    [invalidateActivation]
  );

  // When accessibility is missing on macOS, open the permissions settings page
  useEffect(() => {
    const cleanup = window.electronAPI?.onAccessibilityMissing?.(async () => {
      if (!activeRef.current || isAccessibilitySkipped()) return;
      setSettingsSection("privacyData");
      setShowSettings(true);
      notify({
        kind: "notice",
        title: t("controlPanel.accessibilityMissing.title"),
        body: t("controlPanel.accessibilityMissing.description"),
      });
    });
    return () => cleanup?.();
  }, [t]);

  const handleMeetingRecordingRequestHandled = useCallback(
    () => setMeetingRecordingRequest(null),
    []
  );

  // The side-panel layout is shared by meeting mode and by a note opened in a
  // narrow window, so leaving it means different things in each case.
  const handleExitSidePanel = useCallback(() => {
    if (isMeetingMode) window.electronAPI?.restoreFromMeetingMode?.();
    else setActiveNoteId(null);
  }, [isMeetingMode]);

  const copyToClipboard = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        notify({
          kind: "receipt",
          title: t("controlPanel.history.copiedTitle"),
          body: t("controlPanel.history.copiedDescription"),
        });
      } catch (err) {
        notify({
          kind: "alert",
          title: t("controlPanel.history.couldNotCopyTitle"),
          body: t("controlPanel.history.couldNotCopyDescription"),
        });
      }
    },
    [t]
  );

  const deleteTranscription = useCallback(
    async (id: number) => {
      showConfirmDialog({
        title: t("controlPanel.history.deleteTitle"),
        description: t("controlPanel.history.deleteDescription"),
        onConfirm: async () => {
          try {
            const result = await window.electronAPI.deleteTranscription(id);
            if (result.success) {
              removeFromStore(id);
            } else {
              showAlertDialog({
                title: t("controlPanel.history.couldNotDeleteTitle"),
                description: t("controlPanel.history.couldNotDeleteDescription"),
              });
            }
          } catch {
            showAlertDialog({
              title: t("controlPanel.history.couldNotDeleteTitle"),
              description: t("controlPanel.history.couldNotDeleteDescriptionGeneric"),
            });
          }
        },
        variant: "destructive",
      });
    },
    [showConfirmDialog, showAlertDialog, t]
  );

  const clearAllTranscriptions = useCallback(() => {
    showConfirmDialog({
      title: t("controlPanel.history.clearAllTitle"),
      description: t("controlPanel.history.clearAllDescriptionDevice"),
      onConfirm: async () => {
        try {
          const result = await window.electronAPI.clearTranscriptions();
          if (result.success) {
            clearStore();

            notify({ kind: "receipt", title: t("controlPanel.history.clearAllSuccess") });
          } else {
            showAlertDialog({
              title: t("controlPanel.history.clearAllErrorTitle"),
              description: t("controlPanel.history.clearAllErrorDescription"),
            });
          }
        } catch {
          showAlertDialog({
            title: t("controlPanel.history.clearAllErrorTitle"),
            description: t("controlPanel.history.clearAllErrorDescription"),
          });
        }
      },
      variant: "destructive",
    });
  }, [showConfirmDialog, showAlertDialog, t]);

  const showAudioInFolder = useCallback(
    async (id: number) => {
      try {
        const result = await window.electronAPI.showAudioInFolder(id);
        if (!result?.success) {
          notify({ kind: "alert", title: t("controlPanel.history.audioNotFound") });
        }
      } catch {
        notify({ kind: "alert", title: t("controlPanel.history.audioNotFound") });
      }
    },
    [t]
  );

  const retryTranscription = useCallback(
    async (id: number, options?: { isRecover?: boolean }) => {
      try {
        const s = getSettings();

        const result = await window.electronAPI.retryTranscription(id, {
          useLocalWhisper: s.useLocalWhisper,
          localTranscriptionProvider: s.localTranscriptionProvider,
          cloudTranscriptionMode: s.cloudTranscriptionMode,
          cloudTranscriptionProvider: s.cloudTranscriptionProvider,
          cloudTranscriptionModel: s.cloudTranscriptionModel,
          cloudTranscriptionBaseUrl: s.cloudTranscriptionBaseUrl,
          cortiEnvironment: s.cortiEnvironment,
          cortiTenant: s.cortiTenant,
          parakeetModel: s.parakeetModel,
          cohereModel: s.cohereModel,
          whisperModel: s.whisperModel,
          preferredLanguage: s.preferredLanguage,
          transcriptionMode: s.transcriptionMode,
          remoteTranscriptionType: s.remoteTranscriptionType,
          remoteTranscriptionUrl: s.remoteTranscriptionUrl,
          remoteTranscriptionModel: s.remoteTranscriptionModel,
        });
        if (result.success && result.transcription) {
          const rawText = result.transcription.text;
          let finalTranscription = result.transcription;

          // A translation dictation must re-run cleanup-then-translate on retry, not plain cleanup.
          let handledTranslation = false;
          let translationApplied = false;
          if (result.transcription.route_kind === "translation") {
            handledTranslation = true;
            try {
              const [
                { default: ReasoningService },
                { resolveReasoningRoute },
                { getEffectiveCleanupModel, getSettings: getEffectiveSettings },
              ] = await Promise.all([
                import("../services/ReasoningService"),
                import("../helpers/audioManager"),
                import("../stores/settingsStore"),
              ]);
              const settings = getEffectiveSettings();
              const agentName = getAgentName();
              const route = resolveReasoningRoute(rawText, settings, agentName, false, true);
              if (route.kind === "translation") {
                const { text, translated } = await executeTranslationChain({
                  text: rawText,
                  cleanupReachable: route.cleanupReachable,
                  runCleanup: (currentText: string) =>
                    ReasoningService.processText(
                      currentText,
                      getEffectiveCleanupModel(),
                      agentName,
                      route.cleanupConfig
                    ),
                  runTranslate: (currentText: string) =>
                    ReasoningService.processText(currentText, route.model, agentName, route.config),
                  shouldTranslate: shouldRunTranslateStep(
                    settings.translationSourceLanguage,
                    settings.translationTargetLanguage
                  ),
                  onCleanupError: (cleanupError: Error & { messageKey?: string }) => {
                    logger.warn(
                      "Cleanup step failed in translation chain, translating raw transcript",
                      { error: cleanupError.message },
                      "transcription"
                    );
                    // The chain still translates the raw transcript, so say why cleanup
                    // was dropped rather than reporting a clean success (#2091).
                    notify({
                      kind: "notice",
                      id: "cleanup-failed",
                      title: t("notices.cleanupFailed.title"),
                      body: cleanupError.messageKey
                        ? t(cleanupError.messageKey)
                        : cleanupError.message,
                    });
                  },
                  onEmptyTranslate: () =>
                    logger.warn(
                      "Translation step returned empty text, keeping previous text",
                      {},
                      "transcription"
                    ),
                  onUnchangedTranslate: () =>
                    logger.warn(
                      "Translation step returned unchanged text, keeping source text",
                      {},
                      "transcription"
                    ),
                });
                translationApplied = translated;
                if (text !== rawText) {
                  const updated = await window.electronAPI.updateTranscriptionText(
                    id,
                    text,
                    rawText
                  );
                  if (updated.success && updated.transcription) {
                    finalTranscription = updated.transcription;
                  }
                }
              } else {
                // Translation disabled/unreachable since recording — fall through to cleanup.
                handledTranslation = false;
              }
            } catch {
              // Reasoning failed — keep the raw STT result
            }
          }

          // Apply AI reasoning if enabled
          if (!handledTranslation && useCleanupModel) {
            try {
              const [{ default: ReasoningService }, { getEffectiveCleanupModel, getSettings }] =
                await Promise.all([
                  import("../services/ReasoningService"),
                  import("../stores/settingsStore"),
                ]);
              const model = getEffectiveCleanupModel();
              if (model) {
                const agentName = getAgentName();
                const reasonedText = await ReasoningService.processText(rawText, model, agentName, {
                  disableThinking: getSettings().cleanupDisableThinking,
                  requireCompleteOutput: true,
                });
                if (hasTextContent(reasonedText) && reasonedText !== rawText) {
                  const updated = await window.electronAPI.updateTranscriptionText(
                    id,
                    reasonedText,
                    rawText
                  );
                  if (updated.success && updated.transcription) {
                    finalTranscription = updated.transcription;
                  }
                }
              }
            } catch (cleanupError) {
              // The row keeps its raw transcript, so the retry must not look like it
              // cleaned anything — report why, the way dictation does (#2091).
              const failure = cleanupError as Error & { messageKey?: string };
              notify({
                kind: "notice",
                id: "cleanup-failed",
                title: t("notices.cleanupFailed.title"),
                body: failure.messageKey ? t(failure.messageKey) : failure.message,
              });
            }
          }

          // Deterministic Chinese script pass, mirroring dictation (#975). Runs last so
          // it covers the cleaned/translated text, or the raw transcript when neither ran.
          // Same rule as audioManager.getEffectiveOutputLanguage: only a completed
          // translate step moves the text into the target language, so anything else
          // still has to be scripted as the language that was dictated.
          try {
            const outputLanguage =
              result.transcription.route_kind === "translation"
                ? (translationApplied
                    ? s.translationTargetLanguage
                    : s.translationSourceLanguage) || "auto"
                : s.preferredLanguage;
            const scripted = await applyChineseScript(
              finalTranscription.text,
              resolveChineseScriptTarget(
                outputLanguage,
                s.chineseScriptPreference,
                finalTranscription.text
              )
            );
            if (scripted !== finalTranscription.text) {
              const updated = await window.electronAPI.updateTranscriptionText(
                id,
                scripted,
                rawText
              );
              if (updated.success && updated.transcription) {
                finalTranscription = updated.transcription;
              }
            }
          } catch {
            // Conversion failed — keep the text as transcribed
          }

          updateInStore(finalTranscription);
          notify({
            kind: "receipt",
            title: t(
              options?.isRecover
                ? "controlPanel.history.discarded.recovered"
                : "controlPanel.history.retrySuccess"
            ),
          });
        } else {
          notify({
            kind: "alert",
            title: t("controlPanel.history.retryError"),
            body: result.messageKey ? t(result.messageKey) : result.error,
          });
        }
      } catch {
        notify({ kind: "alert", title: t("controlPanel.history.retryError") });
      }
    },
    [t, useCleanupModel]
  );

  const toggleShowDiscarded = useCallback(() => {
    loadTranscriptions(!showDiscarded);
  }, [loadTranscriptions, showDiscarded]);

  const openNote = useCallback(
    async (noteId: number, options?: { isEligible?: () => boolean }) => {
      const isEligible = () => lifetime.current && (options?.isEligible?.() ?? true);
      if (!isEligible()) return;
      setActiveView("personal-notes");
      await openNoteById(noteId, {
        isEligible,
        onMissing: () => notify({ kind: "notice", title: t("workspace.noteMissing") }),
        onLoadError: (retry) =>
          notify({
            kind: "alert",
          title: t("workspace.noteLoadError"),
            persistent: true,
            actions: [{ label: t("common.retry"), keepOpen: true, onClick: async () => {
                  await retry();
                } }],
          }),
      });
    },
    [setActiveView, t]
  );

  const navigation = useMemo<WorkspaceNavigation>(
    () => ({
      openView: setActiveView,
      openNote: (id, options) => void openNote(id, options),
      openFolder: (spaceId, folderId) => {
        setActiveView("personal-notes");
        navigateToContainer(spaceId, folderId);
      },
      openTranscript: (id) => {
        requestTranscriptFocus(id);
        setActiveView("home");
      },
      openConversation: (conversationId) => {
        setChatRequest({ kind: "open", conversationId, nonce: ++requestNonceRef.current });
        setActiveView("chat");
      },
      startChat: (options) => {
        setChatRequest({ kind: "new", draft: options?.draft, nonce: ++requestNonceRef.current });
        setActiveView("chat");
      },
      focusAssistant: () => {
        setChatRequest({ kind: "focus", nonce: ++requestNonceRef.current });
        setActiveView("chat");
      },
      newNote: () => void handleNewNote({ record: false }),
      recordMeeting: () => {
        // Read current state even for callbacks retained across a recording activation.
        const meeting = useMeetingRecordingStore.getState();
        if (meeting.isRecording && meeting.recordingNoteId != null) {
          void openNote(meeting.recordingNoteId);
          return;
        }
        void handleNewNote({ record: true });
      },
      openUpload: () => setActiveView("upload"),
      openSettings: (section) => {
        setSettingsSection(section);
        setShowSettings(true);
      },
      openSearch: () => setShowSearch(true),
    }),
    [openNote, handleNewNote, setActiveView]
  );

  const runShortcutRef = useRef<(action: WorkspaceAction) => void>(() => {});
  runShortcutRef.current = (action) => {
    switch (action) {
      case "openSearch":
        return setShowSearch(true);
      case "openSettings":
        return setShowSettings(true);
      case "goHome":
        return setActiveView("home");
      case "goNotes":
        return setActiveView("personal-notes");
      case "goChat":
        return setActiveView("chat");
      case "toggleSidebar":
        return toggleSidebar();
      case "newNote":
        return navigation.newNote();
      case "newChat":
        return navigation.startChat();
      case "recordMeeting":
        return navigation.recordMeeting();
      case "uploadAudio":
        return navigation.openUpload();
      case "askAssistant":
        return navigation.focusAssistant();
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!activeRef.current) return;
      const action = resolveWorkspaceShortcut(event, {
        platform,
        dialogOpen: isDialogOpen(document),
      });
      if (!action) return;
      invalidateActivation();
      event.preventDefault();
      runShortcutRef.current(action);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [invalidateActivation]);

  return (
    <WorkspaceNavigationProvider value={navigation}>
    <WorkspacePresentation
      active={workspaceActive}
      onInteraction={invalidateActivation}
      className="h-screen bg-surface-window flex flex-col"
    >
      <MeetingRecordingMount />
      <MeetingRecordingPill
        workspaceActive={workspaceActive}
        activeView={activeView}
        activeNoteId={activeNoteId}
        onReturnToNote={() => {
          if (!activeRef.current) {
            onReturnToWorkspace?.();
            return;
          }
          setActiveView("personal-notes");
          setActiveFolderId(recordingFolderId);
          setActiveNoteId(recordingNoteId);
        }}
      />
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={hideConfirmDialog}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
      />

        <AlertDialog
          open={alertDialog.open}
          onOpenChange={hideAlertDialog}
          title={alertDialog.title}
          description={alertDialog.description}
          onOk={() => {}}
        />

        {showSettings && (
          <Suspense fallback={null}>
            <SettingsModal
              open={showSettings}
              onOpenChange={(open) => {
                setShowSettings(open);
                if (!open) {
                  setSettingsSection(undefined);
                  setSettingsActivationId(undefined);
                }
              }}
              initialSection={settingsSection}
              activationId={settingsActivationId}
            />
          </Suspense>
        )}

        {/* Always mounted so the palette chunk is warm and Radix can play its exit animation. */}
        <Suspense fallback={null}>
          <CommandSearch
            open={showSearch}
            onOpenChange={setShowSearch}
            transcriptions={history}
            onNoteSelect={(id) => navigation.openNote(id)}
            onContainerSelect={navigation.openFolder}
            onTranscriptSelect={navigation.openTranscript}
            onConversationSelect={navigation.openConversation}
          />
        </Suspense>

        <div className="flex flex-1 overflow-hidden relative">
          <div
            className="relative shrink-0 overflow-hidden transition-[width] duration-(--motion-base) ease-(--motion-ease-std) motion-reduce:transition-none"
            style={{ width: sidebarWidth(sidebarMode) }}
            inert={sidebarMode === "hidden"}
          >
            <ControlPanelSidebar
              mode={sidebarMode}
              capture={capture}
              activeView={activeView}
              onViewChange={(view) => { invalidateActivation(); setActiveView(view); }}
              onOpenSettings={navigation.openSettings}
            />
          </div>
          <main className="flex-1 flex flex-col overflow-hidden p-2">
            <div className="flex min-h-0 flex-1 flex-col overflow-clip rounded-(--radius-shell) border border-border bg-background dark:border-white/10">
              <ControlPanelTopBar
                breadcrumb={breadcrumb}
                sidebarMode={sidebarMode}
                onToggleSidebar={toggleSidebar}
                onOpenSearch={() => setShowSearch(true)}
                isSidePanelLayout={isSidePanelLayout}
                onExitSidePanel={handleExitSidePanel}
                actions={
                  <CaptureControl
                    capture={capture}
                    hotkey={hotkey}
                    showChat={navItems.some((item) => item.id === "chat")}
                  />
                }
              />
              <div className="scrollbar-hidden flex-1 overflow-y-auto">
                {(gpuAccelAvailable.transcription || gpuAccelAvailable.intelligence) &&
                  activeView === "home" &&
                  !gpuBannerDismissed && (
                    <div className={cn(PAGE_CONTENT_WIDTH_CLASS, "px-6 mb-3")}>
                      <div className="rounded-lg border border-border dark:border-border bg-foreground/5 p-3">
                        <div className="flex items-start gap-3">
                          <div className="shrink-0 w-8 h-8 rounded-md bg-ai/12 border border-ai/30 flex items-center justify-center">
                            <Zap size={16} className="text-ai" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground mb-0.5">
                              {t("controlPanel.gpu.bannerTitle")}
                            </p>
                            <p className="text-xs text-muted-foreground mb-2">
                              {t("controlPanel.gpu.bannerDescription")}
                            </p>
                            <div className="flex items-center gap-3">
                              <Button
                                variant="default"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => {
                                  setSettingsSection(
                                    gpuAccelAvailable.transcription
                                      ? "transcription"
                                      : gpuAccelAvailable.intelligence === "dictationAgent"
                                        ? "dictationAgent"
                                        : "intelligence"
                                  );
                                  setShowSettings(true);
                                }}
                              >
                                {t("controlPanel.gpu.enableButton")}
                              </Button>
                              <button
                                onClick={() => {
                                  setGpuBannerDismissed(true);
                                  localStorage.setItem("gpuBannerDismissedUnified", "true");
                                }}
                                className="focus-visible:ring-2 focus-visible:ring-ring text-caption text-muted-foreground hover:text-foreground transition-colors"
                              >
                                {t("controlPanel.gpu.dismissButton")}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                {activeView === "home" && <FinishDictationSetupCard />}
                {activeView === "home" && (
                  <HistoryView
                    capture={capture}
                    history={history}
                    isLoading={isLoading}
                    hotkey={hotkey}
                    aiCTADismissed={aiCTADismissed}
                    setAiCTADismissed={setAiCTADismissed}
                    useCleanupModel={useCleanupModel}
                    copyToClipboard={copyToClipboard}
                    deleteTranscription={deleteTranscription}
                    clearAllTranscriptions={clearAllTranscriptions}
                    onShowAudioInFolder={showAudioInFolder}
                    onRetryTranscription={retryTranscription}
                    showDiscarded={showDiscarded}
                    onToggleDiscarded={toggleShowDiscarded}
                    onOpenSettings={(section) => {
                      setSettingsSection(section);
                      setShowSettings(true);
                    }}
                    onOpenIntegrations={() => setActiveView("integrations")}
                  />
                )}
                {activeView === "insights" && (
                  <Suspense fallback={null}>
                    <InsightsView />
                  </Suspense>
                )}
                {activeView === "chat" && (
                  <Suspense fallback={null}>
                    <ChatView
                      request={chatRequest}
                      onRequestHandled={() => setChatRequest(null)}
                      onOpenSettings={navigation.openSettings}
                    />
                  </Suspense>
                )}
                {activeView === "personal-notes" && (
                  <Suspense fallback={null}>
                    <PersonalNotesView
                      onOpenSettings={(section) => {
                        setSettingsSection(section);
                        setShowSettings(true);
                      }}
                      meetingRecordingRequest={meetingRecordingRequest}
                      onMeetingRecordingRequestHandled={handleMeetingRecordingRequestHandled}
                    />
                  </Suspense>
                )}
                {activeView === "dictionary" && (
                  <Suspense fallback={null}>
                    <DictionaryView />
                  </Suspense>
                )}
                {activeView === "upload" && (
                  <Suspense fallback={null}>
                    <UploadAudioView
                      onNoteCreated={(noteId, folderId) => {
                        setActiveNoteId(noteId);
                        if (folderId) setActiveFolderId(folderId);
                        setActiveView("personal-notes");
                      }}
                      onOpenSettings={(section) => {
                        setSettingsSection(section);
                        setShowSettings(true);
                      }}
                    />
                  </Suspense>
                )}
                {activeView === "integrations" && (
                  <Suspense fallback={null}>
                    <IntegrationsView />
                  </Suspense>
                )}
              </div>
            </div>
          </main>
        </div>
        <BackgroundActionNoticeListener />
    </WorkspacePresentation>
    </WorkspaceNavigationProvider>
  );
}
