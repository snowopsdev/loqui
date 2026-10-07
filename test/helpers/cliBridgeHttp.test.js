const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "./windowBroadcast") return { broadcastToWindows() {} };
  return originalLoad.call(this, request, parent, isMain);
};
const CliBridge = require("../../src/helpers/cliBridge.js");
Module._load = originalLoad;

// Drives the bridge's request handler through a real loopback HTTP server so
// socket-level behavior (what the client actually receives) is exercised.
async function withBridge(run) {
  const saved = [];
  const bridge = new CliBridge({
    databaseManager: {
      saveNote: (...args) => {
        saved.push(args);
        return { success: true, note: { id: 1 } };
      },
      updateNote: (id) => ({ success: true, note: { id } }),
    },
    _asyncVectorUpsert() {},
    _asyncMirrorWrite() {},
  });
  bridge.token = "test-token";
  const server = http.createServer((req, res) => {
    bridge._handleRequest(req, res).catch(() => res.destroy());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  bridge.port = server.address().port;
  try {
    await run(bridge.port, saved);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function call(port, method, path, raw) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(raw),
        },
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve({ status: response.statusCode, body }));
      }
    );
    request.on("error", reject);
    request.end(raw);
  });
}

test("an over-long request body is refused with a readable error, not a reset connection", async () => {
  await withBridge(async (port, saved) => {
    // A reset depends on whether upload bytes are still unread when the socket
    // closes, so a single attempt only fails some of the time; repeat it.
    for (let attempt = 0; attempt < 25; attempt++) {
      const { status, body } = await call(
        port,
        "POST",
        "/v1/notes/create",
        JSON.stringify({ content: "x".repeat(3 * 1024 * 1024) })
      );
      assert.equal(status, 400);
      assert.deepEqual(JSON.parse(body), {
        error: { code: "validation_error", message: "Request body too large" },
      });
    }
    assert.equal(saved.length, 0);
  });
});

for (const [label, raw] of [
  ["null", "null"],
  ["an array", "[1,2]"],
  ["a string", '"hello"'],
  ["a number", "7"],
]) {
  test(`a request body that is ${label} is a validation error, not a crash or a default note`, async () => {
    await withBridge(async (port, saved) => {
      for (const [method, path] of [
        ["POST", "/v1/notes/create"],
        ["PATCH", "/v1/notes/3"],
      ]) {
        const { status, body } = await call(port, method, path, raw);
        assert.equal(status, 400, `${method} ${path}`);
        assert.deepEqual(JSON.parse(body), {
          error: { code: "validation_error", message: "Request body must be a JSON object" },
        });
      }
      assert.equal(saved.length, 0);
    });
  });
}
