#!/usr/bin/env node
"use strict";
// Dev helper for UI plans. Merges a JSON fragment of new i18n keys:
// - en/translation.json: every fragment value is written (new or changed copy).
// - other locales: a key is added only when missing, or replaced while it still
//   equals the previous English value (an untranslated placeholder). Real
//   translations are never overwritten.
// - plural keys are expanded to every CLDR category the locale reaches for
//   counts 0-200, the same rule scripts/check-i18n.js enforces.
// Usage: node scripts/dev/merge-locale-keys.cjs <fragment.json | ->
const fs = require("node:fs");
const path = require("node:path");

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function pluralCategories(locale) {
  const rules = new Intl.PluralRules(locale);
  const categories = new Set();
  for (let n = 0; n <= 200; n++) categories.add(rules.select(n));
  // check-i18n.js requires `_other` as the compatibility/fallback form even
  // when no integer in its probe range selects it (for example, Russian).
  categories.add("other");
  return [...categories];
}

function expandPlurals(fragment, locale) {
  const out = {};
  for (const [key, value] of Object.entries(fragment)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = expandPlurals(value, locale);
      continue;
    }
    const match = key.match(PLURAL_SUFFIX);
    if (!match) {
      out[key] = value;
      continue;
    }
    const base = key.slice(0, -match[0].length);
    const other = fragment[`${base}_other`] ?? value;
    for (const category of pluralCategories(locale)) {
      const name = `${base}_${category}`;
      if (!(name in out)) out[name] = fragment[name] ?? other;
    }
  }
  return out;
}

function mergeInto(target, fragment, previous, overwrite) {
  for (const [key, value] of Object.entries(fragment)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      mergeInto(target[key], value, previous?.[key], overwrite);
    } else if (overwrite || !(key in target) || target[key] === previous?.[key]) {
      target[key] = value;
    }
  }
  return target;
}

function run(fragment, localesDir = path.join(__dirname, "../../src/locales")) {
  const file = (locale) => path.join(localesDir, locale, "translation.json");
  const read = (locale) => JSON.parse(fs.readFileSync(file(locale), "utf8"));
  const write = (locale, json) =>
    fs.writeFileSync(file(locale), `${JSON.stringify(json, null, 2)}\n`);
  const previousEn = read("en");
  write("en", mergeInto(read("en"), expandPlurals(fragment, "en"), previousEn, true));
  for (const locale of fs.readdirSync(localesDir)) {
    if (locale === "en" || !fs.existsSync(file(locale))) continue;
    const previous = expandPlurals(previousEn, locale);
    write(locale, mergeInto(read(locale), expandPlurals(fragment, locale), previous, false));
  }
}

module.exports = { run, expandPlurals, mergeInto, pluralCategories };

if (require.main === module) {
  const source = process.argv[2];
  if (!source) throw new Error("Usage: merge-locale-keys.cjs <fragment.json | ->");
  run(JSON.parse(fs.readFileSync(source === "-" ? 0 : source, "utf8")));
}
