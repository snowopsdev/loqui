import { Suspense, lazy, useState } from "react";
import { useTheme } from "../hooks/useTheme";
import "./preview.css";

const ControlPanel = lazy(() => import("../components/ControlPanel"));
const OnboardingFlow = lazy(() => import("../components/OnboardingFlow"));

export default function BrowserPreview() {
  const [setup, setSetup] = useState(false);
  const { theme, setTheme } = useTheme();
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
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? "Light theme" : "Dark theme"}
        </button>
      </div>
      <div className="browser-preview-content min-h-0 flex-1">
        <Suspense fallback={<div className="p-6">Loading…</div>}>
          {setup ? <OnboardingFlow onComplete={() => setSetup(false)} /> : <ControlPanel />}
        </Suspense>
      </div>
    </div>
  );
}
