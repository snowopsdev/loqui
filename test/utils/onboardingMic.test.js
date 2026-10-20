const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingMic.ts");
const devices = [
  { kind: "audioinput", deviceId: "default", label: "Default - MacBook Pro Microphone" },
  { kind: "audioinput", deviceId: "mbp", label: "MacBook Pro Microphone" },
  { kind: "audioinput", deviceId: "usb", label: "USB Mic" },
  { kind: "audiooutput", deviceId: "spk", label: "Speakers" },
];

test("only real inputs are listed, and built-in microphones are recognised", async () => {
  const { toAudioInputs } = await load();
  assert.deepEqual(toAudioInputs(devices), [
    { deviceId: "mbp", label: "MacBook Pro Microphone", isBuiltIn: true },
    { deviceId: "usb", label: "USB Mic", isBuiltIn: false },
  ]);
});

test("the picker shows the saved choice and listens to that device", async () => {
  const { toAudioInputs, micPickerModel, SYSTEM_MIC, BUILT_IN_MIC } = await load();
  const inputs = toAudioInputs(devices);
  assert.deepEqual(
    [
      micPickerModel(inputs, "system", "", "").value,
      micPickerModel(inputs, "system", "", "").previewDeviceId,
    ],
    [SYSTEM_MIC, null]
  );
  const builtIn = micPickerModel(inputs, "built-in", "", "");
  assert.deepEqual(
    [builtIn.value, builtIn.previewDeviceId, builtIn.hasBuiltIn],
    [BUILT_IN_MIC, "mbp", true]
  );
  assert.equal(micPickerModel(inputs, "specific", "usb", "USB Mic").previewDeviceId, "usb");
  assert.equal(
    micPickerModel(inputs, "specific", "old-id", "USB Mic").value,
    "usb",
    "a re-plugged device is found by its label"
  );
});

test("a saved device that is gone falls back to the system default and says so", async () => {
  const { toAudioInputs, micPickerModel, SYSTEM_MIC } = await load();
  const gone = micPickerModel(toAudioInputs(devices), "specific", "headset", "Headset");
  assert.deepEqual([gone.value, gone.previewDeviceId, gone.missing], [SYSTEM_MIC, null, true]);
  assert.equal(
    micPickerModel([], "specific", "headset", "Headset").missing,
    false,
    "not before the list has loaded"
  );
});

test("a picked value maps back to a selection mode and device", async () => {
  const { toAudioInputs, selectionFor, SYSTEM_MIC, BUILT_IN_MIC } = await load();
  const inputs = toAudioInputs(devices);
  assert.deepEqual(selectionFor(SYSTEM_MIC, inputs), { mode: "system", device: null });
  assert.deepEqual(selectionFor(BUILT_IN_MIC, inputs), { mode: "built-in", device: null });
  assert.deepEqual(selectionFor("usb", inputs), { mode: "specific", device: inputs[1] });
  assert.deepEqual(selectionFor("unplugged", inputs), { mode: "system", device: null });
});

test("communications pseudo inputs, missing built-in and ambiguous replug never invent a device", async () => {
  const { toAudioInputs, micPickerModel, SYSTEM_MIC } = await load();
  const inputs = toAudioInputs([
    ...devices,
    { kind: "audioinput", deviceId: "communications", label: "communications" },
  ]);
  assert.equal(inputs.length, 2);
  const ambiguous = [...inputs, { ...inputs[1], deviceId: "usb2" }];
  const gone = micPickerModel(ambiguous, "specific", "old", "USB Mic");
  assert.deepEqual([gone.value, gone.previewDeviceId, gone.missing], [SYSTEM_MIC, null, true]);
  assert.equal(micPickerModel([inputs[1]], "built-in", "", "").previewDeviceId, null);
  assert.equal(micPickerModel(inputs, "specific", "usb", "Old label").previewDeviceId, "usb");
});
