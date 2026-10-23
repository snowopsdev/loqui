const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { registerHttpServerCleanup } = require("./harness/httpServerCleanup");
const { ipcDownloaderLeaf } = require("./harness/ipcDownloaderLeaf");
const { installOwnedLoopback } = require("./harness/ownedLoopback");

const events = [];
installOwnedLoopback((event) => events.push(event));

test("shared HTTP cleanup awaits close and closes connections after listener retirement", async () => {
  const callbacks = [];
  const calls = [];
  let finish;
  registerHttpServerCleanup(
    { after: (callback) => callbacks.push(callback) },
    {
      close(callback) {
        calls.push("close");
        finish = callback;
      },
      closeAllConnections() {
        calls.push("connections");
      },
    }
  );
  assert.equal(callbacks.length, 1);
  let settled = false;
  const cleanup = callbacks[0]().then(() => {
    settled = true;
  });
  assert.deepEqual(calls, ["close", "connections"]);
  await Promise.resolve();
  assert.equal(settled, false, "cleanup must await the close callback");
  finish();
  await cleanup;
  assert.equal(settled, true);
});

test("shared HTTP cleanup preserves callback and synchronous errors", async () => {
  for (const failure of ["callback", "close", "connections"]) {
    let cleanup;
    const expected = new Error(failure);
    const calls = [];
    registerHttpServerCleanup(
      {
        after: (callback) => {
          cleanup = callback;
        },
      },
      {
        close(callback) {
          calls.push("close");
          if (failure === "close") throw expected;
          if (failure === "callback") callback(expected);
        },
        closeAllConnections() {
          calls.push("connections");
          if (failure === "connections") throw expected;
        },
      }
    );
    await assert.rejects(cleanup(), (error) => error === expected);
    assert.deepEqual(calls, failure === "close" ? ["close"] : ["close", "connections"]);
  }
});

test("shared HTTP cleanup retires the exact owned port before its awaited close completes", async () => {
  const server = http.createServer((_request, response) => response.end("owned"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;
  let cleanup;
  registerHttpServerCleanup(
    {
      after: (callback) => {
        cleanup = callback;
      },
    },
    server
  );
  try {
    assert.equal(await (await fetch(url)).text(), "owned");
  } finally {
    const pending = cleanup();
    assert.ok(events.some((event) => event.event === "retired" && event.port === port));
    assert.throws(() => http.get(url), /Fixture network denied/);
    await pending;
  }
  assert.equal(server.listening, false);
  assert.throws(() => http.get("http://example.invalid/"), /Fixture network denied/);
  assert.throws(() => http.get("http://127.0.0.1:1/"), /Fixture network denied/);
});

test("shared downloader leaf requires the exact IPC parent and request through awaited work", async () => {
  const parent = { filename: require.resolve("../../src/helpers/ipcHandlers") };
  const fallback = Symbol("unchanged guarded loader");
  const resolve = (request, owner) => ipcDownloaderLeaf(request, owner) ?? fallback;
  for (const owner of [undefined, {}, { filename: parent.filename + ".other" }]) {
    assert.equal(resolve("./urlAudioDownloader", owner), fallback);
  }
  for (const request of ["urlAudioDownloader", "./urlAudioDownloader.js", "./runtimeInstaller"]) {
    assert.equal(resolve(request, parent), fallback);
  }
  const leaf = resolve("./urlAudioDownloader", parent);
  assert.deepEqual(Object.keys(leaf).sort(), ["download", "sweepStaleTempArtifacts"]);
  assert.equal(leaf.sweepStaleTempArtifacts(), undefined);
  await Promise.resolve();
  assert.throws(() => leaf.download(), /Fixture blocks downloads/);
  assert.throws(
    () => resolve("./urlAudioDownloader", parent).download(),
    /Fixture blocks downloads/
  );
});
