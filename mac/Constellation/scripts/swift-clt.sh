#!/bin/sh
# `swift` for Macs whose Command Line Tools upgrade left stale files behind. Symptoms it fixes:
#   - "Invalid manifest" / undefined PackageDescription.Package.__allocating_init (an old
#     PackageDescription.private.swiftinterface from a previous install)
#   - "redefinition of module 'SwiftBridging'" (an old usr/include/swift/module.modulemap)
#   - "no such module 'Testing'" / "'_Testing_Foundation'" in swift test
# It hides those files with a VFS overlay instead of deleting them (no sudo). Use it like swift:
#   scripts/swift-clt.sh build -c release
#   scripts/swift-clt.sh test
# Reinstalling the Command Line Tools (xcode-select --install after removing them) fixes the Mac for good.
set -e
CLT=/Library/Developer/CommandLineTools
PD=$CLT/usr/lib/swift/pm/ManifestAPI/PackageDescription.swiftmodule
FW=$CLT/Library/Developer/Frameworks
WORK="${TMPDIR:-/tmp}/constellation-swift-clt"
mkdir -p "$WORK/module-cache"
: > "$WORK/empty.modulemap"
cat > "$WORK/overlay.yaml" <<EOF
{ "version": 0, "case-sensitive": "false", "roots": [
 { "type": "directory", "name": "$PD", "contents": [
  { "type": "file", "name": "arm64-apple-macos.private.swiftinterface", "external-contents": "$PD/arm64-apple-macos.swiftinterface" },
  { "type": "file", "name": "x86_64-apple-macos.private.swiftinterface", "external-contents": "$PD/x86_64-apple-macos.swiftinterface" } ] },
 { "type": "directory", "name": "$CLT/usr/include/swift", "contents": [
  { "type": "file", "name": "module.modulemap", "external-contents": "$WORK/empty.modulemap" } ] } ] }
EOF
O="$WORK/overlay.yaml"
exec swift "$@" \
  -Xmanifest -vfsoverlay -Xmanifest "$O" -Xmanifest -module-cache-path -Xmanifest "$WORK/module-cache" \
  -Xswiftc -vfsoverlay -Xswiftc "$O" -Xcc -ivfsoverlay -Xcc "$O" \
  -Xswiftc -F -Xswiftc "$FW" -Xswiftc -Xfrontend -Xswiftc -disable-cross-import-overlays \
  -Xlinker -F -Xlinker "$FW" -Xlinker -rpath -Xlinker "$FW"
