# Changelog

## 0.1.0-beta.2 (unreleased)

- UI design foundations: updated color, typography, motion, and button styles; reusable audio level bars and provider locality indicators.
- Refined sidebar, meeting notifications, note controls, hotkey input, and dictation panel styling.
- Reviewed implementation plans for accessibility, routes and settings, voice overlay, onboarding, workspace, Sealed mode, and the spatial canvas prototype. These plans do not imply that every planned feature is implemented.
- Distinct beta version for development packages built after the UI/UX foundation and planning PRs.

Public release remains pending signed and notarized packages and the acceptance checks in docs/RELEASING.md and docs/VERIFICATION.md.

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
