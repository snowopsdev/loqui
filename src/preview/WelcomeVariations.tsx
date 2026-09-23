import { useState } from "react";
import { ArrowRight, Check, LockKeyhole, Mic, ShieldCheck } from "lucide-react";
import { Toggle } from "../components/ui/toggle";
import WelcomeScreen from "../components/onboarding/WelcomeScreen";
import "./welcome-variations.css";

export type WelcomeVariation = "1" | "2" | "3";

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

function Brand() {
  return (
    <div className="wc-brand">
      <span className="wc-brand-mark" aria-hidden="true">
        <Mic size={21} strokeWidth={2.1} />
      </span>
      <span className="wc-brand-copy">
        <strong>Loqui setup</strong>
        <small>A local-first voice workspace</small>
      </span>
    </div>
  );
}

function Progress({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`wc-progress${compact ? " wc-progress--compact" : ""}`}
      role="status"
      aria-label="Welcome, step 1 of 6"
    >
      <div className="wc-progress-label">
        <span>Step 1 of 6</span>
        <strong>Welcome</strong>
      </div>
      <div className="wc-progress-track" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <i key={index} className={index === 0 ? "is-current" : ""} />
        ))}
      </div>
    </div>
  );
}

function Intro() {
  return (
    <div className="wc-intro">
      <h1>A quieter way to get words out.</h1>
      <p>
        Speak to make notes and text. Your workspace stays on this device. You decide if a provider
        receives any of your words.
      </p>
    </div>
  );
}

function Benefits({ variant }: { variant: WelcomeVariation }) {
  return (
    <div className={`wc-benefits wc-benefits--${variant}`}>
      {benefits.map((benefit) => (
        <div className="wc-benefit" key={benefit.title}>
          <span className="wc-benefit-check" aria-hidden="true">
            <Check size={14} strokeWidth={2.6} />
          </span>
          <div>
            <strong>{benefit.title}</strong>
            <p>{benefit.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function PrivacyNote() {
  return (
    <div className="wc-privacy-note">
      <LockKeyhole size={19} strokeWidth={1.9} aria-hidden="true" />
      <div>
        <strong>Before you begin</strong>
        <p>
          Your retention choice controls local transcripts. Providers receive only requests you
          choose to send, and models download only when you start them.
        </p>
      </div>
    </div>
  );
}

function Preferences({
  history,
  onHistory,
  updates,
  onUpdates,
}: {
  history: boolean;
  onHistory: (value: boolean) => void;
  updates: boolean;
  onUpdates: (value: boolean) => void;
}) {
  return (
    <div className="wc-preferences">
      <div className="wc-preference">
        <div>
          <strong>Keep local history</strong>
          <p>Save transcripts on this device. Change this anytime in Privacy &amp; Data.</p>
        </div>
        <Toggle checked={history} onChange={onHistory} aria-label="Keep local history" />
      </div>
      <div className="wc-preference">
        <div>
          <strong>Download updates automatically</strong>
          <p>Check signed GitHub releases daily. You choose when to restart.</p>
        </div>
        <Toggle
          checked={updates}
          onChange={onUpdates}
          aria-label="Download updates automatically"
        />
      </div>
    </div>
  );
}

function Actions() {
  const goTo = (preview: string, step?: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("preview", preview);
    url.searchParams.delete("design");
    if (step) url.searchParams.set("step", step);
    window.location.assign(url);
  };
  return (
    <footer className="wc-actions">
      <button className="wc-back" type="button" disabled>
        Back
      </button>
      <div>
        <button className="wc-explore" type="button" onClick={() => goTo("workspace")}>
          Explore first
        </button>
        <button className="wc-primary" type="button" onClick={() => goTo("onboarding", "speech")}>
          Set up dictation <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
}

function VoiceStudy() {
  const bars = [16, 27, 38, 22, 54, 72, 43, 32, 59, 86, 57, 31, 44, 68, 36, 22, 46, 63, 39, 24, 16];
  return (
    <div className="wc-voice-study" aria-hidden="true">
      <div className="wc-voice-ring">
        <Mic size={27} strokeWidth={1.8} />
      </div>
      <div className="wc-waveform">
        {bars.map((height, index) => (
          <span key={index} style={{ height: `${height}%` }} />
        ))}
      </div>
      <div className="wc-voice-caption">
        <span>Speak naturally</span>
        <ArrowRight size={15} />
        <span>See your words</span>
      </div>
    </div>
  );
}

export default function WelcomeVariations({ variation }: { variation: WelcomeVariation }) {
  const [history, setHistory] = useState(true);
  const [updates, setUpdates] = useState(false);
  if (variation === "2") {
    const goTo = (preview: string, step?: string) => {
      const url = new URL(window.location.href);
      url.searchParams.set("preview", preview);
      url.searchParams.delete("design");
      if (step) url.searchParams.set("step", step);
      window.location.assign(url);
    };
    return (
      <WelcomeScreen
        dataRetentionEnabled={history}
        onDataRetentionChange={setHistory}
        updatesEnabled={updates}
        onUpdatesChange={setUpdates}
        onExplore={() => goTo("workspace")}
        onContinue={() => goTo("onboarding", "speech")}
      />
    );
  }

  const prefs = (
    <Preferences
      history={history}
      onHistory={setHistory}
      updates={updates}
      onUpdates={setUpdates}
    />
  );

  if (variation === "1") {
    return (
      <div className="wc-surface wc-surface--1">
        <header className="wc-header">
          <Brand />
          <Progress />
        </header>
        <main className="wc-main">
          <div className="wc-hero-grid">
            <Intro />
            <VoiceStudy />
          </div>
          <Benefits variant="1" />
          <div className="wc-bottom-grid">
            <PrivacyNote />
            {prefs}
          </div>
        </main>
        <Actions />
      </div>
    );
  }

  return (
    <div className="wc-surface wc-surface--3">
      <aside className="wc-side-rail">
        <Brand />
        <nav aria-label="Setup steps">
          <span className="is-current">Welcome</span>
          <span>Speech</span>
          <span>Cleanup</span>
          <span>Try dictation</span>
          <span>Use anywhere</span>
          <span>Ready</span>
        </nav>
        <div className="wc-side-rail-end">
          <ShieldCheck size={16} aria-hidden="true" /> Local-first setup
        </div>
      </aside>
      <div className="wc-sheet">
        <header className="wc-sheet-header">
          <div className="wc-sheet-mobile-brand">
            <Brand />
          </div>
          <Progress compact />
        </header>
        <main className="wc-sheet-main">
          <Intro />
          <Benefits variant="3" />
          <PrivacyNote />
          {prefs}
        </main>
        <Actions />
      </div>
    </div>
  );
}
