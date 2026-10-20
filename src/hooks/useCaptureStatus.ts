import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  nextDictationStartedAt,
  resolveCaptureStatus,
  type CaptureStatus,
} from "../lib/captureStatus";
import { stopRecording, useMeetingRecordingStore } from "../stores/meetingRecordingStore";
import type { DictationLifecycleSnapshot } from "../types/electron";

export interface CaptureStatusModel extends CaptureStatus {
  readLevel: () => number;
  toggleDictation: () => Promise<void>;
  stop: () => Promise<void>;
}

export function useCaptureStatus(): CaptureStatusModel {
  const [dictationState, setDictationState] = useState<string | null>(null);
  const [dictationInputKind, setDictationInputKind] = useState<string | null>(null);
  const [dictationStartedAt, setDictationStartedAt] = useState<number | null>(null);
  const [micGranted, setMicGranted] = useState<boolean | null>(null);
  const stateRef = useRef<{
    state: string | null;
    inputKind: string | null;
    startedAt: number | null;
  }>({
    state: null,
    inputKind: null,
    startedAt: null,
  });
  const dictationLevelRef = useRef(0);
  const meeting = useMeetingRecordingStore(
    useShallow((state) => ({
      isRecording: state.isRecording,
      startedAt: state.recordingStartedAt,
      micCaptureStatus: state.micCaptureStatus,
    }))
  );

  useEffect(() => {
    const api = window.electronAPI;
    let alive = true;
    let receivedPush = false;
    const apply = (snapshot: DictationLifecycleSnapshot | null | undefined) => {
      if (!alive || !snapshot) return;
      const startedAt = nextDictationStartedAt(
        stateRef.current.state,
        stateRef.current.startedAt,
        snapshot.state,
        Date.now()
      );
      stateRef.current = {
        state: snapshot.state,
        inputKind: snapshot.inputKind ?? null,
        startedAt,
      };
      if (snapshot.state !== "recording") dictationLevelRef.current = 0;
      setDictationState(snapshot.state);
      setDictationInputKind(snapshot.inputKind ?? null);
      setDictationStartedAt(startedAt);
    };
    const offState = api?.onDictationLifecycleChanged?.((snapshot) => {
      receivedPush = true;
      apply(snapshot);
    });
    const initial = api?.getDictationLifecycleState?.();
    void initial
      ?.then((snapshot) => {
        if (alive && !receivedPush) apply(snapshot);
      })
      .catch(() => {});
    const offLevel = api?.onDictationLevelChanged?.((level) => {
      dictationLevelRef.current = Number.isFinite(level) ? level : 0;
    });
    const checkMic = () => {
      void api
        ?.checkMicrophoneAccess?.()
        .then((result) => {
          if (alive) setMicGranted(result?.granted ?? null);
        })
        .catch(() => {});
    };
    checkMic();
    window.addEventListener("focus", checkMic);
    return () => {
      alive = false;
      offState?.();
      offLevel?.();
      window.removeEventListener("focus", checkMic);
    };
  }, []);

  const status = useMemo(
    () =>
      resolveCaptureStatus({
        dictationState,
        dictationInputKind,
        dictationStartedAt,
        meeting,
        micGranted,
      }),
    [dictationState, dictationInputKind, dictationStartedAt, meeting, micGranted]
  );
  const readLevel = useCallback(() => {
    if (stateRef.current.state === "recording")
      return Number.isFinite(dictationLevelRef.current) ? dictationLevelRef.current : 0;
    return useMeetingRecordingStore.getState().currentMicLevel ?? 0;
  }, []);
  const toggleDictation = useCallback(async () => {
    await window.electronAPI?.toggleDictationFromControlPanel?.();
  }, []);
  const stop = useCallback(async () => {
    const currentMeeting = useMeetingRecordingStore.getState();
    const currentStatus = resolveCaptureStatus({
      dictationState: stateRef.current.state,
      dictationInputKind: stateRef.current.inputKind,
      dictationStartedAt: stateRef.current.startedAt,
      meeting: {
        isRecording: currentMeeting.isRecording,
        startedAt: currentMeeting.recordingStartedAt,
        micCaptureStatus: currentMeeting.micCaptureStatus,
      },
      micGranted,
    });
    if (currentStatus.source === "meeting") {
      await stopRecording();
      return;
    }
    if (currentStatus.source === "dictation" && currentStatus.kind === "listening")
      await toggleDictation();
  }, [micGranted, toggleDictation]);

  return { ...status, readLevel, toggleDictation, stop };
}

/** Wall clock for live timers; the interval exists only while the capture is active. */
export function useLiveClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}
