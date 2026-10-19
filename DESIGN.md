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

### AI and Agent
- `--color-ai` (#d90078 light, #ff5fae Plum Night): machine-authored content. AI chips (12% fill, 1px 30% border), slash-menu AI items, the bubble toolbar's Ask AI. Small text uses `--color-ai-text` (#b8006a light).
- `--color-agent` (#7b7bf7 light, #8787ff Plum Night): the Agent's presence. The streaming rail, the spark avatar, citation numerals. Small text uses `--color-agent-text` (#4a4ad8 light, #a5a5ff Plum Night).
- Neither is ever a call to action, and neither is orange: orange means live voice (D1).

### Named Rules

**The Two-Brand-Accent Rule.** Orange marks live voice, the focus accent and, in the light theme (as the deeper #E84E16), the active navigation marker; the everyday primary action is the ink CTA, and Plum Night marks active navigation in magenta #E6007A. Fuchsia is a supporting accent; Agent Violet stays scoped to Agent Mode.

## Typography

- **Display Font:** Inter Variable, with Noto Sans and platform sans-serif fallbacks.
- **Body Font:** Inter Variable, with Noto Sans and platform sans-serif fallbacks.
- **Label/Mono Font:** The same sans family for labels; system monospace is reserved for inline code and technical values.

**Character:** A neutral, highly legible sans keeps controls and transcripts quick to scan. Display and body use the same family; size, weight, and spacing create hierarchy rather than a decorative pairing.

### UI ramp (WS-R11 B)
Tailwind utilities from `@theme` in `src/index.css`. Chrome, lists, menus and dialogs use these and nothing else.

| Utility | Size / line / weight / tracking | Use |
|---|---|---|
| `text-display` | 32px / 1.15 / 650 / -0.02em | Rare page hero |
| `text-title` | 22px / 1.25 / 600 / -0.015em | View titles, dialog titles |
| `text-heading` | 17px / 1.35 / 600 | Section headings |
| `text-body` | 15px / 1.55 / 400 | Transcripts, chat answers, previews |
| `text-ui` | 13px / 1.4 / 500 | Labels, nav rows, buttons, menu rows |
| `text-caption` | 12px / 1.4 / 450 | Metadata, timestamps, helper text |
| `text-micro` | 11px / 1.3 / 500 / +0.02em | `kbd` and badges only |

No size below 11px. Readable text floors at 12px. Hierarchy comes from size and weight, never opacity: metadata is full `text-muted-foreground`.

### Note document ramp (WS-R6 B)
Inside the note editor (`.rich-text-editor-content`) and the note title: title 32/1.15/600; h1 24/1.25/650; h2 19/1.3/600; h3 16/1.4/600; body 16/1.65 with a 68ch measure; code 14 mono. Chat answers use 15/1.6 at 68ch. Answer source metadata persists with its admitted conversation: compact tool hits and retrieved note references retain titles and excerpts of up to 240 characters. Citation numbering follows eligible Markdown and GFM text, excluding code and links; an answer without eligible citations retains up to five unnumbered sources. Document answers render eligible citations as numbered superscripts with a Sources row.

### Note slash menu (WS-R6 B)

In editable raw notes, `/` at the start or after a space opens Text, AI and Insert groups. URLs, dates and code keep literal slashes. Typing filters; arrows select; Enter or Tab applies; Escape closes. AI choices use the actual note actions and resolved notes route: unknown stays disabled with a checking reason and no setup prompt; confirmed unavailable states offer Settings at that route. Disabled explanations remain full-opacity `text-muted-foreground`, with 12px group headers and no extra option tab stops. Only an explicit enabled action invokes note AI. Manage actions preserves the first-run flow; Dictation here uses the control-panel toggle.

Changes to slash readiness, actions or locale dismiss an open menu immediately, preserving the editor, draft and selection. Reinvoking it resolves the current context; unrelated saves and renders keep it open. Command admission independently checks current readiness before deleting the query or invoking work. The shared mention popup contract is unchanged.

Slash and mention suggestions share a caret popup that clamps horizontally, flips above near the bottom, and marks its wrapper with `data-editor-chrome`. Mention insertion and Markdown round-tripping keep their existing contract.

Universal mention suggestions group People, Notes, Meetings, Dictations and Folders in that order, with at most three rows each in a 262px caret picker. Empty queries use Recent notes; contact and note searches fail independently. Headers and metadata use readable 12px tokens at full opacity. Stored dictations use a neutral marker. Compact person markers retain the avatar/name with an 11px dark initial on the existing local pastel.

Entity chips navigate within the workspace. Hover and keyboard focus share one chip/card boundary, including its padded gap; Escape returns focus once and stays dismissed until either modality really leaves and re-enters. The 240px preview flips above and clamps at inline edges within the visible editor/viewport, updating on scroll, resize and content changes while preserving native Tab order. Preview failures show an explicit Retry separately from deleted items. Only ready, nonempty meeting/dictation excerpts can be inserted, as a local document quote; pending or stale requests cannot change another target or editor. Chip and card controls use the opaque shared focus ring.

Mention links keep people on the `mention:` scheme and store note, meeting, dictation and folder references as readable `[@Label](kind:id)` Markdown links. Labels escape Markdown display characters while entity identifiers and existing person fallback identities remain unchanged.

### Note selection toolbar (WS-R6 B)

A nonempty editable selection outside code blocks offers Bold, Italic, Link and Ask AI. Formatting survives the Markdown save cycle; no Highlight mark is offered. Newly entered links accept web or email addresses and bare domains; an empty address removes the link. Existing relative, anchor, phone and FTP links retain the default Link load policy. Clicking links edits rather than opening them. The URL field stays LTR and keeps its caret when clicked. Bubble and suggestion chrome never pull focus back into the document.

Ask AI places a quote of at most 280 characters in the visible note chat and never sends. A hidden chat opens floating; a sidebar stays docked. One lazily mounted composer persists across dock, undock, hide and reopen, retaining newer words and Restore/Discard text without replaying a seed. Hiding disarms its existing queue before idle effects, stops voice drafts and prevents hidden focus or submission; it does not cancel an admitted chat response. The note owner key still ends that composer's lifetime. Bubble controls use full opaque focus rings, AI text uses `text-ai-text`, and the entry fade uses only shared instant/enter opacity motion, including reduced motion. Light uses the existing glass shadow; Plum uses the elevated shadow.

### Named Rules

**The One-Family Rule.** Use the bundled Inter/Noto Sans system for interface text; create hierarchy through scale and weight.

## Layout

The desktop shell pairs a 208px sidebar with a flexible content area. The main workspace sits 8px inside the window, inside a 12px-radius frame. A 48px top bar carries the current view, centered search, and view actions. Page content commonly centers at a maximum width of 64rem. The sidebar can collapse or disappear in narrow note and meeting side-panel layouts; the window content keeps its own scroll region. Onboarding uses a narrower 48rem content column, wider side padding at larger window sizes, and a persistent progress header and footer. The onboarding shell pins `html`, `body` and `#root` to the window, so only the middle scrolls. On macOS the header keeps 84px of physical left padding (also in RTL) to clear the traffic lights. Spacing follows Tailwind’s 4px base scale, with common 8, 12, 16, and 24px intervals.

The workspace restores its last view on launch, defaulting to Home. A saved Notes selection opens through the shared note navigation path, including notes outside the first loaded page. Missing notes keep the Notes overview; deliberate navigation and confirmed data resets supersede pending restores. Deep workspace actions share one navigation context. Chat requests seed or focus the composer without submitting. New and open requests disarm its destination-bound queue; replaced drafts and refused sends overtaken by a new intent stay available through Restore and Discard. Focus and edit seeds keep the user’s queue. Seeds apply before idle auto-send effects, including at mount.

Workspace shortcuts use ⌘ on macOS and Ctrl elsewhere: K opens search, comma opens Settings, 1–3 open Home, Notes and Chat, backslash toggles the sidebar, N creates a note, Shift+N starts a chat, Shift+M requests a meeting, Shift+U opens audio upload, and slash focuses the assistant. IME composition, Alt chords and handled events are ignored. Open dialogs block view-changing shortcuts; search and Settings remain available.

Note deletion retires outstanding page reads before evicting the row, so an older page cannot restore deleted content to the cache. Incidental first-note picks require unchanged navigation, the current context, and a still-valid committed page; newer overview navigation and confirmed reset admission keep their selection authority without clearing cached content.

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

- **Sidebar:** 232px. Home, Notes, Chat (⌘1–3), then Spaces (the notes tree), Recent (4) and Voice (Dictionary, Insights, Calendars). The footer holds the mic status card (Ready / Listening m:ss / Cleaning up… / Mic offline) and Settings. A 2px capture rail on its inline-end edge follows the mic level while listening. The active row uses `--color-nav-marker`.
- **Selected tree note:** title and file icon inherit the accessible `--color-link` role in both themes, with the full-opacity 2px focus ring retained. The Notes Actions model hint and its settings action use 12px `text-caption` readable text.
- **Settings sidebar:** the current section carries `aria-current="page"`; every item shows a 2px full-opacity `--color-ring` focus ring, inset because the list scrolls. Compact (icon-only) items are named by their label.
- **Home:** a 44px Ready strip names Ready, Listening with elapsed time, Cleaning up… or Mic offline with the shared static capture glyph. Ready explains the dictation shortcut. The next meeting and its Take notes action appear here when Home's content is narrower than 960px. At 960px of content, a 320px Coming up column appears instead; its next or live event always shows the notes action. Both actions use the same event and join-link dispatch. Today is named in words on a neutral calendar header; orange remains live voice. Take notes has the shared full-opacity focus ring. Shared status glyphs use accessible ink on light tinted fills and the live/warning colors in Plum Night.
  Home history combines dictations, notes and meetings in timestamp order. Search filters this list, and All, Dictations, Meetings, Notes and Failed chips preserve original chronological adjacency: hiding a record never joins captures across it. Only consecutive completed captures within five minutes on the same day form a session; sessions expand in place. Rows show unpadded clock time, word count, duration and recorded locality, with full-muted Copy and More actions visible at rest. Failed counts and headings use readable foreground ink on their tinted surfaces; destructive menu text keeps a full-contrast focus surface. Search uses the field-edge token. Compact provider monograms use the 11px metadata floor. Selecting paragraph text never copies it; the labelled Copy button remains the keyboard and screen-reader path. History options exposes discarded recordings and the existing Clear all confirmation. Deep links clear search/chips, fetch and reveal older rows beyond the loaded page, expand their session, scroll and ring for 1.2 seconds. Only the current owned target is retained through an outstanding history-page response; expansion and scrolling wait for that page, recheck page generations, then release retention; explicit deletion or clear invalidates that retention and any older page response. A failed lookup shows a localized load error and an explicit Retry that publishes a fresh focus request; a successful missing/deleted result shows the absence notice. Newer requests or unmount also make old Retry callbacks inert. Repeating a link restarts the ring; newer requests and Home unmount invalidate every deferred mutation and frame. Reduced motion keeps the ring without animation or transforms.

- **Provider tabs:** a real tablist. Arrow keys (reversed in RTL), Home and End move focus across enabled tabs; Enter, Space or a click selects. Focus alone never switches provider, local or remote. Tabbing into the list lands on the selected tab (WAI-ARIA tabs pattern). A saved key shows as a small dot with screen-reader text.
- **Top bar:** 48px draggable title area with a breadcrumb (`Notes / Work / Product catch-up`, title column at least 120px), centred search (⌘K), and the Capture split button. Capture is neutral at rest and turns `live` only while listening.
- **Collapsed:** a 56px icon rail (⌘\, or automatically below 1100px). There is no hover peek. Meeting mode and narrow open notes hide the sidebar and show "Back to notes".

### Chat

The Chat view answers as a document. Assistant turns are unbubbled 15px `text-body` prose at 1.6 line-height, capped at 68ch, 24px apart, under an Assistant label and Agent spark. While a turn streams it carries a 2px `--color-agent` rail; thinking uses three dots with a text twin and the shared cadence. User turns are a neutral `surface-3` block. Citations are superscript numerals in `--color-agent-text`, numbered by first eligible Markdown appearance. A Sources row of 28px chips follows each answer; pointer or keyboard focus reveals the persisted quote, constrained to the visible scroll area, with Escape dismissal. Activity expands through native buttons with readable detail. Sources, activity, copy and shared Markdown links use full-opacity 2px focus rings; copy appears on keyboard focus. Embedded and assistant-panel chats retain their default bubbles.

The model chip and per-answer route disclosure are future Task 21 work. They must use Plan 03's `RouteDestinationChip` and, when not ready, `RouteStateChip`.

### Voice Pill

The persistent dictation control is a compact bordered capsule with a waveform and voice identity mark. Recording and processing remain legible through waveform and control state; assistant thinking can add a restrained glow. The pill expands into the assistant or live-transcript surface with 24px corners, then contracts back to the same anchor. Dictation thinking glows in the logo gradient (#FF8A5C → #FF5A1F → #D90078); Agent Mode thinking glows violet (#8787FF). Blue is not a Loqui state colour.

The control panel capture rail pulls the current dictation lifecycle on mount and follows main-process updates. The Agent pill, tray and hotkey gate keep the finite known lifecycle; the control panel can display a 1–64 character future state unchanged until the renderer learns it. Audio levels reach the control panel only while recording and at no more than 15 Hz. The dictation renderer continues sampling at 80 ms, including while the Agent panel is closed; main sends pill levels only while that panel is open.

### Workspace Capture

The topbar Capture split button is neutral while idle and remembers the last chosen
capture action on this device. Its menu offers dictation, meeting recording, audio
upload, a plain note, and a new chat with the existing shortcut hints. New chat
opens the composer without sending a message. Plain New note skips recording;
Record meeting creates a recording note, or opens the current meeting’s note.
Repeated recording actions share one admission through note save and recording
startup, while plain notes remain independently available.

Only live listening uses the orange live Button and level bars, alongside an
elapsed clock and the source-specific Stop label. Its label and current-colour
Stop glyph retain live ink in both themes, including hover. Processing is neutral,
busy and announced as “Cleaning up…”. The clock and meter mount only while listening;
spinner motion uses shared motion tokens and stops under reduced motion. Both
split segments and menu items retain full opaque focus rings, logical spacing and
Radix’s keyboard and dismissal semantics. ControlPanel owns one capture-status
hook result for this control and the later sidebar and Home consumers.

The sidebar mic card opens Settings in expanded and compact forms, with full
opaque keyboard focus rings. It uses static state glyphs, including the processing
glyph, and unfaded status/reason text. The expanded card shows the elapsed clock,
idle hotkey and Plan 03 destination/state chips; unconfirmed routes say “Checking…”.
Configured speech and assistant/translation routes sit under “Next capture” while
listening, processing or an active meeting has lost its mic. These describe the
next configuration, not the frozen active recipient. Idle cards use ordinary role
labels. The compact card announces only capture status and discloses no route.

The decorative 2px rail sits on the sidebar’s logical inline-end edge. It is hidden
while ready, follows smoothed live levels only while listening, travels in amber
only while processing, and stays solid amber offline. The card adds no focal
motion: Capture’s processing spinner and the rail’s travel share the two-motion
budget. Reduced motion stops level sampling, travel, glow and transitions while
keeping active rails visible. State changes, reader replacement, preference changes
and unmount clean up the owned timer and level property. Shell integration remains
separate from these presentational components.

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
- **Workspace command palette.** In all mode, an empty query shows four suggested commands followed by five recent notes, dictations and chats. A query groups Commands, Notes, Meetings, Transcripts, Chats and Folders, with caps of 6/6/4/8/4/5. Titles use fuzzy matching with original-string highlight offsets and locale-independent Unicode lowercase, so results stay stable across runtime locales; transcripts use substrings only. Every substring outranks a subsequence, including long and case-expanding text. Match wash uses the link tone. More than eight transcript hits offer History with the trimmed query; transcript selections use the owned Home reveal path. Ask opens a new composer draft without sending, retaining the composer's queue and replaced-word recovery. Commands use workspace owners, the registered dictation hotkey and click-time dictation route settings. Tab and Shift+Tab cycle space scope only when multiple spaces exist. Query, scope, close and unmount retire pending search completions; a DB failure preserves the last admitted visible results. Rows, scope menu, input and clear control carry full focus rings. The conversations-only chat picker keeps its existing search limits and selection callback.

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

### Workspace · Next-message model and recorded answers

Chat and the note editor’s visible Ask AI composer disclose the next message’s destination and model with Plan 03’s `RouteDestinationChip`. Non-ready routes add `RouteStateChip`; unknown stays neutral “Checking…”, and blocked network and remote routes show the existing Sealed state. The whole read-only chip opens that route’s Settings path. Model text may truncate; state words wrap and stay visible. Text uses the shared 12px caption floor, and keyboard focus uses a full opaque 2px ring.

Each newly admitted answer records its destination from the same synchronous settings snapshot as inference, before conversation creation, user-save or context waits. The shared stream resolves Chat, Voice Assistant or the chosen Assistant Vision route according to its effective inference scope. Document answer headers render that recorded destination with the published chip; later Settings or fact changes update only the next-message chip. Unstamped legacy answers remain unstamped. Note Ask retains one composer across floating, sidebar and hide/reopen, preserving drafts and disarming replaced queues without sending.

This is route disclosure and persisted request attribution. Synthetic readiness and Sealed display checks do not establish native isolation, attestation or a zero-byte claim; Plan 07 D16 remains blocked.


### Chat context rail and deliberate pins

Chat uses the shared entity mention picker for notes, meetings, folders and dictations; people remain editor mentions. Typing `@` selects context without sending. A typed pick splices only its local query and at most one adjacent separator, preserving Markdown whitespace and the user's destination queue. Add context preserves the draft and caret. Native Add, remove, found-item, close and Context controls have localized names and opaque 2px focus rings. Rail and picker headings use the 12px caption ramp and full muted text.

Context (`⌘.` on macOS, `Ctrl+.` elsewhere) defaults open at viewport widths of at least 1280px, with the user's choice stored in `chat.contextRailOpen`. The chat measures its actual available width: three columns require 784px; below that, the rail stacks in a bounded, scrollable row, leaving the composer and toggle reachable. At widths below 544px, the conversation list stacks above the chat. The local fixed mention popup clamps to viewport edges and follows resizing, scrolling and content growth; it retains textarea keyboard focus.

In scope lists deliberate pins. Found automatically lists the last assistant's tool/RAG notes, separately from current note/meeting pins, and remains read-only. Activity lists actual tool steps in order. Pins start local content lookup synchronously with admitted settings, route, note context and search scope before creation or user-save waits. Later pin edits affect the next admission. Notes use enhanced-or-raw content capped at 1500 UTF-16 units without splitting a code point; folders contribute their first five raw notes capped at 500 each, and source quotes cap at 240. Missing, deleted or failed items are skipped independently; dictations contribute text without a fabricated note citation. Only notes included in the prompt become saved pinned citation sources. Existing request ownership and route disclosure remain authoritative through navigation and cancellation.
