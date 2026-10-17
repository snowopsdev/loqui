const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const repoRoot = path.join(__dirname, "../..");
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.([cm]?[jt]sx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}
test("no renderer code imports the retired toast system", () => {
  const offenders = walk(path.join(repoRoot, "src")).filter((file) =>
    /from\s+["'][^"']*(ui\/Toast|useToast|toastPresentation|DictationErrorCard)["']/.test(
      fs.readFileSync(file, "utf8")
    )
  );
  assert.deepEqual(
    offenders.map((f) => path.relative(repoRoot, f)),
    []
  );
});
test("no component calls a bare toast()", () => {
  const offenders = walk(path.join(repoRoot, "src")).filter((file) =>
    /(^|[^.\w])toast\s*\(\s*\{/m.test(fs.readFileSync(file, "utf8"))
  );
  assert.deepEqual(
    offenders.map((f) => path.relative(repoRoot, f)),
    []
  );
});
test("the toast files are gone and notices own the surface", () => {
  for (const gone of [
    "src/components/ui/Toast.tsx",
    "src/components/ui/useToast.ts",
    "src/helpers/toastPresentation.js",
    "src/components/dictation/DictationErrorCard.tsx",
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, gone)), false, gone);
  }
  const css = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  assert.doesNotMatch(css, /\.toast-|@keyframes toast-/);
});

test("test consumers no longer load or mock the retired modules", () => {
  const offenders = walk(path.join(repoRoot, "test")).filter(
    (file) =>
      file !== __filename &&
      /["'][^"'\n]*(?:ui\/Toast|useToast|toastPresentation|DictationErrorCard)[^"'\n]*["']/.test(
        fs.readFileSync(file, "utf8")
      )
  );
  assert.deepEqual(
    offenders.map((f) => path.relative(repoRoot, f)),
    []
  );
});
