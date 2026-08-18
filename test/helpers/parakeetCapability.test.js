const test = require("node:test");
const assert = require("node:assert/strict");

const { getParakeetCapability } = require("../../src/helpers/parakeetCapability");

test("Parakeet supports macOS at and above the packaged ONNX Runtime floor", () => {
  assert.deepEqual(getParakeetCapability({ platform: "darwin", systemVersion: "15.5" }), {
    supported: true,
  });
  assert.deepEqual(getParakeetCapability({ platform: "darwin", systemVersion: "15.6.1" }), {
    supported: true,
  });
});

test("Parakeet rejects macOS below the packaged ONNX Runtime floor", () => {
  assert.deepEqual(getParakeetCapability({ platform: "darwin", systemVersion: "12.7.6" }), {
    supported: false,
    code: "PARAKEET_UNSUPPORTED_OS",
    message:
      "Parakeet requires macOS 15.5 or later. Use Whisper or cloud transcription on this Mac.",
    minimumMacOSVersion: "15.5",
  });
});

test("Parakeet capability gating does not change Windows or Linux", () => {
  for (const platform of ["win32", "linux"]) {
    assert.deepEqual(getParakeetCapability({ platform, systemVersion: "1.0" }), {
      supported: true,
    });
  }
});
