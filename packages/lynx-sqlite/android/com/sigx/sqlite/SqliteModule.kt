package com.sigx.sqlite

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteCursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteProgram
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableArray
import com.lynx.react.bridge.ReadableMap
import com.lynx.react.bridge.ReadableType

/**
 * Embedded SQLite database module (framework `android.database.sqlite`,
 * no bundled C library).
 *
 * JS usage (via the `@sigx/lynx-sqlite` wrapper, not directly):
 *
 *   NativeModules.Sqlite.open(name, options, cb)            -> { handle }
 *   NativeModules.Sqlite.execute(handle, sql, params, cb)   -> { rows, rowsAffected, insertId? }
 *   NativeModules.Sqlite.executeBatch(handle, stmts, cb)    -> { rowsAffected }
 *   NativeModules.Sqlite.beginTransaction/commit/rollback(handle, cb)
 *   NativeModules.Sqlite.close(handle, cb)
 *   NativeModules.Sqlite.deleteDatabase(name, cb)
 *
 * Every callback resolves with the result map on success or `{ error }` on
 * failure. All statement work runs on the handle's single-thread executor
 * (see [SqliteStore]) so the JS thread is never blocked and statements for
 * one database never interleave.
 */
class SqliteModule(context: Context) : LynxModule(context) {

    @LynxMethod
    fun open(name: String?, @Suppress("UNUSED_PARAMETER") options: ReadableMap?, callback: Callback?) {
        val dbName = name?.takeIf { isPlainName(it) }
            ?: return err(callback, "Database name must be a plain file name")
        try {
            val file = mContext.getDatabasePath(dbName)
            file.parentFile?.mkdirs()
            val db = SQLiteDatabase.openOrCreateDatabase(file, null)
            db.enableWriteAheadLogging()
            val handle = SqliteStore.register(db)
            callback?.invoke(JavaOnlyMap().apply { putInt("handle", handle) })
        } catch (e: Exception) {
            err(callback, e.message ?: "Unable to open database")
        }
    }

    @LynxMethod
    fun execute(handle: Int, sql: String?, params: ReadableArray?, callback: Callback?) {
        val entry = SqliteStore.get(handle)
            ?: return err(callback, "No open database for handle $handle")
        if (sql.isNullOrBlank()) return err(callback, "SQL is required")
        entry.executor.execute {
            try {
                callback?.invoke(runStatement(entry.db, sql, params))
            } catch (e: Exception) {
                err(callback, e.message ?: "Statement failed")
            }
        }
    }

    @LynxMethod
    fun executeBatch(handle: Int, statements: ReadableArray?, callback: Callback?) {
        val entry = SqliteStore.get(handle)
            ?: return err(callback, "No open database for handle $handle")
        if (statements == null || statements.size() == 0) {
            callback?.invoke(JavaOnlyMap().apply { putInt("rowsAffected", 0) })
            return
        }
        entry.executor.execute {
            val db = entry.db
            var began = false
            try {
                db.beginTransaction()
                began = true
                var total = 0.0
                for (i in 0 until statements.size()) {
                    val stmt = statements.getMap(i)
                        ?: throw IllegalArgumentException("Statement $i is not an object")
                    val sql = stmt.getString("sql")
                    if (sql.isNullOrBlank()) throw IllegalArgumentException("Statement $i has no sql")
                    val result = runStatement(db, sql, stmt.getArray("params"))
                    total += result.getDouble("rowsAffected")
                }
                db.setTransactionSuccessful()
                db.endTransaction()
                began = false
                callback?.invoke(JavaOnlyMap().apply { putDouble("rowsAffected", total) })
            } catch (e: Exception) {
                if (began) {
                    try { db.endTransaction() } catch (_: Exception) {}
                }
                err(callback, e.message ?: "Batch failed")
            }
        }
    }

    @LynxMethod
    fun beginTransaction(handle: Int, callback: Callback?) {
        val entry = SqliteStore.get(handle)
            ?: return err(callback, "No open database for handle $handle")
        entry.executor.execute {
            try {
                entry.db.beginTransaction()
                callback?.invoke(JavaOnlyMap())
            } catch (e: Exception) {
                err(callback, e.message ?: "beginTransaction failed")
            }
        }
    }

    @LynxMethod
    fun commit(handle: Int, callback: Callback?) {
        endTransaction(handle, commit = true, callback)
    }

    @LynxMethod
    fun rollback(handle: Int, callback: Callback?) {
        endTransaction(handle, commit = false, callback)
    }

    private fun endTransaction(handle: Int, commit: Boolean, callback: Callback?) {
        val entry = SqliteStore.get(handle)
            ?: return err(callback, "No open database for handle $handle")
        entry.executor.execute {
            try {
                if (!entry.db.inTransaction()) {
                    err(callback, "No transaction in progress")
                    return@execute
                }
                if (commit) entry.db.setTransactionSuccessful()
                entry.db.endTransaction()
                callback?.invoke(JavaOnlyMap())
            } catch (e: Exception) {
                err(callback, e.message ?: "endTransaction failed")
            }
        }
    }

    @LynxMethod
    fun close(handle: Int, callback: Callback?) {
        val entry = SqliteStore.remove(handle)
            ?: return err(callback, "No open database for handle $handle")
        entry.executor.execute {
            try {
                entry.db.close()
                callback?.invoke(JavaOnlyMap())
            } catch (e: Exception) {
                err(callback, e.message ?: "close failed")
            }
        }
        entry.executor.shutdown() // runs the queued close, then stops the thread
    }

    @LynxMethod
    fun deleteDatabase(name: String?, callback: Callback?) {
        val dbName = name?.takeIf { isPlainName(it) }
            ?: return err(callback, "Database name must be a plain file name")
        try {
            // Also removes the -wal/-shm sidecars.
            mContext.deleteDatabase(dbName)
            callback?.invoke(JavaOnlyMap())
        } catch (e: Exception) {
            err(callback, e.message ?: "deleteDatabase failed")
        }
    }

    // ── statement execution ────────────────────────────────────────────────

    private fun runStatement(db: SQLiteDatabase, sql: String, params: ReadableArray?): JavaOnlyMap {
        val head = firstKeyword(sql)
        return when {
            head == "SELECT" || head == "EXPLAIN" || head == "VALUES" -> query(db, sql, params)
            // A CTE prefix can front INSERT/UPDATE/DELETE — those must go
            // through the write path (the query API can't run DML).
            head == "WITH" && !WRITE_VERB.containsMatchIn(sql) -> query(db, sql, params)
            // PRAGMA reads return a cursor; PRAGMA assignments don't.
            head == "PRAGMA" && !sql.contains('=') -> query(db, sql, params)
            head == "PRAGMA" -> {
                db.execSQL(sql)
                emptyResult()
            }
            else -> write(db, sql, params, head)
        }
    }

    private fun query(db: SQLiteDatabase, sql: String, params: ReadableArray?): JavaOnlyMap {
        val cursor = if (params == null || params.size() == 0) {
            db.rawQuery(sql, null)
        } else {
            // rawQuery(sql, selectionArgs) binds everything as TEXT —
            // a CursorFactory lets us bind typed values instead.
            db.rawQueryWithFactory(
                { _, driver, editTable, q ->
                    bindParams(q, params)
                    SQLiteCursor(driver, editTable, q)
                },
                // editTable is annotated non-null in current SDKs; "" means
                // no editable table, which is right for a read-only query.
                sql, null, "",
            )
        }
        val rows = JavaOnlyArray()
        try {
            while (cursor.moveToNext()) {
                val row = JavaOnlyMap()
                for (i in 0 until cursor.columnCount) {
                    val column = cursor.getColumnName(i)
                    when (cursor.getType(i)) {
                        Cursor.FIELD_TYPE_NULL -> row.putNull(column)
                        Cursor.FIELD_TYPE_INTEGER -> row.putDouble(column, cursor.getLong(i).toDouble())
                        Cursor.FIELD_TYPE_FLOAT -> row.putDouble(column, cursor.getDouble(i))
                        Cursor.FIELD_TYPE_STRING -> row.putString(column, cursor.getString(i))
                        else -> throw IllegalArgumentException(
                            "BLOB columns are not supported (column \"$column\") — " +
                                "store a file path or base64 TEXT instead",
                        )
                    }
                }
                rows.pushMap(row)
            }
        } finally {
            cursor.close()
        }
        return JavaOnlyMap().apply {
            putArray("rows", rows)
            putInt("rowsAffected", 0)
        }
    }

    private fun write(db: SQLiteDatabase, sql: String, params: ReadableArray?, head: String): JavaOnlyMap {
        val statement = db.compileStatement(sql)
        try {
            if (params != null) bindParams(statement, params)
            val result = JavaOnlyMap().apply { putArray("rows", JavaOnlyArray()) }
            when (head) {
                "INSERT", "REPLACE" -> {
                    val insertId = statement.executeInsert()
                    result.putInt("rowsAffected", if (insertId == -1L) 0 else 1)
                    if (insertId != -1L) result.putDouble("insertId", insertId.toDouble())
                }
                "UPDATE", "DELETE", "WITH" -> {
                    result.putInt("rowsAffected", statement.executeUpdateDelete())
                }
                else -> {
                    // DDL and friends — no row count.
                    statement.execute()
                    result.putInt("rowsAffected", 0)
                }
            }
            return result
        } finally {
            statement.close()
        }
    }

    /** Typed 1-based binds. The JS side pre-coerces params to string | number | null. */
    private fun bindParams(program: SQLiteProgram, params: ReadableArray) {
        for (i in 0 until params.size()) {
            val index = i + 1
            when (params.getType(i)) {
                ReadableType.Null -> program.bindNull(index)
                ReadableType.String -> program.bindString(index, params.getString(i))
                ReadableType.Number -> {
                    val d = params.getDouble(i)
                    // Integral doubles bind as INTEGER so id comparisons are exact.
                    if (d == Math.floor(d) && !d.isInfinite() && Math.abs(d) <= MAX_SAFE_INTEGER) {
                        program.bindLong(index, d.toLong())
                    } else {
                        program.bindDouble(index, d)
                    }
                }
                else -> throw IllegalArgumentException(
                    "Unsupported parameter type at index $index — bind string, number or null",
                )
            }
        }
    }

    private fun firstKeyword(sql: String): String {
        val m = HEAD_KEYWORD.find(sql)
        return m?.groupValues?.get(1)?.uppercase() ?: ""
    }

    private fun emptyResult(): JavaOnlyMap = JavaOnlyMap().apply {
        putArray("rows", JavaOnlyArray())
        putInt("rowsAffected", 0)
    }

    private fun err(callback: Callback?, message: String) {
        callback?.invoke(JavaOnlyMap().apply { putString("error", message) })
    }

    /**
     * The name becomes a filesystem path — restrict it to a plain file name
     * so a caller bypassing the JS wrapper can't traverse out of the app's
     * database directory. Mirrors the JS-side validation.
     */
    private fun isPlainName(name: String): Boolean =
        name != "." && name != ".." && PLAIN_NAME.matches(name)

    private companion object {
        val PLAIN_NAME = Regex("^[A-Za-z0-9._-]+$")
        val HEAD_KEYWORD = Regex("^[\\s(]*([A-Za-z]+)")
        val WRITE_VERB = Regex("\\b(insert|update|delete|replace)\\b", RegexOption.IGNORE_CASE)
        const val MAX_SAFE_INTEGER = 9007199254740992.0 // 2^53
    }
}
