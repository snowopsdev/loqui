import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { requestMeetingRecordingAutoEnd } from "../helpers/meetingRecordingSession";
import {
  getActiveRecordingSessionId,
  getMicAnalyser,
  primeMeetingWorklet,
  stopRecording,
  useMeetingRecordingStore,
} from "../stores/meetingRecordingStore";
import logger from "../utils/logger";
import { createQuietDetector, MEETING_LEVEL_SAMPLE_MS } from "../utils/meetingQuiet";
import { serializeTranscriptSegments } from "../utils/transcriptSpeakerState";
import { notify, dismissNotice } from "./ui/notices";
import { sealedFailureMessage } from "../utils/sealedModeError";

// Survives route remounts so delivered native interruptions are never replayed.
let lastNativeInterruptionNonce: number | null = null;

const EMA_PREV = 0.5;
const EMA_NEXT = 0.5;

// Sentinel errors set by meetingRecordingStore, translated at display time.
// A sentinel may carry one argument after a colon, e.g. `unsupportedProvider:groq`.
// Anything that is not a sentinel reaches the toast unchanged.
const MEETING_ERROR_KEYS: Record<string, string> = {
  policyRestricted: "personal.recordingUnavailable",
  unsupportedSelfHosted: "notes.meeting.unsupportedSelfHosted",
  unsupportedProvider: "notes.meeting.unsupportedProvider",
  noProviderSelected: "notes.meeting.noProviderSelected",
};

export default function MeetingRecordingMount(): null {
  const { t } = useTranslation();
  const isRecording = useMeetingRecordingStore((s) => s.isRecording);
  const isTranscribing = useMeetingRecordingStore((s) => s.isTranscribing);
  const error = useMeetingRecordingStore((s) => s.error);
  const errorNonce = useMeetingRecordingStore((s) => s.errorNonce);
  const systemAudioSilentWarning = useMeetingRecordingStore((s) => s.systemAudioSilentWarning);
  const systemAudioInterrupted = useMeetingRecordingStore((s) => s.systemAudioInterrupted);
  const systemAudioInterruptedNonce = useMeetingRecordingStore(
    (s) => s.systemAudioInterruptedNonce
  );
  const micCaptureStatus = useMeetingRecordingStore((s) => s.micCaptureStatus);
  const recordingStartedAt = useMeetingRecordingStore((s) => s.recordingStartedAt);
  const micQuiet = useMeetingRecordingStore((s) => s.micQuiet);
  const reportedMeetingSession = useRef<string | undefined>(undefined);
  useEffect(() => {
    // Stop clears the active store session before its asynchronous ACKs. Keep
    // false reports (including the later timer reset) bound to that live owner.
    const sessionId = isRecording
      ? (getActiveRecordingSessionId() ?? undefined)
      : reportedMeetingSession.current;
    if (isRecording) reportedMeetingSession.current = sessionId;
    window.electronAPI?.reportMeetingRecordingPresence?.({
      recording: isRecording,
      sessionId,
      startedAt: recordingStartedAt ?? undefined,
      interruption: systemAudioInterrupted
        ? "systemAudio"
        : micCaptureStatus === "unavailable"
          ? "mic"
          : null,
      quiet: micQuiet,
    });
  }, [isRecording, recordingStartedAt, systemAudioInterrupted, micCaptureStatus, micQuiet]);
  useEffect(
    () =>
      window.electronAPI?.onMeetingRecordingStopRequested?.(
        (sessionId) => void stopRecording(sessionId)
      ),
    []
  );
  const wasMicUnavailable = useRef(false);
  const wasSystemAudioSilent = useRef(false);

  useEffect(() => {
    primeMeetingWorklet();
  }, []);

  useEffect(() => {
    const unsubscribeStop = window.electronAPI?.onMeetingAutoEndRequested?.((request) => {
      requestMeetingRecordingAutoEnd(request, stopRecording, (error, sessionId) => {
        logger.error(
          "Meeting auto-end stop failed; recording is still running",
          { error: error instanceof Error ? error.message : String(error), sessionId },
          "meeting"
        );
      });
    });

    return () => {
      unsubscribeStop?.();
    };
  }, []);

  // Crash-safety net moved out of the notes view: it must keep running when
  // the user switches views mid-recording.
  useEffect(() => {
    if (!isTranscribing) return;

    const interval = setInterval(() => {
      const { recordingNoteId, segments } = useMeetingRecordingStore.getState();
      if (!recordingNoteId || segments.length === 0) return;
      window.electronAPI.updateNote(recordingNoteId, {
        transcript: serializeTranscriptSegments(segments),
      });
    }, 30_000);

    return () => clearInterval(interval);
  }, [isTranscribing]);

  useEffect(() => {
    if (!error) return;
    const [sentinel, argument] = error.split(":");
    const errorKey = MEETING_ERROR_KEYS[sentinel];
    // The store keeps a sealed failure as its translated key; a raw string
    // that still carries main's [SEALED_MODE] marker is translated too.
    notify({
      title: t("notes.meeting.title"),
      body: errorKey
        ? t(errorKey, { provider: argument })
        : error.startsWith("sealedMode.")
          ? t(error)
          : (sealedFailureMessage({ error }, t) ?? error),
      kind: "alert",
    });
    // errorNonce re-fires this toast when the same error repeats back-to-back.
  }, [error, errorNonce, t]);

  // The store latches this once per recording; the ref keeps dependency
  // changes (e.g. a language switch recreating `t`) from re-firing the toast.
  useEffect(() => {
    if (!systemAudioSilentWarning) {
      wasSystemAudioSilent.current = false;
      return;
    }
    if (wasSystemAudioSilent.current) return;
    wasSystemAudioSilent.current = true;
    notify({
      title: t("notes.meeting.systemAudioSilent.title"),
      body: t("notes.meeting.systemAudioSilent.description"),
      kind: "notice",
    });
  }, [systemAudioSilentWarning, t]);

  useEffect(() => {
    const deliverInterruption = (): void => {
      const state = useMeetingRecordingStore.getState();
      if (!state.isRecording || !state.systemAudioInterrupted) {
        return;
      }
      if (
        document.visibilityState !== "visible" ||
        !document.hasFocus() ||
        state.systemAudioInterruptedDeliveredNonce === state.systemAudioInterruptedNonce
      )
        return;

      const interruption = state.systemAudioInterrupted;
      let key = "notes.meeting.systemAudioStopped";
      if (interruption.recovering) {
        key = "notes.meeting.systemAudioInterrupted";
      } else if (interruption.reason === "gone_quiet") {
        key = "notes.meeting.systemAudioQuiet";
      }
      const sessionId = getActiveRecordingSessionId();
      notify({
        id: "meeting-interruption",
        kind: "notice",
        persistent: !interruption.recovering,
        title: t(`${key}.title`),
        body: t(`${key}.description`),
        actions:
          key === "notes.meeting.systemAudioStopped" && sessionId
            ? [
                {
                  label: t("notes.editor.stop"),
                  primary: true,
                  onClick: async () => {
                    await stopRecording(sessionId);
                  },
                },
              ]
            : undefined,
      });
      // The provider survives route changes. Keep its warning until the
      // recording stops or a newer interruption supersedes it, even unmounted.
      const unsubscribe = useMeetingRecordingStore.subscribe((next) => {
        if (
          !next.isRecording ||
          !next.systemAudioInterrupted ||
          next.systemAudioInterruptedNonce !== state.systemAudioInterruptedNonce
        ) {
          dismissNotice("meeting-interruption");
          unsubscribe();
        }
      });
      // Keep delivery state outside this component: routes may unmount it
      // while the recording and interruption listener continue running.
      useMeetingRecordingStore.setState({
        systemAudioInterruptedDeliveredNonce: state.systemAudioInterruptedNonce,
      });
    };
    deliverInterruption();
    document.addEventListener("visibilitychange", deliverInterruption);
    window.addEventListener("focus", deliverInterruption);
    return (): void => {
      document.removeEventListener("visibilitychange", deliverInterruption);
      window.removeEventListener("focus", deliverInterruption);
    };
  }, [isRecording, systemAudioInterrupted, systemAudioInterruptedNonce, t]);

  // Native delivery does not wait for focus: a hidden or covered window is
  // exactly when the in-app warning above cannot be seen (D2, VO-Q16).
  useEffect(() => {
    const state = useMeetingRecordingStore.getState();
    const interruption = state.systemAudioInterrupted;
    if (!state.isRecording || !interruption || interruption.recovering) return;
    if (lastNativeInterruptionNonce === state.systemAudioInterruptedNonce) return;
    lastNativeInterruptionNonce = state.systemAudioInterruptedNonce;
    const key =
      interruption.reason === "gone_quiet"
        ? "notes.meeting.systemAudioQuiet"
        : "notes.meeting.systemAudioStopped";
    void window.electronAPI?.showSystemNotification?.({
      title: t(`${key}.title`),
      body: t(`${key}.description`),
    });
  }, [isRecording, systemAudioInterrupted, systemAudioInterruptedNonce, t]);

  useEffect(() => {
    if (micCaptureStatus === "unavailable" && !wasMicUnavailable.current) {
      wasMicUnavailable.current = true;
      notify({
        id: "meeting-mic",
        title: t("hooks.audioRecording.micDisconnected.title"),
        body: t("hooks.audioRecording.micDisconnected.meetingDescription"),
        kind: "notice",
      });
      void window.electronAPI?.showSystemNotification?.({
        title: t("hooks.audioRecording.micDisconnected.title"),
        body: t("hooks.audioRecording.micDisconnected.meetingDescription"),
      });
    } else if (micCaptureStatus === "active" && wasMicUnavailable.current) {
      wasMicUnavailable.current = false;
      notify({
        id: "meeting-mic",
        title: t("hooks.audioRecording.micRestored.title"),
        body: t("hooks.audioRecording.micRestored.description"),
        kind: "receipt",
      });
    } else if (micCaptureStatus === "inactive") {
      wasMicUnavailable.current = false;
    }
  }, [micCaptureStatus, t]);

  useEffect(() => {
    if (!isRecording) return;

    let buf = new Float32Array(256);
    let smoothed = 0;
    let lastWritten = -1;
    let lastQuiet = false;
    let previousAnalyser: AnalyserNode | null = null;
    let isQuiet = createQuietDetector();
    const id = setInterval(() => {
      const analyser =
        useMeetingRecordingStore.getState().micCaptureStatus === "active" ? getMicAnalyser() : null;
      if (analyser !== previousAnalyser || !analyser) {
        // Unknown/recovered input cannot inherit another analyser's silence.
        previousAnalyser = analyser;
        smoothed = 0;
        isQuiet = createQuietDetector();
      }
      let level = 0;
      let quiet = false;
      let measured = false;
      if (analyser) {
        if (buf.length !== analyser.fftSize) buf = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buf);
        let sumSquares = 0;
        for (let i = 0; i < buf.length; i += 1) sumSquares += buf[i] * buf[i];
        const rms = Math.sqrt(sumSquares / buf.length);
        if (Number.isFinite(rms)) {
          measured = true;
          smoothed = EMA_PREV * smoothed + EMA_NEXT * rms;
          level = Math.min(1, Math.max(0, smoothed));
          quiet = isQuiet(level, performance.now());
        } else {
          smoothed = 0;
          isQuiet = createQuietDetector();
        }
      }
      // Meters read the analyser directly. Publish changed fallback/quiet fields
      // atomically so even a quiet transition costs at most one update per tick.
      const levelChanged = measured ? Math.abs(level - lastWritten) > 0.005 : lastWritten !== 0;
      const quietChanged = quiet !== lastQuiet;
      if (levelChanged || quietChanged) {
        useMeetingRecordingStore.setState({
          ...(levelChanged ? { currentMicLevel: level } : {}),
          ...(quietChanged ? { micQuiet: quiet } : {}),
        });
        if (levelChanged) lastWritten = level;
        lastQuiet = quiet;
      }
    }, MEETING_LEVEL_SAMPLE_MS);

    return () => {
      clearInterval(id);
      useMeetingRecordingStore.setState({ currentMicLevel: 0, micQuiet: false });
    };
  }, [isRecording]);

  return null;
}
