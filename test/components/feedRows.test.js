const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { React, renderStatic } = require("../helpers/harness/reactSsr");

async function load() {
  if (!i18next.isInitialized) {
    const en = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8")
    );
    await i18next.use(initReactI18next).init({
      lng: "en",
      resources: { en: { translation: en } },
      interpolation: { escapeValue: false },
    });
  }
  return import("../../src/components/home/FeedRows.tsx");
}
const tx = (id, ms) => ({
  id,
  text: `t${id}`,
  timestamp: "2026-10-14 14:02:00",
  audio_duration_ms: ms,
  status: "completed",
});

test("a session names its size and length and expands in place", async () => {
  const { SessionRow } = await load();
  const entry = {
    kind: "session",
    key: "session-4",
    at: Date.UTC(2026, 9, 14, 14, 9),
    items: [tx(4, 30000), tx(3, 20000), tx(2, 12000), tx(1, 10000)],
    words: 40,
    durationMs: 72000,
  };
  const collapsed = renderStatic(
    SessionRow,
    { entry, expanded: false, onToggle: () => {} },
    React.createElement("i", null, "child")
  );
  assert.match(collapsed, /Session · 4 captures · 1:12/);
  assert.match(collapsed, /aria-expanded="false"/);
  assert.doesNotMatch(collapsed, /child/);
  const open = renderStatic(
    SessionRow,
    { entry, expanded: true, onToggle: () => {} },
    React.createElement("i", null, "child")
  );
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /child/);
});

test("meetings and notes say what they are, not by colour", async () => {
  const { NoteFeedRow } = await load();
  const meeting = renderStatic(NoteFeedRow, {
    entry: {
      kind: "meeting",
      key: "meeting-7",
      at: 0,
      note: { id: 7, title: "Design sync", content: "" },
    },
    onOpen: () => {},
  });
  assert.match(meeting, /Meeting/);
  assert.match(meeting, /Design sync/);
  const untitled = renderStatic(NoteFeedRow, {
    entry: { kind: "note", key: "note-8", at: 0, note: { id: 8, title: "", content: "" } },
    onOpen: () => {},
  });
  assert.match(untitled, /Untitled/);
});

test("clock times are not zero-padded", async () => {
  const { formatClockTime } = await load();
  assert.equal(formatClockTime(new Date(2026, 9, 14, 7, 51).getTime(), "en-US"), "7:51 AM");
  assert.doesNotMatch(formatClockTime(new Date(2026, 9, 14, 7, 51).getTime(), "en-US"), /^0/);
});

// Full-app M5: an unknown session length is left out, never shown as 0:00.
test("a session with an unknown length names its size only", async () => {
  const { SessionRow } = await load();
  const entry = {
    kind: "session",
    key: "session-2",
    at: Date.UTC(2026, 9, 14, 14, 9),
    items: [tx(2, null), tx(1, null)],
    words: 4,
    durationMs: null,
  };
  const html = renderStatic(SessionRow, { entry, expanded: false, onToggle: () => {} });
  assert.match(html, />Session · 2 captures</);
  assert.doesNotMatch(html, /0:00|·\s*</);
  const zero = renderStatic(SessionRow, {
    entry: { ...entry, durationMs: 0 },
    expanded: false,
    onToggle: () => {},
  });
  assert.match(zero, /Session · 2 captures · 0:00/, "a real zero is still shown");
});
