const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");
const { QdrantClient } = require("@qdrant/js-client-rest");

function loadIndex() {
  const modulePath = require.resolve("../../src/helpers/vectorIndex");
  delete require.cache[modulePath];
  const originalLoad = Module._load;
  const errors = [];
  const embedded = [];
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === modulePath && request === "./localEmbeddings") {
      return {
        embedText: async (text) => {
          embedded.push(text);
          return new Float32Array([0.5, -0.25]);
        },
      };
    }
    if (parent?.filename === modulePath && request === "./debugLogger") {
      return { debug: (message, details) => errors.push({ message, details }) };
    }
    return originalLoad(request, parent, isMain);
  };
  try {
    return { index: require(modulePath), errors, embedded };
  } finally {
    Module._load = originalLoad;
  }
}

async function setup(t, { points = [], status = 200 } = {}) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      method: request.method,
      url: request.url,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ result: { points }, status: "ok", time: 0.001 }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const loaded = loadIndex();
  loaded.index.client = new QdrantClient({
    url: `http://127.0.0.1:${server.address().port}`,
    checkCompatibility: false,
  });
  return { ...loaded, requests };
}

test("note search uses the real Qdrant query API and preserves filter, limit, and scores", async (t) => {
  const { index, requests, embedded, errors } = await setup(t, {
    points: [
      { id: 42, score: 0.875 },
      { id: 17, score: 0.625 },
    ],
  });
  const filter = { must: [{ key: "space_id", match: { value: "personal" } }] };

  assert.deepEqual(await index.search("meeting notes", 2, filter), [
    { noteId: 42, score: 0.875 },
    { noteId: 17, score: 0.625 },
  ]);
  assert.deepEqual(embedded, ["meeting notes"]);
  assert.deepEqual(requests, [
    {
      method: "POST",
      url: "/collections/notes/points/query",
      body: { query: [0.5, -0.25], limit: 2, filter },
    },
  ]);
  assert.deepEqual(errors, []);
});

test("conversation query requests payloads and ranks distinct conversations above the threshold", async (t) => {
  const { index, requests, errors } = await setup(t, {
    points: [
      { id: 1000, score: 0.6, payload: { conversation_id: 1 } },
      { id: 1001, score: 0.9, payload: { conversation_id: 1 } },
      { id: 2000, score: 0.8, payload: { conversation_id: 2 } },
      { id: 3000, score: 0.7, payload: { conversation_id: 3 } },
      { id: 4000, score: 0.29, payload: { conversation_id: 4 } },
    ],
  });

  assert.deepEqual(await index.searchConversations("project decisions", 2), [
    { conversationId: 1, score: 0.9 },
    { conversationId: 2, score: 0.8 },
  ]);
  assert.deepEqual(requests, [
    {
      method: "POST",
      url: "/collections/conversation_chunks/points/query",
      body: { query: [0.5, -0.25], limit: 6, with_payload: true },
    },
  ]);
  assert.deepEqual(errors, []);
});

test("empty query results preserve empty search results", async (t) => {
  const { index, errors } = await setup(t);
  assert.deepEqual(await index.search("unknown"), []);
  assert.deepEqual(await index.searchConversations("unknown"), []);
  assert.deepEqual(errors, []);
});

test("Qdrant failures remain recoverable for both search entry points", async (t) => {
  const { index, requests, errors } = await setup(t, { status: 503 });
  assert.deepEqual(await index.search("notes"), []);
  assert.deepEqual(await index.searchConversations("chat"), []);
  assert.equal(requests.length, 2);
  assert.deepEqual(
    errors.map(({ message }) => message),
    ["Vector search failed", "Conversation search failed"]
  );
});
