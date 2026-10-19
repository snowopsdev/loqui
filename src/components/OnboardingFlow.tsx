import { useTranslation } from "react-i18next";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  useSettingsStore,
  selectResolvedLLMConfig,
  setResolvedLLMConfig,
  reasoningModelBelongsToProvider,
} from "../stores/settingsStore";
import { usePermissions } from "../hooks/usePermissions";
import { useToast } from "./ui/useToast";
import { Button } from "./ui/button";
import { Toggle } from "./ui/toggle";
import { HotkeyListInput } from "./ui/HotkeyListInput";
import CodexConnection from "./CodexConnection";
import { micPickerModel, selectionFor, type AudioInput } from "../utils/onboardingMic";
import { HelloStep } from "./onboarding/HelloStep";
import { PrivacyDefaults } from "./onboarding/PrivacyDefaults";
import { useMicrophoneAccess } from "./onboarding/useMicrophoneAccess";
import { useMicLevelPreview } from "./onboarding/useMicLevelPreview";
import { MeetLoquiTour } from "./onboarding/MeetLoquiTour";
import { TryStage, usePrefersReducedMotion } from "./onboarding/TryStage";
import {
  shouldAnnounceOffStep,
  voiceFailedNotice,
  voiceReadyNotice,
} from "./onboarding/onboardingNotices";
import { useOnboardingNotifier } from "./onboarding/useOnboardingNotifier";
import "../styles/onboarding-welcome.css";
import "../styles/onboarding-guided.css";
import "../styles/onboarding.css";
import { formatHotkeyLabel, getDefaultHotkey } from "../utils/hotkeys";
import { getCachedPlatform } from "../utils/platform";
import { useAudioRecording } from "../hooks/useAudioRecording";
import {
  Mic,
  CheckCircle2,
  CircleAlert,
  Cpu,
  Keyboard,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "./icons";
import type {
  OnboardingPreviewConfig,
  OnboardingReadiness,
  OnboardingScenario,
  OnboardingStep,
} from "../utils/onboardingState";
import {
  onboardingPreviewStorageKey,
  readOnboardingProgress,
  writeOnboardingProgress,
} from "../utils/onboardingState";
import {
  applyCleanupChoice,
  type CleanupChoice,
  type CleanupModelCatalog,
  type CleanupStatus,
} from "../utils/onboardingCleanup";
import modelRegistryData from "../models/modelRegistryData.json";
import { pickDefaultModelId } from "../models/providerDefaultModel";

import {
  markVisited,
  nextStep,
  previousStep,
  type OnboardingCompleteOptions,
} from "../utils/onboardingFlow";
import { OnboardingShell, type OnboardingShellProps } from "./onboarding/OnboardingShell";
import type { InstrumentRailProps } from "./onboarding/InstrumentRail";

import type { InstrumentMode } from "./onboarding/instrumentMath";
import {
  detectVoice,
  isOnboardingVoice,
  modelDownloadBytes,
  reconcileVoice,
  shouldApplyDetectedVoice,
  spokenLocalesFor,
  voiceSupportsAll,
} from "../utils/onboardingDetection";
import { byteParts } from "../utils/onboardingDownload";
import { useSystemProfile } from "./onboarding/useSystemProfile";
import { useVoiceDownload } from "./onboarding/useVoiceDownload";
import { VoiceStep } from "./onboarding/VoiceStep";
import { DownloadChip } from "./onboarding/DownloadChip";
import { useResolvedRoute } from "../lib/routes";

interface StepView {
  rail: InstrumentRailProps;
  primary?: OnboardingShellProps["primary"];
  onSkip?: () => void;
  finishLaterLabel?: string;
  content: ReactNode;
}

interface Props {
  onComplete: (options?: OnboardingCompleteOptions) => void;
  onExplore?: () => void;
  initialStep?: OnboardingStep;
  previewConfig?: OnboardingPreviewConfig;
}

const cleanupModelCatalog: CleanupModelCatalog = {
  owns: reasoningModelBelongsToProvider,
  defaultModel: (provider) =>
    pickDefaultModelId(modelRegistryData.cloudProviders.find((entry) => entry.id === provider)),
};

const SAMPLE_TRANSCRIPT = "Let's make the next step obvious and keep the work moving.";

function ChoiceCard({
  selected,
  icon: Icon,
  title,
  description,
  badge,
  disabled = false,
  onClick,
}: {
  selected: boolean;
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  badge?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-recommended={badge === "Recommended" || undefined}
      className={`onboarding-guided-choice w-full rounded-xl border p-4 text-start transition-colors ${disabled ? "cursor-not-allowed opacity-50" : selected ? "border-primary bg-primary/8 ring-1 ring-primary/20" : "border-border bg-card hover:bg-muted/50"}`}
      aria-pressed={selected}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-semibold">
            {title}
            {badge && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {badge}
              </span>
            )}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        </span>
        <span
          className={`mt-1 h-4 w-4 rounded-full border-2 ${selected ? "border-primary bg-primary ring-2 ring-primary/20" : "border-muted-foreground/35"}`}
          aria-hidden="true"
        />
      </div>
    </button>
  );
}

function StatusLine({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
      ) : (
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      )}
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function CleanupStep({
  previewConfig,
  onChoice,
  cleanupStatus,
  selectedChoice,
}: {
  previewConfig?: OnboardingPreviewConfig;
  onChoice: (choice: CleanupChoice) => void;
  cleanupStatus: CleanupStatus;
  selectedChoice: CleanupChoice;
}) {
  const selected = selectedChoice;
  const reuseStorageKey = previewConfig
    ? `${onboardingPreviewStorageKey(previewConfig)}.reuseCleanup`
    : "loqui.onboarding.reuseCleanup";
  const [reuse, setReuse] = useState(() => localStorage.getItem(reuseStorageKey) === "true");
  const codexUnavailable =
    previewConfig?.scenario === "codex-missing" || previewConfig?.scenario === "codex-expired";
  const providerInvalid = previewConfig?.scenario === "invalid-provider-key";
  return (
    <div className="onboarding-guided-work">
      <div className="onboarding-guided-section-head">
        <h2>How should Loqui handle cleanup?</h2>
        <span>Optional</span>
      </div>
      <div className="onboarding-guided-cleanup-list">
        <ChoiceCard
          selected={selected === "none"}
          icon={Wand2}
          title="No cleanup"
          description="Keep the raw transcript. Fastest and fully offline."
          onClick={() => onChoice("none")}
        />
        <ChoiceCard
          selected={selected === "local"}
          icon={Cpu}
          title="Local model"
          description="Use Qwen3.5 2B on this device after you download it."
          badge="Recommended"
          onClick={() => onChoice("local")}
        />
        <ChoiceCard
          selected={selected === "codex"}
          icon={Sparkles}
          title="ChatGPT subscription"
          description="Use Codex for text through your ChatGPT sign-in."
          onClick={() => onChoice("codex")}
        />
        <ChoiceCard
          selected={selected === "provider"}
          icon={Wand2}
          title="Provider API key"
          description="Use a direct provider key configured in Language Models."
          onClick={() => onChoice("provider")}
        />
      </div>
      {cleanupStatus !== "skipped" && (
        <div className="onboarding-guided-panel p-4">
          <StatusLine
            ok={cleanupStatus === "ready"}
            label={
              cleanupStatus === "checking"
                ? "Checking cleanup connection…"
                : cleanupStatus === "ready"
                  ? "Cleanup is ready"
                  : cleanupStatus === "failed"
                    ? "Cleanup needs attention"
                    : "Cleanup is still pending"
            }
            detail={
              cleanupStatus === "ready"
                ? "Loqui will use this choice only after the connection or model check succeeds."
                : cleanupStatus === "failed"
                  ? "Retry the connection or choose No cleanup. Your raw transcript remains available."
                  : "You can continue setup. Loqui will not silently activate an unavailable cleanup provider."
            }
          />
        </div>
      )}
      {selected === "codex" && (
        <div className="space-y-2">
          <CodexConnection checkStatusOnMount onSignedInChange={() => onChoice("codex")} />
          {codexUnavailable && (
            <p role="alert" className="text-xs text-destructive">
              Codex is unavailable in this scenario. Retry sign-in or choose another cleanup option.
            </p>
          )}
        </div>
      )}
      {selected === "provider" && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-semibold">Provider keys stay separate</p>
          <p className="mt-1 text-xs text-muted-foreground">
            OpenAI, Anthropic, Gemini, Groq, OpenRouter, and custom compatible endpoints are
            configured in Language Models. No key is entered during this step.
          </p>
          {providerInvalid && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              The simulated provider key was rejected. The raw transcript remains available.
            </p>
          )}
        </div>
      )}
      {selected === "local" && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-semibold">Local cleanup is opt-in</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The model is not downloaded until you start its download in Language Models.
          </p>
        </div>
      )}
      {previewConfig?.scenario === "cleanup-failed" && (
        <p role="alert" className="text-xs text-destructive">
          The cleanup request will fail in this preview. The original transcript will remain intact.
        </p>
      )}
      <label className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
        <input
          type="checkbox"
          dir="ltr"
          checked={reuse}
          onChange={(event) => {
            setReuse(event.target.checked);
            localStorage.setItem(reuseStorageKey, String(event.target.checked));
          }}
          className="mt-0.5"
        />
        <span>
          <span className="block text-sm font-semibold">
            Also use this choice for other text features
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            Apply it only to unconfigured chat, translation, voice assistant, note formatting, and
            meeting-summary tasks. Existing choices stay unchanged.
          </span>
        </span>
      </label>
    </div>
  );
}

function BrowserTrial({
  scenario,
  ready,
  onFinished,
}: {
  scenario: OnboardingScenario;
  ready: boolean;
  onFinished: (text: string, cleaned: boolean) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "processing" | "success" | "error">(
    "idle"
  );
  const [text, setText] = useState("");
  const error =
    scenario === "microphone-denied"
      ? "Microphone permission was denied. You can continue later and grant it from Settings."
      : scenario === "insufficient-memory"
        ? "The selected model could not start because there is not enough memory. Choose a smaller model in Settings."
        : "This preview requires the desktop app to access your microphone.";
  const start = () => {
    if (!ready) return;
    setState("recording");
    window.setTimeout(() => {
      if (scenario === "microphone-denied" || scenario === "insufficient-memory") {
        setState("error");
        return;
      }
      setState("processing");
      window.setTimeout(() => {
        const cleaned = scenario !== "cleanup-failed";
        const finalText = cleaned
          ? SAMPLE_TRANSCRIPT
          : "um let's make the next step obvious and keep the work moving";
        setText(finalText);
        setState("success");
        onFinished(finalText, cleaned);
      }, 350);
    }, 550);
  };
  return (
    <div className="space-y-4">
      <div className="onboarding-guided-record rounded-xl border border-border bg-card p-5">
        <div className="onboarding-guided-record-intro flex items-start gap-3">
          <span
            className={`onboarding-guided-record-icon flex h-10 w-10 items-center justify-center rounded-xl ${state === "recording" ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}
          >
            <Mic className="h-5 w-5" />
          </span>
          <div className="onboarding-guided-record-copy flex-1">
            <p className="text-sm font-semibold">
              {state === "recording"
                ? "Listening…"
                : state === "processing"
                  ? "Preparing your transcript…"
                  : state === "success"
                    ? "Your first dictation"
                    : "Try a short dictation"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {state === "error"
                ? error
                : scenario === "microphone-denied" && state === "idle"
                  ? "Microphone permission was denied in this scenario. Start to review the recovery state."
                  : scenario === "insufficient-memory" && state === "idle"
                    ? "Insufficient memory is simulated for this model. Start to review the recovery state."
                    : !ready
                      ? "Download a speech model on the previous step before testing dictation."
                      : state === "idle"
                        ? "Say a sentence about what you want to work on today."
                        : state === "recording"
                          ? "Speak naturally, then press Stop."
                          : state === "processing"
                            ? "The result stays inside Loqui during setup."
                            : "This trial was not pasted or saved to history."}
            </p>
          </div>
        </div>
        {state === "recording" && (
          <div className="mt-5 flex h-10 items-end gap-1" aria-label="Microphone input level">
            {Array.from({ length: 22 }, (_, index) => (
              <span
                key={index}
                className="w-1.5 animate-pulse rounded-full bg-primary"
                style={{
                  height: `${10 + ((index * 17) % 28)}px`,
                  animationDelay: `${index * 35}ms`,
                }}
              />
            ))}
          </div>
        )}
        {state === "success" && (
          <div className="mt-4 rounded-lg bg-muted/50 p-3 text-sm leading-relaxed">{text}</div>
        )}
        {state === "error" && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive"
          >
            {error}
          </p>
        )}
        <div className="onboarding-guided-record-actions mt-5 flex items-center gap-3">
          <Button
            onClick={start}
            disabled={!ready || state === "recording" || state === "processing"}
          >
            {state === "success"
              ? "Try again"
              : state === "recording"
                ? "Listening…"
                : "Start recording"}
          </Button>
          {state === "recording" && (
            <Button variant="outline" onClick={() => setState("processing")}>
              Stop
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function DesktopTrial({
  ready,
  onFinished,
}: {
  ready: boolean;
  onFinished: (text: string, cleaned: boolean) => void;
}) {
  const { toast } = useToast();
  const [demoId] = useState(() => `onboarding-${Date.now().toString(36)}`);
  const [partial, setPartial] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const onDemoEvent = useCallback((event: { status: string; text?: string; message?: string }) => {
    if (event.status === "partial" || event.status === "processing") setPartial(event.text ?? "");
    if (event.status === "success") setResult(event.text ?? "");
    if (event.status === "error") setError(event.message ?? "Recording failed.");
  }, []);
  const recording = useAudioRecording(toast, { trialMode: true, onDemoEvent });
  useEffect(() => {
    void window.electronAPI?.beginOnboardingDemo?.({ id: demoId, kind: "dictation" });
    return () => {
      void window.electronAPI?.endOnboardingDemo?.(demoId);
    };
  }, [demoId]);
  useEffect(() => {
    if (recording.transcript) {
      setResult(recording.transcript);
      onFinished(recording.transcript, false);
    }
  }, [onFinished, recording.transcript]);
  const start = async () => {
    if (!ready) return;
    setError("");
    await recording.toggleListening();
  };
  return (
    <div className="space-y-4">
      <div className="onboarding-guided-record rounded-xl border border-border bg-card p-5">
        <div className="onboarding-guided-record-intro flex items-start gap-3">
          <span
            className={`onboarding-guided-record-icon flex h-10 w-10 items-center justify-center rounded-xl ${recording.isRecording ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}
          >
            <Mic className="h-5 w-5" />
          </span>
          <div className="onboarding-guided-record-copy">
            <p className="text-sm font-semibold">
              {recording.isRecording
                ? "Listening…"
                : recording.isProcessing
                  ? "Preparing your transcript…"
                  : result
                    ? "Your first dictation"
                    : "Try a short dictation"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {!ready
                ? "Download a speech model on the previous step before testing dictation."
                : recording.isRecording
                  ? "Speak naturally, then use Stop when you are done."
                  : result
                    ? "This trial stays inside Loqui and is not saved to history."
                    : "Request microphone access only when you start."}
            </p>
          </div>
        </div>
        {recording.isRecording && (
          <div className="mt-5 flex h-10 items-end gap-1" aria-label="Microphone input level">
            {Array.from({ length: 22 }, (_, index) => (
              <span
                key={index}
                className="w-1.5 animate-pulse rounded-full bg-primary"
                style={{
                  height: `${10 + ((index * 17) % 28)}px`,
                  animationDelay: `${index * 35}ms`,
                }}
              />
            ))}
          </div>
        )}
        {(partial || result) && (
          <div className="mt-4 rounded-lg bg-muted/50 p-3 text-sm leading-relaxed">
            {result || partial}
          </div>
        )}
        {error && (
          <p role="alert" className="mt-4 text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="onboarding-guided-record-actions mt-5 flex items-center gap-3">
          <Button
            variant="live"
            onClick={start}
            disabled={!ready || recording.isRecording || recording.isProcessing}
          >
            {result ? "Try again" : "Start recording"}
          </Button>
          {recording.isRecording && (
            <Button variant="outline" onClick={() => void recording.stopRecording()}>
              Stop
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ShortcutsStep({
  platform,
  permissions,
}: {
  platform: "darwin" | "linux" | "win32";
  permissions: ReturnType<typeof usePermissions>;
}) {
  const dictationKey = useSettingsStore((s) => s.dictationKey);
  const setDictationKey = useSettingsStore((s) => s.setDictationKey);
  const autoPasteEnabled = useSettingsStore((s) => s.autoPasteEnabled);
  const setAutoPasteEnabled = useSettingsStore((s) => s.setAutoPasteEnabled);
  const hotkey = dictationKey || getDefaultHotkey();
  const simulatedDenied = Boolean(
    window.loquiBrowserPreview && window.loquiBrowserPreviewConfig?.scenario === "microphone-denied"
  );
  const accessibilityReady = simulatedDenied
    ? false
    : permissions.accessibilityPermissionGranted || platform !== "darwin";
  return (
    <div className="onboarding-guided-work">
      <div className="onboarding-guided-section-head">
        <h2>Use Loqui outside this window</h2>
        <span>Optional</span>
      </div>
      <div className="onboarding-guided-panel rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <Keyboard className="mt-0.5 h-5 w-5 text-primary" />
          <div className="flex-1">
            <p className="text-sm font-semibold">Dictation shortcut</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The registered default is platform-specific. Change it here if it conflicts with
              another app.
            </p>
            <div className="mt-3">
              <HotkeyListInput
                value={hotkey}
                onChange={(value) => {
                  setDictationKey(value);
                }}
                required
                maxHotkeys={1}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="onboarding-guided-panel rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Automatic paste</p>
            <p className="mt-1 text-xs text-muted-foreground">
              When enabled, completed dictation is pasted into the focused app. You can turn this
              off later.
            </p>
          </div>
          <Toggle checked={autoPasteEnabled} onChange={setAutoPasteEnabled} />
        </div>
      </div>
      {platform === "darwin" && (
        <div className="onboarding-guided-panel rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-semibold">Accessibility permission</p>
              <p className="mt-1 text-xs text-muted-foreground">
                macOS needs this for global shortcuts and pasting into other apps.
              </p>
              {accessibilityReady ? (
                <p className="mt-3 text-xs font-medium text-emerald-600">Permission ready.</p>
              ) : (
                <Button
                  className="mt-3"
                  size="sm"
                  onClick={() => {
                    if (window.loquiBrowserPreview) return;
                    void permissions.requestAccessibilityPermission();
                  }}
                >
                  Grant access
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      {platform === "linux" && (
        <p className="rounded-lg border border-border/70 bg-muted/25 p-3 text-xs text-muted-foreground">
          Linux paste support depends on your desktop session. Loqui will show the exact helper
          guidance in Settings if a paste tool is missing.
        </p>
      )}
    </div>
  );
}

function FinishStep({
  readiness,
  onResume,
  privacy,
}: {
  privacy: ReactNode;
  readiness: OnboardingReadiness;
  onResume: (step: OnboardingStep) => void;
}) {
  const items: Array<[keyof OnboardingReadiness, string, string, OnboardingStep]> = [
    ["speech", "Speech model", "Choose and download a local speech model.", "speech"],
    ["microphone", "Microphone", "Start a trial recording to confirm access.", "try"],
    ["cleanup", "Text cleanup", "Optional. Raw transcripts work without it.", "cleanup"],
    ["shortcut", "Shortcut and paste", "Optional for using Loqui in other apps.", "shortcuts"],
  ];
  return (
    <div className="onboarding-guided-work">
      <div className="onboarding-guided-section-head">
        <h2>Your setup at a glance</h2>
        <span>Finish anytime</span>
      </div>
      <div className="onboarding-guided-readiness space-y-2">
        {items.map(([key, label, detail, step]) => {
          const state = readiness[key];
          const ok = state === "ready" || state === "skipped";
          const status =
            state === "ready"
              ? "Ready"
              : state === "skipped"
                ? "Optional"
                : state === "checking"
                  ? "Checking"
                  : state === "failed"
                    ? "Needs attention"
                    : "Pending";
          const description =
            state === "ready"
              ? key === "speech"
                ? "Local model ready."
                : key === "microphone"
                  ? "Trial dictation captured."
                  : `${label} is ready.`
              : state === "skipped"
                ? key === "cleanup"
                  ? "Raw transcripts work without cleanup."
                  : "Record inside Loqui without automatic paste."
                : detail;
          return (
            <button
              type="button"
              key={key}
              onClick={() => onResume(step)}
              className="onboarding-guided-readiness-row flex w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-start hover:bg-muted/40"
            >
              <span className="mt-0.5">
                {ok ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <CircleAlert className="h-4 w-4 text-amber-500" />
                )}
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold">{label}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
              </span>
              <span className="text-xs text-muted-foreground">{status}</span>
            </button>
          );
        })}
      </div>
      {privacy}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs leading-relaxed text-muted-foreground">
        <p className="font-semibold text-foreground">Next</p>
        <p className="mt-1">
          Open Notes to edit a sample note, or use Record from the workspace. Meetings, calendar
          connections, search models, and advanced providers can be configured later.
        </p>
      </div>
    </div>
  );
}

export default function OnboardingFlow({
  onComplete,
  onExplore,
  initialStep,
  previewConfig,
}: Props) {
  const preview = Boolean(import.meta.env.DEV && window.loquiBrowserPreview);
  const config = previewConfig;
  const progressStorageKey = config ? onboardingPreviewStorageKey(config) : undefined;
  const storedProgress = useMemo(
    () => readOnboardingProgress(progressStorageKey),
    [progressStorageKey]
  );
  const firstStep = initialStep ?? config?.step ?? storedProgress.step;
  const [step, setStep] = useState<OnboardingStep>(firstStep);
  const [visited, setVisited] = useState<OnboardingStep[]>(() =>
    markVisited(storedProgress.visited, firstStep)
  );
  useEffect(() => {
    writeOnboardingProgress({ step, visited }, progressStorageKey);
  }, [progressStorageKey, step, visited]);
  const { t } = useTranslation();
  const [trialResult, setTrialResult] = useState("");
  const [updatesEnabled, setUpdatesEnabled] = useState(true);
  const useCleanupModel = useSettingsStore((s) => s.useCleanupModel);
  const cleanupMode = useSettingsStore((s) => s.cleanupMode);
  const cleanupProvider = useSettingsStore((s) => s.cleanupProvider);
  const autoPasteEnabled = useSettingsStore((s) => s.autoPasteEnabled);
  const dataRetentionEnabled = useSettingsStore((s) => s.dataRetentionEnabled);
  const setDataRetentionEnabled = useSettingsStore((s) => s.setDataRetentionEnabled);
  const permissions = usePermissions(undefined, { macAccessibilityChecksEnabled: true });
  const platform = (
    config?.platform === "macos"
      ? "darwin"
      : config?.platform === "linux"
        ? "linux"
        : getCachedPlatform()
  ) as "darwin" | "linux" | "win32";
  const device = platform === "darwin" ? "Mac" : "Other";
  // T12: the existing dictation preference is the only microphone selection authority.
  const mic = useMicrophoneAccess();
  const micMode = useSettingsStore((s) => s.microphoneSelectionMode);
  const micId = useSettingsStore((s) => s.selectedMicDeviceId);
  const micLabel = useSettingsStore((s) => s.selectedMicDeviceLabel);
  const [helloInputs, setHelloInputs] = useState<AudioInput[]>([]);
  const micPicker = micPickerModel(helloInputs, micMode, micId, micLabel);
  const helloPreview = useMicLevelPreview(
    step === "welcome" && mic.access === "granted",
    micPicker.previewDeviceId
  );
  // T18 consumes this device-bound evidence. Never transfer an old device's proof.
  const micSelection = JSON.stringify([micMode, micId, micLabel, micPicker.previewDeviceId]);
  const [micHeardSelection, setMicHeard] = useState<string | null>(null);
  const listeningSelection = useRef<string | null>(null);
  useEffect(() => {
    setMicHeard(null);
  }, [micSelection]);
  useEffect(() => setHelloInputs(helloPreview.inputs), [helloPreview.inputs]);
  useEffect(() => {
    if (helloPreview.status !== "live") listeningSelection.current = null;
    else {
      listeningSelection.current ??= micSelection;
      if (helloPreview.heardVoice && listeningSelection.current === micSelection)
        setMicHeard(micSelection);
    }
  }, [helloPreview.status, helloPreview.heardVoice, micSelection]);
  // Until T18, the legacy readiness list continues to use its trial evidence.
  const micHeard = micHeardSelection === micSelection;
  void micHeard;
  const pickMicrophone = (value: string) => {
    setMicHeard(null);
    const { mode, device: picked } = selectionFor(value, helloInputs);
    const store = useSettingsStore.getState();
    if (picked) store.setSelectedMicDevice(picked.deviceId, picked.label);
    store.setMicrophoneSelectionMode(mode);
  };
  const changeUpdates = (value: boolean) => {
    setUpdatesEnabled(value);
    void window.electronAPI?.updates?.preferences?.({ enabled: value });
  };

  const scenario = config?.scenario ?? "fresh";
  const initialCleanupChoice: CleanupChoice = !useCleanupModel
    ? "none"
    : cleanupMode === "local"
      ? "local"
      : cleanupProvider === "codex"
        ? "codex"
        : cleanupMode === "providers"
          ? "provider"
          : "none";
  const [cleanupChoice, setCleanupChoice] = useState<CleanupChoice>(initialCleanupChoice);
  const [cleanupStatus, setCleanupStatus] = useState<CleanupStatus>(
    useCleanupModel ? "ready" : "skipped"
  );

  useEffect(() => {
    if (!window.electronAPI?.updates?.status) return;
    void window.electronAPI.updates
      .status()
      .then((status) => {
        if (typeof status.enabled === "boolean") setUpdatesEnabled(status.enabled);
      })
      .catch(() => {});
  }, []);

  const goTo = useCallback((next: OnboardingStep) => {
    setStep(next);
    setVisited((current) => markVisited(current, next));
  }, []);
  const finish = useCallback(
    (options?: OnboardingCompleteOptions) => {
      writeOnboardingProgress({ completed: true, step: "finish" }, progressStorageKey);
      onComplete(options);
    },
    [onComplete, progressStorageKey]
  );
  const finishLater = useCallback(() => {
    writeOnboardingProgress({ explored: true, step, visited }, progressStorageKey);
    onExplore?.();
    onComplete();
  }, [onComplete, onExplore, progressStorageKey, step, visited]);
  const skip = () => {
    const next = nextStep(step);
    if (next) goTo(next);
    else finish();
  };
  const back = () => {
    const previous = previousStep(step);
    if (previous) goTo(previous);
  };
  const advance = () => {
    if (step === "cleanup") applyCleanupToOtherTasks();
    skip();
  };

  // T14: unconditional subscription across every step; T15 replaces these shortcut bindings.
  const reducedMotion = usePrefersReducedMotion();
  const hotkeyLabel = formatHotkeyLabel(
    useSettingsStore((s) => s.dictationKey) || getDefaultHotkey()
  );
  const activationMode = useSettingsStore((s) => s.activationMode);

  // [T13] Voice: detection, explicit commit, per-model download
  const profile = useSystemProfile();
  const pick = useMemo(() => (profile ? detectVoice(profile) : null), [profile]);
  // undefined = untouched, so the detected pick applies; null = deliberately no compatible voice
  // (a language no on-device voice hears). Only undefined falls back to detection (R2-I04).
  const [chosenModel, setChosenModel] = useState<string | null | undefined>(() => {
    const stored = localStorage.getItem("parakeetModel");
    return !shouldApplyDetectedVoice(stored) && isOnboardingVoice(stored) ? stored : undefined;
  });
  const [chosenLanguage, setChosenLanguage] = useState<string | null>(null);
  const spokenLanguages = chosenLanguage
    ? [chosenLanguage]
    : spokenLocalesFor(profile?.locales ?? [], pick?.languages ?? []);
  const selectedModel = chosenModel === undefined ? (pick?.modelId ?? null) : chosenModel;
  const voiceCompatible =
    selectedModel !== null && voiceSupportsAll(selectedModel, spokenLanguages);
  const voiceDownload = useVoiceDownload(selectedModel);
  const selectedVoiceRef = useRef(selectedModel);
  selectedVoiceRef.current = selectedModel;
  const voiceState = voiceDownload.state;
  const voiceStatus = voiceState.status;
  const voiceBusy =
    voiceStatus === "downloading" || voiceStatus === "installing" || voiceStatus === "cancelling";
  const changeModel = (modelId: string) => {
    if (voiceBusy || !isOnboardingVoice(modelId) || !voiceSupportsAll(modelId, spokenLanguages))
      return;
    setChosenModel(modelId);
  };
  const changeLanguage = (language: string) => {
    if (voiceBusy) return; // locked while a transfer runs (I03)
    setChosenLanguage(language);
    setChosenModel(reconcileVoice(selectedModel, [language]).modelId);
  };
  // I02: dictation becomes local, including from self-hosted. Meeting and upload routes stay as they are.
  const commitVoice = (): boolean => {
    if (
      !selectedModel ||
      !voiceCompatible ||
      voiceStatus === "checking" ||
      voiceStatus === "cancelling"
    )
      return false;
    const store = useSettingsStore.getState();
    store.setTranscriptionMode("local");
    store.setUseLocalWhisper(true);
    store.setLocalTranscriptionProvider("nvidia");
    store.setParakeetModel(selectedModel);
    store.setSpokenLanguages(spokenLanguages);
    if (spokenLanguages[0]) store.setPreferredLanguage(spokenLanguages[0]);
    return true;
  };
  const voicePrimary = () => {
    if (!commitVoice()) return;
    if (voiceStatus === "idle" || voiceStatus === "error" || voiceStatus === "cancelled")
      voiceDownload.start();
    goTo("try");
  };
  const transcriptionMode = useSettingsStore((s) => s.transcriptionMode);
  const localProvider = useSettingsStore((s) => s.localTranscriptionProvider);
  const parakeetModel = useSettingsStore((s) => s.parakeetModel);
  // F04: installation is a candidate fact, never authority to admit recording.
  // Plan03's resolved route remains the readiness authority; no new renderer readiness flags.
  const dictationRoute = useResolvedRoute("dictationStt");
  const voiceCommitted =
    voiceCompatible &&
    transcriptionMode === "local" &&
    localProvider === "nvidia" &&
    parakeetModel === selectedModel;
  const localVoiceActive =
    voiceStatus === "ready" &&
    voiceCommitted &&
    dictationRoute.locality === "device" &&
    dictationRoute.host === null &&
    dictationRoute.state.status === "ready";
  const downloadRail: InstrumentMode | null =
    voiceState.status === "downloading"
      ? {
          kind: "download",
          percent: voiceState.percent,
          downloadedBytes: voiceState.downloadedBytes,
          totalBytes: voiceState.totalBytes,
        }
      : voiceStatus === "error"
        ? { kind: "error", reason: "download" }
        : null;
  const voiceSize = byteParts(selectedModel ? (modelDownloadBytes(selectedModel) ?? 0) : 0);

  // Fence notices and announcements to an observed transfer for this model.
  // Installed snapshots and navigation cannot create or replay a receipt.
  const {
    milestone: voiceMilestone,
    transferId: voiceTransferId,
    start: startVoiceDownload,
  } = voiceDownload;
  const notify = useOnboardingNotifier();
  const transfers = useRef(
    new Map<string, { id: number; settled: boolean; milestones: Set<number> }>()
  );
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (!selectedModel || voiceTransferId === null) return;
    let transfer = transfers.current.get(selectedModel);
    if (transfer?.id !== voiceTransferId) {
      transfer = { id: voiceTransferId, settled: false, milestones: new Set() };
      transfers.current.set(selectedModel, transfer);
      setAnnouncement("");
    }
    if (transfer.settled) return;
    if (voiceStatus === "downloading" || voiceStatus === "installing") {
      const milestone = voiceMilestone;
      if (milestone !== null && !transfer.milestones.has(milestone)) {
        transfer.milestones.add(milestone);
        setAnnouncement(t("setupFlow.download.announcePercent", { percent: milestone }));
      }
      return;
    }
    if (voiceStatus !== "ready" && voiceStatus !== "error" && voiceStatus !== "cancelled") return;
    transfer.settled = true;
    if (voiceStatus === "ready") {
      setAnnouncement(t("setupFlow.download.announceReady"));
      if (shouldAnnounceOffStep(step)) notify(voiceReadyNotice(t));
    } else if (voiceState.status === "error" && shouldAnnounceOffStep(step)) {
      const failedModel = selectedModel;
      notify(
        voiceFailedNotice(t, voiceState.message, () => {
          const store = useSettingsStore.getState();
          if (
            store.transcriptionMode === "local" &&
            store.localTranscriptionProvider === "nvidia" &&
            store.parakeetModel === failedModel &&
            selectedVoiceRef.current === failedModel
          ) {
            startVoiceDownload();
          } else goTo("speech");
        })
      );
    }
  }, [
    goTo,
    notify,
    selectedModel,
    step,
    t,
    voiceMilestone,
    voiceTransferId,
    startVoiceDownload,
    voiceState,
    voiceStatus,
  ]);

  const cleanupRequestRef = useRef(0);
  const closedRef = useRef(false);
  useEffect(() => {
    closedRef.current = false;
    return () => {
      // Finishing or leaving setup supersedes any check still in flight.
      closedRef.current = true;
      cleanupRequestRef.current += 1;
    };
  }, []);
  const chooseCleanup = useCallback(
    async (choice: CleanupChoice) => {
      if (closedRef.current) return;
      // Each pick supersedes the one before it: a check still in flight for an
      // earlier option must not activate cleanup after the user moved on.
      const request = ++cleanupRequestRef.current;
      setCleanupChoice(choice);
      await applyCleanupChoice({
        choice,
        settings: useSettingsStore.getState(),
        bridge: window.electronAPI,
        catalog: cleanupModelCatalog,
        preview,
        scenario,
        setStatus: setCleanupStatus,
        isCurrent: () => cleanupRequestRef.current === request,
      });
    },
    [preview, scenario]
  );

  const applyCleanupToOtherTasks = useCallback(() => {
    const reuseStorageKey = config
      ? `${onboardingPreviewStorageKey(config)}.reuseCleanup`
      : "loqui.onboarding.reuseCleanup";
    if (
      cleanupChoice === "none" ||
      cleanupStatus !== "ready" ||
      localStorage.getItem(reuseStorageKey) !== "true"
    )
      return;
    const source = selectResolvedLLMConfig(useSettingsStore.getState(), "dictationCleanup");
    const scopes = [
      "chatIntelligence",
      "dictationTranslation",
      "dictationAgent",
      "noteFormatting",
    ] as const;
    scopes.forEach((scope) => {
      const current = selectResolvedLLMConfig(useSettingsStore.getState(), scope);
      if (current.model) return;
      setResolvedLLMConfig(scope, {
        mode: source.mode,
        provider: source.provider,
        model: source.model,
        cloudMode: source.cloudMode,
        cloudBaseUrl: source.cloudBaseUrl,
        remoteUrl: source.remoteUrl,
      });
    });
  }, [cleanupChoice, cleanupStatus, config]);

  const onTrialFinished = useCallback((text: string) => {
    setTrialResult(text);
  }, []);

  const disableCleanupForTrial = useCallback(() => {
    void chooseCleanup("none");
  }, [chooseCleanup]);

  const readiness = useMemo<OnboardingReadiness>(() => {
    const cleanupFailed =
      scenario === "cleanup-failed" ||
      (cleanupChoice === "codex" &&
        (scenario === "codex-missing" || scenario === "codex-expired")) ||
      (cleanupChoice === "provider" && scenario === "invalid-provider-key");
    return {
      microphone: trialResult ? "ready" : scenario === "microphone-denied" ? "failed" : "pending",
      speech: localVoiceActive ? "ready" : voiceStatus === "error" ? "failed" : "pending",
      cleanup:
        cleanupChoice === "none"
          ? "skipped"
          : cleanupFailed || cleanupStatus === "failed"
            ? "failed"
            : cleanupStatus === "ready"
              ? "ready"
              : cleanupStatus === "checking"
                ? "checking"
                : "pending",
      shortcut: !autoPasteEnabled
        ? "skipped"
        : platform === "darwin"
          ? permissions.accessibilityPermissionGranted
            ? "ready"
            : "pending"
          : "ready",
    };
  }, [
    voiceStatus,
    permissions.accessibilityPermissionGranted,
    platform,
    scenario,
    autoPasteEnabled,
    cleanupChoice,
    cleanupStatus,
    localVoiceActive,
    trialResult,
  ]);

  const trial = !localVoiceActive ? (
    <p role="status" className="onb-muted">
      {t("setupFlow.voice.commitToTry")}
    </p>
  ) : preview ? (
    <BrowserTrial scenario={scenario} ready={localVoiceActive} onFinished={onTrialFinished} />
  ) : (
    <DesktopTrial ready={localVoiceActive} onFinished={onTrialFinished} />
  );

  let content: ReactNode = null;
  if (step === "cleanup")
    content = (
      <CleanupStep
        previewConfig={config}
        onChoice={chooseCleanup}
        cleanupStatus={cleanupStatus}
        selectedChoice={cleanupChoice}
      />
    );
  if (step === "try")
    content = (
      <div className="onboarding-guided-work">
        <div className="onboarding-guided-section-head">
          <h2>Record inside Loqui</h2>
          <span>Practice</span>
        </div>
        {trial}
        <div className="onboarding-guided-panel p-4 text-xs leading-relaxed text-muted-foreground">
          No automatic paste. Trial audio and text are not saved to history. Microphone access is
          requested only when you start.
        </div>
        {cleanupChoice !== "none" && (
          <Button variant="ghost" onClick={disableCleanupForTrial}>
            Try without cleanup
          </Button>
        )}
      </div>
    );
  if (step === "shortcuts")
    content = <ShortcutsStep platform={platform} permissions={permissions} />;
  if (step === "finish")
    content = (
      <FinishStep
        readiness={readiness}
        onResume={goTo}
        privacy={
          <PrivacyDefaults
            platform={platform}
            historyEnabled={dataRetentionEnabled}
            onHistoryChange={setDataRetentionEnabled}
            updatesEnabled={updatesEnabled}
            onUpdatesChange={changeUpdates}
          />
        }
      />
    );

  // T11 interim: keep each legacy body until its owning step task replaces it.
  const legacy = (node: ReactNode) => (
    <div className="onboarding-welcome onboarding-guided onb-legacy">{node}</div>
  );
  const stepView = (): StepView => {
    if (step === "welcome")
      return {
        rail: {
          title: t(`setupFlow.rail.${step}.title`),
          body: t(`setupFlow.rail.${step}.body${device}`),
          mode:
            helloPreview.status === "live"
              ? { kind: "listening", heardVoice: helloPreview.heardVoice }
              : { kind: "idle" },
          readLevel: helloPreview.readLevel,
        },
        primary: { label: t("setupFlow.hello.start"), onClick: advance },
        finishLaterLabel: t("setupFlow.lookAroundFirst"),
        content: (
          <HelloStep
            platform={platform}
            access={mic.access}
            preview={helloPreview}
            picker={micPicker}
            onPickMicrophone={pickMicrophone}
            onAllow={() => void mic.request()}
            onRecheck={() => void mic.check()}
          />
        ),
      };
    if (step === "speech")
      return {
        rail: {
          title: t(`setupFlow.rail.${step}.title`),
          body: t(`setupFlow.rail.${step}.body${device}`),
          mode: downloadRail ?? { kind: "idle" },
        },
        primary: {
          label:
            voiceStatus === "ready" || voiceBusy
              ? t("setupFlow.continue")
              : t("setupFlow.voice.download", {
                  size: t(`setupFlow.units.${voiceSize.unit}`, { value: voiceSize.value }),
                }),
          onClick: voicePrimary,
          disabled: !voiceCompatible || voiceStatus === "checking" || voiceStatus === "cancelling",
          describedBy: voiceCompatible ? undefined : "onb-voice-blocked",
        },
        onSkip: skip,
        finishLaterLabel: t("setupFlow.finishLater"),
        content: (
          <VoiceStep
            platform={platform}
            profile={profile}
            pick={pick}
            selectedModel={selectedModel}
            onSelectModel={changeModel}
            language={chosenLanguage ?? spokenLanguages[0] ?? profile?.locales[0] ?? "en-US"}
            onLanguageChange={changeLanguage}
            spokenLanguages={spokenLanguages}
            languageLocked={voiceBusy}
            compatible={voiceCompatible}
            blockedId="onb-voice-blocked"
            download={voiceState}
            onStartDownload={voiceDownload.start}
            onCancelDownload={() => void voiceDownload.cancel()}
          />
        ),
      };
    if (step === "try")
      return {
        rail: {
          title: t("setupFlow.rail.try.title"),
          body: t(`setupFlow.rail.try.body${device}`),
          mode: downloadRail ?? { kind: "idle" },
        },
        onSkip: skip,
        finishLaterLabel: t("setupFlow.finishLater"),
        content: (
          <TryStage
            key={selectedModel}
            download={voiceState}
            voiceCommitted={voiceCommitted}
            trialReady={localVoiceActive}
            onStart={() => (voiceCommitted ? voiceDownload.start() : goTo("speech"))}
            onCancel={() => void voiceDownload.cancel()}
            onChooseVoice={() => goTo("speech")}
            tour={
              <MeetLoquiTour
                hotkeyLabel={hotkeyLabel}
                activationMode={activationMode}
                platform={platform}
                reducedMotion={reducedMotion}
              />
            }
          >
            {legacy(content)}
          </TryStage>
        ),
      };
    return {
      rail: {
        title: t(`setupFlow.rail.${step}.title`),
        body: t(`setupFlow.rail.${step}.body${device}`),
        mode: { kind: "idle" },
      },
      primary:
        step === "finish"
          ? { label: t("setupFlow.rail.finish.openWorkspace"), onClick: () => finish() }
          : { label: t("setupFlow.continue"), onClick: advance },
      onSkip: step === "finish" ? undefined : skip,
      finishLaterLabel: t("setupFlow.finishLater"),
      content: legacy(content),
    };
  };
  const view = stepView();
  return (
    <OnboardingShell
      step={step}
      visited={visited}
      platform={platform}
      rail={view.rail}
      onNavigate={goTo}
      onBack={step === "welcome" ? undefined : back}
      onSkip={view.onSkip}
      finishLater={
        view.finishLaterLabel ? { label: view.finishLaterLabel, onClick: finishLater } : undefined
      }
      primary={view.primary}
      announcement={announcement}
      footerStart={
        step === "speech" || step === "try" ? undefined : (
          <DownloadChip state={voiceState} onStart={voiceDownload.start} />
        )
      }
    >
      {view.content}
    </OnboardingShell>
  );
}
