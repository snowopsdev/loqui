// Paired in-memory ws boundary for protocol fixtures. No sockets, HTTP, DNS or
// provider calls. Preserve asynchronous delivery and copy bytes before completion.
const { EventEmitter } = require("node:events");
const Module = require("node:module");
function install(test) {
  const servers = new Map();
  let port = 21000;
  class Socket extends EventEmitter {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url, options = {}) {
      super();
      this.OPEN = 1;
      this.readyState = 0;
      this._socket = {
        write: () => {
          setImmediate(() => {
            this.peer?.emit("error", Error("Invalid reserved opcode"));
            this.close(1002);
          });
        },
      };
      if (!url) return;
      const parsed = new URL(url);
      const server = servers.get(Number(parsed.port));
      if (!server || parsed.hostname !== "127.0.0.1") throw Error("Unowned ws fixture destination");
      const peer = new Socket();
      this.peer = peer;
      peer.peer = this;
      setImmediate(() => {
        if (this.readyState === 3) return;
        this.readyState = peer.readyState = 1;
        server.clients.add(peer);
        this.emit("open");
        server.emit("connection", peer, {
          url: parsed.pathname + parsed.search,
          headers: Object.fromEntries(
            Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
          ),
        });
      });
    }
    send(data, done) {
      const binary = typeof data !== "string";
      const copy = binary ? Buffer.from(data) : Buffer.from(String(data));
      setImmediate(() => {
        if (this.peer && this.peer.readyState !== 3) this.peer.emit("message", copy, binary);
        done?.();
      });
    }
    ping() {
      setImmediate(() => this.emit("pong"));
    }
    close(code = 1000, reason = "") {
      if (this.readyState === 3) return;
      this.readyState = 2;
      if (this.peer) this.peer.readyState = 2;
      setImmediate(() => {
        this.readyState = 3;
        if (this.peer) this.peer.readyState = 3;
        this.emit("close", code, Buffer.from(reason));
        this.peer?.emit("close", code, Buffer.from(reason));
      });
    }
    terminate() {
      this.close(1006);
    }
  }
  class Server extends EventEmitter {
    constructor() {
      super();
      this.port = ++port;
      this.clients = new Set();
      servers.set(this.port, this);
      setImmediate(() => this.emit("listening"));
    }
    address() {
      return { port: this.port };
    }
    close(done) {
      servers.delete(this.port);
      for (const peer of this.clients) peer.close();
      setImmediate(() => done?.());
    }
  }
  Socket.WebSocketServer = Server;
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    return request === "ws" ? Socket : original.call(this, request, parent, isMain);
  };
  test.after(() => {
    Module._load = original;
    for (const server of servers.values()) server.close();
  });
  return Socket;
}
module.exports = { install };
