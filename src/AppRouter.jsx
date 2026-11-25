import { NoticePlacementContext } from "./components/ui/useNoticePlacement";
import { NoticeStack } from "./components/ui/NoticeStack";
import { useStartOnboardingListener } from "./hooks/useStartOnboarding";
import { clearAfterSetupIntent, setAfterSetupIntent } from "./utils/afterSetupIntent";
import UpdateSettings from "./components/settings/UpdateSettings";
import { flushForUpdate } from "./utils/updateFlush";
import React, { Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import App from "./App.jsx";
import AgentDictationPillOverlay from "./components/dictation/AgentDictationPillOverlay.tsx";
import { useControlPanelWindowDrag } from "./hooks/useControlPanelWindowDrag";
import { useTheme } from "./hooks/useTheme";
import { isControlPanelWindow } from "./utils/windowContext.ts";
// App stays eager: main admits the dictation gate only from the control panel,
// so the dictation panel must have its recording listeners before any hotkey.
// The agent pill stays eager because windowManager pushes state to it on load.
// The meeting notification pulls its own data on mount, so it can load lazily.
const MeetingNotificationOverlay = React.lazy(
  () => import("./components/MeetingNotificationOverlay.tsx")
);
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
    return (
      <Suspense fallback={null}>
        <MeetingNotificationOverlay />
      </Suspense>
    );
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
  const [noticeInsets, setNoticeInsets] = useState(new Map());
  const reserveNoticeBottom = React.useCallback((owner, inset) => {
    setNoticeInsets((current) => {
      const next = new Map(current);
      if (inset === null) next.delete(owner);
      else next.set(owner, inset);
      return next;
    });
  }, []);
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
    <NoticePlacementContext.Provider value={reserveNoticeBottom}>
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
      <NoticeStack placement="panel" bottomInset={Math.max(0, ...noticeInsets.values())} />
    </NoticePlacementContext.Provider>
  );
}
