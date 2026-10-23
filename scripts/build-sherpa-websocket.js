#!/usr/bin/env node
// Builds the pinned sherpa-onnx online/offline WebSocket servers from source
// with resources/patches/sherpa-onnx-loopback.patch, so they listen on
// 127.0.0.1 only. Upstream listens on every IPv4 interface and has no host
// option (checked through v2.0.0). Run after download-sherpa-onnx.js: the
// patched servers replace the upstream ones and load the ONNX Runtime that
// script installed, so the build fails unless both use the same runtime.
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { downloadFile } = require("./lib/download-utils");
const {
  BINARIES,
  BIN_DIR,
  MACOS_ARM64_ONNXRUNTIME,
  SHERPA_ONNX_VERSION,
} = require("./download-sherpa-onnx");
const { PARAKEET_MINIMUM_MACOS_VERSION } = require("../src/helpers/parakeetCapability");
const { isLoopbackSherpaBinary } = require("../src/helpers/sherpaLoopback");
const { checkSearchPath } = require("./lib/native-image");
const { LINUX_BUNDLED_BIN_DIR, enforceGlibcFloor } = require("./lib/bundle-native-checks");

const ROOT = path.join(__dirname, "..");
// The commit tagged v1.13.8; the archive is pinned in runtime-assets.json.
const SOURCE_COMMIT = "11afbd009a7f8c08f4bcf2fc1b265d0df4670fbf";
const SOURCE_URL = `https://github.com/k2-fsa/sherpa-onnx/archive/${SOURCE_COMMIT}.tar.gz`;
const PATCH_PATH = path.join(ROOT, "resources", "patches", "sherpa-onnx-loopback.patch");
const CACHE_DIR = path.join(ROOT, ".cache", "sherpa-websocket");
const SUPPORTED_TARGETS = ["linux-x64", "darwin-arm64"];
const SERVERS = [
  { target: "sherpa-onnx-offline-websocket-server", outputKey: "outputName" },
  { target: "sherpa-onnx-online-websocket-server", outputKey: "onlineOutputName" },
];

const LINUX_SYSTEM_LIBRARY =
  /^(?:(?:libc|libm|libdl|libpthread|librt|libgcc_s|libstdc\+\+)\.so(?:\.\d+)*|ld-linux-x86-64\.so\.2)$/;
const ONNXRUNTIME_LIBRARY = /^libonnxruntime(?:\.\d+)*\.(?:so|dylib)(?:\.\d+)*$/;
// The only search paths the servers may carry, which the patch leaves: beside
// the server, and a lib/ sibling that stays inside the app.
const ALLOWED_SEARCH_PATHS = {
  linux: ["$ORIGIN", "$ORIGIN/../lib"],
  darwin: ["@loader_path", "@loader_path/../lib"],
};

function cmakeConfigureArgs(platformArch, sourceDir, buildDir) {
  const prefixMaps = `-ffile-prefix-map=${sourceDir}=sherpa-onnx -ffile-prefix-map=${buildDir}=build`;
  const args = [
    "-S",
    sourceDir,
    "-B",
    buildDir,
    // Ninja runs link commands through a shell that expands $ORIGIN away.
    "-G",
    "Unix Makefiles",
    "-DCMAKE_BUILD_TYPE=Release",
    // As in upstream's *-shared archives: sherpa-onnx is linked in statically
    // and ONNX Runtime is loaded from beside the executable.
    "-DBUILD_SHARED_LIBS=ON",
    "-DSHERPA_ONNX_ENABLE_WEBSOCKET=ON",
    "-DSHERPA_ONNX_ENABLE_BINARY=ON",
    "-DSHERPA_ONNX_ENABLE_TTS=OFF",
    "-DSHERPA_ONNX_ENABLE_SPEAKER_DIARIZATION=OFF",
    "-DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF",
    "-DSHERPA_ONNX_ENABLE_PYTHON=OFF",
    "-DSHERPA_ONNX_ENABLE_TESTS=OFF",
    "-DSHERPA_ONNX_ENABLE_C_API=OFF",
    "-DSHERPA_ONNX_ENABLE_JNI=OFF",
    "-DSHERPA_ONNX_BUILD_C_API_EXAMPLES=OFF",
    // Never link a system ONNX Runtime; sherpa-onnx fetches its pinned,
    // hash-checked build, which verifyOnnxRuntime compares to the shipped one.
    "-DSHERPA_ONNX_USE_PRE_INSTALLED_ONNXRUNTIME_IF_AVAILABLE=OFF",
    "-DCMAKE_BUILD_WITH_INSTALL_RPATH=ON",
    // CMake 4 rejects some dependencies' cmake_minimum_required otherwise.
    "-DCMAKE_POLICY_VERSION_MINIMUM=3.5",
    `-DCMAKE_C_FLAGS=${prefixMaps}`,
    `-DCMAKE_CXX_FLAGS=${prefixMaps}`,
  ];
  if (platformArch === "linux-x64") {
    // DT_RPATH, like upstream: an inherited LD_LIBRARY_PATH must not swap the runtime.
    args.push("-DCMAKE_EXE_LINKER_FLAGS=-Wl,--disable-new-dtags");
  } else if (platformArch === "darwin-arm64") {
    args.push(
      "-DCMAKE_OSX_ARCHITECTURES=arm64",
      `-DCMAKE_OSX_DEPLOYMENT_TARGET=${PARAKEET_MINIMUM_MACOS_VERSION}`
    );
  }
  return args;
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function computeBuildStamp({ platformArch, configureArgs, patch, builder, sourceAsset }) {
  return sha256(
    JSON.stringify({
      platformArch,
      version: SHERPA_ONNX_VERSION,
      sourceAsset,
      configureArgs,
      patch: sha256(patch),
      builder: sha256(builder),
    })
  );
}

function parseElfDynamic(output) {
  const result = { dependencies: [], rpath: [], runpath: [] };
  for (const line of String(output).split("\n")) {
    const match = line.match(/\((NEEDED|RPATH|RUNPATH)\)[^[]*\[(.*)\]/);
    if (!match) continue;
    if (match[1] === "NEEDED") result.dependencies.push(match[2]);
    else result[match[1].toLowerCase()].push(...match[2].split(":"));
  }
  return result;
}

function parseMachOLinkage(dependencyOutput, loadCommandOutput) {
  const dependencies = String(dependencyOutput)
    .split("\n")
    .slice(1)
    .map((line) => line.trim().match(/^(\S+) \(compatibility version/)?.[1])
    .filter(Boolean);
  const rpath = [];
  const lines = String(loadCommandOutput).split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "cmd LC_RPATH") continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const match = lines[j].trim().match(/^path (.+) \(offset \d+\)$/);
      if (match) {
        rpath.push(match[1]);
        break;
      }
    }
  }
  return { dependencies, rpath, runpath: [] };
}

// The install name (LC_ID_DYLIB) and LC_UUID in `otool -l` output for one
// architecture. The UUID survives lipo and re-signing; bytes do not.
function parseMachOIdentity(loadCommandOutput) {
  const lines = String(loadCommandOutput).split("\n");
  const identity = { id: null, uuid: null };
  for (let i = 0; i < lines.length; i++) {
    const command = lines[i].trim();
    if (command !== "cmd LC_ID_DYLIB" && command !== "cmd LC_UUID") continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const line = lines[j].trim();
      const id = line.match(/^name (.+) \(offset \d+\)$/);
      const uuid = line.match(/^uuid ([0-9A-Fa-f-]{36})$/);
      if (command === "cmd LC_ID_DYLIB" && id) identity.id = id[1];
      else if (command === "cmd LC_UUID" && uuid)
        identity.uuid = uuid[1].replace(/-/g, "").toLowerCase();
      else continue;
      break;
    }
  }
  return identity;
}

function readLinkage(binaryPath, platformArch) {
  if (platformArch.startsWith("linux")) {
    return parseElfDynamic(execFileSync("readelf", ["-d", binaryPath], { encoding: "utf8" }));
  }
  return parseMachOLinkage(
    execFileSync("otool", ["-L", binaryPath], { encoding: "utf8" }),
    execFileSync("otool", ["-l", binaryPath], { encoding: "utf8" })
  );
}

// Returns the ONNX Runtime library the server loads. Anything else beyond the
// OS's own libraries, such as a libsherpa-onnx-* the archive does not ship,
// means the build no longer matches the shipped runtime.
function verifyLinkage({ platformArch, linkage, shippedFiles }) {
  const isLinux = platformArch.startsWith("linux");
  const origin = isLinux ? "$ORIGIN" : "@loader_path";
  const isSystem = (dependency) =>
    isLinux
      ? LINUX_SYSTEM_LIBRARY.test(dependency)
      : dependency.startsWith("/usr/lib/") || dependency.startsWith("/System/Library/");

  const runtimes = [];
  for (const dependency of linkage.dependencies) {
    if (isSystem(dependency)) continue;
    const name = isLinux ? dependency : dependency.replace(/^@rpath\//, "");
    if (name.includes("/") || !ONNXRUNTIME_LIBRARY.test(name)) {
      throw new Error(`unexpected dependency ${dependency}`);
    }
    if (!shippedFiles.includes(name)) {
      throw new Error(`links ${dependency}, which the sherpa-onnx runtime does not ship`);
    }
    runtimes.push(name);
  }
  if (runtimes.length !== 1) {
    throw new Error(`expected one ONNX Runtime dependency, found ${runtimes.length}`);
  }
  if (linkage.runpath.length > 0) {
    throw new Error(`uses RUNPATH (${linkage.runpath.join(":")}); expected RPATH`);
  }
  const allowed = ALLOWED_SEARCH_PATHS[isLinux ? "linux" : "darwin"];
  if (!linkage.rpath.includes(origin)) {
    throw new Error(`rpath ${linkage.rpath.join(":") || "(none)"} does not include ${origin}`);
  }
  for (const entry of linkage.rpath) {
    if (allowed.includes(entry)) continue;
    const reason = checkSearchPath(entry, {
      format: isLinux ? "elf" : "macho",
      imageDir: isLinux ? LINUX_BUNDLED_BIN_DIR : "Contents/Resources/bin",
    });
    throw new Error(
      `rpath entry ${entry}${reason ? ` ${reason}` : ""}; only ${allowed.join(" and ")} are allowed`
    );
  }
  return runtimes[0];
}

function readCmakeOnnxRuntimePin(cmakeSource) {
  const url = cmakeSource.match(/set\(onnxruntime_URL\s+"([^"]+)"\)/)?.[1];
  const hash = cmakeSource.match(/set\(onnxruntime_HASH\s+"SHA256=([0-9a-f]{64})"\)/)?.[1];
  return url && hash ? { url, sha256: hash } : null;
}

function readMachOLoadCommands(file, arch) {
  return execFileSync("otool", [...(arch ? ["-arch", arch] : []), "-l", file], {
    encoding: "utf8",
  });
}

function verifyOnnxRuntime({
  platformArch,
  runtimeName,
  sourceDir,
  buildDir,
  binDir,
  marker,
  readLoadCommands = readMachOLoadCommands,
}) {
  const built = path.join(buildDir, "_deps", "onnxruntime-src", "lib", runtimeName);
  const shipped = path.join(binDir, runtimeName);
  if (platformArch.startsWith("linux")) {
    if (sha256(fs.readFileSync(built)) !== sha256(fs.readFileSync(shipped))) {
      throw new Error(`${runtimeName} from the build differs from the shipped ${shipped}`);
    }
    return;
  }
  // download-sherpa-onnx.js swaps the arm64 slice of the shipped universal2
  // runtime for this zip (and re-signs it), so compare pins, not bytes.
  if (marker.onnxRuntime !== MACOS_ARM64_ONNXRUNTIME.marker) {
    throw new Error(
      `shipped ONNX Runtime is ${marker.onnxRuntime ?? "unmarked"}, expected ${MACOS_ARM64_ONNXRUNTIME.marker}`
    );
  }
  const pin = readCmakeOnnxRuntimePin(
    fs.readFileSync(path.join(sourceDir, "cmake", "onnxruntime-osx-arm64.cmake"), "utf8")
  );
  if (pin?.url !== MACOS_ARM64_ONNXRUNTIME.url || pin?.sha256 !== MACOS_ARM64_ONNXRUNTIME.sha256) {
    throw new Error(
      `the build links ${pin?.url ?? "an unknown ONNX Runtime"}, not the shipped one`
    );
  }
  // The servers load @rpath/libonnxruntime.dylib: the install name the pinned
  // zip's dylib carries, and the only name the runtime ships under. The
  // shipped file's arm64 slice must be that dylib: same install name, same UUID.
  const installName = `@rpath/${runtimeName}`;
  for (const file of [built, shipped]) {
    if (!fs.existsSync(file)) throw new Error(`${file} does not exist`);
  }
  const builtIdentity = parseMachOIdentity(readLoadCommands(built));
  const shippedIdentity = parseMachOIdentity(readLoadCommands(shipped, "arm64"));
  for (const [label, identity] of [
    ["the build's", builtIdentity],
    ["the shipped", shippedIdentity],
  ]) {
    if (identity.id !== installName) {
      throw new Error(
        `${label} ${runtimeName} is named ${identity.id ?? "nothing"}, not ${installName}`
      );
    }
  }
  if (!builtIdentity.uuid || builtIdentity.uuid !== shippedIdentity.uuid) {
    throw new Error(
      `the shipped ${runtimeName} arm64 slice (UUID ${shippedIdentity.uuid ?? "none"}) is not the build's ONNX Runtime (UUID ${builtIdentity.uuid ?? "none"})`
    );
  }
}

function run(command, args, options = {}) {
  console.log(`  $ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit", ...options });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

async function prepareSource(workDir, sourceDir) {
  const archive = path.join(workDir, "source.tar.gz");
  // Verified against runtime-assets.json, paths included, before extraction.
  await downloadFile(SOURCE_URL, archive);
  fs.mkdirSync(sourceDir, { recursive: true });
  run("tar", ["-xzf", archive, "-C", sourceDir, "--strip-components=1"]);
  fs.rmSync(archive, { force: true });
  // Its own repository, so git apply resolves the patch here and not against Loqui's checkout.
  run("git", ["init", "-q"], { cwd: sourceDir });
  run("git", ["apply", "--check", PATCH_PATH], { cwd: sourceDir });
  run("git", ["apply", PATCH_PATH], { cwd: sourceDir });
}

function smokeRun(binaryPath) {
  const result = spawnSync(binaryPath, ["--help"], {
    encoding: "utf8",
    timeout: 30000,
    // Resolve every symbol now, so a runtime mismatch fails here and not mid-dictation.
    env: { ...process.env, LD_BIND_NOW: "1" },
  });
  if (result.status !== 0) {
    const detail = `${result.stderr || ""}${result.error?.message || ""}`.trim().slice(-400);
    throw new Error(`${path.basename(binaryPath)} --help failed (${result.status}): ${detail}`);
  }
}

async function buildSherpaWebsocket({
  platformArch = `${process.platform}-${process.arch}`,
  binDir = BIN_DIR,
  cacheDir = CACHE_DIR,
  jobs = Number(process.env.LOQUI_SHERPA_BUILD_JOBS) || os.availableParallelism(),
} = {}) {
  if (!SUPPORTED_TARGETS.includes(platformArch)) {
    throw new Error(`Unsupported sherpa-onnx WebSocket build target: ${platformArch}`);
  }
  const config = BINARIES[platformArch];
  const marker = readJson(path.join(binDir, `.sherpa-onnx-${platformArch}.json`));
  if (marker?.version !== SHERPA_ONNX_VERSION || !Array.isArray(marker.libraries)) {
    throw new Error(
      `Install the sherpa-onnx ${SHERPA_ONNX_VERSION} runtime first: node scripts/download-sherpa-onnx.js --current`
    );
  }

  const workDir = path.join(cacheDir, platformArch);
  const sourceDir = path.join(workDir, "src");
  const buildDir = path.join(workDir, "build");
  const stampPath = path.join(workDir, "stamp.json");
  const configureArgs = cmakeConfigureArgs(platformArch, sourceDir, buildDir);
  const sourceAsset = require("../runtime-assets.json").assets.find(
    (asset) => asset.url === SOURCE_URL
  );
  if (!sourceAsset) throw new Error(`runtime-assets.json does not pin ${SOURCE_URL}`);
  const stamp = computeBuildStamp({
    platformArch,
    configureArgs,
    patch: fs.readFileSync(PATCH_PATH),
    builder: fs.readFileSync(__filename),
    sourceAsset,
  });
  const builtPaths = SERVERS.map(({ target }) => path.join(buildDir, "bin", target));

  console.log(`\nBuilding loopback-only sherpa-onnx WebSocket servers (${platformArch})...\n`);
  if (readJson(stampPath)?.stamp === stamp && builtPaths.every((file) => fs.existsSync(file))) {
    console.log("  Reusing the cached build");
  } else {
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });
    await prepareSource(workDir, sourceDir);
    run("cmake", configureArgs);
    run("cmake", [
      "--build",
      buildDir,
      "--target",
      ...SERVERS.map(({ target }) => target),
      "--parallel",
      String(jobs),
    ]);
    fs.writeFileSync(stampPath, JSON.stringify({ stamp }));
  }

  const shippedFiles = fs.readdirSync(binDir);
  for (const builtPath of builtPaths) {
    const name = path.basename(builtPath);
    if (!isLoopbackSherpaBinary(builtPath)) throw new Error(`${name} lacks the loopback patch`);
    try {
      const runtimeName = verifyLinkage({
        platformArch,
        linkage: readLinkage(builtPath, platformArch),
        shippedFiles,
      });
      verifyOnnxRuntime({ platformArch, runtimeName, sourceDir, buildDir, binDir, marker });
    } catch (error) {
      throw new Error(`${name}: ${error.message}`, { cause: error });
    }
  }

  for (const [index, { outputKey }] of SERVERS.entries()) {
    const outputPath = path.join(binDir, config[outputKey]);
    fs.rmSync(outputPath, { force: true });
    fs.copyFileSync(builtPaths[index], outputPath);
    fs.chmodSync(outputPath, 0o755);
    if (platformArch.startsWith("darwin")) {
      execFileSync("codesign", ["--force", "--sign", "-", outputPath], { stdio: "ignore" });
    }
    smokeRun(outputPath);
    console.log(`  ${platformArch}: Installed loopback-only ${config[outputKey]}`);
  }

  if (platformArch === "linux-x64") {
    // afterPack enforces this on every packaged build too.
    enforceGlibcFloor(
      binDir,
      SERVERS.map(({ outputKey }) => config[outputKey]),
      { strict: process.env.LOQUI_RELEASE_BUILD === "1", label: `  ${platformArch}` }
    );
  }
}

module.exports = {
  PATCH_PATH,
  SOURCE_URL,
  buildSherpaWebsocket,
  cmakeConfigureArgs,
  computeBuildStamp,
  parseElfDynamic,
  parseMachOIdentity,
  parseMachOLinkage,
  readCmakeOnnxRuntimePin,
  verifyLinkage,
  verifyOnnxRuntime,
};

if (require.main === module) {
  buildSherpaWebsocket().catch((error) => {
    console.error(`sherpa-onnx WebSocket build failed: ${error.message}`);
    process.exitCode = 1;
  });
}
