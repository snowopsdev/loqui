# Loqui UI/UX Plan 01 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the shared system every later UI plan builds on:
- motion tokens;
- semantic colour roles, where orange means live voice;
- the Plum Night dark theme;
- brand-correct pill glow;
- the locality model and ring;
- the logo-shaped level meter.

**Architecture:** Tokens live in `src/index.css` (`@theme` for Tailwind-registered colours, `:root` for motion, `.dark` for Plum Night). Two new pure modules hold the logic: `src/lib/locality.ts` for route locality and `src/components/ui/levelBarsMath.ts` for meter geometry. Thin React primitives render them: `LocalityRing`, `LevelBars`. Contrast is enforced by tests that parse the real CSS tokens.

**Tech Stack:** React 19, Tailwind CSS 4 (`@theme`), class-variance-authority, TypeScript, Node `node:test` with `tsx` and `react-dom/server` (via `test/helpers/harness/reactSsr.js`).

**Spec:** `docs/superpowers/specs/2026-10-15-loqui-uiux-overhaul.md` (decisions D1, D4, D5 and the Plan 01 row). Visual reference: `design-explorations/loqui-uiux-review.html#ch-foundations`.

## Global Constraints

- Text contrast ≥ 4.5:1 and non-text UI ≥ 3:1, in light theme and Plum Night.
- Never put white text on `#FF5A1F` (3.12:1). Text on orange is `#171717` (5.75:1 on `#FF5A1F`, 6.29:1 on `#FF6A36`).
- Motion custom properties are prefixed `--motion-` so they never collide with Tailwind's own `--ease-*` theme variables (see the existing comment above `--onboarding-ease-out` in `src/index.css`).
- No UI exit uses an ease-in curve: `cubic-bezier(0.4, 0, 1, 1)` must not appear anywhere in `src/`.
- Reduced motion keeps opacity and colour feedback and drops transforms. This is the existing policy block in `src/index.css`; do not weaken it.
- Unknown providers resolve to `remote` (fail toward disclosure). Loopback self-hosted URLs resolve to `device`.
- Every visible string goes through i18n with keys in all 12 locales (`ar de en es fr it ja pt ru zh-CN zh-TW`). `npm run i18n:check` passes.
- Use logical properties (`start`/`end`, `inset-inline-*`, `ms-`/`me-`) for RTL.
- Tests: `npm run native:node` once, then `npm test -- <files>`. Before launching the desktop app run `npm run native:electron`.
- Node: `~/.nvm/versions/node/v24.21.0/bin` (matches `.node-version` 24.21.0).

## Review Focus

1. **Theme toggle mid-session.** Removing the global `*` colour transition must not leave interactive controls snapping on hover. `button`, `a`, form fields and ARIA widgets keep a 150 ms colour transition. Pinned in Task 1, `motionTokens.test.js`, "interactive elements keep colour transitions".
2. **Reduced motion.** The remote ring orbit and the meter must not animate. Locality must still read from ring shape alone, and the meter must still update, at 10 Hz with no transition. Pinned in Task 7 (`localityRing.test.js`, reduced-motion CSS) and Task 8 (`levelBars.test.js`, `LEVEL_BARS_REDUCED_SAMPLE_MS`).
3. **Self-hosted URL edge cases.** `http://localhost:11434/v1` and `http://[::1]:8080` resolve to `device`. A LAN IP resolves to `network`. An empty or malformed URL resolves to `network`, never `device`. Pinned in Task 6.
4. **Bad meter input.** `NaN`, negative or `Infinity` levels from a disconnected analyser must render the resting logo silhouette, not collapse or explode. Pinned in Task 8.
5. **RTL.** The provider badge sits at the inline end, and the button's brand dot leads at the inline start. Pinned in Task 7 (`inset-inline-end` assertion) and Task 3 (the dot is a `before:` pseudo-element, which always renders at the inline start; the test asserts `before:bg-live`).

---

### Task 1: Motion tokens, scoped colour transitions, no ease-in exits

Covers FND-R3 B, VO-Q17 and WS-Q15.

**Files:**
- Modify: `src/index.css`. Add tokens to the `:root` block that starts at line 54, and replace the `@layer base { * { … transition … } }` rule at lines 174–181.
- Modify: `src/styles/dictation-panel.css:213-215` and `:224-226`, plus any other hit from the Step 3 grep.
- Modify: `DESIGN.md`. Add a `## Motion` section after `## Elevation`.
- Test: `test/components/motionTokens.test.js`

**Interfaces:**
- Produces these CSS custom properties on `:root`, used by every later plan:
  - durations `--motion-instant` (90ms), `--motion-fast` (150ms), `--motion-base` (240ms), `--motion-slow` (360ms), `--motion-hero` (520ms);
  - easings `--motion-ease-std`, `--motion-ease-enter`, `--motion-ease-exit`;
  - springs `--motion-spring-snap` (use with 380ms), `--motion-spring-settle` (520ms), `--motion-spring-bounce` (640ms, success only).

- [ ] **Step 1: Write the failing test**

Create `test/components/motionTokens.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.join(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

test("motion tokens are defined once on :root with the approved values", () => {
  const css = read("src/index.css");
  const expected = {
    "--motion-instant": "90ms",
    "--motion-fast": "150ms",
    "--motion-base": "240ms",
    "--motion-slow": "360ms",
    "--motion-hero": "520ms",
    "--motion-ease-std": "cubic-bezier(0.2, 0, 0, 1)",
    "--motion-ease-enter": "cubic-bezier(0.16, 1, 0.3, 1)",
    "--motion-ease-exit": "cubic-bezier(0.2, 0, 0.4, 1)",
  };
  for (const [name, value] of Object.entries(expected)) {
    const matches = css.match(new RegExp(`${name}:\\s*([^;]+);`, "g")) ?? [];
    assert.equal(matches.length, 1, `${name} defined exactly once`);
    assert.equal(matches[0].replace(/^[^:]+:\s*/, "").replace(/;$/, ""), value);
  }
  for (const spring of ["--motion-spring-snap", "--motion-spring-settle", "--motion-spring-bounce"]) {
    assert.match(css, new RegExp(`${spring}:\\s*linear\\(0, `), `${spring} is a linear() spring`);
  }
});

test("no ease-in exit curve anywhere in the renderer", () => {
  const files = walk(path.join(repoRoot, "src"), [".css", ".tsx", ".ts", ".jsx", ".js"]);
  const offenders = files.filter((f) => /cubic-bezier\(\s*0\.4\s*,\s*0\s*,\s*1\s*,\s*1\s*\)/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(offenders.map((f) => path.relative(repoRoot, f)), []);
});

test("the universal selector no longer transitions every element", () => {
  const css = read("src/index.css");
  const universal = css.match(/@layer base\s*\{\s*\*\s*\{([^}]*)\}/);
  assert.ok(universal, "base layer still sets the default border colour on *");
  assert.doesNotMatch(universal[1], /transition/);
});

test("interactive elements keep colour transitions after the global rule is removed", () => {
  const css = read("src/index.css");
  const rule = css.match(/:where\(button, a, input, select, textarea, summary, \[role="button"\], \[role="tab"\], \[role="menuitem"\], \[role="option"\], \[role="switch"\]\)\s*\{([^}]*)\}/);
  assert.ok(rule, "scoped interactive transition rule exists");
  assert.match(rule[1], /background-color var\(--motion-fast\) var\(--motion-ease-std\)/);
  assert.match(rule[1], /color var\(--motion-fast\) var\(--motion-ease-std\)/);
});

test("reduced-motion policy still drops transforms and keeps opacity", () => {
  const css = read("src/index.css");
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?transition-property:\s*opacity, color, background-color/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/motionTokens.test.js`
Expected: FAIL. "--motion-instant defined exactly once" fails (0 matches), the ease-in test lists `src/styles/dictation-panel.css`, and the universal-selector test fails.

- [ ] **Step 3: Implement**

1. Find every ease-in exit:

   Run: `grep -rnE "cubic-bezier\(\s*0\.4\s*,\s*0\s*,\s*1\s*,\s*1\s*\)" src`

   Replace each occurrence with `var(--motion-ease-exit)`. The known hits are `src/styles/dictation-panel.css:214` and `:225`, which become:

   ```css
     animation: assistant-footer-retreat var(--assistant-actions-retreat-duration, 220ms)
       var(--motion-ease-exit) both;
   ```

   ```css
     animation: assistant-footer-retreat var(--assistant-pill-retreat-duration, 180ms)
       var(--motion-ease-exit) both;
   ```

2. In `src/index.css`, add this inside `:root { … }` directly after the `--onboarding-ease-out` line:

   ```css
     /* Loqui Motion (DESIGN.md "Motion"). Prefixed --motion- so Tailwind's own
        --ease-* theme variables stay untouched. Exits run at ~70% of the enter
        duration with --motion-ease-exit; never ease-in. Springs are CSS
        linear() curves: snap at 380ms (+6.6%), settle at 520ms (+8.6%),
        bounce at 640ms (+19%, success confirmations only). */
     --motion-instant: 90ms;
     --motion-fast: 150ms;
     --motion-base: 240ms;
     --motion-slow: 360ms;
     --motion-hero: 520ms;
     --motion-ease-std: cubic-bezier(0.2, 0, 0, 1);
     --motion-ease-enter: cubic-bezier(0.16, 1, 0.3, 1);
     --motion-ease-exit: cubic-bezier(0.2, 0, 0.4, 1);
     --motion-spring-snap: linear(0, 0.075, 0.245, 0.446, 0.637, 0.796, 0.915, 0.995, 1.042, 1.063, 1.066, 1.059, 1.047, 1.033, 1.021, 1.011, 1.004, 0.999, 0.997, 0.996, 0.996, 0.996, 0.997, 1);
     --motion-spring-settle: linear(0, 0.076, 0.251, 0.46, 0.659, 0.824, 0.947, 1.026, 1.07, 1.086, 1.083, 1.07, 1.052, 1.034, 1.019, 1.007, 0.999, 0.995, 0.993, 0.993, 0.994, 0.995, 0.997, 1);
     --motion-spring-bounce: linear(0, 0.119, 0.386, 0.683, 0.933, 1.1, 1.18, 1.188, 1.152, 1.097, 1.042, 0.999, 0.973, 0.964, 0.966, 0.974, 0.985, 0.995, 1.002, 1.006, 1.007, 1.006, 1.004, 1);
   ```

3. Replace the base-layer universal rule. Today it reads:

   ```css
   @layer base {
     * {
       border-color: var(--color-border);
       transition:
         background-color 150ms ease,
         border-color 150ms ease,
         color 150ms ease;
     }
   ```

   Change it to:

   ```css
   @layer base {
     * {
       border-color: var(--color-border);
     }

     /* Colour feedback belongs to things you can operate. A transition on every
        element smeared theme switches and re-fired on every per-frame style
        write (meters, glows). :where() keeps specificity at zero so Tailwind
        transition utilities still override it. */
     :where(button, a, input, select, textarea, summary, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"]) {
       transition:
         background-color var(--motion-fast) var(--motion-ease-std),
         border-color var(--motion-fast) var(--motion-ease-std),
         color var(--motion-fast) var(--motion-ease-std);
     }
   ```

4. In `DESIGN.md`, add a section after `## Elevation`:

   ```markdown
   ## Motion

   One language for every surface. **Hue is mode, shape is locality, motion is progress.**

   | Token | Value | Use |
   |---|---|---|
   | `--motion-instant` | 90ms | press, colour change |
   | `--motion-fast` | 150ms | hover, label swaps, tooltips |
   | `--motion-base` | 240ms | surface enter, toast, chip |
   | `--motion-slow` | 360ms | morphs, panel growth |
   | `--motion-hero` | 520ms | spring settle (visual length) |
   | `--motion-ease-std` | cubic-bezier(0.2, 0, 0, 1) | movement and morphs |
   | `--motion-ease-enter` | cubic-bezier(0.16, 1, 0.3, 1) | things arriving |
   | `--motion-ease-exit` | cubic-bezier(0.2, 0, 0.4, 1) | things leaving, at ~70% of enter |
   | `--motion-spring-snap` / `-settle` / `-bounce` | CSS `linear()` | press release and morphs / panels / success only |

   Rules:
   - First feedback within 50 ms.
   - At most two focal motions at once.
   - Animate only `transform`, `opacity`, `clip-path`, `filter` and registered properties.
   - Loops run only while their state is active and the window is visible.
   - Every motion has a non-motion twin (shape, label or colour).
   - Never ease-in.
   ```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/components/motionTokens.test.js test/components/rtlMotion.test.js test/components/liveWaveform.test.js`
Expected: PASS (the existing motion and waveform suites still pass).

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/styles/dictation-panel.css DESIGN.md test/components/motionTokens.test.js
git commit -m "feat(ui): add Loqui motion tokens and scope colour transitions"
```

---

### Task 2: Contrast utility and CSS token reader

Foundation for FND-R1 and FND-R2 tests.

**Files:**
- Create: `src/utils/contrast.ts`
- Create: `test/helpers/harness/cssTokens.js`
- Test: `test/utils/contrast.test.js`

**Interfaces:**
- Produces `src/utils/contrast.ts`:
  - `parseHexColor(hex: string): { r: number; g: number; b: number }`. Throws `Error("Unsupported colour: <hex>")` for non-`#rrggbb` and non-`#rgb` input.
  - `relativeLuminance(hex: string): number`
  - `contrastRatio(foreground: string, background: string): number`, rounded to 2 decimals.
- Produces `test/helpers/harness/cssTokens.js`:
  - `readTokens(cssText, selector)` returns a `Record<string, string>` of `--name` to raw value, taken from the first block whose selector text is exactly `selector` (`"@theme"`, `":root"`, `".dark"`).
  - `resolveTokens(cssText)` returns `{ light, dark }`, where `dark` is the light map overlaid with `.dark`.

- [ ] **Step 1: Write the failing test**

Create `test/utils/contrast.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { readTokens, resolveTokens } = require("../helpers/harness/cssTokens");

const load = () => import("../../src/utils/contrast.ts");

test("contrast ratios match WCAG reference values", async () => {
  const { contrastRatio } = await load();
  assert.equal(contrastRatio("#ffffff", "#ff5a1f"), 3.12);
  assert.equal(contrastRatio("#171717", "#ff5a1f"), 5.75);
  assert.equal(contrastRatio("#171717", "#ff6a36"), 6.29);
  assert.equal(contrastRatio("#c43e13", "#ffffff"), 5.19);
  assert.equal(contrastRatio("#000", "#fff"), 21);
  assert.equal(contrastRatio("#ff5a1f", "#ffffff"), contrastRatio("#ffffff", "#ff5a1f"));
});

test("non-hex colours are rejected rather than silently scored", async () => {
  const { parseHexColor } = await load();
  assert.throws(() => parseHexColor("oklch(0.22 0.006 260)"), /Unsupported colour/);
  assert.throws(() => parseHexColor("#12345"), /Unsupported colour/);
  assert.deepEqual(parseHexColor("#FfF"), { r: 255, g: 255, b: 255 });
});

test("token reader takes the first exact block and overlays .dark on light", () => {
  const css = `@theme {\n  --color-a: #111111;\n  --color-b: #222222;\n}\n.dark {\n  --color-b: #333333;\n}\n.dark .x {\n  --color-b: #999999;\n}`;
  assert.deepEqual(readTokens(css, "@theme"), { "--color-a": "#111111", "--color-b": "#222222" });
  assert.deepEqual(readTokens(css, ".dark"), { "--color-b": "#333333" });
  const { light, dark } = resolveTokens(css);
  assert.equal(light["--color-b"], "#222222");
  assert.equal(dark["--color-b"], "#333333");
  assert.equal(dark["--color-a"], "#111111");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/utils/contrast.test.js`
Expected: FAIL with `Cannot find module '../helpers/harness/cssTokens'`.

- [ ] **Step 3: Implement**

Create `src/utils/contrast.ts`:

```ts
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHexColor(hex: string): Rgb {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Unsupported colour: ${hex}`);
  const digits =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((d) => d + d)
          .join("")
      : match[1];
  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
  };
}

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHexColor(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return Math.round(ratio * 100) / 100;
}
```

Create `test/helpers/harness/cssTokens.js`:

```js
// Reads custom-property declarations from a named top-level CSS block so
// contrast tests score the tokens the app actually ships, not copies.
function blockBody(cssText, selector) {
  const lines = cssText.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${selector} {`);
  if (start === -1) throw new Error(`No block for selector ${selector}`);
  let depth = 0;
  const body = [];
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
    }
    if (i > start) body.push(lines[i]);
    if (depth === 0) break;
  }
  return body.join("\n");
}

function readTokens(cssText, selector) {
  const out = {};
  for (const m of blockBody(cssText, selector).matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

function resolveTokens(cssText) {
  const light = { ...readTokens(cssText, "@theme") };
  const dark = { ...light, ...readTokens(cssText, ".dark") };
  return { light, dark };
}

module.exports = { readTokens, resolveTokens };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/utils/contrast.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/contrast.ts test/helpers/harness/cssTokens.js test/utils/contrast.test.js
git commit -m "test(ui): add WCAG contrast utility and CSS token reader"
```

---

### Task 3: Semantic colour roles, where orange means live voice

Covers FND-R1 C, WS-R11 B (colour roles), and the token parts of ONB-Q4, VO-Q4 and WS-Q4.

**Files:**
- Modify: `src/index.css`. Add role tokens to `@theme` (lines 7–52).
- Modify: `src/components/ui/gradientCircle.ts:5-6`
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/ControlPanelSidebar.tsx:64` and `:73`
- Modify: `DESIGN.md`, sections `## Colors` and `### Buttons`.
- Test: `test/components/colorRoles.test.js`

**Interfaces:**
- Consumes `contrastRatio` (Task 2) and `resolveTokens` (Task 2).
- Produces these Tailwind colour tokens, usable as `bg-*` and `text-*` utilities:
  - `--color-cta`, `--color-cta-foreground`: the default call to action, an ink capsule.
  - `--color-live`, `--color-live-foreground`: orange, for voice-live controls only.
  - `--color-nav-marker`: the active-navigation marker.
  - `--color-locality-device`, `--color-locality-network`, `--color-locality-remote`.
- Produces two `Button` variant changes:
  - `variant="live"` is new: orange glass with ink text. Use it for record, stop, mic and voice send.
  - `variant="default"` is now the ink capsule with a leading orange dot.
  - `variant="link"` now uses `text-link`.

- [ ] **Step 1: Write the failing test**

Create `test/components/colorRoles.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");
const { resolveTokens } = require("../helpers/harness/cssTokens");

const repoRoot = path.join(__dirname, "../..");
const css = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
const loadContrast = () => import("../../src/utils/contrast.ts");
const loadButton = () => import("../../src/components/ui/button.tsx");

const LIGHT_TEXT_PAIRS = [
  ["--color-foreground", "--color-background"],
  ["--color-muted-foreground", "--color-background"],
  ["--color-link", "--color-background"],
  ["--color-cta-foreground", "--color-cta"],
  ["--color-live-foreground", "--color-live"],
  ["--color-locality-device", "--color-background"],
  ["--color-locality-network", "--color-background"],
  ["--color-locality-remote", "--color-background"],
  ["--color-locality-device", "--color-surface-window"],
  ["--color-locality-network", "--color-surface-window"],
  ["--color-locality-remote", "--color-surface-window"],
];

test("light theme text roles meet 4.5:1", async () => {
  const { contrastRatio } = await loadContrast();
  const { light } = resolveTokens(css);
  for (const [fg, bg] of LIGHT_TEXT_PAIRS) {
    const ratio = contrastRatio(light[fg], light[bg]);
    assert.ok(ratio >= 4.5, `${fg} on ${bg} is ${ratio}:1`);
  }
});

test("live is the only orange-filled role, and it carries ink text", () => {
  const { light } = resolveTokens(css);
  assert.equal(light["--color-live"].toLowerCase(), "#ff5a1f");
  assert.equal(light["--color-live-foreground"].toLowerCase(), "#171717");
  assert.notEqual(light["--color-cta"].toLowerCase(), "#ff5a1f");
});

test("the brand glass surface never pairs white text with orange", () => {
  const source = fs.readFileSync(path.join(repoRoot, "src/components/ui/gradientCircle.ts"), "utf8");
  const surface = source.match(/BRAND_GLASS_SURFACE =\s*"([^"]+)"/)[1];
  assert.doesNotMatch(surface, /text-white/);
  assert.match(surface, /text-live-foreground/);
});

test("default button is the ink CTA with a leading brand dot; live is orange", async () => {
  const { Button } = await loadButton();
  const cta = renderStatic(Button, null, "Set up dictation");
  assert.match(cta, /data-variant="default"/);
  assert.match(cta, /bg-cta/);
  assert.match(cta, /text-cta-foreground/);
  assert.match(cta, /before:bg-live/);
  assert.doesNotMatch(cta, /gradient-brand-glass/);

  const live = renderStatic(Button, { variant: "live" }, "Start recording");
  assert.match(live, /data-variant="live"/);
  assert.match(live, /gradient-brand-glass/);
  assert.match(live, /text-live-foreground/);

  const icon = renderStatic(Button, { size: "icon", "aria-label": "Close" });
  assert.match(icon, /before:hidden/);

  const link = renderStatic(Button, { variant: "link" }, "Privacy & Data");
  assert.match(link, /text-link/);
  assert.doesNotMatch(link, /text-primary/);
});

test("sidebar active marker uses the nav-marker role", () => {
  const source = fs.readFileSync(path.join(repoRoot, "src/components/ControlPanelSidebar.tsx"), "utf8");
  assert.match(source, /bg-nav-marker/);
  assert.doesNotMatch(source, /w-0\.5 rounded-full bg-primary/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/colorRoles.test.js`
Expected: FAIL. `light["--color-cta-foreground"]` is `undefined`, so `parseHexColor` throws "Unsupported colour: undefined".

- [ ] **Step 3: Implement**

1. In `src/index.css`, inside `@theme { … }` after `--color-info-foreground: #ffffff;`, add:

   ```css
     /* Roles (DESIGN.md "Colors"). Orange means "live voice": it fills only
        record/stop/mic controls, the pill and meters. The everyday call to
        action is an ink capsule that carries a small orange brand dot. */
     --color-cta: #171717;
     --color-cta-foreground: #ffffff;
     --color-live: #ff5a1f;
     --color-live-foreground: #171717;
     --color-nav-marker: #ff5a1f;
     /* Locality: shape carries it first (solid, dotted, dashed ring); these
        hues back it up. Green/blue/amber, never orange or violet, so locality
        never reads as mode. */
     --color-locality-device: #0b7a54;
     --color-locality-network: #3b6ea8;
     --color-locality-remote: #b45309;
   ```

2. In `src/components/ui/gradientCircle.ts`, replace lines 5–6 with:

   ```ts
   export const BRAND_GLASS_SURFACE =
     "bg-[image:var(--gradient-brand-glass)] shadow-(--shadow-brand-glass) text-live-foreground";
   ```

3. In `src/components/ui/button.tsx`, replace the `default` and `link` variants and add `live` and a compound variant. The `variants.variant` entries become:

   ```ts
           // Everyday call to action: ink capsule, small orange brand dot first.
           default: [
             "relative font-semibold tracking-[0.005em]",
             "bg-cta text-cta-foreground shadow-sm",
             "before:content-[''] before:size-1.5 before:rounded-full before:bg-live before:shadow-[0_0_0_3px_rgb(255_90_31/0.25)]",
             "hover:brightness-110",
             "active:brightness-95 active:scale-[0.985]",
             "transition-[filter,transform] duration-200 ease-out",
           ].join(" "),

           // Live voice only: record, stop, mic, voice send. Orange glass, ink text.
           live: [
             "relative font-semibold tracking-[0.005em]",
             BRAND_GLASS_SURFACE,
             "hover:brightness-110",
             "active:brightness-95 active:scale-[0.985]",
             "transition-[filter,transform] duration-200 ease-out",
           ].join(" "),
   ```

   The `link` variant becomes:

   ```ts
           link: [
             "font-medium",
             "text-link",
             "hover:text-link/80 hover:underline",
             "underline-offset-4",
           ].join(" "),
   ```

   After the `size` block, before `defaultVariants`, add:

   ```ts
       compoundVariants: [{ variant: "default", size: "icon", className: "before:hidden" }],
   ```

4. Audit default `<Button>` usages that start or stop recording and switch them to `variant="live"`:

   Run: `grep -rnE "<Button[^>]*>" src --include="*.tsx" | grep -iE "record|dictat|mic|listen" | grep -v "variant="`

   For each hit whose `onClick` starts or stops recording, add `variant="live"`. Leave everything else on `default`. Components using `GRADIENT_CIRCLE` or `BRAND_GLASS_SURFACE` directly (`ChatInput.tsx`, `NoteRecordControl.tsx`, `UpcomingMeetings.tsx`, `MeetingNotificationCard.tsx`) already render the live surface and need no change.

5. In `src/components/ControlPanelSidebar.tsx`:
   - line 64: replace `w-0.5 rounded-full bg-primary` with `w-0.5 rounded-full bg-nav-marker`;
   - line 73: replace `"text-primary"` with `"text-nav-marker"`.

6. In `DESIGN.md` `## Colors`, add a `### Roles` subsection:

   ```markdown
   ### Roles
   - **Live** (`--color-live` #FF5A1F, ink text #171717): orange means a voice is live. Use it only for record/stop/mic controls, the pill and the meters (`Button variant="live"`).
   - **Call to action** (`--color-cta` #171717 / white text; Plum Night #F3E9EE / #1C1218 text): the default `Button`. It carries a 6px orange dot as the brand mark.
   - **Link** (`--color-link` #C43E13 light, #FF9A7A dark): always for inline links, never raw orange.
   - **Locality**: device #0B7A54, your network #3B6EA8, remote provider #B45309 (dark: #5EE0AD, #9BB4D6, #FBBF6A). Always paired with ring shape and words.
   - **Nav marker** (`--color-nav-marker`): orange in light, magenta #E6007A in Plum Night.
   ```

   In `### Buttons`, change the primary description to: "Default buttons are ink capsules with a leading orange dot; `live` buttons use the orange glass surface with ink text and are reserved for voice controls."

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/components/colorRoles.test.js test/components/newNoteMenu.test.js test/components/noteBottomBar.test.js`
Expected: PASS. If an existing structure test asserts `text-white` on a brand surface, update that assertion to `text-live-foreground` in the same commit; that change is exactly the D1 contrast fix.

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/components/ui/gradientCircle.ts src/components/ui/button.tsx src/components/ControlPanelSidebar.tsx DESIGN.md test/components/colorRoles.test.js
git add -u src/components
git commit -m "feat(ui): orange means live voice; ink CTA, live variant, colour roles"
```

---

### Task 4: Plum Night dark theme

Covers FND-R2 C.

**Files:**
- Modify: `src/index.css`, the `.dark { … }` block (lines 104–171).
- Modify: `DESIGN.md` frontmatter `colors:` (`night-*` keys) and the dark-mode prose in `## Colors`.
- Test: `test/components/plumNight.test.js`

**Interfaces:**
- Consumes `resolveTokens` and `contrastRatio` (Task 2), and the role tokens (Task 3).
- Produces dark-theme hex values for every surface, text, border and role token listed below.

- [ ] **Step 1: Write the failing test**

Create `test/components/plumNight.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { resolveTokens } = require("../helpers/harness/cssTokens");

const css = fs.readFileSync(path.join(__dirname, "../..", "src/index.css"), "utf8");
const load = () => import("../../src/utils/contrast.ts");

const SURFACES = {
  "--color-background": "#1c1218",
  "--color-card": "#271820",
  "--color-popover": "#2b1b24",
  "--color-secondary": "#2a1922",
  "--color-muted": "#22161c",
  "--color-input": "#170e13",
  "--color-surface-0": "#1c1218",
  "--color-surface-1": "#21151b",
  "--color-surface-2": "#271820",
  "--color-surface-3": "#2d1c25",
  "--color-surface-raised": "#33202b",
  "--color-surface-window": "#160d12",
  "--color-border": "#3d2733",
  "--color-border-subtle": "#36222d",
  "--color-border-hover": "#4a3040",
};

test("Plum Night surfaces use the approved ramp", () => {
  const { dark } = resolveTokens(css);
  for (const [token, value] of Object.entries(SURFACES)) assert.equal(dark[token], value, token);
});

test("Plum Night text roles meet 4.5:1 on every surface they sit on", async () => {
  const { contrastRatio } = await load();
  const { dark } = resolveTokens(css);
  const texts = ["--color-foreground", "--color-muted-foreground", "--color-link", "--color-locality-device", "--color-locality-network", "--color-locality-remote"];
  const surfaces = ["--color-background", "--color-card", "--color-surface-raised", "--color-surface-window"];
  for (const t of texts)
    for (const s of surfaces) {
      const ratio = contrastRatio(dark[t], dark[s]);
      assert.ok(ratio >= 4.5, `${t} on ${s} is ${ratio}:1`);
    }
  assert.ok(contrastRatio(dark["--color-cta-foreground"], dark["--color-cta"]) >= 4.5);
  assert.ok(contrastRatio(dark["--color-live-foreground"], dark["--color-live"]) >= 4.5);
});

test("magenta marks active navigation in Plum Night and clears 3:1", async () => {
  const { contrastRatio } = await load();
  const { dark } = resolveTokens(css);
  assert.equal(dark["--color-nav-marker"], "#e6007a");
  assert.ok(contrastRatio(dark["--color-nav-marker"], dark["--color-surface-window"]) >= 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/plumNight.test.js`
Expected: FAIL. `--color-background` is `"oklch(0.22 0.006 260)"`, not `"#1c1218"`.

- [ ] **Step 3: Implement**

Replace the `.dark { … }` block's colour, surface and border declarations, from `--color-background` through `--color-link` (lines 107–150), with the block below. Keep the shadow and premium-effect declarations that follow unchanged.

```css
  /* Plum Night — the brand guide's Deep Plum family (DESIGN.md "Colors").
     Hex, not oklch, so contrast tests can score every pair. */
  --color-background: #1c1218;
  --color-foreground: #f3e9ee;
  --color-card: #271820;
  --color-card-foreground: #f3e9ee;
  --color-popover: #2b1b24;
  --color-popover-foreground: #f3e9ee;
  --color-primary: #ff5a1f;
  --color-primary-foreground: #171717;
  --color-secondary: #2a1922;
  --color-secondary-foreground: #ecdfe6;
  --color-muted: #22161c;
  --color-muted-foreground: #b59aa8;
  --color-accent: #d90078;
  --color-accent-foreground: oklch(0.99 0 0);
  --color-destructive: oklch(0.62 0.22 25);
  --color-destructive-foreground: oklch(0.99 0 0);
  --color-border: #3d2733;
  --color-input: #170e13;
  --color-ring: #ff5a1f;
  --color-success: oklch(0.7 0.18 145);
  --color-success-foreground: oklch(0.99 0 0);
  --color-warning: oklch(0.75 0.15 70);
  --color-warning-foreground: oklch(0.15 0 0);
  --color-info: #ff8a68;
  --color-info-foreground: oklch(0.99 0 0);

  --color-cta: #f3e9ee;
  --color-cta-foreground: #1c1218;
  --color-live: #ff5a1f;
  --color-live-foreground: #171717;
  --color-nav-marker: #e6007a;
  --color-locality-device: #5ee0ad;
  --color-locality-network: #9bb4d6;
  --color-locality-remote: #fbbf6a;

  /* Surface hierarchy — plum depth system */
  --color-surface-0: #1c1218;
  --color-surface-1: #21151b;
  --color-surface-2: #271820;
  --color-surface-3: #2d1c25;
  --color-surface-raised: #33202b;
  --color-surface-window: #160d12;

  /* Border states */
  --color-border-subtle: #36222d;
  --color-border-hover: #4a3040;
  --color-border-active: #ff5a1f;
  --color-link: #ff9a7a;
```

Then update `DESIGN.md`:

- Frontmatter `colors:` gets these values:

  ```yaml
    night-charcoal: "#1C1218"
    night-card: "#271820"
    night-raised: "#33202B"
    night-border: "#3D2733"
    night-text: "#F3E9EE"
    night-secondary-text: "#B59AA8"
  ```

- Rename the dark-mode prose from "charcoal" to "Plum Night: the brand guide's Deep Plum family; magenta marks active navigation; orange still means live voice."

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/components/plumNight.test.js test/components/colorRoles.test.js`
Expected: PASS.

- [ ] **Step 5: Visual check in the desktop app**

Run: `npm run native:electron && npm run dev`. Then in Settings → Preferences, switch the theme to Dark. Confirm all of the following:
- the sidebar, Home cards and settings modal render on plum;
- the active nav marker is magenta;
- the default buttons are pale capsules with an orange dot;
- the mic and send circles are orange with dark glyphs.

Take a screenshot for the PR description.

- [ ] **Step 6: Commit**

```bash
git add src/index.css DESIGN.md test/components/plumNight.test.js
git commit -m "feat(ui): Plum Night dark theme with tested contrast"
```

---

### Task 5: Brand-correct pill glow, meeting card mark, on-brand hotkey ring

Covers VO-Q1, VO-Q2, VO-Q3 and SET-Q14.

**Files:**
- Modify: `src/styles/dictation-panel.css:304-327` (comment and `.processing-signal-glow` variables)
- Modify: `src/components/MeetingNotificationCard.tsx:64-72` (inline blue SVG)
- Modify: `src/components/ui/HotkeyInput.tsx:656`
- Modify: `DESIGN.md` `### Voice Pill`
- Test: `test/components/brandGlow.test.js`

**Interfaces:**
- Consumes the brand mark import pattern from `src/components/LoquiBrand.tsx:1` (`import mark from "../assets/brand/mark.png";`).

- [ ] **Step 1: Write the failing test**

Create `test/components/brandGlow.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const repoRoot = path.join(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");

test("dictation processing glow uses brand orange to magenta, agent keeps violet", () => {
  const css = read("src/styles/dictation-panel.css");
  const base = css.match(/\.processing-signal-glow\s*\{([^}]*)\}/)[1];
  assert.match(base, /--signal-bright:\s*#ff8a5c;/i);
  assert.match(base, /--signal-core:\s*#ff5a1f;/i);
  assert.match(base, /--signal-deep:\s*#d90078;/i);
  assert.match(base, /--signal-head:\s*#fff1ea;/i);
  assert.doesNotMatch(css, /#38bdf8|#2563eb|#6366f1/i);
  const agent = css.match(/\.processing-signal-glow\[data-agent="true"\]\s*\{([^}]*)\}/)[1];
  assert.match(agent, /--signal-core:\s*#8787ff;/i);
});

test("meeting notification shows the Loqui mark, not the legacy blue glyph", async () => {
  const source = read("src/components/MeetingNotificationCard.tsx");
  assert.doesNotMatch(source, /#2056DF/i);
  assert.match(source, /assets\/brand\/mark\.png/);
  const { MeetingNotificationCard } = await import("../../src/components/MeetingNotificationCard.tsx");
  const html = renderStatic(MeetingNotificationCard, { title: "Standup", body: "Zoom is using your mic", startLabel: "Take notes" });
  assert.match(html, /<img[^>]+alt=""[^>]*>/);
});

test("hotkey capture focus ring is on-brand", () => {
  const source = read("src/components/ui/HotkeyInput.tsx");
  assert.doesNotMatch(source, /ring-blue-500/);
  assert.match(source, /focus-visible:ring-ring\/40/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/brandGlow.test.js`
Expected: FAIL. `--signal-bright` is `#38bdf8`.

- [ ] **Step 3: Implement**

1. In `src/styles/dictation-panel.css`:

   - Replace the `.processing-signal-glow` variable lines:

     ```css
     .processing-signal-glow {
       --signal-bright: #ff8a5c;
       --signal-core: #ff5a1f;
       --signal-deep: #d90078;
       --signal-head: #fff1ea;
     ```

     Keep the remaining declarations of that rule unchanged.

   - The comment above it (lines 304–306) becomes:

     ```css
     /* The Signal glow: a comet orbiting a breathing ambient halo around the
        pill. Dictation thinking glows brand orange into magenta (the logo's
        gradient); Agent Mode keeps its violet identity. */
     ```

2. In `src/components/MeetingNotificationCard.tsx`, add `import mark from "../assets/brand/mark.png";` to the imports. Replace the `<svg viewBox="0 0 1024 1024" …>…</svg>` element (lines 65–71) with:

   ```tsx
             <img src={mark} alt="" className="w-4.5 h-4.5" draggable={false} />
   ```

3. In `src/components/ui/HotkeyInput.tsx:656`, replace `focus-visible:ring-blue-500/20` with `focus-visible:ring-ring/40`.

4. In `DESIGN.md` `### Voice Pill`, append: "Dictation thinking glows in the logo gradient (#FF8A5C → #FF5A1F → #D90078); Agent Mode thinking glows violet (#8787FF). Blue is not a Loqui state colour."

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/components/brandGlow.test.js test/helpers/voicePillStructure.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/styles/dictation-panel.css src/components/MeetingNotificationCard.tsx src/components/ui/HotkeyInput.tsx DESIGN.md test/components/brandGlow.test.js
git commit -m "fix(ui): brand-correct processing glow, meeting mark and hotkey ring"
```

---

### Task 6: Locality model

Covers FND-R4 B, the logic half.

**Files:**
- Create: `src/lib/locality.ts`
- Test: `test/lib/locality.test.js`

**Interfaces:**
- Consumes `InferenceMode` from `src/types/electron.ts:18` (`"openwhispr" | "providers" | "local" | "self-hosted" | "enterprise"`).
- Produces (used by Plan 03 route graph, Plan 04 pill, Plan 06 chat chip):

  ```ts
  export type Locality = "device" | "network" | "remote";
  export interface RouteLocality { locality: Locality; provider: string | null }
  export function providerDisplayName(providerId: string | null | undefined): string;
  export function providerMonogram(displayName: string): string;
  export function isLoopbackUrl(url: string | null | undefined): boolean;
  export function resolveLocality(input: { mode: InferenceMode | string | null | undefined; provider?: string | null; remoteUrl?: string | null }): RouteLocality;
  ```

- [ ] **Step 1: Write the failing test**

Create `test/lib/locality.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/locality.ts");

test("local mode stays on the device", async () => {
  const { resolveLocality } = await load();
  assert.deepEqual(resolveLocality({ mode: "local", provider: "qwen" }), { locality: "device", provider: null });
});

test("self-hosted on loopback is the device; elsewhere it is your network", async () => {
  const { resolveLocality } = await load();
  for (const url of ["http://localhost:11434/v1", "http://127.0.0.1:8080", "http://[::1]:8080/v1", "http://llm.localhost/v1"]) {
    assert.equal(resolveLocality({ mode: "self-hosted", remoteUrl: url }).locality, "device", url);
  }
  for (const url of ["http://192.168.1.20:11434/v1", "https://gpu-box.lan/v1", "", null, "not a url"]) {
    assert.equal(resolveLocality({ mode: "self-hosted", remoteUrl: url }).locality, "network", String(url));
  }
});

test("provider modes are remote and name the receiver", async () => {
  const { resolveLocality } = await load();
  assert.deepEqual(resolveLocality({ mode: "providers", provider: "openai" }), { locality: "remote", provider: "OpenAI" });
  assert.deepEqual(resolveLocality({ mode: "providers", provider: "codex" }), { locality: "remote", provider: "ChatGPT (Codex)" });
  assert.deepEqual(resolveLocality({ mode: "enterprise", provider: "bedrock" }), { locality: "remote", provider: "AWS Bedrock" });
});

test("unknown or missing modes fail toward disclosure", async () => {
  const { resolveLocality } = await load();
  assert.deepEqual(resolveLocality({ mode: undefined, provider: undefined }), { locality: "remote", provider: "Unknown provider" });
  assert.deepEqual(resolveLocality({ mode: "providers", provider: "my-new-llm" }), { locality: "remote", provider: "My New Llm" });
});

test("monograms are two letters and ignore punctuation", async () => {
  const { providerMonogram } = await load();
  assert.equal(providerMonogram("OpenAI"), "Op");
  assert.equal(providerMonogram("AWS Bedrock"), "AB");
  assert.equal(providerMonogram("ChatGPT (Codex)"), "CC");
  assert.equal(providerMonogram(""), "?");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/lib/locality.test.js`
Expected: FAIL with `Cannot find module '../../src/lib/locality.ts'`.

- [ ] **Step 3: Implement**

Create `src/lib/locality.ts`:

```ts
import type { InferenceMode } from "../types/electron";

// Where a route's data goes. Shape (solid/dotted/dashed ring) carries this
// first; see DESIGN.md "Motion" and "Roles". Anything unrecognised resolves
// to "remote" so the UI over-discloses rather than under-discloses.
export type Locality = "device" | "network" | "remote";

export interface RouteLocality {
  locality: Locality;
  provider: string | null;
}

const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  vertex: "Google Vertex AI",
  groq: "Groq",
  mistral: "Mistral",
  xai: "xAI",
  openrouter: "OpenRouter",
  bedrock: "AWS Bedrock",
  azure: "Azure OpenAI",
  codex: "ChatGPT (Codex)",
  tinfoil: "Tinfoil",
  deepgram: "Deepgram",
  assemblyai: "AssemblyAI",
  custom: "Custom endpoint",
};

export function providerDisplayName(providerId: string | null | undefined): string {
  const id = (providerId ?? "").trim();
  if (!id) return "Unknown provider";
  const known = PROVIDER_NAMES[id.toLowerCase()];
  if (known) return known;
  return id
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function providerMonogram(displayName: string): string {
  const words = displayName.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].charAt(0).toUpperCase() + words[0].charAt(1);
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

export function resolveLocality(input: {
  mode: InferenceMode | string | null | undefined;
  provider?: string | null;
  remoteUrl?: string | null;
}): RouteLocality {
  if (input.mode === "local") return { locality: "device", provider: null };
  if (input.mode === "self-hosted") {
    return isLoopbackUrl(input.remoteUrl)
      ? { locality: "device", provider: null }
      : { locality: "network", provider: null };
  }
  return { locality: "remote", provider: providerDisplayName(input.provider) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/lib/locality.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/locality.ts test/lib/locality.test.js
git commit -m "feat(ui): locality model for device, network and remote routes"
```

---

### Task 7: LocalityRing primitive and locale strings

Covers FND-R4 B, the visual half.

**Files:**
- Create: `src/components/ui/LocalityRing.tsx`
- Modify: `src/index.css` (append the `.locality-ring` rules after the reduced-motion block)
- Modify: `src/locales/{ar,de,en,es,fr,it,ja,pt,ru,zh-CN,zh-TW}/translation.json`. Add a top-level `"locality"` object.
- Test: `test/components/localityRing.test.js`

**Interfaces:**
- Consumes `Locality` and `providerMonogram` from Task 6.
- Produces:

  ```tsx
  export interface LocalityRingProps {
    locality: Locality;
    label: string;            // translated, e.g. t("locality.remote", { provider })
    provider?: string | null; // display name; shown as a monogram badge when remote
    active?: boolean;         // a request is in flight; the remote orbit rotates
    size?: number;            // px, default 24
    className?: string;
    children?: React.ReactNode; // the mode glyph (mark, sparkle) drawn inside
  }
  export function LocalityRing(props: LocalityRingProps): JSX.Element;
  ```

  Plus the i18n keys `locality.device`, `locality.network` and `locality.remote` (with a `{{provider}}` placeholder).

- [ ] **Step 1: Write the failing test**

Create `test/components/localityRing.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const repoRoot = path.join(__dirname, "../..");
const load = () => import("../../src/components/ui/LocalityRing.tsx");

test("ring exposes locality, label and activity to CSS and assistive tech", async () => {
  const { LocalityRing } = await load();
  const html = renderStatic(LocalityRing, { locality: "remote", label: "Sent to OpenAI", provider: "OpenAI", active: true });
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="Sent to OpenAI"/);
  assert.match(html, /data-locality="remote"/);
  assert.match(html, /data-active="true"/);
  assert.match(html, /class="locality-ring__badge"[^>]*>Op</);
});

test("device and network rings never show a provider badge", async () => {
  const { LocalityRing } = await load();
  for (const locality of ["device", "network"]) {
    const html = renderStatic(LocalityRing, { locality, label: "x", provider: "OpenAI" });
    assert.doesNotMatch(html, /locality-ring__badge/, locality);
    assert.match(html, /data-active="false"/);
  }
});

test("shape carries locality; orbit only runs while active and never under reduced motion", () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  assert.match(css, /\.locality-ring\[data-locality="network"\] \.locality-ring__svg circle\s*\{[^}]*stroke-dasharray:\s*0\.5 3\.5/);
  assert.match(css, /\.locality-ring\[data-locality="remote"\] \.locality-ring__svg circle\s*\{[^}]*stroke-dasharray:\s*4 3/);
  assert.match(css, /\.locality-ring\[data-locality="remote"\]\[data-active="true"\] \.locality-ring__svg\s*\{[^}]*animation:\s*locality-orbit 6s linear infinite/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.locality-ring__svg\s*\{\s*animation:\s*none !important;/);
  assert.match(css, /\.locality-ring__badge\s*\{[^}]*inset-inline-end:/);
});

test("every locale names all three localities", () => {
  const dir = path.join(repoRoot, "src/locales");
  for (const lang of fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "translation.json")))) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, lang, "translation.json"), "utf8"));
    assert.ok(json.locality, `${lang} has locality`);
    for (const key of ["device", "network", "remote"]) assert.ok(json.locality[key], `${lang}.locality.${key}`);
    assert.match(json.locality.remote, /\{\{provider\}\}/, `${lang} remote keeps the placeholder`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/localityRing.test.js`
Expected: FAIL with `Cannot find module '../../src/components/ui/LocalityRing.tsx'`.

- [ ] **Step 3: Implement**

1. Create `src/components/ui/LocalityRing.tsx`:

   ```tsx
   import type { ReactNode } from "react";
   import { cn } from "../lib/utils";
   import { providerMonogram, type Locality } from "../../lib/locality";

   export interface LocalityRingProps {
     locality: Locality;
     label: string;
     provider?: string | null;
     active?: boolean;
     size?: number;
     className?: string;
     children?: ReactNode;
   }

   // Solid ring: stays on this device. Dotted: your own server. Dashed orbit
   // plus a monogram: sent to a provider. The orbit turns only while a request
   // is in flight (data-active) and never under reduced motion.
   export function LocalityRing({
     locality,
     label,
     provider,
     active = false,
     size = 24,
     className,
     children,
   }: LocalityRingProps) {
     return (
       <span
         role="img"
         aria-label={label}
         data-locality={locality}
         data-active={active ? "true" : "false"}
         className={cn("locality-ring", className)}
         style={{ width: size, height: size }}
       >
         <svg className="locality-ring__svg" viewBox="0 0 24 24" aria-hidden="true">
           <circle cx="12" cy="12" r="10.75" />
         </svg>
         {children ? <span className="locality-ring__content">{children}</span> : null}
         {locality === "remote" && provider ? (
           <span className="locality-ring__badge" aria-hidden="true">
             {providerMonogram(provider)}
           </span>
         ) : null}
       </span>
     );
   }
   ```

   Check the import path for `cn`. `src/components/ui/button.tsx` imports `{ cn } from "../lib/utils"`, so the same relative path is correct for files in `src/components/ui/`.

2. Append to `src/index.css`:

   ```css
   /* Locality ring (DESIGN.md "Roles"): shape first, hue second. */
   .locality-ring {
     position: relative;
     display: inline-grid;
     place-items: center;
     flex: none;
     color: var(--color-locality-device);
   }
   .locality-ring[data-locality="network"] {
     color: var(--color-locality-network);
   }
   .locality-ring[data-locality="remote"] {
     color: var(--color-locality-remote);
   }
   .locality-ring__svg {
     position: absolute;
     inset: 0;
     width: 100%;
     height: 100%;
     overflow: visible;
   }
   .locality-ring__svg circle {
     fill: none;
     stroke: currentColor;
     stroke-width: 2;
   }
   .locality-ring[data-locality="network"] .locality-ring__svg circle {
     stroke-dasharray: 0.5 3.5;
     stroke-linecap: round;
     stroke-width: 2.25;
   }
   .locality-ring[data-locality="remote"] .locality-ring__svg circle {
     stroke-dasharray: 4 3;
   }
   .locality-ring[data-locality="remote"][data-active="true"] .locality-ring__svg {
     animation: locality-orbit 6s linear infinite;
   }
   .locality-ring__content {
     position: relative;
     display: grid;
     place-items: center;
     width: 70%;
     height: 70%;
   }
   .locality-ring__badge {
     position: absolute;
     inset-inline-end: -5px;
     bottom: -4px;
     min-width: 15px;
     height: 15px;
     padding: 0 3px;
     border-radius: 9999px;
     background: var(--color-background);
     border: 1.5px solid currentColor;
     font: 700 8px/12px var(--font-family-sans);
     text-align: center;
   }
   @keyframes locality-orbit {
     to {
       transform: rotate(360deg);
     }
   }
   @media (prefers-reduced-motion: reduce) {
     .locality-ring__svg {
       animation: none !important;
     }
   }
   ```

3. Add the `locality` object to each locale with this one-off script. It preserves key order, appends `locality` at the end, and keeps 2-space JSON:

   ```bash
   node -e '
   const fs=require("fs"),p=require("path");
   const t={
    en:["On this device","On your server","Sent to {{provider}}"],
    de:["Auf diesem Gerät","Auf Ihrem Server","An {{provider}} gesendet"],
    es:["En este dispositivo","En tu servidor","Enviado a {{provider}}"],
    fr:["Sur cet appareil","Sur votre serveur","Envoyé à {{provider}}"],
    it:["Su questo dispositivo","Sul tuo server","Inviato a {{provider}}"],
    pt:["Neste dispositivo","No seu servidor","Enviado para {{provider}}"],
    ru:["На этом устройстве","На вашем сервере","Отправлено в {{provider}}"],
    ja:["このデバイス上","あなたのサーバー上","{{provider}} に送信"],
    "zh-CN":["在此设备上","在你的服务器上","发送至 {{provider}}"],
    "zh-TW":["在此裝置上","在你的伺服器上","傳送至 {{provider}}"],
    ar:["على هذا الجهاز","على خادمك","يُرسل إلى {{provider}}"]};
   for(const [l,[d,n,r]] of Object.entries(t)){const f=p.join("src/locales",l,"translation.json");const j=JSON.parse(fs.readFileSync(f,"utf8"));j.locality={device:d,network:n,remote:r};fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");}'
   ```

   Then run `npx prettier --check "src/locales/**/translation.json"`. If it reports differences, run `npx prettier --write` on the same glob so the diff is only the new keys.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/components/localityRing.test.js && npm run i18n:check`
Expected: PASS, and i18n check OK.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/LocalityRing.tsx src/index.css src/locales test/components/localityRing.test.js
git commit -m "feat(ui): LocalityRing primitive with solid, dotted and dashed shapes"
```

---

### Task 8: LevelBars, the logo-shaped meter

Covers FND-R5 B.

**Files:**
- Create: `src/components/ui/levelBarsMath.ts`
- Create: `src/components/ui/LevelBars.tsx`
- Test: `test/components/levelBars.test.js`

**Interfaces:**
- Produces (Plans 04 and 05 replace the four existing waveforms with this):

  ```ts
  export const LOGO_BAR_SHAPE: readonly [0.42, 0.7, 1, 0.7, 0.42];
  export const LEVEL_BARS_SAMPLE_MS = 33;          // ~30 Hz
  export const LEVEL_BARS_REDUCED_SAMPLE_MS = 100; // 10 Hz under reduced motion
  export function levelBarScale(index: number, level: number, phase: number): number; // 0..1, 3 decimals
  export function barPhase(index: number, timeMs: number): number;                     // 0..1
  export function smoothToward(previous: number, target: number, factor: number): number;
  ```

  ```tsx
  export interface LevelBarsProps {
    readLevel: () => number;   // RMS-ish level; normalised against a decaying peak
    height?: number;           // px, default 20 (pill); onboarding hero uses 64
    className?: string;
  }
  export function LevelBars(props: LevelBarsProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `test/components/levelBars.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const loadMath = () => import("../../src/components/ui/levelBarsMath.ts");
const loadComponent = () => import("../../src/components/ui/LevelBars.tsx");

test("silence settles into the logo silhouette", async () => {
  const { levelBarScale, LOGO_BAR_SHAPE } = await loadMath();
  assert.deepEqual([...LOGO_BAR_SHAPE], [0.42, 0.7, 1, 0.7, 0.42]);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => levelBarScale(i, 0, 0.5)), [0.231, 0.385, 0.55, 0.385, 0.231]);
});

test("speech grows bars within the silhouette and never exceeds 1", async () => {
  const { levelBarScale } = await loadMath();
  assert.equal(levelBarScale(2, 1, 1), 1);
  assert.equal(levelBarScale(2, 0.5, 0), 0.637);
  assert.equal(levelBarScale(1, 0.5, 0.5), 0.541);
  assert.ok(levelBarScale(0, 5, 1) <= 0.42);
});

test("garbage levels from a dead analyser render the resting silhouette", async () => {
  const { levelBarScale } = await loadMath();
  for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY, undefined]) {
    assert.equal(levelBarScale(2, bad, 0.5), 0.55, String(bad));
  }
  assert.equal(levelBarScale(9, 0.8, 0.5), 0);
});

test("phase is periodic in 0..1 and smoothing moves part of the way", async () => {
  const { barPhase, smoothToward } = await loadMath();
  for (const t of [0, 123, 9999]) {
    const p = barPhase(3, t);
    assert.ok(p >= 0 && p <= 1);
  }
  assert.equal(smoothToward(0, 1, 0.3), 0.3);
  assert.equal(smoothToward(0.5, 0.5, 0.3), 0.5);
});

test("component renders five gradient bars at rest, hidden from assistive tech", async () => {
  const { LevelBars } = await loadComponent();
  const html = renderStatic(LevelBars, { readLevel: () => 0, height: 20 });
  assert.match(html, /aria-hidden="true"/);
  assert.equal(html.split('data-level-bar=""').length - 1, 5);
  for (const s of ["0.231", "0.385", "0.55"]) assert.ok(html.includes(`scaleY(${s})`), s);
  assert.ok(html.includes("linear-gradient(180deg, #ff6a36, #e6007a)"));
});

test("reduced motion samples at 10 Hz", async () => {
  const { LEVEL_BARS_SAMPLE_MS, LEVEL_BARS_REDUCED_SAMPLE_MS } = await loadMath();
  assert.equal(LEVEL_BARS_SAMPLE_MS, 33);
  assert.equal(LEVEL_BARS_REDUCED_SAMPLE_MS, 100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/levelBars.test.js`
Expected: FAIL with `Cannot find module '../../src/components/ui/levelBarsMath.ts'`.

- [ ] **Step 3: Implement**

Create `src/components/ui/levelBarsMath.ts`:

```ts
// The five bars of the Loqui mark, as height ratios. At rest the meter *is*
// the logo; speech grows each bar inside its own silhouette (DESIGN.md).
export const LOGO_BAR_SHAPE = [0.42, 0.7, 1, 0.7, 0.42] as const;
export const LEVEL_BARS_SAMPLE_MS = 33;
export const LEVEL_BARS_REDUCED_SAMPLE_MS = 100;

const IDLE_LEVEL = 0.12;
const REST_FACTOR = 0.55;
const LEVEL_GAIN = 1.6;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function levelBarScale(index: number, level: number, phase: number): number {
  const shape = LOGO_BAR_SHAPE[index as 0 | 1 | 2 | 3 | 4] ?? 0;
  const safeLevel = Number.isFinite(level) ? clamp01(level) : 0;
  if (safeLevel < IDLE_LEVEL) return round3(shape * REST_FACTOR);
  const gain = REST_FACTOR + (1 - REST_FACTOR) * Math.min(1, safeLevel * LEVEL_GAIN);
  const safePhase = Number.isFinite(phase) ? clamp01(phase) : 0.5;
  return round3(shape * gain * (0.7 + 0.3 * safePhase));
}

export function barPhase(index: number, timeMs: number): number {
  return (Math.sin(timeMs / 160 + index * 1.3) + 1) / 2;
}

export function smoothToward(previous: number, target: number, factor: number): number {
  return round3(previous + (target - previous) * factor);
}
```

Create `src/components/ui/LevelBars.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";
import {
  LEVEL_BARS_REDUCED_SAMPLE_MS,
  LEVEL_BARS_SAMPLE_MS,
  LOGO_BAR_SHAPE,
  barPhase,
  levelBarScale,
  smoothToward,
} from "./levelBarsMath";

// Normalise against a decaying session peak so any mic gain fills the range
// (same approach as LiveWaveform).
const PEAK_FLOOR = 0.01;
const PEAK_DECAY = 0.99;
const SMOOTHING = 0.3;
const BAR_GRADIENT = "linear-gradient(180deg, #ff6a36, #e6007a)";

export interface LevelBarsProps {
  readLevel: () => number;
  height?: number;
  className?: string;
}

export function LevelBars({ readLevel, height = 20, className }: LevelBarsProps) {
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const peakRef = useRef(PEAK_FLOOR);
  const scalesRef = useRef<number[]>(LOGO_BAR_SHAPE.map((_, i) => levelBarScale(i, 0, 0.5)));
  const barWidth = Math.max(2, Math.round(height * 0.18));

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const id = setInterval(
      () => {
        const raw = readLevel();
        const level = Number.isFinite(raw) ? Math.max(0, raw) : 0;
        peakRef.current = Math.max(level, peakRef.current * PEAK_DECAY, PEAK_FLOOR);
        const norm = level / peakRef.current;
        const now = performance.now();
        LOGO_BAR_SHAPE.forEach((_, i) => {
          const target = levelBarScale(i, norm, barPhase(i, now));
          const next = reduce ? target : smoothToward(scalesRef.current[i], target, SMOOTHING);
          scalesRef.current[i] = next;
          const bar = barRefs.current[i];
          if (bar) bar.style.transform = `scaleY(${next})`;
        });
      },
      reduce ? LEVEL_BARS_REDUCED_SAMPLE_MS : LEVEL_BARS_SAMPLE_MS
    );
    return () => clearInterval(id);
  }, [readLevel]);

  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex items-center", className)}
      style={{ height, gap: Math.round(barWidth * 0.8) }}
    >
      {LOGO_BAR_SHAPE.map((_, i) => (
        <span
          key={i}
          data-level-bar=""
          ref={(el) => {
            barRefs.current[i] = el;
          }}
          className="block rounded-full"
          style={{
            width: barWidth,
            height,
            background: BAR_GRADIENT,
            transform: `scaleY(${scalesRef.current[i]})`,
          }}
        />
      ))}
    </span>
  );
}
```

Transforms are written straight to elements, with no React render per tick. That matches the existing `LiveWaveform` performance contract.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/components/levelBars.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/levelBarsMath.ts src/components/ui/LevelBars.tsx test/components/levelBars.test.js
git commit -m "feat(ui): LevelBars meter shaped like the Loqui mark"
```

---

### Task 9: Whole-plan verification

**Files:** none new. This task runs every check and fixes what they surface.

- [ ] **Step 1: Run the full suite and static checks**

```bash
npm run native:node
npm test
npm run lint
npm run typecheck
npm run i18n:check
npm run format:check
```

Expected: everything passes. A failing pre-existing test that asserts an old colour must be updated in this branch only when the old value is exactly what this plan intentionally changed: `#38bdf8`, white text on brand glass, `text-primary` on links, charcoal oklch dark tokens, or the global `*` transition. In that case, note it in the PR description. Any other failure is a regression; fix the code.

- [ ] **Step 2: Visual verification in the desktop app (light and Plum Night)**

```bash
npm run native:electron
npm run dev
```

Check each of these and screenshot each for the PR:
- Home: the default buttons are ink capsules with an orange dot, and the sidebar marker is orange in light and magenta in dark.
- Onboarding: the footer primary still reads clearly. Onboarding adopts the new roles fully in Plan 05; here, only confirm nothing regressed to white-on-orange.
- Dictate with the hotkey, then watch the pill while it processes: the glow is orange into magenta, not blue.
- With Agent Mode on, the processing glow is still violet.
- Meeting notification (if FaceTime or Zoom is open): the card shows the Loqui mark.
- Settings → Hotkeys: the focus ring is orange.
- Toggle the theme back and forth: no smeared transition across the whole page, and hovering buttons still eases colour.

- [ ] **Step 3: Commit any fixes, then open the PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(ui): Loqui foundations — motion, colour roles, Plum Night, locality, LevelBars" --body-file pr-body.md
```

`pr-body.md` lists one line per Task 1–8 commit, links `docs/superpowers/specs/2026-10-15-loqui-uiux-overhaul.md` and this plan, embeds the Step 2 screenshots, and names any pre-existing test assertions that were intentionally updated (Step 1).

Get the owner's explicit OK before pushing; publishing a PR is outward-facing.
