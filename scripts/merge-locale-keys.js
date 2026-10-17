#!/usr/bin/env node
// Deep-merges a per-locale fragment into every src/locales/<lang>/translation.json.
// Usage: node scripts/merge-locale-keys.js [--strict] <fragment.json> [localesRoot]
// The fragment is { "en": {...}, "de": {...}, ... } and must cover every locale,
// so a new key can never land in English only (Plan 03).
// --strict (Plan 06) also requires every locale to carry the same keys as "en"
// (plural suffixes compared by base key) and the same {{placeholders}}, and
// refuses to change an existing value. Strict runs are all-or-nothing.
const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const baseKey = (key) => key.replace(PLURAL_SUFFIX, "");
const placeholders = (value) =>
  [...String(value).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort().join(",");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (isObject(value)) flatten(value, full, out);
    else out[full] = value;
  }
  return out;
}

function listLocales(root) {
  return fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, "translation.json")));
}

function validateFragment(fragment, locales) {
  const errors = [];
  if (!fragment.en) return ["missing locale \"en\""];
  const en = flatten(fragment.en);
  const enBases = new Set(Object.keys(en).map(baseKey));
  for (const lang of [...locales].sort()) {
    if (lang === "en" || !fragment[lang]) continue;
    const flat = flatten(fragment[lang]);
    const bases = new Set(Object.keys(flat).map(baseKey));
    for (const key of enBases) if (!bases.has(key)) errors.push(`${lang}: missing ${key}`);
    for (const key of bases) if (!enBases.has(key)) errors.push(`${lang}: extra ${key}`);
    for (const [key, value] of Object.entries(flat)) {
      if (PLURAL_SUFFIX.test(key) || !(key in en)) continue;
      if (placeholders(value) !== placeholders(en[key])) errors.push(`${lang}: placeholders differ at ${key}`);
    }
  }
  return errors;
}

function mergeLoose(target, source) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = isObject(value) ? mergeLoose(isObject(target[key]) ? target[key] : {}, value) : value;
  }
  return target;
}

function mergeStrict(target, source, trail, conflicts) {
  for (const [key, value] of Object.entries(source)) {
    const at = trail ? `${trail}.${key}` : key;
    if (isObject(value)) {
      if (target[key] === undefined) target[key] = {};
      if (!isObject(target[key])) {
        conflicts.push(at);
        continue;
      }
      mergeStrict(target[key], value, at, conflicts);
    } else if (target[key] === undefined) {
      target[key] = value;
    } else if (!isDeepStrictEqual(target[key], value)) {
      conflicts.push(at);
    }
  }
}

function mergeFragment(fragment, { localesRoot, strict = false }) {
  const langs = listLocales(localesRoot);
  const missing = langs.filter((lang) => !fragment[lang]);
  if (missing.length) throw new Error(`Missing locales in fragment: ${missing.join(", ")}`);
  if (strict) {
    const errors = validateFragment(fragment, langs);
    if (errors.length) throw new Error(`Locale fragment rejected:\n${errors.join("\n")}`);
  }
  const pending = [];
  for (const lang of langs) {
    const file = path.join(localesRoot, lang, "translation.json");
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    if (strict) {
      const conflicts = [];
      mergeStrict(json, fragment[lang], "", conflicts);
      if (conflicts.length) throw new Error(`Locale fragment rejected: ${lang}: keys already exist with other values: ${conflicts.join(", ")}`);
    } else {
      mergeLoose(json, fragment[lang]);
    }
    pending.push([file, json]);
  }
  for (const [file, json] of pending) fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  return langs;
}

module.exports = { flatten, validateFragment, mergeFragment };

if (require.main === module) {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const [fragmentPath, rootArg] = args.filter((a) => a !== "--strict");
  if (!fragmentPath) {
    console.error("Usage: node scripts/merge-locale-keys.js [--strict] <fragment.json> [localesRoot]");
    process.exit(2);
  }
  const localesRoot = rootArg ?? path.join(__dirname, "..", "src", "locales");
  try {
    const langs = mergeFragment(JSON.parse(fs.readFileSync(fragmentPath, "utf8")), { localesRoot, strict });
    console.log(`Merged ${path.basename(fragmentPath)} into ${langs.length} locales${strict ? " (strict)" : ""}.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
