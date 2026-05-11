package com.sigx.devclient

import android.content.Context
import android.util.Log
import com.lynx.tasm.provider.AbsTemplateProvider
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

private const val TAG = "SigxDevClient"

/**
 * Loads Lynx bundles from HTTP URLs (dev server) or assets (production).
 */
class DevTemplateProvider(context: Context) : AbsTemplateProvider() {

    private val appContext: Context = context.applicationContext

    override fun loadTemplate(uri: String, callback: Callback) {
        Log.d(TAG, "Loading template: $uri")
        Thread {
            try {
                if (uri.startsWith("http://") || uri.startsWith("https://")) {
                    loadFromUrl(uri, callback)
                } else {
                    loadFromAssets(uri, callback)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load template: $uri", e)
                callback.onFailed(e.message ?: "Unknown error loading template")
            }
        }.start()
    }

    private fun loadFromUrl(urlString: String, callback: Callback) {
        val url = URL(urlString)
        val connection = url.openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 10_000
            connection.readTimeout = 30_000
            connection.requestMethod = "GET"

            if (connection.responseCode != HttpURLConnection.HTTP_OK) {
                Log.e(TAG, "Template fetch failed: HTTP ${connection.responseCode} from $urlString")
                callback.onFailed("HTTP ${connection.responseCode}: ${connection.responseMessage}")
                return
            }

            connection.inputStream.use { inputStream ->
                ByteArrayOutputStream().use { output ->
                    val buffer = ByteArray(8192)
                    var length: Int
                    while (inputStream.read(buffer).also { length = it } != -1) {
                        output.write(buffer, 0, length)
                    }
                    callback.onSuccess(output.toByteArray())
                }
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun loadFromAssets(uri: String, callback: Callback) {
        appContext.assets.open(uri).use { inputStream ->
            ByteArrayOutputStream().use { output ->
                val buffer = ByteArray(8192)
                var length: Int
                while (inputStream.read(buffer).also { length = it } != -1) {
                    output.write(buffer, 0, length)
                }
                callback.onSuccess(output.toByteArray())
            }
        }
    }
}
