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
  const { MeetingNotificationCard } =
    await import("../../src/components/MeetingNotificationCard.tsx");
  const html = renderStatic(MeetingNotificationCard, {
    title: "Standup",
    body: "Zoom is using your mic",
    startLabel: "Take notes",
  });
  assert.match(html, /<img[^>]+alt=""[^>]*>/);
});

test("hotkey capture focus ring is on-brand", () => {
  const source = read("src/components/ui/HotkeyInput.tsx");
  assert.doesNotMatch(source, /ring-blue-500/);
  assert.match(source, /focus-visible:ring-ring(?!\/)/);
});
