import { useCallback, useEffect, useRef } from "react";
import { isOnboardingStep, type OnboardingStep } from "../utils/onboardingState";

export const START_ONBOARDING_EVENT = "loqui:start-onboarding";
export interface StartOnboardingDetail {
  step?: OnboardingStep;
}

/** Resume local setup without reloading or changing notes, credentials or routes. */
export function requestStartOnboarding(step?: unknown): void {
  const detail: StartOnboardingDetail = { step: isOnboardingStep(step) ? step : undefined };
  if (!window.loquiBrowserPreview) localStorage.removeItem("onboardingCompleted");
  window.dispatchEvent?.(
    new CustomEvent<StartOnboardingDetail>(START_ONBOARDING_EVENT, { detail })
  );
}

export function useStartOnboarding(): (step?: unknown) => void {
  return useCallback((step?: unknown) => requestStartOnboarding(step), []);
}

export function useStartOnboardingListener(handler: (step?: OnboardingStep) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const listener = (event: Event) => {
      const step = (event as CustomEvent<StartOnboardingDetail>).detail?.step;
      handlerRef.current(isOnboardingStep(step) ? step : undefined);
    };
    window.addEventListener(START_ONBOARDING_EVENT, listener);
    return () => window.removeEventListener(START_ONBOARDING_EVENT, listener);
  }, []);
}
