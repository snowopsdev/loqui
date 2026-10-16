const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const LOCALES = path.join(__dirname, "../../src/locales");
const languages = fs
  .readdirSync(LOCALES)
  .filter((entry) => fs.existsSync(path.join(LOCALES, entry, "translation.json")));
const load = (lang) =>
  JSON.parse(fs.readFileSync(path.join(LOCALES, lang, "translation.json"), "utf8"));
const get = (json, key) => key.split(".").reduce((node, part) => node?.[part], json);

const DEAD = [
  "settingsModal.sections.account",
  "settingsModal.sections.plansBilling",
  "settingsModal.sections.workspace",
  "settingsModal.groups.account",
  "settingsPage.account",
  "settingsPage.workspace",
  "settingsPage.aiModels.modes.openwhispr",
  "settingsPage.aiModels.modes.openwhisprDesc",
  "settingsPage.aiModels.openwhisprCloud",
  "settingsPage.aiModels.openwhisprCloudDescription",
  "settingsPage.transcription.modes.openwhispr",
  "settingsPage.transcription.modes.openwhisprDesc",
  "settingsPage.transcription.openwhisprCloud",
  "settingsPage.transcription.openwhisprCloudDescription",
  "dictationAgent.modes.openwhispr",
  "dictationAgent.modes.openwhisprDesc",
  "agentMode.settings.modes.openwhispr",
  "agentMode.settings.modes.openwhisprDesc",
  "promptStudio.test.openwhisprCloud",
  "notes.upload.openwhisprCloud",
  "settingsPage.privacy.usageAnalytics",
  "settingsPage.privacy.usageAnalyticsDescription",
];

test("dead account, billing, workspace and hosted-cloud keys are gone from every locale", () => {
  for (const lang of languages) {
    const json = load(lang);
    for (const key of DEAD) assert.equal(get(json, key), undefined, `${lang}: ${key}`);
  }
});

test("the privacy section no longer promises analytics in any language", () => {
  const analytics = /analytic|Analyse|análisis|análise|analisi|аналитик|التحليلات|分析/i;
  for (const lang of languages) {
    const description = get(load(lang), "settingsModal.sections.privacyData.description");
    assert.ok(description, `${lang} keeps the description`);
    assert.doesNotMatch(description, analytics, `${lang}: ${description}`);
  }
  assert.equal(
    get(load("en"), "settingsModal.sections.privacyData.description"),
    "Privacy, permissions & stored data"
  );
});
