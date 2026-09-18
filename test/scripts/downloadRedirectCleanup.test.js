const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

test("build downloads drain redirect bodies and release every response", async () => {
  const redirects = [];
  const payload = JSON.stringify({
    tag_name: "ready",
    html_url: "https://fixture.invalid",
    assets: [],
  });
  const server = http.createServer((req, res) => {
    if (req.url.endsWith("/first") || req.url === "/second") {
      res.writeHead(302, { Location: req.url.endsWith("/first") ? "/second" : "/payload" });
      res.end("redirect body that must be consumed");
    } else {
      res.end(payload);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "personal-download-redirect-"));
  const moduleObject = { exports: {} };
  const httpsFixture = {
    get(url, options, callback) {
      if (typeof options === "function") {
        callback = options;
        options = {};
      }
      return http.get(`${origin}${new URL(url).pathname}`, options, (response) => {
        if (response.statusCode === 302) redirects.push(response);
        callback(response);
      });
    },
  };
  try {
    vm.runInNewContext(
      fs.readFileSync(path.join(__dirname, "../../scripts/lib/download-utils.js"), "utf8"),
      {
        require: (name) => (name === "https" ? httpsFixture : require(name)),
        module: moduleObject,
        process: { env: {}, stdout: { write() {} } },
        console: { log() {} },
        URL,
        setTimeout,
      }
    );
    const output = path.join(directory, "model.bin");
    await moduleObject.exports.downloadFile("https://fixture.invalid/first", output);
    assert.equal(fs.readFileSync(output, "utf8"), payload);
    const result = await moduleObject.exports.fetchLatestRelease("fixture", { tag: "first" });
    assert.equal(result.tag, "ready");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(redirects.length, 4);
    assert.ok(redirects.every((response) => response.readableEnded));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
