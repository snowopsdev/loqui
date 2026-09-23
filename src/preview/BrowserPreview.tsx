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
import type { WelcomeVariation } from "./WelcomeVariations";
import { CONCEPT_STEPS, type ConceptStep } from "./onboardingConceptSteps";

const ControlPanel = lazy(() => import("../components/ControlPanel"));
const OnboardingFlow = lazy(() => import("../components/OnboardingFlow"));
const WelcomeVariations = lazy(() => import("./WelcomeVariations"));
const OnboardingStepConcepts = lazy(() => import("./OnboardingStepConcepts"));

export default function BrowserPreview() {
  const initialConfig = useMemo(() => parseOnboardingPreviewConfig(window.location.search), []);
  const [config, setConfig] = useState<OnboardingPreviewConfig>(
    () => window.loquiBrowserPreviewConfig ?? initialConfig
  );
  const [setup, setSetup] = useState(
    () => new URLSearchParams(window.location.search).get("preview") === "onboarding"
  );
  const [designMode] = useState(
    () => new URLSearchParams(window.location.search).get("preview") === "welcome-designs"
  );
  const [stepDesignMode] = useState(
    () => new URLSearchParams(window.location.search).get("preview") === "onboarding-designs"
  );
  const [conceptStep, setConceptStep] = useState<ConceptStep>(() => {
    const value = new URLSearchParams(window.location.search).get("step");
    return CONCEPT_STEPS.find((candidate) => candidate === value) ?? "speech";
  });
  const [design, setDesign] = useState<WelcomeVariation>(() => {
    const value = new URLSearchParams(window.location.search).get("design");
    return value === "2" || value === "3" ? value : "1";
  });
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
    const fresh = { ...config, step: "welcome" as const, scenario: "fresh" as const };
    for (const candidate of [config, fresh]) {
      const key = onboardingPreviewStorageKey(candidate);
      clearOnboardingProgress(key);
      for (const suffix of ["speechReady", "speechReadyModel", "speechModel", "reuseCleanup"]) {
        localStorage.removeItem(`${key}.${suffix}`);
      }
    }
    updateConfig(fresh);
  };
  const selectDesign = (value: WelcomeVariation) => {
    setDesign(value);
    const url = new URL(window.location.href);
    url.searchParams.set("design", value);
    window.history.replaceState(null, "", url);
  };
  const updateConcept = (
    patch: Partial<Pick<OnboardingPreviewConfig, "scenario" | "platform">> & {
      step?: ConceptStep;
    }
  ) => {
    const next = { ...config, ...patch };
    setConfig(next);
    if (patch.step) setConceptStep(patch.step);
    const url = new URL(window.location.href);
    url.searchParams.set("preview", "onboarding-designs");
    url.searchParams.set("design", design);
    url.searchParams.set("step", patch.step ?? conceptStep);
    url.searchParams.set("scenario", next.scenario);
    url.searchParams.set("platform", next.platform);
    window.history.replaceState(null, "", url);
  };
  return (
    <div className="browser-preview flex h-dvh flex-col bg-background text-foreground">
      <div className="browser-preview-toolbar" role="region" aria-label="Browser preview controls">
        <div className="browser-preview-brand">
          <strong>
            Loqui <span>Preview</span>
          </strong>
          <span className="browser-preview-note">
            {stepDesignMode
              ? "Direction 01 guides live setup; controls on this concept page are simulated."
              : designMode
                ? "Welcome-screen concepts · Option 02 is now in the live setup."
                : "Sample content · Recording, sign-in, and downloads require the desktop app."}
          </span>
        </div>
        <div className="browser-preview-actions">
          {stepDesignMode ? (
            <>
              {(
                [
                  ["1", "01 · Guided workbench"],
                  ["2", "02 · Practice first"],
                  ["3", "03 · Setup sheet"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`browser-preview-button${design === value ? " is-selected" : ""}`}
                  aria-pressed={design === value}
                  onClick={() => selectDesign(value)}
                >
                  {label}
                </button>
              ))}
              <label className="browser-preview-select">
                <span>Step</span>
                <select
                  aria-label="Preview design step"
                  value={conceptStep}
                  onChange={(event) => updateConcept({ step: event.target.value as ConceptStep })}
                >
                  {CONCEPT_STEPS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="browser-preview-select">
                <span>Scenario</span>
                <select
                  aria-label="Preview design scenario"
                  value={config.scenario}
                  onChange={(event) =>
                    updateConcept({ scenario: event.target.value as OnboardingScenario })
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
                  aria-label="Preview design platform"
                  value={config.platform}
                  onChange={(event) =>
                    updateConcept({
                      platform: event.target.value as OnboardingPreviewConfig["platform"],
                    })
                  }
                >
                  <option value="macos">macOS</option>
                  <option value="linux">Linux</option>
                </select>
              </label>
              <a
                className="browser-preview-button browser-preview-link"
                href={`?panel=true&preview=onboarding&step=${conceptStep}&scenario=${config.scenario}&platform=${config.platform}`}
              >
                Current setup
              </a>
              <button
                type="button"
                className="browser-preview-button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? "Light theme" : "Dark theme"}
              </button>
            </>
          ) : designMode ? (
            <>
              {(
                [
                  ["1", "01 · Voice canvas"],
                  ["2", "02 · Split workbench"],
                  ["3", "03 · Setup sheet"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`browser-preview-button${design === value ? " is-selected" : ""}`}
                  aria-pressed={design === value}
                  onClick={() => selectDesign(value)}
                >
                  {label}
                </button>
              ))}
              <a
                className="browser-preview-button browser-preview-link"
                href="?panel=true&preview=onboarding&step=welcome&scenario=fresh&platform=macos"
              >
                Current setup
              </a>
              <button
                type="button"
                className="browser-preview-button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? "Light theme" : "Dark theme"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="browser-preview-button"
                onClick={() => setSetup(!setup)}
              >
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
            </>
          )}
        </div>
      </div>
      <div className="browser-preview-content min-h-0 flex-1">
        <Suspense fallback={<div className="p-6">Loading…</div>}>
          {stepDesignMode ? (
            <OnboardingStepConcepts
              variation={design}
              step={conceptStep}
              scenario={config.scenario}
              platform={config.platform}
              onStepChange={(step) => updateConcept({ step })}
            />
          ) : designMode ? (
            <WelcomeVariations variation={design} />
          ) : setup ? (
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
