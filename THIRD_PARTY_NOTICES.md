# Third-party notices

Loqui derives from OpenWhispr, copyright 2024 OpenWhispr Team, MIT licensed. LICENSE retains the full notice. Loqui changes are copyright 2026 Loqui contributors, MIT licensed.

Loqui's current artwork was supplied by the maintainer as `Loqui-Asset-Pack.zip` on 2026-09-24 and is distributed under the project's MIT terms. The pack contains PNGs, with no editable vector masters or separate creator/license metadata. Unchanged originals and archive/file SHA-256 records are retained in `src/assets/brand/source/`; distributable assets derive from those originals. See [artwork provenance and generation instructions](src/assets/README.md). No external creator attribution or vector origin is asserted.

UI icons: Lucide, ISC, https://github.com/lucide-icons/lucide/blob/main/LICENSE. Inter, Caveat, and Noto Sans: SIL Open Font License 1.1. Fontsource distributions and font source projects retain their notices; these interface-font notices do not identify the font used in the supplied raster wordmark. Nucleo icons and paid Yowza assets must not appear in publication history or release artifacts.

Electron includes Chromium and other components under their own licenses; retain its shipped notices. better-sqlite3 is MIT; SQLite is public domain. The release CycloneDX SBOM records resolved npm dependencies. Each package's license is authoritative.

Exact runtime sources, versions, hashes, and license identifiers are in runtime-assets.json. whisper.cpp/llama.cpp/ONNX Runtime use MIT; sherpa-onnx/Qdrant/CAMPPlus/MiniLM use Apache-2.0; WebRTC audio processing uses BSD-3-Clause with upstream third-party notices, and Abseil uses Apache-2.0. Retain model-specific notices for Silero and pyannote segmentation.

yt-dlp source uses Unlicense; executable dependencies have additional licenses. FFmpeg platform builds have GPL/LGPL obligations: retain ffmpeg-static's platform LICENSE and README. Sources/build information: https://github.com/eugeneware/ffmpeg-static and https://ffmpeg.org/legal.html. MediaRemote adapter's license remains in resources/mediaremote-adapter/LICENSE.

Downloaded speech/text model licenses are independent of Loqui's MIT license. Their source model cards apply. Codex is an external user-installed CLI, not bundled. Provider logos identify interoperability, not endorsement.
