import type {
  DictationHotkeyEvent,
  OnboardingDemoEvent,
  OnboardingDemoKind,
  SystemFacts,
} from "../types/electron";
import type { OnboardingPreviewConfig } from "../utils/onboardingState";
import {
  DEFAULT_ONBOARDING_SPEECH_MODEL_ID,
  ONBOARDING_SPEECH_MODELS,
} from "../utils/onboardingSpeechModels";

// All outcomes are in-memory fakes of the typed preload contract. No capture,
// provider, persistence, workspace lifecycle relay or Plan04 Undo authority.
export interface ScenarioClock {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}
const realClock: ScenarioClock = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};
export const PREVIEW_SENTENCE = "Remind me to send the draft before lunch.";
export const PREVIEW_RAW_SENTENCE = "um remind me to send the draft before lunch";
const TICK_MS = 400;
const STEP_PERCENT = 7;
const INTERRUPT_AT = 42;
const LEVEL_MS = 80;
const PROCESS_MS = 350;

type API = Window["electronAPI"];
type DownloadResult = Awaited<ReturnType<API["downloadParakeetModel"]>>;
type ProgressListener = Parameters<API["onParakeetDownloadProgress"]>[0];
type ProgressData = Parameters<ProgressListener>[1];
type DemoPayload = Omit<OnboardingDemoEvent, "demoId" | "takeId" | "kind">;
interface Transfer {
  model: string;
  percent: number;
  totalBytes: number;
  sequence: number;
  timer?: unknown;
  interrupted: boolean;
  resolve(result: DownloadResult): void;
}
interface Demo {
  id: string;
  kind: OnboardingDemoKind;
}
interface Take {
  demo: Demo;
  id: string;
  scenario: OnboardingPreviewConfig["scenario"];
  state: "recording" | "processing";
  timers: Set<unknown>;
}

export function createOnboardingScenarioBridge(
  getConfig: () => OnboardingPreviewConfig,
  clock: ScenarioClock = realClock
) {
  const progressListeners = new Set<ProgressListener>();
  const demoListeners = new Set<(event: OnboardingDemoEvent) => void>();
  const hotkeyListeners = new Set<(event: DictationHotkeyEvent) => void>();
  const downloaded = new Set<string>();
  const kept = new Map<string, number>();
  const interrupted = new Set<string>();
  let active: Transfer | null = null;
  let session: Demo | null = null;
  let take: Take | null = null;
  // Like main, event sequence and admitted take IDs never rewind on reset.
  let sequence = 0;
  let takeSequence = 0;
  let seededConfig: OnboardingPreviewConfig | null = null;

  const scenario = () => getConfig().scenario;
  const isMac = () => getConfig().platform === "macos";
  const accessibilityMissing = () => isMac() && scenario() === "accessibility-missing";
  const modelInfo = (id: string) => ONBOARDING_SPEECH_MODELS.find((model) => model.id === id);
  const installed = (id: string) =>
    downloaded.has(id) || (scenario() === "ready" && id === DEFAULT_ONBOARDING_SPEECH_MODEL_ID);
  const subscribe =
    <T>(set: Set<T>) =>
    (listener: T) => {
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    };
  const emitProgress = (data: ProgressData) => {
    for (const listener of [...progressListeners]) listener({}, data);
  };
  const ownsTake = (owner: Take) => take === owner && session === owner.demo;
  const emitDemo = (owner: Take, event: DemoPayload) => {
    if (!ownsTake(owner)) return;
    const payload: OnboardingDemoEvent = {
      demoId: owner.demo.id,
      takeId: owner.id,
      kind: owner.demo.kind,
      ...event,
    };
    for (const listener of [...demoListeners]) listener(payload);
  };
  const clearTimers = (owner: Take) => {
    for (const timer of owner.timers) clock.clearTimeout(timer);
    owner.timers.clear();
  };
  const later = (owner: Take, ms: number, callback: () => void) => {
    const handle = clock.setTimeout(() => {
      owner.timers.delete(handle);
      if (ownsTake(owner)) callback();
    }, ms);
    owner.timers.add(handle);
  };

  function finishTransfer(owner: Transfer, result: DownloadResult, event: ProgressData) {
    if (active !== owner) return;
    clock.clearTimeout(owner.timer);
    active = null;
    // Clear ownership before publishing so reentrant consumers can safely retry.
    owner.resolve(result);
    emitProgress({ ...event, sequence: ++sequence });
  }

  function runDownload(model: string, from = 0): Promise<DownloadResult> {
    const info = modelInfo(model);
    if (!info)
      return Promise.resolve({
        success: false,
        downloaded: false,
        model,
        error: "Unknown model",
        code: "UNKNOWN_MODEL",
        keptBytes: 0,
      });
    if (installed(model)) return Promise.resolve({ success: true, downloaded: true, model });
    // Parakeet is a singleton, including calls outside the UI's selection lock.
    // Refusals neither overwrite the resolver/timer nor publish owner terminals.
    if (active)
      return Promise.resolve({
        success: false,
        downloaded: false,
        model,
        error: "A model is already being downloaded",
        code: "DOWNLOAD_IN_PROGRESS",
        keptBytes: 0,
      });
    return new Promise((resolve) => {
      const owner: Transfer = {
        model,
        percent: from,
        totalBytes: Math.round(info.sizeMb * 1_000_000),
        sequence: ++sequence,
        interrupted: scenario() === "download-interrupted",
        resolve,
      };
      active = owner;
      kept.delete(model);
      const tick = () => {
        if (active !== owner) return;
        const percent = Math.min(100, owner.percent + STEP_PERCENT);
        if (owner.interrupted && !interrupted.has(model) && percent >= INTERRUPT_AT) {
          interrupted.add(model);
          kept.set(model, owner.percent);
          const error = "The connection was reset.";
          const keptBytes = Math.round((owner.totalBytes * owner.percent) / 100);
          finishTransfer(
            owner,
            { success: false, downloaded: false, model, error, code: "ECONNRESET", keptBytes },
            { type: "error", model, error, code: "ECONNRESET", keptBytes }
          );
          return;
        }
        owner.percent = percent;
        owner.sequence = ++sequence;
        emitProgress({
          type: "progress",
          model,
          percentage: percent,
          downloaded_bytes: Math.round((owner.totalBytes * percent) / 100),
          total_bytes: owner.totalBytes,
          sequence: owner.sequence,
        });
        if (active !== owner) return;
        if (percent >= 100) {
          downloaded.add(model);
          finishTransfer(
            owner,
            { success: true, downloaded: true, model },
            { type: "complete", model }
          );
        } else owner.timer = clock.setTimeout(tick, TICK_MS);
      };
      owner.timer = clock.setTimeout(tick, TICK_MS);
    });
  }

  function startTrial() {
    if (!session || session.kind !== "dictation" || take) return;
    const owner: Take = {
      demo: session,
      id: String(++takeSequence),
      scenario: scenario(),
      state: "recording",
      timers: new Set(),
    };
    take = owner;
    // F01: acquisition failure belongs to this admitted take, before listening.
    if (owner.scenario === "microphone-denied") {
      emitDemo(owner, { status: "error", code: "NotAllowedError", message: "Permission denied" });
      if (take === owner) take = null;
      return;
    }
    emitDemo(owner, { status: "listening" });
    const quiet = owner.scenario === "nothing-heard";
    let ticks = 0;
    const level = () => {
      if (!ownsTake(owner) || owner.state !== "recording") return;
      ticks++;
      emitDemo(owner, {
        status: "level",
        level: quiet ? 0.003 : 0.04 + 0.04 * Math.abs(Math.sin(ticks / 2)),
      });
      if (!quiet && ticks === 8) emitDemo(owner, { status: "partial", text: "Remind me to send" });
      if (ownsTake(owner) && owner.state === "recording") later(owner, LEVEL_MS, level);
    };
    if (ownsTake(owner) && owner.state === "recording") later(owner, LEVEL_MS, level);
  }

  function stopTrial() {
    const owner = take;
    if (!owner || owner.state !== "recording") return;
    owner.state = "processing";
    clearTimers(owner);
    emitDemo(owner, { status: "processing" });
    if (!ownsTake(owner)) return;
    later(owner, PROCESS_MS, () => {
      if (owner.scenario === "nothing-heard") {
        emitDemo(owner, { status: "error", code: "NO_AUDIO", message: "No audio detected" });
      } else if (owner.scenario === "insufficient-memory") {
        emitDemo(owner, {
          status: "error",
          code: "INSUFFICIENT_MEMORY",
          message: "Not enough memory to load this model.",
        });
      } else {
        const failed = owner.scenario === "cleanup-failed";
        const text = failed ? PREVIEW_RAW_SENTENCE : PREVIEW_SENTENCE;
        emitDemo(owner, {
          status: "success",
          text,
          rawText: text,
          cleanup: failed ? "failed" : "skipped",
        });
      }
      if (take === owner) take = null;
    });
  }

  function endSession() {
    if (take) clearTimers(take);
    take = null;
    session = null;
  }
  function simulateHotkey(phase: "down" | "up") {
    const demo = session;
    if (!demo || (demo.kind !== "dictation" && demo.kind !== "shortcut") || accessibilityMissing())
      return;
    for (const listener of [...hotkeyListeners]) listener({ phase, at: clock.now() });
    if (session !== demo || demo.kind !== "dictation") return;
    const push = globalThis.localStorage?.getItem("activationMode") === "push";
    if (push) {
      if (phase === "down") startTrial();
      else stopTrial();
    } else if (phase === "down") {
      if (take?.state === "recording") stopTrial();
      else startTrial();
    }
  }
  function settleActive(error: string) {
    const owner = active;
    if (!owner) return;
    kept.delete(owner.model);
    finishTransfer(
      owner,
      {
        success: false,
        downloaded: false,
        model: owner.model,
        error,
        code: "DOWNLOAD_CANCELLED",
        keptBytes: 0,
      },
      { type: "error", model: owner.model, error, code: "DOWNLOAD_CANCELLED", keptBytes: 0 }
    );
  }
  function reset() {
    settleActive("Preview reset");
    downloaded.clear();
    kept.clear();
    interrupted.clear();
    seededConfig = getConfig();
    endSession();
  }

  const api = {
    getSystemProfile: async (): Promise<SystemFacts> => ({
      locales: scenario() === "multilingual" ? ["es-ES", "en-US"] : ["en-US"],
      freeDiskBytes: scenario() === "low-disk" ? 412_000_000 : 212_000_000_000,
      gpu: isMac() ? { kind: "apple-silicon", name: null } : { kind: "unknown", name: null },
    }),
    getTotalMemory: async () =>
      scenario() === "insufficient-memory" ? 4 * 1024 ** 3 : 16 * 1024 ** 3,
    checkParakeetModelStatus: async (model: string): Promise<DownloadResult> => ({
      success: Boolean(modelInfo(model)),
      model,
      downloaded: Boolean(modelInfo(model)) && installed(model),
      isDownloading: active?.model === model,
      ...(active?.model === model
        ? {
            downloadProgress: active.percent,
            downloadedBytes: Math.round((active.totalBytes * active.percent) / 100),
            totalBytes: active.totalBytes,
          }
        : {}),
    }),
    downloadParakeetModel: (model: string) => runDownload(model, kept.get(model) ?? 0),
    cancelParakeetDownload: async () => {
      if (!active) return { success: false };
      settleActive("Download cancelled");
      return { success: true };
    },
    onParakeetDownloadProgress: subscribe(progressListeners),
    modelGetActiveDownloads: async (): Promise<
      Awaited<ReturnType<API["modelGetActiveDownloads"]>>
    > => {
      const config = getConfig();
      if (seededConfig !== config) {
        seededConfig = config;
        if (
          config.scenario === "downloading" &&
          !active &&
          !installed(DEFAULT_ONBOARDING_SPEECH_MODEL_ID)
        ) {
          void runDownload(DEFAULT_ONBOARDING_SPEECH_MODEL_ID, 35);
        }
      }
      return active
        ? [
            {
              modelType: "parakeet",
              modelId: active.model,
              phase: "downloading",
              progress: active.percent,
              downloadedBytes: Math.round((active.totalBytes * active.percent) / 100),
              totalBytes: active.totalBytes,
              sequence: active.sequence,
            },
          ]
        : [];
    },
    checkMicrophoneAccess: async () => {
      const granted = scenario() !== "microphone-denied";
      return { granted, status: granted ? "granted" : "denied" };
    },
    requestMicrophoneAccess: async () => ({ granted: scenario() !== "microphone-denied" }),
    openMicrophoneSettings: async () => ({ success: true }),
    openSoundInputSettings: async () => ({ success: true }),
    checkAccessibilityPermission: async () => !accessibilityMissing(),
    openAccessibilitySettings: async () => ({ success: true }),
    markMacAccessibilityFeaturesReady: () => {},
    beginOnboardingDemo: async ({ id, kind }: { id: string; kind: OnboardingDemoKind }) => {
      endSession();
      session = { id, kind };
      return true;
    },
    endOnboardingDemo: async (id: string) => {
      if (session?.id === id) endSession();
      return true;
    },
    stopOnboardingDemo: async (id: string) => {
      if (session?.id !== id) return false;
      stopTrial();
      return true;
    },
    toggleOnboardingDemo: async (id: string) => {
      if (session?.id !== id || session.kind !== "dictation" || take?.state === "processing")
        return false;
      if (take?.state === "recording") stopTrial();
      else startTrial();
      return true;
    },
    cancelOnboardingDemo: async (id: string) => {
      const owner = take;
      if (session?.id !== id || !owner) return false;
      clearTimers(owner);
      emitDemo(owner, { status: "cancelled" });
      if (take === owner) take = null;
      return true;
    },
    // Honest pre-Plan04 fallback: no hold or shared CancelledState exists yet.
    undoOnboardingDemoCancel: async (_id: string) => false,
    onOnboardingDemoEvent: subscribe(demoListeners),
    onDictationHotkeyEvent: subscribe(hotkeyListeners),
  } satisfies Pick<
    API,
    | "getSystemProfile"
    | "getTotalMemory"
    | "checkParakeetModelStatus"
    | "downloadParakeetModel"
    | "cancelParakeetDownload"
    | "onParakeetDownloadProgress"
    | "modelGetActiveDownloads"
    | "checkMicrophoneAccess"
    | "requestMicrophoneAccess"
    | "openMicrophoneSettings"
    | "openSoundInputSettings"
    | "checkAccessibilityPermission"
    | "openAccessibilitySettings"
    | "markMacAccessibilityFeaturesReady"
    | "beginOnboardingDemo"
    | "endOnboardingDemo"
    | "stopOnboardingDemo"
    | "toggleOnboardingDemo"
    | "cancelOnboardingDemo"
    | "undoOnboardingDemoCancel"
    | "onOnboardingDemoEvent"
    | "onDictationHotkeyEvent"
  >;

  return { api, simulateHotkey, reset };
}
