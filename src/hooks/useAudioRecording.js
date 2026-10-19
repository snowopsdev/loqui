import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import AudioManager from "../helpers/audioManager";
import logger from "../utils/logger";
import { playStartCue, playStopCue } from "../utils/dictationCues";
import { getSettings, useSettingsStore } from "../stores/settingsStore";
import { expandSnippets } from "../utils/snippets";
import { getRecordingErrorTitle, getRecordingErrorDescription } from "../utils/recordingErrors";
import { isAccessibilitySkipped } from "../utils/permissions";

import { getOnboardingDemoKind } from "../utils/onboardingDemo";
import {
  buildLiveTranscriptionPreview,
  shouldShowByokStreamingPreview,
} from "../utils/transcriptionPreview";
import { canStartDictation } from "../utils/dictationReadiness";
import { waitForVisualFrames } from "../utils/visualFrame";
import { resolveLifecycleInputKind } from "../helpers/dictationRouting";
import { createAssistantResponseDelivery } from "../helpers/assistantResponseDelivery";
import { notify, dismissNotice, getNotices } from "../components/ui/notices";
import { buildDictationErrorNotice, DICTATION_STATUS_NOTICE_ID } from "../components/voiceNotices";
import { recordCleanupFailure } from "../stores/cleanupFailureStore";

// Maps a failed selection-replacement code to its `selectionEditing.*` toast
// detail key; unlisted codes fall back to the generic "unavailable" message.
const SELECTION_EDIT_DETAIL_KEY_BY_CODE = {
  target_changed: "changed",
  selection_changed: "changed",
  session_expired: "expired",
  paste_failed: "pasteFailed",
};
const COMPANION_AUDIO_LEVEL_INTERVAL_MS = 80;
const countWords = (text) => (text.trim() ? text.trim().split(/\s+/u).length : 0);

let localRecoveryKey = 0;

export const useAudioRecording = (options = {}) => {
  const { t } = useTranslation();
  const [cancelled, setCancelled] = useState(null);
  const [processingStage, setProcessingStage] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const cancelledRef = useRef(null);
  cancelledRef.current = cancelled;
  const escHeldRef = useRef(false);
  const busyRef = useRef(false);
  const outcomeGenerationRef = useRef(0);
  const managerInstallationRef = useRef(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isAssistantVoice, setIsAssistantVoice] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [micCaptureStatus, setMicCaptureStatus] = useState("inactive");
  const [transcript, setTranscript] = useState("");
  const [partialTranscript, setPartialTranscript] = useState("");
  const audioManagerRef = useRef(null);
  const startLockRef = useRef(false);
  const stopRequestedDuringStartRef = useRef(false);
  const pushForceStoppedRef = useRef(false);
  const stopLockRef = useRef(false);
  const preparationGenerationRef = useRef(0);
  const pressCandidateRef = useRef(null);
  const startingCandidateRef = useRef(null);
  const wasRecordingRef = useRef(false);
  const wasMicUnavailableRef = useRef(false);
  const demoKindRef = useRef("dictation");
  const onDemoEventRef = useRef(options.onDemoEvent);
  const reportedLifecycleRef = useRef(null);
  const lastStartOptionsRef = useRef({
    voiceAgentRequested: false,
    translationRequested: false,
  });
  const {
    onToggle,
    onAssistantCommand,
    onOnboardingAssistantCommand,
    onDictationError,
    getAssistantSelectionContext,
    onDemoEvent,
    assistantOpenRef,
    trialMode = false,
  } = options;

  useEffect(() => {
    onDemoEventRef.current = onDemoEvent;
  }, [onDemoEvent]);

  // Read through a ref so a re-render never tears down the AudioManager
  // (the mount effect below must not depend on this callback).
  const onAssistantCommandRef = useRef(onAssistantCommand);
  useEffect(() => {
    onAssistantCommandRef.current = onAssistantCommand;
  });
  const onOnboardingAssistantCommandRef = useRef(onOnboardingAssistantCommand);
  useEffect(() => {
    onOnboardingAssistantCommandRef.current = onOnboardingAssistantCommand;
  });
  const getAssistantSelectionContextRef = useRef(getAssistantSelectionContext);
  useEffect(() => {
    getAssistantSelectionContextRef.current = getAssistantSelectionContext;
  });

  // Reads only refs and the global electronAPI bridge, so a single stable
  // instance is safe to share between the mount effect (recording/processing
  // transitions) and performStartRecording (the toggle path's own "preparing"
  // report).
  const reportLifecycle = useCallback((state, inputKindOverride) => {
    const inputKind =
      inputKindOverride ??
      resolveLifecycleInputKind({
        voiceAgentRequested: audioManagerRef.current?.voiceAgentRequested,
        translationRequested: audioManagerRef.current?.translationRequested,
      });
    const signature = `${state}:${inputKind}`;
    if (reportedLifecycleRef.current === signature) return;
    reportedLifecycleRef.current = signature;
    window.electronAPI?.dictationLifecycleStateChanged?.(state, inputKind);
  }, []);

  const performStartRecording = useCallback(
    async ({ voiceAgentRequested = false, translationRequested = false } = {}) => {
      if (startLockRef.current) return false;
      lastStartOptionsRef.current = { voiceAgentRequested, translationRequested };
      startLockRef.current = true;
      stopRequestedDuringStartRef.current = false;
      pushForceStoppedRef.current = false;
      let recordingStarted = false;
      let candidate = null;
      try {
        if (!audioManagerRef.current) return false;

        if (!canStartDictation(audioManagerRef.current.getState())) return false;

        const assistantSelectionContext = voiceAgentRequested
          ? (getAssistantSelectionContextRef.current?.() ?? null)
          : null;

        const manager = audioManagerRef.current;
        manager._recordingPrivate = trialMode;
        candidate =
          pressCandidateRef.current ??
          manager.getOrCreatePressCandidate(
            {
              voiceAgentRequested,
              translationRequested,
              assistantSelectionContext,
              streaming: manager.shouldUseStreaming(),
              streamingProviderName: manager.shouldUseStreaming()
                ? manager.getStreamingProviderName()
                : null,
            },
            { newPress: true }
          );
        pressCandidateRef.current = candidate;
        startingCandidateRef.current = candidate;
        if (!manager.isPressCandidateAllowed(candidate)) {
          manager.cancelPreparedMicCapture(candidate);
          manager._showUnknownRecipientBlockedStart();
          return false;
        }
        const intents = candidate.intents;
        voiceAgentRequested = intents.voiceAgentRequested;
        translationRequested = intents.translationRequested;
        // The input reads belong to the press, before visual/target/mic awaits.
        if (!manager._pressReadsSession || manager._pressReadsSession !== candidate) {
          manager.setVoiceAgentRequested(voiceAgentRequested);
          manager.setAssistantSelectionContext(intents.assistantSelectionContext);
          manager.setTranslationRequested(translationRequested);
          if (voiceAgentRequested && candidate.settings.voiceAgentScreenContext)
            manager.beginScreenContextCapture();
          if (voiceAgentRequested && !intents.assistantSelectionContext)
            manager.beginSelectionCapture();
          manager._pressReadsSession = candidate;
        }
        const preparationGeneration = ++preparationGenerationRef.current;
        setIsStopping(false);
        setIsPreparing(true);
        // Preserve the requested identity while Windows is still opening the
        // microphone; AudioManager confirms the same value once recording.
        setIsAssistantVoice(voiceAgentRequested);
        await waitForVisualFrames();
        if (preparationGeneration !== preparationGenerationRef.current) {
          audioManagerRef.current.cancelPreparedMicCapture?.(candidate);
          if (pressCandidateRef.current === candidate) pressCandidateRef.current = null;
          return false;
        }

        // Start acquisition only after the compact thinking frame has reached
        // the compositor. startRecording() joins this prepared capture, so the
        // device still opens exactly once.
        void audioManagerRef.current.prepareMicCapture?.({ candidate });

        // The floating dictation panel is non-focusable, so the foreground app is
        // still the user's actual editing target here. Refresh it for recordings
        // started from the panel itself as well as from global hotkeys; otherwise
        // paste can reactivate a stale target from the preceding dictation.
        try {
          await window.electronAPI.captureDictationTarget?.();
        } catch (error) {
          logger.warn("Failed to refresh dictation target", { error: error?.message });
        }

        demoKindRef.current = getOnboardingDemoKind(voiceAgentRequested);
        reportLifecycle("preparing");

        // Retry STT config fetch if it wasn't loaded on mount (e.g. auth wasn't ready).
        // Await it only when it can change the start decision (signed-in
        // OpenWhispr-cloud streaming); for local STT or a signed-out session the
        // fetch stalls on auth resolution and would delay the mic open (#1673).

        const didStart = candidate.intents.streaming
          ? await audioManagerRef.current.startStreamingRecording(false, candidate)
          : await audioManagerRef.current.startRecording(false, candidate);
        recordingStarted = didStart;
        if (didStart && pressCandidateRef.current === candidate) pressCandidateRef.current = null;
        if (didStart) {
          dismissNotice(DICTATION_STATUS_NOTICE_ID);
        }

        // A stop that landed while the start was still awaiting the mic open was
        // dropped (isRecording was still false), leaving a runaway recording
        // until the next hotkey press. Honor it now that we started.
        if (didStart && stopRequestedDuringStartRef.current) {
          // Cue semantics mirror performStopRecording: unconditional for
          // streaming, gated on the stop landing for batch.
          if (audioManagerRef.current.getState().isStreaming) {
            void playStopCue();
            await audioManagerRef.current.stopStreamingRecording();
          } else if (audioManagerRef.current.stopRecording()) {
            void playStopCue();
          }
          return didStart;
        }

        // A quick tap can end the recording inside the start call itself (deferred
        // streaming stop) — don't pause media for a recording that already ended. See #1060.
        if (didStart && audioManagerRef.current.getState().isRecording) {
          if (getSettings().pauseMediaOnDictation) {
            window.electronAPI?.pauseMediaPlayback?.();
          }
          void playStartCue();
        }

        return didStart;
      } finally {
        if (startingCandidateRef.current === candidate) startingCandidateRef.current = null;
        startLockRef.current = false;
        // A stop that landed mid-start set isStopping expecting the started
        // recording's state change to clear it; if the recording never began,
        // no state change will ever arrive.
        if (stopRequestedDuringStartRef.current && !recordingStarted) setIsStopping(false);
        stopRequestedDuringStartRef.current = false;
        if (!recordingStarted) {
          audioManagerRef.current?.cancelPreparedMicCapture?.(candidate);
          if (pressCandidateRef.current === candidate) pressCandidateRef.current = null;
          setIsPreparing(false);
          setIsAssistantVoice(false);
          // Covers every exit above that never started a recording — the
          // policy-block early return, the mic-open failure, a stale
          // preparation generation, etc. Without this, a failed start leaves
          // the main process (and the companion pill) stuck reporting
          // "preparing" forever, since startRecording's failure path only
          // fires onError, never the onStateChange that normally reports
          // "idle". The signature dedup makes this a no-op when
          // onStateChange already reported it first.
          if (reportedLifecycleRef.current?.startsWith("preparing:")) reportLifecycle("idle");
        }
      }
    },
    [reportLifecycle, trialMode]
  );

  const performStopRecording = useCallback(async () => {
    if (startLockRef.current) {
      stopRequestedDuringStartRef.current = true;
      setIsPreparing(false);
      setIsStopping(true);
      return true;
    }
    if (stopLockRef.current) return false;
    stopLockRef.current = true;
    try {
      if (!audioManagerRef.current) return false;

      const currentState = audioManagerRef.current.getState();
      if (!currentState.isRecording && !currentState.isStreamingStartInProgress) return false;

      // Esc stays armed through processing; onStateChange releases it at idle.
      setIsPreparing(false);
      setIsStopping(true);
      // Contract to the stable thinking state before MediaRecorder/streaming
      // finalization can occupy the renderer on slower Windows machines.
      await waitForVisualFrames();

      if (currentState.isStreaming || currentState.isStreamingStartInProgress) {
        void playStopCue();
        return await audioManagerRef.current.stopStreamingRecording();
      }

      const didStop = audioManagerRef.current.stopRecording();

      if (didStop) {
        void playStopCue();
      }

      return didStop;
    } finally {
      stopLockRef.current = false;
      setIsStopping(false);
    }
  }, []);

  useEffect(() => {
    const installation = ++managerInstallationRef.current;
    const manager = new AudioManager();
    audioManagerRef.current = manager;

    // Resolve and pin the input device now, not on the first hotkey press, which
    // would otherwise wait on the device lookup before the mic can open.
    void audioManagerRef.current.cacheMicrophoneDeviceId?.();

    // Reset stale main-process state after a renderer reload or crash recovery.
    reportLifecycle("idle");

    const getRecoverableTranscript = (fallback = "") =>
      fallback.trim()
        ? fallback
        : buildLiveTranscriptionPreview(
            audioManagerRef.current?.streamingFinalText,
            audioManagerRef.current?.streamingPartialText
          );

    // Only a delivered Paste again or explicit Dismiss removes held words.
    const showDictationError = (
      {
        title,
        description,
        transcript = "",
        recoveryHeld = false,
        sessionId = null,
        outcomeGeneration = outcomeGenerationRef.current,
      },
      extraActions = []
    ) => {
      const recoverAssistant = Boolean(audioManagerRef.current?.voiceAgentRequested);
      if (outcomeGeneration === outcomeGenerationRef.current) {
        setOutcome({ sessionId: sessionId ?? "", kind: "failed", at: Date.now() });
      }
      onDictationError?.({ recoverAssistant });
      const noticeId = notify(
        buildDictationErrorNotice(
          {
            title,
            description,
            words: getRecoverableTranscript(transcript),
            recoveryHeld,
            sessionKey: sessionId ?? `local-${++localRecoveryKey}`,
          },
          t,
          {
            extraActions,
            retry: () => {
              void performStartRecording(lastStartOptionsRef.current);
            },
            pasteAgain: async (words) => {
              const pasted = await audioManagerRef.current?.safePaste(words, {
                restoreClipboard: false,
                allowClipboardFallback: true,
              });
              if (pasted !== true) return;
              if (getNotices().some((n) => n.id === noticeId && n.revision === revision)) {
                dismissNotice(noticeId, "action");
              }
              notify({ kind: "receipt", title: t("notices.pasted") });
            },
          }
        )
      );
      const revision = getNotices().find((n) => n.id === noticeId)?.revision;
      if (noticeId !== DICTATION_STATUS_NOTICE_ID)
        dismissNotice(DICTATION_STATUS_NOTICE_ID, "replaced");
      return noticeId;
    };

    const handleCancelledChange = (state, closed) => {
      if (managerInstallationRef.current !== installation || audioManagerRef.current !== manager)
        return;
      // An old save can close A after the manager has already opened B.
      // It owns neither B's UI nor its lifecycle report or demo publication.
      if (!state && closed && cancelledRef.current?.sessionId !== closed.sessionId) return;
      cancelledRef.current = state;
      setCancelled(state);
      const am = audioManagerRef.current;
      if (!busyRef.current && !am?.isRecording && !am?.isProcessing) {
        reportLifecycle(state ? "cancelled" : "idle");
      }
      if (state) {
        onDemoEventRef.current?.({
          kind: demoKindRef.current,
          status: "cancelled",
          sessionId: state.sessionId,
          cancelled: state,
        });
      } else if (closed) {
        onDemoEventRef.current?.({
          kind: demoKindRef.current,
          status: "cancelClosed",
          sessionId: closed.sessionId,
          reason: closed.reason,
        });
      }
    };

    audioManagerRef.current.setCallbacks({
      onStateChange: ({ isRecording, isProcessing, isStreaming, micCaptureStatus }) => {
        const busy = Boolean(isRecording || isProcessing);
        if ((isRecording && !wasRecordingRef.current) || (busy && !busyRef.current)) {
          outcomeGenerationRef.current += 1;
        }
        busyRef.current = busy;
        if (busy && !escHeldRef.current) {
          escHeldRef.current = true;
          window.electronAPI?.registerCancelHotkey?.("Escape");
        } else if (!busy && escHeldRef.current) {
          escHeldRef.current = false;
          window.electronAPI?.unregisterCancelHotkey?.();
        }
        if (!busy) setProcessingStage(null);
        reportLifecycle(
          isRecording
            ? "recording"
            : isProcessing
              ? "processing"
              : cancelledRef.current
                ? "cancelled"
                : "idle"
        );
        if (isRecording) {
          onDemoEventRef.current?.({ kind: demoKindRef.current, status: "listening" });
        } else if (isProcessing) {
          onDemoEventRef.current?.({ kind: demoKindRef.current, status: "processing" });
        }
        if (!isRecording) {
          // Resume media the instant recording ends, not after transcription.
          if (wasRecordingRef.current && getSettings().pauseMediaOnDictation) {
            window.electronAPI?.resumeMediaPlayback?.();
          }
        }
        wasRecordingRef.current = isRecording;
        setIsRecording(isRecording);
        setIsProcessing(isProcessing);
        setIsStreaming(isStreaming ?? false);
        if (isRecording) setIsPreparing(false);
        if (!isRecording) setIsStopping(false);
        // The panel only mirrors assistant-routed recordings; a plain
        // dictation started while it is open must not masquerade as a
        // follow-up (its transcript takes the paste route, not the panel).
        setIsAssistantVoice(!!audioManagerRef.current?.voiceAgentRequested);
        if (micCaptureStatus) {
          setMicCaptureStatus(micCaptureStatus);
          const unavailable = micCaptureStatus === "unavailable";
          if (unavailable && !wasMicUnavailableRef.current) {
            wasMicUnavailableRef.current = true;
            notify({
              id: "mic",
              title: t("hooks.audioRecording.micDisconnected.title"),
              body: t("hooks.audioRecording.micDisconnected.description"),
              kind: "notice",
            });
          } else if (micCaptureStatus === "active" && wasMicUnavailableRef.current) {
            wasMicUnavailableRef.current = false;
            notify({
              id: "mic",
              title: t("hooks.audioRecording.micRestored.title"),
              body: t("hooks.audioRecording.micRestored.description"),
              kind: "receipt",
            });
          } else if (micCaptureStatus === "inactive") {
            wasMicUnavailableRef.current = false;
          }
        }
        if (!isStreaming) {
          setPartialTranscript("");
        }
      },
      onCancelledChange: handleCancelledChange,
      onProcessingStage: (stage) => setProcessingStage(stage),
      onError: (error) => {
        const sessionId = audioManagerRef.current?.activeSession?.id ?? null;
        setIsPreparing(false);
        setIsStopping(false);
        if (error?.code === "TRANSCRIPTION_CANCELLED" || error?.code === "REASON_CANCELLED") return;
        onDemoEventRef.current?.({
          kind: demoKindRef.current,
          status: "error",
          message: error?.message,
        });
        if (error?.title !== "Paste Error") {
          window.electronAPI?.hideDictationPreview?.();
        }
        const title = getRecordingErrorTitle(error, t);
        const description = getRecordingErrorDescription(error, t);
        if (error?.variant === "default") {
          // Informational outcomes (SCREEN_CONTEXT_SKIPPED after a successful
          // text-only retry) are notices, not failures: no card, no Retry.
          notify({ kind: "notice", title, body: description });
        } else {
          showDictationError({
            title,
            description,
            sessionId,
          });
        }
        if (getSettings().pauseMediaOnDictation) {
          window.electronAPI?.resumeMediaPlayback?.();
        }
      },
      onNoAudio: () => {
        setIsPreparing(false);
        setIsStopping(false);
        onDemoEventRef.current?.({
          kind: demoKindRef.current,
          status: "error",
          message: t("hooks.audioRecording.noAudio.title"),
        });
        window.electronAPI?.hideDictationPreview?.();
        if (getSettings().pauseMediaOnDictation) {
          window.electronAPI?.resumeMediaPlayback?.();
        }
        showDictationError({
          title: t("hooks.audioRecording.noAudio.title"),
          description: t("hooks.audioRecording.noAudio.description"),
        });
      },
      onPartialTranscript: (text) => {
        onDemoEventRef.current?.({ kind: demoKindRef.current, status: "partial", text });
        setPartialTranscript(text);
        const settings = getSettings();
        if (
          audioManagerRef.current?.getStreamingProviderName?.() !== "tinfoil-realtime" &&
          shouldShowByokStreamingPreview(
            settings.showTranscriptionPreview,
            settings.cloudTranscriptionMode,
            !!audioManagerRef.current?.voiceAgentRequested
          )
        ) {
          const previewText = buildLiveTranscriptionPreview(
            audioManagerRef.current?.streamingFinalText,
            text
          );
          window.electronAPI
            ?.updateDictationPreview?.(previewText)
            .catch((error) =>
              logger.warn("Failed to update transcription preview", { error: error?.message })
            );
        }
      },
      onTranscriptionComplete: async (result) => {
        const session = audioManagerRef.current?.activeSession ?? null;
        const sessionId = session?.id ?? null;
        const sessionPrivate = session?.private === true;
        const outcomeGeneration = outcomeGenerationRef.current;
        // Capture the operation before persistence or paste can yield.
        const retryCleanup = result.cleanupFailure?.retryCleanup;
        if (result.success) {
          dismissNotice(DICTATION_STATUS_NOTICE_ID);
          const transcribedText = result.text?.trim();

          if (!transcribedText) {
            window.electronAPI?.hideDictationPreview?.();
            showDictationError({
              outcomeGeneration,
              sessionId,
              title: t("hooks.audioRecording.noAudio.title"),
              description: t("hooks.audioRecording.noAudio.description"),
            });
            return;
          }

          // A selection edit must replace the model's exact result. Snippet
          // expansion is a dictation convenience and can otherwise mutate a
          // legitimate replacement that happens to contain a snippet trigger.
          if (!result.selectionEdit?.sessionId) {
            result.text = expandSnippets(result.text, getSettings().snippets);
          }

          setTranscript(result.text);
          if (result.assistantConversation) {
            window.electronAPI?.hideDictationPreview?.();
            const { screenContext, transcript, selectedContext, deliverySessionId, operation } =
              result.assistantConversation;
            const command = {
              text: expandSnippets(
                transcript,
                operation ? (operation.settings.snippets ?? []) : getSettings().snippets
              ),
              operation: operation ?? null,
              attachment: screenContext
                ? { image: screenContext.data, mediaType: screenContext.mediaType }
                : null,
            };
            if (localStorage.getItem("onboardingCompleted") !== "true") {
              // The assistant panel would cover the onboarding flow, so a headless
              // responder answers and streams the reply back as demo events.
              onDemoEventRef.current?.({
                kind: demoKindRef.current,
                status: "processing",
                text: command.text,
              });
              onOnboardingAssistantCommandRef.current?.(command);
            } else {
              const { autoPasteEnabled, keepTranscriptionInClipboard } = getSettings();
              onAssistantCommandRef.current?.({
                ...command,
                selectedContext: selectedContext ?? null,
                delivery: createAssistantResponseDelivery({
                  autoPasteEnabled,
                  deliverySessionId,
                  restoreClipboard: !keepTranscriptionInClipboard,
                  allowClipboardFallback: isAccessibilitySkipped(),
                }),
              });
            }
          } else {
            onDemoEventRef.current?.({
              kind: demoKindRef.current,
              status: "success",
              text: result.text,
            });
            window.electronAPI?.completeDictationPreview?.({ text: result.text });
          }

          if (result.warning) {
            notify({
              title: t("hooks.audioRecording.partialTranscription.title"),
              body: t("hooks.audioRecording.partialTranscription.description"),
              kind: "notice",
            });
          }

          const isStreaming = result.source?.includes("streaming");
          const {
            autoPasteEnabled: configuredAutoPaste,
            keepTranscriptionInClipboard: configuredKeepClipboard,
          } = getSettings();
          // Onboarding's first recording is a private capability check. It must
          // remain inside Loqui and must not create history, write the clipboard,
          // or paste into another application before the user has opted in.
          const autoPasteEnabled = trialMode ? false : configuredAutoPaste;
          const keepTranscriptionInClipboard = trialMode ? false : configuredKeepClipboard;

          const persistencePromise = trialMode
            ? Promise.resolve(true)
            : audioManagerRef.current
                .saveTranscription(result.text, result.rawText ?? result.text, {
                  clientTranscriptionId: result.clientTranscriptionId,
                  sessionId,
                  private: sessionPrivate,
                  // Spread rather than set: a result with no analytics timestamp
                  // must not gain the key as undefined, matching how audioManager
                  // carries this field and keeping the options object exactly what
                  // callers without Insights data expect.
                  ...(result.analyticsOccurredAt
                    ? { analyticsOccurredAt: result.analyticsOccurredAt }
                    : {}),
                })
                .then(
                  (persisted) => {
                    if (!persisted) {
                      logger.error(
                        "Failed to persist transcription",
                        {
                          clientTranscriptionId: result.clientTranscriptionId,
                          source: result.source,
                        },
                        "audio"
                      );
                    }
                    return persisted;
                  },
                  (error) => {
                    logger.error(
                      "Failed to persist transcription",
                      {
                        clientTranscriptionId: result.clientTranscriptionId,
                        error: error?.message,
                        source: result.source,
                      },
                      "audio"
                    );
                    return false;
                  }
                );

          const keepInClipboard = async (delivery) => {
            try {
              const clipboardResult = await window.electronAPI?.writeClipboard?.(result.text);
              if (clipboardResult?.success !== true) {
                throw new Error("clipboard-write-failed");
              }
              return true;
            } catch (error) {
              logger.warn(
                "Failed to keep transcription in clipboard",
                { delivery, error: error?.message },
                "clipboard"
              );
              return false;
            }
          };

          if (pushForceStoppedRef.current && autoPasteEnabled && !result.assistantConversation) {
            // The push hit its safety ceiling while the trigger keys were still
            // down. Injecting the paste shortcut into those held modifiers is
            // what silently loses the transcript, so keep it instead.
            const keptInClipboard = await keepInClipboard("push-force-stopped");
            window.electronAPI?.hideDictationPreview?.();
            showDictationError({
              outcomeGeneration,
              sessionId,
              title: t("hooks.audioRecording.pushForceStopped.title"),
              // Never promise a clipboard that rejected the write; the transcript
              // action on this pill is the recovery path either way.
              description: t(
                keptInClipboard
                  ? "hooks.audioRecording.pushForceStopped.description"
                  : "hooks.audioRecording.pushForceStopped.descriptionClipboardFailed"
              ),
              transcript: result.rawText ?? result.text,
            });
          } else if (autoPasteEnabled && !result.assistantConversation) {
            const pasteStart = performance.now();
            let pasteSucceeded;
            if (result.selectionEdit?.sessionId) {
              const replacement = await window.electronAPI?.replaceSelectedText?.(
                result.selectionEdit.sessionId,
                result.text,
                {
                  restoreClipboard: !keepTranscriptionInClipboard,
                  allowClipboardFallback: isAccessibilitySkipped(),
                }
              );
              pasteSucceeded = replacement?.success === true;
              if (!pasteSucceeded) {
                window.electronAPI?.hideDictationPreview?.();
                if (keepTranscriptionInClipboard) {
                  await keepInClipboard("selection-edit-fallback");
                }
                const detailKey =
                  SELECTION_EDIT_DETAIL_KEY_BY_CODE[replacement?.code] || "unavailable";
                showDictationError({
                  outcomeGeneration,
                  sessionId,
                  title: t("hooks.audioRecording.selectionEditing.notAppliedTitle"),
                  description: t(`hooks.audioRecording.selectionEditing.${detailKey}`),
                  transcript: result.rawText ?? result.text,
                });
              }
            } else {
              pasteSucceeded = await audioManagerRef.current.safePaste(result.text, {
                ...(isStreaming ? { fromStreaming: true } : {}),
                restoreClipboard: !keepTranscriptionInClipboard,
                allowClipboardFallback: isAccessibilitySkipped(),
              });
            }
            logger.info(
              "Paste timing",
              {
                pasteMs: Math.round(performance.now() - pasteStart),
                source: result.source,
                textLength: result.text.length,
                selectionEdit: !!result.selectionEdit,
                success: pasteSucceeded,
              },
              "streaming"
            );
            // The text has landed at the cursor; a preview lingering with the
            // final transcript after the paste reads as a stray surface. A
            // failed paste keeps the final flash so the transcript stays
            // visible somewhere.
            if (!pasteSucceeded && !result.selectionEdit?.sessionId) {
              showDictationError({
                outcomeGeneration,
                sessionId,
                title: t("notices.pasteFailed"),
                transcript: result.rawText ?? result.text,
              });
            }
            if (pasteSucceeded) {
              if (outcomeGeneration === outcomeGenerationRef.current) {
                setOutcome({
                  sessionId: sessionId ?? "",
                  kind: "pasted",
                  words: countWords(result.text),
                  at: Date.now(),
                });
              }
              window.electronAPI?.hideDictationPreview?.();
              if (result.cleanupFailure)
                recordCleanupFailure({
                  ...result.cleanupFailure,
                  rawText: result.text,
                  retryCleanup,
                });
            }
          } else if (keepTranscriptionInClipboard && !result.assistantConversation) {
            await keepInClipboard("clipboard-only");
          }

          if (result.source === "openai" && getSettings().useLocalWhisper) {
            notify({
              title: t("hooks.audioRecording.fallback.title"),
              body: t("hooks.audioRecording.fallback.description"),
              kind: "notice",
            });
          }

          if (audioManagerRef.current.shouldUseStreaming()) {
            audioManagerRef.current.warmupStreamingConnection();
          }

          await persistencePromise;
        }
      },
      onTranslationFallback: ({ reason }) => {
        // Fail-open: the raw text was still pasted; the toast removes the silence.
        notify({
          title:
            reason === "unreachable"
              ? t("hooks.audioRecording.translationFallback.unreachableTitle")
              : t("hooks.audioRecording.translationFallback.failedTitle"),
          body:
            reason === "unreachable"
              ? t("hooks.audioRecording.translationFallback.unreachableDescription")
              : t("hooks.audioRecording.translationFallback.failedDescription"),
          kind: "alert",
        });
      },
    });

    // Keep overlay content protection in sync with the screen-context setting
    // so the dictation pill stays out of captures (survives window recreation).
    window.electronAPI.setScreenContextEnabled?.(getSettings().voiceAgentScreenContext);
    // A policy refresh can flip the effective screen-context value mid-session;
    // re-sync overlay content protection when it does.
    const unsubscribeSettings = useSettingsStore.subscribe(() => {
      window.electronAPI.setScreenContextEnabled?.(getSettings().voiceAgentScreenContext);
    });

    const handleToggle = async ({
      voiceAgentRequested = false,
      translationRequested = false,
    } = {}) => {
      if (!audioManagerRef.current) return;
      const currentState = audioManagerRef.current.getState();

      // A start still awaiting the mic open leaves isRecording false, so without
      // the lock check this toggle-off would take the start branch and be lost.
      if (startLockRef.current || currentState.isRecording) {
        await performStopRecording();
      } else if (canStartDictation(currentState)) {
        await performStartRecording({ voiceAgentRequested, translationRequested });
      }
    };

    const handleStart = async () => {
      await performStartRecording();
    };

    const handleStop = async () => {
      await performStopRecording();
    };

    const disposeToggle = window.electronAPI.onToggleDictation(() => {
      handleToggle();
      onToggle?.();
    });

    const disposeVoiceAgentToggle = window.electronAPI.onToggleVoiceAgent?.(() => {
      handleToggle({ voiceAgentRequested: true });
      onToggle?.();
    });

    const disposeTranslationToggle = window.electronAPI.onToggleTranslation?.(() => {
      handleToggle({ translationRequested: true });
      onToggle?.();
    });

    const disposeStart = window.electronAPI.onStartDictation?.(() => {
      handleStart();
      onToggle?.();
    });

    const disposePrepare = window.electronAPI.onPrepareDictation?.(async (options) => {
      if (!audioManagerRef.current || startLockRef.current) return;
      if (!canStartDictation(audioManagerRef.current.getState())) return;
      const manager = audioManagerRef.current;
      manager._recordingPrivate = trialMode;
      const voiceAgentRequested = options?.inputKind === "assistant";
      const translationRequested = options?.inputKind === "translation";
      const assistantSelectionContext = voiceAgentRequested
        ? (getAssistantSelectionContextRef.current?.() ?? null)
        : null;
      const streaming = manager.shouldUseStreaming();
      const candidate = manager.getOrCreatePressCandidate(
        {
          voiceAgentRequested,
          translationRequested,
          assistantSelectionContext,
          streaming,
          streamingProviderName: streaming ? manager.getStreamingProviderName() : null,
        },
        { newPress: true }
      );
      pressCandidateRef.current = candidate;
      if (!manager.isPressCandidateAllowed(candidate)) {
        manager.cancelPreparedMicCapture(candidate);
        if (pressCandidateRef.current === candidate) pressCandidateRef.current = null;
        manager._showUnknownRecipientBlockedStart();
        setIsPreparing(false);
        return;
      }
      manager.setVoiceAgentRequested(voiceAgentRequested);
      manager.setAssistantSelectionContext(assistantSelectionContext);
      manager.setTranslationRequested(translationRequested);
      if (voiceAgentRequested && candidate.settings.voiceAgentScreenContext)
        manager.beginScreenContextCapture();
      if (voiceAgentRequested && !assistantSelectionContext) manager.beginSelectionCapture();
      manager._pressReadsSession = candidate;
      const generation = ++preparationGenerationRef.current;
      setIsAssistantVoice(voiceAgentRequested);
      setIsPreparing(true);
      // The prepare event precedes the flag-setting start, so the kind must come
      // from the payload — the audioManager flags still describe the PREVIOUS
      // recording at this point.
      reportLifecycle("preparing", options?.inputKind);
      await waitForVisualFrames();
      if (generation !== preparationGenerationRef.current || startLockRef.current) {
        // Start can legitimately supersede this wait while adopting the same
        // press. Its own terminal paths now own releasing that exact candidate.
        if (startingCandidateRef.current !== candidate && manager.activeSession !== candidate) {
          manager.cancelPreparedMicCapture?.(candidate);
          if (pressCandidateRef.current === candidate) pressCandidateRef.current = null;
        }
        return;
      }
      void manager.prepareMicCapture?.({ candidate });
    });

    const disposeCancelPreparation = window.electronAPI.onCancelDictationPreparation?.(() => {
      preparationGenerationRef.current += 1;
      setIsPreparing(false);
      audioManagerRef.current?.cancelPreparedMicCapture?.(pressCandidateRef.current);
      pressCandidateRef.current = null;
      if (reportedLifecycleRef.current?.startsWith("preparing:")) reportLifecycle("idle");
    });

    const disposeStop = window.electronAPI.onStopDictation?.(() => {
      handleStop();
      onToggle?.();
    });

    const disposeForceStopped = window.electronAPI.onDictationForceStopped?.((payload) => {
      // Listed rather than negated: a future renderer-initiated stop would not
      // leave the keys down, and must not be swept in here.
      if (payload?.reason === "timeout" || payload?.reason === "reset") {
        pushForceStoppedRef.current = true;
      }
    });

    // Cleanup
    return () => {
      // The hook and its hotkey consumer survive a setup-effect reinstall.
      // Retire the exact open window before cleanup detaches the close callback.
      const closing = cancelledRef.current;
      if (closing) handleCancelledChange(null, { sessionId: closing.sessionId, reason: "flushed" });
      managerInstallationRef.current += 1;
      reportLifecycle("idle");
      // Never leave a global Esc capture behind a reload or a route change.
      if (escHeldRef.current) window.electronAPI?.unregisterCancelHotkey?.();
      escHeldRef.current = false;
      busyRef.current = false;
      outcomeGenerationRef.current += 1;
      unsubscribeSettings();
      disposeToggle?.();
      disposeVoiceAgentToggle?.();
      disposeTranslationToggle?.();
      disposeStart?.();
      disposePrepare?.();
      disposeCancelPreparation?.();
      disposeStop?.();
      disposeForceStopped?.();
      manager.cleanup();
    };
  }, [
    onToggle,
    performStartRecording,
    performStopRecording,
    onDictationError,
    reportLifecycle,
    t,
    trialMode,
  ]);

  const cancelRecording = useCallback(async () => {
    if (audioManagerRef.current) {
      preparationGenerationRef.current += 1;
      setIsPreparing(false);
      setIsStopping(false);
      audioManagerRef.current.cancelPreparedMicCapture?.(pressCandidateRef.current);
      pressCandidateRef.current = null;
      const state = audioManagerRef.current.getState();
      if (getSettings().pauseMediaOnDictation) {
        window.electronAPI?.resumeMediaPlayback?.();
      }
      // A streaming start in its mic-open phase is not yet `isStreaming`;
      // only the streaming cancel knows how to abandon it.
      if (state.isStreaming || state.isStreamingStartInProgress) {
        return await audioManagerRef.current.cancelStreamingRecording();
      }
      return audioManagerRef.current.cancelRecording();
    }
    return false;
  }, []);

  const cancelProcessing = useCallback(() => {
    if (audioManagerRef.current) {
      return audioManagerRef.current.cancelProcessing();
    }
    return false;
  }, []);

  const restore = useCallback(
    async (sessionId, options) => {
      const installation = managerInstallationRef.current;
      const result = (await audioManagerRef.current?.restoreCancelled?.(
        sessionId ?? undefined,
        options
      )) ?? {
        restored: false,
        sessionId: sessionId ?? null,
        reason: "unavailable",
      };
      if (!result.restored && installation === managerInstallationRef.current) {
        const notReady =
          result.reason === "noAudio" && cancelledRef.current?.sessionId === result.sessionId;
        notify({
          id: "undo-failed",
          kind: "alert",
          title: t(notReady ? "notices.undo.notReady" : `notices.undo.${result.reason}`),
        });
      }
      return result;
    },
    [t]
  );
  const undoCancel = useCallback(
    async () => (await restore(cancelledRef.current?.sessionId)).restored,
    [restore]
  );
  const pauseUndo = useCallback(() => audioManagerRef.current?.pauseCancelHold?.(), []);
  const resumeUndo = useCallback(() => audioManagerRef.current?.resumeCancelHold?.(), []);

  useEffect(() => {
    let live = true;
    const offUndo = window.electronAPI?.onUndoCancelRequest?.(
      async ({ token, sessionId, deadlineAt }) => {
        const result = await restore(sessionId, { deadlineAt });
        if (live) window.electronAPI?.replyUndoCancel?.(token, result);
      }
    );
    const offFlush = window.electronAPI?.onDictationFlushRequest?.(({ token }) => {
      Promise.resolve()
        .then(() => audioManagerRef.current?.flushCancelHold?.())
        .catch(() => {})
        .finally(() => {
          if (live) window.electronAPI?.replyDictationFlush?.(token);
        });
    });
    return () => {
      live = false;
      offUndo?.();
      offFlush?.();
    };
  }, [restore]);

  const getAudioLevel = useCallback(
    () => audioManagerRef.current?.getRecordingAudioLevel() ?? null,
    []
  );

  useEffect(() => {
    if (!isRecording) return undefined;

    const reportAudioLevel = () => {
      const level = getAudioLevel();
      if (level === null) return;
      // The onboarding demo's pill draws its waveform from these levels.
      onDemoEventRef.current?.({ kind: demoKindRef.current, status: "level", level });
      // The companion pill only exists while the Agent panel is open — with
      // the panel closed there is nobody to mirror levels to, so skip the
      // IPC. Checked per tick, not once: the panel can open mid-recording and
      // a ref change never re-runs this effect.
      if (!isAssistantVoice && assistantOpenRef?.current) {
        window.electronAPI?.dictationAudioLevelChanged?.(level);
      }
    };
    reportAudioLevel();
    const interval = setInterval(reportAudioLevel, COMPANION_AUDIO_LEVEL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [assistantOpenRef, getAudioLevel, isAssistantVoice, isRecording]);

  const toggleListening = async ({
    voiceAgentRequested = false,
    translationRequested = false,
  } = {}) => {
    if (!isRecording && !isProcessing) {
      await performStartRecording({ voiceAgentRequested, translationRequested });
    } else if (isRecording) {
      await performStopRecording();
    }
  };

  return {
    cancelled,
    undoCancel,
    pauseUndo,
    resumeUndo,
    processingStage,
    outcome,
    isRecording,
    isProcessing,
    isStreaming,
    isAssistantVoice,
    isPreparing,
    isStopping,
    micCaptureStatus,
    transcript,
    partialTranscript,
    startRecording: performStartRecording,
    stopRecording: performStopRecording,
    cancelRecording,
    cancelProcessing,
    toggleListening,
    getAudioLevel,
  };
};
