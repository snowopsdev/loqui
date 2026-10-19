const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const css = fs.readFileSync(path.join(root, "src/index.css"), "utf8");
const editor = fs.readFileSync(path.join(root, "src/components/notes/NoteEditor.tsx"), "utf8");
const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing ${selector}`);
  return match[1];
};

test("body is 16/1.65 at a 68ch measure, and stays plaintext-bidi", () => {
  const body = rule(".rich-text-editor-content");
  assert.match(body, /font-size:\s*1rem/);
  assert.match(body, /line-height:\s*1\.65/);
  assert.match(body, /unicode-bidi:\s*plaintext/);
  assert.match(rule(".rich-text-editor-content > *"), /max-width:\s*68ch/);
});

test("headings follow the R6 B ramp", () => {
  const expect = {
    h1: ["1.5rem", "1.25", "650"],
    h2: ["1.1875rem", "1.3", "600"],
    h3: ["1rem", "1.4", "600"],
  };
  for (const [tag, [size, lh, weight]] of Object.entries(expect)) {
    const body = rule(`.rich-text-editor-content ${tag}`);
    assert.match(body, new RegExp(`font-size:\\s*${size.replace(".", "\\.")}`), tag);
    assert.match(body, new RegExp(`line-height:\\s*${lh.replace(".", "\\.")}`), tag);
    assert.match(body, new RegExp(`font-weight:\\s*${weight}`), tag);
  }
  assert.match(rule(".rich-text-editor-content code"), /font-size:\s*0\.875rem/);
});

test("links in notes use the link role, not orange-on-white", () => {
  const link = rule(".rich-text-editor-content a");
  assert.match(link, /color:\s*var\(--color-link\)/);
  assert.match(link, /text-decoration:\s*underline/);
  assert.match(
    rule(".rich-text-editor-content a:focus-visible"),
    /outline:\s*2px solid var\(--color-ring\)/
  );
});

test("the note title is 32/1.15 semibold", () => {
  const title = editor.match(/ref=\{titleRef\}[\s\S]{0,700}?\/>/)?.[0];
  assert.ok(title, "missing title control");
  assert.match(title, /text-display font-semibold/);
  assert.doesNotMatch(title, /text-3xl/);
  assert.match(title, /focus-visible:ring-2 focus-visible:ring-ring/);
  assert.match(title, /empty:before:text-muted-foreground/);
});

test("the TipTap editable keeps its bidi, pane, caret, and keyboard-focus behavior", () => {
  const richTextEditor = fs.readFileSync(
    path.join(root, "src/components/ui/RichTextEditor.tsx"),
    "utf8"
  );
  const body = rule(".rich-text-editor-content");
  assert.match(body, /unicode-bidi:\s*plaintext/);
  assert.match(body, /padding-inline:/);
  assert.match(body, /caret-color:\s*var\(--color-foreground\)/);
  assert.match(
    richTextEditor,
    /class:\s*"rich-text-editor-content focus-visible:ring-2 focus-visible:ring-ring"/
  );
  assert.match(richTextEditor, /dir:\s*"auto"/);
});
