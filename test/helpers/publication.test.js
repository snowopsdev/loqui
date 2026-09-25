const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathIssue, contentIssue, checkFiles } = require("../../scripts/check-publication.cjs");

test("publication rejects private files and downloaded artifacts but permits source assets", () => {
  for (const file of [
    ".env",
    ".env.staging",
    "keys/sign.pfx",
    "auth.json",
    "local.sqlite-wal",
    "recording.db-journal",
    "runtime.so.1",
    "model.gguf",
    "Loqui.tar.gz",
    "resources/bin/helper",
    "src/assets/fonts/yowza/README.md",
    "src/components/icons/paid-icon.tsx",
  ])
    assert.ok(pathIssue(file), file);
  for (const file of [
    ".env.example",
    ".env.template",
    "runtime-assets.json",
    "licenses/noto-sans.txt",
    "src/assets/icon.icns",
    "src/assets/brand/mark.png",
    "src/assets/fonts/NotoSans.woff2",
    "src/components/icons/index.ts",
    "src/components/icons/createIcon.tsx",
    "src/components/icons/primitives.tsx",
  ])
    assert.equal(pathIssue(file), null, file);
});

test("publication detects renamed binaries, databases and keys without printing contents", () => {
  for (const hex of ["7f454c460000", "cffaedfe0000", "cafebabe0000", "4d5a0000"])
    assert.match(contentIssue(Buffer.from(hex, "hex"), 6), /executable/);
  assert.match(contentIssue(Buffer.from("SQLite format 3\0private"), 23), /database/);
  assert.match(contentIssue(Buffer.from("GGUF"), 4), /model/);
  const privateKeyHeader = ["-----BEGIN", "OPENSSH PRIVATE", "KEY-----"].join(" ");
  assert.match(contentIssue(Buffer.from(privateKeyHeader), privateKeyHeader.length), /private key/);
  assert.equal(contentIssue(Buffer.from("<svg />"), 7), null);
  assert.match(contentIssue(Buffer.alloc(0), 11 * 1024 * 1024), /limit/);
});

test("publication skips deleted files and never follows external symlinks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-publication-test-"));
  try {
    fs.writeFileSync(path.join(root, "note.md"), "Public source");
    fs.writeFileSync(path.join(root, "renamed"), Buffer.from("7f454c46", "hex"));
    fs.symlinkSync(path.join(root, "note.md"), path.join(root, "absolute-link"));
    fs.symlinkSync("note.md", path.join(root, "relative-link"));
    fs.symlinkSync("../../missing-private-file", path.join(root, "broken-link"));
    const issues = checkFiles(root, [
      "deleted",
      "note.md",
      "renamed",
      "absolute-link",
      "relative-link",
      "broken-link",
    ]);
    assert.deepEqual(
      issues.map((issue) => issue.file),
      ["renamed", "absolute-link", "broken-link"]
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
