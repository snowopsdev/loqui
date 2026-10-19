const test = require("node:test");
const assert = require("node:assert/strict");
const { mountComposer: mount } = require("../helpers/harness/mountComposer");

test("an IME candidate commit never reaches the mention picker or submits (I10)", async (t) => {
  const sent = [];
  const intercepted = [];
  const c = await mount(t, async (text) => (sent.push(text), true), {
    interceptKeyDown: (e) => (intercepted.push(e.key), true),
  });
  await c.type("@pri");
  await c.press("Enter", { isComposing: true });
  await c.press("Enter", { keyCode: 229 });
  assert.deepEqual(intercepted, []);
  assert.deepEqual(sent, []);
});

test("with the picker open, Enter selects a mention instead of submitting", async (t) => {
  const sent = [];
  const c = await mount(t, async (text) => (sent.push(text), true), {
    interceptKeyDown: () => true,
  });
  await c.type("@pri");
  await c.press("Enter");
  assert.deepEqual(sent, []);
});

test("with the picker closed, Enter submits as usual", async (t) => {
  const sent = [];
  const c = await mount(t, async (text) => (sent.push(text), true), {
    interceptKeyDown: () => false,
  });
  await c.type("hello");
  await c.press("Enter");
  assert.deepEqual(sent, ["hello"]);
});

test("all draft writes mirror without callback identity loops", async (t) => {
  const seen = [];
  const c = await mount(t, async () => false, {
    onDraftChange: (text, caret) => seen.push([text, caret]),
  });
  await c.type("hello");
  assert.deepEqual(seen.at(-1), ["hello", 5]);
  await c.render({ seed: { nonce: 1, text: "@pri", resetQueue: false } });
  assert.deepEqual(seen.at(-1), ["@pri", 4]);
  await c.render({ onDraftChange: (text, caret) => seen.push([text, caret]) });
  const count = seen.length;
  await c.render({ onDraftChange: (text, caret) => seen.push([text, caret]) });
  assert.equal(seen.length, count);
  await c.press("Enter");
  assert.deepEqual(seen.slice(-2), [
    ["", 0],
    ["@pri", 4],
  ]);
});

test("caret-only selection and voice append mirror the current textarea", async (t) => {
  const seen = [];
  const c = await mount(t, async () => true, {
    onDraftChange: (text, caret) => seen.push([text, caret]),
  });
  await c.type("one @pri suffix");
  await c.select(8);
  assert.deepEqual(seen.at(-1), ["one @pri suffix", 8]);
  await c.voice("spoken words");
  assert.equal(c.value(), "one @pri suffix spoken words");
  assert.deepEqual(seen.at(-1), [c.value(), c.value().length]);
});
