# Loqui UI/UX Plan 06: Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the main window into a voice-first workbench:
- one sidebar with Spaces;
- a Capture button and mic status that show live listening state;
- a Home that answers "is it listening, what's next" and scans across dictations, notes and meetings;
- a command palette that runs commands;
- a notes editor with slash menu, bubble toolbar, real typography and universal mentions;
- a chat that answers as a document, cites its sources and shows which model (local or remote) answered.

**Architecture:**
- **Logic** lives in small pure modules under `src/lib/`, `src/components/chat/` and `src/components/ui/editor/`, so `node:test` covers it without a DOM. These are home feed, capture status, shortcuts, fuzzy match, slash items, mention hrefs and citations.
- **React components** are split into presentational parts and thin containers. Presentational parts take plain props and are tested with `renderStatic`. Containers wire stores, IPC and the Plan 03 route hook.
- **Main process** gets one new pair of channels so the control panel can see and toggle dictation (Task 5).
- **Navigation** from deep places goes through one React context, `WorkspaceNavigation` (Task 3). Those places are mention chips, citations, palette rows and Insights tiles.

**Tech Stack:** React 19, Tailwind CSS 4 (`@theme`, `@container`), zustand, Tiptap 3.31.3 (`@tiptap/suggestion`, `@tiptap/react/menus`), react-markdown + remark-gfm, Electron IPC (preload `registerListener`), Node `node:test` with `tsx`, `test/helpers/harness/reactSsr.js` and `test/lib/rendererTestHarness.js`.

**Spec:** `docs/superpowers/specs/2026-10-15-loqui-uiux-overhaul.md`:
- the Plan 06 row in §3;
- decisions D1, D4, D10 and D11 in §2;
- the global constraints in §4;
- the contracts in §5 (the Plan 01 table), §5.1, §5.3, §5.4 and §5.7–§5.10, as consolidated in spec commit 091d198.

The visual acceptance reference is `design-explorations/loqui-uiux-review.html#ch-workspace`, using the picked variant card for each rec. Where a mock and its card's spec list disagree, this plan follows the spec list. The evidence base is `.omc/research/ui-review/audit-workspace.md` and `screens/ws-*.png`. Both live in the `t3-5038e8e6` worktree and are untracked.

**Builds on:**
- Plan 01, the tokens contract: `--motion-*`, `--color-cta*`, `--color-live*`, `--color-nav-marker`, `--color-locality-*`, `Button variant="live"`, `src/lib/locality.ts`, `LocalityRing`, `LevelBars`, `src/utils/contrast.ts`, `test/helpers/harness/cssTokens.js`.
- Plan 02, which owns WS-Q1 (ticking "now"), WS-Q5 (the textarea composer) and WS-Q7 (removing the Notes gate). Plan 06 owns WS-Q7's Notes readiness handoff (§5.1, Task 26).
- Plan 03, which owns §5.1: `useResolvedRoute`, `routeSnapshotFromSettings` and the route chips.
- Plan 04, which owns §5.3 `notify`.

**Execution order** (spec §3): 01 → 02 → 03, then 04, 05, 06 and 07 in parallel, each rebased onto 03 before it starts; 08 runs after 06. Where Plan 06 meets 04 or 05 (the capture status bridge, §5.7), whichever merges second wires the real contract and deletes its fallback. Plan 06's fallback is Task 6's mapping of unknown lifecycle states to Ready.

---

## Review response (Codex review `plan-06-codex.md`, 2026-10-15: 0 Critical, 16 Important, 4 Minor)

Every Important finding is closed. Minor findings M01–M03 are closed, and so is the file-map and handback half of M04. Only M04's request to split the plan is disputed (below). Each fix has a behavioural test that fails on the reviewed design and passes on the revised one; "Pinned in" names it.

| # | Finding | Fix | Pinned in |
|---|---|---|---|
| I01 | Palette seed inherits an armed send queue | `ChatInput` applies a `seed` during render: it replaces the draft, disarms `queued` when `resetQueue`, and bumps a draft generation so a refused send that started earlier cannot restore its text over the seed. ChatView `new`/`open` requests reset the queue; `focus` keeps it. | Task 4, `chatComposerSeed.test.js` (mounted): "a palette seed disarms a queued draft…", "a refused send that started before a new chat…", "a focus-only request keeps…", "a seed present at mount…" |
| I02 | Stop during pinned-context loading starts a request anyway | After `await buildPinnedContext(...)` the stream rechecks `cancelled() \|\| !mountedRef.current` before any provider call. | Task 22, `useChatStreamingCancellation.test.js` (deferred lookup on the real hook): Stop, unmount and a superseding send never reach the provider |
| I03 | Suggestion helper does not typecheck | `suggestionPopup.ts` is constrained `P extends object`, with an explicit `SuggestionPopupComponent<P>` and a `RendererProps` widening. Both callers compiled with tsc 6.0.3 against the repo's `node_modules` in `strict: false` and `strict: true`; reverting the constraint reproduces TS2344. | Task 15, Step 4 runs `npm run typecheck` |
| I04 | A fetched deep-linked note is not available to the editor | `noteStore` gains `openedNotes` and `openNoteById(id)` (one fetch-by-id path); `updateNoteInStore` and `removeNote` keep it current. Navigation and the palette use it. | Task 3, `noteOpenRestore.test.js`: "a deep link opens a note older than the first page, and the editor can read it", "an IPC delete of an opened older note…" |
| I05 | Ask AI seeds a composer that then hides | NoteEditor opens the floating chat (`chatMode`) and passes `composerSeed` to both `EmbeddedChat` instances, which forward it to `ChatInput`'s `seed`. `NoteBottomBar` is not seeded. | Task 16, `bubbleToolbar.test.js`: "Ask AI opens a visible composer and seeds it, disarming any queue (I05)" |
| I06 | Launch restore races the tree's auto-select | `restoreLaunchNote(id)` sets `launchRestorePending`, and `initializeNotesTree` skips its first-note pick while it is set. A navigation generation lets a user's click supersede the restore. | Task 3, `noteOpenRestore.test.js`: both load orders, and "pending native navigation during a restore takes precedence" |
| I07 | Bubble clicks refocus the document | `editorChrome.ts` `isEditorChromeTarget`; RichTextEditor's click-to-focus ignores `[data-editor-chrome]`; BubbleMenu prevents default on `mousedown` except in inputs. | Task 16, `editorChrome.test.js` |
| I08 | Hover-card actions vanish before they can be reached | `useHoverCard` (reducer, 150 ms close delay, one boundary around chip and card using `relatedTarget` containment, Escape returns focus to the chip). | Task 18, `hoverCard.test.js`: gap crossing, Tab into Open/Insert quote, Tab out, Escape |
| I09 | Slash AI readiness reads the cleanup model | `noteAiReadiness(useResolvedRoute("noteFormatting").state)`; not-ready shows a `setupAi` item that opens the route's `settingsPath`. | Task 15, `slashItems.test.js` "(I09)" and "PersonalNotesView takes readiness from the route" |
| I10 | Mention interception precedes Plan 02's IME check | `handleKeyDown` returns on `nativeEvent.isComposing \|\| keyCode === 229` before calling `interceptKeyDown`. | Task 22, `chatComposerMention.test.js`: "an IME candidate commit never reaches the mention picker or submits (I10)" |
| I11 | Answer stamped Local after a remote request | `getRoute()` removed. The stream resolves `sentRoute` from the same `settings` snapshot that builds the request, and stamps that. | Task 21, `useChatStreamingCancellation.test.js`: "the route stamp is the route the request used, even if Settings change while context loads (I11)" |
| I12 | Pinned-only sources are never citable | `Message.context.pinnedNotes` is recorded, saved and loaded; ChatMessage's `collectSources` call (Task 20) passes `ragNotes` and `pinnedNotes` together. | Task 22: "a pinned-only note is cited even with empty RAG and tool results…", "a completed answer records the pinned notes it was given (I12)" |
| I13 | Meeting capture shows the dictation route | `CaptureStatus.inputKind` plus `captureRouteIds(status)` select `noteRecordingStt` for meetings and `voiceAssistant`/`translation` for the text route. The mic card and sidebar render those routes. | Task 6, `captureStatus.test.js`; Task 8, `micStatusCard.test.js` "a meeting shows the meeting route… (I13)" |
| I14 | Low-contrast focus and action indicators | Row actions rest at full `text-muted-foreground` (7.9:1); every new control keeps `focus-visible:ring-2 focus-visible:ring-ring`; the guard's `faded-ring` rule rejects `ring-*/NN`. | Task 9 "(I14)"; Task 12 "actions are visible at rest… (I14)"; Task 25 guard |
| I15 | Guard omits workspace screens | The guard is a shared module (`test/helpers/workspaceTokenGuard.js`, CR-06-6). It adds Integrations, Dictionary, Snippets, UploadAudioView and CaptureControl, plus `faded-foreground` and `faded-ring` rules. It reports about 390 violations on today's tree, including every file the review named. | Task 25, `workspaceTokenAdoption.test.js` (scan, rule self-test, standard-size invariant) |
| I16 | Task 1 replaces Plan 03's locale helper | Task 1 now upgrades Plan 03's `scripts/merge-locale-keys.js` with an opt-in `--strict`. The plain CLI is unchanged (same usage exit 2, same `Missing locales in fragment:` exit 1), and Plan 03's test passes unchanged. | Task 1, `mergeLocaleKeysStrict.test.js` (verified 5/5 against Plan 03's helper) |
| M01 | History landing needs request scope and a ring nonce | `transcriptionStore.revealTranscription(id)` fetches by id and inserts in order; the landing uses a request generation; the ring is `{ id, nonce }`, keyed by nonce. | Task 12, `transcriptionReveal.test.js`; Task 3 "asking for the same transcript twice re-rings it" |
| M02 | Entity labels need a real Markdown round trip | `markdownLabel` escapes `\`, `*`, `_`, `` ` `` and `~` after `sanitizeLabel`; both builders use it. | Task 17: "labels survive a real Markdown parse… (M02)", through `markdown-it` |
| M03 | Publish the Plan 08 handoff; reconcile numbering | CR-06-6, CR-06-7 and CR-06-8 below, and one proposed §5 numbering for all plans. | This section |
| M04 | Reduce bulk; make the handback accurate | File map regenerated (it now lists `chatRequest.ts`, `messageRoute.ts`, `editorChrome.ts`, `useHoverCard.ts`, the guard and the `cn` change). Task 27's handback lists CR-06-1…8 and the manual checks the review asked for. **The split is disputed** (below). | File map; Task 27 |

**Disputed: M04's request to split the plan into three documents.**
- **Scope is one spec row.** Spec §3 assigns the workspace to Plan 06 as one unit, and the shell, Home, editor and chat tasks share contracts that a split would duplicate: `WorkspaceNavigation` (Task 3) is consumed by Tasks 12, 13, 18, 20 and 23; `ComposerSeed` (Task 4) by Tasks 13 and 16; the guard (Task 25) by every task. Three documents would need a fourth "shared contract" document, which is what this plan's Interfaces blocks already are.
- **The review's concern is contradictions, and those are fixed at their source.** All sixteen Important findings were wrong behaviour in a specific task, not drift between duplicated copies. Each is now pinned by a behavioural test (table above), so a contradiction fails a test rather than hiding in volume.
- **Execution is already bounded.** Each task ends in its own commit and runs alone under superpowers:subagent-driven-development; a subagent reads one task, not the whole document.
- **What was done instead:** the file map was regenerated and the handback completed (the actionable half of M04). If the owner still wants a split after reading this, Tasks 1–13, 14–18 and 19–26 are the natural cut points, and each already starts from merged code.

## Contract change requests

**All eight requests are applied in spec commit 091d198.** The spec's §5 now holds the binding shapes; this section keeps the rationale. Where this plan and the spec disagree, the spec wins.

**Numbering.** The proposal this section used to carry is superseded by the spec owner's numbering: §5.5 System notifications (Plan 02), §5.6 Stored audio (Plan 02), §5.7 Capture status bridge (CR-06-3), §5.8 Workspace token guard (CR-06-6), §5.9 Space surface (CR-06-7), §5.10 Entity mention links (CR-06-8), §5.11 Labs flags (Plan 08). Every § reference in this plan uses these numbers.

1. **CR-06-1. Add a Plan 02 → Plan 06 edge to §3 (owner: Plan 02; consumer: 06). Applied in spec §3 (091d198)**, which records 01 → 02 → 03 → {04, 05, 06, 07} and names Plan 02's harness. Plan 06 builds on WS-Q1, WS-Q5 and WS-Q7, but the §3 graph only gates 06 on 01 and 03. Plan 06 consumes these names from Plan 02:
   - `src/hooks/useNow.ts`: `export function useNow(intervalMs?: number): Date`. Tasks 11 and 12 read "now" from it.
   - `ChatInput.tsx` after WS-Q5 (Plan 02 Task 12): the `inputText`/`setInputText` and `queued`/`setQueued` state pairs, `inputRef`, `handleKeyDown` (with its `isComposing` check), the async `handleSubmit` that restores the draft on refusal, and the props `agentState`, `onTextSubmit`, `onCancel`, `autoFocus`, `placeholder`, `className` and `voiceDraft`. Tasks 4 and 22 add props on top of them.
   - The focus rule `focus-visible:ring-2 focus-visible:ring-ring` (Plan 02 Task 3).
   - The test harness files `test/helpers/harness/rendererMocks.js` (`rendererOptions`, `TOAST_MOCK`) and `test/helpers/harness/fakeDomTree.js` (`installTree`). Tasks 4 and 22 mount the composer with them.
2. **CR-06-2. Extend §5.1 (owner: Plan 03). Applied in spec §5.1 (091d198):** `settingsPath` is "always a valid SettingsModal initialSection". Plan 06 opens Settings from the chat model chip, the mic card, the slash menu's `setupAi` item and the Notes Actions hint with `onOpenSettings(route.settingsPath)`.
3. **CR-06-3. "Capture status bridge" (owner: Plan 06; consumers: 04, 05). Applied in spec §5.7 (091d198).** Plan 06 adds these preload methods (Task 5):

   ```ts
   type DictationLifecycleSnapshot = {
     state: "idle" | "preparing" | "recording" | "processing" | string; // future states pass through
     inputKind: "dictation" | "assistant" | "translation";
   };
   getDictationLifecycleState(): Promise<DictationLifecycleSnapshot>;          // control panel only
   onDictationLifecycleChanged(cb: (s: DictationLifecycleSnapshot) => void): () => void;
   onDictationLevelChanged(cb: (level: number) => void): () => void;           // ≤15 Hz, only while recording
   toggleDictationFromControlPanel(): Promise<{ success: boolean }>;
   ```

   Plan 04 adds `cancelled` (§5.2), which reaches the control panel through the same channel. Plan 06 maps any state it does not know to "ready". Plans 04 and 05 should reuse this channel rather than add a second relay. `inputKind` is what lets the mic card name the right route (I13).
4. **CR-06-4. Add to the §5 Plan 01 token table, marked "added by Plan 06". Applied in spec §5, Plan 01 contracts, "Motion and colour tokens" row (091d198).** The new tokens are `--color-ai`, `--color-ai-text`, `--color-agent`, `--color-agent-text`, and the UI type ramp `--text-display|title|heading|body|ui|caption|micro`, which carries line-height, weight and tracking. They are additive: the ramp never redefines Tailwind's `--text-xs…--text-9xl` (Task 25 tests this). This request creates **no dependency** of Plans 04 or 05 on Plan 06. They may adopt the aliases after Plan 06 merges, and the existing `--color-agent-brand` stays valid until an agreed migration.
5. **CR-06-5. Extend §5.1 (owner: Plan 03): `providerId: string | null` on `ResolvedRoute`. Applied in spec §5.1 (091d198).** UI names providers with `providerDisplayLabel(route.providerId, t)` (Plan 01), which localises "Custom endpoint" and "Unknown provider". `provider` stays for logs. Plans 04, 05 and 08 should do the same.
6. **CR-06-6. "Workspace token guard" (owner: Plan 06; consumers: every plan that edits a workspace file, Plan 08 first). Applied in spec §5.8 (091d198).** This settles the Plan 08 Task 10 collision on `TranscriptionItem.tsx`.
   - **Module:** `test/helpers/workspaceTokenGuard.js` (Task 25) exports `LINE_RULES`, `LIVE_GLASS_ALLOWED`, `WORKSPACE_GUARDED_FILES`, `scanText(file, text)` and `scanFiles(files)`. `test/components/workspaceTokenAdoption.test.js` asserts `scanFiles(WORKSPACE_GUARDED_FILES)` is `[]`.
   - **What it rejects**, by rule id:

     | Rule id | Rejects | Use instead |
     |---|---|---|
     | `arbitrary-size` | `text-[Npx]` | the ramp: `text-micro` (11), `text-caption` (12), `text-ui` (13), `text-body` (15), `text-heading`, `text-title`, `text-display` |
     | `faded-muted` | `text-muted-foreground/NN` | full `text-muted-foreground` |
     | `faded-foreground` | `text-foreground/NN` with NN below 70 | `text-muted-foreground` (70 and above passes) |
     | `orange-text` | `text-primary` (not `text-primary-foreground`) | `text-link` |
     | `orange-fill` | `bg-primary`, with or without `/NN` | a neutral surface; `bg-live` on voice controls |
     | `raw-amber` | `text-`, `bg-` or `border-amber-NNN` | the `warning` tokens |
     | `glyph-icon` | `⊘` | a Lucide icon and a word |
     | `provider-name` | `providerDisplayName(` | `providerDisplayLabel(providerId, t)` |
     | `faded-ring` | `ring-ring/NN`, `ring-primary/NN` | `ring-2 ring-ring` |
     | `live-glass` | `GRADIENT_CIRCLE`, `BRAND_GLASS_SURFACE`, `gradient-brand-glass` outside `ChatInput.tsx` | a neutral surface or `Button variant="secondary"` |
     | `icon-cta` | a default `<Button>` whose first child is a component (an icon) | `variant="live"` (voice) or `"secondary"`/`"outline"` |

   - **What it does not reject:** Tailwind's standard sizes (`text-xs`, `text-sm`, `text-base`), hover and background opacities (`hover:bg-foreground/6`), and `text-foreground/70` and above. Those migrate when a file is touched, not by force.
   - **Scope** is `WORKSPACE_GUARDED_FILES`: the shell (ControlPanel, sidebar, top bar), History, CommandSearch, UpcomingMeetings, Insights, Integrations, Dictionary, Snippets, CaptureMenu, CaptureControl, MicStatusCard, TranscriptionItem, EmptyStateCard, DataRetentionNotice, the mention components, NoteEditor, NoteBottomBar, PersonalNotesView, SpacesTree, UploadAudioView, UploadDropZone, and every `.tsx` in `chat/`, `home/`, `insights/` and `ui/editor/`.
   - **Opt-out:** a same-line comment `token-guard: allow <rule-id> — <reason>`. The reason is required; reviewers read it and the PR body lists it.
   - **How Plan 08 complies** (its Task 10 already says it codes against this guard):
     - `TranscriptionItem.tsx` raw paragraph: Plan 06 Task 12 sets it to exactly `mt-1 text-caption leading-relaxed text-muted-foreground`. Plan 08's `RAW_TEXT_CLASS` uses that string.
     - `TranscriptionItem.tsx` list paragraph: Plan 06 Task 12 sets `text-body line-clamp-4 wrap-break-word whitespace-pre-wrap text-foreground` with `onClick={copyUnlessSelecting}`. Plan 08's `ConfidenceText` branch and its plain `<p>` branch use that className and keep the `onClick`, instead of the pre-Plan 06 `text-base leading-normal …` it quotes.
     - Confidence typography (WS-M4) is on hold (spec D11), so Plan 08 ships no `ConfidenceText` branch for now. If WS-M4 returns, faded low-confidence words use a reasoned opt-out, for example `token-guard: allow faded-foreground — low-confidence word (Labs, Plan 08)`.
     - Plan 08's new files (`src/components/table/*`, `ConfidenceText.tsx`, `ConfidenceWordPopover.tsx`, `TranscriptDiff.tsx`) may opt in by calling `scanFiles([...])` in their own test; Plan 06 does not add them to its list. If opted in, `TableViewSwitch`'s `text-foreground/60` (P08 Task 17) fails `faded-foreground` and should become `text-muted-foreground`.
     - `HistoryMenu.tsx` (Plan 06 Task 12) is in scope through `home/`. Plan 08's added checkbox row passes as long as it reuses the existing row classes.
7. **CR-06-7. "Space surface" (owner: Plan 06; consumer: Plan 08). Applied in spec §5.9 (091d198).** Accepts Plan 08 CCR-1's second option. Plan 06 keeps `ContainerOverview` (`src/components/notes/overview/ContainerOverview.tsx`) with its props unchanged, `{ space, folder, onOpenNote, onNewNote, onAddExisting }`. `PersonalNotesView` renders it as the Space root whenever no note is open. Task 9 removes the second column and the duplicate tree, not the overview. Plan 08 mounts its view switch in the overview's header.
8. **CR-06-8. "Entity mention links" (owner: Plan 06; consumers: Plan 08, any later plan that links entities). Applied in spec §5.10 (091d198).** Accepts Plan 08 CCR-2. Published from `src/utils/mentionMarkdown.ts` (Task 17):
   - the href scheme `<kind>:<positiveInt>`, with `kind` one of `note | meeting | dictation | folder`, stored in Markdown as `[@Label](note:17)` with the label escaped by `markdownLabel`;
   - `export type MentionKind = "person" | "note" | "meeting" | "dictation" | "folder";` and `export const ENTITY_MENTION_KINDS`;
   - `export function parseMentionHref(href: string | null | undefined): Omit<MentionEntity, "label"> | null`, which returns `null` for anything that is not an entity or a person mention;
   - the rule that workspace hrefs navigate inside Loqui and never reach the OS URL handler (Task 20).

§5.3 (notices) needs no change. Plan 06 writes `useToast().toast(...)`, and Plan 04 migrates those call sites when it merges, as §5.3 says. If Plan 04 has already merged when Plan 06 starts, the Preconditions rule applies, and Plan 06 calls `notify` directly.

## Global Constraints

These are copied from spec §4 and Plan 01, plus the rules this plan adds.

- Electron main owns SQLite, credentials, native runtimes, provider requests and updates. Renderers talk only through typed preload IPC (CLAUDE.md).
- Local and remote choices stay explicit. Nothing silently switches provider or moves work from local to remote. Content is preserved on every failure. **In this plan:** no palette, bubble or mention action sends a chat message on the user's behalf. They seed the composer, so the model chip (local or remote) is visible before anything leaves the device.
- Text contrast is at least 4.5:1 and non-text UI at least 3:1, in light and Plum Night.
- D1: orange means live voice. `Button variant="live"` and `bg-live` appear only on record, stop, mic and listening states. Idle Capture is neutral. Orange text on light uses `text-link`.
- Motion uses the shared tokens only (`--motion-*`). Every loop is gated to its active state. Reduced motion keeps opacity and colour feedback and drops transforms.
- No size below 11px. Readable text floors at 12px (WS-R11 B). Metadata uses full `text-muted-foreground`, never `/55`, `/60` or `/70`.
- Every visible string goes through i18n, with keys in all 11 locale folders (`ar de en es fr it ja pt ru zh-CN zh-TW`). `npm run i18n:check` and `test/locales/translationCoverage.test.js` must pass.
  - This plan gives the English copy verbatim. The implementer translates it into the other 10 locales, keeping `{{placeholders}}` and plural suffixes.
  - Strings are added with Plan 03's merge helper in `--strict` mode (Task 1): `node scripts/merge-locale-keys.js --strict <fragment.json>`.
- RTL: use logical properties (`ms-`/`me-`, `ps-`/`pe-`, `start`/`end`, `inset-inline-*`).
- Focus: every new or changed interactive element uses Plan 02's `focus-visible:ring-2 focus-visible:ring-ring`, never a translucent ring (`ring-ring/50`). The Task 25 guard enforces it.
- **Route disclosure (§5.1).** Wherever Plan 06 shows where a route goes (the chat model chip, the per-answer stamp, the mic card), it uses Plan 03's `RouteDestinationChip` and, when the route is not ready, `RouteStateChip`. It builds no chip of its own. Stored history rows (Task 12) show a recorded locality, not a route, so they keep `LocalityRing`.
- **Unknown is not ready (§5.1 rule 1).** A route in `unknown` renders as Plan 03's neutral "Checking…" chip, or as nothing (the Notes hint), and never as ready or as a fix to make.
- **Sealed (§5.4).** Sealed mode blocks both `network` and `remote`. Plan 06 learns about it only through route states (`unreachable`/`sealed`, §5.1 rule 7). It never calls `privacy.getSealed` or `onSealedChange`, never passes `sealed` to `buildRouteSnapshot`, and if it ever needs the flag directly it reads `src/stores/sealedStore.ts` and nothing else.
- Provider names shown in the UI always come from `providerDisplayLabel(providerId, t)` (`src/lib/locality.ts`, Plan 01). `providerDisplayName` is for logs and other non-UI uses only. The Task 25 guard enforces this in workspace files.
- Never use personal profiles in tests.
- Tests: run `npm run native:node` once, then `npm test -- <files>`. Run `npm run native:electron` before launching the desktop app. Node is `~/.nvm/versions/node/v24.21.0/bin` (`.node-version` 24.21.0).
- Before the PR: `npm run lint`, `npm run typecheck`, `npm test`, `npm run i18n:check`.
- D10: `DESIGN.md` is updated in the same commit as the change it documents.

## Preconditions (check before Task 1)

Plan 06 executes after Plans 01, 02 and 03 have merged (spec §3, plus CR-06-1). Run:

```bash
git fetch origin && git rebase origin/main
test -f src/lib/locality.ts && test -f src/components/ui/LocalityRing.tsx && test -f src/components/ui/LevelBars.tsx && echo "plan01 ok"
grep -q "variant=\"live\"\|live:" src/components/ui/button.tsx && grep -q -- "--color-live:" src/index.css && echo "plan01 tokens ok"
grep -q "export function providerDisplayLabel" src/lib/locality.ts && echo "plan01 provider label ok"
test -f src/lib/routes.ts && grep -q "export function useResolvedRoute" src/lib/routes.ts && echo "plan03 ok"
grep -q "providerId" src/lib/routes.ts && echo "plan03 providerId ok (CR-06-5)"
test -f src/hooks/useNow.ts && grep -q "export function useNow" src/hooks/useNow.ts && echo "plan02 useNow ok"
grep -q "<textarea" src/components/chat/ChatInput.tsx && grep -q "const \[queued, setQueued\]" src/components/chat/ChatInput.tsx && echo "plan02 composer ok"
test -f test/helpers/harness/rendererMocks.js && test -f test/helpers/harness/fakeDomTree.js && echo "plan02 harness ok"
test -f scripts/merge-locale-keys.js && test -f test/scripts/mergeLocaleKeys.test.js && echo "plan03 locale helper ok"
grep -q "export function RouteDestinationChip" src/components/settings/routing/RouteChips.tsx && grep -q "export function routeSnapshotFromSettings" src/lib/routes.ts && test -f test/lib/routeFixtures.js && echo "plan03 chips and snapshot ok"
test -f src/hooks/useNoteActionsReady.ts && echo "plan02 notes readiness ok (Task 26 replaces it)"
test -f src/utils/afterSetupIntent.ts && echo "plan05 merged: carry its after-setup effect (Task 7)" || echo "plan05 not merged: nothing to carry"
test -f src/components/ui/notices.ts && echo "plan04 notices merged" || echo "plan04 not merged: keep useToast"
```

All eleven "ok" lines must print. If one is missing, stop and report which plan is not merged, or that CR-06-5 has not been applied. Do not stub its interface, and do not add `providerId` to Plan 03's module from this plan.

If `src/components/ui/notices.ts` exists, use `notify({ kind: "receipt", title })` wherever this plan writes `toast({ title, ... })`, `notify({ kind: "alert", ... })` for destructive toasts, and `notify({ kind: "notice", ... })` otherwise.

If Plan 02 named its hook differently, use its name and record the difference in the PR body; the CR-06-1 hook semantics are what matter.

## Interpretations this plan commits to

These resolve conflicts between picks, or gaps between a mock and the code. Each is flagged for the owner in the hand-back.

1. **Capture lives in the top bar.** The R3 A card puts it there. R1 B's sidebar "Capture" row refers to the same R3 control, so there is one Capture, not two.
2. **"C's live states" means four states, not three surfaces.** The states are **Ready**, **Listening m:ss**, **Cleaning up…** and **Mic offline**, rendered in three places:
   - the Capture primary segment while live, as `variant="live"` with `LevelBars`, where a click stops the capture;
   - the sidebar footer mic card, which is the R1 B "mic chip";
   - the R3 C sidebar edge rail.
3. **Two type ramps.**
   - The UI ramp is R11 B: Display 32 / Title 22 / Heading 17 / Body 15 / UI 13 / Caption 12 / Micro 11.
   - The note document ramp is the R6 B spec: title 32/1.15, h1 24/1.25, h2 19/1.3, h3 16/1.4, body 16/1.65 at 68ch.
   - Chat prose follows R8 B at 15/1.6.
   - Where a mock differs from its spec list (R6 mock: 30px title, 15px body), the spec list wins.
4. **Home becomes cross-type.** The R4 B chips (All, Dictations, Meetings, Notes, Failed) need notes and meetings in the list. Sessions fold completed dictations only. Failed and discarded rows never fold.
5. **The slash menu's AI group lists the user's real actions** (`useActions()`). It does not show the mock's Summarise, Clean up, Extract actions and Translate, because none of those exist as built-ins (`src/helpers/builtinActions.js` defines Generate Notes, Detailed Notes and Follow-up email).
6. **The bubble toolbar ships B, I, Link and Ask AI, without Highlight.** `@tiptap/extension-highlight` is not installed. With `tiptap-markdown` at `html: false`, a highlight mark would be silently dropped on save, which is a content-loss bug.
7. **Citations come from the model, numbered by the renderer.**
   - The model cites with `[note:ID]` markers, using ids it saw in tool results or RAG context.
   - The renderer numbers sources in order of first appearance and drops ids it never received.
   - "Jump to 12:40" is omitted, because no tool returns transcript timestamps.
8. **The context rail is honest.** Items the user pins with `@` or "Add context" are injected into the prompt and can be removed. Notes found automatically are listed read-only. No toggle exists that would not change what the model sees.
9. **Omitted for now:**
   - `⌘↵ Open in side`, because there is no side pane.
   - Pinned notes, because there is no data model.
   - Destination-app pills on history rows, because there is no data.
   - The hover card's "3 decisions" count, because there is no data.
10. **"New note" from Capture creates a plain note.** "Record meeting" creates a note and starts recording, which is today's `createNote` behaviour.
11. **The collapsed sidebar is a 56px icon rail**, replacing hide-plus-hover-peek. Side-panel layout (meeting mode, or a narrow window with an open note) still hides it completely.
12. **The sidebar's second group is "Voice".** It holds Dictionary, Insights and Calendars. Calendars is the existing Integrations view, renamed because it only holds calendars. Upload leaves the sidebar and lives in Capture, `⌘⇧U` and the palette.
13. **History rows show locality only when `transcriptions.provider` is recorded.** Main writes it only when audio is retained (`database.js:591-597`), so most rows show no ring rather than a guess.
14. **A default (ink CTA) Button is text only.** Plan 01 gave the default variant a leading orange brand dot, so a leading icon on a default Button puts two markers side by side (Plan 01 review). In workspace files:
    - a Button with a leading icon is `variant="live"` when it starts or stops voice (record, mic, stop);
    - any other Button with a leading icon is `variant="secondary"` or `variant="outline"`.

    The two current workspace cases:
    - "Generate Summary" (`NoteEditor.tsx:1009`) becomes `secondary`.
    - "Start recording" in the transcript empty state (`NoteEditor.tsx:~945`) becomes `live`.

    `OnboardingFlow.tsx:440` is left to Plan 05, and `PromptStudio.tsx:400` and `:541` are Settings, so they are left to Plan 03. The Task 25 guard enforces the rule in workspace files.
15. **"Today" in Coming up is neutral, not orange glass** (Plan 01 review, D1). A calendar day is not live voice. Task 11 replaces the `GRADIENT_CIRCLE` strip at `UpcomingMeetings.tsx:~250` with a stronger neutral surface and the word "Today".
16. **Plan 06 does not change `Button` styling.** The ramp reaches buttons through the call sites (`text-ui` and similar), and `button.tsx` is untouched. Plan 01's review noted that `hover:brightness-110` barely shows on the ink CTA and clips on the pale Plum Night CTA. That fix belongs in `button.tsx` (Plan 01's file), so it goes back to the owner as a follow-up and is not done here.
17. **R2 A's "actions at 40% opacity" is overridden** (review I14). It composites to about 1.95:1, under the 3:1 floor, so row actions rest at full `text-muted-foreground`. They stay visible at rest, which was the intent.
18. **Ask AI goes to the note's embedded chat**, opened as the floating panel so the seeded composer is on screen (review I05). The bottom ask bar is not seeded.
19. **The mic card names the routes of the capture in progress** (review I13): the meeting route while a meeting records, the dictation route while dictating, and the assistant or translation route as the text route when that input kind is live.
20. **The Notes Actions hint sits at the top of the Notes column.** Task 9 removes the second column that held Plan 02's Actions button and hint. The hint moves to the top of the editor column (Task 9), and Task 26 drives it from the route. The Actions manager stays reachable from the `ActionPicker` and the slash menu.

## Review Focus

These are the input classes most likely to bite a real user that no recommendation's happy path exercises. Each one has a test in the task that owns the code.

1. **A one-click path that sends content to a remote model without the user seeing where it goes.** "Ask the assistant: “…”" in the palette, "Ask AI" in the bubble toolbar, and citation "Open" must seed a draft, never send it. Pinned in:
   - Task 13 (`paletteSections.test.js`, "ask row seeds a draft");
   - Task 4 (`chatComposerSeed.test.js`: a queued draft never sends after a palette seed);
   - Task 16 (`bubbleToolbar.test.js`, "Ask AI opens a visible composer and seeds it").
2. **Workspace hrefs (`note:17`, `meeting:42`, `dictation:311`, `folder:2`) in chat markdown and note content.** They must navigate inside Loqui. They must never reach `target="_blank"` and the OS URL handler. Unknown and `javascript:` hrefs stay inert. Pinned in Task 20 (`markdownRendererWorkspaceLinks.test.js`) and Task 16 (`linkHref.test.js`).
3. **A deep link to a transcript the current Home view hides.** The row may be filtered out by a chip, excluded by the in-view search, or folded inside a session. Opening it from the palette must clear the filter, expand the session, scroll to the row and ring it. Pinned in Task 3 (`homeViewStore.test.js`) and Task 10 (`homeFeed.test.js`, "a transcript folded inside a session can be located for a deep link").
4. **Stale persisted state at launch.** The cases are a saved view id that no longer exists (`upload` still exists; a future rename must not crash), a saved note id that was deleted, and corrupt `localStorage`. Each falls back to Home or the notes overview. Pinned in Task 3 (`workspaceView.test.js`).
5. **Async work that outlives the user's intent.** Stop or unmount while pinned context loads, a newer send, a route changed in Settings mid-request, a refused send landing after a seed, a launch restore racing the tree. Each has a deferred-promise test on the real hook or store (Tasks 3, 4, 21, 22).
6. **Pointer and keyboard paths into editor chrome.** Bubble-toolbar clicks, the URL field and the mention hover card must keep focus where the user put it, across the gap and with Tab and Escape (Tasks 16, 18).
7. **A route main has not confirmed yet (`unknown`).** Right after launch every route can be `unknown`. The chat chip and the mic card must show "Checking…", the slash menu must disable AI items without a "Set up" item, and the Notes hint must show nothing. Pinned in Tasks 8, 15, 21 and 26.
8. **Shortcuts while a dialog or a text composition is active.** `⌘1`–`⌘3`, `⌘\`, `⌘N` and `⌘⇧N` must not switch views behind an open Settings dialog or palette, or while an IME composition is in progress. Pinned in Task 4 (`workspaceShortcuts.test.js`).

---

## File map

Regenerated from every task's **Files** block (review M04).

**Created (source):**

| File | Responsibility |
|---|---|
| `src/lib/workspaceView.ts` | Persisted view and last note: read, validate, write (Task 3) |
| `src/stores/homeViewStore.ts` | Home filter, in-view query, transcript focus requests with a ring nonce (Task 3) |
| `src/components/workspaceNavigation.tsx` | `WorkspaceNavigationProvider` and `useWorkspaceNavigation()` (Task 3) |
| `src/components/chat/chatRequest.ts` | `ChatViewRequest` and `ComposerSeed` types (Task 3) |
| `src/lib/workspaceShortcuts.ts` | Key event to workspace action; hint labels (Task 4) |
| `src/lib/captureStatus.ts` | Dictation, meeting and mic facts to Ready/Listening/Cleaning up/Offline; `captureRouteIds` (Task 6) |
| `src/hooks/useCaptureStatus.ts` | Subscribes IPC, the meeting store and mic permission (Task 6) |
| `src/components/CaptureMenu.tsx` | Capture split button with live states (Task 7) |
| `src/components/CaptureControl.tsx` | Capture container: last action, live clock, routing to navigation (Task 7) |
| `src/components/MicStatusCard.tsx` | Sidebar footer mic card, expanded and rail forms, with the capture's routes (Task 8) |
| `src/lib/sidebarMode.ts` | expanded, rail or hidden, from preference, width and layout (Task 9) |
| `src/lib/workspaceBreadcrumb.ts` | Top-bar breadcrumb segments (Task 9) |
| `src/stores/noteDeleteGuard.ts` | Lets the open editor cancel pending saves before a tree delete (Task 9) |
| `src/hooks/useNoteTreeActions.ts` | Delete, move and create-folder-and-move for the sidebar tree (Task 9) |
| `src/hooks/useRecentNotes.ts` | Recent notes for the sidebar, Home and mentions (Task 9) |
| `src/lib/homeFeed.ts` | Cross-type feed: filter, search, day groups, sessions, counts (Task 10) |
| `src/lib/upcomingEvents.ts` | Next event and "in 12 min" (Task 11) |
| `src/components/home/ReadyStrip.tsx` | 44px status strip (Task 11) |
| `src/components/home/HistoryToolbar.tsx` | Filter field and chips (Task 12) |
| `src/components/home/HistoryMenu.tsx` | History `…` menu: Show discarded, Clear all (Task 12) |
| `src/components/home/FeedRows.tsx` | Session, note and meeting rows (Task 12) |
| `src/lib/fuzzyMatch.ts` | Subsequence fuzzy score with match ranges, and highlight segments (Task 13) |
| `src/components/commandSearch/commands.ts` | Workspace command catalogue (Task 13) |
| `src/components/commandSearch/paletteSections.ts` | Ordered, capped palette sections (Task 13) |
| `src/components/ui/editor/suggestionPopup.ts` | Shared fixed-position popup for Tiptap suggestions, typechecked for both callers (Task 15) |
| `src/components/ui/editor/slashItems.ts` | Slash catalogue, filtering, grouping and `noteAiReadiness` (Task 15) |
| `src/components/ui/editor/SlashCommand.ts` | Tiptap extension on `@tiptap/suggestion` with char `/` (Task 15) |
| `src/components/ui/editor/SlashMenu.tsx` | Slash popup UI (Task 15) |
| `src/lib/linkHref.ts` | Allow-list for user-entered links (Task 16) |
| `src/components/ui/editor/BubbleToolbar.tsx` | Selection toolbar, with `askAiTransition` (Task 16) |
| `src/components/ui/editor/editorChrome.ts` | `isEditorChromeTarget`: which clicks may refocus the document (Task 16) |
| `src/lib/mentionSearch.ts` | Grouped entity search for `@` (Task 18) |
| `src/components/ui/MentionHoverCard.tsx` | 240px mention preview (Task 18) |
| `src/components/ui/useHoverCard.ts` | Hover-card open/close reducer, shared boundary, Escape-to-trigger (Task 18) |
| `src/components/chat/citations.ts` | Sources from tool metadata and note refs; marker numbering (Task 19) |
| `src/components/chat/ragContext.ts` | RAG prompt block plus the notes it used, with escaped titles (Task 19) |
| `src/components/chat/remarkCitations.ts` | remark plugin turning `[note:ID]` into citation nodes (Task 20) |
| `src/components/chat/SourcesRow.tsx` | Source chips with hover quote (Task 20) |
| `src/components/chat/ChatModelChip.tsx` | Resolved chat route through Plan 03's `RouteDestinationChip`/`RouteStateChip`, and the per-answer `RouteTag` (Task 21) |
| `src/components/chat/messageRoute.ts` | `toMessageRoute`, shared by the chip and the stream's route stamp (Task 21) |
| `src/components/chat/contextRail.ts` | Rail model: pinned, found, activity (Task 22) |
| `src/components/chat/ChatContextRail.tsx` | Collapsible right rail (Task 22) |
| `src/hooks/useMentionSources.ts` | One mention-source builder for the editor and the chat composer (Task 22) |
| `src/components/insights/MetricCard.tsx` | Stat tile, optionally a button to filtered History (Task 23) |
| `src/components/notes/UploadDropZone.tsx` | Drop zone with a disabled state and inline fix (Task 24) |
| `src/components/ui/DataRetentionNotice.tsx` | Shared retention banner with tokens (Task 25) |
| `src/components/notes/notesActionsHint.ts` | Route state → Notes Actions hint copy; `off` disables Actions (Task 26) |
| `src/components/notes/NotesActionsHint.tsx` | The Notes Actions hint row (Task 26) |

**Created (test helpers):** `test/helpers/harness/mountComposer.js` (mounted `ChatInput` on Plan 02's harness; Tasks 4 and 22) and `test/helpers/workspaceTokenGuard.js` (the CR-06-6 guard; Task 25).

**Deleted:** `src/components/notes/NewNoteMenu.tsx` and `test/components/newNoteMenu.test.js` (replaced by `CaptureMenu`, Task 7); Plan 02's temporary `src/hooks/useNoteActionsReady.ts` and `src/utils/noteActionsReadiness.ts` (replaced by the route, Task 26).

**Modified, by area:**
- **Build and docs:** `scripts/merge-locale-keys.js` (Plan 03's file, `--strict` added, Task 1), `package.json` and `package-lock.json` (Task 16), `DESIGN.md` (Tasks 2, 14, 25), `src/index.css` (Tasks 2, 8, 12, 14, 16, 20), `src/components/lib/utils.ts` (`cn` learns the ramp, Task 2), `docs/PRIVACY.md` (chat stores source titles and excerpts locally, Task 19), `src/locales/*/translation.json`.
- **Main and preload (Task 5):** `src/helpers/windowManager.js`, `src/helpers/ipcHandlers.js`, `preload.js`, `src/types/electron.ts`, and one condition in `src/hooks/useAudioRecording.js` (Plan 04's file).
- **Stores and hooks:** `src/stores/noteStore.ts` (`openNoteById`, `restoreLaunchNote`, Task 3), `src/stores/transcriptionStore.ts` (`revealTranscription`, Task 12), `src/hooks/useCollapsibleSidebar.ts` (Task 9), `src/hooks/useCreateNote.ts` (Task 7).
- **Shell:** `src/components/ControlPanel.tsx` (Tasks 3, 4, 7, 9, 11), `ControlPanelSidebar.tsx`, `ControlPanelTopBar.tsx`, `controlPanelNav.ts`, and `icons` if it lacks `CalendarDays` (Task 9).
- **Home, palette, Insights, Upload:** `HistoryView.tsx` (Tasks 11, 12, 25), `UpcomingMeetings.tsx` (Task 11), `ui/TranscriptionItem.tsx` (Task 12), `CommandSearch.tsx` (Task 13), `InsightsView.tsx` (Tasks 23, 25), `notes/UploadAudioView.tsx` (Task 24).
- **Notes and editor:** `notes/PersonalNotesView.tsx` (Tasks 9, 15, 26), `notes/shared.ts` (Task 26), `notes/SpacesTree.tsx` (Task 9), `notes/NoteEditor.tsx` (Tasks 14, 15, 16), `notes/EmbeddedChat.tsx` (Task 16), `ui/RichTextEditor.tsx` (Tasks 15, 16, 18, 22), `ui/RichTextEditorMention.tsx` (Tasks 15, 17, 18), `ui/MentionSuggestions.tsx`, `ui/MentionChip.tsx` (Task 18), `utils/mentionMarkdown.ts` (Task 17).
- **Chat:** `ui/MarkdownRenderer.tsx` (Task 20), `chat/ChatView.tsx` (Tasks 4, 19, 20, 21, 22), `chat/ChatMessages.tsx` (Task 20), `chat/ChatMessage.tsx` (Tasks 20, 21, 22), `chat/ChatInput.tsx` (Tasks 4, 22), `chat/types.ts`, `chat/useChatPersistence.ts` (Task 19), `chat/useChatStreaming.ts` (Tasks 19, 21, 22), `services/ReasoningService.ts`, `config/prompts/index.ts`, `config/prompts.ts` (Task 19).
- **Token adoption only (Task 25):** whatever else the guard reports, including `IntegrationsView.tsx`, `DictionaryView.tsx` and `SnippetsView.tsx`.
- **Existing tests extended or trimmed:** `test/helpers/useChatStreamingCancellation.test.js` (Tasks 21, 22), Plan 02's `test/components/notesActionsGate.test.js` (Task 26), `test/utils/mentionMarkdown.test.js` (Task 17), `test/helpers/windowManagerAssistantPanel.test.js`, `test/helpers/agentDictationPillIpc.test.js`, `test/helpers/preloadAuthBridge.test.js` (Task 5).

---

### Task 1: Strict mode for Plan 03's locale merge helper

Plan 03 Task 2 already ships `scripts/merge-locale-keys.js` and `test/scripts/mergeLocaleKeys.test.js` (review I16). This task upgrades that helper and leaves its contract intact:
- the CLI stays `node scripts/merge-locale-keys.js <fragment.json> [localesRoot]`;
- usage errors still exit 2;
- a missing locale still exits 1 with `Missing locales in fragment: <list>`;
- a plain run still overwrites existing values.

All new checks run only behind `--strict`, which every Plan 06 "Add strings" step uses. Plan 03's test file is not edited; a separate test file covers strict mode.

**Files:**
- Modify: `scripts/merge-locale-keys.js` (Plan 03's file). It is restructured into exported functions plus a `require.main` CLI; the default behaviour is byte-for-byte the same.
- Test: `test/scripts/mergeLocaleKeysStrict.test.js` (new). Plan 03's `test/scripts/mergeLocaleKeys.test.js` must still pass unchanged.

**Interfaces:**
- CLI: `node scripts/merge-locale-keys.js [--strict] <fragment.json> [localesRoot]`. The flag may appear anywhere.
- With `--strict`, the whole fragment is rejected and nothing is written when:
  - a locale's keys differ from `en` (plural suffixes `_zero|_one|_two|_few|_many|_other` are compared by base key);
  - `{{placeholders}}` differ from `en` on non-plural keys;
  - a key already exists with a different value.

  Re-running the same fragment is a no-op.
- Exports, for tests: `{ flatten, validateFragment, mergeFragment }`.
  - `mergeFragment(fragment, { localesRoot, strict })` returns the locale list.
  - It throws `Error("Missing locales in fragment: …")` or `Error("Locale fragment rejected: …")`.
- **Every later "Add strings" step** writes `/tmp/plan06-task<N>-i18n.json`:
  - the English block under `"en"`;
  - translated values under `"ar" "de" "es" "fr" "it" "ja" "pt" "ru" "zh-CN" "zh-TW"`, keeping `{{placeholders}}` and the plural keys `en` uses, plus Arabic's `_zero _two _few _many` wherever `en` has `_one`/`_other`.

  Then it runs `node scripts/merge-locale-keys.js --strict /tmp/plan06-task<N>-i18n.json`, followed by `npx prettier --write "src/locales/**/translation.json"`.

- [ ] **Step 1: Write the failing test**

Create `test/scripts/mergeLocaleKeysStrict.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const script = path.join(__dirname, "../../scripts/merge-locale-keys.js");
const helper = () => require(script);

function makeRoot(t, locales = ["en", "de", "ar"]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan06-locales-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const lang of locales) {
    fs.mkdirSync(path.join(root, lang));
    fs.writeFileSync(path.join(root, lang, "translation.json"), JSON.stringify({ sidebar: { home: `home-${lang}` } }, null, 2) + "\n");
  }
  return root;
}
const read = (root, lang) => JSON.parse(fs.readFileSync(path.join(root, lang, "translation.json"), "utf8"));
const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
function writeFragment(root, fragment) {
  const file = path.join(root, "frag.json");
  fs.writeFileSync(file, JSON.stringify(fragment));
  return file;
}

test("the plain CLI keeps Plan 03's contract: optional root, overwrite, missing-locale message", (t) => {
  const root = makeRoot(t, ["en", "de"]);
  const bad = run([writeFragment(root, { en: { a: "A" } }), root]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Missing locales in fragment: de/);
  const ok = run([writeFragment(root, { en: { sidebar: { home: "Home" } }, de: { sidebar: { home: "Start" } } }), root]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(read(root, "de").sidebar.home, "Start", "plain mode overwrites, as before");
  assert.equal(run([]).status, 2);
});

test("--strict refuses a changed existing value and writes nothing", (t) => {
  const root = makeRoot(t);
  const frag = writeFragment(root, { en: { sidebar: { home: "Today" } }, de: { sidebar: { home: "Heute" } }, ar: { sidebar: { home: "اليوم" } } });
  const result = run(["--strict", frag, root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /already exist/);
  assert.equal(read(root, "en").sidebar.home, "home-en");
});

test("--strict works from any argument position and is idempotent", (t) => {
  const root = makeRoot(t);
  const frag = writeFragment(root, { en: { a: "A" }, de: { a: "Ä" }, ar: { a: "أ" } });
  assert.equal(run([frag, "--strict", root]).status, 0);
  assert.equal(run([frag, root, "--strict"]).status, 0);
  assert.equal(read(root, "de").a, "Ä");
});

test("--strict checks key parity and placeholders against English", () => {
  const { validateFragment } = helper();
  assert.deepEqual(validateFragment({ en: { a: "In {{minutes}} min", b: "B" }, de: { a: "In {{min}} Min." } }, ["de", "en"]), [
    "de: missing b",
    "de: placeholders differ at a",
  ]);
});

test("Arabic may carry extra plural forms for the same base key", () => {
  const { validateFragment } = helper();
  const errors = validateFragment(
    {
      en: { n_one: "{{count}} capture", n_other: "{{count}} captures" },
      ar: { n_zero: "لا شيء", n_one: "{{count}}", n_two: "{{count}}", n_few: "{{count}}", n_many: "{{count}}", n_other: "{{count}}" },
    },
    ["ar", "en"]
  );
  assert.deepEqual(errors, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/scripts/mergeLocaleKeysStrict.test.js test/scripts/mergeLocaleKeys.test.js`
Expected:
- Plan 03's suite PASSES.
- The strict suite FAILS: `--strict` is treated as the fragment path (ENOENT), and `validateFragment` is not a function.

- [ ] **Step 3: Implement**

Replace the body of `scripts/merge-locale-keys.js` with:

```js
#!/usr/bin/env node
// Deep-merges a per-locale fragment into every src/locales/<lang>/translation.json.
// Usage: node scripts/merge-locale-keys.js [--strict] <fragment.json> [localesRoot]
// The fragment is { "en": {...}, "de": {...}, ... } and must cover every locale,
// so a new key can never land in English only (Plan 03).
// --strict (Plan 06) also requires every locale to carry the same keys as "en"
// (plural suffixes compared by base key) and the same {{placeholders}}, and
// refuses to change an existing value. Strict runs are all-or-nothing.
const fs = require("node:fs");
const path = require("node:path");

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const baseKey = (key) => key.replace(PLURAL_SUFFIX, "");
const placeholders = (value) =>
  [...String(value).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort().join(",");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (isObject(value)) flatten(value, full, out);
    else out[full] = value;
  }
  return out;
}

function listLocales(root) {
  return fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, "translation.json")));
}

function validateFragment(fragment, locales) {
  const errors = [];
  if (!fragment.en) return ["missing locale \"en\""];
  const en = flatten(fragment.en);
  const enBases = new Set(Object.keys(en).map(baseKey));
  for (const lang of [...locales].sort()) {
    if (lang === "en" || !fragment[lang]) continue;
    const flat = flatten(fragment[lang]);
    const bases = new Set(Object.keys(flat).map(baseKey));
    for (const key of enBases) if (!bases.has(key)) errors.push(`${lang}: missing ${key}`);
    for (const key of bases) if (!enBases.has(key)) errors.push(`${lang}: extra ${key}`);
    for (const [key, value] of Object.entries(flat)) {
      if (PLURAL_SUFFIX.test(key) || !(key in en)) continue;
      if (placeholders(value) !== placeholders(en[key])) errors.push(`${lang}: placeholders differ at ${key}`);
    }
  }
  return errors;
}

function mergeLoose(target, source) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = isObject(value) ? mergeLoose(isObject(target[key]) ? target[key] : {}, value) : value;
  }
  return target;
}

function mergeStrict(target, source, trail, conflicts) {
  for (const [key, value] of Object.entries(source)) {
    const at = trail ? `${trail}.${key}` : key;
    if (isObject(value)) {
      if (target[key] === undefined) target[key] = {};
      if (!isObject(target[key])) {
        conflicts.push(at);
        continue;
      }
      mergeStrict(target[key], value, at, conflicts);
    } else if (target[key] === undefined) {
      target[key] = value;
    } else if (target[key] !== value) {
      conflicts.push(at);
    }
  }
}

function mergeFragment(fragment, { localesRoot, strict = false }) {
  const langs = listLocales(localesRoot);
  const missing = langs.filter((lang) => !fragment[lang]);
  if (missing.length) throw new Error(`Missing locales in fragment: ${missing.join(", ")}`);
  if (strict) {
    const errors = validateFragment(fragment, langs);
    if (errors.length) throw new Error(`Locale fragment rejected:\n${errors.join("\n")}`);
  }
  const pending = [];
  for (const lang of langs) {
    const file = path.join(localesRoot, lang, "translation.json");
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    if (strict) {
      const conflicts = [];
      mergeStrict(json, fragment[lang], "", conflicts);
      if (conflicts.length) throw new Error(`${lang}: keys already exist with other values: ${conflicts.join(", ")}`);
    } else {
      mergeLoose(json, fragment[lang]);
    }
    pending.push([file, json]);
  }
  for (const [file, json] of pending) fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  return langs;
}

module.exports = { flatten, validateFragment, mergeFragment };

if (require.main === module) {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const [fragmentPath, rootArg] = args.filter((a) => a !== "--strict");
  if (!fragmentPath) {
    console.error("Usage: node scripts/merge-locale-keys.js [--strict] <fragment.json> [localesRoot]");
    process.exit(2);
  }
  const localesRoot = rootArg ?? path.join(__dirname, "..", "src", "locales");
  try {
    const langs = mergeFragment(JSON.parse(fs.readFileSync(fragmentPath, "utf8")), { localesRoot, strict });
    console.log(`Merged ${path.basename(fragmentPath)} into ${langs.length} locales${strict ? " (strict)" : ""}.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
```

Plain mode differs from Plan 03's code in one way only. Plan 03 wrote each locale as it merged it; now every locale is merged in memory first and then written together. A plain run never fails between the missing-locale check and the writes, so its observable behaviour is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/scripts/mergeLocaleKeysStrict.test.js test/scripts/mergeLocaleKeys.test.js`
Expected: PASS. Plan 03's suite is unedited.

- [ ] **Step 5: Commit**

```bash
git add scripts/merge-locale-keys.js test/scripts/mergeLocaleKeysStrict.test.js
git commit -m "chore(i18n): add an all-or-nothing --strict mode to the locale merge helper"
```

---

### Task 2: UI type ramp and AI/Agent colour aliases

This covers WS-R11 B (the type ramp, and the `--color-ai`/`--color-agent` aliases the card requires) and CR-06-4.

**Files:**
- Modify: `src/index.css`:
  - the `@theme` block (lines 7–52 before Plan 01; after Plan 01 it also holds the role tokens);
  - the `.dark` block that Plan 01 Task 4 rewrote to Plum Night.
- Modify: `DESIGN.md`: the `## Typography` section (around lines 140–156) and `## Colors`.
- Modify: `src/components/lib/utils.ts`. `cn` must know the ramp is a font size.
- Test: `test/components/workspaceTypeRamp.test.js`, `test/components/cnTypeRamp.test.js`

**Interfaces:**
- Consumes `resolveTokens` and `readTokens` from `test/helpers/harness/cssTokens.js` (Plan 01) and `contrastRatio` from `src/utils/contrast.ts` (Plan 01).
- Produces Tailwind utilities:
  - type ramp: `text-display`, `text-title`, `text-heading`, `text-body`, `text-ui`, `text-caption`, `text-micro`. Each sets size, line-height, weight and, where defined, tracking.
  - colours: `bg-ai`, `text-ai`, `text-ai-text`, `bg-agent`, `border-agent`, `text-agent-text`.
- Role rules:
  - `--color-ai` and `--color-agent` are fills, rails and glyphs (non-text, ≥ 3:1).
  - `--color-ai-text` and `--color-agent-text` are text (≥ 4.5:1).
  - `--color-agent-brand` (`#8787ff`) stays as is for `dictation-panel.css`.

- [ ] **Step 1: Write the failing test**

Create `test/components/workspaceTypeRamp.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { readTokens, resolveTokens } = require("../helpers/harness/cssTokens");

const repoRoot = path.join(__dirname, "../..");
const css = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
const design = fs.readFileSync(path.join(repoRoot, "DESIGN.md"), "utf8");
const loadContrast = () => import("../../src/utils/contrast.ts");

// [size, line-height, weight, tracking|null], from the WS-R11 B card.
const RAMP = {
  display: ["2rem", "1.15", "650", "-0.02em"],
  title: ["1.375rem", "1.25", "600", "-0.015em"],
  heading: ["1.0625rem", "1.35", "600", null],
  body: ["0.9375rem", "1.55", "400", null],
  ui: ["0.8125rem", "1.4", "500", null],
  caption: ["0.75rem", "1.4", "450", null],
  micro: ["0.6875rem", "1.3", "500", "0.02em"],
};
const SURFACES = ["--color-background", "--color-card", "--color-surface-1", "--color-surface-3"];

test("the UI type ramp is registered with Tailwind", () => {
  const theme = readTokens(css, "@theme");
  for (const [name, [size, lineHeight, weight, tracking]] of Object.entries(RAMP)) {
    assert.equal(theme[`--text-${name}`], size, `${name} size`);
    assert.equal(theme[`--text-${name}--line-height`], lineHeight, `${name} line-height`);
    assert.equal(theme[`--text-${name}--font-weight`], weight, `${name} weight`);
    if (tracking) assert.equal(theme[`--text-${name}--letter-spacing`], tracking, `${name} tracking`);
  }
});

test("no ramp step is smaller than 11px", () => {
  const theme = readTokens(css, "@theme");
  for (const name of Object.keys(RAMP)) {
    const px = parseFloat(theme[`--text-${name}`]) * 16;
    assert.ok(px >= 11, `${name} is ${px}px`);
  }
});

test("AI and Agent text roles meet 4.5:1 in light and Plum Night", async () => {
  const { contrastRatio } = await loadContrast();
  const { light, dark } = resolveTokens(css);
  for (const [theme, map] of [["light", light], ["dark", dark]]) {
    for (const fg of ["--color-ai-text", "--color-agent-text"]) {
      for (const bg of SURFACES) {
        const ratio = contrastRatio(map[fg], map[bg]);
        assert.ok(ratio >= 4.5, `${theme}: ${fg} on ${bg} is ${ratio}:1`);
      }
    }
  }
});

test("AI and Agent fills meet 3:1 as non-text UI in both themes", async () => {
  const { contrastRatio } = await loadContrast();
  const { light, dark } = resolveTokens(css);
  for (const [theme, map] of [["light", light], ["dark", dark]]) {
    for (const fg of ["--color-ai", "--color-agent"]) {
      for (const bg of SURFACES) {
        const ratio = contrastRatio(map[fg], map[bg]);
        assert.ok(ratio >= 3, `${theme}: ${fg} on ${bg} is ${ratio}:1`);
      }
    }
  }
});

test("the agent brand mark keeps its value for the dictation panel", () => {
  assert.equal(readTokens(css, "@theme")["--color-agent-brand"], "#8787ff");
});

test("DESIGN.md documents both ramps and the AI and Agent roles", () => {
  assert.match(design, /\| `text-micro` \| 11px \/ 1\.3 \/ 500/);
  assert.match(design, /### Note document ramp/);
  assert.match(design, /`--color-ai`/);
  assert.match(design, /`--color-agent`/);
});
```

Create `test/components/cnTypeRamp.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const load = () => import("../../src/components/lib/utils.ts");

// tailwind-merge treats an unknown text-* class as a colour, so without the
// extension `text-ui text-muted-foreground` silently loses its size.
test("ramp sizes survive a following text colour", async () => {
  const { cn } = await load();
  assert.equal(cn("text-ui text-muted-foreground"), "text-ui text-muted-foreground");
  assert.equal(cn("text-caption", "text-foreground"), "text-caption text-foreground");
});

test("ramp sizes still replace other sizes, and each other", async () => {
  const { cn } = await load();
  assert.equal(cn("text-sm", "text-ui"), "text-ui");
  assert.equal(cn("text-caption", "text-body"), "text-body");
});

test("role colours named *-text are still colours", async () => {
  const { cn } = await load();
  assert.equal(cn("text-ui text-ai-text"), "text-ui text-ai-text");
  assert.equal(cn("text-agent-text", "text-foreground"), "text-foreground");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/components/workspaceTypeRamp.test.js test/components/cnTypeRamp.test.js`
Expected: FAIL.
- `display size` is `undefined`.
- The contrast tests fail because `--color-ai-text` is undefined.
- `cn("text-ui text-muted-foreground")` returns `"text-muted-foreground"`.

- [ ] **Step 3: Implement**

1. In `src/index.css`, inside `@theme { … }` directly after the `--color-locality-remote` line Plan 01 added, add:

   ```css
     /* Machine and Agent roles (DESIGN.md "Colors"). Fuchsia marks content a
        model wrote (AI chips, slash AI items, Ask AI); violet marks the Agent
        (chat rail, spark, citations). Fills/rails use the base token (>= 3:1),
        small text uses the -text token (>= 4.5:1). */
     --color-ai: #d90078;
     --color-ai-text: #b8006a;
     --color-agent: #7b7bf7;
     --color-agent-text: #4a4ad8;

     /* UI type ramp (DESIGN.md "Typography"). Chrome only: the note document
        ramp lives on .rich-text-editor-content. Nothing below 11px; readable
        text floors at 12px (caption). */
     --text-display: 2rem;
     --text-display--line-height: 1.15;
     --text-display--font-weight: 650;
     --text-display--letter-spacing: -0.02em;
     --text-title: 1.375rem;
     --text-title--line-height: 1.25;
     --text-title--font-weight: 600;
     --text-title--letter-spacing: -0.015em;
     --text-heading: 1.0625rem;
     --text-heading--line-height: 1.35;
     --text-heading--font-weight: 600;
     --text-body: 0.9375rem;
     --text-body--line-height: 1.55;
     --text-body--font-weight: 400;
     --text-ui: 0.8125rem;
     --text-ui--line-height: 1.4;
     --text-ui--font-weight: 500;
     --text-caption: 0.75rem;
     --text-caption--line-height: 1.4;
     --text-caption--font-weight: 450;
     --text-micro: 0.6875rem;
     --text-micro--line-height: 1.3;
     --text-micro--font-weight: 500;
     --text-micro--letter-spacing: 0.02em;
   ```

2. In the `.dark { … }` block that Plan 01 Task 4 wrote (the one with `--color-background: #1c1218;`), add after `--color-locality-remote: #fbbf6a;`:

   ```css
     --color-ai: #ff5fae;
     --color-ai-text: #ff5fae;
     --color-agent: #8787ff;
     --color-agent-text: #a5a5ff;
   ```

3. In `DESIGN.md`, replace the `### Hierarchy` list under `## Typography` (and keep `### Named Rules`) with:

   ```markdown
   ### UI ramp (WS-R11 B)
   Tailwind utilities from `@theme` in `src/index.css`. Chrome, lists, menus and dialogs use these and nothing else.

   | Utility | Size / line / weight / tracking | Use |
   |---|---|---|
   | `text-display` | 32px / 1.15 / 650 / -0.02em | Rare page hero |
   | `text-title` | 22px / 1.25 / 600 / -0.015em | View titles, dialog titles |
   | `text-heading` | 17px / 1.35 / 600 | Section headings |
   | `text-body` | 15px / 1.55 / 400 | Transcripts, chat answers, previews |
   | `text-ui` | 13px / 1.4 / 500 | Labels, nav rows, buttons, menu rows |
   | `text-caption` | 12px / 1.4 / 450 | Metadata, timestamps, helper text |
   | `text-micro` | 11px / 1.3 / 500 / +0.02em | `kbd` and badges only |

   No size below 11px. Readable text floors at 12px. Hierarchy comes from size and weight, never opacity: metadata is full `text-muted-foreground`.

   ### Note document ramp (WS-R6 B)
   Inside the note editor (`.rich-text-editor-content`) and the note title: title 32/1.15/600; h1 24/1.25/650; h2 19/1.3/600; h3 16/1.4/600; body 16/1.65 with a 68ch measure; code 14 mono. Chat answers use 15/1.6 at 68ch.
   ```

4. Replace `src/components/lib/utils.ts` with:

   ```ts
   import { clsx, type ClassValue } from "clsx";
   import { extendTailwindMerge } from "tailwind-merge";

   // The UI type ramp (text-ui, text-caption, …) is a font size. Without this,
   // tailwind-merge files unknown text-* classes as colours and drops the size
   // whenever a text colour follows it.
   const twMerge = extendTailwindMerge({
     extend: {
       classGroups: {
         "font-size": [{ text: ["display", "title", "heading", "body", "ui", "caption", "micro"] }],
       },
     },
   });

   export function cn(...inputs: ClassValue[]) {
     return twMerge(clsx(inputs));
   }
   ```

5. In `DESIGN.md` under `## Colors`, after the subsection Plan 01 added for roles, add:

   ```markdown
   ### AI and Agent
   - `--color-ai` (#d90078 light, #ff5fae Plum Night): machine-authored content. AI chips (12% fill, 1px 30% border), slash-menu AI items, the bubble toolbar's Ask AI. Small text uses `--color-ai-text` (#b8006a light).
   - `--color-agent` (#7b7bf7 light, #8787ff Plum Night): the Agent's presence. The streaming rail, the spark avatar, citation numerals. Small text uses `--color-agent-text` (#4a4ad8 light, #a5a5ff Plum Night).
   - Neither is ever a call to action, and neither is orange: orange means live voice (D1).
   ```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/components/workspaceTypeRamp.test.js test/components/cnTypeRamp.test.js test/components/colorRoles.test.js`
Expected: PASS. Plan 01's `colorRoles` suite still passes.

- [ ] **Step 5: Commit**

```bash
git add src/index.css DESIGN.md src/components/lib/utils.ts test/components/workspaceTypeRamp.test.js test/components/cnTypeRamp.test.js
git commit -m "feat(ui): add the UI type ramp and AI and Agent colour roles"
```

---

### Task 3: Workspace navigation: persisted view, Home view state, navigation context

This covers WS-Q9 and the foundation for WS-Q3, mentions, citations and Insights tiles.

**Files:**
- Create: `src/lib/workspaceView.ts`
- Create: `src/stores/homeViewStore.ts`
- Create: `src/components/workspaceNavigation.tsx`, `src/components/chat/chatRequest.ts`
- Modify: `src/stores/noteStore.ts`. Add the one authoritative open-by-id path and the launch restore (review I04, I06):
  - the `NoteState` interface (`:14-27`) and the initial state (`:46-57`);
  - `findNoteInState` (`:92-98`);
  - `initializeNotesTree`'s auto-select (`:342-344`);
  - `updateNoteInStore` (`:382`), `removeNote` (`:409`) and `setActiveNoteId` (`:513-516`).
- Modify: `src/components/ControlPanel.tsx`:
  - `:102` (the `activeView` state);
  - the CommandSearch props at `:674-694` (note selection goes through `openNote`);
  - the root `return` at `:632`, which gets the provider.
- Test: `test/lib/workspaceView.test.js`, `test/stores/homeViewStore.test.js`, `test/components/workspaceNavigation.test.js`, `test/stores/noteOpenRestore.test.js`

**Interfaces:**
- Produces `src/lib/workspaceView.ts`:

  ```ts
  export const WORKSPACE_VIEW_KEY = "workspace.activeView";
  export const WORKSPACE_NOTE_KEY = "workspace.lastNoteId";
  export const WORKSPACE_VIEWS: readonly ControlPanelView[];
  export interface PersistedWorkspace { view: ControlPanelView; noteId: number | null }
  export type WorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
  export function readPersistedWorkspace(storage: WorkspaceStorage | null | undefined): PersistedWorkspace;
  export function writePersistedWorkspace(storage: WorkspaceStorage | null | undefined, state: PersistedWorkspace): void;
  ```

- Produces `src/stores/homeViewStore.ts`:

  ```ts
  export type HomeFilter = "all" | "dictations" | "meetings" | "notes" | "failed";
  export const HOME_FILTERS: readonly HomeFilter[];
  export const useHomeViewStore: UseBoundStore<StoreApi<{ filter: HomeFilter; query: string; focusTranscriptId: number | null; focusNonce: number }>>;
  export function setHomeFilter(filter: HomeFilter): void;
  export function setHomeQuery(query: string): void;
  export function showHomeQuery(query: string): void;            // filter "all" + query, for "See all in History"
  export function requestTranscriptFocus(transcriptId: number): void; // clears filter and query, bumps focusNonce
  export function clearTranscriptFocus(): void;
  ```

- Produces, in `src/stores/noteStore.ts`, the only way a deep link opens a note. Palette rows, mention chips, citations, Sources chips, Recent rows and the launch restore all go through it:

  ```ts
  export type OpenNoteResult = "opened" | "missing" | "superseded";
  /** Fetch (when not cached), hold, reveal and select. A note outside every
   *  loaded container page is kept in `openedNotes`, which the editor reads
   *  through `findNoteInState`, so an older note always opens. */
  export function openNoteById(id: number): Promise<OpenNoteResult>;
  /** Launch restore. While pending, `initializeNotesTree` does not auto-pick a
   *  note. A missing note keeps the Notes overview for this launch. Any
   *  deliberate selection made meanwhile (pending native navigation, a click)
   *  wins, and the restore resolves "superseded". */
  export function restoreLaunchNote(id: number): Promise<OpenNoteResult>;
  ```

  `setActiveNoteId` remains the deliberate-selection API. It now also marks a navigation, so a pending restore yields to it. The tree's own first-note pick no longer goes through it.
- Produces `src/components/workspaceNavigation.tsx`:

  ```ts
  export interface WorkspaceNavigation {
    openView(view: ControlPanelView): void;
    openNote(noteId: number): void;
    openFolder(spaceId: number, folderId: number | null): void;
    openTranscript(transcriptId: number): void;
    openConversation(conversationId: number): void;
    startChat(options?: { draft?: string }): void;   // never sends; seeds the composer
    focusAssistant(): void;
    newNote(): void;            // a plain note (interpretation 10)
    recordMeeting(): void;      // a note that starts recording
    openUpload(): void;
    openSettings(section?: string): void;
    openSearch(): void;
  }
  export const INERT_WORKSPACE_NAVIGATION: WorkspaceNavigation;
  export function WorkspaceNavigationProvider(props: { value: WorkspaceNavigation; children: React.ReactNode }): JSX.Element;
  export function useWorkspaceNavigation(): WorkspaceNavigation;
  ```

  The chat methods (`openConversation`, `startChat`, `focusAssistant`) set a `chatRequest` state in ControlPanel that Task 4 delivers to `ChatView`. `newNote`/`recordMeeting` use the `record` option Task 7 adds to `useCreateNote`. Until Task 7, both call `handleNewNote`.

- [ ] **Step 1: Write the failing tests**

Create `test/lib/workspaceView.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/workspaceView.ts");

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

test("first launch opens Home with no note", async () => {
  const { readPersistedWorkspace } = await load();
  assert.deepEqual(readPersistedWorkspace(memoryStorage()), { view: "home", noteId: null });
  assert.deepEqual(readPersistedWorkspace(null), { view: "home", noteId: null });
});

test("a saved view and note are restored", async () => {
  const { readPersistedWorkspace, WORKSPACE_VIEW_KEY, WORKSPACE_NOTE_KEY } = await load();
  const storage = memoryStorage({ [WORKSPACE_VIEW_KEY]: "personal-notes", [WORKSPACE_NOTE_KEY]: "42" });
  assert.deepEqual(readPersistedWorkspace(storage), { view: "personal-notes", noteId: 42 });
});

test("an unknown view id or a junk note id falls back safely", async () => {
  const { readPersistedWorkspace, WORKSPACE_VIEW_KEY, WORKSPACE_NOTE_KEY } = await load();
  for (const [view, note] of [["timeline", "42"], ["chat", "-3"], ["chat", "1.5"], ["chat", "abc"], ["chat", ""]]) {
    const result = readPersistedWorkspace(memoryStorage({ [WORKSPACE_VIEW_KEY]: view, [WORKSPACE_NOTE_KEY]: note }));
    assert.equal(result.view, view === "timeline" ? "home" : "chat", view);
    assert.equal(result.noteId, view === "timeline" ? 42 : null, `${view}/${note}`);
  }
});

test("storage that throws is treated as empty", async () => {
  const { readPersistedWorkspace, writePersistedWorkspace } = await load();
  const hostile = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => {} };
  assert.deepEqual(readPersistedWorkspace(hostile), { view: "home", noteId: null });
  assert.doesNotThrow(() => writePersistedWorkspace(hostile, { view: "chat", noteId: 1 }));
});

test("writing a null note removes the key", async () => {
  const { writePersistedWorkspace, WORKSPACE_NOTE_KEY } = await load();
  const storage = memoryStorage({ [WORKSPACE_NOTE_KEY]: "7" });
  writePersistedWorkspace(storage, { view: "home", noteId: null });
  assert.deepEqual(storage.dump(), { "workspace.activeView": "home" });
});

```

Create `test/stores/noteOpenRestore.test.js`. These tests drive the real store with a stubbed `electronAPI`, using the same harness as `test/stores/personalNotesPersistence.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const note = (id, over = {}) => ({
  id, title: `Note ${id}`, content: "", note_type: "personal", space_id: 1, folder_id: 2, deleted_at: null, ...over,
});
// The first page of the default folder: ids 1–50. Note 999 is older and outside it.
const FIRST_PAGE = Array.from({ length: 50 }, (_, i) => note(i + 1));
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

async function loadStore(t, api = {}) {
  const calls = { getNotes: 0, getNote: 0 };
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        getSpaces: async () => [{ id: 1, kind: "private", name: "Personal" }],
        getFolders: async () => [{ id: 2, space_id: 1, name: "Work", is_default: 1 }],
        getFolderNoteCounts: async () => [],
        getNotes: async (_type, _limit, folderId) => {
          calls.getNotes += 1;
          return folderId === 2 ? FIRST_PAGE : [];
        },
        getNote: async () => null,
        ...api,
      },
    },
  });
  const vite = await createRendererServer(t);
  const store = await vite.ssrLoadModule("/stores/noteStore.ts");
  return { store, calls };
}

test("a deep link opens a note older than the first page, and the editor can read it", async (t) => {
  const { store } = await loadStore(t, { getNote: async (id) => (id === 999 ? note(999) : null) });
  await store.initializeNotesTree();
  assert.equal(await store.openNoteById(999), "opened");
  assert.equal(store.getActiveNoteIdValue(), 999);
  assert.equal(store.getNoteFromStore(999)?.title, "Note 999");
  assert.equal(store.getActiveFolderIdValue(), 2);
});

test("a note in an already-cached container opens without refetching", async (t) => {
  const { store, calls } = await loadStore(t);
  await store.initializeNotesTree();
  const before = { ...calls };
  assert.equal(await store.openNoteById(5), "opened");
  assert.equal(store.getActiveNoteIdValue(), 5);
  assert.deepEqual(calls, before);
});

test("a folderless note opens at its space root", async (t) => {
  const { store } = await loadStore(t, { getNote: async () => note(7, { folder_id: null }) });
  assert.equal(await store.openNoteById(7), "opened");
  assert.equal(store.getActiveFolderIdValue(), null);
  assert.equal(store.getNoteFromStore(7)?.id, 7);
});

test("a missing note changes nothing", async (t) => {
  const { store } = await loadStore(t);
  await store.initializeNotesTree();
  const before = store.getActiveNoteIdValue();
  assert.equal(await store.openNoteById(404), "missing");
  assert.equal(store.getActiveNoteIdValue(), before);
});

test("an IPC delete of an opened older note clears it from the editor", async (t) => {
  let deleted;
  const { store } = await loadStore(t, {
    getNote: async () => note(999),
    onNoteDeleted: (cb) => {
      deleted = cb;
      return () => {};
    },
  });
  await store.initializeNotesTree();
  await store.openNoteById(999);
  deleted({ id: 999 });
  assert.equal(store.getNoteFromStore(999), null);
  assert.equal(store.getActiveNoteIdValue(), null);
});

test("launch restore wins over the tree's first-note pick when the tree loads first", async (t) => {
  const pending = deferred();
  const { store } = await loadStore(t, { getNote: () => pending.promise });
  const restore = store.restoreLaunchNote(999);
  await store.initializeNotesTree();
  assert.equal(store.getActiveNoteIdValue(), null, "no incidental first-note pick while restoring");
  pending.resolve(note(999));
  assert.equal(await restore, "opened");
  assert.equal(store.getActiveNoteIdValue(), 999);
});

test("launch restore wins when the saved note loads first", async (t) => {
  const { store } = await loadStore(t, { getNote: async () => note(999) });
  assert.equal(await store.restoreLaunchNote(999), "opened");
  await store.initializeNotesTree();
  assert.equal(store.getActiveNoteIdValue(), 999);
});

test("a deleted saved note lands on the overview, even after the Notes view initialises again", async (t) => {
  const { store } = await loadStore(t);
  assert.equal(await store.restoreLaunchNote(999), "missing");
  await store.initializeNotesTree();
  await store.initializeNotesTree();
  assert.equal(store.getActiveNoteIdValue(), null);
  store.setActiveNoteId(3);
  assert.equal(store.getActiveNoteIdValue(), 3, "a deliberate pick still works");
});

test("pending native navigation during a restore takes precedence", async (t) => {
  const pending = deferred();
  const { store } = await loadStore(t, { getNote: () => pending.promise });
  const restore = store.restoreLaunchNote(999);
  store.setActiveNoteId(5); // what ControlPanel's pending-note drains do
  pending.resolve(note(999));
  assert.equal(await restore, "superseded");
  assert.equal(store.getActiveNoteIdValue(), 5);
});
```

Create `test/stores/homeViewStore.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/stores/homeViewStore.ts");

test("a transcript focus request clears whatever hides the row", async () => {
  const store = await load();
  store.setHomeFilter("meetings");
  store.setHomeQuery("pricing");
  store.requestTranscriptFocus(311);
  const state = store.useHomeViewStore.getState();
  assert.equal(state.filter, "all");
  assert.equal(state.query, "");
  assert.equal(state.focusTranscriptId, 311);
});

test("asking for the same transcript twice re-rings it", async () => {
  const store = await load();
  store.requestTranscriptFocus(5);
  const first = store.useHomeViewStore.getState().focusNonce;
  store.requestTranscriptFocus(5);
  assert.equal(store.useHomeViewStore.getState().focusNonce, first + 1);
  store.clearTranscriptFocus();
  assert.equal(store.useHomeViewStore.getState().focusTranscriptId, null);
});

test("See all in History shows every kind with the query applied", async () => {
  const store = await load();
  store.setHomeFilter("failed");
  store.showHomeQuery("standup");
  assert.deepEqual(
    { filter: store.useHomeViewStore.getState().filter, query: store.useHomeViewStore.getState().query },
    { filter: "all", query: "standup" }
  );
});
```

Create `test/components/workspaceNavigation.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { React, renderStatic } = require("../helpers/harness/reactSsr");

const load = () => import("../../src/components/workspaceNavigation.tsx");

test("without a provider the navigation is inert, never undefined", async () => {
  const { useWorkspaceNavigation, INERT_WORKSPACE_NAVIGATION } = await load();
  let seen;
  const Probe = () => {
    seen = useWorkspaceNavigation();
    return null;
  };
  renderStatic(Probe, null);
  assert.equal(seen, INERT_WORKSPACE_NAVIGATION);
  assert.doesNotThrow(() => seen.openNote(1));
});

test("a provider value reaches deep consumers", async () => {
  const { useWorkspaceNavigation, WorkspaceNavigationProvider, INERT_WORKSPACE_NAVIGATION } = await load();
  const opened = [];
  const value = { ...INERT_WORKSPACE_NAVIGATION, openNote: (id) => opened.push(id) };
  const Probe = () => {
    useWorkspaceNavigation().openNote(17);
    return null;
  };
  renderStatic(WorkspaceNavigationProvider, { value }, React.createElement(Probe));
  assert.deepEqual(opened, [17]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/lib/workspaceView.test.js test/stores/homeViewStore.test.js test/components/workspaceNavigation.test.js test/stores/noteOpenRestore.test.js test/stores/personalNotesPersistence.test.js`
Expected:
- FAIL with `Cannot find module` for the three new modules.
- `noteOpenRestore` FAILS with `store.openNoteById is not a function`.
- `personalNotesPersistence` PASSES; it guards the unchanged auto-select.

- [ ] **Step 3: Implement**

1. Create `src/lib/workspaceView.ts`:

   ```ts
   import type { ControlPanelView } from "../components/controlPanelNav";

   // WS-Q9: the main window reopens where you left it.
   export const WORKSPACE_VIEW_KEY = "workspace.activeView";
   export const WORKSPACE_NOTE_KEY = "workspace.lastNoteId";

   export const WORKSPACE_VIEWS: readonly ControlPanelView[] = [
     "home",
     "chat",
     "personal-notes",
     "insights",
     "dictionary",
     "upload",
     "integrations",
   ];

   export interface PersistedWorkspace {
     view: ControlPanelView;
     noteId: number | null;
   }

   export type WorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

   const FALLBACK: PersistedWorkspace = { view: "home", noteId: null };

   export function readPersistedWorkspace(
     storage: WorkspaceStorage | null | undefined
   ): PersistedWorkspace {
     if (!storage) return FALLBACK;
     try {
       const rawView = storage.getItem(WORKSPACE_VIEW_KEY) ?? "";
       const view = (WORKSPACE_VIEWS as readonly string[]).includes(rawView)
         ? (rawView as ControlPanelView)
         : "home";
       const rawNote = storage.getItem(WORKSPACE_NOTE_KEY);
       const parsed = rawNote ? Number(rawNote) : Number.NaN;
       const noteId = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
       return { view, noteId };
     } catch {
       return FALLBACK;
     }
   }

   export function writePersistedWorkspace(
     storage: WorkspaceStorage | null | undefined,
     state: PersistedWorkspace
   ): void {
     if (!storage) return;
     try {
       storage.setItem(WORKSPACE_VIEW_KEY, state.view);
       if (state.noteId != null) storage.setItem(WORKSPACE_NOTE_KEY, String(state.noteId));
       else storage.removeItem(WORKSPACE_NOTE_KEY);
     } catch {
       // Storage can be unavailable (quota, policy); losing the restore point is harmless.
     }
   }
   ```

1a. In `src/stores/noteStore.ts`:
   - Add `openedNotes: Record<number, NoteItem>;` to `NoteState` (`:14-27`) and `openedNotes: {},` to the initial state (`:46-57`).
   - `findNoteInState` (`:92-98`) falls back to the opened notes:

     ```ts
     function findNoteInState(state: NoteState, id: number): NoteItem | null {
       for (const items of Object.values(state.notesByContainer)) {
         const note = items.find((n) => n.id === id);
         if (note) return note;
       }
       return state.notes.find((n) => n.id === id) ?? state.openedNotes[id] ?? null;
     }
     ```

   - Next to the other module state (`:63-70`), add:

     ```ts
     // Opening notes by id (Plan 06). Every deliberate selection bumps the
     // generation, so a slower launch restore can tell it was overtaken.
     let noteNavigationGeneration = 0;
     let launchRestorePending = false; // the tree must not auto-pick a note meanwhile
     let landOnOverview = false; // a restore found nothing: keep the overview this launch
     ```

   - In `initializeNotesTree`, replace the auto-select (`:342-344`) with the version below. The tree's own pick is not a navigation, so it must not overtake a restore.

     ```ts
         if (getActiveNoteIdValue() == null && notes.length > 0 && !launchRestorePending && !landOnOverview) {
           useNoteStore.setState({ activeNoteId: notes[0].id });
         }
     ```

   - `setActiveNoteId` (`:513-516`) becomes:

     ```ts
     export function setActiveNoteId(id: number | null): void {
       noteNavigationGeneration += 1;
       if (id != null) landOnOverview = false;
       if (useNoteStore.getState().activeNoteId === id) return;
       useNoteStore.setState({ activeNoteId: id });
     }
     ```

   - At the top of `updateNoteInStore` (`:382`), after the null check:

     ```ts
       const opened = useNoteStore.getState().openedNotes;
       if (opened[note.id]) useNoteStore.setState({ openedNotes: { ...opened, [note.id]: note } });
     ```

   - At the top of `removeNote` (`:409`), after the null check:

     ```ts
       const before = useNoteStore.getState();
       if (before.openedNotes[id]) {
         const { [id]: _removed, ...rest } = before.openedNotes;
         useNoteStore.setState({
           openedNotes: rest,
           ...(before.activeNoteId === id ? { activeNoteId: null } : {}),
         });
       }
     ```

   - Append:

     ```ts
     export type OpenNoteResult = "opened" | "missing" | "superseded";

     async function fetchLiveNote(id: number): Promise<NoteItem | null> {
       try {
         const note = await window.electronAPI.getNote(id);
         return note && !note.deleted_at ? note : null;
       } catch {
         return null;
       }
     }

     function holdAndSelect(note: NoteItem): void {
       const state = useNoteStore.getState();
       const inPage = Object.values(state.notesByContainer).some((items) => items.some((n) => n.id === note.id));
       if (!inPage) useNoteStore.setState({ openedNotes: { ...state.openedNotes, [note.id]: note } });
       setActiveContext(note.space_id, note.folder_id ?? null);
       revealContainer(note.space_id, note.folder_id ?? null);
       useNoteStore.setState({ activeNoteId: note.id });
     }

     export async function openNoteById(id: number): Promise<OpenNoteResult> {
       const generation = ++noteNavigationGeneration;
       landOnOverview = false;
       const note = findNoteInState(useNoteStore.getState(), id) ?? (await fetchLiveNote(id));
       if (generation !== noteNavigationGeneration) return "superseded";
       if (!note) return "missing";
       holdAndSelect(note);
       return "opened";
     }

     export async function restoreLaunchNote(id: number): Promise<OpenNoteResult> {
       const generation = noteNavigationGeneration;
       launchRestorePending = true;
       try {
         const note = await fetchLiveNote(id);
         if (generation !== noteNavigationGeneration) return "superseded";
         if (!note) {
           landOnOverview = true;
           return "missing";
         }
         holdAndSelect(note);
         return "opened";
       } finally {
         launchRestorePending = false;
       }
     }
     ```

   If `NoteItem` has no `deleted_at` field (`src/types/electron.ts:149-246`), drop that check. `getNote` filters deleted rows itself in that case.

2. Create `src/stores/homeViewStore.ts`:

   ```ts
   import { create } from "zustand";

   export type HomeFilter = "all" | "dictations" | "meetings" | "notes" | "failed";
   export const HOME_FILTERS: readonly HomeFilter[] = ["all", "dictations", "meetings", "notes", "failed"];

   interface HomeViewState {
     filter: HomeFilter;
     query: string;
     /** Transcript the palette, a mention or a citation asked Home to reveal. */
     focusTranscriptId: number | null;
     /** Bumped on every request so asking twice re-rings the row. */
     focusNonce: number;
   }

   export const useHomeViewStore = create<HomeViewState>()(() => ({
     filter: "all",
     query: "",
     focusTranscriptId: null,
     focusNonce: 0,
   }));

   export const setHomeFilter = (filter: HomeFilter) => useHomeViewStore.setState({ filter });
   export const setHomeQuery = (query: string) => useHomeViewStore.setState({ query });
   export const showHomeQuery = (query: string) => useHomeViewStore.setState({ filter: "all", query });

   // Whatever hides the row (a chip, the in-view search) is cleared first, so
   // the deep link always lands on something visible.
   export function requestTranscriptFocus(transcriptId: number): void {
     useHomeViewStore.setState((state) => ({
       filter: "all",
       query: "",
       focusTranscriptId: transcriptId,
       focusNonce: state.focusNonce + 1,
     }));
   }

   export const clearTranscriptFocus = () => useHomeViewStore.setState({ focusTranscriptId: null });
   ```

3. Create `src/components/workspaceNavigation.tsx`:

   ```tsx
   import { createContext, useContext, type ReactNode } from "react";
   import type { ControlPanelView } from "./controlPanelNav";

   /** One way to move around the workspace from deep places (mention chips,
    *  citations, palette rows, Insights tiles). ControlPanel provides it. */
   export interface WorkspaceNavigation {
     openView(view: ControlPanelView): void;
     openNote(noteId: number): void;
     openFolder(spaceId: number, folderId: number | null): void;
     openTranscript(transcriptId: number): void;
     openConversation(conversationId: number): void;
     /** Opens a new chat. A draft is placed in the composer, never sent. */
     startChat(options?: { draft?: string }): void;
     focusAssistant(): void;
     newNote(): void;
     recordMeeting(): void;
     openUpload(): void;
     openSettings(section?: string): void;
     openSearch(): void;
   }

   const noop = () => {};
   export const INERT_WORKSPACE_NAVIGATION: WorkspaceNavigation = Object.freeze({
     openView: noop,
     openNote: noop,
     openFolder: noop,
     openTranscript: noop,
     openConversation: noop,
     startChat: noop,
     focusAssistant: noop,
     newNote: noop,
     recordMeeting: noop,
     openUpload: noop,
     openSettings: noop,
     openSearch: noop,
   });

   const WorkspaceNavigationContext = createContext<WorkspaceNavigation>(INERT_WORKSPACE_NAVIGATION);

   export function WorkspaceNavigationProvider({
     value,
     children,
   }: {
     value: WorkspaceNavigation;
     children: ReactNode;
   }) {
     return <WorkspaceNavigationContext value={value}>{children}</WorkspaceNavigationContext>;
   }

   export function useWorkspaceNavigation(): WorkspaceNavigation {
     return useContext(WorkspaceNavigationContext);
   }
   ```

4. In `src/components/ControlPanel.tsx`:

   a. Add imports:

   ```ts
   import { readPersistedWorkspace, writePersistedWorkspace } from "../lib/workspaceView";
   import { requestTranscriptFocus } from "../stores/homeViewStore";
   import { WorkspaceNavigationProvider, type WorkspaceNavigation } from "./workspaceNavigation";
   import type { ChatViewRequest } from "./chat/chatRequest";
   ```

   Also add `openNoteById` and `restoreLaunchNote` to the existing `../stores/noteStore` import list.

   b. Create `src/components/chat/chatRequest.ts`. Task 4's `ChatView` consumes and re-exports it:

   ```ts
   /** How the shell asks Chat to do something. A draft is seeded, never sent. */
   export type ChatViewRequest =
     | { kind: "new"; draft?: string; nonce: number }
     | { kind: "open"; conversationId: number; nonce: number }
     | { kind: "focus"; nonce: number };

   /** Text placed into a composer from outside (palette, Ask AI, a mention
    *  pick). It is never submitted. `resetQueue` is true for anything that
    *  starts a new intent, so a draft queued earlier can't send it (review I01). */
   export interface ComposerSeed {
     nonce: number;
     text?: string; // replaces the draft when present
     resetQueue: boolean;
   }
   ```

   c. Replace line 102 with the code below. The persisted state is read once, before any effect runs. Otherwise the persist effect would write `noteId: null` on mount and erase the note it is about to restore.

   ```ts
   const [initialWorkspace] = useState(() => readPersistedWorkspace(window.localStorage));
   const [activeView, setActiveView] = useState<ControlPanelView>(initialWorkspace.view);
   // Nothing is persisted until the one-time restore below has settled; then
   // the observable result (opened, overview, or a superseding navigation) is.
   const [restoring, setRestoring] = useState(
     initialWorkspace.view === "personal-notes" && initialWorkspace.noteId != null
   );
   const [chatRequest, setChatRequest] = useState<ChatViewRequest | null>(null);
   const requestNonceRef = useRef(0);
   const nextNonce = () => ++requestNonceRef.current;
   ```

   d. After the existing `activeNoteId` line (`:114`), add the persistence and one-time restore effects:

   ```ts
   useEffect(() => {
     if (restoring) return;
     writePersistedWorkspace(window.localStorage, { view: activeView, noteId: activeNoteId ?? null });
   }, [activeView, activeNoteId, restoring]);

   // Reopen the last note through the store's launch restore: the tree does not
   // auto-pick a note meanwhile, a deleted note keeps the overview, and the
   // pending-navigation drains (:243-282, which call setActiveNoteId) win.
   useEffect(() => {
     if (!restoring) return;
     void restoreLaunchNote(initialWorkspace.noteId!).finally(() => setRestoring(false));
     // eslint-disable-next-line react-hooks/exhaustive-deps -- one restore per launch
   }, []);
   ```

   e. Before `return (`, build the navigation value:

   ```ts
   // One path for every deep link: palette rows, mention chips, citations,
   // Sources chips and Recent rows. Older, uncached notes open too (I04).
   const openNote = useCallback(
     async (noteId: number) => {
       setActiveView("personal-notes");
       if ((await openNoteById(noteId)) === "missing") toast({ title: t("workspace.noteMissing") });
     },
     [t, toast]
   );

   const navigation = useMemo<WorkspaceNavigation>(
     () => ({
       openView: setActiveView,
       openNote: (id) => void openNote(id),
       openFolder: (spaceId, folderId) => {
         navigateToContainer(spaceId, folderId);
         setActiveView("personal-notes");
       },
       openTranscript: (id) => {
         requestTranscriptFocus(id);
         setActiveView("home");
       },
       openConversation: (conversationId) => {
         setChatRequest({ kind: "open", conversationId, nonce: nextNonce() });
         setActiveView("chat");
       },
       startChat: (options) => {
         setChatRequest({ kind: "new", draft: options?.draft, nonce: nextNonce() });
         setActiveView("chat");
       },
       focusAssistant: () => {
         setChatRequest({ kind: "focus", nonce: nextNonce() });
         setActiveView("chat");
       },
       newNote: () => void handleNewNote(),
       recordMeeting: () => void handleNewNote(),
       openUpload: () => setActiveView("upload"),
       openSettings: (section) => {
         setSettingsSection(section);
         setShowSettings(true);
       },
       openSearch: () => setShowSearch(true),
     }),
     [openNote, handleNewNote]
   );
   ```

   f. Wrap everything inside the root `<div className="h-screen bg-surface-window flex flex-col">` in `<WorkspaceNavigationProvider value={navigation}> … </WorkspaceNavigationProvider>`.

   g. In the `<CommandSearch …>` props:
      - replace the `onNoteSelect` body (`:680-685`) with `onNoteSelect={(id) => navigation.openNote(id)}`, so the palette uses the same uncached-note path;
      - replace `onTranscriptSelect={() => { setActiveView("home"); }}` with `onTranscriptSelect={navigation.openTranscript}`;
      - add `onConversationSelect={navigation.openConversation}`.

5. Add strings (Task 1 helper). English block:

   ```json
   { "workspace": { "noteMissing": "That note was deleted or moved out of this workspace." } }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/lib/workspaceView.test.js test/stores/homeViewStore.test.js test/components/workspaceNavigation.test.js test/stores/noteOpenRestore.test.js test/stores/personalNotesPersistence.test.js test/locales/translationCoverage.test.js && npm run typecheck`
Expected: PASS. Typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspaceView.ts src/stores/homeViewStore.ts src/stores/noteStore.ts src/components/workspaceNavigation.tsx src/components/chat/chatRequest.ts src/components/ControlPanel.tsx src/locales test/lib/workspaceView.test.js test/stores/homeViewStore.test.js test/components/workspaceNavigation.test.js test/stores/noteOpenRestore.test.js
git commit -m "feat(workspace): persist the view and add workspace navigation"
```

---

### Task 4: Global shortcuts and chat requests

This covers WS-Q12. It also delivers Task 3's chat requests to `ChatView`, which `⌘⇧N` and `⌘/` need.

**Files:**
- Create: `src/lib/workspaceShortcuts.ts`
- Modify: `src/components/ControlPanel.tsx`. Replace the keydown effect at `:228-241`, and pass `request` to `<ChatView />` at `:816-818`.
- Modify: `src/components/chat/ChatView.tsx`. Remove the `⌘N` listener at `:117-127`, and add the `request` prop and `ChatViewRequest` type.
- Modify: `src/components/chat/ChatInput.tsx` (as rewritten by Plan 02 Task 12). Add the `seed` prop and a draft generation for its refused-send restore.
- Create: `test/helpers/harness/mountComposer.js`. A mounted-composer helper on Plan 02's `rendererMocks` and `fakeDomTree` harness, shared with Task 22.
- Test: `test/lib/workspaceShortcuts.test.js`, `test/components/chatComposerSeed.test.js`

**Interfaces:**
- Produces:

  ```ts
  export type WorkspaceAction =
    | "openSearch" | "openSettings" | "goHome" | "goNotes" | "goChat" | "toggleSidebar"
    | "newNote" | "newChat" | "recordMeeting" | "uploadAudio" | "askAssistant";
  export interface ShortcutEventLike {
    key: string; code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean;
    isComposing?: boolean; defaultPrevented?: boolean;
  }
  export function resolveWorkspaceShortcut(event: ShortcutEventLike, context: { platform: string; dialogOpen: boolean }): WorkspaceAction | null;
  export function shortcutHint(action: WorkspaceAction, platform: string): string; // "⌘1", "Ctrl+Shift+N"
  export function isDialogOpen(doc: Pick<Document, "querySelector"> | null | undefined): boolean;
  ```

- Consumes `ChatViewRequest` from `src/components/chat/chatRequest.ts` (Task 3). `ChatView.tsx` re-exports it.
- `ChatView` takes three props:
  - `request?: ChatViewRequest | null`;
  - `onRequestHandled?: () => void`. `ControlPanel` clears the request with it, so the request does not replay when Chat remounts.
  - `onOpenSettings?: (section?: string) => void`, used by Task 21.
- Produces, in `ChatInput.tsx`, the prop `seed?: ComposerSeed | null` (`chatRequest.ts`). A seed takes effect when its nonce is new, and it never submits.
  - The seed is applied **during render**, before any effect of that commit runs, so Plan 02's queued auto-send can never see the old draft or an armed queue.
  - `resetQueue: true` disarms Plan 02's `queued` flag.
  - `text`, when present, replaces the draft.
  - Every replacing or resetting seed bumps a draft generation. A send that started before the seed, and that is refused or fails, does not restore its text over the seeded draft.
  - A focus-only seed (`resetQueue: false`, no `text`) keeps the draft and any queue the user armed.

- [ ] **Step 1: Write the failing test**

Create `test/lib/workspaceShortcuts.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/workspaceShortcuts.ts");
const mac = { platform: "darwin", dialogOpen: false };
const win = { platform: "win32", dialogOpen: false };
const ev = (over) => ({ key: "", code: "", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over });

test("the WS-Q12 map on macOS", async () => {
  const { resolveWorkspaceShortcut } = await load();
  const cases = [
    [ev({ metaKey: true, key: "k", code: "KeyK" }), "openSearch"],
    [ev({ metaKey: true, key: ",", code: "Comma" }), "openSettings"],
    [ev({ metaKey: true, key: "1", code: "Digit1" }), "goHome"],
    [ev({ metaKey: true, key: "2", code: "Digit2" }), "goNotes"],
    [ev({ metaKey: true, key: "3", code: "Digit3" }), "goChat"],
    [ev({ metaKey: true, key: "\\", code: "Backslash" }), "toggleSidebar"],
    [ev({ metaKey: true, key: "n", code: "KeyN" }), "newNote"],
    [ev({ metaKey: true, shiftKey: true, key: "N", code: "KeyN" }), "newChat"],
    [ev({ metaKey: true, shiftKey: true, key: "M", code: "KeyM" }), "recordMeeting"],
    [ev({ metaKey: true, shiftKey: true, key: "U", code: "KeyU" }), "uploadAudio"],
    [ev({ metaKey: true, key: "/", code: "Slash" }), "askAssistant"],
  ];
  for (const [event, action] of cases) assert.equal(resolveWorkspaceShortcut(event, mac), action, action);
});

test("Windows and Linux use Ctrl, and Cmd does nothing there", async () => {
  const { resolveWorkspaceShortcut } = await load();
  assert.equal(resolveWorkspaceShortcut(ev({ ctrlKey: true, key: "2", code: "Digit2" }), win), "goNotes");
  assert.equal(resolveWorkspaceShortcut(ev({ metaKey: true, key: "2", code: "Digit2" }), win), null);
  assert.equal(resolveWorkspaceShortcut(ev({ ctrlKey: true, key: "2", code: "Digit2" }), mac), null);
});

test("view digits follow the physical key on AZERTY", async () => {
  const { resolveWorkspaceShortcut } = await load();
  assert.equal(resolveWorkspaceShortcut(ev({ metaKey: true, key: "&", code: "Digit1" }), mac), "goHome");
});

test("nothing that changes the view fires behind an open dialog", async () => {
  const { resolveWorkspaceShortcut } = await load();
  const blocked = { platform: "darwin", dialogOpen: true };
  assert.equal(resolveWorkspaceShortcut(ev({ metaKey: true, key: "1", code: "Digit1" }), blocked), null);
  assert.equal(resolveWorkspaceShortcut(ev({ metaKey: true, key: "n", code: "KeyN" }), blocked), null);
  assert.equal(resolveWorkspaceShortcut(ev({ metaKey: true, key: "\\", code: "Backslash" }), blocked), null);
  assert.equal(resolveWorkspaceShortcut(ev({ metaKey: true, key: "k", code: "KeyK" }), blocked), "openSearch");
});

test("IME composition, Alt chords and handled events are ignored", async () => {
  const { resolveWorkspaceShortcut } = await load();
  assert.equal(resolveWorkspaceShortcut(ev({ metaKey: true, key: "1", code: "Digit1", isComposing: true }), mac), null);
  assert.equal(resolveWorkspaceShortcut(ev({ metaKey: true, altKey: true, key: "1", code: "Digit1" }), mac), null);
  assert.equal(resolveWorkspaceShortcut(ev({ metaKey: true, key: "1", code: "Digit1", defaultPrevented: true }), mac), null);
});

test("hints read naturally per platform", async () => {
  const { shortcutHint } = await load();
  assert.equal(shortcutHint("goHome", "darwin"), "⌘1");
  assert.equal(shortcutHint("newChat", "darwin"), "⌘⇧N");
  assert.equal(shortcutHint("newChat", "linux"), "Ctrl+Shift+N");
  assert.equal(shortcutHint("toggleSidebar", "win32"), "Ctrl+\\");
});

test("an open Radix dialog is detected from the DOM", async () => {
  const { isDialogOpen } = await load();
  assert.equal(isDialogOpen({ querySelector: () => ({}) }), true);
  assert.equal(isDialogOpen({ querySelector: () => null }), false);
  assert.equal(isDialogOpen(null), false);
});
```

Create `test/helpers/harness/mountComposer.js`. It mounts the real composer on Plan 02's harness (`test/helpers/harness/rendererMocks.js`, `test/helpers/harness/fakeDomTree.js`), the same way Plan 02's `chatComposer.test.js` does, and is shared with Task 22:

```js
const React = require("react");
const { createElement } = React;
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals, installHookDom } = require("../../lib/rendererTestHarness");
const { rendererOptions, TOAST_MOCK } = require("./rendererMocks");
const { installTree } = require("./fakeDomTree");

const MOCKS = {
  "/ui/useToast": TOAST_MOCK,
  "/useVoiceDraft": `export const useVoiceDraft = () => ({ status: "idle", start() {}, stop() {}, cancel() {}, elapsed: 0, readLevel: () => 0, streamingOnlyProvider: false });`,
};

async function mountComposer(t, onTextSubmit, extraProps = {}) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(t, rendererOptions("loqui-composer-seed-", MOCKS));
  const { ChatInput } = await vite.ssrLoadModule("/components/chat/ChatInput.tsx");
  let props = { partialTranscript: "", agentState: "idle", onTextSubmit, onCancel() {}, seed: null, ...extraProps };
  const render = (next = {}) => {
    props = { ...props, ...next };
    return React.act(async () => {
      root.render(createElement(ChatInput, props));
      await new Promise((r) => setTimeout(r, 0));
    });
  };
  root = createRoot(tree.container);
  await render();
  const textarea = () => tree.find((n) => n.tagName === "TEXTAREA");
  const type = (value) => React.act(async () => tree.props(textarea()).onChange({ target: { value } }));
  const press = (key, nativeEvent = {}) =>
    React.act(async () => {
      tree.props(textarea()).onKeyDown({
        key,
        shiftKey: false,
        nativeEvent: { isComposing: false, keyCode: key === "Enter" ? 13 : 27, ...nativeEvent },
        preventDefault() {},
      });
      await new Promise((r) => setTimeout(r, 0));
    });
  return { render, type, press, value: () => tree.props(textarea()).value };
}

module.exports = { mountComposer };
```

Create `test/components/chatComposerSeed.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { mountComposer: mount } = require("../helpers/harness/mountComposer");

test("a palette seed disarms a queued draft: nothing is sent on idle, and B stays editable", async (t) => {
  const sent = [];
  const c = await mount(t, async (text) => (sent.push(text), true));
  await c.render({ agentState: "streaming" });
  await c.type("A");
  await c.press("Enter"); // queued while busy
  await c.render({ seed: { nonce: 1, text: "B", resetQueue: true } });
  await c.render({ agentState: "idle" });
  assert.deepEqual(sent, []);
  assert.equal(c.value(), "B");
});

test("a seed that lands in the same commit as idle still wins over the queue", async (t) => {
  const sent = [];
  const c = await mount(t, async (text) => (sent.push(text), true));
  await c.render({ agentState: "thinking" });
  await c.type("A");
  await c.press("Enter");
  await c.render({ agentState: "idle", seed: { nonce: 2, text: "B", resetQueue: true } });
  assert.deepEqual(sent, []);
  assert.equal(c.value(), "B");
});

test("a focus-only request keeps the draft and the queue the user armed", async (t) => {
  const sent = [];
  const c = await mount(t, async (text) => (sent.push(text), true));
  await c.render({ agentState: "streaming" });
  await c.type("A");
  await c.press("Enter");
  await c.render({ seed: { nonce: 3, resetQueue: false } });
  await c.render({ agentState: "idle" });
  assert.deepEqual(sent, ["A"]);
});

test("a refused send that started before a new chat does not restore its text there", async (t) => {
  let settle;
  const c = await mount(t, () => new Promise((resolve) => (settle = resolve)));
  await c.type("A");
  await c.press("Enter"); // submit starts and the box clears
  await c.render({ seed: { nonce: 4, resetQueue: true } }); // new chat, no draft
  await React.act(async () => {
    settle(false);
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(c.value(), "");
});

test("a seed present at mount fills the composer and sends nothing", async (t) => {
  const sent = [];
  const c = await mount(t, async (text) => (sent.push(text), true));
  await c.render({ seed: { nonce: 5, text: "“Thursday, not Monday” ", resetQueue: true } });
  assert.equal(c.value(), "“Thursday, not Monday” ");
  assert.deepEqual(sent, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/lib/workspaceShortcuts.test.js test/components/chatComposerSeed.test.js`
Expected:
- `workspaceShortcuts` FAILS with `Cannot find module`.
- `chatComposerSeed` FAILS because the seed prop is ignored: the queued draft `A` is sent on idle, and `B` never appears.

- [ ] **Step 3: Implement**

1. Create `src/lib/workspaceShortcuts.ts`:

   ```ts
   // WS-Q12 / R13: one keyboard map for the workspace. Physical codes for
   // digits, backslash and slash so non-US layouts still work.
   export type WorkspaceAction =
     | "openSearch"
     | "openSettings"
     | "goHome"
     | "goNotes"
     | "goChat"
     | "toggleSidebar"
     | "newNote"
     | "newChat"
     | "recordMeeting"
     | "uploadAudio"
     | "askAssistant";

   export interface ShortcutEventLike {
     key: string;
     code: string;
     metaKey: boolean;
     ctrlKey: boolean;
     shiftKey: boolean;
     altKey: boolean;
     isComposing?: boolean;
     defaultPrevented?: boolean;
   }

   interface Binding {
     action: WorkspaceAction;
     shift: boolean;
     key?: string;
     code?: string;
     glyph: string;
   }

   const BINDINGS: readonly Binding[] = [
     { action: "openSearch", shift: false, key: "k", glyph: "K" },
     { action: "openSettings", shift: false, key: ",", glyph: "," },
     { action: "goHome", shift: false, code: "Digit1", glyph: "1" },
     { action: "goNotes", shift: false, code: "Digit2", glyph: "2" },
     { action: "goChat", shift: false, code: "Digit3", glyph: "3" },
     { action: "toggleSidebar", shift: false, code: "Backslash", glyph: "\\" },
     { action: "newNote", shift: false, key: "n", glyph: "N" },
     { action: "newChat", shift: true, key: "n", glyph: "N" },
     { action: "recordMeeting", shift: true, key: "m", glyph: "M" },
     { action: "uploadAudio", shift: true, key: "u", glyph: "U" },
     { action: "askAssistant", shift: false, code: "Slash", glyph: "/" },
   ];

   // Opening the palette or Settings is safe anywhere; anything that changes
   // the view waits until dialogs close.
   const ALLOWED_IN_DIALOG = new Set<WorkspaceAction>(["openSearch", "openSettings"]);

   export function resolveWorkspaceShortcut(
     event: ShortcutEventLike,
     context: { platform: string; dialogOpen: boolean }
   ): WorkspaceAction | null {
     if (event.isComposing || event.defaultPrevented || event.altKey) return null;
     const isMac = context.platform === "darwin";
     const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
     if (!mod) return null;
     const key = event.key.toLowerCase();
     const hit = BINDINGS.find(
       (binding) =>
         binding.shift === event.shiftKey &&
         (binding.code ? binding.code === event.code : binding.key === key)
     );
     if (!hit) return null;
     if (context.dialogOpen && !ALLOWED_IN_DIALOG.has(hit.action)) return null;
     return hit.action;
   }

   export function shortcutHint(action: WorkspaceAction, platform: string): string {
     const binding = BINDINGS.find((candidate) => candidate.action === action);
     if (!binding) return "";
     if (platform === "darwin") return `⌘${binding.shift ? "⇧" : ""}${binding.glyph}`;
     return `Ctrl+${binding.shift ? "Shift+" : ""}${binding.glyph}`;
   }

   export function isDialogOpen(doc: Pick<Document, "querySelector"> | null | undefined): boolean {
     if (!doc) return false;
     return (
       doc.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') !=
       null
     );
   }
   ```

2. In `src/components/ControlPanel.tsx`, replace the keydown effect at `:228-241` with:

   ```ts
   const runShortcutRef = useRef<(action: WorkspaceAction) => void>(() => {});
   runShortcutRef.current = (action) => {
     switch (action) {
       case "openSearch": return setShowSearch(true);
       case "openSettings": return setShowSettings(true);
       case "goHome": return setActiveView("home");
       case "goNotes": return setActiveView("personal-notes");
       case "goChat": return setActiveView("chat");
       case "toggleSidebar": return toggleSidebar();
       case "newNote": return navigation.newNote();
       case "newChat": return navigation.startChat();
       case "recordMeeting": return navigation.recordMeeting();
       case "uploadAudio": return navigation.openUpload();
       case "askAssistant": return navigation.focusAssistant();
     }
   };

   useEffect(() => {
     const handleKeyDown = (event: KeyboardEvent) => {
       const action = resolveWorkspaceShortcut(event, { platform, dialogOpen: isDialogOpen(document) });
       if (!action) return;
       event.preventDefault();
       runShortcutRef.current(action);
     };
     window.addEventListener("keydown", handleKeyDown);
     return () => window.removeEventListener("keydown", handleKeyDown);
   }, []);
   ```

   Import `resolveWorkspaceShortcut`, `isDialogOpen` and `type WorkspaceAction` from `../lib/workspaceShortcuts`. The ref keeps the listener stable while reading fresh callbacks. Move the effect below the `navigation` memo from Task 3 so `navigation` is in scope.

3. In `ControlPanel.tsx`, change the chat render to:

   ```tsx
   <ChatView request={chatRequest} onRequestHandled={() => setChatRequest(null)} onOpenSettings={navigation.openSettings} />
   ```

   `ChatView` is conditionally mounted (`:816`). Clearing the handled request means that leaving Chat and coming back never re-runs "new chat" or re-seeds an old draft.

4. In `src/components/chat/ChatView.tsx`:
   - Delete the `⌘N` `useEffect` (`:117-127`). New chat is now global `⌘⇧N`, and `⌘N` is New note everywhere (R13).
   - Re-export the request type, and accept the props:

   ```ts
   import type { ChatViewRequest, ComposerSeed } from "./chatRequest";
   export type { ChatViewRequest } from "./chatRequest";

   interface ChatViewProps {
     request?: ChatViewRequest | null;
     onRequestHandled?: () => void;
     onOpenSettings?: (section?: string) => void;
   }

   export default function ChatView({ request = null, onRequestHandled, onOpenSettings }: ChatViewProps = {}) {
   ```

   - After `handleNewChat` and `handleSelectConversation` are defined, add:

   ```ts
   const [composerSeed, setComposerSeed] = useState<ComposerSeed | null>(null);
   // Requests come from the palette, Capture and shortcuts. A draft is placed
   // in the composer and never sent: the user sees the model chip first. A new
   // chat disarms any queue, so an earlier queued draft can't send into it.
   useEffect(() => {
     if (!request) return;
     if (request.kind === "new") {
       handleNewChat();
       setComposerSeed({ text: request.draft, nonce: request.nonce, resetQueue: true });
     } else if (request.kind === "open") {
       handleSelectConversation(request.conversationId);
       setComposerSeed({ nonce: request.nonce, resetQueue: true });
     } else {
       setComposerSeed({ nonce: request.nonce, resetQueue: false });
     }
     onRequestHandled?.();
     // eslint-disable-next-line react-hooks/exhaustive-deps -- one run per request nonce
   }, [request?.nonce]);
   ```

   - Pass `seed={composerSeed}` to `<ChatInput … />` (`:172-181`).
   - `onOpenSettings` is unused until Task 21. Prefix the destructured name with `_` if lint complains, and rename it in Task 21.

5. In `src/components/chat/ChatInput.tsx`, as rewritten by Plan 02 Task 12:
   - Add `seed?: ComposerSeed | null;` to the props interface (imported as a type from `./chatRequest`) and destructure it.
   - Directly after Plan 02's `const [queued, setQueued] = useState(false);`, add:

     ```tsx
     // Seeds apply during render (React's "adjust state when a prop changes"
     // pattern), so no effect in this commit, in particular the queued
     // auto-send below, can see the old draft or an armed queue (review I01).
     const [appliedSeed, setAppliedSeed] = useState<number | null>(null);
     const [draftGeneration, setDraftGeneration] = useState(0);
     const draftGenerationRef = useRef(0);
     draftGenerationRef.current = draftGeneration;
     if (seed && seed.nonce !== appliedSeed) {
       setAppliedSeed(seed.nonce);
       if (seed.resetQueue) setQueued(false);
       if (seed.resetQueue || seed.text !== undefined) setDraftGeneration((g) => g + 1);
       if (seed.text !== undefined) setInputText(seed.text);
     }
     useEffect(() => {
       if (appliedSeed != null) inputRef.current?.focus();
     }, [appliedSeed]);
     ```

   - In Plan 02's `handleSubmit`, capture `const generation = draftGenerationRef.current;` right after the `if (!text || !onTextSubmit) return;` line. Then change its restore line to `if (accepted === false && generation === draftGenerationRef.current) setInputText((current) => (current.trim() ? current : text));`. A send overtaken by a seed (a new chat, a palette draft) no longer puts its text back into a conversation it was not typed for.

   Plan 02's auto-grow runs from `inputText`, so a seeded draft sizes itself.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/lib/workspaceShortcuts.test.js test/components/chatComposerSeed.test.js test/components/chatComposer.test.js && npm run typecheck && npm run lint`
Expected: PASS. Plan 02's `chatComposer` suite still passes. Typecheck and lint are clean. A grep for `e.key === "n"` in `src/components/chat/ChatView.tsx` returns nothing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspaceShortcuts.ts src/components/ControlPanel.tsx src/components/chat/ChatView.tsx src/components/chat/ChatInput.tsx test/lib/workspaceShortcuts.test.js test/helpers/harness/mountComposer.js test/components/chatComposerSeed.test.js
git commit -m "feat(workspace): add global shortcuts and chat requests"
```

---

### Task 5: Dictation status bridge to the control panel

This covers CR-06-3 and the data source for WS-R3 C live states. Today only the dictation window and the Agent pill know the dictation lifecycle (`ipcHandlers.js:1444-1479`, `windowManager.js:954-1003`).

**Files:**
- Modify: `src/helpers/windowManager.js`. Change `setDictationLifecycleState` (`:954-967`) and `setDictationAudioLevel` (`:990-1003`), add two methods, and add a constant near the top.
- Modify: `src/helpers/ipcHandlers.js`. Add two handlers after the `dictation-audio-level-changed` handler (`:1469-1479`).
- Modify: `preload.js`. Add four bindings next to `getAgentDictationPillState` (`:153`).
- Modify: `src/types/electron.ts`. Add four declarations next to `getAgentDictationPillState` (`:794-798`).
- Modify: `src/hooks/useAudioRecording.js:857-859`. This is a one-condition change; the file is Plan 04's, so note it in the PR.
- Test: append to `test/helpers/windowManagerAssistantPanel.test.js`, `test/helpers/agentDictationPillIpc.test.js` and `test/helpers/preloadAuthBridge.test.js`.

**Interfaces:**
- Produces the main-process methods `windowManager.getControlPanelDictationState(): { state, inputKind }` and `_sendControlPanelDictationState()`.
- Produces the channels:
  - `dictation-lifecycle-changed`, main to control panel, payload `{ state, inputKind }`;
  - `dictation-level-changed`, main to control panel, a number at ≤15 Hz, only while `recording`;
  - `get-dictation-lifecycle-state` (invoke);
  - `control-panel-toggle-dictation` (invoke).
  Both invoke channels are sender-guarded to `controlPanelWindow`.
- Produces preload `getDictationLifecycleState`, `onDictationLifecycleChanged`, `onDictationLevelChanged` and `toggleDictationFromControlPanel`, typed in `electron.ts` as in CR-06-3.

- [ ] **Step 1: Write the failing tests**

Append to `test/helpers/windowManagerAssistantPanel.test.js` (it already stubs Electron and requires `WindowManager`):

```js
function makeControlPanelWindow({ loading = false } = {}) {
  const sent = [];
  return {
    sent,
    window: {
      isDestroyed: () => false,
      webContents: {
        isLoading: () => loading,
        send: (channel, payload) => sent.push({ channel, payload }),
        once: () => undefined,
      },
    },
  };
}

test("the control panel mirrors every dictation lifecycle change", () => {
  const manager = new WindowManager();
  const panel = makeControlPanelWindow();
  manager.controlPanelWindow = panel.window;

  manager.setDictationLifecycleState("recording", "dictation");
  manager.setDictationLifecycleState("processing", "dictation");
  manager.setDictationLifecycleState("idle", "dictation");

  assert.deepEqual(
    panel.sent.filter((m) => m.channel === "dictation-lifecycle-changed").map((m) => m.payload),
    [
      { state: "recording", inputKind: "dictation" },
      { state: "processing", inputKind: "dictation" },
      { state: "idle", inputKind: "dictation" },
    ]
  );
  assert.deepEqual(manager.getControlPanelDictationState(), { state: "idle", inputKind: "dictation" });
});

test("control panel levels flow only while recording, at most ~15 Hz", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 10_000 });
  const manager = new WindowManager();
  const panel = makeControlPanelWindow();
  manager.controlPanelWindow = panel.window;
  const levels = () => panel.sent.filter((m) => m.channel === "dictation-level-changed").map((m) => m.payload);

  manager.setDictationAudioLevel(0.5);
  manager.setDictationLifecycleState("recording", "dictation");
  manager.setDictationAudioLevel(0.2);
  manager.setDictationAudioLevel(0.3);
  t.mock.timers.tick(70);
  manager.setDictationAudioLevel(0.4);
  t.mock.timers.tick(70);
  manager.setDictationAudioLevel(Number.NaN);
  manager.setDictationLifecycleState("processing", "dictation");
  t.mock.timers.tick(70);
  manager.setDictationAudioLevel(0.9);

  assert.deepEqual(levels(), [0.2, 0.4]);
});

test("a loading or missing control panel gets no levels and no queued listeners", () => {
  const manager = new WindowManager();
  const panel = makeControlPanelWindow({ loading: true });
  manager.controlPanelWindow = panel.window;
  manager.setDictationLifecycleState("recording", "dictation");
  manager.setDictationAudioLevel(0.5);
  assert.equal(panel.sent.filter((m) => m.channel === "dictation-level-changed").length, 0);
  manager.controlPanelWindow = null;
  assert.doesNotThrow(() => manager.setDictationAudioLevel(0.5));
});
```

Append to `test/helpers/agentDictationPillIpc.test.js`:

```js
test("only the control panel can read dictation state or toggle dictation from the workspace", () => {
  const { stub, calls, mainContents } = makeWindowManagerStub();
  const panelContents = {};
  stub.controlPanelWindow = { isDestroyed: () => false, webContents: panelContents };
  stub.getControlPanelDictationState = () => ({ state: "recording", inputKind: "dictation" });
  installWindowManager(stub);

  const read = handlers.get("get-dictation-lifecycle-state");
  assert.deepEqual(read({ sender: panelContents }), { state: "recording", inputKind: "dictation" });
  assert.deepEqual(read({ sender: mainContents }), { state: "idle", inputKind: "dictation" });

  const toggle = handlers.get("control-panel-toggle-dictation");
  assert.deepEqual(toggle({ sender: mainContents }), { success: false });
  assert.deepEqual(toggle({ sender: {} }), { success: false });
  assert.deepEqual(toggle({ sender: panelContents }), { success: true });
  assert.equal(calls.toggle, 1);

  stub.controlPanelWindow = null;
  assert.deepEqual(toggle({ sender: panelContents }), { success: false });
});
```

Append to `test/helpers/preloadAuthBridge.test.js`:

```js
test("the control panel's capture bridge strips the event and can unsubscribe", async () => {
  const { api, invocations, listeners } = loadPreloadApi();
  const states = [];
  const levels = [];
  const offState = api.onDictationLifecycleChanged((s) => states.push(s));
  const offLevel = api.onDictationLevelChanged((l) => levels.push(l));

  listeners.get("dictation-lifecycle-changed")?.({ sender: "ipc" }, { state: "recording", inputKind: "dictation" });
  listeners.get("dictation-level-changed")?.({ sender: "ipc" }, 0.3);
  await api.getDictationLifecycleState();
  await api.toggleDictationFromControlPanel();

  assert.deepEqual(states, [{ state: "recording", inputKind: "dictation" }]);
  assert.deepEqual(levels, [0.3]);
  assert.deepEqual(invocations, [["get-dictation-lifecycle-state"], ["control-panel-toggle-dictation"]]);
  offState();
  offLevel();
  assert.equal(listeners.has("dictation-lifecycle-changed"), false);
  assert.equal(listeners.has("dictation-level-changed"), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/helpers/windowManagerAssistantPanel.test.js test/helpers/agentDictationPillIpc.test.js test/helpers/preloadAuthBridge.test.js`
Expected: FAIL.
- `manager.getControlPanelDictationState is not a function`.
- `handlers.get(...)` is `undefined`, so calling it throws.
- `api.onDictationLifecycleChanged is not a function`.

- [ ] **Step 3: Implement**

1. In `src/helpers/windowManager.js`, near the other module constants, add:

   ```js
   // Control panel capture status (Plan 06, CR-06-3): ~15 Hz is enough for a
   // level-reactive rail and keeps IPC negligible.
   const CONTROL_PANEL_LEVEL_INTERVAL_MS = 66;
   ```

   In `setDictationLifecycleState`, directly after `this._sendAgentDictationPillState();`, add:

   ```js
       this._controlPanelLevelSentAt = 0;
       this._sendControlPanelDictationState();
   ```

   Add these methods after `getAgentDictationPillState()`:

   ```js
     getControlPanelDictationState() {
       return { state: this._dictationLifecycleState, inputKind: this._dictationInputKind };
     }

     _sendControlPanelDictationState() {
       this.sendToControlPanel("dictation-lifecycle-changed", this.getControlPanelDictationState());
     }

     _forwardControlPanelDictationLevel(level) {
       const win = this.controlPanelWindow;
       // Never queue did-finish-load listeners for a stream of levels.
       if (!win || win.isDestroyed() || win.webContents.isLoading()) return;
       const now = Date.now();
       if (now - (this._controlPanelLevelSentAt || 0) < CONTROL_PANEL_LEVEL_INTERVAL_MS) return;
       this._controlPanelLevelSentAt = now;
       win.webContents.send("dictation-level-changed", level);
     }
   ```

   At the very top of `setDictationAudioLevel(level)`, before the existing `_assistantPanelOpen` gate, add:

   ```js
       const controlPanelLevel = Number(level);
       if (
         Number.isFinite(controlPanelLevel) &&
         this._dictationLifecycleState === DICTATION_LIFECYCLE.RECORDING
       ) {
         this._forwardControlPanelDictationLevel(controlPanelLevel);
       }
   ```

2. In `src/helpers/ipcHandlers.js`, after the `dictation-audio-level-changed` handler (`:1479`), add:

   ```js
       // Capture status for the control panel (CR-06-3): a pull on mount, then
       // pushes from windowManager. Only the control panel may read or toggle.
       const fromControlPanel = (event) => {
         const panel = this.windowManager.controlPanelWindow;
         return !!panel && !panel.isDestroyed() && event.sender === panel.webContents;
       };
       ipcMain.handle("get-dictation-lifecycle-state", (event) =>
         fromControlPanel(event)
           ? this.windowManager.getControlPanelDictationState()
           : { state: "idle", inputKind: "dictation" }
       );
       ipcMain.handle("control-panel-toggle-dictation", (event) => {
         if (!fromControlPanel(event)) return { success: false };
         this.windowManager.sendToggleDictation();
         return { success: true };
       });
   ```

3. In `preload.js`, after `getAgentDictationPillState` (`:153`), add:

   ```js
     getDictationLifecycleState: () => ipcRenderer.invoke("get-dictation-lifecycle-state"),
     onDictationLifecycleChanged: registerListener(
       "dictation-lifecycle-changed",
       (callback) => (_event, snapshot) => callback(snapshot)
     ),
     onDictationLevelChanged: registerListener(
       "dictation-level-changed",
       (callback) => (_event, level) => callback(level)
     ),
     toggleDictationFromControlPanel: () => ipcRenderer.invoke("control-panel-toggle-dictation"),
   ```

4. In `src/types/electron.ts`, after the `getAgentDictationPillState?` declaration (`:794-798`), add:

   ```ts
         /** Control panel capture status (Plan 06, CR-06-3). Unknown future states pass through. */
         getDictationLifecycleState?: () => Promise<DictationLifecycleSnapshot>;
         onDictationLifecycleChanged?: (
           callback: (snapshot: DictationLifecycleSnapshot) => void
         ) => () => void;
         onDictationLevelChanged?: (callback: (level: number) => void) => () => void;
         toggleDictationFromControlPanel?: () => Promise<{ success: boolean }>;
   ```

   Near `TranscriptionItem` (`:97`), add the exported type:

   ```ts
   export interface DictationLifecycleSnapshot {
     state: "idle" | "preparing" | "recording" | "processing" | (string & {});
     inputKind: "dictation" | "assistant" | "translation";
   }
   ```

5. In `src/hooks/useAudioRecording.js`, the level report at `:853-859` currently skips IPC unless the Agent panel is open. Change it to:

   ```js
         // Main mirrors levels to the Agent companion pill (only while its panel
         // is open) and to the control panel's capture rail (throttled to 15 Hz).
         if (!isAssistantVoice) {
           window.electronAPI?.dictationAudioLevelChanged?.(level);
         }
   ```

   The interval is already 80 ms (`COMPANION_AUDIO_LEVEL_INTERVAL_MS`). Main still drops pill levels while the panel is closed (`windowManager.js:991-996`), so the pill's behaviour is unchanged. `assistantOpenRef` may now be unused in this effect. Remove it from the effect body and the deps if lint says so, but keep the hook parameter, because other code uses it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/helpers/windowManagerAssistantPanel.test.js test/helpers/agentDictationPillIpc.test.js test/helpers/preloadAuthBridge.test.js test/helpers/dictationLifecycle.test.js && npm run typecheck`
Expected: PASS. The existing pill tests are unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/windowManager.js src/helpers/ipcHandlers.js preload.js src/types/electron.ts src/hooks/useAudioRecording.js test/helpers/windowManagerAssistantPanel.test.js test/helpers/agentDictationPillIpc.test.js test/helpers/preloadAuthBridge.test.js
git commit -m "feat(ipc): mirror dictation state and level to the control panel"
```

---

### Task 6: Capture status model and hook

This covers the WS-R3 C live states as data.

**Files:**
- Create: `src/lib/captureStatus.ts`
- Create: `src/hooks/useCaptureStatus.ts`
- Test: `test/lib/captureStatus.test.js`

**Interfaces:**
- Consumes the Task 5 preload methods, `useMeetingRecordingStore` (`isRecording`, `recordingStartedAt`, `micCaptureStatus`, `currentMicLevel`), `stopRecording()` from `src/stores/meetingRecordingStore.ts`, and `window.electronAPI.checkMicrophoneAccess()` (`preload.js:681`).
- Produces `src/lib/captureStatus.ts`:

  ```ts
  export type CaptureStatusKind = "ready" | "listening" | "processing" | "offline";
  export type MicCaptureStatus = "inactive" | "active" | "reconnecting" | "unavailable";
  export interface CaptureFacts {
    dictationState: string | null;           // Task 5 snapshot.state; unknown values mean idle
    dictationInputKind: string | null;       // Task 5 snapshot.inputKind
    dictationStartedAt: number | null;
    meeting: { isRecording: boolean; startedAt: number | null; micCaptureStatus: MicCaptureStatus };
    micGranted: boolean | null;              // null while unknown
  }
  export interface CaptureStatus {
    kind: CaptureStatusKind;
    source: "dictation" | "meeting" | null;
    startedAt: number | null;
    offlineReason: "permission" | "device" | null;
    inputKind: "dictation" | "assistant" | "translation" | null; // null unless dictation is the source
  }
  export function resolveCaptureStatus(facts: CaptureFacts): CaptureStatus;
  /** Which §5.1 routes a capture uses (review I13). Speech goes to dictationStt
   *  or, for a meeting, noteRecordingStt; assistant and translation captures
   *  then also go through their text route. Idle is the next dictation. */
  export type CaptureRole = "dictation" | "meeting" | "assistant" | "translation";
  export function captureRouteIds(status: Pick<CaptureStatus, "source" | "inputKind">): {
    role: CaptureRole;
    speech: "dictationStt" | "noteRecordingStt";
    text: "voiceAssistant" | "translation" | null;
  };
  export function nextDictationStartedAt(prevState: string | null, prevStartedAt: number | null, nextState: string, now: number): number | null;
  export function formatElapsed(ms: number): string;     // "0:07", "12:40", "1:02:03"
  export function railLevelStep(previous: number, target: number): number; // attack 0.65, release 0.24 per 66ms tick
  ```

- Produces `src/hooks/useCaptureStatus.ts`:

  ```ts
  export interface CaptureStatusModel extends CaptureStatus {
    readLevel: () => number;          // 0..1-ish; meeting level or the dictation level from IPC
    toggleDictation: () => Promise<void>;
    stop: () => Promise<void>;        // stops whichever source is live
  }
  export function useCaptureStatus(): CaptureStatusModel;          // call once, in ControlPanel; pass it down
  export function useLiveClock(active: boolean): number;            // Date.now(), ticking 1 Hz only while active
  ```

- Precedence, from first match:
  1. A meeting mic that is `unavailable` or `reconnecting` while recording → **offline (device)**.
  2. Dictation `recording` → **listening (dictation)**.
  3. Meeting recording → **listening (meeting)**.
  4. Dictation `processing` → **processing**.
  5. Mic permission denied → **offline (permission)**.
  6. Anything else, including `preparing` and Plan 04's future `cancelled` → **ready**.

- [ ] **Step 1: Write the failing test**

Create `test/lib/captureStatus.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/captureStatus.ts");
const idleMeeting = { isRecording: false, startedAt: null, micCaptureStatus: "inactive" };
const facts = (over = {}) => ({
  dictationState: "idle",
  dictationInputKind: "dictation",
  dictationStartedAt: null,
  meeting: idleMeeting,
  micGranted: true,
  ...over,
});

test("idle is Ready", async () => {
  const { resolveCaptureStatus } = await load();
  assert.deepEqual(resolveCaptureStatus(facts()), { kind: "ready", source: null, startedAt: null, offlineReason: null, inputKind: null });
});

test("dictation recording is Listening with its start time", async () => {
  const { resolveCaptureStatus } = await load();
  const status = resolveCaptureStatus(facts({ dictationState: "recording", dictationStartedAt: 1000 }));
  assert.deepEqual(status, { kind: "listening", source: "dictation", startedAt: 1000, offlineReason: null, inputKind: "dictation" });
});

test("a meeting recording is Listening from the meeting's start", async () => {
  const { resolveCaptureStatus } = await load();
  const status = resolveCaptureStatus(
    facts({ meeting: { isRecording: true, startedAt: 500, micCaptureStatus: "active" } })
  );
  assert.equal(status.kind, "listening");
  assert.equal(status.source, "meeting");
  assert.equal(status.startedAt, 500);
});

test("cleanup after dictation is Cleaning up", async () => {
  const { resolveCaptureStatus } = await load();
  assert.equal(resolveCaptureStatus(facts({ dictationState: "processing" })).kind, "processing");
});

test("a lost meeting mic outranks everything and says device", async () => {
  const { resolveCaptureStatus } = await load();
  for (const micCaptureStatus of ["unavailable", "reconnecting"]) {
    const status = resolveCaptureStatus(
      facts({ dictationState: "recording", meeting: { isRecording: true, startedAt: 1, micCaptureStatus } })
    );
    assert.deepEqual([status.kind, status.offlineReason], ["offline", "device"], micCaptureStatus);
  }
});

test("denied mic permission is offline only while nothing is live", async () => {
  const { resolveCaptureStatus } = await load();
  assert.deepEqual(
    [resolveCaptureStatus(facts({ micGranted: false })).kind, resolveCaptureStatus(facts({ micGranted: false })).offlineReason],
    ["offline", "permission"]
  );
  assert.equal(resolveCaptureStatus(facts({ micGranted: null })).kind, "ready");
});

test("preparing and unknown future states read as Ready", async () => {
  const { resolveCaptureStatus } = await load();
  for (const dictationState of ["preparing", "cancelled", "somethingNew", null]) {
    assert.equal(resolveCaptureStatus(facts({ dictationState })).kind, "ready", String(dictationState));
  }
});

test("the dictation clock starts on entering recording and clears after", async () => {
  const { nextDictationStartedAt } = await load();
  assert.equal(nextDictationStartedAt("idle", null, "recording", 42), 42);
  assert.equal(nextDictationStartedAt("recording", 42, "recording", 99), 42);
  assert.equal(nextDictationStartedAt("recording", 42, "processing", 99), null);
});

test("elapsed time reads like a recorder", async () => {
  const { formatElapsed } = await load();
  assert.equal(formatElapsed(7_400), "0:07");
  assert.equal(formatElapsed(760_000), "12:40");
  assert.equal(formatElapsed(3_723_000), "1:02:03");
  for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(formatElapsed(bad), "0:00");
});

test("a live capture names the routes its audio and text actually take (I13)", async () => {
  const { resolveCaptureStatus, captureRouteIds } = await load();
  const meeting = resolveCaptureStatus(facts({ meeting: { isRecording: true, startedAt: 1, micCaptureStatus: "active" } }));
  assert.deepEqual(captureRouteIds(meeting), { role: "meeting", speech: "noteRecordingStt", text: null });
  const assistant = resolveCaptureStatus(facts({ dictationState: "recording", dictationInputKind: "assistant" }));
  assert.deepEqual(captureRouteIds(assistant), { role: "assistant", speech: "dictationStt", text: "voiceAssistant" });
  const translation = resolveCaptureStatus(facts({ dictationState: "processing", dictationInputKind: "translation" }));
  assert.deepEqual(captureRouteIds(translation), { role: "translation", speech: "dictationStt", text: "translation" });
  assert.deepEqual(captureRouteIds(resolveCaptureStatus(facts())), { role: "dictation", speech: "dictationStt", text: null });
});

test("the rail rises fast and falls slowly", async () => {
  const { railLevelStep } = await load();
  const up = railLevelStep(0, 1);
  const down = railLevelStep(1, 0);
  assert.ok(up > 0.6 && up < 0.7, `attack ${up}`);
  assert.ok(down > 0.7 && down < 0.8, `release ${down}`);
  assert.equal(railLevelStep(Number.NaN, 0.5), railLevelStep(0, 0.5));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/lib/captureStatus.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

1. Create `src/lib/captureStatus.ts`:

   ```ts
   // WS-R3 C: one vocabulary for "is it listening?" across the shell.
   // Ready · Listening m:ss · Cleaning up… · Mic offline — never colour alone.
   export type CaptureStatusKind = "ready" | "listening" | "processing" | "offline";
   export type MicCaptureStatus = "inactive" | "active" | "reconnecting" | "unavailable";

   export interface CaptureFacts {
     dictationState: string | null;
     dictationInputKind: string | null;
     dictationStartedAt: number | null;
     meeting: { isRecording: boolean; startedAt: number | null; micCaptureStatus: MicCaptureStatus };
     micGranted: boolean | null;
   }

   export interface CaptureStatus {
     kind: CaptureStatusKind;
     source: "dictation" | "meeting" | null;
     startedAt: number | null;
     offlineReason: "permission" | "device" | null;
     inputKind: "dictation" | "assistant" | "translation" | null;
   }

   const INPUT_KINDS = new Set(["dictation", "assistant", "translation"]);

   const status = (
     kind: CaptureStatusKind,
     source: CaptureStatus["source"] = null,
     startedAt: number | null = null,
     offlineReason: CaptureStatus["offlineReason"] = null,
     inputKind: CaptureStatus["inputKind"] = null
   ): CaptureStatus => ({ kind, source, startedAt, offlineReason, inputKind });

   export function resolveCaptureStatus(facts: CaptureFacts): CaptureStatus {
     const { meeting } = facts;
     const meetingMicLost =
       meeting.micCaptureStatus === "unavailable" || meeting.micCaptureStatus === "reconnecting";
     const kind = INPUT_KINDS.has(facts.dictationInputKind ?? "")
       ? (facts.dictationInputKind as CaptureStatus["inputKind"])
       : "dictation";
     if (meeting.isRecording && meetingMicLost) return status("offline", "meeting", null, "device");
     if (facts.dictationState === "recording") {
       return status("listening", "dictation", facts.dictationStartedAt, null, kind);
     }
     if (meeting.isRecording) return status("listening", "meeting", meeting.startedAt);
     if (facts.dictationState === "processing") return status("processing", "dictation", null, null, kind);
     if (facts.micGranted === false) return status("offline", null, null, "permission");
     return status("ready");
   }

   export type CaptureRole = "dictation" | "meeting" | "assistant" | "translation";

   export function captureRouteIds(status: Pick<CaptureStatus, "source" | "inputKind">): {
     role: CaptureRole;
     speech: "dictationStt" | "noteRecordingStt";
     text: "voiceAssistant" | "translation" | null;
   } {
     if (status.source === "meeting") return { role: "meeting", speech: "noteRecordingStt", text: null };
     if (status.source === "dictation" && status.inputKind === "assistant") {
       return { role: "assistant", speech: "dictationStt", text: "voiceAssistant" };
     }
     if (status.source === "dictation" && status.inputKind === "translation") {
       return { role: "translation", speech: "dictationStt", text: "translation" };
     }
     return { role: "dictation", speech: "dictationStt", text: null };
   }

   export function nextDictationStartedAt(
     prevState: string | null,
     prevStartedAt: number | null,
     nextState: string,
     now: number
   ): number | null {
     if (nextState !== "recording") return null;
     return prevState === "recording" && prevStartedAt != null ? prevStartedAt : now;
   }

   export function formatElapsed(ms: number): string {
     const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
     const hours = Math.floor(total / 3600);
     const minutes = Math.floor((total % 3600) / 60);
     const seconds = String(total % 60).padStart(2, "0");
     return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
   }

   // ~60ms attack / ~240ms release at the 66ms tick main uses (CR-06-3).
   const ATTACK = 0.65;
   const RELEASE = 0.24;
   export function railLevelStep(previous: number, target: number): number {
     const from = Number.isFinite(previous) ? previous : 0;
     const to = Number.isFinite(target) ? Math.min(Math.max(target, 0), 1) : 0;
     const factor = to > from ? ATTACK : RELEASE;
     return Math.round((from + (to - from) * factor) * 1000) / 1000;
   }
   ```

2. Create `src/hooks/useCaptureStatus.ts`:

   ```ts
   import { useCallback, useEffect, useMemo, useRef, useState } from "react";
   import { useShallow } from "zustand/react/shallow";
   import {
     nextDictationStartedAt,
     resolveCaptureStatus,
     type CaptureStatus,
   } from "../lib/captureStatus";
   import { stopRecording, useMeetingRecordingStore } from "../stores/meetingRecordingStore";
   import type { DictationLifecycleSnapshot } from "../types/electron";

   export interface CaptureStatusModel extends CaptureStatus {
     readLevel: () => number;
     toggleDictation: () => Promise<void>;
     stop: () => Promise<void>;
   }

   export function useCaptureStatus(): CaptureStatusModel {
     const [dictationState, setDictationState] = useState<string | null>(null);
     const [dictationInputKind, setDictationInputKind] = useState<string | null>(null);
     const [dictationStartedAt, setDictationStartedAt] = useState<number | null>(null);
     const [micGranted, setMicGranted] = useState<boolean | null>(null);
     const stateRef = useRef<{ state: string | null; startedAt: number | null }>({ state: null, startedAt: null });
     const dictationLevelRef = useRef(0);
     const meeting = useMeetingRecordingStore(
       useShallow((s) => ({
         isRecording: s.isRecording,
         startedAt: s.recordingStartedAt,
         micCaptureStatus: s.micCaptureStatus,
       }))
     );

     useEffect(() => {
       const api = window.electronAPI;
       let alive = true;
       const apply = (snapshot: DictationLifecycleSnapshot | null | undefined) => {
         if (!alive || !snapshot) return;
         const startedAt = nextDictationStartedAt(
           stateRef.current.state,
           stateRef.current.startedAt,
           snapshot.state,
           Date.now()
         );
         stateRef.current = { state: snapshot.state, startedAt };
         if (snapshot.state !== "recording") dictationLevelRef.current = 0;
         setDictationState(snapshot.state);
         setDictationInputKind(snapshot.inputKind ?? null);
         setDictationStartedAt(startedAt);
       };
       void api?.getDictationLifecycleState?.().then(apply).catch(() => {});
       const offState = api?.onDictationLifecycleChanged?.(apply);
       const offLevel = api?.onDictationLevelChanged?.((level) => {
         dictationLevelRef.current = Number.isFinite(level) ? level : 0;
       });
       const checkMic = () =>
         void api
           ?.checkMicrophoneAccess?.()
           .then((result: { granted?: boolean } | undefined) => alive && setMicGranted(result?.granted ?? null))
           .catch(() => {});
       checkMic();
       window.addEventListener("focus", checkMic);
       return () => {
         alive = false;
         offState?.();
         offLevel?.();
         window.removeEventListener("focus", checkMic);
       };
     }, []);

     const status = useMemo(
       () => resolveCaptureStatus({ dictationState, dictationInputKind, dictationStartedAt, meeting, micGranted }),
       [dictationState, dictationInputKind, dictationStartedAt, meeting, micGranted]
     );

     const readLevel = useCallback(() => {
       if (stateRef.current.state === "recording") return dictationLevelRef.current;
       return useMeetingRecordingStore.getState().currentMicLevel ?? 0;
     }, []);

     const toggleDictation = useCallback(async () => {
       await window.electronAPI?.toggleDictationFromControlPanel?.();
     }, []);

     const stop = useCallback(async () => {
       if (status.source === "meeting") await stopRecording();
       else await toggleDictation();
     }, [status.source, toggleDictation]);

     return { ...status, readLevel, toggleDictation, stop };
   }

   /** Wall clock for Listening timers: ticks once a second, only while active. */
   export function useLiveClock(active: boolean): number {
     const [now, setNow] = useState(() => Date.now());
     useEffect(() => {
       if (!active) return;
       setNow(Date.now());
       const id = window.setInterval(() => setNow(Date.now()), 1000);
       return () => window.clearInterval(id);
     }, [active]);
     return now;
   }
   ```

   If `checkMicrophoneAccess` is missing from `electron.ts`, add `checkMicrophoneAccess?: () => Promise<{ granted: boolean; status?: string }>;` next to `requestMicrophoneAccess`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/lib/captureStatus.test.js && npm run typecheck`
Expected: PASS (10 tests). Typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/captureStatus.ts src/hooks/useCaptureStatus.ts src/types/electron.ts test/lib/captureStatus.test.js
git commit -m "feat(workspace): model capture status as Ready, Listening, Cleaning up or Mic offline"
```

---

### Task 7: Capture split button with live states

This covers WS-R3 A with C's live states (owner note) and WS-Q8. It replaces `NewNoteMenu`.

**Files:**
- Create: `src/components/CaptureMenu.tsx` (presentational)
- Create: `src/components/CaptureControl.tsx` (container: status, ticking clock, last action)
- Delete: `src/components/notes/NewNoteMenu.tsx`, `test/components/newNoteMenu.test.js`
- Modify: `src/hooks/useCreateNote.ts`. `createNoteIn`/`createNote` gain `{ record?: boolean }`.
- Modify: `src/components/ControlPanel.tsx`:
  - the `actions={<NewNoteMenu … />}` prop at `:734-736`;
  - `handleNewNote` at `:137-142`;
  - the `newNote`/`recordMeeting` entries in the Task 3 `navigation` memo.
- Test: `test/components/captureMenu.test.js`, `test/hooks/useCreateNoteRecord.test.js`

**Interfaces:**
- Consumes `CaptureStatus` and `formatElapsed` (Task 6), `shortcutHint` (Task 4), `useWorkspaceNavigation` (Task 3), `Button variant="live"` and `LevelBars` (Plan 01), and `SPLIT_BUTTON_*` from `src/components/ui/splitButton`.
- Produces:

  ```ts
  export type CaptureAction = "dictate" | "recordMeeting" | "upload" | "newNote" | "newChat";
  export const CAPTURE_ACTIONS: readonly CaptureAction[];
  export function readLastCaptureAction(storage: Pick<Storage, "getItem"> | null | undefined): CaptureAction; // default "dictate"
  export interface CaptureMenuProps {
    status: Pick<CaptureStatus, "kind" | "source" | "startedAt">;
    now: number;
    readLevel: () => number;
    lastAction: CaptureAction;
    hotkeyLabel: string;   // e.g. "Fn"
    platform: string;
    showChat: boolean;     // false when policy turns the assistant off
    onRun: (action: CaptureAction) => void;
    onStop: () => void;
  }
  export default function CaptureMenu(props: CaptureMenuProps): JSX.Element;
  ```

  `CaptureControl` takes `{ capture: CaptureStatusModel; hotkey: string; showChat: boolean }` and wires the rest. `ControlPanel` calls `useCaptureStatus()` once and shares it with the sidebar (Task 9) and Home (Task 11), so there is one IPC subscription and one mic-permission check.
- `useCreateNote().createNote(options?: { record?: boolean })` and `createNoteIn(spaceId, folderId, options?)`. `record` defaults to `true`, so existing callers are unchanged.

- [ ] **Step 1: Write the failing tests**

Create `test/components/captureMenu.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// i18n keys render verbatim; dropdown primitives render inline (no portal).
async function renderCapture(t, props = {}) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-capture-menu-test-",
    mockModules: {
      "/ui/dropdown-menu": `
        import { createElement } from "react";
        const passthrough = (props) => createElement("div", null, props.children);
        export const DropdownMenu = passthrough;
        export const DropdownMenuTrigger = passthrough;
        export const DropdownMenuContent = passthrough;
        export const DropdownMenuItem = (props) => createElement("div", { "data-item": props["data-action"] }, props.children);
        export const DropdownMenuSeparator = () => createElement("hr", null);
      `,
    },
  });
  const mod = await vite.ssrLoadModule("/components/CaptureMenu.tsx");
  return {
    mod,
    html: renderToStaticMarkup(
      createElement(mod.default, {
        status: { kind: "ready", source: null, startedAt: null },
        now: 10_000,
        readLevel: () => 0,
        lastAction: "dictate",
        hotkeyLabel: "Fn",
        platform: "darwin",
        showChat: true,
        onRun: () => {},
        onStop: () => {},
        ...props,
      })
    ),
  };
}

test("idle Capture is neutral and offers every capture path with its key", async (t) => {
  const { html } = await renderCapture(t);
  assert.doesNotMatch(html, /data-variant="live"/);
  assert.match(html, /capture\.short\.dictate/);
  for (const key of ["dictate", "recordMeeting", "upload", "newNote", "newChat"]) {
    assert.match(html, new RegExp(`capture\\.actions\\.${key}`));
  }
  for (const hint of ["Fn", "⌘⇧M", "⌘⇧U", "⌘N", "⌘⇧N"]) assert.ok(html.includes(hint), hint);
  assert.match(html, /aria-label="capture\.moreOptions"/);
});

test("the primary segment remembers the last action", async (t) => {
  const { html } = await renderCapture(t, { lastAction: "upload" });
  assert.match(html, /capture\.short\.upload/);
});

test("while listening the primary segment is the live Stop with a level and a clock", async (t) => {
  const { html } = await renderCapture(t, {
    status: { kind: "listening", source: "dictation", startedAt: 3_000 },
  });
  assert.match(html, /data-variant="live"/);
  assert.match(html, /aria-label="capture\.stopListening"/);
  assert.match(html, /data-elapsed="0:07"/);
});

test("a live meeting says Stop recording", async (t) => {
  const { html } = await renderCapture(t, {
    status: { kind: "listening", source: "meeting", startedAt: 0 },
  });
  assert.match(html, /aria-label="capture\.stopRecording"/);
});

test("cleaning up is announced and busy, not orange", async (t) => {
  const { html } = await renderCapture(t, { status: { kind: "processing", source: "dictation", startedAt: null } });
  assert.match(html, /capture\.cleaningUp/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /data-variant="live"/);
});

test("no assistant, no New chat", async (t) => {
  const { html } = await renderCapture(t, { showChat: false });
  assert.doesNotMatch(html, /capture\.actions\.newChat/);
});

test("a stored last action is validated", async (t) => {
  const { mod } = await renderCapture(t);
  assert.equal(mod.readLastCaptureAction({ getItem: () => "upload" }), "upload");
  assert.equal(mod.readLastCaptureAction({ getItem: () => "launchRockets" }), "dictate");
  assert.equal(mod.readLastCaptureAction(null), "dictate");
});
```

Create `test/hooks/useCreateNoteRecord.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../../src/hooks/useCreateNote.ts"), "utf8");

// Behavioural cover lives in the Capture flow; this pins the contract that
// existing callers keep recording and Capture's New note can opt out.
test("createNoteIn records by default and can opt out", () => {
  assert.match(source, /options:\s*\{\s*record\?:\s*boolean\s*\}\s*=\s*\{\}/);
  assert.match(source, /const record = options\.record \?\? true;/);
  assert.match(source, /if \(record && !isRecording\) void startRecordingForNote\(result\.note\);/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/captureMenu.test.js test/hooks/useCreateNoteRecord.test.js`
Expected: FAIL. `ssrLoadModule` cannot resolve `/components/CaptureMenu.tsx`, and the regexes do not match.

- [ ] **Step 3: Implement**

1. In `src/hooks/useCreateNote.ts`, change `createNoteIn` and `createNote`:

   ```ts
     const createNoteIn = useCallback(
       async (spaceId: number | null, folderId: number | null, options: { record?: boolean } = {}) => {
         const record = options.record ?? true;
         const result = await window.electronAPI.saveNote(
           t("notes.list.untitledNote"),
           "",
           "personal",
           null,
           null,
           folderId,
           spaceId
         );
         if (!result.success || !result.note) return;
         setActiveContext(result.note.space_id, result.note.folder_id);
         revealContainer(result.note.space_id, result.note.folder_id);
         setActiveNoteId(result.note.id);
         // A new note is a recording waiting to happen, unless the caller asked
         // for a plain note (Capture → New note).
         if (record && !isRecording) void startRecordingForNote(result.note);
       },
       [t, isRecording]
     );

     const createNote = useCallback(
       (options?: { record?: boolean }) =>
         createNoteIn(activeContext?.spaceId ?? null, activeContext?.folderId ?? null, options),
       [activeContext, createNoteIn]
     );
   ```

   `SpacesTree`'s `onNewNote: (spaceId, folderId) => void` still type-checks, because the third parameter is optional.

2. Create `src/components/CaptureMenu.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { ChevronDown, Loader2, MessageSquare, Mic, NotebookPen, Square, Upload, AudioLines } from "lucide-react";
   import { Button } from "./ui/button";
   import { LevelBars } from "./ui/LevelBars";
   import {
     DropdownMenu,
     DropdownMenuContent,
     DropdownMenuItem,
     DropdownMenuSeparator,
     DropdownMenuTrigger,
   } from "./ui/dropdown-menu";
   import { SPLIT_BUTTON_DIVIDER_CLASS, SPLIT_BUTTON_GROUP_CLASS, SPLIT_BUTTON_SEGMENT_CLASS } from "./ui/splitButton";
   import { cn } from "./lib/utils";
   import { formatElapsed, type CaptureStatus } from "../lib/captureStatus";
   import { shortcutHint, type WorkspaceAction } from "../lib/workspaceShortcuts";

   export type CaptureAction = "dictate" | "recordMeeting" | "upload" | "newNote" | "newChat";
   export const CAPTURE_ACTIONS: readonly CaptureAction[] = ["dictate", "recordMeeting", "upload", "newNote", "newChat"];
   export const LAST_CAPTURE_ACTION_KEY = "capture.lastAction";

   export function readLastCaptureAction(storage: Pick<Storage, "getItem"> | null | undefined): CaptureAction {
     try {
       const value = storage?.getItem(LAST_CAPTURE_ACTION_KEY);
       return (CAPTURE_ACTIONS as readonly string[]).includes(value ?? "") ? (value as CaptureAction) : "dictate";
     } catch {
       return "dictate";
     }
   }

   const ICONS: Record<CaptureAction, typeof Mic> = {
     dictate: Mic,
     recordMeeting: AudioLines,
     upload: Upload,
     newNote: NotebookPen,
     newChat: MessageSquare,
   };
   const SHORTCUTS: Partial<Record<CaptureAction, WorkspaceAction>> = {
     recordMeeting: "recordMeeting",
     upload: "uploadAudio",
     newNote: "newNote",
     newChat: "newChat",
   };

   export interface CaptureMenuProps {
     status: Pick<CaptureStatus, "kind" | "source" | "startedAt">;
     now: number;
     readLevel: () => number;
     lastAction: CaptureAction;
     hotkeyLabel: string;
     platform: string;
     showChat: boolean;
     onRun: (action: CaptureAction) => void;
     onStop: () => void;
   }

   export default function CaptureMenu({
     status,
     now,
     readLevel,
     lastAction,
     hotkeyLabel,
     platform,
     showChat,
     onRun,
     onStop,
   }: CaptureMenuProps) {
     const { t } = useTranslation();
     const actions = CAPTURE_ACTIONS.filter((action) => showChat || action !== "newChat");
     const primary = showChat || lastAction !== "newChat" ? lastAction : "dictate";
     const PrimaryIcon = ICONS[primary];
     const hint = (action: CaptureAction) =>
       action === "dictate" ? hotkeyLabel : shortcutHint(SHORTCUTS[action]!, platform);

     let primarySegment: React.ReactNode;
     if (status.kind === "listening") {
       // D1: orange only while the mic is live. One click stops what is live.
       const elapsed = formatElapsed(status.startedAt == null ? 0 : now - status.startedAt);
       primarySegment = (
         <Button
           variant="live"
           size="sm"
           data-state="listening"
           data-elapsed={elapsed}
           aria-label={t(status.source === "meeting" ? "capture.stopRecording" : "capture.stopListening")}
           onClick={onStop}
           className={cn(SPLIT_BUTTON_SEGMENT_CLASS, "gap-2 tabular-nums")}
         >
           <Square size={10} aria-hidden className="fill-current" />
           <LevelBars readLevel={readLevel} height={14} />
           <span>{t("capture.listening", { time: elapsed })}</span>
         </Button>
       );
     } else if (status.kind === "processing") {
       primarySegment = (
         <button
           type="button"
           disabled
           aria-busy="true"
           className={cn(SPLIT_BUTTON_SEGMENT_CLASS, "gap-2 text-ui text-foreground")}
         >
           <Loader2 size={14} aria-hidden className="text-warning motion-safe:animate-spin" />
           <span role="status">{t("capture.cleaningUp")}</span>
         </button>
       );
     } else {
       primarySegment = (
         <button
           type="button"
           onClick={() => onRun(primary)}
           className={cn(SPLIT_BUTTON_SEGMENT_CLASS, "gap-2 text-ui text-foreground")}
         >
           <PrimaryIcon size={14} aria-hidden />
           <span>{t(`capture.short.${primary}`)}</span>
         </button>
       );
     }

     return (
       <div className={SPLIT_BUTTON_GROUP_CLASS} role="group" aria-label={t("capture.group")}>
         {primarySegment}
         <span className={SPLIT_BUTTON_DIVIDER_CLASS} aria-hidden />
         <DropdownMenu>
           <DropdownMenuTrigger asChild>
             <button type="button" aria-label={t("capture.moreOptions")} className={SPLIT_BUTTON_SEGMENT_CLASS}>
               <ChevronDown size={14} aria-hidden />
             </button>
           </DropdownMenuTrigger>
           <DropdownMenuContent align="end" className="w-62">
             {actions.map((action) => {
               const Icon = ICONS[action];
               return (
                 <div key={action}>
                   {action === "newNote" && <DropdownMenuSeparator />}
                   <DropdownMenuItem data-action={action} onSelect={() => onRun(action)} className="h-9 gap-2.5 text-ui">
                     <Icon size={14} aria-hidden />
                     <span className="flex-1">{t(`capture.actions.${action}`)}</span>
                     <kbd dir="ltr" className="text-micro text-muted-foreground">{hint(action)}</kbd>
                   </DropdownMenuItem>
                 </div>
               );
             })}
           </DropdownMenuContent>
         </DropdownMenu>
       </div>
     );
   }
   ```

   Check `src/components/ui/splitButton.ts` for the exact class constants. The old `NewNoteMenu` imported exactly these three, so they exist. If `w-62` is not a Tailwind 4 spacing step, use `w-[248px]` (the R3 A menu width).

3. Create `src/components/CaptureControl.tsx`:

   ```tsx
   import { useCallback, useState } from "react";
   import CaptureMenu, { LAST_CAPTURE_ACTION_KEY, readLastCaptureAction, type CaptureAction } from "./CaptureMenu";
   import { useLiveClock, type CaptureStatusModel } from "../hooks/useCaptureStatus";
   import { useWorkspaceNavigation } from "./workspaceNavigation";
   import { getCachedPlatform } from "../utils/platform";
   import { formatHotkeyLabel, parseHotkeyList } from "../utils/hotkeys";

   export default function CaptureControl({
     capture,
     hotkey,
     showChat,
   }: {
     capture: CaptureStatusModel;
     hotkey: string;
     showChat: boolean;
   }) {
     const navigation = useWorkspaceNavigation();
     const [lastAction, setLastAction] = useState<CaptureAction>(() => readLastCaptureAction(window.localStorage));
     const now = useLiveClock(capture.kind === "listening");

     const run = useCallback(
       (action: CaptureAction) => {
         setLastAction(action);
         try {
           window.localStorage.setItem(LAST_CAPTURE_ACTION_KEY, action);
         } catch {
           // not persisted; harmless
         }
         if (action === "dictate") void capture.toggleDictation();
         else if (action === "recordMeeting") navigation.recordMeeting();
         else if (action === "upload") navigation.openUpload();
         else if (action === "newNote") navigation.newNote();
         else navigation.startChat();
       },
       [capture, navigation]
     );

     return (
       <CaptureMenu
         status={capture}
         now={now}
         readLevel={capture.readLevel}
         lastAction={lastAction}
         hotkeyLabel={formatHotkeyLabel(parseHotkeyList(hotkey)[0])}
         platform={getCachedPlatform()}
         showChat={showChat}
         onRun={run}
         onStop={() => void capture.stop()}
       />
     );
   }
   ```

   `getCachedPlatform` is what `ControlPanel.tsx:64` already uses; copy its import path from there.

4. In `src/components/ControlPanel.tsx`:
   - Add `const capture = useCaptureStatus();` next to the other hooks, importing it from `../hooks/useCaptureStatus`. It is the only call in the app; Tasks 9 and 11 receive this object as a prop.
   - Change `handleNewNote` to:

     ```ts
     const handleNewNote = useCallback(
       async (options?: { record?: boolean }) => {
         await createNote(options);
         setActiveView("personal-notes");
       },
       [createNote]
     );
     ```

   - **Plan 05's after-setup intent effect stays directly after `handleNewNote`** (Plan 05 Task 18; Plan 05's `test/components/onboardingNoPreviewBranches.test.js` pins it with a source test). If Plan 05 has merged, `src/utils/afterSetupIntent.ts` exists and `ControlPanel.tsx` has `const intent = takeAfterSetupIntent();` in an effect that calls `handleNewNote()` or `setSettingsSection(intent.path); setShowSettings(true);`. Leave that effect, its position and its `[handleNewNote]` deps unchanged. `handleNewNote()` with no argument still records (`record` defaults to `true`, Task 7's `useCreateNote`), which is what the `dictate-note` intent needs. If Plan 05 has not merged, there is nothing to carry; Plan 05 adds the effect next to the new `handleNewNote` when it rebases.
   - In the `navigation` memo, use:

     ```ts
     newNote: () => void handleNewNote({ record: false }),
     recordMeeting: () => {
       // A live meeting already has a note; go to it rather than start a second recording.
       if (recordingNoteId != null) {
         if (recordingFolderId != null) setActiveFolderId(recordingFolderId);
         setActiveNoteId(recordingNoteId);
         setActiveView("personal-notes");
         return;
       }
       void handleNewNote({ record: true });
     },
     ```

     Add `recordingNoteId` and `recordingFolderId` to the memo deps.
   - Replace the `actions` prop at `:734-736` with:

     ```tsx
     actions={<CaptureControl capture={capture} hotkey={hotkey} showChat={navItems.some((item) => item.id === "chat")} />}
     ```

     Today `useControlPanelNavItems` never drops Chat, so `showChat` is always true. The prop keeps the existing `NewNoteMenu` contract ("omitted when policy turns the assistant off"), so a future policy filter on the nav items hides New chat for free.
   - Remove the `NewNoteMenu` import and add `import CaptureControl from "./CaptureControl";`.

5. Delete `src/components/notes/NewNoteMenu.tsx` and `test/components/newNoteMenu.test.js`. Then run `grep -rn "NewNoteMenu" src test`. It should return nothing.

6. Add strings (Task 1 helper). English block:

   ```json
   {
     "capture": {
       "group": "Capture",
       "moreOptions": "More capture options",
       "actions": {
         "dictate": "Dictate into Loqui",
         "recordMeeting": "Record meeting",
         "upload": "Upload audio…",
         "newNote": "New note",
         "newChat": "New chat"
       },
       "short": {
         "dictate": "Dictate",
         "recordMeeting": "Record",
         "upload": "Upload",
         "newNote": "New note",
         "newChat": "New chat"
       },
       "listening": "Listening {{time}}",
       "stopListening": "Stop listening",
       "stopRecording": "Stop recording",
       "cleaningUp": "Cleaning up…"
     }
   }
   ```

   Then remove the now-unused `notes.createMenu.note`, `notes.createMenu.assistantChat` and `notes.createMenu.chooseType` from every locale, but only if `grep -rn "notes.createMenu" src` shows no other users.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/captureMenu.test.js test/hooks/useCreateNoteRecord.test.js test/locales/translationCoverage.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/CaptureMenu.tsx src/components/CaptureControl.tsx src/components/notes/NewNoteMenu.tsx src/hooks/useCreateNote.ts src/components/ControlPanel.tsx src/locales test/components/captureMenu.test.js test/components/newNoteMenu.test.js test/hooks/useCreateNoteRecord.test.js
git commit -m "feat(workspace): replace New note with a Capture split button that shows live state"
```

---

### Task 8: Mic status card and sidebar edge rail

This covers the WS-R3 C live states in the sidebar (the R1 B footer "mic chip" and the C rail).

**Files:**
- Create: `src/components/MicStatusCard.tsx` (presentational)
- Modify: `src/index.css`. Append `.capture-rail` rules after the `.locality-ring` rules Plan 01 added.
- Test: `test/components/micStatusCard.test.js`, `test/components/captureRailCss.test.js`

**Interfaces:**
- Consumes `CaptureStatus`, `formatElapsed` and `railLevelStep` (Task 6); `LevelBars` (Plan 01); the `ResolvedRoute` type from `src/lib/routes.ts`; and `RouteDestinationChip` and `RouteStateChip` from `src/components/settings/routing/RouteChips.tsx` (§5.1, Plan 03). §5.1 says any surface that discloses a route uses these chips, so the card does not build its own ring-and-label line.
- Produces:

  ```ts
  export interface MicStatusCardProps {
    status: CaptureStatus;
    now: number;
    hotkeyLabel: string;
    role: CaptureRole;           // whose route this is (Task 6 captureRouteIds)
    route: Pick<ResolvedRoute, "locality" | "providerId" | "model" | "state"> | null; // the speech route
    textRoute?: Pick<ResolvedRoute, "locality" | "providerId" | "model" | "state"> | null; // assistant/translation
    compact: boolean;            // sidebar rail mode
    onOpenSettings: () => void;
  }
  export function MicStatusCard(props: MicStatusCardProps): JSX.Element;
  export interface CaptureRailProps { status: CaptureStatus; readLevel: () => number }
  export function CaptureRail(props: CaptureRailProps): JSX.Element; // aria-hidden 2px rail
  ```

- CSS contract: `.capture-rail[data-state]` with a `--capture-level` custom property that `CaptureRail` writes only while listening.

- [ ] **Step 1: Write the failing tests**

Create `test/components/micStatusCard.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { renderStatic } = require("../helpers/harness/reactSsr");

// Real English strings, so interpolated copy ("On this device · Parakeet v3") is asserted
// as people read it. Same set-up as meetingTranscriptChat.test.js.
async function load() {
  if (!i18next.isInitialized) {
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8"));
    await i18next.use(initReactI18next).init({
      lng: "en",
      resources: { en: { translation: en } },
      interpolation: { escapeValue: false },
    });
  }
  return import("../../src/components/MicStatusCard.tsx");
}
const base = {
  now: 10_000,
  readLevel: () => 0,
  hotkeyLabel: "Fn",
  role: "dictation",
  route: { locality: "device", providerId: null, model: "Parakeet v3", state: { status: "ready" } },
  compact: false,
  onOpenSettings: () => {},
};
const st = (kind, over = {}) => ({ kind, source: null, startedAt: null, offlineReason: null, ...over });

test("Ready shows the hotkey and where speech is processed", async () => {
  const { MicStatusCard } = await load();
  const html = renderStatic(MicStatusCard, { ...base, status: st("ready") });
  assert.match(html, /data-state="ready"/);
  assert.match(html, /role="status"[^>]*>Ready</);
  assert.match(html, />Fn</);
  assert.match(html, /data-locality="device"/);
  assert.match(html, /On this device · Parakeet v3/);
  assert.doesNotMatch(html, /data-state="(?:unknown|needs\w+|off|unreachable)"/, "a ready route adds no state chip");
});

test("Listening shows a live dot and a running clock", async () => {
  const { MicStatusCard } = await load();
  const html = renderStatic(MicStatusCard, {
    ...base,
    status: st("listening", { source: "dictation", startedAt: 3_000 }),
  });
  assert.match(html, /data-state="listening"/);
  assert.match(html, /data-elapsed="0:07"/);
  assert.match(html, /Listening 0:07/);
});

test("Offline is an icon plus words, never colour alone", async () => {
  const { MicStatusCard } = await load();
  const permission = renderStatic(MicStatusCard, { ...base, status: st("offline", { offlineReason: "permission" }) });
  assert.match(permission, /Mic offline/);
  assert.match(permission, /Microphone access is off/);
  assert.match(permission, /<svg[^>]*class="[^"]*text-warning/);
  const device = renderStatic(MicStatusCard, { ...base, status: st("offline", { offlineReason: "device" }) });
  assert.match(device, /Microphone disconnected/);
});

test("compact rail form keeps the state readable to assistive tech", async () => {
  const { MicStatusCard } = await load();
  const html = renderStatic(MicStatusCard, { ...base, compact: true, status: st("processing") });
  assert.match(html, /data-compact="true"/);
  assert.match(html, /class="sr-only"[^>]*>Cleaning up…/);
});

test("a route that is not ready keeps its destination and adds Plan 03's state chip", async () => {
  const { MicStatusCard } = await load();
  const html = renderStatic(MicStatusCard, {
    ...base,
    route: { locality: "remote", providerId: "openai", model: "gpt-4o-mini-transcribe", state: { status: "needsKey", provider: "openai" } },
    status: st("ready"),
  });
  assert.match(html, /OpenAI · gpt-4o-mini-transcribe/, "where speech would go is still disclosed");
  assert.match(html, /data-state="needsKey"/);
});

test("a route main has not confirmed yet is neutral, never ready (§5.1 unknown)", async () => {
  const { MicStatusCard } = await load();
  const html = renderStatic(MicStatusCard, {
    ...base,
    route: { locality: "device", providerId: null, model: "Parakeet v3", state: { status: "unknown" } },
    status: st("ready"),
  });
  assert.match(html, /data-state="unknown"/);
  assert.doesNotMatch(html, /text-destructive/, "checking is not a failure");
});

test("remote providers are named through providerDisplayLabel, localised for custom endpoints", async () => {
  const { MicStatusCard } = await load();
  const remote = (providerId, model) => ({ locality: "remote", providerId, model, state: { status: "ready" } });
  assert.match(renderStatic(MicStatusCard, { ...base, route: remote("openai", "gpt-4o-mini-transcribe"), status: st("ready") }), /OpenAI · gpt-4o-mini-transcribe/);
  assert.match(renderStatic(MicStatusCard, { ...base, route: remote("custom", "whisper-large"), status: st("ready") }), /Custom endpoint · whisper-large/);
  assert.match(renderStatic(MicStatusCard, { ...base, route: remote("acme", "x"), status: st("ready") }), /Unknown provider · x/);
  assert.doesNotMatch(renderStatic(MicStatusCard, { ...base, route: remote("acme", "x"), status: st("ready") }), /acme/);
});

test("a meeting shows the meeting route, not the dictation route (I13)", async () => {
  const { MicStatusCard } = await load();
  const html = renderStatic(MicStatusCard, {
    ...base,
    role: "meeting",
    route: { locality: "remote", providerId: "openai", model: "gpt-4o-transcribe", state: { status: "ready" } },
    status: st("listening", { source: "meeting", startedAt: 3_000 }),
  });
  assert.match(html, /Meeting<\/span>/);
  assert.match(html, /OpenAI · gpt-4o-transcribe/);
  assert.doesNotMatch(html, /Parakeet/);
});

test("an assistant capture also shows where its text goes", async () => {
  const { MicStatusCard } = await load();
  const html = renderStatic(MicStatusCard, {
    ...base,
    role: "assistant",
    textRoute: { locality: "remote", providerId: "anthropic", model: "Claude", state: { status: "ready" } },
    status: st("listening", { source: "dictation", inputKind: "assistant", startedAt: 3_000 }),
  });
  assert.match(html, /Dictation<\/span>[\s\S]*On this device · Parakeet v3/);
  assert.match(html, /Assistant<\/span>[\s\S]*Anthropic · Claude/);
});

test("the rail is decorative and carries its state for CSS", async () => {
  const { CaptureRail } = await load();
  const html = renderStatic(CaptureRail, { status: st("processing"), readLevel: () => 0 });
  assert.match(html, /class="capture-rail"/);
  assert.match(html, /data-state="processing"/);
  assert.match(html, /aria-hidden="true"/);
});
```

Create `test/components/captureRailCss.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const css = fs.readFileSync(path.join(__dirname, "../../src/index.css"), "utf8");
const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing rule ${selector}`);
  return match[1];
};

test("the idle rail is invisible and never animates", () => {
  const body = rule(".capture-rail");
  assert.match(body, /opacity:\s*0/);
  assert.doesNotMatch(body, /animation/);
});

test("listening opacity follows the level", () => {
  assert.match(rule('.capture-rail[data-state="listening"]'), /var\(--capture-level/);
});

test("only Cleaning up has a travelling highlight, and it is a loop gated to that state", () => {
  assert.match(rule('.capture-rail[data-state="processing"]::after'), /animation:\s*capture-rail-travel 1\.4s linear infinite/);
  const travelling = css.match(/animation:[^;]*capture-rail-travel/g) ?? [];
  assert.equal(travelling.length, 1);
});

test("offline is a solid warning rail; Cleaning up is amber, never live orange (D1)", () => {
  assert.match(rule('.capture-rail[data-state="offline"]'), /var\(--color-warning\)/);
  assert.match(rule('.capture-rail[data-state="processing"]'), /background:\s*var\(--color-warning\)/);
});

test("reduced motion removes travel and glow but keeps the state visible", () => {
  // index.css has several reduced-motion blocks; find the one that holds the
  // rail rules without letting the match run across another @media.
  const block = css.match(
    /@media \(prefers-reduced-motion: reduce\)\s*\{(?:(?!@media)[\s\S])*?\.capture-rail\[data-state="processing"\]::after\s*\{\s*display:\s*none;\s*\}(?:(?!@media)[\s\S])*?\.capture-rail\[data-state="listening"\]\s*\{[^}]*opacity:\s*1/
  );
  assert.ok(block, "one reduced-motion block hides the travelling band and holds the listening rail at full opacity");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/micStatusCard.test.js test/components/captureRailCss.test.js`
Expected: FAIL. The module is missing, and the rule `.capture-rail` is missing.

- [ ] **Step 3: Implement**

1. Create `src/components/MicStatusCard.tsx`:

   ```tsx
   import { useEffect, useRef } from "react";
   import { useTranslation } from "react-i18next";
   import { AlertTriangle, Loader2 } from "lucide-react";
   import { RouteDestinationChip, RouteStateChip } from "./settings/routing/RouteChips";
   import { formatElapsed, railLevelStep, type CaptureRole, type CaptureStatus } from "../lib/captureStatus";
   import type { ResolvedRoute } from "../lib/routes";

   export interface MicStatusCardProps {
     status: CaptureStatus;
     now: number;
     hotkeyLabel: string;
     role: CaptureRole;
     route: Pick<ResolvedRoute, "locality" | "providerId" | "model" | "state"> | null;
     textRoute?: Pick<ResolvedRoute, "locality" | "providerId" | "model" | "state"> | null;
     compact: boolean;
     onOpenSettings: () => void;
   }

   type RouteLike = NonNullable<MicStatusCardProps["route"]>;

   // One line per route: the role in words, then Plan 03's destination chip
   // (ring, provider through providerDisplayLabel, model). A route that is not
   // ready adds Plan 03's state chip; `unknown` reads "Checking…" and is never
   // shown as ready (§5.1 rule 1).
   function RouteLine({ role, route, t }: { role: string; route: RouteLike; t: (k: string) => string }) {
     return (
       <span className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
         <span className="shrink-0 text-foreground">{t(`micCard.role.${role}`)}</span>
         <RouteDestinationChip route={route} className="h-5 min-w-0 text-caption" />
         {route.state.status !== "ready" && <RouteStateChip state={route.state} className="h-5 px-0 text-caption" />}
       </span>
     );
   }

   const LABEL_KEY = {
     ready: "micCard.ready",
     listening: "micCard.listening",
     processing: "micCard.cleaningUp",
     offline: "micCard.offline",
   } as const;

   // Static glyphs. The live meter belongs to the Capture button and the edge
   // rail; Plan 01's motion rule allows at most two focal motions at once.
   function StateGlyph({ status }: Pick<MicStatusCardProps, "status">) {
     if (status.kind === "listening") return <span aria-hidden className="size-2 rounded-full bg-live" />;
     if (status.kind === "processing")
       return <Loader2 size={12} aria-hidden className="text-warning motion-safe:animate-spin" />;
     if (status.kind === "offline") return <AlertTriangle size={12} aria-hidden className="text-warning" />;
     return <span aria-hidden className="size-2 rounded-full bg-success" />;
   }

   export function MicStatusCard({ status, now, hotkeyLabel, role, route, textRoute, compact, onOpenSettings }: MicStatusCardProps) {
     const { t } = useTranslation();
     const elapsed = status.kind === "listening" && status.startedAt != null ? formatElapsed(now - status.startedAt) : null;
     const label = elapsed ? t("micCard.listeningFor", { time: elapsed }) : t(LABEL_KEY[status.kind]);
     const detail =
       status.kind === "offline"
         ? t(status.offlineReason === "device" ? "micCard.offlineDevice" : "micCard.offlinePermission")
         : null;

     if (compact) {
       return (
         <button
           type="button"
           onClick={onOpenSettings}
           data-state={status.kind}
           data-compact="true"
           title={label}
           className="mx-auto flex size-10 items-center justify-center rounded-md hover:bg-foreground/5"
         >
           <StateGlyph status={status} />
           <span className="sr-only" role="status" aria-live="polite">{label}</span>
         </button>
       );
     }

     return (
       <button
         type="button"
         onClick={onOpenSettings}
         data-state={status.kind}
         data-elapsed={elapsed ?? undefined}
         className="mx-2 mb-1 flex flex-col gap-1 rounded-lg border border-border/70 bg-background/60 px-2.5 py-2 text-start hover:bg-background dark:border-white/10"
       >
         <span className="flex items-center gap-2">
           <StateGlyph status={status} />
           <span role="status" aria-live="polite" className="flex-1 truncate text-ui tabular-nums text-foreground">
             {label}
           </span>
           {status.kind === "ready" && (
             <kbd dir="ltr" className="rounded-md bg-surface-3 px-1.5 text-micro text-foreground">{hotkeyLabel}</kbd>
           )}
         </span>
         {detail && <span className="text-caption text-muted-foreground">{detail}</span>}
         {route && <RouteLine role={role === "meeting" ? "meeting" : "dictation"} route={route} t={t} />}
         {textRoute && (role === "assistant" || role === "translation") && <RouteLine role={role} route={textRoute} t={t} />}
       </button>
     );
   }

   export interface CaptureRailProps {
     status: CaptureStatus;
     readLevel: () => number;
   }

   // WS-R3 C: a 2px rail on the sidebar's inline-end edge. The level reaches
   // CSS through --capture-level at 15 Hz, and only while listening.
   export function CaptureRail({ status, readLevel }: CaptureRailProps) {
     const ref = useRef<HTMLDivElement>(null);
     useEffect(() => {
       const el = ref.current;
       if (!el || status.kind !== "listening") return;
       if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
       let level = 0;
       const id = window.setInterval(() => {
         level = railLevelStep(level, readLevel());
         el.style.setProperty("--capture-level", String(level));
       }, 66);
       return () => {
         window.clearInterval(id);
         el.style.removeProperty("--capture-level");
       };
     }, [status.kind, readLevel]);
     return <div ref={ref} className="capture-rail" data-state={status.kind} aria-hidden="true" />;
   }
   ```

   The card's glyph is a static dot even while listening; the Capture button's `LevelBars` and the edge rail carry the live level.

2. Append to `src/index.css`, after the `.locality-ring` rules:

   ```css
   /* Capture rail (WS-R3 C). The sidebar edge breathes with the mic: idle is
      invisible, listening follows --capture-level in live orange, Cleaning up is
      amber with one band travelling down, offline is solid warning (the mic card
      names the reason). Orange appears only while the mic is live (D1). */
   .capture-rail {
     position: absolute;
     inset-block: 0;
     inset-inline-end: 0;
     width: 2px;
     overflow: hidden;
     pointer-events: none;
     opacity: 0;
     background: linear-gradient(to bottom, var(--color-live), var(--color-accent));
     transition: opacity var(--motion-fast) var(--motion-ease-std);
   }
   .capture-rail[data-state="listening"] {
     opacity: calc(0.25 + var(--capture-level, 0.4) * 0.75);
     box-shadow: 0 0 calc(var(--capture-level, 0) * 12px) rgb(255 90 31 / 0.45);
   }
   .capture-rail[data-state="processing"] {
     opacity: 0.7;
     background: var(--color-warning);
   }
   .capture-rail[data-state="processing"]::after {
     content: "";
     position: absolute;
     inset-inline: 0;
     top: 0;
     height: 120px;
     background: rgb(255 255 255 / 0.95);
     animation: capture-rail-travel 1.4s linear infinite;
   }
   .capture-rail[data-state="offline"] {
     opacity: 1;
     background: var(--color-warning);
   }
   @keyframes capture-rail-travel {
     from { transform: translateY(-120px); }
     to { transform: translateY(100vh); }
   }
   @media (prefers-reduced-motion: reduce) {
     .capture-rail[data-state="processing"]::after { display: none; }
     .capture-rail[data-state="listening"] { opacity: 1; box-shadow: none; }
   }
   ```

3. Add strings (Task 1 helper). English block:

   ```json
   {
     "micCard": {
       "ready": "Ready",
       "listening": "Listening",
       "listeningFor": "Listening {{time}}",
       "cleaningUp": "Cleaning up…",
       "offline": "Mic offline",
       "offlinePermission": "Microphone access is off",
       "offlineDevice": "Microphone disconnected",
       "role": { "dictation": "Dictation", "meeting": "Meeting", "assistant": "Assistant", "translation": "Translation" }
     }
   }
   ```

   Place, model and state words come from Plan 03's chips (`locality.*`, `routes.state.*`), so the card adds no route copy of its own.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/micStatusCard.test.js test/components/captureRailCss.test.js test/components/motionTokens.test.js`
Expected: PASS. Plan 01's motion test still passes, because no `cubic-bezier(0.4,0,1,1)` was added.

- [ ] **Step 5: Commit**

```bash
git add src/components/MicStatusCard.tsx src/index.css src/locales test/components/micStatusCard.test.js test/components/captureRailCss.test.js
git commit -m "feat(workspace): add the mic status card and the capture rail"
```

---

### Task 9: One sidebar with Spaces, a rail collapse and a breadcrumb

This covers WS-R1 B, the WS-Q2 top-bar title, and WS-17 (the breadcrumb shown in the R1 B and R6 B mocks).

**Files:**
- Create: `src/lib/sidebarMode.ts`, `src/lib/workspaceBreadcrumb.ts`, `src/stores/noteDeleteGuard.ts`, `src/hooks/useNoteTreeActions.ts`, `src/hooks/useRecentNotes.ts`
- Modify: `src/components/controlPanelNav.ts` (whole file, 44 lines)
- Modify: `src/hooks/useCollapsibleSidebar.ts` (whole file, 41 lines)
- Modify: `src/components/ControlPanelSidebar.tsx` (whole file, 96 lines)
- Modify: `src/components/ControlPanelTopBar.tsx`. Change the props (`:17-29`), the grid (`:48-58`), the title (`:93-95`) and the traffic-light padding (`:45`).
- Modify: `src/components/ControlPanel.tsx`. Change the sidebar spacer and absolute wrapper (`:696-722`), the `useCollapsibleSidebar` destructure (`:104-111`), `SIDEBAR_WIDTH_PX` (`:66`), and the `ControlPanelTopBar` props (`:725-736`).
- Modify: `src/components/notes/PersonalNotesView.tsx`. Remove the second column (`:689-716`), and swap the tree handlers (`:480-528`) for the hook.
- Modify: `src/components/notes/SpacesTree.tsx`. Add the `onNavigate?: () => void` prop.
- Test: `test/lib/sidebarMode.test.js`, `test/lib/workspaceBreadcrumb.test.js`, `test/stores/noteDeleteGuard.test.js`, `test/components/controlPanelNav.test.js`, `test/components/workspaceShellLayout.test.js`

**Interfaces:**
- Consumes:
  - `useCaptureStatus`/`CaptureStatusModel` (Task 6), received as the `capture` prop;
  - `MicStatusCard` and `CaptureRail` (Task 8);
  - `shortcutHint` (Task 4);
  - `useWorkspaceNavigation` (Task 3);
  - `useResolvedRoute("dictationStt")` (Plan 03, §5.1);
  - `useMeetingRecordingStore((s) => s.windowWidth)`.
- Produces `src/lib/sidebarMode.ts`:

  ```ts
  export type SidebarMode = "expanded" | "rail" | "hidden";
  export const SIDEBAR_EXPANDED_PX = 232;
  export const SIDEBAR_RAIL_PX = 56;
  export const SIDEBAR_AUTO_RAIL_BELOW_PX = 1100;
  export interface SidebarPreference { userCollapsed: boolean; narrowExpanded: boolean }
  export function resolveSidebarMode(input: SidebarPreference & { windowWidth: number; sidePanelLayout: boolean }): SidebarMode;
  export function nextSidebarPreference(input: SidebarPreference & { windowWidth: number }): SidebarPreference;
  export function sidebarWidth(mode: SidebarMode): number;
  ```

- Produces `src/lib/workspaceBreadcrumb.ts`: `buildWorkspaceBreadcrumb({ view, viewLabel, folderName?, noteTitle? }): string[]`.
- Produces `src/stores/noteDeleteGuard.ts`: `setBeforeNoteDelete(fn: (noteId: number) => void): () => void` and `runBeforeNoteDelete(noteId: number): void`.
- Produces `src/hooks/useNoteTreeActions.ts`: `useNoteTreeActions(): { onDeleteNote(id: number): Promise<void>; onMoveNote(noteId: number, target: NoteMoveTarget): Promise<void>; onCreateFolderAndMove(noteId: number, folderName: string): Promise<void>; onMoveToFolder(noteId: number, folderId: number): Promise<void> }`.
- Produces `src/hooks/useRecentNotes.ts`: `useRecentNotes(limit: number): NoteItem[]`. These are newest-updated first and refresh on note add, update and delete. Tasks 11 and 12 use it too.
- `useCollapsibleSidebar(sidePanelLayout: boolean): { mode: SidebarMode; toggle(): void }`. The hover peek is removed.
- `ControlPanelSidebar` props: `{ mode: SidebarMode; capture: CaptureStatusModel; activeView; onViewChange; onOpenSettings(section?: string) }`.
- `ControlPanelTopBar` props: `title` becomes `breadcrumb: string[]`, `sidebarCollapsed` becomes `sidebarMode: SidebarMode`, and `onToggleMouseEnter`/`onToggleMouseLeave` are removed.
- `controlPanelNav.ts`:
  - `ControlPanelNavSection` becomes `"primary" | "voice"`.
  - Items gain `shortcut?: WorkspaceAction`.
  - `upload` is no longer a nav item, but it is still a view.
  - It exports `viewTitleKey(view: ControlPanelView): string`.

- [ ] **Step 1: Write the failing tests**

Create `test/lib/sidebarMode.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/sidebarMode.ts");
const pref = (over = {}) => ({ userCollapsed: false, narrowExpanded: false, ...over });

test("wide windows show the full sidebar unless the user collapsed it", async () => {
  const { resolveSidebarMode } = await load();
  assert.equal(resolveSidebarMode({ ...pref(), windowWidth: 1280, sidePanelLayout: false }), "expanded");
  assert.equal(resolveSidebarMode({ ...pref({ userCollapsed: true }), windowWidth: 1280, sidePanelLayout: false }), "rail");
});

test("below 1100px the sidebar becomes a rail until the user expands it", async () => {
  const { resolveSidebarMode } = await load();
  assert.equal(resolveSidebarMode({ ...pref(), windowWidth: 1099, sidePanelLayout: false }), "rail");
  assert.equal(resolveSidebarMode({ ...pref({ narrowExpanded: true }), windowWidth: 900, sidePanelLayout: false }), "expanded");
});

test("meeting mode and narrow open notes hide it completely", async () => {
  const { resolveSidebarMode, sidebarWidth } = await load();
  const mode = resolveSidebarMode({ ...pref(), windowWidth: 1600, sidePanelLayout: true });
  assert.equal(mode, "hidden");
  assert.equal(sidebarWidth(mode), 0);
  assert.equal(sidebarWidth("rail"), 56);
  assert.equal(sidebarWidth("expanded"), 232);
});

test("the toggle always flips what you see", async () => {
  const { resolveSidebarMode, nextSidebarPreference } = await load();
  for (const windowWidth of [900, 1280]) {
    for (const start of [pref(), pref({ userCollapsed: true }), pref({ narrowExpanded: true })]) {
      const before = resolveSidebarMode({ ...start, windowWidth, sidePanelLayout: false });
      const after = resolveSidebarMode({ ...nextSidebarPreference({ ...start, windowWidth }), windowWidth, sidePanelLayout: false });
      assert.notEqual(after, before, `${windowWidth} ${JSON.stringify(start)}`);
    }
  }
});
```

Create `test/lib/workspaceBreadcrumb.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/workspaceBreadcrumb.ts");

test("Notes shows folder and note", async () => {
  const { buildWorkspaceBreadcrumb } = await load();
  assert.deepEqual(
    buildWorkspaceBreadcrumb({ view: "personal-notes", viewLabel: "Notes", folderName: "Work", noteTitle: "Product catch-up" }),
    ["Notes", "Work", "Product catch-up"]
  );
  assert.deepEqual(buildWorkspaceBreadcrumb({ view: "personal-notes", viewLabel: "Notes", folderName: "  ", noteTitle: null }), ["Notes"]);
});

test("other views are a single crumb", async () => {
  const { buildWorkspaceBreadcrumb } = await load();
  assert.deepEqual(buildWorkspaceBreadcrumb({ view: "chat", viewLabel: "Chat", folderName: "Work", noteTitle: "x" }), ["Chat"]);
});
```

Create `test/stores/noteDeleteGuard.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/stores/noteDeleteGuard.ts");

test("the open editor cancels its pending save before a tree delete", async () => {
  const { setBeforeNoteDelete, runBeforeNoteDelete } = await load();
  const seen = [];
  const release = setBeforeNoteDelete((id) => seen.push(id));
  runBeforeNoteDelete(9);
  release();
  runBeforeNoteDelete(10);
  assert.deepEqual(seen, [9]);
});

test("a stale cleanup never removes a newer guard", async () => {
  const { setBeforeNoteDelete, runBeforeNoteDelete } = await load();
  const seen = [];
  const releaseOld = setBeforeNoteDelete(() => seen.push("old"));
  setBeforeNoteDelete(() => seen.push("new"));
  releaseOld();
  runBeforeNoteDelete(1);
  assert.deepEqual(seen, ["new"]);
});
```

Create `test/components/controlPanelNav.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const load = () => import("../../src/components/controlPanelNav.ts");

test("Home, Notes, Chat lead with their shortcuts; Voice holds the rest; Upload left the sidebar", async () => {
  const { useControlPanelNavItems } = await load();
  let items;
  renderStatic(() => {
    items = useControlPanelNavItems();
    return null;
  }, null);
  assert.deepEqual(
    items.map((item) => [item.id, item.section, item.shortcut ?? null]),
    [
      ["home", "primary", "goHome"],
      ["personal-notes", "primary", "goNotes"],
      ["chat", "primary", "goChat"],
      ["dictionary", "voice", null],
      ["insights", "voice", null],
      ["integrations", "voice", null],
    ]
  );
  assert.equal(items.find((item) => item.id === "integrations").label, "sidebar.calendars");
});

test("every view, including Upload, still has a title", async () => {
  const { viewTitleKey } = await load();
  assert.equal(viewTitleKey("upload"), "sidebar.upload");
  assert.equal(viewTitleKey("integrations"), "sidebar.calendars");
});
```

Create `test/components/workspaceShellLayout.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");

test("Notes no longer adds a second navigation column", () => {
  const notes = read("src/components/notes/PersonalNotesView.tsx");
  assert.doesNotMatch(notes, /<SpacesTree/);
  assert.doesNotMatch(notes, /width: isSidePanelLayout \? 0 : "13rem"/);
  assert.match(read("src/components/ControlPanelSidebar.tsx"), /<SpacesTree/);
});

test("the title column keeps at least 120px (WS-Q2)", () => {
  assert.match(read("src/components/ControlPanelTopBar.tsx"), /grid-cols-\[minmax\(120px,1fr\)_minmax\(0,340px\)_minmax\(max-content,1fr\)\]/);
});

test("the sidebar footer carries the mic card and the edge carries the capture rail", () => {
  const sidebar = read("src/components/ControlPanelSidebar.tsx");
  assert.match(sidebar, /<MicStatusCard/);
  assert.match(sidebar, /<CaptureRail/);
});

test("the new sidebar keeps Plan 02's full-opacity focus rings (I14)", () => {
  const sidebar = read("src/components/ControlPanelSidebar.tsx");
  assert.ok((sidebar.match(/focus-visible:ring-2 focus-visible:ring-ring"/g) ?? []).length >= 3);
  assert.doesNotMatch(sidebar, /ring-(?:ring|primary)\/\d+/);
});

test("hover peek is gone; collapse is a rail", () => {
  const panel = read("src/components/ControlPanel.tsx");
  assert.doesNotMatch(panel, /sidebarPeek|showSidebarPeek|SIDEBAR_WIDTH_PX/);
  assert.match(panel, /sidebarWidth\(sidebarMode\)/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/lib/sidebarMode.test.js test/lib/workspaceBreadcrumb.test.js test/stores/noteDeleteGuard.test.js test/components/controlPanelNav.test.js test/components/workspaceShellLayout.test.js`
Expected: FAIL.
- Three suites fail with `Cannot find module`.
- `controlPanelNav` fails because the sections are still `workspace`/`library` and `upload` is still an item.
- The layout regexes fail.

- [ ] **Step 3: Implement**

1. Create `src/lib/sidebarMode.ts`:

   ```ts
   // WS-R1 B: one 232px sidebar that collapses to a 56px icon rail (manually,
   // or automatically below 1100px). Side-panel layout hides it entirely.
   export type SidebarMode = "expanded" | "rail" | "hidden";
   export const SIDEBAR_EXPANDED_PX = 232;
   export const SIDEBAR_RAIL_PX = 56;
   export const SIDEBAR_AUTO_RAIL_BELOW_PX = 1100;

   export interface SidebarPreference {
     /** Persisted: the user collapsed the sidebar in a wide window. */
     userCollapsed: boolean;
     /** Session only: the user expanded the rail in a narrow window. */
     narrowExpanded: boolean;
   }

   export function resolveSidebarMode(
     input: SidebarPreference & { windowWidth: number; sidePanelLayout: boolean }
   ): SidebarMode {
     if (input.sidePanelLayout) return "hidden";
     if (input.userCollapsed) return "rail";
     if (input.windowWidth < SIDEBAR_AUTO_RAIL_BELOW_PX && !input.narrowExpanded) return "rail";
     return "expanded";
   }

   export function nextSidebarPreference(
     input: SidebarPreference & { windowWidth: number }
   ): SidebarPreference {
     const mode = resolveSidebarMode({ ...input, sidePanelLayout: false });
     if (input.windowWidth < SIDEBAR_AUTO_RAIL_BELOW_PX) {
       return mode === "expanded"
         ? { userCollapsed: input.userCollapsed, narrowExpanded: false }
         : { userCollapsed: false, narrowExpanded: true };
     }
     return { userCollapsed: !input.userCollapsed, narrowExpanded: input.narrowExpanded };
   }

   export function sidebarWidth(mode: SidebarMode): number {
     return mode === "expanded" ? SIDEBAR_EXPANDED_PX : mode === "rail" ? SIDEBAR_RAIL_PX : 0;
   }
   ```

2. Create `src/lib/workspaceBreadcrumb.ts`:

   ```ts
   import type { ControlPanelView } from "../components/controlPanelNav";

   export function buildWorkspaceBreadcrumb(input: {
     view: ControlPanelView;
     viewLabel: string;
     folderName?: string | null;
     noteTitle?: string | null;
   }): string[] {
     const crumbs = [input.viewLabel];
     if (input.view === "personal-notes") {
       const folder = input.folderName?.trim();
       const note = input.noteTitle?.trim();
       if (folder) crumbs.push(folder);
       if (note) crumbs.push(note);
     }
     return crumbs.filter(Boolean);
   }
   ```

3. Create `src/stores/noteDeleteGuard.ts`:

   ```ts
   // The tree now lives in the sidebar, outside PersonalNotesView. The open
   // editor registers this guard so a tree delete cancels its pending save
   // first (previously handleDelete in PersonalNotesView did this inline).
   type Guard = (noteId: number) => void;
   let guard: Guard | null = null;

   export function setBeforeNoteDelete(next: Guard): () => void {
     guard = next;
     return () => {
       if (guard === next) guard = null;
     };
   }

   export function runBeforeNoteDelete(noteId: number): void {
     guard?.(noteId);
   }
   ```

4. Create `src/hooks/useNoteTreeActions.ts`. Move the bodies of `handleDelete`, `handleMoveNote`, `handleMoveToFolder` and `handleCreateFolderAndMove` from `PersonalNotesView.tsx:480-528` here verbatim, except that the pending-save cancel goes through the guard:

   ```ts
   import { useCallback, useMemo } from "react";
   import { useTranslation } from "react-i18next";
   import { useToast } from "../components/ui/useToast";
   import {
     createFolder,
     getNoteFromStore,
     revealContainer,
     setActiveContext,
     useActiveNoteId,
     useFolders,
     useSpaces,
   } from "../stores/noteStore";
   import { runBeforeNoteDelete } from "../stores/noteDeleteGuard";
   import type { NoteMoveTarget } from "../components/notes/SpacesTree";

   export function useNoteTreeActions() {
     const { t } = useTranslation();
     const { toast } = useToast();
     const activeNoteId = useActiveNoteId();
     const folders = useFolders();
     const spaces = useSpaces();
     const privateSpaceId = useMemo(() => spaces.find((s) => s.kind === "private")?.id ?? null, [spaces]);

     const onDeleteNote = useCallback(async (id: number) => {
       runBeforeNoteDelete(id);
       await window.electronAPI.deleteNote(id);
     }, []);

     const onMoveNote = useCallback(
       async (noteId: number, target: NoteMoveTarget) => {
         await window.electronAPI.updateNote(noteId, { folder_id: target.folderId, space_id: target.spaceId });
         if (noteId === activeNoteId) {
           setActiveContext(target.spaceId, target.folderId);
           revealContainer(target.spaceId, target.folderId);
         }
       },
       [activeNoteId]
     );

     const onMoveToFolder = useCallback(
       async (noteId: number, folderId: number) => {
         const folder = folders.find((f) => f.id === folderId);
         if (!folder) return;
         await onMoveNote(noteId, { spaceId: folder.space_id, folderId });
       },
       [folders, onMoveNote]
     );

     const onCreateFolderAndMove = useCallback(
       async (noteId: number, folderName: string) => {
         const spaceId = getNoteFromStore(noteId)?.space_id ?? privateSpaceId;
         if (spaceId == null) return;
         const result = await createFolder(folderName, spaceId);
         if (result.success && result.folder) {
           await onMoveToFolder(noteId, result.folder.id);
         } else if (result.error) {
           toast({ title: t("notes.folders.couldNotCreate"), description: result.error, variant: "destructive" });
         }
       },
       [privateSpaceId, onMoveToFolder, toast, t]
     );

     return { onDeleteNote, onMoveNote, onMoveToFolder, onCreateFolderAndMove };
   }
   ```

   `NoteMoveTarget` is the type `SpacesTree` already uses for `onMoveNote`. Import it from where `PersonalNotesView.tsx` imports it today.

5. Create `src/hooks/useRecentNotes.ts`:

   ```ts
   import { useEffect, useState } from "react";
   import type { NoteItem } from "../types/electron";

   // getNotes(null, limit) with no folder or space is every personal note,
   // ordered updated_at DESC (database.js:1097-1124).
   export function useRecentNotes(limit: number): NoteItem[] {
     const [notes, setNotes] = useState<NoteItem[]>([]);
     useEffect(() => {
       let alive = true;
       const api = window.electronAPI;
       const load = () => {
         void api
           ?.getNotes(null, limit)
           .then((rows) => {
             if (alive) setNotes(rows ?? []);
           })
           .catch(() => {});
       };
       load();
       const offs = [api?.onNoteAdded?.(load), api?.onNoteUpdated?.(load), api?.onNoteDeleted?.(load)];
       return () => {
         alive = false;
         for (const off of offs) off?.();
       };
     }, [limit]);
     return notes;
   }
   ```

   Check the exact listener names in `src/types/electron.ts:1114+` (`onNoteAdded`, `onNoteUpdated`, `onNoteDeleted`). If one is typed with a payload, the zero-arg `load` still fits.

6. Replace `src/components/controlPanelNav.ts` with:

   ```ts
   import { useTranslation } from "react-i18next";
   import { BarChart3, BookOpen, CalendarDays, Home, MessageSquare, NotebookPen } from "./icons";
   import type { WorkspaceAction } from "../lib/workspaceShortcuts";

   export type ControlPanelView =
     "home" | "insights" | "chat" | "personal-notes" | "dictionary" | "upload" | "integrations";

   export type ControlPanelNavSection = "primary" | "voice";

   export interface ControlPanelNavItem {
     id: ControlPanelView;
     label: string;
     icon: React.ComponentType<{ size?: number; className?: string }>;
     section: ControlPanelNavSection;
     shortcut?: WorkspaceAction;
   }

   const TITLE_KEYS: Record<ControlPanelView, string> = {
     home: "sidebar.home",
     "personal-notes": "sidebar.notes",
     chat: "sidebar.chat",
     dictionary: "sidebar.dictionary",
     insights: "sidebar.insights",
     integrations: "sidebar.calendars",
     upload: "sidebar.upload",
   };

   export const viewTitleKey = (view: ControlPanelView): string => TITLE_KEYS[view];

   // WS-R1 B: Home, Notes, Chat first (⌘1–3); Voice holds the tools. Upload is
   // an action now (Capture, ⌘⇧U, palette), not a place.
   export function useControlPanelNavItems(): ControlPanelNavItem[] {
     const { t } = useTranslation();
     return [
       { id: "home", label: t(TITLE_KEYS.home), icon: Home, section: "primary", shortcut: "goHome" },
       { id: "personal-notes", label: t(TITLE_KEYS["personal-notes"]), icon: NotebookPen, section: "primary", shortcut: "goNotes" },
       { id: "chat", label: t(TITLE_KEYS.chat), icon: MessageSquare, section: "primary", shortcut: "goChat" },
       { id: "dictionary", label: t(TITLE_KEYS.dictionary), icon: BookOpen, section: "voice" },
       { id: "insights", label: t(TITLE_KEYS.insights), icon: BarChart3, section: "voice" },
       { id: "integrations", label: t(TITLE_KEYS.integrations), icon: CalendarDays, section: "voice" },
     ];
   }
   ```

   If `./icons` does not re-export `CalendarDays`, add it to that file next to `Blocks`. The `Upload` and `Blocks` imports may become unused; delete them. If today's hook filters items (for example, dropping Chat when policy disables the assistant), keep that filter. The `controlPanelNav` test then needs the policy default, so assert on the default-policy list.

7. Replace `src/hooks/useCollapsibleSidebar.ts` with:

   ```ts
   import { useCallback, useState } from "react";
   import { useMeetingRecordingStore } from "../stores/meetingRecordingStore";
   import { nextSidebarPreference, resolveSidebarMode, type SidebarMode } from "../lib/sidebarMode";

   const STORAGE_KEY = "sidebarCollapsed";

   export function useCollapsibleSidebar(sidePanelLayout: boolean): { mode: SidebarMode; toggle: () => void } {
     const windowWidth = useMeetingRecordingStore((s) => s.windowWidth);
     const [pref, setPref] = useState(() => ({
       userCollapsed: localStorage.getItem(STORAGE_KEY) === "true",
       narrowExpanded: false,
     }));
     const mode = resolveSidebarMode({ ...pref, windowWidth, sidePanelLayout });
     const toggle = useCallback(() => {
       setPref((current) => {
         const next = nextSidebarPreference({ ...current, windowWidth });
         localStorage.setItem(STORAGE_KEY, String(next.userCollapsed));
         return next;
       });
     }, [windowWidth]);
     return { mode, toggle };
   }
   ```

8. Replace `src/components/ControlPanelSidebar.tsx` with:

   ```tsx
   import { Fragment } from "react";
   import { useTranslation } from "react-i18next";
   import { Settings } from "./icons";
   import { LoquiBrand } from "./LoquiBrand";
   import { Tooltip } from "./ui/tooltip";
   import { cn } from "./lib/utils";
   import { MicStatusCard, CaptureRail } from "./MicStatusCard";
   import SpacesTree from "./notes/SpacesTree";
   import { useControlPanelNavItems, type ControlPanelView } from "./controlPanelNav";
   import { useWorkspaceNavigation } from "./workspaceNavigation";
   import { useLiveClock, type CaptureStatusModel } from "../hooks/useCaptureStatus";
   import { useCreateNote } from "../hooks/useCreateNote";
   import { useHotkey } from "../hooks/useHotkey";
   import { useNoteTreeActions } from "../hooks/useNoteTreeActions";
   import { useRecentNotes } from "../hooks/useRecentNotes";
   import { ROUTE_IDS, useResolvedRoutes } from "../lib/routes";
   import { captureRouteIds } from "../lib/captureStatus";
   import { shortcutHint } from "../lib/workspaceShortcuts";
   import type { SidebarMode } from "../lib/sidebarMode";
   import { formatHotkeyLabel, parseHotkeyList } from "../utils/hotkeys";
   import { getCachedPlatform } from "../utils/platform";

   interface Props {
     mode: SidebarMode;
     capture: CaptureStatusModel;
     activeView: ControlPanelView;
     onViewChange: (view: ControlPanelView) => void;
     onOpenSettings: (section?: string) => void;
   }

   const RECENT_LIMIT = 4;

   export default function ControlPanelSidebar({ mode, capture, activeView, onViewChange, onOpenSettings }: Props) {
     const { t } = useTranslation();
     const platform = getCachedPlatform();
     const isMac = platform === "darwin";
     const rail = mode === "rail";
     const navItems = useControlPanelNavItems();
     const navigation = useWorkspaceNavigation();
     // The card shows the routes this capture really takes: the meeting route
     // during a meeting, plus the text route for assistant/translation (I13).
     const routes = useResolvedRoutes();
     const ids = captureRouteIds(capture);
     const routeFor = (id: (typeof ROUTE_IDS)[number]) => routes[ROUTE_IDS.indexOf(id)];
     const route = routeFor(ids.speech);
     const textRoute = ids.text ? routeFor(ids.text) : null;
     const { hotkey } = useHotkey();
     const treeActions = useNoteTreeActions();
     const { createNoteIn } = useCreateNote();
     const recent = useRecentNotes(RECENT_LIMIT);
     const now = useLiveClock(capture.kind === "listening");

     const row = (item: (typeof navItems)[number]) => {
       const isActive = activeView === item.id;
       const Icon = item.icon;
       const hint = item.shortcut ? ` ${shortcutHint(item.shortcut, platform)}` : "";
       return (
         <Tooltip key={item.id} content={`${item.label}${hint}`}>
           <button
             type="button"
             onClick={() => onViewChange(item.id)}
             aria-current={isActive ? "page" : undefined}
             aria-label={rail ? item.label : undefined}
             className={cn(
               "group relative flex h-9 items-center gap-2.5 rounded-md text-ui text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
               "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
               rail ? "mx-auto w-10 justify-center" : "px-2.5",
               isActive && "bg-foreground/7 text-foreground dark:bg-white/8"
             )}
           >
             <span
               aria-hidden
               className={cn(
                 "absolute start-0 top-2 bottom-2 w-0.5 rounded-full bg-nav-marker opacity-0",
                 isActive && "opacity-100"
               )}
             />
             <Icon size={16} className={isActive ? "text-nav-marker" : undefined} />
             {!rail && <span className="truncate">{item.label}</span>}
           </button>
         </Tooltip>
       );
     };

     const section = (labelKey: string, children: React.ReactNode) => (
       <div className="flex flex-col gap-0.5">
         {!rail && <div className="px-2.5 pb-1 text-caption font-semibold text-muted-foreground">{t(labelKey)}</div>}
         {children}
       </div>
     );

     return (
       <div className="relative flex h-full flex-col bg-surface-window" style={{ width: "100%" }}>
         <div
           className={cn("shrink-0 flex items-end gap-2 px-3 pb-2.5", isMac ? "h-20" : "h-12")}
           style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
         >
           {!rail && <LoquiBrand variant="wordmark" />}
         </div>

         <nav aria-label={t("sidebar.navigation")} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pt-1">
           <div className="flex flex-col gap-0.5">{navItems.filter((i) => i.section === "primary").map(row)}</div>

           {!rail &&
             section(
               "sidebar.sections.spaces",
               <SpacesTree
                 onDeleteNote={treeActions.onDeleteNote}
                 onMoveNote={treeActions.onMoveNote}
                 onCreateFolderAndMove={treeActions.onCreateFolderAndMove}
                 onNewNote={(spaceId, folderId) => {
                   void createNoteIn(spaceId, folderId);
                   onViewChange("personal-notes");
                 }}
                 onNavigate={() => onViewChange("personal-notes")}
               />
             )}

           {!rail &&
             recent.length > 0 &&
             section(
               "sidebar.sections.recent",
               recent.map((note) => (
                 <button
                   key={note.id}
                   type="button"
                   onClick={() => navigation.openNote(note.id)}
                   className="h-7 truncate rounded-md px-2.5 text-start text-ui text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                 >
                   <span dir="auto">{note.title || t("notes.list.untitledNote")}</span>
                 </button>
               ))
             )}

           {section(
             "sidebar.sections.voice",
             <Fragment>{navItems.filter((i) => i.section === "voice").map(row)}</Fragment>
           )}
         </nav>

         <div className="shrink-0 pt-2">
           <MicStatusCard
             status={capture}
             now={now}
             hotkeyLabel={formatHotkeyLabel(parseHotkeyList(hotkey)[0])}
             role={ids.role}
             route={route}
             textRoute={textRoute}
             compact={rail}
             onOpenSettings={() => onOpenSettings(route.settingsPath)}
           />
           <button
             type="button"
             onClick={() => onOpenSettings()}
             aria-label={rail ? t("sidebar.settings") : undefined}
             className={cn(
               "mb-2 flex h-9 items-center gap-2.5 rounded-md text-ui text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
               "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
               rail ? "mx-auto w-10 justify-center" : "mx-2 px-2.5"
             )}
           >
             <Settings size={16} />
             {!rail && t("sidebar.settings")}
           </button>
         </div>

         <CaptureRail status={capture} readLevel={capture.readLevel} />
       </div>
     );
   }
   ```

   Notes for the implementer:
   - Keep `LoquiBrand`'s import path and the drag-region style from the old file (`:23-32`).
   - In rail mode the 80px macOS header stays, so the traffic lights sit above the icons.
   - `bg-nav-marker`/`text-nav-marker` come from Plan 01 Task 3, which already changed the old file's `:64` and `:73`.

9. In `src/components/notes/SpacesTree.tsx`, add `onNavigate?: () => void;` to `Props` (`:36-42`) and destructure it. Find every handler that changes what the editor shows: `grep -n "setActiveNoteId(\|navigateToContainer(" src/components/notes/SpacesTree.tsx`. Call `onNavigate?.()` as the last statement of each one. This switches the view to Notes when a tree row is clicked from Home or Chat.

10. In `src/components/ControlPanelTopBar.tsx`:
    - Props: replace `title: string` with `breadcrumb: string[]`, replace `sidebarCollapsed: boolean` with `sidebarMode: SidebarMode`, and delete `onToggleMouseEnter` and `onToggleMouseLeave`, along with their uses on the toggle button.
    - `:45`: `const clearTrafficLights = platform === "darwin" && sidebarMode !== "expanded";`
    - Grid class (`:50`): `grid-cols-[minmax(120px,1fr)_minmax(0,340px)_minmax(max-content,1fr)]`.
    - Padding: replace `clearTrafficLights && "ltr:ps-[76px]"` with `clearTrafficLights && (sidebarMode === "rail" ? "ltr:ps-5" : "ltr:ps-[76px]")`. The 56px rail plus the 8px main padding covers most of the traffic-light width.
    - Toggle icon: `sidebarMode === "expanded" ? PanelLeftClose : PanelLeftOpen`. Use `aria-label`/tooltip `` `${t(sidebarMode === "expanded" ? "sidebar.collapse" : "sidebar.expand")} ${shortcutHint("toggleSidebar", platform)}` ``.
    - Replace the `<h1>` at `:93-95` with:

      ```tsx
      <nav aria-label={t("controlPanel.breadcrumb")} className="flex min-w-0 items-center gap-1.5">
        {breadcrumb.slice(0, -1).map((crumb, index) => (
          <Fragment key={`${index}-${crumb}`}>
            <span dir="auto" className="max-w-40 truncate text-ui text-muted-foreground">{crumb}</span>
            <span aria-hidden className="text-ui text-muted-foreground">/</span>
          </Fragment>
        ))}
        <h1 dir="auto" className="truncate text-ui! font-medium! leading-none! tracking-normal! text-foreground">
          {breadcrumb.at(-1)}
        </h1>
      </nav>
      ```

11. In `src/components/ControlPanel.tsx`:
    - Delete `SIDEBAR_WIDTH_PX` (`:66`).
    - Replace the `useCollapsibleSidebar` destructure with `const { mode: sidebarMode, toggle: toggleSidebar } = useCollapsibleSidebar(isSidePanelLayout);`. Move it below the `isSidePanelLayout` line.
    - `const capture = useCaptureStatus();` already exists from Task 7. Pass the same object to the sidebar.
    - Add `useEffect(() => { initializeNotesTree(); }, []);`, because the tree now renders on every view. Import `initializeNotesTree` from `../stores/noteStore`.
    - Replace the spacer `<div>` and the absolute sidebar wrapper (`:697-722`) with:

      ```tsx
      <div
        className="relative shrink-0 overflow-hidden transition-[width] duration-(--motion-base) ease-(--motion-ease-std)"
        style={{ width: sidebarWidth(sidebarMode) }}
        inert={sidebarMode === "hidden"}
      >
        <ControlPanelSidebar
          mode={sidebarMode}
          capture={capture}
          activeView={activeView}
          onViewChange={setActiveView}
          onOpenSettings={navigation.openSettings}
        />
      </div>
      ```

    - Build the breadcrumb:

      ```ts
      const activeNote = useActiveNote();
      const activeFolderId = useActiveFolderId();
      const folders = useFolders();
      const breadcrumb = buildWorkspaceBreadcrumb({
        view: activeView,
        viewLabel: t(viewTitleKey(activeView)),
        folderName: folders.find((folder) => folder.id === activeFolderId)?.name ?? null,
        noteTitle: activeNote ? activeNote.title || t("notes.list.untitledNote") : null,
      });
      ```

      Pass `breadcrumb={breadcrumb}` and `sidebarMode={sidebarMode}` to `ControlPanelTopBar`, and drop the removed props. `CaptureControl` already receives `capture` (Task 7).

12. In `src/components/notes/PersonalNotesView.tsx`:
    - Replace the `handleDelete`, `handleMoveNote`, `handleMoveToFolder` and `handleCreateFolderAndMove` definitions (`:480-528`) with:

      ```ts
      const {
        onDeleteNote: handleDelete,
        onMoveNote: handleMoveNote,
        onMoveToFolder: handleMoveToFolder,
        onCreateFolderAndMove: handleCreateFolderAndMove,
      } = useNoteTreeActions();

      // The tree lives in the sidebar; a delete there must still cancel this
      // editor's pending save for the same note.
      useEffect(
        () =>
          setBeforeNoteDelete((id) => {
            if (shouldCancelPendingSavesForDelete(draftRef.current?.noteId ?? null, id)) cancelPendingSaves(id);
          }),
        [cancelPendingSaves]
      );
      ```

    - Replace the outer layout (`:688-717`, from `<div className="flex h-full">` through the closing `</div>` of the tree column) so the editor column is the only child: `<div className="flex h-full"><div className="flex-1 flex flex-col min-w-0 min-h-0">…`.
    - The **Actions** button goes with the column. The Action manager is still reachable from the `ActionPicker`'s manage entry and from the slash menu (Task 15); both call Plan 02's `openActions`, so the Actions first run still shows once. Keep `openActions`, `finishActionsIntro`, the hoisted `<ActionManagerDialog>` and the intro `<Dialog>` exactly as Plan 02 Task 14 left them.
    - **Plan 02's Actions hint row moves, it is not deleted.** Move the `{shouldShowActionsModelHint(noteActionsReady, modelHintDismissed) && (…)}` block, unchanged, to the top of the editor column: the first child of `<div className="flex-1 flex flex-col min-w-0 min-h-0">`, wrapped in `<div className="px-3 pt-2">`. Plan 02's `notesActionsGate.test.js` keeps passing. Task 26 replaces its readiness source with the route (§5.1).
    - Remove the imports that are now unused (`SpacesTree`, `Sparkles` if unused). Keep `initializeNotesTree()` at `:283`; a second call is harmless.

13. In `DESIGN.md` `### Navigation` (around lines 203-206), replace the three bullets with the following (D10):

    ```markdown
    - **Sidebar:** 232px. Home, Notes, Chat (⌘1–3), then Spaces (the notes tree), Recent (4) and Voice (Dictionary, Insights, Calendars). The footer holds the mic status card (Ready / Listening m:ss / Cleaning up… / Mic offline) and Settings. A 2px capture rail on its inline-end edge follows the mic level while listening. The active row uses `--color-nav-marker`.
    - **Collapsed:** a 56px icon rail (⌘\, or automatically below 1100px). There is no hover peek. Meeting mode and narrow open notes hide the sidebar and show "Back to notes".
    - **Top bar:** 48px draggable title area with a breadcrumb (`Notes / Work / Product catch-up`, title column at least 120px), centred search (⌘K), and the Capture split button. Capture is neutral at rest and turns `live` only while listening.
    ```

14. Add strings (Task 1 helper). English block:

    ```json
    {
      "sidebar": {
        "calendars": "Calendars",
        "sections": { "spaces": "Spaces", "recent": "Recent", "voice": "Voice" }
      },
      "controlPanel": { "breadcrumb": "Location" }
    }
    ```

    Remove `sidebar.sections.workspace`, `sidebar.sections.library` and `sidebar.integrations` from every locale, but only if `grep -rn "sections.workspace\|sections.library\|sidebar.integrations" src` finds nothing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/lib/sidebarMode.test.js test/lib/workspaceBreadcrumb.test.js test/stores/noteDeleteGuard.test.js test/components/controlPanelNav.test.js test/components/workspaceShellLayout.test.js test/components/spacesTreeDirection.test.js test/components/spacesTreeNoteActionClearance.test.js test/locales/translationCoverage.test.js && npm run typecheck && npm run lint`
Expected: PASS. The existing SpacesTree suites still pass.

- [ ] **Step 5: Commit**

```bash
git add DESIGN.md src/lib/sidebarMode.ts src/lib/workspaceBreadcrumb.ts src/stores/noteDeleteGuard.ts src/hooks/useNoteTreeActions.ts src/hooks/useRecentNotes.ts src/hooks/useCollapsibleSidebar.ts src/components/controlPanelNav.ts src/components/icons* src/components/ControlPanelSidebar.tsx src/components/ControlPanelTopBar.tsx src/components/ControlPanel.tsx src/components/notes/PersonalNotesView.tsx src/components/notes/SpacesTree.tsx src/locales test/lib/sidebarMode.test.js test/lib/workspaceBreadcrumb.test.js test/stores/noteDeleteGuard.test.js test/components/controlPanelNav.test.js test/components/workspaceShellLayout.test.js
git commit -m "feat(workspace): one sidebar with Spaces, a rail collapse and a breadcrumb"
```

---

### Task 10: Home feed model: filters, in-view search and sessions

This covers the WS-R4 B logic and interpretation 4.

**Files:**
- Create: `src/lib/homeFeed.ts`
- Test: `test/lib/homeFeed.test.js`

**Interfaces:**
- Consumes `HomeFilter` (Task 3), `TranscriptionItem` and `NoteItem` (`src/types/electron.ts`), and the `Locality` type (Plan 01).
- Produces:

  ```ts
  export const SESSION_GAP_MS = 300_000;
  export type HomeEntry =
    | { kind: "dictation"; key: string; at: number; item: TranscriptionItem; words: number }
    | { kind: "session"; key: string; at: number; items: TranscriptionItem[]; words: number; durationMs: number }
    | { kind: "note"; key: string; at: number; note: NoteItem }
    | { kind: "meeting"; key: string; at: number; note: NoteItem };
  export interface HomeDayGroup { dayKey: string; at: number; entries: HomeEntry[]; captures: number; words: number }
  export interface HomeFeed {
    groups: HomeDayGroup[];
    counts: Record<HomeFilter, number>;  // after the search, before the chip
    rows: number;                        // entries after folding
    captures: number;                    // dictations shown, folded or not
  }
  export function parseDbTimestamp(value: string | null | undefined): number; // SQLite UTC without "Z"
  export function countWords(text: string | null | undefined): number;       // Intl.Segmenter word-like segments
  export function localDayKey(ms: number): string;                           // "2026-10-14"
  export function buildHomeFeed(input: { transcriptions: TranscriptionItem[]; notes: NoteItem[]; filter: HomeFilter; query: string; sessionGapMs?: number }): HomeFeed;
  export function locateTranscript(feed: HomeFeed, transcriptId: number): { dayKey: string; entryKey: string; inSession: boolean } | null;
  export function transcriptionLocality(provider: string | null | undefined): { locality: Locality; providerId: string | null } | null;
  // providerId is the raw id for providerDisplayLabel(providerId, t); null unless remote
  ```

- Rules:
  - Notes and meetings sort by `updated_at`. Dictations sort by `timestamp`.
  - Only adjacent completed dictations on the same day, at most `SESSION_GAP_MS` apart, fold into a session, and a session needs two or more of them. Failed, discarded and pending rows never fold, and a note between two dictations breaks the run.

- [ ] **Step 1: Write the failing test**

Create `test/lib/homeFeed.test.js`:

```js
// Day grouping is local-time; pin the zone so a run in UTC+10 cannot split a day.
process.env.TZ = "UTC";
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/homeFeed.ts");

// SQLite stores UTC without a zone; these mimic real rows.
const dictation = (id, timestamp, text, over = {}) => ({
  id,
  text,
  raw_text: null,
  timestamp,
  created_at: timestamp,
  has_audio: 1,
  audio_duration_ms: 7000,
  provider: "local-parakeet",
  model: "parakeet-v3",
  status: "completed",
  error_message: null,
  error_code: null,
  client_transcription_id: `c${id}`,
  cloud_id: null,
  sync_status: "synced",
  deleted_at: null,
  ...over,
});
const note = (id, updated_at, title, note_type = "personal", content = "") => ({
  id,
  title,
  content,
  note_type,
  folder_id: 1,
  space_id: 1,
  created_at: updated_at,
  updated_at,
});

test("dictations within five minutes fold into one session; a longer gap starts a new row", async () => {
  const { buildHomeFeed } = await load();
  const feed = buildHomeFeed({
    transcriptions: [
      dictation(4, "2026-10-14 14:09:00", "Ok so the pricing tiers need names before Thursday."),
      dictation(3, "2026-10-14 14:07:00", "Starter, Studio, and what's the third one."),
      dictation(2, "2026-10-14 14:02:00", "Also the FAQ needs a line on local transcription."),
      dictation(1, "2026-10-14 13:40:00", "Earlier thought."),
    ],
    notes: [],
    filter: "all",
    query: "",
  });
  const entries = feed.groups.flatMap((g) => g.entries);
  assert.deepEqual(entries.map((e) => e.kind), ["session", "dictation"]);
  assert.deepEqual(entries[0].items.map((i) => i.id), [4, 3, 2]);
  assert.equal(entries[0].durationMs, 21000);
  assert.equal(feed.rows, 2);
  assert.equal(feed.captures, 4);
});

test("failed and discarded rows stay visible on their own and are counted", async () => {
  const { buildHomeFeed } = await load();
  const feed = buildHomeFeed({
    transcriptions: [
      dictation(3, "2026-10-14 09:32:00", "ok"),
      dictation(2, "2026-10-14 09:31:00", "", { status: "failed", error_code: "TIMEOUT" }),
      dictation(1, "2026-10-14 09:30:00", "kept", { status: "discarded" }),
    ],
    notes: [],
    filter: "all",
    query: "",
  });
  assert.deepEqual(feed.groups[0].entries.map((e) => e.kind), ["dictation", "dictation", "dictation"]);
  assert.equal(feed.counts.failed, 1);
});

test("a note between two dictations breaks the session", async () => {
  const { buildHomeFeed } = await load();
  const feed = buildHomeFeed({
    transcriptions: [dictation(2, "2026-10-14 10:04:00", "b"), dictation(1, "2026-10-14 10:00:00", "a")],
    notes: [note(9, "2026-10-14 10:02:00", "Pricing FAQ draft")],
    filter: "all",
    query: "",
  });
  assert.deepEqual(feed.groups[0].entries.map((e) => e.kind), ["dictation", "note", "dictation"]);
});

test("chips filter by kind; counts follow the search, not the chip", async () => {
  const { buildHomeFeed } = await load();
  const input = {
    transcriptions: [
      dictation(2, "2026-10-14 12:00:00", "pricing goes out Thursday"),
      dictation(1, "2026-10-14 08:00:00", "standup", { status: "failed" }),
    ],
    notes: [
      note(7, "2026-10-14 11:00:00", "Pricing review", "meeting"),
      note(8, "2026-10-14 10:00:00", "Groceries"),
    ],
    query: "PRICING",
  };
  const meetings = buildHomeFeed({ ...input, filter: "meetings" });
  assert.deepEqual(meetings.groups.flatMap((g) => g.entries).map((e) => e.key), ["meeting-7"]);
  assert.deepEqual(meetings.counts, { all: 2, dictations: 1, meetings: 1, notes: 0, failed: 0 });
  const failed = buildHomeFeed({ ...input, query: "  ", filter: "failed" });
  assert.deepEqual(failed.groups.flatMap((g) => g.entries).map((e) => e.key), ["dictation-1"]);
});

test("an empty result has no groups", async () => {
  const { buildHomeFeed } = await load();
  const feed = buildHomeFeed({ transcriptions: [dictation(1, "2026-10-14 08:00:00", "hello")], notes: [], filter: "all", query: "zebra" });
  assert.deepEqual(feed.groups, []);
  assert.equal(feed.rows, 0);
});

test("day groups total captures and words", async () => {
  const { buildHomeFeed } = await load();
  const feed = buildHomeFeed({
    transcriptions: [dictation(2, "2026-10-14 12:00:00", "one two three"), dictation(1, "2026-10-12 12:00:00", "four five")],
    notes: [],
    filter: "all",
    query: "",
  });
  assert.equal(feed.groups.length, 2);
  assert.deepEqual([feed.groups[0].captures, feed.groups[0].words], [1, 3]);
});

test("a transcript folded inside a session can be located for a deep link", async () => {
  const { buildHomeFeed, locateTranscript } = await load();
  const feed = buildHomeFeed({
    transcriptions: [dictation(3, "2026-10-14 14:04:00", "c"), dictation(2, "2026-10-14 14:02:00", "b"), dictation(1, "2026-10-14 09:00:00", "a")],
    notes: [],
    filter: "all",
    query: "",
  });
  assert.equal(locateTranscript(feed, 2).inSession, true);
  assert.equal(locateTranscript(feed, 1).inSession, false);
  assert.equal(locateTranscript(feed, 99), null);
});

test("database timestamps without a zone are UTC", async () => {
  const { parseDbTimestamp } = await load();
  assert.equal(parseDbTimestamp("2026-10-14 19:51:00"), Date.UTC(2026, 9, 14, 19, 51));
  assert.equal(parseDbTimestamp("2026-10-14T19:51:00Z"), Date.UTC(2026, 9, 14, 19, 51));
  assert.ok(Number.isNaN(parseDbTimestamp("not a date")));
  assert.ok(Number.isNaN(parseDbTimestamp(null)));
});

test("word counts handle punctuation and scripts without spaces", async () => {
  const { countWords } = await load();
  assert.equal(countWords("Let's set aside some time, tomorrow."), 6);
  assert.equal(countWords(""), 0);
  assert.ok(countWords("今日は晴れです") >= 2);
});

test("history locality comes only from a recorded provider", async () => {
  const { transcriptionLocality } = await load();
  assert.equal(transcriptionLocality(null), null);
  assert.equal(transcriptionLocality("local").locality, "device");
  assert.equal(transcriptionLocality("local-parakeet").locality, "device");
  assert.equal(transcriptionLocality("self-hosted").locality, "network");
  // The raw id travels to the UI, which names it with providerDisplayLabel.
  assert.deepEqual(transcriptionLocality("openai"), { locality: "remote", providerId: "openai" });
  assert.deepEqual(transcriptionLocality("local-parakeet"), { locality: "device", providerId: null });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/lib/homeFeed.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

Create `src/lib/homeFeed.ts`:

```ts
import type { NoteItem, TranscriptionItem } from "../types/electron";
import type { HomeFilter } from "../stores/homeViewStore";
import type { Locality } from "./locality";

// WS-R4 B: Home is one chronological feed across dictations, notes and
// meetings, with chips, an in-view search, and dictation sessions.
export const SESSION_GAP_MS = 300_000;

export type HomeEntry =
  | { kind: "dictation"; key: string; at: number; item: TranscriptionItem; words: number }
  | { kind: "session"; key: string; at: number; items: TranscriptionItem[]; words: number; durationMs: number }
  | { kind: "note"; key: string; at: number; note: NoteItem }
  | { kind: "meeting"; key: string; at: number; note: NoteItem };

export interface HomeDayGroup {
  dayKey: string;
  at: number;
  entries: HomeEntry[];
  captures: number;
  words: number;
}

export interface HomeFeed {
  groups: HomeDayGroup[];
  counts: Record<HomeFilter, number>;
  rows: number;
  captures: number;
}

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

export function parseDbTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  return Date.parse(HAS_ZONE.test(iso) ? iso : `${iso}Z`);
}

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;

export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  if (segmenter) {
    let count = 0;
    for (const segment of segmenter.segment(text)) if (segment.isWordLike) count += 1;
    return count;
  }
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function localDayKey(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const isFoldable = (item: TranscriptionItem) => item.status === "completed";
const matches = (haystacks: Array<string | null | undefined>, needle: string) =>
  !needle || haystacks.some((text) => text?.toLocaleLowerCase().includes(needle));

type Flat = Exclude<HomeEntry, { kind: "session" }>;

export function buildHomeFeed(input: {
  transcriptions: TranscriptionItem[];
  notes: NoteItem[];
  filter: HomeFilter;
  query: string;
  sessionGapMs?: number;
}): HomeFeed {
  const gap = input.sessionGapMs ?? SESSION_GAP_MS;
  const needle = input.query.trim().toLocaleLowerCase();

  const searched: Flat[] = [];
  for (const item of input.transcriptions) {
    const at = parseDbTimestamp(item.timestamp);
    if (Number.isNaN(at) || !matches([item.text, item.raw_text], needle)) continue;
    searched.push({ kind: "dictation", key: `dictation-${item.id}`, at, item, words: countWords(item.text) });
  }
  for (const note of input.notes) {
    const at = parseDbTimestamp(note.updated_at);
    if (Number.isNaN(at) || !matches([note.title, note.content], needle)) continue;
    const kind = note.note_type === "meeting" ? "meeting" : "note";
    searched.push({ kind, key: `${kind}-${note.id}`, at, note });
  }

  const isFailed = (e: Flat) => e.kind === "dictation" && e.item.status === "failed";
  const counts: Record<HomeFilter, number> = {
    all: searched.length,
    dictations: searched.filter((e) => e.kind === "dictation").length,
    meetings: searched.filter((e) => e.kind === "meeting").length,
    notes: searched.filter((e) => e.kind === "note").length,
    failed: searched.filter(isFailed).length,
  };

  const visible = searched
    .filter((e) => {
      switch (input.filter) {
        case "dictations": return e.kind === "dictation";
        case "meetings": return e.kind === "meeting";
        case "notes": return e.kind === "note";
        case "failed": return isFailed(e);
        default: return true;
      }
    })
    .sort((a, b) => b.at - a.at);

  const entries: HomeEntry[] = [];
  for (const entry of visible) {
    const previous = entries.at(-1);
    const canJoin =
      entry.kind === "dictation" &&
      isFoldable(entry.item) &&
      previous &&
      (previous.kind === "session" || (previous.kind === "dictation" && isFoldable(previous.item))) &&
      localDayKey(previous.at) === localDayKey(entry.at);
    if (canJoin) {
      const items = previous.kind === "session" ? previous.items : [previous.item];
      const lastAt = parseDbTimestamp(items.at(-1)!.timestamp);
      if (lastAt - entry.at <= gap) {
        const merged = [...items, entry.item];
        entries[entries.length - 1] = {
          kind: "session",
          key: `session-${merged[0].id}`,
          at: parseDbTimestamp(merged[0].timestamp),
          items: merged,
          words: merged.reduce((sum, i) => sum + countWords(i.text), 0),
          durationMs: merged.reduce((sum, i) => sum + (i.audio_duration_ms ?? 0), 0),
        };
        continue;
      }
    }
    entries.push(entry);
  }

  const groups: HomeDayGroup[] = [];
  for (const entry of entries) {
    const dayKey = localDayKey(entry.at);
    let group = groups.at(-1);
    if (!group || group.dayKey !== dayKey) {
      group = { dayKey, at: entry.at, entries: [], captures: 0, words: 0 };
      groups.push(group);
    }
    group.entries.push(entry);
    if (entry.kind === "dictation") {
      group.captures += 1;
      group.words += entry.words;
    } else if (entry.kind === "session") {
      group.captures += entry.items.length;
      group.words += entry.words;
    }
  }

  return {
    groups,
    counts,
    rows: entries.length,
    captures: groups.reduce((sum, g) => sum + g.captures, 0),
  };
}

export function locateTranscript(
  feed: HomeFeed,
  transcriptId: number
): { dayKey: string; entryKey: string; inSession: boolean } | null {
  for (const group of feed.groups) {
    for (const entry of group.entries) {
      if (entry.kind === "dictation" && entry.item.id === transcriptId) {
        return { dayKey: group.dayKey, entryKey: entry.key, inSession: false };
      }
      if (entry.kind === "session" && entry.items.some((item) => item.id === transcriptId)) {
        return { dayKey: group.dayKey, entryKey: entry.key, inSession: true };
      }
    }
  }
  return null;
}

// transcriptions.provider is written only when audio is retained
// (database.js:591-597), so null means "not recorded", never a guess.
// The URL of a self-hosted transcription is not recorded, so it cannot be
// proven local: it reads as "network", like resolveLocality with no URL.
export function transcriptionLocality(
  provider: string | null | undefined
): { locality: Locality; providerId: string | null } | null {
  if (!provider) return null;
  if (provider === "local" || provider.startsWith("local-")) return { locality: "device", providerId: null };
  if (provider === "self-hosted") return { locality: "network", providerId: null };
  return { locality: "remote", providerId: provider };
}
```

The test's six-word sentence counts "Let's" as one word, which is what `Intl.Segmenter` does in Node 24. If the runtime splits it, change the expectation to the segmenter's count and note it in the commit.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/lib/homeFeed.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/homeFeed.ts test/lib/homeFeed.test.js
git commit -m "feat(home): build a cross-type feed with chips, search and sessions"
```

---

### Task 11: Home Ready strip, container-aware layout and next meeting

This covers WS-R2 A, WS-Q2 (the Home part, fixing the 160px column at 820px) and WS-Q13 (Take notes for the next event).

**Files:**
- Create: `src/lib/upcomingEvents.ts`
- Create: `src/components/home/ReadyStrip.tsx`
- Modify: `src/components/HistoryView.tsx`. Change the props (`:19-35`), the root (`:95`), the two-column row (`:132-133`) and the Coming-up column (`:225`).
- Modify: `src/components/UpcomingMeetings.tsx`. Move `startNotes` (`:171-174`) out; the next event's button is always visible (`:218-229`); the "Today" strip is neutral (`:236-262`, D1, Plan 01 review).
- Modify: `src/components/MicStatusCard.tsx`. Export `CaptureGlyph`, renamed from `StateGlyph` (props `{ status }`).
- Modify: `src/components/ControlPanel.tsx`. Pass `capture` to `HistoryView`.
- Test: `test/lib/upcomingEvents.test.js`, `test/components/readyStrip.test.js`, `test/components/homeLayout.test.js`

**Interfaces:**
- Consumes:
  - `CaptureStatus` (Task 6) and `CaptureGlyph` (Task 8, exported here);
  - `useNow(intervalMs)` (Plan 02, CR-06-1);
  - `useUpcomingEvents()`, already called in `HistoryView.tsx:58`;
  - `CalendarEvent` (`src/types/calendar.ts`);
  - `parseEventDate` from `src/utils/dateFormatting`;
  - `getMeetingJoinUrl` and `openJoinUrl`, from the same imports `UpcomingMeetings.tsx` uses today.
- Produces `src/lib/upcomingEvents.ts`:

  ```ts
  export type EventStart = { kind: "now" } | { kind: "minutes"; minutes: number } | { kind: "later"; at: Date };
  export function nextUpcomingEvent(events: CalendarEvent[], now: Date): { event: CalendarEvent; start: EventStart } | null;
  export function describeStart(event: CalendarEvent, now: Date): EventStart;
  export function startMeetingNotes(event: CalendarEvent): void; // join URL (if any) + joinCalendarMeeting
  ```

- Produces `ReadyStrip`:

  ```ts
  export interface ReadyStripProps {
    status: CaptureStatus;
    now: number;
    hotkeyLabel: string;
    holdToTalk: boolean;              // settings activationMode === "push"
    next: { title: string; start: EventStart } | null;
    onTakeNotes: () => void;
  }
  ```

- `HistoryView` gains the prop `capture: CaptureStatusModel`.

- [ ] **Step 1: Write the failing tests**

Create `test/lib/upcomingEvents.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/upcomingEvents.ts");
const ev = (id, start, end, over = {}) => ({
  id,
  calendar_id: "c",
  provider: "google",
  summary: id,
  start_time: start,
  end_time: end,
  is_all_day: 0,
  status: "confirmed",
  hangout_link: null,
  conference_data: null,
  organizer_email: null,
  attendees_count: 3,
  attendees: null,
  availability_status: "busy",
  self_response_status: "accepted",
  ...over,
});
const now = new Date("2026-10-14T15:48:00Z");

test("the next event is the earliest one still to start", async () => {
  const { nextUpcomingEvent } = await load();
  const result = nextUpcomingEvent(
    [ev("Design sync", "2026-10-14T16:45:00Z", "2026-10-14T17:30:00Z"), ev("Product catch-up", "2026-10-14T16:00:00Z", "2026-10-14T16:42:00Z")],
    now
  );
  assert.equal(result.event.id, "Product catch-up");
  assert.deepEqual(result.start, { kind: "minutes", minutes: 12 });
});

test("a meeting in progress wins and is Now", async () => {
  const { nextUpcomingEvent } = await load();
  const result = nextUpcomingEvent(
    [ev("Later", "2026-10-14T16:00:00Z", "2026-10-14T16:30:00Z"), ev("Standup", "2026-10-14T15:45:00Z", "2026-10-14T16:00:00Z")],
    now
  );
  assert.equal(result.event.id, "Standup");
  assert.deepEqual(result.start, { kind: "now" });
});

test("all-day, cancelled and finished events are skipped", async () => {
  const { nextUpcomingEvent } = await load();
  assert.equal(
    nextUpcomingEvent(
      [
        ev("Holiday", "2026-10-14T00:00:00Z", "2026-10-15T00:00:00Z", { is_all_day: 1 }),
        ev("Gone", "2026-10-14T16:00:00Z", "2026-10-14T17:00:00Z", { status: "cancelled" }),
        ev("Over", "2026-10-14T13:00:00Z", "2026-10-14T14:00:00Z"),
      ],
      now
    ),
    null
  );
});

test("an hour or more away is described by its time", async () => {
  const { describeStart } = await load();
  const start = describeStart(ev("x", "2026-10-14T17:00:00Z", "2026-10-14T18:00:00Z"), now);
  assert.equal(start.kind, "later");
  assert.equal(start.at.toISOString(), "2026-10-14T17:00:00.000Z");
});
```

Create `test/components/readyStrip.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { renderStatic } = require("../helpers/harness/reactSsr");

async function load() {
  if (!i18next.isInitialized) {
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8"));
    await i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  }
  return import("../../src/components/home/ReadyStrip.tsx");
}
const st = (kind, over = {}) => ({ kind, source: null, startedAt: null, offlineReason: null, ...over });
const base = {
  now: 10_000,
  hotkeyLabel: "Fn",
  holdToTalk: true,
  next: { title: "Product catch-up", start: { kind: "minutes", minutes: 12 } },
  onTakeNotes: () => {},
};

test("Ready says how to start, in words and with the key", async () => {
  const { ReadyStrip } = await load();
  const hold = renderStatic(ReadyStrip, { ...base, status: st("ready") });
  assert.match(hold, /data-state="ready"/);
  assert.match(hold, />Ready</);
  assert.match(hold, /Hold <kbd[^>]*>Fn<\/kbd> to dictate/);
  const press = renderStatic(ReadyStrip, { ...base, holdToTalk: false, status: st("ready") });
  assert.match(press, /Press <kbd[^>]*>Fn<\/kbd> to dictate/);
});

test("the next meeting lives in the strip only while the calendar column is hidden", async () => {
  const { ReadyStrip } = await load();
  const html = renderStatic(ReadyStrip, { ...base, status: st("ready") });
  assert.match(html, /class="[^"]*@min-\[960px\]:hidden[^"]*"[^>]*>[\s\S]*Product catch-up in 12 min/);
  assert.match(html, />Take notes</);
});

test("Listening and Cleaning up are named, with live orange only while listening", async () => {
  const { ReadyStrip } = await load();
  const listening = renderStatic(ReadyStrip, { ...base, status: st("listening", { startedAt: 3_000 }) });
  assert.match(listening, /Listening 0:07/);
  assert.match(listening, /border-live/);
  const cleaning = renderStatic(ReadyStrip, { ...base, status: st("processing") });
  assert.match(cleaning, /Cleaning up…/);
  assert.doesNotMatch(cleaning, /border-live/);
});

test("no next meeting, no meeting chip", async () => {
  const { ReadyStrip } = await load();
  const html = renderStatic(ReadyStrip, { ...base, next: null, status: st("ready") });
  assert.doesNotMatch(html, /Take notes/);
});
```

Create `test/components/homeLayout.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");

test("Coming up follows the content width, not the viewport (WS-Q2)", () => {
  const home = read("src/components/HistoryView.tsx");
  assert.match(home, /@container/);
  assert.match(home, /hidden w-80 shrink-0 @min-\[960px\]:block/);
  assert.doesNotMatch(home, /md:block/);
});

test("the next event's Take notes is always visible (WS-Q13)", () => {
  const upcoming = read("src/components/UpcomingMeetings.tsx");
  assert.match(upcoming, /isNext=\{event\.id === nextEventId\}/);
  assert.match(upcoming, /isNow \|\| isNext/);
  assert.match(upcoming, /startMeetingNotes/);
});

// Plan 01 review: the Today header was still the live orange glass. A calendar
// day is not live voice (D1), so it is a stronger neutral plus the word "Today".
test("Today in Coming up is neutral and says Today in words, not orange glass", () => {
  const upcoming = read("src/components/UpcomingMeetings.tsx");
  assert.doesNotMatch(upcoming, /GRADIENT_CIRCLE|BRAND_GLASS_SURFACE|gradient-brand-glass/);
  assert.match(upcoming, /group\.isToday\s*\?\s*"bg-foreground\/8 font-semibold text-foreground dark:bg-white\/10"/);
  assert.match(upcoming, /t\("upcoming\.todayLabel"\)/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/lib/upcomingEvents.test.js test/components/readyStrip.test.js test/components/homeLayout.test.js`
Expected: FAIL. Two modules are missing, and `md:block` is still present.

- [ ] **Step 3: Implement**

1. Create `src/lib/upcomingEvents.ts`:

   ```ts
   import type { CalendarEvent } from "../types/calendar";
   import { parseEventDate } from "../utils/dateFormatting";
   import { getMeetingJoinUrl, openJoinUrl } from "../helpers/meetingJoinUrl";

   export type EventStart = { kind: "now" } | { kind: "minutes"; minutes: number } | { kind: "later"; at: Date };

   const usable = (event: CalendarEvent) => event.is_all_day !== 1 && event.status !== "cancelled";

   export function describeStart(event: CalendarEvent, now: Date): EventStart {
     const start = parseEventDate(event.start_time);
     const end = parseEventDate(event.end_time);
     if (start <= now && now <= end) return { kind: "now" };
     const minutes = Math.ceil((start.getTime() - now.getTime()) / 60_000);
     return minutes < 60 ? { kind: "minutes", minutes } : { kind: "later", at: start };
   }

   export function nextUpcomingEvent(
     events: CalendarEvent[],
     now: Date
   ): { event: CalendarEvent; start: EventStart } | null {
     const candidates = events
       .filter(usable)
       .filter((event) => parseEventDate(event.end_time) >= now)
       .sort((a, b) => parseEventDate(a.start_time).getTime() - parseEventDate(b.start_time).getTime());
     const live = candidates.find((event) => describeStart(event, now).kind === "now");
     const event = live ?? candidates.find((candidate) => parseEventDate(candidate.start_time) > now);
     return event ? { event, start: describeStart(event, now) } : null;
   }

   // Moved from UpcomingMeetings.tsx so the Ready strip and the calendar
   // column start notes the same way.
   export function startMeetingNotes(event: CalendarEvent): void {
     const joinUrl = getMeetingJoinUrl(event);
     if (joinUrl) openJoinUrl(joinUrl);
     void window.electronAPI?.joinCalendarMeeting?.(event.id);
   }
   ```

   `getMeetingJoinUrl` and `openJoinUrl` are imported where `UpcomingMeetings.tsx` imports them. Use those exact paths. If `openJoinUrl` is a local function in `UpcomingMeetings.tsx`, move it into `src/helpers/meetingJoinUrl` and export it. If `parseEventDate` returns `Date | null`, guard it: `parseEventDate(x) ?? new Date(Number.NaN)`.

2. In `src/components/MicStatusCard.tsx`, rename `StateGlyph` to `export function CaptureGlyph({ status }: { status: CaptureStatus })`, and update its two uses.

3. Create `src/components/home/ReadyStrip.tsx`:

   ```tsx
   import { Trans, useTranslation } from "react-i18next";
   import { CaptureGlyph } from "../MicStatusCard";
   import { cn } from "../lib/utils";
   import { formatElapsed, type CaptureStatus } from "../../lib/captureStatus";
   import type { EventStart } from "../../lib/upcomingEvents";

   export interface ReadyStripProps {
     status: CaptureStatus;
     now: number;
     hotkeyLabel: string;
     holdToTalk: boolean;
     next: { title: string; start: EventStart } | null;
     onTakeNotes: () => void;
   }

   const LABEL = {
     ready: "home.ready.ready",
     listening: "home.ready.listening",
     processing: "home.ready.cleaningUp",
     offline: "home.ready.offline",
   } as const;

   // WS-R2 A: "is it listening, what's next" in 44px. Status is glyph + word,
   // never colour alone. The meeting chip shows only when the container is too
   // narrow for the Coming up column (@container on HistoryView).
   export function ReadyStrip({ status, now, hotkeyLabel, holdToTalk, next, onTakeNotes }: ReadyStripProps) {
     const { t, i18n } = useTranslation();
     const label =
       status.kind === "listening" && status.startedAt != null
         ? t("home.ready.listeningFor", { time: formatElapsed(now - status.startedAt) })
         : t(LABEL[status.kind]);
     const startLabel = next
       ? next.start.kind === "now"
         ? t("home.ready.nextNow", { title: next.title })
         : next.start.kind === "minutes"
           ? t("home.ready.nextIn", { title: next.title, count: next.start.minutes })
           : t("home.ready.nextAt", {
               title: next.title,
               time: next.start.at.toLocaleTimeString(i18n.language, { hour: "numeric", minute: "2-digit" }),
             })
       : null;

     return (
       <section
         aria-label={t("home.ready.region")}
         data-state={status.kind}
         className={cn(
           "mb-3 flex h-11 items-center gap-3 rounded-lg border px-3",
           status.kind === "listening" && "border-live/45 bg-live/8",
           (status.kind === "processing" || status.kind === "offline") && "border-warning/40 bg-warning/8",
           status.kind === "ready" && "border-border bg-surface-1 dark:border-white/10"
         )}
       >
         <span className="flex min-w-0 items-center gap-2">
           <CaptureGlyph status={status} />
           <span role="status" aria-live="polite" className="text-ui font-semibold tabular-nums text-foreground">
             {label}
           </span>
           {status.kind === "ready" && (
             <span className="hidden truncate text-caption text-muted-foreground @min-[430px]:inline">
               <Trans
                 i18nKey={holdToTalk ? "home.ready.hold" : "home.ready.press"}
                 values={{ key: hotkeyLabel }}
                 components={{ kbd: <kbd dir="ltr" className="rounded-md bg-background px-1.5 text-micro text-foreground shadow-sm" /> }}
               />
             </span>
           )}
         </span>
         {next && startLabel && (
           <span className="ms-auto flex min-w-0 items-center gap-2 @min-[960px]:hidden">
             <span dir="auto" className="truncate text-caption text-muted-foreground">{startLabel}</span>
             <button type="button" onClick={onTakeNotes} className="shrink-0 text-ui text-link hover:underline">
               {t("home.ready.takeNotes")}
             </button>
           </span>
         )}
       </section>
     );
   }
   ```

   The strip's glyph is static, like the mic card's. The only animated meter is the Capture button's `LevelBars`, plus the sidebar edge rail: two focal motions (Plan 01).

4. In `src/components/HistoryView.tsx`:
   - Props: add `capture: CaptureStatusModel;`.
   - Root (`:95`): `<div className={cn(PAGE_CONTENT_WIDTH_CLASS, "@container px-6 pt-4 pb-6")}>`.
   - Above the AI CTA, render:

     ```tsx
     <ReadyStrip
       status={capture}
       now={nowMs}
       hotkeyLabel={formatHotkeyLabel(parseHotkeyList(hotkey)[0])}
       holdToTalk={holdToTalk}
       next={next ? { title: next.event.summary || t("upcoming.untitledEvent"), start: next.start } : null}
       onTakeNotes={() => next && startMeetingNotes(next.event)}
     />
     ```

     Compute these values in the component body:

     ```ts
     const now = useNow(30_000);
     const tick = useLiveClock(capture.kind === "listening");
     const nowMs = capture.kind === "listening" ? tick : now.getTime();
     const holdToTalk = useSettingsStore((s) => s.activationMode === "push");
     const next = useMemo(() => nextUpcomingEvent(events, now), [events, now]);
     ```

   - Coming-up column (`:225`): `<div className="hidden w-80 shrink-0 @min-[960px]:block">`.

5. In `src/components/UpcomingMeetings.tsx`:
   - Delete the local `startNotes` (`:171-174`) and import `startMeetingNotes` and `nextUpcomingEvent` from `../lib/upcomingEvents`.
   - Replace every `startNotes(event)` call with `startMeetingNotes(event)`.
   - Next to the `now` value that Plan 02 made live, add `const nextEventId = useMemo(() => nextUpcomingEvent(events, now)?.event.id ?? null, [events, now]);`.
   - Thread it down: `DayCard` (`:234`) gains the prop `nextEventId: string | null` and passes `isNext={event.id === nextEventId}` to `EventRow` (`:271`). The call site at `:365` passes `nextEventId={nextEventId}`. `EventRow` (`:165`) gains `isNext: boolean`.
   - In `EventRow`'s render (`:218-229`), change the condition that always shows the button from `isNow` to `isNow || isNext`. The hover-revealed `<span className="pointer-events-none absolute …">` branch now applies only to the other events.
   - In `DayCard`, the day strip (`:244-252`) is still the live orange glass (`cn(GRADIENT_CIRCLE, "-mx-px -mt-px rounded-t-2xl")`). D1 reserves that fill for voice controls, and a calendar day is not one. Replace the strip's class expression with:

     ```tsx
     className={cn(
       "flex items-center gap-1.5 px-2.5 py-2 text-caption font-medium",
       group.isToday
         ? "bg-foreground/8 font-semibold text-foreground dark:bg-white/10"
         : "bg-surface-3 text-foreground dark:bg-surface-2"
     )}
     ```

     Delete the comment about the glass strip overlapping the hairline. Then, before the date `<span>`, add `{group.isToday && <span>{t("upcoming.todayLabel")} ·</span>}`, so "today" is said in words and not carried by colour alone.
   - Remove the now-unused `GRADIENT_CIRCLE` import (`:8`).

6. In `src/components/ControlPanel.tsx`, pass `capture={capture}` to `<HistoryView … />`.

7. Add strings (Task 1 helper). English block:

   ```json
   {
     "home": {
       "ready": {
         "region": "Dictation status",
         "ready": "Ready",
         "listening": "Listening",
         "listeningFor": "Listening {{time}}",
         "cleaningUp": "Cleaning up…",
         "offline": "Mic offline",
         "hold": "Hold <kbd>{{key}}</kbd> to dictate",
         "press": "Press <kbd>{{key}}</kbd> to dictate",
         "nextNow": "{{title}} is on now",
         "nextIn_one": "{{title}} in {{count}} min",
         "nextIn_other": "{{title}} in {{count}} min",
         "nextAt": "{{title}} at {{time}}",
         "takeNotes": "Take notes"
       }
     },
     "upcoming": { "todayLabel": "Today" }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/lib/upcomingEvents.test.js test/components/readyStrip.test.js test/components/homeLayout.test.js test/components/micStatusCard.test.js test/components/directionalContentPolicy.test.js && npm run typecheck`
Expected: PASS. The `directionalContentPolicy` count of `dir="auto"` summaries in `UpcomingMeetings.tsx` is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/upcomingEvents.ts src/components/home/ReadyStrip.tsx src/components/HistoryView.tsx src/components/UpcomingMeetings.tsx src/components/MicStatusCard.tsx src/components/ControlPanel.tsx src/helpers src/locales test/lib/upcomingEvents.test.js test/components/readyStrip.test.js test/components/homeLayout.test.js
git commit -m "feat(home): add the Ready strip and a container-aware Coming up column"
```

---

### Task 12: Home history list: toolbar, rows, sessions, history menu and deep-link landing

This covers the WS-R4 B UI, WS-Q3 (landing and ring), WS-Q13 (the visible History menu), WS-14 and WS-15.

**Files:**
- Create: `src/components/home/HistoryToolbar.tsx`, `src/components/home/HistoryMenu.tsx`, `src/components/home/FeedRows.tsx`
- Modify: `src/components/HistoryView.tsx`. Replace the list body (`:60-92` grouping, and `:142-223` loading, empty and list), removing the hover-only controls at `:193-204`.
- Modify: `src/components/ui/TranscriptionItem.tsx`. Change the props (`:44-51`), time (`:70-77`), row (`:149-170`) and text (`:280-285`).
- Modify: `src/index.css`. Add the `history-row-focus` keyframes after the `.capture-rail` block.
- Modify: `src/stores/transcriptionStore.ts`. Add `revealTranscription` (review M01).
- Test: `test/components/historyToolbar.test.js`, `test/components/transcriptionItemRow.test.js`, `test/components/feedRows.test.js`, `test/components/historyFocusCss.test.js`, `test/stores/transcriptionReveal.test.js`

**Interfaces:**
- Consumes `buildHomeFeed`, `locateTranscript`, `transcriptionLocality`, `countWords` and `parseDbTimestamp` (Task 10); `useHomeViewStore`, `setHomeFilter`, `setHomeQuery` and `clearTranscriptFocus` (Task 3); `useRecentNotes(50)` (Task 9); `useWorkspaceNavigation` (Task 3); `formatElapsed` (Task 6); `getTranscriptionById` (`electron.ts:839`); and `LocalityRing` (Plan 01).
- Produces:
  - `HistoryToolbar` props: `{ query; onQueryChange(q: string); filter: HomeFilter; onFilterChange(f: HomeFilter); counts: Record<HomeFilter, number>; inputRef: React.RefObject<HTMLInputElement | null>; menu: React.ReactNode }`.
  - `HistoryMenu` props: `{ showDiscarded: boolean; onToggleDiscarded(): void; onClearAll(): void; hasHistory: boolean }`.
  - `FeedRows.tsx` exports:
    - `SessionRow({ entry, expanded, onToggle, children })`;
    - `NoteFeedRow({ entry, onOpen })`;
    - `formatClockTime(ms: number, locale?: string): string`. It is not zero-padded: `7:51 PM`, and `19:51` in 24-hour locales.
  - `TranscriptionItem` gains optional props `words?: number`, `focused?: boolean` and `nested?: boolean`. It renders `data-transcript-id` and `data-focused`.
  - `transcriptionStore.revealTranscription(item: TranscriptionItem): void`. It inserts one fetched row into the loaded list in timestamp order, with no page-limit slicing, so a deep link to an older dictation lands on a real row. A row already present is replaced in place.

- [ ] **Step 1: Write the failing tests**

Create `test/stores/transcriptionReveal.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/stores/transcriptionStore.ts");
const row = (id, timestamp) => ({ id, text: `t${id}`, timestamp, status: "completed" });

test("an older dictation is revealed in order, beyond the loaded page", async () => {
  const store = await load();
  store.useTranscriptionStore.setState({ transcriptions: [row(3, "2026-10-14 12:00:00"), row(2, "2026-10-13 12:00:00")] });
  store.revealTranscription(row(1, "2026-09-01 08:00:00"));
  store.revealTranscription(row(9, "2026-10-13 18:00:00"));
  assert.deepEqual(store.useTranscriptionStore.getState().transcriptions.map((r) => r.id), [3, 9, 2, 1]);
});

test("revealing a row that is already loaded replaces it in place", async () => {
  const store = await load();
  store.useTranscriptionStore.setState({ transcriptions: [row(3, "2026-10-14 12:00:00")] });
  store.revealTranscription({ ...row(3, "2026-10-14 12:00:00"), text: "edited" });
  assert.deepEqual(store.useTranscriptionStore.getState().transcriptions.map((r) => [r.id, r.text]), [[3, "edited"]]);
});
```

`useTranscriptionStore` is a non-exported `const` today (`transcriptionStore.ts:9`). Export it; the test needs its `setState` and `getState`.

Create `test/components/historyToolbar.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { React, renderStatic } = require("../helpers/harness/reactSsr");

async function load() {
  if (!i18next.isInitialized) {
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8"));
    await i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  }
  return import("../../src/components/home/HistoryToolbar.tsx");
}
const props = (over = {}) => ({
  query: "",
  onQueryChange: () => {},
  filter: "all",
  onFilterChange: () => {},
  counts: { all: 7, dictations: 5, meetings: 1, notes: 1, failed: 1 },
  inputRef: React.createRef(),
  menu: null,
  ...over,
});

test("the filter field is labelled and hints its / shortcut", async () => {
  const { HistoryToolbar } = await load();
  const html = renderStatic(HistoryToolbar, props());
  assert.match(html, /aria-label="Filter history"/);
  assert.match(html, /placeholder="Filter this list"/);
  assert.match(html, /<kbd[^>]*>\/<\/kbd>/);
});

test("chips are toggle buttons; the selected one is pressed and ink-filled", async () => {
  const { HistoryToolbar } = await load();
  const html = renderStatic(HistoryToolbar, props({ filter: "meetings" }));
  for (const label of ["All", "Dictations", "Meetings", "Notes", "Failed"]) assert.match(html, new RegExp(`>${label}<`));
  assert.match(html, /aria-pressed="true"[^>]*class="[^"]*bg-foreground text-background[^"]*"[^>]*>Meetings/);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
});

test("the Failed chip shows its count only when there is something to retry", async () => {
  const { HistoryToolbar } = await load();
  assert.match(renderStatic(HistoryToolbar, props()), /data-failed-count="1"/);
  const none = renderStatic(HistoryToolbar, props({ counts: { all: 3, dictations: 3, meetings: 0, notes: 0, failed: 0 } }));
  assert.doesNotMatch(none, /data-failed-count/);
});
```

Create `test/components/transcriptionItemRow.test.js`:

```js
process.env.TZ = "UTC";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const item = (over = {}) => ({
  id: 311,
  text: "Draft a reply to Maya: the pricing change goes out Thursday, not Monday.",
  raw_text: null,
  timestamp: "2026-10-14 19:51:00",
  created_at: "2026-10-14 19:51:00",
  has_audio: 1,
  audio_duration_ms: 7000,
  provider: "local-parakeet",
  model: "parakeet",
  status: "completed",
  error_message: null,
  error_code: null,
  client_transcription_id: "c311",
  cloud_id: null,
  sync_status: "synced",
  deleted_at: null,
  ...over,
});

async function renderRow(t, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-transcription-row-test-" });
  const mod = await vite.ssrLoadModule("/components/ui/TranscriptionItem.tsx");
  return renderToStaticMarkup(createElement(mod.default, { item: item(), onCopy: () => {}, onDelete: () => {}, words: 13, ...props }));
}

test("rows read time, words and duration at a glance", async (t) => {
  const html = await renderRow(t, {});
  assert.match(html, /data-transcript-id="311"/);
  assert.match(html, /grid-cols-\[64px_1fr_auto\]/);
  assert.match(html, />7:51 PM</);
  assert.doesNotMatch(html, />07:51/);
  assert.match(html, /0:07/);
  assert.match(html, /data-locality="device"/);
});

test("actions are visible at rest in a colour that clears 3:1, never faded (I14)", async (t) => {
  const html = await renderRow(t, {});
  assert.match(html, /data-row-actions="true"[^>]*class="[^"]*text-muted-foreground/);
  assert.doesNotMatch(html, /data-row-actions="true"[^>]*class="[^"]*opacity-\d+/);
  const fs = require("node:fs");
  const path = require("node:path");
  const { resolveTokens } = require("../helpers/harness/cssTokens");
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const { light, dark } = resolveTokens(fs.readFileSync(path.join(__dirname, "../../src/index.css"), "utf8"));
  for (const map of [light, dark]) {
    for (const surface of ["--color-background", "--color-card", "--color-surface-1"]) {
      assert.ok(contrastRatio(map["--color-muted-foreground"], map[surface]) >= 3, surface);
    }
  }
});

test("no recorded provider means no locality claim", async (t) => {
  const html = await renderRow(t, { item: item({ provider: null }) });
  assert.doesNotMatch(html, /data-locality=/);
});

test("a deep-linked row is marked for the focus ring", async (t) => {
  const html = await renderRow(t, { focused: true });
  assert.match(html, /data-focused="true"/);
});
```

Create `test/components/feedRows.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { React, renderStatic } = require("../helpers/harness/reactSsr");

async function load() {
  if (!i18next.isInitialized) {
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8"));
    await i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  }
  return import("../../src/components/home/FeedRows.tsx");
}
const tx = (id, ms) => ({ id, text: `t${id}`, timestamp: "2026-10-14 14:02:00", audio_duration_ms: ms, status: "completed" });

test("a session names its size and length and expands in place", async () => {
  const { SessionRow } = await load();
  const entry = { kind: "session", key: "session-4", at: Date.UTC(2026, 9, 14, 14, 9), items: [tx(4, 30000), tx(3, 20000), tx(2, 12000), tx(1, 10000)], words: 40, durationMs: 72000 };
  const collapsed = renderStatic(SessionRow, { entry, expanded: false, onToggle: () => {} }, React.createElement("i", null, "child"));
  assert.match(collapsed, /Session · 4 captures · 1:12/);
  assert.match(collapsed, /aria-expanded="false"/);
  assert.doesNotMatch(collapsed, /child/);
  const open = renderStatic(SessionRow, { entry, expanded: true, onToggle: () => {} }, React.createElement("i", null, "child"));
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /child/);
});

test("meetings and notes say what they are, not by colour", async () => {
  const { NoteFeedRow } = await load();
  const meeting = renderStatic(NoteFeedRow, { entry: { kind: "meeting", key: "meeting-7", at: 0, note: { id: 7, title: "Design sync", content: "" } }, onOpen: () => {} });
  assert.match(meeting, /Meeting/);
  assert.match(meeting, /Design sync/);
  const untitled = renderStatic(NoteFeedRow, { entry: { kind: "note", key: "note-8", at: 0, note: { id: 8, title: "", content: "" } }, onOpen: () => {} });
  assert.match(untitled, /Untitled/);
});

test("clock times are not zero-padded", async () => {
  const { formatClockTime } = await load();
  assert.match(formatClockTime(Date.UTC(2026, 9, 14, 7, 51), "en-US"), /^\d{1,2}:51/);
  assert.doesNotMatch(formatClockTime(new Date(2026, 9, 14, 7, 51).getTime(), "en-US"), /^0/);
});
```

Create `test/components/historyFocusCss.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const css = fs.readFileSync(path.join(__dirname, "../../src/index.css"), "utf8");

test("a deep-linked row rings for 1.2s, and reduced motion keeps the ring without the pulse", () => {
  assert.match(css, /\[data-focused="true"\]\s*\{[^}]*animation:\s*history-row-focus 1200ms var\(--motion-ease-std\)/);
  assert.match(css, /@keyframes history-row-focus/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\[data-focused="true"\]\s*\{[^}]*animation:\s*none[^}]*box-shadow/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/historyToolbar.test.js test/components/transcriptionItemRow.test.js test/components/feedRows.test.js test/components/historyFocusCss.test.js`
Expected: FAIL. Modules are missing, the time renders as `07:51 PM`, `opacity-0` is present, and the keyframes are missing.

- [ ] **Step 3: Implement**

1. Create `src/components/home/HistoryToolbar.tsx`:

   ```tsx
   import { Search } from "lucide-react";
   import { useTranslation } from "react-i18next";
   import { cn } from "../lib/utils";
   import { HOME_FILTERS, type HomeFilter } from "../../stores/homeViewStore";

   export interface HistoryToolbarProps {
     query: string;
     onQueryChange: (query: string) => void;
     filter: HomeFilter;
     onFilterChange: (filter: HomeFilter) => void;
     counts: Record<HomeFilter, number>;
     inputRef: React.RefObject<HTMLInputElement | null>;
     menu: React.ReactNode;
   }

   export function HistoryToolbar({ query, onQueryChange, filter, onFilterChange, counts, inputRef, menu }: HistoryToolbarProps) {
     const { t } = useTranslation();
     return (
       <div className="mb-2 flex min-h-10 flex-wrap items-center gap-2">
         <label className="flex h-8 min-w-48 flex-1 items-center gap-2 rounded-lg border border-border px-2.5 focus-within:ring-2 focus-within:ring-ring @min-[640px]:flex-none dark:border-white/10">
           <Search size={14} aria-hidden className="text-muted-foreground" />
           <input
             ref={inputRef}
             dir="auto"
             type="search"
             value={query}
             onChange={(e) => onQueryChange(e.target.value)}
             aria-label={t("home.history.filterLabel")}
             placeholder={t("home.history.filterPlaceholder")}
             className="min-w-0 flex-1 bg-transparent text-ui text-foreground outline-none placeholder:text-muted-foreground"
           />
           <kbd dir="ltr" className="text-micro text-muted-foreground">/</kbd>
         </label>
         <div role="group" aria-label={t("home.history.chipsLabel")} className="flex flex-wrap items-center gap-1.5">
           {HOME_FILTERS.map((value) => {
             const selected = filter === value;
             return (
               <button
                 key={value}
                 type="button"
                 aria-pressed={selected}
                 onClick={() => onFilterChange(value)}
                 className={cn(
                   "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-caption font-semibold",
                   selected ? "bg-foreground text-background" : "text-foreground hover:bg-foreground/6"
                 )}
               >
                 {t(`home.history.chips.${value}`)}
                 {value === "failed" && counts.failed > 0 && (
                   <span data-failed-count={counts.failed} className="min-w-4 rounded-full bg-destructive/15 px-1 text-micro text-destructive">
                     {counts.failed}
                   </span>
                 )}
               </button>
             );
           })}
         </div>
         <div className="ms-auto">{menu}</div>
       </div>
     );
   }
   ```

   `test/components/fieldDirectionPolicy.test.js` deep-equals every native `<input>` under `src/components` against a per-file map (its lines 41-45, 134). Add `"src/components/home/HistoryToolbar.tsx": ["auto"],` to that map, next to the `CommandSearch.tsx` entry.

2. Create `src/components/home/HistoryMenu.tsx`:

   ```tsx
   import { Archive, MoreHorizontal, Trash2 } from "lucide-react";
   import { useTranslation } from "react-i18next";
   import {
     DropdownMenu,
     DropdownMenuCheckboxItem,
     DropdownMenuContent,
     DropdownMenuItem,
     DropdownMenuSeparator,
     DropdownMenuTrigger,
   } from "../ui/dropdown-menu";

   export interface HistoryMenuProps {
     showDiscarded: boolean;
     onToggleDiscarded: () => void;
     onClearAll: () => void;
     hasHistory: boolean;
   }

   // WS-Q13 / WS-15: visible, labelled, and away from the date label.
   // Clear all keeps ControlPanel's existing confirm dialog.
   export function HistoryMenu({ showDiscarded, onToggleDiscarded, onClearAll, hasHistory }: HistoryMenuProps) {
     const { t } = useTranslation();
     return (
       <DropdownMenu>
         <DropdownMenuTrigger asChild>
           <button type="button" aria-label={t("home.history.menu")} className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/6 hover:text-foreground">
             <MoreHorizontal size={16} aria-hidden />
           </button>
         </DropdownMenuTrigger>
         <DropdownMenuContent align="end">
           <DropdownMenuCheckboxItem checked={showDiscarded} onCheckedChange={onToggleDiscarded} className="gap-2 text-ui">
             <Archive size={14} aria-hidden />
             {t("home.history.showDiscarded")}
           </DropdownMenuCheckboxItem>
           <DropdownMenuSeparator />
           <DropdownMenuItem disabled={!hasHistory} onSelect={onClearAll} className="gap-2 text-ui text-destructive">
             <Trash2 size={14} aria-hidden />
             {t("home.history.clearAll")}
           </DropdownMenuItem>
         </DropdownMenuContent>
       </DropdownMenu>
     );
   }
   ```

   If `src/components/ui/dropdown-menu.tsx` does not export `DropdownMenuCheckboxItem`, use a `DropdownMenuItem` with `role="menuitemcheckbox" aria-checked={showDiscarded}` and a `Check` icon when checked.

3. Create `src/components/home/FeedRows.tsx`:

   ```tsx
   import { ChevronRight, FileText, Users } from "lucide-react";
   import { useTranslation } from "react-i18next";
   import { cn } from "../lib/utils";
   import { formatElapsed } from "../../lib/captureStatus";
   import type { HomeEntry } from "../../lib/homeFeed";

   export function formatClockTime(ms: number, locale?: string): string {
     return new Date(ms).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
   }

   type SessionEntry = Extract<HomeEntry, { kind: "session" }>;
   type NoteEntry = Extract<HomeEntry, { kind: "note" | "meeting" }>;

   export function SessionRow({
     entry,
     expanded,
     onToggle,
     children,
   }: {
     entry: SessionEntry;
     expanded: boolean;
     onToggle: () => void;
     children?: React.ReactNode;
   }) {
     const { t, i18n } = useTranslation();
     return (
       <div className="border-s-2 border-s-foreground/20" data-session={entry.key}>
         <button
           type="button"
           aria-expanded={expanded}
           onClick={onToggle}
           className="grid w-full grid-cols-[64px_1fr_auto] items-center gap-x-3 px-4 py-3 text-start hover:bg-muted/20"
         >
           <span className="text-caption tabular-nums text-muted-foreground">{formatClockTime(entry.at, i18n.language)}</span>
           <span className="text-ui text-foreground">
             {t("home.history.session", { count: entry.items.length, duration: formatElapsed(entry.durationMs) })}
           </span>
           <span className="flex items-center gap-1 text-caption text-link">
             {t(expanded ? "home.history.collapse" : "home.history.expand")}
             <ChevronRight size={12} aria-hidden className={cn("transition-transform duration-(--motion-fast)", expanded && "rotate-90")} />
           </span>
         </button>
         {expanded && <div className="divide-y divide-border/60">{children}</div>}
       </div>
     );
   }

   export function NoteFeedRow({ entry, onOpen }: { entry: NoteEntry; onOpen: (noteId: number) => void }) {
     const { t, i18n } = useTranslation();
     const Icon = entry.kind === "meeting" ? Users : FileText;
     return (
       <button
         type="button"
         onClick={() => onOpen(entry.note.id)}
         className="grid w-full grid-cols-[64px_1fr_auto] items-center gap-x-3 px-4 py-3 text-start hover:bg-muted/20"
       >
         <span className="text-caption tabular-nums text-muted-foreground">{formatClockTime(entry.at, i18n.language)}</span>
         <span className="flex min-w-0 items-center gap-2">
           <Icon size={14} aria-hidden className={entry.kind === "meeting" ? "text-ai" : "text-muted-foreground"} />
           <span dir="auto" className="truncate text-body font-medium text-foreground">
             {entry.note.title || t("notes.list.untitledNote")}
           </span>
         </span>
         <span className="text-caption text-muted-foreground">
           {t(entry.kind === "meeting" ? "home.history.meetingRow" : "home.history.noteRow")}
         </span>
       </button>
     );
   }
   ```

   The untitled test expects the English string for `notes.list.untitledNote` to contain "Untitled". If the en value differs, assert on that value.

4. In `src/components/ui/TranscriptionItem.tsx`:
   - Props: add `words?: number; focused?: boolean; nested?: boolean;`.
   - Time (`:70-77`): replace the `{hour:"2-digit",minute:"2-digit"}` options with `{ hour: "numeric", minute: "2-digit" }`.
   - Row wrapper (`:149-160`): add `data-transcript-id={item.id}` and `data-focused={focused ? "true" : undefined}`. Change the layout of the transcribed body to `grid grid-cols-[64px_1fr_auto] items-start gap-x-3`, with the time in column 1, the text in column 2 and the actions plus meta in column 3. Keep the failed and discarded bodies in column 2.
   - Actions wrapper (`:163-170`): delete the `opacity-0 group-hover/row:opacity-100 has-[:focus-visible]:opacity-100 has-[[data-state=open]]:opacity-100` branch entirely, and add `data-row-actions="true"`. The Copy and More buttons rest in full `text-muted-foreground` (`#525252`, 7.9:1 on white; Plum Night `#b59aa8`), and hover or open states add `bg-foreground/8` and `text-foreground`.
     - **Review I14.** R2 A's "actions stay at 40% opacity" composites to about 1.95:1 on white, under the 3:1 non-text floor in spec §4. The global constraint wins, so the visible-at-rest intent is kept at a colour that passes.
     - Keep each button's focus style as `focus-visible:ring-2 focus-visible:ring-ring` (Plan 02 Task 3).
   - Text (`:280-285`): `<p dir="auto" className="text-body line-clamp-4 wrap-break-word whitespace-pre-wrap text-foreground" onClick={copyUnlessSelecting}>{item.text}</p>`, where:

     ```ts
     // Click-to-copy for the mouse (R2 A); the visible Copy button stays the
     // keyboard and screen-reader path. Selecting text never copies the row.
     const copyUnlessSelecting = () => {
       if (window.getSelection()?.toString()) return;
       onCopy(item.text);
     };
     ```

   - Raw text in the expanded block (`:314`): `className="mt-1 text-caption leading-relaxed text-muted-foreground"`, replacing `text-xs … text-muted-foreground/80`. Plan 08 Task 10 copies this exact string into its `RAW_TEXT_CLASS` (CR-06-6).
   - Meta, under the actions in column 3:

     ```tsx
     <span className="flex items-center gap-1.5 text-caption tabular-nums text-muted-foreground">
       {item.audio_duration_ms != null && <span>{formatElapsed(item.audio_duration_ms)}</span>}
       {words != null && <span>· {t("home.history.words", { count: words })}</span>}
       {locality && (
         <LocalityRing
           size={12}
           locality={locality.locality}
           provider={providerLabel}
           label={t(`locality.${locality.locality}`, { provider: providerLabel ?? "" })}
         />
       )}
     </span>
     ```

     Here:
     - `const locality = transcriptionLocality(item.provider);`
     - `const providerLabel = locality?.locality === "remote" ? providerDisplayLabel(locality.providerId, t) : null;`, with `providerDisplayLabel` imported from `../../lib/locality`.
   - Keep `test/components/directionalContentPolicy.test.js:18`'s regex true: the `<p dir="auto" …>{item.text}` shape stays.

5. In `src/index.css`, after the `.capture-rail` block, add:

   ```css
   /* WS-Q3: a deep-linked history row rings for 1.2s. */
   [data-focused="true"] {
     border-radius: var(--radius-md, 8px);
     animation: history-row-focus 1200ms var(--motion-ease-std) both;
   }
   @keyframes history-row-focus {
     0%, 70% { box-shadow: inset 0 0 0 2px var(--color-ring); }
     100% { box-shadow: inset 0 0 0 2px transparent; }
   }
   @media (prefers-reduced-motion: reduce) {
     [data-focused="true"] { animation: none; box-shadow: inset 0 0 0 2px var(--color-ring); }
   }
   ```

6. In `src/components/HistoryView.tsx`, replace the `groupedHistory` memo (`:60-78`), `discardedToggle` (`:80-92`) and the list rendering (`:142-223`) with the feed:

   ```tsx
   const { filter, query, focusTranscriptId, focusNonce } = useHomeViewStore();
   const recentNotes = useRecentNotes(50);
   const feed = useMemo(
     () => buildHomeFeed({ transcriptions: history, notes: recentNotes, filter, query }),
     [history, recentNotes, filter, query]
   );
   const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
   const [ring, setRing] = useState<{ id: number; nonce: number } | null>(null);
   const filterRef = useRef<HTMLInputElement>(null);
   const navigation = useWorkspaceNavigation();

   // "/" focuses the in-view filter unless you are already typing somewhere.
   useEffect(() => {
     const onKey = (event: KeyboardEvent) => {
       const target = event.target as HTMLElement | null;
       const typing = target?.closest("input, textarea, [contenteditable='true']");
       if (event.key !== "/" || typing || event.metaKey || event.ctrlKey || event.altKey) return;
       event.preventDefault();
       filterRef.current?.focus();
     };
     window.addEventListener("keydown", onKey);
     return () => window.removeEventListener("keydown", onKey);
   }, []);

   // WS-Q3 landing (review M01):
   // - every request is its own generation;
   // - a row outside the loaded page is fetched by id and revealed;
   // - a missing row ends the request explicitly;
   // - the ring carries a nonce, so asking twice restarts it.
   const landingGenRef = useRef(0);
   const feedRef = useRef(feed);
   feedRef.current = feed;
   useEffect(() => {
     if (focusTranscriptId == null) return;
     const generation = ++landingGenRef.current;
     const id = focusTranscriptId;
     clearTranscriptFocus();
     void (async () => {
       if (!locateTranscript(feedRef.current, id)) {
         const fetched = await window.electronAPI.getTranscriptionById(id).catch(() => null);
         if (generation !== landingGenRef.current) return;
         if (!fetched || fetched.deleted_at) {
           toast({ title: t("home.history.olderMissing") });
           return;
         }
         revealTranscription(fetched);
         await new Promise((r) => requestAnimationFrame(r)); // let the feed rebuild
         if (generation !== landingGenRef.current) return;
       }
       const found = locateTranscript(feedRef.current, id);
       if (!found) return;
       if (found.inSession) setExpanded((prev) => new Set(prev).add(found.entryKey));
       setRing((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
       // Two frames: the first commits the expanded session, the second can scroll to it.
       requestAnimationFrame(() =>
         requestAnimationFrame(() => {
           const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
           document
             .querySelector(`[data-transcript-id="${id}"]`)
             ?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
         })
       );
     })();
     // eslint-disable-next-line react-hooks/exhaustive-deps -- one landing per request nonce
   }, [focusNonce]);

   // The ring clears 1.2s after each (re)start; the nonce restarts the timer and animation.
   useEffect(() => {
     if (!ring) return;
     const clear = window.setTimeout(() => setRing(null), 1200);
     return () => window.clearTimeout(clear);
   }, [ring?.nonce]);
   ```

   In `src/stores/transcriptionStore.ts`, add and export:

   ```ts
   /** Put one fetched row into the loaded list for a deep link (M01). Keeps
    *  timestamp-DESC, id-DESC order; never slices to the page limit. */
   export function revealTranscription(item: TranscriptionItem): void {
     useTranscriptionStore.setState((state) => {
       const rest = state.transcriptions.filter((existing) => existing.id !== item.id);
       const index = rest.findIndex(
         (existing) => existing.timestamp < item.timestamp || (existing.timestamp === item.timestamp && existing.id < item.id)
       );
       const next = rest.slice();
       next.splice(index === -1 ? next.length : index, 0, item);
       return { transcriptions: next };
     });
   }
   ```

   SQLite timestamps share one fixed `YYYY-MM-DD HH:MM:SS` format, so string order is time order.

   Add `const { toast } = useToast();` (from `./ui/useToast`) and `const { t } = useTranslation();` if `HistoryView` does not already have them.

   Render order:
   1. `ReadyStrip` (Task 11)
   2. the AI CTA (unchanged)
   3. the retention notice (Task 25 replaces it)
   4. `<HistoryToolbar …>`, with `menu={<HistoryMenu showDiscarded={showDiscarded} onToggleDiscarded={onToggleDiscarded} onClearAll={clearAllTranscriptions} hasHistory={history.length > 0} />}`
   5. the states:
      - Loading: as today.
      - Brand-new empty, when `history.length === 0 && recentNotes.length === 0`: the existing empty state at `:149-186`, unchanged.
      - Filtered empty, when `feed.rows === 0`:

        ```tsx
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
          <p className="text-ui text-foreground">{t("home.history.nothingMatches", { query: query.trim() })}</p>
          <button type="button" className="mt-2 text-ui text-link hover:underline" onClick={() => { setHomeQuery(""); setHomeFilter("all"); }}>
            {t("home.history.clearFilter")}
          </button>
        </div>
        ```

      - Otherwise, one block per `feed.groups` entry:
        - a sticky day header: `formatDateGroup` of the group's first entry, plus `t("home.history.dayCount", { count: group.captures })` and `t("home.history.words", { count: group.words })` when `group.captures > 0`, in `text-caption text-muted-foreground`;
        - the existing card (`:206`), with its entries mapped:
          - `dictation` → `<TranscriptionItem key={ring?.id === entry.item.id ? `${entry.key}-${ring.nonce}` : entry.key} item={entry.item} words={entry.words} focused={ring?.id === entry.item.id} …existing handlers />`. The ring nonce in the key remounts the row, so the CSS ring restarts on a repeated request;
          - `session` → `<SessionRow entry={entry} expanded={expanded.has(entry.key)} onToggle={() => toggle(entry.key)}>` containing one `<TranscriptionItem nested key={ring?.id === i.id ? `${i.id}-${ring.nonce}` : i.id} words={countWords(i.text)} focused={ring?.id === i.id} …/>` per item;
          - `note`/`meeting` → `<NoteFeedRow entry={entry} onOpen={navigation.openNote} />`.

   `formatDateGroup(item.timestamp, t, locale)` takes a timestamp string. For groups whose first entry is a note, pass `new Date(group.at).toISOString()`. Delete the hover-only controls that were at `:193-204`.

7. Add strings (Task 1 helper). English block:

   ```json
   {
     "home": {
       "history": {
         "filterLabel": "Filter history",
         "filterPlaceholder": "Filter this list",
         "chipsLabel": "Show",
         "chips": { "all": "All", "dictations": "Dictations", "meetings": "Meetings", "notes": "Notes", "failed": "Failed" },
         "menu": "History options",
         "showDiscarded": "Show discarded",
         "clearAll": "Clear all…",
         "dayCount_one": "{{count}} dictation",
         "dayCount_other": "{{count}} dictations",
         "words_one": "{{count}} word",
         "words_other": "{{count}} words",
         "session_one": "Session · {{count}} capture · {{duration}}",
         "session_other": "Session · {{count}} captures · {{duration}}",
         "expand": "Expand",
         "collapse": "Collapse",
         "meetingRow": "Meeting",
         "noteRow": "Note",
         "nothingMatches": "Nothing matches “{{query}}”.",
         "clearFilter": "Clear filter",
         "olderMissing": "That dictation is no longer in your history."
       }
     }
   }
   ```

   Then delete `controlPanel.history.discarded.show` and `controlPanel.history.discarded.hide` from every locale, but only if `grep -rn "history.discarded" src` returns nothing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/historyToolbar.test.js test/components/transcriptionItemRow.test.js test/components/feedRows.test.js test/components/historyFocusCss.test.js test/lib/homeFeed.test.js test/components/directionalContentPolicy.test.js test/components/fieldDirectionPolicy.test.js test/locales/translationCoverage.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/home src/components/HistoryView.tsx src/components/ui/TranscriptionItem.tsx src/index.css src/locales test/components/historyToolbar.test.js test/components/transcriptionItemRow.test.js test/components/feedRows.test.js test/components/historyFocusCss.test.js test/components/fieldDirectionPolicy.test.js
git commit -m "feat(home): add filter chips, in-view search, sessions and deep-link landing"
```

---

### Task 13: Command palette: Commands and Navigation groups, highlighting and deep links

This covers WS-R5 A, WS-Q3 (palette side: deep-link plus match highlight), WS-10 and WS-40.

**Files:**
- Create: `src/lib/fuzzyMatch.ts`, `src/components/commandSearch/commands.ts`, `src/components/commandSearch/paletteSections.ts`
- Modify: `src/components/CommandSearch.tsx`. Applies to `mode="all"` only. The `mode="conversations"` path (`:434-470`) is unchanged. The changes:
  - the caps at `:265` and `:272`;
  - selection (`:286-296`);
  - keyboard (`:298-313`);
  - sections (`:473-550`);
  - footer (`:556-560`, `:761-776`).
- Test: `test/lib/fuzzyMatch.test.js`, `test/components/paletteSections.test.js`, `test/components/workspaceCommands.test.js`

**Interfaces:**
- Consumes `WorkspaceNavigation` (Task 3), `shortcutHint`/`WorkspaceAction` (Task 4), `showHomeQuery` (Task 3), and the Task 5 `toggleDictationFromControlPanel`.
- Produces `src/lib/fuzzyMatch.ts`:

  ```ts
  export type MatchRange = readonly [start: number, end: number]; // end exclusive, in the original string
  export interface FuzzyMatch { score: number; ranges: MatchRange[] }
  export function fuzzyMatch(query: string, text: string): FuzzyMatch | null;   // substring beats subsequence
  export function substringMatch(query: string, text: string): FuzzyMatch | null;
  export function highlightSegments(text: string, ranges: readonly MatchRange[]): Array<{ text: string; match: boolean }>;
  ```

- Produces `src/components/commandSearch/commands.ts`:

  ```ts
  export interface CommandDeps { toggleDictation(): void; toggleTheme(): void; speechSettingsPath(): string }
  export interface WorkspaceCommand {
    id: "newNote" | "startDictation" | "askAssistant" | "goNotes" | "goHome" | "goChat" | "recordMeeting"
      | "uploadAudio" | "newChat" | "openSettings" | "switchSpeechModel" | "toggleTheme";
    labelKey: string; keywords: readonly string[];
    shortcut?: WorkspaceAction; usesHotkey?: boolean;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    run(nav: WorkspaceNavigation, deps: CommandDeps): void;
  }
  export const WORKSPACE_COMMANDS: readonly WorkspaceCommand[];
  export const SUGGESTED_COMMAND_IDS: readonly WorkspaceCommand["id"][]; // newNote, startDictation, askAssistant, goNotes
  ```

- Produces `src/components/commandSearch/paletteSections.ts`:

  ```ts
  export type PaletteSectionId = "suggested" | "recent" | "commands" | "notes" | "meetings" | "transcripts" | "chats" | "folders" | "nothing";
  export type PaletteRow =
    | { kind: "command"; key: string; command: WorkspaceCommand; label: string; ranges: MatchRange[] }
    | { kind: "note" | "meeting"; key: string; note: NoteItem; ranges: MatchRange[] }
    | { kind: "transcript"; key: string; transcript: TranscriptionItem; ranges: MatchRange[] }
    | { kind: "conversation"; key: string; conversation: { id: number; title: string; updated_at: string }; ranges: MatchRange[] }
    | { kind: "container"; key: string; target: { spaceId: number; folderId: number | null; label: string }; ranges: MatchRange[] }
    | { kind: "seeAllTranscripts"; key: string; total: number }
    | { kind: "ask"; key: string; query: string };
  export interface PaletteSection { id: PaletteSectionId; rows: PaletteRow[] }
  export const PALETTE_CAPS: { commands: 6; notes: 6; meetings: 4; transcripts: 8; chats: 4; folders: 5; recent: 5 };
  export function buildPaletteSections(input: {
    query: string;
    commands: Array<{ command: WorkspaceCommand; label: string }>;
    notes: NoteItem[]; transcripts: TranscriptionItem[];
    conversations: Array<{ id: number; title: string; updated_at: string }>;
    containers: Array<{ spaceId: number; folderId: number | null; label: string }>;
  }): PaletteSection[];
  export type PaletteSelection =
    | { type: "command"; command: WorkspaceCommand }
    | { type: "note"; noteId: number; folderId: number | null; spaceId: number }
    | { type: "transcript"; transcriptId: number }
    | { type: "conversation"; conversationId: number }
    | { type: "container"; spaceId: number; folderId: number | null }
    | { type: "showAllTranscripts"; query: string }
    | { type: "askDraft"; draft: string };  // there is deliberately no "send" selection
  export function resolvePaletteSelection(row: PaletteRow, query: string): PaletteSelection;
  ```

- Section order with a query: Commands, Notes, Meetings, Transcripts, Chats, Folders. With an empty query: Suggested, then Recent (5, across notes, dictations and chats, newest first). When no section has rows, one "nothing" section holds the Ask row.

- [ ] **Step 1: Write the failing tests**

Create `test/lib/fuzzyMatch.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/fuzzyMatch.ts");

test("a contiguous match ranks above a scattered one and reports its range", async () => {
  const { fuzzyMatch } = await load();
  const contiguous = fuzzyMatch("meet", "Record meeting");
  const scattered = fuzzyMatch("meet", "Move every entry today");
  assert.deepEqual(contiguous.ranges, [[7, 11]]);
  assert.ok(scattered && contiguous.score > scattered.score);
});

test("word starts beat mid-word hits", async () => {
  const { fuzzyMatch } = await load();
  assert.ok(fuzzyMatch("no", "New note").score > fuzzyMatch("no", "Piano").score);
});

test("subsequence ranges merge consecutive characters", async () => {
  const { fuzzyMatch } = await load();
  assert.deepEqual(fuzzyMatch("gnot", "Go to Notes").ranges, [[0, 1], [6, 9]]);
});

test("case and missing characters", async () => {
  const { fuzzyMatch } = await load();
  assert.ok(fuzzyMatch("PRICING", "pricing review"));
  assert.equal(fuzzyMatch("xyz", "pricing"), null);
  assert.deepEqual(fuzzyMatch("", "anything"), { score: 0, ranges: [] });
});

test("transcripts use substring matching only", async () => {
  const { substringMatch } = await load();
  assert.deepEqual(substringMatch("thurs", "goes out Thursday").ranges, [[9, 14]]);
  assert.equal(substringMatch("gout", "goes out Thursday"), null);
});

test("highlight segments cover the whole string in order", async () => {
  const { highlightSegments } = await load();
  assert.deepEqual(highlightSegments("Record meeting", [[7, 11]]), [
    { text: "Record ", match: false },
    { text: "meet", match: true },
    { text: "ing", match: false },
  ]);
  assert.deepEqual(highlightSegments("abc", []), [{ text: "abc", match: false }]);
});
```

Create `test/components/workspaceCommands.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const loadCommands = () => import("../../src/components/commandSearch/commands.ts");
const loadShortcuts = () => import("../../src/lib/workspaceShortcuts.ts");

test("every command has a unique id, a label key and a working hint", async () => {
  const { WORKSPACE_COMMANDS } = await loadCommands();
  const { shortcutHint } = await loadShortcuts();
  const ids = WORKSPACE_COMMANDS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const command of WORKSPACE_COMMANDS) {
    assert.match(command.labelKey, /^commandSearch\.commands\./);
    if (command.shortcut) assert.notEqual(shortcutHint(command.shortcut, "darwin"), "", command.id);
  }
});

test("suggested commands exist, in R5 A order", async () => {
  const { WORKSPACE_COMMANDS, SUGGESTED_COMMAND_IDS } = await loadCommands();
  assert.deepEqual(SUGGESTED_COMMAND_IDS, ["newNote", "startDictation", "askAssistant", "goNotes"]);
  for (const id of SUGGESTED_COMMAND_IDS) assert.ok(WORKSPACE_COMMANDS.some((c) => c.id === id), id);
});

test("commands only navigate or toggle; none sends content anywhere", async () => {
  const { WORKSPACE_COMMANDS } = await loadCommands();
  const calls = [];
  const nav = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
  const deps = {
    toggleDictation: () => calls.push(["toggleDictation"]),
    toggleTheme: () => calls.push(["toggleTheme"]),
    speechSettingsPath: () => "stt/dictation",
  };
  for (const command of WORKSPACE_COMMANDS) command.run(nav, deps);
  assert.ok(calls.some(([name, arg]) => name === "openSettings" && arg === "stt/dictation"), "Switch speech model opens the dictation route's settingsPath (§5.1)");
  const allowed = new Set([
    "newNote", "toggleDictation", "focusAssistant", "openView", "recordMeeting", "openUpload", "startChat", "openSettings", "toggleTheme",
  ]);
  for (const [name, arg] of calls) {
    assert.ok(allowed.has(name), name);
    if (name === "startChat") assert.equal(arg?.draft, undefined);
  }
});
```

Create `test/components/paletteSections.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const loadSections = () => import("../../src/components/commandSearch/paletteSections.ts");
const loadCommands = () => import("../../src/components/commandSearch/commands.ts");

const labelled = async () => {
  const { WORKSPACE_COMMANDS } = await loadCommands();
  const labels = { newNote: "New note", recordMeeting: "Record meeting", goNotes: "Go to Notes" };
  return WORKSPACE_COMMANDS.map((command) => ({ command, label: labels[command.id] ?? command.id }));
};
const note = (id, title, note_type = "personal", updated_at = "2026-10-14 10:00:00") => ({ id, title, note_type, folder_id: 2, space_id: 1, updated_at, created_at: updated_at });
const tx = (id, text, timestamp = "2026-10-14 09:00:00") => ({ id, text, timestamp, created_at: timestamp, status: "completed" });

test("an empty query shows Suggested then Recent", async () => {
  const { buildPaletteSections } = await loadSections();
  const sections = buildPaletteSections({
    query: "",
    commands: await labelled(),
    notes: [note(1, "Pricing FAQ draft", "personal", "2026-10-14 08:00:00")],
    transcripts: [tx(9, "Let's set aside some time", "2026-10-14 19:51:00")],
    conversations: [{ id: 3, title: "Pricing decision summary", updated_at: "2026-10-14 12:00:00" }],
    containers: [],
  });
  assert.deepEqual(sections.map((s) => s.id), ["suggested", "recent"]);
  assert.deepEqual(sections[0].rows.map((r) => r.command.id), ["newNote", "startDictation", "askAssistant", "goNotes"]);
  assert.deepEqual(sections[1].rows.map((r) => r.key), ["transcript-9", "conversation-3", "note-1"]);
});

test("results are ordered Commands, Notes, Meetings, Transcripts, Chats", async () => {
  const { buildPaletteSections } = await loadSections();
  const sections = buildPaletteSections({
    query: "meet",
    commands: await labelled(),
    notes: [note(1, "Meeting prep"), note(2, "Design sync", "meeting")],
    transcripts: [tx(5, "bring notes to the meeting")],
    conversations: [{ id: 3, title: "meeting recap", updated_at: "2026-10-14 12:00:00" }],
    containers: [],
  });
  assert.deepEqual(sections.map((s) => s.id), ["commands", "notes", "meetings", "transcripts", "chats"]);
  assert.equal(sections[0].rows[0].command.id, "recordMeeting");
  assert.deepEqual(sections[0].rows[0].ranges, [[7, 11]]);
});

test("transcripts cap at 8 with a See all row that carries the total", async () => {
  const { buildPaletteSections } = await loadSections();
  const transcripts = Array.from({ length: 11 }, (_, i) => tx(i + 1, `standup item ${i}`));
  const sections = buildPaletteSections({ query: "standup", commands: [], notes: [], transcripts, conversations: [], containers: [] });
  const rows = sections.find((s) => s.id === "transcripts").rows;
  assert.equal(rows.filter((r) => r.kind === "transcript").length, 8);
  assert.deepEqual(rows.at(-1), { kind: "seeAllTranscripts", key: "see-all-transcripts", total: 11 });
});

test("nothing found offers to ask the assistant, which only seeds a draft", async () => {
  const { buildPaletteSections, resolvePaletteSelection } = await loadSections();
  const sections = buildPaletteSections({ query: "what did we decide", commands: [], notes: [], transcripts: [], conversations: [], containers: [] });
  assert.deepEqual(sections, [{ id: "nothing", rows: [{ kind: "ask", key: "ask", query: "what did we decide" }] }]);
  assert.deepEqual(resolvePaletteSelection(sections[0].rows[0], "what did we decide"), {
    type: "askDraft",
    draft: "what did we decide",
  });
});

test("a transcript hit deep-links by id; See all keeps the query", async () => {
  const { resolvePaletteSelection } = await loadSections();
  assert.deepEqual(resolvePaletteSelection({ kind: "transcript", key: "transcript-9", transcript: tx(9, "x"), ranges: [] }, "x"), {
    type: "transcript",
    transcriptId: 9,
  });
  assert.deepEqual(resolvePaletteSelection({ kind: "seeAllTranscripts", key: "see-all-transcripts", total: 11 }, " standup "), {
    type: "showAllTranscripts",
    query: "standup",
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/lib/fuzzyMatch.test.js test/components/workspaceCommands.test.js test/components/paletteSections.test.js`
Expected: FAIL with `Cannot find module` for all three.

- [ ] **Step 3: Implement**

1. Create `src/lib/fuzzyMatch.ts`:

   ```ts
   export type MatchRange = readonly [start: number, end: number];
   export interface FuzzyMatch {
     score: number;
     ranges: MatchRange[];
   }

   const isWordStart = (text: string, index: number) => index === 0 || /[\s\-_/.(]/.test(text[index - 1]);

   export function substringMatch(query: string, text: string): FuzzyMatch | null {
     const needle = query.trim().toLocaleLowerCase();
     if (!needle) return { score: 0, ranges: [] };
     const index = text.toLocaleLowerCase().indexOf(needle);
     if (index < 0) return null;
     const score = 1000 - index * 2 - (text.length - needle.length) * 0.1 + (isWordStart(text, index) ? 100 : 0);
     return { score, ranges: [[index, index + needle.length]] };
   }

   // Contiguous matches first; otherwise an in-order subsequence (cmdk-style),
   // rewarded for word starts and runs. Scores below 500 are always subsequences.
   export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
     const direct = substringMatch(query, text);
     if (direct) return direct;
     const needle = query.trim().toLocaleLowerCase().replace(/\s+/g, "");
     const haystack = text.toLocaleLowerCase();
     const ranges: Array<[number, number]> = [];
     let score = 0;
     let from = 0;
     for (const char of needle) {
       const index = haystack.indexOf(char, from);
       if (index < 0) return null;
       const last = ranges.at(-1);
       if (last && last[1] === index) {
         last[1] = index + 1;
         score += 8;
       } else {
         ranges.push([index, index + 1]);
       }
       score += isWordStart(text, index) ? 12 : 2;
       from = index + 1;
     }
     return { score: Math.min(score, 499) - from * 0.05, ranges };
   }

   export function highlightSegments(
     text: string,
     ranges: readonly MatchRange[]
   ): Array<{ text: string; match: boolean }> {
     const segments: Array<{ text: string; match: boolean }> = [];
     let cursor = 0;
     for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
       if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
       segments.push({ text: text.slice(start, end), match: true });
       cursor = end;
     }
     if (cursor < text.length || segments.length === 0) segments.push({ text: text.slice(cursor), match: false });
     return segments;
   }
   ```

2. Create `src/components/commandSearch/commands.ts`:

   ```ts
   import { AudioLines, Cpu, Home, MessageSquare, MessageSquarePlus, Mic, NotebookPen, Plus, Settings, SunMoon, Upload, Sparkles } from "lucide-react";
   import type { WorkspaceAction } from "../../lib/workspaceShortcuts";
   import type { WorkspaceNavigation } from "../workspaceNavigation";

   export interface CommandDeps {
     toggleDictation(): void;
     toggleTheme(): void;
     /** The dictationStt route's settingsPath, read at click time (§5.1). */
     speechSettingsPath(): string;
   }

   export interface WorkspaceCommand {
     id:
       | "newNote" | "startDictation" | "askAssistant" | "goNotes" | "goHome" | "goChat"
       | "recordMeeting" | "uploadAudio" | "newChat" | "openSettings" | "switchSpeechModel" | "toggleTheme";
     labelKey: string;
     keywords: readonly string[];
     shortcut?: WorkspaceAction;
     usesHotkey?: boolean;
     icon: React.ComponentType<{ size?: number; className?: string }>;
     run(nav: WorkspaceNavigation, deps: CommandDeps): void;
   }

   const k = (id: string) => `commandSearch.commands.${id}`;

   // WS-R5 A. Every command navigates or toggles; none sends content anywhere.
   export const WORKSPACE_COMMANDS: readonly WorkspaceCommand[] = [
     { id: "newNote", labelKey: k("newNote"), keywords: ["create", "write"], shortcut: "newNote", icon: Plus, run: (nav) => nav.newNote() },
     { id: "startDictation", labelKey: k("startDictation"), keywords: ["dictate", "mic", "voice", "record"], usesHotkey: true, icon: Mic, run: (_nav, deps) => deps.toggleDictation() },
     { id: "askAssistant", labelKey: k("askAssistant"), keywords: ["chat", "ai", "question"], shortcut: "askAssistant", icon: Sparkles, run: (nav) => nav.focusAssistant() },
     { id: "goNotes", labelKey: k("goNotes"), keywords: ["notes", "spaces"], shortcut: "goNotes", icon: NotebookPen, run: (nav) => nav.openView("personal-notes") },
     { id: "goHome", labelKey: k("goHome"), keywords: ["home", "history", "today"], shortcut: "goHome", icon: Home, run: (nav) => nav.openView("home") },
     { id: "goChat", labelKey: k("goChat"), keywords: ["chat", "conversations"], shortcut: "goChat", icon: MessageSquare, run: (nav) => nav.openView("chat") },
     { id: "recordMeeting", labelKey: k("recordMeeting"), keywords: ["meeting", "call", "transcribe"], shortcut: "recordMeeting", icon: AudioLines, run: (nav) => nav.recordMeeting() },
     { id: "uploadAudio", labelKey: k("uploadAudio"), keywords: ["file", "import", "audio"], shortcut: "uploadAudio", icon: Upload, run: (nav) => nav.openUpload() },
     { id: "newChat", labelKey: k("newChat"), keywords: ["conversation", "assistant"], shortcut: "newChat", icon: MessageSquarePlus, run: (nav) => nav.startChat() },
     { id: "openSettings", labelKey: k("openSettings"), keywords: ["preferences", "options"], shortcut: "openSettings", icon: Settings, run: (nav) => nav.openSettings() },
     { id: "switchSpeechModel", labelKey: k("switchSpeechModel"), keywords: ["model", "transcription", "whisper", "parakeet"], icon: Cpu, run: (nav, deps) => nav.openSettings(deps.speechSettingsPath()) },
     { id: "toggleTheme", labelKey: k("toggleTheme"), keywords: ["dark", "light", "appearance", "theme"], icon: SunMoon, run: (_nav, deps) => deps.toggleTheme() },
   ];

   export const SUGGESTED_COMMAND_IDS: readonly WorkspaceCommand["id"][] = ["newNote", "startDictation", "askAssistant", "goNotes"];
   ```

   Spec §5.1 guarantees that a route's `settingsPath` is a valid `SettingsModal` section, so the command opens the dictation route's own page instead of the legacy `"transcription"` alias, which Plan 03's restructured Settings need not keep.

3. Create `src/components/commandSearch/paletteSections.ts`:

   ```ts
   import type { NoteItem, TranscriptionItem } from "../../types/electron";
   import { fuzzyMatch, substringMatch, type MatchRange } from "../../lib/fuzzyMatch";
   import { parseDbTimestamp } from "../../lib/homeFeed";
   import { SUGGESTED_COMMAND_IDS, type WorkspaceCommand } from "./commands";

   export type PaletteSectionId =
     "suggested" | "recent" | "commands" | "notes" | "meetings" | "transcripts" | "chats" | "folders" | "nothing";
   type Conversation = { id: number; title: string; updated_at: string };
   type Container = { spaceId: number; folderId: number | null; label: string };

   export type PaletteRow =
     | { kind: "command"; key: string; command: WorkspaceCommand; label: string; ranges: MatchRange[] }
     | { kind: "note" | "meeting"; key: string; note: NoteItem; ranges: MatchRange[] }
     | { kind: "transcript"; key: string; transcript: TranscriptionItem; ranges: MatchRange[] }
     | { kind: "conversation"; key: string; conversation: Conversation; ranges: MatchRange[] }
     | { kind: "container"; key: string; target: Container; ranges: MatchRange[] }
     | { kind: "seeAllTranscripts"; key: string; total: number }
     | { kind: "ask"; key: string; query: string };

   export interface PaletteSection {
     id: PaletteSectionId;
     rows: PaletteRow[];
   }

   export const PALETTE_CAPS = { commands: 6, notes: 6, meetings: 4, transcripts: 8, chats: 4, folders: 5, recent: 5 } as const;

   const noteRow = (note: NoteItem, ranges: MatchRange[]): PaletteRow => {
     const kind = note.note_type === "meeting" ? "meeting" : "note";
     return { kind, key: `${kind}-${note.id}`, note, ranges };
   };

   export function buildPaletteSections(input: {
     query: string;
     commands: Array<{ command: WorkspaceCommand; label: string }>;
     notes: NoteItem[];
     transcripts: TranscriptionItem[];
     conversations: Conversation[];
     containers: Container[];
   }): PaletteSection[] {
     const query = input.query.trim();
     if (!query) {
       const suggested = SUGGESTED_COMMAND_IDS.map((id) => input.commands.find((c) => c.command.id === id))
         .filter((c): c is { command: WorkspaceCommand; label: string } => !!c)
         .map<PaletteRow>(({ command, label }) => ({ kind: "command", key: `command-${command.id}`, command, label, ranges: [] }));
       const recent = [
         ...input.notes.map((n) => ({ at: parseDbTimestamp(n.updated_at), row: noteRow(n, []) })),
         ...input.transcripts.map((t) => ({
           at: parseDbTimestamp(t.timestamp),
           row: { kind: "transcript", key: `transcript-${t.id}`, transcript: t, ranges: [] } as PaletteRow,
         })),
         ...input.conversations.map((c) => ({
           at: parseDbTimestamp(c.updated_at),
           row: { kind: "conversation", key: `conversation-${c.id}`, conversation: c, ranges: [] } as PaletteRow,
         })),
       ]
         .filter((entry) => !Number.isNaN(entry.at))
         .sort((a, b) => b.at - a.at)
         .slice(0, PALETTE_CAPS.recent)
         .map((entry) => entry.row);
       return [
         { id: "suggested", rows: suggested },
         { id: "recent", rows: recent },
       ].filter((s) => s.rows.length > 0) as PaletteSection[];
     }

     const commands = input.commands
       .map(({ command, label }) => {
         const onLabel = fuzzyMatch(query, label);
         const onKeyword = command.keywords.some((word) => word.startsWith(query.toLocaleLowerCase()));
         if (!onLabel && !onKeyword) return null;
         return { score: onLabel?.score ?? 1, row: { kind: "command", key: `command-${command.id}`, command, label, ranges: onLabel?.ranges ?? [] } as PaletteRow };
       })
       .filter((hit): hit is { score: number; row: PaletteRow } => !!hit)
       .sort((a, b) => b.score - a.score)
       .slice(0, PALETTE_CAPS.commands)
       .map((hit) => hit.row);

     // Notes come from the database search already; only highlight.
     const titled = input.notes.map((n) => noteRow(n, fuzzyMatch(query, n.title ?? "")?.ranges ?? []));
     const notes = titled.filter((r) => r.kind === "note").slice(0, PALETTE_CAPS.notes);
     const meetings = titled.filter((r) => r.kind === "meeting").slice(0, PALETTE_CAPS.meetings);

     const transcriptHits = input.transcripts
       .map((t) => ({ t, match: substringMatch(query, t.text ?? "") }))
       .filter((hit) => hit.match);
     const transcripts: PaletteRow[] = transcriptHits.slice(0, PALETTE_CAPS.transcripts).map(({ t, match }) => ({
       kind: "transcript",
       key: `transcript-${t.id}`,
       transcript: t,
       ranges: match!.ranges,
     }));
     if (transcriptHits.length > PALETTE_CAPS.transcripts) {
       transcripts.push({ kind: "seeAllTranscripts", key: "see-all-transcripts", total: transcriptHits.length });
     }

     const chats: PaletteRow[] = input.conversations.slice(0, PALETTE_CAPS.chats).map((c) => ({
       kind: "conversation",
       key: `conversation-${c.id}`,
       conversation: c,
       ranges: fuzzyMatch(query, c.title)?.ranges ?? [],
     }));

     const folders: PaletteRow[] = input.containers
       .map((target) => ({ target, match: fuzzyMatch(query, target.label) }))
       .filter((hit) => hit.match)
       .slice(0, PALETTE_CAPS.folders)
       .map(({ target, match }) => ({ kind: "container", key: `container-${target.spaceId}-${target.folderId}`, target, ranges: match!.ranges }));

     const sections = (
       [
         { id: "commands", rows: commands },
         { id: "notes", rows: notes },
         { id: "meetings", rows: meetings },
         { id: "transcripts", rows: transcripts },
         { id: "chats", rows: chats },
         { id: "folders", rows: folders },
       ] as PaletteSection[]
     ).filter((section) => section.rows.length > 0);
     return sections.length > 0 ? sections : [{ id: "nothing", rows: [{ kind: "ask", key: "ask", query }] }];
   }

   export type PaletteSelection =
     | { type: "command"; command: WorkspaceCommand }
     | { type: "note"; noteId: number; folderId: number | null; spaceId: number }
     | { type: "transcript"; transcriptId: number }
     | { type: "conversation"; conversationId: number }
     | { type: "container"; spaceId: number; folderId: number | null }
     | { type: "showAllTranscripts"; query: string }
     | { type: "askDraft"; draft: string };

   export function resolvePaletteSelection(row: PaletteRow, query: string): PaletteSelection {
     switch (row.kind) {
       case "command": return { type: "command", command: row.command };
       case "note":
       case "meeting": return { type: "note", noteId: row.note.id, folderId: row.note.folder_id ?? null, spaceId: row.note.space_id };
       case "transcript": return { type: "transcript", transcriptId: row.transcript.id };
       case "conversation": return { type: "conversation", conversationId: row.conversation.id };
       case "container": return { type: "container", spaceId: row.target.spaceId, folderId: row.target.folderId };
       case "seeAllTranscripts": return { type: "showAllTranscripts", query: query.trim() };
       case "ask": return { type: "askDraft", draft: row.query };
     }
   }
   ```

   In the "meet" test, the "Record meeting" label scores a substring hit at index 7 with a word-start bonus. "Meeting prep" is a note, not a command. So `commands[0]` is `recordMeeting`.

4. In `src/components/CommandSearch.tsx`, for `mode="all"` only:
   - Imports:

     ```ts
     import { useWorkspaceNavigation } from "./workspaceNavigation";
     import { WORKSPACE_COMMANDS, type CommandDeps } from "./commandSearch/commands";
     import { buildPaletteSections, resolvePaletteSelection, type PaletteRow, type PaletteSection } from "./commandSearch/paletteSections";
     import { highlightSegments, type MatchRange } from "../lib/fuzzyMatch";
     import { shortcutHint } from "../lib/workspaceShortcuts";
     import { showHomeQuery } from "../stores/homeViewStore";
     import { useSettingsStore } from "../stores/settingsStore";
     import { useHotkey } from "../hooks/useHotkey";
     import { formatHotkeyLabel, parseHotkeyList } from "../utils/hotkeys";
     ```

   - Conversations for `mode="all"`: add state `const [paletteChats, setPaletteChats] = useState<ConversationResult[]>([])`. Fill it inside the existing debounced search effect (`:141-199`) next to the notes search:
     - with a query: `window.electronAPI.semanticSearchConversations?.(query, 4)`;
     - with an empty query: `window.electronAPI.getAgentConversationsWithPreview?.(5, 0, false)`.

     Keep stale results on failure, as the notes search does (WS-R5 A: "stale results stay on DB failure").
   - Build the sections. This replaces the `flatItems` construction and the caps at `:265`/`:272`:

     ```ts
     const navigation = useWorkspaceNavigation();
     const setTheme = useSettingsStore((s) => s.setTheme);
     const { hotkey } = useHotkey();
     const deps: CommandDeps = {
       toggleDictation: () => void window.electronAPI?.toggleDictationFromControlPanel?.(),
       toggleTheme: () => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark"),
       // Click-time read (§5.1): no subscription, no IPC. Import resolveRoute and
       // routeSnapshotFromSettings from ../lib/routes.
       speechSettingsPath: () => resolveRoute(routeSnapshotFromSettings(useSettingsStore.getState()), "dictationStt").settingsPath,
     };
     const sections: PaletteSection[] = useMemo(
       () =>
         buildPaletteSections({
           query,
           commands: WORKSPACE_COMMANDS.map((command) => ({ command, label: t(command.labelKey) })),
           notes: scopedNotes,
           transcripts: transcriptions ?? [],
           conversations: paletteChats,
           containers: jumpTargets.map((target) => ({ spaceId: target.spaceId, folderId: target.folderId, label: target.label })),
         }),
       [query, scopedNotes, transcriptions, paletteChats, jumpTargets, t]
     );
     const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);
     ```

     `scopedNotes` (`:220`) and the `jumpTargets` memo (`:244-266`) already exist. In `jumpTargets`, change `return targets.slice(0, 5);` to `return targets;`, because `PALETTE_CAPS.folders` caps them now. Delete the old transcript `.slice(0, 5)` at `:272`.
   - Replace `selectItem` (`:286-296`) with:

     ```ts
     const selectRow = (row: PaletteRow) => {
       const selection = resolvePaletteSelection(row, query);
       onOpenChange(false);
       switch (selection.type) {
         case "command": return selection.command.run(navigation, deps);
         case "note": return onNoteSelect?.(selection.noteId, selection.folderId, selection.spaceId);
         case "transcript": return onTranscriptSelect?.(selection.transcriptId);
         case "conversation": return onConversationSelect?.(selection.conversationId);
         case "container": return onContainerSelect?.(selection.spaceId, selection.folderId);
         case "showAllTranscripts":
           showHomeQuery(selection.query);
           return navigation.openView("home");
         case "askDraft":
           // Seeds the composer; the user sees the model chip and sends it themselves.
           return navigation.startChat({ draft: selection.draft });
       }
     };
     ```

   - Keyboard (`:298-313`): keep ArrowUp, ArrowDown and Enter over `rows`, with Enter calling `selectRow(rows[selectedIndex])`. Add Tab and Shift+Tab to cycle the space scope when `spaces.length > 1`:

     ```ts
     if (e.key === "Tab" && spaces.length > 1) {
       e.preventDefault();
       const order = [null, ...spaces.map((space) => space.id)];
       const current = order.indexOf(scopeSpaceId ?? null);
       const next = order[(current + (e.shiftKey ? order.length - 1 : 1)) % order.length];
       selectScope(next);
     }
     ```

     `selectScope` is at `:213`. Pass `null` for "All spaces", matching how the existing dropdown item calls it.
   - Rendering (`:473-550`): one block per section, with a `SectionHeader` titled `t(\`commandSearch.sections.${section.id}\`)` (except `nothing`, which has no header). Each row is a `min-h-10` button with `data-idx`:
     - an 18px icon tile;
     - a `text-ui` title rendered through `<Highlighted text={…} ranges={row.ranges} />`;
     - `text-caption text-muted-foreground` meta:
       - notes: the folder name, or "Meeting";
       - transcripts: `formatRelativeTime`;
       - chats: "Chat";
     - a right-aligned `kbd` for commands with `shortcut`/`usesHotkey`, showing `shortcutHint(command.shortcut, platform)` or `formatHotkeyLabel(parseHotkeyList(hotkey)[0])`.

     The `nothing` section renders `<p className="px-3 pt-3 text-ui text-muted-foreground">{t("commandSearch.nothingMatches", { query })}</p>` above its Ask row, as the R5 A card specifies: "Nothing matches" plus the Ask row.

     The two special rows:
     - **See all:** `t("commandSearch.seeAllTranscripts", { count: row.total })`.
     - **Ask:** a `Sparkles` icon in `text-ai-text`, `t("commandSearch.askAssistant", { query: row.query })`, and a trailing `↵` kbd.

     ```tsx
     function Highlighted({ text, ranges }: { text: string; ranges: MatchRange[] }) {
       return (
         <span dir="auto" className="truncate">
           {highlightSegments(text, ranges).map((segment, index) =>
             segment.match ? (
               // D1: the match wash uses the link tone, not live orange.
               <mark key={index} className="rounded-sm bg-link/12 font-semibold text-foreground">{segment.text}</mark>
             ) : (
               <Fragment key={index}>{segment.text}</Fragment>
             )
           )}
         </span>
       );
     }
     ```

   - Placeholder: `t("commandSearch.placeholderAll")` in `mode="all"`. Keep `commandSearch.placeholder` for conversations mode.
   - Footer (`:556-560`, `FooterHint` at `:761-776`):
     - Hints: `↑↓ Navigate · ↵ Open · Tab Scope · Esc Close`. Show Tab Scope only when `spaces.length > 1`.
     - The kbd class becomes `text-micro px-1 py-px rounded border border-border bg-muted text-muted-foreground font-mono leading-tight`, with no `/55` and no 10px.
   - Keep `fieldDirectionPolicy.test.js:76` passing. The input keeps `dir="auto"`.

5. Add strings (Task 1 helper). English block:

   ```json
   {
     "commandSearch": {
       "placeholderAll": "Search notes, meetings, or run a command…",
       "sections": {
         "suggested": "Suggested",
         "recent": "Recent",
         "commands": "Commands",
         "meetings": "Meetings",
         "chats": "Chats",
         "folders": "Folders"
       },
       "commands": {
         "newNote": "New note",
         "startDictation": "Start dictation",
         "askAssistant": "Ask the assistant",
         "goNotes": "Go to Notes",
         "goHome": "Go to Home",
         "goChat": "Go to Chat",
         "recordMeeting": "Record meeting",
         "uploadAudio": "Upload audio…",
         "newChat": "New chat",
         "openSettings": "Open settings",
         "switchSpeechModel": "Switch speech model…",
         "toggleTheme": "Toggle dark theme"
       },
       "seeAllTranscripts_one": "See {{count}} match in History",
       "seeAllTranscripts_other": "See all {{count}} in History",
       "askAssistant": "Ask the assistant: “{{query}}”",
       "nothingMatches": "Nothing matches “{{query}}”.",
       "meta": { "meeting": "Meeting", "chat": "Chat" },
       "footer": { "scope": "Scope", "close": "Close" }
     }
   }
   ```

   `commandSearch.sections.notes`, `.transcripts` and `.jumpTo` already exist. `jumpTo` becomes unused once "Folders" replaces it. Delete it from every locale only if a grep shows no other use.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/lib/fuzzyMatch.test.js test/components/workspaceCommands.test.js test/components/paletteSections.test.js test/components/fieldDirectionPolicy.test.js test/components/directionalContentPolicy.test.js test/locales/translationCoverage.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fuzzyMatch.ts src/components/commandSearch src/components/CommandSearch.tsx src/locales test/lib/fuzzyMatch.test.js test/components/workspaceCommands.test.js test/components/paletteSections.test.js
git commit -m "feat(search): turn the palette into a command surface with deep-linked results"
```

---

### Task 14: Note document typography

This covers the WS-R6 B type ramp in the note body and title, and interpretation 3.

**Files:**
- Modify: `src/index.css`. Change the TipTap block at `:1662-1840`:
  - `.rich-text-editor-content` at `:1664`;
  - `h1` at `:1677`, `h2` at `:1684`, `h3` at `:1691`;
  - `code` at `:1746`;
  - add `a` and `> *` measure rules.
- Modify: `src/components/notes/NoteEditor.tsx`. Change the title classes at `:668-681`.
- Modify: `DESIGN.md`. No new section; Task 2's "Note document ramp" already documents this. Verify the values match.
- Test: `test/components/noteTypography.test.js`

**Interfaces:** CSS only. The `.rich-text-editor-content` selector, `dir: "auto"` and `unicode-bidi: plaintext` stay (`fieldDirectionPolicy.test.js:159-160`).

- [ ] **Step 1: Write the failing test**

Create `test/components/noteTypography.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const css = fs.readFileSync(path.join(root, "src/index.css"), "utf8");
const editor = fs.readFileSync(path.join(root, "src/components/notes/NoteEditor.tsx"), "utf8");
const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing ${selector}`);
  return match[1];
};

test("body is 16/1.65 at a 68ch measure, and stays plaintext-bidi", () => {
  const body = rule(".rich-text-editor-content");
  assert.match(body, /font-size:\s*1rem/);
  assert.match(body, /line-height:\s*1\.65/);
  assert.match(body, /unicode-bidi:\s*plaintext/);
  assert.match(rule(".rich-text-editor-content > *"), /max-width:\s*68ch/);
});

test("headings follow the R6 B ramp", () => {
  const expect = { h1: ["1.5rem", "1.25", "650"], h2: ["1.1875rem", "1.3", "600"], h3: ["1rem", "1.4", "600"] };
  for (const [tag, [size, lh, weight]] of Object.entries(expect)) {
    const body = rule(`.rich-text-editor-content ${tag}`);
    assert.match(body, new RegExp(`font-size:\\s*${size.replace(".", "\\.")}`), tag);
    assert.match(body, new RegExp(`line-height:\\s*${lh.replace(".", "\\.")}`), tag);
    assert.match(body, new RegExp(`font-weight:\\s*${weight}`), tag);
  }
  assert.match(rule(".rich-text-editor-content code"), /font-size:\s*0\.875rem/);
});

test("links in notes use the link role, not orange-on-white", () => {
  assert.match(rule(".rich-text-editor-content a"), /color:\s*var\(--color-link\)/);
});

test("the note title is 32/1.15 semibold", () => {
  assert.match(editor, /ref=\{titleRef\}[\s\S]{0,400}text-display font-semibold/);
  assert.doesNotMatch(editor, /ref=\{titleRef\}[\s\S]{0,400}text-3xl/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/components/noteTypography.test.js`
Expected: FAIL. `font-size: 1rem` is missing because the body is `0.875rem`, and `.rich-text-editor-content > *` is missing.

- [ ] **Step 3: Implement**

1. In `src/index.css`, in `.rich-text-editor-content { … }` (`:1664`), change `font-size: 0.875rem; line-height: 1.7;` to `font-size: 1rem; line-height: 1.65;`. Directly after that block, add:

   ```css
   /* WS-R6 B: a readable measure. Blocks cap at 68ch inside the page padding. */
   .rich-text-editor-content > * {
     max-width: 68ch;
   }
   ```

2. Replace the `h1`, `h2` and `h3` rules (`:1677-1696`) with:

   ```css
   .rich-text-editor-content h1 {
     font-size: 1.5rem;
     line-height: 1.25;
     font-weight: 650;
     letter-spacing: -0.015em;
     margin-top: 1.5rem;
     margin-bottom: 0.5rem;
   }
   .rich-text-editor-content h2 {
     font-size: 1.1875rem;
     line-height: 1.3;
     font-weight: 600;
     margin-top: 1.25rem;
     margin-bottom: 0.375rem;
   }
   .rich-text-editor-content h3 {
     font-size: 1rem;
     line-height: 1.4;
     font-weight: 600;
     margin-top: 1rem;
     margin-bottom: 0.25rem;
   }
   ```

3. In `.rich-text-editor-content code` (`:1746`), change `font-size: 0.8125rem` to `font-size: 0.875rem`. Add after it:

   ```css
   .rich-text-editor-content a {
     color: var(--color-link);
     text-decoration: underline;
     text-decoration-color: color-mix(in oklch, var(--color-link) 35%, transparent);
     text-underline-offset: 2px;
   }
   ```

   In Plum Night, `--color-link` is `#ff9a7a` (Plan 01), so no dark override is needed.

4. In `src/components/notes/NoteEditor.tsx`, in the title `className` (`:668-681`), replace `text-3xl font-medium leading-tight … tracking-[-0.01em]` with `text-display font-semibold`. `text-display` carries 32px/1.15/-0.02em, and `font-semibold` overrides its 650 weight to the R6 B 600.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/noteTypography.test.js test/components/fieldDirectionPolicy.test.js test/components/directionalContentPolicy.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/components/notes/NoteEditor.tsx test/components/noteTypography.test.js
git commit -m "feat(notes): give notes a real type hierarchy and a readable measure"
```

---

### Task 15: Slash menu

This covers WS-R6 B (`/` opens blocks, AI actions and inserts) and interpretation 5.

**Files:**
- Create: `src/components/ui/editor/suggestionPopup.ts`, `src/components/ui/editor/slashItems.ts`, `src/components/ui/editor/SlashCommand.ts`, `src/components/ui/editor/SlashMenu.tsx`
- Modify: `src/components/ui/RichTextEditorMention.tsx`. `suggestionRender` (`:20-64`) moves into `suggestionPopup.ts`, which this file then uses.
- Modify: `src/components/ui/RichTextEditor.tsx`. Add props (`:12-21`) and an extension (`:43-62`).
- Modify: `src/components/notes/NoteEditor.tsx`. Pass `slash` to the raw-notes editor (`:965-973`).
- Modify: `src/components/notes/PersonalNotesView.tsx`. Build the `slash` value next to `runNoteAction` (`:618`).
- Test: `test/components/slashItems.test.js`, `test/components/suggestionPopup.test.js`, `test/components/slashMenu.test.js`

**Interfaces:**
- Consumes:
  - `ActionItem` (`src/types/electron.ts:298`);
  - `useActions()` (`src/stores/actionStore.ts`);
  - `useResolvedRoute("noteFormatting")` and `RouteState` (§5.1, Plan 03), which decide AI readiness (review I09);
  - `runNoteAction` (`PersonalNotesView.tsx:618`);
  - `toggleDictationFromControlPanel` (Task 5).

  `useNotesOnboarding().isLLMConfigured` is **not** used. It is `!!cleanupModel`, which is non-empty by default (`settingsStore.ts:1420`) before any model is downloaded. Plan 02 (P02:3341) documents that it is not readiness.
- Produces `suggestionPopup.ts`:

  ```ts
  export interface SuggestionHandle { onKeyDown: (event: KeyboardEvent) => boolean }
  export function popupPosition(rect: { left: number; top: number; bottom: number }, viewport: { width: number; height: number }, size: { width: number; height: number }): { left: number; top: number };
  export type SuggestionPopupComponent<P> = ForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<SuggestionHandle>>;
  export function createSuggestionPopup<Item, P extends object>(
    component: SuggestionPopupComponent<P>,
    options: { width: number; toProps: (props: SuggestionProps<Item>) => P }
  ): NonNullable<SuggestionOptions<Item>["render"]>;
  ```

  **Typechecked (review I03).** The previous `P extends Record<string, unknown>` failed with TS2344 on both callers, because `SlashMenuProps` and `MentionSuggestionsProps` are interfaces without an index signature.

  The shape above was compiled with TypeScript 6.0.3 against the installed `@tiptap/react`/`@tiptap/suggestion`/`@tiptap/extension-mention` 3.31.3 and `@types/react`. The compiled program contained:
  - this helper;
  - a `forwardRef` `SlashMenu`, with `Suggestion<SlashItem, SlashItem>({ …, render: createSuggestionPopup<SlashItem, SlashMenuProps>(SlashMenu, …) })`;
  - a `forwardRef` `MentionSuggestions`, with `Mention.extend(…).configure({ suggestion: { items, command, render: createSuggestionPopup<MentionSuggestionItem, MentionSuggestionsProps>(…) } })`.

  It compiled clean under `strict: false` (the repo's `src/tsconfig.json`) and `strict: true`. Reverting the constraint to `Record<string, unknown>` reproduces TS2344 on both calls.

  TipTap's `ReactRenderer<R, P extends Record<string, any>>` is the reason for the single `as RendererProps` widening inside the helper. Callers keep their exact prop types.

- Produces `slashItems.ts`:

  ```ts
  export type SlashGroup = "text" | "ai" | "insert";
  export type SlashItemId = "h1" | "h2" | "h3" | "bullet" | "numbered" | "todo" | "quote" | "code"
    | "timestamp" | "dictation" | "mention" | "manageActions" | "setupAi" | `action-${number}`;
  export interface SlashItem { id: SlashItemId; group: SlashGroup; label: string; keywords: readonly string[]; actionId?: number; disabledReason?: string }
  export interface SlashContext {
    items: SlashItem[];
    onRunAction(actionId: number): void;
    onManageActions(): void;
    onSetupAi(): void;          // opens Settings at the noteFormatting route's settingsPath
    onDictateHere(): void;
    formatTimestamp(date: Date): string;
  }
  export function noteAiReadiness(state: RouteState): { available: boolean; reasonKey: string | null; needsSetup: boolean };
  // unknown (§5.1): not available, reason "Checking…", needsSetup false. Never treated as ready.
  export function buildSlashItems(input: { actions: ActionItem[]; aiAvailable: boolean; aiUnavailableReason?: string; aiNeedsSetup?: boolean; t: (key: string) => string }): SlashItem[];
  // Not available: AI items are disabled with the reason, and "Set up notes AI…" leads the group when aiNeedsSetup (default: !aiAvailable).
  export function filterSlashItems(items: SlashItem[], query: string): SlashItem[];
  export function groupSlashItems(items: SlashItem[]): Array<{ group: SlashGroup; items: SlashItem[] }>;
  export function applySlashItem(item: SlashItem, chain: SlashChain, ctx: SlashContext): boolean; // false when disabled
  export interface SlashChain { /* structural subset of ChainedCommands we call */ }
  ```

- Produces `SlashCommand.ts`: `createSlashCommand(getContext: () => SlashContext): Extension`. It is a `@tiptap/suggestion` extension with `char: "/"`, `startOfLine: false` and the default space prefix, so URLs and dates don't trigger it. It is inert inside code blocks.
- `RichTextEditor` prop `slash?: { actions: ActionItem[]; aiAvailable: boolean; aiUnavailableReason?: string; onRunAction(actionId: number): void; onManageActions(): void; onSetupAi(): void; onDictateHere(): void }`. The slash extension is enabled only when `slash` is provided at mount and the editor is editable.

- [ ] **Step 1: Write the failing tests**

Create `test/components/slashItems.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/ui/editor/slashItems.ts");
const t = (key) => `t(${key})`;
const actions = [
  { id: 1, name: "Generate Notes", translation_key: "notes.actions.builtin.generateNotes", sort_order: 0 },
  { id: 7, name: "Pricing digest", translation_key: null, sort_order: 1 },
];

test("Text, AI and Insert groups in that order; AI lists the user's real actions", async () => {
  const { buildSlashItems, groupSlashItems } = await load();
  const groups = groupSlashItems(buildSlashItems({ actions, aiAvailable: true, t }));
  assert.deepEqual(groups.map((g) => g.group), ["text", "ai", "insert"]);
  assert.deepEqual(groups[0].items.map((i) => i.id), ["h1", "h2", "h3", "bullet", "numbered", "todo", "quote", "code"]);
  assert.deepEqual(groups[1].items.map((i) => [i.id, i.label]), [
    ["action-1", "t(notes.actions.builtin.generateNotes)"],
    ["action-7", "Pricing digest"],
    ["manageActions", "t(notes.slash.manageActions)"],
  ]);
  assert.deepEqual(groups[2].items.map((i) => i.id), ["timestamp", "dictation", "mention"]);
});

test("without an AI model, AI items stay visible but disabled with the reason", async () => {
  const { buildSlashItems } = await load();
  const items = buildSlashItems({ actions, aiAvailable: false, aiUnavailableReason: "Add an API key in Settings", t });
  const ai = items.filter((i) => i.group === "ai" && i.id !== "manageActions" && i.id !== "setupAi");
  assert.ok(ai.length > 0);
  for (const item of ai) assert.equal(item.disabledReason, "Add an API key in Settings");
  assert.equal(items.filter((i) => i.group === "ai")[0].id, "setupAi", "the fix leads the group");
  assert.equal(buildSlashItems({ actions, aiAvailable: true, t }).some((i) => i.id === "setupAi"), false);
  assert.equal(
    buildSlashItems({ actions, aiAvailable: false, aiUnavailableReason: "Checking…", aiNeedsSetup: false, t }).some((i) => i.id === "setupAi"),
    false,
    "while the route is unknown there is nothing to set up yet"
  );
});

test("AI readiness follows the resolved note-formatting route, not the cleanup-model selection (I09)", async () => {
  const { noteAiReadiness } = await load();
  // A fresh install: local route, model chosen by default but not downloaded.
  assert.deepEqual(noteAiReadiness({ status: "needsModel", sizeBytes: 1_300_000_000 }), { available: false, reasonKey: "notes.slash.ai.needsModel", needsSetup: true });
  // A remote route with no saved key.
  assert.deepEqual(noteAiReadiness({ status: "needsKey", provider: "openai" }), { available: false, reasonKey: "notes.slash.ai.needsKey", needsSetup: true });
  // Ready, local or remote alike.
  assert.deepEqual(noteAiReadiness({ status: "ready" }), { available: true, reasonKey: null, needsSetup: false });
  // Main has not confirmed yet (§5.1 rule 1): not ready, but nothing to set up either.
  assert.deepEqual(noteAiReadiness({ status: "unknown" }), { available: false, reasonKey: "notes.slash.ai.unknown", needsSetup: false });
  assert.equal(noteAiReadiness({ status: "unreachable", detail: "sealed" }).reasonKey, "notes.slash.ai.unreachable");
  assert.equal(noteAiReadiness({ status: "off" }).reasonKey, "notes.slash.ai.off");
  assert.equal(noteAiReadiness({ status: "needsUrl" }).reasonKey, "notes.slash.ai.needsUrl");
});

test("PersonalNotesView takes readiness from the route", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../src/components/notes/PersonalNotesView.tsx"), "utf8");
  assert.match(src, /useResolvedRoute\("noteFormatting"\)/);
  assert.doesNotMatch(src, /aiAvailable:\s*isLLMConfigured/);
});

test("typing filters by label or keyword, case-insensitively", async () => {
  const { buildSlashItems, filterSlashItems } = await load();
  const items = buildSlashItems({ actions, aiAvailable: true, t: (key) => ({ "notes.slash.items.todo": "To-do list" })[key] ?? key });
  assert.deepEqual(filterSlashItems(items, "TODO").map((i) => i.id), ["todo"]);
  assert.deepEqual(filterSlashItems(items, "checkbox").map((i) => i.id), ["todo"]);
  assert.deepEqual(filterSlashItems(items, "digest").map((i) => i.id), ["action-7"]);
  assert.equal(filterSlashItems(items, "zzz").length, 0);
});

test("blocks map to editor commands; AI and inserts go to callbacks", async () => {
  const { buildSlashItems, applySlashItem } = await load();
  const items = buildSlashItems({ actions, aiAvailable: true, t });
  const calls = [];
  const chain = new Proxy({}, {
    get: (_target, name) => (...args) => {
      calls.push([name, ...args]);
      return chain;
    },
  });
  const ctx = {
    items,
    onRunAction: (id) => calls.push(["runAction", id]),
    onManageActions: () => calls.push(["manage"]),
    onDictateHere: () => calls.push(["dictate"]),
    formatTimestamp: () => "Wed 14 Oct, 3:42 PM",
  };
  const pick = (id) => items.find((i) => i.id === id);
  applySlashItem(pick("h2"), chain, ctx);
  applySlashItem(pick("todo"), chain, ctx);
  applySlashItem(pick("timestamp"), chain, ctx);
  applySlashItem(pick("mention"), chain, ctx);
  applySlashItem(pick("action-7"), chain, ctx);
  applySlashItem(pick("dictation"), chain, ctx);
  assert.deepEqual(calls, [
    ["setNode", "heading", { level: 2 }], ["run"],
    ["toggleTaskList"], ["run"],
    ["insertContent", "Wed 14 Oct, 3:42 PM "], ["run"],
    ["insertContent", "@"], ["run"],
    ["run"], ["runAction", 7],
    ["run"], ["dictate"],
  ]);
});

test("a disabled item does nothing", async () => {
  const { buildSlashItems, applySlashItem } = await load();
  const items = buildSlashItems({ actions, aiAvailable: false, t });
  const ran = [];
  const ok = applySlashItem(items.find((i) => i.id === "action-1"), { run: () => ran.push("run") }, { onRunAction: () => ran.push("action") });
  assert.equal(ok, false);
  assert.deepEqual(ran, []);
});
```

Create `test/components/suggestionPopup.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/ui/editor/suggestionPopup.ts");
const viewport = { width: 1280, height: 800 };

test("opens 6px below the caret and stays inside the window horizontally", async () => {
  const { popupPosition } = await load();
  assert.deepEqual(popupPosition({ left: 300, top: 100, bottom: 120 }, viewport, { width: 280, height: 300 }), { left: 300, top: 126 });
  assert.equal(popupPosition({ left: 1200, top: 100, bottom: 120 }, viewport, { width: 280, height: 300 }).left, 992);
  assert.equal(popupPosition({ left: -20, top: 100, bottom: 120 }, viewport, { width: 280, height: 300 }).left, 8);
});

test("flips above the caret near the bottom of the window", async () => {
  const { popupPosition } = await load();
  assert.deepEqual(popupPosition({ left: 300, top: 700, bottom: 720 }, viewport, { width: 280, height: 300 }), { left: 300, top: 394 });
});
```

Create `test/components/slashMenu.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { renderStatic } = require("../helpers/harness/reactSsr");

async function load() {
  if (!i18next.isInitialized) {
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8"));
    await i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  }
  return import("../../src/components/ui/editor/SlashMenu.tsx");
}

test("groups render headers, AI rows carry the machine glyph, disabled rows explain why", async () => {
  const { SlashMenu } = await load();
  const html = renderStatic(SlashMenu, {
    command: () => {},
    items: [
      { id: "h1", group: "text", label: "Heading 1", keywords: [] },
      { id: "action-1", group: "ai", label: "Generate Notes", keywords: [], actionId: 1, disabledReason: "Actions need an AI model" },
      { id: "timestamp", group: "insert", label: "Time stamp", keywords: [] },
    ],
  });
  assert.match(html, /role="listbox"/);
  for (const header of [">Text<", ">AI<", ">Insert<"]) assert.ok(html.includes(header), header);
  assert.match(html, /aria-disabled="true"[\s\S]*Actions need an AI model/);
  assert.match(html, /text-ai/);
  assert.match(html, /aria-selected="true"[^>]*>[\s\S]*Heading 1/);
});

test("no match says so instead of vanishing", async () => {
  const { SlashMenu } = await load();
  assert.match(renderStatic(SlashMenu, { items: [], command: () => {} }), /No blocks match/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/slashItems.test.js test/components/suggestionPopup.test.js test/components/slashMenu.test.js`
Expected: FAIL with `Cannot find module` for all three.

- [ ] **Step 3: Implement**

1. Create `src/components/ui/editor/suggestionPopup.ts`:

   ```ts
   import { ReactRenderer } from "@tiptap/react";
   import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
   import type { ForwardRefExoticComponent, PropsWithoutRef, RefAttributes } from "react";

   export interface SuggestionHandle {
     onKeyDown: (event: KeyboardEvent) => boolean;
   }

   /** A forwardRef popup whose ref exposes onKeyDown. */
   export type SuggestionPopupComponent<P> = ForwardRefExoticComponent<
     PropsWithoutRef<P> & RefAttributes<SuggestionHandle>
   >;

   // TipTap's ReactRenderer requires props assignable to Record<string, any>.
   // Interfaces have no implicit index signature, so the popup props are widened
   // at this one boundary; callers keep their exact prop types.
   type RendererProps = Record<string, any>;

   const GAP = 6;
   const MARGIN = 8;

   export function popupPosition(
     rect: { left: number; top: number; bottom: number },
     viewport: { width: number; height: number },
     size: { width: number; height: number }
   ): { left: number; top: number } {
     const left = Math.min(Math.max(rect.left, MARGIN), viewport.width - size.width - MARGIN);
     const below = rect.bottom + GAP;
     const fitsBelow = below + size.height <= viewport.height - MARGIN;
     return { left, top: fitsBelow ? below : Math.max(MARGIN, rect.top - GAP - size.height) };
   }

   export function createSuggestionPopup<Item, P extends object>(
     component: SuggestionPopupComponent<P>,
     options: { width: number; toProps: (props: SuggestionProps<Item>) => P }
   ): NonNullable<SuggestionOptions<Item>["render"]> {
     return () => {
       let renderer: ReactRenderer<SuggestionHandle, RendererProps> | null = null;
       const place = (props: SuggestionProps<Item>) => {
         const rect = props.clientRect?.();
         const el = renderer?.element;
         if (!rect || !el) return;
         const position = popupPosition(
           rect,
           { width: window.innerWidth, height: window.innerHeight },
           { width: options.width, height: el.offsetHeight || 240 }
         );
         Object.assign(el.style, { position: "fixed", zIndex: "9999", left: `${position.left}px`, top: `${position.top}px` });
       };
       return {
         onStart: (props) => {
           renderer = new ReactRenderer<SuggestionHandle, RendererProps>(
             component as unknown as SuggestionPopupComponent<RendererProps>,
             { editor: props.editor, props: options.toProps(props) as RendererProps }
           );
           renderer.element.setAttribute("data-editor-chrome", "");
           document.body.appendChild(renderer.element);
           place(props);
         },
         onUpdate: (props) => {
           renderer?.updateProps(options.toProps(props) as RendererProps);
           renderer?.element.style.removeProperty("display");
           place(props);
         },
         onKeyDown: ({ event }) => {
           if (event.key === "Escape") {
             renderer?.element.style.setProperty("display", "none");
             return true;
           }
           return renderer?.ref?.onKeyDown(event) ?? false;
         },
         onExit: () => {
           renderer?.element.remove();
           renderer?.destroy();
           renderer = null;
         },
       };
     };
   }
   ```

   `RichTextEditorMention.tsx`'s `suggestionRender` (`:20-64`) then becomes:

   ```ts
   const suggestionRender = createSuggestionPopup<MentionSuggestionItem, MentionSuggestionsProps>(MentionSuggestions, {
     width: SUGGESTION_WIDTH,
     toProps: (props) => ({ items: props.items, command: props.command }),
   });
   ```

   The mention popup gains flip-above behaviour, which is a fix. Task 18 changes `SUGGESTION_WIDTH` to 262.

2. Create `src/components/ui/editor/slashItems.ts`:

   ```ts
   import type { ActionItem } from "../../../types/electron";
   import type { RouteState } from "../../../lib/routes";

   export type SlashGroup = "text" | "ai" | "insert";
   export type SlashItemId =
     | "h1" | "h2" | "h3" | "bullet" | "numbered" | "todo" | "quote" | "code"
     | "timestamp" | "dictation" | "mention" | "manageActions" | "setupAi" | `action-${number}`;

   export interface SlashItem {
     id: SlashItemId;
     group: SlashGroup;
     label: string;
     keywords: readonly string[];
     actionId?: number;
     disabledReason?: string;
   }

   export interface SlashContext {
     items: SlashItem[];
     onRunAction(actionId: number): void;
     onManageActions(): void;
     onSetupAi(): void;
     onDictateHere(): void;
     formatTimestamp(date: Date): string;
   }

   /** The chain methods we call; ChainedCommands satisfies it structurally. */
   export interface SlashChain {
     setNode(type: string, attrs?: Record<string, unknown>): SlashChain;
     toggleBulletList(): SlashChain;
     toggleOrderedList(): SlashChain;
     toggleTaskList(): SlashChain;
     toggleBlockquote(): SlashChain;
     toggleCodeBlock(): SlashChain;
     insertContent(content: string): SlashChain;
     run(): boolean;
   }

   const TEXT: ReadonlyArray<[SlashItemId, readonly string[]]> = [
     ["h1", ["heading", "title", "#"]],
     ["h2", ["heading", "subtitle", "##"]],
     ["h3", ["heading", "###"]],
     ["bullet", ["list", "ul", "-"]],
     ["numbered", ["list", "ol", "1."]],
     ["todo", ["todo", "task", "checkbox", "check"]],
     ["quote", ["blockquote", ">"]],
     ["code", ["snippet", "```"]],
   ];
   const INSERT: ReadonlyArray<[SlashItemId, readonly string[]]> = [
     ["timestamp", ["time", "date", "now"]],
     ["dictation", ["dictate", "voice", "speak", "mic"]],
     ["mention", ["@", "person", "link"]],
   ];

   export function buildSlashItems(input: {
     actions: ActionItem[];
     aiAvailable: boolean;
     aiUnavailableReason?: string;
     aiNeedsSetup?: boolean;
     t: (key: string) => string;
   }): SlashItem[] {
     const { t } = input;
     const reason = input.aiAvailable ? undefined : (input.aiUnavailableReason ?? t("notes.slash.aiNeedsModel"));
     const ai: SlashItem[] = [...input.actions]
       .sort((a, b) => a.sort_order - b.sort_order)
       .map((action) => ({
         id: `action-${action.id}` as const,
         group: "ai" as const,
         label: action.translation_key ? t(action.translation_key) : action.name,
         keywords: ["ai", "action"],
         actionId: action.id,
         disabledReason: reason,
       }));
     if (input.aiNeedsSetup ?? !input.aiAvailable) {
       ai.unshift({ id: "setupAi", group: "ai", label: t("notes.slash.setupAi"), keywords: ["setup", "model", "key", "ai"] });
     }
     ai.push({ id: "manageActions", group: "ai", label: t("notes.slash.manageActions"), keywords: ["actions", "edit"] });
     return [
       ...TEXT.map(([id, keywords]) => ({ id, group: "text" as const, label: t(`notes.slash.items.${id}`), keywords })),
       ...ai,
       ...INSERT.map(([id, keywords]) => ({ id, group: "insert" as const, label: t(`notes.slash.items.${id}`), keywords })),
     ];
   }

   export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
     const needle = query.trim().toLocaleLowerCase();
     if (!needle) return items;
     return items.filter(
       (item) =>
         item.label.toLocaleLowerCase().includes(needle) ||
         item.keywords.some((keyword) => keyword.toLocaleLowerCase().startsWith(needle))
     );
   }

   export function groupSlashItems(items: SlashItem[]): Array<{ group: SlashGroup; items: SlashItem[] }> {
     return (["text", "ai", "insert"] as const)
       .map((group) => ({ group, items: items.filter((item) => item.group === group) }))
       .filter((entry) => entry.items.length > 0);
   }

   // Readiness comes from the resolved noteFormatting route (§5.1), never from
   // which cleanup model is selected (review I09).
   export function noteAiReadiness(state: RouteState): { available: boolean; reasonKey: string | null; needsSetup: boolean } {
     if (state.status === "ready") return { available: true, reasonKey: null, needsSetup: false };
     // unknown: main has not confirmed yet (§5.1 rule 1). Disabled, never ready, and no "Set up" nag.
     if (state.status === "unknown") return { available: false, reasonKey: "notes.slash.ai.unknown", needsSetup: false };
     return { available: false, reasonKey: `notes.slash.ai.${state.status}`, needsSetup: true };
   }

   export function applySlashItem(item: SlashItem, chain: SlashChain, ctx: Pick<SlashContext, "onRunAction" | "onManageActions" | "onSetupAi" | "onDictateHere" | "formatTimestamp">): boolean {
     if (item.disabledReason) return false;
     switch (item.id) {
       case "h1": return chain.setNode("heading", { level: 1 }).run();
       case "h2": return chain.setNode("heading", { level: 2 }).run();
       case "h3": return chain.setNode("heading", { level: 3 }).run();
       case "bullet": return chain.toggleBulletList().run();
       case "numbered": return chain.toggleOrderedList().run();
       case "todo": return chain.toggleTaskList().run();
       case "quote": return chain.toggleBlockquote().run();
       case "code": return chain.toggleCodeBlock().run();
       case "timestamp": return chain.insertContent(`${ctx.formatTimestamp(new Date())} `).run();
       case "mention": return chain.insertContent("@").run();
       case "dictation":
         chain.run();
         ctx.onDictateHere();
         return true;
       case "manageActions":
         chain.run();
         ctx.onManageActions();
         return true;
       case "setupAi":
         chain.run();
         ctx.onSetupAi();
         return true;
       default:
         chain.run();
         if (item.actionId != null) ctx.onRunAction(item.actionId);
         return true;
     }
   }
   ```

   The "typing filters" test checks keywords with `startsWith`, so "checkbox" matches To-do. The `t` mock there returns the raw key for everything except To-do, so "digest" matches only the custom action's name.

3. Create `src/components/ui/editor/SlashMenu.tsx`:

   ```tsx
   import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
   import { useTranslation } from "react-i18next";
   import { Sparkles } from "lucide-react";
   import { cn } from "../../lib/utils";
   import { groupSlashItems, type SlashItem } from "./slashItems";
   import type { SuggestionHandle } from "./suggestionPopup";

   export interface SlashMenuProps {
     items: SlashItem[];
     command: (item: SlashItem) => void;
   }

   export const SlashMenu = forwardRef<SuggestionHandle, SlashMenuProps>(function SlashMenu({ items, command }, ref) {
     const { t } = useTranslation();
     const [selected, setSelected] = useState(0);
     useEffect(() => setSelected(0), [items]);

     useImperativeHandle(ref, () => ({
       onKeyDown: (event) => {
         if (items.length === 0) return false;
         if (event.key === "ArrowDown") {
           setSelected((i) => (i + 1) % items.length);
           return true;
         }
         if (event.key === "ArrowUp") {
           setSelected((i) => (i - 1 + items.length) % items.length);
           return true;
         }
         if (event.key === "Enter" || event.key === "Tab") {
           const item = items[selected];
           if (item && !item.disabledReason) command(item);
           return true;
         }
         return false;
       },
     }));

     if (items.length === 0) {
       return <div className="w-70 rounded-lg border border-border bg-popover p-3 text-ui text-muted-foreground shadow-lg">{t("notes.slash.empty")}</div>;
     }

     let index = -1;
     return (
       <div role="listbox" aria-label={t("notes.slash.label")} className="max-h-80 w-70 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
         {groupSlashItems(items).map(({ group, items: rows }) => (
           <div key={group} role="group" aria-label={t(`notes.slash.groups.${group}`)}>
             <div className="px-2 pb-1 pt-2 text-micro uppercase tracking-[0.06em] text-muted-foreground">{t(`notes.slash.groups.${group}`)}</div>
             {rows.map((item) => {
               index += 1;
               const rowIndex = index;
               const isSelected = rowIndex === selected;
               return (
                 <div
                   key={item.id}
                   role="option"
                   aria-selected={isSelected}
                   aria-disabled={item.disabledReason ? true : undefined}
                   onMouseDown={(e) => e.preventDefault()}
                   onMouseEnter={() => setSelected(rowIndex)}
                   onClick={() => !item.disabledReason && command(item)}
                   className={cn(
                     "flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-ui text-foreground",
                     isSelected && "bg-foreground/6",
                     item.disabledReason && "cursor-not-allowed opacity-60"
                   )}
                 >
                   {item.group === "ai" && <Sparkles size={14} aria-hidden className="text-ai" />}
                   <span className="flex min-w-0 flex-1 flex-col">
                     <span className="truncate">{item.label}</span>
                     {item.disabledReason && <span className="text-caption text-muted-foreground">{item.disabledReason}</span>}
                   </span>
                 </div>
               );
             })}
           </div>
         ))}
       </div>
     );
   });
   ```

   `w-70` is 280px in Tailwind 4's spacing scale. If lint flags it, use `w-[280px]`. The `opacity-60` on a disabled row only dims it; the reason text keeps full `text-muted-foreground`.

4. Create `src/components/ui/editor/SlashCommand.ts`:

   ```ts
   import { Extension } from "@tiptap/core";
   import { PluginKey } from "@tiptap/pm/state";
   import Suggestion from "@tiptap/suggestion";
   import { SlashMenu, type SlashMenuProps } from "./SlashMenu";
   import { applySlashItem, filterSlashItems, type SlashContext, type SlashItem } from "./slashItems";
   import { createSuggestionPopup } from "./suggestionPopup";

   export const SLASH_PLUGIN_KEY = new PluginKey("slashCommand");

   export function createSlashCommand(getContext: () => SlashContext) {
     return Extension.create({
       name: "slashCommand",
       addProseMirrorPlugins() {
         return [
           Suggestion<SlashItem, SlashItem>({
             editor: this.editor,
             pluginKey: SLASH_PLUGIN_KEY,
             char: "/",
             startOfLine: false,
             // Inert in code blocks and inline code: "/" is literal there.
             allow: ({ state, range }) => {
               const $from = state.doc.resolve(range.from);
               return !$from.parent.type.spec.code && !$from.marks().some((mark) => mark.type.name === "code");
             },
             items: ({ query }) => filterSlashItems(getContext().items, query),
             command: ({ editor, range, props: item }) => {
               applySlashItem(item, editor.chain().focus().deleteRange(range) as never, getContext());
             },
             render: createSuggestionPopup<SlashItem, SlashMenuProps>(SlashMenu, {
               width: 280,
               toProps: (props) => ({ items: props.items, command: props.command }),
             }),
           }),
         ];
       },
     });
   }
   ```

   `@tiptap/suggestion`'s default `allowedPrefixes` is `[" "]`, so `http://` and `14/10` do not open the menu. `@tiptap/pm` is already installed through the overrides.

5. In `src/components/ui/RichTextEditor.tsx`:
   - Add to the props:

     ```ts
     /** Enables the / menu (WS-R6 B). Provide at mount; read through a ref afterwards. */
     slash?: {
       actions: ActionItem[];
       aiAvailable: boolean;
       aiUnavailableReason?: string;
       onRunAction: (actionId: number) => void;
       onSetupAi: () => void;
       onManageActions: () => void;
       onDictateHere: () => void;
     };
     ```

   - Mirror the mention pattern (`:37-41`): `const slashRef = useRef(slash); slashRef.current = slash; const withSlash = useRef(slash != null && !disabled).current;`.
   - Add the extension to the list (`:43-62`):

     ```ts
     ...(withSlash
       ? [
           createSlashCommand(() => {
             const current = slashRef.current!;
             return {
               items: buildSlashItems({ actions: current.actions, aiAvailable: current.aiAvailable, aiUnavailableReason: current.aiUnavailableReason, t }),
               onSetupAi: current.onSetupAi,
               onRunAction: current.onRunAction,
               onManageActions: current.onManageActions,
               onDictateHere: current.onDictateHere,
               formatTimestamp: (date) =>
                 date.toLocaleString(i18n.language, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
             };
           }),
         ]
       : []),
     ```

     Take `t` and `i18n` from `useTranslation()`.

6. In `src/components/notes/NoteEditor.tsx`, add `slash?: RichTextEditorProps["slash"]` to `NoteEditorProps`. Export `RichTextEditorProps` from `RichTextEditor.tsx` if it is not exported. Pass `slash={slash}` to the raw-notes `<RichTextEditor>` only (`:965-973`). It is not passed to the transcript or enhanced editors.

7. In `src/components/notes/PersonalNotesView.tsx`:
   - Reuse the existing `const actions = useActions();` (`:265`).
   - Add `const noteRoute = useResolvedRoute("noteFormatting");` and `const aiReady = noteAiReadiness(noteRoute.state);`. Import them from `../../lib/routes` and `../ui/editor/slashItems`.
     - Do not read `isLLMConfigured`; it reports a selection, not readiness (I09).
     - Plan 02's Actions hint (WS-Q7) moves onto this same `noteRoute` in Task 26 (§5.1 Notes readiness handoff).
   - After `runNoteAction` (`:618`), add:

   ```ts
   const slash = useMemo(
     () => ({
       actions,
       aiAvailable: aiReady.available,
       aiUnavailableReason: aiReady.reasonKey ? t(aiReady.reasonKey) : undefined,
       aiNeedsSetup: aiReady.needsSetup,
       onSetupAi: () => onOpenSettings?.(noteRoute.settingsPath),
       onRunAction: (actionId: number) => {
         const action = actions.find((candidate) => candidate.id === actionId);
         if (action) void runNoteAction(action);
       },
       // Plan 02's openActions: the Actions first run shows once, then the manager.
       onManageActions: openActions,
       // Loqui's window is focused with the caret in the note, so dictation pastes here.
       onDictateHere: () => void window.electronAPI?.toggleDictationFromControlPanel?.(),
     }),
     [actions, aiReady.available, aiReady.reasonKey, aiReady.needsSetup, noteRoute.settingsPath, onOpenSettings, openActions, runNoteAction, t]
   );
   ```

   Pass `slash={slash}` to `<NoteEditor …>`. If `runNoteAction` is not wrapped in `useCallback`, wrap it, or the memo churns.

8. Add strings (Task 1 helper). English block:

   ```json
   {
     "notes": {
       "slash": {
         "label": "Insert block",
         "empty": "No blocks match",
         "aiNeedsModel": "Actions need an AI model",
         "setupAi": "Set up notes AI…",
         "ai": {
           "needsModel": "Download the notes model in Settings",
           "needsKey": "Add an API key in Settings",
           "needsUrl": "Add a server address in Settings",
           "off": "Notes AI is turned off in Settings",
           "unreachable": "The notes model can't be reached",
           "unknown": "Checking the notes model…"
         },
         "manageActions": "Manage actions…",
         "groups": { "text": "Text", "ai": "AI", "insert": "Insert" },
         "items": {
           "h1": "Heading 1",
           "h2": "Heading 2",
           "h3": "Heading 3",
           "bullet": "Bullet list",
           "numbered": "Numbered list",
           "todo": "To-do list",
           "quote": "Quote",
           "code": "Code",
           "timestamp": "Time stamp",
           "dictation": "Dictation here",
           "mention": "Mention"
         }
       }
     }
   }
   ```

   Edit `notes.editor.startWriting` by hand in all 11 locale files (the merge helper refuses to change existing values). The new `en` value is "Type, dictate or paste. Press / for blocks and actions." (R6 A/B ghost copy).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/slashItems.test.js test/components/suggestionPopup.test.js test/components/slashMenu.test.js test/utils/mentionMarkdown.test.js test/components/fieldDirectionPolicy.test.js test/locales/translationCoverage.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/editor src/components/ui/RichTextEditor.tsx src/components/ui/RichTextEditorMention.tsx src/components/notes/NoteEditor.tsx src/components/notes/PersonalNotesView.tsx src/locales test/components/slashItems.test.js test/components/suggestionPopup.test.js test/components/slashMenu.test.js
git commit -m "feat(notes): add a slash menu for blocks, actions and inserts"
```

---

### Task 16: Bubble toolbar and Ask AI

This covers WS-R6 B (the bubble toolbar) and interpretation 6. It also covers Review Focus 1 (Ask AI never sends) and Review Focus 2 (unsafe link hrefs).

**Files:**
- Modify: `package.json`, `package-lock.json`. Promote `@tiptap/extension-bubble-menu` from an optional transitive dependency to a direct one, pinned `3.31.3`.
- Create: `src/lib/linkHref.ts`, `src/components/ui/editor/BubbleToolbar.tsx`
- Create: `src/components/ui/editor/editorChrome.ts`. Decides which clicks may refocus the document (review I07).
- Modify: `src/components/ui/RichTextEditor.tsx`:
  - render the toolbar when `onAskAi` is provided and the editor is editable;
  - the wrapper's `handleClick` (`:114-118`) ignores clicks inside editor chrome.
- Modify: `src/components/notes/NoteEditor.tsx`. Ask AI opens the floating chat (`chatMode`, `:223`) and seeds its composer (review I05).
- Modify: `src/components/notes/EmbeddedChat.tsx`. A `composerSeed` prop is forwarded to its `ChatInput` (`:137`). `NoteBottomBar` is **not** changed.
- Modify: `src/index.css`. Add `.bubble-toolbar` after the editor block.
- Test: `test/lib/linkHref.test.js`, `test/components/bubbleToolbar.test.js`, `test/components/editorChrome.test.js`

**Interfaces:**
- Produces `src/lib/linkHref.ts`: `sanitizeLinkHref(input: string): string | null`. It allows `http:`, `https:` and `mailto:`. A bare domain becomes `https://…`. Everything else returns `null`.
- Produces `BubbleToolbar.tsx`:

  ```ts
  export function buildAskAiDraft(selection: string): string; // “…quote…” + space, ≤ 280 chars, never empty-quoted
  export interface BubbleToolbarButtonsProps {
    active: { bold: boolean; italic: boolean; link: boolean };
    onBold(): void; onItalic(): void;
    onLink(href: string | null): void;   // null removes the link
    onAskAi(): void;
    initialHref?: string;
  }
  export function BubbleToolbarButtons(props: BubbleToolbarButtonsProps): JSX.Element;
  export function BubbleToolbar(props: { editor: Editor; onAskAi: (selection: string) => void }): JSX.Element; // wraps BubbleMenu
  ```

- `RichTextEditor` prop `onAskAi?: (selection: string) => void`.
- `askAiTransition(mode: "hidden" | "floating" | "sidebar", selection: string): { mode: "floating" | "sidebar"; seed: ComposerSeed } | null`, exported from `BubbleToolbar.tsx`. Ask AI opens the chat if it is hidden, keeps a docked sidebar where it is, and seeds the **visible** chat composer with the quote and `resetQueue: true`. An empty selection does nothing.
  - **Why (review I05).** Seeding `NoteBottomBar` focused it. Its focus handler (`NoteBottomBar.tsx:62` → `NoteEditor.handleChatInputFocus`, `:638`) opens the floating chat, and `hideInput={chatMode !== "hidden"}` (`:1010`) then hides the seeded field.
- `EmbeddedChat` prop `composerSeed?: ComposerSeed | null`, forwarded as `ChatInput`'s `seed` (Task 4). That composer applies seeds during render, never submits, and disarms any queue.
- `isEditorChromeTarget(target: EventTarget | null): boolean` (`editorChrome.ts`). It is true inside any element marked `data-editor-chrome`, which covers the bubble toolbar, the slash and mention popups (`suggestionPopup.ts` marks them) and the mention hover card (Task 18). The editor wrapper's click-to-focus skips those targets, so the Link URL field keeps focus and caret (review I07).

- [ ] **Step 1: Write the failing tests**

Create `test/lib/linkHref.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/linkHref.ts");

test("web and mail links are allowed", async () => {
  const { sanitizeLinkHref } = await load();
  assert.equal(sanitizeLinkHref("https://loqui.app/docs"), "https://loqui.app/docs");
  assert.equal(sanitizeLinkHref("  http://localhost:3000  "), "http://localhost:3000/");
  assert.equal(sanitizeLinkHref("mailto:maya@acme.co"), "mailto:maya@acme.co");
});

test("a bare domain becomes https", async () => {
  const { sanitizeLinkHref } = await load();
  assert.equal(sanitizeLinkHref("loqui.app/pricing"), "https://loqui.app/pricing");
});

test("script, data, file and workspace schemes are refused", async () => {
  const { sanitizeLinkHref } = await load();
  for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", " java\tscript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "vbscript:x", "note:17", "", "   ", "not a link"]) {
    assert.equal(sanitizeLinkHref(bad), null, JSON.stringify(bad));
  }
});
```

Create `test/components/bubbleToolbar.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { renderStatic } = require("../helpers/harness/reactSsr");

const root = path.join(__dirname, "../..");
async function load() {
  if (!i18next.isInitialized) {
    const en = JSON.parse(fs.readFileSync(path.join(root, "src/locales/en/translation.json"), "utf8"));
    await i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  }
  return import("../../src/components/ui/editor/BubbleToolbar.tsx");
}
const noop = () => {};
const base = { active: { bold: true, italic: false, link: false }, onBold: noop, onItalic: noop, onLink: noop, onAskAi: noop };

test("B, I, Link and Ask AI — no Highlight (it would not survive a save)", async () => {
  const { BubbleToolbarButtons } = await load();
  const html = renderStatic(BubbleToolbarButtons, base);
  for (const label of ["Bold", "Italic", "Link", "Ask AI"]) assert.match(html, new RegExp(`aria-label="${label}"|>${label}<`));
  assert.doesNotMatch(html, /Highlight/i);
  assert.match(html, /aria-label="Bold"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Bold"/);
  assert.match(html, /class="[^"]*text-ai-text[^"]*"[^>]*>[\s\S]*Ask AI/);
});

test("Ask AI hands the selection to the caller, it never submits", async () => {
  const { buildAskAiDraft } = await load();
  assert.equal(buildAskAiDraft("  Thursday, not Monday  "), "“Thursday, not Monday” ");
  assert.equal(buildAskAiDraft(""), "");
  assert.ok(buildAskAiDraft("x".repeat(1000)).length <= 280);
});

test("Ask AI opens a visible composer and seeds it, disarming any queue (I05)", async () => {
  const { askAiTransition } = await load();
  const opened = askAiTransition("hidden", "Thursday, not Monday");
  assert.equal(opened.mode, "floating", "a hidden chat opens");
  assert.equal(opened.seed.text, "“Thursday, not Monday” ");
  assert.equal(opened.seed.resetQueue, true);
  assert.equal(askAiTransition("sidebar", "x").mode, "sidebar", "a docked chat stays docked");
  assert.equal(askAiTransition("hidden", "   "), null);
  // The seed goes to EmbeddedChat's ChatInput, never to the bottom bar that hides itself.
  const editor = fs.readFileSync(path.join(root, "src/components/notes/NoteEditor.tsx"), "utf8");
  assert.equal((editor.match(/composerSeed=\{chatSeed\}/g) ?? []).length, 2, "floating and sidebar chats both receive it");
  assert.doesNotMatch(editor, /<NoteBottomBar[^>]*\bseed=/);
  assert.match(fs.readFileSync(path.join(root, "src/components/notes/EmbeddedChat.tsx"), "utf8"), /seed=\{composerSeed\}/);
});

test("the bubble menu extension is a direct, pinned dependency", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.dependencies["@tiptap/extension-bubble-menu"], "3.31.3");
});
```

Create `test/components/editorChrome.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const load = () => import("../../src/components/ui/editor/editorChrome.ts");
const el = (inChrome) => ({ closest: (sel) => (sel === "[data-editor-chrome]" && inChrome ? {} : null) });

test("clicks inside the bubble toolbar, its URL field or a popup never refocus the document (I07)", async () => {
  const { isEditorChromeTarget } = await load();
  assert.equal(isEditorChromeTarget(el(true)), true);
  assert.equal(isEditorChromeTarget(el(false)), false);
  assert.equal(isEditorChromeTarget(null), false);
  assert.equal(isEditorChromeTarget({}), false, "non-element targets are not chrome");
});

test("the editor wrapper and every chrome surface use the marker", () => {
  const root = path.join(__dirname, "../..");
  const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
  assert.match(read("src/components/ui/RichTextEditor.tsx"), /if \(isEditorChromeTarget\(event\.target\)\) return;/);
  assert.match(read("src/components/ui/editor/BubbleToolbar.tsx"), /data-editor-chrome=""/);
  assert.match(read("src/components/ui/editor/suggestionPopup.ts"), /setAttribute\("data-editor-chrome", ""\)/);
});
```

The fake DOM has no layout or real focus, so these tests pin the decision and the wiring. The behaviour itself is checked in Task 27: type a URL and click inside the field.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/lib/linkHref.test.js test/components/bubbleToolbar.test.js test/components/editorChrome.test.js`
Expected: FAIL. Modules are missing, and `pkg.dependencies["@tiptap/extension-bubble-menu"]` is `undefined`.

- [ ] **Step 3: Implement**

1. Run: `npm install --save-exact @tiptap/extension-bubble-menu@3.31.3`

   The lock already contains it as an optional dependency of `@tiptap/react`, so this only moves it into `dependencies` and updates the lock flags. Confirm with `git diff package.json`. Then run `npm test -- test/helpers/packageRuntimeProbe.test.js`, which guards what ships.

2. Create `src/lib/linkHref.ts`:

   ```ts
   const ALLOWED = new Set(["http:", "https:", "mailto:"]);
   const BARE_DOMAIN = /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+([/?#].*)?$/u;

   // User-typed links in notes. Anything that is not web or mail is refused, so
   // a pasted "javascript:" can never become a clickable href.
   export function sanitizeLinkHref(input: string): string | null {
     // Strip C0 controls first: "java\tscript:" must not slip past the scheme check.
     const raw = input.replace(/[\u0000-\u001F\u007F]/g, "").trim();
     if (!raw) return null;
     const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : BARE_DOMAIN.test(raw) ? `https://${raw}` : null;
     if (!candidate) return null;
     try {
       const url = new URL(candidate);
       return ALLOWED.has(url.protocol) ? url.href : null;
     } catch {
       return null;
     }
   }
   ```

   Stripping control characters removes the tab in `java\tscript:`, the classic bypass, so it parses as `javascript:` and is refused. `"not a link"` has spaces and no scheme, so it fails `BARE_DOMAIN` and returns `null`.

3. Create `src/components/ui/editor/BubbleToolbar.tsx`:

   ```tsx
   import { useState } from "react";
   import { useTranslation } from "react-i18next";
   import { BubbleMenu } from "@tiptap/react/menus";
   import { useEditorState, type Editor } from "@tiptap/react";
   import { Bold, Italic, Link2, Sparkles } from "lucide-react";
   import { cn } from "../../lib/utils";
   import { sanitizeLinkHref } from "../../../lib/linkHref";

   import type { ComposerSeed } from "../../chat/chatRequest";

   const MAX_DRAFT = 280;

   export function buildAskAiDraft(selection: string): string {
     const quote = selection.replace(/\s+/g, " ").trim();
     if (!quote) return "";
     const clipped = quote.length > MAX_DRAFT - 3 ? `${quote.slice(0, MAX_DRAFT - 4)}…` : quote;
     return `“${clipped}” `;
   }

   type ChatMode = "hidden" | "floating" | "sidebar";

   /** Ask AI opens a visible composer: a hidden chat floats in, a docked one
    *  stays. The quote is seeded with resetQueue, never sent (review I05). */
   export function askAiTransition(mode: ChatMode, selection: string): { mode: Exclude<ChatMode, "hidden">; seed: ComposerSeed } | null {
     const text = buildAskAiDraft(selection);
     if (!text) return null;
     return { mode: mode === "hidden" ? "floating" : mode, seed: { nonce: Date.now(), text, resetQueue: true } };
   }

   export interface BubbleToolbarButtonsProps {
     active: { bold: boolean; italic: boolean; link: boolean };
     onBold(): void;
     onItalic(): void;
     onLink(href: string | null): void;
     onAskAi(): void;
     initialHref?: string;
   }

   const BUTTON = "flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-ui text-foreground hover:bg-foreground/8";

   export function BubbleToolbarButtons({ active, onBold, onItalic, onLink, onAskAi, initialHref = "" }: BubbleToolbarButtonsProps) {
     const { t } = useTranslation();
     const [editingLink, setEditingLink] = useState(false);
     const [href, setHref] = useState(initialHref);
     const [invalid, setInvalid] = useState(false);

     if (editingLink) {
       return (
         <form
           className="flex items-center gap-1"
           onSubmit={(e) => {
             e.preventDefault();
             if (href.trim()) {
               const safe = sanitizeLinkHref(href);
               if (!safe) return setInvalid(true);
               onLink(safe);
             } else {
               onLink(null);
             }
             setEditingLink(false);
           }}
           onKeyDown={(e) => {
             if (e.key === "Escape") setEditingLink(false);
           }}
         >
           <input
             autoFocus
             dir="ltr"
             value={href}
             onChange={(e) => {
               setHref(e.target.value);
               setInvalid(false);
             }}
             aria-label={t("notes.bubble.linkUrl")}
             aria-invalid={invalid || undefined}
             placeholder="https://"
             className="h-6 w-56 rounded-md bg-background px-2 text-caption outline-none"
           />
           {invalid && <span role="alert" className="text-caption text-destructive">{t("notes.bubble.linkInvalid")}</span>}
         </form>
       );
     }

     return (
       <div className="flex items-center gap-0.5">
         <button type="button" aria-label={t("notes.bubble.bold")} aria-pressed={active.bold} onClick={onBold} className={cn(BUTTON, active.bold && "bg-foreground/8")}>
           <Bold size={14} aria-hidden />
         </button>
         <button type="button" aria-label={t("notes.bubble.italic")} aria-pressed={active.italic} onClick={onItalic} className={cn(BUTTON, active.italic && "bg-foreground/8")}>
           <Italic size={14} aria-hidden />
         </button>
         <button
           type="button"
           aria-label={t("notes.bubble.link")}
           aria-pressed={active.link}
           onClick={() => {
             setHref(initialHref);
             setInvalid(false);
             setEditingLink(true);
           }}
           className={cn(BUTTON, active.link && "bg-foreground/8")}
         >
           <Link2 size={14} aria-hidden />
         </button>
         <span aria-hidden className="mx-1 h-4 w-px bg-border" />
         {/* Fuchsia: this asks a model to write. It opens a draft; it never sends. */}
         <button type="button" onClick={onAskAi} className={cn(BUTTON, "gap-1 font-semibold text-ai-text")}>
           <Sparkles size={13} aria-hidden />
           {t("notes.bubble.askAi")}
         </button>
       </div>
     );
   }

   export function BubbleToolbar({ editor, onAskAi }: { editor: Editor; onAskAi: (selection: string) => void }) {
     // Tiptap 3 does not re-render on every transaction; subscribe to exactly
     // the marks the toolbar shows so the pressed states stay current.
     const marks = useEditorState({
       editor,
       selector: ({ editor: e }) => ({
         bold: e.isActive("bold"),
         italic: e.isActive("italic"),
         link: e.isActive("link"),
         href: (e.getAttributes("link").href as string | undefined) ?? "",
       }),
     });
     return (
       <BubbleMenu
         editor={editor}
         options={{ placement: "top", offset: 6 }}
         shouldShow={({ editor: e, from, to }) =>
           e.isEditable && from !== to && !e.isActive("codeBlock") && e.state.doc.textBetween(from, to, " ").trim().length > 0
         }
         data-editor-chrome=""
         // Buttons keep the editor selection; the URL field still takes focus normally.
         onMouseDown={(e) => {
           if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
         }}
         className="bubble-toolbar flex h-8 items-center rounded-lg border border-border bg-popover px-1 shadow-(--shadow-elevated)"
       >
         <BubbleToolbarButtons
           active={{ bold: marks.bold, italic: marks.italic, link: marks.link }}
           initialHref={marks.href}
           onBold={() => editor.chain().focus().toggleBold().run()}
           onItalic={() => editor.chain().focus().toggleItalic().run()}
           onLink={(href) =>
             href
               ? editor.chain().focus().extendMarkRange("link").setLink({ href }).run()
               : editor.chain().focus().extendMarkRange("link").unsetLink().run()
           }
           onAskAi={() => {
             const { from, to } = editor.state.selection;
             onAskAi(editor.state.doc.textBetween(from, to, " "));
           }}
         />
       </BubbleMenu>
     );
   }
   ```

   If `--shadow-elevated` is not a defined token, use the shadow `NoteBottomBar` uses (`shadow-(--shadow-glass)`).

4. Append to `src/index.css`, after the editor block:

   ```css
   /* WS-R6 B: the bubble fades in (opacity only, so reduced motion keeps it). */
   .bubble-toolbar {
     animation: bubble-toolbar-in var(--motion-instant) var(--motion-ease-enter) both;
   }
   @keyframes bubble-toolbar-in {
     from { opacity: 0; }
     to { opacity: 1; }
   }
   ```

5. In `src/components/ui/RichTextEditor.tsx`:
   - Add the prop `onAskAi?: (selection: string) => void;`.
   - After `<EditorContent … />`, render `{editor && onAskAi && !disabled && <BubbleToolbar editor={editor} onAskAi={onAskAi} />}`.
   - Create `src/components/ui/editor/editorChrome.ts`:

     ```ts
     // UI that floats over the editor (bubble toolbar, slash and mention popups,
     // mention hover cards). React portals bubble clicks to the editor wrapper,
     // so the wrapper must not pull focus back into the document from these.
     export function isEditorChromeTarget(target: EventTarget | null): boolean {
       const node = target as { closest?: (selector: string) => unknown } | null;
       return typeof node?.closest === "function" && node.closest("[data-editor-chrome]") != null;
     }
     ```

   - Change the wrapper's `handleClick` (`:114-118`) to:

     ```ts
     const handleClick = useCallback(
       (event: React.MouseEvent) => {
         if (isEditorChromeTarget(event.target)) return;
         if (editor && !editor.isFocused && !disabled) editor.commands.focus();
       },
       [editor, disabled]
     );
     ```
   - StarterKit 3.31.3 already includes Link with `openOnClick: true`. Configure it in the `StarterKit.configure({ … })` call (`:46-50`) as `link: { openOnClick: false, autolink: true }`. With `openOnClick: false`, clicking a link places the caret, as editors do, and the bubble shows it.
   - Keep Link's default `isAllowedUri`. It already refuses `javascript:` and similar schemes. Narrowing it to `sanitizeLinkHref` would strip `tel:`, `ftp:`, `#anchor` and relative links from existing notes on load, and the next save would lose them. The strict allow-list applies only to what a user types in the bubble.

6. In `src/components/notes/EmbeddedChat.tsx`, add `composerSeed?: ComposerSeed | null;` to `EmbeddedChatProps` (`:15`), destructure it, and pass `seed={composerSeed}` to its `<ChatInput …>` (`:137`). Task 4's `ChatInput` applies the seed during render, focuses the composer and never submits.

7. In `src/components/notes/NoteEditor.tsx`:
   - Add `const [chatSeed, setChatSeed] = useState<ComposerSeed | null>(null);`.
   - Add the handler:

     ```ts
     // Ask AI opens a visible composer: the floating chat (or the docked one if
     // it is open) receives the quote. The bottom bar is not seeded; it hides
     // whenever the chat is open (review I05).
     const handleAskAi = useCallback(
       (selection: string) => {
         const next = askAiTransition(chatMode, selection);
         if (!next) return;
         setChatMode(next.mode);
         setChatSeed(next.seed);
       },
       [chatMode]
     );
     ```

   - Pass `onAskAi={handleAskAi}` to the raw-notes `<RichTextEditor>` and to the enhanced editor.
   - Pass `composerSeed={chatSeed}` to **both** `<EmbeddedChat …>` instances (floating `:1013` and sidebar `:1030`). The floating one mounts in the same commit that sets the seed, and `ChatInput` applies a seed that is present at mount (Task 4's "a seed present at mount" test).

8. In `test/components/fieldDirectionPolicy.test.js`, add `"src/components/ui/editor/BubbleToolbar.tsx": ["ltr"],` to the per-file input map. The URL field is `dir="ltr"`.

9. Add strings (Task 1 helper). English block:

   ```json
   {
     "notes": {
       "bubble": {
         "bold": "Bold",
         "italic": "Italic",
         "link": "Link",
         "linkUrl": "Link address",
         "linkInvalid": "Use a web or email address",
         "askAi": "Ask AI"
       }
     }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/lib/linkHref.test.js test/components/bubbleToolbar.test.js test/components/editorChrome.test.js test/components/chatComposerSeed.test.js test/components/noteBottomBar.test.js test/components/fieldDirectionPolicy.test.js test/helpers/packageRuntimeProbe.test.js test/locales/translationCoverage.test.js && npm run typecheck`
Expected: PASS. The existing `noteBottomBar` suite still passes.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json test/components/fieldDirectionPolicy.test.js src/lib/linkHref.ts src/components/ui/editor/BubbleToolbar.tsx src/components/ui/editor/editorChrome.ts src/components/ui/RichTextEditor.tsx src/components/notes/NoteEditor.tsx src/components/notes/EmbeddedChat.tsx src/index.css src/locales test/lib/linkHref.test.js test/components/bubbleToolbar.test.js test/components/editorChrome.test.js
git commit -m "feat(notes): add a bubble toolbar with safe links and Ask AI drafts"
```

---

### Task 17: Universal mentions: entity hrefs and serialisation

This covers the WS-R7 B storage format. It extends the existing `mention:` scheme (`mentionMarkdown.ts:20`), so exports degrade to ordinary links.

**Files:**
- Modify: `src/utils/mentionMarkdown.ts` (append; existing exports unchanged)
- Modify: `src/components/ui/RichTextEditorMention.tsx`. Change the attributes (`:82-87`), `parseHTML` (`:88-100`), `renderHTML` (`:101-112`) and `serialize` (`:119-133`).
- Test: append to `test/utils/mentionMarkdown.test.js`

**Interfaces:**
- Produces:

  ```ts
  export type MentionKind = "person" | "note" | "meeting" | "dictation" | "folder";
  export const ENTITY_MENTION_KINDS: readonly Exclude<MentionKind, "person">[]; // note, meeting, dictation, folder
  export interface MentionEntity { kind: MentionKind; label: string; entityId: string | null; email: string | null }
  // person: entityId null, email optional → mention:<email|label>
  // others: entityId is a positive integer string → <kind>:<id>, e.g. [@Pricing review](meeting:38)
  export function buildEntityMentionMarkdown(entity: MentionEntity): string; // invalid id → plain "@label"
  export function parseMentionHref(href: string | null | undefined): Omit<MentionEntity, "label"> | null;
  export function mentionHref(entity: Omit<MentionEntity, "label"> & { label: string }): string;
  ```

- Mention node attributes become `{ label, email, kind = "person", entityId = null }`. Existing `[@Name](mention:email)` content parses to `kind: "person"` exactly as before.

- [ ] **Step 1: Write the failing test**

Append to `test/utils/mentionMarkdown.test.js`:

```js
test("entity mentions round-trip as readable links", async () => {
  const { buildEntityMentionMarkdown, parseMentionHref } = await load();
  const cases = [
    [{ kind: "note", label: "Pricing FAQ draft", entityId: "17", email: null }, "[@Pricing FAQ draft](note:17)"],
    [{ kind: "meeting", label: "Pricing review", entityId: "38", email: null }, "[@Pricing review](meeting:38)"],
    [{ kind: "dictation", label: "Draft a reply to Maya…", entityId: "311", email: null }, "[@Draft a reply to Maya…](dictation:311)"],
    [{ kind: "folder", label: "Work", entityId: "2", email: null }, "[@Work](folder:2)"],
  ];
  for (const [entity, markdown] of cases) {
    assert.equal(buildEntityMentionMarkdown(entity), markdown);
    const href = markdown.match(/\]\(([^)]+)\)$/)[1];
    assert.deepEqual(parseMentionHref(href), { kind: entity.kind, entityId: entity.entityId, email: null });
  }
});

test("people keep the existing mention: scheme", async () => {
  const { buildEntityMentionMarkdown, parseMentionHref } = await load();
  assert.equal(
    buildEntityMentionMarkdown({ kind: "person", label: "Michael Chen", entityId: null, email: "michael@acme.com" }),
    "[@Michael Chen](mention:michael%40acme.com)"
  );
  assert.deepEqual(parseMentionHref("mention:michael%40acme.com"), { kind: "person", entityId: null, email: "michael@acme.com" });
  assert.deepEqual(parseMentionHref("mention:Sean"), { kind: "person", entityId: null, email: null });
});

test("malformed or foreign hrefs are not mentions", async () => {
  const { parseMentionHref, buildEntityMentionMarkdown } = await load();
  for (const href of ["note:abc", "note:-1", "note:1.5", "note:0", "meeting:", "note:12x", "https://x.y", "javascript:alert(1)", null, ""]) {
    assert.equal(parseMentionHref(href), null, String(href));
  }
  assert.equal(buildEntityMentionMarkdown({ kind: "note", label: "Ghost", entityId: "nope", email: null }), "@Ghost");
});

test("labels cannot break out of the link", async () => {
  const { buildEntityMentionMarkdown } = await load();
  assert.equal(
    buildEntityMentionMarkdown({ kind: "note", label: "Q3 [draft]\nplan", entityId: "4", email: null }),
    "[@Q3 draft plan](note:4)"
  );
});

test("labels survive a real Markdown parse: backslashes, emphasis and punctuation (M02)", async () => {
  const { buildEntityMentionMarkdown, buildMentionMarkdown, parseMentionHref } = await load();
  const MarkdownIt = require("markdown-it"); // the parser tiptap-markdown uses
  const md = new MarkdownIt({ html: false });
  const unescape = (html) => html.replace(/&amp;/g, "&");
  for (const label of ["Trailing\\", "A\\B", "Q&A: pricing (v2)!", "50% *bold* _x_", "`code` ~strike~"]) {
    const html = md.renderInline(buildEntityMentionMarkdown({ kind: "note", label, entityId: "17", email: null }));
    const link = html.match(/^<a href="([^"]+)">@(.*)<\/a>$/);
    assert.ok(link, `${label} → ${html}`);
    assert.equal(unescape(link[2]), label, "the label comes back verbatim");
    assert.deepEqual(parseMentionHref(link[1]), { kind: "note", entityId: "17", email: null });
  }
  assert.equal(md.renderInline(buildMentionMarkdown({ name: "Ops\\", email: "ops@acme.co" })), '<a href="mention:ops%40acme.co">@Ops\\</a>');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/utils/mentionMarkdown.test.js`
Expected: FAIL with `buildEntityMentionMarkdown is not a function`.

- [ ] **Step 3: Implement**

1. Append to `src/utils/mentionMarkdown.ts`:

   ```ts
   // WS-R7 B: notes, meetings, dictations and folders are mentionable too.
   // Stored as ordinary markdown links (note:17, meeting:42, …) so exports stay
   // readable; people keep mention:<email|name>.
   export type MentionKind = "person" | "note" | "meeting" | "dictation" | "folder";
   export const ENTITY_MENTION_KINDS = ["note", "meeting", "dictation", "folder"] as const;

   export interface MentionEntity {
     kind: MentionKind;
     label: string;
     entityId: string | null;
     email: string | null;
   }

   const POSITIVE_INT = /^[1-9]\d*$/;

   export function parseMentionHref(href: string | null | undefined): Omit<MentionEntity, "label"> | null {
     if (!href) return null;
     if (href.startsWith(MENTION_HREF_PREFIX)) {
       return { kind: "person", entityId: null, email: parseMentionEmail(href) };
     }
     const colon = href.indexOf(":");
     const kind = href.slice(0, colon) as (typeof ENTITY_MENTION_KINDS)[number];
     const id = href.slice(colon + 1);
     if (colon < 1 || !ENTITY_MENTION_KINDS.includes(kind) || !POSITIVE_INT.test(id)) return null;
     return { kind, entityId: id, email: null };
   }

   export function mentionHref(entity: Omit<MentionEntity, "label"> & { label: string }): string {
     if (entity.kind === "person") {
       return `${MENTION_HREF_PREFIX}${encodeMentionId(entity.email || sanitizeLabel(entity.label))}`;
     }
     return `${entity.kind}:${entity.entityId}`;
   }

   export function buildEntityMentionMarkdown(entity: MentionEntity): string {
     if (entity.kind === "person") return buildMentionMarkdown({ name: entity.label, email: entity.email });
     const label = markdownLabel(entity.label);
     if (!entity.entityId || !POSITIVE_INT.test(entity.entityId)) return `@${label}`;
     return `[@${label}](${entity.kind}:${entity.entityId})`;
   }
   ```

   `sanitizeLabel` and `encodeMentionId` are the existing private helpers at `:8-16`. Add one more next to them, and use it in the existing `buildMentionMarkdown` (`:20-23`) as well, in place of its `sanitizeLabel(person.name)` call:

   ```ts
   // Brackets and newlines are removed (sanitizeLabel); backslashes and inline
   // emphasis markers are escaped, so markdown-it gives the label back verbatim
   // and the link keeps its identity (review M02: "Trailing\" lost its link).
   const markdownLabel = (name: string) => sanitizeLabel(name).replace(/[\\*_`~]/g, "\\$&");
   ```

   This was checked against the installed markdown-it 14.2: `Trailing\`, `A\B`, `Q&A: pricing (v2)!`, `50% *bold* _x_` and `` `code` ~strike~ `` all render as one link whose text equals the label. The existing people-mention tests are unchanged, because none of their names contains these characters.

2. In `src/components/ui/RichTextEditorMention.tsx`:
   - Attributes (`:82-87`): add

     ```ts
     kind: { default: "person" },
     entityId: { default: null },
     ```

   - `parseHTML` (`:88-100`) becomes one rule per scheme:

     ```ts
     parseHTML() {
       return ["mention:", "note:", "meeting:", "dictation:", "folder:"].map((prefix) => ({
         tag: `a[href^="${prefix}"]`,
         priority: 100,
         getAttrs: (element: HTMLElement) => {
           const parsed = parseMentionHref(element.getAttribute("href"));
           if (!parsed) return false;
           const label = (element.textContent ?? "").replace(/^@/, "");
           return { label, email: parsed.email, kind: parsed.kind, entityId: parsed.entityId };
         },
       }));
     },
     ```

   - `renderHTML` (`:101-112`):

     ```ts
     renderHTML({ node }) {
       const { label, email, kind, entityId } = node.attrs;
       return ["a", { href: mentionHref({ kind, label, email, entityId }), "data-mention": "", "data-mention-kind": kind }, `@${label}`];
     },
     ```

   - The markdown `serialize` (`:119-133`) calls `buildEntityMentionMarkdown({ kind: node.attrs.kind, label: node.attrs.label, entityId: node.attrs.entityId, email: node.attrs.email })`.
   - Import `buildEntityMentionMarkdown`, `mentionHref` and `parseMentionHref` from `../../utils/mentionMarkdown`.

   `tiptap-markdown` renders the stored markdown with markdown-it, whose `validateLink` blocks only `javascript:`, `vbscript:`, `file:` and `data:`, so `note:17` survives into the HTML this rule parses. The node rule's priority 100 wins over the Link mark's default 50. That is why `mention:` works today, and the same holds for the new schemes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/utils/mentionMarkdown.test.js`
Expected: PASS. The 9 existing tests and the 4 new ones all pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/mentionMarkdown.ts src/components/ui/RichTextEditorMention.tsx test/utils/mentionMarkdown.test.js
git commit -m "feat(notes): store note, meeting, dictation and folder mentions as links"
```

---

### Task 18: Universal mentions: search, grouped picker, chips and hover card

This covers WS-R7 B (People, Notes, Meetings, Dictations and Folders; a hover card with Open and Insert quote) and WS-21.

**Files:**
- Create: `src/lib/mentionSearch.ts`, `src/components/ui/MentionHoverCard.tsx`, `src/components/ui/useHoverCard.ts`
- Modify:
  - `src/components/ui/MentionSuggestions.tsx`: grouped rows;
  - `src/components/ui/RichTextEditorMention.tsx`: async items and the 262px width;
  - `src/components/ui/MentionChip.tsx`: navigation and hover card;
  - `src/components/ui/RichTextEditor.tsx`: builds the sources.
- Test: `test/lib/mentionSearch.test.js`, `test/components/mentionSuggestions.test.js`, `test/components/mentionHoverCard.test.js`, `test/components/hoverCard.test.js`

**Interfaces:**
- Consumes `MentionKind`, `MentionEntity` and `parseMentionHref` (Task 17); `useWorkspaceNavigation` (Task 3); `useTranscriptions()` (`transcriptionStore.ts:113`); `useFolders()`/`getFoldersValue()` (`noteStore.ts`); `useRecentNotes` (Task 9); and `window.electronAPI.searchNotes`, `searchContacts`, `getNote` and `getTranscriptionById` (`electron.ts:928, 969, 2014, 839`).
- Produces `src/lib/mentionSearch.ts`:

  ```ts
  export const MENTION_GROUP_LIMIT = 3;
  export const MENTION_GROUP_ORDER: readonly MentionKind[]; // person, note, meeting, dictation, folder
  export interface MentionResult extends MentionEntity { key: string; meta: string | null }
  export interface MentionGroup { kind: MentionKind; results: MentionResult[] }
  export interface MentionSources {
    people: MentionPerson[];
    searchContacts(query: string): Promise<Array<{ email: string; display_name: string | null }>>;
    searchNotes(query: string, limit: number): Promise<NoteItem[]>;
    recentNotes: NoteItem[];
    transcriptions: TranscriptionItem[];
    folders: FolderItem[];
    describe: {
      note(note: NoteItem): string; meeting(note: NoteItem): string;
      dictation(item: TranscriptionItem): string; folder(folder: FolderItem): string;
    };
  }
  export function searchMentionEntities(query: string, sources: MentionSources, kinds?: readonly MentionKind[]): Promise<MentionGroup[]>;
  export function flattenMentionGroups(groups: MentionGroup[]): MentionResult[];
  export function dictationLabel(text: string): string;      // first 40 chars + "…"
  export function quoteExcerpt(text: string, max?: number): string; // markdown-stripped, ≤ max (default 280)
  ```

- Produces `MentionHoverCard.tsx`:

  ```ts
  export type MentionPreviewState =
    | { status: "loading" }
    | { status: "missing" }
    | { status: "ready"; title: string; meta: string | null; excerpt: string };
  export function MentionPreview(props: { kind: MentionKind; state: MentionPreviewState; onOpen(): void; onInsertQuote?: () => void }): JSX.Element;
  ```

- Produces `useHoverCard.ts` (review I08):

  ```ts
  export const HOVER_CARD_CLOSE_DELAY_MS = 150;
  export type HoverCardEvent =
    | { type: "pointerEnter" } | { type: "pointerLeave" }
    | { type: "focusIn" } | { type: "focusOut"; staysInside: boolean }
    | { type: "escape" } | { type: "closeTimer" };
  export interface HoverCardState { open: boolean; closing: boolean }
  export function hoverCardReducer(state: HoverCardState, event: HoverCardEvent): HoverCardState;
  /** One hover/focus boundary around trigger + card: crossing the gap or
   *  tabbing into the card keeps it open; leaving both closes after a delay;
   *  Escape closes and returns focus to the trigger. */
  export function useHoverCard(triggerRef: React.RefObject<HTMLElement | null>): {
    open: boolean;
    boundary: {
      onMouseEnter(): void;
      onMouseLeave(): void;
      onFocus(): void;
      onBlur(e: React.FocusEvent): void;
      onKeyDown(e: React.KeyboardEvent): void;
    };
  };
  ```

- Suggestion items become `MentionResult`. The `command` inserts `{ label, email, kind, entityId }`.

- [ ] **Step 1: Write the failing tests**

Create `test/lib/mentionSearch.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/mentionSearch.ts");
const note = (id, title, note_type = "personal") => ({ id, title, note_type, content: "", folder_id: 1, space_id: 1, created_at: "2026-10-14 10:00:00", updated_at: "2026-10-14 10:00:00" });
const sources = (over = {}) => ({
  people: [{ name: "Maya Chen", email: "maya@acme.co" }, { name: "Jonas Weber", email: null }],
  searchContacts: async () => [{ email: "maya@acme.co", display_name: "Maya Chen" }, { email: "priya@acme.co", display_name: "Priya Nair" }],
  searchNotes: async () => [note(17, "Pricing FAQ draft"), note(38, "Pricing review", "meeting")],
  recentNotes: [note(5, "Product catch-up")],
  transcriptions: [{ id: 311, text: "Draft a reply to Maya: the pricing change goes out Thursday, not Monday.", timestamp: "2026-10-14 14:15:00", audio_duration_ms: 9000 }],
  folders: [{ id: 2, name: "Work", space_id: 1 }, { id: 3, name: "Personal", space_id: 1 }],
  describe: { note: () => "Work · today", meeting: () => "Fri 9 Oct · 55 min", dictation: () => "Today 2:15 PM · 0:09", folder: () => "3 notes" },
  ...over,
});

test("groups come back People, Notes, Meetings, Dictations, Folders, at most three each", async () => {
  const { searchMentionEntities } = await load();
  const groups = await searchMentionEntities("", sources());
  assert.deepEqual(groups.map((g) => g.kind), ["person", "note", "dictation", "folder"]);
  for (const group of groups) assert.ok(group.results.length <= 3, group.kind);
});

test("a query searches every kind and dedupes people by email", async () => {
  const { searchMentionEntities } = await load();
  const groups = await searchMentionEntities("ma", sources());
  const people = groups.find((g) => g.kind === "person").results;
  assert.deepEqual(people.map((p) => p.label), ["Maya Chen"]);
  const pricing = await searchMentionEntities("pricing", sources());
  assert.deepEqual(pricing.map((g) => g.kind), ["note", "meeting", "dictation"]);
  assert.deepEqual(pricing.find((g) => g.kind === "meeting").results[0], {
    key: "meeting-38",
    kind: "meeting",
    label: "Pricing review",
    entityId: "38",
    email: null,
    meta: "Fri 9 Oct · 55 min",
  });
});

test("one failing source never empties the others", async () => {
  const { searchMentionEntities } = await load();
  const groups = await searchMentionEntities("pricing", sources({ searchNotes: async () => { throw new Error("db"); } }));
  assert.deepEqual(groups.map((g) => g.kind), ["dictation"]);
});

test("chat context can restrict the kinds", async () => {
  const { searchMentionEntities } = await load();
  const groups = await searchMentionEntities("", sources(), ["note", "meeting", "folder"]);
  assert.deepEqual(groups.map((g) => g.kind), ["note", "folder"]);
});

test("dictation labels and quotes are short and clean", async () => {
  const { dictationLabel, quoteExcerpt } = await load();
  assert.equal(dictationLabel("Draft a reply to Maya: the pricing change goes out Thursday."), "Draft a reply to Maya: the pricing chan…");
  assert.equal(quoteExcerpt("## Decisions\n- **Thursday**, not Monday\n[@Maya](mention:maya%40acme.co) owns it"), "Decisions Thursday, not Monday @Maya owns it");
  assert.ok(quoteExcerpt("x".repeat(500)).length <= 280);
});
```

Create `test/components/mentionSuggestions.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { renderStatic } = require("../helpers/harness/reactSsr");

async function load() {
  if (!i18next.isInitialized) {
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8"));
    await i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  }
  return import("../../src/components/ui/MentionSuggestions.tsx");
}

test("rows are grouped with headers and carry a type marker plus meta", async () => {
  const { default: MentionSuggestions } = await load();
  const html = renderStatic(MentionSuggestions, {
    command: () => {},
    items: [
      { key: "person-maya", kind: "person", label: "Maya Chen", entityId: null, email: "maya@acme.co", meta: "maya@acme.co" },
      { key: "meeting-38", kind: "meeting", label: "Pricing review", entityId: "38", email: null, meta: "Fri 9 Oct · 55 min" },
    ],
  });
  assert.match(html, />People</);
  assert.match(html, />Meetings</);
  assert.match(html, /data-kind="meeting"[\s\S]*Pricing review[\s\S]*Fri 9 Oct · 55 min/);
  assert.match(html, /role="listbox"/);
});

test("an empty result says so", async () => {
  const { default: MentionSuggestions } = await load();
  assert.match(renderStatic(MentionSuggestions, { command: () => {}, items: [] }), /Nothing to mention/);
});
```

Create `test/components/hoverCard.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/ui/useHoverCard.ts");
const closed = { open: false, closing: false };

test("moving from the chip across the gap into the card keeps it open (I08)", async () => {
  const { hoverCardReducer: r } = await load();
  let s = r(closed, { type: "pointerEnter" });
  s = r(s, { type: "pointerLeave" }); // leaves the chip
  assert.deepEqual(s, { open: true, closing: true });
  s = r(s, { type: "pointerEnter" }); // reaches the card before the timer
  assert.deepEqual(s, { open: true, closing: false });
  assert.deepEqual(r(s, { type: "closeTimer" }), { open: true, closing: false }, "a stale timer is ignored");
});

test("leaving both closes after the delay", async () => {
  const { hoverCardReducer: r } = await load();
  const s = r(r(closed, { type: "pointerEnter" }), { type: "pointerLeave" });
  assert.deepEqual(r(s, { type: "closeTimer" }), closed);
});

test("tabbing from the chip into Open and Insert quote keeps it open; tabbing out closes", async () => {
  const { hoverCardReducer: r } = await load();
  let s = r(closed, { type: "focusIn" });
  s = r(s, { type: "focusOut", staysInside: true }); // chip → Open
  assert.equal(s.open, true);
  s = r(s, { type: "focusOut", staysInside: true }); // Open → Insert quote
  assert.equal(s.open, true);
  assert.deepEqual(r(s, { type: "focusOut", staysInside: false }), closed);
});

test("Escape closes", async () => {
  const { hoverCardReducer: r } = await load();
  assert.deepEqual(r({ open: true, closing: false }, { type: "escape" }), closed);
});

test("the chip and its card share one boundary, and the card is editor chrome", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../src/components/ui/MentionChip.tsx"), "utf8");
  assert.match(src, /useHoverCard\(chipRef\)/);
  assert.match(src, /<span\s+\{\.\.\.boundary\}/);
  assert.match(src, /data-editor-chrome=""/);
  assert.doesNotMatch(src, /onBlur=\{\(\) => setOpen\(false\)\}/);
});
```

The fake DOM has no pointer or focus events, so the boundary is tested as a reducer and its wiring is pinned. Task 27 checks the real pointer, Tab, Escape and RTL behaviour.

Create `test/components/mentionHoverCard.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { renderStatic } = require("../helpers/harness/reactSsr");

async function load() {
  if (!i18next.isInitialized) {
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8"));
    await i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  }
  return import("../../src/components/ui/MentionHoverCard.tsx");
}
const ready = { status: "ready", title: "Pricing review", meta: "Fri 9 Oct · 55 min", excerpt: "so Thursday, not Monday" };

test("meetings and dictations can be quoted; notes and folders only opened", async () => {
  const { MentionPreview } = await load();
  const meeting = renderStatic(MentionPreview, { kind: "meeting", state: ready, onOpen: () => {}, onInsertQuote: () => {} });
  assert.match(meeting, />Open</);
  assert.match(meeting, />Insert quote</);
  const noteCard = renderStatic(MentionPreview, { kind: "note", state: ready, onOpen: () => {} });
  assert.doesNotMatch(noteCard, /Insert quote/);
});

test("a deleted target says so instead of opening nothing", async () => {
  const { MentionPreview } = await load();
  const html = renderStatic(MentionPreview, { kind: "note", state: { status: "missing" }, onOpen: () => {} });
  assert.match(html, /no longer exists/);
  assert.doesNotMatch(html, />Open</);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/lib/mentionSearch.test.js test/components/mentionSuggestions.test.js test/components/mentionHoverCard.test.js`
Expected: FAIL. Two modules are missing, and the existing `MentionSuggestions` has no group headers.

- [ ] **Step 3: Implement**

1. Create `src/lib/mentionSearch.ts`:

   ```ts
   import type { FolderItem, NoteItem, TranscriptionItem } from "../types/electron";
   import type { MentionEntity, MentionKind, MentionPerson } from "../utils/mentionMarkdown";

   export const MENTION_GROUP_LIMIT = 3;
   export const MENTION_GROUP_ORDER: readonly MentionKind[] = ["person", "note", "meeting", "dictation", "folder"];

   export interface MentionResult extends MentionEntity {
     key: string;
     meta: string | null;
   }
   export interface MentionGroup {
     kind: MentionKind;
     results: MentionResult[];
   }
   export interface MentionSources {
     people: MentionPerson[];
     searchContacts(query: string): Promise<Array<{ email: string; display_name: string | null }>>;
     searchNotes(query: string, limit: number): Promise<NoteItem[]>;
     recentNotes: NoteItem[];
     transcriptions: TranscriptionItem[];
     folders: FolderItem[];
     describe: {
       note(note: NoteItem): string;
       meeting(note: NoteItem): string;
       dictation(item: TranscriptionItem): string;
       folder(folder: FolderItem): string;
     };
   }

   const LABEL_MAX = 40;
   export function dictationLabel(text: string): string {
     const clean = text.replace(/\s+/g, " ").trim();
     return clean.length > LABEL_MAX ? `${clean.slice(0, LABEL_MAX - 1)}…` : clean;
   }

   export function quoteExcerpt(text: string, max = 280): string {
     const plain = text
       .replace(/\[(@?[^\]]*)\]\([^)]*\)/g, "$1") // links and mentions keep their label
       .replace(/^[\s#>\-]+/gm, "") // line-leading heading, quote and list markers
       .replace(/[*_`~]+/g, "") // inline emphasis markers
       .replace(/\s+/g, " ")
       .trim();
     return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
   }

   const includes = (haystack: string | null | undefined, needle: string) =>
     !needle || (haystack ?? "").toLocaleLowerCase().includes(needle);

   export async function searchMentionEntities(
     query: string,
     sources: MentionSources,
     kinds: readonly MentionKind[] = MENTION_GROUP_ORDER
   ): Promise<MentionGroup[]> {
     const needle = query.trim().toLocaleLowerCase();
     const wants = (kind: MentionKind) => kinds.includes(kind);
     const [contacts, notes] = await Promise.allSettled([
       wants("person") && needle ? sources.searchContacts(needle) : Promise.resolve([]),
       wants("note") || wants("meeting")
         ? needle
           ? sources.searchNotes(needle, 8)
           : Promise.resolve(sources.recentNotes)
         : Promise.resolve([]),
     ]);

     const people = new Map<string, MentionResult>();
     const addPerson = (name: string, email: string | null) => {
       const key = (email ?? name).toLocaleLowerCase();
       if (people.has(key) || !(includes(name, needle) || includes(email, needle))) return;
       people.set(key, { key: `person-${key}`, kind: "person", label: name, entityId: null, email, meta: email });
     };
     if (wants("person")) {
       for (const person of sources.people) addPerson(person.name, person.email);
       if (contacts.status === "fulfilled") for (const c of contacts.value) addPerson(c.display_name || c.email, c.email);
     }

     const noteRows = notes.status === "fulfilled" ? notes.value : [];
     const toNote = (note: NoteItem): MentionResult => {
       const kind = note.note_type === "meeting" ? "meeting" : "note";
       return {
         key: `${kind}-${note.id}`,
         kind,
         label: note.title || "",
         entityId: String(note.id),
         email: null,
         meta: kind === "meeting" ? sources.describe.meeting(note) : sources.describe.note(note),
       };
     };

     const byKind: Record<MentionKind, MentionResult[]> = {
       person: [...people.values()],
       note: wants("note") ? noteRows.filter((n) => n.note_type !== "meeting").map(toNote) : [],
       meeting: wants("meeting") ? noteRows.filter((n) => n.note_type === "meeting").map(toNote) : [],
       dictation: wants("dictation")
         ? sources.transcriptions
             .filter((item) => item.status !== "discarded" && includes(item.text, needle))
             .map((item) => ({
               key: `dictation-${item.id}`,
               kind: "dictation" as const,
               label: dictationLabel(item.text),
               entityId: String(item.id),
               email: null,
               meta: sources.describe.dictation(item),
             }))
         : [],
       folder: wants("folder")
         ? sources.folders
             .filter((folder) => includes(folder.name, needle))
             .map((folder) => ({
               key: `folder-${folder.id}`,
               kind: "folder" as const,
               label: folder.name,
               entityId: String(folder.id),
               email: null,
               meta: sources.describe.folder(folder),
             }))
         : [],
     };

     return MENTION_GROUP_ORDER.filter(wants)
       .map((kind) => ({ kind, results: byKind[kind].slice(0, MENTION_GROUP_LIMIT) }))
       .filter((group) => group.results.length > 0);
   }

   export function flattenMentionGroups(groups: MentionGroup[]): MentionResult[] {
     return groups.flatMap((group) => group.results);
   }
   ```

   With an empty query, `recentNotes` holds one personal note and no meeting. That is why the first test expects no Meetings group. The `"ma"` query matches Maya by name; Jonas does not match, and Priya's contact matches neither field, so People is exactly Maya.

2. Replace `src/components/ui/MentionSuggestions.tsx` with a grouped version:
   - Keep `MentionSuggestionsHandle` and the ArrowUp, ArrowDown, Enter and Tab handling (`:31-47`).
   - Change `MentionSuggestionItem` to `export type MentionSuggestionItem = MentionResult;`.
   - Render groups with `groupBy(kind)` in `MENTION_GROUP_ORDER` order:
     - a `w-[262px] max-h-[236px] overflow-y-auto` `role="listbox"`;
     - group headers in `text-micro uppercase text-muted-foreground` using `t(\`mention.groups.${kind}\`)`;
     - rows of at least 30px with `role="option"`, `aria-selected` and `data-kind={item.kind}`.
   - Each row shows `<MentionMarker kind={item.kind} email={item.email} label={item.label} />`, the label in `text-ui`, and the meta in `text-caption text-muted-foreground`.
   - Instead of returning `null` for no items, render `t("mention.empty")` in a 262px box.

   Add `MentionMarker` in the same file:

   ```tsx
   export function MentionMarker({ kind, email, label }: { kind: MentionKind; email: string | null; label: string }) {
     if (kind === "person") return <PersonAvatar email={email} displayName={label} size={14} />;
     const shape = {
       note: "size-2 rounded-[2px] border border-current text-muted-foreground",
       meeting: "size-[9px] rounded-[3px] bg-ai",
       dictation: "size-[7px] rounded-full bg-foreground/60",
       folder: "h-[7px] w-2.5 rounded-[2px] border border-current text-muted-foreground",
     }[kind];
     return <span aria-hidden className={cn("inline-block shrink-0", shape)} />;
   }
   ```

   The dictation dot is neutral. Orange is reserved for something listening right now (D1), and a stored dictation is not.

3. In `src/components/ui/RichTextEditorMention.tsx`:
   - Change the signature to `createMentionExtension(getSources: () => MentionSources)`.
   - Set `SUGGESTION_WIDTH = 262`.
   - Suggestion `items: async ({ query }) => flattenMentionGroups(await searchMentionEntities(query, getSources()))`. `@tiptap/suggestion` accepts a Promise.
   - `command`: `editor.chain().focus().insertContentAt(range, [{ type: "mention", attrs: { label: item.label, email: item.email, kind: item.kind, entityId: item.entityId } }, { type: "text", text: " " }]).run()`.
   - Delete `toSuggestionItems` (`:66-72`), since `searchMentionEntities` replaces it.

4. In `src/components/ui/RichTextEditor.tsx`, mentions turn on for every editable editor that receives `mentionPeople`. `NoteEditor` already passes an array (possibly empty) to both editable editors, so `@` now works in notes with no attendees (WS-21). Build the sources with a ref:

   ```ts
   const transcriptions = useTranscriptions();
   const folders = useFolders();
   const recentNotes = useRecentNotes(6);
   const sourcesRef = useRef<MentionSources | null>(null);
   sourcesRef.current = {
     people: mentionPeopleRef.current ?? [],
     searchContacts: async (query) => (await window.electronAPI.searchContacts(query))?.contacts ?? [],
     searchNotes: (query, limit) => window.electronAPI.searchNotes(query, limit),
     recentNotes,
     transcriptions,
     folders,
     describe: {
       note: (note) => [folders.find((f) => f.id === note.folder_id)?.name, formatRelativeTime(note.updated_at, t, i18n.language)].filter(Boolean).join(" · "),
       meeting: (note) => formatRelativeTime(note.created_at, t, i18n.language),
       dictation: (item) =>
         [formatRelativeTime(item.created_at, t, i18n.language), item.audio_duration_ms != null ? formatElapsed(item.audio_duration_ms) : null]
           .filter(Boolean)
           .join(" · "),
       folder: (folder) => t("mention.folderMeta"),
     },
   };
   ```

   Then pass `createMentionExtension(() => sourcesRef.current!)`. `formatRelativeTime` is the helper `CommandSearch.tsx` already imports; use the same import path.

5. Create `src/components/ui/MentionHoverCard.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { Quote } from "lucide-react";
   import type { MentionKind } from "../../utils/mentionMarkdown";

   export type MentionPreviewState =
     | { status: "loading" }
     | { status: "missing" }
     | { status: "ready"; title: string; meta: string | null; excerpt: string };

   export function MentionPreview({
     kind,
     state,
     onOpen,
     onInsertQuote,
   }: {
     kind: MentionKind;
     state: MentionPreviewState;
     onOpen: () => void;
     onInsertQuote?: () => void;
   }) {
     const { t } = useTranslation();
     return (
       <div className="w-60 rounded-lg border border-border bg-popover p-3 text-start shadow-lg">
         {state.status === "loading" && <p className="text-caption text-muted-foreground">{t("mention.loading")}</p>}
         {state.status === "missing" && <p className="text-caption text-muted-foreground">{t("mention.missing")}</p>}
         {state.status === "ready" && (
           <>
             <p dir="auto" className="truncate text-ui font-semibold text-foreground">{state.title}</p>
             {state.meta && <p className="text-caption text-muted-foreground">{state.meta}</p>}
             {state.excerpt && (
               <p dir="auto" className="mt-2 line-clamp-3 border-s-2 border-agent ps-2 text-caption text-foreground">{state.excerpt}</p>
             )}
             <div className="mt-2 flex items-center gap-3">
               <button type="button" onClick={onOpen} className="text-ui text-link hover:underline">{t("mention.open")}</button>
               {onInsertQuote && (kind === "meeting" || kind === "dictation") && (
                 <button type="button" onClick={onInsertQuote} className="flex items-center gap-1 text-ui text-link hover:underline">
                   <Quote size={12} aria-hidden />
                   {t("mention.insertQuote")}
                 </button>
               )}
             </div>
           </>
         )}
       </div>
     );
   }
   ```

5a. Create `src/components/ui/useHoverCard.ts`:

   ```ts
   import { useCallback, useEffect, useReducer } from "react";

   export const HOVER_CARD_CLOSE_DELAY_MS = 150;

   export type HoverCardEvent =
     | { type: "pointerEnter" }
     | { type: "pointerLeave" }
     | { type: "focusIn" }
     | { type: "focusOut"; staysInside: boolean }
     | { type: "escape" }
     | { type: "closeTimer" };

   export interface HoverCardState {
     open: boolean;
     closing: boolean;
   }

   const CLOSED: HoverCardState = { open: false, closing: false };

   export function hoverCardReducer(state: HoverCardState, event: HoverCardEvent): HoverCardState {
     switch (event.type) {
       case "pointerEnter":
       case "focusIn":
         return { open: true, closing: false };
       case "pointerLeave":
         return state.open ? { open: true, closing: true } : state;
       case "focusOut":
         return event.staysInside ? state : CLOSED;
       case "escape":
         return CLOSED;
       case "closeTimer":
         return state.closing ? CLOSED : state;
     }
   }

   export function useHoverCard(triggerRef: React.RefObject<HTMLElement | null>) {
     const [state, dispatch] = useReducer(hoverCardReducer, CLOSED);
     useEffect(() => {
       if (!state.closing) return;
       const id = window.setTimeout(() => dispatch({ type: "closeTimer" }), HOVER_CARD_CLOSE_DELAY_MS);
       return () => window.clearTimeout(id);
     }, [state.closing]);
     const boundary = {
       onMouseEnter: useCallback(() => dispatch({ type: "pointerEnter" }), []),
       onMouseLeave: useCallback(() => dispatch({ type: "pointerLeave" }), []),
       onFocus: useCallback(() => dispatch({ type: "focusIn" }), []),
       onBlur: useCallback((e: React.FocusEvent) => {
         const next = e.relatedTarget as Node | null;
         dispatch({ type: "focusOut", staysInside: !!next && e.currentTarget.contains(next) });
       }, []),
       onKeyDown: useCallback(
         (e: React.KeyboardEvent) => {
           if (e.key !== "Escape") return;
           e.stopPropagation();
           dispatch({ type: "escape" });
           triggerRef.current?.focus();
         },
         [triggerRef]
       ),
     };
     return { open: state.open, boundary };
   }
   ```

6. Replace `src/components/ui/MentionChip.tsx`. Keep the person rendering for `kind === "person"`, and add navigation and the hover card for entities:

   ```tsx
   export default function MentionChip({ node, editor, getPos }: NodeViewProps) {
     const { t, i18n } = useTranslation();
     const navigation = useWorkspaceNavigation();
     const { label, email, kind = "person", entityId } = node.attrs as { label: string; email: string | null; kind: MentionKind; entityId: string | null };
     const chipRef = useRef<HTMLButtonElement>(null);
     // One hover/focus boundary around chip and card (review I08).
     const { open, boundary } = useHoverCard(chipRef);
     const [preview, setPreview] = useState<MentionPreviewState>({ status: "loading" });
     const id = entityId ? Number(entityId) : null;

     useEffect(() => {
       if (!open || id == null || kind === "person" || kind === "folder") return;
       let alive = true;
       const load = kind === "dictation" ? window.electronAPI.getTranscriptionById(id) : window.electronAPI.getNote(id);
       void load
         .then((item: any) => {
           if (!alive) return;
           if (!item) return setPreview({ status: "missing" });
           const text = kind === "dictation" ? item.text : item.enhanced_content || item.content || "";
           setPreview({
             status: "ready",
             title: kind === "dictation" ? label : item.title || t("notes.list.untitledNote"),
             meta: formatRelativeTime(item.created_at, t, i18n.language),
             excerpt: quoteExcerpt(text, 240),
           });
         })
         .catch(() => alive && setPreview({ status: "missing" }));
       return () => {
         alive = false;
       };
     }, [open, id, kind, label, t, i18n.language]);

     const openTarget = () => {
       if (id == null) return;
       if (kind === "note" || kind === "meeting") navigation.openNote(id);
       else if (kind === "dictation") navigation.openTranscript(id);
       else if (kind === "folder") {
         const folder = getFoldersValue().find((f) => f.id === id);
         if (folder) navigation.openFolder(folder.space_id, folder.id);
       }
     };

     const insertQuote = () => {
       if (preview.status !== "ready" || typeof getPos !== "function") return;
       const pos = getPos();
       if (pos == null) return;
       const after = editor.state.doc.resolve(pos).after();
       editor.chain().focus().insertContentAt(after, {
         type: "blockquote",
         content: [{ type: "paragraph", content: [{ type: "text", text: preview.excerpt }] }],
       }).run();
       chipRef.current?.focus();
     };

     if (kind === "person") {
       return (
         <NodeViewWrapper as="span" className="inline-flex items-baseline align-baseline mx-px">
           <span
             data-mention
             data-mention-kind="person"
             title={email ?? undefined}
             className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-foreground/4 px-1 py-px text-[0.85em] font-medium leading-tight text-foreground whitespace-nowrap dark:bg-white/6"
           >
             <PersonAvatar email={email} displayName={label} size={13} />
             {label}
           </span>
         </NodeViewWrapper>
       );
     }

     return (
       <NodeViewWrapper as="span" className="inline-flex items-baseline align-baseline mx-px">
         {/* The boundary wraps chip and card, so the padded gap between them is
             inside it; logical start-0 keeps the card aligned in RTL. */}
         <span {...boundary} className="relative inline-flex">
           <button
             ref={chipRef}
             type="button"
             data-mention
             data-mention-kind={kind}
             contentEditable={false}
             onClick={openTarget}
             className="inline-flex h-5 items-center gap-1 rounded-md bg-foreground/6 px-1.5 text-[0.85em] font-medium text-foreground hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
           >
             <MentionMarker kind={kind} email={email} label={label} />
             {label}
           </button>
           {open && kind !== "folder" && (
             <span data-editor-chrome="" className="absolute start-0 top-full z-50 pt-1">
               <MentionPreview kind={kind} state={preview} onOpen={openTarget} onInsertQuote={editor.isEditable ? insertQuote : undefined} />
             </span>
           )}
         </span>
       </NodeViewWrapper>
     );
   }
   ```

   Imports for this file: `useEffect`, `useRef` and `useState` from React, `useHoverCard` from `./useHoverCard`, and `MentionPreview`/`MentionPreviewState` from `./MentionHoverCard`. Also import `MentionMarker` from `./MentionSuggestions`, `quoteExcerpt` from `../../lib/mentionSearch`, `getFoldersValue` from `../../stores/noteStore`, and `useWorkspaceNavigation`.

   Tiptap renders React node views through portals inside `EditorContent`, so `useWorkspaceNavigation()` reads `ControlPanel`'s provider. Outside a provider, navigation is inert (Task 3).

   The chip uses `text-[0.85em]`, which is relative to the 16px note body. It is not a fixed pixel size, so the Task 25 guard (arbitrary `px` sizes only) allows it.

7. Add strings (Task 1 helper). English block:

   ```json
   {
     "mention": {
       "groups": { "person": "People", "note": "Notes", "meeting": "Meetings", "dictation": "Dictations", "folder": "Folders" },
       "empty": "Nothing to mention",
       "loading": "Loading…",
       "missing": "This item no longer exists.",
       "open": "Open",
       "insertQuote": "Insert quote",
       "folderMeta": "Folder"
     }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/lib/mentionSearch.test.js test/components/mentionSuggestions.test.js test/components/mentionHoverCard.test.js test/utils/mentionMarkdown.test.js test/locales/translationCoverage.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mentionSearch.ts src/components/ui/MentionHoverCard.tsx src/components/ui/useHoverCard.ts test/components/hoverCard.test.js src/components/ui/MentionSuggestions.tsx src/components/ui/MentionChip.tsx src/components/ui/RichTextEditorMention.tsx src/components/ui/RichTextEditor.tsx src/locales test/lib/mentionSearch.test.js test/components/mentionSuggestions.test.js test/components/mentionHoverCard.test.js
git commit -m "feat(notes): mention people, notes, meetings, dictations and folders"
```

---

### Task 19: Chat sources: tool metadata, RAG references and citation markers

This covers the WS-R8 B data and interpretation 7. Today `ReasoningService.ts:252-260` never yields `metadata`, so the existing note cards cannot render. This task fixes that as a side effect.

**Files:**
- Create: `src/components/chat/citations.ts`, `src/components/chat/ragContext.ts`
- Modify: `src/services/ReasoningService.ts:252-260`. The `tool_result` yield now carries metadata.
- Modify: `src/components/chat/types.ts`. `Message` gains `context?`.
- Modify: `src/components/chat/useChatStreaming.ts`:
  - `buildRAGContext` (`:36-60`) moves to `ragContext.ts`;
  - the assistant message creation at `:346`;
  - the system prompt at `:298-305`;
  - `onStreamComplete` (`:79`, `:481`, `:505`).
- Modify: `src/components/chat/useChatPersistence.ts`. Save and load `context` (`:68-97`).
- Modify: `src/components/chat/ChatView.tsx:51-53`. Pass `context` through to `saveAssistantMessage`.
- Modify: `src/config/prompts/index.ts` and `src/config/prompts.ts:3-9`. Add the `appendCitationSuffix` export.
- Test: `test/components/chatCitations.test.js`, `test/components/ragContext.test.js`, `test/config/citationSuffix.test.js`

**Interfaces:**
- Produces `citations.ts`:

  ```ts
  export interface SourceHit { id: number; title: string; date: string | null; type: string | null; quote: string }
  export function toToolMetadata(toolName: string, result: unknown): SourceHit | SourceHit[] | undefined;
  export interface RagNoteRef { id: number; title: string; type: string | null; date: string | null; quote: string }
  export interface CitationSource { n: number | null; noteId: number; title: string; kind: "note" | "meeting"; date: string | null; quote: string }
  export const CITATION_MARKER: RegExp; // /\[note:(\d+)\]/g
  export function collectSources(toolCalls: ToolCallInfo[] | undefined, ragNotes: RagNoteRef[] | undefined): Map<number, Omit<CitationSource, "n">>;
  export function numberCitations(content: string, candidates: Map<number, Omit<CitationSource, "n">>): { numbers: Map<number, number>; sources: CitationSource[] };
  // sources: cited, numbered 1..k in order of first appearance; when nothing is cited, up to 5 uncited candidates with n: null
  ```

- Produces `ragContext.ts`: `buildRagContext(api: Pick<ElectronAPI, "semanticSearchNotes" | "getNote">, userText: string, scope?: { spaceId?: number | null; folderId?: number | null }): Promise<{ text: string; notes: RagNoteRef[] }>`.
- `Message.context?: { ragNotes?: RagNoteRef[]; pinnedNotes?: RagNoteRef[]; route?: MessageRoute | null }`. `pinnedNotes` is filled by Task 22 (review I12). In it, `MessageRoute` is `{ model: string | null; providerId: string | null; locality: Locality }`. The raw id is stored, so a later language change still renders the name through `providerDisplayLabel`. `route` is filled by Task 21.
- `onStreamComplete(assistantId, content, toolCalls?, context?)` and `saveAssistantMessage(content, toolCalls?, context?)`. Metadata is persisted as `{ toolCalls, context }`.
- `appendCitationSuffix(prompt: string): string`. The instruction is English-only and model-facing.

- [ ] **Step 1: Write the failing tests**

Create `test/components/chatCitations.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { toToolMetadata, collectSources, numberCitations } = require("../../src/components/chat/citations.ts");

const searchResult = [
  { id: 38, title: "Pricing review", date: "2026-10-09", type: "meeting", space: "Work", content: "so Thursday, not Monday, because legal needs one more day" },
  { id: 5, title: "Product catch-up", date: "2026-10-14", type: "personal", space: "Work", content: "Maya owns FAQ copy" },
  { id: null, title: "bad" },
];

test("search_notes results become compact source hits; bad ids are dropped", () => {
  const meta = toToolMetadata("search_notes", searchResult);
  assert.deepEqual(meta.map((h) => h.id), [38, 5]);
  assert.equal(meta[0].quote, "so Thursday, not Monday, because legal needs one more day");
  assert.equal(meta[0].type, "meeting");
});

test("note tools become one hit; errors and other tools carry nothing", () => {
  assert.equal(toToolMetadata("get_note", { id: 9, title: "Roadmap", content: "x".repeat(900), type: "personal", created_at: "2026-10-01" }).quote.length <= 240, true);
  assert.equal(toToolMetadata("get_note", { error: "Note with ID 9 not found" }), undefined);
  assert.equal(toToolMetadata("copy_to_clipboard", { ok: true }), undefined);
});

test("citations are numbered in order of first appearance; unknown ids are ignored", () => {
  const candidates = collectSources(
    [{ id: "t1", name: "search_notes", arguments: "{}", status: "completed", result: "Found 2", metadata: toToolMetadata("search_notes", searchResult) }],
    [{ id: 17, title: "Pricing FAQ draft", type: "personal", date: null, quote: "Local transcription is always included" }]
  );
  const { numbers, sources } = numberCitations(
    "Thursday, not Monday [note:38]. Maya owns the FAQ [note:5]. Local stays included [note:17]. Again [note:38]. Invented [note:999].",
    candidates
  );
  assert.deepEqual([...numbers], [[38, 1], [5, 2], [17, 3]]);
  assert.deepEqual(sources.map((s) => [s.n, s.noteId, s.kind]), [[1, 38, "meeting"], [2, 5, "note"], [3, 17, "note"]]);
});

test("an answer with no markers still lists what was read, unnumbered", () => {
  const candidates = collectSources(
    [{ id: "t1", name: "search_notes", arguments: "{}", status: "completed", metadata: toToolMetadata("search_notes", searchResult) }],
    []
  );
  const { numbers, sources } = numberCitations("A plain answer.", candidates);
  assert.equal(numbers.size, 0);
  assert.deepEqual(sources.map((s) => [s.n, s.noteId]), [[null, 38], [null, 5]]);
});

test("tool calls still running contribute nothing yet", () => {
  const candidates = collectSources(
    [{ id: "t1", name: "search_notes", arguments: "{}", status: "executing", metadata: toToolMetadata("search_notes", searchResult) }],
    []
  );
  assert.equal(candidates.size, 0);
});
```

Create `test/components/ragContext.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/chat/ragContext.ts");

test("RAG context returns the prompt block and the notes it used", async () => {
  const { buildRagContext } = await load();
  const api = {
    semanticSearchNotes: async () => [{ id: 17, title: "Pricing FAQ draft" }, { id: 4, title: "Gone" }],
    getNote: async (id) => (id === 17 ? { id: 17, title: "Pricing FAQ draft", content: "Local transcription is always included", note_type: "personal", updated_at: "2026-10-13" } : null),
  };
  const { text, notes } = await buildRagContext(api, "pricing");
  assert.match(text, /<note id="17" title="Pricing FAQ draft">\nLocal transcription is always included\n<\/note>/);
  assert.deepEqual(notes.map((n) => n.id), [17]);
});

test("a failing search yields no context, never an exception", async () => {
  const { buildRagContext } = await load();
  assert.deepEqual(await buildRagContext({ semanticSearchNotes: async () => { throw new Error("x"); }, getNote: async () => null }, "q"), { text: "", notes: [] });
  assert.deepEqual(await buildRagContext({}, "q"), { text: "", notes: [] });
});

test("titles cannot break the note tag", async () => {
  const { buildRagContext } = await load();
  const api = {
    semanticSearchNotes: async () => [{ id: 2, title: 'x" injected="1' }],
    getNote: async () => ({ id: 2, title: 'x" injected="1', content: "body", note_type: "personal" }),
  };
  const { text } = await buildRagContext(api, "q");
  assert.doesNotMatch(text, /injected="1"/);
});
```

Create `test/config/citationSuffix.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");

test("the citation instruction is a suffix, so the chat prompt hash ratchet is untouched", () => {
  const index = fs.readFileSync(path.join(root, "src/config/prompts/index.ts"), "utf8");
  assert.match(index, /export function appendCitationSuffix\(prompt: string\): string/);
  assert.match(index, /\[note:ID\]/);
  assert.match(fs.readFileSync(path.join(root, "src/config/prompts.ts"), "utf8"), /appendCitationSuffix,/);
  const streaming = fs.readFileSync(path.join(root, "src/components/chat/useChatStreaming.ts"), "utf8");
  assert.match(streaming, /if \(citations && hasSources\) systemPrompt = appendCitationSuffix\(systemPrompt\)/);
  assert.match(streaming, /citations\?: boolean/);
  // Only the Chat view opts in; other chat surfaces would show raw markers.
  for (const other of ["src/components/dictation/AssistantPanel.tsx", "src/hooks/useEmbeddedChat.ts", "src/hooks/useContainerChat.ts"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, other), "utf8"), /citations:\s*true/, other);
  }
  assert.match(fs.readFileSync(path.join(root, "src/components/chat/ChatView.tsx"), "utf8"), /citations:\s*true/);
});

test("tool results reach the renderer with their sources", () => {
  const service = fs.readFileSync(path.join(root, "src/services/ReasoningService.ts"), "utf8");
  assert.match(service, /metadata:\s*toToolMetadata\(event\.name, result\)/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/chatCitations.test.js test/components/ragContext.test.js test/config/citationSuffix.test.js`
Expected: FAIL. Modules are missing and the regexes do not match.

- [ ] **Step 3: Implement**

1. Create `src/components/chat/citations.ts`:

   ```ts
   import type { ToolCallInfo } from "./types";

   export interface SourceHit { id: number; title: string; date: string | null; type: string | null; quote: string }
   export interface RagNoteRef { id: number; title: string; type: string | null; date: string | null; quote: string }
   export interface CitationSource {
     n: number | null;
     noteId: number;
     title: string;
     kind: "note" | "meeting";
     date: string | null;
     quote: string;
   }

   export const CITATION_MARKER = /\[note:(\d+)\]/g;
   const QUOTE_MAX = 240;
   const UNCITED_MAX = 5;
   const NOTE_TOOLS = new Set(["get_note", "create_note", "update_note"]);

   const toHit = (raw: Record<string, unknown>): SourceHit | null => {
     const id = Number(raw.id);
     if (!Number.isSafeInteger(id) || id <= 0) return null;
     const content = typeof raw.content === "string" ? raw.content : "";
     return {
       id,
       title: typeof raw.title === "string" ? raw.title : "",
       date: (raw.date ?? raw.updated_at ?? raw.created_at ?? null) as string | null,
       type: typeof raw.type === "string" ? raw.type : null,
       quote: content.replace(/\s+/g, " ").trim().slice(0, QUOTE_MAX),
     };
   };

   // ReasoningService passes the AI-SDK tool result (the tool's `data` on
   // success, { error } on failure). Keep only what a citation needs.
   export function toToolMetadata(toolName: string, result: unknown): SourceHit | SourceHit[] | undefined {
     if (!result || typeof result !== "object" || "error" in (result as object)) return undefined;
     if (toolName === "search_notes" && Array.isArray(result)) {
       return result.map((r) => (r && typeof r === "object" ? toHit(r as Record<string, unknown>) : null)).filter((h): h is SourceHit => !!h);
     }
     if (NOTE_TOOLS.has(toolName) && !Array.isArray(result)) return toHit(result as Record<string, unknown>) ?? undefined;
     return undefined;
   }

   const kindOf = (type: string | null): "note" | "meeting" => (type === "meeting" ? "meeting" : "note");

   export function collectSources(
     toolCalls: ToolCallInfo[] | undefined,
     ragNotes: RagNoteRef[] | undefined
   ): Map<number, Omit<CitationSource, "n">> {
     const out = new Map<number, Omit<CitationSource, "n">>();
     const add = (hit: SourceHit | RagNoteRef) => {
       if (out.has(hit.id)) return;
       out.set(hit.id, { noteId: hit.id, title: hit.title, kind: kindOf(hit.type), date: hit.date, quote: hit.quote });
     };
     for (const call of toolCalls ?? []) {
       if (call.status !== "completed" || !call.metadata) continue;
       const hits = (Array.isArray(call.metadata) ? call.metadata : [call.metadata]) as unknown as SourceHit[];
       for (const hit of hits) if (Number.isSafeInteger(hit?.id)) add(hit);
     }
     for (const note of ragNotes ?? []) add(note);
     return out;
   }

   export function numberCitations(
     content: string,
     candidates: Map<number, Omit<CitationSource, "n">>
   ): { numbers: Map<number, number>; sources: CitationSource[] } {
     const numbers = new Map<number, number>();
     for (const match of content.matchAll(CITATION_MARKER)) {
       const id = Number(match[1]);
       if (candidates.has(id) && !numbers.has(id)) numbers.set(id, numbers.size + 1);
     }
     if (numbers.size === 0) {
       return { numbers, sources: [...candidates.values()].slice(0, UNCITED_MAX).map((s) => ({ ...s, n: null })) };
     }
     const sources = [...numbers].map(([id, n]) => ({ ...candidates.get(id)!, n }));
     return { numbers, sources };
   }
   ```

   `test/helpers/noteCards.test.js` loads `.ts` with `require`, and this test does the same. `citations.ts` has only type imports, so it loads without a bundler.

2. Create `src/components/chat/ragContext.ts`. Move `buildRAGContext` (`useChatStreaming.ts:36-60`) here with the API injected and the used notes returned:

   ```ts
   import type { RagNoteRef } from "./citations";

   const RAG_NOTE_LIMIT = 5;
   const RAG_NOTE_SNIPPET_LENGTH = 500;
   const attr = (value: string) => value.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]!);

   type RagApi = {
     semanticSearchNotes?: (q: string, limit?: number, spaceId?: number | null, folderId?: number | null) => Promise<Array<{ id: number; title: string }>>;
     getNote?: (id: number) => Promise<{ id: number; title: string; content?: string | null; note_type?: string | null; updated_at?: string | null } | null>;
   };

   export async function buildRagContext(
     api: RagApi,
     userText: string,
     scope?: { spaceId?: number | null; folderId?: number | null }
   ): Promise<{ text: string; notes: RagNoteRef[] }> {
     if (!api?.semanticSearchNotes || !api.getNote) return { text: "", notes: [] };
     try {
       const results = await api.semanticSearchNotes(userText, RAG_NOTE_LIMIT, scope?.spaceId ?? null, scope?.folderId ?? null);
       const loaded = await Promise.all((results ?? []).map((r) => api.getNote!(r.id)));
       const notes = loaded.filter((n): n is NonNullable<typeof n> => !!n);
       const text = notes
         .map((note) => `<note id="${note.id}" title="${attr(note.title)}">\n${(note.content || "").slice(0, RAG_NOTE_SNIPPET_LENGTH)}\n</note>`)
         .join("\n\n");
       return {
         text,
         notes: notes.map((note) => ({
           id: note.id,
           title: note.title,
           type: note.note_type ?? null,
           date: note.updated_at ?? null,
           quote: (note.content || "").replace(/\s+/g, " ").trim().slice(0, 240),
         })),
       };
     } catch {
       return { text: "", notes: [] };
     }
   }
   ```

   Escaping the title attribute closes a prompt-structure injection: a note titled `x" …` could otherwise rewrite the tag the model reads. The old code interpolated titles raw.

3. In `src/services/ReasoningService.ts`, import `toToolMetadata` from `../components/chat/citations`. Change the `tool_result` yield (`:252-260`) to:

   ```ts
               yield {
                 type: "tool_result",
                 callId: event.callId,
                 toolName: event.name,
                 displayText:
                   typeof result === "string"
                     ? result
                     : (result as { error?: string })?.error || "Done",
                 metadata: toToolMetadata(event.name, result),
               };
   ```

   `useChatStreaming.ts:453` already copies `chunk.metadata` onto the tool call, and persistence already round-trips tool calls.

4. In `src/components/chat/types.ts`, add:

   ```ts
   import type { Locality } from "../../lib/locality";
   import type { RagNoteRef } from "./citations";

   export interface MessageRoute {
     model: string | null;
     providerId: string | null;
     locality: Locality;
   }
   ```

   Add `context?: { ragNotes?: RagNoteRef[]; pinnedNotes?: RagNoteRef[]; route?: MessageRoute | null };` to `Message`.

5. In `src/config/prompts/index.ts`, after `appendDictionarySuffix`, add:

   ```ts
   // Model-facing and English on purpose: the renderer parses these markers.
   // A suffix, not a base-prompt edit, so retiredPrompts' hash ratchet is unaffected.
   const CITATION_SUFFIX =
     "\n\nWhen a sentence relies on one of the user's notes or meetings, cite it right after that sentence as [note:ID], using the id from the search result or the <note id=\"…\"> tag. Cite only notes you were given in this conversation. Never invent an id.";

   export function appendCitationSuffix(prompt: string): string {
     return prompt + CITATION_SUFFIX;
   }
   ```

   Add `appendCitationSuffix,` to the re-export list in `src/config/prompts.ts:3-9`.

6. In `src/components/chat/useChatStreaming.ts`:
   - Delete `buildRAGContext` (`:36-60`) and its constants. Import `buildRagContext` from `./ragContext`, and `appendCitationSuffix` from `../../config/prompts`.
   - Add `citations?: boolean;` to the hook's options (next to `onStreamComplete`, `:79`) and destructure it with a default of `false`. `useChatStreaming` is shared with `AssistantPanel.tsx`, `useEmbeddedChat.ts`, `useContainerChat.ts` and `useOnboardingAssistantDemo.ts`; none of them pass it.
   - `:293`:

     ```ts
     const rag = await buildRagContext(window.electronAPI, userText, scope);
     const ragContext = rag.text;
     ```

   - After the `systemPrompt` assignment (`:298-305`), add:

     ```ts
     // Only the Chat view renders citations. AssistantPanel, embedded and
     // container chats keep the bubble renderer, which would show raw markers.
     const hasSources = (registry?.getAll().length ?? 0) > 0 || ragContext.length > 0;
     if (citations && hasSources) systemPrompt = appendCitationSuffix(systemPrompt);
     ```

   - The assistant message creation (`:346`) becomes `{ id: assistantId, role: "assistant", content: "", isStreaming: true, context: { ragNotes: rag.notes, route: null } }`.
   - `onStreamComplete`: change its type (`:79`) to `(assistantId: string, content: string, toolCalls?: ToolCallInfo[], context?: Message["context"]) => void`. Pass `finalMsg?.context` as the fourth argument at both call sites (`:481`, `:505`).

7. In `src/components/chat/useChatPersistence.ts`:
   - `saveAssistantMessage(content, toolCalls?, context?)` sends metadata `toolCalls?.length || context ? { ...(toolCalls?.length ? { toolCalls } : {}), ...(context ? { context } : {}) } : undefined`.
   - In `loadConversation` (`:68-77`), also read `parsed?.context` onto the loaded message.
   - Update the interface at `:21`.

8. In `src/components/chat/ChatView.tsx:48-54`, pass `citations: true` into `useChatStreaming({ … })`, and change `onStreamComplete` to `(_id, content, toolCalls, context) => { persistence.saveAssistantMessage(content, toolCalls, context); }`.

9. Update `docs/PRIVACY.md`, in the section on what is stored locally. Add one sentence: chat history now also stores, on this device, the titles of the notes an answer used and a short excerpt (up to 240 characters) of each, so the Sources row can be shown later. Nothing new leaves the device.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/chatCitations.test.js test/components/ragContext.test.js test/config/citationSuffix.test.js test/helpers/noteCards.test.js test/helpers/useChatStreamingFlush.test.js test/helpers/useChatStreamingCancellation.test.js test/helpers/retiredPrompts.test.js test/services/reasoningServiceStreamingThink.test.js && npm run typecheck`
Expected: PASS. The prompt-hash ratchet is unchanged.

- [ ] **Step 5: Commit**

```bash
git add docs/PRIVACY.md src/components/chat/citations.ts src/components/chat/ragContext.ts src/components/chat/types.ts src/components/chat/useChatStreaming.ts src/components/chat/useChatPersistence.ts src/components/chat/ChatView.tsx src/services/ReasoningService.ts src/config/prompts/index.ts src/config/prompts.ts test/components/chatCitations.test.js test/components/ragContext.test.js test/config/citationSuffix.test.js
git commit -m "feat(chat): carry note sources from tools and RAG, and ask the model to cite them"
```

---

### Task 20: Chat document-style answers, citations and Sources row

This covers WS-R8 B (layout, citations, Sources row, thinking dots), WS-25, WS-26 and Review Focus 2.

**Files:**
- Create: `src/components/chat/remarkCitations.ts`, `src/components/chat/SourcesRow.tsx`
- Modify: `src/components/ui/MarkdownRenderer.tsx`. Add the props `remarkPlugins` and `components`, a `urlTransform`, and workspace-link handling in `a` (`:41-56`).
- Modify:
  - `src/components/chat/ChatMessage.tsx`: the `variant` prop; a document branch beside the bubble branch (`:185-284`);
  - `src/components/chat/ChatMessages.tsx`: the `variant` prop and gap;
  - `src/components/chat/ChatView.tsx:165`: `variant="document"`.
- Modify: `src/index.css`. Add the `.thinking-dots` and `.citation-in` rules.
- Test: `test/components/remarkCitations.test.js`, `test/components/markdownRendererWorkspaceLinks.test.js`, `test/components/chatMessageDocument.test.js`, `test/components/sourcesRow.test.js`

**Interfaces:**
- Consumes `collectSources`, `numberCitations` and `CitationSource` (Task 19); `parseMentionHref` (Task 17); `sanitizeLinkHref` (Task 16); and `useWorkspaceNavigation` (Task 3).
- Produces:
  - `transformCitations(tree: MdastRoot, numbers: Map<number, number>): void` and `remarkCitations(options: { numbers: Map<number, number> }): (tree) => void`. Known markers become `sup` elements with `data-citation`. Unknown markers are removed.
  - `MarkdownRenderer` props `remarkPlugins?: PluggableList` and `components?: Partial<Components>`. Workspace hrefs render as in-app buttons. Hrefs that `sanitizeLinkHref` rejects render as plain text.
  - `SourcesRow({ sources: CitationSource[] })`.
  - `ChatMessage` prop `variant?: "bubble" | "document"` (default `"bubble"`, so `EmbeddedChat`, the overview and `AssistantPanel` are unchanged), plus `context?: Message["context"]`.
  - `ChatMessages` prop `variant?: "bubble" | "document"`.

- [ ] **Step 1: Write the failing tests**

Create `test/components/remarkCitations.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/chat/remarkCitations.ts");
const paragraph = (value) => ({ type: "root", children: [{ type: "paragraph", children: [{ type: "text", value }] }] });

test("known markers become numbered superscripts; unknown markers vanish", async () => {
  const { transformCitations } = await load();
  const tree = paragraph("Thursday, not Monday [note:38]. Invented [note:999].");
  transformCitations(tree, new Map([[38, 1]]));
  const children = tree.children[0].children;
  assert.deepEqual(children.map((c) => c.type), ["text", "citation", "text"]);
  assert.equal(children[0].value, "Thursday, not Monday ");
  assert.equal(children[1].data.hName, "sup");
  assert.equal(children[1].data.hProperties.dataCitation, 1);
  assert.equal(children[1].children[0].value, "1");
  assert.equal(children[2].value, ". Invented .");
});

test("markers inside code stay literal", async () => {
  const { transformCitations } = await load();
  const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "inlineCode", value: "[note:38]" }] }] };
  transformCitations(tree, new Map([[38, 1]]));
  assert.equal(tree.children[0].children[0].value, "[note:38]");
});
```

Create `test/components/markdownRendererWorkspaceLinks.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function render(t, content) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-markdown-workspace-links-" });
  const mod = await vite.ssrLoadModule("/components/ui/MarkdownRenderer.tsx");
  return renderToStaticMarkup(createElement(mod.default, { content }));
}

test("workspace mentions open inside Loqui, never in the browser", async (t) => {
  const html = await render(t, "See [@Design sync](meeting:42) and [@Roadmap](note:17).");
  assert.match(html, /<button[^>]*data-mention-kind="meeting"[^>]*>@Design sync<\/button>/);
  assert.match(html, /<button[^>]*data-mention-kind="note"[^>]*>@Roadmap<\/button>/);
  assert.doesNotMatch(html, /href="(meeting|note):/);
  assert.doesNotMatch(html, /target="_blank"[^>]*>@/);
});

test("web links still open externally; script and file links are inert text", async (t) => {
  const html = await render(t, "[site](https://loqui.app) [x](javascript:alert(1)) [f](file:///etc/passwd)");
  assert.match(html, /<a[^>]*href="https:\/\/loqui\.app"[^>]*target="_blank"/);
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /href="file:/);
  assert.match(html, />x</);
});
```

Create `test/components/chatMessageDocument.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function render(t, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-chat-document-" });
  const mod = await vite.ssrLoadModule("/components/chat/ChatMessage.tsx");
  return renderToStaticMarkup(createElement(mod.ChatMessage, { variant: "document", isStreaming: false, ...props }));
}
const search = {
  id: "t1",
  name: "search_notes",
  arguments: '{"query":"pricing"}',
  status: "completed",
  result: 'Found 2 notes for "pricing"',
  metadata: [
    { id: 38, title: "Pricing review", date: "2026-10-09", type: "meeting", quote: "so Thursday, not Monday" },
    { id: 5, title: "Product catch-up", date: "2026-10-14", type: "personal", quote: "Maya owns FAQ copy" },
  ],
};

test("the user turn is a neutral raised surface, never orange", async (t) => {
  const html = await render(t, { role: "user", content: "What did we decide about pricing?" });
  assert.match(html, /data-variant="document"/);
  assert.match(html, /bg-surface-3/);
  assert.doesNotMatch(html, /bg-primary/);
});

test("answers are unbubbled prose at 68ch with numbered citations and a Sources row", async (t) => {
  const html = await render(t, {
    role: "assistant",
    content: "Thursday, not Monday [note:38]. Maya owns the FAQ [note:5].",
    toolCalls: [search],
  });
  assert.match(html, /max-w-\[68ch\]/);
  assert.doesNotMatch(html, /data-chat-bubble/);
  assert.match(html, /<sup[^>]*data-citation="1"/);
  assert.match(html, /<sup[^>]*data-citation="2"/);
  assert.match(html, /data-sources/);
  assert.match(html, /agentMode\.tools\.summary/);
});

test("the streaming turn carries the Agent rail; a finished one does not", async (t) => {
  const streaming = await render(t, { role: "assistant", content: "Thurs", isStreaming: true });
  assert.match(streaming, /border-agent/);
  const done = await render(t, { role: "assistant", content: "Thursday." });
  assert.doesNotMatch(done, /border-agent/);
});

test("thinking is three dots with a text twin", async (t) => {
  const html = await render(t, { role: "assistant", content: "", isStreaming: true });
  assert.match(html, /class="thinking-dots"/);
  assert.match(html, /agentMode\.input\.thinking/);
});
```

Create `test/components/sourcesRow.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

test("sources are 28px chips with numeral, kind and title; uncited ones have no numeral", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-sources-row-" });
  const { SourcesRow } = await vite.ssrLoadModule("/components/chat/SourcesRow.tsx");
  const html = renderToStaticMarkup(
    createElement(SourcesRow, {
      sources: [
        { n: 1, noteId: 38, title: "Pricing review", kind: "meeting", date: "2026-10-09", quote: "so Thursday, not Monday" },
        { n: null, noteId: 5, title: "Product catch-up", kind: "note", date: null, quote: "" },
      ],
    })
  );
  assert.match(html, /data-sources/);
  assert.match(html, /h-7/);
  assert.match(html, /text-agent-text[^>]*>1</);
  assert.match(html, /data-kind="meeting"[\s\S]*Pricing review/);
  assert.doesNotMatch(html, /text-agent-text[^>]*>(null|undefined)</);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/remarkCitations.test.js test/components/markdownRendererWorkspaceLinks.test.js test/components/chatMessageDocument.test.js test/components/sourcesRow.test.js`
Expected: FAIL.
- Modules are missing.
- `meeting:42` renders as an `<a>` with an empty href, because react-markdown's default `urlTransform` blanks unknown schemes.
- There is no `data-variant`.

- [ ] **Step 3: Implement**

1. Create `src/components/chat/remarkCitations.ts`:

   ```ts
   type Node = { type: string; value?: string; children?: Node[]; data?: Record<string, unknown> };
   const MARKER = /\[note:(\d+)\]/g;
   const SKIP = new Set(["code", "inlineCode", "link", "linkReference"]);

   // Turns the model's [note:ID] markers into numbered superscripts. Ids the
   // renderer never received are dropped rather than shown as raw markers.
   export function transformCitations(tree: Node, numbers: Map<number, number>): void {
     const walk = (node: Node) => {
       if (!node.children || SKIP.has(node.type)) return;
       const next: Node[] = [];
       // Adjacent text merges, so a dropped marker leaves one clean text node.
       const pushText = (value: string) => {
         const last = next.at(-1);
         if (last?.type === "text") last.value = (last.value ?? "") + value;
         else next.push({ type: "text", value });
       };
       for (const child of node.children) {
         if (child.type !== "text" || !child.value?.includes("[note:")) {
           walk(child);
           next.push(child);
           continue;
         }
         let cursor = 0;
         for (const match of child.value.matchAll(MARKER)) {
           const before = child.value.slice(cursor, match.index);
           if (before) pushText(before);
           const n = numbers.get(Number(match[1]));
           if (n != null) {
             next.push({
               type: "citation",
               data: { hName: "sup", hProperties: { dataCitation: n } },
               children: [{ type: "text", value: String(n) }],
             });
           }
           cursor = (match.index ?? 0) + match[0].length;
         }
         const rest = child.value.slice(cursor);
         if (rest) pushText(rest);
       }
       node.children = next;
     };
     walk(tree);
   }

   export function remarkCitations(options: { numbers: Map<number, number> }) {
     return (tree: Node) => transformCitations(tree, options.numbers);
   }
   ```

   `dataCitation` is the hast (camelCase) property name. React receives it as `data-citation`, which is what `CitationSup` reads.

2. In `src/components/ui/MarkdownRenderer.tsx`:
   - Props: add `remarkPlugins?: PluggableList; components?: Partial<Components>;`.
   - Pass `remarkPlugins={[remarkGfm, ...(remarkPlugins ?? [])]}`, `components={components ? { ...markdownComponents, ...components } : markdownComponents}`, and `urlTransform={(url) => (parseMentionHref(url) ? url : defaultUrlTransform(url))}`. Import `defaultUrlTransform` from `react-markdown`.
   - Replace the `a` component (`:41-56`) with:

     ```tsx
     a: function MarkdownLink({ node: _node, href, children, ...props }): ReactElement {
       const prefix = useContext(FootnotePrefixContext);
       const navigation = useWorkspaceNavigation();
       const mention = parseMentionHref(href);
       if (mention && mention.kind !== "person" && mention.entityId) {
         const id = Number(mention.entityId);
         const open = () => {
           if (mention.kind === "note" || mention.kind === "meeting") navigation.openNote(id);
           else if (mention.kind === "dictation") navigation.openTranscript(id);
           else navigation.openView("personal-notes");
         };
         return (
           <button type="button" data-mention-kind={mention.kind} onClick={open} className="text-link underline decoration-link/30 hover:decoration-link/60">
             {children}
           </button>
         );
       }
       const isAnchor = href?.startsWith("#");
       // Validate with the note-link allow-list but keep the author's href as written.
       const safe = href && (isAnchor || sanitizeLinkHref(href)) ? href : null;
       if (!safe) return <span>{children}</span>;
       return (
         <a
           {...props}
           href={safe}
           aria-describedby={props["aria-describedby"] === "footnote-label" ? `${prefix}footnote-label` : props["aria-describedby"]}
           target={isAnchor ? undefined : "_blank"}
           rel="noopener noreferrer"
           className="text-link underline decoration-link/30 hover:decoration-link/60 transition-colors"
         >
           {children}
         </a>
       );
     },
     ```

   - Imports: `parseMentionHref` from `../../utils/mentionMarkdown`, `sanitizeLinkHref` from `../../lib/linkHref`, `useWorkspaceNavigation` from `../workspaceNavigation`, and `type PluggableList` from `unified`. If `unified` is not resolvable from `src`, use `import type { Options } from "react-markdown"` and type the prop as `Options["remarkPlugins"]`.
   - Person mentions (`mention:`) render as plain text, so no email address becomes a link.
   - Keep `test/components/markdownRenderer.test.js` passing. Anchor (`#`) and `https:` behaviour is unchanged.

3. Create `src/components/chat/SourcesRow.tsx`:

   ```tsx
   import { useState } from "react";
   import { useTranslation } from "react-i18next";
   import { FileText, Users } from "lucide-react";
   import { useWorkspaceNavigation } from "../workspaceNavigation";
   import type { CitationSource } from "./citations";

   export function SourcesRow({ sources }: { sources: CitationSource[] }) {
     const { t } = useTranslation();
     const navigation = useWorkspaceNavigation();
     const [hovered, setHovered] = useState<number | null>(null);
     if (sources.length === 0) return null;
     return (
       <div data-sources className="mt-3 flex flex-wrap items-center gap-1.5">
         <span className="text-caption text-muted-foreground">{t("chat.sources.label")}</span>
         {sources.map((source) => {
           const Icon = source.kind === "meeting" ? Users : FileText;
           return (
             <span key={source.noteId} className="citation-in relative" onMouseEnter={() => setHovered(source.noteId)} onMouseLeave={() => setHovered(null)}>
               <button
                 type="button"
                 data-kind={source.kind}
                 onClick={() => navigation.openNote(source.noteId)}
                 onFocus={() => setHovered(source.noteId)}
                 onBlur={() => setHovered(null)}
                 className="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-full border border-border px-2.5 text-caption font-semibold text-foreground hover:bg-foreground/5 dark:border-white/10"
               >
                 {source.n != null && <span className="text-agent-text">{source.n}</span>}
                 <Icon size={12} aria-hidden className="shrink-0 text-muted-foreground" />
                 <span dir="auto" className="truncate">{source.title || t("notes.list.untitledNote")}</span>
               </button>
               {hovered === source.noteId && source.quote && (
                 <span role="tooltip" className="absolute bottom-full start-0 z-40 mb-1 w-80 rounded-lg border border-border bg-popover p-3 shadow-lg">
                   <span className="block truncate text-ui font-semibold text-foreground">{source.title}</span>
                   <span className="block text-caption text-muted-foreground">
                     {t(source.kind === "meeting" ? "chat.sources.meeting" : "chat.sources.note")}
                     {source.date ? ` · ${source.date.slice(0, 10)}` : ""}
                   </span>
                   <span dir="auto" className="mt-2 block line-clamp-2 border-s-2 border-agent ps-2 text-caption text-foreground">{source.quote}</span>
                 </span>
               )}
             </span>
           );
         })}
       </div>
     );
   }
   ```

4. In `src/components/chat/ChatMessage.tsx`:
   - Props: add `variant?: "bubble" | "document"; context?: Message["context"];`. Default `variant = "bubble"`.
   - Add the document user branch before the existing `role === "user"` branch:

     ```tsx
     if (variant === "document" && role === "user") {
       return (
         <div data-variant="document" className="flex justify-end">
           <div className="max-w-[80%] rounded-xl bg-surface-3 px-3.5 py-2.5 text-ui text-foreground">
             <span dir="auto">{content}</span>
           </div>
         </div>
       );
     }
     ```

   - Add the document assistant branch before the bubble return:

     ```tsx
     if (variant === "document") {
       // Everything the model was given is citable: RAG notes and pinned notes (I12).
       const candidates = collectSources(toolCalls, [...(context?.ragNotes ?? []), ...(context?.pinnedNotes ?? [])]);
       const { numbers, sources } = numberCitations(content, candidates);
       return (
         <div
           data-variant="document"
           className={cn("group/msg border-s-2 ps-4", isStreaming ? "border-agent" : "border-transparent")}
         >
           <div className="mb-1.5 flex items-center gap-2 text-caption text-muted-foreground">
             <span aria-hidden className="flex size-[18px] items-center justify-center rounded-md bg-agent/20 text-agent-text">
               <Sparkles size={11} />
             </span>
             <span className="text-ui font-medium text-foreground">{t("chat.assistant")}</span>
             {/* Task 21 renders the route tag here */}
           </div>
           {hasToolCalls && <ToolActivityDisclosure toolCalls={toolCalls} />}
           {hasContent && (
             <MarkdownRenderer
               content={content}
               remarkPlugins={[[remarkCitations, { numbers }]]}
               components={{ sup: CitationSup }}
               className="max-w-[68ch] text-body leading-[1.6] [&_strong]:font-[650]"
             />
           )}
           {isStreaming && hasContent && (
             <span className="inline-block h-[15px] w-[2px] align-middle bg-foreground/70" style={{ animation: "agent-cursor-blink 1s ease-in-out infinite" }} />
           )}
           {isStreaming && !hasContent && !hasToolCalls && (
             <span className="flex items-center gap-2 text-ui text-muted-foreground">
               <span className="thinking-dots" aria-hidden><i /><i /><i /></span>
               <span>{t("agentMode.input.thinking")}</span>
             </span>
           )}
           <SourcesRow sources={sources} />
           {/* keep the existing copy button block (:267-281) here unchanged */}
         </div>
       );
     }
     ```

   - Helpers in the same file:

     ```tsx
     function CitationSup({ node: _node, children, ...props }: React.ComponentProps<"sup"> & { node?: unknown; "data-citation"?: number }) {
       if (props["data-citation"] == null) return <sup {...props}>{children}</sup>;
       return <sup {...props} className="citation-in ms-0.5 text-micro font-bold text-agent-text">{children}</sup>;
     }

     // One line instead of a stack of 11px steps: "Searched 4 notes". The
     // per-step detail lives in the context rail (Task 22) and on expand.
     function ToolActivityDisclosure({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
       const { t } = useTranslation();
       const [open, setOpen] = useState(false);
       const notes = toolCalls.reduce((sum, tc) => sum + (Array.isArray(tc.metadata) ? tc.metadata.length : tc.metadata ? 1 : 0), 0);
       const running = toolCalls.some((tc) => tc.status === "executing");
       return (
         <div className="mb-2">
           <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="text-caption text-muted-foreground hover:text-foreground">
             {running ? t(`agentMode.tools.${toolCalls.at(-1)!.name}Status`) : t("agentMode.tools.summary", { count: notes })}
           </button>
           {open && <div className="mt-1">{toolCalls.map((tc) => <ToolCallStep key={tc.id} toolCall={tc} />)}</div>}
         </div>
       );
     }
     ```

   - Imports: `Sparkles`, `collectSources`, `numberCitations`, `remarkCitations`, `SourcesRow`, `useState`.
   - The bubble branch is untouched, so `EmbeddedChat`, `OverviewAskSection` and `AssistantPanel` keep their look.

5. In `src/components/chat/ChatMessages.tsx`:
   - Add `variant?: "bubble" | "document"` to the props (default `"bubble"`).
   - The column class becomes `cn("flex flex-col", variant === "document" ? "gap-6" : "gap-1.5", contentClassName)`.
   - Pass `variant={variant}` and `context={msg.context}` to `<ChatMessage>`.

6. In `src/components/chat/ChatView.tsx:165`, add `variant="document"` to `<ChatMessages …>`.

7. In `src/index.css`, after the `.bubble-toolbar` rules, add:

   ```css
   /* WS-R8 B: thinking is three dots; reduced motion keeps the word beside them. */
   .thinking-dots { display: inline-flex; gap: 3px; }
   .thinking-dots i {
     width: 5px; height: 5px; border-radius: 9999px; background: currentColor; opacity: 0.35;
     animation: thinking-dot 1.2s var(--motion-ease-std) infinite;
   }
   .thinking-dots i:nth-child(2) { animation-delay: 0.15s; }
   .thinking-dots i:nth-child(3) { animation-delay: 0.3s; }
   @keyframes thinking-dot { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
   /* Each citation and source fades in as its tool result lands. */
   .citation-in { animation: citation-in var(--motion-fast) var(--motion-ease-enter) both; }
   @keyframes citation-in { from { opacity: 0; } to { opacity: 1; } }
   @media (prefers-reduced-motion: reduce) {
     .thinking-dots i { animation: none; opacity: 0.7; }
     .citation-in { animation: none; }
   }
   ```

8. In `DESIGN.md` under `## Components`, add a `### Chat` subsection after `### Navigation` (D10):

   ```markdown
   ### Chat
   The Chat view answers as a document. Assistant turns are unbubbled `text-body` prose at 1.6 line-height, capped at 68ch, 24px apart, under a 14px Agent spark. While a turn streams it carries a 2px `--color-agent` rail. User turns are a neutral `surface-3` block, never orange. Citations are superscript numerals in `--color-agent-text`, numbered by first appearance. A Sources row of 28px chips with a two-line quote on hover follows each answer. Above the composer, a read-only model chip shows the resolved chat model with its `LocalityRing` and the word Local, Your server or the provider. Embedded and assistant-panel chats keep the bubble style.
   ```

9. Add strings (Task 1 helper). English block:

   ```json
   {
     "chat": {
       "assistant": "Assistant",
       "sources": { "label": "Sources", "note": "Note", "meeting": "Meeting" }
     },
     "agentMode": {
       "tools": {
         "summary_one": "Searched {{count}} note",
         "summary_other": "Searched {{count}} notes"
       }
     }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/remarkCitations.test.js test/components/markdownRendererWorkspaceLinks.test.js test/components/chatMessageDocument.test.js test/components/sourcesRow.test.js test/components/markdownRenderer.test.js test/components/floatingChatLayout.test.js test/locales/translationCoverage.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add DESIGN.md src/components/chat src/components/ui/MarkdownRenderer.tsx src/index.css src/locales test/components/remarkCitations.test.js test/components/markdownRendererWorkspaceLinks.test.js test/components/chatMessageDocument.test.js test/components/sourcesRow.test.js
git commit -m "feat(chat): answer as a document with citations and a Sources row"
```

---

### Task 21: Chat model chip and per-answer route stamp

This covers WS-Q6, WS-R8 B ("the chat shows the resolved model with `LocalityRing`") and WS-07, and consumes §5.1.

**Files:**
- Create: `src/components/chat/ChatModelChip.tsx`
- Create: `src/components/chat/messageRoute.ts` (`toMessageRoute`, shared by the chip and the stream).
- Modify: `src/components/chat/useChatStreaming.ts`. Resolve the chat route from the **same settings snapshot** that builds the request (`:233`), and stamp it at `:346` (review I11).
- Modify: `src/components/chat/ChatView.tsx`. Add the chip row above `ChatInput` (`:172`).
- Modify: `test/helpers/useChatStreamingCancellation.test.js`. Add a deferred-context route-stamp test.
- Modify: `src/components/chat/ChatMessage.tsx`. Add the route tag in the document header.
- Test: `test/components/chatModelChip.test.js`, `test/helpers/useChatStreamingCancellation.test.js`

**Interfaces:**
- Consumes `useResolvedRoute("chat")`, `routeSnapshotFromSettings`, `resolveRoute` and `ResolvedRoute` (§5.1); `RouteDestinationChip` and `RouteStateChip` (§5.1, Plan 03's published chips: a surface that discloses a route uses them and builds no chip of its own); `MessageRoute` (Task 19); and the `onOpenSettings` prop on `ChatView` (Task 4), which receives `route.settingsPath` (§5.1).
- Produces:

  ```ts
  export interface ChatModelChipProps {
    route: Pick<ResolvedRoute, "locality" | "providerId" | "model" | "state" | "settingsPath">;
    onOpenSettings: (settingsPath: string) => void;
  }
  export function ChatModelChip(props: ChatModelChipProps): JSX.Element;
  export function RouteTag(props: { route: MessageRoute }): JSX.Element; // "On this device · Qwen3.5 2B" on an answer
  export function toMessageRoute(route: Pick<ResolvedRoute, "locality" | "providerId" | "model">): MessageRoute;
  ```

- Every new assistant message records `context.route`. It is computed inside `sendToAI` from the `settings` object that `resolveChatStreamingInference` also reads (`:233-238`), via `resolveRoute(routeSnapshotFromSettings(settings), "chat")` (§5.1). `routeSnapshotFromSettings` reads the current facts, the sealed store and i18n, and subscribes to nothing and calls no IPC, so it is safe inside `sendToAI`. Plan 06 never passes `sealed` itself.
  - The stamp and the dispatched request can never disagree, even when Settings change while context is loading.
  - A later settings change never rewrites history.
  - There is no `getRoute` option. Sampling the UI hook after the asynchronous lookups was the I11 bug.

- [ ] **Step 1: Write the failing tests**

Create `test/components/chatModelChip.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { renderStatic } = require("../helpers/harness/reactSsr");

async function load() {
  if (!i18next.isInitialized) {
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8"));
    await i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  }
  return import("../../src/components/chat/ChatModelChip.tsx");
}
const route = (over = {}) => ({ locality: "device", providerId: null, model: "Qwen3.5 2B", state: { status: "ready" }, settingsPath: "llms/chat", ...over });

test("the chip discloses the route with Plan 03's destination chip", async () => {
  const { ChatModelChip } = await load();
  const local = renderStatic(ChatModelChip, { route: route(), onOpenSettings: () => {} });
  assert.match(local, /data-locality="device"/);
  assert.match(local, /On this device · Qwen3\.5 2B/);
  assert.doesNotMatch(local, /data-state=/, "a ready route adds no state chip");
  const lan = renderStatic(ChatModelChip, { route: route({ locality: "network", model: "Llama 3.1 8B" }), onOpenSettings: () => {} });
  assert.match(lan, /On your server · Llama 3\.1 8B/);
  const remote = renderStatic(ChatModelChip, { route: route({ locality: "remote", providerId: "openai", model: "GPT-5.6" }), onOpenSettings: () => {} });
  assert.match(remote, /data-locality="remote"/);
  assert.match(remote, /OpenAI · GPT-5\.6/);
  assert.match(remote, /class="sr-only">Change in Settings</);
});

test("custom and unknown providers get localised names (providerDisplayLabel), never raw ids", async () => {
  const { ChatModelChip } = await load();
  const custom = renderStatic(ChatModelChip, { route: route({ locality: "remote", providerId: "custom", model: "llama-3" }), onOpenSettings: () => {} });
  assert.match(custom, /Custom endpoint · llama-3/);
  const unknown = renderStatic(ChatModelChip, { route: route({ locality: "remote", providerId: "acme", model: "m" }), onOpenSettings: () => {} });
  assert.match(unknown, /Unknown provider · m/);
  assert.doesNotMatch(unknown, /acme/);
});

test("a route that cannot answer adds Plan 03's state chip; unknown is neutral, never ready", async () => {
  const { ChatModelChip } = await load();
  const needsKey = renderStatic(ChatModelChip, { route: route({ state: { status: "needsKey", provider: "openai" }, locality: "remote", providerId: "openai" }), onOpenSettings: () => {} });
  assert.match(needsKey, /data-state="needsKey"/);
  const unknown = renderStatic(ChatModelChip, { route: route({ state: { status: "unknown" } }), onOpenSettings: () => {} });
  assert.match(unknown, /data-state="unknown"/);
  assert.doesNotMatch(unknown, /data-state="ready"|text-destructive/);
});

test("the chip opens Settings at the route's own path", async () => {
  const { ChatModelChip } = await load();
  assert.match(renderStatic(ChatModelChip, { route: route(), onOpenSettings: () => {} }), /data-settings-path="llms\/chat"/);
});

test("an answer is tagged with where it was produced", async () => {
  const { RouteTag } = await load();
  const html = renderStatic(RouteTag, { route: { model: "Qwen3.5 2B", providerId: null, locality: "device" } });
  assert.match(html, /data-locality="device"/);
  assert.match(html, /On this device · Qwen3\.5 2B/);
});
```

Append to `test/helpers/useChatStreamingCancellation.test.js`. These tests extend `test/helpers/useChatStreamingCancellation.test.js`, which drives the **real** hook. Make two small changes to its `renderChatStreaming` helper first:
- accept `hookOptions = {}` and spread it into the `useChatStreaming({ … })` call in `Harness`;
- return `useSettingsStore` alongside `captured`.

The existing tests pass `hookOptions` implicitly as `{}` and are unchanged.

```js
test("the route stamp is the route the request used, even if Settings change while context loads (I11)", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requested = [];
  globalThis.fetch = async (input) => {
    requested.push(String(input?.url ?? input));
    const content = `data: ${JSON.stringify(createOpenAiChunk({ content: "ok" }))}\n\n`;
    const finish = `data: ${JSON.stringify(createOpenAiChunk({}, "stop"))}\n\n`;
    return new Response(`${content}${finish}data: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  let resolveSearch;
  let searchStarted = false;
  const { captured, getMessages, useSettingsStore } = await renderChatStreaming(t, {
    electronAPI: {
      semanticSearchNotes: () => {
        searchStarted = true;
        return new Promise((resolve) => (resolveSearch = resolve));
      },
    },
  });
  const send = captured.sendToAI("hello", []);
  for (let i = 0; i < 50 && !searchStarted; i++) await new Promise((r) => setImmediate(r));
  // The user switches chat to a remote provider while the RAG lookup is pending.
  useSettingsStore.setState({ chatAgentMode: "providers", chatAgentProvider: "openai", chatAgentModel: "gpt-5.6" });
  resolveSearch([]);
  await send;

  assert.ok(requested.length > 0 && requested.every((url) => url.includes("127.0.0.1")), "the request went to the loopback server");
  const answer = getMessages().find((m) => m.role === "assistant");
  assert.equal(answer.context.route.locality, "device");
  assert.equal(answer.context.route.providerId, null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/chatModelChip.test.js test/helpers/useChatStreamingCancellation.test.js`
Expected: FAIL. The module is missing, and the regex does not match because Task 19 left `route: null`.

- [ ] **Step 3: Implement**

1. Create `src/components/chat/ChatModelChip.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { RouteDestinationChip, RouteStateChip } from "../settings/routing/RouteChips";
   import type { ResolvedRoute } from "../../lib/routes";
   import type { MessageRoute } from "./types";

   export interface ChatModelChipProps {
     route: Pick<ResolvedRoute, "locality" | "providerId" | "model" | "state" | "settingsPath">;
     onOpenSettings: (settingsPath: string) => void;
   }

   export { toMessageRoute } from "./messageRoute";

   // WS-Q6 + R8 B: read-only. Where the next message goes, disclosed with Plan
   // 03's chips (§5.1); changing it happens in Settings, never silently here.
   // A route that is not ready adds the state chip. `unknown` reads "Checking…"
   // and is never shown as ready.
   export function ChatModelChip({ route, onOpenSettings }: ChatModelChipProps) {
     const { t } = useTranslation();
     return (
       <button
         type="button"
         data-settings-path={route.settingsPath}
         onClick={() => onOpenSettings(route.settingsPath)}
         className="inline-flex h-7 max-w-80 items-center gap-1.5 rounded-full border border-border px-2.5 hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/10"
       >
         <RouteDestinationChip route={route} className="h-auto min-w-0 text-caption" />
         {route.state.status !== "ready" && <RouteStateChip state={route.state} className="h-auto px-0 text-caption" />}
         <span className="sr-only">{t("chat.model.changeHint")}</span>
       </button>
     );
   }

   export function RouteTag({ route }: { route: MessageRoute }) {
     return <RouteDestinationChip route={route} className="h-5 text-caption text-muted-foreground" />;
   }
   ```

   `MessageRoute` is `{ model, providerId, locality }`, which is exactly the destination chip's `Pick`, so a stored stamp renders through the same chip as the live route.

2. Create `src/components/chat/messageRoute.ts`, and move `toMessageRoute` there from `ChatModelChip.tsx`. `ChatModelChip.tsx` re-exports it:

   ```ts
   import type { ResolvedRoute } from "../../lib/routes";
   import type { MessageRoute } from "./types";

   export const toMessageRoute = (route: Pick<ResolvedRoute, "locality" | "providerId" | "model">): MessageRoute => ({
     model: route.model,
     providerId: route.providerId,
     locality: route.locality,
   });
   ```

   In `src/components/chat/useChatStreaming.ts`, directly after `resolveChatStreamingInference(settings, …)` (`:233-238`), add:

   ```ts
   // The stamp comes from the same settings snapshot as the request, so an
   // answer can never say Local for a request that went to OpenAI (I11).
   const sentRoute = toMessageRoute(resolveRoute(routeSnapshotFromSettings(settings), "chat"));
   ```

   Import `resolveRoute` and `routeSnapshotFromSettings` from `../../lib/routes` (§5.1). Do not call `buildRouteSnapshot` here: its fourth argument is `sealed`, which only `routeSnapshotFromSettings` reads, from `src/stores/sealedStore.ts` (§5.4). Then change the assistant message creation (`:346`) from Task 19's `context: { ragNotes: rag.notes, route: null }` to `context: { ragNotes: rag.notes, route: sentRoute }`.

3. In `src/components/chat/ChatView.tsx`:

   ```ts
   const chatRoute = useResolvedRoute("chat");
   ```

   This is only the chip's "next message" display. Inside the `px-3 pb-3 pt-1` wrapper, before `<ChatInput>` (`:172`), render:

   ```tsx
   <div className={cn(PAGE_CONTENT_WIDTH_CLASS, "flex flex-wrap items-center gap-2 pb-1.5")}>
     <ChatModelChip route={chatRoute} onOpenSettings={(path) => onOpenSettings?.(path)} />
     {/* Task 22 adds the context chips and the rail toggle here */}
   </div>
   ```

4. In `ChatMessage.tsx`'s document header, replace the Task 20 placeholder comment with `{context?.route && <RouteTag route={context.route} />}`.

5. Add strings (Task 1 helper). English block:

   ```json
   { "chat": { "model": { "changeHint": "Change in Settings" } } }
   ```

   Place, model and state words come from Plan 03's chips (`locality.*`, `routes.place.*`, `routes.state.*`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/chatModelChip.test.js test/helpers/useChatStreamingCancellation.test.js test/components/chatMessageDocument.test.js test/locales/translationCoverage.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ChatModelChip.tsx src/components/chat/messageRoute.ts src/components/chat/useChatStreaming.ts src/components/chat/ChatView.tsx src/components/chat/ChatMessage.tsx src/locales test/components/chatModelChip.test.js test/helpers/useChatStreamingCancellation.test.js
git commit -m "feat(chat): show the resolved model and where each answer was produced"
```

---

### Task 22: Chat context rail and pinned context

This covers the WS-R8 B context rail (`⌘.`), WS-R7 B ("in chat, `@` adds the entity to the context chips") and interpretation 8.

**Files:**
- Create: `src/components/chat/contextRail.ts`, `src/components/chat/ChatContextRail.tsx`, `src/hooks/useMentionSources.ts` (Task 18's source builder, extracted from `RichTextEditor.tsx` so the composer shares it)
- Modify: `src/components/chat/ChatView.tsx`. Add pinned state, the rail as a third flex child after `:187`, the `⌘.` key, context chips in the chip row, and the `@` popover.
- Modify: `src/components/chat/ChatInput.tsx`. Add the props `onDraftChange` and `interceptKeyDown`.
- Modify: `src/components/chat/useChatStreaming.ts`:
  - add the hook option `getPinnedContext`, included in `combinedContext` (`:295`);
  - recheck cancellation after the lookup (review I02);
  - record `pinnedNotes` (review I12).
- Modify: `src/components/chat/ChatMessage.tsx`. Pinned notes are citable; Task 20's `collectSources` call already merges `context.pinnedNotes`.
- Modify: `test/helpers/useChatStreamingCancellation.test.js`. Add deferred pinned-context tests.
- Test: `test/components/contextRail.test.js`, `test/components/chatContextRail.test.js`, `test/components/chatComposerMention.test.js`, `test/helpers/useChatStreamingCancellation.test.js`

**Interfaces:**
- Consumes `searchMentionEntities` and `MentionResult` (Task 18), `MentionSuggestions` (Task 18), `collectSources` (Task 19), the ChatInput `seed` (Task 4), and `useWorkspaceNavigation` (Task 3).
- Produces `contextRail.ts`:

  ```ts
  export interface PinnedContextItem { kind: "note" | "meeting" | "folder" | "dictation"; id: number; label: string }
  export interface RailModel {
    pinned: PinnedContextItem[];
    found: Array<{ noteId: number; title: string; kind: "note" | "meeting" }>;   // read-only
    activity: Array<{ key: string; toolName: string; status: "executing" | "completed" | "error"; label: string }>;
  }
  export function buildRailModel(messages: Message[], pinned: PinnedContextItem[], labelFor: (tc: ToolCallInfo) => string): RailModel;
  export function detectMentionQuery(text: string, caret: number): { start: number; query: string } | null;
  export function removeMentionQuery(text: string, match: { start: number; query: string }): string;
  export function pinnedFromMention(result: MentionResult): PinnedContextItem | null; // people are not context
  export async function buildPinnedContext(items: PinnedContextItem[], api: PinnedContextApi): Promise<{ text: string; notes: RagNoteRef[] }>;
  // notes: every pinned note, meeting and folder note that reached the prompt, so they are citable (I12)
  export const RAIL_STORAGE_KEY = "chat.contextRailOpen";
  ```

- `ChatInput` props: `onDraftChange?: (text: string, caret: number) => void` and `interceptKeyDown?: (event: React.KeyboardEvent) => boolean`. The second runs first, and returning `true` stops submit.
- `useChatStreaming({ …, getPinnedContext?: () => Promise<{ text: string; notes: RagNoteRef[] }> })`.
  - After the lookup resolves, the hook rechecks `cancelled() || !mountedRef.current` **before** it creates an assistant message or dispatches inference (review I02).
  - The notes are stored as `context.pinnedNotes`.
- `ChatInput`: while an IME composition is active (`nativeEvent.isComposing` or `keyCode === 229`), `handleKeyDown` returns before calling `interceptKeyDown`. The mention picker never steals a candidate commit (review I10).

- [ ] **Step 1: Write the failing tests**

Create `test/components/contextRail.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/chat/contextRail.ts");

test("@ at a word start opens the picker; an email address does not", async () => {
  const { detectMentionQuery } = await load();
  assert.deepEqual(detectMentionQuery("what about @pri", 15), { start: 11, query: "pri" });
  assert.deepEqual(detectMentionQuery("@", 1), { start: 0, query: "" });
  assert.equal(detectMentionQuery("mail maya@acme", 14), null);
  assert.equal(detectMentionQuery("what about @pri and more", 24), null);
  assert.equal(detectMentionQuery(`@${"x".repeat(27)}`, 28), null);
});

test("picking removes only the typed @query", async () => {
  const { removeMentionQuery } = await load();
  assert.equal(removeMentionQuery("compare @pri with last week", { start: 8, query: "pri" }), "compare with last week");
  assert.equal(removeMentionQuery("@pri", { start: 0, query: "pri" }), "");
});

test("people are not context; notes, meetings, folders and dictations are", async () => {
  const { pinnedFromMention } = await load();
  assert.equal(pinnedFromMention({ kind: "person", label: "Maya", entityId: null, email: "m@a", key: "p", meta: null }), null);
  assert.deepEqual(pinnedFromMention({ kind: "meeting", label: "Pricing review", entityId: "38", email: null, key: "m", meta: null }), {
    kind: "meeting",
    id: 38,
    label: "Pricing review",
  });
});

test("the rail lists what was found, apart from what you pinned, and every tool step in order", async () => {
  const { buildRailModel } = await load();
  const messages = [
    { id: "u", role: "user", content: "q", isStreaming: false },
    {
      id: "a",
      role: "assistant",
      content: "x",
      isStreaming: false,
      context: { ragNotes: [{ id: 17, title: "Pricing FAQ draft", type: "personal", date: null, quote: "" }] },
      toolCalls: [
        { id: "t1", name: "search_notes", arguments: "{}", status: "completed", result: "Found 2", metadata: [{ id: 38, title: "Pricing review", type: "meeting", date: null, quote: "" }, { id: 5, title: "Catch-up", type: "personal", date: null, quote: "" }] },
        { id: "t2", name: "get_note", arguments: "{}", status: "executing" },
      ],
    },
  ];
  const model = buildRailModel(messages, [{ kind: "note", id: 5, label: "Catch-up" }], (tc) => tc.result ?? `${tc.name}…`);
  assert.deepEqual(model.found.map((f) => [f.noteId, f.kind]), [[38, "meeting"], [17, "note"]]);
  assert.deepEqual(model.activity.map((a) => [a.toolName, a.status, a.label]), [["search_notes", "completed", "Found 2"], ["get_note", "executing", "get_note…"]]);
});

test("pinned context reaches the prompt; deleted items are skipped and long notes trimmed", async () => {
  const { buildPinnedContext } = await load();
  const api = {
    getNote: async (id) => (id === 38 ? { id: 38, title: "Pricing review", content: "y".repeat(5000) } : null),
    getNotes: async () => [{ id: 9, title: "In folder", content: "folder body" }],
    getTranscriptionById: async () => ({ id: 311, text: "Draft a reply to Maya" }),
  };
  const { text, notes } = await buildPinnedContext(
    [{ kind: "meeting", id: 38, label: "Pricing review" }, { kind: "note", id: 404, label: "Gone" }, { kind: "folder", id: 2, label: "Work" }, { kind: "dictation", id: 311, label: "Draft…" }],
    api
  );
  assert.match(text, /<note id="38" title="Pricing review">\ny{1500}\n<\/note>/);
  assert.doesNotMatch(text, /id="404"/);
  assert.match(text, /<note id="9" title="In folder">/);
  assert.match(text, /<dictation id="311">\nDraft a reply to Maya\n<\/dictation>/);
  assert.deepEqual(notes.map((n) => n.id), [38, 9], "every note that reached the prompt is citable");
});

test("a pinned-only note is cited even with empty RAG and tool results, and survives save and load (I12)", async () => {
  const { buildPinnedContext } = await load();
  const { collectSources, numberCitations } = require("../../src/components/chat/citations.ts");
  const { notes } = await buildPinnedContext([{ kind: "note", id: 17, label: "Pricing FAQ draft" }], {
    getNote: async () => ({ id: 17, title: "Pricing FAQ draft", content: "Local transcription is always included" }),
    getNotes: async () => [],
    getTranscriptionById: async () => null,
  });
  const saved = JSON.parse(JSON.stringify({ context: { ragNotes: [], pinnedNotes: notes } })).context;
  const { numbers, sources } = numberCitations(
    "Local stays included [note:17].",
    collectSources([], [...saved.ragNotes, ...saved.pinnedNotes])
  );
  assert.deepEqual([...numbers], [[17, 1]]);
  assert.equal(sources[0].title, "Pricing FAQ draft");
});
```

Create `test/components/chatComposerMention.test.js`. It uses Task 4's shared `mountComposer` helper:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { mountComposer: mount } = require("../helpers/harness/mountComposer");

test("an IME candidate commit never reaches the mention picker or submits (I10)", async (t) => {
  const sent = [];
  const intercepted = [];
  const c = await mount(t, async (text) => (sent.push(text), true), {
    interceptKeyDown: (e) => (intercepted.push(e.key), true),
  });
  await c.type("@pri");
  await c.press("Enter", { isComposing: true });
  await c.press("Enter", { keyCode: 229 });
  assert.deepEqual(intercepted, []);
  assert.deepEqual(sent, []);
});

test("with the picker open, Enter selects a mention instead of submitting", async (t) => {
  const sent = [];
  const c = await mount(t, async (text) => (sent.push(text), true), { interceptKeyDown: () => true });
  await c.type("@pri");
  await c.press("Enter");
  assert.deepEqual(sent, []);
});

test("with the picker closed, Enter submits as usual", async (t) => {
  const sent = [];
  const c = await mount(t, async (text) => (sent.push(text), true), { interceptKeyDown: () => false });
  await c.type("hello");
  await c.press("Enter");
  assert.deepEqual(sent, ["hello"]);
});
```

Append to `test/helpers/useChatStreamingCancellation.test.js`. Use the `hookOptions` support that Task 21 added to `renderChatStreaming`:

```js
function deferredPinned() {
  let resolve;
  let started = false;
  const promise = new Promise((r) => (resolve = r));
  return { get started() { return started; }, resolve, getPinnedContext: () => ((started = true), promise) };
}
const waitFor = async (check) => {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setImmediate(r));
};
function countingFetch(t) {
  const original = globalThis.fetch;
  t.after(() => (globalThis.fetch = original));
  const calls = { count: 0 };
  globalThis.fetch = async () => {
    calls.count += 1;
    const finish = `data: ${JSON.stringify(createOpenAiChunk({ content: "ok" }))}\n\ndata: ${JSON.stringify(createOpenAiChunk({}, "stop"))}\n\n`;
    return new Response(`${finish}data: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  return calls;
}
const PINNED = { text: '<note id="17" title="Pinned">\nbody\n</note>', notes: [{ id: 17, title: "Pinned", type: "personal", date: null, quote: "body" }] };

test("Stop while pinned context loads never starts a provider request (I02)", async (t) => {
  const calls = countingFetch(t);
  const pinned = deferredPinned();
  const { captured, getMessages } = await renderChatStreaming(t, { hookOptions: { getPinnedContext: pinned.getPinnedContext } });
  const send = captured.sendToAI("hello", []);
  await waitFor(() => pinned.started);
  captured.cancelStream();
  pinned.resolve(PINNED);
  await send;
  assert.equal(calls.count, 0);
  assert.deepEqual(getMessages(), []);
});

test("unmount while pinned context loads never starts a provider request", async (t) => {
  const calls = countingFetch(t);
  const pinned = deferredPinned();
  const { captured, getMessages, unmount } = await renderChatStreaming(t, { live: true, hookOptions: { getPinnedContext: pinned.getPinnedContext } });
  const send = captured.sendToAI("hello", []);
  await waitFor(() => pinned.started);
  await unmount();
  pinned.resolve(PINNED);
  await send;
  assert.equal(calls.count, 0);
  assert.deepEqual(getMessages(), []);
});

test("a newer send supersedes one still loading pinned context", async (t) => {
  const calls = countingFetch(t);
  const first = deferredPinned();
  let useFirst = true;
  const { captured, getMessages } = await renderChatStreaming(t, {
    hookOptions: { getPinnedContext: () => (useFirst ? ((useFirst = false), first.getPinnedContext()) : Promise.resolve(PINNED)) },
  });
  const firstSend = captured.sendToAI("first", []);
  await waitFor(() => first.started);
  await captured.sendToAI("second", []);
  first.resolve(PINNED);
  await firstSend;
  assert.equal(calls.count, 1);
  assert.equal(getMessages().filter((m) => m.role === "assistant").length, 1);
});

test("a completed answer records the pinned notes it was given (I12)", async (t) => {
  countingFetch(t);
  const { captured, getMessages } = await renderChatStreaming(t, { hookOptions: { getPinnedContext: async () => PINNED } });
  await captured.sendToAI("hello", []);
  const answer = getMessages().find((m) => m.role === "assistant");
  assert.deepEqual(answer.context.pinnedNotes.map((n) => n.id), [17]);
});
```

If `cancelled()` (`useChatStreaming.ts:224`) does not yet treat a newer `sendToAI` as a cancellation of the older one, make it compare `sendGeneration` with `sendGenerationRef.current` too. The "newer send" test pins that.

Create `test/components/chatContextRail.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { renderStatic } = require("../helpers/harness/reactSsr");

async function load() {
  if (!i18next.isInitialized) {
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8"));
    await i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  }
  return import("../../src/components/chat/ChatContextRail.tsx");
}

test("pinned items are removable; found items are read-only; no fake toggles", async () => {
  const { ChatContextRail } = await load();
  const html = renderStatic(ChatContextRail, {
    model: {
      pinned: [{ kind: "meeting", id: 38, label: "Pricing review" }],
      found: [{ noteId: 17, title: "Pricing FAQ draft", kind: "note" }],
      activity: [{ key: "t1", toolName: "search_notes", status: "completed", label: "Searched notes: “pricing”" }],
    },
    onUnpin: () => {},
    onOpenNote: () => {},
  });
  assert.match(html, /<aside[^>]*aria-label="Context"/);
  assert.match(html, /aria-label="Remove Pricing review from context"/);
  assert.match(html, /Found automatically/);
  assert.doesNotMatch(html, /type="checkbox"|role="switch"/);
  assert.match(html, /<ol[\s\S]*Searched notes: “pricing”/);
});

test("an empty rail explains how to add context", async () => {
  const { ChatContextRail } = await load();
  const html = renderStatic(ChatContextRail, { model: { pinned: [], found: [], activity: [] }, onUnpin: () => {}, onOpenNote: () => {} });
  assert.match(html, /Type @ to add a note, meeting or folder/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/contextRail.test.js test/components/chatContextRail.test.js test/components/chatComposerMention.test.js test/helpers/useChatStreamingCancellation.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

1. Create `src/components/chat/contextRail.ts`:

   ```ts
   import type { MentionResult } from "../../lib/mentionSearch";
   import { collectSources, type RagNoteRef } from "./citations";
   import type { Message, ToolCallInfo } from "./types";

   export const RAIL_STORAGE_KEY = "chat.contextRailOpen";
   const PINNED_NOTE_CHARS = 1500;
   const FOLDER_NOTES = 5;
   const FOLDER_NOTE_CHARS = 500;

   export interface PinnedContextItem {
     kind: "note" | "meeting" | "folder" | "dictation";
     id: number;
     label: string;
   }
   export interface RailModel {
     pinned: PinnedContextItem[];
     found: Array<{ noteId: number; title: string; kind: "note" | "meeting" }>;
     activity: Array<{ key: string; toolName: string; status: ToolCallInfo["status"]; label: string }>;
   }

   export function buildRailModel(messages: Message[], pinned: PinnedContextItem[], labelFor: (tc: ToolCallInfo) => string): RailModel {
     const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
     const pinnedIds = new Set(pinned.filter((p) => p.kind === "note" || p.kind === "meeting").map((p) => p.id));
     const found = [...collectSources(lastAssistant?.toolCalls, lastAssistant?.context?.ragNotes).values()]
       .filter((s) => !pinnedIds.has(s.noteId))
       .map((s) => ({ noteId: s.noteId, title: s.title, kind: s.kind }));
     const activity = messages.flatMap((m) =>
       (m.toolCalls ?? []).map((tc) => ({ key: `${m.id}-${tc.id}`, toolName: tc.name, status: tc.status, label: labelFor(tc) }))
     );
     return { pinned, found, activity };
   }

   const MENTION_QUERY = /(^|\s)@([^\s@]{0,26})$/;
   export function detectMentionQuery(text: string, caret: number): { start: number; query: string } | null {
     const before = text.slice(0, caret);
     const match = before.match(MENTION_QUERY);
     if (!match) return null;
     return { start: before.length - match[2].length - 1, query: match[2] };
   }

   export function removeMentionQuery(text: string, match: { start: number; query: string }): string {
     const end = match.start + 1 + match.query.length;
     return (text.slice(0, match.start) + text.slice(end)).replace(/ {2,}/g, " ").trim();
   }

   export function pinnedFromMention(result: MentionResult): PinnedContextItem | null {
     if (result.kind === "person" || !result.entityId) return null;
     return { kind: result.kind, id: Number(result.entityId), label: result.label };
   }

   const attr = (v: string) => v.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]!);
   export interface PinnedContextApi {
     getNote(id: number): Promise<{ id: number; title: string; content?: string | null; enhanced_content?: string | null; note_type?: string | null } | null>;
     getNotes(noteType: string | null, limit: number, folderId: number | null): Promise<Array<{ id: number; title: string; content?: string | null; note_type?: string | null }>>;
     getTranscriptionById(id: number): Promise<{ id: number; text: string } | null>;
   }

   // What the user pinned is what the model receives: the rail never shows a
   // control that does not change the prompt.
   const ref = (n: { id: number; title: string; content?: string | null; note_type?: string | null }, body: string): RagNoteRef => ({
     id: n.id,
     title: n.title,
     type: n.note_type ?? null,
     date: null,
     quote: body.replace(/\s+/g, " ").trim().slice(0, 240),
   });

   export async function buildPinnedContext(
     items: PinnedContextItem[],
     api: PinnedContextApi
   ): Promise<{ text: string; notes: RagNoteRef[] }> {
     const parts = await Promise.all(
       items.map(async (item): Promise<{ text: string; notes: RagNoteRef[] } | null> => {
         try {
           if (item.kind === "note" || item.kind === "meeting") {
             const note = await api.getNote(item.id);
             if (!note) return null;
             const body = (note.enhanced_content || note.content || "").slice(0, PINNED_NOTE_CHARS);
             return { text: `<note id="${note.id}" title="${attr(note.title)}">\n${body}\n</note>`, notes: [ref(note, body)] };
           }
           if (item.kind === "folder") {
             const notes = await api.getNotes(null, FOLDER_NOTES, item.id);
             if (notes.length === 0) return null;
             return {
               text: notes.map((n) => `<note id="${n.id}" title="${attr(n.title)}">\n${(n.content || "").slice(0, FOLDER_NOTE_CHARS)}\n</note>`).join("\n\n"),
               notes: notes.map((n) => ref(n, (n.content || "").slice(0, FOLDER_NOTE_CHARS))),
             };
           }
           const dictation = await api.getTranscriptionById(item.id);
           return dictation ? { text: `<dictation id="${dictation.id}">\n${dictation.text}\n</dictation>`, notes: [] } : null;
         } catch {
           return null;
         }
       })
     );
     const present = parts.filter((p): p is { text: string; notes: RagNoteRef[] } => !!p);
     return { text: present.map((p) => p.text).join("\n\n"), notes: present.flatMap((p) => p.notes) };
   }
   ```

   In the rail-model test, `buildRailModel` reads `found` from the last assistant message. The candidates are search hits 38 and 5 plus RAG note 17. Note 5 is pinned, so `found` is `[38, 17]`, with 38 as a meeting.

2. Create `src/components/chat/ChatContextRail.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { FileText, Folder, Mic, Users, X } from "lucide-react";
   import type { RailModel, PinnedContextItem } from "./contextRail";

   const ICON = { note: FileText, meeting: Users, folder: Folder, dictation: Mic } as const;

   export function ChatContextRail({
     model,
     onUnpin,
     onOpenNote,
   }: {
     model: RailModel;
     onUnpin: (item: PinnedContextItem) => void;
     onOpenNote: (noteId: number) => void;
   }) {
     const { t } = useTranslation();
     const heading = "text-micro font-bold uppercase tracking-[0.04em] text-muted-foreground";
     return (
       <aside aria-label={t("chat.rail.label")} className="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-s border-border px-3 py-3 text-caption dark:border-white/10">
         <section>
           <h2 className={heading}>{t("chat.rail.inScope")}</h2>
           {model.pinned.length === 0 && model.found.length === 0 && (
             <p className="mt-1.5 text-muted-foreground">{t("chat.rail.emptyScope")}</p>
           )}
           <ul className="mt-1.5 flex flex-col gap-1">
             {model.pinned.map((item) => {
               const Icon = ICON[item.kind];
               return (
                 <li key={`${item.kind}-${item.id}`} className="flex items-center gap-1.5 text-foreground">
                   <Icon size={12} aria-hidden className="shrink-0 text-muted-foreground" />
                   <span dir="auto" className="flex-1 truncate">{item.label}</span>
                   <button type="button" onClick={() => onUnpin(item)} aria-label={t("chat.rail.unpin", { label: item.label })} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                     <X size={12} aria-hidden />
                   </button>
                 </li>
               );
             })}
           </ul>
           {model.found.length > 0 && (
             <>
               <p className="mt-2 text-muted-foreground">{t("chat.rail.found")}</p>
               <ul className="mt-1 flex flex-col gap-1">
                 {model.found.map((item) => {
                   const Icon = ICON[item.kind];
                   return (
                     <li key={item.noteId}>
                       <button type="button" onClick={() => onOpenNote(item.noteId)} className="flex w-full items-center gap-1.5 text-start text-foreground hover:underline">
                         <Icon size={12} aria-hidden className="shrink-0 text-muted-foreground" />
                         <span dir="auto" className="truncate">{item.title || t("notes.list.untitledNote")}</span>
                       </button>
                     </li>
                   );
                 })}
               </ul>
             </>
           )}
         </section>
         <section>
           <h2 className={heading}>{t("chat.rail.activity")}</h2>
           {model.activity.length === 0 ? (
             <p className="mt-1.5 text-muted-foreground">{t("chat.rail.noActivity")}</p>
           ) : (
             <ol className="mt-1.5 flex flex-col gap-1">
               {model.activity.map((step) => (
                 <li key={step.key} className="flex gap-1.5 text-foreground">
                   <span aria-hidden className={step.status === "executing" ? "text-agent-text" : step.status === "error" ? "text-destructive" : "text-muted-foreground"}>•</span>
                   <span dir="auto">{step.label}</span>
                 </li>
               ))}
             </ol>
           )}
         </section>
       </aside>
     );
   }
   ```

3. In `src/components/chat/ChatInput.tsx`:
   - Add `onDraftChange?: (text: string, caret: number) => void; interceptKeyDown?: (event: React.KeyboardEvent) => boolean;` to the props.
   - In the composer's `onChange`, after `setInputText(value)`, call `onDraftChange?.(value, event.target.selectionStart ?? value.length)`.
   - Keep the parent's mirror honest: wherever ChatInput changes `inputText` programmatically, also call `onDraftChange?.(next, next.length)`.
     - Today that means the submit path that clears it to `""`, and the render-time seed application from Task 4. Call it from an effect keyed on `appliedSeed`, because a parent callback must not run during render.
     - Otherwise a sent message would linger in `ChatView`'s `draftRef` and come back on the next pick.
   - At the very top of `handleKeyDown`, add:

     ```ts
     // IME owns the keyboard while composing: no mention pick, no submit (I10).
     // Plan 02 makes this decision inside resolveComposerKey, which runs after
     // the interceptor, so it must also happen here, first.
     if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
     if (interceptKeyDown?.(e)) return;
     ```

4. In `src/components/chat/useChatStreaming.ts`:
   - Add `getPinnedContext?: () => Promise<{ text: string; notes: RagNoteRef[] }>;` to the options.
   - At `:295`, directly after the existing post-RAG guard (`:294`):

     ```ts
     const pinned = (await getPinnedContext?.()) ?? { text: "", notes: [] };
     // A new await is a new chance to be stopped, unmounted or superseded:
     // recheck before anything is created or dispatched (I02).
     if (cancelled() || !mountedRef.current) return;
     const pinnedContext = pinned.text;
     const combinedContext = [noteContextRef.current, pinnedContext, ragContext].filter(Boolean).join("\n\n");
     ```

   - The assistant message creation (`:346`) becomes `context: { ragNotes: rag.notes, pinnedNotes: pinned.notes, route: sentRoute }`.

   - Update `hasSources` from Task 19 to `ragContext.length > 0 || pinnedContext.length > 0 || (registry?.getAll().length ?? 0) > 0`. It stays gated by `citations`.

5. In `src/components/chat/ChatView.tsx`:

   ```ts
   const navigation = useWorkspaceNavigation();
   const [pinned, setPinned] = useState<PinnedContextItem[]>([]);
   const pinnedRef = useRef(pinned);
   pinnedRef.current = pinned;
   const [railOpen, setRailOpen] = useState(() => {
     const saved = window.localStorage.getItem(RAIL_STORAGE_KEY);
     return saved == null ? window.innerWidth >= 1280 : saved === "true";
   });
   const toggleRail = useCallback(() => {
     setRailOpen((open) => {
       window.localStorage.setItem(RAIL_STORAGE_KEY, String(!open));
       return !open;
     });
   }, []);
   const draftRef = useRef({ text: "", caret: 0 });
   // "typed": the user typed @query (removed from the draft on pick).
   // "button": opened from Add context (nothing to remove).
   const [mentionMatch, setMentionMatch] = useState<{ start: number; query: string; source: "typed" | "button" } | null>(null);
   const [mentionItems, setMentionItems] = useState<MentionResult[]>([]);
   const mentionListRef = useRef<MentionSuggestionsHandle>(null);
   ```

   - Pass `getPinnedContext: () => buildPinnedContext(pinnedRef.current, window.electronAPI)` into `useChatStreaming`. It now returns `{ text, notes }`.
   - `⌘.`: `useEffect` with a keydown listener: `mod && e.key === "." && !isDialogOpen(document)`, calling `preventDefault()` and then `toggleRail()`.
   - When `mentionMatch` changes, run the search:

     ```ts
     useEffect(() => {
       if (!mentionMatch) return setMentionItems([]);
       let alive = true;
       void searchMentionEntities(mentionMatch.query, mentionSourcesRef.current, ["note", "meeting", "dictation", "folder"])
         .then((groups) => alive && setMentionItems(flattenMentionGroups(groups)))
         .catch(() => alive && setMentionItems([]));
       return () => { alive = false; };
     }, [mentionMatch?.query]);
     ```

   - `mentionSourcesRef` is built like Task 18's `sourcesRef`, with `people: []` and the same `describe`. To avoid duplication, extract Task 18's builder into `src/hooks/useMentionSources.ts` as `useMentionSources(people: MentionPerson[]): React.MutableRefObject<MentionSources>`, and use it in both `RichTextEditor` and here.
   - `ChatInput` gets these props:

     ```tsx
     onDraftChange={(text, caret) => {
       draftRef.current = { text, caret };
       const typed = detectMentionQuery(text, caret);
       setMentionMatch((current) =>
         typed ? { ...typed, source: "typed" } : current?.source === "button" ? current : null
       );
     }}
     interceptKeyDown={(e) => {
       if (!mentionMatch) return false;
       if (e.key === "Escape") { setMentionMatch(null); return true; }
       return mentionListRef.current?.onKeyDown(e.nativeEvent) ?? false;
     }}
     ```

   - Render the popover above the chip row while `mentionMatch` is set:

     ```tsx
     {mentionMatch && (
       <div className={cn(PAGE_CONTENT_WIDTH_CLASS, "relative")}>
         <div className="absolute bottom-full start-0 z-40 mb-1">
           <MentionSuggestions
             ref={mentionListRef}
             items={mentionItems}
             command={(item) => {
               const next = pinnedFromMention(item);
               if (next) setPinned((list) => (list.some((p) => p.kind === next.kind && p.id === next.id) ? list : [...list, next]));
               if (mentionMatch.source === "typed") {
                 // Editing the user's own draft: keep any queue they armed.
                 setComposerSeed({ text: removeMentionQuery(draftRef.current.text, mentionMatch), nonce: Date.now(), resetQueue: false });
               }
               setMentionMatch(null);
             }}
           />
         </div>
       </div>
     )}
     ```

   - In the chip row from Task 21, after `ChatModelChip`, add:
     - one 28px chip per pinned item, with an `X` remove button labelled `t("chat.rail.unpin", { label })`;
     - an "Add context" text button that sets `mentionMatch` to `{ start: draftRef.current.caret, query: "", source: "button" }`. It inserts nothing, and picking leaves the draft untouched;
     - a trailing `<button aria-pressed={railOpen} onClick={toggleRail}>{t("chat.rail.toggle")} <kbd className="text-micro">{platform === "darwin" ? "⌘." : "Ctrl+."}</kbd></button>`.
   - After the message column (`:187`), render:

     ```tsx
     {railOpen && hasActiveChat && (
       <ChatContextRail
         model={buildRailModel(persistence.messages, pinned, (tc) => tc.result ?? t(`agentMode.tools.${tc.name}Status`))}
         onUnpin={(item) => setPinned((list) => list.filter((p) => !(p.kind === item.kind && p.id === item.id)))}
         onOpenNote={navigation.openNote}
       />
     )}
     ```

   - Clear `pinned` in `handleNewChat` and `handleSelectConversation`. Context belongs to a conversation, so it never leaks into the next one.

6. Add strings (Task 1 helper). English block:

   ```json
   {
     "chat": {
       "rail": {
         "label": "Context",
         "toggle": "Context",
         "inScope": "In scope",
         "found": "Found automatically",
         "emptyScope": "Type @ to add a note, meeting or folder. The assistant also searches your notes on its own.",
         "unpin": "Remove {{label}} from context",
         "activity": "Activity",
         "noActivity": "Nothing yet",
         "addContext": "Add context"
       }
     }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/contextRail.test.js test/components/chatContextRail.test.js test/components/chatComposerMention.test.js test/components/chatComposerSeed.test.js test/helpers/useChatStreamingCancellation.test.js test/lib/mentionSearch.test.js test/helpers/chatMessageSubmissionLock.test.js test/locales/translationCoverage.test.js && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat src/hooks/useMentionSources.ts src/components/ui/RichTextEditor.tsx src/locales test/components/contextRail.test.js test/components/chatContextRail.test.js test/components/chatComposerMention.test.js test/helpers/useChatStreamingCancellation.test.js
git commit -m "feat(chat): add a context rail and @-pinned context that reaches the prompt"
```

---

### Task 23: Insights: responsive heatmap and tiles that lead somewhere

This covers WS-Q11 and WS-28.

**Files:**
- Create: `src/components/insights/MetricCard.tsx`. This is `MetricCard` moved out of `InsightsView.tsx:172-202`, so it renders without the settings store.
- Modify: `src/components/InsightsView.tsx`:
  - the heatmap: `columnStyle` at `:78`, the wrapper at `:85-91`, and the cells at `:122` and `:141`;
  - the stat grid at `:307-334`;
  - the heatmap card at `:337`.
- Test: `test/components/metricCard.test.js`, `test/components/insightsHeatmapLayout.test.js`

**Interfaces:**
- Consumes `useWorkspaceNavigation` and `setHomeFilter` (Task 3).
- Produces `MetricCard({ icon, label, value, detail, largeValue?, onSelect?, selectLabel? })`. With `onSelect`, it renders a `<button>` with `aria-label={selectLabel}`; without it, it renders the old `<div>`.

- [ ] **Step 1: Write the failing tests**

Create `test/components/metricCard.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const load = () => import("../../src/components/insights/MetricCard.tsx");
const Icon = () => null;

test("a tile with a destination is a labelled button", async () => {
  const { MetricCard } = await load();
  const html = renderStatic(MetricCard, { icon: Icon, label: "Dictations", value: "214", detail: "this year", onSelect: () => {}, selectLabel: "Show dictations in History" });
  assert.match(html, /^<button type="button" aria-label="Show dictations in History"/);
});

test("metadata is full secondary colour at caption size, not 11px at 70%", async () => {
  const { MetricCard } = await load();
  const html = renderStatic(MetricCard, { icon: Icon, label: "Words", value: "12,840", detail: "≈ 5.4 hours of typing" });
  assert.match(html, /^<div/);
  assert.match(html, /text-caption text-muted-foreground">≈ 5\.4 hours/);
  assert.doesNotMatch(html, /text-\[11px\]|muted-foreground\/70/);
});
```

Create `test/components/insightsHeatmapLayout.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const src = fs.readFileSync(path.join(__dirname, "../../src/components/InsightsView.tsx"), "utf8");

test("heatmap cells size from the container, within 10–18px (WS-Q11)", () => {
  assert.match(src, /@container/);
  assert.match(src, /clamp\(10px, calc\(\(100cqi - 3rem - \$\{weeks - 1\} \* 2px\) \/ \$\{weeks\}\), 18px\)/);
  assert.match(src, /size-\(--cell\)/);
  assert.doesNotMatch(src, /size-6/);
  assert.doesNotMatch(src, /1\.5rem\)/);
});

test("the stat grid follows the content width, not the viewport", () => {
  assert.match(src, /grid-cols-2 gap-3 @min-\[720px\]:grid-cols-4/);
  assert.doesNotMatch(src, /lg:grid-cols-4/);
});

test("Dictations leads to filtered History and Streak to the heatmap", () => {
  assert.match(src, /setHomeFilter\("dictations"\)/);
  assert.match(src, /heatmapRef\.current\?\.focus\(\)/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/metricCard.test.js test/components/insightsHeatmapLayout.test.js`
Expected: FAIL. The module is missing, and `size-6` and `lg:grid-cols-4` are still present.

- [ ] **Step 3: Implement**

1. Create `src/components/insights/MetricCard.tsx`:

   ```tsx
   import { cn } from "../lib/utils";

   export interface MetricCardProps {
     icon: React.ComponentType<{ size?: number; className?: string }>;
     label: string;
     value: string;
     detail: string;
     largeValue?: boolean;
     onSelect?: () => void;
     selectLabel?: string;
   }

   export function MetricCard({ icon: Icon, label, value, detail, largeValue = false, onSelect, selectLabel }: MetricCardProps) {
     const body = (
       <>
         <div className="flex items-center gap-2 text-muted-foreground">
           <Icon size={14} />
           <span className="text-caption">{label}</span>
         </div>
         <p className={cn("mt-3 font-semibold tracking-tight text-foreground", largeValue ? "text-3xl" : "text-2xl")}>{value}</p>
         <p className="mt-1 text-caption text-muted-foreground">{detail}</p>
       </>
     );
     const frame = "rounded-xl border border-border/70 bg-card/70 p-4 text-start dark:border-white/10";
     return onSelect ? (
       <button type="button" aria-label={selectLabel} onClick={onSelect} className={cn(frame, "hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
         {body}
       </button>
     ) : (
       <div className={frame}>{body}</div>
     );
   }
   ```

2. In `src/components/InsightsView.tsx`:
   - Delete the local `MetricCard` (`:172-202`) and import it from `./insights/MetricCard`.
   - In the heatmap, replace `columnStyle` (`:78`) with:

     ```ts
     const weeks = calendar.weeks.length;
     // WS-Q11: fixed tracks (see the comment above for why not 1fr), sized from
     // the container: labels take 3rem, 2px gaps between weeks.
     const cellStyle = { "--cell": `clamp(10px, calc((100cqi - 3rem - ${weeks - 1} * 2px) / ${weeks}), 18px)` } as React.CSSProperties;
     const columnStyle = { gridTemplateColumns: `repeat(${weeks}, var(--cell))` };
     ```

   - Wrap the focusable scroll container (`:85-90`) in `<div className="@container" style={cellStyle}>`. Forward the scroll container's ref as `heatmapRef`, using `useRef<HTMLDivElement>(null)` passed from `InsightsView` into `Heatmap` as a prop.
   - Change the month-label and week grids from `gap-2` to `gap-0.5`, so they match the 2px in the formula.
   - Change both `size-6` occurrences (`:122`, `:141`) to `size-(--cell)`.
   - Keep `overflow-x-auto`. At the 10px floor with a very narrow window, the chart still scrolls rather than overlapping.
   - Stat grid (`:307`): `grid grid-cols-2 gap-3 @min-[720px]:grid-cols-4`. Add `@container` to `InsightsView`'s root `cn(PAGE_CONTENT_WIDTH_CLASS, "@container px-6 py-6")`.
   - Tiles (`:308-334`): `const navigation = useWorkspaceNavigation();`, then:
     - **Words** and **WPM**: `onSelect={() => { setHomeFilter("all"); navigation.openView("home"); }}`, `selectLabel={t("insights.openHistory")}`.
     - **Dictations**: `onSelect={() => { setHomeFilter("dictations"); navigation.openView("home"); }}`, `selectLabel={t("insights.openDictations")}`.
     - **Streak**: `onSelect={() => { heatmapRef.current?.scrollIntoView({ block: "center" }); heatmapRef.current?.focus(); }}`, `selectLabel={t("insights.focusHeatmap")}`.
   - Heatmap card (`:337`): `rounded-2xl` becomes `rounded-xl`, so the radii match the tiles (WS-28).

3. Add strings (Task 1 helper). English block:

   ```json
   {
     "insights": {
       "openHistory": "Open History",
       "openDictations": "Show dictations in History",
       "focusHeatmap": "Go to the activity chart"
     }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/metricCard.test.js test/components/insightsHeatmapLayout.test.js test/locales/translationCoverage.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/insights/MetricCard.tsx src/components/InsightsView.tsx src/locales test/components/metricCard.test.js test/components/insightsHeatmapLayout.test.js
git commit -m "feat(insights): size the heatmap to its container and make tiles lead somewhere"
```

---

### Task 24: Upload: the drop zone is always there

This covers WS-Q14 and WS-27.

**Files:**
- Create: `src/components/notes/UploadDropZone.tsx`. This is the drop-zone element moved from `UploadAudioView.tsx:1395-1419` (its children included), plus the disabled state.
- Modify: `src/components/notes/UploadAudioView.tsx`:
  - `IdleView` (`:1360+`) renders `UploadDropZone`;
  - the render gates at `:879-893` (`NoProviderView` and `IdleView`);
  - the speaker-detection gate at `:1160`.
- Test: `test/components/uploadDropZone.test.js`, `test/components/uploadGates.test.js`

**Interfaces:**
- Produces:

  ```ts
  export interface UploadDropZoneProps {
    disabled: boolean;                 // no transcription model configured
    isDragOver: boolean;
    onDrop(e: React.DragEvent): void;
    onDragOver(e: React.DragEvent): void;
    onDragLeave(e: React.DragEvent): void;
    onBrowse(): void;
    onKeyDown(e: React.KeyboardEvent): void;
    onChooseModel(): void;
    children: React.ReactNode;         // the existing zone contents (icon, copy, model label)
  }
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/components/uploadDropZone.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { React, renderStatic } = require("../helpers/harness/reactSsr");

async function load() {
  if (!i18next.isInitialized) {
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8"));
    await i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  }
  return import("../../src/components/notes/UploadDropZone.tsx");
}
const noop = () => {};
const handlers = { isDragOver: false, onDrop: noop, onDragOver: noop, onDragLeave: noop, onBrowse: noop, onKeyDown: noop, onChooseModel: noop };

test("without a model the zone is visible, disabled, and says how to fix it", async () => {
  const { UploadDropZone } = await load();
  const html = renderStatic(UploadDropZone, { ...handlers, disabled: true }, React.createElement("span", null, "Drop audio here"));
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /tabindex="-1"/);
  assert.match(html, /Drop audio here/);
  assert.match(html, /<button[^>]*>Choose a transcription model<\/button>/);
});

test("with a model it is an ordinary focusable drop target", async () => {
  const { UploadDropZone } = await load();
  const html = renderStatic(UploadDropZone, { ...handlers, disabled: false }, React.createElement("span", null, "Drop audio here"));
  assert.match(html, /tabindex="0"/);
  assert.doesNotMatch(html, /aria-disabled/);
  assert.doesNotMatch(html, /Choose a transcription model/);
});
```

Create `test/components/uploadGates.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const src = fs.readFileSync(path.join(__dirname, "../../src/components/notes/UploadAudioView.tsx"), "utf8");

test("idle always shows the drop zone; no dead-end empty state", () => {
  assert.doesNotMatch(src, /<NoProviderView/);
  assert.match(src, /state === "idle" && \(\s*<IdleView/);
  assert.match(src, /disabled=\{providerReady === false\}/);
});

test("speaker detection appears only once transcription is usable", () => {
  assert.match(src, /\(state === "idle" \|\| state === "selected"\) && providerReady === true &&/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/uploadDropZone.test.js test/components/uploadGates.test.js`
Expected: FAIL. The module is missing, and `<NoProviderView` is still rendered.

- [ ] **Step 3: Implement**

1. Create `src/components/notes/UploadDropZone.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { cn } from "../lib/utils";

   export interface UploadDropZoneProps {
     disabled: boolean;
     isDragOver: boolean;
     onDrop(e: React.DragEvent): void;
     onDragOver(e: React.DragEvent): void;
     onDragLeave(e: React.DragEvent): void;
     onBrowse(): void;
     onKeyDown(e: React.KeyboardEvent): void;
     onChooseModel(): void;
     children: React.ReactNode;
   }

   // WS-Q14: the zone is always there, so the page explains itself. Without a
   // model it is inert and the fix sits right under it.
   export function UploadDropZone({ disabled, isDragOver, onDrop, onDragOver, onDragLeave, onBrowse, onKeyDown, onChooseModel, children }: UploadDropZoneProps) {
     const { t } = useTranslation();
     return (
       <div className="flex flex-col items-center gap-2">
         <div
           role="button"
           tabIndex={disabled ? -1 : 0}
           aria-disabled={disabled || undefined}
           aria-label={t("notes.upload.dropOrBrowse")}
           onDrop={disabled ? (e) => e.preventDefault() : onDrop}
           onDragOver={disabled ? (e) => e.preventDefault() : onDragOver}
           onDragLeave={disabled ? undefined : onDragLeave}
           onClick={disabled ? undefined : onBrowse}
           onKeyDown={disabled ? undefined : onKeyDown}
           className={cn(
             "relative w-full rounded-lg p-8 text-center transition-[background-color,border-color,transform] duration-300 group",
             "bg-surface-1/40 dark:bg-white/[0.03] border border-foreground/6 dark:border-white/10",
             disabled
               ? "cursor-not-allowed opacity-60"
               : "cursor-pointer hover:bg-surface-1/60 hover:border-foreground/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
             !disabled && isDragOver && "border-foreground/30 bg-foreground/[0.04] scale-[1.01]"
           )}
         >
           {children}
         </div>
         {disabled && (
           <p className="text-caption text-muted-foreground">
             {t("notes.upload.needsModel")}{" "}
             <button type="button" onClick={onChooseModel} className="text-link hover:underline">
               {t("notes.upload.chooseModel")}
             </button>
           </p>
         )}
       </div>
     );
   }
   ```

   The drag-over tint moves from `primary` to neutral ink (D1). Keep the original `drag-pulse` style only when it is not disabled, by passing it through in `IdleView`.

2. In `src/components/notes/UploadAudioView.tsx`:
   - `IdleView`: add `disabled: boolean; onChooseModel: () => void;` to its props. Replace the inline zone (`:1395-1419` through its closing tag) with `<UploadDropZone disabled={disabled} isDragOver={isDragOver} onDrop={handleDrop} onDragOver={…existing…} onDragLeave={…existing…} onBrowse={handleBrowse} onKeyDown={handleKeyDown} onChooseModel={onChooseModel}>…existing children…</UploadDropZone>`.
   - Render gates (`:879-893`): delete the `providerReady === false && <NoProviderView … />` branch. Render `IdleView` whenever `state === "idle"`:

     ```tsx
     {state === "idle" && (
       <IdleView
         …existing props…
         disabled={providerReady === false}
         onChooseModel={() => onOpenSettings?.("uploadTranscription")}
       />
     )}
     ```

     Keep the "or" divider and the URL input, and pass `disabled` to the URL input as well.
   - Delete `NoProviderView` (`:1317-1348`) and its props type.
   - Speaker detection (`:1160`): the gate becomes `{(state === "idle" || state === "selected") && providerReady === true && (`.
   - `test/components/fieldDirectionPolicy.test.js:68` and `:80` count inputs and `dir` values in this file. Removing `NoProviderView` removes no inputs. If the counts change, update the expectations in the same commit and say why.

3. Add strings (Task 1 helper). English block:

   ```json
   { "notes": { "upload": { "needsModel": "Uploads need a transcription model.", "chooseModel": "Choose a transcription model" } } }
   ```

   Delete `notes.upload.noProviderTitle` and `notes.upload.noProviderDescription` only if `grep` finds no other users. `noProviderAction` stays, because `UploadModelSettingsButton` uses it (`:1387`, `:1497`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/uploadDropZone.test.js test/components/uploadGates.test.js test/components/uploadAudioFeedback.test.js test/components/fieldDirectionPolicy.test.js test/locales/translationCoverage.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/notes/UploadDropZone.tsx src/components/notes/UploadAudioView.tsx src/locales test/components/uploadDropZone.test.js test/components/uploadGates.test.js test/components/fieldDirectionPolicy.test.js
git commit -m "fix(upload): always show the drop zone and say how to enable it"
```

---

### Task 25: Contrast, ramp and banner adoption across the workspace

This covers WS-Q4 (adoption, per D1), WS-Q10, the WS-R11 B ramp adoption, WS-29, WS-30, WS-31 and WS-35. It runs last so it covers every file the earlier tasks touched.

**Files:**
- Create: `src/components/ui/DataRetentionNotice.tsx`, `test/helpers/workspaceTokenGuard.js`
- Modify:
  - `src/components/HistoryView.tsx:134-141` and `src/components/InsightsView.tsx:286-293`, which switch to the notice;
  - every file the guard test reports. `DictionaryView.tsx` and `SnippetsView.tsx` take token edits only; Plan 03's header and import changes in those files stay as they are.
- Modify: `DESIGN.md`. In `## Do's and Don'ts`, add the workspace rules below.
- Test: `test/components/workspaceTokenAdoption.test.js`, `test/components/dataRetentionNotice.test.js`

**Interfaces:**
- Produces `DataRetentionNotice({ messageKey: string; className?: string })`, which renders an `AlertTriangle` in `text-warning`, a `border-warning/30 bg-warning/5` frame, and foreground text.
- Produces the workspace token guard (CR-06-6): `test/helpers/workspaceTokenGuard.js` exports `LINE_RULES`, `LIVE_GLASS_ALLOWED`, `WORKSPACE_GUARDED_FILES`, `scanText(file, text)` and `scanFiles(files)`. Each violation is a string `<file>:<line> <match> — <rule-id>: <why>`. Rule ids: `arbitrary-size`, `faded-muted`, `faded-foreground`, `orange-text`, `orange-fill`, `raw-amber`, `glyph-icon`, `provider-name`, `faded-ring`, `live-glass`, `icon-cta`.
- Produces the opt-out syntax: a same-line comment `token-guard: allow <rule-id> — <reason>`. The reason is required; an opt-out without one does not count.

- [ ] **Step 1: Write the failing tests**

Create `test/components/dataRetentionNotice.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const load = () => import("../../src/components/ui/DataRetentionNotice.tsx");

test("the retention notice uses the warning icon and tokens, not a text glyph or raw amber", async () => {
  const { DataRetentionNotice } = await load();
  const html = renderStatic(DataRetentionNotice, { messageKey: "controlPanel.history.dataRetentionDisabled" });
  assert.match(html, /<svg[^>]*class="[^"]*text-warning/);
  assert.match(html, /border-warning\/30/);
  assert.doesNotMatch(html, /⊘|amber-/);
  assert.match(html, /role="status"/);
});
```

Create `test/helpers/workspaceTokenGuard.js`. This is the guard itself. It is a published contract (CR-06-6): Plan 06 owns the rules and the file list, and other plans call `scanFiles` on their own files.

```js
// Workspace token guard (Plan 06, CR-06-6). One rule set for D1 (orange means
// live voice), the WS-R11 B type ramp and the spec §4 contrast floors.
// Opt-out for a justified line: a trailing comment
//   // token-guard: allow <rule-id> — <reason>
// on the same line. The reason is required, and reviewers read it.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "../..");

const LINE_RULES = [
  { id: "arbitrary-size", why: "arbitrary pixel font size; use the ramp (text-micro … text-display)", re: /\btext-\[\d+(?:\.\d+)?px\]/g },
  { id: "faded-muted", why: "faded metadata; use full text-muted-foreground", re: /\btext-muted-foreground\/\d+/g },
  { id: "faded-foreground", why: "foreground below 70% falls under 4.5:1; use text-muted-foreground", re: /\btext-foreground\/(?:[0-6]?\d)\b(?!\d)/g },
  { id: "orange-text", why: "orange text on light; use text-link", re: /\btext-primary\b(?!-foreground)/g },
  { id: "orange-fill", why: "orange fill outside live voice (D1); neutral, or bg-live on voice controls", re: /\bbg-primary\b/g },
  { id: "raw-amber", why: "raw amber; use the warning tokens", re: /\b(?:text|bg|border)-amber-\d+/g },
  { id: "glyph-icon", why: "text glyph used as an icon; use a Lucide icon and a word", re: /⊘/g },
  { id: "provider-name", why: "providerDisplayName is for logs; use providerDisplayLabel(providerId, t)", re: /\bproviderDisplayName\s*\(/g },
  { id: "faded-ring", why: "translucent focus ring is under 3:1; use ring-2 ring-ring (Plan 02)", re: /\bring-(?:ring|primary)\/\d+/g },
  { id: "live-glass", why: "orange glass outside a voice control (D1)", re: /\b(?:GRADIENT_CIRCLE|BRAND_GLASS_SURFACE)\b|gradient-brand-glass/g },
];

// Files whose glass is on voice controls only (mic, voice stop).
const LIVE_GLASS_ALLOWED = new Set(["src/components/chat/ChatInput.tsx"]);

// Default (ink) Buttons are text only: Plan 01's brand dot already leads.
const BUTTON_WITH_LEADING_ICON = /<Button\b((?:[^>{]|\{[^}]*\})*)>\s*<([A-Z][A-Za-z0-9]*)\b/g;

const dir = (d) =>
  fs.existsSync(path.join(ROOT, d))
    ? fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith(".tsx")).map((f) => `${d}/${f}`)
    : [];

// Every workspace screen and the components they own. Dictionary and Snippets
// are in scope for tokens only; Plan 03 owns their header and import changes.
const WORKSPACE_GUARDED_FILES = [
  "src/components/ControlPanel.tsx",
  "src/components/ControlPanelSidebar.tsx",
  "src/components/ControlPanelTopBar.tsx",
  "src/components/HistoryView.tsx",
  "src/components/CommandSearch.tsx",
  "src/components/UpcomingMeetings.tsx",
  "src/components/InsightsView.tsx",
  "src/components/IntegrationsView.tsx",
  "src/components/DictionaryView.tsx",
  "src/components/SnippetsView.tsx",
  "src/components/CaptureMenu.tsx",
  "src/components/CaptureControl.tsx",
  "src/components/MicStatusCard.tsx",
  "src/components/ui/TranscriptionItem.tsx",
  "src/components/ui/EmptyStateCard.tsx",
  "src/components/ui/DataRetentionNotice.tsx",
  "src/components/ui/MentionSuggestions.tsx",
  "src/components/ui/MentionChip.tsx",
  "src/components/ui/MentionHoverCard.tsx",
  "src/components/notes/NoteEditor.tsx",
  "src/components/notes/NoteBottomBar.tsx",
  "src/components/notes/PersonalNotesView.tsx",
  "src/components/notes/SpacesTree.tsx",
  "src/components/notes/UploadAudioView.tsx",
  "src/components/notes/UploadDropZone.tsx",
  ...dir("src/components/chat"),
  ...dir("src/components/home"),
  ...dir("src/components/insights"),
  ...dir("src/components/ui/editor"),
];

const ALLOW = /token-guard:\s*allow\s+([\w-]+)\s+—\s+\S/;

function scanText(file, text) {
  const out = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const allowed = line.match(ALLOW)?.[1];
    for (const rule of LINE_RULES) {
      if (rule.id === allowed) continue;
      if (rule.id === "live-glass" && LIVE_GLASS_ALLOWED.has(file)) continue;
      for (const match of line.matchAll(rule.re)) out.push(`${file}:${index + 1} ${match[0]} — ${rule.id}: ${rule.why}`);
    }
  });
  for (const match of text.matchAll(BUTTON_WITH_LEADING_ICON)) {
    const attrs = match[1];
    if (/\bvariant=/.test(attrs) && !/variant="default"/.test(attrs)) continue;
    const lineNo = text.slice(0, match.index).split("\n").length;
    if (ALLOW.exec(lines[lineNo - 1])?.[1] === "icon-cta") continue;
    out.push(`${file}:${lineNo} <Button> + <${match[2]}> — icon-cta: default Buttons are text only; use variant="live" (voice) or "secondary"/"outline"`);
  }
  return out;
}

/** Scan repo-relative files; missing files are skipped. Returns violations. */
function scanFiles(files) {
  return files.flatMap((file) => {
    const full = path.join(ROOT, file);
    return fs.existsSync(full) ? scanText(file, fs.readFileSync(full, "utf8")) : [];
  });
}

module.exports = { LINE_RULES, LIVE_GLASS_ALLOWED, WORKSPACE_GUARDED_FILES, scanText, scanFiles };
```

Create `test/components/workspaceTokenAdoption.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { WORKSPACE_GUARDED_FILES, scanFiles, scanText } = require("../helpers/workspaceTokenGuard");

test("workspace files use the ramp, the D1 colour roles and full-opacity focus rings", () => {
  assert.deepEqual(scanFiles(WORKSPACE_GUARDED_FILES), []);
});

test("the guard catches what it promises, and honours a reasoned opt-out", () => {
  const hits = (src) => scanText("x.tsx", src).map((v) => v.split(" — ")[1].split(":")[0]);
  assert.deepEqual(hits('<p className="text-[10px] text-muted-foreground/70 text-foreground/55">'), ["arbitrary-size", "faded-muted", "faded-foreground"]);
  assert.deepEqual(hits('<p className="text-foreground/80 text-foreground">'), [], "70% and above passes");
  assert.deepEqual(hits('<div className="focus-visible:ring-ring/40 bg-primary/10 text-primary">').sort(), ["faded-ring", "orange-fill", "orange-text"]);
  assert.deepEqual(hits("<Button onClick={() => go()}>\n  <AlignLeft size={16} />"), ["icon-cta"]);
  assert.deepEqual(hits('<Button variant="secondary">\n  <AlignLeft />'), []);
  assert.deepEqual(hits('<p className="text-foreground/50"> {/* token-guard: allow faded-foreground — confidence typography (Plan 08) */}'), []);
  assert.deepEqual(hits('<p className="text-foreground/50"> {/* token-guard: allow faded-foreground */}'), ["faded-foreground"], "an opt-out needs a reason");
});

test("the ramp adds sizes; it never redefines Tailwind's standard ones", () => {
  const css = fs.readFileSync(path.join(__dirname, "../../src/index.css"), "utf8");
  assert.doesNotMatch(css, /--text-(?:xs|sm|base|lg|xl|[2-9]xl):/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/dataRetentionNotice.test.js test/components/workspaceTokenAdoption.test.js`
Expected: FAIL. The module is missing, and the first guard test lists offenders grouped by rule id. On the tree at 0e581d6 it reports about 390 (`faded-foreground` 118, `arbitrary-size` 68, `faded-muted` 67, `orange-fill` 52, `orange-text` 38, `faded-ring` 23, `raw-amber` 18, `icon-cta` 4, `glyph-icon` 2, `live-glass` 2). The largest files are `UploadAudioView.tsx` (76), `CommandSearch.tsx` (46), `DictionaryView.tsx` (29), `ChatMessage.tsx` (29) and `SnippetsView.tsx` (25). Earlier tasks remove some of these, so the count when you reach this task will be lower. The self-test and the CSS test pass already. Save the list; it is the worklist for Step 3.

- [ ] **Step 3: Implement**

1. Create `src/components/ui/DataRetentionNotice.tsx`:

   ```tsx
   import { AlertTriangle } from "lucide-react";
   import { useTranslation } from "react-i18next";
   import { cn } from "../lib/utils";

   // WS-Q10: one notice for "history is not being kept", shared by Home and Insights.
   export function DataRetentionNotice({ messageKey, className }: { messageKey: string; className?: string }) {
     const { t } = useTranslation();
     return (
       <div role="status" className={cn("flex items-center gap-2.5 rounded-lg border border-warning/30 bg-warning/5 px-3.5 py-2.5", className)}>
         <AlertTriangle size={14} aria-hidden className="shrink-0 text-warning" />
         <span className="text-ui text-foreground">{t(messageKey)}</span>
       </div>
     );
   }
   ```

   The text is `text-foreground`, because `--color-warning` (#d97706 on white is 3.19:1) is safe for the icon but not for text.

2. Replace the inline banner in `HistoryView.tsx:134-141` with `<DataRetentionNotice className="mb-3" messageKey="controlPanel.history.dataRetentionDisabled" />`, and the one in `InsightsView.tsx:286-293` with `<DataRetentionNotice className="mb-5" messageKey="insights.dataRetentionDisabled" />`.

3. Work through the Step 2 offender list file by file, using this mapping. Change only the class that the rule names.

   | Found | Replace with |
   |---|---|
   | `text-[8px]`, `text-[9px]`, `text-[10px]` on a kbd or badge | `text-micro` |
   | `text-[10px]`, `text-[11px]`, `text-[12px]` on readable text | `text-caption` |
   | `text-[13px]` | `text-ui` |
   | `text-[14px]`, `text-[15px]` | `text-body` |
   | `text-muted-foreground/NN` | `text-muted-foreground` |
| `text-foreground/NN` below 70 | `text-muted-foreground` (70 and above passes and may stay) |
| `ring-ring/NN` or `ring-primary/NN` | `ring-2 ring-ring` (Plan 02's focus rule) |
   | `text-primary` used as text colour | `text-link` (or `text-nav-marker` on an active nav icon) |
   | `bg-primary/NN` tint on a non-voice surface (for example the chat `NoteCard` at `ChatMessage.tsx:123-163`, or the AI CTA in `HistoryView.tsx:96`) | `bg-foreground/5` with `border-border` |
   | `bg-primary` on a voice control | `bg-live` |
   | `amber-NNN` | `warning` |
   | `providerDisplayName(…)` in a component | `providerDisplayLabel(providerId, t)` from `src/lib/locality.ts` |
   | `GRADIENT_CIRCLE` or `BRAND_GLASS_SURFACE` on a non-voice surface | a neutral surface (`bg-foreground/8` or `bg-surface-3`), or `Button variant="secondary"` |
   | default `<Button>` whose first child is an icon | `variant="live"` if it records, starts the mic or stops voice; otherwise `variant="secondary"` (or `"outline"` when it sits beside a secondary) |

   Two known icon-plus-dot cases in scope:
   - `NoteEditor.tsx:1009`, "Generate Summary" (`AlignLeft` icon), becomes `variant="secondary"`, with the icon in `text-ai`, because it asks a model to write.
   - `NoteEditor.tsx:~945`, "Start recording" (`Mic` icon), becomes `variant="live"`.

   Outside scope: `OnboardingFlow.tsx:440` is Plan 05's, and `PromptStudio.tsx:400` and `:541` (Settings) are Plan 03's. Do not change them here; the PR body lists them.

   The guard covers every `src/components/chat/*.tsx`, the bubble branch included. Task 20 left the bubble layout alone; changing its classes to tokens here is intended, and its shape and spacing stay the same.

   Judgement calls the mapping does not settle:
   - **kbd versus readable text.** `kbd`, count badges and the `uppercase` discarded badge (`TranscriptionItem.tsx:266-278`) are `text-micro`. Everything a person reads as a sentence or a label is `text-caption` or larger.
   - **`ControlPanelSidebar` section labels** (WS-35) are now `text-caption font-semibold text-muted-foreground`, from Task 9. If any `uppercase` 10px label is left, it becomes `text-micro` at full colour.
   - **`AI` sparkle tiles** (WS-31) use `text-ai` on `bg-ai/12` with a 1px `border-ai/30`, in every place the guard flags them. The orange sparkle at `HistoryView.tsx:109` is one of them.

   If a line genuinely needs a flagged class (for example a translucent decorative stroke that carries no meaning), keep it and add `{/* token-guard: allow <rule-id> — <reason> */}` on the same line. Use this rarely; the PR body lists every opt-out.
4. In `DESIGN.md` under `### Do:`, add:

   ```markdown
   - **Do** use the UI ramp utilities (`text-micro` through `text-display`) in workspace components. Arbitrary `text-[Npx]` sizes fail `workspaceTokenAdoption.test.js`; Tailwind's standard sizes (`text-sm`, `text-xs`) are not flagged and migrate to the ramp when a file is touched.
   - **Do** show metadata at full `text-muted-foreground`; hierarchy comes from size and weight, not opacity.
   ```

   Under `### Don't:`, add:

   ```markdown
   - **Don't** fill non-voice surfaces with orange or tint them with `primary`; orange means live voice (D1). Notes, chips and CTAs are ink or neutral.
   - **Don't** use text glyphs (⊘, ✕) as status icons; use the Lucide icon with a token colour and a word.
   - **Don't** put a leading icon on a default (ink) Button; its brand dot already leads. Icon buttons are `live` (voice) or `secondary`/`outline`.
   - **Don't** show `providerDisplayName` output in the UI; name providers with `providerDisplayLabel(providerId, t)` so custom endpoints and unknown providers are localised.
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/dataRetentionNotice.test.js test/components/workspaceTokenAdoption.test.js test/components/colorRoles.test.js test/components/workspaceTypeRamp.test.js && npm run typecheck && npm run lint`
Expected: PASS. The guard reports `[]`.

- [ ] **Step 5: Commit**

```bash
git add src/components DESIGN.md test/components/dataRetentionNotice.test.js test/components/workspaceTokenAdoption.test.js test/helpers/workspaceTokenGuard.js
git commit -m "fix(ui): adopt the type ramp and colour roles across the workspace"
```

---

### Task 26: Notes readiness handoff

This covers WS-Q7's remote half and the §5.1 "Notes readiness" handoff (Plan 02 CCR 6). Plan 06 owns it because it rewrites the Notes surface. Plan 02 Task 14 shipped a temporary `useNoteActionsReady(): boolean | null` that knows local and self-hosted readiness only, and reports remote providers as unknown, so a remote provider with no saved key gets no hint. This task replaces it with the resolved `noteFormatting` route, which knows every case.

**Files:**
- Create: `src/components/notes/notesActionsHint.ts` (pure), `src/components/notes/NotesActionsHint.tsx` (presentational)
- Delete: `src/hooks/useNoteActionsReady.ts` and `src/utils/noteActionsReadiness.ts` (Plan 02 Task 14's temporary readiness)
- Modify: `src/components/notes/shared.ts`. Remove `shouldShowActionsModelHint`; keep `NOTES_ACTIONS_MODEL_HINT_KEY`.
- Modify: `src/components/notes/PersonalNotesView.tsx`. Swap the hint row Task 9 moved for `<NotesActionsHint>`, drop `useNoteActionsReady`, and disable the `ActionPicker` when the route is `off`.
- Modify: `test/components/notesActionsGate.test.js` (Plan 02's). Remove the tests of the deleted modules; the new test file replaces them.
- Modify: `src/locales/*/translation.json`
- Test: `test/components/notesActionsHint.test.js`

**Interfaces:**
- Consumes `useResolvedRoute("noteFormatting")` (the `noteRoute` Task 15 declared in `PersonalNotesView`), `RouteState` and `ResolvedRoute` (§5.1), `providerDisplayLabel` (Plan 01), `makeRoute` from `test/lib/routeFixtures.js` (Plan 03), and Plan 02 Task 14's `NOTES_ACTIONS_MODEL_HINT_KEY`, `modelHintDismissed`, `dismissModelHint`, `openActions` and the `notes.actionsModelHint.title`/`.choose` strings.
- Produces:

  ```ts
  // notesActionsHint.ts
  export interface NotesActionsHintCopy { titleKey: string; actionKey: string }
  export function notesActionsHint(state: RouteState, dismissed: boolean): NotesActionsHintCopy | null;
  export function notesActionsDisabledByRoute(state: RouteState): boolean; // true only for "off"

  // NotesActionsHint.tsx
  export function NotesActionsHint(props: {
    route: Pick<ResolvedRoute, "state" | "providerId" | "settingsPath">;
    dismissed: boolean;
    onOpenSettings?: (settingsPath: string) => void;
    onDismiss: () => void;
    className?: string;
  }): JSX.Element | null;
  ```

The mapping is the spec's (§5.1 Handoffs):

| Route state | Hint | Action (always `onOpenSettings(route.settingsPath)`) |
|---|---|---|
| `ready` | none | — |
| `unknown` | none yet | — |
| `off` | none; the `ActionPicker` is disabled | — |
| `needsModel` | "Actions need an AI model" (Plan 02's `title`) | "Choose a model" (Plan 02's `choose`) |
| `needsKey`, provider `""` | "Actions need an AI provider" | "Choose a provider" |
| `needsKey` | "Actions need an API key for {{provider}}" | "Add the key" |
| `needsUrl` | "Actions need your server's address" | "Add the address" |
| `unreachable`, detail `sealed` | "Actions are paused while Sealed mode is on" | "Open Settings" |
| `unreachable`, any other detail | "Actions can't reach the notes model" | "Open Settings" |

The provider name is `providerDisplayLabel(route.providerId, t)`, never the `needsKey.provider` string and never `providerDisplayName`. Sealed state reaches this task only through the route (§5.1 rule 7); nothing here reads `sealedStore`. The hint explains what to fix; the route itself is disclosed where it is used (the slash menu's reasons, Task 15).

- [ ] **Step 1: Write the failing tests**

Create `test/components/notesActionsHint.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { renderStatic } = require("../helpers/harness/reactSsr");
const { makeRoute } = require("../lib/routeFixtures");

const root = path.join(__dirname, "../..");
const loadPure = () => import("../../src/components/notes/notesActionsHint.ts");
async function loadView() {
  if (!i18next.isInitialized) {
    const en = JSON.parse(fs.readFileSync(path.join(root, "src/locales/en/translation.json"), "utf8"));
    await i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  }
  return import("../../src/components/notes/NotesActionsHint.tsx");
}
const noteRoute = (over = {}) => makeRoute({ id: "noteFormatting", ...over });
const K = "notes.actionsModelHint";

test("every route state maps to the spec's hint (§5.1 Notes readiness)", async () => {
  const { notesActionsHint } = await loadPure();
  assert.equal(notesActionsHint({ status: "ready" }, false), null, "ready shows no hint");
  assert.equal(notesActionsHint({ status: "unknown" }, false), null, "unknown shows nothing yet");
  assert.equal(notesActionsHint({ status: "off" }, false), null, "off disables Actions instead");
  assert.deepEqual(notesActionsHint({ status: "needsModel", sizeBytes: 1 }, false), { titleKey: `${K}.title`, actionKey: `${K}.choose` });
  assert.deepEqual(notesActionsHint({ status: "needsKey", provider: "openai" }, false), { titleKey: `${K}.needsKey`, actionKey: `${K}.addKey` });
  assert.deepEqual(notesActionsHint({ status: "needsKey", provider: "" }, false), { titleKey: `${K}.needsProvider`, actionKey: `${K}.chooseProvider` });
  assert.deepEqual(notesActionsHint({ status: "needsUrl" }, false), { titleKey: `${K}.needsUrl`, actionKey: `${K}.addUrl` });
  assert.deepEqual(notesActionsHint({ status: "unreachable", detail: "sealed" }, false), { titleKey: `${K}.sealed`, actionKey: `${K}.openSettings` });
  for (const detail of ["retired", "unsupported", undefined]) {
    assert.deepEqual(notesActionsHint({ status: "unreachable", detail }, false), { titleKey: `${K}.unreachable`, actionKey: `${K}.openSettings` });
  }
});

test("a dismissed hint stays dismissed, under Plan 02's key", async () => {
  const { notesActionsHint } = await loadPure();
  const { NOTES_ACTIONS_MODEL_HINT_KEY } = await import("../../src/components/notes/shared.ts");
  assert.equal(NOTES_ACTIONS_MODEL_HINT_KEY, "notesActionsModelHintDismissed");
  assert.equal(notesActionsHint({ status: "needsKey", provider: "openai" }, true), null);
});

test("only off disables Actions", async () => {
  const { notesActionsDisabledByRoute } = await loadPure();
  assert.equal(notesActionsDisabledByRoute({ status: "off" }), true);
  for (const state of [{ status: "ready" }, { status: "unknown" }, { status: "needsModel" }, { status: "needsKey", provider: "" }, { status: "needsUrl" }, { status: "unreachable", detail: "sealed" }]) {
    assert.equal(notesActionsDisabledByRoute(state), false, JSON.stringify(state));
  }
});

test("a remote provider with no saved key gets the hint, named and linked to its own settings", async () => {
  const { NotesActionsHint } = await loadView();
  const route = noteRoute({
    locality: "remote",
    provider: "OpenAI",
    providerId: "openai",
    model: "gpt-5.6",
    state: { status: "needsKey", provider: "openai" },
  });
  const html = renderStatic(NotesActionsHint, { route, dismissed: false, onOpenSettings: () => {}, onDismiss: () => {} });
  assert.match(html, /role="note"/);
  assert.match(html, /data-route-state="needsKey"/);
  assert.match(html, /Actions need an API key for OpenAI/);
  assert.match(html, />Add the key</);
  assert.ok(html.includes(`data-settings-path="${route.settingsPath}"`), "the action opens the route's own settings path");
  assert.doesNotMatch(html, /ring-(?:ring|primary)\/\d+/);
});

test("ready, unknown and off render nothing", async () => {
  const { NotesActionsHint } = await loadView();
  for (const state of [{ status: "ready" }, { status: "unknown" }, { status: "off" }]) {
    const html = renderStatic(NotesActionsHint, { route: noteRoute({ state }), dismissed: false, onOpenSettings: () => {}, onDismiss: () => {} });
    assert.equal(html, "", JSON.stringify(state));
  }
});

test("PersonalNotesView reads the route, not Plan 02's temporary hook", () => {
  const view = fs.readFileSync(path.join(root, "src/components/notes/PersonalNotesView.tsx"), "utf8");
  assert.doesNotMatch(view, /useNoteActionsReady|shouldShowActionsModelHint/);
  assert.doesNotMatch(view, /onOpenSettings\("intelligence"\)/, "the action uses the route's settingsPath");
  assert.match(view, /<NotesActionsHint\b[\s\S]*?route=\{noteRoute\}/);
  assert.match(view, /notesActionsDisabledByRoute\(noteRoute\.state\)/);
  assert.match(view, /localStorage\.setItem\(NOTES_ACTIONS_MODEL_HINT_KEY, "true"\)/);
  assert.equal(fs.existsSync(path.join(root, "src/hooks/useNoteActionsReady.ts")), false);
  assert.equal(fs.existsSync(path.join(root, "src/utils/noteActionsReadiness.ts")), false);
});
```

In Plan 02's `test/components/notesActionsGate.test.js`, delete the tests "a fresh profile's default local model is selected but not ready", "self-hosted needs a URL; an empty model is never ready; remote is unknown", "the hint shows only when Actions cannot run, and until dismissed" and "the hint links to model settings and can be dismissed", and the now-unused `load` and `loadReadiness` helpers. Keep "notes render without passing through the Actions first run" and "Actions opens the first run once, then the manager, from any view" unchanged; Tasks 9 and 15 keep them passing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/notesActionsHint.test.js test/components/notesActionsGate.test.js`
Expected: FAIL. `notesActionsHint.ts` and `NotesActionsHint.tsx` are missing, and `PersonalNotesView` still calls `useNoteActionsReady`. The two kept Plan 02 tests pass.

- [ ] **Step 3: Implement**

1. Check for other users first: `grep -rn "useNoteActionsReady\|noteActionsReadiness\|shouldShowActionsModelHint" src test`. Expect only `PersonalNotesView.tsx`, `shared.ts`, the two Plan 02 modules and `notesActionsGate.test.js`. If anything else uses them, stop and report it rather than deleting.

2. Create `src/components/notes/notesActionsHint.ts`:

   ```ts
   import type { RouteState } from "../../lib/routes";

   export interface NotesActionsHintCopy {
     titleKey: string;
     actionKey: string;
   }

   const K = "notes.actionsModelHint";

   // §5.1 Notes readiness (Plan 02 CCR 6): ready shows nothing, unknown shows
   // nothing yet, off disables Actions instead of nagging, and every other
   // state names its fix. Every action opens the route's own settingsPath.
   export function notesActionsHint(state: RouteState, dismissed: boolean): NotesActionsHintCopy | null {
     if (dismissed) return null;
     if (state.status === "ready" || state.status === "unknown" || state.status === "off") return null;
     if (state.status === "needsModel") return { titleKey: `${K}.title`, actionKey: `${K}.choose` };
     if (state.status === "needsKey") {
       return state.provider === ""
         ? { titleKey: `${K}.needsProvider`, actionKey: `${K}.chooseProvider` }
         : { titleKey: `${K}.needsKey`, actionKey: `${K}.addKey` };
     }
     if (state.status === "needsUrl") return { titleKey: `${K}.needsUrl`, actionKey: `${K}.addUrl` };
     return state.detail === "sealed"
       ? { titleKey: `${K}.sealed`, actionKey: `${K}.openSettings` }
       : { titleKey: `${K}.unreachable`, actionKey: `${K}.openSettings` };
   }

   export function notesActionsDisabledByRoute(state: RouteState): boolean {
     return state.status === "off";
   }
   ```

3. Create `src/components/notes/NotesActionsHint.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { X } from "../icons";
   import { cn } from "../lib/utils";
   import { providerDisplayLabel } from "../../lib/locality";
   import type { ResolvedRoute } from "../../lib/routes";
   import { notesActionsHint } from "./notesActionsHint";

   export function NotesActionsHint({
     route,
     dismissed,
     onOpenSettings,
     onDismiss,
     className,
   }: {
     route: Pick<ResolvedRoute, "state" | "providerId" | "settingsPath">;
     dismissed: boolean;
     onOpenSettings?: (settingsPath: string) => void;
     onDismiss: () => void;
     className?: string;
   }) {
     const { t } = useTranslation();
     const hint = notesActionsHint(route.state, dismissed);
     if (!hint) return null;
     const provider = providerDisplayLabel(route.providerId, t);
     return (
       <div
         role="note"
         data-route-state={route.state.status}
         className={cn("rounded-md border border-border bg-muted/40 px-3 py-2 text-caption text-muted-foreground", className)}
       >
         <div className="flex items-start gap-2">
           <span className="flex-1 text-foreground">{t(hint.titleKey, { provider })}</span>
           <button
             type="button"
             onClick={onDismiss}
             aria-label={t("common.close")}
             className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
           >
             <X size={12} aria-hidden="true" />
           </button>
         </div>
         {onOpenSettings && (
           <button
             type="button"
             data-settings-path={route.settingsPath}
             onClick={() => onOpenSettings(route.settingsPath)}
             className="mt-0.5 rounded-sm text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
           >
             {t(hint.actionKey)}
           </button>
         )}
       </div>
     );
   }
   ```

4. In `src/components/notes/shared.ts`, delete `shouldShowActionsModelHint` and its comment. Keep `NOTES_ACTIONS_MODEL_HINT_KEY`.

5. In `src/components/notes/PersonalNotesView.tsx`:
   - Remove `import { useNoteActionsReady } from "../../hooks/useNoteActionsReady";` and `const noteActionsReady = useNoteActionsReady();`.
   - Change the `./shared` import to drop `shouldShowActionsModelHint`, and add `import { NotesActionsHint } from "./NotesActionsHint";` and `import { notesActionsDisabledByRoute } from "./notesActionsHint";`.
   - Replace the hint block Task 9 moved to the top of the editor column (its `<div className="px-3 pt-2">` wrapper included) with:

     ```tsx
     <NotesActionsHint
       className="mx-3 mt-2"
       route={noteRoute}
       dismissed={modelHintDismissed}
       onOpenSettings={onOpenSettings}
       onDismiss={dismissModelHint}
     />
     ```

   - In the `ActionPicker`'s `disabled` expression, add `|| notesActionsDisabledByRoute(noteRoute.state)` as the last operand.
   - Keep `modelHintDismissed`, `dismissModelHint`, `openActions`, `finishActionsIntro` and both dialogs as they are.

6. Delete `src/hooks/useNoteActionsReady.ts` and `src/utils/noteActionsReadiness.ts`.

7. Add strings (Task 1 helper, `--strict`). Plan 02's `notes.actionsModelHint.title` and `.choose` stay. English block:

   ```json
   {
     "notes": {
       "actionsModelHint": {
         "needsProvider": "Actions need an AI provider",
         "chooseProvider": "Choose a provider",
         "needsKey": "Actions need an API key for {{provider}}",
         "addKey": "Add the key",
         "needsUrl": "Actions need your server's address",
         "addUrl": "Add the address",
         "sealed": "Actions are paused while Sealed mode is on",
         "unreachable": "Actions can't reach the notes model",
         "openSettings": "Open Settings"
       }
     }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/notesActionsHint.test.js test/components/notesActionsGate.test.js test/components/slashItems.test.js test/components/workspaceTokenAdoption.test.js test/locales/translationCoverage.test.js && npm run typecheck && npm run i18n:check`
Expected: PASS. The token guard still reports `[]`, because `PersonalNotesView.tsx` is in its scope.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/notes/notesActionsHint.ts src/components/notes/NotesActionsHint.tsx src/components/notes/shared.ts src/components/notes/PersonalNotesView.tsx src/hooks/useNoteActionsReady.ts src/utils/noteActionsReadiness.ts src/locales test/components/notesActionsHint.test.js test/components/notesActionsGate.test.js
git commit -m "feat(notes): Actions hint follows the resolved note-formatting route"
```

---

### Task 27: Whole-plan verification

**Files:** none new. This task runs every check and fixes what they surface.

- [ ] **Step 1: Run the full suite and static checks**

```bash
npm run native:node
npm test
npm run lint
npm run typecheck
npm run i18n:check
npm run format:check
```

Expected: everything passes. A pre-existing test may fail by asserting an old behaviour this plan intentionally changed:
- the `NewNoteMenu` keys;
- `md:block` on Coming up;
- `opacity-0` row actions;
- the `07:51` time format;
- the chat `⌘N`;
- the Notes second column;
- `buildRAGContext` in `useChatStreaming`.

Update such a test only when the old value is exactly what this plan changed, and list it in the PR body. Any other failure is a regression; fix the code.

- [ ] **Step 2: Visual verification in the desktop app (light and Plum Night, 1280×800, 1024×768, 820×640)**

```bash
npm run native:electron
npm run dev
```

Check each item, and screenshot it for the PR:
- **Sidebar.**
  - At 1280 it is 232px with Home, Notes, Chat, then Spaces, Recent and Voice, and the mic card in the footer.
  - At 1024 it is a 56px rail; ⌘\ expands it and collapses it again.
  - Meeting mode hides it.
  - Tree clicks from Home open the note.
- **Capture.**
  - Idle is neutral, showing the last action.
  - Hold the dictation hotkey: the Capture segment turns live orange with bars and `Listening 0:07`, the mic card and the Ready strip say Listening, and the sidebar edge rail breathes.
  - Release: Cleaning up…, then Ready.
  - Revoke mic permission in System Settings, then focus the app: Mic offline, with the reason.
  - Turn on Reduce motion: no travelling band, static rail, and the words are still visible.
- **Home at 820px.** No 160px column. The next meeting sits in the strip with Take notes. At 1280 the Coming up column returns, and the next event's Take notes is visible without hovering.
- **Home list.**
  - Chips and counts work, and `/` focuses the filter.
  - Five dictations within five minutes fold into a session, which expands in place.
  - The History `…` menu toggles discarded rows and opens Clear all (with a confirm).
  - Clicking a row's text copies it; selecting text does not.
- **⌘K.**
  - An empty query shows Suggested and Recent.
  - Typing `meet` orders Commands first, with highlighted matches.
  - Selecting a transcript lands on Home, scrolled, with a 1.2s ring, even when a chip was hiding it.
  - `what did we decide`, then Ask, opens Chat with the draft in the composer and **not sent**.
- **Notes.**
  - `/` opens the menu. H2 works. An AI action runs, or is disabled with "Actions need an AI model".
  - Select text: the bubble shows B/I/Link/Ask AI. `javascript:alert(1)` is refused. Ask AI fills the ask bar and does not send.
  - `@pri` shows grouped results. Insert a meeting, then hover: the card with Insert quote. Click: it opens the meeting.
  - Export as Markdown: the mention reads `[@Pricing review](meeting:38)`.
- **Chat.**
  - The model chip shows the ring, model and "Local", or the provider.
  - Ask about something in your notes: the answer is unbubbled with superscript citations and a Sources row, the Activity in the rail lists the searches, and `⌘.` toggles the rail.
  - `@` in the composer pins a note, and the next answer uses it.
  - Switch the chat model in Settings: old answers keep their original route tag.
- **Insights.** At 820 and 1280 the heatmap fills its card without overlap. The Dictations tile opens Home filtered.
- **Upload** with no transcription model: the disabled drop zone, the "Choose a transcription model" link, and no speaker toggle.
- **Plan 01 review items.**
  - The Coming up "Today" strip is neutral and says "Today", in both themes.
  - "Generate Summary" is a secondary button, with no brand dot beside its icon.
  - A chat model on a custom endpoint shows "Custom endpoint" (translated in `de`), never `custom`.
- **Review fixes that need a real window** (no harness can prove these):
  - **URL field typing.** Select text, open Link in the bubble, click into the URL field and type a long URL: every character lands in the field, the selection stays highlighted and the document never takes focus. Click a bubble button: the selection survives.
  - **Hover card.** Hover a mention chip, move slowly across the gap into the card: it stays open. Tab from the chip into Open and Insert quote, then Tab out: it closes. Escape returns focus to the chip. Repeat in `ar` (RTL): the card opens on the correct side and the gap still holds.
  - **Ask AI.** With the floating chat closed and a draft queued in it earlier, select text and Ask AI: the floating chat opens, the quote is in a visible composer, nothing is sent, and the queue is not armed.
  - **Meeting route on the mic card.** Configure dictation local and meeting transcription remote (or the reverse). Start a meeting recording: the mic card and the rail name the meeting route and its locality, not the dictation route. Start a dictation: the card switches to the dictation route.
  - **Notes Actions hint (Task 26).** With notes formatting on a remote provider and no saved key, Notes shows "Actions need an API key for OpenAI", and Add the key opens Settings at that route's page. While the route is still being checked after launch, nothing shows. Turn notes formatting off: the Actions picker is disabled and no hint shows. Dismiss the hint and relaunch: it stays dismissed.
  - **Unknown is neutral.** Right after launch, before main confirms the routes, the chat chip and the mic card show Plan 03's "Checking…" state, never a ready look and never a "needs setup" warning.
  - **Stop during pinned context.** Pin a large note, send, and press Stop at once: no request reaches the provider (watch the network log or the provider's dashboard), and the draft is not lost.
- **Theme toggle mid-session.** No smear (Plan 01), and every changed surface reads at contrast in Plum Night.
- **RTL** (`ar`): the sidebar rail, the edge rail, breadcrumb separators and the kbd hints mirror correctly.

- [ ] **Step 3: Commit any fixes, then open the PR (owner approval first)**

```bash
git push -u origin HEAD
gh pr create --title "feat(workspace): Loqui workspace — one sidebar, Capture, Home, palette, notes editor, chat" --body-file pr-body.md
```

`pr-body.md` contains:
- one line per Task 1–26 commit;
- links to `docs/superpowers/specs/2026-10-15-loqui-uiux-overhaul.md` and this plan;
- the Step 2 screenshots;
- the contract change requests CR-06-1…8, each applied in spec 091d198 (§3, the §5 Plan 01 table, §5.1, §5.7–§5.10), and any spec change since;
- the Review response table, with any review finding whose fix changed during execution;
- every `token-guard: allow` opt-out, with its reason;
- the interpretations this plan committed to;
- the one-condition change in Plan 04's `useAudioRecording.js` (Task 5);
- the Plan 01 review hand-backs not done here:
  - the icon-plus-dot Buttons in `OnboardingFlow.tsx:440` (Plan 05) and `PromptStudio.tsx:400`/`:541` (Plan 03);
  - the CTA hover state in `button.tsx` (Plan 01; interpretation 16);
- any pre-existing test assertions that were intentionally updated (Step 1).

Get the owner's explicit OK before pushing; publishing a PR is outward-facing.
