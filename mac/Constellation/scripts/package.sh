#!/bin/bash
# Builds Orion.app, the Constellation capture app (Apple Silicon and Intel), zips it, and writes latest.json for the server's download
# page (server/src/downloads/mac.ts):
#   scripts/package.sh 0.7.0            # -> dist/Orion-0.7.0.zip and dist/latest.json
# Then copy both into the box's downloads folder, zip first so latest.json never points at a missing file:
#   scp dist/Orion-0.7.0.zip dist/latest.json <box>:<repo>/deploy/downloads/mac/
# Signing: without an Apple Developer ID the app is signed ad hoc, and macOS then asks for the Accessibility
# permission again after every update. Set CODESIGN_IDENTITY to a self-signed code signing certificate in your
# keychain (Keychain Access, Certificate Assistant, Create a Certificate, type Code Signing) and sign every release
# with that same one: the grant then survives updates. SWIFT=scripts/swift-clt.sh for Macs with stale tools.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${1:?usage: scripts/package.sh <version>, like 0.7.0}"
[[ "$VERSION" =~ ^[0-9A-Za-z.+-]{1,32}$ ]] || { echo "bad version: $VERSION" >&2; exit 1; }
SWIFT="${SWIFT:-swift}"
MIN_MACOS=14.0
BUNDLE_ID=ai.orion.constellation
OUT=dist
APP="$OUT/Orion.app"

rm -rf "$OUT" && mkdir -p "$APP/Contents/MacOS"
bins=()
for arch in arm64 x86_64; do
  "$SWIFT" build -c release --triple "$arch-apple-macosx$MIN_MACOS" --scratch-path ".build/$arch" >&2
  bins+=(".build/$arch/release/Constellation")
done
lipo -create "${bins[@]}" -output "$APP/Contents/MacOS/Constellation"
# The window's typeface (Theme.swift looks in Contents/Resources).
mkdir -p "$APP/Contents/Resources/Fonts"
cp Sources/Constellation/Resources/Fonts/* "$APP/Contents/Resources/Fonts/"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>Orion</string>
  <key>CFBundleDisplayName</key><string>Orion</string>
  <key>CFBundleExecutable</key><string>Constellation</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>$MIN_MACOS</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

codesign --force --options runtime --timestamp=none --sign "${CODESIGN_IDENTITY:--}" "$APP"
codesign --verify --strict "$APP"

ZIP="Orion-$VERSION.zip"
/usr/bin/ditto -c -k --keepParent "$APP" "$OUT/$ZIP"
SUM=$(shasum -a 256 "$OUT/$ZIP" | cut -d' ' -f1)
SIZE=$(stat -f%z "$OUT/$ZIP")
cat > "$OUT/latest.json" <<JSON
{"version":"$VERSION","file":"$ZIP","sha256":"$SUM","size":$SIZE,"publishedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","minMacos":"$MIN_MACOS"}
JSON
echo "$OUT/$ZIP ($SIZE bytes, sha256 $SUM)"
