const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const repoRoot = path.join(__dirname, "../..");
const load = () => import("../../src/components/ui/LocalityRing.tsx");

test("ring exposes locality and label to CSS and assistive tech", async () => {
  const { LocalityRing } = await load();
  const html = renderStatic(LocalityRing, { locality: "remote", label: "Sent to OpenAI" });
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="Sent to OpenAI"/);
  assert.match(html, /data-locality="remote"/);
  assert.match(html, /<circle cx="12" cy="12" r="10.75"/);
});

test("every locality draws the same solid ring with no badge or activity state", async () => {
  const { LocalityRing } = await load();
  const rings = ["device", "network", "remote"].map((locality) =>
    renderStatic(LocalityRing, { locality, label: "x" }).replace(/data-locality="\w+"/, "")
  );
  for (const html of rings) {
    assert.doesNotMatch(html, /badge|data-active|pathLength/);
    assert.equal(html, rings[0]);
  }
});

test("hue alone carries locality: one solid stroke, no dash or orbit", () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  const ringRules = css.match(/\.locality-ring[^{]*\{[^}]*\}/g).join("\n");
  assert.match(css, /\.locality-ring\s*\{[^}]*color:\s*var\(--color-locality-device\)/);
  for (const locality of ["network", "remote"]) {
    const rule = new RegExp(
      `\\.locality-ring\\[data-locality="${locality}"\\]\\s*\\{[^}]*color:\\s*var\\(--color-locality-${locality}\\)`
    );
    assert.match(css, rule);
  }
  assert.match(
    css,
    /\.locality-ring__svg circle\s*\{[^}]*stroke:\s*currentColor;[^}]*stroke-width:\s*2;/
  );
  assert.match(
    css,
    /\.locality-ring\s*\{[^}]*transition:\s*color var\(--motion-base\) var\(--motion-ease-std\)/
  );
  assert.doesNotMatch(ringRules, /stroke-dasharray|animation|__badge/);
  assert.doesNotMatch(css, /locality-orbit/);
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
