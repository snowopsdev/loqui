const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const src = fs.readFileSync(path.join(root, "src/components/SettingsPage.tsx"), "utf8");
const between = (start, end) => {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `${start} exists`);
  const b = src.indexOf(end, a + start.length);
  assert.ok(b > a, `${end} follows ${start}`);
  return src.slice(a, b);
};

test("[source guard, change-driving] dictation controls live in Dictation, not Preferences", () => {
  const general = between('case "general":', 'case "hotkeys":');
  // Task 10 inserts case "routing": directly after the hotkeys case.
  const dictation = between('case "hotkeys":', 'case "routing":');
  for (const marker of [
    "<MicrophoneSettings",
    "keepTranscriptionInClipboard",
    "autoLearnCorrections",
    "settings.language.transcriptionLabel",
    "chineseScriptPreference",
    "ydotoolStatus",
  ]) {
    assert.ok(!general.includes(marker), `${marker} left Preferences`);
    assert.ok(dictation.includes(marker), `${marker} is in Dictation`);
  }
  assert.ok(
    general.includes("settings.language.uiLabel"),
    "interface language stays in Preferences"
  );
  assert.ok(
    general.includes("UI_LANGUAGE_OPTIONS"),
    "interface language options stay in Preferences"
  );
});

test("[source guard, change-driving] settings primitives are imported, not re-declared (SET-Q18)", () => {
  assert.doesNotMatch(src, /^function SettingsPanel\(/m);
  assert.doesNotMatch(src, /^function SettingsPanelRow\(/m);
  assert.doesNotMatch(src, /^function SectionHeader\(/m);
  for (const name of ["SectionHeader", "SettingsPanel", "SettingsPanelRow"]) {
    assert.match(
      src,
      new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "\\.\\/ui\\/SettingsSection"`, "s"),
      `${name} is imported from ./ui/SettingsSection`
    );
  }
});

test("[source guard, change-driving] the sticky title names the section, so tab headers drop their title", () => {
  const stt = between("function SpeechToTextTabs", "function LlmsTabs");
  const llms = between("function LlmsTabs", "function GpuDeviceSelector");
  assert.doesNotMatch(stt, /<SectionHeader\s+title=/);
  assert.doesNotMatch(llms, /<SectionHeader\s+title=/);
  const privacy = between('case "privacyData":', 'case "system":');
  assert.doesNotMatch(
    privacy.slice(0, privacy.indexOf("</div>")),
    /<SectionHeader\s+title=\{t\("settingsPage\.privacy\.title"\)/
  );
  const routing = fs.readFileSync(
    path.join(root, "src/components/settings/routing/RoutingSection.tsx"),
    "utf8"
  );
  assert.doesNotMatch(routing, /<SectionHeader[^>]*\btitle=/s);
});

test("[change-driving] section labels and descriptions match the re-homed contents in every locale file", () => {
  const dir = path.join(root, "src/locales");
  const en = JSON.parse(fs.readFileSync(path.join(dir, "en/translation.json"), "utf8"));
  const s = en.settingsModal.sections;
  assert.equal(s.hotkeys.label, "Dictation");
  assert.equal(s.hotkeys.description, "Hotkeys, microphone, paste, language");
  assert.equal(s.general.description, "Appearance, sounds, startup");
  assert.equal(s.privacyData.description, "Retention, storage, permissions");
  assert.equal(s.system.description, "Updates and developer tools");
  assert.doesNotMatch(s.privacyData.description, /analytics/i);
  for (const lang of fs
    .readdirSync(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, "translation.json")))) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, lang, "translation.json"), "utf8"));
    for (const id of ["general", "hotkeys", "speechToText", "llms", "privacyData", "system"]) {
      assert.ok(json.settingsModal.sections[id].label, `${lang} ${id} label`);
      assert.ok(json.settingsModal.sections[id].description, `${lang} ${id} description`);
    }
    for (const key of ["dictationSectionTitle", "dictationSectionDescription"]) {
      assert.ok(json.settings.language[key], `${lang} settings.language.${key}`);
    }
  }
});
