const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const nodeTest = require("node:test");
// Bounded: a regression must fail, never hang on a fake transport.
const test = Object.assign((name, fn) => nodeTest(name, { timeout: 10000 }, fn), {
  after: nodeTest.after,
  beforeEach: nodeTest.beforeEach,
  afterEach: nodeTest.afterEach,
});

// Model and runtime downloads (threat model N12/N13) through the real
// downloadUtils, GPU manager, gate, recorder and spawn guard. Electron's net is
// an in-process fake: no request leaves this process, nothing is downloaded and
// no native program runs (every child_process leaf below is a recording fake).

// Fake Electron net. `respond(req)` decides what the "server" does on end().
const requests = [];
const fetches = [];
let respond = null;
let fetchImpl = null;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-dl-sealed-"));
const fakeElectron = {
  app: {
    getPath: () => userData,
    getAppPath: () => process.cwd(),
    isReady: () => false,
    isPackaged: false,
  },
  net: {
    request: (options) => {
      const req = Object.assign(new EventEmitter(), {
        headers: {},
        aborted: false,
        setHeader(name, value) {
          req.headers[name.toLowerCase()] = value;
        },
        end() {
          respond?.(req);
        },
        abort() {
          req.aborted = true;
        },
      });
      requests.push({ options, req });
      return req;
    },
    fetch: async (url, init) => {
      fetches.push({ url, init });
      return fetchImpl(url, init);
    },
  },
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return fakeElectron;
  return originalLoad.call(this, request, parent, isMain);
};

// Production installs the spawn guard before helpers capture child_process
// functions (Task 7). Do the same over recording leaves, so a refusal is the
// real guard's and an unsealed launch never reaches a real program.
const leafCalls = [];
const savedLeaves = {};
for (const name of ["spawn", "exec", "execFile", "fork", "spawnSync", "execSync", "execFileSync"]) {
  savedLeaves[name] = childProcess[name];
  childProcess[name] = (...args) => {
    leafCalls.push([name, args[0]]);
    throw Object.assign(new Error(`fixture blocks ${name}`), { code: "EACCES" });
  };
}
const registry = require("../../src/helpers/privacy/childRegistry");
registry.installSpawnGuard({ childProcess });

const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError, sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");
const downloadUtils = require("../../src/helpers/downloadUtils");
const GpuBinaryManager = require("../../src/helpers/gpuBinaryManager");
const { downloadFile, fetchJson, createDownloadSignal, extractArchive } = downloadUtils;

test.after(() => {
  Module._load = originalLoad;
  Object.assign(childProcess, savedLeaves);
  require("node:module").syncBuiltinESMExports();
  fs.rmSync(userData, { recursive: true, force: true });
});

const flags = { sealed: false };
let rows;
test.beforeEach(() => {
  flags.sealed = false;
  requests.length = 0;
  fetches.length = 0;
  leafCalls.length = 0;
  respond = null;
  fetchImpl = null;
  let clock = 0;
  const recorder = new FlightRecorder({ now: () => ++clock });
  rows = [];
  recorder.on("event", (row) => rows.push(row));
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now: () => ++clock });
  registry._resetForTests();
});
test.afterEach(() => gate._resetForTests());

const ownedDirs = [];
test.after(() => {
  for (const dir of ownedDirs) fs.rmSync(dir, { recursive: true, force: true });
});
const tmpDest = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-dl-"));
  ownedDirs.push(dir);
  return path.join(dir, "model.bin");
};
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
function seal() {
  flags.sealed = true;
  gate.abortAllRemote();
}
// A server that answers, writes some chunks and optionally never finishes.
const serve =
  ({ status, headers = {}, chunks = [], stall = false, redirectTo = null }) =>
  (req) => {
    queueMicrotask(() => {
      if (redirectTo) req.emit("redirect", 302, "GET", redirectTo, {});
      const response = Object.assign(new PassThrough(), { statusCode: status, headers });
      req.emit("response", response);
      for (const chunk of chunks) response.write(chunk);
      if (!stall) response.end();
    });
  };

test("sealed: a model download is refused before net.request and records 0 bytes", async () => {
  flags.sealed = true;
  const error = await downloadFile(
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    tmpDest()
  ).catch((e) => e);
  assert.equal(sealedPhaseOf(error), "refused");
  assert.equal(requests.length, 0);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [rows[0].task, rows[0].host, rows[0].outcome, rows[0].bytesOut, rows[0].errorClass],
    ["modelDownload", "huggingface.co", "blocked", 0, "SEALED_MODE"]
  );
});

test("sealed: runtime release lookups are tagged runtimeDownload and never fetched", async () => {
  flags.sealed = true;
  await assert.rejects(
    fetchJson("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest", {
      egressTask: "runtimeDownload",
    }),
    isSealedModeError
  );
  assert.equal(fetches.length, 0);
  assert.deepEqual(
    [rows[0].task, rows[0].host, rows[0].outcome],
    ["runtimeDownload", "api.github.com", "blocked"]
  );
});

test("sealing keeps the partial file; the next run resumes and counts only its own bytes", async () => {
  const dest = tmpDest();
  const { signal } = createDownloadSignal();
  respond = serve({
    status: 200,
    headers: { "content-length": "8" },
    chunks: [Buffer.from("abcd")],
    stall: true,
  });
  const first = downloadFile("https://huggingface.co/x/model.bin", dest, {
    signal,
    maxRetries: 0,
  });
  await tick(30); // let the first chunk reach the temp file
  seal();
  const error = await first.catch((e) => e);
  assert.equal(sealedPhaseOf(error), "interrupted", "sealing mid-download is never 'nothing sent'");
  assert.equal(error.keptBytes, 4);
  assert.equal(requests[0].req.aborted, true, "the transport itself was aborted");
  assert.equal(fs.readFileSync(`${dest}.tmp`, "utf8"), "abcd", "partial file kept for resume");
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [rows[0].task, rows[0].kind, rows[0].outcome, rows[0].errorClass, rows[0].bytesIn],
    ["modelDownload", "request", "cancelled", "SEALED_MODE", null],
    "an unfinished body is unknown, not a count"
  );
  assert.equal(gate.activeRemoteCount(), 0);

  flags.sealed = false;
  respond = serve({
    status: 206,
    headers: { "content-range": "bytes 4-7/8", "content-length": "4" },
    chunks: [Buffer.from("efgh")],
  });
  await downloadFile("https://huggingface.co/x/model.bin", dest, { maxRetries: 0 });
  assert.equal(requests.at(-1).req.headers.range, "bytes=4-");
  assert.equal(fs.readFileSync(dest, "utf8"), "abcdefgh");
  const resumed = rows.at(-1);
  assert.deepEqual(
    [resumed.outcome, resumed.status, resumed.bytesIn, resumed.bytesOut],
    ["ok", 206, 4, null],
    "only this run's bytes; a bodyless GET's request bytes stay unknown"
  );
});

test("an ordinary user cancel still deletes the partial file and is not a seal", async () => {
  const dest = tmpDest();
  const { signal, abort } = createDownloadSignal();
  respond = serve({
    status: 200,
    headers: { "content-length": "8" },
    chunks: [Buffer.from("abcd")],
    stall: true,
  });
  const pending = downloadFile("https://huggingface.co/x/model.bin", dest, {
    signal,
    maxRetries: 0,
  });
  await tick(30);
  abort();
  const error = await pending.catch((e) => e);
  assert.equal(error.isAbort, true);
  assert.equal(isSealedModeError(error), false);
  assert.equal(fs.existsSync(`${dest}.tmp`), false);
  assert.deepEqual([rows[0].outcome, rows[0].errorClass], ["cancelled", "ABORTED"]);
});

test("each actual attempt is its own tagged row with its own bytes", async () => {
  const dest = tmpDest();
  let n = 0;
  respond = (req) => {
    n++;
    if (n === 1)
      queueMicrotask(() => {
        const response = Object.assign(new PassThrough(), {
          statusCode: 200,
          headers: { "content-length": "6" },
        });
        req.emit("response", response);
        response.write(Buffer.from("abc"));
        setTimeout(
          () => req.emit("error", Object.assign(new Error("reset"), { code: "ECONNRESET" })),
          20
        );
      });
    else
      serve({
        status: 206,
        headers: { "content-range": "bytes 3-5/6", "content-length": "3" },
        chunks: [Buffer.from("def")],
      })(req);
  };
  const tags = [];
  const origRequest = fakeElectron.net.request;
  fakeElectron.net.request = (options) => {
    const req = origRequest(options);
    const setHeader = req.setHeader;
    req.setHeader = (name, value) => {
      setHeader(name, value);
      if (name.toLowerCase() === gate.EGRESS_TAG_HEADER) tags.push(gate.ticketByTag(value));
    };
    return req;
  };
  try {
    await downloadFile("https://huggingface.co/x/model.bin", dest, { maxRetries: 1 });
  } finally {
    fakeElectron.net.request = origRequest;
  }
  assert.equal(fs.readFileSync(dest, "utf8"), "abcdef");
  assert.equal(tags.length, 2, "every Chromium request carries a tag for the backstop");
  assert.ok(
    tags.every((owner) => owner?.ticket),
    "the tag names an attempt, not the operation"
  );
  assert.notEqual(tags[0], tags[1]);
  assert.equal(tags[0].ticket, tags[1].ticket, "both attempts belong to one operation");
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => [r.kind, r.outcome, r.errorClass, r.bytesIn]),
    [
      ["request", "error", "CONNECTION", null],
      ["request", "ok", null, 3],
    ]
  );
  assert.equal(rows[0].operationId, rows[1].operationId);
});

test("redirects Chromium follows join that attempt's host trail", async () => {
  respond = serve({
    status: 200,
    headers: { "content-length": "2" },
    chunks: [Buffer.from("ok")],
    redirectTo: "https://cdn-lfs.huggingface.co/blob",
  });
  await downloadFile("https://huggingface.co/x/model.bin", tmpDest(), { maxRetries: 0 });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].hosts, ["huggingface.co", "cdn-lfs.huggingface.co"]);
  assert.equal(rows[0].bytesIn, 2);
});

test("sealing during a retry backoff ends the wait at once and keeps the partial", async () => {
  const dest = tmpDest();
  respond = (req) =>
    queueMicrotask(() => {
      const response = Object.assign(new PassThrough(), {
        statusCode: 200,
        headers: { "content-length": "6" },
      });
      req.emit("response", response);
      response.write(Buffer.from("abc"));
      setTimeout(
        () => req.emit("error", Object.assign(new Error("reset"), { code: "ECONNRESET" })),
        20
      );
    });
  const pending = downloadFile("https://huggingface.co/x/model.bin", dest, { maxRetries: 3 });
  await tick(120); // first attempt failed; the 1 s backoff is running
  assert.equal(requests.length, 1);
  const sealedAt = Date.now();
  seal();
  const error = await pending.catch((e) => e);
  assert.ok(Date.now() - sealedAt < 500, "the backoff wait ends when sealing aborts it");
  assert.equal(sealedPhaseOf(error), "interrupted");
  assert.equal(requests.length, 1, "no attempt starts after sealing");
  assert.equal(fs.readFileSync(`${dest}.tmp`, "utf8"), "abc");
});

test("fetchJson is one metered, tagged attempt that composes the caller's signal", async () => {
  fetchImpl = async () => Response.json({ tag_name: "v1" });
  const caller = new AbortController();
  const body = await fetchJson("https://api.github.com/repos/x/y/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
    signal: caller.signal,
    egressTask: "runtimeDownload",
  });
  assert.deepEqual(body, { tag_name: "v1" });
  const { init } = fetches[0];
  assert.equal(init.useSessionCookies, false);
  assert.equal(new Headers(init.headers).get("accept"), "application/vnd.github+json");
  assert.match(new Headers(init.headers).get(gate.EGRESS_TAG_HEADER), /^\d+\.\d+\./);
  assert.equal(init.signal.aborted, false);
  caller.abort();
  assert.equal(init.signal.aborted, true, "the caller's cancel still reaches the transport");
  assert.deepEqual(
    [rows[0].task, rows[0].kind, rows[0].outcome, rows[0].bytesIn],
    ["runtimeDownload", "request", "ok", JSON.stringify({ tag_name: "v1" }).length]
  );
});

function gpuManager() {
  return new GpuBinaryManager({
    name: "fixture",
    dirName: "fixture-pack",
    releaseUrl: "https://api.github.com/repos/fixture/pack/releases/latest",
    assets: {
      [`${process.platform}-${process.arch}`]: {
        assetName: "pack.zip",
        binaryName: "server",
        outputName: "server-out",
      },
    },
  });
}

test("sealed: a GPU runtime install is refused at its release lookup", async () => {
  flags.sealed = true;
  await assert.rejects(gpuManager().download(), isSealedModeError);
  assert.equal(fetches.length, 0);
  assert.equal(requests.length, 0);
  assert.deepEqual(
    rows.map((r) => [r.task, r.host, r.outcome]),
    [["runtimeDownload", "api.github.com", "blocked"]]
  );
  assert.deepEqual(leafCalls, []);
});

test("a GPU runtime install tags its release lookup and archive as runtimeDownload", async () => {
  fetchImpl = async () =>
    Response.json({
      tag_name: "t",
      assets: [
        {
          name: "pack.zip",
          browser_download_url: "https://github.com/fixture/pack/releases/download/t/pack.zip",
          size: 4,
          digest: "sha256:" + "0".repeat(64),
        },
      ],
    });
  respond = serve({
    status: 200,
    headers: { "content-length": "4" },
    chunks: [Buffer.from("zip!")],
  });
  // The fixture digest never matches, so nothing is extracted or installed.
  await assert.rejects(gpuManager().download(), /integrity check/);
  assert.deepEqual(
    rows.map((r) => [r.task, r.host, r.outcome]),
    [
      ["runtimeDownload", "api.github.com", "ok"],
      ["runtimeDownload", "github.com", "ok"],
    ]
  );
  assert.deepEqual(leafCalls, []);
});

test("sealed: archive extraction launches no native program", async () => {
  flags.sealed = true;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-extract-"));
  const zip = path.join(dir, "pack.zip");
  fs.writeFileSync(zip, "not really a zip");
  try {
    await assert.rejects(extractArchive(zip, dir), isSealedModeError);
    assert.deepEqual(leafCalls, [], "refused before the native leaf");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
