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
function check(translations, prompts = {}, { argv = [], env = {} } = {}) {
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
  const warnings = [];
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
        console: {
          error: (text) => errors.push(text),
          warn: (text) => warnings.push(text),
          log: (text) => logs.push(text),
        },
        process: {
          argv: ["node", file, ...argv],
          env,
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
  return { code, errors: errors.join("\n"), warnings: warnings.join("\n"), logs };
}

test("change-driving: real checker accepts Japanese and Chinese other-only plural families", () => {
  const result = check({ ja: otherOnly, "zh-CN": otherOnly, "zh-TW": otherOnly });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.logs.join("\n"), /consistent/);
});

test("[change-driving] by default a missing translation warns instead of failing the PR", () => {
  const result = check({ ja: { showAll_other: "All {{count}}" } }, { ja: {} });
  assert.equal(result.code, 0, result.errors);
  assert.equal(result.errors, "");
  assert.match(result.warnings, /ja\/translation is missing 1 key \(falls back to en\): title/);
  assert.match(result.warnings, /ja\/prompts is missing 1 key \(falls back to en\): instruction/);
  assert.match(result.logs.join("\n"), /2 translations are missing.*--strict/);
  const annotated = check(
    { ja: { showAll_other: "All {{count}}" } },
    {},
    { env: { GITHUB_ACTIONS: "true" } }
  );
  assert.match(annotated.warnings, /^::warning::\[i18n\] Warning: ja\/translation/);
});

test("[change-driving] default mode still fails English, placeholder and plural errors in present keys", () => {
  const placeholder = check({ ja: { showAll_other: "All {{wrong}}" } });
  assert.equal(placeholder.code, 1);
  assert.match(placeholder.errors, /Placeholder mismatch ja\/translation: showAll_other/);
  const plural = check({
    ru: { title: "Name {{name}}", showAll_one: "{{count}}", showAll_other: "{{count}}" },
  });
  assert.equal(plural.code, 1);
  assert.match(plural.errors, /Missing plural form ru\/translation: showAll_few/);
  const hardcoded = check({
    ru: {
      showAll_one: "One",
      showAll_few: "{{count}}",
      showAll_many: "{{count}}",
      showAll_other: "{{count}}",
    },
  });
  assert.equal(hardcoded.code, 1);
  assert.match(hardcoded.errors, /Hardcoded count ru\/translation: showAll_one/);
});

test("baseline guard: --strict and I18N_STRICT=1 still require ordinary keys and check both namespaces", () => {
  for (const options of [{ argv: ["--strict"] }, { env: { I18N_STRICT: "1" } }]) {
    const result = check({ ja: { showAll_other: "All {{count}}" } }, { ja: {} }, options);
    assert.equal(result.code, 1);
    assert.match(result.errors, /Missing key ja\/translation: title/);
    assert.match(result.errors, /Missing key ja\/prompts: instruction/);
  }
});

test("a long list of missing translations is summarized in one warning per locale file", () => {
  const many = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`k${i}`, "v"]));
  const result = check({ ja: otherOnly, en: { ...en, ...many } });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.warnings, /ja\/translation is missing 14 keys .*k9, \+4 more/);
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

test("baseline guard: real checker still rejects a wholly missing plural family under --strict, including Russian other", () => {
  for (const lang of ["ja", "ru"]) {
    const result = check({ [lang]: { title: "Name {{name}}" } }, {}, { argv: ["--strict"] });
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
