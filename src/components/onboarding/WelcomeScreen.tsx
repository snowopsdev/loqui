import { useEffect, useRef } from "react";
import { ArrowRight, Check, LockKeyhole } from "lucide-react";
import { LoquiBrand } from "../LoquiBrand";
import { Toggle } from "../ui/toggle";
import "../../styles/onboarding-welcome.css";

interface WelcomeScreenProps {
  dataRetentionEnabled: boolean;
  onDataRetentionChange: (enabled: boolean) => void;
  updatesEnabled: boolean;
  onUpdatesChange: (enabled: boolean) => void;
  onContinue: () => void;
  onExplore: () => void;
}

const benefits = [
  {
    title: "Start on your device",
    detail: "Download a speech model once, then dictate locally.",
  },
  {
    title: "Choose your cleanup",
    detail: "Use a local model, ChatGPT, an API key, or none at all.",
  },
  {
    title: "Change it later",
    detail: "Providers and permissions stay under your control in Settings.",
  },
];

export default function WelcomeScreen({
  dataRetentionEnabled,
  onDataRetentionChange,
  updatesEnabled,
  onUpdatesChange,
  onContinue,
  onExplore,
}: WelcomeScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="onboarding-welcome">
      <header className="onboarding-welcome-header">
        <div className="onboarding-welcome-brand">
          <span className="onboarding-welcome-brand-mark" aria-hidden="true">
            <LoquiBrand decorative />
          </span>
          <span className="onboarding-welcome-brand-copy">
            <strong>Loqui setup</strong>
            <small>A local-first voice workspace</small>
          </span>
        </div>
        <div
          className="onboarding-welcome-progress"
          role="status"
          aria-label="Welcome, step 1 of 6"
        >
          <div className="onboarding-welcome-progress-label">
            <span>Step 1 of 6</span>
            <strong>Welcome</strong>
          </div>
          <div className="onboarding-welcome-progress-track" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => (
              <i key={index} className={index === 0 ? "is-current" : ""} />
            ))}
          </div>
        </div>
      </header>

      <main className="onboarding-welcome-split">
        <section className="onboarding-welcome-story" aria-labelledby="onboarding-welcome-heading">
          <div className="onboarding-welcome-intro">
            <h1 id="onboarding-welcome-heading" ref={headingRef} tabIndex={-1}>
              A quieter way to get words out.
            </h1>
            <p>
              Speak to make notes and text. Your workspace stays on this device. You decide if a
              provider receives any of your words.
            </p>
          </div>
          <div className="onboarding-welcome-benefits">
            {benefits.map((benefit) => (
              <div className="onboarding-welcome-benefit" key={benefit.title}>
                <span className="onboarding-welcome-benefit-check" aria-hidden="true">
                  <Check size={14} strokeWidth={2.6} />
                </span>
                <div>
                  <strong>{benefit.title}</strong>
                  <p>{benefit.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="onboarding-welcome-controls" aria-label="Privacy and update choices">
          <div className="onboarding-welcome-privacy-note">
            <LockKeyhole size={19} strokeWidth={1.9} aria-hidden="true" />
            <div>
              <strong>Before you begin</strong>
              <p>
                Your retention choice controls local transcripts. Providers receive only requests
                you choose to send, and models download only when you start them.
              </p>
            </div>
          </div>
          <div className="onboarding-welcome-preferences">
            <div className="onboarding-welcome-preference">
              <div>
                <strong>Keep local history</strong>
                <p>Save transcripts on this device. Change this anytime in Privacy &amp; Data.</p>
              </div>
              <Toggle
                checked={dataRetentionEnabled}
                onChange={onDataRetentionChange}
                aria-label="Keep local history"
              />
            </div>
            <div className="onboarding-welcome-preference">
              <div>
                <strong>Download updates automatically</strong>
                <p>Check signed GitHub releases daily. You choose when to restart.</p>
              </div>
              <Toggle
                checked={updatesEnabled}
                onChange={onUpdatesChange}
                aria-label="Download updates automatically"
              />
            </div>
          </div>
        </section>
      </main>

      <footer className="onboarding-welcome-actions">
        <button className="onboarding-welcome-back" type="button" disabled>
          Back
        </button>
        <div>
          <button className="onboarding-welcome-explore" type="button" onClick={onExplore}>
            Explore first
          </button>
          <button className="onboarding-welcome-primary" type="button" onClick={onContinue}>
            Set up dictation <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </footer>
    </div>
  );
}
