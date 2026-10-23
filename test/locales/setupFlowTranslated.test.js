const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const localesDir = path.join(__dirname, "../../src/locales");
const read = (locale) =>
  JSON.parse(fs.readFileSync(path.join(localesDir, locale, "translation.json"), "utf8"));
const PLURAL = /_(zero|one|two|few|many|other)$/;
// Product-only labels and standard unit symbols are language independent.
// Keep this list exact: ordinary phrases containing a brand still need translation.
const SAME_EVERYWHERE = new Map([
  ["cleanup.options.codex", "ChatGPT"],
  ["tour.privacy.nodes.loqui", "Loqui"],
  ["units.mb", "{{value}} MB"],
  ["units.gb", "{{value}} GB"],
]);

function flatten(object, prefix = "", out = {}) {
  if (!object || typeof object !== "object" || Array.isArray(object)) {
    out[prefix] = object;
    return out;
  }
  for (const [key, value] of Object.entries(object)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) flatten(value, name, out);
    else out[name] = value;
  }
  return out;
}

const placeholders = (value) => (value.match(/\{\{[^}]+\}\}/g) || []).sort();
const normalized = (value) =>
  value
    .normalize("NFKC")
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();

function issuesFor(english, translated, locale) {
  const issues = [];
  const families = new Set(
    Object.keys(english)
      .filter((key) => PLURAL.test(key))
      .map((key) => key.replace(PLURAL, ""))
  );
  const required = new Set(Object.keys(english).filter((key) => !PLURAL.test(key)));
  const categories = new Set(["other"]);
  const rules = new Intl.PluralRules(locale);
  for (let count = 0; count <= 200; count++) categories.add(rules.select(count));
  for (const family of families) {
    for (const category of categories) required.add(`${family}_${category}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(translated, key)) issues.push(`${key}: missing translation`);
  }
  for (const [key, value] of Object.entries(translated)) {
    const base = key.replace(PLURAL, "");
    const source = english[key] ?? english[`${base}_other`];
    if (typeof source !== "string") {
      issues.push(`${key}: unknown key`);
      continue;
    }
    if (typeof value !== "string" || !value.trim()) {
      issues.push(`${key}: expected nonempty string`);
      continue;
    }
    if (JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(source))) {
      issues.push(`${key}: placeholder mismatch`);
    }
    if (
      locale !== "en" &&
      SAME_EVERYWHERE.get(key) !== source &&
      /\p{L}{2,}/u.test(source.replace(/\{\{[^}]+\}\}/g, ""))
    ) {
      const sources = PLURAL.test(key)
        ? Object.entries(english)
            .filter(([name]) => name.replace(PLURAL, "") === base)
            .map(([, text]) => text)
        : [source];
      if (sources.some((entry) => normalized(value) === normalized(entry)))
        issues.push(`${key}: untranslated English`);
    }
  }
  return issues;
}

test("every setup string is translated with complete keys, plurals and placeholders", () => {
  const english = flatten(read("en").setupFlow);
  const locales = fs
    .readdirSync(localesDir)
    .filter((name) => fs.existsSync(path.join(localesDir, name, "translation.json")))
    .sort();
  assert.deepEqual(locales, [
    "ar",
    "de",
    "en",
    "es",
    "fr",
    "it",
    "ja",
    "pt",
    "ru",
    "zh-CN",
    "zh-TW",
  ]);
  const issues = locales.flatMap((locale) =>
    issuesFor(english, flatten(read(locale).setupFlow), locale).map(
      (issue) => `${locale}: ${issue}`
    )
  );
  assert.equal(issues.length, 0, issues.join("\n"));
});

test("guard rejects ordinary English, including a phrase containing a brand", () => {
  for (const value of ["Loqui setup", "LOQUI SETUP!", "Loqui\u200b setup"]) {
    assert.deepEqual(issuesFor({ brand: "Loqui setup" }, { brand: value }, "de"), [
      "brand: untranslated English",
    ]);
  }
});

test("guard rejects absent translations, empty/nonstring values and missing plural categories", () => {
  assert.deepEqual(issuesFor({ title: "Ready" }, {}, "ja"), ["title: missing translation"]);
  for (const value of [null, 4, "", []]) {
    assert.deepEqual(issuesFor({ title: "Ready" }, { title: value }, "de"), [
      "title: expected nonempty string",
    ]);
  }
  const english = { words_one: "{{count}} word", words_other: "{{count}} words" };
  assert.ok(
    issuesFor(english, { words_other: "{{count}} word" }, "ja").includes(
      "words_other: untranslated English"
    )
  );
  const issues = issuesFor(english, { words_other: "{{count}} كلمة" }, "ar");
  for (const category of ["zero", "one", "two", "few", "many"])
    assert.ok(issues.includes(`words_${category}: missing translation`));
});

test("guard rejects lost interpolation and admits only exact product/unit exceptions", () => {
  assert.deepEqual(
    issuesFor({ sent: "Send {{count}} to {{provider}}" }, { sent: "An {{provider}} senden" }, "de"),
    ["sent: placeholder mismatch"]
  );
  const allowed = {
    "cleanup.options.codex": "ChatGPT",
    "tour.privacy.nodes.loqui": "Loqui",
    "units.mb": "{{value}} MB",
    "units.gb": "{{value}} GB",
  };
  assert.deepEqual(issuesFor(allowed, allowed, "de"), []);
  assert.deepEqual(issuesFor({ "units.mb": "Free space" }, { "units.mb": "Free space" }, "de"), [
    "units.mb: untranslated English",
  ]);
  assert.deepEqual(
    issuesFor({ "units.description": "Free space" }, { "units.description": "Free space" }, "de"),
    ["units.description: untranslated English"]
  );
});

test("all eleven resources resolve local CLDR forms and interpolate localized numbers", async () => {
  const i18next = require("i18next");
  const resources = Object.fromEntries(
    fs
      .readdirSync(localesDir)
      .filter((locale) => fs.existsSync(path.join(localesDir, locale, "translation.json")))
      .map((locale) => [locale, { translation: read(locale) }])
  );
  const instance = i18next.createInstance();
  await instance.init({ resources, fallbackLng: false, interpolation: { escapeValue: false } });
  const english = flatten(resources.en.translation.setupFlow);
  const families = [
    ...new Set(
      Object.keys(english)
        .filter((key) => PLURAL.test(key))
        .map((key) => key.replace(PLURAL, ""))
    ),
  ];
  for (const locale of Object.keys(resources)) {
    const flat = flatten(resources[locale].translation.setupFlow);
    const number = new Intl.NumberFormat(locale);
    const rules = new Intl.PluralRules(locale);
    const t = instance.getFixedT(locale);
    const counts = [...Array.from({ length: 201 }, (_, index) => index), 1.5];
    for (const family of families) {
      // Retain and exercise merger-created million forms where they already exist.
      const familyCounts =
        flat[`${family}_many`] && rules.select(1_000_000) === "many"
          ? [...counts, 1_000_000]
          : counts;
      for (const count of familyCounts) {
        const category = rules.select(count);
        const key = `${family}_${category}`;
        assert.equal(typeof flat[key], "string", `${locale}: missing ${key}`);
        const resolved = t(`setupFlow.${family}`, { count, provider: "FixtureProvider" });
        assert.equal(
          resolved,
          flat[key]
            .replaceAll("{{count}}", String(count))
            .replaceAll("{{provider}}", "FixtureProvider"),
          `${locale}: ${key} at ${count}`
        );
      }
    }
    for (const [key, value] of Object.entries(flat)) {
      const substitutions = Object.fromEntries(
        placeholders(value).map((token) => [
          token.slice(2, -2),
          token === "{{count}}" ? 21 : number.format(1234.5),
        ])
      );
      const rendered = t(`setupFlow.${key}`, substitutions);
      assert.ok(!rendered.includes("{{"), `${locale}: unresolved interpolation in ${key}`);
      for (const token of placeholders(value))
        assert.ok(
          rendered.includes(String(substitutions[token.slice(2, -2)])),
          `${locale}: lost ${token} in ${key}`
        );
    }
  }
});
