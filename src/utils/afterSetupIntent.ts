import type { AfterSetupIntent } from "./onboardingFlow";

// One-shot hand-off from setup's Ready step to the workspace (ONB-R8 A).
// In memory on purpose: it must not survive a reload.
let pending: AfterSetupIntent | null = null;

export function setAfterSetupIntent(intent: AfterSetupIntent): void {
  pending = intent;
}

export function takeAfterSetupIntent(): AfterSetupIntent | null {
  const intent = pending;
  pending = null;
  return intent;
}
