const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { probeRuntimeVersion } = require("./lib/package-runtime-probe.cjs");
const mac = process.platform === "darwin";
const root = mac ? "dist/mac-arm64/Loqui.app/Contents" : "dist/linux-unpacked";
const resources = path.join(root, mac ? "Resources" : "resources");
const binary = path.join(root, mac ? "MacOS/Loqui" : "loqui-app");
const script = path.resolve(".cache/package-probe.cjs");
fs.mkdirSync(path.dirname(script), { recursive: true });
fs.writeFileSync(
  script,
  `const assert=require('node:assert/strict');
const Sqlite=require(${JSON.stringify(path.resolve(resources, "app.asar/node_modules/better-sqlite3"))});
const db=new Sqlite(':memory:');
assert.equal(db.prepare('select 42 as n').get().n,42);
db.close();
console.log('Packaged SQLite OK',process.arch);
const {Entry}=require(${JSON.stringify(path.resolve(resources, "app.asar/node_modules/@napi-rs/keyring"))});
assert.equal(typeof Entry,'function');
assert.equal(typeof Entry.prototype.getPassword,'function');
assert.equal(typeof Entry.prototype.setPassword,'function');
console.log('Packaged keyring binding OK',process.arch);
const {probeOnnxCpu}=require(${JSON.stringify(path.resolve(__dirname, "lib/onnx-cpu-probe.cjs"))});
probeOnnxCpu(${JSON.stringify(path.resolve(resources, "app.asar/node_modules/onnxruntime-node"))})
  .then(version=>console.log('Packaged ONNX CPU inference OK',version,process.arch))
  .catch(error=>{console.error(error);process.exitCode=1;});`
);
execFileSync(binary, [script], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ORT_DISABLE_TELEMETRY: "1" },
  timeout: 30000,
  killSignal: "SIGKILL",
});
for (const asset of [
  "icon.png",
  "iconTemplate.png",
  "iconTemplate@2x.png",
  "iconTemplate@3x.png",
  "brand/mark.png",
]) {
  const file = path.join(resources, "src/assets", asset);
  if (!fs.existsSync(file) || fs.statSync(file).size === 0)
    throw Error(`Missing packaged Loqui artwork: ${asset}`);
  if (!fs.readFileSync(file).equals(fs.readFileSync(path.join("src/assets", asset))))
    throw Error(`Packaged Loqui artwork differs from the committed export: ${asset}`);
}
if (fs.existsSync(path.join(resources, "src/assets/brand/source")))
  throw Error("Source artwork and presentation sheets should not be bundled");
if (!mac) {
  const textMonitor = path.join(resources, "bin", "linux-text-monitor");
  if (!fs.existsSync(textMonitor) || fs.statSync(textMonitor).size === 0)
    throw Error("Missing packaged Linux text monitor");
}
for (const name of fs.readdirSync(path.join(resources, "bin"))) {
  if (
    name === "linux-text-monitor" ||
    /(whisper-server|llama-server|qdrant|meeting-aec-helper)-/.test(name)
  ) {
    const description = execFileSync("file", [path.join(resources, "bin", name)], {
      encoding: "utf8",
    });
    if (!(mac ? /arm64/ : /x86-64/).test(description))
      throw Error(`Unexpected native architecture: ${description}`);
  }
}

for (const prefix of ["llama-server-", "qdrant-"]) {
  const name = fs.readdirSync(path.join(resources, "bin")).find((n) => n.startsWith(prefix));
  if (!name) throw Error(`Missing packaged runtime: ${prefix}`);
  probeRuntimeVersion(path.resolve(resources, "bin", name));
}
