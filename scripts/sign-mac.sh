#!/bin/bash
set -euo pipefail
: "${MAC_CERTIFICATE_BASE64:?Missing Developer ID certificate}"
: "${MAC_CERTIFICATE_PASSWORD:?Missing certificate password}"
: "${MAC_SIGNING_IDENTITY:?Missing Developer ID Application identity}"
: "${APPLE_API_KEY_BASE64:?Missing notarization API key}"
: "${APPLE_API_KEY_ID:?Missing API key ID}"
: "${APPLE_API_ISSUER:?Missing issuer ID}"
case "$MAC_SIGNING_IDENTITY" in 'Developer ID Application: '*) ;; *) exit 1;; esac
TEMP_SIGN=$(mktemp -d)
KEYCHAIN="$TEMP_SIGN/signing.keychain-db"
KEYCHAIN_PASSWORD=$(openssl rand -hex 24)
cleanup() { security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true; rm -rf "$TEMP_SIGN"; }
trap cleanup EXIT
printf '%s' "$MAC_CERTIFICATE_BASE64" | base64 --decode > "$TEMP_SIGN/cert.p12"
printf '%s' "$APPLE_API_KEY_BASE64" | base64 --decode > "$TEMP_SIGN/AuthKey.p8"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security import "$TEMP_SIGN/cert.p12" -P "$MAC_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
APP=dist/mac-arm64/Loqui.app
while IFS= read -r -d '' file; do
 if file -b "$file" | grep -q 'Mach-O'; then
  codesign --force --options runtime --timestamp --keychain "$KEYCHAIN" --sign "$MAC_SIGNING_IDENTITY" --entitlements resources/mac/entitlements.mac.plist "$file"
 fi
done < <(find "$APP" -type f -print0)
while IFS= read -r -d '' bundle; do
 codesign --force --options runtime --timestamp --keychain "$KEYCHAIN" --sign "$MAC_SIGNING_IDENTITY" --entitlements resources/mac/entitlements.mac.plist "$bundle"
done < <(find "$APP" -depth -type d \( -name '*.framework' -o -name '*.app' \) -print0)
codesign --verify --deep --strict --verbose=2 "$APP"
ditto -c -k --keepParent "$APP" "$TEMP_SIGN/notarize.zip"
xcrun notarytool submit "$TEMP_SIGN/notarize.zip" --key "$TEMP_SIGN/AuthKey.p8" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait --timeout 30m
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
spctl --assess --type execute --verbose=2 "$APP"
# Packaging an already signed app preserves the notarized signature.
CSC_IDENTITY_AUTO_DISCOVERY=false npx --no-install electron-builder --config electron-builder.cjs --mac --arm64 --prepackaged "$APP" --publish never
for dmg in dist/Loqui-*.dmg; do
 codesign --timestamp --keychain "$KEYCHAIN" --sign "$MAC_SIGNING_IDENTITY" "$dmg"
 xcrun notarytool submit "$dmg" --key "$TEMP_SIGN/AuthKey.p8" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait --timeout 30m
 xcrun stapler staple "$dmg"
 xcrun stapler validate "$dmg"
 hdiutil verify "$dmg"
 node -e 'require("fs").rmSync(process.argv[1]+".blockmap",{force:true})' "$dmg"
done
unzip -t dist/Loqui-*-mac-arm64.zip >/dev/null
