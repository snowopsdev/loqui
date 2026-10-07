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
ORIGINAL_KEYCHAINS=()
while IFS= read -r line; do ORIGINAL_KEYCHAINS+=("$(echo "$line" | xargs)"); done < <(security list-keychains -d user)
cleanup() {
 security list-keychains -d user -s "${ORIGINAL_KEYCHAINS[@]}" >/dev/null 2>&1 || true
 security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
 rm -rf "$TEMP_SIGN"
}
trap cleanup EXIT
printf '%s' "$MAC_CERTIFICATE_BASE64" | base64 --decode > "$TEMP_SIGN/cert.p12"
printf '%s' "$APPLE_API_KEY_BASE64" | base64 --decode > "$TEMP_SIGN/AuthKey.p8"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security import "$TEMP_SIGN/cert.p12" -P "$MAC_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
# A Developer ID certificate exported from Keychain Access carries only the leaf.
# codesign ignores an identity whose chain it cannot build ("no identity found"),
# so supply Apple's Developer ID intermediates instead of relying on the runner.
for intermediate in DeveloperIDCA.cer:7afc9d01a62f03a2de9637936d4afe68090d2de18d03f29c88cfb0b1ba63587f \
 DeveloperIDG2CA.cer:f16cd3c54c7f83cea4bf1a3e6a0819c8aaa8e4a1528fd144715f350643d2df3a; do
 name=${intermediate%%:*}
 curl -fsSL --retry 3 -o "$TEMP_SIGN/$name" "https://www.apple.com/certificateauthority/$name"
 echo "${intermediate##*:}  $TEMP_SIGN/$name" | shasum -a 256 -c --quiet
 # The .p12 may already include the intermediate; that is the only tolerated error.
 if ! output=$(security import "$TEMP_SIGN/$name" -k "$KEYCHAIN" 2>&1); then
  grep -q "already exists" <<<"$output" || { echo "$output" >&2; exit 1; }
 fi
done
security list-keychains -d user -s "$KEYCHAIN" "${ORIGINAL_KEYCHAINS[@]}"
if ! security find-identity -v -p codesigning "$KEYCHAIN" | grep -qF "\"$MAC_SIGNING_IDENTITY\""; then
 echo "The signing identity is not a valid code signing identity in the imported certificate:" >&2
 security find-identity -p codesigning "$KEYCHAIN" >&2
 exit 1
fi
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
