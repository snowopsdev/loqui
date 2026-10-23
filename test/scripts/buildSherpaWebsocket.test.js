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
  parseMachOIdentity,
  parseMachOLinkage,
  readCmakeOnnxRuntimePin,
  verifyLinkage,
  verifyOnnxRuntime,
} = require("../../scripts/build-sherpa-websocket");
const { MACOS_ARM64_ONNXRUNTIME } = require("../../scripts/download-sherpa-onnx");
const { LOOPBACK_LISTEN_MARKER } = require("../../src/helpers/sherpaLoopback");
const manifest = require("../../runtime-assets.json");

// readelf -d of the patched server. Upstream's executables also carry
// $ORIGIN/../../../sherpa_onnx/lib, which the patch removes.
const readelfOutput = (rpath) => `
Dynamic section at offset 0x2b0d20 contains 31 entries:
  Tag        Type                         Name/Value
 0x0000000000000001 (NEEDED)             Shared library: [libonnxruntime.so]
 0x0000000000000001 (NEEDED)             Shared library: [libm.so.6]
 0x0000000000000001 (NEEDED)             Shared library: [libstdc++.so.6]
 0x0000000000000001 (NEEDED)             Shared library: [libgcc_s.so.1]
 0x0000000000000001 (NEEDED)             Shared library: [libc.so.6]
 0x000000000000000f (RPATH)              Library rpath: [${rpath}]
 0x000000000000000c (INIT)               0x2b000
`;
const PATCHED_ELF_RPATH = "$ORIGIN:$ORIGIN/../lib";
const UPSTREAM_ELF_RPATH = "$ORIGIN:$ORIGIN/../lib:$ORIGIN/../../../sherpa_onnx/lib";

// otool -L and -l of the macOS server as platform CI built it (run
// 39984788961): ONNX Runtime is loaded by its unversioned install name.
const OTOOL_L = `sherpa-onnx-offline-websocket-server:
\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1356.0.0)
\t@rpath/libonnxruntime.dylib (compatibility version 0.0.0, current version 0.0.0)
\t/usr/lib/libc++.1.dylib (compatibility version 1.0.0, current version 2100.43.0)
`;

const otoolRpaths = (entries) =>
  entries
    .map(
      (entry, i) => `Load command ${16 + i}
          cmd LC_RPATH
      cmdsize 32
         path ${entry} (offset 12)
`
    )
    .join("") +
  `Load command ${16 + entries.length}
      cmd LC_FUNCTION_STARTS
`;
const PATCHED_MAC_RPATH = ["@loader_path", "@loader_path/../lib"];
const UPSTREAM_MAC_RPATH = [...PATCHED_MAC_RPATH, "@loader_path/../../../sherpa_onnx/lib"];

// otool -l of libonnxruntime.dylib from the pinned arm64 zip; the shipped
// universal2 file's arm64 slice carries the same install name and UUID.
const otoolOnnxRuntime = ({ id = "@rpath/libonnxruntime.dylib", uuid }) => `Load command 4
          cmd LC_ID_DYLIB
      cmdsize 56
         name ${id} (offset 24)
   time stamp 1 Wed Dec 31 19:00:01 1969
      current version 0.0.0
compatibility version 0.0.0
Load command 8
     cmd LC_UUID
 cmdsize 24
    uuid ${uuid}
Load command 9
       cmd LC_BUILD_VERSION
`;
const PINNED_ARM64_UUID = "38E898BD-5CB9-32A7-AF32-5F9F181D2C1F";

const linuxLinkage = (rpath = PATCHED_ELF_RPATH) => parseElfDynamic(readelfOutput(rpath));
const macLinkage = (rpath = PATCHED_MAC_RPATH) => parseMachOLinkage(OTOOL_L, otoolRpaths(rpath));

test("the patch moves both pinned listeners to 127.0.0.1 and announces it", () => {
  const patch = fs.readFileSync(PATCH_PATH, "utf8");
  const files = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]).sort();
  assert.deepEqual(files, [
    "sherpa-onnx/csrc/CMakeLists.txt",
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

  // Both servers lose the out-of-app search path, and no other link line changes.
  const removedLinks = patch.match(/^-.*target_link_libraries.*$/gm);
  assert.deepEqual(removedLinks.map((line) => line.match(/\((\S+) /)[1]).sort(), [
    "sherpa-onnx-offline-websocket-server",
    "sherpa-onnx-online-websocket-server",
  ]);
  for (const line of removedLinks) assert.ok(line.includes("/../../../sherpa_onnx/lib"), line);
  assert.equal(patch.match(/^\+.*target_link_libraries.*$/gm), null);
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
    rpath: ["$ORIGIN", "$ORIGIN/../lib"],
    runpath: [],
  });
  assert.deepEqual(macLinkage(UPSTREAM_MAC_RPATH), {
    dependencies: [
      "/usr/lib/libSystem.B.dylib",
      "@rpath/libonnxruntime.dylib",
      "/usr/lib/libc++.1.dylib",
    ],
    rpath: ["@loader_path", "@loader_path/../lib", "@loader_path/../../../sherpa_onnx/lib"],
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
  // The macOS runtime ships only the unversioned name the servers load.
  assert.equal(
    verifyLinkage({
      platformArch: "darwin-arm64",
      linkage: macLinkage(),
      shippedFiles: ["libonnxruntime.dylib", "libsherpa-onnx-c-api.dylib"],
    }),
    "libonnxruntime.dylib"
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
  rejects(
    "darwin-arm64",
    macLinkage(),
    ["libonnxruntime.1.28.2.dylib"],
    /links @rpath\/libonnxruntime\.dylib, which the sherpa-onnx runtime does not ship/
  );
  rejects("linux-x64", linux({ rpath: [] }), linuxShipped, /\(none\) does not include \$ORIGIN/);
  rejects(
    "linux-x64",
    linuxLinkage(UPSTREAM_ELF_RPATH),
    linuxShipped,
    /rpath entry \$ORIGIN\/\.\.\/\.\.\/\.\.\/sherpa_onnx\/lib climbs out of the bundle; only \$ORIGIN and \$ORIGIN\/\.\.\/lib are allowed/
  );
  for (const [entry, reason] of [
    ["/../lib", "is absolute"],
    ["/tmp/sherpa_onnx/lib", "is absolute"],
    ["$ORIGIN/../..", null],
    ["$ORIGIN/lib/../../../../x", "climbs out of the bundle"],
    ["lib", "is relative to the working directory"],
    ["$LIB", "uses a loader token"],
  ]) {
    rejects(
      "linux-x64",
      linux({ rpath: ["$ORIGIN", entry] }),
      linuxShipped,
      new RegExp(`rpath entry ${entry.replace(/[$.*/]/g, "\\$&")}${reason ? ` ${reason}` : ";"}`)
    );
  }
  // Inside Loqui.app on macOS, but still not one of the two allowed entries.
  rejects(
    "darwin-arm64",
    macLinkage(UPSTREAM_MAC_RPATH),
    ["libonnxruntime.dylib"],
    /rpath entry @loader_path\/\.\.\/\.\.\/\.\.\/sherpa_onnx\/lib; only @loader_path and @loader_path\/\.\.\/lib are allowed/
  );
  rejects(
    "darwin-arm64",
    macLinkage([...PATCHED_MAC_RPATH, "/usr/local/lib"]),
    ["libonnxruntime.dylib"],
    /rpath entry \/usr\/local\/lib is absolute outside the SIP-protected system paths/
  );
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
  // The CI failure: the servers load libonnxruntime.dylib, unversioned.
  fs.writeFileSync(path.join(builtLib, "libonnxruntime.dylib"), "arm64 ort");
  fs.writeFileSync(path.join(binDir, "libonnxruntime.dylib"), "universal2 ort");
  const loadCommands = { built: { uuid: PINNED_ARM64_UUID }, shipped: { uuid: PINNED_ARM64_UUID } };
  const otoolCalls = [];
  const mac = {
    ...common,
    platformArch: "darwin-arm64",
    runtimeName: "libonnxruntime.dylib",
    marker: { onnxRuntime: MACOS_ARM64_ONNXRUNTIME.marker },
    readLoadCommands: (file, arch) => {
      otoolCalls.push([path.relative(dir, file), arch]);
      return otoolOnnxRuntime(loadCommands[file.startsWith(binDir) ? "shipped" : "built"]);
    },
  };
  const writePin = (url, sha256) =>
    fs.writeFileSync(
      pinFile,
      `set(onnxruntime_URL  "${url}")\nset(onnxruntime_HASH "SHA256=${sha256}")\n`
    );
  writePin(MACOS_ARM64_ONNXRUNTIME.url, MACOS_ARM64_ONNXRUNTIME.sha256);
  verifyOnnxRuntime(mac);
  assert.deepEqual(otoolCalls, [
    [path.join("build", "_deps", "onnxruntime-src", "lib", "libonnxruntime.dylib"), undefined],
    [path.join("bin", "libonnxruntime.dylib"), "arm64"],
  ]);
  assert.throws(
    () => verifyOnnxRuntime({ ...mac, marker: {} }),
    /shipped ONNX Runtime is unmarked/
  );
  loadCommands.shipped = { uuid: "F03D123C-4B21-31BD-9775-E822FB9B1EA1" };
  assert.throws(
    () => verifyOnnxRuntime(mac),
    /shipped libonnxruntime\.dylib arm64 slice \(UUID f03d123c4b2131bd9775e822fb9b1ea1\) is not the build's ONNX Runtime \(UUID 38e898bd5cb932a7af325f9f181d2c1f\)/
  );
  loadCommands.shipped = { id: "@rpath/libonnxruntime.1.28.2.dylib", uuid: PINNED_ARM64_UUID };
  assert.throws(
    () => verifyOnnxRuntime(mac),
    /the shipped libonnxruntime\.dylib is named @rpath\/libonnxruntime\.1\.28\.2\.dylib, not @rpath\/libonnxruntime\.dylib/
  );
  loadCommands.shipped = { uuid: PINNED_ARM64_UUID };
  fs.rmSync(path.join(binDir, "libonnxruntime.dylib"));
  assert.throws(() => verifyOnnxRuntime(mac), /libonnxruntime\.dylib does not exist/);
  fs.writeFileSync(path.join(binDir, "libonnxruntime.dylib"), "universal2 ort");
  writePin(MACOS_ARM64_ONNXRUNTIME.url, "0".repeat(64));
  assert.throws(() => verifyOnnxRuntime(mac), /not the shipped one/);
});

test("otool -l identity parsing reads the install name and UUID", () => {
  assert.deepEqual(parseMachOIdentity(otoolOnnxRuntime({ uuid: PINNED_ARM64_UUID })), {
    id: "@rpath/libonnxruntime.dylib",
    uuid: "38e898bd5cb932a7af325f9f181d2c1f",
  });
  assert.deepEqual(parseMachOIdentity(otoolRpaths(PATCHED_MAC_RPATH)), { id: null, uuid: null });
});
