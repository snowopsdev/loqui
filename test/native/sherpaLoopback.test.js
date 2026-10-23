// Starts the patched sherpa-onnx WebSocket servers from resources/bin with
// two small pinned models and checks where they listen. This covers the
// binaries' bind address only; it is not evidence of egress isolation.
//
// Opt in with LOQUI_SHERPA_LOOPBACK_TEST=1 after scripts/build-sherpa-websocket.js.
// Models are fetched (SHA-256 checked) into LOQUI_SHERPA_TEST_MODEL_DIR, or
// .cache/sherpa-test-models.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const WebSocket = require("ws");
const { BINARIES, BIN_DIR } = require("../../scripts/download-sherpa-onnx");
const {
  LOOPBACK_LISTEN_MARKER,
  isLoopbackSherpaBinary,
} = require("../../src/helpers/sherpaLoopback");

const ENABLED = process.env.LOQUI_SHERPA_LOOPBACK_TEST === "1";
const PLATFORM_ARCH = `${process.platform}-${process.arch}`;
const MODEL_DIR =
  process.env.LOQUI_SHERPA_TEST_MODEL_DIR ||
  path.join(__dirname, "..", "..", ".cache", "sherpa-test-models");
const MODEL_RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models";
const MODELS = {
  offline: {
    name: "sherpa-onnx-tdnn-yesno",
    sha256: "bc168176e1d4fc77fb605eed6b67bf91e87a83cbcaedb7e626b81a73e4a1fd89",
    args: (dir) => [
      `--tokens=${path.join(dir, "tokens.txt")}`,
      `--tdnn-model=${path.join(dir, "model-epoch-14-avg-2.int8.onnx")}`,
      "--feat-dim=23",
    ],
  },
  online: {
    name: "sherpa-onnx-nemo-ctc-fa-shenava-rizeh-pizeh-v1.0-streaming-int8-2026-06-26",
    sha256: "9f6a08a93e8429074abbd9ab5980fefa490e2df2675bb60be2013bbc273c36e4",
    args: (dir) => [
      `--tokens=${path.join(dir, "tokens.txt")}`,
      `--nemo-ctc-model=${path.join(dir, "model.int8.onnx")}`,
    ],
  },
};

async function ensureModel({ name, sha256 }) {
  const dir = path.join(MODEL_DIR, name);
  if (fs.existsSync(path.join(dir, "tokens.txt"))) return dir;
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  const response = await fetch(`${MODEL_RELEASE}/${name}.tar.bz2`);
  if (!response.ok) throw new Error(`model download failed: ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const actual = crypto.createHash("sha256").update(archive).digest("hex");
  assert.equal(actual, sha256, `${name} SHA-256`);
  const archivePath = path.join(MODEL_DIR, `${name}.tar.bz2`);
  fs.writeFileSync(archivePath, archive);
  try {
    execFileSync("tar", ["-xjf", archivePath, "-C", MODEL_DIR]);
  } finally {
    fs.rmSync(archivePath, { force: true });
  }
  return dir;
}

function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function startServer(binary, args, cwd) {
  // The servers append a websocketpp access log to ./log.txt.
  const child = spawn(binary, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no startup line: ${stderr}`)), 60000);
    child.stderr.on("data", (data) => {
      stderr += data;
      const listenAt = stderr.indexOf("Listening on:");
      if (listenAt === -1 || !stderr.includes("\n", listenAt)) return;
      clearTimeout(timer);
      resolve(stderr.slice(listenAt, stderr.indexOf("\n", listenAt)));
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited (${code}): ${stderr}`));
    });
  });
  return { child, ready };
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timer);
}

function decodeProcAddress(hex) {
  const [address, port] = hex.split(":");
  const bytes = Buffer.from(address, "hex");
  if (bytes.length === 4)
    return { address: [...bytes].reverse().join("."), port: parseInt(port, 16) };
  // /proc stores IPv6 as four host-order (little-endian) 32-bit words.
  const words = [];
  for (let i = 0; i < 16; i += 4)
    words.push(
      bytes
        .subarray(i, i + 4)
        .reverse()
        .toString("hex")
    );
  const groups = words.join("").match(/.{4}/g);
  return {
    address: net.isIPv6(groups.join(":")) ? groups.join(":") : "?",
    port: parseInt(port, 16),
  };
}

// Every TCP listener the process holds, IPv4 and IPv6.
function listListeners(pid) {
  if (process.platform === "darwin") {
    let output = "";
    try {
      output = execFileSync(
        "lsof",
        ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-Fn"],
        {
          encoding: "utf8",
        }
      );
    } catch (error) {
      if (error.status !== 1) throw error; // lsof exits 1 when nothing matches
    }
    return output
      .split("\n")
      .filter((line) => line.startsWith("n"))
      .map((line) => {
        const at = line.lastIndexOf(":");
        return { address: line.slice(1, at), port: Number(line.slice(at + 1)) };
      });
  }
  const inodes = new Set();
  for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
    try {
      const target = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
      const match = target.match(/^socket:\[(\d+)\]$/);
      if (match) inodes.add(match[1]);
    } catch {}
  }
  const listeners = [];
  for (const table of ["tcp", "tcp6"]) {
    for (const line of fs.readFileSync(`/proc/${pid}/net/${table}`, "utf8").split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 10 || fields[3] !== "0A" || !inodes.has(fields[9])) continue;
      listeners.push(decodeProcAddress(fields[1]));
    }
  }
  return listeners;
}

function nonLoopbackAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && !entry.internal && entry.family === "IPv4")
    .map((entry) => entry.address);
}

function connectError(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 3000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(null);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve("ETIMEDOUT");
    });
    socket.once("error", (error) => resolve(error.code));
  });
}

function exchange(port, send, isDone) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`no reply; got ${JSON.stringify(messages)}`));
    }, 30000);
    ws.once("open", () => send(ws));
    ws.on("message", (data) => {
      messages.push(data.toString());
      if (isDone(messages)) {
        clearTimeout(timer);
        ws.close();
        resolve(messages);
      }
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

const silence = (seconds, sampleRate) => Buffer.alloc(Math.round(seconds * sampleRate) * 4);

const PROTOCOLS = {
  // [int32LE sample rate][int32LE byte count][float32 samples]; one result per request.
  offline: (port) =>
    exchange(
      port,
      (ws) => {
        const samples = silence(0.5, 8000);
        const header = Buffer.alloc(8);
        header.writeInt32LE(8000, 0);
        header.writeInt32LE(samples.length, 4);
        ws.send(Buffer.concat([header, samples]));
      },
      (messages) => messages.length > 0
    ),
  // 16 kHz float32 frames, then "Done"; the server answers "Done!" last.
  online: (port) =>
    exchange(
      port,
      (ws) => {
        ws.send(silence(1, 16000));
        ws.send("Done");
      },
      (messages) => messages.includes("Done!")
    ),
};

for (const runtime of ["offline", "online"]) {
  test(
    `the patched ${runtime} sherpa-onnx server listens on 127.0.0.1 only`,
    {
      skip: !ENABLED && "set LOQUI_SHERPA_LOOPBACK_TEST=1 to start the native servers",
      timeout: 180000,
    },
    async (t) => {
      const config = BINARIES[PLATFORM_ARCH];
      assert.ok(["linux-x64", "darwin-arm64"].includes(PLATFORM_ARCH), PLATFORM_ARCH);
      const binary = path.join(
        BIN_DIR,
        runtime === "online" ? config.onlineOutputName : config.outputName
      );
      assert.ok(
        fs.existsSync(binary),
        `${binary} is missing; run scripts/build-sherpa-websocket.js`
      );
      assert.ok(isLoopbackSherpaBinary(binary), `${binary} is not the loopback build`);

      const model = MODELS[runtime];
      const modelDir = await ensureModel(model);
      const port = await freeLoopbackPort();
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sherpa-loopback-"));
      const { child, ready } = startServer(
        binary,
        [...model.args(modelDir), `--port=${port}`, "--num-threads=1"],
        cwd
      );
      t.after(async () => {
        await stopServer(child);
        fs.rmSync(cwd, { recursive: true, force: true });
      });

      const startupLine = await ready;
      assert.equal(startupLine, `${LOOPBACK_LISTEN_MARKER}${port}`);

      const listeners = listListeners(child.pid);
      t.diagnostic(`pid ${child.pid} listeners: ${JSON.stringify(listeners)}`);
      assert.deepEqual(listeners, [{ address: "127.0.0.1", port }]);

      const messages = await PROTOCOLS[runtime](port);
      assert.ok(messages.length > 0);

      const lanAddresses = nonLoopbackAddresses();
      if (lanAddresses.length === 0) t.diagnostic("no non-loopback IPv4 address to probe");
      for (const address of lanAddresses) {
        assert.equal(await connectError(address, port), "ECONNREFUSED", `${address}:${port}`);
      }
    }
  );
}
