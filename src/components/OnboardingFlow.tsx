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
} from "../stores/settingsStore";
import { usePermissions } from "../hooks/usePermissions";
import { useToast } from "./ui/useToast";
import { Button } from "./ui/button";
import { Toggle } from "./ui/toggle";
import LanguageSelector from "./ui/LanguageSelector";
import { HotkeyListInput } from "./ui/HotkeyListInput";
import CodexConnection from "./CodexConnection";
import WelcomeScreen from "./onboarding/WelcomeScreen";
import { ArrowRight, Check } from "lucide-react";
import "../styles/onboarding-guided.css";
import { getDefaultHotkey } from "../utils/hotkeys";
import { getCachedPlatform } from "../utils/platform";
import { useAudioRecording } from "../hooks/useAudioRecording";
import {
  DEFAULT_ONBOARDING_SPEECH_MODEL_ID,
  ONBOARDING_SPEECH_MODELS,
  firstCompatibleSpeechModel,
  supportsSpeechLanguage,
} from "../utils/onboardingSpeechModels";
import {
  Mic,
  CheckCircle2,
  CircleAlert,
  Cpu,
  Download,
  Keyboard,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "./icons";
import type {
  OnboardingPreviewConfig,
  OnboardingProgress,
  OnboardingReadiness,
  OnboardingScenario,
  OnboardingStep,
} from "../utils/onboardingState";
import {
  onboardingPreviewStorageKey,
  readOnboardingProgress,
  writeOnboardingProgress,
} from "../utils/onboardingState";

interface Props {
  onComplete: (options?: { openSettings?: boolean }) => void;
  onExplore?: () => void;
  initialStep?: OnboardingStep;
  previewConfig?: OnboardingPreviewConfig;
}

const STEPS: Array<{ id: OnboardingStep; label: string }> = [
  { id: "welcome", label: "Welcome" },
  { id: "speech", label: "Speech" },
  { id: "cleanup", label: "Cleanup" },
  { id: "try", label: "Try dictation" },
  { id: "shortcuts", label: "Use anywhere" },
  { id: "finish", label: "Ready" },
];

const GUIDED_STEP_COPY: Record<
  Exclude<OnboardingStep, "welcome">,
  { title: string; description: string; cues: string[] }
> = {
  speech: {
    title: "Choose the voice you use most.",
    description:
      "Pick a language and a local speech model. Download it only when you're ready to try dictation.",
    cues: [
      "Choose your spoken language",
      "Pick a compatible local model",
      "Download it when you decide",
    ],
  },
  cleanup: {
    title: "Make the transcript easier to read.",
    description:
      "Speech recognition writes your words. Cleanup can improve formatting, but your original transcript stays available.",
    cues: [
      "Cleanup is optional",
      "Local and remote choices stay separate",
      "The original words remain available",
    ],
  },
  try: {
    title: "Make one short dictation.",
    description:
      "Test recording inside Loqui first. This trial is not pasted into another app or saved to history.",
    cues: ["Start when you are ready", "Speak one short sentence", "Review the words inside Loqui"],
  },
  shortcuts: {
    title: "Keep Loqui one shortcut away.",
    description:
      "Shortcut and automatic paste are optional. You can always record inside the Loqui workspace.",
    cues: [
      "Keep or change the shortcut",
      "Choose whether to paste automatically",
      "Review platform permission needs",
    ],
  },
  finish: {
    title: "Your workspace is ready when you are.",
    description: "Enter Loqui now. Unfinished setup stays available when you want to return.",
    cues: ["Open the workspace", "Return to unfinished setup", "Add advanced features later"],
  },
};

const SAMPLE_TRANSCRIPT = "Let's make the next step obvious and keep the work moving.";
type CleanupChoice = "none" | "local" | "codex" | "provider";
type CleanupStatus = "checking" | "pending" | "ready" | "failed" | "skipped";

function displayModelSize(size: string): string {
  return size.replace(/(\d)(MB|GB)$/, "$1 $2");
}

function StepShell({
  step,
  children,
  onBack,
  onContinue,
  onSkip,
  continueLabel = "Continue",
  skipLabel = "Continue later",
  continueDisabled = false,
}: {
  step: Exclude<OnboardingStep, "welcome">;
  children: ReactNode;
  onBack: () => void;
  onContinue: () => void;
  onSkip?: () => void;
  continueLabel?: string;
  skipLabel?: string;
  continueDisabled?: boolean;
}) {
  const index = STEPS.findIndex((item) => item.id === step);
  const mainRef = useRef<HTMLElement>(null);
  const copy = GUIDED_STEP_COPY[step];

  useEffect(() => {
    mainRef.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, [step]);

  return (
    <div className="onboarding-welcome onboarding-guided">
      <header className="onboarding-welcome-header">
        <div className="onboarding-welcome-brand">
          <span className="onboarding-welcome-brand-mark" aria-hidden="true">
            <Mic className="h-5 w-5" />
          </span>
          <span className="onboarding-welcome-brand-copy">
            <strong>Loqui setup</strong>
            <small>A local-first voice workspace</small>
          </span>
        </div>
        <div
          className="onboarding-welcome-progress"
          role="status"
          aria-label={`${STEPS[index].label}, step ${index + 1} of ${STEPS.length}`}
        >
          <div className="onboarding-welcome-progress-label">
            <span>
              Step {index + 1} of {STEPS.length}
            </span>
            <strong>{STEPS[index].label}</strong>
          </div>
          <div className="onboarding-welcome-progress-track" aria-hidden="true">
            {STEPS.map((item, itemIndex) => (
              <i key={item.id} className={itemIndex <= index ? "is-current" : ""} />
            ))}
          </div>
        </div>
      </header>
      <main ref={mainRef} className="onboarding-welcome-split onboarding-guided-split">
        <section className="onboarding-welcome-story onboarding-guided-story">
          <div className="onboarding-welcome-intro">
            <h1 tabIndex={-1}>{copy.title}</h1>
            <p>{copy.description}</p>
          </div>
          <div className="onboarding-guided-cues">
            {copy.cues.map((cue) => (
              <div key={cue}>
                <span aria-hidden="true">
                  <Check size={14} strokeWidth={2.6} />
                </span>
                {cue}
              </div>
            ))}
          </div>
        </section>
        <section className="onboarding-guided-controls" aria-label={`${STEPS[index].label} setup`}>
          {children}
        </section>
      </main>
      <footer className="onboarding-welcome-actions">
        <button className="onboarding-welcome-back" type="button" onClick={onBack}>
          Back
        </button>
        <div>
          {onSkip && (
            <button className="onboarding-welcome-explore" type="button" onClick={onSkip}>
              {skipLabel}
            </button>
          )}
          <button
            className="onboarding-welcome-primary"
            type="button"
            onClick={onContinue}
            disabled={continueDisabled}
          >
            {continueLabel} <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </footer>
    </div>
  );
}

function ChoiceCard({
  selected,
  icon: Icon,
  title,
  description,
  badge,
  compact = false,
  disabled = false,
  onClick,
}: {
  selected: boolean;
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  badge?: string;
  compact?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-recommended={badge === "Recommended" || undefined}
      className={`onboarding-guided-choice w-full rounded-xl border p-4 text-start transition-colors ${compact ? "onboarding-guided-choice-compact" : ""} ${disabled ? "cursor-not-allowed opacity-50" : selected ? "border-primary bg-primary/8 ring-1 ring-primary/20" : "border-border bg-card hover:bg-muted/50"}`}
      aria-pressed={selected}
    >
      <div className="flex items-start gap-3">
        {!compact && (
          <span
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
          >
            <Icon className="h-4 w-4" />
          </span>
        )}
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

function SpeechStep({
  previewConfig,
  speechModelReady,
  downloadState,
  selectedModel,
  onSelectModel,
  onDownload,
}: {
  previewConfig?: OnboardingPreviewConfig;
  speechModelReady: boolean;
  downloadState: "idle" | "downloading" | "ready" | "error";
  selectedModel: string;
  onSelectModel: (model: string) => void;
  onDownload: () => void;
}) {
  const spokenLanguages = useSettingsStore((s) => s.spokenLanguages);
  const preferredLanguage = useSettingsStore((s) => s.preferredLanguage);
  const setSpokenLanguages = useSettingsStore((s) => s.setSpokenLanguages);
  const setPreferredLanguage = useSettingsStore((s) => s.setPreferredLanguage);
  const language =
    spokenLanguages[0] || (preferredLanguage === "auto" ? "en-US" : preferredLanguage) || "en-US";
  const selected =
    ONBOARDING_SPEECH_MODELS.find((model) => model.id === selectedModel) ??
    ONBOARDING_SPEECH_MODELS[0];
  const selectedSupportsLanguage = supportsSpeechLanguage(selected.id, language);
  const compatibleModel = firstCompatibleSpeechModel(language);
  const anyModelSupportsLanguage = Boolean(compatibleModel);
  const recommendedModel = supportsSpeechLanguage(DEFAULT_ONBOARDING_SPEECH_MODEL_ID, language)
    ? DEFAULT_ONBOARDING_SPEECH_MODEL_ID
    : compatibleModel;
  useEffect(() => {
    if (downloadState === "downloading") return;
    if (supportsSpeechLanguage(selectedModel, language)) return;
    const compatible = firstCompatibleSpeechModel(language);
    if (compatible) onSelectModel(compatible);
  }, [downloadState, language, onSelectModel, selectedModel]);
  return (
    <div className="onboarding-guided-work">
      <section className="space-y-3" aria-labelledby="spoken-language-heading">
        <div className="flex items-center gap-2">
          <h2 id="spoken-language-heading" className="text-sm font-semibold">
            What language will you speak?
          </h2>
        </div>
        <LanguageSelector
          value={language}
          onChange={(value) => {
            setSpokenLanguages([value]);
            setPreferredLanguage(value);
          }}
        />
        <p className="text-xs text-muted-foreground">
          {anyModelSupportsLanguage
            ? "Only models that support this language can be selected."
            : "Orukeet and the NVIDIA models do not cover this language. You can choose multilingual Whisper in Speech-to-Text settings after setup."}
        </p>
      </section>
      <section className="space-y-3" aria-labelledby="speech-model-heading">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="speech-model-heading" className="text-sm font-semibold">
              Local speech model
            </h2>
          </div>
          {previewConfig && (
            <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
              Preview: {previewConfig.scenario}
            </span>
          )}
        </div>
        <div className="onboarding-guided-model-list">
          {ONBOARDING_SPEECH_MODELS.map((model) => {
            const supported = supportsSpeechLanguage(model.id, language);
            const languageDescription =
              model.supportedLanguages.length === 1
                ? "English"
                : `${model.supportedLanguages.length} languages`;
            return (
              <ChoiceCard
                key={model.id}
                selected={selectedModel === model.id}
                disabled={!supported || downloadState === "downloading"}
                compact
                icon={Cpu}
                title={model.name}
                description={`${model.organization === "oruk" ? "Oruk" : "NVIDIA"} · ${displayModelSize(model.size)} · ${languageDescription}${model.runtime === "online" ? " · Streaming" : ""}`}
                badge={supported && model.id === recommendedModel ? "Recommended" : undefined}
                onClick={() => onSelectModel(model.id)}
              />
            );
          })}
        </div>
      </section>
      {downloadState === "downloading" && (
        <p className="text-xs text-muted-foreground">
          Model choices are available when this download finishes.
        </p>
      )}
      <div className="onboarding-guided-panel rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">
              {speechModelReady && selectedSupportsLanguage
                ? `${selected.name} is ready`
                : downloadState === "downloading"
                  ? "Downloading speech model…"
                  : "Download the selected model"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {speechModelReady && selectedSupportsLanguage
                ? "You can try a dictation next."
                : !selectedSupportsLanguage
                  ? "Choose a supported model or language before downloading."
                  : downloadState === "error"
                    ? "The download was interrupted. Retry when you are ready."
                    : `${displayModelSize(selected.size)} download · CPU execution remains available.`}
            </p>
          </div>
          {speechModelReady && selectedSupportsLanguage ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          ) : (
            <Button
              onClick={onDownload}
              disabled={downloadState === "downloading" || !selectedSupportsLanguage}
            >
              <Download className="mr-2 h-4 w-4" />
              {downloadState === "downloading" ? "Downloading…" : "Download model"}
            </Button>
          )}
        </div>
        {downloadState === "downloading" && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
          </div>
        )}
      </div>
      {!speechModelReady && (
        <p className="text-xs text-muted-foreground">
          You can continue later and explore notes without a speech model. Dictation stays pending
          until the model is ready.
        </p>
      )}
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
          <CodexConnection />
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
}: {
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
  const config = previewConfig ?? window.loquiBrowserPreviewConfig;
  const progressStorageKey = config ? onboardingPreviewStorageKey(config) : undefined;
  const storedProgress = useMemo(
    () => readOnboardingProgress(progressStorageKey),
    [progressStorageKey]
  );
  const [progress, setProgress] = useState<OnboardingProgress>(storedProgress);
  const [step, setStep] = useState<OnboardingStep>(
    initialStep ?? config?.step ?? storedProgress.step
  );
  const [selectedModel, setSelectedModel] = useState(() => {
    const saved = config
      ? localStorage.getItem(`${onboardingPreviewStorageKey(config)}.speechModel`)
      : useSettingsStore.getState().parakeetModel;
    return ONBOARDING_SPEECH_MODELS.some((model) => model.id === saved)
      ? saved!
      : DEFAULT_ONBOARDING_SPEECH_MODEL_ID;
  });
  const selectedModelRef = useRef(selectedModel);
  const [speechModelReady, setSpeechModelReady] = useState(
    () =>
      config?.scenario === "ready" ||
      Boolean(
        config &&
        localStorage.getItem(`${onboardingPreviewStorageKey(config)}.speechReadyModel`) ===
          selectedModel
      )
  );
  const [downloadState, setDownloadState] = useState<"idle" | "downloading" | "ready" | "error">(
    () =>
      config?.scenario === "downloading" || config?.scenario === "download-interrupted"
        ? "downloading"
        : config?.scenario === "ready" ||
            Boolean(
              config &&
              localStorage.getItem(`${onboardingPreviewStorageKey(config)}.speechReadyModel`) ===
                selectedModel
            )
          ? "ready"
          : "idle"
  );
  const [trialResult, setTrialResult] = useState("");
  const [updatesEnabled, setUpdatesEnabled] = useState(true);
  const useCleanupModel = useSettingsStore((s) => s.useCleanupModel);
  const cleanupMode = useSettingsStore((s) => s.cleanupMode);
  const cleanupProvider = useSettingsStore((s) => s.cleanupProvider);
  const autoPasteEnabled = useSettingsStore((s) => s.autoPasteEnabled);
  const dataRetentionEnabled = useSettingsStore((s) => s.dataRetentionEnabled);
  const setDataRetentionEnabled = useSettingsStore((s) => s.setDataRetentionEnabled);
  const spokenLanguages = useSettingsStore((s) => s.spokenLanguages);
  const preferredLanguage = useSettingsStore((s) => s.preferredLanguage);
  const permissions = usePermissions(undefined, { macAccessibilityChecksEnabled: true });
  const platform =
    config?.platform === "macos"
      ? "darwin"
      : config?.platform === "linux"
        ? "linux"
        : getCachedPlatform();
  const scenario = config?.scenario ?? "fresh";
  const speechLanguage =
    spokenLanguages[0] || (preferredLanguage === "auto" ? "en-US" : preferredLanguage) || "en-US";
  const selectedSpeechSupported = supportsSpeechLanguage(selectedModel, speechLanguage);
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
    if (preview) return;
    let cancelled = false;
    const check = window.electronAPI?.checkParakeetModelStatus;
    if (!check) return;
    void check(selectedModel)
      .then((result) => {
        if (!cancelled) setSpeechModelReady(Boolean(result?.downloaded));
      })
      .catch(() => {
        if (!cancelled) setSpeechModelReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [preview, selectedModel]);

  useEffect(() => {
    if (!preview || scenario !== "download-interrupted" || downloadState !== "downloading") return;
    const timer = window.setTimeout(() => setDownloadState("error"), 700);
    return () => window.clearTimeout(timer);
  }, [downloadState, preview, scenario]);

  useEffect(() => {
    if (!window.electronAPI?.updates?.status) return;
    void window.electronAPI.updates
      .status()
      .then((status) => {
        if (typeof status.enabled === "boolean") setUpdatesEnabled(status.enabled);
      })
      .catch(() => {});
  }, []);

  const persist = useCallback(
    (next: Partial<OnboardingProgress>) => {
      const value = writeOnboardingProgress(next, progressStorageKey);
      setProgress(value);
      return value;
    },
    [progressStorageKey]
  );

  const goTo = useCallback(
    (next: OnboardingStep) => {
      setStep(next);
      persist({ step: next });
    },
    [persist]
  );

  const explore = useCallback(() => {
    persist({ explored: true, step });
    onExplore?.();
    onComplete();
  }, [onComplete, onExplore, persist, step]);

  const finish = useCallback(() => {
    persist({ completed: true, step: "finish" });
    onComplete();
  }, [onComplete, persist]);

  const downloadModel = useCallback(() => {
    const requestedModel = selectedModel;
    setDownloadState("downloading");
    if (preview) {
      window.setTimeout(() => {
        const ready = scenario !== "download-interrupted";
        if (selectedModelRef.current === requestedModel) {
          setDownloadState(ready ? "ready" : "error");
          setSpeechModelReady(ready);
        }
        if (config && ready)
          localStorage.setItem(
            `${onboardingPreviewStorageKey(config)}.speechReadyModel`,
            requestedModel
          );
      }, 500);
      return;
    }
    const download = window.electronAPI?.downloadParakeetModel;
    if (!download) {
      setDownloadState("error");
      return;
    }
    void download(requestedModel)
      .then((result) => {
        if (selectedModelRef.current !== requestedModel) return;
        const ready = Boolean(result?.success && result?.downloaded);
        setSpeechModelReady(ready);
        setDownloadState(ready ? "ready" : "error");
      })
      .catch(() => {
        if (selectedModelRef.current === requestedModel) setDownloadState("error");
      });
  }, [config, preview, scenario, selectedModel]);

  const chooseCleanup = useCallback(
    async (choice: CleanupChoice) => {
      setCleanupChoice(choice);
      const store = useSettingsStore.getState();
      if (choice === "none") {
        store.setUseCleanupModel(false);
        setCleanupStatus("skipped");
        return;
      }
      // Keep the choice visible while the connection/model check runs, but do not
      // activate cleanup until that check succeeds.
      store.setUseCleanupModel(false);
      setCleanupStatus("checking");
      if (choice === "local") {
        store.setCleanupMode("local");
        store.setCleanupProvider("local");
        store.setCleanupModel("qwen3.5-2b-q4_k_m");
        if (preview) {
          setCleanupStatus(scenario === "ready" ? "ready" : "pending");
          if (scenario === "ready") store.setUseCleanupModel(true);
          return;
        }
        try {
          const result = await window.electronAPI?.modelTestLoad?.("qwen3.5-2b-q4_k_m");
          if (result?.success) {
            store.setUseCleanupModel(true);
            setCleanupStatus("ready");
          } else setCleanupStatus("pending");
        } catch {
          setCleanupStatus("pending");
        }
      } else if (choice === "codex") {
        store.setCleanupMode("providers");
        store.setCleanupProvider("codex");
        if (!store.cleanupModel) store.setCleanupModel("gpt-5.4");
        if (preview) {
          const ready = scenario === "ready";
          setCleanupStatus(ready ? "ready" : "failed");
          if (ready) store.setUseCleanupModel(true);
          return;
        }
        try {
          const status = await window.electronAPI?.personalInference?.codexStatus();
          const ready = Boolean(status?.available && status.account?.type === "chatgpt");
          setCleanupStatus(ready ? "ready" : "failed");
          if (ready) store.setUseCleanupModel(true);
        } catch {
          setCleanupStatus("failed");
        }
      } else {
        store.setCleanupMode("providers");
        store.setCleanupProvider("openai");
        if (!store.cleanupModel) store.setCleanupModel("gpt-4o-mini");
        if (preview) {
          const ready = scenario === "ready";
          setCleanupStatus(ready ? "ready" : "failed");
          if (ready) store.setUseCleanupModel(true);
          return;
        }
        try {
          const status = await window.electronAPI?.personalInference?.credentialStatus("openai");
          const ready = Boolean(status?.configured);
          setCleanupStatus(ready ? "ready" : "failed");
          if (ready) store.setUseCleanupModel(true);
        } catch {
          setCleanupStatus("failed");
        }
      }
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
    useSettingsStore.getState().setUseCleanupModel(false);
    setCleanupChoice("none");
    setCleanupStatus("skipped");
  }, []);

  const readiness = useMemo<OnboardingReadiness>(() => {
    const cleanupFailed =
      scenario === "cleanup-failed" ||
      (cleanupChoice === "codex" &&
        (scenario === "codex-missing" || scenario === "codex-expired")) ||
      (cleanupChoice === "provider" && scenario === "invalid-provider-key");
    return {
      microphone: trialResult ? "ready" : scenario === "microphone-denied" ? "failed" : "pending",
      speech:
        speechModelReady && selectedSpeechSupported
          ? "ready"
          : downloadState === "error"
            ? "failed"
            : "pending",
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
    downloadState,
    permissions.accessibilityPermissionGranted,
    platform,
    scenario,
    autoPasteEnabled,
    cleanupChoice,
    cleanupStatus,
    speechModelReady,
    selectedSpeechSupported,
    trialResult,
  ]);

  const handleContinue = () => {
    if (step === "welcome") return goTo("speech");
    if (step === "speech") return goTo("cleanup");
    if (step === "cleanup") {
      applyCleanupToOtherTasks();
      return goTo("try");
    }
    if (step === "try") return goTo("shortcuts");
    if (step === "shortcuts") return goTo("finish");
    return finish();
  };

  const handleBack = () => {
    const index = STEPS.findIndex((item) => item.id === step);
    if (index > 0) goTo(STEPS[index - 1].id);
  };

  const handleSkip = () => {
    if (step === "finish") return finish();
    explore();
  };

  const simulatedTrialReady =
    preview && !["fresh", "downloading", "download-interrupted"].includes(scenario);
  const trialReady = selectedSpeechSupported && (speechModelReady || simulatedTrialReady);
  const trial = preview ? (
    <BrowserTrial scenario={scenario} ready={trialReady} onFinished={onTrialFinished} />
  ) : (
    <DesktopTrial ready={trialReady} onFinished={onTrialFinished} />
  );

  let content: ReactNode = null;
  if (step === "speech")
    content = (
      <SpeechStep
        previewConfig={config}
        speechModelReady={speechModelReady && selectedSpeechSupported}
        downloadState={downloadState}
        selectedModel={selectedModel}
        onSelectModel={(model) => {
          selectedModelRef.current = model;
          setSelectedModel(model);
          if (config) {
            localStorage.setItem(`${onboardingPreviewStorageKey(config)}.speechModel`, model);
          } else {
            const store = useSettingsStore.getState();
            store.setUseLocalWhisper(true);
            store.setLocalTranscriptionProvider("nvidia");
            store.setParakeetModel(model);
          }
          const ready =
            config?.scenario === "ready" ||
            Boolean(
              config &&
              localStorage.getItem(`${onboardingPreviewStorageKey(config)}.speechReadyModel`) ===
                model
            );
          setSpeechModelReady(ready);
          setDownloadState(ready ? "ready" : "idle");
        }}
        onDownload={downloadModel}
      />
    );
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
  if (step === "finish") content = <FinishStep readiness={readiness} onResume={goTo} />;

  if (step === "welcome") {
    return (
      <WelcomeScreen
        updatesEnabled={updatesEnabled}
        onUpdatesChange={(value) => {
          setUpdatesEnabled(value);
          void window.electronAPI?.updates?.preferences?.({ enabled: value });
        }}
        dataRetentionEnabled={dataRetentionEnabled}
        onDataRetentionChange={setDataRetentionEnabled}
        onContinue={handleContinue}
        onExplore={handleSkip}
      />
    );
  }

  return (
    <StepShell
      step={step}
      onBack={handleBack}
      onContinue={handleContinue}
      onSkip={step === "finish" ? undefined : handleSkip}
      continueLabel={step === "finish" ? "Open workspace" : "Continue"}
      skipLabel="Explore first"
    >
      {content}
    </StepShell>
  );
}
