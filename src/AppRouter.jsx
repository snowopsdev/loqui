import { NoticePlacementContext } from "./components/ui/useNoticePlacement";
import { NoticeStack } from "./components/ui/NoticeStack";
import { useStartOnboardingListener } from "./hooks/useStartOnboarding";
import { clearAfterSetupIntent, setAfterSetupIntent } from "./utils/afterSetupIntent";
import UpdateSettings from "./components/settings/UpdateSettings";
import { flushForUpdate } from "./utils/updateFlush";
import React, { Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import AgentDictationPillOverlay from "./components/dictation/AgentDictationPillOverlay.tsx";
import { useControlPanelWindowDrag } from "./hooks/useControlPanelWindowDrag";
import { useTheme } from "./hooks/useTheme";
import { isControlPanelWindow } from "./utils/windowContext.ts";
// Each window mounts exactly one of these surfaces, so the larger ones stay out
// of the shared entry chunk. The agent pill stays eager: windowManager talks to
// it as soon as the page finishes loading, before a lazy chunk could mount.
const App = React.lazy(() => import("./App.jsx"));
const MeetingNotificationOverlay = React.lazy(
  () => import("./components/MeetingNotificationOverlay.tsx")
);
const ControlPanel = React.lazy(() => import("./components/ControlPanel.tsx"));
const OnboardingFlow = React.lazy(() => import("./components/OnboardingFlow.tsx"));
const BrowserPreview = import.meta.env.DEV
  ? React.lazy(() => import("./preview/BrowserPreview.tsx"))
  : null;
// Rendered after a lazy sibling inside the same Suspense boundary: its effect
// runs only once that boundary commits, after the sibling's own effects.
function MountSignal({ onMount }) {
  useEffect(() => onMount(), [onMount]);
  return null;
}
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
  // The dictation panel's App chunk loads lazily. Reporting onboarding as done
  // opens main's dictation gate, so hold that report until App has mounted
  // and registered its recording listeners; otherwise an early hotkey could
  // send events no one is listening for yet.
  const [dictationAppMounted, setDictationAppMounted] = useState(false);
  const handleDictationAppMounted = React.useCallback(() => setDictationAppMounted(true), []);
  const surfaceReady = isControlPanel || dictationAppMounted;
  useEffect(() => {
    if (!surfaceReady) return;
    if (isControlPanel) void window.electronAPI?.setOnboardingWindowMode?.("restore");
    void window.electronAPI?.setOnboardingActive?.(showOnboarding);
    if (!isControlPanel && showOnboarding) window.electronAPI?.hideWindow?.();
    if (!showOnboarding) window.electronAPI?.markMacAccessibilityFeaturesReady?.(null);
  }, [isControlPanel, showOnboarding, surfaceReady]);
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
  // The dictation panel is a transparent frameless window: an opaque loading
  // box would flash on screen while the App chunk loads.
  if (!isControlPanel)
    return (
      <Suspense fallback={null}>
        <App />
        <MountSignal onMount={handleDictationAppMounted} />
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
