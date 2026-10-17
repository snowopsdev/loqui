const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");

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
  assert.equal(calls[0].init.headers["User-Agent"], "io.github.snowopsdev.loqui/0.1");
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
  const signal = new AbortController().signal;

  await downloadUtils.fetchJson("https://example.com/pinned.json", {
    headers: { Accept: "application/vnd.github+json" },
    credentials: "omit",
    cache: "no-store",
    signal,
  });

  const { init } = calls[0];
  assert.equal(init.credentials, "omit");
  assert.equal(init.cache, "no-store");
  assert.equal(init.signal, signal);
  assert.deepEqual(init.headers, {
    "User-Agent": "io.github.snowopsdev.loqui/0.1",
    Accept: "application/vnd.github+json",
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
  require.cache[electronPath] = {
    exports: {
      app: { isReady: () => false },
      net: {
        request() {
          const request = new EventEmitter();
          const headers = {};
          requests.push(headers);
          request.setHeader = (name, value) => (headers[name] = value);
          request.abort = () => {};
          request.end = () => {
            const { statusCode, headers: responseHeaders, body, requestError } = responses.shift();
            if (requestError) {
              queueMicrotask(() => request.emit("error", requestError));
              return;
            }
            const response = new PassThrough();
            response.statusCode = statusCode;
            response.headers = responseHeaders;
            response.end(body);
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
    const expected = Number.isFinite(keptBytes) ? keptBytes : 0;
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
