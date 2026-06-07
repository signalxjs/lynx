package com.sigx.http

import android.content.Context
import android.net.Uri
import android.util.Base64
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.Buffer
import okio.BufferedSink
import okio.ForwardingSink
import okio.buffer
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Process-wide registry of live OkHttp [Call]s keyed by the JS-supplied
 * numeric id, plus the multipart body factory.
 *
 * Buffered implementation (#249): the response body is read whole and
 * flushed as a single `chunk` event. The streaming milestone (#250) will
 * read `response.body.source()` in a loop emitting one chunk per read
 * when the request's `streaming` flag is set — purely additive here.
 */
internal object HttpTaskStore {

    /** Parsed request spec handed over from [HttpModule]. */
    data class Spec(
        val url: String,
        val method: String,
        val headers: Map<String, String>,
        val streaming: Boolean,
        val bodyType: String,
        val bodyText: String?,
        val bodyBase64: String?,
        val boundary: String?,
        val parts: List<Part>,
    )

    data class Part(
        val kind: String,
        val name: String,
        val value: String?,
        val uri: String?,
        val filename: String?,
        val contentType: String?,
    )

    private val calls = ConcurrentHashMap<Int, Call>()

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            // Between-bytes timeout matching iOS's timeoutIntervalForRequest.
            // Long-lived streams (SSE) stay alive as long as the server
            // keeps sending (keepalives reset the clock); a stalled server
            // fails the call instead of hanging it forever.
            .readTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    fun request(id: Int, spec: Spec, context: Context) {
        calls.remove(id)?.cancel()

        val builder = Request.Builder().url(spec.url)
        for ((k, v) in spec.headers) builder.header(k, v)

        val contentType = spec.headers.entries
            .firstOrNull { it.key.equals("Content-Type", ignoreCase = true) }?.value

        val body: RequestBody? = when (spec.bodyType) {
            "text" -> (spec.bodyText ?: "").toRequestBody(contentType?.toMediaTypeOrNull())
            "base64" -> {
                val bytes = try {
                    Base64.decode(spec.bodyBase64 ?: "", Base64.DEFAULT)
                } catch (e: IllegalArgumentException) {
                    HttpEventBus.publishError(id, "Invalid base64 body")
                    return
                }
                bytes.toRequestBody(contentType?.toMediaTypeOrNull())
            }
            "multipart" -> buildMultipart(id, spec, context)
            else -> null
        }

        builder.method(spec.method, if (requiresBody(spec.method) && body == null) ByteArray(0).toRequestBody() else body)

        val call = client.newCall(builder.build())
        calls[id] = call
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                calls.remove(id)
                // Aborts are initiated (and surfaced) JS-side — swallow them.
                if (!call.isCanceled()) {
                    HttpEventBus.publishError(id, e.message ?: e.javaClass.simpleName)
                }
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    val headers = mutableMapOf<String, String>()
                    for (name in it.headers.names()) {
                        headers[name.lowercase()] = it.headers.values(name).joinToString(", ")
                    }
                    HttpEventBus.publishResponse(id, it.code, it.message, headers)
                    try {
                        // Buffered mode: whole body as one chunk.
                        val bytes = it.body?.bytes() ?: ByteArray(0)
                        if (bytes.isNotEmpty()) {
                            HttpEventBus.publishChunk(id, Base64.encodeToString(bytes, Base64.NO_WRAP))
                        }
                        HttpEventBus.publishDone(id)
                    } catch (e: IOException) {
                        if (!call.isCanceled()) {
                            HttpEventBus.publishError(id, e.message ?: "body read failed")
                        }
                    } finally {
                        calls.remove(id)
                    }
                }
            }
        })
    }

    fun abort(id: Int) {
        calls.remove(id)?.cancel()
    }

    private fun requiresBody(method: String): Boolean =
        method == "POST" || method == "PUT" || method == "PATCH"

    /**
     * Build the multipart body with the JS-generated boundary (it must
     * match the Content-Type header verbatim). File parts wrap the URI in
     * a [RequestBody] whose `writeTo` pumps the ContentResolver/file
     * stream straight into the socket sink — file bytes never enter the
     * JS bridge and never sit in memory whole. The whole body is wrapped
     * in a counting RequestBody so JS gets upload `progress` events.
     */
    private fun buildMultipart(id: Int, spec: Spec, context: Context): RequestBody {
        val builder = MultipartBody.Builder(spec.boundary ?: "----SigxFormBoundary")
            .setType(MultipartBody.FORM)
        for (part in spec.parts) {
            // Defense in depth, mirroring the iOS MultipartBuilder: JS
            // sanitizes these too, but direct bridge callers must not be
            // able to inject header lines or trip OkHttp's header
            // validation with control characters.
            val name = dispositionSafe(part.name)
            if (part.kind == "file" && part.uri != null) {
                builder.addFormDataPart(
                    name,
                    dispositionSafe(part.filename ?: "file"),
                    uriRequestBody(context, part.uri, headerSafe(part.contentType ?: "").toMediaTypeOrNull()),
                )
            } else {
                builder.addFormDataPart(name, part.value ?: "")
            }
        }
        return CountingRequestBody(builder.build()) { written, total ->
            HttpEventBus.publishProgress(id, written, total)
        }
    }

    /** Strip CR/LF so a value can't terminate its header line early. */
    private fun headerSafe(s: String): String = s.replace("\r", "").replace("\n", "")

    /** Header-safe plus quote-stripping for quoted disposition params. */
    private fun dispositionSafe(s: String): String = headerSafe(s).replace("\"", "_")

    private fun uriRequestBody(context: Context, uriStr: String, mediaType: MediaType?): RequestBody {
        return object : RequestBody() {
            override fun contentType(): MediaType? = mediaType

            override fun writeTo(sink: BufferedSink) {
                openStream(context, uriStr).use { input ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        sink.write(buf, 0, n)
                    }
                }
            }
        }
    }

    private fun openStream(context: Context, uriStr: String): InputStream {
        val uri = Uri.parse(uriStr)
        return when (uri.scheme) {
            "content", "file" -> context.contentResolver.openInputStream(uri)
                ?: throw IOException("Could not open stream: $uriStr")
            else -> java.io.File(uriStr).inputStream()
        }
    }

    /** Wraps a RequestBody, reporting cumulative bytes written. */
    private class CountingRequestBody(
        private val delegate: RequestBody,
        private val onProgress: (written: Long, total: Long) -> Unit,
    ) : RequestBody() {

        override fun contentType(): MediaType? = delegate.contentType()

        override fun contentLength(): Long = try {
            delegate.contentLength()
        } catch (e: IOException) {
            -1L
        }

        override fun writeTo(sink: BufferedSink) {
            val total = contentLength()
            val counting = object : ForwardingSink(sink) {
                var written = 0L
                override fun write(source: Buffer, byteCount: Long) {
                    super.write(source, byteCount)
                    written += byteCount
                    onProgress(written, total)
                }
            }
            val buffered = counting.buffer()
            delegate.writeTo(buffered)
            buffered.flush()
        }
    }
}
