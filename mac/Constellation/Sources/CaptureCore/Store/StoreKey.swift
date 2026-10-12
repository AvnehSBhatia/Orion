import CryptoKit
import Foundation
import Security

/// Where the store's encryption key comes from. The Keychain in the app; a
/// fixed in-memory key in tests, so tests never touch the user's Keychain.
public protocol StoreKeyProvider: Sendable {
    func loadOrCreate() throws -> SymmetricKey
    /// Destroying the key makes anything left on disk unreadable (delete all).
    func destroy() throws
}

public enum StoreKeyError: Error {
    case keychain(OSStatus)
}

/// A 256-bit key in the login Keychain, usable only on this Mac (never synced).
public struct KeychainStoreKey: StoreKeyProvider {
    let service = "com.traxrobotics.constellation"
    let account = "store-key"

    public init() {}

    public func loadOrCreate() throws -> SymmetricKey {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data, data.count == 32 {
            return SymmetricKey(data: data)
        }
        guard status == errSecItemNotFound else { throw StoreKeyError.keychain(status) }

        let key = SymmetricKey(size: .bits256)
        var add = baseQuery
        add[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        add[kSecAttrLabel as String] = "Constellation store key"
        let added = SecItemAdd(add as CFDictionary, nil)
        guard added == errSecSuccess else { throw StoreKeyError.keychain(added) }
        return key
    }

    public func destroy() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw StoreKeyError.keychain(status) }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
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
