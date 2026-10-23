const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
// Install the Electron leaf before importing production modules. These tests
// exercise downloader/model methods, never an Electron installation or net API.
const initialElectronPath = require.resolve("electron");
const initialElectronCache = require.cache[initialElectronPath];
require.cache[initialElectronPath] = {
  exports: {
    app: { isReady: () => false, isPackaged: false },
    net: {
      request() {
        throw new Error("Install this test's explicit network fixture first");
      },
      fetch() {
        throw new Error("Install this test's explicit network fixture first");
      },
    },
  },
};
// These tests describe unsealed downloads. The gate fails closed until main
// configures it, so configure it unsealed here (Sealed: downloadsSealed).
require("../../src/helpers/privacy/egressGate").configureEgress({ isSealed: () => false });
let ParakeetManager;
try {
  ParakeetManager = require("../../src/helpers/parakeet");
} finally {
  if (initialElectronCache) require.cache[initialElectronPath] = initialElectronCache;
  else delete require.cache[initialElectronPath];
}

function createElectronMock(response) {
  return {
    app: { isReady: () => false },
    net: {
      request() {
        const request = new EventEmitter();
        request.setHeader = () => {};
        request.abort = () => {};
        request.end = () => queueMicrotask(() => request.emit("response", response));
        return request;
      },
    },
  };
}

function loadWithNetFetch(fetchImpl) {
  const electronPath = require.resolve("electron");
  const downloadUtilsPath = require.resolve("../../src/helpers/downloadUtils.js");
  const originalElectronCache = require.cache[electronPath];
  require.cache[electronPath] = {
    exports: { app: { isReady: () => false }, net: { fetch: fetchImpl } },
  };
  delete require.cache[downloadUtilsPath];
  return {
    downloadUtils: require(downloadUtilsPath),
    restore() {
      delete require.cache[downloadUtilsPath];
      if (originalElectronCache) require.cache[electronPath] = originalElectronCache;
      else delete require.cache[electronPath];
    },
  };
}

test("fetchJson sends the app User-Agent and returns the parsed body", async (t) => {
  const calls = [];
  const { downloadUtils, restore } = loadWithNetFetch(async (url, init) => {
    calls.push({ url, init });
    return Response.json({ tag_name: "v1" });
  });
  t.after(restore);

  assert.deepEqual(await downloadUtils.fetchJson("https://example.com/release.json"), {
    tag_name: "v1",
  });
  assert.equal(calls[0].init.method, "GET");
  assert.equal(
    new Headers(calls[0].init.headers).get("User-Agent"),
    "io.github.snowopsdev.loqui/0.1"
  );
});

// The status is the only thing standing between an error page and a caller that
// would otherwise treat a valid-looking JSON body as a successful response.
test("fetchJson rejects a non-2xx response even when its body is valid JSON", async (t) => {
  const { downloadUtils, restore } = loadWithNetFetch(async () =>
    Response.json({ error: "Entry not found" }, { status: 404 })
  );
  t.after(restore);

  await assert.rejects(
    () => downloadUtils.fetchJson("https://example.com/missing.json"),
    (error) => error.isHttpError === true && error.statusCode === 404
  );
});

test("fetchJson forwards caller init and keeps the User-Agent alongside caller headers", async (t) => {
  const calls = [];
  const { downloadUtils, restore } = loadWithNetFetch(async (url, init) => {
    calls.push({ url, init });
    return Response.json({});
  });
  t.after(restore);
  const controller = new AbortController();
  const signal = controller.signal;

  await downloadUtils.fetchJson("https://example.com/pinned.json", {
    headers: { Accept: "application/vnd.github+json" },
    credentials: "omit",
    cache: "no-store",
    signal,
  });

  const { init } = calls[0];
  assert.equal(init.credentials, "omit");
  assert.equal(init.cache, "no-store");
  // The caller's signal is composed with the egress ticket's (sealing aborts
  // it too), so it is forwarded as a combined signal that follows the caller.
  assert.equal(init.signal.aborted, false);
  controller.abort();
  assert.equal(init.signal.aborted, true);
  // Caller headers and the User-Agent, plus the egress tag the session
  // backstop strips before the request leaves (Task 6).
  const headers = new Headers(init.headers);
  const tag = headers.get("x-loqui-egress");
  headers.delete("x-loqui-egress");
  assert.match(tag, /^\d+\.\d+\./);
  assert.deepEqual(Object.fromEntries(headers), {
    "user-agent": "io.github.snowopsdev.loqui/0.1",
    accept: "application/vnd.github+json",
  });
});

test("downloadFile waits for a cancelled write stream to close before removing its temp file", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "downloadUtils-test-"));
  const destination = path.join(tempDir, "model.bin");
  const response = new PassThrough();
  response.statusCode = 200;
  response.headers = {};

  const electronPath = require.resolve("electron");
  const downloadUtilsPath = require.resolve("../../src/helpers/downloadUtils.js");
  const originalElectronCache = require.cache[electronPath];
  const originalCreateWriteStream = fs.createWriteStream;
  let releaseOpen;
  const openGate = new Promise((resolve) => (releaseOpen = resolve));
  let onOpenStarted;
  const openStarted = new Promise((resolve) => (onOpenStarted = resolve));
  const order = [];

  require.cache[electronPath] = { exports: createElectronMock(response) };
  delete require.cache[downloadUtilsPath];

  fs.createWriteStream = (filePath, options) => {
    const stream = originalCreateWriteStream(filePath, {
      ...options,
      fs: {
        open: (...args) => {
          const callback = args.at(-1);
          onOpenStarted();
          openGate.then(() => fs.open(...args.slice(0, -1), callback));
        },
        write: fs.write.bind(fs),
        writev: fs.writev.bind(fs),
        close: fs.close.bind(fs),
      },
    });
    stream.once("close", () => order.push("close"));
    return stream;
  };

  try {
    const { createDownloadSignal, downloadFile } = require(downloadUtilsPath);
    const { signal, abort } = createDownloadSignal();
    let settled = null;
    const done = downloadFile("https://example.com/model.bin", destination, {
      signal,
      maxRetries: 0,
    }).then(
      () => (settled = "resolved"),
      (error) => {
        order.push("rejected");
        settled = error;
      }
    );

    await openStarted;
    abort();
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));

    assert.equal(settled, null, "cancellation must not settle while the open is still pending");

    releaseOpen();
    await done;

    assert.equal(settled.isAbort, true);
    assert.equal(settled.keptBytes, 0);
    assert.deepEqual(order, ["close", "rejected"]);
    assert.equal(
      fs.existsSync(`${destination}.tmp`),
      false,
      "the late open must not leave a temp file"
    );
  } finally {
    fs.createWriteStream = originalCreateWriteStream;
    releaseOpen();
    delete require.cache[downloadUtilsPath];
    if (originalElectronCache) require.cache[electronPath] = originalElectronCache;
    else delete require.cache[electronPath];
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// Each net.request() answers with the next scripted response and records its headers.
function loadWithResponses(responses) {
  const electronPath = require.resolve("electron");
  const downloadUtilsPath = require.resolve("../../src/helpers/downloadUtils.js");
  const originalElectronCache = require.cache[electronPath];
  const requests = [];
  const requestInstances = [];
  require.cache[electronPath] = {
    exports: {
      app: { isReady: () => false },
      net: {
        request() {
          const request = new EventEmitter();
          const headers = {};
          requests.push(headers);
          requestInstances.push(request);
          request.setHeader = (name, value) => (headers[name] = value);
          request.abort = () => {};
          request.end = () => {
            const {
              statusCode,
              headers: responseHeaders,
              body,
              requestError,
              stream,
            } = responses.shift();
            if (requestError) {
              queueMicrotask(() => request.emit("error", requestError));
              return;
            }
            const response = stream ?? new PassThrough();
            response.statusCode = statusCode;
            response.headers = responseHeaders;
            if (!stream) response.end(body);
            queueMicrotask(() => request.emit("response", response));
          };
          return request;
        },
      },
    },
  };
  delete require.cache[downloadUtilsPath];
  return {
    downloadUtils: require(downloadUtilsPath),
    requests,
    requestInstances,
    restore() {
      delete require.cache[downloadUtilsPath];
      if (originalElectronCache) require.cache[electronPath] = originalElectronCache;
      else delete require.cache[electronPath];
    },
  };
}

test("a network failure keeps the partial file and the next attempt resumes it", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downloadUtils-keep-"));
  const destination = path.join(dir, "model.bin");
  const loaded = loadWithResponses([
    { statusCode: 200, headers: { "content-length": "10" }, body: Buffer.from("hello") },
    {
      statusCode: 206,
      headers: { "content-range": "bytes 5-9/10", "content-length": "5" },
      body: Buffer.from("world"),
    },
  ]);
  t.after(() => {
    loaded.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const failure = await loaded.downloadUtils
    .downloadFile("https://example.com/model.bin", destination, { maxRetries: 0 })
    .catch((error) => error);
  assert.equal(failure.code, "ERR_DOWNLOAD_INCOMPLETE");
  assert.equal(failure.keptBytes, 5);
  assert.equal(fs.readFileSync(`${destination}.tmp`, "utf8"), "hello");
  await loaded.downloadUtils.downloadFile("https://example.com/model.bin", destination, {
    maxRetries: 0,
  });
  assert.equal(loaded.requests[1].Range, "bytes=5-");
  assert.equal(fs.readFileSync(destination, "utf8"), "helloworld");
});

test("an HTTP failure drops the partial file and reports nothing kept", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downloadUtils-drop-"));
  const destination = path.join(dir, "model.bin");
  fs.writeFileSync(`${destination}.tmp`, "hello");
  const loaded = loadWithResponses([{ statusCode: 404, headers: {}, body: Buffer.alloc(0) }]);
  t.after(() => {
    loaded.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const failure = await loaded.downloadUtils
    .downloadFile("https://example.com/model.bin", destination, { maxRetries: 0 })
    .catch((error) => error);
  assert.equal(failure.isHttpError, true);
  assert.equal(failure.keptBytes, 0);
  assert.equal(fs.existsSync(`${destination}.tmp`), false);
});

test("cancellation before admission drops an existing partial and reports zero kept bytes", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downloadUtils-preabort-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const destination = path.join(dir, "model.bin");
  fs.writeFileSync(`${destination}.tmp`, "hello");
  const loaded = loadWithResponses([]);
  t.after(loaded.restore);
  const { signal, abort } = loaded.downloadUtils.createDownloadSignal();
  abort();
  const failure = await loaded.downloadUtils
    .downloadFile("https://example.com/model.bin", destination, { signal })
    .catch((error) => error);
  assert.equal(failure.isAbort, true);
  assert.equal(failure.keptBytes, 0);
  assert.equal(fs.existsSync(`${destination}.tmp`), false);
  assert.equal(loaded.requests.length, 0);
});

for (const code of ["CERT_HAS_EXPIRED", "ERR_FILE_TOO_SMALL"]) {
  test(`${code} drops existing partial bytes and reports zero kept`, async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downloadUtils-nonretry-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const destination = path.join(dir, "model.bin");
    fs.writeFileSync(`${destination}.tmp`, "hello");
    const loaded = loadWithResponses([
      { requestError: Object.assign(new Error("fixture failure"), { code }) },
    ]);
    t.after(loaded.restore);
    const failure = await loaded.downloadUtils
      .downloadFile("https://example.com/model.bin", destination, { maxRetries: 0 })
      .catch((error) => error);
    assert.equal(failure.code, code === "CERT_HAS_EXPIRED" ? "TLS_ERROR" : code);
    assert.equal(failure.keptBytes, 0);
    assert.equal(fs.existsSync(`${destination}.tmp`), false);
  });
}

test("a retryable request error reports only bytes actually retained on disk", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downloadUtils-reset-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const destination = path.join(dir, "model.bin");
  fs.writeFileSync(`${destination}.tmp`, "hello");
  const loaded = loadWithResponses([
    { requestError: Object.assign(new Error("fixture reset"), { code: "ECONNRESET" }) },
  ]);
  t.after(loaded.restore);
  const failure = await loaded.downloadUtils
    .downloadFile("https://example.com/model.bin", destination, { maxRetries: 0 })
    .catch((error) => error);
  assert.equal(failure.keptBytes, 5);
  assert.equal(fs.readFileSync(`${destination}.tmp`, "utf8"), "hello");
});

// Load the complete production handler module, replacing unrelated services.
// No constructor, profile, runtime, provider, credentials or native access.
function parakeetIpcFixture() {
  const vm = require("node:vm");
  const handlers = new Map(),
    sent = [];
  const module = { exports: {} };
  const inert = () =>
    new Proxy(function () {}, {
      get: (_, key) => (key === "then" ? undefined : inert()),
      apply: () => inert(),
      construct: () => inert(),
    });
  vm.runInNewContext(
    fs.readFileSync(path.resolve(__dirname, "../../src/helpers/ipcHandlers.js"), "utf8"),
    {
      module,
      exports: module.exports,
      process,
      Date,
      setTimeout,
      clearTimeout,
      require: (name) =>
        name === "electron"
          ? { ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} } }
          : inert(),
    }
  );
  const LocalModelDownloadStatus = require("../../src/helpers/localModelDownloadStatus");
  const context = new Proxy(
    {
      localModelDownloadStatus: new LocalModelDownloadStatus(),
      windowManager: { sendToControlPanel: (name, data) => sent.push([name, data]) },
      parakeetManager: {},
    },
    { get: (target, key) => (key in target ? target[key] : inert()) }
  );
  module.exports.prototype.setupHandlers.call(context);
  return { context, sent, invoke: (model) => handlers.get("download-parakeet-model")({}, model) };
}

test("main's Parakeet handler propagates retained-byte evidence in both terminal payload and result", async () => {
  const h = parakeetIpcFixture();
  for (const keptBytes of [5, 0, undefined, Number.NaN]) {
    h.sent.length = 0;
    h.context.parakeetManager.downloadParakeetModel = async () => {
      throw Object.assign(new Error("fixture reset"), { code: "ECONNRESET", keptBytes });
    };
    const result = await h.invoke("fixture-model");
    const expected = Number.isFinite(keptBytes) ? keptBytes : null;
    assert.equal(result.success, false);
    assert.equal(result.keptBytes, expected);
    assert.equal(result.code, "ECONNRESET");
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0][0], "parakeet-download-progress");
    assert.equal(h.sent[0][1].type, "error");
    assert.equal(h.sent[0][1].model, "fixture-model");
    assert.equal(h.sent[0][1].keptBytes, expected);
    assert.equal(h.context.localModelDownloadStatus.has("parakeet", "fixture-model"), false);
  }
});

function gate() {
  let release;
  const promise = new Promise((resolve) => (release = resolve));
  return { promise, release };
}

for (const abortDuring of ["writer close", "retained stat"]) {
  test(
    `acknowledged cancellation during network failure ${abortDuring} deletes only after close`,
    { timeout: 5000 },
    async (t) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downloadUtils-teardown-"));
      const destination = path.join(dir, "model.bin");
      const tempPath = `${destination}.tmp`;
      const response = new PassThrough();
      const responseReady = gate();
      response.once("resume", responseReady.release);
      const loaded = loadWithResponses([
        { statusCode: 200, headers: { "content-length": "10" }, stream: response },
      ]);
      const originalCreate = fs.createWriteStream;
      const originalStat = fs.promises.stat;
      const originalUnlink = fs.promises.unlink;
      const written = gate(),
        blocked = gate(),
        release = gate();
      const order = [];
      let writer;
      let statCalls = 0;
      fs.createWriteStream = (filePath, options) => {
        if (filePath !== tempPath) return originalCreate(filePath, options);
        writer = originalCreate(filePath, {
          ...options,
          fs: {
            open: fs.open.bind(fs),
            write: (...args) => {
              const callback = args.pop();
              fs.write(...args, (...result) => {
                callback(...result);
                written.release();
              });
            },
            close: (...args) => {
              if (abortDuring === "writer close") {
                blocked.release();
                release.promise.then(() => fs.close(...args));
              } else fs.close(...args);
            },
          },
        });
        writer.once("close", () => order.push("close"));
        return writer;
      };
      fs.promises.stat = async (filePath, ...args) => {
        if (filePath !== tempPath || ++statCalls !== 2 || abortDuring !== "retained stat")
          return originalStat(filePath, ...args);
        const stats = await originalStat(filePath, ...args);
        assert.equal(writer.closed, true, "retention stat follows actual writer close");
        blocked.release();
        await release.promise;
        return stats;
      };
      fs.promises.unlink = async (filePath, ...args) => {
        if (filePath === tempPath) {
          assert.equal(writer.closed, true, "no unlink before actual writer close");
          order.push("unlink");
        }
        return originalUnlink(filePath, ...args);
      };
      t.after(() => {
        release.release();
        fs.createWriteStream = originalCreate;
        fs.promises.stat = originalStat;
        fs.promises.unlink = originalUnlink;
        loaded.restore();
        fs.rmSync(dir, { recursive: true, force: true });
      });
      const { signal, abort } = loaded.downloadUtils.createDownloadSignal();
      // Exercise the real main cancel method without constructing a runtime or profile.
      const manager = Object.create(ParakeetManager.prototype);
      manager.currentDownloadProcess = { phase: "progress", abort };
      let settled = false;
      const done = loaded.downloadUtils
        .downloadFile("https://example.com/model.bin", destination, { signal, maxRetries: 0 })
        .catch((error) => error)
        .finally(() => {
          settled = true;
          manager.currentDownloadProcess = null;
        });
      // Wait for the real pipeline to consume the response, without polling the disk.
      await responseReady.promise;
      assert.equal(loaded.requestInstances.length, 1, "fixture request admitted");
      response.write("hello");
      await written.promise;
      loaded.requestInstances[0].emit(
        "error",
        Object.assign(new Error("fixture reset"), { code: "ECONNRESET" })
      );
      await blocked.promise;
      assert.equal(signal.onAbort, null, "the original failure is already tearing down");
      assert.equal(settled, false);
      if (abortDuring === "writer close") assert.equal(writer.closed, false);
      const acknowledgement = await manager.cancelDownload();
      assert.equal(acknowledgement.success, true);
      assert.equal(signal.aborted, true);
      assert.equal(fs.readFileSync(tempPath, "utf8"), "hello");
      assert.equal(
        order.includes("unlink"),
        false,
        "the owned pending operation still holds the temp"
      );
      release.release();
      const failure = await done;
      assert.deepEqual(
        {
          isAbort: failure.isAbort,
          message: failure.message,
          code: failure.code,
          keptBytes: failure.keptBytes,
          tempExists: fs.existsSync(tempPath),
          destinationExists: fs.existsSync(destination),
          order,
        },
        {
          isAbort: true,
          message: "Download cancelled",
          code: undefined,
          keptBytes: 0,
          tempExists: false,
          destinationExists: false,
          order: ["close", "unlink"],
        },
        "accepted Stop supersedes the network error and removes the closed partial"
      );
      assert.equal(
        (await manager.cancelDownload()).success,
        false,
        "settled work releases cancel ownership"
      );
    }
  );
}

test("an ordinary network retry resumes the partial within the same downloadFile call", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downloadUtils-retry-"));
  const destination = path.join(dir, "model.bin");
  const loaded = loadWithResponses([
    { statusCode: 200, headers: { "content-length": "10" }, body: Buffer.from("hello") },
    {
      statusCode: 206,
      headers: { "content-range": "bytes 5-9/10", "content-length": "5" },
      body: Buffer.from("world"),
    },
  ]);
  t.after(() => {
    loaded.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  assert.equal(
    await loaded.downloadUtils.downloadFile("https://example.com/model.bin", destination, {
      maxRetries: 1,
    }),
    destination
  );
  assert.equal(loaded.requests.length, 2);
  assert.equal(loaded.requests[1].Range, "bytes=5-");
  assert.equal(fs.readFileSync(destination, "utf8"), "helloworld");
  assert.equal(fs.existsSync(`${destination}.tmp`), false);
});

for (const reason of ["EPERM", "EBUSY"]) {
  test(`failed ${reason} unlink reports retained bytes for rejected and cancelled downloads`, async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "download-truth-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const destination = path.join(dir, "model.bin");
    for (const cancel of [false, true]) {
      fs.writeFileSync(`${destination}.tmp`, "all original bytes");
      const loaded = loadWithResponses([
        { requestError: Object.assign(new Error("fixture refusal"), { code: "CERT_HAS_EXPIRED" }) },
      ]);
      t.after(loaded.restore);
      const unlink = t.mock.method(fs.promises, "unlink", async () => {
        throw Object.assign(new Error("fixture locked file"), { code: reason });
      });
      const signal = AbortSignal.abort();
      const failure = await loaded.downloadUtils
        .downloadFile("https://example.invalid/model", destination, {
          maxRetries: 0,
          ...(cancel ? { signal } : {}),
        })
        .catch((error) => error);
      assert.equal(failure.keptBytes, 18);
      assert.equal(failure.cleanupFailed, true);
      assert.equal(fs.readFileSync(`${destination}.tmp`, "utf8"), "all original bytes");
      unlink.mock.restore();
    }
  });
}

test("failed unlink plus failed stat is explicit unknown; missing partial is known zero", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "download-unknown-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const destination = path.join(dir, "model.bin");
  const loaded = loadWithResponses([]);
  t.after(loaded.restore);
  const unlink = t.mock.method(fs.promises, "unlink", async () => {
    throw Object.assign(new Error("locked"), { code: "EPERM" });
  });
  const stat = t.mock.method(fs.promises, "stat", async () => {
    throw Object.assign(new Error("unknown"), { code: "EACCES" });
  });
  const failure = await loaded.downloadUtils
    .downloadFile("https://example.invalid/model", destination, { signal: AbortSignal.abort() })
    .catch((error) => error);
  assert.equal(failure.keptBytes, null);
  assert.equal(failure.cleanupFailed, true);
  unlink.mock.restore();
  stat.mock.restore();
  const missing = await loaded.downloadUtils
    .downloadFile("https://example.invalid/model", destination, { signal: AbortSignal.abort() })
    .catch((error) => error);
  assert.equal(missing.keptBytes, 0);
  assert.equal(missing.cleanupFailed, false);
});
