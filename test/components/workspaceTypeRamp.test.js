const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { readTokens, resolveTokens } = require("../helpers/harness/cssTokens");

const repoRoot = path.join(__dirname, "../..");
const css = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
const design = fs.readFileSync(path.join(repoRoot, "DESIGN.md"), "utf8");
const loadContrast = () => import("../../src/utils/contrast.ts");

// [size, line-height, weight, tracking|null], from the WS-R11 B card.
const RAMP = {
  display: ["2rem", "1.15", "650", "-0.02em"],
  title: ["1.375rem", "1.25", "600", "-0.015em"],
  heading: ["1.0625rem", "1.35", "600", null],
  body: ["0.9375rem", "1.55", "400", null],
  ui: ["0.8125rem", "1.4", "500", null],
  caption: ["0.75rem", "1.4", "450", null],
  micro: ["0.6875rem", "1.3", "500", "0.02em"],
};
const SURFACES = ["--color-background", "--color-card", "--color-surface-1", "--color-surface-3"];

test("the UI type ramp is registered with Tailwind", () => {
  const theme = readTokens(css, "@theme");
  for (const [name, [size, lineHeight, weight, tracking]] of Object.entries(RAMP)) {
    assert.equal(theme[`--text-${name}`], size, `${name} size`);
    assert.equal(theme[`--text-${name}--line-height`], lineHeight, `${name} line-height`);
    assert.equal(theme[`--text-${name}--font-weight`], weight, `${name} weight`);
    if (tracking)
      assert.equal(theme[`--text-${name}--letter-spacing`], tracking, `${name} tracking`);
  }
});

test("Plan 06's loop and dwell cadences are shared motion tokens (N03)", () => {
  // Same block as Plan 01's --motion-* durations; every new animation in Plan 06 reads these.
  const cadence = {
    "--motion-loop-travel": "1400ms",
    "--motion-loop-pulse": "1200ms",
    "--motion-loop-blink": "1000ms",
    "--motion-loop-stagger": "150ms",
    "--motion-dwell-ring": "1200ms",
  };
  for (const [name, value] of Object.entries(cadence)) {
    assert.equal(readTokens(css, ":root")[name], value, name);
  }
});

test("no ramp step is smaller than 11px", () => {
  const theme = readTokens(css, "@theme");
  for (const name of Object.keys(RAMP)) {
    const px = parseFloat(theme[`--text-${name}`]) * 16;
    assert.ok(px >= 11, `${name} is ${px}px`);
  }
});

test("AI and Agent text roles meet 4.5:1 in light and Plum Night", async () => {
  const { contrastRatio } = await loadContrast();
  const { light, dark } = resolveTokens(css);
  for (const [theme, map] of [
    ["light", light],
    ["dark", dark],
  ]) {
    for (const fg of ["--color-ai-text", "--color-agent-text"]) {
      for (const bg of SURFACES) {
        const ratio = contrastRatio(map[fg], map[bg]);
        assert.ok(ratio >= 4.5, `${theme}: ${fg} on ${bg} is ${ratio}:1`);
      }
    }
  }
});

test("AI and Agent fills meet 3:1 as non-text UI in both themes", async () => {
  const { contrastRatio } = await loadContrast();
  const { light, dark } = resolveTokens(css);
  for (const [theme, map] of [
    ["light", light],
    ["dark", dark],
  ]) {
    for (const fg of ["--color-ai", "--color-agent"]) {
      for (const bg of SURFACES) {
        const ratio = contrastRatio(map[fg], map[bg]);
        assert.ok(ratio >= 3, `${theme}: ${fg} on ${bg} is ${ratio}:1`);
      }
    }
  }
});

test("the agent brand mark keeps its value for the dictation panel", () => {
  assert.equal(readTokens(css, "@theme")["--color-agent-brand"], "#8787ff");
});

test("DESIGN.md documents both ramps and the AI and Agent roles", () => {
  const rows = design
    .split("\n")
    .filter((line) => /^\|\s*`text-/.test(line))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
    );
  assert.deepEqual(rows, [
    ["`text-display`", "32px / 1.15 / 650 / -0.02em", "Rare page hero"],
    ["`text-title`", "22px / 1.25 / 600 / -0.015em", "View titles, dialog titles"],
    ["`text-heading`", "17px / 1.35 / 600", "Section headings"],
    ["`text-body`", "15px / 1.55 / 400", "Transcripts, chat answers, previews"],
    ["`text-ui`", "13px / 1.4 / 500", "Labels, nav rows, buttons, menu rows"],
    ["`text-caption`", "12px / 1.4 / 450", "Metadata, timestamps, helper text"],
    ["`text-micro`", "11px / 1.3 / 500 / +0.02em", "`kbd` and badges only"],
  ]);
  assert.match(design, /### Note document ramp/);
  assert.match(design, /`--color-ai`/);
  assert.match(design, /`--color-agent`/);
});
