import { useStartOnboardingListener } from "./hooks/useStartOnboarding";
import { clearAfterSetupIntent, setAfterSetupIntent } from "./utils/afterSetupIntent";
import UpdateSettings from "./components/settings/UpdateSettings";
import { flushForUpdate } from "./utils/updateFlush";
import React, { Suspense, useEffect, useRef, useState } from "react";
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
  ? React.lazy(() => import("./preview/BrowserPreview.tsx"))
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
  const [onboardingStart, setOnboardingStart] = useState({ step: undefined, key: 0 });
  const requestKey = useRef(0);
  const completedKey = useRef(-1);
  useStartOnboardingListener((step) => {
    clearAfterSetupIntent();
    requestKey.current += 1;
    setOnboardingStart((current) => ({ step, key: current.key + 1 }));
    setShowOnboarding(true);
  });
  useControlPanelWindowDrag(isControlPanel);
  useEffect(() => {
    if (isControlPanel) void window.electronAPI?.setOnboardingWindowMode?.("restore");
    void window.electronAPI?.setOnboardingActive?.(showOnboarding);
    if (!isControlPanel && showOnboarding) window.electronAPI?.hideWindow?.();
    if (!showOnboarding) window.electronAPI?.markMacAccessibilityFeaturesReady?.(null);
  }, [isControlPanel, showOnboarding]);
  // First launch never mounts the workspace. Once entered, retain its original
  // editor/chat/recorder owners across every later setup presentation.
  const [workspaceMounted, setWorkspaceMounted] = useState(() => !showOnboarding);
  const completeSetup = (options) => {
    if (requestKey.current !== onboardingStart.key || completedKey.current === onboardingStart.key)
      return;
    completedKey.current = onboardingStart.key;
    localStorage.setItem("onboardingCompleted", "true");
    window.electronAPI?.updates?.completeSetup();
    if (options?.next) setAfterSetupIntent(options.next);
    setWorkspaceMounted(true);
    setShowOnboarding(false);
  };
  const loading = (
    <div className="min-h-screen bg-background flex items-center justify-center">
      {t("common.loading")}
    </div>
  );
  if (!isControlPanel)
    return (
      <Suspense fallback={loading}>
        <App />
      </Suspense>
    );
  return (
    <>
      {workspaceMounted && (
        <Suspense fallback={showOnboarding ? null : loading}>
          <ControlPanel
            workspaceActive={!showOnboarding}
            workspaceActivationEpoch={requestKey}
            onReturnToWorkspace={() => completeSetup()}
          />
        </Suspense>
      )}
      {showOnboarding && (
        <Suspense fallback={loading}>
          <OnboardingFlow
            key={onboardingStart.key}
            initialStep={onboardingStart.step}
            onComplete={completeSetup}
          />
        </Suspense>
      )}
      {!showOnboarding && <UpdateSettings notice />}
    </>
  );
}
