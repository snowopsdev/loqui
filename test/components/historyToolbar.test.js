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
  return import("../../src/components/home/HistoryToolbar.tsx");
}
const props = (over = {}) => ({
  query: "",
  onQueryChange: () => {},
  filter: "all",
  onFilterChange: () => {},
  counts: { all: 7, dictations: 5, meetings: 1, notes: 1, failed: 1 },
  inputRef: React.createRef(),
  menu: null,
  ...over,
});

test("the filter field is labelled and hints its / shortcut", async () => {
  const { HistoryToolbar } = await load();
  const html = renderStatic(HistoryToolbar, props());
  assert.match(html, /aria-label="Filter history"/);
  assert.match(html, /placeholder="Filter this list"/);
  assert.match(html, /<kbd[^>]*>\/<\/kbd>/);
});

test("chips are toggle buttons; the selected one is pressed and ink-filled", async () => {
  const { HistoryToolbar } = await load();
  const html = renderStatic(HistoryToolbar, props({ filter: "meetings" }));
  for (const label of ["All", "Dictations", "Meetings", "Notes", "Failed"])
    assert.match(html, new RegExp(`>${label}<`));
  assert.match(
    html,
    /aria-pressed="true"[^>]*class="[^"]*bg-foreground text-background[^"]*"[^>]*>Meetings/
  );
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
});

test("the Failed chip shows its count only when there is something to retry", async () => {
  const { HistoryToolbar } = await load();
  assert.match(renderStatic(HistoryToolbar, props()), /data-failed-count="1"/);
  const none = renderStatic(
    HistoryToolbar,
    props({ counts: { all: 3, dictations: 3, meetings: 0, notes: 0, failed: 0 } })
  );
  assert.doesNotMatch(none, /data-failed-count/);
});

test("all new toolbar native controls carry the full opaque focus ring", async () => {
  const { HistoryToolbar } = await load();
  const html = renderStatic(HistoryToolbar, props());
  for (const control of html.matchAll(/<(?:button|input)\b[^>]*>/g)) {
    assert.match(control[0], /focus-visible:ring-2/);
    assert.match(control[0], /focus-visible:ring-ring(?: |")/);
  }
});

test("all eleven locales translate history keys and every CLDR plural with placeholders intact", () => {
  const root = path.join(__dirname, "../../src/locales");
  const en = JSON.parse(fs.readFileSync(path.join(root, "en/translation.json"))).home.history;
  for (const lang of fs.readdirSync(root)) {
    const file = path.join(root, lang, "translation.json");
    if (!fs.existsSync(file)) continue;
    const history = JSON.parse(fs.readFileSync(file)).home.history;
    for (const [key, value] of Object.entries(en)) {
      if (/_(one|other)$/.test(key)) continue;
      assert.equal(typeof history[key], typeof value, `${lang}.${key}`);
    }
    assert.deepEqual(Object.keys(history.chips).sort(), Object.keys(en.chips).sort());
    for (const category of new Intl.PluralRules(lang).resolvedOptions().pluralCategories) {
      for (const key of ["dayCount", "words", "session"]) {
        const text = history[`${key}_${category}`];
        assert.equal(typeof text, "string", `${lang}.${key}_${category}`);
        assert.match(text, /{{count}}/);
        if (key === "session") assert.match(text, /{{duration}}/);
      }
    }
    assert.match(history.nothingMatches, /{{query}}/);
  }
});

test("the Failed count uses readable ink on both selected and unselected chips", async () => {
  const { HistoryToolbar } = await load();
  for (const filter of ["all", "failed"]) {
    const html = renderStatic(HistoryToolbar, props({ filter }));
    assert.match(html, /data-failed-count="1"[^>]*class="[^"]*text-foreground/);
  }
});
