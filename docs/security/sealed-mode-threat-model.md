# Sealed mode: threat model and network inventory

Owner: [Plan 07](../superpowers/plans/2026-10-15-loqui-uiux-07-sealed-mode.md), partial phase **07a**. Current source baseline: `858205f6b224a3f9ac08477ac2ca03526c564b0e`. Update this document and its machine-readable fences with every new transport, resource load, process launch or delegated OS handoff. `test/helpers/egressInventory.test.js` checks the inventory against source.

## Status and required promise

**Task 1 supplies documentation and static ratchets only. It installs no runtime enforcement.** Layer A/B, spawn guards, dialogs, recorder and barriers below are planned 07a work, not shipping proof. Existing route/credential/session checks do not establish a network boundary.

The eventual promise covers Loqui's main process, Chromium sessions/renderers, workers and the complete trees of programs it starts, with independently verified controls admitting strict numeric loopback only. **Every platform's native boundary is unavailable in 07a. `nothingLeaves=false` and `effectiveSince=null`, including with empty child arrays and zero counters.** No successful native `isolated`/`networkFree` state, verified seal, zero-egress claim or positive native fixture is justified.

Planned 07a admission must refuse **all native starts before launch while sealed** until 07b independently verifies the required boundary: bundled engines, FFmpeg, OS tools, workers, Sync APIs, fork/utility processes, credential processes, self relaunch and updater install/restart included. Allowlisted programs/arguments, loopback binds, telemetry flags, JavaScript locks, launcher acknowledgements and probe reports grant no exception. This refusal is partial protection, not D16 completion or a macOS pause fallback.

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
4. **Legacy startup evidence (A23).** Current `src/helpers/sidecarReaper.js:29–45` maps failed inspection to empty text; `:90–101` may clear saved PID evidence. Tasks 6a/7 must read and preserve saved records without sealed `ps`/`tasklist` launches and synchronously hand named unresolved legacy-tree diagnostics to main **before manager admission**. Failed unsealed inspection must also preserve evidence. Distinguish positively identified reused PIDs from unknown inspection; never blindly signal reused/unverified PIDs. Root-exited/unknown-descendant records stay unresolved. Task 12 must test these cases and startup consumption. Task 1 implements no registry, reaper repair or whole-tree resolution interface. Actual resolution proof belongs to 07b.
5. **Startup/restart admission escapes.** `main.js:9–16` currently spawns XWayland relaunch before profile setup. `src/helpers/ipcHandlers.js:3383–3410` schedules a waiter then `app.relaunch`; updater's default install calls `quitAndInstall`. Tasks 6a/7/10 must gate before scheduling/executing these and before manager constructors, microphone/capability probes, listeners, calendar helpers and service activation. Autostart is also a delegated future-launch capability: `autoStart.js:21` registers macOS/Windows login items and `linuxAutostart.js:179` writes an XDG desktop entry; `main.js:277` may repair that entry on startup. Registration is not an immediate process start or boundary proof. Next-start profile/seal guards must run before native admission, including login/packaged-wrapper launch paths. Task 7 must account for this startup seam. Boot ordering is not fixed by this document.
6. **Renderer authority abuse.** Planned trusted-main-frame IPC and main-owned native dialogs protect unseal, recorder clear/export and external handoffs. Preserve existing fixed OS-settings scheme and file-path validation; no renderer-supplied arbitrary system URLs. Declined links are silent.
7. **Chromium bypasses provider IPC.** Markdown images, icons, navigation, WebRTC and speculative DNS/preconnect require Task 7a hardening, Task 13 inert remote images sealed/unknown and Task 16 real Electron observation. Static rows cannot close that gate.
8. **Loopback forwarders.** Main transport eligibility differs from native-launch availability and from user-owned forwarder security. Planned main guards may admit strict loopback sockets, but a user's forwarder can relay remotely. Reject loopback CONNECT/absolute-form requests naming remote targets, ban uncontrolled dispatcher/proxy paths, and retain environment proxies as unresolved. This does not certify a plain loopback relay or make built-in engines available. Locality must match main/renderer: localhost and subdomains, 127/8, ::1 and mapped 127.x normalize/pin to numeric loopback; LAN/public, unparseable targets or arbitrary DNS names resolving to loopback are not local.
9. **Recorder content leakage or false certainty.** Store only bounded metadata: start/end, task/provider/model enum IDs, bare hosts (up to eight), outcomes/status, byte counts and error code/class. Never content, keys, URLs with paths/query strings or error messages. Unknown bytes are `null` (“—”), including bodyless requests. Body counters exclude headers; realtime sessions count their socket wire bytes. Only refusal before a socket opens can record `bytesOut: 0`. Interrupted/redirected earlier attempts cannot be rewritten as wholly unsent. Codex/yt-dlp opaque sessions retain unknown bytes and separately labeled **usual hosts**, not a measured complete destination trail; settle at actual process/tree outcome, not caller timeout. Empty/pruned/cleared/RAM-only ledgers do not attest no egress. Retention follows privacy settings, including 100000 durable rows for forever retention and last-500 memory-only rows when disabled; memory-only rows never become durable later.

Outside the eventual boundary: other apps and OS services are not covered. Web/mail/OAuth/meeting/help links require planned main confirmation naming host and outside-app scope. File-manager and fixed-settings handoffs also cross this boundary; confirmation never overrides unavailable native-launch admission (including Windows explorer). Cancel pending calendar sign-ins, close loopback callbacks and abort claimed token exchanges on seal. Apple EventKit is native, not exempt. OS DNS-over-HTTPS, iCloud and system updates are not Loqui traffic; Loqui's own delegation to services must still be controlled. Malicious local profile readers are out of scope. Build/packaging scripts (`scripts/`, `cleanup.js`) are developer/CI scope, outside this app ratchet. No Windows orphan-refresh window or POSIX process-group assumption is accepted as whole-tree proof.

## Planned enforcement layers

| Layer        | Planned owner                                      | Required behavior; not implemented by Task 1                                                                                                                      |
| ------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A            | `src/helpers/privacy/egressGate.js`; Tasks 5/8–11a | Validate effective captured destination, refuse before transport, record blocked metadata and track actual attempt/body lifetime.                                 |
| B: Node      | `src/helpers/privacy/egressBackstop.js`; Task 6    | TCP/TLS, all DNS, UDP, SDK underlays and HTTP proxy forwarding, installed before captured aliases. Pin accepted localhost forms; never trust DNS for locality.    |
| B: Chromium  | Tasks 6/7a                                         | Every session (including updater), original URL and redirects. Retain evidence to onCompleted/onError. No reset-all shortcut that cuts unrelated loopback work.   |
| Renderer     | Tasks 7a/13                                        | Main retains IPC authority; all-frame WebRTC prevention, inert remote images, CSP and speculation restrictions need Task 16 executed acceptance.                  |
| Spawn guard  | Tasks 6a/7                                         | Refuse all native starts sealed until 07b proof; classify unsealed launches and retain tree facts. Exact FFmpeg file,pipe whitelist is additional hardening only. |
| OS boundary  | **07b unavailable on every platform**              | No success interface in 07a. Independent effective controls, tree lifetime and inherited/service capability closure remain required.                              |
| Main dialogs | Tasks 7/11/15                                      | Main owns unseal, recorder actions and external handoff confirmation; safe defaults.                                                                              |

## Per-path inventory

Anchors are current Task 1 observations. Unless otherwise prefixed, code filenames below are under `src/helpers/`. **Sealed** and **Layer** describe planned decisions, not present guards. Exact decision/layer vocabulary is retained for downstream consumers; no native row uses `local only: contained` or `n/a: no network` in 07a. For configurable HTTP/SDK paths, `blocked` means nonloopback refused; an explicitly configured loopback transport can be eligible under captured recipient authority, subject to ancillary native refusals. It never means built-in engines can start sealed. Native rows refuse regardless of bind address.

| Id  | Path                                                                 | Current code anchors                                                                                                                                                                                                                                                                           | Transport                                                 | Sealed                     | Layer         | Ledger task / proof owner                                                                  |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------- | ------------- | ------------------------------------------------------------------------------------------ |
| N1  | Text/vision/search/cleanup/notes/translation                         | `personalInference.js:224,239,516,647`; `enterpriseAiProviders.js:28,86`                                                                                                                                                                                                                       | AI SDK / injected Node fetch                              | blocked                    | A+B           | scope → SCOPE_TO_TASK; Tasks 8/12                                                          |
| N2  | Enterprise SDK/auth and legacy handlers                              | `enterpriseAiProviders.js:94,106,112,125,137,346`; `ipcHandlers.js:514,4425,4497,4626,4711,4747`                                                                                                                                                                                               | SDK HTTP/auth/ADC and credential processes                | blocked                    | A+B           | scope or providerCheck; Tasks 8/11a/12; spawn refusal too                                  |
| N3  | Explicit model discovery                                             | `personalInference.js:441,467`                                                                                                                                                                                                                                                                 | injected fetchModels; describe only issues recipient      | blocked                    | A+B           | providerCheck; Tasks 8/12; no automatic calls                                              |
| N4  | Provider Verify/self-hosted probe                                    | `keyring.js:403,603`; `providerConnectionTest.js:289,308`; `selfHostedProbe.js:5,21`; `ipcHandlers.js:428,1354`                                                                                                                                                                                | injected fetch / Electron / SDK                           | blocked                    | A+B           | providerCheck; Tasks 8/11a/12; retain recipient/frozen environment                         |
| N5  | Batch BYOK/self-hosted STT                                           | `ipcHandlers.js:249,256,8360`                                                                                                                                                                                                                                                                  | Electron session/net multipart                            | blocked                    | A+B           | dictationStt or uploadStt from captured admission; Tasks 9/12                              |
| N6  | Gemini/Corti/Tinfoil STT/auth                                        | `geminiTranscription.js:69,70`; `cortiAuth.js:28,44,48`; `cortiTranscription.js:7`; `tinfoilTranscription.js:48`; `tinfoilSecureClient.js:27,29`                                                                                                                                               | Electron/injected fetch / SDK attestation                 | blocked                    | A+B           | inherited task/provider/correlation; Tasks 9/12                                            |
| N7  | Retry transcription                                                  | `ipcHandlers.js:5573,5589,5628,5776`                                                                                                                                                                                                                                                           | Electron proxyFetch                                       | blocked                    | A+B           | dictationStt; Tasks 9/12                                                                   |
| N8  | Legacy xAI/Mistral/Anthropic proxies                                 | `ipcHandlers.js:4136,4172,4981`                                                                                                                                                                                                                                                                | Electron net                                              | blocked                    | A+B           | dictationStt / dictationCleanup; Tasks 8/9/12                                              |
| N9  | Realtime dictation/meetings/warm reuse/reconnect/flush               | `dictationStreamingOperations.js:39,242,360,489,530`; `streamingHandOff.js:57,64,82`; `assemblyAiStreaming.js:202,444`; `deepgramStreaming.js:338,729`; `cortiStreaming.js:129,233`; `geminiLiveStreaming.js:209`; `openaiRealtimeStreaming.js:182`; `ipcHandlers.js:6243,6369,6551,7972,8109` | ws / Tinfoil factory                                      | blocked                    | A+B           | dictationStt / noteRecordingStt; Tasks 9a/12/13; connection distinct from recording handle |
| N10 | Realtime token/auth                                                  | `realtimeTokenProviders.js:14,17,42`; `ipcHandlers.js:6449`; Corti N6                                                                                                                                                                                                                          | injected proxyFetch / Electron                            | blocked                    | A+B           | inherited; Tasks 9a/12; token metadata is not disclosure                                   |
| N11 | Tinfoil catalog/attestation                                          | `tinfoilCatalog.js:41,43,64`; `tinfoilSecureClient.js:9,27`                                                                                                                                                                                                                                    | Tinfoil SDK                                               | blocked                    | A+B           | providerCheck; Tasks 8/12                                                                  |
| N12 | Model manifests/downloads                                            | `downloadUtils.js:122,250,267`; callers `whisper.js:638`, `parakeet.js:381,495`, `localEmbeddings.js:85`, `diarization.js`, `modelManagerBridge.js:6`                                                                                                                                          | Electron request/fetch, redirects                         | blocked                    | A+B           | modelDownload; Tasks 10/12; extraction separately refused                                  |
| N13 | Runtime/GPU binaries                                                 | `gpuBinaryManager.js:110,184`; `llamaCppInstaller.js`                                                                                                                                                                                                                                          | shared downloads/manifests                                | blocked                    | A+B           | runtimeDownload; Tasks 10/12                                                               |
| N14 | Direct/proxy/YouTube URL import                                      | `urlAudioDownloader.js:3,629,1016,1190,1525`                                                                                                                                                                                                                                                   | aliased mod.request, DNS, Electron net, yt-dlp            | blocked                    | A+spawn guard | urlImport; Tasks 10/12; B also required; retain SSRF checks                                |
| N15 | yt-dlp self-update                                                   | `urlAudioDownloader.js:390,426`                                                                                                                                                                                                                                                                | native child                                              | blocked                    | spawn guard   | runtimeDownload opaque session; Tasks 6a/10/12                                             |
| N16 | Update check/download/install                                        | `updateManager.js:15,152,168`; `updateIPC.js:96`; `main.js:505`                                                                                                                                                                                                                                | updater private session + native restart/install          | blocked                    | A+B           | appUpdate; Tasks 10/12/16; spawn refusal before install/restart                            |
| N17 | Codex verification/discovery/version probes                          | `codexCli.js:99,115,197,198,238,255,315,327`; `codexAppServer.js:176,178`                                                                                                                                                                                                                      | injected fetch + native runFile                           | blocked                    | A+B           | codex; Tasks 8/12; refuse native probe too                                                 |
| N18 | Codex status/login/logout/models/model-catalog/rate-limits/inference | `codexAppServer.js:214`; `personalInference.js:374,378,391,392,393,394,591`; `main.js:503`                                                                                                                                                                                                     | opaque native app-server + OS login callback              | blocked                    | A+spawn guard | codex, opaque process lifetime; Tasks 8/11/12; browser confirmation separate               |
| N19 | Google/Microsoft OAuth/API/pending consent                           | `googleCalendarOAuth.js:153`; `googleCalendarManager.js:357`; `microsoftCalendarOAuth.js:155,168`; `microsoftCalendarManager.js:400`; `oauthLoopbackFlow.js:33,104,106`                                                                                                                        | Electron net + listener + OS browser                      | blocked                    | A+B           | calendar; Tasks 11/12; abort exchange/close flows                                          |
| N20 | Calendar background/focus/wake                                       | `main.js:596,818,827`; `calendarSyncInterval.js`                                                                                                                                                                                                                                               | callbacks into N19; Apple native helper                   | blocked                    | A+B           | calendar; Tasks 11/12; Apple not exempt                                                    |
| N21 | Browser/mail/meeting/OAuth/help/settings/file-manager handoffs       | `externalUrlOpener.js:35,48,69`; `main.js:503`; `ipcHandlers.js:1627,3944,5278,8748,8849,9366,9383`; `windowManager.js:1464,1505,1512,1519`; `meetingDetectionEngine.js:444`; `meetingJoinUrl.js`; `menuManager.js:108`; `oauthLoopbackFlow.js:106`; renderer externalLinks/UpdateSettings     | OS apps; renderer IPC/injected callbacks delegate to main | allowed after confirmation | main dialog   | none; Task 11 externalLinkSealed tests; Windows explorer native refusal still applies      |
| N22 | Loopback sidecar/client/listener/dev transport                       | `llamaServer.js:572,657,770`; `whisperServer.js:454,462,806,954`; `qdrantManager.js:210`; `vectorIndex.js:15`; `parakeetWsServer.js:328,472`; `cliBridge.js:169,184`; `devServerManager.js:23,27`; `oauthLoopbackFlow.js:1`; `src/utils/serverUtils.js:2`                                      | Node HTTP/ws, Qdrant SDK, loopback callbacks/probes       | allowed: loopback          | B             | none for loopback; connectRemote must be gated if nonloopback; native launch unavailable   |
| N23 | ONNX utility worker                                                  | `onnxWorkerClient.js:59`; `src/workers/onnxWorker.js:62`                                                                                                                                                                                                                                       | utilityProcess + native addon                             | blocked                    | spawn guard   | none; Tasks 6a/7/13/18; no networkFree inference from JS imports                           |
| N24 | Four FFmpeg starts incl private pipe decoder                         | `ffmpegUtils.js:132,404,473,616`                                                                                                                                                                                                                                                               | native conversions                                        | blocked                    | spawn guard   | none; Task 6a ffmpegContainment tests; exact file,pipe restriction is not isolation        |
| N25 | Chromium docs/images/navigation/speculation/WebRTC                   | `windowManager.js:220,660,1488,2203,2258,2480,2531`; `src/index.html:5,7,12`; `src/assets/fonts/noto-sans.css:10`; `src/components/ui/MarkdownRenderer.tsx`; resource consumers below                                                                                                          | Chromium resources, no direct provider transport          | blocked                    | B: Chromium   | none or unattributed; Task 16 Electron proof; Tasks 7a/13 wiring                           |
| N26 | Native helpers/probes/service activation/relaunch/legacy trees       | spawn census below; `main.js:9,610`; `ipcHandlers.js:3401,3408`; `ensureYdotool.js:117,124`; `processListCache.js:30`                                                                                                                                                                          | native processes, desktop IPC/delegated services          | blocked                    | spawn guard   | none; Tasks 6a/7/12/18; A23 unresolved evidence, never root-only stop                      |

Task 12's production-wiring matrix must cover every `blocked` row except Chromium-only N25, whose executed proof belongs to Task 16. N21 confirmation and N22 transport eligibility also need tests. No static pass replaces either matrix or independent platform evidence.

Legacy channels still exposed through preload must be gated and tested even without current UI callers: `process-anthropic-reasoning`, `process-enterprise-reasoning`, `enterprise-stream-start`, `bedrock-list-models`, `test-provider-connection`, `test-enterprise-connection` and `proxy-{xai,mistral,gemini,corti,tinfoil}-transcription`. The legacy `whisper.js:482` transcribeViaLan / `whisperServer.js:454` connectRemote pair has no current external caller found; retain its nonloopback gate/backstop obligation rather than assuming every sidecar file is loopback-only.

## Transport/resource census and interpretation

Both fences are conservative **capability/review lists**. Imports, actual calls, delegated wrappers and callback contracts are distinct. An import may only parse data; an IPC wrapper may never open a socket itself. Inclusion proves neither execution nor guard coverage. The scan parses JS/JSX/TS/TSX/CJS/MJS import/export/dynamic import and calls, plus HTML/CSS resources, in `main.js`, `preload.js` and all `src/`, excluding declaration files. Dependencies, tests, developer scripts and generated builds are outside the scan. New privacy modules are not silently exempted.

- Known transports include aliased Node imports, `fetchImpl`, `fetchModels`, `doFetch`, `proxyFetch`, `runTest`/`runEnterpriseTest`, download wrappers, ws and SDK imports. Module imports deliberately trigger review; function/interface declarations, comments and strings do not count as calls. There is no generic `.exec` regex: `RegExp.exec` is not a launch. Child-process imports cover exec/promisified/Sync aliases; known injected `runFile`, `runCommand`, `spawnImpl`, `execAsync` calls are checked too.
- `main.js` imports TLS only for CA setup. `textOperationCapture.js` imports Smithy to parse profiles, not send; consuming SDK auth/processes belong to N2. `ToolRegistry.ts` imports AI SDK schemas/types, not provider transport. `hotkeyManager.js`/`windowBroadcast.js` import BrowserWindow for window lookup, not creation. These conservative import hits remain explicit.
- `src/models/tinfoilModels.ts:90–95` binds fetchModels to `window.electronAPI.getTinfoilChatModels`. `src/services/ai/chatRequestBody.ts:137–161` is a generic injected retry contract with no current production caller found (not a direct transport); SelfHostedPanel's runTest and renderer external-link helpers also delegate via IPC. These known callback names are not direct renderer provider networking or renderer credential authority. `meetingJoinUrl.js:74` and `src/utils/externalLinks.ts:5` also have browser-preview `window.open` fallbacks; those are Chromium navigation/new-window handoffs, subject to N25 and main window handlers in Electron, not provider fetch. `src/preview/browserPreview.ts:361` also opens HTTPS links in browser-only development mode; `src/main.jsx:3` excludes that adapter from production and keeps Electron preload authority. It stays inventoried because the scan includes all source.
- N9 includes actual `streamingHandOff.js` frame sends, adapter buffers/reconnect and meeting/replacement streams. `codexAppServer.js` is opaque native egress even without a network import. `calendarSyncInterval.js` triggers manager callbacks. Worker native code is unknown capability, never proven network-free.
- N25 includes implicit Markdown images, `ModelCardList.tsx:154` model.icon, `ProviderIcon.tsx:27`, `MeetingNotificationCard.tsx:71`, `LoquiBrand.tsx:30,36,44`, `IntegrationsView.tsx:43` (under `src/components/`, UI files under `ui/`), bundled font URLs and CSS imports. Bundled relative assets are local; dynamic nonlocal values/future URLs still need session enforcement. Chromium processes are separate from application native helpers.
- Fresh supplemental sites: `vectorIndex.js` uses strict-loopback Qdrant SDK; `processListCache.js:30` imports ps-list for native enumeration; freedesktop notifications, GNOME portals/shortcuts, KDE and Hyprland import D-Bus session clients. D-Bus opens local IPC and may activate host services: not a proven remote request or tracked child tree. Planned admission must deny unaudited delegated service capabilities sealed; a TCP-only backstop cannot prove closure.
- `src/helpers/privacy/egressPolicy.js` imports `node:net` only for pure address syntax classification (`isIP`); it performs no DNS lookup or socket operation. The conservative egress fence records this import for review, not as an observed transport.

- `src/helpers/privacy/egressGate.js` is Layer A's metered fetch factory (default Node fetch or an injected transport). It checks the actual attempt target before dispatch and records body completion/error/cancel metadata per attempt. It attributes Node work only through async ticket/attempt context and Chromium work only through the opaque tag; there is no host-wide lookup. Task 6 must strip tags and retain its actual transport evidence through close/completion even after a ticket settles. Its diagnostic hooks provide no native-isolation or seal attestation.

- `src/helpers/privacy/egressBackstop.js` owns JavaScript socket/TLS/HTTP/fetch, DNS, UDP and Chromium session defenses. Localhost names are pinned to numeric loopback in Node; Chromium uses its localhost handling. It retains transport diagnostics until observed close/completion/error, including requests orphaned by destroyed webContents. Environment-proxy use remains an unresolved diagnostic hazard. These hooks do not establish native isolation or a verified seal.

```egress-sites
main.js
src/assets/fonts/noto-sans.css
src/components/IntegrationsView.tsx
src/components/LoquiBrand.tsx
src/components/MeetingNotificationCard.tsx
src/components/SelfHostedPanel.tsx
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

| Source (under `src/helpers/` unless prefixed)                                                                                                            | Current launch/capability                                                                           | Classification / inventory                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `codexAppServer.js:178,214`, `codexCli.js:115`                                                                                                           | injected runFile version/lookup probes; Codex app-server                                            | network/opaque, N17/N18                                                                               |
| `urlAudioDownloader.js:426,601,629`                                                                                                                      | yt-dlp self-update/download, Windows taskkill, detached/group handling                              | network/opaque N14/N15; control tool N26                                                              |
| `ffmpegUtils.js:132,404,473,616`                                                                                                                         | four FFmpeg conversions incl private pipe decoder                                                   | native N24; file,pipe defense only                                                                    |
| `externalUrlOpener.js:48,69`                                                                                                                             | Windows explorer spawn; shell.openExternal on other platforms                                       | OS browser/mail N21; confirmation cannot waive native refusal                                         |
| `llamaServer.js:430`, `whisperServer.js:634`, `qdrantManager.js:128`, `parakeetWsServer.js:160`                                                          | llama/Whisper/Qdrant/sherpa WS servers                                                              | native sidecars N22; loopback clients/bind flags do not isolate                                       |
| `diarization.js:342`, `meetingAecManager.js:79`                                                                                                          | sherpa diarization CLI, meeting AEC helper                                                          | native N26                                                                                            |
| `audioTapManager.js:133,275`, `audioActivityDetector.js:306,620,943,972,979`                                                                             | macOS audio helper/listeners; pactl via execAsync                                                   | native capture/probes N26                                                                             |
| `linuxPortalAudioManager.js:112,294`, `windowsLoopbackAudioManager.js:142,312`, `systemDefaultMicrophone.js:96,98`                                       | portal/PipeWire/Windows capture/probes; mic query                                                   | native + host-service capabilities N26                                                                |
| `clipboard.js`, `selectionManager.js:44,46,63,475`, `textEditMonitor.js:145,172,215`                                                                     | xclip/xsel/wl-copy/paste, xdotool/ydotool, osascript, platform paste/text helpers, desktop IPC/open | native + delegated capabilities N26; not network-free                                                 |
| `globeKeyManager.js:137,240`, `linuxKeyManager.js:53`, `windowsKeyManager.js:58`, `linuxWindowInputRegion.js:45`                                         | platform key/window input helpers/probes                                                            | native N26                                                                                            |
| `hyprlandShortcut.js:107,154,231`, `gnomeShortcut.js:185,348`                                                                                            | hyprctl/gsettings Sync commands and D-Bus                                                           | native + service IPC N26                                                                              |
| `ensureYdotool.js:13,21,29,37,80,117,124`                                                                                                                | which/groups/pgrep/systemctl, including start of ydotoold/ydotool                                   | native + systemd activation N26; external service tree is not owned by spawned root                   |
| `mediaPlayer.js:23,27,298,314,335`                                                                                                                       | playerctl/platform media helpers/Perl                                                               | native + host media-service IPC N26                                                                   |
| `appleCalendarManager.js:145`                                                                                                                            | EventKit helper                                                                                     | native N20/N26; Apple is not exempt                                                                   |
| `downloadUtils.js:482,511`, `systemTar.js:39,61`, `llamaCppInstaller.js:84`                                                                              | unzip/PowerShell extraction, injected spawnImpl tar, which/where                                    | native N26; downloaded-file extraction is not containment                                             |
| `src/utils/gpuDetection.js:27`                                                                                                                           | nvidia-smi via injected run/default execFile                                                        | native probe N26                                                                                      |
| `src/utils/process.js:15,88,102`                                                                                                                         | shared runCommand/spawn, optional shell, Windows taskkill                                           | classify each caller; all sealed native starts refused                                                |
| `sidecarReaper.js:32,39`, `processListCache.js:30`                                                                                                       | ps/tasklist, ps-list dependency process enumeration                                                 | native inspection N26; no whole-tree proof; preserve A23 records                                      |
| `onnxWorkerClient.js:59`, `src/workers/onnxWorker.js:62`                                                                                                 | current utilityProcess.fork; worker loads onnxruntime-node                                          | native N23; future launcher/IPC migration is 07b, not implemented                                     |
| `main.js:9–16`, `ipcHandlers.js:3401,3408`                                                                                                               | early XWayland self spawn, relaunch waiter and Electron app.relaunch                                | native self-launch N26; admission before scheduling, no self exemption                                |
| `updateManager.js:15`, `updateIPC.js:96`                                                                                                                 | updater quitAndInstall and wrapper invocation                                                       | native install/restart N16/N26; not caught by child_process imports alone                             |
| `freedesktopNotifications.js:7`, `gnomeGlobalShortcutsPortal.js:20`, `kdeShortcut.js:8`, `gnomeShortcut.js:118`, `hyprlandShortcut.js:188`               | D-Bus session/notification/portal/shortcut interfaces                                               | delegated host-service IPC/possible activation N26; not direct child launch proof                     |
| `main.js:503`, `ipcHandlers.js:1627,5278,8748,8849,9366,9383`, `windowManager.js`, `menuManager.js`, `meetingDetectionEngine.js`, `oauthLoopbackFlow.js` | raw and wrapped browser/settings/file-manager handoffs                                              | outside-app N21; path/scheme validation and planned main confirmation                                 |
| `meetingJoinUrl.js`, `src/utils/externalLinks.ts`, `src/components/settings/UpdateSettings.tsx`, `src/preview/browserPreview.ts:361`                     | injected/IPC external opener callbacks                                                              | delegate to main N21; browser-only DEV preview uses window.open, not direct provider transport        |
| `windowManager.js:220,1488,2203,2480`                                                                                                                    | BrowserWindow constructors; Chromium-managed runtimes                                               | N25 renderer/session enforcement; not a verified native model boundary                                |
| `autoStart.js:21`, `linuxAutostart.js:179`, `main.js:277`                                                                                                | OS login-item registration and XDG autostart entry write/repair                                     | delegated future self-launch N26, not immediate execution; next-start sealed admission still required |
| `hotkeyManager.js`, `windowBroadcast.js`                                                                                                                 | BrowserWindow imports for window lookup only                                                        | conservative import entries, no launch observed                                                       |

```spawn-sites
main.js
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
liveness and known-descendant snapshots are partial observations, never full-tree
containment or acknowledged whole-tree stop. Unknown descendants remain named
`DESCENDANTS_UNVERIFIED` after root/group exit. Local engines receive no stop
exemption. Native inspection itself is refused sealed, without a ps/tasklist
escape. No successful pause, native availability or completed seal is supplied.

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
remote. The task is the request's disclosure task, else its scope's task, and
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
whole-exchange `guardMetered` helper.

Codex status, login, logout, models, model catalog and rate limits refuse while
sealed before the app-server could start; cancel-login stays usable. With no
app-server running or starting (for example, after the seal stopped it), the
sign-in ended with that process, so cancel-login resolves `appServerStopped`
without a probe, spawn or row, and Settings clears its waiting state without a
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
