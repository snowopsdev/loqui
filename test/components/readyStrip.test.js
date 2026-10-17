const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { renderStatic } = require("../helpers/harness/reactSsr");

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
  return import("../../src/components/home/ReadyStrip.tsx");
}
const st = (kind, over = {}) => ({
  kind,
  source: null,
  startedAt: null,
  offlineReason: null,
  ...over,
});
const base = {
  now: 10_000,
  hotkeyLabel: "Fn",
  holdToTalk: true,
  next: { title: "Product catch-up", start: { kind: "minutes", minutes: 12 } },
  onTakeNotes: () => {},
};

test("Ready says how to start, in words and with the key", async () => {
  const { ReadyStrip } = await load();
  const hold = renderStatic(ReadyStrip, { ...base, status: st("ready") });
  assert.match(hold, /data-state="ready"/);
  assert.match(hold, />Ready</);
  assert.match(hold, /Hold <kbd[^>]*>Fn<\/kbd> to dictate/);
  const press = renderStatic(ReadyStrip, { ...base, holdToTalk: false, status: st("ready") });
  assert.match(press, /Press <kbd[^>]*>Fn<\/kbd> to dictate/);
});

test("the next meeting lives in the strip only while the calendar column is hidden", async () => {
  const { ReadyStrip } = await load();
  const html = renderStatic(ReadyStrip, { ...base, status: st("ready") });
  assert.match(
    html,
    /class="[^"]*@min-\[960px\]:hidden[^"]*"[^>]*>[\s\S]*Product catch-up in 12 min/
  );
  assert.match(html, />Take notes</);
});

test("Listening and Cleaning up are named, with live orange only while listening", async () => {
  const { ReadyStrip } = await load();
  const listening = renderStatic(ReadyStrip, {
    ...base,
    status: st("listening", { startedAt: 3_000 }),
  });
  assert.match(listening, /Listening 0:07/);
  assert.match(listening, /border-live/);
  const cleaning = renderStatic(ReadyStrip, { ...base, status: st("processing") });
  assert.match(cleaning, /Cleaning up…/);
  assert.doesNotMatch(cleaning, /border-live/);
});

test("no next meeting, no meeting chip", async () => {
  const { ReadyStrip } = await load();
  const html = renderStatic(ReadyStrip, { ...base, next: null, status: st("ready") });
  assert.doesNotMatch(html, /Take notes/);
});

test("offline stays static and Take notes has the full shared focus ring", async () => {
  const { ReadyStrip } = await load();
  const html = renderStatic(ReadyStrip, { ...base, status: st("offline") });
  assert.match(html, /Mic offline/);
  assert.match(html, /focus-visible:ring-2 focus-visible:ring-ring/);
  assert.doesNotMatch(html, /animate-|border-live/);
});

test("shared glyphs use accessible ink on the strip's light tints", async () => {
  const { ReadyStrip } = await load();
  assert.match(
    renderStatic(ReadyStrip, { ...base, status: st("listening") }),
    /bg-link dark:bg-live/
  );
  for (const kind of ["processing", "offline"]) {
    assert.match(
      renderStatic(ReadyStrip, { ...base, status: st(kind) }),
      /text-warning-foreground dark:text-warning/
    );
  }
});
