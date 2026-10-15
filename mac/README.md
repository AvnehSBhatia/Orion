# Constellation (Mac app)

## Build

Plain `swift build` fails on some Macs with stale Command Line Tools ("Invalid manifest", "redefinition of module 'SwiftBridging'", "no such module 'Testing'"). Then use `scripts/swift-clt.sh` in place of `swift` from `mac/Constellation`: `scripts/swift-clt.sh build -c release`, `scripts/swift-clt.sh test`, then `.build/release/Constellation --smoke-test`. It hides the stale files with a VFS overlay, no sudo.

## Connecting to Orion

In the Orion web app open Settings, Connect your Mac, and copy the one-time code (8 characters, valid 15 minutes). In the Outbox window enter the backend address and the code under "Auth code", then Connect. If your company requires it, accept its monitoring notice; nothing is sent before that. The mock backend (`node mac/mock-backend/server.mjs`) accepts the code `K7QF-2M9D`.
