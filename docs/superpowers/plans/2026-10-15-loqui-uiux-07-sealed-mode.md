# Loqui UI/UX Plan 07: Sealed Mode and Data Flight Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two things:
- **Sealed mode** (SET-R6 C), a master switch that Electron main enforces. While it is on, nothing that Loqui's main process, its windows or the programs it starts send leaves this computer, and local routes keep working.
- **Data flight recorder** (SET-M3), a metadata-only ledger of every request that did leave: when, which task, which hosts, how many bytes, and the outcome.

**Architecture:** Enforcement lives in main and has two layers, plus a guard on every process Loqui starts.

- **Layer A, the egress gate** (`src/helpers/privacy/egressGate.js`). Every known request site asks it for a *ticket* before sending. While sealed, a non-loopback ticket is refused with a typed `SealedModeError`. The refusal is recorded with 0 bytes sent, and the caller keeps the user's content. Tickets carry the task, so the ledger knows why each request happened. They emit `dispatched`, `delivered` and `undelivered` notices, which say whether a provider may have, or did, receive content.
- **Layer B, the transport backstop** (`src/helpers/privacy/egressBackstop.js`). It catches anything Layer A missed:
  - On the Node side it hooks `net.Socket.prototype.connect`, with `localhost` and `*.localhost` pinned to loopback. That covers `http`, `https`, undici `fetch`, `ws` and the provider SDKs.
  - It also hooks every DNS API, UDP, and loopback-proxy forwarding.
  - On the Chromium side it owns `webRequest` on every Electron session. That covers `net.fetch`, `net.request`, `electron-updater` and renderer loads. It tracks each Chromium request until it ends, and checks every redirect hop.
  - While sealed, Layer B denies every non-loopback connection. While unsealed, it reports connections that no ticket explains, which surface as "unexplained" in the ledger.
- **The spawn guard and child registry** (`src/helpers/privacy/childRegistry.js`).
  - Every `child_process` spawn and `utilityProcess.fork` is classified. While sealed, only allowlisted programs start (Loqui's own binaries and known sidecars with launch rules, named system tools with argument rules); network programs (Codex, yt-dlp, `curl`, …), spawns from third-party code and anything unclassified are refused.
  - Running on-device model servers are not inspected; the attestation names them (CCR-6). The ONNX worker locks its own network at startup.
  - FFmpeg always runs with local inputs only.
  - A child counts as stopped only when the OS reports its exit. Codex and yt-dlp runs are recorded as *opaque sessions*, because main cannot see their individual requests (owner decision, 2026-10-15).

Sealing passes through a main-owned barrier. The phase is `"sealing"` until every remote ticket, socket, in-flight Chromium request, pending DNS lookup and network-capable child has stopped. Only then is it `"sealed"`, with a verified `effectiveSince`. A failure to stop anything stays unresolved and keeps the seal unverified. Evidence is never cleared to make a check pass. Main *attests* this with a versioned `Attestation`, and the UI shows its verified line only when `attestation.nothingLeaves === true` and the attestation is fresh.

The renderers sit inside the boundary:
- The control panel is sandboxed, with web security on (owner decision, 2026-10-15).
- WebRTC is removed from every page.
- Remote images render as placeholders while sealed.

What is outside the boundary is disabled or disclosed:
- Opening a link in the browser asks first, in a main-owned dialog.
- A calendar sign-in still waiting in the browser is cancelled.

Turning Sealed mode off and clearing the ledger are also confirmed in native dialogs owned by main, which a compromised renderer cannot answer.

**Tech Stack:**
- Electron 44 main process (CommonJS) with Node 24 `node:async_hooks` (`AsyncLocalStorage`), `node:net`, `node:dns` and the Electron `session.webRequest` API.
- better-sqlite3 13 for the ledger table.
- React 19 and TypeScript for the settings panels.
- Node `node:test`, with `tsx` for TypeScript and `react-dom/server` via `test/helpers/harness/reactSsr.js`.
- Playwright's Electron driver for the sealed acceptance run (Task 16).

**Spec:** `docs/superpowers/specs/2026-10-15-loqui-uiux-overhaul.md`: decision D6, the Plan 07 row in §3, the global constraints in §4, and contracts §5.1–§5.4. Visual reference: `design-explorations/loqui-uiux-review.html#set-r6` (variant C) and `#set-m3`. Research: `.omc/research/ui-review/audit-settings.md` §R6, §M3, SET-08, SET-09, SET-21 and SET-25.

**Prerequisites (execution order, not facts about this checkout).** This branch was planned against `0639eaf`. The plans below must be merged into it before the task that names them starts. If one is missing, stop and report; do not recreate its files.
- **Plan 01**, before Task 7. Provides `src/utils/contrast.ts`, `test/helpers/harness/cssTokens.js`, `src/lib/locality.ts` (`isLoopbackUrl`, `resolveLocality`) and the `--motion-*` tokens.
- **Plan 03** (v2, PR #50), before Task 11a. Provides `src/lib/routes.ts` (`buildRouteSnapshot(settings, facts, copy, sealed)`, `currentRouteCopy`, `routeSnapshotFromSettings`, `resolveRoute`, `isSealedLocality`), `src/stores/sealedStore.ts` (which Task 13 migrates), `src/stores/routeFactsStore.ts`, `src/helpers/selfHostedProbe.js`, `test/lib/routeStateFixture.js`, and the optional `privacy?` declaration that Task 7 replaces.
- **Execution order** (spec §3, 091d198): 01 → 02 → 03 → {04, 05, 06, 07}. This plan is rebased onto 03 before it starts.
- **Plan 04** is **not** required. CCR-3 and CCR-4 are its side of the contract. Until it merges, Plan 07 uses the existing toast API (spec §5.3).

---

## Review response

This revision answers the independent security review of snapshot `18c0b4c…` (`.omc/research/ui-review/reviews/plan-07-codex.md`: 3 Critical, 10 Important, 1 Minor). Every finding is resolved. None is disputed. "At `0bbb0e5`" means the commit that followed the review handoff already closed it. "This revision" means commits `84ddab1` to the present. The review numbers Important findings I1 and I3–I11; there is no I2.

| Finding | Status | Where it is closed, and how |
|---|---|---|
| **C1** yt-dlp self-update reported stopped before exit | Closed, this revision | Task 6a: `childRegistry` marks a child alive until the OS reports `exit`, and a detached group until the group is gone. `stopAll` sends SIGTERM, then SIGKILL, then rejects with `CHILD_STOP_FAILED` if anything survives. Process trees are tracked on every platform: a detached POSIX group until the group is gone, or a tree until every descendant listed at stop has exited. Windows has no groups, and its `taskkill /T` is a signal, not an exit. A tree whose descendants cannot be listed is never reported stopped. Task 10 spawns the self-update detached on POSIX too, so every yt-dlp process is a process group there, and a tree on Windows, whose descendant list is refreshed while the root runs (the remaining Windows-only window is stated in Task 1's Boundary). It registers both, and settles their opaque sessions on `exit` only. It tests the timeout, spawn-failure and seal paths. `ytDlpControl` reads the registry, not a flag. Task 7 records `childStop`, which blocks attestation until the child is really gone. Tests: `stopAll rejects when a child survives SIGKILL, and it stays alive`, `a kill that throws leaves the child alive, and stopAll rejects`, `a process tree stays alive until every descendant listed at stop has exited`, `a tree helper started while the root runs is waited for after the root exits`, `a tree whose descendants cannot be listed is never reported stopped` (6a), `a self-update that times out is still running until it exits, and is recorded then` (10), `a child that will not exit keeps the seal unverified until it really exits` (7), and the yt-dlp test in Task 10, which asserts the process is still alive after SIGKILL and that the row appears only after exit. |
| **C2** universal egress claim exceeds the boundary | Closed, this revision. The guarantee is bounded and enforced; the exceptions are disabled or disclosed. | Task 1 states the promise as covering Loqui's main process, Chromium sessions and renderers, and the children Loqui starts. A **Boundary** section lists each outside path and how it is treated. FFmpeg is contained with a protocol whitelist and adversarial fixtures (6a, N24). Every spawn site is inventoried and ratcheted (`spawn-sites`), and the guard refuses network and third-party spawns while sealed (6a). The ratchet now matches imports, so aliases such as `mod.request`, renderer roots and `.tsx`/`.jsx`/`.mjs` files are caught. WebRTC is removed from every renderer (7a). Remote images are inert (13). Pending DNS is counted (6, 7). Preconnect and dns-prefetch are probed in Electron against a connection-logging fixture (16). Browser links need main's confirmation (11). Pending OAuth flows are cancelled (11). Loopback forwarders are a named trust boundary (Task 1). Native helpers that Loqui starts are outside what JavaScript can inspect, so this is disclosed rather than claimed. The panel always shows a scope line while sealed (`settingsPage.privacy.sealed.scope`, Task 14), `docs/PRIVACY.md` names the limit (Task 15), and Task 17 checks each sidecar's sockets with `lsof`. The ratchet scans all of `src/`. |
| **C3** attestation after failed Chromium shutdown | Closed, this revision | Task 6 removes the last-resort `closeAllConnections` reset entirely (`there is no API that resets every Chromium connection`). A Chromium request is tracked until `onCompleted`/`onErrorOccurred`; a destroyed `webContents` does not clear it. `severAll()` no longer clears the socket count: each socket leaves it on its own `close`. Nothing clears evidence to pass a check (`chromium: remote requests are tracked in flight until they end; a destroyed webContents does not clear them`, and the `severAll` test). Task 7: failures (`codexStop`, `childStop`, `timeout:<what>`) are unresolved until the thing named has stopped, and `nothingLeaves` requires an empty `failures` list. Tests: `an un-ticketed Chromium request in flight keeps it sealing; nothing is reset or cleared`, `mid-transition attestations are never verified`, `a quick seal, unseal, seal ends sealed and verified, in order`. |
| **I1** tests bypass production wiring | Closed, this revision | Task 12 drives the real `ipcHandlers.js` and `personal-inference:*` handlers. N18 uses the production `createCodexServer` factory, which ignores test-supplied hooks. N20 executes the calendar guard that `main.js` uses, plus a routing ratchet. N10 goes through the realtime start handler. It adds download-manager IPC rows (`model-download`, `download-whisper-model`, `llama-cpp-install`), and discovers the realtime, proxy and download channels instead of listing them. A **bypass-sensitivity** pass reruns every row with Layer A bypassed: the row must reach a transport or a Layer B refusal. A regression drill deletes two production gates and requires their rows to fail. Task 16 runs the real Electron app against an independent fixture that logs requests and raw connections, with a control run proving each probe is seen. It has no offline blockers of its own, and its leak-injection drill must fail. The smoke-script `every(...)` check, which passed on an empty list, is dropped (17). |
| **I3** host-wide attribution, one-row settlement | Closed, this revision | Task 4 stores a host trail (`hosts`, up to 8), start and end times, and an opaque flag; the `summary` separates `observed` requests from `opaqueSessions`. Task 5 attributes by async context and Electron request tag, never by "some ticket has this host" (`a same-host connection outside the ticket's context is still unexplained`). Task 6 tracks Chromium per request id, extends trails on every redirect hop (ticketed or not), and records unexplained Chromium requests at completion, with their status and full trail (`…recorded at completion with its status and redirect trail`). A redirect hop refused while sealed records the whole trail, including the allowed earlier hops (`chromium: a redirect into a refused host records the whole trail as blocked`). |
| **I4** CCR-3 vs the sent notice and Plan 04's receipt | Closed. The "started" wording was fixed at `0bbb0e5`; marking granularity and the contract were fixed in this revision. | Main emits `dispatched` (handed to the transport: "may have received"), `delivered` (a response arrived: "received") and `undelivered` (failed before connecting), with `ticketId`, `targetId` (Plan 04's target encoding), `payload` and `correlationId` (Tasks 5, 8, 9, 9a). Realtime marks only the instance that forwarded audio (`markRealtimeDispatched`), from the first frame. CCR-3 now states one shape that maps onto Plan 04's `RemoteDisclosure`. |
| **I5** UI ignores phase, time and attestation contracts | Closed: mostly at `0bbb0e5`, completed in this revision | At `0bbb0e5`: phase-aware matching (`[SEALED_MODE:interrupted]`), interrupted copy, an `onAttestation` subscription with version ordering, and the verified line dated from `effectiveSince`. In this revision: attestations older than 30 s drop to unknown and are re-fetched (13). Every unverified reason, and every note resolved before verification, is named (14). The recorder shows "Loading…" instead of 0 and "No recorded requests for this period" when empty, and never says that nothing left (15). |
| **I6** content preservation depends on Plan 04, fails mid-recording | Closed, this revision | Task 13 adds `src/lib/sealedRecovery.ts`. A dictation refused or interrupted while retention would discard it is held in renderer memory only (bounded, with a time limit), never on disk. The error toast and the unseal notice offer "Transcribe". Behaviour tests cover the retention combinations, the replay and the cleanup-after-local-STT fallback through the real `AudioManager`. An executed test shows that `startRecording` refuses before touching the microphone, and proceeds when the state is unknown. The pre-flight remains UX protection. CCR-4 asks Plan 04 to keep both. |
| **I7** last-resort reset cuts local routes | Closed, this revision | The reset is gone (C3). An un-ticketed remote request keeps the seal unverified, and is named, instead of cutting local work. Task 12: `a local request in flight survives sealing, while the remote one beside it is interrupted`. Task 9: `an in-flight loopback transcription survives sealing`. Task 12: `a loopback WebSocket (the Parakeet and sidecar path) stays open through sealing`. Task 16 checks loopback in Electron after the seal. Task 17 seals mid-workflow with real whisper-server, Parakeet, llama-server and Qdrant. |
| **I8** two sealed sources, ungated Plan 03 probe, loopback mismatch | Closed, this revision; retargeted to spec §5.4 (091d198) | There is one renderer authority, Plan 03's `src/stores/sealedStore.ts`. Task 13 replaces its internals with the attestation store and keeps Plan 03's API, so the route hooks, `routeSnapshotFromSettings`, the Apply bar and the Keyring all move with it. A ratchet test fails if any other renderer module reads sealed state from the privacy bridge. One cross-plan test sends one event from main and checks the store, the route snapshot, the resolver and the pre-flight together. Plan 03's own Apply-bar and Keyring tests pin those consumers to the store. `isSealedLocality` is the only rule; `applySealToRoute`/`isRouteSealed` are gone. Task 7 *replaces* Plan 03's optional `privacy?` declaration. Task 11a gates `probe-self-hosted` as `providerCheck` (loopback only, typed `code: "sealed"`), and makes `isLoopbackUrl` match main's rule through a shared case fixture. |
| **I9** re-enabling persistence writes history-off rows | Closed, this revision | Task 4 distinguishes `pending` (consent not loaded yet) from `memory` (history explicitly off). Only pending rows flush, inside a transaction, and they are kept in memory if the write fails (`persistError`). Tests: `history off from the first sync…`, `pending rows flush on the first sync; memory-only rows never become durable`, `a failed flush keeps the pending rows…`, `restart: saved rows survive; rows kept in memory while history was off do not`. The row cap is checked on insert. |
| **I10** opaque sessions shown as observed requests | Closed, this revision | Task 15 counts observed requests and helper sessions separately, labels an opaque row's host as "Usually …", and says its traffic is not visible. It adds a producer → IPC → view test with a normal and an interrupted session. The typed fixtures include `observed`. |
| **I11** trusted-sender URL throws in development | Closed, this revision | Task 7 branches on the dev server before touching the packaged path, and tests both real `DevServerManager` contracts (`appUrlPrefixes follows the real DevServerManager contracts in both modes`), plus main-frame vs subframe and navigated URLs. |
| **M1** source ranges and stale instructions | Closed, this revision | Prerequisites are stated as execution-order requirements (above). Task 7a anchors on the comment text (`:227-234`), and keeps `preload`/`nodeIntegration`/`contextIsolation`. `idx_analytics_date` is at `localDatabaseSchema.js:318`. The generic failure is at `providerConnectionTest.js:316-327`. `openExternalUrl` is at `:35` and `shell.openExternal` at `:69`. The answered open questions are removed. The metadata assessment's adversarial cases (URL-like model ids, provider error codes) are covered in Task 4 (`model ids and error classes are stripped of control characters and truncated`, `record rejects non-host values…`). |

---

## Round-2 review response

This answers Codex's second review (`.omc/research/ui-review/reviews/plan-07-codex-r2.md`, pinned at `e473639`): 3 Critical and 6 Important findings, with 8 round-1 findings confirmed closed. Every finding below is fixed in task steps *and* test code. One point is partly disputed, with evidence. One promise is narrowed and disclosed (CCR-6). Code anchors were rechecked against this worktree, and the spec is now `4980c81`.

| Finding | Status | What changed, and the test that proves it |
|---|---|---|
| **C2-R2** DNS gaps; native and renderer boundary | Fixed; one promise narrowed (CCR-6) | **DNS (Task 6):** every entry point in `node:dns`, `node:dns/promises` and both `Resolver` prototypes goes through one wrapper. That includes `lookupService` and `dns.promises.lookupService`, which was never wrapped. Sealed: refused before the native resolver, with localhost names and loopback literals answered locally. Open: counted from call to settle exactly once, including a synchronous throw. Tests: `every resolver query issued before the seal is counted until it ends (callback, promise, Resolver)` (a silent loopback DNS server, no packet leaves), `sealed: lookupService (callback and promise) never reaches the native resolver for a remote address`, and `every DNS entry point … is wrapped`, checked against the live module. **Children (Task 6a):** the `local` default is gone. While sealed, only allowlisted programs start: known sidecars by name with launch rules (llama-server download flags, non-loopback `--host`, Qdrant without `--disable-telemetry`); named OS tools with argument rules (`open -a` only, `sh -c "command -v x"` only, no `powershell`); and Loqui itself. Anything unclassified is refused (`sealed: only allowlisted programs start, and only with allowed arguments`). **ONNX worker:** a runtime lock, not a ratchet. It installs the Node backstop with the seal forced on, proved in a separate Node runtime (`the lock refuses the network inside a separate Node runtime, and keeps loopback`). **Renderer frames (Task 7a):** the preload runs in every frame and removes WebRTC in each, and only the main frame gets `electronAPI`; a CSP adds `frame-src 'none'` and `object-src 'none'`. Unit-tested for main frame and subframe; Task 16 checks `about:blank` and `srcdoc` in Electron. **Narrowed:** running local model servers are launch-checked but cannot be inspected, so they are reported as `uninspectedChildren`, named in the panel and in PRIVACY.md, and excluded from "verified" (CCR-6, Task 1 Promise). |
| **I6-R2** (Critical) streaming loses audio; replay drops the only copy | Fixed | **Streaming (Task 13):** a seal that arrives during a stream is recorded, from the sealed store or a sealed provider error. With no text, the real finalizer goes through `_preserveSealedStream`: a hold with history off, a failed History entry with history on, and a sealed notice, never an empty success. Test: `streaming sealed mid-dictation with no text (…)` drives the real `_finalizeStreamingRecording`, in both retention modes. **Replay:** claim and release instead of take. `transcribeRecovered` runs only when idle with no other replay (`busy` otherwise), keeps the hold on failure, cancellation or an empty result, never duplicates it on a sealed re-failure, and keeps the metadata (session and `private`). Tests drive the real `processAudio`, faking only the transcription transport: `replay: a transcript removes the hold`, `replay: a non-sealed failure keeps the only copy…`, `replay: refused while busy, and only one replay at a time`. |
| **N1** (Critical) free text in recorder rows | Fixed | **Recorder (Task 4):** `model` is stored only if it is an identifier (no `//`, no `user:secret@`, no key-shaped token, no query or whitespace); otherwise `null`. `errorClass` is one of `ERROR_CLASSES`, and the gate maps codes onto those categories. Test: `model ids and error classes are identifiers or nothing…` writes hostile values through SQLite and the CSV and asserts they are absent. The value sent to the provider is unchanged. |
| **I1-R2** suite not executable; drills not isolating | Fixed | **Task 12:** the Whisper manager is constructed lazily, after the Electron stub exists. No model factory is injected: the real AI SDK runs, and only global `fetch` is counted. The ratchet allows the preload's marked WebRTC-removal block and the acceptance script, and nothing else. The Codex rows assert `codexCalls === 0`, so deleting the handler gate fails its row even though a later guard still refuses. Each drill states what it proves. **Task 16:** the leak probes run right after the seal barrier, before any attestation wait, so the leak-injection drill reaches the independent observer. **Updater test:** see the dispute row below. |
| **I3-R2** operations counted as requests | Fixed | **Gate (Task 5):** the ticket is the operation, and each metered request is its own attempt and row, with its own host, bytes, status and notices (`attemptId`). A request delivered earlier is never withdrawn by a failed retry. Rows have a `kind`: request, stream, connection, session or operation. Pre-transport failures are `operation` rows, which are kept but never counted as having left. Unexplained Node sockets and SDK operations without a metered fetch are `connection` rows, labelled "requests not visible; listed when it closes". Chromium requests that carry a whole operation's tag (electron-updater) get one row each. Tests: `two requests in one operation are two rows; a failed retry never withdraws earlier delivery`, `an operation that fails before any transport is kept, but never counted…`, `an SDK operation that took no metered fetch is recorded as a connection…`, and Task 15's view test for connections and operations. |
| **I4-R2** session and target lost on speech paths | Fixed | `egress.withContext({ correlationId, provider })` (Task 5) wraps the whole BYOK provider dispatch (Task 9). So the Corti, Gemini and Tinfoil helpers announce the session id and the canonical target without new parameters, and both multipart calls pass `provider` explicitly. Tests: `withContext gives nested tickets the session id and canonical target…`. Task 12 runs, through the real handler, `unsealed: <provider> notices carry the session id and target …` for OpenAI, a custom server, Gemini and Corti; `concurrent sessions never borrow each other's id`; and, once Plan 04 has merged, its real `createDisclosureTracker` fed by main's notices (metadata never counts). Realtime marking per instance was already exact (Task 9a). |
| **I5-R2** a delayed attestation outlives 30 s | Fixed | **Store (Task 13):** expiry happens at main's `at + 30 s`, with the timer given only the remaining lifetime. Freshness is rechecked on focus and on visibility change, and the panel checks `isAttestationFresh` on every render. A version watermark survives invalidation, and a failed refresh never erases a push that arrived after it started. Tests: `a claim delivered late lives only until main's at + 30 s…`, `after a claim expires, a late older reply is never adopted`, `a failed refresh while a newer push arrives keeps the newer push`, and the panel's stale-claim assertion. |
| **N2** async yt-dlp spawn failure leaves an immortal ticket | Fixed | `childRegistry.onChildEnd` (Task 6a) ends a session exactly once: on `exit`, on an `error` before any pid, or on `close` without `exit`. An error after a successful start is not an end. Both yt-dlp spawns (Task 10) and `codexSession` (Task 8) use it. Tests: `an asynchronous spawn failure settles the session; an error after start does not`, the Codex case in Task 8, and the timeout and spawn-failure cases. |
| **N3** retired toasts when Plan 04 merges first | Fixed | Task 13, Step 6 has both branches. With Plan 04 merged: `notify(buildSealedRecoveryNotice(…))`, and `showDictationError({ …, recoveryHeld }, [Transcribe])`, which is Plan 04's persistent alert. Without it: the toast fallback uses `duration: 0`, which `Toast.tsx:97` never auto-dismisses, so it is persistent and not "the longest duration". Plan 04 removes the fallback when it merges second (P04 Task 5, Step 3, item 7). Test: `sealedRecoveryNotice.test.js` checks whichever API the branch has, and the integrated branch runs Plan 04's `noToastLeft` and `voiceNotices` suites. |
| **I1-R2 (updater test), partly disputed** | Test changed; one claim disputed | The review says D13 requires every manual check to stop at "available". **Evidence:** D13 (spec `4980c81`, §2) covers "manual update checks … when automatic updates are off". Plan 02's implementation downloads on a manual check when automatic updates are on (P02 Task 17: `if (!this.prefs.enabled) publish available else downloadUpdate`). The test's harness has `enabled: true`, so it matches D13. To remove any doubt, the test now starts the download through the automatic check (`check(false)`), which downloads before and after Plan 02. |

## Contract change requests

This plan owns §5.4 and must not edit the spec. The spec owner consolidated every plan's requests into §5 in commit `091d198` (on `snowopsdev/feat/uiux-foundations`); the current spec is `4980c81`, which also settles §5.1 rule 10 for plain-HTTP `*.localhost` as this plan assumed. Each request below is marked with where it now lives. Where this plan's code differed from a binding shape, the plan was changed to match the spec.

**CCR-1 (§5.4, owner Plan 07; additive plus one clarification).** *Status: applied in spec §5.4 (091d198): the scope, the preload API, `Attestation`, the 30 s staleness rule and `nothingLeaves`. The clarification that `network` is sealed is recorded there as a spec-owner clarification of D6. §5.4's consumers are Plans 03, 04, 05, 06 and 08.*
- **Clarification.** While sealed, *both* `remote` and `network` locality routes are blocked. Only `device` (loopback) keeps working.
  - A LAN self-hosted server is another machine, so audio sent to it leaves this computer. The pill copy "Sealed · nothing leaves" would otherwise be false.
  - The resolver therefore reports every non-`device` route as `{ status: "unreachable", detail: "sealed" }`. Plan 03's `isSealedLocality` already encodes this (CCR-2).
  - "Loopback" means `localhost`, `*.localhost`, `127.0.0.0/8`, `::1` and IPv4-mapped `127.x`, in main and in the renderer alike (CCR-5).
- **Additions to `window.electronAPI.privacy`.** `getSealed()` and `onSealedChange(cb)` keep their §5.4 signatures, and `onSealedChange` returns an unsubscribe function. The new methods are:

  ```ts
  setSealed(sealed: boolean): Promise<Attestation & { declined?: boolean }>;  // resolves after the sealing barrier; an unseal is confirmed by main first, and declined: true means the user said no
  getAttestation(): Promise<Attestation>;
  onAttestation(cb: (attestation: Attestation) => void): () => void;           // versioned pushes from main
  listEgress(options?: { since?: number; limit?: number }): Promise<EgressEvent[]>;
  egressSummary(options?: { since?: number }): Promise<EgressSummary>;
  clearEgress(): Promise<boolean>;                                             // false when the user declined main's confirmation
  exportEgressCsv(): Promise<{ saved: boolean }>;
  onEgress(cb: (notice: EgressNotice) => void): () => void;
  onEgressCleared(cb: () => void): () => void;
  ```

  `Attestation` is `{ sealed, sealedSince, effectiveSince, phase: "open" | "sealing" | "sealed", failures: string[], notes: string[], loadError, saveError, guards, networkChildren, activeRemote, blockedSinceSealed, recordFailures, version, at, nothingLeaves }`. The types are declared in `src/types/privacy.ts` (Task 7).
- **Semantics.**
  - `getSealed()` resolves `true` when the persisted setting is unreadable. Sealed mode fails closed.
  - `onSealedChange` fires only after main has applied the change and run the sealing barrier. By then, in-flight remote work is aborted, open remote sockets are destroyed, and network children have been told to stop.
  - `nothingLeaves` is true only when the phase is `"sealed"`, `failures` is empty, every guard is up, no environment proxy is set, and nothing remote is left: no ticket, socket, Chromium request, DNS lookup or network child.
  - `failures` are unresolved and block `nothingLeaves`. `notes` are delays that resolved before `effectiveSince`; the panel shows them for honesty.
  - Any claim about past egress is dated from `effectiveSince`, never from `sealedSince`. A consumer must treat an attestation older than 30 s (by `at`) as unknown.

**CCR-2 (§5.1 and §5.4, owner Plan 03).** *Status: superseded by spec §5.4's "One renderer authority: `src/stores/sealedStore.ts`" (091d198), and Plan 03 v2 (PR #50). The parts that remain are applied in §5.1 and §5.4.*
- **One sealed source.** *Superseded by §5.4.* The earlier request (that `routeFactsStore` mirror a Plan 07 store) is withdrawn. Plan 03 created `src/stores/sealedStore.ts` as the single renderer authority, with `useSealedStore` (`{ sealed, known }`), `getSealed()` and `ensureSealedSubscribed()`. `routeFactsStore` does not read `privacy`. Plan 07 Task 13 replaces that store's internals (attestation, staleness, versioned reads), and adds `getSealedSnapshot()`, `subscribeSealed()` and `setSealedMode()` to the same module. `src/hooks/useSealedMode.ts` is only the React hook over it. `known: false` is `sealed: null` in `getSealedSnapshot()`; `getSealed()` and route snapshots read it as `false`.
- **One rule.** *Applied in §5.1 (`isSealedLocality`, rule 7).* `isSealedLocality(locality)` is the only rule for which routes Sealed mode pauses. The earlier `applySealToRoute`/`isRouteSealed` request is withdrawn. Plan 07's pre-flight builds `buildRouteSnapshot(settings, facts, copy, true)` and asks `resolveRoute` for the dictation route's own sealed verdict, so it inherits Plan 03's precedence (§5.1 rule 10: an invalid endpoint is `needsUrl`, never sealed).
- **One declaration.** *Applied in §5.4.* Plan 07 Task 7 replaces Plan 03's optional `privacy?` member in `src/types/electron.ts` with the required `privacy: PrivacyAPI`.
- **The self-hosted probe.** *Applied in §5.4.* `probe-self-hosted` is gated in main as `providerCheck`. While sealed it is allowed only for loopback, and it returns `{ ok: false, code: "sealed" }` otherwise; the UI shows `routes.state.sealed`.

**CCR-3 (§5.2 and §5.3, owner Plan 04). The receipt and disclosure shape, matching Plan 04's CCR-6.** *Status: applied in spec §5.4, "Egress evidence → `RemoteDisclosure`" (091d198), and in §5.2 (`RemoteDisclosure`, with `alsoSentTo`) and §5.3 (the fixed Plan 07 notices). `dispatched`, `delivered` and `undelivered` are the contract; there is no `sent` phase.*
- **Main's evidence.** `privacy.onEgress` delivers `EgressNotice`:

  ```ts
  { phase: "dispatched" | "delivered" | "undelivered"; ticketId: number; task: EgressTask;
    targetId: string;   // provider id ("openai", "custom"), or "host:<hostname>" — Plan 04's RemoteDisclosure.target encoding
    host: string; payload: "audio" | "text" | "image" | "metadata"; correlationId: string | null; ts: number }
  | { phase: "recorded"; event: EgressEvent }   // the flight recorder's row, not disclosure evidence
  ```

- **Mapping onto `RemoteDisclosure`.** Plan 04's `{ target, payload, evidence: "attested" | "dispatched" }` maps as follows:
  - `delivered` for this session's `correlationId`, with payload `audio`, `text` or `image`, sets `target = targetId` and `evidence: "attested"`. The copy is "already received".
  - `dispatched` alone sets `evidence: "dispatched"`. The copy is "may have received".
  - `undelivered` for a ticket withdraws that ticket's `dispatched` evidence, unless another ticket of the session has dispatched or delivered.
  - `metadata` (token fetches, model lists) never counts.
  - There is no `sent` phase (§5.4). Plan 04's earlier `{ phase: "sent" }` reads as `delivered`.
  - `RemoteDisclosure.alsoSentTo` (§5.2) lists the session's other targets, strongest evidence first. It is built from the same notices, grouped by `correlationId`.
- **Correlation.** The `correlationId` is the dictation session id (Plan 04 CCR-6). It is carried on the BYOK transcription payload, the realtime and streaming start options, and every cleanup, Agent, vision and translation request of the recording. Main marks a realtime session `dispatched` at the first frame that instance forwards, so audio streamed before the stop counts, and a warm or idle socket does not.
- **Prefer main.** When `privacy.onEgress` exists, `remoteAlreadySent` comes only from these notices. Plan 04's renderer-side dispatch tracker is the fallback when Plan 07 is absent.
- **Notices (§5.3).** Plan 07's sealed copy and the recovery prompt must survive Plan 04's toast migration:
  - the recovery prompt is `notify({ kind: "notice", persistent: true, actions: [Transcribe, Discard] })`;
  - a sealed dictation refusal that holds audio in memory is an `alert`, because user content is at stake.

**CCR-4 (§5.4 consumer, owner Plan 04).** *Status: applied in spec §5.4, "Dictation pre-flight" (091d198).*
- **What Plan 07 ships.** Plan 07 ships the dictation pre-flight itself (owner decision 3, 2026-10-15). `audioManager.startRecording` refuses to start when `isDictationSealed(settings, getSealedSnapshot().sealed)` is true; `sealed` is `boolean | null`, and only `true` blocks. It reports `sealedMode.blocked.dictationPreflight` through the existing error path (Task 13). Plan 07 also ships in-memory recovery (`sealedRecovery.ts`, `AudioManager.transcribeRecovered`).
- **Plan 04 keeps both.** When it restructures the recording lifecycle, it must keep the pre-flight check, and the `_noteSealedFailure` call before `saveFailedTranscription`. It renders the refusal as a pill state, a blocked remote ring with "Dictation paused: Sealed mode is on". It keeps the "Transcribe" action reachable from the pill and from the unseal notice.
- **Rationale.** Main's block happens *after* recording. With local history off, a blocked recording could not otherwise be kept.

**CCR-5 (owner Plan 01): one loopback rule.** *Status: applied in spec §5, Plan 01 contracts, Locality row (091d198).*
- `isLoopbackUrl` in `src/lib/locality.ts` accepts exactly what main's `isLoopbackHost` accepts: `localhost` (including a trailing dot), `*.localhost`, `127.0.0.0/8`, `::1` in any spelling, and IPv4-mapped `127.x`. A hostname that only resolves to loopback is not loopback.
- Loopback is not the same as valid. Plain-HTTP `*.localhost` is loopback but refused by the executors, so its route is `needsUrl` (§5.1 rule 10) and never sealed-blocked as remote.

**CCR-6 (§5.4, owner Plan 07): narrow the scope for running local model servers.** *Status: requested; needs the spec owner. Raised by the round-2 security review (C2-R2).*
- **The problem.** §5.4 says the seal covers "the child processes Loqui starts". Local routes need on-device sidecars to keep running: llama-server, whisper-server, Qdrant and the sherpa-onnx servers. Loqui can enforce *how they start*: an allowlist, no download flags, loopback binds, telemetry off, and refusal of anything unclassified. Once a native process runs, no JavaScript hook can see its network traffic. Claiming them as verified would be a promise Loqui cannot prove.
- **Proposed §5.4 scope text.** "While sealed, nothing that Loqui's main process, its Chromium sessions and renderers, its worker processes, or the network-capable programs it starts sends reaches a host other than loopback. On-device model servers keep running so local routes work; Loqui enforces how they are launched, but cannot inspect their traffic, and says so."
- **Proposed `Attestation` addition.** `uninspectedChildren: string[]`, the running on-device sidecars. `nothingLeaves` keeps its definition, and does not cover them. The UI names them beside any verified claim.
- **What Plan 07 ships either way.** The launch enforcement, the field, the disclosure in the panel and in `docs/PRIVACY.md`, and the narrowed verified copy. If the owner wants the original scope instead, closing it needs OS-level containment for the sidecars (a per-process network sandbox on each platform). That would be a separate plan, and until it lands Sealed mode would have to stop local model servers, breaking local routes. D6 rules that out.
- Both are tested against `test/fixtures/loopbackCases.json`. Plan 07 Task 11a makes the change and keeps Plan 01's existing cases passing.

---

## Global Constraints

- **Ownership.** Electron main owns SQLite, credentials, native runtimes, provider requests and updates. Renderers talk only through typed preload IPC (CLAUDE.md). Sealed mode is enforced in main; a renderer check is UX only and never the guarantee (D6).
- **The boundary.** The guarantee covers Loqui's main process, its Chromium sessions and renderers, its worker processes, and the network-capable programs it starts (Task 1). Running on-device model servers are launch-checked but not inspected, and are named as such (CCR-6). Anything outside the boundary is either disabled while sealed or disclosed in the UI. No copy claims more.
- **No silent provider switches.** Local and remote choices stay explicit. Nothing silently switches provider or moves work from local to remote. Content is preserved on every failure, and a sealed block is a failure that keeps the user's message, recording or draft: in History when retention allows, otherwise in memory with a "Transcribe" action.
- **What sealed blocks.** Main blocks every outbound provider, model-download, update, calendar and URL-import request while sealed, and local routes keep working. The UI never claims "0 bytes" or "verified" unless main attests it (D6).
- **"Local" means loopback only.** That is `localhost`, `*.localhost`, `127.0.0.0/8`, `::1` and IPv4-mapped `127.x`, in main and in the renderer (CCR-5). A LAN address, a public IP, an unparseable target or a hostname that merely *resolves* to loopback is **not** local (CCR-1; D4 makes loopback self-hosted URLs `device`).
- **A stop is an exit.** A child process, a Chromium request or a DNS lookup counts as stopped only when it has actually ended. A signal, a timeout or a reset is never evidence. Failures stay unresolved until the thing they name has stopped.
- **The flight recorder stores metadata only:**
  - start and end times, task id, the bare hostnames contacted (up to 8), bytes sent, bytes received, outcome, HTTP status, error class (an error `code` or `name`, never a message) and model id;
  - **never** content, prompts, keys, URLs with paths or query strings, or error messages.
- **Unknown byte counts are `null`, not `0`.** The UI renders them as "—". Only a blocked request records `bytesOut: 0`, because main refused it before any socket opened.
  - Bytes are request and response *bodies*, except realtime sessions, which count wire bytes on their own socket.
  - A bodyless request is `null`, not 0, because its headers still went out.
  - Opaque child sessions (Codex, yt-dlp) never carry byte counts, and are counted apart from observed requests.
- **"Nothing was sent" is only for refusals.** A request that sealing cut off mid-flight is reported as *interrupted*, meaning the provider may have received part of it, never as "nothing was sent".
- **Recorder retention follows the existing privacy settings:**
  - Rows older than `transcriptRetentionDays` are pruned when that value is above 0. When it is 0 ("forever"), the table is capped at `MAX_ROWS = 100000` rows, checked on insert.
  - When `dataRetentionEnabled` is `false`, events are kept in memory only (the last 500), and nothing recorded in that state is ever written to disk, even if history is turned on later.
  - Pruning also runs in the existing six-hour retention sweep (`ipcHandlers.js` `_runRetentionCleanup`).
- **Tests.** Tests use Node `node:test` through `npm test` (`scripts/run-tests.js`). Run `npm run native:node` before tests and `npm run native:electron` before launching the desktop app. Never use personal profiles in tests.
- **Tests exercise production wiring.** Enforcement tests drive the real registered handlers and factories, never a test-supplied gate or hook. Source-text checks are allowed only as ratchets beside an executed test, never in place of one.
- **No network in tests.** Tests never touch the network. Sealed denials happen before DNS. Unsealed tests use loopback servers, or a `lookup` that points at a local fixture.
- **DB tests.** A test that opens SQLite must live in `test/helpers/` and contain the literal `require("./harness/db")`. `scripts/run-tests.js` uses that string to run it without the tsx loader.
- **i18n.** Every visible string goes through i18n, with keys in all 11 locales (`ar de en es fr it ja pt ru zh-CN zh-TW`) under `src/locales/*/translation.json`. `npm run i18n:check` passes.
- **Contrast.** Text contrast is at least 4.5:1 and non-text UI at least 3:1, in light and Plum Night.
- **Motion and RTL.** Motion uses the shared `--motion-*` tokens. Reduced motion keeps opacity and colour feedback and drops transforms. Use logical properties (`ms-`, `me-`, `start`, `end`). Hostnames render `dir="ltr"`.
- **Docs.** `DESIGN.md` is the source of truth for UI (D10). `docs/PRIVACY.md` and `docs/network-allowlist.md` must be updated by any change that adds a destination or a content category (the allowlist doc says so).
- **Node.** Use `~/.nvm/versions/node/v24.21.0/bin` (`.nvmrc` 24.21.0).
- **Before a PR:** `npm run lint`, `npm run typecheck`, `npm test`, `npm run i18n:check` and `npm run test:sealed-electron`.

## Review Focus

Each of these failure modes is the kind a reviewer should try by hand. Each is pinned by a named test in the owning task.

1. **Turning Sealed mode on while something is mid-flight:** a streaming chat reply, an open realtime STT socket, a model download, an update download, or a yt-dlp process that ignores signals.
   - Expected: the transfer stops within a second, and the user's message, draft or partial download stays.
   - The ledger shows the request as `cancelled` with error class `SEALED_MODE`, and the copy says *interrupted*, not "nothing was sent".
   - The attestation reports `nothingLeaves: true` only after every stop has been confirmed. A child that survives SIGKILL keeps it unverified for as long as it runs.
   - Pinned in:
     - Task 5 (`abortAllRemote interrupts in-flight remote tickets; loopback keeps running`, `guardResponse: sealing after headers with a stalled body interrupts it`, `aborting an opaque session does not settle it: only the child's exit does`);
     - Task 6 (`severAll destroys open remote Node sockets and leaves loopback ones alone`, `pending DNS lookups are counted until they answer`);
     - Task 6a (`a child is alive until it exits, not until it is signalled`, `stopAll rejects when a child survives SIGKILL, and it stays alive`);
     - Task 7 (`sealing stops everything, waits for children, then becomes effective`, `a child that will not exit keeps the seal unverified until it really exits`, `an un-ticketed Chromium request in flight keeps it sealing; nothing is reset or cleared`);
     - Task 8 (`sealing mid-request rejects as 'interrupted'…`, `sealing during a pending start cancels it before anything is spawned`);
     - Task 9a (`sealing closes an open realtime session as interrupted`);
     - Task 10 (`sealing keeps the partial file; the next run resumes and counts only new bytes`, `sealing kills an in-flight yt-dlp self-update and records an opaque session`);
     - Task 12 (`a local request in flight survives sealing, while the remote one beside it is interrupted`).
2. **A damaged or unwritable `privacy.json`.** A truncated file, a non-boolean `sealed`, or a read-only profile must never silently unseal.
   - An unreadable or corrupt file loads as sealed, with `loadError` set.
   - A failed save while sealing keeps the app sealed for this session and surfaces `saveError`, so the UI can warn that it will be off after restart.
   - Pinned in Task 3 (`a corrupt file fails closed`, `an unreadable file fails closed`, `a failed save keeps the in-memory value and reports saveError`).
3. **Self-hosted endpoints spelled in unusual ways**, in main and in the route graph alike. These stay allowed while sealed:
   - `http://localhost:11434/v1`, `http://LOCALHOST.:8080`, `http://[::1]:8080`, `http://127.0.0.2:9000`, `http://[::ffff:127.0.0.1]/` and `http://app.localhost:5173/`.

   These are blocked:
   - `http://192.168.1.5:8080`, `http://localhost.evil.example`, `http://127.0.0.1.nip.io` and `http://0.0.0.0:8080`;
   - an empty or garbage URL.

   A `localhost` connection whose own `lookup` claims a public address must still connect to loopback.

   Pinned in:
   - Task 2 (`loopback classification`, reading `test/fixtures/loopbackCases.json`);
   - Task 6 (`localhost and *.localhost are pinned to loopback even when a lookup says otherwise`, `sealed: a loopback proxy is not allowed to tunnel or forward to a remote host`);
   - Task 11a (`main and the route graph agree on every loopback case`).
4. **Hostile values reaching the ledger.** A model id with a comma, newline or leading `=` must not break or inject into the CSV export. A target containing userinfo, a path or a query must be stored as a bare host. Error messages from providers, which may echo content, are never stored. Pinned in Task 4 (`CSV export neutralises formulas and quotes`, `record rejects non-host values, in host and in the trail, and unknown enums`) and Task 5 (`settle stores an error class, never a message`).
5. **Sealed at launch, with a calendar connected and an update check due.**
   - Expected: no non-loopback connection from boot. Calendar sync does not start, and the automatic update check is skipped without advancing `lastCheck`.
   - Turning sealed off starts calendar sync and lets the next hourly tick check for updates.
   - Pinned in:
     - Task 7 (`sealed at boot is effective from boot, with everything verified`, `unsealing restarts calendars and republishes update status`, `main boots the egress guards before any helper is required`);
     - Task 10 (`automatic check is skipped while sealed and lastCheck is unchanged`, `seal and unseal always publish status, even when idle`);
     - Task 11 (`the calendar guard main uses starts, focus-syncs and wake-syncs nothing while sealed`);
     - Task 16 (`boot: the remote fixture saw no request and no connection during the whole sealed run`).
6. **A recording that Sealed mode blocks while local history is off, batch or streaming.** It must survive in memory, never on disk, and be offered for "Transcribe" on the error and again on unseal. A replay must never drop the only copy. Pinned in Task 13:
   - `a sealed failure with history off: held in memory = true`;
   - `streaming sealed mid-dictation with no text (history off)…`;
   - `replay: a non-sealed failure keeps the only copy…` and `replay: refused while busy, and only one replay at a time`;
   - `recovery never touches disk or IPC`.
7. **Ways out of the boundary:** a crafted playlist given to FFmpeg, a link or meeting join link clicked while sealed, a calendar sign-in completed in the browser after sealing, a remote image in a chat answer, a `<link rel="preconnect">`, a WebRTC peer connection. Pinned in:
   - Task 6a (`a local playlist that points at a server makes FFmpeg fetch nothing`);
   - Task 7a (`every window loads the preload, and the preload removes WebRTC from the page`);
   - Task 11 (`a declined link never reaches the OS, and is not an error`, `sealing cancels a pending OAuth flow…`);
   - Task 13 (`sealed: remote images are inert placeholders; loopback images and links stay`);
   - Task 16 (`toggle: the remote fixture saw no request and no connection after sealing`).
8. **DNS and processes that a seal must not miss.**
   - A resolver query issued just before the seal, and a reverse lookup while sealed.
   - An unknown helper binary, `open https://…`, `sh -c curl …` and a llama-server with `-hf`.
   - The ONNX worker.

   Pinned in:
   - Task 6 (`every resolver query issued before the seal is counted until it ends…`, `sealed: lookupService (callback and promise) never reaches the native resolver…`, `every DNS entry point … is wrapped…`);
   - Task 6a (`sealed: only allowlisted programs start, and only with allowed arguments`, `the lock refuses the network inside a separate Node runtime, and keeps loopback`, `an asynchronous spawn failure settles the session…` in Task 10).
9. **The ledger is metadata, one row per request.** A model id like `https://user:pass@host/v1?key=…` never reaches SQLite or the CSV. Two requests in one operation are two rows. A failed retry never withdraws an earlier delivery. An operation that never sent anything is not counted. Pinned in Task 4 (`model ids and error classes are identifiers or nothing…`) and Task 5 (`two requests in one operation are two rows…`, `an operation that fails before any transport is kept, but never counted…`).

---

## File structure

**Create (main process, CommonJS):**
- `src/helpers/privacy/egressPolicy.js`: pure. Task ids, host classification, the allow/deny decision and `SealedModeError`.
- `src/helpers/privacy/sealedState.js`: the persisted switch in `<userData>/privacy.json`, which fails closed.
- `src/helpers/privacy/flightRecorder.js`: the ledger store (pending, SQLite or memory-only), summary, prune and CSV.
- `src/helpers/privacy/egressGate.js`: Layer A. Tickets, task context (`AsyncLocalStorage`), metering, notices, abort-on-seal and counters.
- `src/helpers/privacy/egressBackstop.js`: Layer B. Node socket (with `localhost` pinning), DNS, UDP and proxy hooks; the Chromium session watcher with per-request tracking; the WebRTC policy; sever-all and observers.
- `src/helpers/privacy/childRegistry.js`: the child registry (alive until exit) and the spawn guard (Task 6a).
- `src/helpers/privacy/privacyBoot.js`: boot order, the sealing barrier (transition), the attestor and main's confirmation dialogs (unseal, clear, open link).
- `src/helpers/privacy/privacyIPC.js`: the `privacy:*` IPC channels and broadcasts.
- `src/helpers/privacy/trustedSender.js`: the main-frame, app-URL and known-window check for privacy-changing IPC.
- `src/helpers/privacy/providerEndpoints.js`: the destination of each named provider.
- `src/helpers/privacy/gatedFetch.js`: `gatedNetFetch` (Electron `net`) and `gatedNodeFetch` (Node `fetch`), both gated and metered.
- `src/helpers/privacy/calendarGuard.js`: the start, focus and wake gate that `main.js` routes remote calendars through (Task 11).
- `src/helpers/sttTransport.js`: `buildMultipartBody` and `postMultipart` (moved out of `ipcHandlers.js` and gated), plus `realtimeEndpoint`, `connectRealtime` and `markRealtimeDispatched`.

**Create (renderer, TypeScript):**
- `src/types/privacy.ts`: `PrivacyAPI`, `Attestation`, `EgressEvent`, `EgressSummary`, `EgressNotice` and `EgressTask`.
- `src/hooks/useSealedMode.ts`: the React hook over `src/stores/sealedStore.ts` (§5.4); it holds no state.
- `src/lib/sealedMode.ts`: `isDictationSealed` (the pre-flight), over Plan 03's resolver.
- `src/lib/sealedRecovery.ts`: in-memory recovery of blocked dictations.
- `src/utils/sealedModeError.ts`: `isSealedModeError`, `sealedPhase` and `sealedDictationMessageKey`.
- `src/components/chat/chatErrorContent.ts`: the assistant bubble's failure text, including the sealed copy.
- `src/components/settings/SealedModePanel.tsx` and `src/components/settings/sealedModeCopy.ts`: the master switch, and the only place that decides what the panel may claim.
- `src/components/settings/FlightRecorderPanel.tsx` and `src/components/settings/flightRecorderView.ts`: the ledger view and its pure view model.

**Create (docs):** `docs/security/sealed-mode-threat-model.md` (Task 1) and `docs/security/sealed-mode-review-2026-10.md` (Task 18).

**Create (scripts and test helpers):**
- `scripts/sealed-acceptance.cjs` and `scripts/lib/egressFixture.cjs` (Task 16).
- `test/helpers/harness/ipcHandlersHarness.js` (Task 12), which registers the real `ipcHandlers.js` channels against fakes.
- `test/fixtures/loopbackCases.json` (Task 11a).
- `test/hooks/fakePrivacy.js` (Task 13).

**Modify:**
- Main process:
  - `main.js` and `preload.js`;
  - `src/helpers/windowConfig.js` (Task 7a);
  - `src/helpers/codexAppServer.js`, `src/helpers/personalInference.js`, `src/helpers/providerConnectionTest.js` (rethrows sealed errors; gated at its IPC call site);
  - `src/helpers/localDatabaseSchema.js`, `src/helpers/ipcHandlers.js`;
  - `src/helpers/tinfoilCatalog.js`, `src/helpers/geminiTranscription.js`, `src/helpers/cortiAuth.js`, `src/helpers/cortiTranscription.js`, `src/helpers/tinfoilTranscription.js`;
  - `src/helpers/downloadUtils.js`, `src/helpers/gpuBinaryManager.js`, `src/helpers/urlAudioDownloader.js`, `src/helpers/ffmpegUtils.js` (Task 6a);
  - `src/helpers/updateManager.js`, `src/helpers/updateIPC.js`;
  - `src/helpers/googleCalendarOAuth.js`, `src/helpers/googleCalendarManager.js`, `src/helpers/microsoftCalendarOAuth.js`, `src/helpers/microsoftCalendarManager.js`;
  - `src/helpers/oauthLoopbackFlow.js` and `src/helpers/externalUrlOpener.js` (Task 11);
  - `src/helpers/selfHostedProbe.js` (Plan 03; Task 11a).
- Renderer:
  - `src/index.html` (Task 7a), `src/types/electron.ts`, `src/types/updates.ts`;
  - `src/lib/locality.ts` (Plan 01; Task 11a), `src/lib/routes.ts` (a comment) and `src/stores/sealedStore.ts` (Plan 03; Task 13 replaces its internals);
  - `src/components/SettingsPage.tsx`, `src/components/settings/UpdateSettings.tsx`, `src/components/SelfHostedPanel.tsx` (Task 11a);
  - `src/components/ui/MarkdownRenderer.tsx`, `src/components/chat/useChatStreaming.ts`;
  - `src/utils/localInferenceError.ts`, `src/utils/recordingErrors.ts`;
  - `src/helpers/audioManager.js` (renderer code), `src/hooks/useAudioRecording.js` and `src/index.css`.
- Locales and docs: `src/locales/*/translation.json`, `DESIGN.md`, `docs/PRIVACY.md` and `docs/network-allowlist.md`.
- Scripts: `scripts/smoke-electron.cjs` (the Task 6 observer hook only) and `package.json` (`test:sealed-electron`).

---

### Task 1: Threat model, network inventory, and the egress-site and spawn-site ratchets

This task comes first so every later task argues from one decided inventory. It decides, per outbound path, what Sealed mode blocks, which layer enforces it, and which task the ledger attributes it to. It also states exactly what the guarantee covers (C2): Loqui's main process, its Chromium sessions and renderers, and the child processes it starts. Everything outside that boundary is either disabled while sealed or disclosed in the UI.

**Files:**
- Create: `docs/security/sealed-mode-threat-model.md`
- Modify: `docs/network-allowlist.md`. Add a "Sealed mode" column, and a sentence that the inventory is now checked by a test.
- Test: `test/helpers/egressInventory.test.js`

**Interfaces:**
- Produces:
  - The inventory table, with path ids `N1`–`N26`. Tasks 8–16 cite these ids. The Task 12 matrix must cover every `blocked` row, except the Chromium-only row N25, which Task 16 proves in Electron.
  - A fenced ```` ```egress-sites ```` block, listing every source file that can open an outbound connection.
  - A fenced ```` ```spawn-sites ```` block, listing every source file that can start a process.

  The ratchet test compares both blocks with a scan of the code. The scan matches module imports as well as call shapes, so aliases (`const mod = require("https"); mod.request(…)`) and renderer files (`.tsx`, `.jsx`, `.mjs`) are caught.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/egressInventory.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.join(__dirname, "../..");
const DOC = "docs/security/sealed-mode-threat-model.md";

// A file that imports a network module, or calls a network API, can open an
// outbound connection. Matching the import catches aliases (mod.request, a
// destructured get) that a call-shape regex would miss.
const NETWORK_PRIMITIVE = new RegExp(
  [
    String.raw`\bfetch\s*\(`,
    String.raw`\bnet\.(?:request|fetch)\s*\(`,
    String.raw`require\(\s*["'](?:node:)?(?:https?|http2|tls|net|dgram|dns)["']\s*\)`,
    String.raw`from\s+["'](?:node:)?(?:https?|http2|tls|net|dgram|dns)["']`,
    String.raw`new\s+(?:WebSocket|EventSource|XMLHttpRequest)\s*\(`,
    String.raw`require\(\s*["']ws["']\s*\)`,
    String.raw`from\s+["']ws["']`,
    String.raw`tinfoilSecureFetch\s*\(`,
    String.raw`checkForUpdates\s*\(`,
    String.raw`\.downloadURL\s*\(`,
    String.raw`\bnavigator\.sendBeacon\s*\(`,
  ].join("|")
);
// A file that can start a process: child_process in any form, utility processes
// and workers (each has its own runtime, outside main's hooks).
const SPAWN_PRIMITIVE = new RegExp(
  [
    String.raw`require\(\s*["'](?:node:)?child_process["']\s*\)`,
    String.raw`from\s+["'](?:node:)?child_process["']`,
    String.raw`\butilityProcess\.fork\s*\(`,
    String.raw`new\s+Worker\s*\(`,
  ].join("|")
);
// Main, preload and everything under src/: helpers, services, workers, the
// renderer entry files and components. JSON and assets do not match SOURCE.
const SCAN_ROOTS = ["main.js", "preload.js", "src"];
const SOURCE = /\.(?:c?js|mjs|jsx?|tsx?)$/;
// The privacy modules implement the guards themselves. egressPolicy.js imports
// node:net only to parse IP literals (net.isIPv4/isIPv6).
const EXEMPT = new Set([
  "src/helpers/privacy/egressGate.js",
  "src/helpers/privacy/egressBackstop.js",
  "src/helpers/privacy/egressPolicy.js",
  "src/helpers/privacy/childRegistry.js",
]);

function walk(entry, out = []) {
  const full = path.join(repoRoot, entry);
  if (!fs.existsSync(full)) return out;
  if (fs.statSync(full).isFile()) {
    if (SOURCE.test(entry) && !entry.endsWith(".d.ts")) out.push(entry);
    return out;
  }
  for (const child of fs.readdirSync(full)) walk(path.posix.join(entry, child), out);
  return out;
}
const sources = () => SCAN_ROOTS.flatMap((root) => walk(root)).filter((file) => !EXEMPT.has(file));
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");

function block(name) {
  const match = read(DOC).match(new RegExp("```" + name + "\\n([\\s\\S]*?)```"));
  assert.ok(match, `${DOC} has a ${name} block`);
  return new Set(match[1].split("\n").map((l) => l.trim()).filter(Boolean));
}

test("the scan recognises aliased and renderer-style network and spawn code", () => {
  for (const code of [
    'const mod = require("https"); mod.request(url)',
    'import { get } from "node:http"',
    'import WebSocket from "ws"',
    "await fetch(url)",
    "new EventSource(url)",
  ]) assert.match(code, NETWORK_PRIMITIVE, code);
  for (const code of ['const { execFile } = require("node:child_process")', "utilityProcess.fork(p)", "new Worker(u)"]) {
    assert.match(code, SPAWN_PRIMITIVE, code);
  }
  assert.doesNotMatch("const map = new Map(); map.get(key)", NETWORK_PRIMITIVE);
});

test("every file that can open a connection is in the egress-sites block", () => {
  const listed = block("egress-sites");
  const missing = sources().filter((file) => NETWORK_PRIMITIVE.test(read(file)) && !listed.has(file));
  assert.deepEqual(missing, [], "add these to the egress-sites block and decide their sealed policy");
});

test("every file that can start a process is in the spawn-sites block", () => {
  const listed = block("spawn-sites");
  const missing = sources().filter((file) => SPAWN_PRIMITIVE.test(read(file)) && !listed.has(file));
  assert.deepEqual(missing, [], "add these to the spawn-sites block and classify each program they start");
});

test("every inventoried file still exists", () => {
  for (const file of [...block("egress-sites"), ...block("spawn-sites")]) assert.ok(fs.existsSync(path.join(repoRoot, file)), file);
});

test("every inventory row states a sealed decision and an enforcement layer", () => {
  const rows = read(DOC).split("\n").filter((l) => /^\| N\d+ \|/.test(l));
  assert.ok(rows.length >= 26, "N1–N26 present");
  for (const row of rows) {
    assert.match(row, /\| (blocked|allowed: loopback|allowed after confirmation|local only: contained|n\/a: no network) \|/, row);
    assert.match(row, /\| (A\+B|B|B: Chromium|spawn guard|A\+spawn guard|main dialog|n\/a) \|/, row);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/helpers/egressInventory.test.js`
Expected: FAIL with `ENOENT … sealed-mode-threat-model.md`. The first test (the scan's self-check) passes.

- [ ] **Step 3: Write the threat model**

Create `docs/security/sealed-mode-threat-model.md` with exactly this content. Line numbers were verified against `0639eaf`; re-verify them with `grep -n` before committing. The two blocks were produced by running the test's scan over this checkout. Re-run it, and add any file it reports, with a decision.

````markdown
# Sealed mode: threat model and network inventory

Owner: Plan 07 (`docs/superpowers/plans/2026-10-15-loqui-uiux-07-sealed-mode.md`). Update this file in the same PR as any change that adds an outbound path or starts a process; `test/helpers/egressInventory.test.js` fails until you do.

## Promise

While Sealed mode is on, nothing that **Loqui's main process, its Chromium sessions and renderers, its worker processes, or the network-capable programs it starts** send reaches a host other than this computer's loopback (`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`). Local routes keep working. The promise is enforced in Electron main; the renderer only reflects it.

**Narrowed for local model servers (CCR-6).** Local routes need on-device sidecars to keep running: llama-server, whisper-server, Qdrant and the sherpa-onnx (Parakeet, diarization) servers. Loqui enforces *how they start*: only allowlisted binaries, no download options, loopback binds, telemetry off (Task 6a). It cannot observe their network traffic once they run; no JavaScript hook reaches inside a native process. So the attestation names every running sidecar as `uninspectedChildren`, and the panel and `docs/PRIVACY.md` say plainly that they are not inspected. "Verified" never covers them. Closing this fully needs OS-level containment (for example a per-process network sandbox), which is not in this plan.

The panel says "verified" only when main attests all of this at that moment (Task 7). Main dates that claim from when it confirmed that everything had stopped, not from when the switch was flipped. If something cannot be confirmed (a child that will not exit, a Chromium request that will not end, a pending DNS lookup, an environment proxy), the panel says so and names it, and the verified line does not appear.

## Boundary

| Inside: enforced and attested | How |
|---|---|
| Main-process JavaScript: Node `http(s)`, undici `fetch`, `ws`, `net`, `tls`, `dns`, `dgram`, and SDKs built on them | Layer A (the gate) at each known site; Layer B (socket, DNS and UDP hooks) underneath, for code nobody gated |
| Chromium networking: Electron `net`, electron-updater's session, renderer loads, redirects | Layer B on every session's `webRequest`, with per-request in-flight tracking |
| Renderers | Only Loqui's own pages, sandboxed with web security on (Task 7a). Remote images render as placeholders while sealed (Task 13). WebRTC constructors are removed in every frame, `about:blank` and `srcdoc` included: the preload runs in each frame (`nodeIntegrationInSubFrames`, still sandboxed), and only the main frame gets `electronAPI`. A CSP forbids remote frames and plugins. The IP-handling policy is kept as defence in depth. DNS prefetch is off. Preconnect hints are probed in Electron (Task 16). |
| Child processes Loqui starts | The spawn guard (Task 6a) allows, while sealed, only allowlisted programs: Loqui's own binaries and known sidecars (with launch rules), named system tools (with argument rules), and Loqui itself. Network programs, third-party spawns and anything unclassified are refused. Running network programs are stopped, and count as stopped only when the OS reports their exit. FFmpeg runs only with `-protocol_whitelist file,pipe`. |
| Utility processes and workers | The ONNX worker installs the Node backstop with the seal forced on, as its first statement. It cannot reach the network in any mode, and a test proves this in a separate Node runtime (Task 6a). `utilityProcess.fork` is limited to `src/workers/`. |

| Outside, and how Sealed mode treats it | Treatment |
|---|---|
| The OS browser and mail client (links, meeting join links, OAuth consent pages) | Not opened without a main-owned confirmation that names the host and says the other app is not covered (Task 11). |
| A calendar sign-in already waiting in the browser | Cancelled on seal; its loopback callback closes (Task 11). |
| A proxy or port-forwarder the user runs on loopback | Trusted as loopback. A loopback `CONNECT` or absolute-form request naming a remote host is refused, and an environment proxy makes the seal unverified. A user-run forwarder that relays plain loopback traffic off the machine is the user's own configuration, and is documented in `docs/PRIVACY.md`. |
| OS services (system DNS-over-HTTPS, iCloud for Apple Calendar, OS updates) and other apps | Not Loqui's traffic. Not claimed. |
| Network traffic inside a running local model server (llama-server, whisper-server, Qdrant, sherpa-onnx) | **Disclosed, not claimed (CCR-6).** Their launch is enforced: allowlist, no download flags, loopback binds, Qdrant `--disable-telemetry`. Their runtime traffic is not observable from JavaScript. The attestation lists them as `uninspectedChildren`, and the panel names them beside the verified line. Loqui's own native helpers (key and mic listeners, paste and audio-capture tools) are built from this repository's source, launched only with the arguments in `spawn-sites`, and re-checked in Task 18. |
| A helper that a Windows yt-dlp process starts and orphans within one 250 ms refresh | Residual, Windows only: it is not waited for. yt-dlp waits for its post-processors, so this needs a misbehaving binary. POSIX uses process groups, which have no such window (Task 6a). |
| Build and packaging scripts (`scripts/`, `cleanup.js`) | Not part of the shipped app; they run only on a developer or CI machine, so the ratchet does not scan them. |
| A malicious local process that reads the Loqui profile | Out of scope. |

## Assets

User content: audio, transcripts, notes, chat messages, screenshots and dictionary words. Metadata that reveals activity: which providers are used, and when. Credentials (API keys and OAuth tokens).

## Adversaries and failure modes in scope

1. **A forgotten code path.** A feature, new or old, sends a request without asking the gate. Mitigation: Layer B denies at the socket, DNS and session level regardless, and the egress-sites ratchet forces an inventory decision.
2. **A library that connects on its own.** Examples are SDK telemetry, Tinfoil attestation and AWS credential discovery. Mitigation: Layer B, and the request shows in the ledger as `unattributed`. A credential *process* that an SDK spawns is refused by the spawn guard (third-party spawn).
3. **In-flight work when the switch flips.** Mitigations:
   - `abortAllRemote()` interrupts every remote ticket, including response bodies still being read.
   - `severAll()` destroys open remote Node sockets but leaves loopback ones alone.
   - The update download is cancelled. Codex, yt-dlp and every other registered network child are stopped. The registry waits for the OS to report each exit, escalating from `SIGTERM` to `SIGKILL`.
   - The sealing barrier waits until nothing remote is left: tickets, sockets, Chromium requests, pending DNS lookups and children.
   - An un-ticketed Chromium request that does not end keeps the seal unverified, with the reason shown. Loqui never resets all Chromium connections, because that would also cut local work (I7). Evidence is never cleared to make the check pass (C3).
4. **A child process with its own network stack.** Main's hooks cannot see inside one. Mitigations:
   - The spawn guard refuses network programs and third-party spawns while sealed, and re-checks just before Codex starts.
   - Running children are stopped on seal. A child is reported stopped only after its `exit` (and, for a detached download, after its process group is gone). A child that survives `SIGKILL` leaves `childStop` unresolved, so the seal is never verified while it runs (C1).
   - Each run of Codex or yt-dlp is one opaque ledger session, written when the process exits.
   - FFmpeg is restricted to `file` and `pipe` inputs, so a crafted local playlist cannot make it fetch remote resources.
5. **A compromised or buggy renderer flips the switch off or wipes the ledger.** Mitigations:
   - `privacy:set-sealed` accepts only a boolean, and only from the *main frame* of the main window or control panel, while that frame shows Loqui's own page (`trustedSender.js`).
   - Unsealing, clearing the ledger, and opening a link while sealed are confirmed in native dialogs owned by main, which a renderer cannot click.
   - The control panel is sandboxed, with web security on, and no renderer has WebRTC (Task 7a).

   Residual: a user tricked into pressing "Turn off Sealed mode" in that dialog.
6. **A corrupt or unwritable settings file.** Mitigation: an unreadable file means sealed (fail closed), and a failed save is surfaced as `saveError`.
7. **A utility process or worker** (`utilityProcess.fork`, `worker_threads`). Each has its own Node runtime, so the main-process hooks do not apply inside it. Mitigations:
   - the ONNX worker installs the Node backstop with the seal forced on before anything else, which is runtime containment, not just review;
   - a test forks a separate Node runtime with the same lock and proves DNS and `fetch` are refused while loopback works;
   - a ratchet requires the lock as the first statement of every file in `src/workers`;
   - the spawn guard allows `utilityProcess.fork` only for `src/workers/`.
8. **The ledger leaking content.** Mitigation: the schema has no content column, `record()` rejects anything that is not a bare hostname, and error *messages* are never stored, only codes and classes.
9. **A local proxy that forwards off-machine.** A loopback socket is not proof that nothing leaves. Mitigations:
   - While sealed, a loopback `CONNECT` tunnel or absolute-form request naming a remote host is refused.
   - Undici `ProxyAgent`/`EnvHttpProxyAgent`/`setGlobalDispatcher` are banned by a ratchet test.
   - Node's environment proxy (`NODE_USE_ENV_PROXY`, `--use-env-proxy`) makes the attestation unverified.
   - Chromium decides on the original URL, so a system proxy is never contacted for a refused request.
10. **Traffic that is not plain TCP.**
    - DNS: every entry point in `node:dns` and `node:dns/promises` (lookup, lookupService, all `resolve*`, reverse, and the same on `Resolver` instances) is wrapped. A test checks the live module, so a new API cannot slip past. While sealed, a query is refused before the native resolver is called. Localhost names and loopback literals are answered locally. Every query issued while unsealed is counted from call to settle, exactly once, and the seal is verified only after the count reaches 0. UDP (`dgram`) to a remote address is refused.
    - WebRTC: the preload runs in every frame and deletes `RTCPeerConnection` and its relatives from each frame's main world before page script runs (Task 7a). Task 16 checks the top page, an `about:blank` iframe and a `srcdoc` iframe. The `disable_non_proxied_udp` policy is kept as defence in depth, and a ratchet bans peer-connection code outside the marked removal block.
    - Chromium speculation: renderer documents turn off DNS prefetching. Task 16 serves `<link rel="preconnect">`, `dns-prefetch` and plain links while sealed, against a fixture that logs raw TCP connections. Any speculative connection fails the acceptance run. Chromium may not act on these hints at all, so the control run does not require them to fire; the sealed run requires zero connections either way.

## Enforcement layers

| Layer | Where | Sees | Action while sealed |
|---|---|---|---|
| A, gate | `src/helpers/privacy/egressGate.js`, called at each site below | every known request, with its task | throws `SealedModeError` before any socket opens and records `blocked`, 0 bytes |
| B, Node | `net.Socket.prototype.connect` (with `localhost` and `*.localhost` pinned to loopback), every `dns` API, `dgram` send/connect, and `http`/`https` request/get (loopback-proxy forwarding) in `egressBackstop.js` | every Node TCP/TLS connection (`http`, `https`, undici `fetch`, `ws`, AWS SDK, Tinfoil SDK), DNS queries, UDP | refuses with `SealedModeError` before DNS; a loopback CONNECT/absolute-form request to a remote host is destroyed before anything is written |
| B, Chromium | `session.webRequest` on every session (`app.on("session-created")` plus `defaultSession`), with per-request in-flight tracking and redirect checks; `setWebRTCIPHandlingPolicy("disable_non_proxied_udp")` on every `webContents`; `x-dns-prefetch-control: off` in `src/index.html` | Electron `net.fetch`/`net.request`, `electron-updater` (own partition), renderer loads | `callback({ cancel: true })` |
| Renderer | `preload.js` (`contextBridge.executeInMainWorld`), Task 7a; `MarkdownRenderer` image placeholders, Task 13 | page scripts | no WebRTC constructors; no remote image loads while sealed or unknown |
| Spawn guard | `src/helpers/privacy/childRegistry.js` (Task 6a): `child_process` and `utilityProcess.fork` | every process Loqui starts | network and third-party spawns refused; running ones stopped and awaited until the OS reports exit; FFmpeg restricted to local inputs |
| Main dialogs | `privacyBoot.createConfirmations` (Tasks 7 and 11) | unseal, clear, opening a link while sealed | asks the user; the safe answer is the default |

## Inventory

`A+B` means the site is gated, and the backstop also covers it. `B` means only the backstop covers it, because the site is loopback-only or not a request site. Tasks are the ledger `task` ids (`src/helpers/privacy/egressPolicy.js`). The "Test" column names the test that proves the row (Task 12 unless stated).

| Id | Path | Code (verified) | Transport | Sealed | Layer | Ledger task |
|---|---|---|---|---|---|---|
| N1 | Provider text inference (cleanup, agent, vision, notes, translation, chat, provider web search) | `personalInference.js:347 execute`, `:173 createModel` | Node fetch (AI SDK) | blocked | A+B | from `inferenceScope` (`SCOPE_TO_TASK`) |
| N2 | Enterprise inference and legacy enterprise handlers | `personalInference.js:174-180`; `ipcHandlers.js:3953, 4025, 4154, 4239` | AWS SDK / Node fetch | blocked | A+B | from scope, or `providerCheck` |
| N3 | Model discovery (custom/LAN/OpenRouter) | `personalInference.js:286` | Node fetch | blocked | A+B | `providerCheck` |
| N4 | Provider connection test, and the self-hosted server probe (Plan 03) | `providerConnectionTest.js:282`, IPC `ipcHandlers.js:1081`; `selfHostedProbe.js` (Task 11a) | Node fetch | blocked | A+B | `providerCheck` |
| N5 | Batch STT (BYOK and self-hosted) | `ipcHandlers.js:7963` → `postMultipart` (`:229`, moved to `sttTransport.js`) | Electron net | blocked | A+B | `dictationStt` (captured audio) or `uploadStt` (file) |
| N6 | Batch STT via Gemini, Corti, Tinfoil | `geminiTranscription.js:29`, `cortiAuth.js:23`, `cortiTranscription.js:7`, `tinfoilTranscription.js` | Electron net / Tinfoil SDK | blocked | A+B | inherited task context |
| N7 | Retry transcription | `ipcHandlers.js:5083` (`proxyFetch` `:5075`) | Electron net | blocked | A+B | `dictationStt` |
| N8 | Legacy proxies (xAI, Mistral STT; Anthropic reasoning) | `ipcHandlers.js:3715, 3752, 4440` | Electron net | blocked | A+B | `dictationStt` / `dictationCleanup` |
| N9 | Realtime STT sockets | `ipcHandlers.js:7024, 7051, 8445, 8485, 8615, 8669, 8819, 8959, 8981`; meeting paths `:5846, 6022` | `ws` | blocked | A+B | `dictationStt` / `noteRecordingStt` |
| N10 | Realtime token fetch | `realtimeTokenProviders.js:14-28`, wired `ipcHandlers.js:5938` | Electron net | blocked | A+B | inherited |
| N11 | Tinfoil model catalog | `tinfoilCatalog.js:41` | Tinfoil SDK | blocked | A+B | `providerCheck` |
| N12 | Model downloads (Whisper, Parakeet, diarization, GGUF, MiniLM) | `downloadUtils.js:267 downloadFile`, `:250 fetchJson` | Electron net | blocked | A+B | `modelDownload` |
| N13 | Runtime/GPU binary downloads | `gpuBinaryManager.js:109, 184` (via `downloadUtils`) | Electron net | blocked | A+B | `runtimeDownload` |
| N14 | URL import (direct, proxy, YouTube) | `urlAudioDownloader.js:1525 download`; direct Node path `:1011` (`mod.request`) | Node https / Electron net / yt-dlp child | blocked | A+spawn guard | `urlImport` |
| N15 | yt-dlp self-update | `urlAudioDownloader.js:390 maybeUpdateYtDlp` | child process | blocked | spawn guard | `runtimeDownload` (opaque session; skipped while sealed, stopped on seal, settled on exit) |
| N16 | App update check and download (auto and manual) | `updateManager.js:124 check`, `:143`, `:156` | electron-updater (own session) | blocked | A+B | `appUpdate` |
| N17 | Codex CLI verification | `codexCli.js:309 verifyOfficialCodex` | Node fetch | blocked | A+B | `codex` |
| N18 | Codex app-server (ChatGPT) | `codexAppServer.js:116 start`, `:181 spawn`, `:396 generate` | child process | blocked | A+spawn guard | `codex` (one opaque session per process, written on exit) |
| N19 | Calendar OAuth and API (Google, Microsoft), including a sign-in still waiting in the browser | `googleCalendarOAuth.js:152`, `googleCalendarManager.js:357`, `microsoftCalendarOAuth.js:155, 168`, `microsoftCalendarManager.js:396`; `oauthLoopbackFlow.js:33` | Electron net | blocked | A+B | `calendar` (pending flows cancelled on seal) |
| N20 | Calendar background, focus and wake sync | `calendarSyncInterval.js`; `main.js:566-567, 781-794` through `calendarGuard.js` (Task 11) | Electron net | blocked | A+B | `calendar` (stopped while sealed) |
| N21 | Browser and mail links | `externalUrlOpener.js:35 openExternalUrl` (`shell.openExternal` `:69`, `explorer.exe` spawn `:48`) | OS browser / mail client | allowed after confirmation | main dialog | none (`externalLinkSealed.test.js`) |
| N22 | Loopback sidecars and the dev server (llama-server, whisper-server, Qdrant, Parakeet WS, OAuth loopback page, CLI bridge, Vite) | `llamaServer.js`, `whisperServer.js`, `qdrantManager.js`, `parakeetWsServer.js`, `oauthLoopbackFlow.js`, `cliBridge.js`, `devServerManager.js`, `src/utils/serverUtils.js` (free-port probe) | Node http / ws on 127.0.0.1 | allowed: loopback | B | none (loopback is never recorded) |
| N23 | ONNX utility process (local embeddings/diarization) | `onnxWorkerClient.js:59` `utilityProcess.fork` → `src/workers/onnxWorker.js` (fs, os, path, onnxruntime-node only) | none | n/a: no network | n/a | none |
| N24 | FFmpeg conversions of recorded, imported and uploaded audio | `ffmpegUtils.js:132, 404, 511`; callers `ipcHandlers.js:2987`, `whisperServer.js:1110`, `providerUploadAudio.js:41` | child process | local only: contained | spawn guard | none (`ffmpegContainment.test.js`, Task 6a) |
| N25 | Renderer documents: images, fetch, navigation, preconnect, WebRTC | `src/index.html`, `MarkdownRenderer.tsx`, every `BrowserWindow` (`windowManager.js:119, 1283, 1845, 2047`) | Chromium | blocked | B: Chromium | none, or `unattributed` (Task 16 acceptance run) |
| N26 | Local helper processes (clipboard, key listeners, audio capture, media keys, `tar`/`unzip`, `nvidia-smi`, relaunch) | the `spawn-sites` block below | child process | local only: contained | spawn guard | none |

No UI caller, but **reachable from any renderer through preload**, so gated and tested like live paths: `process-anthropic-reasoning`, `process-enterprise-reasoning`, `enterprise-stream-start`, `bedrock-list-models`, `test-provider-connection`, `test-enterprise-connection`, and the `proxy-{xai,mistral,gemini,corti,tinfoil}-transcription` channels. Dead code with no caller: `whisper.js:482 transcribeViaLan` and `whisperServer.js:454 connectRemote`. Layer B still covers both.

## Files that can open a connection

`test/helpers/egressInventory.test.js` scans for network imports and calls, and requires each hit to be listed here. `main.js` is listed for `tls` (it adds the system CA store at `:28-37`, and opens nothing). Nothing in the renderer (`src/components`, `src/hooks`, `src/stores`, the `src/*.jsx` entry files) matches: the renderer reaches providers only through IPC.

```egress-sites
main.js
src/helpers/assemblyAiStreaming.js
src/helpers/cliBridge.js
src/helpers/codexAppServer.js
src/helpers/codexCli.js
src/helpers/cortiAuth.js
src/helpers/cortiStreaming.js
src/helpers/cortiTranscription.js
src/helpers/deepgramStreaming.js
src/helpers/devServerManager.js
src/helpers/downloadUtils.js
src/helpers/enterpriseAiProviders.js
src/helpers/geminiLiveStreaming.js
src/helpers/geminiTranscription.js
src/helpers/googleCalendarManager.js
src/helpers/googleCalendarOAuth.js
src/helpers/gpuBinaryManager.js
src/helpers/ipcHandlers.js
src/helpers/llamaServer.js
src/helpers/microsoftCalendarManager.js
src/helpers/microsoftCalendarOAuth.js
src/helpers/oauthLoopbackFlow.js
src/helpers/openaiRealtimeStreaming.js
src/helpers/parakeetWsServer.js
src/helpers/personalInference.js
src/helpers/providerConnectionTest.js
src/helpers/qdrantManager.js
src/helpers/realtimeTokenProviders.js
src/helpers/tinfoilCatalog.js
src/helpers/tinfoilRealtimeStreaming.js
src/helpers/tinfoilSecureClient.js
src/helpers/tinfoilTranscription.js
src/helpers/updateManager.js
src/helpers/urlAudioDownloader.js
src/helpers/whisperServer.js
src/utils/serverUtils.js
```

## Processes Loqui starts

Every file in the block below can start a process. The spawn guard (Task 6a) classifies each spawn at run time by its program and call stack, so a file listed here cannot start a network program while sealed, whatever it passes. The table records what each file is *meant* to start, which is what Task 18 re-checks.

| File | Starts | Class |
|---|---|---|
| `codexAppServer.js` | Codex app-server | network (N18) |
| `urlAudioDownloader.js` | yt-dlp (download, self-update) | network (N14, N15) |
| `ffmpegUtils.js`, `ipcHandlers.js:2987` path | FFmpeg | ffmpeg (N24) |
| `externalUrlOpener.js` | `explorer.exe` with a URL (Windows) | OS browser (N21, after confirmation) |
| `llamaServer.js`, `whisperServer.js`, `qdrantManager.js`, `parakeetWsServer.js`, `diarization.js`, `meetingAecManager.js` | local inference sidecars, bound to 127.0.0.1 where they listen | local (N22) |
| `audioTapManager.js`, `audioActivityDetector.js`, `linuxPortalAudioManager.js`, `windowsLoopbackAudioManager.js`, `systemDefaultMicrophone.js` | audio capture helpers | local |
| `clipboard.js`, `selectionManager.js`, `textEditMonitor.js`, `globeKeyManager.js`, `linuxKeyManager.js`, `windowsKeyManager.js`, `linuxWindowInputRegion.js`, `hyprlandShortcut.js`, `gnomeShortcut.js`, `ensureYdotool.js`, `mediaPlayer.js` | paste, selection, hotkey and media-key helpers (`osascript`, `xdotool`, `ydotool`, `playerctl`, …) | local |
| `appleCalendarManager.js` | the EventKit helper | local |
| `downloadUtils.js`, `systemTar.js`, `llamaCppInstaller.js` | `unzip`, `tar`, PowerShell `Expand-Archive`, `which` | local (extraction of an already-downloaded file) |
| `src/utils/gpuDetection.js` | `nvidia-smi` | local |
| `src/utils/process.js` | the shared run-command helper, and `taskkill` | classified per call by the guard |
| `sidecarReaper.js` | `ps` / `tasklist` | local |
| `onnxWorkerClient.js` | `utilityProcess.fork` of `src/workers/onnxWorker.js` | worker (N23) |
| `main.js:9`, `ipcHandlers.js:3082` | Loqui relaunching itself | local (the new process boots with the guards) |

```spawn-sites
main.js
src/helpers/appleCalendarManager.js
src/helpers/audioActivityDetector.js
src/helpers/audioTapManager.js
src/helpers/clipboard.js
src/helpers/codexAppServer.js
src/helpers/diarization.js
src/helpers/downloadUtils.js
src/helpers/ensureYdotool.js
src/helpers/externalUrlOpener.js
src/helpers/ffmpegUtils.js
src/helpers/globeKeyManager.js
src/helpers/gnomeShortcut.js
src/helpers/hyprlandShortcut.js
src/helpers/ipcHandlers.js
src/helpers/linuxKeyManager.js
src/helpers/linuxPortalAudioManager.js
src/helpers/linuxWindowInputRegion.js
src/helpers/llamaCppInstaller.js
src/helpers/llamaServer.js
src/helpers/mediaPlayer.js
src/helpers/meetingAecManager.js
src/helpers/onnxWorkerClient.js
src/helpers/parakeetWsServer.js
src/helpers/qdrantManager.js
src/helpers/selectionManager.js
src/helpers/sidecarReaper.js
src/helpers/systemDefaultMicrophone.js
src/helpers/systemTar.js
src/helpers/textEditMonitor.js
src/helpers/urlAudioDownloader.js
src/helpers/whisperServer.js
src/helpers/windowsKeyManager.js
src/helpers/windowsLoopbackAudioManager.js
src/utils/gpuDetection.js
src/utils/process.js
```
````

Later tasks extend the blocks in the same commit that adds the file: `sttTransport.js` (Task 9), `privacy/gatedFetch.js` (Task 8) and `selfHostedProbe.js` (Task 11a). The ratchet fails until they do.

- [ ] **Step 4: Add the sealed column to the public inventory**

In `docs/network-allowlist.md`, append a column `Sealed mode` to the table, with `Blocked` in every row. Then add this paragraph after the table:

```markdown
**Sealed mode** (Settings › Privacy & Data) blocks every group above in Loqui's main process, its windows and the programs it starts: provider requests, model and runtime downloads, update checks, Codex, calendars and URL import. Only loopback (`localhost`, `127.0.0.0/8`, `::1`) stays reachable, so on-device models keep working. Links open in your browser only after you confirm, because your browser's traffic is outside Sealed mode. The per-path decisions, and the tests that keep this list complete, are in [`docs/security/sealed-mode-threat-model.md`](security/sealed-mode-threat-model.md).
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- test/helpers/egressInventory.test.js`
Expected: PASS (5 tests). If a scan test lists a file, read it, decide its sealed policy or classify what it starts, then add it to the right table and block.

- [ ] **Step 6: Commit**

```bash
git add docs/security/sealed-mode-threat-model.md docs/network-allowlist.md test/helpers/egressInventory.test.js
git commit -m "docs(privacy): add Sealed mode threat model and the egress and spawn inventory ratchets"
```

---

### Task 2: Egress policy, the pure decision

**Files:**
- Create: `src/helpers/privacy/egressPolicy.js`
- Test: `test/helpers/egressPolicy.test.js`

**Interfaces:**
- Produces (CommonJS):
  - `ROUTE_TASKS`: the 11 §5.1 `RouteId`s, in order.
  - `PURPOSE_TASKS`: `["providerCheck","modelDownload","runtimeDownload","urlImport","appUpdate","codex","calendar","unattributed"]`.
  - `EGRESS_TASKS`: the 19 tasks, routes first.
  - `SCOPE_TO_TASK` and `taskForScope(scope: string): EgressTask`. An unknown scope returns `"unattributed"`.
  - `normalizeHost(host: string): string | null` and `hostOf(target: string | URL | {host?, hostname?}): string | null`.
  - `isLoopbackHost(host: string | null): boolean`.
  - `decideEgress({ sealed: boolean, target }): { allow: boolean, host: string, loopback: boolean, reason: "loopback" | "sealed" | "unsealed" }`.
  - `SEALED_MODE = "SEALED_MODE"`.
  - `class SealedModeError extends Error`, constructed as `new SealedModeError({ task, host, phase = "refused" })`. It has `code: "SEALED_MODE"` and `details: { task, host, phase }`.
    - A `"refused"` error means main stopped the request before any socket opened. Its `messageKey` is `"sealedMode.blocked.generic"` and its message contains `[SEALED_MODE]`.
    - An `"interrupted"` error means sealing cut off a request that was already under way, so the provider may have received part of it. Its `messageKey` is `"sealedMode.interrupted.generic"` and its message contains `[SEALED_MODE:interrupted]`.
    - The UI may say "nothing was sent" only for `"refused"`.
  - `isSealedModeError(error: unknown): boolean`. It checks `code`, the message marker, and up to three levels of `cause`.
  - `sealedPhaseOf(error: unknown): "refused" | "interrupted" | null`. It reads `details.phase` or the message marker.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/egressPolicy.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const policy = require("../../src/helpers/privacy/egressPolicy");

test("task ids: the 11 route ids first, then the non-route purposes", () => {
  assert.deepEqual(policy.ROUTE_TASKS, [
    "dictationStt", "noteRecordingStt", "uploadStt", "dictationCleanup", "voiceAssistant",
    "assistantVision", "translation", "noteFormatting", "chat", "speakerId", "semanticSearch",
  ]);
  assert.equal(policy.EGRESS_TASKS.length, 19);
  assert.ok(policy.EGRESS_TASKS.includes("unattributed"));
});

test("inference scopes map to route tasks; unknown scopes are unattributed", () => {
  assert.equal(policy.taskForScope("dictationCleanup"), "dictationCleanup");
  assert.equal(policy.taskForScope("dictationAgent"), "voiceAssistant");
  assert.equal(policy.taskForScope("dictationAgentVision"), "assistantVision");
  assert.equal(policy.taskForScope("noteFormatting"), "noteFormatting");
  assert.equal(policy.taskForScope("chatIntelligence"), "chat");
  assert.equal(policy.taskForScope("dictationTranslation"), "translation");
  assert.equal(policy.taskForScope("somethingNew"), "unattributed");
});

test("hostOf reduces any target to a bare lowercase host", () => {
  assert.equal(policy.hostOf("https://user:pw@API.OpenAI.com/v1/chat?q=secret#x"), "api.openai.com");
  assert.equal(policy.hostOf(new URL("http://[::1]:8080/v1")), "::1");
  assert.equal(policy.hostOf({ hostname: "Example.COM." }), "example.com");
  assert.equal(policy.hostOf({ host: "example.com:443" }), "example.com");
  assert.equal(policy.hostOf("not a url"), null);
  assert.equal(policy.hostOf(undefined), null);
});

test("loopback classification", () => {
  for (const url of [
    "http://localhost:11434/v1",
    "http://LOCALHOST.:8080",
    "http://[::1]:8080",
    "http://127.0.0.2:9000",
    "http://[::ffff:127.0.0.1]/",
    "http://[0:0:0:0:0:0:0:1]/",
    "http://app.localhost:5173/", // RFC 6761: *.localhost is loopback; the backstop pins it (Task 6)
  ]) {
    assert.equal(policy.isLoopbackHost(policy.hostOf(url)), true, url);
  }
  for (const url of [
    "http://192.168.1.5:8080",
    "http://localhost.evil.example",
    "http://127.0.0.1.nip.io",
    "http://0.0.0.0:8080",
    "http://[::ffff:10.0.0.1]/",
    "https://api.openai.com",
  ]) {
    assert.equal(policy.isLoopbackHost(policy.hostOf(url)), false, url);
  }
  assert.equal(policy.isLoopbackHost(null), false);
  assert.equal(policy.isLoopbackHost(""), false);
});

test("decideEgress: loopback always allowed, everything else denied while sealed", () => {
  assert.deepEqual(policy.decideEgress({ sealed: true, target: "http://127.0.0.1:8080/v1" }), {
    allow: true, host: "127.0.0.1", loopback: true, reason: "loopback",
  });
  assert.deepEqual(policy.decideEgress({ sealed: true, target: "https://api.groq.com/x" }), {
    allow: false, host: "api.groq.com", loopback: false, reason: "sealed",
  });
  assert.deepEqual(policy.decideEgress({ sealed: false, target: "https://api.groq.com/x" }), {
    allow: true, host: "api.groq.com", loopback: false, reason: "unsealed",
  });
  // An unparseable target fails closed while sealed and is labelled "unknown".
  assert.equal(policy.decideEgress({ sealed: true, target: "%%%" }).allow, false);
  assert.equal(policy.decideEgress({ sealed: true, target: "%%%" }).host, "unknown");
});

test("SealedModeError survives IPC message-only serialisation and fetch causes", () => {
  const error = new policy.SealedModeError({ task: "chat", host: "api.groq.com" });
  assert.equal(error.code, "SEALED_MODE");
  assert.equal(error.messageKey, "sealedMode.blocked.generic");
  assert.deepEqual(error.details, { task: "chat", host: "api.groq.com", phase: "refused" });
  assert.match(error.message, /\[SEALED_MODE\]/);
  // ipcMain.handle keeps only the message of a rejected promise.
  assert.equal(policy.isSealedModeError(new Error(`Error invoking remote method: ${error.message}`)), true);
  // undici wraps connect errors as TypeError("fetch failed", { cause }).
  assert.equal(policy.isSealedModeError(new TypeError("fetch failed", { cause: error })), true);
  assert.equal(policy.isSealedModeError(new Error("ECONNREFUSED")), false);
  assert.equal(policy.isSealedModeError(null), false);
});

test("a request cut off by sealing is 'interrupted', never 'nothing was sent'", () => {
  const cut = new policy.SealedModeError({ task: "chat", host: "api.groq.com", phase: "interrupted" });
  assert.equal(cut.messageKey, "sealedMode.interrupted.generic");
  assert.match(cut.message, /\[SEALED_MODE:interrupted\]/);
  assert.equal(policy.sealedPhaseOf(cut), "interrupted");
  assert.equal(policy.sealedPhaseOf(new Error(`remote: ${cut.message}`)), "interrupted");
  assert.equal(policy.sealedPhaseOf(new policy.SealedModeError({ task: "chat", host: "x" })), "refused");
  assert.equal(policy.sealedPhaseOf(new Error("timeout")), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/helpers/egressPolicy.test.js`
Expected: FAIL with `Cannot find module '../../src/helpers/privacy/egressPolicy'`.

- [ ] **Step 3: Implement**

Create `src/helpers/privacy/egressPolicy.js`:

```js
const net = require("node:net");

// The first eleven ids are the route ids from the overhaul spec §5.1, in order;
// the rest are purposes that are not user routes. The flight recorder accepts
// only these values in its `task` column.
const ROUTE_TASKS = Object.freeze([
  "dictationStt",
  "noteRecordingStt",
  "uploadStt",
  "dictationCleanup",
  "voiceAssistant",
  "assistantVision",
  "translation",
  "noteFormatting",
  "chat",
  "speakerId",
  "semanticSearch",
]);
const PURPOSE_TASKS = Object.freeze([
  "providerCheck",
  "modelDownload",
  "runtimeDownload",
  "urlImport",
  "appUpdate",
  "codex",
  "calendar",
  "unattributed",
]);
const EGRESS_TASKS = Object.freeze([...ROUTE_TASKS, ...PURPOSE_TASKS]);

// personalInference.validateRequest() already coerces unknown scopes to
// dictationCleanup; this map is the only place scope names meet route names.
const SCOPE_TO_TASK = Object.freeze({
  dictationCleanup: "dictationCleanup",
  dictationAgent: "voiceAssistant",
  dictationAgentVision: "assistantVision",
  noteFormatting: "noteFormatting",
  chatIntelligence: "chat",
  dictationTranslation: "translation",
});

function taskForScope(scope) {
  return SCOPE_TO_TASK[scope] ?? "unattributed";
}

function normalizeHost(value) {
  if (typeof value !== "string") return null;
  let host = value.trim().toLowerCase();
  if (host.startsWith("[")) host = host.slice(1, host.indexOf("]") === -1 ? undefined : host.indexOf("]"));
  // "host:port" from an options object; IPv6 literals have more than one colon.
  else if ((host.match(/:/g) || []).length === 1) host = host.slice(0, host.indexOf(":"));
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host || null;
}

function hostOf(target) {
  if (target == null) return null;
  if (typeof target === "object" && !(target instanceof URL)) {
    return normalizeHost(target.hostname ?? target.host ?? null);
  }
  try {
    return normalizeHost(new URL(String(target)).hostname);
  } catch {
    return null;
  }
}

// Loopback only. A LAN address is another machine (CCR-1), 0.0.0.0 is not an
// address you send to, and any other name that merely resolves to 127.0.0.1 is
// not trusted because DNS is outside our control.
function isLoopbackHost(value) {
  const host = normalizeHost(value ?? "");
  if (!host) return false;
  // RFC 6761 reserves localhost and *.localhost for loopback. The backstop
  // answers these names itself (Task 6), so DNS can never steer them elsewhere.
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (net.isIPv4(host)) return host.split(".")[0] === "127";
  if (!net.isIPv6(host)) return false;
  if (host === "::1" || /^(?:0{1,4}:){7}0{0,3}1$/.test(host)) return true;
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  if (dotted) return dotted[1].split(".")[0] === "127";
  // WHATWG URL parsing turns ::ffff:127.0.0.1 into ::ffff:7f00:1.
  const hex = /^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/.exec(host);
  return !!hex && parseInt(hex[1], 16) >> 8 === 127;
}

function decideEgress({ sealed, target }) {
  const host = hostOf(target);
  if (isLoopbackHost(host)) return { allow: true, host, loopback: true, reason: "loopback" };
  const label = host ?? "unknown";
  if (sealed) return { allow: false, host: label, loopback: false, reason: "sealed" };
  return { allow: true, host: label, loopback: false, reason: "unsealed" };
}

const SEALED_MODE = "SEALED_MODE";

class SealedModeError extends Error {
  // phase "refused": stopped before any socket opened, so nothing was sent.
  // phase "interrupted": cut off mid-flight; the provider may have part of it.
  constructor({ task, host, phase = "refused" }) {
    // ipcMain.handle keeps only the message of a rejected promise (see the
    // serializeIpcError comment in ipcHandlers.js), so the code and phase are
    // also in the text, where the renderer can recognise them.
    super(
      phase === "interrupted"
        ? `[${SEALED_MODE}:interrupted] Sealed mode was turned on while ${task} to ${host} was in progress, so it was stopped.`
        : `[${SEALED_MODE}] Sealed mode is on, so ${task} to ${host} was blocked before anything was sent.`
    );
    this.name = "SealedModeError";
    this.code = SEALED_MODE;
    this.messageKey = phase === "interrupted" ? "sealedMode.interrupted.generic" : "sealedMode.blocked.generic";
    this.details = { task, host, phase };
  }
}

function isSealedModeError(error, depth = 0) {
  if (!error || depth > 3) return false;
  if (error.code === SEALED_MODE) return true;
  if (typeof error.message === "string" && error.message.includes(`[${SEALED_MODE}`)) return true;
  return isSealedModeError(error.cause, depth + 1);
}

function sealedPhaseOf(error, depth = 0) {
  if (!error || depth > 3) return null;
  if (error.details?.phase === "refused" || error.details?.phase === "interrupted") return error.details.phase;
  if (typeof error.message === "string") {
    if (error.message.includes(`[${SEALED_MODE}:interrupted]`)) return "interrupted";
    if (error.message.includes(`[${SEALED_MODE}]`)) return "refused";
  }
  if (error.code === SEALED_MODE) return "refused";
  return sealedPhaseOf(error.cause, depth + 1);
}

module.exports = {
  ROUTE_TASKS,
  PURPOSE_TASKS,
  EGRESS_TASKS,
  SCOPE_TO_TASK,
  taskForScope,
  normalizeHost,
  hostOf,
  isLoopbackHost,
  decideEgress,
  SEALED_MODE,
  SealedModeError,
  isSealedModeError,
  sealedPhaseOf,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/helpers/egressPolicy.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/helpers/privacy/egressPolicy.js test/helpers/egressPolicy.test.js
git commit -m "feat(privacy): add pure egress policy and SealedModeError"
```

---

### Task 3: The persisted sealed switch, which fails closed

**Files:**
- Create: `src/helpers/privacy/sealedState.js`
- Test: `test/helpers/sealedState.test.js`

**Interfaces:**
- Produces `class SealedState extends EventEmitter`:
  - `new SealedState({ profile: string, now?: () => number })`. It loads `<profile>/privacy.json` synchronously.
  - `isSealed(): boolean`.
  - `snapshot(): { sealed: boolean; sealedSince: number | null; loadError: "corrupt" | "unreadable" | null; saveError: string | null }`.
  - `set(sealed: boolean): Snapshot`. It persists with tmp+rename at mode `0o600`, emits `"change"` with the snapshot when the value changes, and throws `TypeError` for a non-boolean.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/sealedState.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { SealedState } = require("../../src/helpers/privacy/sealedState");

function profile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-sealed-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("a fresh profile is unsealed", (t) => {
  const state = new SealedState({ profile: profile(t) });
  assert.deepEqual(state.snapshot(), { sealed: false, sealedSince: null, loadError: null, saveError: null });
});

test("sealing persists with 0600 and survives a restart", (t) => {
  const dir = profile(t);
  const state = new SealedState({ profile: dir, now: () => 1000 });
  const changes = [];
  state.on("change", (s) => changes.push(s.sealed));
  state.set(true);
  assert.deepEqual(changes, [true]);
  const file = path.join(dir, "privacy.json");
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const again = new SealedState({ profile: dir, now: () => 2000 });
  assert.equal(again.isSealed(), true);
  assert.equal(again.snapshot().sealedSince, 1000);
});

test("setting the same value is a no-op and does not reset sealedSince", (t) => {
  let clock = 1000;
  const state = new SealedState({ profile: profile(t), now: () => clock });
  state.set(true);
  clock = 5000;
  let fired = 0;
  state.on("change", () => fired++);
  state.set(true);
  assert.equal(fired, 0);
  assert.equal(state.snapshot().sealedSince, 1000);
});

test("a corrupt file fails closed", (t) => {
  const dir = profile(t);
  fs.writeFileSync(path.join(dir, "privacy.json"), '{"sealed": tru');
  const state = new SealedState({ profile: dir, now: () => 7 });
  assert.equal(state.isSealed(), true);
  assert.equal(state.snapshot().loadError, "corrupt");
  assert.equal(state.snapshot().sealedSince, 7);
});

test("a non-boolean sealed value fails closed", (t) => {
  const dir = profile(t);
  fs.writeFileSync(path.join(dir, "privacy.json"), JSON.stringify({ sealed: "no" }));
  assert.equal(new SealedState({ profile: dir }).snapshot().loadError, "corrupt");
});

test("an unreadable file fails closed", { skip: process.platform === "win32" || process.getuid?.() === 0 }, (t) => {
  const dir = profile(t);
  const file = path.join(dir, "privacy.json");
  fs.writeFileSync(file, JSON.stringify({ sealed: false }));
  fs.chmodSync(file, 0o000);
  t.after(() => fs.chmodSync(file, 0o600));
  const state = new SealedState({ profile: dir });
  assert.equal(state.isSealed(), true);
  assert.equal(state.snapshot().loadError, "unreadable");
});

test("confirming the seal after a load error rewrites the file and clears the error", (t) => {
  const dir = profile(t);
  fs.writeFileSync(path.join(dir, "privacy.json"), "garbage");
  const state = new SealedState({ profile: dir, now: () => 9 });
  state.set(true);
  assert.equal(state.snapshot().loadError, null);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "privacy.json"), "utf8")).sealed, true);
});

test("a failed save keeps the in-memory value and reports saveError", { skip: process.platform === "win32" || process.getuid?.() === 0 }, (t) => {
  const dir = profile(t);
  fs.chmodSync(dir, 0o500);
  t.after(() => fs.chmodSync(dir, 0o700));
  const state = new SealedState({ profile: dir });
  state.set(true);
  assert.equal(state.isSealed(), true);
  assert.match(state.snapshot().saveError, /EACCES|EPERM/);
});

test("set rejects non-booleans", (t) => {
  const state = new SealedState({ profile: profile(t) });
  assert.throws(() => state.set("true"), TypeError);
  assert.throws(() => state.set(1), TypeError);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/helpers/sealedState.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

Create `src/helpers/privacy/sealedState.js`:

```js
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

// Main-owned, like updates.json (updateManager.js). Read synchronously at boot,
// before any helper that can open a connection is required. Any doubt about
// the stored value means sealed: a user who sealed must never be unsealed by
// a damaged file.
class SealedState extends EventEmitter {
  constructor({ profile, now = Date.now }) {
    super();
    this.file = path.join(profile, "privacy.json");
    this.now = now;
    this.sealed = false;
    this.sealedSince = null;
    this.loadError = null;
    this.saveError = null;
    let text = null;
    try {
      text = fs.readFileSync(this.file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") this._failClosed("unreadable");
    }
    if (text !== null) {
      try {
        const saved = JSON.parse(text);
        if (typeof saved?.sealed !== "boolean") throw new Error("sealed is not a boolean");
        this.sealed = saved.sealed;
        this.sealedSince = saved.sealed
          ? Number.isFinite(saved.sealedSince)
            ? saved.sealedSince
            : this.now()
          : null;
      } catch {
        this._failClosed("corrupt");
      }
    }
  }

  _failClosed(reason) {
    this.sealed = true;
    this.sealedSince = this.now();
    this.loadError = reason;
  }

  isSealed() {
    return this.sealed;
  }

  snapshot() {
    return {
      sealed: this.sealed,
      sealedSince: this.sealedSince,
      loadError: this.loadError,
      saveError: this.saveError,
    };
  }

  set(sealed) {
    if (typeof sealed !== "boolean") throw new TypeError("sealed must be a boolean");
    if (sealed === this.sealed && !this.loadError) return this.snapshot();
    const changed = sealed !== this.sealed;
    this.sealedSince = sealed ? (this.sealed && this.sealedSince) || this.now() : null;
    this.sealed = sealed;
    this.loadError = null;
    this._save();
    if (changed) this.emit("change", this.snapshot());
    return this.snapshot();
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ sealed: this.sealed, sealedSince: this.sealedSince }), {
        mode: 0o600,
      });
      fs.renameSync(tmp, this.file);
      this.saveError = null;
    } catch (error) {
      // The in-memory value stays authoritative for this session. The UI
      // warns that a seal which could not be saved is off after restart.
      this.saveError = error.code || error.message;
    }
  }
}

module.exports = { SealedState };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/helpers/sealedState.test.js`
Expected: PASS. On macOS and Linux as a non-root user, all 9 pass; the two permission tests skip on Windows and as root.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/privacy/sealedState.js test/helpers/sealedState.test.js
git commit -m "feat(privacy): persist Sealed mode in privacy.json and fail closed"
```

---
### Task 4: Flight recorder store and schema

**Files:**
- Create: `src/helpers/privacy/flightRecorder.js`
- Modify: `src/helpers/localDatabaseSchema.js`. Add the `egress_events` table and index directly after the line `CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics_events(local_date);` (currently `:318`). Anchor on that text, not the number.
- Test: `test/helpers/flightRecorder.test.js`. It must contain `require("./harness/db")`; see Global Constraints.

**Interfaces:**
- Produces `class FlightRecorder extends EventEmitter`:
  - `new FlightRecorder({ db?: BetterSqlite3.Database | null, now?: () => number })`. It starts in **pending** mode: main has not yet heard the user's retention settings.
  - `attachDatabase(db)`. Keeps the handle; writes nothing yet.
  - `setPersistence(enabled: boolean)`. Main calls it on every retention sync with `dataRetentionEnabled`.
    - **`true`:**
      - Rows recorded while *pending* are flushed to SQLite in one transaction, and leave memory only after the transaction commits.
      - Rows recorded while *explicitly memory-only* are never flushed, so turning history back on does not make them durable.
      - Later rows are written to SQLite.
    - **`false`:** later rows stay in memory, and nothing more is written to disk.
  - `record(event: EgressEventInput): EgressEvent`. It throws `TypeError` for an unknown task or outcome, or for a host that is not bare, and emits `"event"`. A failed insert keeps the row in memory as pending, sets `persistError`, and retries on the next `prune()`.
  - `list({ since?: number, limit?: number }): EgressEvent[]`. Newest first by start time; the limit is clamped to 1..`MAX_ROWS`.
  - `summary({ since?: number }): { left, observed, connections, blocked, unattributed, unattributedHosts, bytesOut, bytesIn, unknownBytes, opaqueSessions }`.
    - `observed` counts `request` and `stream` rows that were not blocked: requests Loqui saw leave, one row each.
    - `connections` counts `connection` rows: connections Loqui saw but whose requests it could not inspect.
    - `opaqueSessions` counts `session` rows.
    - `left` is the sum of those three.
    - `operation` rows (authorised work that never reached a transport) and blocked rows are not in `left`.
  - `clear(): void`. Emits `"cleared"`.
  - `prune({ retentionDays: number, maxRows?: number }): { deleted: number }`.
  - `persistError: string | null`.
- Also produces `toCsv(events: EgressEvent[]): string`, `ERROR_CLASSES`, `KINDS`, `MAX_ROWS = 100000`, `MEMORY_LIMIT = 500` and `CAP_CHECK_EVERY = 500`. The row cap is enforced on insert, every `CAP_CHECK_EVERY` writes, so the table never exceeds `MAX_ROWS + CAP_CHECK_EVERY` rows between sweeps.
- Types:
  - `EgressEventInput` is `{ ts?, endedAt?, task, host, hosts?, kind?: "request"|"stream"|"connection"|"session"|"operation", operationId?, bytesOut?, bytesIn?, outcome: "ok"|"error"|"blocked"|"cancelled", status?, errorClass?, model?, attributed?, opaque? }`. `kind` defaults to `"session"` when `opaque` is true, and to `"request"` otherwise.
  - `EgressEvent` is the same, plus `id`. Every optional field is normalised to a value or `null`; `hosts` is a `string[]`, and `attributed` and `opaque` are booleans (`opaque` is `kind === "session"`).
  - **What a row is (I3).**
    - `request`: one HTTP request the gate or the Chromium backstop saw, with its own start, end, bytes, status and host trail.
    - `stream`: one realtime socket session.
    - `connection`: a Node connection whose requests Loqui could not inspect. It is either an unexplained socket, or an operation whose SDK took no metered fetch. It is recorded when the connection closes.
    - `session`: one opaque child process run.
    - `operation`: authorised work that failed before any transport. It is kept for diagnosis, and never counted as having left.
    - `operationId` is the gate ticket id, the same within one operation. It groups an operation's requests (two calls of one SDK, or a retry) without merging them. It is an integer, not content.
  - **Identifiers only (N1).**
    - `model` is stored only if it is an identifier: letters, digits and `. _ : / @ + -`, up to 120 characters. It must contain no `//`, no `user:secret@` shape, and no 32-character run of letters, digits or underscores (the shape of an API key). Anything else is stored as `null`. The value sent to the provider is not changed.
    - `errorClass` is one of `ERROR_CLASSES`, a bounded set of categories. Anything else is stored as `"OTHER"`.
    - So no URL, query, credential or free-text message can reach the row or the CSV.
  - `ts` is when the request started (authorisation, or the first transport event for unattributed traffic). `endedAt` is when it settled.
  - `hosts` is the ordered, de-duplicated trail of bare hosts the request contacted: the declared host, sockets observed in its context, and redirects, up to 8. `host` is its first entry.
  - An **opaque** row is one session of a child process that does its own networking: the Codex app-server or yt-dlp (owner decision, 2026-10-15). Loqui sees that the session ran and its usual host, but cannot see its requests or bytes. Its bytes are therefore always `null`, and the UI labels it as a session with its usual host.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/flightRecorder.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { createDb } = require("./harness/db");
const { FlightRecorder, toCsv, MEMORY_LIMIT } = require("../../src/helpers/privacy/flightRecorder");

const DAY = 24 * 60 * 60 * 1000;
const base = { task: "chat", host: "api.groq.com", outcome: "ok", bytesOut: 3100, bytesIn: 9800 };
const rowCount = (db) => db.prepare("SELECT COUNT(*) AS n FROM egress_events").get().n;

function persistent(t, now) {
  const manager = createDb(t);
  if (!manager) return null;
  const recorder = new FlightRecorder({ now });
  recorder.attachDatabase(manager.db);
  recorder.setPersistence(true);
  return { recorder, db: manager.db };
}

test("the schema has metadata columns only", (t) => {
  const manager = createDb(t);
  if (!manager) return;
  const columns = manager.db.prepare("PRAGMA table_info(egress_events)").all().map((c) => c.name);
  assert.deepEqual(columns, [
    "id", "ts", "ended_at", "task", "host", "hosts", "bytes_out", "bytes_in", "outcome", "status",
    "error_class", "model", "attributed", "opaque", "kind", "operation_id",
  ]);
});

test("record and list: newest first, normalised public shape with a host trail", (t) => {
  let clock = 1000;
  const ctx = persistent(t, () => clock);
  if (!ctx) return;
  ctx.recorder.record(base);
  clock = 2000;
  ctx.recorder.record({
    ...base, task: "modelDownload", host: "huggingface.co", hosts: ["huggingface.co", "cdn-lfs.hf.co", "huggingface.co"],
    ts: 1500, endedAt: 2000, bytesOut: undefined, status: 200,
  });
  const rows = ctx.recorder.list();
  assert.equal(rows.length, 2);
  assert.deepEqual({ ...rows[0], id: 0 }, {
    id: 0, ts: 1500, endedAt: 2000, task: "modelDownload", host: "huggingface.co", hosts: ["huggingface.co", "cdn-lfs.hf.co"],
    bytesOut: null, bytesIn: 9800, outcome: "ok", status: 200, errorClass: null, model: null, attributed: true, opaque: false,
    kind: "request", operationId: null,
  });
  assert.equal(rows[1].task, "chat");
  assert.deepEqual(rows[1].hosts, ["api.groq.com"]);
});

test("record rejects non-host values, in host and in the trail, and unknown enums", () => {
  const recorder = new FlightRecorder();
  for (const host of ["https://api.openai.com/v1", "api.openai.com/v1", "user@host", "a host", "host?q=1", ""]) {
    assert.throws(() => recorder.record({ ...base, host }), TypeError, host);
    assert.throws(() => recorder.record({ ...base, hosts: ["api.groq.com", host] }), TypeError, `trail: ${host}`);
  }
  assert.throws(() => recorder.record({ ...base, task: "telemetry" }), TypeError);
  assert.throws(() => recorder.record({ ...base, outcome: "maybe" }), TypeError);
});

test("bytes: unknown stays null, never 0; negatives are unknown; opaque sessions never carry bytes", () => {
  const recorder = new FlightRecorder();
  const row = recorder.record({ ...base, bytesOut: undefined, bytesIn: -5 });
  assert.deepEqual([row.bytesOut, row.bytesIn], [null, null]);
  assert.equal(recorder.record({ ...base, outcome: "blocked", bytesOut: 0, bytesIn: 0 }).bytesOut, 0);
  const session = recorder.record({ task: "codex", host: "chatgpt.com", outcome: "ok", opaque: true, bytesOut: 10, bytesIn: 20 });
  assert.deepEqual([session.opaque, session.bytesOut, session.bytesIn], [true, null, null]);
});

test("model ids and error classes are identifiers or nothing: no URL, credential or free text reaches SQLite or the CSV", (t) => {
  const ctx = persistent(t, () => 5);
  if (!ctx) return;
  const hostile = [
    "https://user:password@example/v1?key=secret",
    "user:password@host",
    "//cdn.example/x",
    "gpt-4o?key=secret",
    "please summarise my secret notes",
    "sk-proj-" + "A".repeat(48),
    "a=b&c=d",
    "gpt\n-4o\u0000",
    "x".repeat(200),
  ];
  for (const value of hostile) ctx.recorder.record({ ...base, model: value, errorClass: value });
  for (const row of ctx.db.prepare("SELECT model, error_class FROM egress_events").all()) {
    assert.equal(row.model, null);
    assert.equal(row.error_class, "OTHER");
  }
  const csv = toCsv(ctx.recorder.list({ limit: 100 }));
  for (const fragment of ["password", "secret", "cdn.example", "summarise", "AAAAAAAA", "key="]) assert.equal(csv.includes(fragment), false, fragment);
  for (const ok of ["gpt-4o-mini", "claude-3-5-sonnet@20240620", "accounts/fireworks/models/llama-v3p1-8b", "anthropic.claude-3-haiku-20240307-v1:0", "qwen3.5-2b-q4_k_m"]) {
    assert.equal(ctx.recorder.record({ ...base, model: ok }).model, ok);
  }
  assert.equal(ctx.recorder.record({ ...base, errorClass: "HTTP_5XX" }).errorClass, "HTTP_5XX");
});

test("pending rows flush on the first sync; memory-only rows never become durable", (t) => {
  const manager = createDb(t);
  if (!manager) return;
  const recorder = new FlightRecorder({ now: () => 5 });
  recorder.attachDatabase(manager.db);
  recorder.record({ ...base, model: "pending" });          // before main heard the settings
  recorder.setPersistence(true);
  assert.equal(rowCount(manager.db), 1, "the pending row is flushed");
  recorder.setPersistence(false);
  recorder.record({ ...base, model: "while-off" });        // history explicitly off
  assert.equal(rowCount(manager.db), 1);
  recorder.setPersistence(true);
  assert.equal(rowCount(manager.db), 1, "turning history back on does not flush what was recorded while it was off");
  assert.deepEqual(recorder.list().map((r) => r.model).sort(), ["pending", "while-off"]);
  recorder.record({ ...base, model: "after" });
  assert.equal(rowCount(manager.db), 2);
});

test("restart: saved rows survive; rows kept in memory while history was off do not", (t) => {
  const manager = createDb(t);
  if (!manager) return;
  const before = new FlightRecorder({ now: () => 5 });
  before.attachDatabase(manager.db);
  before.setPersistence(true);
  before.record({ ...base, model: "saved" });
  before.setPersistence(false);
  before.record({ ...base, model: "memory-only" });
  // A new process: same database, a fresh recorder, history still off at first sync.
  const after = new FlightRecorder({ now: () => 6 });
  after.attachDatabase(manager.db);
  after.setPersistence(false);
  assert.deepEqual(after.list().map((r) => r.model), ["saved"], "existing saved rows stay visible; nothing from memory came back");
  after.setPersistence(true);
  assert.equal(rowCount(manager.db), 1);
});

test("history off from the first sync: pending rows stay in memory and are never written", (t) => {
  const manager = createDb(t);
  if (!manager) return;
  const recorder = new FlightRecorder({ now: () => 5 });
  recorder.attachDatabase(manager.db);
  recorder.record(base);
  recorder.setPersistence(false);
  recorder.setPersistence(true);
  assert.equal(rowCount(manager.db), 0);
  assert.equal(recorder.list().length, 1);
});

test("a failed flush keeps the pending rows in memory and reports persistError", () => {
  const failingDb = {
    prepare: (sql) => ({
      run: () => { throw Object.assign(new Error("disk full"), { code: "SQLITE_FULL" }); },
      all: () => [],
      get: () => ({ n: 0 }),
    }),
    transaction: (fn) => () => fn(),
  };
  const recorder = new FlightRecorder({ now: () => 5 });
  recorder.attachDatabase(failingDb);
  recorder.record(base);
  recorder.setPersistence(true);
  assert.equal(recorder.persistError, "SQLITE_FULL");
  assert.equal(recorder.list().length, 1, "nothing was lost");
});

test("memory mode keeps only the newest MEMORY_LIMIT rows", () => {
  const recorder = new FlightRecorder();
  for (let i = 0; i < MEMORY_LIMIT + 10; i++) recorder.record({ ...base, ts: i });
  const rows = recorder.list({ limit: 100000 });
  assert.equal(rows.length, MEMORY_LIMIT);
  assert.equal(rows[0].ts, MEMORY_LIMIT + 9);
});

test("prune deletes rows older than retentionDays and caps the table", (t) => {
  const clock = 100 * DAY;
  const ctx = persistent(t, () => clock);
  if (!ctx) return;
  ctx.recorder.record({ ...base, ts: clock - 40 * DAY });
  ctx.recorder.record({ ...base, ts: clock - 10 * DAY });
  ctx.recorder.record({ ...base, ts: clock - 1 * DAY });
  assert.deepEqual(ctx.recorder.prune({ retentionDays: 30 }), { deleted: 1 });
  assert.equal(ctx.recorder.list({ since: 0 }).length, 2);
  // 0 means "forever" (transcriptRetentionDays semantics); only the row cap applies.
  assert.deepEqual(ctx.recorder.prune({ retentionDays: 0, maxRows: 1 }), { deleted: 1 });
  assert.equal(ctx.recorder.list({ since: 0 })[0].ts, clock - 1 * DAY);
});

test("summary counts requests, connections and sessions apart; operations that never left are not counted", () => {
  const recorder = new FlightRecorder();
  recorder.record({ ...base, operationId: 7 });
  recorder.record({ ...base, bytesOut: null, operationId: 7 }); // a second request of the same operation
  recorder.record({ ...base, outcome: "blocked", bytesOut: 0, bytesIn: 0 });
  recorder.record({ task: "unattributed", host: "x.example.com", outcome: "ok", attributed: false });
  recorder.record({ task: "unattributed", host: "y.example.com", kind: "connection", outcome: "ok", attributed: false });
  recorder.record({ task: "codex", host: "chatgpt.com", outcome: "ok", opaque: true });
  recorder.record({ task: "chat", host: "api.groq.com", kind: "operation", outcome: "error", errorClass: "OTHER" });
  assert.deepEqual(recorder.summary({ since: 0 }), {
    left: 5, observed: 3, connections: 1, blocked: 1, unattributed: 2, unattributedHosts: ["x.example.com", "y.example.com"],
    bytesOut: 3100, bytesIn: 19600, unknownBytes: 2, opaqueSessions: 1,
  });
});

test("clear empties disk and memory and emits cleared", (t) => {
  const ctx = persistent(t, () => 1);
  if (!ctx) return;
  let cleared = 0;
  ctx.recorder.on("cleared", () => cleared++);
  ctx.recorder.record(base);
  ctx.recorder.clear();
  assert.equal(ctx.recorder.list({ since: 0 }).length, 0);
  assert.equal(cleared, 1);
});

test("record emits the public event", () => {
  const recorder = new FlightRecorder();
  const seen = [];
  recorder.on("event", (e) => seen.push(e));
  const row = recorder.record(base);
  assert.deepEqual(seen, [row]);
});

test("CSV export neutralises formulas and quotes", () => {
  const csv = toCsv([
    { id: 1, ts: Date.UTC(2026, 9, 15, 9, 12), endedAt: Date.UTC(2026, 9, 15, 9, 13), task: "chat", host: "api.groq.com", hosts: ["api.groq.com"], bytesOut: 3100, bytesIn: null, outcome: "ok", status: 200, errorClass: null, model: '=HYPERLINK("x"),"a"', attributed: true, opaque: false },
  ]);
  const [header, line] = csv.trim().split("\n");
  assert.equal(header, "started_utc,ended_utc,task,kind,hosts,bytes_sent,bytes_received,outcome,status,error_class,model,attributed,opaque_session");
  assert.equal(line, '2026-10-15T09:12:00.000Z,2026-10-15T09:13:00.000Z,chat,api.groq.com,3100,,ok,200,,"\'=HYPERLINK(""x""),""a""",yes,no');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run native:node && npm test -- test/helpers/flightRecorder.test.js`
Expected: FAIL with `Cannot find module '../../src/helpers/privacy/flightRecorder'`.

- [ ] **Step 3: Add the table**

In `src/helpers/localDatabaseSchema.js`, insert after the line `CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics_events(local_date);`:

```sql
-- Flight recorder (Plan 07). Metadata about requests that left this computer:
-- never content, prompts, keys, URL paths/queries or error messages.
CREATE TABLE IF NOT EXISTS egress_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  ended_at INTEGER,
  task TEXT NOT NULL,
  host TEXT NOT NULL,
  hosts TEXT NOT NULL,
  bytes_out INTEGER,
  bytes_in INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'error', 'blocked', 'cancelled')),
  status INTEGER,
  error_class TEXT,
  model TEXT,
  attributed INTEGER NOT NULL DEFAULT 1,
  opaque INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'request' CHECK (kind IN ('request', 'stream', 'connection', 'session', 'operation')),
  operation_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_egress_ts ON egress_events(ts);
```

- [ ] **Step 4: Implement the store**

Create `src/helpers/privacy/flightRecorder.js`:

```js
const { EventEmitter } = require("node:events");
const { EGRESS_TASKS } = require("./egressPolicy");

const MAX_ROWS = 100000;
const MEMORY_LIMIT = 500;
const CAP_CHECK_EVERY = 500;
const MAX_TRAIL = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const OUTCOMES = new Set(["ok", "error", "blocked", "cancelled"]);
const KINDS = ["request", "stream", "connection", "session", "operation"];
// Error categories, never free text (N1). egressGate.errorClassOf maps codes onto these.
const ERROR_CLASSES = [
  "SEALED_MODE", "ABORTED", "TIMEOUT", "DNS", "CONNECTION", "TLS", "HTTP_4XX", "HTTP_5XX",
  "PROTOCOL", "BODY_CANCELLED", "DOWNLOAD_CANCELLED", "UPDATE_FAILED", "CHILD_EXIT", "OTHER",
];
// A model identifier, never a URL, credential or message (N1). Anything else is
// stored as null; the value sent to the provider is untouched.
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/;
function modelId(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!MODEL_ID.test(v)) return null;          // whitespace, ? # = & % quotes, control characters, too long
  if (v.includes("//")) return null;            // a scheme or protocol-relative URL
  if (/:[^/@]*@/.test(v)) return null;          // user:secret@
  if (/[A-Za-z0-9_]{32,}/.test(v)) return null; // the shape of an API key or token
  return v;
}
const errorClass = (value) => (value == null ? null : ERROR_CLASSES.includes(value) ? value : "OTHER");
// A bare hostname, IPv4 or IPv6 literal, or the literal "unknown". Anything
// with a path, query, userinfo or whitespace is refused, so a URL can never be
// stored by mistake.
const BARE_HOST = /^[a-z0-9._:-]{1,253}$/;

const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
function bareHost(value) {
  const host = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!BARE_HOST.test(host)) throw new TypeError("Egress host must be a bare hostname");
  return host;
}

function toPublic(row) {
  return {
    id: row.id,
    ts: row.ts,
    endedAt: row.ended_at,
    task: row.task,
    host: row.host,
    hosts: row.hosts.split(","),
    bytesOut: row.bytes_out,
    bytesIn: row.bytes_in,
    outcome: row.outcome,
    status: row.status,
    errorClass: row.error_class,
    model: row.model,
    attributed: row.attributed === 1,
    opaque: row.opaque === 1,
    kind: row.kind,
    operationId: row.operation_id,
  };
}

class FlightRecorder extends EventEmitter {
  constructor({ db = null, now = Date.now } = {}) {
    super();
    this.now = now;
    this.db = null;
    // "pending": retention not heard yet; "persist": write to SQLite;
    // "memory": the user turned local history off.
    this.mode = "pending";
    this.memory = [];
    this.nextMemoryId = -1;
    this.writesSinceCap = 0;
    this.persistError = null;
    if (db) this.attachDatabase(db);
  }

  attachDatabase(db) {
    this.db = db;
    this.insert = db.prepare(
      `INSERT INTO egress_events (ts, ended_at, task, host, hosts, bytes_out, bytes_in, outcome, status, error_class, model, attributed, opaque, kind, operation_id)
       VALUES (@ts, @ended_at, @task, @host, @hosts, @bytes_out, @bytes_in, @outcome, @status, @error_class, @model, @attributed, @opaque, @kind, @operation_id)`
    );
  }

  get persisting() {
    return this.mode === "persist";
  }

  setPersistence(enabled) {
    if (!enabled) {
      // Rows collected before the settings were known stay memory-only too.
      for (const row of this.memory) row.scope = "memory";
      this.mode = "memory";
      return;
    }
    this.mode = "persist";
    this.flushPending();
  }

  // Only rows recorded before consent was known are eligible; they leave
  // memory only after the transaction commits.
  flushPending() {
    if (!this.db || this.mode !== "persist") return;
    const pending = this.memory.filter((r) => r.scope === "pending");
    if (pending.length === 0) return;
    try {
      this.db.transaction(() => {
        for (const { id: _id, scope: _scope, ...row } of pending) this.insert.run(row);
      })();
      this.memory = this.memory.filter((r) => r.scope !== "pending");
      this.persistError = null;
    } catch (error) {
      this.persistError = error.code || error.message;
    }
  }

  normalize(event) {
    if (!EGRESS_TASKS.includes(event?.task)) throw new TypeError(`Unknown egress task: ${event?.task}`);
    if (!OUTCOMES.has(event.outcome)) throw new TypeError(`Unknown egress outcome: ${event.outcome}`);
    const host = bareHost(event.host);
    const trail = [host, ...(Array.isArray(event.hosts) ? event.hosts.map(bareHost) : [])];
    const hosts = [...new Set(trail)].slice(0, MAX_TRAIL);
    // A child process's own traffic is invisible to main, so no byte count is honest.
    const kind = event.kind ?? (event.opaque === true ? "session" : "request");
    if (!KINDS.includes(kind)) throw new TypeError(`Unknown egress kind: ${kind}`);
    const opaque = kind === "session";
    const ts = count(event.ts) ?? this.now();
    return {
      ts,
      ended_at: count(event.endedAt) ?? ts,
      task: event.task,
      host,
      hosts: hosts.join(","),
      bytes_out: opaque ? null : count(event.bytesOut),
      bytes_in: opaque ? null : count(event.bytesIn),
      outcome: event.outcome,
      status: Number.isInteger(event.status) ? event.status : null,
      error_class: errorClass(event.errorClass),
      model: modelId(event.model),
      attributed: event.attributed === false ? 0 : 1,
      opaque: opaque ? 1 : 0,
      kind,
      operation_id: Number.isInteger(event.operationId) ? event.operationId : null,
    };
  }

  remember(row, scope) {
    const id = this.nextMemoryId--;
    this.memory.push({ id, scope, ...row });
    if (this.memory.length > MEMORY_LIMIT) this.memory.splice(0, this.memory.length - MEMORY_LIMIT);
    return id;
  }

  record(event) {
    const row = this.normalize(event);
    let id;
    if (this.mode === "persist" && this.db) {
      try {
        id = Number(this.insert.run(row).lastInsertRowid);
        if (++this.writesSinceCap >= CAP_CHECK_EVERY) this.capRows();
      } catch (error) {
        // Keep it, and try again on the next prune; never lose a ledger row silently.
        this.persistError = error.code || error.message;
        id = this.remember(row, "pending");
      }
    } else {
      id = this.remember(row, this.mode === "memory" ? "memory" : "pending");
    }
    const published = toPublic({ id, ...row });
    this.emit("event", published);
    return published;
  }

  list({ since = 0, limit = 500 } = {}) {
    const lim = Math.min(Math.max(Math.trunc(limit) || 1, 1), MAX_ROWS);
    const fromDb = this.db
      ? this.db
          .prepare("SELECT * FROM egress_events WHERE ts >= ? ORDER BY ts DESC, id DESC LIMIT ?")
          .all(since, lim)
      : [];
    const fromMemory = this.memory.filter((r) => r.ts >= since);
    // Memory rows count down from -1, so a more negative id is newer. At equal
    // timestamps a memory row counts as newer than a persisted row.
    const order = (r) => (r.id > 0 ? r.id : Number.MAX_SAFE_INTEGER / 2 - r.id);
    return [...fromDb, ...fromMemory]
      .sort((a, b) => b.ts - a.ts || order(b) - order(a))
      .slice(0, lim)
      .map(toPublic);
  }

  summary({ since = 0 } = {}) {
    const rows = this.list({ since, limit: MAX_ROWS });
    const sent = rows.filter((r) => r.outcome !== "blocked" && r.kind !== "operation");
    const observed = sent.filter((r) => r.kind === "request" || r.kind === "stream");
    const connections = sent.filter((r) => r.kind === "connection");
    const unexplained = rows.filter((r) => !r.attributed);
    const sum = (key) => observed.reduce((n, r) => n + (r[key] ?? 0), 0);
    return {
      left: sent.length,
      observed: observed.length,
      connections: connections.length,
      blocked: rows.filter((r) => r.outcome === "blocked").length,
      unattributed: unexplained.length,
      unattributedHosts: [...new Set(unexplained.map((r) => r.host))],
      bytesOut: sum("bytesOut"),
      bytesIn: sum("bytesIn"),
      unknownBytes: observed.filter((r) => r.bytesOut == null).length,
      opaqueSessions: sent.filter((r) => r.kind === "session").length,
    };
  }

  clear() {
    if (this.db) this.db.prepare("DELETE FROM egress_events").run();
    this.memory = [];
    this.emit("cleared");
  }

  capRows(maxRows = MAX_ROWS) {
    this.writesSinceCap = 0;
    return this.db.prepare(
      "DELETE FROM egress_events WHERE id NOT IN (SELECT id FROM egress_events ORDER BY ts DESC, id DESC LIMIT ?)"
    ).run(maxRows).changes;
  }

  prune({ retentionDays, maxRows = MAX_ROWS } = {}) {
    const cutoff = Number.isFinite(retentionDays) && retentionDays > 0 ? this.now() - retentionDays * DAY_MS : null;
    if (cutoff !== null) this.memory = this.memory.filter((r) => r.ts >= cutoff);
    if (!this.db) return { deleted: 0 };
    this.flushPending();
    let deleted = 0;
    if (cutoff !== null) deleted += this.db.prepare("DELETE FROM egress_events WHERE ts < ?").run(cutoff).changes;
    deleted += this.capRows(maxRows);
    return { deleted };
  }
}

const CSV_HEADER = ["started_utc", "ended_utc", "task", "kind", "hosts", "bytes_sent", "bytes_received", "outcome", "status", "error_class", "model", "attributed", "opaque_session"];

function csvCell(value) {
  if (value == null) return "";
  let s = String(value);
  // Spreadsheet formula injection: a leading = + - @ tab or CR is neutralised.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(events) {
  const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
  const lines = events.map((e) =>
    [iso(e.ts), iso(e.endedAt), e.task, e.kind, e.hosts.join(" "), e.bytesOut, e.bytesIn, e.outcome, e.status, e.errorClass, e.model, e.attributed ? "yes" : "no", e.opaque ? "yes" : "no"]
      .map(csvCell)
      .join(",")
  );
  return [CSV_HEADER.join(","), ...lines].join("\n") + "\n";
}

module.exports = { FlightRecorder, toCsv, ERROR_CLASSES, KINDS, MAX_ROWS, MEMORY_LIMIT, CAP_CHECK_EVERY };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- test/helpers/flightRecorder.test.js`
Expected: PASS (15 tests). Also run the existing DB suites, which share the schema string, to confirm nothing regressed:

Run: `npm test -- test/helpers/dictionaryDatabase.test.js test/helpers/listOrdering.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/helpers/privacy/flightRecorder.js src/helpers/localDatabaseSchema.js test/helpers/flightRecorder.test.js
git commit -m "feat(privacy): add metadata-only flight recorder store"
```

---

### Task 5: The egress gate (Layer A)

**Files:**
- Create: `src/helpers/privacy/egressGate.js`
- Test: `test/helpers/egressGate.test.js`

**Interfaces:**
- Consumes `egressPolicy` (Task 2) and a `FlightRecorder`-shaped `recorder` with `record(event)` (Task 4).
- Produces a module singleton. Every main-process site requires it.

  ```js
  configureEgress({ isSealed: () => boolean, recorder?: FlightRecorder|null, now?: () => number }): void
  attachRecorder(recorder): void;  getRecorder(): FlightRecorder|null
  isSealed(): boolean                       // a throwing isSealed() counts as sealed (fail closed)
  withTask(task, fn): ReturnType<fn>        // task context for nested authorize() calls (AsyncLocalStorage)
  withContext({ correlationId?, provider? }, fn): ReturnType<fn>  // session and target for every ticket inside fn that does not set its own (I4-R2)
  currentTask(): EgressTask|null;  currentTicket(): Ticket|null
  runWithTicket(ticket, fn): ReturnType<fn>
  authorize(meta: TicketMeta): Ticket       // throws SealedModeError (phase "refused"; records "blocked", 0 bytes) when refused
  assertAllowed({ task?, target }): void    // permission check only: no ticket, no ledger row when allowed
  guard(meta & { settleFrom?: (result) => SettlePatch }, fn: (ticket) => Promise<T>): Promise<T>
                                            // ticket lives for fn's duration; use when fn consumes the whole response
  guardResponse(meta, fn: (ticket) => Promise<Response>): Promise<Response>
                                            // ticket lives until the returned body is fully read, errors, is cancelled, or sealing aborts it
  meteredFetch(ticket, baseFetch?, { tag? }?): typeof fetch   // marks dispatched/delivered/undelivered, counts body bytes; tag: true only for Electron net (Task 6 strips it)
  tagHeaders(ticket, headers?): Record<string,string>  // adds the x-loqui-egress tag the Chromium backstop strips (Task 6)
  ticketByTag(tag): Ticket|null
  abortAllRemote(): number;  activeRemoteCount(): number
  recordUnattributed({ host, outcome, status?, bytesOut?, bytesIn?, ts?, endedAt? }): void
  recordBackstopBlock({ host, ticket? }): SealedModeError
  onSealChanged(sealed: boolean): void;  counters(): { blockedSinceSealed, recordFailures }
  events: EventEmitter   // "dispatched" | "delivered" | "undelivered" → EgressNotice; "settled" → { ticketId }
  EGRESS_TAG_HEADER = "x-loqui-egress"
  _resetForTests(): void;  _setBypassForTests(on: boolean): void   // bypass = authorise as if unsealed (regression-sensitivity checks, Task 12)
  ```

  The types:

  ```js
  TicketMeta = { task?, target, model?, provider?: string|null, meter?: "body"|"socket"|"opaque" = "body",
                 payload?: "audio"|"text"|"image"|"metadata" = "metadata", correlationId?: string|null }
  EgressNotice = { ticketId, task, targetId, host, payload, correlationId, ts }   // targetId: provider id, or "host:<host>" (Plan 04 encoding)
  Ticket = { id, tag, task, host, hosts, loopback, model, meter, payload, correlationId, targetId, signal, settled, startedAt,
             addHost(host), attachSocket(socket), socketCount(), addBytes({ out?, in? }), noteStatus(code),
             bodyOpened(), bodyClosed(), markDispatched(), markDelivered(), markUndelivered(),
             abort(reason), settle({ outcome, status?, errorClass?, bytesOut?, bytesIn? }), discard() }
  ```

- **Attribution is by context, never by hostname.**
  - A Node socket belongs to a ticket only when it is opened inside that ticket's `AsyncLocalStorage` context.
  - A Chromium request belongs to a ticket only when it carries that ticket's tag header, which the backstop strips before sending (Task 6).
  - A second request to the same host from somewhere else is *unexplained*, even while a ticket for that host is open.
- **Host trail.** `hosts` is the ordered, de-duplicated list of hosts a ticket contacted: the declared host, every socket opened in its context, and every redirect. The ledger stores it (Task 4).
- **Notice phases.**
  - `dispatched`: Loqui handed the payload to a transport, so the provider *may* have received it.
  - `delivered`: the provider answered, so it *did* receive it.
  - `undelivered`: the transport failed before connecting, so it did not.

  Plan 04's cancel copy maps these to "may have received", "received" and nothing (CCR-3). A loopback ticket emits no notices and is never recorded.
- **The meters.**
  - `"body"` counts request and response *bodies*: `null` means not measured, never 0. A bodyless request is `null`, because its headers still went out.
  - `"socket"` counts wire bytes on the ticket's own sockets, so it includes TLS overhead.
  - `"opaque"` is a child-process session. It is recorded with `opaque: true` and no byte counts, and it settles only when the child exits (Task 6a).

- [ ] **Step 1: Write the failing test**

Create `test/helpers/egressGate.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError, sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");

function setup(t, { sealed = false } = {}) {
  const flags = { sealed };
  let clock = 1000;
  const recorder = new FlightRecorder({ now: () => clock });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now: () => clock });
  t.after(() => gate._resetForTests());
  return { flags, recorder, tick: (ms) => (clock += ms) };
}
const nextTurn = () => new Promise((r) => setImmediate(r));
const notices = () => {
  const seen = [];
  for (const phase of ["dispatched", "delivered", "undelivered"]) gate.events.on(phase, (n) => seen.push({ phase, ...n }));
  return seen;
};

test("a sealed gate refuses a remote target and records 0 bytes", (t) => {
  const { recorder } = setup(t, { sealed: true });
  assert.throws(
    () => gate.authorize({ task: "chat", target: "https://api.groq.com/openai/v1", model: "gpt-oss-120b" }),
    (error) => isSealedModeError(error) && sealedPhaseOf(error) === "refused" && error.details.host === "api.groq.com"
  );
  const [row] = recorder.list();
  assert.deepEqual([row.outcome, row.bytesOut, row.bytesIn, row.errorClass, row.model], ["blocked", 0, 0, "SEALED_MODE", "gpt-oss-120b"]);
  assert.equal(gate.counters().blockedSinceSealed, 1);
});

test("loopback is allowed while sealed, never recorded and never announced", async (t) => {
  const { recorder } = setup(t, { sealed: true });
  const seen = notices();
  await gate.guard({ task: "dictationCleanup", target: "http://127.0.0.1:8080/v1" }, async (ticket) => {
    await gate.meteredFetch(ticket, async () => new Response("ok"))("http://127.0.0.1:8080/v1", { body: "x" });
  });
  assert.equal(recorder.list().length, 0);
  assert.deepEqual(seen, []);
});

test("a request records its own start and end, body bytes, status and host trail", async (t) => {
  const { recorder, tick } = setup(t);
  let operationId;
  await gate.guard({ task: "chat", target: "https://api.groq.com/x", model: "m" }, async (ticket) => {
    operationId = ticket.id;
    tick(250);
    const res = await gate.meteredFetch(ticket, async () => {
      ticket.addHost("edge.groq.com"); // a socket the backstop saw during this request
      tick(50);
      return new Response("hello world", { status: 200 });
    })("https://api.groq.com/x", { method: "POST", body: "12345" });
    await res.text();
  });
  const rows = recorder.list();
  assert.equal(rows.length, 1, "one request, one row; the operation adds none");
  assert.deepEqual(
    [rows[0].kind, rows[0].operationId, rows[0].ts, rows[0].endedAt, rows[0].outcome, rows[0].bytesOut, rows[0].bytesIn, rows[0].status, rows[0].hosts],
    ["request", operationId, 1250, 1300, "ok", 5, 11, 200, ["api.groq.com", "edge.groq.com"]]
  );
});

test("two requests in one operation are two rows; a failed retry never withdraws earlier delivery", async (t) => {
  const { recorder } = setup(t);
  const seen = notices();
  let calls = 0;
  const transport = async () => {
    calls++;
    if (calls === 2) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    return new Response("{}", { status: 200 });
  };
  await assert.rejects(
    gate.guard({ task: "chat", target: "https://api.groq.com", provider: "groq", payload: "text", correlationId: "s-1" }, async (ticket) => {
      await (await gate.meteredFetch(ticket, transport)("https://api.groq.com/a", { body: "x" })).text();
      await gate.meteredFetch(ticket, transport)("https://cdn.groq.com/b", { body: "y" });
    })
  );
  const rows = recorder.list().reverse(); // oldest first
  assert.deepEqual(rows.map((r) => [r.kind, r.host, r.outcome, r.errorClass]), [
    ["request", "api.groq.com", "ok", null],
    ["request", "cdn.groq.com", "error", "CONNECTION"],
  ]);
  assert.equal(rows[0].operationId, rows[1].operationId);
  assert.deepEqual(seen.map((n) => n.phase), ["dispatched", "delivered", "dispatched"], "no undelivered after a delivery");
  assert.equal(recorder.summary({ since: 0 }).observed, 2);
});

test("an operation that fails before any transport is kept, but never counted as having left", async (t) => {
  const { recorder } = setup(t);
  await assert.rejects(gate.guard({ task: "chat", target: "https://api.groq.com" }, async () => { throw new Error("model construction failed"); }));
  assert.deepEqual([recorder.list()[0].kind, recorder.list()[0].errorClass], ["operation", "OTHER"]);
  assert.equal(recorder.summary({ since: 0 }).left, 0);
});

test("an SDK operation that took no metered fetch is recorded as a connection, not a request", async (t) => {
  const { recorder } = setup(t);
  await gate.guard({ task: "noteFormatting", target: "https://bedrock-runtime.us-east-1.amazonaws.com" }, async (ticket) => {
    ticket.noteConnection(); // what the backstop does for a socket in this context
  });
  assert.equal(recorder.list()[0].kind, "connection");
  assert.deepEqual([recorder.summary({ since: 0 }).observed, recorder.summary({ since: 0 }).connections], [0, 1]);
});

test("unmeasured bodies are unknown, not 0: bodyless GET, stream body, 204", async (t) => {
  const { recorder } = setup(t);
  await gate.guard({ task: "providerCheck", target: "https://api.groq.com" }, (ticket) =>
    gate.meteredFetch(ticket, async () => new Response(null, { status: 204 }))("https://api.groq.com/models")
  );
  await gate.guard({ task: "chat", target: "https://api.groq.com" }, (ticket) =>
    gate.meteredFetch(ticket, async () => new Response(null, { status: 204 }))("https://api.groq.com/x", { body: new ReadableStream() })
  );
  for (const row of recorder.list()) assert.deepEqual([row.bytesOut, row.bytesIn], [null, null]);
});

test("a body not fully read inside guard() is recorded as unknown, and the request as delivered", async (t) => {
  const { recorder } = setup(t);
  await gate.guard({ task: "providerCheck", target: "https://api.groq.com" }, (ticket) =>
    gate.meteredFetch(ticket, async () => new Response("a long body", { status: 200 }))("https://api.groq.com/models")
  );
  assert.deepEqual([recorder.list()[0].bytesIn, recorder.list()[0].outcome, recorder.list()[0].status], [null, "ok", 200]);
});

test("dispatched, then delivered; a connect failure is undelivered, never delivered", async (t) => {
  setup(t);
  const seen = notices();
  const ticket = gate.authorize({ task: "dictationStt", target: "https://api.openai.com", provider: "openai", payload: "audio", correlationId: "rec-1" });
  assert.deepEqual(seen, [], "authorisation alone is not dispatch");
  await gate.meteredFetch(ticket, async () => new Response("{}"))("https://api.openai.com/v1/audio", { method: "POST", body: "abc" });
  assert.deepEqual(seen.map((n) => [n.phase, n.targetId, n.payload, n.correlationId, n.attemptId]), [
    ["dispatched", "openai", "audio", "rec-1", `${ticket.id}.1`],
    ["delivered", "openai", "audio", "rec-1", `${ticket.id}.1`],
  ]);
  ticket.discard();

  seen.length = 0;
  const refused = gate.authorize({ task: "chat", target: "http://192.168.1.5:8080/v1", provider: "lan", payload: "text" });
  await assert.rejects(
    gate.meteredFetch(refused, async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); })("http://192.168.1.5:8080/v1", { body: "x" })
  );
  assert.deepEqual(seen.map((n) => [n.phase, n.targetId]), [["dispatched", "host:192.168.1.5"], ["undelivered", "host:192.168.1.5"]]);
  refused.discard();
});

test("Node requests never carry the tag; Electron net requests do", async (t) => {
  setup(t);
  const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com" });
  const seenHeaders = [];
  const capture = async (_url, init) => { seenHeaders.push(new Headers(init.headers ?? {})); return new Response("{}"); };
  await gate.meteredFetch(ticket, capture)("https://api.groq.com/x", { headers: { a: "1" } });
  await gate.meteredFetch(ticket, capture, { tag: true })("https://api.groq.com/x", { headers: { a: "1" } });
  assert.equal(seenHeaders[0].has(gate.EGRESS_TAG_HEADER), false);
  // The tag names one request of this operation, not the operation itself.
  assert.equal(gate.ticketByTag(seenHeaders[1].get(gate.EGRESS_TAG_HEADER))?.ticket, ticket);
  assert.notEqual(seenHeaders[1].get(gate.EGRESS_TAG_HEADER), ticket.tag);
  ticket.discard();
});

test("tags identify a ticket for the Chromium backstop", (t) => {
  setup(t);
  const ticket = gate.authorize({ task: "calendar", target: "https://graph.microsoft.com" });
  const headers = gate.tagHeaders(ticket, { Accept: "application/json" });
  assert.equal(headers[gate.EGRESS_TAG_HEADER], ticket.tag);
  assert.equal(headers.Accept, "application/json");
  assert.equal(gate.ticketByTag(ticket.tag), ticket);
  ticket.discard();
  assert.equal(gate.ticketByTag(ticket.tag), null);
});

test("guardResponse keeps the ticket open until the body is read", async (t) => {
  const { recorder } = setup(t);
  const res = await gate.guardResponse({ task: "calendar", target: "https://graph.microsoft.com" }, (ticket) =>
    gate.meteredFetch(ticket, async () => new Response("calendar json", { status: 200 }))("https://graph.microsoft.com/v1.0/me")
  );
  assert.equal(gate.activeRemoteCount(), 1, "still open after headers");
  assert.equal(recorder.list().length, 0);
  assert.equal(await res.text(), "calendar json");
  await nextTurn();
  assert.equal(gate.activeRemoteCount(), 0);
  assert.deepEqual([recorder.list()[0].outcome, recorder.list()[0].bytesIn, recorder.list()[0].status], ["ok", 13, 200]);
});

test("guardResponse: a body that fails mid-read is an error, not a success", async (t) => {
  const { recorder } = setup(t);
  const broken = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode("par")); },
    pull(c) { c.error(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })); },
  });
  const res = await gate.guardResponse({ task: "calendar", target: "https://graph.microsoft.com" }, async () => new Response(broken, { status: 200 }));
  await assert.rejects(res.text());
  await nextTurn();
  assert.deepEqual([recorder.list()[0].kind, recorder.list()[0].outcome, recorder.list()[0].errorClass], ["request", "error", "CONNECTION"]);
});

test("guardResponse: sealing after headers with a stalled body interrupts it", async (t) => {
  const { flags, recorder } = setup(t);
  const stalled = new ReadableStream({ pull() { return new Promise(() => {}); } });
  const res = await gate.guardResponse({ task: "calendar", target: "https://graph.microsoft.com" }, async () => new Response(stalled));
  const reading = res.text();
  flags.sealed = true;
  gate.abortAllRemote();
  await assert.rejects(reading, (e) => sealedPhaseOf(e) === "interrupted");
  assert.equal(gate.activeRemoteCount(), 0);
  assert.deepEqual([recorder.list()[0].outcome, recorder.list()[0].errorClass], ["cancelled", "SEALED_MODE"]);
});

test("guardResponse: an unread body is still settled when sealing aborts it", async (t) => {
  const { flags } = setup(t);
  await gate.guardResponse({ task: "calendar", target: "https://graph.microsoft.com" }, async () => new Response("never read"));
  flags.sealed = true;
  gate.abortAllRemote();
  assert.equal(gate.activeRemoteCount(), 0);
});

test("settle stores an error class, never a message", async (t) => {
  const { recorder } = setup(t);
  const providerError = Object.assign(new Error("Your text 'secret plans' was rejected"), { code: "PROVIDER_REJECTED", status: 400 });
  await assert.rejects(gate.guard({ task: "chat", target: "https://api.groq.com" }, async () => { throw providerError; }));
  const [row] = recorder.list();
  assert.deepEqual([row.outcome, row.errorClass, row.status], ["error", "HTTP_4XX", 400], "a category, not the provider's code");
  assert.equal(JSON.stringify(row).includes("secret"), false);
  assert.equal(JSON.stringify(row).includes("PROVIDER_REJECTED"), false);
});

test("withContext gives nested tickets the session id and canonical target, unless they set their own", async (t) => {
  setup(t);
  const seen = notices();
  await gate.withContext({ correlationId: "s-1", provider: "tinfoil" }, async () => {
    await nextTurn();
    // A provider helper deep in the call, which knows neither (Tinfoil's SDK wrapper).
    await gate.guard({ task: "dictationStt", target: "https://inference.tinfoil.sh", payload: "audio" }, async (ticket) => ticket.markDelivered());
    await gate.guard({ task: "dictationStt", target: "https://api.openai.com", provider: "openai", payload: "audio", correlationId: "other" }, async (ticket) => ticket.markDelivered());
  });
  assert.deepEqual(seen.filter((n) => n.phase === "delivered").map((n) => [n.correlationId, n.targetId]), [
    ["s-1", "tinfoil"],
    ["other", "openai"],
  ]);
});

test("withTask supplies the task across async boundaries", async (t) => {
  const { recorder } = setup(t);
  await gate.withTask("uploadStt", async () => {
    await nextTurn();
    await gate.guard({ target: "https://api.openai.com/v1/audio" }, async () => {});
  });
  assert.equal(recorder.list()[0].task, "uploadStt");
  await gate.guard({ target: "https://api.openai.com" }, async () => {});
  assert.equal(recorder.list()[0].task, "unattributed");
});

test("abortAllRemote interrupts in-flight remote tickets; loopback keeps running", async (t) => {
  const { flags, recorder } = setup(t);
  const pending = gate.guard({ task: "chat", target: "https://api.groq.com" }, (ticket) =>
    new Promise((_resolve, reject) => ticket.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
  );
  const local = gate.authorize({ task: "dictationCleanup", target: "http://localhost:8080" });
  assert.equal(gate.activeRemoteCount(), 1);
  flags.sealed = true;
  gate.onSealChanged(true);
  assert.equal(gate.abortAllRemote(), 1);
  await assert.rejects(pending, (error) => sealedPhaseOf(error) === "interrupted");
  assert.equal(local.signal.aborted, false);
  assert.deepEqual([recorder.list()[0].outcome, recorder.list()[0].errorClass], ["cancelled", "SEALED_MODE"]);
  assert.equal(gate.activeRemoteCount(), 0);
});

test("an opaque child session is recorded without bytes", (t) => {
  const { recorder } = setup(t);
  const session = gate.authorize({ task: "codex", target: "https://chatgpt.com", meter: "opaque" });
  session.addBytes({ out: 50, in: 50 });
  session.settle({ outcome: "ok" });
  const [row] = recorder.list();
  assert.deepEqual([row.task, row.opaque, row.bytesOut, row.bytesIn], ["codex", true, null, null]);
});

test("aborting an opaque session does not settle it: only the child's exit does", (t) => {
  setup(t);
  const session = gate.authorize({ task: "codex", target: "https://chatgpt.com", meter: "opaque" });
  gate.abortAllRemote();
  assert.equal(session.settled, false);
  assert.equal(gate.activeRemoteCount(), 1);
  session.settle({ outcome: "cancelled" });
  assert.equal(gate.activeRemoteCount(), 0);
});

test("aborting a socket-metered ticket that never opened a socket settles it", (t) => {
  const { recorder } = setup(t);
  const ticket = gate.authorize({ task: "dictationStt", target: "wss://api.openai.com", meter: "socket" });
  assert.equal(ticket.socketCount(), 0);
  gate.abortAllRemote();
  assert.equal(ticket.settled, true);
  assert.equal(recorder.list()[0].outcome, "cancelled");
});

test("'settled' fires for every settled remote ticket", async (t) => {
  setup(t);
  let settled = 0;
  gate.events.on("settled", () => settled++);
  await gate.guard({ task: "chat", target: "https://api.groq.com" }, async () => {});
  assert.equal(settled, 1);
});

test("a throwing isSealed fails closed", (t) => {
  setup(t);
  gate.configureEgress({ isSealed: () => { throw new Error("disk"); } });
  assert.equal(gate.isSealed(), true);
  assert.throws(() => gate.authorize({ task: "chat", target: "https://api.groq.com" }), isSealedModeError);
});

test("the test-only bypass authorises as if unsealed", (t) => {
  setup(t, { sealed: true });
  gate._setBypassForTests(true);
  const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com" });
  ticket.discard();
  gate._setBypassForTests(false);
  assert.throws(() => gate.authorize({ task: "chat", target: "https://api.groq.com" }), isSealedModeError);
});

test("unknown tasks are a programming error", (t) => {
  setup(t);
  assert.throws(() => gate.authorize({ task: "telemetry", target: "https://x.example" }), TypeError);
});

test("assertAllowed leaves no ticket and no ledger row when allowed", (t) => {
  const { recorder } = setup(t);
  gate.assertAllowed({ task: "codex", target: "https://chatgpt.com" });
  assert.equal(recorder.list().length, 0);
  assert.equal(gate.activeRemoteCount(), 0);
});

test("recording failures never break a request", async (t) => {
  setup(t);
  gate.attachRecorder({ record() { throw new Error("disk full"); } });
  await gate.guard({ task: "chat", target: "https://api.groq.com" }, async () => {});
  assert.equal(gate.counters().recordFailures, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/helpers/egressGate.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

Create `src/helpers/privacy/egressGate.js`:

```js
const { AsyncLocalStorage } = require("node:async_hooks");
const { EventEmitter } = require("node:events");
const { randomBytes } = require("node:crypto");
const { EGRESS_TASKS, decideEgress, SealedModeError, isSealedModeError, normalizeHost } = require("./egressPolicy");

// Layer A of Sealed mode (docs/security/sealed-mode-threat-model.md). Every
// known request site asks for a ticket before sending. The ticket carries the
// task for the flight recorder and an AbortSignal that sealing trips.
const EGRESS_TAG_HEADER = "x-loqui-egress";
const USER_ENDPOINT_PROVIDERS = new Set(["custom", "lan", "local"]);
const CONNECT_PHASE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);
const CONNECT_PHASE_CHROMIUM = /ERR_(NAME_NOT_RESOLVED|CONNECTION_REFUSED|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED|NAME_RESOLUTION_FAILED)/;

const ticketContext = new AsyncLocalStorage();
const taskContext = new AsyncLocalStorage();
// The dictation session and canonical provider for everything inside one
// handler, so provider helpers deep in the call need not thread them (I4-R2).
const metaContext = new AsyncLocalStorage();
const events = new EventEmitter();

const freshTally = () => ({ blockedSinceSealed: 0, recordFailures: 0 });
let config = { isSealed: () => false, recorder: null, now: Date.now };
let active = new Map();
let byTag = new Map();
let nextId = 1;
let tally = freshTally();
let bypass = false;

function configureEgress({ isSealed, recorder = config.recorder, now = Date.now }) {
  if (typeof isSealed !== "function") throw new TypeError("isSealed must be a function");
  config = { isSealed, recorder, now };
}
const attachRecorder = (recorder) => {
  config.recorder = recorder;
};
const getRecorder = () => config.recorder;

function isSealed() {
  try {
    return config.isSealed() === true;
  } catch {
    return true;
  }
}

function assertTask(task) {
  if (!EGRESS_TASKS.includes(task)) throw new TypeError(`Unknown egress task: ${task}`);
}
function withTask(task, fn) {
  assertTask(task);
  return taskContext.run(task, fn);
}
const currentTask = () => taskContext.getStore() ?? null;
function withContext({ correlationId = null, provider = null } = {}, fn) {
  const outer = metaContext.getStore() ?? {};
  return metaContext.run({ correlationId: correlationId ?? outer.correlationId ?? null, provider: provider ?? outer.provider ?? null }, fn);
}
const currentTicket = () => ticketContext.getStore() ?? null;
const runWithTicket = (ticket, fn) => ticketContext.run(ticket, fn);

function record(event) {
  try {
    config.recorder?.record(event);
  } catch {
    // The ledger must never decide whether a request runs; enforcement does.
    tally.recordFailures++;
  }
}

// A bounded category, never the provider's code or message (N1). The recorder
// stores only values from its ERROR_CLASSES list.
const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NONAME"]);
const CONNECTION_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "ECONNABORTED", "UND_ERR_SOCKET"]);
const TIMEOUT_CODES = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
function errorClassOf(error) {
  if (isSealedModeError(error)) return "SEALED_MODE";
  for (let e = error, depth = 0; e && depth < 4; e = e.cause, depth++) {
    const code = typeof e.code === "string" ? e.code : "";
    if (DNS_CODES.has(code)) return "DNS";
    if (CONNECTION_CODES.has(code)) return "CONNECTION";
    if (TIMEOUT_CODES.has(code) || e.name === "TimeoutError") return "TIMEOUT";
    if (/^(ERR_TLS|CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|ERR_SSL)/.test(code)) return "TLS";
    if (e.name === "AbortError") return "ABORTED";
    if (Number.isInteger(e.status) && e.status >= 500) return "HTTP_5XX";
    if (Number.isInteger(e.status) && e.status >= 400) return "HTTP_4XX";
  }
  return "OTHER";
}

function isConnectPhaseError(error) {
  for (let e = error, depth = 0; e && depth < 4; e = e.cause, depth++) {
    if (CONNECT_PHASE_CODES.has(e.code)) return true;
    if (typeof e.message === "string" && CONNECT_PHASE_CHROMIUM.test(e.message)) return true;
  }
  return false;
}

function refuse({ task, host, hosts = null, model = null, attributed = true }) {
  tally.blockedSinceSealed++;
  const ts = config.now();
  record({ ts, endedAt: ts, task, host, hosts: hosts ?? [host], bytesOut: 0, bytesIn: 0, outcome: "blocked", errorClass: "SEALED_MODE", model, attributed });
  return new SealedModeError({ task, host });
}

const meterAccumulator = () => ({ total: 0, measured: false, unknown: false });
function addTo(acc, n) {
  if (n === null) acc.unknown = true;
  else if (Number.isFinite(n) && n >= 0) {
    acc.total += n;
    acc.measured = true;
  }
}
const valueOf = (acc) => (acc.unknown || !acc.measured ? null : acc.total);
const targetIdFor = (provider, host) =>
  provider && !USER_ENDPOINT_PROVIDERS.has(provider) ? provider : `host:${host}`;

// A ticket is one operation (I3). Each request it makes through meteredFetch is
// an attempt with its own row, hosts, bytes, status and notices. A ticket with
// no attempts records one row whose kind says what Loqui actually saw.
function createTicket({ task, host, loopback, model, meter, payload, correlationId, provider }) {
  const controller = new AbortController();
  const out = meterAccumulator();
  const inbound = meterAccumulator();
  const sockets = new Set();
  let lastStatus = null;
  let openBodies = 0;
  const announced = new Set();
  const openAttempts = new Set();
  let attemptCount = 0;
  let manualDispatch = false; // a single request marked by its caller (postMultipart, downloads)
  let connections = 0; // sockets the backstop saw in this ticket's context
  let delivered = false;
  const ticket = {
    id: nextId++,
    tag: `${nextId}.${randomBytes(6).toString("hex")}`,
    task,
    host,
    hosts: [host],
    loopback,
    model,
    meter,
    payload,
    correlationId,
    targetId: targetIdFor(provider, host),
    signal: controller.signal,
    settled: false,
    startedAt: config.now(),
    addHost(seen) {
      if (seen && !ticket.hosts.includes(seen) && ticket.hosts.length < 8) ticket.hosts.push(seen);
      // A host seen while requests are open belongs to them too; it is never hidden.
      for (const attempt of openAttempts) attempt.addHost(seen);
    },
    noteConnection() {
      connections++;
    },
    beginAttempt: (target) => beginAttempt(target),
    attemptCount: () => attemptCount,
    attachSocket(socket) {
      sockets.add(socket);
      socket.once("close", (hadError) => {
        addTo(out, socket.bytesWritten);
        addTo(inbound, socket.bytesRead);
        sockets.delete(socket);
        if (sockets.size === 0 && !ticket.settled)
          ticket.settle({ outcome: controller.signal.aborted ? "cancelled" : hadError ? "error" : "ok" });
      });
    },
    socketCount: () => sockets.size,
    addBytes({ out: o, in: i } = {}) {
      if (o !== undefined) addTo(out, o);
      if (i !== undefined) addTo(inbound, i);
    },
    noteStatus(code) {
      if (Number.isInteger(code)) lastStatus = code;
    },
    bodyOpened() {
      openBodies++;
    },
    bodyClosed() {
      openBodies--;
    },
    markDispatched: () => {
      manualDispatch = true;
      announce("dispatched", null);
    },
    markDelivered: () => {
      manualDispatch = true;
      announce("dispatched", null);
      announce("delivered", null);
    },
    markUndelivered: () => announce("undelivered", null),
    abort(reason) {
      if (!controller.signal.aborted) controller.abort(reason);
      for (const socket of sockets) socket.destroy(reason);
      // A socket-metered ticket with no socket yet has nothing left to close.
      // An opaque session settles only when its child exits (Task 6a).
      if (meter === "socket" && sockets.size === 0) ticket.settle({ outcome: "cancelled" });
    },
    discard() {
      ticket.settled = true;
      active.delete(ticket.id);
      byTag.delete(ticket.tag);
    },
    settle({ outcome, status, errorClass = null, bytesOut, bytesIn } = {}) {
      if (ticket.settled) return;
      const sealedAbort = controller.signal.aborted && isSealedModeError(controller.signal.reason);
      // Requests still open end with the operation; one that already had its
      // response keeps "ok" with an unknown received size.
      for (const attempt of [...openAttempts]) attempt.settle({ outcome: attempt.responded && outcome !== "cancelled" ? "ok" : outcome, errorClass });
      ticket.discard();
      if (loopback) return;
      if (attemptCount === 0) {
        const kind =
          meter === "opaque" ? "session"
          : meter === "socket" ? "stream"
          : manualDispatch ? "request"
          : connections > 0 ? "connection" // an SDK that took no metered fetch: Loqui saw connections, not requests
          : "operation"; // nothing reached a transport; never counted as having left
        record({
          ts: ticket.startedAt,
          endedAt: config.now(),
          task,
          host,
          hosts: ticket.hosts,
          kind,
          operationId: ticket.id,
          bytesOut: bytesOut !== undefined ? bytesOut : valueOf(out),
          // A body still being read when the request settled was not fully
          // counted, so the received total is unknown rather than too small.
          bytesIn: bytesIn !== undefined ? bytesIn : openBodies > 0 ? null : valueOf(inbound),
          outcome,
          status: Number.isInteger(status) ? status : lastStatus,
          errorClass: sealedAbort ? "SEALED_MODE" : errorClass,
          model,
        });
      }
      events.emit("settled", { ticketId: ticket.id });
    },
  };
  // attemptId is null for a single request marked by its caller.
  function announce(phase, attemptId, attemptHost = host) {
    if (loopback) return;
    const key = `${attemptId ?? "ticket"}:${phase}`;
    if (announced.has(key)) return;
    // Once any request of this operation was delivered, a later failed retry
    // never withdraws that evidence (§5.4: undelivered withdraws dispatched only).
    if (phase === "undelivered" && delivered) return;
    if (phase === "delivered") delivered = true;
    announced.add(key);
    events.emit(phase, {
      ticketId: ticket.id,
      attemptId,
      task,
      targetId: ticket.targetId,
      host: attemptHost,
      payload,
      correlationId: ticket.correlationId,
      ts: config.now(),
    });
  }
  function beginAttempt(target) {
    attemptCount++;
    const aOut = meterAccumulator();
    const aIn = meterAccumulator();
    const attemptHost = target ?? host;
    const attempt = {
      id: `${ticket.id}.${attemptCount}`,
      tag: `${ticket.id}.${attemptCount}.${randomBytes(6).toString("hex")}`,
      ticket,
      task,
      hosts: [attemptHost],
      startedAt: config.now(),
      status: null,
      openBodies: 0,
      responded: false,
      settled: false,
      get signal() {
        return controller.signal;
      },
      addHost(seen) {
        if (seen && !attempt.hosts.includes(seen) && attempt.hosts.length < 8) attempt.hosts.push(seen);
      },
      abort: (reason) => ticket.abort(reason),
      addBytes({ out: o, in: i } = {}) {
        if (o !== undefined) addTo(aOut, o);
        if (i !== undefined) addTo(aIn, i);
      },
      markDispatched: () => announce("dispatched", attempt.id, attemptHost),
      markDelivered: () => {
        attempt.responded = true;
        announce("dispatched", attempt.id, attemptHost);
        announce("delivered", attempt.id, attemptHost);
      },
      markUndelivered: () => announce("undelivered", attempt.id, attemptHost),
      settle({ outcome, errorClass = null }) {
        if (attempt.settled) return;
        attempt.settled = true;
        openAttempts.delete(attempt);
        byTag.delete(attempt.tag);
        if (loopback) return;
        const sealedAbort = controller.signal.aborted && isSealedModeError(controller.signal.reason);
        record({
          ts: attempt.startedAt,
          endedAt: config.now(),
          task,
          host: attempt.hosts[0],
          hosts: attempt.hosts,
          kind: "request",
          operationId: ticket.id,
          bytesOut: valueOf(aOut),
          bytesIn: attempt.openBodies > 0 ? null : valueOf(aIn),
          outcome,
          status: attempt.status,
          errorClass: sealedAbort ? "SEALED_MODE" : errorClass,
          model,
        });
      },
    };
    openAttempts.add(attempt);
    byTag.set(attempt.tag, attempt);
    return attempt;
  }
  active.set(ticket.id, ticket);
  byTag.set(ticket.tag, ticket);
  return ticket;
}

function authorize({
  task = currentTask() ?? "unattributed",
  target,
  model = null,
  provider = null,
  meter = "body",
  payload = "metadata",
  correlationId = null,
} = {}) {
  assertTask(task);
  const ctx = metaContext.getStore();
  correlationId = correlationId ?? ctx?.correlationId ?? null;
  provider = provider ?? ctx?.provider ?? null;
  const decision = decideEgress({ sealed: !bypass && isSealed(), target });
  if (!decision.allow) throw refuse({ task, host: decision.host, model });
  return createTicket({ task, host: decision.host, loopback: decision.loopback, model, meter, payload, correlationId, provider });
}

function assertAllowed(meta) {
  authorize(meta).discard();
}

function failureOutcome(ticket, error) {
  const reason = ticket.signal.aborted ? ticket.signal.reason : null;
  const sealedAbort = isSealedModeError(reason);
  return {
    patch: {
      outcome:
        ticket.signal.aborted || error?.name === "AbortError" || error?.isAbort || error?.code === "DOWNLOAD_CANCELLED"
          ? "cancelled"
          : "error",
      errorClass: sealedAbort ? "SEALED_MODE" : errorClassOf(error),
      status: Number.isInteger(error?.status) ? error.status : undefined,
    },
    // A request cut off by sealing reports the seal, not a transport error.
    rethrow: sealedAbort ? reason : error,
  };
}

async function guard(meta, fn) {
  const ticket = authorize(meta);
  try {
    const result = await runWithTicket(ticket, () => fn(ticket));
    ticket.settle({ outcome: "ok", ...(meta.settleFrom ? meta.settleFrom(result) : {}) });
    return result;
  } catch (error) {
    const { patch, rethrow } = failureOutcome(ticket, error);
    ticket.settle(patch);
    throw rethrow;
  }
}

// For helpers that hand a Response back to callers who read it later
// (calendar, proxies, token fetches). The ticket stays active (abortable by
// sealing, counted in the attestation) until the body ends.
async function guardResponse(meta, fn) {
  const ticket = authorize(meta);
  let response;
  try {
    response = await runWithTicket(ticket, () => fn(ticket));
  } catch (error) {
    const { patch, rethrow } = failureOutcome(ticket, error);
    ticket.settle(patch);
    throw rethrow;
  }
  ticket.noteStatus(response.status);
  // A caller that fetched without meteredFetch still got a response: one request.
  if (ticket.attemptCount() === 0) ticket.markDelivered();
  if (!response.body) {
    ticket.settle({ outcome: "ok" });
    return response;
  }
  const reader = response.body.getReader();
  // Sealing settles at once even if nobody ever reads the body.
  ticket.signal.addEventListener(
    "abort",
    () => {
      ticket.settle({ outcome: "cancelled" });
      reader.cancel(ticket.signal.reason).catch(() => {});
    },
    { once: true }
  );
  const body = new ReadableStream({
    async pull(controller) {
      try {
        if (ticket.signal.aborted) throw ticket.signal.reason;
        const { done, value } = await reader.read();
        if (ticket.signal.aborted) throw ticket.signal.reason;
        if (done) {
          controller.close();
          ticket.settle({ outcome: "ok" });
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        const { patch, rethrow } = failureOutcome(ticket, error);
        ticket.settle(patch);
        controller.error(rethrow);
      }
    },
    cancel(reason) {
      ticket.settle({ outcome: "cancelled", errorClass: "BODY_CANCELLED" });
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

// Request and response *bodies*; null when not measurable (streams, FormData,
// a bodyless request whose headers still went out). Never a fake 0.
function bodyLength(body) {
  if (body == null) return null;
  if (typeof body === "string") return Buffer.byteLength(body);
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof URLSearchParams) return Buffer.byteLength(body.toString());
  return null;
}

// Tags a ticket (one operation, e.g. electron-updater's session) or one
// attempt. ticketByTag returns either; both expose task, addHost and abort.
function tagHeaders(ticketOrAttempt, headers = {}) {
  return { ...headers, [EGRESS_TAG_HEADER]: ticketOrAttempt.tag };
}
const hostOfInput = (input) => {
  try {
    return normalizeHost(new URL(typeof input === "string" || input instanceof URL ? input : input?.url).hostname);
  } catch {
    return null;
  }
};
const ticketByTag = (tag) => byTag.get(tag) ?? null;

// tag: true only for Electron net requests, whose session backstop strips the
// header before it leaves (Task 6). Node requests are attributed by context and
// must never carry it.
function meteredFetch(ticket, baseFetch = (...args) => globalThis.fetch(...args), { tag = false } = {}) {
  // Each call is one request (I3): its own row, host, bytes, status and notices.
  return async (input, init = {}) => {
    const attempt = ticket.beginAttempt(hostOfInput(input));
    attempt.addBytes({ out: bodyLength(init?.body) });
    const signal = init?.signal ? AbortSignal.any([init.signal, ticket.signal]) : ticket.signal;
    const headers = tag ? tagHeaders(attempt, Object.fromEntries(new Headers(init?.headers ?? {}))) : init?.headers;
    attempt.markDispatched();
    let response;
    try {
      response = await baseFetch(input, { ...init, headers, signal });
    } catch (error) {
      if (isConnectPhaseError(error)) attempt.markUndelivered();
      attempt.settle(failureOutcome(ticket, error).patch);
      throw error;
    }
    attempt.markDelivered();
    attempt.status = response.status;
    ticket.noteStatus(response.status);
    const settleOk = () => attempt.settle({ outcome: response.status >= 400 ? "error" : "ok", errorClass: response.status >= 500 ? "HTTP_5XX" : response.status >= 400 ? "HTTP_4XX" : null });
    if (!response.body) {
      attempt.addBytes({ in: null });
      settleOk();
      return response;
    }
    attempt.openBodies++;
    const counter = new TransformStream({
      transform(chunk, controller) {
        attempt.addBytes({ in: chunk.byteLength });
        controller.enqueue(chunk);
      },
      flush() {
        attempt.openBodies--;
        settleOk();
      },
    });
    return new Response(response.body.pipeThrough(counter), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

function abortAllRemote() {
  let aborted = 0;
  for (const ticket of [...active.values()]) {
    if (ticket.loopback) continue;
    ticket.abort(new SealedModeError({ task: ticket.task, host: ticket.host, phase: "interrupted" }));
    aborted++;
  }
  return aborted;
}
const activeRemoteCount = () => [...active.values()].filter((t) => !t.loopback).length;

// kind: "request" for a Chromium request, "connection" for a Node socket whose
// requests Loqui cannot see (recorded when it closes).
function recordUnattributed({ host, hosts = null, kind = "request", outcome, status = null, bytesOut = null, bytesIn = null, ts, endedAt }) {
  const now = config.now();
  record({ ts: ts ?? now, endedAt: endedAt ?? now, task: "unattributed", host, hosts: hosts ?? [host], kind, outcome, status, bytesOut, bytesIn, attributed: false });
}

// Layer B found a connection Layer A did not refuse. With a ticket, the request
// was authorised before sealing; its own settle() records it as cancelled.
// hosts: the trail so far, for a redirect hop that was refused (the earlier
// hops were allowed and must not disappear from the ledger).
function recordBackstopBlock({ host, hosts = null, ticket = null }) {
  if (ticket) {
    tally.blockedSinceSealed++;
    const error = new SealedModeError({ task: ticket.task, host, phase: "interrupted" });
    ticket.abort(error);
    return error;
  }
  return refuse({ task: "unattributed", host: hosts?.[0] ?? host, hosts: hosts ?? [host], attributed: false });
}

function onSealChanged(sealed) {
  if (sealed) tally = freshTally();
}
const counters = () => ({ ...tally });

function _resetForTests() {
  config = { isSealed: () => false, recorder: null, now: Date.now };
  active = new Map();
  byTag = new Map();
  nextId = 1;
  tally = freshTally();
  bypass = false;
  events.removeAllListeners();
}
function _setBypassForTests(on) {
  bypass = !!on;
}

module.exports = {
  EGRESS_TAG_HEADER,
  configureEgress,
  attachRecorder,
  getRecorder,
  isSealed,
  withTask,
  withContext,
  currentTask,
  currentTicket,
  runWithTicket,
  authorize,
  assertAllowed,
  guard,
  guardResponse,
  meteredFetch,
  tagHeaders,
  ticketByTag,
  abortAllRemote,
  activeRemoteCount,
  recordUnattributed,
  recordBackstopBlock,
  onSealChanged,
  counters,
  events,
  _resetForTests,
  _setBypassForTests,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/helpers/egressGate.test.js`
Expected: PASS (24 tests).

- [ ] **Step 5: Commit**

```bash
git add src/helpers/privacy/egressGate.js test/helpers/egressGate.test.js
git commit -m "feat(privacy): add egress gate with tickets, tags, task context and metering"
```

---

### Task 6: The transport backstop (Layer B)

**Files:**
- Create: `src/helpers/privacy/egressBackstop.js`
- Modify: `scripts/smoke-electron.cjs`. Replace the block from `const instrumented = new WeakSet();` through `electron.app.whenReady().then(() => watchSession(electron.session.defaultSession));` (currently `:86-95`) with a backstop observer, because Electron keeps only one listener per `webRequest` event. Anchor on that text, not the numbers.
- Test: `test/helpers/egressBackstop.test.js`

**Interfaces:**
- Consumes `egressGate` (Task 5) and `egressPolicy` (Task 2).
- Produces:

  ```js
  installNodeBackstop(): void      // idempotent. Hooks:
                                   //  net.Socket#connect (TCP/TLS: http, https, undici fetch, ws, SDKs) — localhost and *.localhost are pinned to loopback
                                   //  http/https request+get (a loopback proxy asked to CONNECT or forward to a remote host)
                                   //  dns.lookup/lookupService and every dns resolver API (callback, promises, Resolver classes); pending lookups are counted
                                   //  dgram Socket#send/#connect (UDP)
  watchSession(session): void      // idempotent; owns webRequest onBeforeRequest/onBeforeSendHeaders/onBeforeRedirect/onCompleted/onErrorOccurred
  installWebContentsGuard(app): void  // every webContents: WebRTC "disable_non_proxied_udp"; its in-flight requests are dropped when it is destroyed
  judgeChromiumRequest(url): { cancel: boolean }
  severAll(): number               // destroys open remote Node sockets; never touches loopback or Chromium connections
  addObserver(fn: (e: { layer: "node"|"chromium", host, url?, allowed }) => boolean|void): () => void
                                   // a chromium observer returning true vetoes the request (smoke test hook)
  status(): { node, dns, dgram, http, webContents: boolean; sessions: number; envProxy: boolean;
              openRemoteSockets: number; chromiumInFlightRemote: number; pendingDns: number }
  ```

- **Attribution.**
  - **Node:** a socket opened inside a ticket's `AsyncLocalStorage` context belongs to that ticket. Its host joins the ticket's trail, and a socket-metered ticket counts its wire bytes. A socket opened anywhere else is *unexplained*, even if a ticket for the same host is open. It is recorded when it closes, with its wire bytes.
  - **Chromium:** a request carrying the gate's `x-loqui-egress` tag belongs to that ticket. `onBeforeSendHeaders` reads the tag and **strips it before the request leaves**, and redirects extend that ticket's host trail. An untagged remote request is *unexplained*, and is recorded when it completes or fails, with its real status.
- **No connection resets.**
  - There is no "close all connections" step. Ticketed work is stopped by its own abort signal.
  - Un-ticketed Chromium requests (for example, a renderer image that started before sealing) are counted until they complete or fail, or until their `webContents` is destroyed.
  - The attestation stays unverified while any are in flight (Task 7), so local work in the same session is never reset.
- **`envProxy`** is true when Node was started with its environment proxy enabled (`NODE_USE_ENV_PROXY`, or `--use-env-proxy` in `process.execArgv`). Undici would then tunnel through a proxy this layer cannot inspect, so the attestation treats it as unverified.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/egressBackstop.test.js`:

```js
const assert = require("node:assert/strict");
const dgram = require("node:dgram");
const dns = require("node:dns");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");
const test = require("node:test");
const gate = require("../../src/helpers/privacy/egressGate");
const backstop = require("../../src/helpers/privacy/egressBackstop");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError, sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");

const flags = { sealed: false };
let recorder;
backstop.installNodeBackstop();

test.beforeEach(() => {
  flags.sealed = false;
  recorder = new FlightRecorder({ now: () => 1 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now: () => 1 });
});

// Resolve a non-loopback *name* to the loopback server, so "remote" sockets can
// be exercised offline. Node 20+ asks for all addresses (autoSelectFamily).
const toLoopback = (_host, options, callback) =>
  options && options.all ? callback(null, [{ address: "127.0.0.1", family: 4 }]) : callback(null, "127.0.0.1", 4);
const toPublic = (_host, options, callback) =>
  options && options.all ? callback(null, [{ address: "93.184.215.14", family: 4 }]) : callback(null, "93.184.215.14", 4);

async function echoServer(t) {
  const received = [];
  const server = net.createServer((socket) => {
    socket.on("data", (d) => received.push(d));
    socket.pipe(socket);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return { port: server.address().port, received };
}
const once = (emitter, event) => new Promise((resolve) => emitter.once(event, resolve));

test("sealed: a raw socket to a remote host is refused before DNS", async () => {
  flags.sealed = true;
  let looked = false;
  const socket = net.connect({ host: "example.invalid", port: 443, lookup: () => { looked = true; } });
  const error = await once(socket, "error");
  assert.ok(isSealedModeError(error));
  assert.equal(looked, false);
  const [row] = recorder.list();
  assert.deepEqual([row.task, row.host, row.outcome, row.attributed], ["unattributed", "example.invalid", "blocked", false]);
});

test("sealed: https.request is refused", async () => {
  flags.sealed = true;
  const req = https.request("https://example.invalid/");
  req.end();
  assert.ok(isSealedModeError(await once(req, "error")));
});

test("sealed: global fetch (undici) is refused", async () => {
  flags.sealed = true;
  await assert.rejects(fetch("https://example.invalid/"), (error) => isSealedModeError(error));
});

test("sealed: a ws handshake is refused", async () => {
  flags.sealed = true;
  const WebSocket = require("ws");
  const ws = new WebSocket("wss://example.invalid/stream");
  assert.ok(isSealedModeError(await once(ws, "error")));
});

const DNS_ENTRY_TEST = /^(lookup|lookupService|resolve\w*|reverse)$/;

test("sealed: every DNS API refuses remote names (lookup, resolvers, promises, Resolver classes)", async () => {
  flags.sealed = true;
  await assert.rejects(dns.promises.lookup("example.invalid"), isSealedModeError);
  assert.ok(isSealedModeError(await new Promise((r) => dns.lookup("example.invalid", (e) => r(e)))));
  assert.ok(isSealedModeError(await new Promise((r) => dns.resolve4("example.invalid", (e) => r(e)))));
  assert.ok(isSealedModeError(await new Promise((r) => dns.resolveTxt("example.invalid", (e) => r(e)))));
  await assert.rejects(dns.promises.resolveAny("example.invalid"), isSealedModeError);
  await assert.rejects(new dns.promises.Resolver().resolve4("example.invalid"), isSealedModeError);
  assert.ok(isSealedModeError(await new Promise((r) => new dns.Resolver().resolveMx("example.invalid", (e) => r(e)))));
  assert.ok(isSealedModeError(await new Promise((r) => dns.lookupService("93.184.215.14", 443, (e) => r(e)))));
});

test("pending DNS lookups are counted until they answer", async () => {
  const pending = new Promise((r) => dns.lookup("localhost", () => r()));
  assert.equal(backstop.status().pendingDns >= 1, true);
  await pending;
  assert.equal(backstop.status().pendingDns, 0);
});

// A resolver pointed at a loopback UDP port that never answers: a query that
// stays in flight without any packet leaving this computer.
async function silentDnsServer(t) {
  const server = dgram.createSocket("udp4");
  t.after(() => server.close());
  await new Promise((r) => server.bind(0, "127.0.0.1", r));
  return `127.0.0.1:${server.address().port}`;
}

test("every resolver query issued before the seal is counted until it ends (callback, promise, Resolver)", async (t) => {
  const address = await silentDnsServer(t);
  const callbackResolver = new dns.Resolver({ timeout: 60000, tries: 1 });
  callbackResolver.setServers([address]);
  const promiseResolver = new dns.promises.Resolver({ timeout: 60000, tries: 1 });
  promiseResolver.setServers([address]);
  const before = backstop.status().pendingDns;
  const viaCallback = new Promise((r) => callbackResolver.resolveTxt("stalled.example", (e) => r(e)));
  const viaReverse = new Promise((r) => callbackResolver.reverse("192.0.2.1", (e) => r(e)));
  const viaPromise = promiseResolver.resolve4("stalled.example").catch((e) => e);
  assert.equal(backstop.status().pendingDns, before + 3, "all three are in flight and counted");
  flags.sealed = true; // sealing does not make them vanish from the count
  assert.equal(backstop.status().pendingDns, before + 3);
  callbackResolver.cancel();
  promiseResolver.cancel();
  await Promise.all([viaCallback, viaReverse, viaPromise]);
  assert.equal(backstop.status().pendingDns, before, "each decremented exactly once");
});

test("sealed: lookupService (callback and promise) never reaches the native resolver for a remote address", async () => {
  flags.sealed = true;
  const before = backstop.status().pendingDns;
  await assert.rejects(dns.promises.lookupService("93.184.215.14", 443), isSealedModeError);
  assert.ok(isSealedModeError(await new Promise((r) => dns.lookupService("93.184.215.14", 443, (e) => r(e)))));
  assert.equal(backstop.status().pendingDns, before, "refused before dispatch, so never counted");
  assert.deepEqual(await dns.promises.lookupService("127.0.0.1", 22), { hostname: "localhost", service: "22" }, "loopback is answered locally");
});

test("sealed: localhost names and loopback literals are answered without a resolver", async () => {
  flags.sealed = true;
  const before = backstop.status().pendingDns;
  assert.deepEqual(await dns.promises.lookup("app.localhost", { family: 4 }), { address: "127.0.0.1", family: 4 });
  assert.deepEqual(await dns.promises.lookup("127.0.0.2"), { address: "127.0.0.2", family: 4 });
  assert.equal(backstop.status().pendingDns, before);
});

test("every DNS entry point in node:dns and node:dns/promises is wrapped, top-level and on Resolver instances", () => {
  for (const target of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
    const names = Object.getOwnPropertyNames(target).filter((n) => DNS_ENTRY_TEST.test(n) && typeof target[n] === "function");
    assert.ok(names.length >= 10, "found the module's resolver functions");
    for (const name of names) assert.equal(target[name].__loquiEgress, true, name);
  }
});

test("sealed: UDP to a remote address is refused; loopback UDP works", async (t) => {
  flags.sealed = true;
  const sender = dgram.createSocket("udp4");
  t.after(() => sender.close());
  const error = await new Promise((r) => sender.send(Buffer.from("x"), 53, "8.8.8.8", (e) => r(e)));
  assert.ok(isSealedModeError(error));
  const receiver = dgram.createSocket("udp4");
  t.after(() => receiver.close());
  await new Promise((r) => receiver.bind(0, "127.0.0.1", r));
  const got = once(receiver, "message");
  sender.send(Buffer.from("local"), receiver.address().port, "127.0.0.1");
  assert.equal(String(await got), "local");
});

test("sealed: loopback keeps working by address and by localhost", async (t) => {
  flags.sealed = true;
  const server = http.createServer((_req, res) => res.end("local"));
  // Dual-stack, so "localhost" works whether it resolves to 127.0.0.1 or ::1.
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const { port } = server.address();
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), "local");
  assert.equal(await (await fetch(`http://localhost:${port}/`)).text(), "local");
  assert.equal(recorder.list().length, 0);
});

test("localhost and *.localhost are pinned to loopback even when a lookup says otherwise", async (t) => {
  const { port, received } = await echoServer(t);
  for (const host of ["localhost", "app.localhost"]) {
    const socket = net.connect({ host, port, family: 4, lookup: toPublic });
    await once(socket, "connect");
    assert.equal(socket.remoteAddress, "127.0.0.1", host);
    socket.end("ok");
    await once(socket, "close");
  }
  assert.equal(Buffer.concat(received).toString(), "okok");
});

test("sealed: a loopback proxy is not allowed to tunnel or forward to a remote host", async (t) => {
  flags.sealed = true;
  const { port, received } = await echoServer(t);
  const tunnel = http.request({ host: "127.0.0.1", port, method: "CONNECT", path: "api.openai.com:443" });
  tunnel.end();
  assert.ok(isSealedModeError(await once(tunnel, "error")));
  const forward = http.request({ host: "127.0.0.1", port, method: "GET", path: "http://api.openai.com/v1/models" });
  forward.end();
  assert.ok(isSealedModeError(await once(forward, "error")));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(Buffer.concat(received).length, 0, "the proxy received nothing");
});

test("unsealed: an unexplained remote connection is recorded with its wire bytes", async (t) => {
  const { port } = await echoServer(t);
  const socket = net.connect({ host: "tracker.example", port, lookup: toLoopback });
  await once(socket, "connect");
  socket.end("hi");
  socket.resume();
  await once(socket, "close");
  const [row] = recorder.list();
  assert.deepEqual([row.task, row.host, row.attributed, row.bytesOut], ["unattributed", "tracker.example", false, 2]);
});

test("a same-host connection outside the ticket's context is still unexplained", async (t) => {
  const { port } = await echoServer(t);
  const ticket = gate.authorize({ task: "chat", target: "https://api.provider.example" });
  const socket = net.connect({ host: "api.provider.example", port, lookup: toLoopback }); // not in runWithTicket
  await once(socket, "connect");
  socket.end();
  socket.resume();
  await once(socket, "close");
  const [row] = recorder.list();
  assert.deepEqual([row.task, row.attributed], ["unattributed", false]);
  ticket.discard();
});

test("unsealed: a connection inside a ticket joins its host trail", async (t) => {
  const { port } = await echoServer(t);
  await gate.guard({ task: "chat", target: "https://api.provider.example" }, async () => {
    const socket = net.connect({ host: "edge.provider.example", port, lookup: toLoopback });
    await once(socket, "connect");
    socket.end();
    socket.resume();
    await once(socket, "close");
  });
  const rows = recorder.list();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].task, rows[0].hosts, rows[0].attributed], ["chat", ["api.provider.example", "edge.provider.example"], true]);
});

test("a socket-metered ticket settles with wire bytes when its socket closes", async (t) => {
  const { port } = await echoServer(t);
  const ticket = gate.authorize({ task: "dictationStt", target: "wss://api.provider.example", meter: "socket" });
  await gate.runWithTicket(ticket, async () => {
    const socket = net.connect({ host: "api.provider.example", port, lookup: toLoopback });
    await once(socket, "connect");
    socket.end("abc");
    socket.resume();
    await once(socket, "close");
  });
  const [row] = recorder.list();
  assert.deepEqual([row.task, row.outcome, row.bytesOut], ["dictationStt", "ok", 3]);
});

test("a ticket authorised before sealing is cut off at connect after sealing", async () => {
  const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com" });
  flags.sealed = true;
  const socket = gate.runWithTicket(ticket, () => net.connect({ host: "api.groq.com", port: 443 }));
  const error = await once(socket, "error");
  assert.equal(sealedPhaseOf(error), "interrupted");
  assert.equal(sealedPhaseOf(ticket.signal.reason), "interrupted");
});

test("severAll destroys open remote Node sockets and leaves loopback ones alone", async (t) => {
  const { port } = await echoServer(t);
  const remote = net.connect({ host: "stream.provider.example", port, lookup: toLoopback });
  const local = net.connect({ host: "127.0.0.1", port });
  await Promise.all([once(remote, "connect"), once(local, "connect")]);
  assert.equal(backstop.status().openRemoteSockets, 1);
  const closed = once(remote, "close");
  assert.equal(backstop.severAll(), 1);
  assert.equal(backstop.status().openRemoteSockets, 1, "counted until the socket has actually closed");
  await closed;
  assert.equal(remote.destroyed, true);
  assert.equal(local.destroyed, false);
  assert.equal(backstop.status().openRemoteSockets, 0);
  local.destroy();
});

test("there is no API that resets every Chromium connection", () => {
  assert.equal(backstop.closeChromiumConnections, undefined);
});

test("status reports the env-proxy hazard", (t) => {
  const before = process.env.NODE_USE_ENV_PROXY;
  t.after(() => { if (before === undefined) delete process.env.NODE_USE_ENV_PROXY; else process.env.NODE_USE_ENV_PROXY = before; });
  delete process.env.NODE_USE_ENV_PROXY;
  assert.equal(backstop.status().envProxy, false);
  process.env.NODE_USE_ENV_PROXY = "1";
  assert.equal(backstop.status().envProxy, true);
});

function fakeSession() {
  const s = { listeners: {} };
  s.webRequest = new Proxy({}, { get: (_t, name) => (listener) => { s.listeners[name] = listener; } });
  return s;
}
let nextId = 1;
const before = (s, url, extra = {}) =>
  new Promise((resolve) => s.listeners.onBeforeRequest({ id: nextId++, url, webContentsId: 7, ...extra }, resolve));
const sendHeaders = (s, id, requestHeaders) =>
  new Promise((resolve) => s.listeners.onBeforeSendHeaders({ id, requestHeaders }, resolve));

test("chromium: sealed cancels remote, keeps local schemes and loopback", async () => {
  const s = fakeSession();
  backstop.watchSession(s);
  flags.sealed = true;
  assert.deepEqual(await before(s, "https://api.github.com/repos/snowopsdev/loqui/releases"), { cancel: true });
  assert.deepEqual(await before(s, "file:///Applications/Loqui.app/index.html"), { cancel: false });
  assert.deepEqual(await before(s, "http://localhost:5174/"), { cancel: false });
  assert.deepEqual(await before(s, "devtools://devtools/bundled/inspector.html"), { cancel: false });
  assert.equal(recorder.list()[0].outcome, "blocked");
});

test("chromium: a tagged request is attributed, the tag is stripped, and redirects extend the trail", async () => {
  const s = fakeSession();
  backstop.watchSession(s);
  const ticket = gate.authorize({ task: "modelDownload", target: "https://huggingface.co/m" });
  const id = nextId;
  await before(s, "https://huggingface.co/m");
  const sent = await sendHeaders(s, id, { Accept: "*/*", [gate.EGRESS_TAG_HEADER]: ticket.tag });
  assert.deepEqual(sent, { requestHeaders: { Accept: "*/*" } }, "the tag never leaves");
  s.listeners.onBeforeRedirect({ id, url: "https://huggingface.co/m", redirectURL: "https://cdn-lfs.hf.co/m" });
  s.listeners.onCompleted({ id, statusCode: 200 });
  assert.deepEqual(ticket.hosts, ["huggingface.co", "cdn-lfs.hf.co"]);
  assert.equal(recorder.list().length, 0, "the ticket records it, not the backstop");
  ticket.discard();
});

test("chromium: an untagged remote request is unexplained, recorded at completion with its status and redirect trail", async () => {
  const s = fakeSession();
  backstop.watchSession(s);
  const ticket = gate.authorize({ task: "chat", target: "https://images.example.com" }); // same host, no tag
  const id = nextId;
  await before(s, "https://images.example.com/a.png");
  await sendHeaders(s, id, {});
  s.listeners.onBeforeRedirect({ id, redirectURL: "https://cdn.images.example.net/a.png?sig=secret" });
  assert.equal(recorder.list().length, 0, "not recorded until it finishes");
  s.listeners.onCompleted({ id, statusCode: 404 });
  const [row] = recorder.list();
  assert.deepEqual([row.task, row.host, row.outcome, row.status, row.attributed], ["unattributed", "images.example.com", "error", 404, false]);
  assert.deepEqual(row.hosts, ["images.example.com", "cdn.images.example.net"], "every hop, as bare hosts");
  ticket.discard();
});

test("chromium: a redirect into a refused host records the whole trail as blocked", async () => {
  const s = fakeSession();
  backstop.watchSession(s);
  const hop = nextId;
  await before(s, "https://first.example.com/a"); // allowed: not sealed yet
  flags.sealed = true;
  s.listeners.onBeforeRedirect({ id: hop, redirectURL: "https://second.example.net/b" });
  // Chromium re-runs onBeforeRequest for the redirected URL with the same request id.
  assert.deepEqual(await before(s, "https://second.example.net/b", { id: hop }), { cancel: true });
  const row = recorder.list().find((r) => r.outcome === "blocked");
  assert.deepEqual([row.task, row.host], ["unattributed", "first.example.com"]);
  assert.deepEqual(row.hosts, ["first.example.com", "second.example.net"], "the allowed first hop stays in the ledger");
  ticket.discard();
});

test("chromium: remote requests are tracked in flight until they end; a destroyed webContents does not clear them", async () => {
  const s = fakeSession();
  backstop.watchSession(s);
  const listeners = {};
  backstop.installWebContentsGuard({ on: (event, fn) => { listeners[event] = fn; } });
  const contents = Object.assign(new (require("node:events").EventEmitter)(), { id: 42, setWebRTCIPHandlingPolicy() {} });
  listeners["web-contents-created"]({}, contents);
  const base = backstop.status().chromiumInFlightRemote;
  const a = nextId; await before(s, "https://images.example.com/a.png");
  const b = nextId; await before(s, "https://images.example.com/b.png");
  const c = nextId; await before(s, "https://images.example.com/c.png", { webContentsId: 42 });
  await before(s, "http://127.0.0.1:8080/local");
  assert.equal(backstop.status().chromiumInFlightRemote, base + 3);
  s.listeners.onCompleted({ id: a, statusCode: 200 });
  s.listeners.onErrorOccurred({ id: b, error: "net::ERR_ABORTED" });
  contents.emit("destroyed");
  assert.equal(backstop.status().chromiumInFlightRemote, base + 1, "destroyed is not an end: evidence stays");
  s.listeners.onErrorOccurred({ id: c, error: "net::ERR_ABORTED" });
  assert.equal(backstop.status().chromiumInFlightRemote, base);
});

test("an observer can veto a chromium request (smoke test hook)", async (t) => {
  const s = fakeSession();
  backstop.watchSession(s);
  const off = backstop.addObserver((e) => e.layer === "chromium" && e.host === "openwhispr.com");
  t.after(off);
  assert.deepEqual(await before(s, "https://openwhispr.com/x"), { cancel: true });
});

test("every webContents gets the WebRTC no-UDP policy", () => {
  const listeners = {};
  backstop.installWebContentsGuard({ on: (event, fn) => { listeners[event] = fn; } });
  let policy = null;
  listeners["web-contents-created"]({}, Object.assign(new (require("node:events").EventEmitter)(), { id: 1, setWebRTCIPHandlingPolicy: (p) => { policy = p; } }));
  assert.equal(policy, "disable_non_proxied_udp");
  assert.equal(backstop.status().webContents, true);
});

test("status reports installed guards", () => {
  const s = backstop.status();
  assert.deepEqual([s.node, s.dns, s.dgram, s.http], [true, true, true, true]);
  assert.ok(s.sessions >= 1);
});

test("only the backstop registers webRequest listeners; no proxy agents or peer connections in the app", () => {
  const repoRoot = path.join(__dirname, "../..");
  const hits = (pattern) => {
    const out = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
        const rel = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) walk(rel);
        else if (/\.(c?js|mjs|ts|tsx|jsx)$/.test(entry.name) && pattern.test(fs.readFileSync(path.join(repoRoot, rel), "utf8"))) out.push(rel);
      }
    };
    walk("src");
    walk("scripts");
    for (const file of ["main.js", "preload.js"])
      if (pattern.test(fs.readFileSync(path.join(repoRoot, file), "utf8"))) out.push(file);
    return out;
  };
  const walkFiles = (dir, out = []) => {
    for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walkFiles(rel, out);
      else if (/\.(c?js|mjs|ts|tsx|jsx)$/.test(entry.name)) out.push(rel);
    }
    return out;
  };
  assert.deepEqual(hits(/webRequest\.(onBeforeRequest|onBeforeRedirect|onCompleted|onErrorOccurred|onBeforeSendHeaders|onHeadersReceived|onSendHeaders|onResponseStarted)\s*\(/), [
    "src/helpers/privacy/egressBackstop.js",
  ]);
  assert.deepEqual(hits(/\b(ProxyAgent|EnvHttpProxyAgent|setGlobalDispatcher)\b/), []);
  // Peer connections: none in the app. Two places may name the constructors:
  // the preload's marked removal block (Task 7a), and the acceptance script that
  // checks they are gone (Task 16). Nothing else.
  const withoutRemovalBlock = (file, text) =>
    file === "preload.js" ? text.replace(/\/\/ BEGIN sealed-mode: WebRTC removal[\s\S]*?\/\/ END sealed-mode: WebRTC removal/, "") : text;
  const peerHits = [];
  for (const file of [...walkFiles("src"), ...walkFiles("scripts"), "main.js", "preload.js"]) {
    if (file === "scripts/sealed-acceptance.cjs") continue;
    const text = withoutRemovalBlock(file, fs.readFileSync(path.join(repoRoot, file), "utf8"));
    if (/\b(RTCPeerConnection|webkitRTCPeerConnection)\b/.test(text)) peerHits.push(file);
  }
  assert.deepEqual(peerHits, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/helpers/egressBackstop.test.js`
Expected: FAIL with `Cannot find module '../../src/helpers/privacy/egressBackstop'`.

- [ ] **Step 3: Implement**

Create `src/helpers/privacy/egressBackstop.js`:

```js
const net = require("node:net");
const dns = require("node:dns");
const dgram = require("node:dgram");
const http = require("node:http");
const https = require("node:https");
const { syncBuiltinESMExports } = require("node:module");
const { decideEgress, isLoopbackHost, normalizeHost, hostOf } = require("./egressPolicy");
const gate = require("./egressGate");

// Layer B of Sealed mode. It does not know tasks; it guarantees. Node traffic
// is checked at the socket, DNS, UDP and proxy level; Chromium traffic (Electron
// net, electron-updater, renderer loads) at each session's webRequest.
const LOCAL_SCHEMES = new Set(["file:", "devtools:", "chrome:", "chrome-extension:", "data:", "blob:", "about:"]);
const NETWORK_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);
// Every name-resolution entry point Node exposes (C2-R2). The list is checked
// against the live modules by a test, so a new Node API cannot slip past.
const RESOLVER_METHODS = [
  "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa", "resolveCname", "resolveMx",
  "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTlsa", "resolveTxt", "reverse",
];

const installed = { node: false, dns: false, dgram: false, http: false, webContents: false };
const sessions = new Set();
const openRemoteSockets = new Set();
const chromiumInFlight = new Map(); // `${sessionTag}:${id}` → { host, ts, ticket, webContentsId }
const observers = new Set();
let pendingDns = 0;

function addObserver(fn) {
  observers.add(fn);
  return () => observers.delete(fn);
}
function notify(event) {
  let veto = false;
  for (const fn of observers) {
    try {
      if (fn(event) === true) veto = true;
    } catch {
      // An observer must not break enforcement.
    }
  }
  return veto;
}

const block = (host) =>
  gate.recordBackstopBlock({ host: normalizeHost(String(host ?? "")) ?? "unknown", ticket: gate.currentTicket() });
const isPinnedName = (host) => host === "localhost" || host.endsWith(".localhost");

// localhost and *.localhost are answered here, never by DNS or a caller-
// supplied lookup, so a name that claims to be local cannot be steered away.
function pinnedLoopbackLookup(_hostname, options, callback) {
  if (typeof options === "function") [callback, options] = [options, {}];
  const both = [
    { address: "127.0.0.1", family: 4 },
    { address: "::1", family: 6 },
  ];
  const wanted = options?.family === 6 ? both.slice(1) : options?.family === 4 ? both.slice(0, 1) : both;
  if (options?.all) process.nextTick(callback, null, wanted);
  else process.nextTick(callback, null, wanted[0].address, wanted[0].family);
}

// net.connect()/tls.connect() call Socket#connect with one normalised
// [options, callback] array; direct callers pass (options | port | path, ...).
function connectTarget(args) {
  const normalized = Array.isArray(args[0]);
  const first = normalized ? args[0][0] : args[0];
  if (first && typeof first === "object") {
    if (first.path) return { local: true };
    return { host: first.host ?? "localhost", options: first };
  }
  if (typeof first === "string" && !/^\d+$/.test(first)) return { local: true };
  const host = normalized ? undefined : args[1];
  return { host: typeof host === "string" ? host : "localhost" };
}

function pinLocal(args, target, host) {
  if (target.options) {
    target.options.lookup = pinnedLoopbackLookup;
    return args;
  }
  const callback = args.find((a) => typeof a === "function");
  return [{ port: Number(args[0]), host, lookup: pinnedLoopbackLookup }, ...(callback ? [callback] : [])];
}

function installSocketHook() {
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function egressAwareConnect(...args) {
    const target = connectTarget(args);
    if (target.local) return originalConnect.apply(this, args);
    const host = normalizeHost(String(target.host)) ?? "unknown";
    if (isPinnedName(host)) return originalConnect.apply(this, pinLocal(args, target, host));
    if (isLoopbackHost(host)) return originalConnect.apply(this, args);
    const ticket = gate.currentTicket();
    if (gate.isSealed()) {
      const error = gate.recordBackstopBlock({ host, ticket });
      notify({ layer: "node", host, allowed: false });
      process.nextTick(() => this.destroy(error));
      return this;
    }
    // Attribution by context only: a same-host socket opened elsewhere is unexplained.
    if (ticket) {
      ticket.addHost(host);
      ticket.noteConnection?.(); // an operation with sockets but no metered request is a "connection" row (I3)
      if (ticket.meter === "socket") ticket.attachSocket(this);
    }
    const startedAt = Date.now();
    openRemoteSockets.add(this);
    this.once("close", (hadError) => {
      openRemoteSockets.delete(this);
      // One row per connection, recorded when it closes: Loqui cannot see the
      // requests inside it (keep-alive reuse is one row, labelled as such).
      if (!ticket)
        gate.recordUnattributed({
          host,
          kind: "connection",
          outcome: hadError ? "error" : "ok",
          bytesOut: this.bytesWritten,
          bytesIn: this.bytesRead,
          ts: startedAt,
        });
    });
    notify({ layer: "node", host, allowed: true });
    return originalConnect.apply(this, args);
  };
  installed.node = true;
}

// A local proxy forwards to another machine, so a loopback socket is not proof
// that nothing leaves. Refuse CONNECT tunnels and absolute-form requests that
// name a remote host while sealed.
function forwardTarget(args) {
  let options = {};
  if (typeof args[0] === "string" || args[0] instanceof URL) {
    const url = new URL(String(args[0]));
    options = { host: url.hostname, path: `${url.pathname}${url.search}`, method: "GET" };
    if (args[1] && typeof args[1] === "object" && typeof args[1] !== "function") options = { ...options, ...args[1] };
  } else if (args[0] && typeof args[0] === "object") {
    options = args[0];
  }
  const host = normalizeHost(String(options.hostname ?? options.host ?? "localhost"));
  const method = String(options.method ?? "GET").toUpperCase();
  const requestPath = String(options.path ?? "/");
  if (method === "CONNECT") return { host, forwardTo: normalizeHost(requestPath) };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(requestPath)) return { host, forwardTo: hostOf(requestPath) };
  return { host, forwardTo: null };
}

function installProxyHook() {
  for (const client of [http, https]) {
    for (const method of ["request", "get"]) {
      const original = client[method];
      client[method] = function egressAwareRequest(...args) {
        const req = original.apply(this, args);
        if (gate.isSealed()) {
          let target;
          try {
            target = forwardTarget(args);
          } catch {
            target = null;
          }
          if (target?.forwardTo && isLoopbackHost(target.host) && !isLoopbackHost(target.forwardTo)) {
            notify({ layer: "node", host: target.forwardTo, allowed: false });
            req.destroy(block(target.forwardTo));
          }
        }
        return req;
      };
    }
  }
  installed.http = true;
}

function refuseDns(host, callback) {
  const error = block(host);
  if (typeof callback === "function") process.nextTick(callback, error);
  return error;
}

// One query counts in pendingDns from the call until its callback or promise
// settles, exactly once, including a synchronous throw. The sealing barrier and
// the attestation wait for it to reach 0 (Task 7).
function counted(original, self, args, style) {
  let done = false;
  const finish = () => {
    if (!done) {
      done = true;
      pendingDns--;
    }
  };
  pendingDns++;
  try {
    if (style === "promise") return Promise.resolve(original.apply(self, args)).finally(finish);
    const last = args.length - 1;
    const callback = args[last];
    if (typeof callback === "function") {
      args[last] = (...result) => {
        finish();
        callback(...result);
      };
    } else {
      finish(); // Node throws on a missing callback; nothing is in flight.
    }
    return original.apply(self, args);
  } catch (error) {
    finish();
    throw error;
  }
}

// While sealed, nothing reaches the native resolver, except an answer Loqui can
// give itself: localhost names and loopback literals for lookup, and loopback
// addresses for lookupService. Resolver queries (resolve*, reverse) always go to
// a DNS server, so they are refused outright.
function sealedAnswer(kind, args) {
  if (kind === "lookup") {
    const [hostname, maybeOptions] = args;
    const host = normalizeHost(String(hostname ?? ""));
    if (isPinnedName(host)) return { lookup: true };
    if (host && isLoopbackHost(host) && net.isIP(host)) {
      return { literal: { address: host, family: net.isIP(host) }, options: typeof maybeOptions === "object" ? maybeOptions : {} };
    }
    return null;
  }
  if (kind === "lookupService") {
    const [address, port] = args;
    return isLoopbackHost(String(address)) ? { service: { hostname: "localhost", service: String(port) } } : null;
  }
  return null;
}

function answerSealed(kind, args, style, answer) {
  if (answer.lookup) {
    if (style === "promise") {
      return new Promise((resolve, reject) =>
        pinnedLoopbackLookup(args[0], args[1] ?? {}, (error, address, family) =>
          error ? reject(error) : resolve(Array.isArray(address) ? address : { address, family })
        )
      );
    }
    pinnedLoopbackLookup(...args);
    return {};
  }
  if (answer.literal) {
    const value = answer.options?.all ? [answer.literal] : answer.literal;
    if (style === "promise") return Promise.resolve(value);
    const callback = args[args.length - 1];
    if (answer.options?.all) process.nextTick(callback, null, value);
    else process.nextTick(callback, null, value.address, value.family);
    return {};
  }
  if (style === "promise") return Promise.resolve(answer.service);
  process.nextTick(args[args.length - 1], null, answer.service.hostname, answer.service.service);
  return undefined;
}

function wrapDnsEntry(target, name, style) {
  const original = target[name];
  if (typeof original !== "function" || original.__loquiEgress) return;
  const kind = name === "lookup" || name === "lookupService" ? name : "resolver";
  const wrapped = function egressAwareDns(...args) {
    if (gate.isSealed()) {
      const answer = sealedAnswer(kind, args);
      if (answer) return answerSealed(kind, args, style, answer);
      const query = String(args[0] ?? "unknown");
      notify({ layer: "node", host: normalizeHost(query) ?? "unknown", allowed: false });
      if (style === "promise") return Promise.reject(block(query));
      refuseDns(query, args[args.length - 1]);
      return kind === "lookup" ? {} : undefined;
    }
    return counted(original, this, args, style);
  };
  wrapped.__loquiEgress = true;
  target[name] = wrapped;
}

function installDnsHook() {
  const targets = [
    [dns, "callback"],
    [dns.Resolver.prototype, "callback"],
    [dns.promises, "promise"],
    [dns.promises.Resolver.prototype, "promise"],
  ];
  for (const [target, style] of targets) {
    for (const name of ["lookup", "lookupService", ...RESOLVER_METHODS]) wrapDnsEntry(target, name, style);
  }
  installed.dns = true;
}

function installDgramHook() {
  const originalSend = dgram.Socket.prototype.send;
  dgram.Socket.prototype.send = function egressAwareSend(...args) {
    if (gate.isSealed()) {
      let address = args.slice(1).find((a) => typeof a === "string");
      if (!address) {
        try {
          address = this.remoteAddress().address;
        } catch {
          address = "127.0.0.1"; // Node's default destination for an unconnected send
        }
      }
      if (!isLoopbackHost(address)) {
        const error = block(address);
        const callback = args[args.length - 1];
        if (typeof callback === "function") process.nextTick(callback, error);
        else process.nextTick(() => this.emit("error", error));
        return undefined;
      }
    }
    return originalSend.apply(this, args);
  };
  const originalUdpConnect = dgram.Socket.prototype.connect;
  dgram.Socket.prototype.connect = function egressAwareUdpConnect(port, address, callback) {
    if (gate.isSealed() && typeof address === "string" && !isLoopbackHost(address)) {
      const error = block(address);
      process.nextTick(() => (typeof callback === "function" ? callback(error) : this.emit("error", error)));
      return undefined;
    }
    return originalUdpConnect.apply(this, arguments);
  };
  installed.dgram = true;
}

function installNodeBackstop() {
  if (installed.node) return;
  installSocketHook();
  installProxyHook();
  installDnsHook();
  installDgramHook();
  // ESM importers of node builtins (SDKs loaded with import()) see the patches too.
  syncBuiltinESMExports();
}

function judge(url) {
  let protocol;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return { cancel: gate.isSealed(), remote: false };
  }
  if (LOCAL_SCHEMES.has(protocol)) return { cancel: false, remote: false };
  if (!NETWORK_SCHEMES.has(protocol)) return { cancel: gate.isSealed(), remote: false };
  const decision = decideEgress({ sealed: gate.isSealed(), target: url });
  if (decision.loopback) return { cancel: false, remote: false };
  if (!decision.allow) {
    notify({ layer: "chromium", host: decision.host, url, allowed: false });
    return { cancel: true, remote: true, host: decision.host };
  }
  if (notify({ layer: "chromium", host: decision.host, url, allowed: true })) return { cancel: true, remote: true, host: decision.host };
  return { cancel: false, remote: true, host: decision.host };
}

const judgeChromiumRequest = (url) => ({ cancel: judge(url).cancel });

function finishChromium(key, { outcome, status = null }) {
  const entry = chromiumInFlight.get(key);
  if (!entry) return;
  chromiumInFlight.delete(key);
  if (entry.attempt) {
    for (const h of entry.hosts) entry.attempt.addHost(h);
    entry.attempt.status = status;
    if (status !== null) entry.attempt.markDelivered();
    entry.attempt.settle({ outcome, errorClass: status >= 500 ? "HTTP_5XX" : status >= 400 ? "HTTP_4XX" : outcome === "error" ? "OTHER" : null });
    return;
  }
  // A metered request records itself; only untagged ones are recorded here.
  if (!entry.ticket) gate.recordUnattributed({ host: entry.host, hosts: entry.hosts, kind: "request", outcome, status, ts: entry.ts });
}

// Electron keeps a single listener per webRequest event, so this module must
// be the only caller (enforced by test/helpers/egressBackstop.test.js).
// electron-updater uses its own partition session, which is why every session
// is watched through app.on("session-created"), not only defaultSession.
let sessionSeq = 0;
function watchSession(session) {
  if (!session?.webRequest || sessions.has(session)) return;
  sessions.add(session);
  const tag = ++sessionSeq;
  const key = (details) => `${tag}:${details.id}`;
  session.webRequest.onBeforeRequest((details, callback) => {
    const verdict = judge(details.url);
    const existing = chromiumInFlight.get(key(details)); // a redirect hop of a request already in flight
    if (verdict.cancel && verdict.remote && gate.isSealed()) {
      // A refused redirect hop: record the whole trail, including the hops
      // that were allowed before it.
      const trail = existing ? [...new Set([...existing.hosts, verdict.host])].slice(0, 8) : null;
      gate.recordBackstopBlock({ host: verdict.host, hosts: trail, ticket: existing?.ticket ?? null });
      chromiumInFlight.delete(key(details));
    } else if (!verdict.cancel && verdict.remote && !existing) {
      chromiumInFlight.set(key(details), { host: verdict.host, hosts: [verdict.host], ts: Date.now(), ticket: null, webContentsId: details.webContentsId });
    }
    callback({ cancel: verdict.cancel });
  });
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    const tagName = Object.keys(requestHeaders).find((h) => h.toLowerCase() === gate.EGRESS_TAG_HEADER);
    if (tagName) {
      const owner = gate.ticketByTag(requestHeaders[tagName]); // one attempt, or a whole operation's ticket
      delete requestHeaders[tagName]; // the tag never leaves this computer
      const entry = chromiumInFlight.get(key(details));
      if (entry && owner) {
        entry.ticket = owner;
        if (owner.ticket) {
          owner.addHost(entry.host); // a metered request: it records itself
        } else {
          // A ticket that tags a whole session (electron-updater): each Chromium
          // request becomes its own attempt row, settled when it ends (I3).
          entry.attempt = owner.beginAttempt(entry.host);
          entry.attempt.markDispatched();
        }
      }
    }
    callback({ requestHeaders });
  });
  // Every hop joins the trail, ticketed or not; the next hop is judged again in onBeforeRequest.
  session.webRequest.onBeforeRedirect((details) => {
    const entry = chromiumInFlight.get(key(details));
    const next = hostOf(details.redirectURL);
    if (!entry || !next) return;
    if (!entry.hosts.includes(next) && entry.hosts.length < 8) entry.hosts.push(next);
    entry.ticket?.addHost(next);
  });
  session.webRequest.onCompleted((details) =>
    finishChromium(key(details), { outcome: details.statusCode >= 400 ? "error" : "ok", status: details.statusCode })
  );
  session.webRequest.onErrorOccurred((details) => finishChromium(key(details), { outcome: "error" }));
}

// Loqui never uses peer connections (ratchet test, and Task 7a removes the
// constructors); this policy is defence in depth. A destroyed webContents'
// requests are cancelled by Chromium, which reports each one through
// onErrorOccurred. They stay counted until it does: a stop is an observed end,
// never an assumption (C3). Task 16's control run would stay unverified if
// Chromium ever skipped that event, so the assumption is tested, not trusted.
function installWebContentsGuard(app) {
  app.on("web-contents-created", (_event, contents) => {
    contents.setWebRTCIPHandlingPolicy?.("disable_non_proxied_udp");
    contents.once?.("destroyed", () => {
      for (const entry of chromiumInFlight.values()) if (entry.webContentsId === contents.id) entry.orphaned = true;
    });
  });
  installed.webContents = true;
}

// Node sockets only: loopback connections (self-hosted STT, llama-server) and
// Chromium's pool are left alone. Ticketed Chromium requests are stopped by
// their own abort signals (gate.abortAllRemote); un-ticketed ones are waited
// for, and keep the attestation unverified until they end.
// Each socket leaves openRemoteSockets on its own "close" (the connect hook),
// so the count drops only once a socket has actually closed.
function severAll() {
  const sockets = [...openRemoteSockets];
  for (const socket of sockets) socket.destroy();
  return sockets.length;
}

const envProxy = () =>
  (!!process.env.NODE_USE_ENV_PROXY && process.env.NODE_USE_ENV_PROXY !== "0") ||
  process.execArgv.includes("--use-env-proxy");

const status = () => ({
  ...installed,
  sessions: sessions.size,
  envProxy: envProxy(),
  openRemoteSockets: openRemoteSockets.size,
  chromiumInFlightRemote: chromiumInFlight.size,
  pendingDns,
});

module.exports = {
  installNodeBackstop,
  watchSession,
  installWebContentsGuard,
  judgeChromiumRequest,
  severAll,
  addObserver,
  status,
};
```

If the global `fetch` test fails with `ENOTFOUND` instead of a sealed error, this Node build's bundled undici is not using the public `net` module. In that case:
- also wrap `globalThis.fetch` inside `installNodeBackstop()`, the same way `scripts/smoke-electron.cjs:71-75` does;
- reject with `block(hostOf(input))` when the gate is sealed and the host is not loopback;
- keep the test unchanged.

- [ ] **Step 4: Point the smoke script at the observer**

In `scripts/smoke-electron.cjs`, replace the block named in **Files** with the snippet below. The `require(path.join(repoRoot, "main.js"));` line after it stays.

```js
  // Electron keeps one listener per webRequest event and the Sealed mode
  // backstop owns them, so observe (and veto) through the backstop.
  require(path.join(repoRoot, "src/helpers/privacy/egressBackstop.js")).addObserver(
    (event) => event.layer === "chromium" && inspect(event.url, "electron-session")
  );
```

`inspect` returns `true` for a request that the smoke run must block, which matches the observer veto contract.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- test/helpers/egressBackstop.test.js test/helpers/egressGate.test.js`
Expected: PASS. Every "remote" socket in these tests resolves to 127.0.0.1 through `toLoopback`; sealed refusals happen before DNS, and UDP goes only to loopback. The one unsealed lookup is for `localhost`, which the OS answers from its hosts file. No test makes an off-host connection or an external DNS query.

- [ ] **Step 6: Commit**

```bash
git add src/helpers/privacy/egressBackstop.js scripts/smoke-electron.cjs test/helpers/egressBackstop.test.js
git commit -m "feat(privacy): add socket, DNS, UDP, proxy and session backstop for Sealed mode"
```

---

### Task 6a: Child processes: a registry that waits for exit, a spawn guard, and local-only FFmpeg

Main's hooks (Tasks 5 and 6) cannot see inside a child process. This task closes that gap for every child Loqui starts. There are two parts:
- **Enforcement.** While sealed, only allowlisted programs start: Loqui's own binaries and known sidecars (with launch rules), named system tools (with argument rules), and Loqui itself. A network-capable program, a spawn from third-party code inside `node_modules` (an SDK credential helper, for example), and any unclassified program are refused before they start. FFmpeg is always restricted to local inputs. The ONNX utility process installs the Node backstop with the seal forced on, so it cannot reach the network at all.
- **Evidence.** Every network-capable child that runs while unsealed is registered, and counts as *alive* until the OS reports its exit. For a detached process group, it stays alive until the whole group is gone. Sealing stops these children and waits for them; a child that survives `SIGKILL` keeps the attestation unverified (Task 7). A kill signal is never treated as proof of exit.

**Files:**
- Create: `src/helpers/privacy/childRegistry.js`
- Modify:
  - `src/helpers/ffmpegUtils.js`. Add `localOnlyInputs(args)`, and use it at all three spawn sites: `runFFmpegConversion` (`spawn(ffmpegPath, [...args, "-y", outputPath]`), `splitAudioFile` (`spawn(ffmpegPath, args`) and `mergeAudioSegments` (`spawn(ffmpegPath, args`).
  - `docs/security/sealed-mode-threat-model.md`. Add the `spawn-sites` inventory (Task 1, Step 3).
  - `src/helpers/gpuBinaryManager.js` and `src/helpers/llamaCppInstaller.js`: register their binary directories.
  - `src/workers/onnxWorker.js`: lock the worker's network before anything else runs.
- Test: `test/helpers/childRegistry.test.js`, `test/helpers/ffmpegContainment.test.js` and `test/helpers/workerEgressLock.test.js`

**Interfaces:**
- Produces:

  ```js
  // src/helpers/privacy/childRegistry.js
  installSpawnGuard({ childProcess?, utilityProcess? }): void   // idempotent; wraps spawn/execFile/exec/fork and their Sync forms, and utilityProcess.fork
  register(child, { kind: string, group?: boolean, tree?: boolean }): Entry  // the guard registers automatically; exported for tests
                                                                // group: a POSIX process group (detached spawn); tree: the child and its descendants, on every platform
  alive(kind?: string): Array<{ kind, pid, local }>             // exited only after the OS reported exit (and, for a group, the group is gone); local = an on-device sidecar
  stopAll({ kinds?, termGraceMs = 1500, killGraceMs = 1500 }?): Promise<void>
  onChildEnd(child, fn: ({ code, signal, failedToStart }) => void): void   // once: exit, a failed start (error with no pid), or close without exit
                                                                // SIGTERM → wait → SIGKILL → wait; rejects with code CHILD_STOP_FAILED if any is still alive
  classify(command: string, stack?: string): "network" | "thirdParty" | "ffmpeg" | "bundled" | "osTool" | "self" | "unclassified"
  registerLocalBinaryDir(dir: string): void                     // a directory of binaries Loqui itself installs (GPU runtimes, llama.cpp)
  kindOf(command: string): string                               // "codex", "yt-dlp", or the program's base name
  _resetForTests(): void;  _setSystemForTests({ listProcesses?, pidAlive?, groupAlive?, killGroup? }): void
  ```

  ```js
  // src/helpers/ffmpegUtils.js
  localOnlyInputs(args: string[]): string[]   // inserts "-protocol_whitelist", "file,pipe" before every "-i" that lacks it
  ```

- **Rules.**
  - **`network`** covers `codex`, `yt-dlp*`, `curl`, `wget`, `ffplay`, `aws`, `gcloud`, `ssh` and `git`. It is refused while sealed, and registered while unsealed.
  - **`thirdParty`** is any spawn whose call stack enters `/node_modules/`. It is refused while sealed, and registered while unsealed.
  - **`ffmpeg`** must carry `-protocol_whitelist` before every `-i`, or it is refused in every mode. A crafted local playlist or media file must never make FFmpeg fetch remote resources.
  - **An allowlist, not a default (C2-R2).** While sealed, a program runs only if it is one of these:
    - **`bundled`:** one of two things.
      - A known sidecar by name (`llama-server`, `whisper-server`, `qdrant`, `sherpa-onnx-*`), wherever it is installed. A system `llama-server` that `llamaCppInstaller.getSystemBinaryPath()` found is included.
      - Any program inside Loqui's own binaries: `resources/bin`, `process.resourcesPath`, or a directory registered with `registerLocalBinaryDir` by Loqui's own installers (`gpuBinaryManager`'s `binDir`, `llamaCppInstaller`'s `installDir`).

      Sidecars must pass their launch rules:
      - llama-server is refused with any download flag (`-hf`, `--hf-repo`, `-hfr`, `--hf-file`, `-hff`, `--hf-token`, `-hft`, `-mu`, `--model-url`, `-dr`, `--docker-repo`), and with a `--host` that is not loopback;
      - whisper-server is refused with a `--host` that is not loopback;
      - Qdrant is refused without `--disable-telemetry`.
    - **`osTool`:** a named system tool from `OS_TOOLS`, with its argument rule:
      - `open` only with `-a <application>`, never a URL;
      - `sh` only as `-c "command -v <name>"`;
      - `explorer.exe` only with an `http(s)` URL, which `openExternalUrl` has already confirmed (Task 11);
      - `powershell` is refused while sealed. It only extracts archives after a download, and downloads are refused.
    - **`self`:** `process.execPath`, Loqui relaunching itself.

    Anything else is **`unclassified`** and refused while sealed. Unsealed, it runs, and the spawn-sites ratchet (Task 1) keeps every call site listed.
  - **What this does not cover.** The allowlist controls which programs start, and with which arguments. It cannot see network traffic inside a native program once it runs. Local sidecars are therefore reported as `uninspectedChildren` in the attestation, and the promise is narrowed accordingly (CCR-6, Task 1 Boundary).
  - **`utilityProcess.fork`** is allowed only for modules under the app's `src/workers/` directory, which the inventory ratchet keeps free of network code. Anything else is refused while sealed.
  - **Process trees.** A child registered with `group: true` (a detached POSIX spawn) is alive until its whole process group is gone. A child registered with `tree: true` is alive until it and every descendant listed at stop time are gone, on every platform. The descendants come from `ps` on POSIX and `Get-CimInstance Win32_Process` on Windows. If that listing fails, the child is never reported stopped. Task 10 uses `group` for every yt-dlp process on POSIX (downloads and the self-update both spawn detached), and `tree` on Windows. While a tree's root runs, its descendant list is refreshed at most every 250 ms by the liveness checks.

    **Residual (Windows only, stated in the threat model).** A helper that a tree's root starts and then orphans by exiting, all within one 250 ms refresh interval, is not seen. yt-dlp waits for its post-processors, so this needs a misbehaving binary. POSIX process groups have no such window.

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/childRegistry.test.js`:

```js
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const gate = require("../../src/helpers/privacy/egressGate");
const registry = require("../../src/helpers/privacy/childRegistry");
const { isSealedModeError } = require("../../src/helpers/privacy/egressPolicy");

const flags = { sealed: false };
test.beforeEach(() => {
  flags.sealed = false;
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed });
  registry._resetForTests();
});

function fakeChild({ exitsOn = ["SIGTERM", "SIGKILL"], pid = 4242 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.signals = [];
  child.kill = (signal = "SIGTERM") => {
    child.signals.push(signal);
    if (exitsOn.includes(signal)) setTimeout(() => child.emit("exit", null, signal), 5);
    return true;
  };
  return child;
}
function fakeChildProcess() {
  const calls = [];
  const make = (name) => (...args) => {
    calls.push([name, ...args]);
    return name.endsWith("Sync") ? { status: 0 } : fakeChild();
  };
  return { calls, spawn: make("spawn"), execFile: make("execFile"), exec: make("exec"), fork: make("fork"),
           spawnSync: make("spawnSync"), execFileSync: make("execFileSync"), execSync: make("execSync") };
}

test("a child is alive until it exits, not until it is signalled", async () => {
  const child = fakeChild({ exitsOn: [] });
  registry.register(child, { kind: "yt-dlp" });
  child.kill("SIGKILL");
  assert.deepEqual(registry.alive().map((e) => e.kind), ["yt-dlp"], "a signal is not an exit");
  child.emit("exit", null, "SIGKILL");
  assert.deepEqual(registry.alive(), []);
});

test("stopAll escalates to SIGKILL and waits for the exit", async () => {
  const child = fakeChild({ exitsOn: ["SIGKILL"] });
  registry.register(child, { kind: "codex" });
  await registry.stopAll({ termGraceMs: 30, killGraceMs: 200 });
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(registry.alive(), []);
});

test("stopAll rejects when a child survives SIGKILL, and it stays alive", async () => {
  const child = fakeChild({ exitsOn: [] });
  registry.register(child, { kind: "yt-dlp" });
  await assert.rejects(registry.stopAll({ termGraceMs: 20, killGraceMs: 20 }), (e) => e.code === "CHILD_STOP_FAILED");
  assert.deepEqual(registry.alive().map((e) => e.kind), ["yt-dlp"]);
});

test("a kill that throws leaves the child alive, and stopAll rejects", async () => {
  const child = fakeChild({ exitsOn: [] });
  child.kill = () => { throw Object.assign(new Error("kill EPERM"), { code: "EPERM" }); };
  registry.register(child, { kind: "yt-dlp" });
  await assert.rejects(registry.stopAll({ termGraceMs: 20, killGraceMs: 20 }), (e) => e.code === "CHILD_STOP_FAILED");
  assert.equal(registry.alive().length, 1);
});

test("a process tree stays alive until every descendant listed at stop has exited", async (t) => {
  const running = new Set([501, 502]);
  registry._setSystemForTests({
    listProcesses: () => [{ pid: 500, ppid: 1 }, { pid: 501, ppid: 500 }, { pid: 502, ppid: 501 }, { pid: 900, ppid: 1 }],
    pidAlive: (pid) => running.has(pid),
  });
  const signalled = [];
  const realKill = process.kill;
  process.kill = (pid, sig) => (pid === 501 || pid === 502 ? (signalled.push(pid), true) : realKill.call(process, pid, sig));
  t.after(() => { process.kill = realKill; });
  const root = fakeChild({ pid: 500 });
  registry.register(root, { kind: "yt-dlp", tree: true });
  await assert.rejects(registry.stopAll({ termGraceMs: 30, killGraceMs: 30 }), (e) => e.code === "CHILD_STOP_FAILED");
  assert.ok(signalled.includes(501) && signalled.includes(502), "descendants were signalled too");
  assert.equal(registry.alive().length, 1, "the root exited, but its grandchild has not");
  running.clear();
  assert.deepEqual(registry.alive(), []);
});

test("a tree helper started while the root runs is waited for after the root exits", async () => {
  const table = [{ pid: 700, ppid: 1 }];
  const running = new Set();
  registry._setSystemForTests({ listProcesses: () => table, pidAlive: (pid) => running.has(pid) });
  const root = fakeChild({ pid: 700 });
  registry.register(root, { kind: "yt-dlp", tree: true });
  assert.equal(registry.alive().length, 1);
  table.push({ pid: 701, ppid: 700 }); // yt-dlp starts FFmpeg
  running.add(701);
  await new Promise((r) => setTimeout(r, 260)); // past TREE_REFRESH_MS
  assert.equal(registry.alive().length, 1, "the refresh sees the new helper");
  root.emit("exit", 0, null);
  assert.equal(registry.alive().length, 1, "the root is gone; its helper is not");
  running.delete(701);
  assert.deepEqual(registry.alive(), []);
});

test("a tree whose descendants cannot be listed is never reported stopped", async () => {
  registry._setSystemForTests({ listProcesses: () => { throw new Error("ps missing"); }, pidAlive: () => false });
  const root = fakeChild({ pid: 600 });
  registry.register(root, { kind: "yt-dlp", tree: true });
  await assert.rejects(registry.stopAll({ termGraceMs: 30, killGraceMs: 30 }), (e) => e.code === "CHILD_STOP_FAILED");
  assert.equal(registry.alive().length, 1, "unknown descendants keep it alive: fail closed");
});

test("a detached process group stays alive until the whole group is gone", { skip: process.platform === "win32" }, async () => {
  const { spawn } = require("node:child_process");
  // The leader exits at once; its detached child keeps the group alive briefly.
  const leader = spawn("/bin/sh", ["-c", "sleep 0.3 & exit 0"], { detached: true, stdio: "ignore" });
  registry.register(leader, { kind: "yt-dlp", group: true });
  await new Promise((r) => leader.once("exit", r));
  assert.equal(registry.alive().length, 1, "the group member is still running");
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(registry.alive().length, 0);
});

test("classify: network programs, third-party callers, ffmpeg, and Loqui's own local tools", () => {
  assert.equal(registry.classify("/Users/x/.cache/loqui/yt-dlp_macos"), "network");
  assert.equal(registry.classify("codex"), "network");
  assert.equal(registry.classify("C:\\tools\\curl.exe"), "network");
  assert.equal(registry.classify("/opt/ffmpeg"), "ffmpeg");
  assert.equal(registry.classify("xclip", "at x (/app/node_modules/@aws-sdk/credential-provider-process/dist/index.js:1:1)"), "thirdParty");
  assert.equal(registry.classify("xclip", "at y (/app/src/helpers/clipboard.js:125:9)"), "osTool");
  assert.equal(registry.classify(process.execPath), "self");
  assert.equal(registry.classify("/usr/local/bin/mystery-helper"), "unclassified");
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-bin-"));
  registry.registerLocalBinaryDir(binDir);
  assert.equal(registry.classify(path.join(binDir, "llama-server")), "bundled");
  assert.equal(registry.kindOf("/x/yt-dlp_linux"), "yt-dlp");
});

test("sealed: only allowlisted programs start, and only with allowed arguments", () => {
  const cp = fakeChildProcess();
  registry.installSpawnGuard({ childProcess: cp });
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-bin-"));
  registry.registerLocalBinaryDir(binDir);
  const llama = path.join(binDir, "llama-server");
  const qdrant = path.join(binDir, "qdrant");
  flags.sealed = true;
  const refused = [
    ["/usr/local/bin/mystery-helper", []],
    ["open", ["https://example.com"]],
    ["sh", ["-c", "curl https://example.com"]],
    ["powershell", ["-NoProfile", "-Command", "Invoke-WebRequest https://example.com"]],
    [llama, ["-m", "model.gguf", "-hf", "org/repo"]],
    [llama, ["-m", "model.gguf", "--host", "0.0.0.0"]],
    [qdrant, ["--config-path", "c.yaml"]],
  ];
  for (const [command, args] of refused) assert.throws(() => cp.spawn(command, args), isSealedModeError, `${command} ${args.join(" ")}`);
  cp.spawn("open", ["-a", "System Settings"]);
  cp.spawnSync("sh", ["-c", "command -v xclip"]);
  cp.spawn(llama, ["-m", "model.gguf", "--host", "127.0.0.1", "--port", "8200"]);
  cp.spawn(qdrant, ["--disable-telemetry", "--config-path", "c.yaml"]);
  assert.deepEqual(cp.calls.map((c) => c[1]), ["open", "sh", llama, qdrant]);
});

test("sealed: network and third-party spawns are refused; local ones run", () => {
  const cp = fakeChildProcess();
  registry.installSpawnGuard({ childProcess: cp });
  flags.sealed = true;
  assert.throws(() => cp.spawn("/x/yt-dlp_macos", ["--update-to", "nightly"]), isSealedModeError);
  assert.throws(() => cp.execFileSync("curl", ["https://example.com"]), isSealedModeError);
  const sdkDir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-guard-"));
  const sdkFile = path.join(sdkDir, "node_modules", "fake-sdk", "index.js");
  fs.mkdirSync(path.dirname(sdkFile), { recursive: true });
  fs.writeFileSync(sdkFile, "module.exports = (cp) => cp.spawn('credential-helper', []);");
  assert.throws(() => require(sdkFile)(cp), isSealedModeError);
  cp.spawnSync("xclip", ["-selection", "clipboard"]);
  assert.deepEqual(cp.calls.map((c) => c[1]), ["xclip"], "only the local tool reached the real API");
});

test("unsealed: network children are registered and stoppable", () => {
  const cp = fakeChildProcess();
  registry.installSpawnGuard({ childProcess: cp });
  cp.spawn("codex", ["app-server", "--stdio"]);
  cp.spawn("/x/yt-dlp_macos", ["-x"], { detached: true });
  assert.deepEqual(registry.alive().map((e) => e.kind).sort(), ["codex", "yt-dlp"]);
});

test("ffmpeg without a protocol whitelist is refused in every mode", () => {
  const cp = fakeChildProcess();
  registry.installSpawnGuard({ childProcess: cp });
  assert.throws(() => cp.spawn("/opt/ffmpeg", ["-i", "in.m3u8", "out.wav"]), /FFMPEG_UNSAFE_INPUT/);
  cp.spawn("/opt/ffmpeg", ["-protocol_whitelist", "file,pipe", "-i", "in.wav", "out.wav"]);
  assert.equal(cp.calls.length, 1);
});

test("utilityProcess.fork is limited to the app's own workers while sealed", () => {
  const forks = [];
  const utilityProcess = { fork: (modulePath) => { forks.push(modulePath); return fakeChild(); } };
  registry.installSpawnGuard({ childProcess: fakeChildProcess(), utilityProcess });
  flags.sealed = true;
  const worker = path.join(__dirname, "../../src/workers/onnxWorker.js");
  utilityProcess.fork(worker);
  assert.throws(() => utilityProcess.fork("/tmp/elsewhere/agent.js"), isSealedModeError);
  assert.deepEqual(forks, [worker]);
});
```

Create `test/helpers/ffmpegContainment.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { installElectronStub } = require("./harness/electronStub");

installElectronStub();
const ffmpeg = require("../../src/helpers/ffmpegUtils");

test("localOnlyInputs adds the whitelist before every -i, once", () => {
  assert.deepEqual(ffmpeg.localOnlyInputs(["-i", "a.wav", "-i", "b.wav", "out.wav"]), [
    "-protocol_whitelist", "file,pipe", "-i", "a.wav", "-protocol_whitelist", "file,pipe", "-i", "b.wav", "out.wav",
  ]);
  const already = ["-protocol_whitelist", "file,pipe", "-i", "a.wav"];
  assert.deepEqual(ffmpeg.localOnlyInputs(already), already);
});

test("a local playlist that points at a server makes FFmpeg fetch nothing", async (t) => {
  const ffmpegPath = typeof ffmpeg.getFFmpegPath === "function" ? ffmpeg.getFFmpegPath() : null;
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) return t.skip("no bundled ffmpeg in this checkout");
  let hits = 0;
  const server = http.createServer((_req, res) => { hits++; res.end(); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-ffmpeg-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const playlist = path.join(dir, "evil.m3u8");
  fs.writeFileSync(playlist, `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:${server.address().port}/seg.ts\n#EXT-X-ENDLIST\n`);
  await assert.rejects(ffmpeg.convertToWav(playlist, path.join(dir, "out.wav")));
  assert.equal(hits, 0, "FFmpeg did not follow the remote reference");
});
```

If `getFFmpegPath` is not exported, export it from `ffmpegUtils.js` (it is defined at `:10`). The skip only applies to checkouts without the bundled binary; CI has it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/helpers/childRegistry.test.js test/helpers/ffmpegContainment.test.js`
Expected: FAIL with `Cannot find module '../../src/helpers/privacy/childRegistry'` and `ffmpeg.localOnlyInputs is not a function`.

- [ ] **Step 3: Implement the registry and guard**

Create `src/helpers/privacy/childRegistry.js`:

```js
const path = require("node:path");
const { syncBuiltinESMExports } = require("node:module");
// Captured before installSpawnGuard wraps the module, so the registry's own
// process listing is never refused or registered.
const { execFileSync: originalExecFileSync } = require("node:child_process");
const gate = require("./egressGate");
const { SealedModeError, isLoopbackHost } = require("./egressPolicy");

// Programs Loqui may start that reach the network themselves (threat model,
// spawn-sites). Main cannot see their traffic, so while sealed they do not run,
// and while unsealed each run is tracked until the OS reports its exit.
const NETWORK_COMMANDS = [/^codex(\.exe)?$/, /^yt-dlp/, /^curl(\.exe)?$/, /^wget(\.exe)?$/, /^ffplay/, /^aws(\.exe)?$/, /^gcloud/, /^ssh(\.exe)?$/, /^git(\.exe)?$/];
const FFMPEG = /^ffmpeg/;
// System tools Loqui's own code runs (the spawn-sites inventory, Task 1). Each
// may carry an argument rule; a tool not listed here is unclassified.
const OS_TOOLS = new Map([
  ...["xsel", "xclip", "wl-copy", "wl-paste", "xdotool", "kdotool", "ydotool", "osascript", "systemctl", "hyprctl", "gsettings",
    "qdbus", "which", "taskkill", "tasklist", "ps", "pidof", "pgrep", "groups", "journalctl", "sleep", "tar", "unzip", "nvidia-smi",
    "nvidia-smi.exe", "taskkill.exe", "tasklist.exe", "tar.exe"].map((name) => [name, null]),
  ["open", (args) => args[0] === "-a" && args.length === 2],
  ["sh", (args) => args[0] === "-c" && /^command -v [A-Za-z0-9._-]+$/.test(String(args[1] ?? ""))],
  ["explorer.exe", (args) => args.length === 1 && /^https?:\/\//i.test(String(args[0]))],
  ["powershell", () => false],
  ["powershell.exe", () => false],
]);
// Launch rules for sidecars among Loqui's own binaries.
const LLAMA_DOWNLOAD_FLAGS = new Set(["-hf", "--hf-repo", "-hfr", "--hf-file", "-hff", "--hf-token", "-hft", "-mu", "--model-url", "-dr", "--docker-repo"]);
const hostArg = (args) => {
  const i = args.indexOf("--host");
  return i === -1 ? null : String(args[i + 1] ?? "");
};
const SIDECAR_RULES = [
  [/^llama-server/, (args) => !args.some((a) => LLAMA_DOWNLOAD_FLAGS.has(a)) && (hostArg(args) === null || isLoopbackHost(hostArg(args)))],
  [/^whisper-server/, (args) => hostArg(args) === null || isLoopbackHost(hostArg(args))],
  [/^qdrant/, (args) => args.includes("--disable-telemetry")],
  [/^sherpa-onnx-/, () => true], // Parakeet and diarization; no network options
];
const localBinaryDirs = new Set([
  path.join(__dirname, "..", "..", "..", "resources") + path.sep,
  ...(process.resourcesPath ? [path.resolve(process.resourcesPath) + path.sep] : []),
]);
function registerLocalBinaryDir(dir) {
  if (dir) localBinaryDirs.add(path.resolve(dir) + path.sep);
}
const WORKERS_DIR = path.join(__dirname, "..", "..", "workers") + path.sep;

let entries = new Set();
let installed = false;

const baseName = (command) => path.basename(String(command ?? "")).toLowerCase().replace(/\\/g, "/").split("/").pop();
function kindOf(command) {
  const base = baseName(command);
  if (/^codex/.test(base)) return "codex";
  if (/^yt-dlp/.test(base)) return "yt-dlp";
  return base;
}
function classify(command, stack = "") {
  const raw = String(command ?? "");
  const base = baseName(raw).split("\\").pop();
  if (NETWORK_COMMANDS.some((re) => re.test(base))) return "network";
  if (FFMPEG.test(base)) return "ffmpeg";
  if (/[\\/]node_modules[\\/]/.test(stack)) return "thirdParty";
  if (raw === process.execPath) return "self";
  // A known sidecar by name, wherever it is installed (a system llama-server
  // that llamaCppInstaller found counts too); it still has to pass its launch rule.
  if (SIDECAR_RULES.some(([re]) => re.test(base))) return "bundled";
  if (path.isAbsolute(raw) && [...localBinaryDirs].some((dir) => path.resolve(raw).startsWith(dir))) return "bundled";
  if (OS_TOOLS.has(base)) return "osTool";
  return "unclassified";
}

// While sealed: may this program start with these arguments? (Unsealed, only
// FFmpeg's input rule applies.)
function allowedWhileSealed(kind, command, args) {
  const base = baseName(command).split("\\").pop();
  if (kind === "self") return true;
  if (kind === "osTool") {
    const rule = OS_TOOLS.get(base);
    return rule === null || rule(args);
  }
  if (kind === "bundled") {
    const sidecar = SIDECAR_RULES.find(([re]) => re.test(base));
    return !sidecar || sidecar[1](args);
  }
  return false; // network, thirdParty, unclassified
}

function defaultGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
const defaultKillGroup = (pid, sig) => process.kill(-pid, sig);
// Process trees: yt-dlp on Windows (no process groups there) and the yt-dlp
// self-update everywhere. Descendants are listed while the root is still
// alive, at stop time; the entry is alive until the root and every listed
// descendant are gone. If the listing fails, the entry never counts as
// stopped: the seal stays unverified rather than guessing (C1).
function defaultListProcesses() {
  const out =
    process.platform === "win32"
      ? originalExecFileSync(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'],
          { encoding: "utf8", timeout: 5000, windowsHide: true }
        )
      : originalExecFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8", timeout: 5000 });
  return out
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([pid, ppid]) => pid > 0 && ppid >= 0)
    .map(([pid, ppid]) => ({ pid, ppid }));
}
function defaultPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
// Every OS-level probe goes through here, so tests with fake pids never signal a real process.
let system = { listProcesses: defaultListProcesses, pidAlive: defaultPidAlive, groupAlive: defaultGroupAlive, killGroup: defaultKillGroup };

function descendantsOf(root) {
  const all = system.listProcesses();
  const found = new Set();
  let frontier = new Set([root]);
  while (frontier.size > 0) {
    const next = new Set();
    for (const p of all) if (frontier.has(p.ppid) && !found.has(p.pid)) next.add(p.pid);
    for (const pid of next) found.add(pid);
    frontier = next;
  }
  return [...found];
}
function snapshotTree(entry) {
  if (!entry.tree || entry.exited || !entry.pid) return;
  try {
    entry.descendants = [...new Set([...(entry.descendants ?? []), ...descendantsOf(entry.pid)])];
  } catch {
    entry.descendants = null; // unknown: never reported stopped
  }
}

function isAlive(entry) {
  if (!entry.exited) return true;
  if (entry.group && process.platform !== "win32" && entry.pid) return system.groupAlive(entry.pid);
  if (entry.tree) return entry.descendants === null || entry.descendants.some((pid) => system.pidAlive(pid));
  return false;
}

// local: a sidecar that serves on-device routes (llama-server, whisper-server,
// Qdrant, sherpa-onnx). Sealing never stops it, and the attestation reports it
// as uninspected instead of claiming to see its traffic (CCR-6).
function register(child, { kind, group = false, tree = false, local = false }) {
  // descendants: [] until a stop lists them (a root that exits on its own has
  // waited for its children, as yt-dlp does for its post-processors).
  const entry = { child, kind, pid: child?.pid, group, tree, local, descendants: [], exited: !child?.pid };
  child?.once?.("exit", () => {
    entry.exited = true;
  });
  // A spawn that failed to start has no pid and never runs.
  child?.once?.("error", () => {
    if (!child.pid) entry.exited = true;
  });
  entries.add(entry);
  return entry;
}

// While a tree's root runs, its descendant list is refreshed on every liveness
// check (the barrier and the 500 ms recheck poll call alive()), at most every
// 250 ms, so a helper started after a stop began is still waited for.
const TREE_REFRESH_MS = 250;
function refreshTree(entry) {
  if (!entry.tree || entry.exited || entry.descendants === null) return;
  const now = Date.now();
  if (entry.listedAt && now - entry.listedAt < TREE_REFRESH_MS) return;
  entry.listedAt = now;
  snapshotTree(entry);
}

// Calls fn({ code, signal, failedToStart }) exactly once, when the child has
// ended: its "exit"; an "error" before any pid (the spawn failed, so no process
// ever ran); or a "close" with no "exit" seen. An "error" after a successful
// start is not an end: the process may still be running (N2).
function onChildEnd(child, fn) {
  let done = false;
  const end = (detail) => {
    if (done) return;
    done = true;
    fn(detail);
  };
  child.once("exit", (code, signal) => end({ code, signal, failedToStart: false }));
  child.once("close", (code, signal) => end({ code, signal, failedToStart: false }));
  child.once("error", () => {
    if (!child.pid) end({ code: null, signal: null, failedToStart: true });
  });
}

function alive(kind) {
  const list = [];
  for (const entry of entries) {
    refreshTree(entry);
    if (!isAlive(entry)) {
      entries.delete(entry);
      continue;
    }
    if (!kind || entry.kind === kind) list.push({ kind: entry.kind, pid: entry.pid, local: entry.local });
  }
  return list;
}

function signal(entry, sig) {
  try {
    if (entry.group && process.platform !== "win32" && entry.pid) system.killGroup(entry.pid, sig);
    else entry.child.kill(sig);
  } catch {
    // Already gone, or the kill failed (EPERM): isAlive() decides either way.
  }
  // On Windows any signal terminates the process; on POSIX it is delivered.
  for (const pid of entry.tree ? entry.descendants ?? [] : []) {
    try {
      process.kill(pid, sig);
    } catch {
      // Already gone.
    }
  }
}
const waitUntil = async (predicate, ms) => {
  const deadline = Date.now() + ms;
  while (!predicate() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  return predicate();
};

async function stopAll({ kinds, termGraceMs = 1500, killGraceMs = 1500 } = {}) {
  const targets = [...entries].filter((e) => !e.local && isAlive(e) && (!kinds || kinds.includes(e.kind)));
  if (targets.length === 0) return;
  for (const t of targets) snapshotTree(t); // while the roots are still alive
  for (const t of targets) signal(t, "SIGTERM");
  if (await waitUntil(() => targets.every((t) => !isAlive(t)), termGraceMs)) return;
  for (const t of targets) snapshotTree(t); // children started during the grace period
  for (const t of targets) if (isAlive(t)) signal(t, "SIGKILL");
  if (await waitUntil(() => targets.every((t) => !isAlive(t)), killGraceMs)) return;
  const failed = targets.filter(isAlive).map((t) => t.kind);
  throw Object.assign(new Error(`Child processes did not exit: ${failed.join(", ")}`), { code: "CHILD_STOP_FAILED", kinds: failed });
}

function hasLocalOnlyInputs(args) {
  return args.every((arg, i) => arg !== "-i" || (args[i - 2] === "-protocol_whitelist" && /^[a-z,]+$/.test(String(args[i - 1])) && !/(http|tcp|udp|rtmp|tls|crypto)/.test(String(args[i - 1]))));
}

function check(command, args, stack) {
  const kind = classify(command, stack);
  if (kind === "ffmpeg" && !hasLocalOnlyInputs(Array.isArray(args) ? args.map(String) : []))
    throw Object.assign(new Error("FFMPEG_UNSAFE_INPUT: ffmpeg inputs must be restricted to local protocols"), { code: "FFMPEG_UNSAFE_INPUT" });
  if (kind !== "ffmpeg" && gate.isSealed() && !allowedWhileSealed(kind, command, Array.isArray(args) ? args.map(String) : []))
    throw gate.recordBackstopBlock({ host: kindOf(command).replace(/[^a-z0-9._-]/g, "") || "unknown" });
  return kind;
}

// exec/execSync take a command line; the program is its first token.
const programOf = (name, args) => (name === "exec" || name === "execSync" ? String(args[0]).trim().split(/\s+/)[0] : name === "fork" ? process.execPath : args[0]);

function installSpawnGuard({ childProcess = require("node:child_process"), utilityProcess = null } = {}) {
  if (installed && childProcess === require("node:child_process")) return;
  for (const name of ["spawn", "execFile", "exec", "fork", "spawnSync", "execFileSync", "execSync"]) {
    const original = childProcess[name];
    if (typeof original !== "function") continue;
    childProcess[name] = function guarded(...args) {
      const command = programOf(name, args);
      const kind = check(command, Array.isArray(args[1]) ? args[1] : [], new Error().stack);
      const result = original.apply(this, args);
      if (!name.endsWith("Sync")) {
        const options = args.find((a, i) => i > 0 && a && typeof a === "object" && !Array.isArray(a)) ?? {};
        if (kind === "network" || kind === "thirdParty" || kind === "unclassified") {
          register(result, { kind: kindOf(command), group: options.detached === true });
        } else if (kind === "bundled" && SIDECAR_RULES.some(([re]) => re.test(baseName(command)))) {
          register(result, { kind: kindOf(command).replace(/[-_](darwin|linux|win32).*$/, "").replace(/\.exe$/, ""), group: options.detached === true, local: true });
        }
      }
      return result;
    };
  }
  if (utilityProcess && typeof utilityProcess.fork === "function") {
    const originalFork = utilityProcess.fork;
    utilityProcess.fork = function guardedUtilityFork(modulePath, ...rest) {
      if (gate.isSealed() && !path.resolve(String(modulePath)).startsWith(WORKERS_DIR))
        throw gate.recordBackstopBlock({ host: "utility-process" });
      return originalFork.call(this, modulePath, ...rest);
    };
  }
  if (childProcess === require("node:child_process")) {
    installed = true;
    syncBuiltinESMExports();
  }
}

function _resetForTests() {
  entries = new Set();
  system = { listProcesses: defaultListProcesses, pidAlive: defaultPidAlive, groupAlive: defaultGroupAlive, killGroup: defaultKillGroup };
}
function _setSystemForTests(overrides) {
  system = { ...system, ...overrides };
}

module.exports = { installSpawnGuard, register, alive, stopAll, onChildEnd, classify, kindOf, registerLocalBinaryDir, _resetForTests, _setSystemForTests, SealedModeError };
```

`recordBackstopBlock` gives the ledger a `blocked` row for the refused program. Its host field is the program's kind (`yt-dlp`, `curl`), which passes the bare-host check. Refusals happen synchronously, as Node's own spawn argument errors do. Every managed caller (`codexAppServer.start`, `maybeUpdateYtDlp`, `runYtDlp`) already wraps its spawn in `try`/`catch`, or runs behind a gate that refuses first (Tasks 8 and 10).

- [ ] **Step 3a: Register Loqui's binary directories, and lock the ONNX worker**

1. In `src/helpers/gpuBinaryManager.js`, at the end of the constructor (after `this.binDir` is set), add `require("./privacy/childRegistry").registerLocalBinaryDir(this.binDir);`. In `src/helpers/llamaCppInstaller.js`, at the end of `ensureInitialized()` (after `this.installDir` is set), add the same call with `this.installDir`. Bundled binaries under `resources/` and `process.resourcesPath` are registered by default.
2. A utility process has its own Node runtime, so main's hooks do not apply inside it. Make these the first two statements of `src/workers/onnxWorker.js`, before `const fs = require("fs");`:

   ```js
   // Sealed mode (Plan 07): this worker never needs the network. The Node
   // backstop, with the seal forced on, refuses every non-loopback socket, DNS
   // query and UDP send inside this process, whatever main's seal state is.
   require("../helpers/privacy/egressGate").configureEgress({ isSealed: () => true });
   require("../helpers/privacy/egressBackstop").installNodeBackstop();
   ```

3. Create `test/helpers/workerEgressLock.test.js`:

   ```js
   const assert = require("node:assert/strict");
   const { fork } = require("node:child_process");
   const fs = require("node:fs");
   const path = require("node:path");
   const test = require("node:test");

   const repoRoot = path.join(__dirname, "../..");

   test("every worker locks its network before anything else runs", () => {
     for (const name of fs.readdirSync(path.join(repoRoot, "src/workers")).filter((n) => /\.(c?js|mjs)$/.test(n))) {
       const code = fs.readFileSync(path.join(repoRoot, "src/workers", name), "utf8").replace(/^\s*\/\/.*$/gm, "").trimStart();
       assert.match(code, /^require\("\.\.\/helpers\/privacy\/egressGate"\)\.configureEgress\(\{ isSealed: \(\) => true \}\);\s*require\("\.\.\/helpers\/privacy\/egressBackstop"\)\.installNodeBackstop\(\);/, name);
     }
   });

   test("the lock refuses the network inside a separate Node runtime, and keeps loopback", async () => {
     // A child process stands in for the utility process: same lock, its own runtime.
     const probe = `
       require(${JSON.stringify(path.join(repoRoot, "src/helpers/privacy/egressGate"))}).configureEgress({ isSealed: () => true });
       require(${JSON.stringify(path.join(repoRoot, "src/helpers/privacy/egressBackstop"))}).installNodeBackstop();
       const net = require("node:net");
       const dns = require("node:dns");
       const server = net.createServer((s) => s.end()).listen(0, "127.0.0.1", async () => {
         const results = {};
         results.dns = await dns.promises.resolveTxt("example.invalid").then(() => "reached", (e) => e.code);
         results.fetch = await fetch("https://example.invalid/").then(() => "reached", (e) => (e.cause?.code ?? e.code));
         results.loopback = await new Promise((r) => net.connect(server.address().port, "127.0.0.1", () => r("ok")).on("error", (e) => r(e.code)));
         process.send(results);
         server.close();
       });`;
     const file = path.join(require("node:os").tmpdir(), `loqui-worker-lock-${process.pid}.js`);
     fs.writeFileSync(file, probe);
     const child = fork(file, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
     const results = await new Promise((resolve) => child.once("message", resolve));
     child.kill();
     fs.rmSync(file, { force: true });
     assert.deepEqual(results, { dns: "SEALED_MODE", fetch: "SEALED_MODE", loopback: "ok" });
   });
   ```

   `example.invalid` never resolves, and the lock refuses it before DNS, so the test sends nothing off this computer either way.

- [ ] **Step 4: Restrict FFmpeg to local inputs**

In `src/helpers/ffmpegUtils.js`, add and export:

```js
// Inputs are files Loqui already has. FFmpeg can follow remote references
// inside a media file or playlist, so only local protocols are allowed. The
// Sealed mode spawn guard refuses any ffmpeg call without this (childRegistry.js).
function localOnlyInputs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-i" && out[out.length - 2] !== "-protocol_whitelist") out.push("-protocol_whitelist", "file,pipe");
    out.push(args[i]);
  }
  return out;
}
```

Wrap the argument list at each of the three spawn sites:
- `spawn(ffmpegPath, localOnlyInputs([...args, "-y", outputPath]), …)`;
- `spawn(ffmpegPath, localOnlyInputs(args), …)` in `splitAudioFile`;
- `spawn(ffmpegPath, localOnlyInputs(args), …)` in `mergeAudioSegments`.

Also export `getFFmpegPath` if it is not already exported.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- test/helpers/childRegistry.test.js test/helpers/ffmpegContainment.test.js test/helpers/ffmpegUtils.test.js`
Expected: PASS. The last file is the existing FFmpeg suite, if present (`ls test/helpers | grep -i ffmpeg`).

- [ ] **Step 6: Commit**

```bash
git add src/helpers/privacy/childRegistry.js src/helpers/ffmpegUtils.js test/helpers/childRegistry.test.js test/helpers/ffmpegContainment.test.js
git commit -m "feat(privacy): track child processes until exit, guard spawns, keep FFmpeg local"
```

---

### Task 7: Boot order, the sealing barrier, attestation, trusted IPC, preload and types

**Files:**
- Create: `src/helpers/privacy/privacyBoot.js`, `src/helpers/privacy/privacyIPC.js`, `src/helpers/privacy/trustedSender.js` and `src/types/privacy.ts`
- Modify:
  - `main.js`. Boot directly after the `.env` load block at `main.js:91-95`. Attach the database in `initializeCoreManagers()` after `databaseManager = new DatabaseManager();` (`main.js:308`). Wire the transition, attestor and IPC after `updateManager = …attachUpdateIPC({…})` (`main.js:460-470`).
  - `preload.js`. Add a `privacy` namespace after `personalInference` (`preload.js:78-99`).
  - `src/types/electron.ts:676-677`. Add `privacy: import("./privacy").PrivacyAPI;`.
  - `src/helpers/ipcHandlers.js:826-844` and `:1382-1394`. Prune the ledger in the retention sweep, and set persistence on sync.
  - `src/locales/*/translation.json`. Add the main-process confirmation strings (`sealedMode.confirmUnseal.*`, `sealedMode.confirmClear.*`); `i18nMain` loads these files (`src/helpers/i18nMain.js:3-13`).
- Test: `test/helpers/privacyIPC.test.js`, `test/helpers/sealTransition.test.js`, `test/helpers/trustedSender.test.js`, `test/helpers/privacyBootOrder.test.js`, and new cases appended to `test/helpers/preloadAuthBridge.test.js`.

**Interfaces:**
- Consumes:
  - `SealedState` (Task 3), `FlightRecorder` (Task 4), `egressGate` (Task 5) and `egressBackstop` (Task 6);
  - `inference.stopCodex(): Promise<void>` and `inference.codexRunning(): boolean` (Task 8);
  - `updateManager.pauseForSeal()` and `updateManager.resumeAfterSeal()` (Task 10);
  - `childRegistry` (Task 6a): `alive()`, `stopAll()` and `installSpawnGuard()`;
  - the calendar managers' existing `stop()`/`start()`.
- Produces:
  - `bootEgressGuards({ app, profile, getDefaultSession, utilityProcess?, now? }): { state, recorder, bootedAt }`. It installs the Node backstop, the spawn guard (Task 6a), the webContents guard and the session watcher.
  - `createSealTransition({ state, bootedAt, getUpdateManager, getInference, getCalendars, children, sleep, now?, waitMs?, onStopping? })`. It returns `{ apply(sealed): Promise<void>, recheck(): void, snapshot(): TransitionSnapshot, on("change", fn) }`.
    - `TransitionSnapshot` is `{ phase: "open"|"sealing"|"sealed", effectiveSince: number|null, failures: string[], notes: string[] }`.
    - `failures` are *unresolved* problems, and while any remain the seal is unverified.
    - `notes` are problems that resolved before the seal became effective; they are kept for display.
  - `createAttestor({ state, transition, getInference, children }): () => Attestation`.
  - `createConfirmations({ dialog, BrowserWindow, t }): { unseal(event): Promise<boolean>, clear(count, event): Promise<boolean> }`. These are native dialogs that main shows, which a renderer cannot click through.
  - `createTrustedSender({ getWindows, appUrlPrefixes }): (event) => boolean` and `appUrlPrefixes(): string[]`.
  - `attachPrivacyIPC({ ipcMain, BrowserWindow, state, recorder, attest, transition, isTrustedSender, confirm, now? }): { broadcastAttestation(): void, dispose(): void }`.
  - Channels:
    - `privacy:get-sealed` and `privacy:attestation`;
    - `privacy:set-sealed`, which is trusted, and confirmed by main before an unseal;
    - `privacy:egress-list` and `privacy:egress-summary`;
    - `privacy:egress-clear`, which is trusted and confirmed by main;
    - `privacy:egress-export`, which is trusted.
  - Broadcasts:
    - `privacy:sealed-changed` (boolean), sent after the transition finishes;
    - `privacy:attestation` (`Attestation`), sent on every phase change and after remote tickets settle;
    - `privacy:egress-event` (`EgressNotice`);
    - `privacy:egress-cleared`.
  - `src/types/privacy.ts` (TypeScript):

  ```ts
  export type EgressTask =
    | "dictationStt" | "noteRecordingStt" | "uploadStt" | "dictationCleanup" | "voiceAssistant"
    | "assistantVision" | "translation" | "noteFormatting" | "chat" | "speakerId" | "semanticSearch"
    | "providerCheck" | "modelDownload" | "runtimeDownload" | "urlImport" | "appUpdate" | "codex"
    | "calendar" | "unattributed";
  export type EgressOutcome = "ok" | "error" | "blocked" | "cancelled";
  export type EgressPayload = "audio" | "text" | "image" | "metadata";
  export interface EgressEvent {
    id: number; ts: number; endedAt: number | null; task: EgressTask;
    host: string; hosts: string[];     // host = hosts[0]; the trail includes redirects (Task 4)
    kind: "request" | "stream" | "connection" | "session" | "operation"; operationId: number | null;
    bytesOut: number | null; bytesIn: number | null; outcome: EgressOutcome;
    status: number | null; errorClass: string | null; model: string | null;  // errorClass: a category (Task 4 ERROR_CLASSES); model: an identifier or null
    attributed: boolean; opaque: boolean;
  }
  export interface EgressSummary {
    left: number; observed: number; connections: number;  // left = observed + connections + opaqueSessions; operations never count
    blocked: number; unattributed: number; unattributedHosts: string[];
    bytesOut: number; bytesIn: number; unknownBytes: number; opaqueSessions: number;
  }
  export type EgressNotice =
    | { phase: "dispatched" | "delivered" | "undelivered"; ticketId: number; attemptId: string | null; task: EgressTask;
        targetId: string;              // provider id, or "host:<host>" for custom/LAN endpoints (Plan 04 encoding)
        host: string; payload: EgressPayload; correlationId: string | null; ts: number }
    | { phase: "recorded"; event: EgressEvent };
  export interface Attestation {
    sealed: boolean;
    sealedSince: number | null;        // when the switch was turned on
    effectiveSince: number | null;     // when main verified everything had stopped; null until then
    phase: "open" | "sealing" | "sealed";
    failures: string[];                // unresolved: "codexStop", "childStop", "timeout:<what is still running>"
    notes: string[];                   // resolved before effectiveSince, shown for honesty
    loadError: "corrupt" | "unreadable" | null; saveError: string | null;
    guards: { node: boolean; dns: boolean; dgram: boolean; http: boolean; webContents: boolean;
              sessions: number; envProxy: boolean; openRemoteSockets: number; chromiumInFlightRemote: number; pendingDns: number };
    networkChildren: string[]; uninspectedChildren: string[]; activeRemote: number;
    blockedSinceSealed: number; recordFailures: number;
    version: number; at: number;
    nothingLeaves: boolean;
  }
  export interface PrivacyAPI {
    getSealed(): Promise<boolean>;
    setSealed(sealed: boolean): Promise<Attestation & { declined?: boolean }>;
    getAttestation(): Promise<Attestation>;
    onSealedChange(callback: (sealed: boolean) => void): () => void;
    onAttestation(callback: (attestation: Attestation) => void): () => void;
    listEgress(options?: { since?: number; limit?: number }): Promise<EgressEvent[]>;
    egressSummary(options?: { since?: number }): Promise<EgressSummary>;
    clearEgress(): Promise<boolean>;           // false when the user declined main's confirmation
    exportEgressCsv(): Promise<{ saved: boolean }>;
    onEgress(callback: (notice: EgressNotice) => void): () => void;
    onEgressCleared(callback: () => void): () => void;
  }
  ```

`nothingLeaves` is true only when *all* of these hold:
- `sealed` is true and `phase` is `"sealed"`, with an `effectiveSince` set;
- every guard is installed: `node`, `dns`, `dgram`, `http` and `webContents`, plus at least one session;
- `envProxy` is false;
- there are no open remote sockets, no Chromium remote requests in flight and no DNS lookups pending;
- `failures` is empty: a failed stop, a child that survived `SIGKILL`, or a timeout never yields a verified seal, and evidence is never cleared to make a check pass;
- no network-capable child is alive;
- no remote ticket is active.

The panel's historical claim is phrased from `effectiveSince` (the verified moment), never from `sealedSince` (the moment you flipped the switch).

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/sealTransition.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const gate = require("../../src/helpers/privacy/egressGate");
const backstop = require("../../src/helpers/privacy/egressBackstop");
const { SealedState } = require("../../src/helpers/privacy/sealedState");
const { createSealTransition, createAttestor } = require("../../src/helpers/privacy/privacyBoot");

backstop.installNodeBackstop();
backstop.watchSession({ webRequest: new Proxy({}, { get: () => () => {} }) });
backstop.installWebContentsGuard({ on() {} });

function harness(t, { sealedAtBoot = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-transition-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (sealedAtBoot) fs.writeFileSync(path.join(dir, "privacy.json"), JSON.stringify({ sealed: true, sealedSince: 1 }));
  const state = new SealedState({ profile: dir });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => state.isSealed() });
  t.after(() => gate._resetForTests());
  let clock = 1000;
  const log = [];
  const codex = { alive: false, stopCodex: async () => { log.push("codex.stop"); codex.alive = false; }, codexRunning: () => codex.alive };
  // A fake of childRegistry (Task 6a): children are alive until "exited".
  const children = {
    list: [],
    alive() { return this.list.filter((c) => !c.exited).map((c) => ({ kind: c.kind })); },
    async stopAll() { log.push("children.stop"); for (const c of this.list) if (!c.stubborn) c.exited = true; if (this.list.some((c) => !c.exited)) throw Object.assign(new Error("x"), { code: "CHILD_STOP_FAILED" }); },
  };
  const calendar = { stop: () => log.push("calendar.stop"), start: () => log.push("calendar.start") };
  const transition = createSealTransition({
    state, bootedAt: 500,
    getUpdateManager: () => ({ pauseForSeal: () => log.push("updates.pause"), resumeAfterSeal: () => log.push("updates.resume") }),
    getInference: () => codex, getCalendars: () => [calendar, null], children,
    sleep: () => new Promise((r) => setImmediate(r)), now: () => (clock += 100), waitMs: 1000,
  });
  const attest = createAttestor({ state, transition, getInference: () => codex, children });
  return { state, transition, attest, log, codex, children };
}

test("sealed at boot is effective from boot, with everything verified", (t) => {
  const h = harness(t, { sealedAtBoot: true });
  assert.deepEqual(h.transition.snapshot(), { phase: "sealed", effectiveSince: 500, failures: [], notes: [] });
  assert.equal(h.attest().nothingLeaves, true);
});

test("sealing stops everything, waits for children, then becomes effective", async (t) => {
  const h = harness(t);
  h.codex.alive = true;
  h.children.list.push({ kind: "yt-dlp", exited: false });
  const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com" });
  ticket.signal.addEventListener("abort", () => ticket.settle({ outcome: "cancelled" }));
  const phases = [];
  h.transition.on("change", (s) => phases.push(s.phase));
  h.state.set(true);
  await h.transition.apply(true);
  assert.equal(ticket.signal.aborted, true);
  assert.deepEqual(h.log, ["updates.pause", "calendar.stop", "codex.stop", "children.stop"]);
  assert.deepEqual(phases, ["sealing", "sealed"]);
  const snapshot = h.transition.snapshot();
  assert.equal(snapshot.phase, "sealed");
  assert.ok(snapshot.effectiveSince > 1000, "effective after shutdown, not when the switch flipped");
  assert.equal(h.attest().nothingLeaves, true);
});

test("a child that will not exit keeps the seal unverified until it really exits", async (t) => {
  const h = harness(t);
  const stubborn = { kind: "yt-dlp", exited: false, stubborn: true };
  h.children.list.push(stubborn);
  h.state.set(true);
  await h.transition.apply(true);
  const snapshot = h.transition.snapshot();
  assert.equal(snapshot.phase, "sealing");
  assert.equal(snapshot.effectiveSince, null);
  assert.ok(snapshot.failures.includes("childStop"));
  assert.ok(snapshot.failures.includes("timeout:children"));
  const a = h.attest();
  assert.equal(a.nothingLeaves, false);
  assert.deepEqual(a.networkChildren, ["yt-dlp"]);
  // A recheck while it is still alive changes nothing.
  h.transition.recheck();
  assert.equal(h.transition.snapshot().phase, "sealing");
  // Once the OS reports its exit, a recheck verifies the seal and keeps a note.
  stubborn.exited = true;
  h.transition.recheck();
  assert.equal(h.transition.snapshot().phase, "sealed");
  assert.deepEqual(h.transition.snapshot().failures, []);
  assert.ok(h.transition.snapshot().notes.includes("childStop"));
  assert.equal(h.attest().nothingLeaves, true);
});

test("an un-ticketed Chromium request in flight keeps it sealing; nothing is reset or cleared", async (t) => {
  const h = harness(t);
  const session = { listeners: {}, closed: 0, async closeAllConnections() { this.closed++; } };
  session.webRequest = new Proxy({}, { get: (_t, name) => (fn) => { session.listeners[name] = fn; } });
  backstop.watchSession(session);
  await new Promise((r) => session.listeners.onBeforeRequest({ id: 900, url: "https://images.example.com/a.png", webContentsId: 1 }, r));
  h.state.set(true);
  await h.transition.apply(true);
  assert.equal(h.transition.snapshot().phase, "sealing");
  assert.ok(h.transition.snapshot().failures.includes("timeout:chromium"));
  assert.equal(session.closed, 0, "no connection reset: local work in the same session survives");
  assert.equal(h.attest().nothingLeaves, false);
  session.listeners.onCompleted({ id: 900, statusCode: 200 });
  h.transition.recheck();
  assert.equal(h.transition.snapshot().phase, "sealed");
});

test("mid-transition attestations are never verified", async (t) => {
  const h = harness(t);
  let during = null;
  h.codex.alive = true;
  h.codex.stopCodex = async () => { during = h.attest(); h.codex.alive = false; };
  h.state.set(true);
  await h.transition.apply(true);
  assert.equal(during.phase, "sealing");
  assert.equal(during.nothingLeaves, false);
});

test("a quick seal, unseal, seal ends sealed and verified, in order", async (t) => {
  const h = harness(t);
  h.state.set(true);
  const first = h.transition.apply(true);
  h.state.set(false);
  const second = h.transition.apply(false);
  h.state.set(true);
  const third = h.transition.apply(true);
  await Promise.all([first, second, third]);
  assert.equal(h.transition.snapshot().phase, "sealed");
  assert.equal(h.attest().nothingLeaves, true);
});

test("unsealing restarts calendars and republishes update status", async (t) => {
  const h = harness(t, { sealedAtBoot: true });
  h.state.set(false);
  await h.transition.apply(false);
  assert.deepEqual(h.transition.snapshot(), { phase: "open", effectiveSince: null, failures: [], notes: [] });
  assert.deepEqual(h.log, ["calendar.start", "updates.resume"]);
  assert.equal(h.attest().nothingLeaves, false, "unsealed never attests");
});

test("an env proxy makes the attestation unverified", (t) => {
  const h = harness(t, { sealedAtBoot: true });
  const before = process.env.NODE_USE_ENV_PROXY;
  t.after(() => { if (before === undefined) delete process.env.NODE_USE_ENV_PROXY; else process.env.NODE_USE_ENV_PROXY = before; });
  process.env.NODE_USE_ENV_PROXY = "1";
  assert.equal(h.attest().nothingLeaves, false);
});

test("attestations are versioned and timestamped", (t) => {
  const h = harness(t, { sealedAtBoot: true });
  const first = h.attest();
  const second = h.attest();
  assert.ok(second.version > first.version);
  assert.equal(typeof second.at, "number");
});
```

Create `test/helpers/trustedSender.test.js`. It covers both real `DevServerManager` contracts: production returns a file path; development returns `null` from `getAppFilePath` and an `http://localhost:<port>` URL from `getAppUrl` (`devServerManager.js:59`, `:72-86`).

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { createTrustedSender } = require("../../src/helpers/privacy/trustedSender");

const prefixes = () => ["file:///Applications/Loqui.app/Contents/Resources/app.asar/src/dist/"];
function windowWith(url) {
  const mainFrame = { url };
  const webContents = { mainFrame };
  return { webContents, isDestroyed: () => false };
}

test("only the main frame of a known window showing the app's own page is trusted", () => {
  const settings = windowWith("file:///Applications/Loqui.app/Contents/Resources/app.asar/src/dist/index.html?panel=true");
  const isTrusted = createTrustedSender({ getWindows: () => [settings, null], appUrlPrefixes: prefixes });
  assert.equal(isTrusted({ sender: settings.webContents, senderFrame: settings.webContents.mainFrame }), true);
  // A child frame inside the same window.
  assert.equal(isTrusted({ sender: settings.webContents, senderFrame: { url: settings.webContents.mainFrame.url } }), false);
  // The main frame navigated somewhere else.
  const hijacked = windowWith("https://evil.example/");
  const isTrusted2 = createTrustedSender({ getWindows: () => [hijacked], appUrlPrefixes: prefixes });
  assert.equal(isTrusted2({ sender: hijacked.webContents, senderFrame: hijacked.webContents.mainFrame }), false);
  // An unknown webContents.
  const other = windowWith(settings.webContents.mainFrame.url);
  assert.equal(isTrusted({ sender: other.webContents, senderFrame: other.webContents.mainFrame }), false);
  assert.equal(isTrusted({}), false);
});

test("appUrlPrefixes follows the real DevServerManager contracts in both modes", () => {
  const { appUrlPrefixes } = require("../../src/helpers/privacy/trustedSender");
  const prod = { getAppFilePath: () => ({ path: "/Applications/Loqui.app/Contents/Resources/app.asar/src/dist/index.html", query: { panel: "true" } }), getAppUrl: () => null };
  assert.deepEqual(appUrlPrefixes({ DevServerManager: prod, env: {} }), ["file:///Applications/Loqui.app/Contents/Resources/app.asar/src/dist/"]);
  const dev = { getAppFilePath: () => null, getAppUrl: () => "http://localhost:5174/?panel=true" };
  assert.deepEqual(appUrlPrefixes({ DevServerManager: dev, env: { NODE_ENV: "development" } }), ["http://localhost:5174/"]);
  // A development page is trusted only on the dev server's own origin.
  const page = windowWith("http://localhost:5174/?panel=true");
  const isTrusted = createTrustedSender({ getWindows: () => [page], appUrlPrefixes: () => appUrlPrefixes({ DevServerManager: dev, env: { NODE_ENV: "development" } }) });
  assert.equal(isTrusted({ sender: page.webContents, senderFrame: page.webContents.mainFrame }), true);
});
```

Create `test/helpers/privacyIPC.test.js`:

```js
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const gate = require("../../src/helpers/privacy/egressGate");
const { SealedState } = require("../../src/helpers/privacy/sealedState");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { attachPrivacyIPC } = require("../../src/helpers/privacy/privacyIPC");
const { createConfirmations } = require("../../src/helpers/privacy/privacyBoot");

function harness(t, { approveUnseal = true, approveClear = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-privacy-ipc-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = new SealedState({ profile: dir });
  const recorder = new FlightRecorder({ now: () => 10 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => state.isSealed(), recorder, now: () => 10 });
  t.after(() => gate._resetForTests());
  const handlers = new Map();
  const sent = [];
  const makeWindow = () => {
    const webContents = { send: (c, p) => sent.push([c, p]), mainFrame: {} };
    return { webContents, isDestroyed: () => false };
  };
  const settings = makeWindow();
  const pill = makeWindow();
  const transition = Object.assign(new EventEmitter(), {
    applied: [],
    async apply(sealed) { this.applied.push(sealed); this.emit("change", {}); },
    recheck() {},
    snapshot: () => ({ phase: "open", effectiveSince: null, failures: [] }),
  });
  const confirms = [];
  const ipc = attachPrivacyIPC({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn), removeHandler: (c) => handlers.delete(c) },
    BrowserWindow: { getAllWindows: () => [settings, pill] },
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: path.join(dir, "out.csv") }) },
    state, recorder, transition,
    attest: () => ({ sealed: state.isSealed() }),
    isTrustedSender: (event) => event.sender === settings.webContents,
    confirm: {
      unseal: async () => { confirms.push("unseal"); return approveUnseal; },
      clear: async (count) => { confirms.push(`clear:${count}`); return approveClear; },
    },
  });
  t.after(() => ipc.dispose());
  const invoke = (channel, win, ...args) =>
    handlers.get(channel)({ sender: win?.webContents ?? {}, senderFrame: win?.webContents.mainFrame }, ...args);
  return { sent, settings, pill, transition, invoke, state, recorder, dir, confirms };
}

test("sealing needs no confirmation; the broadcast follows the finished transition", async (t) => {
  const h = harness(t);
  assert.equal(await h.invoke("privacy:get-sealed", h.pill), false);
  assert.deepEqual(await h.invoke("privacy:set-sealed", h.settings, true), { sealed: true });
  assert.deepEqual(h.transition.applied, [true]);
  assert.deepEqual(h.confirms, []);
  const order = h.sent.map(([c]) => c).filter((c) => c !== "privacy:egress-event");
  assert.ok(order.indexOf("privacy:attestation") < order.indexOf("privacy:sealed-changed"));
});

test("unsealing asks main's own dialog first, and a 'no' keeps the seal", async (t) => {
  const h = harness(t, { approveUnseal: false });
  await h.invoke("privacy:set-sealed", h.settings, true);
  const result = await h.invoke("privacy:set-sealed", h.settings, false);
  assert.deepEqual(h.confirms, ["unseal"]);
  assert.equal(result.declined, true);
  assert.equal(h.state.isSealed(), true);
  assert.deepEqual(h.transition.applied, [true]);
});

test("set-sealed rejects untrusted senders and non-booleans", async (t) => {
  const h = harness(t);
  await assert.rejects(async () => h.invoke("privacy:set-sealed", h.pill, false), /cannot change/);
  await assert.rejects(async () => h.invoke("privacy:set-sealed", null, true), /Unknown application window/);
  await assert.rejects(async () => h.invoke("privacy:set-sealed", h.settings, "false"), TypeError);
  assert.equal(h.state.isSealed(), false);
});

test("ledger list, summary, export, and a main-confirmed clear", async (t) => {
  const h = harness(t);
  h.recorder.record({ task: "chat", host: "api.groq.com", outcome: "ok", ts: Date.now() });
  assert.equal((await h.invoke("privacy:egress-list", h.pill, {})).length, 1);
  assert.equal((await h.invoke("privacy:egress-summary", h.pill)).left, 1);
  assert.deepEqual(await h.invoke("privacy:egress-export", h.settings), { saved: true });
  assert.match(fs.readFileSync(path.join(h.dir, "out.csv"), "utf8"), /api\.groq\.com/);
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(h.dir, "out.csv")).mode & 0o777, 0o600);
  await assert.rejects(async () => h.invoke("privacy:egress-clear", h.pill), /cannot change/);
  assert.equal(await h.invoke("privacy:egress-clear", h.settings), true);
  assert.deepEqual(h.confirms, ["clear:1"]);
  assert.equal((await h.invoke("privacy:egress-list", h.pill, { since: 0 })).length, 0);
});

test("a declined clear deletes nothing", async (t) => {
  const h = harness(t, { approveClear: false });
  h.recorder.record({ task: "chat", host: "api.groq.com", outcome: "ok", ts: Date.now() });
  assert.equal(await h.invoke("privacy:egress-clear", h.settings), false);
  assert.equal((await h.invoke("privacy:egress-list", h.pill, { since: 0 })).length, 1);
});

test("dispatch notices and recorded events are broadcast; settled tickets refresh the attestation", async (t) => {
  const h = harness(t);
  const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com", payload: "text" });
  ticket.markDispatched();
  ticket.settle({ outcome: "ok" });
  await new Promise((r) => setTimeout(r, 80));
  const phases = h.sent.filter(([c]) => c === "privacy:egress-event").map(([, n]) => n.phase);
  assert.deepEqual(phases, ["dispatched", "dispatched", "recorded", "recorded"]);
  assert.ok(h.sent.some(([c]) => c === "privacy:attestation"));
});

test("main's confirmation dialogs default to the safe button", async () => {
  const shown = [];
  const confirm = createConfirmations({
    dialog: { showMessageBox: async (_win, options) => { shown.push(options); return { response: 0 }; } },
    BrowserWindow: { fromWebContents: () => ({}) },
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
  });
  assert.equal(await confirm.unseal({ sender: {} }), false);
  assert.equal(await confirm.clear(4, { sender: {} }), false);
  for (const options of shown) {
    assert.equal(options.defaultId, 0);
    assert.equal(options.cancelId, 0);
  }
  assert.match(shown[1].detail, /"count":4/);
});
```

Create `test/helpers/privacyBootOrder.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const main = fs.readFileSync(path.join(__dirname, "../../main.js"), "utf8");

test("main boots the egress guards before any helper is required", () => {
  const boot = main.indexOf("bootEgressGuards(");
  assert.ok(boot > 0, "bootEgressGuards is called");
  for (const helper of ['require("./src/helpers/environment")', 'require("./src/helpers/ipcHandlers")', 'require("./src/helpers/database")']) {
    assert.ok(main.indexOf(helper) > boot, `${helper} comes after the boot`);
  }
  assert.ok(main.indexOf("bootEgressGuards(") > main.indexOf('app.setPath(\n  "userData"'), "profile path is set first");
});

test("main attaches the ledger database, the transition and the privacy IPC", () => {
  assert.match(main, /privacy\.recorder\.attachDatabase\(databaseManager\.db\)/);
  assert.match(main, /createSealTransition\(\{/);
  assert.match(main, /attachPrivacyIPC\(\{/);
  assert.match(main, /createTrustedSender\(\{/);
});
```

Append to `test/helpers/preloadAuthBridge.test.js`:

```js
test("privacy bridge exposes the Sealed mode contract", async () => {
  const { api, invocations, listeners } = loadPreloadApi();
  await api.privacy.getSealed();
  await api.privacy.setSealed(true);
  await api.privacy.getAttestation();
  await api.privacy.listEgress({ since: 5 });
  await api.privacy.egressSummary({ since: 5 });
  await api.privacy.clearEgress();
  await api.privacy.exportEgressCsv();
  assert.deepEqual(invocations, [
    ["privacy:get-sealed"],
    ["privacy:set-sealed", true],
    ["privacy:attestation"],
    ["privacy:egress-list", { since: 5 }],
    ["privacy:egress-summary", { since: 5 }],
    ["privacy:egress-clear"],
    ["privacy:egress-export"],
  ]);
  const seen = [];
  const off = api.privacy.onSealedChange((sealed) => seen.push(sealed));
  listeners.get("privacy:sealed-changed")({}, true);
  off();
  assert.deepEqual(seen, [true]);
  assert.equal(listeners.has("privacy:sealed-changed"), false);
  const attestations = [];
  api.privacy.onAttestation((a) => attestations.push(a.version));
  listeners.get("privacy:attestation")({}, { version: 3 });
  assert.deepEqual(attestations, [3]);
  const notices = [];
  api.privacy.onEgress((n) => notices.push(n));
  listeners.get("privacy:egress-event")({}, { phase: "dispatched", task: "chat", targetId: "groq" });
  assert.deepEqual(notices, [{ phase: "dispatched", task: "chat", targetId: "groq" }]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/helpers/sealTransition.test.js test/helpers/trustedSender.test.js test/helpers/privacyIPC.test.js test/helpers/privacyBootOrder.test.js test/helpers/preloadAuthBridge.test.js`
Expected: FAIL. The privacy modules are missing, `bootEgressGuards(` is not found in `main.js`, and `api.privacy` is undefined.

- [ ] **Step 3: Implement the boot module**

Create `src/helpers/privacy/privacyBoot.js`:

```js
const { EventEmitter } = require("node:events");
const gate = require("./egressGate");
const backstop = require("./egressBackstop");
const { SealedState } = require("./sealedState");
const { FlightRecorder } = require("./flightRecorder");
const childRegistry = require("./childRegistry");

// Called from main.js before any helper that can open a connection is
// required (test/helpers/privacyBootOrder.test.js). Order matters: read the
// switch, configure the gate, then install the hooks.
function bootEgressGuards({ app, profile, getDefaultSession, utilityProcess = null, now = Date.now }) {
  const state = new SealedState({ profile, now });
  const recorder = new FlightRecorder({ now });
  gate.configureEgress({ isSealed: () => state.isSealed(), recorder, now });
  backstop.installNodeBackstop();
  childRegistry.installSpawnGuard({ utilityProcess });
  backstop.installWebContentsGuard(app);
  app.on("session-created", (session) => backstop.watchSession(session));
  app.whenReady().then(() => backstop.watchSession(getDefaultSession()));
  return { state, recorder, bootedAt: now() };
}

// The sealing barrier. "sealed" (with effectiveSince) is reached only after
// every remote ticket, remote socket, in-flight Chromium request, pending DNS
// lookup and network-capable child has stopped. It fails closed: a stop that
// fails, a child that survives SIGKILL or anything still running keeps the
// phase "sealing" with a failure listed, and no evidence is ever cleared to
// make the check pass. Nothing local is reset.
function createSealTransition({ state, bootedAt, getUpdateManager, getInference, getCalendars, children, sleep, now = Date.now, waitMs = 2000 }) {
  const emitter = new EventEmitter();
  let snapshot = state.isSealed()
    ? { phase: "sealed", effectiveSince: bootedAt, failures: [], notes: [] } // guards were installed before anything ran
    : { phase: "open", effectiveSince: null, failures: [], notes: [] };
  let generation = 0;
  const set = (next) => {
    snapshot = next;
    emitter.emit("change", snapshot);
  };
  // Names what is still running, so the panel can say why it is unverified.
  const stillRunning = () => {
    const guards = backstop.status();
    const running = [];
    if (gate.activeRemoteCount() > 0) running.push("requests");
    if (guards.openRemoteSockets > 0) running.push("sockets");
    if (guards.chromiumInFlightRemote > 0) running.push("chromium");
    if (guards.pendingDns > 0) running.push("dns");
    if (getInference()?.codexRunning?.() || children.alive().some((c) => !c.local)) running.push("children");
    return running;
  };
  async function waitQuiet(gen) {
    const deadline = now() + waitMs;
    while (stillRunning().length > 0 && now() < deadline && gen === generation) await sleep(25);
    return stillRunning();
  }
  async function apply(sealed) {
    const gen = ++generation;
    gate.onSealChanged(sealed);
    if (!sealed) {
      set({ phase: "open", effectiveSince: null, failures: [], notes: [] });
      for (const calendar of getCalendars()) calendar?.start?.();
      getUpdateManager()?.resumeAfterSeal?.();
      return;
    }
    set({ phase: "sealing", effectiveSince: null, failures: [], notes: [] });
    gate.abortAllRemote();
    getUpdateManager()?.pauseForSeal?.();
    for (const calendar of getCalendars()) calendar?.stop?.();
    const failures = [];
    const [codex, rest] = await Promise.allSettled([getInference()?.stopCodex?.(), children.stopAll()]);
    if (codex.status === "rejected") failures.push("codexStop");
    if (rest.status === "rejected") failures.push("childStop");
    backstop.severAll();
    const running = await waitQuiet(gen);
    if (gen !== generation) return; // a later toggle owns the outcome
    if (running.length === 0 && failures.length === 0) set({ phase: "sealed", effectiveSince: now(), failures: [], notes: [] });
    else set({ phase: "sealing", effectiveSince: null, failures: [...failures, ...running.map((r) => `timeout:${r}`)], notes: [] });
  }
  // Called when tickets settle, Chromium requests finish or children exit.
  // A failure is resolved only by the thing it names having actually stopped.
  function recheck() {
    if (snapshot.phase !== "sealing" || !state.isSealed()) return;
    const running = stillRunning();
    if (running.length > 0) {
      set({ ...snapshot, failures: [...snapshot.failures.filter((f) => !f.startsWith("timeout:")), ...running.map((r) => `timeout:${r}`)] });
      return;
    }
    const resolved = snapshot.failures.filter((f) => !f.startsWith("timeout:"));
    set({ phase: "sealed", effectiveSince: now(), failures: [], notes: resolved });
  }
  return { apply, recheck, snapshot: () => snapshot, on: (event, fn) => emitter.on(event, fn) };
}

function createAttestor({ state, transition, getInference, children }) {
  let version = 0;
  return function attest() {
    const saved = state.snapshot();
    const { phase, effectiveSince, failures, notes } = transition.snapshot();
    const guards = backstop.status();
    const tally = gate.counters();
    const networkChildren = [
      ...new Set([...(getInference()?.codexRunning?.() ? ["codex"] : []), ...children.alive().filter((c) => !c.local).map((c) => c.kind)]),
    ];
    // On-device sidecars keep running while sealed (local routes must work).
    // Their launch was checked; their runtime traffic is not visible, so they
    // are named rather than counted as verified (CCR-6).
    const uninspectedChildren = [...new Set(children.alive().filter((c) => c.local).map((c) => c.kind))];
    const activeRemote = gate.activeRemoteCount();
    const guardsUp = guards.node && guards.dns && guards.dgram && guards.http && guards.webContents && guards.sessions > 0;
    return {
      ...saved,
      phase,
      effectiveSince,
      failures,
      notes,
      guards,
      networkChildren,
      uninspectedChildren,
      activeRemote,
      blockedSinceSealed: tally.blockedSinceSealed,
      recordFailures: tally.recordFailures,
      version: ++version,
      at: Date.now(),
      nothingLeaves:
        saved.sealed &&
        phase === "sealed" &&
        effectiveSince != null &&
        failures.length === 0 &&
        guardsUp &&
        !guards.envProxy &&
        guards.openRemoteSockets === 0 &&
        guards.chromiumInFlightRemote === 0 &&
        guards.pendingDns === 0 &&
        networkChildren.length === 0 &&
        activeRemote === 0,
    };
  };
}

// Native dialogs owned by main: a compromised renderer can ask, but cannot
// answer. The safe choice (keep sealed / keep records) is the default.
function createConfirmations({ dialog, BrowserWindow, t }) {
  const ask = async (event, options) => {
    const parent = BrowserWindow.fromWebContents?.(event?.sender) ?? undefined;
    const { response } = await dialog.showMessageBox(parent, { type: "warning", defaultId: 0, cancelId: 0, noLink: true, ...options });
    return response === 1;
  };
  return {
    unseal: (event) =>
      ask(event, {
        title: t("sealedMode.confirmUnseal.title"),
        message: t("sealedMode.confirmUnseal.message"),
        detail: t("sealedMode.confirmUnseal.detail"),
        buttons: [t("sealedMode.confirmUnseal.keep"), t("sealedMode.confirmUnseal.turnOff")],
      }),
    clear: (count, event) =>
      ask(event, {
        title: t("sealedMode.confirmClear.title"),
        message: t("sealedMode.confirmClear.message"),
        detail: t("sealedMode.confirmClear.detail", { count }),
        buttons: [t("sealedMode.confirmClear.keep"), t("sealedMode.confirmClear.clear")],
      }),
  };
}

module.exports = { bootEgressGuards, createSealTransition, createAttestor, createConfirmations };
```

- [ ] **Step 4: Implement the trusted-sender check**

Create `src/helpers/privacy/trustedSender.js`:

```js
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// A privacy-changing IPC call must come from the main frame of the main window
// or control panel, while that frame shows Loqui's own page: not an iframe,
// not a page the window was navigated to.
function createTrustedSender({ getWindows, appUrlPrefixes }) {
  return function isTrustedSender(event) {
    const sender = event?.sender;
    const frame = event?.senderFrame;
    if (!sender || !frame) return false;
    if (!getWindows().some((w) => w && !w.isDestroyed() && w.webContents === sender)) return false;
    if (frame !== sender.mainFrame) return false;
    const url = String(frame.url ?? "");
    return appUrlPrefixes().some((prefix) => url.startsWith(prefix));
  };
}

// The URLs windowManager.loadWindowContent() loads (windowManager.js:556-574):
// the dev server's origin in development (getAppFilePath returns null there),
// the packaged renderer directory otherwise. Never both.
function appUrlPrefixes({ DevServerManager = require("../devServerManager"), env = process.env } = {}) {
  if (env.NODE_ENV === "development") {
    const url = DevServerManager.getAppUrl(true);
    return url ? [`${new URL(url).origin}/`] : [];
  }
  const file = DevServerManager.getAppFilePath(true);
  return file?.path ? [`${pathToFileURL(path.dirname(file.path)).href}/`] : [];
}

module.exports = { createTrustedSender, appUrlPrefixes };
```

Match `require("../devServerManager")` to that module's real export (`src/helpers/devServerManager.js`; `getAppUrl` at `:59`, `getAppFilePath` at `:72-86`).

- [ ] **Step 5: Implement the IPC module**

Create `src/helpers/privacy/privacyIPC.js`:

```js
const fs = require("node:fs");
const gate = require("./egressGate");
const { toCsv, MAX_ROWS } = require("./flightRecorder");

function startOfToday(ms) {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function attachPrivacyIPC({ ipcMain, BrowserWindow, dialog, state, recorder, attest, transition, isTrustedSender, confirm, now = Date.now }) {
  const windows = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  const broadcast = (channel, payload) => {
    for (const w of windows()) w.webContents.send(channel, payload);
  };
  const broadcastAttestation = () => broadcast("privacy:attestation", attest());
  const channels = [];
  const handle = (name, fn, { trusted = false } = {}) => {
    const channel = `privacy:${name}`;
    channels.push(channel);
    ipcMain.handle(channel, (event, ...args) => {
      if (!windows().some((w) => w.webContents === event.sender)) throw new Error("Unknown application window");
      if (trusted && !isTrustedSender(event)) throw new Error("This window cannot change privacy settings");
      return fn(event, ...args);
    });
  };
  const range = (options) => ({
    since: Number.isFinite(options?.since) ? options.since : startOfToday(now()),
    limit: Number.isFinite(options?.limit) ? Math.min(Math.max(1, Math.trunc(options.limit)), 5000) : 500,
  });

  let queue = Promise.resolve();
  handle("get-sealed", () => state.isSealed());
  handle("attestation", () => attest());
  handle(
    "set-sealed",
    (event, sealed) => {
      if (typeof sealed !== "boolean") throw new TypeError("sealed must be a boolean");
      // Serialise toggles so a quick on/off/on cannot interleave transitions.
      queue = queue
        .catch(() => {})
        .then(async () => {
          const before = state.isSealed();
          if (before && !sealed && !(await confirm.unseal(event))) return { ...attest(), declined: true };
          state.set(sealed);
          if (state.isSealed() !== before) {
            await transition.apply(state.isSealed());
            broadcast("privacy:sealed-changed", state.isSealed());
          }
          return attest();
        });
      return queue;
    },
    { trusted: true }
  );
  handle("egress-list", (_event, options) => recorder.list(range(options)));
  handle("egress-summary", (_event, options) => recorder.summary({ since: range(options).since }));
  handle(
    "egress-clear",
    async (event) => {
      const count = recorder.list({ since: 0, limit: MAX_ROWS }).length;
      if (!(await confirm.clear(count, event))) return false;
      recorder.clear();
      return true;
    },
    { trusted: true }
  );
  handle(
    "egress-export",
    async () => {
      const stamp = new Date(now()).toISOString().slice(0, 10);
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: `loqui-flight-recorder-${stamp}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (canceled || !filePath) return { saved: false };
      fs.writeFileSync(filePath, toCsv(recorder.list({ since: 0, limit: MAX_ROWS })), { mode: 0o600 });
      return { saved: true };
    },
    { trusted: true }
  );

  let pending = null;
  const onSettled = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      transition.recheck();
      broadcastAttestation();
    }, 50);
  };
  const onEvent = (event) => broadcast("privacy:egress-event", { phase: "recorded", event });
  const relay = (phase) => (notice) => broadcast("privacy:egress-event", { phase, ...notice });
  const onDispatched = relay("dispatched");
  const onDelivered = relay("delivered");
  const onUndelivered = relay("undelivered");
  const onCleared = () => broadcast("privacy:egress-cleared");
  recorder.on("event", onEvent);
  recorder.on("cleared", onCleared);
  gate.events.on("dispatched", onDispatched);
  gate.events.on("delivered", onDelivered);
  gate.events.on("undelivered", onUndelivered);
  gate.events.on("settled", onSettled);
  transition.on("change", broadcastAttestation);
  // While a seal is unverified, keep checking: Chromium requests finishing and
  // children exiting do not emit gate events.
  const poll = setInterval(() => {
    if (transition.snapshot().phase === "sealing") transition.recheck();
  }, 500);
  poll.unref?.();

  return {
    broadcastAttestation,
    dispose() {
      clearTimeout(pending);
      clearInterval(poll);
      for (const channel of channels) ipcMain.removeHandler(channel);
      recorder.off("event", onEvent);
      recorder.off("cleared", onCleared);
      gate.events.off("dispatched", onDispatched);
      gate.events.off("delivered", onDelivered);
      gate.events.off("undelivered", onUndelivered);
      gate.events.off("settled", onSettled);
    },
  };
}

module.exports = { attachPrivacyIPC };
```

- [ ] **Step 6: Wire main.js**

1. Directly after the `.env` load block (`main.js:91-95`), insert:

   ```js
   // Sealed mode (Plan 07): read the switch and install the egress guards
   // before any helper that can open a connection is required below.
   const privacyBoot = require("./src/helpers/privacy/privacyBoot");
   const privacy = privacyBoot.bootEgressGuards({
     app,
     profile: app.getPath("userData"),
     getDefaultSession: () => session.defaultSession,
     utilityProcess,
   });
   ```

   `session` (`main.js:24`) and `dialog` (`main.js:21`) are already in the `require("electron")` destructure. Add `utilityProcess` to it if it is missing. `onnxWorkerClient.js:2` imports it from `electron`.

2. In `initializeCoreManagers()`, directly after `databaseManager = new DatabaseManager();` (`main.js:308`), add:

   ```js
     privacy.recorder.attachDatabase(databaseManager.db);
   ```

3. After the `updateManager = require("./src/helpers/updateIPC").attachUpdateIPC({ … });` statement (`main.js:460-470`), add:

   ```js
     const childRegistry = require("./src/helpers/privacy/childRegistry");
     const sealTransition = privacyBoot.createSealTransition({
       state: privacy.state,
       bootedAt: privacy.bootedAt,
       getUpdateManager: () => updateManager,
       getInference: () => inference,
       getCalendars: () => [googleCalendarManager, microsoftCalendarManager],
       children: childRegistry,
       sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
     });
     const trustedSender = require("./src/helpers/privacy/trustedSender");
     require("./src/helpers/privacy/privacyIPC").attachPrivacyIPC({
       ipcMain,
       BrowserWindow,
       dialog,
       state: privacy.state,
       recorder: privacy.recorder,
       transition: sealTransition,
       attest: privacyBoot.createAttestor({
         state: privacy.state,
         transition: sealTransition,
         getInference: () => inference,
         children: childRegistry,
       }),
       isTrustedSender: trustedSender.createTrustedSender({
         getWindows: () => [windowManager.mainWindow, windowManager.controlPanelWindow],
         appUrlPrefixes: () => trustedSender.appUrlPrefixes(),
       }),
       confirm: privacyBoot.createConfirmations({ dialog, BrowserWindow, t: (key, params) => i18nMain.t(key, params) }),
     });
   ```

- [ ] **Step 7: Retention**

In `src/helpers/ipcHandlers.js`:

1. Add `const egressGate = require("./privacy/egressGate");` with the other requires at the top of the file.
2. In `_runRetentionCleanup()` (`:826`), inside the `try`, after the `audioRetentionDays` block, add:

   ```js
         // Flight recorder rows follow transcript retention; 0 ("forever") keeps
         // only the row cap (docs/PRIVACY.md).
         egressGate.getRecorder()?.prune({ retentionDays: transcriptRetentionDays });
   ```

3. In the `retention-settings-changed` `onSettingsChanged` callback (`:1388`), add this as its first line:

   ```js
             egressGate.getRecorder()?.setPersistence(settings.dataRetentionEnabled !== false);
   ```

- [ ] **Step 8: Preload, types and confirmation strings**

In `preload.js`, after the closing `},` of `personalInference` (`preload.js:99`), add:

```js
  privacy: {
    getSealed: () => ipcRenderer.invoke("privacy:get-sealed"),
    setSealed: (sealed) => ipcRenderer.invoke("privacy:set-sealed", sealed),
    getAttestation: () => ipcRenderer.invoke("privacy:attestation"),
    onSealedChange: registerListener("privacy:sealed-changed", (cb) => (_event, sealed) => cb(sealed)),
    onAttestation: registerListener("privacy:attestation", (cb) => (_event, attestation) => cb(attestation)),
    listEgress: (options) => ipcRenderer.invoke("privacy:egress-list", options),
    egressSummary: (options) => ipcRenderer.invoke("privacy:egress-summary", options),
    clearEgress: () => ipcRenderer.invoke("privacy:egress-clear"),
    exportEgressCsv: () => ipcRenderer.invoke("privacy:egress-export"),
    onEgress: registerListener("privacy:egress-event", (cb) => (_event, notice) => cb(notice)),
    onEgressCleared: registerListener("privacy:egress-cleared", (cb) => () => cb()),
  },
```

Create `src/types/privacy.ts` with the TypeScript block from **Interfaces** above. In `src/types/electron.ts`, Plan 03 (Task 2) declared an optional `privacy?: { getSealed; onSealedChange }` member after `downloadSearchModel`. **Replace** that whole member with:

```ts
      // Sealed mode and the flight recorder (spec §5.4, Plan 07).
      privacy: import("./privacy").PrivacyAPI;
```

If Plan 03 has not merged, add the line after `personalInference: …` (`:677`) instead. Either way there must be exactly one `privacy` member: two declarations with different optionality fail the typecheck.

These are the English source strings for main's dialogs. Add them to all 11 locales, using the merge script in Task 14, Step 6:

```json
{
  "sealedMode.confirmUnseal.title": "Turn off Sealed mode?",
  "sealedMode.confirmUnseal.message": "Cloud routes, downloads, updates and calendars will be able to use the network again.",
  "sealedMode.confirmUnseal.detail": "Loqui asks here, outside the app window, so that only you can turn Sealed mode off.",
  "sealedMode.confirmUnseal.keep": "Keep sealed",
  "sealedMode.confirmUnseal.turnOff": "Turn off Sealed mode",
  "sealedMode.confirmClear.title": "Clear the flight recorder?",
  "sealedMode.confirmClear.message": "This deletes the flight recorder history on this computer.",
  "sealedMode.confirmClear.detail": "{{count}} records will be deleted. Nothing a provider already received is affected.",
  "sealedMode.confirmClear.keep": "Keep records",
  "sealedMode.confirmClear.clear": "Clear history"
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test -- test/helpers/sealTransition.test.js test/helpers/trustedSender.test.js test/helpers/privacyIPC.test.js test/helpers/privacyBootOrder.test.js test/helpers/preloadAuthBridge.test.js && npm run typecheck && npm run i18n:check`

Re-run the transition tests a few times (`--test-concurrency=1`, three runs) to catch ordering flakiness in the rapid-toggle case.
Expected: PASS. Typecheck and i18n are clean.

- [ ] **Step 10: Commit**

```bash
git add src/helpers/privacy/privacyBoot.js src/helpers/privacy/privacyIPC.js src/helpers/privacy/trustedSender.js src/types/privacy.ts src/types/electron.ts preload.js main.js src/helpers/ipcHandlers.js src/locales test/helpers/sealTransition.test.js test/helpers/trustedSender.test.js test/helpers/privacyIPC.test.js test/helpers/privacyBootOrder.test.js test/helpers/preloadAuthBridge.test.js
git commit -m "feat(privacy): boot egress guards first, add the sealing barrier and trusted privacy IPC"
```

---

### Task 7a: Harden the control panel and the renderer documents

The owner decided (2026-10-15) to harden the control panel in this plan. It ran with `sandbox: false` and `webSecurity: false`, justified by a comment that the renderer calls provider APIs directly. That is no longer true (Task 1's inventory found no renderer network calls), and the main window already runs the same preload sandboxed.

**Files:**
- Modify:
  - `src/helpers/windowConfig.js`, in `CONTROL_PANEL_CONFIG.webPreferences`. Use `sandbox: true` and remove `webSecurity: false`, together with their stale comments. The span runs from the comment `// sandbox: false is required because the preload script bridges IPC` through `webSecurity: false,` (currently `:227-234`). `preload`, `nodeIntegration` and `contextIsolation` above it stay unchanged.
  - `src/index.html:3-9`. Turn off DNS prefetching for every renderer document.
  - `preload.js`. Before `contextBridge.exposeInMainWorld(...)` (`:65`), remove the WebRTC constructors from the main world of every frame, and expose `electronAPI` only in the main frame.
  - `src/helpers/windowConfig.js`, every `webPreferences`: add `nodeIntegrationInSubFrames: true`.
  - `test/helpers/preloadAuthBridge.test.js` and every other test that stubs `contextBridge` for `preload.js` (today `preloadOnboardingBridge.test.js`; find others with `grep -rln exposeInMainWorld test`): add `executeInMainWorld: () => {}` to the stub.
- Test: `test/helpers/rendererHardening.test.js`

**Interfaces:** none new. Task 6's `installWebContentsGuard` still applies the WebRTC IP policy to every `webContents`, as defence in depth.

**Why remove WebRTC instead of relying on the policy (C2).** Chromium's `webRequest` does not see WebRTC, and `disable_non_proxied_udp` still allows TCP candidates (for example TURN over TCP). Loqui never uses WebRTC. Every Loqui window loads `preload.js` (`windowConfig.js:185, 224, 279`), and Electron 44 (`package.json`) runs `contextBridge.executeInMainWorld` synchronously, before any page script.

**Every frame, not just the top page (C2-R2).** A same-origin `about:blank` or `srcdoc` iframe has its own global object, with its own `RTCPeerConnection`. So:
- every window sets `nodeIntegrationInSubFrames: true`. With `sandbox: true` and `nodeIntegration: false` this grants no Node access; it only makes Electron run the preload in every frame (Electron's WebPreferences docs);
- the preload removes the constructors in every frame;
- it exposes `electronAPI` only in the main frame (`process.isMainFrame`), so a subframe gains no IPC;
- `src/index.html` adds a CSP with `frame-src 'none'` and `object-src 'none'`, so no remote document can be framed at all.

The ratchet test runs the removal for a main frame and a subframe. Task 16 checks the top page, an `about:blank` iframe and a `srcdoc` iframe in the real app. If Electron ever stops running preloads in a new frame before page script can reach it, that check fails. Renderer WebRTC must then be disclosed as outside the boundary, rather than assumed covered.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/rendererHardening.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { installElectronStub } = require("./harness/electronStub");

installElectronStub();
const repoRoot = path.join(__dirname, "../..");

test("every window is sandboxed and keeps web security on", () => {
  const configs = require("../../src/helpers/windowConfig");
  const all = Object.entries(configs).filter(([, v]) => v && typeof v === "object" && v.webPreferences);
  assert.ok(all.length >= 3, "found the window configs");
  for (const [name, config] of all) {
    assert.equal(config.webPreferences.sandbox, true, `${name}.sandbox`);
    assert.notEqual(config.webPreferences.webSecurity, false, `${name}.webSecurity`);
    assert.equal(config.webPreferences.nodeIntegration, false, `${name}.nodeIntegration`);
    assert.equal(config.webPreferences.contextIsolation, true, `${name}.contextIsolation`);
  }
});

test("renderer documents turn off DNS prefetching", () => {
  const html = fs.readFileSync(path.join(repoRoot, "src/index.html"), "utf8");
  assert.match(html, /<meta http-equiv="x-dns-prefetch-control" content="off"\s*\/?>/);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="frame-src 'none'; object-src 'none'"\s*\/?>/);
});

test("every window loads the preload, and the preload removes WebRTC from the page", () => {
  const configs = require("../../src/helpers/windowConfig");
  for (const [name, config] of Object.entries(configs).filter(([, v]) => v?.webPreferences)) {
    assert.match(String(config.webPreferences.preload), /preload\.js$/, `${name}.preload`);
    assert.equal(config.webPreferences.nodeIntegrationInSubFrames, true, `${name}: the preload runs in every frame`);
    assert.equal(config.webPreferences.sandbox, true, `${name}: and still has no Node`);
  }
  const vm = require("node:vm");
  const loadIn = (isMainFrame) => {
    const seen = { mainWorld: null, exposed: [] };
    const electron = {
      contextBridge: { executeInMainWorld: ({ func }) => { seen.mainWorld = func; }, exposeInMainWorld: (name) => seen.exposed.push(name) },
      ipcRenderer: { invoke: async () => {}, on() {}, removeListener() {}, send() {}, sendSync() {} },
      webUtils: {},
    };
    const source = fs.readFileSync(path.join(repoRoot, "preload.js"), "utf8");
    vm.runInNewContext(source, { require: (s) => (s === "electron" ? electron : require(s)), process: { ...process, isMainFrame } });
    return seen;
  };
  const subframe = loadIn(false);
  assert.equal(typeof subframe.mainWorld, "function", "a subframe's WebRTC is removed too");
  assert.deepEqual(subframe.exposed, [], "a subframe gets no electronAPI");
  const top = loadIn(true);
  assert.deepEqual(top.exposed, ["electronAPI"]);
  const mainWorld = top.mainWorld;
  // Run it in a fresh "page" with the constructors a renderer would have.
  const page = vm.createContext({ RTCPeerConnection: function () {}, webkitRTCPeerConnection: function () {}, RTCDataChannel: function () {} });
  vm.runInContext(`(${mainWorld.toString()})()`, page);
  for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel"]) {
    assert.equal(vm.runInContext(`typeof ${name}`, page), "undefined", name);
    vm.runInContext(`globalThis.${name} = function () {}`, page);
    assert.equal(vm.runInContext(`typeof ${name}`, page), "undefined", `${name} cannot be put back`);
  }
});
```

If `windowConfig.js` exports its configs under different names, adapt only the `Object.entries` filter so it finds every exported `webPreferences` object.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/helpers/rendererHardening.test.js`
Expected: FAIL. `CONTROL_PANEL_CONFIG.sandbox` is `false`, and the meta tag is missing.

- [ ] **Step 3: Implement**

1. In `src/helpers/windowConfig.js`, replace the span from `// sandbox: false is required because the preload script bridges IPC` through `webSecurity: false,` with the snippet below. That span is the two stale comments plus `sandbox: false,` and `webSecurity: false,`, currently `:227-234`. Keep every other line of `webPreferences`:

   ```js
       // Same as the main window: the preload only uses contextBridge/ipcRenderer,
       // and the renderer makes no network requests of its own (Sealed mode
       // threat model), so neither the sandbox nor same-origin policy is relaxed.
       sandbox: true,
   ```

2. In `src/index.html`, after `<meta charset="UTF-8" />` (`:4`), add:

   ```html
       <meta http-equiv="x-dns-prefetch-control" content="off" />
   ```

3. In `preload.js`, directly before `contextBridge.exposeInMainWorld("electronAPI", {` (`:65`), add:

   ```js
   // BEGIN sealed-mode: WebRTC removal (Plan 07 Task 7a; the egress ratchet allows this block)
   // Loqui never uses WebRTC, and Chromium's webRequest cannot see its traffic,
   // so the constructors are removed before any page script runs, in every
   // frame (nodeIntegrationInSubFrames runs this preload in each one). They
   // cannot be redefined.
   contextBridge.executeInMainWorld({
     func: () => {
       for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCRtpSender", "RTCRtpReceiver", "RTCIceCandidate", "RTCSessionDescription"]) {
         try {
           Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });
         } catch {
           // Already non-configurable in this context: leave it.
         }
       }
     },
   });
   // END sealed-mode: WebRTC removal
   ```

   Then change `contextBridge.exposeInMainWorld("electronAPI", {` (`:65`) to `if (process.isMainFrame) contextBridge.exposeInMainWorld("electronAPI", {`. A subframe gets no IPC bridge.

   In `src/helpers/windowConfig.js`, add `nodeIntegrationInSubFrames: true,` to every `webPreferences` (`:185`, `:224`, `:279`), next to `sandbox: true`.

   In `src/index.html`, after the DNS-prefetch meta tag, add:

   ```html
       <meta http-equiv="Content-Security-Policy" content="frame-src 'none'; object-src 'none'" />
   ```

   This CSP has no `script-src`, so Vite's development preamble is unaffected.

4. In `test/helpers/preloadAuthBridge.test.js` and every other test that loads `preload.js` (today `preloadOnboardingBridge.test.js`; find others with `grep -rln exposeInMainWorld test`):
   - add `executeInMainWorld: () => {}` to the `contextBridge` stub;
   - pass `process: { ...process, isMainFrame: true }` to `vm.runInNewContext`, because those tests load the main frame.

- [ ] **Step 4: Run the tests, then check the control panel by hand**

Run: `npm test -- test/helpers/rendererHardening.test.js test/helpers/preloadAuthBridge.test.js`
Expected: PASS. In the running app's control panel, `typeof RTCPeerConnection` in DevTools is `"undefined"`; Task 16 asserts the same in Electron.

Then run `npm run native:electron && npm run dev` with a disposable `LOQUI_PROFILE_DIR`, and exercise the control panel:
- Settings in every section;
- notes, chat and history playback of a recording;
- file upload, drag-and-drop and image attachments;
- model downloads.

Anything that breaks because it relied on the sandbox or web security being relaxed must be fixed at its cause, for example with a main-process IPC call or a custom protocol. Do not relax the settings again. Record each such fix in the PR description.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/windowConfig.js src/index.html preload.js test/helpers/rendererHardening.test.js test/helpers/preloadAuthBridge.test.js test/helpers/preloadOnboardingBridge.test.js
git commit -m "fix(security): sandbox the control panel, keep web security on, remove WebRTC from renderers"
```

---

### Task 8: Gate provider inference, provider checks and Codex (N1–N4, N11, N17, N18)

**Files:**
- Create:
  - `src/helpers/privacy/providerEndpoints.js`. Where a request for each provider goes, used for ledger labels and the gate decision.
  - `src/helpers/privacy/gatedFetch.js`. `gatedNetFetch` (Electron `net`) and `gatedNodeFetch(task)` (Node `fetch`). Both hold their ticket until the response body ends.
- Modify:
  - `src/helpers/codexAppServer.js`:
    - The constructor (`:81-110`) accepts `beforeSpawn` and `onSpawn`.
    - `_start` (`:125-222`) re-checks just before `spawnProcess` (`:181`) and abandons a start that sealing cancelled.
    - Add `alive()` and `stopAndWait()` after `stop()` (`:497-501`).
  - `src/helpers/personalInference.js`:
    - `:173-205` `createModel` takes a `fetchImpl`.
    - `:208-216` builds the default Codex with gated verification, a pre-spawn check and an opaque session entry.
    - `:248-267` gates the Codex handlers (except `codex-cancel-login` at `:264`).
    - `:286-320` gates `models`.
    - `:347-512` splits `execute` into a gated wrapper and `run`.
    - `:532-541` makes the returned object expose `stopCodex` and `codexRunning`.
  - `src/helpers/tinfoilCatalog.js:41-51` (`fetchModels`).
  - `src/helpers/providerConnectionTest.js:316-327`. Its transport `catch` turns every failure into `{ success: false, errorCode: "network" }` (`:332`), which would hide a sealed block. It now rethrows sealed errors.
  - `src/helpers/ipcHandlers.js`:
    - `:1151` passes a gated fetch to `testProviderConnection`.
    - The legacy enterprise handlers `:3953`, `:4025`, `:4154` and `:4239` are registered through `handleGated`.
  - `docs/security/sealed-mode-threat-model.md`. Add `src/helpers/privacy/gatedFetch.js` to the `egress-sites` block.
- Test: `test/helpers/personalInferenceSealed.test.js` and `test/helpers/codexAppServerSealed.test.js`

**Interfaces:**
- Consumes `egressGate` (Task 5; `guard`, `guardResponse`, `authorize`, `assertAllowed`, `meteredFetch`) and `taskForScope`/`isSealedModeError` (Task 2).
- Produces:
  - `providerEndpoint(provider: string, baseUrl?: string): string`. Custom, LAN and local providers use `baseUrl`. Named providers use the fixed table. An unknown provider maps to `https://unknown-provider.invalid`, which is remote (fail toward disclosure).
  - `gatedNetFetch(url, init?, meta?: { task?, payload?, correlationId? }): Promise<Response>`, using Electron `net.fetch` with `useSessionCookies: false`.
  - `gatedNodeFetch(task, meta?): (url, init?) => Promise<Response>`.
  - `gatedVerifyRelease(verify = verifyOfficialCodex): (options) => Promise<…>`, exported from `personalInference.js`.
  - The `registerPersonalInferenceIPC` return value gains `stopCodex(): Promise<void>`, which resolves after the app-server process has exited and rejects if it will not, and `codexRunning(): boolean`, which is true while a start is pending or any spawned child has not yet exited.
  - `CodexAppServer` gains:
    - the constructor options `beforeSpawn?: () => void`, which throws to refuse, and `onSpawn?: (child) => void`;
    - `alive(): boolean`;
    - `stopAndWait(): Promise<void>`. It cancels a pending start, stops the child, waits for its exit, escalates to `SIGKILL`, and rejects with code `CODEX_STOP_FAILED` if the child still has not exited.
  - `createModel(provider, model, apiKey, baseURL, disableThinking, enterprise, fetchImpl?)`.
  - Text requests may carry an optional `correlationId` (a string, truncated to 128 characters). It is echoed in `sent` notices for CCR-3.

**Codex in the ledger (owner decision 2, 2026-10-15).** The app-server makes its own connections inside a child process, which main cannot see. Each app-server process is therefore one **opaque session** row: task `codex`, host `chatgpt.com`, no byte counts, labelled "session; traffic not visible to Loqui". The row opens at spawn and settles at exit. The handlers for status, login, models and rate limits only check permission (`assertAllowed`); the session row covers their traffic. GitHub release verification is ordinary main-process traffic and gets its own metered row.

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/codexAppServerSealed.test.js`:

```js
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { CodexAppServer } = require("../../src/helpers/codexAppServer");
const fixture = require("../fixtures/codex-app-server-0.154.json");

// Same fakes as test/helpers/codexAppServer.test.js, reduced to initialize.
function fakeChild({ ignoreTerm = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kills = [];
  child.kill = (signal = "SIGTERM") => {
    child.kills.push(signal);
    if (signal === "SIGKILL" || !ignoreTerm) setImmediate(() => child.emit("exit", null, signal));
    return true;
  };
  child.stdin = new Writable({
    write(bytes, _encoding, callback) {
      const message = JSON.parse(bytes.toString());
      callback();
      if (message.method === "initialize")
        queueMicrotask(() => child.stdout.write(JSON.stringify({ id: message.id, result: fixture.initialize }) + "\n"));
    },
  });
  return child;
}

async function setup(t, { child = fakeChild(), verifyGate, beforeSpawn, onSpawn } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "loqui-codex-sealed-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let spawned = 0;
  const server = new CodexAppServer({
    userDataPath: dir,
    env: { PATH: process.env.PATH },
    resolveExecutable: async () => "/verified/codex",
    verifyRelease: async () => verifyGate?.promise,
    runFile: async () => ({ stdout: fixture.version }),
    spawnProcess: () => {
      spawned++;
      return child;
    },
    beforeSpawn,
    onSpawn,
    timeoutMs: 1000,
    stopTimeoutMs: 50,
  });
  return { server, child, spawned: () => spawned };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

test("sealing during a pending start cancels it before anything is spawned", async (t) => {
  const verifyGate = deferred();
  const h = await setup(t, { verifyGate });
  const starting = h.server.start();
  assert.equal(h.server.alive(), true, "a pending start counts as alive");
  const stopping = h.server.stopAndWait();
  verifyGate.resolve();
  await assert.rejects(starting, (e) => e.code === "CODEX_DISCONNECTED");
  await stopping;
  assert.equal(h.spawned(), 0);
  assert.equal(h.server.alive(), false);
});

test("beforeSpawn runs immediately before the spawn and can refuse it", async (t) => {
  const h = await setup(t, {
    beforeSpawn: () => {
      throw Object.assign(new Error("[SEALED_MODE] sealed"), { code: "SEALED_MODE" });
    },
  });
  await assert.rejects(h.server.start(), (e) => e.code === "SEALED_MODE");
  assert.equal(h.spawned(), 0);
});

test("alive() stays true until the process has actually exited", async (t) => {
  const child = fakeChild({ ignoreTerm: true });
  const spawnedChildren = [];
  const h = await setup(t, { child, onSpawn: (c) => spawnedChildren.push(c) });
  await h.server.start();
  assert.deepEqual(spawnedChildren, [child]);
  h.server.stop();
  assert.equal(h.server.alive(), true, "stop() only signals; the child ignored SIGTERM");
  await h.server.stopAndWait();
  assert.deepEqual(child.kills, ["SIGTERM", "SIGKILL"]);
  assert.equal(h.server.alive(), false);
});

test("stopAndWait rejects when the child survives SIGKILL", async (t) => {
  const child = fakeChild({ ignoreTerm: true });
  child.kill = (signal) => {
    child.kills.push(signal);
    return true;
  };
  child.kills = [];
  const h = await setup(t, { child });
  await h.server.start();
  await assert.rejects(h.server.stopAndWait(), (e) => e.code === "CODEX_STOP_FAILED");
  assert.equal(h.server.alive(), true);
});
```

Create `test/helpers/personalInferenceSealed.test.js`:

```js
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { installElectronStub } = require("./harness/electronStub");

installElectronStub();
const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError, sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");
const { providerEndpoint } = require("../../src/helpers/privacy/providerEndpoints");
const { registerPersonalInferenceIPC, gatedVerifyRelease } = require("../../src/helpers/personalInference");

const REACHED = "reached the model factory";

function harness(t, { sealed = false, modelFactory } = {}) {
  const flags = { sealed };
  const recorder = new FlightRecorder({ now: () => 1 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now: () => 1 });
  t.after(() => gate._resetForTests());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-pi-sealed-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const handlers = new Map();
  const calls = { credential: 0, factory: [], codexStatus: 0, stopped: 0 };
  const codex = Object.assign(new EventEmitter(), {
    status: async () => { calls.codexStatus++; return {}; },
    login: async () => ({}), cancelLogin: async () => {}, logout: async () => {},
    models: async () => [], rateLimits: async () => ({}), stop() {}, erase: async () => {},
    generate: async () => "",
    alive: () => false,
    stopAndWait: async () => { calls.stopped++; },
  });
  const api = registerPersonalInferenceIPC({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn), removeHandler: (c) => handlers.delete(c) },
    userDataPath: dir,
    getCredential: async () => { calls.credential++; return "sk-test"; },
    saveCredential: async () => {},
    openExternal: async () => {},
    codex,
    modelFactory: modelFactory ?? (async (...args) => { calls.factory.push(args); throw new Error(REACHED); }),
  });
  const sent = [];
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send: (c, p) => sent.push([c, p]) });
  const invoke = (name, ...args) => handlers.get(`personal-inference:${name}`)({ sender }, ...args);
  return { flags, recorder, calls, invoke, sent, api };
}

const chatRequest = (overrides = {}) => ({
  provider: "groq", requestId: `r-${Math.random()}`, model: "llama-3.3", credentialRef: "groq",
  inferenceScope: "chatIntelligence", messages: [{ role: "user", content: "secret plans" }], ...overrides,
});

test("sealed: text-generate is refused before credentials or the SDK are touched", async (t) => {
  const h = harness(t, { sealed: true });
  await assert.rejects(h.invoke("text-generate", chatRequest()), (e) => sealedPhaseOf(e) === "refused");
  assert.equal(h.calls.credential, 0);
  assert.equal(h.calls.factory.length, 0);
  const [row] = h.recorder.list();
  assert.deepEqual([row.task, row.host, row.outcome, row.bytesOut, row.model], ["chat", "api.groq.com", "blocked", 0, "llama-3.3"]);
});

test("sealed: text-stream reports SEALED_MODE as a typed stream error", async (t) => {
  const h = harness(t, { sealed: true });
  const request = chatRequest();
  await h.invoke("text-stream", request);
  const error = h.sent.map(([, p]) => p).find((p) => p.type === "error");
  assert.equal(error.code, "SEALED_MODE");
  assert.equal(error.requestId, request.requestId);
});

test("sealed: a loopback provider still reaches the model factory", async (t) => {
  const h = harness(t, { sealed: true });
  await assert.rejects(
    h.invoke("text-generate", chatRequest({ provider: "local", credentialRef: undefined, baseUrl: "http://127.0.0.1:8080/v1", inferenceScope: "dictationCleanup" })),
    new RegExp(REACHED)
  );
  assert.equal(h.recorder.list().length, 0, "loopback is never recorded");
});

test("unsealed: the model factory receives a metered fetch; notices carry target, payload and correlation id", async (t) => {
  const sent = [];
  const h = harness(t, {
    modelFactory: async (...args) => {
      await args[6]("https://api.groq.com/openai/v1/chat/completions", { method: "POST", body: "{}" }).catch(() => {});
      throw new Error(REACHED);
    },
  });
  for (const phase of ["dispatched", "delivered"]) gate.events.on(phase, (n) => sent.push({ phase, ...n }));
  // meteredFetch's default transport is the global fetch; keep the test offline.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(h.invoke("text-generate", chatRequest({ inferenceScope: "noteFormatting", correlationId: "note-7" })), new RegExp(REACHED));
  assert.deepEqual(sent.map((n) => [n.phase, n.task, n.targetId, n.payload, n.correlationId]), [
    ["dispatched", "noteFormatting", "groq", "text", "note-7"],
    ["delivered", "noteFormatting", "groq", "text", "note-7"],
  ]);
  assert.deepEqual([h.recorder.list()[0].task, h.recorder.list()[0].outcome], ["noteFormatting", "error"]);
});

test("sealing mid-request rejects as 'interrupted', not as a timeout or as 'nothing sent'", async (t) => {
  const h = harness(t, {
    modelFactory: async () => {
      const ticket = gate.currentTicket();
      await new Promise((_resolve, reject) =>
        ticket.signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")))
      );
    },
  });
  const pending = h.invoke("text-generate", chatRequest());
  await new Promise((r) => setImmediate(r));
  h.flags.sealed = true;
  gate.abortAllRemote();
  await assert.rejects(pending, (e) => sealedPhaseOf(e) === "interrupted");
  assert.deepEqual([h.recorder.list()[0].outcome, h.recorder.list()[0].errorClass], ["cancelled", "SEALED_MODE"]);
});

test("sealed: model discovery and Codex handlers are refused", async (t) => {
  const h = harness(t, { sealed: true });
  await assert.rejects(h.invoke("models", { provider: "openrouter", credentialRef: "openrouter" }), isSealedModeError);
  await assert.rejects(h.invoke("codex-status"), isSealedModeError);
  assert.equal(h.calls.codexStatus, 0);
  await assert.rejects(h.invoke("text-generate", chatRequest({ provider: "codex", credentialRef: undefined })), isSealedModeError);
});

test("the production Codex server refuses to spawn while sealed, and records each run as an opaque session that ends on exit", async (t) => {
  const { createCodexServer } = require("../../src/helpers/personalInference");
  const { PassThrough, Writable } = require("node:stream");
  const fixture = require("../fixtures/codex-app-server-0.154.json");
  const h = harness(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-codex-prod-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let spawned = 0;
  const child = new EventEmitter();
  child.pid = 777;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  child.stdin = new Writable({
    write(bytes, _e, cb) {
      const m = JSON.parse(bytes.toString());
      cb();
      if (m.method === "initialize") queueMicrotask(() => child.stdout.write(JSON.stringify({ id: m.id, result: fixture.initialize }) + "\n"));
    },
  });
  const seams = {
    userDataPath: dir,
    resolveExecutable: async () => "/verified/codex",
    runFile: async () => ({ stdout: fixture.version }),
    spawnProcess: () => { spawned++; return child; },
    // Not a seam: ignored, so the shipped hooks stay in place.
    beforeSpawn: () => {},
  };
  // Release verification is gated too; keep it offline.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  t.after(() => { globalThis.fetch = originalFetch; });

  h.flags.sealed = true;
  await assert.rejects(createCodexServer(seams).start(), isSealedModeError);
  assert.equal(spawned, 0);

  // Each app-server process is one opaque session, settled only by its exit.
  const { codexSession } = require("../../src/helpers/personalInference");
  const childRegistry = require("../../src/helpers/privacy/childRegistry");
  h.flags.sealed = false;
  const run = Object.assign(new EventEmitter(), { pid: 778, kill() { return true; } });
  codexSession(run);
  assert.equal(h.recorder.list().length, 0, "the session row is written on exit, not on spawn");
  assert.ok(childRegistry.alive("codex").some((c) => c.pid === 778));
  run.emit("exit", 0, null);
  const [row] = h.recorder.list();
  assert.deepEqual([row.task, row.opaque, row.bytesOut], ["codex", true, null]);
  assert.equal(childRegistry.alive("codex").some((c) => c.pid === 778), false);

  // A spawn that fails asynchronously has no pid and never exits (N2).
  const failed = new EventEmitter();
  codexSession(failed);
  failed.emit("error", Object.assign(new Error("spawn EACCES"), { code: "EACCES" }));
  failed.emit("close", -2, null);
  assert.equal(gate.activeRemoteCount(), 0, "the session settled; sealing cannot wait on it forever");
  assert.equal(h.recorder.list()[0].outcome, "error");
});

test("Codex verification is gated; stopCodex waits for the server to stop", async (t) => {
  const h = harness(t, { sealed: true });
  let verified = 0;
  await assert.rejects(gatedVerifyRelease(async () => { verified++; })({}), isSealedModeError);
  assert.equal(verified, 0);
  assert.equal(h.api.codexRunning(), false);
  await h.api.stopCodex();
  assert.equal(h.calls.stopped, 1);
});

test("provider endpoints: named providers use the fixed table, custom ones their URL, unknown is remote", () => {
  assert.equal(providerEndpoint("groq"), "https://api.groq.com/openai/v1");
  assert.equal(providerEndpoint("openai", "http://127.0.0.1:1"), "https://api.openai.com/v1");
  assert.equal(providerEndpoint("custom", "http://192.168.1.5:8080/v1"), "http://192.168.1.5:8080/v1");
  assert.equal(providerEndpoint("lan"), "https://unknown-provider.invalid");
  assert.equal(providerEndpoint("brand-new"), "https://unknown-provider.invalid");
});
```

`validateRequest` rejects a `credentialRef` for `local` and `codex`, and requires `local`'s `baseUrl` to be exactly `http://127.0.0.1:<port>/v1` (`personalInference.js:82-92`, `:148-168`). The requests above follow those rules.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/helpers/codexAppServerSealed.test.js test/helpers/personalInferenceSealed.test.js`
Expected: FAIL. `alive`/`stopAndWait` are missing, `providerEndpoints` is missing, and the sealed request reaches the model factory.

- [ ] **Step 3: Make Codex stoppable for real**

In `src/helpers/codexAppServer.js`:

1. Add `beforeSpawn = () => {}` and `onSpawn = () => {}` to the constructor's destructured options (`:81-94`). Then add these after `this.verifyRelease = verifyRelease;` (`:106`):

   ```js
       this.beforeSpawn = beforeSpawn;
       this.onSpawn = onSpawn;
       // Bumped by stopAndWait(); a start that began earlier must not spawn.
       this.generation = 0;
       this.liveChildren = new Set();
   ```

2. Make the first line of `_start()` (`:125`) `const generation = this.generation;`. Directly before `const child = this.spawnProcess(` (`:181`), add:

   ```js
       if (generation !== this.generation) throw failure("Codex start was cancelled.", "CODEX_DISCONNECTED");
       // Sealed mode re-checks here: the version probe and release check above can take a while.
       this.beforeSpawn();
   ```

   Directly after `this.child = child;` (`:187`), add:

   ```js
       this.liveChildren.add(child);
       child.once("exit", () => this.liveChildren.delete(child));
       this.onSpawn(child);
   ```

3. After `stop()` (`:497-501`), add:

   ```js
     // True while a start is pending or any spawned process has not exited. stop()
     // clears this.child before the process is gone, so callers that must know
     // whether Codex can still reach the network use this.
     alive() {
       return !!this.starting || this.liveChildren.size > 0;
     }
     // Cancel a pending start, stop the process and wait for it to exit,
     // escalating to SIGKILL. Rejects if a process is still alive afterwards.
     async stopAndWait() {
       this.generation++;
       const children = [...this.liveChildren];
       this.stop();
       await this.starting?.catch(() => {});
       await Promise.all(children.map((child) => this._waitForExit(child)));
       for (const child of this.liveChildren) child.kill("SIGKILL");
       await Promise.all([...this.liveChildren].map((child) => this._waitForExit(child)));
       if (this.liveChildren.size > 0) throw failure("Codex did not stop.", "CODEX_STOP_FAILED");
     }
   ```

   `_waitForExit` (`:521-532`) is bounded by `stopTimeoutMs`, so a process that ignores `SIGTERM` is escalated rather than waited on forever.

- [ ] **Step 4: Create the endpoint table and the gated fetches**

Create `src/helpers/privacy/providerEndpoints.js`:

```js
// Where a request for each provider is sent. Used for the Sealed mode decision
// and as the ledger's default host; the backstop replaces the label with the
// host actually contacted when it sees the socket (egressGate observeHost).
const PROVIDER_ENDPOINTS = Object.freeze({
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  corti: "https://ai.eu.corti.app/v1",
  mistral: "https://api.mistral.ai/v1",
  xai: "https://api.x.ai/v1",
  tinfoil: "https://inference.tinfoil.sh/v1",
  codex: "https://chatgpt.com",
  bedrock: "https://bedrock-runtime.amazonaws.com",
  azure: "https://openai.azure.com",
  vertex: "https://aiplatform.googleapis.com",
});
const USER_ENDPOINT_PROVIDERS = new Set(["custom", "lan", "local"]);
const UNKNOWN = "https://unknown-provider.invalid";

function providerEndpoint(provider, baseUrl) {
  if (USER_ENDPOINT_PROVIDERS.has(provider)) return baseUrl || UNKNOWN;
  return PROVIDER_ENDPOINTS[provider] || UNKNOWN;
}

module.exports = { PROVIDER_ENDPOINTS, providerEndpoint };
```

Create `src/helpers/privacy/gatedFetch.js`:

```js
const egress = require("./egressGate");

const withTicketSignal = (init, ticket) => ({
  ...init,
  signal: init?.signal ? AbortSignal.any([init.signal, ticket.signal]) : ticket.signal,
});

// Electron net.fetch through the gate. The ticket stays open until the caller
// finishes reading the body, so sealing can interrupt it and the ledger sees
// the real outcome. The task comes from meta or the egress.withTask() context.
function gatedNetFetch(url, init = {}, { task, payload, correlationId, provider } = {}) {
  const { net } = require("electron");
  return egress.guardResponse({ task, target: String(url), payload, correlationId, provider }, (ticket) =>
    // tag: true — the session backstop attributes the request to this ticket and strips the tag (Task 6).
    egress.meteredFetch(ticket, (u, i) => net.fetch(String(u), { ...i, useSessionCookies: false }), { tag: true })(
      url,
      withTicketSignal(init, ticket)
    )
  );
}

// Node global fetch through the gate, for helpers that take a fetch implementation.
function gatedNodeFetch(task, { payload, correlationId, provider } = {}) {
  return (url, init = {}) =>
    egress.guardResponse({ task, target: String(url), payload, correlationId, provider }, (ticket) =>
      egress.meteredFetch(ticket)(url, withTicketSignal(init, ticket))
    );
}

module.exports = { gatedNetFetch, gatedNodeFetch };
```

Add `src/helpers/privacy/gatedFetch.js` to the `egress-sites` block in the threat model, in sorted position.

- [ ] **Step 5: Gate `personalInference.js`**

1. Add these requires after line 4:

   ```js
   const egress = require("./privacy/egressGate");
   const { taskForScope, isSealedModeError } = require("./privacy/egressPolicy");
   const { providerEndpoint } = require("./privacy/providerEndpoints");
   const { verifyOfficialCodex } = require("./codexCli");
   const childRegistry = require("./privacy/childRegistry");
   const CODEX_HOST = "https://chatgpt.com";
   ```

2. Give `createModel` (`:173`) a seventh parameter `fetchImpl`, and pass it to every SDK factory:

   ```js
   async function createModel(provider, model, apiKey, baseURL, disableThinking, enterprise, fetchImpl) {
     const withFetch = fetchImpl ? { fetch: fetchImpl } : {};
     // …enterprise branch unchanged…
     if (provider === "openai") return createOpenAI({ apiKey, ...withFetch })(model);
     if (provider === "anthropic")
       return require("@ai-sdk/anthropic").createAnthropic({ apiKey, ...withFetch })(model);
     if (provider === "gemini") return require("@ai-sdk/google").createGoogle({ apiKey, ...withFetch })(model);
     if (provider === "groq") return require("@ai-sdk/groq").createGroq({ apiKey, ...withFetch })(model);
   ```

   In the OpenRouter `customFetch` (`:189-199`), replace `return fetch(url, init);` with `return (fetchImpl ?? fetch)(url, init);`. In the final `createOpenAI({ … })`, replace `...(customFetch ? { fetch: customFetch } : {}),` with `...(customFetch ? { fetch: customFetch } : withFetch),`.

   Tinfoil and the enterprise providers do not accept a fetch here. Their bytes stay unknown (`null`), but Layer B still attributes their sockets to the ticket through `AsyncLocalStorage`.

3. Add these helpers above `registerPersonalInferenceIPC`:

   ```js
   // The Codex release check downloads from GitHub before the app-server starts.
   function gatedVerifyRelease(verify = verifyOfficialCodex) {
     return (options) =>
       egress.guard({ task: "codex", target: "https://api.github.com" }, (ticket) =>
         verify({ ...options, fetchImpl: egress.meteredFetch(ticket, options?.fetchImpl ?? globalThis.fetch) })
       );
   }

   // One opaque ledger session per app-server process: main cannot see the
   // child's own requests, only that it ran (owner decision, 2026-10-15).
   // The session settles only on the OS exit event, never on a kill signal, and
   // the child is in the registry (Task 6a) until then.
   function codexSession(child) {
     childRegistry.register(child, { kind: "codex" });
     const session = egress.authorize({ task: "codex", target: CODEX_HOST, provider: "codex", meter: "opaque", payload: "text" });
     session.signal.addEventListener("abort", () => child.kill(), { once: true });
     childRegistry.onChildEnd(child, ({ code, failedToStart }) =>
       session.settle({ outcome: failedToStart ? "error" : session.signal.aborted ? "cancelled" : code === 0 || code === null ? "ok" : "error" })
     );
   }

   // The production Codex server with every Sealed-mode hook wired. Tests pass
   // only the process seams (executable lookup, version probe, spawn); they
   // cannot replace the gate hooks, so they exercise the shipped wiring.
   const CODEX_TEST_SEAMS = ["resolveExecutable", "runFile", "spawnProcess", "env", "homeDir", "platform", "timeoutMs", "stopTimeoutMs"];
   function createCodexServer({ userDataPath, ...seams } = {}) {
     const allowed = Object.fromEntries(Object.entries(seams).filter(([key]) => CODEX_TEST_SEAMS.includes(key)));
     return new CodexAppServer({
       userDataPath,
       ...allowed,
       verifyRelease: gatedVerifyRelease(),
       beforeSpawn: () => egress.assertAllowed({ task: "codex", target: CODEX_HOST }),
       onSpawn: codexSession,
     });
   }

   const payloadOf = (messages) =>
     messages.some((m) => Array.isArray(m.content) && m.content.some((part) => part?.type === "image" || part?.type === "image_url"))
       ? "image"
       : "text";
   ```

   Change the default parameter at `:214` to:

   ```js
     codex = createCodexServer({ userDataPath }),
   ```

4. Add `egress.assertAllowed({ task: "codex", target: CODEX_HOST });` as the first statement of each of these handlers:
   - `codex-status` (`:248`);
   - `codex-login` (`:252`);
   - `codex-logout` (`:265`);
   - `codex-models` (`:266`);
   - `codex-rate-limits` (`:267`).

   This refuses before the app-server could be started. Leave `codex-cancel-login` (`:264`) ungated.

5. In the `models` handler (`:286`), wrap from `const key = await getCredential(…)` to the end of the body-reading loop, so the metered body is fully counted:

   ```js
       return egress.guard({ task: "providerCheck", target: baseUrl }, async (ticket) => {
         const key = await getCredential(request.credentialRef);
         const response = await egress.meteredFetch(ticket, fetch)(`${baseUrl.replace(/\/$/, "")}/models`, {
           headers: key ? { Authorization: `Bearer ${key}` } : {},
           redirect: "error",
           signal: AbortSignal.timeout(15000),
         });
         // …existing status check, 16 MB read loop and parsing, unchanged…
       });
   ```

6. Split `execute` (`:347`). Rename the existing function to `run(event, request, streaming, ticket)` and delete its first line (`const request = validateRequest(raw);`). Then add the gated wrapper above it:

   ```js
     // Sealed mode: refuse before credentials are read or the SDK is built.
     async function execute(event, raw, streaming) {
       const request = validateRequest(raw);
       return egress.guard(
         {
           task: taskForScope(request.inferenceScope),
           target: providerEndpoint(request.provider, request.baseUrl),
           model: request.model,
           provider: request.provider,
           payload: payloadOf(request.messages),
           correlationId: typeof raw?.correlationId === "string" ? raw.correlationId.slice(0, 128) : null,
         },
         (ticket) => run(event, request, streaming, ticket)
       );
     }
   ```

   Inside `run`, make four edits:
   - After `const controller = new AbortController();` (`:353`):

     ```js
         // Sealing mid-request aborts with the SealedModeError as the reason.
         ticket.signal.addEventListener("abort", () => controller.abort(ticket.signal.reason), { once: true });
     ```

   - Directly before `const text = await codex.generate({` (`:392`), and directly before `const result = streamText(options);` (`:471`) and `const result = await generateText(options);` (`:489`), add `ticket.markDispatched();`. This covers providers that do not take a fetch (Codex, Tinfoil, enterprise). `meteredFetch` marks dispatched, delivered or undelivered precisely for the others, and marking is idempotent.
   - Pass the metered fetch as the seventh `modelFactory` argument (`:412-421`). After the existing six arguments, add `egress.meteredFetch(ticket),`.
   - In the `catch` (`:497`), before `if (controller.signal.aborted && error !== controller.signal.reason) throw abortFailure();` (`:501`), add:

     ```js
         if (isSealedModeError(controller.signal.reason)) throw controller.signal.reason;
     ```

7. In the returned object (`:532`), add:

   ```js
       stopCodex: () => codex.stopAndWait(),
       // True until the OS reports exit: a pending start, or a live process in either record.
       codexRunning: () => codex.alive() || childRegistry.alive("codex").length > 0,
   ```

8. Add `gatedVerifyRelease`, `createCodexServer` and `codexSession` to `module.exports`.

- [ ] **Step 6: Gate the Tinfoil catalog, the connection test and the legacy enterprise channels**

1. In `src/helpers/tinfoilCatalog.js`, wrap the body of `fetchModels` (`:41-51`). The guard spans the JSON read, so the ticket covers the whole exchange:

   ```js
   const egress = require("./privacy/egressGate");
   // …
   async function fetchModels() {
     return egress.guard({ task: "providerCheck", target: "https://inference.tinfoil.sh", provider: "tinfoil" }, async (ticket) => {
       ticket.markDispatched();
       // The first call also attests the enclave, so allow for more than a plain GET.
       const response = await tinfoilSecureFetch(TINFOIL_MODELS_PATH, {
         method: "GET",
         signal: AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), ticket.signal]),
       });
       if (!response.ok) {
         throw new Error(`Tinfoil models request failed: ${response.status}`);
       }
       return parseModels(await response.json());
     });
   }
   ```

2. In `src/helpers/ipcHandlers.js`, add these with the other requires:

   ```js
   const egress = require("./privacy/egressGate");
   const { gatedNodeFetch } = require("./privacy/gatedFetch");
   ```

   At `:1151`, change the call to pass `gatedNodeFetch("providerCheck")` as the second argument of `testProviderConnection(…)`.

   In `src/helpers/providerConnectionTest.js`, add `const { isSealedModeError } = require("./privacy/egressPolicy");`. Make the first statement of the transport `catch` (`:316`) `if (isSealedModeError(error)) throw error;`, so a sealed block reaches the renderer as Sealed mode, not as "The provider could not be reached".

3. At the top of `setupHandlers()` (`:1011`), add:

   ```js
       // Registers a channel whose whole body runs inside one egress ticket.
       const handleGated = (channel, meta, fn) =>
         ipcMain.handle(channel, (event, ...args) => egress.guard(meta(...args), () => fn(event, ...args)));
   ```

   Then re-register these four legacy channels through it. Keep each handler body unchanged as `fn`. These channels have no UI caller, but they are reachable from any renderer through preload (`preload.js:608-644`), so they must be gated like live ones.

   | Channel | Line | `meta(...args)` |
   |---|---|---|
   | `test-enterprise-connection` | `:3953` | `() => ({ task: "providerCheck", target: "https://bedrock-runtime.amazonaws.com" })` |
   | `process-enterprise-reasoning` | `:4025` | `() => ({ task: "dictationCleanup", target: "https://bedrock-runtime.amazonaws.com", payload: "text" })` |
   | `enterprise-stream-start` | `:4154` | `() => ({ task: "chat", target: "https://bedrock-runtime.amazonaws.com", payload: "text" })` |
   | `bedrock-list-models` | `:4239` | `() => ({ task: "providerCheck", target: "https://bedrock-runtime.amazonaws.com" })` |

   The host is only a default label. The backstop replaces it with the actual Azure, Bedrock or Vertex host it sees, and every non-loopback target is refused while sealed regardless of the label.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- test/helpers/codexAppServerSealed.test.js test/helpers/codexAppServer.test.js test/helpers/codexAppServerStreamFailures.test.js test/helpers/personalInferenceSealed.test.js test/helpers/egressInventory.test.js test/helpers/providerConnectionTest.test.js test/helpers/useChatStreamingCancellation.test.js`
Expected: PASS. The existing Codex, provider-connection and chat-cancellation suites still pass, because `beforeSpawn` and `onSpawn` default to no-ops.

- [ ] **Step 8: Commit**

```bash
git add src/helpers/codexAppServer.js src/helpers/privacy/providerEndpoints.js src/helpers/privacy/gatedFetch.js src/helpers/personalInference.js src/helpers/tinfoilCatalog.js src/helpers/providerConnectionTest.js src/helpers/ipcHandlers.js docs/security/sealed-mode-threat-model.md test/helpers/codexAppServerSealed.test.js test/helpers/personalInferenceSealed.test.js
git commit -m "feat(privacy): gate provider inference, checks and Codex; stop Codex for real on seal"
```

---

### Task 9: Gate batch speech: uploads, retry and legacy proxies (N5–N8)

**Files:**
- Create: `src/helpers/sttTransport.js`. Move `buildMultipartBody` and `postMultipart` here from `ipcHandlers.js:200-256`; Task 9a adds the realtime helpers to the same module.
- Modify:
  - `src/helpers/ipcHandlers.js`:
    - Import from `sttTransport`.
    - `const proxyFetch = …` at `:5075` becomes `gatedNetFetch`.
    - Pass `payload` at the retry call sites (`:5122`, `:5270`) and the legacy proxies (`:3737`, `:3773`, `:4483`).
    - Wrap a task context around `transcribe-audio-file-byok` (`:7963`), `retry-transcription` (`:5083`) and the `proxy-*-transcription` and `process-anthropic-reasoning` handlers (`:3715`, `:3752`, `:3806`, `:3832`, `:3848`, `:4440`).
    - Pass a correlation id to both `postMultipart` calls (`:8089-8095`, `:8241`).
  - `src/helpers/geminiTranscription.js:69`, `src/helpers/cortiAuth.js:39` and `src/helpers/cortiTranscription.js:7`. Use `gatedNetFetch` instead of `net.fetch`.
  - `src/helpers/tinfoilTranscription.js`. Run its `tinfoilSecureFetch` call and its response read inside one `egress.guard`.
  - `docs/security/sealed-mode-threat-model.md`. Add `src/helpers/sttTransport.js` to `egress-sites`.
- Test: `test/helpers/sttTransportSealed.test.js`

**Interfaces:**
- Consumes `gatedNetFetch` (Task 8) and `egressGate` (Task 5).
- Produces:
  - `buildMultipartBody(fileBuffer, fileName, contentType, fields?) → { body: Buffer, boundary }`, unchanged.
  - `postMultipart(url, body, boundary, headers?, { signal?, session?, correlationId?, provider? }?) → Promise<data>`. It is gated, records `bytesOut = body.length` exactly, has payload `"audio"`, and marks the request `dispatched` just before `net.fetch` and `delivered` when the response arrives.
- Speech tasks: `dictationStt` for captured audio, retry and the legacy proxies; `uploadStt` for file paths.
- Correlation (I4-R2): the BYOK request may carry `correlationId`, the dictation session id (§5.4). Otherwise its existing `requestId` is used. The whole provider dispatch runs inside `egress.withContext({ correlationId, provider: route.provider })`. So the multipart path, and the Corti, Gemini and Tinfoil helpers, all announce the session id and the canonical target: the provider id, or `host:<host>` only for `custom` and self-hosted endpoints.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/sttTransportSealed.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const netCalls = [];
let netResponder = async () => new Response(JSON.stringify({ text: "hi" }), { status: 200 });
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron")
    return {
      app: { getPath: () => process.cwd(), isReady: () => false },
      net: { fetch: (url, init) => { netCalls.push(url); return netResponder(url, init); } },
    };
  return originalLoad.call(this, request, parent, isMain);
};
test.after(() => { Module._load = originalLoad; });

const gate = require("../../src/helpers/privacy/egressGate");
const backstop = require("../../src/helpers/privacy/egressBackstop");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError, sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");
const { gatedNetFetch } = require("../../src/helpers/privacy/gatedFetch");
const stt = require("../../src/helpers/sttTransport");

const flags = { sealed: false };
let recorder;
test.beforeEach(() => {
  flags.sealed = false;
  netCalls.length = 0;
  netResponder = async () => new Response(JSON.stringify({ text: "hi" }), { status: 200 });
  recorder = new FlightRecorder({ now: () => 1 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now: () => 1 });
});

const audio = () => stt.buildMultipartBody(Buffer.from("RIFFdata"), "dictation.wav", "audio/wav", { model: "whisper-1" });
const OPENAI = new URL("https://api.openai.com/v1/audio/transcriptions");

test("sealed: a captured-audio upload is refused before net.fetch, attributed to dictation", async () => {
  flags.sealed = true;
  const { body, boundary } = audio();
  await assert.rejects(
    gate.withTask("dictationStt", () => stt.postMultipart(OPENAI, body, boundary)),
    (e) => sealedPhaseOf(e) === "refused"
  );
  assert.deepEqual(netCalls, []);
  const [row] = recorder.list();
  assert.deepEqual([row.task, row.host, row.outcome, row.bytesOut], ["dictationStt", "api.openai.com", "blocked", 0]);
});

test("sealed: self-hosted Whisper on loopback still transcribes", async () => {
  flags.sealed = true;
  const { body, boundary } = audio();
  await gate.withTask("dictationStt", () => stt.postMultipart(new URL("http://127.0.0.1:8178/inference"), body, boundary));
  assert.equal(netCalls.length, 1);
  assert.equal(recorder.list().length, 0);
});

test("an in-flight loopback transcription survives sealing", async () => {
  let release;
  netResponder = () => new Promise((resolve) => { release = () => resolve(new Response(JSON.stringify({ text: "local" }))); });
  const { body, boundary } = audio();
  const pending = gate.withTask("dictationStt", () => stt.postMultipart(new URL("http://127.0.0.1:8178/inference"), body, boundary));
  await new Promise((r) => setImmediate(r));
  flags.sealed = true;
  gate.abortAllRemote();
  backstop.severAll();
  release();
  await pending; // resolves: loopback work is not interrupted
});

test("unsealed: an upload records exact body bytes and status; it is dispatched, then delivered, with its correlation id", async () => {
  const sent = [];
  for (const phase of ["dispatched", "delivered"]) gate.events.on(phase, (n) => sent.push({ phase, ...n }));
  const { body, boundary } = audio();
  await gate.withTask("uploadStt", () =>
    stt.postMultipart(new URL("https://api.groq.com/openai/v1/audio/transcriptions"), body, boundary, {}, { correlationId: "upload-3" })
  );
  const [row] = recorder.list();
  assert.deepEqual([row.task, row.outcome, row.bytesOut, row.status], ["uploadStt", "ok", body.length, 200]);
  assert.deepEqual(sent.map((n) => [n.phase, n.task, n.payload, n.correlationId]), [
    ["dispatched", "uploadStt", "audio", "upload-3"],
    ["delivered", "uploadStt", "audio", "upload-3"],
  ]);
});

test("a cancelled upload is recorded as cancelled", async () => {
  netResponder = (_url, init) => new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  const controller = new AbortController();
  const { body, boundary } = audio();
  const pending = gate.withTask("dictationStt", () => stt.postMultipart(OPENAI, body, boundary, {}, { signal: controller.signal }));
  await new Promise((r) => setImmediate(r));
  controller.abort();
  await assert.rejects(pending);
  assert.equal(recorder.list()[0].outcome, "cancelled");
});

test("sealing an in-flight upload reports 'interrupted' (the provider may have part of it)", async () => {
  netResponder = (_url, init) => new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  const { body, boundary } = audio();
  const pending = gate.withTask("dictationStt", () => stt.postMultipart(OPENAI, body, boundary));
  await new Promise((r) => setImmediate(r));
  flags.sealed = true;
  gate.abortAllRemote();
  await assert.rejects(pending, (e) => sealedPhaseOf(e) === "interrupted");
});

test("sealed: retry and proxy requests through gatedNetFetch are refused", async () => {
  flags.sealed = true;
  await assert.rejects(
    gate.withTask("dictationStt", () => gatedNetFetch("https://api.x.ai/v1/stt", { method: "POST", body: "x" }, { payload: "audio" })),
    isSealedModeError
  );
  assert.deepEqual(netCalls, []);
});

test("no ungated Electron net transport is left in the speech paths", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
  for (const file of ["src/helpers/ipcHandlers.js", "src/helpers/geminiTranscription.js", "src/helpers/cortiAuth.js", "src/helpers/cortiTranscription.js"]) {
    assert.doesNotMatch(read(file), /\bnet\.(fetch|request)\s*\(/, file);
  }
  assert.doesNotMatch(read("src/helpers/ipcHandlers.js"), /function postMultipart\(/);
  assert.match(read("src/helpers/tinfoilTranscription.js"), /egress\.guard\(/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/helpers/sttTransportSealed.test.js`
Expected: FAIL with `Cannot find module '../../src/helpers/sttTransport'`.

- [ ] **Step 3: Create `sttTransport.js`**

Create `src/helpers/sttTransport.js`. Move `buildMultipartBody` verbatim from `ipcHandlers.js:200-227`. Move `postMultipart` from `ipcHandlers.js:229-256`, with the gate around its body:

```js
const egress = require("./privacy/egressGate");

// buildMultipartBody: moved verbatim from ipcHandlers.js (unchanged).
function buildMultipartBody(fileBuffer, fileName, contentType, fields = {}) {
  /* …verbatim body… */
}

// Batch speech uploads (BYOK and self-hosted). The task comes from the
// handler's egress.withTask() context: dictationStt or uploadStt.
async function postMultipart(url, body, boundary, headers = {}, { signal, session: fetchSession, correlationId = null, provider = null } = {}) {
  const { net } = require("electron");
  return egress.guard({ target: url.toString(), payload: "audio", correlationId, provider }, async (ticket) => {
    ticket.addBytes({ out: body.length });
    ticket.markDispatched();
    let response;
    try {
      response = await (fetchSession ?? net).fetch(url.toString(), {
        method: "POST",
        // The tag lets the session backstop attribute this request; it strips it before sending.
        headers: egress.tagHeaders(ticket, {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          ...headers,
        }),
        body,
        signal: signal ? AbortSignal.any([signal, ticket.signal]) : ticket.signal,
        /* …any other options from the original call, unchanged… */
      });
    } catch (error) {
      if (/ERR_(NAME_NOT_RESOLVED|CONNECTION_REFUSED|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED)/.test(String(error?.message))) ticket.markUndelivered();
      throw error;
    }
    ticket.markDelivered();
    ticket.noteStatus(response.status);
    /* …the rest of the original body. Where it reads the response text, add
       ticket.addBytes({ in: Buffer.byteLength(text) }) right after reading it… */
  });
}

module.exports = { buildMultipartBody, postMultipart };
```

Fill in every `/* … */` from the moved source. They are the original lines and add no new behaviour.

- [ ] **Step 4: Rewire `ipcHandlers.js` and the provider modules**

1. Delete the moved functions (`:200-256`). Add:

   ```js
   const { buildMultipartBody, postMultipart } = require("./sttTransport");
   const { gatedNetFetch } = require("./privacy/gatedFetch");
   ```

2. At `:5075`, replace:

   ```js
       const proxyFetch = (url, init = {}) => net.fetch(url, { ...init, useSessionCookies: false });
   ```

   with:

   ```js
       // Sealed mode: every proxy, retry and token request goes through the gate.
       const proxyFetch = (url, init = {}) => gatedNetFetch(url, init);
   ```

   Where the payload is user content, call `gatedNetFetch` directly with a payload label:
   - the retry uploads at `:5122` and `:5270`, and the xAI and Mistral proxies at `:3737` and `:3773`: `gatedNetFetch(url, init, { payload: "audio" })`;
   - the Anthropic proxy at `:4483`: `gatedNetFetch(url, init, { payload: "text" })`.

   Token requests keep `proxyFetch`, whose payload stays `"metadata"`.

3. Wrap these handlers in a task context. The shape is the same for each; only the task differs:

   ```js
   ipcMain.handle("retry-transcription", (event, ...args) =>
     egress.withTask("dictationStt", () => retryTranscription(event, ...args))
   );
   ```

   Rename each existing inline handler to a local `async function` (here `retryTranscription`) defined just above its registration, with its body unchanged.

   | Channel | Line | Task |
   |---|---|---|
   | `transcribe-audio-file-byok` | `:7963` | `args?.audioBuffer ? "dictationStt" : "uploadStt"` (the first argument is the request object) |
   | `retry-transcription` | `:5083` | `"dictationStt"` |
   | `proxy-xai-transcription`, `proxy-mistral-transcription` | `:3715`, `:3752` | `"dictationStt"` |
   | `proxy-corti-transcription`, `proxy-tinfoil-transcription`, `proxy-gemini-transcription` | `:3806`, `:3832`, `:3848` | `"dictationStt"` |
   | `process-anthropic-reasoning` | `:4440` | `"dictationCleanup"` |

   In `transcribe-audio-file-byok`, also make these changes:
   - add `correlationId` to the destructured request (`:7967-7985`);
   - wrap the provider dispatch, from the first `if (route.transport === "proxied" && route.provider === "corti")` (`:8110`) through the multipart `postMultipart(...)` (`:8241`), in `await egress.withContext({ correlationId: correlationId ?? requestId, provider: route.provider }, async () => { … })`. The Corti (`:8116`), Tinfoil (`:8130`) and Gemini (`:8145`) branches then announce the session and the provider, without new parameters;
   - also pass `correlationId: correlationId ?? requestId, provider: route.provider` explicitly in the options of both `postMultipart` calls (`:8089-8095`, `:8241`), next to `signal: job.signal`. Without the provider, a named provider would be announced as `host:api.openai.com`, the encoding reserved for the user's own server.

   The handler's `catch` (`:8298-8305`) already returns `{ success: false, error, code, messageKey }`. A `SealedModeError` therefore reaches the renderer with `code: "SEALED_MODE"` and the `messageKey` for its phase.

4. In `geminiTranscription.js:69` and `cortiTranscription.js:7`, replace `net.fetch(url, init)` with `gatedNetFetch(url, init, { payload: "audio" })`. In `cortiAuth.js:39`, replace it with `gatedNetFetch(url, init)`, since a token request is metadata. Add `const { gatedNetFetch } = require("./privacy/gatedFetch");` to each file. The task comes from the handler's `withTask` context, and the ticket stays open until the caller has read the response body (Task 8, `guardResponse`).

5. In `tinfoilTranscription.js`, wrap everything from the `tinfoilSecureFetch(` call through the line that reads its response body:

   ```js
   const egress = require("./privacy/egressGate");
   // …
   return egress.guard({ target: "https://inference.tinfoil.sh", provider: "tinfoil", payload: "audio" }, async (ticket) => {
     ticket.markDispatched();
     const response = await tinfoilSecureFetch(/* …existing arguments, with */ { /* …existing init…, */ signal: AbortSignal.any([/* existing signal, if any */ ticket.signal]) });
     /* …existing status check and response read, unchanged… */
   });
   ```

   Keep the existing arguments, and add `ticket.signal` to the signal the call already uses.

6. Add `src/helpers/sttTransport.js` to the `egress-sites` block.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- test/helpers/sttTransportSealed.test.js test/helpers/egressInventory.test.js test/services/fileTranscriptionCustomEndpoint.test.js test/services/transcriptionBaseUrl.test.js`
Expected: PASS. The existing transcription suites are unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/helpers/sttTransport.js src/helpers/ipcHandlers.js src/helpers/geminiTranscription.js src/helpers/cortiAuth.js src/helpers/cortiTranscription.js src/helpers/tinfoilTranscription.js docs/security/sealed-mode-threat-model.md test/helpers/sttTransportSealed.test.js
git commit -m "feat(privacy): gate batch, retry and proxy speech requests"
```

---

### Task 9a: Gate realtime speech, including warm connections (N9, N10)

**Files:**
- Modify:
  - `src/helpers/sttTransport.js`. Add `realtimeEndpoint` and `connectRealtime`.
  - `src/helpers/ipcHandlers.js`:
    - Route every realtime warmup and start through `connectRealtime`: `connectDictationStreaming` `:7024` (used by `dictation-realtime-warmup` `:7723` and `-start` `:7733`), and the provider handlers around `:8440` (`assemblyai-streaming-warmup`), `:8472` (`assemblyai-streaming-start`), `:8605+` (Deepgram), `:8819`/`:8839` (Gemini), `:8956+` (Corti), and the meeting paths `:5846` and `:6022`.
    - In each audio-send handler, mark the *specific* streaming session dispatched, after it has actually forwarded audio.
- Test: `test/helpers/realtimeSealed.test.js`

**Interfaces:**
- Consumes `egressGate.authorize`, `runWithTicket` and `Ticket.markDispatched` (Task 5), and the socket metering in `egressBackstop` (Task 6).
- Produces:
  - `realtimeEndpoint(provider: string, options?: { environment?: string }): string`.
  - `connectRealtime({ task, provider, options, correlationId?, owner }, connect: () => Promise<T>): Promise<T>`. It authorizes a `meter: "socket"`, `payload: "audio"` ticket and runs `connect` inside it, so the WebSocket created there attaches to the ticket.
    - `owner()` returns the streaming instance after `connect`. When `connect` opened a socket, the ticket is stored on that instance under `REALTIME_TICKET`.
    - If `connect` opened no socket (a warm connection was reused, or the stream was already connected), the redundant ticket is discarded. The instance keeps the ticket that opened its socket, which settles when that socket closes, and that ticket adopts this recording's correlation id if it has none.
    - On failure, the ticket settles and the error (or the sealing reason) is rethrown.
  - `markRealtimeDispatched(instance, correlationId)`. It marks the instance's own ticket `dispatched`, and only that ticket. Call it after `sendAudio` has forwarded a frame on a connected instance.
  - `REALTIME_TICKET` (a `Symbol`).
- Tasks: `noteRecordingStt` for the meeting paths, `dictationStt` for everything else.
- A realtime session is marked `dispatched` at the first audio frame it forwards, not at connect. A warmed but unused socket, or a different session of the same task, never counts as "the provider may have received audio".

- [ ] **Step 1: Write the failing test**

Create `test/helpers/realtimeSealed.test.js`:

```js
const assert = require("node:assert/strict");
const net = require("node:net");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return { app: { getPath: () => process.cwd(), isReady: () => false }, net: { fetch: async () => { throw new Error("network"); } } };
  return originalLoad.call(this, request, parent, isMain);
};
test.after(() => { Module._load = originalLoad; });

const gate = require("../../src/helpers/privacy/egressGate");
const backstop = require("../../src/helpers/privacy/egressBackstop");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");
const stt = require("../../src/helpers/sttTransport");
const { REALTIME_TOKEN_PROVIDERS } = require("../../src/helpers/realtimeTokenProviders");

backstop.installNodeBackstop();
const flags = { sealed: false };
let recorder;
test.beforeEach(() => {
  flags.sealed = false;
  recorder = new FlightRecorder({ now: () => 1 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now: () => 1 });
});

const toLoopback = (_h, o, cb) => (o && o.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4));
const once = (e, n) => new Promise((r) => e.once(n, r));
async function server(t) {
  const s = net.createServer((socket) => socket.resume());
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  t.after(() => s.close());
  return s.address().port;
}

test("sealed: a realtime connect is refused before the socket or token request", async () => {
  flags.sealed = true;
  let connected = false;
  await assert.rejects(
    stt.connectRealtime({ task: "dictationStt", provider: "openai-realtime" }, async () => { connected = true; }),
    (e) => sealedPhaseOf(e) === "refused"
  );
  assert.equal(connected, false);
  assert.equal(recorder.list()[0].task, "dictationStt");
});

test("warmup then reuse: the reused start leaves no orphan ticket", async (t) => {
  const port = await server(t);
  const instance = { isConnected: true };
  let warmSocket;
  await stt.connectRealtime({ task: "dictationStt", provider: "assemblyai-realtime", owner: () => instance }, async () => {
    warmSocket = net.connect({ host: "streaming.assemblyai.com", port, lookup: toLoopback });
    await once(warmSocket, "connect");
  });
  assert.equal(gate.activeRemoteCount(), 1, "the warm socket's ticket");
  const warmTicket = instance[stt.REALTIME_TICKET];
  await stt.connectRealtime({ task: "dictationStt", provider: "assemblyai-realtime", owner: () => instance, correlationId: "rec-7" }, async () => {
    // AssemblyAiStreaming.connect() adopts the warm socket and opens nothing (assemblyAiStreaming.js:394-398).
  });
  assert.equal(gate.activeRemoteCount(), 1, "the reuse ticket was discarded");
  assert.equal(instance[stt.REALTIME_TICKET], warmTicket, "the instance keeps the ticket that owns its socket");
  assert.equal(warmTicket.correlationId, "rec-7", "and it adopts this recording's id");
  warmSocket.end();
  await once(warmSocket, "close");
  assert.equal(gate.activeRemoteCount(), 0);
  assert.equal(recorder.list().length, 1);
});

test("only the session that forwarded audio is dispatched, with its recording's id", async (t) => {
  const port = await server(t);
  const dispatched = [];
  gate.events.on("dispatched", (n) => dispatched.push(n));
  const active = { isConnected: true };
  const idle = { isConnected: true };
  const sockets = [];
  for (const instance of [active, idle]) {
    await stt.connectRealtime({ task: "dictationStt", provider: "openai-realtime", owner: () => instance }, async () => {
      const socket = net.connect({ host: "api.openai.com", port, lookup: toLoopback });
      sockets.push(socket);
      await once(socket, "connect");
    });
  }
  assert.deepEqual(dispatched, [], "a warm or idle socket is not dispatch");
  stt.markRealtimeDispatched(active, "rec-42");
  stt.markRealtimeDispatched(active, "rec-42");
  assert.deepEqual(dispatched.map((n) => [n.ticketId, n.payload, n.correlationId, n.targetId]), [
    [active[stt.REALTIME_TICKET].id, "audio", "rec-42", "openai"],
  ]);
  for (const socket of sockets) socket.destroy();
});

test("sealing closes an open realtime session as interrupted", async (t) => {
  const port = await server(t);
  let socket;
  await stt.connectRealtime({ task: "noteRecordingStt", provider: "deepgram-realtime" }, async () => {
    socket = net.connect({ host: "api.deepgram.com", port, lookup: toLoopback });
    await once(socket, "connect");
  });
  const closed = once(socket, "close");
  flags.sealed = true;
  gate.abortAllRemote();
  await closed;
  assert.equal(gate.activeRemoteCount(), 0);
  assert.deepEqual([recorder.list()[0].task, recorder.list()[0].outcome, recorder.list()[0].errorClass], ["noteRecordingStt", "cancelled", "SEALED_MODE"]);
});

test("every realtime provider has a known endpoint", () => {
  for (const provider of Object.keys(REALTIME_TOKEN_PROVIDERS)) {
    assert.doesNotMatch(stt.realtimeEndpoint(provider), /unknown-provider/, provider);
  }
  assert.match(stt.realtimeEndpoint("corti-realtime", { environment: "us" }), /api\.us\.corti\.app/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/helpers/realtimeSealed.test.js`
Expected: FAIL. `stt.connectRealtime` is not a function.

- [ ] **Step 3: Implement**

Append to `src/helpers/sttTransport.js`, and export the two new functions:

```js
// Keys match REALTIME_TOKEN_PROVIDERS (realtimeTokenProviders.js:13-40). Check
// each host against the wss:// constant in that provider's streaming class
// (grep -n "wss://" src/helpers/*Streaming.js); the label only matters for the
// ledger, since every non-loopback target is refused while sealed.
const REALTIME_ENDPOINTS = {
  "openai-realtime": () => "wss://api.openai.com/v1/realtime",
  "assemblyai-realtime": () => "wss://streaming.assemblyai.com/v3/ws",
  "deepgram-realtime": () => "wss://api.deepgram.com/v1/listen",
  "gemini-realtime": () => "wss://generativelanguage.googleapis.com",
  "tinfoil-realtime": () => "wss://inference.tinfoil.sh",
  "corti-realtime": (options) => `wss://api.${options?.environment || "eu"}.corti.app`,
};

function realtimeEndpoint(provider, options) {
  return REALTIME_ENDPOINTS[provider]?.(options) ?? "wss://unknown-provider.invalid";
}

// A realtime session is one long-lived socket. Its ticket is socket-metered:
// it settles with wire bytes when the socket closes, or at once when sealing
// aborts it.
const REALTIME_TICKET = Symbol("loqui.realtimeTicket");
// Provider ids for the ledger and for Plan 04's target-id encoding.
const REALTIME_PROVIDER_IDS = {
  "openai-realtime": "openai",
  "assemblyai-realtime": "assemblyai",
  "deepgram-realtime": "deepgram",
  "gemini-realtime": "gemini",
  "tinfoil-realtime": "tinfoil",
  "corti-realtime": "corti",
};

async function connectRealtime({ task, provider, options, correlationId = null, owner = () => null }, connect) {
  return egress.withTask(task, async () => {
    const ticket = egress.authorize({
      target: realtimeEndpoint(provider, options),
      provider: REALTIME_PROVIDER_IDS[provider] ?? null,
      meter: "socket",
      payload: "audio",
      correlationId,
    });
    try {
      const result = await egress.runWithTicket(ticket, connect);
      const instance = owner();
      if (ticket.socketCount() > 0) {
        if (instance) instance[REALTIME_TICKET] = ticket;
      } else if (!ticket.settled) {
        // A reused warm connection (or an already-open one) belongs to the
        // ticket that opened it; this one has nothing to own.
        ticket.discard();
        const existing = instance?.[REALTIME_TICKET];
        if (existing && existing.correlationId == null) existing.correlationId = correlationId;
      }
      return result;
    } catch (error) {
      const reason = ticket.signal.aborted ? ticket.signal.reason : null;
      ticket.settle({ outcome: reason ? "cancelled" : "error", errorClass: error?.code || error?.name || "Error" });
      throw reason ?? error;
    }
  });
}

// Called by the audio-send handlers after a frame was forwarded on this
// instance: only its own ticket is marked, never other sessions of the task.
function markRealtimeDispatched(instance, correlationId) {
  const ticket = instance?.[REALTIME_TICKET];
  if (!ticket || ticket.settled || !instance.isConnected) return;
  if (ticket.correlationId == null && correlationId) ticket.correlationId = correlationId;
  ticket.markDispatched();
}

module.exports = { buildMultipartBody, postMultipart, realtimeEndpoint, connectRealtime, markRealtimeDispatched, REALTIME_TICKET };
```

- [ ] **Step 4: Route every realtime warmup and start through it**

In `src/helpers/ipcHandlers.js`, import `connectRealtime` and `markRealtimeDispatched` from `./sttTransport`.

1. In `connectDictationStreaming` (`:7024`), wrap everything from the token request (`fetchRealtimeToken(…)`, `:7059`) through the `connect(...)` call of the new streaming instance (`:7051` onward):

   ```js
       return connectRealtime(
         {
           task: "dictationStt",
           provider: options.provider,
           options,
           correlationId: options.correlationId ?? null,
           owner: () => this._dictationStreaming,
         },
         async () => {
           /* …existing token fetch, `new OpenAIRealtimeStreaming()` (or the Tinfoil subclass) and connect, unchanged… */
         }
       );
   ```

   In `dictation-realtime-start` (`:7733`), store `this._dictationCorrelationId = options.correlationId ?? null;`.

2. Wrap the same span (from token fetch through `warmup(...)` or `connect(...)`) in every other realtime handler. Pass `owner: () => this.<thatHandlersInstance>`, for example `this.assemblyAiStreaming`:

   | Handler | Lines | Task | `provider` |
   |---|---|---|---|
   | `assemblyai-streaming-warmup`, `assemblyai-streaming-start` | `:8440`, `:8472` | `dictationStt` | `assemblyai-realtime` |
   | Deepgram warmup and start | `:8605`, `:8615`, `:8669` | `dictationStt` | `deepgram-realtime` |
   | Gemini start | `:8819`, `:8839` | `dictationStt` | `gemini-realtime` |
   | Corti warmup and start | `:8956`, `:8959`, `:8981` | `dictationStt` | `corti-realtime` |
   | Meeting transcription start | `:5846`, `:6022` | `noteRecordingStt` | the provider id that path already resolves |

   List them with `grep -n '"[a-z-]*-\(streaming\|realtime\)-\(warmup\|start\)"\|meeting-transcription-start' src/helpers/ipcHandlers.js`. Task 12 enumerates the same channels and fails for any one not refused while sealed.

3. In every audio-send handler, mark *that* instance dispatched after it forwarded the frame. The handlers are `dictation-realtime-send` (`:7744`), the provider `*-streaming-send` handlers, and the meeting audio sends. List them with `grep -n '\(streaming\|realtime\)-send\|meeting-transcription-.*audio' src/helpers/ipcHandlers.js`. For example:

   ```js
     ipcMain.on("dictation-realtime-send", (_event, buffer) => {
       const streaming = this._dictationStreaming;
       if (!streaming?.isConnected) return;
       streaming.sendAudio(Buffer.from(buffer));
       markRealtimeDispatched(streaming, this._dictationCorrelationId);
     });
   ```

   Keep each handler's existing early-return behaviour. If it already skips when not connected, reuse that check. Import `markRealtimeDispatched` from `./sttTransport`. Marking is idempotent per ticket.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- test/helpers/realtimeSealed.test.js test/helpers/sttTransportSealed.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/helpers/sttTransport.js src/helpers/ipcHandlers.js test/helpers/realtimeSealed.test.js
git commit -m "feat(privacy): gate realtime speech and account for warm connections"
```

---

### Task 10: Gate model downloads, URL import, yt-dlp and updates (N12–N16)

**Files:**
- Modify:
  - `src/helpers/downloadUtils.js`:
    - Gate `downloadFile` (`:267`) and `fetchJson` (`:250`).
    - Count received bytes per chunk in `downloadAttempt`'s `data` handler (`:182-190`).
    - Keep the partial file when sealing interrupts a download (`:331-333`).
  - `src/helpers/gpuBinaryManager.js:110, 184`. Tag runtime downloads.
  - `src/helpers/urlAudioDownloader.js`:
    - Gate `download` (`:1525`).
    - In `maybeUpdateYtDlp` (`:390-492`), give the self-update its own opaque ledger session that sealing can kill.
    - Export `ytDlpControl`.
  - `src/helpers/updateManager.js`. Inject `sealed` and `authorize`; gate `check()`; add `pauseForSeal()` and `resumeAfterSeal()`.
  - `src/helpers/updateIPC.js:29, 85-98`. Pass `sealed` through.
  - `main.js:460-470`. Pass `sealed: () => privacy.state.isSealed()` to `attachUpdateIPC`.
  - `src/types/updates.ts`. Add `sealed?: boolean` to `UpdateStatus`.
- Test: `test/helpers/downloadsSealed.test.js`, `test/helpers/urlAudioDownloaderSealed.test.js` and `test/helpers/updateManagerSealed.test.js`

**Interfaces:**
- Produces:
  - `downloadFile(url, destPath, { …existing, egressTask?: "modelDownload" | "runtimeDownload" })`. `bytesIn` counts only the bytes received in this run, so a resumed download does not count the earlier part. A sealed interruption keeps `<dest>.tmp`, so the next attempt resumes with `Range`.
  - `fetchJson(url, { …existing, egressTask? })`.
  - `ytDlpControl = { alive(): boolean, stop(options?): Promise<void> }`, a view over the child registry (Task 6a). `alive()` is true until the OS has reported the exit of every yt-dlp child (a self-update, or a download and its process group). `stop()` is `childRegistry.stopAll({ kinds: ["yt-dlp"] })`: SIGTERM, then SIGKILL, then a rejection with `CHILD_STOP_FAILED` if any is still alive. Sealing aborts their tickets, and the barrier stops them through the registry.
  - The `UpdateManager` constructor accepts `sealed?: () => boolean` and `authorize?: (meta) => Ticket`. It gains `pauseForSeal(): void` and `resumeAfterSeal(): void`, both of which always publish status. `status()` adds `sealed: boolean`.
  - `attachUpdateIPC({ …, sealed })`.
- yt-dlp in the ledger (owner decision 2, 2026-10-15). A yt-dlp process does its own networking.
  - Its YouTube imports are recorded as `urlImport` rows with `opaque: true`.
  - Its self-update is a `runtimeDownload` opaque session to `github.com`.
  - Direct (non-YouTube) URL imports go through main's own transports, and stay ordinary rows.

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/downloadsSealed.test.js`:

```js
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");

// Fake Electron net.request. `respond(req)` decides what the server does.
const requests = [];
let respond = null;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron")
    return {
      app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd(), isReady: () => false },
      net: {
        request: (options) => {
          const req = Object.assign(new EventEmitter(), {
            headers: {},
            aborted: false,
            setHeader(name, value) { req.headers[name.toLowerCase()] = value; },
            end() { respond?.(req); },
            abort() { req.aborted = true; },
          });
          requests.push({ options, req });
          return req;
        },
        fetch: async (url) => { requests.push({ url }); return new Response("{}", { status: 200 }); },
      },
    };
  return originalLoad.call(this, request, parent, isMain);
};
test.after(() => { Module._load = originalLoad; });

const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError, sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");
const { downloadFile, fetchJson, createDownloadSignal } = require("../../src/helpers/downloadUtils");
const urlAudio = require("../../src/helpers/urlAudioDownloader");

const flags = { sealed: false };
let recorder;
test.beforeEach(() => {
  flags.sealed = false;
  requests.length = 0;
  respond = null;
  recorder = new FlightRecorder({ now: () => 1 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now: () => 1 });
});

const tmpDest = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "loqui-dl-")), "model.bin");
const serve = ({ status, headers, chunks, stall = false }) => (req) => {
  const response = Object.assign(new PassThrough(), { statusCode: status, headers });
  req.emit("response", response);
  for (const chunk of chunks) response.write(chunk);
  if (!stall) response.end();
};

test("sealed: a model download is refused before net.request", async () => {
  flags.sealed = true;
  await assert.rejects(downloadFile("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin", tmpDest()), (e) => sealedPhaseOf(e) === "refused");
  assert.deepEqual(requests, []);
  assert.deepEqual([recorder.list()[0].task, recorder.list()[0].host], ["modelDownload", "huggingface.co"]);
});

test("sealed: runtime release lookups are tagged runtimeDownload", async () => {
  flags.sealed = true;
  await assert.rejects(fetchJson("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest", { egressTask: "runtimeDownload" }), isSealedModeError);
  assert.equal(recorder.list()[0].task, "runtimeDownload");
});

test("sealing keeps the partial file; the next run resumes and counts only new bytes", async () => {
  const dest = tmpDest();
  const { signal } = createDownloadSignal();
  respond = serve({ status: 200, headers: { "content-length": "8" }, chunks: [Buffer.from("abcd")], stall: true });
  const first = downloadFile("https://huggingface.co/x/model.bin", dest, { signal, maxRetries: 0 });
  await new Promise((r) => setTimeout(r, 30)); // let the first chunk reach the temp file
  flags.sealed = true;
  gate.abortAllRemote();
  await assert.rejects(first, (e) => sealedPhaseOf(e) === "interrupted");
  assert.equal(fs.readFileSync(`${dest}.tmp`, "utf8"), "abcd", "partial file kept for resume");
  assert.equal(recorder.list()[0].outcome, "cancelled");

  flags.sealed = false;
  respond = serve({ status: 206, headers: { "content-range": "bytes 4-7/8", "content-length": "4" }, chunks: [Buffer.from("efgh")] });
  await downloadFile("https://huggingface.co/x/model.bin", dest, { maxRetries: 0 });
  assert.equal(requests.at(-1).req.headers.range, "bytes=4-");
  assert.equal(fs.readFileSync(dest, "utf8"), "abcdefgh");
  const resumed = recorder.list()[0];
  assert.deepEqual([resumed.outcome, resumed.bytesIn, resumed.bytesOut], ["ok", 4, null]);
});

test("an ordinary user cancel still deletes the partial file", async () => {
  const dest = tmpDest();
  const { signal, abort } = createDownloadSignal();
  respond = serve({ status: 200, headers: { "content-length": "8" }, chunks: [Buffer.from("abcd")], stall: true });
  const pending = downloadFile("https://huggingface.co/x/model.bin", dest, { signal, maxRetries: 0 });
  await new Promise((r) => setTimeout(r, 30));
  abort();
  await assert.rejects(pending);
  assert.equal(fs.existsSync(`${dest}.tmp`), false);
});

test("sealed: URL import is refused", async () => {
  flags.sealed = true;
  await assert.rejects(urlAudio.download("https://example.com/talk.mp3", () => {}, new AbortController().signal), isSealedModeError);
  assert.equal(recorder.list()[0].task, "urlImport");
});
```

If `downloadAttempt`'s abort path (`downloadUtils.js:114-120`, `signal.onAbort`) needs another fake method (for example `destroy` instead of `abort`), adapt the fake request. Keep the assertions unchanged.

Create `test/helpers/urlAudioDownloaderSealed.test.js`. It mirrors the self-update fixtures in `test/helpers/urlAudioDownloader.test.js:402-450`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("child_process");
const { EventEmitter } = require("events");
const fs = require("fs");
const os = require("os");
const path = require("path");
const YT_DLP_TEST_CACHE_DIR = path.join(os.tmpdir(), `loqui-ytdlp-sealed-${process.pid}`);
process.env.LOQUI_YTDLP_CACHE_DIR = YT_DLP_TEST_CACHE_DIR;
const downloader = require("../../src/helpers/urlAudioDownloader");
const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");

function ensureCacheBinary() {
  const name = `yt-dlp-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
  fs.mkdirSync(YT_DLP_TEST_CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(YT_DLP_TEST_CACHE_DIR, name), "#!/bin/sh\n");
  try { fs.chmodSync(path.join(YT_DLP_TEST_CACHE_DIR, name), 0o755); } catch {}
  downloader._recordCacheChecksum();
  return () => fs.rmSync(YT_DLP_TEST_CACHE_DIR, { recursive: true, force: true });
}
// pid 4242 is fake: no real process, group or descendant is ever probed or signalled.
const FAKE_SYSTEM = { listProcesses: () => [], pidAlive: () => false, groupAlive: () => false, killGroup: () => {} };
function stuckChild() {
  const child = new EventEmitter();
  child.pid = 4242; // a running process has a pid; the registry tracks it until "exit"
  child.signals = [];
  child.kill = (signal) => { child.signals.push(signal); return true; };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

test("sealing kills an in-flight yt-dlp self-update and records an opaque session", async (t) => {
  const flags = { sealed: false };
  const recorder = new FlightRecorder({ now: () => 1 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now: () => 1 });
  require("../../src/helpers/privacy/childRegistry")._setSystemForTests(FAKE_SYSTEM);
  const cleanup = ensureCacheBinary();
  const origSpawn = childProcess.spawn;
  let child;
  childProcess.spawn = () => (child = stuckChild());
  t.after(() => { childProcess.spawn = origSpawn; cleanup(); gate._resetForTests(); });

  const update = downloader.maybeUpdateYtDlp({ force: true, timeoutMs: 60000 });
  assert.equal(downloader.ytDlpControl.alive(), true);
  flags.sealed = true;
  gate.abortAllRemote();
  await update; // the caller's promise resolves; the process is another matter
  assert.deepEqual(child.signals, ["SIGKILL"]);
  assert.equal(downloader.ytDlpControl.alive(), true, "a kill signal is not an exit");
  assert.equal(recorder.list().length, 0, "the session is not settled before the exit");
  await assert.rejects(downloader.ytDlpControl.stop({ termGraceMs: 20, killGraceMs: 20 }), (e) => e.code === "CHILD_STOP_FAILED");
  child.emit("exit", null, "SIGKILL");
  assert.equal(downloader.ytDlpControl.alive(), false);
  const [row] = recorder.list();
  assert.deepEqual([row.task, row.host, row.opaque, row.bytesIn, row.outcome], ["runtimeDownload", "github.com", true, null, "cancelled"]);
});

test("a self-update that times out is still running until it exits, and is recorded then", async (t) => {
  const recorder = new FlightRecorder({ now: () => 1 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => false, recorder, now: () => 1 });
  require("../../src/helpers/privacy/childRegistry")._setSystemForTests(FAKE_SYSTEM);
  const cleanup = ensureCacheBinary();
  const origSpawn = childProcess.spawn;
  let child;
  childProcess.spawn = () => (child = stuckChild());
  t.after(() => { childProcess.spawn = origSpawn; cleanup(); gate._resetForTests(); require("../../src/helpers/privacy/childRegistry")._resetForTests(); });
  await downloader.maybeUpdateYtDlp({ force: true, timeoutMs: 20 }); // the kill timer fires
  assert.ok(child.signals.length > 0, "the timeout signalled it");
  assert.equal(downloader.ytDlpControl.alive(), true, "a timed-out child is not a stopped one");
  assert.equal(recorder.list().length, 0);
  child.emit("exit", null, "SIGKILL");
  assert.equal(downloader.ytDlpControl.alive(), false);
  assert.equal(recorder.list()[0].outcome, "error");
});

test("a self-update that fails to spawn leaves nothing running and settles its session", async (t) => {
  const recorder = new FlightRecorder({ now: () => 1 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => false, recorder, now: () => 1 });
  const cleanup = ensureCacheBinary();
  const origSpawn = childProcess.spawn;
  childProcess.spawn = () => { throw Object.assign(new Error("spawn EACCES"), { code: "EACCES" }); };
  t.after(() => { childProcess.spawn = origSpawn; cleanup(); gate._resetForTests(); });
  await downloader.maybeUpdateYtDlp({ force: true });
  assert.equal(downloader.ytDlpControl.alive(), false);
  assert.deepEqual(recorder.list().map((r) => [r.task, r.outcome]), [["runtimeDownload", "error"]]);
});

test("an asynchronous spawn failure settles the session; an error after start does not", async (t) => {
  const recorder = new FlightRecorder({ now: () => 1 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => false, recorder, now: () => 1 });
  require("../../src/helpers/privacy/childRegistry")._setSystemForTests(FAKE_SYSTEM);
  const cleanup = ensureCacheBinary();
  const origSpawn = childProcess.spawn;
  let child;
  childProcess.spawn = () => (child = stuckChild());
  t.after(() => { childProcess.spawn = origSpawn; cleanup(); gate._resetForTests(); require("../../src/helpers/privacy/childRegistry")._resetForTests(); });

  // 1. EACCES after spawn() returned: no pid, "error", then "close" without "exit".
  const failing = downloader.maybeUpdateYtDlp({ force: true, timeoutMs: 60000 });
  delete child.pid;
  child.emit("error", Object.assign(new Error("spawn EACCES"), { code: "EACCES" }));
  child.emit("close", -13, null);
  await failing;
  assert.equal(downloader.ytDlpControl.alive(), false);
  assert.equal(gate.activeRemoteCount(), 0, "no immortal ticket");
  assert.deepEqual(recorder.list().map((r) => r.outcome), ["error"]);

  // 2. An error after a successful start (pid 4242): still running until it exits.
  const running = downloader.maybeUpdateYtDlp({ force: true, timeoutMs: 60000 });
  child.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
  assert.equal(downloader.ytDlpControl.alive(), true);
  assert.equal(gate.activeRemoteCount(), 1);
  child.emit("exit", 1, null);
  await running;
  assert.equal(gate.activeRemoteCount(), 0);
});

test("while sealed, a self-update is not even attempted", async (t) => {
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => true });
  const cleanup = ensureCacheBinary();
  const origSpawn = childProcess.spawn;
  let spawned = 0;
  childProcess.spawn = () => { spawned++; return stuckChild(); };
  t.after(() => { childProcess.spawn = origSpawn; cleanup(); gate._resetForTests(); });
  await downloader.maybeUpdateYtDlp({ force: true });
  assert.equal(spawned, 0);
});
```

Create `test/helpers/updateManagerSealed.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError } = require("../../src/helpers/privacy/egressPolicy");
const { UpdateManager, DAY } = require("../../src/helpers/updateManager");

function harness(t, { sealed = false, latest = "1.0.0", channel = "stable" } = {}) {
  const flags = { sealed };
  const recorder = new FlightRecorder({ now: () => 1 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now: () => 1 });
  t.after(() => gate._resetForTests());
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-upd-"));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  fs.writeFileSync(path.join(profile, "updates.json"), JSON.stringify({ enabled: true, onboarded: true, lastCheck: 0, channel }));
  const calls = { check: 0, download: 0 };
  const updater = {
    on() {},
    async checkForUpdates() { calls.check++; return { updateInfo: { version: latest } }; },
    downloadUpdate(token) {
      calls.download++;
      return new Promise((_resolve, reject) => token.onCancel(() => reject(new Error("cancelled"))));
    },
  };
  const manager = new UpdateManager({
    updater, profile, version: "1.0.0", supported: true, packaged: true,
    now: () => 10 * DAY, sealed: () => flags.sealed, authorize: gate.authorize,
  });
  const published = [];
  manager.on("status", (s) => published.push(s));
  t.after(() => manager.dispose());
  return { flags, recorder, calls, manager, published };
}

test("automatic check is skipped while sealed and lastCheck is unchanged", async (t) => {
  const h = harness(t, { sealed: true });
  const status = await h.manager.check(false);
  assert.equal(h.calls.check, 0);
  assert.equal(h.manager.prefs.lastCheck, 0);
  assert.equal(status.sealed, true);
  assert.equal(h.recorder.list().length, 0, "a skipped background check is not an attempt");
});

test("a manual check while sealed is refused and recorded", async (t) => {
  const h = harness(t, { sealed: true });
  await assert.rejects(h.manager.check(true), isSealedModeError);
  assert.equal(h.calls.check, 0);
  assert.deepEqual([h.recorder.list()[0].task, h.recorder.list()[0].outcome], ["appUpdate", "blocked"]);
});

test("an unsealed check is attributed to appUpdate and its ticket always settles", async (t) => {
  const h = harness(t);
  await h.manager.check(true);
  assert.equal(h.calls.check, 1);
  assert.deepEqual([h.recorder.list()[0].task, h.recorder.list()[0].outcome], ["appUpdate", "ok"]);
  assert.equal(gate.activeRemoteCount(), 0);
});

test("pauseForSeal cancels a running download without counting a failure", async (t) => {
  const h = harness(t, { latest: "1.1.0" });
  // The automatic check downloads when automatic updates are on, before and
  // after Plan 02 (D13 changes only manual checks with them off).
  const pending = h.manager.check(false);
  await new Promise((r) => setImmediate(r));
  assert.equal(h.manager.state.phase, "downloading");
  h.flags.sealed = true;
  h.manager.pauseForSeal();
  const status = await pending;
  assert.equal(status.phase, "idle");
  assert.equal(h.manager.failures, 0);
  assert.equal(h.recorder.list()[0].outcome, "cancelled");
  assert.equal(gate.activeRemoteCount(), 0);
});

test("seal and unseal always publish status, even when idle", (t) => {
  const h = harness(t);
  h.flags.sealed = true;
  h.manager.pauseForSeal();
  assert.equal(h.published.at(-1).sealed, true);
  h.flags.sealed = false;
  h.manager.resumeAfterSeal();
  assert.equal(h.published.at(-1).sealed, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/helpers/downloadsSealed.test.js test/helpers/urlAudioDownloaderSealed.test.js test/helpers/updateManagerSealed.test.js`
Expected: FAIL. Downloads reach `net.request`, `ytDlpControl` is undefined, and `UpdateManager` ignores `sealed`.

- [ ] **Step 3: Gate `downloadUtils.js`**

1. Add `const egress = require("./privacy/egressGate");`.
2. In `downloadAttempt`, add `onBytes` and `extraHeaders` to the destructure at `:63` (`const { onProgress, onBytes, extraHeaders, signal, startOffset = 0, expectedSize = 0 } = options;`). Merge the headers into the request headers at `:71`: `const headers = { "User-Agent": USER_AGENT, ...(extraHeaders || {}) };`. In the `data` handler, directly after `downloadedSize += chunk.length;` (`:187`), add `onBytes?.(chunk.length);`. In `downloadFileUngated`, add `extraHeaders` to the destructure at `:268`, and pass it through in the `downloadAttempt(...)` options at `:307-312`.
3. In the existing `downloadFile` (`:267`):
   - rename it to `downloadFileUngated`;
   - add `onBytes` to its destructure at `:268`;
   - pass `onBytes` in the `downloadAttempt(...)` options at `:307-312`.
   - Change the abort branch at `:331-333` to:

   ```js
         if (error.isAbort) {
           // Sealing interrupts but keeps the partial file so the download can
           // resume with Range later; a user cancel still discards it.
           if (!signal?.preservePartial) await fsPromises.unlink(tempPath).catch(() => {});
           throw error;
         }
   ```

4. Add the gated `downloadFile` above it:

   ```js
   // Every model and runtime download goes through here (threat model N12/N13).
   async function downloadFile(url, destPath, options = {}) {
     const { egressTask = "modelDownload", ...rest } = options;
     return egress.guard({ task: egressTask, target: url }, (ticket) => {
       // downloadAttempt understands createDownloadSignal()'s { aborted, onAbort }.
       const own = rest.signal ? null : createDownloadSignal();
       const signal = rest.signal ?? own.signal;
       ticket.signal.addEventListener(
         "abort",
         () => {
           signal.preservePartial = true;
           if (own) own.abort();
           else {
             signal.aborted = true;
             signal.onAbort?.();
           }
         },
         { once: true }
       );
       ticket.markDispatched();
       // Bytes received in this run only: a resumed download does not recount
       // what an earlier run already fetched. Request bytes (headers) stay unknown.
       // The tag lets the session backstop attribute the request and its
       // redirects to this ticket; it is stripped before the request leaves.
       return downloadFileUngated(url, destPath, {
         ...rest,
         signal,
         extraHeaders: egress.tagHeaders(ticket),
         onBytes: (n) => ticket.addBytes({ in: n }),
       });
     });
   }
   ```

5. In `fetchJson` (`:250`), change the first line to `const { headers, egressTask = "modelDownload", ...init } = options;` and wrap the body. The guard spans the JSON read:

   ```js
     return egress.guard({ task: egressTask, target: url }, async (ticket) => {
       const response = await egress.meteredFetch(ticket, (u, i) => net.fetch(u, i))(url, {
         method: "GET",
         useSessionCookies: false,
         ...init,
         signal: init.signal ? AbortSignal.any([init.signal, ticket.signal]) : ticket.signal,
         headers: { "User-Agent": USER_AGENT, ...(headers || {}) },
       });
       /* …rest of the existing body (status check, response.json()) unchanged… */
     });
   ```

6. In `gpuBinaryManager.js`:
   - `:110`: `fetchJson(this.config.releaseUrl, { headers: githubReleaseHeaders(), egressTask: "runtimeDownload" })`.
   - `:184`: add `egressTask: "runtimeDownload",` to the `downloadFile` options.

- [ ] **Step 4: Gate URL import and yt-dlp**

In `src/helpers/urlAudioDownloader.js`, add `const egress = require("./privacy/egressGate");`.

1. Replace `download` (`:1525-1534`):

   ```js
   async function download(url, onProgress, abortSignal) {
     const type = detectUrlType(url);
     // A YouTube import runs yt-dlp, whose own traffic main cannot see.
     return egress.guard({ task: "urlImport", target: url, meter: type === "youtube" ? "opaque" : "body" }, (ticket) => {
       ticket.markDispatched();
       // Sealing aborts the transfer and kills a running yt-dlp child.
       const signal = abortSignal ? AbortSignal.any([abortSignal, ticket.signal]) : ticket.signal;
       debugLogger.log("URL audio download starting", { url, type });
       if (type === "youtube") return downloadYouTube(url, onProgress, signal);
       return downloadDirect(url, onProgress, signal);
     });
   }
   ```

2. In `maybeUpdateYtDlp`, make these changes:
   - At the top of the promise executor (`:391`, before `const stampPath`), add:

     ```js
         // Sealed mode: yt-dlp would contact GitHub itself, out of main's sight.
         if (egress.isSealed()) return resolve();
     ```

   - Directly before `ytDlpUpdateInFlight = true;` (`:421`), open the session. If sealing raced in, give up:

     ```js
         let session;
         try {
           session = egress.authorize({ task: "runtimeDownload", target: "https://github.com/yt-dlp/yt-dlp", meter: "opaque" });
         } catch {
           return resolve();
         }
         // Sealing aborts the session; that kills the child like a caller's abort.
         abortSignal = abortSignal ? AbortSignal.any([abortSignal, session.signal]) : session.signal;
     ```

     `abortSignal` is a destructured parameter, so reassigning it is allowed. The existing abort wiring (`:463-477`) and the `removeEventListener` in `finish` (`:449`) then use the combined signal unchanged.
   - Directly after the successful `child = childProcess.spawn(...)` (`:426`), register the process and settle the session **only on its exit**:

     ```js
           // POSIX: its own process group (see the detached option below);
           // Windows: a tree. Helpers it starts count until they exit too.
           childRegistry.register(child, { kind: "yt-dlp", group: process.platform !== "win32", tree: process.platform === "win32" });
           // Settled exactly once: on exit, or at once if the spawn failed
           // asynchronously (EACCES/ENOENT arrive as "error" with no pid, N2).
           childRegistry.onChildEnd(child, ({ code, failedToStart }) =>
             session.settle({ outcome: failedToStart ? "error" : session.signal.aborted ? "cancelled" : code === 0 ? "ok" : "error" })
           );
     ```

     Add `detached: process.platform !== "win32"` to that spawn's options (`{ windowsHide: true }` at `:426`), so on POSIX the self-update leads its own process group and nothing it starts can outlive the group check. Do not call `child.unref()`: the stdio pipes stay drained as before.

     `finish` keeps its job: it resolves the caller's best-effort promise and clears the throttle flag. It no longer decides whether the process is gone; the registry does.
   - In the spawn-failure catch (`:427-432`), add `session.settle({ outcome: "error" });`. No process exists there.
   - In `runYtDlp`, directly after its `child = childProcess.spawn(...)` (`:629`), add `childRegistry.register(child, { kind: "yt-dlp", group: process.platform !== "win32", tree: process.platform === "win32" });`. That spawn is `detached` on POSIX, so the whole process group must be gone before the registry calls it stopped; its descendants (FFmpeg for post-processing) are in that group. Windows has no process groups, and the existing kill there is `taskkill /T` (`:596-601`), which is a signal, not an exit. So on Windows the registry tracks the tree: every descendant listed at stop time must be gone too (Task 6a).

3. Add the control object next to the state variables (`:42-43`), and export it:

   ```js
   const childRegistry = require("./privacy/childRegistry");
   // Read by tests and diagnostics. Liveness is the OS exit (and, for a
   // download, the whole process group), never a flag or a kill signal.
   const ytDlpControl = {
     alive: () => childRegistry.alive("yt-dlp").length > 0,
     stop: (options) => childRegistry.stopAll({ kinds: ["yt-dlp"], ...options }),
   };
   ```

   The sealing barrier stops these processes through `childRegistry.stopAll()` (Task 7). This object is a convenience over the same records.

- [ ] **Step 5: Gate updates**

In `src/helpers/updateManager.js`:

1. Add `const UPDATE_HOST = "https://api.github.com";`.
2. Add these constructor options after `now = Date.now,` (`:16`):

   ```js
       sealed = () => false,
       authorize = (meta) => require("./privacy/egressGate").authorize(meta),
   ```

   Add `sealed, authorize` to the `Object.assign(this, { … })` at `:19`.
3. In `status()` (`:72-74`), return `{ ...this.state, ...this.prefs, busy: !!this.busy(), supported: this.supported, sealed: !!this.sealed() }`.
4. In `check()`, directly after the existing early-return block (`:125-134`), add:

   ```js
       if (this.sealed()) {
         // Sealed mode: a manual check is refused (and recorded); a scheduled
         // one is skipped without advancing lastCheck, so it runs once unsealed.
         if (manual) this.authorize({ task: "appUpdate", target: UPDATE_HOST });
         return this.status();
       }
   ```

5. Replace `this.running = true;` (`:137`) with:

   ```js
       const ticket = this.authorize({ task: "appUpdate", target: UPDATE_HOST, provider: "github" });
       // electron-updater sends these headers on every request of its own session;
       // the session backstop attributes them to this ticket and strips the tag.
       const previousHeaders = this.updater.requestHeaders;
       this.updater.requestHeaders = { ...(previousHeaders || {}), [EGRESS_TAG_HEADER]: ticket.tag };
       this.running = true;
   ```

   Add `const { EGRESS_TAG_HEADER } = require("./privacy/egressGate");` at the top of the file, and restore the headers in the `finally` (`this.updater.requestHeaders = previousHeaders;`).

   Then:
   - At the start of the `catch` (`:159`), add:

     ```js
         if (this.sealed()) {
           ticket.settle({ outcome: "cancelled", errorClass: "SEALED_MODE" });
           this.publish({ phase: "idle", availableVersion: undefined, progress: undefined });
           return this.status();
         }
         ticket.settle({ outcome: "error", errorClass: "UPDATE_FAILED" });
     ```

   - As the first line of the `finally` (`:166`), add `ticket.settle({ outcome: "ok" });`. `settle` is idempotent, so this records only the paths the `catch` did not, including the early `return` inside the `try` at `:144`. Without it, that early return would leave the ticket active and the attestation could never become true.
6. Add these methods after `restart()`:

   ```js
     // Sealed mode transition hooks. Both always publish, so the Updates panel
     // shows "Paused while Sealed mode is on" (or clears it) even when idle.
     pauseForSeal() {
       this.cancel?.cancel();
       if (["checking", "downloading"].includes(this.state.phase))
         this.publish({ phase: "idle", availableVersion: undefined, progress: undefined });
       else this.emit("status", this.status());
     }
     resumeAfterSeal() {
       this.emit("status", this.status());
     }
   ```

In `src/helpers/updateIPC.js`:
- add `sealed` to the destructure at `:29` (`function attachUpdateIPC({ app, ipcMain, BrowserWindow, updater, busy, activity, teardown, sealed })`);
- pass `sealed,` into the `new UpdateManager({ … })` options (`:85-98`).

In `main.js`, add `sealed: () => privacy.state.isSealed(),` to the `attachUpdateIPC({ … })` call.

In `src/types/updates.ts`, add `sealed?: boolean;` to `UpdateStatus`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- test/helpers/downloadsSealed.test.js test/helpers/urlAudioDownloaderSealed.test.js test/helpers/urlAudioDownloader.test.js test/helpers/updateManagerSealed.test.js`
Expected: PASS. The existing yt-dlp suite still passes, because without sealing the session ticket is invisible to it. Also run the existing update suite if there is one (`ls test/helpers | grep -i update`); it should pass, because `sealed` defaults to `() => false`.

- [ ] **Step 7: Commit**

```bash
git add src/helpers/downloadUtils.js src/helpers/gpuBinaryManager.js src/helpers/urlAudioDownloader.js src/helpers/updateManager.js src/helpers/updateIPC.js src/types/updates.ts main.js test/helpers/downloadsSealed.test.js test/helpers/urlAudioDownloaderSealed.test.js test/helpers/updateManagerSealed.test.js
git commit -m "feat(privacy): gate downloads, URL import, yt-dlp and update checks"
```

---

### Task 11: Gate calendars, their background sync, pending OAuth flows and browser links (N19–N21)

**Files:**
- Create:
  - `src/helpers/privacy/calendarGuard.js`.
- Modify:
  - `src/helpers/googleCalendarOAuth.js:152-160` (`_httpsPost`).
  - `src/helpers/googleCalendarManager.js:357` (`_apiGet`).
  - `src/helpers/microsoftCalendarOAuth.js:155, 168`.
  - `src/helpers/microsoftCalendarManager.js:396-400` (`_apiGet`).
  - `src/helpers/oauthLoopbackFlow.js:33` (`runOAuthLoopbackFlow`) and its `module.exports` (`:130`).
  - `src/helpers/externalUrlOpener.js:35` (`openExternalUrl`) and its `module.exports`.
  - `src/helpers/windowManager.js:1259-1268` (`openExternalUrl` wrapper).
  - `src/helpers/ipcHandlers.js`: `open-external` (`:3539-3550`), `gcal-start-oauth` (`:9164`) and `mcal-start-oauth` (`:9251`).
  - `src/helpers/privacy/privacyBoot.js` (`createSealTransition`, `createConfirmations`; Task 7).
  - `main.js:566-567` (start), `:781-785` (focus) and `:788-794` (wake), and the Task 7 wiring block.
  - `src/locales/*/translation.json`.
- Test: `test/helpers/calendarSealed.test.js`, `test/helpers/externalLinkSealed.test.js`

**Interfaces:**
- Consumes `gatedNetFetch` (Task 8), `egress.assertAllowed` (Task 5) and `SealedModeError` (Task 2).
- Produces:
  - `createCalendarGuard({ isSealed }): { start(managers), onFocus(managers), onWake(managers) }`. Each is a no-op while sealed. `main.js` calls these instead of the managers, so a test can execute the exact code main runs.
  - `cancelAllOAuthFlows(reason: Error): number` and `activeOAuthFlowCount(): number` from `oauthLoopbackFlow.js`. Every pending flow rejects with `reason` and its loopback server closes, so a consent page that finishes later reaches nothing.
  - `setExternalOpenGuard(guard: ((url: string) => Promise<boolean>) | null)` from `externalUrlOpener.js`. `openExternalUrl(url)` now resolves `true` when it handed the URL to the OS and `false` when the guard declined. It still throws on a blocked scheme.
  - `createConfirmations(...).openLink(url, event?)`: a main-owned dialog naming the destination host. Its default and cancel button is "Don't open".
  - `createSealTransition({ ..., cancelPending = () => 0 })`: called once per seal, after the calendars stop.

**Why links are confirmed, not blocked.** The OS browser and mail client are outside Loqui's process boundary (Task 1, "Out of scope"). Loqui cannot meter or stop their traffic, so it does not pretend to. While sealed, every path that hands a URL to the OS (`open-external`, `window.open` and navigation in the control panel, meeting join links, the Help menu, OAuth consent pages) asks first, in a dialog the renderer cannot answer. The dialog says that the link opens in another app that Sealed mode does not cover. Declining is silent: no error box.

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/calendarSealed.test.js`:

```js
const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");
const test = require("node:test");

const fetches = [];
const opened = [];
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron")
    return {
      app: { getPath: () => process.cwd(), isReady: () => false, getName: () => "test" },
      net: { fetch: async (url) => { fetches.push(url); return new Response("{}", { status: 200 }); } },
      shell: { openExternal: async (url) => { opened.push(url); } },
      BrowserWindow: { getAllWindows: () => [] },
    };
  return originalLoad.call(this, request, parent, isMain);
};
test.after(() => { Module._load = originalLoad; });

const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { SealedModeError, isSealedModeError, sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");
const { createCalendarGuard } = require("../../src/helpers/privacy/calendarGuard");
const { runOAuthLoopbackFlow, cancelAllOAuthFlows, activeOAuthFlowCount } = require("../../src/helpers/oauthLoopbackFlow");
const GoogleCalendarOAuth = require("../../src/helpers/googleCalendarOAuth");
const MicrosoftCalendarManager = require("../../src/helpers/microsoftCalendarManager");

let recorder;
let sealed;
test.beforeEach(() => {
  fetches.length = 0;
  opened.length = 0;
  sealed = true;
  recorder = new FlightRecorder({ now: () => 1 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => sealed, recorder, now: () => 1 });
});

test("sealed: Google token exchange is refused before net.fetch", async () => {
  const oauth = new GoogleCalendarOAuth({});
  await assert.rejects(oauth._httpsPost("https://oauth2.googleapis.com/token", "code=x"), (e) => isSealedModeError(e));
  assert.deepEqual(fetches, []);
  assert.deepEqual([recorder.list()[0].task, recorder.list()[0].host], ["calendar", "oauth2.googleapis.com"]);
});

test("sealed: Microsoft Graph reads are refused", async () => {
  const manager = new MicrosoftCalendarManager({}, { scheduleNextMeeting() {} });
  // _apiGet(path, accountEmail) asks the OAuth helper for a token first; keep that local.
  manager.oauth = { getValidAccessToken: async () => "token" };
  await assert.rejects(manager._apiGet("/me/calendars", "user@example.com"), (e) => isSealedModeError(e));
  assert.deepEqual(fetches, []);
});

test("the calendar guard main uses starts, focus-syncs and wake-syncs nothing while sealed", () => {
  const calls = [];
  const manager = (name) => ({
    start: () => calls.push(`${name}.start`),
    syncOnFocus: () => calls.push(`${name}.focus`),
    onWakeFromSleep: () => calls.push(`${name}.wake`),
  });
  const managers = [manager("google"), manager("microsoft"), null];
  const guard = createCalendarGuard({ isSealed: () => sealed });
  guard.start(managers);
  guard.onFocus(managers);
  guard.onWake(managers);
  assert.deepEqual(calls, []);
  sealed = false;
  guard.start(managers);
  guard.onFocus(managers);
  guard.onWake(managers);
  assert.deepEqual(calls, [
    "google.start", "microsoft.start",
    "google.focus", "microsoft.focus",
    "google.wake", "microsoft.wake",
  ]);
});

test("sealing cancels a pending OAuth flow: it rejects as interrupted and its loopback server closes", async () => {
  sealed = false;
  let redirectUri;
  const flow = runOAuthLoopbackFlow({
    buildAuthUrl: (uri) => { redirectUri = uri; return "https://accounts.example.test/auth"; },
    handleCallback: async () => assert.fail("a cancelled flow must not exchange a code"),
    errorParam: "gcal_error",
  });
  while (!redirectUri) await new Promise((r) => setTimeout(r, 5));
  assert.equal(activeOAuthFlowCount(), 1);

  const reason = new SealedModeError({ task: "calendar", host: null, phase: "interrupted" });
  assert.equal(cancelAllOAuthFlows(reason), 1);
  await assert.rejects(flow, (e) => isSealedModeError(e) && sealedPhaseOf(e) === "interrupted");
  assert.equal(activeOAuthFlowCount(), 0);

  // The consent page may still redirect back later. Nothing is listening.
  await assert.rejects(
    new Promise((resolve, reject) => http.get(`${redirectUri}/?code=c&state=s`, resolve).on("error", reject)),
    (e) => e.code === "ECONNREFUSED"
  );
});
```

Both calendar modules export their class directly: `googleCalendarOAuth.js:169` exports `GoogleCalendarOAuth(databaseManager)`, and `microsoftCalendarManager.js:429` exports the manager, whose constructor is `(databaseManager, reminderScheduler)`. `_apiGet(path, accountEmail)` (`:396`) builds the Graph URL from `path` and gets a token from `this.oauth.getValidAccessToken(accountEmail)`. The test stubs `oauth` so the only network step left is the gated fetch.

Create `test/helpers/externalLinkSealed.test.js`:

```js
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const opened = [];
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron")
    return {
      app: { getPath: () => process.cwd(), isReady: () => false, getName: () => "test" },
      shell: { openExternal: async (url) => { opened.push(url); } },
    };
  return originalLoad.call(this, request, parent, isMain);
};
test.after(() => { Module._load = originalLoad; });

const { openExternalUrl, setExternalOpenGuard } = require("../../src/helpers/externalUrlOpener");
const { createConfirmations } = require("../../src/helpers/privacy/privacyBoot");

test.beforeEach(() => { opened.length = 0; setExternalOpenGuard(null); });
test.after(() => setExternalOpenGuard(null));

test("a declined link never reaches the OS, and is not an error", async () => {
  const asked = [];
  setExternalOpenGuard(async (url) => { asked.push(url); return false; });
  assert.equal(await openExternalUrl("https://example.com/a?b=1"), false);
  assert.deepEqual(asked, ["https://example.com/a?b=1"]);
  assert.deepEqual(opened, []);
});

test("a confirmed link opens; a blocked scheme is refused before the guard is asked", async () => {
  const asked = [];
  setExternalOpenGuard(async (url) => { asked.push(url); return true; });
  assert.equal(await openExternalUrl("mailto:someone@example.com"), true);
  await assert.rejects(openExternalUrl("file:///etc/passwd"), /Blocked URL scheme/);
  assert.deepEqual(asked, ["mailto:someone@example.com"]);
  assert.deepEqual(opened, ["mailto:someone@example.com"]);
});

test("the link dialog names the host, and its default answer is don't open", async () => {
  const shown = [];
  const confirm = createConfirmations({
    dialog: { showMessageBox: async (_win, options) => { shown.push(options); return { response: options.defaultId }; } },
    BrowserWindow: { fromWebContents: () => undefined },
    t: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
  });
  assert.equal(await confirm.openLink("https://meet.example.com/abc?pwd=secret"), false);
  assert.equal(shown[0].defaultId, 0);
  assert.equal(shown[0].cancelId, 0);
  assert.match(shown[0].detail, /meet\.example\.com/);
  assert.doesNotMatch(shown[0].detail, /pwd=secret/, "the dialog names the host, never the full URL");
});

test("open-external over IPC reports a declined link as declined, not failed", async () => {
  const { attachOpenExternal } = require("../../src/helpers/externalUrlOpener");
  const handlers = new Map();
  attachOpenExternal({ ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) } });
  setExternalOpenGuard(async () => false);
  assert.deepEqual(await handlers.get("open-external")({}, "https://example.com"), { success: false, declined: true });
  setExternalOpenGuard(async () => true);
  assert.deepEqual(await handlers.get("open-external")({}, "https://example.com"), { success: true });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/helpers/calendarSealed.test.js test/helpers/externalLinkSealed.test.js`
Expected: FAIL. `fetches` is non-empty, and `calendarGuard`, `cancelAllOAuthFlows`, `setExternalOpenGuard`, `openLink` and `attachOpenExternal` do not exist.

- [ ] **Step 3: Gate the calendar requests**

1. In each of the four calendar modules, add `const { gatedNetFetch } = require("./privacy/gatedFetch");`. Replace each `net.fetch(url, init)` named above with `gatedNetFetch(url, init, { task: "calendar", provider: "google" })` (or `"microsoft"`). The `useSessionCookies: false` option is now supplied by `gatedNetFetch`, so it can stay or go.
2. In `ipcHandlers.js`, make the first statement of the `gcal-start-oauth` handler (`:9164`) `egress.assertAllowed({ task: "calendar", target: "https://accounts.google.com" });`. Do the same in the `mcal-start-oauth` handler (`:9251`) with `"https://login.microsoftonline.com"`. This refuses before a browser consent page opens for a sign-in that could not complete.

- [ ] **Step 4: Create the calendar guard and use it in `main.js`**

Create `src/helpers/privacy/calendarGuard.js`:

```js
// Remote calendar sync is network traffic. main.js routes every start, focus
// and wake trigger through here so the sealed check is code a test executes,
// not a pattern in main.js. Apple Calendar (EventKit) is local and is not
// passed in.
function createCalendarGuard({ isSealed }) {
  const each = (managers, method) => {
    if (isSealed()) return;
    for (const manager of managers) manager?.[method]?.();
  };
  return {
    start: (managers) => each(managers, "start"),
    onFocus: (managers) => each(managers, "syncOnFocus"),
    onWake: (managers) => each(managers, "onWakeFromSleep"),
  };
}

module.exports = { createCalendarGuard };
```

In `main.js`:

- Next to the other privacy requires from Task 7, add:

  ```js
  const calendarGuard = require("./src/helpers/privacy/calendarGuard").createCalendarGuard({
    isSealed: () => privacy.state.isSealed(),
  });
  const remoteCalendars = () => [googleCalendarManager, microsoftCalendarManager];
  ```

- Replace `googleCalendarManager.start();` and `microsoftCalendarManager.start();` (`:566-567`) with `calendarGuard.start(remoteCalendars()); // the seal transition restarts them on unseal`.
- In the `browser-window-focus` handler (`:781-785`), replace the Google and Microsoft lines (`:782-783`) with `calendarGuard.onFocus(remoteCalendars());`. Leave the Apple line.
- In the `powerMonitor.on("resume")` handler (`:788-794`), replace the Google block (`:790-792`) and the Microsoft line (`:793`) with `calendarGuard.onWake(remoteCalendars());`. Leave the reminder scheduler and Apple lines.

`src/helpers/calendarSyncInterval.js` has no network primitive of its own; it drives the managers. Leave the `egress-sites` block alone.

- [ ] **Step 5: Cancel pending OAuth flows when sealing**

In `src/helpers/oauthLoopbackFlow.js`:

1. Above `runOAuthLoopbackFlow` (`:33`), add:

   ```js
   // Every flow still waiting for its browser redirect. Sealing cancels them all:
   // a consent page that completes later must find nothing listening.
   const activeFlows = new Set();

   function cancelAllOAuthFlows(reason) {
     const flows = [...activeFlows];
     for (const flow of flows) flow.cancel(reason);
     return flows.length;
   }

   const activeOAuthFlowCount = () => activeFlows.size;
   ```

2. Inside the promise executor, directly after `let callbackClaimed = false;`, register the flow:

   ```js
       const flow = {
         cancel(reason) {
           if (callbackClaimed) return;
           callbackClaimed = true;
           cleanup();
           reject(reason);
         },
       };
       activeFlows.add(flow);
   ```

3. Make `cleanup` (`:95-98`) also remove the flow: add `activeFlows.delete(flow);`. Every settle path (the error, state-mismatch, success and catch branches, the `server.on("error")` handler) already calls `cleanup()`. The timeout handler (`:113-117`) calls `server.close()` directly; replace those two lines with `cleanup();`.

   `cleanup` is declared with `const` after the server is created, and `flow.cancel` only runs after the executor returns, so the reference is initialized by then. Keep `const flow` above `const server` so the `http.createServer` callback can see it.

4. Export them: `module.exports = { runOAuthLoopbackFlow, OAuthFlowError, cancelAllOAuthFlows, activeOAuthFlowCount };`.

In `src/helpers/privacy/privacyBoot.js`:

1. Add `cancelPending = () => 0` to the `createSealTransition` parameters.
2. In `apply(sealed)`, directly after `for (const calendar of getCalendars()) calendar?.stop?.();`, add `cancelPending();`.

In `main.js`, in the Task 7 `createSealTransition({ ... })` call, add:

```js
       cancelPending: () =>
         require("./src/helpers/oauthLoopbackFlow").cancelAllOAuthFlows(
           new (require("./src/helpers/privacy/egressPolicy").SealedModeError)({ task: "calendar", host: null, phase: "interrupted" })
         ),
```

The `gcal-start-oauth` and `mcal-start-oauth` handlers already return `{ success: false, error }` on a rejected flow. The renderer's calendar settings show the `[SEALED_MODE:interrupted]` message (Task 13).

- [ ] **Step 6: Confirm browser links while sealed**

In `src/helpers/externalUrlOpener.js`:

1. Above `openExternalUrl`, add:

   ```js
   // Installed by main.js. While sealed it asks the user, in a main-owned
   // dialog, before a URL leaves for another app. null means "always open".
   let externalOpenGuard = null;
   function setExternalOpenGuard(guard) {
     externalOpenGuard = guard;
   }
   ```

2. In `openExternalUrl`, directly after the scheme check (`:37-39`), add:

   ```js
     if (externalOpenGuard && !(await externalOpenGuard(href))) return false;
   ```

   Change the Windows `explorer.exe` early `return;` to `return true;`, and the final `return shell.openExternal(url);` to `await shell.openExternal(url); return true;`.

3. Move the `open-external` handler here so its behaviour has one owner and a test can register it:

   ```js
   function attachOpenExternal({ ipcMain }) {
     ipcMain.handle("open-external", async (_event, url) => {
       try {
         const opened = await openExternalUrl(url);
         return opened ? { success: true } : { success: false, declined: true };
       } catch (error) {
         return { success: false, error: error.message };
       }
     });
   }
   ```

   `openExternalUrl` already refuses schemes other than `http:`, `https:` and `mailto:` (`:36-39`), so the handler's duplicate check is not needed.

4. `module.exports = { openExternalUrl, setExternalOpenGuard, attachOpenExternal };`.

In `src/helpers/ipcHandlers.js`, replace the `ipcMain.handle("open-external", ...)` block (`:3539-3550`) with `attachOpenExternal({ ipcMain });`, imported alongside `openExternalUrl` (`:12`).

In `src/helpers/windowManager.js`, the `openExternalUrl(url, showError)` wrapper (`:1259-1268`) needs no change. A declined link resolves `false` and never reaches the `.catch` error box.

In `src/helpers/privacy/privacyBoot.js`, add a third confirmation to `createConfirmations`:

```js
    // Names only the host: a meeting link's query string can carry a passcode.
    openLink: (url, event) => {
      let host;
      try {
        const parsed = new URL(url);
        host = parsed.protocol === "mailto:" ? "mail" : parsed.host;
      } catch {
        host = "?";
      }
      return ask(event, {
        title: t("sealedMode.confirmLink.title"),
        message: t("sealedMode.confirmLink.message"),
        detail: t("sealedMode.confirmLink.detail", { host }),
        buttons: [t("sealedMode.confirmLink.keep"), t("sealedMode.confirmLink.open")],
      });
    },
```

`ask(undefined, ...)` shows an app-modal dialog, which is right for menu and meeting-engine opens that have no sender.

In `main.js`, in the Task 7 wiring, hoist the confirmations into a constant and install the guard:

```js
     const confirmations = privacyBoot.createConfirmations({ dialog, BrowserWindow, t: (key, params) => i18nMain.t(key, params) });
     require("./src/helpers/externalUrlOpener").setExternalOpenGuard(async (url) =>
       !privacy.state.isSealed() || confirmations.openLink(url)
     );
```

and pass `confirm: confirmations` to `attachPrivacyIPC`.

Add these English source strings to all 11 locales with the Task 14 merge script:

```json
{
  "sealedMode.confirmLink.title": "Open this link outside Loqui?",
  "sealedMode.confirmLink.message": "The link opens in another app. Sealed mode does not cover that app's network use.",
  "sealedMode.confirmLink.detail": "Destination: {{host}}",
  "sealedMode.confirmLink.keep": "Don't open",
  "sealedMode.confirmLink.open": "Open link"
}
```

Update inventory row N21 in `docs/security/sealed-mode-threat-model.md` (Task 1) if its wording has drifted: decision "allowed after a main-owned confirmation while sealed", test `externalLinkSealed.test.js`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- test/helpers/calendarSealed.test.js test/helpers/externalLinkSealed.test.js test/helpers/sealTransition.test.js test/helpers/privacyBootOrder.test.js && npm run i18n:check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/helpers/privacy/calendarGuard.js src/helpers/googleCalendarOAuth.js src/helpers/googleCalendarManager.js src/helpers/microsoftCalendarOAuth.js src/helpers/microsoftCalendarManager.js src/helpers/oauthLoopbackFlow.js src/helpers/externalUrlOpener.js src/helpers/ipcHandlers.js src/helpers/privacy/privacyBoot.js main.js src/locales test/helpers/calendarSealed.test.js test/helpers/externalLinkSealed.test.js
git commit -m "feat(privacy): gate calendars, cancel pending OAuth on seal, confirm links while sealed"
```

---

### Task 11a: One loopback rule for main and the route graph, and a gated self-hosted probe (Plan 01 and Plan 03 integration)

**Prerequisites.** Plan 01 has merged, so `src/lib/locality.ts` exists. Plan 03 has merged, so `src/helpers/selfHostedProbe.js` and its `probe-self-hosted` handler exist (P03 Task 14). If Plan 03 has not merged yet, do Steps 1–3 now and Steps 4–6 in the commit that lands after it. Do not add a second probe.

**Files:**
- Create:
  - `test/fixtures/loopbackCases.json`.
- Modify:
  - `src/lib/locality.ts` (Plan 01): `isLoopbackUrl`.
  - `src/helpers/selfHostedProbe.js` (Plan 03): map a sealed refusal to `{ ok: false, code: "sealed" }`.
  - `src/helpers/ipcHandlers.js`: the `probe-self-hosted` handler (Plan 03).
  - `src/types/electron.ts`: add `"sealed"` to the `probeSelfHosted` result codes.
  - `test/helpers/egressPolicy.test.js` (Task 2): read its loopback cases from the fixture.
- Test: `test/helpers/loopbackParity.test.js`, `test/helpers/selfHostedProbeSealed.test.js`

**Interfaces:**
- Consumes `isLoopbackHost` and `hostOf` (Task 2), `gatedNodeFetch` (Task 8) and `isSealedModeError` (Task 2).
- Produces:
  - `isLoopbackHostname(hostname: string): boolean` in `src/lib/locality.ts`. `isLoopbackUrl(url)` delegates to it.
  - `probeSelfHosted(...)` result code `"sealed"`. Plan 03's panel shows `routes.state.sealed` for it (CCR-2).

**Why.** The renderer decides whether a route is `device` with `isLoopbackUrl` (Plan 01). Main decides what Sealed mode lets through with `isLoopbackHost` (Task 2). Today they disagree on `127.0.0.2`, `[::ffff:127.0.0.1]`, `[0:0:0:0:0:0:0:1]` and `localhost.`: main allows these as loopback, and the route graph calls them `network` and shows them paused while sealed. Both sides now read the same case list, and a test fails if either drifts.

- [ ] **Step 1: Write the shared cases and the failing parity test**

Create `test/fixtures/loopbackCases.json`:

```json
{
  "loopback": [
    "http://localhost:11434/v1",
    "http://LOCALHOST.:8080",
    "http://127.0.0.1:8080",
    "http://127.0.0.2:9000",
    "http://[::1]:8080",
    "http://[::ffff:127.0.0.1]/",
    "http://[0:0:0:0:0:0:0:1]/",
    "http://llm.localhost/v1",
    "http://app.localhost:5173/"
  ],
  "notLoopback": [
    "http://192.168.1.5:8080",
    "https://gpu-box.lan/v1",
    "http://localhost.evil.example",
    "http://127.0.0.1.nip.io",
    "http://0.0.0.0:8080",
    "http://[::ffff:10.0.0.1]/",
    "http://[::2]/",
    "https://api.openai.com"
  ]
}
```

Create `test/helpers/loopbackParity.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const cases = require("../fixtures/loopbackCases.json");
const { isLoopbackHost, hostOf } = require("../../src/helpers/privacy/egressPolicy");

test("main and the route graph agree on every loopback case", async () => {
  const { isLoopbackUrl } = await import("../../src/lib/locality.ts");
  for (const url of cases.loopback) {
    assert.equal(isLoopbackHost(hostOf(url)), true, `main: ${url}`);
    assert.equal(isLoopbackUrl(url), true, `renderer: ${url}`);
  }
  for (const url of cases.notLoopback) {
    assert.equal(isLoopbackHost(hostOf(url)), false, `main: ${url}`);
    assert.equal(isLoopbackUrl(url), false, `renderer: ${url}`);
  }
});

test("a self-hosted server on any loopback form is the device, so Sealed mode keeps it", async () => {
  const { resolveLocality } = await import("../../src/lib/locality.ts");
  for (const url of cases.loopback) {
    assert.equal(resolveLocality({ mode: "self-hosted", remoteUrl: url }).locality, "device", url);
  }
});
```

In `test/helpers/egressPolicy.test.js` (Task 2), replace the two inline URL arrays in `"loopback classification"` with `cases.loopback` and `cases.notLoopback`, and add `const cases = require("../fixtures/loopbackCases.json");` at the top. Keep the `null` and `""` assertions.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/helpers/loopbackParity.test.js`
Expected: FAIL on `renderer: http://127.0.0.2:9000`. Plan 01's `isLoopbackUrl` accepts only `localhost`, `127.0.0.1`, `::1` and `*.localhost` (`src/lib/locality.ts`, `LOOPBACK_HOSTS`).

- [ ] **Step 3: Port main's rule to the renderer**

In `src/lib/locality.ts`, replace `LOOPBACK_HOSTS` and the body of `isLoopbackUrl` with:

```ts
// Must match isLoopbackHost in src/helpers/privacy/egressPolicy.js, which is
// what Sealed mode lets through. test/helpers/loopbackParity.test.js holds both
// to test/fixtures/loopbackCases.json.
export function isLoopbackHostname(hostname: string): boolean {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return host.split(".")[0] === "127";
  if (!host.includes(":")) return false;
  if (host === "::1" || /^(?:0{1,4}:){7}0{0,3}1$/.test(host)) return true;
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  if (dotted) return dotted[1].split(".")[0] === "127";
  // WHATWG URL parsing turns ::ffff:127.0.0.1 into ::ffff:7f00:1.
  const hex = /^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/.exec(host);
  return !!hex && parseInt(hex[1], 16) >> 8 === 127;
}

export function isLoopbackUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return isLoopbackHostname(new URL(url).hostname);
  } catch {
    return false;
  }
}
```

`URL` already canonicalizes `[0:0:0:0:0:0:0:1]` to `[::1]` and `127.1` to `127.0.0.1`, so the regexes see canonical forms. Plan 01's existing `test/lib/locality.test.js` cases are all still classified the same way.

Run: `npm test -- test/helpers/loopbackParity.test.js test/helpers/egressPolicy.test.js test/lib/locality.test.js`
Expected: PASS.

- [ ] **Step 4: Write the failing probe test**

Create `test/helpers/selfHostedProbeSealed.test.js`:

```js
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const test = require("node:test");
const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { gatedNodeFetch } = require("../../src/helpers/privacy/gatedFetch");
const { probeSelfHosted } = require("../../src/helpers/selfHostedProbe");

let recorder;
test.beforeEach(() => {
  recorder = new FlightRecorder({ now: () => 1 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => true, recorder, now: () => 1 });
});

test("sealed: a LAN probe is refused as 'sealed', not 'network', and is recorded as blocked", async () => {
  assert.deepEqual(await probeSelfHosted("http://192.168.1.20:11434/v1", gatedNodeFetch("providerCheck")), { ok: false, code: "sealed" });
  const [row] = recorder.list();
  assert.deepEqual([row.task, row.host, row.outcome], ["providerCheck", "192.168.1.20", "blocked"]);
});

test("sealed: a loopback probe still reaches the local server", async (t) => {
  const server = http.createServer((_req, res) => res.end(JSON.stringify({ data: [{ id: "a" }] })));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/v1`;
  assert.deepEqual(await probeSelfHosted(url, gatedNodeFetch("providerCheck")), { ok: true, count: 1 });
  assert.equal(recorder.list().length, 0, "loopback is never recorded");
});
```

The production IPC handler is exercised in Task 12 (row N4, `probe-self-hosted`).

Run: `npm test -- test/helpers/selfHostedProbeSealed.test.js`
Expected: FAIL. The first case returns `{ ok: false, code: "network" }`: the probe's `catch` turns the sealed refusal into a generic transport error.

- [ ] **Step 5: Gate the probe and keep the typed refusal**

1. In `src/helpers/selfHostedProbe.js`, add `const { isSealedModeError } = require("./privacy/egressPolicy");` and make the first line of the `catch` `if (isSealedModeError(error)) return { ok: false, code: "sealed" };`.
2. In `src/helpers/ipcHandlers.js`, change the `probe-self-hosted` handler to pass the gated fetch:

   ```js
     ipcMain.handle("probe-self-hosted", (_e, baseUrl) =>
       require("./selfHostedProbe").probeSelfHosted(baseUrl, gatedNodeFetch("providerCheck", { provider: "custom" }))
     );
   ```

   `gatedNodeFetch` is already imported in `ipcHandlers.js` (Task 8).
3. In `src/types/electron.ts`, add `"sealed"` to the `code` union of `probeSelfHosted`'s result.
4. In `src/components/SelfHostedPanel.tsx` (Plan 03), when `result.code === "sealed"` set the failure text to `t("routes.state.sealed")` instead of "Couldn't list models at {{host}}". That key exists (Plan 03 Task 4).
5. Add `src/helpers/selfHostedProbe.js` to inventory row N4 and to the `egress-sites` block in `docs/security/sealed-mode-threat-model.md` (Task 1). Its decision is "blocked unless loopback". Plan 03's note about a "sealed-mode allowlist" (P03 Task 14) is superseded by this rule (CCR-2).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- test/helpers/loopbackParity.test.js test/helpers/selfHostedProbeSealed.test.js test/helpers/selfHostedProbe.test.js test/helpers/egressInventory.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/locality.ts src/helpers/selfHostedProbe.js src/helpers/ipcHandlers.js src/types/electron.ts src/components/SelfHostedPanel.tsx docs/security/sealed-mode-threat-model.md test/fixtures/loopbackCases.json test/helpers/loopbackParity.test.js test/helpers/selfHostedProbeSealed.test.js test/helpers/egressPolicy.test.js
git commit -m "feat(privacy): one loopback rule for main and routes; gate the self-hosted probe"
```

---

### Task 12: Prove that a sealed main process rejects every blocked request type

This task is the dedicated enforcement matrix. It drives the **real registered handlers**, the same `ipcMain.handle` callbacks the renderer reaches through preload, with Sealed mode on. For every `blocked` row of the inventory (Task 1; N25 is Chromium-only and proved in Task 16), and every transport variant inside a row, it must show three things:
1. the caller receives a sealed refusal (thrown, or `{ success: false, code: "SEALED_MODE" }`);
2. no transport was touched: Electron `net.fetch`/`net.request`, Node `fetch`, an allowed off-host socket, or a spawn;
3. the ledger holds a `blocked` row with `bytesOut: 0` and the right task.

There are five kinds of extra row:
- **Prevented rows:** background work that is simply not started. These execute the production code main runs (the calendar guard, the Codex server factory), never a pattern in a source file.
- **Loopback rows:** local routes still work, including a local request that is in flight while the seal happens.
- **Interruption rows:** sealing mid-flight reports `"interrupted"`.
- **The Layer B row:** a request site nobody gated is still refused.
- **The confirmed row (N21):** a browser link while sealed reaches the OS only after the main-owned dialog says yes.

Two checks keep the matrix honest:
- **Bypass sensitivity.** Every refused row runs a second time with Layer A bypassed (`gate._setBypassForTests(true)`, which authorises as if unsealed). That run must reach a transport, or be refused by Layer B at the socket. A row that does neither never reached its egress point. It was failing on a missing fake, so its "refused" result proved nothing.
- **Ratchets.** The matrix is tied to the threat model's blocked rows, to every realtime and proxy channel that `ipcHandlers.js` registers, and to every download channel.

**What this task does not prove.** Electron's real Chromium session, ws upgrades, redirects and electron-updater run only in an Electron process. Task 16 covers them with an independent observer.

**Files:**
- Create: `test/helpers/harness/ipcHandlersHarness.js`. It loads `IPCHandlers.prototype.setupHandlers` with an Electron stub, generalised from `test/helpers/granolaImportIpc.test.js:1-98`.
- Test: `test/helpers/sealedModeEnforcement.test.js`
- Modify: `docs/security/sealed-mode-threat-model.md` (Task 1): add the test name to each row's "Test" column.

**Interfaces:**
- Produces `loadIpcHandlers({ electron, managers }) → { invoke(channel, ...args), send(channel, ...args), channels(): string[], restore() }`. It is a test helper only.
- Consumes every chokepoint from Tasks 6–11.

- [ ] **Step 1: Write the harness**

Create `test/helpers/harness/ipcHandlersHarness.js`:

```js
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

// Registers the real ipcHandlers.js channels against fakes, the same way
// test/helpers/granolaImportIpc.test.js does for one channel. Managers that a
// test does not supply resolve to a recursive no-op proxy.
function anything() {
  return new Proxy(function () {}, {
    get: (_target, property) => {
      if (property === Symbol.toPrimitive || property === "toString") return () => "";
      if (property === "then") return undefined;
      return anything();
    },
    apply: () => anything(),
  });
}

function fakeEvent() {
  const mainFrame = { url: "file:///loqui/index.html" };
  const sender = { id: 1, mainFrame, send() {}, isDestroyed: () => false, once() {}, on() {} };
  return { sender, senderFrame: mainFrame };
}

function loadIpcHandlers({ electron, managers = {} }) {
  const handlers = new Map();
  const listeners = new Map();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-ipc-harness-"));
  const stub = {
    app: { getPath: () => dir, getAppPath: () => process.cwd(), getName: () => "test", getVersion: () => "0.0.0", isPackaged: false, isReady: () => false, on() {}, requestSingleInstanceLock: () => true },
    ipcMain: { handle: (c, h) => handlers.set(c, h), on: (c, h) => listeners.set(c, h), removeHandler() {} },
    BrowserWindow: class { static getAllWindows() { return []; } static fromWebContents() { return null; } },
    shell: { openExternal: async () => {} },
    dialog: {},
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 0, height: 0 } }) },
    systemPreferences: { getMediaAccessStatus: () => "granted" },
    session: { fromPartition: () => ({}), defaultSession: {} },
    clipboard: {}, nativeImage: {}, globalShortcut: {}, utilityProcess: {}, MessageChannelMain: class {},
    ...electron,
  };
  const originalLoad = Module._load;
  Module._load = function loadWithElectronStub(request, parent, isMain) {
    if (request === "electron") return stub;
    if (request === "./debugLogger" || /[\\/]debugLogger$/.test(request)) return new Proxy({}, { get: () => () => {} });
    return originalLoad.call(this, request, parent, isMain);
  };
  const modulePath = require.resolve("../../../src/helpers/ipcHandlers");
  delete require.cache[modulePath];
  const IPCHandlers = require(modulePath);
  const Ctor = IPCHandlers.default || IPCHandlers;
  Ctor.prototype.setupHandlers.call(new Proxy({ ...managers }, { get: (v, p) => (p in v ? v[p] : anything()) }));
  return {
    invoke(channel, ...args) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler registered for ${channel}`);
      return handler(fakeEvent(), ...args);
    },
    send(channel, ...args) {
      return listeners.get(channel)?.(fakeEvent(), ...args);
    },
    channels: () => [...handlers.keys()],
    restore() {
      Module._load = originalLoad;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = { loadIpcHandlers, anything, fakeEvent };
```

- [ ] **Step 2: Write the matrix**

Create `test/helpers/sealedModeEnforcement.test.js`:

```js
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { loadIpcHandlers, anything } = require("./harness/ipcHandlersHarness");

// One counter per transport. A refused row must leave every one at zero.
const transport = { netFetch: 0, netRequest: 0, nodeFetch: 0, socket: 0, spawn: 0 };
let netFetchImpl = async () => { throw new Error("Electron net.fetch reached"); };
const electron = {
  net: {
    fetch: (...args) => { transport.netFetch++; return netFetchImpl(...args); },
    request: () => { transport.netRequest++; throw new Error("Electron net.request reached"); },
  },
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => { transport.nodeFetch++; return originalFetch(...args); };
const originalSpawn = childProcess.spawn;
childProcess.spawn = () => { transport.spawn++; throw new Error("spawn reached"); };

const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "), Buffer.alloc(32)]);
const ipc = loadIpcHandlers({
  electron,
  managers: {
    environmentManager: new Proxy({}, { get: (_t, p) => (typeof p === "string" && p.startsWith("get") ? () => "sk-test" : anything()) }),
    audioStorageManager: { getAudioBuffer: () => wav, deleteAudio() {}, cleanupExpiredAudio() {} },
    // Real managers where they construct without native binaries, so their
    // download code is the code under test. A getter: the harness spreads this
    // object after its Electron stub is installed, so whisper.js loads against it.
    get whisperManager() {
      const WhisperManager = require("../../src/helpers/whisper");
      return new WhisperManager();
    },
  },
});
test.after(() => {
  ipc.restore();
  globalThis.fetch = originalFetch;
  childProcess.spawn = originalSpawn;
});

const gate = require("../../src/helpers/privacy/egressGate");
const backstop = require("../../src/helpers/privacy/egressBackstop");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError, sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");
const stt = require("../../src/helpers/sttTransport");
const { downloadFile, fetchJson } = require("../../src/helpers/downloadUtils");
const urlAudio = require("../../src/helpers/urlAudioDownloader");
const { REALTIME_TOKEN_PROVIDERS } = require("../../src/helpers/realtimeTokenProviders");
const { registerPersonalInferenceIPC, createCodexServer } = require("../../src/helpers/personalInference");
const { UpdateManager } = require("../../src/helpers/updateManager");
const { createCalendarGuard } = require("../../src/helpers/privacy/calendarGuard");
const { setExternalOpenGuard } = require("../../src/helpers/externalUrlOpener");
const { createConfirmations } = require("../../src/helpers/privacy/privacyBoot");
const GoogleCalendarOAuth = require("../../src/helpers/googleCalendarOAuth");
const MicrosoftCalendarManager = require("../../src/helpers/microsoftCalendarManager");

// Codex is asked only after the handler's own gate (N18). Counting these calls
// lets a row tell "refused in the handler" from "refused by a later guard".
let codexCalls = 0;
{
  const proto = require("../../src/helpers/codexAppServer").CodexAppServer.prototype;
  for (const method of ["start", "status", "login"]) {
    const original = proto[method];
    if (typeof original === "function") proto[method] = function (...args) { codexCalls++; return original.apply(this, args); };
  }
}

backstop.installNodeBackstop();
let layerBRefusals = 0;
backstop.addObserver((event) => {
  if (event.allowed) transport.socket++;
  else layerBRefusals++;
});

const flags = { sealed: true };
let recorder;
test.beforeEach(() => {
  flags.sealed = true;
  for (const key of Object.keys(transport)) transport[key] = 0;
  layerBRefusals = 0;
  codexCalls = 0;
  gate._setBypassForTests(false);
  netFetchImpl = async () => { throw new Error("Electron net.fetch reached"); };
  recorder = new FlightRecorder({ now: () => 1 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now: () => 1 });
});

async function outcomeOf(action) {
  try {
    return { value: await action() };
  } catch (thrown) {
    return { thrown };
  }
}
const refused = (o) =>
  o.thrown
    ? isSealedModeError(o.thrown)
    : !!o.value && (o.value.code === "SEALED_MODE" || isSealedModeError({ message: String(o.value.error ?? "") }));

// Neither a Codex object nor a model factory is injected: registerPersonalInferenceIPC
// builds the production Codex server (Task 8) and the real AI SDK models. Only
// the terminal transport (global fetch, counted above) is faked.
function inference() {
  const handlers = new Map();
  registerPersonalInferenceIPC({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn), removeHandler() {} },
    userDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "loqui-matrix-")),
    getCredential: async () => "sk-test", saveCredential: async () => {}, openExternal: async () => {},
  });
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send() {} });
  return (name, ...args) => handlers.get(`personal-inference:${name}`)({ sender }, ...args);
}
// Process seams only. createCodexServer drops anything else, so the gate hooks
// are the shipped ones.
function codexSeams() {
  return {
    userDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "loqui-matrix-codex-")),
    resolveExecutable: async () => "/verified/codex",
    runFile: async () => ({ stdout: require("../fixtures/codex-app-server-0.154.json").version }),
    spawnProcess: () => { transport.spawn++; throw new Error("spawn reached"); },
  };
}
const ask = (overrides) => ({ requestId: `m-${Math.random()}`, model: "m", messages: [{ role: "user", content: "x" }], ...overrides });
const audioRequest = (overrides = {}) => ({
  audioBuffer: wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength),
  mimeType: "audio/wav", requestId: "r-1", model: "whisper-1", provider: "openai", language: "en", ...overrides,
});
function updateManager() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-matrix-upd-"));
  fs.writeFileSync(path.join(profile, "updates.json"), JSON.stringify({ enabled: true, onboarded: true }));
  return new UpdateManager({
    updater: { on() {}, checkForUpdates: async () => { transport.netRequest++; return {}; }, downloadUpdate: async () => {} },
    profile, version: "1.0.0", supported: true, packaged: true, sealed: () => flags.sealed, authorize: gate.authorize,
  });
}

// id → [[label, expected ledger task, action], …]. Every transport variant gets its own entry.
const BLOCKED = {
  N1: [["text-generate (cloud chat)", "chat", () => inference()("text-generate", ask({ provider: "openai", credentialRef: "openai", inferenceScope: "chatIntelligence" }))]],
  N2: [
    ["text-generate (Bedrock)", "noteFormatting", () => inference()("text-generate", ask({ provider: "bedrock", inferenceScope: "noteFormatting" }))],
    ["process-enterprise-reasoning", "dictationCleanup", () => ipc.invoke("process-enterprise-reasoning", {})],
    ["enterprise-stream-start", "chat", () => ipc.invoke("enterprise-stream-start", {})],
    ["test-enterprise-connection", "providerCheck", () => ipc.invoke("test-enterprise-connection", {})],
    ["bedrock-list-models", "providerCheck", () => ipc.invoke("bedrock-list-models", {})],
  ],
  N3: [["personal-inference:models", "providerCheck", () => inference()("models", { provider: "openrouter", credentialRef: "openrouter" })]],
  N4: [
    ["test-provider-connection", "providerCheck", () => ipc.invoke("test-provider-connection", { provider: "groq", apiKey: "sk-test" })],
    // Task 11a. A LAN server is another machine.
    ["probe-self-hosted (LAN)", "providerCheck", async () => {
      const result = await ipc.invoke("probe-self-hosted", "http://192.168.1.20:11434/v1");
      return result.code === "sealed" ? { code: "SEALED_MODE" } : result;
    }],
  ],
  N5: [["transcribe-audio-file-byok (captured audio)", "dictationStt", () => ipc.invoke("transcribe-audio-file-byok", audioRequest())]],
  N6: [
    ["proxy-gemini-transcription", "dictationStt", () => ipc.invoke("proxy-gemini-transcription", audioRequest({ provider: "gemini" }))],
    ["proxy-corti-transcription", "dictationStt", () => ipc.invoke("proxy-corti-transcription", audioRequest({ provider: "corti" }))],
    ["proxy-tinfoil-transcription", "dictationStt", () => ipc.invoke("proxy-tinfoil-transcription", audioRequest({ provider: "tinfoil" }))],
  ],
  N7: [["retry-transcription", "dictationStt", () => ipc.invoke("retry-transcription", 1, { preferredLanguage: "en" })]],
  N8: [
    ["proxy-xai-transcription", "dictationStt", () => ipc.invoke("proxy-xai-transcription", audioRequest({ provider: "xai" }))],
    ["proxy-mistral-transcription", "dictationStt", () => ipc.invoke("proxy-mistral-transcription", audioRequest({ provider: "mistral" }))],
    ["process-anthropic-reasoning", "dictationCleanup", () => ipc.invoke("process-anthropic-reasoning", "text", "claude", "", {})],
  ],
  // Token acquisition runs inside connectRealtime's ticket (Task 9a), so the
  // production start handler is what must refuse before the token request.
  N10: Object.keys(REALTIME_TOKEN_PROVIDERS).map((provider) => [
    `dictation-realtime-start (${provider} token)`,
    "dictationStt",
    () => ipc.invoke("dictation-realtime-start", { mode: "byok", provider }),
  ]),
  N11: [["get-tinfoil-chat-models", "providerCheck", () => ipc.invoke("get-tinfoil-chat-models")]],
  N12: [
    ["model-download (local LLM, modelManagerBridge)", "modelDownload", () => ipc.invoke("model-download", "qwen3.5-2b-q4_k_m")],
    ["download-whisper-model (WhisperManager)", "modelDownload", () => ipc.invoke("download-whisper-model", "base")],
    ["downloadFile (shared by every manager)", "modelDownload", () => downloadFile("https://huggingface.co/x/model.bin", path.join(os.tmpdir(), `m-${Date.now()}.bin`))],
  ],
  N13: [
    ["llama-cpp-install", "runtimeDownload", () => ipc.invoke("llama-cpp-install")],
    ["fetchJson (runtime release lookup)", "runtimeDownload", () => fetchJson("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest", { egressTask: "runtimeDownload" })],
  ],
  N14: [["download-url-audio", "urlImport", () => ipc.invoke("download-url-audio", "https://example.com/a.mp3")]],
  N16: [["manual update check", "appUpdate", () => updateManager().check(true)]],
  // The production factory: release verification and the spawn guard are the shipped hooks.
  N17: [["Codex start (release verification)", "codex", () => createCodexServer(codexSeams()).start()]],
  // The fourth element is a row-specific check. For N18 it proves the refusal
  // happened in the handler, before Codex was asked at all.
  N18: [
    ["personal-inference:codex-status", "codex", () => inference()("codex-status"), () => assert.equal(codexCalls, 0, "refused in the handler, before Codex.status")],
    ["personal-inference:codex-login", "codex", () => inference()("codex-login"), () => assert.equal(codexCalls, 0, "refused in the handler, before Codex.login")],
  ],
  N19: [
    ["gcal-start-oauth", "calendar", () => ipc.invoke("gcal-start-oauth")],
    ["mcal-start-oauth", "calendar", () => ipc.invoke("mcal-start-oauth")],
    ["Google token exchange", "calendar", () => new GoogleCalendarOAuth({})._httpsPost("https://oauth2.googleapis.com/token", "code=x")],
  ],
};

// N9: every realtime warmup/start channel ipcHandlers.js registers, discovered, not listed.
const REALTIME = ipc.channels().filter((c) => /-(streaming|realtime)-(warmup|start)$/.test(c) || c === "meeting-transcription-start");
BLOCKED.N9 = REALTIME.map((channel) => [
  channel,
  channel.startsWith("meeting-") ? "noteRecordingStt" : "dictationStt",
  () => ipc.invoke(channel, { mode: "byok", provider: channel.split("-")[0] === "dictation" ? "openai-realtime" : `${channel.split("-")[0]}-realtime` }),
]);

// Rows that are prevented rather than refused: nothing is attempted.
const PREVENTED = {
  N15: async () => {
    await urlAudio.maybeUpdateYtDlp({ force: true });
    assert.equal(transport.spawn, 0);
    assert.equal(urlAudio.ytDlpControl.alive(), false);
  },
  N18: async () => {
    // A test cannot pass beforeSpawn: createCodexServer ignores it, so this is the shipped guard.
    await assert.rejects(createCodexServer({ ...codexSeams(), beforeSpawn: () => {} }).start(), isSealedModeError);
    assert.equal(transport.spawn, 0);
  },
  N20: async () => {
    // The guard main.js routes start, focus and wake through (Task 11), executed.
    const calls = [];
    const manager = new MicrosoftCalendarManager({}, { scheduleNextMeeting() {} });
    manager.start = () => calls.push("start");
    manager.syncOnFocus = () => calls.push("focus");
    manager.onWakeFromSleep = () => calls.push("wake");
    const guard = createCalendarGuard({ isSealed: () => gate.isSealed() });
    guard.start([manager]);
    guard.onFocus([manager]);
    guard.onWake([manager]);
    assert.deepEqual(calls, []);
    // An in-flight sync that slipped past the guard is still refused at the fetch.
    manager.oauth = { getValidAccessToken: async () => "token" };
    await assert.rejects(MicrosoftCalendarManager.prototype._apiGet.call(manager, "/me/events", "user@example.com"), isSealedModeError);
  },
};

for (const [id, variants] of Object.entries(BLOCKED)) {
  for (const [label, task, action, extra] of variants) {
    test(`${id} ${label}: refused before any transport, recorded as ${task}`, async () => {
      const outcome = await outcomeOf(action);
      extra?.();
      assert.ok(refused(outcome), `${id} ${label} was not refused: ${outcome.thrown?.message ?? JSON.stringify(outcome.value)}`);
      assert.deepEqual(transport, { netFetch: 0, netRequest: 0, nodeFetch: 0, socket: 0, spawn: 0 }, `${id} ${label} touched a transport`);
      const blocked = recorder.list().filter((r) => r.outcome === "blocked");
      assert.ok(blocked.length >= 1, `${id} ${label} left a blocked ledger row`);
      assert.equal(blocked[0].task, task);
      assert.equal(blocked[0].bytesOut, 0);
    });
  }
}
for (const [id, check] of Object.entries(PREVENTED)) test(`${id}: prevented while sealed`, check);

// Regression sensitivity: with Layer A bypassed, the same call must reach its
// egress point. If it does not, its refusal above came from something else
// (a missing fake, an early validation error) and proves nothing.
for (const [id, variants] of Object.entries(BLOCKED)) {
  for (const [label, , action] of variants) {
    test(`${id} ${label}: with Layer A bypassed, reaches a transport or a Layer B refusal`, async () => {
      gate._setBypassForTests(true);
      try {
        await outcomeOf(action);
      } finally {
        gate._setBypassForTests(false);
      }
      const touched = transport.netFetch + transport.netRequest + transport.nodeFetch + transport.spawn + transport.socket;
      assert.ok(touched > 0 || layerBRefusals > 0, `${id} ${label} never reached its egress point`);
    });
  }
}

test("N9 discovers the realtime channels it must cover", () => {
  assert.ok(REALTIME.includes("dictation-realtime-start"));
  assert.ok(REALTIME.includes("dictation-realtime-warmup"));
  assert.ok(REALTIME.includes("assemblyai-streaming-warmup"));
  assert.ok(REALTIME.length >= 6);
});

test("main.js reaches remote calendars only through the calendar guard", () => {
  const main = fs.readFileSync(path.join(__dirname, "../../main.js"), "utf8");
  assert.doesNotMatch(main, /\b(googleCalendarManager|microsoftCalendarManager)\.(start|syncOnFocus|onWakeFromSleep)\(/);
  assert.match(main, /calendarGuard\.start\(/);
  assert.match(main, /calendarGuard\.onFocus\(/);
  assert.match(main, /calendarGuard\.onWake\(/);
});

test("every download channel is in the matrix, or named as covered by downloadFile", () => {
  const listed = new Set(Object.values(BLOCKED).flat().map(([label]) => label.split(" ")[0]));
  // These construct native-binary managers; they reach the network only through
  // downloadUtils (the ratchet below), whose shared downloadFile row is in this matrix.
  const viaDownloadUtils = new Set([
    "download-parakeet-model", "download-diarization-models", "download-cuda-whisper-binary",
    "download-vulkan-whisper-binary", "download-llama-vulkan-binary", "download-search-model",
  ]);
  for (const channel of ipc.channels().filter((c) => /^(download-|model-download$|llama-cpp-install$)/.test(c) && c !== "download-url-audio")) {
    assert.ok(listed.has(channel) || viaDownloadUtils.has(channel), channel);
  }
});

test("N21: while sealed, a browser link reaches the OS only after the main-owned dialog says yes", async () => {
  const opened = [];
  const answers = [0, 1]; // "Don't open", then "Open link"
  const confirmations = createConfirmations({
    dialog: { showMessageBox: async () => ({ response: answers.shift() }) },
    BrowserWindow: { fromWebContents: () => undefined },
    t: (key) => key,
  });
  // The same guard main.js installs (Task 11).
  setExternalOpenGuard(async (url) => !gate.isSealed() || confirmations.openLink(url));
  const originalOpen = require("electron").shell.openExternal;
  require("electron").shell.openExternal = async (url) => { opened.push(url); };
  try {
    assert.deepEqual(await ipc.invoke("open-external", "https://example.com/"), { success: false, declined: true });
    assert.deepEqual(opened, []);
    assert.deepEqual(await ipc.invoke("open-external", "https://example.com/"), { success: true });
    assert.deepEqual(opened, ["https://example.com/"]);
  } finally {
    setExternalOpenGuard(null);
    require("electron").shell.openExternal = originalOpen;
  }
});

test("a local request in flight survives sealing, while the remote one beside it is interrupted", async () => {
  flags.sealed = false;
  let release;
  const server = http.createServer((_req, res) => { release = () => res.end(JSON.stringify({ data: [{ id: "local" }] })); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    netFetchImpl = (_url, init) => new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const local = ipc.invoke("probe-self-hosted", `http://127.0.0.1:${server.address().port}/v1`);
    const remote = outcomeOf(() => ipc.invoke("transcribe-audio-file-byok", audioRequest()));
    while (!release) await new Promise((r) => setTimeout(r, 5));
    flags.sealed = true;
    gate.abortAllRemote();
    backstop.severAll();
    release();
    assert.deepEqual(await local, { ok: true, count: 1 });
    assert.equal(sealedPhaseOf((await remote).thrown ?? { message: (await remote).value?.error }), "interrupted");
  } finally {
    server.close();
  }
});

test("a loopback WebSocket (the Parakeet and sidecar path) stays open through sealing", async () => {
  const WebSocket = require("ws");
  const server = new WebSocket.Server({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => server.once("listening", r));
  server.on("connection", (socket) => socket.on("message", (m) => socket.send(m)));
  try {
    flags.sealed = false;
    const client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    flags.sealed = true;
    gate.abortAllRemote();
    backstop.severAll();
    const echo = new Promise((resolve) => client.once("message", (m) => resolve(String(m))));
    client.send("audio-frame");
    assert.equal(await echo, "audio-frame", "the local stream kept working after the seal");
    assert.equal(client.readyState, WebSocket.OPEN);
    client.close();
  } finally {
    server.close();
  }
});

// I4-R2: unsealed, every BYOK speech path announces the session id and the
// canonical target, through the real handler.
for (const [label, request, expectedTarget] of [
  ["OpenAI (multipart)", { provider: "openai" }, "openai"],
  ["custom server (multipart)", { provider: "custom", baseUrl: "https://stt.example.net/v1" }, "host:stt.example.net"],
  ["Gemini", { provider: "gemini", model: "gemini-2.5-flash" }, "gemini"],
  ["Corti", { provider: "corti" }, "corti"],
]) {
  test(`unsealed: ${label} notices carry the session id and target ${expectedTarget}`, async () => {
    flags.sealed = false;
    const seen = [];
    for (const phase of ["dispatched", "delivered"]) gate.events.on(phase, (n) => n.payload !== "metadata" && seen.push({ phase, ...n }));
    netFetchImpl = async (url) =>
      String(url).includes("oauth") || String(url).includes("token")
        ? new Response(JSON.stringify({ access_token: "t", expires_in: 300 }), { status: 200 })
        : new Response(JSON.stringify({ text: "hi", candidates: [{ content: { parts: [{ text: "hi" }] } }] }), { status: 200 });
    await outcomeOf(() => ipc.invoke("transcribe-audio-file-byok", audioRequest({ ...request, correlationId: "session-42" })));
    assert.ok(seen.length > 0, `${label} dispatched audio`);
    for (const n of seen) assert.deepEqual([n.correlationId, n.targetId, n.payload], ["session-42", expectedTarget, "audio"], `${label} ${n.phase}`);
  });
}

test("concurrent sessions never borrow each other's id", async () => {
  flags.sealed = false;
  const seen = [];
  gate.events.on("delivered", (n) => seen.push(n.correlationId));
  netFetchImpl = async () => new Response(JSON.stringify({ text: "hi" }), { status: 200 });
  await Promise.all([
    ipc.invoke("transcribe-audio-file-byok", audioRequest({ requestId: "r-a", correlationId: "session-a" })),
    ipc.invoke("transcribe-audio-file-byok", audioRequest({ requestId: "r-b", correlationId: "session-b" })),
  ]);
  assert.deepEqual(seen.sort(), ["session-a", "session-b"]);
});

test("Plan 04's disclosure tracker reads these notices correctly (when Plan 04 has merged)", async (t) => {
  const trackerPath = path.join(__dirname, "../../src/helpers/dictationDisclosure.js");
  if (!fs.existsSync(trackerPath)) return t.skip("Plan 04 has not merged; the notice shape is pinned above and in Task 5");
  const { createDisclosureTracker } = await import(trackerPath);
  flags.sealed = false;
  const bus = new EventEmitter();
  for (const phase of ["dispatched", "delivered", "undelivered"]) gate.events.on(phase, (n) => bus.emit("n", { phase, ...n }));
  const privacyApi = { onEgress: (cb) => (bus.on("n", cb), () => bus.off("n", cb)) };
  const tracker = createDisclosureTracker({ session: { id: "session-7" }, privacyApi });
  netFetchImpl = async () => new Response(JSON.stringify({ text: "hi" }), { status: 200 });
  await ipc.invoke("transcribe-audio-file-byok", audioRequest({ correlationId: "session-7" }));
  await ipc.invoke("transcribe-audio-file-byok", audioRequest({ correlationId: "someone-else" }));
  assert.deepEqual(tracker.get(), { target: "openai", payload: "audio", evidence: "attested", alsoSentTo: [] });
  // A token or model-list request (payload "metadata") never becomes disclosure.
  await gate.withContext({ correlationId: "session-7" }, () => gate.guard({ task: "dictationStt", target: "https://api.assemblyai.com", provider: "assemblyai" }, async (ticket) => ticket.markDelivered()));
  assert.equal(tracker.get().alsoSentTo.length, 0);
  tracker.dispose();
});

test("every proxy-*-transcription channel is in the matrix", () => {
  const listed = new Set(Object.values(BLOCKED).flat().map(([label]) => label));
  for (const channel of ipc.channels().filter((c) => /^proxy-.*-transcription$/.test(c))) assert.ok(listed.has(channel), channel);
});

test("interrupted: sealing during a captured-audio upload reports 'interrupted'", async () => {
  flags.sealed = false;
  netFetchImpl = (_url, init) => new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  const pending = outcomeOf(() => ipc.invoke("transcribe-audio-file-byok", audioRequest()));
  await new Promise((r) => setTimeout(r, 20));
  flags.sealed = true;
  gate.abortAllRemote();
  const outcome = await pending;
  assert.ok(refused(outcome));
  assert.equal(sealedPhaseOf(outcome.thrown ?? { message: outcome.value?.error }), "interrupted");
  assert.equal(recorder.list()[0].outcome, "cancelled");
});

test("local routes keep working while sealed", async () => {
  const server = http.createServer((_req, res) => res.end("{}"));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    netFetchImpl = async () => new Response(JSON.stringify({ text: "" }), { status: 200 });
    const m = stt.buildMultipartBody(Buffer.from("RIFF"), "a.wav", "audio/wav", {});
    await gate.withTask("dictationStt", () => stt.postMultipart(new URL(`http://127.0.0.1:${port}/inference`), m.body, m.boundary));
    assert.equal(transport.netFetch, 1, "self-hosted STT reached the (stubbed) transport");
    // The real model factory and SDK, against the local server: the request leaves the SDK and reaches it.
    const before = transport.nodeFetch;
    await outcomeOf(() => inference()("text-generate", ask({ provider: "local", baseUrl: `http://127.0.0.1:${port}/v1`, inferenceScope: "dictationCleanup" })));
    assert.ok(transport.nodeFetch > before, "the local inference request reached the transport");
    assert.equal(await (await originalFetch(`http://127.0.0.1:${port}/`)).text(), "{}");
    assert.equal(recorder.list().length, 0, "loopback is never recorded");
  } finally {
    server.close();
  }
});

test("Layer B: an un-gated request site is still refused", async () => {
  const req = https.request("https://new-feature.example/upload", { method: "POST" });
  req.end("content");
  const error = await new Promise((resolve) => req.once("error", resolve));
  assert.ok(isSealedModeError(error));
  assert.equal(recorder.list()[0].attributed, false);
});

test("every blocked inventory row is in this matrix", () => {
  const doc = fs.readFileSync(path.join(__dirname, "../../docs/security/sealed-mode-threat-model.md"), "utf8");
  const blocked = doc
    .split("\n")
    .filter((l) => /^\| N\d+ \|/.test(l) && /\| blocked \|/.test(l))
    .map((l) => l.match(/^\| (N\d+) \|/)[1]);
  // N25 (renderer documents) is Chromium-only; Task 16 proves it in Electron.
  const ELECTRON_ONLY = ["N25"];
  const covered = new Set([...Object.keys(BLOCKED), ...Object.keys(PREVENTED), ...ELECTRON_ONLY]);
  assert.deepEqual(blocked.filter((id) => !covered.has(id)), []);
});

test("all model managers download only through downloadUtils", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
  for (const file of ["src/helpers/whisper.js", "src/helpers/parakeet.js", "src/helpers/diarization.js", "src/helpers/modelManagerBridge.js", "src/helpers/localEmbeddings.js", "src/helpers/gpuBinaryManager.js"]) {
    assert.doesNotMatch(read(file), /\bnet\.(fetch|request)\s*\(|\bhttps?\.(get|request)\s*\(/, file);
  }
});
```

For the identity tests, give each request the fields the handler's route resolver reads for that provider: the custom endpoint URL key, and Corti's `cortiEnvironment` and `cortiTenant`. Find them with `grep -n "route\." src/helpers/ipcHandlers.js` around `:7967-8160`. Adjust the faked response bodies to whatever each helper parses. Never stub the helper itself, only `net.fetch`.

Rules for fixing a failing row:
- **A bypass-sensitivity test fails.** The refused row never reached its egress point. Supply the missing manager method or request field until the bypassed run reaches the transport. Never delete the row.
- **A handler fails before reaching its egress point** because a fake manager lacks a method or a request field is missing. Add the method to `managers`, or the field to that row's arguments, with a minimal value. Never stub the gate, `gatedNetFetch`, `postMultipart`, `connectRealtime` or `downloadFile`: those are what the row proves.
- **A row reaches a transport.** The gate is missing on that path. Fix the owning task's code (Tasks 8–11), never the assertions.
- **A discovered N9 channel takes different arguments.** Give it its own options object in the `BLOCKED.N9` mapping; keep it in the matrix.

- [ ] **Step 3: Run the matrix**

Run: `npm test -- test/helpers/sealedModeEnforcement.test.js`
Expected: PASS. There are two tests per variant (the refusal and its bypass-sensitivity run; about 80 in total, depending on how many realtime channels and token providers are discovered), plus 3 prevented rows and 12 other checks. Any failure names the inventory row and the channel whose enforcement is missing.

Then prove the matrix catches a regression. Each drill states what it proves:
- **A handler-local gate.** Temporarily delete the `egress.assertAllowed(...)` line from the `codex-status` handler. A later guard (the Codex server's `beforeSpawn`) still refuses, so the result can look the same. The row must still fail on its own check, `codexCalls === 0`: Codex was asked before anything refused.
- **An end-to-end gate.** Temporarily remove the `gatedNodeFetch(...)` argument from `probe-self-hosted`. The refusal then comes from Layer B, unattributed. The row must fail, because its ledger row is no longer a `providerCheck` block. Its bypass-sensitivity twin passes, because Layer B refused at the socket.

Restore both lines, and record the failing test names and their assertion messages in the PR description.

- [ ] **Step 4: Commit**

```bash
git add test/helpers/harness/ipcHandlersHarness.js test/helpers/sealedModeEnforcement.test.js
git commit -m "test(privacy): prove a sealed main process refuses every blocked request type through its real handlers"
```

---

### Task 13: Renderer integration: one sealed source, dictation pre-flight and recovery, inert remote images, honest failure copy

**Prerequisites.** Plan 03 has merged: `src/stores/sealedStore.ts`, `src/stores/routeFactsStore.ts` and `src/lib/routes.ts` exist. This task migrates `sealedStore.ts` (spec §5.4, 091d198); it does not create it, and it does not touch `routeFactsStore.ts`.

**Files:**
- Create:
  - `src/hooks/useSealedMode.ts`, the React hook over the sealed store (nothing else)
  - `src/lib/sealedMode.ts`
  - `src/lib/sealedRecovery.ts`
  - `src/utils/sealedModeError.ts`
  - `src/components/chat/chatErrorContent.ts`
  - `test/hooks/fakePrivacy.js` (a test helper)
- Modify:
  - `src/stores/sealedStore.ts` (Plan 03, Task 3): replace its internals with main's attestation, staleness and versioned reads. Keep `useSealedStore`, `getSealed()` and `ensureSealedSubscribed()` behaving as Plan 03's `test/stores/sealedStore.test.js` pins them, and add `getSealedSnapshot()`, `subscribeSealed()`, `setSealedMode()` and `ATTESTATION_MAX_AGE_MS`.
  - `src/lib/routes.ts` (Plan 03): the comment on `isSealedLocality` only. Its rule stays the single rule.
  - `src/components/ui/MarkdownRenderer.tsx`: remote images render as an inert placeholder unless main says the app is unsealed.
  - `src/components/chat/useChatStreaming.ts:536-546`.
  - `src/utils/localInferenceError.ts:53-63`.
  - `src/utils/recordingErrors.ts:12-31`.
  - `src/helpers/audioManager.js` (renderer code): the pre-flight in `startRecording` (`:1139-1153`); `_noteSealedFailure` and `transcribeRecovered`; and the pipeline `catch` (`:1903-1928`).
  - `src/hooks/useAudioRecording.js`: the "Transcribe" action and the notice on unseal.
- Test:
  - `test/lib/sealedMode.test.js`
  - `test/lib/sealedRecovery.test.js`
  - `test/utils/sealedModeError.test.js`
  - `test/stores/sealedStoreAttestation.test.js`
  - `test/stores/sealedStore.test.js` (Plan 03's, unchanged: it must still pass)
  - `test/lib/routesSealed.test.js`
  - `test/helpers/dictationPreflight.test.js`
  - `test/helpers/audioManagerSealed.test.js`
  - `test/components/markdownSealed.test.js`

**Interfaces:**
- Consumes:
  - `window.electronAPI.privacy`, including `onAttestation` (Task 7);
  - `buildRouteSnapshot(settings, facts, copy, sealed)`, `currentRouteCopy()`, `routeSnapshotFromSettings(settings)`, `resolveRoute` and `isSealedLocality` from `src/lib/routes.ts`, and `useRouteFactsStore` from `src/stores/routeFactsStore.ts` (Plan 03, §5.1);
  - `src/stores/sealedStore.ts` as Plan 03 created it (§5.4): `useSealedStore` (`{ sealed: boolean; known: boolean }`), `getSealed()`, `ensureSealedSubscribed()`;
  - `isLoopbackUrl` from `src/lib/locality.ts` (Plan 01, made to match main in Task 11a).
- Produces:

  ```ts
  // src/stores/sealedStore.ts: the one renderer authority (§5.4). Plan 03's API, kept:
  export const useSealedStore: UseBoundStore<StoreApi<{ sealed: boolean; known: boolean }>>;
  export function getSealed(): boolean;                 // sealed === true; unknown reads false (main enforces either way)
  export function ensureSealedSubscribed(): void;
  // Added by Plan 07:
  export type SealedSnapshot = { sealed: boolean | null; attestation: Attestation | null }; // known: false → sealed: null
  export function getSealedSnapshot(): SealedSnapshot;  // one cached object per change
  export function subscribeSealed(listener: () => void): () => void;   // calls ensureSealedSubscribed()
  export function setSealedMode(sealed: boolean): Promise<Attestation & { declined?: boolean }>;
  export const ATTESTATION_MAX_AGE_MS = 30_000;
  export function isAttestationFresh(a: Attestation | null, now?: number): boolean;   // now - a.at <= 30 s
  export function _resetSealedStoreForTests(): void;

  // src/hooks/useSealedMode.ts: only the React hook over that module.
  export function useSealedMode(): SealedSnapshot;

  // src/lib/sealedMode.ts. It asks Plan 03's resolver; the rule is isSealedLocality inside it.
  export function isDictationSealed(settings: SettingsState, sealed: boolean | null): boolean;  // the pre-flight

  // src/lib/sealedRecovery.ts. Renderer memory only; never written to disk.
  export const RECOVERY_TTL_MS: number;   // 30 minutes
  export const RECOVERY_MAX = 3;
  export function shouldHoldInMemory(error: unknown, retention: { dataRetentionEnabled: boolean; audioRetentionDays: number }): boolean;
  export function holdForRecovery(blob: Blob, metadata?: Record<string, unknown>, now?: number): number;  // the hold's id
  export function recoveryCount(now?: number): number;
  export function claimRecovery(now?: number): { id: number; blob: Blob; metadata: Record<string, unknown>; heldAt: number } | null; // oldest unclaimed; stays held
  export function releaseRecovery(id: number, o: { done: boolean }): void;  // done: remove; otherwise unclaim, so it can be tried again
  export function discardRecovery(): void;                                   // drops unclaimed holds only
  export function subscribeRecovery(listener: () => void): () => void;

  // src/utils/sealedModeError.ts
  export const SEALED_MODE = "SEALED_MODE";
  export function isSealedModeError(error: unknown): boolean;
  export function sealedPhase(error: unknown): "refused" | "interrupted" | null;
  export function sealedDictationMessageKey(error: unknown, s: { dataRetentionEnabled: boolean; audioRetentionDays: number }, o?: { held?: boolean }): string;

  // src/components/chat/chatErrorContent.ts
  export function chatErrorContent(error: unknown, t: (key: string) => string): string;
  ```

- **Copy rule.** "Nothing was sent" copy (`sealedMode.blocked.*`) is used only for phase `"refused"`. A request cut off mid-flight uses `sealedMode.interrupted.*`, which says the provider may have received part of it.
- **One sealed source (I8; spec §5.4, 091d198).** `src/stores/sealedStore.ts` is the only renderer module that reads `privacy.getSealed`, `onSealedChange`, `getAttestation` or `onAttestation`. Plan 03's route hooks, `routeSnapshotFromSettings`, the Apply bar and the Keyring already read `useSealedStore`/`getSealed()`. Replacing the store's internals therefore moves all of them at once, and nothing else is migrated. Unknown (`known: false`) is `sealed: null` in `getSealedSnapshot()`, and `false` in route snapshots, because main enforces the seal either way. `isSealedLocality(locality)` (P03 Task 1) stays the only rule for which routes Sealed mode pauses. This task adds no second one.
- **Pre-flight (owner decision 3, 2026-10-15).** While sealed, a dictation whose speech route is not on this device does not start, so nothing is recorded that main would refuse afterwards. The pre-flight is UX protection, not the recovery mechanism: it cannot help when the state is still unknown, or when the seal happens mid-recording.
- **Recovery (I6, I6-R2).** When main refuses or interrupts a dictation and retention would discard the audio (history off, or audio retention 0), the recording is held in renderer memory, at most `RECOVERY_MAX` recordings for `RECOVERY_TTL_MS`. It is never written to disk. The hold keeps the recording's metadata unchanged, including the session id and any `private` flag Plan 04 adds. The error notice offers "Transcribe". When Sealed mode turns off, a notice offers it again. Quitting or reloading the window drops it, and the copy says so. When retention keeps the audio, the existing History retry is the recovery and nothing is held.
  - **Both paths.**
    - **Batch:** the pipeline `catch` calls `_noteSealedFailure`.
    - **Streaming:** sealing closes the realtime socket in main, and the provider stops with no text. `audioManager` records that the seal arrived during the stream (from the sealed store, or a sealed error from the provider). The finalizer then preserves the fallback audio through the same path before its empty-result branch: a hold with history off, a failed History entry with history on, and a sealed notice. It never reports an empty success.
  - **Replay is atomic.**
    - `transcribeRecovered()` runs only when the audio manager is idle and no other replay is running. Otherwise it returns `busy` and leaves the hold alone.
    - It claims the hold, rather than taking it.
    - It removes the hold only when the replay produced a transcript. Any failure, cancellation or empty result releases it for another try. A sealed failure during a replay does not create a second hold.
- **Cleanup after local speech-to-text.** A refused cleanup step already falls back to the local transcript (`processWithReasoningModel`'s `catch`, `audioManager.js:2714-2738`, returns `normalizedText`). `test/helpers/audioManagerSealed.test.js` pins that for a `SEALED_MODE` error.
- **Remote images.** Markdown from a provider or a pasted note can name remote images. While sealed, or while the state is unknown, they render as a placeholder, so the page does not ask Chromium for them. Layer B would refuse the request anyway; the placeholder keeps the flight recorder free of unattributed noise and makes the reason visible. Links stay links: opening one goes through main's confirmation (Task 11).
- **Stale attestations (I5, I5-R2).** An attestation is shown for at most `ATTESTATION_MAX_AGE_MS` after main's `at`, never 30 s after it arrived:
  - its expiry timer gets only the remaining lifetime;
  - age is rechecked when the window regains focus or becomes visible, because timers are throttled while hidden and paused across sleep;
  - the panel checks `isAttestationFresh` on every render.

  A version watermark survives invalidation, so a late, older reply is never adopted after a newer claim expired. A stale claim drops to unknown, which the panel shows as "Checking…".

- [ ] **Step 1: Write the failing tests**

Create `test/lib/sealedSettings.js`, settings builders over Plan 03's `routeBaseState()` (`test/lib/routeStateFixture.js`), which has every route on the device:

```js
const { routeBaseState } = require("./routeStateFixture");

// Dictation through a cloud provider; everything else stays local.
const remoteDictation = () => ({ ...routeBaseState(), transcriptionMode: "providers", useLocalWhisper: false, cloudTranscriptionProvider: "openai" });
const localDictation = () => routeBaseState();
// The self-hosted mode value is SettingsState's own; check its transcriptionMode union if this name differs.
const selfHostedDictation = (url) => ({ ...routeBaseState(), transcriptionMode: "self-hosted", useLocalWhisper: false, remoteTranscriptionUrl: url });

module.exports = { remoteDictation, localDictation, selfHostedDictation };
```

Create `test/lib/sealedMode.test.js`. `sealedMode.ts` imports `routes.ts`, which is renderer code, so it loads through Plan 03's renderer harness (P03 module note M5):

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("./rendererTestHarness");
const { remoteDictation, localDictation, selfHostedDictation } = require("./sealedSettings");

async function load(t) {
  installBrowserGlobals(t, { window: { electronAPI: {} } });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-sealed-mode-test-" });
  return vite.ssrLoadModule("/lib/sealedMode.ts");
}

test("isDictationSealed: only a dictation route that leaves this computer, and only when sealed", async (t) => {
  const { isDictationSealed } = await load(t);
  assert.equal(isDictationSealed(remoteDictation(), true), true);
  assert.equal(isDictationSealed(localDictation(), true), false);
  assert.equal(isDictationSealed(selfHostedDictation("http://192.168.1.20:8178"), true), true, "a LAN server is another machine");
  assert.equal(isDictationSealed(selfHostedDictation("http://127.0.0.2:8178"), true), false, "loopback per Task 11a");
  assert.equal(
    isDictationSealed(selfHostedDictation("http://llm.localhost:8178"), true),
    false,
    "plain-HTTP *.localhost is loopback but refused: needsUrl, never sealed-blocked (§5 Locality row, §5.1 rule 10)"
  );
  assert.equal(isDictationSealed(remoteDictation(), false), false);
  assert.equal(isDictationSealed(remoteDictation(), null), false, "unknown claims nothing either way");
});

test("there is one sealed-route rule: sealedMode.ts defines none of its own", async (t) => {
  const mod = await load(t);
  assert.deepEqual(Object.keys(mod).sort(), ["isDictationSealed"]);
});
```

Create `test/lib/sealedRecovery.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const load = () => import("../../src/lib/sealedRecovery.ts");

const sealed = { code: "SEALED_MODE", message: "[SEALED_MODE] Sealed mode is on" };
const blob = (n) => new Blob([`audio-${n}`]);

test("held in memory only when Sealed mode blocked it and retention would discard the audio", async () => {
  const { shouldHoldInMemory } = await load();
  assert.equal(shouldHoldInMemory(sealed, { dataRetentionEnabled: false, audioRetentionDays: 30 }), true);
  assert.equal(shouldHoldInMemory(sealed, { dataRetentionEnabled: true, audioRetentionDays: 0 }), true);
  assert.equal(shouldHoldInMemory(sealed, { dataRetentionEnabled: false, audioRetentionDays: 0 }), true);
  assert.equal(shouldHoldInMemory(sealed, { dataRetentionEnabled: true, audioRetentionDays: 30 }), false, "History keeps it");
  assert.equal(shouldHoldInMemory(new Error("timeout"), { dataRetentionEnabled: false, audioRetentionDays: 0 }), false);
});

test("oldest first, bounded, and expired recordings are dropped", async (t) => {
  const r = await load();
  r.discardRecovery();
  t.after(() => r.discardRecovery());
  let notified = 0;
  const off = r.subscribeRecovery(() => notified++);
  r.holdForRecovery(blob(1), { n: 1 }, 0);
  r.holdForRecovery(blob(2), { n: 2 }, 10);
  r.holdForRecovery(blob(3), { n: 3 }, 20);
  r.holdForRecovery(blob(4), { n: 4 }, 30);
  assert.equal(r.recoveryCount(30), r.RECOVERY_MAX, "bounded");
  const claimed = r.claimRecovery(30);
  assert.equal(claimed.metadata.n, 2, "the oldest beyond the bound was dropped; then oldest first");
  r.releaseRecovery(claimed.id, { done: true });
  assert.equal(r.recoveryCount(20 + r.RECOVERY_TTL_MS + 1), 1, "expired entries go");
  off();
  assert.ok(notified >= 5);
});

test("a claim keeps the hold until the replay succeeds; a failed replay releases it for another try", async (t) => {
  const r = await load();
  r.discardRecovery();
  t.after(() => r.discardRecovery());
  const id = r.holdForRecovery(blob(1), { sessionId: "s-1", private: true }, 0);
  const first = r.claimRecovery(0);
  assert.equal(first.id, id);
  assert.equal(r.claimRecovery(0), null, "one claim at a time");
  r.discardRecovery();
  assert.equal(r.recoveryCount(0), 1, "discard never drops a hold that is being replayed");
  r.releaseRecovery(id, { done: false });
  const again = r.claimRecovery(0);
  assert.deepEqual([again.id, again.metadata], [id, { sessionId: "s-1", private: true }], "same bytes and context, still held");
  r.releaseRecovery(id, { done: true });
  assert.equal(r.recoveryCount(0), 0);
});

test("recovery never touches disk or IPC", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../src/lib/sealedRecovery.ts"), "utf8");
  assert.doesNotMatch(src, /electronAPI|localStorage|sessionStorage|indexedDB|saveTranscription|caches\./);
});
```

Create `test/utils/sealedModeError.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const load = () => import("../../src/utils/sealedModeError.ts");
const loadChat = () => import("../../src/components/chat/chatErrorContent.ts");
const loadLocal = () => import("../../src/utils/localInferenceError.ts");
const loadRecording = () => import("../../src/utils/recordingErrors.ts");

const t = (key) => `t:${key}`;
const refused = { code: "SEALED_MODE", message: "[SEALED_MODE] Sealed mode is on" };
const interrupted = { code: "SEALED_MODE", message: "[SEALED_MODE:interrupted] stopped" };

test("recognises the code, the IPC message markers and wrapped causes", async () => {
  const { isSealedModeError, sealedPhase } = await load();
  assert.equal(isSealedModeError({ code: "SEALED_MODE" }), true);
  assert.equal(isSealedModeError(new Error("Error invoking remote method 'x': [SEALED_MODE] Sealed mode is on")), true);
  assert.equal(isSealedModeError(new TypeError("fetch failed", { cause: { code: "SEALED_MODE" } })), true);
  assert.equal(isSealedModeError(new Error("timeout")), false);
  assert.equal(sealedPhase(refused), "refused");
  assert.equal(sealedPhase(new Error(`remote: ${interrupted.message}`)), "interrupted");
  assert.equal(sealedPhase(new Error("timeout")), null);
});

test("dictation copy: History is promised only when retention kept the audio; interruption never says 'nothing sent'", async () => {
  const { sealedDictationMessageKey } = await load();
  assert.equal(sealedDictationMessageKey(refused, { dataRetentionEnabled: true, audioRetentionDays: 30 }), "sealedMode.blocked.dictationKept");
  assert.equal(sealedDictationMessageKey(refused, { dataRetentionEnabled: true, audioRetentionDays: 0 }), "sealedMode.blocked.dictationNotKept");
  assert.equal(sealedDictationMessageKey(refused, { dataRetentionEnabled: false, audioRetentionDays: 30 }), "sealedMode.blocked.dictationNotKept");
  assert.equal(sealedDictationMessageKey(interrupted, { dataRetentionEnabled: true, audioRetentionDays: 30 }), "sealedMode.interrupted.dictationKept");
  assert.equal(sealedDictationMessageKey(interrupted, { dataRetentionEnabled: false, audioRetentionDays: 0 }), "sealedMode.interrupted.dictationNotKept");
  assert.equal(sealedDictationMessageKey(refused, { dataRetentionEnabled: false, audioRetentionDays: 0 }, { held: true }), "sealedMode.blocked.dictationHeld");
  assert.equal(sealedDictationMessageKey(interrupted, { dataRetentionEnabled: true, audioRetentionDays: 0 }, { held: true }), "sealedMode.interrupted.dictationHeld");
});

test("chat keeps the message and says why, by phase", async () => {
  const { chatErrorContent } = await loadChat();
  assert.equal(chatErrorContent(refused, t), "t:sealedMode.blocked.chat");
  assert.equal(chatErrorContent(interrupted, t), "t:sealedMode.interrupted.chat");
  assert.equal(chatErrorContent(new Error("rate limited"), t), "t:agentMode.chat.errorPrefix: rate limited");
});

test("local inference and recording errors map SEALED_MODE to translated copy", async () => {
  const { buildLocalInferenceError } = await loadLocal();
  assert.equal(buildLocalInferenceError({ success: false, error: refused.message, code: "SEALED_MODE" }).messageKey, "sealedMode.blocked.generic");
  assert.equal(buildLocalInferenceError({ success: false, error: interrupted.message, code: "SEALED_MODE" }).messageKey, "sealedMode.interrupted.generic");
  const { getRecordingErrorTitle } = await loadRecording();
  assert.equal(getRecordingErrorTitle({ code: "SEALED_MODE", title: "raw" }, t), "t:sealedMode.blocked.dictationTitle");
});
```

Create `test/stores/sealedStoreAttestation.test.js`. `sealedStore.ts` imports only `zustand` and types, so `tsx` loads it directly:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const load = () => import("../../src/stores/sealedStore.ts");
const { fakePrivacy, tick } = require("../hooks/fakePrivacy");

test("unknown until main answers; then follows main's broadcasts", async (t) => {
  const store = await load();
  store._resetSealedStoreForTests();
  const fake = fakePrivacy();
  globalThis.window = { electronAPI: { privacy: fake.api } };
  t.after(() => { delete globalThis.window; store._resetSealedStoreForTests(); });
  assert.deepEqual(store.getSealedSnapshot(), { sealed: null, attestation: null });
  let notified = 0;
  store.subscribeSealed(() => notified++);
  await tick();
  assert.equal(store.getSealedSnapshot().sealed, true);
  assert.equal(store.getSealedSnapshot().attestation.nothingLeaves, true);
  fake.listeners.attestation({ sealed: true, nothingLeaves: false, version: 5 });
  assert.equal(store.getSealedSnapshot().attestation.version, 5, "main pushes attestation changes");
  fake.listeners.sealed(false);
  assert.equal(store.getSealedSnapshot().sealed, false);
  assert.ok(notified >= 3);
});

test("Plan 03's API keeps working over the new internals", async (t) => {
  const store = await load();
  store._resetSealedStoreForTests();
  const fake = fakePrivacy({ pending: true }); // getSealed never answers
  globalThis.window = { electronAPI: { privacy: fake.api } };
  t.after(() => { delete globalThis.window; store._resetSealedStoreForTests(); });
  store.ensureSealedSubscribed();
  await tick();
  assert.deepEqual(store.useSealedStore.getState(), { sealed: false, known: false });
  assert.equal(store.getSealed(), false, "unknown reads false for route snapshots");
  assert.equal(store.getSealedSnapshot().sealed, null, "and null for anything that makes a claim");
  fake.listeners.sealed(true);
  assert.deepEqual(store.useSealedStore.getState(), { sealed: true, known: true });
  assert.equal(store.getSealed(), true);
  assert.equal(store.getSealedSnapshot().sealed, true);
});

test("the snapshot object is stable until something changes (useSyncExternalStore)", async (t) => {
  const store = await load();
  store._resetSealedStoreForTests();
  const fake = fakePrivacy();
  globalThis.window = { electronAPI: { privacy: fake.api } };
  t.after(() => { delete globalThis.window; store._resetSealedStoreForTests(); });
  store.subscribeSealed(() => {});
  await tick();
  const a = store.getSealedSnapshot();
  assert.equal(store.getSealedSnapshot(), a);
  fake.listeners.sealed(false);
  assert.notEqual(store.getSealedSnapshot(), a);
});

test("an older attestation never replaces a newer one", async (t) => {
  const store = await load();
  store._resetSealedStoreForTests();
  const fake = fakePrivacy();
  globalThis.window = { electronAPI: { privacy: fake.api } };
  t.after(() => { delete globalThis.window; store._resetSealedStoreForTests(); });
  store.subscribeSealed(() => {});
  await tick();
  fake.listeners.attestation({ sealed: true, nothingLeaves: true, version: 9 });
  fake.listeners.attestation({ sealed: true, nothingLeaves: false, version: 8 });
  assert.equal(store.getSealedSnapshot().attestation.version, 9);
});

test("a failed attestation read drops to unknown rather than keeping a stale claim", async (t) => {
  const store = await load();
  store._resetSealedStoreForTests();
  globalThis.window = { electronAPI: { privacy: fakePrivacy({ failAttestation: true }).api } };
  t.after(() => { delete globalThis.window; store._resetSealedStoreForTests(); });
  store.subscribeSealed(() => {});
  await tick();
  assert.equal(store.getSealedSnapshot().attestation, null);
});

test("setSealedMode adopts main's answer, including a declined unseal", async (t) => {
  const store = await load();
  store._resetSealedStoreForTests();
  const fake = fakePrivacy({ sealed: true });
  fake.api.setSealed = async () => ({ sealed: true, nothingLeaves: true, version: 3, declined: true });
  globalThis.window = { electronAPI: { privacy: fake.api } };
  t.after(() => { delete globalThis.window; store._resetSealedStoreForTests(); });
  const result = await store.setSealedMode(false);
  assert.equal(result.declined, true);
  assert.equal(store.getSealedSnapshot().sealed, true);
});

test("a claim delivered late lives only until main's at + 30 s, not 30 s after arrival", async (t) => {
  const store = await load();
  store._resetSealedStoreForTests();
  const fake = fakePrivacy();
  fake.api.getAttestation = async () => ({ sealed: true, nothingLeaves: true, version: 1, at: Date.now() });
  globalThis.window = { electronAPI: { privacy: fake.api } };
  t.after(() => { delete globalThis.window; store._resetSealedStoreForTests(); });
  store.subscribeSealed(() => {});
  await tick();
  fake.listeners.attestation({ sealed: true, nothingLeaves: true, version: 7, at: Date.now() - store.ATTESTATION_MAX_AGE_MS + 40 });
  assert.equal(store.getSealedSnapshot().attestation.version, 7, "fresh for 40 more ms");
  await new Promise((r) => setTimeout(r, 80));
  assert.notEqual(store.getSealedSnapshot().attestation?.version, 7, "gone at at + 30 s, not 30 s after it arrived");
});

test("after a claim expires, a late older reply is never adopted", async (t) => {
  const store = await load();
  store._resetSealedStoreForTests();
  const fake = fakePrivacy();
  let refetch;
  fake.api.getAttestation = () => new Promise((r) => { refetch = r; });
  globalThis.window = { electronAPI: { privacy: fake.api } };
  t.after(() => { delete globalThis.window; store._resetSealedStoreForTests(); });
  store.subscribeSealed(() => {});
  fake.listeners.attestation({ sealed: true, nothingLeaves: true, version: 9, at: Date.now() - store.ATTESTATION_MAX_AGE_MS - 1 });
  assert.equal(store.getSealedSnapshot().attestation, null, "stale on arrival: unknown");
  refetch({ sealed: true, nothingLeaves: true, version: 8, at: Date.now() }); // a reply that left main before version 9
  await tick();
  assert.equal(store.getSealedSnapshot().attestation, null, "the watermark outlives the expired claim");
  fake.listeners.attestation({ sealed: true, nothingLeaves: false, version: 10, at: Date.now() });
  assert.equal(store.getSealedSnapshot().attestation.version, 10, "a newer push is adopted");
});

test("a failed refresh while a newer push arrives keeps the newer push", async (t) => {
  const store = await load();
  store._resetSealedStoreForTests();
  const fake = fakePrivacy();
  let fail;
  fake.api.getAttestation = () => new Promise((_r, reject) => { fail = reject; });
  globalThis.window = { electronAPI: { privacy: fake.api } };
  t.after(() => { delete globalThis.window; store._resetSealedStoreForTests(); });
  store.subscribeSealed(() => {});
  fake.listeners.attestation({ sealed: true, nothingLeaves: true, version: 3, at: Date.now() });
  fail(new Error("ipc")); // the refresh started before version 3 arrived
  await tick();
  assert.equal(store.getSealedSnapshot().attestation.version, 3, "an older read's failure does not erase a newer push");
  fake.listeners.attestation({ sealed: true, nothingLeaves: true, version: 4, at: Date.now() });
  assert.equal(store.getSealedSnapshot().attestation.version, 4);
});

test("an attestation older than 30 s is dropped to unknown and re-fetched", async (t) => {
  const store = await load();
  store._resetSealedStoreForTests();
  const fake = fakePrivacy();
  let fetches = 0;
  fake.api.getAttestation = async () => { fetches++; return { sealed: true, nothingLeaves: true, version: 10 + fetches, at: Date.now() }; };
  globalThis.window = { electronAPI: { privacy: fake.api } };
  t.after(() => { delete globalThis.window; store._resetSealedStoreForTests(); });
  store.subscribeSealed(() => {});
  await tick();
  assert.equal(store.getSealedSnapshot().attestation.version, 11);
  fake.listeners.attestation({ sealed: true, nothingLeaves: true, version: 50, at: Date.now() - store.ATTESTATION_MAX_AGE_MS - 1 });
  assert.equal(store.getSealedSnapshot().attestation, null, "a stale claim is not shown, even with a higher version");
  await tick();
  assert.equal(fetches, 2, "a fresh one was requested");
  assert.equal(store.getSealedSnapshot().attestation.version, 12);
});

test("a build without the privacy bridge cannot be sealed, and that is known (Plan 03's rule)", async (t) => {
  const store = await load();
  store._resetSealedStoreForTests();
  globalThis.window = { electronAPI: {} };
  t.after(() => { delete globalThis.window; store._resetSealedStoreForTests(); });
  store.subscribeSealed(() => {});
  await tick();
  assert.deepEqual(store.getSealedSnapshot(), { sealed: false, attestation: null });
});
```

Create `test/hooks/fakePrivacy.js`, the shared fake of main's privacy bridge:

```js
// A fake window.electronAPI.privacy that a test drives by calling the
// registered listeners, the way main's broadcasts would.
// pending: getSealed never answers, so the state stays unknown until an event.
function fakePrivacy({ sealed = true, failAttestation = false, pending = false } = {}) {
  const listeners = {};
  const attestation = { sealed, nothingLeaves: sealed, effectiveSince: 1, blockedSinceSealed: 0, version: 1, at: Date.now() };
  return {
    listeners,
    api: {
      getSealed: () => (pending ? new Promise(() => {}) : Promise.resolve(sealed)),
      getAttestation: async () => { if (failAttestation) throw new Error("ipc"); return { ...attestation, at: Date.now() }; },
      setSealed: async (next) => ({ ...attestation, sealed: next, nothingLeaves: next, version: 2, at: Date.now() }),
      onSealedChange: (cb) => { listeners.sealed = cb; return () => {}; },
      onAttestation: (cb) => { listeners.attestation = cb; return () => {}; },
    },
  };
}
const tick = () => new Promise((r) => setImmediate(r));

module.exports = { fakePrivacy, tick };
```

Create `test/lib/routesSealed.test.js`. This is the cross-plan check (I8): one event from main, through the migrated store, reaches Plan 03's route snapshot, its resolver and the pre-flight in the same tick. It loads through Plan 03's renderer harness (P03 module note M5):

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("./rendererTestHarness");
const { fakePrivacy, tick } = require("../hooks/fakePrivacy");
const { remoteDictation } = require("./sealedSettings");

const SEALED = { status: "unreachable", detail: "sealed" };

async function load(t, privacy) {
  installBrowserGlobals(t, { window: { electronAPI: { privacy } } });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-routes-sealed-test-" });
  return {
    store: await vite.ssrLoadModule("/stores/sealedStore.ts"),
    routes: await vite.ssrLoadModule("/lib/routes.ts"),
    preflight: await vite.ssrLoadModule("/lib/sealedMode.ts"),
  };
}

test("one event from main reaches the store, the route snapshot, the resolver and the pre-flight together", async (t) => {
  const fake = fakePrivacy({ sealed: false });
  const m = await load(t, fake.api);
  m.store.ensureSealedSubscribed();
  await tick();
  const settings = remoteDictation();
  const dictation = () => m.routes.resolveRoute(m.routes.routeSnapshotFromSettings(settings), "dictationStt");
  const preflight = () => m.preflight.isDictationSealed(settings, m.store.getSealedSnapshot().sealed);

  assert.equal(m.routes.routeSnapshotFromSettings(settings).sealed, false);
  assert.notDeepEqual(dictation().state, SEALED);
  assert.equal(preflight(), false);

  fake.listeners.sealed(true);
  assert.deepEqual(m.store.useSealedStore.getState(), { sealed: true, known: true }, "Plan 03's consumers read this");
  assert.equal(m.routes.routeSnapshotFromSettings(settings).sealed, true);
  assert.deepEqual(dictation().state, SEALED);
  assert.equal(preflight(), true);

  fake.listeners.sealed(false);
  assert.notDeepEqual(dictation().state, SEALED);
  assert.equal(preflight(), false);
});

test("unknown is null for claims and false for route snapshots", async (t) => {
  const m = await load(t, fakePrivacy({ pending: true }).api);
  m.store.ensureSealedSubscribed();
  await tick();
  assert.equal(m.store.getSealedSnapshot().sealed, null);
  assert.equal(m.routes.routeSnapshotFromSettings(remoteDictation()).sealed, false);
  assert.equal(m.preflight.isDictationSealed(remoteDictation(), m.store.getSealedSnapshot().sealed), false);
});

test("only the sealed store reads sealed state from the privacy bridge", () => {
  const root = path.join(__dirname, "../../src");
  const offenders = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?)$/.test(name) && !full.endsWith(path.join("stores", "sealedStore.ts")) && !full.includes(`${path.sep}types${path.sep}`)) {
        if (/privacy\??\.(getSealed|onSealedChange|getAttestation|onAttestation)\b/.test(fs.readFileSync(full, "utf8"))) offenders.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], "spec §5.4: no other renderer module reads these");
});
```

Plan 03's own tests already pin that the Apply bar and the Keyring follow `useSealedStore` (its route-draft test "sealed blocks Apply but never a move onto the device", and the Keyring panel tests). Because this task changes only the store's internals, those tests stay as they are and must keep passing.

Create `test/helpers/dictationPreflight.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("startRecording checks the pre-flight before opening the microphone", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../src/helpers/audioManager.js"), "utf8");
  const start = src.indexOf("async startRecording(");
  const body = src.slice(start, src.indexOf("_acquireCaptureStream(", start));
  assert.match(body, /isDictationSealed\(getSettings\(\), getSealedSnapshot\(\)\.sealed\)/);
});
```

Create `test/helpers/audioManagerSealed.test.js`. It drives the real `AudioManager` through the shared Vite SSR harness (`test/helpers/harness/audioManager.js`):

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { loadAudioManager } = require("./harness/audioManager");

const sealedError = () => Object.assign(new Error("[SEALED_MODE] Sealed mode is on"), { code: "SEALED_MODE" });

async function setup(t, settings) {
  const loaded = await loadAudioManager(t, {
    cachePrefix: "loqui-audio-sealed-",
    settingsKey: "__audioSealedSettings",
    settings: { preferredLanguage: "en", ...settings },
  });
  const recovery = await loaded.vite.ssrLoadModule("/lib/sealedRecovery.ts");
  recovery.discardRecovery();
  return { ...loaded, recovery };
}

for (const [label, retention, held] of [
  ["history off", { dataRetentionEnabled: false, audioRetentionDays: 30 }, true],
  ["audio retention 0", { dataRetentionEnabled: true, audioRetentionDays: 0 }, true],
  ["history and audio kept", { dataRetentionEnabled: true, audioRetentionDays: 30 }, false],
]) {
  test(`a sealed failure with ${label}: held in memory = ${held}`, async (t) => {
    const { createManager, recovery } = await setup(t, retention);
    const audio = new Blob(["pcm"]);
    const manager = createManager({ lastAudioBlob: audio, lastAudioMetadata: { durationSeconds: 2 } });
    const error = sealedError();
    manager._noteSealedFailure(error);
    assert.equal(recovery.recoveryCount(), held ? 1 : 0);
    assert.equal(error.recoveryHeld === true, held);
    assert.match(error.messageKey, held ? /\.dictationHeld$/ : /\.dictationKept$/);
    if (held) assert.equal(recovery.claimRecovery().blob, audio, "the same bytes, not a copy on disk");
  });
}

// The real processAudio runs; only the transcription transport is faked.
function replayManager(createManager, transcribe) {
  const completions = [];
  const errors = [];
  const manager = createManager({
    isRecording: false, isProcessing: false, isStreaming: false, _startInProgress: false,
    _localSpeechGateState: null, voiceAgentRequested: false, translationRequested: false,
    pendingCleanupFailure: null, pendingAssistantConversation: null, pendingSelectionEdit: null,
    processWithOpenAIAPI: transcribe,
    processTranscriptionCore: async (text) => text,
    onTranscriptionComplete: (r) => completions.push(r),
    onError: (e) => errors.push(e),
    onStateChange() {},
  });
  return { manager, completions, errors };
}

test("replay: a transcript removes the hold; the real pipeline ran", async (t) => {
  const { createManager, recovery } = await setup(t, { dataRetentionEnabled: false, audioRetentionDays: 0, useLocalWhisper: false });
  const audio = new Blob(["pcm"]);
  recovery.holdForRecovery(audio, { durationSeconds: 2, sessionId: "s-9" });
  const seen = [];
  const { manager, completions } = replayManager(createManager, async (blob, metadata) => {
    seen.push([blob, metadata.sessionId]);
    return { success: true, text: "hello" };
  });
  assert.deepEqual(await manager.transcribeRecovered(), { started: true, succeeded: true });
  assert.deepEqual(seen, [[audio, "s-9"]], "the same bytes and session context were replayed");
  assert.equal(completions.at(-1)?.text, "hello");
  assert.equal(recovery.recoveryCount(), 0);
});

test("replay: a non-sealed failure keeps the only copy; a sealed failure keeps it without a duplicate", async (t) => {
  const { createManager, recovery } = await setup(t, { dataRetentionEnabled: false, audioRetentionDays: 0, useLocalWhisper: false });
  recovery.holdForRecovery(new Blob(["pcm"]), {});
  const failing = replayManager(createManager, async () => { throw new Error("network down"); });
  assert.deepEqual(await failing.manager.transcribeRecovered(), { started: true, succeeded: false });
  assert.equal(recovery.recoveryCount(), 1, "kept for another try");
  const sealed = replayManager(createManager, async () => { throw sealedError(); });
  await sealed.manager.transcribeRecovered();
  assert.equal(recovery.recoveryCount(), 1, "still one hold, not two");
  assert.equal(sealed.errors.at(-1).recoveryHeld, true);
});

test("replay: refused while busy, and only one replay at a time", async (t) => {
  const { createManager, recovery } = await setup(t, { dataRetentionEnabled: false, audioRetentionDays: 0, useLocalWhisper: false });
  recovery.holdForRecovery(new Blob(["pcm"]), {});
  let release;
  const { manager } = replayManager(createManager, () => new Promise((r) => { release = () => r({ success: true, text: "x" }); }));
  manager.isRecording = true;
  assert.deepEqual(await manager.transcribeRecovered(), { started: false, reason: "busy" });
  manager.isRecording = false;
  const first = manager.transcribeRecovered();
  assert.deepEqual(await manager.transcribeRecovered(), { started: false, reason: "busy" }, "a double click starts nothing");
  release();
  assert.equal((await first).succeeded, true);
  assert.equal(recovery.recoveryCount(), 0);
});

for (const [label, retention, held] of [
  ["history off", { dataRetentionEnabled: false, audioRetentionDays: 30 }, true],
  ["history and audio kept", { dataRetentionEnabled: true, audioRetentionDays: 30 }, false],
]) {
  test(`streaming sealed mid-dictation with no text (${label}): the audio is preserved, not reported as an empty success`, async (t) => {
    const { createManager, recovery } = await setup(t, retention);
    const audio = new Blob(["fallback-pcm"]);
    const completions = [];
    const errors = [];
    const saved = [];
    // The real finalizer runs; its audio, provider and timer collaborators are stubbed.
    const manager = createManager({
      _activeStreamingSessionId: null, _streamingCancellationGeneration: 0, recordingStartTime: Date.now() - 3000,
      micRecovery: { stop() {} }, _streamingMicSwapPromise: null, streamingProcessor: null, streamingSource: null,
      finishStreamingFallbackSegment: async () => {}, mergeRecordedSegments: async () => audio, _streamingFallbackSegments: [audio],
      streamingFallbackRecorder: null, streamingStream: null, streamingFinalText: "", streamingPartialText: "",
      getStreamingProvider: () => ({ finalize() {}, awaitsFinalTranscript: false, stop: async () => { throw sealedError(); } }),
      cleanupStreamingListeners() {}, _streamingSealed: true,
      onStateChange() {}, onError: (e) => errors.push(e), onTranscriptionComplete: (r) => completions.push(r),
      saveFailedTranscription: async (...args) => saved.push(args),
    });
    assert.equal(await manager._finalizeStreamingRecording(null), true);
    assert.deepEqual(completions, [], "no empty success");
    assert.equal(errors[0].code, "SEALED_MODE");
    assert.equal(errors[0].recoveryHeld, held);
    assert.equal(recovery.recoveryCount(), held ? 1 : 0);
    if (held) assert.equal(recovery.claimRecovery().blob, audio);
    assert.equal(saved.length, 1, "History gets its failed entry whenever retention keeps audio");
  });
}

test("startRecording refuses before the microphone opens when the pre-flight says sealed", async (t) => {
  globalThis.__preflightSealed = true;
  t.after(() => delete globalThis.__preflightSealed);
  const { createManager } = await loadAudioManager(t, {
    cachePrefix: "loqui-audio-preflight-",
    settingsKey: "__audioPreflightSettings",
    settings: { preferredLanguage: "en" },
    mockModules: {
      // The real store and resolver are covered by sealedMode.test.js and
      // routesSealed.test.js; this test pins where startRecording asks.
      "/stores/sealedStore": "export const getSealedSnapshot = () => ({ sealed: globalThis.__preflightSealed, attestation: null });",
      "/lib/sealedMode": "export const isDictationSealed = (_settings, sealed) => sealed === true;",
    },
  });
  const opened = [];
  const errors = [];
  const manager = createManager({
    isRecording: false, isProcessing: false, isStreaming: false, _streamingStopPromise: null, mediaRecorder: null,
    preparedMicCapture: { take: async () => { opened.push("prepared"); return null; } },
    getAudioConstraints: async () => { opened.push("constraints"); return {}; },
    _startPcmTap: () => { opened.push("tap"); return null; },
    _acquireCaptureStream: async () => { opened.push("mic"); throw new Error("mic opened"); },
    onError: (error) => errors.push(error),
  });
  assert.equal(await manager.startRecording(), false);
  assert.deepEqual(opened, [], "nothing about the microphone was touched");
  assert.equal(errors[0].code, "SEALED_MODE");
  assert.equal(errors[0].title, "sealedMode.blocked.dictationPreflight");

  globalThis.__preflightSealed = null; // unknown never blocks
  await manager.startRecording().catch(() => {});
  assert.ok(opened.length > 0, "with the state unknown, recording proceeds");
});

test("a refused cleanup after local speech-to-text keeps the local transcript", async (t) => {
  const { createManager } = await setup(t, { useCleanupModel: true, useDictationAgent: false, useDictationTranslation: false });
  const manager = createManager({
    voiceAgentRequested: false, translationRequested: false, pendingCleanupFailure: null,
    pendingAssistantConversation: null, pendingSelectionEdit: null,
    isReasoningAvailable: async () => true,
    processWithReasoningModel: async () => { throw sealedError(); },
  });
  assert.equal(await manager.processTranscriptionCore("original dictation", "local"), "original dictation");
});
```

Match the `mockModules` keys to the style the harness already uses (`"/stores/settingsStore"`, without the extension). `startRecording`'s `finally` block may touch more fields than the ones stubbed above; add the minimal ones it reads. If the shared harness needs more store stubs for these settings, pass them through `mockModules`, as `test/helpers/audioManagerCleanupFallback.test.js` does. Do not stub `/lib/sealedRecovery.ts` or `/utils/sealedModeError.ts`: they are under test.

Create `test/components/markdownSealed.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");
const { fakePrivacy, tick } = require("../hooks/fakePrivacy");

const content = "![chart](https://images.example/c.png) ![local](http://127.0.0.1:8080/a.png) [docs](https://docs.example/x)";

async function render(t, sealed) {
  const store = await import("../../src/stores/sealedStore.ts");
  store._resetSealedStoreForTests();
  globalThis.window = { electronAPI: { privacy: sealed === null ? fakePrivacy({ pending: true }).api : fakePrivacy({ sealed }).api } };
  t.after(() => { delete globalThis.window; store._resetSealedStoreForTests(); });
  store.subscribeSealed(() => {});
  await tick();
  const { MarkdownRenderer } = await import("../../src/components/ui/MarkdownRenderer.tsx");
  return renderStatic(MarkdownRenderer, { content });
}

test("sealed: remote images are inert placeholders; loopback images and links stay", async (t) => {
  const html = await render(t, true);
  assert.doesNotMatch(html, /<img[^>]+images\.example/);
  assert.match(html, /sealedMode\.markdown\.imageBlocked/);
  assert.match(html, /<img[^>]+127\.0\.0\.1/);
  assert.match(html, /<a[^>]+href="https:\/\/docs\.example\/x"/, "opening a link goes through main's confirmation (Task 11)");
});

test("unknown state: remote images stay inert", async (t) => {
  assert.doesNotMatch(await render(t, null), /<img[^>]+images\.example/);
});

test("unsealed: remote images render", async (t) => {
  assert.match(await render(t, false), /<img[^>]+images\.example/);
});
```

`renderToStaticMarkup` does not run effects, and `useSyncExternalStore` reads `getServerSnapshot` during SSR. So `useSealedMode` must pass `getSealedSnapshot` (not a constant) as the third argument; Step 3 does. The "unknown" case uses a privacy fake whose `getSealed` never answers: a build with no privacy bridge at all is known and unsealed (Plan 03's rule). If the `react-i18next` import needs a stub under the tsx loader, use Plan 03's `test/lib/i18nTestMock.js`. The placeholder renders the translation key, which the assertion expects.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/lib/sealedMode.test.js test/lib/sealedRecovery.test.js test/utils/sealedModeError.test.js test/stores/sealedStoreAttestation.test.js test/lib/routesSealed.test.js test/helpers/dictationPreflight.test.js test/helpers/audioManagerSealed.test.js test/components/markdownSealed.test.js`
Expected: FAIL. The modules are missing, `sealedStore.ts` has no attestation or snapshot, `startRecording` has no pre-flight, nothing is held for recovery, and remote images render.

- [ ] **Step 3: Implement the pure modules**

Create `src/lib/sealedMode.ts`:

```ts
import { buildRouteSnapshot, currentRouteCopy, resolveRoute } from "./routes";
import { useRouteFactsStore } from "../stores/routeFactsStore";

// The dictation pre-flight: while sealed, a dictation whose speech route would
// leave this computer is not started, so there is no recording for main to
// refuse. It adds no rule of its own: it asks Plan 03's resolver, which applies
// isSealedLocality and its own precedence (an invalid endpoint, such as
// plain-HTTP *.localhost, is needsUrl and never sealed; §5.1 rule 10). Unknown
// (null) never blocks. The snapshot is built with sealed = true from the
// caller's answer, so the check is decided by that answer, not re-read.
export function isDictationSealed(settings: Parameters<typeof buildRouteSnapshot>[0], sealed: boolean | null): boolean {
  if (sealed !== true) return false;
  const snapshot = buildRouteSnapshot(settings, useRouteFactsStore.getState().facts, currentRouteCopy(), true);
  const { state } = resolveRoute(snapshot, "dictationStt");
  return state.status === "unreachable" && state.detail === "sealed";
}
```

Create `src/lib/sealedRecovery.ts`:

```ts
import { isSealedModeError } from "../utils/sealedModeError";

// Dictations that Sealed mode refused or interrupted while retention would have
// discarded the audio. Renderer memory only: never written to disk, gone on
// quit or reload, and dropped after RECOVERY_TTL_MS. Bounded so a long sealed
// session cannot grow without limit.
export const RECOVERY_TTL_MS = 30 * 60 * 1000;
export const RECOVERY_MAX = 3;

type Held = { id: number; blob: Blob; metadata: Record<string, unknown>; heldAt: number; claimed: boolean };
let held: Held[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

function expire(now: number) {
  // A hold that is being replayed never expires under the replay.
  const kept = held.filter((h) => h.claimed || now - h.heldAt <= RECOVERY_TTL_MS);
  if (kept.length !== held.length) {
    held = kept;
    notify();
  }
}

export function shouldHoldInMemory(
  error: unknown,
  retention: { dataRetentionEnabled: boolean; audioRetentionDays: number }
): boolean {
  return isSealedModeError(error) && !(retention.dataRetentionEnabled && retention.audioRetentionDays > 0);
}

export function holdForRecovery(blob: Blob, metadata: Record<string, unknown> = {}, now = Date.now()): number {
  const id = nextId++;
  // Over the bound, the oldest unclaimed hold goes; a claimed one is never dropped.
  held = [...held, { id, blob, metadata: { ...metadata }, heldAt: now, claimed: false }];
  while (held.length > RECOVERY_MAX) {
    const victim = held.findIndex((h) => !h.claimed);
    if (victim === -1) break;
    held.splice(victim, 1);
  }
  notify();
  return id;
}

export function recoveryCount(now = Date.now()): number {
  expire(now);
  return held.length;
}

// Replays claim a hold instead of taking it, so the only copy survives a
// failed, cancelled or empty replay (I6-R2). One claim at a time.
export function claimRecovery(now = Date.now()): Held | null {
  expire(now);
  if (held.some((h) => h.claimed)) return null;
  const first = held.find((h) => !h.claimed);
  if (!first) return null;
  first.claimed = true;
  notify();
  return first;
}

export function releaseRecovery(id: number, { done }: { done: boolean }): void {
  const entry = held.find((h) => h.id === id);
  if (!entry) return;
  if (done) held = held.filter((h) => h.id !== id);
  else entry.claimed = false;
  notify();
}

export function discardRecovery(): void {
  const kept = held.filter((h) => h.claimed);
  if (kept.length === held.length) return;
  held = kept;
  notify();
}

export function subscribeRecovery(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
```

Create `src/utils/sealedModeError.ts`:

```ts
// Mirrors src/helpers/privacy/egressPolicy.js. ipcMain.handle keeps only the
// message of a rejected promise, so main also puts the code and phase in the text.
export const SEALED_MODE = "SEALED_MODE";

type Errorish = { code?: unknown; message?: unknown; cause?: unknown; details?: { phase?: unknown } };

export function isSealedModeError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 3) return false;
  const e = error as Errorish;
  if (e.code === SEALED_MODE) return true;
  if (typeof e.message === "string" && e.message.includes(`[${SEALED_MODE}`)) return true;
  return isSealedModeError(e.cause, depth + 1);
}

export function sealedPhase(error: unknown, depth = 0): "refused" | "interrupted" | null {
  if (!error || typeof error !== "object" || depth > 3) return null;
  const e = error as Errorish;
  if (e.details?.phase === "refused" || e.details?.phase === "interrupted") return e.details.phase;
  if (typeof e.message === "string") {
    if (e.message.includes(`[${SEALED_MODE}:interrupted]`)) return "interrupted";
    if (e.message.includes(`[${SEALED_MODE}]`)) return "refused";
  }
  if (e.code === SEALED_MODE) return "refused";
  return sealedPhase(e.cause, depth + 1);
}

// saveFailedTranscription keeps the audio only when local history is on and
// audio retention is above 0, so the copy promises History only then. An
// interrupted request may have reached the provider, so it never says "nothing was sent".
export function sealedDictationMessageKey(
  error: unknown,
  settings: { dataRetentionEnabled: boolean; audioRetentionDays: number },
  { held = false }: { held?: boolean } = {}
): string {
  const kept = settings.dataRetentionEnabled && settings.audioRetentionDays > 0;
  const family = sealedPhase(error) === "interrupted" ? "sealedMode.interrupted" : "sealedMode.blocked";
  // held: kept in memory for "Transcribe" (sealedRecovery.ts), not on disk.
  return `${family}.${kept ? "dictationKept" : held ? "dictationHeld" : "dictationNotKept"}`;
}
```

Create `src/components/chat/chatErrorContent.ts`:

```ts
import { isSealedModeError, sealedPhase } from "../../utils/sealedModeError";

// The assistant bubble's text when a reply fails. The user's own message is
// never touched; a sealed failure says what happened instead of a transport error.
export function chatErrorContent(error: unknown, t: (key: string) => string): string {
  if (isSealedModeError(error))
    return t(sealedPhase(error) === "interrupted" ? "sealedMode.interrupted.chat" : "sealedMode.blocked.chat");
  return `${t("agentMode.chat.errorPrefix")}: ${(error as Error)?.message ?? String(error)}`;
}
```

Create `src/hooks/useSealedMode.ts`, the React view of the store. It holds no state:

```ts
import { useSyncExternalStore } from "react";
import { getSealedSnapshot, subscribeSealed, type SealedSnapshot } from "../stores/sealedStore";

export type { SealedSnapshot };

// The React view of src/stores/sealedStore.ts (spec §5.4). getSealedSnapshot
// doubles as the server snapshot, so SSR renders see the store.
export function useSealedMode(): SealedSnapshot {
  return useSyncExternalStore(subscribeSealed, getSealedSnapshot, getSealedSnapshot);
}
```

- [ ] **Step 4: Replace the sealed store's internals (spec §5.4)**

Replace the body of `src/stores/sealedStore.ts` (Plan 03, Task 3) with the module below. It keeps Plan 03's exports and their tested behaviour:
- a seal event that arrives while the first fetch is in flight wins;
- the store subscribes once;
- a failed fetch leaves the state unknown until an event;
- a build without the privacy bridge is known and unsealed.

It adds main's attestation and the snapshot readers.

```ts
import { create } from "zustand";
import type { Attestation } from "../types/privacy";

// The one renderer authority for Sealed mode (spec §5.4). Plan 03 created this
// module and its shared API (useSealedStore, getSealed, ensureSealedSubscribed);
// Plan 07 owns the internals: main's attestation, staleness and versioned reads.
// No other renderer module reads sealed state from the privacy bridge.
// `known` is false until main has answered; main enforces the seal either way.

export const useSealedStore = create<{ sealed: boolean; known: boolean }>()(() => ({
  sealed: false,
  known: false,
}));

// Route snapshots read this: unknown is false, because main enforces the seal anyway.
export function getSealed(): boolean {
  return useSealedStore.getState().sealed === true;
}

// Anything that makes a claim reads this: unknown is null, and claims nothing.
export type SealedSnapshot = { sealed: boolean | null; attestation: Attestation | null };

// Main re-broadcasts whenever the attestation changes; this bounds how old a
// claim on screen can be if a broadcast is lost.
export const ATTESTATION_MAX_AGE_MS = 30_000;

let attestation: Attestation | null = null;
// The newest version ever adopted. It survives invalidation, so a late reply
// older than a claim we already dropped can never come back (I5-R2).
let highestVersion = -1;
let snapshot: SealedSnapshot = { sealed: null, attestation: null };
const listeners = new Set<() => void>();
let subscribed = false;
// Bumped by every seal event and by setSealedMode. The first fetch applies only
// if nothing newer arrived after it started (Plan 03, I14).
let eventVersion = 0;
let staleTimer: ReturnType<typeof setTimeout> | null = null;

// One cached object per change, so useSyncExternalStore sees a stable value.
function publish() {
  const { sealed, known } = useSealedStore.getState();
  const next: SealedSnapshot = { sealed: known ? sealed : null, attestation };
  if (next.sealed === snapshot.sealed && next.attestation === snapshot.attestation) return;
  snapshot = next;
  for (const listener of listeners) listener();
}
useSealedStore.subscribe(publish);

const privacyApi = () => (typeof window === "undefined" ? undefined : window.electronAPI?.privacy);

function setAttestation(next: Attestation | null) {
  attestation = next;
  publish();
}

function refetchAttestation() {
  const api = privacyApi();
  if (!api?.getAttestation) return;
  const newestAtStart = highestVersion;
  api.getAttestation().then(adopt, () => {
    // A failed read cannot vouch for anything, but it must not erase a newer
    // push that arrived while it was in flight.
    if (highestVersion === newestAtStart) setAttestation(null);
  });
}

export const isAttestationFresh = (a: Attestation | null, now = Date.now()): boolean =>
  !!a && now - a.at <= ATTESTATION_MAX_AGE_MS;

function expireNow() {
  if (staleTimer) clearTimeout(staleTimer);
  staleTimer = null;
  setAttestation(null);
  refetchAttestation();
}

// Main versions every attestation; an older one (a late IPC reply) never wins,
// even after the newer one expired. A claim lives until main's `at` + 30 s and
// no longer: the timer gets only the remaining lifetime. A failed read drops to
// unknown, so a claim that may be stale is never kept.
function adopt(next: Attestation | null) {
  if (next && next.version < highestVersion) return;
  if (staleTimer) clearTimeout(staleTimer);
  staleTimer = null;
  if (!next) {
    setAttestation(null);
    return;
  }
  highestVersion = Math.max(highestVersion, next.version);
  const remaining = next.at + ATTESTATION_MAX_AGE_MS - Date.now();
  if (remaining <= 0) {
    expireNow();
    return;
  }
  setAttestation(next);
  staleTimer = setTimeout(expireNow, remaining);
  (staleTimer as { unref?: () => void }).unref?.();
}

// Timers are throttled in a hidden window and paused across sleep, so age is
// rechecked whenever the window comes back, not only when the timer fires.
function recheckFreshness() {
  if (attestation && !isAttestationFresh(attestation)) expireNow();
}

export function ensureSealedSubscribed(): void {
  if (subscribed || typeof window === "undefined") return;
  subscribed = true;
  const privacy = privacyApi();
  if (!privacy?.getSealed && !privacy?.onSealedChange) {
    // This build has no sealed mode, so nothing can be sealed.
    useSealedStore.setState({ sealed: false, known: true });
    return;
  }
  privacy.onSealedChange?.((sealed) => {
    eventVersion += 1;
    useSealedStore.setState({ sealed: sealed === true, known: true });
  });
  privacy.onAttestation?.(adopt);
  window.addEventListener?.("focus", recheckFreshness);
  window.document?.addEventListener?.("visibilitychange", recheckFreshness);
  const startedAt = eventVersion;
  Promise.resolve()
    .then(() => privacy.getSealed?.())
    .then(
      (sealed) => {
        if (typeof sealed !== "boolean" || eventVersion !== startedAt) return;
        useSealedStore.setState({ sealed, known: true });
      },
      () => {
        // Unknown stays unknown (main fails closed); the next event settles it.
      }
    );
  refetchAttestation();
}

export function subscribeSealed(listener: () => void): () => void {
  ensureSealedSubscribed();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getSealedSnapshot = (): SealedSnapshot => snapshot;

// main resolves after its sealing barrier, or with declined: true when the user
// kept the seal in main's own dialog. Either way, its answer is adopted.
export async function setSealedMode(sealed: boolean): Promise<Attestation & { declined?: boolean }> {
  const result = await window.electronAPI.privacy.setSealed(sealed);
  eventVersion += 1;
  useSealedStore.setState({ sealed: result.sealed === true, known: true });
  adopt(result);
  return result;
}

export function _resetSealedStoreForTests(): void {
  listeners.clear();
  subscribed = false;
  eventVersion = 0;
  attestation = null;
  highestVersion = -1;
  if (staleTimer) clearTimeout(staleTimer);
  staleTimer = null;
  useSealedStore.setState({ sealed: false, known: false });
  snapshot = { sealed: null, attestation: null };
}
```

Plan 03's `test/stores/sealedStore.test.js` loads a fresh module per test through its renderer harness, so it needs no reset. Its fakes have no `getAttestation`/`onAttestation`; the optional calls above leave them untouched. If Plan 03's `test/lib/routesHooks.test.js` gains an attestation fake, add `"privacy.getAttestation"` to its `ALLOWED` list: the call is local IPC and network-free.

In `src/lib/routes.ts`, change the comment above `isSealedLocality` (or its re-export from `routeGraph.ts`) to: `// Spec §5.4 + Plan 07 CCR-1: the one rule for which routes Sealed mode pauses. LAN servers are another machine.` Do not change the function.

Task 7 already replaced Plan 03's optional `privacy?` declaration in `src/types/electron.ts` with the required `privacy` namespace. Confirm that there is exactly one: `grep -c "privacy" src/types/electron.ts` shows a single member.

- [ ] **Step 5: Pre-flight, and keep content with honest copy**

1. `src/helpers/audioManager.js`, `startRecording`. Directly after the busy check returns (`:1145-1153`), and before the microphone is prepared (`:1156`), add:

   ```js
         // Sealed mode (Plan 07): do not record a dictation whose speech route
         // would leave this computer; main would refuse it after the fact.
         if (isDictationSealed(getSettings(), getSealedSnapshot().sealed)) {
           this.onError?.({
             title: "sealedMode.blocked.dictationPreflight",
             description: "sealedMode.blocked.dictationPreflightDetail",
             messageKey: "sealedMode.blocked.dictationPreflightDetail",
             code: "SEALED_MODE",
             variant: "default",
           });
           return false;
         }
   ```

   Report it through the same error callback the transcription-failure path uses at `:1915-1922`, using whatever name that path calls. Import `isDictationSealed` from `../lib/sealedMode` and `getSealedSnapshot` from `../stores/sealedStore`. Calling `getSealedSnapshot()` starts the store on first use, and before main answers it returns `sealed: null`, which never blocks. Plan 04 restyles this as a pill state (CCR-4) but keeps the check.
2. `src/components/chat/useChatStreaming.ts:536-546`. Replace the `content:` line in the error branch with `content: chatErrorContent(error, t),` and add `import { chatErrorContent } from "./chatErrorContent";`. The user's message entry is not modified.
3. `src/utils/localInferenceError.ts`. After the `OUTPUT_TRUNCATED` branch, add:

   ```ts
     } else if (result.code === "SEALED_MODE") {
       // The phase travels in the message text (see egressPolicy.js).
       error.messageKey =
         sealedPhase({ message: result.error }) === "interrupted" ? "sealedMode.interrupted.generic" : "sealedMode.blocked.generic";
   ```

   Import `sealedPhase` from `./sealedModeError`.
4. `src/utils/recordingErrors.ts`. As the first line of `getRecordingErrorTitle`, add `if (error.code === "SEALED_MODE") return t("sealedMode.blocked.dictationTitle");`.
5. `src/helpers/audioManager.js`. Add two methods to the class, next to `saveFailedTranscription` (`:3109`):

   ```js
     // Sealed mode (Plan 07). Called before saveFailedTranscription(), which
     // drops the blob when retention is off (:3111-3116). If retention would
     // discard it, keep it in memory for "Transcribe"; never on disk.
     _noteSealedFailure(error) {
       if (!isSealedModeError(error)) return;
       const retention = getEffectiveRetentionPreferences();
       if (this._recoveryReplay) {
         // A replay that failed again: its claimed hold is kept, not duplicated.
         error.recoveryHeld = true;
       } else if (this.lastAudioBlob && shouldHoldInMemory(error, retention)) {
         holdForRecovery(this.lastAudioBlob, { ...(this.lastAudioMetadata || {}) });
         error.recoveryHeld = true;
       }
       error.code = "SEALED_MODE";
       error.messageKey = sealedDictationMessageKey(error, retention, { held: error.recoveryHeld === true });
     }

     // A seal during a realtime stream (I6-R2): main closed the socket, and no
     // text arrived. Preserve the fallback audio exactly as a refused batch
     // dictation is preserved, instead of reporting an empty success.
     async _preserveSealedStream(metadata) {
       const error = Object.assign(new Error("[SEALED_MODE:interrupted] Sealed mode was turned on during the dictation"), {
         code: "SEALED_MODE",
         details: { phase: "interrupted" },
       });
       this._noteSealedFailure(error);
       this.isProcessing = false;
       this.onStateChange?.({ isRecording: false, isProcessing: false, isStreaming: false });
       this.onError?.({
         title: "sealedMode.blocked.dictationTitle",
         description: error.message,
         code: "SEALED_MODE",
         messageKey: error.messageKey,
         recoveryHeld: error.recoveryHeld === true,
       });
       // History on: a failed entry with the audio, for Retry. History off:
       // saveFailedTranscription drops the field, and the hold above keeps it.
       if (this.lastAudioBlob) await this.saveFailedTranscription(error.message, "SEALED_MODE", metadata);
       return true;
     }

     // "Transcribe" on the error notice or the unseal notice. It claims an idle
     // pipeline and the oldest hold atomically; the hold is removed only when
     // the replay produced a transcript.
     async transcribeRecovered() {
       if (this.isRecording || this.isProcessing || this.isStreaming || this._startInProgress || this._recoveryReplay) {
         return { started: false, reason: "busy" };
       }
       const held = claimRecovery();
       if (!held) return { started: false, reason: "none" };
       this._recoveryReplay = held.id;
       const pipeline = this._startProcessingPipeline();
       this.isProcessing = true;
       this.onStateChange?.({ isRecording: false, isProcessing: true, isStreaming: false });
       this.lastAudioBlob = held.blob;
       this.lastAudioMetadata = held.metadata;
       try {
         await this.processAudio(held.blob, held.metadata, pipeline);
       } finally {
         this._recoveryReplay = null;
         releaseRecovery(held.id, { done: pipeline.outcome === "success" });
       }
       return { started: true, succeeded: pipeline.outcome === "success" };
     }
   ```

   In the dictation pipeline `catch` (`:1903-1928`), as the first statement of the final `else` branch (before `this.onError?.({`, `:1915`), add `this._noteSealedFailure(error);`. In that `onError` call, add `recoveryHeld: error.recoveryHeld === true,` after `messageKey: error.messageKey,`. The existing `saveFailedTranscription(...)` call that follows stays: it keeps the recording for retry in History whenever retention allows.

   Mark each pipeline's outcome, so a replay knows whether it succeeded:
   - directly before `this.onTranscriptionComplete?.(result);` (`:1860`), add `pipeline.outcome = result?.success && result.text ? "success" : "empty";`;
   - as the first statement of the `catch (error)` at `:1884`, add `pipeline.outcome = "failed";`.

   **The streaming path (I6-R2).**
   - Where a streaming session starts (the block that registers `provider.onError` at `:3541`), set `this._streamingSealed = false`. Then add `this._offSealedWatch = subscribeSealed(() => { if (this.isStreaming && getSealedSnapshot().sealed === true) this._streamingSealed = true; });`, and call `this._offSealedWatch?.()` in `cleanupStreamingListeners`.
   - In the `provider.onError` callback, first set `this._streamingSealed ||= isSealedModeError({ message: String(error) }) || getSealedSnapshot().sealed === true;`. When that is true, skip its generic "Streaming Error" `onError`: the finalizer reports the seal instead.
   - In `_finalizeStreamingRecording`, directly after `this.cleanupStreamingListeners(sessionId); if (wasCancelled()) return true;` (`:3986-3987`), add:

     ```js
         if (!finalText && this._streamingSealed) {
           // Sealed mid-stream with no text: keep the audio (I6-R2).
           return this._preserveSealedStream({ durationSeconds, analyticsOccurredAt });
         }
     ```

     `lastAudioBlob` already holds the fallback recording here (`:3934-3936`). With a partial transcript, the normal pipeline continues, and a refused cleanup keeps the local text (see below).

   Imports: `isSealedModeError` and `sealedDictationMessageKey` from `../utils/sealedModeError`; `shouldHoldInMemory`, `holdForRecovery`, `claimRecovery` and `releaseRecovery` from `../lib/sealedRecovery`; `getSealedSnapshot` and `subscribeSealed` from `../stores/sealedStore`. `getEffectiveRetentionPreferences()` is defined at `audioManager.js:130-136`.

6. `src/hooks/useAudioRecording.js`: the two recovery surfaces (§5.3). Plan 04 and Plan 07 can merge in either order (spec §3), and the code differs. Check which API exists: `test -f src/components/ui/notices.ts`.

   **Plan 04 has merged** (`notices.ts` exists; the toast system is gone). Use Plan 04's builders (P04 Task 4, `src/components/voiceNotices`):
   - In `onError` (`:383`), call `showDictationError({ title, description, recoveryHeld: error?.recoveryHeld === true }, extraActions)`. When `recoveryHeld` is true, pass `extraActions = [{ label: t("sealedMode.recovery.transcribe"), onClick: () => audioManagerRef.current?.transcribeRecovered() }]`. Plan 04's `buildDictationErrorNotice` makes a held-audio refusal a persistent `alert`.
   - The unseal prompt:

     ```js
         // Plan 07: a dictation held in memory while sealed is offered again
         // once Sealed mode is off. Nothing is sent until the user clicks.
         let wasSealed = getSealedSnapshot().sealed;
         const offSealed = subscribeSealed(() => {
           const { sealed } = getSealedSnapshot();
           if (wasSealed === true && sealed === false && recoveryCount() > 0) {
             notify(buildSealedRecoveryNotice(t, {
               transcribe: () => audioManagerRef.current?.transcribeRecovered(),
               discard: () => discardRecovery(),
             }));
           }
           wasSealed = sealed;
         });
     ```

     This is §5.3's `notify({ kind: "notice", persistent: true, actions: [Transcribe, Discard] })`. Import `notify` from `../components/ui/notices` and `buildSealedRecoveryNotice` from `../components/voiceNotices`.

   **Plan 04 has not merged** (the toast system still exists):
   - Give `showDictationError` (`:300`) an `extraActions = []` parameter, and append it to `actions` before the `toast(...)` call. In `onError` (`:383`), pass the same Transcribe action when `error?.recoveryHeld` is true, and `duration: 0` so the held-audio refusal stays until acknowledged.
   - The unseal prompt is the block above, with `notify(buildSealedRecoveryNotice(...))` replaced by `toast({ title: t("sealedMode.recovery.availableTitle"), description: t("sealedMode.recovery.availableDetail", { count: recoveryCount() }), variant: "default", duration: 0, actions: [Transcribe, Discard] })`. In the existing toast, `duration: 0` never auto-dismisses (`Toast.tsx:97` sets a timer only when `duration > 0`), so this is the persistent notice §5.3 requires.
   - Plan 04 removes this fallback when it merges second (P04 Task 5, Step 3, item 7). Its `noToastLeft` guard fails if a toast survives.

   In both orders, call `offSealed()` in the effect's cleanup. Import `getSealedSnapshot` and `subscribeSealed` from `../stores/sealedStore`, and `recoveryCount` and `discardRecovery` from `../lib/sealedRecovery`.

   Create `test/hooks/sealedRecoveryNotice.test.js`. It checks whichever API this branch has:

   ```js
   const assert = require("node:assert/strict");
   const fs = require("node:fs");
   const path = require("node:path");
   const test = require("node:test");

   const root = path.join(__dirname, "../..");
   const hook = fs.readFileSync(path.join(root, "src/hooks/useAudioRecording.js"), "utf8");
   const plan04 = fs.existsSync(path.join(root, "src/components/ui/notices.ts"));

   test("the recovery prompt is persistent and offers Transcribe and Discard, in either merge order", () => {
     const block = hook.slice(hook.indexOf("const offSealed = subscribeSealed("), hook.indexOf("wasSealed = sealed;"));
     assert.ok(block.length > 0, "the unseal prompt exists");
     if (plan04) {
       assert.match(block, /notify\(buildSealedRecoveryNotice\(t, \{\s*transcribe:/);
       assert.doesNotMatch(hook, /(^|[^.\w])toast\(\{/m, "no toast survives once Plan 04 has merged");
     } else {
       assert.match(block, /toast\(\{[\s\S]*duration: 0[\s\S]*sealedMode\.recovery\.transcribe[\s\S]*sealedMode\.recovery\.discard/);
       assert.doesNotMatch(block, /Infinity|duration: [1-9]/, "persistent, never a long timeout");
     }
   });

   test("a held-audio refusal carries the Transcribe action", () => {
     assert.match(hook, /recoveryHeld/);
     assert.match(hook, /transcribeRecovered\(\)/);
   });
   ```

   In the integrated branch, also run Plan 04's `test/components/noToastLeft.test.js` and its notice-shape tests (`test/components/voiceNotices.test.js`).

7. `src/components/ui/MarkdownRenderer.tsx`. Add an `img` entry to `markdownComponents`:

   ```tsx
     img: function MarkdownImage({ node: _node, src, alt }): ReactElement {
       const { sealed } = useSealedMode();
       const { t } = useTranslation();
       const remote = typeof src === "string" && /^https?:/i.test(src) && !isLoopbackUrl(src);
       // Sealed or unknown: do not ask Chromium for a remote image (Layer B
       // would refuse it). Say why instead.
       if (remote && sealed !== false) {
         return (
           <span className="inline-block rounded border border-dashed border-border px-1.5 py-0.5 text-xs text-muted-foreground">
             {t("sealedMode.markdown.imageBlocked", { alt: alt || "" })}
           </span>
         );
       }
       return <img src={src} alt={alt ?? ""} className="max-w-full" />;
     },
   ```

   Import `useSealedMode` from `../../hooks/useSealedMode`, `useTranslation` from `react-i18next` and `isLoopbackUrl` from `../../lib/locality`. Leave `MarkdownLink` (`:41-55`) as it is: a remote link already opens through `setWindowOpenHandler` and `openExternalUrl`, which asks first while sealed (Task 11).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- test/lib/sealedMode.test.js test/lib/sealedRecovery.test.js test/utils/sealedModeError.test.js test/stores/sealedStoreAttestation.test.js test/stores/sealedStore.test.js test/lib/routesSealed.test.js test/lib/routesHooks.test.js test/helpers/dictationPreflight.test.js test/helpers/audioManagerSealed.test.js test/components/markdownSealed.test.js test/helpers/useChatStreamingCancellation.test.js test/helpers/useChatStreamingFlush.test.js && npm run typecheck`
Expected: PASS, and typecheck is clean. The new copy keys (`sealedMode.blocked.dictationHeld`, `sealedMode.interrupted.dictationHeld`, `sealedMode.recovery.*`, `sealedMode.markdown.imageBlocked`) are added in Task 14, Step 6; `npm run i18n:check` runs there.

- [ ] **Step 7: Commit**

```bash
git add src/stores/sealedStore.ts src/hooks/useSealedMode.ts src/lib/sealedMode.ts src/lib/sealedRecovery.ts src/utils/sealedModeError.ts src/components/chat/chatErrorContent.ts src/lib/routes.ts src/components/ui/MarkdownRenderer.tsx src/components/chat/useChatStreaming.ts src/utils/localInferenceError.ts src/utils/recordingErrors.ts src/helpers/audioManager.js src/hooks/useAudioRecording.js test/lib test/utils/sealedModeError.test.js test/hooks test/stores/sealedStoreAttestation.test.js test/helpers/dictationPreflight.test.js test/helpers/audioManagerSealed.test.js test/components/markdownSealed.test.js
git commit -m "feat(privacy): one sealed source for routes, dictation pre-flight and in-memory recovery, inert remote images"
```

---

### Task 14: Sealed mode panel (SET-R6 C), tokens, copy and the update note

**Files:**
- Create: `src/components/settings/SealedModePanel.tsx` and `src/components/settings/sealedModeCopy.ts`
- Modify:
  - `src/components/SettingsPage.tsx:2746-2757`. Render the panel first in `case "privacyData"`, directly under the `SectionHeader` block and above `<LocalSupportModels />`.
  - `src/components/settings/UpdateSettings.tsx`. Show the sealed note and disable "Check now" while sealed.
  - `src/index.css`. Add the `--color-sealed-*` tokens to `:root`.
  - `src/locales/*/translation.json`. Add `sealedMode.*`, `settingsPage.privacy.sealed.*` and `updates.sealed`.
  - `DESIGN.md`. Add the "Sealed mode and the flight recorder" section; Task 15 completes it.
- Test: `test/components/sealedModePanel.test.js`

**Interfaces:**
- Consumes `useSealedMode` and `setSealedMode` from `src/stores/sealedStore.ts` (Task 13), and `Attestation` (Task 7). Uses `contrastRatio` from `src/utils/contrast.ts` and `resolveTokens` from `test/helpers/harness/cssTokens.js` (Plan 01).
- Produces:

  ```ts
  // sealedModeCopy.ts
  export type StatusLine = { key: string; params?: Record<string, string | number>; tone: "neutral" | "ok" | "warn" };
  export function sealedStatusLines(sealed: boolean | null, attestation: Attestation | null, formatTime: (ms: number) => string): StatusLine[];
  // SealedModePanel.tsx
  export function SealedModePanelView(props: { t: (k: string, p?: object) => string; sealed: boolean | null; attestation: Attestation | null;
    busy: boolean; error: string | null; onToggle: (next: boolean) => void; formatTime: (ms: number) => string }): JSX.Element;
  export default function SealedModePanel(): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `test/components/sealedModePanel.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");
const { resolveTokens } = require("../helpers/harness/cssTokens");

const copy = () => import("../../src/components/settings/sealedModeCopy.ts");
const panel = () => import("../../src/components/settings/SealedModePanel.tsx");
const t = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key);
const time = (ms) => `T${ms}`;
const attested = { sealed: true, sealedSince: 5, effectiveSince: 7, phase: "sealed", failures: [], notes: [], loadError: null, saveError: null,
  guards: { node: true, dns: true, dgram: true, http: true, webContents: true, sessions: 2, envProxy: false, openRemoteSockets: 0, chromiumInFlightRemote: 0, pendingDns: 0 },
  networkChildren: [], uninspectedChildren: [], activeRemote: 0, blockedSinceSealed: 3, recordFailures: 0, version: 1, at: Date.now(), nothingLeaves: true };

test("the verified claim appears only when main attests it", async () => {
  const { sealedStatusLines } = await copy();
  const keys = (s, a) => sealedStatusLines(s, a, time).map((l) => l.key);
  assert.ok(keys(true, attested).includes("settingsPage.privacy.sealed.attested"));
  assert.ok(
    !keys(true, { ...attested, at: Date.now() - 31_000 }).includes("settingsPage.privacy.sealed.attested"),
    "a claim older than main's at + 30 s is pending at render, whatever the store's timer did"
  );
  for (const variant of [
    { ...attested, nothingLeaves: false, networkChildren: ["codex"] },
    { ...attested, nothingLeaves: false, guards: { ...attested.guards, sessions: 0 } },
    { ...attested, nothingLeaves: false, activeRemote: 1 },
  ]) {
    assert.equal(keys(true, variant).includes("settingsPage.privacy.sealed.attested"), false);
  }
  assert.deepEqual(keys(true, null), ["settingsPage.privacy.sealed.on", "settingsPage.privacy.sealed.unverified.pending", "settingsPage.privacy.sealed.scope"]);
  assert.ok(keys(true, attested).includes("settingsPage.privacy.sealed.scope"), "the limits are stated next to the verified line too");
  assert.deepEqual(keys(null, null), ["settingsPage.privacy.sealed.unknown"]);
  assert.deepEqual(keys(false, { ...attested, sealed: false, nothingLeaves: false }), ["settingsPage.privacy.sealed.description"]);
});

test("the verified claim is dated from the effective time, not from when the switch flipped", async () => {
  const { sealedStatusLines } = await copy();
  const line = sealedStatusLines(true, attested, time).find((l) => l.key === "settingsPage.privacy.sealed.attested");
  assert.deepEqual(line.params, { time: "T7", count: 3 });
});

test("each unverified reason names its cause", async () => {
  const { sealedStatusLines } = await copy();
  const line = (a) => sealedStatusLines(true, a, time).find((l) => l.tone === "warn");
  assert.equal(line({ ...attested, nothingLeaves: false, phase: "sealing", effectiveSince: null }).key, "settingsPage.privacy.sealed.unverified.stopping");
  assert.equal(line({ ...attested, nothingLeaves: false, guards: { ...attested.guards, envProxy: true } }).key, "settingsPage.privacy.sealed.unverified.envProxy");
  assert.equal(line({ ...attested, nothingLeaves: false, networkChildren: ["codex"] }).key, "settingsPage.privacy.sealed.unverified.child");
  assert.deepEqual(line({ ...attested, nothingLeaves: false, networkChildren: ["codex"] }).params, { names: "codex" });
  assert.equal(line({ ...attested, nothingLeaves: false, guards: { ...attested.guards, node: false } }).key, "settingsPage.privacy.sealed.unverified.guards");
  assert.equal(line({ ...attested, nothingLeaves: false, activeRemote: 2 }).key, "settingsPage.privacy.sealed.unverified.active");
  const sealing = { ...attested, nothingLeaves: false, phase: "sealing", effectiveSince: null };
  assert.equal(line({ ...sealing, failures: ["childStop"], networkChildren: ["yt-dlp"] }).key, "settingsPage.privacy.sealed.unverified.stopFailed");
  assert.deepEqual(line({ ...sealing, failures: ["childStop"], networkChildren: ["yt-dlp"] }).params, { names: "yt-dlp" });
  assert.equal(line({ ...sealing, failures: ["codexStop"] }).key, "settingsPage.privacy.sealed.unverified.stopFailedUnnamed");
  assert.equal(line({ ...sealing, failures: ["timeout:chromium"], guards: { ...attested.guards, chromiumInFlightRemote: 1 } }).key, "settingsPage.privacy.sealed.unverified.chromium");
  assert.equal(line({ ...sealing, failures: ["timeout:dns"], guards: { ...attested.guards, pendingDns: 1 } }).key, "settingsPage.privacy.sealed.unverified.dns");
});

test("running on-device sidecars are named beside the verified line, never folded into it", async () => {
  const { sealedStatusLines } = await copy();
  const lines = sealedStatusLines(true, { ...attested, uninspectedChildren: ["llama-server", "qdrant"] }, time);
  assert.ok(lines.some((l) => l.key === "settingsPage.privacy.sealed.attested"));
  assert.deepEqual(lines.find((l) => l.key === "settingsPage.privacy.sealed.uninspected").params, { names: "llama-server, qdrant" });
});

test("a delay that resolved before verification is disclosed beside the verified line", async () => {
  const { sealedStatusLines } = await copy();
  const keys = sealedStatusLines(true, { ...attested, notes: ["codexStop"] }, time).map((l) => l.key);
  assert.ok(keys.includes("settingsPage.privacy.sealed.attested"));
  assert.ok(keys.includes("settingsPage.privacy.sealed.note.codexStop"));
});

test("load and save problems are always surfaced", async () => {
  const { sealedStatusLines } = await copy();
  const keys = sealedStatusLines(true, { ...attested, loadError: "corrupt", saveError: "EACCES" }, time).map((l) => l.key);
  assert.ok(keys.includes("settingsPage.privacy.sealed.loadError"));
  assert.ok(keys.includes("settingsPage.privacy.sealed.saveError"));
});

test("the switch reflects main, and is disabled while unknown or busy", async () => {
  const { SealedModePanelView } = await panel();
  const base = { t, attestation: attested, error: null, onToggle() {}, formatTime: time };
  const on = renderStatic(SealedModePanelView, { ...base, sealed: true, busy: false });
  assert.match(on, /role="switch"[^>]*aria-checked="true"/);
  assert.match(on, /data-sealed="true"/);
  assert.match(on, /settingsPage\.privacy\.sealed\.attested/);
  const unknown = renderStatic(SealedModePanelView, { ...base, sealed: null, attestation: null, busy: false });
  assert.match(unknown, /role="switch"[^>]*disabled=""/);
  const busy = renderStatic(SealedModePanelView, { ...base, sealed: false, busy: true });
  assert.match(busy, /role="switch"[^>]*disabled=""/);
});

test("sealed panel colours meet contrast in both themes", async () => {
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const css = fs.readFileSync(path.join(__dirname, "../../src/index.css"), "utf8");
  for (const theme of ["light", "dark"]) {
    const tokens = resolveTokens(css)[theme];
    const bg = tokens["--color-sealed-bg"];
    for (const fg of ["--color-sealed-fg", "--color-sealed-muted", "--color-sealed-ok", "--color-sealed-warn"]) {
      assert.ok(contrastRatio(tokens[fg], bg) >= 4.5, `${theme} ${fg} on sealed bg`);
    }
  }
});
```

Check how `Toggle` renders `disabled`: React SSR emits `disabled=""`. If `Toggle` instead uses `aria-disabled`, assert that attribute.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/components/sealedModePanel.test.js`
Expected: FAIL with missing modules and missing tokens.

- [ ] **Step 3: Tokens**

In `src/index.css`, add to the `:root` block after the Plan 01 locality tokens. Plum Night shares these values, so there is no `.dark` override:

```css
  /* Sealed mode (Plan 07): the panel turns navy in both themes. Text pairs
     are ≥ 9:1 on --color-sealed-bg (test/components/sealedModePanel.test.js). */
  --color-sealed-bg: #0f1a33;
  --color-sealed-border: #2c3f6e;
  --color-sealed-fg: #f4f6fb;
  --color-sealed-muted: #b8c2dc;
  --color-sealed-ok: #5ee0ad;
  --color-sealed-warn: #fbbf6a;
```

- [ ] **Step 4: Copy model and panel**

Create `src/components/settings/sealedModeCopy.ts`:

```ts
import type { Attestation } from "../../types/privacy";
import { isAttestationFresh } from "../../stores/sealedStore";

export type StatusLine = { key: string; params?: Record<string, string | number>; tone: "neutral" | "ok" | "warn" };
const P = "settingsPage.privacy.sealed";

// Most fundamental cause first. Failures are unresolved (they block the
// verified line); main clears one only when the thing it names has stopped.
function unverified(a: Attestation | null): StatusLine {
  if (!a) return { key: `${P}.unverified.pending`, tone: "warn" };
  const g = a.guards;
  if (!g.node || !g.dns || !g.dgram || !g.http || !g.webContents || g.sessions === 0)
    return { key: `${P}.unverified.guards`, tone: "warn" };
  if (g.envProxy) return { key: `${P}.unverified.envProxy`, tone: "warn" };
  if (a.failures.some((f) => f === "codexStop" || f === "childStop"))
    return a.networkChildren.length > 0
      ? { key: `${P}.unverified.stopFailed`, params: { names: a.networkChildren.join(", ") }, tone: "warn" }
      : { key: `${P}.unverified.stopFailedUnnamed`, tone: "warn" };
  if (a.networkChildren.length > 0)
    return { key: `${P}.unverified.child`, params: { names: a.networkChildren.join(", ") }, tone: "warn" };
  if (g.chromiumInFlightRemote > 0 || a.failures.includes("timeout:chromium"))
    return { key: `${P}.unverified.chromium`, tone: "warn" };
  if (g.pendingDns > 0 || a.failures.includes("timeout:dns")) return { key: `${P}.unverified.dns`, tone: "warn" };
  if (a.activeRemote > 0 || g.openRemoteSockets > 0) return { key: `${P}.unverified.active`, tone: "warn" };
  return { key: `${P}.unverified.stopping`, tone: "warn" };
}

const NOTE_KEYS = new Set(["codexStop", "childStop"]);

// The only place the panel decides what it may claim. The verified line is
// shown solely when main's attestation says so (D6), and it is dated from
// effectiveSince (when main confirmed everything had stopped), never from
// sealedSince (when the switch was flipped).
export function sealedStatusLines(
  sealed: boolean | null,
  attestationIn: Attestation | null,
  formatTime: (ms: number) => string,
  now: number = Date.now()
): StatusLine[] {
  if (sealed === null) return [{ key: `${P}.unknown`, tone: "neutral" }];
  // Checked again at render (I5-R2): a claim past main's at + 30 s is pending.
  const attestation = isAttestationFresh(attestationIn, now) ? attestationIn : null;
  const lines: StatusLine[] = [];
  if (!sealed) {
    lines.push({ key: `${P}.description`, tone: "neutral" });
  } else {
    lines.push({ key: `${P}.on`, tone: "neutral" });
    if (attestation?.nothingLeaves && attestation.effectiveSince != null) {
      lines.push({
        key: `${P}.attested`,
        params: { time: formatTime(attestation.effectiveSince), count: attestation.blockedSinceSealed },
        tone: "ok",
      });
      for (const note of attestation.notes) if (NOTE_KEYS.has(note)) lines.push({ key: `${P}.note.${note}`, tone: "neutral" });
      // CCR-6: running on-device sidecars are named, not claimed as verified.
      if (attestation.uninspectedChildren?.length)
        lines.push({ key: `${P}.uninspected`, params: { names: attestation.uninspectedChildren.join(", ") }, tone: "neutral" });
    } else lines.push(unverified(attestation));
    // Always shown while sealed: what the guarantee covers, and its limits.
    lines.push({ key: `${P}.scope`, tone: "neutral" });
  }
  if (attestation?.loadError) lines.push({ key: `${P}.loadError`, tone: "warn" });
  if (attestation?.saveError) lines.push({ key: `${P}.saveError`, tone: "warn" });
  return lines;
}
```

Create `src/components/settings/SealedModePanel.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Attestation } from "../../types/privacy";
import { useSealedMode } from "../../hooks/useSealedMode";
import { setSealedMode } from "../../stores/sealedStore";
import { Lock } from "../icons";
import { Toggle } from "../ui/toggle";
import { sealedStatusLines } from "./sealedModeCopy";

const TONE_CLASS = {
  neutral: "text-[var(--color-sealed-muted)]",
  ok: "text-[var(--color-sealed-ok)]",
  warn: "text-[var(--color-sealed-warn)]",
} as const;

export function SealedModePanelView({
  t,
  sealed,
  attestation,
  busy,
  error,
  onToggle,
  formatTime,
}: {
  t: (key: string, params?: object) => string;
  sealed: boolean | null;
  attestation: Attestation | null;
  busy: boolean;
  error: string | null;
  onToggle: (next: boolean) => void;
  formatTime: (ms: number) => string;
}) {
  const lines = sealedStatusLines(sealed, attestation, formatTime);
  const on = sealed === true;
  return (
    <section
      aria-label={t("settingsPage.privacy.sealed.title")}
      data-sealed={on ? "true" : "false"}
      className={[
        "rounded-lg border p-4 transition-[background-color,color,border-color]",
        "duration-[var(--motion-slow)] ease-[var(--motion-ease-std)]",
        on
          ? "border-[var(--color-sealed-border)] bg-[var(--color-sealed-bg)] text-[var(--color-sealed-fg)]"
          : "border-border bg-surface-raised text-foreground",
      ].join(" ")}
    >
      <div className="flex items-center gap-3">
        <Lock className="size-4 shrink-0" aria-hidden="true" />
        <h3 className="flex-1 text-[13px] font-semibold">{t("settingsPage.privacy.sealed.title")}</h3>
        <Toggle
          checked={on}
          disabled={sealed === null || busy}
          onChange={onToggle}
          aria-label={t("settingsPage.privacy.sealed.title")}
        />
      </div>
      <div className="mt-2 space-y-1 text-[12px]" aria-live="polite">
        {lines.map((line) => (
          <p key={line.key} className={on ? TONE_CLASS[line.tone] : "text-muted-foreground"}>
            {t(line.key, line.params)}
          </p>
        ))}
        {error && (
          <p role="alert" className={on ? TONE_CLASS.warn : "text-destructive"}>
            {t("settingsPage.privacy.sealed.toggleError", { message: error })}
          </p>
        )}
      </div>
    </section>
  );
}

export default function SealedModePanel() {
  const { t, i18n } = useTranslation();
  const { sealed, attestation } = useSealedMode();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formatTime = (ms: number) =>
    new Intl.DateTimeFormat(i18n.language, { hour: "numeric", minute: "2-digit" }).format(ms);
  async function onToggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await setSealedMode(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <SealedModePanelView
      t={t}
      sealed={sealed}
      attestation={attestation}
      busy={busy}
      error={error}
      onToggle={(next) => void onToggle(next)}
      formatTime={formatTime}
    />
  );
}
```

If `Toggle` (`src/components/ui/toggle.tsx`) does not forward `disabled` to the button, it already accepts `disabled` (`toggle.tsx:7`). Use it as is.

- [ ] **Step 5: Place it, and add the update note**

1. In `SettingsPage.tsx`, add `import SealedModePanel from "./settings/SealedModePanel";`. In `case "privacyData":`, insert `<SealedModePanel />` between the `SectionHeader` `</div>` (`:2755`) and `<LocalSupportModels />` (`:2757`).
2. In `UpdateSettings.tsx`, under the automatic-updates row, render `{status?.sealed && <p className="text-sm text-muted-foreground">{t("updates.sealed")}</p>}`. Add `disabled={!!status?.sealed || …existing condition}` to the "Check now" button. Main refuses the check anyway; this only avoids a dead click.

- [ ] **Step 6: Strings, in all 11 locales**

These are the English source strings. Every other locale gets a faithful translation with each `{{placeholder}}` byte-identical. Translate "Sealed mode" consistently within a locale, and do not leave English text in another locale's file.

```json
{
  "sealedMode.blocked.generic": "Paused: Sealed mode is on. Nothing was sent.",
  "sealedMode.blocked.chat": "Chat paused: Sealed mode is on. Your message is kept.",
  "sealedMode.blocked.dictationTitle": "Not transcribed: Sealed mode is on",
  "sealedMode.blocked.dictationKept": "Nothing was sent. The recording is saved in History, so you can retry after turning Sealed mode off.",
  "sealedMode.blocked.dictationNotKept": "Nothing was sent. The recording was not kept, because local history is off.",
  "sealedMode.blocked.dictationPreflight": "Dictation paused: Sealed mode is on",
  "sealedMode.blocked.dictationPreflightDetail": "Your speech-to-text route sends audio off this computer. Choose an on-device model, or turn Sealed mode off.",
  "sealedMode.interrupted.generic": "Stopped: Sealed mode was turned on while this was in progress. The provider may have received part of it.",
  "sealedMode.interrupted.chat": "Chat stopped: Sealed mode was turned on mid-reply. Your message is kept; the provider may have received it.",
  "sealedMode.interrupted.dictationKept": "Stopped when Sealed mode was turned on; the provider may have received part of the audio. The recording is in History for retry.",
  "sealedMode.interrupted.dictationNotKept": "Stopped when Sealed mode was turned on; the provider may have received part of the audio. The recording was not kept, because local history is off.",
  "sealedMode.blocked.dictationHeld": "Nothing was sent. Local history is off, so the recording is kept in memory only, until you quit Loqui. Choose Transcribe after turning Sealed mode off or switching to an on-device model.",
  "sealedMode.interrupted.dictationHeld": "Stopped when Sealed mode was turned on; the provider may have received part of the audio. The recording is kept in memory only, until you quit Loqui.",
  "sealedMode.recovery.transcribe": "Transcribe",
  "sealedMode.recovery.discard": "Discard",
  "sealedMode.recovery.availableTitle": "A dictation is waiting",
  "sealedMode.recovery.availableDetail_one": "Sealed mode is off. {{count}} recording blocked earlier is still in memory. Transcribe it now?",
  "sealedMode.recovery.availableDetail_other": "Sealed mode is off. {{count}} recordings blocked earlier are still in memory. Transcribe them now?",
  "sealedMode.markdown.imageBlocked": "Image not loaded while Sealed mode is on: {{alt}}",
  "settingsPage.privacy.sealed.title": "Sealed mode",
  "settingsPage.privacy.sealed.description": "Blocks every request that would leave this computer. On-device models keep working.",
  "settingsPage.privacy.sealed.on": "Cloud routes are paused. Local routes keep working. Turn this off to resume them.",
  "settingsPage.privacy.sealed.attested": "Sealed and verified since {{time}}: every connection that Loqui, its windows, downloads and Codex could make to another computer has been stopped. Blocked: {{count}}.",
  "settingsPage.privacy.sealed.uninspected": "Running on this computer, not inspected: {{names}}. Loqui started them with network features off, listening only on this computer, but can't see inside them.",
  "settingsPage.privacy.sealed.unverified.pending": "Checking that nothing can leave this computer…",
  "settingsPage.privacy.sealed.unverified.guards": "Sealed mode is on, but Loqui can't confirm its network guards are active. Restart Loqui.",
  "settingsPage.privacy.sealed.unverified.child": "Sealed mode is on, but {{names}} is still running and may use the network. It stops shortly.",
  "settingsPage.privacy.sealed.unverified.active": "Sealed mode is on. Stopping requests that started before you turned it on.",
  "settingsPage.privacy.sealed.unverified.stopping": "Sealed mode is on, but Loqui could not yet confirm that everything stopped. It keeps checking.",
  "settingsPage.privacy.sealed.unverified.envProxy": "Sealed mode is on, but Loqui was started with a network proxy setting it cannot inspect, so it can't confirm that nothing leaves.",
  "settingsPage.privacy.sealed.unverified.stopFailed": "Sealed mode is on, but {{names}} did not stop when asked. Loqui can't verify the seal until it exits. Quitting Loqui stops it.",
  "settingsPage.privacy.sealed.unverified.stopFailedUnnamed": "Sealed mode is on, but a helper process did not stop when asked. Loqui can't verify the seal until it exits. Quitting Loqui stops it.",
  "settingsPage.privacy.sealed.unverified.chromium": "Sealed mode is on, but a page request that started earlier is still open. Loqui can't verify the seal until it ends.",
  "settingsPage.privacy.sealed.unverified.dns": "Sealed mode is on, but a name lookup that started earlier is still pending. It keeps checking.",
  "settingsPage.privacy.sealed.note.codexStop": "Verified after a delay: Codex took longer than usual to stop.",
  "settingsPage.privacy.sealed.note.childStop": "Verified after a delay: a helper process took longer than usual to stop.",
  "settingsPage.privacy.sealed.loadError": "Loqui couldn't read your Sealed mode setting, so it stayed sealed. Turn it off here if you meant to.",
  "settingsPage.privacy.sealed.saveError": "Sealed mode couldn't be saved. It will be off the next time Loqui starts.",
  "settingsPage.privacy.sealed.unknown": "Sealed mode status is unavailable.",
  "settingsPage.privacy.sealed.scope": "Covers Loqui, its windows, and which programs it starts and how. Once a local model server is running, Loqui can't see inside it. Links open in your browser only after you confirm.",
  "settingsPage.privacy.sealed.toggleError": "Couldn't change Sealed mode: {{message}}",
  "updates.sealed": "Paused while Sealed mode is on."
}
```

Write `/tmp/loqui-sealed-i18n.json` as `{ "<locale>": { "<dotted.key>": "<string>", … }, … }` for all 11 locales, then merge it:

```bash
node -e '
const fs=require("fs"),p=require("path");
const all=JSON.parse(fs.readFileSync("/tmp/loqui-sealed-i18n.json","utf8"));
for(const [locale,strings] of Object.entries(all)){
  const f=p.join("src/locales",locale,"translation.json");const j=JSON.parse(fs.readFileSync(f,"utf8"));
  for(const [key,value] of Object.entries(strings)){
    const parts=key.split(".");let node=j;
    for(const part of parts.slice(0,-1)){node[part]??={};node=node[part];}
    node[parts.at(-1)]=value;
  }
  fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");
}'
npx prettier --write "src/locales/**/translation.json"
npm run i18n:check
```

Expected: `i18n:check` passes, with no missing keys or placeholder mismatches.

- [ ] **Step 7: DESIGN.md**

Add after the `## Motion` section (Plan 01):

```markdown
## Sealed mode and the flight recorder

- **Sealed panel.** First block of Privacy & Data. Off: a normal card. On: navy `--color-sealed-bg` with `--color-sealed-fg` text, colour change over `--motion-slow`; reduced motion keeps the colour change and drops nothing else, because there is no transform.
- **Claims.** The panel shows the verified line only when main's `Attestation.nothingLeaves` is true, and dates it from `effectiveSince`. An unknown state shows no claim and a disabled switch. Load or save problems are always shown. Turning Sealed mode off opens main's own confirmation dialog; a "Keep sealed" answer leaves the switch on without an error.
- **Routes.** While sealed, every non-device route shows Paused with a lock (`unreachable` / `sealed`). LAN servers pause too.
- **Numbers.** A byte count main could not measure renders "—" with the screen-reader text "unknown", never "0 B". Only blocked requests show 0 bytes sent.
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test -- test/components/sealedModePanel.test.js && npm run typecheck && npm run i18n:check`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/settings/SealedModePanel.tsx src/components/settings/sealedModeCopy.ts src/components/SettingsPage.tsx src/components/settings/UpdateSettings.tsx src/index.css src/locales DESIGN.md test/components/sealedModePanel.test.js
git commit -m "feat(privacy): add the Sealed mode panel with attested status"
```

---

### Task 15: Flight recorder view (SET-M3) and the privacy docs

**Files:**
- Create: `src/components/settings/FlightRecorderPanel.tsx` and `src/components/settings/flightRecorderView.ts`
- Modify:
  - `src/components/SettingsPage.tsx`. Add `<FlightRecorderPanel />` directly after `<SealedModePanel />`.
  - `src/locales/*/translation.json`. Add `settingsPage.privacy.recorder.*`.
  - `docs/PRIVACY.md`. Add a "Sealed mode and the flight recorder" section, and point the "When network requests occur" table at it.
  - `DESIGN.md`. Append the recorder rules to the Task 14 section.
- Test: `test/components/flightRecorderPanel.test.js`, `test/components/flightRecorderPipeline.test.js`

**What the panel may claim (I5, I10).**
- The headline counts **observed requests**, the requests Loqui's guards saw and metered. Opaque child sessions (Codex, yt-dlp) are counted on a separate line, because Loqui saw the session start and end, not the requests inside it.
- An opaque row names its **usual host**, not "the destination". Its bytes cell says the traffic is not visible.
- A row shows its whole host trail (redirects, CDN hosts) and its end time when it ran for a second or more.
- Before the first summary arrives, the panel shows "Loading…", never "0". The empty state says "No recorded requests for this period". It never says that nothing left this computer: the recorder may have been cleared, pruned, or (with history off) emptied by a restart.

**Interfaces:**
- Consumes `privacy.listEgress`, `egressSummary`, `clearEgress`, `exportEgressCsv`, `onEgress` and `onEgressCleared` (Task 7), and uses `formatBytes` from `src/utils/formatBytes`. **Clear history** is confirmed by main's own dialog (Task 7, `createConfirmations`), so the panel shows no renderer confirm. A compromised renderer therefore cannot wipe the evidence silently.
- Produces:

  ```ts
  // flightRecorderView.ts
  export type TickKind = "sent" | "session" | "blocked" | "unexplained";
  export type Tick = { id: number; minute: number; kind: TickKind; event: EgressEvent };
  export function timelineTicks(events: EgressEvent[], now: number): Tick[];   // last 24 h, minute 0..1439
  export function mergeNotice(events: EgressEvent[], notice: EgressNotice, since: number): EgressEvent[];
  export function startOfToday(now: number): number;
  export function bytesCell(n: number | null, format: (n: number) => string): { text: string; unknown: boolean };
  export function hostTrail(e: EgressEvent): string;                                   // "a → b → c"
  export function timeCell(e: EgressEvent, formatTime: (ms: number) => string): string; // start, or start–end
  // FlightRecorderPanel.tsx
  export function FlightRecorderView(props: { t; events: EgressEvent[]; summary: EgressSummary | null; now: number;
    formatTime: (ms: number) => string; onExport(): void; onClear(): void }): JSX.Element;
  export default function FlightRecorderPanel(): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `test/components/flightRecorderPanel.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const view = () => import("../../src/components/settings/flightRecorderView.ts");
const panel = () => import("../../src/components/settings/FlightRecorderPanel.tsx");
const t = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key);
// renderToStaticMarkup escapes text (" → &quot;); compare against the decoded text.
const decode = (html) => html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const HOUR = 3600000;
const now = Date.UTC(2026, 9, 15, 12, 0);
const ev = (o) => ({ id: 1, ts: now - HOUR, endedAt: now - HOUR + 400, task: "chat", host: "api.groq.com", hosts: [o?.host ?? "api.groq.com"], kind: o?.opaque ? "session" : "request", operationId: null, bytesOut: 3100, bytesIn: 9800, outcome: "ok", status: 200, errorClass: null, model: "gpt-oss-120b", attributed: true, opaque: false, ...o });
const sum = (o) => ({ left: 0, observed: 0, connections: 0, blocked: 0, unattributed: 0, unattributedHosts: [], bytesOut: 0, bytesIn: 0, unknownBytes: 0, opaqueSessions: 0, ...o });

test("timeline places ticks by minute over the last 24 h and classifies them", async () => {
  const { timelineTicks } = await view();
  const ticks = timelineTicks([
    ev({ id: 1, ts: now - HOUR }),
    ev({ id: 2, ts: now - 2 * HOUR, outcome: "blocked", bytesOut: 0 }),
    ev({ id: 3, ts: now - 3 * HOUR, task: "unattributed", attributed: false }),
    ev({ id: 4, ts: now - 25 * HOUR }),
  ], now);
  assert.deepEqual(ticks.map((k) => [k.id, k.minute, k.kind]), [
    [1, 1380, "sent"], [2, 1320, "blocked"], [3, 1260, "unexplained"],
  ]);
});

test("unknown bytes are never shown as zero", async () => {
  const { bytesCell } = await view();
  const fmt = (n) => `${n} B`;
  assert.deepEqual(bytesCell(null, fmt), { text: "—", unknown: true });
  assert.deepEqual(bytesCell(0, fmt), { text: "0 B", unknown: false });
});

test("live notices: recorded events are prepended once; dispatch notices are ignored", async () => {
  const { mergeNotice } = await view();
  const list = [ev({ id: 1 })];
  const next = mergeNotice(list, { phase: "recorded", event: ev({ id: 2, ts: now }) }, 0);
  assert.deepEqual(next.map((e) => e.id), [2, 1]);
  assert.equal(mergeNotice(next, { phase: "recorded", event: ev({ id: 2, ts: now }) }, 0), next);
  assert.equal(mergeNotice(next, { phase: "dispatched", ticketId: 9, task: "chat", targetId: "groq", host: "x", payload: "text", correlationId: null, ts: now }, 0), next);
  assert.equal(mergeNotice(next, { phase: "recorded", event: ev({ id: 3, ts: 5 }) }, 10), next, "older than the window");
});

test("the view: counts, hollow blocked ticks, unknown bytes, LTR hosts, unexplained notice", async () => {
  const { FlightRecorderView } = await panel();
  const html = decode(renderStatic(FlightRecorderView, {
    t, now, formatTime: (ms) => `T${ms}`, onExport() {}, onClear() {},
    events: [ev({ id: 1, bytesIn: null }), ev({ id: 2, outcome: "blocked", bytesOut: 0, bytesIn: 0 }), ev({ id: 3, task: "unattributed", host: "x.example.com", attributed: false })],
    summary: sum({ left: 2, observed: 2, blocked: 1, unattributed: 1, unattributedHosts: ["x.example.com"], bytesOut: 3100, bytesIn: 9800, unknownBytes: 1 }),
  }));
  assert.match(html, /settingsPage\.privacy\.recorder\.observedToday\{"count":2\}/);
  assert.match(html, /data-kind="blocked"/);
  assert.match(html, /settingsPage\.privacy\.recorder\.unknownBytes/);
  assert.match(html, /dir="ltr"[^>]*>api\.groq\.com/);
  assert.match(html, /role="status"[^>]*>[^<]*settingsPage\.privacy\.recorder\.unexplained\{"host":"x\.example\.com"\}/);
  assert.doesNotMatch(html, /secret|prompt/i);
});

test("the empty state makes no network claim beyond what was recorded", async () => {
  const { FlightRecorderView } = await panel();
  const html = decode(renderStatic(FlightRecorderView, {
    t, now, formatTime: String, onExport() {}, onClear() {}, events: [],
    summary: sum({}),
  }));
  assert.match(html, /settingsPage\.privacy\.recorder\.empty/);
  assert.doesNotMatch(html, /nothing|0 bytes/i);
  assert.match(html, /settingsPage\.privacy\.recorder\.loopbackNote/);
  assert.match(html, /settingsPage\.privacy\.recorder\.bytesNote/);
});

test("an opaque child session is counted apart, names its usual host, and shows no bytes", async () => {
  const { FlightRecorderView } = await panel();
  const html = decode(renderStatic(FlightRecorderView, {
    t, now, formatTime: String, onExport() {}, onClear() {},
    events: [ev({ id: 7, task: "codex", host: "chatgpt.com", bytesOut: null, bytesIn: null, opaque: true })],
    summary: sum({ left: 1, observed: 0, opaqueSessions: 1 }),
  }));
  assert.match(html, /settingsPage\.privacy\.recorder\.observedToday\{"count":0\}/);
  assert.match(html, /settingsPage\.privacy\.recorder\.sessionsToday\{"count":1\}/);
  assert.match(html, /settingsPage\.privacy\.recorder\.usualHost\{"host":"chatgpt\.com"\}/);
  assert.match(html, /settingsPage\.privacy\.recorder\.opaque/);
  assert.match(html, /data-kind="session"/);
  assert.doesNotMatch(html, /settingsPage\.privacy\.recorder\.unknownBytes/);
});

test("a row shows its host trail and, when it ran for a while, its end time", async () => {
  const { hostTrail, timeCell } = await view();
  const download = ev({ host: "huggingface.co", hosts: ["huggingface.co", "cdn-lfs.hf.co"], ts: 1000, endedAt: 61000 });
  assert.equal(hostTrail(download), "huggingface.co → cdn-lfs.hf.co");
  assert.equal(timeCell(download, (ms) => `T${ms}`), "T1000–T61000");
  assert.equal(timeCell(ev({ ts: 1000, endedAt: 1400 }), (ms) => `T${ms}`), "T1000");
});

test("connections are counted and labelled apart; operations that never left are not shown", async () => {
  const { FlightRecorderView } = await panel();
  const html = decode(renderStatic(FlightRecorderView, {
    t, now, formatTime: String, onExport() {}, onClear() {},
    events: [
      ev({ id: 1, task: "unattributed", host: "x.example.com", kind: "connection", attributed: false, bytesOut: 900, bytesIn: 4000 }),
      ev({ id: 2, kind: "operation", outcome: "error", host: "never-sent.example.com" }),
    ],
    summary: sum({ left: 1, connections: 1, unattributed: 1, unattributedHosts: ["x.example.com"] }),
  }));
  assert.match(html, /connectionsToday\{"count":1\}/);
  assert.match(html, /data-kind="connection"[\s\S]*settingsPage\.privacy\.recorder\.connection/);
  assert.doesNotMatch(html, /never-sent\.example\.com/);
});

test("while loading, the panel shows no count at all", async () => {
  const { FlightRecorderView } = await panel();
  const html = decode(renderStatic(FlightRecorderView, { t, now, formatTime: String, onExport() {}, onClear() {}, events: [], summary: null }));
  assert.match(html, /settingsPage\.privacy\.recorder\.loading/);
  assert.doesNotMatch(html, /observedToday/);
  assert.doesNotMatch(html, /settingsPage\.privacy\.recorder\.empty/);
});
```

Create `test/components/flightRecorderPipeline.test.js`. It runs producer → IPC → view with the real gate, recorder and privacy IPC, so the view is tested against what main actually sends:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { renderStatic } = require("../helpers/harness/reactSsr");
const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { SealedState } = require("../../src/helpers/privacy/sealedState");
const { attachPrivacyIPC } = require("../../src/helpers/privacy/privacyIPC");

const t = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key);
const decode = (html) => html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

test("a normal and an interrupted child session reach the view as sessions, not requests", async (t2) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-recorder-pipeline-"));
  t2.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let clock = Date.UTC(2026, 9, 15, 12, 0);
  const recorder = new FlightRecorder({ now: () => clock });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => false, recorder, now: () => clock });
  t2.after(() => gate._resetForTests());

  const handlers = new Map();
  const sent = [];
  const win = { webContents: { send: (c, p) => sent.push([c, p]), mainFrame: {} }, isDestroyed: () => false };
  const ipc = attachPrivacyIPC({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn), removeHandler: (c) => handlers.delete(c) },
    BrowserWindow: { getAllWindows: () => [win] },
    dialog: {},
    state: new SealedState({ profile: dir }),
    recorder,
    transition: Object.assign(new EventEmitter(), { apply: async () => {}, recheck() {}, snapshot: () => ({ phase: "open", effectiveSince: null, failures: [], notes: [] }) }),
    attest: () => ({}),
    isTrustedSender: () => true,
    confirm: { unseal: async () => true, clear: async () => true, openLink: async () => true },
    now: () => clock,
  });
  t2.after(() => ipc.dispose());
  const invoke = (channel, ...args) => handlers.get(channel)({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, ...args);

  // The producers Task 8 and Task 10 use: an opaque session settled on exit.
  const codex = gate.authorize({ task: "codex", target: "https://chatgpt.com", provider: "codex", meter: "opaque", payload: "text" });
  clock += 5000;
  codex.settle({ outcome: "ok" });
  const ytdlp = gate.authorize({ task: "urlImport", target: "https://www.youtube.com", meter: "opaque", payload: "metadata" });
  clock += 2000;
  gate.abortAllRemote(); // sealing mid-session
  ytdlp.settle({ outcome: "cancelled" });

  const events = await invoke("privacy:egress-list", { since: 0 });
  const summary = await invoke("privacy:egress-summary", { since: 0 });
  assert.deepEqual([summary.observed, summary.connections, summary.opaqueSessions], [0, 0, 2]);
  assert.equal(sent.filter(([c, p]) => c === "privacy:egress-event" && p.phase === "recorded").length, 2, "both rows were pushed live");

  const { FlightRecorderView } = await import("../../src/components/settings/FlightRecorderPanel.tsx");
  const html = decode(renderStatic(FlightRecorderView, { t, now: clock, formatTime: (ms) => `T${ms}`, onExport() {}, onClear() {}, events, summary }));
  assert.match(html, /observedToday\{"count":0\}/);
  assert.match(html, /sessionsToday\{"count":2\}/);
  assert.match(html, /usualHost\{"host":"chatgpt\.com"\}/);
  assert.match(html, /outcome\.cancelled/);
  assert.equal((html.match(/recorder\.opaque/g) || []).length, 2);
});
```

If Task 7's `attachPrivacyIPC` requires further arguments, pass the same values `test/helpers/privacyIPC.test.js` passes.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/components/flightRecorderPanel.test.js test/components/flightRecorderPipeline.test.js`
Expected: FAIL with missing modules.

- [ ] **Step 3: View model**

Create `src/components/settings/flightRecorderView.ts`:

```ts
import type { EgressEvent, EgressNotice } from "../../types/privacy";

export type TickKind = "sent" | "session" | "blocked" | "unexplained";
export type Tick = { id: number; minute: number; kind: TickKind; event: EgressEvent };
const DAY_MS = 24 * 60 * 60 * 1000;

// Operations that never reached a transport did not leave; they are not shown.
export const shownEvents = (events: EgressEvent[]): EgressEvent[] => events.filter((e) => e.kind !== "operation");

export function timelineTicks(events: EgressEvent[], now: number): Tick[] {
  const start = now - DAY_MS;
  return shownEvents(events)
    .filter((e) => e.ts >= start && e.ts <= now)
    .map((e) => ({
      id: e.id,
      minute: Math.min(1439, Math.floor((e.ts - start) / 60000)),
      kind: e.outcome === "blocked" ? "blocked" : !e.attributed ? "unexplained" : e.opaque ? "session" : "sent",
      event: e,
    }));
}

export function mergeNotice(events: EgressEvent[], notice: EgressNotice, since: number): EgressEvent[] {
  if (notice.phase !== "recorded" || notice.event.ts < since || notice.event.kind === "operation") return events;
  if (events.some((e) => e.id === notice.event.id)) return events;
  return [notice.event, ...events];
}

export function startOfToday(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

// Main reports null when it could not measure; that is not zero.
export function bytesCell(n: number | null, format: (n: number) => string): { text: string; unknown: boolean } {
  return n == null ? { text: "—", unknown: true } : { text: format(n), unknown: false };
}

// Every host the request reached, in order (redirects, CDN hosts).
export function hostTrail(e: EgressEvent): string {
  return (e.hosts?.length ? e.hosts : [e.host]).join(" → ");
}

// Start time, plus the end time when the request ran for a second or more.
export function timeCell(e: EgressEvent, formatTime: (ms: number) => string): string {
  return e.endedAt != null && e.endedAt - e.ts >= 1000 ? `${formatTime(e.ts)}–${formatTime(e.endedAt)}` : formatTime(e.ts);
}
```

- [ ] **Step 4: Panel**

Create `src/components/settings/FlightRecorderPanel.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EgressEvent, EgressSummary } from "../../types/privacy";
import { formatBytes } from "../../utils/formatBytes";
import { Button } from "../ui/button";
import { bytesCell, hostTrail, mergeNotice, shownEvents, startOfToday, timeCell, timelineTicks } from "./flightRecorderView";

const R = "settingsPage.privacy.recorder";
type T = (key: string, params?: object) => string;

function Bytes({ n, t }: { n: number | null; t: T }) {
  const cell = bytesCell(n, formatBytes);
  return cell.unknown ? (
    <span>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{t(`${R}.unknownBytes`)}</span>
    </span>
  ) : (
    <span>{cell.text}</span>
  );
}

export function FlightRecorderView({
  t,
  events,
  summary,
  now,
  formatTime,
  onExport,
  onClear,
}: {
  t: T;
  events: EgressEvent[];
  summary: EgressSummary | null;
  now: number;
  formatTime: (ms: number) => string;
  onExport: () => void;
  onClear: () => void;
}) {
  const ticks = timelineTicks(events, now);
  return (
    <section aria-label={t(`${R}.title`)} className="space-y-3 rounded-lg border border-border p-4">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 className="text-[13px] font-semibold">{t(`${R}.title`)}</h3>
        <p className="text-[12px] text-muted-foreground">{t(`${R}.subtitle`)}</p>
      </header>
      {summary === null ? (
        // Loading: claim nothing, not even zero.
        <p className="text-[12px] text-muted-foreground">{t(`${R}.loading`)}</p>
      ) : (
        <div className="flex items-baseline gap-3">
          <span className="text-[28px] font-bold tabular-nums">{summary.observed}</span>
          <span className="text-[12px]">
            {t(`${R}.observedToday`, { count: summary.observed })}
            {summary.connections > 0 && (
              <span className="block text-muted-foreground">{t(`${R}.connectionsToday`, { count: summary.connections })}</span>
            )}
            {summary.opaqueSessions > 0 && (
              <span className="block text-muted-foreground">{t(`${R}.sessionsToday`, { count: summary.opaqueSessions })}</span>
            )}
            {summary.blocked > 0 && (
              <span className="block text-muted-foreground">{t(`${R}.blockedToday`, { count: summary.blocked })}</span>
            )}
          </span>
        </div>
      )}
      {summary && summary.unattributed > 0 && (
        <p role="status" className="rounded-md border border-destructive/50 px-3 py-2 text-[12px]">
          {t(`${R}.unexplained`, { host: summary.unattributedHosts[0] })}
        </p>
      )}
      <div
        role="img"
        aria-label={t(`${R}.timelineLabel`)}
        className="relative h-12 overflow-hidden rounded-md border border-border bg-muted/30"
      >
        {ticks.map((tick) => (
          <span
            key={tick.id}
            data-kind={tick.kind}
            title={t(`${R}.tick`, {
              time: formatTime(tick.event.ts),
              task: t(`${R}.tasks.${tick.event.task}`),
              host: tick.event.host,
            })}
            style={{ insetInlineStart: `${(tick.minute / 1440) * 100}%` }}
            className={[
              "absolute bottom-0 h-6 w-[3px] rounded-t-sm",
              tick.kind === "sent" && "bg-[var(--color-locality-remote,#b45309)]",
              tick.kind === "session" && "border border-[var(--color-locality-remote,#b45309)] bg-[var(--color-locality-remote,#b45309)]/40",
              tick.kind === "unexplained" && "bg-destructive",
              tick.kind === "blocked" && "border border-muted-foreground bg-transparent",
            ]
              .filter(Boolean)
              .join(" ")}
          />
        ))}
      </div>
      {summary !== null && shownEvents(events).length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{t(`${R}.empty`)}</p>
      ) : shownEvents(events).length === 0 ? null : (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-start text-muted-foreground">
              {["time", "task", "host", "sent", "received", "status", "model"].map((c) => (
                <th key={c} scope="col" className="py-2 text-start font-semibold">
                  {t(`${R}.columns.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {shownEvents(events).map((e) => (
              <tr key={e.id} data-kind={e.kind} className="h-8 border-t border-border/60">
                <td>{timeCell(e, formatTime)}</td>
                <td>{t(`${R}.tasks.${e.task}`)}</td>
                <td>
                  {e.opaque ? (
                    // Loqui knows where this program usually connects, not where it did.
                    <span>{t(`${R}.usualHost`, { host: e.host })}</span>
                  ) : (
                    <span dir="ltr" className="font-mono">{hostTrail(e)}</span>
                  )}
                </td>
                {e.opaque ? (
                  // A child process's own traffic: Loqui saw the session, not its bytes.
                  <td colSpan={2} className="text-muted-foreground">{t(`${R}.opaque`)}</td>
                ) : e.kind === "connection" ? (
                  // A connection whose requests Loqui could not inspect (I3-R2).
                  <td colSpan={2} className="text-muted-foreground">{t(`${R}.connection`)}</td>
                ) : (
                  <>
                    <td><Bytes n={e.bytesOut} t={t} /></td>
                    <td><Bytes n={e.bytesIn} t={t} /></td>
                  </>
                )}
                <td>
                  {t(`${R}.outcome.${e.outcome}`)}
                  {(e.status ?? e.errorClass) != null && <span className="ms-1 text-muted-foreground">{e.status ?? e.errorClass}</span>}
                </td>
                <td dir="ltr">{e.model ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-[12px] text-muted-foreground">{t(`${R}.loopbackNote`)}</p>
      <p className="text-[12px] text-muted-foreground">{t(`${R}.bytesNote`)}</p>
      <p className="text-[12px] text-muted-foreground">{t(`${R}.retention`)}</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onExport}>{t(`${R}.export`)}</Button>
        <Button variant="outline" size="sm" onClick={onClear} disabled={events.length === 0}>{t(`${R}.clear`)}</Button>
      </div>
    </section>
  );
}

export default function FlightRecorderPanel() {
  const { t, i18n } = useTranslation();
  const api = window.electronAPI?.privacy;
  const [events, setEvents] = useState<EgressEvent[]>([]);
  const [summary, setSummary] = useState<EgressSummary | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const since = startOfToday(now);
  const refresh = useCallback(async () => {
    if (!api) return;
    const [list, sum] = await Promise.all([api.listEgress({ since }), api.egressSummary({ since })]);
    setEvents(list);
    setSummary(sum);
  }, [api, since]);
  useEffect(() => {
    void refresh();
    if (!api) return;
    const offEvent = api.onEgress((notice) => {
      setNow(Date.now());
      setEvents((list) => mergeNotice(list, notice, since));
      if (notice.phase === "recorded") void api.egressSummary({ since }).then(setSummary);
    });
    const offCleared = api.onEgressCleared(() => void refresh());
    return () => {
      offEvent();
      offCleared();
    };
  }, [api, refresh, since]);
  const formatTime = (ms: number) =>
    new Intl.DateTimeFormat(i18n.language, { hour: "numeric", minute: "2-digit" }).format(ms);
  return (
    <>
      <FlightRecorderView
        t={t}
        events={events}
        summary={summary}
        now={now}
        formatTime={formatTime}
        onExport={() => void api?.exportEgressCsv()}
        // Main asks for confirmation in its own dialog; "Keep records" resolves false.
        onClear={() => void api?.clearEgress()}
      />
    </>
  );
}
```

`clearEgress` deletes all history after main's confirmation. If `--color-locality-remote` is not the exact token Plan 01 shipped, use whichever `--color-locality-*` token marks remote.

In `SettingsPage.tsx`, import `FlightRecorderPanel` from `./settings/FlightRecorderPanel` and render it directly after `<SealedModePanel />`.

- [ ] **Step 5: Strings, in all 11 locales**

These are the English source strings. Merge them with the Task 14, Step 6 script, using a fresh `/tmp/loqui-sealed-i18n.json` that holds only these keys.

```json
{
  "settingsPage.privacy.recorder.title": "Flight recorder",
  "settingsPage.privacy.recorder.subtitle": "What Loqui sent off this computer today, as its network guards saw it. Metadata only: no audio, text or keys are stored here.",
  "settingsPage.privacy.recorder.observedToday_one": "{{count}} request Loqui saw leave this computer today",
  "settingsPage.privacy.recorder.observedToday_other": "{{count}} requests Loqui saw leave this computer today",
  "settingsPage.privacy.recorder.sessionsToday_one": "Plus {{count}} helper session (Codex or yt-dlp) whose requests Loqui can't see",
  "settingsPage.privacy.recorder.sessionsToday_other": "Plus {{count}} helper sessions (Codex or yt-dlp) whose requests Loqui can't see",
  "settingsPage.privacy.recorder.usualHost": "Usually {{host}}",
  "settingsPage.privacy.recorder.connectionsToday_one": "Plus {{count}} connection whose requests Loqui couldn't inspect",
  "settingsPage.privacy.recorder.connectionsToday_other": "Plus {{count}} connections whose requests Loqui couldn't inspect",
  "settingsPage.privacy.recorder.connection": "Connection — the requests inside it are not visible to Loqui; listed when it closes",
  "settingsPage.privacy.recorder.loading": "Loading…",
  "settingsPage.privacy.recorder.blockedToday": "Blocked by Sealed mode: {{count}}",
  "settingsPage.privacy.recorder.loopbackNote": "Requests to services on this computer, such as local models, are not listed: they never leave it.",
  "settingsPage.privacy.recorder.retention": "Records follow your transcript retention setting. With local history off, they are kept only until Loqui quits.",
  "settingsPage.privacy.recorder.unexplained": "Loqui contacted {{host}} and couldn't match it to a task.",
  "settingsPage.privacy.recorder.empty": "No recorded requests for this period.",
  "settingsPage.privacy.recorder.opaque": "Session — its traffic is not visible to Loqui",
  "settingsPage.privacy.recorder.bytesNote": "Sent and received count request and response bodies; live transcription counts the whole connection. “—” means Loqui could not measure it.",
  "settingsPage.privacy.recorder.timelineLabel": "Requests over the last 24 hours",
  "settingsPage.privacy.recorder.tick": "{{time}} {{task}} → {{host}}",
  "settingsPage.privacy.recorder.unknownBytes": "unknown",
  "settingsPage.privacy.recorder.columns.time": "Time",
  "settingsPage.privacy.recorder.columns.task": "Task",
  "settingsPage.privacy.recorder.columns.host": "Host",
  "settingsPage.privacy.recorder.columns.sent": "Sent",
  "settingsPage.privacy.recorder.columns.received": "Received",
  "settingsPage.privacy.recorder.columns.status": "Status",
  "settingsPage.privacy.recorder.columns.model": "Model",
  "settingsPage.privacy.recorder.outcome.ok": "Sent",
  "settingsPage.privacy.recorder.outcome.error": "Failed",
  "settingsPage.privacy.recorder.outcome.blocked": "Blocked",
  "settingsPage.privacy.recorder.outcome.cancelled": "Stopped",
  "settingsPage.privacy.recorder.export": "Export CSV",
  "settingsPage.privacy.recorder.clear": "Clear history",
  "settingsPage.privacy.recorder.tasks.dictationStt": "Dictation",
  "settingsPage.privacy.recorder.tasks.noteRecordingStt": "Note recording",
  "settingsPage.privacy.recorder.tasks.uploadStt": "Audio upload",
  "settingsPage.privacy.recorder.tasks.dictationCleanup": "Dictation cleanup",
  "settingsPage.privacy.recorder.tasks.voiceAssistant": "Voice assistant",
  "settingsPage.privacy.recorder.tasks.assistantVision": "Assistant vision",
  "settingsPage.privacy.recorder.tasks.translation": "Translation",
  "settingsPage.privacy.recorder.tasks.noteFormatting": "Note formatting",
  "settingsPage.privacy.recorder.tasks.chat": "Chat",
  "settingsPage.privacy.recorder.tasks.speakerId": "Speaker identification",
  "settingsPage.privacy.recorder.tasks.semanticSearch": "Semantic search",
  "settingsPage.privacy.recorder.tasks.providerCheck": "Provider check",
  "settingsPage.privacy.recorder.tasks.modelDownload": "Model download",
  "settingsPage.privacy.recorder.tasks.runtimeDownload": "Runtime download",
  "settingsPage.privacy.recorder.tasks.urlImport": "URL import",
  "settingsPage.privacy.recorder.tasks.appUpdate": "Updates",
  "settingsPage.privacy.recorder.tasks.codex": "ChatGPT (Codex)",
  "settingsPage.privacy.recorder.tasks.calendar": "Calendars",
  "settingsPage.privacy.recorder.tasks.unattributed": "Unexplained"
}
```

- [ ] **Step 6: Docs**

Add this section to `docs/PRIVACY.md`, after "When network requests occur" and before "Updates and calendars":

```markdown
## Sealed mode and the flight recorder

**Sealed mode** (Privacy & Data) is enforced in the main process. While it is on, nothing that Loqui, its windows or the programs it starts send leaves this computer: provider requests, connection checks, model and runtime downloads, update checks, Codex, calendars and URL imports are all refused before a connection opens, and work already in flight is stopped. Only loopback (`localhost`, `127.0.0.0/8`, `::1`) is reachable, so on-device models keep working. A self-hosted server on another machine on your network is blocked too. Links open in your browser only after you confirm, because your browser's traffic is outside Sealed mode. Local model servers that Loqui starts (llama-server, whisper-server, Parakeet, Qdrant) keep running so on-device routes work. Loqui refuses to start them with download options or a non-local address, and Qdrant only with telemetry off. But it cannot see inside them once they run, so the Sealed mode panel names them as "not inspected" instead of counting them as verified. A proxy or port-forwarder you run on this computer is treated as local. If the setting file cannot be read, Loqui stays sealed. Turning Sealed mode off asks for confirmation in a system dialog that the app window cannot answer for you. The panel says Sealed mode is verified only after the main process has confirmed that every request in flight has stopped, its network guards are active, no network-capable helper (Codex, yt-dlp) is running, and no environment proxy is in use. It dates the claim from that moment.

When Sealed mode blocks a request, your content is kept: a chat message stays in the conversation, and a dictation recording is kept in History for retry when local history and audio retention allow it. While sealed, a dictation that would use a cloud speech-to-text route does not start at all. A request that was already under way when you turned Sealed mode on is stopped, and Loqui says the provider may have received part of it.

The **flight recorder** lists requests that left this computer: time, task, destination host, bytes sent and received when measurable, outcome, HTTP status or error class, and model id. Bytes count request and response bodies, not headers or encryption overhead, except live transcription, which counts the whole connection. Codex and yt-dlp run as separate programs that make their own connections. Each run appears as one session with its usual host, marked "traffic not visible to Loqui", because Loqui cannot see their individual requests. It never stores audio, text, prompts, keys, full URLs or error messages. Records follow transcript retention (with "Forever", the newest 100,000 are kept). With local history off, records are kept in memory only and disappear when Loqui quits. **Export CSV** saves a copy you choose the location of; **Clear history** deletes the records from this computer.
```

In the "When network requests occur" paragraph after its table, add the sentence: `To block all of these at once, turn on Sealed mode (see below).`

Append to the DESIGN.md section from Task 14:

```markdown
- **Recorder.** Big count 28/700 tabular; timeline 24 h, one tick per request at its minute (`inset-inline-start`), sent ticks in the remote locality colour, unexplained in destructive, blocked hollow (outline only, never colour alone: each tick has a title naming time, task and host). Rows 32 px; host in monospace `dir="ltr"`; numbers `tabular-nums`; status is text plus code. An unexplained host raises a `role="status"` notice naming the host.
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- test/components/flightRecorderPanel.test.js test/components/sealedModePanel.test.js && npm run typecheck && npm run i18n:check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/settings/FlightRecorderPanel.tsx src/components/settings/flightRecorderView.ts src/components/SettingsPage.tsx src/locales docs/PRIVACY.md DESIGN.md test/components/flightRecorderPanel.test.js
git commit -m "feat(privacy): add the flight recorder view and document Sealed mode"
```

---

### Task 16: Electron sealed acceptance run, with an independent observer

The unit tests and the matrix (Task 12) run in Node with fakes for Electron. This task runs the real app in Electron and attacks it with every transport it ships: Electron `net`, Node `http(s)`, `ws`, a renderer page (an image and `fetch`), a redirect out of loopback, and electron-updater. It runs with Sealed mode on and, as a control, with it off.

The **observer is independent of the code under test.** Two fixture HTTP servers listen on 127.0.0.1:
- The **remote fixture** stands in for the internet. Remote-looking hostnames are mapped to it: by Chromium's `--host-resolver-rules` for Chromium traffic, and by a `lookup` option for Node sockets. It is never addressed as loopback. It logs every TCP connection as well as every request, so a speculative preconnect that sends no request is still seen. If it logs anything while sealed, something left. Loqui's own observer cannot say otherwise, and is not consulted.
- The **local fixture** is addressed only as `127.0.0.1`. It proves local routes keep working, and it is where the redirect probe starts.

The script has no offline blockers of its own. `scripts/smoke-electron.cjs:71-83` installs blockers that could hide a missing guard (I1); this script installs none. The backstop and the gate are the only things standing between the probes and the fixture.

**Files:**
- Create: `scripts/sealed-acceptance.cjs`. It is both the launcher (run with Node) and the Electron bootstrap, the same pattern as `scripts/smoke-electron.cjs`.
- Create: `scripts/lib/egressFixture.cjs`, the logging fixture server.
- Modify: `package.json`. Add `"test:sealed-electron": "node scripts/sealed-acceptance.cjs"`.

**Interfaces:**
- Consumes the shipped app: `main.js`, the privacy boot (Task 7), the backstop (Task 6), the child registry (Task 6a) and `window.electronAPI.privacy` through the real preload.
- Produces `report.json` and `netlog.json` in the output directory. The netlog is an artifact for the security review (Task 18), not an assertion source.

- [ ] **Step 1: Write the fixture**

Create `scripts/lib/egressFixture.cjs`:

```js
const http = require("node:http");

// Logs every TCP connection and every request it receives. As the remote
// fixture it is the independent observer: anything it saw while Loqui was
// sealed left Loqui. `redirectTo` makes /redirect point at another origin.
function startEgressFixture({ redirectTo = null } = {}) {
  const hits = [];
  const connections = [];
  const server = http.createServer((req, res) => {
    hits.push({ at: Date.now(), host: String(req.headers.host || ""), path: req.url });
    if (req.url === "/redirect" && redirectTo) {
      res.writeHead(302, { location: `${redirectTo}/after-redirect` });
      return res.end();
    }
    if (req.url.endsWith(".yml")) {
      res.writeHead(200, { "content-type": "text/yaml" });
      return res.end("version: 0.0.1\npath: none.zip\nsha512: none\nreleaseDate: '2026-01-01T00:00:00.000Z'\n");
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  server.on("upgrade", (req, socket) => {
    hits.push({ at: Date.now(), host: String(req.headers.host || ""), path: `${req.url} (upgrade)` });
    socket.destroy();
  });
  server.on("connection", () => connections.push({ at: Date.now() }));
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        port: server.address().port,
        hits,
        // Requests and bare connections (a preconnect sends no request).
        seenSince: (since = 0) => ({
          requests: hits.filter((h) => h.at >= since),
          connections: connections.filter((c) => c.at >= since).length,
        }),
        close: () => new Promise((r) => server.close(r)),
      })
    )
  );
}

module.exports = { startEgressFixture };
```

- [ ] **Step 2: Write the bootstrap and probes**

Create `scripts/sealed-acceptance.cjs`. The bootstrap half:

```js
#!/usr/bin/env node
/**
 * Sealed-mode acceptance run (Plan 07, Task 16). Launches the real app twice
 * against a logging fixture server and checks that, while sealed, the fixture
 * receives nothing from any transport. Requires a built renderer and native
 * modules rebuilt for Electron. No network access is needed.
 * Run: node scripts/sealed-acceptance.cjs [--output-dir DIR]
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const repoRoot = path.resolve(__dirname, "..");

function bootstrapElectron() {
  const electron = require("electron");
  const sandbox = process.env.LOQUI_ACCEPT_SANDBOX;
  const port = Number(process.env.LOQUI_ACCEPT_PORT); // the remote fixture
  const localPort = Number(process.env.LOQUI_ACCEPT_LOCAL_PORT); // the local fixture
  if (!sandbox || !process.env.LOQUI_PROFILE_DIR || !port || !localPort) throw new Error("Acceptance bootstrap requires its sandbox.");
  const temporaryHome = path.join(sandbox, "home");
  fs.mkdirSync(temporaryHome, { recursive: true });
  os.homedir = () => temporaryHome;
  electron.app.setPath("home", temporaryHome);
  electron.app.setAppPath(repoRoot);
  // Chromium resolves the fixture names to the fixture. Node does not read this
  // switch; the Node probes pass their own lookup.
  electron.app.commandLine.appendSwitch("host-resolver-rules", "MAP *.loqui-fixture.test 127.0.0.1");
  electron.app.whenReady().then(() => electron.netLog.startLogging(path.join(sandbox, "netlog.json")));

  const toFixture = (_host, options, callback) =>
    options?.all ? callback(null, [{ address: "127.0.0.1", family: 4 }]) : callback(null, "127.0.0.1", 4);
  const url = (host, p) => `http://${host}.loqui-fixture.test:${port}${p}`;
  const settle = (promise) => promise.then(() => "reached", (error) => error?.code || error?.name || "error");

  // Every probe makes a real attempt and reports how it ended. The fixture
  // log, not these results, decides whether anything left.
  async function runProbes(label) {
    const { net, BrowserWindow } = electron;
    const http = require("node:http");
    const WebSocket = require(path.join(repoRoot, "node_modules/ws"));
    const results = {};
    results.netFetch = await settle(net.fetch(url("api", `/net-fetch-${label}`)));
    results.netRequest = await settle(
      new Promise((resolve, reject) => {
        const req = net.request(url("api", `/net-request-${label}`));
        req.on("response", resolve);
        req.on("error", reject);
        req.end();
      })
    );
    results.nodeHttp = await settle(
      new Promise((resolve, reject) => {
        const req = http.get(url("api", `/node-http-${label}`), { lookup: toFixture }, resolve);
        req.on("error", reject);
      })
    );
    results.ws = await settle(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://stream.loqui-fixture.test:${port}/ws-${label}`, { lookup: toFixture });
        ws.on("error", reject);
        ws.on("close", resolve);
      })
    );
    // Out of loopback by redirect: the first hop is the local fixture and allowed.
    results.redirect = await settle(net.fetch(`http://127.0.0.1:${localPort}/redirect`));
    // A renderer page: an image and a fetch, in a fresh window of the default session.
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await win.loadURL(
      "data:text/html," +
        encodeURIComponent(
          `<link rel="preconnect" href="${url("preconnect", "/")}"><link rel="dns-prefetch" href="${url("prefetch", "/")}">` +
            `<a href="${url("link", `/link-${label}`)}">link</a>` +
            `<img src="${url("img", `/img-${label}.png`)}"><script>fetch("${url("api", `/renderer-fetch-${label}`)}").catch(()=>{})</script>`
        )
    );
    await new Promise((r) => setTimeout(r, 1000));
    win.destroy();
    results.renderer = "attempted";
    // electron-updater's own request path, pointed at the fixture. The app's
    // UpdateManager stays as configured; this probes the transport underneath.
    try {
      const { autoUpdater: updater } = require(path.join(repoRoot, "node_modules/electron-updater"));
      updater.autoDownload = false;
      updater.setFeedURL({ provider: "generic", url: url("updates", "/") });
      results.updater = await settle(updater.checkForUpdates());
    } catch (error) {
      results.updater = `setup:${error.message}`;
    }
    // Loopback must keep working.
    results.loopback = await settle(net.fetch(`http://127.0.0.1:${localPort}/loopback-${label}`).then((r) => r.text()));
    return results;
  }

  // A network-capable child registered like yt-dlp. It ignores SIGTERM, so
  // the registry has to escalate and wait for the OS to report the exit.
  function startStubbornChild() {
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "ignore",
    });
    require(path.join(repoRoot, "src/helpers/privacy/childRegistry.js")).register(child, { kind: "yt-dlp" });
    return child.pid;
  }
  const pidAlive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  globalThis.__loquiAcceptance = { runProbes, startStubbornChild, pidAlive };
  require(path.join(repoRoot, "main.js"));
}
```

The spawn above runs before the seal, so the spawn guard allows it. It is registered under the kind the barrier must stop.

- [ ] **Step 3: Write the launcher and its assertions**

Append the launcher half:

```js
async function acceptance() {
  const { _electron } = require("playwright");
  const { startEgressFixture } = require("./lib/egressFixture.cjs");
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output-dir");
  const output = outputIndex === -1 ? fs.mkdtempSync(path.join(os.tmpdir(), "loqui-sealed-accept-")) : path.resolve(args[outputIndex + 1]);
  fs.mkdirSync(output, { recursive: true });
  const fixture = await startEgressFixture(); // remote: only ever reached through fake hostnames
  const local = await startEgressFixture({ redirectTo: `http://api.loqui-fixture.test:${fixture.port}` });
  const report = { output, port: fixture.port, localPort: local.port, runs: {}, passed: [] };
  const leaked = (since) => fixture.seenSince(since);
  const nothingLeft = (since) => leaked(since).requests.length === 0 && leaked(since).connections === 0;
  const verify = (name, condition, detail) => {
    assert.ok(condition, `${name}${detail ? `: ${JSON.stringify(detail)}` : ""}`);
    report.passed.push(name);
    console.log(`PASS ${name}`);
  };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(read, predicate, message, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = await read();
      if (predicate(value)) return value;
      await pause(200);
    }
    throw new Error(`Timed out: ${message}`);
  }

  async function launch(name, { bootSealed }) {
    const sandbox = fs.mkdtempSync(path.join(output, `${name}-`));
    const profile = path.join(sandbox, "profile");
    fs.mkdirSync(profile);
    if (bootSealed) fs.writeFileSync(path.join(profile, "privacy.json"), JSON.stringify({ sealed: true, sealedSince: Date.now() }), { mode: 0o600 });
    const env = {
      ...process.env,
      NODE_ENV: "test",
      LOQUI_PROFILE_DIR: profile,
      LOQUI_ACCEPT_SANDBOX: sandbox,
      LOQUI_ACCEPT_PORT: String(fixture.port),
      LOQUI_ACCEPT_LOCAL_PORT: String(local.port),
      LOQUI_CACHE_ROOT: path.join(sandbox, "cache"),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({ executablePath: require("electron"), args: ["--lang=en-US", __filename], cwd: repoRoot, env, timeout: 45000 });
    const panel = await waitFor(
      async () => app.windows().find((page) => /[?&]panel=true(?:&|$)/.test(page.url())),
      Boolean,
      "control panel page"
    );
    await panel.waitForFunction(() => !!window.electronAPI?.privacy);
    return { app, panel, sandbox };
  }
  const attestation = (panel) => panel.evaluate(() => window.electronAPI.privacy.getAttestation());
  const probe = (app, label) => app.evaluate((_electron, l) => globalThis.__loquiAcceptance.runProbes(l), label);
  const EXPECTED_REMOTE = ["net-fetch", "net-request", "node-http", "ws", "after-redirect", "img", "renderer-fetch", "updates"];
  const kinds = (hits) => EXPECTED_REMOTE.filter((k) => hits.some((h) => h.path.includes(k) || h.host.startsWith(`${k}.`)));
  // Preconnect and dns-prefetch hints are not required to fire in the control
  // run (Chromium may skip them); while sealed they must not reach the fixture,
  // which the connection count covers.

  try {
    // Run 1: the control. Unsealed, every probe must reach the fixture, which
    // proves each probe would be seen if it leaked.
    {
      const { app, panel } = await launch("open", { bootSealed: false });
      const since = Date.now();
      report.runs.openProbes = await probe(app, "open");
      const reached = kinds(leaked(since).requests);
      verify("control: every remote probe reached the fixture while unsealed", reached.length === EXPECTED_REMOTE.length, { reached });
      // C2-R2: in the top page, and in frames the page creates for itself.
      const webrtc = await panel.evaluate(() => {
        const blank = document.createElement("iframe");
        document.body.append(blank);
        const viaBlank = typeof blank.contentWindow.RTCPeerConnection;
        const srcdoc = document.createElement("iframe");
        srcdoc.srcdoc = "<p>x</p>";
        document.body.append(srcdoc);
        return new Promise((resolve) => srcdoc.addEventListener("load", () => {
          const result = { top: typeof RTCPeerConnection, blank: viaBlank, srcdoc: typeof srcdoc.contentWindow.RTCPeerConnection, bridgeInFrame: typeof blank.contentWindow.electronAPI };
          blank.remove();
          srcdoc.remove();
          resolve(result);
        }, { once: true }));
      });
      verify("renderer: WebRTC is absent in the page and in about:blank and srcdoc frames; frames get no IPC bridge", Object.values(webrtc).every((v) => v === "undefined"), webrtc);

      // Seal from the renderer through the real preload and trusted IPC, with a
      // stubborn network-capable child running.
      const pid = await app.evaluate(() => globalThis.__loquiAcceptance.startStubbornChild());
      // setSealed resolves after main's sealing barrier ran. The leak probes run
      // now, before and independently of verification: the independent
      // observer must not depend on the thing under test reporting success
      // (the Step 5 drill relies on this ordering).
      await panel.evaluate(() => window.electronAPI.privacy.setSealed(true));
      const sealedAt = Date.now();
      report.runs.toggledProbes = await probe(app, "toggled");
      await pause(1500); // let late renderer, preconnect and updater traffic surface
      verify("toggle: the remote fixture saw no request and no connection after sealing", nothingLeft(sealedAt), leaked(sealedAt));
      // Then the attestation, judged separately.
      const verified = await waitFor(() => attestation(panel), (a) => a.nothingLeaves === true, "verified seal after toggling", 20000);
      verify("toggle: the child was gone before the seal was verified", !(await app.evaluate((_e, p) => globalThis.__loquiAcceptance.pidAlive(p), pid)));
      verify("toggle: verification is dated after the toggle", verified.effectiveSince >= sealedAt - 1000);
      verify("toggle: loopback still works", report.runs.toggledProbes.loopback === "reached");
      verify(
        "toggle: every remote probe was attempted and refused",
        Object.entries(report.runs.toggledProbes).filter(([k]) => !["loopback", "renderer"].includes(k)).every(([, v]) => v !== "reached"),
        report.runs.toggledProbes
      );
      await app.close();
    }

    // Run 2: sealed from boot. Nothing remote, from the first instruction.
    {
      const since = Date.now();
      const { app, panel } = await launch("sealed", { bootSealed: true });
      const a = await waitFor(() => attestation(panel), (x) => x.sealed === true, "sealed attestation");
      verify("boot: the app reports sealed", a.sealed === true);
      report.runs.bootProbes = await probe(app, "boot");
      await pause(1500); // let late renderer and updater requests surface
      verify("boot: the remote fixture saw no request and no connection during the whole sealed run", nothingLeft(since), leaked(since));
      verify("boot: loopback works", report.runs.bootProbes.loopback === "reached");
      const ledger = await panel.evaluate(() => window.electronAPI.privacy.egressSummary({ since: 0 }));
      verify("boot: the refused attempts are in the flight recorder as blocked", ledger.blocked > 0, ledger);
      await app.close();
    }
  } finally {
    await fixture.close();
    await local.close();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Acceptance artifacts: ${output}`);
  }
}

if (process.versions.electron) bootstrapElectron();
else
  acceptance().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
```

Notes for the implementer:
- `app.evaluate` runs in Electron main with the `electron` module as its first argument; the probes live on `globalThis` because the evaluated function cannot `require`.
- If `ws` or `electron-updater` resolve differently in this repo, fix the `require` paths, never drop the probe. Each kind in `EXPECTED_REMOTE` must be reached in the control run, or the sealed result for it proves nothing.
- If the updater probe cannot be pointed at the fixture on a platform (`setFeedURL` refuses in an unpackaged app), record `report.runs.*.updater` and keep the probe out of `EXPECTED_REMOTE` on that platform only, with a comment naming the reason. The matrix (Task 12, N16) still covers the gate.
- A probe that hangs is a failure, not a pass: keep the per-probe settle bounded by the fixture's own response.

- [ ] **Step 4: Run it**

```bash
npm run native:electron
npm run build
npm run test:sealed-electron -- --output-dir /tmp/loqui-sealed-accept
npm run native:node
```

Expected: every `PASS` line prints, and the script exits with code 0. `report.json` lists the probe results for each run. On failure, the assertion names the probe whose request reached the fixture.

- [ ] **Step 5: Prove the observer catches a leak**

Temporarily comment out the `installNodeBackstop()` call in `privacyBoot.bootEgressGuards` and rebuild. Rerun: "toggle: the remote fixture saw no request and no connection after sealing" must fail on `node-http` or `ws`. It runs before any attestation wait, so the drill reaches it. (The attestation check that follows also fails, because `guardsUp` is false; that is a second, separate signal.) Restore the line. Record the failing output in the PR description.

- [ ] **Step 6: Commit**

```bash
git add scripts/sealed-acceptance.cjs scripts/lib/egressFixture.cjs package.json
git commit -m "test(privacy): Electron sealed acceptance run with an independent fixture observer"
```

---

### Task 17: Whole-plan verification and manual checks

The sealed Electron evidence comes from Task 16's acceptance run, whose observer is independent of the app. An earlier draft added a sealed mode to `scripts/smoke-electron.cjs` that checked `egress.every((e) => e.allowed === false)`. That check passes on an empty list, and it trusted the backstop's own observer, so it is not used (I1). The regular smoke run stays as it is.

**Files:**
- None, unless a check below fails.

- [ ] **Step 1: Run everything**

```bash
npm run native:node
npm test
npm run lint
npm run typecheck
npm run i18n:check
npm run format:check
npm run native:electron
npm run build
npm run test:sealed-electron -- --output-dir /tmp/loqui-sealed-accept
node scripts/smoke-electron.cjs --output-dir /tmp/loqui-smoke-open
npm run native:node
```

Expected:
- every command passes;
- `/tmp/loqui-sealed-accept/report.json` lists every `PASS` from Task 16;
- the regular smoke run still passes its existing checks.

Any pre-existing test that fails because a transport moved (`postMultipart` out of `ipcHandlers.js`, or `proxyFetch` now gated) is updated in this branch only where it asserted the old location. Note each one in the PR description.

- [ ] **Step 2: Manual verification in the desktop app**

Run `npm run dev` with a disposable profile: `LOQUI_PROFILE_DIR=$(mktemp -d)`. Never use your personal profile. Then check each of these, screenshotting each for the PR:
- **Privacy & Data shows Sealed mode first.** Off, it is a normal card. Toggling it on turns the panel navy and shows "Sealed and verified since …" within about two seconds.
- **Turning Sealed mode off.** A system dialog appears. "Keep sealed" leaves the switch on; "Turn off Sealed mode" turns it off.
- **Clear history.** A system dialog shows the record count; "Keep records" deletes nothing.
- **Chat with a cloud provider while sealed.** The reply bubble reads "Chat paused: Sealed mode is on. Your message is kept." The message is still there, and the recorder gains a hollow "Blocked" tick.
- **Seal during a long cloud chat reply.** The bubble reads "Chat stopped: Sealed mode was turned on mid-reply…", not "Chat paused".
- **Press the dictation hotkey with a cloud STT route while sealed.** Nothing records, and "Dictation paused: Sealed mode is on" appears.
- **Seal while a cloud-route dictation is already recording, then stop.** The copy says the provider may have received part of it (when the realtime stream was open), or nothing was sent (batch). With history on, the recording appears in History with Retry, and retrying after unsealing works.
- **The same, with local history off.** The toast says the recording is kept in memory only and offers "Transcribe". Nothing appears in History, and the profile directory gains no audio file (`find "$LOQUI_PROFILE_DIR" -newer <marker> -name "*.webm" -o -name "*.wav"` is empty). Unseal: a notice offers "Transcribe" again, and it transcribes. Reload the window instead: the recording is gone, as the copy said.
- **Browser links while sealed.** Click a link in a chat answer, and a meeting join link. A system dialog names only the host and defaults to "Don't open". "Don't open" opens nothing and shows no error.
- **Remote images while sealed.** A chat answer with a remote markdown image shows the "Image not loaded while Sealed mode is on" placeholder, and the flight recorder gains no unexplained row.
- **Calendar sign-in while sealed.** "Connect Google Calendar" is refused before a browser opens. Start the sign-in unsealed, then seal before finishing it in the browser: the flow ends as interrupted, and finishing in the browser afterwards reaches nothing.
- **Local sidecars through a seal.** With on-device models installed, start each workflow, seal in the middle of it, and confirm it finishes and the panel reaches verified: local Whisper dictation (whisper-server), Parakeet streaming dictation (WebSocket), llama-server cleanup, and a semantic note search (Qdrant). On macOS, also run `lsof -nP -iTCP -a -p <pid>` for each sidecar while sealed: every connection is to `127.0.0.1` or `::1`. Record the output in the PR.
- **A stubborn child.** Seal while a URL import (yt-dlp) is downloading. The panel names yt-dlp until the process has exited, and only then says verified.
- **Codex.** Sign in to ChatGPT, then seal. The Codex process exits, and the panel becomes verified only after it is gone. The recorder shows one "Session — its traffic is not visible to Loqui" row for that run.
- **Dictate with a local model while sealed.** It works, and nothing is added to the recorder.
- **Start a model download, then seal.** The download stops, the partial file is kept for resume, and the recorder shows "Stopped".
- **Settings › System › Updates while sealed.** It shows "Paused while Sealed mode is on." and "Check now" is disabled.
- **Unseal.** Calendars resume syncing (if connected). The recorder lists the next cloud request with its host and bytes.
- **Export CSV.** Open the file. It has the header row, no URLs and no message text.
- **Theme and direction.** Switch to Plum Night and to an RTL locale (`ar`). The panel remains readable and the hosts render left-to-right.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(privacy): issues found in whole-plan verification"
```

Get the owner's explicit OK before pushing or opening a PR. Publishing a PR is outward-facing, and Task 18 must complete first.

---

### Task 18: Dedicated security review before merge

The owner requires a dedicated review of Sealed mode before merge (D6). This task is a separate pass by a reviewer who did not write the code. Its output is a findings document, plus the owner's sign-off.

**Files:**
- Create: `docs/security/sealed-mode-review-2026-10.md`

- [ ] **Step 1: Dispatch the reviewer**

Run the review in a fresh context on the most capable model available (Opus), for example with the `security-review` skill or a `feature-dev:code-reviewer` subagent. Give it:
- this plan;
- `docs/security/sealed-mode-threat-model.md`;
- `git diff main...HEAD`;
- the brief below, verbatim.

```text
Review Loqui's Sealed mode for ways data can still leave the computer while sealed, and for ways the UI can claim more than main attests. Work adversarially; assume every path not proven blocked is open. For each item, answer with evidence (file:line, a test you ran, or a command and its output):

1. Inventory completeness. Grep main.js, preload.js, src/helpers, src/workers, src/services, src/components, src/hooks and src/stores (.js, .ts, .tsx, .jsx, .mjs, .cjs) for every transport: fetch, net.fetch/net.request, http(s).request/get and aliases such as `mod.request`, http2, tls.connect, net.connect, dgram, dns, WebSocket/ws, EventSource, child_process spawn/exec/execFile/fork, utilityProcess.fork, worker_threads, session.fetch, webContents.downloadURL, BrowserWindow.loadURL with remote URLs, shell.openExternal. Every hit is in the threat model's `egress-sites` or `spawn-sites` block with a decision, and the ratchet tests fail when one is removed.
2. Layer B coverage. Confirm in a packaged build (or `npm run dev`) that: undici fetch, https.request, ws, AWS SDK and Tinfoil SDK connections all pass through net.Socket.prototype.connect; electron-updater's partition session is watched (session-created fires for it); renderer image loads in rendered markdown are cancelled while sealed; nothing else calls webRequest.onBeforeRequest.
3. Bypass attempts. Hostnames that resolve to loopback, IPv6 forms, IPv4-mapped IPv6, decimal/octal IP spellings, trailing dots, uppercase, `localhost.` vs `localhost.example`, a custom `lookup` for `localhost`; proxies — the CONNECT/absolute-form refusal, `NODE_USE_ENV_PROXY`, a PAC/WPAD fetch by Chromium, and any library that tunnels through a loopback proxy without CONNECT (e.g. SOCKS).
4. Child processes. A child counts as stopped only when the OS reports its exit (and, for a process group, when the group is gone); a SIGKILL that is ignored keeps the seal unverified. Codex app-server is stopped on seal and never spawned while sealed; yt-dlp downloads and self-update are stopped and their sessions settle only on exit; the spawn guard refuses network-capable and third-party spawns while sealed; FFmpeg runs only with `-protocol_whitelist file,pipe` — try an adversarial playlist/concat/HLS file that references a remote URL; llama-server/whisper-server/parakeet/qdrant are started with loopback-only binds and no download flags (e.g. llama.cpp `-hf`, `--model-url`); the ONNX utility process has no network code.
5. Transition races. Toggle sealed rapidly; seal during: chat stream, realtime STT, model download, update download, URL import, Codex turn, calendar OAuth. Check attestation.nothingLeaves only becomes true after everything is stopped, and that no request authorised before the seal completes a new connection after it.
6. Fail-closed state. Corrupt/unreadable/unwritable privacy.json; isSealed throwing; boot order (guards installed before any helper require; before app ready).
7. IPC. Only the main frame of the main window or control panel, showing Loqui's own page, can set-sealed or clear/export the ledger; argument validation; main's native confirmation for unseal and clear; the control panel is now sandboxed with web security on (Task 7a) — confirm nothing regressed and no window still relaxes either.
8. Ledger privacy. No content, prompts, keys, URL paths/queries or error messages can reach egress_events or the CSV; CSV formula injection; retention and the local-history-off path never write to disk; Clear deletes rows.
9. Honest UI. The verified Sealed-mode line (dated from effectiveSince, dropped when older than 30 s), the "nothing was sent" copy (refusals only, never interruptions), the route "Paused" states, the flight recorder's observed-request and helper-session counts, and the cancel copy (Plan 04 CCR-3: `dispatched` = "may have received", `delivered` = "received", with correlation ids and target ids) can only appear from main's attestation and notices.
10. Chromium speculative networking (DNS prefetch/preconnect) while sealed, despite `x-dns-prefetch-control: off`: observe with a packet capture or `chrome://net-export` in a sealed dev session with chat answers containing links and images; recommend a switch if leaks are seen. Also confirm the WebRTC policy reaches every webContents (including the pill and notification windows).
11. Attestation honesty. Try to make the panel show "verified" while something can still send: a stalled response body, a warm realtime socket, a Codex start in progress, a yt-dlp update whose process ignores signals, an un-ticketed Chromium request that never finishes, a pending DNS lookup, an unread `guardResponse` body, an env proxy. Attestation must stay unverified, and nothing may clear evidence to make it pass.
12. Outside the boundary. Confirm each exception in the threat model is disabled or disclosed: browser and mail links ask first in a main-owned dialog that names only the host; pending calendar OAuth flows are cancelled on seal; remote markdown images are placeholders; loopback forwarders (a local proxy the user runs) are named as trusted.
13. Content preservation. A dictation refused or interrupted while sealed with history off is held in renderer memory only (check that no file is written), offered for "Transcribe", and dropped on quit; a refused cleanup after local speech-to-text keeps the local transcript.
14. Acceptance evidence. Read Task 16's report and netlog. Confirm the control run reached the fixture with every probe kind, and that the leak-injection check in Task 16, Step 5 failed as it should.

Report: a table of findings with severity (critical/high/medium/low), evidence, and a concrete fix. Mark each checklist item PASS/FAIL/NOT VERIFIED.
```

- [ ] **Step 2: Record the findings**

Write the reviewer's report to `docs/security/sealed-mode-review-2026-10.md`. Add the reviewer and model, the commit reviewed, and a sign-off block:

```markdown
## Sign-off

- [ ] All critical and high findings fixed and re-verified (link commits)
- [ ] Medium/low findings fixed or accepted by the owner with a reason
- [ ] Owner approval to merge: ____________ (name, date)
```

- [ ] **Step 3: Fix, then re-review**

Fix each critical and high finding in its owning task's files, with a test that pins it. Re-run the full Task 17 suite, including the Task 16 acceptance run, then send the reviewer the fix diff for a focused re-review. Repeat until no critical or high finding remains open.

- [ ] **Step 4: Commit and hand off**

```bash
git add docs/security/sealed-mode-review-2026-10.md
git commit -m "docs(security): record the Sealed mode pre-merge review"
```

Do not merge until the owner has filled in the sign-off.

---

## Open questions for the owner

**Answered and built in.**
- The owner answered three questions on 2026-10-15:
  - harden the control panel and confirm unsealing in main's own dialog (Tasks 7 and 7a);
  - record Codex and yt-dlp as opaque sessions (Tasks 4, 8 and 10);
  - ship the dictation pre-flight in Plan 07 (Task 13).
- The independent security review settled two more, so they are no longer open:
  - **Recordings blocked while history is off** are held in memory only, never on disk, with a "Transcribe" action (Task 13, I6).
  - **Browser and mail links while sealed** open only after a main-owned confirmation that names the host (Task 11). The OS browser is outside Loqui's boundary, and the dialog says so.

**Still open.** Codex's plan review recommends the defaults below for questions 1–3. Plan 07 already follows them.

1. **LAN servers while sealed.** This plan blocks `network` locality (a self-hosted server on another machine) as well as `remote`, because audio sent to it leaves this computer (CCR-1). Should LAN stay allowed instead?
2. **Downloads and updates "you start."** The showcase copy for R6 C said "Block all network except model downloads and updates you start." D6 says main blocks model downloads. This plan follows D6 and also refuses manual update checks while sealed, so "sealed" has one meaning. Confirm, or name the exceptions.
3. **Recorder retention.** The ledger follows `transcriptRetentionDays`; "Forever" is capped at 100,000 rows (checked on insert), and with local history off it is memory-only. The research proposed a fixed 30-day roll. Which do you want?
4. **Legacy network-capable IPC channels.** Ten channels have no UI caller, but any renderer can reach them through preload:
   - `process-anthropic-reasoning`, `process-enterprise-reasoning`, `enterprise-stream-start` and `bedrock-list-models`;
   - `test-provider-connection` and `test-enterprise-connection`;
   - `proxy-{xai,mistral,gemini,corti,tinfoil}-transcription`.

   This plan gates them and tests them through their real handlers (Task 12). Codex recommends removing the unused preload bridges and handlers together, in a follow-up. Should we?
5. **A quick toggle.** Should Sealed mode also be available from the tray menu or the pill? This plan ships it in Settings only.
