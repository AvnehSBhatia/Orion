import CryptoKit
import Foundation

/// Where the store's encryption key comes from. The Keychain in the app; a
/// fixed in-memory key in tests, so tests never touch the user's Keychain.
public protocol StoreKeyProvider: Sendable {
    func loadOrCreate() throws -> SymmetricKey
    /// Destroying the key makes anything left on disk unreadable (delete all).
    func destroy() throws
}

/// A 256-bit key in the login Keychain, usable only on this Mac (never synced).
public struct KeychainStoreKey: StoreKeyProvider {
    static let account = "store-key"

    public init() {}

    public func loadOrCreate() throws -> SymmetricKey {
        if let data = try Keychain.read(Self.account), data.count == 32 { return SymmetricKey(data: data) }
        let key = SymmetricKey(size: .bits256)
        try Keychain.write(key.withUnsafeBytes { Data($0) }, account: Self.account, label: "Constellation store key")
        return key
    }

    public func destroy() throws {
        try Keychain.delete(Self.account)
    }
}

/// For tests: a key that lives only in memory.
public final class MemoryStoreKey: StoreKeyProvider, @unchecked Sendable {
    private let lock = NSLock()
    private var key: SymmetricKey?

    public init() {}

    public func loadOrCreate() throws -> SymmetricKey {
        lock.lock()
        defer { lock.unlock() }
        if let key { return key }
        let created = SymmetricKey(size: .bits256)
        key = created
        return created
    }

    public func destroy() throws {
        lock.lock()
        defer { lock.unlock() }
        key = nil
    }
}
