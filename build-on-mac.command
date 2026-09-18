#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Build this kit on an Apple Silicon Mac in a native arm64 terminal."
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Install native arm64 Node.js 24, then run this command again."
  exit 1
fi
node -e 'if (process.arch !== "arm64" || Number(process.versions.node.split(".")[0]) !== 24) { console.error("Use native arm64 Node.js 24 (not Rosetta)."); process.exit(1); }'

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Install Apple's build tools with: xcode-select --install"
  echo "After installation completes, run this command again."
  exit 1
fi
for tool in swiftc clang; do
  if ! xcrun --find "$tool" >/dev/null 2>&1; then
    echo "Apple's $tool compiler is missing. Update Xcode Command Line Tools."
    exit 1
  fi
done
node - "$(sw_vers -productVersion)" "$(xcrun --sdk macosx --show-sdk-version)" <<'JS'
for (const [index, version] of process.argv.slice(2).entries()) {
  const [major, minor = 0] = version.split('.').map(Number);
  if (major < 14 || (major === 14 && minor < 2)) {
    console.error(`${index === 0 ? 'macOS' : 'The macOS SDK'} must be 14.2 or newer for meeting system audio.`);
    process.exit(1);
  }
}
JS

echo "Installing dependencies and building Loqui for Apple Silicon..."
npm ci --ignore-scripts
node scripts/install-platform-deps.cjs
npm run prepare:platform
npm run native:electron
npm run build:renderer
npm run build:mac

codesign --verify --deep --strict "dist/mac-arm64/Loqui.app"
echo "Build complete. Development packages are in: $PWD/dist"
echo "These packages use ad-hoc signing; they have no Developer ID or notarization."
ls -lh dist/*-mac-arm64.dmg dist/*-mac-arm64.zip
