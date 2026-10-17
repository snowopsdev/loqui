const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

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
