const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const repoRoot = path.join(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");

test("[source guard] support models live in the Language Models sub-tab, not Privacy & Data", () => {
  const page = read("src/components/SettingsPage.tsx");
  const privacy = page.slice(page.indexOf('case "privacyData":'));
  const privacyBody = privacy.slice(0, privacy.indexOf("case ", 10));
  assert.doesNotMatch(privacyBody, /<LocalSupportModels/);
  assert.match(page, /renderSupportModels=\{\(\) => <LocalSupportModels \/>\}/);
  assert.match(
    page,
    /<TabPanel active=\{tab === "supportModels"\}>\{renderSupportModels\(\)\}<\/TabPanel>/
  );
  assert.match(page, /id: "supportModels", name: t\("settingsPage\.llms\.tabs\.supportModels"\)/);
});

test("[source guard] the tab unions come from settingsPaths so route paths cannot drift", () => {
  const page = read("src/components/SettingsPage.tsx");
  assert.match(page, /import \{ LLM_SUB_TABS, SPEECH_SUB_TABS \} from "\.\.\/lib\/settingsPaths"/);
  assert.match(page, /type LlmTab = \(typeof LLM_SUB_TABS\)\[number\]/);
  assert.doesNotMatch(page, /type LlmTab =\s*\|/);
});

test("[change-driving] every locale carries the support-model copy with the size placeholder", () => {
  const dir = path.join(repoRoot, "src/locales");
  for (const lang of fs
    .readdirSync(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, "translation.json")))) {
    const json = JSON.parse(read(`src/locales/${lang}/translation.json`));
    const llms = json.settingsPage.llms;
    assert.ok(llms.tabs.supportModels, `${lang} tab`);
    for (const key of ["title", "description", "downloaded", "checking", "download"])
      assert.ok(llms.supportModels[key], `${lang} ${key}`);
    assert.match(llms.supportModels.download, /\{\{size\}\}/, `${lang} keeps {{size}}`);
  }
});
