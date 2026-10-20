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
  const mod = await import("../../src/components/ui/MentionSuggestions.tsx");
  return { default: mod.default.default ?? mod.default };
}

test("rows are grouped with headers and carry a type marker plus meta", async () => {
  const { default: MentionSuggestions } = await load();
  const html = renderStatic(MentionSuggestions, {
    command: () => {},
    items: [
      {
        key: "person-maya",
        kind: "person",
        label: "Maya Chen",
        entityId: null,
        email: "maya@acme.co",
        meta: "maya@acme.co",
      },
      {
        key: "meeting-38",
        kind: "meeting",
        label: "Pricing review",
        entityId: "38",
        email: null,
        meta: "Fri 9 Oct · 55 min",
      },
    ],
  });
  assert.match(html, />People</);
  assert.match(html, />Meetings</);
  assert.match(html, /data-kind="meeting"[\s\S]*Pricing review[\s\S]*Fri 9 Oct · 55 min/);
  assert.match(html, /role="listbox"/);
});

test("an empty result says so", async () => {
  const { default: MentionSuggestions } = await load();
  assert.match(
    renderStatic(MentionSuggestions, { command: () => {}, items: [] }),
    /Nothing to mention/
  );
});
