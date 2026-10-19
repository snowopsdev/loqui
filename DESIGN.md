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
- **Onboarding title** (650, 36px, 1.1 line-height, -0.025em tracking): The setup rail heading; 22px in windows under 760px.
- **Body** (usually 12–16px in controls and workspace copy): Short labels and supporting text use compact Tailwind sizes; `.brand-body` uses a 1.6 line-height when applied.
- **Label** (500, 13px; section labels may be 10px uppercase with 0.08em tracking): Sidebar items, section names, and secondary controls.

### Named Rules

**The One-Family Rule.** Use the bundled Inter/Noto Sans system for interface text; create hierarchy through scale and weight.

## Layout

The desktop shell pairs a 208px sidebar with a flexible content area. The main workspace sits 8px inside the window, inside a 12px-radius frame. A 48px top bar carries the current view, centered search, and view actions. Page content commonly centers at a maximum width of 64rem. The sidebar can collapse or disappear in narrow note and meeting side-panel layouts; the window content keeps its own scroll region. Setup is a pinned window: a 56px header with per-phase progress, a 36% orange rail beside the controls (a 72px banner under 760px), and a 64px footer that wraps to at most two rows at 200% zoom or with long translations. The onboarding shell pins `html`, `body` and `#root` to the window, so only the middle scrolls. On macOS the header keeps 84px of physical left padding (also in RTL) to clear the traffic lights. Spacing follows Tailwind’s 4px base scale, with common 8, 12, 16, and 24px intervals.

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
- **Setup placement:** the mounted onboarding footer reserves its measured top edge in the nearest `ToastProvider`. Standard workspace toasts keep their usual 20px gap above that edge, including when footer labels wrap or the window resizes. Each shell releases its own reservation on unmount; existing notices survive and return to the default workspace position. Dictation-panel toast and error-card anchors retain priority.

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

In the browser preview, the setup shell fills the content area below the retained preview toolbar. Native setup keeps its full-window `100dvh` height.

The setup rail is the instrument: the five bars of the mark breathe when idle, fill bottom-up with the voice download, follow the microphone while listening, and drop to 30% on error (ink on the light rail, warning amber on Plum Night, both at least 3:1). On the first successful dictation the live bars settle into the mark's silhouette (`--motion-hero`), the speech bubble draws around them (`--motion-slow`), and then the mark docks into the 32px header tile (View Transition), where it stays for the rest of setup. A numeric caption sits under the bars, so progress is never motion-only. Light theme: orange rail (`--color-live`), ink text, paper bars. Plum Night: a warm surface gradient with orange-to-magenta bars. Active progress uses `--color-nav-marker`. Primary actions are the neutral ink capsule; `live` is reserved for record, stop, "Allow microphone", the ready-block mic and "Dictate into a note". Readiness icons use `--color-success` and `--color-warning`; their words stay in foreground colours.

Setup puts the first successful dictation before optional personalization. Its steps are Welcome, Voice, Say something, Cleanup, Shortcut, then Ready. Progress is grouped into “Get dictating” (Welcome, Voice, Say something) and “Make it yours” (Cleanup, Shortcut); Ready is a summary rather than a progress step. The step graph and phase labels live in `src/utils/onboardingFlow.ts`, with step names and progress strings under `setupFlow` in every locale. Preview scenario choices come from the same shared list used to validate preview URLs. Persisted progress remembers only previously visited step IDs, so users can return to an earlier step without making future steps appear complete.
Voice and cleanup choices share `RadioCardGroup`: a named radio group with card and segmented variants, one enabled tab stop, and visible disabled reasons linked by `aria-describedby`. Arrows select and move actual focus, skip unavailable options and wrap; horizontal arrows follow the document reading direction. Home/End reach the first/last enabled choice. Selection, disabled copy and focus use shared colour tokens; keyboard focus remains visible. Callers supply translated labels and content. The shared renderer test tree retains its Plan 02 API (`props`, `find`, text and label clicks), adds focus/selectors/key events, and backs the component mount helper. Its unknown API proxy is test-fixture convenience only; unsupported bridge tests must use the real contract or explicit negative boundaries.
Segmented selection has a persistent 1px inset edge in `--color-foreground`, clearing 3:1 against both its card fill and muted track in light and Plum Night. The inset preserves geometry; the separate focus ring can leave the group without hiding the selected choice.

Recovery uses one `RecoveryCard` alert with a title, a single explanatory body and caller-translated actions. Warning colour belongs to its icon and subtle surface; copy uses foreground/muted-foreground tokens, and the neutral tone uses the card surface. Actions use the shared button variants and visible keyboard focus. The component owns no permission or route authority.

`useMicrophoneAccess` observes the existing preload permission APIs on mount and exposes explicit check/request actions. Access is unknown until evidence grants or denies it; absent/rejected checks and requests stay unknown. Denied access enables a focus recheck and a two-second poll, removed on recovery or unmount. A local operation counter prevents older asynchronous replies from replacing newer observations; effect cleanup invalidates pending state updates. macOS/Windows help uses microphone privacy settings, Linux uses sound-input settings. This adds no provider calls, recording, credential handling or trial ownership.

Hello asks for microphone permission through an explicit “Allow microphone” action. A confirmed grant enables an analyser-only preview: no recording, playback, storage or provider work. The meter and rail follow the same input level. Opening, live and failed states remain distinct; a failed open can retry while permission is still granted. Leaving, changing inputs and partial setup failure release every stream, analyser context, timer and device listener, including a stream that resolves after its owner leaves. Silence below the shared voice floor for 2.5 seconds highlights the input picker, and speech clears the hint.

Hello’s picker reads and writes the existing dictation microphone mode, device ID and label. It offers system default, a detected built-in input and concrete inputs; the shared resolver recovers a uniquely labelled replugged device and discloses a missing saved input’s system fallback. Voice evidence is scoped to the listening selection and is invalidated on a device change. Full route/take proof belongs to the trial and Ready integration. “Get started” advances once to Voice; “Look around first” exits through the existing completion path. Privacy/history and automatic-update defaults appear under Ready, retaining their existing settings and update IPC. Preview design 02 renders the same `OnboardingFlow` as desktop. The legacy welcome and guided stylesheets have been removed.

The Voice step’s detected pick comes only from OS locale preferences and advisory free disk space (`src/utils/onboardingDetection.ts`); it never infers language from speech. A low-space result is informational because Electron main remains the download-admission authority. Language edits keep a compatible voice, choose a compatible catalog voice when available, or clear the choice.

Voice renders four advisory system signals, a catalog-labelled on-device recommendation and a closed-by-default voice picker. Viewing, opening the picker and changing a candidate do not commit settings or start a download. The explicit primary commits only dictation’s local mode, NVIDIA engine, model and reconciled spoken/preferred languages through the existing settings setters; meeting and upload routes retain their choices. All spoken languages must be supported. Model and language changes are locked during transfer, installation and pending cancellation, with disabled reasons.

`VoiceDownloadPanel` reuses `useVoiceDownload` and Plan02’s `DownloadProgressBar`: numeric progress, observed speed/ETA, received bytes, Cancel, main-confirmed cancellation and retained-progress Retry. Off-step status uses a truncating `DownloadChip`; no timer invents readiness. Reduced motion uses opacity-only signal entry and a static ring; hidden or docked decorations stop while numeric progress stays available. The old speech body, duplicate download hooks/timers and footer chip are removed.

An installed candidate is not the active recording route. `localVoiceActive` also requires the actual committed NVIDIA/model selection and Plan03’s resolved dictation route to be ready on the device with no configured host. Unknown facts or a retained remote/self-hosted route cannot mount the legacy trial or mark speech ready. Tasks15/18 must preserve this seam while binding fresh voice/device/take proof. Task22’s Plan04 cancellation/Undo integration remains separate. New Task13 copy is English placeholder text in all eleven locales until Task20; native-speaker review remains outstanding.

Voice recommendations use main-owned system facts: up to eight OS preferred languages, free space at the model cache (or its nearest existing parent), and Apple silicon or NVIDIA hardware. The typed `getSystemProfile` bridge returns these advisory facts once per launch; unknown disk/GPU facts remain null/unknown. Memory is composed separately from the existing `getTotalMemory` bridge. Setup does not persist or send these values: main requests GPU detection with per-call quiet diagnostics, including nested NVIDIA path discovery and Windows fallback, without changing shared logger state or GPU caches. Other callers retain their existing diagnostics. Main remains responsible for current disk admission when downloading models.

Setup demo events carry main's admitted demo/take identity from preparation through recording callbacks. A current microphone failure reaches setup before listening; stale starts, errors and results cannot open or populate a later demo. Leaving or cancelling uses the existing preparation and active-recording cancellation paths. Shortcut demos mirror actual dictation-key presses without recording; shortcut capture mode is excluded centrally while native capture forwarding remains available. Trial controls use typed preload IPC. Before Plan 04's shared cancellation bridge lands, discard has no Undo; Task 22 owns that integration. Rich setup demo events remain separate from the workspace capture lifecycle strings.

Setup recordings remain private across completion and restart. Privacy is captured at prepare/start admission, before visual or microphone waits, and travels with the existing recorder and processing pipeline. Success, silence, failure, cancellation and leaving setup create no history, retained audio, analytics, paste or clipboard writes, even when retention is enabled. Demo success preserves raw words and reports cleanup as applied, skipped or failed; empty results report `NO_AUDIO`, and microphone denial retains its stable error name. Until Plan04 integrates, cancellation says “Discarded.” without Undo authority.

The overlay follows the live `onboardingCompleted` flag and fails closed when storage is absent or denied. A policy change affects future admissions without replacing a live manager. Pending work keeps its original manager and audio snapshot; a delayed public save persists only its captured audio and cannot clear a newer recording. Task22 must migrate the temporary Blob identity guards and privacy context into Plan04’s sole owned-audio setter, snapshot savers and private hold/restore contract. No Plan04 lifecycle or hold is supplied here.

Streaming warmup and start assemble dictionary hints with the existing selected provider/model keyword rule and session-options builder; provider adapters retain their vocabulary limits. Startup privacy tests execute the real admission, audio pipeline and IPC adapter through injected hardware/transport boundaries.

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

### Onboarding trial reducer (Plan 05 Task 6)

The setup trial is a pure reducer over admitted `OnboardingDemoEvent` values. Its local numeric take counter keys cleanup retry results only; main's `demoId`/`takeId` correlation remains the transport authority upstream. A cancelled recording reports “Discarded.” without Undo until Plan 04's shared cancellation contract is integrated. Empty successes become `NO_AUDIO` errors, while successful results retain both displayed cleaned text and original raw words.

### Onboarding download facts and notices (Plan 05 Task 7)

Setup reads transfer state from the real per-model download hook. Changing the
selected voice starts a fresh installation check; old status replies cannot make
the new selection ready. A completion keeps its active entry until the matching
status refresh settles. Cancel stays pending until main acknowledges it, and a
confirmed cancellation offers a restart after the original transfer settles.

Speed and ETA use a five-second window of byte samples. A one-second active tick
ages a silent stall into an unknown estimate. Only quarter milestones are exposed
for the later live-region consumer. Formatters supply locale-aware MB/GB values
and rounded ETA parts; all new copy lives under `setupFlow` in the 11 locales.
Incremental English placeholders remain for Task 20 to translate.

Main alone attests retained progress. The renderer keeps that evidence and sequence
watermarks per model even when another voice is selected; starting a new attempt
resets only that model's measurement and retained-byte facts. Exhausted network
failures retain the real partial file for a subsequent Range request; cancellation,
HTTP, TLS and size failures discard it. This shared downloader behavior also applies to Whisper and
local LLM downloads. An accepted Stop during failure teardown, including a pending
retained-byte stat, supersedes the network failure and discards the partial only
after the writer closes, reporting cancellation with zero kept bytes. No renderer
disk or provider authority is added.

Pure onboarding notice builders use the spec §5.3 input shape. Until Plan 04 lands,
`useOnboardingNotifier` alone maps it to the existing toast API, whose duration 0
keeps the failure and Retry visible until dismissal. The second merger replaces
that adapter with the real `notify` and removes its Variant A mapping test;
Plan 04 notice types, Undo and Sealed contracts remain outside this task.

### Onboarding preview bridge (Plan 05 Task 8)

The development toolbar owns scenario selection and simulated shortcut presses. Its in-memory bridge satisfies the real preload types and feeds the same download hooks as desktop: catalog-specific totals, singleton admission, monotonic progress and retained network bytes. Trial events preserve their admitted demo/take identity and deny microphone acquisition before listening. Reset/cancel settle owned work; cancellation is discarded without Undo while Plan 04 holds remain absent. The legacy Speech preview presentation remains until Task 13. No recording, provider call, credential access or workspace lifecycle authority is added.

### Onboarding tour and trial stage (Plan 05 Task 14)

Say something keeps the real VoiceDownloadPanel above a labelled three-slide
carousel until the explicitly committed local Voice route is ready. An installed
candidate never admits a trial: skipped Voice offers Choose a voice, and unknown
Plan03 route facts remain Checking. Restart only retries the committed voice.
The existing guarded trial remains the stage's child until Task 15 replaces it.

The tour has one visible, accessible slide, previous/next buttons and labelled
dots using the nav-marker token. Arrow keys follow reading direction. The
dot buttons keep a fixed 36px hit target; selection changes the static inner
marker without animating layout or shifting neighbouring controls. The arrival
uses the approved shared spring-snap token. The
four-second timer and decorative keycap demo stop under reduced motion, while
hovered or focused within, when the page is hidden, after Skip and on unmount.
Focus moving between tour controls keeps it paused; leaving one pause source
does not clear another. Skip leaves a quiet waiting line. Hidden and docked
keycap art does not loop. Reduced pressed/demo/flash combinations retain static
colour and shadow feedback without transforms or keyframes.

The motion-preference hook is hoisted across all flow steps and releases its
subscription on unmount. A ready stage pops in once after an observed transfer,
never from a cold installed-status check. Model-keyed presentation attempt IDs
extend useVoiceDownload without replacing its download, sequence, kept-byte or
cancellation owners. The single shell announcer publishes each quarter milestone
once per attempt, then completion. Each newly observed active period, including
a restart by another owner, resets percentage history and atomically pairs its
new presentation ID with its recomputed milestone. Low initial progress cannot
expose or consume the prior attempt's milestone. Off-step completion/failure goes through
Task 7's sole adapter; inline Voice/Try failures create no alert. Cancellation
pending/refused is not terminal. Failure Retry retains its original model and
requires that model still be committed and selected, otherwise it returns to
Voice. Existing cancellation toasts and measured footer placement remain intact.

### Captured onboarding cleanup authority (Plan 05 Task 15 foundation)

The original overlay AudioManager admits a cleanup operation synchronously with
its string demo/take identity, before microphone, visual, import or credential
waits. It captures the selected nonsecret provider/model/endpoint, prompt,
dictionary, language, thinking/output options and final script conversion. The
first text admission fixes the wrapped sentence and word count. Both the first
cleanup and Retry execute this same retained request. A settings change cannot
retarget it or introduce a remote fallback for an admitted device model. Main
checks the actual loaded local model again before text-bearing preflight or
inference dispatch, including after joining an existing server startup.

Main's separate text-operation registry captures committed route/version and
credential generation at IPC entry, waits for admission/committed credentials,
and revalidates after each factory/auth wait and before transport. Credentials,
ADC content, profile keys and provider tokens remain in main. SDK construction
uses captured inputs, including captured ambient endpoint defaults and retained
OpenCode session headers. Discovery recipient tokens remain sender-bound and
retain their existing Verify semantics
and twelve-second budget. Cleanup uses its normal per-request timeout; its
capability expires after five minutes with no automatic renewal.

Public typed contracts are in `personalInferenceTypes.ts` and `electron.ts`:
`captureTextOperation(descriptor)` returns an opaque sender-bound token;
`runTextOperation({token, request})` accepts one user message plus its original
word count; `retireTextOperation(token)` invalidates it. Local callers use
`processLocalReasoning` with `textOperationToken` and `wordCount`; main supplies
the admitted model/config, ignoring the later model argument. The reusable
renderer runner `createCapturedCleanupOperation` exposes `run(text)` once,
argument-free `retry()`, and `retire()`. Refusals preserve original words and
carry stable, localized safe errors, never provider response bodies.

Setup receives only `cleanupOperationId` on a main-validated demo success event.
It calls `retryOnboardingCleanup({demoId, takeId, operationId})`. Main validates
the actual setup sender/current take/original overlay, forwards a nonce-tagged
request via `onOnboardingCleanupRetry`, and accepts only the original overlay's
matching `replyOnboardingCleanup`. Setup never receives the inference token or
rebuilds the sentence. Duplicate in-flight retries and stale replies are refused.
Failed cleanup remains retryable after that same take's success while its demo
and owners remain current. Replacement, cancel, leaving Try/demo teardown,
either owner destruction and disposal retire eligibility and abort active
inference. Pending replies cannot mutate a newer operation or clear its audio.
This extends the existing recorder/private saver and inference cancellation
owners; it adds no audio hold, recording session or Undo framework.

Supported captured paths include ordinary API-key/custom/LAN providers, explicit
local models, Azure, Vertex API keys, strict Vertex service-account/authorized-user
ADC files, and Bedrock explicit keys/static selected profiles. ADC and profile
content is read once into main memory and never reread on Retry. Dynamic Bedrock
profiles/ambient chains, unsupported Vertex ADC/metadata sources, Codex app-server
account binding and Tinfoil's SDK bootstrap currently return source-specific
unsupported errors. Generic chat and Verify retain their previous defaults.
The typed in-memory preview bridge exercises request retention, local routing,
duplicate refusal and retirement without provider, auth or microphone access.

This commit is the authority foundation only. The following Task 15 UI subtask
must retain the event's string take/operation identity, request Retry through the
relay, and gate late results to that identity. Task 16 must capture a fresh
setup-owned operation after new named-provider/count consent. Task 22 composes
retirement with real Plan 04 tags/owners after integration; no Plan 04 session,
Undo, Sealed or attestation contract is asserted here.

### Onboarding trial observation and current proof (Task 15)

Say something observes the existing private overlay recorder through typed preload
IPC. Each effect activation, including StrictMode replay, creates a fresh demo ID.
Main announces its admitted string take ID as `preparing`; that announcement never
renders a recording state. Main rejects setup-originated publish attempts; only the matching overlay's `listening` event starts
the meter. Current acquisition failures are actionable before listening. Duplicate,
out-of-order, retired-demo and previously admitted old-take events cannot count another success.
Optional IPC absence, false acknowledgement and rejection leave a safe recovery
state. A refused control keeps an already observed recording/processing state
and its Stop/Discard actions until a genuine event settles it; late control
responses cannot replace a newer take. Leaving ends the exact demo through the existing cancellation owner.

A trial requires the selected voice's committed, ready Plan03 device route, with
no host and the matching model. The original overlay records nonsecret STT/model,
language/script and microphone choices before any await. Setup passes its admission
fingerprint to detect cross-window drift. Dispatch checks refuse changed choices
after waits; a pinned microphone delivered by another device fails before
listening. New setup trials refuse automatic default-device retry. Existing
private recorder fallback and snapshot savers retain their prior ownership. This
metadata is proof, not credentials, readiness authority, a recording session, or
an audio/cancellation manager. Completed proof belongs to its original context;
changing a route/device leaves current setup unproven while historical words stay
available for the later Cleanup step. The interim Finish microphone row requires
that current matching trial, never a historical success count. Its shortcut row
accepts either a completed mirrored press in Shortcut or a matching successful
hotkey take in the current voice/device context, with current main binding
acknowledgement; permissions alone cannot prove a new binding. Task18 replaces these
interim rows with the final configured/proven summary.

`getDictationBinding` reads the registered main hotkey slot and acknowledged
activation mode, excluding a constructor preference with no registered callback.
Real hotkey events and admitted takes carry this binding and main-owned origin.
A button take never proves a shortcut; another binding/mode needs another test.
Keycap down/up/tap feedback deduplicates repeats and a synthetic tap while held.
Accessibility grants require actual `true`, a current observation and active
mounted lifetime. Unknown, absent and rejected checks cannot mark macOS ready.

The trial retains `{demoId, string takeId, operationId}` from main's validated
cleanup event. Retry requests that original overlay through the reviewed relay;
no settings or text are reconstructed. The reducer's numeric retry counter stays
separate. Running duplicates and late/wrong-operation replies cannot replace a
new take. Missing, retired, unsupported and changed capabilities show localized
safe recovery with original words retained. Codex account binding, Tinfoil
bootstrap, dynamic Bedrock and unsupported ADC remain explicit source-specific
limitations. Task16 still needs fresh named-provider/count consent and a newly
setup-owned operation; no future Cleanup UI is introduced here.

The same LevelBars nodes persist through listening, processing and the first
success's 520 ms settle, followed by the shared 360 ms bubble draw and one
persistent dock. Reduced motion swaps immediately and retains static keycap
feedback. SuccessBand offers Make it yours and Start using Loqui; its device claim
requires matching current local proof. Cancel says Discarded with no Undo; the
hidden Undo translation key is reserved for Task20/22. Real Plan04 session,
disclosure, hold, Undo and the existing six-item Task22 handoff remain pending.
Trial surfaces use neutral card and border tokens; success colour remains on the
check icon, following the global icon-only colour constraint over the brief's tint.

The shared captured-text validator is an `.mjs` module so main's synchronous
require and Vite's browser import consume the same pure validation. This narrow
integration correction preserves the reviewed cleanup authority behavior.

### Cleanup in your own words (Plan 05 Task 16)

Cleanup uses one segmented None / Local / ChatGPT / API key group, with no
recommended option. None preserves the original words. Other choices show
labelled examples until an actual captured cleanup succeeds. A ready device
route can try the admitted sentence once; network and remote routes require a
fresh tap naming the recipient and exact word count. Without a trial sentence,
only examples are shown. Changed words use a whitespace-token LCS, neutral
highlight and the shared 360 ms slow token; reduced motion keeps the static
highlight. Panes stack below 520 px. The native reuse checkbox remains LTR;
labels, arrows and layout follow the reading direction.

The Now sentence first reads the selected choice's own prerequisite check,
then Plan03's actual route. A ready network route names both its model and actual
host, using translated copy rather than dropping the host when a model exists.
Unknown stays Checking. Every destination and state
disclosure uses the published route chips. A pending/failed choice never gets
an Off chip beside its unmet prerequisite. Reuse retains its storage key and
false default, applies only a current successful choice to unconfigured scopes,
and preserves existing choices. Leaving Cleanup or completing setup supersedes
a pending choice check. Scenario availability lives in fake bridge APIs; desktop
and browser use the same production helper and captured-operation calls.

A preview owns a new setup operation, separate from the original overlay Retry
relay. Its typed allowlist captures provider, model, full endpoint path, scope,
enterprise source/project/options, prompt, dictionary, language/script preferences
and available main credential generation/configuration version. Sentence/count
and that descriptor are fixed synchronously at admission, before imports or IPC
waits. Main compares disclosed enterprise fields and available version/generation
at admission, retains actual credential/SDK sources and rechecks its existing
full authority after waits. The renderer current-context guard is additionally
checked after capture, before sending text, and after completion; it never
substitutes for main authority. Existing overlay operations keep their original
API and original-owner relay.

A full route/choice/sentence/descriptor fingerprint plus generation keys the
preview context. A changed context synchronously loses send/result/running
eligibility; commit cleanup retires the old owner without touching a new one.
Stale completions cannot display as the new recipient. Callback identity alone
does not repeat local execution. Each off-device attempt requires its own tap;
no boolean consent survives a change. Network consent names the actual route host,
including after a cloud-to-LAN change; a retained cloud label cannot name it. Failures show safe localized codes and
the unchanged raw words, with no invented before/after result or zero-egress
claim. The setup-session Flow owner retains only the latest off-device attempt's
captured recipient label and word count in memory. That historical disclosure
survives context changes and Cleanup → Shortcuts/other steps → Back, even when
an admitted request failed, succeeded or was still pending on departure. Returning
to Cleanup shows no blanket “Nothing was sent” claim. Consent, running state,
errors, results and operation capabilities stay in the mounted preview context
and are discarded/retired on departure; Back never reissues or renews an operation.
A fresh named/count tap is required on every off-device re-entry. Historical
metadata is neither stored nor permission to send or retry.

Captured Codex account binding, Tinfoil bootstrap, dynamic/ambient Bedrock and
unsupported ADC sources retain Task15's explicit unsupported-source limitation.
Generic route readiness may be ready while this safe preview operation is
unsupported. Ordinary API-key/custom/LAN/local and capturable enterprise paths
remain positive production paths under fixture tests; no live provider or native
success is asserted. Task18 consumes cleanupSituation and historical trial words
separately from current voice/device/shortcut proof. Task22 still needs the real
Plan04 tags/private-hold/sole-setter/session/disclosure/Undo integration; no new
recording/cancellation owner, Sealed or zero-byte contract is introduced here.

### Onboarding shortcut tester (Plan05 Task17)

Shortcut is a separate, recording-free test of the registered key. Its focusable,
named tester mirrors down/up feedback through LiveKeycap and announces a completed
tap or hold politely. A hold can suggest push-to-talk only after main answers for
the current requested key; a stale key's capabilities, missing method, rejected
query or unsupported answer cannot authorize that suggestion. Mode, key and
paste changes use the existing settings setters and real HotkeyListInput. Paste
is an observable store selection, with a named, neutral high-contrast switch.
macOS Accessibility recovery stays platform-specific.

Each active shortcut demo has a unique effect-lifetime id, including StrictMode
replay. A partial bridge with no matching end method never begins; delayed or
failed acknowledgements are settled before id-matched teardown. Only the existing
main session ends, so a stale end cannot destroy a newer trial or shortcut demo.
No recorder, separate cancellation owner or invented Undo is introduced. Native
capture remains excluded centrally and retains its separate forwarding channels.

The requested key stays visible while registration is pending or refused. Main's
actual slot/callback and activation mode acknowledge it; editable preferences and
a retained older active key are not proof. Changing either key or mode clears
current press eligibility. Historical trial proof still requires its admitted
voice/microphone context; raw historical words and the session's nonsecret Cleanup
attempt disclosure survive step navigation under their existing owners.

The in-memory browser bridge explicitly reports support for its simulated
key-release events; this is preview behavior, not desktop capability evidence.
The production step contains no preview branches. Task17 strings are authored in
all eleven locales; previous placeholder translations and final native-speaker,
native audio, OS permission, motion and real zoom verification keep their later
owners. Task18's final Ready summary and Task22's real Plan04 composition remain
separate work.

### Honest Ready and workspace hand-off (Plan05 Task18)

Ready summarizes Voice, Microphone, Shortcut and Cleanup in that order. Only
current admitted voice/model/device evidence proves dictation; installation,
historical words and the docked mark cannot do so. The microphone must have been
heard on its selected input, and known denial overrides old proof. A shortcut
requires the acknowledged current binding and activation mode. macOS Accessibility
is observed on Ready too; an unresolved answer remains pending.

Configured rows resume their step; pending rows open the exact fix, including
Settings-only destinations. Proven and optional rows are static. Cleanup Off is
optional, while a chosen unavailable cleanup stays pending according to the same
choice-first check as Cleanup. A successful configuration check is labelled
configured, not evidence of provider execution. A network configuration names
its actual host. The subtitle invites a dictation test without claiming no other
part has been tested. Status colour lives only on icons; words remain neutral. Ready and pending icons use the neutral background token so their glyphs clear 3:1; tinted status fills reduced warning contrast below that threshold.
The rows reflow at narrow widths and share the motion and focus tokens.

“Dictate into a note” uses Plan03's noteRecordingStt route and published destination
chip, independently of dictation. Unknown routes say Checking and cannot finish;
self-hosted notes are unsupported and open stt/noteRecording. Denied microphone
returns to Hello. Unknown microphone may proceed to the existing recorder's
permission prompt. The action re-reads the authoritative route snapshot at click.
A device-only subtitle requires actual device localities for dictation, chosen
cleanup and notes. No installed candidate or advisory flag overrides them.

AppRouter forwards the single OnboardingCompleteOptions.next type to a one-shot,
in-memory slot. ControlPanel consumes it beside handleNewNote, through the existing
useCreateNote/recording owner or the exact Settings path. StrictMode replay and
remount do not repeat it. Plan06 must carry that effect beside handleNewNote;
no second recorder, cancel manager or persisted intent is introduced. Ready has
its own actions and no primary, Skip or Finish later footer action. Ready imports
PrivacyDefaults itself. New Ready copy is translated in all eleven locales;
existing placeholders elsewhere remain Task20 work. Captured-provider source
limits, native/manual verification and Task22's real Plan04 integration remain
open. No Sealed or zero-byte assurance is made.

### Setup ownership and admission (Plan 05 Task 19 foundation)

Opening or closing setup is presentation, and never sends ordinary workspace
cancel/reset commands. Existing workspace dictation, Stop/Esc controls and late
transcription surfaces remain available while setup is presented. A trial can
refuse as unavailable while that original operation is busy; a cached main
lifecycle or a renderer preference cannot authorize a new private recording.

`beginOnboardingDemo({id, kind, context?})` still resolves to a boolean. Main
stages a two-second request for the current setup and original overlay
webContents. The typed admission request contains only `demoId`, a unique
`requestId`, `kind` and an absolute `deadlineAt`. The original
`useAudioRecording` preparation/start owner checks its locks, prepared capture,
AudioManager acquisition/streaming/processing, retained cleanup execution and
pending completion/saver work. On a true idle admission it reserves that nonce
synchronously before replying, excluding queued ordinary starts. Main validates
the exact reply and both live senders again before installing a demo, then sends
its matching commit. False, missing, rejected, expired or destroyed owners do
not replace the current main demo or publish fictional listening. Pending
admission, supersession, matching end, renderer disposal and window destruction
release only their exact nonce and captured take, when one exists. Existing
physical press owners carry that take through key release, interruption and
forced stop as well. The in-memory preview follows the same admission
and control contract with fake owners and no microphone or provider work.

Main-admitted take payloads add `reservationId` to the immutable string
`demoId`/`takeId`. Preparation, start, toggle, stop, cancellation and release are
checked at the original overlay immediately before its existing operations.
Each reservation remembers admitted take IDs, so a delayed completed/cancelled
prepare or start cannot reopen an earlier take. Setup control calls accept an
additional expected string take ID (or null before the first take); once a take
exists, omitted or mismatched IDs refuse. The setup observer captures that ID
before awaiting admission. Ordinary user controls retain their existing
semantics. While setup is displayed without a demo, all fresh input kinds,
including manual meetings, remain blocked. A matching cached recording toggle
routes only to the existing stop command with an explicit normal-owner marker;
the original overlay rechecks its current reservation and recording state. A
stale cache can therefore never turn that control into a fresh start, and a
new demo reservation cannot be stopped by a delayed normal-owner control.
Surface visibility/recreation remains separate from input admission. A release
without an admitted take only releases its admission.

The original AudioManager and preparation generations still own recording and
cancellation. Captured private policy is fixed before any wait, including before
a cross-window completion-flag update. A setup admission guard travels with the
existing recording snapshot and is checked at the existing asynchronous
microphone/provider boundaries. Pending completion and saver accounting extends
that manager's eligibility through visual idle, including a public discard's
final recorder event, merge and audio save. Each cancelled recorder's final-event
obligation has one idempotent release: successful asynchronous completion retains
it through merge/save, while synchronous reset/state-publication/stop failures
release only that obligation and propagate the original error. A late callback
cannot decrement another pending owner's count. It does not change public retention,
replace snapshot savers or introduce a recording/session/Undo owner. Cleanup
retirement checks every supplied original operation identity field. Plan 04's
sole audio setter, private hold, session and Undo composition remain Task 22
second-merger work. This foundation supplies no resume card, restart listener,
Router preservation remedy or whole-Task19 completion.
