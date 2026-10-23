// Checks over the native images Loqui bundles, shared by afterPack.js,
// download-sherpa-onnx.js and build-sherpa-websocket.js.
const fs = require("fs");
const path = require("path");
const {
  checkSearchPath,
  compareVersionStrings,
  dropElfSearchPaths,
  findSearchPathEscapes,
  highestSymbolVersions,
  readNativeImage,
} = require("./native-image");

// Where resources/bin lands relative to the bundle root (the Linux appOutDir).
const LINUX_BUNDLED_BIN_DIR = "resources/bin";

// Parakeet must run wherever whisper and llama already do, so these set the
// Linux glibc/libstdc++ floor. It is measured from the bundled files.
const GLIBC_FLOOR_REFERENCES = [
  "whisper-server-linux-x64",
  "llama-server-linux-x64-cpu",
  "libllama-server-impl.so",
];

function looksNative(file) {
  const header = Buffer.alloc(8);
  const fd = fs.openSync(file, "r");
  try {
    if (fs.readSync(fd, header, 0, 8, 0) < 8) return false;
  } finally {
    fs.closeSync(fd);
  }
  const little = header.readUInt32LE(0);
  const big = header.readUInt32BE(0);
  return (
    little === 0x464c457f ||
    little === 0xfeedface ||
    little === 0xfeedfacf ||
    big === 0xcafebabe ||
    big === 0xcafebabf
  );
}

function* walkFiles(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walkFiles(fullPath);
    else if (entry.isFile()) yield fullPath;
  }
}

// Every native image under `scanDirs` (relative to `bundleRoot`) that could
// load a library from outside the bundle, with the reasons. Symlinks are
// skipped; their targets are scanned where they live.
function findBundleSearchPathEscapes(bundleRoot, scanDirs, { appExecutableDir } = {}) {
  const findings = [];
  for (const scanDir of scanDirs) {
    for (const file of walkFiles(path.join(bundleRoot, scanDir))) {
      if (!looksNative(file)) continue;
      const relative = path.relative(bundleRoot, file).split(path.sep).join("/");
      let problems;
      try {
        problems = findSearchPathEscapes(readNativeImage(fs.readFileSync(file)), {
          imageDir: path.posix.dirname(relative),
          appExecutableDir,
        });
      } catch (error) {
        problems = [`could not be read: ${error.message}`];
      }
      if (problems.length > 0) findings.push({ file: relative, problems });
    }
  }
  return findings;
}

// Removes RPATH/RUNPATH entries that leave the bundle from an ELF file that
// will ship in resources/bin. Returns the edits made.
function dropEscapingElfSearchPaths(file) {
  const image = fs.readFileSync(file);
  if (readNativeImage(image)?.format !== "elf") return [];
  const changes = dropElfSearchPaths(
    image,
    (entry) => checkSearchPath(entry, { format: "elf", imageDir: LINUX_BUNDLED_BIN_DIR }) === null
  );
  if (changes.length > 0) fs.writeFileSync(file, image);
  return changes;
}

function readSymbolVersions(file) {
  const image = readNativeImage(fs.readFileSync(file));
  if (image?.format !== "elf") throw new Error(`${file} is not an ELF image`);
  return highestSymbolVersions(image);
}

// The highest GLIBC_/GLIBCXX_ versions the reference binaries in `binDir`
// need, or null when none of them is there.
function measureGlibcFloor(binDir) {
  const floor = {};
  const measuredFrom = [];
  for (const name of GLIBC_FLOOR_REFERENCES) {
    const file = path.join(binDir, name);
    if (!fs.existsSync(file)) continue;
    measuredFrom.push(name);
    for (const [family, version] of Object.entries(readSymbolVersions(file))) {
      if (!floor[family] || compareVersionStrings(version, floor[family]) > 0) {
        floor[family] = version;
      }
    }
  }
  return measuredFrom.length > 0 ? { floor, measuredFrom } : null;
}

// Each binary's highest GLIBC_/GLIBCXX_ requirement, and any that exceed the floor.
function checkGlibcFloor(binDir, names) {
  const measured = measureGlibcFloor(binDir);
  if (!measured) {
    throw new Error(`none of ${GLIBC_FLOOR_REFERENCES.join(", ")} is in ${binDir} to measure from`);
  }
  const binaries = names.map((name) => {
    const highest = readSymbolVersions(path.join(binDir, name));
    const exceeds = Object.entries(highest)
      .filter(([family, version]) => {
        const limit = measured.floor[family];
        return !limit || compareVersionStrings(version, limit) > 0;
      })
      .map(([family, version]) => `${family}_${version}`);
    return { name, highest, exceeds };
  });
  return { ...measured, binaries };
}

function formatSymbolVersions(versions) {
  return (
    ["GLIBC", "GLIBCXX"]
      .filter((family) => versions[family])
      .map((family) => `${family}_${versions[family]}`)
      .join(" ") || "none"
  );
}

// Logs each binary's requirement against the measured floor. Release builds
// (strict) fail above the floor or when it cannot be measured; elsewhere the
// host's own glibc is not a shipping floor, so it only warns.
function enforceGlibcFloor(
  binDir,
  names,
  { strict, label, log = console.log, warn = console.warn }
) {
  let report;
  try {
    report = checkGlibcFloor(binDir, names);
  } catch (error) {
    if (strict) throw error;
    warn(`${label}: skipped the glibc floor check: ${error.message}`);
    return null;
  }
  log(
    `${label}: glibc floor ${formatSymbolVersions(report.floor)}, measured from ${report.measuredFrom.join(", ")}`
  );
  for (const { name, highest } of report.binaries) {
    log(`${label}: ${name} needs ${formatSymbolVersions(highest)}`);
  }
  const over = report.binaries.filter((binary) => binary.exceeds.length > 0);
  if (over.length > 0) {
    const message = `${over
      .map(({ name, exceeds }) => `${name} needs ${exceeds.join(" ")}`)
      .join("; ")}, above the floor ${formatSymbolVersions(report.floor)}`;
    if (strict) throw new Error(message);
    warn(`${label}: ${message} (allowed outside release builds)`);
  }
  return report;
}

module.exports = {
  GLIBC_FLOOR_REFERENCES,
  LINUX_BUNDLED_BIN_DIR,
  checkGlibcFloor,
  dropEscapingElfSearchPaths,
  enforceGlibcFloor,
  findBundleSearchPathEscapes,
  formatSymbolVersions,
  measureGlibcFloor,
};
