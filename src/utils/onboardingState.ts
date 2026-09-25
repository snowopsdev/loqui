export const ONBOARDING_VERSION = 2 as const;

export type OnboardingStep = "welcome" | "speech" | "cleanup" | "try" | "shortcuts" | "finish";

export type OnboardingScenario =
  | "fresh"
  | "ready"
  | "downloading"
  | "download-interrupted"
  | "microphone-denied"
  | "codex-missing"
  | "codex-expired"
  | "invalid-provider-key"
  | "cleanup-failed"
  | "insufficient-memory";

export type OnboardingPreviewPlatform = "macos" | "linux";

export interface OnboardingProgress {
  version: typeof ONBOARDING_VERSION;
  step: OnboardingStep;
  explored: boolean;
  completed: boolean;
}

export interface OnboardingReadiness {
  microphone: "checking" | "pending" | "ready" | "skipped" | "failed";
  speech: "checking" | "pending" | "ready" | "skipped" | "failed";
  cleanup: "checking" | "pending" | "ready" | "skipped" | "failed";
  shortcut: "checking" | "pending" | "ready" | "skipped" | "failed";
}

export interface OnboardingPreviewConfig {
  step: OnboardingStep;
  scenario: OnboardingScenario;
  platform: OnboardingPreviewPlatform;
}

declare global {
  interface Window {
    loquiBrowserPreviewConfig?: OnboardingPreviewConfig;
  }
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  "welcome",
  "speech",
  "cleanup",
  "try",
  "shortcuts",
  "finish",
];

const STEP_VALUES = new Set<string>(ONBOARDING_STEPS);
const SCENARIO_VALUES = new Set<string>([
  "fresh",
  "ready",
  "downloading",
  "download-interrupted",
  "microphone-denied",
  "codex-missing",
  "codex-expired",
  "invalid-provider-key",
  "cleanup-failed",
  "insufficient-memory",
]);

const STORAGE_KEY = "loqui.onboarding.progress";
export const PREVIEW_STORAGE_PREFIX = "loqui.onboarding.preview.";

export function isOnboardingStep(value: unknown): value is OnboardingStep {
  return typeof value === "string" && STEP_VALUES.has(value);
}

export function isOnboardingScenario(value: unknown): value is OnboardingScenario {
  return typeof value === "string" && SCENARIO_VALUES.has(value);
}

export function normalizeOnboardingStep(value: unknown): OnboardingStep {
  return isOnboardingStep(value) ? value : "welcome";
}

export function normalizeOnboardingScenario(value: unknown): OnboardingScenario {
  return isOnboardingScenario(value) ? value : "fresh";
}

export function normalizeOnboardingPlatform(value: unknown): OnboardingPreviewPlatform {
  return value === "linux" ? "linux" : "macos";
}

export function defaultOnboardingProgress(): OnboardingProgress {
  return { version: ONBOARDING_VERSION, step: "welcome", explored: false, completed: false };
}

function readStorage(storageKey = STORAGE_KEY): Record<string, unknown> | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function readOnboardingProgress(storageKey = STORAGE_KEY): OnboardingProgress {
  const stored = readStorage(storageKey);
  if (!stored || stored.version !== ONBOARDING_VERSION) return defaultOnboardingProgress();
  return {
    version: ONBOARDING_VERSION,
    step: normalizeOnboardingStep(stored.step),
    explored: stored.explored === true,
    completed: stored.completed === true,
  };
}

export function writeOnboardingProgress(
  progress: Partial<OnboardingProgress>,
  storageKey = STORAGE_KEY
): OnboardingProgress {
  const next = { ...readOnboardingProgress(storageKey), ...progress, version: ONBOARDING_VERSION };
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Browser preview storage can be disabled; the in-memory flow still works.
    }
  }
  return next;
}

export function clearOnboardingProgress(storageKey = STORAGE_KEY): void {
  if (typeof localStorage !== "undefined") localStorage.removeItem(storageKey);
}

export function parseOnboardingPreviewConfig(search = ""): OnboardingPreviewConfig {
  const params = new URLSearchParams(search);
  return {
    step: normalizeOnboardingStep(params.get("step")),
    scenario: normalizeOnboardingScenario(params.get("scenario")),
    platform: normalizeOnboardingPlatform(params.get("platform")),
  };
}

export function onboardingPreviewStorageKey(config: OnboardingPreviewConfig): string {
  return `${PREVIEW_STORAGE_PREFIX}${config.platform}.${config.scenario}`;
}
