const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const script = path.join(__dirname, "../../scripts/merge-locale-keys.js");
const helper = () => require(script);

function makeRoot(t, locales = ["en", "de", "ar"]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan06-locales-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const lang of locales) {
    fs.mkdirSync(path.join(root, lang));
    fs.writeFileSync(path.join(root, lang, "translation.json"), JSON.stringify({ sidebar: { home: `home-${lang}` } }, null, 2) + "\n");
  }
  return root;
}
const read = (root, lang) => JSON.parse(fs.readFileSync(path.join(root, lang, "translation.json"), "utf8"));
const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
function writeFragment(root, fragment) {
  const file = path.join(root, "frag.json");
  fs.writeFileSync(file, JSON.stringify(fragment));
  return file;
}

test("the plain CLI keeps Plan 03's contract: optional root, overwrite, missing-locale message", (t) => {
  const root = makeRoot(t, ["en", "de"]);
  const bad = run([writeFragment(root, { en: { a: "A" } }), root]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Missing locales in fragment: de/);
  const ok = run([writeFragment(root, { en: { sidebar: { home: "Home" } }, de: { sidebar: { home: "Start" } } }), root]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(read(root, "de").sidebar.home, "Start", "plain mode overwrites, as before");
  assert.equal(run([]).status, 2);
});

test("--strict refuses a changed existing value and writes nothing", (t) => {
  const root = makeRoot(t);
  const before = Object.fromEntries(["en", "de", "ar"].map((lang) => [lang, fs.readFileSync(path.join(root, lang, "translation.json"), "utf8")]));
  const frag = writeFragment(root, { en: { sidebar: { home: "Today" } }, de: { sidebar: { home: "Heute" } }, ar: { sidebar: { home: "اليوم" } } });
  const result = run(["--strict", frag, root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^Locale fragment rejected: (?:ar|de|en): keys already exist with other values: sidebar\.home\n?$/);
  for (const lang of ["en", "de", "ar"]) {
    assert.equal(fs.readFileSync(path.join(root, lang, "translation.json"), "utf8"), before[lang]);
  }
});

test("--strict accepts identical nested array leaves on rerun", (t) => {
  const root = makeRoot(t);
  const nested = [["same", { values: [1, 2] }], ["also same"]];
  const frag = writeFragment(root, {
    en: { content: { nested } },
    de: { content: { nested } },
    ar: { content: { nested } },
  });
  assert.equal(run(["--strict", frag, root]).status, 0);
  assert.equal(run(["--strict", frag, root]).status, 0);
  for (const lang of ["en", "de", "ar"]) assert.deepEqual(read(root, lang).content.nested, nested);
});

test("--strict rejects a changed array leaf without writing any locale", (t) => {
  const root = makeRoot(t);
  const seed = writeFragment(root, {
    en: { content: { nested: [["original"]] } },
    de: { content: { nested: [["original"]] } },
    ar: { content: { nested: [["original"]] } },
  });
  assert.equal(run(["--strict", seed, root]).status, 0);
  const before = Object.fromEntries(["en", "de", "ar"].map((lang) => [lang, fs.readFileSync(path.join(root, lang, "translation.json"), "utf8")]));
  const changed = writeFragment(root, {
    en: { content: { nested: [["changed"]] } },
    de: { content: { nested: [["changed"]] } },
    ar: { content: { nested: [["changed"]] } },
  });
  const result = run(["--strict", changed, root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^Locale fragment rejected: (?:ar|de|en): keys already exist with other values: content\.nested\n?$/);
  for (const lang of ["en", "de", "ar"]) {
    assert.equal(fs.readFileSync(path.join(root, lang, "translation.json"), "utf8"), before[lang]);
  }
});

test("--strict works from any argument position and is idempotent", (t) => {
  const root = makeRoot(t);
  const frag = writeFragment(root, { en: { a: "A" }, de: { a: "Ä" }, ar: { a: "أ" } });
  assert.equal(run([frag, "--strict", root]).status, 0);
  assert.equal(run([frag, root, "--strict"]).status, 0);
  assert.equal(read(root, "de").a, "Ä");
});

test("--strict checks key parity and placeholders against English", () => {
  const { validateFragment } = helper();
  assert.deepEqual(validateFragment({ en: { a: "In {{minutes}} min", b: "B" }, de: { a: "In {{min}} Min." } }, ["de", "en"]), [
    "de: missing b",
    "de: placeholders differ at a",
  ]);
});

test("Arabic may carry extra plural forms for the same base key", () => {
  const { validateFragment } = helper();
  const errors = validateFragment(
    {
      en: { n_one: "{{count}} capture", n_other: "{{count}} captures" },
      ar: { n_zero: "لا شيء", n_one: "{{count}}", n_two: "{{count}}", n_few: "{{count}}", n_many: "{{count}}", n_other: "{{count}}" },
    },
    ["ar", "en"]
  );
  assert.deepEqual(errors, []);
});
