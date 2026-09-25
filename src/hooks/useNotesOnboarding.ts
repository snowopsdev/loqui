import { useCallback, useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";
export function useNotesOnboarding() {
  const model = useSettingsStore((s) => s.cleanupModel);
  const [isComplete, setIsComplete] = useState(
    () => localStorage.getItem("notesOnboardingComplete") === "true"
  );
  const complete = useCallback(() => {
    localStorage.setItem("notesOnboardingComplete", "true");
    setIsComplete(true);
  }, []);
  return { isComplete, isLLMConfigured: !!model, complete };
}
