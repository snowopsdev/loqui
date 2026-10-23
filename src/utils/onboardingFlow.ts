import { ONBOARDING_STEPS, type OnboardingStep } from "./onboardingState";

// Setup is two phases and a summary (spec ONB-R2 B): "Get dictating" ends at
// the first words on screen; "Make it yours" is optional; Ready is honest.
export type OnboardingPhase = "dictate" | "personalize" | "ready";

export const ONBOARDING_PHASES: ReadonlyArray<{
  id: "dictate" | "personalize";
  steps: readonly OnboardingStep[];
}> = [
  { id: "dictate", steps: ["welcome", "speech", "try"] },
  { id: "personalize", steps: ["cleanup", "shortcuts"] },
];

export interface PhaseProgress {
  phase: "dictate" | "personalize";
  steps: readonly OnboardingStep[];
  index: number;
}

export function phaseOf(step: OnboardingStep): OnboardingPhase {
  return ONBOARDING_PHASES.find((phase) => phase.steps.includes(step))?.id ?? "ready";
}

export function nextStep(step: OnboardingStep): OnboardingStep | null {
  const index = ONBOARDING_STEPS.indexOf(step);
  return index >= 0 && index < ONBOARDING_STEPS.length - 1 ? ONBOARDING_STEPS[index + 1] : null;
}

export function previousStep(step: OnboardingStep): OnboardingStep | null {
  const index = ONBOARDING_STEPS.indexOf(step);
  return index > 0 ? ONBOARDING_STEPS[index - 1] : null;
}

export function phaseProgress(step: OnboardingStep): PhaseProgress | null {
  for (const phase of ONBOARDING_PHASES) {
    const index = phase.steps.indexOf(step);
    if (index >= 0) return { phase: phase.id, steps: phase.steps, index };
  }
  return null;
}

export function canNavigateTo(
  target: OnboardingStep,
  current: OnboardingStep,
  visited: readonly OnboardingStep[]
): boolean {
  return target !== current && visited.includes(target);
}

export function markVisited(
  visited: readonly OnboardingStep[],
  step: OnboardingStep
): OnboardingStep[] {
  return visited.includes(step) ? [...visited] : [...visited, step];
}

// What the workspace does once setup closes (Ready, Task 18). One type for the
// prop, the flow's finish() helper and AppRouter, so they cannot drift (I11).
export type AfterSetupIntent = { kind: "dictate-note" } | { kind: "open-settings"; path: string };

export interface OnboardingCompleteOptions {
  openSettings?: boolean;
  next?: AfterSetupIntent;
}
