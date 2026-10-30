# Changelog

## 0.1.0-beta.3 - 2026-10-30

- The locality indicator is now one solid ring for every destination; its colour alone says this device, your own server, or a provider. The dotted and dashed rings, the orbit animation, and the provider badge are gone.

Publication waits for real microphone, shortcut, paste, and meeting-capture checks and beta-to-beta updates from 0.1.0-beta.2, run on this draft's own installers. See docs/RELEASING.md and docs/VERIFICATION.md.

## 0.1.0-beta.2 - 2026-10-28

- UI design foundations: updated color, typography, motion, and button styles; reusable audio level bars and provider locality indicators.
- Refined sidebar, meeting notifications, note controls, hotkey input, and dictation panel styling.
- UI/UX overhaul: an accessibility and keyboard sweep; explicit local and remote route readiness, with saved keys held in the main process and removable with Undo; cancelling dictation keeps the recording in memory briefly for Undo; guided, resumable onboarding; workspace notes, chat sources, and a Home overview; and The Table, a Labs-only canvas view of a Space.
- Local Parakeet speech servers listen only on this device's loopback address.
- Dependency updates, including Electron 44.5.0 and Vite 8.3.5.

Publication waits for real microphone, shortcut, paste, and meeting-capture checks and the first beta-to-beta updates, run on this draft's own installers. See docs/RELEASING.md and docs/VERIFICATION.md.

## 0.1.0-beta.1 - 2026-10-07

First Loqui beta, based on OpenWhispr's MIT-licensed desktop application.

- Fresh, isolated Loqui identity and provisional orange/fuchsia branding.
- Local dictation, notes, meetings, conversations, history, and search.
- Guided onboarding for first dictation, optional cleanup, readiness checks, and repeatable browser previews.
- Independent speech and text providers, direct API keys, local GGUF models, and Codex subscription text generation.
- Removed hosted OpenWhispr account, billing, sharing, synchronization, and analytics services.
- Lucide interface icons, pinned runtime downloads, hosted platform checks, and reviewed signed release drafts.
- Optional automatic updates with explicit restart and active-work protection.

Linux hardware checks gate publication of this beta. As the first beta, it is exempt from beta-to-beta update tests, which start with 0.1.0-beta.2. See docs/RELEASING.md and docs/VERIFICATION.md.
