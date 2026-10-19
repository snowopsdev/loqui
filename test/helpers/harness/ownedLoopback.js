// A fixture transport capability belongs to the exact bound server, never a host.
// Capture before another pre-import guard replaces the public network functions.
const http = require("node:http");
const net = require("node:net");
const originals = {
  fetch: globalThis.fetch,
  request: http.request,
  get: http.get,
  connect: net.connect,
  createConnection: net.createConnection,
  socketConnect: net.Socket.prototype.connect,
  listen: net.Server.prototype.listen,
  close: net.Server.prototype.close,
};
function installOwnedLoopback(record = () => {}) {
  const ports = new Map();
  const denied = (kind, host, port) => {
    record({ event: "denied", kind, host, port });
    throw new Error(`Fixture network denied: ${kind} ${host}:${port}`);
  };
  function check(kind, host, port) {
    if (host !== "127.0.0.1" || !ports.has(Number(port))) denied(kind, host, port);
    record({ event: "allowed", kind, host, port: Number(port) });
  }
  function destination(args) {
    const first = args[0];
    if (typeof first === "string" || first instanceof URL) {
      const url = new URL(first);
      return [url.hostname, url.port || (url.protocol === "https:" ? 443 : 80)];
    }
    return [first?.hostname || first?.host, first?.port];
  }
  net.Server.prototype.listen = function (...args) {
    const options = args[0];
    const host = typeof options === "object" ? options.host : args[1];
    const port = typeof options === "object" ? options.port : options;
    if (host !== "127.0.0.1" || Number(port) !== 0) denied("listen", host, port);
    this.once("listening", () => {
      const address = this.address();
      if (!address || address.address !== "127.0.0.1") throw new Error("Unowned fixture bind");
      ports.set(address.port, this);
      this.__ownedFixturePort = address.port;
      record({ event: "registered", host, port: address.port });
    });
    return originals.listen.apply(this, args);
  };
  net.Server.prototype.close = function (...args) {
    const port = this.__ownedFixturePort;
    if (ports.get(port) === this) {
      ports.delete(port);
      record({ event: "retired", host: "127.0.0.1", port });
    }
    return originals.close.apply(this, args);
  };
  for (const method of ["request", "get"]) {
    http[method] = function (...args) {
      check(`http.${method}`, ...destination(args));
      return originals[method].apply(this, args);
    };
  }
  for (const method of ["connect", "createConnection"]) {
    net[method] = function (...args) {
      const options = args[0];
      check(
        `net.${method}`,
        typeof options === "object" ? options.host : args[1],
        typeof options === "object" ? options.port : options
      );
      return originals[method].apply(this, args);
    };
  }
  net.Socket.prototype.connect = function (...args) {
    // net normalizes its public overloads before calling Socket.connect.
    const options = Array.isArray(args[0]) ? args[0][0] : args[0];
    check("socket.connect", options?.host, options?.port);
    return originals.socketConnect.apply(this, args);
  };
  globalThis.fetch = function (...args) {
    check("fetch", ...destination(args));
    return originals.fetch.apply(this, args);
  };
  return { owns: (port) => ports.has(Number(port)) };
}
module.exports = { installOwnedLoopback };
