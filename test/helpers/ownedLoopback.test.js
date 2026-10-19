const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");

const { installOwnedLoopback } = require("./harness/ownedLoopback");
installOwnedLoopback();

test("whole-plan guard rejects external, unowned and retired fixture destinations", async () => {
  assert.throws(() => http.get("http://example.invalid/"), /Fixture network denied/);
  assert.throws(() => net.connect({ host: "127.0.0.1", port: 1 }), /Fixture network denied/);
  assert.throws(() => http.createServer().listen(0, "0.0.0.0"), /Fixture network denied/);
  const server = http.createServer((_request, response) => response.end("owned"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    assert.equal(await (await fetch(url)).text(), "owned");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  assert.throws(() => http.get(url), /Fixture network denied/);
});
