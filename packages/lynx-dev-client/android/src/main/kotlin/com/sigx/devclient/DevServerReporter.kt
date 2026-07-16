package com.sigx.devclient

import android.net.Uri
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Forwards on-device runtime errors (the ones that populate the red-screen
 * [ErrorOverlay]) to the `sigx dev` log server, so they also show up — copyable
 * — in the terminal's Logs tab.
 *
 * The native `LynxViewClient.onReceivedError` callback catches a *superset* of
 * the JS-side `lynx.onError` hook (main-thread-script, template, render and
 * native-module errors never reach the BG-thread hook), so this is the channel
 * that closes the "only on the red screen" gap.
 *
 * Transport: a fire-and-forget HTTP POST on a daemon thread using the JDK's
 * [HttpURLConnection] (no extra dependency). All failures are swallowed — dev
 * tooling must never crash or block the host app.
 *
 * The log server runs on the dev-server port **+ 1** (the same convention the
 * plugin uses to bake `__SIGX_DEV_LOG_URL__`), so the endpoint is derived from
 * the bundle URL the screen is currently rendering.
 */
object DevServerReporter {

    private const val TAG = "SigxDevClient"
    private const val ENDPOINT_PATH = "/__sigx/device-error"
    private const val CONNECT_TIMEOUT_MS = 1500
    private const val READ_TIMEOUT_MS = 1500

    /**
     * POST [message] to the dev server derived from [bundleUrl]. No-ops when the
     * URL isn't a usable `http(s)` dev URL. Returns immediately; the request
     * runs on a background daemon thread.
     */
    fun report(bundleUrl: String?, message: String) {
        val endpoint = deviceErrorEndpoint(bundleUrl) ?: return
        val body = try {
            JSONObject()
                .put("message", message)
                .put("platform", "android")
                .put("ts", System.currentTimeMillis())
                .toString()
        } catch (_: Exception) {
            return
        }
        Thread {
            try {
                val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = CONNECT_TIMEOUT_MS
                    readTimeout = READ_TIMEOUT_MS
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
                try {
                    conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                    // Read (and discard) the response so the connection can be
                    // pooled/closed cleanly; we don't care about the result.
                    conn.responseCode
                } finally {
                    conn.disconnect()
                }
            } catch (e: Exception) {
                // Dev server not reachable / not a dev build — ignore quietly.
                Log.v(TAG, "device-error report failed: ${e.message}")
            }
        }.apply { isDaemon = true }.start()
    }

    /**
     * Build `http://<host>:<port+1>/__sigx/device-error` from a bundle URL like
     * `http://10.0.2.2:3000/main.lynx.bundle?...`. Returns null when the URL has
     * no usable `http(s)` host/port.
     */
    private fun deviceErrorEndpoint(bundleUrl: String?): String? {
        if (bundleUrl.isNullOrBlank()) return null
        return try {
            // `Uri.parse` is lenient (bundle URLs carry query strings that
            // `java.net.URI` can reject), so parse host/port/scheme with it.
            val uri = Uri.parse(bundleUrl)
            val scheme = uri.scheme?.lowercase() ?: return null
            if (scheme != "http" && scheme != "https") return null
            val host = uri.host ?: return null
            val port = uri.port
            if (port < 0) return null
            "$scheme://$host:${port + 1}$ENDPOINT_PATH"
        } catch (_: Exception) {
            null
        }
    }
}
