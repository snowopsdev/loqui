const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const LOCALES = path.join(__dirname, "../../src/locales");
const EXPECTED = { groups: 3, names: 11, subtitles: 11, payload: 17 }; // 16 payload parts + metadataNote

test("every locale names every route, group and payload part", () => {
  const read = (lang) =>
    JSON.parse(fs.readFileSync(path.join(LOCALES, lang, "translation.json"), "utf8"));
  const en = read("en").routes;
  for (const lang of fs
    .readdirSync(LOCALES)
    .filter((d) => fs.existsSync(path.join(LOCALES, d, "translation.json")))) {
    const routes = read(lang).routes;
    assert.ok(routes, `${lang} has routes`);
    for (const [group, count] of Object.entries(EXPECTED)) {
      assert.equal(Object.keys(routes[group]).length, count, `${lang} routes.${group}`);
      assert.deepEqual(
        Object.keys(routes[group]).sort(),
        Object.keys(en[group]).sort(),
        `${lang} routes.${group} keys`
      );
    }
  }
});
