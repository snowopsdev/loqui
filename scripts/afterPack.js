// electron-builder afterPack hook
//
// Runs after electron-builder assembles the output directory but before the
// final installer (DMG/NSIS/AppImage) is created. Operates only on the output
// directory — never touches source node_modules/.
//
// 1. Strips non-target platform/arch binaries from onnxruntime-node
//    (saves 150–180 MB per build).
// 2. Wraps the Linux binary in a shell script that forces XWayland, reads
//    user flags from ~/.config/loqui-snowopsdev-flags.conf, and falls back to
//    --no-sandbox where the Chromium sandbox cannot work (AppImage/tar.gz
//    on distros that restrict unprivileged user namespaces).
// 3. Fails the build if required binaries (ffmpeg-static, ps-list vendor exe,
//    onnx worker script) are missing from app.asar.unpacked/, or if the
//    Parakeet servers are not the loopback-only build.
// 4. Fails the build if any native image under resources/ can load a library
//    from outside the app (RPATH/RUNPATH/LC_RPATH or a dylib path), or if a
//    Linux sherpa-onnx executable needs a newer glibc than whisper and llama.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { Arch } = require("app-builder-lib");
const { buildLinuxWrapperScript } = require("./lib/linux-launcher");
const {
  WINDOWS_ONNXRUNTIME_PRIVATE_NAME,
  WINDOWS_ONNXRUNTIME_UPSTREAM_NAME,
} = require("./download-sherpa-onnx");
const { isLoopbackSherpaBinary } = require("../src/helpers/sherpaLoopback");
const { readNativeImage } = require("./lib/native-image");
const { enforceGlibcFloor, findBundleSearchPathEscapes } = require("./lib/bundle-native-checks");

// ---------------------------------------------------------------------------
// macOS resource binary signing
// ---------------------------------------------------------------------------

function resolveAppPath(context) {
  if (context.electronPlatformName !== "darwin") {
    return context.appOutDir;
  }

  if (context.appOutDir.endsWith(".app")) {
    return context.appOutDir;
  }

  return path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
}

function resolveResourcesDir(context) {
  return context.electronPlatformName === "darwin"
    ? path.join(resolveAppPath(context), "Contents", "Resources")
    : path.join(context.appOutDir, "resources");
}

function collectFiles(rootDir, skipDirs = new Set()) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const currentDir = queue.pop();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (skipDirs.has(fullPath)) continue;
        queue.push(fullPath);
        continue;
      }

      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function collectFrameworks(rootDir) {
  if (!fs.existsSync(rootDir)) return [];

  const out = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const currentDir = queue.pop();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.name.endsWith(".framework")) {
        out.push(fullPath);
        // Don't descend into a framework — the bundle is signed as a unit.
        continue;
      }
      queue.push(fullPath);
    }
  }

  return out;
}

function isMachOBinary(filePath) {
  try {
    const description = execFileSync("file", ["-b", filePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    return description.includes("Mach-O");
  } catch {
    return false;
  }
}

function registerMacResourceBinariesForSigning(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const resourcesDir = resolveResourcesDir(context);
  const frameworks = collectFrameworks(resourcesDir);
  const skipDirs = new Set(frameworks);
  const machOFiles = collectFiles(resourcesDir, skipDirs).filter(isMachOBinary);
  const toRegister = [...frameworks, ...machOFiles];

  if (toRegister.length === 0) {
    return;
  }

  const macConfig = context.packager.platformSpecificBuildOptions;
  const existingBinaries = Array.isArray(macConfig.binaries) ? macConfig.binaries : [];

  macConfig.binaries = [...new Set([...existingBinaries, ...toRegister])];

  console.log(
    `  afterPack: registered ${frameworks.length} framework(s) and ${machOFiles.length} loose Mach-O file(s) under Contents/Resources for signing`
  );
}

// ---------------------------------------------------------------------------
// onnxruntime-node binary stripping
// ---------------------------------------------------------------------------

function stripOnnxruntimeBinaries(context) {
  const platform = context.electronPlatformName; // darwin | linux | win32
  const archName = Arch[context.arch]; // x64 | arm64 | ia32 | universal

  // Resolve the resources directory inside the packed output
  const resourcesDir = resolveResourcesDir(context);

  const onnxBinDir = path.join(
    resourcesDir,
    "app.asar.unpacked",
    "node_modules",
    "onnxruntime-node",
    "bin",
    "napi-v6"
  );

  if (!fs.existsSync(onnxBinDir)) return;

  // For universal macOS builds keep both arm64 and x64 under darwin/
  const keepArchs = archName === "universal" ? ["arm64", "x64"] : [archName];

  const platformDirs = fs.readdirSync(onnxBinDir);
  let totalRemoved = 0;

  for (const dir of platformDirs) {
    const fullPath = path.join(onnxBinDir, dir);
    if (!fs.statSync(fullPath).isDirectory()) continue;

    if (dir !== platform) {
      // Wrong platform — remove entirely
      fs.rmSync(fullPath, { recursive: true, force: true });
      totalRemoved++;
      continue;
    }

    // Right platform — strip non-target architectures
    const archDirs = fs.readdirSync(fullPath);
    for (const arch of archDirs) {
      const archPath = path.join(fullPath, arch);
      if (!fs.statSync(archPath).isDirectory()) continue;
      if (!keepArchs.includes(arch)) {
        fs.rmSync(archPath, { recursive: true, force: true });
        totalRemoved++;
      }
    }
  }

  if (totalRemoved > 0) {
    console.log(
      `  afterPack: stripped ${totalRemoved} non-target onnxruntime-node directories (keeping ${platform}/${keepArchs.join(",")})`
    );
  }
}

// ---------------------------------------------------------------------------
// Linux XWayland wrapper
// ---------------------------------------------------------------------------

function wrapLinuxBinary(context) {
  if (context.electronPlatformName !== "linux") return;

  const appDir = context.appOutDir;
  const binaryName = context.packager.executableName;
  const binaryPath = path.join(appDir, binaryName);
  const realBinaryPath = path.join(appDir, binaryName + "-app");

  fs.renameSync(binaryPath, realBinaryPath);

  fs.writeFileSync(binaryPath, buildLinuxWrapperScript(binaryName), { mode: 0o755 });
}

function verifyMeetingAecHelper(context) {
  const platform = context.electronPlatformName;
  const archName = Arch[context.arch];

  if (!["darwin", "linux", "win32"].includes(platform)) {
    return;
  }

  const binaryName = `meeting-aec-helper-${platform}-${archName}${platform === "win32" ? ".exe" : ""}`;
  const resourcesDir = resolveResourcesDir(context);
  const binaryPath = path.join(resourcesDir, "bin", binaryName);

  if (!fs.existsSync(binaryPath)) {
    console.warn(`  afterPack: missing optional meeting AEC helper (${binaryName})`);
    return;
  }

  if (platform !== "win32") {
    fs.chmodSync(binaryPath, 0o755);
  }
}

// download-sherpa-onnx.js renames the bundled ONNX Runtime so the Windows
// loader can never resolve it to C:\Windows\System32\onnxruntime.dll (#2054).
// A stray onnxruntime.dll or a missing private DLL means that step was skipped
// (stale cache, older marker) and Parakeet would die at startup for the user.
function verifyWindowsOnnxRuntimePrivatized(binDir) {
  const strayPath = path.join(binDir, WINDOWS_ONNXRUNTIME_UPSTREAM_NAME);
  if (fs.existsSync(strayPath)) {
    throw new Error(
      `afterPack: ${WINDOWS_ONNXRUNTIME_UPSTREAM_NAME} must not ship (${strayPath}) — download-sherpa-onnx.js renames it to ${WINDOWS_ONNXRUNTIME_PRIVATE_NAME}; re-run the sherpa download with --force`
    );
  }
  const privatePath = path.join(binDir, WINDOWS_ONNXRUNTIME_PRIVATE_NAME);
  if (!fs.existsSync(privatePath)) {
    throw new Error(
      `afterPack: missing ${privatePath} — the bundled ONNX Runtime was not extracted and renamed; Parakeet would die at startup on Windows`
    );
  }
}

// The ONNX Runtime file names a sherpa-onnx image loads: ELF NEEDED names, or
// Mach-O @rpath/ install names, which resolve beside it through @loader_path.
function onnxRuntimeDependencies(image) {
  const names =
    image.format === "elf"
      ? image.needed
      : image.slices.flatMap((slice) =>
          slice.dylibs
            .map((dylib) => dylib.name)
            .filter((name) => name.startsWith("@rpath/"))
            .map((name) => name.slice("@rpath/".length))
        );
  return [...new Set(names.filter((name) => name.startsWith("libonnxruntime")))];
}

// Upstream sherpa-onnx WebSocket servers listen on every IPv4 interface. The
// app refuses to start them, so shipping one would silently break Parakeet.
// Each server must also find the ONNX Runtime it loads, under that name.
function verifyLoopbackSherpaServers(binDir, platformArch) {
  for (const prefix of ["sherpa-onnx-ws", "sherpa-onnx-online-ws"]) {
    const binaryPath = path.join(binDir, `${prefix}-${platformArch}`);
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`afterPack: missing ${binaryPath} — the Parakeet server did not ship`);
    }
    if (!isLoopbackSherpaBinary(binaryPath)) {
      throw new Error(
        `afterPack: ${binaryPath} is the upstream wildcard-listening build; run scripts/build-sherpa-websocket.js after the sherpa-onnx download`
      );
    }
    const image = readNativeImage(fs.readFileSync(binaryPath));
    const runtimes = image ? onnxRuntimeDependencies(image) : [];
    if (runtimes.length === 0) {
      throw new Error(`afterPack: ${binaryPath} does not load an ONNX Runtime library`);
    }
    for (const name of runtimes) {
      if (!fs.existsSync(path.join(binDir, name))) {
        throw new Error(`afterPack: ${binaryPath} loads ${name}, which did not ship beside it`);
      }
    }
  }
}

// A search path outside the app lets whoever can write there supply a library
// (upstream sherpa-onnx's $ORIGIN/../../../sherpa_onnx/lib is /tmp in an
// AppImage). `scanDirs` are relative to `bundleRoot`.
function verifyBundledSearchPaths(bundleRoot, scanDirs, options) {
  const findings = findBundleSearchPathEscapes(bundleRoot, scanDirs, options);
  if (findings.length > 0) {
    throw new Error(
      `afterPack: native images can load libraries from outside the app:\n${findings
        .map(({ file, problems }) => `  ${file}: ${problems.join("; ")}`)
        .join("\n")}`
    );
  }
}

const LINUX_SHERPA_EXECUTABLES = [
  "sherpa-onnx-ws-linux-x64",
  "sherpa-onnx-online-ws-linux-x64",
  "sherpa-onnx-diarize-linux-x64",
];

function verifyNativeImages(context) {
  const platform = context.electronPlatformName;
  if (platform === "linux") {
    const resourcesDir = resolveResourcesDir(context);
    verifyBundledSearchPaths(context.appOutDir, [path.relative(context.appOutDir, resourcesDir)]);
    const binDir = path.join(resourcesDir, "bin");
    enforceGlibcFloor(
      binDir,
      LINUX_SHERPA_EXECUTABLES.filter((name) => fs.existsSync(path.join(binDir, name))),
      { strict: process.env.LOQUI_RELEASE_BUILD === "1", label: "  afterPack" }
    );
  } else if (platform === "darwin") {
    const appPath = resolveAppPath(context);
    verifyBundledSearchPaths(appPath, [path.relative(appPath, resolveResourcesDir(context))], {
      appExecutableDir: "Contents/MacOS",
    });
  }
}

function verifyUnpackedBinaries(context) {
  const unpackedDir = path.join(resolveResourcesDir(context), "app.asar.unpacked");
  const unpackedModulesDir = path.join(unpackedDir, "node_modules");

  const isWindows = context.electronPlatformName === "win32";

  const ffmpegPath = path.join(
    unpackedModulesDir,
    "ffmpeg-static",
    isWindows ? "ffmpeg.exe" : "ffmpeg"
  );
  if (!fs.existsSync(ffmpegPath)) {
    throw new Error(
      `afterPack: missing ${ffmpegPath} — ffmpeg-static was not unpacked from app.asar (asarUnpack/packaging failure); the packed app cannot spawn FFmpeg`
    );
  }

  const onnxWorkerPath = path.join(unpackedDir, "src", "workers", "onnxWorker.js");
  if (!fs.existsSync(onnxWorkerPath)) {
    throw new Error(
      `afterPack: missing ${onnxWorkerPath} — src/workers was not unpacked from app.asar (asarUnpack/packaging failure); the ONNX utility process would crash-loop in the packed app`
    );
  }

  // electron-builder strips *.exe from node_modules on non-Windows targets,
  // so the ps-list vendor executable only exists in Windows builds.
  if (isWindows) {
    const psListVendorDir = path.join(unpackedModulesDir, "ps-list", "vendor");
    const hasFastlist =
      fs.existsSync(psListVendorDir) &&
      fs.readdirSync(psListVendorDir).some((name) => /^fastlist-.*\.exe$/.test(name));
    if (!hasFastlist) {
      throw new Error(
        `afterPack: no fastlist-*.exe in ${psListVendorDir} — ps-list vendor executable was not unpacked from app.asar (asarUnpack/packaging failure); Windows process detection would break`
      );
    }
    verifyWindowsOnnxRuntimePrivatized(path.join(resolveResourcesDir(context), "bin"));
  } else {
    verifyLoopbackSherpaServers(
      path.join(resolveResourcesDir(context), "bin"),
      `${context.electronPlatformName}-${Arch[context.arch]}`
    );
  }

  console.log("  afterPack: verified unpacked bundled binaries");
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

exports.default = async function (context) {
  stripOnnxruntimeBinaries(context);
  wrapLinuxBinary(context);
  verifyMeetingAecHelper(context);
  verifyUnpackedBinaries(context);
  verifyNativeImages(context);
  registerMacResourceBinariesForSigning(context);
};

exports.verifyBundledSearchPaths = verifyBundledSearchPaths;
exports.verifyLoopbackSherpaServers = verifyLoopbackSherpaServers;
exports.verifyWindowsOnnxRuntimePrivatized = verifyWindowsOnnxRuntimePrivatized;
