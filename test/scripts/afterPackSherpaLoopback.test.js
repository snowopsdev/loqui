const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Arch } = require("app-builder-lib");

const afterPack = require("../../scripts/afterPack");
const { verifyBundledSearchPaths, verifyLoopbackSherpaServers } = afterPack;
const { elfImage, fatMachOImage, machOImage } = require("./nativeImageFixtures");

const PATCHED = Buffer.from("\0Listening on: 127.0.0.1:%d\0");
const UPSTREAM = Buffer.from("\0Listening on: %d\0");
const PATCHED_RPATH = "$ORIGIN:$ORIGIN/../lib";
const UPSTREAM_RPATH = "$ORIGIN:$ORIGIN/../lib:$ORIGIN/../../../sherpa_onnx/lib";

const linuxServer = (marker, rpath = PATCHED_RPATH) =>
  elfImage({
    needed: ["libonnxruntime.so", "libstdc++.so.6", "libc.so.6"],
    rpath,
    versionNeeds: [{ file: "libc.so.6", versions: ["GLIBC_2.17", "GLIBC_2.34"] }],
    appendix: marker,
  });
// As platform CI builds it: ONNX Runtime by its unversioned install name.
const macServer = (marker, rpath = ["@loader_path", "@loader_path/../lib"]) =>
  machOImage({
    dylibs: [
      "/usr/lib/libSystem.B.dylib",
      "@rpath/libonnxruntime.dylib",
      "/usr/lib/libc++.1.dylib",
    ],
    rpath,
    appendix: marker,
  });
const macOnnxRuntime = () =>
  fatMachOImage(
    ["x86_64", "arm64"].map((arch) =>
      machOImage({ arch, filetype: 6, id: "@rpath/libonnxruntime.dylib", rpath: ["@loader_path"] })
    )
  );

function makeDir(t, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "afterpack-sherpa-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, data] of Object.entries(contents)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }
  return dir;
}

test("passes when both Parakeet servers are the loopback build", (t) => {
  const linux = makeDir(t, {
    "sherpa-onnx-ws-linux-x64": linuxServer(PATCHED),
    "sherpa-onnx-online-ws-linux-x64": linuxServer(PATCHED),
    "libonnxruntime.so": elfImage({ needed: ["libc.so.6"], rpath: "$ORIGIN" }),
  });
  assert.doesNotThrow(() => verifyLoopbackSherpaServers(linux, "linux-x64"));
  const mac = makeDir(t, {
    "sherpa-onnx-ws-darwin-arm64": macServer(PATCHED),
    "sherpa-onnx-online-ws-darwin-arm64": macServer(PATCHED),
    "libonnxruntime.dylib": macOnnxRuntime(),
  });
  assert.doesNotThrow(() => verifyLoopbackSherpaServers(mac, "darwin-arm64"));
});

test("fails when either server is the upstream wildcard build", (t) => {
  for (const [offline, online, name] of [
    [UPSTREAM, PATCHED, "sherpa-onnx-ws-darwin-arm64"],
    [PATCHED, UPSTREAM, "sherpa-onnx-online-ws-darwin-arm64"],
  ]) {
    const dir = makeDir(t, {
      "sherpa-onnx-ws-darwin-arm64": macServer(offline),
      "sherpa-onnx-online-ws-darwin-arm64": macServer(online),
      "libonnxruntime.dylib": macOnnxRuntime(),
    });
    assert.throws(
      () => verifyLoopbackSherpaServers(dir, "darwin-arm64"),
      new RegExp(`${name} is the upstream wildcard-listening build`)
    );
  }
});

test("fails when a Parakeet server is missing", (t) => {
  const dir = makeDir(t, {
    "sherpa-onnx-ws-linux-x64": linuxServer(PATCHED),
    "libonnxruntime.so": elfImage({ needed: ["libc.so.6"], rpath: "$ORIGIN" }),
  });
  assert.throws(
    () => verifyLoopbackSherpaServers(dir, "linux-x64"),
    /missing .*sherpa-onnx-online-ws-linux-x64/
  );
});

test("fails unless the ONNX Runtime each server loads ships under that name", (t) => {
  // Only a versioned file: the servers load @rpath/libonnxruntime.dylib.
  const mac = makeDir(t, {
    "sherpa-onnx-ws-darwin-arm64": macServer(PATCHED),
    "sherpa-onnx-online-ws-darwin-arm64": macServer(PATCHED),
    "libonnxruntime.1.28.2.dylib": macOnnxRuntime(),
  });
  assert.throws(
    () => verifyLoopbackSherpaServers(mac, "darwin-arm64"),
    /sherpa-onnx-ws-darwin-arm64 loads libonnxruntime\.dylib, which did not ship beside it/
  );
  const linux = makeDir(t, {
    "sherpa-onnx-ws-linux-x64": linuxServer(PATCHED),
    "sherpa-onnx-online-ws-linux-x64": linuxServer(PATCHED),
  });
  assert.throws(
    () => verifyLoopbackSherpaServers(linux, "linux-x64"),
    /loads libonnxruntime\.so, which did not ship beside it/
  );
  const text = makeDir(t, {
    "sherpa-onnx-ws-linux-x64": Buffer.concat([PATCHED, Buffer.alloc(80, 32)]),
    "sherpa-onnx-online-ws-linux-x64": linuxServer(PATCHED),
  });
  assert.throws(
    () => verifyLoopbackSherpaServers(text, "linux-x64"),
    /does not load an ONNX Runtime library/
  );
});

test("refuses bundled images whose search path leaves the app", (t) => {
  const appImage = makeDir(t, {
    "resources/bin/sherpa-onnx-diarize-linux-x64": linuxServer(Buffer.alloc(0), UPSTREAM_RPATH),
    "resources/bin/sherpa-onnx-ws-linux-x64": linuxServer(PATCHED),
  });
  assert.throws(
    () => verifyBundledSearchPaths(appImage, ["resources"]),
    /resources\/bin\/sherpa-onnx-diarize-linux-x64: RPATH "\$ORIGIN\/\.\.\/\.\.\/\.\.\/sherpa_onnx\/lib" climbs out of the bundle/
  );
  // On macOS the same entry ends inside Loqui.app; an absolute one does not.
  const app = makeDir(t, {
    "Contents/Resources/bin/sherpa-onnx-diarize-darwin-arm64": macServer(Buffer.alloc(0), [
      "@loader_path",
      "@loader_path/../lib",
      "@loader_path/../../../sherpa_onnx/lib",
    ]),
  });
  const options = { appExecutableDir: "Contents/MacOS" };
  assert.doesNotThrow(() => verifyBundledSearchPaths(app, ["Contents/Resources"], options));
  fs.writeFileSync(
    path.join(app, "Contents/Resources/bin/whisper-server-darwin-arm64"),
    macServer(Buffer.alloc(0), ["@loader_path", "/usr/local/lib"])
  );
  assert.throws(
    () => verifyBundledSearchPaths(app, ["Contents/Resources"], options),
    /whisper-server-darwin-arm64: arm64 LC_RPATH "\/usr\/local\/lib" is absolute outside/
  );
});

test("the afterPack hook refuses a Linux package with an escaping search path", async (t) => {
  const glibcReference = elfImage({
    needed: ["libstdc++.so.6", "libc.so.6"],
    versionNeeds: [
      { file: "libc.so.6", versions: ["GLIBC_2.34"] },
      { file: "libstdc++.so.6", versions: ["GLIBCXX_3.4.30"] },
    ],
  });
  const appOutDir = makeDir(t, {
    loqui: "#!/bin/sh\n",
    "resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg": "ffmpeg",
    "resources/app.asar.unpacked/src/workers/onnxWorker.js": "",
    "resources/bin/sherpa-onnx-ws-linux-x64": linuxServer(PATCHED),
    "resources/bin/sherpa-onnx-online-ws-linux-x64": linuxServer(PATCHED),
    "resources/bin/sherpa-onnx-diarize-linux-x64": linuxServer(Buffer.alloc(0), UPSTREAM_RPATH),
    "resources/bin/libonnxruntime.so": elfImage({ needed: ["libc.so.6"], rpath: "$ORIGIN" }),
    "resources/bin/whisper-server-linux-x64": glibcReference,
  });
  const context = {
    electronPlatformName: "linux",
    appOutDir,
    arch: Arch.x64,
    packager: { executableName: "loqui" },
  };
  await assert.rejects(
    afterPack.default(context),
    /native images can load libraries from outside the app/
  );

  // The same package passes once the diarize binary is sanitized as
  // download-sherpa-onnx.js does.
  const { dropEscapingElfSearchPaths } = require("../../scripts/lib/bundle-native-checks");
  dropEscapingElfSearchPaths(path.join(appOutDir, "resources/bin/sherpa-onnx-diarize-linux-x64"));
  fs.renameSync(path.join(appOutDir, "loqui-app"), path.join(appOutDir, "loqui"));
  await afterPack.default(context);
});
