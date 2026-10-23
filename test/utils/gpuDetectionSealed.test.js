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
