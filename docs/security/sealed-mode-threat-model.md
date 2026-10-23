# Sealed mode: threat model and network inventory

Owner: [Plan 07](../superpowers/plans/2026-10-15-loqui-uiux-07-sealed-mode.md), partial phase **07a**. Inventory baseline: `858205f6b224a3f9ac08477ac2ca03526c564b0e` (Task 1). The sections below describe the 07a code after the consolidated fix wave (2026-10-23). Line anchors were observed when each row was written and drift as code changes; the file and symbol names are authoritative, and the N9/N10 rows use symbols. Update this document and its machine-readable fences with every new transport, resource load, process launch or delegated OS handoff. `test/helpers/egressInventory.test.js` checks the inventory against source.

## Status and required promise

**07a installs JavaScript and Chromium-session enforcement, not a native boundary.** Tasks 2–15 and the consolidated fix wave added Layer A (main's egress gates), Layer B (the Node socket, DNS, UDP and HTTP backstop and the Chromium session backstop), the spawn guard, main-owned dialogs, the window navigation guard, the seal-transition barrier and the metadata flight recorder. Node tests exercise them against the production modules (Task 12's matrix and each task's suites). Chromium's runtime behavior is not observed in this environment: Task 16's Electron acceptance run is a recorded manual gap. Route, credential and session checks still do not establish a network boundary.

The eventual promise covers Loqui's main process, Chromium sessions/renderers, workers and the complete trees of programs it starts, with independently verified controls admitting strict numeric loopback only. **Every platform's native boundary is unavailable in 07a. `nothingLeaves=false` and `effectiveSince=null`, including with empty child arrays and zero counters.** No successful native `isolated`/`networkFree` state, verified seal, zero-egress claim or positive native fixture is justified.

07a admission refuses **all native starts before launch while sealed** until 07b independently verifies the required boundary: bundled engines, FFmpeg, OS tools, workers, Sync APIs, fork/utility processes, credential processes, self relaunch and updater install/restart included. Allowlisted programs/arguments, loopback binds, telemetry flags, JavaScript locks, launcher acknowledgements and probe reports grant no exception. A refused start is recorded as a `nativeLaunch` operation, not as a request (Task 6a section). This refusal is partial protection, not D16 completion or a macOS pause fallback.

07b/D14–D16 remain release and merge blockers. Native models must function inside independently verified macOS strict-loopback isolation. Linux must prove the network, filesystem/Unix-IPC, environment, descriptor, inherited capability and whole-tree boundary in packaged builds. Linux D15 permits refusal only before start or acknowledged stop only after confirmed whole-tree exit; it does not authorize Darwin pause completion. No entitlement/signing change or successful research spike closes these gates.

## Architecture, assets and authority

Loqui is a desktop dictation, notes, meetings and inference application. Main owns SQLite, credentials, provider requests, updates and native runtimes (`CLAUDE.md`; `main.js:437`, `src/helpers/ipcHandlers.js:363`). Renderers communicate through typed preload IPC. Plan 03's route planner remains the sole provider/model/endpoint selector. Main must validate the admitted recipient and captured config before gating transport or accessing credentials. Gates cannot select a substitute provider or reread live environment to choose recipients.

Assets include audio, transcripts, notes, chat, images, dictionary words, credentials and activity metadata. Preserve original immutable dictation/session/recipient tags and operation ownership across blocking, interruption and recovery. Preserve content on failure according to retention: History only when authorized, otherwise memory. Transport metadata is separate from content-disclosure authority.

| Boundary                    | Current evidence and required later control                                                                                                                                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer → main             | `preload.js`, `src/helpers/personalInference.js:441`, `src/helpers/dictationStreamingOperations.js:242`: IPC with captured recipient/session authority. Renderer seal checks are UX only. No direct renderer provider network was found.                                   |
| Main → provider/SDK/auth    | `personalInference.js:224`, `enterpriseAiProviders.js:86`, `keyring.js:403` (under `src/helpers/`): gate actual captured endpoint/auth transport, not static provider labels. Preserve nine factory arguments, execution liveness, frozen credentials/request environment. |
| Main → Node/Chromium        | HTTP/TLS, fetch, ws, DNS, SDKs, Electron net and updater partitions. Planned guards must precede imports that capture transports; cover every session, redirect and body lifetime.                                                                                         |
| Chromium → resources/OS     | `src/helpers/windowManager.js:220`, Markdown/images/fonts and links below. Resource loads exist without fetch. Sandbox/web security, all-frame WebRTC removal, CSP/speculation controls and request tracking remain unproved here.                                         |
| Main → native/host services | Spawn census: direct/injected runners, utility worker, relaunch/install, systemd and D-Bus. Preserve unknown descendants; Node socket hooks cannot constrain these capabilities.                                                                                           |

## Threat scenarios, exclusions and unresolved evidence

These are threat scenarios and required mitigations, not validated vulnerabilities or implemented guards.

1. **Forgotten/aliased requests and SDK side effects.** Planned Layer B must deny remote TCP/TLS, every DNS API (including Resolver/promises), UDP and Chromium requests before DNS/transport. Auth, attestation, credential discovery/processes and redirects belong to this scope. Scanning is a review ratchet, not whole-program reachability or runtime proof.
2. **Sealing races in-flight work.** Abort then await actual completion of requests, bodies, sockets, DNS, Chromium and native trees. A signal, timeout, requested reset, cleared counter or root exit is not whole-tree stop. Interrupted work may already have delivered content; never label it “nothing was sent.” Keep unresolved facts visible.
3. **Native or delegated egress.** IP namespaces alone do not close Unix sockets, service IPC, inherited descriptors/environment or descendant capabilities. No 07a native boundary exists. Refuse new sealed starts and retain unresolved existing trees. FFmpeg protocols, worker JS locks, Seatbelt localhost aliases, watchers and probe results are not accepted proof.
4. **Legacy startup evidence (A23).** The startup reaper (`src/helpers/sidecarReaper.js`, Task 6a) reads and preserves saved PID records without sealed `ps`/`tasklist` launches, and `main.js` `startApp` hands its named unresolved legacy-tree diagnostics to the child registry **before any manager is admitted** (Task 7; `privacyBootOrder.test.js` and the Task 12 A23 row). Failed unsealed inspection also preserves evidence. Positively identified reused PIDs are told apart from unknown inspection and never signalled; root-exited and unknown-descendant records stay unresolved (Task 6a section). Actual resolution proof belongs to 07b.
5. **Startup/restart admission escapes.** `main.js:9–16` currently spawns XWayland relaunch before profile setup. `src/helpers/ipcHandlers.js:3383–3410` schedules a waiter then `app.relaunch`; updater's default install calls `quitAndInstall`. Tasks 6a/7/10 must gate before scheduling/executing these and before manager constructors, microphone/capability probes, listeners, calendar helpers and service activation. Autostart is also a delegated future-launch capability: `autoStart.js:21` registers macOS/Windows login items and `linuxAutostart.js:179` writes an XDG desktop entry; `main.js:277` may repair that entry on startup. Registration is not an immediate process start or boundary proof. Next-start profile/seal guards must run before native admission, including login/packaged-wrapper launch paths. Task 7 must account for this startup seam. Boot ordering is not fixed by this document.
6. **Renderer authority abuse.** Planned trusted-main-frame IPC and main-owned native dialogs protect unseal, recorder clear/export and external handoffs. Preserve existing fixed OS-settings scheme and file-path validation; no renderer-supplied arbitrary system URLs. Declined links are silent.
7. **Chromium bypasses provider IPC.** Markdown images, icons, navigation, WebRTC and speculative DNS/preconnect require Task 7a hardening, Task 13 inert remote images sealed/unknown and Task 16 real Electron observation. Static rows cannot close that gate. Some Chromium fetches never reach `session.webRequest`: the Hunspell dictionary download, PAC/WPAD and network hints (Task 18 T18-02). While sealed, every watched session gets a direct proxy (no PAC/WPAD), its spellchecker off and its dictionary URL pointed at an unroutable loopback port (`egressBackstop` `syncSessionHardening`). Notification and pill windows run no spellchecker at all; the main window keeps it for the Assistant composer. Unsealing restores the system proxy, Chromium's default dictionary URL and the previous spellchecker state; Loqui sets neither of the first two otherwise. This narrows Chromium's own fetches. It is not a boundary, and it is NOT VERIFIED at runtime: Task 16's checklist item T18-02 asks a real run to look for `redirector.gvt1.com`, `wpad` and sockets with no webRequest event.
8. **Loopback forwarders.** Main transport eligibility differs from native-launch availability and from user-owned forwarder security. Main guards admit strict loopback sockets, but a user's forwarder can relay remotely. While sealed, Layer B refuses a loopback-bound request that names another target, but only for requests built by Node's HTTP/1 client (Task 18 T18-03, T18R-01). That client is `http`/`https` `.request`/`.get`, `new http.ClientRequest`, the same class through `require("_http_client")`, subclasses, and references cached before boot. Arguments are first read the way Node reads them (its URL duck typing and the merge of a second options argument, with every `Host` value). Then, authoritatively, `ClientRequest.prototype._storeHeader` judges the exact request head Node is about to send, after construction and before the first write: the request line and every `Host` line. So a method, path or header changed after construction is judged on what would actually be sent. It covers `CONNECT`, absolute-form, one-slash (`http:/host`), scheme-relative (`//host`) and bare (`host/path`) request targets, and any non-loopback `Host` value, including duplicates and one set late with `setHeader` or `appendHeader`. The late check also covers a request created before the seal (re-review m4). A head whose headers Node stored before the seal is an in-flight request and is not re-judged. It does not inspect raw socket writes, SOCKS greetings, HTTP/2 (`node:http2`), or clients with their own HTTP stack (npm `undici`'s `ProxyAgent`) talking to a loopback forwarder: like any user forwarder, those are outside the guarantee. **Proxies (owner decision D-5, 2026-10-23).** While sealed, Loqui's own Node requests are never forwarded through a proxy: a Node socket to any proxy endpoint Loqui knows of is refused before it connects, with a `SealedModeError` (`details.reason: "proxy"`, counted as `proxyRefusals` in the guards), and the caller keeps its content. Known endpoints are those named by `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and their lowercase forms (read live and as they were at startup; `NODE_USE_ENV_PROXY`/`--use-env-proxy` makes Node's own agents and `fetch` use them), Node's proxy-configured agents (`http`/`https` global agents and agents built with `proxyEnv`), undici's `ProxyAgent`/`EnvHttpProxyAgent` dispatchers including the global dispatcher, agent-base proxy agents such as the `https-proxy-agent` gaxios builds from the environment, and any CONNECT or absolute-form request an undici copy publishes on `undici:request:create`. A request `NO_PROXY` sends direct is unaffected, a remote proxy is refused like any remote socket, and unsealed behaviour is unchanged (`test/helpers/egressEnvProxy.test.js`). A socket already pooled to a proxy before the seal, and a proxy agent built from a reference cached before boot that never passes a hook, are not re-judged. The `envProxy` attestation failure stays: a JavaScript refusal is not a verified seal. **Programs the user runs themselves** (a loopback forwarder, SOCKS or tunnel tool listening where no proxy setting names it) remain outside the guarantee: Loqui cannot tell such a program from a local server, and what it relays is not Loqui's request. None of this certifies a plain loopback relay or makes built-in engines available. Locality must match main/renderer: localhost and subdomains, 127/8, ::1 and mapped 127.x normalize/pin to numeric loopback; LAN/public, unparseable targets or arbitrary DNS names resolving to loopback are not local.
9. **Recorder content leakage or false certainty.** Store only bounded metadata: start/end, task/provider/model enum IDs, bare hosts (up to eight), outcomes/status, byte counts and error code/class. Never content, keys, URLs with paths/query strings or error messages. Unknown bytes are `null` (“—”), including bodyless requests. Body counters exclude headers; realtime sessions count their socket wire bytes. Only refusal before a socket opens can record `bytesOut: 0`. A refused native start is not a request: it is one `nativeLaunch` operation row (host `native-<program>`, at most once per program per seal), never counted as a blocked request, an unexplained host or in the panel's blocked count. Hosts a ticket contacted outside its metered attempts (SDK credential and token traffic Layer B attributed to it) get one `connection` row with unknown bytes. Model ids shaped like keys are stored as `null`. Interrupted/redirected earlier attempts cannot be rewritten as wholly unsent. Codex/yt-dlp opaque sessions retain unknown bytes and separately labeled **usual hosts**, not a measured complete destination trail; settle at actual process/tree outcome, not caller timeout. Empty/pruned/cleared/RAM-only ledgers do not attest no egress. Retention follows privacy settings, including 100000 durable rows for forever retention and last-500 memory-only rows when disabled; memory-only rows never become durable later.

Outside the eventual boundary: other apps and OS services are not covered. Web/mail/OAuth/meeting/help links require planned main confirmation naming host and outside-app scope. File-manager and fixed-settings handoffs also cross this boundary; confirmation never overrides unavailable native-launch admission (including Windows explorer). Cancel pending calendar sign-ins, close loopback callbacks and abort claimed token exchanges on seal. Apple EventKit is native, not exempt. OS DNS-over-HTTPS, iCloud and system updates are not Loqui traffic; Loqui's own delegation to services must still be controlled. Malicious local profile readers are out of scope. Build/packaging scripts (`scripts/`, `cleanup.js`) are developer/CI scope, outside this app ratchet. No Windows orphan-refresh window or POSIX process-group assumption is accepted as whole-tree proof.

## Enforcement layers (07a)

| Layer                    | Owner                                              | 07a behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A                        | `src/helpers/privacy/egressGate.js`; Tasks 5/8–11a | Validates the effective captured destination, refuses before transport, records blocked metadata and tracks each actual attempt and body until it ends. A response's ticket stays open until its body ends, so every caller reads or cancels a non-ok body (ratchet in `egressInventory.test.js`).                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| B: Node                  | `src/helpers/privacy/egressBackstop.js`; Task 6    | TCP/TLS, all DNS, UDP, SDK underlays and HTTP proxy forwarding, installed before modules capture them. Socket arguments are normalized with Node's own normalizer (captured at install), and a shape it cannot classify is refused while sealed. The options are snapshotted once and every allowed connect hands Node that snapshot, so a getter, a Proxy or a replaced `net._normalizeArgs` cannot change the destination after it was judged (T18R-02). Accepted localhost forms are pinned; DNS is never trusted for locality. Forwarding refusal judges the request head of Node's HTTP/1 client only (threat 8). While sealed, `process.binding` refuses `spawn_sync`, `process_wrap`, `tcp_wrap`, `udp_wrap` and `cares_wrap` (T18R-07). |
| B: Chromium              | Tasks 6/7a, Task 18 T18-02                         | Every watched session (including the updater's), original URL and redirects, with evidence kept to onCompleted/onError; a `file:` URL naming a remote host is remote. Sealing also sets a direct proxy and turns off spellcheck downloads (threat 7). A session counts as hardened only after every call fulfilled, and its failure stays named until a later attempt succeeds (T18R-05). Not observed at runtime here (Task 16).                                                                                                                                                                                                                                                                                                               |
| Renderer                 | Tasks 7a/13                                        | Main keeps IPC authority. All-frame WebRTC removal, inert remote images and CSP are in place; executed acceptance in real Chromium is Task 16's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Spawn guard              | Tasks 6a/7, Task 18 T18-04                         | Refuses every native start while sealed until 07b proof, through the public entry points as looked up after boot: every `child_process` API, `ChildProcess.prototype.spawn`, `process.execve`, `utilityProcess.fork`, and the `spawn_sync`/`process_wrap` bindings through `process.binding`. A reference taken before the guard is installed (a cached `spawnSync`, `execFileSync`, `execSync` or binding) bypasses it by construction. No app module or shipped dependency takes one (`privacyBootOrder`; T18R-07). Unsealed launches are classified and their tree facts kept. The exact FFmpeg file,pipe whitelist is extra hardening only.                                                                                                 |
| OS boundary              | **07b; unavailable on every platform**             | No success interface in 07a. Independent effective controls, tree lifetime and inherited/service capability closure remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Main dialogs and windows | Tasks 7/11/15, final review I3                     | Main owns unseal, recorder actions and external handoff confirmation, with safe defaults. Every window denies `window.open` and navigation away from the app, and routes web and mail links to the guarded opener. The OS external-protocol permission (`mailto:` and similar) is denied and routed the same way. Only `media`, `display-capture` and the clipboard are granted; geolocation and unknown permissions are denied (T18R-04). `file:` navigation needs an empty or localhost host, and `devtools://` only in unpackaged builds (T18R-06).                                                                                                                                                                                          |

## Per-path inventory

Line anchors are Task 1 observations (see the header); N9/N10 name symbols instead. Unless otherwise prefixed, code filenames below are under `src/helpers/`. **Sealed** and **Layer** give each path's 07a decision and the layer that enforces it. Exact decision/layer vocabulary is retained for downstream consumers; no native row uses `local only: contained` or `n/a: no network` in 07a. For configurable HTTP/SDK paths, `blocked` means nonloopback refused; an explicitly configured loopback transport can be eligible under captured recipient authority, subject to ancillary native refusals. It never means built-in engines can start sealed. Native rows refuse regardless of bind address.

| Id  | Path                                                                 | Current code anchors                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Transport                                                 | Sealed                     | Layer         | Ledger task / proof owner                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | Text/vision/search/cleanup/notes/translation                         | `personalInference.js:224,239,516,647`; `enterpriseAiProviders.js:28,86`                                                                                                                                                                                                                                                                                                                                                                                                     | AI SDK / injected Node fetch                              | blocked                    | A+B           | scope → SCOPE_TO_TASK; Tasks 8/12; Test: `sealedModeEnforcement.test.js`                                                                                                                                   |
| N2  | Enterprise SDK/auth and legacy handlers                              | `enterpriseAiProviders.js:94,106,112,125,137,346`; `ipcHandlers.js:514,4425,4497,4626,4711,4747`                                                                                                                                                                                                                                                                                                                                                                             | SDK HTTP/auth/ADC and credential processes                | blocked                    | A+B           | scope or providerCheck; Tasks 8/11a/12; spawn refusal too; Test: `sealedModeEnforcement.test.js`                                                                                                           |
| N3  | Explicit model discovery                                             | `personalInference.js:441,467`                                                                                                                                                                                                                                                                                                                                                                                                                                               | injected fetchModels; describe only issues recipient      | blocked                    | A+B           | providerCheck; Tasks 8/12; no automatic calls; Test: `sealedModeEnforcement.test.js`                                                                                                                       |
| N4  | Provider Verify/self-hosted probe                                    | `keyring.js:403,603`; `providerConnectionTest.js:289,308`; `selfHostedProbe.js:8,29`; `ipcHandlers.js:418,1427`                                                                                                                                                                                                                                                                                                                                                              | injected fetch / Electron / SDK                           | blocked                    | A+B           | providerCheck; Tasks 8/11a/12; retain recipient/frozen environment; probe gated (11a): loopback per the one rule, else `sealed`; Test: `sealedModeEnforcement.test.js`                                     |
| N5  | Batch BYOK/self-hosted STT                                           | `ipcHandlers.js:249,256,8360`                                                                                                                                                                                                                                                                                                                                                                                                                                                | Electron session/net multipart                            | blocked                    | A+B           | dictationStt or uploadStt from captured admission; Tasks 9/12; Test: `sealedModeEnforcement.test.js`                                                                                                       |
| N6  | Gemini/Corti/Tinfoil STT/auth                                        | `geminiTranscription.js:69,70`; `cortiAuth.js:28,44,48`; `cortiTranscription.js:7`; `tinfoilTranscription.js:48`; `tinfoilSecureClient.js:27,29`                                                                                                                                                                                                                                                                                                                             | Electron/injected fetch / SDK attestation                 | blocked                    | A+B           | inherited task/provider/correlation; Tasks 9/12; Test: `sealedModeEnforcement.test.js`                                                                                                                     |
| N7  | Retry transcription                                                  | `ipcHandlers.js:5573,5589,5628,5776`                                                                                                                                                                                                                                                                                                                                                                                                                                         | Electron proxyFetch                                       | blocked                    | A+B           | dictationStt; Tasks 9/12; Test: `sealedModeEnforcement.test.js`                                                                                                                                            |
| N8  | Legacy xAI/Mistral/Anthropic proxies                                 | `ipcHandlers.js:4136,4172,4981`                                                                                                                                                                                                                                                                                                                                                                                                                                              | Electron net                                              | blocked                    | A+B           | dictationStt / dictationCleanup; Tasks 8/9/12; Test: `sealedModeEnforcement.test.js`                                                                                                                       |
| N9  | Realtime dictation/meetings/warm reuse/reconnect/flush               | `dictationStreamingOperations.js` `createDictationStreamingOperations`; `streamingHandOff.js` `holdFrame`/`sendContentFrame`; each adapter's `connect`/`warmup` through `sttTransport.js` `openRealtimeSocket`/`connectRealtime` (`assemblyAiStreaming.js`, `deepgramStreaming.js`, `cortiStreaming.js`, `geminiLiveStreaming.js`, `openaiRealtimeStreaming.js`, `tinfoilRealtimeStreaming.js`); `ipcHandlers.js` dictation streaming handlers and `meeting-transcription-*` | ws / Tinfoil factory                                      | blocked                    | A+B           | dictationStt / noteRecordingStt; Tasks 9a/12/13; connection distinct from recording handle; Test: `sealedModeEnforcement.test.js`                                                                          |
| N10 | Realtime token/auth                                                  | `realtimeTokenProviders.js` `fetchRealtimeTokenForProvider` (AssemblyAI token through the injected `proxyFetch`); `ipcHandlers.js` `fetchRealtimeToken` (`proxyFetch` = `gatedNetFetch`); Corti N6                                                                                                                                                                                                                                                                           | injected proxyFetch / Electron                            | blocked                    | A+B           | inherited; Tasks 9a/12; token metadata is not disclosure; Test: `sealedModeEnforcement.test.js`                                                                                                            |
| N11 | Tinfoil catalog/attestation                                          | `tinfoilCatalog.js:41,43,64`; `tinfoilSecureClient.js:9,27`                                                                                                                                                                                                                                                                                                                                                                                                                  | Tinfoil SDK                                               | blocked                    | A+B           | providerCheck; Tasks 8/12; Test: `sealedModeEnforcement.test.js`                                                                                                                                           |
| N12 | Model manifests/downloads                                            | `downloadUtils.js:122,250,267`; callers `whisper.js:638`, `parakeet.js:381,495`, `localEmbeddings.js:85`, `diarization.js`, `modelManagerBridge.js:6`                                                                                                                                                                                                                                                                                                                        | Electron request/fetch, redirects                         | blocked                    | A+B           | modelDownload; Tasks 10/12; extraction separately refused; Test: `sealedModeEnforcement.test.js`                                                                                                           |
| N13 | Runtime/GPU binaries                                                 | `gpuBinaryManager.js:110,184`; `llamaCppInstaller.js`                                                                                                                                                                                                                                                                                                                                                                                                                        | shared downloads/manifests                                | blocked                    | A+B           | runtimeDownload; Tasks 10/12; Test: `sealedModeEnforcement.test.js`                                                                                                                                        |
| N14 | Direct/proxy/YouTube URL import                                      | `urlAudioDownloader.js:3,629,1016,1190,1525`                                                                                                                                                                                                                                                                                                                                                                                                                                 | aliased mod.request, DNS, Electron net, yt-dlp            | blocked                    | A+spawn guard | urlImport; Tasks 10/12; B also required; retain SSRF checks; Test: `urlAudioDownloader.test.js` (Task 12 matrix rows)                                                                                      |
| N15 | yt-dlp self-update                                                   | `urlAudioDownloader.js:390,426`                                                                                                                                                                                                                                                                                                                                                                                                                                              | native child                                              | blocked                    | spawn guard   | runtimeDownload opaque session; Tasks 6a/10/12; Test: `urlAudioDownloader.test.js` (Task 12 matrix rows)                                                                                                   |
| N16 | Update check/download/install                                        | `updateManager.js:15,152,168`; `updateIPC.js:96`; `main.js:505`                                                                                                                                                                                                                                                                                                                                                                                                              | updater private session + native restart/install          | blocked                    | A+B           | appUpdate; Tasks 10/12/16; spawn refusal before install/restart; Test: `sealedModeEnforcement.test.js`                                                                                                     |
| N17 | Codex verification/discovery/version probes                          | `codexCli.js:99,115,197,198,238,255,315,327`; `codexAppServer.js:176,178`                                                                                                                                                                                                                                                                                                                                                                                                    | injected fetch + native runFile                           | blocked                    | A+B           | codex; Tasks 8/12; refuse native probe too; Test: `sealedModeEnforcement.test.js`                                                                                                                          |
| N18 | Codex status/login/logout/models/model-catalog/rate-limits/inference | `codexAppServer.js:214`; `personalInference.js:374,378,391,392,393,394,591`; `main.js:503`                                                                                                                                                                                                                                                                                                                                                                                   | opaque native app-server + OS login callback              | blocked                    | A+spawn guard | codex, opaque process lifetime; Tasks 8/11/12; browser confirmation separate; Test: `sealedModeEnforcement.test.js`                                                                                        |
| N19 | Google/Microsoft OAuth/API/pending consent                           | `googleCalendarOAuth.js:163`; `googleCalendarManager.js:377`; `microsoftCalendarOAuth.js:164,184`; `microsoftCalendarManager.js:423`; `oauthLoopbackFlow.js:34,53,156`; `ipcHandlers.js:9203`                                                                                                                                                                                                                                                                                | Electron net + listener + OS browser                      | blocked                    | A+B           | calendar; Task 11 calendarSealed (refuse, interrupt, cancel flows, abort exchange); Task 12 matrix; Test: `sealedModeEnforcement.test.js`                                                                  |
| N20 | Calendar background/focus/wake                                       | `main.js:677,904,910`; `privacy/calendarGuard.js`; `calendarSyncInterval.js:48,61`; `privacy/privacyBoot.js` seal transition                                                                                                                                                                                                                                                                                                                                                 | callbacks into N19; Apple native helper                   | blocked                    | A+B           | calendar; Task 11 calendarSealed; Apple not exempt (guarded; spawn guard refuses); Test: `sealedModeEnforcement.test.js`                                                                                   |
| N21 | Browser/mail/meeting/OAuth/help/settings/file-manager handoffs       | `externalUrlOpener.js:53,67,89,95,101`; `main.js:222,541`; `ipcHandlers.js:4017,5385` (file-manager reveals `1698,8971,9072,9609,9626`); `windowManager.js:1464,1505,1512,1519`; `meetingDetectionEngine.js:444`; `meetingJoinUrl.js`; `menuManager.js:109`; `oauthLoopbackFlow.js:156`; renderer externalLinks/UpdateSettings                                                                                                                                               | OS apps; renderer IPC/injected callbacks delegate to main | allowed after confirmation | main dialog   | none; Task 11 externalLinkSealed; file-manager reveals of app-owned paths carry no destination and are not confirmed; Windows explorer native refusal still applies; Test: `sealedModeEnforcement.test.js` |
| N22 | Loopback sidecar/client/listener/dev transport                       | `llamaServer.js:572,657,770`; `whisperServer.js:454,462,806,954`; `qdrantManager.js:210`; `vectorIndex.js:15`; `parakeetWsServer.js:328,472`; `cliBridge.js:169,184`; `devServerManager.js:23,27`; `oauthLoopbackFlow.js:1`; `src/utils/serverUtils.js:2`                                                                                                                                                                                                                    | Node HTTP/ws, Qdrant SDK, loopback callbacks/probes       | allowed: loopback          | B             | none for loopback; connectRemote must be gated if nonloopback; native launch unavailable; Test: `sealedModeEnforcement.test.js` (loopback rows)                                                            |
| N23 | ONNX utility worker                                                  | `onnxWorkerClient.js:59`; `src/workers/onnxWorker.js:62`                                                                                                                                                                                                                                                                                                                                                                                                                     | utilityProcess + native addon                             | blocked                    | spawn guard   | none; Tasks 6a/7/13/18; no networkFree inference from JS imports; Test: Task 6a `workerEgressLock`; matrix ratchet declares the callers                                                                    |
| N24 | Four FFmpeg starts incl private pipe decoder                         | `ffmpegUtils.js:132,404,473,616`                                                                                                                                                                                                                                                                                                                                                                                                                                             | native conversions                                        | blocked                    | spawn guard   | none; Task 6a ffmpegContainment tests; exact file,pipe restriction is not isolation; Test: `sealedModeEnforcement.test.js`                                                                                 |
| N25 | Chromium docs/images/navigation/speculation/WebRTC                   | `windowManager.js:220,660,1488,2203,2258,2480,2531`; `src/index.html:5,7,12`; `src/assets/fonts/noto-sans.css:10`; `src/components/ui/MarkdownRenderer.tsx`; resource consumers below                                                                                                                                                                                                                                                                                        | Chromium resources, no direct provider transport          | blocked                    | B: Chromium   | none or unattributed; Task 16 Electron proof; Tasks 7a/13 wiring; Test: Task 16 (Chromium only)                                                                                                            |
| N26 | Native helpers/probes/service activation/relaunch/legacy trees       | spawn census below; `main.js:9,610`; `ipcHandlers.js:3401,3408`; `ensureYdotool.js:117,124`; `processListCache.js:30`                                                                                                                                                                                                                                                                                                                                                        | native processes, desktop IPC/delegated services          | blocked                    | spawn guard   | none; Tasks 6a/7/12/18; A23 unresolved evidence, never root-only stop; Test: `sealedModeEnforcement.test.js`                                                                                               |

Task 12's production-wiring matrix must cover every `blocked` row except Chromium-only N25, whose executed proof belongs to Task 16. N21 confirmation and N22 transport eligibility also need tests. No static pass replaces either matrix or independent platform evidence.

Legacy channels still exposed through preload must be gated and tested even without current UI callers: `process-anthropic-reasoning`, `process-enterprise-reasoning`, `enterprise-stream-start`, `bedrock-list-models`, `test-provider-connection`, `test-enterprise-connection` and `proxy-{xai,mistral,gemini,corti,tinfoil}-transcription`. The legacy `whisper.js:482` transcribeViaLan / `whisperServer.js:454` connectRemote pair has no current external caller found; retain its nonloopback gate/backstop obligation rather than assuming every sidecar file is loopback-only.

## Transport/resource census and interpretation

Both fences are conservative **capability/review lists**. Imports, actual calls, delegated wrappers and callback contracts are distinct. An import may only parse data; an IPC wrapper may never open a socket itself. Inclusion proves neither execution nor guard coverage. The scan parses JS/JSX/TS/TSX/CJS/MJS import/export/dynamic import and calls, plus HTML/CSS resources, in `main.js`, `preload.js` and all `src/`, excluding declaration files. Dependencies, tests, developer scripts and generated builds are outside the scan. New privacy modules are not silently exempted.

- Known transports include aliased Node imports, `fetchImpl`, `fetchModels`, `doFetch`, `proxyFetch`, `runTest`/`runEnterpriseTest`, download wrappers, ws and SDK imports. Module imports deliberately trigger review; function/interface declarations, comments and strings do not count as calls. There is no generic `.exec` regex: `RegExp.exec` is not a launch. Child-process imports cover exec/promisified/Sync aliases; known injected `runFile`, `runCommand`, `spawnImpl`, `execAsync` calls are checked too.
- `main.js` imports TLS only for CA setup. `textOperationCapture.js` imports Smithy to parse profiles, not send; consuming SDK auth/processes belong to N2. `ToolRegistry.ts` imports AI SDK schemas/types, not provider transport. `hotkeyManager.js`/`windowBroadcast.js` import BrowserWindow for window lookup, not creation. These conservative import hits remain explicit.
- `src/models/tinfoilModels.ts:90–95` binds fetchModels to `window.electronAPI.getTinfoilChatModels`. `src/services/ai/chatRequestBody.ts:137–161` is a generic injected retry contract with no current production caller found (not a direct transport); SelfHostedPanel's runTest and renderer external-link helpers also delegate via IPC. These known callback names are not direct renderer provider networking or renderer credential authority. `meetingJoinUrl.js:74` and `src/utils/externalLinks.ts:5` also have browser-preview `window.open` fallbacks; those are Chromium navigation/new-window handoffs, not provider fetch. In Electron they are subject to N25 and to the navigation guard every window installs (`navigationGuard.guardWindowNavigation`; the control panel keeps its own equivalent): `window.open` is denied, and http(s) and mailto targets go to main's guarded opener. `src/preview/browserPreview.ts:361` also opens HTTPS links in browser-only development mode; `src/main.jsx:3` excludes that adapter from production and keeps Electron preload authority. It stays inventoried because the scan includes all source.
- N9 includes actual `streamingHandOff.js` frame sends, adapter buffers/reconnect and meeting/replacement streams. `codexAppServer.js` is opaque native egress even without a network import. `calendarSyncInterval.js` triggers manager callbacks. Worker native code is unknown capability, never proven network-free.
- N25 includes implicit Markdown images, `ModelCardList.tsx:154` model.icon, `ProviderIcon.tsx:27`, `MeetingNotificationCard.tsx:71`, `LoquiBrand.tsx:30,36,44`, `IntegrationsView.tsx:43` (under `src/components/`, UI files under `ui/`), bundled font URLs and CSS imports. Bundled relative assets are local; dynamic nonlocal values/future URLs still need session enforcement. Chromium processes are separate from application native helpers.
- Fresh supplemental sites: `vectorIndex.js` uses strict-loopback Qdrant SDK; `processListCache.js:30` imports ps-list for native enumeration; freedesktop notifications, GNOME portals/shortcuts, KDE and Hyprland import D-Bus session clients. D-Bus opens local IPC and may activate host services: not a proven remote request or tracked child tree. Planned admission must deny unaudited delegated service capabilities sealed; a TCP-only backstop cannot prove closure.
- `src/helpers/privacy/egressPolicy.js` imports `node:net` only for pure address syntax classification (`isIP`); it performs no DNS lookup or socket operation. The conservative egress fence records this import for review, not as an observed transport.

- `src/helpers/privacy/egressGate.js` is Layer A's metered fetch factory (default Node fetch or an injected transport). It checks the actual attempt target before dispatch and records body completion/error/cancel metadata per attempt. It attributes Node work only through async ticket/attempt context and Chromium work only through the opaque tag; there is no host-wide lookup. Task 6 must strip tags and retain its actual transport evidence through close/completion even after a ticket settles. Its diagnostic hooks provide no native-isolation or seal attestation.

- `src/helpers/privacy/egressBackstop.js` owns JavaScript socket/TLS/HTTP/fetch, DNS, UDP and Chromium session defenses. Localhost names are pinned to numeric loopback in Node; Chromium uses its localhost handling. It retains transport diagnostics until observed close/completion/error, including requests orphaned by destroyed webContents. While sealed it refuses Node sockets to known proxy endpoints (threat 8, D-5); `envProxy` stays a named attestation failure. These hooks do not establish native isolation or a verified seal.

```egress-sites
main.js
src/assets/fonts/noto-sans.css
src/components/IntegrationsView.tsx
src/components/LoquiBrand.tsx
src/components/MeetingNotificationCard.tsx
src/components/SelfHostedPanel.tsx
src/components/googleRevokeNotice.ts
src/components/settings/UpdateSettings.tsx
src/components/ui/MarkdownRenderer.tsx
src/components/ui/ModelCardList.tsx
src/components/ui/ProviderIcon.tsx
src/helpers/assemblyAiStreaming.js
src/helpers/calendarSyncInterval.js
src/helpers/cliBridge.js
src/helpers/codexAppServer.js
src/helpers/codexCli.js
src/helpers/cortiAuth.js
src/helpers/cortiStreaming.js
src/helpers/cortiTranscription.js
src/helpers/deepgramStreaming.js
src/helpers/devServerManager.js
src/helpers/diarization.js
src/helpers/dictationStreamingOperations.js
src/helpers/downloadUtils.js
src/helpers/enterpriseAiProviders.js
src/helpers/externalUrlOpener.js
src/helpers/freedesktopNotifications.js
src/helpers/geminiLiveStreaming.js
src/helpers/geminiTranscription.js
src/helpers/gnomeGlobalShortcutsPortal.js
src/helpers/gnomeShortcut.js
src/helpers/googleCalendarManager.js
src/helpers/googleCalendarOAuth.js
src/helpers/gpuBinaryManager.js
src/helpers/hotkeyManager.js
src/helpers/hyprlandShortcut.js
src/helpers/ipcHandlers.js
src/helpers/kdeShortcut.js
src/helpers/keyring.js
src/helpers/llamaServer.js
src/helpers/localEmbeddings.js
src/helpers/meetingDetectionEngine.js
src/helpers/meetingJoinUrl.js
src/helpers/menuManager.js
src/helpers/microsoftCalendarManager.js
src/helpers/microsoftCalendarOAuth.js
src/helpers/modelManagerBridge.js
src/helpers/oauthLoopbackFlow.js
src/helpers/onnxWorkerClient.js
src/helpers/openaiRealtimeStreaming.js
src/helpers/parakeet.js
src/helpers/parakeetWsServer.js
src/helpers/personalInference.js
src/helpers/privacy/egressBackstop.js
src/helpers/privacy/egressGate.js
src/helpers/privacy/childRegistry.js
src/helpers/privacy/egressPolicy.js
src/helpers/privacy/gatedFetch.js
src/helpers/providerConnectionTest.js
src/helpers/qdrantManager.js
src/helpers/realtimeTokenProviders.js
src/helpers/selfHostedProbe.js
src/helpers/streamingHandOff.js
src/helpers/sttTransport.js
src/helpers/textOperationCapture.js
src/helpers/tinfoilCatalog.js
src/helpers/tinfoilRealtimeStreaming.js
src/helpers/tinfoilSecureClient.js
src/helpers/tinfoilTranscription.js
src/helpers/updateManager.js
src/helpers/urlAudioDownloader.js
src/helpers/vectorIndex.js
src/helpers/whisper.js
src/helpers/whisperServer.js
src/helpers/windowBroadcast.js
src/helpers/windowManager.js
src/index.css
src/index.html
src/models/tinfoilModels.ts
src/preview/browserPreview.ts
src/services/ai/chatRequestBody.ts
src/services/tools/ToolRegistry.ts
src/utils/externalLinks.ts
src/utils/serverUtils.js
src/workers/onnxWorker.js
```

## Native launch and delegated activation census

Program families below describe current intent, never a native no-network guarantee. All native starts must refuse sealed in 07a. Delegated OS/service handoffs need separate admission/disclosure; Chromium lifecycle needs its own renderer/session controls. Classification alone authorizes nothing.

| Source (under `src/helpers/` unless prefixed)                                                                                                                                                                                                 | Current launch/capability                                                                           | Classification / inventory                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codexAppServer.js:178,214`, `codexCli.js:115`                                                                                                                                                                                                | injected runFile version/lookup probes; Codex app-server                                            | network/opaque, N17/N18                                                                                                                                                             |
| `urlAudioDownloader.js:426,601,629`                                                                                                                                                                                                           | yt-dlp self-update/download, Windows taskkill, detached/group handling                              | network/opaque N14/N15; control tool N26                                                                                                                                            |
| `ffmpegUtils.js:132,404,473,616`                                                                                                                                                                                                              | four FFmpeg conversions incl private pipe decoder                                                   | native N24; file,pipe defense only                                                                                                                                                  |
| `externalUrlOpener.js:67,89,101`                                                                                                                                                                                                              | Windows explorer spawn; shell.openExternal on other platforms and for fixed OS-settings URLs        | OS browser/mail/settings N21; confirmation cannot waive native refusal                                                                                                              |
| `llamaServer.js:430`, `whisperServer.js:634`, `qdrantManager.js:128`, `parakeetWsServer.js:160`                                                                                                                                               | llama/Whisper/Qdrant/sherpa WS servers                                                              | native sidecars N22; loopback clients/bind flags do not isolate                                                                                                                     |
| `diarization.js:342`, `meetingAecManager.js:79`                                                                                                                                                                                               | sherpa diarization CLI, meeting AEC helper                                                          | native N26                                                                                                                                                                          |
| `audioTapManager.js:133,275`, `audioActivityDetector.js:306,620,943,972,979`                                                                                                                                                                  | macOS audio helper/listeners; pactl via execAsync                                                   | native capture/probes N26                                                                                                                                                           |
| `linuxPortalAudioManager.js:112,294`, `windowsLoopbackAudioManager.js:142,312`, `systemDefaultMicrophone.js:96,98`                                                                                                                            | portal/PipeWire/Windows capture/probes; mic query                                                   | native + host-service capabilities N26                                                                                                                                              |
| `clipboard.js`, `selectionManager.js:44,46,63,475`, `textEditMonitor.js:145,172,215`                                                                                                                                                          | xclip/xsel/wl-copy/paste, xdotool/ydotool, osascript, platform paste/text helpers, desktop IPC/open | native + delegated capabilities N26; not network-free                                                                                                                               |
| `globeKeyManager.js:137,240`, `linuxKeyManager.js:53`, `windowsKeyManager.js:58`, `linuxWindowInputRegion.js:45`                                                                                                                              | platform key/window input helpers/probes                                                            | native N26                                                                                                                                                                          |
| `hyprlandShortcut.js:107,154,231`, `gnomeShortcut.js:185,348`                                                                                                                                                                                 | hyprctl/gsettings Sync commands and D-Bus                                                           | native + service IPC N26                                                                                                                                                            |
| `ensureYdotool.js:13,21,29,37,80,117,124`                                                                                                                                                                                                     | which/groups/pgrep/systemctl, including start of ydotoold/ydotool                                   | native + systemd activation N26; external service tree is not owned by spawned root                                                                                                 |
| `mediaPlayer.js:23,27,298,314,335`                                                                                                                                                                                                            | playerctl/platform media helpers/Perl                                                               | native + host media-service IPC N26                                                                                                                                                 |
| `appleCalendarManager.js:145`                                                                                                                                                                                                                 | EventKit helper                                                                                     | native N20/N26; Apple is not exempt                                                                                                                                                 |
| `downloadUtils.js:482,511`, `systemTar.js:39,61`, `llamaCppInstaller.js:84`                                                                                                                                                                   | unzip/PowerShell extraction, injected spawnImpl tar, which/where                                    | native N26; downloaded-file extraction is not containment                                                                                                                           |
| `src/utils/gpuDetection.js:27`                                                                                                                                                                                                                | nvidia-smi via injected run/default execFile                                                        | native probe N26                                                                                                                                                                    |
| `src/utils/process.js:15,88,102`                                                                                                                                                                                                              | shared runCommand/spawn, optional shell, Windows taskkill                                           | classify each caller; all sealed native starts refused                                                                                                                              |
| `sidecarReaper.js:32,39`, `processListCache.js:30`                                                                                                                                                                                            | ps/tasklist, ps-list dependency process enumeration                                                 | native inspection N26; no whole-tree proof; preserve A23 records                                                                                                                    |
| `onnxWorkerClient.js:59`, `src/workers/onnxWorker.js:62`                                                                                                                                                                                      | current utilityProcess.fork; worker loads onnxruntime-node                                          | native N23; future launcher/IPC migration is 07b, not implemented                                                                                                                   |
| `main.js:9–16`, `ipcHandlers.js:3401,3408`                                                                                                                                                                                                    | early XWayland self spawn, relaunch waiter and Electron app.relaunch                                | native self-launch N26; admission before scheduling, no self exemption                                                                                                              |
| `updateManager.js:15`, `updateIPC.js:96`                                                                                                                                                                                                      | updater quitAndInstall and wrapper invocation                                                       | native install/restart N16/N26; not caught by child_process imports alone                                                                                                           |
| `freedesktopNotifications.js:7`, `gnomeGlobalShortcutsPortal.js:20`, `kdeShortcut.js:8`, `gnomeShortcut.js:118`, `hyprlandShortcut.js:188`                                                                                                    | D-Bus session/notification/portal/shortcut interfaces                                               | delegated host-service IPC/possible activation N26; not direct child launch proof                                                                                                   |
| `main.js:541`, `ipcHandlers.js:1698,4017,5385,8971,9072,9609,9626`, `windowManager.js`, `menuManager.js`, `meetingDetectionEngine.js`, `oauthLoopbackFlow.js`                                                                                 | wrapped browser/mail/settings handoffs; raw file-manager reveals                                    | outside-app N21; scheme/path validation; main confirmation while sealed for web, mail and settings (Task 11)                                                                        |
| `meetingJoinUrl.js`, `src/utils/externalLinks.ts`, `src/components/settings/UpdateSettings.tsx`, `src/components/googleRevokeNotice.ts`, `src/components/IntegrationsView.tsx` (D-1 Google Account link), `src/preview/browserPreview.ts:361` | injected/IPC external opener callbacks                                                              | delegate to main N21; browser-only DEV preview uses window.open, not direct provider transport                                                                                      |
| `windowManager.js:220,1488,2203,2480`                                                                                                                                                                                                         | BrowserWindow constructors; Chromium-managed runtimes                                               | N25 renderer/session enforcement; each window installs both `window.open` and `will-navigate` handlers (ratchet in `egressInventory.test.js`); not a verified native model boundary |
| `autoStart.js:21`, `linuxAutostart.js:179`, `main.js:277`                                                                                                                                                                                     | OS login-item registration and XDG autostart entry write/repair                                     | delegated future self-launch N26, not immediate execution; next-start sealed admission still required                                                                               |
| `hotkeyManager.js`, `windowBroadcast.js`                                                                                                                                                                                                      | BrowserWindow imports for window lookup only                                                        | conservative import entries, no launch observed                                                                                                                                     |

```spawn-sites
main.js
src/components/IntegrationsView.tsx
src/components/googleRevokeNotice.ts
src/components/settings/UpdateSettings.tsx
src/helpers/appleCalendarManager.js
src/helpers/audioActivityDetector.js
src/helpers/audioTapManager.js
src/helpers/autoStart.js
src/helpers/clipboard.js
src/helpers/codexAppServer.js
src/helpers/codexCli.js
src/helpers/diarization.js
src/helpers/downloadUtils.js
src/helpers/ensureYdotool.js
src/helpers/externalUrlOpener.js
src/helpers/ffmpegUtils.js
src/helpers/freedesktopNotifications.js
src/helpers/globeKeyManager.js
src/helpers/gnomeGlobalShortcutsPortal.js
src/helpers/gnomeShortcut.js
src/helpers/hotkeyManager.js
src/helpers/hyprlandShortcut.js
src/helpers/ipcHandlers.js
src/helpers/kdeShortcut.js
src/helpers/linuxAutostart.js
src/helpers/linuxKeyManager.js
src/helpers/linuxPortalAudioManager.js
src/helpers/linuxWindowInputRegion.js
src/helpers/llamaCppInstaller.js
src/helpers/llamaServer.js
src/helpers/mediaPlayer.js
src/helpers/meetingAecManager.js
src/helpers/meetingDetectionEngine.js
src/helpers/meetingJoinUrl.js
src/helpers/menuManager.js
src/helpers/oauthLoopbackFlow.js
src/helpers/onnxWorkerClient.js
src/helpers/parakeetWsServer.js
src/helpers/personalInference.js
src/helpers/processListCache.js
src/helpers/privacy/childRegistry.js
src/helpers/privacy/processIdentity.js
src/helpers/qdrantManager.js
src/helpers/selectionManager.js
src/helpers/sidecarReaper.js
src/helpers/systemDefaultMicrophone.js
src/helpers/systemTar.js
src/helpers/textEditMonitor.js
src/helpers/updateIPC.js
src/helpers/updateManager.js
src/helpers/urlAudioDownloader.js
src/helpers/whisperServer.js
src/helpers/windowBroadcast.js
src/helpers/windowManager.js
src/helpers/windowsKeyManager.js
src/helpers/windowsLoopbackAudioManager.js
src/preview/browserPreview.ts
src/utils/externalLinks.ts
src/utils/gpuDetection.js
src/utils/process.js
```

Later owning tasks must extend both fences for new helpers (including privacy guards and STT transport), and retain intentional injected/SDK/native/OS entries even without primitive hits. The scanner self-tests exercise positive aliases/imports, callbacks, SDKs, resources, service activation and relaunch APIs, plus negative comments, declarations and RegExp.exec. Arbitrary computed imports, callback renaming/dataflow and native dependency internals still require source review and executed production-wiring tests. A passing ratchet is inventory evidence only.

## Task 6a: native refusal and unresolved evidence (07a)

`childRegistry.installSpawnGuard` refuses every child_process launch, including
Sync APIs, self launches, shell commands and utilityProcess.fork, while the gate
is sealed. Binary directories and command families classify intent only. There
is no native-boundary approval seam that can succeed in this build. Task 7 must
install guards before modules capture native APIs and consume startup diagnostics
before admitting native managers; that startup wiring is not part of Task 6a.

Unsealed asynchronous launches are tracked through actual end events. Stop signals
and errors after start are not exits. Opaque sessions settle once at root end,
with unknown byte counts; tree diagnostics persist separately. Detached group
liveness (observed continuously, on a monotonic clock) and known-descendant
snapshots are partial observations, never full-tree
containment or acknowledged whole-tree stop. Unknown descendants remain named
`DESCENDANTS_UNVERIFIED` after root/group exit. Local engines receive no stop
exemption. Native inspection itself is refused sealed, without a ps/tasklist
escape. No successful pause, native availability or completed seal is supplied.

The guard also wraps `ChildProcess.prototype.spawn`, the choke point every
`child_process` API uses (a launch the module guard already admitted is not
counted twice), and `process.execve` (Task 18 T18-04). A sealed refusal is not
a request. The gate records it once per program per seal epoch as a
`nativeLaunch` operation: attributed, `blocked`, bytes 0/0, host
`native-<program>`. It never adds to `blockedSinceSealed`, the blocked-request
count or the unexplained hosts. Pollers therefore cannot flood the recorder: a
Linux meeting detector refused every few seconds yields one row per program.
Meeting detection itself starts no detector while sealed (at a sealed startup,
from its preference channels or after a meeting ends), and the seal transition
pauses it and resumes it on unseal.

The startup reaper preserves saved PID records for failed/refused/unavailable
inspection, positive PID reuse, root exit and unknown descendants. It returns
`{ unresolved }` and records the same failure-only diagnostics in the registry;
`sidecarPidFile.readForReaping` also distinguishes unreadable/invalid evidence
from an absent registry. Durable unresolved PID copies survive a manager replacing
or clearing its current PID; failed preservation protects the original. A reused
PID is not signalled. Even a matched root that exits after escalation leaves its old descendant coverage unresolved. The sole
record is not cleared; 07b must provide trustworthy resolution. Task 7 owns
consumption before native-manager work.

All four FFmpeg sites, including private pipe decoding, apply exact file,pipe
input restrictions. Unsafe overrides, shell execution and dynamic output protocol
forms are rejected. Private conversion remains buffer/pipe based. This restriction
and the ONNX worker's first-statement Node lock are defense in depth only; neither
authorizes a sealed native launch. The worker can load native ONNX code when
unsealed; its JS lock does not confine that native code. 07b/D14–D16 remain open.

## Task 8: provider inference, provider checks and Codex (07a)

`personalInference.js` admits every text, vision, search, cleanup, note and
translation request through one egress ticket before any credential or SDK is
touched. The target is the captured or resolved effective endpoint
(`privacy/providerEndpoints.js` `effectiveEndpoint`): the captured executor for
Plan 04 operations, the user's URL for custom/LAN/local, the SDK base-URL
snapshot for OpenAI/Anthropic, and the resolved Azure/Bedrock/Vertex executor.
Enterprise requests that are not yet captured are refused while sealed before
main reads their configuration; an unresolved recipient is unknown, which is
remote, and its blocked row names the host `unknown`, never a fixed label. The task is the request's disclosure task, else its scope's task, and
notices carry the original correlation id, so Plan 04's tracker keeps the same
session evidence. Factory slot 8 is the metered fetch composed over any injected
transport; slot 9 keeps the captured operation's liveness. Sealing aborts the
ticket with an interrupted `SealedModeError`, which the request reports; it is
never "nothing was sent". Captured operations return a typed `SEALED_MODE`
envelope with its phase, which preload rebuilds; cancel and retire stay usable.

Model discovery is gated after recipient-token validation and before credential
capture; the Tinfoil catalog, every provider Verify/connection test (ordinary,
Corti token, enterprise SDK and ADC exchange) and the four legacy enterprise
channels are gated as `providerCheck` or their scope task. Metered exchanges
that sent nothing (a cached answer or local validation failure) write no row.
`gatedFetch.js` provides the per-request `gatedNetFetch`/`gatedNodeFetch` and the
whole-exchange `guardMetered` helper. A gated response keeps its ticket open
until its body ends, so every caller reads or cancels a non-ok body; a declined
error body is recorded as that HTTP error. Hosts that an SDK's own credential or
token traffic reached outside the metered attempts (for example Vertex ADC or
Bedrock SSO/STS, attributed by Layer B) get one `connection` row with unknown
bytes.

Codex status, login, logout, models, model catalog and rate limits refuse while
sealed before the app-server could start; cancel-login stays usable. With no
current app-server child and no start pending (for example, after the seal
stopped it), Loqui no longer holds the process the sign-in lived in, so
cancel-login resolves `appServerStopped` without a probe, spawn or row (whether
that process exited is the child registry's to say, not this check's), and Settings clears its waiting state without a
status read. The production server refuses before its native executable probe and again
immediately before the app-server spawn; release verification is a metered
`codex` request to GitHub. Each app-server process is one opaque session row
(`codex`, chatgpt.com, no byte counts) authorized before the launch, so the spawn
guard reuses it; only its observed exit settles it. `stopCodex` cancels a pending
start and resolves only after the process exits (SIGTERM, then SIGKILL), else
rejects `CODEX_STOP_FAILED`; `codexRunning` is true until that exit. Root exit is
not whole-tree proof: the child registry keeps descendant coverage unresolved.
None of this is native isolation; the Codex app-server is a native child that
07a refuses to start while sealed. 07b/D14–D16 remain open.

## Task 9: batch speech, retry and legacy proxies (07a)

`sttTransport.js` holds the multipart helpers moved unchanged from
`ipcHandlers.js`. `postMultipart` runs one egress ticket over a metered, tagged
Electron request and the body read: `bytesOut` is the exact multipart body
length, receipts are `dispatched` just before the transport and `delivered` when
the response arrives, the caller's signal (upload cancel) composes with the
ticket's, and sealing it mid-flight rejects as interrupted, never "nothing was
sent". The Corti token and REST requests, the Gemini Interactions request and
the legacy xAI, Mistral and Anthropic proxies use `gatedNetFetch`; only Corti's
recording upload, Gemini's request and the speech proxies carry `audio` (the
Anthropic proxy carries `text`, or `image` with screen context). The Tinfoil
batch request and its attestation run inside one ticket. Injected `fetchImpl`
overrides (Verify's metered transport, unit tests) are unchanged.

`transcribe-audio-file-byok` runs as `dictationStt` for captured audio and
`uploadStt` for a file, correlated by the dictation session id, else the
upload's `requestId`. `retry-transcription` and the `proxy-*-transcription`
channels run as `dictationStt`, and `process-anthropic-reasoning` as
`dictationCleanup`. Each checks the route's recipient after Plan 03's route
resolution and before any credential read, temporary MP3/WAV conversion or
transport, so a sealed refusal writes one `blocked` row and the recording, file
or stored History audio is kept. The canonical target is the provider id, or
`host:<host>` for custom and self-hosted endpoints. A user-owned loopback
endpoint stays usable; any native conversion it would need is still refused by
the spawn guard (retry then uploads the stored container, as on any conversion
failure). Handlers that return an envelope add `code: "SEALED_MODE"` and the
`phase`; the error text keeps its `[SEALED_MODE]`/`[SEALED_MODE:interrupted]`
marker. Realtime token requests (`proxyFetch`) are gated with their caller's
task; Task 9a attributes the streaming callers (below). A sealed Corti dictation
cannot delete its interaction afterwards (that request is also refused).
None of this is native isolation. 07b/D14–D16 remain open.

## Task 9a: realtime speech per recording and per connection (07a)

Realtime speech (N9/N10) has two resources with different lifetimes. A socket
is a **connection**: it may be warmed before any recording, replaced during one
(Deepgram liveness reconnect, Gemini token re-mint, meeting reconnect) or serve
one meeting source. A **recording** is an immutable handle
(`sttTransport.beginRealtimeRecording`) owned by the existing dictation
operation record or meeting session; there is no second ownership registry.

- Every adapter socket is opened by `connectRealtime` inside its own ticket
  (`kind: "connection"`, payload metadata, never a correlation id or content
  receipt). It counts wire bytes on its own socket (attached at upgrade, and by
  Layer B at connect) and settles only when that socket closes.
- Every content frame carries its recording's handle through IPC identity, the
  adapter and the actual `streamingHandOff.sendContentFrame` hand-off,
  including cold-start, pre-config, replay and aggregation buffers (buffered
  frames keep the handle they were captured for). A missing, copied, finished
  or sealed handle refuses the frame. After the socket accepts a frame,
  `markRealtimeDispatched` updates only that handle: one `kind: "stream"` row
  per recording (content bytes its frames handed to a socket; inbound unknown)
  and one audio `dispatched` receipt with exactly that recording's correlation
  id and provider target. A warm socket with no frames has no audio receipt. A
  recording is settled after its flush/stop acknowledgement, cancel, error or
  owner loss; a recording that sent nothing writes no stream row.
- Dictation streaming is `dictationStt`; meeting streams are
  `noteRecordingStt`. Their token and auth requests (AssemblyAI token, Corti
  auth) run in that task as connection metadata, never with a recording id.
- A socket `error` settles its connection row as failed; the row is written at
  the real TCP close.
- While sealed, every warmup, start, prepare and replacement connection is
  refused before its credential read, token request or socket (one `blocked`
  row). Sealing mid-stream interrupts the recording (`cancelled`,
  `SEALED_MODE`, its bytes and dispatched receipt kept) and closes the
  connection separately; stop/start results carry `phase: "interrupted"`,
  never "nothing was sent". A start cut off after admission is reported as
  interrupted too.

Loopback realtime endpoints stay usable while sealed and are not recorded.
Eligibility of a local socket transport is not native-launch availability:
native engines stay refused while sealed. None of this is native isolation.
07b/D14–D16 remain open.

## Task 10: downloads, URL import, yt-dlp and updates (07a)

Model and runtime downloads (N12/N13) go through `downloadUtils`.
`downloadFile` and `fetchJson` take `egressTask` (`modelDownload` by default;
the GPU manager, shared by the CUDA/Vulkan whisper and Vulkan llama packs,
passes `runtimeDownload`). While sealed they are refused before
`net.request`/`net.fetch` (one `blocked` row). Unsealed, every actual Electron
request, including each retry, is its own tagged attempt row: Chromium's
redirect hops join its host trail, `bytesIn` counts that request's body only
(so a resumed download never recounts earlier bytes), an unfinished body is
`null`, and request bytes of a bodyless GET are `null`. Sealing mid-download
aborts the request and any retry backoff, keeps `<dest>.tmp` for a later
`Range` resume and rejects as interrupted; a user cancel still deletes it.
Archive extraction launches `unzip`/`tar`/PowerShell, which the spawn guard
refuses while sealed.

URL import (N14) is refused while sealed before any DNS, socket or child.
Direct imports keep their SSRF checks and record one row per HEAD, GET and
redirect hop (Node requests untagged, Electron proxy requests tagged). A
YouTube import runs yt-dlp: one opaque `urlImport` session (no byte counts) that
is settled only when the import has returned and every yt-dlp it started has
exited, even if the caller was released earlier by an error event; an import
that never started yt-dlp claims no session. Sealing signals yt-dlp through the
session and rejects as interrupted once it exits. The yt-dlp self-update (N15)
is not attempted while sealed; unsealed it is its own opaque `runtimeDownload`
session to `github.com`, settled at the process's exit, not at the caller's
timeout; a failed start writes no session. Both run detached on POSIX and are
registered with the child registry; `ytDlpControl` is a view over it, and in
07a its `alive()` stays true after a root exits (descendants unverified).
The bundled yt-dlp is a PyInstaller one-file build whose bootloader root runs
the real program as a child, so a seal, timeout or cancel of the self-update
signals the whole POSIX process group (`childRegistry.signalGroup`), not just
the root. The registry signals a group while its root is unreaped, and after
the root exits only while the group, observed continuously, still exists as
ours: probed at the root's exit notification, then every 100 ms on a monotonic
clock; a failed or thrown probe, or
a gap over 400 ms, ends that for good, because the id may then be reused.
Continuity alone relies on the kernel's cyclic pid allocation, so owner
decision D-3 (2026-10-23) also requires identity proof before a reaped root's
group is signalled. At spawn the registry records the leader's pid, pgid,
session id and start time (`src/helpers/privacy/processIdentity.js`: Linux
`/proc/<pid>/stat`; macOS `ps` lstart, which is a native launch and so refused
while sealed, and reports no session id). Before the signal it requires that no
process now holds the leader's pid and that the group has members, each in the
recorded session (where reported) and started no earlier than the leader. Any
failure (no recorded identity, `NOT_GROUP_LEADER`, `PROC_UNREADABLE`,
`PID_REUSED`, `PGID_REUSED`, `GROUP_CONTINUITY_LOST`) sends no signal, leaves
the obligation unresolved so the sealing barrier fails closed, and is named:
the diagnostics reason is `GROUP_OWNERSHIP_UNPROVEN` with the typed
`groupProof`, which the attestation's `child:` failures carry to the panel, and
`stopAll`'s `CHILD_STOP_FAILED` error lists it in `unproven`. A live root is
signalled without proof, since its pid cannot be reused; `killProcessGroup`
(`src/utils/process.js`) now also skips a root that ended by a signal. Proof is
of the group id, never of the tree. On macOS, a sealed stop of a group whose
root exited is therefore always unproven (NOT VERIFIED on macOS: no Mac run).
Windows keeps the root-only kill (`taskkill` is refused while sealed; 07b).

A seal that interrupts the optional MTP drafter or diarization VAD download
fails the whole download (never reported complete) and keeps that file's
`.tmp`. A download cancelled before its first attempt, or a direct import that
fails a local check (an invalid URL, the SSRF rule) before any request, writes
no row and names no host it never contacted. The yt-dlp group
is signalled only through the child registry (`signalGroup`). A URL import re-checks for a seal or cancel after resolving the OS
proxy, before any DNS lookup or request, and a cancelled request starts no
attempt.

App updates (N16): `UpdateManager` reads main's live seal state. A scheduled
check is skipped while sealed without advancing `lastCheck`; a manual check is
refused (`blocked`, typed `SEALED_MODE`). One `appUpdate` ticket spans the
check and any download it starts; its tag rides electron-updater's own request
headers for the session backstop. The seal's abort of that ticket alone cancels
a running download. `pauseForSeal` cancels a download, publishes
idle without counting a failure, and a check that answers after sealing never
starts a download; "available" and "ready" are kept. Turning automatic updates
on while sealed keeps "available" and `resumeAfterSeal` fetches it (D13).
Restart/install is refused while sealed in the manager as well as in
`updateIPC`. None of this is native isolation. 07b/D14–D16 remain open.

## Task 11: calendars, their background sync, pending sign-ins and links (07a)

Calendar requests (N19) go through the egress gate as task `calendar`: Google
and Microsoft token exchanges and refreshes, the Microsoft Graph `/me`
fallback, and every Calendar/Graph read. While sealed they are refused before
`net.fetch` (one `blocked` row); a seal aborts one in flight (interrupted,
`cancelled`/`SEALED_MODE` row). A seal also ends a sync loop: later accounts,
calendars and Microsoft series masters are not attempted, and a sync it
interrupted commits no events, stubs or sync/delta token. The renderer's
calendar entry points that reach a provider (Google and Microsoft sign-in,
manual sync, calendar selection, primary-only) refuse while sealed before a
loopback listener, consent page or request exists; local reads and
disconnects stay available. An unsealed disconnect is local only, as before.

**Pending Google revoke (owner decision D-1, 2026-10-23).** A Google
disconnect while sealed sends nothing: before deleting Loqui's own tokens,
main keeps a pending revoke (`src/helpers/googlePendingRevoke.js`), one token
per grant (the refresh token when there is one) in `secure-keys/`, encrypted
with `secretCrypto` like every stored key and used for nothing but the revoke.
It survives a restart. Main runs it automatically after unsealing (the
calendars' `resumeAfterSeal` hook) and at an unsealed start (`start()`, which
`calendarGuard` never calls while sealed); an automatic run never starts while
sealed and stops before the next token if a seal arrives. The revoke is a
ticketed `calendar` request through the gate, listed in the flight recorder;
the token is deleted only when Google answers 200 (or 400 `invalid_token`,
the grant already gone). A failure keeps it, and the renderer
(`GoogleRevokeNoticeListener`) says plainly that the grant may still be
active at Google, with Retry (`gcal-pending-revoke-retry`, the same ticketed
request, refused at the gate while sealed) and the Google Account permissions
page through the guarded external opener. If the token cannot be kept
securely (no `secretCrypto` backend), nothing is written and the user is told
Google keeps the access until they remove it. App cleanup ("Erase all data" /
Reset everything, `cleanup-app`) still makes its best-effort revoke of the
database tokens, refused while sealed. It erases the pending record with every
other credential, never silently: unsealed it first retries the pending
revoke and reports `googleRevokeFailed` if a grant may remain; sealed it
reports `googleGrantKept`. Both say the grant may remain at Google and link
the Google Account page. A record that can no longer be decrypted (for
example the Linux keyring's master key changed) is a revoke whose state is
unknown, never "nothing pending" (review I-1): no token is usable, so there
is no Retry. Every run (after unsealing, at an unsealed start) broadcasts
`unreadable`, and the window's startup read shows it too, including at a
sealed start: a persistent notice says the access may still be active at
Google, with the Google Account link. Main removes the record only once the
user dismisses that notice (`gcal-pending-revoke-forget`, local, which never
removes a readable record), or with Reset everything, which reports it as
`googleRevokeFailed`, sealed or not. Tests: `googlePendingRevoke.test.js`
(including an unreadable record at reset, at unseal and at a restart), the
N19 `gcal-pending-revoke-retry` matrix row, `googleRevokeNotice.test.js` and
`storageList.test.js`.

Scheduling (N20): `main.js` starts, focus-syncs and wake-syncs Google,
Microsoft and Apple only through `privacy/calendarGuard`, which does nothing
while sealed (or when the seal state cannot be read). The sync runner itself
never arms, ticks or focus-syncs while sealed, whichever path asks. Sealing
stops the runners (existing `stop()`) and stops Apple's helper. Apple is not
exempt: `acal-connect` refuses before launch while sealed, and the spawn guard
refuses the EventKit helper anyway. Unsealing calls each remote manager's
`resumeAfterSeal()`, which reloads accounts from the local database and
re-arms the existing 2-minute interval only. No calendar request is made by
the unseal itself: the first sync happens at the next interval tick, window
focus or wake, exactly as without the seal. Apple, which has no
`resumeAfterSeal`, restarts its local helper as it does at launch.

Pending sign-ins (N19): the loopback flow registers every sign-in in
progress. The seal transition cancels them synchronously with the seal,
after closing admission: each rejects as interrupted, its 127.0.0.1 listener
closes, so a consent page that completes later reaches nothing, and a token
exchange already under way is aborted through its own signal (and through the
gate's ticket). A cancelled exchange saves no tokens. A declined consent page
ends the sign-in quietly instead of waiting for the timeout.

Links (N21): the browser, mail client and OS settings app are outside Loqui's
process boundary; Sealed mode cannot meter or stop their traffic. While
sealed, every web/mail handoff and every fixed OS-settings pane asks first in
a main-owned dialog the renderer cannot answer. Handoffs include renderer
`open-external`, meeting join, the Help menu, and calendar and Codex consent
pages. They also include links and `window.open` in every window: the main
window (an Assistant answer's links), the pill, the notification window and
the control panel. Every window denies in-app child windows and navigation
away from the app, and routes http(s) and `mailto:` to the guarded opener
(`navigationGuard`, final review I3). Chromium's own external-protocol
permission (`mailto:` and similar) is denied and routed the same way, so no
link reaches the OS without that dialog (Task 18 K1). The OS receives exactly
the serialized URL whose host the dialog named. The dialog names only the host (ASCII,
without credentials, path or query) or "your email app", says the other app is
not covered, and defaults to "Don't open". Declining is silent. OS-settings
URLs stay main's fixed table on a separate entry point; the web/mail scheme
allowlist is unchanged. File-manager reveals of app-owned local paths
(`showItemInFolder`/`openPath`) carry no URL or destination and are not
confirmed. On Windows a confirmed web link still cannot launch `explorer.exe`
while sealed (native refusal) and falls back to `shell.openExternal`. None of
this is isolation of the browser, mail client, settings app or Apple's
calendar services; 07b/D14–D16 remain open.

## Task 12: the enforcement matrix (07a)

`test/helpers/sealedModeEnforcement.test.js` drives every blocked request family through the real registered handlers (`new IPCHandlers`, `registerPersonalInferenceIPC` with the production Codex factory, `attachUpdateIPC`, the external-open guard, and `main.js` itself in a VM) with synthetic credentials and configuration in the real environment and credential authority. Only terminal leaves are fakes: Electron `net`, Node `fetch` under the Layer B backstop, the `ws` constructor, the Tinfoil SDK client, native `child_process`/utility leaves under the spawn guard, and OS handoffs. URL import and yt-dlp rows live in `test/helpers/urlAudioDownloader.test.js`, the only file the test safety chain lets load the real downloader.

- Each refused row asserts a typed `SEALED_MODE` result that states the phase `refused` (or the documented typed shape, or the confirmation path for OS handoffs), no transport, socket, native leaf or credential read, and a blocked ledger row with `bytesOut: 0`. The exception is `cleanup-app` (next bullet): its refusal is the blocked ledger row, and its revoke reads the local Google token before the gate refuses the request. Refused program starts are found as `nativeLaunch` operation rows. The restart row runs `main.js`'s own `assertRestartAllowed` closure, captured from the VM run. Each then runs with Layer A disabled and must reach a terminal leaf or a Layer B refusal.
- "Erase all data" (`cleanup-app`) runs on its own instance of the real handlers: its Google token revoke is refused before any socket (one blocked `calendar` row) and the local erase still completes, local Google tokens included.
- A ratchet enumerates every channel the real code registers. A new channel fails until it is a matrix row or declared with its reason (local only, a follow-up of an admitted session, a local engine refused by the spawn guard, a manager that is a stand-in in the harness, an OS permission or setting, a file-manager reveal, or a meeting-link handoff). A declared channel must not be able to make a request without a native launch.
- Product fixes found by the matrix: the Keyring's Verify and enterprise Verify read the stored credential before their seal check; they now refuse (and record one blocked `providerCheck` row) before the read. The model manager relabelled a sealed refusal as `NETWORK_ERROR`, and the three GPU runtime downloads and `main.js`'s `download-search-model` returned it without `code: "SEALED_MODE"`; all now keep it typed.
- This matrix is JavaScript evidence only. It proves nothing about Chromium sessions, real sockets, electron-updater, or native child isolation: Task 16 and 07b own those, and the merge gate stays open.

## Consolidated fix wave (07a, 2026-10-23)

The final review and the Task 18 security review (`docs/security/sealed-mode-review-2026-10.md`) were answered in one fix wave. Most changes are in the sections above. These have no other home:

- **Loopback rule.** A host containing `%` (an IPv6 zone id) is never loopback, in main (`egressPolicy`) and in the renderer (`locality.ts`). A malformed IPv6 literal returns "not loopback" instead of throwing.
- **Socket forms.** Layer B normalizes `Socket#connect` arguments exactly as Node does, so a string port such as `"0x50"` or `" 443"` is a port, not a pipe path. A shape it cannot classify is refused while sealed (Task 18 T18-01).
- **Phases.** A `SEALED_MODE` error or envelope that does not state its phase is read as interrupted: by the main policy, preload, captured cleanup and the renderer. "Nothing was sent" appears only for an explicit refusal (Task 18 T18-06).
- **Renderer copy.** Every surface that shows a failure checks `sealedFailureMessage` first, or keeps the sealed key, and shows translated sealed copy. That covers downloads, URL import, GPU packs and every Codex surface including the model list, as well as local-engine test-load and import, file transcription, Tinfoil models, chat voice drafts, Prompt Studio, History retry and cleanup notices, the patchbay hint, meeting and background-action notices, and the batch queue. Main's `[SEALED_MODE…]` text never renders on those surfaces (re-review N1; R2-m1 added the History cleanup notice and the custom endpoint's model list; touch-up 2 the live dictation cleanup notice and its Retry alert; touch-up 3 the dictation error card, which is sealed by its code or by main's marker in its text, so a private take's refused FFmpeg merge is covered). Automatic paste (touch-up 3, O1): every paste helper is a native program the spawn guard refuses, so `ClipboardManager` settles a sealed paste at once as a typed failure after writing the text with Electron's clipboard API, and `paste-text` returns `{ code: "SEALED_MODE", copiedToClipboard }`. Before this, the refusal was thrown inside a timer callback: an uncaught exception in main that left the paste, and the paste queue, pending forever. Surfaces that cannot reach a sealed refusal (microphone and hotkey registration, local storage and note files, dictionary export, settings-file rebuild) show their own text. `sealedFailureMessage.test.js` lists every site beside executed cases.
- **Recorder availability.** A failed write no longer hides the list or blocks Clear and Export. A later successful write flushes the pending rows, and only a read failure makes the recorder unavailable. Main reports each unresolved failure by kind (`persistErrorKinds`: save, delete, read). The panel says the list may be incomplete only for records not written; a failed delete and a failed read beside an earlier list each get their own line (re-review m9). Same-time rows list newest first, and `egress_events.ended_at` is indexed.
- **Blocked count.** `blockedSinceSealed` counts refusals only: no interruptions, no program starts.
- **Sealed state.** An explicit user choice clears a startup load error, even when saving it fails (`saveError` is still reported).
- **Held recordings.** Transcribe replays a held recording under its own privacy, never the latest press's. A sealed failure for a session that no longer owns the audio saves or holds that audio instead of dropping it. A seal that stops an Undo streaming replay with no words fails the replay and re-holds the copy; it never reports an empty success. Undo on a built-in engine is refused before it starts.
- **Probe caches.** GPU detection and the Linux portal probe do not cache a sealed refusal as "unavailable" after unseal.
- **Comments.** The control-panel comment in `windowConfig.js` no longer claims that the window makes no network requests (Task 7a M1).
- **Ratchets.** `egressInventory.test.js` adds three source ratchets, each beside executed tests:
  - Electron's `shell.openExternal` is reached only from `externalUrlOpener.js`;
  - every `new BrowserWindow` installs both window handlers;
  - every gated-fetch caller reads or cancels a non-ok body.

  Like the inventory fences, they are review aids, not runtime proof.

## Fix-wave round 2 (07a, 2026-10-23)

The scoped re-review and the Task 18 focused security re-review (`docs/security/sealed-mode-review-2026-10.md`, "Focused re-review") were answered in a second round:

- **Forwarding (T18R-01, m4).** Threat 8: the request head Node will send is judged, not the options it was built from.
- **Connect (T18R-02).** The Layer B row: Node is handed the snapshot that was judged.
- **Replay race (T18R-03).** A cancelled Transcribe replay frees the manager at once, so a newer press can start before the replay unwinds. The replay's end now restores the recording context, privacy and onboarding take only while its own context object is still installed, and only fields that still hold its own values. A newer private take keeps its privacy, so it is never pasted, copied or saved as public. This was chosen over refusing presses during the unwind: the protection is the same, and dictation never stalls behind a cancelled request that is slow to settle.
- **Permissions and navigation (T18R-04, T18R-06).** The windows row. The permission policy holds sealed or not. Runtime is NOT VERIFIED (Task 16 item T18R-04).
- **Session hardening (T18R-05).** A session counts as hardened only after every call fulfilled. An unconfirmed session is retried on the next sync, and its failure (`sessionHardening`, `sessionRestore`) stays in the transition's failures and the attestation until a later attempt succeeds. The pre-seal spellcheck state is read once per sealing.
- **Spellcheck after a sealed quit (m1).** Electron keeps the spellchecker setting in the profile's preferences. Before turning it off, Loqui writes `privacy-spellcheck.json` (0600, never through a symlink) beside `privacy.json`. The unseal restore, or the first unsealed start, turns spellcheck back on and removes the marker. NOT VERIFIED at runtime (Task 16 item FWR-m1).
- **Native entry points (T18R-07).** The spawn-guard row. "Every native start" means through the public entry points as looked up after boot.
- **Smaller fixes.** A phase-less cleanup rejection defaults to interrupted (m3). GPU-probe refusals are tracked per call, so a concurrent probe cannot cache a sealed "no GPU" (m10). The recorder counts and names refused programs from main's summary (m2, m7) and reports persistence failures by kind (m9).

**Still open.**

- T18-03's remainder: raw socket writes, SOCKS, HTTP/2 and other HTTP stacks to a loopback forwarder the user runs (threat 8). Owner decision D-5 accepts this as outside the guarantee and closes the `envProxy` forwarding hazard for Loqui's own Node requests.
- T18-02 has not been observed at runtime (threat 7, Task 16).
- Owner decisions (2026-10-23): D-1 (pending Google revoke after unseal), D-3 (process-group ownership proof) and D-5 (proxies) are implemented above. D-2: Corti keeps the honest "Corti may still hold the dictation" copy (`sealedMode.interrupted.cortiRetained`) and gets no new IPC; a user-initiated provider-side deletion is a follow-up only if Corti's API supports it. D-4, the Parakeet all-interfaces bind, stays with 07b (6g).
- 07b/D14–D16, and the Linux D15 `.deb`/`.rpm` boundary proof. The merge gate is NOT met.
