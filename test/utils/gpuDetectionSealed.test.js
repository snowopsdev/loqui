const test = require("node:test");
const assert = require("node:assert/strict");
const { SealedModeError } = require("../../src/helpers/privacy/egressPolicy");
const {
  detectNvidiaGpu,
  listNvidiaGpus,
  resolveNvidiaSmiPath,
  clearCache,
} = require("../../src/utils/gpuDetection.js");

// Final review m1 / T12-M10: a sealed refusal of nvidia-smi says nothing about
// the GPU. It must not be cached, so detection works again after unseal. The
// spawn guard refuses synchronously; a refusal through the callback is covered
// too. Every execFile here is an in-process fake.
const realPlatform = process.platform;
Object.defineProperty(process, "platform", { value: "linux" });
test.after(() => Object.defineProperty(process, "platform", { value: realPlatform }));
test.beforeEach(() => clearCache());

const refused = () => new SealedModeError({ task: "nativeLaunch", host: "native-nvidia-smi" });
const throwing = () => {
  throw refused();
};
const viaCallback = (_file, _args, _options, callback) =>
  process.nextTick(() => callback(refused(), ""));
const working = (_file, _args, _options, callback) =>
  process.nextTick(() => callback(null, "NVIDIA GeForce RTX 4060 Ti, 555.85, 16380, 8.9\n"));

for (const [shape, sealedImpl] of [
  ["a synchronous refusal", throwing],
  ["a callback refusal", viaCallback],
]) {
  test(`${shape} of nvidia-smi is not cached as "no GPU"`, async () => {
    const sealedResult = await detectNvidiaGpu({ execFileImpl: sealedImpl, quiet: true });
    assert.equal(sealedResult.hasNvidiaGpu, false);
    assert.equal(await resolveNvidiaSmiPath({ execFileImpl: sealedImpl, quiet: true }), null);
    assert.deepEqual(await listNvidiaGpus({ execFileImpl: sealedImpl, quiet: true }), []);
    // Unsealed: the real answer, not the sealed one.
    const after = await detectNvidiaGpu({ execFileImpl: working, quiet: true });
    assert.equal(after.hasNvidiaGpu, true);
    assert.equal(after.gpuName, "NVIDIA GeForce RTX 4060 Ti");
  });
}

// Re-review m10: the "a refusal was seen" flag belongs to one detection call.
// A detection that starts while another is unwinding a sealed refusal must not
// reset the other's flag and let it cache a sealed "no GPU".
test("a concurrent detection cannot make another cache a sealed refusal", async () => {
  const pending = [];
  const parked = (_file, _args, _options, callback) => pending.push(callback);
  const detecting = detectNvidiaGpu({ execFileImpl: parked, quiet: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 1, "detection is waiting on its nvidia-smi probe");
  // The probe is refused, and a list starts before detection resumes.
  pending.shift()(refused(), "");
  const listing = listNvidiaGpus({ execFileImpl: parked, quiet: true });
  assert.equal((await detecting).hasNvidiaGpu, false);
  await new Promise((resolve) => setImmediate(resolve));
  pending.shift()(refused(), "");
  assert.deepEqual(await listing, []);
  // Unsealed: neither sealed answer was cached.
  const after = await detectNvidiaGpu({ execFileImpl: working, quiet: true });
  assert.equal(after.hasNvidiaGpu, true);
  const listingWorks = (_file, args, _options, callback) =>
    process.nextTick(() =>
      callback(
        null,
        args[0] === "--query-gpu=name"
          ? "NVIDIA\n"
          : "0, GPU-1, NVIDIA GeForce RTX 4060 Ti, 16380\n"
      )
    );
  assert.equal((await listNvidiaGpus({ execFileImpl: listingWorks, quiet: true })).length, 1);
});
