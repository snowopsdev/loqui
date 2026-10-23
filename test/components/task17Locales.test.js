const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const read = (locale) =>
  JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../src/locales", locale, "translation.json"), "utf8")
  );
test("[change-driving] Japanese and Chinese Patchbay plurals have only reachable other forms", () => {
  for (const locale of ["ja", "zh-CN", "zh-TW"]) {
    const p = read(locale).patchbay;
    assert.deepEqual(
      Object.keys(p).filter((k) => k.startsWith("taskCount_")),
      ["taskCount_other"]
    );
    for (const family of ["label", "headline", "network"])
      assert.deepEqual(
        Object.keys(p.meter).filter((k) => k.startsWith(`${family}_`)),
        [`${family}_other`]
      );
  }
});
test("[change-driving] German composed task/place grammar and East Asian Apply intent are explicit", () => {
  const de = read("de").patchbay;
  assert.equal(de.destinations, "Ziele");
  assert.equal(
    de.hint.moved
      .replace("{{task}}", "Diktat")
      .replace("{{place}}", de.place.provider.replace("{{provider}}", "OpenAI")),
    "Diktat wird jetzt bei OpenAI ausgeführt."
  );
  assert.match(read("ja").patchbay.hint.staged, /適用するまで/);
  assert.match(read("zh-CN").patchbay.hint.staged, /应用前/);
  assert.match(read("zh-TW").patchbay.hint.staged, /套用前/);
});
