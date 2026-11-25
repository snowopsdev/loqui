const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Main admits the dictation gate only from the control panel
// (ipcHandlers "onboarding-set-active"), so the dictation panel cannot delay
// it until a lazy App chunk mounts. App must therefore load with the entry
// chunk, so its recording listeners exist before any hotkey can fire.
test("the dictation panel's App is imported eagerly, not lazily", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../src/AppRouter.jsx"), "utf8");
  assert.match(source, /^import App from "\.\/App\.jsx";$/m);
  assert.doesNotMatch(source, /lazy\(\s*\(\)\s*=>\s*import\("\.\/App\.jsx"\)/);
});
