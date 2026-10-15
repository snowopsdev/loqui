# Integration pass A — closing the staged-Apply bypasses

Owner rule: provider, model and endpoint changes, and anything that adds an off-device recipient or payload, go through the planner. Results that stay on the device, or keep the same recipient and payload, stay instant.

## Edits (file + section)

### T06.md (done)
- Header paragraph "Switches and options are planned too": switch / Corti / web-search semantics, incl. the vision-override exception.
- Files: `src/utils/providerSearch.ts` added (`readProviderSearchPreference`, `writeProviderSearchPreference`).
- Interfaces/Produces: `ROUTE_SWITCH_KEYS`, `RouteSwitchKey`, `ROUTE_OPTION_KEYS`, `ProviderSearchScope`, `PROVIDER_SEARCH_PATCH_KEYS`, `ProviderSearchPatchKey`, `providerSearchScope(key)`, `SettingsPatch` widened with `providerSearch:<scope>` booleans, `ROUTE_PATCH_KEY_SET` = store keys + search keys.
- Step 1 `providerSwitchPlans.test.js`: subtests "applyRoutePatch writes enable switches and the Corti region…" and "a web-search patch writes the localStorage preference and announces it".
- Step 3: allowlist code; `applyRoutePatch` persists switches/Corti like their old setters and writes `providerSearch:<scope>` through `writeProviderSearchPreference` (after the store set; not a store field).
- Step 6 `routePlanner.test.js`: `reset` also resets both `personalWebSearch:*` keys; vision subtest fixed (with screen context off the custom vision target is `instant` because the route is off; with screen context on it is `staged`); new subtests "enable switches…", "assistant switches…", "the Corti region picks the receiving host…", "provider web search…".
- Step 7 expected-failure note mentions the four new subtests.
- Step 8 `routePlanner.ts`: imports `readProviderSearchPreference`, `supportsProviderSearch`, `providerSearchScope`; new `currentValue` (search keys read localStorage so Undo restores the preference) and `withPatchedSearch` (after-snapshot carries the patched preference); `addsNoRecipientOrPayload` treats `after` off as instant and `before` off → on off-device as a new recipient; `planPatch` uses both helpers. Implementer notes extended.

### T03.md (done)
- `test/lib/routesSnapshot.test.js`: new test "the Corti host follows the selected region" (change-driving).
- Step "Create `src/lib/routes.ts`": new `cortiHost(environment)` and `capabilitiesFor(settings)` after `routeCapabilities()`; `buildRouteSnapshot` uses `capabilities: capabilitiesFor(settings)`. `providerHosts.corti` = `api.<cortiEnvironment>.corti.app` (bare label only; empty → `us`).

### T07.md (done)
- Header/rules: facts refresh after the flush; two entry points (`requestRouteChange`, `requestRoutePatch`).
- Interfaces: consumes Task 3 `refreshRouteFacts`; produces `requestRoutePatch(id, patch, copy)`.
- Step 1 `routeDraftStore.test.js`: IPC log + `mainPresence`-backed `credentials.list`; `patch()` helper; `reset` clears main presence; new subtests "planning reads main's credential presence after the save is acknowledged", "requestRoutePatch: turning on a cloud route is staged; turning it off is instant", "requestRoutePatch: switching a staged switch back drops its draft", "requestRoutePatch: a Corti region switch and web search on are staged; web search off is instant".
- Step 1 `routeChangeMessage.test.js`: "an off route…" now has an off `before`; new "switching a route off says it is off".
- Step 3 `routeDraftStore.ts`: `readyToPlan()` (`flushSecretSaves` then `refreshRouteFacts(["credentials"])`), shared `settle()`, `requestRoutePatch`; `applyDraft` uses `readyToPlan`.
- Step 3 `routeChangeMessage.ts`: `routes.toast.off` when the main route turns off; en block gains `"off"`.

## Unresolved

(in progress)
