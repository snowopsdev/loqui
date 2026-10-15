# Loqui UI/UX overhaul: approved scope and roadmap

**Status:** approved 2026-10-15. Owner confirmed D2 and D3 on 2026-10-15.
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
  - Orange stays the focus-ring and active-nav accent in light theme; the light nav marker is the deeper orange `#E84E16` so it clears 3:1 on the sidebar surface.
- **D2, VO-R12 A "Recorder capsule" is a state of the existing pill window, not a second always-on-top window.** *(Confirmed.)*
  - The pill shows a red-orange dot, mm:ss and Stop while a meeting records, and dictation still works from it.
  - Linux fallbacks: the tray icon shows a recording state, and a persistent notification has a Stop action.
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
  | `remote` (provider) | dashed orbit + provider badge | `#b45309` | `#fbbf6a` |

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

## 3. Plans and dependencies

```
01 Foundations ──┬─> 03 Routes & Settings ──┬─> 04 Voice overlay
02 Bug & a11y    │                          ├─> 05 Onboarding
   sweep (parallel with 01)                 ├─> 06 Workspace
                 │                          └─> 07 Sealed mode & flight recorder
                 └─> 08 Prototypes (WS-M4 spike, WS-M5) after 06
```

| Plan | Recommendations | Quick wins |
|---|---|---|
| 01 Foundations | FND-R1–R5, WS-R11 B (colour roles) | ONB-Q4* (tokens), VO-Q1, VO-Q2, VO-Q3, VO-Q4*, VO-Q17, WS-Q4* (tokens), WS-Q15, SET-Q14 |
| 02 Bug & a11y sweep | none | ONB-Q1, ONB-Q2, VO-Q6, VO-Q8, VO-Q9, VO-Q16, WS-Q1, WS-Q5, WS-Q7, SET-Q1, SET-Q2, SET-Q5, SET-Q6, SET-Q7, SET-Q11, SET-Q12, SET-Q13, SET-Q16, SET-Q20, SET-Q25 |
| 03 Routes & Settings | SET-R1 B, R2 A, R3 B, R4 B, R5 C, R7 A | SET-Q3, Q4, Q8, Q9, Q10, Q15, Q17, Q18, Q19, Q21, Q22, Q23, Q24 |
| 04 Voice overlay | VO-R1 C, R6 B (+D3), R8 B, R10 A, R11 B, R12 A (+D2), R14 B | VO-Q5, Q7, Q10, Q11, Q12, Q13, Q14, Q15, Q18, Q19, Q20, Q21 |
| 05 Onboarding | ONB-R1 C, R2 B, R3 C, R4 B, R5 C, R6 B, R7 B, R8 A, ONB-M2 | ONB-Q3, Q4 (adoption), Q5, Q6, Q7, Q8, Q9, Q10, Q11, Q12, Q13, Q14, Q15, Q16, Q17, Q18 |
| 06 Workspace | WS-R1 B, R2 A, R3 A+C, R4 B, R5 A, R6 B, R7 B, R8 B, WS-R11 B (type ramp) | WS-Q2, Q3, Q4 (adoption), Q6, Q8, Q9, Q10, Q11, Q12, Q13, Q14 |
| 07 Sealed mode & flight recorder | SET-R6 C, SET-M3 | none |
| 08 Prototypes | WS-M4 (spike first), WS-M5 | none |

\* Delivered per D1. Plan 01 ships the tokens, the `Button` variants and the contrast tests. Onboarding (05) and Workspace (06) adopt them in their own screens, which is where the type ramp lands too.

Each plan is written just before it executes, so it can use the interfaces the earlier plans actually shipped. Plans 01 and 02 can run in parallel worktrees. Plans 04, 05 and 06 can run in parallel once 01 and 03 have merged.

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

Plans 02–08 are planned in parallel. Every plan codes against these contracts, and only the owning plan may change them; if a contract has to change, the owner updates this section in the same PR. The contracts from Plan 01 (`docs/superpowers/plans/2026-10-15-loqui-uiux-01-foundations.md`) are:

| Contract | Produced items |
|---|---|
| Motion and colour tokens | `--motion-*`; `--color-cta*`, `--color-live*`, `--color-nav-marker`, `--color-locality-*` |
| Button | `variant="live"` |
| Locality | `src/lib/locality.ts`: `Locality`, `RouteLocality`, `resolveLocality`, `providerDisplayName`, `providerDisplayLabel`, `providerMonogram`, `isLoopbackUrl` |
| Locality ring | `src/components/ui/LocalityRing.tsx` |
| Level meter | `src/components/ui/LevelBars.tsx` and `levelBarsMath.ts` |
| Test helpers | `src/utils/contrast.ts`, `test/helpers/harness/cssTokens.js` |

### 5.1 Route graph (owner: Plan 03; consumers: 04, 05, 06, 07)

`src/lib/routes.ts` is a pure module with no IPC. It takes a settings snapshot and returns every routing decision.

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
  | { status: "off" }                         // user turned the task off (e.g. cleanup disabled)
  | { status: "needsModel"; sizeBytes?: number }
  | { status: "needsKey"; provider: string }
  | { status: "needsUrl" }
  | { status: "unreachable"; detail?: string };

export interface ResolvedRoute {
  id: RouteId;
  kind: RouteKind;
  locality: Locality;
  provider: string | null;      // display name, from providerDisplayName
  model: string | null;         // display name of the selected model
  state: RouteState;
  sends: string | null;         // plain-language payload when remote, e.g. "the audio file"; null when local
  settingsPath: string;         // deep link inside Settings, e.g. "stt/dictation"
}

export function resolveRoutes(snapshot: RouteSettingsSnapshot): ResolvedRoute[]; // always 11 entries, in RouteId order
export function resolveRoute(snapshot: RouteSettingsSnapshot, id: RouteId): ResolvedRoute;
export function useResolvedRoutes(): ResolvedRoute[];                              // React hook over settingsStore
export function useResolvedRoute(id: RouteId): ResolvedRoute;
```

`RouteSettingsSnapshot` is Plan 03's choice: the subset of `SettingsState` the resolver reads. Readiness that needs main-process facts (model on disk, key saved) arrives through existing preload calls. The hook exposes it, and the pure resolver receives it as fields on the snapshot.

### 5.2 Dictation lifecycle additions (owner: Plan 04; consumers: 05, 07)

Plan 04 adds to the existing lifecycle in `src/hooks/useAudioRecording.js`:
- a `cancelled` state carrying `{ undoUntil: number; remoteAlreadySent: string | null }`;
- `undoCancel(): Promise<boolean>`;
- a `meetingRecording` pill state carrying `{ startedAt: number }`.

Onboarding (05) uses the same pill states in its trial. Plan 07 reads `remoteAlreadySent` for the flight recorder.

### 5.3 Notices (owner: Plan 04; consumers: 03, 05, 06)

Plan 04 replaces ad-hoc toasts with `notify({ kind: "receipt" | "notice" | "alert", title, body?, actions?, persistent? })` from `src/components/ui/notices.ts`. Receipts auto-dismiss. A notice stays until acknowledged when `persistent` is set. An alert is `role="alert"` and never auto-dismisses while user content is at stake. Until Plan 04 merges, other plans keep calling the existing toast API, and Plan 04 migrates those call sites.

### 5.4 Sealed mode (owner: Plan 07; consumers: 03, 04)

Main exposes `window.electronAPI.privacy.getSealed(): Promise<boolean>` and `onSealedChange(cb)`. While sealed, the route resolver reports remote routes as `{ status: "unreachable", detail: "sealed" }`, and the pill shows the remote ring as blocked.
