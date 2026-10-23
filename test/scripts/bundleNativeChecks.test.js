const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  checkGlibcFloor,
  dropEscapingElfSearchPaths,
  enforceGlibcFloor,
  findBundleSearchPathEscapes,
  measureGlibcFloor,
} = require("../../scripts/lib/bundle-native-checks");
const { readNativeImage } = require("../../scripts/lib/native-image");
const { elfImage, machOImage } = require("./nativeImageFixtures");

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-native-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const linked = (glibc, glibcxx) =>
  elfImage({
    needed: ["libstdc++.so.6", "libc.so.6"],
    versionNeeds: [
      { file: "libc.so.6", versions: ["GLIBC_2.2.5", ...glibc.map((v) => `GLIBC_${v}`)] },
      ...(glibcxx.length > 0
        ? [{ file: "libstdc++.so.6", versions: glibcxx.map((v) => `GLIBCXX_${v}`) }]
        : []),
    ],
  });

// The floor the bundled whisper and llama builds set today.
function writeReferences(binDir) {
  fs.writeFileSync(
    path.join(binDir, "whisper-server-linux-x64"),
    linked(["2.17", "2.34"], ["3.4.9", "3.4.30"])
  );
  fs.writeFileSync(path.join(binDir, "llama-server-linux-x64-cpu"), linked(["2.34"], ["3.4.21"]));
  fs.writeFileSync(path.join(binDir, "libllama-server-impl.so"), linked(["2.32"], ["3.4.30"]));
}

test("the glibc floor is measured from the bundled whisper and llama binaries", (t) => {
  const binDir = tempDir(t);
  assert.equal(measureGlibcFloor(binDir), null);
  writeReferences(binDir);
  assert.deepEqual(measureGlibcFloor(binDir), {
    floor: { GLIBC: "2.34", GLIBCXX: "3.4.30" },
    measuredFrom: [
      "whisper-server-linux-x64",
      "llama-server-linux-x64-cpu",
      "libllama-server-impl.so",
    ],
  });
});

test("sherpa servers may not need a newer glibc or libstdc++ than the floor", (t) => {
  const binDir = tempDir(t);
  writeReferences(binDir);
  const write = (name, image) => fs.writeFileSync(path.join(binDir, name), image);
  write("at-floor", linked(["2.34"], ["3.4.29"]));
  write("upstream", linked(["2.17"], ["3.4.19"]));
  write("glibc-2.35", linked(["2.35"], ["3.4.29"]));
  write("glibcxx-3.4.32", linked(["2.34"], ["3.4.32"]));
  write("arch-host", linked(["2.43"], ["3.4.32"]));

  const report = checkGlibcFloor(binDir, [
    "at-floor",
    "upstream",
    "glibc-2.35",
    "glibcxx-3.4.32",
    "arch-host",
  ]);
  assert.deepEqual(
    report.binaries.map(({ name, highest, exceeds }) => [name, highest, exceeds]),
    [
      ["at-floor", { GLIBC: "2.34", GLIBCXX: "3.4.29" }, []],
      ["upstream", { GLIBC: "2.17", GLIBCXX: "3.4.19" }, []],
      ["glibc-2.35", { GLIBC: "2.35", GLIBCXX: "3.4.29" }, ["GLIBC_2.35"]],
      ["glibcxx-3.4.32", { GLIBC: "2.34", GLIBCXX: "3.4.32" }, ["GLIBCXX_3.4.32"]],
      ["arch-host", { GLIBC: "2.43", GLIBCXX: "3.4.32" }, ["GLIBC_2.43", "GLIBCXX_3.4.32"]],
    ]
  );

  const logs = [];
  const sink = { log: (line) => logs.push(line), warn: (line) => logs.push(`warn ${line}`) };
  assert.throws(
    () =>
      enforceGlibcFloor(binDir, ["at-floor", "glibc-2.35"], { strict: true, label: "x", ...sink }),
    /glibc-2\.35 needs GLIBC_2\.35, above the floor GLIBC_2\.34 GLIBCXX_3\.4\.30/
  );
  assert.ok(logs.includes("x: at-floor needs GLIBC_2.34 GLIBCXX_3.4.29"), logs.join("\n"));
  assert.ok(
    logs.includes(
      "x: glibc floor GLIBC_2.34 GLIBCXX_3.4.30, measured from whisper-server-linux-x64, llama-server-linux-x64-cpu, libllama-server-impl.so"
    )
  );

  logs.length = 0;
  enforceGlibcFloor(binDir, ["glibc-2.35"], { strict: false, label: "x", ...sink });
  assert.match(
    logs.at(-1),
    /^warn x: glibc-2\.35 needs GLIBC_2\.35.*allowed outside release builds/
  );
  enforceGlibcFloor(binDir, ["at-floor"], { strict: true, label: "x", ...sink });
});

test("release builds fail when the floor cannot be measured", (t) => {
  const binDir = tempDir(t);
  fs.writeFileSync(path.join(binDir, "server"), linked(["2.17"], []));
  assert.throws(
    () => enforceGlibcFloor(binDir, ["server"], { strict: true, label: "x", log() {}, warn() {} }),
    /none of whisper-server-linux-x64, llama-server-linux-x64-cpu, libllama-server-impl\.so is in/
  );
  const warnings = [];
  assert.equal(
    enforceGlibcFloor(binDir, ["server"], {
      strict: false,
      label: "x",
      warn: (l) => warnings.push(l),
    }),
    null
  );
  assert.match(warnings[0], /skipped the glibc floor check/);
});

test("a prepared ELF file loses only its escaping search-path entries", (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, "sherpa-onnx-diarize-linux-x64");
  fs.writeFileSync(
    file,
    elfImage({
      needed: ["libonnxruntime.so", "libc.so.6"],
      rpath: "$ORIGIN:$ORIGIN/../lib:$ORIGIN/../../../sherpa_onnx/lib",
    })
  );
  assert.equal(dropEscapingElfSearchPaths(file).length, 1);
  assert.deepEqual(readNativeImage(fs.readFileSync(file)).rpath, ["$ORIGIN", "$ORIGIN/../lib"]);
  assert.deepEqual(dropEscapingElfSearchPaths(file), []);
  const script = path.join(dir, "script.sh");
  fs.writeFileSync(script, "#!/bin/sh\necho not an image, long enough to sniff\n");
  assert.deepEqual(dropEscapingElfSearchPaths(script), []);
});

test("the bundle scan reports every native image that can leave the app", (t) => {
  const root = tempDir(t);
  const put = (relative, contents) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  };
  put("resources/bin/clean", elfImage({ needed: ["libc.so.6"], runpath: "$ORIGIN" }));
  put(
    "resources/bin/upstream-diarize",
    elfImage({ needed: ["libc.so.6"], rpath: "$ORIGIN:$ORIGIN/../../../sherpa_onnx/lib" })
  );
  put(
    "resources/app.asar.unpacked/node_modules/x/build/x.node",
    elfImage({ needed: ["libc.so.6"], runpath: "/home/builder/x/lib" })
  );
  put("resources/bin/models/model.onnx", Buffer.alloc(4096, 7));
  put(
    "resources/bin/broken",
    Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 1]), Buffer.alloc(80)])
  );
  put("electron-own-lib.so", elfImage({ needed: ["libc.so.6"], rpath: "/outside/scan" }));
  fs.symlinkSync("upstream-diarize", path.join(root, "resources/bin/link"));

  assert.deepEqual(
    findBundleSearchPathEscapes(root, ["resources"]).sort((a, b) => a.file.localeCompare(b.file)),
    [
      {
        file: "resources/app.asar.unpacked/node_modules/x/build/x.node",
        problems: ['RUNPATH "/home/builder/x/lib" is absolute'],
      },
      {
        file: "resources/bin/broken",
        problems: ["could not be read: only 64-bit little-endian ELF images are supported"],
      },
      {
        file: "resources/bin/upstream-diarize",
        problems: ['RPATH "$ORIGIN/../../../sherpa_onnx/lib" climbs out of the bundle'],
      },
    ]
  );

  // macOS: @executable_path in a library may mean Contents/MacOS.
  const app = tempDir(t);
  const macFile = path.join(app, "Contents/Resources/bin/libx.dylib");
  fs.mkdirSync(path.dirname(macFile), { recursive: true });
  fs.writeFileSync(
    macFile,
    machOImage({ filetype: 6, id: "@rpath/libx.dylib", rpath: ["@executable_path/../../.."] })
  );
  assert.deepEqual(
    findBundleSearchPathEscapes(app, ["Contents/Resources"], {
      appExecutableDir: "Contents/MacOS",
    }),
    [
      {
        file: "Contents/Resources/bin/libx.dylib",
        problems: ['arm64 LC_RPATH "@executable_path/../../.." climbs out of the bundle'],
      },
    ]
  );
});
