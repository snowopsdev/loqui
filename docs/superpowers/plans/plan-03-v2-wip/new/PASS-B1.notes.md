# Pass B1: consistency sweep of T01, T02, T03, T11

Owner of this pass: T01.md, T02.md, T03.md and T11.md only. Planning only: no app code, no git, nothing executed.

## Edits made

### T01.md (route graph)
- Interfaces, "Mirrors" bullet: Corti speech goes to `api.<region>.corti.app`. Corti text always calls `https://ai.eu.corti.app/v1` (`src/helpers/personalInference.js:78`, used at `:202`; `src/config/constants.ts:123`). The resolver reads text hosts from `providerHosts["corti:text"]` and speech hosts from `providerHosts.corti`.
- Interfaces, "Snapshot conventions": `providerHosts` is keyed by raw provider id, plus the extra key `"corti:text"`. A missing key gives `host: null`, and the resolver never falls back from `"corti:text"` to `corti`.
- `test/lib/routeFixtures.js`: `providerHosts` gains `"corti:text": "ai.eu.corti.app"`, and the header comment now says twelve entries.
- `test/lib/routeGraph.test.js`, test "Corti speech and text … keyed by identity" (change-driving; the module does not exist yet). New assertions:
  - speech hosts (dictation and meeting) come from `providerHosts.corti`, and a region override moves them;
  - the chat host is `ai.eu.corti.app` in both regions;
  - when the `"corti:text"` key is missing, the host is `null`.
  - The test count stays 25, so the Step 2 and Step 4 expected counts still hold. The test table row is updated.
- `src/lib/routeGraph.ts`:
  - `RouteCapabilities.providerHosts` has a comment explaining the two Corti keys;
  - `remote()` takes an optional `hostKey`;
  - new `textHostKey(providerId)` (`corti` → `"corti:text"`);
  - `llmDestination` passes it on the supported-provider branch.
- Rule check (item b): T03 follows the T01 conventions. Installed sets hold raw ids (`model` / `id`, checked against `src/types/electron.ts:365-368`, `:486-489`, `:600`). Model keys are written through `localSttModelKey`, as `llm:<id>` and as `cloud:<p>:<m>`. Hosts are bare and come from `new URL().host`. No change was needed apart from the Corti text key.

### T03.md (facts, sealed store, routes.ts)
- Interfaces, "Consumes from Task 1": now states every T01 snapshot convention, including `corti` (the region's speech host) and `"corti:text"` (`API_ENDPOINTS.CORTI_MODELS_BASE`, `constants.ts:123`).
- `routeCapabilities()`: adds `add("corti:text", API_ENDPOINTS.CORTI_MODELS_BASE)` with a comment. `capabilitiesFor` still overrides only `corti` from `cortiEnvironment`.
- `test/lib/routesSnapshot.test.js`: new **change-driving** test, "Corti text routes disclose the API-key host, whatever the region". For both `us` and `eu`, it checks that `providerHosts["corti:text"]` is `ai.eu.corti.app`, that `providerHosts.corti` is `api.<region>.corti.app`, and that the resolved `chat.host` is `ai.eu.corti.app`. It uses the real store keys `chatAgentMode/Provider/Model` (`src/config/inferenceScopes.ts:79-81`).
- Interfaces stub: `RouteFactsApi { /* … */ }` now points to its full declaration (Step 3, item 5).

### T11.md (keyring)
- Interfaces: new "**`verify` result contract (Task 12 consumes it)**" table. `verify` always resolves to `{ outcome, entry }` with no `superseded` flag, and rejects only for an unknown identity. Per outcome, the table records whether a request was sent, whether the row was written, and what `entry` holds:
  - `recorded`: the new verdict row;
  - `superseded`: the current row, or `null` if the key was removed or reset;
  - `missing`: `null`;
  - `sealed` and `invalidOptions`: the current row, unchanged.
- This matches the implementation (`entryFor` = row if present, else null) and the tests.

### T02.md
- No edits needed. `saveSecret`, `flushSecretSaves`, `SecretStoreKey`, `SecretSaveResult`, `subscribeCredentialChanges` and the preload `credentials.{list,save,remove,undoRemove,onChanged}` match every consumer:
  - T07: `flushSecretSaves` from `./settingsStore`;
  - T08: `saveSecret`, `SecretStoreKey`, `SecretSaveResult`; all 13 store keys it uses are in `SECRET_SLOTS`;
  - T09: `saveSecret` with custom-endpoint keys;
  - T11: `present`, `generation`, `subscribe`;
  - T12: `remove`, `undoRemove`, `saveSecret`, `flushSecretSaves`.
- All 25 `SECRET_SLOTS` store fields exist in `src/stores/settingsStore.ts`.

### Checks
- **Placeholders:** none in the four files (scanned for TBD/TODO/"similar to"/elided code).
- **Test file names:** no file is created by two tasks. The ones listed by several tasks are extensions:
  - `routesHooks.test.js`: T03 creates it, T08 modifies it;
  - `rovingNav.test.js`: T05 creates it, T13 extends it;
  - `settingsModalPaths.test.js`: T04 creates it, T16 modifies it;
  - `personalWorkspace.test.js` and `fieldDirectionPolicy.test.js` already exist.
- **i18n:** T03's `routes.{groups,names,subtitles,payload}` does not overlap T05's `routes.{runsOn,place,selection,state}` or T07's `routes.toast`. T11's `keyring.reminder.*` does not overlap T12's `keyring.*`. One collision was found (T02 vs T12, see Consumer fixes 3).
- **Citations:** 45 path:line citations from the four tasks were checked against the app code, and all match. Examples:
  - `transcriptionRoute.ts:203`, `urlUtils.ts:50`, `personalInference.js:6/94-95/147-162/258/268-279`, `meetingTranscriptionRouting.js:8/57/79`;
  - `ipcHandlers.js:1/14/48/338/997-1009/1081/1103/1244-1251/2937/3222-3226/3572/3794-3804`, `audioManager.js:3223`, `environment.js:249/482-487`, `main.js:442-446`, `preload.js:78`, `codexAppServer.js:74/96/135`;
  - `settingsStore.ts:775/1249/1368/2532/2569/2629`, `ModelRegistry.ts:458/481/499/505/525/578`, `constants.ts:116/123`, `snippets.ts:123`, `providerSearch.ts:9-12`, `electron.ts:675`, `InferenceConfigEditor.tsx:203-213`;
  - `localDatabaseSchema.js:329`, `database.js:1504-1512`, `providerConnectionTest.js:282`, `cortiAuth.js:23`, `PRIVACY.md:51`.
- **Test labels:** T01 (all change-driving, with source guards noted as regression guards afterwards), T03 (change-driving, plus baseline guards in Step 4), T02 and T11 (labelled per test or step). The new T03 test is labelled.

## Consumer fixes

1. **T12.md: `keyring.verify` result (T11 contract).**
   - `:30`: `verify(id)` → `verify(id, options?: { cortiEnvironment?: string; cortiTenant?: string }): Promise<{ outcome: "recorded" | "superseded" | "missing" | "sealed" | "invalidOptions"; entry: KeyringEntry | null }>`.
   - `:34` "Assumed …": drop the `superseded: true` assumption. `KeyringEntry` also carries `providerId: string` (additive).
   - `:1384` `KeyringApi.verify`: `(id: CredentialId, options?: { cortiEnvironment?: string; cortiTenant?: string }) => Promise<unknown>`.
   - `:1402-1411` `isSuperseded`: test `(result as { outcome?: unknown }).outcome === "superseded"` instead of `.superseded === true`.
   - Test `:572`: `gate.resolve({ outcome: "superseded", entry: entry("groq") })`, replacing the spread entry plus `superseded: true`.
   - Optional: also show a notice for `outcome === "invalidOptions"` (malformed Corti region or tenant). `missing` and `sealed` are non-verdicts and need no notice.
2. **T12.md: pass the Corti options (T11).** `:1473` `runVerify` calls `api.verify(id)` with no options. Main then defaults Corti speech to the US region and tenant `base`, so an EU account is checked against the wrong auth server.
   - Add a dep `verifyOptions?: (id: CredentialId) => { cortiEnvironment?: string; cortiTenant?: string } | undefined` to `useKeyringController`.
   - Call `api.verify(id, live.current.verifyOptions?.(id))`.
   - In `KeyringPanel` (`:1646-1650`), pass `verifyOptions: (id) => id === "corti:speech" ? { cortiEnvironment: useSettingsStore.getState().cortiEnvironment, cortiTenant: useSettingsStore.getState().cortiTenant } : undefined`.
   - Add a controller test asserting `api.calls.verify` receives the options for `corti:speech` and `undefined` for `groq`.
3. **T12.md: i18n collision with T02.** T02 already ships `apiKeyInput.saveFailed` and `apiKeyInput.removeFailed` in all 11 locales (T02.md:2020-2030, no placeholder). T12's en block (`:1700-1704`) redefines them with `{{error}}`, and `merge-locale-keys.js` overwrites, so T12 would silently replace T02's copy.
   - Remove `saveFailed` and `removeFailed` from T12's block.
   - Calling `t("apiKeyInput.saveFailed", { error })` is harmless and keeps the mock-based assertions at `:257`/`:287` passing, but main's error values are codes (`persistFailed`, …), not user text. So drop the `{ error }` argument and `unknownError` unless T12 maps codes to copy.
4. **T12.md: `credentials.undoRemove` failure union (T02).** At `:29`, add `"persistFailed"` to `reason` (T02.md interface; INTEGRATION.md item 9). Handle it like `unknown`, or with its own string ("Couldn't restore the key. Add it again.").
5. **T12.md: EnterpriseProviderConfig double edit (T02).** At `:1281-1291`, T02 Step 3 item 10 (T02.md:1979-2007) already makes the local `saveSecret` return the ack and already removes `void` from all five `setApiKey` call sites.
   - Delete T12's conditional "Unless Task 2 already made it acknowledge …" block.
   - At `:1278`, write Azure and Vertex as `setApiKey={(value) => saveSecret("azureApiKey", value)}` / `…("vertexApiKey", value)` (no `void`) and only add `credentialId`.
6. **T12.md: `credentialHost` for Corti text (T01/T03 host convention).** `:1336-1339` maps both Corti identities to `hosts.corti`, which is the speech host.
   - Change to `const key = id === "corti:speech" ? "corti" : id; return Object.hasOwn(hosts, key) ? hosts[key] : null;`.
   - Test `:456-458`: add `"corti:text": "ai.eu.corti.app"` to `hosts` and assert `credentialHost("corti:text", hosts) === "ai.eu.corti.app"`.
7. **T10.md: `routeCopy()` call shape (T03).** T03 ships `routeCopy(t, language)`, `currentRouteCopy()` and `useRouteCopy()`. T10 calls `routeCopy()` with no arguments (`:1665`; assumption at `:31`, `:37`). This is INTEGRATION.md item 8.
   - Import `useRouteCopy` instead of `routeCopy` (`:1374`).
   - Replace `:1665` with `const copy = useRouteCopy();`.
   - Update `:31`/`:37`.
8. **T06.md (optional test).** With `"corti:text"` in place, a Corti region switch no longer changes a Corti text route's host, so it is instant for text-only Corti profiles. This supersedes INTEGRATION-A unresolved item 2 ("over-stages"). Suggested addition to "the Corti region picks the receiving host" (`:1079-1100`): `reset({ chatAgentMode: "providers", chatAgentProvider: "corti", chatAgentModel: "corti-chat" })`, then assert `planPatch(live(), ctx({ facts: { credentials: new Map([["corti:text", true]]) } }), "chat", { cortiEnvironment: "eu" }).kind === "instant"` and `changes` is empty.
9. **INTERFACES.md / HEADER.md owner.** The `RouteCapabilities.providerHosts` comment should say: "raw provider id → bare host[:port]; `corti` = speech host for `cortiEnvironment`; extra key `"corti:text"` = Corti text host". The INTERFACES resolver rule "`host`: providers → `capabilities.providerHosts[providerId]`" needs the exception "Corti text routes read `providerHosts["corti:text"]`".

## Unresolved

- **T10 Patchbay Corti card host.** One provider card per id uses `hosts[id]` (`T10.md:1050`), which is the Corti speech host, even when the card offers Corti text. A card spans both kinds, so this is a simplification rather than a wrong recipient on a route (route-level `host` is now correct). T10's owner may choose to show the per-kind host.
- **Retired (`openwhispr`) text routes naming `corti`** still report the speech host. These routes are `unreachable "retired"` and send nothing, so this was left as is.
- **Codex host `chatgpt.com`** is still an inference (INTEGRATION-A unresolved 1). Not changed.
- Nothing was executed (no `node_modules` in the worktree).
