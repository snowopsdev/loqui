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

| Utility        | Size / line / weight / tracking | Use                                  |
| -------------- | ------------------------------- | ------------------------------------ |
| `text-display` | 32px / 1.15 / 650 / -0.02em     | Rare page hero                       |
| `text-title`   | 22px / 1.25 / 600 / -0.015em    | View titles, dialog titles           |
| `text-heading` | 17px / 1.35 / 600               | Section headings                     |
| `text-body`    | 15px / 1.55 / 400               | Transcripts, chat answers, previews  |
| `text-ui`      | 13px / 1.4 / 500                | Labels, nav rows, buttons, menu rows |
| `text-caption` | 12px / 1.4 / 450                | Metadata, timestamps, helper text    |
| `text-micro`   | 11px / 1.3 / 500 / +0.02em      | `kbd` and badges only                |

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

### Brand and setup headings

- **Display** (700, 40px, 1.15 line-height, -0.025em tracking): Global h1 scale where a page title is genuinely the display heading.
- **Headline** (600, 1.15 line-height, -0.025em tracking): h2 through h6; size is assigned by the specific screen.
- **Onboarding title** (650, 36px, 1.1 line-height, -0.025em tracking): The setup rail heading; 22px in windows under 760px.

### Named Rules

**The One-Family Rule.** Use the bundled Inter/Noto Sans system for interface text; create hierarchy through scale and weight.

## Layout

The desktop shell pairs a 208px sidebar with a flexible content area. The main workspace sits 8px inside the window, inside a 12px-radius frame. A 48px top bar carries the current view, centered search, and view actions. Page content commonly centers at a maximum width of 64rem. The sidebar can collapse or disappear in narrow note and meeting side-panel layouts; the window content keeps its own scroll region. Setup is a pinned window: a 56px header with per-phase progress, a 36% orange rail beside the controls (a 72px banner under 760px), and a 64px footer that wraps to at most two rows at 200% zoom or with long translations. Footer actions retain their minimum word width and wrap at word boundaries, so narrow windows do not split a label such as “Continue” inside a word. The onboarding shell pins `html`, `body` and `#root` to the window, so only the middle scrolls. On macOS the header keeps 84px of physical left padding (also in RTL) to clear the traffic lights. Spacing follows Tailwind’s 4px base scale, with common 8, 12, 16, and 24px intervals.

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
| `--motion-base`                                | 240ms                         | surface enter, notice, chip                                                                           |
| `--motion-stagger`                             | 40ms                          | notice burst spacing                                                                                  |
| `--motion-slow`                                | 360ms                         | morphs, panel growth                                                                                  |
| `--motion-hero`                                | 520ms                         | spring settle (visual length)                                                                         |
| `--motion-flash`                               | 1400ms                        | one-shot landing flash on a searched setting; animates a registered property, ended by `animationend` |
| `--motion-ease-std`                            | cubic-bezier(0.2, 0, 0, 1)    | movement and morphs                                                                                   |
| `--motion-ease-enter`                          | cubic-bezier(0.16, 1, 0.3, 1) | things arriving                                                                                       |
| `--motion-ease-exit`                           | cubic-bezier(0.2, 0, 0.4, 1)  | things leaving, at ~70% of enter                                                                      |
| `--motion-spring-snap` / `-settle` / `-bounce` | CSS `linear()`                | press release and morphs / panels / success only                                                      |
| `--motion-nudge`                               | 260ms                         | failed pill nudge                                                                                     |
| `--motion-bounce`                              | 640ms                         | pasted check; length of the bounce spring                                                             |
| `--motion-condense-fly`                        | 140ms                         | spark rising from the bars                                                                            |
| `--motion-condense-land`                       | 220ms                         | condensation word landing                                                                             |
| `--motion-rewrite-underline`                   | 600ms                         | cleanup rewrite underline                                                                             |
| `--motion-signal-comet`                        | 1600ms                        | active Signal comet rotation                                                                          |
| `--motion-agent-thinking`                      | 2400ms                        | gated Agent orbit, satellites and identity breath                                                     |
| `--motion-thinking-shimmer`                    | 2000ms                        | theme-ink thinking shimmer; static muted ink under reduced motion                                     |
| `--motion-agent-answering`                     | 1200ms                        | first-token Agent orbit and satellite spin-up                                                         |
| `--motion-signal-breathe`                      | 1900ms                        | active Signal halo breath                                                                             |
| `--motion-locality-orbit`                      | 6000ms                        | active remote locality ring rotation                                                                  |
| `--motion-ease-ambient`                        | ease-in-out                   | ambient halo breath                                                                                   |

Decorative loop cadences use shared tokens too. `--motion-loop-stagger` is 150ms between thinking dots; it is separate from the 40ms `--motion-stagger` for notice bursts. Functional deadlines such as the real Undo window and the JS-shared footprint/listening timing remain separate.

Rules:

- Loops take their timing from these tokens. Capture travel, thinking pulse, streaming blink and the deep-link dwell use the shared Plan 06 cadence values. A rotation stays `linear`, because an eased spin stalls once per turn. Under reduced motion, keyframes stop except opacity-only loading cues (`.progress-pulse`), which keep running.
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

Meeting prompt Start / Join & transcribe use `live`: they start a recording.

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
- **Setup keyboard focus:** the Voice language picker and Ready privacy switches add an opaque shared-ring outline in onboarding. Their inherited translucent shadow is decorative; the outline supplies the required 3:1 focus boundary in light and Plum Night.
- **Setup privacy switches:** tracks retain their 44px width under long translations. A shared input-border outline identifies the off track, and its foreground thumb stays distinct in both themes. These setup-only rules leave the shared workspace toggle unchanged.
- **Setup success band:** actions stay at the inline end, including when their group wraps below the title. The margin follows the writing direction so the buttons align left in RTL.
- **Narrow setup footer:** below 420px, action buttons use 8px inline padding so whole-word minima, including German Download, fit within the window without changing the two structural footer rows.

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
- **Selected tree note:** title and file icon inherit the accessible `--color-link` role in both themes, with the full-opacity 2px focus ring retained. The Notes Actions hint consumes the existing resolved note-formatting route. It is silent while checking, ready or off; missing models, providers, committed keys, server addresses and unreachable models name their matching fix. Provider names use the localized route provider label, and Settings opens the route’s own `llms/noteFormatting` destination. Dismissal persists under `notesActionsModelHintDismissed` across route changes and remounts. Only the published off state disables the whole Actions picker; content and processing guards and slash-menu readiness remain authoritative. Hint and picker controls use readable 12px `text-caption`, full-opacity ink and opaque 2px focus rings; disabled picker text stays readable with neutral decoration. The picker keeps its native dropdown keyboard model. Picker colour transitions use the shared fast duration and standard easing curve.
- **Settings sidebar:** the current section carries `aria-current="page"`; every item shows a 2px full-opacity `--color-ring` focus ring, inset because the list scrolls. Compact (icon-only) items are named by their label.
- **Home:** a 44px Ready strip names Ready, Listening with elapsed time, Cleaning up… or Mic offline with the shared static capture glyph. Ready explains the dictation shortcut. The next meeting and its Take notes action appear here when Home's content is narrower than 960px. At 960px of content, a 320px Coming up column appears instead; its next or live event always shows the notes action. Both actions use the same event and join-link dispatch. Today is named in words on a neutral calendar header; orange remains live voice. Take notes has the shared full-opacity focus ring. Shared status glyphs use accessible ink on light tinted fills and the live/warning colors in Plum Night.
  Home history combines dictations, notes and meetings in timestamp order. Search filters this list, and All, Dictations, Meetings, Notes and Failed chips preserve original chronological adjacency: hiding a record never joins captures across it. Only consecutive completed captures within five minutes on the same day form a session; sessions expand in place. Rows show unpadded clock time, word count, duration and recorded locality, with full-muted Copy and More actions visible at rest. Failed counts and headings use readable foreground ink on their tinted surfaces; destructive menu text keeps a full-contrast focus surface. Search uses the field-edge token. Compact provider monograms use the 11px metadata floor. Selecting paragraph text never copies it; the labelled Copy button remains the keyboard and screen-reader path. History options exposes discarded recordings and the existing Clear all confirmation. Deep links clear search/chips, fetch and reveal older rows beyond the loaded page, expand their session, scroll and ring for 1.2 seconds. Only the current owned target is retained through an outstanding history-page response; expansion and scrolling wait for that page, recheck page generations, then release retention; explicit deletion or clear invalidates that retention and any older page response. A failed lookup shows a localized load error and an explicit Retry that publishes a fresh focus request; a successful missing/deleted result shows the absence notice. Newer requests or unmount also make old Retry callbacks inert. Repeating a link restarts the ring; newer requests and Home unmount invalidate every deferred mutation and frame. Reduced motion keeps the ring without animation or transforms.

- **Provider tabs:** a real tablist. Arrow keys (reversed in RTL), Home and End move focus across enabled tabs; Enter, Space or a click selects. Focus alone never switches provider, local or remote. Tabbing into the list lands on the selected tab (WAI-ARIA tabs pattern). A saved key shows as a small dot with screen-reader text.
- **Top bar:** 48px draggable title area with a breadcrumb (`Notes / Work / Product catch-up`, title column at least 120px), centred search (⌘K), and the Capture split button. Capture is neutral at rest and turns `live` only while listening.
- **Tree navigation:** activating a sidebar note opens it through workspace navigation, including the currently selected note when Home is visible. Activating a folder or space root always opens Notes; unchanged containers avoid redundant selection mutations. Selection and container updates remain owned by the existing note-opening path. Deferred opens and launch restoration require both the original caller's lifetime and the current navigation generation before cache, context, selection, page or notice updates. A rejected note read preserves the current content and saved launch target, shows a localized load error, and offers an explicit Retry for that failed intent only; navigation, reset, deletion or unmount makes the old Retry inert. Only a successful missing/deleted result shows the absence notice. Embedded chat tool cards use this same authority.

Dictionary and Snippets allocate separate inline action cells so automatic text direction cannot move text beneath Add or Import. Notes header groups wrap within the document's available width beside the chat sidebar. The document viewport reserves a non-content area for bottom controls, including the optional summary callout, and the floating chat; nested editors do not apply that reservation twice as padding, and no gradient washes readable note lines. Composer placement changes preserve the one stable draft and queue owner. Palette folder results show their containing space. Quote and label previews stay within their published UTF-16 budgets without splitting a surrogate pair. History uses explicit full-muted dark ghost roles, caption-sized readable raw/no-AI labels, and a history-specific footprint for provider badges; shared Button and LocalityRing defaults stay unchanged. Groq's upload explanation uses readable full-muted text. Today headers round their own top corners without clipping focus or popovers; the conversation picker and meeting reveal wash use shared motion durations.

- **Collapsed:** a 56px icon rail (⌘\, or automatically below 1100px). There is no hover peek. Meeting mode and narrow open notes hide the sidebar and show "Back to notes".

### Chat

The Chat view answers as a document. Assistant turns are unbubbled 15px `text-body` prose at 1.6 line-height, capped at 68ch, 24px apart, under an Assistant label and Agent spark. While a turn streams it carries a 2px `--color-agent` rail; thinking uses three dots with a text twin and the shared cadence. User turns are a neutral `surface-3` block. Citations are superscript numerals in `--color-agent-text`, numbered by first eligible Markdown appearance. A Sources row of 28px chips follows each answer; pointer or keyboard focus reveals the persisted quote, constrained to the visible scroll area, with Escape dismissal. Activity expands through native buttons with readable detail. Sources, activity, copy and shared Markdown links use full-opacity 2px focus rings; copy appears on keyboard focus. Embedded and assistant-panel chats retain their default bubbles.

The model chip and per-answer route disclosure use Plan 03's `RouteDestinationChip` and, when not ready, `RouteStateChip`. Answers retain the route captured when their request was admitted.

### Voice Pill

The meeting recorder is a state of this same pill: 124×36, or 184×36 when a source is lost. Its 8px live dot has a persistent 1px ink boundary and 6px inner fill. Only the fill pulses every 1.2s using the shared cadence token, so the recorder boundary retains contrast through the pulse minimum; the fill becomes pale while quiet and amber with a labelled lost source. Elapsed time and a labelled Stop remain in flow; Stop isolates keyboard and pointer input while the body still starts dictation. “Show meeting recorder on screen” defaults to on and can hide it. Its Settings row and searchable live control reuse Toggle behavior with a scoped ink track boundary, an unchecked theme-ink thumb and a checked primary-ink thumb (including hover), keeping both states legible without changing other switches. While a tray and live meeting own recording presence, a single one-second timer refreshes elapsed text without a presence change; end, session replacement, tray destruction and notification teardown retire that timer. Linux also shows a tray recording dot and a persistent notification with Stop where supported; a notification click reveals Stop for that exact live session even with the setting off. Owned typed Agent thinking and its exact answering phase temporarily take precedence over the resting meeting capsule, after dictation, Undo and outcomes; the meeting capsule returns as soon as the phase retires, even if business cleanup is still pending. The existing pulsing microphone-preparation acknowledgement also precedes the resting capsule when this pill owns that preparation; a plain dictation preparing in the opposite-edge companion leaves the footer recorder available. Preparation keeps its existing processing appearance and input rules, then yields to actual recording or returns to the meeting capsule after cancellation/failure when no higher state owns the pill. Tray and notification Stop remain available during these handoffs. Only explicit recording outcomes announce a save or failure. Reduced motion keeps the dot static and the real timer updating.

The persistent dictation control uses LevelBars and a voice identity mark inside the locality ring. Pill provider labels always resolve the captured raw provider id through the localized display helper; a missing id shows localized Unknown provider and never the English log label. Every pill-only stage fits the fixed 208×120 window, with no footprint wider than 184px. A normal press starts expansion immediately and reveals the first bars at 300ms; the Agent footer handoff keeps its 420ms ownership pause. Live Transcript prepares content during horizontal travel for a nominal first stream at about 640ms. Its scheduled content phase starts the opacity fade with shared `--motion-fast` and `--motion-ease-enter`, without an additional panel delay. Initial and measured native resize acknowledgements still gate the entrance; native resize and scheduling can add latency.

| Stage               | Footprint | Label / shape                 | Ring / edge                               | Timing             | Ownership (hold / input / above footer) |
| ------------------- | --------- | ----------------------------- | ----------------------------------------- | ------------------ | --------------------------------------- |
| Idle / hover        | 40×40     | identity                      | live configured locality                  | idle               | no / normal / no                        |
| Recording           | 98×36     | five LevelBars                | frozen locality, live edge                | capture lifetime   | no / normal / no                        |
| Transcribing        | 144×36    | Transcribing…                 | orange comet, frozen locality             | stage lifetime     | no / normal / no                        |
| Cleaning            | 144×36    | Cleaning up                   | orange→magenta comet, frozen locality     | stage lifetime     | no / normal / no                        |
| Agent listening     | 40×40     | Agent mark, 24 radial ticks   | frozen Agent locality                     | capture lifetime   | no / normal / no                        |
| Agent thinking      | 40×40     | Agent mark                    | violet orbit, frozen operation locality   | until first token  | no / normal / no                        |
| Agent answering     | 40×40     | Agent mark                    | 1.2s orbit spin-up, then opacity dissolve | 1000ms             | no / normal / no                        |
| Pasted              | 164×36    | Pasted · N words, drawn check | success edge, frozen locality             | 700ms              | yes / no / no                           |
| Failed              | 40×40     | identity, nudge               | destructive edge, frozen locality         | 700ms              | yes / no / no                           |
| Cancelled           | 160×36    | Discarded · Undo              | held recording locality                   | 5s or 10s          | yes / yes / yes                         |
| Sealed paused       | 124×36    | Paused                        | struck-through original locality          | 4000ms             | yes / no / no                           |
| Meeting             | 124×36    | meeting recorder (Task 17)    | recording owner                           | recording lifetime | yes / yes / yes                         |
| Meeting interrupted | 184×36    | interruption (Task 17)        | recording owner                           | outcome lifetime   | yes / yes / yes                         |

The idle pill tooltip uses 12px text in a rounded rectangle: Hold or Press the configured shortcut, followed by the complete intended route from the current presentation owner. Its plain-text accessible label carries the same facts. Receiver and Agent captions, condensation words and mounted panels take priority over this generic tooltip. The tooltip shares the caption's physical-dock fit, wrapping, bounded scrolling, keyboard focus and Linux input-region policy within 208×120; hover remains open across the gap into its reading surface. Idle chrome has a 1px outer hairline with a light-theme shadow fallback. A fused cancel skin suppresses both blurred halo layers while retaining the comet ring. Retained Agent answers recede on `--motion-slow --motion-ease-exit` and restore on `--motion-base --motion-ease-enter`; thinking text shimmers between theme ink tokens on `--motion-thinking-shimmer`, becoming static muted ink under reduced motion.

Words and honest copy sit on a caption layer above the pill, never inside it (D9). The caption shows the last six committed/partial words while recording and processing, yields to the full transcript panel and receiver disclosure, and suppresses the pill tooltip while words are visible. Partial words are italic at 70% opacity for text contrast. Successful cleanup marks rewritten words with a 600ms underline; punctuation at token edges is ignored while case changes count. Alignment is exact within a 65,536-cell/65,536-character budget (at most 128KiB of alignment cells); longer takes conservatively mark unproven displayed words as changed without changing stored transcripts. The underline and spark use the live ring token for graphical contrast. The spark rises at the trailing word slot above the bars; a wide left-docked caption can place it beside the narrower pill rather than visibly from a bar. It disappears under reduced motion while word fades and rewrite colour feedback remain. The caption fits its physical viewport dock within 184px, wraps unbroken hostnames and scrolls vertically within the available space above Undo. Every receiver remains in the reachable text; pointer hover or user-driven keyboard focus pauses a held recording while reading. Its scroll/focus surface joins the existing Linux input region only with the interactive pill; idle click-through and native focus behavior remain unchanged. The identity sits in the locality ring: solid device, dotted network, dashed plus badge remote; struck through at full contrast when the optional Sealed reader reports blocking. The recording edge, Undo underline and pill-specific LevelBars outline use the live focus-ring token so their light-theme graphical boundary contrast stays at least 3:1. The canonical meter gradient and sampling math remain unchanged; resting bars use 60% foreground. This presentation is not a working seal or attestation. Only idle uses live Settings: active audio, held audio, outcome beats and banked Agent operations retain their original frozen destinations and enabled intents. Typed Agent turns publish an allowlisted display projection of the same effective inference snapshot before conversation creation or saving; exact-owner settlement and unmount cleanup cannot clear a newer request. Attachment acceptance, rather than the live screen setting, determines its screen-context caption. Busy work without exposed authority remains unknown-safe. Intended destinations do not establish receipts; cancellation captions use main-attested “already received” or renderer-only “may have received” evidence.

Agent listening collapses to the 40×40 identity with 24 violet radial level ticks, using the canonical peak and silence floor. Thinking uses a 2.4s violet orbit with two satellites spaced half of the active period apart in both thinking and answering; the first token starts a 1.2s spin-up and the orbit dissolves on `--motion-hero` after `--motion-slow`, inside its 1000ms answering phase. The phase belongs to the exact admitted response owner and starts only on its request-local response notification. Opening a pending panel is not a response. Stop/Esc, owner retirement, early completion and a replacement owner immediately suppress the phase and clear its timer while pending business work can remain busy. Violet shapes mix 15% foreground for contrast; the white satellite has a meaningful violet boundary. The 20px inner radius plus 11px maximum tick and 1px round cap fits the 64px viewport at both physical docks. Agent-orbit captions use a 14px gap, 6px higher than ordinary captions, and measure their scroll height with that same clearance. The caption names the frozen intended destination and requested/accepted screen context; it never invents receipt evidence. Receiver disclosure takes precedence, then Agent text, then condensed words. No frame glyph or beam ring ships. Reduced motion holds the orbit and satellites still and preserves the opacity dissolve, while audio-derived ticks keep updating with a flat phase.

The success beat is 700ms. The Undo underline is 5s, or 10s for recordings over 30s, and pauses on hover, including a hold opening beneath an already-hovered pointer. Each internal hold has a fresh animation generation even if the same session is re-held in one React batch; pause and evidence updates preserve it. The held shortcut label appears only while its main lease is held; click and keyboard Undo share the capsule. Undo and meeting Stop outrank Assistant footer actions, its pill-exit/collapse animation, close fade and panel-return resize mask. The pill derives those gates from the same ownership policy; the panel actions retain their own raw timeline. Pasted, failed and Sealed-paused outcomes hold the window for their readable beat. Stage labels truncate within their fixed footprint; reduced motion preserves fades, labels and colour, and steps the real countdown in fifths.

Each dictation captures its route, prompts, hosted-search choice, privacy and requested context before the first capture await. An Agent command keeps that operation through the assistant panel’s busy completion, including its original selection and screenshot. Changing Settings never reroutes those words; a typed follow-up admits the current settings as a new request. An unverifiable selected enterprise destination blocks before the microphone opens, and a changed destination preserves the words for recovery.

### Notices

`notify()` owns all transient feedback; no provider wrapper is required. Credential and route Undo use action receipts (7 seconds); main retains the original credential removal deadline (8 seconds), including on retry. That original deadline removes the credential Undo affordance even while hover pauses the receipt.

Three tiers, one look (VO-R14 B). Chips are 32px lines that hug the pill on its inner side; newest sits nearest the pill; at most three show. Controls wrap in narrow work areas; tall cards scroll so every action remains reachable. Every nonempty chip title has a keyboard- and pointer-accessible message disclosure, even with only one primary action. Expanded titles wrap in full above the explanation and diagnostics. Ordinary chips keep the 400×168 notice viewport and scroll locally rather than claiming the words-card native resize path.

| Tier    | Use                                       | Lifetime                                      | ARIA            |
| ------- | ----------------------------------------- | --------------------------------------------- | --------------- |
| Receipt | pasted, copied, restored, mic back        | 3.5 s (7 s with an action)                    | `role="status"` |
| Notice  | cleanup skipped, model changed, fallbacks | 10 s, or until acknowledged when `persistent` | `role="status"` |
| Alert   | words or work at risk                     | 10 s; never while it carries recovered words  | `role="alert"`  |

An alert that carries recovered words renders the **words-first card**: the transcript is the headline, selectable and draggable, with automatic paragraph direction independent of UI direction; the error is a one-line chip above it; primary is "Paste again" (⌥↵). Primaries use the ink button, never orange. Close is always visible. Copy says "Copied" only when the clipboard confirmed it, and "Couldn't copy" otherwise. Words leave only through Dismiss or a delivered Paste again; each failed dictation keeps its own card, and "N more" shows the others. Motion: enter `--motion-base --motion-ease-enter`, 8 px rise, `--motion-stagger` (40 ms) stagger for bursts; reduced motion fades only.

Voice notices use the same stack: cleanup failure is an amber notice with Retry cleanup and Settings, and a retired model stays until Accept or Choose another. Retry continues the failed recording’s captured operation; without that authority, or without confirmed clipboard delivery, an alert keeps the raw words. Content-bearing dictation failures keep a separate card per session through later starts and successes; only a delivered Paste again or Dismiss removes it. More expands the complete selectable explanation and recovery command, and keeps technical diagnostics and their Copy control accessible in both themes. Copy recovery command requires clipboard confirmation and keeps the source notice available. Settings links are held by main for up to 15 seconds and acknowledged by the control panel before opening, including while it loads or reloads.

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
- **Asymmetric friction.** Every provider, model, mode and endpoint change goes through the route planner (`routePlanner.ts`), and so do the switches that turn a route on (cleanup, translation, assistant, screen context, the vision override), the Corti region and provider web search. Turning a route off is instant; turning one on, adding web search, or a switch that moves screenshots to another recipient is staged when the data leaves the device. It simulates the write on a copy of the settings and resolves all 11 routes before and after, so the preview, the commit and Undo are the same patch. A change whose result stays on this device, or keeps the same recipient with no new payload (another model at the same provider), applies at once with an Undo receipt that names the task. A change to an active Corti speech tenant, Vertex project or authentication source also requires review even when the host stays the same, because the recipient account/source changes. A change that adds a recipient or a payload is staged: the radio shows "Staged, not active", a dashed panel asks for the provider, key or address, and the sticky bar lists every route the change touches, including inherited ones. Apply (the ink capsule, ⌘↵) is the only primary action and re-plans from live settings at click time. Closing Settings discards the draft. Undoing a move that would reach a remote recipient is staged again, never applied silently.
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

- **Do** use the UI ramp utilities (`text-micro` through `text-display`) in workspace components. Arbitrary `text-[Npx]` sizes fail `workspaceTokenAdoption.test.js`; Tailwind's standard sizes (`text-sm`, `text-xs`) are not flagged and migrate to the ramp when a file is touched.
- **Do** show metadata at full `text-muted-foreground`; hierarchy comes from size and weight, not opacity.

- **Do** use the ink CTA for everyday actions, Signal Orange for live voice, and the deeper orange nav marker for current navigation state in the light theme; in Plum Night, magenta marks current navigation.
- **Do** use Electric Fuchsia as a supporting accent, keeping the two roles distinct.
- **Do** preserve the Plum Night surface steps and soft rims when adding dark-theme surfaces.
- **Do** use compact controls, clear labels, and the existing visible focus treatment.
- **Do** adapt window controls and traffic-light clearance to the host OS while keeping the shared React interface coherent.

### Don't:

- **Don't** fill non-voice surfaces with orange or tint them with `primary`; orange means live voice (D1). Notes, chips and CTAs are ink or neutral.
- **Don't** use text glyphs (⊘, ✕) as status icons; use the Lucide icon with a token colour and a word.
- **Don't** put a leading icon on a default (ink) Button; its brand dot already leads. Icon buttons are `live` (voice) or `secondary`/`outline`.
- **Don't** show `providerDisplayName` output in the UI; name providers with `providerDisplayLabel(providerId, t)` so custom endpoints and unknown providers are localised.

- **Don't** drift into generic AI-dashboard styling or decorative marketing-page chrome.
- **Don't** swap orange and fuchsia roles or make both accents compete for the live-voice signal.
- **Don't** rely on shadow alone to distinguish dark surfaces; use the existing tonal layers and borders.
- **Don't** use movement as the only cue for recording, processing, selection, focus, or error states.

### Dictation sounds

Sound Effects offers Soft (default) and Classic styles plus Low, Medium (default) and High volume. Both selects follow the Dictation sounds toggle, including their live Settings search controls, and synchronize between windows. Soft uses sine tones with a quiet second harmonic for press, stop, delivered paste, successful cancellation, errors and microphone recovery. Classic preserves the two original start/stop melodies and leaves the other events silent. Acknowledged presses sound before microphone acquisition; an actual failure may follow with an error. Stale outcomes and refused cancellations stay silent.

### Dictation disclosure and streaming ownership

Dictation captures its five resolved routes at the recording press. Main sends a
`dictation-dispatch` receipt immediately before an admitted content request or the
first audio frame leaves. A connected or warmed socket is not evidence. Without
a main egress feed, captions say “may have received”; conditional future egress
notices may support “already received”. Metadata never counts. Every recipient
is named, and mixed evidence uses conservative wording with separate payload and
ticket accounting. No current Sealed or network attestation is implied.

Streaming admission binds the requesting window, a fresh attempt identity, main
operation generation, exact adapter, frozen configuration and main credential
authority. A warm transport is reused only for a matching authority. Pre-admission
frames cannot leave, and stale or foreign Send, Finalize, Stop and Cancel cannot
control a replacement operation. Cancel closes the operation's content gate
synchronously. Mutable adapter queues and remainders are overwritten on cancel
and terminal cleanup; bytes borrowed by an in-flight socket send are overwritten
when its completion returns ownership. Escaped transport/browser copies cannot
be recalled. Meeting transports retain their separate compatibility path.

Cancellation moves the exact session, press-time selection and screenshot,
privacy and disclosure tracker into a RAM-only hold. Its owned audio is overwritten
at expiry (including late byte copies); source Blob references are released.
No merge or temporary file is created by a hold unless existing discarded-audio
retention permits saving at close. Renderer segment conversions recheck their captured
owner before admitting a merge IPC and erase abandoned byte copies, including late
results. The merge exception begins only when main admitted the IPC before cancel;
that merge, or a local decode already running, retains its normal temporary-file
cleanup lifetime. Replay rechecks its restore, attempt and capture ownership after
Start and pacing waits and independently before finalization.

Undo lasts 5 seconds, or 10 seconds for recordings over 30 seconds. Hover pauses
the remaining time and freezes the published deadline; resume advances it. Undo
claims busy synchronously, respects an absolute admission deadline, waits boundedly
for final audio, and keeps the recording on refusal. Batch restores use the captured
route and context. Streaming restores open a fresh attempt on the original provider
and replay exact PCM at four times real time. Failed restores retain recoverable
audio. Snapshot savers capture original privacy, Blob, owner and assignment token
before awaits; a stale completion cannot persist or release a newer recording.

The overlay owns Escape throughout recording and processing, including processing
started by Undo, and releases it at idle or renderer teardown. Undo's ⌥Z lease exists
only while the cancel window is open; its visible shortcut follows main's held
authority, including expiry, while a click remains available. A refused Undo has
one translated notice; audio still arriving asks the user to try again. Pasted
and failed outcomes carry the captured session, with word counts only on paste.

Cross-window Undo is a token- and sender-bound request to the overlay, with a
2-second round trip and an absolute 1.5-second admission budget. Delivery and final
audio consume that same budget; a late request cannot start a pipeline. Reload,
destruction and timeout dispose request listeners. Onboarding receives sanitised
rich cancelled/cancelClosed demo events, including every disclosed recipient; the
workspace receives only the cancelled lifecycle state on the existing lifecycle
channel. A late close for an older session cannot clear a newer hold. Normal quit
waits up to 3 seconds for the overlay's RAM-hold flush before teardown, sidecar
shutdown and exit; repeated quit events remain held during that coordination.

Hook teardown also revokes a restore that has claimed its recording but is still
waiting for final audio. That exact buffer closes through the existing retention
policy; late bytes are erased and cannot reopen Undo or start the old pipeline.
Before a hook setup-effect reinstall disposes its manager, it retires the exact
cancel-window state/ref and publishes its flushed demo closure; the surviving
hook releases the old Undo lease. Retired callbacks cannot overwrite a new hold.
Callbacks detach before disposal, while a fresh installation remains usable.

Meeting recording presence is liveness only: its session, start time, source
interruption and quiet flag never imply that a transcript was saved. An explicit
saved outcome requires an acknowledged transcript write (or no content to write)
and an acknowledged main-process Stop. Save failures, Stop failures and owner loss
remain distinct failures. Live presence ends immediately at Stop, while main
privately retains the exact session's unfinished outcome owner until an explicit
validated result or owner loss. Crash, reload or close during a pending write or
Stop acknowledgement reports owner loss once, even after the tray returns idle;
late or duplicate results cannot affect a replacement session. False-presence
reports carry their last live session so a late timer reset cannot clear a newer
session on the same owner. Meeting, transcript-tab and chat recording meters use
shared five-bar LevelBars with direct analyser readers and the same reduced-motion
flat phase. The meeting fallback level and quiet flag are sampled every 84ms
(at most 12Hz), with one atomic store publication per tick when fields change.
Quiet means four continuous seconds below 0.01; speech clears it on the next
sample. Reconnecting/unavailable capture, missing/replaced analysers or invalid
samples reset measured silence and smoothing, so unknown input never counts toward that hold. Stop/unmount clears
both fields. Diarization uses eight named speaker tokens in Light and Plum Night,
all at least 4.5:1 on background, both surfaces, card and popover. Visible speaker
names carry identity alongside colour, with logical start borders for RTL.

While a meeting records, the tray leads with recording status and Stop, including
source-loss status. On Linux its icon gains a Signal orange dot and its tooltip
identifies the recording. A separate resident freedesktop notification offers Stop
when the server advertises actions. Without action support it still posts, asking
for a default click that reveals the existing pill; publication or service loss
attempts an action-free Electron fallback. Delivery and clicks depend on the
notification service, so fallback copy also names the tray. Every Stop, reveal and
notification lifetime belongs to its original meeting session; stale items do
nothing. Shutdown awaits resident-notification closure through the bounded sidecar
registry. Interruption alerts retain their separate action-free notification path.

The meeting prompt drops from the top centre of the active work area in a 392×92 window. Its 8s hover-paused card folds to a 224px mini action; close remains visible and labelled in every phase. Shortcut labels reflect only the current prompt’s held main lease. Entry uses `--motion-hero --motion-spring-settle`, fold uses `--motion-slow`, and exit uses `--motion-fast --motion-ease-exit`; reduced motion removes transforms. Long localized copy scrolls within the bounded card using pointer or focused PageDown/PageUp. Mini labels scroll horizontally with pointer input or Left/Right arrows on their native action button; Enter/Space retain acceptance. The 24px close sits 2px inside the logical start edge so it stays inside the native frame.

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

### In-app setup resume and workspace return (Plan05 Task19)

Setup requests carry only a validated optional onboarding step on
`loqui:start-onboarding`. Non-step click arguments and invalid event details mean
resume. Desktop clears only `onboardingCompleted`; preview completion and desktop
progress stay untouched. Every request creates a fresh Flow key, including the
same step. Preview resets its fake bridge and advances an independent lifetime
nonce; old completion callbacks cannot return a newer Flow or reuse its demo.

The first launch does not mount ControlPanel. After the workspace has been
entered, AppRouter and BrowserPreview retain that same Panel under
`WorkspacePresentation` while setup is shown, with separate Suspense boundaries.
The hidden/inert workspace keeps its actual note draft, editor, chat selection,
admitted streams, recorder and persistence effects. Focus returns to the prior
connected workspace control, or to the workspace host. Original portalled meeting
Stop/return controls remain available, including when the recording note was the
active view. Return exits setup before changing workspace selection; Stop still
uses the original recording store. No recording/session/cancellation owner is
introduced.

`workspaceActive` defaults to true outside this host. Hidden workspace keyboard
commands, pending navigation delivery and new queued chat sends pause until
return. Existing answers and saves continue under their captured owners. Dialog,
Settings, search, menu and popover portals cannot expose hidden commands or trap
setup focus. Transient modal contents close during setup; the editor/chat and
recording owners remain mounted. `onReturnToWorkspace` restores the retained
workspace from its live recording control. While setup is shown, that control
uses the existing “Open workspace” label, without promising a note navigation.

**Plan06 contact:** carry `workspaceActive` and `onReturnToWorkspace`, the retained
presentation/interaction gates, and the RAM-only `takeAfterSetupIntent` effect
immediately beside `handleNewNote`. Consume a new Ready intent only on actual
workspace return, once; ordinary returns do not replay it. New setup requests
clear superseded undelivered intents, and duplicate/old completions are inert.
Creation and live-recording exclusion remain in the original `useCreateNote`.

An already-consumed Ready note hand-off has separate, bounded activation
eligibility. `useCreateNote` accepts optional `CreateNoteOptions.canActivate` on
`createNote` and `createNoteIn`; omitted options preserve ordinary callers. The
admitted save keeps its original container and completes, but the predicate is
checked after saving and before context, reveal, selection or automatic recording.
Panel checks it again before switching views. A newer setup request or workspace
interaction expires activation without cancelling the original save, existing
answers or an unrelated live recording. Pointer, click, key and input capture
count as workspace interaction; automatic assistant/save completions and focus
restoration do not. Explicit workspace navigation/Settings commands and new pending note/meeting
navigation also expire it.

Pending note and meeting navigation signals expire Ready activation synchronously
at event receipt, before invoking the separate asynchronous payload getter. The
mount/return drains remain distinct: an empty initial getter must not expire a
valid Ready activation. Payloads still stage while inactive and deliver on return;
the original admitted save and both post-save activation checks remain intact.
Plan06 must preserve this event boundary as well as the delivery-time check.

**Additional Plan06 contact:** carry `workspaceActivationEpoch`, the existing
host request-counter ref, alongside `workspaceActive`/`onReturnToWorkspace`.
AppRouter increments it synchronously at the setup request boundary;
BrowserPreview does so for direct config/restart requests too. The Panel also
listens synchronously to the public setup event for default hosts. Preserve the
local interaction generation and both activation checks
beside the RAM consumer. This is eligibility for one admitted continuation, not
another global routing or recording authority; the unconsumed one-shot slot is
still cleared on supersession.

Settings destination activations carry an optional `SettingsModal.activationId`.
Every Ready Settings intent advances it, even for an identical path. The existing
modal parses and reapplies section/subtab through the retained owner, without a
modal key/remount or route/credential draft reset. Its logical open state and
actual Settings search shortcut use workspace activity as well as requested open.
Reactivation clears search and passes through an unset initial subtab so the
existing private `useSubTab` consumes a repeated destination after manual tab
navigation. Other modal callers omit the identity and retain their open/path API.

The neutral translated setup checklist resumes the actual saved phase-1 step and
always links Cleanup and Shortcut. It uses unfinished circles, ordinary ink
buttons, logical layout and wrapping controls. Preview progress and dismissal
are read from the current platform/scenario namespace, including while the Panel
is retained. All eight new resume leaves (including its accessible region name)
are authored in all eleven locales without changing existing leaves. Native
speaker verification and the phase-wide manual gates remain outstanding.

Task 20 completes `setupFlow` copy in Arabic, German, Spanish, French, Italian,
Japanese, European Portuguese, Russian, Simplified Chinese and Traditional Chinese.
The wording follows existing dictation, shortcut, text-cleanup and Apple permission
terms. Portuguese uses the informal singular register throughout, including the
resume checklist. Spoken examples include local fillers and retain a coherent
meaning across the distinct cleaned versions. Consent still names the recipient
and count; failed attempts disclose possible delivery and preserve the raw text.
Mac and ordinary-computer copy remain distinct, and Arabic uses direction-neutral
instructions. English and everything outside `setupFlow` remain unchanged.

The locale guard checks missing keys, nonstring values, CLDR categories,
interpolation and normalized English placeholders. Its only shared identity
exceptions are the two product-only labels and the exact MB/GB unit templates;
standard unit symbols are not untranslated prose. Local resource checks do not
certify native fluency. Native-speaker spot-checks for Arabic, Japanese and
Traditional Chinese remain required before a PR, alongside Task 21's rendered
locale and accessibility matrix. No human language review is claimed here.

### Setup route and operation ownership (Plan05 final fixes)

Setup voice and cleanup choices use the existing Plan03 route planner. Availability checks propose one patch without changing the committed route. New off-device recipients or payloads wait in the shared Apply/Discard bar; available local changes retain immediate application and the shared Undo. Opting into reuse includes every empty text scope in that same review and exact reverse patch. Selection, review and Apply make no provider request. A failed or superseded availability check preserves committed settings and the original trial text.

A synchronous monotonic renderer admission revision tracks meaningful cleanup settings, explicit choices and accepted trial sentences. It revokes old consent through an A→B→A round trip even before React renders. Capture, dispatch and result publication check that revision as well as the original main-owned credential and enterprise generations. Retry reuses its original admission and cannot renew consent. The in-memory preview also enforces main's five-minute captured-operation lifetime on entry and after asynchronous work; this is fixture fidelity, not a new authority.

Private multi-segment audio is decoded segment by segment through FFmpeg stdin/stdout and combined as PCM16 mono 16 kHz WAV in memory. The actual Parakeet decoder uses that same pipe path for private WebM without complete PCM, while valid PCM WAV bypasses conversion. Public conversion keeps its existing file path. Conversion failure retains every original segment on the admitted recording owner and reports failure. Streaming captures one adapter, identity and immutable options before its first await; sends, finalization, cancellation and exactly-once teardown keep that owner despite later settings changes. These repairs do not supply Plan04 session, hold or Undo contracts or a Sealed attestation.

Download failure and cancellation report actual remaining bytes, or an explicit unknown when cleanup cannot be verified. A failed unlink is never represented as zero bytes or “nothing kept.” The preview shortcut releases only its keyboard-owned hold on blur, focus loss and unmount. Ordinary retained Settings returns preserve the selected section, subtab and draft; a new explicit activation is consumed once. Tour role descriptions use localized setup copy, and Ready exposes one stable described status for an unknown destination.

Onboarding's ChatGPT cleanup selection reads only a passive main-memory model
catalog. The catalog comes from the user's explicit Codex model-list action and
is bound to the acknowledged ChatGPT account and running app-server session;
account changes, login/logout, discovery failure and disconnect invalidate it.
Selection keeps a remembered model only when that catalog owns it, otherwise
uses an acknowledged catalog default/first model through the existing coupled
route planner. A connected account with no inventory offers explicit model
listing, with no automatic process startup or discovery on selection. Captured
Codex cleanup execution retains its existing source-specific safe refusal.

Streaming teardown closes the admitted transport to new dispatch immediately,
but its single cached stop waits for that adapter's already-dispatched startup
to settle. A late token/start connection is therefore disconnected on disposal;
the wait covers only adapter startup, never the cancel/finalization path that
awaits teardown, and never looks up a newer provider or manager.

Dictation streaming now carries the compatible operation tuple
`correlationId`/`dictationSessionId`/`operationId` through preload for each admitted
attempt. Main binds it to the original webContents and captured provider adapter.
Its ephemeral per-provider record fences sends/finalization/stop, credential
continuations and sender destruction/navigation. Retired A controls cannot stop a
newer same-provider B, even when main A startup completed before its IPC reply
reaches A. Pending teardown waits only for its captured core startup; replacement
reclaims that adapter before starting another. Warmup cannot replace an admitted
operation, and warm reuse retains its original sender. Normal disconnect tails
can still reach the current owner; retired/lost owners cannot publish. Legacy
unlabeled controls can address only a same-sender unlabeled record and never fall
back against a labeled attempt. This boundary is connection ownership, without
adding Plan04 recording, hold, Undo or Task22 integration authority.

### Workspace · Next-message model and recorded answers

Chat and the note editor’s visible Ask AI composer disclose the next message’s destination and model with Plan 03’s `RouteDestinationChip`. Non-ready routes add `RouteStateChip`; unknown stays neutral “Checking…”, and blocked network and remote routes show the existing Sealed state. The whole read-only chip opens that route’s Settings path. Model text may truncate; state words wrap and stay visible. Text uses the shared 12px caption floor, and keyboard focus uses a full opaque 2px ring.

Each newly admitted answer records its destination from the same synchronous settings snapshot as inference, before conversation creation, user-save or context waits. The shared stream resolves Chat, Voice Assistant or the chosen Assistant Vision route according to its effective inference scope. Document answer headers render that recorded destination with the published chip; later Settings or fact changes update only the next-message chip. Unstamped legacy answers remain unstamped. Note Ask retains one composer across floating, sidebar and hide/reopen, preserving drafts and disarming replaced queues without sending.

This is route disclosure and persisted request attribution. Synthetic readiness and Sealed display checks do not establish native isolation, attestation or a zero-byte claim; Plan 07 D16 remains blocked.

### Chat context rail and deliberate pins

Chat uses the shared entity mention picker for notes, meetings, folders and dictations; people remain editor mentions. Typing `@` selects context without sending. A typed pick splices only its local query and at most one adjacent separator, preserving Markdown whitespace and the user's destination queue. Add context preserves the draft and caret. Native Add, remove, found-item, close and Context controls have localized names and opaque 2px focus rings. Rail and picker headings use the 12px caption ramp and full muted text.

Both typed and Add context picks belong to the exact draft, caret and logical selection that opened them. Editing text or moving the caret retires the old rows immediately; a newly detected `@query` owns fresh results. Held commands revalidate that intent and its source results before changing pins or the composer.

Context (`⌘.` on macOS, `Ctrl+.` elsewhere) defaults open at viewport widths of at least 1280px, with the user's choice stored in `chat.contextRailOpen`. The chat measures its actual available width: three columns require 784px; below that, the rail stacks in a bounded, scrollable row, leaving the composer and toggle reachable. At widths below 544px, the conversation list stacks above the chat. The local fixed mention popup clamps to viewport edges and follows resizing, scrolling and content growth; it retains textarea keyboard focus.

In scope lists deliberate pins. Found automatically lists the last assistant's tool/RAG notes, separately from current note/meeting pins, and remains read-only. Activity lists actual tool steps in order. Pins start local content lookup synchronously with admitted settings, route, note context and search scope before creation or user-save waits. Later pin edits affect the next admission. Notes use enhanced-or-raw content capped at 1500 UTF-16 units without splitting a code point; folders contribute their first five raw notes capped at 500 each, and source quotes cap at 240. Missing, deleted or failed items are skipped independently; dictations contribute text without a fabricated note citation. Only notes included in the prompt become saved pinned citation sources. Existing request ownership and route disclosure remain authoritative through navigation and cancellation.

### Insights destinations and activity layout

Insights tiles use a two-column grid below 720px of available content and four columns at or above it. Words and WPM open all History; Dictations opens its dictation filter. These explicit entries clear the previous Home search before changing the filter and navigating. Streak only scrolls to and focuses the mounted activity chart, preserving Home state. Metric labels and details use the full-opacity 12px caption ramp; destination tiles are native buttons with the shared opaque 2px focus ring.

Each destination tile’s accessible name references its visible localized metric label and displayed value through stable per-card IDs. Its accessible description references the visible detail and a screen-reader-only hint using the existing localized destination string. Words and WPM therefore retain distinct metric names and values even though both open History. A card without a selection action remains a noninteractive div.

The activity chart sizes fixed week tracks from its own container with `clamp(10px, calc((100cqi - 3rem - (weeks - 1) * 2px) / weeks), 18px)` and 2px gaps. Graphics may reach 10px; all month, weekday and legend text stays at least 12px with full muted ink. Month labels span until the next month’s track so readable text fits. The weekday track and gap reserve 3rem. At the cell floor, horizontal overflow remains inside the keyboard-focusable chart, keeping today reachable without widening the document. Activity uses five neutral levels including zero, a meaningful muted boundary and a neutral outer marker for today; orange remains live voice or the approved focus accent. The larger labels and neutral palette deliberately replace the older faded 10px labels and orange ramp. Analytics remains local-only with its existing loading, retry, retention and newest-request behavior.

### Workspace · Upload

The upload drop zone, its formats and the URL field stay visible while the upload
route is unavailable. Only Plan 03's confirmed `ready` state admits browse, drop,
URL submissions, transcription, retry or queue start. Unknown shows the shared
neutral Checking chip; other unavailable states show their actual shared route
reason. A missing model adds the transcription-model hint and an upload-scoped
Settings action. Readiness changes preserve draft URLs, selected files and the
queue, and do not cancel an operation already admitted. Speaker controls appear
only while the route is ready; their neutral track and thumb remain distinguishable
in both themes. Changed selection and retry controls enter without fading copy.

Chooser files returned after readiness is lost stay outside the running queue.
Their filenames remain in an opaque, readable local selection with an Add to
queue action, disabled until readiness is confirmed. Readiness restoration alone
does not add them; a fresh explicit action admits the current selection once.
Concurrent chooser returns accumulate, and unmount cannot append late files.
Previously admitted work keeps its existing run and cancellation ownership.

Disabled copy stays opaque at the readable text floor, with the full muted token;
aria-disabled and the cursor convey availability. Changed native controls have
full opaque two-pixel focus rings. Drag feedback uses neutral ink and an opaque
border pulse only during an enabled active drag, timed by shared motion tokens.
Reduced motion keeps a static border and colour, with no transform or loop.

### Workspace contrast and validation policy

Home and Insights share `DataRetentionNotice`: existing translated retention copy uses foreground text at the 13px UI step, with a warning glyph and warning frame. Warning colour supports the icon, not small readable text. AI glyphs retain the AI accent; small AI labels use `text-ai-text`. Everyday actions stay neutral; recording controls use `live`.

The published workspace token guard retains its scoped file list and same-line reasoned opt-outs. Missing native focus rings and faded ancestors require a separate audit: the regex guard alone cannot certify accessibility. Native controls use an opaque 2px focus ring, hover-revealed actions remain visible with keyboard focus, and explanatory disabled text stays unfaded. Composite editor options retain their existing keyboard ownership.

Root ESLint intentionally excludes retained nonproduct QA evidence in `.superpowers/**` and generated `**/browser-vite-cache/**` directories. Authored lookalike filenames outside QA, including `test/fixtures/browser-vite-cache-authored.js`, and ordinary test guards remain linted. The policy regression uses the real ESLint configuration and verifies `no-undef` on authored source.

Dictionary's header keeps the shared Toggle and existing action order. Caller-scoped styles make its track neutral in both states, retain a distinguishable thumb and boundary, and override the inherited translucent ring with an opaque 2px ring. Shared Toggle behavior and styling elsewhere are unchanged.
