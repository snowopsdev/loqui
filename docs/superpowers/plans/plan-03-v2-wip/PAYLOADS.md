# Payload disclosure (I15) — authoritative for T1 (composition), T3 (copy), T8/T10 (display)

Evidence: research report summarised here; file:line refs are in the app worktree. Disclosure is CONSERVATIVE: when a part may be sent under conditions the snapshot cannot see, it is listed. It describes what future requests will carry; computing it never triggers a request. Low-sensitivity metadata (language code, model id, timestamps request flags) is covered by one fixed footnote string, `routes.payload.metadataNote` ("Settings such as language and model names are sent too."), shown under the Apply bar list, not per route.

## Parts (`PayloadPart` ids → en copy, noun phrases that fit "Sends …")

| id | en | 
|---|---|
| `audio` | your audio |
| `audioFile` | the audio file |
| `meetingAudio` | meeting audio from your microphone and the call |
| `dictionary` | your dictionary words and snippet triggers |
| `dictionaryWords` | your dictionary words |
| `transcript` | your transcript text |
| `request` | your spoken request |
| `selectedText` | text you have selected |
| `history` | recent conversation |
| `lookups` | notes and calendar details it looks up |
| `noteText` | your note text |
| `meetingTranscript` | the meeting transcript with speaker names |
| `participants` | attendee names and email addresses |
| `screenshot` | a screenshot of your screen |
| `webSearch` | permission for the provider to search the web |
| `messages` | your messages |

## Composition per route (T1 implements `routePayloadParts(id, snapshot): PayloadPart[]`, exported)

| Route | Parts (conditions) | Evidence |
|---|---|---|
| dictationStt | `audio`; `dictionary` if `dictionaryInUse` | audioManager.js:2927-2951 (prompt/keyterms from getDictionaryHintWords) |
| noteRecordingStt | `meetingAudio`; `dictionaryWords` if provider is `corti` and `dictionaryInUse` | meetingRecordingStore.ts:170, meetingTranscriptionRouting.js:79-86 |
| uploadStt | `audioFile` | fileTranscription.ts:148-163 (no prompt/keyterms) |
| dictationCleanup | `transcript`; `dictionary` if `dictionaryInUse` | ReasoningService.ts:121-129, prompts/index.ts:48-59 |
| voiceAssistant | `request`, `selectedText`, `history`, `lookups`; `dictionary` if `dictionaryInUse`; `screenshot` if `screenContext && !visionOverride`; `webSearch` if `llm.dictationAgent.providerSearch` | audioManager.js:2299-2356, useChatStreaming.ts:272-317, providerSearch.ts:2-11 |
| assistantVision | all voiceAssistant parts plus `screenshot` (with the override the whole request goes to the vision provider); `webSearch` only if `llm.dictationAgentVision.providerSearch` | dictationAgentInference.js (scope swap), useChatStreaming.ts:331-342 |
| translation | `transcript`; `dictionary` if `dictionaryInUse` | audioManager.js:234-239, 2517-2518 |
| noteFormatting | `noteText`, `meetingTranscript`, `participants`; `dictionaryWords` if `dictionaryInUse` | PersonalNotesView.tsx:644-659, actionProcessingStore.ts:129-130, llmTranscript.ts:39-72 |
| chat | `messages`, `history`, `lookups`; `dictionary` if `dictionaryInUse`; `webSearch` if `llm.chatIntelligence.providerSearch` | useChatStreaming.ts:293-309, useEmbeddedChat.ts:53-63, useContainerChat.ts:58-67 |

`sends` = `copy.list(parts.map(p => copy.parts[p]))` when the route is off-device and not off; else null.

Snapshot inputs (T3 builder): `dictionaryInUse = getDictionaryHintWords(settings).length > 0` (src/utils/snippets.ts:123-136 — the same function the request builders use); `llm[scope].providerSearch = isProviderSearchEnabled(scope, provider, mode)` (src/utils/providerSearch.ts — same function the request path uses; reads localStorage `personalWebSearch:<scope>`).

## Agreement tests (T1/T3)

1. `resolveMeetingTranscriptionOptions` (pure ESM, src/helpers/meetingTranscriptionRouting.js): for Corti with keyterms → options carry `keyterms`; for OpenAI → no `keyterms`. Assert routeGraph `noteRecordingStt` sends includes the dictionaryWords copy exactly in the Corti case.
2. `getDictionaryHintWords` drives `dictionaryInUse`: settings with only a snippet trigger → dictionaryInUse true (builder test, T3).
3. `supportsProviderSearch`/`isProviderSearchEnabled`: chat with openai + toggle on → `webSearch` listed; with groq → not listed (builder test, T3).
4. Source guards (labelled as such): useChatStreaming.ts still contains `slice(-20)` (history) and `buildRAGContext` (lookups); audioManager.js still appends `selectedText` for agent requests. If any disappears, the guard fails so the disclosure table is revisited.

## Incidental finding (report to owner, out of scope)

audioManager.js:3254 and :3593 reference `usesKeywords`/`dictionary`, declared only inside `processWithOpenAIAPI` (:2924-2925) — possible ReferenceError on streaming dictation. Not verified by running.
