const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

// Spec §4: motion uses the shared tokens only. This pins Plan 04's pill,
// caption, word-row and orbit motion to them.
const repoRoot = path.join(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");
const flat = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
const withoutJsComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// Picked beats, shared next to Plan 01's tokens in src/index.css.
const BEAT_TOKENS = {
  "--motion-nudge": "260ms",
  "--motion-bounce": "640ms",
  "--motion-condense-fly": "140ms",
  "--motion-condense-land": "220ms",
  "--motion-rewrite-underline": "600ms",
};

// Plan 04's rules in dictation-panel.css. Older rules in that file keep their
// timings until their owners migrate them.
const SCOPED =
  /\.voice-identity-(?:listening|agent)|\.processing-signal-|\.liquid-cancel-skin path|\.pill-|\.condense-|\.agent-orbit|\.voice-pill-(?:sheen|levels|identity-icon|identity-logo|expand-chevron)\b|\.locality-ring--blocked|\[data-pill-state=/;

// The declared exception list (Global Constraints, "Motion tokens"). Loop
// periods are the only literal timings a scoped rule may carry:
// Functional deadlines are not motion, so they get no token. None is a
// literal in the scanned code, so the scans need no entry for them:
// - the undo underline (.pill-countdown) runs for the session's real undo
//   window: VoicePill sets animation-duration and --undo-ms from
//   countdown.durationMs (5 s or 10 s, decided by AudioManager);
// - the footprint grow (VOICE_PILL_GROW_TRANSITION) stays a JS value, because
//   LiquidCancelButton's frame tween and the listening timeline read the same
//   LISTENING_ENTRANCE_TIMING.expansionMs;
// - PILL_OUTCOME_BEAT_MS, PILL_SEALED_PAUSED_MS, PILL_AUTO_HIDE_DELAY_MS and
//   AGENT_ANSWERING_MS (Task 13) are timers, not transitions.
// Tailwind's animate-pulse on the unavailable identity is an existing ambient loop.

// Sources whose class lists and inline styles must use the tokens.
// Tasks 12, 13 and 14 add theirs.
const MOTION_SOURCES = [
  "src/components/dictation/VoicePill.tsx",
  "src/components/dictation/PillCaption.tsx",
  "src/components/dictation/CondensationWords.tsx",
  "src/components/dictation/AgentOrbit.tsx",
  "src/components/dictation/PillTooltip.tsx",
];

const DURATION = /(?<![\w.])\d*\.?\d+m?s(?![\w-])/g;
const EASING = /cubic-bezier\(|(?<![\w-])ease(?:-in-out|-in|-out)?(?![\w-])/g;

// Innermost `selector { body }` pairs, including those inside @media.
function scopedRules(css) {
  const rules = [];
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selector, body] of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const name = selector.replace(/\s+/g, " ").trim();
    if (SCOPED.test(name)) rules.push({ selector: name, body });
  }
  return rules;
}

function reducedMotionBlocks(css) {
  const blocks = [];
  const open = /@media \(prefers-reduced-motion: reduce\) \{/g;
  for (let m = open.exec(css); m; m = open.exec(css)) {
    let depth = 1;
    let i = open.lastIndex;
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
    }
    blocks.push(css.slice(open.lastIndex, i - 1));
  }
  return blocks;
}

test("Plan 04's beat tokens sit with Plan 01's, each defined once", () => {
  const css = flat(read("src/index.css"));
  for (const [name, value] of Object.entries(BEAT_TOKENS)) {
    const matches = css.match(new RegExp(`${name}:\\s*([^;]+);`, "g")) ?? [];
    assert.equal(matches.length, 1, `${name} defined exactly once`);
    assert.equal(matches[0].replace(/^[^:]+:\s*/, "").replace(/;$/, ""), value);
  }
});

test("the pill's transitions and beats use the shared tokens", () => {
  const css = flat(read("src/styles/dictation-panel.css"));
  assert.match(
    css,
    /\.voice-pill-sheen, \.voice-pill-levels \{[^}]*transition: opacity var\(--motion-fast\) var\(--motion-ease-std\)/
  );
  assert.match(
    css,
    /\.voice-pill-identity-logo, \.voice-pill-expand-chevron \{[^}]*transition-duration: var\(--motion-base\);[^}]*transition-timing-function: var\(--motion-ease-std\)/
  );
  assert.match(
    css,
    /\.voice-pill-identity-icon \{[^}]*width var\(--motion-base\) var\(--motion-ease-std\)/
  );
  assert.match(
    css,
    /\.voice-pill-control\[data-pill-state="failed"\] \{[^}]*animation: pill-nudge var\(--motion-nudge\) var\(--motion-ease-std\)/
  );
  assert.match(
    css,
    /\.pill-success-check \{[^}]*draw-check var\(--motion-base\) var\(--motion-ease-std\) var\(--motion-instant\) both, pill-pop var\(--motion-bounce\) var\(--motion-spring-bounce\) both/
  );
});

test("the rendered pill carries the token classes and no utility timings", async () => {
  const { VoicePill } = await import("../../src/components/dictation/VoicePill.tsx");
  const render = (state, props = {}) =>
    renderStatic(VoicePill, { variant: "floating", state, getAudioLevel: () => 0, ...props });
  const recording = render("recording", { expanded: true });
  const hover = render("hover", { showExpandChevron: true });
  const cancelled = render("cancelled", {
    label: "Discarded",
    countdown: { durationMs: 5000, paused: false },
  });
  assert.match(recording, /voice-pill-levels/);
  for (const html of [recording, hover, cancelled]) {
    assert.match(html, /class="voice-pill-sheen /);
    assert.match(html, /voice-pill-identity-logo/);
    assert.match(html, /voice-pill-expand-chevron/);
    assert.doesNotMatch(
      html,
      /\b(?:duration|delay)-\d|\bease-(?:in|out|in-out|linear)\b|transition-\[/
    );
  }
});

test("pill sources carry no literal timings (spec §4)", () => {
  for (const file of MOTION_SOURCES) {
    const src = withoutJsComments(read(file));
    assert.deepEqual(
      src.match(/\b(?:duration|delay)-\d+\b/g) ?? [],
      [],
      `${file}: Tailwind timing utilities`
    );
    assert.deepEqual(src.match(EASING) ?? [], [], `${file}: easing literals`);
    assert.deepEqual(src.match(DURATION) ?? [], [], `${file}: literal durations`);
  }
});

test("Plan 04's pill rules use tokens; decorative loops also use tokens", () => {
  const rules = scopedRules(read("src/styles/dictation-panel.css"));
  assert.ok(
    rules.some((rule) => rule.selector === ".pill-success-check"),
    "the scan sees the new rules"
  );
  for (const { selector, body } of rules) {
    const allowed = [];
    const found = [...(body.match(DURATION) ?? []), ...(body.match(EASING) ?? [])];
    assert.deepEqual(
      found.filter((value) => !allowed.includes(value)),
      [],
      selector
    );
  }
});

test("reduced motion keeps the pill's opacity cues and drops its movement", () => {
  const reduced = reducedMotionBlocks(read("src/styles/dictation-panel.css")).map(flat).join(" ");
  // index.css crushes every animation to 0.01ms; these fades opt back in.
  assert.match(
    reduced,
    /\.pill-success-check, \.pill-caption \{ animation: notice-fade var\(--motion-fast\) linear both !important; \}/
  );
  assert.match(reduced, /\.voice-pill-control\[data-pill-state="failed"\] \{ animation: none; \}/);
  // The token transitions keep their fade: index.css keeps opacity in
  // transition-property and drops transform, translate and scale.
  assert.match(
    read("src/index.css"),
    /prefers-reduced-motion: reduce[\s\S]*?transition-property:\s*opacity, color, background-color/
  );
});

test("Signal and locality cadences are shared tokens, not local decorative literals", () => {
  const css = flat(read("src/styles/dictation-panel.css"));
  assert.match(css, /processing-signal-spin var\(--motion-signal-comet\) linear infinite/);
  assert.match(
    css,
    /processing-signal-breathe var\(--motion-signal-breathe\) var\(--motion-ease-ambient\) infinite/
  );
  assert.match(
    read("src/index.css"),
    /locality-orbit var\(--motion-locality-orbit\) linear infinite/
  );
  assert.match(css, /var\(--shadow-card, /);
  assert.doesNotMatch(
    read("src/components/dictation/VoicePill.tsx"),
    /shadow-\[var\(--shadow-card\)\]/
  );
});
