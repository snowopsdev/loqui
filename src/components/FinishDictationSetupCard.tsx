import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useStartOnboarding } from "../hooks/useStartOnboarding";
import { Circle, CircleAlert, X } from "./icons";
import { Button } from "./ui/button";
import { cn } from "./lib/utils";
import { phaseOf } from "../utils/onboardingFlow";
import {
  onboardingPreviewStorageKey,
  readOnboardingProgress,
  type OnboardingStep,
} from "../utils/onboardingState";

/** Workspace reminder for people who left setup early (ONB-Q10): every row is a link. */
export default function FinishDictationSetupCard() {
  const { t } = useTranslation();
  const previewConfig = window.loquiBrowserPreview ? window.loquiBrowserPreviewConfig : undefined;
  const progressStorageKey = previewConfig ? onboardingPreviewStorageKey(previewConfig) : undefined;
  const dismissedStorageKey = progressStorageKey
    ? `${progressStorageKey}.checklistDismissed`
    : "loqui.onboarding.checklistDismissed";
  const [, refreshDismissal] = useState(0);
  const dismissed = localStorage.getItem(dismissedStorageKey) === "true";
  const progress = readOnboardingProgress(progressStorageKey);
  const startOnboarding = useStartOnboarding();

  if (
    dismissed ||
    progress.completed ||
    !localStorage.getItem(progressStorageKey ?? "loqui.onboarding.progress")
  ) {
    return null;
  }

  const items: Array<[string, OnboardingStep]> = [
    ...(phaseOf(progress.step) === "dictate"
      ? [["finishDictating", progress.step] as [string, OnboardingStep]]
      : []),
    ["cleanup", "cleanup"],
    ["shortcut", "shortcuts"],
  ];

  return (
    <div
      role="region"
      aria-label={t("setupFlow.resume.label")}
      className={cn(
        "mx-auto mb-3 w-full max-w-3xl rounded-xl border border-border bg-card p-4",
        "sm:px-6"
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{t("setupFlow.resume.title")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("setupFlow.resume.body")}</p>
            </div>
            <button
              type="button"
              aria-label={t("setupFlow.resume.dismiss")}
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              onClick={() => {
                localStorage.setItem(dismissedStorageKey, "true");
                refreshDismissal((value) => value + 1);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ul className="mt-3 space-y-1">
            {items.map(([key, step]) => (
              <li key={key}>
                <button
                  type="button"
                  data-row-step={step}
                  className="flex w-full items-center gap-2 rounded text-start px-1 py-0.5 text-xs text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
                  onClick={() => startOnboarding(step)}
                >
                  <Circle
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0">{t(`setupFlow.resume.items.${key}`)}</span>
                </button>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            className="mt-4 h-auto min-h-8 max-w-full whitespace-normal"
            onClick={() => startOnboarding(progress.step)}
          >
            {t("setupFlow.resume.resume")}
          </Button>
        </div>
      </div>
    </div>
  );
}
