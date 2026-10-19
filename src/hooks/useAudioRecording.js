import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import AudioManager from "../helpers/audioManager";
import logger from "../utils/logger";
import { playStartCue, playStopCue } from "../utils/dictationCues";
import { getSettings, useSettingsStore } from "../stores/settingsStore";
import { expandSnippets } from "../utils/snippets";
import { getRecordingErrorTitle, getRecordingErrorDescription } from "../utils/recordingErrors";
import { isAccessibilitySkipped } from "../utils/permissions";

import {
  buildDemoSuccessEvent,
  demoErrorCode,
  getOnboardingDemoKind,
} from "../utils/onboardingDemo";
import {
  buildLiveTranscriptionPreview,
  shouldShowByokStreamingPreview,
} from "../utils/transcriptionPreview";
import { canStartDictation } from "../utils/dictationReadiness";
import { waitForVisualFrames } from "../utils/visualFrame";
import { resolveLifecycleInputKind } from "../helpers/dictationRouting";
import { createAssistantResponseDelivery } from "../helpers/assistantResponseDelivery";
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

export const useAudioRecording = (toast, options = {}) => {
  const { t } = useTranslation();
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
  const preparedRecordingRef = useRef(null);
  const wasRecordingRef = useRef(false);
  const wasMicUnavailableRef = useRef(false);
  const demoKindRef = useRef("dictation");
  const demoTakeRef = useRef(null);
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
    dismissDictationError,
    onDictationError,
    getAssistantSelectionContext,
    onShowTranscript,
    onDemoEvent,
    assistantOpenRef,
    trialMode = false,
  } = options;

  const trialModeRef = useRef(trialMode);
  trialModeRef.current = trialMode;

  useEffect(() => {
    audioManagerRef.current?.setPrivateSession?.(trialMode);
  }, [trialMode]);

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
  const onShowTranscriptRef = useRef(onShowTranscript);
  useEffect(() => {
    onShowTranscriptRef.current = onShowTranscript;
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
    async ({ voiceAgentRequested = false, translationRequested = false, onboardingTake } = {}) => {
      const manager = audioManagerRef.current;
      const prepared = preparedRecordingRef.current;
      const sameTake =
        prepared &&
        prepared.manager === manager &&
        prepared.onboardingTake?.demoId === onboardingTake?.demoId &&
        prepared.onboardingTake?.takeId === onboardingTake?.takeId;
      const recording = sameTake ? prepared.recording : { private: trialModeRef.current === true };
      if (startLockRef.current) return false;
      lastStartOptionsRef.current = { voiceAgentRequested, translationRequested };
      startLockRef.current = true;
      stopRequestedDuringStartRef.current = false;
      pushForceStoppedRef.current = false;
      let recordingStarted = false;
      try {
        if (!manager) return false;

        if (!canStartDictation(manager.getState())) return false;

        preparedRecordingRef.current = null;

        // Capture at admission, before any visual/microphone await. Callback
        // metadata comes from AudioManager's original operation, never this ref.
        manager.admitCleanupOperation?.(
          onboardingTake,
          recording,
          !voiceAgentRequested && !translationRequested
        );
        demoTakeRef.current = onboardingTake ?? null;
        demoKindRef.current = getOnboardingDemoKind(voiceAgentRequested);

        const assistantSelectionContext = voiceAgentRequested
          ? (getAssistantSelectionContextRef.current?.() ?? null)
          : null;

        const preparationGeneration = ++preparationGenerationRef.current;
        setIsStopping(false);
        setIsPreparing(true);
        // Preserve the requested identity while Windows is still opening the
        // microphone; AudioManager confirms the same value once recording.
        setIsAssistantVoice(voiceAgentRequested);
        await waitForVisualFrames();
        if (preparationGeneration !== preparationGenerationRef.current) return false;

        // Start acquisition only after the compact thinking frame has reached
        // the compositor. startRecording() joins this prepared capture, so the
        // device still opens exactly once.
        void manager.prepareMicCapture?.(recording);

        // The floating dictation panel is non-focusable, so the foreground app is
        // still the user's actual editing target here. Refresh it for recordings
        // started from the panel itself as well as from global hotkeys; otherwise
        // paste can reactivate a stale target from the preceding dictation.
        try {
          await window.electronAPI.captureDictationTarget?.();
        } catch (error) {
          logger.warn("Failed to refresh dictation target", { error: error?.message });
        }

        if (preparationGeneration !== preparationGenerationRef.current) return false;
        manager.setVoiceAgentRequested(voiceAgentRequested);
        manager.setAssistantSelectionContext(assistantSelectionContext);
        manager.setTranslationRequested(translationRequested);
        // Covers the toggle path with freshly-set flags; the signature dedup
        // makes this a no-op when the prepare handler already reported the
        // same kind ahead of the flags being set.
        reportLifecycle("preparing");
        if (voiceAgentRequested) {
          logger.info(
            "Voice agent recording start",
            { screenContextEnabled: !!getSettings().voiceAgentScreenContext },
            "reasoning"
          );
        }
        // getSettings() already reflects a managed policy that forces the
        // setting off; the predicate additionally fails closed while the
        // policy is still loading or errored.
        if (voiceAgentRequested && getSettings().voiceAgentScreenContext) {
          manager.beginScreenContextCapture();
        }

        // The selection to edit is whatever was highlighted at press time, so
        // read it now: it resolves while the user speaks instead of adding a
        // round trip after transcription.
        if (voiceAgentRequested && !assistantSelectionContext) {
          manager.beginSelectionCapture();
        }

        // Retry STT config fetch if it wasn't loaded on mount (e.g. auth wasn't ready).
        // Await it only when it can change the start decision (signed-in
        // OpenWhispr-cloud streaming); for local STT or a signed-out session the
        // fetch stalls on auth resolution and would delay the mic open (#1673).

        try {
          manager.assertTrialContext?.(recording);
        } catch (error) {
          manager.onError?.(error, onboardingTake, recording);
          return false;
        }
        const didStart = manager.shouldUseStreaming()
          ? await manager.startStreamingRecording(false, onboardingTake, recording)
          : await manager.startRecording(false, onboardingTake, recording);
        // Cancel remains owned by AudioManager. A late mic open from a demo
        // that left during acquisition must release that same recording.
        if (preparationGeneration !== preparationGenerationRef.current) {
          if (didStart) {
            if (manager.getState().isStreaming) await manager.cancelStreamingRecording();
            else manager.cancelRecording();
          }
          return false;
        }
        recordingStarted = didStart;
        if (didStart) {
          dismissDictationError?.();
          // Arm Esc as soon as a recording exists, including one whose stop
          // landed mid-start: its processing must be cancellable too (D3).
          // onStateChange releases it at idle; a start that is already idle
          // (a tap that ended inside the start call) releases it right here.
          window.electronAPI?.registerCancelHotkey?.("Escape");
          const started = manager.getState();
          if (!started.isRecording && !started.isProcessing) {
            window.electronAPI?.unregisterCancelHotkey?.();
          }
        }

        // A stop that landed while the start was still awaiting the mic open was
        // dropped (isRecording was still false), leaving a runaway recording
        // until the next hotkey press. Honor it now that we started.
        if (didStart && stopRequestedDuringStartRef.current) {
          // Cue semantics mirror performStopRecording: unconditional for
          // streaming, gated on the stop landing for batch.
          if (manager.getState().isStreaming) {
            void playStopCue();
            await manager.stopStreamingRecording();
          } else if (manager.stopRecording()) {
            void playStopCue();
          }
          return didStart;
        }

        // A quick tap can end the recording inside the start call itself (deferred
        // streaming stop) — don't pause media for a recording that already ended. See #1060.
        if (didStart && manager.getState().isRecording) {
          if (getSettings().pauseMediaOnDictation) {
            window.electronAPI?.pauseMediaPlayback?.();
          }
          void playStartCue();
        }

        return didStart;
      } finally {
        startLockRef.current = false;
        // A stop that landed mid-start set isStopping expecting the started
        // recording's state change to clear it; if the recording never began,
        // no state change will ever arrive.
        if (stopRequestedDuringStartRef.current && !recordingStarted) setIsStopping(false);
        stopRequestedDuringStartRef.current = false;
        if (!recordingStarted) {
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
    [dismissDictationError, reportLifecycle]
  );

  const performStopRecording = useCallback(async () => {
    const manager = audioManagerRef.current;
    if (startLockRef.current) {
      stopRequestedDuringStartRef.current = true;
      setIsPreparing(false);
      setIsStopping(true);
      return true;
    }
    if (stopLockRef.current) return false;
    stopLockRef.current = true;
    try {
      if (!manager) return false;

      const currentState = manager.getState();
      if (!currentState.isRecording && !currentState.isStreamingStartInProgress) return false;

      // Esc stays armed through processing; onStateChange releases it at idle.
      setIsPreparing(false);
      setIsStopping(true);
      // Contract to the stable thinking state before MediaRecorder/streaming
      // finalization can occupy the renderer on slower Windows machines.
      await waitForVisualFrames();

      if (currentState.isStreaming || currentState.isStreamingStartInProgress) {
        void playStopCue();
        return await manager.stopStreamingRecording();
      }

      const didStop = manager.stopRecording();

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
    const manager = new AudioManager();
    audioManagerRef.current = manager;
    manager.setPrivateSession?.(trialModeRef.current);

    // Resolve and pin the input device now, not on the first hotkey press, which
    // would otherwise wait on the device lookup before the mic can open.
    void manager.cacheMicrophoneDeviceId?.();

    // Reset stale main-process state after a renderer reload or crash recovery.
    reportLifecycle("idle");

    const getRecoverableTranscript = (fallback = "") =>
      buildLiveTranscriptionPreview(
        manager?.streamingFinalText,
        manager?.streamingPartialText
      ).trim() || fallback.trim();

    const showDictationError = ({ title, description, transcript = "", duration }) => {
      const recoverAssistant = Boolean(manager?.voiceAgentRequested);
      onDictationError?.({ recoverAssistant });
      const recoverableTranscript = getRecoverableTranscript(transcript);
      const actions = [
        {
          label: t("common.retry"),
          icon: "retry",
          dismissOnClick: false,
          onClick: () => performStartRecording(lastStartOptionsRef.current),
        },
      ];

      if (recoverableTranscript) {
        actions.push({
          label: t("hooks.audioRecording.errorActions.viewTranscript"),
          icon: "transcript",
          onClick: () => {
            onShowTranscriptRef.current?.(recoverableTranscript);
          },
        });
      }

      toast({
        title,
        description,
        variant: "destructive",
        presentation: "dictation-error",
        // A card holding the only copy of the user's words stays until they
        // act on it: View transcript, Retry, close, or the next dictation.
        duration: recoverableTranscript ? 0 : duration,
        actions,
      });
    };

    manager.setCallbacks({
      onStateChange: (
        { isRecording, isProcessing, isStreaming, micCaptureStatus },
        onboardingTake
      ) => {
        reportLifecycle(isRecording ? "recording" : isProcessing ? "processing" : "idle");
        if (isRecording) {
          onDemoEventRef.current?.({
            ...onboardingTake,
            kind: demoKindRef.current,
            status: "listening",
          });
        } else if (isProcessing) {
          onDemoEventRef.current?.({
            ...onboardingTake,
            kind: demoKindRef.current,
            status: "processing",
          });
        }
        if (!isRecording && !isProcessing) {
          // Esc is armed from recording start until the whole pipeline is
          // idle, so the keyboard can cancel a slow transcription (D3).
          window.electronAPI?.unregisterCancelHotkey?.();
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
        setIsAssistantVoice(!!manager?.voiceAgentRequested);
        if (micCaptureStatus) {
          setMicCaptureStatus(micCaptureStatus);
          const unavailable = micCaptureStatus === "unavailable";
          if (unavailable && !wasMicUnavailableRef.current) {
            wasMicUnavailableRef.current = true;
            toast({
              title: t("hooks.audioRecording.micDisconnected.title"),
              description: t("hooks.audioRecording.micDisconnected.description"),
              variant: "default",
            });
          } else if (micCaptureStatus === "active" && wasMicUnavailableRef.current) {
            wasMicUnavailableRef.current = false;
            toast({
              title: t("hooks.audioRecording.micRestored.title"),
              description: t("hooks.audioRecording.micRestored.description"),
              variant: "default",
            });
          } else if (micCaptureStatus === "inactive") {
            wasMicUnavailableRef.current = false;
          }
        }
        if (!isStreaming) {
          setPartialTranscript("");
        }
      },
      onError: (error, onboardingTake, recording) => {
        setIsPreparing(false);
        setIsStopping(false);
        if (error?.code === "TRANSCRIPTION_CANCELLED" || error?.code === "REASON_CANCELLED") return;
        onDemoEventRef.current?.({
          ...onboardingTake,
          kind: demoKindRef.current,
          status: "error",
          message: error?.message ?? error?.description,
          code: demoErrorCode(error),
        });
        manager.releasePrivateAudio?.(recording?.audioBlob ?? null);
        if (error?.title !== "Paste Error") {
          window.electronAPI?.hideDictationPreview?.();
        }
        const title = getRecordingErrorTitle(error, t);
        const description = getRecordingErrorDescription(error, t);
        if (error?.variant === "default") {
          // Informational outcomes (SCREEN_CONTEXT_SKIPPED after a successful
          // text-only retry) are notices, not failures: no card, no Retry.
          toast({ title, description, variant: "default" });
        } else {
          showDictationError({
            title,
            description,
            duration: error?.code === "AUTH_EXPIRED" ? 8000 : undefined,
          });
        }
        if (getSettings().pauseMediaOnDictation) {
          window.electronAPI?.resumeMediaPlayback?.();
        }
      },
      onNoAudio: (onboardingTake, recording) => {
        setIsPreparing(false);
        setIsStopping(false);
        onDemoEventRef.current?.({
          ...onboardingTake,
          kind: demoKindRef.current,
          status: "error",
          message: t("hooks.audioRecording.noAudio.title"),
          code: "NO_AUDIO",
        });
        manager.releasePrivateAudio?.(recording?.audioBlob ?? null);
        window.electronAPI?.hideDictationPreview?.();
        if (getSettings().pauseMediaOnDictation) {
          window.electronAPI?.resumeMediaPlayback?.();
        }
        showDictationError({
          title: t("hooks.audioRecording.noAudio.title"),
          description: t("hooks.audioRecording.noAudio.description"),
        });
      },
      onPartialTranscript: (text, onboardingTake) => {
        onDemoEventRef.current?.({
          ...onboardingTake,
          kind: demoKindRef.current,
          status: "partial",
          text,
        });
        setPartialTranscript(text);
        const settings = getSettings();
        if (
          manager?.getStreamingProviderName?.() !== "tinfoil-realtime" &&
          shouldShowByokStreamingPreview(
            settings.showTranscriptionPreview,
            settings.cloudTranscriptionMode,
            !!manager?.voiceAgentRequested
          )
        ) {
          const previewText = buildLiveTranscriptionPreview(manager?.streamingFinalText, text);
          window.electronAPI
            ?.updateDictationPreview?.(previewText)
            .catch((error) =>
              logger.warn("Failed to update transcription preview", { error: error?.message })
            );
        }
      },
      onTranscriptionComplete: async (result, onboardingTake, recordingSnapshot) => {
        const recording = recordingSnapshot ?? {
          private: manager._recordingPrivate ?? trialModeRef.current,
          audioBlob: manager.lastAudioBlob,
          audioMetadata: manager.lastAudioMetadata,
        };
        const privateRecording = recording.private === true;
        if (result.success) {
          dismissDictationError?.();
          const transcribedText = result.text?.trim();

          if (!transcribedText) {
            onDemoEventRef.current?.({
              ...onboardingTake,
              kind: demoKindRef.current,
              status: "error",
              code: "NO_AUDIO",
            });
            manager.releasePrivateAudio?.(recording.audioBlob ?? null);
            window.electronAPI?.hideDictationPreview?.();
            showDictationError({
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
            const { screenContext, transcript, selectedContext, deliverySessionId } =
              result.assistantConversation;
            const command = {
              text: expandSnippets(transcript, getSettings().snippets),
              attachment: screenContext
                ? { image: screenContext.data, mediaType: screenContext.mediaType }
                : null,
            };
            if (privateRecording) {
              // The assistant panel would cover the onboarding flow, so a headless
              // responder answers and streams the reply back as demo events.
              onDemoEventRef.current?.({
                ...onboardingTake,
                kind: demoKindRef.current,
                status: "processing",
                text: command.text,
              });
              onOnboardingAssistantCommandRef.current?.({ ...command, onboardingTake });
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
              ...onboardingTake,
              ...buildDemoSuccessEvent(demoKindRef.current, result),
            });
            window.electronAPI?.completeDictationPreview?.({ text: result.text });
          }

          if (result.warning) {
            toast({
              title: t("hooks.audioRecording.partialTranscription.title"),
              description: t("hooks.audioRecording.partialTranscription.description"),
              variant: "default",
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
          const autoPasteEnabled = privateRecording ? false : configuredAutoPaste;
          const keepTranscriptionInClipboard = privateRecording ? false : configuredKeepClipboard;

          const persistencePromise = privateRecording
            ? (manager.releasePrivateAudio?.(recording.audioBlob ?? null), Promise.resolve(true))
            : manager
                .saveTranscription(result.text, result.rawText ?? result.text, {
                  ...(recordingSnapshot ? { recording } : {}),
                  clientTranscriptionId: result.clientTranscriptionId,
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
              const clipboardResult = await window.electronAPI.writeClipboard(result.text);
              if (clipboardResult?.success === false) {
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
                  title: t("hooks.audioRecording.selectionEditing.notAppliedTitle"),
                  description: t(`hooks.audioRecording.selectionEditing.${detailKey}`),
                  transcript: result.rawText ?? result.text,
                });
              }
            } else {
              pasteSucceeded = await manager.safePaste(result.text, {
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
            if (pasteSucceeded) {
              window.electronAPI?.hideDictationPreview?.();
              if (result.cleanupFailure) recordCleanupFailure(result.cleanupFailure);
            }
          } else if (keepTranscriptionInClipboard && !result.assistantConversation) {
            await keepInClipboard("clipboard-only");
          }

          if (result.source === "openai" && getSettings().useLocalWhisper) {
            toast({
              title: t("hooks.audioRecording.fallback.title"),
              description: t("hooks.audioRecording.fallback.description"),
              variant: "default",
            });
          }

          if (!privateRecording && manager.shouldUseStreaming()) {
            manager.warmupStreamingConnection();
          }

          await persistencePromise;
        }
      },
      onTranslationFallback: ({ reason }) => {
        // Fail-open: the raw text was still pasted; the toast removes the silence.
        toast({
          title:
            reason === "unreachable"
              ? t("hooks.audioRecording.translationFallback.unreachableTitle")
              : t("hooks.audioRecording.translationFallback.failedTitle"),
          description:
            reason === "unreachable"
              ? t("hooks.audioRecording.translationFallback.unreachableDescription")
              : t("hooks.audioRecording.translationFallback.failedDescription"),
          variant: "destructive",
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
      onboardingTake,
    } = {}) => {
      if (!manager) return;
      const currentState = manager.getState();

      // A start still awaiting the mic open leaves isRecording false, so without
      // the lock check this toggle-off would take the start branch and be lost.
      if (startLockRef.current || currentState.isRecording) {
        await performStopRecording();
      } else if (canStartDictation(currentState)) {
        await performStartRecording({ voiceAgentRequested, translationRequested, onboardingTake });
      }
    };

    const handleStart = async (options) => {
      await performStartRecording(options);
    };

    const handleStop = async () => {
      await performStopRecording();
    };

    const disposeToggle = window.electronAPI.onToggleDictation((options) => {
      handleToggle(options);
      onToggle?.();
    });

    const disposeVoiceAgentToggle = window.electronAPI.onToggleVoiceAgent?.((options) => {
      handleToggle({ ...options, voiceAgentRequested: true });
      onToggle?.();
    });

    const disposeTranslationToggle = window.electronAPI.onToggleTranslation?.(() => {
      handleToggle({ translationRequested: true });
      onToggle?.();
    });

    const disposeStart = window.electronAPI.onStartDictation?.((options) => {
      handleStart(options);
      onToggle?.();
    });

    const disposePrepare = window.electronAPI.onPrepareDictation?.(async (options) => {
      if (!manager || startLockRef.current) return;
      if (!canStartDictation(manager.getState())) return;
      const generation = ++preparationGenerationRef.current;
      // Prepared pre-roll belongs to this admission too, even if setup finishes
      // between prepare and start. This extends the existing preparation owner.
      preparedRecordingRef.current = {
        manager,
        onboardingTake: options?.onboardingTake,
        recording: { private: trialModeRef.current === true },
      };
      manager.admitCleanupOperation?.(
        options?.onboardingTake,
        preparedRecordingRef.current.recording,
        !options?.inputKind || options.inputKind === "dictation"
      );
      demoTakeRef.current = options?.onboardingTake ?? null;
      setIsAssistantVoice(false);
      setIsPreparing(true);
      // The prepare event precedes the flag-setting start, so the kind must come
      // from the payload — the audioManager flags still describe the PREVIOUS
      // recording at this point.
      reportLifecycle("preparing", options?.inputKind);
      await waitForVisualFrames();
      if (generation !== preparationGenerationRef.current || startLockRef.current) return;
      void manager.prepareMicCapture?.(preparedRecordingRef.current?.recording);
    });

    const disposeCancelPreparation = window.electronAPI.onCancelDictationPreparation?.(() => {
      preparationGenerationRef.current += 1;
      preparedRecordingRef.current = null;
      setIsPreparing(false);
      manager?.retireCapturedCleanup?.();
      manager?.cancelPreparedMicCapture?.();
      if (reportedLifecycleRef.current?.startsWith("preparing:")) reportLifecycle("idle");
    });

    const disposeCleanupRetry = window.electronAPI.onOnboardingCleanupRetry?.(async (request) => {
      const reply = await manager.retryCapturedCleanup(request);
      await window.electronAPI.replyOnboardingCleanup?.(reply);
    });
    const disposeCleanupRetired = window.electronAPI.onOnboardingCleanupRetired?.((identity) =>
      manager.retireCapturedCleanup(identity)
    );

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
      // Invalidate the existing preparation owner before disposing this manager.
      // A pending mic start will cancel on this same manager when it settles.
      preparationGenerationRef.current += 1;
      if (preparedRecordingRef.current?.manager === manager) preparedRecordingRef.current = null;
      reportLifecycle("idle");
      // Never leave a global Esc capture behind a reload or a route change.
      window.electronAPI?.unregisterCancelHotkey?.();
      unsubscribeSettings();
      disposeToggle?.();
      disposeVoiceAgentToggle?.();
      disposeTranslationToggle?.();
      disposeStart?.();
      disposePrepare?.();
      disposeCancelPreparation?.();
      disposeStop?.();
      disposeCleanupRetry?.();
      disposeCleanupRetired?.();
      disposeForceStopped?.();
      if (manager) {
        manager.releasePrivateAudio?.();
        manager.cleanup();
      }
    };
  }, [
    toast,
    onToggle,
    performStartRecording,
    performStopRecording,
    dismissDictationError,
    onDictationError,
    reportLifecycle,
    t,
  ]);

  const cancelRecording = useCallback(async () => {
    const manager = audioManagerRef.current;
    if (manager) {
      preparationGenerationRef.current += 1;
      preparedRecordingRef.current = null;
      setIsPreparing(false);
      setIsStopping(false);
      manager.cancelPreparedMicCapture?.();
      window.electronAPI?.unregisterCancelHotkey?.();
      const state = manager.getState();
      const take = demoTakeRef.current;
      if (
        state.isRecording ||
        state.isProcessing ||
        state.isStreaming ||
        state.isStreamingStartInProgress ||
        startLockRef.current
      ) {
        // Pre-Plan04 fallback: Discarded, with no invented Undo/CancelledState.
        onDemoEventRef.current?.({ ...take, kind: demoKindRef.current, status: "cancelled" });
      }
      manager.releasePrivateAudio?.();
      if (getSettings().pauseMediaOnDictation) {
        window.electronAPI?.resumeMediaPlayback?.();
      }
      // A streaming start in its mic-open phase is not yet `isStreaming`;
      // only the streaming cancel knows how to abandon it.
      if (state.isStreaming || state.isStreamingStartInProgress) {
        return await manager.cancelStreamingRecording();
      }
      return manager.cancelRecording();
    }
    return false;
  }, []);

  const cancelProcessing = useCallback(() => {
    const manager = audioManagerRef.current;
    if (manager) {
      const state = manager.getState?.() ?? {};
      const take = demoTakeRef.current;
      if (state.isRecording || state.isProcessing || state.isStreaming) {
        onDemoEventRef.current?.({ ...take, kind: demoKindRef.current, status: "cancelled" });
      }
      manager.releasePrivateAudio?.();
      return manager.cancelProcessing();
    }
    return false;
  }, []);

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
      onDemoEventRef.current?.({
        ...demoTakeRef.current,
        kind: demoKindRef.current,
        status: "level",
        level,
      });
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
    onboardingTake,
  } = {}) => {
    if (!isRecording && !isProcessing) {
      await performStartRecording({ voiceAgentRequested, translationRequested, onboardingTake });
    } else if (isRecording) {
      await performStopRecording();
    }
  };

  return {
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
