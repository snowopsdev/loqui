const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { verifyLoopbackSherpaServers } = require("../../scripts/afterPack");

function makeBinDir(t, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "afterpack-sherpa-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(contents))
    fs.writeFileSync(path.join(dir, name), `\0${text}\0`);
  return dir;
}

const PATCHED = "Listening on: 127.0.0.1:%d";
const UPSTREAM = "Listening on: %d";

test("passes when both Parakeet servers are the loopback build", (t) => {
  const dir = makeBinDir(t, {
    "sherpa-onnx-ws-linux-x64": PATCHED,
    "sherpa-onnx-online-ws-linux-x64": PATCHED,
  });
  assert.doesNotThrow(() => verifyLoopbackSherpaServers(dir, "linux-x64"));
});

test("fails when either server is the upstream wildcard build", (t) => {
  for (const [offline, online, name] of [
    [UPSTREAM, PATCHED, "sherpa-onnx-ws-darwin-arm64"],
    [PATCHED, UPSTREAM, "sherpa-onnx-online-ws-darwin-arm64"],
  ]) {
    const dir = makeBinDir(t, {
      "sherpa-onnx-ws-darwin-arm64": offline,
      "sherpa-onnx-online-ws-darwin-arm64": online,
    });
    assert.throws(
      () => verifyLoopbackSherpaServers(dir, "darwin-arm64"),
      new RegExp(`${name} is the upstream wildcard-listening build`)
    );
  }
});

test("fails when a Parakeet server is missing", (t) => {
  const dir = makeBinDir(t, { "sherpa-onnx-ws-linux-x64": PATCHED });
  assert.throws(
    () => verifyLoopbackSherpaServers(dir, "linux-x64"),
    /missing .*sherpa-onnx-online-ws-linux-x64/
  );
});
