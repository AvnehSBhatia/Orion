import CryptoKit
import Foundation
import SQLite3

// The encrypted local store (small M3): activity records survive a restart, so
// the Outbox (M5) can hold them until they are reviewed and sent.
//
// SQLite built into macOS, with the captured content sealed per record using
// AES-GCM and a key from the Keychain. Sealed: window title, domain and path,
// text, and the text hash. Readable, for sorting and the Outbox: times, app,
// status, and counts. Deleting all removes the files and the key.

public final class RecordStore: @unchecked Sendable { // every database call runs on `queue`
    public enum StoreError: Error {
        case open(String)
        case sql(String)
    }

    public struct Totals: Sendable, Equatable {
        public var records = 0
        public var chars = 0
    }

    private let queue = DispatchQueue(label: "constellation.store")
    private let url: URL
    private let keys: StoreKeyProvider
    private var db: OpaquePointer?
    private var key: SymmetricKey

    /// What gets sealed. Codable so the format can grow without a schema change.
    private struct Sealed: Codable {
        var windowTitle: String
        var domainPath: String?
        var text: String
        var textHash: String
    }

    public init(url: URL, keys: StoreKeyProvider) throws {
        self.url = url
        self.keys = keys
        self.key = try keys.loadOrCreate()
        try queue.sync { try openDatabase() }
    }

    /// ~/Library/Application Support/Constellation, key in the Keychain.
    public static func openDefault() throws -> RecordStore {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Constellation", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        return try RecordStore(url: folder.appendingPathComponent("constellation.sqlite"), keys: KeychainStoreKey())
    }

    deinit {
        if let db { sqlite3_close(db) }
    }

    // MARK: Writing

    /// Insert or update a record. Runs in the background; errors never include content.
    public func save(_ record: ActivityRecord) {
        queue.async { [self] in
            do { try upsert(record) } catch { print("Constellation store: save failed (\(error))") }
        }
    }

    /// Same as save, but waits. For tests and shutdown.
    public func saveNow(_ record: ActivityRecord) throws {
        try queue.sync { try upsert(record) }
    }

    /// Retention: clear the captured text of records that ended before `cutoff`.
    /// Title and domain stay, so older entries still show what they were. Returns how many were cleared.
    @discardableResult
    public func purgeText(endedBefore cutoff: Date) throws -> Int {
        try queue.sync {
            let rows = try query(
                "SELECT id, sealed FROM records WHERE ended_at < ? AND text_purged = 0",
                [.real(cutoff.timeIntervalSince1970)]
            ) { ($0.text(0), $0.blob(1)) }
            try exec("BEGIN")
            do {
                for (id, blob) in rows {
                    var sealed = try open(blob)
                    sealed.text = ""
                    sealed.textHash = Segmenter.hash("")
                    try run(
                        "UPDATE records SET sealed = ?, text_chars = 0, text_purged = 1 WHERE id = ?",
                        [.blob(try seal(sealed)), .text(id)]
                    )
                }
                try exec("COMMIT")
            } catch {
                try? exec("ROLLBACK")
                throw error
            }
            return rows.count
        }
    }

    /// Delete all (spec 2.7): close, remove the database files, and destroy the key,
    /// then start again empty with a new key.
    public func deleteAll() throws {
        try queue.sync {
            if let db { sqlite3_close(db) }
            db = nil
            for suffix in ["", "-journal", "-wal", "-shm"] {
                try? FileManager.default.removeItem(at: URL(fileURLWithPath: url.path + suffix))
            }
            try keys.destroy()
            key = try keys.loadOrCreate()
            try openDatabase()
        }
    }

    // MARK: Reading

    public func load(limit: Int = 500) throws -> [ActivityRecord] {
        try queue.sync {
            try query(
                """
                SELECT id, started_at, ended_at, app_bundle_id, app_name, sealed, redaction_count, status, snapshot_count
                FROM records ORDER BY started_at DESC LIMIT ?
                """,
                [.int(limit)]
            ) { row in (row.text(0), row.real(1), row.real(2), row.text(3), row.text(4), row.blob(5), row.int(6), row.text(7), row.int(8)) }
            .map { id, started, ended, bundleId, appName, blob, redactions, status, snapshots in
                let sealed = try open(blob)
                return ActivityRecord(
                    id: UUID(uuidString: id) ?? UUID(), startedAt: Date(timeIntervalSince1970: started),
                    endedAt: Date(timeIntervalSince1970: ended), appBundleId: bundleId, appName: appName,
                    windowTitle: sealed.windowTitle, domainPath: sealed.domainPath, text: sealed.text,
                    textHash: sealed.textHash, redactionCount: redactions,
                    status: RecordStatus(rawValue: status) ?? .local, snapshotCount: snapshots
                )
            }
        }
    }

    public func totals() -> Totals {
        (try? queue.sync {
            try query("SELECT COUNT(*), COALESCE(SUM(text_chars), 0) FROM records", []) { Totals(records: $0.int(0), chars: $0.int(1)) }
        }.first) ?? Totals()
    }

    // MARK: Database

    private func openDatabase() throws {
        var handle: OpaquePointer?
        guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil) == SQLITE_OK, let handle else {
            throw StoreError.open(String(cString: sqlite3_errmsg(handle)))
        }
        db = handle
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        try exec("PRAGMA secure_delete = ON") // overwrite deleted content instead of leaving it in free pages
        try migrate()
    }

    private func migrate() throws {
        let version = try query("PRAGMA user_version", []) { $0.int(0) }.first ?? 0
        if version < 1 {
            try exec("""
            CREATE TABLE IF NOT EXISTS records (
                id TEXT PRIMARY KEY,
                started_at REAL NOT NULL,
                ended_at REAL NOT NULL,
                app_bundle_id TEXT NOT NULL,
                app_name TEXT NOT NULL,
                sealed BLOB NOT NULL,
                redaction_count INTEGER NOT NULL,
                status TEXT NOT NULL,
                snapshot_count INTEGER NOT NULL,
                text_chars INTEGER NOT NULL,
                text_purged INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS records_started ON records(started_at);
            CREATE INDEX IF NOT EXISTS records_status ON records(status);
            PRAGMA user_version = 1;
            """)
        }
    }

    private func upsert(_ record: ActivityRecord) throws {
        let sealed = try seal(Sealed(
            windowTitle: record.windowTitle, domainPath: record.domainPath, text: record.text, textHash: record.textHash
        ))
        try run(
            """
            INSERT INTO records (id, started_at, ended_at, app_bundle_id, app_name, sealed, redaction_count, status, snapshot_count, text_chars)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                ended_at = excluded.ended_at, sealed = excluded.sealed, redaction_count = excluded.redaction_count,
                status = excluded.status, snapshot_count = excluded.snapshot_count, text_chars = excluded.text_chars
            """,
            [
                .text(record.id.uuidString), .real(record.startedAt.timeIntervalSince1970),
                .real(record.endedAt.timeIntervalSince1970), .text(record.appBundleId), .text(record.appName),
                .blob(sealed), .int(record.redactionCount), .text(record.status.rawValue),
                .int(record.snapshotCount), .int(record.text.count),
            ]
        )
    }

    // MARK: Encryption

    private func seal(_ value: Sealed) throws -> Data {
        guard let combined = try AES.GCM.seal(JSONEncoder().encode(value), using: key).combined else {
            throw StoreError.sql("seal failed")
        }
        return combined
    }

    private func open(_ data: Data) throws -> Sealed {
        let box = try AES.GCM.SealedBox(combined: data)
        return try JSONDecoder().decode(Sealed.self, from: AES.GCM.open(box, using: key))
    }

    // MARK: SQLite helpers

    private enum Value {
        case int(Int)
        case real(Double)
        case text(String)
        case blob(Data)
    }

    private struct Row {
        let statement: OpaquePointer
        func int(_ column: Int32) -> Int { Int(sqlite3_column_int64(statement, column)) }
        func real(_ column: Int32) -> Double { sqlite3_column_double(statement, column) }
        func text(_ column: Int32) -> String { sqlite3_column_text(statement, column).map { String(cString: $0) } ?? "" }
        func blob(_ column: Int32) -> Data {
            guard let bytes = sqlite3_column_blob(statement, column) else { return Data() }
            return Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, column)))
        }
    }

    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    private func exec(_ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw StoreError.sql(errorMessage) }
    }

    private func run(_ sql: String, _ values: [Value]) throws {
        _ = try query(sql, values) { _ in () }
    }

    private func query<T>(_ sql: String, _ values: [Value], _ map: (Row) throws -> T) throws -> [T] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw StoreError.sql(errorMessage)
        }
        defer { sqlite3_finalize(statement) }
        for (offset, value) in values.enumerated() {
            let index = Int32(offset + 1)
            switch value {
            case .int(let v): sqlite3_bind_int64(statement, index, Int64(v))
            case .real(let v): sqlite3_bind_double(statement, index, v)
            case .text(let v): sqlite3_bind_text(statement, index, v, -1, Self.transient)
            case .blob(let v): _ = v.withUnsafeBytes { sqlite3_bind_blob(statement, index, $0.baseAddress, Int32(v.count), Self.transient) }
            }
        }
        var rows: [T] = []
        while true {
            let step = sqlite3_step(statement)
            if step == SQLITE_ROW { rows.append(try map(Row(statement: statement))); continue }
            if step == SQLITE_DONE { break }
            throw StoreError.sql(errorMessage)
        }
        return rows
    }

    private var errorMessage: String { db.map { String(cString: sqlite3_errmsg($0)) } ?? "no database" }
}
