const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

const root = path.join(__dirname, "../..");
const EN = JSON.parse(fs.readFileSync(path.join(root, "src/locales/en/translation.json"), "utf8"));
const lookup = (json) => (key) =>
  key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), json) ?? key;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name))
      out.push({ file: path.relative(root, full), text: fs.readFileSync(full, "utf8") });
  }
  return out;
}

const SECTION_OF = {
  general: "general",
  hotkeys: "hotkeys",
  routing: "routing",
  stt: "speechToText",
  llms: "llms",
  privacyData: "privacyData",
  system: "system",
};

test("[change-driving] settings registry", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-settings-registry-test-" });
  const registry = await vite.ssrLoadModule("/components/settings/settingsRegistry.ts");
  const { parseSettingsPath } = await vite.ssrLoadModule("/lib/settingsPaths.ts");
  const { ROUTE_IDS } = await vite.ssrLoadModule("/lib/routeGraph.ts");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const en = lookup(EN);
  const ids = (groups) => groups.flatMap((g) => g.entries.map((e) => e.id));
  const entries = registry.SETTINGS_REGISTRY;

  await t.test(
    "change-driving: every entry is unique, opens a real place and is labelled in English",
    () => {
      const seen = new Set();
      const anchors = new Set();
      for (const e of entries) {
        assert.ok(!seen.has(e.id), `duplicate id ${e.id}`);
        seen.add(e.id);
        const anchor = registry.anchorIdFor(e);
        assert.ok(!anchors.has(anchor), `duplicate anchor ${anchor}`);
        anchors.add(anchor);
        const [head, sub] = e.path.split("/");
        const loc = parseSettingsPath(e.path);
        assert.equal(loc.section, SECTION_OF[head], `${e.id}: ${e.path} opens ${SECTION_OF[head]}`);
        assert.equal(loc.subTab, sub, `${e.id}: sub-tab ${sub ?? "(none)"} is a real tab`);
        assert.notEqual(en(e.labelKey), e.labelKey, `${e.labelKey} exists`);
        assert.notEqual(en(e.descriptionKey), e.descriptionKey, `${e.descriptionKey} exists`);
        const subKey = registry.subTabLabelKey(e);
        if (subKey) assert.notEqual(en(subKey), subKey, `${subKey} exists`);
      }
    }
  );

  await t.test("change-driving: the 11 task entries navigate to their Patchbay rows", () => {
    const routes = entries.filter((e) => e.control.kind === "route");
    assert.deepEqual(
      routes.map((e) => e.control.routeId),
      [...ROUTE_IDS]
    );
    for (const e of routes) {
      assert.equal(e.id, `route:${e.control.routeId}`);
      assert.equal(e.path, "routing");
      assert.equal(registry.anchorIdFor(e), `route-${e.control.routeId}`);
      assert.equal(typeof e.control.set, "undefined", "a route entry has no setter");
    }
  });

  await t.test("change-driving: live controls read real store values", () => {
    const state = useSettingsStore.getState();
    for (const e of entries) {
      if (e.control.kind === "toggle") assert.equal(typeof e.control.get(state), "boolean", e.id);
      if (e.control.kind === "select") {
        assert.ok(e.control.options.map((o) => o.value).includes(e.control.get(state)), e.id);
      }
    }
  });

  await t.test("change-driving: the only live writes are non-route settings (planner rule)", () => {
    const writes = [];
    const recorder = new Proxy({}, { get: (_target, name) => () => writes.push(String(name)) });
    for (const e of entries) {
      if (e.control.kind === "toggle") e.control.set(recorder, true);
      if (e.control.kind === "select") e.control.set(recorder, e.control.options[0].value);
    }
    assert.deepEqual([...new Set(writes)].sort(), [
      "setAudioCuesEnabled",
      "setAutoPasteEnabled",
      "setDataRetentionEnabled",
      "setDictationCueSet",
      "setDictationCueVolume",
      "setFloatingIconAutoHide",
      "setKeepTranscriptionInClipboard",
      "setNotificationsEnabled",
      "setNotifyCalendarReminders",
      "setNotifyMeetingDetection",
      "setSaveDiscardedTranscriptions",
      "setStartMinimized",
      "setTheme",
    ]);
    // The enable switches feed the route snapshot (enabled.cleanup / voiceAssistant / translation /
    // speakerId / screenContext): they navigate, so enabling a route to a provider stays staged.
    // None of the pinned setters above writes a provider/model/endpoint/mode field, a route switch
    // (useCleanupModel, useDictationTranslation, useDictationAgent, voiceAgentScreenContext,
    // useDictationAgentVisionModel), cortiEnvironment/cortiTenant or providerSearch:<scope>.
    for (const id of [
      "cleanupEnabled",
      "assistantEnabled",
      "screenContext",
      "translationEnabled",
      "speakerLabels",
      "supportModels",
    ]) {
      assert.equal(entries.find((e) => e.id === id).control.kind, "link", id);
    }
  });

  await t.test(
    "[source guard, change-driving] the registry and results never write provider, model, URL, mode, route-switch, Corti or web-search settings",
    () => {
      // Owner rule (owner rule 3, I1 follow-up): these keys change only through the planner
      // (Task 7 requestRouteChange/requestRoutePatch, Task 8 useRouteChange). Search offers no live
      // control for them, so it calls none of those entry points either.
      const forbidden =
        /\.set(?:\w*(?:Provider|Model|Url|Mode)\w*|UseCleanupModel|UseDictationAgent\w*|UseDictationTranslation|SpeakerDiarizationEnabled|VoiceAgentScreenContext|CortiEnvironment|CortiTenant)\b|applyRoutePatch|requestRoute(?:Change|Patch)|\brequestPatch\b|useRouteChange|ProviderSearchPreference|providerSearch:|personalWebSearch|updateTranscriptionSettings|updateCleanupSettings/;
      for (const file of ["settingsRegistry.ts", "SettingsSearchResults.tsx"]) {
        const text = fs.readFileSync(path.join(root, "src/components/settings", file), "utf8");
        assert.doesNotMatch(text, forbidden, file);
      }
    }
  );

  await t.test(
    "change-driving: search matches label, description and keywords, AND-ing tokens, label hits first",
    () => {
      assert.equal(ids(registry.searchSettings("mic", en))[0], "microphone");
      const retention = registry.searchSettings("retention", en);
      assert.deepEqual(
        retention.map((g) => g.section),
        ["privacyData"]
      );
      for (const id of ["audioRetention", "transcriptRetention", "dataRetention"])
        assert.ok(ids(retention).includes(id), id);
      // Descriptions are real page copy, so "audio retention" also reaches rows that merely mention audio;
      // the row whose label has both words ranks first.
      assert.equal(ids(registry.searchSettings("audio retention", en))[0], "audioRetention");
      assert.ok(ids(registry.searchSettings("cloud", en)).some((id) => id.startsWith("route:")));
      assert.deepEqual(registry.searchSettings("xyzzy", en), []);
      assert.deepEqual(registry.searchSettings("   ", en), []);
    }
  );

  await t.test("change-driving: search works in the user's language and ignores accents", () => {
    const de = (key) => (key === "settingsPage.general.microphone.title" ? "Mikrofon" : en(key));
    assert.equal(ids(registry.searchSettings("mikro", de))[0], "microphone");
    assert.equal(registry.normalizeForSearch("Résumé"), "resume");
  });

  await t.test(
    "change-driving: every non-route entry has an anchor in a file that renders its label",
    () => {
      const sources = walk(path.join(root, "src"));
      const hits = (id) =>
        sources.filter(
          (s) => s.text.includes(`data-setting-id="${id}"`) || s.text.includes(`settingId="${id}"`)
        );
      for (const e of entries.filter((x) => x.control.kind !== "route")) {
        const found = hits(e.id);
        assert.ok(found.length > 0, `anchor for ${e.id}`);
        assert.ok(
          found.some((s) => s.text.includes(e.labelKey)),
          `${e.id}: the file carrying the anchor (${found.map((s) => s.file).join(", ")}) must render "${e.labelKey}"`
        );
      }
      assert.ok(
        sources.some((s) => s.text.includes("data-setting-id={`route-${route.id}`}")),
        "Patchbay rows are route anchors"
      );
    }
  );
});

test("[change-driving] every locale searches its actual labels and offers working no-result suggestions", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-search-locales-" });
  const { SETTINGS_REGISTRY, searchSettings } = await vite.ssrLoadModule(
    "/components/settings/settingsRegistry.ts"
  );
  for (const lang of ["ar", "de", "en", "es", "fr", "it", "ja", "pt", "ru", "zh-CN", "zh-TW"]) {
    const locale = JSON.parse(
      fs.readFileSync(path.join(root, "src/locales", lang, "translation.json"), "utf8")
    );
    const tr = lookup(locale);
    for (const entry of SETTINGS_REGISTRY) {
      assert.notEqual(tr(entry.labelKey), entry.labelKey, `${lang} ${entry.labelKey}`);
      assert.notEqual(
        tr(entry.descriptionKey),
        entry.descriptionKey,
        `${lang} ${entry.descriptionKey}`
      );
      assert.ok(
        searchSettings(tr(entry.labelKey), tr)
          .flatMap((g) => g.entries)
          .some((e) => e.id === entry.id),
        `${lang}: ${entry.id}`
      );
    }
    // Quoted words after the query interpolation are the three actionable suggestions.
    const suggestions = [...locale.settingsSearch.none.matchAll(/[“«「„]([^”»」“]+)[”»」“]/g)]
      .map((m) => m[1].trim())
      .filter((s) => !s.includes("{{query}}"));
    assert.equal(suggestions.length, 3, lang);
    for (const suggestion of suggestions)
      assert.ok(searchSettings(suggestion, tr).length, `${lang}: ${suggestion}`);
  }
});

test("[change-driving] only gated screen context declares a visible assistant prerequisite", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-search-fallback-registry-" });
  const { SETTINGS_REGISTRY } = await vite.ssrLoadModule(
    "/components/settings/settingsRegistry.ts"
  );
  assert.deepEqual(
    SETTINGS_REGISTRY.filter((entry) => entry.fallbackAnchorId).map((entry) => [
      entry.id,
      entry.fallbackAnchorId,
    ]),
    [["screenContext", "assistantEnabled"]]
  );
});
