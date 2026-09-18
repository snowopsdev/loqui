import { useCallback } from "react";
/** Repeat local device/model setup without touching saved notes or credentials. */
export function useStartOnboarding(): () => void {
  return useCallback(() => {
    localStorage.removeItem("onboardingCompleted");
    window.location.reload();
  }, []);
}
