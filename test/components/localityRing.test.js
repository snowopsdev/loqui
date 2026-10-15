const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const repoRoot = path.join(__dirname, "../..");
const load = () => import("../../src/components/ui/LocalityRing.tsx");

test("ring exposes locality, label and activity to CSS and assistive tech", async () => {
  const { LocalityRing } = await load();
  const html = renderStatic(LocalityRing, {
    locality: "remote",
    label: "Sent to OpenAI",
    provider: "OpenAI",
    active: true,
  });
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="Sent to OpenAI"/);
  assert.match(html, /data-locality="remote"/);
  assert.match(html, /data-active="true"/);
  assert.match(html, /class="locality-ring__badge"[^>]*>Op</);
});

test("device and network rings never show a provider badge", async () => {
  const { LocalityRing } = await load();
  for (const locality of ["device", "network"]) {
    const html = renderStatic(LocalityRing, { locality, label: "x", provider: "OpenAI" });
    assert.doesNotMatch(html, /locality-ring__badge/, locality);
    assert.match(html, /data-active="false"/);
  }
});

test("shape carries locality; orbit only runs while active and never under reduced motion", () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  assert.match(
    css,
    /\.locality-ring\[data-locality="network"\] \.locality-ring__svg circle\s*\{[^}]*stroke-dasharray:\s*0\.5 3\.5/
  );
  assert.match(
    css,
    /\.locality-ring\[data-locality="remote"\] \.locality-ring__svg circle\s*\{[^}]*stroke-dasharray:\s*4 3/
  );
  assert.match(
    css,
    /\.locality-ring\[data-locality="remote"\]\[data-active="true"\] \.locality-ring__svg\s*\{[^}]*animation:\s*locality-orbit 6s linear infinite/
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.locality-ring__svg\s*\{\s*animation:\s*none !important;/
  );
  assert.match(css, /\.locality-ring__badge\s*\{[^}]*inset-inline-end:/);
});

test("every locale names all three localities", () => {
  const dir = path.join(repoRoot, "src/locales");
  for (const lang of fs
    .readdirSync(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, "translation.json")))) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, lang, "translation.json"), "utf8"));
    assert.ok(json.locality, `${lang} has locality`);
    for (const key of ["device", "network", "remote", "unknownProvider", "customEndpoint"])
      assert.ok(json.locality[key], `${lang}.locality.${key}`);
    assert.match(json.locality.remote, /\{\{provider\}\}/, `${lang} remote keeps the placeholder`);
  }
});
