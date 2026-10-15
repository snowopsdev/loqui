# Pass B2: consistency sweep of T05, T06, T07, T08, T09

Owner of this pass: T05.md–T09.md only. Planning only: no app code, no git, nothing executed.

## Producer names checked (all match unless an edit is listed)

- T01: `routeCredentialId`, `TEXT_PROVIDER_IDS`, `SCOPE_ROUTE`, `STT_CONTEXT_ROUTE`, `routePayloadParts`, `resolveRoutes`, types (via `routes.ts` re-export).
- T02: `saveSecret(storeKey, value)`, `flushSecretSaves()`, `SecretStoreKey`, `SecretSaveResult` from `settingsStore.ts`; `credentials.{list,save,onChanged}`. Every store key T08/T09 pass (`cortiClientId`, `cortiApiKey`, `*CustomApiKey`, …) is in T02's `SECRET_SLOTS`. T07's test stubs `credentials.save` (the path `saveSecret` actually uses) and `saveOpenAIKey`.
- T03: `useRouteCopy()` (components), `buildRouteSnapshot(settings, facts, copy, sealed)`, `useResolvedRoute(s)`, `refreshRouteFacts(keys?: readonly RouteFactKey[])` (array form, as T07 calls it), `loadRouteFacts(api, keys?)`, `useRouteFactsStore` `{ facts }`, `getSealed`/`useSealedStore`/`ensureSealedSubscribed`, `PROVIDER_SEARCH_CHANGED_EVENT`. No task of mine calls `routeCopy()` or `currentRouteCopy()`.
- T06 → T07/T08/T09: `planRouteChange`, `planPatch`, `RouteTarget`, `RoutePlan`, `SETUP_AFTER_APPLY`, `SettingsPatch`, `RouteSwitchKey`, `ProviderSearchScope`, `readProviderSearchPreference`; fixture exports `TEST_COPY, QWEN, routeBaseState, testFacts, MIGRATED_STORAGE`.
- T07 → T08/T09: `requestRouteChange`, `requestRoutePatch`, `applyDraft`, `planDraft`, `withDraftDiscard`, `useRouteDraftStore`, `RouteChangeOutcome`, `routeChangeMessage(plan, t, list)`.
- T08 → T09/T10/T12: `useRouteCommit`, `useRouteChange().requestPatch`, `EndpointDraft` props, `StagedRouteBar({ placement, shortcut })`, `StagedRoutePanel({ routeId })`, `providersForRoute`, test helpers.

## Edits made

### T05.md
- `SettingsPage.tsx` anchor for `const { t } = useTranslation();` in `TranscriptionSection`: `:501` → `:496` (verified).

### T06.md
- PASS-B1 consumer fix 8 applied: in the subtest "the Corti region picks the receiving host…", added a text-only Corti profile (`chatAgentProvider: "corti"`, `corti:text` present) whose `cortiEnvironment: "eu"` patch is `instant` with no changes (T01/T03 `providerHosts["corti:text"] = ai.eu.corti.app`).
- Header "Switches and options are planned too": the region moves the Corti speech host only; Corti text never moves.

### T07.md
- Step 2 test-labelling sentence made accurate (every subtest change-driving because the module is missing; two are plain contract checks).

### T08.md
- **`TEXT_PROVIDER_IDS` dedupe.** The catalog's list (ReasoningModelSelector tab order, 12 ids, no mistral/xai) is renamed `TEXT_PROVIDER_TABS` so it no longer shadows Task 1's `TEXT_PROVIDER_IDS` (main's 14-id list) through `routes.ts`. Interfaces/Produces updated. New providerCatalog subtest: every tab is in Task 1's list, and the catalog exports no `TEXT_PROVIDER_IDS`.
- **`credentialFor` uses Task 1's `routeCredentialId`** (single identity rule, T01 notes) with a `CREDENTIAL_FIELDS: Partial<Record<CredentialId, CredentialFieldSpec[]>>` map; the hand-rolled Corti speech/text branch is gone. Existing test expectations are unchanged.
- **T05/T08 selector conflict.** T08's replacement snippets for the four `<InferenceModeSelector>` call sites dropped T05's required `label` prop and `routeState`. Steps 10, 12, 13 and 14 now write the full selector (with `label`, `stagedMode`, `routeState`) and keep T05's `useResolvedRoute` locals; "same shape as step 10" shorthand removed. Step 14 no longer re-imports `SCOPE_ROUTE` (T05 already imports `SCOPE_ROUTE, useResolvedRoute`); Step 8 note updated likewise.
- Consumes list: Task 1 types and `routeCredentialId` attributed to Task 1 (via `routes.ts`).
- Labels added to five unlabelled subtests (bar blocker, device change, upload read-only, labelled server field, upload staged).
- Staged provider chip selected mark: `border-primary bg-primary/10` → `border-ring … ring-1 ring-ring` (T05's rule: the selected mark is the ring token; solid primary is 2.94:1 on hover).

### T09.md
- Consumer of T08 rename: `TEXT_PROVIDER_IDS` → `TEXT_PROVIDER_TABS` (Interfaces and Step 3 item 3).
- Consumes attribution: `SCOPE_ROUTE`/`STT_CONTEXT_ROUTE`/`LlmRouteScope` are Task 1 (via `routes.ts`).
- `browserPreview.ts` anchors: `:154-155` → `:155-156`; `personalInference,` is `:156` (verified).
- Placeholder removed: Step 3 item 10 (UploadSettings) said "the step 9 shape using … the `upload…` fields"; it now gives the full `renderTranscriptionPicker` code.
- Header: the Corti region stages only speech routes (text host fixed).

### Checks
- **Placeholders:** none left in T05–T09 (scanned TBD/TODO/"similar to"/"same shape"/elided code).
- **Test file names:** every test file created by T05–T09 is unique across T01–T18 (duplicates in the scan are the same task listing a file in Files and in a step; extensions: `rovingNav.test.js` T05→T13, `routesHooks.test.js` T03→T08, `plumNight.test.js`, `fieldDirectionPolicy.test.js`, `personalWorkspace.test.js`, `orukeetOrganization.test.js` pre-exist).
- **i18n:** T05 `routes.{runsOn,place,selection,state}`, T07 `routes.toast.*`, T08 `staging.*`, T09 `reasoning.custom.{listModels…,useDefault}`, `reasoning.codex.*`, `settingsPage.selfHosted.{test…,notSet,sharedReadOnly}`: no overlap with each other, with T03's `routes.*`, with B3's namespaces, or with existing `en` keys (checked against `src/locales/en/translation.json`).
- **Citations spot-checked (≈55, all match after the two fixes above):** `SettingsSection.tsx:111/120`, `ModelCardList.tsx:172-176`, `SettingsPage.tsx:458-463/465/494/496/526/548/638/665-681/705/708/716/726/733/1010/1019/3136/3168-3173`, `MeetingSettings.tsx:34/97/114/116/141/145`, `UploadSettings.tsx:12/77/96/120/124/132/140`, `InferenceConfigEditor.tsx:1-4/24/45/50/99/115-117/122/156/184-186/203/214`, `SidebarModal.tsx:20/36/115/243/256`, `SettingsModal.tsx:126-139`, `DictationAgentSettings.tsx:13/18-25/57-67/61/149/175-179/188-191`, `DictationTranslationSettings.tsx:7/22/59`, `icons/index.ts:103-104`, `useToast.ts:44`, `settingsStore.ts:57/58/74/80/116/1145/1153/1835/1889/2432`, `providerSearch.ts:2-12`, `ModelRegistry.ts:272/458/471`, `providerSelection.ts:1`, `electron.ts:702-711/1371/1674`, `providerConnectionTest.js:54/335`, `ipcHandlers.js:1152`, `preload.js:118`, `cortiTranscription.js:39`, `cortiStreaming.js:48`, `personalInference.js:136-138/286`, `OpenAICompatiblePanel.tsx:165/225/237/239/252`, `ReasoningModelSelector.tsx:47-60/480-506/572/608/737-744`, `TranscriptionModelPicker.tsx:301/315/636/659/863/878/900/927/1190-1194/1249/1272`, `NotesOnboarding.tsx:13/41-45/161-171`, `PRIVACY.md:51`, `transcriptionRoute.ts:53`, `inferenceProviders/index.ts:30`, `urlUtils.ts:50`, `inferenceScopes.ts:10/30-97`.
- **Owner rules:** no direct provider/model/endpoint/switch/Corti/web-search write remains in T05–T09 source steps: every write goes `requestRouteChange`/`requestRoutePatch` → planner → `applyRoutePatch`. Remaining local `set…` calls are component draft state only (`setDraftUrl`, `setInternalLocalProvider`, `setBrowsedCloudProvider`). Secrets go through T02's `saveSecret`. Discovery happens only on the List models button.

## Consumer fixes (for B3)

1. **T13.md: rebase the picker edits onto Task 9 (compile conflict).**
   - `TranscriptionModelPicker.tsx`: Task 9 already declares `const routeId = STT_CONTEXT_ROUTE[transcriptionContext];` right after the props destructuring (Corti region, T09 Step 3 item 6). T13's `const routeId = variant === "settings" ? STT_CONTEXT_ROUTE[transcriptionContext] : undefined;` is a duplicate `const`. Task 9 also removed the props `onLocalModelSelect`, `onLocalProviderSelect`, `onCloudProviderSelect`, `onCloudModelSelect`, `onModeChange`, `setCloudTranscriptionBaseUrl` and the `switchCloudTranscriptionProvider` selector, which T13's diff context and `commitLocalModel` `direct` callback still use. After Task 9, `handleWhisperModelSelect`/`handleParakeetModelSelect` end in `onCommit({ mode: "local", provider, model: modelId })`, and all three callers wire `onCommit` through Task 8's `useRouteCommit` (planner + toast + Undo). Fix: drop `useLocalModelCommit` and the new `routeId` const from TranscriptionModelPicker; the cartridge grid calls the existing `handleWhisperModelSelect`/`handleParakeetModelSelect`. If T13 needs the route id for "In use by", reuse Task 9's `routeId`.
   - `ReasoningModelSelector.tsx`: Task 9 replaced the props interface (`:62-75`) and destructuring (`:338-351`). Add T13's `routeId?: RouteId` to Task 9's new interface/destructuring, not to the old ones. `LocalModelPicker`'s `onModelSelect={handleModelSelect}` already commits through `onCommit` (T09 Step 3 item 3). If ReasoningModelSelector passes `routeId` into `LocalModelPicker`'s `useLocalModelCommit`, local picks call `requestRouteChange` directly and lose the SET-Q10 toast and Undo. Fix: don't pass `routeId` for committing from ReasoningModelSelector (the `direct` path reaches `onCommit`), or pass it only for display.
   - `InferenceConfigEditor.tsx:128-142`: Task 9 rewrote `renderModelSelector` (`onCommit={commit}`, `credentialRef`, `saveCustomReasoningApiKey`). Add `routeId={route.id}` to that new element.
2. **T12.md: `credentialId` on the staged panel's key fields.** T08's `StagedRoutePanelView` renders `<ApiKeyInput key={input.storeKey} apiKey={input.value} setApiKey={input.save} label={input.label} />` from `credential.inputs` (T08 Step 3 item 7). T08 cannot pass `credentialId` because T12 adds that prop. Add in T12: `credentialId={credential.inputs.length === 1 ? credential.credentialId : undefined}` (Corti speech's two fields keep the plain Remove, matching T12's own rule), and extend T12's source guard if it enumerates `ApiKeyInput` call sites.
3. **T12.md: line drift in ReasoningModelSelector/TranscriptionModelPicker.** Task 9 rewrites `ReasoningModelSelector.tsx:47-75/338-351/475-506/577-608/783-792` and TranscriptionModelPicker's credential `credentialSetters` (`:970-983`, Corti entries now `requestPatch`) and text-input branch (`:1266-1272`, now `CommitOnLeaveInput`). T12's `:617-710` and `:1243` anchors still identify the right `apiKey={…}`/secret-field text, but the line numbers shift; locate by text.
4. **T18.md (if B3 owns it; else the integration owner):** the Step 3 table row "`OpenAICompatiblePanel.tsx` | four `text-xs text-warning` hint paragraphs" is already handled: Task 9 rewrites the file with no `text-warning`. Mark it "Task 9 removes them; nothing to do unless the guard reports them".
5. **Optional, T10.md:** text provider cards come from `providersForRoute`, which now filters T08's `TEXT_PROVIDER_TABS` (same 12 ids as before; only the name changed). Nothing to change unless T10 imported the catalog's old `TEXT_PROVIDER_IDS` (it does not today).

## Unresolved

- **Apply while the seal is unknown.** `getSealed()` is `false` until `known` (T03 notes). T07/T08 plan with it as-is (main enforces the seal). Blocking Apply on `known === false` would need a new blocker copy; not done.
- **Same-route instant commit drops a staged draft** (INTEGRATION-A unresolved 3, T07 `commit` → `discardDraftFor`), e.g. tenant commit discarding a staged region switch. Unchanged.
- **Staged "on" has no inline hint** on the switch (INTEGRATION-A unresolved 5). Unchanged.
- **Mistral/xAI** are valid text providers in main (Task 1) but have no ReasoningModelSelector tab, so the staged panel and Patchbay never offer them. Deliberate (no editor to finish setup); flag for the owner.
- Nothing executed (no `node_modules`).
