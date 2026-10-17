const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

const root = path.join(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const en = JSON.parse(read("src/locales/en/translation.json"));
const noop = () => {};

test("[change-driving] local mode no longer claims 'fully private'", () => {
  const values = [
    en.settingsPage.transcription.modes.localDesc,
    en.settingsPage.aiModels.modes.localDesc,
    en.agentMode.settings.modes.localDesc,
    en.dictationAgent.modes.localDesc,
  ];
  for (const value of values) {
    assert.doesNotMatch(value, /fully private/i);
    assert.match(value, /Nothing leaves it/);
  }
});

test("[change-driving] local model tabs: Whisper is Whisper, and Oruk is explained", async (t) => {
  installBrowserGlobals(t, {
    window: { location: { search: "" }, electronAPI: { getPlatform: () => "darwin" } },
  });
  const vite = await createRendererServer(
    t,
    withI18nMock({
      cachePrefix: "loqui-honest-copy-test-",
      resolveAlias: { "@": path.resolve(root, "src") },
    })
  );
  const { LOCAL_ASR_ORGANIZATIONS } = await vite.ssrLoadModule("/helpers/localASROrganization.ts");
  const { default: Picker } = await vite.ssrLoadModule("/components/TranscriptionModelPicker.tsx");
  const { ToastProvider } = await vite.ssrLoadModule("/components/ui/Toast.tsx");
  const render = (props) =>
    renderToStaticMarkup(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(Picker, {
          useLocalWhisper: true,
          onLocalModelSelect: noop,
          onModeChange: noop,
          ...props,
        })
      )
    );

  await t.test("change-driving: the Whisper family is labelled Whisper, not OpenAI", () => {
    assert.equal(LOCAL_ASR_ORGANIZATIONS.find((o) => o.id === "whisper").name, "Whisper");
    const html = render({ selectedLocalProvider: "whisper", selectedLocalModel: "base" });
    assert.ok(
      html.indexOf(">Oruk<") >= 0 && html.indexOf(">Oruk<") < html.indexOf(">Whisper<"),
      "Oruk leads, Whisper follows"
    );
  });

  await t.test("change-driving: the Oruk tab explains itself, other tabs do not", () => {
    const oruk = render({ selectedLocalProvider: "nvidia", selectedLocalModel: "orukeet-v0.1.0" });
    assert.match(oruk, /transcription\.families\.orukHint/);
    const nvidia = render({
      selectedLocalProvider: "nvidia",
      selectedLocalModel: "parakeet-tdt-0.6b-v3",
    });
    assert.doesNotMatch(nvidia, /transcription\.families\.orukHint/);
  });
});

test("[source guard, change-driving] 'Review dictation setup' is a link below the engine controls", () => {
  const src = read("src/components/SettingsPage.tsx");
  const section = src.slice(
    src.indexOf("function TranscriptionSection"),
    src.indexOf("interface AiModelsSectionProps")
  );
  assert.ok(section.length > 0);
  const gpu = section.indexOf('<GpuDeviceSelector purpose="transcription"');
  const link = section.indexOf("onClick={startOnboarding}");
  assert.ok(gpu > 0 && link > gpu, "the link follows the engine controls and the GPU selector");
  assert.doesNotMatch(
    section,
    /<Button[^>]*onClick=\{startOnboarding\}/,
    "no setup button card any more"
  );
  assert.match(section, /className="[^"]*\btext-link\b/);
  assert.match(section, /t\("settingsPage\.reviewSetup\.title"\)/);
  assert.match(section, /t\("settingsPage\.reviewSetup\.description"\)/);
  assert.doesNotMatch(section, />Review dictation setup</, "no hard-coded English");
});

test("[source guard, change-driving] screen context names its destination and uses no low-contrast text", () => {
  const src = read("src/components/settings/DictationAgentSettings.tsx");
  assert.match(src, /useResolvedRoute\("assistantVision"\)/);
  assert.match(src, /screenContextCopy\(/);
  assert.doesNotMatch(src, /screenContext\.enableDescription/);
  assert.doesNotMatch(src, /\btext-(?:success|warning)\b/);
});

test("[source guard, change-driving] the dictionary header uses the labelled actions and no low-contrast text", () => {
  const src = read("src/components/DictionaryView.tsx");
  assert.match(src, /<DictionaryHeaderActions/);
  assert.match(src, /autoLearnCorrections/);
  assert.match(src, /title=\{t\("dictionary\.importWords"\)\}/);
  assert.doesNotMatch(src, /\btext-(?:success|warning)\b/);
  const hook = read("src/hooks/useSettings.ts");
  assert.match(hook, /useAutoLearnCorrections\(\)/);
});
