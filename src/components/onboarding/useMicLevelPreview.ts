import { useCallback, useEffect, useRef, useState } from "react";
import { analyserRms } from "../../utils/audioLevel";
import { SILENCE_HINT_MS, VOICE_LEVEL_FLOOR } from "../../utils/onboardingTrial";
import { toAudioInputs, type AudioInput } from "../../utils/onboardingMic";

export interface MicLevelPreview {
  status: "off" | "starting" | "live" | "failed";
  deviceLabel: string | null;
  heardVoice: boolean;
  silent: boolean;
  inputs: AudioInput[];
  readLevel(): number;
  retry(): void;
}

const SAMPLE_MS = 80;

/** An analyser only: no recorder, playback, persistence or provider request. */
export function useMicLevelPreview(
  active: boolean,
  deviceId: string | null = null
): MicLevelPreview {
  const levelRef = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const owner = JSON.stringify([active, deviceId, attempt]);
  const [state, setState] = useState<
    Omit<MicLevelPreview, "readLevel" | "retry"> & { owner: string }
  >({
    owner,
    status: "off",
    deviceLabel: null,
    heardVoice: false,
    silent: false,
    inputs: [],
  });

  useEffect(() => {
    levelRef.current = 0;
    if (!active) {
      setState((previous) => ({
        ...previous,
        owner,
        status: "off",
        deviceLabel: null,
        heardVoice: false,
        silent: false,
      }));
      return;
    }
    let cancelled = false;
    let failed = false;
    let heard = false;
    let enumeration = 0;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    const devices = navigator.mediaDevices;
    const owned = () => !cancelled && !failed;
    const listInputs = async () => {
      const request = ++enumeration;
      try {
        const inputs = toAudioInputs(await devices.enumerateDevices());
        if (owned() && request === enumeration) setState((previous) => ({ ...previous, inputs }));
      } catch {
        // Enumeration is advisory. Keep the last list; devicechange can retry it.
      }
    };
    const stopTracks = (acquired: MediaStream) => {
      for (const track of acquired.getTracks()) {
        try {
          track.stop();
        } catch {
          /* Still release the other tracks. */
        }
      }
    };
    const release = () => {
      if (timer !== null) clearInterval(timer);
      if (silenceTimer !== null) clearTimeout(silenceTimer);
      timer = silenceTimer = null;
      devices?.removeEventListener?.("devicechange", listInputs);
      try {
        source?.disconnect();
      } catch {
        /* Partial setup may not be connected. */
      }
      try {
        analyser?.disconnect();
      } catch {
        /* Partial setup may not be connected. */
      }
      if (stream) stopTracks(stream);
      if (context) {
        try {
          void context.close().catch(() => {});
        } catch {
          /* Tracks must still be released. */
        }
      }
      stream = null;
      context = null;
      source = null;
      analyser = null;
      levelRef.current = 0;
    };
    const fail = () => {
      failed = true;
      release();
      if (!cancelled)
        setState((previous) => ({
          ...previous,
          status: "failed",
          deviceLabel: null,
          heardVoice: false,
          silent: false,
        }));
    };
    setState((previous) => ({
      ...previous,
      owner,
      status: "starting",
      deviceLabel: null,
      heardVoice: false,
      silent: false,
    }));
    void (async () => {
      try {
        const acquired = await devices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
        if (cancelled) {
          // The original effect lost ownership while the permission prompt was open (I01).
          stopTracks(acquired);
          return;
        }
        stream = acquired;
        context = new AudioContext();
        analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        source = context.createMediaStreamSource(stream);
        source.connect(analyser);
        const meter = analyser;
        const buffer: { current: Float32Array<ArrayBuffer> | null } = { current: null };
        devices.addEventListener?.("devicechange", listInputs);
        silenceTimer = setTimeout(() => {
          if (owned() && !heard) setState((previous) => ({ ...previous, silent: true }));
        }, SILENCE_HINT_MS);
        timer = setInterval(() => {
          if (!owned()) return;
          try {
            const level = analyserRms(meter, buffer);
            levelRef.current = level;
            if (level > VOICE_LEVEL_FLOOR && !heard) {
              heard = true;
              setState((previous) => ({ ...previous, heardVoice: true, silent: false }));
            }
          } catch {
            fail();
          }
        }, SAMPLE_MS);
        setState((previous) => ({
          ...previous,
          status: "live",
          deviceLabel: acquired.getAudioTracks()[0]?.label || null,
        }));
        void listInputs();
      } catch {
        // A stale failure can release only its own resources and cannot publish.
        fail();
      }
    })();
    return () => {
      cancelled = true;
      release();
    };
  }, [active, deviceId, attempt, owner]);

  const readLevel = useCallback(() => levelRef.current, []);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const { owner: stateOwner, ...preview } = state;
  // Effects reset after render: never present the last device as the new one first.
  return {
    ...preview,
    ...(stateOwner !== owner
      ? {
          status: active ? ("starting" as const) : ("off" as const),
          deviceLabel: null,
          heardVoice: false,
          silent: false,
        }
      : {}),
    readLevel,
    retry,
  };
}
