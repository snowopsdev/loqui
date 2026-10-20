import { createCapturedTextBridge } from "./capturedTextBridge";
import modelRegistryData from "../models/modelRegistryData.json";
import type {
  CleanupOperationIdentity,
  CleanupRetryResult,
} from "../services/ai/personalInferenceTypes";
import type {
  DictationHotkeyEvent,
  DictationBinding,
  OnboardingDemoEvent,
  OnboardingDemoKind,
  OnboardingDemoAdmissionRequest,
  OnboardingDemoAdmissionReply,
  OnboardingDemoReservation,
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
  requestId: string;
  takeId?: string;
  context?: string;
  id: string;
  kind: OnboardingDemoKind;
}
interface Take {
  demo: Demo;
  origin: "button" | "hotkey";
  binding: DictationBinding | null;
  id: string;
  scenario: OnboardingPreviewConfig["scenario"];
  state: "recording" | "processing";
  timers: Set<unknown>;
}

export function createOnboardingScenarioBridge(
  getConfig: () => OnboardingPreviewConfig,
  clock: ScenarioClock = realClock,
  admission: {
    request?: (
      request: OnboardingDemoAdmissionRequest
    ) => boolean | undefined | Promise<boolean | undefined>;
  } = {}
) {
  const textOperations = createCapturedTextBridge(async (descriptor, sentence) => {
    if (["codex", "tinfoil"].includes(descriptor.provider))
      throw Object.assign(new Error("Unsupported captured authentication source."), {
        code: "UNSUPPORTED_AUTH_SOURCE",
      });
    if (getConfig().scenario === "cleanup-failed")
      throw Object.assign(new Error("Cleanup failed."), { code: "CLEANUP_FAILED" });
    return sentence.includes("um remind me to book the room")
      ? "Remind me to book the room."
      : PREVIEW_SENTENCE;
  });
  const progressListeners = new Set<ProgressListener>();
  const demoListeners = new Set<(event: OnboardingDemoEvent) => void>();
  const hotkeyListeners = new Set<(event: DictationHotkeyEvent) => void>();
  const downloaded = new Set<string>();
  const kept = new Map<string, number>();
  const interrupted = new Set<string>();
  let active: Transfer | null = null;
  let session: Demo | null = null;
  const admissionListeners = new Set<(request: OnboardingDemoAdmissionRequest) => void>();
  const reservationListeners = new Set<(command: OnboardingDemoReservation) => void>();
  let admissionSequence = 0;
  let pendingAdmission: {
    request: OnboardingDemoAdmissionRequest;
    demo: Demo;
    timer: unknown;
    resolve(value: boolean): void;
  } | null = null;
  const reservationEvent = (command: OnboardingDemoReservation) => {
    for (const listener of [...reservationListeners]) listener(command);
  };
  const failAdmission = () => {
    const pending = pendingAdmission;
    if (!pending) return;
    pendingAdmission = null;
    clock.clearTimeout(pending.timer);
    reservationEvent({ ...pending.request, action: "release" });
    pending.resolve(false);
  };
  const replyAdmission = async (reply: OnboardingDemoAdmissionReply) => {
    const pending = pendingAdmission;
    if (
      !pending ||
      pending.request.demoId !== reply.demoId ||
      pending.request.requestId !== reply.requestId
    )
      return false;
    if (
      reply.accepted !== true ||
      clock.now() >= pending.request.deadlineAt ||
      take ||
      cleanupOperation?.pending
    ) {
      failAdmission();
      return false;
    }
    pendingAdmission = null;
    clock.clearTimeout(pending.timer);
    endSession();
    session = pending.demo;
    reservationEvent({ ...pending.request, action: "commit" });
    pending.resolve(true);
    return true;
  };
  let cleanupOperation: {
    identity: CleanupOperationIdentity;
    failed: boolean;
    pending?: (result: CleanupRetryResult) => void;
  } | null = null;
  const retireCleanup = () => {
    const old = cleanupOperation;
    cleanupOperation = null;
    old?.pending?.({ ...old.identity, ok: false, code: "CLEANUP_OPERATION_UNAVAILABLE" });
  };
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
      ...(owner.demo.context ? { context: owner.demo.context } : {}),
      origin: owner.origin,
      ...(owner.binding ? { binding: owner.binding } : {}),
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

  const currentBinding = (): DictationBinding => ({
    hotkey:
      globalThis.localStorage?.getItem("activeDictationKey") ||
      globalThis.localStorage?.getItem("dictationKey") ||
      (isMac() ? "GLOBE" : "Control+Super"),
    activationMode: globalThis.localStorage?.getItem("activationMode") === "push" ? "push" : "tap",
  });
  function startTrial(origin: "button" | "hotkey" = "button") {
    if (!session || session.kind !== "dictation" || take || pendingAdmission) return;
    retireCleanup();
    const owner: Take = {
      demo: session,
      origin,
      binding: origin === "hotkey" ? currentBinding() : null,
      id: String(++takeSequence),
      scenario: scenario(),
      state: "recording",
      timers: new Set(),
    };
    take = owner;
    session.takeId = owner.id;
    emitDemo(owner, { status: "preparing" });
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
        if (failed)
          cleanupOperation = {
            identity: {
              demoId: owner.demo.id,
              takeId: owner.id,
              operationId: `cleanup-${owner.id}`,
            },
            failed,
          };
        emitDemo(owner, {
          ...(cleanupOperation
            ? { cleanupOperationId: cleanupOperation.identity.operationId }
            : {}),
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
    if (session)
      reservationEvent({
        demoId: session.id,
        requestId: session.requestId,
        ...(session.takeId ? { takeId: session.takeId } : {}),
        action: "release",
      });
    retireCleanup();
    if (take) clearTimers(take);
    take = null;
    session = null;
  }
  function simulateHotkey(phase: "down" | "up") {
    const demo = session;
    if (!demo || (demo.kind !== "dictation" && demo.kind !== "shortcut") || accessibilityMissing())
      return;
    for (const listener of [...hotkeyListeners])
      listener({ phase, at: clock.now(), binding: currentBinding() });
    if (session !== demo || demo.kind !== "dictation") return;
    const push = globalThis.localStorage?.getItem("activationMode") === "push";
    if (push) {
      if (phase === "down") startTrial("hotkey");
      else stopTrial();
    } else if (phase === "down") {
      if (take?.state === "recording") stopTrial();
      else startTrial("hotkey");
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
    failAdmission();
    textOperations.reset();
    settleActive("Preview reset");
    downloaded.clear();
    kept.clear();
    interrupted.clear();
    seededConfig = getConfig();
    endSession();
  }

  const api = {
    modelTestLoad: async (_model: string) => ({ success: scenario() === "ready" }),
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
    getDictationBinding: async () => (accessibilityMissing() ? null : currentBinding()),
    // The toolbar supplies both phases for simulated keys. This describes the
    // in-memory simulator, never the desktop's native shortcut capabilities.
    getHotkeyModeInfo: async () => ({
      isUsingGnome: false,
      isUsingKDE: false,
      isUsingNativeShortcut: false,
      isUsingHyprland: false,
      supportsPushToTalk: true,
      pushToTalkUnavailableReason: null,
    }),
    onOnboardingDemoAdmission: subscribe(admissionListeners),
    onOnboardingDemoReservation: subscribe(reservationListeners),
    replyOnboardingDemoAdmission: replyAdmission,
    invalidateOnboardingDemoAdmission: async (identity) => {
      if (
        pendingAdmission?.request.requestId === identity.requestId &&
        pendingAdmission.request.demoId === identity.demoId
      ) {
        failAdmission();
        return true;
      }
      if (session?.id !== identity.demoId || session.requestId !== identity.requestId) return false;
      endSession();
      return true;
    },
    beginOnboardingDemo: async ({
      id,
      kind,
      context,
    }: {
      id: string;
      kind: OnboardingDemoKind;
      context?: string;
    }) => {
      if (
        !id ||
        id.length > 128 ||
        !["dictation", "assistant", "shortcut"].includes(kind) ||
        (context !== undefined && (typeof context !== "string" || context.length > 4096))
      )
        return false;
      failAdmission();
      return new Promise<boolean>((resolve) => {
        const request: OnboardingDemoAdmissionRequest = {
          demoId: id,
          requestId: `preview-admission-${++admissionSequence}`,
          kind,
          deadlineAt: clock.now() + 2000,
        };
        pendingAdmission = {
          request,
          demo: { id, kind, context, requestId: request.requestId },
          resolve,
          timer: clock.setTimeout(() => {
            if (pendingAdmission?.request === request) failAdmission();
          }, 2000),
        };
        for (const listener of [...admissionListeners]) listener(request);
        // The in-memory original owner reserves synchronously before any queued
        // start. A deferred/missing/failed probe is bounded by the same deadline.
        try {
          const answer = admission.request
            ? admission.request(request)
            : !take && !cleanupOperation?.pending;
          void Promise.resolve(answer).then(
            (accepted) => {
              if (accepted !== undefined) return replyAdmission({ ...request, accepted });
            },
            () => {
              if (pendingAdmission?.request === request) failAdmission();
            }
          );
        } catch {
          if (pendingAdmission?.request === request) failAdmission();
        }
      });
    },
    endOnboardingDemo: async (id: string) => {
      if (pendingAdmission?.demo.id === id) failAdmission();
      if (session?.id === id) endSession();
      return true;
    },
    stopOnboardingDemo: async (id: string, takeId?: string | null) => {
      if (session?.id !== id || !takeId || session.takeId !== takeId) return false;
      stopTrial();
      return true;
    },
    toggleOnboardingDemo: async (id: string, takeId?: string | null) => {
      if (
        session?.id !== id ||
        session.kind !== "dictation" ||
        take?.state === "processing" ||
        (session.takeId ? session.takeId !== takeId : takeId != null)
      )
        return false;
      if (take?.state === "recording") stopTrial();
      else startTrial();
      return true;
    },
    cancelOnboardingDemo: async (id: string, takeId?: string | null) => {
      const owner = take;
      if (session?.id !== id || !takeId || session.takeId !== takeId || !owner) return false;
      retireCleanup();
      clearTimers(owner);
      emitDemo(owner, { status: "cancelled" });
      if (take === owner) take = null;
      return true;
    },
    retryOnboardingCleanup: async (
      identity: CleanupOperationIdentity
    ): Promise<CleanupRetryResult> => {
      const owner = cleanupOperation;
      if (
        !owner ||
        session?.id !== identity.demoId ||
        !["demoId", "takeId", "operationId"].every(
          (key) =>
            identity[key as keyof CleanupOperationIdentity] ===
            owner.identity[key as keyof CleanupOperationIdentity]
        )
      )
        return { ...identity, ok: false, code: "CLEANUP_OPERATION_UNAVAILABLE" };
      if (owner.pending) return { ...identity, ok: false, code: "CLEANUP_OPERATION_BUSY" };
      return new Promise((resolve) => {
        owner.pending = resolve;
        clock.setTimeout(() => {
          if (cleanupOperation !== owner) return;
          owner.pending = undefined;
          resolve(
            owner.failed
              ? { ...identity, ok: false, code: "CLEANUP_FAILED" }
              : { ...identity, ok: true, text: PREVIEW_SENTENCE }
          );
        }, PROCESS_MS);
      });
    },
    // Honest pre-Plan04 fallback: no hold or shared CancelledState exists yet.
    undoOnboardingDemoCancel: async (_id: string) => false,
    onOnboardingDemoEvent: subscribe(demoListeners),
    onDictationHotkeyEvent: subscribe(hotkeyListeners),
  } satisfies Pick<
    API,
    | "getSystemProfile"
    | "modelTestLoad"
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
    | "getDictationBinding"
    | "getHotkeyModeInfo"
    | "onOnboardingDemoAdmission"
    | "onOnboardingDemoReservation"
    | "replyOnboardingDemoAdmission"
    | "invalidateOnboardingDemoAdmission"
    | "beginOnboardingDemo"
    | "endOnboardingDemo"
    | "stopOnboardingDemo"
    | "toggleOnboardingDemo"
    | "cancelOnboardingDemo"
    | "retryOnboardingCleanup"
    | "undoOnboardingDemoCancel"
    | "onOnboardingDemoEvent"
    | "onDictationHotkeyEvent"
  >;

  const cleanupChecks = {
    codexStatus: async () => ({
      available: scenario() !== "codex-missing",
      account: scenario() === "ready" ? { type: "chatgpt" } : null,
    }),
    codexModelCatalog: async () => ({
      connected: scenario() === "ready",
      data: scenario() === "ready" ? [{ model: "preview-codex", isDefault: true }] : [],
    }),
    codexModels: async () => ({
      data:
        scenario() === "ready"
          ? [
              {
                id: "preview-codex",
                model: "preview-codex",
                displayName: "ChatGPT",
                isDefault: true,
              },
            ]
          : [],
      nextCursor: null,
    }),
    credentialStatus: async (_ref: string) => ({ configured: scenario() === "ready" }),
  } satisfies Pick<
    API["personalInference"],
    "codexStatus" | "codexModels" | "codexModelCatalog" | "credentialStatus"
  >;
  const cleanupFacts = {
    credentials: async () =>
      ["openai", "codex"].map((id) => ({
        id: id as "openai" | "codex",
        present: scenario() === "ready",
        fields: {},
        generation: 0,
      })),
    models: async (): ReturnType<API["modelGetAll"]> =>
      scenario() === "ready"
        ? modelRegistryData.localProviders.flatMap((provider) =>
            provider.models
              .filter((model) => model.id === "qwen3.5-2b-q4_k_m")
              .map((model) => ({
                ...model,
                isDownloaded: true,
                isDownloading: false,
                downloadProgress: 100,
                downloadedSize: model.sizeBytes,
                totalSize: model.sizeBytes,
                path: null,
              }))
          )
        : [],
  };
  return { api, simulateHotkey, reset, textOperations, cleanupChecks, cleanupFacts };
}
