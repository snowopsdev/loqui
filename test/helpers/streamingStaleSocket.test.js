const test = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { WebSocketServer } = WebSocket;

const DeepgramStreaming = require("../../src/helpers/deepgramStreaming");
const AssemblyAiStreaming = require("../../src/helpers/assemblyAiStreaming");
const CortiStreaming = require("../../src/helpers/cortiStreaming");
const { GeminiLiveStreaming } = require("../../src/helpers/geminiLiveStreaming");

// Loopback provider: the first socket completes its handshake at once; the next
// one answers late, so the previous socket's close event (one round trip after
// cleanup()) arrives while the replacement is still connecting. That is what a
// liveness reconnect or a stale-connection restart looks like on the wire.
async function withLoopback(handshake, run) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  let sockets = 0;
  server.on("connection", (socket) => {
    const id = ++sockets;
    if (id === 1) handshake(socket);
    else setTimeout(() => socket.readyState === socket.OPEN && handshake(socket), 150);
  });
  try {
    await run(`ws://127.0.0.1:${server.address().port}`);
  } finally {
    for (const client of server.clients) client.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function replaceSession(streaming, options) {
  await streaming.connect(options);
  assert.equal(streaming.isConnected, true);
  streaming.cleanup();
  assert.equal(streaming.isConnected, false);

  await streaming.connect(options);
  // Let the first socket's close event land after the replacement is up.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(streaming.isConnected, true, "the replacement session was torn down");
  assert.ok(streaming.ws, "the replacement socket was dropped");
}

test("a replaced Deepgram socket's late close does not reject or kill the replacement", async () => {
  await withLoopback(
    (socket) => socket.send(JSON.stringify({ type: "Metadata", request_id: "req" })),
    async (url) => {
      const streaming = new DeepgramStreaming();
      streaming.buildWebSocketUrl = () => url;
      const lost = [];
      streaming.onConnectionLost = (error) => lost.push(error.message);
      try {
        await replaceSession(streaming, { token: "key", mode: "byok" });
        assert.deepEqual(lost, []);
      } finally {
        streaming.cleanupAll();
      }
    }
  );
});

test("a replaced AssemblyAI socket's late close does not reject or kill the replacement", async () => {
  await withLoopback(
    (socket) => socket.send(JSON.stringify({ type: "Begin", id: "session" })),
    async (url) => {
      const streaming = new AssemblyAiStreaming();
      streaming.buildWebSocketUrl = () => url;
      try {
        await replaceSession(streaming, { token: "token" });
      } finally {
        streaming.cleanupAll();
      }
    }
  );
});

test("a replaced Corti socket's late close does not reject or kill the replacement", async () => {
  await withLoopback(
    (socket) => socket.send(JSON.stringify({ type: "CONFIG_ACCEPTED", sessionId: "session" })),
    async (url) => {
      const streaming = new CortiStreaming();
      streaming.buildWebSocketUrl = () => url;
      try {
        await replaceSession(streaming, { token: "token", environment: "eu", tenant: "tenant" });
      } finally {
        streaming.cleanup();
      }
    }
  );
});

test("a replaced Gemini Live socket's late close does not reject or kill the replacement", async () => {
  await withLoopback(
    (socket) => socket.send(JSON.stringify({ setupComplete: {} })),
    async (url) => {
      const streaming = new GeminiLiveStreaming();
      streaming.buildWebSocketUrl = () => url;
      try {
        await replaceSession(streaming, { token: "key", mode: "byok" });
      } finally {
        streaming.cleanup();
      }
    }
  );
});

test("a replaced OpenAI realtime socket's late close does not reject or kill the replacement", async () => {
  const OpenAIRealtimeStreaming = (await import("../../src/helpers/openaiRealtimeStreaming.js"))
    .default;
  await withLoopback(
    (socket) => socket.send(JSON.stringify({ type: "session.created" })),
    async (url) => {
      const streaming = new OpenAIRealtimeStreaming();
      try {
        await replaceSession(streaming, {
          apiKey: "key",
          preconfigured: true,
          createSocket: async () => new WebSocket(url),
        });
      } finally {
        streaming.cleanup();
      }
    }
  );
});

test("a Deepgram liveness reconnect survives the unresponsive warm socket's close", async (t) => {
  // The production trigger: a warm socket that never yields Results is replaced
  // 2.5 s after the session starts, and the replacement handshake is slow.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  let sockets = 0;
  server.on("connection", (socket) => {
    const hello = () => socket.send(JSON.stringify({ type: "Metadata", request_id: "req" }));
    if (++sockets === 1) hello();
    else setImmediate(hello);
  });
  const streaming = new DeepgramStreaming();
  streaming.buildWebSocketUrl = () => `ws://127.0.0.1:${server.address().port}`;
  const lost = [];
  streaming.onConnectionLost = (error) => lost.push(error.message);
  try {
    await streaming.warmup({ token: "key", mode: "byok" });
    await streaming.connect({ token: "key", mode: "byok" });
    streaming.sendAudio(Buffer.alloc(3200));
    t.mock.timers.tick(2501);
    while (sockets < 2) await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    for (let i = 0; i < 20 && !streaming.isConnected; i++)
      await new Promise((resolve) => setImmediate(resolve));
    // Give the first socket's close frame time to be processed.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(streaming.isConnected, true);
    assert.deepEqual(lost, []);
  } finally {
    streaming.cleanupAll();
    for (const client of server.clients) client.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a Gemini Live disconnect does not wait out the turn-end budget when the socket errors", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  server.on("connection", (socket) => {
    socket.send(JSON.stringify({ setupComplete: {} }));
    socket.on("message", (data) => {
      if (!String(data).includes("audioStreamEnd")) return;
      // A reserved opcode makes the client socket emit "error", then close.
      socket._socket.write(Buffer.from([0x83, 0x00]));
    });
  });
  const streaming = new GeminiLiveStreaming();
  streaming.buildWebSocketUrl = () => `ws://127.0.0.1:${server.address().port}`;
  try {
    await streaming.connect({ token: "key", mode: "byok" });
    streaming.sendAudio(Buffer.alloc(3200));
    streaming.finalize();
    const started = Date.now();
    await streaming.disconnect();
    assert.ok(Date.now() - started < 1500, `disconnect waited ${Date.now() - started} ms`);
    assert.equal(streaming._turnEndResolve, null);
  } finally {
    streaming.cleanup();
    for (const client of server.clients) client.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
});
