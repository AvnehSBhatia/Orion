#!/bin/bash
# Build Orion.app, put it in ~/Applications, and open it. Terminal can close after this.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -x "$HOME/.swiftly/bin/swift" ]; then
  export PATH="$HOME/.swiftly/bin:$PATH"
fi
command -v swift >/dev/null || { echo "Swift is not installed. Install Xcode or Swift from https://swift.org/install"; exit 1; }

echo "Building Orion…"
swift build -c release

APP="$HOME/Applications/Orion.app"
mkdir -p "$HOME/Applications"
# Replace a previous copy. A running copy is quit first so the new one can open.
osascript -e 'tell application "Orion" to quit' >/dev/null 2>&1 || true
pkill -f 'Orion.app/Contents/MacOS/Constellation' >/dev/null 2>&1 || true
pkill -f '/.build/release/Constellation' >/dev/null 2>&1 || true
sleep 0.4
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS/Fonts" "$APP/Contents/Resources/Fonts"
cp .build/release/Constellation "$APP/Contents/MacOS/Constellation"
cp Sources/Constellation/Resources/Fonts/*.ttf "$APP/Contents/Resources/Fonts/"
cp Sources/Constellation/Resources/Fonts/*.ttf "$APP/Contents/MacOS/Fonts/"

cat > "$APP/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>ai.orion.constellation</string>
  <key>CFBundleName</key><string>Orion</string>
  <key>CFBundleDisplayName</key><string>Orion</string>
  <key>CFBundleExecutable</key><string>Constellation</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.7.0</string>
  <key>CFBundleVersion</key><string>0.7.0</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

codesign --force --sign - "$APP" >/dev/null
open "$APP"
echo "Orion is open. It lives at $APP. You can close Terminal."
