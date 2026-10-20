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
  return import("../../src/components/chat/ChatContextRail.tsx");
}

test("pinned items are removable; found items are read-only; no fake toggles", async () => {
  const { ChatContextRail } = await load();
  const html = renderStatic(ChatContextRail, {
    model: {
      pinned: [{ kind: "meeting", id: 38, label: "Pricing review" }],
      found: [{ noteId: 17, title: "Pricing FAQ draft", kind: "note" }],
      activity: [
        {
          key: "t1",
          toolName: "search_notes",
          status: "completed",
          label: "Searched notes: “pricing”",
        },
      ],
    },
    onUnpin: () => {},
    onOpenNote: () => {},
  });
  assert.match(html, /<aside[^>]*aria-label="Context"/);
  assert.match(html, /aria-label="Remove Pricing review from context"/);
  assert.match(html, /Found automatically/);
  assert.doesNotMatch(html, /type="checkbox"|role="switch"/);
  assert.match(html, /<ol[\s\S]*Searched notes: “pricing”/);
});

test("an empty rail explains how to add context", async () => {
  const { ChatContextRail } = await load();
  const html = renderStatic(ChatContextRail, {
    model: { pinned: [], found: [], activity: [] },
    onUnpin: () => {},
    onOpenNote: () => {},
  });
  assert.match(html, /Type @ to add a note, meeting or folder/);
});
