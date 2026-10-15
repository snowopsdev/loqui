### Task 8: Keyring in main: health table, verify IPC and rotation reminders (SET-R5 C, main half)

Verifying a key sends it to the provider, which is a network event (`docs/PRIVACY.md:51`). So verification is always an explicit request from the renderer, runs in main with the stored key, and returns only a health result. A save never verifies. The key itself is always kept, even when it is rejected (preserve content).

**Files:**
- Modify: `src/helpers/localDatabaseSchema.js`. Append the `provider_key_health` table before the closing backtick (`:329`).
- Modify: `src/helpers/database.js`. Add `getKeyHealth`, `saveKeyHealth` and `deleteKeyHealth` next to the other small accessors, for example after `getAction` (`:1504-1508`).
- Create: `src/helpers/keyring.js`
- Modify: `src/helpers/ipcHandlers.js`:
  - extract the `test-provider-connection` handler body (`:1081-1152`) into a method `_runProviderConnectionTest(config)`;
  - create the keyring at the start of `setupHandlers()` (`:1011`);
  - mark keys unverified on save (`:1244-1251`);
  - register the three `keyring-*` channels;
  - start the reminder timer.
- Modify: `preload.js`. Add a `keyring` namespace next to `personalInference` (`:78`).
- Modify: `src/types/electron.ts`. Add `keyring` to `electronAPI` after the `privacy?` block (Task 2), plus the `KeyringEntry` type.
- Modify: `src/preview/browserPreview.ts`. Add a `keyring` stub that rejects like the other desktop-only calls (pattern at `:140`).
- Modify: `docs/PRIVACY.md`. In "When network requests occur" (`:42`), extend the connection-check row at `:51`.
- Modify: `src/locales/*/translation.json`. Add `keyring.reminder.*`, used by main through `i18nMain`.
- Test: `test/helpers/keyring.test.js`, `test/helpers/keyHealthDatabase.test.js`

**Interfaces:**
- Consumes:
  - `BYOK_API_KEYS` (`src/config/secretKeys.js:122`), whose entries are `{ base, env, get, save, storeKey }`;
  - `this.environmentManager[k.get]()`;
  - the existing `testProviderConnection` flow, via the extracted method;
  - `i18nMain` (`src/helpers/i18nMain.js:139`) and Electron's `Notification`.
- Produces:

  ```js
  // src/helpers/keyring.js
  const KEYRING_PROVIDERS; // ["openai","anthropic","gemini","groq","xai","mistral","openrouter","tinfoil","corti","deepgram","assemblyai"]
  const ROTATION_DAYS = 90;
  function classifyResult(result) → { status, errorCode, httpStatus }
  function createKeyring({ store, hasKey, runTest, now }) → {
    list(): KeyringEntry[];                       // saved keys only, in KEYRING_PROVIDERS order
    verify(provider): Promise<KeyringEntry>;
    setReminder(provider, enabled): KeyringEntry;
    markUnverified(provider): void;
    forget(provider): void;
    takeDueReminders(): string[];                 // providers due now; marks them reminded
  }
  function startRotationReminders({ keyring, notify, intervalMs, setIntervalImpl, setTimeoutImpl }) → () => void
  module.exports = { KEYRING_PROVIDERS, ROTATION_DAYS, classifyResult, createKeyring, startRotationReminders };
  ```

  ```ts
  // src/types/electron.ts
  export type KeyHealthStatus = "unverified" | "verified" | "rejected" | "unreachable";
  export interface KeyringEntry {
    provider: string;
    status: KeyHealthStatus;
    lastVerifiedAt: number | null;   // ms epoch of the last attempt that reached a verdict
    lastErrorCode: string | null;    // errorCode from providerConnectionTest.js
    lastErrorStatus: number | null;  // HTTP status when known
    reminderDueAt: number | null;
  }
  // window.electronAPI.keyring
  keyring: {
    list: () => Promise<KeyringEntry[]>;
    verify: (provider: string) => Promise<KeyringEntry>;
    setReminder: (provider: string, enabled: boolean) => Promise<KeyringEntry>;
  };
  ```

  The IPC channels are `keyring-list`, `keyring-verify` and `keyring-set-reminder`. Task 2's facts store already reads `keyring?.list()` for `rejectedKeys`.

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/keyring.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { classifyResult, createKeyring, startRotationReminders, KEYRING_PROVIDERS, ROTATION_DAYS } = require("../../src/helpers/keyring.js");

const DAY = 86_400_000;

function fakeStore() {
  const rows = new Map();
  return {
    rows,
    all: () => [...rows.values()],
    save: (row) => rows.set(row.provider, { ...row }),
    remove: (provider) => rows.delete(provider),
  };
}

function setup({ keys = ["openai", "groq"], result = { success: true } } = {}) {
  const store = fakeStore();
  let clock = 1_000_000;
  const calls = [];
  const keyring = createKeyring({
    store,
    hasKey: (p) => keys.includes(p),
    runTest: async (cfg) => {
      calls.push(cfg);
      return typeof result === "function" ? result(cfg) : result;
    },
    now: () => clock,
  });
  return { keyring, store, calls, tick: (ms) => (clock += ms), now: () => clock };
}

test("the keyring lists saved provider keys only, unverified until checked", () => {
  const { keyring } = setup();
  assert.deepEqual(keyring.list(), [
    { provider: "openai", status: "unverified", lastVerifiedAt: null, lastErrorCode: null, lastErrorStatus: null, reminderDueAt: null },
    { provider: "groq", status: "unverified", lastVerifiedAt: null, lastErrorCode: null, lastErrorStatus: null, reminderDueAt: null },
  ]);
  assert.ok(!KEYRING_PROVIDERS.some((p) => p.endsWith("-custom")));
});

test("verify uses the stored key in main and records the verdict, never the key", async () => {
  const { keyring, calls, store, now } = setup();
  const entry = await keyring.verify("openai");
  assert.deepEqual(calls, [{ scope: "reasoning", provider: "openai" }]);
  assert.equal(entry.status, "verified");
  assert.equal(entry.lastVerifiedAt, now());
  assert.ok(!JSON.stringify([...store.rows.values()]).includes("sk-"), "no key material is stored");
});

test("speech-only providers are verified as transcription", async () => {
  const { keyring, calls } = setup({ keys: ["deepgram"] });
  await keyring.verify("deepgram");
  assert.equal(calls[0].scope, "transcription");
});

test("a rejection keeps its code; a network failure is 'unreachable', not 'rejected'", async () => {
  const rejected = setup({ result: { success: false, errorCode: "credentialsRejected", status: 401 } });
  const r = await rejected.keyring.verify("groq");
  assert.deepEqual([r.status, r.lastErrorCode, r.lastErrorStatus], ["rejected", "credentialsRejected", 401]);
  const offline = setup({ result: { success: false, errorCode: "timeout" } });
  const o = await offline.keyring.verify("groq");
  assert.deepEqual([o.status, o.lastErrorCode], ["unreachable", "timeout"]);
  assert.deepEqual(classifyResult({ success: true }), { status: "verified", errorCode: null, httpStatus: null });
});

test("a test that throws is recorded as unreachable instead of crashing the IPC call", async () => {
  const { keyring } = setup({ result: () => { throw new Error("socket hang up"); } });
  const entry = await keyring.verify("openai");
  assert.equal(entry.status, "unreachable");
  assert.equal(entry.lastErrorCode, "network");
});

test("unknown providers and missing keys are refused without a network call", async () => {
  const { keyring, calls } = setup({ keys: [] });
  await assert.rejects(keyring.verify("evil"), /Unknown keyring provider/);
  const entry = await keyring.verify("openai");
  assert.equal(entry.status, "unverified");
  assert.equal(calls.length, 0);
});

test("saving a new key resets health but keeps the reminder; removing it forgets the row", async () => {
  const { keyring, store, now } = setup();
  await keyring.verify("openai");
  keyring.setReminder("openai", true);
  keyring.markUnverified("openai");
  const entry = keyring.list().find((e) => e.provider === "openai");
  assert.equal(entry.status, "unverified");
  assert.equal(entry.reminderDueAt, now() + ROTATION_DAYS * DAY);
  keyring.forget("openai");
  assert.equal(store.rows.has("openai"), false);
});

test("reminders fire once when due and can be switched off", () => {
  const { keyring, tick } = setup();
  keyring.setReminder("groq", true);
  assert.deepEqual(keyring.takeDueReminders(), []);
  tick(ROTATION_DAYS * DAY);
  assert.deepEqual(keyring.takeDueReminders(), ["groq"]);
  assert.deepEqual(keyring.takeDueReminders(), [], "only once");
  keyring.setReminder("groq", false);
  assert.equal(keyring.list().find((e) => e.provider === "groq").reminderDueAt, null);
});

test("the reminder loop notifies per due provider and stops cleanly", () => {
  const notified = [];
  let intervalFn;
  let timeoutFn;
  const stop = startRotationReminders({
    keyring: { takeDueReminders: () => ["openai"] },
    notify: (provider) => notified.push(provider),
    intervalMs: 1000,
    setIntervalImpl: (fn) => ((intervalFn = fn), 7),
    setTimeoutImpl: (fn) => ((timeoutFn = fn), 8),
    clearIntervalImpl: () => {},
    clearTimeoutImpl: () => {},
  });
  timeoutFn();
  intervalFn();
  assert.deepEqual(notified, ["openai", "openai"]);
  stop();
});

test("preload exposes exactly the keyring channels main registers", () => {
  const root = path.join(__dirname, "../..");
  const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
  const handlers = fs.readFileSync(path.join(root, "src/helpers/ipcHandlers.js"), "utf8");
  for (const channel of ["keyring-list", "keyring-verify", "keyring-set-reminder"]) {
    assert.match(preload, new RegExp(`invoke\\("${channel}"`), `preload ${channel}`);
    assert.match(handlers, new RegExp(`ipcMain\\.handle\\("${channel}"`), `main ${channel}`);
  }
});
```

Create `test/helpers/keyHealthDatabase.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
// The exact `require("./harness/db")` spelling routes this file to the
// non-tsx native group in scripts/run-tests.js.
const { createDb } = require("./harness/db");

test("key health rows round-trip and upsert by provider", (t) => {
  const db = createDb(t);
  if (!db) return;
  assert.deepEqual(db.getKeyHealth(), []);
  const row = {
    provider: "groq", status: "rejected", last_verified_at: 5, last_error_code: "credentialsRejected",
    last_error_status: 401, reminder_due_at: null, reminded_at: null, updated_at: 5,
  };
  db.saveKeyHealth(row);
  db.saveKeyHealth({ ...row, status: "verified", last_error_code: null, last_error_status: null, updated_at: 6 });
  assert.deepEqual(db.getKeyHealth(), [{ ...row, status: "verified", last_error_code: null, last_error_status: null, updated_at: 6 }]);
  db.deleteKeyHealth("groq");
  assert.deepEqual(db.getKeyHealth(), []);
});

test("the schema refuses unknown health states", (t) => {
  const db = createDb(t);
  if (!db) return;
  assert.throws(() =>
    db.saveKeyHealth({ provider: "x", status: "great", last_verified_at: null, last_error_code: null, last_error_status: null, reminder_due_at: null, reminded_at: null, updated_at: 1 })
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run native:node && npm test -- test/helpers/keyring.test.js test/helpers/keyHealthDatabase.test.js`
Expected: FAIL. `Cannot find module '../../src/helpers/keyring.js'`, and `db.getKeyHealth is not a function`.

- [ ] **Step 3: Implement**

1. In `src/helpers/localDatabaseSchema.js`, insert this before the closing `` `; `` at `:329`:

   ```sql
   CREATE TABLE IF NOT EXISTS provider_key_health (
     provider          TEXT PRIMARY KEY,
     status            TEXT NOT NULL CHECK (status IN ('unverified', 'verified', 'rejected', 'unreachable')),
     last_verified_at  INTEGER,
     last_error_code   TEXT,
     last_error_status INTEGER,
     reminder_due_at   INTEGER,
     reminded_at       INTEGER,
     updated_at        INTEGER NOT NULL
   );
   ```

   It stores no key material, URLs or request content. The schema has no migration system and runs `CREATE … IF NOT EXISTS` on every launch, so every column must be present now.

2. In `src/helpers/database.js`, add these after `getAction`:

   ```js
     getKeyHealth() {
       return this.db.prepare("SELECT * FROM provider_key_health ORDER BY provider").all();
     }

     saveKeyHealth(row) {
       this.db
         .prepare(
           `INSERT INTO provider_key_health
              (provider, status, last_verified_at, last_error_code, last_error_status, reminder_due_at, reminded_at, updated_at)
            VALUES (@provider, @status, @last_verified_at, @last_error_code, @last_error_status, @reminder_due_at, @reminded_at, @updated_at)
            ON CONFLICT(provider) DO UPDATE SET
              status = excluded.status,
              last_verified_at = excluded.last_verified_at,
              last_error_code = excluded.last_error_code,
              last_error_status = excluded.last_error_status,
              reminder_due_at = excluded.reminder_due_at,
              reminded_at = excluded.reminded_at,
              updated_at = excluded.updated_at`
         )
         .run(row);
     }

     deleteKeyHealth(provider) {
       this.db.prepare("DELETE FROM provider_key_health WHERE provider = ?").run(provider);
     }
   ```

3. Create `src/helpers/keyring.js`:

   ```js
   const { BYOK_API_KEYS } = require("../config/secretKeys");

   // Provider key health (SET-R5 C). Verification sends the stored key to the
   // provider, so it only runs on an explicit request; the renderer never sees
   // the key, only the verdict. Rows hold metadata only.

   const KEYRING_PROVIDERS = BYOK_API_KEYS.map((k) => k.base).filter((base) => !base.endsWith("-custom"));
   const SPEECH_ONLY = new Set(["deepgram", "assemblyai"]);
   const ROTATION_DAYS = 90;
   const DAY_MS = 86_400_000;

   function classifyResult(result) {
     if (result && result.success) return { status: "verified", errorCode: null, httpStatus: null };
     const errorCode = (result && result.errorCode) || "network";
     const httpStatus = (result && typeof result.status === "number" && result.status) || null;
     return { status: errorCode === "credentialsRejected" ? "rejected" : "unreachable", errorCode, httpStatus };
   }

   function toEntry(provider, row) {
     return {
       provider,
       status: row ? row.status : "unverified",
       lastVerifiedAt: row ? row.last_verified_at : null,
       lastErrorCode: row ? row.last_error_code : null,
       lastErrorStatus: row ? row.last_error_status : null,
       reminderDueAt: row ? row.reminder_due_at : null,
     };
   }

   function createKeyring({ store, hasKey, runTest, now = Date.now }) {
     const rowFor = (provider) => store.all().find((r) => r.provider === provider) || null;
     const blank = (provider) => ({
       provider,
       status: "unverified",
       last_verified_at: null,
       last_error_code: null,
       last_error_status: null,
       reminder_due_at: null,
       reminded_at: null,
       updated_at: now(),
     });
     const update = (provider, patch) => {
       const row = { ...(rowFor(provider) || blank(provider)), ...patch, updated_at: now() };
       store.save(row);
       return row;
     };
     const assertKnown = (provider) => {
       if (!KEYRING_PROVIDERS.includes(provider)) throw new Error(`Unknown keyring provider: ${provider}`);
     };

     return {
       list() {
         return KEYRING_PROVIDERS.filter((p) => hasKey(p)).map((p) => toEntry(p, rowFor(p)));
       },
       async verify(provider) {
         assertKnown(provider);
         if (!hasKey(provider)) return toEntry(provider, rowFor(provider));
         let result;
         try {
           result = await runTest({ scope: SPEECH_ONLY.has(provider) ? "transcription" : "reasoning", provider });
         } catch {
           result = { success: false, errorCode: "network" };
         }
         const verdict = classifyResult(result);
         const row = update(provider, {
           status: verdict.status,
           last_verified_at: now(),
           last_error_code: verdict.errorCode,
           last_error_status: verdict.httpStatus,
         });
         return toEntry(provider, row);
       },
       setReminder(provider, enabled) {
         assertKnown(provider);
         const row = update(provider, {
           reminder_due_at: enabled ? now() + ROTATION_DAYS * DAY_MS : null,
           reminded_at: null,
         });
         return toEntry(provider, row);
       },
       markUnverified(provider) {
         if (!KEYRING_PROVIDERS.includes(provider)) return;
         update(provider, { status: "unverified", last_error_code: null, last_error_status: null });
       },
       forget(provider) {
         store.remove(provider);
       },
       takeDueReminders() {
         const due = store
           .all()
           .filter((r) => r.reminder_due_at !== null && r.reminder_due_at <= now() && r.reminded_at === null && hasKey(r.provider));
         for (const r of due) update(r.provider, { reminded_at: now() });
         return due.map((r) => r.provider);
       },
     };
   }

   function startRotationReminders({
     keyring,
     notify,
     intervalMs = 6 * 60 * 60 * 1000,
     setIntervalImpl = setInterval,
     setTimeoutImpl = setTimeout,
     clearIntervalImpl = clearInterval,
     clearTimeoutImpl = clearTimeout,
   }) {
     const check = () => {
       for (const provider of keyring.takeDueReminders()) notify(provider);
     };
     const first = setTimeoutImpl(check, 60_000);
     const loop = setIntervalImpl(check, intervalMs);
     return () => {
       clearTimeoutImpl(first);
       clearIntervalImpl(loop);
     };
   }

   module.exports = { KEYRING_PROVIDERS, ROTATION_DAYS, classifyResult, createKeyring, startRotationReminders };
   ```

4. In `src/helpers/ipcHandlers.js`:
   - **Extract the test handler.** Move the whole body of `ipcMain.handle("test-provider-connection", async (_event, config) => { … })` (`:1081-1152`) into a class method `async _runProviderConnectionTest(config) { … }`. The body starts with `config = { ...config };` and ends with `return testProviderConnection(config);`. Then register the handler as:

     ```js
     ipcMain.handle("test-provider-connection", (_event, config) => this._runProviderConnectionTest(config));
     ```

   - **Create the keyring.** At the top of `setupHandlers()` (`:1011`), add:

     ```js
     const { createKeyring, startRotationReminders } = require("./keyring");
     const { Notification } = require("electron");
     this.keyring = createKeyring({
       store: {
         all: () => this.databaseManager.getKeyHealth(),
         save: (row) => this.databaseManager.saveKeyHealth(row),
         remove: (provider) => this.databaseManager.deleteKeyHealth(provider),
       },
       hasKey: (provider) => {
         const entry = BYOK_API_KEYS.find((k) => k.base === provider);
         return !!(entry && this.environmentManager[entry.get]());
       },
       runTest: (config) => this._runProviderConnectionTest(config),
     });
     this._stopKeyReminders = startRotationReminders({
       keyring: this.keyring,
       notify: (provider) => {
         if (!Notification.isSupported()) return;
         new Notification({
           title: i18nMain.t("keyring.reminder.title", { provider: providerName(provider) }),
           body: i18nMain.t("keyring.reminder.body"),
         }).show();
       },
     });
     ```

     If `ipcHandlers.js` does not already import `i18nMain`, add `const i18nMain = require("./i18nMain");` next to the other requires. Also define `providerName` near the top of the file:

     ```js
     // Display names for native notifications; mirrors src/lib/locality.ts PROVIDER_NAMES.
     const PROVIDER_NAMES = { openai: "OpenAI", anthropic: "Anthropic", gemini: "Google Gemini", groq: "Groq", xai: "xAI", mistral: "Mistral", openrouter: "OpenRouter", tinfoil: "Tinfoil", corti: "Corti", deepgram: "Deepgram", assemblyai: "AssemblyAI" };
     const providerName = (id) => PROVIDER_NAMES[id] || id;
     ```

   - **Mark keys on save.** Change the save handler in the BYOK loop (`:1248-1250`) to:

     ```js
     ipcMain.handle(`save-${k.base}-key`, (event, key) => {
       if (key === "__stored__") return true;
       const result = this.environmentManager[k.save](key);
       // A new key has not been verified; an empty key removes the health row.
       if (key) this.keyring.markUnverified(k.base);
       else this.keyring.forget(k.base);
       return result;
     });
     ```

   - **Register the channels.** Next to `test-provider-connection`:

     ```js
     ipcMain.handle("keyring-list", () => this.keyring.list());
     ipcMain.handle("keyring-verify", (_event, provider) => this.keyring.verify(String(provider)));
     ipcMain.handle("keyring-set-reminder", (_event, provider, enabled) =>
       this.keyring.setReminder(String(provider), !!enabled)
     );
     ```

5. In `preload.js`, after the `personalInference: { … },` block that ends at `:98`, add:

   ```js
     keyring: {
       list: () => ipcRenderer.invoke("keyring-list"),
       verify: (provider) => ipcRenderer.invoke("keyring-verify", provider),
       setReminder: (provider, enabled) => ipcRenderer.invoke("keyring-set-reminder", provider, enabled),
     },
   ```

6. In `src/types/electron.ts`, export `KeyHealthStatus` and `KeyringEntry` (from Interfaces) at module level next to `InferenceMode` (`:18`). Add `keyring` to the `electronAPI` interface after the `privacy?` block.

7. In `src/preview/browserPreview.ts`, next to the `personalInference` stub (`:140`), add `keyring: { list: async () => [], verify: async () => { throw new Error(desktopMessage); }, setReminder: async () => { throw new Error(desktopMessage); } },`.

8. In `docs/PRIVACY.md`, replace the row at `:51` with:

   ```markdown
   | Provider connection/model checks and key verification | The selected provider receives your stored credentials and a model-list request. Loqui runs this only when you press Verify or Verify all, never when you save a key. The result (verified, rejected or unreachable, with time and HTTP status) is stored locally in the `provider_key_health` table; no key, URL or content is stored there |
   ```

9. Write `/tmp/loqui-i18n-task-8.json` and merge it. The `en` block is:

   ```json
   {
     "keyring": {
       "reminder": {
         "title": "Time to rotate your {{provider}} key",
         "body": "You asked Loqui to remind you after 90 days. Replace the key in Settings → Routing."
       }
     }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/helpers/keyring.test.js test/helpers/keyHealthDatabase.test.js test/helpers/providerConnectionTest.test.js test/helpers/secretKeys.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS. The existing provider-connection and secret-key tests still pass, so the extraction did not change behaviour.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/localDatabaseSchema.js src/helpers/database.js src/helpers/keyring.js src/helpers/ipcHandlers.js preload.js src/types/electron.ts src/preview/browserPreview.ts docs/PRIVACY.md src/locales test/helpers/keyring.test.js test/helpers/keyHealthDatabase.test.js
git commit -m "feat(keyring): Verify provider keys in main and record their health"
```

---

