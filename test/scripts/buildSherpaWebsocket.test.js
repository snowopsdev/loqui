const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  PATCH_PATH,
  SOURCE_URL,
  cmakeConfigureArgs,
  computeBuildStamp,
  parseElfDynamic,
  parseMachOLinkage,
  readCmakeOnnxRuntimePin,
  verifyLinkage,
  verifyOnnxRuntime,
} = require("../../scripts/build-sherpa-websocket");
const { MACOS_ARM64_ONNXRUNTIME } = require("../../scripts/download-sherpa-onnx");
const { LOOPBACK_LISTEN_MARKER } = require("../../src/helpers/sherpaLoopback");
const manifest = require("../../runtime-assets.json");

const READELF_OUTPUT = `
Dynamic section at offset 0x2b0d20 contains 31 entries:
  Tag        Type                         Name/Value
 0x0000000000000001 (NEEDED)             Shared library: [libonnxruntime.so]
 0x0000000000000001 (NEEDED)             Shared library: [libm.so.6]
 0x0000000000000001 (NEEDED)             Shared library: [libstdc++.so.6]
 0x0000000000000001 (NEEDED)             Shared library: [libgcc_s.so.1]
 0x0000000000000001 (NEEDED)             Shared library: [libc.so.6]
 0x000000000000000f (RPATH)              Library rpath: [$ORIGIN:$ORIGIN/../lib:$ORIGIN/../../../sherpa_onnx/lib]
 0x000000000000000c (INIT)               0x2b000
`;

const OTOOL_L = `sherpa-onnx-offline-websocket-server:
\t@rpath/libonnxruntime.1.28.2.dylib (compatibility version 0.0.0, current version 1.28.2)
\t/usr/lib/libc++.1.dylib (compatibility version 1.0.0, current version 1900.180.0)
\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)
`;

const OTOOL_LC = `Load command 14
          cmd LC_RPATH
      cmdsize 32
         path @loader_path (offset 12)
Load command 15
          cmd LC_RPATH
      cmdsize 40
         path @loader_path/../lib (offset 12)
Load command 16
          cmd LC_FUNCTION_STARTS
`;

const linuxLinkage = () => parseElfDynamic(READELF_OUTPUT);
const macLinkage = () => parseMachOLinkage(OTOOL_L, OTOOL_LC);

test("the patch moves both pinned listeners to 127.0.0.1 and announces it", () => {
  const patch = fs.readFileSync(PATCH_PATH, "utf8");
  const files = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]).sort();
  assert.deepEqual(files, [
    "sherpa-onnx/csrc/offline-websocket-server-impl.cc",
    "sherpa-onnx/csrc/offline-websocket-server.cc",
    "sherpa-onnx/csrc/online-websocket-server-impl.cc",
    "sherpa-onnx/csrc/online-websocket-server.cc",
  ]);
  const removed = patch.match(/^-\s+server_\.listen\(.*$/gm);
  const added = patch.match(/^\+\s+server_\.listen\(.*$/gm);
  assert.deepEqual(removed, Array(2).fill("-  server_.listen(asio::ip::tcp::v4(), port);"));
  assert.deepEqual(
    added,
    Array(2).fill(
      "+  server_.listen(asio::ip::tcp::endpoint(asio::ip::address_v4::loopback(), port));"
    )
  );
  const announced = patch.match(/^\+.*SHERPA_ONNX_LOGE\("Listening on: .*$/gm);
  assert.equal(announced.length, 2);
  for (const line of announced) assert.ok(line.includes(`"${LOOPBACK_LISTEN_MARKER}%d"`), line);
});

test("the pinned source archive is checksummed in runtime-assets.json", () => {
  const asset = manifest.assets.find((entry) => entry.url === SOURCE_URL);
  assert.ok(asset, SOURCE_URL);
  assert.equal(asset.hashKind, "tar-contents-v1");
  assert.match(asset.sha256, /^[0-9a-f]{64}$/);
  assert.equal(asset.revision, SOURCE_URL.match(/archive\/([0-9a-f]{40})\.tar\.gz$/)[1]);
});

test("configure arguments keep the shipped runtime layout on both release targets", () => {
  const linux = cmakeConfigureArgs("linux-x64", "/src", "/build");
  for (const arg of [
    "Unix Makefiles",
    "-DBUILD_SHARED_LIBS=ON",
    "-DSHERPA_ONNX_ENABLE_WEBSOCKET=ON",
    "-DSHERPA_ONNX_USE_PRE_INSTALLED_ONNXRUNTIME_IF_AVAILABLE=OFF",
    "-DCMAKE_BUILD_WITH_INSTALL_RPATH=ON",
    "-DCMAKE_EXE_LINKER_FLAGS=-Wl,--disable-new-dtags",
  ])
    assert.ok(linux.includes(arg), arg);
  assert.ok(!linux.some((arg) => arg.startsWith("-DCMAKE_OSX_")));

  const mac = cmakeConfigureArgs("darwin-arm64", "/src", "/build");
  assert.ok(mac.includes("-DCMAKE_OSX_ARCHITECTURES=arm64"));
  assert.ok(mac.includes("-DCMAKE_OSX_DEPLOYMENT_TARGET=15.5"));
  assert.ok(!mac.some((arg) => arg.includes("disable-new-dtags")));
});

test("the build stamp changes with the patch, the builder, the pin and the target", () => {
  const base = {
    platformArch: "linux-x64",
    configureArgs: ["-S", "/src"],
    patch: Buffer.from("patch"),
    builder: Buffer.from("builder"),
    sourceAsset: { url: SOURCE_URL, sha256: "a".repeat(64) },
  };
  const stamp = computeBuildStamp(base);
  assert.equal(computeBuildStamp({ ...base }), stamp);
  for (const change of [
    { patch: Buffer.from("patch2") },
    { builder: Buffer.from("builder2") },
    { sourceAsset: { url: SOURCE_URL, sha256: "b".repeat(64) } },
    { platformArch: "darwin-arm64" },
    { configureArgs: ["-S", "/other"] },
  ])
    assert.notEqual(computeBuildStamp({ ...base, ...change }), stamp, JSON.stringify(change));
});

test("linkage parsing reads ELF and Mach-O dependencies and rpaths", () => {
  assert.deepEqual(linuxLinkage(), {
    dependencies: [
      "libonnxruntime.so",
      "libm.so.6",
      "libstdc++.so.6",
      "libgcc_s.so.1",
      "libc.so.6",
    ],
    rpath: ["$ORIGIN", "$ORIGIN/../lib", "$ORIGIN/../../../sherpa_onnx/lib"],
    runpath: [],
  });
  assert.deepEqual(macLinkage(), {
    dependencies: [
      "@rpath/libonnxruntime.1.28.2.dylib",
      "/usr/lib/libc++.1.dylib",
      "/usr/lib/libSystem.B.dylib",
    ],
    rpath: ["@loader_path", "@loader_path/../lib"],
    runpath: [],
  });
});

test("linkage must load only the shipped ONNX Runtime from beside the server", () => {
  const linuxShipped = ["libonnxruntime.so", "libsherpa-onnx-c-api.so"];
  assert.equal(
    verifyLinkage({
      platformArch: "linux-x64",
      linkage: linuxLinkage(),
      shippedFiles: linuxShipped,
    }),
    "libonnxruntime.so"
  );
  assert.equal(
    verifyLinkage({
      platformArch: "darwin-arm64",
      linkage: macLinkage(),
      shippedFiles: ["libonnxruntime.1.28.2.dylib", "libonnxruntime.dylib"],
    }),
    "libonnxruntime.1.28.2.dylib"
  );

  const rejects = (platformArch, linkage, shippedFiles, pattern) =>
    assert.throws(() => verifyLinkage({ platformArch, linkage, shippedFiles }), pattern);
  const linux = (changes) => ({ ...linuxLinkage(), ...changes });

  rejects(
    "linux-x64",
    linux({ dependencies: [...linuxLinkage().dependencies, "libsherpa-onnx-core.so"] }),
    linuxShipped,
    /unexpected dependency libsherpa-onnx-core\.so/
  );
  rejects("linux-x64", linuxLinkage(), ["libsherpa-onnx-c-api.so"], /does not ship/);
  rejects("linux-x64", linux({ dependencies: ["libc.so.6"] }), linuxShipped, /found 0/);
  rejects(
    "linux-x64",
    linux({ rpath: [], runpath: ["$ORIGIN"] }),
    linuxShipped,
    /uses RUNPATH \(\$ORIGIN\); expected RPATH/
  );
  rejects("linux-x64", linux({ rpath: ["$ORIGIN", "/../lib"] }), linuxShipped, /must stay under/);
  rejects("linux-x64", linux({ rpath: [] }), linuxShipped, /\(none\) must stay under/);
  rejects(
    "darwin-arm64",
    {
      ...macLinkage(),
      dependencies: ["/usr/local/lib/libonnxruntime.dylib", "/usr/lib/libSystem.B.dylib"],
    },
    ["libonnxruntime.dylib"],
    /unexpected dependency \/usr\/local\/lib\/libonnxruntime\.dylib/
  );
});

test("the cmake ONNX Runtime pin is read from sherpa-onnx's own pin file", () => {
  assert.deepEqual(
    readCmakeOnnxRuntimePin(`
set(onnxruntime_URL  "${MACOS_ARM64_ONNXRUNTIME.url}")
set(onnxruntime_HASH "SHA256=${MACOS_ARM64_ONNXRUNTIME.sha256}")
`),
    { url: MACOS_ARM64_ONNXRUNTIME.url, sha256: MACOS_ARM64_ONNXRUNTIME.sha256 }
  );
  assert.equal(readCmakeOnnxRuntimePin('set(onnxruntime_URL "x")'), null);
});

test("the build's ONNX Runtime must be the one the app ships", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sherpa-ws-ort-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sourceDir = path.join(dir, "src");
  const buildDir = path.join(dir, "build");
  const binDir = path.join(dir, "bin");
  const builtLib = path.join(buildDir, "_deps", "onnxruntime-src", "lib");
  for (const directory of [path.join(sourceDir, "cmake"), builtLib, binDir])
    fs.mkdirSync(directory, { recursive: true });

  const linux = { platformArch: "linux-x64", runtimeName: "libonnxruntime.so" };
  const common = { sourceDir, buildDir, binDir, marker: {} };
  fs.writeFileSync(path.join(builtLib, "libonnxruntime.so"), "ort 1.28.2");
  fs.writeFileSync(path.join(binDir, "libonnxruntime.so"), "ort 1.28.2");
  verifyOnnxRuntime({ ...common, ...linux });
  fs.writeFileSync(path.join(binDir, "libonnxruntime.so"), "ort 1.23.2");
  assert.throws(() => verifyOnnxRuntime({ ...common, ...linux }), /differs from the shipped/);

  const pinFile = path.join(sourceDir, "cmake", "onnxruntime-osx-arm64.cmake");
  const mac = {
    ...common,
    platformArch: "darwin-arm64",
    runtimeName: "libonnxruntime.1.28.2.dylib",
    marker: { onnxRuntime: MACOS_ARM64_ONNXRUNTIME.marker },
  };
  const writePin = (url, sha256) =>
    fs.writeFileSync(
      pinFile,
      `set(onnxruntime_URL  "${url}")\nset(onnxruntime_HASH "SHA256=${sha256}")\n`
    );
  writePin(MACOS_ARM64_ONNXRUNTIME.url, MACOS_ARM64_ONNXRUNTIME.sha256);
  verifyOnnxRuntime(mac);
  assert.throws(
    () => verifyOnnxRuntime({ ...mac, marker: {} }),
    /shipped ONNX Runtime is unmarked/
  );
  assert.throws(
    () => verifyOnnxRuntime({ ...mac, runtimeName: "libonnxruntime.1.23.2.dylib" }),
    /expected libonnxruntime\.1\.28\.2\.dylib/
  );
  writePin(MACOS_ARM64_ONNXRUNTIME.url, "0".repeat(64));
  assert.throws(() => verifyOnnxRuntime(mac), /not the shipped one/);
});
