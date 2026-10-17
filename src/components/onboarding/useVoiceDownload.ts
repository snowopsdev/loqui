import { useCallback, useEffect, useRef, useState } from "react";
import { useModelDownload } from "../../hooks/useModelDownload";
import {
  clampPercent,
  deriveVoiceDownloadState,
  milestoneCrossed,
  pushSample,
  type DownloadMilestone,
  type RateSample,
  type VoiceDownloadState,
} from "../../utils/onboardingDownload";

const AGE_SAMPLE_MS = 1000;

// Every fact is stored with the model it describes; a different selected model
// reads as unknown until its own facts arrive (I04).
interface Keyed<T> {
  modelId: string | null;
  value: T;
}
const forModel = <T>(keyed: Keyed<T>, modelId: string | null, fallback: T): T =>
  keyed.modelId === modelId ? keyed.value : fallback;

export function useVoiceDownload(modelId: string | null): {
  state: VoiceDownloadState;
  milestone: DownloadMilestone | null;
  start(): void;
  cancel(): Promise<void>;
} {
  const modelIdRef = useRef(modelId);
  modelIdRef.current = modelId;
  const [installed, setInstalled] = useState<Keyed<boolean | null>>({ modelId: null, value: null });
  const [selection, setSelection] = useState(modelId);
  const refreshRequest = useRef(0);
  const mounted = useRef(false);
  const progressSequences = useRef<Record<string, number>>({});
  if (selection !== modelId) {
    setSelection(modelId);
    setInstalled({ modelId, value: null });
  }
  const [pendingCancel, setPendingCancel] = useState<Keyed<boolean>>({
    modelId: null,
    value: false,
  });
  const cancelPendingRef = useRef(new Set<string>());
  const [samples, setSamples] = useState<Record<string, RateSample[]>>({});
  const [milestone, setMilestone] = useState<Record<string, DownloadMilestone | null>>({});
  const [keptBytes, setKeptBytes] = useState<Record<string, number | null>>({});
  const [cancelled, setCancelled] = useState<Record<string, boolean>>({});
  const lastPercentRef = useRef<Record<string, number | null>>({});

  const refresh = useCallback(async () => {
    const requested = modelIdRef.current;
    if (!requested || !mounted.current) return;
    const request = ++refreshRequest.current;
    let value = false;
    try {
      value = Boolean(
        (await window.electronAPI?.checkParakeetModelStatus?.(requested))?.downloaded
      );
    } catch {
      value = false;
    }
    if (modelIdRef.current === requested && refreshRequest.current === request) {
      setInstalled({ modelId: requested, value });
    }
  }, []);

  const download = useModelDownload({ modelType: "parakeet", onDownloadComplete: refresh });

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      refreshRequest.current += 1;
    };
  }, [modelId, refresh]);

  // Main attests what it kept (owner decision 3); useModelDownload keeps only the message.
  useEffect(
    () =>
      window.electronAPI?.onParakeetDownloadProgress?.((_event, data) => {
        // Retain facts and sequence watermarks even while another model is selected.
        // Match Plan02's sequence guard: delayed progress cannot erase terminal evidence.
        if (data.sequence !== undefined) {
          if (data.sequence <= (progressSequences.current[data.model] ?? -1)) return;
          progressSequences.current[data.model] = data.sequence;
        }
        if (data.type === "error") {
          setKeptBytes((previous) => ({
            ...previous,
            [data.model]: Number.isFinite(data.keptBytes) ? (data.keptBytes as number) : 0,
          }));
        } else if (data.type === "progress") {
          setKeptBytes((previous) => ({ ...previous, [data.model]: null }));
        }
      }),
    []
  );

  const entry = modelId ? (download.downloads[modelId] ?? null) : null;
  const active = entry !== null;
  const downloadedBytes = entry?.downloadedBytes ?? 0;
  const progress = entry?.progress ?? 0;

  // Progress and ageing samples. Ageing turns a stall into "no estimate".
  useEffect(() => {
    if (!active || !modelId) return;
    const sample = () => {
      setSamples((previous) => ({
        ...previous,
        [modelId]: pushSample(previous[modelId] ?? [], {
          atMs: Date.now(),
          bytes: downloadedBytes,
        }),
      }));
    };
    sample();
    const percent = clampPercent(progress);
    const crossed = milestoneCrossed(lastPercentRef.current[modelId] ?? null, percent);
    lastPercentRef.current[modelId] = percent;
    if (crossed !== null) setMilestone((previous) => ({ ...previous, [modelId]: crossed }));
    const id = setInterval(sample, AGE_SAMPLE_MS);
    return () => clearInterval(id);
  }, [active, downloadedBytes, progress, modelId]);

  const state = deriveVoiceDownloadState({
    installed: modelId ? forModel(installed, modelId, null) : false,
    entry: entry && {
      phase: entry.phase,
      progress: entry.progress,
      downloadedBytes: entry.downloadedBytes,
      totalBytes: entry.totalBytes,
    },
    cancelling:
      forModel(pendingCancel, modelId, false) ||
      (modelId ? download.isCancellingModel(modelId) : false),
    cancelled: modelId ? (cancelled[modelId] ?? false) : false,
    error: modelId ? (download.downloadErrors[modelId] ?? null) : null,
    lastPercent: modelId ? (lastPercentRef.current[modelId] ?? null) : null,
    keptBytes: modelId ? (keptBytes[modelId] ?? null) : null,
    samples: modelId ? (samples[modelId] ?? []) : [],
  });

  const { downloadModel, cancelDownload } = download;
  const start = useCallback(() => {
    const id = modelIdRef.current;
    if (!id || Object.keys(download.downloads).length > 0 || cancelPendingRef.current.has(id))
      return;
    setSamples((previous) => ({ ...previous, [id]: [] }));
    setKeptBytes((previous) => ({ ...previous, [id]: null }));
    setCancelled((previous) => ({ ...previous, [id]: false }));
    setMilestone((previous) => ({ ...previous, [id]: null }));
    lastPercentRef.current[id] = null;
    void downloadModel(id);
  }, [download.downloads, downloadModel]);
  const cancel = useCallback(async () => {
    const id = modelIdRef.current;
    if (!id || !download.downloads[id] || cancelPendingRef.current.has(id)) return;
    cancelPendingRef.current.add(id);
    setPendingCancel({ modelId: id, value: true });
    try {
      // Plan 02 owns cancellation; only its confirmed acknowledgement permits restart.
      if (await cancelDownload(id)) setCancelled((previous) => ({ ...previous, [id]: true }));
    } finally {
      cancelPendingRef.current.delete(id);
      setPendingCancel({ modelId: id, value: false });
    }
  }, [cancelDownload, download.downloads]);

  return { state, milestone: modelId ? (milestone[modelId] ?? null) : null, start, cancel };
}
