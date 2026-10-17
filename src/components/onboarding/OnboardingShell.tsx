import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { LoquiBrand } from "../LoquiBrand";
import { Button } from "../ui/button";
import { canNavigateTo, phaseProgress } from "../../utils/onboardingFlow";
import type { OnboardingStep } from "../../utils/onboardingState";
import { InstrumentRail, type InstrumentRailProps } from "./InstrumentRail";

export interface OnboardingShellProps {
  step: OnboardingStep;
  visited: readonly OnboardingStep[];
  platform: "darwin" | "linux" | "win32";
  rail: InstrumentRailProps;
  docked?: boolean;
  onNavigate(step: OnboardingStep): void;
  onBack?: () => void;
  onSkip?: () => void;
  finishLater?: { label: string; onClick(): void };
  primary?: { label: string; onClick(): void; disabled?: boolean; describedBy?: string };
  footerStart?: ReactNode;
  announcement?: string;
  children: ReactNode;
}

export function OnboardingShell(props: OnboardingShellProps) {
  const {
    step,
    visited,
    platform,
    rail,
    docked = false,
    onNavigate,
    onBack,
    onSkip,
    finishLater,
    primary,
    footerStart,
    announcement,
    children,
  } = props;
  const { t } = useTranslation();
  const mainRef = useRef<HTMLDivElement>(null);
  const progress = phaseProgress(step);
  const stepLabel = t(`setupFlow.steps.${step}`);

  // Every step change moves focus to its heading (kept from the old flow).
  useEffect(() => {
    mainRef.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, [step]);

  return (
    <div className="onb-shell" data-platform={platform} data-docked={docked || undefined}>
      <header className="onb-header">
        <div className="onb-brand">
          <span className="onb-brand__tile">
            <LoquiBrand decorative size={24} />
          </span>
          <strong>{t("setupFlow.brand")}</strong>
        </div>
        <nav className="onb-progress" aria-label={t("setupFlow.progress.nav")}>
          <span className="onb-progress__label">
            {progress
              ? t("setupFlow.progress.label", {
                  phase: t(`setupFlow.progress.${progress.phase}`),
                  step: stepLabel,
                })
              : t("setupFlow.progress.ready")}
          </span>
          {progress ? (
            <ol className="onb-progress__list">
              {progress.steps.map((candidate, index) => (
                <li key={candidate}>
                  <button
                    type="button"
                    className="onb-progress__step"
                    data-state={
                      index < progress.index
                        ? "done"
                        : index === progress.index
                          ? "current"
                          : "todo"
                    }
                    aria-label={t("setupFlow.progress.goTo", {
                      step: t(`setupFlow.steps.${candidate}`),
                    })}
                    aria-current={candidate === step ? "step" : undefined}
                    disabled={!canNavigateTo(candidate, step, visited)}
                    onClick={() => onNavigate(candidate)}
                  />
                </li>
              ))}
            </ol>
          ) : null}
        </nav>
        {finishLater ? (
          <button type="button" className="onb-header__later" onClick={finishLater.onClick}>
            {finishLater.label}
          </button>
        ) : null}
      </header>
      <div ref={mainRef} className="onb-main">
        <InstrumentRail {...rail} />
        <main className="onb-controls" aria-label={stepLabel}>
          <div key={step} className="onb-step">
            {children}
          </div>
        </main>
      </div>
      <footer className="onb-footer">
        {footerStart ? <div className="onb-footer__start">{footerStart}</div> : null}
        <div className="onb-footer__actions">
          {onBack ? (
            <Button variant="ghost" onClick={onBack}>
              <span className="onb-action-label">{t("setupFlow.back")}</span>
            </Button>
          ) : null}
          {onSkip ? (
            <button type="button" className="onb-footer__skip" onClick={onSkip}>
              {t("setupFlow.skipStep")}
            </button>
          ) : null}
          {primary ? (
            <Button
              data-onb-primary=""
              onClick={primary.onClick}
              disabled={primary.disabled}
              aria-describedby={primary.describedBy}
            >
              <span className="onb-action-label">{primary.label}</span>
              <ArrowRight aria-hidden="true" className="rtl:-scale-x-100" />
            </Button>
          ) : null}
        </div>
      </footer>
      {announcement !== undefined ? (
        <p className="sr-only" aria-live="polite" data-onb-announcer="">
          {announcement ?? ""}
        </p>
      ) : null}
    </div>
  );
}
