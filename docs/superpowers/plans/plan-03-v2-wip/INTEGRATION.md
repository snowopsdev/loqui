# Integration TODO (owner of assembly)

1. Enable toggles bypass review (T06/T07 notes): turning on an off route that points off-device (useCleanupModel, useDictationTranslation, useDictationAgent, voiceAgentScreenContext, useDictationAgentVisionModel) must go through planPatch: add the flags to ROUTE_PATCH_KEYS (T06), add requestRoutePatch (T07), route the toggles (SettingsPage cleanup toggle, DictationAgentSettings, DictationTranslationSettings, T16 search live toggles) through it.
2. T01 rule refinements 1-9 accepted; T03 builder must follow T01 snapshot key conventions (installed raw ids; models keys whisper:/sherpa:/llm:/cloud:<p>:<m>; providerHosts bare host).
3. Coupled-route blocker: a coupled route that becomes non-ready blocks Apply (T06 note) — accept (fail safe), surface the reason in the bar (T08).
4. Facts refresh after key save must land before planning reads it (T07 note): requestRouteChange awaits flushSecretSaves() then awaits refreshRouteFacts({ keys: ["credentials"] }).
