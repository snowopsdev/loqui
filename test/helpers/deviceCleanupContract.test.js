const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ipcHandlersSource = fs.readFileSync(
  path.join(__dirname, "../../src/helpers/ipcHandlers.js"),
  "utf8"
);

const cleanupHandler = ipcHandlersSource.match(
  /ipcMain\.handle\("cleanup-app", async \(event\) => \{([\s\S]*?)ipcMain\.handle\("update-hotkey"/
);

test("explicit device cleanup covers models, credentials, caches, and browser settings", () => {
  assert.ok(cleanupHandler, "cleanup-app handler is present");
  const source = cleanupHandler[1];

  for (const operation of [
    "deleteAllParakeetModels",
    "diarizationManager?.deleteModels",
    "modelManager.deleteAllModels",
    "environmentManager?.clearAllPersistedData",
    "eraseCodexProfile",
    "clearStorageData",
    "clearCache",
    "setAutoStartEnabled(false)",
  ]) {
    assert.ok(source.includes(operation), `device cleanup includes ${operation}`);
  }

  for (const cacheName of ["embedding-models", "qdrant-data", "qdrant-data-dev", "yt-dlp"]) {
    assert.ok(source.includes(`"${cacheName}"`), `device cleanup removes ${cacheName}`);
  }

  assert.ok(!source.includes("tokenStore"), "no hosted account token store exists");
});

// change-driving: cleanup-app ignores deleteAllAudio()'s result, so failed unlinks and an unreadable folder were swallowed.
test("[change-driving source guard] device reset reports audio erase failures from Plan 02's result", () => {
  assert.ok(cleanupHandler, "cleanup-app handler is present");
  const source = cleanupHandler[1];
  assert.match(source, /const audioErase = this\.audioStorageManager\.deleteAllAudio\(\);/);
  assert.match(source, /!audioErase\.readable/);
  assert.match(source, /audioErase\.failed > 0/);
});

// baseline guard (Task 2 added the call): rewriting the audio block keeps the credential
// reset barrier (R2-2), and no second, unfenced reset or bare erase is added.
test("[baseline source guard] device reset still retires every credential token", () => {
  assert.ok(cleanupHandler, "cleanup-app handler is present");
  const source = cleanupHandler[1];
  assert.match(
    source,
    /await this\.credentials\.reset\(\(\) => this\.environmentManager\?\.clearAllPersistedData\(\)\)/,
    "the erase runs inside Task 2's reset barrier"
  );
  assert.equal(
    (source.match(/this\.credentials\.reset\(/g) || []).length,
    1,
    "exactly one credential reset"
  );
  assert.equal(
    (source.match(/clearAllPersistedData\(/g) || []).length,
    1,
    "the barrier's erase is the only clearAllPersistedData call"
  );
});
