# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Provisional inference from the approved brief, pending user confirmation: people who want private, reliable voice dictation across desktop applications. The brief prioritizes helping new users reach a successful first dictation. More specific occupations, team contexts, and market segments remain undecided.

## Product Purpose

Loqui is a personal desktop voice workspace for dictation, assistant conversations, notes, meetings, transcription history, and search. Success begins when someone can record speech and get a useful transcript inside Loqui, then optionally use a shortcut to send dictation into another application.

## Positioning

Loqui combines local speech recognition and local text models with explicitly chosen provider API keys and ChatGPT subscription access through Codex. Speech recognition and each text task have independent provider and model selections, so users can decide which work stays on-device and which work uses a remote service.

## Operating Context

Loqui runs as an Electron desktop application with one shared React interface. The supported release targets are Linux x86_64 and Apple Silicon macOS 14.2 or newer. Users can dictate into Loqui or, after configuring platform permissions and a shortcut, into other desktop applications. Local workflows work offline after their models have been downloaded and are ready.

## Capabilities and Constraints

- Local SQLite is authoritative for notes, folders, conversations, meetings, dictionary, snippets, and transcription history.
- Local speech options include Parakeet and Whisper; local text inference uses the embedded llama.cpp runtime and compatible imported GGUF models. Local diarization, embeddings, and search support meeting and history workflows.
- Text tasks can use local models, user-configured provider API keys, or Codex-managed ChatGPT subscription access. Codex is for text generation, not speech recognition or embeddings.
- Optional direct calendar connections and URL imports are supported. Loqui has no hosted Loqui account, billing, team service, sharing, cloud backup, synchronization, or analytics upload.
- Remote processing happens only through a user-selected provider. Loqui does not silently change providers or move work from local processing to a remote service. When cleanup fails, the original transcript remains available.
- A fresh Loqui profile is separate from Whispr Personal data. Importing an existing OpenWhispr account or database is outside the initial release scope.
- Windows and Intel Mac are outside the current release targets. The product remains in beta; signing, notarization, hardware, and hosted-CI release evidence is tracked in `docs/VERIFICATION.md`.
- The product name is Loqui. Further segmentation of the primary audience and future branding assets remain open decisions.

## Brand Commitments

The name Loqui is retained and refers to the Latin verb “to speak.” Current artwork is placeholder branding; the user intends to revisit custom logos and icons later. Upstream OpenWhispr MIT attribution remains in the repository, and Loqui is not affiliated with OpenWhispr or OpenAI.

## Evidence on Hand

The repository contains the Electron application, a browser-only onboarding preview, product and privacy documentation, local verification results, and a release verification checklist. See `docs/ONBOARDING_PREVIEW.md`, `docs/PRIVACY.md`, and `docs/VERIFICATION.md`. No customer testimonials, external adoption figures, or independent product benchmarks have been established.

## Product Principles

- Keep local storage and local processing as the default path; make remote processing an explicit user choice.
- Keep speech recognition and text-generation choices independent.
- Preserve user content when permissions, models, authentication, providers, or cleanup fail.
- Get new users to a successful in-app dictation before introducing optional integrations and advanced setup.
- Let users enter the workspace before setup is complete and return to unfinished setup later.

## Accessibility & Inclusion

Onboarding should support keyboard navigation, visible focus, screen-reader progress announcements, readable error and recovery states, and smaller desktop windows. No formal accessibility conformance target has been confirmed.
