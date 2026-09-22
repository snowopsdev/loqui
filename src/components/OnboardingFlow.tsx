import {
  useCallback,
  useEffect,
  useMemo,
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
import { useSettings } from "../hooks/useSettings";
import { useToast } from "./ui/useToast";
import { Button } from "./ui/button";
import { Toggle } from "./ui/toggle";
import LanguageSelector from "./ui/LanguageSelector";
import { HotkeyListInput } from "./ui/HotkeyListInput";
import CodexConnection from "./CodexConnection";
import { getDefaultHotkey } from "../utils/hotkeys";
import { getCachedPlatform } from "../utils/platform";
import { useAudioRecording } from "../hooks/useAudioRecording";
import {
  Mic,
  CheckCircle2,
  CircleAlert,
  Cpu,
  Download,
  Keyboard,
  Languages,
  Lock,
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

const SPEECH_MODELS = [
  {
    id: "parakeet-unified-en-0.6b",
    name: "Parakeet Unified EN 0.6B",
    description: "Fast, accurate English speech recognition for CPU and supported GPU paths.",
    size: "631 MB",
    languages: ["en"],
  },
  {
    id: "parakeet-tdt-0.6b-v3",
    name: "Parakeet TDT 0.6B",
    description: "Multilingual speech recognition with automatic language detection.",
    size: "680 MB",
    languages: [
      "bg",
      "cs",
      "da",
      "de",
      "el",
      "en",
      "es",
      "fi",
      "fr",
      "hr",
      "hu",
      "it",
      "lt",
      "lv",
      "mt",
      "nl",
      "pl",
      "pt",
      "ro",
      "ru",
      "sk",
      "sl",
      "sv",
      "uk",
    ],
  },
] as const;

const SAMPLE_TRANSCRIPT = "Let's make the next step obvious and keep the work moving.";
type CleanupChoice = "none" | "local" | "codex" | "provider";
type CleanupStatus = "checking" | "pending" | "ready" | "failed" | "skipped";

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
  step: OnboardingStep;
  children: ReactNode;
  onBack: () => void;
  onContinue: () => void;
  onSkip?: () => void;
  continueLabel?: string;
  skipLabel?: string;
  continueDisabled?: boolean;
}) {
  const index = STEPS.findIndex((item) => item.id === step);
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="shrink-0 border-b px-5 py-4 sm:px-10 sm:py-6">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary"
            aria-hidden="true"
          >
            <Mic className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight">Loqui setup</p>
            <p className="text-xs text-muted-foreground">A local-first voice workspace</p>
          </div>
        </div>
        <div
          className="mx-auto mt-5 max-w-3xl"
          aria-label={`Onboarding step ${index + 1} of ${STEPS.length}`}
        >
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Step {index + 1} of {STEPS.length}
            </span>
            <span className="font-medium text-foreground">{STEPS[index]?.label}</span>
          </div>
          <div className="mt-2 grid grid-cols-6 gap-1" aria-hidden="true">
            {STEPS.map((item, itemIndex) => (
              <div
                key={item.id}
                className={`h-1 rounded-full ${itemIndex <= index ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </div>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-10 sm:py-8">
        <div className="mx-auto max-w-3xl">{children}</div>
      </main>
      <footer className="shrink-0 border-t px-5 py-3 sm:px-10 sm:py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <Button variant="outline" onClick={onBack} disabled={index === 0}>
            Back
          </Button>
          <div className="flex items-center gap-3">
            {onSkip && (
              <Button variant="ghost" onClick={onSkip}>
                {skipLabel ?? "Continue later"}
              </Button>
            )}
            <Button onClick={onContinue} disabled={continueDisabled}>
              {continueLabel}
            </Button>
          </div>
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
  onClick,
}: {
  selected: boolean;
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border p-4 text-start transition-colors ${selected ? "border-primary bg-primary/8 ring-1 ring-primary/20" : "border-border bg-card hover:bg-muted/50"}`}
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
    <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5">
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

function WelcomeStep({
  updatesEnabled,
  setUpdatesEnabled,
  dataRetentionEnabled,
  setDataRetentionEnabled,
}: {
  updatesEnabled: boolean;
  setUpdatesEnabled: (value: boolean) => void;
  dataRetentionEnabled: boolean;
  setDataRetentionEnabled: (value: boolean) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Start with your voice
        </p>
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          A quieter way to get words out.
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
          Loqui turns speech into notes and text. Your local workspace stays on this device, and you
          choose if any text is sent to a provider.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatusLine
          ok
          label="Local by default"
          detail="Speech can run on-device after the model is downloaded."
        />
        <StatusLine
          ok
          label="Your choice"
          detail="Cleanup can use a local model, Codex, an API key, or nothing."
        />
        <StatusLine
          ok
          label="Easy to revisit"
          detail="You can change providers and permissions later in Settings."
        />
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-semibold">Before you begin</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Loqui keeps transcripts locally according to your retention settings. Direct providers
              receive only requests you choose to send. Model downloads are always started by you.
            </p>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Keep local history</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Transcripts follow your retention settings on this device. You can change this later
              in Privacy &amp; Data.
            </p>
          </div>
          <Toggle checked={dataRetentionEnabled} onChange={setDataRetentionEnabled} />
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Download updates automatically</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Loqui checks its signed GitHub releases about once a day. You choose when to restart.
            </p>
          </div>
          <Toggle checked={updatesEnabled} onChange={setUpdatesEnabled} />
        </div>
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
  onSelectModel: (model: (typeof SPEECH_MODELS)[number]["id"]) => void;
  onDownload: () => void;
}) {
  const spokenLanguages = useSettingsStore((s) => s.spokenLanguages);
  const preferredLanguage = useSettingsStore((s) => s.preferredLanguage);
  const setSpokenLanguages = useSettingsStore((s) => s.setSpokenLanguages);
  const setPreferredLanguage = useSettingsStore((s) => s.setPreferredLanguage);
  const language =
    spokenLanguages[0] || (preferredLanguage === "auto" ? "en-US" : preferredLanguage) || "en-US";
  const selected = SPEECH_MODELS.find((model) => model.id === selectedModel) ?? SPEECH_MODELS[0];
  useEffect(() => {
    if (!language.startsWith("en") && selectedModel === SPEECH_MODELS[0].id) {
      onSelectModel(SPEECH_MODELS[1].id);
    }
  }, [language, onSelectModel, selectedModel]);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Speech recognition
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Choose the voice you use most.
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Speech recognition and text intelligence are separate. Start with a local model so
          dictation can work offline.
        </p>
      </div>
      <section className="space-y-3" aria-labelledby="spoken-language-heading">
        <div className="flex items-center gap-2">
          <Languages className="h-4 w-4 text-primary" />
          <h2 id="spoken-language-heading" className="text-sm font-semibold">
            Spoken language
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
          {language.startsWith("en")
            ? "English is the recommended default for the smaller Parakeet model."
            : "Loqui will keep a multilingual model selected for this language."}
        </p>
      </section>
      <section className="space-y-3" aria-labelledby="speech-model-heading">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="speech-model-heading" className="text-sm font-semibold">
              Local speech model
            </h2>
            <p className="text-xs text-muted-foreground">Download only the model you choose.</p>
          </div>
          {previewConfig && (
            <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
              Preview: {previewConfig.scenario}
            </span>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {SPEECH_MODELS.map((model) => (
            <ChoiceCard
              key={model.id}
              selected={selectedModel === model.id}
              icon={Cpu}
              title={model.name}
              description={`${model.description} ${model.size}. ${model.languages.length > 1 ? "Multilingual." : "English only."}`}
              badge={
                model.languages.length > 1 && !language.startsWith("en")
                  ? "Recommended"
                  : model.languages.length === 1 && language.startsWith("en")
                    ? "Recommended"
                    : undefined
              }
              onClick={() => onSelectModel(model.id)}
            />
          ))}
        </div>
      </section>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">
              {speechModelReady
                ? `${selected.name} is ready`
                : downloadState === "downloading"
                  ? "Downloading speech model…"
                  : "Download the selected model"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {speechModelReady
                ? "You can try a dictation next."
                : downloadState === "error"
                  ? "The download was interrupted. Retry when you are ready."
                  : `${selected.size} download · CPU execution remains available.`}
            </p>
          </div>
          {speechModelReady ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          ) : (
            <Button onClick={onDownload} disabled={downloadState === "downloading"}>
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
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Text intelligence
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Make the transcript easier to read.
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Speech recognition writes your words. Cleanup removes filler, fixes punctuation, and keeps
          your meaning. It is optional and never replaces the original transcript.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceCard
          selected={selected === "none"}
          icon={Wand2}
          title="No cleanup"
          description="Keep the local transcript exactly as recognized. Fastest and fully offline."
          onClick={() => onChoice("none")}
        />
        <ChoiceCard
          selected={selected === "local"}
          icon={Cpu}
          title="Local model"
          description="Use the Qwen3.5 2B model on this device. Download it later when you want cleanup."
          badge="Recommended"
          onClick={() => onChoice("local")}
        />
        <ChoiceCard
          selected={selected === "codex"}
          icon={Sparkles}
          title="ChatGPT subscription"
          description="Use Codex through your managed ChatGPT sign-in. Speech stays on the selected speech provider."
          onClick={() => onChoice("codex")}
        />
        <ChoiceCard
          selected={selected === "provider"}
          icon={Wand2}
          title="Provider API key"
          description="Use a direct OpenAI-compatible provider key that you configure yourself."
          onClick={() => onChoice("provider")}
        />
      </div>
      {cleanupStatus !== "skipped" && (
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
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-10 w-10 items-center justify-center rounded-xl ${state === "recording" ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}
          >
            <Mic className="h-5 w-5" />
          </span>
          <div className="flex-1">
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
        <div className="mt-5 flex items-center gap-3">
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
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-10 w-10 items-center justify-center rounded-xl ${recording.isRecording ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}
          >
            <Mic className="h-5 w-5" />
          </span>
          <div>
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
        <div className="mt-5 flex items-center gap-3">
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
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Use anywhere
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Keep Loqui one shortcut away.
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          This is optional. You can stay in the workspace and use the Record control while you
          decide whether automatic paste fits your workflow.
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
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
      <div className="rounded-xl border border-border bg-card p-4">
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
        <div className="rounded-xl border border-border bg-card p-4">
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
    ["microphone", "Microphone", "Start a trial recording to confirm access.", "try"],
    ["speech", "Speech model", "Choose and download a local speech model.", "speech"],
    ["cleanup", "Text cleanup", "Optional. Raw transcripts work without it.", "cleanup"],
    ["shortcut", "Shortcut and paste", "Optional for using Loqui in other apps.", "shortcuts"],
  ];
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          You are in control
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Your workspace is ready when you are.
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          You can leave setup now. Loqui will keep unfinished items visible and you can return here
          from Settings.
        </p>
      </div>
      <div className="space-y-2">
        {items.map(([key, label, detail, step]) => {
          const state = readiness[key];
          const ok = state === "ready" || state === "skipped";
          return (
            <button
              type="button"
              key={key}
              onClick={() => onResume(step)}
              className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-start hover:bg-muted/40"
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
                <span className="mt-1 block text-xs text-muted-foreground">
                  {ok ? "Ready or intentionally skipped." : detail}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">Review</span>
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
  const [selectedModel, setSelectedModel] = useState(
    () => useSettingsStore.getState().parakeetModel || SPEECH_MODELS[0].id
  );
  const [speechModelReady, setSpeechModelReady] = useState(
    () =>
      config?.scenario === "ready" ||
      Boolean(
        config &&
        localStorage.getItem(`${onboardingPreviewStorageKey(config)}.speechReady`) === "true"
      )
  );
  const [downloadState, setDownloadState] = useState<"idle" | "downloading" | "ready" | "error">(
    () =>
      config?.scenario === "downloading" || config?.scenario === "download-interrupted"
        ? "downloading"
        : config?.scenario === "ready" ||
            Boolean(
              config &&
              localStorage.getItem(`${onboardingPreviewStorageKey(config)}.speechReady`) === "true"
            )
          ? "ready"
          : "idle"
  );
  const [trialResult, setTrialResult] = useState("");
  const [updatesEnabled, setUpdatesEnabled] = useState(true);
  const settings = useSettings();
  const permissions = usePermissions(undefined, { macAccessibilityChecksEnabled: true });
  const platform =
    config?.platform === "macos"
      ? "darwin"
      : config?.platform === "linux"
        ? "linux"
        : getCachedPlatform();
  const scenario = config?.scenario ?? "fresh";
  const initialCleanupChoice: CleanupChoice = !settings.useCleanupModel
    ? "none"
    : settings.cleanupMode === "local"
      ? "local"
      : settings.cleanupProvider === "codex"
        ? "codex"
        : settings.cleanupMode === "providers"
          ? "provider"
          : "none";
  const [cleanupChoice, setCleanupChoice] = useState<CleanupChoice>(initialCleanupChoice);
  const [cleanupStatus, setCleanupStatus] = useState<CleanupStatus>(
    settings.useCleanupModel ? "ready" : "skipped"
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
    setDownloadState("downloading");
    if (preview) {
      window.setTimeout(() => {
        setDownloadState(scenario === "download-interrupted" ? "error" : "ready");
        const ready = scenario !== "download-interrupted";
        setSpeechModelReady(ready);
        if (config && ready)
          localStorage.setItem(`${onboardingPreviewStorageKey(config)}.speechReady`, "true");
      }, 500);
      return;
    }
    const download = window.electronAPI?.downloadParakeetModel;
    if (!download) {
      setDownloadState("error");
      return;
    }
    void download(selectedModel)
      .then((result) => {
        const ready = Boolean(result?.success && result?.downloaded);
        setSpeechModelReady(ready);
        setDownloadState(ready ? "ready" : "error");
      })
      .catch(() => setDownloadState("error"));
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
      speech: speechModelReady ? "ready" : downloadState === "error" ? "failed" : "pending",
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
      shortcut: !settings.autoPasteEnabled
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
    settings.autoPasteEnabled,
    cleanupChoice,
    cleanupStatus,
    speechModelReady,
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
  const trialReady = speechModelReady || simulatedTrialReady;
  const trial = preview ? (
    <BrowserTrial scenario={scenario} ready={trialReady} onFinished={onTrialFinished} />
  ) : (
    <DesktopTrial ready={trialReady} onFinished={onTrialFinished} />
  );

  let content: ReactNode;
  if (step === "welcome")
    content = (
      <WelcomeStep
        updatesEnabled={updatesEnabled}
        setUpdatesEnabled={(value) => {
          setUpdatesEnabled(value);
          void window.electronAPI?.updates?.preferences?.({ enabled: value });
        }}
        dataRetentionEnabled={settings.dataRetentionEnabled}
        setDataRetentionEnabled={settings.setDataRetentionEnabled}
      />
    );
  if (step === "speech")
    content = (
      <SpeechStep
        previewConfig={config}
        speechModelReady={speechModelReady}
        downloadState={downloadState}
        selectedModel={selectedModel}
        onSelectModel={(model) => {
          setSelectedModel(model);
          useSettingsStore.getState().setParakeetModel(model);
          const ready = config?.scenario === "ready";
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
      <div className="space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Try it here
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Make one short dictation.</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Loqui will show the result inside this window. Trial audio and text are not saved to
            history and automatic paste stays off.
          </p>
        </div>
        {trial}
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

  return (
    <StepShell
      step={step}
      onBack={handleBack}
      onContinue={handleContinue}
      onSkip={handleSkip}
      continueLabel={
        step === "welcome" ? "Set up dictation" : step === "finish" ? "Open workspace" : "Continue"
      }
      skipLabel={step === "welcome" ? "Explore first" : "Continue later"}
    >
      {content}
    </StepShell>
  );
}
