const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.join(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");

// Source guards (not behaviour): the three pickers are too large to mount, so these
// pin the wiring that the mounted grid, hook and mapper tests cannot reach.
test("[source guard] ReasoningModelSelector maps registry models through toLocalProviders (M2, change-driving)", () => {
  const source = read("src/components/ReasoningModelSelector.tsx");
  assert.match(source, /toLocalProviders\(modelRegistry\.getAllProviders\(\)\)/);
  assert.doesNotMatch(
    source,
    /specUrl: model\.hfRepo/,
    "no hand-written mapper that can drop fields"
  );
  // Task 9's commit path stays: the grid's picks reach handleModelSelect, which calls onCommit.
  assert.match(source, /<LocalModelPicker[\s\S]*?onModelSelect=\{handleModelSelect\}/);
});

test("[source guard] LocalModelPicker renders cartridges and never writes provider or model fields (change-driving)", () => {
  const source = read("src/components/LocalModelPicker.tsx");
  assert.match(source, /<ModelCartridgeGrid/);
  assert.doesNotMatch(source, /<ModelCardList/);
  assert.match(
    source,
    /onSelect=\{selectModel\}/,
    "a card pick takes the picker's existing selectModel path"
  );
  // Picks leave only through the onModelSelect/onProviderSelect props; after Task 9 the
  // parent sends them to the planner (owner rule 3). The picker reads no store.
  assert.doesNotMatch(source, /useSettingsStore|requestRouteChange|applyRoutePatch/);
});

test("[source guard] TranscriptionModelPicker renders cartridges that commit through Task 9's handlers (change-driving)", () => {
  const source = read("src/components/TranscriptionModelPicker.tsx");
  assert.doesNotMatch(source, /LocalModelCard/);
  assert.equal(
    (source.match(/<ModelCartridgeGrid/g) ?? []).length,
    2,
    "whisper and parakeet/cohere"
  );
  assert.match(source, /onSelect=\{handleWhisperModelSelect\}/);
  assert.match(source, /onSelect=\{handleParakeetModelSelect\}/);
  // The auto-select after a download uses the same handlers, so it is planned too.
  assert.match(source, /handleWhisperModelSelect\(downloadedId\)/);
  assert.match(source, /handleParakeetModelSelect\(downloadedId\)/);
  assert.match(
    source,
    /onCommit\(\{ mode: "local", provider: "whisper", model: modelId \}\)/,
    "Task 9's handler body"
  );
});

test("change-driving: [source guard] total memory is exposed end to end: main, preload, types", () => {
  assert.match(
    read("src/helpers/ipcHandlers.js"),
    /ipcMain\.handle\("get-total-memory", \(\) => os\.totalmem\(\)\)/
  );
  assert.match(
    read("preload.js"),
    /getTotalMemory: \(\) => ipcRenderer\.invoke\("get-total-memory"\)/
  );
  assert.match(read("src/types/electron.ts"), /getTotalMemory\?: \(\) => Promise<number>/);
});

test("change-driving: [source guard] curated tiers are optional on the registry definition", () => {
  const source = read("src/models/ModelRegistry.ts");
  const definition = source.slice(
    source.indexOf("export interface ModelDefinition"),
    source.indexOf("export interface LocalProviderData")
  );
  assert.match(definition, /speedTier\?: number;/);
  assert.match(definition, /qualityTier\?: number;/);
});

test("change-driving: every locale carries the cartridge copy, with the placeholders each string needs", () => {
  const dir = path.join(repoRoot, "src/locales");
  for (const lang of fs
    .readdirSync(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, "translation.json")))) {
    const c = JSON.parse(read(`src/locales/${lang}/translation.json`)).cartridge;
    for (const key of [
      "groupLabel",
      "speechGroupLabel",
      "speed",
      "quality",
      "memory",
      "meter",
      "estimate",
      "context",
      "tight",
      "tooLarge",
      "notDownloaded",
      "download",
      "downloadNamed",
      "downloading",
      "cancel",
      "delete",
      "inUseBy",
      "showFewer",
    ])
      assert.ok(c[key], `${lang} ${key}`);
    assert.match(
      c.meter,
      /\{\{label\}\}.*\{\{value\}\}|\{\{value\}\}.*\{\{label\}\}/,
      `${lang} meter`
    );
    assert.match(
      c.tooLarge,
      /\{\{needs\}\}.*\{\{total\}\}|\{\{total\}\}.*\{\{needs\}\}/,
      `${lang} tooLarge`
    );
    assert.match(c.context, /\{\{k\}\}/, `${lang} context`);
    const plural = Object.keys(c).filter((k) => k.startsWith("showAll_"));
    assert.ok(plural.length >= 1, `${lang} showAll plural forms`);
    for (const key of plural) assert.match(c[key], /\{\{count\}\}/, `${lang} ${key}`);
  }
});
