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
      <div className="browser-preview-toolbar" role="region" aria-label="Browser preview controls">
        <div className="browser-preview-brand">
          <strong>
            Loqui <span>Preview</span>
          </strong>
          <span className="browser-preview-note">
            Sample content · Recording, sign-in, and downloads require the desktop app.
          </span>
        </div>
        <div className="browser-preview-actions">
          <button type="button" className="browser-preview-button" onClick={() => setSetup(!setup)}>
            {setup ? "Show workspace" : "Show setup"}
          </button>
          <button type="button" className="browser-preview-button" onClick={restart}>
            Restart onboarding
          </button>
          <label className="browser-preview-select">
            <span>Step</span>
            <select
              aria-label="Jump to onboarding step"
              value={config.step}
              onChange={(event) => updateConfig({ step: event.target.value as OnboardingStep })}
            >
              {ONBOARDING_STEPS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="browser-preview-select">
            <span>Scenario</span>
            <select
              aria-label="Preview scenario"
              value={config.scenario}
              onChange={(event) =>
                updateConfig({ scenario: event.target.value as OnboardingScenario })
              }
            >
              {scenarios.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="browser-preview-select">
            <span>Platform</span>
            <select
              aria-label="Simulated platform"
              value={config.platform}
              onChange={(event) =>
                updateConfig({
                  platform: event.target.value as OnboardingPreviewConfig["platform"],
                })
              }
            >
              <option value="macos">macOS</option>
              <option value="linux">Linux</option>
            </select>
          </label>
          <button
            type="button"
            className="browser-preview-button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>
        </div>
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
