# Loqui UI/UX overhaul: approved scope and roadmap

**Status:** approved 2026-10-15. Owner confirmed D2 and D3 on 2026-10-15. §3 and §5 consolidated from every plan's contract change requests on 2026-10-15.
**Source of picks:** owner export `loqui-ui-todo.md` (copied to `.omc/research/ui-review/approved-todo.md`).
**Visual reference:** `design-explorations/loqui-uiux-review.html` (open the rec by its ID; the picked variant's card, its spec list and the audit section are the acceptance reference).
**Evidence:** `.omc/research/ui-review/audit-{onboarding,workspace,voice,settings}.md`, `screens/`.

## 1. Locked picks

| Area | ID | Pick | Owner note |
|---|---|---|---|
| Foundations | FND-R1 | C: Orange means "live voice" | |
| | FND-R2 | C: Plum Night | |
| | FND-R3 | B: Tokens + springs | |
| | FND-R4 | B: Ring shape + provider badge | |
| | FND-R5 | B: The logo speaks | |
| Onboarding | ONB-R1 | C: The orange panel becomes the instrument | |
| | ONB-R2 | B: Two phases: Get dictating / Make it yours | |
| | ONB-R3 | C: Detected for you | |
| | ONB-R4 | B: While that downloads, meet Loqui | |
| | ONB-R5 | C: Hotkey-first trial | |
| | ONB-R6 | B: Before and after, in your words | |
| | ONB-R7 | B: Live keycap | |
| | ONB-R8 | A: Honest summary | |
| Voice | VO-R1 | C: Condensation | The waveform must not be clipped by the words. |
| | VO-R6 | B: Words-first card | |
| | VO-R8 | B: Violet orbit | Remove the frame glyph. |
| | VO-R10 | A: Soft family | |
| | VO-R11 | B: Notch drop | |
| | VO-R12 | A: Recorder capsule | Delivered per D2. |
| | VO-R14 | B: Pill-anchored chips | |
| Workspace | WS-R1 | B: One sidebar, with Spaces | |
| | WS-R2 | A: "Ready" strip, container-aware list | |
| | WS-R3 | A: Capture split button | Use C's live states. |
| | WS-R4 | B: Filter chips, in-view search, sessions | |
| | WS-R5 | A: Commands and Navigation groups | |
| | WS-R6 | B: Slash menu, bubble toolbar, real typography | |
| | WS-R7 | B: Universal mentions | |
| | WS-R8 | B: Document-style answers, citations, context rail | |
| | WS-R11 | B: Semantic colour roles and a type ramp | |
| Settings | SET-R1 | B: Patchbay switchboard | |
| | SET-R2 | A: Same sections, search with live controls | |
| | SET-R3 | B: Stage, review, apply | |
| | SET-R4 | B: Cartridge cards | |
| | SET-R5 | C: Keyring with health | |
| | SET-R6 | C: Sealed mode master switch | |
| | SET-R7 | A: Storage list with counted confirms | |
| Moonshots | ONB-M2 | Waveform becomes the logo | |
| | WS-M4 | Confidence as typography | Prototype |
| | WS-M5 | The Table: a spatial canvas | Prototype |
| | SET-M3 | Data flight recorder and Sealed mode | |

All 79 quick wins are kept. Skipped items: VO-R2 (Privacy Halo) is covered by FND-R4. Skipped moonshots: ONB-M1, ONB-M3, VO-M3, VO-M5, SET-M4, SET-M5.

## 2. Decisions that resolve conflicts between picks

- **D1, orange = live voice (FND-R1 C) overrides "ink on orange" quick wins.**
  - The default `Button` becomes an ink capsule with an orange brand dot (light theme: ink on paper; dark theme: paper on plum).
  - A new `live` variant carries the orange gradient with ink text (6.29:1). It is used only for record, stop, mic, send-by-voice, the pill and the meters.
  - Therefore ONB-Q4, VO-Q4 and WS-Q4 are delivered as: neutral primary everywhere, `live` only for voice controls, and links always `--color-link`. `BRAND_GLASS_SURFACE` text becomes ink, not white.
  - Orange stays the focus-ring and active-nav accent in light theme; the light nav marker and focus ring are the deeper orange `#E84E16` so they clear 3:1 on every light surface. Focus rings are drawn fully opaque.
- **D2, VO-R12 A "Recorder capsule" is a state of the existing pill window, not a second always-on-top window.** *(Confirmed.)*
  - The pill shows a red-orange dot, mm:ss and Stop while a meeting records, and dictation still works from it.
  - Linux fallbacks: the tray icon shows a recording state, and a persistent notification has a Stop action.
    - *Spec-owner clarification, 2026-10-15:* the Stop action appears where the notification server advertises `actions` (freedesktop `GetCapabilities`).
    - Where it does not, or where publishing fails, the persistent notification still shows without actions, and clicking it brings up the pill with Stop visible.
    - The tray's Stop is always there.
    - The Stop transport is session-bound and separate from `showSystemNotification` (§5.5).
  - Interruption alerts go out as native notifications regardless of focus (VO-Q16).
  - There is a setting "Show meeting recorder on screen", on by default.
- **D3, cancel flow (VO-R6 B + VO-Q8).** *(Confirmed.)*
  - Cancel is instant, with no confirmation dialog.
  - The pill shows "Discarded · Undo" for 5 s, or 10 s when the recording is over 30 s. ⌥Z or a click restores it, and hovering pauses the countdown.
  - Audio is held in RAM only and zeroed when the window expires; it is never persisted unless the retention settings already save discarded audio.
  - Esc stays armed until the pipeline is idle.
  - If a remote request was already sent, the copy says so: "Cancelled · OpenAI already received the audio."
  - Add the sentence about the undo window to `docs/PRIVACY.md`.
- **D4, locality has three values.** It is computed by one function (`src/lib/locality.ts`) and drawn by one primitive (`LocalityRing`).

  | Locality | Ring | Light text | Dark text |
  |---|---|---|---|
  | `device` | solid | `#0b7a54` | `#5ee0ad` |
  | `network` (self-hosted on another machine) | dotted | `#3b6ea8` | `#9bb4d6` |
  | `remote` (provider) | dashed orbit + provider badge | `#ad5008` | `#fbbf6a` |

  Unknown providers resolve to `remote`, which fails toward disclosure. A self-hosted URL on localhost, 127.0.0.1 or ::1 is `device`.
- **D5, Plum Night replaces charcoal as the only dark theme.** Every dark token is written in hex so contrast is testable. Magenta `#E6007A` is the dark-theme active-nav marker; the focus ring stays orange.
- **D6, SET-R6 C and SET-M3 are one workstream (Plan 07).**
  - Sealed mode is enforced in Electron main, which owns provider requests (CLAUDE.md).
  - Main blocks every outbound provider and model-download request while sealed. Local routes keep working. The UI never claims "0 bytes" unless main attests it.
  - This needs a security review before merge.
- **D7, WS-M4 needs word-level confidence data.** Plan 08 starts with a spike to find out which engines expose token or word probabilities. The feature is gated to those engines and hidden elsewhere.
- **D8, ONB-R3 C "Detected for you" uses hardware and OS locale only.** It reads RAM, GPU and disk plus the system language. ONB-M1 (speech language ID) was skipped.
- **D9, VO-R1 C words render outside the waveform's box.** The words sit on a separate row or layer above the bars, so condensation never clips the bars (owner note). VO-R8 B ships without the frame glyph.
- **D10, `DESIGN.md` is the source of truth.** Each plan updates the sections it changes in the same commits.
- **D11, WS-M4 (confidence typography) is on hold** (owner decision, 2026-10-15). No engine Loqui runs exposes per-word alternatives: the pinned whisper.cpp fork and sherpa-onnx 1.13.8 don't, and Deepgram's are unconfirmed for streaming. The owner chose to hold the feature until alternatives exist rather than ship it without them. Plan 08 delivers WS-M5 only. Restoring WS-M4 needs decoder top-k work in the whisper.cpp fork, which is a separate engine project.
- **D12, The Table never deletes content** (owner decision, 2026-10-15). Its selection action is "Remove from table": the card returns to the Inbox tray and nothing is deleted. Summarise and Ask reuse the Space's existing chat, so Sealed mode covers them without changes.
- **D13, manual update checks stay available when automatic updates are off** (owner decision, 2026-10-15, SET-Q16). A manual check that finds a newer version reports it as `available`. Nothing downloads without an explicit click. This replaces the rule pinned at `test/helpers/updateManager.test.js:187`.
- **D14, Sealed mode keeps its full promise for the local model servers** (owner decision, 2026-10-15, Plan 07 CCR-6). Once llama-server, whisper-server, Qdrant and sherpa-onnx are running, JavaScript can't see their network traffic. The owner rejected disclosing that gap, and rejected stopping the servers while sealed. Plan 07 instead builds OS-level network isolation for every native child Loqui starts while sealed, so that only loopback traffic gets out:
  - macOS: a sandbox profile.
  - Linux: a network namespace, or an equivalent.
  - Windows: a per-program block.
  - **Spike first.** A spike establishes what each platform can do without admin rights, entitlements or a signing change. If any platform can't meet the promise, Plan 07 stops and reports to the owner before falling back.
  - **No silent fallback.** A child that can't be isolated is never counted toward `nothingLeaves`.
  - **Merge gate.** Plan 07 doesn't merge until this ships.

## 3. Plans and dependencies

```
01 Foundations ─> 02 Bug & a11y sweep ─> 03 Routes & Settings ─┬─> 04 Voice overlay
                                                              ├─> 05 Onboarding
                                                              ├─> 06 Workspace ─> 08 Prototypes (WS-M5)
                                                              └─> 07 Sealed mode & flight recorder
```

**Execution order** (consolidated 2026-10-15 from Plan 02 CCR 4, Plan 05 CCR 3 and Plan 06 CR-06-1):
- **01 → 02 → 03.** Plans 03, 04, 05 and 06 all rewrite surfaces Plan 02 fixes, and each one extends Plan 02's tests and harness (`test/helpers/harness/rendererMocks.js`, `fakeDomTree.js`). Plan 03 needs Plan 02's SET-Q1/Q2/Q20 semantics.
- **04, 05, 06 and 07 run in parallel once 03 has merged.** Each is rebased onto 03 before it starts.
  - Where two of them meet, each side ships a fallback, and **whichever merges second wires the real contract and deletes its fallback**. The meeting points are:
    - 04 ↔ 05: the Undo bridge (§5.2);
    - 04 ↔ 07: the disclosure, the pre-flight and the notices (§5.2–§5.4);
    - 04/05 ↔ 06: the capture status bridge (§5.7).
  - The fallbacks are named in each plan's Contract change requests.
- **08 runs after 06** and uses 03's route chips (§5.1).

| Plan | Recommendations | Quick wins |
|---|---|---|
| 01 Foundations | FND-R1–R5, WS-R11 B (colour roles) | ONB-Q4* (tokens), VO-Q1, VO-Q2, VO-Q3, VO-Q4*, VO-Q17, WS-Q4* (tokens), WS-Q15, SET-Q14 |
| 02 Bug & a11y sweep | none | ONB-Q1, ONB-Q2, VO-Q6, VO-Q8, VO-Q9, VO-Q16, WS-Q1, WS-Q5, WS-Q7, SET-Q1, SET-Q2, SET-Q5, SET-Q6, SET-Q7, SET-Q11, SET-Q12, SET-Q13, SET-Q16, SET-Q20, SET-Q25 |
| 03 Routes & Settings | SET-R1 B, R2 A, R3 B, R4 B, R5 C, R7 A | SET-Q3, Q4, Q8, Q9, Q10, Q15, Q17, Q18, Q19, Q21, Q22, Q23, Q24 |
| 04 Voice overlay | VO-R1 C, R6 B (+D3), R8 B, R10 A, R11 B, R12 A (+D2), R14 B | VO-Q5, Q7, Q10, Q11, Q12, Q13, Q14, Q15, Q18, Q19, Q20, Q21 |
| 05 Onboarding | ONB-R1 C, R2 B, R3 C, R4 B, R5 C, R6 B, R7 B, R8 A, ONB-M2 | ONB-Q3, Q4 (adoption), Q5, Q6, Q7, Q8, Q9, Q10, Q11, Q12, Q13, Q14, Q15, Q16, Q17, Q18 |
| 06 Workspace | WS-R1 B, R2 A, R3 A+C, R4 B, R5 A, R6 B, R7 B, R8 B, WS-R11 B (type ramp) | WS-Q2, Q3, Q4 (adoption), Q6, Q8, Q9, Q10, Q11, Q12, Q13, Q14; WS-Q7 Notes readiness handoff (§5.1) |
| 07 Sealed mode & flight recorder | SET-R6 C, SET-M3 | none |
| 08 Prototypes | WS-M5 (WS-M4 on hold, D11) | none |

\* Delivered per D1. Plan 01 ships the tokens, the `Button` variants and the contrast tests. Onboarding (05) and Workspace (06) adopt them in their own screens, which is where the type ramp lands too.

Each plan has its own draft PR, stacked on Plan 01's branch (`snowopsdev/feat/uiux-foundations`) until its dependencies merge.

## 4. Global constraints (every plan)

- Electron main owns SQLite, credentials, native runtimes, provider requests and updates. Renderers talk only through typed preload IPC (CLAUDE.md).
- Local and remote choices stay explicit. Nothing silently switches provider or moves work from local to remote. Content is preserved on every failure.
- Tests use Node `node:test` through `npm test` (`scripts/run-tests.js`). Run `npm run native:node` before tests and `npm run native:electron` before launching the desktop app. Never use personal profiles in tests.
- Text contrast is at least 4.5:1 and non-text UI at least 3:1, in light and Plum Night.
- Motion uses the shared tokens only. Every loop is gated to its active state. Reduced motion keeps opacity and colour feedback and drops transforms (existing policy in `src/index.css`).
- Every visible string goes through i18n (`src/locales/*/translation.json`; `npm run i18n:check` passes).
- RTL: use logical properties (`ms-`, `me-`, `start`, `end`).
- Before a PR: `npm run lint`, `npm run typecheck`, `npm test`, `npm run i18n:check`.

## 5. Cross-plan interface contracts

Every plan codes against these contracts, and only the owning plan may change them. If a contract has to change, the owner updates this section in the same PR. This section was consolidated on 2026-10-15 from every plan's "Contract change requests". The request ids (CCR-n, CR-06-n) stay stable, so a plan's review response can cite them. Each plan's document holds the full rationale. This section holds the binding shapes.

**Plan 01 contracts** (`docs/superpowers/plans/2026-10-15-loqui-uiux-01-foundations.md`), with the additive extensions other plans make:

| Contract | Produced items | Extended by |
|---|---|---|
| Motion and colour tokens | `--motion-*`; `--color-cta*`, `--color-live*`, `--color-nav-marker`, `--color-locality-*`, `--color-link*`, `--gradient-brand-glass*` | **Plan 02:** `--color-input-border` (light `#858585`, Plum Night `#8c6b7b`); the light `--color-warning-foreground` and `--color-success-foreground` become `#171717`. **Plan 06 (CR-06-4):** `--color-ai`, `--color-ai-text`, `--color-agent`, `--color-agent-text`, and the UI type ramp `--text-display\|title\|heading\|body\|ui\|caption\|micro` (line-height, weight and tracking included). The ramp never redefines Tailwind's `--text-xs…--text-9xl`. Plan 06 also adds the cadence tokens `--motion-loop-*`, `--motion-stagger` and `--motion-dwell-ring`. `--color-agent-brand` stays valid. Plans 04 and 05 may adopt these after 06 merges; they do not depend on 06. |
| Button | `variant="live"` | none |
| Locality | `src/lib/locality.ts`: `Locality`, `RouteLocality`, `resolveLocality`, `providerDisplayName` (logs only), `providerDisplayLabel(id, t)` (every provider name shown in UI), `providerMonogram`, `isLoopbackUrl` | **Plan 07 (CCR-5):** `isLoopbackUrl` accepts exactly what main's `isLoopbackHost` accepts: `localhost` (including a trailing dot), `*.localhost`, `127.0.0.0/8`, `::1` in any spelling, and IPv4-mapped `127.x`. Both are tested against `test/fixtures/loopbackCases.json`. A hostname that only *resolves* to loopback is not loopback. Whether an endpoint is *valid* is a separate question that the executors answer, so plain-HTTP `*.localhost` is loopback but refused, and resolves `needsUrl` (§5.1 rule 10). |
| Locality ring | `src/components/ui/LocalityRing.tsx` | none |
| Level meter | `src/components/ui/LevelBars.tsx` and `levelBarsMath.ts` | **Plan 05:** an optional `tone?: "brand" \| "onLive"` prop, defaulting to `"brand"`, which replaces the scoped `!important` override. |
| Test helpers | `src/utils/contrast.ts` (`contrastRatio`, `roundContrastRatio`), `test/helpers/harness/cssTokens.js` | none |

### 5.1 Route graph (owner: Plan 03; consumers: 04, 05, 06, 07, 08)

`src/lib/routeGraph.ts` is the pure resolver. It is Node-loadable under `node --import tsx` without Vite: erasable TypeScript, explicit import extensions, no React, store or IPC imports. `src/lib/routes.ts` re-exports it and adds the snapshot builders and the React hooks.

```ts
import type { Locality } from "./locality";

export type RouteId =
  | "dictationStt" | "noteRecordingStt" | "uploadStt"
  | "dictationCleanup" | "voiceAssistant" | "assistantVision"
  | "translation" | "noteFormatting" | "chat"
  | "speakerId" | "semanticSearch";

export type RouteKind = "speech" | "text" | "support";

export type RouteState =
  | { status: "ready" }
  | { status: "off" }                           // the user turned the task off
  | { status: "unknown" }                       // main has not confirmed readiness yet (loading, or the check failed); never treated as ready
  | { status: "needsModel"; sizeBytes?: number }
  | { status: "needsKey"; provider: string }    // provider "" = choose a provider
  | { status: "needsUrl" }                      // missing, malformed, insecure, hosted or forbidden endpoint
  | { status: "unreachable"; detail?: "sealed" | "retired" | "unsupported" };

export interface ResolvedRoute {
  id: RouteId;
  kind: RouteKind;
  locality: Locality;
  provider: string | null;      // English providerDisplayName: logs only
  providerId: string | null;    // raw provider id; null for device and network. UI shows providerDisplayLabel(providerId, t).
  host: string | null;          // normalized effective endpoint host[:port]; null when nothing leaves the device or the endpoint is invalid
  model: string | null;         // display name of the selected model
  state: RouteState;
  sends: string | null;         // translated payload list; null when the route is on the device or off
  settingsPath: string;         // "<section>[/<subTab>]"; always a valid SettingsModal initialSection
}

// routeGraph.ts (pure)
export function resolveRoutes(snapshot: RouteSettingsSnapshot): ResolvedRoute[]; // always 11 entries, in RouteId order
export function resolveRoute(snapshot: RouteSettingsSnapshot, id: RouteId): ResolvedRoute;
export function isSealedLocality(locality: Locality): boolean;                    // locality !== "device"; the only rule for what Sealed mode pauses

// routes.ts (renderer)
export function buildRouteSnapshot(settings: SettingsState, facts: RouteFacts, copy: RouteCopy, sealed: boolean): RouteSettingsSnapshot;
export function routeSnapshotFromSettings(settings: SettingsState): RouteSettingsSnapshot; // current facts + sealedStore + i18n; no subscriptions, no IPC
export function useResolvedRoutes(): ResolvedRoute[];
export function useResolvedRoute(id: RouteId): ResolvedRoute;
```

`RouteSettingsSnapshot` is Plan 03's choice, with one fixed field: `sealed` is a required `boolean`. Facts that only main knows (models on disk, credential presence, keyring health) come from `src/stores/routeFactsStore.ts` through network-free preload calls. Loading route facts never calls Codex, model discovery or key verification. `test/lib/routeFixtures.js` exports `makeSnapshot` and `makeRoute` for consumers' tests.

**Rules**
1. **Unknown is not ready.** A fact that is not yet known resolves to `unknown`. Consumers render it as a neutral "Checking…" state; Plan 05's Ready step waits for `ready`. An unset model is still `needsModel`.
2. **Empty provider.** `needsKey` with provider `""` means "choose a provider".
3. **`sends`.** It is null when the route is on the device or off. Otherwise it is a composed, translated list. With screen context on and no override, the assistant's `sends` names the screenshot.
4. **Off routes.** An off route keeps the destination it would use.
5. **Support routes.** `speakerId` and `semanticSearch` are always `device`.
6. **Text routes.** An off-device text route without a model is `needsModel` with no size.
7. **Sealed.** While sealed, every route with `isSealedLocality(locality)` (that is, `network` and `remote`) is `{ status: "unreachable", detail: "sealed" }`.
8. **Retired mode.** `openwhispr` mode is `remote` with a provider id and `unreachable`/`retired`.
9. **Unsupported combinations.** `noteRecordingStt` in self-hosted mode, or with a provider outside the meeting providers, is `unreachable`/`unsupported` (Plan 05 CCR 5). So is `uploadStt` on a streaming-only provider.
10. **Loopback endpoints.** A valid loopback custom endpoint is `device`. An invalid URL is never `device`. Plain-HTTP `*.localhost` is loopback by host, but the executors refuse it, so it resolves `needsUrl`.
11. **Ready matches the executors.** Readiness uses the same validation the executors apply.

**Published components** (Plan 08 CCR-6), in `src/components/settings/routing/RouteChips.tsx`:

```ts
RouteDestinationChip(props: { route: Pick<ResolvedRoute, "locality" | "providerId" | "model">; className?: string })
RouteStateChip(props: { state: RouteState; className?: string })
```

Any surface that discloses a route uses these, and does not build its own chip.

**Handoffs**
- **Notes readiness (Plan 02 CCR 6).** Plan 06 replaces Plan 02's `useNoteActionsReady` with `useResolvedRoute("noteFormatting")`:
  - `ready` shows no hint;
  - `needsModel`, `needsKey`, `needsUrl` and `unreachable` show the hint with the matching action (`onOpenSettings(route.settingsPath)`);
  - `unknown` shows nothing yet;
  - `off` disables Actions.

  It keeps the dismissal key `notesActionsModelHintDismissed`, and tests a remote provider with no saved key. It was assigned to Plan 06 because Plan 06 rewrites the Notes surface.
- **Total memory.** Plan 03 ships the `get-total-memory` IPC. Plan 05's `getSystemProfile` reads the same main-side value, and adds no second channel.

### 5.2 Dictation lifecycle (owner: Plan 04; consumers: 05, 06, 07)

Shared types live in `src/types/dictation.ts` (Plan 04 Task 7). Consumers import them and do not restate them.

```ts
export interface CancelledState {
  sessionId: string;              // the dictation session; also the egress correlationId (§5.4)
  undoUntil: number;              // epoch ms the window closes; frozen while paused
  paused: boolean;                // the pointer rests on the pill
  remainingMs: number;
  remoteAlreadySent: RemoteDisclosure | null;   // updates while the window is open
}
export type UndoResult =
  | { restored: true; sessionId: string }
  | { restored: false; sessionId: string | null; reason: "expired" | "busy" | "sealed" | "routeUnavailable" | "noAudio" | "unavailable" };

export interface MeetingPresence { sessionId: string; startedAt: number; interruption: "systemAudio" | "mic" | null; quiet: boolean }
export type MeetingOutcome =
  | { sessionId: string; kind: "saved"; durationMs: number; noteId: string | null }
  | { sessionId: string; kind: "failed"; reason: "save" | "stop" | "ownerLost" };

export type DisclosurePayload = "audio" | "text" | "image";
export interface RemoteDisclosure {
  target: string;                 // provider id ("openai", "custom"), or "host:<hostname>" for the user's own server
  payload: DisclosurePayload;     // strongest seen: audio > image > text
  evidence: "attested" | "dispatched";
  alsoSentTo: string[];           // other targets of the same session, strongest evidence first; [] when there is one
}
```

**`useAudioRecording` additions** (read-only): `cancelled: CancelledState | null`, `undoCancel(): Promise<boolean>`, `pauseUndo()`, `resumeUndo()`, `processingStage: "transcribing" | "cleaning" | null`, `outcome: { sessionId; kind: "pasted"; words; at } | { sessionId; kind: "failed"; at } | null`, and `meetingRecording: MeetingPresence | null`.

**Cancel and Undo**
- Every cancel that captured audio gets an Undo window, including streaming and merge-time cancels. A cancel before any audio exists produces no `cancelled` state.
- When `undoCancel()` returns `false`, exactly one notice explains why.
- `restored: true` means the recording was claimed and its pipeline started. It does not wait for the transcript.
- On `busy` and `sealed`, the recording goes back into its window, and a fresh `cancelled` state is emitted.

**Cross-window Undo bridge** (CCR-5). This supersedes Plan 05's earlier `sendUndoCancelDictation(): boolean` and its `undo-cancel-dictation` channel.
- **Overlay → main → control panel,** on `onboarding-demo-event`, sanitised by `sanitizeCancelledDemoFields`:
  - `{ kind: "dictation" | "assistant"; status: "cancelled"; sessionId; cancelled: CancelledState }`
  - `{ kind: "dictation" | "assistant"; status: "cancelClosed"; sessionId; reason: "expired" | "restored" | "replaced" | "flushed" }`
  - A successful Undo is followed by the existing `{ status: "processing" }`.
- **Control panel → main → overlay:**

  ```js
  windowManager.sendUndoCancelDictation(sessionId?: string): Promise<UndoResult>;
  // request/reply on undo-cancel-request / undo-cancel-reply, bound to the overlay's webContents and a token;
  // times out after 2 s with { restored: false, sessionId, reason: "unavailable" }
  windowManager.lastCancelledDictation: { sessionId: string } | null;
  ```

- **Plan 05's side.** Plan 05's `onboarding-demo-undo-cancel` handler calls `sendUndoCancelDictation(lastCancelledDictation?.sessionId)` and returns `result.restored`. Its demo event carries `cancelled: CancelledState`.
- **Merge order 05 before 04.** Plan 05's own tasks import nothing from `src/types/dictation.ts` or `dictationDisclosure.js`, because those files exist only once Plan 04 has merged. They show "Discarded." with no Undo. Plan 05's Task 22 (cancelled state, Undo, disclosure copy) imports the shared types. Whichever of 04 and 05 merges second runs it.
- **Which channel.** The onboarding trial reads the cancelled state *only* from `onboarding-demo-event`, which carries the sessionId, the `CancelledState` and `cancelClosed`. The §5.7 capture bridge carries the lifecycle `state` string, which may be `"cancelled"`, for the workspace mic card. Onboarding does not read cancel details from it, so the two never compete.
- **`alsoSentTo` survives the bridge.** `sanitizeCancelledDemoFields` keeps every `RemoteDisclosure` field, including `alsoSentTo`.
- **Private holds (Plan 04 implements this).** The hold keeps the snapshot's `private` flag, through `_closeCancelled`, `restoreCancelled` and `flushCancelHold`. An expired or flushed private hold is never persisted, and a restore re-applies `private` before processing.

**Disclosure copy.** `src/helpers/dictationDisclosure.js` exports:
- `dispatchTargetLabel(target, t)`: `providerDisplayLabel` for providers, and the host for `host:…`;
- `disclosureCopy(disclosure, t)`: "{{provider}} already received the audio." for `attested`, "…may have received…" for `dispatched`, and "OpenAI, Anthropic already received parts of this dictation." when `alsoSentTo` is not empty.

Main has no user-locale `t()`, so the renderer composes the copy.

**Evidence.** When `window.electronAPI.privacy.onEgress` exists (Plan 07), `evidence` comes only from main's notices, as mapped in §5.4. Without Plan 07, Plan 04's renderer-side tracker records `dispatched` only after the transport hand-off, never `attested`.

### 5.3 Notices (owner: Plan 04; consumers: 03, 05, 06, 07)

`src/components/ui/notices.ts`:

```ts
export type NoticeKind = "receipt" | "notice" | "alert";
export type NoticeRemoval = "user" | "action" | "timeout" | "replaced" | "evicted";
export interface NoticeAction { label: string; onClick: () => void | Promise<void>; primary?: boolean; keepOpen?: boolean }
interface NoticeBase { title: string; body?: string; actions?: NoticeAction[]; persistent?: boolean; id?: string;
  details?: TechnicalErrorDetailsData; onDismiss?: (reason: NoticeRemoval) => void }
export type NoticeInput =
  | (NoticeBase & { kind: "alert"; words?: string })
  | (NoticeBase & { kind: "receipt" | "notice"; words?: never });
export function notify(input: NoticeInput): string;
export function dismissNotice(id: string, reason?: NoticeRemoval): void;
export function useNotices(): readonly Notice[];   // Notice adds id, revision, createdAt, expiresAt, remainingMs, busy
```

**Behaviour**
- **Lifetimes.**
  - A receipt lasts 3.5 s, or 7 s with an action.
  - A notice or alert lasts 10 s, or never expires when `persistent`.
  - An alert with `words` never expires, and words on any other kind promote it to an alert.
  - An alert is `role="alert"`, and never auto-dismisses while user content is at stake.
- **Updates.** The same `id` replaces the earlier notice and bumps its `revision`. An action dismisses only the revision it started on, and repeat activation is ignored while the notice is `busy`. `onDismiss` fires exactly once per revision. At most three notices are visible.
- **Before Plan 04 merges,** other plans keep calling the existing toast API, and Plan 04 migrates those call sites. A plan that starts after Plan 04 has merged calls `notify` directly.

**Fixed notices from other plans**
- **Plan 07, sealed recovery.** The recovery prompt is `notify({ kind: "notice", persistent: true, actions: [Transcribe, Discard] })`.
- **Plan 07, held audio.** A sealed dictation refusal that holds audio in memory is an `alert`.
- **Egress messages.** Any user-facing egress message is a `receipt` or `notice` whose text comes from `disclosureCopy`. Plan 07's IPC type `EgressNotice` has nothing to do with this notice tier.

### 5.4 Sealed mode (owner: Plan 07; consumers: 03, 04, 05, 06, 08)

**Scope (Plan 07 CCR-1).** While sealed, nothing that Loqui's main process, its Chromium sessions and renderers, or the child processes Loqui starts send reaches a host other than this computer's loopback (§5, Locality row).
- Both the `remote` and `network` localities are blocked. A self-hosted server on the LAN is another machine, so "Sealed · nothing leaves" would otherwise be false.
- Only `device` routes keep working.
- **Native children (D14).** Every native child Loqui starts while sealed runs inside OS-level network isolation that allows loopback only. `nothingLeaves` requires every running child to be isolated, or to be one that starts no network listener or client. "Launch-controlled but not inspected" doesn't count.
- It is enforced in Electron main, and the renderer only reflects it.
- *(Spec-owner clarification of D6, 2026-10-15. Raise it with the owner if a LAN exception is wanted.)*

**Preload API**, `window.electronAPI.privacy`. The types live in `src/types/privacy.ts`, and Plan 07 makes `privacy: PrivacyAPI` a required member of `src/types/electron.ts`, replacing Plan 03's optional `privacy?`.

```ts
getSealed(): Promise<boolean>;                                   // true when the persisted setting is unreadable (fails closed)
onSealedChange(cb: (sealed: boolean) => void): () => void;       // fires after main has applied the change and run the sealing barrier
setSealed(sealed: boolean): Promise<Attestation & { declined?: boolean }>;
getAttestation(): Promise<Attestation>;
onAttestation(cb: (attestation: Attestation) => void): () => void;
listEgress(options?: { since?: number; limit?: number }): Promise<EgressEvent[]>;
egressSummary(options?: { since?: number }): Promise<EgressSummary>;
clearEgress(): Promise<boolean>;                                 // false when the user declined main's confirmation
exportEgressCsv(): Promise<{ saved: boolean }>;
onEgress(cb: (notice: EgressNotice) => void): () => void;
onEgressCleared(cb: () => void): () => void;
```

**`Attestation`.** It carries `{ sealed, sealedSince, effectiveSince, phase: "open" | "sealing" | "sealed", failures, notes, loadError, saveError, guards, networkChildren, activeRemote, blockedSinceSealed, recordFailures, version, at, nothingLeaves }`.
- `nothingLeaves` is true only when all of these hold:
  - the phase is `"sealed"`;
  - `failures` is empty;
  - every guard is up;
  - no environment proxy is set;
  - nothing remote is left: no ticket, socket, Chromium request, DNS lookup or network child.
- A claim about past egress is dated from `effectiveSince`, never from `sealedSince`.
- An attestation older than 30 s (by `at`) is unknown.
- The UI never claims "0 bytes sent" unless `nothingLeaves` is true.

**One renderer authority: `src/stores/sealedStore.ts`.**
- **Plan 03 creates it,** with `useSealedStore` (`{ sealed: boolean; known: boolean }`), `getSealed(): boolean` and `ensureSealedSubscribed()`.
- **Plan 07 replaces its internals** (attestation, staleness, fail-closed reads). It adds to the same module:
  - `getSealedSnapshot()`, which returns at least `{ sealed: boolean | null }` plus the current attestation;
  - `subscribeSealed(cb)`.

  `src/hooks/useSealedMode.ts` is only the React hook over that module.
- **No other renderer module** calls `privacy.getSealed` or `privacy.onSealedChange`.
- **Unknown handling.** `known: false` is `sealed: null`. Route snapshots map unknown to `false`, because main enforces the seal either way.
- **Plan 07 Task 13** migrates this store, not `routeFactsStore`.

**The self-hosted probe.** `probe-self-hosted` is gated in main as `providerCheck`. While sealed, it is allowed only for loopback, and otherwise returns `{ ok: false, code: "sealed" }`. The UI shows `routes.state.sealed` for it.

**Dictation pre-flight** (Plan 07 CCR-4; it ships in Plan 07).
- `audioManager.startRecording` refuses to start when `isDictationSealed(settings, getSealedSnapshot().sealed)` is true. Only `true` blocks.
- It reports `sealedMode.blocked.dictationPreflight` through the existing error path.
- Plan 07 also ships in-memory recovery (`sealedRecovery.ts`, `AudioManager.transcribeRecovered`).
- **Plan 04 keeps the pre-flight** and the `_noteSealedFailure` call before `saveFailedTranscription` when it restructures the lifecycle. It renders the refusal as a pill state: a blocked remote ring with "Dictation paused: Sealed mode is on". Transcribe stays reachable from the pill and from the unseal notice.

**Egress evidence → `RemoteDisclosure`** (Plan 07 CCR-3, reconciled with Plan 04 CCR-6). `privacy.onEgress` delivers:

```ts
type EgressNotice =
  | { phase: "dispatched" | "delivered" | "undelivered"; ticketId: number; task: EgressTask;
      targetId: string;   // = RemoteDisclosure.target encoding
      host: string; payload: "audio" | "text" | "image" | "metadata"; correlationId: string | null; ts: number }
  | { phase: "recorded"; event: EgressEvent };   // a flight-recorder row; not disclosure evidence
```

The mapping:
- `delivered` with this session's `correlationId` and payload `audio`, `text` or `image` sets `evidence: "attested"` ("already received").
- `dispatched` alone sets `evidence: "dispatched"` ("may have received").
- `undelivered` withdraws that ticket's `dispatched` evidence, unless another ticket of the session has dispatched or delivered.
- `metadata` (token fetches, model lists) never counts.
- There is no `sent` phase. Plan 04's earlier `{ phase: "sent" }` reads as `delivered`.

The `correlationId` is the dictation session id. It is carried on the BYOK transcription payload, the realtime and streaming start options, and every cleanup, Agent, vision and translation request of the recording. A realtime session is marked `dispatched` at the first frame forwarded, never for a warm or idle socket.

The flight recorder stores metadata only: destination host, task, byte count, timestamp and outcome. It never stores content, and its retention follows the existing privacy settings.

### 5.5 System notifications (owner: Plan 02; consumer: Plan 04)

```ts
window.electronAPI.showSystemNotification(payload: { title: string; body?: string }):
  Promise<{ success: boolean; reason?: "disabled" | "unsupported" | "invalid" }>
```

- Main shows an Electron `Notification`, honouring the master `notificationsEnabled` preference. Clicking it focuses the sending window.
- It is for interruptions only and carries **no actions**.
- D2's Linux recorder notice needs a Stop action, so Plan 04 keeps its own freedesktop (gdbus) action path for that.

### 5.6 Stored audio (owner: Plan 02; consumer: Plan 03)

- `getStorageUsage()` returns `{ fileCount, totalBytes, readable }`.
- `deleteAllAudio()` returns `{ deleted, failed, readable }`.
- `remainingAudioIds()` and `clearFlagsForDeletedAudio()` exist in main.
- The renderer gets `resolveClearAudioOutcome` and `useAudioStorageUsage`.

When Plan 03's storage list (SET-R7 A) replaces this UI, it keeps `readable` and `failed`, the unavailable state and their tests. An unreadable zero is never shown as "cleared".

**Update status (Plan 02, D13).** `UpdateStatus.phase` gains `"available"`. `UpdateSettings` stays in System; Plan 03 adds only a search attribute, and keeps rendering that phase.

### 5.7 Capture status bridge (owner: Plan 06; consumers: 04, 05)

```ts
type DictationLifecycleSnapshot = {
  state: "idle" | "preparing" | "recording" | "processing" | string;   // future states pass through
  inputKind: "dictation" | "assistant" | "translation";
};
getDictationLifecycleState(): Promise<DictationLifecycleSnapshot>;           // control panel only
onDictationLifecycleChanged(cb: (s: DictationLifecycleSnapshot) => void): () => void;
onDictationLevelChanged(cb: (level: number) => void): () => void;            // ≤15 Hz, only while recording
toggleDictationFromControlPanel(): Promise<{ success: boolean }>;
```

Plan 04's `cancelled` state reaches the control panel through this channel.

- **State strings.** Main forwards any `state` string of 1–64 characters unchanged, with no character-set restriction. A non-string or longer value becomes `"idle"`.
- **Normalization.** Main's own normalization for the pill, tray and hotkey gates is separate, and never rewrites the bridge field.
- **Unknown states.** Plan 06 maps any state it does not know to "ready". Plans 04 and 05 reuse this channel and add no second relay.

### 5.8 Workspace token guard (owner: Plan 06; consumers: every plan that edits a workspace file)

`test/helpers/workspaceTokenGuard.js` exports `LINE_RULES`, `LIVE_GLASS_ALLOWED`, `WORKSPACE_GUARDED_FILES`, `scanText(file, text)` and `scanFiles(files)`. `test/components/workspaceTokenAdoption.test.js` asserts that `scanFiles(WORKSPACE_GUARDED_FILES)` is `[]`.

- **Rules.** The rule ids are `arbitrary-size`, `faded-muted`, `faded-foreground` (below `/70`), `orange-text`, `orange-fill`, `raw-amber`, `glyph-icon`, `provider-name`, `faded-ring`, `live-glass` (outside `ChatInput.tsx`) and `icon-cta`. Plan 06 CR-06-6 has the table of what each rejects and what to use instead.
- **Opt-out.** An exception is a same-line comment `token-guard: allow <rule-id> — <reason>`. The reason is required, and the PR body lists every opt-out.
- **New files.** Plan 08's new files may opt in by calling `scanFiles([...])` in their own tests.

### 5.9 Space surface (owner: Plan 06; consumer: Plan 08)

Plan 06 keeps `ContainerOverview` (`src/components/notes/overview/ContainerOverview.tsx`) with its props unchanged: `{ space, folder, onOpenNote, onNewNote, onAddExisting }`. `PersonalNotesView` renders it as the Space root whenever no note is open. Plan 08 mounts its view switch in the overview's header.

### 5.10 Entity mention links (owner: Plan 06; consumers: Plan 08 and later)

From `src/utils/mentionMarkdown.ts`:
- **Href scheme.** `<kind>:<positiveInt>`, where `kind` is `note | meeting | dictation | folder`. It is stored as `[@Label](note:17)`, with the label escaped by `markdownLabel`.
- **Kinds.** `export type MentionKind = "person" | "note" | "meeting" | "dictation" | "folder"` and `export const ENTITY_MENTION_KINDS`.
- **Parser.** `export function parseMentionHref(href: string | null | undefined): Omit<MentionEntity, "label"> | null`.
- **Navigation.** Workspace hrefs navigate inside Loqui and never reach the OS URL handler.

### 5.11 Labs flags (owner: Plan 08; consumers: later prototypes)

- **Setting.** A boolean setting such as `labsTable` lives in `src/stores/settingsStore.ts` (`BOOLEAN_SETTINGS`, `readBoolean`, `createBooleanSetter`). Its row lives in `LabsSettings` (`src/components/settings/LabsSettings.tsx`), under Settings → System.
- **Behaviour.** A Labs flag defaults to `false`, and gates both the UI and any change to requests. Turning it off restores today's behaviour exactly.
- **New prototypes** add their own flag and row to the same panel.
