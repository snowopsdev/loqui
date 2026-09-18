#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const target = `${process.platform}-${process.arch}`;
if (!["linux-x64", "darwin-arm64"].includes(target))
  throw Error(`Unsupported release platform: ${target}`);
const run = (file, args = []) =>
  execFileSync(process.execPath, [`scripts/${file}.js`, ...args], { stdio: "inherit" });
const native =
  process.platform === "darwin"
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
for (const file of native) run(file);
run("build-meeting-aec-helper");
for (const file of [
  "whisper-cpp",
  "llama-server",
  "sherpa-onnx",
  "yt-dlp",
  "qdrant",
  "whisper-vad-model",
])
  run(`download-${file}`, ["--current", "--force"]);
run("download-minilm", ["--for-build", "--force"]);
run("download-diarization-models", ["--output-dir", "resources/bin/diarization-models", "--force"]);
const required = [
  `whisper-server-${target}`,
  `llama-server-${target}${process.platform === "linux" ? "-cpu" : ""}`,
  `qdrant-${target}`,
  `yt-dlp-${target}`,
  `meeting-aec-helper-${target}`,
];
for (const name of required) {
  const file = path.join("resources/bin", name);
  if (!fs.existsSync(file) || fs.statSync(file).size === 0)
    throw Error(`Missing required runtime: ${file}`);
}
for (const file of ["src/assets/icon.png", "src/assets/icon.icns", "src/assets/brand/mark.svg"])
  if (!fs.existsSync(file)) throw Error(`Missing Loqui artwork: ${file}`);
