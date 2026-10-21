const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const { rendererOptions } = require("../helpers/harness/rendererMocks");

const repoRoot = path.join(__dirname, "../..");

async function renderLabs(t, state) {
  installBrowserGlobals(t);
  globalThis.__labsState = state;
  t.after(() => delete globalThis.__labsState);
  // Inline react-i18next so Vite applies the key mock to every dependency too.
  const vite = await createRendererServer(
    t,
    rendererOptions("loqui-labs-settings-test-", {
      "/stores/settingsStore": `export const useSettingsStore = (selector) => selector(globalThis.__labsState);`,
    })
  );
  const mod = await vite.ssrLoadModule("/components/settings/LabsSettings.tsx");
  return renderToStaticMarkup(createElement(mod.default));
}

test("Labs lists The Table as a switch, off by default", async (t) => {
  const html = await renderLabs(t, { labsTable: false, setLabsTable() {} });
  assert.match(html, /settingsPage\.labs\.title/);
  assert.match(html, /settingsPage\.labs\.table\.label/);
  assert.equal((html.match(/role="switch"/g) || []).length, 1);
  assert.match(html, /aria-checked="false"/);
});

test("the store declares labsTable as a synced boolean that defaults to off", () => {
  const src = fs.readFileSync(path.join(repoRoot, "src/stores/settingsStore.ts"), "utf8");
  const set = src.slice(
    src.indexOf("const BOOLEAN_SETTINGS"),
    src.indexOf("]);", src.indexOf("const BOOLEAN_SETTINGS"))
  );
  assert.match(set, /"labsTable"/);
  assert.match(src, /labsTable: readBoolean\("labsTable", false\)/);
  assert.match(src, /setLabsTable: createBooleanSetter\("labsTable"\)/);
});

test("every locale names the Labs panel and The Table, without a local-only promise", () => {
  const dir = path.join(repoRoot, "src/locales");
  for (const lang of fs
    .readdirSync(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, "translation.json")))) {
    const labs = JSON.parse(fs.readFileSync(path.join(dir, lang, "translation.json"), "utf8"))
      .settingsPage?.labs;
    assert.ok(labs?.title && labs?.description, `${lang} labs title`);
    assert.ok(labs.table?.label && labs.table?.description, `${lang} labs.table`);
  }
  const en = JSON.parse(fs.readFileSync(path.join(dir, "en", "translation.json"), "utf8"));
  assert.match(
    en.settingsPage.labs.table.description,
    /use your chat provider/,
    "AI actions are not promised to stay local"
  );
  assert.doesNotMatch(
    en.settingsPage.labs.description,
    /stay on this device/,
    "no blanket local-only claim"
  );
});
