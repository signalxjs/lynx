package com.sigx.updates

import android.content.Context
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

/**
 * Streaming bundle downloader: bytes go straight to `tmp/<id>.partial` with
 * an incremental SHA-256, then atomically move into `updates/<id>/` once the
 * hash matches. Single-flight — concurrent calls beyond the first fail fast.
 */
object UpdateDownloader {

    private const val TAG = "SigxUpdates"
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 30_000
    private const val PROGRESS_INTERVAL_MS = 150L

    private val inFlight = AtomicBoolean(false)

    /**
     * @return null on success, or an error message. `code` semantics ride in
     *         the message prefix; the module maps them to bridge errors.
     */
    fun download(
        context: Context,
        url: String,
        expectedSha256: String,
        updateId: String,
        headers: Map<String, String>,
        manifestJson: String,
    ): String? {
        // Already on disk and intact → success without a byte transferred.
        if (UpdateStore.bundleFile(context, updateId).exists() &&
            UpdateStore.verifySha256(context, updateId)
        ) {
            return null
        }

        if (!inFlight.compareAndSet(false, true)) {
            return "E_DOWNLOAD_IN_PROGRESS: another download is running"
        }
        try {
            return downloadLocked(context, url, expectedSha256, updateId, headers, manifestJson)
        } finally {
            inFlight.set(false)
        }
    }

    private fun downloadLocked(
        context: Context,
        url: String,
        expectedSha256: String,
        updateId: String,
        headers: Map<String, String>,
        manifestJson: String,
    ): String? {
        val tmpDir = UpdateStore.tmpDir(context)
        tmpDir.mkdirs()
        val partial = File(tmpDir, "$updateId.partial")

        var connection: HttpURLConnection? = null
        try {
            connection = URL(url).openConnection() as HttpURLConnection
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.instanceFollowRedirects = true
            for ((key, value) in headers) {
                connection.setRequestProperty(key, value)
            }

            val status = connection.responseCode
            if (status !in 200..299) {
                return "Download failed: HTTP $status"
            }

            val totalBytes = connection.contentLengthLong.takeIf { it >= 0 }
            val digest = MessageDigest.getInstance("SHA-256")
            var receivedBytes = 0L
            var lastProgressAt = 0L

            connection.inputStream.use { input ->
                FileOutputStream(partial).use { out ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        out.write(buffer, 0, read)
                        digest.update(buffer, 0, read)
                        receivedBytes += read
                        val now = System.currentTimeMillis()
                        if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
                            lastProgressAt = now
                            UpdatesEventBus.emitProgress(receivedBytes, totalBytes)
                        }
                    }
                    out.fd.sync()
                }
            }
            UpdatesEventBus.emitProgress(receivedBytes, totalBytes ?: receivedBytes)

            val actual = digest.digest().joinToString("") { "%02x".format(it) }
            if (!actual.equals(expectedSha256, ignoreCase = true)) {
                partial.delete()
                return "E_HASH_MISMATCH: expected $expectedSha256, got $actual"
            }

            // Atomic-ish promote: write metadata first, bundle rename last.
            val dir = UpdateStore.updateDir(context, updateId)
            dir.deleteRecursively()
            dir.mkdirs()
            val meta = try {
                JSONObject(manifestJson)
            } catch (e: Exception) {
                JSONObject()
            }
            meta.put("sha256", expectedSha256.lowercase())
            meta.put("sizeBytes", receivedBytes)
            meta.put("sourceUrl", url)
            meta.put("downloadedAt", System.currentTimeMillis())
            // Atomic + fsynced: a truncated update.json would fail
            // verifySha256() on next launch and roll back a perfectly good
            // bundle as "corrupt".
            val metaFile = UpdateStore.updateJsonFile(context, updateId)
            val metaTmp = File(dir, "update.json.tmp")
            FileOutputStream(metaTmp).use { out ->
                out.write(meta.toString().toByteArray(Charsets.UTF_8))
                out.fd.sync()
            }
            if (!metaTmp.renameTo(metaFile)) {
                metaFile.delete()
                metaTmp.renameTo(metaFile)
            }
            val bundle = UpdateStore.bundleFile(context, updateId)
            if (!partial.renameTo(bundle)) {
                partial.copyTo(bundle, overwrite = true)
                partial.delete()
            }
            Log.i(TAG, "Downloaded update $updateId ($receivedBytes bytes)")
            return null
        } catch (e: Exception) {
            partial.delete()
            return "Download failed: ${e.message}"
        } finally {
            connection?.disconnect()
        }
    }
}
