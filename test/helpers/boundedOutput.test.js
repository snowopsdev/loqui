const test = require("node:test");
const assert = require("node:assert/strict");
const { installElectronStub } = require("./harness/electronStub");

installElectronStub();

const {
  BoundedOutput,
  capPendingLine,
  DEFAULT_HEAD_CHARS,
  DEFAULT_TAIL_CHARS,
  MAX_PENDING_LINE_CHARS,
} = require("../../src/helpers/boundedOutput");

test("short output is retained verbatim", () => {
  const output = new BoundedOutput();
  output.append("ggml_vulkan: 0 = NVIDIA\n").append(Buffer.from("server listening\n"));
  assert.equal(output.toString(), "ggml_vulkan: 0 = NVIDIA\nserver listening\n");
});

test("a long-running sidecar's stderr stays within the head + tail ceiling", () => {
  const output = new BoundedOutput();
  output.append("startup: device probe\n");
  const line = "slot update: n_past = 1234, tokens processed\n";
  for (let i = 0; i < 200_000; i += 1) output.append(line);
  output.append("FATAL: out of memory\n");

  assert.ok(output.length <= DEFAULT_HEAD_CHARS + DEFAULT_TAIL_CHARS);
  const text = output.toString();
  assert.ok(text.startsWith("startup: device probe\n"), "startup diagnostics survive");
  assert.ok(text.endsWith("FATAL: out of memory\n"), "the latest failure survives");
  assert.match(text, /\[\.\.\. \d+ characters omitted \.\.\.\]/);
  assert.ok(text.length < 40 * 1024, `retained ${text.length} chars`);
});

test("a single oversized chunk is split between head and tail", () => {
  const output = new BoundedOutput({ headChars: 4, tailChars: 4 });
  output.append("abcdefghijklmnop");
  assert.equal(output.head, "abcd");
  assert.equal(output.tail, "mnop");
  assert.equal(output.droppedChars, 8);
});

test("an unterminated helper line is dropped once it exceeds the cap", () => {
  const dropped = [];
  assert.equal(capPendingLine("partial", 16), "partial");
  assert.equal(
    capPendingLine("x".repeat(17), 16, (chars) => dropped.push(chars)),
    ""
  );
  assert.deepEqual(dropped, [17]);
});

for (const modulePath of [
  "../../src/helpers/audioTapManager",
  "../../src/helpers/linuxPortalAudioManager",
  "../../src/helpers/meetingAecManager",
]) {
  test(`${modulePath.split("/").at(-1)} bounds its newline-framed stderr buffer`, () => {
    const Manager = require(modulePath);
    const manager = { stderrBuffer: "" };
    const messages = [];
    const consume = (chunk) =>
      Manager.prototype._consumeStderr.call(manager, chunk, (message) => messages.push(message));

    // A helper that never emits a newline must not grow the buffer forever.
    const blob = "y".repeat(16 * 1024);
    for (let i = 0; i < 64; i += 1) consume(Buffer.from(blob));
    assert.ok(manager.stderrBuffer.length <= MAX_PENDING_LINE_CHARS);

    // Framing recovers for the next well-formed message.
    consume(Buffer.from('\n{"type":"start"}\n'));
    assert.deepEqual(messages, [{ type: "start" }]);
    assert.equal(manager.stderrBuffer, "");
  });
}
