#!/usr/bin/env node
/**
 * Sealed-mode acceptance run (Plan 07, Task 16), 07a edition.
 *
 * Launches the real app in Electron twice against two logging fixture servers
 * and attacks it with every transport it ships: Electron `net`, Node `http`,
 * `ws`, a renderer page (image and fetch), a redirect out of loopback and
 * electron-updater. Run 1 is the unsealed control, then a toggle to sealed;
 * run 2 boots sealed. The same file is the launcher (run with Node) and the
 * Electron bootstrap, like scripts/smoke-electron.cjs. Unlike the smoke, it
 * installs NO network blockers: the app's backstop and gate are the only things
 * between the probes and the fixture.
 *
 * WHAT A RESULT MEANS IN 07a (A19, binding)
 * - The remote fixture (scripts/lib/egressFixture.cjs) is the independent
 *   observer of JS/Chromium-layer denial. Loqui's own recorder is not consulted.
 * - That evidence is kept apart from the native boundary. 07a has no native
 *   boundary on any platform (07b is absent): the report's `nativeBoundary` is
 *   always "NOT VERIFIED" (D16 on macOS, D14/D15 on Linux), and main must keep
 *   `nothingLeaves` false and `effectiveSince` null. Any other attestation is a
 *   FAIL. The best possible outcome is status "NOT VERIFIED" (exit 3), an
 *   explicit merge blocker. This script never reports a pass and never exits 0
 *   after a run.
 * - Child probes run only while unsealed; nothing native is launched sealed.
 *
 * STATUS AND EXIT CODES (no outcome exits 0)
 *   not-run       exit 2  a prerequisite or launch-safety check failed; nothing launched.
 *   FAIL          exit 1  an observer check failed or a renderer finding was recorded.
 *   INCOMPLETE    exit 4  the run crashed, timed out or stopped before every mandatory
 *                         observer check ran (report.error / observerChecksComplete false).
 *   NOT VERIFIED  exit 3  every mandatory observer check ran and held; native boundary
 *                         absent. The best 07a outcome, still a merge blocker.
 *   report.observerChecksComplete is the single CI field for "every mandatory
 *   observer check ran" (the conditional T10 update-tag check is not mandatory).
 *
 * LAUNCH SAFETY (refused with "NOT RUN" unless all of these hold)
 *   - The explicit opt-in flag --i-understand-this-launches-electron.
 *   - Not root: Chromium must keep its sandbox, and this script never disables it
 *     (Playwright's chromiumSandbox is set to true).
 *   - Linux: an isolated display. Refused when WAYLAND_DISPLAY or
 *     HYPRLAND_INSTANCE_SIGNATURE is set, or when DISPLAY has no xvfb-run marker
 *     (xvfb-run points XAUTHORITY into its own xvfb-run.* directory). The app has
 *     no supported switch to stop its global-hotkey registration, which on a
 *     live Hyprland/GNOME/KDE session binds keys in the live compositor and
 *     rewrites compositor config. So it runs only on an isolated Xvfb display,
 *     with the session variables stripped from its environment.
 *   - Other platforms (no Xvfb): --dedicated-desktop-user, acknowledging a
 *     dedicated, disposable OS user account whose desktop may be used.
 *   - --allow-session-bus forwards DBUS_SESSION_BUS_ADDRESS (meant for a private
 *     `dbus-run-session` bus); the user's own /run/user/<uid>/bus is refused.
 *     Without it the app gets DBUS_SESSION_BUS_ADDRESS=disabled:.
 *   - Linux: no network outside loopback. The launcher reads its own network
 *     namespace (which Electron inherits) from /proc/self/net: route, ipv6_route,
 *     dev, if_inet6 and fib_trie. Any route through, or any device other than,
 *     lo is refused ("network-route-present" / "network-interface-present")
 *     unless --allow-network-route is given; the opt-in is recorded. A device
 *     with no route and no address (down or unconfigured, such as the kernel's
 *     fallback tunnels sit0/tunl0/ip6tnl0 in a fresh namespace) is listed in
 *     network.ignoredDevices instead; any non-loopback IPv4 address or an
 *     unreadable address table counts every device. The result is in
 *     report.launchEnvironment.network: "loopback-only", "non-loopback-route",
 *     "non-loopback-interface", or "not-checked" where the route or device
 *     tables cannot be read (and on macOS/Windows, which have no /proc). It is a
 *     snapshot at launch, not packet evidence.
 *   - The output directory must be short enough for Chromium's single-instance
 *     socket, $TMPDIR/.org.chromium.Chromium.XXXXXX/SingletonSocket with TMPDIR
 *     at DIR/<run>-XXXXXX/tmp. Over the platform's sun_path (Linux 108 bytes,
 *     macOS 104, each including the terminator) the app could not take its
 *     single-instance lock and would quit, so it is refused up front
 *     ("socket-path-too-long"); report.launchEnvironment.singletonSocket keeps
 *     the computed length and the limit. On macOS the default (os.tmpdir(),
 *     under /var/folders/…) is always too deep: pass a short directory such as
 *     --output-dir /tmp/lqa. Whether Chromium's macOS temporary directory
 *     follows TMPDIR is unconfirmed: check the socket's location on the first
 *     macOS run.
 *
 * OS KEYCHAIN (intercepted so that no operator keyring is touched; a real run
 * must confirm it from the recorded evidence)
 *   The app's master-key store (src/helpers/secretCrypto.js) uses
 *   @napi-rs/keyring. With the session bus disabled it would silently fall back
 *   to the kernel keyring (keyutils) of the invoking user and write a master key
 *   there under the dev build's own service name. The bootstrap therefore
 *   intercepts Module._load before it requires electron or main.js, and every
 *   request for @napi-rs/keyring (or its native binding packages) gets an
 *   in-memory, process-local stand-in with the same Entry/AsyncEntry surface,
 *   so the real module is not loaded; keys live and die with the app process
 *   (plus secretCrypto's own backup file inside the temporary profile, if
 *   Safe Storage is available there). No product code changes: the app has no
 *   supported keychain switch. report.launch.osKeychain (after the panel
 *   loads) and report.launch.osKeychainAtClose (before the app closes) record,
 *   as read from the app: stubActive (the stub is still the module loader),
 *   realKeyringLoaded (a real keyring module or binding is in require.cache)
 *   and store, which is "in-memory" only when the first is true and the second
 *   false.
 *
 * THE APP'S ENVIRONMENT (allowlisted; nothing else is inherited)
 *   PATH, LANG, LANGUAGE, LC_*, TZ, DISPLAY and XAUTHORITY are copied. HOME,
 *   XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CACHE_HOME, XDG_STATE_HOME,
 *   XDG_RUNTIME_DIR (0700) and TMPDIR point into the per-launch temporary
 *   sandbox that also holds LOQUI_PROFILE_DIR. No provider keys, tokens,
 *   NODE_OPTIONS, ELECTRON_*, Wayland/Hyprland/desktop-session variables or
 *   the user's session bus reach the app.
 *   HOME: the repository rule "never repurpose HOME in tests" governs the test
 *   runner and this launcher, whose HOME is never touched. The temporary HOME
 *   exists only in the environment of the CHILD app under acceptance, so that
 *   nothing it writes can land in the operator's real home or config.
 *
 * MANUAL RUN PROCEDURE (root/owner; not runnable in the 07a agent sandbox)
 *   Prerequisites the launcher checks up front (else "NOT RUN: <reason>"):
 *   - node_modules/electron/dist exists (the electron postinstall ran; this
 *     script never requires the electron package from Node, because its
 *     index.js downloads a missing binary).
 *   - better-sqlite3 loads under Electron: `npm run native:electron` is
 *     required before the run (an ABI-mismatched NODE_MODULE build is refused).
 *   - A built renderer (`npm run build`), Playwright, and on Linux an xvfb-run
 *     X display (the app is started with --ozone-platform=x11).
 *   Steps on Linux, as the invoking (non-root) user. bwrap gives a new user and
 *   network namespace that keeps the invoking uid (so Chromium is not root and
 *   keeps its sandbox) and brings up only loopback; xvfb-run inside it gives an
 *   isolated display. UNTESTED HERE: confirm on the first run.
 *     npm run native:electron
 *     npm run build
 *     env -u WAYLAND_DISPLAY -u HYPRLAND_INSTANCE_SIGNATURE -u DBUS_SESSION_BUS_ADDRESS \
 *       bwrap --dev-bind / / --unshare-user --unshare-net --die-with-parent -- \
 *       xvfb-run -a node scripts/sealed-acceptance.cjs \
 *         --i-understand-this-launches-electron --output-dir /tmp/loqui-sealed-accept
 *     npm run native:node            # restore the Node build for npm test
 *   Without bwrap (util-linux >= 2.38), map root only long enough to bring lo
 *   up, then drop back to the invoking uid in a nested user namespace:
 *     U=$(id -u) G=$(id -g); env -u WAYLAND_DISPLAY -u HYPRLAND_INSTANCE_SIGNATURE \
 *       -u DBUS_SESSION_BUS_ADDRESS unshare --user --map-root-user --net sh -c \
 *       "ip link set lo up && exec unshare --user --map-user=$U --map-group=$G -- \
 *        xvfb-run -a node scripts/sealed-acceptance.cjs \
 *        --i-understand-this-launches-electron --output-dir /tmp/loqui-sealed-accept"
 *   Never run it as root and never turn Chromium's sandbox off.
 *   - Each launch gets a fresh temporary profile (LOQUI_PROFILE_DIR), HOME, XDG
 *     dirs and cache under the output directory. Never a personal profile.
 *   - Both fixtures listen only on an ephemeral port of the exact numeric
 *     loopback 127.0.0.1. The remote fixture is reached only through names
 *     under *.loqui-fixture.test, mapped to it by Chromium's
 *     --host-resolver-rules and by a `lookup` on Node sockets; every other name
 *     is NOTFOUND to Chromium, while 127.0.0.1, ::1 and localhost are excluded
 *     from the rules so loopback keeps working. Node DNS for other names is not
 *     redirected: the loopback-only namespace above is what keeps the unsealed
 *     control's own traffic on the host.
 *   - Artifacts: DIR/report.json, DIR/netlog-<run>.json (Chromium netlog for
 *     the Task 18 security review, not an assertion source), and the sandboxes.
 *
 * STILL PENDING after a run (also listed in every report's `pendingManual`):
 *   Step 5 in-app leak drill, Step 5a native boundary (07b), the Task 7a desktop
 *   smoke, a packet-level capture, and the checklist items earlier reviews
 *   handed to Task 16: T7a frame timing, T7a-M2/T11-M7 window.open and
 *   will-navigate, T11a Chromium URL parsing, T9a-C5 Tinfoil socket wire bytes,
 *   T10 Chromium redirects and the updater's egress tag.
 *
 * Usage: node scripts/sealed-acceptance.cjs --i-understand-this-launches-electron
 *          [--output-dir DIR] [--allow-session-bus] [--allow-network-route]
 *          [--dedicated-desktop-user]
 */
/* global window, document -- only inside Playwright page.evaluate callbacks */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const repoRoot = path.resolve(__dirname, "..");

const REPORT_SCHEMA = "loqui-sealed-acceptance/07a";
// Must equal privacyBoot's UNAVAILABLE failure; the test cross-checks it.
const NATIVE_BOUNDARY_UNAVAILABLE = "NATIVE_BOUNDARY_UNAVAILABLE";
const FIXTURE_DOMAIN = "loqui-fixture.test";
// Every remote kind the control run must deliver to the fixture, or the sealed
// result for it proves nothing. Preconnect and dns-prefetch hints are not
// required to fire unsealed (Chromium may skip them); sealed, the connection
// count covers them.
const EXPECTED_REMOTE = [
  "net-fetch",
  "net-request",
  "node-http",
  "ws",
  "after-redirect",
  "img",
  "renderer-fetch",
  "updates",
];
// Probes that must be refused while sealed. Loopback must keep working, and the
// renderer page's own load is from data: (its requests are judged by the fixture).
const REMOTE_PROBES = ["netFetch", "netRequest", "nodeHttp", "ws", "redirect", "updater"];
const PROBE_TIMEOUT_MS = 8000;
// Every Playwright evaluate is bounded; Playwright has no default for it.
const EVALUATE_TIMEOUT_MS = 10000;
const EXIT = Object.freeze({ FAIL: 1, NOT_RUN: 2, NOT_VERIFIED: 3, INCOMPLETE: 4 });
const STATUSES = ["RUNNING", "not-run", "FAIL", "INCOMPLETE", "NOT VERIFIED"];
const LAUNCH_OPT_IN = "--i-understand-this-launches-electron";
const DEDICATED_DESKTOP_ACK = "--dedicated-desktop-user";
const SESSION_BUS_OPT_IN = "--allow-session-bus";
const NETWORK_ROUTE_OPT_IN = "--allow-network-route";
// The two launches; their names prefix each per-launch sandbox directory.
const LAUNCH_NAMES = ["open", "sealed"];
// Unix-socket path capacity (sun_path, including the terminating NUL). Chromium's
// single-instance socket lives at $TMPDIR/.org.chromium.Chromium.XXXXXX/SingletonSocket.
const SUN_PATH_BYTES = { linux: 108, darwin: 104 };
const SINGLETON_SOCKET_TAIL = [".org.chromium.Chromium.XXXXXX", "SingletonSocket"];
// Variables that mean the launcher is sitting in the live desktop session.
const LIVE_SESSION_MARKERS = ["WAYLAND_DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE"];
// The only variables copied from the launcher into the app under test.
const CHILD_ENV_PASSTHROUGH = ["PATH", "LANG", "LANGUAGE", "TZ", "DISPLAY", "XAUTHORITY"];
// Chromium maps the fixture names to the fixture and every other name to
// NOTFOUND. Exclusions win over every MAP rule in Chromium's HostMappingRules,
// so numeric loopback (and localhost) is never remapped or failed. ::1 is listed
// bare and bracketed because the host string Chromium matches may be either.
const HOST_RESOLVER_RULES = [
  `MAP *.${FIXTURE_DOMAIN} 127.0.0.1`,
  "MAP * ~NOTFOUND",
  "EXCLUDE localhost",
  "EXCLUDE 127.0.0.1",
  "EXCLUDE ::1",
  "EXCLUDE [::1]",
].join(", ");
const SCOPE =
  "07a acceptance: an independent loopback fixture observes JS/Chromium-layer denial. " +
  "It says nothing about native children; the native boundary is absent in 07a.";
const OBSERVER_SCOPE =
  "Independent fixture observer: requests and bare connections seen by the remote fixture. " +
  "JS/Chromium-layer evidence only; not native isolation evidence.";
const NATIVE_REASON =
  "07a has no native boundary on any platform (07b absent). Main must keep nothingLeaves " +
  "false and effectiveSince null; fixture evidence cannot change that.";
// Loopback edge cases for the renderer parity spot check (T11a): Chromium's URL
// parser must turn each into the same host as Node's WHATWG parser.
const LOOPBACK_PARSE_CASES = [
  "http://127.0.0.1/",
  "http://127.1/",
  "http://0x7f000001/",
  "http://2130706433/",
  "http://0177.0.0.1/",
  "http://%31%32%37.0.0.1/",
  "http://[::1]/",
  "http://[::ffff:127.0.0.1]/",
  "http://[::ffff:7f00:1]/",
  "http://LOCALHOST./",
  "http://a.localhost/",
  "http://127.0.0.1.nip.io/",
  "http://127.0.0.1:99999/",
  "http://user@127.0.0.1@evil.test/",
];
const CHECKS = Object.freeze({
  controlStartsOpen: "control: the app starts unsealed",
  controlReached: "control: every remote probe reached the remote fixture while unsealed",
  controlLoopback: "control: loopback reached the local fixture while unsealed",
  controlUpdateTag:
    "control: the app's own update check reached the fixture without Loqui's egress tag",
  rendererFrames:
    "renderer: WebRTC is absent in the page and in about:blank and srcdoc frames; frames get no IPC bridge",
  rendererPopups:
    "renderer: same-origin window.open popups are denied or lack WebRTC and the bridge",
  rendererParsing: "renderer: Chromium and Node parse the loopback edge cases to the same host",
  childUnsealed: "child probe: the app is unsealed before the stubborn child starts",
  toggleNothingLeft: "toggle: the remote fixture saw no request and no connection after sealing",
  toggleChildExited: "toggle: the stubborn child started unsealed has exited after sealing",
  toggleAttestation:
    "toggle: main attests 07a honestly (sealing, no effective date, native boundary unavailable, no nothing-leaves claim)",
  toggleLoopback: "toggle: loopback still reached the local fixture",
  toggleRefused: "toggle: every remote probe was refused; none reached or hung",
  bootSetting: "boot: the app reports that the setting is on",
  bootNothingLeft:
    "boot: the remote fixture saw no request and no connection during the whole sealed run",
  bootLoopback: "boot: loopback reached the local fixture",
  bootAttestation:
    "boot: main attests 07a honestly (sealing, no effective date, native boundary unavailable, no nothing-leaves claim)",
  bootRefused: "boot: every remote probe was refused; none reached or hung",
  bootLedger: "boot: the refused attempts are in the flight recorder as blocked",
  noTagLeft: "all runs: no request reached a fixture carrying Loqui's internal egress tag",
});
// The T10 update-tag check runs only when the app's own update check reached
// the fixture ("not exercised" is recorded otherwise). Every other check must
// run for a completed run.
const OPTIONAL_CHECKS = Object.freeze([CHECKS.controlUpdateTag]);
const MANDATORY_CHECKS = Object.freeze(
  Object.values(CHECKS).filter((name) => !OPTIONAL_CHECKS.includes(name))
);

// Step 5a: the native-boundary gate. Pending in 07a on every platform.
const NATIVE_PENDING = [
  {
    id: "5a-1-D16",
    platform: "darwin",
    status: "NOT VERIFIED",
    item:
      "Kernel-enforced strict numeric loopback for TCP/UDP connect, bind and ingress, including " +
      "descendants, with whisper/llama/Qdrant/Parakeet working; host-LAN, IPv4-mapped, wildcard " +
      "listener and second-machine ingress controls; main validates before the launcher's " +
      "pre-exec acknowledgement. No paused acknowledgement on Darwin.",
  },
  {
    id: "5a-2-D14",
    platform: "linux",
    status: "NOT VERIFIED",
    item:
      "Exact packaged launcher: network namespace, private filesystem/Unix IPC, service bus, " +
      "sanitized environment, inherited descriptors, socket stdio, manager IPC and whole-tree " +
      "containment from process creation, including reparented and setsid descendants.",
  },
  {
    id: "5a-3-D15",
    platform: "linux",
    status: "NOT VERIFIED",
    item:
      "Where isolation is unavailable: each native helper refused before it starts, or stopped " +
      "only after confirmed whole-tree exit; live trees stay listed and keep the panel unverified.",
  },
  {
    id: "5a-4-report",
    platform: "all",
    status: "NOT VERIFIED",
    item:
      "On this build the native boundary is reported NOT VERIFIED even with every other guard up " +
      "and no native process running. A positive result needs the exact packaged adversarial run.",
  },
];
// Items earlier reviews handed to Task 16, plus Steps 4, 5 and 5a. Automated
// checks above cover parts of some; each stays listed until a person confirms
// it on a real run and records the evidence.
const MANUAL_CHECKLIST = [
  {
    id: "STEP-4",
    source: "Task 16 Step 4",
    check:
      "Run the procedure in this file's header (with --i-understand-this-launches-electron, as " +
      "a non-root user, on an isolated display) on macOS arm64 and Linux; keep report.json and " +
      "the netlogs. Expected: observerChecksComplete true, status NOT VERIFIED (exit 3). The " +
      "first real run must also confirm that controlLoopback holds (the host-resolver rules " +
      "exclude 127.0.0.1), that the app starts with Chromium's sandbox on and the session bus " +
      "disabled (if not, use dbus-run-session with --allow-session-bus), that only lo exists " +
      "in the namespace (launchEnvironment.network.state loopback-only, no " +
      "--allow-network-route; any down fallback tunnels appear only in " +
      "network.ignoredDevices), and that launch.osKeychain and launch.osKeychainAtClose " +
      "both show stubActive true and realKeyringLoaded false. On macOS pass a short " +
      "--output-dir (for example /tmp/lqa) and confirm where Chromium put its " +
      "single-instance socket.",
  },
  {
    id: "STEP-5",
    source: "Task 16 Step 5",
    check:
      "Leak drill in the app: comment out installNodeBackstop() in privacyBoot.bootEgressGuards, " +
      "rerun; the toggle nothing-left check must FAIL on node-http or ws before any attestation " +
      "wait. Restore the line. Record the failing output.",
  },
  {
    id: "STEP-5A",
    source: "Task 16 Step 5a",
    check: "Native boundary D14-D16: pending 07b; see nativeBoundary.pending. Stays NOT VERIFIED.",
  },
  {
    id: "T7a",
    source: "Task 7a review",
    check:
      "Real all-frame preload timing: in the top page, an about:blank iframe and a srcdoc iframe, " +
      "RTCPeerConnection is already absent when the first page script runs, and frames get no " +
      "electronAPI bridge. The run checks absence after load; timing needs DevTools or a probe page.",
  },
  {
    id: "T7a-M2",
    source: "Task 7a review M2",
    check:
      "Same-origin window.open('') popup from the main, pill and notification windows: every " +
      "window's navigation guard now denies window.open, so confirm no popup appears; if one " +
      "ever does, it must have no RTCPeerConnection (WebRTC) and no electronAPI bridge before " +
      "any opener script runs.",
  },
  {
    id: "T11-M7",
    source: "Task 11 review M7",
    check:
      "Main, pill and notification windows: window.open and will-navigate to a remote URL are " +
      "denied or routed through the guarded external opener; nothing loads in-app.",
  },
  {
    id: "T11a",
    source: "Task 11a review",
    check:
      "Renderer loopback parsing under Chromium's URL parser: the run compares hosts for the " +
      "edge cases; also confirm the renderer's isLoopbackUrl verdicts match main's for them.",
  },
  {
    id: "T9a-C5",
    source: "Task 9a review C5",
    check:
      "Tinfoil SDK socket wire bytes: with an owner-approved account only, a realtime Tinfoil " +
      "session's connection row shows measured bytes or null (never 0), and an attestation " +
      "fetch is metered separately. Not automated: it needs a real provider.",
  },
  {
    id: "T10",
    source: "Task 10 report",
    check:
      "Real Chromium redirects (the redirect probe) and electron-updater carrying the egress tag " +
      "through its own session, stripped before it leaves; the flight recorder row is " +
      "attributed to appUpdate.",
  },
  {
    id: "T7a-SMOKE",
    source: "Task 7a Step 4 (deferred to Task 16 by controller ruling)",
    check:
      "Desktop smoke on a temporary profile (LOQUI_PROFILE_DIR), with the control panel " +
      "sandboxed and web security on: Settings in every section; notes, chat and History " +
      "playback of a recording; file upload, drag-and-drop and image attachments; model " +
      "downloads. Model downloads use the fixture only: a download URL served by an owned " +
      "127.0.0.1 fixture, never a real model host. No personal profile, no real provider. " +
      "Anything that broke because it relied on a relaxed sandbox or web security is fixed at " +
      "its cause, never by relaxing the settings again.",
  },
  {
    id: "T18-02",
    source: "Task 18 security review T18-02",
    check:
      "Chromium's own fetches that bypass session.webRequest, during a sealed run with links and " +
      "a text field in use: in the net-export netlog and the packet capture, look for the " +
      "Hunspell dictionary host redirector.gvt1.com, PAC/WPAD lookups (the wpad name and " +
      "proxy-script fetches), and any socket that has no webRequest event (preconnect and DNS " +
      "hints). Sealing sets a direct proxy, disables the spellchecker and points the dictionary " +
      "URL at an unroutable loopback port; none of that has been observed in a real run yet. Any of these " +
      "while sealed is a finding (raise T18-02 to High).",
  },
  {
    id: "FWR-m1",
    source: "Fix-wave round 2, re-review m1 (spellcheck after a sealed quit)",
    check:
      "With spellcheck on, seal and confirm privacy-spellcheck.json (0600) appears beside " +
      "privacy.json and the spellchecker is off. Quit while sealed and restart: unsealed, the " +
      "spellchecker is on again and the marker is gone; sealed, it stays off until unsealing. " +
      "With spellcheck off before sealing, no marker is written and it stays off. Record whether " +
      "Electron persists setSpellCheckerEnabled in the profile's Preferences (NOT VERIFIED yet).",
  },
  {
    id: "T18R-04",
    source: "Task 18 re-review T18R-04 (permissions)",
    check:
      "Sealed and unsealed: navigator.geolocation.getCurrentPosition in the main window is " +
      "denied, and no Google location request appears in the netlog or the packet capture. " +
      "The microphone (dictation) and display-capture (meeting system audio) still work, and " +
      "copy and paste still work.",
  },
  {
    id: "O1-PASTE",
    source: "Fix-wave round 2 touch-up 3, O1 (sealed auto-paste)",
    check:
      "On Linux (X11, and a Wayland session: GNOME or KDE, and a wlroots compositor where " +
      "available) and on macOS, with auto-paste on: seal, then dictate into a text field. No paste " +
      "helper starts (no xdotool, wtype, ydotool, linux-fast-paste, osascript or macos-fast-paste " +
      "process; the flight recorder names the refused helper under programs not started). One card " +
      "appears and holds the words with Paste again; it is titled 'Sealed mode stopped automatic " +
      "paste' and says the text is on the clipboard (no 'Couldn't paste your words' card), and a " +
      "manual paste inserts the dictated text. Main logs no uncaught exception, and the next " +
      "dictation and a selection edit still finish (the paste queue is free). Unseal: auto-paste " +
      "works again at once, through the portal on GNOME (saved token) and KDE and through fast " +
      "paste on macOS, also after sealing during a paste. History keeps the text only when " +
      "retention is on. NOT runtime-checked yet.",
  },
  {
    id: "OBS-PACKET",
    source: "Task 16 review r1 M6 (handoff: no packet to a non-loopback address)",
    check:
      "Packet-level observer: the fixture sees only fixture names, so capture during both runs " +
      "as well (tcpdump -i any or an nftables log rule on every non-lo interface, plus DNS " +
      "queries) to cover app-originated traffic to real hostnames. Inside the loopback-only " +
      "namespace there is no such interface, so also record attempted connects (for example " +
      "strace -f -e trace=connect,sendto) that never become packets. Any packet or attempt to " +
      "a non-loopback address is a finding.",
  },
];

// --- Pure helpers (exported for tests) ----------------------------------------------------------

function bounded(operation, timeout, message) {
  let timer;
  return Promise.race([
    Promise.resolve(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeout);
    }),
  ]).finally(() => clearTimeout(timer));
}

function errorLabel(error) {
  const label = String(error?.code || error?.name || "error").slice(0, 60);
  return label === "reached" || label === "timeout" ? `error:${label}` : label;
}

// A probe's outcome: "reached", an error code, or "timeout". A hang is never a pass.
function settleWithin(promise, timeout = PROBE_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).then(() => "reached", errorLabel),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeout);
    }),
  ]).finally(() => clearTimeout(timer));
}

function matchesKind(hit, kind) {
  const target = String(hit?.path || "");
  const host = String(hit?.host || "").toLowerCase();
  return (
    target === `/${kind}` ||
    target.startsWith(`/${kind}-`) ||
    target.startsWith(`/${kind}?`) ||
    host.startsWith(`${kind}.`)
  );
}

function probeKinds(hits) {
  return EXPECTED_REMOTE.filter((kind) => hits.some((hit) => matchesKind(hit, kind)));
}

// The brief allows one exclusion: an updater that cannot be pointed at the
// fixture on this platform. It is named in the report, never dropped silently.
function expectedRemote(controlResults) {
  const updater = controlResults?.updater;
  if (typeof updater === "string" && updater.startsWith("setup:"))
    return {
      kinds: EXPECTED_REMOTE.filter((kind) => kind !== "updates"),
      excluded: [{ probe: "updater", kind: "updates", reason: updater }],
    };
  return { kinds: [...EXPECTED_REMOTE], excluded: [] };
}

function refusalProblems(results, { excluded = [] } = {}) {
  const problems = [];
  for (const probe of REMOTE_PROBES) {
    if (excluded.includes(probe)) continue;
    const value = results?.[probe];
    if (typeof value !== "string") problems.push({ probe, result: "missing" });
    else if (value === "reached" || value === "timeout" || value.startsWith("setup:"))
      problems.push({ probe, result: value });
  }
  return problems;
}

// What 07a main must say while sealed, on every platform.
function evaluate07aAttestation(attestation) {
  if (!attestation || typeof attestation !== "object") return ["attestation unreadable"];
  const problems = [];
  if (attestation.nothingLeaves !== false) problems.push("nothingLeaves is not false");
  if (attestation.effectiveSince !== null) problems.push("effectiveSince is not null");
  if (attestation.phase !== "sealing") problems.push(`phase is ${attestation.phase}, not sealing`);
  const failures = Array.isArray(attestation.failures) ? attestation.failures : [];
  if (!failures.includes(NATIVE_BOUNDARY_UNAVAILABLE))
    problems.push(`failures lack ${NATIVE_BOUNDARY_UNAVAILABLE}`);
  const mechanism = attestation.isolation?.mechanism;
  if (attestation.isolation && mechanism !== "none")
    problems.push(`isolation mechanism ${mechanism} claimed`);
  return problems;
}

// The report keeps a projection, never the raw attestation fields.
function summarizeAttestation(attestation) {
  if (!attestation || typeof attestation !== "object") return { readable: false };
  return {
    readable: true,
    sealed: attestation.sealed === true,
    phase: String(attestation.phase ?? "").slice(0, 40),
    effectiveSinceNull: attestation.effectiveSince === null,
    claimsNothingLeaves: attestation.nothingLeaves !== false,
    failures: (Array.isArray(attestation.failures) ? attestation.failures : [])
      .slice(0, 40)
      .map((failure) => String(failure).slice(0, 120)),
  };
}

function nativeGate(platform) {
  if (platform === "darwin") return "D16";
  if (platform === "linux") return "D14/D15";
  return "D14";
}

// True when every mandatory observer check was evaluated (passed or failed).
function observerChecksComplete(report) {
  const seen = new Set([
    ...report.observer.passed,
    ...report.observer.failed.map((entry) => entry.name),
  ]);
  return MANDATORY_CHECKS.every((name) => seen.has(name));
}

function finalizeStatus(report) {
  if (report.notRun) return "not-run";
  // A leak (or a recorded finding) outranks a crash: the evidence is the point.
  if (report.observer.failed.length) return "FAIL";
  // A crash, a timeout or an early stop is never mistaken for a clean run.
  if (report.error || !observerChecksComplete(report)) return "INCOMPLETE";
  // Observer checks alone can never make a pass: the native boundary is absent.
  return "NOT VERIFIED";
}

function exitCodeFor(status) {
  if (status === "not-run") return EXIT.NOT_RUN;
  if (status === "NOT VERIFIED") return EXIT.NOT_VERIFIED;
  if (status === "INCOMPLETE") return EXIT.INCOMPLETE;
  return EXIT.FAIL;
}

// The report's own verdict text: the only strings the wording scan reads.
// Echoed data (fixture requests, probe results, check details, error text,
// attestation summaries) is evidence, not a claim, and is never scanned for
// wording, so a request path containing "verified" cannot discard the report.
function verdictStrings(report) {
  const out = [];
  const add = (at, value) => {
    if (typeof value === "string") out.push([at, value]);
  };
  const each = (list, at, fn) =>
    (Array.isArray(list) ? list : []).forEach((v, i) => fn(v, `${at}[${i}]`));
  add("report.status", report?.status);
  add("report.scope", report?.scope);
  add("report.observer.evidence", report?.observer?.evidence);
  each(report?.observer?.passed, "report.observer.passed", (v, at) => add(at, v));
  each(report?.observer?.failed, "report.observer.failed", (v, at) => add(`${at}.name`, v?.name));
  const native = report?.nativeBoundary;
  for (const key of ["status", "gate", "reason"])
    add(`report.nativeBoundary.${key}`, native?.[key]);
  each(native?.blocked, "report.nativeBoundary.blocked", (v, at) => add(`${at}.status`, v?.status));
  each(native?.pending, "report.nativeBoundary.pending", (v, at) => {
    add(`${at}.status`, v?.status);
    add(`${at}.item`, v?.item);
  });
  each(report?.pendingManual, "report.pendingManual", (v, at) => add(`${at}.check`, v?.check));
  each(report?.notRun?.reasons, "report.notRun.reasons", (v, at) => add(`${at}.detail`, v?.detail));
  return out;
}

function honestyViolations(report) {
  const violations = [];
  for (const [at, value] of verdictStrings(report)) {
    const rest = value.replace(/\bnot verified\b|\bunverified\b/gi, "");
    if (/verified/i.test(rest)) violations.push(`${at}: positive verification wording`);
    if (/\b0 bytes\b/i.test(value)) violations.push(`${at}: a zero-byte claim`);
  }
  // Structural claims are rejected anywhere in the report.
  const walk = (value, at) => {
    if (Array.isArray(value)) return value.forEach((item, i) => walk(item, `${at}[${i}]`));
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "nothingLeaves" && item !== false)
        violations.push(`${at}.${key}: must never be anything but false`);
      if (/verified/i.test(key.replace(/^(not|un)verified/i, "")) && item === true)
        violations.push(`${at}.${key}: a positive verification flag`);
      if ((key === "isolated" || key === "networkFree") && item === true)
        violations.push(`${at}.${key}: a native isolation claim`);
      walk(item, `${at}.${key}`);
    }
  };
  walk(report, "report");
  if (!STATUSES.includes(report?.status)) violations.push("report.status: not an allowed status");
  if (report?.nativeBoundary?.status !== "NOT VERIFIED")
    violations.push("report.nativeBoundary.status: must stay NOT VERIFIED in 07a");
  return violations;
}

// Writes report.json. A report that fails the honesty check is replaced by a
// minimal FAIL report naming where the violation was, never written as-is.
function writeReport(output, report) {
  const violations = honestyViolations(report);
  const written = violations.length
    ? {
        schema: REPORT_SCHEMA,
        status: "FAIL",
        reason: "honesty-violation",
        observerChecksComplete: false,
        error: "The run produced a report that failed the 07a honesty check; it was not written.",
        violations,
        nativeBoundary: { status: "NOT VERIFIED", gate: report?.nativeBoundary?.gate ?? null },
      }
    : report;
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(written, null, 2));
  return written;
}

function createAcceptanceRecord({
  output = null,
  platform = process.platform,
  arch = process.arch,
  now = Date.now,
  log = console.log,
} = {}) {
  const gate = nativeGate(platform);
  const report = {
    schema: REPORT_SCHEMA,
    status: "RUNNING",
    observerChecksComplete: false,
    platform,
    arch,
    startedAt: now(),
    finishedAt: null,
    output,
    scope: SCOPE,
    notRun: null,
    prerequisites: null,
    fixtures: null,
    observer: { evidence: OBSERVER_SCOPE, passed: [], failed: [] },
    runs: {},
    nativeBoundary: {
      status: "NOT VERIFIED",
      gate,
      reason: NATIVE_REASON,
      blocked: [],
      pending: NATIVE_PENDING.filter(
        (item) => item.platform === "all" || item.platform === platform
      ),
    },
    pendingManual: MANUAL_CHECKLIST,
    cleanupErrors: [],
    error: null,
  };
  let remote = null;
  const leaked = (since) => {
    if (!remote) throw new Error("No remote fixture attached");
    return remote.seenSince(since);
  };
  return {
    report,
    attachRemote(fixture) {
      remote = fixture;
    },
    leaked,
    nothingLeft(since) {
      const seen = leaked(since);
      return seen.requests.length === 0 && seen.connections === 0;
    },
    // An observer check. A failure is recorded and stops the run.
    verify(name, condition, detail) {
      if (!condition) {
        report.observer.failed.push({ name, detail: detail ?? null });
        throw new Error(`${name}${detail ? `: ${JSON.stringify(detail).slice(0, 2000)}` : ""}`);
      }
      report.observer.passed.push(name);
      log(`PASS ${name}`);
    },
    // A finding: recorded like a failed check (the run ends FAIL) but the run
    // continues, so later evidence is still collected.
    check(name, condition, detail) {
      if (!condition) {
        report.observer.failed.push({ name, detail: detail ?? null, finding: true });
        log(`FINDING ${name}`);
        return false;
      }
      report.observer.passed.push(name);
      log(`PASS ${name}`);
      return true;
    },
    // The native boundary is absent in 07a: every sealed run records the block.
    recordNativeBlock(run, attestation) {
      report.nativeBoundary.blocked.push({
        run,
        gate,
        status: "NOT VERIFIED",
        attestation: summarizeAttestation(attestation),
      });
      log(`BLOCKED ${run}: ${gate} native isolation is NOT VERIFIED (07b absent)`);
    },
    finalize() {
      report.observerChecksComplete = !report.notRun && observerChecksComplete(report);
      report.status = finalizeStatus(report);
      report.finishedAt = now();
      return report.status;
    },
  };
}

function createCleanup() {
  const steps = [];
  return {
    add(label, step, timeout = 15000) {
      steps.push({ label, step, timeout });
    },
    // Runs every step once, newest first; failures and hangs are collected.
    async run() {
      const errors = [];
      while (steps.length) {
        const { label, step, timeout } = steps.pop();
        try {
          await bounded(Promise.resolve().then(step), timeout, `cleanup step timed out: ${label}`);
        } catch (error) {
          errors.push({ label, error: String(error?.message || error).slice(0, 300) });
        }
      }
      return errors;
    },
  };
}

// A Playwright evaluate (page or Electron app) that cannot hang the run.
function evaluateWithin(target, fn, arg, label, timeout = EVALUATE_TIMEOUT_MS) {
  return bounded(
    Promise.resolve().then(() => target.evaluate(fn, arg)),
    timeout,
    `${label} timed out`
  );
}

// Cleanup is newest-first: registering the netlog copy before the close means
// the app is closed (and Chromium has flushed its netlog) before it is copied,
// on the success path and on every abort.
function registerLaunchCleanup(cleanup, name, { close, copyNetlog }) {
  cleanup.add(`netlog ${name}`, copyNetlog);
  cleanup.add(`app ${name}`, close);
}

// Force-kill through what the launcher owns: the app's ChildProcess handle and
// its process group. Playwright spawns Electron detached, so Electron leads its
// own group and the app's unsealed children (the stubborn probe) are in it.
// While the handle has not reported an exit the leader is not yet reaped, so
// its PID and group id cannot belong to anything else. After that, nothing is
// signalled: a bare PID may have been reused.
function forceKillOwnedGroup(handle, { platform = process.platform, kill = process.kill } = {}) {
  if (!handle || handle.exitCode !== null || handle.signalCode !== null) return false;
  if (platform !== "win32" && Number.isInteger(handle.pid) && handle.pid > 0) {
    try {
      kill(-handle.pid, "SIGKILL");
    } catch {
      // The group may already be gone; the handle kill below still applies.
    }
  }
  handle.kill("SIGKILL");
  return true;
}

// A model of Chromium's HostMappingRules for these rules (exclusions first,
// then the first matching MAP, "*" as the only wildcard). It documents and
// pins the intent; it is not Chromium, and STEP-4 confirms it on a real run.
function hostMappingFor(host, rules = HOST_RESOLVER_RULES) {
  const entries = String(rules)
    .split(",")
    .map((rule) => rule.trim().split(/\s+/))
    .filter((parts) => parts[0]);
  const matches = (pattern, name) =>
    new RegExp(
      `^${pattern
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*")}$`,
      "i"
    ).test(name);
  const name = String(host);
  for (const [verb, pattern] of entries)
    if (verb.toUpperCase() === "EXCLUDE" && matches(pattern, name)) return null;
  for (const [verb, pattern, target] of entries)
    if (verb.toUpperCase() === "MAP" && matches(pattern, name)) return target ?? null;
  return null;
}

// The Chromium switches the bootstrap appends, as [name, value] pairs.
function chromiumSwitches() {
  return [["host-resolver-rules", HOST_RESOLVER_RULES]];
}

// Child probes run only unsealed. No privacy.json is the app's default (open);
// anything other than an explicit `sealed: false` refuses.
function childProbeAllowed(savedText) {
  if (savedText === null || savedText === undefined) return true;
  try {
    const saved = JSON.parse(savedText);
    return !!saved && typeof saved === "object" && saved.sealed === false;
  } catch {
    return false;
  }
}

// The app's whole environment: an allowlist from the launcher plus temporary
// HOME/XDG/TMPDIR under the per-launch sandbox. The launcher's own environment
// (and so the test runner's HOME) is never changed.
function buildChildEnv({
  baseEnv = {},
  sandbox,
  profile,
  remotePort,
  localPort,
  allowSessionBus = false,
}) {
  const env = {};
  for (const key of CHILD_ENV_PASSTHROUGH)
    if (typeof baseEnv[key] === "string" && baseEnv[key]) env[key] = baseEnv[key];
  for (const [key, value] of Object.entries(baseEnv))
    if (/^LC_[A-Z_]+$/.test(key) && typeof value === "string" && value) env[key] = value;
  const xdg = path.join(sandbox, "xdg");
  const directories = {
    HOME: path.join(sandbox, "home"),
    XDG_CONFIG_HOME: path.join(xdg, "config"),
    XDG_DATA_HOME: path.join(xdg, "data"),
    XDG_CACHE_HOME: path.join(xdg, "cache"),
    XDG_STATE_HOME: path.join(xdg, "state"),
    XDG_RUNTIME_DIR: path.join(xdg, "runtime"),
    TMPDIR: path.join(sandbox, "tmp"),
  };
  Object.assign(env, directories);
  env.DBUS_SESSION_BUS_ADDRESS =
    allowSessionBus && baseEnv.DBUS_SESSION_BUS_ADDRESS
      ? baseEnv.DBUS_SESSION_BUS_ADDRESS
      : "disabled:";
  Object.assign(env, {
    NODE_ENV: "test",
    LOQUI_PROFILE_DIR: profile,
    LOQUI_ACCEPT_SANDBOX: sandbox,
    LOQUI_ACCEPT_PORT: String(remotePort),
    LOQUI_ACCEPT_LOCAL_PORT: String(localPort),
    LOQUI_CACHE_ROOT: path.join(sandbox, "cache"),
  });
  return {
    env,
    directories: Object.values(directories),
    runtimeDir: directories.XDG_RUNTIME_DIR,
  };
}

function isXvfbRunDisplay(env) {
  return /[\\/]xvfb-run\.[^\\/]+[\\/]Xauthority$/.test(String(env.XAUTHORITY || ""));
}

function isUserSessionBus(address, env) {
  const value = String(address || "");
  return (
    /\/run\/user\/\d+\/bus\b/.test(value) ||
    (!!env.XDG_RUNTIME_DIR && value.includes(`${env.XDG_RUNTIME_DIR}/bus`))
  );
}

// Launch safety, checked before anything is loaded. Reasons name variables,
// never their values.
function assessLaunchSafety({
  argv = [],
  env = {},
  platform = process.platform,
  uid = typeof process.getuid === "function" ? process.getuid() : null,
} = {}) {
  const reasons = [];
  const reason = (code, detail) => reasons.push({ code, detail });
  if (!argv.includes(LAUNCH_OPT_IN))
    reason(
      "launch-not-authorized",
      `Launching Electron needs the explicit ${LAUNCH_OPT_IN} flag and the isolated run ` +
        "procedure in this script's header."
    );
  if (uid === 0)
    reason(
      "running-as-root",
      "Running as root (uid 0, including root mapped in a user namespace). Chromium would need " +
        "its sandbox off; run as the invoking user (see the bwrap recipe)."
    );
  if (platform === "linux") {
    const live = LIVE_SESSION_MARKERS.filter((key) => env[key]);
    if (live.length)
      reason(
        "live-session-display",
        `${live.join(" and ")} set: this looks like the live desktop session. The app has no ` +
          "switch to stop its compositor hotkey registration, so it runs only on an isolated " +
          "display; unset these and use xvfb-run."
      );
    if (env.DISPLAY && !isXvfbRunDisplay(env))
      reason(
        "display-not-isolated",
        "DISPLAY has no xvfb-run marker (XAUTHORITY inside an xvfb-run.* directory), so it may " +
          "be the live X session. Run under xvfb-run -a."
      );
  } else if (!argv.includes(DEDICATED_DESKTOP_ACK))
    reason(
      "desktop-not-isolated",
      `No Xvfb on ${platform}: the app opens on this desktop. Run it from a dedicated, ` +
        `disposable OS user account and pass ${DEDICATED_DESKTOP_ACK}.`
    );
  const allowSessionBus = argv.includes(SESSION_BUS_OPT_IN);
  if (allowSessionBus && isUserSessionBus(env.DBUS_SESSION_BUS_ADDRESS, env))
    reason(
      "session-bus-is-live",
      `${SESSION_BUS_OPT_IN} would forward the user's own session bus. Start a private bus ` +
        "with dbus-run-session instead."
    );
  return { reasons, allowSessionBus };
}

// Playwright options for one launch. chromiumSandbox must be true: Playwright
// otherwise disables Chromium's sandbox on Linux.
function electronLaunchOptions({ executablePath, platform, env, root, script = __filename }) {
  const args = ["--lang=en-US"];
  if (platform === "linux") args.push("--ozone-platform=x11");
  return {
    executablePath,
    args: [...args, script],
    cwd: root,
    env,
    timeout: 45000,
    chromiumSandbox: true,
  };
}

function readModuleRegistration(buffer) {
  const text = Buffer.from(buffer).toString("latin1");
  const node = /node_register_module_v(\d+)/.exec(text);
  if (node) return { kind: "node", version: Number(node[1]) };
  const napi = /napi_register_module_v(\d+)/.exec(text);
  if (napi) return { kind: "napi", version: Number(napi[1]) };
  return null;
}

function hostLibc(platform) {
  if (platform !== "linux" || process.platform !== "linux") return "glibc";
  return process.report.getReport().header.glibcVersionRuntime ? "glibc" : "musl";
}

// Mirrors better-sqlite3 13's lib/binding.js: prebuild first, then node-gyp's
// Debug and Release outputs. Nothing is loaded.
function resolveSqliteBinding(root, { platform, arch, libc }) {
  const dir = path.join(root, "node_modules", "better-sqlite3");
  const candidates = [];
  if (["linux", "darwin", "win32"].includes(platform) && ["x64", "arm64"].includes(arch)) {
    const target = `${platform === "linux" && libc === "musl" ? "linuxmusl" : platform}-${arch}`;
    candidates.push(path.join(dir, "prebuilds", `${target}.node`));
  }
  candidates.push(path.join(dir, "build", "Debug", "better_sqlite3.node"));
  candidates.push(path.join(dir, "build", "Release", "better_sqlite3.node"));
  return candidates.find((file) => fs.existsSync(file)) ?? null;
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function isExecutable(file, platform) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && (platform === "win32" || (stat.mode & 0o111) !== 0);
  } catch {
    return false;
  }
}

// Everything the launch needs, checked without loading Electron, Playwright or
// the SQLite binding. Never requires the electron package: its index.js
// downloads a missing binary.
function inspectLaunchPrerequisites({
  repoRoot: root = repoRoot,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  libc = hostLibc(platform),
} = {}) {
  const reasons = [];
  const reason = (code, detail) => reasons.push({ code, detail });
  const relative = (file) => (file ? path.relative(root, file).split(path.sep).join("/") : null);

  const electronDir = path.join(root, "node_modules", "electron");
  const binary = readText(path.join(electronDir, "path.txt"))?.trim() || null;
  let executablePath = null;
  if (env.ELECTRON_OVERRIDE_DIST_PATH)
    executablePath = path.join(env.ELECTRON_OVERRIDE_DIST_PATH, binary || "electron");
  else if (binary) executablePath = path.join(electronDir, "dist", binary);
  if (!executablePath || !isExecutable(executablePath, platform))
    reason(
      "electron-binary-missing",
      "node_modules/electron has no executable dist binary (npm ci --ignore-scripts skips the " +
        "electron postinstall). Install it on the run host; this script never downloads it."
    );
  const abiText = readText(path.join(electronDir, "abi_version"))?.trim();
  const abi = /^\d+$/.test(abiText ?? "") ? Number(abiText) : null;

  const sqliteFile = resolveSqliteBinding(root, { platform, arch, libc });
  let registration = null;
  if (!sqliteFile)
    reason(
      "sqlite-binding-missing",
      "No better-sqlite3 binding for this platform. Run npm run native:electron."
    );
  else {
    registration = readModuleRegistration(fs.readFileSync(sqliteFile));
    if (!registration)
      reason(
        "sqlite-abi-unknown",
        `${relative(sqliteFile)} exports no module registration symbol; its ABI is unknown.`
      );
    else if (registration.kind === "node" && abi === null)
      reason(
        "electron-abi-unknown",
        "node_modules/electron/abi_version is missing, so the SQLite binding cannot be matched."
      );
    else if (registration.kind === "node" && registration.version !== abi)
      reason(
        "sqlite-abi-mismatch",
        `${relative(sqliteFile)} was built for NODE_MODULE_VERSION ${registration.version}; ` +
          `Electron needs ${abi}. Run npm run native:electron (then npm run native:node after).`
      );
  }
  if (!fs.existsSync(path.join(root, "src", "dist", "index.html")))
    reason("renderer-not-built", "src/dist/index.html is missing. Run npm run build.");
  if (!fs.existsSync(path.join(root, "node_modules", "playwright", "package.json")))
    reason("playwright-missing", "node_modules/playwright is missing.");
  if (platform === "linux" && !env.DISPLAY)
    reason(
      "display-missing",
      "No X display. Run under xvfb-run -a (the app is started with --ozone-platform=x11)."
    );
  return {
    ready: reasons.length === 0,
    reasons,
    electron: { executablePath, abi },
    sqlite: { file: relative(sqliteFile), registration },
  };
}

function nodeUrlHost(input) {
  try {
    return new URL(input).hostname;
  } catch {
    return null;
  }
}

function compareUrlParsing(cases, chromiumHosts, parse = nodeUrlHost) {
  const rows = cases.map((input, i) => ({
    input,
    chromium:
      Array.isArray(chromiumHosts) && i < chromiumHosts.length ? chromiumHosts[i] : "missing",
    node: parse(input),
  }));
  return { rows, mismatches: rows.filter((row) => row.chromium !== row.node) };
}

// --- Launch environment: network routes and the single-instance socket path --------------------

// Interfaces with a route in a /proc/self/net table, other than lo. IPv4
// (`route`) has a header and the interface first; IPv6 (`ipv6_route`) has no
// header and the interface tenth. null when the table could not be read.
function nonLoopbackRouteInterfaces(text, { ipv6 = false } = {}) {
  if (typeof text !== "string") return null;
  const names = new Set();
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (!fields[0] || (!ipv6 && fields[0] === "Iface")) continue;
    if (ipv6 && fields.length < 10) continue;
    const name = ipv6 ? fields[9] : fields[0];
    if (name && name !== "lo") names.add(name);
  }
  return [...names].sort();
}

// Network devices other than lo in /proc/self/net/dev (two header lines, then
// "name: counters"). null when it could not be read.
function nonLoopbackDevices(text) {
  if (typeof text !== "string") return null;
  const names = new Set();
  for (const line of text.split("\n")) {
    const match = /^\s*([^\s:|]+):/.exec(line);
    if (match && match[1] !== "lo") names.add(match[1]);
  }
  return [...names].sort();
}

// Devices holding an IPv6 address, from /proc/self/net/if_inet6 (the device
// name is the last field). null when it could not be read.
function ipv6AddressDevices(text) {
  if (typeof text !== "string") return null;
  const names = new Set();
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length >= 6) names.add(fields[fields.length - 1]);
  }
  return [...names].sort();
}

// Non-loopback IPv4 addresses this namespace holds: the "/32 host LOCAL"
// leaves of /proc/self/net/fib_trie. The table names no device. null when it
// could not be read.
function localIpv4Addresses(text) {
  if (typeof text !== "string") return null;
  const addresses = new Set();
  let leaf = null;
  for (const line of text.split("\n")) {
    const match = /\|--\s+(\d+\.\d+\.\d+\.\d+)/.exec(line);
    if (match) leaf = match[1];
    else if (leaf && /\/32 host LOCAL/.test(line) && !leaf.startsWith("127.")) addresses.add(leaf);
  }
  return [...addresses].sort();
}

// The launcher's own network namespace, which Playwright's Electron inherits.
// /proc/self/net/* is per network namespace (unlike a bind-mounted /sys, which
// under the recipe's --dev-bind shows the host's devices and their flags).
function readNetworkRoutes(read = readText) {
  return {
    ipv4: read("/proc/self/net/route"),
    ipv6: read("/proc/self/net/ipv6_route"),
    devices: read("/proc/self/net/dev"),
    ipv6Addresses: read("/proc/self/net/if_inet6"),
    ipv4Addresses: read("/proc/self/net/fib_trie"),
  };
}

// Linux: refuse when the namespace lists any route through a non-lo interface,
// or any non-lo network device at all (the IPv4 table above is the main table
// only; a device catches routes kept in policy-routing tables), unless the
// operator passes --allow-network-route, which is recorded. This is a snapshot
// at launch, not packet evidence and not a native boundary. Where the tables
// cannot be read the network is recorded as not checked.
//
// A device with no route and no address cannot carry IP traffic: it is down
// or unconfigured, like the kernel's fallback tunnels (sit0, tunl0, ip6tnl0)
// that every new namespace gets while those modules are loaded (T16-n1). Such
// devices are recorded in ignoredDevices, not refused. Procfs shows no IFF_UP
// flag per namespace, so "no route and no address" stands in for "not up".
// fib_trie names no device, so any non-loopback IPv4 address, or an
// unreadable address table, keeps every device counted.
function assessNetworkRoutes({ platform = process.platform, routes, allowRoute = false } = {}) {
  const notChecked = (detail, extra = {}) => ({
    network: { state: "not-checked", detail, ...extra, interfaces: null, operatorOptIn: null },
    reasons: [],
  });
  if (platform !== "linux")
    return notChecked(`No /proc route tables on ${platform}; the network was not checked.`);
  const ipv4 = nonLoopbackRouteInterfaces(routes?.ipv4);
  if (ipv4 === null)
    return notChecked("/proc/self/net/route could not be read; the network was not checked.");
  const ipv6 = nonLoopbackRouteInterfaces(routes?.ipv6, { ipv6: true });
  const devices = nonLoopbackDevices(routes?.devices);
  const routed = [...new Set([...ipv4, ...(ipv6 ?? [])])].sort();
  // Without the device table a namespace with no route is not shown to be
  // loopback-only (T16 nit); a route still refuses below.
  if (devices === null && !routed.length)
    return notChecked(
      "/proc/self/net/dev could not be read, so devices outside the main route table were not " +
        "checked; the network was not checked.",
      { ipv4: "read", ipv6: ipv6 === null ? "absent" : "read", devices: "unreadable" }
    );
  const v6Addressed = ipv6AddressDevices(routes?.ipv6Addresses);
  const v4Local = localIpv4Addresses(routes?.ipv4Addresses);
  const addressesKnown = v6Addressed !== null && v4Local !== null && v4Local.length === 0;
  const inUse = (device) =>
    routed.includes(device) || !addressesKnown || v6Addressed.includes(device);
  const ignoredDevices = (devices ?? []).filter((device) => !inUse(device));
  const interfaces = [
    ...new Set([...routed, ...(devices ?? []).filter((device) => inUse(device))]),
  ].sort();
  let state = "loopback-only";
  if (routed.length) state = "non-loopback-route";
  else if (interfaces.length) state = "non-loopback-interface";
  const network = {
    state,
    detail:
      "Route tables, devices and addresses read at launch from /proc/self/net (a snapshot; not " +
      "packet evidence). Devices with no route and no address are listed in ignoredDevices.",
    ipv4: "read",
    ipv6: ipv6 === null ? "absent" : "read",
    devices: devices === null ? "unreadable" : "read",
    ipv6Addresses: v6Addressed === null ? "unreadable" : "read",
    ipv4Addresses:
      v4Local === null ? "unreadable" : v4Local.length ? "non-loopback-present" : "loopback-only",
    interfaces,
    ignoredDevices,
    operatorOptIn: interfaces.length && allowRoute ? NETWORK_ROUTE_OPT_IN : null,
  };
  const reasons =
    interfaces.length && !allowRoute
      ? [
          {
            code: routed.length ? "network-route-present" : "network-interface-present",
            detail:
              `This network namespace has ${routed.length ? "routes through" : "the devices"} ` +
              `${interfaces.join(", ")}, so the unsealed control could reach a real network. ` +
              "Run inside the loopback-only namespace in this script's header, or pass " +
              `${NETWORK_ROUTE_OPT_IN} to accept that (it is recorded in the report).`,
          },
        ]
      : [];
  return { network, reasons };
}

// The longest single-instance socket path any launch can produce, checked
// against the platform's sun_path. Chromium cannot bind a longer path, the
// app's single-instance lock then fails and it quits; refuse up front instead.
function singletonSocketCheck({ output, platform = process.platform }) {
  const size = SUN_PATH_BYTES[platform];
  if (!size) return { checked: false, bytes: null, limit: null, reasons: [] };
  const limit = size - 1;
  const bytes = Math.max(
    ...LAUNCH_NAMES.map((name) => {
      const { env } = buildChildEnv({
        sandbox: path.join(output, `${name}-XXXXXX`),
        profile: "",
        remotePort: 0,
        localPort: 0,
      });
      return Buffer.byteLength(path.join(env.TMPDIR, ...SINGLETON_SOCKET_TAIL));
    })
  );
  const reasons =
    bytes > limit
      ? [
          {
            code: "socket-path-too-long",
            detail:
              `The app's single-instance socket path would be ${bytes} bytes; the ${platform} ` +
              `limit is ${limit} (sun_path ${size} with its terminator). Use a shorter ` +
              (platform === "darwin"
                ? "--output-dir, such as --output-dir /tmp/lqa (macOS's default temporary " +
                  "directory is always too deep)."
                : "--output-dir."),
          },
        ]
      : [];
  return { checked: true, bytes, limit, reasons };
}

// --- OS keychain stub (installed by the bootstrap before the app loads) -------------------------

// The app's OS keychain library (src/helpers/secretCrypto.js) and its
// per-platform native binding packages, by bare name or resolved path.
function isKeychainRequest(request) {
  const name = String(request);
  return (
    name === "@napi-rs/keyring" ||
    name.startsWith("@napi-rs/keyring/") ||
    name.startsWith("@napi-rs/keyring-") ||
    /[\\/]node_modules[\\/]@napi-rs[\\/]keyring(?:-[^\\/]+)?(?:[\\/]|$)/.test(name)
  );
}

// An in-memory, process-local stand-in for @napi-rs/keyring with the same
// Entry / AsyncEntry / findCredentials surface. Its store is a Map that dies
// with the process: no OS keyring (Secret Service, kernel keyutils, Keychain,
// Credential Manager) is ever reached.
function createMemoryKeychain() {
  const store = new Map();
  const keyOf = (service, account) => JSON.stringify([String(service), String(account)]);
  class Entry {
    #service;
    #account;
    constructor(service, account) {
      this.#service = String(service);
      this.#account = String(account);
    }
    #key() {
      return keyOf(this.#service, this.#account);
    }
    setPassword(password) {
      store.set(this.#key(), {
        service: this.#service,
        account: this.#account,
        bytes: Buffer.from(String(password), "utf8"),
      });
    }
    setSecret(secret) {
      store.set(this.#key(), {
        service: this.#service,
        account: this.#account,
        bytes: Buffer.from(secret),
      });
    }
    getPassword() {
      const item = store.get(this.#key());
      return item ? item.bytes.toString("utf8") : null;
    }
    getSecret() {
      const item = store.get(this.#key());
      return item ? [...item.bytes] : null;
    }
    deleteCredential() {
      return store.delete(this.#key());
    }
    deletePassword() {
      return this.deleteCredential();
    }
  }
  class AsyncEntry {
    #entry;
    constructor(service, account) {
      this.#entry = new Entry(service, account);
    }
    async setPassword(password) {
      this.#entry.setPassword(password);
    }
    async setSecret(secret) {
      this.#entry.setSecret(secret);
    }
    async getPassword() {
      return this.#entry.getPassword() ?? undefined;
    }
    async getSecret() {
      return this.#entry.getSecret() ?? undefined;
    }
    async deleteCredential() {
      return this.#entry.deleteCredential();
    }
    async deletePassword() {
      return this.#entry.deleteCredential();
    }
  }
  const findCredentials = (service) =>
    [...store.values()]
      .filter((item) => item.service === String(service))
      .map((item) => ({ account: item.account, password: item.bytes.toString("utf8") }));
  return {
    Entry,
    AsyncEntry,
    findCredentials,
    findCredentialsAsync: async (service) => findCredentials(service),
    get size() {
      return store.size;
    },
  };
}

// Intercepts Module._load so every keychain request gets the in-memory stub;
// every other request goes to the loader unchanged. Installed before main.js
// loads, so secretCrypto's require("@napi-rs/keyring") never loads the real
// module or its native binding.
function installKeychainStub({
  moduleApi = require("node:module"),
  keychain = createMemoryKeychain(),
} = {}) {
  const original = moduleApi._load;
  const intercepted = [];
  moduleApi._load = function loadWithKeychainStub(request, parent, isMain) {
    if (isKeychainRequest(request)) {
      intercepted.push(String(request));
      return keychain;
    }
    return original.call(this, request, parent, isMain);
  };
  const wrapper = moduleApi._load;
  // Evidence, read when asked (T16-n3): the stub is still the loader, and no
  // real keyring module (or its native binding) is in the module cache.
  const state = () => {
    const stubActive = moduleApi._load === wrapper;
    const realKeyringLoaded = Object.keys(moduleApi._cache ?? {}).some(isKeychainRequest);
    return {
      store: stubActive && !realKeyringLoaded ? "in-memory" : "not-confirmed",
      stubActive,
      realKeyringLoaded,
      intercepted: [...intercepted],
      entries: keychain.size,
    };
  };
  return {
    keychain,
    intercepted,
    state,
    restore() {
      moduleApi._load = original;
    },
  };
}

// --- Electron bootstrap (runs inside the app's main process) -----------------------------------

// Every dependency is injectable so the order (keychain stub first, app last)
// is executed by the Node test; inside Electron the defaults are used.
function bootstrapElectron({
  electron: injectedElectron = null,
  env = process.env,
  moduleApi = require("node:module"),
  osModule = os,
  scope = globalThis,
  loadApp = () => require(path.join(repoRoot, "main.js")),
} = {}) {
  // First, before Electron or the app load anything: the app's OS keychain
  // library is replaced by an in-memory, process-local store. With the session
  // bus disabled, @napi-rs/keyring would otherwise fall back to the operator's
  // kernel keyring (keyutils) and write a master key there under the dev
  // build's own service name.
  const keychainStub = installKeychainStub({ moduleApi });
  const electron = injectedElectron ?? require("electron");
  const sandbox = env.LOQUI_ACCEPT_SANDBOX;
  const profile = env.LOQUI_PROFILE_DIR;
  const port = Number(env.LOQUI_ACCEPT_PORT); // the remote fixture
  const localPort = Number(env.LOQUI_ACCEPT_LOCAL_PORT); // the local fixture
  const validPort = (value) => Number.isInteger(value) && value > 0 && value < 65536;
  if (!sandbox || !profile || !validPort(port) || !validPort(localPort))
    throw new Error("Acceptance bootstrap requires its sandbox.");
  const temporaryHome = path.join(sandbox, "home");
  fs.mkdirSync(temporaryHome, { recursive: true });
  osModule.homedir = () => temporaryHome;
  electron.app.setPath("home", temporaryHome);
  electron.app.setAppPath(repoRoot);
  electron.app.getVersion = () => require(path.join(repoRoot, "package.json")).version;
  // Startup errors fail the run instead of waiting on a native modal.
  electron.dialog.showErrorBox = (title, content) => {
    fs.writeFileSync(path.join(sandbox, "startup-error.txt"), `${title}\n${content}`);
    electron.app.exit(1);
  };
  // Chromium resolves the fixture names to the fixture, every other name to
  // NOTFOUND, and leaves 127.0.0.1, ::1 and localhost alone. Node does not read
  // this switch; the Node probes pass their own lookup. It is name resolution
  // for the test, not a blocker: the probes still go out.
  for (const [name, value] of chromiumSwitches())
    electron.app.commandLine.appendSwitch(name, value);
  electron.app
    .whenReady()
    .then(() => electron.netLog.startLogging(path.join(sandbox, "netlog.json")))
    .catch(() => {});

  const toFixture = (_host, options, callback) =>
    options?.all
      ? callback(null, [{ address: "127.0.0.1", family: 4 }])
      : callback(null, "127.0.0.1", 4);
  const url = (host, target) => `http://${host}.${FIXTURE_DOMAIN}:${port}${target}`;
  const attempt = (start) => settleWithin(Promise.resolve().then(start), PROBE_TIMEOUT_MS);
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Every probe makes a real attempt and reports how it ended, within its own
  // bound. The fixture log, not these results, decides whether anything left.
  async function runProbes(label) {
    const { net, BrowserWindow } = electron;
    const http = require("node:http");
    const WebSocket = require(path.join(repoRoot, "node_modules/ws"));
    const results = {};
    results.netFetch = await attempt(() => net.fetch(url("api", `/net-fetch-${label}`)));
    results.netRequest = await attempt(
      () =>
        new Promise((resolve, reject) => {
          const req = net.request(url("api", `/net-request-${label}`));
          req.on("response", (res) => {
            res.on("data", () => {});
            resolve();
          });
          req.on("error", reject);
          req.end();
        })
    );
    results.nodeHttp = await attempt(
      () =>
        new Promise((resolve, reject) => {
          const req = http.get(url("api", `/node-http-${label}`), { lookup: toFixture }, (res) => {
            res.resume();
            resolve();
          });
          req.on("error", reject);
        })
    );
    results.ws = await attempt(
      () =>
        new Promise((resolve, reject) => {
          const ws = new WebSocket(`ws://stream.${FIXTURE_DOMAIN}:${port}/ws-${label}`, {
            lookup: toFixture,
          });
          ws.on("error", reject);
          ws.on("unexpected-response", () => reject(new Error("unexpected response")));
          ws.on("close", resolve);
        })
    );
    // Out of loopback by redirect: the first hop is the local fixture and allowed.
    results.redirect = await attempt(() => net.fetch(`http://127.0.0.1:${localPort}/redirect`));
    // A renderer page: hints, an image and a fetch, in a fresh window of the default session.
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    try {
      results.rendererLoad = await attempt(() =>
        win.loadURL(
          "data:text/html," +
            encodeURIComponent(
              `<link rel="preconnect" href="${url("preconnect", "/")}">` +
                `<link rel="dns-prefetch" href="${url("prefetch", "/")}">` +
                `<a href="${url("link", `/link-${label}`)}">link</a>` +
                `<img src="${url("img", `/img-${label}.png`)}">` +
                `<script>fetch("${url("api", `/renderer-fetch-${label}`)}").catch(()=>{})</script>`
            )
        )
      );
      await pause(1000);
    } finally {
      win.destroy();
    }
    // electron-updater's own request path, pointed at the fixture. This is the
    // singleton the app's UpdateManager uses; the sandbox is disposable.
    try {
      const { autoUpdater: updater } = require(
        path.join(repoRoot, "node_modules/electron-updater")
      );
      updater.autoDownload = false;
      // Unpackaged, checkForUpdates() returns null without a request unless forced.
      updater.forceDevUpdateConfig = true;
      updater.setFeedURL({ provider: "generic", url: url("updates", "/") });
      results.updater = await attempt(() => updater.checkForUpdates());
    } catch (error) {
      results.updater = `setup:${errorLabel(error)}`;
    }
    // Loopback must keep working.
    results.loopback = await attempt(() =>
      net.fetch(`http://127.0.0.1:${localPort}/loopback-${label}`).then((r) => r.text())
    );
    return results;
  }

  // A network-capable child registered like yt-dlp. It ignores SIGTERM, so the
  // registry has to escalate and wait for the OS to report the exit. Child
  // probes run only unsealed: refuse if the profile says sealed. It stays in
  // Electron's process group (no detached), which the launcher owns.
  let stubborn = null;
  function startStubbornChild() {
    if (!childProbeAllowed(readText(path.join(profile, "privacy.json"))))
      throw new Error("Child probes run only unsealed.");
    const { spawn } = require("node:child_process");
    const child = spawn(
      process.execPath,
      ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
      { env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "ignore" }
    );
    stubborn = child;
    require(path.join(repoRoot, "src/helpers/privacy/childRegistry.js")).register(child, {
      kind: "yt-dlp",
    });
    return child.pid;
  }
  // Cleanup through the ChildProcess handle: Node never signals a child whose
  // exit it has already seen.
  function stopStubbornChild() {
    if (!stubborn || stubborn.exitCode !== null || stubborn.signalCode !== null) return false;
    return stubborn.kill("SIGKILL");
  }

  scope.__loquiAcceptance = {
    runProbes,
    startStubbornChild,
    stopStubbornChild,
    keychainState: keychainStub.state,
  };
  loadApp();
  return keychainStub;
}

// --- Launcher (plain Node): drives the app with Playwright ---------------------------------------

// Read-only liveness check (signal 0). Never used to decide what to kill.
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function runElectronAcceptance({
  record,
  output,
  root,
  baseEnv,
  executablePath,
  platform,
  safety = { allowSessionBus: false },
}) {
  const { _electron } = require(path.join(root, "node_modules", "playwright"));
  const { startEgressFixture } = require("./lib/egressFixture.cjs");
  const { report, verify } = record;
  const cleanup = createCleanup();
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function waitFor(read, predicate, message, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = await bounded(read(), 5000, `read timed out: ${message}`).catch(() => null);
      if (value !== null && predicate(value)) return value;
      await pause(200);
    }
    throw new Error(`Timed out: ${message}`);
  }
  let remote = null;
  let local = null;
  let stubbornPid = null;
  const closed = new WeakSet();
  const launchRecords = new WeakMap();
  async function closeApp(app) {
    if (closed.has(app)) return;
    closed.add(app);
    // The keychain evidence again at the end of the launch, after the app's
    // lazy first credential use (T16-n3). Best effort; never blocks the close.
    const launchRecord = launchRecords.get(app);
    if (launchRecord)
      launchRecord.osKeychainAtClose = await evaluateWithin(
        app,
        () => globalThis.__loquiAcceptance.keychainState(),
        undefined,
        "keychain state at close"
      ).catch((failure) => ({ store: "unknown", error: errorLabel(failure) }));
    try {
      await bounded(app.close(), 10000, "Timed out closing the app");
    } catch {
      forceKillOwnedGroup(app.process(), { platform });
    }
  }
  // A renderer-hardening finding: measured and judged, recorded either way,
  // and never allowed to abort the run before the sealed checks.
  async function finding(name, measure, judge) {
    let value;
    try {
      value = await measure();
    } catch (error) {
      value = { error: errorLabel(error), message: String(error?.message || "").slice(0, 300) };
      record.check(name, false, value);
      return value;
    }
    record.check(name, judge(value), value);
    return value;
  }

  async function launch(name, { bootSealed }) {
    const sandbox = fs.mkdtempSync(path.join(output, `${name}-`));
    const profile = path.join(sandbox, "profile");
    fs.mkdirSync(profile);
    if (bootSealed)
      fs.writeFileSync(
        path.join(profile, "privacy.json"),
        JSON.stringify({ sealed: true, sealedSince: Date.now() }),
        { mode: 0o600 }
      );
    const { env, directories, runtimeDir } = buildChildEnv({
      baseEnv,
      sandbox,
      profile,
      remotePort: remote.port,
      localPort: local.port,
      allowSessionBus: safety.allowSessionBus,
    });
    for (const directory of directories) fs.mkdirSync(directory, { recursive: true });
    fs.chmodSync(runtimeDir, 0o700);
    report.launch = {
      childEnvKeys: Object.keys(env).sort(),
      sessionBus: env.DBUS_SESSION_BUS_ADDRESS === "disabled:" ? "disabled" : "forwarded",
      chromiumSandbox: true,
    };
    const app = await _electron.launch(
      electronLaunchOptions({ executablePath, platform, env, root })
    );
    launchRecords.set(app, report.launch);
    registerLaunchCleanup(cleanup, name, {
      close: () => closeApp(app),
      copyNetlog: () => {
        const netlog = path.join(sandbox, "netlog.json");
        if (fs.existsSync(netlog))
          fs.copyFileSync(netlog, path.join(output, `netlog-${name}.json`));
      },
    });
    const panel = await waitFor(
      async () => app.windows().find((page) => /[?&]panel=true(?:&|$)/.test(page.url())) ?? null,
      Boolean,
      "control panel page",
      45000
    );
    await panel.waitForFunction(() => !!window.electronAPI?.privacy, null, { timeout: 30000 });
    // Recorded, not judged: the stub is installed before main.js either way,
    // and secretCrypto loads the keychain lazily on first credential use.
    report.launch.osKeychain = await evaluateWithin(
      app,
      () => globalThis.__loquiAcceptance.keychainState(),
      undefined,
      "keychain state"
    ).catch((failure) => ({ store: "unknown", error: errorLabel(failure) }));
    return { app, panel };
  }
  const attestation = (panel) =>
    evaluateWithin(
      panel,
      () => window.electronAPI.privacy.getAttestation(),
      undefined,
      "attestation"
    );
  const probe = (app, label) =>
    evaluateWithin(
      app,
      (_electron, l) => globalThis.__loquiAcceptance.runProbes(l),
      label,
      `probes ${label}`,
      PROBE_TIMEOUT_MS * 12
    );

  try {
    remote = await startEgressFixture(); // only ever reached through fixture names
    cleanup.add("remote fixture", () => remote.close());
    local = await startEgressFixture({ redirectTo: `http://api.${FIXTURE_DOMAIN}:${remote.port}` });
    cleanup.add("local fixture", () => local.close());
    record.attachRemote(remote);
    report.fixtures = {
      remote: { host: remote.host, port: remote.port, names: `*.${FIXTURE_DOMAIN}` },
      local: { host: local.host, port: local.port },
    };

    // Run 1: the control. Unsealed, every probe must reach the fixture, which
    // proves each probe would be seen if it leaked. Then toggle to sealed.
    {
      const { app, panel } = await launch(LAUNCH_NAMES[0], { bootSealed: false });
      const run = (report.runs.open = {});
      const initial = await attestation(panel);
      run.initial = summarizeAttestation(initial);
      verify(
        CHECKS.controlStartsOpen,
        initial?.sealed === false && initial?.phase === "open",
        run.initial
      );
      const since = Date.now();
      run.probes = await probe(app, "open");
      const expected = expectedRemote(run.probes);
      run.excluded = expected.excluded;
      const reached = probeKinds(record.leaked(since).requests);
      verify(
        CHECKS.controlReached,
        expected.kinds.every((kind) => reached.includes(kind)),
        {
          reached,
          missing: expected.kinds.filter((kind) => !reached.includes(kind)),
        }
      );
      verify(CHECKS.controlLoopback, run.probes.loopback === "reached", run.probes);

      // T10: the app's own update check (UpdateManager, now pointed at the
      // fixture) tags its requests; the session backstop strips the tag.
      const updateSince = Date.now();
      run.appUpdateCheck = {
        result: await settleWithin(
          evaluateWithin(panel, () => window.electronAPI.updates.check(), undefined, "update check")
        ),
      };
      const updateHits = record
        .leaked(updateSince)
        .requests.filter((hit) => matchesKind(hit, "updates"));
      run.appUpdateCheck.fixtureRequests = updateHits.length;
      if (updateHits.length)
        verify(
          CHECKS.controlUpdateTag,
          updateHits.every((hit) => !hit.egressTagged),
          updateHits
        );
      else run.appUpdateCheck.note = "not exercised: nothing reached the fixture; T10 stays manual";

      // C2-R2 / T7a: in the top page, and in frames the page creates for itself.
      run.frames = await finding(
        CHECKS.rendererFrames,
        () =>
          evaluateWithin(
            panel,
            () =>
              new Promise((resolve) => {
                const blank = document.createElement("iframe");
                document.body.append(blank);
                const viaBlank = typeof blank.contentWindow?.RTCPeerConnection;
                const bridgeInFrame = typeof blank.contentWindow?.electronAPI;
                const srcdoc = document.createElement("iframe");
                srcdoc.srcdoc = "<p>x</p>";
                const finish = (srcdocValue) => {
                  blank.remove();
                  srcdoc.remove();
                  resolve({
                    top: typeof RTCPeerConnection,
                    blank: viaBlank,
                    srcdoc: srcdocValue,
                    bridgeInFrame,
                  });
                };
                const timer = setTimeout(() => finish("no-load"), 5000);
                srcdoc.addEventListener(
                  "load",
                  () => {
                    clearTimeout(timer);
                    finish(typeof srcdoc.contentWindow?.RTCPeerConnection);
                  },
                  { once: true }
                );
                document.body.append(srcdoc);
              }),
            undefined,
            "frame check"
          ),
        (frames) => Object.values(frames).every((value) => value === "undefined")
      );

      // T7a-M2 / T11-M7: a same-origin popup from every app window.
      run.popups = await finding(
        CHECKS.rendererPopups,
        async () => {
          const popups = [];
          for (const page of app.windows()) {
            const result = await evaluateWithin(
              page,
              () => {
                let popup;
                try {
                  popup = window.open("", "_blank");
                } catch {
                  return { denied: true };
                }
                if (!popup) return { denied: true };
                const value = {
                  denied: false,
                  webrtc: typeof popup.RTCPeerConnection,
                  bridge: typeof popup.electronAPI,
                };
                popup.close();
                return value;
              },
              undefined,
              "popup check",
              5000
            ).catch((error) => ({ error: errorLabel(error) }));
            popups.push({ window: new URL(page.url()).search.slice(0, 80), ...result });
          }
          return popups;
        },
        (popups) =>
          popups.every(
            (entry) =>
              entry.denied === true ||
              (entry.webrtc === "undefined" && entry.bridge === "undefined")
          )
      );

      // T11a: Chromium's URL parser against Node's for the loopback edge cases.
      run.urlParsing = await finding(
        CHECKS.rendererParsing,
        async () =>
          compareUrlParsing(
            LOOPBACK_PARSE_CASES,
            await evaluateWithin(
              panel,
              (cases) =>
                cases.map((input) => {
                  try {
                    return new URL(input).hostname;
                  } catch {
                    return null;
                  }
                }),
              LOOPBACK_PARSE_CASES,
              "URL parsing"
            )
          ),
        (parsing) => parsing.mismatches.length === 0
      );

      // Seal through the real preload and trusted IPC with a stubborn child
      // running. The child is started only while unsealed.
      const beforeChild = await attestation(panel);
      verify(
        CHECKS.childUnsealed,
        beforeChild?.sealed === false && beforeChild?.phase === "open",
        summarizeAttestation(beforeChild)
      );
      const pid = await evaluateWithin(
        app,
        () => globalThis.__loquiAcceptance.startStubbornChild(),
        undefined,
        "start stubborn child"
      );
      stubbornPid = pid;
      // Runs before the app's close (newest first), through the app's own handle.
      cleanup.add("stubborn child", async () => {
        if (closed.has(app)) return;
        await evaluateWithin(
          app,
          () => globalThis.__loquiAcceptance.stopStubbornChild(),
          undefined,
          "stop stubborn child",
          5000
        );
      });
      // setSealed resolves after main's sealing barrier ran. The leak probes
      // run now, before and independently of any attestation read: the
      // observer must not depend on the thing under test (Step 5 relies on it).
      await evaluateWithin(
        panel,
        () => window.electronAPI.privacy.setSealed(true),
        undefined,
        "setSealed(true)",
        30000
      );
      const sealedAt = Date.now();
      run.toggledProbes = await probe(app, "toggled");
      await pause(1500); // let late renderer, preconnect and updater traffic surface
      verify(CHECKS.toggleNothingLeft, record.nothingLeft(sealedAt), record.leaked(sealedAt));
      const exited = await waitFor(
        async () => !pidAlive(pid),
        Boolean,
        "stubborn child exit",
        20000
      ).catch(() => false);
      verify(CHECKS.toggleChildExited, exited === true, { pid });
      const sealed = await waitFor(
        () => attestation(panel),
        (value) => value.sealed === true,
        "sealed attestation",
        20000
      );
      const problems = evaluate07aAttestation(sealed);
      verify(CHECKS.toggleAttestation, problems.length === 0, {
        problems,
        attestation: summarizeAttestation(sealed),
      });
      record.recordNativeBlock("toggle", sealed);
      verify(CHECKS.toggleLoopback, run.toggledProbes.loopback === "reached", run.toggledProbes);
      const refusal = refusalProblems(run.toggledProbes, {
        excluded: expected.excluded.map((entry) => entry.probe),
      });
      verify(CHECKS.toggleRefused, refusal.length === 0, { refusal, results: run.toggledProbes });
      await closeApp(app);
    }

    // Run 2: sealed from boot. Nothing remote, from the first instruction. No
    // child probe here: child probes run only unsealed.
    {
      const since = Date.now();
      const { app, panel } = await launch(LAUNCH_NAMES[1], { bootSealed: true });
      const run = (report.runs.sealed = {});
      const setting = await waitFor(
        () => attestation(panel),
        (value) => value.sealed === true,
        "sealed setting state"
      );
      verify(CHECKS.bootSetting, setting.sealed === true, summarizeAttestation(setting));
      run.probes = await probe(app, "boot");
      await pause(1500); // let late renderer and updater requests surface
      verify(CHECKS.bootNothingLeft, record.nothingLeft(since), record.leaked(since));
      verify(CHECKS.bootLoopback, run.probes.loopback === "reached", run.probes);
      const current = await attestation(panel);
      const problems = evaluate07aAttestation(current);
      verify(CHECKS.bootAttestation, problems.length === 0, {
        problems,
        attestation: summarizeAttestation(current),
      });
      record.recordNativeBlock("boot", current);
      const excluded = (report.runs.open?.excluded ?? []).map((entry) => entry.probe);
      const refusal = refusalProblems(run.probes, { excluded });
      verify(CHECKS.bootRefused, refusal.length === 0, { refusal, results: run.probes });
      const ledger = await evaluateWithin(
        panel,
        () => window.electronAPI.privacy.egressSummary({ since: 0 }),
        undefined,
        "egress summary"
      );
      verify(CHECKS.bootLedger, ledger?.blocked > 0, { blocked: ledger?.blocked ?? null });
      await closeApp(app);
    }

    const allHits = [...remote.hits, ...local.hits];
    verify(
      CHECKS.noTagLeft,
      allHits.every((hit) => !hit.egressTagged),
      allHits.filter((hit) => hit.egressTagged)
    );
  } finally {
    report.cleanupErrors = await cleanup.run();
    // Never force-killed by number: a survivor is reported for a person to handle.
    if (stubbornPid !== null && pidAlive(stubbornPid))
      report.cleanupErrors.push({
        label: "stubborn child",
        error: `pid ${stubbornPid} is still present after cleanup; check it by hand`,
      });
    if (remote)
      report.remoteLog = { requests: remote.hits, connections: remote.seenSince(0).connections };
  }
}

async function main({
  argv = process.argv.slice(2),
  repoRoot: root = repoRoot,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  libc,
  uid = typeof process.getuid === "function" ? process.getuid() : null,
  readRoutes = readNetworkRoutes,
  runAcceptance = runElectronAcceptance,
  log = console.log,
  error = console.error,
} = {}) {
  if (argv.includes("--help")) {
    log(
      `Usage: node scripts/sealed-acceptance.cjs ${LAUNCH_OPT_IN} [--output-dir DIR] ` +
        `[${SESSION_BUS_OPT_IN}] [${NETWORK_ROUTE_OPT_IN}] [${DEDICATED_DESKTOP_ACK}]. ` +
        "Read the header first."
    );
    return 0;
  }
  const outputIndex = argv.indexOf("--output-dir");
  if (outputIndex !== -1 && !argv[outputIndex + 1]) {
    error("--output-dir requires a directory");
    return EXIT.FAIL;
  }
  const output =
    outputIndex === -1
      ? fs.mkdtempSync(path.join(os.tmpdir(), "loqui-sealed-accept-"))
      : path.resolve(argv[outputIndex + 1]);
  fs.mkdirSync(output, { recursive: true });
  const record = createAcceptanceRecord({ output, platform, arch, log });
  const safety = assessLaunchSafety({ argv, env, platform, uid });
  const routes = assessNetworkRoutes({
    platform,
    routes: platform === "linux" ? readRoutes() : null,
    allowRoute: argv.includes(NETWORK_ROUTE_OPT_IN),
  });
  const socket = singletonSocketCheck({ output, platform });
  record.report.launchEnvironment = {
    network: routes.network,
    singletonSocket: { bytes: socket.bytes, limit: socket.limit },
  };
  const prerequisites = inspectLaunchPrerequisites({
    repoRoot: root,
    env,
    platform,
    arch,
    ...(libc ? { libc } : {}),
  });
  record.report.prerequisites = {
    electronAbi: prerequisites.electron.abi,
    sqliteBinding: prerequisites.sqlite.file,
    sqliteRegistration: prerequisites.sqlite.registration,
  };
  const reasons = [
    ...safety.reasons,
    ...routes.reasons,
    ...socket.reasons,
    ...prerequisites.reasons,
  ];
  if (reasons.length) {
    record.report.notRun = { reasons };
    record.finalize();
    const written = writeReport(output, record.report);
    error(`NOT RUN: ${reasons.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")}`);
    log(`Acceptance artifacts: ${output}`);
    return exitCodeFor(written.status);
  }
  let written;
  try {
    await runAcceptance({
      record,
      output,
      root,
      baseEnv: env,
      executablePath: prerequisites.electron.executablePath,
      platform,
      safety: { allowSessionBus: safety.allowSessionBus },
    });
  } catch (failure) {
    record.report.error = String(failure?.message || failure).slice(0, 2000);
    error(failure?.stack || String(failure));
  } finally {
    record.finalize();
    written = writeReport(output, record.report);
    log(`${written.status}: native boundary NOT VERIFIED in 07a. Artifacts: ${output}`);
  }
  return exitCodeFor(written.status);
}

module.exports = {
  CHECKS,
  EXIT,
  EXPECTED_REMOTE,
  HOST_RESOLVER_RULES,
  LOOPBACK_PARSE_CASES,
  MANDATORY_CHECKS,
  MANUAL_CHECKLIST,
  NATIVE_BOUNDARY_UNAVAILABLE,
  NATIVE_PENDING,
  assessLaunchSafety,
  assessNetworkRoutes,
  bootstrapElectron,
  buildChildEnv,
  childProbeAllowed,
  chromiumSwitches,
  compareUrlParsing,
  createAcceptanceRecord,
  createCleanup,
  createMemoryKeychain,
  electronLaunchOptions,
  evaluate07aAttestation,
  evaluateWithin,
  exitCodeFor,
  expectedRemote,
  finalizeStatus,
  forceKillOwnedGroup,
  honestyViolations,
  hostMappingFor,
  inspectLaunchPrerequisites,
  installKeychainStub,
  ipv6AddressDevices,
  isKeychainRequest,
  localIpv4Addresses,
  main,
  nodeUrlHost,
  nonLoopbackDevices,
  nonLoopbackRouteInterfaces,
  probeKinds,
  readModuleRegistration,
  readNetworkRoutes,
  refusalProblems,
  registerLaunchCleanup,
  settleWithin,
  singletonSocketCheck,
  summarizeAttestation,
  writeReport,
};

if (process.versions.electron) bootstrapElectron();
else if (require.main === module)
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (failure) => {
      console.error(failure?.stack || failure);
      process.exitCode = EXIT.FAIL;
    }
  );
