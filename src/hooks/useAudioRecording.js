import { useMeetingRecordingPresence } from "./useMeetingRecordingPresence";
import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import AudioManager from "../helpers/audioManager";
import logger from "../utils/logger";
import {
  playStartCue,
  playStopCue,
  playSuccessCue,
  playCancelCue,
  playErrorCue,
  playMicBackCue,
} from "../utils/dictationCues";
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
const emptyLiveText = () => ({ committed: "", partial: "", cleaned: null });
const countWords = (text) => (text.trim() ? text.trim().split(/\s+/u).length : 0);

// Presentation holds destinations and enabled intents only: never audio,
// context, tracker, credentials or the rest of the pipeline owner.
const pillSessionPresentation = (session) =>
  session
    ? Object.freeze({
        routes: session.routes ?? null,
        settings: Object.freeze({
          useCleanupModel: session.settings?.useCleanupModel,
          voiceAgentScreenContext: session.settings?.voiceAgentScreenContext,
        }),
        intents: Object.freeze({
          voiceAgentRequested: session.intents?.voiceAgentRequested === true,
          translationRequested: session.intents?.translationRequested === true,
        }),
      })
    : null;

let localRecoveryKey = 0;

export const useAudioRecording = (options = {}) => {
  const meetingRecording = useMeetingRecordingPresence();
  const { t } = useTranslation();
  const [cancelled, setCancelled] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
  // Local UI identity, deliberately separate from the public CancelledState.
  const [cancelHold, setCancelHold] = useState(null);
  const cancelHoldGenerationRef = useRef(0);
  const pillHoveredRef = useRef(options.isPillHovered);
  pillHoveredRef.current = options.isPillHovered;
  const [processingStage, setProcessingStage] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [outcomePresentation, setOutcomePresentation] = useState(null);
  const cancelBufferIdentitiesRef = useRef(new WeakMap());
  const cancelledRef = useRef(null);
  cancelledRef.current = cancelled;
  const escHeldRef = useRef(false);
  const busyRef = useRef(false);
  const outcomeGenerationRef = useRef(0);
  const successCueGenerationRef = useRef(-1);
  const cuedCancellationsRef = useRef(new WeakSet());
  const cancelCueOwnerRef = useRef({});
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
  const [liveText, setLiveText] = useState(emptyLiveText);
  const liveTextSessionRef = useRef(null);
  const audioManagerRef = useRef(null);
  const startLockRef = useRef(false);
  const stopRequestedDuringStartRef = useRef(false);
  const pushForceStoppedRef = useRef(false);
  const stopLockRef = useRef(false);
  const preparationGenerationRef = useRef(0);
  const pressCandidateRef = useRef(null);
  const cuedPressesRef = useRef(new WeakSet());
  const startingCandidateRef = useRef(null);
  const preparedRecordingRef = useRef(null);
  const demoReservationRef = useRef(null);
  const cancelledDemoTakeRef = useRef(null);
  const cancelledPreparationRef = useRef(null);
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
    onDictationError,
    getAssistantSelectionContext,
    onDemoEvent,
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

  const matchesReservation = useCallback((take) => {
    const owner = demoReservationRef.current;
    return !!owner && take?.demoId === owner.demoId && take?.reservationId === owner.requestId;
  }, []);
  const isCancelledTake = useCallback(
    (take) =>
      take &&
      cancelledDemoTakeRef.current?.demoId === take.demoId &&
      cancelledDemoTakeRef.current?.takeId === take.takeId &&
      cancelledDemoTakeRef.current?.reservationId === take.reservationId,
    []
  );
  const mayStart = useCallback(
    (take) => {
      if (!take) return !demoReservationRef.current;
      const cancelledPreparation = cancelledPreparationRef.current;
      const preparationCancelled =
        cancelledPreparation?.demoId === take.demoId &&
        cancelledPreparation?.takeId === take.takeId &&
        cancelledPreparation?.reservationId === take.reservationId;
      return (
        typeof take.takeId === "string" &&
        !!take.takeId &&
        !isCancelledTake(take) &&
        !preparationCancelled &&
        matchesReservation(take) &&
        demoReservationRef.current.committed === true &&
        demoReservationRef.current.kind !== "shortcut"
      );
    },
    [matchesReservation, isCancelledTake]
  );
  const ownsTake = useCallback(
    (take) =>
      !isCancelledTake(take) &&
      matchesReservation(take) &&
      typeof take?.takeId === "string" &&
      !!take.takeId &&
      demoTakeRef.current?.demoId === take.demoId &&
      demoTakeRef.current?.takeId === take.takeId &&
      demoTakeRef.current?.reservationId === take.reservationId,
    [matchesReservation, isCancelledTake]
  );

  const performStartRecording = useCallback(
    async ({ voiceAgentRequested = false, translationRequested = false, onboardingTake } = {}) => {
      if (!mayStart(onboardingTake)) return false;
      const manager = audioManagerRef.current;
      const prepared = preparedRecordingRef.current;
      const sameTake =
        prepared &&
        prepared.manager === manager &&
        prepared.onboardingTake?.demoId === onboardingTake?.demoId &&
        prepared.onboardingTake?.takeId === onboardingTake?.takeId;
      const recording = sameTake
        ? prepared.recording
        : { private: !!onboardingTake || trialModeRef.current === true };
      if (startLockRef.current) return false;
      lastStartOptionsRef.current = { voiceAgentRequested, translationRequested };
      startLockRef.current = true;
      stopRequestedDuringStartRef.current = false;
      pushForceStoppedRef.current = false;
      let recordingStarted = false;
      let candidate = null;
      try {
        if (!manager) return false;

        if (!canStartDictation(manager.getState())) return false;
        if (onboardingTake) {
          const reservation = demoReservationRef.current;
          if (
            manager.hasPendingRecordingWork?.() ||
            (reservation.takes.has(onboardingTake.takeId) &&
              (!sameTake || reservation.startedTake === onboardingTake.takeId))
          )
            return false;
          reservation.takes.add(onboardingTake.takeId);
          reservation.startedTake = onboardingTake.takeId;
        }

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

        manager._recordingPrivate = recording.private === true;
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
            { newPress: true, recording }
          );
        pressCandidateRef.current = candidate;
        startingCandidateRef.current = candidate;
        if (!cuedPressesRef.current.has(candidate)) {
          cuedPressesRef.current.add(candidate);
          void playStartCue();
        }
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
        if (onboardingTake) {
          const ownerCheck = (generation) => () => {
            if (
              audioManagerRef.current !== manager ||
              generation !== preparationGenerationRef.current ||
              !ownsTake(onboardingTake)
            )
              throw Object.assign(new Error("The setup recording owner is no longer current."), {
                code: "DEMO_UNAVAILABLE",
              });
          };
          recording.assertOnboardingOwner = ownerCheck(preparationGeneration);
          // Undo gets a fresh continuation check, never reopens the cancelled
          // start's closure. The manager invokes this only for the captured hold.
          recording.restoreOnboardingOwner = (sessionId) => {
            if (sessionId !== recording.sessionId)
              throw Object.assign(new Error("The held recording changed."), {
                code: "DEMO_UNAVAILABLE",
              });
            const check = ownerCheck(preparationGenerationRef.current);
            check();
            return check;
          };
        }
        setIsStopping(false);
        setIsPreparing(true);
        // Preserve the requested identity while Windows is still opening the
        // microphone; AudioManager confirms the same value once recording.
        setIsAssistantVoice(voiceAgentRequested);
        await waitForVisualFrames();
        if (
          preparationGeneration !== preparationGenerationRef.current ||
          !mayStart(onboardingTake)
        ) {
          audioManagerRef.current.cancelPreparedMicCapture?.(candidate);
          if (pressCandidateRef.current === candidate) pressCandidateRef.current = null;
          return false;
        }

        // Start acquisition only after the compact thinking frame has reached
        // the compositor. startRecording() joins this prepared capture, so the
        // device still opens exactly once.
        void manager.prepareMicCapture?.({ candidate, recording });

        // The floating dictation panel is non-focusable, so the foreground app is
        // still the user's actual editing target here. Refresh it for recordings
        // started from the panel itself as well as from global hotkeys; otherwise
        // paste can reactivate a stale target from the preceding dictation.
        try {
          await window.electronAPI.captureDictationTarget?.();
        } catch (error) {
          logger.warn("Failed to refresh dictation target", { error: error?.message });
        }

        if (preparationGeneration !== preparationGenerationRef.current || !mayStart(onboardingTake))
          return false;
        demoKindRef.current = getOnboardingDemoKind(voiceAgentRequested);
        reportLifecycle("preparing");

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
        const didStart = candidate.intents.streaming
          ? await manager.startStreamingRecording(false, candidate, onboardingTake, recording)
          : await manager.startRecording(false, candidate, onboardingTake, recording);
        // Cancel remains owned by AudioManager. A late mic open from a demo
        // that left during acquisition must release that same recording.
        if (audioManagerRef.current !== manager) return false;
        if (preparationGeneration !== preparationGenerationRef.current) {
          if (didStart) {
            if (manager.getState().isStreaming) await manager.cancelStreamingRecording();
            else manager.cancelRecording();
          }
          return false;
        }
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
    [reportLifecycle, mayStart, ownsTake]
  );

  const performStopRecording = useCallback(
    async (options) => {
      const take = options?.onboardingTake;
      if (
        take
          ? !ownsTake(take)
          : options && Object.hasOwn(options, "onboardingTake") && !!demoReservationRef.current
      )
        return false;
      const generation = preparationGenerationRef.current;
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

        if (generation !== preparationGenerationRef.current || (take && !ownsTake(take)))
          return false;
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
    },
    [ownsTake]
  );

  const cancelRecording = useCallback(async () => {
    if (audioManagerRef.current) {
      preparationGenerationRef.current += 1;
      preparedRecordingRef.current = null;
      setIsPreparing(false);
      setIsStopping(false);
      audioManagerRef.current.cancelPreparedMicCapture?.(pressCandidateRef.current);
      pressCandidateRef.current = null;
      const manager = audioManagerRef.current;
      const installation = managerInstallationRef.current;
      const state = manager.getState();
      if (getSettings().pauseMediaOnDictation) {
        window.electronAPI?.resumeMediaPlayback?.();
      }
      // A streaming start in its mic-open phase is not yet `isStreaming`;
      // only the streaming cancel knows how to abandon it.
      const cancellation =
        state.isStreaming || state.isStreamingStartInProgress
          ? manager.cancelStreamingRecording()
          : manager.cancelRecording();
      // Cancellation may synchronously publish its hold. Fence from that point,
      // so a later recording/Undo cannot inherit a delayed cancellation sound.
      const generation = outcomeGenerationRef.current;
      const owner = cancelCueOwnerRef.current;
      const didCancel = await cancellation;
      if (
        didCancel &&
        managerInstallationRef.current === installation &&
        audioManagerRef.current === manager &&
        outcomeGenerationRef.current === generation &&
        !cuedCancellationsRef.current.has(owner)
      ) {
        cuedCancellationsRef.current.add(owner);
        void playCancelCue();
      }
      return didCancel;
    }
    return false;
  }, []);

  const cancelProcessing = useCallback(() => {
    if (audioManagerRef.current) {
      const manager = audioManagerRef.current;
      const didCancel = manager.cancelProcessing();
      const owner = cancelCueOwnerRef.current;
      if (didCancel && !cuedCancellationsRef.current.has(owner)) {
        cuedCancellationsRef.current.add(owner);
        void playCancelCue();
      }
      return didCancel;
    }
    return false;
  }, []);

  const cancelOnboardingTake = useCallback(
    (take) => {
      if (!ownsTake(take)) return false;
      cancelledDemoTakeRef.current = take;
      const state = audioManagerRef.current?.getState() ?? {};
      if (state.isProcessing && !state.isRecording) return cancelProcessing();
      return cancelRecording();
    },
    [ownsTake, cancelRecording, cancelProcessing]
  );

  useEffect(() => {
    const installation = ++managerInstallationRef.current;
    const manager = new AudioManager();
    audioManagerRef.current = manager;
    cuedPressesRef.current = new WeakSet();
    cuedCancellationsRef.current = new WeakSet();
    cancelCueOwnerRef.current = {};
    wasMicUnavailableRef.current = false;
    liveTextSessionRef.current = null;
    setLiveText(emptyLiveText());
    const ownsInstallation = () =>
      managerInstallationRef.current === installation && audioManagerRef.current === manager;
    manager.setPrivateSession?.(trialModeRef.current);

    // Resolve and pin the input device now, not on the first hotkey press, which
    // would otherwise wait on the device lookup before the mic can open.
    void manager.cacheMicrophoneDeviceId?.();

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
        sessionId = manager.activeSession?.id ?? null,
        outcomeGeneration = outcomeGenerationRef.current,
        presentation = pillSessionPresentation(
          manager.activeSession?.id === sessionId ? manager.activeSession : null
        ),
      },
      extraActions = []
    ) => {
      if (ownsInstallation() && outcomeGeneration === outcomeGenerationRef.current)
        void playErrorCue();
      const recoverAssistant = Boolean(audioManagerRef.current?.voiceAgentRequested);
      if (outcomeGeneration === outcomeGenerationRef.current) {
        const next = { sessionId: sessionId ?? "", kind: "failed", at: Date.now() };
        setOutcome(next);
        setOutcomePresentation({ outcome: next, session: presentation });
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

    let currentCancelBufferIdentity = null;
    const handleCancelledChange = (state, closed, onboardingTake) => {
      if (managerInstallationRef.current !== installation || audioManagerRef.current !== manager)
        return;
      if (!state && !closed) {
        if (onboardingTake)
          onDemoEventRef.current?.({ ...onboardingTake, kind: "dictation", status: "cancelled" });
        return;
      }
      // An old save can close A after the manager has already opened B.
      // It owns neither B's UI nor its lifecycle report or demo publication.
      if (!state && closed && cancelledRef.current?.sessionId !== closed.sessionId) return;
      const held = state ? manager._undo?.peek?.() : null;
      // Weak keys identify replacement buffers without retaining their bytes.
      let bufferIdentity = held ? cancelBufferIdentitiesRef.current.get(held) : null;
      if (held && !bufferIdentity) {
        bufferIdentity = {};
        cancelBufferIdentitiesRef.current.set(held, bufferIdentity);
      }
      const opened =
        state &&
        (!cancelledRef.current ||
          cancelledRef.current.sessionId !== state.sessionId ||
          (bufferIdentity && currentCancelBufferIdentity !== bufferIdentity));
      cancelledRef.current = state;
      setCancelled(state);
      if (opened) {
        outcomeGenerationRef.current += 1;
        setOutcome(null);
        setOutcomePresentation(null);
        currentCancelBufferIdentity = bufferIdentity;
        const session =
          held?.session?.id === state.sessionId
            ? held.session
            : manager.activeSession?.id === state.sessionId
              ? manager.activeSession
              : null;
        setCancelHold({
          generation: ++cancelHoldGenerationRef.current,
          durationMs: state.remainingMs,
          session: pillSessionPresentation(session),
        });
      } else if (!state) setCancelHold(null);
      const am = audioManagerRef.current;
      if (!busyRef.current && !am?.isRecording && !am?.isProcessing) {
        reportLifecycle(state ? "cancelled" : "idle");
      }
      if (state) {
        onDemoEventRef.current?.({
          kind: demoKindRef.current,
          ...onboardingTake,
          status: "cancelled",
          sessionId: state.sessionId,
          cancelled: state,
        });
      } else if (closed) {
        if (closed.reason === "restored") cancelledDemoTakeRef.current = null;
        onDemoEventRef.current?.({
          kind: demoKindRef.current,
          ...onboardingTake,
          status: "cancelClosed",
          sessionId: closed.sessionId,
          reason: closed.reason,
        });
      }
      // A hold can open beneath a pointer already inside the pill, without
      // another mouseenter. The manager's paused publication remains authority.
      if (opened && !state.paused && pillHoveredRef.current?.()) manager.pauseCancelHold?.();
    };

    audioManagerRef.current.setCallbacks({
      onStateChange: (
        { isRecording, isProcessing, isStreaming, micCaptureStatus },
        onboardingTake
      ) => {
        if (!ownsInstallation()) return;
        const session = manager.activeSession ?? null;
        const newRecording =
          isRecording &&
          (!wasRecordingRef.current ||
            !busyRef.current ||
            (session?.id ?? null) !== liveTextSessionRef.current);
        if (newRecording) {
          liveTextSessionRef.current = session?.id ?? null;
          setLiveText(emptyLiveText());
        } else if (isProcessing && session && session.id !== liveTextSessionRef.current) {
          liveTextSessionRef.current = session?.id ?? null;
          setLiveText(emptyLiveText());
        } else if (isProcessing && !busyRef.current) {
          // Undo may resume the same session without entering recording again.
          setLiveText((prev) => ({ ...prev, cleaned: null }));
        }
        // AudioManager settles idle before the asynchronous completion/paste
        // callback finishes. Keep its words through that owning outcome; the
        // next admitted recording/installation resets them. App hides idle text.
        const busy = Boolean(isRecording || isProcessing);
        setActiveSession(busy ? (audioManagerRef.current?.activeSession ?? null) : null);
        if (newRecording || (busy && !busyRef.current)) {
          cancelCueOwnerRef.current = {};
          outcomeGenerationRef.current += 1;
          setOutcome(null);
          setOutcomePresentation(null);
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
            notify({
              id: "mic",
              title: t("hooks.audioRecording.micDisconnected.title"),
              body: t("hooks.audioRecording.micDisconnected.description"),
              kind: "notice",
            });
          } else if (micCaptureStatus === "active" && wasMicUnavailableRef.current) {
            wasMicUnavailableRef.current = false;
            void playMicBackCue();
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
      onProcessingStage: (stage) => {
        if (ownsInstallation()) setProcessingStage(stage);
      },
      onError: (error, onboardingTake, recording) => {
        if (!ownsInstallation()) return;
        const sessionId = audioManagerRef.current?.activeSession?.id ?? null;
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
        manager.releasePrivateAudio?.(recording?.ownedAudio);
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
      onNoAudio: (onboardingTake, recording) => {
        if (!ownsInstallation()) return;
        setIsPreparing(false);
        setIsStopping(false);
        onDemoEventRef.current?.({
          ...onboardingTake,
          kind: demoKindRef.current,
          status: "error",
          message: t("hooks.audioRecording.noAudio.title"),
          code: "NO_AUDIO",
        });
        manager.releasePrivateAudio?.(recording?.ownedAudio);
        window.electronAPI?.hideDictationPreview?.();
        if (getSettings().pauseMediaOnDictation) {
          window.electronAPI?.resumeMediaPlayback?.();
        }
        showDictationError({
          title: t("hooks.audioRecording.noAudio.title"),
          description: t("hooks.audioRecording.noAudio.description"),
        });
      },
      onStreamingCommit: () => {
        if (!ownsInstallation()) return;
        setLiveText({ committed: manager.streamingFinalText ?? "", partial: "", cleaned: null });
      },
      onPartialTranscript: (text, onboardingTake) => {
        if (!ownsInstallation()) return;
        setLiveText({ committed: manager.streamingFinalText ?? "", partial: text, cleaned: null });
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
        if (!ownsInstallation()) return;
        const session = audioManagerRef.current?.activeSession ?? null;
        const sessionId = session?.id ?? null;
        const sessionPrivate = session?.private === true;
        const outcomeGeneration = outcomeGenerationRef.current;
        const presentation = pillSessionPresentation(session);
        // Capture the operation before persistence or paste can yield.
        const retryCleanup = result.cleanupFailure?.retryCleanup;
        const recording = recordingSnapshot ?? {
          private: manager._recordingPrivate ?? trialModeRef.current,
          ownedAudio: manager._ownedAudioSnapshot({ sessionId, private: sessionPrivate }),
          audioMetadata: manager.lastAudioMetadata,
        };
        const privateRecording = recording.private === true;
        if (result.success) {
          dismissNotice(DICTATION_STATUS_NOTICE_ID);
          const transcribedText = result.text?.trim();

          if (!transcribedText) {
            onDemoEventRef.current?.({
              ...onboardingTake,
              kind: demoKindRef.current,
              status: "error",
              code: "NO_AUDIO",
            });
            manager.releasePrivateAudio?.(recording.ownedAudio);
            window.electronAPI?.hideDictationPreview?.();
            showDictationError({
              outcomeGeneration,
              presentation,
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

          setLiveText((prev) => ({
            committed:
              result.rawText ?? (prev.committed || prev.partial ? prev.committed : result.text),
            partial: result.rawText != null ? "" : prev.partial,
            cleaned: result.text,
          }));
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
          const autoPasteEnabled = privateRecording ? false : configuredAutoPaste;
          const keepTranscriptionInClipboard = privateRecording ? false : configuredKeepClipboard;

          const persistencePromise = privateRecording
            ? (manager.releasePrivateAudio?.(recording.ownedAudio), Promise.resolve(true))
            : manager
                .saveTranscription(result.text, result.rawText ?? result.text, {
                  ...(recordingSnapshot ? { recording } : {}),
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
              presentation,
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
                  presentation,
                  sessionId,
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
            if (!pasteSucceeded && !result.selectionEdit?.sessionId) {
              showDictationError({
                outcomeGeneration,
                presentation,
                sessionId,
                title: t("notices.pasteFailed"),
                transcript: result.rawText ?? result.text,
              });
            }
            if (pasteSucceeded) {
              if (ownsInstallation() && outcomeGeneration === outcomeGenerationRef.current) {
                const next = {
                  sessionId: sessionId ?? "",
                  kind: "pasted",
                  words: countWords(result.text),
                  at: Date.now(),
                };
                setOutcome(next);
                if (successCueGenerationRef.current !== outcomeGeneration) {
                  successCueGenerationRef.current = outcomeGeneration;
                  void playSuccessCue();
                }
                setOutcomePresentation({ outcome: next, session: presentation });
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

          if (!privateRecording && manager.shouldUseStreaming()) {
            manager.warmupStreamingConnection();
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
      onboardingTake,
    } = {}) => {
      if (!manager) return;
      if (!mayStart(onboardingTake)) return;
      const currentState = manager.getState();

      // A start still awaiting the mic open leaves isRecording false, so without
      // the lock check this toggle-off would take the start branch and be lost.
      if (startLockRef.current || currentState.isRecording) {
        await performStopRecording({ onboardingTake });
      } else if (canStartDictation(currentState)) {
        await performStartRecording({ voiceAgentRequested, translationRequested, onboardingTake });
      }
    };

    const handleStart = async (options) => {
      await performStartRecording(options);
    };

    const handleStop = async (options) => {
      await performStopRecording(options);
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
      if (!manager || startLockRef.current || !mayStart(options?.onboardingTake)) return;
      if (!canStartDictation(manager.getState())) return;
      if (options?.onboardingTake) {
        const reservation = demoReservationRef.current;
        if (
          manager.hasPendingRecordingWork?.() ||
          reservation.takes.has(options.onboardingTake.takeId)
        )
          return;
        reservation.takes.add(options.onboardingTake.takeId);
      }
      manager._recordingPrivate = !!options?.onboardingTake || trialModeRef.current === true;
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
        {
          newPress: true,
          recording: { private: !!options?.onboardingTake || trialModeRef.current === true },
        }
      );
      pressCandidateRef.current = candidate;
      if (!cuedPressesRef.current.has(candidate)) {
        cuedPressesRef.current.add(candidate);
        void playStartCue();
      }
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
      // Prepared pre-roll belongs to this admission too, even if setup finishes
      // between prepare and start. This extends the existing preparation owner.
      preparedRecordingRef.current = {
        manager,
        onboardingTake: options?.onboardingTake,
        recording: { private: !!options?.onboardingTake || trialModeRef.current === true },
      };
      manager.admitCleanupOperation?.(
        options?.onboardingTake,
        preparedRecordingRef.current.recording,
        !options?.inputKind || options.inputKind === "dictation"
      );
      demoTakeRef.current = options?.onboardingTake ?? null;
      if (options?.onboardingTake)
        preparedRecordingRef.current.recording.assertOnboardingOwner = () => {
          if (
            audioManagerRef.current !== manager ||
            generation !== preparationGenerationRef.current ||
            !ownsTake(options.onboardingTake)
          )
            throw Object.assign(new Error("The setup preparation owner is no longer current."), {
              code: "DEMO_UNAVAILABLE",
            });
        };
      setIsAssistantVoice(voiceAgentRequested);
      setIsPreparing(true);
      // The prepare event precedes the flag-setting start, so the kind must come
      // from the payload — the audioManager flags still describe the PREVIOUS
      // recording at this point.
      reportLifecycle("preparing", options?.inputKind);
      await waitForVisualFrames();
      if (
        generation !== preparationGenerationRef.current ||
        startLockRef.current ||
        !mayStart(options?.onboardingTake)
      )
        return;
      void manager.prepareMicCapture?.({
        candidate,
        recording: preparedRecordingRef.current?.recording,
      });
    });

    const disposeCancelPreparation = window.electronAPI.onCancelDictationPreparation?.(
      (options) => {
        const take = options?.onboardingTake;
        if (take ? !ownsTake(take) : !!demoReservationRef.current) return;
        if (take) {
          if (
            cancelledPreparationRef.current?.demoId === take.demoId &&
            cancelledPreparationRef.current?.takeId === take.takeId &&
            cancelledPreparationRef.current?.reservationId === take.reservationId
          )
            return;
          cancelledPreparationRef.current = take;
        }
        preparationGenerationRef.current += 1;
        preparedRecordingRef.current = null;
        setIsPreparing(false);
        manager?.retireCapturedCleanup?.();
        manager?.cancelPreparedMicCapture?.(pressCandidateRef.current);
        pressCandidateRef.current = null;
        if (reportedLifecycleRef.current?.startsWith("preparing:")) reportLifecycle("idle");
      }
    );

    const admissionBusy = () =>
      startLockRef.current ||
      stopLockRef.current ||
      !!preparedRecordingRef.current ||
      manager.hasPendingRecordingWork?.() ||
      !canStartDictation(manager.getState());
    const releaseReservation = (identity, notify = false) => {
      const owner = demoReservationRef.current;
      if (!owner) return;
      if (owner.requestId !== identity?.requestId || owner.demoId !== identity?.demoId) {
        const previous = owner.previous;
        if (previous?.requestId === identity?.requestId && previous?.demoId === identity?.demoId) {
          clearTimeout(previous.timer);
          owner.previous = null;
          if (notify)
            void window.electronAPI
              .invalidateOnboardingDemoAdmission?.({
                demoId: previous.demoId,
                requestId: previous.requestId,
              })
              ?.catch(() => {});
        }
        return;
      }
      const take = demoTakeRef.current;
      if (owner.committed && ownsTake(take) && identity?.takeId !== take.takeId) return;
      clearTimeout(owner.timer);
      // The exact existing cancel implementation owns microphone, pipeline and
      // cleanup retirement. A demo with no take never cancels an arbitrary owner.
      if (identity?.takeId === take?.takeId && ownsTake(take))
        void Promise.resolve(cancelOnboardingTake(take)).catch(() =>
          logger.warn("Setup recording teardown failed", { code: "DEMO_UNAVAILABLE" })
        );
      demoReservationRef.current = owner.previous ?? null;
      if (notify)
        void window.electronAPI
          .invalidateOnboardingDemoAdmission?.({
            demoId: owner.demoId,
            requestId: owner.requestId,
          })
          ?.catch(() => {});
    };
    const disposeAdmission = window.electronAPI.onOnboardingDemoAdmission?.((request) => {
      const valid =
        request &&
        typeof request.demoId === "string" &&
        !!request.demoId &&
        typeof request.requestId === "string" &&
        !!request.requestId &&
        ["dictation", "assistant", "shortcut"].includes(request.kind) &&
        Number.isFinite(request.deadlineAt) &&
        Date.now() < request.deadlineAt &&
        audioManagerRef.current === manager &&
        typeof window.electronAPI.replyOnboardingDemoAdmission === "function" &&
        typeof window.electronAPI.invalidateOnboardingDemoAdmission === "function" &&
        typeof window.electronAPI.onOnboardingDemoReservation === "function";
      const accepted = !!valid && !admissionBusy() && !demoReservationRef.current?.previous;
      if (accepted) {
        const owner = {
          ...request,
          takes: new Set(),
          startedTake: null,
          committed: false,
          previous: demoReservationRef.current,
        };
        demoReservationRef.current = owner; // before reply: queued normal starts are excluded
        owner.timer = setTimeout(
          () => releaseReservation(owner, true),
          Math.min(2000, request.deadlineAt - Date.now())
        );
      }
      void Promise.resolve()
        .then(() =>
          window.electronAPI.replyOnboardingDemoAdmission?.({
            demoId: request?.demoId,
            requestId: request?.requestId,
            accepted,
          })
        )
        .then(
          (acknowledged) => {
            if (acknowledged !== true && accepted) releaseReservation(request, true);
          },
          () => {
            if (accepted) releaseReservation(request, true);
          }
        );
    });
    const disposeReservation = window.electronAPI.onOnboardingDemoReservation?.((command) => {
      if (command?.action === "release") {
        releaseReservation(command);
        return;
      }
      const owner = demoReservationRef.current;
      if (!owner || owner.demoId !== command?.demoId || owner.requestId !== command?.requestId)
        return;
      if (command.action === "commit" && Date.now() < owner.deadlineAt) {
        clearTimeout(owner.timer);
        owner.committed = true;
        owner.previous = null;
      }
    });

    const disposeCleanupRetry = window.electronAPI.onOnboardingCleanupRetry?.(async (request) => {
      const reply = await manager.retryCapturedCleanup(request);
      await window.electronAPI.replyOnboardingCleanup?.(reply);
    });
    const disposeCleanupRetired = window.electronAPI.onOnboardingCleanupRetired?.((identity) =>
      manager.retireCapturedCleanup(identity)
    );

    const disposeStop = window.electronAPI.onStopDictation?.((options) => {
      handleStop(options);
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
      // Invalidate the existing preparation owner before disposing this manager.
      // A pending mic start will cancel on this same manager when it settles.
      // At most one staged reservation and its prior committed admission.
      for (let i = 0; i < 2 && demoReservationRef.current; i++)
        releaseReservation(
          { ...demoReservationRef.current, takeId: demoTakeRef.current?.takeId },
          true
        );
      disposeAdmission?.();
      disposeReservation?.();
      preparationGenerationRef.current += 1;
      if (preparedRecordingRef.current?.manager === manager) preparedRecordingRef.current = null;
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
      disposeCleanupRetry?.();
      disposeCleanupRetired?.();
      disposeForceStopped?.();
      manager.cleanup();
    };
  }, [
    onToggle,
    performStartRecording,
    performStopRecording,
    onDictationError,
    reportLifecycle,
    mayStart,
    ownsTake,
    cancelOnboardingTake,
    t,
  ]);

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
      onDemoEventRef.current?.({
        ...demoTakeRef.current,
        kind: demoKindRef.current,
        status: "level",
        level,
      });
      // Main mirrors levels to the Agent pill only while its panel is open,
      // and to the control panel capture rail at a lower IPC cadence.
      if (!isAssistantVoice) {
        window.electronAPI?.dictationAudioLevelChanged?.(level);
      }
    };
    reportAudioLevel();
    const interval = setInterval(reportAudioLevel, COMPANION_AUDIO_LEVEL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [getAudioLevel, isAssistantVoice, isRecording]);

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
    meetingRecording,
    activeSession,
    outcomePresentation,
    cancelHold,
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
    liveText,
    startRecording: performStartRecording,
    stopRecording: performStopRecording,
    cancelRecording,
    cancelProcessing,
    cancelOnboardingTake,
    toggleListening,
    getAudioLevel,
  };
};
