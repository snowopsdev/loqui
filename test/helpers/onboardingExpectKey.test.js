const test = require("node:test");
const assert = require("node:assert/strict");
const { expectKey } = require("./harness/mountComponent");
test("key assertions distinguish exact keys and structured interpolation punctuation/order", () => {
  const ui = (text) => ({ text: () => text });
  assert.throws(() => expectKey(ui("long.key.extra(a=1)"), "key", { a: 1 }));
  assert.throws(() => expectKey(ui("keyish"), "key"));
  expectKey(ui("key(a=1,b=two)"), "key", { b: "two", a: 1 });
  expectKey(ui("key" + JSON.stringify({ b: "x(y),z=q", a: "()=," })), "key", {
    a: "()=,",
    b: "x(y),z=q",
  });
  assert.throws(() => expectKey(ui("key" + JSON.stringify({ a: "x,b=2" })), "key", { b: 2 }));
});
