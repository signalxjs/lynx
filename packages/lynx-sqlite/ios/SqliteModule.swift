import Foundation
import Lynx
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
/// Integral doubles within ±2^53 bind as INTEGER so id comparisons are exact.
private let MAX_SAFE_INTEGER = 9007199254740992.0

private struct SqliteError: Error {
    let message: String
    init(_ message: String) { self.message = message }
}

/// Process-wide registry of open databases keyed by handle. Handles outlive
/// any single LynxView (Lynx may instantiate the module class per view —
/// same pattern as WebSocketTaskStore). Each entry owns a serial queue: all
/// statements for one database run serially off the JS thread, which is
/// what makes the JS-side operation queue's transaction guarantees hold.
final class SqliteStore {

    static let shared = SqliteStore()

    final class Entry {
        let db: OpaquePointer
        let queue: DispatchQueue
        init(db: OpaquePointer, queue: DispatchQueue) {
            self.db = db
            self.queue = queue
        }
    }

    private let lock = NSLock()
    private var nextHandle = 1
    private var entries: [Int: Entry] = [:]

    func register(db: OpaquePointer) -> Int {
        lock.lock(); defer { lock.unlock() }
        let handle = nextHandle
        nextHandle += 1
        entries[handle] = Entry(db: db, queue: DispatchQueue(label: "com.sigx.sqlite.db\(handle)"))
        return handle
    }

    func get(_ handle: Int) -> Entry? {
        lock.lock(); defer { lock.unlock() }
        return entries[handle]
    }

    func remove(_ handle: Int) -> Entry? {
        lock.lock(); defer { lock.unlock() }
        return entries.removeValue(forKey: handle)
    }
}

/// Embedded SQLite database module (system libsqlite3, no pod).
///
/// JS usage (via the `@sigx/lynx-sqlite` wrapper, not directly):
///
///   NativeModules.Sqlite.open(name, options, cb)            -> { handle }
///   NativeModules.Sqlite.execute(handle, sql, params, cb)   -> { rows, rowsAffected, insertId? }
///   NativeModules.Sqlite.executeBatch(handle, stmts, cb)    -> { rowsAffected }
///   NativeModules.Sqlite.beginTransaction/commit/rollback(handle, cb)
///   NativeModules.Sqlite.close(handle, cb)
///   NativeModules.Sqlite.deleteDatabase(name, cb)
///
/// Every callback resolves with the result dictionary on success or
/// `{ error }` on failure. All statement work runs on the handle's serial
/// queue (see `SqliteStore`) so the JS thread is never blocked and
/// statements for one database never interleave.
///
/// Files live in `Library/Application Support/SQLite/<name>` — persisted,
/// but not in the iCloud-backed Documents tree (chat history can be large).
class SqliteModule: NSObject, LynxModule {

    @objc static var name: String { "Sqlite" }

    @objc static var methodLookup: [String: String] {
        [
            "open": NSStringFromSelector(#selector(open(_:options:callback:))),
            "execute": NSStringFromSelector(#selector(execute(_:sql:params:callback:))),
            "executeBatch": NSStringFromSelector(#selector(executeBatch(_:statements:callback:))),
            "beginTransaction": NSStringFromSelector(#selector(beginTransaction(_:callback:))),
            "commit": NSStringFromSelector(#selector(commit(_:callback:))),
            "rollback": NSStringFromSelector(#selector(rollback(_:callback:))),
            "close": NSStringFromSelector(#selector(close(_:callback:))),
            "deleteDatabase": NSStringFromSelector(#selector(deleteDatabase(_:callback:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    // MARK: - JS-callable methods

    @objc func open(_ name: String?, options: NSDictionary?, callback: LynxCallbackBlock?) {
        guard let name = name, Self.isPlainName(name) else {
            callback?(["error": "Database name must be a plain file name"])
            return
        }
        let path = Self.databasePath(for: name)
        try? FileManager.default.createDirectory(
            atPath: (path as NSString).deletingLastPathComponent,
            withIntermediateDirectories: true)
        var db: OpaquePointer?
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(path, &db, flags, nil) == SQLITE_OK, let handle = db else {
            let message = db.map { String(cString: sqlite3_errmsg($0)) } ?? "Unable to open database"
            if let db = db { sqlite3_close_v2(db) }
            callback?(["error": message])
            return
        }
        sqlite3_exec(handle, "PRAGMA journal_mode=WAL", nil, nil, nil)
        callback?(["handle": SqliteStore.shared.register(db: handle)])
    }

    @objc func execute(_ handle: NSNumber, sql: String?, params: NSArray?, callback: LynxCallbackBlock?) {
        guard let entry = SqliteStore.shared.get(handle.intValue) else {
            callback?(["error": "No open database for handle \(handle)"])
            return
        }
        guard let sql = sql, !sql.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            callback?(["error": "SQL is required"])
            return
        }
        entry.queue.async {
            do {
                callback?(try Self.run(entry.db, sql: sql, params: params))
            } catch let e as SqliteError {
                callback?(["error": e.message])
            } catch {
                callback?(["error": error.localizedDescription])
            }
        }
    }

    @objc func executeBatch(_ handle: NSNumber, statements: NSArray?, callback: LynxCallbackBlock?) {
        guard let entry = SqliteStore.shared.get(handle.intValue) else {
            callback?(["error": "No open database for handle \(handle)"])
            return
        }
        guard let statements = statements, statements.count > 0 else {
            callback?(["rowsAffected": 0])
            return
        }
        entry.queue.async {
            do {
                try Self.exec(entry.db, "BEGIN IMMEDIATE")
                do {
                    var total = 0
                    for (i, item) in statements.enumerated() {
                        guard let stmt = item as? NSDictionary, let sql = stmt["sql"] as? String else {
                            throw SqliteError("Statement \(i) has no sql")
                        }
                        let result = try Self.run(entry.db, sql: sql, params: stmt["params"] as? NSArray)
                        total += (result["rowsAffected"] as? Int) ?? 0
                    }
                    try Self.exec(entry.db, "COMMIT")
                    callback?(["rowsAffected": total])
                } catch {
                    try? Self.exec(entry.db, "ROLLBACK")
                    throw error
                }
            } catch let e as SqliteError {
                callback?(["error": e.message])
            } catch {
                callback?(["error": error.localizedDescription])
            }
        }
    }

    @objc func beginTransaction(_ handle: NSNumber, callback: LynxCallbackBlock?) {
        runControl(handle, "BEGIN IMMEDIATE", callback)
    }

    @objc func commit(_ handle: NSNumber, callback: LynxCallbackBlock?) {
        runControl(handle, "COMMIT", callback)
    }

    @objc func rollback(_ handle: NSNumber, callback: LynxCallbackBlock?) {
        runControl(handle, "ROLLBACK", callback)
    }

    private func runControl(_ handle: NSNumber, _ sql: String, _ callback: LynxCallbackBlock?) {
        guard let entry = SqliteStore.shared.get(handle.intValue) else {
            callback?(["error": "No open database for handle \(handle)"])
            return
        }
        entry.queue.async {
            do {
                try Self.exec(entry.db, sql)
                callback?([String: Any]())
            } catch let e as SqliteError {
                callback?(["error": e.message])
            } catch {
                callback?(["error": error.localizedDescription])
            }
        }
    }

    @objc func close(_ handle: NSNumber, callback: LynxCallbackBlock?) {
        guard let entry = SqliteStore.shared.remove(handle.intValue) else {
            callback?(["error": "No open database for handle \(handle)"])
            return
        }
        entry.queue.async {
            if sqlite3_close_v2(entry.db) == SQLITE_OK {
                callback?([String: Any]())
            } else {
                callback?(["error": String(cString: sqlite3_errmsg(entry.db))])
            }
        }
    }

    @objc func deleteDatabase(_ name: String?, callback: LynxCallbackBlock?) {
        guard let name = name, Self.isPlainName(name) else {
            callback?(["error": "Database name must be a plain file name"])
            return
        }
        let path = Self.databasePath(for: name)
        let fm = FileManager.default
        for suffix in ["", "-wal", "-shm"] {
            let p = path + suffix
            if fm.fileExists(atPath: p) {
                do {
                    try fm.removeItem(atPath: p)
                } catch {
                    callback?(["error": error.localizedDescription])
                    return
                }
            }
        }
        callback?([String: Any]())
    }

    // MARK: - statement execution

    /// The name becomes a filesystem path — restrict it to a plain file
    /// name so a caller bypassing the JS wrapper can't traverse out of the
    /// SQLite directory. Mirrors the JS-side validation.
    private static let plainName = try! NSRegularExpression(pattern: "^[A-Za-z0-9._-]+$")
    private static func isPlainName(_ name: String) -> Bool {
        if name == "." || name == ".." { return false }
        let range = NSRange(name.startIndex..., in: name)
        return plainName.firstMatch(in: name, options: [], range: range) != nil
    }

    private static func databasePath(for name: String) -> String {
        let base = NSSearchPathForDirectoriesInDomains(
            .applicationSupportDirectory, .userDomainMask, true).first ?? NSTemporaryDirectory()
        return ((base as NSString).appendingPathComponent("SQLite") as NSString)
            .appendingPathComponent(name)
    }

    private static func exec(_ db: OpaquePointer, _ sql: String) throws {
        if sqlite3_exec(db, sql, nil, nil, nil) != SQLITE_OK {
            throw SqliteError(String(cString: sqlite3_errmsg(db)))
        }
    }

    private static func run(_ db: OpaquePointer, sql: String, params: NSArray?) throws -> [String: Any] {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt = stmt else {
            throw SqliteError(String(cString: sqlite3_errmsg(db)))
        }
        defer { sqlite3_finalize(stmt) }
        try bind(stmt, params: params, db: db)

        var rows: [[String: Any]] = []
        loop: while true {
            switch sqlite3_step(stmt) {
            case SQLITE_ROW:
                rows.append(try readRow(stmt))
            case SQLITE_DONE:
                break loop
            default:
                throw SqliteError(String(cString: sqlite3_errmsg(db)))
            }
        }

        let readOnly = sqlite3_stmt_readonly(stmt) != 0
        var result: [String: Any] = [
            "rows": rows,
            "rowsAffected": readOnly ? 0 : Int(sqlite3_changes(db)),
        ]
        let head = firstKeyword(sql)
        if !readOnly && (head == "INSERT" || head == "REPLACE") {
            result["insertId"] = sqlite3_last_insert_rowid(db)
        }
        return result
    }

    private static func readRow(_ stmt: OpaquePointer) throws -> [String: Any] {
        var row: [String: Any] = [:]
        for i in 0..<sqlite3_column_count(stmt) {
            let column = String(cString: sqlite3_column_name(stmt, i))
            switch sqlite3_column_type(stmt, i) {
            case SQLITE_NULL:
                row[column] = NSNull()
            case SQLITE_INTEGER:
                row[column] = sqlite3_column_int64(stmt, i)
            case SQLITE_FLOAT:
                row[column] = sqlite3_column_double(stmt, i)
            case SQLITE_TEXT:
                row[column] = String(cString: sqlite3_column_text(stmt, i))
            default:
                throw SqliteError(
                    "BLOB columns are not supported (column \"\(column)\") — " +
                    "store a file path or base64 TEXT instead")
            }
        }
        return row
    }

    /// Typed 1-based binds. The JS side pre-coerces params to string | number | null.
    private static func bind(_ stmt: OpaquePointer, params: NSArray?, db: OpaquePointer) throws {
        guard let params = params else { return }
        for (i, value) in params.enumerated() {
            let index = Int32(i + 1)
            let rc: Int32
            if value is NSNull {
                rc = sqlite3_bind_null(stmt, index)
            } else if let text = value as? String {
                rc = sqlite3_bind_text(stmt, index, text, -1, SQLITE_TRANSIENT)
            } else if let number = value as? NSNumber {
                let d = number.doubleValue
                if d.truncatingRemainder(dividingBy: 1) == 0 && abs(d) <= MAX_SAFE_INTEGER {
                    rc = sqlite3_bind_int64(stmt, index, Int64(d))
                } else {
                    rc = sqlite3_bind_double(stmt, index, d)
                }
            } else {
                throw SqliteError("Unsupported parameter type at index \(i + 1) — bind string, number or null")
            }
            if rc != SQLITE_OK {
                throw SqliteError(String(cString: sqlite3_errmsg(db)))
            }
        }
    }

    private static func firstKeyword(_ sql: String) -> String {
        var rest = Substring(sql)
        while let first = rest.first, first.isWhitespace || first == "(" {
            rest = rest.dropFirst()
        }
        return String(rest.prefix(while: { $0.isLetter })).uppercased()
    }
}
