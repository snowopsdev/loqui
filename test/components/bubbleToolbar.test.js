const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { renderStatic } = require("../helpers/harness/reactSsr");

const root = path.join(__dirname, "../..");
async function load() {
  if (!i18next.isInitialized) {
    const en = JSON.parse(
      fs.readFileSync(path.join(root, "src/locales/en/translation.json"), "utf8")
    );
    await i18next.use(initReactI18next).init({
      lng: "en",
      resources: { en: { translation: en } },
      interpolation: { escapeValue: false },
    });
  }
  return import("../../src/components/ui/editor/BubbleToolbar.tsx");
}
const noop = () => {};
const base = {
  active: { bold: true, italic: false, link: false },
  onBold: noop,
  onItalic: noop,
  onLink: noop,
  onAskAi: noop,
};

test("B, I, Link and Ask AI — no Highlight (it would not survive a save)", async () => {
  const { BubbleToolbarButtons } = await load();
  const html = renderStatic(BubbleToolbarButtons, base);
  for (const label of ["Bold", "Italic", "Link", "Ask AI"])
    assert.match(html, new RegExp(`aria-label="${label}"|>${label}<`));
  assert.doesNotMatch(html, /Highlight/i);
  assert.match(
    html,
    /aria-label="Bold"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Bold"/
  );
  assert.match(html, /class="[^"]*text-ai-text[^"]*"[^>]*>[\s\S]*Ask AI/);
});

test("Ask AI hands the selection to the caller, it never submits", async () => {
  const { buildAskAiDraft } = await load();
  assert.equal(buildAskAiDraft("  Thursday, not Monday  "), "“Thursday, not Monday” ");
  assert.equal(buildAskAiDraft(""), "");
  assert.ok(buildAskAiDraft("x".repeat(1000)).length <= 280);
});

test("Ask AI opens a visible composer and seeds it, disarming any queue (I05)", async () => {
  const { askAiTransition } = await load();
  const opened = askAiTransition("hidden", "Thursday, not Monday");
  assert.equal(opened.mode, "floating", "a hidden chat opens");
  assert.equal(opened.seed.text, "“Thursday, not Monday” ");
  assert.equal(opened.seed.resetQueue, true);
  assert.equal(askAiTransition("sidebar", "x").mode, "sidebar", "a docked chat stays docked");
  assert.equal(askAiTransition("hidden", "   "), null);
  // The seed goes to EmbeddedChat's ChatInput, never to the bottom bar that hides itself.
  const editor = fs.readFileSync(path.join(root, "src/components/notes/NoteEditor.tsx"), "utf8");
  assert.equal(
    (editor.match(/composerSeed=\{chatSeed\}/g) ?? []).length,
    1,
    "one persistent composer receives the current seed across placements"
  );
  assert.match(editor, /mode=\{chatMode\}/);
  assert.match(editor, /chatHasOpened/);
  assert.doesNotMatch(editor, /<NoteBottomBar[^>]*\bseed=/);
  assert.match(
    fs.readFileSync(path.join(root, "src/components/notes/EmbeddedChat.tsx"), "utf8"),
    /seed=\{composerSeed\}/
  );
});

test("the bubble menu extension is a direct, pinned dependency", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.dependencies["@tiptap/extension-bubble-menu"], "3.31.3");
});

test("every native bubble button has canonical opaque focus rings", async () => {
  const { BubbleToolbarButtons, askAiTransition } = await load();
  const html = renderStatic(BubbleToolbarButtons, base);
  const buttons = [...html.matchAll(/<button\b[^>]*>/g)];
  assert.equal(buttons.length, 4);
  for (const [button] of buttons) {
    assert.match(button, /focus-visible:ring-2/);
    assert.match(button, /focus-visible:ring-ring(?:\s|")/);
  }
  const first = askAiTransition("floating", "first");
  const second = askAiTransition("floating", "second");
  assert.ok(second.seed.nonce > first.seed.nonce, "repeated Ask always admits the latest intent");
});
