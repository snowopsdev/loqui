const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const read = (file) => fs.readFileSync(path.join(__dirname, "../..", file), "utf8");
const source = (file) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);

test("all database methods invoked by the IPC layer exist in the personal database", () => {
  const methods = new Set();
  const collectMethods = (node) => {
    if (ts.isClassDeclaration(node) && node.name?.text === "DatabaseManager") {
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member)) methods.add(member.name.getText());
      }
    }
    ts.forEachChild(node, collectMethods);
  };
  collectMethods(source("src/helpers/database.js"));
  assert.ok(methods.size > 20, "the database class was inspected");
  const missing = new Set();
  const checkCalls = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const call = node.expression;
      if (call.expression.getText() === "this.databaseManager" && !methods.has(call.name.text)) {
        missing.add(call.name.text);
      }
    }
    ts.forEachChild(node, checkCalls);
  };
  checkCalls(source("src/helpers/ipcHandlers.js"));
  assert.deepEqual([...missing], []);
});

test("every exposed database IPC request has a registered handler", () => {
  const main = read("src/helpers/ipcHandlers.js");
  const registered = new Set(
    [...main.matchAll(/ipcMain\.handle\(\s*"([^"]+)"/g)].map((match) => match[1])
  );
  const requests = [...read("preload.js").matchAll(/ipcRenderer\.invoke\("(db-[^"]+)"/g)].map(
    (match) => match[1]
  );
  assert.ok(requests.length > 20);
  assert.deepEqual(
    requests.filter((channel) => !registered.has(channel)),
    []
  );
});

test("hosted synchronization events and denied-delete restoration are absent from the public bridge", () => {
  const preload = read("preload.js");
  const types = read("src/types/electron.ts");
  for (const name of [
    "purgeSpace",
    "setSpaceSyncStatus",
    "onSpacePurged",
    "onSpaceSynced",
    "onNoteSynced",
    "onFolderSynced",
    "emitSyncEvent",
    "onSyncEvent",
    "restoreNoteAfterDeniedDelete",
    "restoreFolderAfterDeniedDelete",
    "getPendingDictionary",
    "getPendingSnippets",
  ]) {
    assert.doesNotMatch(preload, new RegExp(`\\b${name}\\b`));
    assert.doesNotMatch(types, new RegExp(`\\b${name}\\b`));
  }
});
