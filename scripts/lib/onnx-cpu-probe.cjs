const assert = require("node:assert/strict");

// Original, weight-free ONNX fixture: Identity(input: float[4]) -> output: float[4].
// IR 8 / opset 13. Stored as protobuf bytes so CI needs no model download or compiler.
const IDENTITY_MODEL = Buffer.from(
  "08083a570a190a05696e70757412066f757470757422084964656e74697479120f4c6f717569204350552070726f62655a130a05696e707574120a0a08080112040a02080462140a066f7574707574120a0a08080112040a0208044202100d",
  "hex"
);

async function probeOnnxCpu(packagePath) {
  process.env.ORT_DISABLE_TELEMETRY = "1";
  const ort = require(packagePath);
  const session = await ort.InferenceSession.create(IDENTITY_MODEL, {
    executionProviders: ["cpu"],
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
  });
  try {
    const input = [1, -2, 3.5, 4];
    const output = await session.run({
      input: new ort.Tensor("float32", new Float32Array(input), [4]),
    });
    assert.deepEqual(output.output.dims, [4]);
    assert.deepEqual(Array.from(output.output.data), input);
    return ort.env.versions.node;
  } finally {
    await session.release();
  }
}

module.exports = { probeOnnxCpu };
