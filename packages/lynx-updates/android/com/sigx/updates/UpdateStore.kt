package com.sigx.updates

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import com.lynx.tasm.LynxView
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.lang.ref.WeakReference
import java.security.MessageDigest

/**
 * On-disk update store + state machine shared by [UpdatesBundleResolver]
 * (startup, before any LynxView exists) and [UpdatesModule] (JS bridge).
 *
 * Layout under `filesDir/sigx-updates/`:
 *   state.json                       — single source of truth (atomic writes)
 *   updates/<updateId>/main.lynx.bundle + update.json
 *   tmp/                             — in-flight downloads; wiped at startup
 *
 * Update lifecycle: downloaded (dir exists) → pending (state.pendingUpdateId)
 * → committed (state.currentUpdateId). A pending update that exhausts its
 * launch attempts before JS calls markReady() is rolled back and deleted.
 */
object UpdateStore {

    private const val TAG = "SigxUpdates"
    private const val DIR = "sigx-updates"
    private const val SCHEMA_VERSION = 1
    private const val DEFAULT_MAX_LAUNCH_ATTEMPTS = 2
    private const val RUNTIME_VERSION_META_KEY = "com.sigx.updates.RUNTIME_VERSION"

    /** What this process actually loaded (set by the resolver). */
    @Volatile var launchedUpdateId: String? = null
        private set
    /** True when this launch is a pending update's trial run. */
    @Volatile var isFirstLaunchAfterUpdate: Boolean = false
        private set
    /** True when the resolver rolled back at this startup. */
    @Volatile var didRollBack: Boolean = false
        private set
    /** Update id that was rolled back at this startup (for events/info). */
    @Volatile var rolledBackUpdateId: String? = null
        private set

    /** Last-attached LynxView — apply-now reload target. */
    @Volatile private var lynxViewRef: WeakReference<LynxView>? = null

    fun attachView(view: LynxView) {
        lynxViewRef = WeakReference(view)
    }

    fun currentView(): LynxView? = lynxViewRef?.get()

    // ── Paths ────────────────────────────────────────────────────────────

    fun rootDir(context: Context): File = File(context.filesDir, DIR)
    fun updatesDir(context: Context): File = File(rootDir(context), "updates")
    fun tmpDir(context: Context): File = File(rootDir(context), "tmp")
    fun updateDir(context: Context, updateId: String): File = File(updatesDir(context), updateId)
    fun bundleFile(context: Context, updateId: String): File =
        File(updateDir(context, updateId), "main.lynx.bundle")
    fun updateJsonFile(context: Context, updateId: String): File =
        File(updateDir(context, updateId), "update.json")
    private fun stateFile(context: Context): File = File(rootDir(context), "state.json")

    // ── Binary identity ──────────────────────────────────────────────────

    /** The binary's runtime fingerprint, injected by `sigx prebuild` as manifest meta-data. */
    fun installedRuntimeVersion(context: Context): String {
        return try {
            val ai = context.packageManager.getApplicationInfo(
                context.packageName, PackageManager.GET_META_DATA)
            ai.metaData?.getString(RUNTIME_VERSION_META_KEY) ?: "unknown"
        } catch (e: Exception) {
            Log.w(TAG, "Could not read runtime version meta-data: ${e.message}")
            "unknown"
        }
    }

    fun installedBinaryVersion(context: Context): String {
        return try {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                info.longVersionCode.toString()
            } else {
                @Suppress("DEPRECATION")
                info.versionCode.toString()
            }
        } catch (e: Exception) {
            "unknown"
        }
    }

    // ── State ────────────────────────────────────────────────────────────

    data class State(
        var installedRuntimeVersion: String = "",
        var installedBinaryVersion: String = "",
        var currentUpdateId: String? = null,
        var previousUpdateId: String? = null,
        var pendingUpdateId: String? = null,
        var pendingLaunchAttempts: Int = 0,
        var maxLaunchAttempts: Int = DEFAULT_MAX_LAUNCH_ATTEMPTS,
        var lastRollbackUpdateId: String? = null,
        var lastRollbackReason: String? = null,
    )

    @Synchronized
    fun readState(context: Context): State? {
        val file = stateFile(context)
        if (!file.exists()) return null
        return try {
            val json = JSONObject(file.readText())
            State(
                installedRuntimeVersion = json.optString("installedRuntimeVersion", ""),
                installedBinaryVersion = json.optString("installedBinaryVersion", ""),
                currentUpdateId = json.optString("currentUpdateId").ifEmpty { null },
                previousUpdateId = json.optString("previousUpdateId").ifEmpty { null },
                pendingUpdateId = json.optString("pendingUpdateId").ifEmpty { null },
                pendingLaunchAttempts = json.optInt("pendingLaunchAttempts", 0),
                maxLaunchAttempts = json.optInt("maxLaunchAttempts", DEFAULT_MAX_LAUNCH_ATTEMPTS),
                lastRollbackUpdateId = json.optString("lastRollbackUpdateId").ifEmpty { null },
                lastRollbackReason = json.optString("lastRollbackReason").ifEmpty { null },
            )
        } catch (e: Exception) {
            Log.w(TAG, "state.json unreadable: ${e.message}")
            null
        }
    }

    /** Atomic + fsynced write — the launch-attempt counter must survive a crash. */
    @Synchronized
    fun writeState(context: Context, state: State) {
        val json = JSONObject()
            .put("schemaVersion", SCHEMA_VERSION)
            .put("installedRuntimeVersion", state.installedRuntimeVersion)
            .put("installedBinaryVersion", state.installedBinaryVersion)
            .put("currentUpdateId", state.currentUpdateId ?: "")
            .put("previousUpdateId", state.previousUpdateId ?: "")
            .put("pendingUpdateId", state.pendingUpdateId ?: "")
            .put("pendingLaunchAttempts", state.pendingLaunchAttempts)
            .put("maxLaunchAttempts", state.maxLaunchAttempts)
            .put("lastRollbackUpdateId", state.lastRollbackUpdateId ?: "")
            .put("lastRollbackReason", state.lastRollbackReason ?: "")
        val file = stateFile(context)
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, "state.json.tmp")
        FileOutputStream(tmp).use { out ->
            out.write(json.toString().toByteArray(Charsets.UTF_8))
            out.fd.sync()
        }
        if (!tmp.renameTo(file)) {
            // Windows-style rename-over-existing failure can't happen on
            // Android (POSIX rename), but belt-and-braces:
            file.delete()
            tmp.renameTo(file)
        }
    }

    /** Fresh state seeded with the binary's identity. */
    fun freshState(context: Context): State = State(
        installedRuntimeVersion = installedRuntimeVersion(context),
        installedBinaryVersion = installedBinaryVersion(context),
    )

    // ── Startup resolution (called by UpdatesBundleResolver) ─────────────

    /**
     * Decide which bundle this launch loads. Returns an absolute path to an
     * OTA bundle, or null to use the baked asset. Mutates rollback state —
     * call exactly once per process launch.
     */
    @Synchronized
    fun resolveStartupBundlePath(context: Context): String? {
        try {
            tmpDir(context).deleteRecursively()

            var state = readState(context)
            if (state == null) {
                if (rootDir(context).exists() && stateFile(context).exists()) {
                    // Unparseable state — wipe everything, run baked.
                    Log.w(TAG, "Corrupt state.json — clearing all updates")
                    rootDir(context).deleteRecursively()
                }
                return null
            }

            // Binary-update tripwire: a store update (or any reinstall that
            // changed the fingerprint/versionCode) invalidates every
            // downloaded update — they were published for the old runtime.
            val runtimeNow = installedRuntimeVersion(context)
            val binaryNow = installedBinaryVersion(context)
            if (state.installedRuntimeVersion != runtimeNow ||
                state.installedBinaryVersion != binaryNow
            ) {
                Log.i(TAG, "Binary changed (runtime ${state.installedRuntimeVersion} -> $runtimeNow, " +
                    "build ${state.installedBinaryVersion} -> $binaryNow) — clearing updates")
                updatesDir(context).deleteRecursively()
                writeState(context, freshState(context))
                return null
            }

            // Pending update: crash-guarded trial launch.
            val pending = state.pendingUpdateId
            if (pending != null) {
                if (state.pendingLaunchAttempts >= state.maxLaunchAttempts) {
                    Log.w(TAG, "Update $pending failed $state.pendingLaunchAttempts launches — rolling back")
                    rollbackPending(context, state, "crash")
                    state = readState(context) ?: return null
                } else {
                    val bundle = bundleFile(context, pending)
                    val firstAttempt = state.pendingLaunchAttempts == 0
                    val ok = bundle.exists() && (!firstAttempt || verifySha256(context, pending))
                    if (!ok) {
                        Log.w(TAG, "Update $pending missing or corrupt — rolling back")
                        rollbackPending(context, state, "corrupt")
                        state = readState(context) ?: return null
                    } else {
                        state.pendingLaunchAttempts += 1
                        writeState(context, state)
                        launchedUpdateId = pending
                        isFirstLaunchAfterUpdate = firstAttempt
                        sweepOrphans(context, state)
                        return bundle.absolutePath
                    }
                }
            }

            // Committed update: trusted (existence check only).
            val current = state.currentUpdateId
            if (current != null) {
                val bundle = bundleFile(context, current)
                if (bundle.exists()) {
                    launchedUpdateId = current
                    sweepOrphans(context, state)
                    return bundle.absolutePath
                }
                Log.w(TAG, "Committed update $current missing on disk — reverting to baked bundle")
                state.currentUpdateId = null
                writeState(context, state)
            }

            sweepOrphans(context, state)
            return null
        } catch (e: Exception) {
            // Any unexpected failure must never take the app down with it —
            // the baked bundle is always the safe answer.
            Log.e(TAG, "resolveStartupBundlePath failed: ${e.message}")
            return null
        }
    }

    private fun rollbackPending(context: Context, state: State, reason: String) {
        val pending = state.pendingUpdateId ?: return
        didRollBack = true
        rolledBackUpdateId = pending
        updateDir(context, pending).deleteRecursively()
        state.lastRollbackUpdateId = pending
        state.lastRollbackReason = reason
        state.pendingUpdateId = null
        state.pendingLaunchAttempts = 0
        writeState(context, state)
    }

    /** Delete update dirs not referenced by state (≤3 may remain by invariant). */
    private fun sweepOrphans(context: Context, state: State) {
        val keep = setOfNotNull(state.currentUpdateId, state.previousUpdateId, state.pendingUpdateId)
        updatesDir(context).listFiles()?.forEach { dir ->
            if (dir.isDirectory && dir.name !in keep) {
                dir.deleteRecursively()
            }
        }
    }

    // ── Transitions (called by UpdatesModule) ─────────────────────────────

    /** Stage a downloaded update to load on the next launch. */
    @Synchronized
    fun stagePending(context: Context, updateId: String): String? {
        if (!bundleFile(context, updateId).exists()) {
            return "Update $updateId is not on disk"
        }
        val state = readState(context) ?: freshState(context)
        if (state.currentUpdateId == updateId) return null // already active
        state.pendingUpdateId = updateId
        state.pendingLaunchAttempts = 0
        writeState(context, state)
        return null
    }

    /**
     * Record a launch attempt for an in-place reload (applyNow). The reload
     * doesn't go through the resolver, so the crash guard is armed here.
     */
    @Synchronized
    fun recordReloadAttempt(context: Context, updateId: String): String? {
        val state = readState(context) ?: freshState(context)
        if (state.pendingUpdateId != updateId) {
            state.pendingUpdateId = updateId
        }
        state.pendingLaunchAttempts += 1
        writeState(context, state)
        launchedUpdateId = updateId
        isFirstLaunchAfterUpdate = true
        return null
    }

    /** Commit the running pending update as healthy. Idempotent. */
    @Synchronized
    fun markReady(context: Context) {
        val state = readState(context) ?: return
        val pending = state.pendingUpdateId ?: return
        if (launchedUpdateId != pending) return // pending staged but not yet launched
        // previous → deleted, current → previous, pending → current
        state.previousUpdateId?.let { updateDir(context, it).deleteRecursively() }
        state.previousUpdateId = state.currentUpdateId
        state.currentUpdateId = pending
        state.pendingUpdateId = null
        state.pendingLaunchAttempts = 0
        writeState(context, state)
        Log.i(TAG, "Update $pending committed")
    }

    @Synchronized
    fun setMaxLaunchAttempts(context: Context, max: Int) {
        val state = readState(context) ?: freshState(context)
        state.maxLaunchAttempts = max.coerceIn(1, 10)
        writeState(context, state)
    }

    @Synchronized
    fun clearAll(context: Context) {
        updatesDir(context).deleteRecursively()
        tmpDir(context).deleteRecursively()
        writeState(context, freshState(context))
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    /** Re-hash the stored bundle against the sha256 recorded in update.json. */
    fun verifySha256(context: Context, updateId: String): Boolean {
        return try {
            val meta = JSONObject(updateJsonFile(context, updateId).readText())
            val expected = meta.optString("sha256").lowercase()
            if (expected.isEmpty()) return false
            sha256Of(bundleFile(context, updateId)) == expected
        } catch (e: Exception) {
            false
        }
    }

    fun sha256Of(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
