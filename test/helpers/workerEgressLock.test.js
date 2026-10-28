const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const test = require("node:test");
const worker = path.resolve(__dirname, "../../src/workers/onnxWorker.js");
test("worker locks before its first ordinary import (supplementary ratchet)", () => {
  const code = fs
    .readFileSync(worker, "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .trimStart();
  assert.match(
    code,
    /^require\("\.\.\/helpers\/privacy\/egressGate"\)\.configureEgress\(\{ isSealed: \(\) => true \}\);\s*require\("\.\.\/helpers\/privacy\/egressBackstop"\)\.installNodeBackstop\(\);/
  );
});
test(
  "actual worker module locks a separate runtime before fs, without loading models",
  { timeout: 10000 },
  async (t) => {
    const script = `
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const {EventEmitter} = require('node:events');
    const gate = require(${JSON.stringify(path.resolve(__dirname, "../../src/helpers/privacy/egressGate"))});
    gate.configureEgress({isSealed: () => false});
    let leaves = 0;
    globalThis.fetch = async () => { leaves++; throw Error('terminal fetch'); };
    const dns = require('node:dns');
    dns.promises.resolveTxt = async () => { leaves++; return []; };
    const net = require('node:net');
    net.Socket.prototype.connect = function() { leaves++; return this; };
    const dgram = require('node:dgram');
    dgram.Socket.prototype.send = function() { leaves++; };
    const load = Module._load;
    let firstImportLocked = false;
    Module._load = function(name, parent, main) {
      if (parent?.filename === ${JSON.stringify(worker)} && name === 'fs') {
        assert.equal(gate.isSealed(), true); firstImportLocked = true;
      }
      if (name === 'onnxruntime-node') throw Error('models forbidden');
      return load.call(this, name, parent, main);
    };
    process.parentPort = new EventEmitter();
    require(${JSON.stringify(worker)});
    (async () => {
      assert.equal(firstImportLocked, true);
      await assert.rejects(fetch('https://worker-fixture.invalid'), {code:'SEALED_MODE'});
      await assert.rejects(dns.promises.resolveTxt('worker-fixture.invalid'), {code:'SEALED_MODE'});
      const socket = new net.Socket();
      const socketError = new Promise(resolve => socket.once('error',resolve));
      socket.connect({host:'192.0.2.1',port:9});
      assert.equal((await socketError).code,'SEALED_MODE');
      const udp = dgram.createSocket('udp4');
      const udpError = new Promise(resolve => udp.once('error',resolve));
      udp.send(Buffer.from('x'),9,'192.0.2.1');
      assert.equal((await udpError).code,'SEALED_MODE');
      udp.close();
      assert.equal(leaves,0);
      console.log('worker lock exercised');
    })().catch(e => {console.error(e);process.exitCode=1;});`;
    const c = spawn(process.execPath, ["-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
      killSignal: "SIGKILL",
      timeout: 8000,
    });
    t.after(() => {
      if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
    });
    let stderr = "",
      stdout = "";
    c.stderr.on("data", (b) => {
      stderr += b;
    });
    c.stdout.on("data", (b) => {
      stdout += b;
    });
    assert.deepEqual(await once(c, "close"), [0, null], stderr);
    assert.match(stdout, /worker lock exercised/);
  }
);
