# Integration TODO (owner of assembly)

1. Enable toggles bypass review (T06/T07 notes): turning on an off route that points off-device (useCleanupModel, useDictationTranslation, useDictationAgent, voiceAgentScreenContext, useDictationAgentVisionModel) must go through planPatch: add the flags to ROUTE_PATCH_KEYS (T06), add requestRoutePatch (T07), route the toggles (SettingsPage cleanup toggle, DictationAgentSettings, DictationTranslationSettings, T16 search live toggles) through it.
2. T01 rule refinements 1-9 accepted; T03 builder must follow T01 snapshot key conventions (installed raw ids; models keys whisper:/sherpa:/llm:/cloud:<p>:<m>; providerHosts bare host).
3. Coupled-route blocker: a coupled route that becomes non-ready blocks Apply (T06 note) — accept (fail safe), surface the reason in the bar (T08).
4. Facts refresh after key save must land before planning reads it (T07 note): requestRouteChange awaits flushSecretSaves() then awaits refreshRouteFacts({ keys: ["credentials"] }).
5. Corti region (cortiEnvironment US/EU) changes the receiving host without the planner (T08/T09 notes): add cortiEnvironment/cortiTenant to ROUTE_PATCH_KEYS; the region select commits through requestRoutePatch; providerHosts for corti derives from environment.
6. Provider web-search toggle (personalWebSearch:<scope>, localStorage) adds the webSearch payload part without review: route the toggle through requestRoutePatch semantics (stage when turning ON for an off-device route; OFF instant).
7. Codex "List models" host: name chatgpt.com (codex app-server talks to ChatGPT) — verify string in T09.
8. T10 must call routeCopy as T03 ships it (useRouteCopy() in components; currentRouteCopy() imperatively).
9. T12: verify returns { outcome, entry } (T11) — check outcome === "superseded"; pass Corti options; handle undoRemove reason "persistFailed".
10. Ring token already shipped by Plan 01 commit f7d53e4 → header CCR becomes 'already satisfied; Task 5 verifies'.
