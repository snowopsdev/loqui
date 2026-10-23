import { useCallback, useEffect, useRef, useState } from "react";

import { useSettings } from "../../hooks/useSettings";
import {
  resolveFileTranscriptionRoute,
  transcribeFile,
  type FileTranscriptionConfig,
} from "../../services/fileTranscription";
import { useSettingsStore } from "../../stores/settingsStore";
import i18n from "../../i18n";
import { analyserRms } from "../../utils/audioLevel";
import { sealedFailureMessage } from "../../utils/sealedModeError";
import { getBaseLanguageCode } from "../../utils/languageSupport";

const translate = (key: string) => i18n.t(key);

export type VoiceDraftStatus = "idle" | "recording" | "transcribing";

interface UseVoiceDraftOptions {
  active?: boolean;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}

/**
 * Records a mic take in the chat input and runs it through the regular
 * transcription pipeline (all providers, no LLM pass). The transcript is
 * handed back for the caller to place into the input.
 */
export function useVoiceDraft({ active = true, onTranscript, onError }: UseVoiceDraftOptions) {
  const settings = useSettings();
  const {
    useLocalWhisper,
    whisperModel,
    localTranscriptionProvider,
    parakeetModel,
    cohereModel,
    cloudTranscriptionMode,
    cloudTranscriptionProvider,
    cloudTranscriptionBaseUrl,
    cloudTranscriptionModel,
    preferredLanguage,
    transcriptionMode,
    remoteTranscriptionUrl,
    remoteTranscriptionModel,
  } = settings;
  const cortiEnvironment = useSettingsStore((s) => s.cortiEnvironment);
  const cortiTenant = useSettingsStore((s) => s.cortiTenant);

  const [status, setStatus] = useState<VoiceDraftStatus>("idle");
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelBufRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false);
  const activityRef = useRef({ active, generation: 0 });
  if (activityRef.current.active !== active) {
    activityRef.current = { active, generation: activityRef.current.generation + 1 };
  }
  const startingRef = useRef(false);
  const isCurrent = useCallback(
    (generation: number) =>
      activityRef.current.active && generation === activityRef.current.generation,
    []
  );

  const buildConfig = (): FileTranscriptionConfig => ({
    useLocalWhisper,
    localTranscriptionProvider: localTranscriptionProvider as string,
    whisperModel,
    parakeetModel,
    cohereModel,
    cloudTranscriptionProvider: cloudTranscriptionProvider as string,
    cloudTranscriptionBaseUrl: cloudTranscriptionBaseUrl || "",
    cloudTranscriptionModel,
    // Empty = auto-detect; the resolver supplies a default where one is required.
    language: getBaseLanguageCode(preferredLanguage) || "",
    cortiEnvironment,
    cortiTenant,
    transcriptionMode,
    remoteTranscriptionUrl,
    remoteTranscriptionModel,
  });

  // The chat mic always takes the batch file path, which a realtime-only
  // provider cannot serve; the caller disables the mic rather than letting a
  // take record straight into that failure.
  const config = buildConfig();
  const route = config.useLocalWhisper ? null : resolveFileTranscriptionRoute(config);
  const streamingOnlyProvider =
    route?.transport === "error" && route.code === "STREAMING_ONLY_PROVIDER";

  // Latest-value refs so the recorder's onstop (bound at start time) uses
  // current settings and callbacks.
  const buildConfigRef = useRef(buildConfig);
  buildConfigRef.current = buildConfig;
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (status !== "recording") return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  const readLevel = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;
    return analyserRms(analyser, levelBufRef);
  }, []);

  const teardownCapture = useCallback(() => {
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    analyserRef.current = null;
    contextRef.current?.close().catch(() => {});
    contextRef.current = null;
  }, []);

  const finishRecording = useCallback(
    async (generation: number) => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      chunksRef.current = [];
      teardownCapture();

      if (!isCurrent(generation) || discardRef.current || blob.size === 0) {
        if (isCurrent(generation)) setStatus("idle");
        return;
      }

      setStatus("transcribing");
      let tempPath: string | null = null;
      try {
        const buffer = await blob.arrayBuffer();
        if (!isCurrent(generation)) return;
        const saved = await window.electronAPI.saveTempAudio(buffer);
        tempPath = saved.path;
        if (!isCurrent(generation)) return;
        const result = await transcribeFile(tempPath, buildConfigRef.current(), false);
        if (!isCurrent(generation)) return;
        const text = result.text?.trim();
        if (!result.success || !text) {
          // A sealed refusal is translated copy, never main's raw text.
          onErrorRef.current(sealedFailureMessage(result, translate) ?? (result.error || ""));
        } else {
          onTranscriptRef.current(text);
        }
      } catch (error) {
        if (isCurrent(generation))
          onErrorRef.current(
            sealedFailureMessage(error, translate) ??
              (error instanceof Error ? error.message : String(error))
          );
      } finally {
        if (tempPath) void window.electronAPI.deleteTempAudio(tempPath);
        if (isCurrent(generation)) setStatus("idle");
      }
    },
    [isCurrent, teardownCapture]
  );

  const start = useCallback(async () => {
    if (!activityRef.current.active || recorderRef.current || startingRef.current) return;
    const generation = activityRef.current.generation;
    startingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isCurrent(generation)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      // Chrome's pull-based renderer only fills the analyser when the graph
      // reaches the destination; route through a muted gain.
      const sink = context.createGain();
      sink.gain.value = 0;
      source.connect(analyser);
      analyser.connect(sink);
      sink.connect(context.destination);

      chunksRef.current = [];
      discardRef.current = false;
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => void finishRecording(generation);
      recorder.start(1000);

      recorderRef.current = recorder;
      streamRef.current = stream;
      contextRef.current = context;
      analyserRef.current = analyser;
      setStatus("recording");
    } catch (error) {
      teardownCapture();
      if (isCurrent(generation))
        onErrorRef.current(error instanceof Error ? error.message : String(error));
    } finally {
      startingRef.current = false;
    }
  }, [finishRecording, isCurrent, teardownCapture]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    activityRef.current.generation += 1;
    discardRef.current = true;
    recorderRef.current?.stop();
    setStatus("idle");
  }, []);

  useEffect(() => {
    if (!active) cancel();
  }, [active, cancel]);

  // Discard silently if the surface unmounts mid-take.
  useEffect(() => {
    activityRef.current.active = active;
    return () => {
      activityRef.current = { active: false, generation: activityRef.current.generation + 1 };
      discardRef.current = true;
      recorderRef.current?.stop();
    };
  }, [active]);

  return { status, elapsed, readLevel, start, stop, cancel, streamingOnlyProvider };
}
