package com.sigx.sqlite

import android.database.sqlite.SQLiteDatabase
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Process-wide registry of open databases keyed by handle. Handles outlive
 * any single LynxView (Lynx may instantiate the module class per view —
 * same pattern as WebSocketTaskStore). Each entry owns a single-thread
 * executor: all statements for one database run serially off the JS
 * thread, which is what makes the JS-side operation queue's transaction
 * guarantees hold.
 */
internal object SqliteStore {

    class Entry(val db: SQLiteDatabase, val executor: ExecutorService)

    private val nextHandle = AtomicInteger(1)
    private val entries = ConcurrentHashMap<Int, Entry>()

    fun register(db: SQLiteDatabase): Int {
        val handle = nextHandle.getAndIncrement()
        entries[handle] = Entry(
            db,
            Executors.newSingleThreadExecutor { r -> Thread(r, "sigx-sqlite-$handle") },
        )
        return handle
    }

    fun get(handle: Int): Entry? = entries[handle]

    fun remove(handle: Int): Entry? = entries.remove(handle)
}
