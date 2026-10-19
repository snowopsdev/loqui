const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { renderStatic } = require("./harness/reactSsr");

const sourceRoot = path.resolve(__dirname, "../..");
// The dictation-window feature styles are split out of index.css; selectors
// under test may live in either file.
const readDictationStyles = () =>
  fs.readFileSync(path.join(sourceRoot, "src/index.css"), "utf8") +
  fs.readFileSync(path.join(sourceRoot, "src/styles/dictation-panel.css"), "utf8");

const levelBarCount = async () =>
  (await import("../../src/components/ui/levelBarsMath.ts")).LOGO_BAR_SHAPE.length;

// The pill's rendered footprints are a native-window contract (see
// VOICE_PILL_FOOTPRINT); every footprint assertion derives from the exported
// constants so the literals live in exactly one place.
const pillFootprints = async () => {
  const { VOICE_PILL_FOOTPRINT } = await import("../../src/helpers/voicePillPresentation.js");
  const asStyle = ({ width, height }) => new RegExp(`style="width:${width}px;height:${height}px`);
  return {
    idle: asStyle(VOICE_PILL_FOOTPRINT.idle),
    recording: asStyle(VOICE_PILL_FOOTPRINT.recording),
  };
};

const renderPill = async (state, expanded, horizontalDirection = "right", overrides = {}) => {
  const { VoicePill } = await import("../../src/components/dictation/VoicePill.tsx");
  return renderStatic(VoicePill, {
    variant: "floating",
    state,
    expanded,
    horizontalDirection,
    getAudioLevel: () => 0,
    ...overrides,
  });
};

test("thinking and recording keep the same persistent glow and pill roots", async () => {
  const thinking = await renderPill("thinking", false);
  const recording = await renderPill("recording", true);

  for (const markup of [thinking, recording]) {
    // React may prepend an image preload for the supplied listening artwork.
    assert.match(markup, /<span class="voice-pill-glow-anchor"/);
    assert.match(markup, /class="processing-signal-glow"/);
    assert.match(markup, /voice-pill-control/);
  }
  assert.match(thinking, /class="processing-signal-glow" data-active="true"/);
  assert.doesNotMatch(recording, /data-active/);
  assert.equal((thinking.match(/data-level-bar=/g) || []).length, 0);
  assert.equal((recording.match(/data-level-bar=""/g) || []).length, await levelBarCount());
});

test("one Signal glow serves both identities: brand orange processing, violet agent", async () => {
  const styles = readDictationStyles();
  const agentThinking = await renderPill("thinking", false, "right", { agentMode: true });
  // Listening must not glow in either identity: a glow before any transcript
  // exists reads as work already in flight.
  const agentListening = await renderPill("recording", false, "right", { agentMode: true });

  assert.match(styles, /\.processing-signal-glow\s*\{/);
  assert.match(styles, /:root:not\(\.dark\) \.processing-signal-glow\s*\{/);
  assert.match(
    agentThinking,
    /class="processing-signal-glow" data-active="true" data-agent="true"/
  );
  assert.doesNotMatch(agentListening, /data-active/);
});

test("the pill renders exactly the footprints the native window ladder is sized around", async () => {
  const footprint = await pillFootprints();
  const idle = await renderPill("idle", false);
  const recording = await renderPill("recording", true);

  assert.match(idle, footprint.idle);
  assert.doesNotMatch(idle, footprint.recording);
  assert.match(recording, footprint.recording);
  assert.doesNotMatch(recording, footprint.idle);
});

test("panel thinking contracts to the identity circle instead of freezing a waveform", async () => {
  const footprint = await pillFootprints();
  const panelThinking = await renderPill("thinking", false, "right", {
    variant: "panel",
    agentMode: true,
  });

  assert.match(panelThinking, footprint.idle);
  assert.match(panelThinking, /data-agent-beam-active="true"/);
  assert.doesNotMatch(panelThinking, footprint.recording);
});

test("an idle Agent panel starts with the normal pill and expands only while listening", async () => {
  const footprint = await pillFootprints();
  const idleAgent = await renderPill("idle", false, "right", {
    variant: "panel",
    agentMode: true,
    waveformOnlyWhileRecording: true,
  });
  const listeningAgent = await renderPill("recording", false, "right", {
    variant: "panel",
    agentMode: true,
    waveformOnlyWhileRecording: true,
  });

  assert.match(idleAgent, footprint.idle);
  assert.doesNotMatch(idleAgent, footprint.recording);
  assert.doesNotMatch(idleAgent, /data-active/);
  assert.match(listeningAgent, footprint.recording);
  assert.doesNotMatch(listeningAgent, /data-active/);
});

test("the waveform stays to the right of the identity across docks and voice modes", async () => {
  const right = await renderPill("recording", true, "right");
  const left = await renderPill("recording", true, "left");
  const leftAgent = await renderPill("recording", true, "left", {
    agentMode: true,
  });
  const leftLiveTranscript = await renderPill("recording", true, "left", {
    variant: "panel",
    integratedWithPanel: true,
  });

  assert.match(right, /data-horizontal-direction="right"/);
  assert.match(right, /voice-pill-control[^"\n]*pe-1/);
  assert.match(left, /data-horizontal-direction="left"/);
  assert.match(left, /voice-pill-control[^"\n]*pe-1/);

  for (const markup of [right, left, leftAgent, leftLiveTranscript]) {
    assert.doesNotMatch(markup, /flex-row-reverse/);
    assert.ok(markup.indexOf("voice-pill-identity-slot") >= 0);
    assert.ok(markup.indexOf("voice-pill-waveform") > markup.indexOf("voice-pill-identity-slot"));
  }
});

test("the collapsed Live Transcript pill transitions its logo into an expand chevron", async () => {
  const resting = await renderPill("recording", true);
  const hovered = await renderPill("recording", true, "right", {
    showExpandChevron: true,
  });
  const leftHovered = await renderPill("recording", true, "left", {
    showExpandChevron: true,
  });

  assert.doesNotMatch(resting, /data-expand-chevron/);
  assert.match(resting, /voice-pill-identity-logo[^"\n]*scale-100 opacity-100/);
  assert.match(resting, /voice-pill-expand-chevron[^"\n]*opacity-0/);
  assert.match(hovered, /data-expand-chevron="true"/);
  assert.match(hovered, /voice-pill-identity-logo[^"\n]*opacity-0/);
  assert.match(hovered, /voice-pill-expand-chevron[^"\n]*scale-100 opacity-100/);
  assert.doesNotMatch(leftHovered, /flex-row-reverse/);
  assert.ok(
    leftHovered.indexOf("voice-pill-expand-chevron") < leftHovered.indexOf("voice-pill-waveform")
  );
});

test("the idle pill keeps the logo at normal foreground strength", async () => {
  const idle = await renderPill("idle", false);

  assert.match(idle, /border-border-hover[^"\n]*dark:border-border\/50/);
  assert.match(
    idle,
    /voice-identity-icon relative inline-block shrink-0 voice-pill-identity-icon text-foreground/
  );
});

test("the floating hover pill changes surface treatment without zooming", async () => {
  const footprint = await pillFootprints();
  const hovered = await renderPill("hover", false);

  assert.match(hovered, /border-border-hover bg-surface-3 text-foreground/);
  assert.match(hovered, /box-shadow:var\(--shadow-card-hover-subtle,/);
  assert.doesNotMatch(hovered, /style="[^"]*transform:/);
  assert.match(hovered, footprint.idle);
  assert.match(hovered, /<svg width="22" height="22"/);
});

test("the waveform pill keeps the normal compact logo footprint", async () => {
  const idle = await renderPill("idle", false);
  const recording = await renderPill("recording", true);
  const liveTranscript = await renderPill("recording", true, "right", {
    variant: "panel",
    integratedWithPanel: true,
  });

  for (const markup of [idle, recording, liveTranscript]) {
    assert.match(markup, /<svg width="22" height="22"/);
  }
});

test("an interactive voice pill is keyboard focusable", async () => {
  const interactive = await renderPill("recording", true, "right", {
    role: "button",
    tabIndex: 0,
  });

  assert.match(interactive, /role="button"/);
  assert.match(interactive, /tabindex="0"/);
});

test("LevelBars supplies five live bars and five resting bars only in compact states", async () => {
  const count = await levelBarCount();
  for (const [state, expanded, live, rest] of [
    ["recording", true, count, 0],
    ["idle", true, 0, count],
    ["idle", false, 0, 0],
    ["thinking", false, 0, 0],
  ]) {
    const html = await renderPill(state, expanded);
    assert.equal((html.match(/data-level-bar=""/g) || []).length, live);
    assert.equal((html.match(/data-level-bar-rest=""/g) || []).length, rest);
  }
});

test("Live Transcript hands visual border ownership to the shared panel", async () => {
  const integrated = await renderPill("recording", true, "right", {
    variant: "panel",
    integratedWithPanel: true,
  });
  const standalone = await renderPill("recording", true);

  assert.match(integrated, /voice-pill-control/);
  assert.match(integrated, /data-integrated-with-panel="true"/);
  assert.doesNotMatch(standalone, /data-integrated-with-panel/);
});

test("Agent Mode uses the supplied mark, a purple perimeter glow, and a neutral waveform", async () => {
  const agentRecording = await renderPill("recording", true, "right", {
    agentMode: true,
  });
  const normalRecording = await renderPill("recording", true);
  const { AGENT_MODE_PATH } = await import("../../src/components/dictation/agentMark.ts");
  const styles = readDictationStyles();

  assert.match(AGENT_MODE_PATH, /^M6\.14226 /);
  assert.match(styles, /--color-agent-brand:/);
  assert.doesNotMatch(styles, /\.voice-pill-control\[data-agent-mode="true"\]\s*\{/);
  // The agent glow is the same Signal treatment re-palettes to the agent's
  // purple around the brand color.
  assert.match(styles, /\.processing-signal-glow\[data-agent="true"\]\s*\{/);
  assert.match(styles, /--signal-core: #8787ff/);
  assert.doesNotMatch(styles, /agent-waveform-background|agent-waveform-highlight/);
  // Listening stays glow-free; the purple Signal glow is reserved for the
  // post-recording thinking state so "hearing you" and "working" read apart.
  assert.match(agentRecording, /class="processing-signal-glow" data-agent="true"/);
  assert.doesNotMatch(agentRecording, /data-active/);
  assert.match(agentRecording, /data-agent-mode="true"/);
  assert.match(agentRecording, /voice-identity-final-agent/);
  assert.ok(agentRecording.includes(`d="${AGENT_MODE_PATH}"`));
  assert.doesNotMatch(agentRecording, /agent-waveform-background|text-agent-brand/);
  assert.equal((agentRecording.match(/data-level-bar=""/g) || []).length, await levelBarCount());
  assert.doesNotMatch(normalRecording, /agent-waveform-background/);
});

test("Agent thinking keeps the purple glow on the same persistent pill root", async () => {
  const agentThinking = await renderPill("thinking", false, "right", {
    agentMode: true,
  });

  assert.match(
    agentThinking,
    /class="processing-signal-glow" data-active="true" data-agent="true"/
  );
  assert.match(agentThinking, /<div [^>]*data-agent-mode="true"/);
  assert.match(agentThinking, /data-agent-beam-active="true"/);
});

test("the stable identity box contains the supplied listening artwork and Agent leaf", async () => {
  const idle = await renderPill("idle", false);
  const agentThinking = await renderPill("thinking", false, "right", {
    agentMode: true,
  });

  assert.match(idle, /data-agent-mode="false"/);
  assert.match(idle, /voice-identity-listening/);
  assert.match(idle, /<img src="[^"]*\/brand\/mark\.png" alt="" draggable="false"/);
  assert.doesNotMatch(idle, /voice-identity-morph/);
  assert.match(agentThinking, /data-agent-mode="true"/);
  assert.match(agentThinking, /voice-identity-final-agent/);
});

test("voice identities crossfade without changing geometry and respect reduced motion", () => {
  const styles = readDictationStyles();
  assert.match(
    styles,
    /\.voice-identity-icon\[data-agent-mode="true"\] \.voice-identity-listening\s*\{\s*opacity: 0;/
  );
  assert.match(
    styles,
    /\.voice-identity-icon\[data-agent-mode="true"\] \.voice-identity-agent\s*\{\s*opacity: 1;/
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.voice-identity-listening,\s*\.voice-identity-agent\s*\{\s*transition: opacity var\(--motion-base\) var\(--motion-ease-std\);/
  );
});

test("stage labels truncate inside the footprint (long translations)", async () => {
  const { VOICE_PILL_FOOTPRINT } = await import("../../src/helpers/voicePillPresentation.js");
  const html = await renderPill("cancelled", false, "right", {
    label: "Verworfen · Rückgängig machen, solange das Fenster offen ist",
    countdown: { durationMs: 5000, paused: false },
  });
  const { width, height } = VOICE_PILL_FOOTPRINT.cancelled;
  assert.match(html, new RegExp(`style="width:${width}px;height:${height}px`));
  const css = readDictationStyles();
  const rule = css.match(/\.pill-stage-label\s*\{([^}]*)\}/)[1];
  assert.match(rule, /text-overflow:\s*ellipsis/);
  assert.match(rule, /white-space:\s*nowrap/);
  assert.match(rule, /min-width:\s*0/);
});

test("transcribing and cleaning light the comet on the capsule; cleaning adds magenta", async () => {
  const transcribing = await renderPill("transcribing", false, "right", { label: "Transcribing…" });
  const cleaning = await renderPill("cleaning", false, "right", { label: "Cleaning up" });
  assert.match(
    transcribing,
    /class="processing-signal-glow" data-active="true" data-stage="transcribing"/
  );
  assert.match(cleaning, /data-stage="cleaning"/);
  assert.match(cleaning, />Cleaning up</);
  const css = readDictationStyles();
  assert.match(
    css,
    /\.processing-signal-glow\[data-stage="transcribing"\]\s*\{[^}]*--signal-deep:\s*var\(--signal-core\)/
  );
});

test("the identity sits inside a locality ring; sealed shows it blocked", async () => {
  const remote = await renderPill("idle", false, "right", {
    locality: {
      locality: "remote",
      provider: "OpenAI",
      blocked: false,
      label: "Sends to OpenAI",
      routeLine: "",
    },
  });
  assert.match(remote, /data-locality="remote"/);
  assert.match(remote, /aria-label="Sends to OpenAI"/);
  const sealed = await renderPill("idle", false, "right", {
    locality: {
      locality: "remote",
      provider: "OpenAI",
      blocked: true,
      label: "Blocked",
      routeLine: "",
    },
  });
  assert.match(sealed, /locality-ring--blocked/);
});

test("pasted swaps the logo for a drawn check on a green edge (VO-Q12)", async () => {
  const html = await renderPill("pasted", false, "right", { label: "Pasted · 19 words" });
  assert.match(html, /pill-success-check/);
  assert.match(html, /data-pill-state="pasted"/);
  assert.match(
    readDictationStyles(),
    /\.voice-pill-control\[data-pill-state="pasted"\]\s*\{[^}]*border-color:\s*var\(--color-success\)/
  );
});

test("cancelled shows a countdown that pauses on hover", async () => {
  const running = await renderPill("cancelled", false, "right", {
    label: "Discarded · Undo",
    countdown: { durationMs: 10000, paused: false },
  });
  const paused = await renderPill("cancelled", false, "right", {
    label: "Discarded · Undo",
    countdown: { durationMs: 10000, paused: true },
  });
  // Assert each declaration, not the serialised attribute (M1): React emits
  // "animation-duration:10000ms;--undo-ms:10000ms" and the order is not part of the contract.
  const style = running.match(/class="pill-countdown" style="([^"]*)"/)[1].split(";");
  assert.ok(style.includes("animation-duration:10000ms"), style.join(";"));
  assert.ok(style.includes("--undo-ms:10000ms"), "the reduced-motion duration rides along");
  assert.match(paused, /data-paused="true"/);
});

test("the retired pill waveform is gone; recording uses LevelBars", async () => {
  assert.equal(
    fs.existsSync(path.join(sourceRoot, "src/components/dictation/PillWaveform.tsx")),
    false
  );
  const html = await renderPill("recording", true);
  assert.equal((html.match(/data-level-bar=""/g) || []).length, 5);
});

test("semantic stage edges yield to fused/panel chrome and the recording skin matches its edge", async () => {
  const css = readDictationStyles();
  const stage = css.indexOf('.voice-pill-control[data-pill-state="recording"]');
  const owner = css.lastIndexOf('.voice-pill-control[data-liquid-fused="true"],');
  assert.ok(owner > stage, "the surface owner's transparent border wins the stage edge cascade");
  assert.match(css.slice(owner), /border-color:\s*transparent/);
  assert.match(
    css,
    /\.liquid-cancel-skin\[data-pill-state="recording"\] path\s*\{[^}]*stroke:\s*var\(--color-ring\)/
  );
  const fused = await renderPill("recording", true, "right", { liquidFused: true });
  assert.match(fused, /data-liquid-fused="true"/);
});
