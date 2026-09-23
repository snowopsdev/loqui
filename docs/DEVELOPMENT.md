# Developing Loqui

Loqui uses one React renderer in an Electron application, with native helpers for desktop integration. Build desktop packages on the target platform: Linux x86_64 or Apple Silicon macOS. Browser preview work can be done without preparing the native runtime.

## Prerequisites

- Git and the exact Node version in [`.node-version`](../.node-version), with npm.
- For native builds: Python 3, a C/C++ toolchain, CMake, Ninja, and network access for pinned runtime sources and archives.
- On macOS: Xcode and its command-line tools, with the SDK expected by [`assert-toolchain.cjs`](../scripts/assert-toolchain.cjs). The release workflow records and checks the actual toolchain.
- On Linux: compiler tools, `pkg-config`, X11/XTest, evdev, and PipeWire development headers. AppImage launch needs FUSE support or extraction support in your environment.

On Ubuntu 22.04, the native dependencies used by CI can be installed with:

```sh
sudo apt-get update
sudo apt-get install -y build-essential python3 pkg-config libx11-dev libxtst-dev libevdev-dev libpipewire-0.3-dev libfuse2 clang cmake ninja-build
```

Use your distribution's equivalent packages elsewhere. A graphical session and a usable OS credential store are needed for desktop testing; never run Loqui as root.

## Renderer preview

From the repository root:

```sh
npm ci --ignore-scripts
npm run dev:renderer
```

Open `http://127.0.0.1:5183/`. The browser preview uses sample content and simulated desktop services. It does not authenticate providers, record a real microphone, or download models. [Onboarding preview](ONBOARDING_PREVIEW.md) documents repeatable scenarios, direct links, and platform simulation.

The development server binds to loopback. To review from another computer, use an SSH tunnel, or explicitly bind with `npm run dev:renderer -- --host 0.0.0.0` on a trusted network. Use the development host's address on the client; the client's `127.0.0.1` points at the client unless tunneled. Do not expose a Vite development server to the public internet.

## Desktop development

After installing dependencies:

```sh
node scripts/install-platform-deps.cjs
npm run prepare:platform
npm run native:electron
npm run dev
```

Platform preparation compiles native helpers and obtains the runtime binaries and support models needed for meetings and search. It may take several minutes and consume substantial disk space. It does not download the user-selected dictation or cleanup models.

`npm ci --ignore-scripts` intentionally separates dependency installation from Electron installation, native compilation, renderer compilation, and packaging. Follow the explicit steps above instead of relying on npm lifecycle scripts.

Development profiles and model caches are isolated from packaged Loqui. Use `LOQUI_PROFILE_DIR` and `LOQUI_CACHE_ROOT` only when deliberately choosing test directories; the cache override selects a location without migrating existing data. See [privacy](PRIVACY.md).

## Checks

SQLite bindings are specific to their runtime. Run the Node rebuild before Node tests, and rebuild for Electron again before desktop launch or packaging:

```sh
npm run native:node
npm test
npm run lint
npm run typecheck
npm run i18n:check
npm run publication:check
npm run build:renderer
npm run native:electron
```

Use the repository's Prettier configuration for changed files. `npm run format:check` checks formatting as well as lint. Add focused tests for changed behavior; browser simulations do not validate microphones, global shortcuts, automatic paste, or meeting capture.

## Development packages

After platform preparation, the Electron native rebuild, and the renderer build:

```sh
npm run pack
node scripts/package-smoke.cjs
```

Then run the command for the current platform:

```sh
# Linux x86_64: AppImage and tar.gz
npm run build:linux

# Apple Silicon macOS: DMG and ZIP
npm run build:mac
```

Outputs are written to `dist/`. Development macOS packages use ad-hoc signing; they do not satisfy Developer ID, notarization, or Gatekeeper acceptance. Public releases must use the protected [release workflow](RELEASING.md).

Do not commit generated packages, native build outputs, downloaded models, test profiles, recordings, or credentials. Regenerate distributable artwork from the committed SVG masters with `npm run assets:generate`; retain its license and provenance information.
