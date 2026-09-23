const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

test("the packaged ONNX probe executes a weight-free CPU model using the installed binding", () => {
  const helper = path.resolve(__dirname, "../../scripts/lib/onnx-cpu-probe.cjs");
  const packagePath = path.dirname(require.resolve("onnxruntime-node/package.json"));
  const output = execFileSync(
    process.execPath,
    [
      "-e",
      `require(${JSON.stringify(helper)}).probeOnnxCpu(${JSON.stringify(packagePath)})
      .then(version => console.log(JSON.stringify({version, telemetry: process.env.ORT_DISABLE_TELEMETRY})))
      .catch(error => {console.error(error); process.exitCode = 1;})`,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, ORT_DISABLE_TELEMETRY: "0" },
      timeout: 30000,
      killSignal: "SIGKILL",
    }
  );
  assert.deepEqual(JSON.parse(output), {
    version: require("onnxruntime-node/package.json").version,
    telemetry: "1",
  });
});
