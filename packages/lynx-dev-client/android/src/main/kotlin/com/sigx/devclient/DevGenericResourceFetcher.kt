package com.sigx.devclient

import com.lynx.tasm.resourceprovider.LynxResourceCallback
import com.lynx.tasm.resourceprovider.LynxResourceRequest
import com.lynx.tasm.resourceprovider.LynxResourceResponse
import com.lynx.tasm.resourceprovider.generic.LynxGenericResourceFetcher
import com.lynx.tasm.resourceprovider.generic.StreamDelegate
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Handles generic resource fetching (JS chunks, CSS, JSON, etc.) for LynxView.
 * Required for HMR hot-update JSON/JS fetches.
 */
@Suppress("UNCHECKED_CAST")
class DevGenericResourceFetcher : LynxGenericResourceFetcher() {

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    override fun fetchResource(
        request: LynxResourceRequest?,
        callback: LynxResourceCallback<ByteArray>
    ) {
        // `LynxResourceRequest` is an unannotated Java type, so declare it
        // nullable and guard: a non-null declaration would make Kotlin's
        // intrinsic throw an NPE before this body could return a structured
        // failure (and render the check dead code). Matches the production
        // fetchers in SigxProductionResources.kt.
        if (request == null) {
            callback.onResponse(failed("request is null"))
            return
        }

        val url = request.url
        val httpRequest = Request.Builder().url(url).build()
        httpClient.newCall(httpRequest).enqueue(object : Callback {
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (it.isSuccessful && it.body != null) {
                        callback.onResponse(LynxResourceResponse.onSuccess(it.body!!.bytes()))
                    } else if (it.code == 404 && url.contains(".css.hot-update.json")) {
                        // Missing CSS hot-update = no CSS change for this chunk.
                        // The css-extract HMR runtime iterates every chunk's
                        // `.css.hot-update.json` and only acts `if (ret.content)`,
                        // so return an empty module `{}` (no `content`) and it
                        // no-ops cleanly instead of throwing "Failed to load CSS
                        // update file". Chunks that DID change still 200 with
                        // real content, so CSS HMR is unaffected.
                        callback.onResponse(LynxResourceResponse.onSuccess("{}".toByteArray()))
                    } else {
                        callback.onResponse(failed("HTTP ${it.code}: ${it.message}"))
                    }
                }
            }

            override fun onFailure(call: Call, e: IOException) {
                callback.onResponse(failed(e))
            }
        })
    }

    override fun fetchResourcePath(
        request: LynxResourceRequest,
        callback: LynxResourceCallback<String>
    ) {
        callback.onResponse(failed("fetchResourcePath not supported"))
    }

    override fun fetchStream(request: LynxResourceRequest, delegate: StreamDelegate) {
        delegate.onError("fetchStream not supported")
    }

    override fun cancel(request: LynxResourceRequest) {}

    private fun <T> failed(message: String): LynxResourceResponse<T> =
        LynxResourceResponse.onFailed(Throwable(message)) as LynxResourceResponse<T>

    private fun <T> failed(e: Throwable): LynxResourceResponse<T> =
        LynxResourceResponse.onFailed(e) as LynxResourceResponse<T>
}
