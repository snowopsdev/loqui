const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingDownload.ts");
const facts = (patch = {}) => ({
  installed: false,
  entry: null,
  cancelling: false,
  cancelled: false,
  error: null,
  lastPercent: null,
  keptBytes: null,
  samples: [],
  ...patch,
});
const entry = (patch = {}) => ({
  phase: "downloading",
  progress: 41.6,
  downloadedBytes: 264e6,
  totalBytes: 631e6,
  ...patch,
});

test("speed and ETA come from the last five seconds of real progress", async () => {
  const { estimateRate, pushSample } = await load();
  let samples = [];
  for (const [atMs, bytes] of [
    [0, 0],
    [500, 4e6],
    [1000, 8.2e6],
    [2000, 16.4e6],
  ])
    samples = pushSample(samples, { atMs, bytes });
  assert.deepEqual(estimateRate(samples, 631e6), { bytesPerSecond: 8200000, etaSeconds: 75 });
  assert.deepEqual(estimateRate(samples.slice(0, 2), 631e6), {
    bytesPerSecond: null,
    etaSeconds: null,
  });
  samples = pushSample(samples, { atMs: 7600, bytes: 50e6 });
  assert.deepEqual(
    samples,
    [{ atMs: 7600, bytes: 50e6 }],
    "samples older than five seconds leave the window"
  );
});

test("a real stall (no progress events) ages into no estimate", async () => {
  const { estimateRate, pushSample } = await load();
  let samples = pushSample(pushSample([], { atMs: 0, bytes: 0 }), { atMs: 1000, bytes: 8e6 });
  // useVoiceDownload pushes an ageing sample every second while active, with the same byte count.
  for (let atMs = 2000; atMs <= 7000; atMs += 1000)
    samples = pushSample(samples, { atMs, bytes: 8e6 });
  assert.deepEqual(estimateRate(samples, 631e6), { bytesPerSecond: null, etaSeconds: null });
  assert.deepEqual(
    pushSample(samples, { atMs: 7500, bytes: 1e6 }),
    [{ atMs: 7500, bytes: 1e6 }],
    "a restart resets"
  );
});

test("state precedence: a running entry, then cancelling, then installed, then error, then cancelled", async () => {
  const { deriveVoiceDownloadState } = await load();
  assert.deepEqual(deriveVoiceDownloadState(facts({ installed: null })), { status: "checking" });
  assert.deepEqual(deriveVoiceDownloadState(facts()), { status: "idle" });
  assert.deepEqual(deriveVoiceDownloadState(facts({ installed: true, error: "old" })), {
    status: "ready",
  });
  assert.deepEqual(deriveVoiceDownloadState(facts({ entry: entry({ phase: "installing" }) })), {
    status: "installing",
  });
  assert.deepEqual(deriveVoiceDownloadState(facts({ entry: entry(), cancelling: true })), {
    status: "cancelling",
  });
  assert.deepEqual(deriveVoiceDownloadState(facts({ cancelled: true })), { status: "cancelled" });
  assert.deepEqual(
    deriveVoiceDownloadState(
      facts({ error: "Network timeout", lastPercent: 42, keptBytes: 265e6 })
    ),
    {
      status: "error",
      message: "Network timeout",
      percent: 42,
      progressKept: true,
    }
  );
  for (const keptBytes of [0, null]) {
    assert.equal(
      deriveVoiceDownloadState(facts({ error: "HTTP 404", lastPercent: 42, keptBytes }))
        .progressKept,
      false
    );
  }
  assert.deepEqual(
    deriveVoiceDownloadState(
      facts({
        entry: entry(),
        samples: [
          { atMs: 0, bytes: 256e6 },
          { atMs: 1000, bytes: 264e6 },
        ],
      })
    ),
    {
      status: "downloading",
      percent: 42,
      downloadedBytes: 264e6,
      totalBytes: 631e6,
      bytesPerSecond: 8000000,
      etaSeconds: 46,
    }
  );
});

test("milestones announce once per quarter, never every tick", async () => {
  const { milestoneCrossed } = await load();
  assert.equal(milestoneCrossed(null, 3), null);
  assert.equal(milestoneCrossed(24, 25), 25);
  assert.equal(milestoneCrossed(25, 26), null);
  assert.equal(milestoneCrossed(10, 80), 75);
  assert.equal(milestoneCrossed(80, 100), null, "completion is announced by the ready state");
});

test("numbers are clamped and formatted for people", async () => {
  const { clampPercent, byteParts, etaParts } = await load();
  assert.deepEqual(
    [clampPercent(-3), clampPercent(41.6), clampPercent(140), clampPercent(Number.NaN)],
    [0, 42, 100, 0]
  );
  assert.deepEqual(byteParts(264e6, "en"), { value: "264", unit: "mb" });
  assert.deepEqual(byteParts(1329766560, "en"), { value: "1.3", unit: "gb" });
  assert.deepEqual(etaParts(42), { unit: "seconds", count: 45 });
  assert.deepEqual(etaParts(75), { unit: "minutes", count: 2 });
  assert.equal(etaParts(null), null);
});
