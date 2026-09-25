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
  night-charcoal: "oklch(0.22 0.006 260)"
  night-card: "oklch(0.27 0.008 260)"
  night-raised: "oklch(0.33 0.01 260)"
  night-border: "oklch(0.35 0.007 260)"
  night-text: "oklch(0.93 0 0)"
  night-secondary-text: "oklch(0.65 0 0)"
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
    backgroundColor: "{colors.signal-orange}"
    textColor: "{colors.paper}"
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

The same React interface runs in the Electron shell on macOS and Linux, with platform-specific window controls and permissions. Light mode uses clean white and pale-gray surfaces. Dark mode shifts to low-chroma charcoal layers. Rounded controls, restrained elevation, and clear interaction states carry the system across both themes. The visual anti-reference is generic AI-dashboard styling.

**Key Characteristics:**
- Signal Orange leads primary actions; Electric Fuchsia supports secondary emphasis.
- Inter Variable anchors a compact, high-clarity interface.
- Light surfaces use subtle lift; dark surfaces use tonal separation and soft edge rims.
- Capsules, small-radius controls, and inset work areas shape the desktop shell.
- Interaction states stay explicit through focus rings, pressed feedback, and active navigation markers.

## Colors

The palette pairs a vivid orange action color with fuchsia highlights over neutral light and charcoal dark themes.

### Primary
- **Signal Orange** (#FF5A1F): Primary actions, active navigation markers, selection, and focus accents.
- **Orange Highlight** (#FF6A36): The brighter top stop in the primary button and brand-surface gradient.

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
- **Night Charcoal** (oklch(0.22 0.006 260)): Dark-theme canvas; panels rise through oklch lightness levels 0.25, 0.27, 0.30, and 0.33.
- **Night Card** (oklch(0.27 0.008 260)): Dark card surface.
- **Night Border** (oklch(0.35 0.007 260)): Dark-theme separators and control borders.
- **Night Text** (oklch(0.93 0 0)): Main dark-theme text; secondary text uses oklch(0.65 0 0).
- **Orange Link** (#C43E13 in light mode; #FF9A7A in dark mode): Text links, kept distinct from the primary action fill.

### Named Rules
**The Two-Brand-Accent Rule.** Orange marks primary action and current state. Fuchsia is a supporting accent; Agent Violet stays scoped to Agent Mode.

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

Depth is layered: light mode uses a subtle card shadow and restrained hover lift; dark mode relies on stepped charcoal surfaces, quiet borders, and soft inner rims, with stronger shadows reserved for overlays. Primary orange surfaces carry a fine top highlight and inset rim. Focus rings, selected-model glows, and modal shadows remain state-specific.

### Shadow Vocabulary
- **Card at rest:** `0 1px 3px oklch(0 0 0 / 0.2), inset 0 1px 0 oklch(1 0 0 / 0.03)` in dark mode; light cards use the component's subtle `shadow-sm` treatment.
- **Card hover:** `0 4px 12px oklch(0 0 0 / 0.25), inset 0 1px 0 oklch(1 0 0 / 0.04)` in dark mode; light cards may rise by 1px.
- **Brand glass rim:** `inset 0 1px 0 rgba(255,255,255,0.6), inset 0 0 0 1px rgba(255,255,255,0.16), inset 0 -1px 1px rgba(0,0,0,0.12)` on orange actions and brand surfaces.
- **Elevated overlay:** `0 8px 24px oklch(0 0 0 / 0.3)` for elevated surfaces; modals use a larger 24px / 48px shadow.

### Named Rules
**The Layered-Not-Floating Rule.** Separate adjacent work areas with tone and borders first. Reserve stronger lift for overlays and deliberate hover states.

## Shapes

The radius scale is compact: 4px minimal, 6px standard controls, 8px cards, 10px larger cards, and 12px for the inset workspace shell. Primary actions, search, and badges use full capsules. Borders are thin and neutral at rest; active and focus borders take the orange accent. Large 24px corners belong to the animated voice and assistant panels, not ordinary cards.

## Components

### Buttons
- **Shape:** Capsule for text actions (9999px); icon-only buttons use a 6px radius.
- **Primary:** Orange vertical gradient from #FF6A36 to #FF5A1F, white semibold label, 40px default height, and 16px horizontal padding. A fine glass rim adds a small highlight.
- **Hover / Focus:** Hover brightens the primary surface. Keyboard focus uses a 2px visible ring with a small offset; pressed controls scale slightly to confirm activation.
- **Secondary / Ghost / Tertiary:** Outline and secondary buttons use muted fills, thin borders, and restrained shadow; ghost actions gain a muted surface on hover, while link actions remain text-first.

### Chips
- **Style:** Status and category badges are small full capsules. The default badge uses a translucent orange fill and orange text; secondary and status variants keep their own semantic colors.
- **State:** Focusable chips use a visible ring. Selected model and provider states use a subtle orange-tinted surface and border.

### Cards / Containers
- **Corner Style:** 8px on the shared Card primitive; 8–10px on grouped panels and setup cards.
- **Background:** White cards in light mode; charcoal card tokens in dark mode.
- **Shadow Strategy:** A faint resting shadow; dark mode adds a low-contrast top rim and soft shadow. The `.card` utility may lift 1px on light hover, while dark cards change border and shadow without moving.
- **Border:** One-pixel neutral border; active or selected panels may tint the border with primary orange.
- **Internal Padding:** Common card headers and contents use 24px; compact setup rows use 16px.

### Inputs / Fields
- **Style:** Full-width 40px fields with 6px corners, compact sans text, and a one-pixel neutral edge. Light fields are near-white; dark fields use a flat dark fill.
- **Focus:** Orange border plus a low-opacity 2px ring. The field remains easy to identify without a heavy glow.
- **Error / Disabled:** Errors use the separate destructive color; disabled fields lower contrast and disable pointer interaction.

### Navigation
- **Sidebar:** 208px wide, with 36px rows and 13px labels. The active item uses a quiet foreground-tinted surface and a 2px orange rail; icons shift to orange while inactive icons remain subdued.
- **Top bar:** A 48px draggable Electron title area with centered capsule search and platform-appropriate window controls. macOS clears space for traffic lights when the sidebar is collapsed; Linux displays the app window controls.
- **Narrow layout:** The sidebar collapses for focused note and meeting side panels; a back control replaces it.

### Voice Pill

The persistent dictation control is a compact bordered capsule with a waveform and voice identity mark. Recording and processing remain legible through waveform and control state; assistant thinking can add a restrained glow. The pill expands into the assistant or live-transcript surface with 24px corners, then contracts back to the same anchor.

## Do's and Don'ts

### Do:
- **Do** use Signal Orange for primary actions and current navigation state.
- **Do** use Electric Fuchsia as a supporting accent, keeping the two roles distinct.
- **Do** preserve the charcoal surface steps and soft rims when adding dark-theme surfaces.
- **Do** use compact controls, clear labels, and the existing visible focus treatment.
- **Do** adapt window controls and traffic-light clearance to the host OS while keeping the shared React interface coherent.

### Don't:
- **Don't** drift into generic AI-dashboard styling or decorative marketing-page chrome.
- **Don't** swap orange and fuchsia roles or make both accents compete for primary-action status.
- **Don't** rely on shadow alone to distinguish dark surfaces; use the existing tonal layers and borders.
- **Don't** use movement as the only cue for recording, processing, selection, focus, or error states.
