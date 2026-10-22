const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const debugLogger = require("./debugLogger");
const { createAbortError } = require("./abortError");

// FFmpeg's per-input whitelist is defense in depth, never native isolation.
// Reject alternate spellings/overrides and dynamic output protocols rather
// than accepting a whitelist somewhere else in the command line.
function localOnlyInputs(args) {
  const fail = () => {
    throw Object.assign(new Error("FFmpeg requires file,pipe inputs and local outputs"), {
      code: "FFMPEG_UNSAFE_INPUT",
    });
  };
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string" || a.includes("\0"))) fail();
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    // Muxer/filter values can embed protocols without // (tee/udp, movie,
    // concat, etc.). Input restrictions must not become output authorization.
    if (
      /(?:^|[^a-z0-9+.-])(?:https?|tcp|udp|tls|rtmp[a-z]*|rtsp|srt|rist|ftps?|smb|ssh|unix|zmq|amqp|crypto|concatf?|subfile|data|fd):/i.test(
        arg
      )
    )
      fail();
    if (/^-protocol_/i.test(arg)) {
      if (arg !== "-protocol_whitelist" || args[i + 1] !== "file,pipe" || args[i + 2] !== "-i")
        fail();
      out.push(arg, args[++i]);
      continue;
    }
    if (
      /^-(?:hls|segment_list|tee|filter_script|filter_complex_script|attach|dump_attachment)/i.test(
        arg
      )
    )
      fail();
    if (arg === "-f" && /^(?:tee|hls|dash)$/i.test(args[i + 1] ?? "")) fail();
    // Windows drive paths are files; all other protocol-looking values must
    // use file or a numeric pipe descriptor. Includes embedded tee URLs.
    const protocols = arg.matchAll(/(?:^|[^a-z0-9+.-])([a-z][a-z0-9+.-]*):/gi);
    for (const match of protocols) {
      const scheme = match[1].toLowerCase();
      if (/^[a-z]:[\\/]/i.test(arg) && match.index === 0) continue;
      if (!["file", "pipe"].includes(scheme) && !arg.startsWith("-") && !arg.startsWith("["))
        fail();
      if (arg.includes("://") && scheme !== "file") fail();
    }
    if (arg === "-i") {
      if (!args[i + 1] || args[i + 1].startsWith("-")) fail();
      if (out.at(-2) !== "-protocol_whitelist" || out.at(-1) !== "file,pipe")
        out.push("-protocol_whitelist", "file,pipe");
    }
    out.push(arg);
  }
  return out;
}

let cachedFFmpegPath = null;

function getFFmpegPath() {
  if (cachedFFmpegPath) return cachedFFmpegPath;

  try {
    let ffmpegPath = require("ffmpeg-static");
    ffmpegPath = path.normalize(ffmpegPath);

    if (process.platform === "win32" && !ffmpegPath.endsWith(".exe")) {
      ffmpegPath += ".exe";
    }

    // Try unpacked ASAR path first (production builds unpack ffmpeg-static)
    const unpackedPath = ffmpegPath.includes("app.asar")
      ? ffmpegPath.replace(/app\.asar([/\\])/, "app.asar.unpacked$1")
      : null;

    if (unpackedPath && fs.existsSync(unpackedPath)) {
      if (process.platform !== "win32") {
        try {
          fs.accessSync(unpackedPath, fs.constants.X_OK);
        } catch {
          try {
            fs.chmodSync(unpackedPath, 0o755);
          } catch (chmodErr) {
            debugLogger.warn("Failed to chmod FFmpeg", { error: chmodErr.message });
          }
        }
      }
      cachedFFmpegPath = unpackedPath;
      return unpackedPath;
    }

    // Try original path (development or if not in ASAR). An in-asar path passes
    // existsSync but can never be spawned, so fall through to system FFmpeg instead.
    if (!unpackedPath && fs.existsSync(ffmpegPath)) {
      if (process.platform !== "win32") {
        try {
          fs.accessSync(ffmpegPath, fs.constants.X_OK);
        } catch {
          debugLogger.debug("FFmpeg exists but not executable", { ffmpegPath });
          throw new Error("Not executable");
        }
      }
      cachedFFmpegPath = ffmpegPath;
      return ffmpegPath;
    }
  } catch (err) {
    debugLogger.debug("Bundled FFmpeg not available", { error: err.message });
  }

  const systemCandidates =
    process.platform === "darwin"
      ? ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"]
      : process.platform === "win32"
        ? ["C:\\ffmpeg\\bin\\ffmpeg.exe"]
        : ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"];

  for (const candidate of systemCandidates) {
    if (fs.existsSync(candidate)) {
      cachedFFmpegPath = candidate;
      return candidate;
    }
  }

  const pathEnv = process.env.PATH || "";
  const pathSep = process.platform === "win32" ? ";" : ":";
  const pathDirs = pathEnv.split(pathSep).map((entry) => entry.replace(/^"|"$/g, ""));
  const pathBinary = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = path.join(dir, pathBinary);
    if (!fs.existsSync(candidate)) continue;
    if (process.platform !== "win32") {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
      } catch {
        continue;
      }
    }
    cachedFFmpegPath = candidate;
    return candidate;
  }

  debugLogger.debug("FFmpeg not found");
  return null;
}

function isWavFormat(buffer) {
  if (!buffer || buffer.length < 12) return false;

  return (
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x41 && // A
    buffer[10] === 0x56 && // V
    buffer[11] === 0x45 // E
  );
}

// Shared spawn/abort/exit handling for the one-shot conversions below. Resolves
// once ffmpeg exits cleanly and has written a non-empty output file.
function runFFmpegConversion(args, outputPath, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const ffmpegPath = getFFmpegPath();
    if (!ffmpegPath) {
      reject(
        new Error(
          "FFmpeg not found - the bundled FFmpeg is missing from this install and no system FFmpeg was found on PATH; reinstalling OpenWhispr should fix this"
        )
      );
      return;
    }

    const proc = spawn(ffmpegPath, localOnlyInputs([...args, "-y", outputPath]), {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stderr = "";

    const onAbort = () => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // an uncaught throw here would escape the abort dispatch
      }
      reject(createAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) return;
      reject(new Error(`FFmpeg process error: ${error.message}`));
    });

    proc.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) return;
      if (code !== 0) {
        const stderrPreview = stderr.slice(-500).trim();
        debugLogger.debug("FFmpeg conversion failed", { code, stderr: stderrPreview });
        reject(
          new Error(`FFmpeg exited with code ${code}${stderrPreview ? `: ${stderrPreview}` : ""}`)
        );
        return;
      }

      if (!fs.existsSync(outputPath)) {
        reject(new Error("FFmpeg conversion produced no output file"));
        return;
      }

      const stats = fs.statSync(outputPath);
      if (stats.size === 0) {
        reject(new Error("FFmpeg conversion produced empty output file"));
        return;
      }

      debugLogger.debug("FFmpeg conversion complete", { outputSize: stats.size });
      resolve();
    });
  });
}

function convertToWav(inputPath, outputPath, options = {}) {
  const { sampleRate = 16000, channels = 1, signal } = options;

  debugLogger.debug("Converting audio with FFmpeg", {
    input: inputPath,
    output: outputPath,
    sampleRate,
    channels,
  });

  return runFFmpegConversion(
    ["-i", inputPath, "-ar", String(sampleRate), "-ac", String(channels), "-c:a", "pcm_s16le"],
    outputPath,
    { signal }
  );
}

// Mono 16 kHz MP3 with any video stream dropped: the same shape as the cloud
// chunks, accepted by every provider, and small enough for their upload caps.
function convertToMp3(inputPath, outputPath, options = {}) {
  const { audioBitrate = "64k", signal } = options;

  debugLogger.debug("Re-encoding audio to MP3 with FFmpeg", {
    input: inputPath,
    output: outputPath,
    audioBitrate,
  });

  return runFFmpegConversion(
    [
      "-i",
      inputPath,
      "-vn",
      "-c:a",
      "libmp3lame",
      "-b:a",
      audioBitrate,
      "-ar",
      "16000",
      "-ac",
      "1",
    ],
    outputPath,
    { signal }
  );
}

let reencodeSequence = 0;

// Buffer in, buffer out. convertToWav works on paths, but retry paths hold
// recordings in memory and should not repeat the temp-file handling.
async function convertBufferToWav(audioBuffer, options = {}) {
  const { getSafeTempDir } = require("./safeTempDir");
  const tempDir = getSafeTempDir();
  // process.pid is constant within a process and Date.now() only has
  // millisecond resolution, so concurrent retries need a sequence suffix.
  const stamp = `${Date.now()}-${process.pid}-${++reencodeSequence}`;
  const inputPath = path.join(tempDir, `ow-reencode-${stamp}.input`);
  const outputPath = path.join(tempDir, `ow-reencode-${stamp}.wav`);

  try {
    fs.writeFileSync(inputPath, audioBuffer);
    await convertToWav(inputPath, outputPath, { sampleRate: 16000, channels: 1, ...options });
    return fs.readFileSync(outputPath);
  } finally {
    for (const filePath of [inputPath, outputPath]) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // A stale temp file should not hide the transcription result or error.
      }
    }
  }
}

function parseWavFormat(wavBuffer) {
  if (!isWavFormat(wavBuffer)) return null;

  let offset = 12; // Skip RIFF header (4) + size (4) + WAVE (4)
  while (offset < wavBuffer.length - 8) {
    const chunkId = wavBuffer.toString("ascii", offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);

    if (chunkId === "fmt ") {
      return {
        audioFormat: wavBuffer.readUInt16LE(offset + 8),
        channels: wavBuffer.readUInt16LE(offset + 10),
        sampleRate: wavBuffer.readUInt32LE(offset + 12),
        bitsPerSample: wavBuffer.readUInt16LE(offset + 22),
      };
    }

    offset += 8 + chunkSize;
  }

  return null;
}

// Local engines take 16 kHz mono PCM16 WAV as-is; anything else goes through FFmpeg.
function isPcm16Mono16kWav(buffer) {
  const format = parseWavFormat(buffer);
  return (
    format?.audioFormat === 1 &&
    format.channels === 1 &&
    format.sampleRate === 16000 &&
    format.bitsPerSample === 16
  );
}

function wavToFloat32Samples(wavBuffer) {
  if (!isWavFormat(wavBuffer)) {
    throw new Error("Buffer is not a valid WAV file");
  }

  // Parse WAV header to find data chunk
  let offset = 12; // Skip RIFF header (4) + size (4) + WAVE (4)
  let dataOffset = -1;
  let dataSize = 0;
  let bitsPerSample = 16;

  while (offset < wavBuffer.length - 8) {
    const chunkId = wavBuffer.toString("ascii", offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);

    if (chunkId === "fmt ") {
      bitsPerSample = wavBuffer.readUInt16LE(offset + 22);
    } else if (chunkId === "data") {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  if (dataOffset < 0) {
    throw new Error("WAV data chunk not found");
  }

  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor(dataSize / bytesPerSample);
  const float32 = Buffer.alloc(numSamples * 4);

  for (let i = 0; i < numSamples; i++) {
    const sampleOffset = dataOffset + i * bytesPerSample;
    const intVal =
      bitsPerSample === 16 ? wavBuffer.readInt16LE(sampleOffset) : wavBuffer.readInt8(sampleOffset);
    const maxVal = bitsPerSample === 16 ? 32768 : 128;
    float32.writeFloatLE(intVal / maxVal, i * 4);
  }

  return float32;
}

function computeFloat32RMS(float32Buffer) {
  const numSamples = float32Buffer.length / 4;
  if (numSamples === 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < numSamples; i++) {
    const val = float32Buffer.readFloatLE(i * 4);
    sumSquares += val * val;
  }

  return Math.sqrt(sumSquares / numSamples);
}

function parseFfmpegDuration(stderr) {
  const match = stderr?.match(/Duration:\s*(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function splitAudioFile(inputPath, outputDir, options = {}) {
  const { segmentDuration = 600, audioBitrate = "128k", signal } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const ffmpegPath = getFFmpegPath();
    if (!ffmpegPath) {
      reject(new Error("FFmpeg not found - required for audio splitting"));
      return;
    }

    const outputPattern = path.join(outputDir, "chunk-%03d.mp3");

    const args = [
      "-i",
      inputPath,
      "-f",
      "segment",
      "-segment_time",
      String(segmentDuration),
      "-c:a",
      "libmp3lame",
      "-b:a",
      audioBitrate,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-y",
      outputPattern,
    ];

    debugLogger.debug("Splitting audio with FFmpeg", {
      input: inputPath,
      outputDir,
      segmentDuration,
      audioBitrate,
    });

    const proc = spawn(ffmpegPath, localOnlyInputs(args), {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stderr = "";

    const onAbort = () => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // an uncaught throw here would escape the abort dispatch
      }
      reject(createAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) return;
      reject(new Error(`FFmpeg split error: ${error.message}`));
    });

    // The kill lands here as a non-zero exit; returning early keeps a cancel
    // from being logged and reported as an ffmpeg failure.
    proc.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) return;
      if (code !== 0) {
        const stderrPreview = stderr.slice(-500).trim();
        debugLogger.debug("FFmpeg split failed", { code, stderr: stderrPreview });
        reject(
          new Error(
            `FFmpeg split exited with code ${code}${stderrPreview ? `: ${stderrPreview}` : ""}`
          )
        );
        return;
      }

      const chunks = fs
        .readdirSync(outputDir)
        .filter((f) => f.startsWith("chunk-") && f.endsWith(".mp3"))
        .sort()
        .map((f) => path.join(outputDir, f));

      if (chunks.length === 0) {
        reject(new Error("FFmpeg split produced no output files"));
        return;
      }

      const durationSeconds = parseFfmpegDuration(stderr);
      debugLogger.debug("FFmpeg split complete", { chunkCount: chunks.length, durationSeconds });
      resolve({ chunkPaths: chunks, durationSeconds });
    });
  });
}

// Private conversion has no pathname input/output or temporary directory.
// Decode one independent container per pipe, then join PCM in original order;
// concatenating WebM bytes would lose headers/segments on some decoders.
async function decodePrivatePcm(audioBuffer, { signal } = {}) {
  if (signal?.aborted) throw createAbortError("Audio conversion cancelled");
  const binary = getFFmpegPath();
  if (!binary) throw new Error("FFmpeg not found - required for private audio conversion");
  return new Promise((resolve, reject) => {
    const proc = spawn(
      binary,
      localOnlyInputs([
        "-nostdin",
        "-i",
        "pipe:0",
        "-vn",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        "-f",
        "s16le",
        "pipe:1",
      ]),
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }
    );
    const chunks = [];
    let size = 0,
      failure = null;
    const stop = (error) => {
      failure ??= error;
      proc.kill();
    };
    const abort = () => stop(createAbortError("Audio conversion cancelled"));
    const timeout = setTimeout(() => stop(new Error("Private audio conversion timed out")), 120000);
    timeout.unref?.();
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    };
    signal?.addEventListener("abort", abort, { once: true });
    proc.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 256 * 1024 * 1024)
        return stop(new Error("Private audio conversion exceeds memory limit"));
      chunks.push(Buffer.from(chunk));
    });
    proc.stderr.resume();
    proc.stdin.on("error", (error) => stop(error));
    proc.on("error", (error) => {
      cleanup();
      reject(error);
    });
    proc.on("close", (code) => {
      cleanup();
      if (failure || signal?.aborted || code !== 0 || size === 0 || size % 2)
        return reject(
          failure ||
            (signal?.aborted
              ? createAbortError("Audio conversion cancelled")
              : new Error("Private audio conversion failed"))
        );
      resolve(Buffer.concat(chunks));
    });
    if (signal?.aborted) abort();
    else proc.stdin.end(Buffer.from(audioBuffer));
  });
}

function pcm16Wav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function convertPrivateBufferToWav(audioBuffer, options = {}) {
  return pcm16Wav(await decodePrivatePcm(audioBuffer, options));
}

async function mergeAudioSegments(segments, options = {}) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("At least one audio segment is required");
  }
  if (options.private === true) {
    const pcm = [];
    let total = 0;
    for (const segment of segments) {
      const decoded = await decodePrivatePcm(segment.buffer, options);
      total += decoded.length;
      if (total > 256 * 1024 * 1024) throw new Error("Private audio merge exceeds memory limit");
      pcm.push(decoded);
    }
    return pcm16Wav(Buffer.concat(pcm));
  }
  if (segments.length === 1) return Buffer.from(segments[0].buffer);

  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) throw new Error("FFmpeg not found - required for audio segment recovery");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-audio-merge-"));
  const outputPath = path.join(tempDir, "merged.webm");
  try {
    const inputPaths = segments.map((segment, index) => {
      const mimeType = segment.mimeType || "audio/webm";
      const extension = mimeType.includes("ogg")
        ? "ogg"
        : mimeType.includes("mp4")
          ? "m4a"
          : "webm";
      const inputPath = path.join(tempDir, `segment-${index}.${extension}`);
      fs.writeFileSync(inputPath, Buffer.from(segment.buffer));
      return inputPath;
    });

    const filters = inputPaths.map(
      (_, index) =>
        `[${index}:a]aresample=16000,aformat=sample_fmts=fltp:channel_layouts=mono[s${index}]`
    );
    filters.push(
      `${inputPaths.map((_, index) => `[s${index}]`).join("")}concat=n=${inputPaths.length}:v=0:a=1[out]`
    );

    await new Promise((resolve, reject) => {
      const args = inputPaths.flatMap((inputPath) => ["-i", inputPath]);
      args.push(
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[out]",
        "-c:a",
        "libopus",
        "-b:a",
        "64k",
        "-y",
        outputPath
      );
      const proc = spawn(ffmpegPath, localOnlyInputs(args), {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stderr = "";
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      proc.on("error", (error) => reject(new Error(`FFmpeg process error: ${error.message}`)));
      proc.on("close", (code) => {
        if (code !== 0) {
          const preview = stderr.slice(-500).trim();
          reject(
            new Error(`FFmpeg audio merge exited with code ${code}${preview ? `: ${preview}` : ""}`)
          );
          return;
        }
        resolve();
      });
    });

    return fs.readFileSync(outputPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function clearCache() {
  cachedFFmpegPath = null;
}

module.exports = {
  localOnlyInputs,
  splitAudioFile,
  getFFmpegPath,
  isWavFormat,
  parseWavFormat,
  isPcm16Mono16kWav,
  convertToWav,
  convertBufferToWav,
  convertPrivateBufferToWav,
  convertToMp3,
  parseFfmpegDuration,
  wavToFloat32Samples,
  computeFloat32RMS,
  mergeAudioSegments,
  clearCache,
};
