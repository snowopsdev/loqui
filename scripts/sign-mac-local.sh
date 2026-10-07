#!/bin/bash
# Local counterpart to sign-mac.sh: signs with a Developer ID identity already in
# the login keychain and notarizes with a stored notarytool keychain profile, so
# no certificate or API key material passes through env vars or temp files.
# Create the profile once with: xcrun notarytool store-credentials loqui-notary
set -euo pipefail
NOTARY_PROFILE="${NOTARY_PROFILE:-loqui-notary}"
MAC_SIGNING_IDENTITY="${MAC_SIGNING_IDENTITY:-$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p' | head -n1)}"
case "$MAC_SIGNING_IDENTITY" in 'Developer ID Application: '*) ;; *) echo "No Developer ID Application identity found" >&2; exit 1;; esac
xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null || { echo "Notary profile '$NOTARY_PROFILE' is missing or invalid" >&2; exit 1; }
TEMP_SIGN=$(mktemp -d)
trap 'rm -rf "$TEMP_SIGN"' EXIT
APP=dist/mac-arm64/Loqui.app
while IFS= read -r -d '' file; do
 if file -b "$file" | grep -q 'Mach-O'; then
  codesign --force --options runtime --timestamp --sign "$MAC_SIGNING_IDENTITY" --entitlements resources/mac/entitlements.mac.plist "$file"
 fi
done < <(find "$APP" -type f -print0)
while IFS= read -r -d '' bundle; do
 codesign --force --options runtime --timestamp --sign "$MAC_SIGNING_IDENTITY" --entitlements resources/mac/entitlements.mac.plist "$bundle"
done < <(find "$APP" -depth -type d \( -name '*.framework' -o -name '*.app' \) -print0)
codesign --verify --deep --strict --verbose=2 "$APP"
ditto -c -k --keepParent "$APP" "$TEMP_SIGN/notarize.zip"
xcrun notarytool submit "$TEMP_SIGN/notarize.zip" --keychain-profile "$NOTARY_PROFILE" --wait --timeout 30m
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
spctl --assess --type execute --verbose=2 "$APP"
# Packaging an already signed app preserves the notarized signature.
CSC_IDENTITY_AUTO_DISCOVERY=false npx --no-install electron-builder --config electron-builder.cjs --mac --arm64 --prepackaged "$APP" --publish never
for dmg in dist/Loqui-*.dmg; do
 codesign --timestamp --sign "$MAC_SIGNING_IDENTITY" "$dmg"
 xcrun notarytool submit "$dmg" --keychain-profile "$NOTARY_PROFILE" --wait --timeout 30m
 xcrun stapler staple "$dmg"
 xcrun stapler validate "$dmg"
 hdiutil verify "$dmg"
 node -e 'require("fs").rmSync(process.argv[1]+".blockmap",{force:true})' "$dmg"
done
unzip -t dist/Loqui-*-mac-arm64.zip >/dev/null
