const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (file) => fs.readFileSync(path.join(__dirname, "../..", file), "utf8");
const tokens = (body) =>
  Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[\da-f]{6});/gi)].map((m) => [m[1], m[2]]));

test("pill labels and semantic edges retain contrast in light and Plum Night, including blocked opacity", async () => {
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const css = read("src/index.css");
  const pill = read("src/styles/dictation-panel.css");
  const light = tokens(css.slice(css.indexOf("@theme {"), css.indexOf(":root {")));
  const dark = {
    ...light,
    ...tokens(css.slice(css.indexOf(".dark {"), css.indexOf("\n}", css.indexOf(".dark {")))),
  };
  const blocked = Number(
    pill.match(/\.locality-ring--blocked\s*\{[^}]*opacity:\s*([\d.]+)/)?.[1] ?? 1
  );
  const composite = (fg, bg, opacity) =>
    "#" +
    [1, 3, 5]
      .map((i) =>
        Math.round(
          parseInt(fg.slice(i, i + 2), 16) * opacity +
            parseInt(bg.slice(i, i + 2), 16) * (1 - opacity)
        )
          .toString(16)
          .padStart(2, "0")
      )
      .join("");
  for (const [theme, t] of [
    ["light", light],
    ["Plum Night", dark],
  ]) {
    for (const [role, surface] of [
      ["--color-foreground", "--color-surface-1"],
      ["--color-muted-foreground", "--color-surface-1"],
      ["--color-popover-foreground", "--color-popover"],
    ]) {
      assert.ok(contrastRatio(t[role], t[surface]) >= 4.5, `${theme} ${role} text`);
    }
    for (const role of [
      "--color-success",
      "--color-destructive",
      "--color-ring",
      "--color-locality-device",
      "--color-locality-network",
      "--color-locality-remote",
    ]) {
      assert.ok(
        contrastRatio(t[role], t["--color-surface-1"]) >= 3,
        `${theme} ${role} semantic mark`
      );
    }
    const rest = composite(t["--color-foreground"], t["--color-surface-1"], 0.6);
    assert.ok(contrastRatio(rest, t["--color-surface-1"]) >= 3, `${theme} resting bar composite`);
    for (const role of ["--color-locality-network", "--color-locality-remote"]) {
      const fg = composite(t[role], t["--color-surface-1"], blocked);
      assert.ok(
        contrastRatio(fg, t["--color-surface-1"]) >= 3,
        `${theme} composited blocked ${role}: ${contrastRatio(fg, t["--color-surface-1"])}`
      );
    }
  }
  assert.match(
    pill,
    /\.voice-pill-levels \[data-level-bar\]\s*\{[^}]*outline:\s*1px solid var\(--color-ring\)/
  );
  assert.match(
    read("src/components/dictation/VoicePill.tsx"),
    /data-level-bar-rest=""[\s\S]*?opacity-60/
  );
  assert.match(
    pill,
    /\.voice-pill-control\[data-pill-state="recording"\]\s*\{[^}]*border-color:\s*var\(--color-ring\)/
  );
  assert.match(pill, /\.pill-countdown\s*\{[^}]*background:\s*var\(--color-ring\)/);
});
