import UpdateSettings from "./components/settings/UpdateSettings";
import { flushForUpdate } from "./utils/updateFlush";
import React, { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import App from "./App.jsx";
import AgentDictationPillOverlay from "./components/dictation/AgentDictationPillOverlay.tsx";
import MeetingNotificationOverlay from "./components/MeetingNotificationOverlay.tsx";
import { useControlPanelWindowDrag } from "./hooks/useControlPanelWindowDrag";
import { useTheme } from "./hooks/useTheme";
import { isControlPanelWindow } from "./utils/windowContext.ts";
const ControlPanel = React.lazy(() => import("./components/ControlPanel.tsx"));
const OnboardingFlow = React.lazy(() => import("./components/OnboardingFlow.tsx"));
const BrowserPreview = import.meta.env.DEV
  ? React.lazy(() => import("./preview/BrowserPreview"))
  : null;
export default function AppRouter() {
  useTheme();
  useEffect(
    () =>
      window.electronAPI?.updates?.onPrepare(async (nonce) => {
        try {
          await flushForUpdate();
          window.electronAPI.updates.prepared(nonce);
        } catch {
          window.electronAPI.updates.prepared(nonce, true);
        }
      }),
    []
  );
  if (import.meta.env.DEV && window.loquiBrowserPreview) {
    return (
      <Suspense fallback={<div>Loading Loqui preview…</div>}>
        <BrowserPreview />
      </Suspense>
    );
  }
  if (window.location.search.includes("meeting-notification=true"))
    return <MeetingNotificationOverlay />;
  if (window.location.search.includes("agent-dictation-pill=true"))
    return <AgentDictationPillOverlay />;
  return <MainApp />;
}
function MainApp() {
  const { t } = useTranslation();
  const isControlPanel = isControlPanelWindow();
  const [showOnboarding, setShowOnboarding] = useState(
    () => localStorage.getItem("onboardingCompleted") !== "true"
  );
  useControlPanelWindowDrag(isControlPanel);
  useEffect(() => {
    if (isControlPanel) void window.electronAPI?.setOnboardingWindowMode?.("restore");
    void window.electronAPI?.setOnboardingActive?.(showOnboarding);
    if (!isControlPanel && showOnboarding) window.electronAPI?.hideWindow?.();
    if (!showOnboarding) window.electronAPI?.markMacAccessibilityFeaturesReady?.(null);
  }, [isControlPanel, showOnboarding]);
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          {t("common.loading")}
        </div>
      }
    >
      {isControlPanel ? (
        showOnboarding ? (
          <OnboardingFlow
            onComplete={() => {
              localStorage.setItem("onboardingCompleted", "true");
              window.electronAPI?.updates?.completeSetup();
              setShowOnboarding(false);
            }}
          />
        ) : (
          <>
            <UpdateSettings notice />
            <ControlPanel />
          </>
        )
      ) : (
        <App />
      )}
    </Suspense>
  );
}
