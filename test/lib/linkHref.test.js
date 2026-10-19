const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/linkHref.ts");

test("web and mail links are allowed", async () => {
  const { sanitizeLinkHref } = await load();
  assert.equal(sanitizeLinkHref("https://loqui.app/docs"), "https://loqui.app/docs");
  assert.equal(sanitizeLinkHref("  http://localhost:3000  "), "http://localhost:3000/");
  assert.equal(sanitizeLinkHref("mailto:maya@acme.co"), "mailto:maya@acme.co");
});

test("a bare domain becomes https", async () => {
  const { sanitizeLinkHref } = await load();
  assert.equal(sanitizeLinkHref("loqui.app/pricing"), "https://loqui.app/pricing");
});

test("script, data, file and workspace schemes are refused", async () => {
  const { sanitizeLinkHref } = await load();
  for (const bad of [
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    " java\tscript:alert(1)",
    "data:text/html,<b>x</b>",
    "file:///etc/passwd",
    "vbscript:x",
    "note:17",
    "",
    "   ",
    "not a link",
  ]) {
    assert.equal(sanitizeLinkHref(bad), null, JSON.stringify(bad));
  }
});

test("C0 and DEL obfuscations never admit script, data, file or workspace hrefs", async () => {
  const { sanitizeLinkHref } = await load();
  for (const code of [...Array(32).keys(), 127]) {
    const control = String.fromCharCode(code);
    for (const scheme of ["javascript", "data", "file", "note", "meeting", "folder", "dictation"]) {
      assert.equal(
        sanitizeLinkHref(`${scheme.slice(0, 2)}${control}${scheme.slice(2)}:payload`),
        null
      );
    }
  }
  for (const bad of [
    "#anchor",
    "../note",
    "tel:+123",
    "ftp://fixture.invalid",
    "//example.invalid",
    "https://",
    "https://a b.invalid",
  ])
    assert.equal(sanitizeLinkHref(bad), null, bad);
});
