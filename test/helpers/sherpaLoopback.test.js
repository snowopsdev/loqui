const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  LOOPBACK_LISTEN_MARKER,
  isLoopbackSherpaBinary,
} = require("../../src/helpers/sherpaLoopback");

test("only a binary carrying the patched startup line counts as the loopback build", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sherpa-loopback-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, text) => {
    const file = path.join(dir, name);
    fs.writeFileSync(
      file,
      Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0]), Buffer.from(text)])
    );
    return file;
  };

  assert.equal(LOOPBACK_LISTEN_MARKER, "Listening on: 127.0.0.1:");
  assert.equal(isLoopbackSherpaBinary(write("patched", "\0Listening on: 127.0.0.1:%d\0")), true);
  assert.equal(isLoopbackSherpaBinary(write("upstream", "\0Listening on: %d\0")), false);
  assert.equal(isLoopbackSherpaBinary(path.join(dir, "missing")), false);
});
