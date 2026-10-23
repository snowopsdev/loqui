const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { SealedModeError } = require("../../src/helpers/privacy/egressPolicy");

// Final review m1 / T12-M10: a sealed refusal of the PipeWire helper probe is
// not a capability answer. It is not cached, so meeting system audio works
// again after unseal. The probe is an in-process fake: nothing is launched.
const managerPath = require.resolve("../../src/helpers/linuxPortalAudioManager");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent?.filename === managerPath && request === "./debugLogger")
    return { warn() {}, info() {}, debug() {}, error() {} };
  return originalLoad.call(this, request, parent, isMain);
};
const LinuxPortalAudioManager = require(managerPath);
Module._load = originalLoad;

test("a sealed probe refusal is not cached as unavailable", async (t) => {
  const realPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "linux" });
  t.after(() => Object.defineProperty(process, "platform", { value: realPlatform }));
  const manager = new LinuxPortalAudioManager();
  let probes = 0;
  let sealed = true;
  manager._probeCapability = async () => {
    probes++;
    if (sealed) throw new SealedModeError({ task: "nativeLaunch", host: "native-helper" });
    return manager._buildCapability({
      ok: true,
      supportsSystemAudio: true,
      supportsNativeCapture: true,
    });
  };
  assert.equal((await manager.getCapability()).available, false);
  sealed = false;
  assert.equal((await manager.getCapability()).available, true);
  assert.equal(probes, 2);
  // An ordinary answer is still cached.
  assert.equal((await manager.getCapability()).available, true);
  assert.equal(probes, 2);
});
