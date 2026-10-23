const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const file = path.resolve(__dirname, "../../scripts/check-i18n.js");
const source = fs.readFileSync(file, "utf8");
const locales = path.resolve(__dirname, "../../src/locales");
const en = {
  title: "Hello {{name}}",
  showAll_one: "Show {{count}}",
  showAll_other: "Show all {{count}}",
};
const otherOnly = { title: "Name {{name}}", showAll_other: "All {{count}}" };

// Run the actual executable checker with an in-memory filesystem, including
// both real namespaces. Only file IO and exit are replaced, not checker logic.
function check(translations, prompts = {}) {
  const rows = { en, ...translations };
  const files = new Map();
  for (const [lang, translation] of Object.entries(rows)) {
    files.set(path.join(locales, lang, "translation.json"), JSON.stringify(translation));
    files.set(
      path.join(locales, lang, "prompts.json"),
      JSON.stringify(prompts[lang] ?? { instruction: "Keep {{name}}" })
    );
  }
  const errors = [];
  const logs = [];
  let code = 0;
  const exit = {};
  const fakeFs = {
    readdirSync: () => Object.keys(rows),
    statSync: () => ({ isDirectory: () => true }),
    existsSync: (name) => files.has(name),
    readFileSync: (name) => {
      assert.ok(files.has(name), `Unexpected read: ${name}`);
      return files.get(name);
    },
  };
  try {
    vm.runInNewContext(
      source,
      {
        __dirname: path.dirname(file),
        require: (id) => (id === "fs" ? fakeFs : require(id)),
        console: { error: (text) => errors.push(text), log: (text) => logs.push(text) },
        process: {
          exit: (value) => {
            code = value;
            throw exit;
          },
        },
        Intl,
      },
      { filename: file }
    );
  } catch (error) {
    if (error !== exit) throw error;
  }
  return { code, errors: errors.join("\n"), logs };
}

test("change-driving: real checker accepts Japanese and Chinese other-only plural families", () => {
  const result = check({ ja: otherOnly, "zh-CN": otherOnly, "zh-TW": otherOnly });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.logs.join("\n"), /consistent/);
});

test("baseline guard: real checker still requires ordinary keys and checks both namespaces", () => {
  const result = check({ ja: { showAll_other: "All {{count}}" } }, { ja: {} });
  assert.equal(result.code, 1);
  assert.match(result.errors, /Missing key ja\/translation: title/);
  assert.match(result.errors, /Missing key ja\/prompts: instruction/);
});

test("baseline guard: real checker still rejects missing categories the target locale uses", () => {
  const result = check({
    ru: { ...otherOnly, showAll_one: "{{count}}", showAll_many: "{{count}}" },
  });
  assert.equal(result.code, 1);
  assert.match(result.errors, /Missing plural form ru\/translation: showAll_few/);
  const englishSuffix = check({ de: otherOnly });
  assert.equal(englishSuffix.code, 1);
  assert.match(englishSuffix.errors, /showAll_one/);
});

test("baseline guard: real checker still rejects a wholly missing plural family, including Russian other", () => {
  for (const lang of ["ja", "ru"]) {
    const result = check({ [lang]: { title: "Name {{name}}" } });
    assert.equal(result.code, 1);
    assert.match(result.errors, new RegExp(`Missing key ${lang}/translation: showAll_other`));
  }
});

test("baseline guard: real checker still validates ordinary placeholders and present unused compatibility forms", () => {
  const ordinary = check({ ja: { ...otherOnly, title: "Name {{wrong}}" } });
  assert.equal(ordinary.code, 1);
  assert.match(ordinary.errors, /Placeholder mismatch ja\/translation: title/);
  const compatibility = check({ ja: { ...otherOnly, showAll_one: "All" } });
  assert.equal(compatibility.code, 1);
  assert.match(compatibility.errors, /Placeholder mismatch ja\/translation: showAll_one/);
});

test("baseline guard: real checker retains required count interpolation beyond exactly one", () => {
  const result = check({
    ru: { ...otherOnly, showAll_one: "One", showAll_few: "Few", showAll_many: "Many" },
  });
  assert.equal(result.code, 1);
  for (const category of ["one", "few", "many"])
    assert.match(result.errors, new RegExp(`Hardcoded count ru/translation: showAll_${category}`));
});
