import { Suspense, lazy, useMemo, useState } from "react";
import { useTheme } from "../hooks/useTheme";
import {
  clearOnboardingProgress,
  onboardingPreviewStorageKey,
  ONBOARDING_STEPS,
  parseOnboardingPreviewConfig,
  type OnboardingPreviewConfig,
  type OnboardingScenario,
  type OnboardingStep,
} from "../utils/onboardingState";
import "./preview.css";

const ControlPanel = lazy(() => import("../components/ControlPanel"));
const OnboardingFlow = lazy(() => import("../components/OnboardingFlow"));

export default function BrowserPreview() {
  const initialConfig = useMemo(() => parseOnboardingPreviewConfig(window.location.search), []);
  const [config, setConfig] = useState<OnboardingPreviewConfig>(
    () => window.loquiBrowserPreviewConfig ?? initialConfig
  );
  const [setup, setSetup] = useState(
    () => new URLSearchParams(window.location.search).get("preview") === "onboarding"
  );
  const { theme, setTheme } = useTheme();
  const scenarios: OnboardingScenario[] = [
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
  ];
  const updateConfig = (patch: Partial<OnboardingPreviewConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    window.loquiBrowserPreviewConfig = next;
    const url = new URL(window.location.href);
    url.searchParams.set("preview", "onboarding");
    url.searchParams.set("step", next.step);
    url.searchParams.set("scenario", next.scenario);
    url.searchParams.set("platform", next.platform);
    window.history.replaceState(null, "", url);
    setSetup(true);
  };
  const restart = () => {
    clearOnboardingProgress(onboardingPreviewStorageKey(config));
    localStorage.removeItem(`${onboardingPreviewStorageKey(config)}.speechReady`);
    const fresh = { ...config, step: "welcome" as const, scenario: "fresh" as const };
    clearOnboardingProgress(onboardingPreviewStorageKey(fresh));
    localStorage.removeItem(`${onboardingPreviewStorageKey(fresh)}.speechReady`);
    updateConfig(fresh);
  };
  return (
    <div className="browser-preview flex h-dvh flex-col bg-background text-foreground">
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-xs"
        role="region"
        aria-label="Browser preview controls"
      >
        <strong>Loqui · UI preview</strong>
        <span className="flex-1 text-muted-foreground">
          Sample data. Recording, sign-in, and downloads require the desktop app.
        </span>
        <button
          type="button"
          className="rounded px-2 py-1 hover:bg-muted focus-visible:outline-2"
          onClick={() => setSetup(!setup)}
        >
          {setup ? "Show workspace" : "Show setup"}
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 hover:bg-muted focus-visible:outline-2"
          onClick={restart}
        >
          Restart onboarding
        </button>
        <label className="flex items-center gap-1">
          <span className="sr-only">Jump to onboarding step</span>
          <select
            aria-label="Jump to onboarding step"
            value={config.step}
            onChange={(event) => updateConfig({ step: event.target.value as OnboardingStep })}
            className="rounded bg-muted px-2 py-1"
          >
            {ONBOARDING_STEPS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="sr-only">Preview scenario</span>
          <select
            aria-label="Preview scenario"
            value={config.scenario}
            onChange={(event) =>
              updateConfig({ scenario: event.target.value as OnboardingScenario })
            }
            className="rounded bg-muted px-2 py-1"
          >
            {scenarios.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="sr-only">Simulated platform</span>
          <select
            aria-label="Simulated platform"
            value={config.platform}
            onChange={(event) =>
              updateConfig({ platform: event.target.value as OnboardingPreviewConfig["platform"] })
            }
            className="rounded bg-muted px-2 py-1"
          >
            <option value="macos">macOS</option>
            <option value="linux">Linux</option>
          </select>
        </label>
        <button
          type="button"
          className="rounded px-2 py-1 hover:bg-muted focus-visible:outline-2"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? "Light theme" : "Dark theme"}
        </button>
      </div>
      <div className="browser-preview-content min-h-0 flex-1">
        <Suspense fallback={<div className="p-6">Loading…</div>}>
          {setup ? (
            <OnboardingFlow
              key={`${config.step}-${config.scenario}-${config.platform}`}
              previewConfig={config}
              initialStep={config.step}
              onComplete={() => setSetup(false)}
            />
          ) : (
            <ControlPanel />
          )}
        </Suspense>
      </div>
    </div>
  );
}
