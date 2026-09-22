import { useState } from "react";
import { useStartOnboarding } from "../hooks/useStartOnboarding";
import { CircleAlert, CheckCircle2, X } from "./icons";
import { Button } from "./ui/button";
import { cn } from "./lib/utils";
import { onboardingPreviewStorageKey, readOnboardingProgress } from "../utils/onboardingState";

/** Compact workspace reminder for users who explored before finishing setup. */
export default function FinishDictationSetupCard() {
  const previewConfig = window.loquiBrowserPreview ? window.loquiBrowserPreviewConfig : undefined;
  const progressStorageKey = previewConfig ? onboardingPreviewStorageKey(previewConfig) : undefined;
  const dismissedStorageKey = progressStorageKey
    ? `${progressStorageKey}.checklistDismissed`
    : "loqui.onboarding.checklistDismissed";
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(dismissedStorageKey) === "true"
  );
  const progress = readOnboardingProgress(progressStorageKey);
  const startOnboarding = useStartOnboarding();

  if (
    dismissed ||
    progress.completed ||
    !localStorage.getItem(progressStorageKey ?? "loqui.onboarding.progress")
  )
    return null;

  const items = [
    [
      progress.step === "speech" ? "Choose a local speech model" : "Try a short dictation",
      progress.step === "speech" ? "speech" : "try",
    ],
    ["Choose optional text cleanup", "cleanup"],
    ["Set up shortcut and automatic paste", "shortcuts"],
  ] as const;

  return (
    <div
      className={cn(
        "mx-auto mb-3 w-full max-w-3xl rounded-xl border border-primary/25 bg-primary/5 p-4",
        "px-6"
      )}
    >
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Finish dictation setup</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your workspace is available. Complete these optional steps whenever you are ready.
              </p>
            </div>
            <button
              type="button"
              aria-label="Dismiss setup checklist"
              className="rounded p-1 text-muted-foreground hover:bg-muted"
              onClick={() => {
                localStorage.setItem(dismissedStorageKey, "true");
                setDismissed(true);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 space-y-1.5">
            {items.map(([label]) => (
              <div key={label} className="flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary/70" />
                {label}
              </div>
            ))}
          </div>
          <Button size="sm" className="mt-4" onClick={startOnboarding}>
            Resume setup
          </Button>
        </div>
      </div>
    </div>
  );
}
