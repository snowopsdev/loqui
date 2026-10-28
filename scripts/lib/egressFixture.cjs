// Logging fixture server for the sealed-mode acceptance run (Plan 07, Task 16).
//
// As the *remote* fixture it is the independent observer: it stands in for the
// internet, and anything it logs while Loqui is sealed left Loqui. It logs every
// TCP connection as well as every request, so a speculative preconnect that
// never sends a request is still seen. It does not import or consult any Loqui
// code. As the *local* fixture it is addressed only as 127.0.0.1, and its
// /redirect points at another origin (`redirectTo`).
//
// It binds only an ephemeral port on the exact numeric loopback 127.0.0.1. It
// logs metadata only: time, Host header, path, method, whether the request was
// an upgrade, and whether Loqui's internal egress tag header arrived (by name,
// never its value).
const http = require("node:http");

const FIXTURE_HOST = "127.0.0.1";
// Remote-looking names under a reserved test TLD (RFC 2606). Chromium maps them
// to the fixture with --host-resolver-rules; Node probes pass their own lookup.
const FIXTURE_DOMAIN = "loqui-fixture.test";
// Loqui's gate tags its own requests with this header and the session backstop
// strips it before a request leaves (Task 6). Seeing it at the fixture means a
// tagged request left with the tag still attached.
const EGRESS_TAG_HEADER = "x-loqui-egress";
const UPDATE_MANIFEST =
  "version: 0.0.1\npath: none.zip\nsha512: none\nreleaseDate: '2026-01-01T00:00:00.000Z'\n";

function redirectOrigin(redirectTo) {
  if (redirectTo === null || redirectTo === undefined) return null;
  const url = new URL(String(redirectTo));
  if (url.protocol !== "http:") throw new Error("redirectTo must be an http: origin");
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password)
    throw new Error("redirectTo must be a bare origin");
  return url.origin;
}

function startEgressFixture({ redirectTo = null, now = Date.now } = {}) {
  const origin = redirectOrigin(redirectTo);
  const hits = [];
  const connections = [];
  const sockets = new Set();
  const log = (req, upgrade) =>
    hits.push({
      at: now(),
      host: String(req.headers.host || ""),
      path: String(req.url || ""),
      method: String(req.method || ""),
      upgrade,
      egressTagged: Object.hasOwn(req.headers, EGRESS_TAG_HEADER),
    });

  const server = http.createServer((req, res) => {
    log(req, false);
    if (req.url === "/redirect" && origin) {
      res.writeHead(302, { location: `${origin}/after-redirect` });
      return res.end();
    }
    if (String(req.url).split("?")[0].endsWith(".yml")) {
      res.writeHead(200, { "content-type": "text/yaml" });
      return res.end(UPDATE_MANIFEST);
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  // A WebSocket handshake is logged as a hit and refused: being seen is enough.
  server.on("upgrade", (req, socket) => {
    log(req, true);
    socket.destroy();
  });
  // Every TCP connection, including ones that never send a byte.
  server.on("connection", (socket) => {
    connections.push({ at: now() });
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  let closing = null;
  const close = () => {
    if (!closing)
      closing = new Promise((resolve) => {
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections?.();
      });
    return closing;
  };

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const { address, port } = server.address();
      if (address !== FIXTURE_HOST) {
        server.close();
        reject(new Error(`Fixture bound ${address}, not ${FIXTURE_HOST}`));
        return;
      }
      resolve({
        host: FIXTURE_HOST,
        port,
        get hits() {
          return hits.map((hit) => ({ ...hit }));
        },
        get listening() {
          return server.listening;
        },
        // Requests and bare connections at or after `since` (a preconnect
        // sends no request). A hit exactly at the mark counts as seen.
        seenSince: (since = 0) => ({
          requests: hits.filter((hit) => hit.at >= since).map((hit) => ({ ...hit })),
          connections: connections.filter((entry) => entry.at >= since).length,
        }),
        close,
      });
    });
  });
}

module.exports = { startEgressFixture, FIXTURE_HOST, FIXTURE_DOMAIN, EGRESS_TAG_HEADER };
