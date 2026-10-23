const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { run } = require("../../scripts/dev/merge-locale-keys.cjs");

test("[change-driving] merges nested keys into every locale and refuses incomplete fragments", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-merge-locales-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const lang of ["en", "de"]) {
    fs.mkdirSync(path.join(root, lang));
    fs.writeFileSync(
      path.join(root, lang, "translation.json"),
      JSON.stringify({ a: { keep: lang } }, null, 2) + "\n"
    );
  }
  const script = path.join(__dirname, "../../scripts/merge-locale-keys.js");
  const fragment = path.join(root, "frag.json");

  fs.writeFileSync(fragment, JSON.stringify({ en: { a: { add: "x" } } }));
  const bad = spawnSync(process.execPath, [script, fragment, root], { encoding: "utf8" });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Missing locales in fragment: de/);

  fs.writeFileSync(fragment, JSON.stringify({ en: { a: { add: "x" } }, de: { a: { add: "y" } } }));
  const ok = spawnSync(process.execPath, [script, fragment, root], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  const de = JSON.parse(fs.readFileSync(path.join(root, "de", "translation.json"), "utf8"));
  assert.deepEqual(de, { a: { keep: "de", add: "y" } });
});

function localesFixture(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-locales-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [locale, json] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, locale));
    fs.writeFileSync(path.join(dir, locale, "translation.json"), JSON.stringify(json));
  }
  const read = (locale) =>
    JSON.parse(fs.readFileSync(path.join(dir, locale, "translation.json"), "utf8"));
  return { dir, read };
}

test("adds English, placeholders where missing, and never overwrites a translation", (t) => {
  const { dir, read } = localesFixture(t, {
    en: { setupFlow: { a: "Old A" } },
    de: { setupFlow: { a: "Altes A (übersetzt)" } },
    fr: { setupFlow: { a: "Old A" } },
  });
  run({ setupFlow: { a: "New A", b: "B" } }, dir);
  assert.deepEqual(read("en").setupFlow, { a: "New A", b: "B" });
  assert.deepEqual(read("de").setupFlow, { a: "Altes A (übersetzt)", b: "B" });
  assert.deepEqual(
    read("fr").setupFlow,
    { a: "New A", b: "B" },
    "a stale placeholder follows the new English"
  );
});

test("plural keys get every category each locale reaches", (t) => {
  const { dir, read } = localesFixture(t, { en: {}, ar: {}, ru: {} });
  run(
    { setupFlow: { left_one: "{{count}} thing left", left_other: "{{count}} things left" } },
    dir
  );
  assert.deepEqual(Object.keys(read("en").setupFlow).sort(), ["left_one", "left_other"]);
  assert.deepEqual(Object.keys(read("ar").setupFlow).sort(), [
    "left_few",
    "left_many",
    "left_one",
    "left_other",
    "left_two",
    "left_zero",
  ]);
  assert.deepEqual(Object.keys(read("ru").setupFlow).sort(), [
    "left_few",
    "left_many",
    "left_one",
    "left_other",
  ]);
});
