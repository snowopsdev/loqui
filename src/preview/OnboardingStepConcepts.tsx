import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Cpu,
  Download,
  KeyRound,
  LockKeyhole,
  Mic,
  ShieldCheck,
  Sparkles,
  Square,
  WandSparkles,
} from "lucide-react";
import {
  DEFAULT_ONBOARDING_SPEECH_MODEL_ID,
  ONBOARDING_SPEECH_MODELS,
  firstCompatibleSpeechModel,
  supportsSpeechLanguage,
} from "../utils/onboardingSpeechModels";
import type { OnboardingPreviewPlatform, OnboardingScenario } from "../utils/onboardingState";
import { CONCEPT_STEPS, type ConceptStep } from "./onboardingConceptSteps";
import { LoquiBrand } from "../components/LoquiBrand";
import "./onboarding-step-concepts.css";

export type StepConcept = "1" | "2" | "3";
type CleanupChoice = "none" | "local" | "codex" | "provider";
type DownloadState = "idle" | "downloading" | "ready" | "error";
type TrialState = "idle" | "recording" | "success" | "error";

const SAMPLE_RAW = "um let's make the next step obvious and keep the work moving";
const SAMPLE_CLEAN = "Let's make the next step obvious and keep the work moving.";

const STEP_INFO: Record<
  ConceptStep,
  { label: string; title: string; description: string; cues: string[] }
> = {
  speech: {
    label: "Speech",
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
    label: "Cleanup",
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
    label: "Try dictation",
    title: "Make one short dictation.",
    description:
      "Test recording inside Loqui first. This trial is not pasted into another app or saved to history.",
    cues: ["Start when you are ready", "Speak one short sentence", "Review the words inside Loqui"],
  },
  shortcuts: {
    label: "Use anywhere",
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
    label: "Ready",
    title: "Your workspace is ready when you are.",
    description: "Enter Loqui now. Unfinished setup stays available when you want to return.",
    cues: ["Open the workspace", "Return to unfinished setup", "Add advanced features later"],
  },
};

const CLEANUP_OPTIONS: Array<{
  id: CleanupChoice;
  title: string;
  detail: string;
  icon: typeof WandSparkles;
  badge?: string;
}> = [
  {
    id: "none",
    title: "No cleanup",
    detail: "Keep the raw transcript. Fastest and fully offline.",
    icon: Check,
  },
  {
    id: "local",
    title: "Local model",
    detail: "Use Qwen3.5 2B on this device after you download it.",
    icon: Cpu,
    badge: "Recommended",
  },
  {
    id: "codex",
    title: "ChatGPT subscription",
    detail: "Use Codex for text through your ChatGPT sign-in.",
    icon: Sparkles,
  },
  {
    id: "provider",
    title: "Provider API key",
    detail: "Use a direct provider key configured in Language Models.",
    icon: KeyRound,
  },
];

function goToWorkspace() {
  const url = new URL(window.location.href);
  url.searchParams.set("preview", "workspace");
  url.searchParams.delete("design");
  url.searchParams.delete("step");
  window.location.assign(url);
}

function SetupBrand() {
  return (
    <div className="osc-brand">
      <span className="osc-brand-mark" aria-hidden="true">
        <LoquiBrand decorative />
      </span>
      <span className="osc-brand-copy">
        <strong>Loqui setup</strong>
        <small>A local-first voice workspace</small>
      </span>
    </div>
  );
}

function Progress({ step }: { step: ConceptStep }) {
  const index = CONCEPT_STEPS.indexOf(step) + 1;
  return (
    <div
      className="osc-progress"
      role="status"
      aria-label={`${STEP_INFO[step].label}, step ${index + 1} of 6`}
    >
      <div className="osc-progress-label">
        <span>Step {index + 1} of 6</span>
        <strong>{STEP_INFO[step].label}</strong>
      </div>
      <div className="osc-progress-track" aria-hidden="true">
        {Array.from({ length: 6 }, (_, bar) => (
          <i key={bar} className={bar <= index ? "is-complete" : ""} />
        ))}
      </div>
    </div>
  );
}

function StepHeading({
  step,
  headingRef,
}: {
  step: ConceptStep;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const info = STEP_INFO[step];
  return (
    <div className="osc-heading">
      <h1 ref={headingRef} tabIndex={-1}>
        {info.title}
      </h1>
      <p>{info.description}</p>
    </div>
  );
}

function ChoiceButton({
  selected,
  disabled,
  onClick,
  children,
  className = "",
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`osc-choice ${selected ? "is-selected" : ""} ${className}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span className="osc-choice-indicator" aria-hidden="true">
        {selected && <Check size={12} strokeWidth={3} />}
      </span>
    </button>
  );
}

function ToggleRow({
  checked,
  onChange,
  title,
  detail,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  detail: string;
}) {
  return (
    <div className="osc-toggle-row">
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-label={title}
        aria-checked={checked}
        className={`osc-switch ${checked ? "is-on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

function SpeechControls({
  language,
  onLanguage,
  selectedModel,
  onModel,
  downloadState,
  onDownload,
  onCancel,
}: {
  language: string;
  onLanguage: (language: string) => void;
  selectedModel: string;
  onModel: (model: string) => void;
  downloadState: DownloadState;
  onDownload: () => void;
  onCancel: () => void;
}) {
  const selected =
    ONBOARDING_SPEECH_MODELS.find((model) => model.id === selectedModel) ??
    ONBOARDING_SPEECH_MODELS[0];
  return (
    <div className="osc-control-content">
      <div className="osc-field">
        <label htmlFor="osc-language">What language will you speak?</label>
        <select
          id="osc-language"
          value={language}
          onChange={(event) => onLanguage(event.target.value)}
        >
          <option value="en-US">English</option>
          <option value="es-ES">Spanish</option>
          <option value="ja-JP">Japanese</option>
        </select>
        <p>Only models that support your language can be selected.</p>
      </div>
      <section className="osc-section" aria-label="Local speech models">
        <div className="osc-section-head">
          <h2>Local speech model</h2>
          <span>Oruk + NVIDIA</span>
        </div>
        <div className="osc-model-list">
          {ONBOARDING_SPEECH_MODELS.map((model) => {
            const supported = supportsSpeechLanguage(model.id, language);
            const recommended =
              supported &&
              model.id ===
                (supportsSpeechLanguage(DEFAULT_ONBOARDING_SPEECH_MODEL_ID, language)
                  ? DEFAULT_ONBOARDING_SPEECH_MODEL_ID
                  : firstCompatibleSpeechModel(language));
            return (
              <ChoiceButton
                key={model.id}
                selected={selectedModel === model.id}
                disabled={!supported || downloadState === "downloading"}
                onClick={() => onModel(model.id)}
                className={`osc-model-choice ${recommended ? "is-recommended" : ""}`}
              >
                <span className="osc-model-title">
                  <strong>{model.name}</strong>
                  {recommended && <em>Recommended</em>}
                </span>
                <span className="osc-model-meta">
                  {model.organization === "oruk" ? "Oruk" : "NVIDIA"} ·{" "}
                  {model.size.replace(/(\d)(MB|GB)$/, "$1 $2")} ·{" "}
                  {model.supportedLanguages.length === 1
                    ? "English"
                    : `${model.supportedLanguages.length} languages`}
                </span>
              </ChoiceButton>
            );
          })}
        </div>
      </section>
      <div className={`osc-status-panel ${downloadState === "error" ? "is-error" : ""}`}>
        <span className="osc-status-icon" aria-hidden="true">
          {downloadState === "ready" ? (
            <CheckCircle2 size={18} />
          ) : downloadState === "error" ? (
            <CircleAlert size={18} />
          ) : (
            <Download size={18} />
          )}
        </span>
        <div>
          <strong>
            {downloadState === "ready"
              ? `${selected.name} is ready`
              : downloadState === "downloading"
                ? "Downloading model…"
                : downloadState === "error"
                  ? "Download interrupted"
                  : "Download the selected model"}
          </strong>
          <p>
            {downloadState === "ready"
              ? "You can try dictation next."
              : downloadState === "error"
                ? "Retry when you are ready. Your previous settings are safe."
                : `${selected.size.replace(/(\d)(MB|GB)$/, "$1 $2")} · Runs locally, including on CPU.`}
          </p>
          {downloadState === "downloading" && (
            <div className="osc-download-meter" aria-label="Simulated download progress">
              <span />
            </div>
          )}
        </div>
        {downloadState === "downloading" ? (
          <button type="button" className="osc-plain-action" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          downloadState !== "ready" && (
            <button
              type="button"
              className="osc-small-primary"
              onClick={onDownload}
              disabled={!supportsSpeechLanguage(selectedModel, language)}
            >
              {downloadState === "error" ? "Retry" : "Download"}
            </button>
          )
        )}
      </div>
      <p className="osc-footnote">Preview simulation. No model is downloaded from this browser.</p>
    </div>
  );
}

function CleanupControls({
  choice,
  onChoice,
  reuse,
  onReuse,
  scenario,
  connected,
  onConnect,
}: {
  choice: CleanupChoice;
  onChoice: (choice: CleanupChoice) => void;
  reuse: boolean;
  onReuse: (value: boolean) => void;
  scenario: OnboardingScenario;
  connected: boolean;
  onConnect: () => void;
}) {
  const failure =
    (choice === "codex" && ["codex-missing", "codex-expired"].includes(scenario)) ||
    (choice === "provider" && scenario === "invalid-provider-key") ||
    scenario === "cleanup-failed";
  return (
    <div className="osc-control-content">
      <div className="osc-section-head">
        <h2>How should Loqui handle cleanup?</h2>
        <span>Optional</span>
      </div>
      <div className="osc-cleanup-list">
        {CLEANUP_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <ChoiceButton
              key={option.id}
              selected={choice === option.id}
              onClick={() => onChoice(option.id)}
              className="osc-cleanup-choice"
            >
              <span className="osc-cleanup-icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <span>
                <strong>{option.title}</strong>
                <small>{option.detail}</small>
              </span>
              {option.badge && <em>{option.badge}</em>}
            </ChoiceButton>
          );
        })}
      </div>
      {choice !== "none" && (
        <div className={`osc-status-panel ${failure ? "is-error" : ""}`}>
          <span className="osc-status-icon" aria-hidden="true">
            {failure ? (
              <CircleAlert size={18} />
            ) : connected ? (
              <CheckCircle2 size={18} />
            ) : (
              <LockKeyhole size={18} />
            )}
          </span>
          <div>
            <strong>
              {failure
                ? "Connection needs attention"
                : connected
                  ? "Connection ready in this preview"
                  : choice === "local"
                    ? "Local model is not downloaded yet"
                    : "Connection check comes next"}
            </strong>
            <p>
              {failure
                ? "Retry or choose No cleanup. The raw transcript stays available."
                : choice === "local"
                  ? "Download Qwen3.5 2B only when you select it in Language Models."
                  : choice === "codex"
                    ? "Codex uses your ChatGPT sign-in, separate from provider API keys."
                    : "Configure a direct provider key in Language Models."}
            </p>
          </div>
          {(choice === "codex" || choice === "provider") && (
            <button type="button" className="osc-small-primary" onClick={onConnect}>
              {failure ? "Retry" : connected ? "Recheck" : "Preview check"}
            </button>
          )}
        </div>
      )}
      <label className="osc-checkbox-row">
        <input
          type="checkbox"
          checked={reuse}
          onChange={(event) => onReuse(event.target.checked)}
        />
        <span>
          <strong>Also use this choice for other text features</strong>
          <small>
            Only unconfigured chat, translation, voice assistant, note formatting, and meeting
            summaries.
          </small>
        </span>
      </label>
      <p className="osc-footnote">
        Preview simulation. No sign-in, provider request, or model download occurs here.
      </p>
    </div>
  );
}

function TryControls({
  state,
  onStart,
  onStop,
  scenario,
}: {
  state: TrialState;
  onStart: () => void;
  onStop: () => void;
  scenario: OnboardingScenario;
}) {
  const error =
    scenario === "microphone-denied"
      ? "Microphone access is denied in this scenario. Review permission in Settings, then retry."
      : "The selected model could not start. Choose a smaller model and retry.";
  return (
    <div className="osc-control-content">
      <div className="osc-section-head">
        <h2>Record inside Loqui</h2>
        <span>Practice</span>
      </div>
      <div className={`osc-record-surface ${state === "recording" ? "is-recording" : ""}`}>
        <span className="osc-record-mark" aria-hidden="true">
          <Mic size={29} />
        </span>
        <strong>
          {state === "recording"
            ? "Listening…"
            : state === "success"
              ? "Your first dictation"
              : state === "error"
                ? "Recording needs attention"
                : "Ready for a short sentence"}
        </strong>
        <p>
          {state === "recording"
            ? "Speak naturally, then press Stop."
            : state === "success"
              ? "Your result stays here during setup."
              : "Try saying what you want to work on today."}
        </p>
        {state === "recording" && (
          <div className="osc-record-meter" aria-label="Simulated microphone level">
            {[14, 26, 40, 21, 53, 34, 48, 24, 15].map((height, index) => (
              <i key={index} style={{ height }} />
            ))}
          </div>
        )}
        {state === "success" && (
          <blockquote>{scenario === "cleanup-failed" ? SAMPLE_RAW : SAMPLE_CLEAN}</blockquote>
        )}
        {state === "error" && (
          <p className="osc-error" role="alert">
            {error}
          </p>
        )}
        <div className="osc-record-actions">
          {state === "recording" ? (
            <button type="button" className="osc-small-primary" onClick={onStop}>
              <Square size={13} /> Stop
            </button>
          ) : (
            <button type="button" className="osc-small-primary" onClick={onStart}>
              {state === "success" ? "Try again" : "Simulate recording"}
            </button>
          )}
        </div>
      </div>
      <div className="osc-quiet-note">
        <ShieldCheck size={17} aria-hidden="true" />
        <p>
          No automatic paste. Trial audio and text are not saved to history. The real app asks for
          microphone access only when you start.
        </p>
      </div>
      {scenario === "cleanup-failed" && state === "success" && (
        <p className="osc-error" role="alert">
          Cleanup failed in this simulation; your raw transcript remains available.
        </p>
      )}
      <p className="osc-footnote">
        Preview simulation uses sample text and never opens your microphone.
      </p>
    </div>
  );
}

function ShortcutsControls({
  platform,
  shortcut,
  onShortcut,
  paste,
  onPaste,
  showPermission,
  onPermission,
}: {
  platform: OnboardingPreviewPlatform;
  shortcut: string;
  onShortcut: (shortcut: string) => void;
  paste: boolean;
  onPaste: (value: boolean) => void;
  showPermission: boolean;
  onPermission: () => void;
}) {
  return (
    <div className="osc-control-content">
      <div className="osc-section-head">
        <h2>Use Loqui outside this window</h2>
        <span>Optional</span>
      </div>
      <div className="osc-shortcut-block">
        <span className="osc-shortcut-icon" aria-hidden="true">
          <KeyRound size={20} />
        </span>
        <div>
          <strong>Dictation shortcut</strong>
          <p>Keep the default or pick another if it conflicts with an app you use.</p>
          <div className="osc-shortcut-options">
            <button
              type="button"
              className={
                shortcut === (platform === "macos" ? "Globe / Fn" : "Ctrl + Super")
                  ? "is-selected"
                  : ""
              }
              onClick={() => onShortcut(platform === "macos" ? "Globe / Fn" : "Ctrl + Super")}
            >
              {platform === "macos" ? "Globe / Fn" : "Ctrl + Super"}
            </button>
            <button
              type="button"
              className={shortcut === "Custom later" ? "is-selected" : ""}
              onClick={() => onShortcut("Custom later")}
            >
              Change later
            </button>
          </div>
        </div>
      </div>
      <ToggleRow
        checked={paste}
        onChange={onPaste}
        title="Automatic paste"
        detail="Paste completed dictation into the focused app when enabled."
      />
      {platform === "macos" ? (
        <div className="osc-permission-block">
          <ShieldCheck size={19} aria-hidden="true" />
          <div>
            <strong>Accessibility permission</strong>
            <p>macOS needs this for global shortcuts and pasting into other apps.</p>
            {showPermission && (
              <small>
                In the desktop app, Loqui opens macOS Privacy &amp; Security so you can grant
                access.
              </small>
            )}
          </div>
          <button type="button" className="osc-small-primary" onClick={onPermission}>
            {showPermission ? "Hide steps" : "Show steps"}
          </button>
        </div>
      ) : (
        <div className="osc-quiet-note">
          <CircleAlert size={17} aria-hidden="true" />
          <p>
            Linux paste support depends on your desktop session. Loqui shows helper guidance in
            Settings when needed.
          </p>
        </div>
      )}
      <p className="osc-footnote">
        Preview simulation. Shortcut registration and OS permissions are not requested here.
      </p>
    </div>
  );
}

function FinishControls({
  speechReady,
  trialReady,
  onReview,
}: {
  speechReady: boolean;
  trialReady: boolean;
  onReview: (step: ConceptStep) => void;
}) {
  const rows: Array<{
    label: string;
    detail: string;
    ready: boolean;
    step: ConceptStep;
    optional?: boolean;
  }> = [
    {
      label: "Speech model",
      detail: speechReady ? "Local model ready" : "Choose and download a local model",
      ready: speechReady,
      step: "speech",
    },
    {
      label: "Microphone",
      detail: trialReady ? "Trial dictation captured" : "Try a short recording inside Loqui",
      ready: trialReady,
      step: "try",
    },
    {
      label: "Text cleanup",
      detail: "Raw transcripts work without it",
      ready: true,
      step: "cleanup",
      optional: true,
    },
    {
      label: "Shortcut and paste",
      detail: "Record inside Loqui without it",
      ready: true,
      step: "shortcuts",
      optional: true,
    },
  ];
  return (
    <div className="osc-control-content">
      <div className="osc-section-head">
        <h2>Your setup at a glance</h2>
        <span>{speechReady ? "Ready to dictate" : "Finish anytime"}</span>
      </div>
      <div className="osc-readiness-list">
        {rows.map((row) => (
          <button
            type="button"
            key={row.label}
            className="osc-readiness-row"
            onClick={() => onReview(row.step)}
          >
            <span className={row.ready ? "is-ready" : "is-pending"} aria-hidden="true">
              {row.ready ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
            </span>
            <span>
              <strong>{row.label}</strong>
              <small>{row.detail}</small>
            </span>
            <em>{row.optional ? "Optional" : row.ready ? "Ready" : "Pending"}</em>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="osc-quiet-note">
        <LockKeyhole size={17} aria-hidden="true" />
        <p>
          Notes, meetings, and the workspace are available now. Return to unfinished dictation setup
          from Settings.
        </p>
      </div>
      <p className="osc-footnote">Readiness shown here is simulated for design review.</p>
    </div>
  );
}

function PracticePanel({ step, trialState }: { step: ConceptStep; trialState: TrialState }) {
  if (step === "cleanup")
    return (
      <div className="osc-example">
        <span>Illustrative example</span>
        <div>
          <small>Recognized speech</small>
          <p>{SAMPLE_RAW}</p>
        </div>
        <ArrowRight size={18} aria-hidden="true" />
        <div>
          <small>After cleanup</small>
          <p>{SAMPLE_CLEAN}</p>
        </div>
        <footer>Your original transcript is retained.</footer>
      </div>
    );
  if (step === "speech")
    return (
      <div className="osc-example osc-example--voice">
        <span>Where speech runs</span>
        <div className="osc-example-mic">
          <Mic size={35} />
        </div>
        <div className="osc-example-wave" aria-hidden="true">
          {[16, 26, 40, 22, 54, 35, 48, 28, 18].map((h, i) => (
            <i key={i} style={{ height: h }} />
          ))}
        </div>
        <strong>On this device</strong>
        <p>After your model is downloaded, local dictation can work offline.</p>
      </div>
    );
  if (step === "try")
    return (
      <div className="osc-example osc-example--trial">
        <span>Practice inside Loqui</span>
        <div className="osc-example-mic">
          <Mic size={35} />
        </div>
        <strong>{trialState === "success" ? "Words captured" : "Speak. Stop. Review."}</strong>
        <p>
          {trialState === "success"
            ? SAMPLE_CLEAN
            : "Your first result appears here, before you use dictation in another app."}
        </p>
        <footer>Sample preview · no microphone access</footer>
      </div>
    );
  if (step === "shortcuts")
    return (
      <div className="osc-example osc-example--paste">
        <span>Illustrative destination</span>
        <div className="osc-example-editor">
          <small>Notes</small>
          <p>
            {SAMPLE_CLEAN}
            <i />
          </p>
        </div>
        <footer>
          Completed dictation can go into the focused app when automatic paste is enabled.
        </footer>
      </div>
    );
  return (
    <div className="osc-example osc-example--finish">
      <span>What comes next</span>
      <div className="osc-next-line">
        <Mic size={20} />
        <p>Use Record from the workspace</p>
      </div>
      <div className="osc-next-line">
        <CheckCircle2 size={20} />
        <p>Turn a transcript into a note</p>
      </div>
      <footer>Meetings, calendars, and advanced models can wait.</footer>
    </div>
  );
}

export default function OnboardingStepConcepts({
  variation,
  step,
  scenario,
  platform,
  onStepChange,
}: {
  variation: StepConcept;
  step: ConceptStep;
  scenario: OnboardingScenario;
  platform: OnboardingPreviewPlatform;
  onStepChange: (step: ConceptStep) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const timerRef = useRef<number | null>(null);
  const [language, setLanguage] = useState("en-US");
  const [modelId, setModelId] = useState(DEFAULT_ONBOARDING_SPEECH_MODEL_ID);
  const [downloadState, setDownloadState] = useState<DownloadState>(
    scenario === "ready"
      ? "ready"
      : scenario === "downloading"
        ? "downloading"
        : scenario === "download-interrupted"
          ? "error"
          : "idle"
  );
  const [cleanupChoice, setCleanupChoice] = useState<CleanupChoice>("none");
  const [reuseCleanup, setReuseCleanup] = useState(false);
  const [connected, setConnected] = useState(false);
  const [trialState, setTrialState] = useState<TrialState>("idle");
  const [shortcut, setShortcut] = useState(platform === "macos" ? "Globe / Fn" : "Ctrl + Super");
  const [autoPaste, setAutoPaste] = useState(false);
  const [showPermission, setShowPermission] = useState(false);
  const index = CONCEPT_STEPS.indexOf(step);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [step, variation]);
  useEffect(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setDownloadState(
      scenario === "ready"
        ? "ready"
        : scenario === "downloading"
          ? "downloading"
          : scenario === "download-interrupted"
            ? "error"
            : "idle"
    );
    setTrialState("idle");
    setConnected(false);
  }, [scenario]);
  useEffect(() => {
    setShortcut(platform === "macos" ? "Globe / Fn" : "Ctrl + Super");
  }, [platform]);
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  const selectLanguage = (value: string) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setLanguage(value);
    if (!supportsSpeechLanguage(modelId, value))
      setModelId(firstCompatibleSpeechModel(value) ?? modelId);
    setDownloadState("idle");
  };
  const startDownload = () => {
    setDownloadState("downloading");
    timerRef.current = window.setTimeout(() => {
      setDownloadState(scenario === "download-interrupted" ? "error" : "ready");
      timerRef.current = null;
    }, 1000);
  };
  const cancelDownload = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setDownloadState("idle");
  };
  const startTrial = () => {
    if (scenario === "microphone-denied" || scenario === "insufficient-memory")
      setTrialState("error");
    else setTrialState("recording");
  };
  const stopTrial = () => setTrialState("success");
  const controls =
    step === "speech" ? (
      <SpeechControls
        language={language}
        onLanguage={selectLanguage}
        selectedModel={modelId}
        onModel={(id) => {
          setModelId(id);
          setDownloadState("idle");
        }}
        downloadState={downloadState}
        onDownload={startDownload}
        onCancel={cancelDownload}
      />
    ) : step === "cleanup" ? (
      <CleanupControls
        choice={cleanupChoice}
        onChoice={(choice) => {
          setCleanupChoice(choice);
          setConnected(false);
        }}
        reuse={reuseCleanup}
        onReuse={setReuseCleanup}
        scenario={scenario}
        connected={connected}
        onConnect={() =>
          setConnected(
            !["codex-missing", "codex-expired", "invalid-provider-key"].includes(scenario)
          )
        }
      />
    ) : step === "try" ? (
      <TryControls state={trialState} onStart={startTrial} onStop={stopTrial} scenario={scenario} />
    ) : step === "shortcuts" ? (
      <ShortcutsControls
        platform={platform}
        shortcut={shortcut}
        onShortcut={setShortcut}
        paste={autoPaste}
        onPaste={setAutoPaste}
        showPermission={showPermission}
        onPermission={() => setShowPermission(!showPermission)}
      />
    ) : (
      <FinishControls
        speechReady={downloadState === "ready"}
        trialReady={trialState === "success" || scenario === "ready"}
        onReview={onStepChange}
      />
    );
  const footer = (
    <footer className="osc-footer">
      <button
        type="button"
        className="osc-back"
        onClick={() =>
          index === 0
            ? window.location.assign(
                "?panel=true&preview=onboarding&step=welcome&scenario=fresh&platform=macos"
              )
            : onStepChange(CONCEPT_STEPS[index - 1])
        }
      >
        Back
      </button>
      <div>
        <button type="button" className="osc-explore" onClick={goToWorkspace}>
          {step === "finish" ? "Continue setup later" : "Explore first"}
        </button>
        <button
          type="button"
          className="osc-primary"
          onClick={() =>
            index === CONCEPT_STEPS.length - 1
              ? goToWorkspace()
              : onStepChange(CONCEPT_STEPS[index + 1])
          }
        >
          {step === "finish" ? "Open workspace" : "Continue"}{" "}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
  return (
    <div className={`osc-surface osc--${variation}`}>
      {variation === "3" && (
        <aside className="osc-rail">
          <SetupBrand />
          <nav aria-label="Setup steps">
            <span className="is-complete">Welcome</span>
            {CONCEPT_STEPS.map((item) => (
              <button
                type="button"
                key={item}
                className={step === item ? "is-active" : ""}
                aria-current={step === item ? "step" : undefined}
                onClick={() => onStepChange(item)}
              >
                {STEP_INFO[item].label}
              </button>
            ))}
          </nav>
          <p>Preview concepts · no desktop changes</p>
        </aside>
      )}
      <div className="osc-frame">
        <header className="osc-header">
          {variation !== "3" && <SetupBrand />}
          {variation === "3" && (
            <div className="osc-mobile-brand">
              <SetupBrand />
            </div>
          )}
          <Progress step={step} />
        </header>
        {variation === "1" ? (
          <main className="osc-main osc-main--split">
            <section className="osc-story">
              <StepHeading step={step} headingRef={headingRef} />
              <div className="osc-story-cues">
                {STEP_INFO[step].cues.map((cue) => (
                  <div key={cue}>
                    <span aria-hidden="true">
                      <Check size={14} />
                    </span>
                    {cue}
                  </div>
                ))}
              </div>
            </section>
            <section className="osc-work">{controls}</section>
          </main>
        ) : variation === "2" ? (
          <main className="osc-main osc-main--practice">
            <div className="osc-practice-wrap">
              <StepHeading step={step} headingRef={headingRef} />
              <div className="osc-practice-grid">
                <PracticePanel step={step} trialState={trialState} />
                <section
                  className="osc-practice-controls"
                  aria-label={`${STEP_INFO[step].label} choices`}
                >
                  {controls}
                </section>
              </div>
            </div>
          </main>
        ) : (
          <main className="osc-main osc-main--sheet">
            <div className="osc-sheet-wrap">
              <StepHeading step={step} headingRef={headingRef} />
              <div className="osc-sheet-content">{controls}</div>
            </div>
          </main>
        )}
        {footer}
      </div>
    </div>
  );
}
