import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import AppRouter from "./AppRouter.jsx";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import CleanupFailureNoticeListener from "./components/CleanupFailureNoticeListener.tsx";
import TinfoilModelSwitchNoticeListener from "./components/TinfoilModelSwitchNoticeListener.tsx";
import GpuPackMigrationNoticeListener from "./components/GpuPackMigrationNoticeListener.tsx";
import { I18nDirectionProvider } from "./components/I18nDirectionProvider.tsx";
import { SettingsProvider } from "./hooks/useSettings";
import { bindDocumentLanguage } from "./utils/i18nDocument";

import i18n, { i18nReady } from "./i18n";
// Self-hosted so it works offline and makes no network call — the "opsz" build
// carries Inter's optical-size axis, so large display text picks up the Inter
// Display shaping automatically. Declaring the face is global; only the
// onboarding surfaces actually ask for it (see .onboarding-canvas in index.css).
// The handwritten Caveat face is declared by OnboardingFlow, its only consumer.
import "@fontsource-variable/inter/opsz.css";
import "./index.css";

bindDocumentLanguage(i18n, document.documentElement, import.meta.hot);

// Non-English UI bundles load on demand; render once the active one is ready
// so the first paint is already translated. A failed load still renders (with
// the bundled English fallback) rather than leaving the window blank.
await i18nReady.catch(() => {});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nextProvider i18n={i18n}>
        <I18nDirectionProvider>
          <SettingsProvider>
            <TinfoilModelSwitchNoticeListener />
            <CleanupFailureNoticeListener />
            <GpuPackMigrationNoticeListener />
            <AppRouter />
          </SettingsProvider>
        </I18nDirectionProvider>
      </I18nextProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
