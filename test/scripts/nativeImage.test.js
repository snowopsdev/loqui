const test = require("node:test");
const assert = require("node:assert/strict");
const {
  checkSearchPath,
  dropElfSearchPaths,
  findSearchPathEscapes,
  highestSymbolVersions,
  readNativeImage,
} = require("../../scripts/lib/native-image");
const { elfImage, fatMachOImage, machOImage } = require("./nativeImageFixtures");

const UPSTREAM_RPATH = "$ORIGIN:$ORIGIN/../lib:$ORIGIN/../../../sherpa_onnx/lib";
const LINUX_BIN = { format: "elf", imageDir: "resources/bin" };
const MAC_BIN = {
  format: "macho",
  imageDir: "Contents/Resources/bin",
  executableDirs: ["Contents/Resources/bin", "Contents/MacOS"],
};

test("ELF search paths must resolve inside the bundle", () => {
  for (const entry of [
    "$ORIGIN",
    "${ORIGIN}",
    "$ORIGIN/",
    "$ORIGIN/../lib", // resources/lib
    "$ORIGIN/../..", // the bundle root itself
    "${ORIGIN}/../lib",
  ]) {
    assert.equal(checkSearchPath(entry, LINUX_BIN), null, entry);
  }
  for (const [entry, reason] of [
    // From an AppImage's resources/bin this is /tmp/sherpa_onnx/lib.
    ["$ORIGIN/../../../sherpa_onnx/lib", /climbs out of the bundle/],
    ["$ORIGIN/../../..", /climbs out of the bundle/],
    ["$ORIGIN/lib/../../../../x", /climbs out of the bundle/],
    ["${ORIGIN}/../../../x", /climbs out of the bundle/],
    ["/usr/lib", /is absolute/],
    ["/tmp/sherpa_onnx/lib", /is absolute/],
    ["", /is empty/],
    ["lib", /relative to the working directory/],
    ["./", /relative to the working directory/],
    ["$LIB", /loader token/],
    ["$PLATFORM/lib", /loader token/],
    ["$ORIGIN/$PLATFORM", /loader token/],
    ["$ORIGINAL", /loader token/],
  ]) {
    assert.match(checkSearchPath(entry, LINUX_BIN) ?? "allowed", reason, entry);
  }
  // Depth matters: the same entry is fine for an image deeper in the bundle.
  assert.equal(
    checkSearchPath("$ORIGIN/../../..", { format: "elf", imageDir: "resources/a/b/c" }),
    null
  );
});

test("Mach-O search paths must resolve inside Loqui.app or SIP-protected system paths", () => {
  for (const entry of [
    "@loader_path",
    "@loader_path/../lib",
    // Contents/Resources/bin/../../../ is Loqui.app itself, so this stays inside.
    "@loader_path/../../../sherpa_onnx/lib",
    "@executable_path/../Frameworks",
    "/usr/lib/swift",
    "/System/Library/Frameworks",
  ]) {
    assert.equal(checkSearchPath(entry, MAC_BIN), null, entry);
  }
  for (const [entry, reason] of [
    ["@loader_path/../../../../sherpa_onnx/lib", /climbs out of the bundle/],
    // Escapes from Contents/MacOS, where Electron loads a library from.
    ["@executable_path/../../..", /climbs out of the bundle/],
    ["@rpath/lib", /unsupported @ prefix/],
    ["/usr/local/lib", /absolute outside the SIP-protected system paths/],
    ["/opt/homebrew/lib", /absolute outside/],
    ["/usr/libexec", /absolute outside/],
    ["lib", /relative to the working directory/],
  ]) {
    assert.match(checkSearchPath(entry, MAC_BIN) ?? "allowed", reason, entry);
  }
});

test("ELF images expose NEEDED, RPATH, RUNPATH and version requirements", () => {
  const image = readNativeImage(
    elfImage({
      needed: ["libonnxruntime.so", "libstdc++.so.6", "libc.so.6"],
      rpath: UPSTREAM_RPATH,
      runpath: "$ORIGIN",
      versionNeeds: [
        { file: "libc.so.6", versions: ["GLIBC_2.4", "GLIBC_2.34", "GLIBC_2.17", "GLIBC_PRIVATE"] },
        { file: "libstdc++.so.6", versions: ["GLIBCXX_3.4.9", "GLIBCXX_3.4.30", "CXXABI_1.3.13"] },
      ],
    })
  );
  assert.deepEqual(image, {
    format: "elf",
    needed: ["libonnxruntime.so", "libstdc++.so.6", "libc.so.6"],
    rpath: ["$ORIGIN", "$ORIGIN/../lib", "$ORIGIN/../../../sherpa_onnx/lib"],
    runpath: ["$ORIGIN"],
    versionNeeds: [
      { file: "libc.so.6", versions: ["GLIBC_2.4", "GLIBC_2.34", "GLIBC_2.17", "GLIBC_PRIVATE"] },
      { file: "libstdc++.so.6", versions: ["GLIBCXX_3.4.9", "GLIBCXX_3.4.30", "CXXABI_1.3.13"] },
    ],
  });
  // Numeric, not string, order: 2.34 > 2.4 and 3.4.30 > 3.4.9.
  assert.deepEqual(highestSymbolVersions(image), { GLIBC: "2.34", GLIBCXX: "3.4.30" });
  assert.deepEqual(findSearchPathEscapes(image, { imageDir: "resources/bin" }), [
    'RPATH "$ORIGIN/../../../sherpa_onnx/lib" climbs out of the bundle',
  ]);
  assert.deepEqual(
    findSearchPathEscapes(readNativeImage(elfImage({ needed: ["/tmp/libx.so", "libc.so.6"] })), {
      imageDir: "resources/bin",
    }),
    ['NEEDED "/tmp/libx.so" is a path, not a library name']
  );
});

test("Mach-O images expose each slice's install names, search paths and UUID", () => {
  const image = readNativeImage(
    fatMachOImage([
      machOImage({
        arch: "x86_64",
        filetype: 6,
        id: "@rpath/libonnxruntime.dylib",
        rpath: ["@loader_path"],
        uuid: "f03d123c4b2131bd9775e822fb9b1ea1",
      }),
      machOImage({
        filetype: 6,
        id: "@rpath/libonnxruntime.dylib",
        dylibs: ["/usr/lib/libc++.1.dylib", "/usr/local/lib/libfoo.dylib", "@rpath/libbar.dylib"],
        rpath: ["@loader_path", "/opt/homebrew/lib"],
        uuid: "38e898bd5cb932a7af325f9f181d2c1f",
      }),
    ])
  );
  assert.equal(image.format, "macho");
  assert.deepEqual(
    image.slices.map(({ arch, filetype, id, uuid, rpath }) => [
      arch,
      filetype,
      id?.name,
      uuid,
      rpath,
    ]),
    [
      [
        "x86_64",
        6,
        "@rpath/libonnxruntime.dylib",
        "f03d123c4b2131bd9775e822fb9b1ea1",
        ["@loader_path"],
      ],
      [
        "arm64",
        6,
        "@rpath/libonnxruntime.dylib",
        "38e898bd5cb932a7af325f9f181d2c1f",
        ["@loader_path", "/opt/homebrew/lib"],
      ],
    ]
  );
  assert.deepEqual(
    findSearchPathEscapes(image, {
      imageDir: "Contents/Resources/bin",
      appExecutableDir: "Contents/MacOS",
    }),
    [
      'arm64 LC_RPATH "/opt/homebrew/lib" is absolute outside the SIP-protected system paths',
      'arm64 dylib "/usr/local/lib/libfoo.dylib" is absolute outside the SIP-protected system paths',
    ]
  );
});

test("non-native files are not read as images", () => {
  assert.equal(readNativeImage(Buffer.from("#!/bin/sh\n".padEnd(80, " "))), null);
  // A Java class file shares the fat Mach-O magic; its next word is a class version.
  const javaClass = Buffer.alloc(80);
  javaClass.writeUInt32BE(0xcafebabe, 0);
  javaClass.writeUInt32BE(0x00000034, 4);
  assert.equal(readNativeImage(javaClass), null);
});

test("dropElfSearchPaths removes trailing escaping entries in place", () => {
  const original = elfImage({
    needed: ["libonnxruntime.so", "libc.so.6"],
    rpath: UPSTREAM_RPATH,
    versionNeeds: [{ file: "libc.so.6", versions: ["GLIBC_2.17"] }],
    symbolNames: ["main", "lib"],
  });
  const image = Buffer.from(original);
  const keep = (entry) => checkSearchPath(entry, LINUX_BIN) === null;
  assert.deepEqual(dropElfSearchPaths(image, keep), [
    {
      before: ["$ORIGIN", "$ORIGIN/../lib", "$ORIGIN/../../../sherpa_onnx/lib"],
      after: ["$ORIGIN", "$ORIGIN/../lib"],
    },
  ]);
  assert.equal(image.length, original.length);
  // One byte changed: the separator became the string's terminator.
  assert.equal([...image].filter((byte, i) => byte !== original[i]).length, 1);
  const parsed = readNativeImage(image);
  assert.deepEqual(parsed.rpath, ["$ORIGIN", "$ORIGIN/../lib"]);
  assert.deepEqual(parsed.needed, ["libonnxruntime.so", "libc.so.6"]);
  assert.deepEqual(findSearchPathEscapes(parsed, { imageDir: "resources/bin" }), []);
  assert.deepEqual(dropElfSearchPaths(image, keep), []);

  // RUNPATH is edited the same way and stays RUNPATH.
  const runpathImage = elfImage({ needed: ["libc.so.6"], runpath: UPSTREAM_RPATH });
  dropElfSearchPaths(runpathImage, keep);
  assert.deepEqual(readNativeImage(runpathImage).runpath, ["$ORIGIN", "$ORIGIN/../lib"]);
  assert.deepEqual(readNativeImage(runpathImage).rpath, []);
});

test("dropElfSearchPaths refuses edits it cannot prove safe", () => {
  const keep = (entry) => checkSearchPath(entry, LINUX_BIN) === null;
  // A linker may share string bytes; a symbol named from inside the kept part
  // would be shortened by the new terminator.
  assert.throws(
    () =>
      dropElfSearchPaths(
        elfImage({ needed: ["libc.so.6"], rpath: UPSTREAM_RPATH, symbolIntoRpath: 1 }),
        keep
      ),
    /shares bytes with ORIGIN/
  );
  assert.throws(
    () =>
      dropElfSearchPaths(
        elfImage({ needed: ["libc.so.6"], rpath: "$ORIGIN/../../../x:$ORIGIN" }),
        keep
      ),
    /cannot drop non-trailing entries/
  );
  // An empty search path would mean the working directory.
  assert.throws(
    () => dropElfSearchPaths(elfImage({ needed: ["libc.so.6"], rpath: "/tmp/x" }), keep),
    /every entry of \/tmp\/x would be dropped/
  );
});
