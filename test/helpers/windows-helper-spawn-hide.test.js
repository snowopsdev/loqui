const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("meeting AEC helper spawn sets windowsHide", () => {
  const src = read("src/helpers/meetingAecManager.js");
  assert.match(
    src,
    /spawn\(binaryPath,\s*\["--sample-rate"[\s\S]*?windowsHide:\s*true/
  );
});

test("text edit monitor spawns set windowsHide", () => {
  const src = read("src/helpers/textEditMonitor.js");
  const hides = (src.match(/windowsHide:\s*true/g) || []).length;
  assert.ok(hides >= 2, `expected both monitor spawns to set windowsHide, got ${hides}`);
});

test("Windows mic-listener spawn sets windowsHide", () => {
  const src = read("src/helpers/audioActivityDetector.js");
  assert.match(
    src,
    /_tryEventDrivenWin32[\s\S]*?spawn\(binaryPath,\s*\["--exclude-pid"[\s\S]*?windowsHide:\s*true/
  );
});
