const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../src/utils/gpuDetection.js"),
  "utf8"
);

test("nvidia-smi GPU probes pass windowsHide to avoid console flashes", () => {
  const matches = SOURCE.match(/execFile\(\s*"nvidia-smi"/g) || [];
  assert.equal(matches.length, 2, "expected detectNvidiaGpu and listNvidiaGpus probes");
  assert.match(
    SOURCE,
    /execFile\(\s*"nvidia-smi"[\s\S]*?\{\s*timeout:\s*5000,\s*windowsHide:\s*true\s*\}/
  );
  const hideCount = (SOURCE.match(/windowsHide:\s*true/g) || []).length;
  assert.equal(hideCount, 2, "both nvidia-smi execFile calls must set windowsHide");
});
