#!/usr/bin/env node
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// Runs scripts/<file>.js in a child Node process. Output is line-prefixed so
// steps running side by side stay readable in CI logs.
function runStep(
  file,
  args = [],
  { spawnImpl = spawn, write = (text) => process.stdout.write(text) } = {}
) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, [`scripts/${file}.js`, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr]) {
      let pending = "";
      stream?.setEncoding?.("utf8");
      stream?.on("data", (chunk) => {
        const lines = (pending + chunk).split("\n");
        pending = lines.pop();
        for (const line of lines) write(`[${file}] ${line}\n`);
      });
      stream?.on("end", () => {
        if (pending) write(`[${file}] ${pending}\n`);
        pending = "";
      });
    }
    child.on("error", reject);
    child.on("close", (code, signal) =>
      code === 0
        ? resolve()
        : reject(
            Error(
              `${args.length ? `${file} ${args.join(" ")}` : file} failed (${signal || `exit ${code}`})`
            )
          )
    );
  });
}

// Waits for every step, then reports all failures together; a failure never
// leaves a sibling download half-written while the process exits underneath it.
async function settle(steps) {
  const results = await Promise.allSettled(steps);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) throw Error(failures.map((failure) => failure.reason.message).join("\n"));
}

function nativeBuilds(platform) {
  return platform === "darwin"
    ? [
        "build-globe-listener",
        "build-macos-fast-paste",
        "build-text-monitor",
        "build-media-remote",
        "build-mediaremote-adapter",
        "build-macos-mic-listener",
        "build-macos-calendar-listener",
        "build-macos-audio-tap",
      ]
    : [
        "build-linux-key-listener",
        "build-linux-fast-paste",
        "build-linux-system-audio",
        "build-text-monitor",
      ];
}

// Every release download keeps --force: an existing binary is never trusted, so
// each one is re-verified against its pinned SHA-256. Network cost stays low
// because download-utils serves pinned assets from the verified archive cache.
const DOWNLOADS = [
  ["download-whisper-cpp", ["--current", "--force"]],
  ["download-sherpa-onnx", ["--current", "--force"]],
  ["download-qdrant", ["--current", "--force"]],
  ["download-llama-server", ["--current", "--force"]],
  ["download-yt-dlp", ["--current", "--force"]],
  ["download-whisper-vad-model", ["--current", "--force"]],
  ["download-minilm", ["--for-build", "--force"]],
  ["download-diarization-models", ["--output-dir", "resources/bin/diarization-models", "--force"]],
];

async function preparePlatform({
  platform = process.platform,
  arch = process.arch,
  run = runStep,
  exists = fs.existsSync,
  size = (file) => fs.statSync(file).size,
} = {}) {
  const target = `${platform}-${arch}`;
  if (!["linux-x64", "darwin-arm64"].includes(target))
    throw Error(`Unsupported release platform: ${target}`);

  // Network-bound downloads, which write to separate outputs and temp
  // directories, run beside each other and beside the native compilers. The
  // compilers stay sequential: the AEC helper and the sherpa-onnx server each
  // drive CMake across every core, so overlapping them only adds memory pressure.
  const compile = async () => {
    for (const file of nativeBuilds(platform)) await run(file);
    await run("build-meeting-aec-helper");
  };
  await settle([compile(), settle(DOWNLOADS.map(([file, args]) => run(file, args)))]);
  // Replaces the upstream Parakeet servers, which listen on every interface.
  // It patches the sherpa-onnx runtime installed above.
  await run("build-sherpa-websocket");

  const required = [
    `whisper-server-${target}`,
    `llama-server-${target}${platform === "linux" ? "-cpu" : ""}`,
    `qdrant-${target}`,
    `yt-dlp-${target}`,
    `meeting-aec-helper-${target}`,
  ];
  for (const name of required) {
    const file = path.join("resources/bin", name);
    if (!exists(file) || size(file) === 0) throw Error(`Missing required runtime: ${file}`);
  }
  for (const file of [
    "src/assets/icon.png",
    "src/assets/icon.icns",
    "src/assets/iconTemplate.png",
    "src/assets/iconTemplate@2x.png",
    "src/assets/iconTemplate@3x.png",
    "src/assets/brand/mark.png",
    "src/assets/brand/logo-light.png",
    "src/assets/brand/logo-dark.png",
  ])
    if (!exists(file)) throw Error(`Missing Loqui artwork: ${file}`);
}

if (require.main === module)
  preparePlatform().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

module.exports = { preparePlatform, runStep, settle, DOWNLOADS };
