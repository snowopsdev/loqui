import { useCallback } from "react";
/** Repeat local device/model setup without touching saved notes or credentials. */
export function useStartOnboarding(): () => void {
  return useCallback(() => {
    if (window.loquiBrowserPreview) {
      window.location.reload();
      return;
    }
    localStorage.removeItem("onboardingCompleted");
    window.location.reload();
  }, []);
}
