const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// T14-M4: Sealed mode and the flight recorder are found by settings search,
// like every other Privacy & Data row, and the result scrolls to a real anchor
// in the file that renders the label. Loaded under the tsx loader.

const root = path.join(__dirname, "../..");
const EN = JSON.parse(fs.readFileSync(path.join(root, "src/locales/en/translation.json"), "utf8"));
const en = (key) =>
  key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), EN) ?? key;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const ids = (groups) => groups.flatMap((g) => g.entries.map((e) => e.id));

test("Sealed mode and the flight recorder are searchable Privacy & Data rows", async () => {
  const registry = await import("../../src/components/settings/settingsRegistry.ts");
  const byId = new Map(registry.SETTINGS_REGISTRY.map((e) => [e.id, e]));
  for (const [id, label, description, file] of [
    [
      "sealedMode",
      "settingsPage.privacy.sealed.title",
      "settingsPage.privacy.sealed.description",
      "src/components/settings/SealedModePanel.tsx",
    ],
    [
      "flightRecorder",
      "settingsPage.privacy.recorder.title",
      "settingsPage.privacy.recorder.subtitle",
      "src/components/settings/FlightRecorderPanel.tsx",
    ],
  ]) {
    const entry = byId.get(id);
    assert.ok(entry, id);
    assert.equal(entry.path, "privacyData", id);
    assert.equal(entry.labelKey, label);
    assert.equal(entry.descriptionKey, description);
    // A link that navigates: search never toggles the seal behind main's dialog.
    assert.equal(entry.control.kind, "link", id);
    assert.notEqual(en(label), label);
    assert.notEqual(en(description), description);
    assert.equal(registry.anchorIdFor(entry), id);
    const src = read(file);
    assert.match(src, new RegExp(`data-setting-id="${id}"`), `${file} carries the anchor`);
    assert.ok(src.includes(label), `${file} renders ${label}`);
  }
  // Privacy & Data lists them first, in page order.
  const privacy = registry.SETTINGS_REGISTRY.filter((e) => e.path === "privacyData").map(
    (e) => e.id
  );
  assert.deepEqual(privacy.slice(0, 2), ["sealedMode", "flightRecorder"]);
  assert.equal(ids(registry.searchSettings("sealed", en))[0], "sealedMode");
  assert.equal(ids(registry.searchSettings("flight recorder", en))[0], "flightRecorder");
  assert.ok(ids(registry.searchSettings("egress", en)).includes("flightRecorder"));
  // Keywords make no claim either.
  for (const id of ["sealedMode", "flightRecorder"])
    assert.doesNotMatch(byId.get(id).keywords, /isolat|verified|nothing/i);
});
