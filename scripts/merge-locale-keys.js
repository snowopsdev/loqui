#!/usr/bin/env node
// Deep-merges a per-locale fragment into every src/locales/<lang>/translation.json.
// Usage: node scripts/merge-locale-keys.js <fragment.json> [localesRoot]
// The fragment is { "en": {...}, "de": {...}, ... } and must cover every locale,
// so a new key can never land in English only.
const fs = require("node:fs");
const path = require("node:path");

const [fragmentPath, rootArg] = process.argv.slice(2);
if (!fragmentPath) {
  console.error("Usage: node scripts/merge-locale-keys.js <fragment.json> [localesRoot]");
  process.exit(2);
}
const root = rootArg ?? path.join(__dirname, "..", "src", "locales");
const fragment = JSON.parse(fs.readFileSync(fragmentPath, "utf8"));
const langs = fs
  .readdirSync(root)
  .filter((d) => fs.existsSync(path.join(root, d, "translation.json")));
const missing = langs.filter((lang) => !fragment[lang]);
if (missing.length) {
  console.error(`Missing locales in fragment: ${missing.join(", ")}`);
  process.exit(1);
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function merge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = isObject(value) ? merge(isObject(target[key]) ? target[key] : {}, value) : value;
  }
  return target;
}

for (const lang of langs) {
  const file = path.join(root, lang, "translation.json");
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify(merge(json, fragment[lang]), null, 2) + "\n");
}
console.log(`Merged ${path.basename(fragmentPath)} into ${langs.length} locales.`);
