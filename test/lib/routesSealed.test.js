const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// Spec §5.4 (I8): src/stores/sealedStore.ts is the only renderer module that
// reads sealed state from the privacy bridge. A source ratchet beside the
// executed one-event test in nativeRouteAvailability.test.js.
test("only the sealed store reads sealed state from the privacy bridge", () => {
  const root = path.join(__dirname, "../../src");
  const offenders = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (name !== "locales") walk(full);
      } else if (
        /\.(tsx?|jsx?)$/.test(name) &&
        !full.endsWith(path.join("stores", "sealedStore.ts")) &&
        !full.includes(`${path.sep}types${path.sep}`) &&
        // Main-process modules own the bridge's other end.
        !full.includes(`${path.sep}helpers${path.sep}privacy${path.sep}`)
      ) {
        const src = fs.readFileSync(full, "utf8");
        if (
          /privacy\??\.(getSealed|onSealedChange|getAttestation|onAttestation|setSealed)\b/.test(
            src
          )
        )
          offenders.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});
