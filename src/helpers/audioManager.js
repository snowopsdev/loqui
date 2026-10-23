import {
  createCancelBuffer,
  createUndoWindow,
  REPLAY_BATCH_FRAMES,
  REPLAY_PACE_MS,
  FINAL_AUDIO_WAIT_MS,
  CLOSE_SAVE_WAIT_MS,
} from "./cancelBuffer";
import { canStartDictation } from "../utils/dictationReadiness";
import * as sealedStore from "../stores/sealedStore";
import {
  isDictationNativeUnavailable,
  isDictationPausedNative,
  isDictationSealed,
} from "../lib/sealedMode";
import {
  claimRecovery,
  holdForRecovery,
  releaseRecovery,
  shouldHoldInMemory,
} from "../lib/sealedRecovery";
import {
  isSealedModeError,
  sealedDictationMessageKey,
  sealedPhase,
} from "../utils/sealedModeError";
import { createDisclosureTracker } from "./dictationDisclosure";
import {
  captureDictationSession,
  createSessionContext,
  sessionOperation,
  sessionSettings,
  hasUnknownSelectedEnterpriseRecipient,
} from "./dictationSession";
import { trialContext } from "../utils/onboardingTrialContext";
import { createCapturedCleanupOperation } from "../services/capturedCleanupOperation";
import ReasoningService from "../services/ReasoningService";
import logger from "../utils/logger";

import { getBaseLanguageCode, getLanguageLabel } from "../utils/languageSupport";

import {
  applyChineseScript,
  mergeWhisperPrompt,
  resolveChineseScriptTarget,
  resolveCleanupLanguage,
} from "../utils/chineseScript";
import {
  createLocalSpeechGateState,
  getLocalSpeechGateDecision,
  recordLocalSpeechWindow,
} from "./localSpeechGate";
import { reacquireIfDead } from "./micTrackHealth";
import { isMicWarm, WARMUP_ACQUIRE_TIMEOUT_MS } from "./micWarmState";
import {
  PreparedMicCapture,
  disposePreparedCapture,
  discardPreRoll,
  PRE_ROLL_MAX_AGE_MS,
} from "./preparedMicCapture";
import { MicStreamHold } from "./micStreamHold";
import { PcmTap } from "./pcmTap";
import { ActiveMicRecoveryController } from "./activeMicRecovery";
import { followsSystemDefaultMic } from "./micSelectionRecovery";
import { isCacheableMicrophoneResolution, resolvePreferredMicrophone } from "./microphoneSelection";
import { isStaleDeviceError } from "./staleMicDevice";
import { shouldSaveDiscardedRecording } from "./discardedRecording";
import { countSpokenWords, localDateKey, resolveAnalyticsMode } from "./analytics";
import { getSettings, useSettingsStore, selectResolvedLLMConfig } from "../stores/settingsStore";

import {
  getBatchTranscriptionModel,
  getCloudModel,
  getTranscriptionProvider,
  getTranscriptionProviders,
  isOnlineParakeetModel,
  isSherpaLocalProvider,
} from "../models/ModelRegistry";
import {
  resolveByokModel,
  resolveTranscriptionRoute,
  STREAMING_ONLY_PROVIDERS,
} from "./transcriptionRoute.ts";

import { getTranscriptionApiKey } from "../services/fileTranscription";

import {
  isSelfHostedTranscription,
  resolveSelfHostedTranscriptionModel,
} from "./selfHostedTranscription";

import {
  executeTranslationChain,
  hasTextContent,
  shouldRunTranslateStep,
} from "./translationChain";
import { detectAgentName, stripAgentAddress } from "../config/agentDetection";
import {
  resolveDictationRouteKind,
  resolveAgentImageTarget,
  resolveWakeWordLanguage,
} from "./dictationRouting";
import {
  resolveDictationAgentInference,
  resolveDictationAgentVisionInference,
} from "./dictationAgentInference";
import { providerSupportsImages } from "../services/ai/inferenceProviders";
import { resolveDictationTranslationInference } from "./dictationTranslationInference";
import { resolvePrompt, appendScreenContextSuffix } from "../config/prompts";

import { evaluateFinishedRecording, withSalvageWarning } from "./recordingValidation";
import { isEmptyRecording } from "./recordingGuard";
import {
  analyzeDictionaryPromptFragment,
  DICTIONARY_ECHO_CODE,
  dictionaryEchoError,
  matchesDictionaryPrompt,
  payloadSendsDictionaryBias,
} from "../utils/dictionaryEchoFilter.js";

import { dictionaryKeywords, usesTranscriptionKeywords } from "../utils/dictionaryKeywords.js";
import { dictionaryPromptLimit, trimDictionaryPrompt } from "../utils/dictionaryPromptCap.js";

import { getDictionaryHintWords } from "../utils/snippets";
import { normalizeAgentSelectionContext } from "../utils/agentSelectionContext";
import { getAgentName } from "../utils/agentName";
import { shouldDisplayDictationPreview } from "../utils/transcriptionPreview";
import {
  buildSelectionEditSystemPrompt,
  buildSelectionEditUserPrompt,
  extractSelectionEditReplacement,
  getSelectionCaptureDisposition,
} from "./selectionEditing";
import {
  REALTIME_MODELS,
  resolveStreamingProviderName,
  buildStreamingSessionOptions,
} from "./dictationStreamingRouting";

const REASONING_CACHE_TTL = 30000; // 30 seconds
const RECORDING_TIMESLICE_MS = 250; // flush chunks periodically so short recordings still carry audio frames. See #871.
// Failure detector only: fires when the worklet or audio graph is dead and never flushes.
const PREVIEW_FLUSH_WATCHDOG_MS = 1000;
const neverCancelled = () => false;
const MIN_SPARSE_RECORDING_DURATION_SECONDS = 3;
const MIN_UNIQUE_WORD_GAIN = 2;

const cleanupFailureFromError = (error) => ({
  message: error?.message || String(error),
  ...(error?.code ? { code: error.code } : {}),
  ...(error?.messageKey ? { messageKey: error.messageKey } : {}),
  ...(error?.messageParams ? { messageParams: error.messageParams } : {}),
  ...(error?.action ? { action: error.action } : {}),
  ...(error?.actionKey ? { actionKey: error.actionKey } : {}),
  ...(error?.copyCommand ? { copyCommand: error.copyCommand } : {}),
  ...(error?.technicalDetails ? { technicalDetails: error.technicalDetails } : {}),
});

const micDeviceKey = (settings) =>
  `${settings.microphoneSelectionMode}|${settings.selectedMicDeviceId}`;

function getEffectiveRetentionPreferences() {
  const settings = getSettings();
  return {
    dataRetentionEnabled: settings.dataRetentionEnabled,
    audioRetentionDays: settings.audioRetentionDays,
  };
}

// Shared by the agent route and its text-only retry, which needs the prompt
// without the screen-context suffix.
function dictationAgentPrompt(settings, agentName) {
  return resolvePrompt("dictationAgent", {
    agentName,
    language: settings.preferredLanguage,
    customDictionary: getDictionaryHintWords(settings),
    uiLanguage: settings.uiLanguage,
    customPrompts: settings.customPrompts ?? {},
  });
}

function dictationAgentReachable(settings) {
  return resolveDictationAgentInference(settings, { isCloudAgent: false }).reachable;
}

function translationChainReachable(settings) {
  return resolveDictationTranslationInference(settings, {
    isCloudTranslation: false,
  }).reachable;
}

function resolveReasoningRoute(
  text,
  settings,
  agentName,
  voiceAgentRequested,
  translationRequested,
  screenContext,
  detectedLanguage,
  capturedRoutes = null
) {
  const recipientTag = (id) =>
    capturedRoutes?.[id]?.recipient?.status === "ready" ? capturedRoutes[id].recipient.tag : null;
  const wakeWordLanguage = resolveWakeWordLanguage(settings, detectedLanguage, text);
  const cleanup = selectResolvedLLMConfig(settings, "dictationCleanup");
  // Pin cleanup to 0 where supported; bridges otherwise default to 0.7 (local)
  // or 0.3 (Anthropic/enterprise). Zero does not guarantee determinism.
  // Direct Gemini owns its defaults (3: 1.0, older: 0); check mode to ignore stale providers.
  const cleanupTemperature =
    cleanup.mode === "providers" && cleanup.provider === "gemini" ? undefined : 0;
  const cleanupReachable = !!settings.useCleanupModel && !!cleanup.model?.trim();
  const agent = resolveDictationAgentInference(settings, {
    isCloudAgent: false,
  });

  const translation = resolveDictationTranslationInference(settings, {
    isCloudTranslation: false,
  });

  const kind = resolveDictationRouteKind({
    cleanupReachable,
    agentReachable: agent.reachable,
    // A translation recording never routes to the agent, so skip the scan.
    agentInvoked:
      !translationRequested &&
      !!agentName &&
      detectAgentName(text, agentName, wakeWordLanguage, settings.snippets),
    voiceAgentRequested,
    translationRequested,
    translationReachable: translation.reachable,
  });
  logger.logReasoning("ROUTE_RESOLVED", {
    kind,
    voiceAgentRequested,
    agentReachable: agent.reachable,
    agentMode: settings.dictationAgentMode,
    agentProvider: agent.displayProvider,
    agentModel: agent.model,
    hasScreenContext: !!screenContext,
  });
  if (translationRequested && kind !== "translation") {
    logger.warn(
      "Translation requested but unreachable, falling back",
      {
        kind,
        useDictationTranslation: settings.useDictationTranslation,
        hasTarget: !!settings.translationTargetLanguage?.trim(),
      },
      "transcription"
    );
  }
  // Shared by ordinary cleanup and the translation chain's cleanup step.
  // A truncated reply must fail rather than replace the dictation with its first part:
  // the cleanup route pastes the raw transcript and the chain translates it, and both
  // raise the cleanup-failed toast (#2091).
  const cleanupConfig = {
    inferenceScope: /** @type {const} */ ("dictationCleanup"),
    disclosureTask: /** @type {const} */ ("dictationCleanup"),
    disableThinking: settings.cleanupDisableThinking,
    temperature: cleanupTemperature,
    requireCompleteOutput: true,
    provider:
      settings.cleanupMode === "local"
        ? "local"
        : settings.cleanupMode === "self-hosted"
          ? "lan"
          : settings.cleanupProvider,
    baseUrl: settings.cleanupCloudBaseUrl,
    lanUrl: settings.cleanupMode === "self-hosted" ? settings.cleanupRemoteUrl : undefined,
    settingsView: settings,
    enterpriseRecipientTag: recipientTag("dictationCleanup"),
  };
  if (kind === "translation") {
    return {
      kind: "translation",
      model: translation.model,
      cleanupReachable,
      cleanupConfig,
      config: {
        ...translation.config,
        disclosureTask: /** @type {const} */ ("translation"),
        settingsView: settings,
        enterpriseRecipientTag: recipientTag("translation"),
        systemPrompt: resolvePrompt("translate", {
          agentName,
          targetLanguageLabel: getLanguageLabel(settings.translationTargetLanguage),
          customDictionary: getDictionaryHintWords(settings),
          uiLanguage: settings.uiLanguage,
          customPrompts: settings.customPrompts ?? {},
        }),
      },
    };
  }
  if (kind === "agent") {
    const vision = resolveDictationAgentVisionInference(settings, {});
    const { attach, useVisionOverride } = resolveAgentImageTarget({
      hasScreenContext: !!screenContext,
      visionOverrideActive: vision.active,
      visionProviderImageWired: providerSupportsImages(vision.config.provider),
      baseProviderImageWired: providerSupportsImages(agent.config.provider),
      isCloudAgent: false,
      baseModelSupportsVision: !!getCloudModel(agent.model, agent.config.provider)?.supportsVision,
    });
    const target = useVisionOverride ? vision : agent;
    logger.logReasoning("AGENT_IMAGE_TARGET", {
      hasScreenContext: !!screenContext,
      visionOverrideActive: vision.active,
      attach,
      useVisionOverride,
    });

    const systemPrompt = dictationAgentPrompt(settings, agentName);

    return {
      kind: "agent",
      model: target.model,
      config: {
        ...target.config,
        disclosureTask: useVisionOverride
          ? /** @type {const} */ ("assistantVision")
          : /** @type {const} */ ("voiceAssistant"),
        settingsView: settings,
        enterpriseRecipientTag: recipientTag(
          useVisionOverride ? "assistantVision" : "voiceAssistant"
        ),
        systemPrompt: attach
          ? appendScreenContextSuffix(systemPrompt, settings.uiLanguage)
          : systemPrompt,
        ...(attach ? { screenContext, textOnlySystemPrompt: systemPrompt } : {}),
        // Selection edits run on this (dictation) scope, so they need it
        // reachable; standalone commands resolve the same scope again in the
        // panel and report their own configuration problems in-conversation.
        selectionEditReachable: agent.reachable,
        // Detection and stripping must read the transcript identically, so both
        // inputs ride the route rather than being re-read after the await.
        wakeWordLanguage,
        snippets: settings.snippets,
        // The panel re-decides attach/drop for its own request, so carry the
        // raw screenshot past this attach gate for that path.
        ...(screenContext ? { rawScreenContext: screenContext } : {}),
      },
    };
  }
  if (kind === "cleanup") {
    return { kind: "cleanup", config: cleanupConfig };
  }
  return { kind: "skip" };
}

// Realtime providers expose no finalize handshake (unlike Deepgram/AssemblyAI/
// Corti), so the transcript tail lands whenever it lands — wait, don't sleep.
const STREAMING_FINAL_QUIET_MS = 250;
const STREAMING_FINAL_CEILING_MS = 2000;

// Both realtime providers share the dictation realtime IPC surface and differ
// only in the token-provider id. Forcing `provider` here (even though
// buildStreamingSessionOptions already stamps it) is pinned by
// audioManagerStreamingRouting.test.js: the hardened main-process allowlist
// fails closed on an options object that lost the tag (#1624).
const makeDictationRealtimeProvider = (id) => ({
  awaitsFinalTranscript: true,
  warmup: (opts) => window.electronAPI.dictationRealtimeWarmup({ ...opts, provider: id }),
  start: (opts) => window.electronAPI.dictationRealtimeStart({ ...opts, provider: id }),
  send: (buf, operation) => window.electronAPI.dictationRealtimeSend(buf, operation),
  stop: (operation) => window.electronAPI.dictationRealtimeStop(operation),
  cancel: (operation) => window.electronAPI.dictationRealtimeCancel?.(operation),
  onPartial: (cb) => window.electronAPI.onDictationRealtimePartial(cb),
  onFinal: (cb) => window.electronAPI.onDictationRealtimeFinal(cb),
  onError: (cb) => window.electronAPI.onDictationRealtimeError(cb),
  onSessionEnd: (cb) => window.electronAPI.onDictationRealtimeSessionEnd(cb),
});

const STREAMING_PROVIDERS = {
  deepgram: {
    warmup: (opts) => window.electronAPI.deepgramStreamingWarmup(opts),
    start: (opts) => window.electronAPI.deepgramStreamingStart(opts),
    send: (buf, operation) => window.electronAPI.deepgramStreamingSend(buf, operation),
    finalize: (operation) => window.electronAPI.deepgramStreamingFinalize(operation),
    stop: (operation) => window.electronAPI.deepgramStreamingStop(operation),
    cancel: (operation) => window.electronAPI.deepgramStreamingCancel?.(operation),
    status: () => window.electronAPI.deepgramStreamingStatus(),
    onPartial: (cb) => window.electronAPI.onDeepgramPartialTranscript(cb),
    onFinal: (cb) => window.electronAPI.onDeepgramFinalTranscript(cb),
    onError: (cb) => window.electronAPI.onDeepgramError(cb),
    onSessionEnd: (cb) => window.electronAPI.onDeepgramSessionEnd(cb),
  },
  assemblyai: {
    warmup: (opts) => window.electronAPI.assemblyAiStreamingWarmup(opts),
    start: (opts) => window.electronAPI.assemblyAiStreamingStart(opts),
    send: (buf, operation) => window.electronAPI.assemblyAiStreamingSend(buf, operation),
    finalize: (operation) => window.electronAPI.assemblyAiStreamingForceEndpoint(operation),
    stop: (operation) => window.electronAPI.assemblyAiStreamingStop(operation),
    cancel: (operation) => window.electronAPI.assemblyAiStreamingCancel?.(operation),
    status: () => window.electronAPI.assemblyAiStreamingStatus(),
    onPartial: (cb) => window.electronAPI.onAssemblyAiPartialTranscript(cb),
    onFinal: (cb) => window.electronAPI.onAssemblyAiFinalTranscript(cb),
    onError: (cb) => window.electronAPI.onAssemblyAiError(cb),
    onSessionEnd: (cb) => window.electronAPI.onAssemblyAiSessionEnd(cb),
  },
  "openai-realtime": makeDictationRealtimeProvider("openai-realtime"),
  gemini: {
    // The final transcript lands ~500ms after audioStreamEnd (which finalize
    // sends), ~2s at the p95 tail, so the stop sequence waits for it under a
    // wider ceiling. geminiLiveStreaming.js measures the same 3s budget from
    // audioStreamEnd before its own disconnect gives up.
    awaitsFinalTranscript: true,
    finalCeilingMs: 3000,
    warmup: (opts) => window.electronAPI.geminiStreamingWarmup(opts),
    start: (opts) => window.electronAPI.geminiStreamingStart(opts),
    send: (buf, operation) => window.electronAPI.geminiStreamingSend(buf, operation),
    finalize: (operation) => window.electronAPI.geminiStreamingFinalize(operation),
    stop: (operation) => window.electronAPI.geminiStreamingStop(operation),
    cancel: (operation) => window.electronAPI.geminiStreamingCancel?.(operation),
    status: () => window.electronAPI.geminiStreamingStatus(),
    onPartial: (cb) => window.electronAPI.onGeminiPartialTranscript(cb),
    onFinal: (cb) => window.electronAPI.onGeminiFinalTranscript(cb),
    onError: (cb) => window.electronAPI.onGeminiError(cb),
    onSessionEnd: (cb) => window.electronAPI.onGeminiSessionEnd(cb),
  },
  corti: {
    warmup: (opts) => window.electronAPI.cortiStreamingWarmup(opts),
    start: (opts) => window.electronAPI.cortiStreamingStart(opts),
    send: (buf, operation) => window.electronAPI.cortiStreamingSend(buf, operation),
    finalize: (operation) => window.electronAPI.cortiStreamingFinalize(operation),
    stop: (operation) => window.electronAPI.cortiStreamingStop(operation),
    cancel: (operation) => window.electronAPI.cortiStreamingCancel?.(operation),
    status: () => window.electronAPI.cortiStreamingStatus(),
    onPartial: (cb) => window.electronAPI.onCortiPartialTranscript(cb),
    onFinal: (cb) => window.electronAPI.onCortiFinalTranscript(cb),
    onError: (cb) => window.electronAPI.onCortiError(cb),
    onSessionEnd: (cb) => window.electronAPI.onCortiSessionEnd(cb),
  },
  "tinfoil-realtime": makeDictationRealtimeProvider("tinfoil-realtime"),
};

// Batch providers that must transcribe via a main-process proxy (CORS,
// non-Bearer auth, OAuth, or attested transport) instead of a renderer fetch.
function audioExtensionForMime(mimeType) {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

class AudioManager {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.isProcessing = false;
    this.onStateChange = null;
    this.onError = null;
    this.onTranscriptionComplete = null;
    this.onPartialTranscript = null;
    this.micCaptureStatus = "inactive";
    this._micWarmedAt = 0;
    this._startInProgress = false;
    this._micOpenReported = false;
    this.preparedMicCapture = new PreparedMicCapture({
      dispose: (prepared) => this._disposePrepared(prepared),
      onActiveChange: () => this._syncMicOpenGate(),
    });
    const micSettings = getSettings();
    this._micHoldSeconds = Number(micSettings.micWarmHoldSeconds) || 0;
    this._micDeviceKey = micDeviceKey(micSettings);
    this.micStreamHold = new MicStreamHold({
      holdSeconds: this._micHoldSeconds,
      onHoldChange: () => this._syncMicOpenGate(),
      isBusy: () =>
        this.isRecording ||
        this.isStreaming ||
        this.mediaRecorder?.state === "recording" ||
        this.preparedMicCapture.active,
    });

    // Every window owns an AudioManager (dictation and the agent overlay), so
    // the hold has to follow the setting here rather than in one window's hook.
    this._unsubscribeSettings = useSettingsStore.subscribe((state) => {
      const holdSeconds = Number(state.micWarmHoldSeconds) || 0;
      if (holdSeconds !== this._micHoldSeconds) {
        this._micHoldSeconds = holdSeconds;
        this.micStreamHold.setHoldSeconds(holdSeconds);
      }
      const deviceKey = micDeviceKey(state);
      if (deviceKey !== this._micDeviceKey) {
        this._micDeviceKey = deviceKey;
        this.cachedMicDeviceId = null;
        this.rejectedMicDeviceId = null;
        this._micWarmedAt = 0;
        this.cancelPreparedMicCapture();
        this.micStreamHold.drop();
      }
    });

    // Invalidate the pinned mic device when the OS adds/removes/suspends inputs.
    // Otherwise wake-after-idle keeps requesting a stale deviceId that yields silence.
    this._onDeviceChange = () => {
      this.cachedMicDeviceId = null;
      this._micWarmedAt = 0;
      this.rejectedMicDeviceId = null;
      this.cancelPreparedMicCapture();
      this.micStreamHold.drop();
      // The main process keeps the OS default mic until told it changed, so
      // re-resolve now rather than on the next hotkey press (~2s on Windows).
      window.electronAPI?.getSystemDefaultMicrophone?.({ refresh: true })?.catch(() => {});
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", this._onDeviceChange);
    this.recordingStartTime = null;
    this.reasoningAvailabilityCache = { value: false, expiresAt: 0 };
    this.cachedReasoningPreference = null;
    this.isStreaming = false;
    this.streamingAudioContext = null;
    this.streamingSource = null;
    this.streamingAnalyser = null;
    this.streamingProcessor = null;
    this.streamingStream = null;
    this.streamingCleanupFns = [];
    this.streamingFinalText = "";
    this.streamingPartialText = "";
    this.streamingTextBump = null;
    this.streamingTextDebounce = null;
    this.cachedMicDeviceId = null;
    this.rejectedMicDeviceId = null;
    this.persistentAudioContext = null;
    this.workletModuleLoaded = false;
    this.workletBlobUrl = null;
    this.streamingStartInProgress = false;
    this._streamingStartSettlementWaiters = [];
    this.stopRequestedDuringStreamingStart = false;
    this._streamingStopPromise = null;
    this._streamingStopMode = null;
    this._streamingSessionGeneration = 0;
    this._streamingCancellationGeneration = 0;
    this._activeTranscriptionAbortController = null;
    this._activeStreamingSessionId = null;
    this.streamingFallbackRecorder = null;
    this.streamingFallbackChunks = [];
    this.voiceAgentRequested = false;
    this.translationRequested = false;
    this.translationApplied = false;
    this.pendingSelectionEdit = null;
    this.pendingAssistantConversation = null;
    this.pendingCleanupFailure = null;
    this._processingCancellationGeneration = 0;
    this._activeProcessingPipeline = null;
    this.assistantSelectionContext = null;
    this.screenContextPromise = null;
    this.selectionCapturePromise = null;
    this.warmupFailureStreak = 0;
    this._setOwnedAudio(null);
    this.lastAudioMetadata = null;
    this._localSpeechGateState = null;
    this._streamingCommitActive = false;
    this._previewFlushResolve = null;
    this._batchSegments = [];
    this._batchPcmTap = null;
    this._rotatingBatchRecorder = null;
    this._rotationResolve = null;
    this._stopRequestedDuringMicRecovery = false;
    this._cancelRequestedDuringMicRecovery = false;
    this._streamingFallbackSegments = [];
    this._streamingMicSwapPromise = null;
    this.micRecovery = new ActiveMicRecoveryController({
      mediaDevices: navigator.mediaDevices,
      acquire: async (reason) => {
        try {
          const constraints = await this.getAudioConstraints(
            false,
            reason === "devicechange" || reason === "devicechange-ended"
          );
          return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (error) {
          logger.debug(
            "Preferred mic unavailable during recovery, falling back to default",
            { error: error.message },
            "audio"
          );
          const fallback = await this.getAudioConstraints(true);
          return navigator.mediaDevices.getUserMedia(fallback);
        }
      },
      onRecovered: (replacement, previous) => this.replaceActiveMic(replacement, previous),
      onStatusChange: (status) => this.setMicCaptureStatus(status),
    });
  }

  getWorkletBlobUrl() {
    if (this.workletBlobUrl) return this.workletBlobUrl;
    const code = `
const BUFFER_SIZE = 800;
class PCMStreamingProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Int16Array(BUFFER_SIZE);
    this._offset = 0;
    this._stopped = false;
    this.port.onmessage = (event) => {
      if (event.data === "stop") {
        if (this._offset > 0) {
          const partial = this._buffer.slice(0, this._offset);
          this.port.postMessage(partial.buffer, [partial.buffer]);
          this._buffer = new Int16Array(BUFFER_SIZE);
          this._offset = 0;
        }
        this.port.postMessage("flushed");
        this._stopped = true;
      }
    };
  }
  process(inputs) {
    if (this._stopped) return false;
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      this._buffer[this._offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this._offset >= BUFFER_SIZE) {
        this.port.postMessage(this._buffer.buffer, [this._buffer.buffer]);
        this._buffer = new Int16Array(BUFFER_SIZE);
        this._offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-streaming-processor", PCMStreamingProcessor);
`;
    this.workletBlobUrl = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
    return this.workletBlobUrl;
  }

  getCustomDictionaryPrompt() {
    const words = getDictionaryHintWords(this.settings());
    return words.length > 0 ? words.join(", ") : null;
  }

  // Script conversion targets whatever the user ends up pasting: the translation
  // target when translating, otherwise the dictation language. Using the STT
  // language here would force zh-TW source audio back to Traditional even when
  // the user asked to translate into Simplified.
  //
  // Only a completed translate step actually moves text into the target language.
  // When translation is unreachable, skipped or fails, the source transcript is
  // what gets pasted, so it must be scripted as the STT language — otherwise a
  // failed ja → zh-CN run would run Japanese through OpenCC (会議の資料 → 会议の数据).
  getEffectiveOutputLanguage(settings = this.settings()) {
    if (this.translationRequested && this.translationApplied) {
      return settings.translationTargetLanguage || "auto";
    }
    return this.getEffectiveSttLanguage(settings);
  }

  // Whisper only accepts language "zh"; script (简体/繁體) is applied here. See #975.
  // No transcript exists yet, so only an explicit zh-CN/zh-TW may bias the prompt.
  getWhisperPrompt(
    settings = this.settings(),
    dictionaryPrompt = this.getCustomDictionaryPrompt()
  ) {
    return mergeWhisperPrompt(
      dictionaryPrompt,
      resolveChineseScriptTarget(
        this.getEffectiveSttLanguage(settings),
        settings.chineseScriptPreference
      )
    );
  }

  // Cleanup runs before the translate step, so it still works in the STT language.
  getCleanupLanguage(settings) {
    return resolveCleanupLanguage(this.getEffectiveSttLanguage(settings));
  }

  finalizeChineseScript(text, settings = this.settings()) {
    return applyChineseScript(
      text,
      resolveChineseScriptTarget(
        this.getEffectiveOutputLanguage(settings),
        settings.chineseScriptPreference,
        text
      )
    );
  }

  // Check the dictionary on its own as well as the full prompt: the echo filter needs
  // 70% of the prompt's words to appear, and a Chinese script bias counts as one more
  // word, which alone pushes a one- or two-term dictionary under the threshold.
  isDictionaryEcho(text) {
    return (
      matchesDictionaryPrompt(text, this.getCustomDictionaryPrompt()) ||
      matchesDictionaryPrompt(text, this.getWhisperPrompt())
    );
  }

  _undoWindow() {
    const factory = this._undoWindowFactory ?? createUndoWindow;
    return (this._undo ??= factory({
      onClose: (buffer, reason, opts) => this._closeCancelled(buffer, reason, opts),
    }));
  }

  /** A timer and a clock that tests replace, so one fake clock drives every deadline. */
  _now() {
    return Date.now();
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _emitCancelled(buffer) {
    const state = this._undo?.state();
    if (!state || this._undo.peek() !== buffer) return;
    this.onCancelledChange?.(
      {
        sessionId: buffer.session.id,
        ...state,
        remoteAlreadySent: buffer.tracker?.get() ?? null,
      },
      undefined,
      buffer.onboardingTake
    );
  }

  _openCancelled(buffer) {
    this._undoWindow().open(buffer);
    // Evidence that settles after the cancel (an upload that finished
    // sending, an attested egress notice) updates the copy while open.
    buffer.tracker?.setOnChange(() => this._emitCancelled(buffer));
    this._emitCancelled(buffer);
  }

  async _closeCancelled(buffer, reason, { wait } = {}) {
    return this._trackRecordingWork(async () => {
      if (reason !== "abandoned")
        this.onCancelledChange?.(
          null,
          { sessionId: buffer.session.id, reason },
          buffer.onboardingTake
        );
      buffer.tracker?.dispose();
      buffer.context?.release(); // the press-time reads end with the hold (Task 6)
      if (reason === "replaced" && this._undo?.peek()) this._emitCancelled(this._undo.peek());
      // Nothing will be saved: zero now, at the deadline. Copies still in flight are zeroed
      // when they land (R1-I1). An expired or flushed private hold is never persisted (§5.2).
      if (buffer.private || !shouldSaveDiscardedRecording(getSettings(), buffer.durationSeconds)) {
        buffer.zero();
        return;
      }
      // Retention on: wait a bounded time for the final chunk and copies, then save what arrived.
      await buffer.ready({ until: wait?.(CLOSE_SAVE_WAIT_MS) });
      const role = buffer.kind === "streaming" ? "fallback" : "segment";
      const blobs = buffer.bytes(role).map((bytes) => new Blob([bytes], { type: buffer.mimeType }));
      buffer.zero(); // the Blobs hold their own copies
      if (blobs.length === 0) return;
      try {
        // Disk is allowed here only because retention already saves discarded audio.
        const merged =
          blobs.length === 1
            ? blobs[0]
            : await this.mergeRecordedSegments(blobs, neverCancelled, { private: buffer.private });
        if (merged)
          await this.saveDiscardedTranscription(
            merged,
            buffer.durationSeconds,
            buffer.analyticsOccurredAt,
            {
              private: buffer.private,
              translationRequested: buffer.session.intents.translationRequested,
            }
          );
      } catch (error) {
        logger.warn("Failed to save discarded recording", { error: error.message }, "audio");
      }
    });
  }

  /** Move the active session, its tracker and its audio into a new buffer; release every other reference. */
  _bufferForSession(kind, { durationSeconds, analyticsOccurredAt, mimeType }) {
    // Task 6: ends the session but keeps its press-time reads (selection, screenshot) for Undo (R1-C2).
    const { session, context, tracker } = this._detachSessionOperation();
    const buffer = createCancelBuffer({
      session,
      kind,
      mimeType: mimeType || this.recordingMimeType,
      durationSeconds,
      analyticsOccurredAt,
      tracker,
      context,
    });
    // Privacy was frozen on this session at the recording start; the buffer keeps it through Undo.
    buffer.private = session?.private === true;
    buffer.recording = this._recordingContext;
    buffer.onboardingTake = this._onboardingTake;
    this._disclosure = null; // the buffer owns the tracker now
    if (session && this._lastAudioSessionId === session.id) this._setOwnedAudio(null);
    if (this._sessionAudio?.session === session) this._sessionAudio = null;
    return buffer;
  }

  /**
   * §5.2 audio ownership. The ONLY writer of `lastAudioBlob`, its owner session and its
   * persistence privacy flag. Every assignment goes through here before any callback or
   * provider work can save. Pass null to release.
   */
  _setOwnedAudio(
    blob,
    {
      sessionId = this._activeSession?.id ?? null,
      private: isPrivate = this._activeSession?.private ?? this._recordingPrivate === true,
    } = {}
  ) {
    this.lastAudioBlob = blob ?? null;
    this._lastAudioSessionId = blob ? sessionId : null;
    this.lastAudioBlobPrivate = Boolean(blob) && isPrivate === true;
    this._lastAudioOwnerToken = {};
    // Keep the recording's flag consistent with the audio it owns.
    if (blob && sessionId && sessionId === this._activeSession?.id)
      this._recordingPrivate = isPrivate === true;
  }

  /**
   * R4-C1: an immutable view of who owns lastAudioBlob, taken before any await. A save
   * persists only this, so a newer recording that owns lastAudioBlob by the time a write
   * resolves is never read, uploaded or released by an older save. With `sessionId`, the
   * audio counts only if that session still owns it.
   */
  _ownedAudioSnapshot({ sessionId, private: sessionPrivate } = {}) {
    const owner = this._lastAudioSessionId;
    const owns = Boolean(this.lastAudioBlob) && (sessionId === undefined || sessionId === owner);
    const id = owns ? owner : (sessionId ?? null);
    return Object.freeze({
      blob: owns ? this.lastAudioBlob : null,
      sessionId: id,
      private: owns
        ? this.lastAudioBlobPrivate === true
        : sessionPrivate === undefined
          ? Boolean(id)
          : sessionPrivate === true,
      ownerToken: owns ? this._lastAudioOwnerToken : null,
      metadata: owns ? (this.lastAudioMetadata ?? null) : null,
    });
  }

  /** Releases only the exact Blob generation and owner captured by this snapshot. */
  _releaseOwnedAudio(owned) {
    if (
      !owned.blob ||
      this.lastAudioBlob !== owned.blob ||
      this._lastAudioSessionId !== owned.sessionId ||
      this._lastAudioOwnerToken !== owned.ownerToken
    )
      return;
    this._setOwnedAudio(null, { sessionId: owned.sessionId, private: owned.private });
    this.lastAudioMetadata = null;
  }

  async restoreCancelled(sessionId, { deadlineAt } = {}) {
    // R3-I1: a bridge request carries main's absolute admission deadline (Task 9). It is
    // counted from when main sent the request, so delivery delay and queueing in this
    // renderer use up the same budget. Past it, main has already answered: touch nothing.
    const deadline = Number.isFinite(deadlineAt) ? deadlineAt : null;
    if (deadline !== null && this._now() >= deadline) {
      return { restored: false, sessionId: sessionId ?? null, reason: "unavailable" };
    }
    const buffer = this._undo?.peek();
    if (!buffer || (sessionId && buffer.session.id !== sessionId)) {
      return { restored: false, sessionId: sessionId ?? null, reason: "expired" };
    }
    if (!canStartDictation(this.getState())) {
      return { restored: false, sessionId: buffer.session.id, reason: "busy" };
    }
    // Claim before any await (I3): the window closes, the lifecycle is busy.
    this._undo.take();
    const generation = (this._restoreGeneration = (this._restoreGeneration ?? 0) + 1);
    // A claimed buffer is no longer in the Undo window. Keep exact preflight
    // ownership until admission so hook teardown can dispose it as well.
    let endPreflight;
    const preflight = {
      buffer,
      disposed: false,
      ended: new Promise((resolve) => {
        endPreflight = resolve;
      }),
      end: () => endPreflight(),
    };
    (this._restorePreflights ??= new Set()).add(preflight);
    const finishPreflight = () => this._restorePreflights.delete(preflight);
    // §5.2 order: the window closes ("restored"), then processing starts (R1-I6).
    this.onCancelledChange?.(
      null,
      { sessionId: buffer.session.id, reason: "restored" },
      buffer.onboardingTake
    );
    this.isProcessing = true;
    this.onStateChange?.({ isRecording: false, isProcessing: true });

    // This restore owns the lifecycle only while its generation is current. Esc
    // (cancelProcessing / cancelRecording) bumps it and settles idle itself (R1-I3).
    const owns = () => !preflight.disposed && generation === this._restoreGeneration;
    const refuse = (reason, { keep }) => {
      finishPreflight();
      // cleanup already closed this exact buffer through the retention path.
      // It must never reopen a window or publish from the old hook's continuation.
      if (preflight.disposed)
        return { restored: false, sessionId: buffer.session.id, reason: "unavailable" };
      if (owns()) {
        this.isProcessing = false;
        this.onStateChange?.({ isRecording: false, isProcessing: false });
      }
      if (keep) this._rehold(buffer);
      else {
        buffer.zero();
        buffer.context?.release();
        buffer.tracker?.dispose();
      }
      return { restored: false, sessionId: buffer.session.id, reason };
    };

    // Every pre-flight wait fits inside the time left before main's deadline, and the
    // deadline is checked again just before the pipeline starts (below).
    const waitMs =
      deadline === null
        ? FINAL_AUDIO_WAIT_MS
        : Math.max(0, Math.min(FINAL_AUDIO_WAIT_MS, deadline - this._now()));

    // R2-C1: wait for the recorder's final chunk, bounded. "Not delivered yet" is not
    // "empty": on timeout the recording goes back into its window, unzeroed, and a
    // late chunk still lands in it.
    let complete;
    try {
      complete = await buffer.ready({
        until: Promise.race([this._delay(waitMs), preflight.ended]),
      });
    } catch {
      return refuse("noAudio", { keep: false });
    }
    if (!owns()) return refuse("busy", { keep: true });
    if (!complete) return refuse("noAudio", { keep: true });
    if (await this._sealedBlocks(buffer.session)) return refuse("sealed", { keep: true });
    if (!owns()) return refuse("busy", { keep: true });
    const empty =
      buffer.kind === "streaming" ? !buffer.frames().length : !buffer.bytes("segment").length;
    if (empty) return refuse("noAudio", { keep: false });
    if (
      buffer.kind === "streaming" &&
      !STREAMING_PROVIDERS[buffer.session.intents.streamingProviderName]
    ) {
      return refuse("routeUnavailable", { keep: true }); // never re-route; the window keeps the words until it ends
    }

    if (deadline !== null && this._now() >= deadline) return refuse("unavailable", { keep: true }); // main already answered

    let restoredRecording = buffer.recording;
    try {
      if (buffer.recording?.restoreOnboardingOwner)
        restoredRecording = {
          ...buffer.recording,
          assertOnboardingOwner: buffer.recording.restoreOnboardingOwner(buffer.session.id),
        };
    } catch {
      return refuse("unavailable", { keep: false });
    }
    finishPreflight();
    // Task 7 keeps the evidence; Task 6 hands back the press-time selection and screenshot (R1-C2).
    this.applySessionIntents(buffer.session, { tracker: buffer.tracker, context: buffer.context });
    // Preflight claimed busy before a session was attached. Publish again now
    // so useAudioRecording exposes the restored frozen routes to the pill (Task 11).
    this.onStateChange?.({ isRecording: false, isProcessing: true }, buffer.onboardingTake);
    this._recordingPrivate = buffer.private === true; // §5.2: re-applied before processing
    this._recordingContext = restoredRecording;
    this._onboardingTake = buffer.onboardingTake;
    this._restoreRun = (
      buffer.kind === "streaming"
        ? this._replayStreamingSession(buffer, generation)
        : this._restoreBatch(buffer, generation)
    )
      .catch((error) => {
        logger.warn("Undo could not run the original route", { error: error?.message }, "audio");
        if (owns()) this.onError?.({ ...error, messageKey: "voiceOverlay.errors.restoreFailed" });
      })
      .finally(() => buffer.zero());
    return { restored: true, sessionId: buffer.session.id };
  }

  /**
   * Puts a recording back in the undo window, unless something newer owns the
   * pill: a newer hold, or a recording or pipeline that started after Esc. Then
   * it closes the way a newer start ends a window (Step 4.9): saved if retention
   * allows, zeroed otherwise (R1-I3). The reason "abandoned" is internal: its
   * window already announced its close, so nothing is emitted and a newer
   * window's state is never cleared.
   */
  _rehold(buffer) {
    const newer = this._undo?.peek() || this.isRecording || this.isProcessing || this.isStreaming;
    if (newer) void this._undoWindow().discard(buffer, "abandoned");
    else this._openCancelled(buffer);
  }

  async _restoreBatch(buffer, generation) {
    const { session } = buffer;
    const isPrivate = buffer.private === true;
    const blobs = buffer
      .bytes("segment")
      .map((bytes) => new Blob([bytes], { type: buffer.mimeType }));
    buffer.zero(); // the Blobs are the restored dictation's own audio now
    const metadata = {
      durationSeconds: buffer.durationSeconds,
      analyticsOccurredAt: buffer.analyticsOccurredAt,
      restoredFromCancel: true,
    };
    // Re-register the audio first, so an Esc during this restore re-holds it (Step 4.8).
    this._sessionAudio = {
      session,
      kind: "batch",
      segments: blobs,
      mimeType: buffer.mimeType,
      ...metadata,
    };
    const pipeline = this._startProcessingPipeline(); // Esc bumps its generation (cancelProcessing)
    const wasCancelled = () =>
      generation !== this._restoreGeneration || this._shouldAbandonProcessingPipeline(pipeline);
    let audio;
    try {
      audio =
        blobs.length === 1
          ? blobs[0]
          : await this.mergeRecordedSegments(blobs, wasCancelled, { private: isPrivate });
      if (!audio)
        throw Object.assign(new Error("Undo could not combine the recording"), {
          code: "MERGE_FAILED",
        });
    } catch (error) {
      // R2-C2: the merge runs outside processAudio's try/finally. Take the session's
      // ownership into a hold *before* settling, which would end the session and release
      // its context. An Esc during the merge already re-held it (Step 4.8).
      if (this._activeProcessingPipeline === pipeline) {
        const held = this._holdForRetry(blobs, metadata);
        this._settleProcessingPipeline(pipeline);
        if (held) this._rehold(held);
      }
      throw error;
    }
    if (this._shouldAbandonProcessingPipeline(pipeline)) return; // Esc during the merge re-held it (Step 4.8)
    // R2-C2 / R3-C1: the same recovery ownership as a normal dictation, privacy included, set
    // before any provider or save work. The failure path and Plan 07's _noteSealedFailure read it.
    this._setOwnedAudio(audio, { sessionId: session.id, private: isPrivate });
    pipeline.recording.ownedAudio = this._ownedAudioSnapshot({
      sessionId: session.id,
      private: isPrivate,
    });
    await this.processAudio(audio, metadata, pipeline);
  }

  /**
   * R2-C2: moves the live session's whole ownership (session, route, intents, press-time
   * context, disclosure tracker, privacy) into a new hold, without ending or releasing any
   * of it. Call it while the failing pipeline still owns the session, before settlement.
   */
  _holdForRetry(blobs, metadata) {
    if (!this._activeSession) return null;
    const held = this._bufferForSession("batch", {
      durationSeconds: metadata.durationSeconds,
      analyticsOccurredAt: metadata.analyticsOccurredAt,
      mimeType: blobs[0]?.type,
    });
    for (const blob of blobs) held.adoptBlob(blob, "segment");
    return held;
  }

  async _sealedBlocks(session) {
    if (!this._readSealed()) return false;
    if (!session.routes) return true; // routes could not be resolved (Task 6): fail closed while sealed
    const routes = session.routes ?? {};
    const { intents, settings } = session;
    const used = [
      routes.dictationStt,
      settings.useCleanupModel ? routes.dictationCleanup : null,
      intents.translationRequested ? routes.translation : null,
      intents.voiceAgentRequested ? routes.voiceAssistant : null,
      intents.voiceAgentRequested && settings.voiceAgentScreenContext
        ? routes.assistantVision
        : null,
    ];
    return used.some((r) => r && r.locality !== "device" && r.state?.status !== "off");
  }

  pauseCancelHold() {
    const buffer = this._undo?.peek();
    if (!buffer) return;
    this._undo.pause();
    this._emitCancelled(buffer);
  }

  resumeCancelHold() {
    const buffer = this._undo?.peek();
    if (!buffer) return;
    this._undo.resume();
    this._emitCancelled(buffer);
  }

  flushCancelHold() {
    return this._undo?.expireNow() ?? Promise.resolve();
  }

  /**
   * R2-C2: every failure branch of a restored dictation (STT, Sealed, dictionary echo)
   * awaits an acknowledged save of its own snapshot, then re-holds while the failing
   * pipeline still owns the session, whenever no usable copy survived.
   */
  async _recoverRestoredFailure(error, audioBlob, metadata, owned, wasCancelled) {
    const saved = owned.blob
      ? await this.saveFailedTranscription(error.message, error.code || null, metadata, owned)
      : { audioKept: false };
    if (saved.audioKept || error.recoveryHeld || wasCancelled()) return null; // a copy survived, or Esc re-held it (Step 4.8)
    return this._holdForRetry([audioBlob], metadata);
  }

  _holdStreamingSession() {
    const held = this._sessionAudio;
    if (
      !this._activeSession ||
      held?.kind !== "streaming" ||
      held.session !== this._activeSession ||
      !held.frames.length
    )
      return false;
    // Read the duration before any cancel path clears recordingStartTime.
    held.durationSeconds = this.recordingStartTime
      ? (Date.now() - this.recordingStartTime) / 1000
      : held.durationSeconds;
    if (this.streamingFallbackRecorder && !held.fallbackPending)
      void this.finishStreamingFallbackSegment();
    const buffer = this._bufferForSession("streaming", held);
    held.cancelBuffer = true;
    if (this.streamingFallbackRecorder && held.fallbackChunks) {
      this.streamingFallbackRecorder.ondataavailable = (event) => {
        if (!buffer.isZeroed() && event.data?.size > 0) held.fallbackChunks.push(event.data);
      };
    }
    buffer.releaseSources = () => {
      if (held.fallbackChunks) held.fallbackChunks.length = 0;
    };
    buffer.adoptFrames(held.frames.splice(0));
    for (const segment of held.fallbackSegments.splice(0)) buffer.adoptBlob(segment, "fallback");
    if (held.fallbackPending) {
      const tail = buffer.expect("fallback");
      held.fallbackPending.then(
        (blob) => tail.deliver(blob),
        () => tail.fail()
      );
    } else if (held.fallbackChunks?.length) {
      buffer.adoptBlob(new Blob(held.fallbackChunks, { type: "audio/webm" }), "fallback");
      held.fallbackChunks.length = 0;
    }
    this._openCancelled(buffer);
    return true;
  }

  /**
   * Plan 07 dictation pre-flight (spec §5.4). While Sealed mode is known to be
   * on, a dictation whose speech route leaves this computer, or whose built-in
   * engine main has not verified as available, does not start: nothing is
   * recorded that main would refuse. Reads the press-time route of `session`
   * through Plan 03's graph; unknown (null) never blocks. UX only: main still
   * enforces the seal, and a seal mid-recording goes through recovery.
   */
  _sealedPreflight(session) {
    const snapshot = sealedStore.getSealedSnapshot();
    if (snapshot.sealed !== true) return null;
    try {
      return this._sealedPreflightFor(sessionSettings(session ?? null, getSettings()), snapshot);
    } catch (error) {
      // Sealed and the route cannot be resolved: fail closed, as main would.
      logger.warn(
        "Sealed pre-flight could not resolve the route",
        { error: error?.message },
        "audio"
      );
      return {
        code: "SEALED_MODE",
        phase: "refused",
        titleKey: "sealedMode.blocked.dictationPreflight",
        title: "sealedMode.blocked.dictationPreflight",
        messageKey: "sealedMode.blocked.dictationPreflightDetail",
        variant: "default",
      };
    }
  }

  _sealedPreflightFor(settings, snapshot) {
    if (isDictationSealed(settings, true))
      return {
        code: "SEALED_MODE",
        phase: "refused",
        titleKey: "sealedMode.blocked.dictationPreflight",
        title: "sealedMode.blocked.dictationPreflight",
        messageKey: "sealedMode.blocked.dictationPreflightDetail",
        variant: "default",
      };
    if (isDictationNativeUnavailable(settings, snapshot)) {
      const paused = isDictationPausedNative(settings, snapshot);
      const titleKey = paused
        ? "sealedMode.blocked.dictationPreflight"
        : "sealedMode.blocked.nativeUnavailableTitle";
      return {
        code: "SEALED_MODE",
        phase: "refused",
        titleKey,
        title: titleKey,
        messageKey: paused
          ? "sealedMode.paused.dictationPreflightDetail"
          : "sealedMode.blocked.nativeUnavailableDetail",
        variant: "default",
      };
    }
    return null;
  }

  _refuseSealedStart(candidate, refusal) {
    this.cancelPreparedMicCapture(candidate);
    this.releasePressCandidate(candidate);
    this.onError?.(refusal);
    return false;
  }

  /**
   * Plan 07 recovery (A10). `operation` belongs to the failing pipeline: its
   * owner-stamped audio snapshot and the exact Plan 04 session it captured.
   * Never reads a newer manager session, Blob, privacy flag or setting.
   * Transfers the session, context and tracker out of the manager before any
   * await, so ordinary settlement cannot release them, then waits for the
   * saver's acknowledgement before choosing History or RAM copy. Returns
   * { recoveryHeld, audioKept }.
   */
  async _finishSealedFailure(error, operation) {
    error.code = "SEALED_MODE";
    const replayId = operation?.pipelineRecoveryId ?? null;
    if (replayId != null && this._recoveryReplay === replayId) {
      // A replay's claimed hold already owns this operation: no second save,
      // no duplicate hold. processAudio's finally returns the session to it.
      error.recoveryHeld = true;
      error.messageKey = sealedDictationMessageKey(error, { held: true });
      return { recoveryHeld: true, audioKept: false };
    }
    // Plan 04's helper transfers only the active session; a stale callback
    // never detaches or releases a newer owner.
    if (!operation?.session || this._activeSession !== operation.session) {
      error.recoveryHeld = false;
      error.messageKey = sealedDictationMessageKey(error);
      return { recoveryHeld: false, audioKept: false };
    }
    const detached = this._detachSessionOperation();
    const owned = operation.owned ?? {};
    const held = Object.freeze({
      owned: Object.freeze({
        blob: owned.blob ?? null,
        sessionId: owned.sessionId ?? detached.session.id,
        private: owned.private === true || detached.session.private === true,
        metadata: operation.metadata ?? owned.metadata ?? null,
      }),
      session: detached.session,
      context: detached.context ?? null,
      tracker: detached.tracker ?? null,
    });
    let saved = { audioKept: false };
    if (held.owned.blob && !held.owned.private && owned.blob) {
      try {
        saved = await this.saveFailedTranscription(
          error.message,
          "SEALED_MODE",
          operation.metadata ?? {},
          owned
        );
      } catch (persistenceError) {
        // A failed write is not an acknowledgement; the hold keeps the bytes.
        logger.warn(
          "Failed to persist sealed dictation",
          { error: persistenceError?.message },
          "audio"
        );
      }
    }
    const audioKept = saved?.audioKept === true;
    const hold =
      Boolean(held.owned.blob) &&
      shouldHoldInMemory(error, { audioKept, privateTake: held.owned.private });
    if (hold) holdForRecovery(held);
    else {
      // History acknowledged the audio, or there was none: close once.
      held.context?.release();
      held.tracker?.dispose?.();
    }
    error.recoveryHeld = hold;
    error.messageKey = sealedDictationMessageKey(error, { held: hold, audioKept });
    return { recoveryHeld: hold, audioKept };
  }

  /** The notice for a sealed dictation failure, after its copy is accurate. */
  _sealedFailureNotice(error) {
    return {
      code: "SEALED_MODE",
      phase: sealedPhase(error) ?? "refused",
      titleKey: "sealedMode.blocked.dictationTitle",
      title: "sealedMode.blocked.dictationTitle",
      messageKey: error.messageKey,
      recoveryHeld: error.recoveryHeld === true,
      ...(error.providerRetained ? { providerRetained: error.providerRetained } : {}),
    };
  }

  /**
   * A stream that Sealed mode cut off with no text. The fallback audio was
   * owner-stamped to this recording before its snapshot; persist or hold it
   * from that snapshot, then report the failure with accurate copy.
   */
  async _preserveSealedStream(error, { owned, session, metadata, onboardingTake, recording }) {
    await this._finishSealedFailure(error, { owned, session, metadata });
    this.isProcessing = false;
    this.onStateChange?.(
      { isRecording: false, isProcessing: false, isStreaming: false },
      onboardingTake,
      recording
    );
    this.onError?.(this._sealedFailureNotice(error), onboardingTake, recording);
    if (recording?.private) this.releasePrivateAudio(recording.ownedAudio);
    return true;
  }

  /**
   * "Transcribe" on the error notice or the unseal notice. Claims an idle
   * pipeline and the oldest hold; the hold is removed only when the replay
   * produced a transcript. Its exact session, context and tracker are attached
   * for the replay and returned to the same claimed entry on every outcome.
   */
  async transcribeRecovered() {
    if (
      this.isRecording ||
      this.isProcessing ||
      this.isStreaming ||
      this._startInProgress ||
      this._streamingStopPromise ||
      this._recoveryReplay != null
    )
      return { started: false, reason: "busy" };
    const held = claimRecovery();
    if (!held) return { started: false, reason: "none" };
    const { owned, session, context, tracker } = held.operation;
    // Still sealed for this recording's own route: replaying would only be
    // refused again. The hold stays for after unseal.
    const refusal = this._sealedPreflight(session);
    if (refusal) {
      releaseRecovery(held.id, { done: false });
      this.onError?.(refusal);
      return { started: false, reason: "sealed" };
    }
    this._recoveryReplay = held.id;
    let pipeline = null;
    try {
      this.applySessionIntents(session, { context, tracker });
      this._setOwnedAudio(owned.blob, { sessionId: owned.sessionId, private: owned.private });
      pipeline = this._startProcessingPipeline();
      pipeline.recoveryId = held.id;
      this.isProcessing = true;
      this.onStateChange?.({ isRecording: false, isProcessing: true, isStreaming: false });
      await this.processAudio(owned.blob, { ...(owned.metadata ?? {}) }, pipeline);
    } finally {
      // processAudio returned the session to this entry before settlement on
      // every outcome, and a cancellation returned it already. If processAudio
      // never reached its own settlement, return it here, still guarded.
      if (pipeline) {
        this._returnReplayOperation(pipeline);
        if (this._activeProcessingPipeline === pipeline) this._settleProcessingPipeline(pipeline);
      }
      this._recoveryReplay = null;
      releaseRecovery(held.id, { done: pipeline?.outcome === "success" });
    }
    return { started: true, succeeded: pipeline?.outcome === "success" };
  }

  _readSealed() {
    // The shared store is the supported present authority. Plan07 may extend
    // that boundary when its real producer exists; do not probe absent exports.
    return sealedStore.getSealed() === true;
  }

  _dropSessionAudio() {
    const held = this._sessionAudio;
    if (!held) return;
    held.frames?.forEach((frame) => frame.fill(0));
    for (const key of ["frames", "segments", "fallbackSegments", "fallbackChunks"])
      if (held[key]) held[key].length = 0;
    this._sessionAudio = null;
  }

  async _replayStreamingSession(buffer, generation) {
    const { session } = buffer;
    const providerName = session.intents.streamingProviderName;
    const provider = STREAMING_PROVIDERS[providerName];
    const sessionId =
      (this._activeStreamingSessionId =
      this._streamingSessionGeneration =
        (this._streamingSessionGeneration ?? 0) + 1);
    const operation = Object.freeze({
      correlationId: session.id,
      dictationSessionId: session.id,
      operationId: crypto.randomUUID(),
    });
    this._streamingOperation = operation;
    const transport = {
      adapter: provider,
      operation,
      name: providerName,
      closed: false,
      stopPromise: null,
    };
    this._streamingTransport = transport;
    const owns = () =>
      this._activeStreamingSessionId === sessionId && this._streamingOperation === operation;
    // Keep a copy for an Esc mid-replay (Step 4.7) before the buffer is zeroed.
    const replayAudio = (this._sessionAudio = {
      session,
      kind: "streaming",
      frames: buffer.frames().map((f) => f.slice()),
      fallbackChunks: null,
      fallbackSegments: buffer.bytes("fallback").map((b) => new Blob([b], { type: "audio/webm" })),
      mimeType: "audio/webm",
      durationSeconds: buffer.durationSeconds,
      analyticsOccurredAt: buffer.analyticsOccurredAt,
    });
    this._streamingFallbackSegments = this._sessionAudio.fallbackSegments;
    const frames = replayAudio.frames;
    const wasCancelled = () =>
      generation !== this._restoreGeneration ||
      !owns() ||
      this._activeSession !== session ||
      this._sessionAudio !== replayAudio;
    const assertReplayOwner = () => {
      if (wasCancelled())
        throw Object.assign(new Error("Undo cancelled"), { code: "TRANSCRIPTION_CANCELLED" });
    };
    buffer.zero(); // replay owns the only mutable copy, even while Start is pending
    let started = false;
    try {
      this.isStreaming = true;
      this._attachStreamingListeners(sessionId, provider);
      const settings = this.settings();
      transport.startPromise = Promise.resolve().then(() =>
        provider.start({
          ...buildStreamingSessionOptions({
            providerName,
            settings,
            language: this.getEffectiveSttLanguage(settings),
            keyterms: this.getKeyterms(),
            voiceAgentRequested: session.intents.voiceAgentRequested,
            correlationId: session.id,
          }),
          ...operation,
        })
      );
      const res = await transport.startPromise;
      started = res?.success === true;
      assertReplayOwner(); // Start may settle after Esc moved all frames into a hold
      if (!res?.success)
        throw Object.assign(new Error(res?.error || "Streaming start failed"), { code: res?.code });
      // No evidence here (R1-I5): a connection is not a dispatch. Main sends the correlated
      // dictation-dispatch when the first replayed frame actually leaves (Task 7), and the
      // restored tracker is still subscribed to session.id.
      for (let i = 0; i < frames.length; i += REPLAY_BATCH_FRAMES) {
        assertReplayOwner();
        for (const frame of frames.slice(i, i + REPLAY_BATCH_FRAMES)) {
          assertReplayOwner();
          provider.send(
            frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength),
            operation
          );
        }
        await new Promise((resolve) => setTimeout(resolve, REPLAY_PACE_MS));
        assertReplayOwner(); // the shared frames array can be empty after the wait
      }
      assertReplayOwner(); // independent admission guard, including an empty/final batch
      buffer.zero();
      this._streamingStopPromise = this._finalizeStreamingRecording(sessionId, {
        replay: true,
        shouldAbandon: wasCancelled,
      });
      const finalized = await this._streamingStopPromise;
      assertReplayOwner();
      if (finalized === false) throw new Error("Streaming finalization failed");
      // Only a successful replay releases its PCM copy. Failed finalization must
      // leave it available to the catch below, even if finalization returned false.
      if (owns() && this._sessionAudio?.session === session) this._dropSessionAudio();
    } catch (error) {
      // Every unsuccessful replay stops further egress and transfers its copy
      // into a fresh Undo window BEFORE awaiting provider shutdown. Esc may
      // already have done this; the session ownership check makes it idempotent.
      provider?.cancel?.(operation);
      if (owns()) this._holdStreamingSession();
      buffer.zero(); // the fresh hold owns the copy; a slow stop must not retain the original
      if (started) await this._stopStreamingTransport(transport).catch(() => {});
      if (error?.code !== "TRANSCRIPTION_CANCELLED") throw error;
    } finally {
      const owned = owns();
      if (this._activeStreamingSessionId === sessionId) {
        this._streamingStopPromise = null;
        this._activeStreamingSessionId = null;
        this.isStreaming = false;
      }
      // Settle only a lifecycle this replay still owns: after Esc, a newer operation may run (R1-I3).
      if (generation === this._restoreGeneration && this.isProcessing) {
        this.isProcessing = false;
        this.onStateChange?.({ isRecording: false, isProcessing: false, isStreaming: false });
      }
      if (owned && this._activeSession === session) this._endDictationSession(session);
    }
  }

  // Policy applies only to future admissions. The recorder/pipeline carries its
  // own privacy through acquisition, retries, completion and delayed callbacks.
  // Extends the original recorder admission. This is cleanup ownership only;
  // recording privacy/cancellation and future Plan04 audio/session owners stay put.
  assertTrialContext(recording) {
    recording?.assertOnboardingOwner?.();
    if (!recording?.trialContext) return;
    if (
      trialContext(getSettings()) !== recording.trialContext ||
      (recording.expectedTrialContext && recording.expectedTrialContext !== recording.trialContext)
    )
      throw Object.assign(new Error("The recording choices changed. Try a new take."), {
        code: "TRIAL_CONTEXT_CHANGED",
      });
  }

  admitCleanupOperation(take, recording, enabled = true) {
    if (take?.demoId && typeof take.takeId === "string" && enabled && !recording.trialContext) {
      recording.trialContext = trialContext(getSettings());
      recording.expectedTrialContext = take.expectedContext;
      take.context = recording.trialContext;
    }
    if (!take?.demoId || typeof take.takeId !== "string" || !enabled || recording.cleanupOperation)
      return;
    this.retireCapturedCleanup();
    const identity = { demoId: take.demoId, takeId: take.takeId, operationId: crypto.randomUUID() };
    const settings = getSettings();
    const language = settings.preferredLanguage;
    const scriptPreference = settings.chineseScriptPreference;
    const operation = createCapturedCleanupOperation(identity, undefined, (text) =>
      applyChineseScript(text, resolveChineseScriptTarget(language, scriptPreference, text))
    );
    recording.cleanupOperation = operation;
    this._retainedCleanupOperation = operation;
  }

  retireCapturedCleanup(identity) {
    const operation = this._retainedCleanupOperation;
    if (
      !operation ||
      (identity &&
        (!["demoId", "takeId", "operationId"].some((key) => typeof identity[key] === "string") ||
          !["demoId", "takeId", "operationId"].every(
            (key) => identity[key] === undefined || identity[key] === operation.identity[key]
          )))
    )
      return;
    this._retainedCleanupOperation = null;
    operation.retire();
  }

  async retryCapturedCleanup(request) {
    const operation = this._retainedCleanupOperation;
    if (
      !operation ||
      !["demoId", "takeId", "operationId"].every((key) => operation.identity[key] === request[key])
    )
      return { ...request, code: "CLEANUP_OPERATION_UNAVAILABLE" };
    try {
      const text = await operation.retry();
      return text ? { ...request, text } : { ...request, code: "CLEANUP_FAILED" };
    } catch (error) {
      return { ...request, code: error.code || "CLEANUP_FAILED" };
    }
  }

  setPrivateSession(enabled) {
    this._privateSession = enabled === true;
  }

  _captureRecordingPrivacy(recording = { private: this._privateSession === true }) {
    this._recordingPrivate = recording.private === true;
    this._recordingContext = recording;
    return recording;
  }

  // Release only the captured owner token, including when sessions reuse a Blob.
  releasePrivateAudio(owned) {
    if (owned?.private) this._releaseOwnedAudio(owned);
  }

  hasPendingRecordingWork() {
    const state = this.getState();
    return !!(
      state.isRecording ||
      state.isProcessing ||
      state.isStreaming ||
      state.isStreamingStartInProgress ||
      this._startInProgress ||
      this._streamingStopPromise ||
      this._activeProcessingPipeline ||
      this._pendingRecordingWork ||
      this._retainedCleanupOperation?.isRunning
    );
  }

  _trackRecordingWork(run) {
    this._pendingRecordingWork = (this._pendingRecordingWork ?? 0) + 1;
    const done = () => {
      this._pendingRecordingWork -= 1;
    };
    try {
      const result = run();
      if (result && typeof result.then === "function") return Promise.resolve(result).finally(done);
      done();
      return result;
    } catch (error) {
      done();
      throw error;
    }
  }

  setCallbacks({
    onStateChange,
    onProcessingStage = undefined,
    onCancelledChange = undefined,
    onError,
    // Optional: the agent overlay has no dictation toast surface.
    onNoAudio = undefined,
    onTranscriptionComplete,
    onPartialTranscript,
    onStreamingCommit,
    onTranslationFallback,
  }) {
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.onProcessingStage = onProcessingStage;
    this.onCancelledChange = onCancelledChange;
    this.onNoAudio = onNoAudio;
    this.onTranscriptionComplete = (...args) =>
      this._trackRecordingWork(() => onTranscriptionComplete?.(...args));
    this.onPartialTranscript = onPartialTranscript;
    this.onStreamingCommit = onStreamingCommit;
    this.onTranslationFallback = onTranslationFallback;
  }

  // Fail-open: translation degraded/failed but raw text is still pasted. Surface why.
  notifyTranslationFallback(reason) {
    this.onTranslationFallback?.({ reason });
  }

  setMicCaptureStatus(status) {
    if (this.micCaptureStatus === status) return;
    this.micCaptureStatus = status;
    this.onStateChange?.({
      isRecording: this.isRecording,
      isProcessing: this.isProcessing,
      isStreaming: this.isStreaming,
      micCaptureStatus: status,
    });
  }

  async beginMicRecovery(stream) {
    // A stop/cancel can land during the awaits between recorder start and this
    // call; never arm recovery for a recording that already ended.
    if (!this.isRecording) return;
    await this.micRecovery.start(stream, {
      followDefault: followsSystemDefaultMic(getSettings()),
    });
  }

  async replaceActiveMic(replacement, previous) {
    if (!this.isRecording) throw new Error("Recording is no longer active");
    if (this.isStreaming) {
      await this.replaceStreamingMic(replacement, previous);
    } else {
      await this.replaceBatchMic(replacement, previous);
    }
  }

  _cancelAbandonedSegmentMerges() {
    for (const merge of this._segmentMergeCopies ?? []) {
      if (merge.wasCancelled()) merge.abandon();
    }
  }

  async mergeRecordedSegments(
    segments,
    wasCancelled = neverCancelled,
    recording = { private: this._recordingPrivate === true }
  ) {
    if (wasCancelled()) return null;
    const privateAudio = recording.private === true;
    // Retain every original segment on its admitted owner even if conversion
    // fails, cancellation lands, or a newer owner replaces manager fields.
    if (privateAudio) recording.originalSegments = Object.freeze([...segments]);
    // Header-only segments carry no audio frames and crash FFmpeg's concat (#871).
    const usable = segments.filter((segment) => segment && !isEmptyRecording(segment.size));
    if (usable.length === 0) return null;
    if (usable.length === 1) return usable[0];
    const payload = [];
    const zero = (buffer) => {
      if (buffer) {
        const bytes = ArrayBuffer.isView(buffer)
          ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
          : new Uint8Array(buffer);
        bytes.fill(0);
      }
    };
    let closed = false,
      resolveCancelled;
    const cancelled = new Promise((resolve) => {
      resolveCancelled = resolve;
    });
    const pending = (this._segmentMergeCopies ??= new Set());
    const entry = {
      wasCancelled,
      abandon: () => {
        closed = true;
        for (const part of payload) zero(part?.buffer);
        payload.length = 0;
        pending.delete(entry);
        resolveCancelled(null);
      },
    };
    pending.add(entry);
    const abandoned = () => closed || wasCancelled();
    // Invoke conversions without retaining source Blobs in their continuations.
    const conversions = usable.map((segment, index) => {
      const mimeType = segment.type || "audio/webm";
      let copy;
      try {
        copy = segment.arrayBuffer();
      } catch (error) {
        copy = Promise.reject(error);
      }
      return Promise.resolve(copy).then((buffer) => {
        if (abandoned()) zero(buffer);
        else payload[index] = { buffer, mimeType };
      });
    });
    usable.length = 0;
    const merge = async () => {
      await Promise.all(conversions);
      if (abandoned()) return null;
      // Only this IPC admission begins the already-running-main exception.
      const result = await window.electronAPI.mergeAudioSegments(payload, {
        private: privateAudio,
      });
      try {
        if (abandoned()) return null;
        if (!result?.success) throw new Error(result?.error || "Failed to merge audio segments");
        return new Blob([result.buffer], { type: result.mimeType });
      } finally {
        zero(result?.buffer); // a late main reply is still our mutable renderer copy
      }
    };
    try {
      return await Promise.race([merge(), cancelled]);
    } finally {
      entry.abandon(); // failures and pending remainders use the same erasure path
    }
  }

  getLargestRecordedSegment(segments) {
    return segments
      .filter((segment) => segment && !isEmptyRecording(segment.size))
      .reduce(
        (largest, segment) => (segment.size > (largest?.size || 0) ? segment : largest),
        null
      );
  }

  setVoiceAgentRequested(requested) {
    this.voiceAgentRequested = requested;
    this.pendingSelectionEdit = null;
    this.pendingAssistantConversation = null;
    this.pendingCleanupFailure = null;
    this.assistantSelectionContext = null;
    // No recording must ever see a stale capture (e.g. left over from a
    // cancelled voice-agent recording, even after the setting was turned
    // off). A live voice-agent start re-captures right after this call.
    this.screenContextPromise = null;
    // Same for a prefetched selection: bounded to one recording, so a read taken
    // in an earlier app can never be edited in place by this command.
    this.selectionCapturePromise = null;
  }

  setAssistantSelectionContext(context) {
    this.assistantSelectionContext = normalizeAgentSelectionContext(context);
    if (this.assistantSelectionContext) this.selectionCapturePromise = null;
  }

  consumeAssistantSelectionContext() {
    const context = this.assistantSelectionContext;
    this.assistantSelectionContext = null;
    return context;
  }

  setTranslationRequested(requested) {
    this.translationRequested = requested;
    this.translationApplied = false;
  }

  // In translation mode the STT hint is the configured source language, not
  // the UI-wide preferred language; "auto" keeps whisper auto-detection.
  getEffectiveSttLanguage(settings) {
    if (this.translationRequested) {
      return settings.translationSourceLanguage || "auto";
    }
    return settings.preferredLanguage;
  }

  // Kicked off at voice-agent recording start (so the screenshot reflects the
  // invocation moment) and consumed after transcription by the reasoning route.
  beginScreenContextCapture() {
    this.screenContextPromise = window.electronAPI?.captureScreenContext?.() ?? null;
  }

  // Kicked off at voice-agent recording start, alongside the screenshot, so the
  // read resolves while the user is still speaking. The editable-caret probe
  // only matters when auto-paste could deliver to that caret, so the flag
  // spares the main process a binary spawn otherwise.
  beginSelectionCapture() {
    this.selectionCapturePromise =
      window.electronAPI?.captureSelectedText?.({
        probeEditable: Boolean(this.settings().autoPasteEnabled),
      }) ?? null;
    // Marks the stored promise handled without consuming it: a failure nobody is
    // awaiting yet must not surface as an unhandled rejection, and the awaiting
    // caller must still see the original error.
    this.selectionCapturePromise?.catch(() => {});
  }

  _ownedSessionContext() {
    const context = this._sessionContext;
    return context && !context.released && context.sessionId === this._activeSession?.id
      ? context
      : null;
  }

  consumeSelectionCapture() {
    const pending = this.selectionCapturePromise;
    this.selectionCapturePromise = null;
    const context = this._ownedSessionContext();
    const original = context?.selection();
    if (original) return original;
    if (context?.restored) return Promise.resolve({ status: "none" });
    const read =
      pending ??
      window.electronAPI?.captureSelectedText?.({
        probeEditable: Boolean(this.settings().autoPasteEnabled),
      });
    return context ? context.adoptSelection(read) : read;
  }

  async consumeScreenContext() {
    const pending = this._ownedSessionContext()?.screen() ?? this.screenContextPromise;
    this.screenContextPromise = null;
    if (!pending) return null;
    try {
      // Capture resolves in well under a second; the race only protects the
      // paste path if the IPC ever hangs.
      const image = await Promise.race([
        pending,
        new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      if (!image) logger.logReasoning("SCREEN_CONTEXT_UNAVAILABLE", {});
      return image;
    } catch {
      return null;
    }
  }

  // An agent-route failure pastes the spoken command verbatim into the focused
  // app — surface that. Cleanup failures stay quiet; raw text is a fine result.
  _notifyAgentReasoningFailed() {
    this.onError?.({
      code: "AGENT_REASONING_FAILED",
      title: "Agent Unavailable",
      messageKey: "hooks.audioRecording.errorDescriptions.agentReasoningFailed",
    });
  }

  // The command still ran, so this is a downgrade notice rather than a failure.
  _notifyScreenContextSkipped() {
    this.onError?.({
      code: "SCREEN_CONTEXT_SKIPPED",
      title: "Screen Context Skipped",
      messageKey: "hooks.audioRecording.errorDescriptions.screenContextSkipped",
      variant: "default",
    });
  }

  createDictationSession(intents = {}) {
    const live = getSettings();
    return captureDictationSession({
      settings: live,
      private: this._recordingPrivate === true,
      intents: {
        voiceAgentRequested: this.voiceAgentRequested,
        translationRequested: this.translationRequested,
        assistantSelectionContext: this.assistantSelectionContext ?? null,
        ...intents,
      },
      agentName:
        typeof window !== "undefined" && window.localStorage ? getAgentName() : "OpenWhispr",
    });
  }

  getOrCreatePressCandidate(intents = {}, { newPress = false, recording } = {}) {
    const key = JSON.stringify({
      voiceAgentRequested: Boolean(intents.voiceAgentRequested),
      translationRequested: Boolean(intents.translationRequested),
      streaming: Boolean(intents.streaming),
      streamingProviderName: intents.streamingProviderName ?? null,
    });
    const prior = this._pressCandidate;
    // The main prepare notification and the renderer start notification for
    // one press share a candidate. A new press always replaces the pending
    // candidate; an older visual-frame continuation cannot start it.
    if (!newPress && prior?.key === key) return prior.session;
    if (prior) this.cancelPreparedMicCapture(prior.session);
    this._captureRecordingPrivacy?.(recording); // capture once, in the immutable session
    const session = this.createDictationSession(intents);
    const generation = (this._pressCandidateGeneration ?? 0) + 1;
    this._pressCandidateGeneration = generation;
    this._pressCandidate = { key, session, generation };
    return session;
  }

  releasePressCandidate(session) {
    // A delayed cancel/failure owns only the exact press it captured. It
    // cannot clear a later candidate that happens to have the same intents.
    if (!session || this._pressCandidate?.session !== session) return false;
    this._pressCandidate = null;
    if (this._pressReadsSession === session && this._activeSession !== session) {
      this._pressReadsSession = null;
      this.selectionCapturePromise = null;
      this.screenContextPromise = null;
    }
    return true;
  }

  beginDictationSession(intents = {}, candidate = null) {
    // Start paths pass the candidate captured before their first await.
    this._activeSession = candidate ?? this.createDictationSession(intents);
    this._disclosure?.dispose();
    this._disclosure = createDisclosureTracker({ session: this._activeSession });
    this.voiceAgentRequested = this._activeSession.intents.voiceAgentRequested;
    this.translationRequested = this._activeSession.intents.translationRequested;
    this.assistantSelectionContext = this._activeSession.intents.assistantSelectionContext;
    if (this._pressCandidate?.session === this._activeSession) this._pressCandidate = null;
    if (this._preparedCaptureCandidate === this._activeSession)
      this._preparedCaptureCandidate = null;
    // The hook requested both reads at press time (useAudioRecording.js:170-179), before this start.
    this._sessionContext?.release();
    this._sessionContext = createSessionContext({
      sessionId: this._activeSession.id,
      selection: this.selectionCapturePromise,
      screen: this.screenContextPromise,
    });
    return this._activeSession;
  }

  get activeSession() {
    return this._activeSession ?? null;
  }

  /** Routing reads go through here: live settings pinned to the active session. */
  settings() {
    return sessionSettings(this._activeSession ?? null, getSettings());
  }

  /** Undo's entry point (Task 8): the session, its intents and the reads it took at press time. */
  applySessionIntents(session, { context = null, tracker = null } = {}) {
    this._activeSession = session;
    if (this._disclosure && this._disclosure !== tracker) this._disclosure.dispose();
    this._disclosure = tracker ?? createDisclosureTracker({ session });
    this.selectionCapturePromise = null;
    this.screenContextPromise = null;
    this.voiceAgentRequested = session.intents.voiceAgentRequested;
    this.translationRequested = session.intents.translationRequested;
    this.assistantSelectionContext = session.intents.assistantSelectionContext;
    if (this._sessionContext && this._sessionContext !== context) this._sessionContext.release();
    this._sessionContext =
      context?.sessionId === session.id && !context.released
        ? context
        : createSessionContext({ sessionId: session.id });
    // A restored session never reads the OS selection or the screen again.
    this._sessionContext.markRestored();
  }

  isPressCandidateAllowed(candidate) {
    return !hasUnknownSelectedEnterpriseRecipient(candidate);
  }

  _showUnknownRecipientBlockedStart() {
    this.onError?.({
      code: "recipientUnknown",
      messageKey: "voiceOverlay.errors.recipientUnknown",
    });
    return false;
  }

  _endDictationSession(session) {
    if (!session || this._activeSession !== session) return;
    this._activeSession = null;
    this._disclosure?.dispose();
    this._disclosure = null;
    this.selectionCapturePromise = null;
    this.screenContextPromise = null;
    this.assistantSelectionContext = null;
    if (this._pressReadsSession === session) this._pressReadsSession = null;
    if (this._sessionContext?.sessionId === session.id) {
      this._sessionContext.release();
      this._sessionContext = null;
    }
  }

  _detachSessionOperation() {
    const session = this._activeSession;
    const context =
      session && this._sessionContext?.sessionId === session.id ? this._sessionContext : null;
    if (context) this._sessionContext = null;
    const tracker = this._disclosure;
    this._disclosure = null;
    this._endDictationSession(session);
    return { session, context, tracker };
  }

  getDisclosure() {
    return this._disclosure?.get() ?? null;
  }

  getStreamingProvider() {
    return STREAMING_PROVIDERS[this.getStreamingProviderName()];
  }

  getStreamingProviderName() {
    const name =
      this._activeSession?.intents.streamingProviderName ??
      resolveStreamingProviderName({ settings: this.settings(), context: "dictation" });
    if (!STREAMING_PROVIDERS[name])
      throw new Error("The selected provider does not support streaming transcription.");
    return name;
  }

  async getAudioConstraints(forceDefaultMic = false, refreshSystemDefault = false, recording) {
    this.assertTrialContext(recording);
    const settings = getSettings();

    // All browser audio processing disabled to avoid OS-level side-effects.
    // AGC off: Chromium's AGC on Windows mutates the system mic volume via WASAPI (#476).
    // Echo cancellation and noise suppression off to avoid latency and speech distortion.
    // Stereo recording required — mono WebM breaks silence detection on Linux/PipeWire (#472).
    const noProcessing = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
    };

    if (
      !forceDefaultMic &&
      !refreshSystemDefault &&
      this.cachedMicDeviceId &&
      this.cachedMicDeviceId !== this.rejectedMicDeviceId
    ) {
      return {
        audio: { deviceId: { exact: this.cachedMicDeviceId }, ...noProcessing },
      };
    }

    try {
      const resolution = await resolvePreferredMicrophone({
        settings,
        forceSystemDefault: forceDefaultMic,
        refreshSystemDefault: forceDefaultMic || refreshSystemDefault,
      });
      this.assertTrialContext(recording);
      const deviceId = resolution.device?.deviceId;

      if (deviceId && deviceId !== this.rejectedMicDeviceId) {
        if (isCacheableMicrophoneResolution(resolution)) {
          this.cachedMicDeviceId = deviceId;
        }
        logger.debug(
          "Resolved microphone input",
          {
            mode: resolution.mode,
            status: resolution.status,
            label: resolution.device.label,
          },
          "audio"
        );
        return { audio: { deviceId: { exact: deviceId }, ...noProcessing } };
      }

      logger.debug(
        "Microphone selection could not be pinned; using browser fallback",
        { mode: resolution.mode, status: resolution.status },
        "audio"
      );
    } catch (error) {
      if (error.code === "TRIAL_CONTEXT_CHANGED") throw error;
      logger.debug(
        "Failed to resolve microphone selection; using browser fallback",
        { error: error.message },
        "audio"
      );
    }

    return { audio: noProcessing };
  }

  async cacheMicrophoneDeviceId() {
    if (this.cachedMicDeviceId) return; // Already cached

    try {
      const resolution = await resolvePreferredMicrophone({ settings: getSettings() });
      if (isCacheableMicrophoneResolution(resolution)) {
        this.cachedMicDeviceId = resolution.device.deviceId;
        logger.debug(
          "Microphone device ID pre-cached",
          { mode: resolution.mode, status: resolution.status },
          "audio"
        );
      }
    } catch (error) {
      logger.debug("Failed to pre-cache microphone device ID", { error: error.message }, "audio");
    }
  }

  // Open the mic the moment a dictation is likely (push-to-talk key-down,
  // toggle press) and hand the same stream — plus everything its pre-roll
  // recorder already captured — to the real recording. Replaces the one-shot
  // warmupMicDriver (#845): a raced warm-up never resolved before the
  // recording's own open, so it only ever added a concurrent double open.
  async prepareMicCapture({ candidate = null, recording } = {}) {
    // Preparing opens the device, so it answers to the same policy as the
    // recording it anticipates — otherwise a blocked user's key-down would
    // still light the mic and buffer pre-roll.

    // A start already awaiting the mic open leaves isRecording false for as long
    // as that open takes, so without this guard a second prepare would open the
    // device again and buffer a pre-roll no recording ever answers.
    if (
      this._startInProgress ||
      this.isRecording ||
      this.isProcessing ||
      this.isStreaming ||
      this._streamingStopPromise ||
      this.mediaRecorder?.state === "recording"
    ) {
      return null;
    }
    if (candidate && this._pressCandidate?.session !== candidate) return null;
    candidate ??= this.getOrCreatePressCandidate({ streaming: this.shouldUseStreaming() });
    this._preparedCaptureCandidate = candidate;
    if (hasUnknownSelectedEnterpriseRecipient(candidate)) {
      if (this._preparedCaptureCandidate === candidate) this._preparedCaptureCandidate = null;
      this.releasePressCandidate(candidate);
      this._showUnknownRecipientBlockedStart();
      return null;
    }
    // Plan 07: a sealed pre-flight refusal never opens the device. The start
    // that follows reports it.
    if (this._sealedPreflight(candidate)) {
      if (this._preparedCaptureCandidate === candidate) this._preparedCaptureCandidate = null;
      return null;
    }
    try {
      const prepared = await this.preparedMicCapture.prepare(async () => {
        // Built before the mic opens so its graph is rendering by the time the
        // pre-roll recorder starts; a tap attached later misses the first frames.
        const pcmTap = this._startPcmTap(candidate.settings);
        try {
          this.assertTrialContext(recording);
          const constraints = await this.getAudioConstraints(false, false, recording);
          this.assertTrialContext(recording);
          const stream = await this._acquireCaptureStream(constraints, recording);
          try {
            this.assertTrialContext(recording);
          } catch (error) {
            stream.getTracks().forEach((track) => track.stop());
            throw error;
          }
          const value = {
            candidate,
            stream,
            constraints,
            recorder: null,
            chunks: [],
            pcmTap: null,
            startedAt: Date.now(),
          };
          if (!candidate.intents.streaming) this._startPreRollRecorder(value, pcmTap);
          if (!value.pcmTap) pcmTap?.close();
          return value;
        } catch (error) {
          pcmTap?.close();
          throw error;
        }
      });
      if (prepared) {
        logger.debug("Microphone capture prepared", { preRoll: !!prepared.recorder }, "audio");
      }
      return prepared;
    } catch (e) {
      if (this._preparedCaptureCandidate === candidate) this._preparedCaptureCandidate = null;
      this.releasePressCandidate(candidate);
      logger.debug("Mic capture preparation failed (non-critical)", { error: e.message }, "audio");
      return null;
    }
  }

  cancelPreparedMicCapture(candidate = null) {
    const owned =
      candidate ?? this._preparedCaptureCandidate ?? this._pressCandidate?.session ?? null;
    if (
      candidate &&
      this._preparedCaptureCandidate &&
      this._preparedCaptureCandidate !== candidate
    ) {
      this.releasePressCandidate(candidate);
      return;
    }
    this.preparedMicCapture?.cancel();
    if (this._preparedCaptureCandidate === owned) this._preparedCaptureCandidate = null;
    this.releasePressCandidate(owned);
  }

  // Tells the main process whether this renderer is holding the mic open outside
  // a recording — an idle hold or a prepared capture. Recordings are gated by
  // setUserRecording instead. Without this the device-global macOS/Linux mic
  // signal reports our own capture as a meeting.
  _syncMicOpenGate() {
    const open = this.micStreamHold.active || this.preparedMicCapture.active;
    if (open === this._micOpenReported) return;
    this._micOpenReported = open;
    window.electronAPI?.micWarmHoldChanged?.(open);
  }

  _disposePrepared(prepared) {
    if (!prepared) return;
    disposePreparedCapture(prepared);
    this._markCaptureStreamReleased();
  }

  // Record from the instant the prepared stream delivers frames. If the hold
  // guard confirms a real dictation these chunks become the recording's opening;
  // a cancel discards them without the audio ever leaving the renderer.
  _startPreRollRecorder(prepared, pcmTap) {
    try {
      const recorder = new MediaRecorder(prepared.stream);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) prepared.chunks.push(event.data);
      };
      recorder.start(RECORDING_TIMESLICE_MS);
      pcmTap?.attach(prepared.stream);
      prepared.recorder = recorder;
      prepared.pcmTap = pcmTap;
    } catch (e) {
      logger.debug("Pre-roll recorder unavailable", { error: e.message }, "audio");
    }
  }

  // Offline local engines decode a renderer-captured 16 kHz WAV as-is, so the
  // batch recorder gets a PCM shadow (PcmTap). Online models commit their own
  // stream and every cloud lane wants the smaller WebM, so those get none.
  _startPcmTap(settings = this.settings()) {
    const { useLocalWhisper, localTranscriptionProvider, parakeetModel } = settings;
    const offlineLocal =
      useLocalWhisper &&
      !(localTranscriptionProvider === "nvidia" && isOnlineParakeetModel(parakeetModel));
    if (!offlineLocal) return null;
    try {
      return new PcmTap(this.getWorkletBlobUrl());
    } catch (e) {
      logger.debug("PCM tap unavailable", { error: e.message }, "audio");
      return null;
    }
  }

  _closeBatchPcmTap() {
    this._batchPcmTap?.close();
    this._batchPcmTap = null;
  }

  _constraintsKey(constraints) {
    return JSON.stringify(constraints?.audio ?? constraints ?? {});
  }

  _stampMicWarm() {
    this._micWarmedAt = Date.now();
  }

  // Every capture-stream release funnels through here: the driver was
  // demonstrably open, so stamp warmth (a free warm window for the next open,
  // replacing #1284's post-transcription re-warm and its extra device open)
  // and restart the idle-hold countdown.
  _markCaptureStreamReleased() {
    this._stampMicWarm();
    this.micStreamHold.touch();
  }

  async _acquireCaptureStream(constraints, recording) {
    this.assertTrialContext(recording);
    const key = this._constraintsKey(constraints);
    const held = this.micStreamHold.acquireClone(key);
    if (held) {
      this._stampMicWarm();
      return held;
    }
    const stream = await this.acquireHealthyMicStream(
      await navigator.mediaDevices.getUserMedia(constraints),
      constraints,
      recording
    );
    this._stampMicWarm();
    return this.micStreamHold.adoptAndClone(stream, key);
  }

  // TTL-gated warm-up used only by the streaming-connection warm-up. The
  // recording paths never warm-then-discard — they open once via
  // prepareMicCapture and keep the stream. A stream resolving past the deadline
  // still stamps warmth: the driver did come up, which is exactly what the
  // slowest machines need recorded (#845).
  async _warmMicDriverIfCold(logCategory) {
    // A held master already has the driver up; opening a second device to prove
    // it is the concurrent double open this replaced.
    if (this.micStreamHold.active) {
      this._stampMicWarm();
      return;
    }
    if (isMicWarm(this._micWarmedAt, Date.now())) return;
    try {
      const constraints = await this.getAudioConstraints();
      const streamPromise = navigator.mediaDevices.getUserMedia(constraints);
      streamPromise
        .then((stream) => {
          stream.getTracks().forEach((track) => track.stop());
          this._stampMicWarm();
        })
        .catch(() => {});
      let timer = null;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("mic warmup timed out")),
          WARMUP_ACQUIRE_TIMEOUT_MS
        );
      });
      try {
        await Promise.race([streamPromise, deadline]);
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
      logger.debug("Microphone driver pre-warmed", {}, logCategory);
    } catch (e) {
      logger.debug("Mic driver warmup failed (non-critical)", { error: e.message }, logCategory);
    }
  }

  // Recovers a dead/muted capture: retries the same device, then hops to the OS default,
  // remembering a silent pinned device for the session. Throws MicUnusableError when no
  // input delivers audio. See #1152.
  async acquireHealthyMicStream(rawStream, constraints, recording) {
    try {
      this.assertTrialContext(recording);
    } catch (error) {
      rawStream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    const pinnedMicDeviceId = constraints.audio?.deviceId?.exact ?? null;
    let fallbackMicUnusable = false;
    // Keep verifying after a rejection too, otherwise a muted default records silence unnoticed.
    const verifyMic = pinnedMicDeviceId !== null || this.rejectedMicDeviceId !== null;
    const stream = await reacquireIfDead(
      rawStream,
      () => {
        this.cachedMicDeviceId = null;
        return this.getAudioConstraints(false, false, recording);
      },
      logger,
      verifyMic
        ? {
            getConstraints: () => {
              if (recording?.expectedTrialContext)
                throw Object.assign(new Error("The selected microphone is unavailable."), {
                  code: "TRIAL_MICROPHONE_CHANGED",
                });
              return this.getAudioConstraints(true, false, recording);
            },
            onDeviceRejected: () => {
              if (pinnedMicDeviceId) this.rejectedMicDeviceId = pinnedMicDeviceId;
            },
            onFallbackUnusable: () => {
              fallbackMicUnusable = true;
            },
          }
        : null
    );

    if (fallbackMicUnusable) {
      stream.getTracks().forEach((track) => track.stop());
      const micError = new Error("No microphone is delivering audio");
      micError.name = "MicUnusableError";
      throw micError;
    }

    return stream;
  }

  async startRecording(
    forceDefaultMic = false,
    candidate = null,
    onboardingTake = undefined,
    recording = { private: candidate?.private ?? this._privateSession === true }
  ) {
    if (
      this.isRecording ||
      this.isProcessing ||
      this.isStreaming ||
      this._startInProgress ||
      this._streamingStopPromise ||
      this.mediaRecorder?.state === "recording"
    )
      return false;
    candidate ??= this.getOrCreatePressCandidate({ streaming: false });
    if (hasUnknownSelectedEnterpriseRecipient(candidate)) {
      this.cancelPreparedMicCapture(candidate);
      return this._showUnknownRecipientBlockedStart();
    }
    if (this._pressCandidate?.session !== candidate) return false;
    // Plan 07 pre-flight, before the microphone is prepared or opened.
    const sealedRefusal = this._sealedPreflight(candidate);
    if (sealedRefusal) return this._refuseSealedStart(candidate, sealedRefusal);
    if (this._undo?.peek()) void this._undo.expireNow();
    let prepared = null;
    let preparedAdopted = false;
    recording.sessionId = candidate.id;
    recording.private = candidate.private;
    this._onboardingTake = onboardingTake;
    this._recordingContext = recording;
    let freshTap = null;
    this._startInProgress = true;
    try {
      if (
        this.isRecording ||
        this.isProcessing ||
        this.isStreaming ||
        this._streamingStopPromise ||
        this.mediaRecorder?.state === "recording"
      ) {
        return false;
      }

      this.assertTrialContext(recording);
      const startRequestedAt = performance.now();
      prepared = forceDefaultMic ? null : await this.preparedMicCapture.take();
      const constraints =
        prepared?.constraints ??
        (await this.getAudioConstraints(forceDefaultMic, false, recording));
      this.assertTrialContext(recording);
      // Without a prepared capture the tap starts here, before the mic opens.
      freshTap = prepared ? null : this._startPcmTap(candidate.settings);
      const micStream =
        prepared?.stream ?? (await this._acquireCaptureStream(constraints, recording));
      try {
        this.assertTrialContext(recording);
      } catch (error) {
        micStream.getTracks().forEach((track) => track.stop());
        throw error;
      }
      const micReadyAt = performance.now();
      if (this._pressCandidate?.session !== candidate) {
        micStream.getTracks().forEach((track) => track.stop());
        this._disposePrepared(prepared);
        freshTap?.close();
        return false;
      }

      const audioTrack = micStream.getAudioTracks()[0];
      if (recording.trialContext && !forceDefaultMic) {
        const selected = getSettings();
        const actualId = audioTrack?.getSettings?.().deviceId;
        if (
          selected.microphoneSelectionMode === "specific" &&
          selected.selectedMicDeviceId &&
          actualId &&
          actualId !== selected.selectedMicDeviceId
        ) {
          micStream.getTracks().forEach((track) => track.stop());
          throw Object.assign(new Error("The selected microphone is unavailable."), {
            code: "TRIAL_MICROPHONE_CHANGED",
          });
        }
      }
      if (forceDefaultMic && onboardingTake) onboardingTake.context = undefined;

      if (audioTrack) {
        const settings = audioTrack.getSettings();
        logger.info(
          "Recording started with microphone",
          {
            label: audioTrack.label,
            deviceId: settings.deviceId?.slice(0, 20) + "...",
            sampleRate: settings.sampleRate,
            channelCount: settings.channelCount,
            muted: audioTrack.muted,
            readyState: audioTrack.readyState,
          },
          "audio"
        );
      }

      try {
        this._silenceCtx = new AudioContext();
        if (this._silenceCtx.state === "suspended") {
          // Not awaited — resume() can hang when the output device is wedged.
          this._silenceCtx.resume().catch(() => {});
        }
        this._silenceAnalyser = this._silenceCtx.createAnalyser();
        this._silenceAnalyser.fftSize = 2048;
        this._silenceSource = this._silenceCtx.createMediaStreamSource(micStream);
        this._silenceSource.connect(this._silenceAnalyser);
        this._localSpeechGateState = createLocalSpeechGateState();
        const dataArray = new Uint8Array(this._silenceAnalyser.fftSize);
        this._silenceInterval = setInterval(() => {
          // A stalled context reads flat silence; recording no windows fails the gate open.
          if (this._silenceCtx?.state !== "running") return;
          this._silenceAnalyser.getByteTimeDomainData(dataArray);
          let sum = 0;
          let peak = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const v = (dataArray[i] - 128) / 128;
            sum += v * v;
            const abs = Math.abs(v);
            if (abs > peak) peak = abs;
          }
          const rms = Math.sqrt(sum / dataArray.length);
          recordLocalSpeechWindow(this._localSpeechGateState, rms, peak);
        }, 100);
      } catch (e) {
        logger.warn("Audio level gate setup failed, skipping", { error: e.message }, "audio");
        this._localSpeechGateState = null;
      }

      this.audioChunks = [];
      this._batchSegments = [];
      this._closeBatchPcmTap();
      this._stopRequestedDuringMicRecovery = false;
      this._cancelRequestedDuringMicRecovery = false;
      this._receivedAudioData = false;
      const preRollUsable =
        prepared?.recorder?.state === "recording" &&
        Date.now() - prepared.startedAt <= PRE_ROLL_MAX_AGE_MS;
      if (!preRollUsable) discardPreRoll(prepared);
      const preRoll = preRollUsable
        ? { recorder: prepared.recorder, chunks: prepared.chunks }
        : null;
      // Pre-roll audio is part of the recording, so the reported duration
      // starts when the prepared stream started — but only when its recorder
      // was adopted; a prepared stream without pre-roll contributes no audio
      // before this point, and back-dating would inflate durationSeconds.
      this.recordingStartTime = preRoll ? prepared.startedAt : Date.now();
      // The tap shadows the recorder from its first frame: the pre-roll's own,
      // or the one built before the mic opened. A tap started now would miss
      // the opening, so an unusable pre-roll leaves the WebM path in charge.
      this._batchPcmTap = preRoll ? prepared.pcmTap : freshTap;
      this._onboardingTake = onboardingTake;
      this.createBatchRecorder(micStream, preRoll, onboardingTake, recording);
      freshTap?.attach(micStream);
      preparedAdopted = true;
      this.beginDictationSession({}, candidate);
      this._captureRecordingPrivacy(recording);
      this.isRecording = true;
      this.onStateChange?.(
        {
          isRecording: true,
          isProcessing: false,
          micCaptureStatus: "active",
        },
        onboardingTake,
        recording
      );
      logger.info(
        "Recording start timing",
        {
          micReadyMs: Math.round(micReadyAt - startRequestedAt),
          totalMs: Math.round(performance.now() - startRequestedAt),
          usedPreparedCapture: !!prepared,
          preparedAgeMs: prepared?.startedAt ? Date.now() - prepared.startedAt : 0,
        },
        "audio"
      );

      const {
        showTranscriptionPreview,
        useLocalWhisper,
        localTranscriptionProvider,
        whisperModel,
        parakeetModel,
        cohereModel,
      } = this.settings();
      const isNvidia = localTranscriptionProvider === "nvidia";
      // Online models stream+commit during capture, so PCM runs even with preview off.
      const streamingCommit = useLocalWhisper && isNvidia && isOnlineParakeetModel(parakeetModel);
      this._streamingCommitActive = false;
      if (useLocalWhisper && (showTranscriptionPreview || streamingCommit)) {
        try {
          this._previewAudioContext = new AudioContext({ sampleRate: 16000 });
          this._previewSource = this._previewAudioContext.createMediaStreamSource(micStream);
          await this._previewAudioContext.audioWorklet.addModule(this.getWorkletBlobUrl());

          this._previewProcessor = new AudioWorkletNode(
            this._previewAudioContext,
            "pcm-streaming-processor"
          );
          this._previewProcessor.port.onmessage = (event) => {
            if (event.data === "flushed") {
              this._previewFlushResolve?.();
              return;
            }
            if (!recording.trialContext || trialContext(getSettings()) === recording.trialContext)
              window.electronAPI?.sendDictationPreviewAudio?.(event.data);
          };
          this._previewSource.connect(this._previewProcessor);

          const model = isNvidia
            ? parakeetModel
            : localTranscriptionProvider === "cohere"
              ? cohereModel
              : whisperModel;
          const language = getBaseLanguageCode(this.settings().preferredLanguage);
          this.assertTrialContext(recording);
          window.electronAPI?.startDictationPreview?.({
            provider: localTranscriptionProvider,
            model,
            language,
            display: shouldDisplayDictationPreview(
              showTranscriptionPreview,
              this.voiceAgentRequested
            ),
          });
          this._streamingCommitActive = streamingCommit;
        } catch (e) {
          logger.warn("Preview worklet setup failed", { error: e.message }, "audio");
        }
      }

      await this.beginMicRecovery(micStream);

      return true;
    } catch (error) {
      // A prepared value the recording never adopted still owns a live stream
      // (and possibly a pre-roll recorder); release it before any retry.
      freshTap?.close();
      if (prepared && !preparedAdopted) this._disposePrepared(prepared);
      if (isStaleDeviceError(error) && !forceDefaultMic && !recording.expectedTrialContext) {
        // Pinned mic is gone (Chromium rotates IDs / device unplugged). Retry once on the default mic. See #900.
        logger.warn("Pinned microphone unavailable, retrying on default mic", {}, "audio");
        this.cachedMicDeviceId = null;
        this._startInProgress = false;
        return this.startRecording(true, candidate, onboardingTake, recording);
      }

      let errorTitle = "Recording Error";
      let errorDescription = `Failed to access microphone: ${error.message}`;

      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        errorTitle = "Microphone Access Denied";
        errorDescription =
          "Please grant microphone permission in your system settings and try again.";
      } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        errorTitle = "No Microphone Found";
        errorDescription = "No microphone was detected. Please connect a microphone and try again.";
      } else if (error.name === "NotReadableError" || error.name === "TrackStartError") {
        errorTitle = "Microphone In Use";
        errorDescription =
          "The microphone is being used by another application. Please close other apps and try again.";
      } else if (error.name === "MicUnusableError") {
        errorTitle = "Microphone Muted";
        errorDescription =
          "Your microphones stayed muted and produced no audio. Please check your sound input settings and try again.";
      }

      this.onError?.(
        {
          title: errorTitle,
          description: errorDescription,
          code: typeof error.code === "string" ? error.code : undefined,
          name: error.name,
        },
        onboardingTake,
        recording
      );
      return false;
    } finally {
      this._startInProgress = false;
      if (this._activeSession !== candidate) this.cancelPreparedMicCapture(candidate);
    }
  }

  createBatchRecorder(
    micStream,
    adoption = null,
    onboardingTake = this._onboardingTake,
    recording = this._recordingContext ?? { private: this._recordingPrivate === true }
  ) {
    // Adopting the pre-roll recorder keeps every chunk captured since key-down:
    // rebinding the handlers below transfers ownership with no gap and no
    // re-encode, and the seeded chunks become the recording's opening.
    const recorder = adoption?.recorder ?? new MediaRecorder(micStream);
    const segmentChunks = adoption ? [...adoption.chunks] : [];
    if (segmentChunks.length > 0) {
      this._receivedAudioData = true;
      // The speech-gate analyser only attaches at recording start, so it never
      // measured these frames. Fail the gate open rather than let it discard a
      // short utterance spoken entirely in pre-roll (#845).
      this._localSpeechGateState = null;
    }
    this.mediaRecorder = recorder;
    this.audioChunks = segmentChunks;
    this.recordingMimeType = recorder.mimeType || "audio/webm";

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this._receivedAudioData = true;
        segmentChunks.push(event.data);
      }
    };

    recorder.onstop = async () => {
      const segment = new Blob(segmentChunks, { type: recorder.mimeType || "audio/webm" });
      segmentChunks.length = 0;
      const rotating = this._rotatingBatchRecorder === recorder;
      // The recorder also stops on its own when its mic track dies (the stream
      // goes inactive). While recovery is armed, treat that like a rotation:
      // bank the segment and keep the recording alive for the replacement mic.
      if (rotating || this.micRecovery.started) {
        if (segment.size > 0) this._batchSegments.push(segment);
        micStream.getTracks().forEach((track) => track.stop());
        this._markCaptureStreamReleased();
        if (rotating) {
          this._rotatingBatchRecorder = null;
          this._rotationResolve?.();
          this._rotationResolve = null;
        } else {
          void this.micRecovery.recover("recorder-stopped");
        }
        return;
      }

      micStream.getTracks().forEach((track) => track.stop());
      this._markCaptureStreamReleased();
      await this.finalizeBatchRecording(segment, onboardingTake, recording);
    };

    if (!adoption) recorder.start(RECORDING_TIMESLICE_MS);
    return recorder;
  }

  async finalizeBatchRecording(
    finalSegment,
    onboardingTake = this._onboardingTake,
    recording = this._recordingContext ?? { private: this._recordingPrivate === true }
  ) {
    const processingPipeline = this._startProcessingPipeline();
    processingPipeline.onboardingTake = onboardingTake;
    processingPipeline.recording = { ...recording };
    const wasCancelled = () => this._shouldAbandonProcessingPipeline(processingPipeline);
    this.micRecovery.stop();
    this.teardownSpeechGate();
    const previewStopPromise = this.cleanupPreview({
      showCleanup: this.shouldShowPreviewCleanupState(),
    });
    const rawWavPromise = this._batchPcmTap?.stop();
    this._batchPcmTap = null;
    this.isRecording = false;
    this.isProcessing = true;
    this.onStateChange?.(
      {
        isRecording: false,
        isProcessing: true,
        micCaptureStatus: "inactive",
      },
      onboardingTake
    );

    const segments = finalSegment ? [...this._batchSegments, finalSegment] : this._batchSegments;
    this._batchSegments = [];
    const segmentsCount = segments.filter((segment) => segment?.size > 0).length;
    const durationSeconds = this.recordingStartTime
      ? (Date.now() - this.recordingStartTime) / 1000
      : null;
    const analyticsOccurredAt = new Date(this.recordingStartTime || Date.now()).toISOString();
    this._sessionAudio = {
      session: this._activeSession,
      kind: "batch",
      segments: [...segments],
      mimeType: this.recordingMimeType,
      durationSeconds,
      analyticsOccurredAt,
    };
    let audioBlob = null;
    let salvagedRecording = false;
    try {
      audioBlob = await this.mergeRecordedSegments(segments, wasCancelled, recording);
    } catch (error) {
      if (wasCancelled()) {
        this._settleProcessingPipeline(processingPipeline);
        return;
      }
      logger.error("Failed to assemble recovered recording", { error: error.message }, "audio");
      if (recording.private) {
        // A concatenated container is retained for recovery only, never claimed
        // as a successful merge or silently transcribed as its largest segment.
        const original = new Blob(segments, { type: this.recordingMimeType || "audio/webm" });
        recording.audioBlob = original;
        processingPipeline.recording.originalSegments = recording.originalSegments;
        processingPipeline.recording.audioBlob = original;
        this._setOwnedAudio(original, {
          sessionId: recording.sessionId,
          private: recording.private,
        });
        recording.ownedAudio = this._ownedAudioSnapshot({
          sessionId: recording.sessionId,
          private: recording.private,
        });
        processingPipeline.recording.ownedAudio = recording.ownedAudio;

        this._settleProcessingPipeline(processingPipeline);
        this.onError?.(
          {
            title: "Transcription Error",
            description: error.message,
            code: "AUDIO_CONVERSION_FAILED",
          },
          onboardingTake,
          recording
        );
        return;
      }
      // Ordinary public recovery retains its existing best-effort salvage.
      audioBlob = this.getLargestRecordedSegment(segments);
      salvagedRecording = !!audioBlob;
    }
    if (wasCancelled()) {
      this._settleProcessingPipeline(processingPipeline);
      return;
    }
    audioBlob = audioBlob || new Blob([], { type: this.recordingMimeType || "audio/webm" });
    this._setOwnedAudio(audioBlob, { sessionId: recording.sessionId, private: recording.private });
    processingPipeline.recording.ownedAudio = this._ownedAudioSnapshot({
      sessionId: recording.sessionId,
      private: recording.private,
    });

    logger.info(
      "Recording stopped",
      {
        blobSize: audioBlob.size,
        blobType: audioBlob.type,
        segmentsCount,
      },
      "audio"
    );

    this.recordingStartTime = null;
    const recordingCheck = evaluateFinishedRecording({
      blobSize: audioBlob.size,
      receivedAudioData: this._receivedAudioData,
    });
    if (!recordingCheck.usable) {
      logger.info(
        "Dropping degenerate recording before transcription",
        {
          blobSize: audioBlob.size,
          reason: recordingCheck.reason,
          receivedAudioData: this._receivedAudioData,
        },
        "audio"
      );
      if (!this._settleProcessingPipeline(processingPipeline)) return;
      this._localSpeechGateState = null;
      this.onTranscriptionComplete?.(
        { success: true, text: "" },
        onboardingTake,
        processingPipeline.recording
      );
      if (recording.private) this.releasePrivateAudio(processingPipeline.recording.ownedAudio);
      return;
    }
    // Non-commit sessions stop concurrently with the decode below.
    const previewStop = this._streamingCommitActive ? await previewStopPromise : null;
    if (wasCancelled()) {
      this._settleProcessingPipeline(processingPipeline);
      return;
    }
    this._streamingCommitActive = false;
    const rawWav = await rawWavPromise;

    await this.processAudio(
      audioBlob,
      {
        durationSeconds,
        analyticsOccurredAt,
        ...(salvagedRecording ? { salvagedRecording: true } : {}),
        ...(previewStop?.streamed ? { streamedText: previewStop.text } : {}),
        ...(rawWav ? { rawWav } : {}),
      },
      processingPipeline
    );
  }

  async replaceBatchMic(replacement) {
    try {
      const recorder = this.mediaRecorder;
      if (!recorder) throw new Error("Batch recorder is no longer active");
      // An auto-stopped recorder (mic track died) already banked its segment in
      // onstop; only a live recorder needs the explicit rotation handshake.
      if (recorder.state === "recording") {
        await new Promise((resolve) => {
          this._rotatingBatchRecorder = recorder;
          this._rotationResolve = resolve;
          recorder.stop();
        });
      }
      if (!this.isRecording) throw new Error("Recording stopped during microphone recovery");

      this._silenceSource?.disconnect();
      if (this._silenceCtx && this._silenceAnalyser) {
        this._silenceSource = this._silenceCtx.createMediaStreamSource(replacement);
        this._silenceSource.connect(this._silenceAnalyser);
      }
      this._previewSource?.disconnect();
      if (this._previewAudioContext && this._previewProcessor) {
        this._previewSource = this._previewAudioContext.createMediaStreamSource(replacement);
        this._previewSource.connect(this._previewProcessor);
      }
      this._batchPcmTap?.attach(replacement);
      this.createBatchRecorder(replacement);
    } finally {
      // Honor a stop/cancel that arrived mid-rotation even when the swap failed —
      // dropping it would leave an unstoppable recording (isRecording stuck true).
      const cancelRequested = this._cancelRequestedDuringMicRecovery;
      const stopRequested = this._stopRequestedDuringMicRecovery;
      this._cancelRequestedDuringMicRecovery = false;
      this._stopRequestedDuringMicRecovery = false;
      if (cancelRequested) this.cancelRecording();
      else if (stopRequested) this.stopRecording();
    }
  }

  stopRecording() {
    this.micRecovery.stop();
    if (this._rotatingBatchRecorder) {
      this._stopRequestedDuringMicRecovery = true;
      return true;
    }
    if (this.mediaRecorder?.state === "recording") {
      this.mediaRecorder.stop();
      return true;
    }
    if (this.isRecording && !this.isStreaming) {
      // The mic died mid-recovery, so no live recorder exists; finalize what
      // was captured instead of leaving the recording unstoppable.
      void this.finalizeBatchRecording(null);
      return true;
    }
    return false;
  }

  teardownSpeechGate() {
    if (this._silenceInterval) {
      clearInterval(this._silenceInterval);
      this._silenceInterval = null;
    }
    this._silenceCtx?.close().catch(() => {});
    this._silenceCtx = null;
    this._silenceAnalyser = null;
    this._silenceSource = null;
    this._levelData = null;
  }

  // Live input level (RMS 0..~1) for the waveform, read from whichever
  // pipeline is recording: the batch speech-gate analyser or the streaming
  // path's analyser. Null (waveform rests) when neither is live.
  getRecordingAudioLevel() {
    const pair = this._silenceAnalyser
      ? { ctx: this._silenceCtx, analyser: this._silenceAnalyser }
      : this.streamingAnalyser
        ? { ctx: this.streamingAudioContext, analyser: this.streamingAnalyser }
        : null;
    if (!pair?.ctx) return null;
    if (pair.ctx.state === "suspended") {
      // A suspended context reads flat silence — nudge it awake (not awaited;
      // resume() can hang when the output device is wedged).
      pair.ctx.resume().catch(() => {});
      return null;
    }
    if (pair.ctx.state !== "running") return null;
    const analyser = pair.analyser;
    if (!this._levelData || this._levelData.length !== analyser.fftSize) {
      this._levelData = new Uint8Array(analyser.fftSize);
    }
    analyser.getByteTimeDomainData(this._levelData);
    let sum = 0;
    for (let i = 0; i < this._levelData.length; i++) {
      const v = (this._levelData[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this._levelData.length);
  }

  cancelRecording() {
    this._restoreGeneration = (this._restoreGeneration ?? 0) + 1;
    this._cancelAbandonedSegmentMerges();
    this.retireCapturedCleanup();
    this.micRecovery.stop();
    if (this._rotatingBatchRecorder) {
      this._cancelRequestedDuringMicRecovery = true;
      return true;
    }
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      const recorder = this.mediaRecorder;
      const snapshot = this.takeDiscardedBatchSnapshot();
      const buffer = this._bufferForSession("batch", snapshot);
      for (const segment of snapshot.segments) buffer.adoptBlob(segment, "segment");
      snapshot.segments.length = 0;
      // R2-C1: the open segment arrives with the recorder's final dataavailable, after this
      // method returns. Register it before the window opens, so Undo waits for it.
      const finalChunk = buffer.expect("segment");
      let settleFinal;
      const finalEvent = new Promise((resolve) => {
        settleFinal = resolve;
      });
      void this._trackRecordingWork(() => finalEvent);
      buffer.releaseSources = () => {
        snapshot.chunks.length = 0;
      };
      recorder.ondataavailable = (event) => {
        if (!buffer.isZeroed() && event.data?.size > 0) snapshot.chunks.push(event.data);
      };
      const deliverFinal = () => {
        finalChunk.deliver(new Blob(snapshot.chunks, { type: snapshot.mimeType }));
        snapshot.chunks.length = 0; // drop every reference to the Blob chunks
        settleFinal();
      };
      this.mediaRecorder.onstop = () => {
        recorder.stream?.getTracks().forEach((track) => track.stop());
        deliverFinal();
      };
      try {
        this.resetDiscardedBatchRecordingState();
        recorder.stop();
      } catch (error) {
        deliverFinal(); // a failed primitive cannot retain its event obligation
        this._openCancelled(buffer);
        throw error;
      }
      if (recorder.stream) {
        recorder.stream.getTracks().forEach((track) => track.stop());
        this._markCaptureStreamReleased();
      }
      this._openCancelled(buffer);
      return true;
    }

    if (this.isRecording && !this.isStreaming) {
      // The mic died mid-recovery, so no live recorder exists; discard what was
      // captured instead of leaving the recording uncancelable.
      this.discardBatchRecording();
      return true;
    }
    if (this._startInProgress) {
      this.onCancelledChange?.(null, undefined, this._onboardingTake);
      return true;
    }
    return false;
  }

  discardBatchRecording() {
    const snapshot = this.takeDiscardedBatchSnapshot();
    const buffer = this._bufferForSession("batch", snapshot);
    this.resetDiscardedBatchRecordingState();
    for (const segment of snapshot.segments) buffer.adoptBlob(segment, "segment");
    if (snapshot.chunks.length)
      buffer.adoptBlob(new Blob(snapshot.chunks, { type: snapshot.mimeType }), "segment");
    snapshot.segments.length = 0;
    snapshot.chunks.length = 0;
    this._openCancelled(buffer);
  }

  takeDiscardedBatchSnapshot() {
    return {
      private: this._recordingPrivate === true,
      durationSeconds: this.recordingStartTime
        ? (Date.now() - this.recordingStartTime) / 1000
        : null,
      analyticsOccurredAt: new Date(this.recordingStartTime || Date.now()).toISOString(),
      chunks: this.audioChunks,
      segments: this._batchSegments,
      mimeType: this.recordingMimeType,
    };
  }

  resetDiscardedBatchRecordingState() {
    this._endDictationSession(this._activeSession);
    this.teardownSpeechGate();
    this._localSpeechGateState = null;

    this.cleanupPreview({ dismiss: true });
    this._closeBatchPcmTap();
    this.isRecording = false;
    this.isProcessing = false;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this._batchSegments = [];
    this.recordingStartTime = null;
    this.onStateChange?.({ isRecording: false, isProcessing: false });
  }

  _startProcessingPipeline() {
    const session = this._activeSession ?? null;
    const pipeline = {
      session,
      // A9: the exact Plan 04 press-time context and tracker, captured before
      // any await; never rebuilt later from manager fields.
      context:
        session && this._sessionContext?.sessionId === session.id ? this._sessionContext : null,
      tracker: session ? (this._disclosure ?? null) : null,
      recoveryId: null,
      outcome: null,
      cancellationGeneration: this._processingCancellationGeneration ?? 0,
      onboardingTake: this._onboardingTake,
      recording: {
        ...(this._recordingContext ?? { private: this._recordingPrivate === true }),
        ownedAudio: this._ownedAudioSnapshot({
          sessionId: this._activeSession?.id,
          private: this._activeSession?.private ?? this._recordingPrivate,
        }),
        audioBlob: this.lastAudioBlob,
      },
    };
    this._activeProcessingPipeline = pipeline;
    this._cancelAbandonedSegmentMerges();
    return pipeline;
  }

  _shouldAbandonProcessingPipeline(pipeline) {
    return (
      pipeline.cancellationGeneration !== (this._processingCancellationGeneration ?? 0) ||
      this._activeProcessingPipeline !== pipeline
    );
  }

  _settleProcessingPipeline(pipeline) {
    if (this._activeProcessingPipeline !== pipeline) return false;
    this._activeProcessingPipeline = null;
    if (this._sessionAudio?.session === pipeline.session) this._dropSessionAudio();
    this._endDictationSession(pipeline.session);
    if (this.isProcessing) {
      this.isProcessing = false;
      this.onStateChange?.({ isRecording: false, isProcessing: false });
    }
    return true;
  }

  /**
   * Plan 07 replay: hands the exact session, context and tracker back to the
   * claimed recovery entry before ordinary settlement could release them.
   * Only for the replay's own pipeline and only while it is still the active
   * owner; a newer session is never detached.
   */
  _returnReplayOperation(pipeline) {
    if (
      pipeline?.recoveryId == null ||
      pipeline.recoveryDetached ||
      this._recoveryReplay !== pipeline.recoveryId ||
      !pipeline.session ||
      this._activeSession !== pipeline.session
    )
      return false;
    this._detachSessionOperation();
    pipeline.recoveryDetached = true;
    return true;
  }

  cancelProcessing() {
    this._restoreGeneration = (this._restoreGeneration ?? 0) + 1;
    this.retireCapturedCleanup();
    const replayPipeline = this._activeProcessingPipeline;
    if (
      this.isProcessing &&
      replayPipeline?.recoveryId != null &&
      this._recoveryReplay === replayPipeline.recoveryId
    ) {
      // A replay owns no ordinary Undo buffer: its claimed recovery entry is
      // the owner. Cancel the work, return the operation to that entry, and
      // let transcribeRecovered unclaim it for another try.
      this._processingCancellationGeneration = (this._processingCancellationGeneration ?? 0) + 1;
      this._requestStreamingCancellation();
      this._returnReplayOperation(replayPipeline);
      this._activeProcessingPipeline = null;
      this.isProcessing = false;
      this.onStateChange?.({ isRecording: false, isProcessing: false });
      window.electronAPI?.dismissDictationPreview?.();
      return true;
    }
    if (this.isProcessing) {
      this._processingCancellationGeneration = (this._processingCancellationGeneration ?? 0) + 1;
      this._requestStreamingCancellation();
      const provider = this.getStreamingProvider();
      const operation = this._streamingOperation;
      provider?.cancel?.(operation);
      this._holdStreamingSession();
      // Streaming finalization can be inside a provider or model await that
      // cannot be aborted. Keep the lifecycle truthfully busy until that await
      // observes the generation change and exits; advertising idle while the
      // stop promise still blocks a new recording makes hotkeys appear broken.
      if (this._streamingStopPromise) return true;

      const held = this._sessionAudio;
      if (this._activeSession && held?.kind === "batch" && held.session === this._activeSession) {
        const buffer = this._bufferForSession("batch", held);
        for (const segment of held.segments) buffer.adoptBlob(segment, "segment");
        held.segments.length = 0;
        this._openCancelled(buffer);
      }
      this._activeProcessingPipeline = null;
      this._endDictationSession(this._activeSession);
      this.isProcessing = false;
      this.onStateChange?.({ isRecording: false, isProcessing: false });
      // finalizeBatchRecording's earlier cleanupPreview() call (without
      // dismiss:true) already put the live-transcript panel in a "hold"
      // state — meant to keep showing the final/cleanup text, not close it.
      // onError used to be what actually closed the panel on a failure; the
      // processAudio cancel guard means onError never fires for a cancel, so
      // the close has to happen here instead, independent of onError. Only
      // reached when _streamingStopPromise was falsy above, i.e. never for a
      // streaming session (recording or finalizing) — its own preview
      // lifecycle is untouched by this call.
      window.electronAPI?.dismissDictationPreview?.();
      return true;
    }
    return false;
  }

  async processAudio(audioBlob, metadata = {}, processingPipeline = null) {
    return this._trackRecordingWork(async () => {
      const pipeline = processingPipeline ?? this._startProcessingPipeline();
      if (processingPipeline && this._activeProcessingPipeline !== processingPipeline) return;
      const onboardingTake = pipeline.onboardingTake;
      const recording = pipeline.recording;
      const wasCancelled = () => this._shouldAbandonProcessingPipeline(pipeline);
      if (!wasCancelled()) this.onProcessingStage?.("transcribing");
      const pipelineStart = performance.now();
      const settings = this.settings();
      let noAudioDetected = false;
      let retryHold = null;
      const speechGateDecision = getLocalSpeechGateDecision(this._localSpeechGateState);
      this._localSpeechGateState = null;

      const shouldUseStrongLocalWhisperGate =
        settings.useLocalWhisper && settings.localTranscriptionProvider === "whisper";
      if (
        speechGateDecision.skip &&
        (speechGateDecision.reason === "silence" || shouldUseStrongLocalWhisperGate)
      ) {
        logger.info(
          "Speech gate skipped transcription",
          {
            reason: speechGateDecision.reason,
            useLocalWhisper: settings.useLocalWhisper,
            localProvider: settings.localTranscriptionProvider,
            peakRms: speechGateDecision.peakRms?.toFixed(4),
            peakAmplitude: speechGateDecision.peakAmplitude?.toFixed(4),
            speechWindowCount: speechGateDecision.speechWindowCount,
            maxConsecutiveSpeechWindows: speechGateDecision.maxConsecutiveSpeechWindows,
          },
          "audio"
        );
        pipeline.outcome = "empty";
        this._returnReplayOperation(pipeline);
        if (!this._settleProcessingPipeline(pipeline)) return;
        this.onTranscriptionComplete?.({ success: true, text: "" }, onboardingTake, recording);
        if (recording.private) this.releasePrivateAudio(recording.ownedAudio);
        return;
      }

      try {
        this.assertTrialContext(recording);
        metadata = {
          ...metadata,
          private: recording.private === true,
          ...(recording.trialContext
            ? { assertTrialContext: () => this.assertTrialContext(recording) }
            : {}),
        };
        const useLocalWhisper = settings.useLocalWhisper;
        const localProvider = settings.localTranscriptionProvider;
        const whisperModel = settings.whisperModel;
        const parakeetModel = settings.parakeetModel || "parakeet-tdt-0.6b-v3";

        let result;
        let activeModel;
        if (useLocalWhisper) {
          if (isSherpaLocalProvider(localProvider)) {
            activeModel = localProvider === "cohere" ? settings.cohereModel : parakeetModel;
            result = await this.processWithLocalParakeet(
              audioBlob,
              activeModel,
              metadata,
              wasCancelled
            );
          } else {
            activeModel = whisperModel;
            result = await this.processWithLocalWhisper(
              audioBlob,
              whisperModel,
              metadata,
              wasCancelled
            );
          }
        } else {
          activeModel = this.getTranscriptionModel();
          result = await this.processWithOpenAIAPI(audioBlob, metadata, wasCancelled);
        }

        if (wasCancelled() || !this.isProcessing) {
          return;
        }

        this.lastAudioMetadata = {
          durationMs: metadata?.durationSeconds
            ? Math.round(metadata.durationSeconds * 1000)
            : Math.round(performance.now() - pipelineStart),
          provider: result?.source || (useLocalWhisper ? localProvider : "cloud"),
          model: activeModel || null,
        };

        recording.audioMetadata = this.lastAudioMetadata;

        // A salvaged WebM only matters to whoever decoded it; the tap's WAV spans
        // the whole recording.
        result = withSalvageWarning(result, metadata.salvagedRecording && !result?.decodedRawWav);

        result = {
          ...result,
          ...(metadata.analyticsOccurredAt
            ? { analyticsOccurredAt: metadata.analyticsOccurredAt }
            : {}),
          ...this._takePendingResultExtras(),
        };
        pipeline.outcome = result?.success && result?.text ? "success" : "empty";
        this.onTranscriptionComplete?.(result, onboardingTake, recording);

        const roundTripDurationMs = Math.round(performance.now() - pipelineStart);

        const timingData = {
          mode: useLocalWhisper ? `local-${localProvider}` : "cloud",
          model: activeModel,
          audioDurationMs: metadata.durationSeconds
            ? Math.round(metadata.durationSeconds * 1000)
            : null,
          reasoningProcessingDurationMs: result?.timings?.reasoningProcessingDurationMs ?? null,
          roundTripDurationMs,
          audioSizeBytes: audioBlob.size,
          audioFormat: audioBlob.type,
          outputTextLength: result?.text?.length,
        };

        if (useLocalWhisper) {
          timingData.audioConversionDurationMs = result?.timings?.audioConversionDurationMs ?? null;
        }
        timingData.transcriptionProcessingDurationMs =
          result?.timings?.transcriptionProcessingDurationMs ?? null;

        logger.info("Pipeline timing", timingData, "performance");
      } catch (error) {
        pipeline.outcome = "failed";
        const errorAtMs = Math.round(performance.now() - pipelineStart);

        if (wasCancelled()) {
          // The user cancelled mid-pipeline; the aborted request's rejection is
          // the expected outcome, not a failure to report or persist.
          logger.info("Transcription cancelled by user", { errorAtMs }, "performance");
          return;
        }

        const owned = this._ownedAudioSnapshot({
          sessionId: pipeline.session?.id,
          private: pipeline.session?.private,
        });
        logger.error(
          "Pipeline failed",
          {
            errorAtMs,
            error: error.message,
          },
          "performance"
        );

        if (error.code === DICTIONARY_ECHO_CODE) {
          // The transcript was discarded as an echo of the dictionary prompt.
          // Surface the shared soft no-audio outcome and keep the recording for
          // a manual retry — otherwise the whole utterance disappears with no
          // feedback (#1547).
          noAudioDetected = true;
          if (metadata.restoredFromCancel === true)
            retryHold = await this._recoverRestoredFailure(
              error,
              audioBlob,
              metadata,
              owned,
              wasCancelled
            );
          else if (owned.blob && pipeline.recoveryId == null)
            this.saveFailedTranscription(error.message, error.code, metadata, owned);
        } else if (error.message === "No audio detected") {
          noAudioDetected = true;
        } else if (isSealedModeError(error) && metadata.restoredFromCancel !== true) {
          // Plan 07 (A10): detach this pipeline's own session before any await,
          // save once, then show copy chosen from the saver's acknowledgement.
          await this._finishSealedFailure(error, {
            owned,
            metadata,
            session: pipeline.session,
            pipelineRecoveryId: pipeline.recoveryId,
          });
          this.onError?.(this._sealedFailureNotice(error), onboardingTake, recording);
        } else {
          this.onError?.(
            {
              title: error.selectionEditFatal ? "Selection Edit Failed" : "Transcription Error",
              description: error.selectionEditFatal
                ? error.message
                : `Transcription failed: ${error.message}`,
              code: error.code,
              messageKey: error.messageKey,
            },
            onboardingTake,
            recording
          );

          // Save failed transcription with audio so the user can retry later
          if (metadata.restoredFromCancel === true)
            retryHold = await this._recoverRestoredFailure(
              error,
              audioBlob,
              metadata,
              owned,
              wasCancelled
            );
          else if (owned.blob && pipeline.recoveryId == null)
            // A replay's audio already lives in its claimed hold.
            this.saveFailedTranscription(error.message, error.code || null, metadata, owned);
        }
      } finally {
        const shouldNotifyNoAudio =
          !wasCancelled() && noAudioDetected && this._activeProcessingPipeline === pipeline;
        this._returnReplayOperation(pipeline);
        this._settleProcessingPipeline(pipeline);
        if (retryHold) this._rehold(retryHold);
        // Every provider reports genuine silence through this one post-processing
        // outcome. The pill can now leave thinking before the error surface takes
        // ownership, instead of receiving an IPC event mid-pipeline.
        if (shouldNotifyNoAudio) this.onNoAudio?.(onboardingTake, recording);
        if (recording.private) this.releasePrivateAudio(recording.ownedAudio);
      }
    });
  }

  async processWithLocalWhisper(
    audioBlob,
    model = "base",
    metadata = {},
    wasCancelled = neverCancelled
  ) {
    const timings = {};

    try {
      // The PCM tap's WAV skips FFmpeg in the main process; the WebM stays the
      // fallback and is what history and any cloud retry receive.
      const source = metadata.rawWav ?? audioBlob;
      const arrayBuffer = await source.arrayBuffer();
      const language = getBaseLanguageCode(this.getEffectiveSttLanguage(this.settings()));
      const options = { model };
      if (language) {
        options.language = language;
      }

      // Add custom dictionary as initial prompt to help Whisper recognize specific words
      const customDictionaryPrompt = this.getCustomDictionaryPrompt();
      const dictionaryPrompt = this.getWhisperPrompt();
      if (dictionaryPrompt) {
        options.initialPrompt = dictionaryPrompt;
      }

      logger.debug(
        "Local transcription starting",
        {
          audioFormat: source.type,
          audioSizeBytes: source.size,
        },
        "performance"
      );

      const transcriptionStart = performance.now();
      metadata.assertTrialContext?.();
      let result = await window.electronAPI.transcribeLocalWhisper(arrayBuffer, options);
      timings.transcriptionProcessingDurationMs = Math.round(
        performance.now() - transcriptionStart
      );

      logger.debug(
        "Local transcription complete",
        {
          transcriptionProcessingDurationMs: timings.transcriptionProcessingDurationMs,
          success: result.success,
        },
        "performance"
      );

      if (result.success && result.text) {
        const strictDictionaryEcho = Boolean(
          dictionaryPrompt &&
          (matchesDictionaryPrompt(result.text, dictionaryPrompt) ||
            matchesDictionaryPrompt(result.text, customDictionaryPrompt))
        );
        const initialFragment = analyzeDictionaryPromptFragment(result.text, dictionaryPrompt);
        const dictionaryPromptFragment = !strictDictionaryEcho && initialFragment.isPromptFragment;
        // A non-repeated fragment can only be replaced by the sparse-recording rule
        // below, so on a short recording the retry would be decoded and then discarded.
        const retryCanBeAdopted =
          strictDictionaryEcho ||
          initialFragment.hasRepeatedWords ||
          (Number.isFinite(metadata.durationSeconds) &&
            metadata.durationSeconds >= MIN_SPARSE_RECORDING_DURATION_SECONDS);

        if ((strictDictionaryEcho || dictionaryPromptFragment) && retryCanBeAdopted) {
          // A prompt-free, VAD-free retry distinguishes real speech from Whisper
          // continuing either the whole dictionary prompt or a short fragment of it.
          const retryStart = performance.now();
          let retry = null;
          try {
            metadata.assertTrialContext?.();
            retry = await window.electronAPI.transcribeLocalWhisper(arrayBuffer, {
              model: options.model,
              ...(options.language ? { language: options.language } : {}),
              skipVad: true,
            });
          } catch (retryError) {
            if (strictDictionaryEcho) throw retryError;
            // A heuristic recovery is best-effort; keep the initial text if it fails.
            logger.warn(
              "Dictionary-fragment retry failed; keeping the initial transcript",
              { message: retryError?.message },
              "audio"
            );
          }

          const retryText = retry?.success && typeof retry.text === "string" ? retry.text : "";
          const hasRetryText = Boolean(retryText.trim());
          const retryFragment = analyzeDictionaryPromptFragment(retryText, dictionaryPrompt);
          const retryStrictDictionaryEcho = Boolean(
            hasRetryText &&
            (matchesDictionaryPrompt(retryText, dictionaryPrompt) ||
              matchesDictionaryPrompt(retryText, customDictionaryPrompt))
          );
          // On the strict path a short, dictionary-spelled retry is the recovered
          // dictation (#1454), not a second echo — only another full-prompt echo
          // disqualifies it. The fragment test applies to the heuristic path alone.
          const retryStillPromptLike = strictDictionaryEcho
            ? retryStrictDictionaryEcho
            : retryStrictDictionaryEcho || retryFragment.isPromptFragment;
          const retryAddsUniqueWords =
            retryFragment.uniqueWordCount > initialFragment.uniqueWordCount;
          const repeatedFragmentRecovered =
            initialFragment.hasRepeatedWords && retryAddsUniqueWords;
          // A non-repeated dictionary term or snippet is valid short-form
          // dictation unless a long recording yields substantially more content.
          const sparseRecordingRecovered =
            Number.isFinite(metadata.durationSeconds) &&
            metadata.durationSeconds >= MIN_SPARSE_RECORDING_DURATION_SECONDS &&
            retryFragment.uniqueWordCount >= initialFragment.uniqueWordCount + MIN_UNIQUE_WORD_GAIN;
          const recovered =
            hasRetryText &&
            !retryStillPromptLike &&
            (strictDictionaryEcho || repeatedFragmentRecovered || sparseRecordingRecovered);

          logger.info(
            "Local dictionary-prompt recovery attempt",
            {
              reason: strictDictionaryEcho ? "strict-echo" : "prompt-fragment",
              retryDurationMs: Math.round(performance.now() - retryStart),
              promptLength: dictionaryPrompt.length,
              initialTextLength: result.text.length,
              retryTextLength: retryText.length,
              recovered,
            },
            "audio"
          );

          timings.transcriptionProcessingDurationMs = Math.round(
            performance.now() - transcriptionStart
          );

          if (recovered) {
            result = retry;
          } else if (strictDictionaryEcho) {
            throw dictionaryEchoError();
          }
        }
        const rawText = result.text;
        const reasoningStart = performance.now();
        const text = await this.processTranscription(result.text, "local", wasCancelled);
        timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);

        if (text !== null && text !== undefined) {
          return {
            success: true,
            text: text || result.text,
            rawText,
            source: "local",
            timings,
            ...(metadata.rawWav ? { decodedRawWav: true } : {}),
          };
        } else {
          throw new Error("No text transcribed");
        }
      } else if (result.success === false && result.message === "No audio detected") {
        throw new Error("No audio detected");
      } else {
        throw new Error(result.message || result.error || "Local Whisper transcription failed");
      }
    } catch (error) {
      if (error.selectionEditFatal) {
        throw error;
      }
      if (error.message === "No audio detected") {
        throw error;
      }

      throw error;
    }
  }

  async processWithLocalParakeet(
    audioBlob,
    model = "parakeet-tdt-0.6b-v3",
    metadata = {},
    wasCancelled = neverCancelled
  ) {
    const timings = {};

    try {
      let result;
      const streamedText =
        typeof metadata.streamedText === "string" ? metadata.streamedText.trim() : null;
      // An empty stream is indistinguishable from silence; let the offline decode settle it.
      if (streamedText) {
        logger.debug("Parakeet using committed streaming transcript", { model }, "performance");
        timings.transcriptionProcessingDurationMs = 0;
        result = { success: true, text: streamedText };
      } else {
        const source = metadata.rawWav ?? audioBlob;
        const arrayBuffer = await source.arrayBuffer();

        logger.debug(
          "Parakeet transcription starting",
          {
            audioFormat: source.type,
            audioSizeBytes: source.size,
            model,
          },
          "performance"
        );

        const transcriptionStart = performance.now();
        metadata.assertTrialContext?.();
        result = await window.electronAPI.transcribeLocalParakeet(arrayBuffer, {
          model,
          language: getBaseLanguageCode(this.getEffectiveSttLanguage(this.settings())),
          private: metadata.private === true,
        });
        timings.transcriptionProcessingDurationMs = Math.round(
          performance.now() - transcriptionStart
        );

        logger.debug(
          "Parakeet transcription complete",
          {
            transcriptionProcessingDurationMs: timings.transcriptionProcessingDurationMs,
            success: result.success,
          },
          "performance"
        );
      }

      if (result.success && result.text) {
        const rawText = result.text;
        const reasoningStart = performance.now();
        const text = await this.processTranscription(result.text, "local-parakeet", wasCancelled);
        timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);

        if (text !== null && text !== undefined) {
          return {
            success: true,
            text: text || result.text,
            rawText,
            source: "local-parakeet",
            timings,
            ...(result.warning ? { warning: result.warning } : {}),
            ...(metadata.rawWav ? { decodedRawWav: true } : {}),
          };
        } else {
          throw new Error("No text transcribed");
        }
      } else if (result.success === false && result.message === "No audio detected") {
        throw new Error("No audio detected");
      } else {
        throw new Error(result.message || result.error || "Parakeet transcription failed");
      }
    } catch (error) {
      if (error.selectionEditFatal) {
        throw error;
      }
      if (error.message === "No audio detected") {
        throw error;
      }

      throw error;
    }
  }

  _dictationReasoningConfig(config = {}) {
    const session = this._activeSession;
    return session
      ? {
          ...config,
          correlationId: config.correlationId ?? session.id,
          dictationSessionId: config.dictationSessionId ?? session.id,
          dictationOperation: true,
        }
      : config;
  }

  _cleanupFailure(error, model, agentName, config, rawText) {
    const session = this._activeSession;
    if (!session) return cleanupFailureFromError(error);
    const capturedConfig = this._dictationReasoningConfig(config);
    // The snapshot is credential-free and detached from manager lifetime. A
    // default Retry may import UI/provider modules after the audio is idle.
    const retryConfig = Object.freeze({ ...capturedConfig, settingsView: session.settings });
    const retryCleanup = session
      ? async (words) => ReasoningService.processText(words, model, agentName, retryConfig)
      : undefined;
    return {
      ...cleanupFailureFromError(error),
      rawText,
      ...(retryCleanup ? { retryCleanup } : {}),
    };
  }

  async processWithReasoningModel(text, model, agentName, config) {
    logger.logReasoning("CALLING_REASONING_SERVICE", {
      model,
      agentName,
      textLength: text.length,
      hasOverrides: !!config,
    });

    config = this._dictationReasoningConfig(config);
    const startTime = Date.now();

    try {
      const result = await ReasoningService.processText(text, model, agentName, config);

      const processingTime = Date.now() - startTime;

      logger.logReasoning("REASONING_SERVICE_COMPLETE", {
        model,
        processingTimeMs: processingTime,
        resultLength: result.length,
        success: true,
      });

      return result;
    } catch (error) {
      const processingTime = Date.now() - startTime;

      logger.logReasoning("REASONING_SERVICE_ERROR", {
        model,
        processingTimeMs: processingTime,
        error: error.message,
        stack: error.stack,
      });

      // A screenshot the model or transport rejects must not cost the user
      // their command — rerun it text-only, swapping in the pre-built prompt
      // that never had the screen-context suffix. Rebuilding from scratch
      // would drop the selection-edit instructions and completion marker.
      // rawScreenContext/selectionEditReachable are routing-only keys (see
      // processAgentCommand) — keep the retry config clean of them too.
      if (config?.screenContext) {
        const {
          screenContext,
          rawScreenContext,
          selectionEditReachable,
          textOnlySystemPrompt,
          ...textOnlyConfig
        } = config;
        const result = await ReasoningService.processText(text, model, agentName, {
          ...textOnlyConfig,
          systemPrompt: textOnlySystemPrompt ?? dictationAgentPrompt(this.settings(), agentName),
        });
        this._notifyScreenContextSkipped();
        return result;
      }

      throw error;
    }
  }

  // Panel-first banking: the command streams into the assistant panel with
  // the chat's tools and memory once transcription completes; nothing types
  // at the cursor. The transcript flows back as the result text so history
  // and previews stay truthful.
  _bankAssistantDirective(transcript, config, options = {}) {
    if (!this.isProcessing) return;
    const { selectedContext, deliverySessionId } = options || {};
    this.pendingAssistantConversation = {
      transcript,
      // resolveReasoningRoute mirrors an attached screenContext into
      // rawScreenContext (same object), so the raw carry is the single source
      // to read — it also survives when this attach gate dropped the image
      // (the panel re-decides for its own request).
      screenContext: config?.rawScreenContext ?? null,
      ...(selectedContext ? { selectedContext } : {}),
      ...(deliverySessionId ? { deliverySessionId } : {}),
      ...(this._activeSession ? { operation: sessionOperation(this._activeSession) } : {}),
    };
  }

  // Consume the directives banked during reasoning so that exactly one
  // transcription result — batch or streaming — carries them.
  _takePendingResultExtras() {
    const extras = {
      ...(this._retainedCleanupOperation
        ? { cleanupOperationId: this._retainedCleanupOperation.identity.operationId }
        : {}),
      ...(this.pendingAssistantConversation
        ? { assistantConversation: this.pendingAssistantConversation }
        : {}),
      ...(this.pendingSelectionEdit ? { selectionEdit: this.pendingSelectionEdit } : {}),
      ...(this.pendingCleanupFailure ? { cleanupFailure: this.pendingCleanupFailure } : {}),
    };
    this.pendingAssistantConversation = null;
    this.pendingSelectionEdit = null;
    this.pendingCleanupFailure = null;
    return extras;
  }

  // Panel-first commands make no LLM call here — the panel resolves the Voice
  // Assistant scope itself; carry the command to the configured assistant.
  _bankPanelAgentCommand(
    text,
    agentName,
    config,
    { selectedContext, selectedText, deliverySessionId } = {}
  ) {
    const settings = this.settings();
    const command = this.voiceAgentRequested
      ? text
      : stripAgentAddress(
          text,
          agentName,
          config?.wakeWordLanguage ?? resolveWakeWordLanguage(settings),
          config?.snippets ?? settings.snippets
        );
    const transcript = selectedText === undefined ? command : `${command}\n\n"${selectedText}"`;
    this._bankAssistantDirective(transcript, config, { selectedContext, deliverySessionId });
    return text;
  }

  async processAgentCommand(text, model, agentName, config, wasCancelled = neverCancelled) {
    if (wasCancelled()) return text;
    const assistantSelectionContext = this.consumeAssistantSelectionContext();
    if (assistantSelectionContext) {
      // An in-panel selection is conversational context, not an editable OS
      // target. Keep it on the existing panel-first route and leave the
      // external selection replacement path completely untouched.
      this.selectionCapturePromise = null;
      return this._bankPanelAgentCommand(text, agentName, config, {
        selectedContext: assistantSelectionContext,
      });
    }

    let capture;
    try {
      capture = await this.consumeSelectionCapture();
    } catch (cause) {
      const error = new Error(
        `Selection edit could not safely read the selection: ${cause.message}`
      );
      error.code = "SELECTION_EDIT_CAPTURE_FAILED";
      error.messageKey = "hooks.audioRecording.selectionEditing.unavailable";
      error.selectionEditFatal = true;
      error.cause = cause;
      throw error;
    }
    if (wasCancelled()) return text;

    const captureDisposition = getSelectionCaptureDisposition(capture);
    const deliverySessionId =
      captureDisposition === "caret" && this.settings().autoPasteEnabled
        ? capture.sessionId
        : undefined;

    if (!config?.selectionEditReachable) {
      // No in-place editor: the panel never types, so only a readable
      // selection is quoted; every other capture sends the plain command.
      return this._bankPanelAgentCommand(text, agentName, config, {
        selectedText:
          captureDisposition === "selection" && typeof capture?.text === "string"
            ? capture.text
            : undefined,
        deliverySessionId,
      });
    }

    if (capture?.status === "too_large") {
      // A large selection definitely exists, so running the command as plain
      // agent dictation would paste over it — the one capture failure that
      // must not fall through.
      const error = new Error(
        `Selected text exceeds the ${capture.maxCharacters || 6000} character limit`
      );
      error.code = "SELECTION_EDIT_TOO_LARGE";
      error.messageKey = "hooks.audioRecording.selectionEditing.tooLarge";
      error.selectionEditFatal = true;
      throw error;
    }

    if (captureDisposition === "standalone" || captureDisposition === "caret") {
      return this._bankPanelAgentCommand(text, agentName, config, { deliverySessionId });
    }

    if (capture?.status !== "selected") {
      // A captured target changing, a synthetic-copy failure, or an unexpected
      // accessibility result is ambiguous: a normal agent paste could overwrite
      // unrelated selected text. Abort instead of falling through.
      const error = new Error("Selection edit could not safely verify the selected text");
      error.code = "SELECTION_EDIT_CAPTURE_FAILED";
      error.messageKey =
        captureDisposition === "changed"
          ? "hooks.audioRecording.selectionEditing.changed"
          : "hooks.audioRecording.selectionEditing.unavailable";
      error.selectionEditFatal = true;
      throw error;
    }

    // These are routing directives for this method, not reasoning options —
    // strip them before the config reaches ReasoningService.
    const { selectionEditReachable, rawScreenContext, wakeWordLanguage, ...reasoningOptions } =
      config ?? {};
    const selectionConfig = {
      ...reasoningOptions,
      maxTokens: Math.max(config?.maxTokens || 0, 8192),
      contextSize: Math.max(config?.contextSize || 0, 16384),
      temperature: config?.temperature ?? 0.2,
      requireCompleteOutput: true,
    };
    const completionMarker = `__LOQUI_SELECTION_COMPLETE_${crypto.randomUUID()}__`;
    selectionConfig.systemPrompt = buildSelectionEditSystemPrompt(
      config?.systemPrompt,
      completionMarker
    );
    if (selectionConfig.textOnlySystemPrompt) {
      // The text-only retry prompt must carry the same selection-edit
      // instructions and marker, or a rejected screenshot loses the command.
      selectionConfig.textOnlySystemPrompt = buildSelectionEditSystemPrompt(
        selectionConfig.textOnlySystemPrompt,
        completionMarker
      );
    }
    const userPrompt = buildSelectionEditUserPrompt(text, capture.text);

    try {
      const result = await this.processWithReasoningModel(
        userPrompt,
        model,
        agentName,
        selectionConfig
      );
      if (wasCancelled()) return text;
      const replacement = extractSelectionEditReplacement(result, completionMarker);
      this.pendingSelectionEdit = { sessionId: capture.sessionId };
      return replacement;
    } catch (cause) {
      const error = new Error(`Selection edit failed: ${cause.message}`);
      error.code = "SELECTION_EDIT_REASONING_FAILED";
      error.messageKey = "hooks.audioRecording.selectionEditing.reasoningFailed";
      error.selectionEditFatal = true;
      error.cause = cause;
      throw error;
    }
  }

  async isReasoningAvailable() {
    if (typeof window === "undefined") {
      return false;
    }

    const s = this.settings();
    const useReasoning =
      !!s.useCleanupModel || dictationAgentReachable(s) || translationChainReachable(s);
    const now = Date.now();
    const cacheValid =
      this.reasoningAvailabilityCache &&
      now < this.reasoningAvailabilityCache.expiresAt &&
      this.cachedReasoningPreference === useReasoning &&
      this._reasoningCacheSession === this._activeSession;

    if (cacheValid) {
      return this.reasoningAvailabilityCache.value;
    }

    logger.logReasoning("REASONING_STORAGE_CHECK", {
      useReasoning,
    });

    if (!useReasoning) {
      this.reasoningAvailabilityCache = {
        value: false,
        expiresAt: now + REASONING_CACHE_TTL,
      };
      this.cachedReasoningPreference = useReasoning;
      this._reasoningCacheSession = this._activeSession;
      return false;
    }

    try {
      const isAvailable = await ReasoningService.isAvailable(s);

      logger.logReasoning("REASONING_AVAILABILITY", {
        isAvailable,
        reasoningEnabled: useReasoning,
        finalDecision: useReasoning && isAvailable,
      });

      this.reasoningAvailabilityCache = {
        value: isAvailable,
        expiresAt: now + REASONING_CACHE_TTL,
      };
      this.cachedReasoningPreference = useReasoning;
      this._reasoningCacheSession = this._activeSession;

      return isAvailable;
    } catch (error) {
      logger.logReasoning("REASONING_AVAILABILITY_ERROR", {
        error: error.message,
        stack: error.stack,
      });

      this.reasoningAvailabilityCache = {
        value: false,
        expiresAt: now + REASONING_CACHE_TTL,
      };
      this.cachedReasoningPreference = useReasoning;
      this._reasoningCacheSession = this._activeSession;
      return false;
    }
  }

  // Cleanup-then-translate chain shared by batch, cloud, and streaming paths: Step 1
  // (optional cleanup) soft-fails to input; Step 2 translates unless source === target.
  async runTranslationChain({ text, settings, agentName, route, cleanup }) {
    const runCleanup = async (currentText) => {
      const cleanupModel = cleanup.model;
      if (cleanupModel) {
        return this.processWithReasoningModel(
          currentText,
          cleanupModel,
          agentName,
          route.cleanupConfig
        );
      }
      return null;
    };

    const runTranslate = async (currentText) =>
      this.processWithReasoningModel(currentText, route.model, agentName, route.config);

    try {
      const chainResult = await executeTranslationChain({
        text,
        cleanupReachable: route.cleanupReachable,
        cleanupIsCloud: false,
        runCleanup,
        runTranslate,
        shouldTranslate: shouldRunTranslateStep(
          settings.translationSourceLanguage,
          settings.translationTargetLanguage
        ),
        translateIsCloud: false,
        onCleanupError: (cleanupError) => {
          const { level = "error", channel, extra } = cleanup.log || {};
          logger[level](
            "Cleanup step failed in translation chain, translating raw transcript",
            { ...(extra || {}), error: cleanupError.message },
            channel
          );
          // The chain translates the raw transcript, so the dropped cleanup has to
          // surface the same toast the cleanup route raises (#2091).
          this.pendingCleanupFailure = this._cleanupFailure(
            cleanupError,
            cleanup.model,
            agentName,
            route.cleanupConfig,
            text
          );
        },
        onEmptyTranslate: () => {
          const { channel } = cleanup.log || {};
          logger.warn("Translation step returned empty text, keeping previous text", {}, channel);
          this.notifyTranslationFallback("failed");
        },
        // No fallback toast here: an echoed translation usually means the dictation was
        // already in the target language, which the current app treats as silent success.
        onUnchangedTranslate: () => {
          const { channel } = cleanup.log || {};
          logger.warn("Translation step returned unchanged text, keeping source text", {}, channel);
        },
      });
      this.translationApplied = chainResult.translated;
      return chainResult;
    } catch (translateError) {
      // Translate step threw: raw text is still pasted by the caller. Surface the failure.
      this.notifyTranslationFallback("failed");
      throw translateError;
    }
  }

  async processTranscription(text, source, wasCancelled = neverCancelled, detectedLanguage) {
    const capturedCleanup =
      this._activeProcessingPipeline?.recording?.cleanupOperation ||
      this._recordingContext?.cleanupOperation;
    const result = await this.processTranscriptionCore(
      text,
      source,
      wasCancelled,
      detectedLanguage
    );
    if (wasCancelled() || capturedCleanup) return result;
    return this.finalizeChineseScript(result);
  }

  async processTranscriptionCore(text, source, wasCancelled = neverCancelled, detectedLanguage) {
    const normalizedText = typeof text === "string" ? text.trim() : "";

    if (!normalizedText) {
      logger.logReasoning("TRANSCRIPTION_EMPTY_SKIPPING_REASONING", {
        source,
        reason: "Empty text after normalization",
      });
      return normalizedText;
    }
    if (wasCancelled()) return normalizedText;

    const cleanupOperation =
      this._activeProcessingPipeline?.recording?.cleanupOperation ||
      this._recordingContext?.cleanupOperation;
    if (cleanupOperation) {
      try {
        const result = await cleanupOperation.run(normalizedText);
        if (wasCancelled()) return normalizedText;
        return result || (await cleanupOperation.finalizeOutput(normalizedText));
      } catch (error) {
        if (!wasCancelled()) this.pendingCleanupFailure = cleanupFailureFromError(error);
        return normalizedText;
      }
    }

    logger.logReasoning("TRANSCRIPTION_RECEIVED", {
      source,
      textLength: normalizedText.length,
      textPreview: normalizedText.substring(0, 100) + (normalizedText.length > 100 ? "..." : ""),
      timestamp: new Date().toISOString(),
    });

    const settings = this.settings();
    let cleanupModel;
    try {
      cleanupModel = selectResolvedLLMConfig(settings, "dictationCleanup").model;
    } catch (error) {
      logger.warn("Dictation route unavailable", { error: error.message }, "transcription");
      if (this.translationRequested) this.notifyTranslationFallback("failed");
      return normalizedText;
    }
    const cleanupProvider = settings.cleanupProvider || "auto";
    const cleanupReachable = !!settings.useCleanupModel && !!cleanupModel;
    const agentReachable = dictationAgentReachable(settings);
    const agentName =
      this._activeSession?.agentName ??
      (typeof window !== "undefined" && window.localStorage ? getAgentName() : "OpenWhispr");
    if (
      !cleanupReachable &&
      !agentReachable &&
      !(this.translationRequested && translationChainReachable(settings)) &&
      // A voice-assistant command always routes: standalone commands stream
      // in the panel, which reports a missing model in-conversation.
      !this.voiceAgentRequested
    ) {
      logger.logReasoning("REASONING_SKIPPED", {
        reason: "No cleanup or dictation-agent model available",
      });
      // The raw transcript is still pasted, but a translation recording that
      // cannot translate must say so, as it does when a cleanup model exists.
      if (this.translationRequested) this.notifyTranslationFallback("unreachable");
      return normalizedText;
    }

    const useReasoning = this.voiceAgentRequested || (await this.isReasoningAvailable());
    if (wasCancelled()) return normalizedText;
    // A translation recording that ends up returning untranslated text must say
    // so exactly once. The translation chain reports its own failures, and the
    // routed paths below report when the route is not translation; this flag
    // keeps the final fallback from adding a second toast to either.
    let translationOutcomeReported = false;

    logger.logReasoning("REASONING_CHECK", {
      useReasoning,
      cleanupModel,
      cleanupProvider,
      agentName,
    });

    if (useReasoning) {
      let route;
      try {
        const screenContext = this.voiceAgentRequested ? await this.consumeScreenContext() : null;
        route = resolveReasoningRoute(
          normalizedText,
          settings,
          agentName,
          this.voiceAgentRequested,
          this.translationRequested,
          screenContext,
          detectedLanguage,
          this._activeSession?.routes ?? null
        );
        if (this.translationRequested && route.kind !== "translation") {
          translationOutcomeReported = true;
          this.notifyTranslationFallback("unreachable");
        }
        if (route.kind !== "agent" && route.kind !== "skip") this.onProcessingStage?.("cleaning");
        if (route.kind === "skip") return normalizedText;

        if (route.kind === "translation") {
          translationOutcomeReported = true;
          const { text: translatedText } = await this.runTranslationChain({
            text: normalizedText,
            settings,
            agentName,
            route,
            cleanup: {
              mode: "model",
              model: cleanupModel,
              log: { level: "warn", channel: "notes", extra: { source } },
            },
          });

          logger.logReasoning("REASONING_SUCCESS", {
            resultLength: translatedText.length,
            resultPreview:
              translatedText.substring(0, 100) + (translatedText.length > 100 ? "..." : ""),
            processingTime: new Date().toISOString(),
          });

          return translatedText;
        }

        const targetModel = route.kind === "agent" ? route.model : cleanupModel;
        const reasoningConfig = route.config;

        logger.logReasoning("SENDING_TO_REASONING", {
          preparedTextLength: normalizedText.length,
          model: targetModel,
          provider: route.config?.provider || cleanupProvider,
          path: route.kind,
          disableThinking: reasoningConfig?.disableThinking,
        });

        const result =
          route.kind === "agent"
            ? await this.processAgentCommand(
                normalizedText,
                targetModel,
                agentName,
                {
                  ...reasoningConfig,
                  requiresAgent: true,
                },
                wasCancelled
              )
            : await this.processWithReasoningModel(
                normalizedText,
                targetModel,
                agentName,
                reasoningConfig
              );

        logger.logReasoning("REASONING_SUCCESS", {
          resultLength: result.length,
          resultPreview: result.substring(0, 100) + (result.length > 100 ? "..." : ""),
          processingTime: new Date().toISOString(),
        });

        // A blank reply must not wipe the dictation — keep the transcript (#1616).
        return hasTextContent(result) ? result : normalizedText;
      } catch (error) {
        if (error.selectionEditFatal) throw error;
        if (wasCancelled()) return normalizedText;
        logger.logReasoning("REASONING_FAILED", {
          error: error.message,
          stack: error.stack,
          fallbackToCleanup: true,
        });
        logger.warn("Reasoning failed", { source, error: error.message }, "notes");
        if (route?.kind === "cleanup")
          this.pendingCleanupFailure = this._cleanupFailure(
            error,
            cleanupModel,
            agentName,
            route.config,
            normalizedText
          );
        if (route?.kind === "agent") this._notifyAgentReasoningFailed();
      }
    }

    if (this.translationRequested && !translationOutcomeReported) {
      // Reasoning was unavailable, or failed before a route was chosen.
      this.notifyTranslationFallback(useReasoning ? "failed" : "unreachable");
    }

    logger.logReasoning("USING_STANDARD_CLEANUP", {
      reason: useReasoning ? "Reasoning failed" : "Reasoning not enabled",
    });

    return normalizedText;
  }

  shouldStreamTranscription(model, provider) {
    if (provider !== "openai") {
      return false;
    }
    const normalized = typeof model === "string" ? model.trim() : "";
    if (!normalized || normalized === "whisper-1") {
      return false;
    }
    if (
      normalized === "gpt-transcribe" ||
      normalized === "gpt-4o-transcribe" ||
      normalized === "gpt-4o-transcribe-diarize"
    ) {
      return true;
    }
    return normalized.startsWith("gpt-4o-mini-transcribe");
  }

  async readTranscriptionStream(response) {
    const reader = response.body?.getReader();
    if (!reader) {
      logger.error("Streaming response body not available", {}, "transcription");
      throw new Error("Streaming response body not available");
    }

    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let collectedText = "";
    let finalText = null;
    let eventCount = 0;
    const eventTypes = {};

    const handleEvent = (payload) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      eventCount++;
      const eventType = payload.type || "unknown";
      eventTypes[eventType] = (eventTypes[eventType] || 0) + 1;

      logger.debug(
        "Stream event received",
        {
          type: eventType,
          eventNumber: eventCount,
          payloadKeys: Object.keys(payload),
        },
        "transcription"
      );

      if (payload.type === "transcript.text.delta" && typeof payload.delta === "string") {
        collectedText += payload.delta;
        return;
      }
      if (payload.type === "transcript.text.segment" && typeof payload.text === "string") {
        collectedText += payload.text;
        return;
      }
      if (payload.type === "transcript.text.done" && typeof payload.text === "string") {
        finalText = payload.text;
        logger.debug(
          "Final transcript received",
          {
            textLength: payload.text.length,
          },
          "transcription"
        );
      }
    };

    logger.debug("Starting to read transcription stream", {}, "transcription");

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        logger.debug(
          "Stream reading complete",
          {
            eventCount,
            eventTypes,
            collectedTextLength: collectedText.length,
            hasFinalText: finalText !== null,
          },
          "transcription"
        );
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // Log first chunk to see format
      if (eventCount === 0 && chunk.length > 0) {
        logger.debug(
          "First stream chunk received",
          {
            chunkLength: chunk.length,
            chunkPreview: chunk.substring(0, 500),
          },
          "transcription"
        );
      }

      // Process complete lines from the buffer
      // Each SSE event is "data: <json>\n" followed by empty line
      const lines = buffer.split("\n");
      buffer = "";

      for (const line of lines) {
        const trimmedLine = line.trim();

        // Skip empty lines
        if (!trimmedLine) {
          continue;
        }

        // Extract data from "data: " prefix
        let data = "";
        if (trimmedLine.startsWith("data: ")) {
          data = trimmedLine.slice(6);
        } else if (trimmedLine.startsWith("data:")) {
          data = trimmedLine.slice(5).trim();
        } else {
          // Not a data line, could be leftover - keep in buffer
          buffer += line + "\n";
          continue;
        }

        // Handle [DONE] marker
        if (data === "[DONE]") {
          finalText = finalText ?? collectedText;
          continue;
        }

        // Try to parse JSON
        try {
          const parsed = JSON.parse(data);
          handleEvent(parsed);
        } catch (error) {
          // Incomplete JSON - put back in buffer for next iteration
          buffer += line + "\n";
        }
      }
    }

    const result = finalText ?? collectedText;
    logger.debug(
      "Stream processing complete",
      {
        resultLength: result.length,
        usedFinalText: finalText !== null,
        eventCount,
        eventTypes,
      },
      "transcription"
    );

    return result;
  }

  getCustomDictionaryArray() {
    return this.settings().customDictionary;
  }

  getCustomPrompt() {
    return this.settings().customPrompts?.cleanup || undefined;
  }

  getKeyterms() {
    return this.getCustomDictionaryArray();
  }

  async processWithOpenAIAPI(audioBlob, metadata = {}, wasCancelled = neverCancelled) {
    const settings = this.settings();
    const provider = settings.cloudTranscriptionProvider || "openai";
    const model = this.getTranscriptionModel();
    const route = this.resolveBatchRoute(settings, model);
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    this._activeTranscriptionAbortController = controller;
    const cancel = () => window.electronAPI.cancelUploadTranscription?.(requestId);
    controller.signal.addEventListener("abort", cancel, { once: true });
    const started = performance.now();
    try {
      if (wasCancelled()) throw new DOMException("Transcription canceled", "AbortError");
      const usesKeywords = provider === "openai" && usesTranscriptionKeywords(model);
      const dictionary = this.getCustomDictionaryPrompt();
      const { prompt } = trimDictionaryPrompt(
        this.getWhisperPrompt(settings, usesKeywords ? null : dictionary),
        dictionaryPromptLimit({
          provider: route.provider,
          endpoint: route.endpoint,
          model: route.model || model,
        })
      );
      const payload = {
        audioBuffer: await audioBlob.arrayBuffer(),
        correlationId: this._activeSession?.id ?? null,
        mimeType: audioBlob.type || "audio/webm",
        fileName: `dictation.${audioExtensionForMime(audioBlob.type || "audio/webm")}`,
        provider,
        model,
        baseUrl: settings.cloudTranscriptionBaseUrl,
        language: getBaseLanguageCode(this.getEffectiveSttLanguage(settings)),
        prompt: prompt || undefined,
        keyterms: usesKeywords ? dictionaryKeywords(dictionary) : this.getKeyterms(),
        requestId,
        environment: settings.cortiEnvironment,
        tenant: settings.cortiTenant,
        transcriptionMode: settings.transcriptionMode,
        remoteTranscriptionUrl: settings.remoteTranscriptionUrl,
        remoteTranscriptionModel: settings.remoteTranscriptionModel,
      };
      if (wasCancelled()) throw new DOMException("Transcription canceled", "AbortError");
      const result = await window.electronAPI.transcribeAudioFileByok(payload);
      if (wasCancelled()) throw new DOMException("Transcription canceled", "AbortError");
      if (!result.success)
        throw Object.assign(new Error(result.error || "Transcription failed"), {
          code: result.code,
          messageKey: result.messageKey,
          // Sealed mode keeps its phase and any provider-side leftover (T9-M1).
          ...(result.phase ? { phase: result.phase, details: { phase: result.phase } } : {}),
          ...(result.providerRetained ? { providerRetained: result.providerRetained } : {}),
        });
      const rawText = result.text || "";
      if (
        payloadSendsDictionaryBias(payload) &&
        (matchesDictionaryPrompt(rawText, payload.prompt) ||
          matchesDictionaryPrompt(rawText, (payload.keyterms || []).join(", ")))
      )
        throw dictionaryEchoError();
      const transcriptionProcessingDurationMs = Math.round(performance.now() - started);
      const reasoningStarted = performance.now();
      const text = await this.processTranscription(
        rawText,
        provider,
        wasCancelled,
        result.sttLanguage
      );
      return {
        success: true,
        text,
        rawText,
        source: provider,
        timings: {
          transcriptionProcessingDurationMs,
          reasoningProcessingDurationMs: Math.round(performance.now() - reasoningStarted),
        },
      };
    } finally {
      controller.signal.removeEventListener("abort", cancel);
      if (this._activeTranscriptionAbortController === controller)
        this._activeTranscriptionAbortController = null;
    }
  }

  getTranscriptionModel() {
    try {
      const s = this.settings();
      const selfHostedModel = resolveSelfHostedTranscriptionModel(s);
      if (selfHostedModel) return selfHostedModel;
      const provider = s.cloudTranscriptionProvider || "openai";
      // Tinfoil and Gemini pin their batch model in the registry rather than in
      // settings: their streaming model has no batch endpoint, so a streaming
      // fallback that reused the selected model would POST an unusable id.
      const batchModel = getBatchTranscriptionModel(provider);
      if (batchModel) return batchModel;
      return resolveByokModel(provider, s.cloudTranscriptionModel);
    } catch (error) {
      return "gpt-transcribe";
    }
  }

  // Resolve only the explicitly selected provider; main process resolves credentials.
  resolveBatchRoute(settings, deploymentName = "") {
    const route = resolveTranscriptionRoute({
      settings: { ...settings, useLocalWhisper: false },
      providers: getTranscriptionProviders(),
      hasProviderKey: Boolean(
        getTranscriptionApiKey(settings.cloudTranscriptionProvider || "openai", settings)
      ),
      request: { model: deploymentName },
    });
    if (route.transport === "error") {
      const error = new Error(route.message);
      if (route.code) error.code = route.code;
      if (route.messageKey) error.messageKey = route.messageKey;
      throw error;
    }
    return route;
  }

  async safePaste(text, options = {}) {
    try {
      const result = await window.electronAPI.pasteText(text, options);
      return result?.pasted === true;
    } catch (error) {
      const message =
        error?.message ??
        (typeof error?.toString === "function" ? error.toString() : String(error));
      this.onError?.({
        title: "Paste Error",
        description: `Failed to paste text. Please check accessibility permissions. ${message}`,
      });
      return false;
    }
  }

  async saveTranscription(
    text,
    rawText = null,
    {
      clientTranscriptionId,
      analyticsOccurredAt,
      sessionId,
      private: sessionPrivate,
      recording,
    } = {}
  ) {
    return this._trackRecordingWork(async () => {
      const audioOwner =
        recording?.ownedAudio ??
        this._ownedAudioSnapshot({
          sessionId: sessionId ?? recording?.sessionId,
          private: sessionPrivate ?? recording?.private,
        });
      // Audio ownership is captured before transcription finishes. Bind the
      // completed metadata from that same recording before any save can yield;
      // the manager's current metadata may already belong to a newer recording.
      const owned = recording?.audioMetadata
        ? Object.freeze({
            ...audioOwner,
            metadata: Object.freeze({ ...recording.audioMetadata }),
          })
        : audioOwner;
      if (owned.private) {
        this._releaseOwnedAudio(owned);
        return true;
      }
      const translationRequested = this.translationRequested;
      const { dataRetentionEnabled, audioRetentionDays } = getEffectiveRetentionPreferences();
      if (!dataRetentionEnabled) {
        logger.debug("Skipping transcription save — data retention disabled", {}, "audio");
        this._releaseOwnedAudio(owned);
        return true;
      }

      const eventId = clientTranscriptionId || crypto.randomUUID();
      const occurredAt = analyticsOccurredAt ? new Date(analyticsOccurredAt) : new Date();
      const metadata = owned.metadata || {};
      try {
        await window.electronAPI.recordAnalyticsEvent({
          eventId,
          wordCount: countSpokenWords(rawText || text),
          occurredAt: occurredAt.toISOString(),
          localDate: localDateKey(occurredAt),
          spokenDurationMs: metadata.durationMs || null,
          mode: resolveAnalyticsMode(getSettings(), metadata.provider),
          provider: metadata.provider || null,
          model: metadata.model || null,
        });
      } catch (analyticsError) {
        logger.warn(
          "Failed to record local analytics event",
          { error: analyticsError.message },
          "analytics"
        );
      }

      try {
        const result = await window.electronAPI.saveTranscription(text, rawText, {
          clientTranscriptionId: eventId,
          routeKind: translationRequested ? "translation" : null,
          analyticsOccurredAt: occurredAt.toISOString(),
        });

        // Save audio if we have a captured blob and the transcription was saved successfully
        if (result?.id && owned.blob) {
          if (audioRetentionDays > 0) {
            try {
              const arrayBuffer = await owned.blob.arrayBuffer();
              await window.electronAPI.saveTranscriptionAudio(
                result.id,
                arrayBuffer,
                owned.metadata
              );
            } catch (audioErr) {
              // Non-blocking: transcription is saved even if audio save fails
              logger.warn(
                "Failed to save transcription audio",
                { error: audioErr.message },
                "audio"
              );
            }
          }
          this._releaseOwnedAudio(owned);
        }

        return true;
      } catch (error) {
        return false;
      }
    });
  }

  async saveFailedTranscription(
    errorMessage,
    errorCode = null,
    metadata = {},
    owned = this._ownedAudioSnapshot()
  ) {
    return this._trackRecordingWork(async () => {
      if (owned.private) {
        this._releaseOwnedAudio(owned);
        return { audioKept: false };
      }
      let audioKept = false;
      const translationRequested = this.translationRequested;
      const { dataRetentionEnabled, audioRetentionDays } = getEffectiveRetentionPreferences();
      if (!dataRetentionEnabled) {
        logger.debug("Skipping failed transcription save — data retention disabled", {}, "audio");
        this._releaseOwnedAudio(owned);
        return { audioKept: false };
      }

      try {
        const result = await window.electronAPI.saveTranscription("", null, {
          status: "failed",
          errorMessage,
          errorCode,
          routeKind: translationRequested ? "translation" : null,
          ...(metadata?.analyticsOccurredAt
            ? { analyticsOccurredAt: metadata.analyticsOccurredAt }
            : {}),
        });

        if (result?.id && owned.blob) {
          if (audioRetentionDays > 0) {
            try {
              const durationMs = metadata?.durationSeconds
                ? Math.round(metadata.durationSeconds * 1000)
                : null;
              const arrayBuffer = await owned.blob.arrayBuffer();
              const saved = await window.electronAPI.saveTranscriptionAudio(
                result.id,
                arrayBuffer,
                {
                  durationMs,
                  provider: null,
                  model: null,
                }
              );
              audioKept = saved?.success === true;
            } catch (audioErr) {
              logger.warn(
                "Failed to save audio for failed transcription",
                {
                  error: audioErr.message,
                },
                "audio"
              );
            }
          }
          this._releaseOwnedAudio(owned);
        }
      } catch (error) {
        logger.error(
          "Failed to save failed transcription record",
          {
            error: error.message,
          },
          "audio"
        );
      }
      return { audioKept };
    });
  }

  async saveDiscardedTranscription(
    blob,
    durationSeconds,
    analyticsOccurredAt = null,
    { private: isPrivate = false, translationRequested = this.translationRequested } = {}
  ) {
    return this._trackRecordingWork(async () => {
      if (isPrivate) return;
      let savedId = null;
      try {
        const result = await window.electronAPI.saveTranscription("", null, {
          status: "discarded",
          routeKind: translationRequested ? "translation" : null,
          ...(analyticsOccurredAt ? { analyticsOccurredAt } : {}),
        });
        if (!result?.id) return;
        savedId = result.id;

        if (blob) {
          const durationMs = durationSeconds ? Math.round(durationSeconds * 1000) : null;
          const arrayBuffer = await blob.arrayBuffer();
          await window.electronAPI.saveTranscriptionAudio(savedId, arrayBuffer, {
            durationMs,
            provider: null,
            model: null,
          });
        }
      } catch (error) {
        logger.error(
          "Failed to save discarded transcription record",
          { error: error.message },
          "audio"
        );
        // A discarded row is only recoverable through its audio; if the audio save
        // failed, drop the dead row instead of leaving an empty unrecoverable entry. See #907.
        if (savedId != null) {
          try {
            await window.electronAPI.deleteTranscription(savedId);
          } catch (cleanupError) {
            logger.warn(
              "Failed to clean up discarded row after audio save failure",
              { error: cleanupError.message },
              "audio"
            );
          }
        }
      }
    });
  }

  getState() {
    return {
      isRecording: this.isRecording,
      isProcessing: this.isProcessing,
      isStreaming: this.isStreaming,
      isStreamingStartInProgress: this.streamingStartInProgress,
      isFinalizingStreaming: Boolean(this._streamingStopPromise),
      micCaptureStatus: this.micCaptureStatus,
    };
  }

  shouldUseStreaming() {
    const s = getSettings();
    if (s.useLocalWhisper || isSelfHostedTranscription(s)) return false;
    const provider = s.cloudTranscriptionProvider || "openai";
    if (provider === "corti") return !!(s.cortiClientId && s.cortiClientSecret);
    if (provider === "gemini" || provider === "tinfoil") {
      const model = getTranscriptionProvider(provider)?.models.find(
        (entry) => entry.id === s.cloudTranscriptionModel
      );
      return !!model?.streaming && !!getTranscriptionApiKey(provider, s);
    }
    if (STREAMING_ONLY_PROVIDERS.has(provider)) return !!getTranscriptionApiKey(provider, s);
    return (
      provider === "openai" && REALTIME_MODELS.has(s.cloudTranscriptionModel) && !!s.openaiApiKey
    );
  }

  async warmupStreamingConnection() {
    if (!this.shouldUseStreaming()) {
      logger.debug("Streaming warmup skipped - not in streaming mode", {}, "streaming");
      return false;
    }

    try {
      const providerName = this.getStreamingProviderName();
      const provider = STREAMING_PROVIDERS[providerName];
      const [, wsResult] = await Promise.all([
        this.cacheMicrophoneDeviceId(),
        (async () => {
          const settings = getSettings();
          const usesKeywords =
            settings.cloudTranscriptionProvider === "openai" &&
            usesTranscriptionKeywords(settings.cloudTranscriptionModel);
          const dictionary = this.getCustomDictionaryPrompt();
          const res = await provider.warmup(
            buildStreamingSessionOptions({
              providerName,
              settings,
              language: settings.preferredLanguage,
              keyterms: usesKeywords ? dictionaryKeywords(dictionary) : this.getKeyterms(),
              voiceAgentRequested: this.voiceAgentRequested,
            })
          );
          // Throw error to trigger retry if AUTH_EXPIRED
          if (!res.success && res.code) {
            const err = new Error(res.error || "Warmup failed");
            err.code = res.code;
            throw err;
          }
          return res;
        })(),
      ]);

      if (wsResult.success) {
        // Pre-load AudioWorklet module so first recording is faster
        try {
          const audioContext = await this.getOrCreateAudioContext();
          if (!this.workletModuleLoaded) {
            await audioContext.audioWorklet.addModule(this.getWorkletBlobUrl());
            this.workletModuleLoaded = true;
            logger.debug("AudioWorklet module pre-loaded during warmup", {}, "streaming");
          }
        } catch (e) {
          logger.debug(
            "AudioWorklet pre-load failed (will retry on recording)",
            { error: e.message },
            "streaming"
          );
        }

        // Warm up the OS audio driver by briefly acquiring the mic, then
        // releasing. TTL-gated: drivers go cold again after idle, so this must
        // re-fire once the warm window lapses (#845).
        await this._warmMicDriverIfCold("streaming");

        this.warmupFailureStreak = 0;
        logger.info(
          "Streaming connection warmed up",
          { alreadyWarm: wsResult.alreadyWarm, micCached: !!this.cachedMicDeviceId },
          "streaming"
        );
        return true;
      } else if (wsResult.code === "NO_API") {
        logger.debug("Streaming warmup skipped - API not configured", {}, "streaming");
        return false;
      } else {
        this._reportWarmupFailure(providerName, wsResult.error, wsResult.code);
        return false;
      }
    } catch (error) {
      this._reportWarmupFailure(this.getStreamingProviderName(), error.message, error.code);
      return false;
    }
  }

  // Warmup exercises the same connect that recording start will make, so a
  // failing warmup predicts a guaranteed user-facing failure at the next
  // keypress — #1624 logged exactly this on every idle cycle for days at warn
  // level and nobody saw it. Error level, provider named, streak counted.
  _reportWarmupFailure(provider, error, code) {
    this.warmupFailureStreak += 1;
    logger.error(
      "Streaming warmup failed",
      { provider, error, code, consecutiveFailures: this.warmupFailureStreak },
      "streaming"
    );
  }

  async getOrCreateAudioContext() {
    if (this.persistentAudioContext && this.persistentAudioContext.state !== "closed") {
      if (this.persistentAudioContext.state === "suspended") {
        await this.persistentAudioContext.resume();
      }
      return this.persistentAudioContext;
    }
    this.persistentAudioContext = new AudioContext({ sampleRate: 16000 });
    this.workletModuleLoaded = false;
    return this.persistentAudioContext;
  }

  startStreamingFallbackRecorder(stream) {
    try {
      const chunks = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) chunks.push(event.data);
      };
      recorder.start(RECORDING_TIMESLICE_MS);
      this.streamingFallbackRecorder = recorder;
      this.streamingFallbackChunks = chunks;
      if (this._sessionAudio?.kind === "streaming") this._sessionAudio.fallbackChunks = chunks;
      return recorder;
    } catch (error) {
      logger.debug("Fallback recorder failed to start", { error: error.message }, "streaming");
      this.streamingFallbackRecorder = null;
      return null;
    }
  }

  async finishStreamingFallbackSegment() {
    const recorder = this.streamingFallbackRecorder;
    if (!recorder) return null;
    const held = this._sessionAudio;
    const chunks = this.streamingFallbackChunks;
    const segments = this._streamingFallbackSegments;
    const collect = () => new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    let finish;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    if (held?.kind === "streaming") held.fallbackPending = pending;
    if (recorder.state === "recording") {
      recorder.onstop = () => finish(collect());
      try {
        recorder.stop();
      } catch {
        finish(collect());
      }
    } else finish(collect());
    const blob = await pending;
    chunks.length = 0;
    if (this.streamingFallbackRecorder === recorder) {
      this.streamingFallbackRecorder = null;
      this.streamingFallbackChunks = [];
    }
    if (held?.fallbackPending === pending) held.fallbackPending = null;
    if (!held?.cancelBuffer && blob?.size > 0) segments.push(blob);
    return blob;
  }

  async replaceStreamingMic(replacement, previous) {
    if (!this.streamingProcessor || !this.streamingAudioContext) {
      throw new Error("Streaming audio pipeline is unavailable");
    }
    const swap = (async () => {
      const nextSource = this.streamingAudioContext.createMediaStreamSource(replacement);
      nextSource.connect(this.streamingProcessor);
      this.streamingSource?.disconnect();
      this.streamingSource = nextSource;
      if (this.streamingAnalyser) this.streamingSource.connect(this.streamingAnalyser);
      await this.finishStreamingFallbackSegment();
      if (!this.isStreaming || !this.isRecording) {
        throw new Error("Streaming stopped during microphone recovery");
      }
      this.startStreamingFallbackRecorder(replacement);
      previous?.getTracks().forEach((track) => track.stop());
      this.streamingStream = replacement;
    })();
    // Expose the swap so stopStreamingRecording can wait for it instead of
    // racing it (losing the newest fallback segment / orphaning a recorder).
    this._streamingMicSwapPromise = swap.catch(() => {});
    try {
      await swap;
    } finally {
      this._streamingMicSwapPromise = null;
    }
  }

  _waitForStreamingStartSettlement() {
    if (!this.streamingStartInProgress) return Promise.resolve();
    return new Promise((resolve) => {
      this._streamingStartSettlementWaiters.push(resolve);
    });
  }

  _settleStreamingStart() {
    this.streamingStartInProgress = false;
    for (const resolve of this._streamingStartSettlementWaiters.splice(0)) resolve();
  }

  async startStreamingRecording(
    forceDefaultMic = false,
    candidate = null,
    onboardingTake = undefined,
    recording = { private: candidate?.private ?? this._privateSession === true },
    admittedTransport = null
  ) {
    if (
      this.streamingStartInProgress ||
      this.isRecording ||
      this.isProcessing ||
      this.isStreaming ||
      this._streamingStopPromise
    )
      return false;
    const providerName =
      candidate?.intents.streamingProviderName ??
      resolveStreamingProviderName({ settings: getSettings(), context: "dictation" });
    candidate ??= this.getOrCreatePressCandidate({
      streaming: true,
      streamingProviderName: providerName,
    });
    if (hasUnknownSelectedEnterpriseRecipient(candidate)) {
      this.cancelPreparedMicCapture(candidate);
      return this._showUnknownRecipientBlockedStart();
    }
    if (this._pressCandidate?.session !== candidate) return false;
    // Plan 07 pre-flight, before the microphone or a provider socket.
    const sealedRefusal = this._sealedPreflight(candidate);
    if (sealedRefusal) return this._refuseSealedStart(candidate, sealedRefusal);
    if (this._undo?.peek()) void this._undo.expireNow();
    recording.sessionId = candidate.id;
    recording.private = candidate.private;
    let acquiredStream = null;
    let usedPreparedCapture = false;
    let sessionId = null;
    let startWasCancelled = () => false;
    this._startInProgress = true;
    try {
      if (this.streamingStartInProgress) {
        return false;
      }
      this.streamingStartInProgress = true;

      if (this.isRecording || this.isStreaming || this.isProcessing || this._streamingStopPromise) {
        this._settleStreamingStart();
        return false;
      }

      this.stopRequestedDuringStreamingStart = false;
      sessionId = (this._streamingSessionGeneration || 0) + 1;
      this._streamingSessionGeneration = sessionId;
      this._activeStreamingSessionId = sessionId;
      this._onboardingTake = onboardingTake;
      const ownsSession = () => this._activeStreamingSessionId === sessionId;
      const operation = Object.freeze({
        correlationId: candidate.id,
        dictationSessionId: candidate.id,
        operationId: crypto.randomUUID(),
      });
      this._streamingOperation = operation;
      const cancellationGeneration = this._streamingCancellationGeneration;
      startWasCancelled = () => cancellationGeneration !== this._streamingCancellationGeneration;

      // Capture adapter, identity and options before the first await. Settings
      // changes cannot retarget acquisition, buffered audio or teardown.
      if (!admittedTransport) {
        const streamingSettings = candidate.settings;
        const name = providerName;
        const adapter = this.getStreamingProvider();
        const usesKeywords =
          streamingSettings.cloudTranscriptionProvider === "openai" &&
          usesTranscriptionKeywords(streamingSettings.cloudTranscriptionModel);
        const dictionary = this.getCustomDictionaryPrompt();
        const options = buildStreamingSessionOptions({
          providerName: name,
          settings: streamingSettings,
          language: this.getEffectiveSttLanguage(streamingSettings),
          keyterms: usesKeywords ? dictionaryKeywords(dictionary) : this.getKeyterms(),
          voiceAgentRequested: this.voiceAgentRequested,
        });
        if (Array.isArray(options.keyterms)) Object.freeze(options.keyterms);
        admittedTransport = {
          operation,
          name,
          adapter,
          closed: false,
          stopPromise: null,
          options: Object.freeze({ ...options, ...operation }),
        };
      }
      admittedTransport.operation = operation;
      admittedTransport.options = Object.freeze({ ...admittedTransport.options, ...operation });
      this._streamingTransport = admittedTransport;
      const provider = admittedTransport.adapter;
      const t0 = performance.now();
      const prepared = forceDefaultMic ? null : await this.preparedMicCapture.take();
      // Prepared while batch mode was expected; keep the stream, drop the pre-roll
      // (the streaming transcript comes from the PCM worklet, not these chunks).
      discardPreRoll(prepared);
      usedPreparedCapture = !!prepared;
      const constraints =
        prepared?.constraints ??
        (await this.getAudioConstraints(forceDefaultMic, false, recording));
      const tConstraints = performance.now();

      // 1. Get mic stream (can take 10-15s on a cold driver — unless a prepared
      //    capture or a held master stream already opened the device).
      const stream = prepared?.stream ?? (await this._acquireCaptureStream(constraints, recording));
      acquiredStream = stream;
      const tMedia = performance.now();
      if (this._pressCandidate?.session !== candidate || startWasCancelled()) {
        stream.getTracks().forEach((track) => track.stop());
        this._settleStreamingStart();
        return false;
      }
      this.beginDictationSession({}, candidate);
      this._streamingFallbackSegments = [];
      this._sessionAudio = {
        session: this._activeSession,
        kind: "streaming",
        frames: [],
        fallbackChunks: null,
        fallbackSegments: this._streamingFallbackSegments,
        mimeType: "audio/webm",
        durationSeconds: null,
        analyticsOccurredAt: new Date().toISOString(),
      };

      const audioTrack = stream.getAudioTracks()[0];

      if (audioTrack) {
        const settings = audioTrack.getSettings();
        logger.info(
          "Streaming recording started with microphone",
          {
            label: audioTrack.label,
            deviceId: settings.deviceId?.slice(0, 20) + "...",
            sampleRate: settings.sampleRate,
            usedCachedId: !!this.cachedMicDeviceId,
            muted: audioTrack.muted,
            readyState: audioTrack.readyState,
          },
          "audio"
        );
      }

      // Start fallback recorder in case streaming produces no results.
      this.startStreamingFallbackRecorder(stream);

      // 2. Set up audio pipeline so frames flow the instant WebSocket is ready.
      //    Frames sent before the connection is open are buffered (bounded) by
      //    sendAudio(), not dropped.
      const audioContext = await this.getOrCreateAudioContext();
      this.streamingAudioContext = audioContext;
      this.streamingSource = audioContext.createMediaStreamSource(stream);
      this.streamingStream = stream;

      // Level source for the live waveform: the batch path reads the
      // speech-gate analyser, which never attaches to streaming recordings.
      this.streamingAnalyser = audioContext.createAnalyser();
      this.streamingAnalyser.fftSize = 2048;
      this.streamingSource.connect(this.streamingAnalyser);

      if (!this.workletModuleLoaded) {
        await audioContext.audioWorklet.addModule(this.getWorkletBlobUrl());
        this.workletModuleLoaded = true;
      }

      this.streamingProcessor = new AudioWorkletNode(audioContext, "pcm-streaming-processor");
      this.streamingProcessor.port.onmessage = (event) => {
        // The worklet posts its remaining PCM followed by a "flushed" sentinel
        // on stop; the sentinel must not be sent as audio (realtime backends
        // reject the odd-length non-PCM bytes with "Invalid audio data").
        if (
          !ownsSession() ||
          admittedTransport.closed ||
          startWasCancelled() ||
          !this.isStreaming ||
          event.data === "flushed"
        )
          return;
        provider.send(event.data, operation);
        if (this._sessionAudio?.session === candidate)
          this._sessionAudio.frames.push(new Int16Array(event.data));
      };

      const tPipeline = performance.now();

      this._attachStreamingListeners(sessionId, provider);
      if (startWasCancelled()) {
        // Cancelled while the mic was opening: never flip to recording.
        await this.cleanupStreaming();
        if (ownsSession()) this._activeStreamingSessionId = null;
        // cancelStreamingRecording may already be awaiting this start's
        // settlement before it can disconnect the provider.
        this._settleStreamingStart();
        this.onStateChange?.(
          { isRecording: false, isProcessing: false, isStreaming: false },
          onboardingTake
        );
        return false;
      }
      // 4. Order main admission before the first worklet frame. Audio flows
      // while its connection awaits, into this attempt's admitted adapter.
      const result = await (async () => {
        if (admittedTransport.closed || startWasCancelled() || !ownsSession())
          return { success: false };
        admittedTransport.startPromise = Promise.resolve().then(() => {
          if (admittedTransport.closed) return { success: false };
          return provider.start(admittedTransport.options);
        });
        const starting = admittedTransport.startPromise.then(
          (value) => ({ value }),
          (error) => ({ error })
        );
        this.isStreaming = true;
        this.streamingSource.connect(this.streamingProcessor);
        this._captureRecordingPrivacy(recording);
        this.isRecording = true;
        this.recordingStartTime = Date.now();
        this.onStateChange?.(
          { isRecording: true, isProcessing: false, isStreaming: true },
          onboardingTake,
          recording
        );
        await this.beginMicRecovery(stream);

        const settled = await starting;
        if (settled.error) throw settled.error;
        const res = settled.value;

        if (!res.success) {
          const err = new Error(res.error || "Failed to start streaming session");
          err.code = res.code;
          err.messageKey = res.messageKey;
          err.networkCode = res.networkCode;
          throw err;
        }
        return res;
      })();
      const tWs = performance.now();
      this._settleStreamingStart();
      if (startWasCancelled()) return false;

      logger.info(
        "Streaming start timing",
        {
          constraintsMs: Math.round(tConstraints - t0),
          getUserMediaMs: Math.round(tMedia - tConstraints),
          pipelineMs: Math.round(tPipeline - tMedia),
          wsConnectMs: Math.round(tWs - tPipeline),
          totalMs: Math.round(tWs - t0),
          usedWarmConnection: result.usedWarmConnection,
          usedPreparedCapture,
          micWarm: isMicWarm(this._micWarmedAt, Date.now()),
        },
        "streaming"
      );

      if (this.stopRequestedDuringStreamingStart) {
        this.stopRequestedDuringStreamingStart = false;
        logger.debug("Applying deferred streaming stop requested during startup", {}, "streaming");
        return this.stopStreamingRecording();
      }
      return true;
    } catch (error) {
      const stopRequested = this.stopRequestedDuringStreamingStart;
      this._settleStreamingStart();
      this.stopRequestedDuringStreamingStart = false;

      // A stream the pipeline never took ownership of would leak the device
      // (and, when prepared, keep the mic indicator lit) — release it here.
      if (acquiredStream && this.streamingStream !== acquiredStream) {
        acquiredStream.getTracks().forEach((track) => track.stop());
        this._markCaptureStreamReleased();
      }

      if (startWasCancelled()) return false;

      if (isStaleDeviceError(error) && !forceDefaultMic && !stopRequested) {
        // Pinned mic is gone (Chromium rotates IDs / device unplugged). Retry once on the default mic. See #900.
        logger.warn(
          "Pinned microphone unavailable, retrying streaming on default mic",
          {},
          "streaming"
        );
        this.cachedMicDeviceId = null;
        await this.cleanupStreaming();
        if (this._activeStreamingSessionId === sessionId) {
          this._activeStreamingSessionId = null;
        }
        this.isRecording = false;
        this.recordingStartTime = null;
        this.onStateChange?.({ isRecording: false, isProcessing: false, isStreaming: false });
        this._endDictationSession(candidate);
        this._pressCandidate = { session: candidate };
        return this.startStreamingRecording(
          true,
          candidate,
          onboardingTake,
          recording,
          admittedTransport
        );
      }

      logger.error(
        "Failed to start streaming recording",
        { provider: admittedTransport?.name || "unknown", error: error.message, code: error.code },
        "streaming"
      );

      let errorTitle = "Streaming Error";
      let errorDescription = `Failed to start streaming: ${error.message}`;

      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        errorTitle = "Microphone Access Denied";
        errorDescription =
          "Please grant microphone permission in your system settings and try again.";
      } else if (error.code === "NETWORK_ERROR") {
        errorTitle = "streaming.errors.cloudUnreachable.title";
        errorDescription = error.messageKey || "streaming.errors.cloudUnreachable.generic";
      } else if (error.name === "MicUnusableError") {
        errorTitle = "Microphone Muted";
        errorDescription =
          "Your microphones stayed muted and produced no audio. Please check your sound input settings and try again.";
      }

      this.onError?.(
        {
          messageKey: error.messageKey,
          title: errorTitle,
          description: errorDescription,
          code: typeof error.code === "string" ? error.code : undefined,
          name: error.name,
        },
        onboardingTake,
        recording
      );

      await this.cleanupStreaming();
      await this._stopStreamingTransport(admittedTransport).catch(() => {});
      if (this._activeStreamingSessionId === sessionId) {
        this._activeStreamingSessionId = null;
      }
      this.isRecording = false;
      this.recordingStartTime = null;
      this.onStateChange?.(
        { isRecording: false, isProcessing: false, isStreaming: false },
        onboardingTake,
        recording
      );
      return false;
    } finally {
      this._startInProgress = false;
      if (!this.isRecording && !this.isProcessing) this._endDictationSession(candidate);
      if (this._activeSession !== candidate) this.cancelPreparedMicCapture(candidate);
    }
  }

  // Resolves once the transcript stops moving. An outstanding partial proves its
  // final is still in flight, so only the ceiling ends the wait until it lands —
  // a plain debounce would expire on the very tail this exists to catch.
  awaitStreamingTextSettled(ceilingMs = STREAMING_FINAL_CEILING_MS) {
    return new Promise((resolve) => {
      const settle = () => {
        clearTimeout(this.streamingTextDebounce);
        clearTimeout(ceiling);
        this.streamingTextBump = null;
        this.streamingTextDebounce = null;
        resolve();
      };
      const ceiling = setTimeout(settle, ceilingMs);
      const arm = () => {
        clearTimeout(this.streamingTextDebounce);
        if (this.streamingPartialText) return;
        this.streamingTextDebounce = setTimeout(settle, STREAMING_FINAL_QUIET_MS);
      };
      this.streamingTextBump = arm;
      arm();
    });
  }

  _attachStreamingListeners(sessionId, provider = this.getStreamingProvider()) {
    const ownsSession = () => this._activeStreamingSessionId === sessionId;
    const onboardingTake = this._onboardingTake;
    // 3. Register IPC event listeners BEFORE connecting, so no transcript
    //    events are lost during the connect handshake.
    this.streamingFinalText = "";
    this.streamingPartialText = "";
    this.streamingTextBump = null;
    this.streamingTextDebounce = null;

    const partialCleanup = provider.onPartial((text) => {
      if (!ownsSession()) return;
      this.streamingPartialText = text;
      this.streamingTextBump?.();
      this.onPartialTranscript?.(text, onboardingTake);
    });

    const finalCleanup = provider.onFinal((text) => {
      if (!ownsSession()) return;
      // text = accumulated final text from streaming provider.
      // Extract just the new segment (delta from previous accumulated final).
      const prevLen = this.streamingFinalText.length;
      this.streamingFinalText = text;
      this.streamingPartialText = "";
      this.streamingTextBump?.();
      const newSegment = text.slice(prevLen);
      if (newSegment) {
        this.onStreamingCommit?.(newSegment);
      }
    });

    const errorCleanup = provider.onError((error) => {
      if (!ownsSession()) return;
      logger.error("Streaming provider error", { error }, "streaming");
      this.onError?.(
        {
          title: "Streaming Error",
          description: error,
        },
        onboardingTake
      );
      if (this.isStreaming) {
        logger.warn("Connection lost during streaming, auto-stopping", {}, "streaming");
        this.stopStreamingRecording().catch((e) => {
          logger.error("Auto-stop after connection loss failed", { error: e.message }, "streaming");
        });
      }
    });

    const sessionEndCleanup = provider.onSessionEnd((data) => {
      if (!ownsSession()) return;
      logger.debug("Streaming session ended", data, "streaming");
      if (data.text) {
        this.streamingFinalText = data.text;
      }
    });

    this.streamingCleanupFns = [partialCleanup, finalCleanup, errorCleanup, sessionEndCleanup];
  }

  async stopStreamingRecording() {
    if (this.streamingStartInProgress) {
      this.stopRequestedDuringStreamingStart = true;
      logger.debug("Streaming stop requested while start is in progress", {}, "streaming");
      return true;
    }

    if (this._streamingStopPromise) {
      return this._streamingStopPromise;
    }
    if (!this.isStreaming) return false;

    const session = this._activeSession;
    const sessionId = this._activeStreamingSessionId;
    const operation = this._streamingOperation;
    const transport = this._streamingTransport;
    const stopPromise = this._finalizeStreamingRecording(sessionId);
    this._streamingStopPromise = stopPromise;
    this._streamingStopMode = "finalize";
    try {
      return await stopPromise;
    } finally {
      await this._stopStreamingTransport(transport).catch(() => {});
      if (this._streamingStopPromise === stopPromise) {
        this._streamingStopPromise = null;
        this._streamingStopMode = null;
      }
      if (this._streamingOperation === operation && this._activeStreamingSessionId === sessionId) {
        if (this._activeStreamingSessionId === sessionId) {
          this._activeStreamingSessionId = null;
        }

        if (this._sessionAudio?.session === session) this._dropSessionAudio();
        // Finalization has several provider/reasoning awaits. A thrown error must
        // never leave the renderer or main process stuck in a busy lifecycle.
        this._endDictationSession(session);
        const needsIdleNotification = this.isRecording || this.isProcessing || this.isStreaming;
        this.isRecording = false;
        this.isProcessing = false;
        this.isStreaming = false;
        if (needsIdleNotification) {
          this.onStateChange?.({ isRecording: false, isProcessing: false, isStreaming: false });
        }
      }
    }
  }

  _requestStreamingCancellation() {
    this.retireCapturedCleanup();
    this._streamingCancellationGeneration += 1;
    this._cancelAbandonedSegmentMerges();
    ReasoningService.cancelAllRequests();
    this._activeTranscriptionAbortController?.abort();
    this._activeTranscriptionAbortController = null;
    this.pendingSelectionEdit = null;
    this.pendingAssistantConversation = null;
    this.pendingCleanupFailure = null;
    this.assistantSelectionContext = null;
    this.screenContextPromise = null;
    this.selectionCapturePromise = null;
  }

  _stopStreamingTransport(owner) {
    if (!owner) return Promise.resolve();
    if (owner.stopPromise) return owner.stopPromise;
    owner.closed = true;
    // Install before calling an adapter: a synchronous throw/reentrant cancel
    // must still count as this owner's sole teardown attempt. closed fences
    // any not-yet-dispatched start; an already dispatched start can still open
    // main's connection after its token await, so stop only after that settles.
    owner.stopPromise = Promise.resolve()
      .then(() => owner.startPromise?.catch(() => {}))
      .then(() => owner.adapter.stop?.(owner.operation));
    return owner.stopPromise;
  }

  async cancelStreamingRecording() {
    this._restoreGeneration = (this._restoreGeneration ?? 0) + 1;
    if (this._streamingStopPromise) {
      if (this._streamingStopMode === "finalize") {
        this._requestStreamingCancellation();
        const provider = this._streamingTransport?.adapter;
        const operation = this._streamingOperation;
        provider?.cancel?.(operation);
        this._holdStreamingSession();
      }
      return this._streamingStopPromise;
    }
    if (!this.isStreaming && !this.streamingStartInProgress) {
      return false;
    }

    const session = this._activeSession;
    const sessionId = this._activeStreamingSessionId;
    const operation = this._streamingOperation;
    const transport = this._streamingTransport;
    const provider = transport?.adapter;
    const cancelPromise = (async () => {
      this._requestStreamingCancellation();
      provider?.cancel?.(operation);
      if (!this._holdStreamingSession())
        this.onCancelledChange?.(null, undefined, this._onboardingTake);
      this.stopRequestedDuringStreamingStart = false;
      this.recordingStartTime = null;
      this.isRecording = false;
      this._activeProcessingPipeline = null;
      this.isProcessing = true;
      this.micRecovery.stop();
      this.cleanupStreamingAudio();
      this.cleanupStreamingListeners(sessionId);
      this._streamingFallbackSegments = [];
      this.onStateChange?.({ isRecording: false, isProcessing: true, isStreaming: false });

      // Retire main's pending Start now. Waiting for renderer startup first
      // would wait on the same handshake that Stop must cancel.
      const providerStop = this._stopStreamingTransport(transport).catch((error) => {
        logger.debug(
          "Streaming disconnect after cancellation failed",
          { error: error.message },
          "streaming"
        );
      });
      const captureCleanup = this._waitForStreamingStartSettlement().then(() => {
        if (this._streamingOperation !== operation || this._activeStreamingSessionId !== sessionId)
          return;
        this.micRecovery.stop();
        this.cleanupStreamingAudio();
        this.cleanupStreamingListeners(sessionId);
      });
      await Promise.all([providerStop, captureCleanup, this.cleanupPreview({ dismiss: true })]);
      return true;
    })();

    this._streamingStopPromise = cancelPromise;
    this._streamingStopMode = "cancel";
    try {
      return await cancelPromise;
    } finally {
      if (this._streamingStopPromise === cancelPromise) {
        this._streamingStopPromise = null;
        this._streamingStopMode = null;
      }
      if (this._streamingOperation === operation && this._activeStreamingSessionId === sessionId) {
        if (this._activeStreamingSessionId === sessionId) {
          this._activeStreamingSessionId = null;
        }
        this._endDictationSession(session);
        this.isRecording = false;
        this.isProcessing = false;
        this.isStreaming = false;
        this.onStateChange?.({ isRecording: false, isProcessing: false, isStreaming: false });
      }
    }
  }

  /**
   * Plan 07 (A11): the seal subscription lives for the whole provider stop and
   * finalization, not just while the UI shows streaming. A seal seen at any
   * point, or a typed sealed stop result, makes an empty stream a sealed
   * failure that keeps its audio, never an empty success.
   */
  async _finalizeStreamingRecording(sessionId, options = {}) {
    const seal = { seen: sealedStore.getSealedSnapshot().sealed === true };
    const offSeal = sealedStore.subscribeSealed(() => {
      if (sealedStore.getSealedSnapshot().sealed === true) seal.seen = true;
    });
    try {
      return await this._finalizeStreamingRecordingOwned(sessionId, options, seal);
    } finally {
      offSeal();
    }
  }

  async _finalizeStreamingRecordingOwned(
    sessionId,
    { replay = false, shouldAbandon = neverCancelled } = {},
    seal = { seen: false }
  ) {
    const operation = this._streamingOperation;
    const transport = this._streamingTransport;
    const provider = transport?.adapter;
    const onboardingTake = this._onboardingTake;
    const recording = this._recordingContext ?? { private: this._recordingPrivate === true };
    // A9/A11: this recording's own Plan 04 session, captured before any await.
    const streamSession =
      this._activeSession && this._activeSession.id === recording.sessionId
        ? this._activeSession
        : null;
    if (
      sessionId !== null &&
      sessionId !== undefined &&
      this._activeStreamingSessionId !== sessionId
    ) {
      return false;
    }

    const cancellationGeneration = this._streamingCancellationGeneration;
    const owns = () =>
      this._streamingOperation === operation && this._activeStreamingSessionId === sessionId;
    const wasCancelled = () =>
      shouldAbandon() ||
      cancellationGeneration !== this._streamingCancellationGeneration ||
      !owns();
    if (wasCancelled()) return false;
    const abandonFinalization = async () => {
      if (owns()) {
        this.cleanupStreamingAudio();
        this.cleanupStreamingListeners(sessionId);
        this._streamingFallbackSegments = [];
      }
      try {
        await this._stopStreamingTransport(transport);
      } catch (error) {
        logger.debug(
          "Streaming disconnect after cancellation failed",
          { error: error.message },
          "streaming"
        );
      }
      return true;
    };

    const durationSeconds = replay
      ? this._sessionAudio?.durationSeconds
      : this.recordingStartTime
        ? (Date.now() - this.recordingStartTime) / 1000
        : null;
    const analyticsOccurredAt = new Date(
      replay
        ? this._sessionAudio?.analyticsOccurredAt || Date.now()
        : this.recordingStartTime || Date.now()
    );

    // Enter processing synchronously, before any mic/provider await. This is
    // the authoritative guard that makes a second hotkey a no-op for the full
    // finalization and reasoning interval.
    // Supersede cancelled batch work that may still be settling in the background.
    this._activeProcessingPipeline = null;
    this._cancelAbandonedSegmentMerges();
    this.isRecording = false;
    this.isProcessing = true;
    this.onProcessingStage?.("transcribing");
    this.recordingStartTime = null;
    this.onStateChange?.(
      { isRecording: false, isProcessing: true, isStreaming: false },
      onboardingTake
    );

    this.micRecovery.stop();
    // Let an in-flight mic swap settle so its fallback segment isn't lost and
    // its replacement recorder doesn't outlive this stop.
    if (!replay && this._streamingMicSwapPromise) await this._streamingMicSwapPromise;
    if (wasCancelled()) return abandonFinalization();

    const t0 = performance.now();
    let finalText = this.streamingFinalText || "";

    // 1. Stop the processor — it flushes its remaining buffer on "stop".
    //    Keep isStreaming TRUE so the port.onmessage handler forwards the flush to WebSocket.
    if (!replay && this.streamingProcessor) {
      try {
        this.streamingProcessor.port.postMessage("stop");
        this.streamingProcessor.disconnect();
      } catch (e) {
        // Ignore
      }
      this.streamingProcessor = null;
    }
    if (this.streamingSource) {
      try {
        this.streamingSource.disconnect();
      } catch (e) {
        // Ignore
      }
      this.streamingSource = null;
    }
    this.streamingAnalyser = null;
    this.streamingAudioContext = null;

    // Stop fallback recorder before stopping media tracks
    let fallbackBlob = null;
    if (!replay) await this.finishStreamingFallbackSegment();
    if (wasCancelled()) return abandonFinalization();
    try {
      fallbackBlob = await this.mergeRecordedSegments(
        this._streamingFallbackSegments,
        wasCancelled,
        recording
      );
    } catch (error) {
      if (wasCancelled()) return abandonFinalization();
      logger.warn(
        "Failed to merge streaming fallback audio",
        { error: error.message },
        "streaming"
      );
      if (recording.private) {
        recording.audioBlob = new Blob(
          recording.originalSegments || this._streamingFallbackSegments,
          { type: "audio/webm" }
        );
        this._setOwnedAudio(recording.audioBlob, {
          sessionId: recording.sessionId,
          private: recording.private,
        });
        recording.ownedAudio = this._ownedAudioSnapshot({
          sessionId: recording.sessionId,
          private: recording.private,
        });

        await abandonFinalization();
        this.isProcessing = false;
        this.onStateChange?.(
          { isRecording: false, isProcessing: false, isStreaming: false },
          onboardingTake,
          recording
        );
        this.onError?.(
          {
            title: "Transcription Error",
            description: error.message,
            code: "AUDIO_CONVERSION_FAILED",
          },
          onboardingTake,
          recording
        );
        return false;
      }
      fallbackBlob = this.getLargestRecordedSegment(this._streamingFallbackSegments);
    }
    if (wasCancelled()) return abandonFinalization();
    if (fallbackBlob) {
      this._setOwnedAudio(fallbackBlob, {
        sessionId: recording.sessionId,
        private: recording.private,
      });
      recording.ownedAudio = this._ownedAudioSnapshot({
        sessionId: recording.sessionId,
        private: recording.private,
      });
    }
    this.streamingFallbackRecorder = null;
    this.streamingFallbackChunks = [];
    this._streamingFallbackSegments = [];

    if (this.streamingStream) {
      this.streamingStream.getTracks().forEach((track) => track.stop());
      this.streamingStream = null;
      this._markCaptureStreamReleased();
    }
    const tAudioCleanup = performance.now();

    // 2. Wait for flushed buffer to travel: port -> main thread -> IPC -> WebSocket -> server.
    //    Then mark streaming done so no further audio is forwarded.
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (wasCancelled()) return abandonFinalization();
    this.isStreaming = false;
    const tFlush = performance.now();

    // 3. Finalize tells the provider to process any buffered audio and send final results.
    //    Wait for the transcript to settle before disconnecting.
    provider.finalize?.(operation);
    if (provider.awaitsFinalTranscript) {
      await this.awaitStreamingTextSettled(provider.finalCeilingMs);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (wasCancelled()) return abandonFinalization();
    const tForceEndpoint = performance.now();

    // Keep the typed rejection (code, phase, cause) from the actual stop path.
    let providerStopError = null;
    const stopResult = await this._stopStreamingTransport(transport).catch((e) => {
      providerStopError = e;
      logger.debug("Streaming disconnect error", { error: e?.message }, "streaming");
      return { success: false };
    });
    const tTerminate = performance.now();

    finalText = this.streamingFinalText || "";

    if (!finalText && this.streamingPartialText) {
      finalText = this.streamingPartialText;
      logger.debug("Using partial text as fallback", { textLength: finalText.length }, "streaming");
    }

    if (!finalText && stopResult?.text) {
      finalText = stopResult.text;
      logger.debug(
        "Using disconnect result text as fallback",
        { textLength: finalText.length },
        "streaming"
      );
    }

    this.cleanupStreamingListeners(sessionId);
    if (wasCancelled()) return true;

    // Plan 07: decided only after final, partial and stop-result text are in.
    const sealedStop = isSealedModeError(providerStopError)
      ? providerStopError
      : isSealedModeError(stopResult)
        ? stopResult
        : null;
    if (!replay && (sealedStop || seal.seen)) {
      const phase = sealedPhase(sealedStop) ?? "interrupted";
      if (!finalText) {
        const error =
          sealedStop instanceof Error
            ? sealedStop
            : Object.assign(
                new Error(
                  typeof sealedStop?.error === "string"
                    ? sealedStop.error
                    : "[SEALED_MODE:interrupted] Sealed mode interrupted this dictation; the provider may have received part of it."
                ),
                { code: "SEALED_MODE", phase, details: { phase } }
              );
        return this._preserveSealedStream(error, {
          owned: recording.ownedAudio,
          session: streamSession,
          metadata: { durationSeconds, analyticsOccurredAt: analyticsOccurredAt.toISOString() },
          onboardingTake,
          recording,
        });
      }
      if (phase === "interrupted") {
        // Words already arrived: keep them, and say the provider may have
        // received part of the recording. Cleanup still goes through main's gate.
        this.onError?.(
          {
            code: "SEALED_MODE",
            phase: "interrupted",
            titleKey: "sealedMode.blocked.dictationTitle",
            title: "sealedMode.blocked.dictationTitle",
            messageKey: "sealedMode.interrupted.dictationPartial",
            variant: "default",
          },
          onboardingTake,
          recording
        );
      }
    }

    logger.info(
      "Streaming stop timing",
      {
        durationSeconds,
        audioCleanupMs: Math.round(tAudioCleanup - t0),
        flushWaitMs: Math.round(tForceEndpoint - tAudioCleanup),
        finalSettleMs: Math.round(tForceEndpoint - tFlush),
        terminateRoundTripMs: Math.round(tTerminate - tForceEndpoint),
        totalStopMs: Math.round(tTerminate - t0),
        textLength: finalText.length,
      },
      "streaming"
    );

    const stSettings = this.settings();
    const streamingSttModel = stopResult?.model || "nova-3";
    const rawStreamingText = finalText;
    if (finalText) {
      try {
        finalText = await this.processTranscription(finalText, transport.name, wasCancelled);
      } catch (error) {
        if (wasCancelled()) return true;
        this.pendingSelectionEdit = null;
        this.isProcessing = false;
        this.onStateChange?.(
          { isRecording: false, isProcessing: false, isStreaming: false },
          onboardingTake,
          recording
        );
        this.onError?.(
          {
            title: "Text Processing Failed",
            description: error.message,
            code: error.code,
            messageKey: error.messageKey,
          },
          onboardingTake,
          recording
        );
        if (recording.private) this.releasePrivateAudio(recording.ownedAudio);
        return false;
      }
      if (wasCancelled()) return true;
    }

    if (finalText) {
      const tBeforePaste = performance.now();
      const clientTranscriptionId = crypto.randomUUID();
      const resultAnalyticsOccurredAt = analyticsOccurredAt.toISOString();
      this.lastAudioMetadata = {
        durationMs: durationSeconds
          ? Math.round(durationSeconds * 1000)
          : Math.round(tBeforePaste - t0),
        provider: `${transport.name}-streaming`,
        model: streamingSttModel || null,
      };
      recording.audioMetadata = this.lastAudioMetadata;
      if (wasCancelled()) return true;
      this.onTranscriptionComplete?.(
        {
          success: true,
          text: finalText,
          rawText: rawStreamingText || finalText,
          source: `${transport.name}-streaming`,
          clientTranscriptionId,
          analyticsOccurredAt: resultAnalyticsOccurredAt,
          ...this._takePendingResultExtras(),
        },
        onboardingTake,
        recording
      );

      logger.info(
        "Streaming total processing",
        {
          totalProcessingMs: Math.round(tBeforePaste - t0),
          hasReasoning: stSettings.useCleanupModel || stSettings.useDictationAgent,
        },
        "streaming"
      );
    }

    this.isProcessing = false;
    this.onStateChange?.(
      { isRecording: false, isProcessing: false, isStreaming: false },
      onboardingTake
    );

    if (wasCancelled()) return true;

    if (!finalText) {
      // Match the batch pipeline: settle processing first, then publish the
      // empty outcome so the warning cannot interrupt the thinking transition.
      this.onTranscriptionComplete?.({ success: true, text: "" }, onboardingTake, recording);
    }

    if (recording.private) this.releasePrivateAudio(recording.ownedAudio);

    if (!recording.private && this.shouldUseStreaming()) {
      this.warmupStreamingConnection().catch((e) => {
        logger.debug("Background re-warm failed", { error: e.message }, "streaming");
      });
    }

    if (!replay) this._dropSessionAudio();
    return true;
  }

  shouldShowPreviewCleanupState() {
    const settings = getSettings();
    return (
      !!settings.useCleanupModel ||
      !!settings.useDictationAgent ||
      (this.translationRequested && !!settings.useDictationTranslation)
    );
  }

  async cleanupPreview(options = {}) {
    const { dismiss = false, showCleanup = false } = options;

    // Claim the session's nodes synchronously so a recording started during the
    // flush await can never have its fresh nodes torn down by this cleanup.
    const processor = this._previewProcessor;
    const source = this._previewSource;
    const audioContext = this._previewAudioContext;
    this._previewProcessor = null;
    this._previewSource = null;
    this._previewAudioContext = null;

    let flushed = true;
    if (processor) {
      // The worklet posts all PCM before "flushed", and the PCM sends share the
      // renderer->main pipe with the stop invoke (FIFO), so the final chunk precedes finish.
      let resolveFlush;
      const flushSentinel = new Promise((resolve) => {
        resolveFlush = () => resolve(true);
      });
      let watchdogTimer;
      const watchdogFired = new Promise((resolve) => {
        watchdogTimer = setTimeout(() => resolve(false), PREVIEW_FLUSH_WATCHDOG_MS);
      });
      this._previewFlushResolve = resolveFlush;
      processor.port.postMessage("stop");
      flushed = await Promise.race([flushSentinel, watchdogFired]);
      clearTimeout(watchdogTimer);
      if (this._previewFlushResolve === resolveFlush) this._previewFlushResolve = null;
      processor.disconnect();
    }
    source?.disconnect();
    audioContext?.close().catch(() => {});
    if (dismiss) {
      window.electronAPI?.dismissDictationPreview?.();
      return null;
    }
    return (await window.electronAPI?.stopDictationPreview?.({ showCleanup, flushed })) || null;
  }

  cleanupStreamingAudio() {
    if (this.streamingFallbackRecorder?.state === "recording") {
      try {
        this.streamingFallbackRecorder.stop();
      } catch {}
    }
    this.streamingFallbackRecorder = null;
    this.streamingFallbackChunks = [];

    if (this.streamingProcessor) {
      try {
        this.streamingProcessor.port.postMessage("stop");
        this.streamingProcessor.disconnect();
      } catch (e) {
        // Ignore
      }
      this.streamingProcessor = null;
    }

    if (this.streamingSource) {
      try {
        this.streamingSource.disconnect();
      } catch (e) {
        // Ignore
      }
      this.streamingSource = null;
    }

    this.streamingAnalyser = null;
    this.streamingAudioContext = null;

    if (this.streamingStream) {
      this.streamingStream.getTracks().forEach((track) => track.stop());
      this.streamingStream = null;
      this._markCaptureStreamReleased();
    }

    this.isStreaming = false;
  }

  cleanupStreamingListeners(sessionId = null) {
    if (
      sessionId !== null &&
      sessionId !== undefined &&
      this._activeStreamingSessionId !== sessionId
    ) {
      return;
    }
    for (const cleanup of this.streamingCleanupFns) {
      try {
        cleanup?.();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    this.streamingCleanupFns = [];
    this.streamingFinalText = "";
    this.streamingPartialText = "";
    this.streamingTextBump = null;
    clearTimeout(this.streamingTextDebounce);
    this.streamingTextDebounce = null;
  }

  async cleanupStreaming() {
    const sessionId = this._activeStreamingSessionId;
    this.micRecovery.stop();
    this.cleanupStreamingAudio();
    this.cleanupStreamingListeners(sessionId);
    if (this._activeStreamingSessionId === sessionId) {
      this._activeStreamingSessionId = null;
    }
  }

  cleanup() {
    // Revoke this installation's waiting restores before any asynchronous final
    // audio can land. No permanent disposed flag: setCallbacks may reinstall a
    // deliberately reused manager, while these exact preflights stay revoked.
    this._restoreGeneration = (this._restoreGeneration ?? 0) + 1;
    this.onStateChange = null;
    this.onError = null;
    this.onTranscriptionComplete = null;
    this.onPartialTranscript = null;
    this.onStreamingCommit = null;
    this.onCancelledChange = null;
    this.onProcessingStage = null;
    this.onNoAudio = null;
    this.onTranslationFallback = null;
    for (const preflight of this._restorePreflights ?? []) {
      preflight.disposed = true;
      preflight.end();
      void this._undoWindow()
        .discard(preflight.buffer, "abandoned")
        .catch(() => {});
    }
    this._restorePreflights?.clear();
    // This also joins preflight disposal and earlier closes still saving.
    void this.flushCancelHold().catch(() => {});
    this.isProcessing = false;
    this.retireCapturedCleanup();
    this.micRecovery.stop();
    this._unsubscribeSettings?.();
    this.cancelPreparedMicCapture();
    this._closeBatchPcmTap();
    this.micStreamHold.drop();
    this._setOwnedAudio(null);
    this.lastAudioMetadata = null;
    if (this.isStreaming) {
      this.cleanupStreaming();
    }
    if (this.mediaRecorder?.state === "recording") {
      this.stopRecording();
    }
    if (this.persistentAudioContext && this.persistentAudioContext.state !== "closed") {
      this.persistentAudioContext.close().catch(() => {});
      this.persistentAudioContext = null;
      this.workletModuleLoaded = false;
    }
    if (this.workletBlobUrl) {
      URL.revokeObjectURL(this.workletBlobUrl);
      this.workletBlobUrl = null;
    }
    try {
      void this._stopStreamingTransport(this._streamingTransport).catch(() => {});
    } catch (e) {
      // Ignore errors during cleanup (page may be unloading)
    }
    if (this._onDeviceChange) {
      navigator.mediaDevices?.removeEventListener?.("devicechange", this._onDeviceChange);
    }
  }
}

export { resolveReasoningRoute };
export default AudioManager;
