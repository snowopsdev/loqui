# Loqui artwork

Original q-mark and wordmark artwork created for Loqui in September 2026. The editable masters are `brand/mark.svg`, `mark-mono.svg`, `app-icon.svg`, light/dark logo SVGs, and `social.svg`. The bold palette is orange (#FF5A1F), fuchsia (#D90078), and dark ink (#101E29). Orange is the primary wordmark and app-tile color; fuchsia is reserved for the i-dot and supporting highlights.

Run `npm run assets:generate` to render transparent PNGs, Linux icon sizes, the macOS ICNS, and monochrome template menu-bar icons at 1x/2x/3x. Exports are committed so release builds need no image service or paid asset downloads. Inspect small-size and light/dark rendering after editing the masters.

Loqui artwork is MIT licensed under the repository LICENSE. It is original vector geometry, not traced from upstream or a paid icon library. Wordmark text uses an open-source font; Inter and Caveat are supplied by Fontsource under SIL OFL. Noto Sans files retain SIL OFL terms. Interface icons use Lucide (ISC); see THIRD_PARTY_NOTICES.md. No upstream artwork fallback is permitted in release builds.
