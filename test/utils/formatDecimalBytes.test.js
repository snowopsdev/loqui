const assert = require("node:assert/strict");
const test = require("node:test");
const load = () => import("../../src/utils/formatBytes.ts");

test("[change-driving] decimal sizes match what model hosts publish", async () => {
  const { formatDecimalBytes } = await load();
  assert.equal(formatDecimalBytes(34_800_000), "34.8 MB");
  assert.equal(formatDecimalBytes((6.6 + 28.2) * 1_000_000), "34.8 MB");
  assert.equal(formatDecimalBytes(91_000_000), "91 MB");
  assert.equal(formatDecimalBytes(1_329_766_560), "1.3 GB");
  assert.equal(formatDecimalBytes(999), "999 B");
  assert.equal(formatDecimalBytes(1_000), "1 KB");
});

test("[change-driving] unusable sizes read as zero rather than NaN", async () => {
  const { formatDecimalBytes } = await load();
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(formatDecimalBytes(bad), "0 MB");
  }
});

test("[baseline guard] the binary formatter is unchanged", async () => {
  const { formatBytes } = await load();
  assert.equal(formatBytes(1024), "1 KB");
});
