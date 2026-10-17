---
name: Loqui
description: A precise desktop workbench for voice and personal knowledge.
colors:
  signal-orange: "#FF5A1F"
  orange-highlight: "#FF6A36"
  electric-fuchsia: "#D90078"
  agent-violet: "#8787FF"
  brand-ink: "#171717"
  paper: "#FFFFFF"
  workspace-gray: "#F7F7F7"
  surface-gray: "#F5F5F5"
  divider-gray: "#E5E5E5"
  secondary-text: "#525252"
  link-orange: "#C43E13"
  cta: "#171717"
  live: "#FF5A1F"
  nav-marker-light: "#E84E16"
  nav-marker-dark: "#E6007A"
  locality-device: "#0B7A54"
  locality-network: "#3B6EA8"
  locality-remote: "#AD5008"
  night-charcoal: "#1C1218"
  night-card: "#271820"
  night-raised: "#33202B"
  night-border: "#3D2733"
  night-text: "#F3E9EE"
  night-secondary-text: "#B59AA8"
typography:
  display:
    fontFamily: "Inter Variable, Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter Variable, Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
  label:
    fontFamily: "Inter Variable, Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 500
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "10px"
  shell: "12px"
  pill: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
components:
  button-primary:
    backgroundColor: "#171717"
    textColor: "#FFFFFF"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
    height: "40px"
  button-live:
    backgroundColor: "{colors.signal-orange}"
    textColor: "{colors.brand-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
    height: "40px"
  button-outline:
    backgroundColor: "{colors.surface-gray}"
    textColor: "{colors.brand-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
    height: "40px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.brand-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.brand-ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
  badge-primary:
    backgroundColor: "color-mix(in srgb, #FF5A1F 15%, transparent)"
    textColor: "{colors.signal-orange}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
---

# Design System: Loqui

## Overview

**Creative North Star: “The Personal Workbench”**

Loqui is a desktop work surface for voice and personal knowledge. Compact navigation and window chrome frame dictation, notes, history, meetings, search, and model controls. The interface is focused and direct; the vivid orange and fuchsia accents give the workbench a distinct signal while text and user content remain the main event.

The same React interface runs in the Electron shell on macOS and Linux, with platform-specific window controls and permissions. Light mode uses clean white and pale-gray surfaces. Dark mode is Plum Night: the brand guide's Deep Plum family; magenta marks active navigation; orange still means live voice. Rounded controls, restrained elevation, and clear interaction states carry the system across both themes. The visual anti-reference is generic AI-dashboard styling.

**Key Characteristics:**

- The ink CTA is the everyday action; Signal Orange means live voice; Electric Fuchsia supports secondary emphasis.
- Inter Variable anchors a compact, high-clarity interface.
- Light surfaces use subtle lift; dark surfaces use tonal separation and soft edge rims.
- Capsules, small-radius controls, and inset work areas shape the desktop shell.
- Interaction states stay explicit through focus rings, pressed feedback, and active navigation markers.

## Artwork

The application icon, symbol, horizontal wordmark, and stacked lockup come from the maintainer-supplied PNG asset pack received on 2026-09-24. They replace the temporary q-mark and microphone branding placeholders. The untouched originals and the supplied style-guide/overview images live in `src/assets/brand/source/`, with SHA-256 records in `manifest.json`. No editable SVG masters were supplied.

Use the committed exports generated from those originals; preserve aspect ratio and allow clear space around the symbol. Both `logo-light.png` and `logo-dark.png` retain the same supplied color logo. Check their legibility on the actual surface instead of applying an automatic color inversion. Monochrome marks and macOS template icons derive from the symbol's alpha mask, while color icons retain the supplied artwork.

Brand marks identify Loqui; microphone controls still communicate recording actions. Keep the distinct Agent Mode identity, state feedback, and reduced-motion behavior when displaying the Loqui symbol in the voice pill. Preserve the sidebar's macOS traffic-light clearance when sizing the wordmark or icon.

Regenerate with `npm run assets:generate` and verify with `npm run assets:check`. See [artwork provenance and output mapping](src/assets/README.md) for source files, distribution terms, and small-size/theme checks.

## Colors

The interface palette pairs a vivid orange live-voice color with fuchsia highlights over neutral light and Plum Night dark themes. The light-theme functional tokens remain unchanged by the September 2026 artwork update; the supplied brand style guide is a reference for the artwork, not an instruction to recolor light-theme controls or semantic states. The dark theme deliberately adopts the guide's Deep Plum family as Plum Night.

### Primary

- **Signal Orange** (#FF5A1F): Live voice and the Plum Night focus accent (light theme uses the deeper #E84E16 for focus). The ink CTA is the everyday action. The light-theme active-navigation marker uses the deeper orange #E84E16 (3:1 on the sidebar surface); Plum Night uses magenta for the active marker.
- **Orange Highlight** (#FF6A36): The brighter top stop in the live button and brand-surface gradient.

### Secondary

- **Electric Fuchsia** (#D90078): Supporting accent for secondary interface emphasis, including sparkle and action details. It complements the orange role rather than replacing it.

### Tertiary

- **Agent Violet** (#8787FF): A separate Agent Mode identity color. Keep it scoped to agent identity and state rather than treating it as a third general brand accent.

### Neutral

- **Brand Ink** (#171717): Main light-theme text and dark labels on orange surfaces.
- **Paper** (#FFFFFF): Light canvas and card background.
- **Workspace Gray** (#F7F7F7): Window backing around the inset work area.
- **Surface Gray** (#F5F5F5): Light muted panels and controls.
- **Divider Gray** (#E5E5E5): Light-theme borders and separators.
- **Secondary Text** (#525252): Supporting copy and labels in light mode.
- **Night Plum** (#1C1218): Plum Night canvas; panels rise through #21151B, #271820, #2D1C25, and #33202B, with #160D12 for the window backing.
- **Night Card** (#271820): Dark card surface.
- **Night Border** (#3D2733): Dark-theme separators and control borders.
- **Night Text** (#F3E9EE): Main dark-theme text; secondary text uses #B59AA8.
- **Orange Link** (#C43E13 in light mode; #FF9A7A in dark mode): Text links, kept distinct from the live orange fill.

### Roles

- **Live** (`--color-live` #FF5A1F, ink text #171717): orange means a voice is live. Use it only for record/stop/mic controls, the pill and the meters (`Button variant="live"`).
- **Call to action** (`--color-cta` #171717 / white text; Plum Night #F3E9EE / #1C1218 text): the default `Button`. It carries a 6px orange dot as the brand mark. Hover/press fills: #2E2E2E / #0A0A0A (white text) in light, #E6D8DF / #D8C7D1 (#1C1218 text) in Plum Night.
- **Link** (`--color-link` #C43E13 light, #FF9A7A dark; hover `--color-link-hover` #A8340D light, #FFB39A dark): always for inline links, never raw orange. Hover swaps to the hover token at full opacity; it never fades the link, which would drop it below 4.5:1.
- **Focus ring** (`--color-ring`): #E84E16 in light (at least 3:1 on every light surface), #FF5A1F in Plum Night. Always drawn fully opaque; a translucent orange ring does not reach 3:1.
- **Locality**: device #0B7A54, your network #3B6EA8, remote provider #AD5008 (dark: #5EE0AD, #9BB4D6, #FBBF6A). Always paired with ring shape and words.
- **Nav marker** (`--color-nav-marker`): deeper orange #E84E16 in light (3:1 on the sidebar surface), magenta #E6007A in Plum Night.
- **Status fills** (success, warning, destructive, info): text on a filled status surface clears 4.5:1 in both themes. Light success and warning fills carry ink (#171717); destructive and info carry white; Plum Night fills carry #1C1218.

- **Progress** (downloads, installs): ink fill on a muted track with an `--color-input-border` edge, and ink percentage text. Orange stays reserved for live voice.

### Named Rules

**The Two-Brand-Accent Rule.** Orange marks live voice, the focus accent and, in the light theme (as the deeper #E84E16), the active navigation marker; the everyday primary action is the ink CTA, and Plum Night marks active navigation in magenta #E6007A. Fuchsia is a supporting accent; Agent Violet stays scoped to Agent Mode.

## Typography

- **Display Font:** Inter Variable, with Noto Sans and platform sans-serif fallbacks.
- **Body Font:** Inter Variable, with Noto Sans and platform sans-serif fallbacks.
- **Label/Mono Font:** The same sans family for labels; system monospace is reserved for inline code and technical values.

**Character:** A neutral, highly legible sans keeps controls and transcripts quick to scan. Display and body use the same family; size, weight, and spacing create hierarchy rather than a decorative pairing.

### Hierarchy

- **Display** (700, 40px, 1.15 line-height, -0.025em tracking): Global h1 scale where a page title is genuinely the display heading.
- **Headline** (600, 1.15 line-height, -0.025em tracking): h2 through h6; size is assigned by the specific screen.
- **Onboarding title** (500, 32px, 1.2 line-height): Main setup-step heading.
- **Body** (usually 12–16px in controls and workspace copy): Short labels and supporting text use compact Tailwind sizes; `.brand-body` uses a 1.6 line-height when applied.
- **Label** (500, 13px; section labels may be 10px uppercase with 0.08em tracking): Sidebar items, section names, and secondary controls.

### Named Rules

**The One-Family Rule.** Use the bundled Inter/Noto Sans system for interface text; create hierarchy through scale and weight.

## Layout

The desktop shell pairs a 208px sidebar with a flexible content area. The main workspace sits 8px inside the window, inside a 12px-radius frame. A 48px top bar carries the current view, centered search, and view actions. Page content commonly centers at a maximum width of 64rem. The sidebar can collapse or disappear in narrow note and meeting side-panel layouts; the window content keeps its own scroll region. Onboarding uses a narrower 48rem content column, wider side padding at larger window sizes, and a persistent progress header and footer. The onboarding shell pins `html`, `body` and `#root` to the window, so only the middle scrolls. On macOS the header keeps 84px of physical left padding (also in RTL) to clear the traffic lights. Spacing follows Tailwind’s 4px base scale, with common 8, 12, 16, and 24px intervals.

## Elevation & Depth

Depth is layered: light mode uses a subtle card shadow and restrained hover lift; dark mode relies on stepped Plum Night surfaces, quiet borders, and soft inner rims, with stronger shadows reserved for overlays. Orange live surfaces carry a fine top highlight and inset rim. Focus rings, selected-model glows, and modal shadows remain state-specific.

### Shadow Vocabulary

- **Card at rest:** `0 1px 3px oklch(0 0 0 / 0.2), inset 0 1px 0 oklch(1 0 0 / 0.03)` in dark mode; light cards use the component's subtle `shadow-sm` treatment.
- **Card hover:** `0 4px 12px oklch(0 0 0 / 0.25), inset 0 1px 0 oklch(1 0 0 / 0.04)` in dark mode; light cards may rise by 1px.
- **Brand glass rim:** `inset 0 1px 0 rgba(255,255,255,0.6), inset 0 0 0 1px rgba(255,255,255,0.16), inset 0 -1px 1px rgba(0,0,0,0.12)` on orange actions and brand surfaces.
- **Elevated overlay:** `0 8px 24px oklch(0 0 0 / 0.3)` for elevated surfaces; modals use a larger 24px / 48px shadow.

### Named Rules

**The Layered-Not-Floating Rule.** Separate adjacent work areas with tone and borders first. Reserve stronger lift for overlays and deliberate hover states.

## Motion

One language for every surface. **Hue is mode, shape is locality, motion is progress.**

| Token                                          | Value                         | Use                                                                                                   |
| ---------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `--motion-instant`                             | 90ms                          | press, colour change                                                                                  |
| `--motion-fast`                                | 150ms                         | hover, label swaps, tooltips                                                                          |
| `--motion-base`                                | 240ms                         | surface enter, toast, chip                                                                            |
| `--motion-slow`                                | 360ms                         | morphs, panel growth                                                                                  |
| `--motion-hero`                                | 520ms                         | spring settle (visual length)                                                                         |
| `--motion-flash`                               | 1400ms                        | one-shot landing flash on a searched setting; animates a registered property, ended by `animationend` |
| `--motion-ease-std`                            | cubic-bezier(0.2, 0, 0, 1)    | movement and morphs                                                                                   |
| `--motion-ease-enter`                          | cubic-bezier(0.16, 1, 0.3, 1) | things arriving                                                                                       |
| `--motion-ease-exit`                           | cubic-bezier(0.2, 0, 0.4, 1)  | things leaving, at ~70% of enter                                                                      |
| `--motion-spring-snap` / `-settle` / `-bounce` | CSS `linear()`                | press release and morphs / panels / success only                                                      |

Rules:

- Loops take their timing from these tokens. A rotation stays `linear`, because an eased spin stalls once per turn. Under reduced motion, keyframes stop except opacity-only loading cues (`.progress-pulse`), which keep running.
- First feedback within 50 ms.
- At most two focal motions at once.
- Animate only `transform`, `opacity`, `clip-path`, `filter` and registered properties.
- Loops run only while their state is active and the window is visible.
- Every motion has a non-motion twin (shape, label or colour).
- Never ease-in.

## Shapes

The radius scale is compact: 4px minimal, 6px standard controls, 8px cards, 10px larger cards, and 12px for the inset workspace shell. Primary actions, search, and badges use full capsules. Borders are thin and neutral at rest; active and focus borders take the orange accent. Large 24px corners belong to the animated voice and assistant panels, not ordinary cards.

## Components

### Buttons

- **Shape:** Capsule for text actions (9999px); icon-only buttons use a 6px radius.
- **Primary:** Default buttons are ink capsules with a leading orange dot; `live` buttons use the orange glass surface with ink text and are reserved for voice controls. 40px default height and 16px horizontal padding.
- **Hover / Focus:** Hover shifts the fill of the ink CTA (`--color-cta-hover`: a step lighter in light, a step darker in Plum Night) and the orange glass (`--gradient-brand-glass-hover`); press goes deeper (`--color-cta-active`, `--gradient-brand-glass-active`). Feedback is a fill change, never a CSS filter or opacity, because a filter would recolour the box-shadow focus ring. Keyboard focus uses a 2px visible ring with a small offset; pressed controls scale slightly to confirm activation.
- **Secondary / Ghost / Tertiary:** Outline and secondary buttons use muted fills, thin borders, and restrained shadow; ghost actions gain a muted surface on hover, while link actions remain text-first.

### Chips

- **Style:** Status and category badges are small full capsules. The default badge uses a translucent orange fill and orange text; secondary and status variants keep their own semantic colors.
- **State:** Focusable chips use a visible ring. Selected model and provider states use a subtle orange-tinted surface and border. Model cards are radios in a labelled radiogroup with one tab stop, on the selected card. The whole card is the hit area. Arrow keys move focus between cards; only Enter, Space or a click selects, because selecting can switch the provider. A not-yet-downloaded local model is `aria-disabled` but still focusable. Model identity retains up to 60% of the row without shrinking; long descriptions truncate before squeezing the identity, while status and actions remain visible. Card actions (delete, download, cancel, Learn more) keep their own names; delete appears on hover or keyboard focus.

Route chips (Settings) follow the same pill shape at 24px and pair a glyph with words. See Settings.

### Toasts

- **Announcement:** standard toasts are polite status regions (`role="status"`); destructive toasts are assertive alerts (`role="alert"`). Dictation-error cards already announce as alerts.
- **Close:** always visible at 50% opacity, full strength on hover or keyboard focus, with a 2px `--color-ring` focus ring and a translated name.
- **Timing:** dictation errors stay 6, 8 or 10 seconds by length; a card that holds the user's only copy of a transcript stays until the user acts. Plan 04 replaces this surface with `notify()` and keeps both rules.

### Cards / Containers

- **Corner Style:** 8px on the shared Card primitive; 8–10px on grouped panels and setup cards.
- **Background:** White cards in light mode; Plum Night card tokens in dark mode.
- **Shadow Strategy:** A faint resting shadow; dark mode adds a low-contrast top rim and soft shadow. The `.card` utility may lift 1px on light hover, while dark cards change border and shadow without moving.
- **Border:** One-pixel neutral border; active or selected panels may tint the border with the orange accent.
- **Internal Padding:** Common card headers and contents use 24px; compact setup rows use 16px.

Model cartridges are 10px-radius tonal cards. The hover lift applies in light theme only, and selection is a 2px `--color-ring` border.

### Inputs / Fields

- **Style:** Full-width 40px fields with 6px corners, compact sans text, and a one-pixel `--color-input-border` edge (#858585 light, #8C6B7B Plum Night) that clears 3:1 on every surface a field sits on. Hover does not lighten the edge.
- **Focus:** A full-opacity 2px `--color-ring` ring with a 1px gap, drawn by the unlayered native-field rule in `src/index.css` so no utility can weaken it. The border turns `--color-ring` too.
- **Error / Disabled:** Errors use the separate destructive color; disabled fields lower contrast and disable pointer interaction.

### Navigation

- **Sidebar:** 208px wide, with 36px rows and 13px labels. The active item uses a quiet foreground-tinted surface and a 2px rail in the nav-marker colour (orange in the light theme, magenta #E6007A in Plum Night); the active icon takes that same colour while inactive icons remain subdued.
- **Settings sidebar:** the current section carries `aria-current="page"`; every item shows a 2px full-opacity `--color-ring` focus ring, inset because the list scrolls. Compact (icon-only) items are named by their label.
- **Provider tabs:** a real tablist. Arrow keys (reversed in RTL), Home and End move focus across enabled tabs; Enter, Space or a click selects. Focus alone never switches provider, local or remote. Tabbing into the list lands on the selected tab (WAI-ARIA tabs pattern). A saved key shows as a small dot with screen-reader text.
- **Top bar:** A 48px draggable Electron title area with centered capsule search and platform-appropriate window controls. macOS clears space for traffic lights when the sidebar is collapsed; Linux displays the app window controls.
- **Narrow layout:** The sidebar collapses for focused note and meeting side panels; a back control replaces it.

### Voice Pill

The persistent dictation control is a compact bordered capsule with a waveform and voice identity mark. Recording and processing remain legible through waveform and control state; assistant thinking can add a restrained glow. The pill expands into the assistant or live-transcript surface with 24px corners, then contracts back to the same anchor. Dictation thinking glows in the logo gradient (#FF8A5C → #FF5A1F → #D90078); Agent Mode thinking glows violet (#8787FF). Blue is not a Loqui state colour.

### Onboarding

Setup puts the first successful dictation before optional personalization. Its steps are Welcome, Voice, Say something, Cleanup, Shortcut, then Ready. Progress is grouped into “Get dictating” (Welcome, Voice, Say something) and “Make it yours” (Cleanup, Shortcut); Ready is a summary rather than a progress step. The step graph and phase labels live in `src/utils/onboardingFlow.ts`, with step names and progress strings under `setupFlow` in every locale. Preview scenario choices come from the same shared list used to validate preview URLs. Persisted progress remembers only previously visited step IDs, so users can return to an earlier step without making future steps appear complete.

### Settings

**Routing is one model, drawn three ways.** `src/lib/routeGraph.ts` (pure, Node-loadable) resolves all 11 tasks, and `src/lib/routes.ts` adds the snapshot builder and hooks. Settings → Routing (the Patchbay), the editors' mode selectors and the voice pill use `ResolvedRoute`; the keyring exposes the main-owned credential health and recipient descriptions that supply route facts. Never compute "is this local?" or "is this ready?" anywhere else. Readiness reuses the executors' own validation, and a fact main has not confirmed reads `unknown`, never Ready.

- **Route chips.** A state is a glyph plus words, never colour alone: Ready, Off, Checking…, Download 1.3 GB, Choose a model, Add API key, Choose a provider, Add server URL, Paused · Sealed mode, Service retired · choose again, Not available for this task, Can't reach the server. Ready and "on this device" use `--color-locality-device` for glyph and words. Needs-attention states (key, URL, retired, unsupported, unreachable) put `--color-destructive` on the glyph only; their words stay foreground, because destructive text is 4.43:1 on the chip fills. Off, Checking and Sealed are muted.
- **Patchbay.** Task buttons sit on the left and destinations on the right. The cables are decoration (`aria-hidden`): solid for this device, dotted for your server, dashed for a provider. They fade in once (`--motion-base`) and never loop. Below 720px of board width the cables hide and the lists stack.
- **Asymmetric friction.** Every provider, model, mode and endpoint change goes through the route planner (`routePlanner.ts`), and so do the switches that turn a route on (cleanup, translation, assistant, screen context, the vision override), the Corti region and provider web search. Turning a route off is instant; turning one on, adding web search, or a switch that moves screenshots to another recipient is staged when the data leaves the device. It simulates the write on a copy of the settings and resolves all 11 routes before and after, so the preview, the commit and Undo are the same patch. A change whose result stays on this device, or keeps the same recipient with no new payload (another model at the same provider), applies at once with an Undo toast that names the task. A change to an active Corti speech tenant, Vertex project or authentication source also requires review even when the host stays the same, because the recipient account/source changes. A change that adds a recipient or a payload is staged: the radio shows "Staged, not active", a dashed panel asks for the provider, key or address, and the sticky bar lists every route the change touches, including inherited ones. Apply (the ink capsule, ⌘↵) is the only primary action and re-plans from live settings at click time. Closing Settings discards the draft. Undoing a move that would reach a remote recipient is staged again, never applied silently.
- **Keys.** Key state is what main confirmed: saves are acknowledged, raw drafts stay only in the editing control and never enter the settings store or IPC responses, and an unconfirmed key is not Ready. Verifying a key is always a button that names the receiving host, because it sends the key. Results and request coalescing are bound to the committed credential generation and a main-generated fingerprint of the complete non-secret request configuration, including Corti tenant/path. A replaced credential or different configuration cannot inherit an old verdict. Removing a key can be undone for 8 seconds. Listing a server's models is a separate button that names the host and the credential slot it sends. Provider verification, authenticated discovery and Codex listing require explicit buttons; none runs on mount, tab browsing, typing or blur. The self-hosted Test is a separate user-initiated unauthenticated probe with no headers.
- **Committed authority and reviewed recipients.** Main lists metadata for all 23 credential slots while the published `CredentialId` union remains 16 identities. Multi-field saves/removals and Undo preserve coherent committed state, invalidate health on generation changes, and share the existing reset barrier; failed persistence never publishes a successful save. Enterprise settings and environment facts arrive together as `{ current, version, facts }` via `getEnterpriseRouteState` and `onEnterpriseRouteChanged`. The renderer admits monotonic complete tuples, and only `applyRoutePatch` sends the atomic `saveEnterpriseRoutePatch` CAS before publishing companion writes. New requests use per-route epochs; Discard/close end the session, and Undo also checks every coupled route. Both supersession codes suppress stale outcomes. Staged target/patch refinements preserve setup and inherited vision behavior while exact draft ownership and `draftIdentity` protect newer text. Re-picking the current destination still settles the planner request before already-using feedback.
- **Verification and discovery consent.** Main issues sender-bound `recipientToken` values through `keyring.describeVerify` (`{ hosts, fields, recipientToken? }`) and `personalInference.describeModels`. At an explicit click the renderer captures the displayed token and immutable options **before** flushing pending secret saves; main waits for committed credential capture and revalidates the token/configuration before dispatch. Changed recipient/presence/generation refuses and requires a fresh reviewed click; displayed no-key discovery cannot silently upgrade to sending a key. Enterprise Test uses `keyring.verifyConnection` with the reviewed model/deployment and token, a frozen main-owned configuration, one short probe with at most 16 output tokens, zero retries, and one overall 12-second cancellation budget through file/auth/transport waits. Explicit verification and its token exchanges refuse redirects. Dedicated Bedrock Test supports parse-once selected static AWS profiles; dynamic chains/process/SSO/login/web-identity/metadata sources fail closed as unsupported. Dedicated Vertex ADC Test supports captured file-backed `service_account` and `authorized_user` credentials only; dynamic/external/workload/metadata sources fail closed. Descriptions do not open credential files; external contents are captured at the click-time execution boundary. These bounded Test policies leave normal chat/profile/ADC execution unchanged.
- **Sealed handoff.** `src/stores/sealedStore.ts` is the single renderer authority; unknown currently maps to false. `RouteSettingsSnapshot.sealed` remains a required boolean, and off routes remain off while non-device routes, including LAN, resolve sealed when the snapshot says so. Main `IPCHandlers` accepts `managers.isSealed` with a default `() => false` and passes it to keyring verification after credential waits. Plan 07 must supply the authoritative predicate at `new IPCHandlers({ … })` and migrate this store. Plan 07 remains **BLOCKED under D16**: this default-false seam is not a working seal or a zero-egress guarantee.
- **Model cartridges.** Cards sit in a 2-column `radiogroup` with one tab stop. Arrows move focus between cards (left and right swap in RTL) and never change the model. Enter, Space or a click selects a downloaded model; a download starts only from the card's Download button, never from moving or pressing Enter on a card. A local pick goes through the route planner like any other model change. Speed, Quality and Memory use 5-pip meters labelled "{label} N of 5", filled with `foreground/70`, never orange. Orange is only the selected card's 2px border. The download button is outline, except on the Recommended card.
- **Storage.** Count before you delete, with the same main-owned predicate for the count and the deletion. An unreadable count is an error, never zero. Row triggers are outline buttons with destructive text on `hover:bg-background`. Solid destructive appears only inside a confirm, and that confirm repeats the count, size and folder; deleting history also deletes every audio file, so its confirm counts both. Opaque main-generated audio/history identities bind the reviewed set as well as counts; equal-count replacements stale the confirmation. Only reviewed recordings are deleted, and new arrivals or unknown recounts cannot become cleared success. Model selections clear only after every family succeeds and a complete known-zero recount. A partial failure keeps the dialog open with `role="alert"` and exact counts. Reset requires typing the localized word.
- **Search.** ⌘F or Ctrl+F focuses it, and `/` does when you are not typing. Results replace the pane (the page stays mounted), grouped by section with a breadcrumb. Appearance, sound, notification, clipboard and retention settings carry a live control. Anything that feeds a route (cleanup, assistant, translation, screen context, speaker labels, every provider, model and URL) navigates, so route changes still pass through the planner. Enter jumps and flashes the row once (`--motion-flash`, ended by `animationend`); reduced motion keeps only the outline. A new jump, query, close or unmount cancels its owned pending or landed cue; normal uncancelled timing stays in CSS.
- **Nav and title.** Nav items carry a one-line description at 11px when the sidebar is wide and a tooltip in the icon rail. The content column has a sticky title and a 32px close target at 70% resting opacity and full keyboard-focus opacity so its focus ring stays readable.
- **Escape order.** A hotkey being captured owns Escape. So does any widget that holds transient state while focus is inside it and marks itself `data-escape-active="true"` (the Patchbay selection, the Settings search query; `escapeClaim.ts`). Escape clears that state first, and the next Escape closes the dialog.

## Do's and Don'ts

### Do:

- **Do** use the ink CTA for everyday actions, Signal Orange for live voice, and the deeper orange nav marker for current navigation state in the light theme; in Plum Night, magenta marks current navigation.
- **Do** use Electric Fuchsia as a supporting accent, keeping the two roles distinct.
- **Do** preserve the Plum Night surface steps and soft rims when adding dark-theme surfaces.
- **Do** use compact controls, clear labels, and the existing visible focus treatment.
- **Do** adapt window controls and traffic-light clearance to the host OS while keeping the shared React interface coherent.

### Don't:

- **Don't** drift into generic AI-dashboard styling or decorative marketing-page chrome.
- **Don't** swap orange and fuchsia roles or make both accents compete for the live-voice signal.
- **Don't** rely on shadow alone to distinguish dark surfaces; use the existing tonal layers and borders.
- **Don't** use movement as the only cue for recording, processing, selection, focus, or error states.
