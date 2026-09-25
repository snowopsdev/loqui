# Loqui artwork

The current q-mark and wordmark are temporary Loqui artwork, pending a future branding pass. The editable masters are `brand/mark.svg`, `brand/mark-mono.svg`, `brand/app-icon.svg`, light/dark logo SVGs, and `brand/social.svg`. The palette is Signal Orange (#FF5A1F), Electric Fuchsia (#D90078), and dark ink (#101E29). These committed placeholders keep development and release builds independent of an image service or upstream artwork.

Run `npm run assets:generate` to render transparent PNGs, Linux icon sizes, the macOS ICNS, and monochrome template menu-bar icons at 1x/2x/3x. Exports are committed so release builds need no image service or paid asset downloads. Inspect small-size and light/dark rendering after editing the masters.

Loqui artwork is MIT licensed under the repository LICENSE. It is original vector geometry, not traced from upstream or a paid icon library. Wordmark text uses an open-source font; Inter and Caveat are supplied by Fontsource under SIL OFL. Noto Sans files retain SIL OFL terms. Interface icons use Lucide (ISC); see THIRD_PARTY_NOTICES.md. No upstream artwork fallback is permitted in release builds.
