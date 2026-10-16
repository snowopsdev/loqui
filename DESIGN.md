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

The desktop shell pairs a 208px sidebar with a flexible content area. The main workspace sits 8px inside the window, inside a 12px-radius frame. A 48px top bar carries the current view, centered search, and view actions. Page content commonly centers at a maximum width of 64rem. The sidebar can collapse or disappear in narrow note and meeting side-panel layouts; the window content keeps its own scroll region. Onboarding uses a narrower 48rem content column, wider side padding at larger window sizes, and a persistent progress header and footer. Spacing follows Tailwind’s 4px base scale, with common 8, 12, 16, and 24px intervals.

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

| Token | Value | Use |
|---|---|---|
| `--motion-instant` | 90ms | press, colour change |
| `--motion-fast` | 150ms | hover, label swaps, tooltips |
| `--motion-base` | 240ms | surface enter, toast, chip |
| `--motion-slow` | 360ms | morphs, panel growth |
| `--motion-hero` | 520ms | spring settle (visual length) |
| `--motion-ease-std` | cubic-bezier(0.2, 0, 0, 1) | movement and morphs |
| `--motion-ease-enter` | cubic-bezier(0.16, 1, 0.3, 1) | things arriving |
| `--motion-ease-exit` | cubic-bezier(0.2, 0, 0.4, 1) | things leaving, at ~70% of enter |
| `--motion-spring-snap` / `-settle` / `-bounce` | CSS `linear()` | press release and morphs / panels / success only |

Rules:
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
- **State:** Focusable chips use a visible ring. Selected model and provider states use a subtle orange-tinted surface and border.

### Cards / Containers
- **Corner Style:** 8px on the shared Card primitive; 8–10px on grouped panels and setup cards.
- **Background:** White cards in light mode; Plum Night card tokens in dark mode.
- **Shadow Strategy:** A faint resting shadow; dark mode adds a low-contrast top rim and soft shadow. The `.card` utility may lift 1px on light hover, while dark cards change border and shadow without moving.
- **Border:** One-pixel neutral border; active or selected panels may tint the border with the orange accent.
- **Internal Padding:** Common card headers and contents use 24px; compact setup rows use 16px.

### Inputs / Fields
- **Style:** Full-width 40px fields with 6px corners, compact sans text, and a one-pixel neutral edge. Light fields are near-white; dark fields use a flat dark fill.
- **Focus:** Orange border plus a low-opacity 2px ring. The field remains easy to identify without a heavy glow.
- **Error / Disabled:** Errors use the separate destructive color; disabled fields lower contrast and disable pointer interaction.

### Navigation
- **Sidebar:** 208px wide, with 36px rows and 13px labels. The active item uses a quiet foreground-tinted surface and a 2px rail in the nav-marker colour (orange in the light theme, magenta #E6007A in Plum Night); the active icon takes that same colour while inactive icons remain subdued.
- **Top bar:** A 48px draggable Electron title area with centered capsule search and platform-appropriate window controls. macOS clears space for traffic lights when the sidebar is collapsed; Linux displays the app window controls.
- **Narrow layout:** The sidebar collapses for focused note and meeting side panels; a back control replaces it.

### Voice Pill

The persistent dictation control is a compact bordered capsule with a waveform and voice identity mark. Recording and processing remain legible through waveform and control state; assistant thinking can add a restrained glow. The pill expands into the assistant or live-transcript surface with 24px corners, then contracts back to the same anchor. Dictation thinking glows in the logo gradient (#FF8A5C → #FF5A1F → #D90078); Agent Mode thinking glows violet (#8787FF). Blue is not a Loqui state colour.

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
