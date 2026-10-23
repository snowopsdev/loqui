const fs = require("fs");

// scripts/build-sherpa-websocket.js builds the pinned sherpa-onnx WebSocket
// servers with resources/patches/sherpa-onnx-loopback.patch: they listen on
// 127.0.0.1 only and print this startup line. Upstream builds listen on every
// IPv4 interface and print "Listening on: <port>".
const LOOPBACK_LISTEN_MARKER = "Listening on: 127.0.0.1:";

function isLoopbackSherpaBinary(binaryPath, readFile = fs.readFileSync) {
  try {
    return readFile(binaryPath).includes(LOOPBACK_LISTEN_MARKER);
  } catch {
    return false;
  }
}

module.exports = { LOOPBACK_LISTEN_MARKER, isLoopbackSherpaBinary };
