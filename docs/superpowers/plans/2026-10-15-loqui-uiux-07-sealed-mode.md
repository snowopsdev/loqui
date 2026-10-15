# Loqui UI/UX Plan 07: Sealed Mode and Data Flight Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two things:
- **Sealed mode** (SET-R6 C), a master switch that Electron main enforces. While it is on, nothing Loqui does leaves this computer, and local routes keep working.
- **Data flight recorder** (SET-M3), a metadata-only ledger of every request that did leave: when, which task, which host, how many bytes, and the outcome.

**Architecture:** Enforcement lives in main and has two layers.

- **Layer A, the egress gate** (`src/helpers/privacy/egressGate.js`). Every known request site asks it for a *ticket* before sending. While sealed, a non-loopback ticket is refused with a typed `SealedModeError`. The refusal is recorded with 0 bytes sent, and the caller keeps the user's content. Tickets carry the task, so the ledger knows why each request happened.
- **Layer B, the transport backstop** (`src/helpers/privacy/egressBackstop.js`). It catches anything Layer A missed:
  - On the Node side it hooks `net.Socket.prototype.connect` and `dns.lookup`. That covers `http`, `https`, undici `fetch`, `ws` and the provider SDKs.
  - On the Chromium side it owns `webRequest.onBeforeRequest` on every Electron session, which covers `net.fetch`, `net.request`, `electron-updater` and renderer loads.
  - While sealed, Layer B denies every non-loopback connection. While unsealed, it reports connections that no ticket explains, which surface as "unexplained" in the ledger.

Child processes that make their own connections (the Codex app-server and yt-dlp) are refused at spawn and killed on seal. Main *attests* the sealed state with an `Attestation` object. The UI may say "nothing has left this computer" only when `attestation.nothingLeaves === true`.

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
  setSealed(sealed: boolean): Promise<Attestation>;  // resolves after main has finished severing connections
  getAttestation(): Promise<Attestation>;
  listEgress(options?: { since?: number; limit?: number }): Promise<EgressEvent[]>;
  egressSummary(options?: { since?: number }): Promise<EgressSummary>;
  clearEgress(): Promise<boolean>;
  exportEgressCsv(): Promise<{ saved: boolean }>;
  onEgress(cb: (notice: EgressNotice) => void): () => void;
  onEgressCleared(cb: () => void): () => void;
  ```

  The types are declared in `src/types/privacy.ts` (Task 7).
- **Semantics.**
  - `getSealed()` resolves `true` when the persisted setting is unreadable. Sealed mode fails closed.
  - `onSealedChange` fires only after main has applied the change: in-flight remote work is aborted and open remote sockets are destroyed.

**CCR-2 (§5.1, owner Plan 03).**
- `RouteSettingsSnapshot` gains `sealed: boolean`, defaulting to `false`.
- `resolveRoute` applies `applySealToRoute(route, snapshot.sealed)` from `src/lib/sealedMode.ts` (Plan 07) as its last step.
- `useResolvedRoutes` / `useResolvedRoute` read `useSealedMode()` from `src/hooks/useSealedMode.ts` (Plan 07).
- If Plan 03 merged without this, Plan 07 Task 13 adds it. Keep the module boundaries as stated so both plans agree.

**CCR-3 (§5.2, owner Plan 04).**
- Derive `remoteAlreadySent` from main, not from route locality. Set it to the provider display name only when `privacy.onEgress` delivered a `{ phase: "started" }` notice for a non-loopback ticket of the dictation pipeline's task (`dictationStt`, `dictationCleanup`, `voiceAssistant`, `assistantVision`, or `translation`), with `ts` at or after the recording's stop time.
- Rationale:
  - The cancel copy "OpenAI already received the audio" is a claim about egress, so main must attest it (D6).
  - It also keeps the cancel copy and the flight recorder from disagreeing. A cancelled in-flight request is recorded by main with outcome `cancelled` (Task 9).

**CCR-4 (§5.4 consumer, owner Plan 04).**
- Add a dictation pre-flight. When `useSealedMode()` is `true` and the dictation STT route is not `device`, the hotkey does not start a recording. Instead the pill shows "Dictation paused: Sealed mode is on" (`sealedMode.blocked.dictationPreflight`, added by Task 14).
- Use `isRouteSealed(route, sealed)` from `src/lib/sealedMode.ts`.
- Rationale: main's block happens *after* recording. With local history off, a blocked recording cannot be kept (Task 13, Step 5), so preventing the recording is the content-preserving path.

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
   - The ledger shows the request as `cancelled` with error class `SEALED_MODE`, and the attestation reports `nothingLeaves: true` once severing finishes.
   - Pinned in:
     - Task 5 (`abortAllRemote aborts in-flight remote tickets with SealedModeError`);
     - Task 6 (`severAll destroys open remote sockets`);
     - Task 8 (`sealing mid-stream rejects with SealedModeError, not a timeout`);
     - Task 10 (`sealing aborts an in-flight download`).
2. **A damaged or unwritable `privacy.json`.** A truncated file, a non-boolean `sealed`, or a read-only profile must never silently unseal.
   - An unreadable or corrupt file loads as sealed, with `loadError` set.
   - A failed save while sealing keeps the app sealed for this session and surfaces `saveError`, so the UI can warn that it will be off after restart.
   - Pinned in Task 3.
3. **Self-hosted endpoints spelled in unusual ways.** These stay allowed while sealed:
   - `http://localhost:11434/v1`, `http://LOCALHOST.:8080`, `http://[::1]:8080`, `http://127.0.0.2:9000` and `http://[::ffff:127.0.0.1]/`.

   These are blocked:
   - `http://192.168.1.5:8080`, `http://localhost.evil.example`, `http://127.0.0.1.nip.io` and `http://0.0.0.0:8080`;
   - an empty or garbage URL.

   Pinned in Task 2 (`loopback classification`).
4. **Hostile values reaching the ledger.** A model id with a comma, newline or leading `=` must not break or inject into the CSV export. A target containing userinfo, a path or a query must be stored as a bare host. Error messages from providers, which may echo content, are never stored. Pinned in Task 4 (`CSV export neutralises formulas and quotes`, `record rejects non-host values`) and Task 5 (`settle stores an error class, never a message`).
5. **Sealed at launch, with a calendar connected and an update check due.**
   - Expected: no non-loopback connection from boot. Calendar sync does not start, and the automatic update check is skipped without advancing `lastCheck`.
   - Turning sealed off starts calendar sync and lets the next hourly tick check for updates.
   - Pinned in:
     - Task 10 (`automatic check is skipped while sealed and lastCheck is unchanged`);
     - Task 11 (`seal transition stops and restarts calendar sync`);
     - Task 7 (`main boots the egress guards before any helper is required and guards calendar start`);
     - Task 16, which runs the Electron smoke test sealed.

---

## File structure

**Create (main process, CommonJS):**
- `src/helpers/privacy/egressPolicy.js`: pure. Task ids, host classification, the allow/deny decision and `SealedModeError`.
- `src/helpers/privacy/sealedState.js`: the persisted switch in `<userData>/privacy.json`, which fails closed.
- `src/helpers/privacy/flightRecorder.js`: the ledger store (SQLite or memory), summary, prune and CSV.
- `src/helpers/privacy/egressGate.js`: Layer A. Tickets, task context (`AsyncLocalStorage`), metering, abort-on-seal and counters.
- `src/helpers/privacy/egressBackstop.js`: Layer B. Node socket and DNS hooks, the Chromium session watcher, sever-all and observers.
- `src/helpers/privacy/privacyBoot.js`: boot order, seal transitions and the attestor.
- `src/helpers/privacy/privacyIPC.js`: the `privacy:*` IPC channels and broadcasts.
- `src/helpers/privacy/providerEndpoints.js`: the destination of each named provider.
- `src/helpers/privacy/gatedFetch.js`: `gatedNetFetch` (Electron `net`) and `gatedNodeFetch` (Node `fetch`), both gated and metered.
- `src/helpers/sttTransport.js`: `buildMultipartBody`, `postMultipart` and `gatedNetFetch`, moved out of `ipcHandlers.js` and gated.

**Create (renderer, TypeScript):**
- `src/types/privacy.ts`: `PrivacyAPI`, `Attestation`, `EgressEvent`, `EgressSummary`, `EgressNotice` and `EgressTask`.
- `src/hooks/useSealedMode.ts`: the sealed flag and attestation as an external store.
- `src/lib/sealedMode.ts`: `applySealToRoute`, `isRouteSealed`.
- `src/utils/sealedModeError.ts`: `isSealedModeError`, `sealedDictationMessageKey`.
- `src/components/chat/chatErrorContent.ts`: the assistant bubble's failure text, including the sealed copy.
- `src/components/settings/SealedModePanel.tsx` and `src/components/settings/sealedModeCopy.ts`: the master switch, and the only place that decides what the panel may claim.
- `src/components/settings/FlightRecorderPanel.tsx` and `src/components/settings/flightRecorderView.ts`: the ledger view and its pure view model.

**Create (docs):** `docs/security/sealed-mode-threat-model.md` (Task 1) and `docs/security/sealed-mode-review-2026-10.md` (Task 17).

**Modify:**
- Main process: `main.js`, `preload.js`, `src/helpers/localDatabaseSchema.js`, `src/helpers/ipcHandlers.js`, `src/helpers/personalInference.js`, `src/helpers/providerConnectionTest.js` (rethrows sealed errors; gated at its IPC call site), `src/helpers/tinfoilCatalog.js`, `src/helpers/geminiTranscription.js`, `src/helpers/cortiAuth.js`, `src/helpers/cortiTranscription.js`, `src/helpers/tinfoilTranscription.js`, `src/helpers/downloadUtils.js`, `src/helpers/gpuBinaryManager.js`, `src/helpers/urlAudioDownloader.js`, `src/helpers/updateManager.js`, `src/helpers/updateIPC.js`, `src/helpers/googleCalendarOAuth.js`, `src/helpers/googleCalendarManager.js`, `src/helpers/microsoftCalendarOAuth.js` and `src/helpers/microsoftCalendarManager.js`.
- Renderer: `src/types/electron.ts`, `src/types/updates.ts`, `src/lib/routes.ts` (CCR-2), `src/components/SettingsPage.tsx`, `src/components/chat/useChatStreaming.ts`, `src/utils/localInferenceError.ts`, `src/utils/recordingErrors.ts`, `src/helpers/audioManager.js` (renderer code) and `src/index.css`.
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
3. **In-flight work when the switch flips.** Mitigation: `abortAllRemote()`, `severAll()` (destroys open remote sockets and calls `session.closeAllConnections()`), cancelling the update download, and stopping the Codex app-server.
4. **A child process with its own network stack** (the Codex app-server and yt-dlp). Main's hooks cannot see these. Mitigation: refuse to spawn while sealed, kill on seal, and report them as `networkChildren` in the attestation, so `nothingLeaves` is false while one is alive.
5. **A compromised or buggy renderer flips the switch off.** Mitigation: `privacy:set-sealed` accepts only a boolean, and only from the main window or the control panel `webContents`. Residual: a compromised control panel can unseal. The control panel runs with `sandbox: false` and `webSecurity: false` (`windowConfig.js:223-237`); see Open questions in the plan.
6. **A corrupt or unwritable settings file.** Mitigation: an unreadable file means sealed (fail closed), and a failed save is surfaced as `saveError`.
7. **A utility process or worker** (`utilityProcess.fork`, `worker_threads`). Each has its own Node runtime, so the main-process hooks do not apply inside it. Mitigation: `src/workers` is in the ratchet's scan roots, so a network primitive added there fails the test until it is inventoried. Today the only one is the ONNX worker (N23), and it has no network code.
8. **The ledger leaking content.** Mitigation: the schema has no content column, `record()` rejects anything that is not a bare hostname, and error *messages* are never stored, only codes and classes.

## Out of scope (documented residual risk)

- **The OS browser.** `shell.openExternal` (`externalUrlOpener.js:35`) opens links in the user's browser. Navigation there is the browser's egress, not Loqui's, so it is allowed while sealed.
- **OS services.** These are DNS-over-HTTPS settings, iCloud calendar sync for Apple Calendar (EventKit is local to Loqui), and OS update checks.
- **Chromium speculative networking.** Chromium may speculatively resolve or preconnect hosts named in rendered markdown; `webRequest` does not see DNS prefetch. Task 17 reviews this.
- **A malicious local process** that reads the Loqui profile.

## Enforcement layers

| Layer | Where | Sees | Action while sealed |
|---|---|---|---|
| A, gate | `src/helpers/privacy/egressGate.js`, called at each site below | every known request, with its task | throws `SealedModeError` before any socket opens and records `blocked`, 0 bytes |
| B, Node | `net.Socket.prototype.connect` and `dns.lookup` hooks in `egressBackstop.js` | every Node TCP/TLS connection (`http`, `https`, undici `fetch`, `ws`, AWS SDK, Tinfoil SDK) | destroys the socket with `SealedModeError`, before DNS |
| B, Chromium | `session.webRequest.onBeforeRequest` on every session (`app.on("session-created")` plus `defaultSession`) | Electron `net.fetch`/`net.request`, `electron-updater` (own partition), renderer loads | `callback({ cancel: true })` |
| spawn | `codexAppServer` start and `urlAudioDownloader` | child processes with their own network | not spawned; running ones are killed on seal |

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
| N15 | yt-dlp self-update | `urlAudioDownloader.js:390 maybeUpdateYtDlp` | child process | blocked | spawn | none (skipped silently) |
| N16 | App update check and download (auto and manual) | `updateManager.js:124 check`, `:143`, `:156` | electron-updater (own session) | blocked | A+B | `appUpdate` |
| N17 | Codex CLI verification | `codexCli.js:309 verifyOfficialCodex` | Node fetch | blocked | A+B | `codex` |
| N18 | Codex app-server (ChatGPT) | `codexAppServer.js:116 start`, `:396 generate` | child process | blocked | A+spawn | `codex` |
| N19 | Calendar OAuth and API (Google, Microsoft) | `googleCalendarOAuth.js:152`, `googleCalendarManager.js:357`, `microsoftCalendarOAuth.js:155, 168`, `microsoftCalendarManager.js:396` | Electron net | blocked | A+B | `calendar` |
| N20 | Calendar background, focus and wake sync | `calendarSyncInterval.js`; `main.js:566-567, 781-794` | Electron net | blocked | A+B | `calendar` (stopped while sealed) |
| N21 | Browser launch | `externalUrlOpener.js:69` (`shell.openExternal` in `openExternalUrl`, `:35`) | OS browser | allowed: OS browser | n/a | none |
| N22 | Loopback sidecars and the dev server (llama-server, whisper-server, Qdrant, Parakeet WS, OAuth loopback page, CLI bridge, Vite) | `llamaServer.js`, `whisperServer.js`, `qdrantManager.js`, `parakeetWsServer.js`, `oauthLoopbackFlow.js`, `cliBridge.js`, `devServerManager.js` | Node http / ws on 127.0.0.1 | allowed: loopback | B | none (loopback is never recorded) |
| N23 | ONNX utility process (local embeddings/diarization) | `onnxWorkerClient.js:59` `utilityProcess.fork` → `src/workers/onnxWorker.js` (fs, os, path, onnxruntime-node only) | none | n/a: no network | n/a | none |

Not reachable from the renderer, but still gated: `process-anthropic-reasoning`, `process-enterprise-reasoning`, `enterprise-stream-start`, `bedrock-list-models`, `test-provider-connection`, `test-enterprise-connection`, and the `proxy-{xai,mistral,gemini,corti,tinfoil}-transcription` channels. Dead code with no caller: `whisper.js:482 transcribeViaLan` and `whisperServer.js:454 connectRemote`. Layer B still covers both.

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
  - `class SealedModeError extends Error`, with `{ code: "SEALED_MODE", messageKey: "sealedMode.blocked.generic", details: { task, host } }`. Its message contains `[SEALED_MODE]`.
  - `isSealedModeError(error: unknown): boolean`. It checks `code`, the message marker, and up to three levels of `cause`.

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
  assert.deepEqual(error.details, { task: "chat", host: "api.groq.com" });
  assert.match(error.message, /\[SEALED_MODE\]/);
  // ipcMain.handle keeps only the message of a rejected promise.
  assert.equal(policy.isSealedModeError(new Error(`Error invoking remote method: ${error.message}`)), true);
  // undici wraps connect errors as TypeError("fetch failed", { cause }).
  assert.equal(policy.isSealedModeError(new TypeError("fetch failed", { cause: error })), true);
  assert.equal(policy.isSealedModeError(new Error("ECONNREFUSED")), false);
  assert.equal(policy.isSealedModeError(null), false);
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
// address you send to, and a name that merely resolves to 127.0.0.1 is not
// trusted because DNS is outside our control.
function isLoopbackHost(value) {
  const host = normalizeHost(value ?? "");
  if (!host) return false;
  if (host === "localhost") return true;
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
  constructor({ task, host }) {
    // ipcMain.handle keeps only the message of a rejected promise (see the
    // serializeIpcError comment in ipcHandlers.js), so the code is also in the
    // text and isSealedModeError() can recognise it on the renderer side.
    super(`[${SEALED_MODE}] Sealed mode is on, so ${task} to ${host} was blocked before anything was sent.`);
    this.name = "SealedModeError";
    this.code = SEALED_MODE;
    this.messageKey = "sealedMode.blocked.generic";
    this.details = { task, host };
  }
}

function isSealedModeError(error, depth = 0) {
  if (!error || depth > 3) return false;
  if (error.code === SEALED_MODE) return true;
  if (typeof error.message === "string" && error.message.includes(`[${SEALED_MODE}]`)) return true;
  return isSealedModeError(error.cause, depth + 1);
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
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/helpers/egressPolicy.test.js`
Expected: PASS (6 tests).

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
- Modify: `src/helpers/localDatabaseSchema.js`. Add the `egress_events` table and index directly after line 315 (`CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics_events(local_date);`).
- Test: `test/helpers/flightRecorder.test.js`. It must contain `require("./harness/db")`; see Global Constraints.

**Interfaces:**
- Produces `class FlightRecorder extends EventEmitter`:
  - `new FlightRecorder({ db?: BetterSqlite3.Database | null, now?: () => number })`. It starts **memory-only**, and `persisting` is `false`.
  - `attachDatabase(db)`. Keeps the handle; writes nothing yet.
  - `setPersistence(enabled: boolean)`. When it is `true` and a database is attached, the in-memory rows are flushed to SQLite and later rows are written there. When it is `false`, nothing more is written to disk. Main calls it on every retention sync with `dataRetentionEnabled`.
  - `record(event: EgressEventInput): EgressEvent`. It throws `TypeError` for an unknown task or outcome, or for a host that is not bare, and it emits `"event"`.
  - `list({ since?: number, limit?: number }): EgressEvent[]`. Newest first; the limit is clamped to 1..`MAX_ROWS`.
  - `summary({ since?: number }): { left, blocked, unattributed, unattributedHosts, bytesOut, bytesIn, unknownBytes }`.
  - `clear(): void`. Emits `"cleared"`.
  - `prune({ retentionDays: number, maxRows?: number }): { deleted: number }`.
- Also produces `toCsv(events: EgressEvent[]): string`, `MAX_ROWS = 100000` and `MEMORY_LIMIT = 500`.
- Types:
  - `EgressEventInput` is `{ ts?, task, host, bytesOut?, bytesIn?, outcome: "ok"|"error"|"blocked"|"cancelled", status?, errorClass?, model?, attributed? }`.
  - `EgressEvent` is the same, with `id`, and with every optional field normalised to a value or `null` (`attributed: boolean`).

- [ ] **Step 1: Write the failing test**

Create `test/helpers/flightRecorder.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { createDb } = require("./harness/db");
const { FlightRecorder, toCsv, MEMORY_LIMIT } = require("../../src/helpers/privacy/flightRecorder");

const DAY = 24 * 60 * 60 * 1000;
const base = { task: "chat", host: "api.groq.com", outcome: "ok", bytesOut: 3100, bytesIn: 9800 };

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
    "id", "ts", "task", "host", "bytes_out", "bytes_in", "outcome", "status", "error_class", "model", "attributed",
  ]);
});

test("record and list: newest first, normalised public shape", (t) => {
  let clock = 1000;
  const ctx = persistent(t, () => clock);
  if (!ctx) return;
  ctx.recorder.record(base);
  clock = 2000;
  ctx.recorder.record({ ...base, task: "dictationStt", host: "api.openai.com", bytesIn: undefined, status: 200 });
  const rows = ctx.recorder.list();
  assert.equal(rows.length, 2);
  assert.deepEqual(
    { ...rows[0], id: 0 },
    { id: 0, ts: 2000, task: "dictationStt", host: "api.openai.com", bytesOut: 3100, bytesIn: null, outcome: "ok", status: 200, errorClass: null, model: null, attributed: true }
  );
  assert.equal(rows[1].task, "chat");
});

test("record rejects non-host values and unknown enums", () => {
  const recorder = new FlightRecorder();
  for (const host of ["https://api.openai.com/v1", "api.openai.com/v1", "user@host", "a host", "host?q=1", ""]) {
    assert.throws(() => recorder.record({ ...base, host }), TypeError, host);
  }
  assert.throws(() => recorder.record({ ...base, task: "telemetry" }), TypeError);
  assert.throws(() => recorder.record({ ...base, outcome: "maybe" }), TypeError);
});

test("bytes: unknown stays null, never 0; negatives are unknown", () => {
  const recorder = new FlightRecorder();
  const row = recorder.record({ ...base, bytesOut: undefined, bytesIn: -5 });
  assert.equal(row.bytesOut, null);
  assert.equal(row.bytesIn, null);
  assert.equal(recorder.record({ ...base, outcome: "blocked", bytesOut: 0, bytesIn: 0 }).bytesOut, 0);
});

test("model ids are stripped of control characters and truncated", () => {
  const recorder = new FlightRecorder();
  const row = recorder.record({ ...base, model: "gpt\n-4o\u0000" + "x".repeat(200) });
  assert.equal(row.model.includes("\n"), false);
  assert.equal(row.model.length, 120);
});

test("memory-only until persistence is enabled; then memory rows are flushed", (t) => {
  const manager = createDb(t);
  if (!manager) return;
  const recorder = new FlightRecorder({ now: () => 5 });
  recorder.attachDatabase(manager.db);
  recorder.record(base);
  assert.equal(manager.db.prepare("SELECT COUNT(*) AS n FROM egress_events").get().n, 0);
  assert.equal(recorder.list().length, 1);
  recorder.setPersistence(true);
  assert.equal(manager.db.prepare("SELECT COUNT(*) AS n FROM egress_events").get().n, 1);
  assert.equal(recorder.list().length, 1, "no duplicate after the flush");
  recorder.setPersistence(false);
  recorder.record(base);
  assert.equal(manager.db.prepare("SELECT COUNT(*) AS n FROM egress_events").get().n, 1);
  assert.equal(recorder.list().length, 2);
});

test("memory mode keeps only the newest MEMORY_LIMIT rows", () => {
  const recorder = new FlightRecorder();
  for (let i = 0; i < MEMORY_LIMIT + 10; i++) recorder.record({ ...base, ts: i });
  const rows = recorder.list({ limit: 100000 });
  assert.equal(rows.length, MEMORY_LIMIT);
  assert.equal(rows[0].ts, MEMORY_LIMIT + 9);
});

test("prune deletes rows older than retentionDays and caps the table", (t) => {
  let clock = 100 * DAY;
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

test("summary counts what left, what was blocked, and unexplained hosts", () => {
  const recorder = new FlightRecorder();
  recorder.record(base);
  recorder.record({ ...base, bytesOut: null });
  recorder.record({ ...base, outcome: "blocked", bytesOut: 0, bytesIn: 0 });
  recorder.record({ task: "unattributed", host: "x.example.com", outcome: "ok", attributed: false });
  assert.deepEqual(recorder.summary({ since: 0 }), {
    left: 3, blocked: 1, unattributed: 1, unattributedHosts: ["x.example.com"],
    bytesOut: 3100, bytesIn: 19600, unknownBytes: 2,
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
    { id: 1, ts: Date.UTC(2026, 9, 15, 9, 12), task: "chat", host: "api.groq.com", bytesOut: 3100, bytesIn: null, outcome: "ok", status: 200, errorClass: null, model: '=HYPERLINK("x"),"a"', attributed: true },
  ]);
  const [header, line] = csv.trim().split("\n");
  assert.equal(header, "time_utc,task,host,bytes_sent,bytes_received,outcome,status,error_class,model,attributed");
  assert.equal(line, '2026-10-15T09:12:00.000Z,chat,api.groq.com,3100,,ok,200,,"\'=HYPERLINK(""x""),""a""",yes');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run native:node && npm test -- test/helpers/flightRecorder.test.js`
Expected: FAIL with `Cannot find module '../../src/helpers/privacy/flightRecorder'`.

- [ ] **Step 3: Add the table**

In `src/helpers/localDatabaseSchema.js`, insert after line 315:

```sql
-- Flight recorder (Plan 07). Metadata about requests that left this computer:
-- never content, prompts, keys, URL paths/queries or error messages.
CREATE TABLE IF NOT EXISTS egress_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  task TEXT NOT NULL,
  host TEXT NOT NULL,
  bytes_out INTEGER,
  bytes_in INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'error', 'blocked', 'cancelled')),
  status INTEGER,
  error_class TEXT,
  model TEXT,
  attributed INTEGER NOT NULL DEFAULT 1
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
const DAY_MS = 24 * 60 * 60 * 1000;
const OUTCOMES = new Set(["ok", "error", "blocked", "cancelled"]);
// A bare hostname, IPv4 or IPv6 literal, or the literal "unknown". Anything
// with a path, query, userinfo or whitespace is refused so a URL can never be
// stored by mistake.
const BARE_HOST = /^[a-z0-9._:-]{1,253}$/;

const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
const text = (v, max) => {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return s ? s.slice(0, max) : null;
};

function toPublic(row) {
  return {
    id: row.id,
    ts: row.ts,
    task: row.task,
    host: row.host,
    bytesOut: row.bytes_out,
    bytesIn: row.bytes_in,
    outcome: row.outcome,
    status: row.status,
    errorClass: row.error_class,
    model: row.model,
    attributed: row.attributed === 1,
  };
}

class FlightRecorder extends EventEmitter {
  constructor({ db = null, now = Date.now } = {}) {
    super();
    this.now = now;
    this.db = null;
    this.persisting = false;
    this.memory = [];
    this.nextMemoryId = -1;
    if (db) this.attachDatabase(db);
  }

  attachDatabase(db) {
    this.db = db;
    this.insert = db.prepare(
      `INSERT INTO egress_events (ts, task, host, bytes_out, bytes_in, outcome, status, error_class, model, attributed)
       VALUES (@ts, @task, @host, @bytes_out, @bytes_in, @outcome, @status, @error_class, @model, @attributed)`
    );
  }

  // Off until main hears the renderer's retention settings (the same caution
  // as _retentionSettingsSynced in ipcHandlers.js): a user with local history
  // off must never get rows on disk.
  setPersistence(enabled) {
    if (enabled && this.db) {
      const pending = this.memory;
      this.memory = [];
      this.db.transaction(() => {
        for (const { id: _id, ...row } of pending) this.insert.run(row);
      })();
      this.persisting = true;
    } else {
      this.persisting = false;
    }
  }

  normalize(event) {
    if (!EGRESS_TASKS.includes(event?.task)) throw new TypeError(`Unknown egress task: ${event?.task}`);
    if (!OUTCOMES.has(event.outcome)) throw new TypeError(`Unknown egress outcome: ${event.outcome}`);
    const host = typeof event.host === "string" ? event.host.trim().toLowerCase() : "";
    if (!BARE_HOST.test(host)) throw new TypeError("Egress host must be a bare hostname");
    return {
      ts: count(event.ts) ?? this.now(),
      task: event.task,
      host,
      bytes_out: count(event.bytesOut),
      bytes_in: count(event.bytesIn),
      outcome: event.outcome,
      status: Number.isInteger(event.status) ? event.status : null,
      error_class: text(event.errorClass, 64),
      model: text(event.model, 120),
      attributed: event.attributed === false ? 0 : 1,
    };
  }

  record(event) {
    const row = this.normalize(event);
    let id;
    if (this.persisting) {
      id = Number(this.insert.run(row).lastInsertRowid);
    } else {
      id = this.nextMemoryId--;
      this.memory.push({ id, ...row });
      if (this.memory.length > MEMORY_LIMIT) this.memory.splice(0, this.memory.length - MEMORY_LIMIT);
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
    const unexplained = rows.filter((r) => !r.attributed);
    const sum = (key) => left.reduce((n, r) => n + (r[key] ?? 0), 0);
    return {
      left: left.length,
      blocked: rows.length - left.length,
      unattributed: unexplained.length,
      unattributedHosts: [...new Set(unexplained.map((r) => r.host))],
      bytesOut: sum("bytesOut"),
      bytesIn: sum("bytesIn"),
      unknownBytes: left.filter((r) => r.bytesOut == null).length,
    };
  }

  clear() {
    if (this.db) this.db.prepare("DELETE FROM egress_events").run();
    this.memory = [];
    this.emit("cleared");
  }

  prune({ retentionDays, maxRows = MAX_ROWS } = {}) {
    const cutoff = Number.isFinite(retentionDays) && retentionDays > 0 ? this.now() - retentionDays * DAY_MS : null;
    if (cutoff !== null) this.memory = this.memory.filter((r) => r.ts >= cutoff);
    if (!this.db) return { deleted: 0 };
    let deleted = 0;
    if (cutoff !== null) deleted += this.db.prepare("DELETE FROM egress_events WHERE ts < ?").run(cutoff).changes;
    deleted += this.db
      .prepare(
        "DELETE FROM egress_events WHERE id NOT IN (SELECT id FROM egress_events ORDER BY ts DESC, id DESC LIMIT ?)"
      )
      .run(maxRows).changes;
    return { deleted };
  }
}

const CSV_HEADER = ["time_utc", "task", "host", "bytes_sent", "bytes_received", "outcome", "status", "error_class", "model", "attributed"];

function csvCell(value) {
  if (value == null) return "";
  let s = String(value);
  // Spreadsheet formula injection: a leading = + - @ tab or CR is neutralised.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(events) {
  const lines = events.map((e) =>
    [new Date(e.ts).toISOString(), e.task, e.host, e.bytesOut, e.bytesIn, e.outcome, e.status, e.errorClass, e.model, e.attributed ? "yes" : "no"]
      .map(csvCell)
      .join(",")
  );
  return [CSV_HEADER.join(","), ...lines].join("\n") + "\n";
}

module.exports = { FlightRecorder, toCsv, MAX_ROWS, MEMORY_LIMIT };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- test/helpers/flightRecorder.test.js`
Expected: PASS (12 tests). Run the existing DB suites, which share the schema string, to confirm nothing regressed:

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
  authorize({ task?, target, model?, meter?: "body"|"socket" }): Ticket   // throws SealedModeError (and records "blocked", 0 bytes) when refused
  assertAllowed({ task?, target }): void    // authorize + discard: a permission check with no ledger row when allowed
  guard(meta & { settleFrom?: (result) => SettlePatch }, fn: (ticket) => Promise<T>): Promise<T>
  meteredFetch(ticket, baseFetch?): typeof fetch   // counts request body bytes and response body bytes into the ticket
  abortAllRemote(): number;  activeRemoteCount(): number
  explainingTicket(host): Ticket|null;  isHostExplained(host): boolean;  noteRedirect(fromHost, toHost): void
  recordUnattributed({ host, outcome, bytesOut?, bytesIn? }): void
  recordBackstopBlock({ host, ticket? }): SealedModeError
  onSealChanged(sealed: boolean): void;  counters(): { blockedSinceSealed, recordFailures }
  events: EventEmitter   // "started" → { ticketId, task, host, ts } for non-loopback tickets (CCR-3)
  _resetForTests(): void
  ```

- `Ticket` is:

  ```js
  { id, task, host, loopback, model, meter, signal, observedHosts, redirectHosts, settled,
    observeHost(host), attachSocket(socket), addBytes({ out?, in? }), noteStatus(code),
    bodyOpened(), bodyClosed(), abort(reason),
    settle({ outcome, status?, errorClass?, bytesOut?, bytesIn? }), discard() }
  ```

  A loopback ticket is never recorded.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/egressGate.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError } = require("../../src/helpers/privacy/egressPolicy");

function setup(t, { sealed = false } = {}) {
  const flags = { sealed };
  const recorder = new FlightRecorder({ now: () => 1000 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now: () => 1000 });
  t.after(() => gate._resetForTests());
  return { flags, recorder };
}

test("a sealed gate refuses a remote target and records 0 bytes", (t) => {
  const { recorder } = setup(t, { sealed: true });
  assert.throws(
    () => gate.authorize({ task: "chat", target: "https://api.groq.com/openai/v1", model: "gpt-oss-120b" }),
    (error) => isSealedModeError(error) && error.details.host === "api.groq.com"
  );
  const [row] = recorder.list();
  assert.equal(row.outcome, "blocked");
  assert.equal(row.bytesOut, 0);
  assert.equal(row.errorClass, "SEALED_MODE");
  assert.equal(row.model, "gpt-oss-120b");
  assert.equal(gate.counters().blockedSinceSealed, 1);
});

test("loopback is allowed while sealed and never recorded", async (t) => {
  const { recorder } = setup(t, { sealed: true });
  const result = await gate.guard({ task: "dictationCleanup", target: "http://127.0.0.1:8080/v1" }, async () => "ok");
  assert.equal(result, "ok");
  assert.equal(recorder.list().length, 0);
});

test("guard records an ok request with metered bytes and status", async (t) => {
  const { recorder } = setup(t);
  const fakeFetch = async () => new Response("hello world", { status: 200 });
  await gate.guard({ task: "chat", target: "https://api.groq.com/x", model: "m" }, async (ticket) => {
    const res = await gate.meteredFetch(ticket, fakeFetch)("https://api.groq.com/x", { method: "POST", body: "12345" });
    await res.text();
  });
  const [row] = recorder.list();
  assert.deepEqual(
    { outcome: row.outcome, bytesOut: row.bytesOut, bytesIn: row.bytesIn, status: row.status, host: row.host },
    { outcome: "ok", bytesOut: 5, bytesIn: 11, status: 200, host: "api.groq.com" }
  );
});

test("an unmeasurable body is recorded as unknown, not 0", async (t) => {
  const { recorder } = setup(t);
  const fakeFetch = async () => new Response(null, { status: 204 });
  await gate.guard({ task: "chat", target: "https://api.groq.com/x" }, (ticket) =>
    gate.meteredFetch(ticket, fakeFetch)("https://api.groq.com/x", { body: new ReadableStream() })
  );
  assert.equal(recorder.list()[0].bytesOut, null);
});

test("a response body not fully read before settling is recorded as unknown", async (t) => {
  const { recorder } = setup(t);
  const fakeFetch = async () => new Response("a long body", { status: 200 });
  await gate.guard({ task: "providerCheck", target: "https://api.groq.com" }, (ticket) =>
    gate.meteredFetch(ticket, fakeFetch)("https://api.groq.com/models")
  );
  assert.equal(recorder.list()[0].bytesIn, null);
});

test("aborting a socket-metered ticket that never opened a socket settles it", (t) => {
  const { recorder } = setup(t);
  const ticket = gate.authorize({ task: "dictationStt", target: "wss://api.openai.com", meter: "socket" });
  gate.abortAllRemote();
  assert.equal(ticket.settled, true);
  assert.equal(recorder.list()[0].outcome, "cancelled");
  assert.equal(gate.activeRemoteCount(), 0);
});

test("settle stores an error class, never a message", async (t) => {
  const { recorder } = setup(t);
  const providerError = Object.assign(new Error("Your text 'secret plans' was rejected"), { code: "PROVIDER_REJECTED", status: 400 });
  await assert.rejects(gate.guard({ task: "chat", target: "https://api.groq.com" }, async () => { throw providerError; }));
  const [row] = recorder.list();
  assert.equal(row.outcome, "error");
  assert.equal(row.errorClass, "PROVIDER_REJECTED");
  assert.equal(row.status, 400);
  assert.equal(JSON.stringify(row).includes("secret"), false);
});

test("withTask supplies the task across async boundaries", async (t) => {
  const { recorder } = setup(t);
  await gate.withTask("uploadStt", async () => {
    await new Promise((r) => setTimeout(r, 1));
    await gate.guard({ target: "https://api.openai.com/v1/audio" }, async () => {});
  });
  assert.equal(recorder.list()[0].task, "uploadStt");
  await gate.guard({ target: "https://api.openai.com" }, async () => {});
  assert.equal(recorder.list()[0].task, "unattributed");
});

test("abortAllRemote aborts in-flight remote tickets with SealedModeError", async (t) => {
  const { flags, recorder } = setup(t);
  const pending = gate.guard({ task: "chat", target: "https://api.groq.com" }, (ticket) =>
    new Promise((_resolve, reject) => ticket.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
  );
  const local = gate.authorize({ task: "dictationCleanup", target: "http://localhost:8080" });
  assert.equal(gate.activeRemoteCount(), 1);
  flags.sealed = true;
  gate.onSealChanged(true);
  assert.equal(gate.abortAllRemote(), 1);
  await assert.rejects(pending, (error) => isSealedModeError(error));
  assert.equal(local.signal.aborted, false, "loopback work keeps running");
  const [row] = recorder.list();
  assert.equal(row.outcome, "cancelled");
  assert.equal(row.errorClass, "SEALED_MODE");
  assert.equal(gate.activeRemoteCount(), 0);
});

test("started notices fire for remote tickets only", (t) => {
  setup(t);
  const seen = [];
  gate.events.on("started", (n) => seen.push(n));
  gate.authorize({ task: "chat", target: "https://api.groq.com" }).discard();
  gate.authorize({ task: "chat", target: "http://127.0.0.1:1" }).discard();
  assert.deepEqual(seen.map((n) => [n.task, n.host]), [["chat", "api.groq.com"]]);
});

test("a throwing isSealed fails closed", (t) => {
  setup(t);
  gate.configureEgress({ isSealed: () => { throw new Error("disk"); } });
  assert.equal(gate.isSealed(), true);
  assert.throws(() => gate.authorize({ task: "chat", target: "https://api.groq.com" }), isSealedModeError);
});

test("unknown tasks are a programming error", (t) => {
  setup(t);
  assert.throws(() => gate.authorize({ task: "telemetry", target: "https://x.example" }), TypeError);
});

test("explaining tickets: host, observed hosts and redirects", (t) => {
  setup(t);
  const ticket = gate.authorize({ task: "modelDownload", target: "https://huggingface.co/x" });
  assert.equal(gate.isHostExplained("huggingface.co"), true);
  assert.equal(gate.isHostExplained("cdn-lfs.hf.co"), false);
  gate.noteRedirect("huggingface.co", "cdn-lfs.hf.co");
  assert.equal(gate.explainingTicket("cdn-lfs.hf.co"), ticket);
  ticket.observeHost("cas-bridge.xethub.hf.co");
  assert.equal(gate.isHostExplained("cas-bridge.xethub.hf.co"), true);
  ticket.discard();
  assert.equal(gate.isHostExplained("huggingface.co"), false);
});

test("assertAllowed leaves no ledger row when allowed", (t) => {
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
const { EGRESS_TASKS, decideEgress, SealedModeError, isSealedModeError } = require("./egressPolicy");

// Layer A of Sealed mode (docs/security/sealed-mode-threat-model.md). Every
// known request site asks for a ticket before sending. The ticket carries the
// task for the flight recorder and an AbortSignal that sealing trips.
const ticketContext = new AsyncLocalStorage();
const taskContext = new AsyncLocalStorage();
const events = new EventEmitter();

const freshTally = () => ({ blockedSinceSealed: 0, recordFailures: 0 });
let config = { isSealed: () => false, recorder: null, now: Date.now };
let active = new Map();
let nextId = 1;
let tally = freshTally();

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

function refuse({ task, host, model = null, attributed = true }) {
  tally.blockedSinceSealed++;
  record({ ts: config.now(), task, host, bytesOut: 0, bytesIn: 0, outcome: "blocked", errorClass: "SEALED_MODE", model, attributed });
  return new SealedModeError({ task, host });
}

function meterAccumulator() {
  return { total: 0, measured: false, unknown: false };
}
function addTo(acc, n) {
  if (n === null) acc.unknown = true;
  else if (Number.isFinite(n) && n >= 0) {
    acc.total += n;
    acc.measured = true;
  }
}
const valueOf = (acc) => (acc.unknown || !acc.measured ? null : acc.total);

function createTicket({ task, host, loopback, model, meter }) {
  const controller = new AbortController();
  const out = meterAccumulator();
  const inbound = meterAccumulator();
  const sockets = new Set();
  let lastStatus = null;
  let openBodies = 0;
  const ticket = {
    id: nextId++,
    task,
    host,
    loopback,
    model,
    meter,
    signal: controller.signal,
    observedHosts: new Set(),
    redirectHosts: new Set(),
    settled: false,
    observeHost(seen) {
      if (seen && seen !== host) ticket.observedHosts.add(seen);
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
    abort(reason) {
      if (!controller.signal.aborted) controller.abort(reason);
      for (const socket of sockets) socket.destroy(reason);
      // A socket-metered ticket with no socket yet has nothing left to close.
      if (meter === "socket" && sockets.size === 0) ticket.settle({ outcome: "cancelled" });
    },
    discard() {
      ticket.settled = true;
      active.delete(ticket.id);
    },
    settle({ outcome, status, errorClass = null, bytesOut, bytesIn } = {}) {
      if (ticket.settled) return;
      ticket.discard();
      if (loopback) return;
      const sealedAbort = controller.signal.aborted && isSealedModeError(controller.signal.reason);
      record({
        ts: config.now(),
        task,
        host: [...ticket.observedHosts][0] ?? host,
        bytesOut: bytesOut !== undefined ? bytesOut : valueOf(out),
        // A body still being read when the request settled was not fully
        // counted, so the received total is unknown rather than too small.
        bytesIn: bytesIn !== undefined ? bytesIn : openBodies > 0 ? null : valueOf(inbound),
        outcome,
        status: Number.isInteger(status) ? status : lastStatus,
        errorClass: sealedAbort ? "SEALED_MODE" : errorClass,
        model,
      });
    },
  };
  active.set(ticket.id, ticket);
  return ticket;
}

function authorize({ task = currentTask() ?? "unattributed", target, model = null, meter = "body" } = {}) {
  assertTask(task);
  const decision = decideEgress({ sealed: isSealed(), target });
  if (!decision.allow) throw refuse({ task, host: decision.host, model });
  const ticket = createTicket({ task, host: decision.host, loopback: decision.loopback, model, meter });
  if (!ticket.loopback) events.emit("started", { ticketId: ticket.id, task, host: ticket.host, ts: config.now() });
  return ticket;
}

function assertAllowed(meta) {
  authorize(meta).discard();
}

async function guard(meta, fn) {
  const ticket = authorize(meta);
  try {
    const result = await runWithTicket(ticket, () => fn(ticket));
    ticket.settle({ outcome: "ok", ...(meta.settleFrom ? meta.settleFrom(result) : {}) });
    return result;
  } catch (error) {
    const reason = ticket.signal.aborted ? ticket.signal.reason : null;
    const sealedAbort = isSealedModeError(reason);
    ticket.settle({
      outcome: ticket.signal.aborted || error?.name === "AbortError" ? "cancelled" : "error",
      errorClass: sealedAbort ? "SEALED_MODE" : errorClassOf(error),
      status: Number.isInteger(error?.status) ? error.status : undefined,
    });
    // A request cut off by sealing reports the seal, not a transport error,
    // so the renderer shows "paused: Sealed mode is on" and keeps the content.
    throw sealedAbort ? reason : error;
  }
}

function bodyLength(body) {
  if (body == null) return 0;
  if (typeof body === "string") return Buffer.byteLength(body);
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof URLSearchParams) return Buffer.byteLength(body.toString());
  return null; // streams and FormData: unknown, never reported as 0
}

function meteredFetch(ticket, baseFetch = (...args) => globalThis.fetch(...args)) {
  return async (input, init = {}) => {
    ticket.addBytes({ out: bodyLength(init?.body) });
    const signal = init?.signal ? AbortSignal.any([init.signal, ticket.signal]) : ticket.signal;
    const response = await baseFetch(input, { ...init, signal });
    ticket.noteStatus(response.status);
    if (!response.body) {
      ticket.addBytes({ in: 0 });
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
    ticket.abort(new SealedModeError({ task: ticket.task, host: ticket.host }));
    aborted++;
  }
  return aborted;
}
const activeRemoteCount = () => [...active.values()].filter((t) => !t.loopback).length;

function explainingTicket(host) {
  if (!host) return null;
  for (const t of active.values())
    if (t.host === host || t.observedHosts.has(host) || t.redirectHosts.has(host)) return t;
  return null;
}
const isHostExplained = (host) => explainingTicket(host) !== null;
function noteRedirect(fromHost, toHost) {
  const ticket = explainingTicket(fromHost);
  if (ticket && toHost) ticket.redirectHosts.add(toHost);
}

function recordUnattributed({ host, outcome, bytesOut = null, bytesIn = null }) {
  record({ ts: config.now(), task: "unattributed", host, outcome, bytesOut, bytesIn, attributed: false });
}

// Layer B found a connection Layer A did not refuse. With a ticket, the request
// was authorised before sealing; its own settle() records it as cancelled.
function recordBackstopBlock({ host, ticket = null }) {
  if (ticket) {
    tally.blockedSinceSealed++;
    const error = new SealedModeError({ task: ticket.task, host });
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
  nextId = 1;
  tally = freshTally();
  events.removeAllListeners();
}

module.exports = {
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
  meteredFetch,
  abortAllRemote,
  activeRemoteCount,
  explainingTicket,
  isHostExplained,
  noteRedirect,
  recordUnattributed,
  recordBackstopBlock,
  onSealChanged,
  counters,
  events,
  _resetForTests,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/helpers/egressGate.test.js`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add src/helpers/privacy/egressGate.js test/helpers/egressGate.test.js
git commit -m "feat(privacy): add egress gate with tickets, task context and metering"
```

---

### Task 6: The transport backstop (Layer B)

**Files:**
- Create: `src/helpers/privacy/egressBackstop.js`
- Modify: `scripts/smoke-electron.cjs:86-94`. Replace its own `webRequest` watcher with a backstop observer, because Electron keeps only one `onBeforeRequest` listener per session.
- Test: `test/helpers/egressBackstop.test.js`

**Interfaces:**
- Consumes `egressGate` (Task 5) and `egressPolicy` (Task 2).
- Produces:

  ```js
  installNodeBackstop(): void           // idempotent; hooks net.Socket.prototype.connect, dns.lookup, dns.promises.lookup
  watchSession(session): void           // idempotent per session; owns webRequest.onBeforeRequest/onBeforeRedirect
  judgeChromiumRequest(url): { cancel: boolean }
  severAll(): Promise<void>             // destroys open remote sockets; session.closeAllConnections() on every watched session
  addObserver(fn: (e: { layer: "node"|"chromium", host, url?, allowed, explained? }) => boolean|void): () => void
                                        // a chromium observer returning true vetoes the request (smoke test hook)
  status(): { node: boolean, sessions: number }
  ```

- [ ] **Step 1: Write the failing test**

Create `test/helpers/egressBackstop.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const dns = require("node:dns");
const path = require("node:path");
const test = require("node:test");
const gate = require("../../src/helpers/privacy/egressGate");
const backstop = require("../../src/helpers/privacy/egressBackstop");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError } = require("../../src/helpers/privacy/egressPolicy");

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

async function echoServer(t) {
  const server = net.createServer((socket) => socket.pipe(socket));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return server.address().port;
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

test("sealed: explicit DNS lookups of remote names are refused", async () => {
  flags.sealed = true;
  await assert.rejects(dns.promises.lookup("example.invalid"), (error) => isSealedModeError(error));
  const error = await new Promise((resolve) => dns.lookup("example.invalid", (e) => resolve(e)));
  assert.ok(isSealedModeError(error));
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

test("unsealed: an unexplained remote connection is recorded with its bytes", async (t) => {
  const port = await echoServer(t);
  const socket = net.connect({ host: "tracker.example", port, lookup: toLoopback });
  await once(socket, "connect");
  socket.end("hi");
  socket.resume();
  await once(socket, "close");
  const [row] = recorder.list();
  assert.deepEqual([row.task, row.host, row.attributed, row.bytesOut], ["unattributed", "tracker.example", false, 2]);
});

test("unsealed: a connection inside a ticket is attributed, not unexplained", async (t) => {
  const port = await echoServer(t);
  await gate.guard({ task: "chat", target: "https://api.provider.example" }, async (ticket) => {
    const socket = net.connect({ host: "edge.provider.example", port, lookup: toLoopback });
    await once(socket, "connect");
    socket.end();
    socket.resume();
    await once(socket, "close");
    assert.ok(ticket.observedHosts.has("edge.provider.example"));
  });
  const rows = recorder.list();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].task, rows[0].host, rows[0].attributed], ["chat", "edge.provider.example", true]);
});

test("a socket-metered ticket settles with wire bytes when its socket closes", async (t) => {
  const port = await echoServer(t);
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
  assert.ok(isSealedModeError(await once(socket, "error")));
  assert.ok(isSealedModeError(ticket.signal.reason));
});

test("severAll destroys open remote sockets", async (t) => {
  const port = await echoServer(t);
  const socket = net.connect({ host: "stream.provider.example", port, lookup: toLoopback });
  await once(socket, "connect");
  const closed = once(socket, "close");
  await backstop.severAll();
  await closed;
  assert.equal(socket.destroyed, true);
});

function fakeSession() {
  return {
    closed: 0,
    webRequest: {
      onBeforeRequest(listener) { this.before = listener; },
      onBeforeRedirect(listener) { this.redirect = listener; },
    },
    async closeAllConnections() { this.closed++; },
  };
}
const ask = (session, url) => new Promise((resolve) => session.webRequest.before({ url }, resolve));

test("chromium sessions: sealed cancels remote, keeps local schemes and loopback", async () => {
  const session = fakeSession();
  backstop.watchSession(session);
  flags.sealed = true;
  assert.deepEqual(await ask(session, "https://api.github.com/repos/snowopsdev/loqui/releases"), { cancel: true });
  assert.deepEqual(await ask(session, "file:///Applications/Loqui.app/index.html"), { cancel: false });
  assert.deepEqual(await ask(session, "http://localhost:5174/"), { cancel: false });
  assert.deepEqual(await ask(session, "devtools://devtools/bundled/inspector.html"), { cancel: false });
  assert.equal(recorder.list()[0].outcome, "blocked");
  await backstop.severAll();
  assert.equal(session.closed, 1);
});

test("chromium sessions: unexplained hosts are recorded; ticket hosts and redirects are not", async () => {
  const session = fakeSession();
  backstop.watchSession(session);
  backstop.watchSession(session); // idempotent
  assert.deepEqual(await ask(session, "https://images.example.com/a.png"), { cancel: false });
  assert.equal(recorder.list()[0].host, "images.example.com");
  const ticket = gate.authorize({ task: "modelDownload", target: "https://huggingface.co/m" });
  session.webRequest.redirect({ url: "https://huggingface.co/m", redirectURL: "https://cdn-lfs.hf.co/m" });
  await ask(session, "https://cdn-lfs.hf.co/m");
  assert.equal(recorder.list().length, 1);
  ticket.discard();
});

test("an observer can veto a chromium request (smoke test hook)", async (t) => {
  const session = fakeSession();
  backstop.watchSession(session);
  const off = backstop.addObserver((e) => e.layer === "chromium" && e.host === "openwhispr.com");
  t.after(off);
  assert.deepEqual(await ask(session, "https://openwhispr.com/x"), { cancel: true });
});

test("status reports installed guards", () => {
  assert.equal(backstop.status().node, true);
  assert.ok(backstop.status().sessions >= 1);
});

test("only the backstop registers webRequest.onBeforeRequest", () => {
  const repoRoot = path.join(__dirname, "../..");
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.(c?js|ts|tsx)$/.test(entry.name) && /onBeforeRequest\s*\(/.test(fs.readFileSync(path.join(repoRoot, rel), "utf8"))) offenders.push(rel);
    }
  };
  walk("src");
  walk("scripts");
  if (/onBeforeRequest\s*\(/.test(fs.readFileSync(path.join(repoRoot, "main.js"), "utf8"))) offenders.push("main.js");
  assert.deepEqual(offenders, ["src/helpers/privacy/egressBackstop.js"]);
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
const { syncBuiltinESMExports } = require("node:module");
const { decideEgress, isLoopbackHost, normalizeHost, hostOf } = require("./egressPolicy");
const gate = require("./egressGate");

// Layer B of Sealed mode. It does not know tasks; it guarantees. Every Node
// TCP/TLS connection (http, https, undici fetch, ws, SDKs) goes through
// net.Socket#connect, and every Chromium request (Electron net, electron-updater,
// renderer loads) goes through its session's webRequest.
const LOCAL_SCHEMES = new Set(["file:", "devtools:", "chrome:", "chrome-extension:", "data:", "blob:", "about:"]);
const NETWORK_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);

let nodeInstalled = false;
const sessions = new Set();
const openRemoteSockets = new Set();
const observers = new Set();

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

// net.connect()/tls.connect() call Socket#connect with one normalised
// [options, callback] array; direct callers pass (options | port | path, ...).
function connectTarget(args) {
  const normalized = Array.isArray(args[0]);
  const first = normalized ? args[0][0] : args[0];
  if (first && typeof first === "object") {
    if (first.path) return { local: true };
    return { host: first.host ?? "localhost" };
  }
  if (typeof first === "string" && !/^\d+$/.test(first)) return { local: true };
  const host = normalized ? undefined : args[1];
  return { host: typeof host === "string" ? host : "localhost" };
}

function installNodeBackstop() {
  if (nodeInstalled) return;
  nodeInstalled = true;

  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function egressAwareConnect(...args) {
    const target = connectTarget(args);
    if (target.local) return originalConnect.apply(this, args);
    const host = normalizeHost(String(target.host)) ?? "unknown";
    if (isLoopbackHost(host)) return originalConnect.apply(this, args);
    const ticket = gate.currentTicket();
    if (gate.isSealed()) {
      const error = gate.recordBackstopBlock({ host, ticket });
      notify({ layer: "node", host, allowed: false });
      process.nextTick(() => this.destroy(error));
      return this;
    }
    const explained = !!ticket || gate.isHostExplained(host);
    if (ticket) {
      ticket.observeHost(host);
      if (ticket.meter === "socket") ticket.attachSocket(this);
    }
    openRemoteSockets.add(this);
    this.once("close", (hadError) => {
      openRemoteSockets.delete(this);
      if (!explained)
        gate.recordUnattributed({
          host,
          outcome: hadError ? "error" : "ok",
          bytesOut: this.bytesWritten,
          bytesIn: this.bytesRead,
        });
    });
    notify({ layer: "node", host, allowed: true, explained });
    return originalConnect.apply(this, args);
  };

  const originalLookup = dns.lookup;
  dns.lookup = function egressAwareLookup(hostname, ...rest) {
    if (gate.isSealed() && !isLoopbackHost(hostname)) {
      const error = gate.recordBackstopBlock({
        host: normalizeHost(String(hostname)) ?? "unknown",
        ticket: gate.currentTicket(),
      });
      const callback = rest[rest.length - 1];
      if (typeof callback === "function") process.nextTick(callback, error);
      return {};
    }
    return originalLookup.call(this, hostname, ...rest);
  };
  const originalPromiseLookup = dns.promises.lookup;
  dns.promises.lookup = function egressAwarePromiseLookup(hostname, ...rest) {
    if (gate.isSealed() && !isLoopbackHost(hostname)) {
      return Promise.reject(
        gate.recordBackstopBlock({ host: normalizeHost(String(hostname)) ?? "unknown", ticket: gate.currentTicket() })
      );
    }
    return originalPromiseLookup.call(this, hostname, ...rest);
  };
  // ESM importers of node:dns (e.g. SDKs loaded with import()) see the patch too.
  syncBuiltinESMExports();
}

function judgeChromiumRequest(url) {
  let protocol;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return { cancel: gate.isSealed() };
  }
  if (LOCAL_SCHEMES.has(protocol)) return { cancel: false };
  if (!NETWORK_SCHEMES.has(protocol)) return { cancel: gate.isSealed() };
  const decision = decideEgress({ sealed: gate.isSealed(), target: url });
  if (decision.loopback) return { cancel: false };
  if (!decision.allow) {
    gate.recordBackstopBlock({ host: decision.host, ticket: gate.explainingTicket(decision.host) });
    notify({ layer: "chromium", host: decision.host, url, allowed: false });
    return { cancel: true };
  }
  const explained = gate.isHostExplained(decision.host);
  if (notify({ layer: "chromium", host: decision.host, url, allowed: true, explained })) return { cancel: true };
  if (!explained) gate.recordUnattributed({ host: decision.host, outcome: "ok" });
  return { cancel: false };
}

// Electron keeps a single listener per webRequest event, so this module must
// be the only caller (enforced by test/helpers/egressBackstop.test.js).
// electron-updater uses its own partition session, which is why every session
// is watched through app.on("session-created"), not only defaultSession.
function watchSession(session) {
  if (!session?.webRequest || sessions.has(session)) return;
  sessions.add(session);
  session.webRequest.onBeforeRequest((details, callback) => callback(judgeChromiumRequest(details.url)));
  session.webRequest.onBeforeRedirect((details) =>
    gate.noteRedirect(hostOf(details.url), hostOf(details.redirectURL))
  );
}

async function severAll() {
  for (const socket of [...openRemoteSockets]) socket.destroy();
  openRemoteSockets.clear();
  await Promise.allSettled([...sessions].map((session) => session.closeAllConnections?.()));
}

const status = () => ({ node: nodeInstalled, sessions: sessions.size });

module.exports = { installNodeBackstop, watchSession, judgeChromiumRequest, severAll, addObserver, status };
```

If the global `fetch` test fails with `ENOTFOUND` instead of a sealed error, this Node build's bundled undici is not using the public `net` module. In that case:
- also wrap `globalThis.fetch` inside `installNodeBackstop()`, the same way `scripts/smoke-electron.cjs:71-75` does;
- reject with `gate.recordBackstopBlock({ host: hostOf(input), ticket: gate.currentTicket() })` when the gate is sealed and the host is not loopback;
- keep the test unchanged.

- [ ] **Step 4: Point the smoke script at the observer**

In `scripts/smoke-electron.cjs`, replace lines 86-94 (`const instrumented = new WeakSet();` through `electron.app.whenReady().then(() => watchSession(electron.session.defaultSession));`) with:

```js
  // Electron keeps one webRequest.onBeforeRequest listener per session and the
  // Sealed mode backstop owns it, so observe (and veto) through the backstop.
  require(path.join(repoRoot, "src/helpers/privacy/egressBackstop.js")).addObserver(
    (event) => event.layer === "chromium" && inspect(event.url, "electron-session")
  );
```

`inspect` returns `true` for a request that the smoke run must block, which matches the observer veto contract.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- test/helpers/egressBackstop.test.js test/helpers/egressGate.test.js`
Expected: PASS. No test makes a DNS query or an off-host connection; every "remote" socket resolves to 127.0.0.1 through `toLoopback`.

- [ ] **Step 6: Commit**

```bash
git add src/helpers/privacy/egressBackstop.js scripts/smoke-electron.cjs test/helpers/egressBackstop.test.js
git commit -m "feat(privacy): add socket, DNS and session backstop for Sealed mode"
```

---

### Task 7: Boot order, seal transitions, attestation, IPC, preload and types

**Files:**
- Create: `src/helpers/privacy/privacyBoot.js`, `src/helpers/privacy/privacyIPC.js` and `src/types/privacy.ts`
- Modify:
  - `main.js`. Boot directly after the `.env` load block at `main.js:91-95`, attach the database in `initializeCoreManagers()` after `databaseManager = new DatabaseManager();` (`main.js:308`), and attach IPC after `updateManager = …attachUpdateIPC({…})` (`main.js:460-470`).
  - `preload.js`. Add a `privacy` namespace after `personalInference` (`preload.js:78-99`).
  - `src/types/electron.ts:676-677`. Add `privacy: import("./privacy").PrivacyAPI;`.
  - `src/helpers/ipcHandlers.js:826-844` and `:1382-1394`. Prune the ledger in the retention sweep, and set persistence on sync.
- Test: `test/helpers/privacyIPC.test.js`, `test/helpers/privacyBootOrder.test.js`, and new cases appended to `test/helpers/preloadAuthBridge.test.js`.

**Interfaces:**
- Consumes `SealedState` (Task 3), `FlightRecorder` (Task 4), `egressGate` (Task 5) and `egressBackstop` (Task 6).
- Produces:
  - `bootEgressGuards({ app, profile, getDefaultSession, now? }): { state: SealedState, recorder: FlightRecorder }`.
  - `createSealTransition({ getUpdateManager, getInference, getCalendars, sleep, waitMs? }): (sealed: boolean) => Promise<void>`.
  - `createAttestor({ state, getInference, isYtDlpBusy? }): () => Attestation`.
  - `attachPrivacyIPC({ ipcMain, BrowserWindow, dialog, state, recorder, attest, applyTransition, isTrustedSender, now? }): { dispose(): void }`.
  - Channels: `privacy:get-sealed`, `privacy:set-sealed` (trusted), `privacy:attestation`, `privacy:egress-list`, `privacy:egress-summary`, `privacy:egress-clear` (trusted) and `privacy:egress-export` (trusted).
  - Broadcasts: `privacy:sealed-changed` (boolean), `privacy:egress-event` (`EgressNotice`) and `privacy:egress-cleared`.
  - Later tasks rely on these inference methods: `inference.stopCodex()` and `inference.codexRunning()` (Task 8), `updateManager.pauseForSeal()` (Task 10), and the calendar managers' `stop()`/`start()` (existing).
  - `src/types/privacy.ts` (TypeScript):

  ```ts
  export type EgressTask =
    | "dictationStt" | "noteRecordingStt" | "uploadStt" | "dictationCleanup" | "voiceAssistant"
    | "assistantVision" | "translation" | "noteFormatting" | "chat" | "speakerId" | "semanticSearch"
    | "providerCheck" | "modelDownload" | "runtimeDownload" | "urlImport" | "appUpdate" | "codex"
    | "calendar" | "unattributed";
  export type EgressOutcome = "ok" | "error" | "blocked" | "cancelled";
  export interface EgressEvent {
    id: number; ts: number; task: EgressTask; host: string;
    bytesOut: number | null; bytesIn: number | null; outcome: EgressOutcome;
    status: number | null; errorClass: string | null; model: string | null; attributed: boolean;
  }
  export interface EgressSummary {
    left: number; blocked: number; unattributed: number; unattributedHosts: string[];
    bytesOut: number; bytesIn: number; unknownBytes: number;
  }
  export type EgressNotice =
    | { phase: "started"; ticketId: number; task: EgressTask; host: string; ts: number }
    | { phase: "recorded"; event: EgressEvent };
  export interface Attestation {
    sealed: boolean; sealedSince: number | null;
    loadError: "corrupt" | "unreadable" | null; saveError: string | null;
    guards: { node: boolean; sessions: number };
    networkChildren: string[]; activeRemote: number;
    blockedSinceSealed: number; recordFailures: number;
    nothingLeaves: boolean;
  }
  export interface PrivacyAPI {
    getSealed(): Promise<boolean>;
    setSealed(sealed: boolean): Promise<Attestation>;
    getAttestation(): Promise<Attestation>;
    onSealedChange(callback: (sealed: boolean) => void): () => void;
    listEgress(options?: { since?: number; limit?: number }): Promise<EgressEvent[]>;
    egressSummary(options?: { since?: number }): Promise<EgressSummary>;
    clearEgress(): Promise<boolean>;
    exportEgressCsv(): Promise<{ saved: boolean }>;
    onEgress(callback: (notice: EgressNotice) => void): () => void;
    onEgressCleared(callback: () => void): () => void;
  }
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/privacyIPC.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const gate = require("../../src/helpers/privacy/egressGate");
const { SealedState } = require("../../src/helpers/privacy/sealedState");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { attachPrivacyIPC } = require("../../src/helpers/privacy/privacyIPC");
const { createSealTransition, createAttestor } = require("../../src/helpers/privacy/privacyBoot");

function harness(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-privacy-ipc-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = new SealedState({ profile: dir });
  const recorder = new FlightRecorder({ now: () => 10 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => state.isSealed(), recorder, now: () => 10 });
  t.after(() => gate._resetForTests());
  const handlers = new Map();
  const sent = [];
  const settings = { webContents: { send: (c, p) => sent.push([c, p]) }, isDestroyed: () => false };
  const pill = { webContents: { send: (c, p) => sent.push([c, p]) }, isDestroyed: () => false };
  const BrowserWindow = { getAllWindows: () => [settings, pill] };
  const calls = [];
  const deps = {
    ipcMain: { handle: (c, fn) => handlers.set(c, fn), removeHandler: (c) => handlers.delete(c) },
    BrowserWindow,
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: path.join(dir, "out.csv") }) },
    state,
    recorder,
    attest: () => ({ sealed: state.isSealed() }),
    applyTransition: async (sealed) => calls.push(sealed),
    isTrustedSender: (sender) => sender === settings.webContents,
  };
  attachPrivacyIPC(deps);
  const invoke = (channel, sender, ...args) => handlers.get(channel)({ sender }, ...args);
  return { handlers, sent, settings, pill, calls, invoke, state, recorder, dir };
}

test("get-sealed and set-sealed round-trip, then broadcast after the transition", async (t) => {
  const h = harness(t);
  assert.equal(await h.invoke("privacy:get-sealed", h.pill.webContents), false);
  const result = await h.invoke("privacy:set-sealed", h.settings.webContents, true);
  assert.deepEqual(result, { sealed: true });
  assert.deepEqual(h.calls, [true]);
  assert.deepEqual(h.sent.filter(([c]) => c === "privacy:sealed-changed"), [
    ["privacy:sealed-changed", true],
    ["privacy:sealed-changed", true],
  ]);
});

test("set-sealed rejects untrusted windows, unknown senders and non-booleans", async (t) => {
  const h = harness(t);
  await assert.rejects(async () => h.invoke("privacy:set-sealed", h.pill.webContents, false), /cannot change/);
  await assert.rejects(async () => h.invoke("privacy:set-sealed", {}, true), /Unknown application window/);
  await assert.rejects(async () => h.invoke("privacy:set-sealed", h.settings.webContents, "false"), TypeError);
  assert.equal(h.state.isSealed(), false);
});

test("setting the current value does not run a transition", async (t) => {
  const h = harness(t);
  await h.invoke("privacy:set-sealed", h.settings.webContents, false);
  assert.deepEqual(h.calls, []);
});

test("ledger list, summary, clear and export", async (t) => {
  const h = harness(t);
  h.recorder.record({ task: "chat", host: "api.groq.com", outcome: "ok", ts: Date.now() });
  const list = await h.invoke("privacy:egress-list", h.pill.webContents, {});
  assert.equal(list.length, 1);
  assert.equal((await h.invoke("privacy:egress-summary", h.pill.webContents)).left, 1);
  assert.deepEqual(await h.invoke("privacy:egress-export", h.settings.webContents), { saved: true });
  assert.match(fs.readFileSync(path.join(h.dir, "out.csv"), "utf8"), /api\.groq\.com/);
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(h.dir, "out.csv")).mode & 0o777, 0o600);
  await assert.rejects(async () => h.invoke("privacy:egress-clear", h.pill.webContents), /cannot change/);
  assert.equal(await h.invoke("privacy:egress-clear", h.settings.webContents), true);
  assert.equal((await h.invoke("privacy:egress-list", h.pill.webContents, { since: 0 })).length, 0);
});

test("recorded events and started notices are broadcast", (t) => {
  const h = harness(t);
  gate.authorize({ task: "chat", target: "https://api.groq.com" }).settle({ outcome: "ok" });
  const notices = h.sent.filter(([c]) => c === "privacy:egress-event").map(([, n]) => n.phase);
  assert.deepEqual(notices, ["started", "started", "recorded", "recorded"]);
});

test("seal transition aborts remote work, pauses updates, stops Codex and calendars", async (t) => {
  gate._resetForTests();
  const flags = { sealed: false };
  gate.configureEgress({ isSealed: () => flags.sealed });
  t.after(() => gate._resetForTests());
  const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com" });
  ticket.signal.addEventListener("abort", () => ticket.settle({ outcome: "cancelled" }));
  const log = [];
  const calendar = { stop: () => log.push("calendar.stop"), start: () => log.push("calendar.start") };
  const transition = createSealTransition({
    getUpdateManager: () => ({ pauseForSeal: () => log.push("updates.pause") }),
    getInference: () => ({ stopCodex: () => log.push("codex.stop") }),
    getCalendars: () => [calendar, null],
    sleep: () => new Promise((r) => setImmediate(r)),
  });
  flags.sealed = true;
  await transition(true);
  assert.equal(ticket.signal.aborted, true);
  assert.equal(gate.activeRemoteCount(), 0);
  assert.deepEqual(log, ["updates.pause", "codex.stop", "calendar.stop"]);
  await transition(false);
  assert.deepEqual(log.at(-1), "calendar.start");
});

test("attestation says nothingLeaves only when every condition holds", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-attest-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = new SealedState({ profile: dir });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => state.isSealed() });
  t.after(() => gate._resetForTests());
  let codex = false;
  const attest = createAttestor({ state, getInference: () => ({ codexRunning: () => codex }) });
  const backstop = require("../../src/helpers/privacy/egressBackstop");
  backstop.installNodeBackstop();
  backstop.watchSession({ webRequest: { onBeforeRequest() {}, onBeforeRedirect() {} } });
  assert.equal(attest().nothingLeaves, false, "unsealed never attests");
  state.set(true);
  assert.equal(attest().nothingLeaves, true);
  codex = true;
  assert.equal(attest().nothingLeaves, false);
  assert.deepEqual(attest().networkChildren, ["codex"]);
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

test("main attaches the ledger database and the privacy IPC", () => {
  assert.match(main, /privacy\.recorder\.attachDatabase\(databaseManager\.db\)/);
  assert.match(main, /attachPrivacyIPC\(\{/);
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
  const notices = [];
  api.privacy.onEgress((n) => notices.push(n));
  listeners.get("privacy:egress-event")({}, { phase: "started", task: "chat" });
  assert.deepEqual(notices, [{ phase: "started", task: "chat" }]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/helpers/privacyIPC.test.js test/helpers/privacyBootOrder.test.js test/helpers/preloadAuthBridge.test.js`
Expected: FAIL. The privacy modules are missing, `bootEgressGuards(` is not found in `main.js`, and `api.privacy` is undefined.

- [ ] **Step 3: Implement the boot module**

Create `src/helpers/privacy/privacyBoot.js`:

```js
const gate = require("./egressGate");
const backstop = require("./egressBackstop");
const { SealedState } = require("./sealedState");
const { FlightRecorder } = require("./flightRecorder");

// Called from main.js before any helper that can open a connection is
// required (test/helpers/privacyBootOrder.test.js). Order matters: read the
// switch, configure the gate, then install the hooks.
function bootEgressGuards({ app, profile, getDefaultSession, now = Date.now }) {
  const state = new SealedState({ profile, now });
  const recorder = new FlightRecorder({ now });
  gate.configureEgress({ isSealed: () => state.isSealed(), recorder, now });
  backstop.installNodeBackstop();
  app.on("session-created", (session) => backstop.watchSession(session));
  app.whenReady().then(() => backstop.watchSession(getDefaultSession()));
  return { state, recorder };
}

function createSealTransition({ getUpdateManager, getInference, getCalendars, sleep, waitMs = 1000 }) {
  return async function applySealTransition(sealed) {
    gate.onSealChanged(sealed);
    if (!sealed) {
      for (const calendar of getCalendars()) calendar?.start?.();
      return;
    }
    gate.abortAllRemote();
    getUpdateManager()?.pauseForSeal?.();
    getInference()?.stopCodex?.();
    for (const calendar of getCalendars()) calendar?.stop?.();
    await backstop.severAll();
    // Give aborted work a moment to settle so the attestation can be true.
    const deadline = Date.now() + waitMs;
    while (gate.activeRemoteCount() > 0 && Date.now() < deadline) await sleep(25);
  };
}

function createAttestor({ state, getInference, isYtDlpBusy = () => false }) {
  return function attest() {
    const snapshot = state.snapshot();
    const guards = backstop.status();
    const tally = gate.counters();
    const networkChildren = [
      ...(getInference()?.codexRunning?.() ? ["codex"] : []),
      ...(isYtDlpBusy() ? ["yt-dlp"] : []),
    ];
    const activeRemote = gate.activeRemoteCount();
    return {
      ...snapshot,
      guards,
      networkChildren,
      activeRemote,
      blockedSinceSealed: tally.blockedSinceSealed,
      recordFailures: tally.recordFailures,
      nothingLeaves:
        snapshot.sealed && guards.node && guards.sessions > 0 && networkChildren.length === 0 && activeRemote === 0,
    };
  };
}

module.exports = { bootEgressGuards, createSealTransition, createAttestor };
```

- [ ] **Step 4: Implement the IPC module**

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

function attachPrivacyIPC({ ipcMain, BrowserWindow, dialog, state, recorder, attest, applyTransition, isTrustedSender, now = Date.now }) {
  const windows = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  const broadcast = (channel, payload) => {
    for (const w of windows()) w.webContents.send(channel, payload);
  };
  const channels = [];
  const handle = (name, fn, { trusted = false } = {}) => {
    const channel = `privacy:${name}`;
    channels.push(channel);
    ipcMain.handle(channel, (event, ...args) => {
      if (!windows().some((w) => w.webContents === event.sender)) throw new Error("Unknown application window");
      if (trusted && !isTrustedSender(event.sender)) throw new Error("This window cannot change privacy settings");
      return fn(...args);
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
    (sealed) => {
      if (typeof sealed !== "boolean") throw new TypeError("sealed must be a boolean");
      // Serialise toggles so a quick on/off/on cannot interleave transitions.
      queue = queue
        .catch(() => {})
        .then(async () => {
          const before = state.isSealed();
          state.set(sealed);
          if (state.isSealed() !== before) {
            await applyTransition(state.isSealed());
            broadcast("privacy:sealed-changed", state.isSealed());
          }
          return attest();
        });
      return queue;
    },
    { trusted: true }
  );
  handle("egress-list", (options) => recorder.list(range(options)));
  handle("egress-summary", (options) => recorder.summary({ since: range(options).since }));
  handle(
    "egress-clear",
    () => {
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

  const onEvent = (event) => broadcast("privacy:egress-event", { phase: "recorded", event });
  const onStarted = (notice) => broadcast("privacy:egress-event", { phase: "started", ...notice });
  const onCleared = () => broadcast("privacy:egress-cleared");
  recorder.on("event", onEvent);
  recorder.on("cleared", onCleared);
  gate.events.on("started", onStarted);

  return {
    dispose() {
      for (const channel of channels) ipcMain.removeHandler(channel);
      recorder.off("event", onEvent);
      recorder.off("cleared", onCleared);
      gate.events.off("started", onStarted);
    },
  };
}

module.exports = { attachPrivacyIPC };
```

- [ ] **Step 5: Wire main.js**

1. Directly after the `.env` load block (`main.js:91-95`), insert:

   ```js
   // Sealed mode (Plan 07): read the switch and install the egress guards
   // before any helper that can open a connection is required below.
   const privacyBoot = require("./src/helpers/privacy/privacyBoot");
   const privacy = privacyBoot.bootEgressGuards({
     app,
     profile: app.getPath("userData"),
     getDefaultSession: () => session.defaultSession,
   });
   ```

   `session` is already in the `require("electron")` destructure that ends at `main.js:26`; add it there if it is missing.

2. In `initializeCoreManagers()`, directly after `databaseManager = new DatabaseManager();` (`main.js:308`), add:

   ```js
     privacy.recorder.attachDatabase(databaseManager.db);
   ```

3. After the `updateManager = require("./src/helpers/updateIPC").attachUpdateIPC({ … });` statement (`main.js:460-470`), add:

   ```js
     require("./src/helpers/privacy/privacyIPC").attachPrivacyIPC({
       ipcMain,
       BrowserWindow,
       dialog,
       state: privacy.state,
       recorder: privacy.recorder,
       attest: privacyBoot.createAttestor({
         state: privacy.state,
         getInference: () => inference,
         isYtDlpBusy: () => require("./src/helpers/urlAudioDownloader")._isYtDlpUpdateInFlight(),
       }),
       applyTransition: privacyBoot.createSealTransition({
         getUpdateManager: () => updateManager,
         getInference: () => inference,
         getCalendars: () => [googleCalendarManager, microsoftCalendarManager],
         sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
       }),
       isTrustedSender: (sender) =>
         [windowManager.mainWindow, windowManager.controlPanelWindow].some(
           (w) => w && !w.isDestroyed() && w.webContents === sender
         ),
     });
   ```

- [ ] **Step 6: Retention**

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

- [ ] **Step 7: Preload and types**

In `preload.js`, after the closing `},` of `personalInference` (`preload.js:99`), add:

```js
  privacy: {
    getSealed: () => ipcRenderer.invoke("privacy:get-sealed"),
    setSealed: (sealed) => ipcRenderer.invoke("privacy:set-sealed", sealed),
    getAttestation: () => ipcRenderer.invoke("privacy:attestation"),
    onSealedChange: registerListener("privacy:sealed-changed", (cb) => (_event, sealed) => cb(sealed)),
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

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test -- test/helpers/privacyIPC.test.js test/helpers/privacyBootOrder.test.js test/helpers/preloadAuthBridge.test.js && npm run typecheck`
Expected: PASS, and typecheck is clean.

- [ ] **Step 9: Commit**

```bash
git add src/helpers/privacy/privacyBoot.js src/helpers/privacy/privacyIPC.js src/types/privacy.ts src/types/electron.ts preload.js main.js src/helpers/ipcHandlers.js test/helpers/privacyIPC.test.js test/helpers/privacyBootOrder.test.js test/helpers/preloadAuthBridge.test.js
git commit -m "feat(privacy): boot egress guards first and expose the privacy IPC"
```

---
### Task 8: Gate provider inference, provider checks and Codex (N1–N4, N11, N17, N18)

**Files:**
- Create:
  - `src/helpers/privacy/providerEndpoints.js`. Where a request for each provider goes, used for ledger labels and the gate decision.
  - `src/helpers/privacy/gatedFetch.js`. `gatedNetFetch` (Electron `net`) and `gatedNodeFetch(task)` (Node `fetch`), both gated and metered.
- Modify:
  - `src/helpers/personalInference.js`:
    - `:173-205` `createModel` takes a `fetchImpl`.
    - `:208-216` adds a default Codex with gated verification.
    - `:248-267` gates the Codex handlers (except `codex-cancel-login` at `:264`).
    - `:286-320` gates `models`.
    - `:347-512` splits `execute` into a gated wrapper and `run`.
    - `:532-541` makes the returned object expose `stopCodex` and `codexRunning`.
  - `src/helpers/tinfoilCatalog.js:41-51` (`fetchModels`).
  - `src/helpers/providerConnectionTest.js:316-327`. Its transport `catch` turns every failure into `{ success: false, errorCode: "network" }` (`:332`), which would hide a sealed block. It now rethrows sealed errors.
  - `src/helpers/ipcHandlers.js`:
    - `:1151` passes a gated fetch to `testProviderConnection`.
    - Legacy enterprise handlers `:3953`, `:4025`, `:4154`, `:4239` are registered through `handleGated`.
  - `docs/security/sealed-mode-threat-model.md`. Add `src/helpers/privacy/gatedFetch.js` to the `egress-sites` block.
- Test: `test/helpers/personalInferenceSealed.test.js`

**Interfaces:**
- Consumes `egressGate` (Task 5), `taskForScope` and `isSealedModeError` (Task 2).
- Produces:
  - `providerEndpoint(provider: string, baseUrl?: string): string`. Custom, LAN and local providers use `baseUrl`. Named providers use the fixed table. An unknown provider maps to `https://unknown-provider.invalid`, which is remote (fail toward disclosure).
  - `gatedNetFetch(url, init?, { task? }?): Promise<Response>`, using Electron `net.fetch` with `useSessionCookies: false`.
  - `gatedNodeFetch(task): (url, init?) => Promise<Response>`.
  - `gatedVerifyRelease(verify = verifyOfficialCodex): (options) => Promise<…>`, exported from `personalInference.js`.
  - The `registerPersonalInferenceIPC` return value gains `stopCodex(): void` and `codexRunning(): boolean`.
  - `createModel(provider, model, apiKey, baseURL, disableThinking, enterprise, fetchImpl?)`.

- [ ] **Step 1: Write the failing test**

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
const { isSealedModeError } = require("../../src/helpers/privacy/egressPolicy");
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
  const calls = { credential: 0, factory: [], codexStatus: 0 };
  const codex = Object.assign(new EventEmitter(), {
    child: null,
    status: async () => { calls.codexStatus++; return {}; },
    login: async () => ({}), cancelLogin: async () => {}, logout: async () => {},
    models: async () => [], rateLimits: async () => ({}), stop() { codex.stopped = true; }, erase: async () => {},
    generate: async () => "",
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
  return { flags, recorder, calls, invoke, sent, api, codex };
}

const chatRequest = (overrides = {}) => ({
  provider: "groq", requestId: `r-${Math.random()}`, model: "llama-3.3", credentialRef: "groq",
  inferenceScope: "chatIntelligence", messages: [{ role: "user", content: "secret plans" }], ...overrides,
});

test("sealed: text-generate is refused before credentials or the SDK are touched", async (t) => {
  const h = harness(t, { sealed: true });
  await assert.rejects(h.invoke("text-generate", chatRequest()), (e) => isSealedModeError(e));
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

test("unsealed: the model factory receives a metered fetch and the ledger records the outcome", async (t) => {
  const h = harness(t);
  await assert.rejects(h.invoke("text-generate", chatRequest({ inferenceScope: "noteFormatting" })), new RegExp(REACHED));
  assert.equal(typeof h.calls.factory[0][6], "function", "7th createModel argument is the metered fetch");
  const [row] = h.recorder.list();
  assert.deepEqual([row.task, row.outcome, row.errorClass], ["noteFormatting", "error", "Error"]);
});

test("sealing mid-stream rejects with SealedModeError, not a timeout", async (t) => {
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
  await assert.rejects(pending, (e) => isSealedModeError(e));
  const [row] = h.recorder.list();
  assert.deepEqual([row.outcome, row.errorClass], ["cancelled", "SEALED_MODE"]);
});

test("sealed: model discovery and Codex handlers are refused", async (t) => {
  const h = harness(t, { sealed: true });
  await assert.rejects(h.invoke("models", { provider: "openrouter", credentialRef: "openrouter" }), (e) => isSealedModeError(e));
  await assert.rejects(h.invoke("codex-status"), (e) => isSealedModeError(e));
  assert.equal(h.calls.codexStatus, 0);
  await assert.rejects(h.invoke("text-generate", chatRequest({ provider: "codex", credentialRef: undefined })), (e) => isSealedModeError(e));
});

test("Codex verification is gated and the server can be stopped on seal", async (t) => {
  const h = harness(t, { sealed: true });
  let verified = 0;
  await assert.rejects(gatedVerifyRelease(async () => { verified++; })({}), (e) => isSealedModeError(e));
  assert.equal(verified, 0);
  assert.equal(h.api.codexRunning(), false);
  h.api.stopCodex();
  assert.equal(h.codex.stopped, true);
});

test("provider endpoints: named providers use the fixed table, custom ones their URL, unknown is remote", () => {
  assert.equal(providerEndpoint("groq"), "https://api.groq.com/openai/v1");
  assert.equal(providerEndpoint("openai", "http://127.0.0.1:1"), "https://api.openai.com/v1");
  assert.equal(providerEndpoint("custom", "http://192.168.1.5:8080/v1"), "http://192.168.1.5:8080/v1");
  assert.equal(providerEndpoint("lan"), "https://unknown-provider.invalid");
  assert.equal(providerEndpoint("brand-new"), "https://unknown-provider.invalid");
});
```

`validateRequest` may need extra fields for `local` or `codex` (`credentialRef` rules at `personalInference.js:135-139`). If it does, fill them in from that function. Do not change the assertions.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/helpers/personalInferenceSealed.test.js`
Expected: FAIL. `providerEndpoints` is missing, and once it exists the sealed request reaches the model factory.

- [ ] **Step 3: Create the endpoint table and the gated fetches**

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

// Electron net.fetch through the gate. The task comes from the argument or
// the surrounding egress.withTask() context.
function gatedNetFetch(url, init = {}, { task } = {}) {
  const { net } = require("electron");
  return egress.guard({ task, target: String(url) }, (ticket) =>
    egress.meteredFetch(ticket, (u, i) => net.fetch(String(u), { ...i, useSessionCookies: false }))(
      url,
      withTicketSignal(init, ticket)
    )
  );
}

// Node global fetch through the gate, for helpers that take a fetch implementation.
function gatedNodeFetch(task) {
  return (url, init = {}) =>
    egress.guard({ task, target: String(url) }, (ticket) =>
      egress.meteredFetch(ticket)(url, withTicketSignal(init, ticket))
    );
}

module.exports = { gatedNetFetch, gatedNodeFetch };
```

Add `src/helpers/privacy/gatedFetch.js` to the `egress-sites` block in the threat model, in sorted position.

- [ ] **Step 4: Gate `personalInference.js`**

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

3. Add an exported helper above `registerPersonalInferenceIPC`:

   ```js
   // The Codex release check downloads from GitHub before the app-server starts.
   function gatedVerifyRelease(verify = verifyOfficialCodex) {
     return (options) =>
       egress.guard({ task: "codex", target: "https://api.github.com" }, (ticket) =>
         verify({ ...options, fetchImpl: egress.meteredFetch(ticket, options?.fetchImpl ?? globalThis.fetch) })
       );
   }
   ```

   Change the default parameter at `:214` to `codex = new CodexAppServer({ userDataPath, verifyRelease: gatedVerifyRelease() }),`.

4. At the top of the `codex-status` (`:248`), `codex-login` (`:252`), `codex-logout` (`:265`), `codex-models` (`:266`) and `codex-rate-limits` (`:267`) handlers, add `egress.assertAllowed({ task: "codex", target: CODEX_HOST });` as the first statement. Those handlers only talk to the local app-server over stdio. The app-server's own traffic is out of our sight, so the only enforcement is to refuse before starting it. Leave `codex-cancel-login` ungated.

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
         },
         (ticket) => run(event, request, streaming, ticket)
       );
     }
   ```

   Inside `run`, make these three edits:
   - After `const controller = new AbortController();` (`:353`):

     ```js
         // Sealing mid-request aborts with the SealedModeError as the reason.
         ticket.signal.addEventListener("abort", () => controller.abort(ticket.signal.reason), { once: true });
     ```

   - Pass the metered fetch as the seventh `modelFactory` argument (`:412-421`). After the existing six arguments, add `egress.meteredFetch(ticket),`.
   - In the `catch` (`:497`), before `if (controller.signal.aborted && error !== controller.signal.reason) throw abortFailure();` (`:501`), add:

     ```js
         if (isSealedModeError(controller.signal.reason)) throw controller.signal.reason;
     ```

7. In the returned object (`:532`), add:

   ```js
       stopCodex: () => codex.stop(),
       codexRunning: () => !!codex.child,
   ```

8. Add `gatedVerifyRelease` to `module.exports`.

- [ ] **Step 5: Gate the Tinfoil catalog, the connection test and the legacy enterprise channels**

1. In `src/helpers/tinfoilCatalog.js`, wrap the body of `fetchModels` (`:41-51`):

   ```js
   const egress = require("./privacy/egressGate");
   // …
   async function fetchModels() {
     return egress.guard({ task: "providerCheck", target: "https://inference.tinfoil.sh" }, async () => {
       // The first call also attests the enclave, so allow for more than a plain GET.
       const response = await tinfoilSecureFetch(TINFOIL_MODELS_PATH, {
         method: "GET",
         signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

   Then re-register these four legacy channels through it. Keep each handler body unchanged as `fn`:

   | Channel | Line | `meta(...args)` |
   |---|---|---|
   | `test-enterprise-connection` | `:3953` | `() => ({ task: "providerCheck", target: "https://bedrock-runtime.amazonaws.com" })` |
   | `process-enterprise-reasoning` | `:4025` | `() => ({ task: "dictationCleanup", target: "https://bedrock-runtime.amazonaws.com" })` |
   | `enterprise-stream-start` | `:4154` | `() => ({ task: "chat", target: "https://bedrock-runtime.amazonaws.com" })` |
   | `bedrock-list-models` | `:4239` | `() => ({ task: "providerCheck", target: "https://bedrock-runtime.amazonaws.com" })` |

   The host is only a default label. The backstop replaces it with the actual Azure, Bedrock or Vertex host it sees, and every non-loopback target is refused while sealed regardless of the label.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- test/helpers/personalInferenceSealed.test.js test/helpers/egressInventory.test.js test/helpers/providerConnectionTest.test.js test/helpers/useChatStreamingCancellation.test.js`
Expected: PASS. The existing provider-connection and chat-cancellation suites still pass.

- [ ] **Step 7: Commit**

```bash
git add src/helpers/privacy/providerEndpoints.js src/helpers/privacy/gatedFetch.js src/helpers/personalInference.js src/helpers/tinfoilCatalog.js src/helpers/ipcHandlers.js docs/security/sealed-mode-threat-model.md test/helpers/personalInferenceSealed.test.js
git commit -m "feat(privacy): gate provider inference, checks and Codex through the egress gate"
```

---

### Task 9: Gate speech: batch, retry, legacy proxies and realtime (N5–N10)

**Files:**
- Create: `src/helpers/sttTransport.js`. Move `buildMultipartBody` and `postMultipart` here from `ipcHandlers.js:200-256`, and add `realtimeEndpoint` and `connectRealtime`.
- Modify:
  - `src/helpers/ipcHandlers.js`:
    - Import from `sttTransport`.
    - `const proxyFetch = …` at `:5075` becomes `gatedNetFetch`.
    - Wrap the task context around `transcribe-audio-file-byok` (`:7963`), `retry-transcription` (`:5083`) and the `proxy-*-transcription` and `process-anthropic-reasoning` handlers (`:3715`, `:3752`, `:3806`, `:3832`, `:3848`, `:4440`).
    - Route the realtime connect sites (`:7024`, `:7051`, `:8445`, `:8485`, `:8615`, `:8669`, `:8819`, `:8959`, `:8981`, and the meeting paths `:5846`, `:6022`) through `connectRealtime`.
  - `src/helpers/geminiTranscription.js:69`, `src/helpers/cortiAuth.js:39`, `src/helpers/cortiTranscription.js:7`. Use `gatedNetFetch` instead of `net.fetch`.
  - `src/helpers/tinfoilTranscription.js`. Wrap its `tinfoilSecureFetch` call in `egress.guard`.
  - `docs/security/sealed-mode-threat-model.md`. Add `src/helpers/sttTransport.js` to `egress-sites`.
- Test: `test/helpers/sttTransportSealed.test.js`

**Interfaces:**
- Consumes `gatedNetFetch` (Task 8) and `egressGate` (Task 5).
- Produces:
  - `buildMultipartBody(fileBuffer, fileName, contentType, fields?) → { body: Buffer, boundary }`, unchanged.
  - `postMultipart(url, body, boundary, headers?, { signal?, session? }?) → Promise<data>`, now gated, with exact `bytesOut = body.length`.
  - `realtimeEndpoint(provider: string, options?: { environment?: string }): string`.
  - `connectRealtime({ task, provider, options }, connect: () => Promise<T>): Promise<T>`. It authorizes a `meter: "socket"` ticket, runs `connect` inside it, and settles on failure. Successful sessions settle when their socket closes.
- Speech tasks:
  - `dictationStt` for captured audio, retry, the legacy proxies and dictation realtime;
  - `uploadStt` for file paths;
  - `noteRecordingStt` for meeting realtime.

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
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError } = require("../../src/helpers/privacy/egressPolicy");
const { gatedNetFetch } = require("../../src/helpers/privacy/gatedFetch");
const stt = require("../../src/helpers/sttTransport");
const { REALTIME_TOKEN_PROVIDERS } = require("../../src/helpers/realtimeTokenProviders");

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

test("sealed: a captured-audio upload is refused before net.fetch, attributed to dictation", async () => {
  flags.sealed = true;
  const { body, boundary } = audio();
  await assert.rejects(
    gate.withTask("dictationStt", () => stt.postMultipart(new URL("https://api.openai.com/v1/audio/transcriptions"), body, boundary)),
    (e) => isSealedModeError(e)
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

test("unsealed: an upload records the exact bytes sent and the status", async () => {
  const { body, boundary } = audio();
  await gate.withTask("uploadStt", () => stt.postMultipart(new URL("https://api.groq.com/openai/v1/audio/transcriptions"), body, boundary));
  const [row] = recorder.list();
  assert.deepEqual([row.task, row.outcome, row.bytesOut, row.status], ["uploadStt", "ok", body.length, 200]);
});

test("a cancelled upload is recorded as cancelled (matches the cancel copy, CCR-3)", async () => {
  netResponder = (_url, init) => new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  const controller = new AbortController();
  const { body, boundary } = audio();
  const pending = gate.withTask("dictationStt", () =>
    stt.postMultipart(new URL("https://api.openai.com/v1/audio/transcriptions"), body, boundary, {}, { signal: controller.signal })
  );
  await new Promise((r) => setImmediate(r));
  controller.abort();
  await assert.rejects(pending);
  assert.equal(recorder.list()[0].outcome, "cancelled");
});

test("sealed: retry, legacy proxies and token fetches are refused (gatedNetFetch)", async () => {
  flags.sealed = true;
  await assert.rejects(gate.withTask("dictationStt", () => gatedNetFetch("https://api.x.ai/v1/stt", { method: "POST", body: "x" })), (e) => isSealedModeError(e));
  const token = REALTIME_TOKEN_PROVIDERS["assemblyai-realtime"](
    { environmentManager: { getAssemblyAIKey: () => "k" }, proxyFetch: gatedNetFetch }, {}, 1
  );
  await assert.rejects(token, (e) => isSealedModeError(e));
  assert.deepEqual(netCalls, []);
});

test("sealed: a realtime connect is refused before the socket is created", async () => {
  flags.sealed = true;
  let connected = false;
  await assert.rejects(
    stt.connectRealtime({ task: "dictationStt", provider: "openai-realtime" }, async () => { connected = true; }),
    (e) => isSealedModeError(e)
  );
  assert.equal(connected, false);
  assert.equal(recorder.list()[0].task, "dictationStt");
});

test("every realtime provider has a known endpoint", () => {
  for (const provider of Object.keys(REALTIME_TOKEN_PROVIDERS)) {
    assert.doesNotMatch(stt.realtimeEndpoint(provider), /unknown-provider/, provider);
  }
  assert.match(stt.realtimeEndpoint("corti-realtime", { environment: "us" }), /api\.us\.corti\.app/);
});

test("no ungated Electron net transport is left in the speech paths", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
  for (const file of ["src/helpers/ipcHandlers.js", "src/helpers/geminiTranscription.js", "src/helpers/cortiAuth.js", "src/helpers/cortiTranscription.js"]) {
    assert.doesNotMatch(read(file), /\bnet\.(fetch|request)\s*\(/, file);
  }
  assert.doesNotMatch(read("src/helpers/ipcHandlers.js"), /function postMultipart\(/);
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
async function postMultipart(url, body, boundary, headers = {}, { signal, session: fetchSession } = {}) {
  const { net } = require("electron");
  return egress.guard({ target: url.toString() }, async (ticket) => {
    ticket.addBytes({ out: body.length });
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

const REALTIME_ENDPOINTS = {
  "openai-realtime": () => "wss://api.openai.com/v1/realtime",
  "assemblyai-realtime": () => "wss://streaming.assemblyai.com/v3/ws",
  "deepgram-realtime": () => "wss://api.deepgram.com/v1/listen",
  "gemini-realtime": () => "wss://generativelanguage.googleapis.com",
  "tinfoil-realtime": () => "wss://inference.tinfoil.sh",
  "corti-realtime": (options) => `wss://api.${options?.environment || "eu"}.corti.app`,
  // Keys match REALTIME_TOKEN_PROVIDERS (realtimeTokenProviders.js:13-40). Check
  // each host against the wss:// constant in that provider's streaming class
  // (grep -n "wss://" src/helpers/*Streaming.js); the label only matters for
  // the ledger, since every non-loopback target is refused while sealed.
};

function realtimeEndpoint(provider, options) {
  return REALTIME_ENDPOINTS[provider]?.(options) ?? "wss://unknown-provider.invalid";
}

// A realtime session is one long-lived socket. Its ticket is socket-metered:
// it settles with wire bytes when the socket closes, or at once when sealing
// aborts it.
async function connectRealtime({ task, provider, options }, connect) {
  return egress.withTask(task, async () => {
    const ticket = egress.authorize({ target: realtimeEndpoint(provider, options), meter: "socket" });
    try {
      return await egress.runWithTicket(ticket, connect);
    } catch (error) {
      const reason = ticket.signal.aborted ? ticket.signal.reason : null;
      ticket.settle({ outcome: reason ? "cancelled" : "error", errorClass: error?.code || error?.name || "Error" });
      throw reason ?? error;
    }
  });
}

module.exports = { buildMultipartBody, postMultipart, realtimeEndpoint, connectRealtime };
```

Fill in every `/* … */` from the moved source. They are the original lines and add no new behaviour.

- [ ] **Step 4: Rewire `ipcHandlers.js`**

1. Delete the moved functions (`:200-256`). Add:

   ```js
   const { buildMultipartBody, postMultipart, connectRealtime } = require("./sttTransport");
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

3. Wrap these handlers in a task context. The shape is the same for each; only the task differs:

   ```js
   ipcMain.handle("retry-transcription", (event, ...args) =>
     egress.withTask("dictationStt", () => retryTranscription(event, ...args))
   );
   ```

   Rename each existing inline handler to a local `async function` (here `retryTranscription`) defined just above its registration, with its body unchanged.

   | Channel | Line | Task |
   |---|---|---|
   | `transcribe-audio-file-byok` | `:7963` | `args?.audioBuffer ? "dictationStt" : "uploadStt"` (first arg is the request object) |
   | `retry-transcription` | `:5083` | `"dictationStt"` |
   | `proxy-xai-transcription`, `proxy-mistral-transcription` | `:3715`, `:3752` | `"dictationStt"` |
   | `proxy-corti-transcription`, `proxy-tinfoil-transcription`, `proxy-gemini-transcription` | `:3806`, `:3832`, `:3848` | `"dictationStt"` |
   | `process-anthropic-reasoning` | `:4440` | `"dictationCleanup"` |

   The BYOK handler's `catch` (`:8298-8305`) already returns `{ success: false, error, code, messageKey }`. A `SealedModeError` therefore reaches the renderer with `code: "SEALED_MODE"` and `messageKey: "sealedMode.blocked.generic"`.

4. Realtime. In `connectDictationStreaming` (`:7024`), wrap everything from the token request (`fetchRealtimeToken(…)`, `:7059`) through the `connect(...)` call of the new streaming instance (`:7051` onward):

   ```js
       return connectRealtime({ task: "dictationStt", provider: options.provider, options }, async () => {
         /* …existing token fetch, `new OpenAIRealtimeStreaming()` (or the Tinfoil subclass) and connect, unchanged… */
       });
   ```

   Do the same at each remaining construction site. Use `task: "noteRecordingStt"` for the meeting paths (`:5846`, `:6022`) and `task: "dictationStt"` for the provider streaming handlers (`:8445`, `:8485`, `:8615`, `:8669`, `:8819`, `:8959`, `:8981`). For `provider`, use the provider id that handler already knows (`assemblyai-realtime`, `deepgram-realtime`, `gemini-realtime` or `corti-realtime`; these are the keys of `REALTIME_ENDPOINTS` above, which match `REALTIME_TOKEN_PROVIDERS`). The `sendAudio` paths need no change: the socket is already metered by its ticket.

5. In `geminiTranscription.js:69`, `cortiAuth.js:39` and `cortiTranscription.js:7`, replace `net.fetch(` with `gatedNetFetch(`. Add `const { gatedNetFetch } = require("./privacy/gatedFetch");` to each file. The task comes from the handler's `withTask` context. In `tinfoilTranscription.js`, wrap the `tinfoilSecureFetch(...)` call in `egress.guard({ target: "https://inference.tinfoil.sh" }, () => tinfoilSecureFetch(...))`.

6. Add `src/helpers/sttTransport.js` to the `egress-sites` block.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- test/helpers/sttTransportSealed.test.js test/helpers/egressInventory.test.js test/services/fileTranscriptionCustomEndpoint.test.js test/services/transcriptionBaseUrl.test.js`
Expected: PASS. The existing transcription suites are unaffected.

Run: `grep -rn "net\.fetch(\|net\.request(" src/helpers/ipcHandlers.js`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/helpers/sttTransport.js src/helpers/ipcHandlers.js src/helpers/geminiTranscription.js src/helpers/cortiAuth.js src/helpers/cortiTranscription.js src/helpers/tinfoilTranscription.js docs/security/sealed-mode-threat-model.md test/helpers/sttTransportSealed.test.js
git commit -m "feat(privacy): gate batch, retry and realtime speech requests"
```

---

### Task 10: Gate model downloads, URL import and updates (N12–N16)

**Files:**
- Modify:
  - `src/helpers/downloadUtils.js`. Gate `downloadFile` (`:267`) and `fetchJson` (`:250`).
  - `src/helpers/gpuBinaryManager.js:110, 184`. Tag runtime downloads.
  - `src/helpers/urlAudioDownloader.js`. Gate `download` (`:1525`), and skip `maybeUpdateYtDlp` (`:390`) while sealed.
  - `src/helpers/updateManager.js`. Inject `sealed` and `authorize`; add `pauseForSeal()`; gate `check()`.
  - `src/helpers/updateIPC.js:29, 85-98`. Pass `sealed` through.
  - `main.js:460-470`. Pass `sealed: () => privacy.state.isSealed()` to `attachUpdateIPC`.
  - `src/types/updates.ts`. Add `sealed?: boolean` to `UpdateStatus`.
- Test: `test/helpers/downloadsSealed.test.js` and `test/helpers/updateManagerSealed.test.js`

**Interfaces:**
- Produces:
  - `downloadFile(url, destPath, { …existing, egressTask?: "modelDownload" | "runtimeDownload" })`.
  - `fetchJson(url, { …existing, egressTask? })`.
  - `UpdateManager` constructor options `sealed?: () => boolean` and `authorize?: (meta) => Ticket`.
  - `updateManager.pauseForSeal(): void`. `status()` adds `sealed: boolean`.
  - `attachUpdateIPC({ …, sealed })`.

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/downloadsSealed.test.js`:

```js
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

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
            aborted: false,
            setHeader() {},
            end() { respond?.(req); },
            abort() { req.aborted = true; req.emit("abort"); },
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
const { isSealedModeError } = require("../../src/helpers/privacy/egressPolicy");
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

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "loqui-dl-")), "model.bin");

test("sealed: a model download is refused before net.request", async () => {
  flags.sealed = true;
  await assert.rejects(downloadFile("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin", tmpFile()), (e) => isSealedModeError(e));
  assert.deepEqual(requests, []);
  assert.deepEqual([recorder.list()[0].task, recorder.list()[0].host], ["modelDownload", "huggingface.co"]);
});

test("sealed: runtime release lookups are tagged runtimeDownload", async () => {
  flags.sealed = true;
  await assert.rejects(fetchJson("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest", { egressTask: "runtimeDownload" }), (e) => isSealedModeError(e));
  assert.equal(recorder.list()[0].task, "runtimeDownload");
});

test("sealing aborts an in-flight download", async () => {
  const { signal } = createDownloadSignal();
  const pending = downloadFile("https://huggingface.co/x/model.gguf", tmpFile(), { signal, maxRetries: 0 });
  await new Promise((r) => setImmediate(r));
  assert.equal(requests.length, 1, "request started");
  flags.sealed = true;
  gate.abortAllRemote();
  await assert.rejects(pending, (e) => isSealedModeError(e));
  assert.equal(signal.aborted, true);
  assert.equal(recorder.list()[0].outcome, "cancelled");
});

test("sealed: URL import is refused and yt-dlp is not updated", async () => {
  flags.sealed = true;
  await assert.rejects(urlAudio.download("https://example.com/talk.mp3", () => {}, new AbortController().signal), (e) => isSealedModeError(e));
  assert.equal(recorder.list()[0].task, "urlImport");
  await urlAudio.maybeUpdateYtDlp({ force: true });
  assert.equal(urlAudio._isYtDlpUpdateInFlight(), false);
});
```

The in-flight test fakes `net.request` with an emitter that never responds. If `downloadAttempt`'s abort path (`downloadUtils.js:119`, `signal.onAbort`) needs a different fake method (for example `destroy` instead of `abort`), adapt the fake. Keep the three assertions unchanged.

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

function harness(t, { sealed = false, latest = "1.0.0" } = {}) {
  const flags = { sealed };
  const recorder = new FlightRecorder({ now: () => 1 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now: () => 1 });
  t.after(() => gate._resetForTests());
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-upd-"));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  fs.writeFileSync(path.join(profile, "updates.json"), JSON.stringify({ enabled: true, onboarded: true, lastCheck: 0 }));
  const calls = { check: 0, download: 0 };
  let cancelDownload;
  const updater = {
    on() {},
    async checkForUpdates() { calls.check++; return { updateInfo: { version: latest } }; },
    downloadUpdate(token) {
      calls.download++;
      return new Promise((_resolve, reject) => { cancelDownload = reject; token.onCancel(() => reject(new Error("cancelled"))); });
    },
  };
  const manager = new UpdateManager({
    updater, profile, version: "1.0.0", supported: true, packaged: true,
    now: () => 10 * DAY, sealed: () => flags.sealed, authorize: gate.authorize,
  });
  t.after(() => manager.dispose());
  return { flags, recorder, calls, manager, profile, cancel: () => cancelDownload };
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
  await assert.rejects(h.manager.check(true), (e) => isSealedModeError(e));
  assert.equal(h.calls.check, 0);
  assert.deepEqual([h.recorder.list()[0].task, h.recorder.list()[0].outcome], ["appUpdate", "blocked"]);
});

test("an unsealed check is attributed to appUpdate", async (t) => {
  const h = harness(t);
  await h.manager.check(true);
  assert.equal(h.calls.check, 1);
  assert.deepEqual([h.recorder.list()[0].task, h.recorder.list()[0].outcome], ["appUpdate", "ok"]);
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/helpers/downloadsSealed.test.js test/helpers/updateManagerSealed.test.js`
Expected: FAIL. Downloads reach `net.request`, and `UpdateManager` ignores `sealed`.

- [ ] **Step 3: Gate `downloadUtils.js`**

1. Add `const egress = require("./privacy/egressGate");` and `const fs = require("node:fs");` (if it is not already required).
2. Rename the existing `async function downloadFile(url, destPath, options = {})` to `downloadFileUngated`. Add the gated export above it:

   ```js
   // Every model and runtime download goes through here (threat model N12/N13).
   async function downloadFile(url, destPath, options = {}) {
     const { egressTask = "modelDownload", ...rest } = options;
     return egress.guard(
       {
         task: egressTask,
         target: url,
         settleFrom: () => {
           try {
             return { bytesIn: fs.statSync(destPath).size };
           } catch {
             return {};
           }
         },
       },
       (ticket) => {
         // downloadAttempt understands createDownloadSignal()'s { aborted, onAbort }.
         const { signal, abort } = rest.signal ? { signal: rest.signal, abort: null } : createDownloadSignal();
         ticket.signal.addEventListener(
           "abort",
           () => {
             if (abort) abort();
             else {
               signal.aborted = true;
               signal.onAbort?.();
             }
           },
           { once: true }
         );
         return downloadFileUngated(url, destPath, { ...rest, signal });
       }
     );
   }
   ```

3. In `fetchJson` (`:250`), change the first line to `const { headers, egressTask = "modelDownload", ...init } = options;` and wrap the body:

   ```js
     return egress.guard({ task: egressTask, target: url }, async (ticket) => {
       const response = await net.fetch(url, {
         method: "GET",
         useSessionCookies: false,
         ...init,
         signal: init.signal ? AbortSignal.any([init.signal, ticket.signal]) : ticket.signal,
         headers: { "User-Agent": USER_AGENT, ...(headers || {}) },
       });
       ticket.noteStatus(response.status);
       /* …rest of the existing body unchanged… */
     });
   ```

4. In `gpuBinaryManager.js`:
   - `:110`: `fetchJson(this.config.releaseUrl, { headers: githubReleaseHeaders(), egressTask: "runtimeDownload" })`.
   - `:184`: add `egressTask: "runtimeDownload",` to the `downloadFile` options.

- [ ] **Step 4: Gate URL import**

In `src/helpers/urlAudioDownloader.js`, add `const egress = require("./privacy/egressGate");` and replace `download` (`:1525-1534`):

```js
async function download(url, onProgress, abortSignal) {
  return egress.guard({ task: "urlImport", target: url }, (ticket) => {
    // Sealing aborts the transfer and kills a running yt-dlp child.
    const signal = abortSignal ? AbortSignal.any([abortSignal, ticket.signal]) : ticket.signal;
    const type = detectUrlType(url);
    debugLogger.log("URL audio download starting", { url, type });
    if (type === "youtube") return downloadYouTube(url, onProgress, signal);
    return downloadDirect(url, onProgress, signal);
  });
}
```

At the top of `maybeUpdateYtDlp`'s promise executor (`:391`, before `const stampPath`), add:

```js
    // Sealed mode: yt-dlp would contact GitHub itself, out of main's sight.
    if (egress.isSealed()) return resolve();
```

- [ ] **Step 5: Gate updates**

In `src/helpers/updateManager.js`:

1. Add `const { SealedModeError } = require("./privacy/egressPolicy");` and `const UPDATE_HOST = "https://api.github.com";`.
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
   - as the first line of the `finally` block (`:166`), add `ticket.settle({ outcome: "ok" });`. `settle` is idempotent, so this only records the paths the `catch` did not, including the early `return` inside the `try` at `:144`. Without it, that early return would leave the ticket active, and the attestation could never become true;
   - at the start of the `catch` (`:159`), add:

   ```js
       if (this.sealed()) {
         ticket.settle({ outcome: "cancelled", errorClass: "SEALED_MODE" });
         this.publish({ phase: "idle", availableVersion: undefined, progress: undefined });
         return this.status();
       }
       ticket.settle({ outcome: "error", errorClass: "UPDATE_FAILED" });
   ```

   Change `catch {` to `catch (error) {` only if your linter requires the binding; the variable is not used.

6. Add a method after `restart()`:

   ```js
     // Called by the Sealed mode transition: stop any check or download in flight.
     pauseForSeal() {
       this.cancel?.cancel();
       if (["checking", "downloading"].includes(this.state.phase))
         this.publish({ phase: "idle", availableVersion: undefined, progress: undefined });
     }
   ```

In `src/helpers/updateIPC.js`:
- add `sealed` to the destructure at `:29` (`function attachUpdateIPC({ app, ipcMain, BrowserWindow, updater, busy, activity, teardown, sealed })`);
- pass `sealed,` into the `new UpdateManager({ … })` options (`:85-98`).

In `main.js`, add `sealed: () => privacy.state.isSealed(),` to the `attachUpdateIPC({ … })` call.

In `src/types/updates.ts`, add `sealed?: boolean;` to `UpdateStatus`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- test/helpers/downloadsSealed.test.js test/helpers/updateManagerSealed.test.js test/helpers/updateManager.test.js`
Expected: PASS. The last file is the existing update suite (if present; `ls test/helpers | grep -i update`), and it still passes because `sealed` defaults to `() => false`.

- [ ] **Step 7: Commit**

```bash
git add src/helpers/downloadUtils.js src/helpers/gpuBinaryManager.js src/helpers/urlAudioDownloader.js src/helpers/updateManager.js src/helpers/updateIPC.js src/types/updates.ts main.js test/helpers/downloadsSealed.test.js test/helpers/updateManagerSealed.test.js
git commit -m "feat(privacy): gate downloads, URL import and update checks"
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

This task is the dedicated enforcement matrix. One file drives every `blocked` row of the inventory (N1–N20) through its real chokepoint, with Sealed mode on. Each row must show three things:
1. the caller receives `SealedModeError`;
2. the transport spy was never called, so no socket or DNS query happened;
3. the ledger holds a `blocked` row with `bytesOut: 0` and the right task.

Loopback rows prove local routes still work. A raw-transport row proves that a request site nobody has gated is still refused by Layer B. A ratchet ties the matrix to the threat model, so a new `blocked` row cannot ship untested.

**Files:**
- Test: `test/helpers/sealedModeEnforcement.test.js`

**Interfaces:**
- Consumes every chokepoint from Tasks 6–11.

- [ ] **Step 1: Write the matrix**

Create `test/helpers/sealedModeEnforcement.test.js`:

```js
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const https = require("node:https");
const http = require("node:http");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

// One spy per transport. Every blocked row must leave all of them untouched.
const transport = { netFetch: 0, netRequest: 0, nodeFetch: 0 };
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron")
    return {
      app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd(), isReady: () => false, getName: () => "test" },
      net: {
        fetch: async () => { transport.netFetch++; return new Response("{}", { status: 200 }); },
        request: () => { transport.netRequest++; throw new Error("net.request reached"); },
      },
      shell: { openExternal: async () => {} },
      BrowserWindow: { getAllWindows: () => [] },
    };
  return originalLoad.call(this, request, parent, isMain);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => { transport.nodeFetch++; return originalFetch(...args); };
test.after(() => { Module._load = originalLoad; globalThis.fetch = originalFetch; });

const gate = require("../../src/helpers/privacy/egressGate");
const backstop = require("../../src/helpers/privacy/egressBackstop");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError } = require("../../src/helpers/privacy/egressPolicy");
const { gatedNetFetch, gatedNodeFetch } = require("../../src/helpers/privacy/gatedFetch");
const stt = require("../../src/helpers/sttTransport");
const { downloadFile, fetchJson } = require("../../src/helpers/downloadUtils");
const urlAudio = require("../../src/helpers/urlAudioDownloader");
const { testProviderConnection } = require("../../src/helpers/providerConnectionTest");
const { REALTIME_TOKEN_PROVIDERS } = require("../../src/helpers/realtimeTokenProviders");
const { registerPersonalInferenceIPC, gatedVerifyRelease } = require("../../src/helpers/personalInference");
const { UpdateManager } = require("../../src/helpers/updateManager");
const MicrosoftCalendarManager = require("../../src/helpers/microsoftCalendarManager");
const googleOAuthModule = require("../../src/helpers/googleCalendarOAuth");

let recorder;
const flags = { sealed: true };
backstop.installNodeBackstop();
test.beforeEach(() => {
  flags.sealed = true;
  for (const k of Object.keys(transport)) transport[k] = 0;
  recorder = new FlightRecorder({ now: () => 1 });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now: () => 1 });
});

function inference() {
  const handlers = new Map();
  const codex = Object.assign(new EventEmitter(), {
    child: null, status: async () => ({}), login: async () => ({}), cancelLogin: async () => {}, logout: async () => {},
    models: async () => [], rateLimits: async () => ({}), stop() {}, erase: async () => {}, generate: async () => "x",
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
const ask = (overrides) => ({
  requestId: `m-${Math.random()}`, model: "m", messages: [{ role: "user", content: "x" }], ...overrides,
});
const multipart = () => stt.buildMultipartBody(Buffer.from("RIFF"), "a.wav", "audio/wav", {});
const updateManager = () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-matrix-upd-"));
  fs.writeFileSync(path.join(profile, "updates.json"), JSON.stringify({ enabled: true, onboarded: true }));
  return new UpdateManager({
    updater: { on() {}, checkForUpdates: async () => { transport.netRequest++; return {}; }, downloadUpdate: async () => {} },
    profile, version: "1.0.0", supported: true, packaged: true, sealed: () => flags.sealed, authorize: gate.authorize,
  });
};
const GoogleOAuth = googleOAuthModule; // module.exports = GoogleCalendarOAuth (googleCalendarOAuth.js:169)

// id → [expected ledger task, action that must be refused]
const BLOCKED = {
  N1: ["chat", () => inference()("text-generate", ask({ provider: "openai", credentialRef: "openai", inferenceScope: "chatIntelligence" }))],
  N2: ["noteFormatting", () => inference()("text-generate", ask({ provider: "bedrock", inferenceScope: "noteFormatting" }))],
  N3: ["providerCheck", () => inference()("models", { provider: "openrouter", credentialRef: "openrouter" })],
  N4: ["providerCheck", () => testProviderConnection({ provider: "groq", apiKey: "k" }, gatedNodeFetch("providerCheck"))],
  N5: ["dictationStt", () => gate.withTask("dictationStt", () => { const m = multipart(); return stt.postMultipart(new URL("https://api.openai.com/v1/audio/transcriptions"), m.body, m.boundary); })],
  N6: ["dictationStt", () => gate.withTask("dictationStt", () => gatedNetFetch("https://generativelanguage.googleapis.com/v1beta/interactions", { method: "POST", body: "{}" }))],
  N7: ["dictationStt", () => gate.withTask("dictationStt", () => gatedNetFetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST" }))],
  N8: ["dictationCleanup", () => gate.withTask("dictationCleanup", () => gatedNetFetch("https://api.anthropic.com/v1/messages", { method: "POST", body: "{}" }))],
  N9: ["noteRecordingStt", () => stt.connectRealtime({ task: "noteRecordingStt", provider: "deepgram-realtime" }, async () => {})],
  N10: ["dictationStt", () => gate.withTask("dictationStt", () => REALTIME_TOKEN_PROVIDERS["assemblyai-realtime"]({ environmentManager: { getAssemblyAIKey: () => "k" }, proxyFetch: gatedNetFetch }, {}, 1))],
  N11: ["providerCheck", () => require("../../src/helpers/tinfoilCatalog").getTinfoilChatModels()],
  N12: ["modelDownload", () => downloadFile("https://huggingface.co/x/model.bin", path.join(os.tmpdir(), `m-${Date.now()}.bin`))],
  N13: ["runtimeDownload", () => fetchJson("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest", { egressTask: "runtimeDownload" })],
  N14: ["urlImport", () => urlAudio.download("https://example.com/a.mp3", () => {}, new AbortController().signal)],
  N16: ["appUpdate", () => updateManager().check(true)],
  N17: ["codex", () => gatedVerifyRelease(async () => { transport.nodeFetch++; })({})],
  N18: ["codex", () => inference()("codex-status")],
  N19: ["calendar", () => new GoogleOAuth({})._httpsPost("https://oauth2.googleapis.com/token", "code=x")],
};
// Rows without a refusal to observe: they are prevented, not refused.
const PREVENTED = {
  N15: async () => { await urlAudio.maybeUpdateYtDlp({ force: true }); assert.equal(urlAudio._isYtDlpUpdateInFlight(), false); },
  N20: async () => {
    const main = fs.readFileSync(path.join(__dirname, "../../main.js"), "utf8");
    assert.match(main, /if \(!privacy\.state\.isSealed\(\)\) \{\s*googleCalendarManager\.start\(\);/);
    const manager = new MicrosoftCalendarManager({}, { scheduleNextMeeting() {} });
    manager.oauth = { getValidAccessToken: async () => "token" };
    await assert.rejects(manager._apiGet("/me/events", "user@example.com"), (e) => isSealedModeError(e));
  },
};

for (const [id, [task, action]] of Object.entries(BLOCKED)) {
  test(`${id}: sealed main refuses it before any transport, as ${task}`, async () => {
    await assert.rejects(Promise.resolve().then(action), (error) => isSealedModeError(error));
    assert.deepEqual(transport, { netFetch: 0, netRequest: 0, nodeFetch: 0 }, `${id} touched a transport`);
    const blocked = recorder.list().filter((r) => r.outcome === "blocked");
    assert.ok(blocked.length >= 1, `${id} left a blocked ledger row`);
    assert.equal(blocked[0].task, task);
    assert.equal(blocked[0].bytesOut, 0);
  });
}
for (const [id, check] of Object.entries(PREVENTED)) test(`${id}: prevented while sealed`, check);

test("local routes keep working while sealed", async () => {
  const server = http.createServer((_req, res) => res.end("{}"));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    const m = multipart();
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
```

The loopback row sends a self-hosted upload through the stubbed `net.fetch`, which returns `{}`. If `postMultipart`'s response handling needs another minimal JSON shape (for example `{ "text": "" }`), return that from the stub.

`N4` relies on Task 8's change, which makes `testProviderConnection` rethrow sealed errors from its transport `catch`. If `resolveProviderRequest` (`providerConnectionTest.js:154`) needs a different config shape for Groq, adjust only the config literal.

- [ ] **Step 2: Run the matrix**

Run: `npm test -- test/helpers/sealedModeEnforcement.test.js`
Expected: PASS (23 tests: 18 refused rows, 2 prevented rows, local routes, the Layer B row and the ratchet). Any failure names the inventory row whose enforcement is missing. Fix the owning task's code, never the assertions.

- [ ] **Step 3: Commit**

```bash
git add test/helpers/sealedModeEnforcement.test.js
git commit -m "test(privacy): prove a sealed main process refuses every blocked request type"
```

---
### Task 13: Renderer integration: sealed store, route graph and preserved-content errors

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
  - `src/helpers/audioManager.js:1915-1922` (renderer code).
- Test:
  - `test/lib/sealedMode.test.js`
  - `test/utils/sealedModeError.test.js`
  - `test/hooks/useSealedMode.test.js`
  - `test/lib/routesSealed.test.js`

**Interfaces:**
- Consumes:
  - `window.electronAPI.privacy` (Task 7);
  - `ResolvedRoute`, `RouteSettingsSnapshot`, `resolveRoutes` and `useResolvedRoutes` from `src/lib/routes.ts` (§5.1);
  - `Locality` from `src/lib/locality.ts` (Plan 01).
- Produces:

  ```ts
  // src/hooks/useSealedMode.ts
  export type SealedSnapshot = { sealed: boolean | null; attestation: Attestation | null }; // null = unknown → the UI claims nothing
  export function useSealedMode(): SealedSnapshot;
  export function setSealedMode(sealed: boolean): Promise<Attestation>;
  export function subscribeSealed(listener: () => void): () => void;
  export function getSealedSnapshot(): SealedSnapshot;
  export function _resetSealedStoreForTests(): void;

  // src/lib/sealedMode.ts
  export function isRouteSealed(route: { locality: Locality }, sealed: boolean | null): boolean;
  export function applySealToRoute<R extends ResolvedRoute>(route: R, sealed: boolean | null): R;

  // src/utils/sealedModeError.ts
  export const SEALED_MODE = "SEALED_MODE";
  export function isSealedModeError(error: unknown): boolean;
  export function sealedDictationMessageKey(s: { dataRetentionEnabled: boolean; audioRetentionDays: number }): string;

  // src/components/chat/chatErrorContent.ts
  export function chatErrorContent(error: unknown, t: (key: string) => string): string;
  ```

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

test("recognises the code, the IPC message marker and wrapped causes", async () => {
  const { isSealedModeError } = await load();
  assert.equal(isSealedModeError({ code: "SEALED_MODE" }), true);
  assert.equal(isSealedModeError(new Error("Error invoking remote method 'x': [SEALED_MODE] Sealed mode is on")), true);
  assert.equal(isSealedModeError(new TypeError("fetch failed", { cause: { code: "SEALED_MODE" } })), true);
  assert.equal(isSealedModeError(new Error("timeout")), false);
  assert.equal(isSealedModeError(undefined), false);
});

test("the dictation copy only promises History when retention really kept the audio", async () => {
  const { sealedDictationMessageKey } = await load();
  assert.equal(sealedDictationMessageKey({ dataRetentionEnabled: true, audioRetentionDays: 30 }), "sealedMode.blocked.dictationKept");
  assert.equal(sealedDictationMessageKey({ dataRetentionEnabled: true, audioRetentionDays: 0 }), "sealedMode.blocked.dictationNotKept");
  assert.equal(sealedDictationMessageKey({ dataRetentionEnabled: false, audioRetentionDays: 30 }), "sealedMode.blocked.dictationNotKept");
});

test("chat keeps the message and says why", async () => {
  const { chatErrorContent } = await loadChat();
  assert.equal(chatErrorContent({ code: "SEALED_MODE", message: "[SEALED_MODE] …" }, t), "t:sealedMode.blocked.chat");
  assert.equal(chatErrorContent(new Error("rate limited"), t), "t:agentMode.chat.errorPrefix: rate limited");
});

test("local inference and recording errors map SEALED_MODE to translated copy", async () => {
  const { buildLocalInferenceError } = await loadLocal();
  assert.equal(buildLocalInferenceError({ success: false, error: "x", code: "SEALED_MODE" }).messageKey, "sealedMode.blocked.generic");
  const { getRecordingErrorTitle } = await loadRecording();
  assert.equal(getRecordingErrorTitle({ code: "SEALED_MODE", title: "raw" }, t), "t:sealedMode.blocked.dictationTitle");
});
```

Create `test/hooks/useSealedMode.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const load = () => import("../../src/hooks/useSealedMode.ts");

function fakePrivacy({ sealed = true } = {}) {
  const listeners = {};
  const attestation = { sealed, nothingLeaves: sealed, sealedSince: 1, blockedSinceSealed: 0 };
  return {
    listeners,
    api: {
      getSealed: async () => sealed,
      getAttestation: async () => attestation,
      setSealed: async (next) => ({ ...attestation, sealed: next, nothingLeaves: next }),
      onSealedChange: (cb) => { listeners.sealed = cb; return () => {}; },
      onEgress: (cb) => { listeners.egress = cb; return () => {}; },
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
  fake.listeners.sealed(false);
  assert.equal(store.getSealedSnapshot().sealed, false);
  assert.ok(notified >= 2);
});

test("setSealedMode adopts main's attestation, not the requested value", async (t) => {
  const store = await load();
  store._resetSealedStoreForTests();
  globalThis.window = { electronAPI: { privacy: fakePrivacy({ sealed: false }).api } };
  t.after(() => { delete globalThis.window; store._resetSealedStoreForTests(); });
  const attestation = await store.setSealedMode(true);
  assert.equal(store.getSealedSnapshot().sealed, attestation.sealed);
  assert.equal(store.getSealedSnapshot().attestation, attestation);
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

Create `test/lib/routesSealed.test.js`. This is CCR-2 against Plan 03's resolver. First find the snapshot builder Plan 03's own tests use (`grep -rln "RouteSettingsSnapshot\|resolveRoutes" test/`), and import it in place of `makeSnapshot` below. If Plan 03 ships none, build one inline with the fields its tests set.

```js
const assert = require("node:assert/strict");
const test = require("node:test");

test("resolveRoutes applies the seal last, to every non-device route", async () => {
  const routes = await import("../../src/lib/routes.ts");
  const { applySealToRoute } = await import("../../src/lib/sealedMode.ts");
  const { makeSnapshot } = require("./routesFixture"); // ← Plan 03's fixture module (see above)
  const open = routes.resolveRoutes({ ...makeSnapshot(), sealed: false });
  const sealed = routes.resolveRoutes({ ...makeSnapshot(), sealed: true });
  assert.equal(sealed.length, 11);
  assert.deepEqual(sealed, open.map((route) => applySealToRoute(route, true)));
  assert.ok(sealed.some((r) => r.locality !== "device" && r.state.status === "unreachable" && r.state.detail === "sealed"),
    "the fixture has at least one remote route; otherwise this test proves nothing");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/lib/sealedMode.test.js test/utils/sealedModeError.test.js test/hooks/useSealedMode.test.js test/lib/routesSealed.test.js`
Expected: FAIL with missing modules, and `sealed` is ignored by `resolveRoutes`.

- [ ] **Step 3: Implement the pure modules**

Create `src/lib/sealedMode.ts`:

```ts
import type { Locality } from "./locality";
import type { ResolvedRoute } from "./routes";

// Sealed mode keeps only on-device (loopback) routes. A LAN server is another
// machine, so `network` routes pause too (CCR-1). Unknown (null) never claims.
export function isRouteSealed(route: { locality: Locality }, sealed: boolean | null): boolean {
  return sealed === true && route.locality !== "device";
}

export function applySealToRoute<R extends ResolvedRoute>(route: R, sealed: boolean | null): R {
  if (!isRouteSealed(route, sealed) || route.state.status === "off") return route;
  return { ...route, state: { status: "unreachable", detail: "sealed" } };
}
```

Create `src/utils/sealedModeError.ts`:

```ts
// Mirrors src/helpers/privacy/egressPolicy.js. ipcMain.handle keeps only the
// message of a rejected promise, so main also puts the code in the text.
export const SEALED_MODE = "SEALED_MODE";

export function isSealedModeError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 3) return false;
  const e = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (e.code === SEALED_MODE) return true;
  if (typeof e.message === "string" && e.message.includes(`[${SEALED_MODE}]`)) return true;
  return isSealedModeError(e.cause, depth + 1);
}

// saveFailedTranscription keeps the audio only when local history is on and
// audio retention is above 0, so the copy promises History only then.
export function sealedDictationMessageKey(settings: { dataRetentionEnabled: boolean; audioRetentionDays: number }): string {
  return settings.dataRetentionEnabled && settings.audioRetentionDays > 0
    ? "sealedMode.blocked.dictationKept"
    : "sealedMode.blocked.dictationNotKept";
}
```

Create `src/components/chat/chatErrorContent.ts`:

```ts
import { isSealedModeError } from "../../utils/sealedModeError";

// The assistant bubble's text when a reply fails. The user's own message is
// never touched; a sealed block says so instead of showing a transport error.
export function chatErrorContent(error: unknown, t: (key: string) => string): string {
  if (isSealedModeError(error)) return t("sealedMode.blocked.chat");
  return `${t("agentMode.chat.errorPrefix")}: ${(error as Error)?.message ?? String(error)}`;
}
```

Create `src/hooks/useSealedMode.ts`:

```ts
import { useSyncExternalStore } from "react";
import type { Attestation, EgressNotice } from "../types/privacy";

export type SealedSnapshot = { sealed: boolean | null; attestation: Attestation | null };

const UNKNOWN: SealedSnapshot = { sealed: null, attestation: null };
let snapshot: SealedSnapshot = UNKNOWN;
const listeners = new Set<() => void>();
let started = false;

function publish(patch: Partial<SealedSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

const privacyApi = () => (typeof window === "undefined" ? undefined : window.electronAPI?.privacy);

async function refreshAttestation() {
  const api = privacyApi();
  if (!api) return;
  try {
    publish({ attestation: await api.getAttestation() });
  } catch {
    // Keep the last attestation; the panel shows it as unverified if stale.
  }
}

// Main is the only source of truth: nothing here guesses the sealed state.
function start() {
  if (started) return;
  started = true;
  const api = privacyApi();
  if (!api) return;
  api.getSealed().then((sealed) => publish({ sealed }), () => {});
  void refreshAttestation();
  api.onSealedChange((sealed) => {
    publish({ sealed });
    void refreshAttestation();
  });
  api.onEgress?.((notice: EgressNotice) => {
    if (notice.phase === "recorded" && notice.event.outcome === "blocked") void refreshAttestation();
  });
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

export async function setSealedMode(sealed: boolean): Promise<Attestation> {
  const attestation = await window.electronAPI.privacy.setSealed(sealed);
  publish({ sealed: attestation.sealed, attestation });
  return attestation;
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

- [ ] **Step 5: Preserve content and say why**

1. `src/components/chat/useChatStreaming.ts:536-546`. Replace the `content:` line in the error branch with:

   ```ts
                       content: chatErrorContent(error, t),
   ```

   Add `import { chatErrorContent } from "./chatErrorContent";`. The user's message entry is not modified; only the assistant placeholder's text changes.
2. `src/utils/localInferenceError.ts`. Before `return error;` (`:65`), add:

   ```ts
     } else if (result.code === "SEALED_MODE") {
       error.messageKey = "sealedMode.blocked.generic";
   ```

   This is one more `else if` in the existing chain, placed after the `OUTPUT_TRUNCATED` branch.
3. `src/utils/recordingErrors.ts`. As the first line of `getRecordingErrorTitle`, add `if (error.code === "SEALED_MODE") return t("sealedMode.blocked.dictationTitle");`.
4. `src/helpers/audioManager.js`, the dictation pipeline `catch` (`:1903-1928`). Directly before the error toast (`:1915`), add:

   ```js
         if (error?.code === "SEALED_MODE") {
           // The same values saveFailedTranscription() decides with (:3111).
           error.messageKey = sealedDictationMessageKey(getEffectiveRetentionPreferences());
         }
   ```

   `getEffectiveRetentionPreferences()` is what `saveFailedTranscription` (`:3110`) calls at `:3111`; it returns `{ dataRetentionEnabled, audioRetentionDays }`. Import `sealedDictationMessageKey` from `../utils/sealedModeError`. The existing `saveFailedTranscription(...)` call that follows stays: it keeps the recording for retry whenever retention allows.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- test/lib/sealedMode.test.js test/utils/sealedModeError.test.js test/hooks/useSealedMode.test.js test/lib/routesSealed.test.js test/helpers/useChatStreamingCancellation.test.js test/helpers/useChatStreamingFlush.test.js && npm run typecheck`
Expected: PASS, and typecheck is clean.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useSealedMode.ts src/lib/sealedMode.ts src/utils/sealedModeError.ts src/components/chat/chatErrorContent.ts src/lib/routes.ts src/components/chat/useChatStreaming.ts src/utils/localInferenceError.ts src/utils/recordingErrors.ts src/helpers/audioManager.js test/lib/sealedMode.test.js test/utils/sealedModeError.test.js test/hooks/useSealedMode.test.js test/lib/routesSealed.test.js
git commit -m "feat(privacy): reflect Sealed mode in routes and keep content on sealed failures"
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
const attested = { sealed: true, sealedSince: 5, loadError: null, saveError: null, guards: { node: true, sessions: 2 },
  networkChildren: [], activeRemote: 0, blockedSinceSealed: 3, recordFailures: 0, nothingLeaves: true };

test("the 'nothing has left' claim appears only when main attests it", async () => {
  const { sealedStatusLines } = await copy();
  const keys = (s, a) => sealedStatusLines(s, a, time).map((l) => l.key);
  assert.ok(keys(true, attested).includes("settingsPage.privacy.sealed.attested"));
  for (const variant of [
    { ...attested, nothingLeaves: false, networkChildren: ["codex"] },
    { ...attested, nothingLeaves: false, guards: { node: true, sessions: 0 } },
    { ...attested, nothingLeaves: false, activeRemote: 1 },
  ]) {
    assert.equal(keys(true, variant).includes("settingsPage.privacy.sealed.attested"), false);
  }
  assert.deepEqual(keys(true, null), ["settingsPage.privacy.sealed.on", "settingsPage.privacy.sealed.unverified.pending"]);
  assert.deepEqual(keys(null, null), ["settingsPage.privacy.sealed.unknown"]);
  assert.deepEqual(keys(false, { ...attested, sealed: false, nothingLeaves: false }), ["settingsPage.privacy.sealed.description"]);
});

test("each unverified reason names its cause", async () => {
  const { sealedStatusLines } = await copy();
  const line = (a) => sealedStatusLines(true, a, time).find((l) => l.tone === "warn");
  assert.equal(line({ ...attested, nothingLeaves: false, networkChildren: ["codex"] }).key, "settingsPage.privacy.sealed.unverified.child");
  assert.deepEqual(line({ ...attested, nothingLeaves: false, networkChildren: ["codex"] }).params, { names: "codex" });
  assert.equal(line({ ...attested, nothingLeaves: false, guards: { node: false, sessions: 1 } }).key, "settingsPage.privacy.sealed.unverified.guards");
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
  if (!a.guards.node || a.guards.sessions === 0) return { key: `${P}.unverified.guards`, tone: "warn" };
  if (a.networkChildren.length > 0)
    return { key: `${P}.unverified.child`, params: { names: a.networkChildren.join(", ") }, tone: "warn" };
  return { key: `${P}.unverified.active`, tone: "warn" };
}

// The only place the panel decides what it may claim. "Nothing has left" is
// shown solely when main's attestation says so (D6).
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
    if (attestation?.nothingLeaves && attestation.sealedSince != null)
      lines.push({
        key: `${P}.attested`,
        params: { time: formatTime(attestation.sealedSince), count: attestation.blockedSinceSealed },
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
  "settingsPage.privacy.sealed.title": "Sealed mode",
  "settingsPage.privacy.sealed.description": "Blocks every request that would leave this computer. On-device models keep working.",
  "settingsPage.privacy.sealed.on": "Cloud routes are paused. Local routes keep working. Turn this off to resume them.",
  "settingsPage.privacy.sealed.attested": "Nothing has left this computer since {{time}}. Requests blocked since then: {{count}}.",
  "settingsPage.privacy.sealed.unverified.pending": "Checking that nothing can leave this computer…",
  "settingsPage.privacy.sealed.unverified.guards": "Sealed mode is on, but Loqui can't confirm its network guards are active. Restart Loqui.",
  "settingsPage.privacy.sealed.unverified.child": "Sealed mode is on, but {{names}} is still running and may use the network. It stops shortly.",
  "settingsPage.privacy.sealed.unverified.active": "Sealed mode is on. Stopping requests that started before you turned it on.",
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
- **Claims.** The panel may say "Nothing has left this computer" only when main's `Attestation.nothingLeaves` is true. Unknown state shows no claim and a disabled switch. Load or save problems are always shown.
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
- Consumes `privacy.listEgress`, `egressSummary`, `clearEgress`, `exportEgressCsv`, `onEgress` and `onEgressCleared` (Task 7). Uses `formatBytes` from `src/utils/formatBytes` and `ConfirmDialog` from `src/components/ui/dialog` (`open`, `onOpenChange`, `title`, `description`, `confirmText`, `onConfirm`, `variant`).
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
const HOUR = 3600000;
const now = Date.UTC(2026, 9, 15, 12, 0);
const ev = (o) => ({ id: 1, ts: now - HOUR, task: "chat", host: "api.groq.com", bytesOut: 3100, bytesIn: 9800, outcome: "ok", status: 200, errorClass: null, model: "gpt-oss-120b", attributed: true, ...o });

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

test("live notices: recorded events are prepended once; started notices are ignored", async () => {
  const { mergeNotice } = await view();
  const list = [ev({ id: 1 })];
  const next = mergeNotice(list, { phase: "recorded", event: ev({ id: 2, ts: now }) }, 0);
  assert.deepEqual(next.map((e) => e.id), [2, 1]);
  assert.equal(mergeNotice(next, { phase: "recorded", event: ev({ id: 2, ts: now }) }, 0), next);
  assert.equal(mergeNotice(next, { phase: "started", ticketId: 9, task: "chat", host: "x", ts: now }, 0), next);
  assert.equal(mergeNotice(next, { phase: "recorded", event: ev({ id: 3, ts: 5 }) }, 10), next, "older than the window");
});

test("the view: counts, hollow blocked ticks, unknown bytes, LTR hosts, unexplained notice", async () => {
  const { FlightRecorderView } = await panel();
  const html = renderStatic(FlightRecorderView, {
    t, now, formatTime: (ms) => `T${ms}`, onExport() {}, onClear() {},
    events: [ev({ id: 1, bytesIn: null }), ev({ id: 2, outcome: "blocked", bytesOut: 0, bytesIn: 0 }), ev({ id: 3, task: "unattributed", host: "x.example.com", attributed: false })],
    summary: { left: 2, blocked: 1, unattributed: 1, unattributedHosts: ["x.example.com"], bytesOut: 3100, bytesIn: 9800, unknownBytes: 1 },
  });
  assert.match(html, /settingsPage\.privacy\.recorder\.leftToday\{"count":2\}/);
  assert.match(html, /data-kind="blocked"/);
  assert.match(html, /settingsPage\.privacy\.recorder\.unknownBytes/);
  assert.match(html, /dir="ltr"[^>]*>api\.groq\.com/);
  assert.match(html, /role="status"[^>]*>[^<]*settingsPage\.privacy\.recorder\.unexplained\{"host":"x\.example\.com"\}/);
  assert.doesNotMatch(html, /secret|prompt/i);
});

test("the empty state makes no network claim beyond what was recorded", async () => {
  const { FlightRecorderView } = await panel();
  const html = renderStatic(FlightRecorderView, {
    t, now, formatTime: String, onExport() {}, onClear() {}, events: [],
    summary: { left: 0, blocked: 0, unattributed: 0, unattributedHosts: [], bytesOut: 0, bytesIn: 0, unknownBytes: 0 },
  });
  assert.match(html, /settingsPage\.privacy\.recorder\.empty/);
  assert.match(html, /settingsPage\.privacy\.recorder\.loopbackNote/);
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
import { ConfirmDialog } from "../ui/dialog";
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
                <td><Bytes n={e.bytesOut} t={t} /></td>
                <td><Bytes n={e.bytesIn} t={t} /></td>
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
  const [confirming, setConfirming] = useState(false);
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
        onClear={() => setConfirming(true)}
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t(`${R}.clearTitle`)}
        description={t(`${R}.clearBody`, { count: events.length })}
        confirmText={t(`${R}.clearConfirm`, { count: events.length })}
        variant="destructive"
        onConfirm={() => void api?.clearEgress()}
      />
    </>
  );
}
```

The ledger list for the dialog's count is today's view; `clearEgress` deletes all history. If `--color-locality-remote` is not the exact token Plan 01 shipped, use whichever `--color-locality-*` token marks remote.

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
  "settingsPage.privacy.recorder.empty": "Nothing has left this computer today.",
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
  "settingsPage.privacy.recorder.clearTitle": "Clear the flight recorder?",
  "settingsPage.privacy.recorder.clearBody": "This deletes the flight recorder history on this computer, including the {{count}} records from today. It does not change anything a provider already received.",
  "settingsPage.privacy.recorder.clearConfirm": "Clear history",
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

`clearConfirm` takes no count. The `ConfirmDialog` call above passes `{ count }` to it harmlessly; i18next ignores unused params.

- [ ] **Step 6: Docs**

Add this section to `docs/PRIVACY.md`, after "When network requests occur" and before "Updates and calendars":

```markdown
## Sealed mode and the flight recorder

**Sealed mode** (Privacy & Data) is enforced in the main process. While it is on, Loqui sends nothing that leaves this computer: provider requests, connection checks, model and runtime downloads, update checks, Codex, calendars and URL imports are all refused before a connection opens, and work already in flight is stopped. Only loopback (`localhost`, `127.0.0.0/8`, `::1`) is reachable, so on-device models keep working. A self-hosted server on another machine on your network is blocked too. Links you open in your browser are your browser's traffic, not Loqui's. If the setting file cannot be read, Loqui stays sealed. The panel says "nothing has left this computer" only when the main process confirms its network guards are active and no network-capable helper is running.

When Sealed mode blocks a request, your content is kept: a chat message stays in the conversation, and a dictation recording is kept in History for retry when local history and audio retention allow it.

The **flight recorder** lists requests that left this computer: time, task, destination host, bytes sent and received when measurable, outcome, HTTP status or error class, and model id. It never stores audio, text, prompts, keys, full URLs or error messages. Records follow transcript retention (with "Forever", the newest 100,000 are kept). With local history off, records are kept in memory only and disappear when Loqui quits. **Export CSV** saves a copy you choose the location of; **Clear history** deletes the records from this computer.
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
- **Privacy & Data shows Sealed mode first.** Off, it is a normal card. Toggling it on turns the panel navy and shows "Nothing has left this computer since …" within about a second.
- **Chat with a cloud provider while sealed.** The reply bubble reads "Chat paused: Sealed mode is on. Your message is kept." The message is still there, and the recorder gains a hollow "Blocked" tick.
- **Dictate with a cloud STT route while sealed.** The toast title is "Not transcribed: Sealed mode is on". With history on, the recording appears in History with Retry. Retrying after unsealing works.
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
3. Bypass attempts. Hostnames that resolve to loopback, IPv6 forms, IPv4-mapped IPv6, decimal/octal IP spellings, trailing dots, uppercase, `localhost.` vs `localhost.example`; proxies (system proxy, HTTPS_PROXY env) — does a proxied request connect to a loopback proxy that then forwards off-machine? (A local proxy on 127.0.0.1 would pass Layer B; decide whether to also refuse when a proxy is configured.)
4. Child processes. Codex app-server is killed on seal and never spawned while sealed; yt-dlp downloads are killed and self-update skipped; llama-server/whisper-server/parakeet/qdrant are started with loopback-only binds and no download flags (e.g. llama.cpp `-hf`, `--model-url`); the ONNX utility process has no network code.
5. Transition races. Toggle sealed rapidly; seal during: chat stream, realtime STT, model download, update download, URL import, Codex turn, calendar OAuth. Check attestation.nothingLeaves only becomes true after everything is stopped, and that no request authorised before the seal completes a new connection after it.
6. Fail-closed state. Corrupt/unreadable/unwritable privacy.json; isSealed throwing; boot order (guards installed before any helper require; before app ready).
7. IPC. Only main/control-panel windows can set-sealed or clear/export the ledger; argument validation; the control panel runs with sandbox:false/webSecurity:false (windowConfig.js:223-237) — assess whether that lets renderer content flip the switch or exfiltrate around Layer B, and recommend.
8. Ledger privacy. No content, prompts, keys, URL paths/queries or error messages can reach egress_events or the CSV; CSV formula injection; retention and the local-history-off path never write to disk; Clear deletes rows.
9. Honest UI. The "nothing has left" copy, the route "Paused" states and the cancel copy (Plan 04 CCR-3) can only appear from main's attestation/notices.
10. Chromium speculative networking (DNS prefetch/preconnect) while sealed: observe with a packet capture or `chrome://net-export` in a sealed dev session; recommend a switch if leaks are seen.

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

1. **LAN servers while sealed.** This plan blocks `network` locality (a self-hosted server on another machine) as well as `remote`, because audio sent to it leaves this computer (CCR-1). Should LAN stay allowed instead?
2. **Downloads and updates "you start."** The showcase copy for R6 C said "Block all network except model downloads and updates you start." D6 says main blocks model downloads. This plan follows D6 and also refuses manual update checks while sealed, so "sealed" has one meaning. Confirm, or name the exceptions.
3. **Recorder retention.** The ledger follows `transcriptRetentionDays`; "Forever" is capped at 100,000 rows, and with local history off it is memory-only. The research proposed a fixed 30-day roll. Which do you want?
4. **Dead network-capable IPC channels.** Ten channels (`process-anthropic-reasoning`, `process-enterprise-reasoning`, `enterprise-stream-start`, `bedrock-list-models`, `test-provider-connection`, `test-enterprise-connection`, `proxy-{xai,mistral,gemini,corti,tinfoil}-transcription`) have no renderer caller. This plan gates them. Removing them would shrink the attack surface; should that be a follow-up?
5. **Control panel hardening.** The control panel runs with `sandbox: false` and `webSecurity: false`, and the justifying comment (renderer calls provider APIs directly) is no longer true. Harden it in this plan or in a separate one? Task 17 asks the reviewer to assess the risk.
6. **Browser links while sealed.** `shell.openExternal` still opens links in your browser. That is your browser's traffic, not Loqui's. Should Loqui confirm before opening links while sealed?
7. **A quick toggle.** Should Sealed mode also be available from the tray menu or the pill? This plan ships it in Settings only.
