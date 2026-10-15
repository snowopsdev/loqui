# Loqui UI/UX Plan 07: Sealed Mode and Data Flight Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two things:
- **Sealed mode** (SET-R6 C), a master switch that Electron main enforces. While it is on, nothing Loqui does leaves this computer, and local routes keep working.
- **Data flight recorder** (SET-M3), a metadata-only ledger of every request that did leave: when, which task, which host, how many bytes, and the outcome.

**Architecture:** Enforcement lives in main and has two layers.

- **Layer A, the egress gate** (`src/helpers/privacy/egressGate.js`). Every known request site asks it for a *ticket* before sending. While sealed, a non-loopback ticket is refused with a typed `SealedModeError`. The refusal is recorded with 0 bytes sent, and the caller keeps the user's content. Tickets carry the task, so the ledger knows why each request happened.
- **Layer B, the transport backstop** (`src/helpers/privacy/egressBackstop.js`). It catches anything Layer A missed:
  - On the Node side it hooks `net.Socket.prototype.connect`, with `localhost` pinned to loopback. That covers `http`, `https`, undici `fetch`, `ws` and the provider SDKs.
  - It also hooks every DNS API, UDP, and loopback-proxy forwarding.
  - On the Chromium side it owns `webRequest` on every Electron session, which covers `net.fetch`, `net.request`, `electron-updater` and renderer loads, and it tracks Chromium requests still in flight. It also sets every `webContents` to a WebRTC policy with no UDP.
  - While sealed, Layer B denies every non-loopback connection. While unsealed, it reports connections that no ticket explains, which surface as "unexplained" in the ledger.

Child processes that make their own connections (the Codex app-server and yt-dlp) are handled separately:
- They are refused just before spawn, killed on seal, and waited on until they actually exit.
- Each run is one *opaque session* in the ledger, because main cannot see their individual requests (owner decision, 2026-10-15).

Sealing passes through a main-owned barrier. The phase is `"sealing"` until every remote ticket, socket, in-flight Chromium request and child has stopped. Only then is it `"sealed"`, with a verified `effectiveSince`. Main *attests* this with an `Attestation` object, and the UI shows its verified line only when `attestation.nothingLeaves === true`.

Turning Sealed mode off, and clearing the ledger, are confirmed in native dialogs owned by main, which a compromised renderer cannot answer. The control panel is sandboxed, with web security on (owner decision, 2026-10-15).

**Tech Stack:**
- Electron 44 main process (CommonJS) with Node 24 `node:async_hooks` (`AsyncLocalStorage`), `node:net`, `node:dns` and the Electron `session.webRequest` API.
- better-sqlite3 13 for the ledger table.
- React 19 and TypeScript for the settings panels.
- Node `node:test`, with `tsx` for TypeScript and `react-dom/server` via `test/helpers/harness/reactSsr.js`.

**Spec:** `docs/superpowers/specs/2026-10-15-loqui-uiux-overhaul.md`: decision D6, the Plan 07 row in §3, the global constraints in §4, and contracts §5.1, §5.2 and §5.4. Visual reference: `design-explorations/loqui-uiux-review.html#set-r6` (variant C) and `#set-m3`. Research: `.omc/research/ui-review/audit-settings.md` §R6, §M3, SET-08, SET-09, SET-21 and SET-25.

**Depends on:**
- Plan 01, merged. This plan uses `src/utils/contrast.ts`, `test/helpers/harness/cssTokens.js`, `src/lib/locality.ts` and the `--motion-*` tokens.
- Plan 03, merged. Task 13 uses `src/lib/routes.ts`, which provides `resolveRoute`, `useResolvedRoutes` and `RouteSettingsSnapshot`.
- Plan 04 is **not** required. CCR-3 and CCR-4 below are requests to it.

---

## Contract change requests

This plan owns §5.4 and must not edit the spec. The owner applies these to §5 of the spec in the PR that merges this plan.

**CCR-1 (§5.4, owner Plan 07; additive plus one clarification).**
- **Clarification.** While sealed, *both* `remote` and `network` locality routes are blocked. Only `device` (loopback) keeps working.
  - A LAN self-hosted server is another machine, so audio sent to it leaves this computer. The pill copy "Sealed · nothing leaves" would otherwise be false.
  - The resolver therefore reports every non-`device` route as `{ status: "unreachable", detail: "sealed" }`, not only `remote` ones.
- **Additions to `window.electronAPI.privacy`.** `getSealed()` and `onSealedChange(cb)` keep their §5.4 signatures, and `onSealedChange` returns an unsubscribe function. The new methods are:

  ```ts
  setSealed(sealed: boolean): Promise<Attestation & { declined?: boolean }>;  // resolves after the sealing barrier; an unseal is confirmed by main first
  getAttestation(): Promise<Attestation>;
  onAttestation(cb: (attestation: Attestation) => void): () => void;           // versioned pushes from main
  listEgress(options?: { since?: number; limit?: number }): Promise<EgressEvent[]>;
  egressSummary(options?: { since?: number }): Promise<EgressSummary>;
  clearEgress(): Promise<boolean>;                                             // false when the user declined main's confirmation
  exportEgressCsv(): Promise<{ saved: boolean }>;
  onEgress(cb: (notice: EgressNotice) => void): () => void;
  onEgressCleared(cb: () => void): () => void;
  ```

  The types are declared in `src/types/privacy.ts` (Task 7).
- **Semantics.**
  - `getSealed()` resolves `true` when the persisted setting is unreadable. Sealed mode fails closed.
  - `onSealedChange` fires only after main has applied the change and run the sealing barrier: in-flight remote work is aborted, open remote sockets are destroyed, and Codex and yt-dlp are stopped.
  - `Attestation` separates `sealedSince` (switch flipped) from `effectiveSince` (main verified that everything stopped). Any claim about past egress is dated from `effectiveSince`.

**CCR-2 (§5.1, owner Plan 03).**
- `RouteSettingsSnapshot` gains `sealed: boolean`, defaulting to `false`.
- `resolveRoute` applies `applySealToRoute(route, snapshot.sealed)` from `src/lib/sealedMode.ts` (Plan 07) as its last step.
- `useResolvedRoutes` / `useResolvedRoute` read `useSealedMode()` from `src/hooks/useSealedMode.ts` (Plan 07).
- `routes.ts` exports a non-React `routeSnapshotFromSettings(settings)`. The dictation pre-flight in `audioManager.js` (Plan 07, Task 13) is not a React component, and needs to resolve the `dictationStt` route.
- If Plan 03 merged without these, Plan 07 Task 13 adds them. Keep the module boundaries as stated so both plans agree.

**CCR-3 (§5.2, owner Plan 04).**
- **Pass a correlation id.** Plan 04 gives each recording an id, and passes it as `correlationId` on every request of that recording's pipeline:
  - the BYOK transcription request (or its existing `requestId`);
  - `dictation-realtime-start`/`-warmup` options;
  - the cleanup, agent, vision and translation `textGenerate`/`textStream` requests.
- **Derive `remoteAlreadySent` from main's evidence.** Set it to the provider display name only when `privacy.onEgress` delivered a `{ phase: "sent" }` notice with that `correlationId` and a payload of `"audio"`, `"text"` or `"image"`. Do not derive it from route locality, from authorisation, or from timing.
- **What "sent" means.** Main emits `sent` when the payload is handed to the transport, not when a request is authorised (Tasks 5, 8, 9 and 9a). Token and connection requests carry payload `"metadata"`, and must not count. A realtime session is marked sent at its first audio frame, which correctly covers audio streamed *before* the recording stopped, and prewarmed sockets.
- **Rationale.** The cancel copy "OpenAI already received the audio" is a claim about egress, so main must attest it (D6). This also keeps the cancel copy and the flight recorder in agreement: a request cancelled in flight is recorded by main with outcome `cancelled`.

**CCR-4 (§5.4 consumer, owner Plan 04).**
- **What Plan 07 ships.** Plan 07 ships the dictation pre-flight itself (owner decision 3, 2026-10-15). `audioManager.startRecording` refuses to start when `isDictationSealed(settings, sealed)` is true, and reports `sealedMode.blocked.dictationPreflight` through the existing error path (Task 13).
- **Plan 04 keeps the check.** When it restructures the recording lifecycle it must keep this check. It renders the refusal as a pill state, a blocked remote ring with "Dictation paused: Sealed mode is on", instead of a toast.
- **Rationale.** Main's block happens *after* recording. With local history off, a blocked recording cannot be kept, so preventing the recording is the content-preserving path.

---

## Global Constraints

- **Ownership.** Electron main owns SQLite, credentials, native runtimes, provider requests and updates. Renderers talk only through typed preload IPC (CLAUDE.md). Sealed mode is enforced in main; a renderer check is UX only and never the guarantee (D6).
- **No silent provider switches.** Local and remote choices stay explicit. Nothing silently switches provider or moves work from local to remote. Content is preserved on every failure, and a sealed block is a failure that keeps the user's message, recording or draft.
- **What sealed blocks.** Main blocks every outbound provider and model-download request while sealed, and local routes keep working. The UI never claims "0 bytes" unless main attests it (D6).
- **"Local" means loopback only.** That is `localhost`, `127.0.0.0/8`, `::1` and IPv4-mapped `127.x`. A LAN address, a public IP, an unparseable target or a hostname that merely *resolves* to loopback is **not** local (CCR-1; D4 makes loopback self-hosted URLs `device`).
- **The flight recorder stores metadata only:**
  - time, task id, bare hostname, bytes sent, bytes received, outcome, HTTP status, error class (an error `code` or `name`, never a message) and model id;
  - **never** content, prompts, keys, URLs with paths or query strings, or error messages.
- **Unknown byte counts are `null`, not `0`.** The UI renders them as "—". Only a blocked request records `bytesOut: 0`, because main refused it before any socket opened.
  - Bytes are request and response *bodies*, except realtime sessions, which count wire bytes on their own socket.
  - A bodyless request is `null`, not 0, because its headers still went out.
  - Opaque child sessions (Codex, yt-dlp) never carry byte counts.
- **"Nothing was sent" is only for refusals.** A request that sealing cut off mid-flight is reported as *interrupted*, meaning the provider may have received part of it, never as "nothing was sent".
- **Recorder retention follows the existing privacy settings:**
  - Rows older than `transcriptRetentionDays` are pruned when that value is above 0. When it is 0 ("forever"), the table is capped at `MAX_ROWS = 100000` rows, oldest first.
  - When `dataRetentionEnabled` is `false`, events are kept in memory only (the last 500) and nothing is written to disk.
  - Pruning runs in the existing six-hour retention sweep (`ipcHandlers.js` `_runRetentionCleanup`).
- **Tests.** Tests use Node `node:test` through `npm test` (`scripts/run-tests.js`). Run `npm run native:node` before tests and `npm run native:electron` before launching the desktop app. Never use personal profiles in tests.
- **No network in tests.** Tests never touch the network. Sealed denials happen before DNS. Unsealed tests use loopback servers or a `lookup` stub that fails offline.
- **DB tests.** A test that opens SQLite must live in `test/helpers/` and contain the literal `require("./harness/db")`. `scripts/run-tests.js` uses that string to run it without the tsx loader.
- **i18n.** Every visible string goes through i18n, with keys in all 11 locales (`ar de en es fr it ja pt ru zh-CN zh-TW`) under `src/locales/*/translation.json`. `npm run i18n:check` passes.
- **Contrast.** Text contrast is at least 4.5:1 and non-text UI at least 3:1, in light and Plum Night.
- **Motion and RTL.** Motion uses the shared `--motion-*` tokens. Reduced motion keeps opacity and colour feedback and drops transforms. Use logical properties (`ms-`, `me-`, `start`, `end`). Hostnames render `dir="ltr"`.
- **Docs.** `DESIGN.md` is the source of truth for UI (D10). `docs/PRIVACY.md` and `docs/network-allowlist.md` must be updated by any change that adds a destination or a content category (the allowlist doc says so).
- **Node.** Use `~/.nvm/versions/node/v24.21.0/bin` (`.nvmrc` 24.21.0).
- **Before a PR:** `npm run lint`, `npm run typecheck`, `npm test` and `npm run i18n:check`.

## Review Focus

Each of these five failure modes is the kind a reviewer should try by hand. Each is pinned by a named test in the owning task.

1. **Turning Sealed mode on while something is mid-flight:** a streaming chat reply, an open realtime STT socket, a model download, or an update download.
   - Expected: the transfer stops within a second, and the user's message, draft or partial download stays.
   - The ledger shows the request as `cancelled` with error class `SEALED_MODE`, and the copy says *interrupted*, not "nothing was sent".
   - The attestation reports `nothingLeaves: true` only after the sealing barrier has confirmed that everything stopped. A Codex process that ignores `SIGTERM` keeps it unverified until it exits.
   - Pinned in:
     - Task 5 (`abortAllRemote interrupts in-flight remote tickets; loopback keeps running`, `guardResponse: sealing after headers with a stalled body interrupts it`);
     - Task 6 (`severAll destroys open remote Node sockets and leaves loopback ones alone`);
     - Task 7 (`sealing stops everything, waits for children, then becomes effective`, `a child that will not exit keeps the seal unverified`);
     - Task 8 (`sealing mid-request rejects as 'interrupted'…`, `sealing during a pending start cancels it before anything is spawned`);
     - Task 9 (`an in-flight loopback transcription survives sealing`);
     - Task 9a (`sealing closes an open realtime session as interrupted`);
     - Task 10 (`sealing keeps the partial file; the next run resumes and counts only new bytes`, `sealing kills an in-flight yt-dlp self-update…`).
2. **A damaged or unwritable `privacy.json`.** A truncated file, a non-boolean `sealed`, or a read-only profile must never silently unseal.
   - An unreadable or corrupt file loads as sealed, with `loadError` set.
   - A failed save while sealing keeps the app sealed for this session and surfaces `saveError`, so the UI can warn that it will be off after restart.
   - Pinned in Task 3.
3. **Self-hosted endpoints spelled in unusual ways.** These stay allowed while sealed:
   - `http://localhost:11434/v1`, `http://LOCALHOST.:8080`, `http://[::1]:8080`, `http://127.0.0.2:9000` and `http://[::ffff:127.0.0.1]/`.

   These are blocked:
   - `http://192.168.1.5:8080`, `http://localhost.evil.example`, `http://127.0.0.1.nip.io` and `http://0.0.0.0:8080`;
   - an empty or garbage URL.

   A `localhost` connection whose own `lookup` claims a public address must still connect to loopback.

   Pinned in Task 2 (`loopback classification`) and Task 6 (`'localhost' is pinned to loopback even when a lookup says otherwise`, `sealed: a loopback proxy is not allowed to tunnel or forward to a remote host`).
4. **Hostile values reaching the ledger.** A model id with a comma, newline or leading `=` must not break or inject into the CSV export. A target containing userinfo, a path or a query must be stored as a bare host. Error messages from providers, which may echo content, are never stored. Pinned in Task 4 (`CSV export neutralises formulas and quotes`, `record rejects non-host values`) and Task 5 (`settle stores an error class, never a message`).
5. **Sealed at launch, with a calendar connected and an update check due.**
   - Expected: no non-loopback connection from boot. Calendar sync does not start, and the automatic update check is skipped without advancing `lastCheck`.
   - Turning sealed off starts calendar sync and lets the next hourly tick check for updates.
   - Pinned in:
     - Task 7 (`sealed at boot is effective from boot, with everything verified`, `unsealing restarts calendars and republishes update status`, `main boots the egress guards before any helper is required`);
     - Task 10 (`automatic check is skipped while sealed and lastCheck is unchanged`, `seal and unseal always publish status, even when idle`);
     - Task 11 (`main does not start calendar sync while sealed`);
     - Task 16, which runs the Electron smoke test sealed.

**Documented residual (not a defect to pin):** turning Sealed mode on *while* a cloud-route dictation is already recording. The pre-flight cannot help, because the recording started before the seal. When the recording stops, main refuses (or interrupts) its transcription. The audio is kept in History only if local history and audio retention are on; otherwise the copy says plainly that it was not kept. Holding such a recording in memory for a later retry needs Plan 04's notice actions; see Open question 4.

---

## File structure

**Create (main process, CommonJS):**
- `src/helpers/privacy/egressPolicy.js`: pure. Task ids, host classification, the allow/deny decision and `SealedModeError`.
- `src/helpers/privacy/sealedState.js`: the persisted switch in `<userData>/privacy.json`, which fails closed.
- `src/helpers/privacy/flightRecorder.js`: the ledger store (SQLite or memory), summary, prune and CSV.
- `src/helpers/privacy/egressGate.js`: Layer A. Tickets, task context (`AsyncLocalStorage`), metering, abort-on-seal and counters.
- `src/helpers/privacy/egressBackstop.js`: Layer B. Node socket (with `localhost` pinning), DNS, UDP and proxy hooks; the Chromium session watcher with in-flight tracking; the WebRTC policy; sever-all and observers.
- `src/helpers/privacy/privacyBoot.js`: boot order, the sealing barrier (transition), the attestor and main's confirmation dialogs.
- `src/helpers/privacy/privacyIPC.js`: the `privacy:*` IPC channels and broadcasts.
- `src/helpers/privacy/trustedSender.js`: the main-frame, app-URL and known-window check for privacy-changing IPC.
- `src/helpers/privacy/providerEndpoints.js`: the destination of each named provider.
- `src/helpers/privacy/gatedFetch.js`: `gatedNetFetch` (Electron `net`) and `gatedNodeFetch` (Node `fetch`), both gated and metered.
- `src/helpers/sttTransport.js`: `buildMultipartBody` and `postMultipart` (moved out of `ipcHandlers.js` and gated), plus `realtimeEndpoint` and `connectRealtime`.

**Create (renderer, TypeScript):**
- `src/types/privacy.ts`: `PrivacyAPI`, `Attestation`, `EgressEvent`, `EgressSummary`, `EgressNotice` and `EgressTask`.
- `src/hooks/useSealedMode.ts`: the sealed flag and attestation as an external store.
- `src/lib/sealedMode.ts`: `applySealToRoute`, `isRouteSealed` and `isDictationSealed` (the pre-flight).
- `src/utils/sealedModeError.ts`: `isSealedModeError`, `sealedPhase` and `sealedDictationMessageKey`.
- `src/components/chat/chatErrorContent.ts`: the assistant bubble's failure text, including the sealed copy.
- `src/components/settings/SealedModePanel.tsx` and `src/components/settings/sealedModeCopy.ts`: the master switch, and the only place that decides what the panel may claim.
- `src/components/settings/FlightRecorderPanel.tsx` and `src/components/settings/flightRecorderView.ts`: the ledger view and its pure view model.

**Create (docs):** `docs/security/sealed-mode-threat-model.md` (Task 1) and `docs/security/sealed-mode-review-2026-10.md` (Task 17).

**Create (test helpers):** `test/helpers/harness/ipcHandlersHarness.js` (Task 12), which registers the real `ipcHandlers.js` channels against fakes.

**Modify:**
- Main process: `main.js`, `preload.js`, `src/helpers/windowConfig.js` (Task 7a), `src/helpers/codexAppServer.js`, `src/helpers/localDatabaseSchema.js`, `src/helpers/ipcHandlers.js`, `src/helpers/personalInference.js`, `src/helpers/providerConnectionTest.js` (rethrows sealed errors; gated at its IPC call site), `src/helpers/tinfoilCatalog.js`, `src/helpers/geminiTranscription.js`, `src/helpers/cortiAuth.js`, `src/helpers/cortiTranscription.js`, `src/helpers/tinfoilTranscription.js`, `src/helpers/downloadUtils.js`, `src/helpers/gpuBinaryManager.js`, `src/helpers/urlAudioDownloader.js`, `src/helpers/updateManager.js`, `src/helpers/updateIPC.js`, `src/helpers/googleCalendarOAuth.js`, `src/helpers/googleCalendarManager.js`, `src/helpers/microsoftCalendarOAuth.js` and `src/helpers/microsoftCalendarManager.js`.
- Renderer: `src/index.html` (Task 7a), `src/types/electron.ts`, `src/types/updates.ts`, `src/lib/routes.ts` (CCR-2), `src/components/SettingsPage.tsx`, `src/components/settings/UpdateSettings.tsx`, `src/components/chat/useChatStreaming.ts`, `src/utils/localInferenceError.ts`, `src/utils/recordingErrors.ts`, `src/helpers/audioManager.js` (renderer code) and `src/index.css`.
- Locales and docs: `src/locales/*/translation.json`, `DESIGN.md`, `docs/PRIVACY.md` and `docs/network-allowlist.md`.
- Scripts: `scripts/smoke-electron.cjs`.

---

### Task 1: Threat model, network inventory and the egress-site ratchet

This task comes first so every later task argues from one decided inventory. It decides, per outbound path, what Sealed mode blocks, which layer enforces it, and which task the ledger attributes it to.

**Files:**
- Create: `docs/security/sealed-mode-threat-model.md`
- Modify: `docs/network-allowlist.md`. Add a "Sealed mode" column, and a sentence that the inventory is now checked by a test.
- Test: `test/helpers/egressInventory.test.js`

**Interfaces:**
- Produces:
  - The inventory table, with path ids `N1`–`N23`. Tasks 8–12 cite these ids, and the Task 12 matrix must cover every `blocked` row.
  - A fenced ```` ```egress-sites ```` block listing every source file that can open an outbound connection. The ratchet test compares it with a grep of the code.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/egressInventory.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.join(__dirname, "../..");
const DOC = "docs/security/sealed-mode-threat-model.md";
// Any of these in a main-process file means it can open an outbound connection.
const NETWORK_PRIMITIVE =
  /\bfetch\s*\(|\bnet\.request\s*\(|\bhttps?\.(?:request|get)\s*\(|new\s+WebSocket\s*\(|require\(["']ws["']\)|tinfoilSecureFetch\s*\(|checkForUpdates\s*\(/;
const SCAN_ROOTS = ["main.js", "src/helpers", "src/services", "src/lib", "src/utils", "src/config", "src/workers"];
// The privacy modules implement the guards themselves.
const EXEMPT = new Set([
  "src/helpers/privacy/egressGate.js",
  "src/helpers/privacy/egressBackstop.js",
]);

function walk(entry, out = []) {
  const full = path.join(repoRoot, entry);
  if (!fs.existsSync(full)) return out;
  if (fs.statSync(full).isFile()) {
    if (/\.(c?js|ts)$/.test(entry)) out.push(entry);
    return out;
  }
  for (const child of fs.readdirSync(full)) walk(path.posix.join(entry, child), out);
  return out;
}

function documentedSites() {
  const doc = fs.readFileSync(path.join(repoRoot, DOC), "utf8");
  const block = doc.match(/```egress-sites\n([\s\S]*?)```/);
  assert.ok(block, `${DOC} has an egress-sites block`);
  return new Set(block[1].split("\n").map((l) => l.trim()).filter(Boolean));
}

test("every file with a network primitive is in the sealed-mode inventory", () => {
  const listed = documentedSites();
  const found = SCAN_ROOTS.flatMap((root) => walk(root))
    .filter((file) => !EXEMPT.has(file))
    .filter((file) => NETWORK_PRIMITIVE.test(fs.readFileSync(path.join(repoRoot, file), "utf8")));
  const missing = found.filter((file) => !listed.has(file));
  assert.deepEqual(missing, [], "add these to the egress-sites block and decide their sealed policy");
});

test("every inventoried file still exists", () => {
  for (const file of documentedSites()) assert.ok(fs.existsSync(path.join(repoRoot, file)), file);
});

test("every inventory row states a sealed decision and an enforcement layer", () => {
  const doc = fs.readFileSync(path.join(repoRoot, DOC), "utf8");
  const rows = doc.split("\n").filter((l) => /^\| N\d+ \|/.test(l));
  assert.ok(rows.length >= 23, "N1–N23 present");
  for (const row of rows) {
    assert.match(row, /\| (blocked|allowed: loopback|allowed: OS browser|n\/a: no network) \|/, row);
    assert.match(row, /\| (A\+B|B|spawn|A\+spawn|n\/a) \|/, row);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/helpers/egressInventory.test.js`
Expected: FAIL with `ENOENT … sealed-mode-threat-model.md`.

- [ ] **Step 3: Write the threat model**

Create `docs/security/sealed-mode-threat-model.md` with exactly this content. Line numbers were verified against `8267276`; re-verify them with `grep -n` before committing.

````markdown
# Sealed mode: threat model and network inventory

Owner: Plan 07 (`docs/superpowers/plans/2026-10-15-loqui-uiux-07-sealed-mode.md`). Update this file in the same PR as any change that adds an outbound path; `test/helpers/egressInventory.test.js` fails until you do.

## Promise

While Sealed mode is on, no byte that Loqui's processes send leaves this computer, except to loopback (`localhost`, `127.0.0.0/8`, `::1`). Local routes keep working. The promise is enforced in Electron main; the renderer only reflects it.

## Assets

User content: audio, transcripts, notes, chat messages, screenshots and dictionary words. Metadata that reveals activity: which providers are used, and when. Credentials (API keys and OAuth tokens).

## Adversaries and failure modes in scope

1. **A forgotten code path.** A feature, new or old, sends a request without asking the gate. Mitigation: Layer B denies at the socket and session level regardless, and the egress-sites ratchet forces an inventory decision.
2. **A library that connects on its own.** Examples are SDK telemetry, Tinfoil attestation and AWS credential discovery. Mitigation: Layer B; the request shows in the ledger as `unattributed`.
3. **In-flight work when the switch flips.** Mitigations:
   - `abortAllRemote()` interrupts every remote ticket, including response bodies still being read.
   - `severAll()` destroys open remote Node sockets but leaves loopback ones alone.
   - The update download is cancelled, and Codex and yt-dlp are stopped and awaited.
   - The sealing barrier waits until nothing remote is left. Only un-ticketed Chromium requests still in flight after the grace period trigger the last resort, `session.closeAllConnections()`, which is reported as `chromiumReset`.
4. **A child process with its own network stack** (the Codex app-server and yt-dlp). Main's hooks cannot see these. Mitigations:
   - Re-check just before spawn, and cancel a start that sealing overtook.
   - Kill on seal, and wait for the actual exit, escalating to `SIGKILL`.
   - Report them as `networkChildren` until they are gone, so `nothingLeaves` stays false.
   - Record each run as one opaque ledger session.
5. **A compromised or buggy renderer flips the switch off or wipes the ledger.** Mitigations:
   - `privacy:set-sealed` accepts only a boolean, and only from the *main frame* of the main window or control panel, while that frame shows Loqui's own page (`trustedSender.js`).
   - Unsealing and clearing the ledger are confirmed in native dialogs owned by main, which a renderer cannot click.
   - The control panel is sandboxed, with web security on (Task 7a).

   Residual: a user tricked into pressing "Turn off Sealed mode" in that dialog.
6. **A corrupt or unwritable settings file.** Mitigation: an unreadable file means sealed (fail closed), and a failed save is surfaced as `saveError`.
7. **A utility process or worker** (`utilityProcess.fork`, `worker_threads`). Each has its own Node runtime, so the main-process hooks do not apply inside it. Mitigation: `src/workers` is in the ratchet's scan roots, so a network primitive added there fails the test until it is inventoried. Today the only one is the ONNX worker (N23), and it has no network code.
8. **The ledger leaking content.** Mitigation: the schema has no content column, `record()` rejects anything that is not a bare hostname, and error *messages* are never stored, only codes and classes.

9. **A local proxy that forwards off-machine.** A loopback socket is not proof that nothing leaves. Mitigations:
   - While sealed, a loopback `CONNECT` tunnel or absolute-form request naming a remote host is refused.
   - Undici `ProxyAgent`/`EnvHttpProxyAgent`/`setGlobalDispatcher` are banned by a ratchet test.
   - Node's environment proxy (`NODE_USE_ENV_PROXY`, `--use-env-proxy`) makes the attestation unverified.
   - Chromium decides on the original URL, so a system proxy is never contacted for a refused request.
10. **Traffic that is not TCP.** DNS resolver queries (`dns.resolve*`, `Resolver`, `lookupService`) and UDP (`dgram`) are refused while sealed. Renderer WebRTC gets the `disable_non_proxied_udp` policy on every `webContents`, and no app code creates peer connections (ratchet). Renderer documents turn off DNS prefetching (`x-dns-prefetch-control`).

## Out of scope (documented residual risk)

- **The OS browser.** `shell.openExternal` (`externalUrlOpener.js:35`) opens links in the user's browser. Navigation there is the browser's egress, not Loqui's, so it is allowed while sealed.
- **OS services.** These are DNS-over-HTTPS settings, iCloud calendar sync for Apple Calendar (EventKit is local to Loqui), and OS update checks.
- **Chromium speculative networking beyond the document opt-out.** Preconnects that Chromium might make outside `x-dns-prefetch-control` are not visible to `webRequest`. Task 17 measures this with a packet capture or `chrome://net-export`.
- **A malicious local process** that reads the Loqui profile.

## Enforcement layers

| Layer | Where | Sees | Action while sealed |
|---|---|---|---|
| A, gate | `src/helpers/privacy/egressGate.js`, called at each site below | every known request, with its task | throws `SealedModeError` before any socket opens and records `blocked`, 0 bytes |
| B, Node | `net.Socket.prototype.connect` (with `localhost` pinned to loopback), every `dns` API, `dgram` send/connect, and `http`/`https` request/get (loopback-proxy forwarding) in `egressBackstop.js` | every Node TCP/TLS connection (`http`, `https`, undici `fetch`, `ws`, AWS SDK, Tinfoil SDK), DNS queries, UDP | refuses with `SealedModeError` before DNS; a loopback CONNECT/absolute-form request to a remote host is destroyed before anything is written |
| B, Chromium | `session.webRequest` on every session (`app.on("session-created")` plus `defaultSession`), with in-flight tracking; `setWebRTCIPHandlingPolicy("disable_non_proxied_udp")` on every `webContents`; `x-dns-prefetch-control: off` in `src/index.html` | Electron `net.fetch`/`net.request`, `electron-updater` (own partition), renderer loads, WebRTC | `callback({ cancel: true })`; no WebRTC UDP path |
| spawn | `codexAppServer` (`beforeSpawn`, `stopAndWait`) and `urlAudioDownloader` (`ytDlpControl`) | child processes with their own network | not spawned; running ones are killed on seal and awaited until they exit; each run is one opaque ledger session |

## Inventory

`A+B` means the site is gated, and the backstop also covers it. `B` means only the backstop covers it, because the site is loopback-only or not a request site. Tasks are the ledger `task` ids (`src/helpers/privacy/egressPolicy.js`).

| Id | Path | Code (verified) | Transport | Sealed | Layer | Ledger task |
|---|---|---|---|---|---|---|
| N1 | Provider text inference (cleanup, agent, vision, notes, translation, chat, provider web search) | `personalInference.js:347 execute`, `:173 createModel` | Node fetch (AI SDK) | blocked | A+B | from `inferenceScope` (`SCOPE_TO_TASK`) |
| N2 | Enterprise inference and legacy enterprise handlers | `personalInference.js:174-180`; `ipcHandlers.js:3953, 4025, 4154, 4239` | AWS SDK / Node fetch | blocked | A+B | from scope, or `providerCheck` |
| N3 | Model discovery (custom/LAN/OpenRouter) | `personalInference.js:286` | Node fetch | blocked | A+B | `providerCheck` |
| N4 | Provider connection test | `providerConnectionTest.js:282`, IPC `ipcHandlers.js:1081` | Node fetch | blocked | A+B | `providerCheck` |
| N5 | Batch STT (BYOK and self-hosted) | `ipcHandlers.js:7963` → `postMultipart` (`:229`, moved to `sttTransport.js`) | Electron net | blocked | A+B | `dictationStt` (captured audio) or `uploadStt` (file) |
| N6 | Batch STT via Gemini, Corti, Tinfoil | `geminiTranscription.js:29`, `cortiAuth.js:23`, `cortiTranscription.js:7`, `tinfoilTranscription.js` | Electron net / Tinfoil SDK | blocked | A+B | inherited task context |
| N7 | Retry transcription | `ipcHandlers.js:5083` (`proxyFetch` `:5075`) | Electron net | blocked | A+B | `dictationStt` |
| N8 | Legacy proxies (xAI, Mistral STT; Anthropic reasoning) | `ipcHandlers.js:3715, 3752, 4440` | Electron net | blocked | A+B | `dictationStt` / `dictationCleanup` |
| N9 | Realtime STT sockets | `ipcHandlers.js:7024, 7051, 8445, 8485, 8615, 8669, 8819, 8959, 8981`; meeting paths `:5846, 6022` | `ws` | blocked | A+B | `dictationStt` / `noteRecordingStt` |
| N10 | Realtime token fetch | `realtimeTokenProviders.js:14-28`, wired `ipcHandlers.js:5938` | Electron net | blocked | A+B | inherited |
| N11 | Tinfoil model catalog | `tinfoilCatalog.js:41` | Tinfoil SDK | blocked | A+B | `providerCheck` |
| N12 | Model downloads (Whisper, Parakeet, diarization, GGUF, MiniLM) | `downloadUtils.js:267 downloadFile`, `:250 fetchJson` | Electron net | blocked | A+B | `modelDownload` |
| N13 | Runtime/GPU binary downloads | `gpuBinaryManager.js:109, 184` (via `downloadUtils`) | Electron net | blocked | A+B | `runtimeDownload` |
| N14 | URL import (direct, proxy, YouTube) | `urlAudioDownloader.js:1525 download` | Node https / Electron net / yt-dlp child | blocked | A+spawn | `urlImport` |
| N15 | yt-dlp self-update | `urlAudioDownloader.js:390 maybeUpdateYtDlp` | child process | blocked | spawn | `runtimeDownload` (opaque session; skipped while sealed, killed on seal) |
| N16 | App update check and download (auto and manual) | `updateManager.js:124 check`, `:143`, `:156` | electron-updater (own session) | blocked | A+B | `appUpdate` |
| N17 | Codex CLI verification | `codexCli.js:309 verifyOfficialCodex` | Node fetch | blocked | A+B | `codex` |
| N18 | Codex app-server (ChatGPT) | `codexAppServer.js:116 start`, `:181 spawn`, `:396 generate` | child process | blocked | A+spawn | `codex` (one opaque session per process) |
| N19 | Calendar OAuth and API (Google, Microsoft) | `googleCalendarOAuth.js:152`, `googleCalendarManager.js:357`, `microsoftCalendarOAuth.js:155, 168`, `microsoftCalendarManager.js:396` | Electron net | blocked | A+B | `calendar` |
| N20 | Calendar background, focus and wake sync | `calendarSyncInterval.js`; `main.js:566-567, 781-794` | Electron net | blocked | A+B | `calendar` (stopped while sealed) |
| N21 | Browser launch | `externalUrlOpener.js:69` (`shell.openExternal` in `openExternalUrl`, `:35`) | OS browser | allowed: OS browser | n/a | none |
| N22 | Loopback sidecars and the dev server (llama-server, whisper-server, Qdrant, Parakeet WS, OAuth loopback page, CLI bridge, Vite) | `llamaServer.js`, `whisperServer.js`, `qdrantManager.js`, `parakeetWsServer.js`, `oauthLoopbackFlow.js`, `cliBridge.js`, `devServerManager.js` | Node http / ws on 127.0.0.1 | allowed: loopback | B | none (loopback is never recorded) |
| N23 | ONNX utility process (local embeddings/diarization) | `onnxWorkerClient.js:59` `utilityProcess.fork` → `src/workers/onnxWorker.js` (fs, os, path, onnxruntime-node only) | none | n/a: no network | n/a | none |

No UI caller, but **reachable from any renderer through preload**, so gated and tested like live paths: `process-anthropic-reasoning`, `process-enterprise-reasoning`, `enterprise-stream-start`, `bedrock-list-models`, `test-provider-connection`, `test-enterprise-connection`, and the `proxy-{xai,mistral,gemini,corti,tinfoil}-transcription` channels. Dead code with no caller: `whisper.js:482 transcribeViaLan` and `whisperServer.js:454 connectRemote`. Layer B still covers both.

## Files that can open a connection

`test/helpers/egressInventory.test.js` greps for network primitives and requires each hit to be listed here.

```egress-sites
src/helpers/assemblyAiStreaming.js
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
```
````

`src/helpers/sttTransport.js` does not exist yet, so it is not in the block. Task 9 creates it and adds it to the block in the same commit; the ratchet fails until it does.

- [ ] **Step 4: Add the sealed column to the public inventory**

In `docs/network-allowlist.md`, append a column `Sealed mode` to the table, with `Blocked` in every row. Then add this paragraph after the table:

```markdown
**Sealed mode** (Settings › Privacy & Data) blocks every group above in the main process: provider requests, model and runtime downloads, update checks, Codex, calendars and URL import. Only loopback (`localhost`, `127.0.0.0/8`, `::1`) stays reachable, so on-device models keep working. Links you open in your browser are not Loqui's traffic. The per-path decisions, and the test that keeps this list complete, are in [`docs/security/sealed-mode-threat-model.md`](security/sealed-mode-threat-model.md).
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- test/helpers/egressInventory.test.js`
Expected: PASS (3 tests). If the first test lists a file, read it, decide its sealed policy, then add it to both the table and the block.

- [ ] **Step 6: Commit**

```bash
git add docs/security/sealed-mode-threat-model.md docs/network-allowlist.md test/helpers/egressInventory.test.js
git commit -m "docs(privacy): add Sealed mode threat model and egress inventory ratchet"
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
  - `summary({ since?: number }): { left, observed, blocked, unattributed, unattributedHosts, bytesOut, bytesIn, unknownBytes, opaqueSessions }`. `left` is observed requests plus opaque sessions; `observed` excludes opaque sessions.
  - `clear(): void`. Emits `"cleared"`.
  - `prune({ retentionDays: number, maxRows?: number }): { deleted: number }`.
  - `persistError: string | null`.
- Also produces `toCsv(events: EgressEvent[]): string`, `MAX_ROWS = 100000`, `MEMORY_LIMIT = 500` and `CAP_CHECK_EVERY = 500`. The row cap is enforced on insert, every `CAP_CHECK_EVERY` writes, so the table never exceeds `MAX_ROWS + CAP_CHECK_EVERY` rows between sweeps.
- Types:
  - `EgressEventInput` is `{ ts?, endedAt?, task, host, hosts?, bytesOut?, bytesIn?, outcome: "ok"|"error"|"blocked"|"cancelled", status?, errorClass?, model?, attributed?, opaque? }`.
  - `EgressEvent` is the same, plus `id`. Every optional field is normalised to a value or `null`; `hosts` is a `string[]`, and `attributed` and `opaque` are booleans.
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
    "error_class", "model", "attributed", "opaque",
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

test("model ids and error classes are stripped of control characters and truncated", () => {
  const recorder = new FlightRecorder();
  const row = recorder.record({ ...base, model: "gpt\n-4o\u0000" + "x".repeat(200), errorClass: "E".repeat(100) });
  assert.equal(row.model.includes("\n"), false);
  assert.equal(row.model.length, 120);
  assert.equal(row.errorClass.length, 64);
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

test("summary separates observed requests from opaque sessions", () => {
  const recorder = new FlightRecorder();
  recorder.record(base);
  recorder.record({ ...base, bytesOut: null });
  recorder.record({ ...base, outcome: "blocked", bytesOut: 0, bytesIn: 0 });
  recorder.record({ task: "unattributed", host: "x.example.com", outcome: "ok", attributed: false });
  recorder.record({ task: "codex", host: "chatgpt.com", outcome: "ok", opaque: true });
  assert.deepEqual(recorder.summary({ since: 0 }), {
    left: 4, observed: 3, blocked: 1, unattributed: 1, unattributedHosts: ["x.example.com"],
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
  assert.equal(header, "started_utc,ended_utc,task,hosts,bytes_sent,bytes_received,outcome,status,error_class,model,attributed,opaque_session");
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
  opaque INTEGER NOT NULL DEFAULT 0
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
// A bare hostname, IPv4 or IPv6 literal, or the literal "unknown". Anything
// with a path, query, userinfo or whitespace is refused, so a URL can never be
// stored by mistake.
const BARE_HOST = /^[a-z0-9._:-]{1,253}$/;

const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
const text = (v, max) => {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return s ? s.slice(0, max) : null;
};
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
      `INSERT INTO egress_events (ts, ended_at, task, host, hosts, bytes_out, bytes_in, outcome, status, error_class, model, attributed, opaque)
       VALUES (@ts, @ended_at, @task, @host, @hosts, @bytes_out, @bytes_in, @outcome, @status, @error_class, @model, @attributed, @opaque)`
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
    const opaque = event.opaque === true;
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
      error_class: text(event.errorClass, 64),
      model: text(event.model, 120),
      attributed: event.attributed === false ? 0 : 1,
      opaque: opaque ? 1 : 0,
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
    const left = rows.filter((r) => r.outcome !== "blocked");
    const observed = left.filter((r) => !r.opaque);
    const unexplained = rows.filter((r) => !r.attributed);
    const sum = (key) => observed.reduce((n, r) => n + (r[key] ?? 0), 0);
    return {
      left: left.length,
      observed: observed.length,
      blocked: rows.length - left.length,
      unattributed: unexplained.length,
      unattributedHosts: [...new Set(unexplained.map((r) => r.host))],
      bytesOut: sum("bytesOut"),
      bytesIn: sum("bytesIn"),
      unknownBytes: observed.filter((r) => r.bytesOut == null).length,
      opaqueSessions: left.length - observed.length,
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

const CSV_HEADER = ["started_utc", "ended_utc", "task", "hosts", "bytes_sent", "bytes_received", "outcome", "status", "error_class", "model", "attributed", "opaque_session"];

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
    [iso(e.ts), iso(e.endedAt), e.task, e.hosts.join(" "), e.bytesOut, e.bytesIn, e.outcome, e.status, e.errorClass, e.model, e.attributed ? "yes" : "no", e.opaque ? "yes" : "no"]
      .map(csvCell)
      .join(",")
  );
  return [CSV_HEADER.join(","), ...lines].join("\n") + "\n";
}

module.exports = { FlightRecorder, toCsv, MAX_ROWS, MEMORY_LIMIT, CAP_CHECK_EVERY };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- test/helpers/flightRecorder.test.js`
Expected: PASS (14 tests). Also run the existing DB suites, which share the schema string, to confirm nothing regressed:

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

test("guard records start and end times, body bytes, status and the host trail", async (t) => {
  const { recorder, tick } = setup(t);
  await gate.guard({ task: "chat", target: "https://api.groq.com/x", model: "m" }, async (ticket) => {
    tick(250);
    ticket.addHost("edge.groq.com");
    const res = await gate.meteredFetch(ticket, async () => new Response("hello world", { status: 200 }))(
      "https://api.groq.com/x", { method: "POST", body: "12345" }
    );
    await res.text();
  });
  const [row] = recorder.list();
  assert.deepEqual(
    [row.ts, row.endedAt, row.outcome, row.bytesOut, row.bytesIn, row.status, row.hosts],
    [1000, 1250, "ok", 5, 11, 200, ["api.groq.com", "edge.groq.com"]]
  );
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

test("a body not fully read inside guard() is recorded as unknown", async (t) => {
  const { recorder } = setup(t);
  await gate.guard({ task: "providerCheck", target: "https://api.groq.com" }, (ticket) =>
    gate.meteredFetch(ticket, async () => new Response("a long body", { status: 200 }))("https://api.groq.com/models")
  );
  assert.equal(recorder.list()[0].bytesIn, null);
});

test("dispatched, then delivered; a connect failure is undelivered, never delivered", async (t) => {
  setup(t);
  const seen = notices();
  const ticket = gate.authorize({ task: "dictationStt", target: "https://api.openai.com", provider: "openai", payload: "audio", correlationId: "rec-1" });
  assert.deepEqual(seen, [], "authorisation alone is not dispatch");
  await gate.meteredFetch(ticket, async () => new Response("{}"))("https://api.openai.com/v1/audio", { method: "POST", body: "abc" });
  assert.deepEqual(seen.map((n) => [n.phase, n.targetId, n.payload, n.correlationId]), [
    ["dispatched", "openai", "audio", "rec-1"],
    ["delivered", "openai", "audio", "rec-1"],
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
  assert.equal(seenHeaders[1].get(gate.EGRESS_TAG_HEADER), ticket.tag);
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
  assert.deepEqual([recorder.list()[0].outcome, recorder.list()[0].errorClass], ["error", "ECONNRESET"]);
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
  assert.deepEqual([row.outcome, row.errorClass, row.status], ["error", "PROVIDER_REJECTED", 400]);
  assert.equal(JSON.stringify(row).includes("secret"), false);
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
const { EGRESS_TASKS, decideEgress, SealedModeError, isSealedModeError } = require("./egressPolicy");

// Layer A of Sealed mode (docs/security/sealed-mode-threat-model.md). Every
// known request site asks for a ticket before sending. The ticket carries the
// task for the flight recorder and an AbortSignal that sealing trips.
const EGRESS_TAG_HEADER = "x-loqui-egress";
const USER_ENDPOINT_PROVIDERS = new Set(["custom", "lan", "local"]);
const CONNECT_PHASE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);
const CONNECT_PHASE_CHROMIUM = /ERR_(NAME_NOT_RESOLVED|CONNECTION_REFUSED|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED|NAME_RESOLUTION_FAILED)/;

const ticketContext = new AsyncLocalStorage();
const taskContext = new AsyncLocalStorage();
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

function errorClassOf(error) {
  if (isSealedModeError(error)) return "SEALED_MODE";
  const raw =
    typeof error?.code === "string" ? error.code : typeof error?.name === "string" ? error.name : "Error";
  return raw.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64) || "Error";
}

function isConnectPhaseError(error) {
  for (let e = error, depth = 0; e && depth < 4; e = e.cause, depth++) {
    if (CONNECT_PHASE_CODES.has(e.code)) return true;
    if (typeof e.message === "string" && CONNECT_PHASE_CHROMIUM.test(e.message)) return true;
  }
  return false;
}

function refuse({ task, host, model = null, attributed = true }) {
  tally.blockedSinceSealed++;
  const ts = config.now();
  record({ ts, endedAt: ts, task, host, bytesOut: 0, bytesIn: 0, outcome: "blocked", errorClass: "SEALED_MODE", model, attributed });
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

function createTicket({ task, host, loopback, model, meter, payload, correlationId, provider }) {
  const controller = new AbortController();
  const out = meterAccumulator();
  const inbound = meterAccumulator();
  const sockets = new Set();
  let lastStatus = null;
  let openBodies = 0;
  const announced = new Set();
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
    },
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
    markDispatched: () => announce("dispatched"),
    markDelivered: () => {
      announce("dispatched");
      announce("delivered");
    },
    markUndelivered: () => announce("undelivered"),
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
      ticket.discard();
      if (loopback) return;
      const sealedAbort = controller.signal.aborted && isSealedModeError(controller.signal.reason);
      record({
        ts: ticket.startedAt,
        endedAt: config.now(),
        task,
        host,
        hosts: ticket.hosts,
        bytesOut: bytesOut !== undefined ? bytesOut : valueOf(out),
        // A body still being read when the request settled was not fully
        // counted, so the received total is unknown rather than too small.
        bytesIn: bytesIn !== undefined ? bytesIn : openBodies > 0 ? null : valueOf(inbound),
        outcome,
        status: Number.isInteger(status) ? status : lastStatus,
        errorClass: sealedAbort ? "SEALED_MODE" : errorClass,
        model,
        opaque: meter === "opaque",
      });
      events.emit("settled", { ticketId: ticket.id });
    },
  };
  function announce(phase) {
    if (loopback || announced.has(phase)) return;
    announced.add(phase);
    events.emit(phase, {
      ticketId: ticket.id,
      task,
      targetId: ticket.targetId,
      host,
      payload,
      correlationId: ticket.correlationId,
      ts: config.now(),
    });
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

function tagHeaders(ticket, headers = {}) {
  return { ...headers, [EGRESS_TAG_HEADER]: ticket.tag };
}
const ticketByTag = (tag) => byTag.get(tag) ?? null;

// tag: true only for Electron net requests, whose session backstop strips the
// header before it leaves (Task 6). Node requests are attributed by context and
// must never carry it.
function meteredFetch(ticket, baseFetch = (...args) => globalThis.fetch(...args), { tag = false } = {}) {
  return async (input, init = {}) => {
    ticket.addBytes({ out: bodyLength(init?.body) });
    const signal = init?.signal ? AbortSignal.any([init.signal, ticket.signal]) : ticket.signal;
    const headers = tag ? tagHeaders(ticket, Object.fromEntries(new Headers(init?.headers ?? {}))) : init?.headers;
    ticket.markDispatched();
    let response;
    try {
      response = await baseFetch(input, { ...init, headers, signal });
    } catch (error) {
      if (isConnectPhaseError(error)) ticket.markUndelivered();
      throw error;
    }
    ticket.markDelivered();
    ticket.noteStatus(response.status);
    if (!response.body) {
      ticket.addBytes({ in: null });
      return response;
    }
    ticket.bodyOpened();
    const counter = new TransformStream({
      transform(chunk, controller) {
        ticket.addBytes({ in: chunk.byteLength });
        controller.enqueue(chunk);
      },
      flush() {
        ticket.bodyClosed();
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

function recordUnattributed({ host, outcome, status = null, bytesOut = null, bytesIn = null, ts, endedAt }) {
  const now = config.now();
  record({ ts: ts ?? now, endedAt: endedAt ?? now, task: "unattributed", host, outcome, status, bytesOut, bytesIn, attributed: false });
}

// Layer B found a connection Layer A did not refuse. With a ticket, the request
// was authorised before sealing; its own settle() records it as cancelled.
function recordBackstopBlock({ host, ticket = null }) {
  if (ticket) {
    tally.blockedSinceSealed++;
    const error = new SealedModeError({ task: ticket.task, host, phase: "interrupted" });
    ticket.abort(error);
    return error;
  }
  return refuse({ task: "unattributed", host, attributed: false });
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

test("chromium: an untagged remote request is unexplained, recorded at completion with its status", async () => {
  const s = fakeSession();
  backstop.watchSession(s);
  const ticket = gate.authorize({ task: "chat", target: "https://images.example.com" }); // same host, no tag
  const id = nextId;
  await before(s, "https://images.example.com/a.png");
  await sendHeaders(s, id, {});
  assert.equal(recorder.list().length, 0, "not recorded until it finishes");
  s.listeners.onCompleted({ id, statusCode: 404 });
  const [row] = recorder.list();
  assert.deepEqual([row.task, row.host, row.outcome, row.status, row.attributed], ["unattributed", "images.example.com", "error", 404, false]);
  ticket.discard();
});

test("chromium: remote requests are tracked in flight until they finish, or their webContents goes away", async () => {
  const s = fakeSession();
  backstop.watchSession(s);
  const listeners = {};
  backstop.installWebContentsGuard({ on: (event, fn) => { listeners[event] = fn; } });
  const contents = Object.assign(new (require("node:events").EventEmitter)(), { id: 42, setWebRTCIPHandlingPolicy() {} });
  listeners["web-contents-created"]({}, contents);
  const base = backstop.status().chromiumInFlightRemote;
  const a = nextId; await before(s, "https://images.example.com/a.png");
  const b = nextId; await before(s, "https://images.example.com/b.png");
  await before(s, "https://images.example.com/c.png", { webContentsId: 42 });
  await before(s, "http://127.0.0.1:8080/local");
  assert.equal(backstop.status().chromiumInFlightRemote, base + 3);
  s.listeners.onCompleted({ id: a, statusCode: 200 });
  s.listeners.onErrorOccurred({ id: b, error: "net::ERR_ABORTED" });
  contents.emit("destroyed");
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
  assert.deepEqual(hits(/webRequest\.(onBeforeRequest|onBeforeRedirect|onCompleted|onErrorOccurred|onBeforeSendHeaders|onHeadersReceived|onSendHeaders|onResponseStarted)\s*\(/), [
    "src/helpers/privacy/egressBackstop.js",
  ]);
  assert.deepEqual(hits(/\b(ProxyAgent|EnvHttpProxyAgent|setGlobalDispatcher|RTCPeerConnection|webkitRTCPeerConnection)\b/), []);
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
const RESOLVER_METHODS = [
  "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa", "resolveCname", "resolveMx",
  "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTxt", "reverse",
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
      if (ticket.meter === "socket") ticket.attachSocket(this);
    }
    const startedAt = Date.now();
    openRemoteSockets.add(this);
    this.once("close", (hadError) => {
      openRemoteSockets.delete(this);
      if (!ticket)
        gate.recordUnattributed({
          host,
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

function patchResolver(target, style) {
  for (const name of RESOLVER_METHODS) {
    const original = target[name];
    if (typeof original !== "function") continue;
    target[name] = function egressAwareResolve(...args) {
      if (!gate.isSealed()) return original.apply(this, args);
      // Every resolver query goes to a DNS server, which may be off-machine.
      if (style === "promise") return Promise.reject(block(args[0]));
      refuseDns(args[0], args[args.length - 1]);
      return undefined;
    };
  }
}

function installDnsHook() {
  const originalLookup = dns.lookup;
  dns.lookup = function egressAwareLookup(hostname, ...rest) {
    if (gate.isSealed() && !isLoopbackHost(hostname)) {
      refuseDns(hostname, rest[rest.length - 1]);
      return {};
    }
    // Count lookups in flight: the sealing barrier waits for queries issued
    // before the seal to answer (Task 7).
    const callback = rest[rest.length - 1];
    if (typeof callback !== "function") return originalLookup.call(this, hostname, ...rest);
    pendingDns++;
    let done = false;
    rest[rest.length - 1] = (...result) => {
      if (!done) {
        done = true;
        pendingDns--;
      }
      callback(...result);
    };
    return originalLookup.call(this, hostname, ...rest);
  };
  const originalPromiseLookup = dns.promises.lookup;
  dns.promises.lookup = function egressAwarePromiseLookup(hostname, ...rest) {
    if (gate.isSealed() && !isLoopbackHost(hostname)) return Promise.reject(block(hostname));
    pendingDns++;
    return originalPromiseLookup.call(this, hostname, ...rest).finally(() => {
      pendingDns--;
    });
  };
  const originalLookupService = dns.lookupService;
  dns.lookupService = function egressAwareLookupService(address, port, callback) {
    if (gate.isSealed() && !isLoopbackHost(address)) {
      refuseDns(address, callback);
      return undefined;
    }
    return originalLookupService.call(this, address, port, callback);
  };
  patchResolver(dns, "callback");
  patchResolver(dns.Resolver.prototype, "callback");
  patchResolver(dns.promises, "promise");
  patchResolver(dns.promises.Resolver.prototype, "promise");
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
  // A tagged request is recorded by its own ticket; only untagged ones here.
  if (!entry.ticket) gate.recordUnattributed({ host: entry.host, outcome, status, ts: entry.ts });
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
      gate.recordBackstopBlock({ host: verdict.host, ticket: existing?.ticket ?? null });
      chromiumInFlight.delete(key(details));
    } else if (!verdict.cancel && verdict.remote && !existing) {
      chromiumInFlight.set(key(details), { host: verdict.host, ts: Date.now(), ticket: null, webContentsId: details.webContentsId });
    }
    callback({ cancel: verdict.cancel });
  });
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    const tagName = Object.keys(requestHeaders).find((h) => h.toLowerCase() === gate.EGRESS_TAG_HEADER);
    if (tagName) {
      const ticket = gate.ticketByTag(requestHeaders[tagName]);
      delete requestHeaders[tagName]; // the tag never leaves this computer
      const entry = chromiumInFlight.get(key(details));
      if (entry && ticket) {
        entry.ticket = ticket;
        ticket.addHost(entry.host);
      }
    }
    callback({ requestHeaders });
  });
  session.webRequest.onBeforeRedirect((details) => {
    const entry = chromiumInFlight.get(key(details));
    const next = hostOf(details.redirectURL);
    if (entry?.ticket && next) entry.ticket.addHost(next);
  });
  session.webRequest.onCompleted((details) =>
    finishChromium(key(details), { outcome: details.statusCode >= 400 ? "error" : "ok", status: details.statusCode })
  );
  session.webRequest.onErrorOccurred((details) => finishChromium(key(details), { outcome: "error" }));
}

// Loqui never uses peer connections (ratchet test); without a proxy this policy
// also leaves WebRTC no UDP path, which webRequest could not see. Requests of a
// destroyed webContents are cancelled by Chromium, so stop counting them.
function installWebContentsGuard(app) {
  app.on("web-contents-created", (_event, contents) => {
    contents.setWebRTCIPHandlingPolicy?.("disable_non_proxied_udp");
    contents.once?.("destroyed", () => {
      for (const [k, entry] of chromiumInFlight) if (entry.webContentsId === contents.id) chromiumInFlight.delete(k);
    });
  });
  installed.webContents = true;
}

// Node sockets only: loopback connections (self-hosted STT, llama-server) and
// Chromium's pool are left alone. Ticketed Chromium requests are stopped by
// their own abort signals (gate.abortAllRemote); un-ticketed ones are waited
// for, and keep the attestation unverified until they end.
function severAll() {
  const sockets = [...openRemoteSockets];
  for (const socket of sockets) socket.destroy();
  openRemoteSockets.clear();
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
- **Enforcement.** While sealed, a network-capable program, or a spawn that third-party code makes from inside `node_modules` (an SDK credential helper, for example), is refused before it starts. FFmpeg is always restricted to local inputs.
- **Evidence.** Every network-capable child that runs while unsealed is registered, and counts as *alive* until the OS reports its exit. For a detached process group, it stays alive until the whole group is gone. Sealing stops these children and waits for them; a child that survives `SIGKILL` keeps the attestation unverified (Task 7). A kill signal is never treated as proof of exit.

**Files:**
- Create: `src/helpers/privacy/childRegistry.js`
- Modify:
  - `src/helpers/ffmpegUtils.js`. Add `localOnlyInputs(args)`, and use it at all three spawn sites: `runFFmpegConversion` (`spawn(ffmpegPath, [...args, "-y", outputPath]`), `splitAudioFile` (`spawn(ffmpegPath, args`) and `mergeAudioSegments` (`spawn(ffmpegPath, args`).
  - `docs/security/sealed-mode-threat-model.md`. Add the `spawn-sites` inventory (Task 1, Step 3).
- Test: `test/helpers/childRegistry.test.js` and `test/helpers/ffmpegContainment.test.js`

**Interfaces:**
- Produces:

  ```js
  // src/helpers/privacy/childRegistry.js
  installSpawnGuard({ childProcess?, utilityProcess? }): void   // idempotent; wraps spawn/execFile/exec/fork and their Sync forms, and utilityProcess.fork
  register(child, { kind: string, group?: boolean }): Entry     // the guard registers automatically; exported for tests
  alive(kind?: string): Array<{ kind, pid }>                    // exited only after the OS reported exit (and, for a group, the group is gone)
  stopAll({ kinds?, termGraceMs = 1500, killGraceMs = 1500 }?): Promise<void>
                                                                // SIGTERM → wait → SIGKILL → wait; rejects with code CHILD_STOP_FAILED if any is still alive
  classify(command: string, stack?: string): "network" | "thirdParty" | "ffmpeg" | "local"
  kindOf(command: string): string                               // "codex", "yt-dlp", or the program's base name
  _resetForTests(): void
  ```

  ```js
  // src/helpers/ffmpegUtils.js
  localOnlyInputs(args: string[]): string[]   // inserts "-protocol_whitelist", "file,pipe" before every "-i" that lacks it
  ```

- **Rules.**
  - **`network`** covers `codex`, `yt-dlp*`, `curl`, `wget`, `ffplay`, `aws`, `gcloud`, `ssh` and `git`. It is refused while sealed, and registered while unsealed.
  - **`thirdParty`** is any spawn whose call stack enters `/node_modules/`. It is refused while sealed, and registered while unsealed.
  - **`ffmpeg`** must carry `-protocol_whitelist` before every `-i`, or it is refused in every mode. A crafted local playlist or media file must never make FFmpeg fetch remote resources.
  - **`local`** is everything else Loqui starts from its own code: clipboard and paste helpers, key listeners, `osascript`, the loopback sidecars, and so on. Each of these call sites is listed and justified in the `spawn-sites` inventory, and a ratchet test fails on any unlisted file (Task 1).
  - **`utilityProcess.fork`** is allowed only for modules under the app's `src/workers/` directory, which the inventory ratchet keeps free of network code. Anything else is refused while sealed.

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
  assert.equal(registry.classify("xclip", "at y (/app/src/helpers/clipboard.js:125:9)"), "local");
  assert.equal(registry.kindOf("/x/yt-dlp_linux"), "yt-dlp");
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
const gate = require("./egressGate");
const { SealedModeError } = require("./egressPolicy");

// Programs Loqui may start that reach the network themselves (threat model,
// spawn-sites). Main cannot see their traffic, so while sealed they do not run,
// and while unsealed each run is tracked until the OS reports its exit.
const NETWORK_COMMANDS = [/^codex(\.exe)?$/, /^yt-dlp/, /^curl(\.exe)?$/, /^wget(\.exe)?$/, /^ffplay/, /^aws(\.exe)?$/, /^gcloud/, /^ssh(\.exe)?$/, /^git(\.exe)?$/];
const FFMPEG = /^ffmpeg/;
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
  const base = baseName(command).split("\\").pop();
  if (NETWORK_COMMANDS.some((re) => re.test(base))) return "network";
  if (FFMPEG.test(base)) return "ffmpeg";
  if (/[\\/]node_modules[\\/]/.test(stack)) return "thirdParty";
  return "local";
}

function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function isAlive(entry) {
  if (!entry.exited) return true;
  return entry.group && process.platform !== "win32" && entry.pid ? groupAlive(entry.pid) : false;
}

function register(child, { kind, group = false }) {
  const entry = { child, kind, pid: child?.pid, group, exited: !child?.pid };
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

function alive(kind) {
  const list = [];
  for (const entry of entries) {
    if (!isAlive(entry)) {
      entries.delete(entry);
      continue;
    }
    if (!kind || entry.kind === kind) list.push({ kind: entry.kind, pid: entry.pid });
  }
  return list;
}

function signal(entry, sig) {
  try {
    if (entry.group && process.platform !== "win32" && entry.pid) process.kill(-entry.pid, sig);
    else entry.child.kill(sig);
  } catch {
    // Already gone; isAlive() decides.
  }
}
const waitUntil = async (predicate, ms) => {
  const deadline = Date.now() + ms;
  while (!predicate() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  return predicate();
};

async function stopAll({ kinds, termGraceMs = 1500, killGraceMs = 1500 } = {}) {
  const targets = [...entries].filter((e) => isAlive(e) && (!kinds || kinds.includes(e.kind)));
  if (targets.length === 0) return;
  for (const t of targets) signal(t, "SIGTERM");
  if (await waitUntil(() => targets.every((t) => !isAlive(t)), termGraceMs)) return;
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
  if ((kind === "network" || kind === "thirdParty") && gate.isSealed())
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
      if ((kind === "network" || kind === "thirdParty") && !name.endsWith("Sync")) {
        const options = args.find((a, i) => i > 0 && a && typeof a === "object" && !Array.isArray(a)) ?? {};
        register(result, { kind: kindOf(command), group: options.detached === true });
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
}

module.exports = { installSpawnGuard, register, alive, stopAll, classify, kindOf, _resetForTests, SealedModeError };
```

`recordBackstopBlock` gives the ledger a `blocked` row for the refused program. Its host field is the program's kind (`yt-dlp`, `curl`), which passes the bare-host check. Refusals happen synchronously, as Node's own spawn argument errors do. Every managed caller (`codexAppServer.start`, `maybeUpdateYtDlp`, `runYtDlp`) already wraps its spawn in `try`/`catch`, or runs behind a gate that refuses first (Tasks 8 and 10).

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
    id: number; ts: number; task: EgressTask; host: string;
    bytesOut: number | null; bytesIn: number | null; outcome: EgressOutcome;
    status: number | null; errorClass: string | null; model: string | null;
    attributed: boolean; opaque: boolean;
  }
  export interface EgressSummary {
    left: number; blocked: number; unattributed: number; unattributedHosts: string[];
    bytesOut: number; bytesIn: number; unknownBytes: number; opaqueSessions: number;
  }
  export type EgressNotice =
    | { phase: "sent"; ticketId: number; task: EgressTask; host: string; payload: EgressPayload; correlationId: string | null; ts: number }
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
    networkChildren: string[]; activeRemote: number;
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

test("sent notices and recorded events are broadcast; settled tickets refresh the attestation", async (t) => {
  const h = harness(t);
  const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com", payload: "text" });
  ticket.markSent();
  ticket.settle({ outcome: "ok" });
  await new Promise((r) => setTimeout(r, 80));
  const phases = h.sent.filter(([c]) => c === "privacy:egress-event").map(([, n]) => n.phase);
  assert.deepEqual(phases, ["sent", "sent", "recorded", "recorded"]);
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
  listeners.get("privacy:egress-event")({}, { phase: "sent", task: "chat" });
  assert.deepEqual(notices, [{ phase: "sent", task: "chat" }]);
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
    if (getInference()?.codexRunning?.() || children.alive().length > 0) running.push("children");
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
      ...new Set([...(getInference()?.codexRunning?.() ? ["codex"] : []), ...children.alive().map((c) => c.kind)]),
    ];
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
  const onSent = (notice) => broadcast("privacy:egress-event", { phase: "sent", ...notice });
  const onCleared = () => broadcast("privacy:egress-cleared");
  recorder.on("event", onEvent);
  recorder.on("cleared", onCleared);
  gate.events.on("sent", onSent);
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
      gate.events.off("sent", onSent);
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

Create `src/types/privacy.ts` with the TypeScript block from **Interfaces** above. In `src/types/electron.ts`, after line 677 (`personalInference: …`), add:

```ts
      privacy: import("./privacy").PrivacyAPI;
```

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
- Test: `test/helpers/rendererHardening.test.js`

**Interfaces:** none new. Task 6's `installWebContentsGuard` already applies the WebRTC policy to every `webContents`.

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

- [ ] **Step 4: Run the tests, then check the control panel by hand**

Run: `npm test -- test/helpers/rendererHardening.test.js test/helpers/preloadAuthBridge.test.js`
Expected: PASS.

Then run `npm run native:electron && npm run dev` with a disposable `LOQUI_PROFILE_DIR`, and exercise the control panel:
- Settings in every section;
- notes, chat and history playback of a recording;
- file upload, drag-and-drop and image attachments;
- model downloads.

Anything that breaks because it relied on the sandbox or web security being relaxed must be fixed at its cause, for example with a main-process IPC call or a custom protocol. Do not relax the settings again. Record each such fix in the PR description.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/windowConfig.js src/index.html test/helpers/rendererHardening.test.js
git commit -m "fix(security): sandbox the control panel and keep web security on"
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

test("unsealed: the model factory receives a metered fetch, and 'sent' carries payload and correlation id", async (t) => {
  const sent = [];
  const h = harness(t, {
    modelFactory: async (...args) => {
      await args[6]("https://api.groq.com/openai/v1/chat/completions", { method: "POST", body: "{}" }).catch(() => {});
      throw new Error(REACHED);
    },
  });
  gate.events.on("sent", (n) => sent.push(n));
  // meteredFetch's default transport is the global fetch; keep the test offline.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(h.invoke("text-generate", chatRequest({ inferenceScope: "noteFormatting", correlationId: "note-7" })), new RegExp(REACHED));
  assert.deepEqual(sent.map((n) => [n.task, n.payload, n.correlationId]), [["noteFormatting", "text", "note-7"]]);
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
function gatedNetFetch(url, init = {}, { task, payload, correlationId } = {}) {
  const { net } = require("electron");
  return egress.guardResponse({ task, target: String(url), payload, correlationId }, (ticket) =>
    egress.meteredFetch(ticket, (u, i) => net.fetch(String(u), { ...i, useSessionCookies: false }))(
      url,
      withTicketSignal(init, ticket)
    )
  );
}

// Node global fetch through the gate, for helpers that take a fetch implementation.
function gatedNodeFetch(task, { payload, correlationId } = {}) {
  return (url, init = {}) =>
    egress.guardResponse({ task, target: String(url), payload, correlationId }, (ticket) =>
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
   function codexSession(child) {
     const session = egress.authorize({ task: "codex", target: CODEX_HOST, meter: "opaque" });
     session.signal.addEventListener("abort", () => child.kill(), { once: true });
     child.once("exit", (code) => session.settle({ outcome: code === 0 || code === null ? "ok" : "error" }));
   }

   const payloadOf = (messages) =>
     messages.some((m) => Array.isArray(m.content) && m.content.some((part) => part?.type === "image" || part?.type === "image_url"))
       ? "image"
       : "text";
   ```

   Change the default parameter at `:214` to:

   ```js
     codex = new CodexAppServer({
       userDataPath,
       verifyRelease: gatedVerifyRelease(),
       beforeSpawn: () => egress.assertAllowed({ task: "codex", target: CODEX_HOST }),
       onSpawn: codexSession,
     }),
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

   - Directly before `const text = await codex.generate({` (`:392`), and directly before `const result = streamText(options);` (`:471`) and `const result = await generateText(options);` (`:489`), add `ticket.markSent();`. `meteredFetch` also marks, and the call is idempotent. These cover the providers that do not take a fetch.
   - Pass the metered fetch as the seventh `modelFactory` argument (`:412-421`). After the existing six arguments, add `egress.meteredFetch(ticket),`.
   - In the `catch` (`:497`), before `if (controller.signal.aborted && error !== controller.signal.reason) throw abortFailure();` (`:501`), add:

     ```js
         if (isSealedModeError(controller.signal.reason)) throw controller.signal.reason;
     ```

7. In the returned object (`:532`), add:

   ```js
       stopCodex: () => codex.stopAndWait(),
       codexRunning: () => codex.alive(),
   ```

8. Add `gatedVerifyRelease` to `module.exports`.

- [ ] **Step 6: Gate the Tinfoil catalog, the connection test and the legacy enterprise channels**

1. In `src/helpers/tinfoilCatalog.js`, wrap the body of `fetchModels` (`:41-51`). The guard spans the JSON read, so the ticket covers the whole exchange:

   ```js
   const egress = require("./privacy/egressGate");
   // …
   async function fetchModels() {
     return egress.guard({ task: "providerCheck", target: "https://inference.tinfoil.sh" }, async (ticket) => {
       ticket.markSent();
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
  - `postMultipart(url, body, boundary, headers?, { signal?, session?, correlationId? }?) → Promise<data>`. It is gated, records `bytesOut = body.length` exactly, has payload `"audio"`, and marks the ticket sent just before `net.fetch`.
- Speech tasks: `dictationStt` for captured audio, retry and the legacy proxies; `uploadStt` for file paths.
- Correlation: the BYOK request may carry `correlationId`. Otherwise its existing `requestId` is used. Either way it is echoed in `sent` notices (CCR-3).

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

test("unsealed: an upload records exact body bytes, status, and a 'sent' notice with the correlation id", async () => {
  const sent = [];
  gate.events.on("sent", (n) => sent.push(n));
  const { body, boundary } = audio();
  await gate.withTask("uploadStt", () =>
    stt.postMultipart(new URL("https://api.groq.com/openai/v1/audio/transcriptions"), body, boundary, {}, { correlationId: "upload-3" })
  );
  const [row] = recorder.list();
  assert.deepEqual([row.task, row.outcome, row.bytesOut, row.status], ["uploadStt", "ok", body.length, 200]);
  assert.deepEqual(sent.map((n) => [n.task, n.payload, n.correlationId]), [["uploadStt", "audio", "upload-3"]]);
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
async function postMultipart(url, body, boundary, headers = {}, { signal, session: fetchSession, correlationId = null } = {}) {
  const { net } = require("electron");
  return egress.guard({ target: url.toString(), payload: "audio", correlationId }, async (ticket) => {
    ticket.addBytes({ out: body.length });
    ticket.markSent();
    const response = await (fetchSession ?? net).fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        ...headers,
      },
      body,
      signal: signal ? AbortSignal.any([signal, ticket.signal]) : ticket.signal,
      /* …any other options from the original call, unchanged… */
    });
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
   - pass `correlationId: correlationId ?? requestId` in the options of both `postMultipart` calls (`:8089-8095`, `:8241`), next to `signal: job.signal`.

   The handler's `catch` (`:8298-8305`) already returns `{ success: false, error, code, messageKey }`. A `SealedModeError` therefore reaches the renderer with `code: "SEALED_MODE"` and the `messageKey` for its phase.

4. In `geminiTranscription.js:69` and `cortiTranscription.js:7`, replace `net.fetch(url, init)` with `gatedNetFetch(url, init, { payload: "audio" })`. In `cortiAuth.js:39`, replace it with `gatedNetFetch(url, init)`, since a token request is metadata. Add `const { gatedNetFetch } = require("./privacy/gatedFetch");` to each file. The task comes from the handler's `withTask` context, and the ticket stays open until the caller has read the response body (Task 8, `guardResponse`).

5. In `tinfoilTranscription.js`, wrap everything from the `tinfoilSecureFetch(` call through the line that reads its response body:

   ```js
   const egress = require("./privacy/egressGate");
   // …
   return egress.guard({ target: "https://inference.tinfoil.sh", payload: "audio" }, async (ticket) => {
     ticket.markSent();
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
    - Mark audio as sent in each audio-send handler.
- Test: `test/helpers/realtimeSealed.test.js`

**Interfaces:**
- Consumes `egressGate.authorize`, `runWithTicket` and `markSentFor` (Task 5), and the socket metering in `egressBackstop` (Task 6).
- Produces:
  - `realtimeEndpoint(provider: string, options?: { environment?: string }): string`.
  - `connectRealtime({ task, provider, options, correlationId? }, connect: () => Promise<T>): Promise<T>`. It authorizes a `meter: "socket"`, `payload: "audio"` ticket and runs `connect` inside it, so the WebSocket created there attaches to the ticket.
    - If `connect` opened no socket (a warm connection was reused, or the stream was already connected), the redundant ticket is discarded. The warm connection's own ticket keeps ownership and settles when that socket closes.
    - On failure, the ticket settles and the error (or the sealing reason) is rethrown.
- Tasks: `noteRecordingStt` for the meeting paths, `dictationStt` for everything else.
- A realtime session is marked sent at its first audio frame, not at connect, so a warmed but unused socket never counts as "the provider received audio".

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
  let warmSocket;
  await stt.connectRealtime({ task: "dictationStt", provider: "assemblyai-realtime" }, async () => {
    warmSocket = net.connect({ host: "streaming.assemblyai.com", port, lookup: toLoopback });
    await once(warmSocket, "connect");
  });
  assert.equal(gate.activeRemoteCount(), 1, "the warm socket's ticket");
  await stt.connectRealtime({ task: "dictationStt", provider: "assemblyai-realtime" }, async () => {
    // AssemblyAiStreaming.connect() adopts the warm socket and opens nothing (assemblyAiStreaming.js:394-398).
  });
  assert.equal(gate.activeRemoteCount(), 1, "the reuse ticket was discarded");
  warmSocket.end();
  await once(warmSocket, "close");
  assert.equal(gate.activeRemoteCount(), 0);
  assert.equal(recorder.list().length, 1);
});

test("audio is 'sent' at the first frame, with the recording's correlation id", async (t) => {
  const port = await server(t);
  const sent = [];
  gate.events.on("sent", (n) => sent.push(n));
  let socket;
  await stt.connectRealtime({ task: "dictationStt", provider: "openai-realtime" }, async () => {
    socket = net.connect({ host: "api.openai.com", port, lookup: toLoopback });
    await once(socket, "connect");
  });
  assert.deepEqual(sent, [], "a warm or idle socket is not delivery");
  gate.markSentFor({ task: "dictationStt", correlationId: "rec-42" });
  gate.markSentFor({ task: "dictationStt", correlationId: "rec-42" });
  assert.deepEqual(sent.map((n) => [n.payload, n.correlationId]), [["audio", "rec-42"]]);
  socket.destroy();
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
async function connectRealtime({ task, provider, options, correlationId = null }, connect) {
  return egress.withTask(task, async () => {
    const ticket = egress.authorize({
      target: realtimeEndpoint(provider, options),
      meter: "socket",
      payload: "audio",
      correlationId,
    });
    try {
      const result = await egress.runWithTicket(ticket, connect);
      // A reused warm connection (or an already-open one) belongs to the ticket
      // that opened it; this one has nothing to own.
      if (ticket.socketCount() === 0 && !ticket.settled) ticket.discard();
      return result;
    } catch (error) {
      const reason = ticket.signal.aborted ? ticket.signal.reason : null;
      ticket.settle({ outcome: reason ? "cancelled" : "error", errorClass: error?.code || error?.name || "Error" });
      throw reason ?? error;
    }
  });
}

module.exports = { buildMultipartBody, postMultipart, realtimeEndpoint, connectRealtime };
```

- [ ] **Step 4: Route every realtime warmup and start through it**

In `src/helpers/ipcHandlers.js`, import `connectRealtime` from `./sttTransport`.

1. In `connectDictationStreaming` (`:7024`), wrap everything from the token request (`fetchRealtimeToken(…)`, `:7059`) through the `connect(...)` call of the new streaming instance (`:7051` onward):

   ```js
       return connectRealtime(
         { task: "dictationStt", provider: options.provider, options, correlationId: options.correlationId ?? null },
         async () => {
           /* …existing token fetch, `new OpenAIRealtimeStreaming()` (or the Tinfoil subclass) and connect, unchanged… */
         }
       );
   ```

   In `dictation-realtime-start` (`:7733`), store `this._dictationCorrelationId = options.correlationId ?? null;`.

2. Wrap the same span (from token fetch through `warmup(...)` or `connect(...)`) in every other realtime handler:

   | Handler | Lines | Task | `provider` |
   |---|---|---|---|
   | `assemblyai-streaming-warmup`, `assemblyai-streaming-start` | `:8440`, `:8472` | `dictationStt` | `assemblyai-realtime` |
   | Deepgram warmup and start | `:8605`, `:8615`, `:8669` | `dictationStt` | `deepgram-realtime` |
   | Gemini start | `:8819`, `:8839` | `dictationStt` | `gemini-realtime` |
   | Corti warmup and start | `:8956`, `:8959`, `:8981` | `dictationStt` | `corti-realtime` |
   | Meeting transcription start | `:5846`, `:6022` | `noteRecordingStt` | the provider id that path already resolves |

   List them with `grep -n '"[a-z-]*-\(streaming\|realtime\)-\(warmup\|start\)"\|meeting-transcription-start' src/helpers/ipcHandlers.js`. Task 12 enumerates the same channels and fails for any one not refused while sealed.

3. In every audio-send handler, add one line before the buffer is forwarded: `dictation-realtime-send` (`:7744`), the provider `*-streaming-send` handlers, and the meeting audio sends. List them with `grep -n '\(streaming\|realtime\)-send\|meeting-transcription-.*audio' src/helpers/ipcHandlers.js`. For example:

   ```js
     ipcMain.on("dictation-realtime-send", (_event, buffer) => {
       egress.markSentFor({ task: "dictationStt", correlationId: this._dictationCorrelationId });
       this._dictationStreaming?.sendAudio(Buffer.from(buffer));
     });
   ```

   Use `noteRecordingStt` in the meeting handlers. `markSentFor` is idempotent per ticket, so calling it for every chunk costs one map scan.

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
  - `ytDlpControl = { alive(): boolean, stop({ timeoutMs? }?): Promise<void> }`. `alive()` is true while a self-update or any yt-dlp download child is running. `stop()` waits for them to exit and rejects with `YTDLP_STOP_FAILED` if they will not. Sealing kills them through their tickets' abort signals, and `stop()` confirms it.
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
function stuckChild() {
  const child = new EventEmitter();
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
  const cleanup = ensureCacheBinary();
  const origSpawn = childProcess.spawn;
  let child;
  childProcess.spawn = () => (child = stuckChild());
  t.after(() => { childProcess.spawn = origSpawn; cleanup(); gate._resetForTests(); });

  const update = downloader.maybeUpdateYtDlp({ force: true, timeoutMs: 60000 });
  assert.equal(downloader.ytDlpControl.alive(), true);
  flags.sealed = true;
  gate.abortAllRemote();
  await update;
  assert.deepEqual(child.signals, ["SIGKILL"]);
  await downloader.ytDlpControl.stop({ timeoutMs: 500 });
  assert.equal(downloader.ytDlpControl.alive(), false);
  const [row] = recorder.list();
  assert.deepEqual([row.task, row.host, row.opaque, row.bytesIn], ["runtimeDownload", "github.com", true, null]);
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
  const pending = h.manager.check(true);
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
2. In `downloadAttempt`, add `onBytes` to the destructure at `:63` (`const { onProgress, onBytes, signal, startOffset = 0, expectedSize = 0 } = options;`). In the `data` handler, directly after `downloadedSize += chunk.length;` (`:187`), add `onBytes?.(chunk.length);`.
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
       ticket.markSent();
       // Bytes received in this run only: a resumed download does not recount
       // what an earlier run already fetched. Request bytes (headers) stay unknown.
       return downloadFileUngated(url, destPath, { ...rest, signal, onBytes: (n) => ticket.addBytes({ in: n }) });
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
       ticket.markSent();
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
   - In `finish` (`:445-454`), directly after `ytDlpUpdateInFlight = false;`, add `session.settle({ outcome: session.signal.aborted ? "cancelled" : errMessage ? "error" : "ok" });`.
   - In the spawn-failure catch (`:427-432`), add the same `session.settle({ outcome: "error" });`.

3. Add the control object next to the state variables (`:42-43`), and export it:

   ```js
   // Read by the Sealed mode transition and attestation (privacyBoot.js).
   const ytDlpControl = {
     alive: () => ytDlpUpdateInFlight || ytDlpBusyCount > 0,
     // Sealing aborts the urlImport and self-update tickets, which kill the
     // children; this waits until they are really gone.
     async stop({ timeoutMs = 3000 } = {}) {
       const deadline = Date.now() + timeoutMs;
       while (ytDlpControl.alive() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
       if (ytDlpControl.alive()) throw Object.assign(new Error("yt-dlp did not stop."), { code: "YTDLP_STOP_FAILED" });
     },
   };
   ```

   `ytDlpBusyCount` drops only after `runYtDlp` settles on the child's `close` (`:379-386`, `:680`), so `alive()` reflects real process lifetime.

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
       const ticket = this.authorize({ task: "appUpdate", target: UPDATE_HOST });
       this.running = true;
   ```

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

### Task 11: Gate calendars and their background sync (N19, N20)

**Files:**
- Modify:
  - `src/helpers/googleCalendarOAuth.js:152-160` (`_httpsPost`).
  - `src/helpers/googleCalendarManager.js:357` (`_apiGet`).
  - `src/helpers/microsoftCalendarOAuth.js:155, 168`.
  - `src/helpers/microsoftCalendarManager.js:396-400` (`_apiGet`).
  - `src/helpers/ipcHandlers.js:9164` (`gcal-start-oauth`) and `:9251` (`mcal-start-oauth`).
  - `main.js:566-567` (start), `:781-785` (focus) and `:788-794` (wake).
- Test: `test/helpers/calendarSealed.test.js`

**Interfaces:**
- Consumes `gatedNetFetch` (Task 8) and `egress.assertAllowed` (Task 5).
- The seal transition (Task 7) already calls `stop()` and `start()` on both managers.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/calendarSealed.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const fetches = [];
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron")
    return {
      app: { getPath: () => process.cwd(), isReady: () => false, getName: () => "test" },
      net: { fetch: async (url) => { fetches.push(url); return new Response("{}", { status: 200 }); } },
      shell: { openExternal: async () => {} },
      BrowserWindow: { getAllWindows: () => [] },
    };
  return originalLoad.call(this, request, parent, isMain);
};
test.after(() => { Module._load = originalLoad; });

const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError } = require("../../src/helpers/privacy/egressPolicy");
const GoogleCalendarOAuth = require("../../src/helpers/googleCalendarOAuth");
const MicrosoftCalendarManager = require("../../src/helpers/microsoftCalendarManager");

let recorder;
test.beforeEach(() => {
  fetches.length = 0;
  recorder = new FlightRecorder({ now: () => 1 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => true, recorder, now: () => 1 });
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

test("main does not start calendar sync while sealed", () => {
  const main = fs.readFileSync(path.join(__dirname, "../../main.js"), "utf8");
  assert.match(main, /if \(!privacy\.state\.isSealed\(\)\) \{\s*googleCalendarManager\.start\(\);\s*microsoftCalendarManager\.start\(\);\s*\}/);
  assert.match(main, /browser-window-focus[\s\S]{0,200}privacy\.state\.isSealed\(\)/);
  assert.match(main, /powerMonitor\.on\("resume"[\s\S]{0,400}privacy\.state\.isSealed\(\)/);
});
```

Both modules export their class directly: `googleCalendarOAuth.js:169` exports `GoogleCalendarOAuth(databaseManager)`, and `microsoftCalendarManager.js:429` exports the manager, whose constructor is `(databaseManager, reminderScheduler)`. `_apiGet(path, accountEmail)` (`:396`) builds the Graph URL from `path` and gets a token from `this.oauth.getValidAccessToken(accountEmail)`. The test stubs `oauth` so the only network step left is the gated fetch.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/helpers/calendarSealed.test.js`
Expected: FAIL. `fetches` is non-empty, and the `main.js` patterns are not found.

- [ ] **Step 3: Implement**

1. In each of the four calendar modules, add `const { gatedNetFetch } = require("./privacy/gatedFetch");`. Replace each `net.fetch(url, init)` named above with `gatedNetFetch(url, init, { task: "calendar" })`. The `useSessionCookies: false` option is now supplied by `gatedNetFetch`, so it can stay or go.
2. In `ipcHandlers.js`, make the first statement of the `gcal-start-oauth` handler (`:9164`) `egress.assertAllowed({ task: "calendar", target: "https://accounts.google.com" });`. Do the same in the `mcal-start-oauth` handler (`:9251`) with `"https://login.microsoftonline.com"`. This refuses before a browser consent page opens for a sign-in that could not complete.
3. In `main.js`:
   - `:566-567` becomes:

     ```js
       // Sealed mode: remote calendars stay stopped; the seal transition restarts them.
       if (!privacy.state.isSealed()) {
         googleCalendarManager.start();
         microsoftCalendarManager.start();
       }
     ```

   - In the `browser-window-focus` handler (`:781-785`; Google and Microsoft at `:782-783`), change the Google and Microsoft lines to `if (googleCalendarManager && !privacy.state.isSealed()) googleCalendarManager.syncOnFocus();` (and the same for Microsoft). Leave Apple unchanged: EventKit is local.
   - In the `powerMonitor.on("resume")` handler (`:788-794`; Google at `:790-792`, Microsoft at `:793`), make the same change to the Google and Microsoft `onWakeFromSleep()` calls.
4. Add `src/helpers/calendarSyncInterval.js` to the N20 row only if it gains a network primitive. It does not, so leave the `egress-sites` block alone.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/helpers/calendarSealed.test.js test/helpers/privacyBootOrder.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/googleCalendarOAuth.js src/helpers/googleCalendarManager.js src/helpers/microsoftCalendarOAuth.js src/helpers/microsoftCalendarManager.js src/helpers/ipcHandlers.js main.js test/helpers/calendarSealed.test.js
git commit -m "feat(privacy): gate calendar OAuth, API reads and background sync"
```

---

### Task 12: Prove that a sealed main process rejects every blocked request type

This task is the dedicated enforcement matrix. It drives the **real registered handlers**, the same `ipcMain.handle` callbacks the renderer reaches through preload, with Sealed mode on. For every `blocked` row of the inventory (N1–N20), and every transport variant inside a row, it must show three things:
1. the caller receives a sealed refusal (thrown, or `{ success: false, code: "SEALED_MODE" }`);
2. no transport was touched: Electron `net.fetch`/`net.request`, Node `fetch`, an allowed off-host socket, or a spawn;
3. the ledger holds a `blocked` row with `bytesOut: 0` and the right task.

There are four kinds of extra row:
- **Prevented rows:** background work that is simply not started.
- **Loopback rows:** local routes still work.
- **Interruption rows:** sealing mid-flight reports `"interrupted"`.
- **The Layer B row:** a request site nobody gated is still refused.

A ratchet ties the matrix to the threat model, and to every realtime and proxy channel that `ipcHandlers.js` registers.

**Files:**
- Create: `test/helpers/harness/ipcHandlersHarness.js`. It loads `IPCHandlers.prototype.setupHandlers` with an Electron stub, generalised from `test/helpers/granolaImportIpc.test.js:1-98`.
- Test: `test/helpers/sealedModeEnforcement.test.js`

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
const { gatedNetFetch } = require("../../src/helpers/privacy/gatedFetch");
const stt = require("../../src/helpers/sttTransport");
const { downloadFile, fetchJson } = require("../../src/helpers/downloadUtils");
const urlAudio = require("../../src/helpers/urlAudioDownloader");
const { REALTIME_TOKEN_PROVIDERS } = require("../../src/helpers/realtimeTokenProviders");
const { registerPersonalInferenceIPC, gatedVerifyRelease } = require("../../src/helpers/personalInference");
const { CodexAppServer } = require("../../src/helpers/codexAppServer");
const { UpdateManager } = require("../../src/helpers/updateManager");
const GoogleCalendarOAuth = require("../../src/helpers/googleCalendarOAuth");
const MicrosoftCalendarManager = require("../../src/helpers/microsoftCalendarManager");

backstop.installNodeBackstop();
backstop.addObserver((event) => { if (event.allowed) transport.socket++; });

const flags = { sealed: true };
let recorder;
test.beforeEach(() => {
  flags.sealed = true;
  for (const key of Object.keys(transport)) transport[key] = 0;
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

function inference() {
  const handlers = new Map();
  const codex = Object.assign(new EventEmitter(), {
    status: async () => ({}), login: async () => ({}), cancelLogin: async () => {}, logout: async () => {},
    models: async () => [], rateLimits: async () => ({}), stop() {}, erase: async () => {}, generate: async () => "x",
    alive: () => false, stopAndWait: async () => {},
  });
  registerPersonalInferenceIPC({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn), removeHandler() {} },
    userDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "loqui-matrix-")),
    getCredential: async () => "sk-test", saveCredential: async () => {}, openExternal: async () => {},
    codex, modelFactory: async () => { throw new Error("reached the model factory"); },
  });
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send() {} });
  return (name, ...args) => handlers.get(`personal-inference:${name}`)({ sender }, ...args);
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
  N4: [["test-provider-connection", "providerCheck", () => ipc.invoke("test-provider-connection", { provider: "groq", apiKey: "sk-test" })]],
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
  N10: [["AssemblyAI token request", "dictationStt", () =>
    gate.withTask("dictationStt", () =>
      REALTIME_TOKEN_PROVIDERS["assemblyai-realtime"]({ environmentManager: { getAssemblyAIKey: () => "k" }, proxyFetch: gatedNetFetch }, {}, 1)
    )]],
  N11: [["get-tinfoil-chat-models", "providerCheck", () => ipc.invoke("get-tinfoil-chat-models")]],
  N12: [["downloadFile (all model managers)", "modelDownload", () => downloadFile("https://huggingface.co/x/model.bin", path.join(os.tmpdir(), `m-${Date.now()}.bin`))]],
  N13: [["fetchJson (runtime release lookup)", "runtimeDownload", () => fetchJson("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest", { egressTask: "runtimeDownload" })]],
  N14: [["download-url-audio", "urlImport", () => ipc.invoke("download-url-audio", "https://example.com/a.mp3")]],
  N16: [["manual update check", "appUpdate", () => updateManager().check(true)]],
  N17: [["Codex release verification", "codex", () => gatedVerifyRelease(async () => { transport.nodeFetch++; })({})]],
  N18: [["personal-inference:codex-status", "codex", () => inference()("codex-status")]],
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
    const server = new CodexAppServer({
      userDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "loqui-matrix-codex-")),
      resolveExecutable: async () => "/verified/codex",
      runFile: async () => ({ stdout: require("../fixtures/codex-app-server-0.154.json").version }),
      verifyRelease: async () => {},
      beforeSpawn: () => gate.assertAllowed({ task: "codex", target: "https://chatgpt.com" }),
    });
    await assert.rejects(server.start(), isSealedModeError);
    assert.equal(transport.spawn, 0);
  },
  N20: async () => {
    const main = fs.readFileSync(path.join(__dirname, "../../main.js"), "utf8");
    assert.match(main, /if \(!privacy\.state\.isSealed\(\)\) \{\s*googleCalendarManager\.start\(\);/);
    const manager = new MicrosoftCalendarManager({}, { scheduleNextMeeting() {} });
    manager.oauth = { getValidAccessToken: async () => "token" };
    await assert.rejects(manager._apiGet("/me/events", "user@example.com"), isSealedModeError);
  },
};

for (const [id, variants] of Object.entries(BLOCKED)) {
  for (const [label, task, action] of variants) {
    test(`${id} ${label}: refused before any transport, recorded as ${task}`, async () => {
      const outcome = await outcomeOf(action);
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

test("N9 discovers the realtime channels it must cover", () => {
  assert.ok(REALTIME.includes("dictation-realtime-start"));
  assert.ok(REALTIME.includes("dictation-realtime-warmup"));
  assert.ok(REALTIME.includes("assemblyai-streaming-warmup"));
  assert.ok(REALTIME.length >= 6);
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
    await assert.rejects(
      inference()("text-generate", ask({ provider: "local", baseUrl: "http://127.0.0.1:8080/v1", inferenceScope: "dictationCleanup" })),
      /reached the model factory/
    );
    assert.equal(await (await originalFetch(`http://127.0.0.1:${port}/`)).text(), "{}");
    assert.equal(recorder.list().length, 0);
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
  const covered = new Set([...Object.keys(BLOCKED), ...Object.keys(PREVENTED)]);
  assert.deepEqual(blocked.filter((id) => !covered.has(id)), []);
});

test("all model managers download only through downloadUtils", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
  for (const file of ["src/helpers/whisper.js", "src/helpers/parakeet.js", "src/helpers/diarization.js", "src/helpers/modelManagerBridge.js", "src/helpers/localEmbeddings.js", "src/helpers/gpuBinaryManager.js"]) {
    assert.doesNotMatch(read(file), /\bnet\.(fetch|request)\s*\(|\bhttps?\.(get|request)\s*\(/, file);
  }
});
```

Rules for fixing a failing row:
- **A handler fails before reaching its egress point** because a fake manager lacks a method or a request field is missing. Add the method to `managers`, or the field to that row's arguments, with a minimal value. Never stub the gate, `gatedNetFetch`, `postMultipart`, `connectRealtime` or `downloadFile`: those are what the row proves.
- **A row reaches a transport.** The gate is missing on that path. Fix the owning task's code (Tasks 8–11), never the assertions.
- **A discovered N9 channel takes different arguments.** Give it its own options object in the `BLOCKED.N9` mapping; keep it in the matrix.

- [ ] **Step 3: Run the matrix**

Run: `npm test -- test/helpers/sealedModeEnforcement.test.js`
Expected: PASS. The count is one test per variant (about 30, depending on how many realtime channels are discovered), plus 3 prevented rows and 6 other checks. Any failure names the inventory row and the channel whose enforcement is missing.

- [ ] **Step 4: Commit**

```bash
git add test/helpers/harness/ipcHandlersHarness.js test/helpers/sealedModeEnforcement.test.js
git commit -m "test(privacy): prove a sealed main process refuses every blocked request type through its real handlers"
```

---

### Task 13: Renderer integration: sealed store, route graph, dictation pre-flight and honest failure copy

**Files:**
- Create:
  - `src/hooks/useSealedMode.ts`
  - `src/lib/sealedMode.ts`
  - `src/utils/sealedModeError.ts`
  - `src/components/chat/chatErrorContent.ts`
- Modify:
  - `src/lib/routes.ts` (Plan 03; CCR-2).
  - `src/components/chat/useChatStreaming.ts:536-546`.
  - `src/utils/localInferenceError.ts:53-63`.
  - `src/utils/recordingErrors.ts:12-31`.
  - `src/helpers/audioManager.js` (renderer code): the pre-flight in `startRecording` (`:1139-1153`), and the failure copy in the pipeline `catch` (`:1903-1928`).
- Test:
  - `test/lib/sealedMode.test.js`
  - `test/utils/sealedModeError.test.js`
  - `test/hooks/useSealedMode.test.js`
  - `test/lib/routesSealed.test.js`
  - `test/helpers/dictationPreflight.test.js`

**Interfaces:**
- Consumes:
  - `window.electronAPI.privacy`, including `onAttestation` (Task 7);
  - `ResolvedRoute`, `RouteSettingsSnapshot`, `resolveRoute`, `resolveRoutes`, `useResolvedRoutes` and `routeSnapshotFromSettings` from `src/lib/routes.ts` (§5.1, CCR-2);
  - `Locality` from `src/lib/locality.ts` (Plan 01).
- Produces:

  ```ts
  // src/hooks/useSealedMode.ts
  export type SealedSnapshot = { sealed: boolean | null; attestation: Attestation | null }; // null = unknown → the UI claims nothing
  export function useSealedMode(): SealedSnapshot;
  export function setSealedMode(sealed: boolean): Promise<Attestation & { declined?: boolean }>;
  export function subscribeSealed(listener: () => void): () => void;
  export function getSealedSnapshot(): SealedSnapshot;
  export function _resetSealedStoreForTests(): void;

  // src/lib/sealedMode.ts
  export function isRouteSealed(route: { locality: Locality }, sealed: boolean | null): boolean;
  export function applySealToRoute<R extends ResolvedRoute>(route: R, sealed: boolean | null): R;
  export function isDictationSealed(settings: SettingsState, sealed: boolean | null): boolean;  // the pre-flight

  // src/utils/sealedModeError.ts
  export const SEALED_MODE = "SEALED_MODE";
  export function isSealedModeError(error: unknown): boolean;
  export function sealedPhase(error: unknown): "refused" | "interrupted" | null;
  export function sealedDictationMessageKey(error: unknown, s: { dataRetentionEnabled: boolean; audioRetentionDays: number }): string;

  // src/components/chat/chatErrorContent.ts
  export function chatErrorContent(error: unknown, t: (key: string) => string): string;
  ```

- **Copy rule.** "Nothing was sent" copy (`sealedMode.blocked.*`) is used only for phase `"refused"`. A request cut off mid-flight uses `sealedMode.interrupted.*`, which says the provider may have received part of it.
- **Pre-flight (owner decision 3, 2026-10-15).** While sealed, a dictation whose speech route is not on this device does not start, so nothing is recorded that main would refuse afterwards.

- [ ] **Step 1: Write the failing tests**

Create `test/lib/sealedMode.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const load = () => import("../../src/lib/sealedMode.ts");

const route = (locality, state = { status: "ready" }) => ({
  id: "chat", kind: "text", locality, provider: "Groq", model: "m", state, sends: "messages", settingsPath: "chat",
});

test("only non-device routes are sealed, and only when sealed is true", async () => {
  const { isRouteSealed } = await load();
  assert.equal(isRouteSealed(route("remote"), true), true);
  assert.equal(isRouteSealed(route("network"), true), true, "LAN leaves this computer (CCR-1)");
  assert.equal(isRouteSealed(route("device"), true), false);
  assert.equal(isRouteSealed(route("remote"), false), false);
  assert.equal(isRouteSealed(route("remote"), null), false, "unknown claims nothing either way");
});

test("applySealToRoute reports unreachable/sealed and leaves everything else alone", async () => {
  const { applySealToRoute } = await load();
  const remote = route("remote");
  assert.deepEqual(applySealToRoute(remote, true).state, { status: "unreachable", detail: "sealed" });
  assert.equal(applySealToRoute(remote, true).provider, "Groq");
  assert.equal(applySealToRoute(remote, false), remote);
  const device = route("device", { status: "needsModel", sizeBytes: 5 });
  assert.equal(applySealToRoute(device, true), device);
  const off = route("remote", { status: "off" });
  assert.equal(applySealToRoute(off, true), off, "a task the user turned off stays off");
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

Create `test/hooks/useSealedMode.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const load = () => import("../../src/hooks/useSealedMode.ts");

function fakePrivacy({ sealed = true, failAttestation = false } = {}) {
  const listeners = {};
  const attestation = { sealed, nothingLeaves: sealed, effectiveSince: 1, blockedSinceSealed: 0, version: 1 };
  return {
    listeners,
    api: {
      getSealed: async () => sealed,
      getAttestation: async () => { if (failAttestation) throw new Error("ipc"); return attestation; },
      setSealed: async (next) => ({ ...attestation, sealed: next, nothingLeaves: next, version: 2 }),
      onSealedChange: (cb) => { listeners.sealed = cb; return () => {}; },
      onAttestation: (cb) => { listeners.attestation = cb; return () => {}; },
    },
  };
}
const tick = () => new Promise((r) => setImmediate(r));

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

test("without the privacy bridge the state stays unknown", async (t) => {
  const store = await load();
  store._resetSealedStoreForTests();
  globalThis.window = { electronAPI: {} };
  t.after(() => { delete globalThis.window; store._resetSealedStoreForTests(); });
  store.subscribeSealed(() => {});
  await tick();
  assert.equal(store.getSealedSnapshot().sealed, null);
});
```

Create `test/lib/routesSealed.test.js`. This is CCR-2 against Plan 03's resolver.

```js
const assert = require("node:assert/strict");
const test = require("node:test");

test("resolveRoutes applies the seal last, to every non-device route", async () => {
  const routes = await import("../../src/lib/routes.ts");
  const { applySealToRoute } = await import("../../src/lib/sealedMode.ts");
  const { settingsWithRemoteRoutes } = require("./routesFixture"); // ← Plan 03's fixture (see note below)
  const snapshot = routes.routeSnapshotFromSettings(settingsWithRemoteRoutes());
  const open = routes.resolveRoutes({ ...snapshot, sealed: false });
  const sealed = routes.resolveRoutes({ ...snapshot, sealed: true });
  assert.equal(sealed.length, 11);
  assert.deepEqual(sealed, open.map((route) => applySealToRoute(route, true)));
  assert.ok(sealed.some((r) => r.locality !== "device" && r.state.status === "unreachable" && r.state.detail === "sealed"),
    "the fixture has at least one remote route; otherwise this test proves nothing");
});
```

Point the `require` at the settings fixture Plan 03's route tests use; find it with `grep -rln "RouteSettingsSnapshot\|resolveRoutes" test/`. If Plan 03 has no such fixture, create `test/lib/routesFixture.js` that exports `settingsWithRemoteRoutes()`: a settings object (the fields `routeSnapshotFromSettings` reads) with cloud speech-to-text and a cloud chat provider.

Create `test/helpers/dictationPreflight.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("isDictationSealed blocks only non-device dictation routes, and only when sealed", async () => {
  const { isDictationSealed } = await import("../../src/lib/sealedMode.ts");
  const { settingsWithRemoteRoutes, settingsWithLocalDictation } = require("../lib/routesFixture");
  assert.equal(isDictationSealed(settingsWithRemoteRoutes(), true), true);
  assert.equal(isDictationSealed(settingsWithLocalDictation(), true), false);
  assert.equal(isDictationSealed(settingsWithRemoteRoutes(), false), false);
  assert.equal(isDictationSealed(settingsWithRemoteRoutes(), null), false);
});

test("startRecording checks the pre-flight before opening the microphone", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../src/helpers/audioManager.js"), "utf8");
  const start = src.indexOf("async startRecording(");
  const body = src.slice(start, src.indexOf("_acquireCaptureStream(", start));
  assert.match(body, /isDictationSealed\(getSettings\(\), getSealedSnapshot\(\)\.sealed\)/);
});
```

`settingsWithLocalDictation()` is the same fixture with the local engine selected (`useLocalWhisper: true`). Add it to the fixture module if Plan 03's fixture lacks it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/lib/sealedMode.test.js test/utils/sealedModeError.test.js test/hooks/useSealedMode.test.js test/lib/routesSealed.test.js test/helpers/dictationPreflight.test.js`
Expected: FAIL. Modules are missing, `sealed` is ignored by `resolveRoutes`, and `startRecording` has no pre-flight.

- [ ] **Step 3: Implement the pure modules**

Create `src/lib/sealedMode.ts`:

```ts
import type { Locality } from "./locality";
import type { ResolvedRoute } from "./routes";
import { resolveRoute, routeSnapshotFromSettings } from "./routes";

// Sealed mode keeps only on-device (loopback) routes. A LAN server is another
// machine, so `network` routes pause too (CCR-1). Unknown (null) never claims.
export function isRouteSealed(route: { locality: Locality }, sealed: boolean | null): boolean {
  return sealed === true && route.locality !== "device";
}

export function applySealToRoute<R extends ResolvedRoute>(route: R, sealed: boolean | null): R {
  if (!isRouteSealed(route, sealed) || route.state.status === "off") return route;
  return { ...route, state: { status: "unreachable", detail: "sealed" } };
}

// The dictation pre-flight: while sealed, a dictation whose speech route would
// leave this computer is not started, so there is no recording for main to refuse.
export function isDictationSealed(settings: Parameters<typeof routeSnapshotFromSettings>[0], sealed: boolean | null): boolean {
  if (sealed !== true) return false;
  return isRouteSealed(resolveRoute(routeSnapshotFromSettings(settings), "dictationStt"), true);
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
  settings: { dataRetentionEnabled: boolean; audioRetentionDays: number }
): string {
  const kept = settings.dataRetentionEnabled && settings.audioRetentionDays > 0;
  const family = sealedPhase(error) === "interrupted" ? "sealedMode.interrupted" : "sealedMode.blocked";
  return `${family}.${kept ? "dictationKept" : "dictationNotKept"}`;
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

Create `src/hooks/useSealedMode.ts`:

```ts
import { useSyncExternalStore } from "react";
import type { Attestation } from "../types/privacy";

export type SealedSnapshot = { sealed: boolean | null; attestation: Attestation | null };

const UNKNOWN: SealedSnapshot = { sealed: null, attestation: null };
let snapshot: SealedSnapshot = UNKNOWN;
const listeners = new Set<() => void>();
let started = false;

function publish(patch: Partial<SealedSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

// Main versions every attestation; an older one (a late IPC reply) never wins.
function adopt(attestation: Attestation | null) {
  if (attestation && snapshot.attestation && attestation.version < snapshot.attestation.version) return;
  publish({ attestation });
}

const privacyApi = () => (typeof window === "undefined" ? undefined : window.electronAPI?.privacy);

// Main is the only source of truth: nothing here guesses the sealed state, and
// a failed read drops to unknown instead of keeping a claim that may be stale.
function start() {
  if (started) return;
  started = true;
  const api = privacyApi();
  if (!api) return;
  api.getSealed().then((sealed) => publish({ sealed }), () => {});
  api.getAttestation().then(adopt, () => publish({ attestation: null }));
  api.onSealedChange((sealed) => publish({ sealed }));
  api.onAttestation(adopt);
}

export function subscribeSealed(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getSealedSnapshot = (): SealedSnapshot => snapshot;

export function useSealedMode(): SealedSnapshot {
  return useSyncExternalStore(subscribeSealed, getSealedSnapshot, () => UNKNOWN);
}

export async function setSealedMode(sealed: boolean): Promise<Attestation & { declined?: boolean }> {
  const result = await window.electronAPI.privacy.setSealed(sealed);
  publish({ sealed: result.sealed });
  adopt(result);
  return result;
}

export function _resetSealedStoreForTests() {
  snapshot = UNKNOWN;
  started = false;
  listeners.clear();
}
```

- [ ] **Step 4: Wire the route graph (CCR-2)**

In `src/lib/routes.ts`:
1. Add `sealed?: boolean` to `RouteSettingsSnapshot`, with the doc comment `/** Sealed mode (Plan 07). Non-device routes report unreachable/sealed. */`.
2. In `resolveRoute`, make `applySealToRoute(route, snapshot.sealed ?? false)` the final transformation before returning. Import it from `./sealedMode`.
3. In `useResolvedRoutes` and `useResolvedRoute`, read `const { sealed } = useSealedMode();` (from `../hooks/useSealedMode`) and pass `sealed: sealed === true` into the snapshot.
4. If Plan 03 did not export one, export `routeSnapshotFromSettings(settings: SettingsState): RouteSettingsSnapshot`. It is the non-React builder the hooks already use internally, which non-React code (the dictation pre-flight) needs.

`sealedMode.ts` and `routes.ts` import each other. The cycle is safe because neither uses the other at module-evaluation time. If the bundler warns, move `isDictationSealed` into `src/lib/dictationPreflight.ts`.

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

   Report it through the same error callback the transcription-failure path uses at `:1915-1922`, using whatever name that path calls. Import `isDictationSealed` from `../lib/sealedMode` and `getSealedSnapshot` from `../hooks/useSealedMode`. Calling `getSealedSnapshot()` starts the store on first use, and before main answers it returns `sealed: null`, which never blocks. Plan 04 restyles this as a pill state (CCR-4) but keeps the check.
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
5. `src/helpers/audioManager.js`, the dictation pipeline `catch` (`:1903-1928`). Directly before the error toast (`:1915`), add:

   ```js
         if (error?.code === "SEALED_MODE") {
           // The same values saveFailedTranscription() decides with (:3111).
           error.messageKey = sealedDictationMessageKey(error, getEffectiveRetentionPreferences());
         }
   ```

   `getEffectiveRetentionPreferences()` is defined at `audioManager.js:130-136`. Import `sealedDictationMessageKey` from `../utils/sealedModeError`. The existing `saveFailedTranscription(...)` call that follows stays: it keeps the recording for retry whenever retention allows.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- test/lib/sealedMode.test.js test/utils/sealedModeError.test.js test/hooks/useSealedMode.test.js test/lib/routesSealed.test.js test/helpers/dictationPreflight.test.js test/helpers/useChatStreamingCancellation.test.js test/helpers/useChatStreamingFlush.test.js && npm run typecheck`
Expected: PASS, and typecheck is clean.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useSealedMode.ts src/lib/sealedMode.ts src/utils/sealedModeError.ts src/components/chat/chatErrorContent.ts src/lib/routes.ts src/components/chat/useChatStreaming.ts src/utils/localInferenceError.ts src/utils/recordingErrors.ts src/helpers/audioManager.js test/lib test/utils/sealedModeError.test.js test/hooks/useSealedMode.test.js test/helpers/dictationPreflight.test.js
git commit -m "feat(privacy): pre-flight sealed dictation, reflect Sealed mode in routes, and keep content with honest copy"
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
- Consumes `useSealedMode` and `setSealedMode` (Task 13), and `Attestation` (Task 7). Uses `contrastRatio` from `src/utils/contrast.ts` and `resolveTokens` from `test/helpers/harness/cssTokens.js` (Plan 01).
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
const attested = { sealed: true, sealedSince: 5, effectiveSince: 7, phase: "sealed", failures: [], loadError: null, saveError: null,
  guards: { node: true, dns: true, dgram: true, http: true, webContents: true, sessions: 2, envProxy: false, openRemoteSockets: 0, chromiumInFlightRemote: 0 },
  networkChildren: [], activeRemote: 0, blockedSinceSealed: 3, recordFailures: 0, version: 1, at: 1, nothingLeaves: true };

test("the verified claim appears only when main attests it", async () => {
  const { sealedStatusLines } = await copy();
  const keys = (s, a) => sealedStatusLines(s, a, time).map((l) => l.key);
  assert.ok(keys(true, attested).includes("settingsPage.privacy.sealed.attested"));
  for (const variant of [
    { ...attested, nothingLeaves: false, networkChildren: ["codex"] },
    { ...attested, nothingLeaves: false, guards: { ...attested.guards, sessions: 0 } },
    { ...attested, nothingLeaves: false, activeRemote: 1 },
  ]) {
    assert.equal(keys(true, variant).includes("settingsPage.privacy.sealed.attested"), false);
  }
  assert.deepEqual(keys(true, null), ["settingsPage.privacy.sealed.on", "settingsPage.privacy.sealed.unverified.pending"]);
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

export type StatusLine = { key: string; params?: Record<string, string | number>; tone: "neutral" | "ok" | "warn" };
const P = "settingsPage.privacy.sealed";

function unverified(a: Attestation | null): StatusLine {
  if (!a) return { key: `${P}.unverified.pending`, tone: "warn" };
  const g = a.guards;
  if (!g.node || !g.dns || !g.dgram || !g.http || !g.webContents || g.sessions === 0)
    return { key: `${P}.unverified.guards`, tone: "warn" };
  if (g.envProxy) return { key: `${P}.unverified.envProxy`, tone: "warn" };
  if (a.networkChildren.length > 0)
    return { key: `${P}.unverified.child`, params: { names: a.networkChildren.join(", ") }, tone: "warn" };
  if (a.phase === "sealing") return { key: `${P}.unverified.stopping`, tone: "warn" };
  return { key: `${P}.unverified.active`, tone: "warn" };
}

// The only place the panel decides what it may claim. The verified line is
// shown solely when main's attestation says so (D6), and it is dated from
// effectiveSince (when main confirmed everything had stopped), never from
// sealedSince (when the switch was flipped).
export function sealedStatusLines(
  sealed: boolean | null,
  attestation: Attestation | null,
  formatTime: (ms: number) => string
): StatusLine[] {
  if (sealed === null) return [{ key: `${P}.unknown`, tone: "neutral" }];
  const lines: StatusLine[] = [];
  if (!sealed) {
    lines.push({ key: `${P}.description`, tone: "neutral" });
  } else {
    lines.push({ key: `${P}.on`, tone: "neutral" });
    if (attestation?.nothingLeaves && attestation.effectiveSince != null)
      lines.push({
        key: `${P}.attested`,
        params: { time: formatTime(attestation.effectiveSince), count: attestation.blockedSinceSealed },
        tone: "ok",
      });
    else lines.push(unverified(attestation));
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
import { setSealedMode, useSealedMode } from "../../hooks/useSealedMode";
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
  "settingsPage.privacy.sealed.title": "Sealed mode",
  "settingsPage.privacy.sealed.description": "Blocks every request that would leave this computer. On-device models keep working.",
  "settingsPage.privacy.sealed.on": "Cloud routes are paused. Local routes keep working. Turn this off to resume them.",
  "settingsPage.privacy.sealed.attested": "Sealed and verified since {{time}}: Loqui's network guards have stopped every outside connection since then. Blocked: {{count}}.",
  "settingsPage.privacy.sealed.unverified.pending": "Checking that nothing can leave this computer…",
  "settingsPage.privacy.sealed.unverified.guards": "Sealed mode is on, but Loqui can't confirm its network guards are active. Restart Loqui.",
  "settingsPage.privacy.sealed.unverified.child": "Sealed mode is on, but {{names}} is still running and may use the network. It stops shortly.",
  "settingsPage.privacy.sealed.unverified.active": "Sealed mode is on. Stopping requests that started before you turned it on.",
  "settingsPage.privacy.sealed.unverified.stopping": "Sealed mode is on, but Loqui could not yet confirm that everything stopped. It keeps checking.",
  "settingsPage.privacy.sealed.unverified.envProxy": "Sealed mode is on, but Loqui was started with a network proxy setting it cannot inspect, so it can't confirm that nothing leaves.",
  "settingsPage.privacy.sealed.loadError": "Loqui couldn't read your Sealed mode setting, so it stayed sealed. Turn it off here if you meant to.",
  "settingsPage.privacy.sealed.saveError": "Sealed mode couldn't be saved. It will be off the next time Loqui starts.",
  "settingsPage.privacy.sealed.unknown": "Sealed mode status is unavailable.",
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
- Test: `test/components/flightRecorderPanel.test.js`

**Interfaces:**
- Consumes `privacy.listEgress`, `egressSummary`, `clearEgress`, `exportEgressCsv`, `onEgress` and `onEgressCleared` (Task 7), and uses `formatBytes` from `src/utils/formatBytes`. **Clear history** is confirmed by main's own dialog (Task 7, `createConfirmations`), so the panel shows no renderer confirm. A compromised renderer therefore cannot wipe the evidence silently.
- Produces:

  ```ts
  // flightRecorderView.ts
  export type TickKind = "sent" | "blocked" | "unexplained";
  export type Tick = { id: number; minute: number; kind: TickKind; event: EgressEvent };
  export function timelineTicks(events: EgressEvent[], now: number): Tick[];   // last 24 h, minute 0..1439
  export function mergeNotice(events: EgressEvent[], notice: EgressNotice, since: number): EgressEvent[];
  export function startOfToday(now: number): number;
  export function bytesCell(n: number | null, format: (n: number) => string): { text: string; unknown: boolean };
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
const ev = (o) => ({ id: 1, ts: now - HOUR, task: "chat", host: "api.groq.com", bytesOut: 3100, bytesIn: 9800, outcome: "ok", status: 200, errorClass: null, model: "gpt-oss-120b", attributed: true, opaque: false, ...o });

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

test("live notices: recorded events are prepended once; sent notices are ignored", async () => {
  const { mergeNotice } = await view();
  const list = [ev({ id: 1 })];
  const next = mergeNotice(list, { phase: "recorded", event: ev({ id: 2, ts: now }) }, 0);
  assert.deepEqual(next.map((e) => e.id), [2, 1]);
  assert.equal(mergeNotice(next, { phase: "recorded", event: ev({ id: 2, ts: now }) }, 0), next);
  assert.equal(mergeNotice(next, { phase: "sent", ticketId: 9, task: "chat", host: "x", payload: "text", correlationId: null, ts: now }, 0), next);
  assert.equal(mergeNotice(next, { phase: "recorded", event: ev({ id: 3, ts: 5 }) }, 10), next, "older than the window");
});

test("the view: counts, hollow blocked ticks, unknown bytes, LTR hosts, unexplained notice", async () => {
  const { FlightRecorderView } = await panel();
  const html = decode(renderStatic(FlightRecorderView, {
    t, now, formatTime: (ms) => `T${ms}`, onExport() {}, onClear() {},
    events: [ev({ id: 1, bytesIn: null }), ev({ id: 2, outcome: "blocked", bytesOut: 0, bytesIn: 0 }), ev({ id: 3, task: "unattributed", host: "x.example.com", attributed: false })],
    summary: { left: 2, blocked: 1, unattributed: 1, unattributedHosts: ["x.example.com"], bytesOut: 3100, bytesIn: 9800, unknownBytes: 1, opaqueSessions: 0 },
  }));
  assert.match(html, /settingsPage\.privacy\.recorder\.leftToday\{"count":2\}/);
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
    summary: { left: 0, blocked: 0, unattributed: 0, unattributedHosts: [], bytesOut: 0, bytesIn: 0, unknownBytes: 0, opaqueSessions: 0 },
  }));
  assert.match(html, /settingsPage\.privacy\.recorder\.empty/);
  assert.match(html, /settingsPage\.privacy\.recorder\.loopbackNote/);
  assert.match(html, /settingsPage\.privacy\.recorder\.bytesNote/);
});

test("an opaque child session says its traffic is not visible, instead of showing bytes", async () => {
  const { FlightRecorderView } = await panel();
  const html = decode(renderStatic(FlightRecorderView, {
    t, now, formatTime: String, onExport() {}, onClear() {},
    events: [ev({ id: 7, task: "codex", host: "chatgpt.com", bytesOut: null, bytesIn: null, opaque: true })],
    summary: { left: 1, blocked: 0, unattributed: 0, unattributedHosts: [], bytesOut: 0, bytesIn: 0, unknownBytes: 0, opaqueSessions: 1 },
  }));
  assert.match(html, /settingsPage\.privacy\.recorder\.opaque/);
  assert.doesNotMatch(html, /settingsPage\.privacy\.recorder\.unknownBytes/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/components/flightRecorderPanel.test.js`
Expected: FAIL with missing modules.

- [ ] **Step 3: View model**

Create `src/components/settings/flightRecorderView.ts`:

```ts
import type { EgressEvent, EgressNotice } from "../../types/privacy";

export type TickKind = "sent" | "blocked" | "unexplained";
export type Tick = { id: number; minute: number; kind: TickKind; event: EgressEvent };
const DAY_MS = 24 * 60 * 60 * 1000;

export function timelineTicks(events: EgressEvent[], now: number): Tick[] {
  const start = now - DAY_MS;
  return events
    .filter((e) => e.ts >= start && e.ts <= now)
    .map((e) => ({
      id: e.id,
      minute: Math.min(1439, Math.floor((e.ts - start) / 60000)),
      kind: e.outcome === "blocked" ? "blocked" : e.attributed ? "sent" : "unexplained",
      event: e,
    }));
}

export function mergeNotice(events: EgressEvent[], notice: EgressNotice, since: number): EgressEvent[] {
  if (notice.phase !== "recorded" || notice.event.ts < since) return events;
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
```

- [ ] **Step 4: Panel**

Create `src/components/settings/FlightRecorderPanel.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EgressEvent, EgressSummary } from "../../types/privacy";
import { formatBytes } from "../../utils/formatBytes";
import { Button } from "../ui/button";
import { bytesCell, mergeNotice, startOfToday, timelineTicks } from "./flightRecorderView";

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
      <div className="flex items-baseline gap-3">
        <span className="text-[28px] font-bold tabular-nums">{summary?.left ?? 0}</span>
        <span className="text-[12px]">
          {t(`${R}.leftToday`, { count: summary?.left ?? 0 })}
          {summary && summary.blocked > 0 && (
            <span className="block text-muted-foreground">{t(`${R}.blockedToday`, { count: summary.blocked })}</span>
          )}
        </span>
      </div>
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
              tick.kind === "unexplained" && "bg-destructive",
              tick.kind === "blocked" && "border border-muted-foreground bg-transparent",
            ]
              .filter(Boolean)
              .join(" ")}
          />
        ))}
      </div>
      {events.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{t(`${R}.empty`)}</p>
      ) : (
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
            {events.map((e) => (
              <tr key={e.id} className="h-8 border-t border-border/60">
                <td>{formatTime(e.ts)}</td>
                <td>{t(`${R}.tasks.${e.task}`)}</td>
                <td>
                  <span dir="ltr" className="font-mono">{e.host}</span>
                </td>
                {e.opaque ? (
                  // A child process's own traffic: Loqui saw the session, not its bytes.
                  <td colSpan={2} className="text-muted-foreground">{t(`${R}.opaque`)}</td>
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
  "settingsPage.privacy.recorder.subtitle": "What left this computer today. Metadata only: no audio, text or keys are stored here.",
  "settingsPage.privacy.recorder.leftToday": "Requests that left this computer today: {{count}}",
  "settingsPage.privacy.recorder.blockedToday": "Blocked by Sealed mode: {{count}}",
  "settingsPage.privacy.recorder.loopbackNote": "Requests to services on this computer, such as local models, are not listed: they never leave it.",
  "settingsPage.privacy.recorder.retention": "Records follow your transcript retention setting. With local history off, they are kept only until Loqui quits.",
  "settingsPage.privacy.recorder.unexplained": "Loqui contacted {{host}} and couldn't match it to a task.",
  "settingsPage.privacy.recorder.empty": "No records to show for today.",
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

**Sealed mode** (Privacy & Data) is enforced in the main process. While it is on, Loqui sends nothing that leaves this computer: provider requests, connection checks, model and runtime downloads, update checks, Codex, calendars and URL imports are all refused before a connection opens, and work already in flight is stopped. Only loopback (`localhost`, `127.0.0.0/8`, `::1`) is reachable, so on-device models keep working. A self-hosted server on another machine on your network is blocked too. Links you open in your browser are your browser's traffic, not Loqui's. If the setting file cannot be read, Loqui stays sealed. Turning Sealed mode off asks for confirmation in a system dialog that the app window cannot answer for you. The panel says Sealed mode is verified only after the main process has confirmed that every request in flight has stopped, its network guards are active, no network-capable helper (Codex, yt-dlp) is running, and no environment proxy is in use. It dates the claim from that moment.

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

### Task 16: Whole-plan verification, including a sealed Electron smoke run

**Files:**
- Modify: `scripts/smoke-electron.cjs`. Add a `LOQUI_SMOKE_SEALED=1` mode.

- [ ] **Step 1: Add the sealed smoke mode**

In `scripts/smoke-electron.cjs`, make three changes:
1. **Bootstrap side**, next to the observer added in Task 6. Record every backstop decision:

   ```js
     globalThis.__whisprSmoke.egress = [];
     require(path.join(repoRoot, "src/helpers/privacy/egressBackstop.js")).addObserver((event) => {
       globalThis.__whisprSmoke.egress.push({ layer: event.layer, host: event.host, allowed: event.allowed });
     });
   ```

2. **Launcher side**, where the profile directory is created and passed as `LOQUI_PROFILE_DIR` (`:167`). Before launching, when `process.env.LOQUI_SMOKE_SEALED === "1"`, write the switch:

   ```js
       if (process.env.LOQUI_SMOKE_SEALED === "1")
         fs.writeFileSync(path.join(profile, "privacy.json"), JSON.stringify({ sealed: true, sealedSince: Date.now() }), { mode: 0o600 });
   ```

3. **Report side.** Where the script reads `globalThis.__whisprSmoke.requests` (`:236`), also read `globalThis.__whisprSmoke.egress`. Add a check after the existing `verify(...)` calls (`:443-456`; the helper is at `:135`):

   ```js
       if (process.env.LOQUI_SMOKE_SEALED === "1")
         verify("sealed: no non-loopback connection was allowed", egress.every((e) => e.allowed === false));
   ```

   The backstop notifies observers only for non-loopback targets, so any `allowed: true` event while sealed is a leak.

- [ ] **Step 2: Run everything**

```bash
npm run native:node
npm test
npm run lint
npm run typecheck
npm run i18n:check
npm run format:check
npm run native:electron
npm run build
LOQUI_SMOKE_SEALED=1 node scripts/smoke-electron.cjs --output-dir /tmp/loqui-smoke-sealed
node scripts/smoke-electron.cjs --output-dir /tmp/loqui-smoke-open
npm run native:node
```

Expected:
- every command passes;
- `/tmp/loqui-smoke-sealed/report.json` shows the sealed check passing;
- the unsealed smoke run still passes its existing checks.

Any pre-existing test that fails because a transport moved (`postMultipart` out of `ipcHandlers.js`, or `proxyFetch` now gated) is updated in this branch only where it asserted the old location. Note each one in the PR description.

- [ ] **Step 3: Manual verification in the desktop app**

Run `npm run dev` with a disposable profile: `LOQUI_PROFILE_DIR=$(mktemp -d)`. Never use your personal profile. Then check each of these, screenshotting each for the PR:
- **Privacy & Data shows Sealed mode first.** Off, it is a normal card. Toggling it on turns the panel navy and shows "Sealed and verified since …" within about two seconds.
- **Turning Sealed mode off.** A system dialog appears. "Keep sealed" leaves the switch on; "Turn off Sealed mode" turns it off.
- **Clear history.** A system dialog shows the record count; "Keep records" deletes nothing.
- **Chat with a cloud provider while sealed.** The reply bubble reads "Chat paused: Sealed mode is on. Your message is kept." The message is still there, and the recorder gains a hollow "Blocked" tick.
- **Seal during a long cloud chat reply.** The bubble reads "Chat stopped: Sealed mode was turned on mid-reply…", not "Chat paused".
- **Press the dictation hotkey with a cloud STT route while sealed.** Nothing records, and "Dictation paused: Sealed mode is on" appears.
- **Seal while a cloud-route dictation is already recording, then stop.** The copy says the provider may have received part of it (when the realtime stream was open), or nothing was sent (batch). With history on, the recording appears in History with Retry, and retrying after unsealing works.
- **Codex.** Sign in to ChatGPT, then seal. The Codex process exits, and the panel becomes verified only after it is gone. The recorder shows one "Session — its traffic is not visible to Loqui" row for that run.
- **Dictate with a local model while sealed.** It works, and nothing is added to the recorder.
- **Start a model download, then seal.** The download stops, the partial file is kept for resume, and the recorder shows "Stopped".
- **Settings › System › Updates while sealed.** It shows "Paused while Sealed mode is on." and "Check now" is disabled.
- **Unseal.** Calendars resume syncing (if connected). The recorder lists the next cloud request with its host and bytes.
- **Export CSV.** Open the file. It has the header row, no URLs and no message text.
- **Theme and direction.** Switch to Plum Night and to an RTL locale (`ar`). The panel remains readable and the hosts render left-to-right.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "test(privacy): add a sealed Electron smoke run"
```

Get the owner's explicit OK before pushing or opening a PR. Publishing a PR is outward-facing, and Task 17 must complete first.

---

### Task 17: Dedicated security review before merge

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

1. Inventory completeness. Grep main.js, src/helpers, src/workers, src/services and preload.js for every transport: fetch, net.fetch/net.request, http(s).request/get, http2, tls.connect, net.connect, dgram, WebSocket/ws, EventSource, child_process spawn/exec/fork of network-capable binaries, utilityProcess.fork, worker_threads, session.fetch, webContents.downloadURL, BrowserWindow.loadURL with remote URLs, shell.openExternal. Every hit is in the threat model inventory with a decision.
2. Layer B coverage. Confirm in a packaged build (or `npm run dev`) that: undici fetch, https.request, ws, AWS SDK and Tinfoil SDK connections all pass through net.Socket.prototype.connect; electron-updater's partition session is watched (session-created fires for it); renderer image loads in rendered markdown are cancelled while sealed; nothing else calls webRequest.onBeforeRequest.
3. Bypass attempts. Hostnames that resolve to loopback, IPv6 forms, IPv4-mapped IPv6, decimal/octal IP spellings, trailing dots, uppercase, `localhost.` vs `localhost.example`, a custom `lookup` for `localhost`; proxies — the CONNECT/absolute-form refusal, `NODE_USE_ENV_PROXY`, a PAC/WPAD fetch by Chromium, and any library that tunnels through a loopback proxy without CONNECT (e.g. SOCKS).
4. Child processes. Codex app-server is killed on seal and never spawned while sealed; yt-dlp downloads are killed and self-update skipped; llama-server/whisper-server/parakeet/qdrant are started with loopback-only binds and no download flags (e.g. llama.cpp `-hf`, `--model-url`); the ONNX utility process has no network code.
5. Transition races. Toggle sealed rapidly; seal during: chat stream, realtime STT, model download, update download, URL import, Codex turn, calendar OAuth. Check attestation.nothingLeaves only becomes true after everything is stopped, and that no request authorised before the seal completes a new connection after it.
6. Fail-closed state. Corrupt/unreadable/unwritable privacy.json; isSealed throwing; boot order (guards installed before any helper require; before app ready).
7. IPC. Only the main frame of the main window or control panel, showing Loqui's own page, can set-sealed or clear/export the ledger; argument validation; main's native confirmation for unseal and clear; the control panel is now sandboxed with web security on (Task 7a) — confirm nothing regressed and no window still relaxes either.
8. Ledger privacy. No content, prompts, keys, URL paths/queries or error messages can reach egress_events or the CSV; CSV formula injection; retention and the local-history-off path never write to disk; Clear deletes rows.
9. Honest UI. The verified Sealed-mode line, the "nothing was sent" copy (refusals only, never interruptions), the route "Paused" states and the cancel copy (Plan 04 CCR-3, `sent` notices with correlation ids) can only appear from main's attestation and notices.
10. Chromium speculative networking (DNS prefetch/preconnect) while sealed, despite `x-dns-prefetch-control: off`: observe with a packet capture or `chrome://net-export` in a sealed dev session with chat answers containing links and images; recommend a switch if leaks are seen. Also confirm the WebRTC policy reaches every webContents (including the pill and notification windows).
11. Attestation honesty. Try to make the panel show "verified" while something can still send: a stalled response body, a warm realtime socket, a Codex start in progress, a yt-dlp update, an unread `guardResponse` body, an env proxy.

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

Fix each critical and high finding in its owning task's files, with a test that pins it. Re-run the full Task 16 suite, then send the reviewer the fix diff for a focused re-review. Repeat until no critical or high finding remains open.

- [ ] **Step 4: Commit and hand off**

```bash
git add docs/security/sealed-mode-review-2026-10.md
git commit -m "docs(security): record the Sealed mode pre-merge review"
```

Do not merge until the owner has filled in the sign-off.

---

## Open questions for the owner

The owner answered three questions on 2026-10-15, and they are built into this plan:
- harden the control panel and confirm unsealing in main's own dialog (Tasks 7 and 7a);
- record Codex and yt-dlp as opaque sessions (Tasks 4, 8 and 10);
- ship the dictation pre-flight in Plan 07 (Task 13).

Codex's plan review recommends the defaults below for questions 1–3 and 6–7. Plan 07 already follows them.

1. **LAN servers while sealed.** This plan blocks `network` locality (a self-hosted server on another machine) as well as `remote`, because audio sent to it leaves this computer (CCR-1). Should LAN stay allowed instead?
2. **Downloads and updates "you start."** The showcase copy for R6 C said "Block all network except model downloads and updates you start." D6 says main blocks model downloads. This plan follows D6 and also refuses manual update checks while sealed, so "sealed" has one meaning. Confirm, or name the exceptions.
3. **Recorder retention.** The ledger follows `transcriptRetentionDays`; "Forever" is capped at 100,000 rows, and with local history off it is memory-only. The research proposed a fixed 30-day roll. Which do you want?
4. **A recording made before sealing, with local history off.** When Sealed mode is turned on during a cloud-route recording, the transcription is refused or interrupted when the recording stops. With history off, the recording is not kept, and the copy says so. Should Loqui hold it in memory (never on disk) for a "Transcribe after unsealing" action? That needs a notice action from Plan 04.
5. **Legacy network-capable IPC channels.** Ten channels have no UI caller, but are reachable from any renderer through preload:
   - `process-anthropic-reasoning`, `process-enterprise-reasoning`, `enterprise-stream-start` and `bedrock-list-models`;
   - `test-provider-connection` and `test-enterprise-connection`;
   - `proxy-{xai,mistral,gemini,corti,tinfoil}-transcription`.

   This plan gates them and tests them through their real handlers. Codex recommends removing the unused preload bridges and handlers together, in a follow-up. Should we?
6. **Browser links while sealed.** `shell.openExternal` still opens links in your browser. That is your browser's traffic, not Loqui's. Codex recommends requiring an explicit click, and saying the link opens outside Sealed mode. Should Loqui confirm before opening links while sealed?
7. **A quick toggle.** Should Sealed mode also be available from the tray menu or the pill? This plan ships it in Settings only.
